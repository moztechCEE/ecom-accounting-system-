import type { OutboundAction, OutboundCommand, OutboundOrder, OutboundRegistration, OutboundSourceOrder } from '../../services/mailroom-outbound'

export class OutboundClientError extends Error {}

export const OUTBOUND_STATUS = { PENDING_PICK: '待備貨', WAITING_MAILROOM_ACCEPTANCE: '待收發點收', READY_FOR_DISPATCH: '待交物流', DISPATCHED: '已交物流', CANCELLED: '已取消' }
export const OUTBOUND_TYPES = { RESHIPMENT: '補寄', PRIVATE_PURCHASE: '商品／配件訂購', EXCHANGE_RETURN: '換貨' }
export const OUTBOUND_SYNC = { NOT_DISPATCHED: '尚未寄出', PENDING: '同步中', DELIVERED: '已同步售後', FAILED: '同步失敗' }
export function outboundStep(order: Pick<OutboundOrder, 'status'>) {
  return order.status === 'PENDING_PICK' ? 0 : order.status === 'WAITING_MAILROOM_ACCEPTANCE' ? 1 : 2
}
export function canOutboundAction(order: OutboundOrder, action: OutboundAction, actorId: string, grants: { mailroom: boolean; inventory: boolean }) {
  if (!actorId || !order.availableActions.includes(action)) return false
  if (action === 'prepare') return order.status === 'PENDING_PICK' && grants.inventory
  if (action === 'accept') return order.status === 'WAITING_MAILROOM_ACCEPTANCE' && order.nextUserId === actorId && grants.mailroom
  if (action === 'dispatch') return order.status === 'READY_FOR_DISPATCH' && order.custodianId === actorId && grants.mailroom
  if (action === 'retry_sync') return order.status === 'DISPATCHED' && grants.mailroom
  if (action === 'refresh_source') return !['DISPATCHED', 'CANCELLED'].includes(order.status) && grants.mailroom
  return order.status === 'PENDING_PICK' && grants.mailroom
}
export const outboundRemaining = (item: OutboundSourceOrder['items'][number]) => item.quantity - item.dispatchedQuantity - (item.plannedQuantity ?? 0)
export function outboundLines(source: OutboundSourceOrder, quantities: Record<string, number | null | undefined>) {
  if (!source.dispatchAllowed) throw new OutboundClientError(source.blockReason || '此案件尚未開放出貨')
  const known = new Set(source.items.map(item => item.id))
  if (known.size !== source.items.length || Object.keys(quantities).some(id => !known.has(id))) throw new OutboundClientError('品項已變更，請重新載入案件')
  const lines = source.items.flatMap(item => {
    const quantity = quantities[item.id] ?? 0
    const remaining = outboundRemaining(item)
    if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(item.plannedQuantity ?? 0) || (item.plannedQuantity ?? 0) < 0 || !Number.isSafeInteger(remaining) || remaining < 0 || quantity > remaining)
      throw new OutboundClientError('出貨數量須為整數，且不可超過尚未安排的數量')
    if (quantity && !item.sku?.trim()) throw new OutboundClientError('售後品項尚未提供 SKU，請先由客服確認商品')
    return quantity ? [{ sourceCaseItemId: item.id, quantity }] : []
  })
  if (!lines.length) throw new OutboundClientError('請至少選擇一件本次出貨品項')
  if (lines.reduce((sum, line) => sum + line.quantity, 0) > 200) throw new OutboundClientError('每張出貨單最多 200 件，請分批建立')
  return lines
}

export type OutboundPending = { schema: 'corely.mailroom.outbound.pending.v1'; actorId: string; entityId: string;
  kind: 'create' | 'action'; orderId?: string; requestId: string; body: string }
export type OutboundStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const outboundPendingKey = (actorId: string, entityId: string) => 'corely.mailroom.outbound.pending.v1:' + [actorId, entityId].map(encodeURIComponent).join(':')
export function readOutboundPending(storage: OutboundStorage, actorId: string, entityId: string): OutboundPending | null {
  const raw = storage.getItem(outboundPendingKey(actorId, entityId))
  if (!raw) return null
  let value: OutboundPending, payload: OutboundRegistration | OutboundCommand
  try { value = JSON.parse(raw) as OutboundPending; if (!value || typeof value !== 'object') throw new Error(); payload = JSON.parse(value.body) as typeof payload; if (!payload || typeof payload !== 'object') throw new Error() } catch { throw new OutboundClientError('待確認出貨紀錄無法讀取，請由主管核對') }
  if (value.schema !== 'corely.mailroom.outbound.pending.v1' || value.actorId !== actorId || value.entityId !== entityId
    || !['create', 'action'].includes(value.kind) || typeof value.body !== 'string' || !value.requestId
    || payload.entityId !== entityId || payload.requestId !== value.requestId || value.kind === 'action' && !value.orderId
    || value.kind === 'create' && (!('sourceCaseId' in payload) || typeof payload.sourceCaseId !== 'string' || !payload.sourceCaseId || typeof payload.sourceVersion !== 'string' || !Array.isArray(payload.lines) || !payload.lines.length || payload.lines.some(line => !line || typeof line.sourceCaseItemId !== 'string' || !line.sourceCaseItemId || !Number.isSafeInteger(line.quantity) || line.quantity < 1))
    || value.kind === 'action' && (!('action' in payload) || !['prepare', 'accept', 'dispatch', 'cancel', 'retry_sync', 'refresh_source'].includes(payload.action) || !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1))
    throw new OutboundClientError('待確認出貨紀錄不符，請由主管核對')
  return value
}
export function saveOutboundPending(storage: OutboundStorage, value: OutboundPending) {
  const previous = readOutboundPending(storage, value.actorId, value.entityId)
  if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new OutboundClientError('已有待確認操作，請先核對原操作')
  const raw = JSON.stringify(value), key = outboundPendingKey(value.actorId, value.entityId)
  storage.setItem(key, raw)
  if (storage.getItem(key) !== raw) throw new OutboundClientError('原操作未能保存，尚未送出')
}
export function clearOutboundPending(storage: OutboundStorage, value: OutboundPending) {
  const previous = readOutboundPending(storage, value.actorId, value.entityId)
  if (!previous || previous.requestId !== value.requestId || previous.body !== value.body) throw new OutboundClientError('原操作回執尚未核對')
  storage.removeItem(outboundPendingKey(value.actorId, value.entityId))
  if (storage.getItem(outboundPendingKey(value.actorId, value.entityId)) !== null) throw new OutboundClientError('原操作紀錄未能清除，請再核對')
}
export function matchesOutboundResult(order: OutboundOrder, pending: OutboundPending) {
  if (!order?.id || order.entityId !== pending.entityId) return false
  const payload = JSON.parse(pending.body) as OutboundRegistration & OutboundCommand
  return pending.kind === 'create' ? order.sourceCaseId === payload.sourceCaseId
    : order.id === pending.orderId && Number.isSafeInteger(order.version) && order.version > payload.expectedVersion
}
