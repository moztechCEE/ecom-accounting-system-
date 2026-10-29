import { BadRequestException } from '@nestjs/common';
import { fingerprint } from './mailroom.contract';
import {
  validateMaterialPlan,
  type RepairMaterialPlan,
} from './repair-material.contract';
import type { RepairTemplateBinding } from './repair-template.contract';
import {
  validateInspectionAssessmentShape,
  accidentalDamageFromAssessment,
  type InspectionAssessment,
} from './repair-assessment.contract';

export type RepairDocumentMediaRef = {
  mediaId: string;
  phase: 'BEFORE' | 'AFTER' | 'DIAGNOSTIC';
  checkKey?: string;
};
export type CustomerRepairReportDraft = {
  findings: string;
  handling: string;
  verification: string;
  mediaIds: string[];
};
export type RepairDocumentV2Fields = {
  protocol?: 2;
  isUnderWarranty?: boolean;
  isAccidentalDamage?: boolean;
  customerVisibleSummary?: string;
  templateBinding?: RepairTemplateBinding;
  mediaRefs?: RepairDocumentMediaRef[];
  customerReportDraft?: CustomerRepairReportDraft;
};

export type TestResult = 'PASS' | 'FAIL' | 'NOT_TESTED';
export type RepairCheck = {
  name: string;
  result: TestResult;
  observation: string;
  key?: string;
  measurementValue?: string | boolean;
  unit?: string;
  instrumentId?: string;
  calibrationRecordId?: string;
  measuredAt?: string;
};
export type InspectionData = RepairDocumentV2Fields & {
  assessment?: InspectionAssessment;
  complaint: string;
  reproduction: 'YES' | 'INTERMITTENT' | 'NO' | 'NOT_TESTED';
  testConditions: string;
  checks: RepairCheck[];
  diagnosis: string;
  causeStatus: 'CONFIRMED' | 'SUSPECTED' | 'UNKNOWN';
  plan: 'REPAIR' | 'REPLACE' | 'FACTORY' | 'RETURN' | 'SCRAP';
  planNote: string;
  feeSuggestion: 'FREE' | 'PAID' | 'REVIEW';
  estimateAmount?: number;
  estimateNote: string;
  replacementCondition?: 'NEW' | 'REFURBISHED';
  replacementSku?: string;
  materialPlan?: RepairMaterialPlan;
};
export type RepairData = RepairDocumentV2Fields & {
  outcome: 'REPAIRED' | 'REPLACED' | 'FACTORY_REPAIRED';
  workPerformed: string;
  parts: { name: string; sku: string; quantity: number }[];
  laborMinutes: number;
  checks: RepairCheck[];
  qcResult: TestResult;
  qcNotes: string;
  replacementCondition?: 'NEW' | 'REFURBISHED';
  replacementSku?: string;
  replacementSerial?: string;
  replacementSource?: string;
  originalDisposition?: string;
  inventoryReference?: string;
  factoryReference?: string;
  deliveredAccessories: string;
};
export type RepairDocument<T = InspectionData | RepairData> = {
  number: string;
  revision: number;
  status: 'DRAFT' | 'SUBMITTED';
  authorId: string;
  authorName: string;
  updatedAt: string;
  submittedAt?: string;
  templateBasis?: {
    schema: 1;
    binding: RepairTemplateBinding;
    verifiedAt: string;
  };
  inspectionRevision?: number;
  review?: {
    inspectionRevision: number;
    actorId: string;
    name: string;
    confirmedAt: string;
    decision?: 'APPROVE' | 'DECLINE';
    planHash?: string;
    quoteRevision?: number | null;
  };
  data: T;
};
export type InspectionDocument = RepairDocument<InspectionData>;

/** Only the server writes templateBasis; legacy unverified drafts confer no version authority. */
export function verifiedDocumentTemplateBinding(
  document: unknown,
): RepairTemplateBinding | undefined {
  if (!document || typeof document !== 'object' || Array.isArray(document))
    return undefined;
  const doc = document as RepairDocument;
  const binding = doc.data?.templateBinding;
  if (
    doc.data?.protocol !== 2 ||
    !binding ||
    typeof binding.id !== 'string' ||
    !binding.id.trim() ||
    !Number.isInteger(binding.revision) ||
    binding.revision < 1 ||
    !/^[a-f0-9]{64}$/.test(binding.contentHash)
  )
    return undefined;
  if (doc.status === 'SUBMITTED') return binding;
  const basis = doc.templateBasis;
  if (
    doc.status === 'DRAFT' &&
    basis?.schema === 1 &&
    typeof basis.verifiedAt === 'string' &&
    Number.isFinite(Date.parse(basis.verifiedAt)) &&
    basis.binding?.id === binding.id &&
    basis.binding.revision === binding.revision &&
    basis.binding.contentHash === binding.contentHash
  )
    return binding;
  return undefined;
}

// Estimates and the selected technical plan belong to this exact inspection revision.
export function inspectionPlanHash(doc: InspectionDocument): string {
  return fingerprint({ revision: doc.revision, data: doc.data });
}

const nonempty = (v: unknown) => typeof v === 'string' && !!v.trim();
/** Called by the server for every new submission; historical v1 reads remain intact. */
export function validateDocumentV2(
  value: unknown,
  kind: 'inspection' | 'repair',
) {
  const data = value as InspectionData | RepairData | null;
  if (!data || data.protocol !== 2)
    throw new BadRequestException('請使用目前工作單版本提交');
  for (const key of ['isUnderWarranty', 'isAccidentalDamage'] as const)
    if (data[key] !== undefined && typeof data[key] !== 'boolean')
      throw new BadRequestException('保固與人為損壞判定須明確選擇');
  if (
    data.customerVisibleSummary !== undefined &&
    (typeof data.customerVisibleSummary !== 'string' ||
      data.customerVisibleSummary.length > 2000)
  )
    throw new BadRequestException('顧客摘要格式不符');
  if (
    data.templateBinding !== undefined &&
    (!data.templateBinding ||
      Object.keys(data.templateBinding).some(
        (key) => !['id', 'revision', 'contentHash'].includes(key),
      ) ||
      !nonempty(data.templateBinding.id) ||
      !Number.isInteger(data.templateBinding.revision) ||
      data.templateBinding.revision < 1 ||
      !/^[a-f0-9]{64}$/.test(data.templateBinding.contentHash))
  )
    throw new BadRequestException('檢測基準關聯不完整');
  if (
    !Array.isArray(data.checks) ||
    data.checks.some(
      (check) =>
        check?.measurementValue !== undefined &&
        typeof check.measurementValue !== 'string' &&
        typeof check.measurementValue !== 'boolean',
    )
  )
    throw new BadRequestException('實際量測值格式不符');
  if (
    data.mediaRefs !== undefined &&
    (!Array.isArray(data.mediaRefs) ||
      data.mediaRefs.length > 12 ||
      data.mediaRefs.some(
        (ref) =>
          !ref ||
          Object.keys(ref).some(
            (key) => !['mediaId', 'phase', 'checkKey'].includes(key),
          ) ||
          !nonempty(ref.mediaId) ||
          ref.mediaId.length > 128 ||
          !['BEFORE', 'AFTER', 'DIAGNOSTIC'].includes(ref.phase) ||
          (ref.checkKey !== undefined &&
            (!nonempty(ref.checkKey) ||
              ref.checkKey.length > 128 ||
              !data.checks?.some((check) => check.key === ref.checkKey))),
      ) ||
      new Set(data.mediaRefs.map((ref) => ref.mediaId)).size !==
        data.mediaRefs.length)
  )
    throw new BadRequestException('工作單媒體關聯不完整或重複');
  const draft = data.customerReportDraft;
  if (
    draft !== undefined &&
    (!draft ||
      Object.keys(draft).some(
        (key) =>
          !['findings', 'handling', 'verification', 'mediaIds'].includes(key),
      ) ||
      ![draft.findings, draft.handling, draft.verification].every(
        (text) => typeof text === 'string' && text.length <= 2000,
      ) ||
      !Array.isArray(draft.mediaIds) ||
      draft.mediaIds.length > 12 ||
      draft.mediaIds.some((id) => !nonempty(id) || id.length > 128) ||
      new Set(draft.mediaIds).size !== draft.mediaIds.length ||
      draft.mediaIds.some(
        (id) => !data.mediaRefs?.some((ref) => ref.mediaId === id),
      ))
  )
    throw new BadRequestException('顧客報告草稿或選用媒體不完整');
  if (kind === 'inspection') {
    const inspection = data as InspectionData;
    if (inspection.assessment !== undefined) {
      const assessment = validateInspectionAssessmentShape(
        inspection.assessment,
      );
      const accidental = accidentalDamageFromAssessment(assessment);
      if (
        inspection.isAccidentalDamage !== undefined &&
        inspection.isAccidentalDamage !== accidental
      )
        throw new BadRequestException('人為損壞欄位與本版原因判定不符');
      if (assessment.causalExplanation !== inspection.diagnosis)
        throw new BadRequestException('因果說明與檢修診斷不一致');
    }
    validateMaterialPlan(inspection.materialPlan);
  }
  return data;
}

export type FinalizedRepairMedia = RepairDocumentMediaRef & {
  entityId: string;
  itemId: string;
  kind: 'inspection' | 'repair';
  documentRevision: number;
  status: 'FINALIZED';
  sha256: string;
  contentType: string;
  sizeBytes: number;
};
/** Descriptors are read from the central finalized-media registry, not from the submission body. */
export function validateDocumentMediaReferences(
  refs: RepairDocumentMediaRef[] | undefined,
  context: {
    entityId: string;
    itemId: string;
    kind: 'inspection' | 'repair';
    documentRevision: number;
  },
  finalized: unknown = [],
) {
  if (!refs?.length) return;
  if (!Array.isArray(finalized))
    throw new BadRequestException('工作單媒體尚未確認');
  for (const ref of refs) {
    const matches = finalized.filter(
      (value: FinalizedRepairMedia) => value?.mediaId === ref.mediaId,
    );
    const proof =
      matches.length === 1 ? (matches[0] as FinalizedRepairMedia) : undefined;
    if (
      !proof ||
      proof.status !== 'FINALIZED' ||
      proof.entityId !== context.entityId ||
      proof.itemId !== context.itemId ||
      proof.kind !== context.kind ||
      proof.documentRevision !== context.documentRevision ||
      proof.phase !== ref.phase ||
      proof.checkKey !== ref.checkKey ||
      !/^[a-f0-9]{64}$/.test(proof.sha256) ||
      ![
        'image/png',
        'image/jpeg',
        'image/webp',
        'video/mp4',
        'video/webm',
        'video/quicktime',
      ].includes(proof.contentType) ||
      !Number.isSafeInteger(proof.sizeBytes) ||
      proof.sizeBytes <= 0
    )
      throw new BadRequestException('工作單媒體尚未取得本版確認回執');
  }
}
function assertChecks(checks: RepairCheck[], completion = false) {
  if (!Array.isArray(checks) || !checks.length)
    throw new BadRequestException('請至少填寫一項檢測');
  if (
    checks.some(
      (c) =>
        !c ||
        !nonempty(c.name) ||
        !nonempty(c.observation) ||
        !['PASS', 'FAIL', 'NOT_TESTED'].includes(c.result),
    )
  )
    throw new BadRequestException('請填寫每項測試名稱與結果或未測原因');
  if (completion && checks.some((c) => c.result !== 'PASS'))
    throw new BadRequestException('交付前必要複驗項目須全部通過');
}
export function validateInspectionData(
  data: InspectionData,
  requireReplacementPlan = false,
) {
  if (!data || typeof data !== 'object')
    throw new BadRequestException('缺少檢修資料');
  if (
    ![data.complaint, data.testConditions, data.diagnosis, data.planNote].every(
      nonempty,
    )
  )
    throw new BadRequestException('請完成故障描述、測試條件、診斷與建議方案');
  assertChecks(data.checks);
  if (!['REPAIR', 'REPLACE', 'FACTORY', 'RETURN', 'SCRAP'].includes(data.plan))
    throw new BadRequestException('建議處理方式不符');
  if (
    requireReplacementPlan &&
    data.plan === 'REPLACE' &&
    (!['NEW', 'REFURBISHED'].includes(data.replacementCondition || '') ||
      !nonempty(data.replacementSku))
  )
    throw new BadRequestException(
      '換機方案請先選定替換 SKU 與新品／整新品品況，再交客服確認',
    );
  if (
    data.feeSuggestion === 'PAID' &&
    (!Number.isFinite(data.estimateAmount) ||
      Number(data.estimateAmount) <= 0 ||
      !nonempty(data.estimateNote))
  )
    throw new BadRequestException(
      '付費建議請填寫正數估價與費用項目；對客金額由客服審核',
    );
}
export function validateRepairData(data: RepairData) {
  if (!data || typeof data !== 'object')
    throw new BadRequestException('缺少維修資料');
  if (
    ![data.workPerformed, data.qcNotes, data.deliveredAccessories].every(
      nonempty,
    )
  )
    throw new BadRequestException('請填寫實際處置、複驗說明與交付配件');
  assertChecks(data.checks, data.qcResult === 'PASS');
  if (
    !Array.isArray(data.parts) ||
    data.parts.some(
      (part) =>
        !nonempty(part.name) ||
        !nonempty(part.sku) ||
        !Number.isFinite(part.quantity) ||
        part.quantity <= 0,
    )
  )
    throw new BadRequestException(
      '使用料件請填寫名稱、SKU 與正數數量；未使用請留空清單',
    );
  if (
    data.outcome === 'REPLACED' &&
    (![
      data.replacementSku,
      data.replacementSource,
      data.originalDisposition,
    ].every(nonempty) ||
      !['NEW', 'REFURBISHED'].includes(data.replacementCondition || ''))
  )
    throw new BadRequestException(
      '替換請記錄品況、SKU、來源與原件去向；有序號商品仍須核對 SN',
    );
  if (data.outcome === 'FACTORY_REPAIRED' && !nonempty(data.factoryReference))
    throw new BadRequestException('原廠修復請填寫原廠交辦單號');
}
export function validateInspectionSubmission(
  value: unknown,
  requireReplacementPlan = false,
): InspectionDocument {
  const doc = value as InspectionDocument | null;
  if (!doc || doc.status !== 'SUBMITTED')
    throw new BadRequestException('請先提交本人的檢修單');
  validateInspectionData(doc.data, requireReplacementPlan);
  return doc;
}
export function validateInspectionRelease(value: unknown): InspectionDocument {
  const doc = validateInspectionSubmission(value);
  if (
    doc.review?.inspectionRevision !== doc.revision ||
    doc.review?.decision === 'DECLINE' ||
    (doc.review?.planHash && doc.review.planHash !== inspectionPlanHash(doc))
  )
    throw new BadRequestException('目前檢修方案尚未由客服確認，請先交客服審核');
  return doc;
}
export function validateRepairCompletion(
  inspection: unknown,
  report: unknown,
): RepairDocument<RepairData> {
  const original = validateInspectionSubmission(inspection);
  const doc = report as RepairDocument<RepairData> | null;
  if (!doc || doc.status !== 'SUBMITTED')
    throw new BadRequestException('請先提交維修單');
  if (doc.inspectionRevision !== original.revision)
    throw new BadRequestException('檢修單已改版，請依目前版本重新提交維修單');
  validateRepairData(doc.data);
  if (doc.data.qcResult !== 'PASS')
    throw new BadRequestException('複驗通過後才能交回收發室');
  if (
    !['REPAIR', 'REPLACE'].includes(original.data.plan) ||
    doc.data.outcome === 'FACTORY_REPAIRED' ||
    (original.data.plan === 'REPLACE') !== (doc.data.outcome === 'REPLACED')
  )
    throw new BadRequestException('實際處置與檢修方案不同，請交客服確認變更');
  if (
    original.data.plan === 'REPLACE' &&
    ((original.data.replacementSku &&
      original.data.replacementSku !== doc.data.replacementSku) ||
      (original.data.replacementCondition &&
        original.data.replacementCondition !== doc.data.replacementCondition))
  )
    throw new BadRequestException(
      '替換 SKU／品況與檢修方案不同，請交客服確認變更',
    );
  return doc;
}

export function validateFactoryCompletion(
  inspection: unknown,
  report: unknown,
  reference: string,
): RepairDocument<RepairData> {
  const original = validateInspectionRelease(inspection);
  const doc = report as RepairDocument<RepairData> | null;
  if (!doc || doc.status !== 'SUBMITTED')
    throw new BadRequestException('請先提交原廠返還複驗單');
  if (doc.inspectionRevision !== original.revision)
    throw new BadRequestException('檢修單已改版，請依目前版本重新提交維修單');
  validateRepairData(doc.data);
  if (
    original.data.plan !== 'FACTORY' ||
    doc.data.outcome !== 'FACTORY_REPAIRED' ||
    doc.data.factoryReference?.trim() !== reference ||
    doc.data.qcResult !== 'PASS'
  )
    throw new BadRequestException('原廠單號、方案與返還複驗均確認後才能交回');
  return doc;
}
