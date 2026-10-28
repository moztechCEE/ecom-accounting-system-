import { parsePhysicalItemScan } from '../../utils/mailroom-item-link';
import type { RepairCaseLookupResult } from '../../services/repair';

export type RepairScanTarget = { itemId:string; entityId:string };
export type RepairScanInput = { kind:'ITEM'; target:RepairScanTarget } | { kind:'CASE'; code:string } | { kind:'INVALID' };
const CASE_CODE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,199}$/u;
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function repairScanInput(raw:string,origin:string,entityId:string):RepairScanInput {
  const target = parsePhysicalItemScan(raw,origin,entityId);
  if (target) return {kind:'ITEM',target:{itemId:target.itemId,entityId:target.entityId}};
  const code = raw.trim();
  return code.length <= 200 && CASE_CODE.test(code) ? {kind:'CASE',code} : {kind:'INVALID'};
}

export function isRepairCaseLookupResult(value:unknown,entityId:string):value is RepairCaseLookupResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RepairCaseLookupResult>;
  if (result.entityId !== entityId || !['MATCH','NOT_FOUND','MULTIPLE','AMBIGUOUS'].includes(result.kind || '') || !Array.isArray(result.matches)) return false;
  if (result.limitExceeded !== undefined && result.limitExceeded !== true) return false;
  if (result.matches.length > 200) return false;
  if (result.limitExceeded && (result.kind !== 'AMBIGUOUS' || result.matches.length !== 0)) return false;
  if (result.kind === 'MATCH' && result.matches.length !== 1) return false;
  if (result.kind === 'NOT_FOUND' && result.matches.length !== 0) return false;
  if (result.kind === 'MULTIPLE' && result.matches.length < 2) return false;
  if (result.kind === 'AMBIGUOUS' && !result.limitExceeded && result.matches.length === 0) return false;
  const ids = new Set<string>();
  return result.matches.every(match => {
    if (!match || match.entityId !== entityId || !ITEM_ID.test(match.itemId) || ids.has(match.itemId)) return false;
    ids.add(match.itemId);
    return ['productName','label','sourceNumber','receiptNumber','status'].every(key => typeof match[key as keyof typeof match] === 'string')
      && (match.statusLabel === undefined || typeof match.statusLabel === 'string');
  });
}
