export type DispatchScope = { entityId: string; userId: string; itemId: string };
export type PendingDispatch = {
  entityId: string; requestId: string; expectedVersion: number; action: 'dispatch';
  carrier: string; trackingNumber: string; confirmedItems: true; note?: string;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function dispatchPendingKey(scope: DispatchScope) {
  if (![scope.entityId, scope.userId, scope.itemId].every(value => value.trim()))
    throw new Error('寄出操作缺少公司、人員或物件範圍');
  return 'corely.mailroom.dispatch.v1:' + [scope.entityId, scope.userId, scope.itemId].map(encodeURIComponent).join(':');
}

export function loadPendingDispatch(storage: StorageLike, scope: DispatchScope): PendingDispatch | null {
  const raw = storage.getItem(dispatchPendingKey(scope));
  if (raw === null) return null;
  const saved = JSON.parse(raw);
  const command = saved?.command;
  if (saved?.schema !== 1 || saved.entityId !== scope.entityId || saved.userId !== scope.userId || saved.itemId !== scope.itemId
    || !command || command.entityId !== scope.entityId || command.action !== 'dispatch' || command.confirmedItems !== true
    || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 || command.expectedVersion > 2147483646
    || typeof command.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(command.requestId)
    || ![command.carrier, command.trackingNumber].every(value => typeof value === 'string' && !!value.trim() && value.length <= 100)
    || (command.note !== undefined && (typeof command.note !== 'string' || command.note.length > 2000))
    || Object.keys(command).some(key => !['entityId', 'requestId', 'expectedVersion', 'action', 'carrier', 'trackingNumber', 'confirmedItems', 'note'].includes(key)))
    throw new Error('待核對寄出紀錄格式或範圍不符，請人工核對原操作');
  return command as PendingDispatch;
}

/** Store and read back before sending. Only the narrow logistics request is persisted. */
export function savePendingDispatch(storage: StorageLike, scope: DispatchScope, command: PendingDispatch) {
  const record = JSON.stringify({ schema: 1, ...scope, command });
  const key = dispatchPendingKey(scope);
  storage.setItem(key, record);
  if (storage.getItem(key) !== record) throw new Error('無法安全保存本次寄出操作識別碼');
  loadPendingDispatch(storage, scope);
}
export function clearPendingDispatch(storage: StorageLike, scope: DispatchScope) {
  storage.removeItem(dispatchPendingKey(scope));
}
