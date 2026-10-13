import { ConflictException } from '@nestjs/common';
import { repairSourceCaseBrand } from './repair-source-brand.contract';
import { type SourceCase } from './mailroom.contract';
import {
  type RepairProposalItem,
  repairSourceBindingForItem,
} from './repair-proposal.contract';
import {
  type RepairDispositionDecision,
  type RepairDispositionPolicy,
  requireRepairDispositionProof,
} from './repair-disposition.contract';

type CustomerIdentity = {
  companyId: string;
  caseId: string;
  brand: string;
  verifiedCustomerId: string;
  verified: boolean;
};
type CustomerDecision = {
  proofId: string;
  proofRevision: number;
  status: string;
  purpose: string;
  quoteRevision: number;
  itemId: string;
  planVersion: number;
  planHash: string;
  proposalHash: string;
  customerDecision: RepairDispositionDecision;
  verifiedCustomerId: string;
  provider: string;
  reviewedById: string;
  reviewedAt: string;
  submittedAt: string;
  customerIdentity?: CustomerIdentity;
};
type DispositionRelease = NonNullable<SourceCase['releaseInfo']> & {
  customerIdentity?: CustomerIdentity | null;
  customerDecisions?: CustomerDecision[];
};

/** Only the fresh, signed Source projection can supply this authority. Client
 * commands never accept a proof, identity, provider or approval boolean. */
export function requireSourceDisposition(
  source: SourceCase,
  item: RepairProposalItem,
  decision: RepairDispositionDecision,
  policy: RepairDispositionPolicy,
) {
  if (
    source.type !== 'REPAIR' ||
    item.receipt.category !== 'REPAIR' ||
    source.id !== item.receipt.sourceCaseId ||
    source.number !== item.receipt.sourceNumber ||
    policy.entityId !== item.entityId ||
    ['CLOSED', 'CANCELLED', 'COMPLETED'].includes(source.status)
  )
    throw new ConflictException('售後來源不符或已結束，請重新確認原件處置');
  const release = source.releaseInfo as DispositionRelease | null | undefined;
  const selected = Array.isArray(release?.customerDecisions)
    ? release.customerDecisions.filter((proof) => proof?.itemId === item.id)
    : [];
  // Source may scope its current identity to the selected proof. Never borrow
  // another piece's identity or silently choose the first duplicate proof.
  const identity =
    release?.customerIdentity ||
    (selected.length === 1 ? selected[0].customerIdentity : undefined);
  if (
    !identity ||
    identity.verified !== true ||
    identity.caseId !== source.id ||
    identity.brand !== repairSourceCaseBrand(source) ||
    typeof identity.companyId !== 'string' ||
    !identity.companyId.trim() ||
    typeof identity.verifiedCustomerId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(identity.verifiedCustomerId) ||
    !Number.isInteger(release?.quoteRevision) ||
    Number(release?.quoteRevision) < 0 ||
    !Array.isArray(release?.customerDecisions)
  )
    throw new ConflictException('顧客身分或當版原件處置證據尚未確認');
  const binding = repairSourceBindingForItem(item, source);
  const proofs = release.customerDecisions.map((proof) => {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof))
      throw new ConflictException('顧客原件處置證據格式不符');
    if (
      proof.itemId === item.id &&
      proof.customerIdentity &&
      (proof.customerIdentity.companyId !== identity.companyId ||
        proof.customerIdentity.caseId !== identity.caseId ||
        proof.customerIdentity.brand !== identity.brand ||
        proof.customerIdentity.verified !== true ||
        proof.customerIdentity.verifiedCustomerId !==
          identity.verifiedCustomerId)
    )
      throw new ConflictException('顧客原件處置身分不符');
    return {
      schema: 'corely.customer.confirmation.v1',
      id: proof.proofId,
      revision: proof.proofRevision,
      purpose: proof.purpose,
      status: proof.status,
      companyId: identity.companyId,
      caseId: source.id,
      brand: identity.brand,
      customerId: proof.verifiedCustomerId,
      customerIdentityId: proof.verifiedCustomerId,
      identityProvider: proof.provider,
      identityVerified:
        proof.verifiedCustomerId === identity.verifiedCustomerId,
      decision: proof.customerDecision,
      binding: {
        itemId: proof.itemId,
        planVersion: proof.planVersion,
        planHash: proof.planHash,
        proposalHash: proof.proposalHash,
      },
      quoteRevision: proof.quoteRevision,
      submittedAt: proof.submittedAt,
      reviewedAt: proof.reviewedAt,
      reviewedById: proof.reviewedById,
      // Source's helper emits only current, non-invalidated authoritative records.
      current: true,
      invalidatedAt: null,
    };
  });
  return requireRepairDispositionProof(
    proofs,
    {
      companyId: identity.companyId,
      caseId: source.id,
      brand: identity.brand,
      customerId: identity.verifiedCustomerId,
      customerIdentityId: identity.verifiedCustomerId,
      binding,
      quoteRevision: release.quoteRevision,
      decision,
    },
    policy,
  );
}
