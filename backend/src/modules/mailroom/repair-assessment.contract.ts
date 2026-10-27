import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type {
  RepairCheck,
  RepairDocumentMediaRef,
} from './repair-document.contract';
import {
  validateRepairTemplate,
  validateTemplateChecks,
  type RepairTemplateContext,
} from './repair-template.contract';

export type InspectionAssessment = {
  schema: 1;
  conclusion: 'USER_CAUSED' | 'PRODUCT_FAULT' | 'UNDETERMINED';
  basis: string;
  causalExplanation: string;
  checkKeys: string[];
  mediaIds: string[];
};

export type InspectionAssessmentContext = {
  causeStatus: unknown;
  checks: unknown;
  mediaRefs?: unknown;
  isAccidentalDamage?: unknown;
  template?: unknown;
  templateContext?: RepairTemplateContext;
  calibrations?: unknown;
  now?: Date;
};

export type AssessmentReview = {
  schema: 1;
  inspectionRevision: number;
  planHash: string;
  reviewerId: string;
  reviewerName: string;
  reviewedAt: string;
  decision: 'APPROVE' | 'REVISE';
  note: string;
};

export type AssessmentReviewContext = {
  entityId: string;
  inspectionRevision: number;
  planHash: string;
  authorId: string;
  repairOwnerId: string;
  reviewer: {
    id: string;
    entityId: string;
    isActiveEmployee: boolean;
    canReview: boolean;
  };
  reviewerEmployeeId?: string;
  authorEmployeeId?: string;
  repairOwnerEmployeeId?: string;
  now?: Date;
};

const assessmentKeys = [
  'schema',
  'conclusion',
  'basis',
  'causalExplanation',
  'checkKeys',
  'mediaIds',
];
const reviewKeys = [
  'schema',
  'inspectionRevision',
  'planHash',
  'reviewerId',
  'reviewerName',
  'reviewedAt',
  'decision',
  'note',
];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 128): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 2147483646;
const exact = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).length === keys.length;
const references = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((id) => text(id)) &&
  new Set(value).size === value.length;

function conclusion(value: unknown): InspectionAssessment['conclusion'] {
  if (
    value !== 'USER_CAUSED' &&
    value !== 'PRODUCT_FAULT' &&
    value !== 'UNDETERMINED'
  )
    throw new BadRequestException('請選擇目前原因判定');
  return value;
}

/** A new form starts unknown; an old false flag never establishes a product fault. */
export function defaultInspectionAssessment(): InspectionAssessment {
  return {
    schema: 1,
    conclusion: 'UNDETERMINED',
    basis: '',
    causalExplanation: '',
    checkKeys: [],
    mediaIds: [],
  };
}

export function accidentalDamageFromAssessment(
  assessment: InspectionAssessment,
): boolean | undefined {
  const value = conclusion(assessment?.conclusion);
  return value === 'UNDETERMINED' ? undefined : value === 'USER_CAUSED';
}

export function requiresAssessmentReview(
  assessment: InspectionAssessment,
): boolean {
  return conclusion(assessment?.conclusion) === 'USER_CAUSED';
}

function selectedChecks(
  keys: string[],
  input: unknown,
  confirmed: boolean,
): RepairCheck[] {
  if (!Array.isArray(input) || input.length > 50)
    throw new BadRequestException('檢驗佐證測項不完整');
  return keys.map((key) => {
    const matches = input.filter((row) => object(row) && row.key === key);
    const row: unknown = matches.length === 1 ? matches[0] : undefined;
    if (
      !object(row) ||
      !text(row.name, 160) ||
      !text(row.observation, 1000) ||
      typeof row.result !== 'string' ||
      !['PASS', 'FAIL', 'NOT_TESTED'].includes(row.result) ||
      (confirmed && row.result === 'NOT_TESTED')
    )
      throw new BadRequestException('原因判定須對應本版實際檢驗測項');
    return row as unknown as RepairCheck;
  });
}

function selectedMedia(
  ids: string[],
  input: unknown,
  checkKeys: string[],
): RepairDocumentMediaRef[] {
  const refs: unknown = input === undefined ? [] : input;
  if (!Array.isArray(refs) || refs.length > 12)
    throw new BadRequestException('原因佐證影像關聯不完整');
  return ids.map((id) => {
    const matches = refs.filter((row) => object(row) && row.mediaId === id);
    const row: unknown = matches.length === 1 ? matches[0] : undefined;
    if (
      !object(row) ||
      typeof row.phase !== 'string' ||
      !['BEFORE', 'AFTER', 'DIAGNOSTIC'].includes(row.phase) ||
      (row.checkKey !== undefined &&
        (!text(row.checkKey) || !checkKeys.includes(row.checkKey)))
    )
      throw new BadRequestException('原因佐證須選用本版檢驗影像');
    return row as unknown as RepairDocumentMediaRef;
  });
}

function hasReviewedMeasurement(
  checks: RepairCheck[],
  context: InspectionAssessmentContext,
): boolean {
  if (!context.template || !context.templateContext) return false;
  const template = validateRepairTemplate(
    context.template,
    context.templateContext,
  );
  const candidates = checks.filter((check) =>
    template.checks.some(
      (spec) =>
        spec.key === check.key &&
        ['NUMBER', 'BOOLEAN'].includes(spec.standard.kind),
    ),
  );
  if (!candidates.length) return false;
  validateTemplateChecks(
    template,
    candidates,
    context.templateContext,
    'RECORD',
    context.calibrations ?? [],
    { now: context.now },
  );
  return true;
}

/** A mandatory new draft shape can remain incomplete; it establishes no cause or approval. */
export function validateInspectionAssessmentShape(
  input: unknown,
): InspectionAssessment {
  if (
    !object(input) ||
    !exact(input, assessmentKeys) ||
    input.schema !== 1 ||
    typeof input.basis !== 'string' ||
    input.basis.length > 2000 ||
    typeof input.causalExplanation !== 'string' ||
    input.causalExplanation.length > 2000 ||
    !references(input.checkKeys, 50) ||
    !references(input.mediaIds, 12)
  )
    throw new BadRequestException('請完成本版檢驗原因判定');
  return {
    schema: 1,
    conclusion: conclusion(input.conclusion),
    basis: input.basis,
    causalExplanation: input.causalExplanation,
    checkKeys: [...input.checkKeys],
    mediaIds: [...input.mediaIds],
  };
}

/**
 * Use only at the new submission boundary, not for reading historical documents.
 * The server must resolve the current registry and validate finalized media with
 * its existing scoped validators. Supplied shapes do not establish DB or GCS authority.
 */
export function validateSubmittedInspectionAssessment(
  input: unknown,
  context: InspectionAssessmentContext,
): InspectionAssessment {
  const assessment = validateInspectionAssessmentShape(input);
  const result = assessment.conclusion;
  const confirmed = result !== 'UNDETERMINED';
  if (
    typeof context.causeStatus !== 'string' ||
    !['CONFIRMED', 'SUSPECTED', 'UNKNOWN'].includes(context.causeStatus) ||
    (confirmed &&
      (context.causeStatus !== 'CONFIRMED' ||
        !text(assessment.basis, 2000) ||
        !text(assessment.causalExplanation, 2000) ||
        !assessment.checkKeys.length))
  )
    throw new BadRequestException('已確認原因須有實際觀察、因果說明與檢驗佐證');
  if (result === 'UNDETERMINED' && context.causeStatus === 'CONFIRMED')
    throw new BadRequestException('原因待確認不能標示原因已確認');
  const checks = selectedChecks(
    assessment.checkKeys,
    context.checks,
    confirmed,
  );
  const media = selectedMedia(
    assessment.mediaIds,
    context.mediaRefs,
    assessment.checkKeys,
  );
  if (
    result === 'USER_CAUSED' &&
    !media.some((ref) => ['BEFORE', 'DIAGNOSTIC'].includes(ref.phase)) &&
    !hasReviewedMeasurement(checks, context)
  )
    throw new BadRequestException(
      '使用或外力因素須有修前、檢測影像或有效量測佐證',
    );
  const compatible = accidentalDamageFromAssessment(assessment);
  if (
    context.isAccidentalDamage !== undefined &&
    (typeof context.isAccidentalDamage !== 'boolean' ||
      context.isAccidentalDamage !== compatible)
  )
    throw new BadRequestException('人為損壞欄位與本版原因判定不符');
  return assessment;
}

function reviewTimestamp(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return NaN;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value ? at : NaN;
}

/** Identity, permissions and employment in this context come from fresh server reads. */
export function validateAssessmentReview(
  input: unknown,
  context: AssessmentReviewContext,
): AssessmentReview {
  const now = context.now ?? new Date();
  if (
    !object(input) ||
    !exact(input, reviewKeys) ||
    input.schema !== 1 ||
    !revision(input.inspectionRevision) ||
    !digest(input.planHash) ||
    !text(input.reviewerId) ||
    !text(input.reviewerName, 160) ||
    !text(input.note, 2000) ||
    typeof input.decision !== 'string' ||
    !['APPROVE', 'REVISE'].includes(input.decision) ||
    !Number.isFinite(reviewTimestamp(input.reviewedAt)) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    reviewTimestamp(input.reviewedAt) > now.getTime() ||
    !revision(context.inspectionRevision) ||
    !digest(context.planHash)
  )
    throw new ConflictException('原因覆核紀錄不完整');
  if (
    input.inspectionRevision !== context.inspectionRevision ||
    input.planHash !== context.planHash
  )
    throw new ConflictException('檢修單已改版，請重新覆核原因判定');
  const reviewer = context.reviewer;
  const employeeIds = [
    context.reviewerEmployeeId,
    context.authorEmployeeId,
    context.repairOwnerEmployeeId,
  ];
  if (
    !text(context.entityId) ||
    !text(context.authorId) ||
    !text(context.repairOwnerId) ||
    !reviewer ||
    !text(reviewer.id) ||
    reviewer.entityId !== context.entityId ||
    reviewer.isActiveEmployee !== true ||
    reviewer.canReview !== true ||
    reviewer.id !== input.reviewerId ||
    employeeIds.some((id) => id !== undefined && !text(id)) ||
    reviewer.id === context.authorId ||
    reviewer.id === context.repairOwnerId ||
    (context.reviewerEmployeeId !== undefined &&
      (context.reviewerEmployeeId === context.authorEmployeeId ||
        context.reviewerEmployeeId === context.repairOwnerEmployeeId))
  )
    throw new ForbiddenException('原因判定須由同公司在職的另一位客服覆核');
  return {
    schema: 1,
    inspectionRevision: input.inspectionRevision,
    planHash: input.planHash,
    reviewerId: input.reviewerId,
    reviewerName: input.reviewerName,
    reviewedAt: input.reviewedAt as string,
    decision: input.decision as AssessmentReview['decision'],
    note: input.note,
  };
}

export function requireApprovedAssessmentReview(
  input: unknown,
  context: AssessmentReviewContext,
): AssessmentReview {
  const review = validateAssessmentReview(input, context);
  if (review.decision !== 'APPROVE')
    throw new ConflictException('本版原因判定尚未覆核通過');
  return review;
}
