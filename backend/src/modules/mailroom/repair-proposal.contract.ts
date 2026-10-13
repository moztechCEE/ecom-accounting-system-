import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  type Actor,
  type SourceCase,
  fingerprint,
  requireEntity,
} from './mailroom.contract';
import {
  type InspectionData,
  inspectionPlanHash,
  validateInspectionSubmission,
} from './repair-document.contract';
import {
  type WorkflowItem,
  requireTechnicianCustody,
} from './repair-workflow.contract';

export const REPAIR_PROPOSAL_SCHEMA = 'corely.aftersales.workflow.v1' as const;
export const REPAIR_PROPOSAL_MAX_BYTES = 65536;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;

export type RepairProposal = {
  inspectionDocumentId: string;
  inspectionRevision: number;
  planVersion: number;
  planHash: string;
  original: {
    productId: string | null;
    sourceItemId: string;
    label: string;
    productName: string;
    sku: string | null;
    serialNumber: string | null;
    quantity: 1;
  };
  plan: InspectionData['plan'];
  planNote: string;
  replacementSku: string | null;
  replacementCondition: 'NEW' | 'REFURBISHED' | null;
  isUnderWarranty: boolean | null;
  isAccidentalDamage: boolean | null;
  feeMode: InspectionData['feeSuggestion'];
  amount: number | null;
  currency: string;
  estimateNote: string;
  summary: string;
  customerVisibleSummary: string;
  proposalHash: string;
};
export type RepairProposalEvent = {
  schema: typeof REPAIR_PROPOSAL_SCHEMA;
  kind: 'REPAIR_PROPOSAL';
  eventId: string;
  entityId: string;
  sourceCaseId: string;
  sourceNumber: string;
  itemId: string;
  receiptId: string;
  version: number;
  occurredAt: string;
  actor: { id: string; name: string };
  proposal: RepairProposal;
};
export type RepairProposalItem = WorkflowItem & {
  id: string;
  entityId: string;
  receiptId: string;
  version: number;
  label: string;
  productName: string;
  productId: string | null;
  sku: string | null;
  serialNumber: string | null;
  declared: unknown;
  receipt: WorkflowItem['receipt'] & {
    category: string;
    sourceCaseId: string | null;
    sourceNumber: string | null;
  };
};

const proposalKeys = [
  'inspectionDocumentId',
  'inspectionRevision',
  'planVersion',
  'planHash',
  'original',
  'plan',
  'planNote',
  'replacementSku',
  'replacementCondition',
  'isUnderWarranty',
  'isAccidentalDamage',
  'feeMode',
  'amount',
  'currency',
  'estimateNote',
  'summary',
  'customerVisibleSummary',
  'proposalHash',
];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('維修提案格式不符');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new BadRequestException('維修提案欄位不符');
}
function text(value: unknown, max = 200, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    throw new BadRequestException('維修提案文字不符');
  return value;
}
function nullableText(value: unknown, max = 200): string | null {
  return value === null ? null : text(value, max);
}
function assessment(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean')
    throw new BadRequestException('保固與人損判定必須為明確結果');
  return value;
}
function revision(value: unknown) {
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 2147483646
  )
    throw new BadRequestException('維修提案版本不符');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach((child: unknown) => freeze(child));
    Object.freeze(value);
  }
  return value;
}

// Keep the existing inspection hash unchanged: stock and factory bindings use it.
// This second hash binds that technical version to the real piece and its currency.
type ProposalHashInput = Pick<
  RepairProposalEvent,
  | 'schema'
  | 'kind'
  | 'entityId'
  | 'sourceCaseId'
  | 'sourceNumber'
  | 'itemId'
  | 'receiptId'
  | 'proposal'
>;
export function repairProposalHash(event: ProposalHashInput): string {
  const proposal: Partial<RepairProposal> = { ...event.proposal };
  delete proposal.proposalHash;
  return fingerprint({
    schema: event.schema,
    kind: event.kind,
    entityId: event.entityId,
    sourceCaseId: event.sourceCaseId,
    sourceNumber: event.sourceNumber,
    itemId: event.itemId,
    receiptId: event.receiptId,
    proposal,
  });
}

export function validateRepairProposalEvent(
  value: unknown,
): RepairProposalEvent {
  const event = object(value);
  exact(event, [
    'schema',
    'kind',
    'eventId',
    'entityId',
    'sourceCaseId',
    'sourceNumber',
    'itemId',
    'receiptId',
    'version',
    'occurredAt',
    'actor',
    'proposal',
  ]);
  if (
    event.schema !== REPAIR_PROPOSAL_SCHEMA ||
    event.kind !== 'REPAIR_PROPOSAL'
  )
    throw new BadRequestException('維修提案契約不符');
  for (const key of ['eventId', 'itemId', 'receiptId'])
    if (!uuid.test(text(event[key], 36)))
      throw new BadRequestException('維修提案實物識別不符');
  for (const key of ['entityId', 'sourceCaseId', 'sourceNumber'])
    text(event[key], 128);
  revision(event.version);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      text(event.occurredAt, 30),
    ) ||
    !Number.isFinite(Date.parse(String(event.occurredAt)))
  )
    throw new BadRequestException('維修提案時間不符');
  const actor = object(event.actor);
  exact(actor, ['id', 'name']);
  text(actor.id, 128);
  text(actor.name);
  const proposal = object(event.proposal);
  validateProposal(proposal);
  const typed = event as unknown as RepairProposalEvent;
  if (repairProposalHash(typed) !== proposal.proposalHash)
    throw new ConflictException('維修提案內容與雜湊不符');
  if (
    Buffer.byteLength(JSON.stringify(typed), 'utf8') > REPAIR_PROPOSAL_MAX_BYTES
  )
    throw new BadRequestException('維修提案超出大小限制');
  return freeze(structuredClone(typed));
}

function validateProposal(proposal: Record<string, unknown>) {
  exact(proposal, proposalKeys);
  text(proposal.inspectionDocumentId, 200);
  revision(proposal.inspectionRevision);
  revision(proposal.planVersion);
  if (
    proposal.planVersion !== proposal.inspectionRevision ||
    !digest.test(text(proposal.planHash, 64)) ||
    !digest.test(text(proposal.proposalHash, 64))
  )
    throw new BadRequestException('維修提案方案版次不符');
  const original = object(proposal.original);
  exact(original, [
    'productId',
    'sourceItemId',
    'label',
    'productName',
    'sku',
    'serialNumber',
    'quantity',
  ]);
  nullableText(original.productId, 128);
  text(original.sourceItemId);
  text(original.label);
  text(original.productName);
  nullableText(original.sku);
  nullableText(original.serialNumber);
  if (original.quantity !== 1)
    throw new BadRequestException('維修提案須逐件建立');
  if (
    !['REPAIR', 'REPLACE', 'FACTORY', 'RETURN', 'SCRAP'].includes(
      String(proposal.plan),
    )
  )
    throw new BadRequestException('維修提案方案不符');
  if (proposal.plan === 'REPLACE') {
    text(proposal.replacementSku, 100);
    if (!['NEW', 'REFURBISHED'].includes(String(proposal.replacementCondition)))
      throw new BadRequestException('換機提案須有替換品項與品況');
  } else if (
    proposal.replacementSku !== null ||
    proposal.replacementCondition !== null
  ) {
    throw new BadRequestException('非換機提案不能附替換品項');
  }
  for (const key of ['isUnderWarranty', 'isAccidentalDamage']) {
    if (proposal[key] !== null && typeof proposal[key] !== 'boolean')
      throw new BadRequestException('保固與人損判定格式不符');
  }
  const feeMode = proposal.feeMode;
  const amount = proposal.amount;
  if (
    !['FREE', 'PAID', 'REVIEW'].includes(String(feeMode)) ||
    (feeMode === 'REVIEW'
      ? amount !== null
      : typeof amount !== 'number' ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 10000000 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
        (feeMode === 'FREE' ? amount !== 0 : amount <= 0))
  )
    throw new BadRequestException('維修提案金額不符');
  if (!/^[A-Z]{3}$/.test(text(proposal.currency, 3)))
    throw new BadRequestException('維修提案幣別不符');
  text(proposal.planNote, 2000);
  text(proposal.estimateNote, 2000, feeMode !== 'PAID');
  text(proposal.summary, 2000);
  text(proposal.customerVisibleSummary, 2000, true);
}

function compactProposal(
  item: RepairProposalItem,
  source: SourceCase,
): RepairProposal {
  if (
    item.receipt.category !== 'REPAIR' ||
    source.type !== 'REPAIR' ||
    source.id !== item.receipt.sourceCaseId ||
    source.number !== item.receipt.sourceNumber
  )
    throw new ConflictException('維修提案來源案件不符');
  for (const id of [
    item.id,
    item.receiptId,
    item.entityId,
    source.id,
    source.number,
  ])
    text(id, 128);
  const doc = validateInspectionSubmission(item.repairInspection, true);
  const data = doc.data as InspectionData & {
    isUnderWarranty?: boolean | null;
    isAccidentalDamage?: boolean | null;
    customerVisibleSummary?: string;
  };
  const declared = object(item.declared);
  const sourceItemId = text(declared.id);
  if (!source.items.some((claim) => claim.id === sourceItemId))
    throw new ConflictException('維修提案來源品項不符');
  if (!source.releaseInfo?.currency)
    throw new ConflictException('請先確認此案件的估價幣別');
  const proposal: RepairProposal = {
    inspectionDocumentId: doc.number,
    inspectionRevision: doc.revision,
    planVersion: doc.revision,
    planHash: inspectionPlanHash(doc),
    original: {
      productId: item.productId,
      sourceItemId,
      label: item.label,
      productName: item.productName,
      sku: item.sku,
      serialNumber: item.serialNumber,
      quantity: 1,
    },
    plan: data.plan,
    planNote: data.planNote,
    replacementSku: data.plan === 'REPLACE' ? data.replacementSku! : null,
    replacementCondition:
      data.plan === 'REPLACE' ? data.replacementCondition! : null,
    isUnderWarranty: assessment(data.isUnderWarranty),
    isAccidentalDamage: assessment(data.isAccidentalDamage),
    feeMode: data.feeSuggestion,
    amount:
      data.feeSuggestion === 'REVIEW'
        ? null
        : data.feeSuggestion === 'FREE'
          ? 0
          : data.estimateAmount!,
    currency: source.releaseInfo.currency,
    estimateNote: data.estimateNote,
    summary: data.diagnosis,
    customerVisibleSummary: data.customerVisibleSummary ?? '',
    proposalHash: '',
  };
  proposal.proposalHash = repairProposalHash({
    schema: REPAIR_PROPOSAL_SCHEMA,
    kind: 'REPAIR_PROPOSAL',
    entityId: item.entityId,
    sourceCaseId: source.id,
    sourceNumber: source.number,
    itemId: item.id,
    receiptId: item.receiptId,
    proposal,
  });
  validateProposal(proposal);
  return freeze(proposal);
}

// A read projection only; the service still enforces current CSR or technician rights.
export function repairSourceBindingForItem(
  item: RepairProposalItem,
  source: SourceCase,
): {
  itemId: string;
  planVersion: number;
  planHash: string;
  proposalHash: string;
} {
  const proposal = compactProposal(item, source);
  return freeze({
    itemId: item.id,
    planVersion: proposal.planVersion,
    planHash: proposal.planHash,
    proposalHash: proposal.proposalHash,
  });
}

export function buildRepairProposalEvent(input: {
  eventId: string;
  occurredAt: string;
  actor: Actor;
  item: RepairProposalItem;
  source: SourceCase;
}): RepairProposalEvent {
  const { actor, item, source } = input;
  requireEntity(actor, item.entityId);
  requireTechnicianCustody(actor, item);
  if (
    item.status !== 'WAITING_CUSTOMER' ||
    ['CLOSED', 'CANCELLED', 'COMPLETED'].includes(source.status)
  )
    throw new ConflictException('此案件不能送出維修提案');
  const event: RepairProposalEvent = {
    schema: REPAIR_PROPOSAL_SCHEMA,
    kind: 'REPAIR_PROPOSAL',
    eventId: input.eventId,
    entityId: item.entityId,
    sourceCaseId: source.id,
    sourceNumber: source.number,
    itemId: item.id,
    receiptId: item.receiptId,
    version: item.version,
    occurredAt: input.occurredAt,
    actor: { id: actor.id, name: actor.name },
    proposal: compactProposal(item, source),
  };
  return validateRepairProposalEvent(event);
}
