import { BadRequestException } from '@nestjs/common';
import { fingerprint } from './mailroom.contract';

export type TestResult = 'PASS' | 'FAIL' | 'NOT_TESTED';
export type RepairCheck = {
  name: string;
  result: TestResult;
  observation: string;
};
export type InspectionData = {
  complaint: string;
  reproduction: 'YES' | 'INTERMITTENT' | 'NO' | 'NOT_TESTED';
  testConditions: string;
  checks: RepairCheck[];
  diagnosis: string;
  causeStatus: 'CONFIRMED' | 'SUSPECTED' | 'UNKNOWN';
  plan: 'REPAIR' | 'REPLACE' | 'FACTORY' | 'RETURN';
  planNote: string;
  feeSuggestion: 'FREE' | 'PAID' | 'REVIEW';
  estimateAmount?: number;
  estimateNote: string;
  replacementCondition?: 'NEW' | 'REFURBISHED';
  replacementSku?: string;
};
export type RepairData = {
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

// Estimates and the selected technical plan belong to this exact inspection revision.
export function inspectionPlanHash(doc: InspectionDocument): string {
  return fingerprint({ revision: doc.revision, data: doc.data });
}

const nonempty = (v: unknown) => typeof v === 'string' && !!v.trim();
function assertChecks(checks: RepairCheck[], completion = false) {
  if (!Array.isArray(checks) || !checks.length)
    throw new BadRequestException('請至少填寫一項檢測');
  if (checks.some((c) => !nonempty(c.name) || !nonempty(c.observation)))
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
