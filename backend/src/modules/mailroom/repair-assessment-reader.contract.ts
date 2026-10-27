import { ServiceUnavailableException } from '@nestjs/common';

export const ASSESSMENT_READER_SCHEMA =
  'corely.repair.assessment-authority.v1' as const;
export const ASSESSMENT_READER_MAX_ITEMS = 200;
export const ASSESSMENT_READER_MAX_BYTES = 262144;
export const ASSESSMENT_READER_BUDGET_MS = 1000;
export type AssessmentInspectionRef = {
  documentId: string;
  inspectionRevision: number;
  planVersion: number;
  planHash: string;
};
export type AssessmentProposalBinding = {
  eventId: string;
  receiptId: string;
  itemId: string;
  sourceVersion: number;
  planVersion: number;
  planHash: string;
  proposalHash: string;
};
export type AssessmentReviewRef = {
  decision: 'APPROVE';
  inspectionRevision: number;
  planHash: string;
  actionId: string;
  actionVersion: number;
};
export type AssessmentAuthority =
  | {
      state: 'READY';
      policy: 'FAIR_V1';
      conclusion: 'USER_CAUSED';
      review: AssessmentReviewRef;
    }
  | {
      state: 'READY';
      policy: 'FAIR_V1';
      conclusion: 'PRODUCT_FAULT' | 'UNDETERMINED';
      review: null;
    }
  | {
      state: 'READY';
      policy: 'PROVEN_LEGACY_SUBMISSION';
      conclusion: null;
      review: null;
    }
  | {
      state: 'BLOCKED' | 'UNKNOWN';
      policy: null;
      conclusion: null;
      review: null;
    };
export type AssessmentAuthorityItem = {
  itemId: string;
  receiptId: string;
  nativeVersion: number;
  inspectionRef: AssessmentInspectionRef | null;
  proposalBinding: AssessmentProposalBinding | null;
  authority: AssessmentAuthority;
};
export type AssessmentAuthorityResponse = {
  schema: typeof ASSESSMENT_READER_SCHEMA;
  entityId: string;
  sourceCaseId: string;
  sourceNumber: string;
  observedAt: string;
  complete: true;
  itemCount: number;
  items: AssessmentAuthorityItem[];
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= max;
const integer = (v: unknown): v is number =>
  Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 2147483646;
const hash = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v, key));
export function readerUnavailable(): never {
  throw new ServiceUnavailableException(
    'REPAIR_ASSESSMENT_AUTHORITY_UNAVAILABLE',
  );
}
export function validReaderIdentifier(value: unknown): value is string {
  return (
    text(value, 128) &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127 ||
        '/?#'.includes(character),
    )
  );
}
export function validateAssessmentAuthorityResponse(
  value: unknown,
): AssessmentAuthorityResponse {
  if (
    !object(value) ||
    !exact(value, [
      'schema',
      'entityId',
      'sourceCaseId',
      'sourceNumber',
      'observedAt',
      'complete',
      'itemCount',
      'items',
    ]) ||
    value.schema !== ASSESSMENT_READER_SCHEMA ||
    !text(value.entityId, 128) ||
    !validReaderIdentifier(value.sourceCaseId) ||
    !text(value.sourceNumber, 128) ||
    typeof value.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    new Date(value.observedAt).toISOString() !== value.observedAt ||
    value.complete !== true ||
    !Array.isArray(value.items) ||
    !integer(value.itemCount) ||
    value.itemCount > ASSESSMENT_READER_MAX_ITEMS ||
    value.itemCount !== value.items.length
  )
    readerUnavailable();
  const ids = new Set<string>();
  for (const item of value.items) {
    if (
      !object(item) ||
      !exact(item, [
        'itemId',
        'receiptId',
        'nativeVersion',
        'inspectionRef',
        'proposalBinding',
        'authority',
      ]) ||
      !uuid(item.itemId) ||
      ids.has(item.itemId) ||
      !uuid(item.receiptId) ||
      !integer(item.nativeVersion)
    )
      readerUnavailable();
    ids.add(item.itemId);
    const ref = item.inspectionRef,
      binding = item.proposalBinding,
      authority = item.authority;
    if (
      ref !== null &&
      (!object(ref) ||
        !exact(ref, [
          'documentId',
          'inspectionRevision',
          'planVersion',
          'planHash',
        ]) ||
        !text(ref.documentId, 200) ||
        !integer(ref.inspectionRevision) ||
        ref.planVersion !== ref.inspectionRevision ||
        !hash(ref.planHash))
    )
      readerUnavailable();
    if (
      binding !== null &&
      (!object(binding) ||
        !exact(binding, [
          'eventId',
          'receiptId',
          'itemId',
          'sourceVersion',
          'planVersion',
          'planHash',
          'proposalHash',
        ]) ||
        !uuid(binding.eventId) ||
        binding.receiptId !== item.receiptId ||
        binding.itemId !== item.itemId ||
        !integer(binding.sourceVersion) ||
        binding.sourceVersion > item.nativeVersion ||
        !object(ref) ||
        binding.planVersion !== ref.planVersion ||
        binding.planHash !== ref.planHash ||
        !hash(binding.proposalHash))
    )
      readerUnavailable();
    if (
      !object(authority) ||
      !exact(authority, ['state', 'policy', 'conclusion', 'review'])
    )
      readerUnavailable();
    if (authority.state === 'BLOCKED' || authority.state === 'UNKNOWN') {
      if (
        authority.policy !== null ||
        authority.conclusion !== null ||
        authority.review !== null
      )
        readerUnavailable();
      continue;
    }
    if (authority.state !== 'READY' || !object(ref) || !object(binding))
      readerUnavailable();
    if (authority.policy === 'PROVEN_LEGACY_SUBMISSION') {
      if (authority.conclusion !== null || authority.review !== null)
        readerUnavailable();
      continue;
    }
    if (authority.policy !== 'FAIR_V1') readerUnavailable();
    if (
      authority.conclusion === 'PRODUCT_FAULT' ||
      authority.conclusion === 'UNDETERMINED'
    ) {
      if (authority.review !== null) readerUnavailable();
      continue;
    }
    const review = authority.review;
    if (
      authority.conclusion !== 'USER_CAUSED' ||
      !object(review) ||
      !exact(review, [
        'decision',
        'inspectionRevision',
        'planHash',
        'actionId',
        'actionVersion',
      ]) ||
      review.decision !== 'APPROVE' ||
      review.inspectionRevision !== ref.inspectionRevision ||
      review.planHash !== ref.planHash ||
      !uuid(review.actionId) ||
      !integer(review.actionVersion) ||
      review.actionVersion > item.nativeVersion
    )
      readerUnavailable();
  }
  if (
    Buffer.byteLength(JSON.stringify(value), 'utf8') >
    ASSESSMENT_READER_MAX_BYTES
  )
    readerUnavailable();
  return value as unknown as AssessmentAuthorityResponse;
}
