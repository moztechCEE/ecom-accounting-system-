import assert from 'node:assert/strict'
import test from 'node:test'
import { activeNavigation, navigationLeaves, navigationParent, visibleNavigation } from '../src/config/navigation.ts'
import { afterSalesTypes } from '../src/utils/after-sales-display.ts'
import type { User } from '../src/types/index.ts'
import { loginDestination } from '../src/utils/login-destination.ts'

const admin = { roles: ['SUPER_ADMIN'], permissions: [] } as unknown as User
const staff = { roles: ['CUSTOMER_SERVICE'], permissions: ['after_sales_cases:read'] } as unknown as User
test('warehouse entry follows ERP permission without implying WMS access', () => {
  const warehouse = { roles: ['EMPLOYEE'], permissions: ['inventory:read'] } as unknown as User
  assert(visibleNavigation(warehouse).some(item => item.key === 'warehouse'))
  assert(!visibleNavigation(staff).some(item => item.key === 'warehouse'))
  assert.equal(loginDestination(warehouse), '/warehouse')
  assert.equal(loginDestination({ ...warehouse, mustChangePassword: true }), '/auth/change-password')
  assert.equal(loginDestination(admin), '/dashboard')
})
test('source after-sales types remain accessible without unrelated financial access', () => {
  const items = visibleNavigation(staff)
  const leaves = navigationLeaves(items)
  assert(items.some(item => item.key === 'service'))
  assert(!items.some(item => item.key === 'finance' || item.key === 'admin'))
  for (const type of Object.keys(afterSalesTypes)) {
    assert(leaves.some(item => new URLSearchParams(item.key.split('?')[1]).get('type') === type))
  }
  assert(!leaves.some(item => item.key.includes('/internal')))
})
test('specific source filters select the correct menu entry and parent', () => {
  const items = visibleNavigation(admin)
  const selected = activeNavigation(items, '/sales/after-sales', '?type=REPAIR&status=PENDING_QUOTE_CONFIRMATION&page=2')
  assert.equal(selected?.label, '維修報價')
  assert.equal(navigationParent(items, selected!.key), 'service')
  assert.equal(activeNavigation(items, '/sales/after-sales', '?type=REPAIR')?.label, '維修案件')
  assert.equal(activeNavigation(items, '/sales/after-sales', '')?.label, '案件工作台')
})
test('query and nested paths do not incorrectly select broad accounting links', () => {
  const items = visibleNavigation(admin)
  assert.equal(activeNavigation(items, '/accounting/workbench', '?focus=missing-invoices')?.label, '發票核對')
  assert.equal(activeNavigation(items, '/reconciliation/timeout', '')?.label, '逾期對帳')
  assert.equal(activeNavigation(items, '/reconciliations', ''), undefined)
})
test('no permission hides after-sales; company management remains super-admin only', () => {
  assert(!visibleNavigation({ ...staff, permissions: [] }).some(item => item.key === 'service'))
  assert(!navigationLeaves(visibleNavigation({ ...admin, roles: ['ADMIN'] })).some(item => item.key === '/admin/entities'))
  assert(navigationLeaves(visibleNavigation(admin)).some(item => item.key === '/admin/entities'))
})
