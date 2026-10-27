import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { fingerprint, type SourceCase } from './mailroom.contract';
import {
  inspectionPlanHash,
  validateDocumentV2,
  validateInspectionSubmission,
  type InspectionDocument,
} from './repair-document.contract';
import {
  accidentalDamageFromAssessment,
  validateInspectionAssessmentShape,
} from './repair-assessment.contract';
import {
  repairSourceBindingForItem,
  validateRepairProposalEvent,
  type RepairProposalItem,
} from './repair-proposal.contract';
import { repairWorkflow } from './repair-workflow.contract';

type Reader = Pick<
  Prisma.TransactionClient,
  'mailroomAction' | 'mailroomDelivery'
>;
export type AssessmentRelease = {
  state: 'READY' | 'BLOCKED' | 'UNKNOWN';
  reason: string;
};
export type AssessmentReleaseContext = {
  source?: SourceCase;
  purpose?: 'PUBLIC_REPORT_READ';
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const result = (state: AssessmentRelease['state'], reason: string) => ({
  state,
  reason,
});

function documentMatches(value: unknown, doc: InspectionDocument) {
  if (!object(value)) return false;
  const fields = [
    'number',
    'status',
    'revision',
    'authorId',
    'authorName',
    'updatedAt',
    'submittedAt',
  ] as const;
  return (
    fields.every(
      (key) => Object.hasOwn(value, key) && value[key] === doc[key],
    ) &&
    doc.status === 'SUBMITTED' &&
    positive(doc.revision) &&
    [doc.number, doc.authorId, doc.authorName].every(text) &&
    timestamp(doc.updatedAt) &&
    timestamp(doc.submittedAt) &&
    Date.parse(doc.updatedAt) <= Date.now() &&
    Date.parse(doc.submittedAt) <= Date.now() &&
    object(value.data) &&
    fingerprint(value.data) === fingerprint(doc.data) &&
    inspectionPlanHash(value as unknown as InspectionDocument) ===
      inspectionPlanHash(doc)
  );
}

/** Original immutable server action, never absence/date/prefix classification. */
function submissionMatches(
  value: unknown,
  item: RepairProposalItem,
  doc: InspectionDocument,
  legacy: boolean,
) {
  if (!object(value) || !object(value.snapshot)) return false;
  const snapshot = value.snapshot;
  if (!object(snapshot.receipt)) return false;
  const originalWorkflow = object(snapshot.repairWorkflow)
    ? snapshot.repairWorkflow
    : {};
  return (
    value.entityId === item.entityId &&
    value.itemId === item.id &&
    value.actorId === doc.authorId &&
    value.action === 'submit_repair_inspection' &&
    digest(value.requestHash) &&
    text(value.requestId) &&
    positive(value.version) &&
    value.version === snapshot.version &&
    value.version <= item.version &&
    snapshot.id === item.id &&
    snapshot.entityId === item.entityId &&
    snapshot.receiptId === item.receiptId &&
    snapshot.receipt.category === item.receipt.category &&
    snapshot.receipt.sourceCaseId === item.receipt.sourceCaseId &&
    snapshot.receipt.sourceNumber === item.receipt.sourceNumber &&
    documentMatches(snapshot.repairInspection, doc) &&
    (legacy
      ? !Object.hasOwn(originalWorkflow, 'assessmentPolicy') &&
        !Object.hasOwn(
          (snapshot.repairInspection as InspectionDocument).data,
          'assessment',
        )
      : fingerprint(originalWorkflow.assessmentPolicy) ===
        fingerprint(repairWorkflow(item.repairWorkflow).assessmentPolicy))
  );
}

function reviewMatches(
  value: unknown,
  item: RepairProposalItem,
  doc: InspectionDocument,
) {
  const workflow = repairWorkflow(item.repairWorkflow);
  const proof = workflow.assessmentReview;
  if (!proof || !object(value) || !object(value.snapshot)) return false;
  const snapshot = value.snapshot;
  const saved = object(snapshot.repairWorkflow) ? snapshot.repairWorkflow : {};
  const csr = object(saved.csr) ? saved.csr : {};
  const now = Date.now();
  // This receipt is emitted only after the native handler's real permission,
  // active employee and employee-alias independence checks. Public reads do
  // not invent these facts or reclassify a reviewer after later deactivation.
  return (
    value.entityId === item.entityId &&
    value.itemId === item.id &&
    value.action === 'review_assessment' &&
    value.actorId === proof.reviewerId &&
    value.actorName === proof.reviewerName &&
    digest(value.requestHash) &&
    text(value.requestId) &&
    positive(value.version) &&
    value.version === snapshot.version &&
    value.version <= item.version &&
    value.fromStatus === 'WAITING_CUSTOMER' &&
    value.toStatus === 'WAITING_CUSTOMER' &&
    snapshot.id === item.id &&
    snapshot.entityId === item.entityId &&
    snapshot.repairOwnerId === item.repairOwnerId &&
    snapshot.status === 'WAITING_CUSTOMER' &&
    documentMatches(snapshot.repairInspection, doc) &&
    fingerprint(saved.assessmentPolicy) ===
      fingerprint(workflow.assessmentPolicy) &&
    fingerprint(saved.assessmentReview) === fingerprint(proof) &&
    csr.status === 'ACCEPTED' &&
    csr.ownerId === proof.reviewerId &&
    csr.inspectionRevision === doc.revision &&
    csr.estimateRevision === doc.revision &&
    csr.planHash === inspectionPlanHash(doc) &&
    proof.schema === 1 &&
    proof.decision === 'APPROVE' &&
    proof.inspectionRevision === doc.revision &&
    proof.planHash === inspectionPlanHash(doc) &&
    text(proof.reviewerId) &&
    text(proof.reviewerName) &&
    text(proof.note) &&
    timestamp(proof.reviewedAt) &&
    Date.parse(proof.reviewedAt) <= now &&
    proof.reviewerId !== doc.authorId &&
    proof.reviewerId !== item.repairOwnerId
  );
}

export type LocalProposalBinding = ReturnType<
  typeof repairSourceBindingForItem
>;
export type LocalAssessmentRelease = AssessmentRelease & {
  legacyProposalBinding?: LocalProposalBinding;
};

/** Local-only receipt reader. No Source fetch, provider, documents() or remote fallback. */
export type VerifiedDeliveredRepairProposal = {
  binding: LocalProposalBinding;
  eventId: string;
  receiptId: string;
  sourceVersion: number;
};
export async function verifiedDeliveredRepairProposal(
  item: RepairProposalItem,
  db: Reader,
): Promise<VerifiedDeliveredRepairProposal | null> {
  try {
    const doc = validateInspectionSubmission(item.repairInspection);
    const receipt = await db.mailroomDelivery.findFirst({
      where: {
        entityId: item.entityId,
        itemId: item.id,
        target: 'AFTER_SALES',
        status: 'DELIVERED',
        AND: [
          { payload: { path: ['kind'], equals: 'REPAIR_PROPOSAL' } },
          {
            payload: {
              path: ['proposal', 'planHash'],
              equals: inspectionPlanHash(doc),
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (
      !receipt ||
      receipt.entityId !== item.entityId ||
      receipt.itemId !== item.id ||
      receipt.target !== 'AFTER_SALES' ||
      receipt.status !== 'DELIVERED' ||
      !receipt.deliveredAt ||
      !Number.isFinite(new Date(receipt.deliveredAt).getTime()) ||
      new Date(receipt.deliveredAt).getTime() > Date.now()
    )
      return null;
    const event = validateRepairProposalEvent(receipt.payload);
    const original = event.proposal.original;
    if (
      !object(item.declared) ||
      event.eventId !== receipt.eventId ||
      event.entityId !== item.entityId ||
      event.itemId !== item.id ||
      event.receiptId !== item.receiptId ||
      event.version > item.version ||
      event.sourceCaseId !== item.receipt.sourceCaseId ||
      event.sourceNumber !== item.receipt.sourceNumber ||
      original.productId !== item.productId ||
      original.sourceItemId !== item.declared.id ||
      original.label !== item.label ||
      original.productName !== item.productName ||
      original.sku !== item.sku ||
      original.serialNumber !== item.serialNumber ||
      original.quantity !== 1 ||
      event.proposal.inspectionDocumentId !== doc.number ||
      event.proposal.inspectionRevision !== doc.revision ||
      event.proposal.planVersion !== doc.revision ||
      event.proposal.planHash !== inspectionPlanHash(doc)
    )
      return null;
    return {
      binding: {
        itemId: item.id,
        planVersion: doc.revision,
        planHash: inspectionPlanHash(doc),
        proposalHash: event.proposal.proposalHash,
      },
      eventId: event.eventId,
      receiptId: event.receiptId,
      sourceVersion: event.version,
    };
  } catch {
    return null;
  }
}

/** Preserve the existing four-field fingerprint contract used by legacy guards. */
export async function deliveredRepairProposalBinding(
  item: RepairProposalItem,
  db: Reader,
): Promise<LocalProposalBinding | null> {
  return (await verifiedDeliveredRepairProposal(item, db))?.binding || null;
}

export async function verifiedAssessmentReviewActionRef(
  item: RepairProposalItem,
  db: Reader,
) {
  try {
    const doc = validateInspectionSubmission(item.repairInspection);
    const proof = repairWorkflow(item.repairWorkflow).assessmentReview;
    if (!proof) return null;
    const receipt = await db.mailroomAction.findFirst({
      where: {
        entityId: item.entityId,
        itemId: item.id,
        action: 'review_assessment',
        actorId: proof.reviewerId,
        snapshot: {
          path: ['repairWorkflow', 'assessmentReview', 'reviewedAt'],
          equals: proof.reviewedAt,
        },
      },
      orderBy: { version: 'desc' },
    });
    if (
      !receipt ||
      !reviewMatches(receipt, item, doc) ||
      typeof receipt.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        receipt.id,
      )
    )
      return null;
    return {
      decision: 'APPROVE' as const,
      inspectionRevision: doc.revision,
      planHash: inspectionPlanHash(doc),
      actionId: receipt.id,
      actionVersion: receipt.version,
    };
  } catch {
    return null;
  }
}

/** Fresh Source authority is a separate caller-owned layer; never used by the local reader. */
function currentLegacySourceBinding(
  item: RepairProposalItem,
  binding: LocalProposalBinding,
  source?: SourceCase,
  purpose?: AssessmentReleaseContext['purpose'],
) {
  if (
    !source ||
    source.type !== 'REPAIR' ||
    source.id !== item.receipt.sourceCaseId ||
    source.number !== item.receipt.sourceNumber ||
    !text(source.version) ||
    source.status === 'CANCELLED' ||
    (purpose !== 'PUBLIC_REPORT_READ' &&
      ['CLOSED', 'COMPLETED'].includes(source.status))
  )
    return false;
  const expected = repairSourceBindingForItem(item, source);
  const info = source.releaseInfo;
  const bindings =
    info?.quoteBindings?.filter((row) => row.itemId === item.id) || [];
  return (
    !!info &&
    positive(info.quoteRevision) &&
    bindings.length === 1 &&
    fingerprint(binding) === fingerprint(expected) &&
    fingerprint(bindings[0]) ===
      fingerprint({ ...expected, quoteRevision: info.quoteRevision })
  );
}

export async function localAssessmentReleaseForItem(
  item: RepairProposalItem,
  db: Reader,
): Promise<LocalAssessmentRelease> {
  try {
    const doc = validateInspectionSubmission(item.repairInspection);
    const workflow = repairWorkflow(item.repairWorkflow);
    const hasPolicy = Object.hasOwn(workflow, 'assessmentPolicy');
    const hasAssessment = Object.hasOwn(doc.data, 'assessment');
    const policy = workflow.assessmentPolicy;
    const legacy = !hasPolicy && !hasAssessment;
    if (!legacy) {
      if (
        !hasPolicy ||
        !hasAssessment ||
        policy?.schema !== 1 ||
        policy.inspectionRevision !== doc.revision ||
        policy.planHash !== inspectionPlanHash(doc)
      )
        return result('UNKNOWN', 'ASSESSMENT_POLICY_MISMATCH');
      validateDocumentV2(doc.data, 'inspection');
      const assessment = validateInspectionAssessmentShape(doc.data.assessment);
      if (
        assessment.causalExplanation !== doc.data.diagnosis ||
        (doc.data.isAccidentalDamage !== undefined &&
          doc.data.isAccidentalDamage !==
            accidentalDamageFromAssessment(assessment))
      )
        return result('UNKNOWN', 'ASSESSMENT_DATA_MISMATCH');
    }
    const submissions = await db.mailroomAction.findMany({
      where: {
        entityId: item.entityId,
        itemId: item.id,
        action: 'submit_repair_inspection',
        snapshot: {
          path: ['repairInspection', 'revision'],
          equals: doc.revision,
        },
      },
      orderBy: { version: 'desc' },
      take: 2,
    });
    if (
      submissions.length !== 1 ||
      !submissionMatches(submissions[0], item, doc, legacy)
    )
      return result('UNKNOWN', 'SUBMISSION_PROVENANCE_UNAVAILABLE');
    if (legacy) {
      if (item.receipt.category === 'RETURN')
        return result('READY', 'PROVEN_LEGACY_SUBMISSION');
      if (item.receipt.category !== 'REPAIR')
        return result('UNKNOWN', 'LEGACY_CATEGORY_UNAVAILABLE');
      const legacyProposalBinding = await deliveredRepairProposalBinding(
        item,
        db,
      );
      return legacyProposalBinding
        ? {
            ...result('READY', 'PROVEN_LEGACY_SUBMISSION'),
            legacyProposalBinding,
          }
        : result('UNKNOWN', 'LEGACY_PROPOSAL_RECEIPT_UNAVAILABLE');
    }
    const assessment = validateInspectionAssessmentShape(doc.data.assessment);
    if (assessment.conclusion !== 'USER_CAUSED')
      return result('READY', 'INDEPENDENT_REVIEW_NOT_REQUIRED');
    const proof = workflow.assessmentReview;
    if (!proof || proof.decision !== 'APPROVE')
      return result('BLOCKED', 'ASSESSMENT_REVIEW_REQUIRED');
    const receipt = await db.mailroomAction.findFirst({
      where: {
        entityId: item.entityId,
        itemId: item.id,
        action: 'review_assessment',
        actorId: proof.reviewerId,
        snapshot: {
          path: ['repairWorkflow', 'assessmentReview', 'reviewedAt'],
          equals: proof.reviewedAt,
        },
      },
      orderBy: { version: 'desc' },
    });
    return reviewMatches(receipt, item, doc)
      ? result('READY', 'CURRENT_INDEPENDENT_APPROVAL')
      : result('BLOCKED', 'ASSESSMENT_REVIEW_PROVENANCE_MISMATCH');
  } catch {
    return result('UNKNOWN', 'ASSESSMENT_PROVENANCE_UNAVAILABLE');
  }
}

export async function assessmentReleaseForItem(
  item: RepairProposalItem,
  db: Reader,
  context: AssessmentReleaseContext = {},
): Promise<AssessmentRelease> {
  const local = await localAssessmentReleaseForItem(item, db);
  if (local.state !== 'READY')
    return { state: local.state, reason: local.reason };
  if (local.legacyProposalBinding) {
    try {
      if (
        !currentLegacySourceBinding(
          item,
          local.legacyProposalBinding,
          context.source,
          context.purpose,
        )
      )
        return result('UNKNOWN', 'LEGACY_SOURCE_BINDING_UNAVAILABLE');
    } catch {
      return result('UNKNOWN', 'LEGACY_SOURCE_BINDING_UNAVAILABLE');
    }
  }
  return { state: local.state, reason: local.reason };
}

export async function requireAssessmentRelease(
  item: RepairProposalItem,
  db: Reader,
  context: AssessmentReleaseContext = {},
) {
  const current = await assessmentReleaseForItem(item, db, context);
  if (current.state !== 'READY')
    throw new ConflictException('本版原因判定或覆核證據尚未確認');
}
