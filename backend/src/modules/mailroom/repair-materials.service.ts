import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  can,
  fingerprint,
  isRepairWorkbenchItem,
  requireEntity,
  requirePermission,
  type Actor,
} from './mailroom.contract';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import {
  inspectionPlanHash,
  validateInspectionSubmission,
} from './repair-document.contract';
import {
  materialQuantityCents,
  materialReadiness,
  validateMaterialPlan,
  type RepairMaterialReceipt,
  type RepairMaterialPlan,
} from './repair-material.contract';
import {
  AllocateRepairMaterialDto,
  PhysicalRepairMaterialDto,
  ReleaseRepairMaterialDto,
  RepairMaterialsCommand,
  RepairMaterialsContextCommand,
} from './repair-materials.dto';
import { repairSourceBindingForItem } from './repair-proposal.contract';
import { requireRefurbishmentWorkStart } from './repair-work-start.contract';
import {
  currentCsrReview,
  repairWorkflow,
  requireSourceConsent,
  requireTechnicianCustody,
} from './repair-workflow.contract';

type Db = Prisma.TransactionClient;
type Item = Prisma.MailroomItemGetPayload<{ include: { receipt: true } }>;
type Action = 'ALLOCATE' | 'RECEIVE' | 'CONSUME' | 'RELEASE';
export type RepairMaterialAllocationRecord = {
  id: string;
  entityId: string;
  itemId: string;
  inspectionRevision: number;
  planHash: string;
  requirementId: string;
  productId: string;
  warehouseId: string;
  requiredQuantity: string;
  allocatedQuantity: string;
  receivedQuantity: string;
  consumedQuantity: string;
  releasedQuantity: string;
  returnedQuantity: string;
  status: 'ALLOCATED' | 'RECEIVED' | 'CONSUMED' | 'RELEASED';
  activeKey: string | null;
  version: number;
  allocatedById: string;
  allocatedAt: Date;
  physicalReceiptId: string | null;
  receivedById: string | null;
  receivedAt: Date | null;
  physicalReturnId: string | null;
  returnedById: string | null;
  returnedAt: Date | null;
  returnLocation: string | null;
  consumedById: string | null;
  consumedAt: Date | null;
  releasedById: string | null;
  releasedAt: Date | null;
  reserveTransactionId: string;
  outTransactionId: string | null;
  releaseTransactionId: string | null;
  costStatus: 'UNKNOWN';
  unitCost: null;
  costCurrency: null;
  costSourceReference: null;
  sourceVersion: string | null;
};

// New tables use parameterized SQL until the central schema owner regenerates Prisma.
const allocationColumns = Prisma.sql`
  id, entity_id AS "entityId", item_id AS "itemId",
  inspection_revision AS "inspectionRevision", plan_hash AS "planHash",
  requirement_id AS "requirementId", product_id AS "productId", warehouse_id AS "warehouseId",
  required_quantity::text AS "requiredQuantity", allocated_quantity::text AS "allocatedQuantity",
  received_quantity::text AS "receivedQuantity", consumed_quantity::text AS "consumedQuantity",
  released_quantity::text AS "releasedQuantity", returned_quantity::text AS "returnedQuantity",
  status, active_key AS "activeKey", version, allocated_by_id AS "allocatedById", allocated_at AS "allocatedAt",
  physical_receipt_id AS "physicalReceiptId", received_by_id AS "receivedById", received_at AS "receivedAt",
  physical_return_id AS "physicalReturnId", returned_by_id AS "returnedById", returned_at AS "returnedAt", return_location AS "returnLocation",
  consumed_by_id AS "consumedById", consumed_at AS "consumedAt", released_by_id AS "releasedById", released_at AS "releasedAt",
  reserve_transaction_id AS "reserveTransactionId", out_transaction_id AS "outTransactionId", release_transaction_id AS "releaseTransactionId",
  cost_status AS "costStatus", unit_cost AS "unitCost", cost_currency AS "costCurrency", cost_source_reference AS "costSourceReference", source_version AS "sourceVersion"`;

const decimal = (cents: number) => (cents / 100).toFixed(2);
const cents = (value: unknown): number => {
  const raw = String(value);
  if (/^0(?:\.0{1,2})?$/.test(raw)) return 0;
  return materialQuantityCents(raw);
};
const iso = (value: Date | null) => value?.toISOString() ?? null;

@Injectable()
export class RepairMaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
  ) {}

  private async authorize(
    tx: Db,
    userId: string,
    entityId: string,
    stock: boolean,
    read = false,
  ) {
    const actor = await this.mailroom.actor(userId, tx);
    requireEntity(actor, entityId);
    if (!stock) {
      if (read && can(actor, 'mailroom:review')) return actor;
      if (
        read &&
        can(actor, 'inventory:read') &&
        !can(actor, 'repair_workbench:read')
      ) {
        await this.inventoryScope(tx, userId);
        return actor;
      }
      requirePermission(
        actor,
        'repair_workbench:' + (read ? 'read' : 'update'),
      );
      return actor;
    }
    requirePermission(actor, 'inventory:update');
    await this.inventoryScope(tx, userId);
    return actor;
  }

  private async inventoryScope(tx: Db, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        inventoryDataScope: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    if (
      !user ||
      (!user.roles.some((x) => x.role.code === 'SUPER_ADMIN') &&
        user.inventoryDataScope !== 'ENTITY')
    )
      throw new ForbiddenException('需要此公司完整庫存操作權限');
  }

  private async item(tx: Db, entityId: string, itemId: string, lock = false) {
    if (lock)
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${itemId} AND entity_id=${entityId} FOR UPDATE`,
      );
    const row = await tx.mailroomItem.findUnique({
      where: { id: itemId },
      include: { receipt: true },
    });
    if (!row || row.entityId !== entityId || !isRepairWorkbenchItem(row))
      throw new NotFoundException('找不到維修物件');
    return row;
  }

  private context(item: Item, input: RepairMaterialsContextCommand) {
    const doc = validateInspectionSubmission(item.repairInspection, true);
    if (
      item.version !== input.expectedItemVersion ||
      doc.revision !== input.inspectionRevision ||
      inspectionPlanHash(doc) !== input.planHash
    )
      throw new ConflictException('檢修或物件版本已更新，請重新整理');
    const plan = validateMaterialPlan(doc.data.materialPlan);
    if (plan.mode !== 'REQUIRED')
      throw new ConflictException('目前檢修沒有必要材料');
    return { doc, plan };
  }

  private async technician(tx: Db, actor: Actor, item: Item) {
    requireTechnicianCustody(actor, item);
    if (
      !(await tx.employee.findFirst({
        where: { userId: actor.id, entityId: item.entityId, isActive: true },
        select: { id: true },
      }))
    )
      throw new ForbiddenException('實領與耗用須由此公司現任維修師本人記錄');
  }

  private async allocations(
    tx: Db,
    entityId: string,
    itemId: string,
    id?: string,
    lock = false,
  ) {
    return tx.$queryRaw<RepairMaterialAllocationRecord[]>(Prisma.sql`
      SELECT ${allocationColumns} FROM repair_material_allocations
      WHERE entity_id=${entityId} AND item_id=${itemId} ${id ? Prisma.sql`AND id=${id}` : Prisma.empty}
      ORDER BY allocated_at,id ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  }

  private async allocation(
    tx: Db,
    item: Item,
    input: PhysicalRepairMaterialDto | ReleaseRepairMaterialDto,
  ) {
    const row = (
      await this.allocations(
        tx,
        item.entityId,
        item.id,
        input.allocationId,
        true,
      )
    )[0];
    if (!row) throw new NotFoundException('找不到材料預留');
    if (row.version !== input.expectedAllocationVersion)
      throw new ConflictException('材料紀錄已更新，請重新整理');
    if (row.status === 'RELEASED')
      throw new ConflictException('材料已結清退回');
    await this.verifyLedger(tx, row);
    return row;
  }

  private async verifyLedger(tx: Db, row: RepairMaterialAllocationRecord) {
    if (!this.validPhysicalRow(row))
      throw new ConflictException('材料實領或退回紀錄不完整');
    for (const [id, direction, quantity] of [
      [row.reserveTransactionId, 'RESERVE', row.allocatedQuantity],
      [row.outTransactionId, 'OUT', row.consumedQuantity],
      [row.releaseTransactionId, 'RELEASE', row.releasedQuantity],
    ] as const) {
      if (!id && cents(quantity) === 0) continue;
      const ledger = id
        ? await tx.inventoryTransaction.findUnique({ where: { id } })
        : null;
      if (
        !ledger ||
        ledger.entityId !== row.entityId ||
        ledger.productId !== row.productId ||
        ledger.warehouseId !== row.warehouseId ||
        ledger.direction !== direction ||
        ledger.referenceType !== 'REPAIR_MATERIAL' ||
        ledger.referenceId !== row.id ||
        !new Prisma.Decimal(ledger.quantity).equals(quantity)
      )
        throw new ConflictException('材料流水與預留紀錄不符，請庫存同仁核對');
    }
  }

  private async command<T extends RepairMaterialsCommand>(
    userId: string,
    itemId: string,
    input: T,
    action: Action,
    execute: (
      tx: Db,
      actor: Actor,
      item: Item,
    ) => Promise<RepairMaterialAllocationRecord>,
  ) {
    this.mailroom.enabled();
    const hash = fingerprint({ action, itemId, ...input });
    return this.prisma.$transaction(
      async (tx) => {
        // Serialize even first requests before an operation row exists. Item lock orders all material mutations.
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${fingerprint({ entityId: input.entityId, userId, requestId: input.requestId })},0))`,
        );
        const item = await this.item(tx, input.entityId, itemId, true);
        const actor = await this.authorize(
          tx,
          userId,
          input.entityId,
          action === 'ALLOCATE' || action === 'RELEASE',
        );
        const prior = await tx.$queryRaw<
          Array<{ requestHash: string; result: unknown }>
        >(Prisma.sql`
        SELECT request_hash AS "requestHash",result FROM repair_material_operations
        WHERE entity_id=${input.entityId} AND actor_id=${userId} AND request_id=${input.requestId}`);
        if (prior.length) {
          if (prior[0].requestHash !== hash)
            throw new ConflictException('相同操作識別碼的內容不同');
          return prior[0].result;
        }
        const allocation = await execute(tx, actor, item);
        const result = JSON.parse(
          JSON.stringify({
            allocation,
            ...(await this.projectionForItem(item, tx)),
          }),
        ) as Prisma.InputJsonValue;
        await tx.$executeRaw(Prisma.sql`INSERT INTO repair_material_operations
        (id,entity_id,item_id,allocation_id,actor_id,request_id,request_hash,action,result)
        VALUES (${randomUUID()},${input.entityId},${itemId},${allocation.id},${userId},${input.requestId},${hash},${action},${JSON.stringify(result)}::jsonb)`);
        return result;
      },
      { maxWait: 5000, timeout: 20000 },
    );
  }

  private async stock(
    tx: Db,
    row: Pick<
      RepairMaterialAllocationRecord,
      'entityId' | 'warehouseId' | 'productId'
    >,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM inventory_snapshots WHERE entity_id=${row.entityId} AND warehouse_id=${row.warehouseId} AND product_id=${row.productId} FOR UPDATE`,
    );
    const snapshot = await tx.inventorySnapshot.findUnique({
      where: {
        entityId_warehouseId_productId: {
          entityId: row.entityId,
          warehouseId: row.warehouseId,
          productId: row.productId,
        },
      },
    });
    if (!snapshot) throw new ConflictException('材料庫存尚未建立');
    const onHand = new Prisma.Decimal(snapshot.qtyOnHand),
      allocated = new Prisma.Decimal(snapshot.qtyAllocated),
      available = new Prisma.Decimal(snapshot.qtyAvailable);
    if (
      [onHand, allocated, available].some(
        (x) => !x.isFinite() || x.isNegative() || x.decimalPlaces() > 2,
      ) ||
      !available.equals(onHand.minus(allocated)) ||
      allocated.gt(onHand)
    )
      throw new ConflictException('材料庫存數量不一致，請庫存同仁核對');
    return { snapshot, onHand, allocated, available };
  }

  private async changeStock(
    tx: Db,
    row: Pick<
      RepairMaterialAllocationRecord,
      'entityId' | 'warehouseId' | 'productId'
    >,
    action: Action,
    qty: number,
  ) {
    const { snapshot, onHand, allocated, available } = await this.stock(
      tx,
      row,
    );
    const quantity = new Prisma.Decimal(decimal(qty));
    if (
      (action === 'ALLOCATE' && available.lt(quantity)) ||
      (action !== 'ALLOCATE' && allocated.lt(quantity)) ||
      (action === 'CONSUME' && onHand.lt(quantity))
    )
      throw new ConflictException('材料可用或預留庫存不足');
    const newHand = onHand.minus(action === 'CONSUME' ? quantity : 0);
    const newAllocated =
      action === 'ALLOCATE'
        ? allocated.plus(quantity)
        : allocated.minus(quantity);
    const updated = await tx.inventorySnapshot.updateMany({
      where: {
        id: snapshot.id,
        qtyOnHand: snapshot.qtyOnHand,
        qtyAllocated: snapshot.qtyAllocated,
        qtyAvailable: snapshot.qtyAvailable,
      },
      data: {
        qtyOnHand: newHand.toFixed(2),
        qtyAllocated: newAllocated.toFixed(2),
        qtyAvailable: newHand.minus(newAllocated).toFixed(2),
      },
    });
    if (updated.count !== 1)
      throw new ConflictException('材料庫存已更新，請重新整理');
  }

  private async ledger(
    tx: Db,
    row: Pick<
      RepairMaterialAllocationRecord,
      'id' | 'entityId' | 'warehouseId' | 'productId'
    >,
    direction: 'RESERVE' | 'OUT' | 'RELEASE',
    qty: number,
  ) {
    const value = await tx.inventoryTransaction.create({
      data: {
        id: randomUUID(),
        entityId: row.entityId,
        warehouseId: row.warehouseId,
        productId: row.productId,
        direction,
        quantity: decimal(qty),
        referenceType: 'REPAIR_MATERIAL',
        referenceId: row.id,
        reason:
          direction === 'OUT'
            ? '維修材料實際耗用'
            : direction === 'RESERVE'
              ? '維修材料預留'
              : '維修材料餘量結清',
        occurredAt: new Date(),
      },
    });
    return value.id;
  }

  async allocate(
    userId: string,
    itemId: string,
    input: AllocateRepairMaterialDto,
  ) {
    return this.command(
      userId,
      itemId,
      input,
      'ALLOCATE',
      async (tx, actor, item) => {
        const { plan } = this.context(item, input);
        const need = plan.lines.find((x) => x.id === input.requirementId);
        if (!need) throw new ConflictException('材料需求不在目前檢修版本');
        const activeKey = fingerprint({
          entityId: item.entityId,
          itemId,
          inspectionRevision: input.inspectionRevision,
          planHash: input.planHash,
          requirementId: need.id,
        });
        if (
          (await this.allocations(tx, item.entityId, itemId)).some(
            (x) => x.activeKey === activeKey,
          )
        )
          throw new ConflictException('此材料需求已預留或耗用，不能重複分配');
        const [product, warehouse] = await Promise.all([
          tx.product.findFirst({
            where: {
              id: need.productId,
              entityId: item.entityId,
              isActive: true,
            },
          }),
          tx.warehouse.findFirst({
            where: {
              id: need.warehouseId,
              entityId: item.entityId,
              isActive: true,
            },
          }),
        ]);
        if (!product || !warehouse)
          throw new ConflictException('材料或倉位不在此公司可用品項');
        if (product.hasSerialNumbers)
          throw new ConflictException('序號材料須先核定逐件領用流程');
        const qty = materialQuantityCents(need.requiredQuantity);
        const id = randomUUID(),
          now = new Date();
        const stockKey = {
          id,
          entityId: item.entityId,
          productId: need.productId,
          warehouseId: need.warehouseId,
        };
        await this.changeStock(tx, stockKey, 'ALLOCATE', qty);
        const reserve = await this.ledger(tx, stockKey, 'RESERVE', qty);
        await tx.$executeRaw(Prisma.sql`INSERT INTO repair_material_allocations
        (id,entity_id,item_id,inspection_revision,plan_hash,requirement_id,product_id,warehouse_id,required_quantity,allocated_quantity,active_key,allocated_by_id,allocated_at,reserve_transaction_id)
        VALUES (${id},${item.entityId},${itemId},${input.inspectionRevision},${input.planHash},${need.id},${need.productId},${need.warehouseId},${decimal(qty)}::numeric,${decimal(qty)}::numeric,${activeKey},${actor.id},${now},${reserve})`);
        return (await this.allocations(tx, item.entityId, itemId, id))[0];
      },
    );
  }

  private requireCurrentAllocation(
    row: RepairMaterialAllocationRecord,
    input: PhysicalRepairMaterialDto,
    plan: RepairMaterialPlan,
  ) {
    if (
      row.inspectionRevision !== input.inspectionRevision ||
      row.planHash !== input.planHash
    )
      throw new ConflictException('材料預留不是目前檢修版本');
    const need = plan.lines.find((line) => line.id === row.requirementId);
    if (
      !need ||
      need.productId !== row.productId ||
      need.warehouseId !== row.warehouseId ||
      materialQuantityCents(need.requiredQuantity) !==
        cents(row.allocatedQuantity) ||
      row.requiredQuantity !== row.allocatedQuantity
    )
      throw new ConflictException('材料預留與目前需求品項或數量不符');
    if (input.confirmedItems !== true)
      throw new BadRequestException('請本人確認實際材料品项與數量');
  }

  async receive(
    userId: string,
    itemId: string,
    input: PhysicalRepairMaterialDto,
  ) {
    return this.command(
      userId,
      itemId,
      input,
      'RECEIVE',
      async (tx, actor, item) => {
        const { plan } = this.context(item, input);
        await this.technician(tx, actor, item);
        const row = await this.allocation(tx, item, input);
        this.requireCurrentAllocation(row, input, plan);
        if (row.receivedById && row.receivedById !== actor.id)
          throw new ConflictException('材料已由其他維修師領用，須先結清退回');
        const qty = materialQuantityCents(input.quantity),
          total = cents(row.receivedQuantity) + qty;
        if (total > cents(row.allocatedQuantity))
          throw new ConflictException('本次實領超過材料預留量');
        row.receivedQuantity = decimal(total);
        row.physicalReceiptId ??= randomUUID();
        row.receivedById = actor.id;
        row.receivedAt = new Date();
        row.status = row.outTransactionId
          ? 'CONSUMED'
          : total === cents(row.allocatedQuantity)
            ? 'RECEIVED'
            : 'ALLOCATED';
        return this.save(tx, row);
      },
    );
  }

  private async freshFinance(item: Item) {
    if (item.receipt.category === 'RETURN') {
      if (item.status !== 'REFURBISHING')
        throw new ConflictException('公司退貨只可在整新中耗用材料');
      requireRefurbishmentWorkStart(item);
      return null;
    }
    if (item.receipt.category !== 'REPAIR')
      throw new ConflictException('目前物件尚未進入維修耗用階段');
    const doc = currentCsrReview(item),
      workflow = repairWorkflow(item.repairWorkflow);
    const localWork =
      item.status === 'REPAIRING' &&
      ['REPAIR', 'REPLACE'].includes(doc.data.plan);
    const factory = workflow.factory;
    const returnedLocalWork =
      item.status === 'INSPECTING' &&
      doc.data.plan === 'FACTORY' &&
      factory?.stage === 'RETURNED' &&
      factory.physicalCustody === 'TECHNICIAN' &&
      !factory.cancelled &&
      factory.inspectionRevision === doc.revision &&
      factory.planHash === inspectionPlanHash(doc);
    if (!localWork && !returnedLocalWork)
      throw new ConflictException('目前物件尚未進入維修耗用階段');
    if (workflow.csr?.decision !== 'APPROVE')
      throw new ConflictException('目前客服方案尚未放行維修');
    if (!item.receipt.sourceCaseId)
      throw new ConflictException('缺少售後來源案件');
    const sources = (
      await this.sync.cases(item.entityId, '', item.receipt.sourceCaseId)
    ).items;
    const source = sources.length === 1 ? sources[0] : undefined;
    if (
      !source ||
      source.id !== item.receipt.sourceCaseId ||
      source.type !== 'REPAIR' ||
      !source.repairAllowed
    )
      throw new ConflictException('售後同意或財務尚未放行');
    requireSourceConsent(
      source,
      workflow.csr.quoteRevision,
      true,
      repairSourceBindingForItem(item, source),
    );
    return source.version;
  }

  async consume(
    userId: string,
    itemId: string,
    input: PhysicalRepairMaterialDto,
  ) {
    return this.command(
      userId,
      itemId,
      input,
      'CONSUME',
      async (tx, actor, item) => {
        const { plan } = this.context(item, input);
        await this.technician(tx, actor, item);
        const row = await this.allocation(tx, item, input);
        this.requireCurrentAllocation(row, input, plan);
        if (row.receivedById !== actor.id)
          throw new ConflictException('只可耗用本人實領的材料');
        if (row.outTransactionId || cents(row.consumedQuantity))
          throw new ConflictException('此預留已正式耗用，不能重複扣料');
        const qty = materialQuantityCents(input.quantity);
        if (qty > cents(row.receivedQuantity))
          throw new ConflictException('實際耗用超過本人已領材料');
        row.sourceVersion = await this.freshFinance(item);
        await this.changeStock(tx, row, 'CONSUME', qty);
        row.outTransactionId = await this.ledger(tx, row, 'OUT', qty);
        row.consumedQuantity = decimal(qty);
        row.consumedById = actor.id;
        row.consumedAt = new Date();
        row.status = 'CONSUMED';
        return this.save(tx, row);
      },
    );
  }

  async release(
    userId: string,
    itemId: string,
    input: ReleaseRepairMaterialDto,
  ) {
    return this.command(
      userId,
      itemId,
      input,
      'RELEASE',
      async (tx, actor, item) => {
        const row = await this.allocation(tx, item, input);
        const remaining =
          cents(row.allocatedQuantity) - cents(row.consumedQuantity);
        const physicallyReturned =
          cents(row.receivedQuantity) - cents(row.consumedQuantity);
        if (remaining <= 0)
          throw new ConflictException('材料已全數實際耗用，沒有可退餘量');
        if (physicallyReturned > 0) {
          if (
            input.confirmedReturned !== true ||
            typeof input.returnedQuantity !== 'string' ||
            materialQuantityCents(input.returnedQuantity) !==
              physicallyReturned ||
            !input.returnLocation?.trim()
          )
            throw new BadRequestException(
              '請庫存同仁實收全部未用材料並填寫回庫位置',
            );
          row.physicalReturnId = randomUUID();
          row.returnedById = actor.id;
          row.returnedAt = new Date();
          row.returnLocation = input.returnLocation.trim();
        } else if (
          (input.returnedQuantity !== undefined &&
            cents(input.returnedQuantity) !== 0) ||
          input.confirmedReturned === true
        )
          throw new BadRequestException('尚未實領的材料不可記為實物退回');
        await this.changeStock(tx, row, 'RELEASE', remaining);
        row.releaseTransactionId = await this.ledger(
          tx,
          row,
          'RELEASE',
          remaining,
        );
        row.releasedQuantity = decimal(remaining);
        row.returnedQuantity = decimal(physicallyReturned);
        row.releasedById = actor.id;
        row.releasedAt = new Date();
        row.status = 'RELEASED';
        if (!row.outTransactionId) row.activeKey = null;
        return this.save(tx, row);
      },
    );
  }

  private async save(tx: Db, row: RepairMaterialAllocationRecord) {
    const updated =
      await tx.$executeRaw(Prisma.sql`UPDATE repair_material_allocations SET
      received_quantity=${row.receivedQuantity}::numeric, consumed_quantity=${row.consumedQuantity}::numeric,
      released_quantity=${row.releasedQuantity}::numeric, returned_quantity=${row.returnedQuantity}::numeric,
      status=${row.status}, active_key=${row.activeKey}, physical_receipt_id=${row.physicalReceiptId}, received_by_id=${row.receivedById}, received_at=${row.receivedAt},
      physical_return_id=${row.physicalReturnId}, returned_by_id=${row.returnedById}, returned_at=${row.returnedAt}, return_location=${row.returnLocation},
      consumed_by_id=${row.consumedById}, consumed_at=${row.consumedAt}, released_by_id=${row.releasedById}, released_at=${row.releasedAt},
      out_transaction_id=${row.outTransactionId}, release_transaction_id=${row.releaseTransactionId}, source_version=${row.sourceVersion}, version=version+1,updated_at=NOW()
      WHERE id=${row.id} AND entity_id=${row.entityId} AND item_id=${row.itemId} AND version=${row.version}`);
    if (updated !== 1)
      throw new ConflictException('材料紀錄已更新，請重新整理');
    row.version++;
    return row;
  }

  /** Server-only reader: cached/client workflow materialsReceipt is deliberately ignored. */
  async projectionForItem(
    item: Pick<Item, 'id' | 'entityId' | 'repairOwnerId' | 'repairInspection'>,
    tx: Db = this.prisma,
  ) {
    const allocations = await this.allocations(tx, item.entityId, item.id);
    const doc = item.repairInspection as {
      revision?: number;
      data?: { materialPlan?: unknown };
    } | null;
    const revision = doc?.revision ?? 0;
    let planHash = '';
    try {
      planHash = inspectionPlanHash(
        validateInspectionSubmission(item.repairInspection, true),
      );
    } catch {
      /* Historical query remains readable. */
    }
    const context = {
      entityId: item.entityId,
      itemId: item.id,
      inspectionRevision: revision,
      planHash,
      requiredReceiverId: item.repairOwnerId ?? undefined,
    };
    const versionRows = allocations.filter(
      (x) => x.inspectionRevision === revision && x.planHash === planHash,
    );
    const current = versionRows.filter((x) => {
      const siblings = versionRows.filter(
        (other) => other.requirementId === x.requirementId,
      );
      const active = siblings.filter(
        (other) =>
          other.activeKey !== null || cents(other.consumedQuantity) > 0,
      );
      return active.length ? active.includes(x) : siblings.at(-1) === x;
    });
    const transactionIds = allocations.flatMap((x) =>
      [
        x.reserveTransactionId,
        x.outTransactionId,
        x.releaseTransactionId,
      ].filter((id): id is string => !!id),
    );
    const ledgers = transactionIds.length
      ? await tx.inventoryTransaction.findMany({
          where: { id: { in: transactionIds }, entityId: item.entityId },
        })
      : [];
    const validLedger = (
      row: RepairMaterialAllocationRecord,
      id: string | null,
      direction: string,
      qty: number,
    ) => {
      if (!id) return qty === 0;
      const ledger = ledgers.find((x) => x.id === id);
      return (
        !!ledger &&
        ledger.entityId === row.entityId &&
        ledger.productId === row.productId &&
        ledger.warehouseId === row.warehouseId &&
        ledger.direction === direction &&
        ledger.referenceType === 'REPAIR_MATERIAL' &&
        ledger.referenceId === row.id &&
        new Prisma.Decimal(ledger.quantity).equals(decimal(qty))
      );
    };
    const unknown = allocations.some(
      (row) =>
        !this.validPhysicalRow(row) ||
        !validLedger(
          row,
          row.reserveTransactionId,
          'RESERVE',
          cents(row.allocatedQuantity),
        ) ||
        !validLedger(
          row,
          row.outTransactionId,
          'OUT',
          cents(row.consumedQuantity),
        ) ||
        !validLedger(
          row,
          row.releaseTransactionId,
          'RELEASE',
          cents(row.releasedQuantity),
        ),
    );
    // Old-version material responsibility cannot disappear by submitting a new inspection.
    const historicalOutstanding = allocations.some(
      (x) => !current.includes(x) && this.outstanding(x),
    );
    const receipt: RepairMaterialReceipt = {
      schema: 1,
      ...context,
      status: unknown ? 'UNKNOWN' : 'READY',
      lines: current.map((row) => ({
        requirementId: row.requirementId,
        productId: row.productId,
        warehouseId: row.warehouseId,
        allocationId: row.id,
        allocatedQty: row.allocatedQuantity,
        physicalReceipt:
          row.physicalReceiptId && row.receivedById && row.receivedAt
            ? {
                ...context,
                id: row.physicalReceiptId,
                status: 'RECEIVED',
                productId: row.productId,
                warehouseId: row.warehouseId,
                quantity: row.receivedQuantity,
                receivedById: row.receivedById,
                receivedAt: row.receivedAt.toISOString(),
              }
            : null,
        settlement: {
          consumedQty: row.consumedQuantity,
          returnedQty: row.returnedQuantity,
          outstandingQty: decimal(
            cents(row.allocatedQuantity) -
              cents(row.consumedQuantity) -
              cents(row.returnedQuantity),
          ),
          outTransactionId: row.outTransactionId,
          releaseTransactionId: row.releaseTransactionId,
          returnedById: row.returnedById,
          returnedAt: iso(row.returnedAt),
        },
      })),
    };
    let plan;
    try {
      plan = validateMaterialPlan(doc?.data?.materialPlan, true);
    } catch {
      plan = null;
    }
    if (
      !unknown &&
      plan?.mode === 'REQUIRED' &&
      plan.lines.some(
        (need) =>
          !receipt.lines.some(
            (line) =>
              line.requirementId === need.id &&
              line.physicalReceipt?.quantity ===
                decimal(materialQuantityCents(need.requiredQuantity)),
          ),
      )
    )
      receipt.status = 'PARTIAL';
    const completion = historicalOutstanding
      ? {
          state: 'BLOCKED' as const,
          reason: 'UNSETTLED_MATERIALS' as const,
          requiredCount: plan?.lines.length ?? 0,
        }
      : unknown
        ? {
            state: 'UNKNOWN' as const,
            reason: 'RECEIPT_UNKNOWN' as const,
            requiredCount: plan?.lines.length ?? 0,
          }
        : materialReadiness(
            context,
            doc?.data?.materialPlan,
            receipt,
            'COMPLETION',
          );
    return {
      allocations,
      receipt,
      historicalOutstanding,
      start: materialReadiness(
        context,
        doc?.data?.materialPlan,
        receipt,
        'START',
      ),
      completion,
    };
  }

  private outstanding(row: RepairMaterialAllocationRecord) {
    return (
      cents(row.allocatedQuantity) >
        cents(row.consumedQuantity) + cents(row.releasedQuantity) ||
      cents(row.receivedQuantity) >
        cents(row.consumedQuantity) + cents(row.returnedQuantity)
    );
  }

  private validPhysicalRow(row: RepairMaterialAllocationRecord) {
    const validTime = (date: Date | null) =>
      !!date &&
      typeof date.getTime === 'function' &&
      Number.isFinite(date.getTime());
    return (
      (cents(row.receivedQuantity) === 0 ||
        (!!row.physicalReceiptId &&
          !!row.receivedById &&
          validTime(row.receivedAt))) &&
      (cents(row.consumedQuantity) === 0 ||
        (!!row.consumedById && validTime(row.consumedAt))) &&
      (cents(row.returnedQuantity) === 0 ||
        (!!row.physicalReturnId &&
          !!row.returnedById &&
          validTime(row.returnedAt) &&
          !!row.returnLocation?.trim()))
    );
  }

  async hasOutstandingForItem(
    entityId: string,
    itemId: string,
    tx: Db = this.prisma,
  ) {
    return (await this.allocations(tx, entityId, itemId)).some((row) =>
      this.outstanding(row),
    );
  }

  async read(userId: string, entityId: string, itemId: string) {
    this.mailroom.enabled();
    return this.prisma.$transaction(async (tx) => {
      await this.authorize(tx, userId, entityId, false, true);
      return this.projectionForItem(
        await this.item(tx, entityId, itemId, true),
        tx,
      );
    });
  }
}
