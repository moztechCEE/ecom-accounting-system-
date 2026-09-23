import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { requireHandoverEnabled } from './wms-handover.auth';
import { WmsHandoverDto } from './wms-handover.dto';

const conflict = (message: string): never => {
  throw new ConflictException(message);
};
const decimal = (n: any) => new Prisma.Decimal(n);

export function validateHandoverEvidence(event: WmsHandoverDto) {
  if (!event.handover || !event.lines?.length)
    throw new BadRequestException('交運證據與明細不可空白');
  if (
    event.handover.method === 'carrier_collection' &&
    (!event.handover.carrier?.trim() ||
      !(event.handover.trackingNo?.trim() || event.handover.manifestId?.trim()))
  ) {
    throw new BadRequestException('物流收件需承運商及物流單號或交運總表');
  }
  if (new Date(event.occurredAt).getTime() > Date.now() + 300000)
    throw new BadRequestException('交運時間不可晚於現在');
  const ids = new Set<string>(),
    sourceLines = new Set<string>();
  for (const line of event.lines) {
    if (ids.has(line.shipmentLineId) || sourceLines.has(line.salesOrderLineId))
      throw new BadRequestException('同次交運不可重複來源訂單行或交運行');
    ids.add(line.shipmentLineId);
    sourceLines.add(line.salesOrderLineId);
    if (
      new Set(line.packages.map((p) => p.packageId)).size !==
        line.packages.length ||
      line.packages.reduce((sum, p) => sum + p.quantity, 0) !== line.quantity
    )
      throw new BadRequestException('箱明細數量與交運數量不符或箱號重複');
  }
  if (event.lines.reduce((sum, line) => sum + line.quantity, 0) > 50000)
    throw new BadRequestException('交運總數量超過上限');
}

@Injectable()
export class WmsHandoverService {
  constructor(private readonly prisma: PrismaService) {}

  private async lockOrder(
    db: Prisma.TransactionClient,
    entityId: string,
    id: string,
  ) {
    const rows = await db.$queryRaw<
      any[]
    >`SELECT id FROM sales_orders WHERE entity_id=${entityId} AND id=${id} FOR UPDATE`;
    if (!rows.length)
      throw new NotFoundException('銷貨訂單不存在或不屬於此公司');
  }

  /** Validate against the durable, acknowledged native dispatch, never client-provided SKU aliases. */
  private async source(db: Prisma.TransactionClient, event: WmsHandoverDto) {
    const intents = await db.$queryRaw<
      any[]
    >`SELECT payload,response,status FROM wms_dispatch_intents WHERE entity_id=${event.entityId} AND sales_order_id=${event.salesOrderId}`;
    const intent = intents[0],
      p = intent?.payload,
      r = intent?.response;
    if (
      !intent ||
      intent.status !== 'acknowledged' ||
      p?.sourceHash !== event.sourceHash ||
      p?.reservationReference?.salesOrderId !== event.salesOrderId ||
      p.reservationReference.warehouseId !== event.warehouseId ||
      r?.nativeIntakeId !== event.nativeIntakeId ||
      r?.wmsOrderId !== event.wmsOrderId ||
      r?.reservationAccepted !== true
    ) {
      conflict('交運來源尚未確認或與原 WMS 拋單不符');
    }
    await db.$queryRaw`SELECT id FROM sales_order_items WHERE sales_order_id=${event.salesOrderId} ORDER BY id FOR UPDATE`;
    const order = await db.salesOrder.findFirst({
      where: { id: event.salesOrderId, entityId: event.entityId },
      include: { items: { include: { product: true } } },
    });
    if (!order || !['pending', 'partially_shipped'].includes(order.status))
      conflict('銷貨訂單已取消、結案或非待出貨狀態');
    const warehouse = await db.warehouse.findFirst({
      where: {
        id: event.warehouseId,
        entityId: event.entityId,
        isActive: true,
      },
    });
    if (!warehouse) conflict('交運倉庫不屬於此公司或已停用');
    if (!Array.isArray(p.items) || p.items.length !== order!.items.length)
      conflict('訂單明細已異動，請人工核對來源');
    for (const item of order!.items) {
      const original = p.items.find((i: any) => i.id === item.id);
      if (
        !original ||
        original.productId !== item.productId ||
        original.sku !== item.product.sku ||
        !item.qty.equals(original.quantity) ||
        item.product.entityId !== event.entityId ||
        !item.product.isActive ||
        item.product.type !== 'SIMPLE' ||
        item.product.hasSerialNumbers
      )
        conflict('來源訂單行或商品已異動，不可自動核銷');
    }
    const legacyOut = await db.inventoryTransaction.count({
      where: {
        entityId: event.entityId,
        referenceType: 'SALES_ORDER',
        referenceId: event.salesOrderId,
        direction: 'OUT',
      },
    });
    if (legacyOut)
      conflict('此訂單已有舊流程出庫流水，需確認切換對照以免重複扣庫');
    return order!;
  }

  async receive(event: WmsHandoverDto, bodyHash: string) {
    requireHandoverEnabled();
    validateHandoverEvidence(event);
    try {
      return await this.prisma.$transaction(
        async (db) => {
          // Serializes every event for this order, including partial shipments with the same SKU on different lines.
          await this.lockOrder(db, event.entityId, event.salesOrderId);
          const previous = await db.wmsHandoverInbox.findUnique({
            where: {
              entityId_eventId: {
                entityId: event.entityId,
                eventId: event.eventId,
              },
            },
          });
          if (previous) {
            if (previous.bodyHash !== bodyHash)
              conflict('相同事件識別碼帶入不同交運內容');
            return {
              accepted: true,
              eventId: event.eventId,
              inboxId: previous.id,
              duplicate: true,
            };
          }
          const order = await this.source(db, event);
          for (const line of event.lines) {
            const source = order.items.find(
              (i) => i.id === line.salesOrderLineId,
            );
            if (
              !source ||
              source.productId !== line.productId ||
              source.product.sku !== line.sku
            )
              conflict('交運行與來源訂單行／SKU 不符');
            const accepted = await db.shipmentLine.aggregate({
              where: {
                entityId: event.entityId,
                salesOrderLineId: line.salesOrderLineId,
              },
              _sum: { quantity: true },
            });
            if (
              decimal(accepted._sum.quantity || 0)
                .add(line.quantity)
                .gt(source!.qty)
            )
              conflict('累計交運超過此銷貨訂單行數量');
          }
          const shipment = await db.shipment.create({
            data: {
              entityId: event.entityId,
              salesOrderId: event.salesOrderId,
              shipDate: new Date(event.occurredAt),
              status: 'pending_review',
              carrier: event.handover.carrier,
              trackingNo: event.handover.trackingNo,
              notes: 'WMS 已交運，待 ERP 人工核銷',
            },
          });
          const inbox = await db.wmsHandoverInbox.create({
            data: {
              entityId: event.entityId,
              eventId: event.eventId,
              wmsShipmentId: event.shipmentId,
              shipmentId: shipment.id,
              warehouseId: event.warehouseId,
              salesOrderId: event.salesOrderId,
              nativeIntakeId: event.nativeIntakeId,
              wmsOrderId: event.wmsOrderId,
              sourceHash: event.sourceHash,
              bodyHash,
              payload: event as unknown as Prisma.InputJsonValue,
              occurredAt: new Date(event.occurredAt),
              lines: {
                create: event.lines.map((line) => ({
                  entityId: event.entityId,
                  shipmentLineId: line.shipmentLineId,
                  shipmentId: shipment.id,
                  salesOrderLineId: line.salesOrderLineId,
                  productId: line.productId,
                  sku: line.sku,
                  productName: order.items.find(
                    (i) => i.id === line.salesOrderLineId,
                  )!.product.name,
                  quantity: line.quantity,
                  packages: line.packages as unknown as Prisma.InputJsonValue,
                })),
              },
            },
          });
          return {
            accepted: true,
            eventId: event.eventId,
            inboxId: inbox.id,
            duplicate: false,
          };
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        conflict('交運事件、出貨或行識別碼已使用，請核對來源');
      throw error;
    }
  }

  private include = {
    salesOrder: { select: { externalOrderId: true } },
    lines: {
      include: {
        posting: true,
        salesOrderLine: {
          include: { shipmentLines: { include: { posting: true } } },
        },
      },
      orderBy: { id: 'asc' as const },
    },
  };
  private view(row: any) {
    const posted = row.lines.filter((l: any) => !!l.posting).length;
    return {
      id: row.id,
      eventId: row.eventId,
      shipmentId: row.wmsShipmentId,
      salesOrderId: row.salesOrderId,
      orderNumber: row.salesOrder.externalOrderId || row.salesOrderId,
      warehouseId: row.warehouseId,
      nativeIntakeId: row.nativeIntakeId,
      wmsOrderId: row.wmsOrderId,
      sourceHash: row.sourceHash,
      occurredAt: row.occurredAt,
      receivedAt: row.receivedAt,
      status:
        posted === row.lines.length ? 'posted' : posted ? 'partial' : 'pending',
      handover: row.payload.handover,
      lines: row.lines.map((line: any) => ({
        id: line.id,
        shipmentLineId: line.shipmentLineId,
        salesOrderLineId: line.salesOrderLineId,
        productId: line.productId,
        sku: line.sku,
        productName: line.productName,
        quantity: Number(line.quantity),
        orderedQuantity: Number(line.salesOrderLine.qty),
        postedQuantity: line.salesOrderLine.shipmentLines.reduce(
          (n: number, l: any) =>
            n + (l.posting ? Number(l.posting.quantity) : 0),
          0,
        ),
        status: line.posting ? 'posted' : 'pending',
        packages: line.packages,
        ...(line.posting
          ? {
              postedAt: line.posting.postedAt,
              postedBy: line.posting.postedBy,
              unitCostBase: line.posting.unitCostBase.toString(),
              totalCostBase: line.posting.totalCostBase.toString(),
              note: line.posting.note,
            }
          : {}),
      })),
    };
  }
  async list(
    entityId: string,
    status = 'pending',
    page = 1,
    pageSize = 50,
    occurredOn?: string,
    search?: string,
  ) {
    requireHandoverEnabled();
    let occurredAt: { gte: Date; lt: Date } | undefined;
    if (occurredOn) {
      const midnight = new Date(occurredOn + 'T00:00:00+08:00');
      if (
        !Number.isFinite(midnight.getTime()) ||
        new Date(midnight.getTime() + 28800000).toISOString().slice(0, 10) !==
          occurredOn
      )
        throw new BadRequestException('交運日期無效');
      occurredAt = {
        gte: midnight,
        lt: new Date(midnight.getTime() + 86400000),
      };
    }
    const term = search?.trim();
    const where: Prisma.WmsHandoverInboxWhereInput = {
      entityId,
      occurredAt,
      ...(term
        ? {
            OR: [
              {
                salesOrder: {
                  externalOrderId: {
                    contains: term,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                salesOrderId: { contains: term, mode: 'insensitive' as const },
              },
              { eventId: { contains: term, mode: 'insensitive' as const } },
              {
                lines: {
                  some: {
                    sku: { contains: term, mode: 'insensitive' as const },
                  },
                },
              },
            ],
          }
        : {}),
      ...(status === 'pending'
        ? { lines: { some: { posting: null } } }
        : status === 'posted'
          ? { lines: { every: { posting: { isNot: null } } } }
          : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.wmsHandoverInbox.findMany({
        where,
        include: this.include,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.wmsHandoverInbox.count({ where }),
    ]);
    return { items: rows.map((row) => this.view(row)), total, page, pageSize };
  }
  async detail(entityId: string, id: string) {
    requireHandoverEnabled();
    const row = await this.prisma.wmsHandoverInbox.findFirst({
      where: { id, entityId },
      include: this.include,
    });
    if (!row) throw new NotFoundException('找不到此公司的交運紀錄');
    return this.view(row);
  }
  private receipt(lineId: string, posting: any, alreadyPosted: boolean) {
    return {
      lineId,
      status: 'posted',
      alreadyPosted,
      postedAt: posting.postedAt,
      unitCostBase: posting.unitCostBase.toString(),
      totalCostBase: posting.totalCostBase.toString(),
    };
  }

  async post(entityId: string, lineId: string, actorId: string, note?: string) {
    requireHandoverEnabled();
    return this.prisma.$transaction(
      async (db) => {
        const head = await db.shipmentLine.findFirst({
          where: { id: lineId, entityId },
          include: { inbox: true },
        });
        if (!head) throw new NotFoundException('找不到此公司的交運行');
        await this.lockOrder(db, entityId, head.inbox.salesOrderId);
        const line = await db.shipmentLine.findUniqueOrThrow({
          where: { id: lineId },
          include: { posting: true, inbox: true, salesOrderLine: true },
        });
        if (line.posting) return this.receipt(lineId, line.posting, true);
        const event = line.inbox.payload as unknown as WmsHandoverDto;
        const order = await this.source(db, event);
        const accepted = await db.shipmentLine.findMany({
          where: { entityId, salesOrderLineId: line.salesOrderLineId },
          include: { posting: true },
        });
        const acceptedQty = accepted.reduce(
          (n, l) => n.add(l.quantity),
          decimal(0),
        );
        const postedQty = accepted.reduce(
          (n, l) => n.add(l.posting?.quantity || 0),
          decimal(0),
        );
        if (
          acceptedQty.gt(line.salesOrderLine.qty) ||
          postedQty.add(line.quantity).gt(acceptedQty)
        )
          conflict('來源訂單行的交運或核銷累計不符');

        const warehouseId = line.inbox.warehouseId,
          productId = line.productId;
        // Every effect below shares this transaction. Lock the stock row before sampling current cost.
        const locked = await db.$queryRaw<
          any[]
        >`SELECT id FROM inventory_snapshots WHERE entity_id=${entityId} AND warehouse_id=${warehouseId} AND product_id=${productId} FOR UPDATE`;
        if (!locked.length) conflict('此商品尚無倉庫庫存紀錄');
        const stock = await db.inventorySnapshot.findUniqueOrThrow({
          where: {
            entityId_warehouseId_productId: {
              entityId,
              warehouseId,
              productId,
            },
          },
        });
        const movements = await db.inventoryTransaction.findMany({
          where: {
            entityId,
            warehouseId,
            productId,
            referenceType: 'SALES_ORDER',
            referenceId: order.id,
            direction: { in: ['RESERVE', 'RELEASE'] },
          },
        });
        const reserved = movements.reduce(
          (n, m) =>
            m.direction === 'RESERVE' ? n.add(m.quantity) : n.sub(m.quantity),
          decimal(0),
        );
        // The old ledger holds an order/product aggregate. Require its entire
        // remaining hold to match unposted source lines; a manual release cannot
        // silently transfer one line's allocation to another line with the same SKU.
        const productLines = await db.shipmentLine.findMany({
          where: { entityId, productId, inbox: { salesOrderId: order.id } },
          include: { posting: true },
        });
        const originalProductQty = order.items
          .filter((i) => i.productId === productId)
          .reduce((sum, i) => sum.add(i.qty), decimal(0));
        const alreadyPostedProductQty = productLines.reduce(
          (sum, l) => sum.add(l.posting?.quantity || 0),
          decimal(0),
        );
        const expectedReserved = originalProductQty.sub(
          alreadyPostedProductQty,
        );
        if (
          !reserved.equals(expectedReserved) ||
          reserved.lt(line.quantity) ||
          stock.qtyAllocated.lt(line.quantity) ||
          stock.qtyOnHand.lt(line.quantity) ||
          !stock.qtyAvailable.equals(stock.qtyOnHand.sub(stock.qtyAllocated))
        )
          conflict('預留或實體庫存不足，或庫存快照不一致；請先核對差異');
        const product = await db.product.findFirstOrThrow({
          where: { id: productId, entityId },
        });
        const unitCost = decimal(product.movingAverageCost);
        if (unitCost.isNegative()) conflict('商品成本無效');
        const qty = line.quantity,
          now = new Date();
        const release = await db.inventoryTransaction.create({
          data: {
            entityId,
            warehouseId,
            productId,
            direction: 'RELEASE',
            quantity: qty,
            referenceType: 'SALES_ORDER',
            referenceId: order.id,
            reason: `WMS line ${lineId} approved by ${actorId}`,
            occurredAt: now,
          },
        });
        const out = await db.inventoryTransaction.create({
          data: {
            entityId,
            warehouseId,
            productId,
            direction: 'OUT',
            quantity: qty,
            referenceType: 'WMS_SHIPMENT_LINE',
            referenceId: lineId,
            reason: `WMS handover ${line.inbox.eventId}; approved by ${actorId}`,
            occurredAt: now,
          },
        });
        const changed = await db.inventorySnapshot.updateMany({
          where: {
            id: stock.id,
            qtyOnHand: { gte: qty },
            qtyAllocated: { gte: qty },
          },
          data: {
            qtyOnHand: { decrement: qty },
            qtyAllocated: { decrement: qty },
          },
        });
        if (changed.count !== 1) conflict('庫存已異動，未過帳；請重新核對');
        const posting = await db.wmsShipmentPosting.create({
          data: {
            shipmentLineId: lineId,
            quantity: qty,
            unitCostBase: unitCost,
            totalCostBase: unitCost.mul(qty).toDecimalPlaces(2),
            inventoryOutId: out.id,
            inventoryReleaseId: release.id,
            postedBy: actorId,
            postedAt: now,
            note,
          },
        });
        const pendingThisShipment = await db.shipmentLine.count({
          where: { shipmentId: line.shipmentId, posting: null },
        });
        await db.shipment.update({
          where: { id: line.shipmentId },
          data: {
            status: pendingThisShipment ? 'partially_posted' : 'shipped',
          },
        });
        const allLines = await db.shipmentLine.findMany({
          where: { entityId, inbox: { salesOrderId: order.id } },
          include: { posting: true },
        });
        const complete = order.items.every((item) =>
          allLines
            .filter((l) => l.salesOrderLineId === item.id)
            .reduce((n, l) => n.add(l.posting?.quantity || 0), decimal(0))
            .equals(item.qty),
        );
        await db.salesOrder.update({
          where: { id: order.id },
          data: { status: complete ? 'shipped' : 'partially_shipped' },
        });
        return this.receipt(lineId, posting, false);
      },
      { timeout: 15000 },
    );
  }
}
