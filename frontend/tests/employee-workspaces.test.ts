import assert from 'node:assert/strict'
import test from 'node:test'
import type { User } from '../src/types/index.ts'
import { availableOperationsWorkspaces, operationsWorkspace, savePreferredOperationsWorkspace,
  preferredOperationsWorkspace, workspacePreferenceKey, operationsWorkspaceDestination, workspaceCompanyId, companyNavigationDestination } from '../src/config/workspaces.ts'
import { loginDestination } from '../src/utils/login-destination.ts'
import { navigationLeaves, workspaceNavigation } from '../src/config/navigation.ts'

Object.defineProperty(globalThis, 'window', { value: { __APP_CONFIG__: {
  mailroomEnabled: true, afterSalesModuleEnabled: true, stagedOperationsEnabled: true,
}}, configurable: true })
const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
}, configurable: true })
const csr = { id: 'csr', name: 'CSR', email: 'csr@example.invalid', roles: ['CUSTOMER_SERVICE'],
  salesDataScope: 'ENTITY', permissions: ['after_sales_cases:read', 'after_sales_cases:update',
    'profile_self:read', 'payroll_self:read'],
} as User

test('customer service and sales use the dedicated case workbench without depending on role name', () => {
  memory.clear()
  for (const roles of [['CUSTOMER_SERVICE'], ['SALES'], ['EMPLOYEE']]) {
    const user = { ...csr, roles }
    assert.equal(loginDestination(user), '/operations/after-sales/workbench')
    assert.equal(operationsWorkspace(user, '/profile'), 'after-sales')
    const paths = navigationLeaves(workspaceNavigation(user, 'after-sales')).map(item => item.key)
    assert(paths.includes('/operations/after-sales/cases'))
    assert(!paths.some(path => ['/operations/mailroom', '/operations/repair', '/banking',
      '/inventory/products', '/operations/after-sales/products', '/operations/after-sales/faqs'].includes(path)))
    assert.equal(navigationLeaves(workspaceNavigation(user, 'after-sales')).find(item => item.key === '/payroll/runs')?.label, '我的薪資')
  }
})
test('mixed duties can switch all authorized workbenches without changing permissions', () => {
  const mixed = { ...csr, permissions: [...csr.permissions, 'mailroom:read', 'repair_workbench:read'] }
  assert.deepEqual(availableOperationsWorkspaces(mixed), ['after-sales', 'mailroom', 'repair'])
  assert.equal(operationsWorkspace(mixed, '/operations/mailroom'), 'mailroom')
  assert.equal(operationsWorkspace(mixed, '/operations/repair'), 'repair')
  assert.deepEqual(navigationLeaves(workspaceNavigation(mixed, 'mailroom')).filter(item => item.key.startsWith('/operations/')).map(item => item.key), ['/operations/mailroom'])
  assert.deepEqual(navigationLeaves(workspaceNavigation(mixed, 'repair')).filter(item => item.key.startsWith('/operations/')).map(item => item.key), ['/operations/repair'])
  assert(!availableOperationsWorkspaces(csr).includes('mailroom'))
})
test('specialized workbenches keep existing authorized management functions reachable', () => {
  const manager = { ...csr, permissions: [...csr.permissions, 'after_sales_products:read',
    'after_sales_imports:read', 'after_sales_audit:read', 'after_sales_settings:read', 'after_sales_users:read'] }
  assert.deepEqual(availableOperationsWorkspaces(manager), ['after-sales', 'all'])
  const managementPaths = navigationLeaves(workspaceNavigation(manager, 'all')).map(item => item.key)
  for (const section of ['products', 'imports', 'audit-logs', 'settings', 'users']) {
    assert(managementPaths.includes('/operations/after-sales/' + section))
  }
  assert(!navigationLeaves(workspaceNavigation(manager, 'after-sales')).some(item => item.key.endsWith('/products')))
  const warehouseManager = { ...csr, permissions: ['wms_tasks:read', 'wms_logs:read'], roles: ['EMPLOYEE'] }
  assert.deepEqual(availableOperationsWorkspaces(warehouseManager), ['warehouse', 'all'])
  assert(navigationLeaves(workspaceNavigation(warehouseManager, 'all')).some(item => item.key === '/warehouse/logs'))
})
test('default landing is employee and company scoped, ignores revoked grants, and cannot skip password change', () => {
  memory.clear(); memory.set('entityId', 'company-a')
  const mixed = { ...csr, permissions: [...csr.permissions, 'mailroom:read'] }
  assert(savePreferredOperationsWorkspace(mixed, 'company-a', 'mailroom'))
  assert.equal(loginDestination(mixed), '/operations/mailroom')
  assert.equal(preferredOperationsWorkspace(mixed, 'company-b'), undefined)
  assert.equal(preferredOperationsWorkspace({ ...mixed, id: 'another' }, 'company-a'), undefined)
  assert.equal(preferredOperationsWorkspace(csr, 'company-a'), undefined)
  assert.equal(loginDestination(csr), '/operations/after-sales/workbench')
  assert(!savePreferredOperationsWorkspace(csr, 'company-a', 'repair'))
  assert.equal(loginDestination({ ...mixed, mustChangePassword: true }), '/auth/change-password')
  const key = workspacePreferenceKey(mixed, 'company-a')!
  memory.set(key, '/external-or-unknown')
  assert.equal(preferredOperationsWorkspace(mixed, 'company-a'), undefined)
})
test('source company scope and feature flags gate the new workbench without widening backend access', () => {
  memory.clear()
  for (const user of [{ ...csr, salesDataScope: 'SELF' }, { ...csr, salesDataScope: 'DEPARTMENT' },
    { ...csr, roles: ['ADMIN'], salesDataScope: 'SELF' }]) {
    assert(!availableOperationsWorkspaces(user as User).includes('after-sales'))
  }
  const config = window.__APP_CONFIG__
  try {
    window.__APP_CONFIG__ = { ...config, afterSalesModuleEnabled: false }
    assert(!availableOperationsWorkspaces(csr).includes('after-sales'))
    assert.equal(loginDestination(csr), '/sales/after-sales')
  } finally { window.__APP_CONFIG__ = config }
})
test('workbench switches and browser preference keep an explicitly selected company', () => {
  memory.clear(); memory.set('entityId', 'company-a')
  assert.equal(workspaceCompanyId('?entityId=company-b&intakeItemId=receipt'), 'company-b')
  for (const workspace of ['after-sales', 'mailroom', 'repair', 'all'] as const) {
    assert.equal(new URL(operationsWorkspaceDestination(workspace, '?entityId=company-b&intakeItemId=receipt'), 'https://example.invalid').search, '?entityId=company-b')
  }
  assert.equal(workspaceCompanyId(''), 'company-a')
  assert.equal(operationsWorkspaceDestination('mailroom', ''), '/operations/mailroom')
  const config = window.__APP_CONFIG__
  try {
    window.__APP_CONFIG__ = { ...config, stagedOperationsEnabled: false }
    assert.deepEqual(availableOperationsWorkspaces({ ...csr, permissions: [...csr.permissions, 'mailroom:read', 'repair_workbench:read'] }), ['after-sales', 'mailroom', 'repair'])
  } finally { window.__APP_CONFIG__ = config }
})


test('warehouse managers select and remember the station workspace while explicit destination company stays intact', () => {
  memory.clear(); memory.set('entityId', 'company-a')
  const user = { ...csr, permissions: ['wms_tasks:read', 'wms_overview:read'] }
  const destination = operationsWorkspaceDestination('warehouse', '?entityId=company-b', user)
  assert.equal(destination, '/warehouse/workstation?entityId=company-b')
  assert.equal(operationsWorkspace(user, new URL(destination, 'https://example.invalid').pathname), 'warehouse')
  assert(savePreferredOperationsWorkspace(user, 'company-a', 'warehouse'))
  assert.equal(loginDestination(user), '/warehouse/workstation')
  assert.equal(companyNavigationDestination('/operations/repair?queue=mine', '?entityId=company-b'), '/operations/repair?queue=mine&entityId=company-b')
  assert.equal(companyNavigationDestination('/operations/repair?entityId=company-c', '?entityId=company-b'), '/operations/repair?entityId=company-c')
})
