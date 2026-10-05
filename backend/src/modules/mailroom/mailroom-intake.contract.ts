import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  can,
  requireEntity,
  requirePermission,
  type Actor,
  type ItemState,
} from './mailroom.contract';

export const INTAKE_ACTIONS = [
  'send_intake',
  'claim_intake',
  'bind_intake',
] as const;
export type IntakeAction = (typeof INTAKE_ACTIONS)[number];
export type CaseIntakeState = {
  status: 'SENT' | 'ACCEPTED' | 'RESOLVED';
  sentToUserId: string;
  sentToUserName: string;
  sentBy: string;
  sentAt: string;
  ownerId?: string;
  ownerName?: string;
  acceptedAt?: string;
  resolvedAt?: string;
  sourceCaseId?: string;
  sourceItemId?: string;
  sourceNumber?: string;
  sourceVersion?: string;
  note: string;
  lastAction?: IntakeAction;
  lastRequestId?: string;
};
export type IntakeCommand = {
  action: IntakeAction;
  entityId: string;
  expectedVersion: number;
  requestId: string;
  csrUserId?: string;
  targetCategory?: string;
  sourceCaseId?: string;
  sourceItemId?: string;
  sourceVersion?: string;
  note?: string;
};

export function caseIntake(value: unknown): CaseIntakeState | undefined {
  if (!value) return undefined;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new ConflictException('客服補建交辦格式不符，請核對');
  const branch = (value as { intake?: unknown }).intake;
  if (branch === undefined) return undefined;
  if (!branch || typeof branch !== 'object' || Array.isArray(branch))
    throw new ConflictException('客服補建交辦格式不符，請核對');
  const state = branch as CaseIntakeState;
  if (
    (state.lastAction !== undefined &&
      !INTAKE_ACTIONS.includes(state.lastAction)) ||
    (state.lastRequestId !== undefined &&
      (typeof state.lastRequestId !== 'string' ||
        !/^[A-Za-z0-9:_-]{8,80}$/.test(state.lastRequestId)))
  )
    throw new ConflictException('客服補建操作追蹤格式不符，請核對');
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length > 0 && v.length <= max;
  if (
    !text(state.sentToUserId, 128) ||
    !text(state.sentToUserName, 200) ||
    !text(state.sentBy, 128) ||
    !text(state.sentAt, 80) ||
    !text(state.note, 2000) ||
    [
      'ownerId',
      'ownerName',
      'acceptedAt',
      'resolvedAt',
      'sourceCaseId',
      'sourceItemId',
      'sourceNumber',
      'sourceVersion',
    ].some(
      (key) =>
        state[key as keyof CaseIntakeState] !== undefined &&
        !text(
          state[key as keyof CaseIntakeState],
          key === 'sourceVersion' ? 80 : 200,
        ),
    )
  )
    throw new ConflictException('客服補建交辦記錄格式不符，請核對');
  if (
    !['SENT', 'ACCEPTED', 'RESOLVED'].includes(state.status) ||
    !state.sentToUserId ||
    !state.sentBy ||
    !state.sentAt ||
    (state.status !== 'SENT' && (!state.ownerId || !state.acceptedAt)) ||
    (state.status === 'RESOLVED' &&
      (!state.sourceCaseId || !state.sourceItemId || !state.resolvedAt))
  )
    throw new ConflictException('客服補建交辦記錄不完整，請核對');
  return structuredClone(state);
}

/** Logistics-safe summary survives technical-document redaction. No free text or financial fields. */
export function caseIntakeSummary(value: unknown) {
  const state = caseIntake(value);
  if (!state) return null;
  return {
    status: state.status,
    lastAction: state.lastAction || null,
    lastRequestId: state.lastRequestId || null,
    sentToUserId: state.sentToUserId,
    sentToUserName: state.sentToUserName,
    sentBy: state.sentBy,
    sentAt: state.sentAt,
    ownerId: state.ownerId || null,
    ownerName: state.ownerName || null,
    acceptedAt: state.acceptedAt || null,
    resolvedAt: state.resolvedAt || null,
    sourceCaseId: state.sourceCaseId || null,
    sourceItemId: state.sourceItemId || null,
    sourceNumber: state.sourceNumber || null,
  };
}

export function isIntakeReader(actor: Actor, value: unknown) {
  const state = caseIntake(value);
  return (
    can(actor, 'mailroom:review') &&
    !!state &&
    (state.sentToUserId === actor.id || state.ownerId === actor.id)
  );
}

export function intakeTransition(
  item: ItemState & { repairWorkflow?: unknown },
  input: IntakeCommand,
  actor: Actor,
  target?: Actor,
): CaseIntakeState {
  requireEntity(actor, item.entityId);
  if (input.entityId !== item.entityId)
    throw new ForbiddenException('公司不符');
  if (input.expectedVersion !== item.version)
    throw new ConflictException('資料已更新，請重新整理後操作');
  const allowed = new Set([
    'action',
    'entityId',
    'requestId',
    'expectedVersion',
    'note',
    ...(input.action === 'send_intake' ? ['csrUserId'] : []),
    ...(input.action === 'bind_intake'
      ? ['targetCategory', 'sourceCaseId', 'sourceItemId', 'sourceVersion']
      : []),
  ]);
  if (
    Object.entries(input).some(
      ([key, value]) => value !== undefined && !allowed.has(key),
    )
  )
    throw new BadRequestException('客服補建交辦不能更改實物或其他作業欄位');
  if (
    item.status !== 'RECEIVED' ||
    item.receipt.category !== 'UNMATCHED' ||
    item.receipt.sourceCaseId
  )
    throw new ConflictException('只有尚未辨識的已收件物件可以交客服補建');
  const state = caseIntake(item.repairWorkflow);
  const now = new Date().toISOString();
  const operation = {
    lastAction: input.action,
    lastRequestId: input.requestId,
  };
  if (input.action === 'send_intake') {
    requirePermission(actor, 'mailroom:update');
    if (item.custodianId !== actor.id)
      throw new ForbiddenException('只有目前實物保管人可以交客服補建');
    if (!target || !input.csrUserId || target.id !== input.csrUserId)
      throw new BadRequestException('請指定有效且有建案權限的客服');
    if (!input.note?.trim()) throw new BadRequestException('請填寫補建原因');
    if (state && (state.status !== 'SENT' || state.sentToUserId === target.id))
      throw new ConflictException('客服已接手，或已交給同一位客服');
    return {
      ...operation,
      status: 'SENT',
      sentToUserId: target.id,
      sentToUserName: target.name,
      sentBy: actor.id,
      sentAt: now,
      note: input.note.trim(),
    } satisfies CaseIntakeState;
  }
  requirePermission(actor, 'mailroom:review');
  if (!state || state.sentToUserId !== actor.id)
    throw new ForbiddenException('這件補建交辦未指派給本人');
  if (input.action === 'claim_intake') {
    if (state.status !== 'SENT')
      throw new ConflictException('這件補建交辦已被接手');
    return {
      ...state,
      ...operation,
      status: 'ACCEPTED',
      ownerId: actor.id,
      ownerName: actor.name,
      acceptedAt: now,
    } satisfies CaseIntakeState;
  }
  if (input.action !== 'bind_intake')
    throw new BadRequestException('未知客服補建命令');
  if (state.status !== 'ACCEPTED' || state.ownerId !== actor.id)
    throw new ForbiddenException('須由本人接手後才能綁回案件');
  if (
    !['REPAIR', 'RETURN'].includes(input.targetCategory || '') ||
    !input.sourceCaseId ||
    !input.sourceItemId ||
    !input.sourceVersion
  )
    throw new BadRequestException('請選擇售後案件、申報品項與目前來源版次');
  if (!input.note?.trim())
    throw new BadRequestException('請填寫建案或綁定核對依據');
  return {
    ...state,
    ...operation,
    status: 'RESOLVED',
    resolvedAt: now,
    sourceCaseId: input.sourceCaseId,
    sourceItemId: input.sourceItemId,
    sourceVersion: input.sourceVersion,
    note: input.note.trim(),
  } satisfies CaseIntakeState;
}

export function allowedIntakeActions(
  item: ItemState,
  actor: Actor,
  sourceEligible = false,
): IntakeAction[] {
  if (
    item.entityId !== actor.entityIds?.find((id) => id === item.entityId) &&
    actor.entityIds !== null
  )
    return [];
  if (
    item.status !== 'RECEIVED' ||
    item.receipt.category !== 'UNMATCHED' ||
    item.receipt.sourceCaseId
  )
    return [];
  const state = caseIntake(item.repairWorkflow);
  const actions: IntakeAction[] = [];
  if (
    can(actor, 'mailroom:update') &&
    item.custodianId === actor.id &&
    (!state || state.status === 'SENT')
  )
    actions.push('send_intake');
  if (
    sourceEligible &&
    can(actor, 'mailroom:review') &&
    state?.sentToUserId === actor.id
  ) {
    if (state.status === 'SENT') actions.push('claim_intake');
    else if (state.status === 'ACCEPTED' && state.ownerId === actor.id)
      actions.push('bind_intake');
  }
  return actions;
}
