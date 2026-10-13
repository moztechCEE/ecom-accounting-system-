import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type InventoryTransaction } from '@prisma/client';
import {
  DEPARTMENT_ACCESS_SELECT,
  effectivePermissionKeys,
} from '../../common/department-access/department-access';
import { fingerprint } from './mailroom.contract';

const REFERENCE_TYPE = 'AFTER_SALES_OUTBOUND' as const;
const SCHEMA = 'corely.mailroom.outbound-stock.v1' as const;
const CASE_TYPES = [
  'RESHIPMENT',
  'PRIVATE_PURCHASE',
  'EXCHANGE_RETURN',
] as const;
export type OutboundStockUnitInput = {
  unitId: string;
  sourceCaseItemId: string;
  productId: string;
  warehouseId: string;
  sku: string;
  serialNumber?: string | null;
  quantity: 1;
};
export type OutboundStockIssueInput = {
  actorId: string;
  entityId: string;
  orderId: string;
  requestId: string;
  sourceCaseId: string;
  caseType: (typeof CASE_TYPES)[number];
  items: OutboundStockUnitInput[];
};
export type OutboundStockProof = OutboundStockUnitInput & {
  schema: typeof SCHEMA;
  actorId: string;
  entityId: string;
  orderId: string;
  requestId: string;
  sourceCaseId: string;
  caseType: OutboundStockIssueInput['caseType'];
  postingId: string;
  requestHash: string;
  referenceType: typeof REFERENCE_TYPE;
  externalInventoryPosted: false;
};
export type OutboundStockVerifyInput = Omit<
  OutboundStockIssueInput,
  'actorId' | 'items'
> & {
  items: (OutboundStockUnitInput & { postingId: string } & Partial<
      Omit<OutboundStockProof, keyof OutboundStockUnitInput | 'postingId'>
    >)[];
};
type Batch = Omit<OutboundStockIssueInput, 'actorId'>;
type Metadata = Omit<Batch, 'items'> & {
  schema: typeof SCHEMA;
  actorId: string;
  requestHash: string;
  unit: OutboundStockUnitInput;
  externalInventoryPosted: false;
};
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(value);
const decimal = (value: Prisma.Decimal) => value.isFinite() && value.gte(0);

@Injectable()
export class MailroomOutboundStockService {
  constructor(@Optional() private readonly config?: ConfigService) {}

  private assertLocalPostingAllowed() {
    const required =
      this.config?.get<string>('AFTER_SALES_REQUIRE_EXTERNAL_STOCK') ??
      process.env.AFTER_SALES_REQUIRE_EXTERNAL_STOCK;
    // This boundary only proves local OUT; there is no external confirmation writer.
    if (required === 'true')
      throw new ConflictException(
        '公司要求外部正式庫存確認；本地出庫證明尚未取得外部確認，不能備貨或出貨',
      );
  }

  private normalize(input: Batch): Batch {
    if (
      ![input.entityId, input.orderId, input.sourceCaseId].every(identifier) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.requestId,
      ) ||
      !CASE_TYPES.includes(input.caseType) ||
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 200
    )
      throw new BadRequestException('售後出庫案件或請求識別不完整');
    const units = new Set<string>(),
      serials = new Set<string>();
    const items = input.items
      .map((item) => {
        if (
          ![
            item.unitId,
            item.sourceCaseItemId,
            item.productId,
            item.warehouseId,
          ].every(identifier) ||
          item.quantity !== 1 ||
          typeof item.sku !== 'string' ||
          !item.sku.trim() ||
          item.sku.length > 100 ||
          (item.serialNumber != null &&
            (typeof item.serialNumber !== 'string' ||
              item.serialNumber.length > 100))
        )
          throw new BadRequestException(
            '請逐台確認來源品項、商品、倉庫、SKU、SN及數量一',
          );
        const serialNumber = item.serialNumber?.trim() || null;
        if (
          units.has(item.unitId) ||
          (serialNumber && serials.has(serialNumber))
        )
          throw new BadRequestException('同一出庫不可重複實物或 SN');
        units.add(item.unitId);
        if (serialNumber) serials.add(serialNumber);
        return {
          unitId: item.unitId,
          sourceCaseItemId: item.sourceCaseItemId,
          productId: item.productId,
          warehouseId: item.warehouseId,
          sku: item.sku.trim(),
          serialNumber,
          quantity: 1 as const,
        };
      })
      .sort((a, b) => a.unitId.localeCompare(b.unitId));
    return {
      entityId: input.entityId,
      orderId: input.orderId,
      requestId: input.requestId,
      sourceCaseId: input.sourceCaseId,
      caseType: input.caseType,
      items,
    };
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    actorId: string,
    entityId: string,
  ) {
    if (!identifier(actorId))
      throw new ForbiddenException('請由目前有效的倉務人員備貨出庫');
    const user = await tx.user.findUnique({
      where: { id: actorId },
      include: {
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
        employee: { select: DEPARTMENT_ACCESS_SELECT },
        entityMemberships: true,
      },
    });
    if (
      !user?.isActive ||
      user.mustChangePassword ||
      (user.employee && !user.employee.isActive)
    )
      throw new ForbiddenException('備貨人員帳號已停用或需更新密碼');
    const superAdmin = user.roles.some(
      (row) => row.role.code === 'SUPER_ADMIN',
    );
    const admin =
      superAdmin || user.roles.some((row) => row.role.code === 'ADMIN');
    const company =
      superAdmin ||
      user.employee?.entityId === entityId ||
      user.entityMemberships.some((row) => row.entityId === entityId);
    const grants = effectivePermissionKeys(user);
    if (
      !company ||
      (!superAdmin && user.inventoryDataScope !== 'ENTITY') ||
      !(
        admin ||
        grants.includes('inventory:update') ||
        grants.includes('after_sales_stock:update')
      )
    )
      throw new ForbiddenException('需要此公司的正式庫存更新權限');
  }
  private async rows(tx: Prisma.TransactionClient, batch: Batch) {
    return tx.inventoryTransaction.findMany({
      where: {
        entityId: batch.entityId,
        referenceType: REFERENCE_TYPE,
        OR: [
          { referenceId: batch.orderId },
          {
            reason: {
              contains: `"requestId":${JSON.stringify(batch.requestId)}`,
            },
          },
        ],
      },
    });
  }
  private proof(
    row: InventoryTransaction,
    batch: Batch,
    actorId?: string,
  ): OutboundStockProof {
    let value: Metadata;
    try {
      value = JSON.parse(row.reason || '') as Metadata;
    } catch {
      throw new ConflictException('正式出庫的原始請求證明缺失');
    }
    const item = batch.items.find(
        (unit) => unit.unitId === value?.unit?.unitId,
      ),
      requestHash = fingerprint(batch);
    if (
      !item ||
      value.schema !== SCHEMA ||
      !identifier(value.actorId) ||
      (actorId && value.actorId !== actorId) ||
      value.requestHash !== requestHash ||
      value.externalInventoryPosted !== false ||
      value.entityId !== batch.entityId ||
      value.orderId !== batch.orderId ||
      value.requestId !== batch.requestId ||
      value.sourceCaseId !== batch.sourceCaseId ||
      value.caseType !== batch.caseType ||
      fingerprint(value.unit) !== fingerprint(item) ||
      row.entityId !== batch.entityId ||
      row.productId !== item.productId ||
      row.warehouseId !== item.warehouseId ||
      row.referenceType !== REFERENCE_TYPE ||
      row.referenceId !== batch.orderId ||
      row.direction !== 'OUT' ||
      !row.quantity.isFinite() ||
      !row.quantity.eq(1)
    )
      throw new ConflictException('正式出庫的案件、請求、品項或數量證明不一致');
    return {
      ...item,
      schema: SCHEMA,
      actorId: value.actorId,
      entityId: batch.entityId,
      orderId: batch.orderId,
      requestId: batch.requestId,
      sourceCaseId: batch.sourceCaseId,
      caseType: batch.caseType,
      postingId: row.id,
      requestHash,
      referenceType: REFERENCE_TYPE,
      externalInventoryPosted: false,
    };
  }
  private async verifyRows(
    tx: Prisma.TransactionClient,
    batch: Batch,
    rows: InventoryTransaction[],
    actorId?: string,
  ) {
    if (rows.length !== batch.items.length)
      throw new ConflictException('正式出庫的逐台證明不完整或已變動');
    const proofs = rows.map((row) => this.proof(row, batch, actorId));
    if (
      new Set(proofs.map((proof) => proof.unitId)).size !==
        batch.items.length ||
      new Set(proofs.map((proof) => proof.actorId)).size !== 1
    )
      throw new ConflictException('正式出庫證明有重複實物或不同備貨人員');
    for (const proof of proofs) {
      const product = await tx.product.findFirst({
        where: {
          id: proof.productId,
          entityId: batch.entityId,
          isActive: true,
        },
      });
      const warehouse = await tx.warehouse.findFirst({
        where: {
          id: proof.warehouseId,
          entityId: batch.entityId,
          isActive: true,
        },
      });
      if (
        !product ||
        !warehouse ||
        product.sku !== proof.sku ||
        !['SIMPLE', 'MANUFACTURED'].includes(product.type)
      )
        throw new ConflictException('正式出庫的公司商品、SKU或倉庫已不符');
      if (product.hasSerialNumbers && !proof.serialNumber)
        throw new ConflictException('正式出庫缺少單台 SN');
      if (
        proof.serialNumber &&
        !(await tx.inventorySerialNumber.findFirst({
          where: {
            entityId: batch.entityId,
            productId: proof.productId,
            warehouseId: proof.warehouseId,
            serialNumber: proof.serialNumber,
            status: 'SOLD',
            outboundRefType: REFERENCE_TYPE,
            outboundRefId: proof.postingId,
          },
        }))
      )
        throw new ConflictException('正式出庫的 SN 流水證明不符');
    }
    return proofs.sort((a, b) => a.unitId.localeCompare(b.unitId));
  }
  /** The warehouse preparation transaction is the only stock deduction boundary. */
  async issue(
    tx: Prisma.TransactionClient,
    input: OutboundStockIssueInput,
  ): Promise<{ items: OutboundStockProof[]; duplicate: boolean }> {
    const batch = this.normalize(input);
    this.assertLocalPostingAllowed();
    await this.authorize(tx, input.actorId, batch.entityId);
    for (const key of [
      `${batch.entityId}:outbound-order:${batch.orderId}`,
      `${batch.entityId}:outbound-request:${batch.requestId}`,
    ].sort())
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const previous = await this.rows(tx, batch);
    if (previous.length)
      return {
        items: await this.verifyRows(tx, batch, previous, input.actorId),
        duplicate: true,
      };
    const groups = new Map<
      string,
      {
        productId: string;
        warehouseId: string;
        items: OutboundStockUnitInput[];
      }
    >();
    for (const item of batch.items) {
      const key = JSON.stringify([item.productId, item.warehouseId]);
      const group = groups.get(key) || {
        productId: item.productId,
        warehouseId: item.warehouseId,
        items: [],
      };
      group.items.push(item);
      groups.set(key, group);
    }
    const serialIds = new Map<string, string>();
    const ordered = [...groups.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    // Validate every group before any stock mutation; the caller still owns atomic rollback.
    for (const [, group] of ordered) {
      await tx.$queryRaw`SELECT id FROM products WHERE id=${group.productId} AND entity_id=${batch.entityId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM warehouses WHERE id=${group.warehouseId} AND entity_id=${batch.entityId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM inventory_snapshots WHERE entity_id=${batch.entityId} AND product_id=${group.productId} AND warehouse_id=${group.warehouseId} FOR UPDATE`;
      const product = await tx.product.findFirst({
        where: {
          id: group.productId,
          entityId: batch.entityId,
          isActive: true,
        },
      });
      const warehouse = await tx.warehouse.findFirst({
        where: {
          id: group.warehouseId,
          entityId: batch.entityId,
          isActive: true,
        },
      });
      if (
        !product ||
        !warehouse ||
        !['SIMPLE', 'MANUFACTURED'].includes(product.type)
      )
        throw new NotFoundException('公司可出庫的實體商品或倉庫不存在');
      const snapshot = await tx.inventorySnapshot.findUnique({
        where: {
          entityId_warehouseId_productId: {
            entityId: batch.entityId,
            productId: group.productId,
            warehouseId: group.warehouseId,
          },
        },
      });
      const qualified = await tx.afterSalesStockUnit.count({
        where: {
          entityId: batch.entityId,
          productId: group.productId,
          warehouseId: group.warehouseId,
          status: 'QUALIFIED',
        },
      });
      if (
        !snapshot ||
        ![
          snapshot.qtyOnHand,
          snapshot.qtyAvailable,
          snapshot.qtyAllocated,
        ].every(decimal) ||
        !snapshot.qtyAvailable
          .plus(snapshot.qtyAllocated)
          .eq(snapshot.qtyOnHand) ||
        snapshot.qtyOnHand.lt(group.items.length) ||
        snapshot.qtyAvailable.minus(qualified).lt(group.items.length)
      )
        throw new ConflictException('正式可用庫存不足、已預留或庫存餘額不一致');
      for (const item of group.items
        .slice()
        .sort((a, b) =>
          (a.serialNumber || '').localeCompare(b.serialNumber || ''),
        )) {
        if (
          item.sku !== product.sku ||
          (product.hasSerialNumbers && !item.serialNumber)
        )
          throw new ConflictException('商品 SKU不符或有序號商品缺少實際 SN');
        if (!item.serialNumber) continue;
        await tx.$queryRaw`SELECT id FROM inventory_serial_numbers WHERE entity_id=${batch.entityId} AND product_id=${item.productId} AND serial_number=${item.serialNumber} FOR UPDATE`;
        const serial = await tx.inventorySerialNumber.findFirst({
          where: {
            entityId: batch.entityId,
            productId: item.productId,
            warehouseId: item.warehouseId,
            serialNumber: item.serialNumber,
            status: 'AVAILABLE',
            outboundRefId: null,
          },
        });
        if (
          !serial ||
          (await tx.afterSalesStockUnit.count({
            where: {
              inventorySerialId: serial.id,
              status: { in: ['QUALIFIED', 'RESERVED'] },
            },
          }))
        )
          throw new ConflictException(
            'SN不在此公司／商品／倉庫可用庫存，或已屬其他售後預留',
          );
        serialIds.set(item.unitId, serial.id);
      }
    }
    const requestHash = fingerprint(batch),
      result: OutboundStockProof[] = [];
    for (const [, group] of ordered) {
      const update = await tx.inventorySnapshot.updateMany({
        where: {
          entityId: batch.entityId,
          productId: group.productId,
          warehouseId: group.warehouseId,
          qtyOnHand: { gte: group.items.length },
          qtyAvailable: { gte: group.items.length },
        },
        data: {
          qtyOnHand: { decrement: group.items.length },
          qtyAvailable: { decrement: group.items.length },
        },
      });
      if (update.count !== 1)
        throw new ConflictException('正式庫存已改變，整筆備貨出庫須回復');
      for (const item of group.items) {
        const identity = {
          entityId: batch.entityId,
          orderId: batch.orderId,
          requestId: batch.requestId,
          sourceCaseId: batch.sourceCaseId,
          caseType: batch.caseType,
        };
        const metadata: Metadata = {
          ...identity,
          schema: SCHEMA,
          actorId: input.actorId,
          requestHash,
          unit: item,
          externalInventoryPosted: false,
        };
        const row = await tx.inventoryTransaction.create({
          data: {
            entityId: batch.entityId,
            productId: item.productId,
            warehouseId: item.warehouseId,
            direction: 'OUT',
            quantity: 1,
            referenceType: REFERENCE_TYPE,
            referenceId: batch.orderId,
            occurredAt: new Date(),
            reason: JSON.stringify(metadata),
          },
        });
        const serialId = serialIds.get(item.unitId);
        if (
          serialId &&
          (
            await tx.inventorySerialNumber.updateMany({
              where: {
                id: serialId,
                entityId: batch.entityId,
                productId: item.productId,
                warehouseId: item.warehouseId,
                status: 'AVAILABLE',
                outboundRefId: null,
              },
              data: {
                status: 'SOLD',
                outboundRefType: REFERENCE_TYPE,
                outboundRefId: row.id,
              },
            })
          ).count !== 1
        )
          throw new ConflictException('SN狀態已改變，整筆備貨出庫須回復');
        result.push(this.proof(row, batch, input.actorId));
      }
    }
    return {
      items: result.sort((a, b) => a.unitId.localeCompare(b.unitId)),
      duplicate: false,
    };
  }
  /** Mailroom acceptance and carrier dispatch verify the same OUT without any mutation. */
  async verify(
    tx: Prisma.TransactionClient,
    input: OutboundStockVerifyInput,
  ): Promise<OutboundStockProof[]> {
    const batch = this.normalize(input);
    this.assertLocalPostingAllowed();
    const rows = await this.rows(tx, batch);
    const proofs = await this.verifyRows(tx, batch, rows);
    for (const proof of proofs) {
      const expected = input.items.find((item) => item.unitId === proof.unitId);
      const fields = [
        'schema',
        'actorId',
        'entityId',
        'orderId',
        'requestId',
        'sourceCaseId',
        'caseType',
        'requestHash',
        'referenceType',
        'externalInventoryPosted',
      ] as const;
      if (
        !expected ||
        expected.postingId !== proof.postingId ||
        fields.some(
          (key) => expected[key] !== undefined && expected[key] !== proof[key],
        )
      )
        throw new ConflictException('收發物件與原正式出庫回執不一致');
    }
    return proofs;
  }
}
