import assert from 'node:assert/strict'
import test from 'node:test'
import { availableProcurementLines, remainingProcurementQuantity } from '../src/pages/b2b/procurement.ts'
import type { B2BProcurementSummary } from '../src/services/purchase.service.ts'

const summary = (requiresFreshReview: boolean): B2BProcurementSummary => ({
  requiresFreshReview,
  items: [{ requestItemId: 'line-1', requested: 2, confirmed: 0, shortage: 2, ordered: 0 }],
  purchaseOrders: [{ id: 'received-po', status: 'received', vendorName: 'Supplier', createdAt: '2026-09-24T00:00:00Z' }],
})

test('received stock awaiting human review cannot be offered for another source PO', () => {
  const stale = summary(true)
  assert.equal(remainingProcurementQuantity(stale, stale.items[0]), null)
  assert.deepEqual(availableProcurementLines(stale), [])
})

test('fresh review restores only the currently unfilled shortage for procurement', () => {
  const reviewed = summary(false)
  assert.equal(remainingProcurementQuantity(reviewed, reviewed.items[0]), 2)
  assert.deepEqual(availableProcurementLines(reviewed), reviewed.items)
  reviewed.items[0].ordered = 2
  assert.equal(remainingProcurementQuantity(reviewed, reviewed.items[0]), 0)
  assert.deepEqual(availableProcurementLines(reviewed), [])
})
