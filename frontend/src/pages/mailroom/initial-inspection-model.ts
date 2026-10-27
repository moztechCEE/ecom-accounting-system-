export const PRECHECK_RESULTS = { NORMAL: '正常', ABNORMAL: '異常', NOT_TESTED: '未測試', NOT_APPLICABLE: '不適用' } as const;
export type PrecheckResult = keyof typeof PRECHECK_RESULTS;
export const PRECHECK_STAGES: Record<string, string> = { NOT_STARTED: '待初檢', DRAFT: '初檢草稿', READY: '初檢完成', SUBMITTED: '已交維修部門', STALE: '實物資料已更新' };
export function receivingPrecheckStageLabel(stage: string, itemStatus: string): string {
  if (stage === 'NOT_STARTED' && ['WAITING_RETURN_ACCEPTANCE', 'READY_FOR_DISPATCH', 'DISPATCHED', 'PENDING_WELFARE_STOCK', 'STOCKED'].includes(itemStatus)) return '未留初檢紀錄';
  return PRECHECK_STAGES[stage] || stage;
}
export type PrecheckBinding = { id: string; revision: number; contentHash: string };
export type PrecheckCheck = { key: string; result: PrecheckResult; note?: string; evidenceIndexes?: number[] };
export const WARRANTY_REVIEW_STATUSES = { CHECKED: '已人工核對', NEEDS_CORRECTION: '待修正', CORRECTED_EXTERNALLY: '已於保固後台修正' } as const;
export type WarrantyReviewStatus = keyof typeof WARRANTY_REVIEW_STATUSES;
export type PrecheckSupplementInput = {
  warrantyReview?: { status: WarrantyReviewStatus; note?: string | null; warrantyNumber?: string | null } | null;
  mailroomIssue?: { symptom?: string | null; preliminaryReason?: string | null } | null;
};
export type PrecheckSummary = { stage: string; revision: number; savedById: string | null; savedByName: string | null; savedAt: string | null; submittedAt?: string | null };
export type PrecheckDocument = {
  contentHash?: string; revision: number; status: 'DRAFT' | 'READY' | 'SUBMITTED'; identityHash: string;
  templateBinding: PrecheckBinding | null; checks: PrecheckCheck[]; evidence: string[]; notRequiredReason: string | null;
  savedById: string; savedByName: string; savedAt: string;
  warrantyReview?: { schema: 1; method: 'MANUAL_EXTERNAL'; status: WarrantyReviewStatus; note: string | null; warrantyNumber?: string | null; recordedById: string; recordedByName: string; recordedAt: string } | null;
  mailroomIssue?: { schema: 1; symptom: string | null; preliminaryReason: string | null } | null;
};
export type PrecheckTemplate = PrecheckBinding & { title?: string; productId?: string; sku?: string; checks: { key: string; label: string; required: boolean }[] };
export type PrecheckRead = {
  availableTemplates?: (PrecheckTemplate & { title: string })[]; selectedTemplate?: PrecheckTemplate | null;
  itemId: string; itemVersion: number; label: string; category: string; stage: string;
  productName?: string; productId?: string | null; sku?: string | null; serialNumber?: string | null; evidenceThumbnailUrl?: string | null;
  document: PrecheckDocument | null;
  template: { state: 'CONFIGURED' | 'UNCONFIGURED' | 'PRODUCT_UNBOUND'; template: (PrecheckBinding & { checks: { key: string; label: string; required: boolean }[] }) | null; reason: string | null };
  capabilities: { canStart: boolean; canSave: boolean; canMarkReady: boolean; canHandoff: boolean; reason: string | null };
  custody: { custodianId: string; location: string; storageLocationId: string | null };
};
export type PrecheckValues = {
  checks: PrecheckCheck[]; evidence: string[]; notRequiredReason?: string;
  warrantyReview?: { status?: WarrantyReviewStatus; note?: string; warrantyNumber?: string };
  mailroomIssue?: { symptom?: string; preliminaryReason?: string };
};
export function precheckValues(record: PrecheckRead): PrecheckValues {
  const saved = record.document;
  return { checks: record.template.template?.checks.map(check => ({ key: check.key, result: 'NOT_TESTED' as const, ...saved?.checks.find(row => row.key === check.key) })) || [], evidence: saved?.evidence || [], notRequiredReason: saved?.notRequiredReason || undefined,
    warrantyReview: { status: saved?.warrantyReview?.status, note: saved?.warrantyReview?.note || undefined, warrantyNumber: saved?.warrantyReview?.warrantyNumber || undefined },
    mailroomIssue: { symptom: saved?.mailroomIssue?.symptom || undefined, preliminaryReason: saved?.mailroomIssue?.preliminaryReason || undefined },
  };
}
export function precheckSupplementInput(values: PrecheckValues): PrecheckSupplementInput {
  const review = values.warrantyReview, symptom = values.mailroomIssue?.symptom?.trim() || null, preliminaryReason = values.mailroomIssue?.preliminaryReason?.trim() || null;
  return {
    warrantyReview: review?.status ? { status: review.status, note: review.note?.trim() || null, warrantyNumber: review.warrantyNumber?.trim() || null } : null,
    mailroomIssue: symptom || preliminaryReason ? { symptom, preliminaryReason } : null,
  };
}
export function precheckValidation(record: PrecheckRead, values: PrecheckValues, ready: boolean): string | undefined {
  if ((values.warrantyReview?.note?.trim() || values.warrantyReview?.warrantyNumber?.trim()) && !values.warrantyReview?.status) return '請選擇保固核對狀態';
  if (!ready) return;
  for (const check of values.checks) {
    const name = record.template.template?.checks.find(row => row.key === check.key)?.label || check.key;
    if (check.result === 'ABNORMAL' && (!check.note?.trim() || !check.evidenceIndexes?.some(index => !!values.evidence[index]))) return `${name}：異常請補上說明與照片`;
    if (check.result === 'NOT_APPLICABLE' && !check.note?.trim()) return `${name}：請填寫不適用原因`;
  }
  if (record.template.state === 'PRODUCT_UNBOUND') return record.template.reason || '請先核對實物產品';
  const template = record.template.template;
  if (!template && !values.notRequiredReason?.trim()) return '請填寫不需初檢原因';
  if (template?.checks.some(check => check.required && (!values.checks.some(row => row.key === check.key) || values.checks.find(row => row.key === check.key)?.result === 'NOT_TESTED'))) return '必要初檢項目尚未完成，可先儲存草稿';
}

export type PrecheckHandoff = { entityId: string; requestId: string; items: { itemId: string; requestId: string; expectedVersion: number; precheckRevision: number; precheckHash: string; identityHash: string }[] };
export type PrecheckHandoffResult = { batchId: string; requestId: string; notificationRecipientCount: number; items: { itemId: string; requestId: string; status: 'APPLIED' | 'FAILED' | 'UNKNOWN'; duplicate?: boolean; itemVersion?: number; actionId?: string; code?: string; message?: string }[] };
export function precheckHandoffBlocker(records: PrecheckRead[]): string | undefined {
  const pending = records.filter(row => row.document?.status !== 'SUBMITTED');
  if (!pending.length) return '沒有待交辦的實物';
  for (const row of pending) {
    if (row.category !== 'REPAIR') return `${row.label}：退貨檢查仍交客服處理`;
    if (row.document?.status !== 'READY' || row.stage !== 'READY') return `${row.label}：請先完成初檢`;
    if (!row.capabilities.canHandoff) return `${row.label}：${row.capabilities.reason || '目前不能交維修部門'}`;
    if (![row.document.contentHash, row.document.identityHash].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) return `${row.label}：請重新讀取初檢版本`;
  }
}
