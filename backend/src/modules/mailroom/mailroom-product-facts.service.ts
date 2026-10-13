import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { type SourceCase } from './mailroom.contract';
import {
  type CustomerProductDecisionProof,
  type ProductDecisionItem,
  productIdentityHash,
} from './mailroom-product-decision.contract';

const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const digest = /^[0-9a-f]{64}$/;
const brands = ['MOZTECH', 'BONSON', 'WANBO'] as const;
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && identifier.test(value);

function requireScope(item: ProductDecisionItem) {
  if (
    !safeId(item.entityId) ||
    !item.receipt ||
    (item.receipt.entityId !== undefined &&
      item.receipt.entityId !== item.entityId) ||
    (item.receipt.id !== undefined && item.receipt.id !== item.receiptId)
  )
    throw new ConflictException('產品確認事實的公司或實物來源不符');
}

function validProofTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  const parsed = Date.parse(value);
  return parts &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() ===
      `${parts[1]}.${(parts[2] || '').padEnd(3, '0')}Z`
    ? parsed
    : null;
}

async function lockItem(
  tx: Prisma.TransactionClient,
  item: ProductDecisionItem,
) {
  // Match the enclosing command's item-first order; do not introduce an advisory inversion.
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM mailroom_items WHERE id=${item.id} AND entity_id=${item.entityId} FOR UPDATE`;
  if (rows.length !== 1 || rows[0].id !== item.id)
    throw new ConflictException('產品確認實物已變動，請重新整理');
}

function proofSnapshot(proof: CustomerProductDecisionProof) {
  return {
    proofId: proof.proofId,
    purpose: proof.purpose,
    status: proof.status,
    itemId: proof.itemId,
    planVersion: proof.planVersion,
    planHash: proof.planHash,
    actualIdentityHash: proof.actualIdentityHash,
    customerDecision: proof.customerDecision,
    verifiedCustomerId: proof.verifiedCustomerId,
    provider: proof.provider,
    reviewedById: proof.reviewedById,
    reviewedAt: proof.reviewedAt,
    submittedAt: proof.submittedAt,
  };
}

/** Store an already verified fresh Source proof; this helper is not an approval or scoring authority. */
export async function persistProductMismatchFact(
  tx: Prisma.TransactionClient,
  item: ProductDecisionItem,
  source: SourceCase,
  proof: CustomerProductDecisionProof,
  reviewedByErpActorId: string,
): Promise<void> {
  requireScope(item);
  const identityHash = productIdentityHash(item);
  const firstReviewErpActorId = source.firstReviewErpActorId ?? null;
  const parsedVersion =
    typeof source.version === 'string'
      ? Date.parse(source.version)
      : Number.NaN;
  const submittedAt = validProofTime(proof.submittedAt),
    reviewedAt = validProofTime(proof.reviewedAt);
  if (
    !['REPAIR', 'RETURN'].includes(item.receipt.category) ||
    !safeId(item.receipt.sourceCaseId) ||
    source.id !== item.receipt.sourceCaseId ||
    source.type !== item.receipt.category ||
    !brands.includes(source.caseBrand as (typeof brands)[number]) ||
    !safeId(reviewedByErpActorId) ||
    (firstReviewErpActorId !== null && !safeId(firstReviewErpActorId)) ||
    !Number.isFinite(parsedVersion) ||
    new Date(parsedVersion).toISOString() !== source.version ||
    proof.purpose !== 'PRODUCT' ||
    proof.status !== 'APPROVED' ||
    proof.customerDecision !== 'ACCEPT_ACTUAL' ||
    proof.itemId !== item.id ||
    proof.planHash !== identityHash ||
    proof.actualIdentityHash !== identityHash ||
    !Number.isSafeInteger(proof.planVersion) ||
    proof.planVersion < 1 ||
    proof.planVersion > 2147483647 ||
    (proof.provider !== 'LINE' && proof.provider !== 'DEV_STUB') ||
    (proof.provider === 'DEV_STUB' &&
      item.entityId !== 'doa-dev-qa-20261002') ||
    submittedAt === null ||
    reviewedAt === null ||
    submittedAt > reviewedAt ||
    !safeId(proof.proofId) ||
    !safeId(proof.reviewedById) ||
    typeof proof.verifiedCustomerId !== 'string' ||
    !digest.test(proof.verifiedCustomerId)
  )
    throw new ConflictException('產品確認事實缺少有效來源、承辦人或顧客證明');

  await lockItem(tx, item);
  const previous = await tx.mailroomProductMismatchFact.findUnique({
    where: {
      entityId_itemId_identityHash: {
        entityId: item.entityId,
        itemId: item.id,
        identityHash,
      },
    },
  });
  if (previous) {
    if (
      previous.entityId !== item.entityId ||
      previous.itemId !== item.id ||
      previous.receiptId !== item.receiptId ||
      previous.sourceCaseId !== source.id ||
      previous.identityHash !== identityHash ||
      previous.caseBrand !== source.caseBrand
    )
      throw new ConflictException('既有產品確認事實的不可變來源不符');
    // Never replace the original evidence, or resurrect a VOID cause with a newer approval.
    return;
  }
  await tx.mailroomProductMismatchFact.create({
    data: {
      entityId: item.entityId,
      itemId: item.id,
      receiptId: item.receiptId,
      sourceCaseId: source.id,
      identityHash,
      proofId: proof.proofId,
      sourceVersion: source.version,
      caseBrand: source.caseBrand!,
      firstReviewErpActorId,
      reviewedByErpActorId,
      status: 'ACTIVE',
      proofSnapshot: proofSnapshot(proof),
    },
  });
}

/** Void evidence only when a certifiable physical identity changes; custody changes are irrelevant. */
export async function voidProductMismatchFactsForIdentity(
  tx: Prisma.TransactionClient,
  item: ProductDecisionItem,
  candidate: ProductDecisionItem,
): Promise<boolean> {
  if (
    candidate.id !== item.id ||
    candidate.entityId !== item.entityId ||
    candidate.receiptId !== item.receiptId
  )
    throw new ConflictException('不能異動其他公司或其他實物的產品確認事實');
  requireScope(item);
  requireScope(candidate);
  let before: string, after: string;
  try {
    before = productIdentityHash(item);
    after = productIdentityHash(candidate);
  } catch (error) {
    if (!(error instanceof ConflictException)) throw error;
    await lockItem(tx, item);
    const active = await tx.mailroomProductMismatchFact.count({
      where: {
        entityId: item.entityId,
        itemId: item.id,
        status: 'ACTIVE',
      },
    });
    if (active)
      throw new ConflictException(
        '既有產品確認缺少完整實物身分，不能猜測或改寫事實',
      );
    // A legacy unpaired piece has no certifiable old cause to void. Let CSR pairing continue.
    return false;
  }
  if (before === after) return false;
  await lockItem(tx, item);
  const where = {
    entityId: item.entityId,
    itemId: item.id,
    status: 'ACTIVE',
    identityHash: { not: after },
  };
  if (await tx.mailroomProductMismatchFact.count({ where }))
    await tx.mailroomProductMismatchFact.updateMany({
      where,
      data: {
        status: 'VOID',
        voidedAt: new Date(),
        voidReason: 'PRODUCT_IDENTITY_CHANGED',
      },
    });
  return true;
}
