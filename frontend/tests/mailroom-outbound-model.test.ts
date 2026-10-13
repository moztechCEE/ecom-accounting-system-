import assert from 'node:assert/strict'
import test from 'node:test'
import { canOutboundAction, clearOutboundPending, matchesOutboundResult, outboundLines, outboundPendingKey, outboundRemaining, readOutboundPending, saveOutboundPending } from '../src/pages/mailroom/mailroom-outbound-model.ts'
import type { OutboundPending } from '../src/pages/mailroom/mailroom-outbound-model.ts'
import type { OutboundOrder, OutboundSourceOrder } from '../src/services/mailroom-outbound.ts'

const source: OutboundSourceOrder = { id: 'source-a', number: 'CASE-A', type: 'RESHIPMENT', version: '2026-10-13T00:00:00Z', sourceChannel: 'LINE', brand: 'MOZTECH', customerLabel: 'Synthetic', dispatchAllowed: true, blockReason: null,
  items: [{ id: 'line-a', name: 'A', sku: 'SKU-A', quantity: 3, dispatchedQuantity: 1 }, { id: 'line-b', name: 'B', sku: 'SKU-B', quantity: 2, dispatchedQuantity: 0 }], recipient: { name: 'Synthetic', phone: '0900000000', address: 'Synthetic' } }
const order: OutboundOrder = { id: 'order-a', entityId: 'entity-a', sourceCaseId: source.id, sourceNumber: source.number, caseType: source.type, sourceVersion: source.version, status: 'PENDING_PICK', version: 1,
  location: null, custodianId: null, custodianName: null, nextUserId: null, nextUserName: null, items: [], outboundShipment: null, sourceSync: { status: 'NOT_DISPATCHED', attempts: 0 }, availableActions: ['prepare', 'cancel'] }
const pending: OutboundPending = { schema: 'corely.mailroom.outbound.pending.v1', actorId: 'actor-a', entityId: 'entity-a', kind: 'action', orderId: order.id, requestId: '11111111-1111-4111-8111-111111111111',
  body: JSON.stringify({ entityId: 'entity-a', requestId: '11111111-1111-4111-8111-111111111111', expectedVersion: 1, action: 'dispatch', carrier: 'Synthetic', trackingNumber: 'SYNTHETIC-1', confirmedItems: true }) }
function storage() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
test('partial shipment retains exact source line identities and rejects quantities beyond outstanding units', () => {
  assert.deepEqual(outboundLines(source, { 'line-a': 1, 'line-b': 0 }), [{ sourceCaseItemId: 'line-a', quantity: 1 }])
  for (const quantities of [{ 'line-a': 3 }, { 'line-a': 1.5 }, { 'line-a': -1 }, { 'line-a': NaN }, { 'foreign-line': 1 }, { 'line-a': 0, 'line-b': 0 }]) assert.throws(() => outboundLines(source, quantities))
  assert.throws(() => outboundLines({ ...source, dispatchAllowed: false, blockReason: '付款尚未核對' }, { 'line-a': 1 }), /付款尚未核對/)
})
test('planned units reduce what can be newly allocated without labelling them dispatched', () => {
  const planned = { ...source, items: [{ ...source.items[0], plannedQuantity: 1 }] }
  assert.equal(outboundRemaining(planned.items[0]), 1)
  assert.equal(planned.items[0].dispatchedQuantity, 1)
  assert.deepEqual(outboundLines(planned, { 'line-a': 1 }), [{ sourceCaseItemId: 'line-a', quantity: 1 }])
  assert.throws(() => outboundLines(planned, { 'line-a': 2 }), /尚未安排/)
  assert.throws(() => outboundLines({ ...planned, items: [{ ...planned.items[0], plannedQuantity: 2 }] }, { 'line-a': 0 }), /至少/)
})
test('mailroom grant alone cannot post inventory and server action availability always applies', () => {
  assert.equal(canOutboundAction(order, 'prepare', 'actor-a', { mailroom: true, inventory: false }), false)
  assert.equal(canOutboundAction(order, 'prepare', 'actor-a', { mailroom: false, inventory: true }), true)
  assert.equal(canOutboundAction({ ...order, availableActions: [] }, 'prepare', 'actor-a', { mailroom: true, inventory: true }), false)
  assert.equal(canOutboundAction(order, 'cancel', 'actor-a', { mailroom: false, inventory: true }), false)
})
test('source refresh and sync retry stay separate from physical issue, acceptance and dispatch', () => {
  const live = { ...order, availableActions: ['refresh_source'] }
  assert.equal(canOutboundAction(live, 'refresh_source', 'actor-a', { mailroom: true, inventory: false }), true)
  assert.equal(canOutboundAction(live, 'refresh_source', 'actor-a', { mailroom: false, inventory: true }), false)
  assert.equal(canOutboundAction({ ...live, status: 'DISPATCHED' }, 'refresh_source', 'actor-a', { mailroom: true, inventory: true }), false)
  assert.equal(canOutboundAction({ ...live, status: 'CANCELLED' }, 'refresh_source', 'actor-a', { mailroom: true, inventory: true }), false)
  const sent = { ...order, status: 'DISPATCHED' as const, availableActions: ['retry_sync'] }
  assert.equal(canOutboundAction(sent, 'retry_sync', 'actor-a', { mailroom: true, inventory: false }), true)
  assert.equal(canOutboundAction(sent, 'dispatch', 'actor-a', { mailroom: true, inventory: true }), false)
})
test('acceptance and dispatch are restricted to the exact assigned person and current custodian', () => {
  const waiting = { ...order, status: 'WAITING_MAILROOM_ACCEPTANCE' as const, nextUserId: 'clerk-a', availableActions: ['accept'] }
  assert.equal(canOutboundAction(waiting, 'accept', 'clerk-a', { mailroom: true, inventory: false }), true)
  assert.equal(canOutboundAction(waiting, 'accept', 'clerk-b', { mailroom: true, inventory: true }), false)
  const ready = { ...order, status: 'READY_FOR_DISPATCH' as const, custodianId: 'clerk-a', availableActions: ['dispatch'] }
  assert.equal(canOutboundAction(ready, 'dispatch', 'clerk-a', { mailroom: true, inventory: false }), true)
  assert.equal(canOutboundAction(ready, 'dispatch', 'clerk-b', { mailroom: true, inventory: true }), false)
  assert.equal(canOutboundAction({ ...ready, status: 'DISPATCHED' }, 'dispatch', 'clerk-a', { mailroom: true, inventory: true }), false)
})
test('unknown mutation replays the original body and UUID after remount and remains isolated by actor and company', () => {
  const local = storage(); saveOutboundPending(local, pending)
  assert.deepEqual(readOutboundPending(local, pending.actorId, pending.entityId), pending)
  assert.equal(readOutboundPending(local, 'other-actor', pending.entityId), null)
  assert.equal(readOutboundPending(local, pending.actorId, 'other-entity'), null)
  assert.throws(() => saveOutboundPending(local, { ...pending, requestId: 'different' }))
  assert.throws(() => saveOutboundPending(local, { ...pending, body: pending.body.replace('SYNTHETIC-1', 'SYNTHETIC-2') }))
  assert.deepEqual(readOutboundPending(local, pending.actorId, pending.entityId), pending)
})
test('a foreign or stale response cannot clear a pending action; failed storage writes fail closed', () => {
  assert.equal(matchesOutboundResult({ ...order, version: 2 }, pending), true)
  for (const result of [{ ...order, version: 1 }, { ...order, version: 2, id: 'other-order' }, { ...order, version: 2, entityId: 'other-entity' }]) assert.equal(matchesOutboundResult(result, pending), false)
  const local = storage(); saveOutboundPending(local, pending)
  assert.throws(() => clearOutboundPending(local, { ...pending, body: '{}' }))
  clearOutboundPending(local, pending); assert.equal(readOutboundPending(local, pending.actorId, pending.entityId), null)
  const broken = { ...storage(), setItem: () => {} }; assert.throws(() => saveOutboundPending(broken, pending), /未能保存/)
  local.values.set(outboundPendingKey(pending.actorId, pending.entityId), 'null'); assert.throws(() => readOutboundPending(local, pending.actorId, pending.entityId), /無法讀取/)
  local.values.set(outboundPendingKey(pending.actorId, pending.entityId), JSON.stringify({ ...pending, kind: 'create', body: JSON.stringify({ entityId: pending.entityId, requestId: pending.requestId, sourceCaseId: 'source-a' }) })); assert.throws(() => readOutboundPending(local, pending.actorId, pending.entityId), /不符/)
})
