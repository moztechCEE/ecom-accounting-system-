import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WmsWorkspaceBridge } from './wms-workspace-bridge';
export function prepareDispatch(
  order: any,
  entityId: string,
  mapping: Record<string, Record<string, string>>,
) {
  if (!order || order.entityId !== entityId)
    throw new NotFoundException('WMS_ERP_ORDER_NOT_FOUND');
  if (order.status !== 'pending' || order.shipments?.length)
    throw new ConflictException('訂單已出貨或不可拋單');
  if (!order.items?.length || order.items.length > 1000)
    throw new BadRequestException('訂單沒有可拋轉品項');
  const brands = new Set<string>();
  const items = [...order.items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((i) => {
      const p = i.product,
        quantity = Number(i.qty),
        brand = mapping[entityId]?.[i.productId];
      if (
        !p ||
        p.entityId !== entityId ||
        !p.isActive ||
        typeof brand !== 'string' ||
        !brand.trim() ||
        brand.length > 128
      )
        throw new BadRequestException('商品公司或品牌對照未確認');
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !p.barcode?.trim())
        throw new BadRequestException('商品數量或條碼待補');
      // ERP SalesOrderItem currently has no authoritative SN allocation. Never silently downgrade tracking.
      if (p.hasSerialNumbers)
        throw new BadRequestException('需序號商品尚缺訂單 SN 配置，暫不可拋單');
      if (['BUNDLE', 'SERVICE'].includes(p.type))
        throw new BadRequestException('組合或服務商品需先確認實體揀貨品項');
      brands.add(brand);
      return {
        id: i.id,
        sku: p.sku,
        name: p.name,
        barcode: p.barcode,
        quantity,
        tracked: false,
        serials: [],
      };
    });
  if (brands.size !== 1)
    throw new BadRequestException('混合品牌訂單需先確認分單對照');
  if (items.reduce((n, i) => n + i.quantity, 0) > 50000)
    throw new BadRequestException('訂單數量超過上限');
  const snapshot = {
    erpOrderId: order.id,
    entityId,
    orderNumber: order.externalOrderId || order.id,
    brand: [...brands][0],
    items,
    updatedAt: new Date(order.updatedAt).toISOString(),
  };
  const sourceHash = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
  return {
    orderNumber: snapshot.orderNumber,
    brand: snapshot.brand,
    items,
    sourceHash,
  };
}
export class WmsDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: WmsWorkspaceBridge,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  private async permit(actorId: string) {
    if (!(await this.bridge.stations(actorId)).includes('dispatch'))
      throw new ForbiddenException('WMS_DISPATCH_DENIED');
  }
  private async prepare(db: any, entityId: string, id: string) {
    let mapping;
    try {
      mapping = JSON.parse(this.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON || '{}');
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
        throw Error();
    } catch {
      throw new ServiceUnavailableException('WMS_BRAND_CONFIG_INVALID');
    }
    const order = await db.salesOrder.findFirst({
      where: { id, entityId },
      include: {
        items: { include: { product: true } },
        shipments: { select: { id: true } },
      },
    });
    return prepareDispatch(order, entityId, mapping);
  }
  async preview(actorId: string, entityId: string, id: string) {
    await this.permit(actorId);
    return this.prepare(this.prisma, entityId, id);
  }
  async candidates(actorId: string, entityId: string, search = '') {
    await this.permit(actorId);
    const rows = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        status: 'pending',
        shipments: { none: {} },
        ...(search
          ? {
              OR: [
                {
                  externalOrderId: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                { id: search },
              ],
            }
          : {}),
      },
      select: { id: true, externalOrderId: true, orderDate: true },
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      orderNumber: r.externalOrderId || r.id,
      orderDate: r.orderDate,
    }));
  }
  async dispatch(
    actorId: string,
    entityId: string,
    id: string,
    sourceHash: string,
    requestId: string,
  ) {
    await this.permit(actorId);
    if (this.env.WMS_WORKSPACE_COMMANDS_ENABLED !== 'true')
      throw new ServiceUnavailableException('WMS 作業寫入尚未啟用');
    // Durable intent survives a dropped response or a browser restart. Existing intents are immutable.
    const intent = await this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM sales_orders WHERE id=${id} AND entity_id=${entityId} FOR SHARE`;
      const payload = await this.prepare(db, entityId, id);
      if (payload.sourceHash !== sourceHash)
        throw new ConflictException('訂單已異動，請重新預覽');
      const digest = createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
      await db.$executeRaw`INSERT INTO wms_dispatch_intents(entity_id,sales_order_id,request_id,created_by,payload_hash,payload)
    VALUES(${entityId},${id},${requestId},${actorId},${digest},${JSON.stringify(payload)}::jsonb) ON CONFLICT(entity_id,sales_order_id) DO NOTHING`;
      const rows = await db.$queryRaw<
        any[]
      >`SELECT * FROM wms_dispatch_intents WHERE entity_id=${entityId} AND sales_order_id=${id}`;
      if (rows[0].payload_hash !== digest)
        throw new ConflictException('此訂單已建立不同版本拋單，需人工核對');
      return rows[0];
    });
    try {
      // Always revalidate source grants, even on a retry; no cached response bypasses revoked access.
      const result = await this.bridge.command(
        actorId,
        entityId,
        id,
        'dispatch',
        'dispatch',
        { requestId: intent.request_id, order: intent.payload },
      );
      await this.prisma
        .$executeRaw`UPDATE wms_dispatch_intents SET status='acknowledged',response=${JSON.stringify(result)}::jsonb,updated_at=now() WHERE entity_id=${entityId} AND sales_order_id=${id}`;
      return result;
    } catch (e) {
      await this.prisma
        .$executeRaw`UPDATE wms_dispatch_intents SET status=CASE WHEN status='acknowledged' THEN status ELSE 'unknown' END,updated_at=now() WHERE entity_id=${entityId} AND sales_order_id=${id}`;
      throw e;
    }
  }
}
