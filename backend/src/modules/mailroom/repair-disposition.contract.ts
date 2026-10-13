import { ConflictException } from '@nestjs/common';

export type RepairDispositionDecision = 'RETURN_ORIGINAL' | 'SCRAP';
export type RepairDispositionBinding = {
  itemId: string;
  planVersion: number;
  planHash: string;
  proposalHash: string;
};
export type RepairDispositionProof = {
  schema: 'corely.customer.confirmation.v1';
  id: string;
  revision: number;
  purpose: 'DISPOSITION';
  status: 'APPROVED';
  companyId: string;
  caseId: string;
  brand: string;
  customerId: string;
  customerIdentityId: string;
  identityProvider: 'LINE' | 'DEV_STUB';
  identityVerified: true;
  decision: RepairDispositionDecision;
  binding: RepairDispositionBinding;
  quoteRevision: number;
  submittedAt: string;
  reviewedAt: string;
  reviewedById: string;
  current: true;
  invalidatedAt: null;
  expiresAt?: string | null;
  validUntil?: string | null;
};
export type RepairDispositionExpected = Pick<
  RepairDispositionProof,
  | 'companyId'
  | 'caseId'
  | 'brand'
  | 'customerId'
  | 'customerIdentityId'
  | 'binding'
  | 'quoteRevision'
  | 'decision'
>;
export type RepairDispositionPolicy = {
  allowDevStub: boolean;
  entityId: string;
  now?: Date;
};

const proofKeys = [
  'schema',
  'id',
  'revision',
  'purpose',
  'status',
  'companyId',
  'caseId',
  'brand',
  'customerId',
  'customerIdentityId',
  'identityProvider',
  'identityVerified',
  'decision',
  'binding',
  'quoteRevision',
  'submittedAt',
  'reviewedAt',
  'reviewedById',
  'current',
  'invalidatedAt',
];
const bindingKeys = ['itemId', 'planVersion', 'planHash', 'proposalHash'];
const identityKeys = [
  'companyId',
  'caseId',
  'brand',
  'customerId',
  'customerIdentityId',
] as const;
const devEntity = 'doa-dev-qa-20261002';

function reject(message = '顧客原件處置證據格式不符'): never {
  throw new ConflictException(message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    reject();
  return value;
}
function exact(
  value: Record<string, unknown>,
  keys: string[],
  optional: string[] = [],
) {
  if (
    keys.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !keys.includes(key) && !optional.includes(key),
    )
  )
    reject();
}
function revision(value: unknown, allowZero = false) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 2147483646
  )
    reject();
}
function decision(value: unknown) {
  if (value !== 'RETURN_ORIGINAL' && value !== 'SCRAP') reject();
}
function binding(value: unknown): Record<string, unknown> {
  const result = record(value);
  exact(result, bindingKeys);
  text(result.itemId);
  revision(result.planVersion);
  for (const key of ['planHash', 'proposalHash'])
    if (typeof result[key] !== 'string' || !/^[a-f0-9]{64}$/.test(result[key]))
      reject();
  return result;
}
function timestamp(value: unknown): number {
  const raw = text(value, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw))
    reject();
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) reject();
  const normalized = raw.includes('.')
    ? raw.replace(
        /\.(\d{1,3})Z$/,
        (_, fraction: string) => '.' + fraction.padEnd(3, '0') + 'Z',
      )
    : raw.replace(/Z$/, '.000Z');
  if (new Date(time).toISOString() !== normalized) reject();
  return time;
}

/** Validates customer authorization only. It neither disposes a unit nor grants an operator permission. */
export function requireRepairDispositionProof(
  proofs: unknown,
  expected: RepairDispositionExpected,
  policy: RepairDispositionPolicy,
): RepairDispositionProof {
  const context = record(expected);
  exact(context, [...identityKeys, 'binding', 'quoteRevision', 'decision']);
  for (const key of identityKeys) text(context[key]);
  const expectedBinding = binding(context.binding);
  revision(context.quoteRevision, true);
  decision(context.decision);
  const environment = record(policy);
  exact(environment, ['allowDevStub', 'entityId'], ['now']);
  if (typeof environment.allowDevStub !== 'boolean') reject();
  text(environment.entityId);
  const now = policy.now === undefined ? new Date() : policy.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) reject();
  if (!Array.isArray(proofs) || proofs.length > 200) reject();
  const candidates: Record<string, unknown>[] = [];
  for (const value of proofs) {
    const candidate = record(value);
    const reference = record(candidate.binding);
    if (text(reference.itemId) === expectedBinding.itemId)
      candidates.push(candidate);
  }
  if (candidates.length !== 1) reject('目前原件處置尚未取得唯一顧客授權');
  const proof = candidates[0];
  exact(proof, proofKeys, ['expiresAt', 'validUntil']);
  if (
    proof.schema !== 'corely.customer.confirmation.v1' ||
    proof.purpose !== 'DISPOSITION'
  )
    reject();
  text(proof.id);
  revision(proof.revision);
  for (const key of identityKeys) {
    text(proof[key]);
    if (proof[key] !== context[key]) reject('顧客原件處置授權的案件或身份不符');
  }
  if (
    proof.status !== 'APPROVED' ||
    proof.current !== true ||
    proof.identityVerified !== true ||
    proof.invalidatedAt !== null
  )
    reject('顧客原件處置授權尚未核准或已失效');
  decision(proof.decision);
  if (proof.decision !== context.decision) reject('顧客尚未同意此原件處置方式');
  const currentBinding = binding(proof.binding);
  if (bindingKeys.some((key) => currentBinding[key] !== expectedBinding[key]))
    reject('原件或檢修方案已改版，請重新取得顧客確認');
  revision(proof.quoteRevision, true);
  if (proof.quoteRevision !== context.quoteRevision)
    reject('報價已改版，請重新取得顧客處置確認');
  if (
    proof.identityProvider !== 'LINE' &&
    !(
      proof.identityProvider === 'DEV_STUB' &&
      policy.allowDevStub === true &&
      policy.entityId === devEntity
    )
  )
    reject('此顧客原件處置證據不適用目前環境');
  const submitted = timestamp(proof.submittedAt);
  const reviewed = timestamp(proof.reviewedAt);
  text(proof.reviewedById);
  if (submitted > reviewed || reviewed > now.getTime())
    reject('顧客原件處置授權時間不符');
  if (
    proof.expiresAt !== undefined &&
    proof.expiresAt !== null &&
    timestamp(proof.expiresAt) < submitted
  )
    reject('顧客確認提交期限不符');
  if (
    proof.validUntil !== undefined &&
    proof.validUntil !== null &&
    timestamp(proof.validUntil) <= now.getTime()
  )
    reject('顧客原件處置授權已到期');
  const receipt = structuredClone(proof) as unknown as RepairDispositionProof;
  Object.freeze(receipt.binding);
  return Object.freeze(receipt);
}
