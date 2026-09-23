import assert from 'node:assert/strict'
import test from 'node:test'
import { canAccessRoute, effectiveAccess, groupPermissions, togglePermissionGroup } from '../src/utils/access-preview.ts'
import { navigationLeaves, visibleNavigation, workspaceNavigation } from '../src/config/navigation.ts'
import type { Permission, Role } from '../src/types/index.ts'

const permission = (id: string, resource: string, action = 'read'): Permission => ({ id, resource, action })
const role = (code: string, permissions: Permission[]): Role => ({
  id: code, code, name: code, hierarchyLevel: 3,
  permissions: permissions.map(p => ({ roleId: code, permissionId: p.id, permission: p })),
})

test('combines role permissions without duplicates and previews the actual navigation', () => {
  const employee = role('EMPLOYEE', [permission('expense', 'expense_self'), permission('profile', 'profile_self')])
  const accounting = role('FINANCE', [permission('expense', 'expense_self'), permission('accounts', 'accounts')])
  const access = effectiveAccess([employee, accounting])
  assert.equal(access.permissions.length, 3)
  const paths = navigationLeaves(visibleNavigation(access)).map(item => item.key)
  assert(paths.includes('/ap/expenses'))
  assert(paths.includes('/ap/expense-review'))
  assert(paths.includes('/accounting/workbench'))
  assert(!paths.includes('/admin/access-control'))
})

test('preview preserves warehouse operator personal-only workspace', () => {
  const access = effectiveAccess([role('WAREHOUSE_PICKER', [permission('tasks', 'wms_tasks'), permission('pick', 'wms_picking', 'execute'), permission('expense', 'expense_self')])])
  const paths = navigationLeaves(workspaceNavigation(access, 'all')).map(item => item.key)
  assert(paths.includes('/warehouse'))
  assert(paths.includes('/ap/expenses'))
  assert(!paths.includes('/dashboard'))
})

test('group toggles preserve hidden module selections and deduplicate values', () => {
  assert.deepEqual(togglePermissionGroup(['salary'], ['read', 'write'], true), ['salary', 'read', 'write'])
  assert.deepEqual(togglePermissionGroup(['salary', 'read', 'write'], ['read', 'write'], false), ['salary'])
  assert.deepEqual(togglePermissionGroup(['read'], ['read'], true), ['read'])
  assert.deepEqual(groupPermissions([permission('read', 'accounts'), permission('sales', 'sales_orders'), permission('write', 'accounts', 'update')]).map(g => [g.resource, g.permissions.length]), [['accounts', 2], ['sales_orders', 1]])
})

test('direct routes deny unauthenticated access and ADMIN cannot enter SUPER_ADMIN pages', () => {
  assert.equal(canAccessRoute(null), false)
  assert.equal(canAccessRoute(effectiveAccess([role('ADMIN', [])]), [], ['SUPER_ADMIN']), false)
  assert.equal(canAccessRoute(effectiveAccess([role('SUPER_ADMIN', [])]), [], ['SUPER_ADMIN']), true)
  const employee = effectiveAccess([role('EMPLOYEE', [permission('expense', 'expense_self')])])
  assert.equal(canAccessRoute(employee, ['expense_self:read', 'accounts:read']), true)
  assert.equal(canAccessRoute(employee, ['accounts:read']), false)
})

test('access managers can read their setup without acquiring financial read access', () => {
  const manager = effectiveAccess([role('ACCESS_MANAGER', [permission('manage', 'access_control', 'update')])])
  assert(canAccessRoute(manager, ['access_control:read']))
  assert(!canAccessRoute(manager, ['accounts:read']))
  const paths = navigationLeaves(visibleNavigation(manager)).map(item => item.key)
  assert(paths.includes('/admin/access-control'))
  assert(!paths.includes('/admin/settings'))
  assert(!paths.includes('/admin/reimbursement-items'))
})
