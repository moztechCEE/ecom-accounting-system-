import assert from 'node:assert/strict'
import test from 'node:test'
import { customerPageParams, includeSelectedCustomer, parseCustomerPage } from '../src/services/customer-page.ts'

test('customer lookup sends a bounded, normalized server query', () => {
  assert.deepEqual(customerPageParams({ limit: 999, offset: 40, search: '  王先生  ' }), {
    limit: 100, offset: 40, search: '王先生',
  })
  assert.deepEqual(customerPageParams({ limit: 20, offset: -4, search: '   ' }), {
    limit: 20, offset: 0,
  })
})

test('paginated response cannot be mistaken for an old unbounded customer array', () => {
  assert.throws(() => parseCustomerPage([{ id: 'old' }]), /需要分頁資料/)
  assert.deepEqual(parseCustomerPage({
    rows: [{ id: 'customer-101' }], total: 45336, limit: 20, offset: 100,
    hasMore: true, nextOffset: 101,
  }).rows, [{ id: 'customer-101' }])
})

test('selected customer remains available when a later search page omits it', () => {
  const selected = { id: 'customer-45000', name: '已選客戶' }
  const rows = [{ id: 'customer-1', name: '其他客戶' }]
  assert.deepEqual(includeSelectedCustomer(rows, selected.id, selected), [selected, ...rows])
  assert.deepEqual(includeSelectedCustomer([selected, ...rows], selected.id, selected), [selected, ...rows])
})
