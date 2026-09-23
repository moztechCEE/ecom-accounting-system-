import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRequestInput, canConfirmRequest, quotePath, statusText } from '../src/pages/b2b/order.ts'
import type { B2BCatalogItem } from '../src/services/b2b.service.ts'

const catalog: B2BCatalogItem[] = [
  { productId: 'one', sku: 'ONE', name: 'Product One', description: null, unitPrice: '120.00', currency: 'TWD' },
  { productId: 'two', sku: 'TWO', name: 'Product Two', description: null, unitPrice: '300.00', currency: 'TWD' },
]

test('purchase request submits only visible product IDs and quantities, never client prices', () => {
  const input = buildRequestInput('request-id', '  PO-102  ', '  deliver next week  ', { one: 2, two: 0 }, catalog)
  assert.deepEqual(input, {
    requestId: 'request-id', customerPoNumber: 'PO-102', note: 'deliver next week',
    items: [{ productId: 'one', quantity: 2 }],
  })
  assert(!JSON.stringify(input).includes('120.00'))
})

test('invalid or hidden quantities cannot enter the purchase payload', () => {
  for (const quantities of [{ one: -1 }, { one: 1.5 }, { one: NaN }, { one: 100001 }, { hidden: 1 }]) {
    assert.throws(() => buildRequestInput('request-id', 'PO-102', '', quantities, catalog))
  }
  assert.throws(() => buildRequestInput('request-id', ' ', '', { one: 1 }, catalog))
  assert.throws(() => buildRequestInput('request-id', 'PO-102', '', { one: 0 }, catalog))
})

test('quote links point to a first-party login-protected route', () => {
  assert.equal(quotePath('abc/def'), '/b2b/requests/abc%2Fdef')
  assert.equal(statusText.pending_stock_review, '待人工核對庫存與交期')
})

test('only a fully reviewed request can be confirmed into a sales order', () => {
  const base = { status: 'stock_confirmed' as const, salesOrderId: null, items: [{ quantity: 2, confirmedQuantity: 2 }] }
  assert(canConfirmRequest(base))
  assert(!canConfirmRequest({ ...base, items: [{ quantity: 2, confirmedQuantity: 1 }] }))
  assert(!canConfirmRequest({ ...base, status: 'needs_adjustment' }))
  assert(!canConfirmRequest({ ...base, salesOrderId: 'existing' }))
  assert(!canConfirmRequest({ ...base, items: [] }))
})
