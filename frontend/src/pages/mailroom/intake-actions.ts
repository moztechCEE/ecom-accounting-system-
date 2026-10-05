import type { Item, Source } from './model';
export type IntakeAction = 'send_intake' | 'claim_intake' | 'bind_intake';
/** Server authorization is required in addition to the current actor and intake stage. */
export function hasIntakeAction(item: Item, action: IntakeAction, userId: string) {
  if (!userId || !item.allowedIntakeActions?.includes(action) || item.status !== 'RECEIVED' || item.receipt.category !== 'UNMATCHED' || item.receipt.sourceCaseId) return false;
  if (action === 'send_intake') return item.custodianId === userId && (!item.caseIntake || item.caseIntake.status === 'SENT');
  if (action === 'claim_intake') return item.caseIntake?.status === 'SENT' && item.caseIntake.sentToUserId === userId;
  return item.caseIntake?.status === 'ACCEPTED' && item.caseIntake.ownerId === userId;
}
export function intakeBindPayload(item: Item, source: Source | undefined, lineId: string, entityId: string, userId: string, note: string) {
  if (!hasIntakeAction(item, 'bind_intake', userId)) throw new Error('請先由指定客服本人接手，並重新載入交辦');
  if (!entityId || !source || !['REPAIR', 'RETURN'].includes(source.type) || !source.version?.trim()) throw new Error('請選擇有目前版次的維修或退貨來源案件');
  const line = source.items.find(value => value.id === lineId);
  if (!line || !Number.isInteger(line.quantity) || line.quantity < 1 || (line.remainingQuantity !== undefined && line.remainingQuantity < 1)) throw new Error('請選擇仍可收件的來源申報品項');
  if (!note.trim()) throw new Error('請記錄實物與案件對應的核對依據');
  return { action: 'bind_intake' as const, entityId, expectedVersion: item.version, sourceCaseId: source.id, sourceItemId: line.id, sourceVersion: source.version, targetCategory: source.type as 'REPAIR' | 'RETURN', note: note.trim() };
}
export function intakeSourceEntry(entityId: string, itemId: string) {
  return '/operations/after-sales/cases?' + new URLSearchParams({ entityId, intakeItemId: itemId }).toString();
}
export function intakeReturnEntry(entityId: string, itemId: string) {
  return '/operations/after-sales/workbench?' + new URLSearchParams({ entityId, intakeItemId: itemId }).toString();
}
/** A GET response acknowledges this operation only with its exact request/action and bound identities. */
export function matchesIntakeReceipt(item: Item, request: { requestId: string; action: IntakeAction; expectedVersion: number; csrUserId?: string; sourceCaseId?: string; sourceItemId?: string }, actorId: string) {
  const intake = item.caseIntake;
  if (!intake || intake.lastRequestId !== request.requestId || intake.lastAction !== request.action || item.version <= request.expectedVersion) return false;
  if (request.action === 'send_intake') return intake.status === 'SENT' && intake.sentToUserId === request.csrUserId;
  if (request.action === 'claim_intake') return intake.status === 'ACCEPTED' && intake.ownerId === actorId;
  return intake.status === 'RESOLVED' && intake.ownerId === actorId && intake.sourceCaseId === request.sourceCaseId && intake.sourceItemId === request.sourceItemId && item.receipt.sourceCaseId === request.sourceCaseId;
}
