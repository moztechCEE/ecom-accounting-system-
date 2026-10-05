import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  type Actor,
  type SourceCase,
  can,
  STATUS_LABELS,
} from './mailroom.contract';
import {
  InspectionDocument,
  inspectionPlanHash,
  validateInspectionSubmission,
} from './repair-document.contract';

export const REPAIR_WORKFLOW_ACTIONS = [
  'claim_customer',
  'resolve_customer',
  'return_original',
  'send_factory',
  'accept_factory',
  'request_factory_return',
  'cancel_factory',
  'receive_factory',
  'complete_factory',
] as const;
export type RepairWorkflowAction = (typeof REPAIR_WORKFLOW_ACTIONS)[number];
export type PhysicalCustody = 'TECHNICIAN' | 'FACTORY_CARRIER' | 'FACTORY';
export type RepairWorkflow = {
  schema: 1;
  csr?: {
    status: 'SENT' | 'ACCEPTED' | 'RESOLVED';
    inspectionRevision: number;
    estimateRevision: number;
    quoteRevision: number | null;
    planHash: string;
    sentToUserId: string | null;
    ownerId?: string;
    sentAt: string;
    sentBy: string;
    acceptedAt?: string;
    resolvedAt?: string;
    decision?: 'APPROVE' | 'DECLINE';
    note?: string;
    sourceVersion?: string;
  };
  factory?: {
    stage: 'SENT' | 'ACCEPTED' | 'RETURNING' | 'RETURNED';
    physicalCustody: PhysicalCustody;
    inspectionRevision: number;
    planHash: string;
    factoryName: string;
    reference: string;
    carrier: string;
    trackingNumber: string;
    sentAt: string;
    sentBy: string;
    acceptedAt?: string;
    acceptanceNote?: string;
    returnRequestedAt?: string;
    returnNote?: string;
    cancelled?: boolean;
    cancelledAt?: string;
    cancelledBy?: string;
    cancellationNote?: string;
    returnedAt?: string;
    returnedBy?: string;
    returnLocation?: string;
    receiptNote?: string;
    sourceVersion?: string;
  };
  release?: {
    purpose: 'REPAIRED' | 'REPLACED' | 'RETURN_UNREPAIRED' | 'FACTORY_REPAIRED';
    inspectionRevision: number;
    releasedAt: string;
    releasedBy: string;
    note: string;
    stock?: {
      reservationId: string;
      postingId: string | null;
      externalStatus: string;
      quantity: number;
      entityId: string;
      itemId: string;
      unitLabel: string;
      replacementSN: string | null;
    };
  };
};
export type WorkflowItem = {
  status: string;
  repairOwnerId: string | null;
  custodianId: string;
  repairInspection?: unknown;
  repairWorkflow?: unknown;
  receipt: { customerServiceUserId?: string | null };
};

export function repairWorkflow(value: unknown): RepairWorkflow {
  if (!value) return { schema: 1 };
  if (typeof value !== 'object' || (value as RepairWorkflow).schema !== 1)
    throw new ConflictException('工作流程格式不符，請由管理員核對');
  return structuredClone(value) as RepairWorkflow;
}
export function physicalCustody(item: WorkflowItem): PhysicalCustody {
  // An inconsistent or legacy factory status must never enable technician edits.
  if (item.status === 'FACTORY_RECEIVED') return 'FACTORY';
  if (['FACTORY_OUTBOUND', 'FACTORY_RETURNING'].includes(item.status))
    return 'FACTORY_CARRIER';
  return (
    repairWorkflow(item.repairWorkflow).factory?.physicalCustody || 'TECHNICIAN'
  );
}
export function repairStatusLabel(item: WorkflowItem): string {
  const purpose = repairWorkflow(item.repairWorkflow).release?.purpose;
  if (purpose === 'RETURN_UNREPAIRED') {
    if (item.status === 'WAITING_RETURN_ACCEPTANCE')
      return '原件未修，待收發室簽收';
    if (item.status === 'READY_FOR_DISPATCH') return '原件未修，待安排寄回';
  }
  if (
    purpose === 'FACTORY_REPAIRED' &&
    item.status === 'WAITING_RETURN_ACCEPTANCE'
  )
    return '原廠返還複驗完成，待收發室簽收';
  return STATUS_LABELS[item.status] || item.status;
}
export function requireTechnicianCustody(actor: Actor, item: WorkflowItem) {
  if (
    !can(actor, 'repair_workbench:update') ||
    item.repairOwnerId !== actor.id ||
    item.custodianId !== actor.id ||
    physicalCustody(item) !== 'TECHNICIAN'
  )
    throw new ForbiddenException('只有目前實物已簽收的維修師可處理');
}
export function currentCsrReview(item: WorkflowItem): InspectionDocument {
  const doc = validateInspectionSubmission(item.repairInspection, true);
  const csr = repairWorkflow(item.repairWorkflow).csr;
  if (
    !csr ||
    csr.status !== 'RESOLVED' ||
    csr.inspectionRevision !== doc.revision ||
    csr.estimateRevision !== doc.revision ||
    csr.planHash !== inspectionPlanHash(doc) ||
    doc.review?.inspectionRevision !== doc.revision ||
    doc.review?.planHash !== csr.planHash ||
    doc.review?.decision !== csr.decision ||
    doc.review?.quoteRevision !== csr.quoteRevision
  )
    throw new ConflictException('客服尚未確認目前檢修與報價版本，請重新交辦');
  return doc;
}
export function sentCustomerWorkflow(
  item: WorkflowItem,
  actor: Actor,
  now: string,
  quoteRevision: number | null = null,
): RepairWorkflow {
  const doc = validateInspectionSubmission(item.repairInspection, true);
  const old = repairWorkflow(item.repairWorkflow);
  return {
    ...old,
    release: undefined,
    csr: {
      status: 'SENT',
      inspectionRevision: doc.revision,
      estimateRevision: doc.revision,
      quoteRevision,
      planHash: inspectionPlanHash(doc),
      sentToUserId: item.receipt.customerServiceUserId || null,
      sentAt: now,
      sentBy: actor.id,
    },
  };
}
export function requireWorkflowText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException('請填寫' + label);
  return value.trim();
}
export function requireSourceConsent(
  source: SourceCase,
  quoteRevision: number | null | undefined,
  requirePayment: boolean,
) {
  if (source.type === 'REPAIR') {
    const info = source.releaseInfo;
    if (
      !info ||
      !Number.isInteger(info.quoteRevision) ||
      info.quoteRevision < 1 ||
      info.customerApprovedQuoteRevision !== info.quoteRevision ||
      !info.customerApprovedAt ||
      !Number.isFinite(Date.parse(info.customerApprovedAt)) ||
      (quoteRevision != null && quoteRevision !== info.quoteRevision) ||
      (requirePayment && quoteRevision == null)
    )
      throw new ConflictException(
        '售後顧客同意或報價版本不符，請由客服重新確認',
      );
    if (
      requirePayment &&
      (!source.repairAllowed ||
        !Number.isFinite(info.amount) ||
        Number(info.amount) < 0 ||
        (Number(info.amount) > 0 &&
          info.confirmedPaymentQuoteRevision !== info.quoteRevision))
    )
      throw new ConflictException('目前報價尚未足額確認收款，不能放行維修');
    return info.quoteRevision;
  }
  if (requirePayment && !source.repairAllowed)
    throw new ConflictException('售後來源尚未放行');
  return null;
}
export function allowedWorkflowActions(
  actor: Actor,
  item: WorkflowItem,
): RepairWorkflowAction[] {
  const workflow = repairWorkflow(item.repairWorkflow);
  const csr = workflow.csr;
  if (
    can(actor, 'mailroom:review') &&
    item.status === 'WAITING_CUSTOMER' &&
    csr
  ) {
    if (
      csr.status === 'SENT' &&
      (!csr.sentToUserId || csr.sentToUserId === actor.id || can(actor, '*'))
    )
      return ['claim_customer'];
    if (csr.status === 'ACCEPTED' && csr.ownerId === actor.id)
      return ['resolve_customer'];
  }
  if (
    !can(actor, 'repair_workbench:update') ||
    item.repairOwnerId !== actor.id ||
    item.custodianId !== actor.id
  )
    return [];
  if (item.status === 'FACTORY_OUTBOUND' && workflow.factory?.stage === 'SENT')
    return [
      'accept_factory',
      'request_factory_return',
      ...(!workflow.factory.cancelled ? ['cancel_factory' as const] : []),
    ];
  if (
    item.status === 'FACTORY_RECEIVED' &&
    workflow.factory?.stage === 'ACCEPTED'
  )
    return [
      'request_factory_return',
      ...(!workflow.factory.cancelled ? ['cancel_factory' as const] : []),
    ];
  if (
    item.status === 'FACTORY_RETURNING' &&
    workflow.factory?.stage === 'RETURNING'
  )
    return ['receive_factory'];
  if (
    physicalCustody(item) !== 'TECHNICIAN' ||
    !['INSPECTING', 'REPAIR_RECEIVED'].includes(item.status)
  )
    return [];
  let doc: InspectionDocument;
  try {
    doc = currentCsrReview(item);
  } catch {
    return [];
  }
  if (csr?.decision === 'DECLINE' || doc.data.plan === 'RETURN')
    return ['return_original'];
  if (doc.data.plan === 'FACTORY' && csr?.decision === 'APPROVE') {
    if (
      workflow.factory?.stage === 'RETURNED' &&
      workflow.factory.inspectionRevision === doc.revision &&
      !workflow.factory.cancelled
    )
      return ['complete_factory'];
    if (
      !workflow.factory ||
      (workflow.factory.stage === 'RETURNED' &&
        workflow.factory.inspectionRevision !== doc.revision)
    )
      return ['send_factory'];
  }
  return [];
}
