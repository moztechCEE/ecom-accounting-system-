import {
  type Actor,
  type SourceCase,
  can,
  isRepairWorkbenchItem,
} from './mailroom.contract';
import {
  allowedWorkflowActions,
  currentCsrReview,
  physicalCustody,
  repairWorkflow,
  requireSourceConsent,
  type WorkflowItem,
} from './repair-workflow.contract';

export const REPAIR_TODO_KINDS = [
  'INSPECTION',
  'REPAIR_WORK',
  'START_REPAIR',
  'START_REPLACEMENT',
  'SEND_FACTORY',
  'FACTORY_RETURN_RECEIPT',
  'RETURN_ORIGINAL',
] as const;
export type RepairTodoKind = (typeof REPAIR_TODO_KINDS)[number];
export const REPAIR_TODO_STATUSES = [
  'REPAIR_RECEIVED',
  'INSPECTING',
  'REPAIRING',
  'REFURBISHING',
  'FACTORY_RETURNING',
] as const;
export type RepairTodoItem = WorkflowItem & {
  id: string;
  entityId: string;
  nextUserId: string | null;
  receipt: WorkflowItem['receipt'] & {
    entityId: string;
    category: string;
    sourceCaseId: string | null;
  };
};
export type RepairTodoDecision =
  | { state: 'ready'; kind: RepairTodoKind }
  | { state: 'source'; kind: RepairTodoKind; sourceId: string }
  | { state: 'blocked' | 'unknown' };

const blocked: RepairTodoDecision = { state: 'blocked' };
const unknown: RepairTodoDecision = { state: 'unknown' };
const positiveInt = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;
const nullableRevision = (value: unknown) =>
  value === null || positiveInt(value);

/** Queue membership names work to do; it never grants an action or completion. */
export function repairTodoDecision(
  actor: Actor,
  entityId: string,
  item: RepairTodoItem,
): RepairTodoDecision {
  if (
    !can(actor, 'repair_workbench:read') ||
    !can(actor, 'repair_workbench:update') ||
    (actor.entityIds !== null && !actor.entityIds.includes(entityId)) ||
    item.entityId !== entityId ||
    item.receipt.entityId !== entityId ||
    !isRepairWorkbenchItem(item) ||
    item.repairOwnerId !== actor.id ||
    item.custodianId !== actor.id ||
    (item.nextUserId !== null && item.nextUserId !== actor.id) ||
    !REPAIR_TODO_STATUSES.some((status) => status === item.status)
  )
    return blocked;
  try {
    const workflow = repairWorkflow(item.repairWorkflow);
    if (item.status === 'FACTORY_RETURNING')
      return allowedWorkflowActions(actor, item).includes('receive_factory')
        ? { state: 'ready', kind: 'FACTORY_RETURN_RECEIPT' }
        : blocked;
    if (physicalCustody(item) !== 'TECHNICIAN') return blocked;
    // Editing actual work and QC remains a todo. Its final write independently
    // checks reports, current customer consent, payment and replacement stock.
    if (['REPAIRING', 'REFURBISHING'].includes(item.status))
      return { state: 'ready', kind: 'REPAIR_WORK' };
    const csr = workflow.csr;
    if (!csr) return { state: 'ready', kind: 'INSPECTION' };
    if (csr.status === 'SENT' || csr.status === 'ACCEPTED') return blocked;
    if (csr.status !== 'RESOLVED') return unknown;
    let doc: ReturnType<typeof currentCsrReview>;
    try {
      doc = currentCsrReview(item);
    } catch {
      // A revised/draft inspection is work to reconcile, never source release.
      return { state: 'ready', kind: 'INSPECTION' };
    }
    const actions = allowedWorkflowActions(actor, item);
    if (actions.includes('return_original'))
      return { state: 'ready', kind: 'RETURN_ORIGINAL' };
    if (actions.includes('complete_factory'))
      return { state: 'ready', kind: 'REPAIR_WORK' };
    if (csr.decision !== 'APPROVE') return unknown;
    let kind: RepairTodoKind;
    if (doc.data.plan === 'REPAIR') kind = 'START_REPAIR';
    else if (doc.data.plan === 'REPLACE') kind = 'START_REPLACEMENT';
    else if (actions.includes('send_factory')) kind = 'SEND_FACTORY';
    else return { state: 'ready', kind: 'INSPECTION' };
    // REPAIR_RECEIVED must first enter inspection; it is not a start action.
    if (item.status === 'REPAIR_RECEIVED')
      return { state: 'ready', kind: 'INSPECTION' };
    const sourceId = item.receipt.sourceCaseId;
    if (
      typeof sourceId !== 'string' ||
      !sourceId.trim() ||
      sourceId.length > 128
    )
      return unknown;
    return { state: 'source', kind, sourceId };
  } catch {
    return unknown;
  }
}

/** Fresh detail only. A receipt snapshot cannot establish customer release. */
export function repairTodoSourceDecision(
  actor: Actor,
  entityId: string,
  item: RepairTodoItem,
  source: unknown,
): RepairTodoDecision {
  const decision = repairTodoDecision(actor, entityId, item);
  if (decision.state !== 'source') return decision;
  if (!source || typeof source !== 'object' || Array.isArray(source))
    return unknown;
  const current = source as SourceCase;
  if (
    current.id !== decision.sourceId ||
    current.type !== item.receipt.category ||
    typeof current.version !== 'string' ||
    !current.version.trim() ||
    typeof current.repairAllowed !== 'boolean'
  )
    return unknown;
  if (current.type === 'REPAIR') {
    const info = current.releaseInfo;
    if (
      !info ||
      !positiveInt(info.quoteRevision) ||
      !nullableRevision(info.customerApprovedQuoteRevision) ||
      !nullableRevision(info.confirmedPaymentQuoteRevision) ||
      (info.customerApprovedAt !== null &&
        (typeof info.customerApprovedAt !== 'string' ||
          !Number.isFinite(Date.parse(info.customerApprovedAt)))) ||
      typeof info.amount !== 'number' ||
      !Number.isFinite(info.amount) ||
      info.amount < 0 ||
      typeof info.currency !== 'string' ||
      !info.currency.trim()
    )
      return unknown;
  }
  try {
    currentCsrReview(item);
    const csr = repairWorkflow(item.repairWorkflow).csr;
    if (csr?.decision !== 'APPROVE') return blocked;
    requireSourceConsent(current, csr.quoteRevision, true);
    return { state: 'ready', kind: decision.kind };
  } catch {
    return blocked;
  }
}
