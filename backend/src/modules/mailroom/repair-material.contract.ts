import { BadRequestException, ConflictException } from '@nestjs/common';

export type RepairMaterialRequirement = {
  id: string;
  productId: string;
  warehouseId: string;
  sku?: string;
  name?: string;
  requiredQuantity: string;
  requiredForStart: boolean;
};
export type RepairMaterialPlan = {
  mode: 'UNASSESSED' | 'NONE' | 'REQUIRED';
  lines: RepairMaterialRequirement[];
};
export type RepairMaterialContext = {
  entityId: string;
  itemId: string;
  inspectionRevision: number;
  planHash: string;
  requiredReceiverId?: string;
};
export type RepairMaterialReceipt = RepairMaterialContext & {
  schema: 1;
  status: 'READY' | 'PARTIAL' | 'UNKNOWN';
  lines: {
    requirementId: string;
    productId: string;
    warehouseId: string;
    allocationId: string;
    allocatedQty: string;
    physicalReceipt:
      | (RepairMaterialContext & {
          id: string;
          status: 'RECEIVED';
          productId: string;
          warehouseId: string;
          quantity: string;
          receivedById: string;
          receivedAt: string;
        })
      | null;
    settlement?: {
      consumedQty: string;
      returnedQty: string;
      outstandingQty: string;
      outTransactionId: string | null;
      releaseTransactionId: string | null;
      returnedById: string | null;
      returnedAt: string | null;
    } | null;
  }[];
};
export type RepairMaterialReadiness = {
  state: 'READY' | 'BLOCKED' | 'UNKNOWN';
  reason:
    | 'NOT_REQUIRED'
    | 'READY'
    | 'UNASSESSED'
    | 'INVALID_PLAN'
    | 'MISSING_RECEIPT'
    | 'RECEIPT_UNKNOWN'
    | 'RECEIVER_UNKNOWN'
    | 'MISSING_SETTLEMENT'
    | 'UNSETTLED_MATERIALS'
    | 'RECEIPT_MISMATCH';
  requiredCount: number;
};

const text = (value: unknown, max = 128): value is string =>
  typeof value === 'string' &&
  value.trim() === value &&
  value.length > 0 &&
  value.length <= max;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Canonical input accepts at most two decimals. It never rounds an unsupported quantity. */
function quantityCents(value: unknown, allowZero = false): number {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value)
  )
    throw new BadRequestException('材料數量須為最多兩位小數的字串');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 0 || (!allowZero && cents === 0) || cents > 10_000_000)
    throw new BadRequestException('材料數量須大於零且不超過 100,000');
  return cents;
}
export function materialQuantityCents(value: unknown): number {
  return quantityCents(value);
}

export function validateMaterialPlan(
  value: unknown,
  allowUnassessed = false,
): RepairMaterialPlan {
  if (
    !object(value) ||
    typeof value.mode !== 'string' ||
    !['UNASSESSED', 'NONE', 'REQUIRED'].includes(value.mode) ||
    !Array.isArray(value.lines) ||
    value.lines.length > 50
  )
    throw new BadRequestException('請確認材料需求');
  if (value.mode !== 'REQUIRED') {
    if (value.lines.length)
      throw new BadRequestException('無需材料或待確認時不可保留材料清單');
    if (value.mode === 'UNASSESSED' && !allowUnassessed)
      throw new BadRequestException('材料需求尚未確認');
    return value as unknown as RepairMaterialPlan;
  }
  if (!value.lines.length)
    throw new BadRequestException('請至少填寫一項必要材料');
  const keys = new Set<string>();
  for (const row of value.lines) {
    if (
      !object(row) ||
      !text(row.id) ||
      !text(row.productId) ||
      !text(row.warehouseId) ||
      typeof row.requiredForStart !== 'boolean'
    )
      throw new BadRequestException('材料須有品項、倉位與開工需求');
    if (keys.has(row.id))
      throw new BadRequestException('材料需求識別碼不可重複');
    keys.add(row.id);
    materialQuantityCents(row.requiredQuantity);
    if (
      (row.sku !== undefined && !text(row.sku, 100)) ||
      (row.name !== undefined && !text(row.name, 160))
    )
      throw new BadRequestException('材料名稱或 SKU 格式不符');
  }
  return value as unknown as RepairMaterialPlan;
}

const sameContext = (
  proof: Record<string, unknown>,
  context: RepairMaterialContext,
) =>
  proof.entityId === context.entityId &&
  proof.itemId === context.itemId &&
  proof.inspectionRevision === context.inspectionRevision &&
  proof.planHash === context.planHash;

/** receipt must come from the central stock/physical-receipt reader, never a posted client flag. */
export function materialReadiness(
  context: RepairMaterialContext,
  planValue: unknown,
  receipt: unknown,
  stage: 'START' | 'COMPLETION' = 'START',
): RepairMaterialReadiness {
  const result = (
    state: RepairMaterialReadiness['state'],
    reason: RepairMaterialReadiness['reason'],
    requiredCount = 0,
  ): RepairMaterialReadiness => ({ state, reason, requiredCount });
  let plan: RepairMaterialPlan;
  try {
    plan = validateMaterialPlan(planValue, true);
  } catch {
    return result('BLOCKED', 'INVALID_PLAN');
  }
  if (plan.mode === 'UNASSESSED') return result('UNKNOWN', 'UNASSESSED');
  const required = plan.lines.filter(
    (line) => stage === 'COMPLETION' || line.requiredForStart,
  );
  if (plan.mode === 'NONE' || !required.length)
    return result('READY', 'NOT_REQUIRED');
  if (!text(context.requiredReceiverId))
    return result('UNKNOWN', 'RECEIVER_UNKNOWN', required.length);
  if (
    !text(context.entityId) ||
    !text(context.itemId) ||
    !Number.isInteger(context.inspectionRevision) ||
    context.inspectionRevision < 1 ||
    typeof context.planHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(context.planHash)
  )
    return result('BLOCKED', 'RECEIPT_MISMATCH', required.length);
  if (receipt === undefined || receipt === null)
    return result('UNKNOWN', 'MISSING_RECEIPT', required.length);
  if (
    !object(receipt) ||
    receipt.schema !== 1 ||
    !sameContext(receipt, context) ||
    !Array.isArray(receipt.lines)
  )
    return result('BLOCKED', 'RECEIPT_MISMATCH', required.length);
  if (receipt.status === 'UNKNOWN')
    return result('UNKNOWN', 'RECEIPT_UNKNOWN', required.length);
  if (
    receipt.status !== 'READY' &&
    !(stage === 'START' && receipt.status === 'PARTIAL')
  )
    return result('BLOCKED', 'RECEIPT_MISMATCH', required.length);
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of receipt.lines) {
    if (
      !object(row) ||
      !text(row.requirementId) ||
      rows.has(row.requirementId) ||
      !plan.lines.some((line) => line.id === row.requirementId)
    )
      return result('BLOCKED', 'RECEIPT_MISMATCH', required.length);
    rows.set(row.requirementId, row);
  }
  const allocations = new Set<string>(),
    physicalIds = new Set<string>();
  const outIds = new Set<string>(),
    releaseIds = new Set<string>();
  for (const need of required) {
    const row = rows.get(need.id),
      physical = row?.physicalReceipt;
    if (
      !row ||
      row.productId !== need.productId ||
      row.warehouseId !== need.warehouseId ||
      !text(row.allocationId) ||
      allocations.has(row.allocationId) ||
      !object(physical) ||
      !sameContext(physical, context) ||
      !text(physical.id) ||
      physicalIds.has(physical.id) ||
      physical.status !== 'RECEIVED' ||
      physical.productId !== need.productId ||
      physical.warehouseId !== need.warehouseId ||
      !text(physical.receivedById) ||
      physical.receivedById !== context.requiredReceiverId ||
      typeof physical.receivedAt !== 'string' ||
      !Number.isFinite(Date.parse(physical.receivedAt))
    )
      return result('BLOCKED', 'RECEIPT_MISMATCH', required.length);
    try {
      const quantity = materialQuantityCents(need.requiredQuantity);
      if (
        materialQuantityCents(row.allocatedQty) !== quantity ||
        materialQuantityCents(physical.quantity) !== quantity
      )
        return result('BLOCKED', 'RECEIPT_MISMATCH', required.length);
    } catch {
      return result('BLOCKED', 'RECEIPT_MISMATCH', required.length);
    }
    allocations.add(row.allocationId);
    physicalIds.add(physical.id);
    if (stage === 'COMPLETION') {
      const settlement = row.settlement;
      if (!object(settlement))
        return result('UNKNOWN', 'MISSING_SETTLEMENT', required.length);
      try {
        const consumed = quantityCents(settlement.consumedQty, true),
          returned = quantityCents(settlement.returnedQty, true),
          outstanding = quantityCents(settlement.outstandingQty, true);
        if (
          outstanding !== 0 ||
          consumed + returned !==
            materialQuantityCents(need.requiredQuantity) ||
          (consumed > 0
            ? !text(settlement.outTransactionId) ||
              outIds.has(settlement.outTransactionId)
            : settlement.outTransactionId !== null) ||
          (returned > 0
            ? !text(settlement.releaseTransactionId) ||
              releaseIds.has(settlement.releaseTransactionId) ||
              !text(settlement.returnedById) ||
              typeof settlement.returnedAt !== 'string' ||
              !Number.isFinite(Date.parse(settlement.returnedAt))
            : settlement.releaseTransactionId !== null ||
              settlement.returnedById !== null ||
              settlement.returnedAt !== null)
        )
          return result('BLOCKED', 'UNSETTLED_MATERIALS', required.length);
        if (consumed > 0) outIds.add(settlement.outTransactionId as string);
        if (returned > 0)
          releaseIds.add(settlement.releaseTransactionId as string);
      } catch {
        return result('BLOCKED', 'UNSETTLED_MATERIALS', required.length);
      }
    }
  }
  return result('READY', 'READY', required.length);
}

export function requireMaterialReadiness(
  context: RepairMaterialContext,
  plan: unknown,
  receipt: unknown,
  stage: 'START' | 'COMPLETION' = 'START',
) {
  const readiness = materialReadiness(context, plan, receipt, stage);
  if (readiness.state !== 'READY')
    throw new ConflictException('必要材料尚未取得本版備料與實收證明');
  return readiness;
}
