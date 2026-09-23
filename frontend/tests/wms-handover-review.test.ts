import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewHandoverLine } from '../src/pages/wms-handover-review.ts'
import type { HandoverLine } from '../src/services/wms-reconciliation.service.ts'

const line = (changes: Partial<HandoverLine> = {}): HandoverLine => ({
  id: 'handover-line', shipmentLineId: 'shipment-line', salesOrderLineId: 'sale-line',
  productId: 'product', sku: 'SKU', productName: '商品',
  quantity: 3, orderedQuantity: 5, postedQuantity: 2, status: 'pending',
  packages: [{ packageId: 'BOX-1', quantity: 2 }, { packageId: 'BOX-2', quantity: 1 }],
  ...changes,
})

test('exactly delivered remaining quantity is eligible for manual posting', () => {
  const result = reviewHandoverLine(line())
  assert.equal(result.blocking, false)
  assert.equal(result.label, '數量相符')
})

test('partial handover remains eligible while the original order balance stays open', () => {
  const result = reviewHandoverLine(line({ quantity: 2, postedQuantity: 1, packages: [{ packageId: 'BOX-1', quantity: 2 }] }))
  assert.equal(result.blocking, false)
  assert.equal(result.label, '本次部分交運')
})

test('missing or contradictory package evidence cannot be approved in the UI', () => {
  for (const packages of [[], [{ packageId: 'BOX-1', quantity: 2 }], [{ packageId: '', quantity: 3 }]]) {
    assert.equal(reviewHandoverLine(line({ packages })).blocking, true)
  }
})

test('over-delivery, exhausted balance and already posted events never expose approval', () => {
  assert.equal(reviewHandoverLine(line({ orderedQuantity: 4 })).blocking, true)
  assert.equal(reviewHandoverLine(line({ postedQuantity: 5 })).blocking, true)
  assert.equal(reviewHandoverLine(line({ status: 'posted' })).blocking, true)
})
