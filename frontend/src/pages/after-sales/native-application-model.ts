import type { NativeApplication, NativeApplicationRef } from '../../services/native-after-sales.service';
import type { NativeCaseType, NativeCreateValues } from './native-workbench-model';
import { NATIVE_CASE_TYPES } from './native-workbench-model.ts';
export const APPLICATION_STATUS: Record<string, string> = { INVITED: '待顧客填寫', SUBMITTED: '待客服審核', REVIEWED: '已審核，待建單', REJECTED: '已退回', CONVERTED: '已建立案件' };
export type ApplicationDraft = { applicationId: string; type: NativeCaseType; brand: string; verifiedApplicationRef: NativeApplicationRef; values: NativeCreateValues; products: { id: string; name: string; sku: string }[] };
export function applicationDraft(application: NativeApplication): ApplicationDraft {
  const ref = application.verifiedApplicationRef, draft = application.nativeCreateDraft;
  if (application.status !== 'REVIEWED' || application.caseId || !ref || !/^[a-f0-9-]{36}$/i.test(ref.id) || !Number.isInteger(ref.revision) || ref.revision < 1 || ref.id !== application.id || ref.revision !== application.revision || !/^[a-f0-9]{64}$/.test(ref.reviewHash) || !draft?.items.length || !NATIVE_CASE_TYPES.some(t => t.value === draft.type) || draft.items.some(i => !i.productId || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 999))
    throw new Error('申請尚未完成產品審核或已建立案件，請更新申請');
  return { applicationId: application.id, type: draft.type, brand: application.brand, verifiedApplicationRef: ref, products: draft.items.map(item => ({ id: item.productId, name: String((item as any).name || '已審核產品'), sku: String((item as any).sku || '') })),
    values: { brand: application.brand, customerKind: 'TO_C', sourceChannel: draft.sourceChannel || '', contactName: draft.contactName, contactPhone: draft.contactPhone, contactAddress: draft.contactAddress, contactEmail: draft.contactEmail, reason: String(draft.detail?.faultDescription || draft.detail?.issueDescription || draft.detail?.reasonNote || ''), internalNote: draft.internalNote, items: draft.items.map(({ productId, quantity }) => ({ productId, quantity })) },
  };
}
export type ApplicationPending = { schema: 'corely.doa.pending-application.v1'; actorId: string; entityId: string; applicationId: string | null; type: NativeCaseType; command: Record<string, unknown> & { operation: 'CREATE_INVITE' | 'REVIEW'; requestId: string } };
export const applicationPendingKey = (actorId: string, entityId: string) => 'corely.doa.pending-application.v1:' + [actorId, entityId].map(encodeURIComponent).join(':');
export function readApplicationPending(storage: Pick<Storage, 'getItem'>, actorId: string, entityId: string): ApplicationPending | null {
  const raw = storage.getItem(applicationPendingKey(actorId, entityId)); if (!raw) return null;
  const fail = () => { throw new Error('待確認申請操作無法讀取，請聯絡管理員'); };
  let value: ApplicationPending; try { value = JSON.parse(raw); } catch { return fail(); }
  if (raw.length > 20_000 || !value || value.schema !== 'corely.doa.pending-application.v1' || value.actorId !== actorId || value.entityId !== entityId
    || Object.keys(value).some(k => !['schema','actorId','entityId','applicationId','type','command'].includes(k)) || !value.command || !['CREATE_INVITE','REVIEW'].includes(value.command.operation)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.command.requestId)
    || !NATIVE_CASE_TYPES.some(t => t.value === value.type) || value.command.type !== value.type || value.command.operation === 'CREATE_INVITE' && value.applicationId !== null || value.command.operation === 'REVIEW' && !/^[a-f0-9-]{36}$/i.test(value.applicationId || '')) return fail();
  const c = value.command;
  if (c.operation === 'CREATE_INVITE' && (Object.keys(c).some(k => !['operation','requestId','brand','type'].includes(k)) || !['MOZTECH','BONSON'].includes(String(c.brand)))) return fail();
  if (c.operation === 'REVIEW' && (Object.keys(c).some(k => !['operation','requestId','expectedRevision','approve','note','type','profile','items'].includes(k)) || !Number.isInteger(c.expectedRevision) || Number(c.expectedRevision) < 1 || typeof c.approve !== 'boolean' || typeof c.note !== 'string' || !c.note.trim() || c.note.length > 2000 || !c.profile || typeof c.profile !== 'object' || Array.isArray(c.profile) || !Array.isArray(c.items) || c.items.length > 20)) return fail();
  if (c.operation === 'REVIEW') {
    const profile = c.profile as Record<string, unknown>, limits: Record<string, number> = { name: 100, phone: 40, address: 500, email: 254, productDescription: 2000, faultDescription: 4000 };
    if (Object.keys(profile).some(k => !(k in limits)) || Object.entries(limits).some(([k, limit]) => typeof profile[k] !== 'string' || String(profile[k]).length > limit)) return fail();
    if ((c.items as Record<string, unknown>[]).some(i => !i || Object.keys(i).some(k => !['sourceProductId','erpProductId','quantity'].includes(k)) || typeof i.sourceProductId !== 'string' || !i.sourceProductId || i.sourceProductId.length > 128 || !/^[a-f0-9-]{36}$/i.test(String(i.erpProductId)) || !Number.isInteger(i.quantity) || Number(i.quantity) < 1 || Number(i.quantity) > 999)) return fail();
  }
  return value;
}
export function saveApplicationPending(storage: Pick<Storage, 'getItem' | 'setItem'>, value: ApplicationPending) {
  const prior = readApplicationPending(storage, value.actorId, value.entityId);
  if (prior && JSON.stringify(prior) !== JSON.stringify(value)) throw new Error('已有申請操作待確認，請使用原請求重試');
  readApplicationPending({ getItem: () => JSON.stringify(value) }, value.actorId, value.entityId);
  storage.setItem(applicationPendingKey(value.actorId, value.entityId), JSON.stringify(value));
  if (storage.getItem(applicationPendingKey(value.actorId, value.entityId)) !== JSON.stringify(value)) throw new Error('待確認申請紀錄未能保存，尚未送出');
}
export function clearApplicationPending(storage: Pick<Storage, 'getItem' | 'removeItem'>, value: ApplicationPending) {
  if (readApplicationPending(storage, value.actorId, value.entityId)?.command.requestId !== value.command.requestId) throw new Error('申請操作紀錄已變更');
  storage.removeItem(applicationPendingKey(value.actorId, value.entityId));
  if (storage.getItem(applicationPendingKey(value.actorId, value.entityId))) throw new Error('申請回執未能保存');
}
