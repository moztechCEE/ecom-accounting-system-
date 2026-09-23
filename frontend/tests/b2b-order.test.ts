import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRequestInput, canConfirmRequest, canIssueQuote, formalQuotePath, isFormalQuoteExpired, quotePath, statusText } from '../src/pages/b2b/order.ts'
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

test('provisional and formal quote links use distinct login-protected routes', () => {
  assert.equal(quotePath('abc/def'), '/b2b/requests/abc%2Fdef')
  assert.equal(formalQuotePath('abc/def', 2), '/b2b/requests/abc%2Fdef/quote/2')
  assert.equal(statusText.pending_stock_review, '待人工核對庫存與交期')
})

test('formal quote requires full stock review; sales order requires explicit acceptance', () => {
  const base = { status: 'stock_confirmed' as const, quoteVersion: null, quoteStatus: null as 'sent' | 'accepted' | 'withdrawn' | null, salesOrderId: null, items: [{ quantity: 2, confirmedQuantity: 2 }] }
  assert(canIssueQuote(base))
  assert(!canIssueQuote({ ...base, items: [{ quantity: 2, confirmedQuantity: 1 }] }))
  assert(canIssueQuote({ ...base, quoteVersion: 1, quoteStatus: 'sent' }))
  assert(!canIssueQuote({ ...base, quoteVersion: 1, quoteStatus: 'accepted' }))
  assert(!canConfirmRequest(base))
  assert(!canConfirmRequest({ ...base, quoteVersion: 1, quoteStatus: 'sent' }))
  assert(!canConfirmRequest({ ...base, quoteStatus: 'accepted' }))
  assert(canConfirmRequest({ ...base, quoteVersion: 1, quoteStatus: 'accepted' }))
  assert(!canConfirmRequest({ ...base, quoteVersion: 1, quoteStatus: 'accepted', items: [{ quantity: 2, confirmedQuantity: 1 }] }))
  assert(!canConfirmRequest({ ...base, quoteVersion: 1, quoteStatus: 'accepted', status: 'needs_adjustment' }))
  assert(!canConfirmRequest({ ...base, quoteVersion: 1, quoteStatus: 'accepted', salesOrderId: 'existing' }))
  assert(!canConfirmRequest({ ...base, quoteVersion: 1, quoteStatus: 'accepted', items: [] }))
  assert(!canConfirmRequest({ ...base, quoteVersion: 1, quoteStatus: 'withdrawn' }))
  assert(canIssueQuote({ ...base, quoteVersion: 1, quoteStatus: 'withdrawn' }))
})

test('formal quote expiry matches API Taiwan midnight boundary', () => {
  assert.equal(isFormalQuoteExpired(null, Date.parse('2026-09-24T16:00:00Z')), false)
  assert.equal(isFormalQuoteExpired('2026-09-24', Date.parse('2026-09-24T15:59:59.999Z')), false)
  assert.equal(isFormalQuoteExpired('2026-09-24', Date.parse('2026-09-24T16:00:00.000Z')), true)
})
