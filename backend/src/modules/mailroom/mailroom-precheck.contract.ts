import { BadRequestException, ConflictException } from '@nestjs/common';
import { fingerprint, validatePhotos } from './mailroom.contract';
import { physicalCustody } from './repair-workflow.contract';
import type { Prisma } from '@prisma/client';
import type {
  PrecheckTemplateBinding,
  PrecheckTemplateResolution,
} from './mailroom-precheck.templates';
import type { PrecheckContext } from './mailroom-precheck-context.contract';

export const PRECHECK_RESULTS = [
  'NORMAL',
  'ABNORMAL',
  'NOT_TESTED',
  'NOT_APPLICABLE',
] as const;
export type PrecheckResult = (typeof PRECHECK_RESULTS)[number];
export type PrecheckCheck = {
  key: string;
  result: PrecheckResult;
  note?: string;
  evidenceIndexes?: number[];
};
export type PrecheckItem = {
  id: string;
  entityId: string;
  receiptId: string;
  label: string;
  version: number;
  status: string;
  productId: string | null;
  productName: string;
  sku: string | null;
  serialNumber: string | null;
  declared: unknown;
  evidence: unknown;
  custodianId: string;
  repairOwnerId: string | null;
  nextUserId: string | null;
  location: string;
  storageLocationId: string | null;
  repairWorkflow: unknown;
  receipt: {
    entityId: string;
    category: string;
    sourceCaseId: string | null;
    sourceNumber?: string | null;
  };
};
export type PrecheckData = PrecheckContext & {
  checks: PrecheckCheck[];
  evidence: string[];
  notRequiredReason: string | null;
};
export type PrecheckDocument = {
  id: string;
  entityId: string;
  itemId: string;
  revision: number;
  status: string;
  identityHash: string;
  template: unknown;
  data: unknown;
  savedById: string;
  savedByName: string;
  savedAt: Date;
  submittedById: string | null;
  submittedAt: Date | null;
};

export function precheckContentHash(doc: PrecheckDocument): string {
  return fingerprint({
    schema: 1,
    entityId: doc.entityId,
    itemId: doc.itemId,
    revision: doc.revision,
    identityHash: doc.identityHash,
    template: doc.template,
    data: doc.data,
  });
}

export type PrecheckHandoffChild = {
  itemId: string;
  requestId: string;
  expectedVersion: number;
  precheckRevision: number;
  precheckHash: string;
  identityHash: string;
};
export type PrecheckHandoffResult = {
  itemId: string;
  requestId: string;
  status: 'APPLIED' | 'FAILED' | 'UNKNOWN';
  duplicate?: boolean;
  itemVersion?: number;
  actionId?: string;
  code?: string;
  message?: string;
};

export function precheckIdentityHash(item: PrecheckItem): string {
  return fingerprint({
    itemId: item.id,
    receiptId: item.receiptId,
    entityId: item.entityId,
    category: item.receipt.category,
    sourceCaseId: item.receipt.sourceCaseId,
    actual: {
      productId: item.productId,
      name: item.productName,
      sku: item.sku,
      serialNumber: item.serialNumber,
    },
    declared: item.declared,
    evidenceDigest: fingerprint(item.evidence ?? []),
  });
}
export function precheckItemBlocker(item: PrecheckItem): string | null {
  if (
    item.receipt.entityId !== item.entityId ||
    !['REPAIR', 'RETURN'].includes(item.receipt.category)
  )
    return '只有售後實物可以初檢';
  if (
    item.status !== 'RECEIVED' ||
    item.repairOwnerId ||
    physicalCustody(item) !== 'MAILROOM'
  )
    return '目前進度不能編輯收發初檢';
  if (!item.receipt.sourceCaseId || !item.declared)
    return '請客服先完成案件與品項配對';
  return null;
}
export function precheckSummary(
  doc: Pick<
    PrecheckDocument,
    | 'revision'
    | 'status'
    | 'identityHash'
    | 'savedById'
    | 'savedByName'
    | 'savedAt'
    | 'submittedAt'
  > | null,
  item: PrecheckItem,
) {
  return {
    stage: !doc
      ? 'NOT_STARTED'
      : doc.identityHash !== precheckIdentityHash(item)
        ? 'STALE'
        : doc.status,
    revision: doc?.revision ?? 0,
    savedById: doc?.savedById ?? null,
    savedByName: doc?.savedByName ?? null,
    savedAt: doc?.savedAt ? new Date(doc.savedAt).toISOString() : null,
    submittedAt: doc?.submittedAt
      ? new Date(doc.submittedAt).toISOString()
      : null,
  };
}
export async function loadPrecheckSummaries(
  db: Pick<Prisma.TransactionClient, 'mailroomPrecheckDocument'>,
  items: PrecheckItem[],
) {
  const native = items.filter((item) =>
    ['REPAIR', 'RETURN'].includes(item.receipt.category),
  );
  if (!native.length)
    return new Map<string, ReturnType<typeof precheckSummary>>();
  const docs = await db.mailroomPrecheckDocument.findMany({
    select: {
      itemId: true,
      revision: true,
      status: true,
      identityHash: true,
      savedById: true,
      savedByName: true,
      savedAt: true,
      submittedAt: true,
    },
    where: {
      OR: native.map((item) => ({ entityId: item.entityId, itemId: item.id })),
    },
  });
  const byItem = new Map(docs.map((doc) => [doc.itemId, doc]));
  return new Map(
    native.map((item) => [
      item.id,
      precheckSummary(byItem.get(item.id) ?? null, item),
    ]),
  );
}
export function requirePrecheckVersion(
  item: PrecheckItem,
  expectedVersion: number,
) {
  if (item.version !== expectedVersion)
    throw new ConflictException('實物資料已更新，請重新整理後操作');
  const blocker = precheckItemBlocker(item);
  if (blocker) throw new ConflictException(blocker);
}
export function validatePrecheckData(
  input: {
    checks: PrecheckCheck[];
    evidence?: string[];
    notRequiredReason?: string;
    templateBinding: PrecheckTemplateBinding | null;
    status: 'DRAFT' | 'READY';
  },
  resolution: PrecheckTemplateResolution,
): PrecheckData {
  if (
    !['DRAFT', 'READY'].includes(input.status) ||
    !Array.isArray(input.checks) ||
    input.checks.length > 40 ||
    input.templateBinding === undefined ||
    (input.evidence !== undefined &&
      (!Array.isArray(input.evidence) ||
        input.evidence.some((value) => typeof value !== 'string')))
  )
    throw new BadRequestException('初檢文件格式不符');
  const evidence = input.evidence ?? [];
  validatePhotos(evidence);
  const template = resolution.template;
  const binding = template
    ? {
        id: template.id,
        revision: template.revision,
        contentHash: template.contentHash,
      }
    : null;
  if (fingerprint(input.templateBinding) !== fingerprint(binding))
    throw new ConflictException('初檢模板已更新，請重新讀取後保存');
  const reason = input.notRequiredReason?.trim() || null;
  if (reason && reason.length > 2000)
    throw new BadRequestException('不需初檢原因過長');
  const seen = new Set<string>();
  const checks = input.checks.map((check) => {
    if (
      !check ||
      typeof check.key !== 'string' ||
      (check.note !== undefined &&
        (typeof check.note !== 'string' || check.note.length > 2000)) ||
      (check.evidenceIndexes !== undefined &&
        !Array.isArray(check.evidenceIndexes))
    )
      throw new BadRequestException('初檢項目格式不符');
    if (
      seen.has(check.key) ||
      !template?.checks.some((c) => c.key === check.key)
    )
      throw new BadRequestException('初檢項目不屬於目前產品模板或重複');
    seen.add(check.key);
    if (!PRECHECK_RESULTS.includes(check.result))
      throw new BadRequestException('初檢結果格式不符');
    const note = check.note?.trim() || '';
    const indexes = check.evidenceIndexes ?? [];
    if (
      indexes.some(
        (index) =>
          !Number.isInteger(index) || index < 0 || index >= evidence.length,
      ) ||
      new Set(indexes).size !== indexes.length
    )
      throw new BadRequestException('初檢照片必須來自這份文件');
    if (
      input.status === 'READY' &&
      check.result === 'ABNORMAL' &&
      (!note || !indexes.length)
    )
      throw new BadRequestException('異常項目請補上說明與本件初檢照片');
    if (input.status === 'READY' && check.result === 'NOT_APPLICABLE' && !note)
      throw new BadRequestException('不適用項目請填寫原因');
    return {
      key: check.key,
      result: check.result,
      note,
      evidenceIndexes: [...indexes],
    };
  });
  if (input.status === 'READY') {
    if (resolution.state === 'PRODUCT_UNBOUND')
      throw new ConflictException(resolution.reason || '請先核對實物產品');
    if (!template && !reason)
      throw new BadRequestException('請明確填寫不需初檢的原因');
    if (template && reason)
      throw new BadRequestException('已設定產品初檢項目，請完成必要檢查');
    if (
      template?.checks.some(
        (required) =>
          required.required &&
          (!checks.some((c) => c.key === required.key) ||
            checks.find((c) => c.key === required.key)!.result ===
              'NOT_TESTED'),
      )
    )
      throw new BadRequestException('必要初檢項目尚未完成，可先保存草稿');
  }
  return { checks, evidence: [...evidence], notRequiredReason: reason };
}
