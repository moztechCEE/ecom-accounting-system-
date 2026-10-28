import { BadRequestException } from '@nestjs/common';
import { isRepairWorkbenchItem, STATUS_LABELS } from './mailroom.contract';
import { REPAIR_CASE_CODE } from './repair-lookup.dto';

export const REPAIR_LOOKUP_LIMIT = 200;

export type RepairLookupRow = {
  id: string;
  entityId: string;
  receiptId: string;
  productName: string;
  label: string;
  status: string;
  repairOwnerId: string | null;
  receipt: {
    id: string;
    entityId: string;
    number: string;
    category: string;
    sourceCaseId: string | null;
    sourceNumber: string | null;
    sourceSnapshot: unknown;
  };
};

export type RepairLookupMatch = {
  itemId: string;
  entityId: string;
  productName: string;
  label: string;
  sourceNumber: string;
  receiptNumber: string;
  status: string;
  statusLabel?: string;
};

export type RepairLookupResult = {
  kind: 'MATCH' | 'MULTIPLE' | 'AMBIGUOUS' | 'NOT_FOUND';
  entityId: string;
  matches: RepairLookupMatch[];
  limitExceeded?: true;
};

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export function repairLookupCode(raw: unknown): string {
  if (typeof raw !== 'string')
    throw new BadRequestException('案件編號格式不符');
  const code = raw.trim();
  if (!code || Array.from(code).length > 200 || !REPAIR_CASE_CODE.test(code))
    throw new BadRequestException('案件編號格式不符');
  return code;
}

function caseIdentity(row: RepairLookupRow): string {
  const sourceId = row.receipt.sourceCaseId;
  if (!sourceId) return JSON.stringify(['receipt', row.receiptId]);
  const sourceSync = object(object(row.receipt.sourceSnapshot)?.sourceSync);
  const site =
    typeof sourceSync?.sourceInstance === 'string' &&
    sourceSync.sourceInstance.trim()
      ? sourceSync.sourceInstance
      : null;
  if (!site)
    return JSON.stringify([
      'unrecorded-source-site',
      row.receipt.category,
      sourceId,
      row.receiptId,
    ]);
  return JSON.stringify(['source', row.receipt.category, sourceId, site]);
}

export function repairLookupResult(
  entityId: string,
  code: string,
  rows: readonly RepairLookupRow[],
): RepairLookupResult {
  // The sentinel is never exposed as a complete or uniquely resolved result.
  if (rows.length > REPAIR_LOOKUP_LIMIT)
    return { kind: 'AMBIGUOUS', entityId, matches: [], limitExceeded: true };
  const eligible = rows.filter(
    (row) =>
      row.entityId === entityId &&
      row.receipt.entityId === entityId &&
      row.receiptId === row.receipt.id &&
      row.receipt.sourceNumber === code &&
      isRepairWorkbenchItem(row),
  );
  const matches = eligible.map((row) => ({
    itemId: row.id,
    entityId,
    productName: row.productName,
    label: row.label,
    sourceNumber: code,
    receiptNumber: row.receipt.number,
    status: row.status,
    ...(STATUS_LABELS[row.status]
      ? { statusLabel: STATUS_LABELS[row.status] }
      : {}),
  }));
  if (!matches.length) return { kind: 'NOT_FOUND', entityId, matches };
  if (matches.length === 1) return { kind: 'MATCH', entityId, matches };
  const identities = new Set(eligible.map(caseIdentity));
  return {
    kind: identities.size === 1 ? 'MULTIPLE' : 'AMBIGUOUS',
    entityId,
    matches,
  };
}

export type RepairCustomerContext = {
  state: 'AVAILABLE' | 'NOT_PROVIDED' | 'UNAVAILABLE';
  sourceCaseId?: string;
  sourceNumber?: string;
  customerIssue?: string;
};

export function repairCustomerContext(
  sourceCaseId: string | null | undefined,
  category: string,
  source?: unknown,
): RepairCustomerContext {
  if (!sourceCaseId) return { state: 'NOT_PROVIDED' };
  const current = object(source);
  const unavailable = {
    state: 'UNAVAILABLE' as const,
    sourceCaseId,
  };
  if (current?.id !== sourceCaseId || current.type !== category)
    return unavailable;
  if (
    current.customerIssue !== undefined &&
    current.customerIssue !== null &&
    typeof current.customerIssue !== 'string'
  )
    return unavailable;
  const identity = {
    sourceCaseId,
    ...(typeof current.number === 'string'
      ? { sourceNumber: current.number }
      : {}),
  };
  return typeof current.customerIssue === 'string' &&
    current.customerIssue.trim()
    ? { state: 'AVAILABLE', ...identity, customerIssue: current.customerIssue }
    : { state: 'NOT_PROVIDED', ...identity };
}
