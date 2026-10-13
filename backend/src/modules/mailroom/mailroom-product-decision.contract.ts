import { ConflictException } from '@nestjs/common';
import { fingerprint } from './mailroom.contract';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const digest = /^[0-9a-f]{64}$/;
const caseBrands = ['MOZTECH', 'BONSON', 'WANBO'] as const;
const sandboxEntity = 'doa-dev-qa-20261002';

export type ProductDecisionItem = {
  id: string;
  receiptId: string;
  entityId: string;
  productId?: string | null;
  productName: string;
  sku?: string | null;
  serialNumber?: string | null;
  declared?: unknown;
  evidence?: unknown;
  receipt: {
    id?: string;
    entityId?: string;
    category: string;
    sourceCaseId: string | null;
  };
};

export type CustomerProductDecisionProof = {
  proofId: string;
  purpose: 'PRODUCT';
  status: 'APPROVED';
  itemId: string;
  planVersion: number;
  planHash: string;
  actualIdentityHash: string;
  customerDecision: 'ACCEPT_ACTUAL';
  verifiedCustomerId: string;
  provider: 'LINE' | 'DEV_STUB';
  reviewedById: string;
  reviewedAt: string;
  submittedAt: string;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length <= max && value.trim().length > 0;
const positiveInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  Number(value) > 0 &&
  Number(value) <= 2147483647;
const nullableText = (value: unknown, max: number): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max)
    throw new ConflictException('實收或申報品項資料不完整，請客服重新配對');
  return value;
};

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  if (!match) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const canonical = `${match[1]}.${(match[2] || '').padEnd(3, '0')}Z`;
  return new Date(parsed).toISOString() === canonical ? parsed : null;
}

/** Bind physical identity and evidence, without invalidating it on custody or claim changes. */
export function productIdentityHash(item: ProductDecisionItem): string {
  const declared = record(item.declared);
  const evidence = item.evidence ?? [];
  if (
    typeof item.id !== 'string' ||
    !uuid.test(item.id) ||
    typeof item.receiptId !== 'string' ||
    !uuid.test(item.receiptId) ||
    !text(item.productName) ||
    !declared ||
    !text(declared.id, 128) ||
    !text(declared.name) ||
    !positiveInt(declared.quantity) ||
    !Array.isArray(evidence)
  )
    throw new ConflictException('缺少完整實收與申報品項，請客服補配對');
  return fingerprint({
    itemId: item.id,
    receiptId: item.receiptId,
    actual: {
      productId: nullableText(item.productId, 128),
      name: item.productName,
      sku: nullableText(item.sku, 100),
      serialNumber: nullableText(item.serialNumber, 100),
      quantity: 1,
    },
    declared: {
      id: declared.id,
      name: declared.name,
      sku: nullableText(declared.sku, 100),
      serialNumber: nullableText(declared.serialNumber, 100),
      quantity: declared.quantity,
    },
    evidenceCount: evidence.length,
    evidenceDigest: fingerprint(evidence),
  });
}

/** Only pass the freshly verified signed Source projection, never command-supplied proofs. */
export function requireCustomerProductDecision(
  item: ProductDecisionItem,
  source: unknown,
  options: { devSandbox: boolean },
): CustomerProductDecisionProof {
  const current = record(source);
  if (
    !current ||
    !item.receipt ||
    !['REPAIR', 'RETURN'].includes(item.receipt.category) ||
    typeof item.receipt.sourceCaseId !== 'string' ||
    !identifier.test(item.receipt.sourceCaseId) ||
    current.id !== item.receipt.sourceCaseId ||
    current.type !== item.receipt.category ||
    !caseBrands.includes(current.caseBrand as (typeof caseBrands)[number]) ||
    (item.receipt.entityId !== undefined &&
      item.receipt.entityId !== item.entityId) ||
    (item.receipt.id !== undefined && item.receipt.id !== item.receiptId)
  )
    throw new ConflictException('產品確認的售後案件、公司或品牌不符');

  const identityHash = productIdentityHash(item);
  const releaseInfo = record(current.releaseInfo);
  // The top projection is authoritative, including an explicitly empty array.
  const confirmations = Object.hasOwn(current, 'customerProductConfirmations')
    ? current.customerProductConfirmations
    : releaseInfo?.customerProductConfirmations;
  if (confirmations !== undefined && !Array.isArray(confirmations))
    throw new ConflictException('顧客產品確認資料格式不符');
  const candidates = (Array.isArray(confirmations) ? confirmations : [])
    .map(record)
    .filter(
      (proof): proof is Record<string, unknown> =>
        !!proof &&
        proof.itemId === item.id &&
        proof.purpose === 'PRODUCT' &&
        proof.status === 'APPROVED' &&
        proof.planHash === identityHash &&
        proof.actualIdentityHash === identityHash,
    );
  if (candidates.length !== 1)
    throw new ConflictException('尚未取得本件實收產品的唯一顧客確認');
  const proof = candidates[0];
  const submitted = timestamp(proof.submittedAt),
    reviewed = timestamp(proof.reviewedAt);
  if (
    typeof proof.proofId !== 'string' ||
    !identifier.test(proof.proofId) ||
    !positiveInt(proof.planVersion) ||
    typeof proof.planHash !== 'string' ||
    !digest.test(proof.planHash) ||
    typeof proof.actualIdentityHash !== 'string' ||
    !digest.test(proof.actualIdentityHash) ||
    proof.customerDecision !== 'ACCEPT_ACTUAL' ||
    typeof proof.verifiedCustomerId !== 'string' ||
    !digest.test(proof.verifiedCustomerId) ||
    (proof.provider !== 'LINE' && proof.provider !== 'DEV_STUB') ||
    typeof proof.reviewedById !== 'string' ||
    !identifier.test(proof.reviewedById) ||
    submitted === null ||
    reviewed === null ||
    submitted > reviewed ||
    (proof.provider === 'DEV_STUB' &&
      !(options?.devSandbox === true && item.entityId === sandboxEntity))
  )
    throw new ConflictException('顧客尚未有效同意本次實收產品，請客服重新確認');
  return structuredClone({
    proofId: proof.proofId,
    purpose: 'PRODUCT',
    status: 'APPROVED',
    itemId: item.id,
    planVersion: proof.planVersion,
    planHash: identityHash,
    actualIdentityHash: identityHash,
    customerDecision: 'ACCEPT_ACTUAL',
    verifiedCustomerId: proof.verifiedCustomerId,
    provider: proof.provider,
    reviewedById: proof.reviewedById,
    reviewedAt: proof.reviewedAt,
    submittedAt: proof.submittedAt,
  }) as CustomerProductDecisionProof;
}
