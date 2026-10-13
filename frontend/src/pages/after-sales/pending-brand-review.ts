import type { ConfirmationScope } from './native-communication-model';
export type PendingBrandReview = ConfirmationScope & { schema: 'corely.doa.pending-brand-review.v1'; request: {
  operation: 'BIND_LEGACY_BRAND'; requestId: string; expectedUpdatedAt: string; brand: 'MOZTECH' | 'BONSON' | 'MORITEK' | 'OTHER'; proofReference: string;
} };
export const pendingBrandReviewKey = (scope: ConfirmationScope) => 'corely.doa.pending-brand-review.v1:' + [scope.actorId, scope.entityId, scope.caseId].map(encodeURIComponent).join(':');
export function readPendingBrandReview(storage: Pick<Storage, 'getItem'>, scope: ConfirmationScope): PendingBrandReview | null {
  const raw = storage.getItem(pendingBrandReviewKey(scope)); if (!raw) return null;
  const invalid = () => { throw new Error('待確認品牌紀錄無法讀取，請聯絡管理員'); };
  let value: PendingBrandReview;
  try { value = JSON.parse(raw); } catch { return invalid(); }
  if (raw.length > 4000 || !value || value.schema !== 'corely.doa.pending-brand-review.v1' || Object.keys(value).some(k => !['schema','actorId','entityId','caseId','request'].includes(k))
    || value.actorId !== scope.actorId || value.entityId !== scope.entityId || value.caseId !== scope.caseId || !value.request || Object.keys(value.request).some(k => !['operation','requestId','expectedUpdatedAt','brand','proofReference'].includes(k))) return invalid();
  const r = value.request;
  if (r.operation !== 'BIND_LEGACY_BRAND' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.requestId)
    || !['MOZTECH','BONSON','MORITEK','OTHER'].includes(r.brand) || typeof r.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(r.expectedUpdatedAt))
    || typeof r.proofReference !== 'string' || !r.proofReference.trim() || r.proofReference.length > 1000) return invalid();
  return value;
}
export function savePendingBrandReview(storage: Pick<Storage, 'getItem' | 'setItem'>, value: PendingBrandReview) {
  const prior = readPendingBrandReview(storage, value);
  if (prior && JSON.stringify(prior) !== JSON.stringify(value)) throw new Error('已有品牌確認待核對，請使用原請求重試');
  storage.setItem(pendingBrandReviewKey(value), JSON.stringify(value));
  if (storage.getItem(pendingBrandReviewKey(value)) !== JSON.stringify(value)) throw new Error('品牌確認紀錄未能保留，尚未送出');
}
export function clearPendingBrandReview(storage: Pick<Storage, 'getItem' | 'removeItem'>, value: PendingBrandReview) {
  if (readPendingBrandReview(storage, value)?.request.requestId !== value.request.requestId) throw new Error('品牌確認紀錄已變更');
  storage.removeItem(pendingBrandReviewKey(value));
  if (storage.getItem(pendingBrandReviewKey(value))) throw new Error('品牌確認回執未能核對');
}
