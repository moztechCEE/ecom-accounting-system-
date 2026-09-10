import assert from 'node:assert/strict'
import test from 'node:test'
import {
  afterSalesFieldValue,
  afterSalesTypes,
  afterSalesStatuses,
} from '../src/utils/after-sales-display.ts'
import { loginDestination } from '../src/utils/login-destination.ts'
import type { User } from '../src/types/index.ts'

test('all six legacy case types and eighteen statuses are represented', () => {
  assert.equal(Object.keys(afterSalesTypes).length, 6)
  assert.equal(Object.keys(afterSalesStatuses).length, 18)
})
test('preserves missing, zero, false, exact monetary strings and unknown enum values', () => {
  assert.equal(afterSalesFieldValue('amount', null), '—')
  assert.equal(afterSalesFieldValue('amount', 0), '0')
  assert.equal(afterSalesFieldValue('amount', '0.00'), '0.00')
  assert.equal(afterSalesFieldValue('isRequired', false), '否')
  assert.equal(afterSalesFieldValue('status', 'UNRECOGNIZED'), 'UNRECOGNIZED')
})
test('legacy stock labels retain their original meaning', () => {
  assert.equal(
    afterSalesFieldValue('inventoryDisposition', 'WAREHOUSE'),
    '入工業',
  )
  assert.equal(
    afterSalesFieldValue('inventoryDisposition', 'NO_STOCK_IN'),
    '入民族',
  )
  assert.equal(
    afterSalesFieldValue('inventoryDisposition', 'SCRAPPED'),
    '不入庫',
  )
})
test('only authorized company-scoped customer service staff land in the workbench', () => {
  const user = {
    id: 'test',
    email: 'test@example.invalid',
    name: 'Test',
    roles: ['CUSTOMER_SERVICE'],
    permissions: ['after_sales_cases:read'],
    salesDataScope: 'ENTITY',
  } as User
  assert.equal(loginDestination(user), '/sales/after-sales')
  assert.equal(
    loginDestination({ ...user, roles: ['ADMIN', 'CUSTOMER_SERVICE'] }),
    '/dashboard',
  )
  assert.equal(loginDestination({ ...user, permissions: [] }), '/dashboard')
  assert.equal(
    loginDestination({ ...user, salesDataScope: 'SELF' }),
    '/dashboard',
  )
  assert.equal(
    loginDestination({ ...user, mustChangePassword: true }),
    '/auth/change-password',
  )
})
