import assert from 'node:assert/strict'
import test from 'node:test'
import { activeNavigation, navigationLeaves, navigationParent, visibleNavigation, workspaceNavigation } from '../src/config/navigation.ts'
import { warehouseAreas, warehouseOnlyUser, isWarehousePath, hasWarehouseManagementAccess, warehouseWorkspace, repairOnlyUser, operationsWorkspace } from '../src/config/workspaces.ts'
import { afterSalesTypes } from '../src/utils/after-sales-display.ts'
import type { User } from '../src/types/index.ts'
import { loginDestination } from '../src/utils/login-destination.ts'
import { stagedOperationsEnabled } from '../src/config/release.ts'
import { getResourceName, getRoleName } from '../src/constants/translations.ts'
import { canAccessRoute } from '../src/utils/access-preview.ts'

Object.defineProperty(globalThis, 'window', {value:{__APP_CONFIG__:{stagedOperationsEnabled:true}},configurable:true})

const admin = { roles: ['SUPER_ADMIN'], permissions: [] } as unknown as User
const staff = { roles: ['CUSTOMER_SERVICE'], permissions: ['after_sales_cases:read'] } as unknown as User
const repairTechnician = {
  roles: ['REPAIR_TECHNICIAN'],
  permissions: ['repair_workbench:read', 'repair_workbench:update', 'profile_self:read'],
} as unknown as User
function withMailroomEnabled<T>(enabled: boolean, run: () => T): T {
  const previous = window.__APP_CONFIG__
  window.__APP_CONFIG__ = { ...previous, mailroomEnabled: enabled }
  try { return run() } finally { window.__APP_CONFIG__ = previous }
}
test('purchasing-only staff can open shortage procurement without the sales workbench', () => {
  const purchasing = { ...staff, permissions: ['purchase_orders:read', 'purchase_orders:create'] }
  const leaves = navigationLeaves(visibleNavigation(purchasing))
  assert(leaves.some((item) => item.key === '/purchasing/b2b-shortages'))
  assert(leaves.some((item) => item.key === '/purchasing/supplier-accounts'))
  assert(!leaves.some((item) => item.key === '/sales/b2b'))
})
test('SN label drafts belong to purchasing/inventory and respect inventory read access', () => {
  const inventory = { ...staff, permissions: ['inventory:read'] }
  const items = visibleNavigation(inventory)
  assert.equal(navigationParent(items, '/inventory/sn-labels'), 'inventory')
  assert.equal(activeNavigation(items, '/inventory/sn-labels', '')?.label, 'SN 與標籤')
  assert(!navigationLeaves(visibleNavigation(staff)).some(i => i.key === '/inventory/sn-labels'))
})
test('UI-only release preserves existing after-sales entry and excludes staged commands',()=>{
  const leaves=navigationLeaves(visibleNavigation(admin,undefined,false))
  assert.equal(leaves.find(i=>i.key==='/sales/after-sales')?.label,'來回件')
  assert(!leaves.some(i=>i.key==='/sales/after-sales/quotes'||i.key==='/admin/after-sales-brands'||i.key==='/warehouse/workstation'))
  assert.equal(leaves.filter(i=>i.key.startsWith('/warehouse/')).length,4)
  assert(navigationLeaves(visibleNavigation({...staff,permissions:['sales_orders:read']},undefined,false)).some(i=>i.key==='/sales/after-sales'))
  const config=window.__APP_CONFIG__
  try {window.__APP_CONFIG__=undefined;assert.equal(stagedOperationsEnabled(),false)} finally {window.__APP_CONFIG__=config}
})
test('manager reports stay separate from picker and packer workstations',()=>{
  assert(isWarehousePath('/warehouse/logs'));assert(!isWarehousePath('/warehouse-other'))
  assert(!visibleNavigation({...staff,permissions:['wms_logs:read']}).some(i=>i.key==='warehouse'))
  assert.deepEqual(warehouseAreas(admin).map(a=>a.key),['dispatch','pick','pack'])
  const reports=navigationLeaves(visibleNavigation(admin)).filter(i=>i.key.startsWith('/warehouse/')&&i.key!=='/warehouse/workstation')
  assert.deepEqual(reports.map(i=>i.label),['操作日誌','例外總覽','刷錯分析','新品不良分析'])
  const operator={...staff,roles:['EMPLOYEE'],permissions:['wms_tasks:read','wms_picking:execute','wms_packing:execute']}
  assert.deepEqual(navigationLeaves(workspaceNavigation(operator,'warehouse')).map(i=>i.key),['/warehouse'])
  assert.equal(activeNavigation(visibleNavigation(admin),'/warehouse/scan-errors','')?.label,'刷錯分析')
})
test('supervisor analysis stays in the ERP navigation and never implies an operator station',()=>{
  const supervisor={...staff,roles:['EMPLOYEE'],permissions:['wms_tasks:read','wms_overview:read','wms_logs:read','wms_exceptions:read','wms_scan_errors:read','wms_defects:read','profile_self:read']}
  assert(hasWarehouseManagementAccess(supervisor))
  assert(!warehouseOnlyUser(supervisor))
  assert.deepEqual(warehouseAreas(supervisor),[])
  assert.equal(warehouseWorkspace(supervisor,'/warehouse'),'all')
  assert.equal(warehouseWorkspace(admin,'/warehouse/scan-errors'),'all')
  assert.equal(warehouseWorkspace(admin,'/warehouse/workstation'),'warehouse')
  const leaves=navigationLeaves(workspaceNavigation(supervisor,'all'))
  assert.equal(leaves.find(i=>i.key==='/warehouse')?.label,'儲運總覽')
  assert(leaves.some(i=>i.key==='/warehouse/defects'))
  assert(!leaves.some(i=>i.key==='/warehouse/workstation'||i.key==='/sales/orders'||i.key==='/payroll/employees'))
  const adminERP=navigationLeaves(workspaceNavigation(admin,warehouseWorkspace(admin,'/warehouse')))
  assert(adminERP.some(i=>i.key==='/sales/orders'))
  assert(adminERP.some(i=>i.key==='/warehouse/logs'))
  const worker={...staff,roles:['EMPLOYEE'],permissions:['wms_tasks:read','wms_packing:execute']}
  assert.equal(warehouseWorkspace(worker,'/warehouse'),'warehouse')
  assert.equal(navigationLeaves(workspaceNavigation(worker,'all'))[0].label,'我的工作站')
  assert(!navigationLeaves(workspaceNavigation(admin,'warehouse')).some(i=>i.key==='/warehouse/logs'))
})
test('warehouse entry follows ERP permission without implying WMS access', () => {
  const warehouse = { roles: ['EMPLOYEE'], permissions: ['wms_tasks:read'] } as unknown as User
  assert(visibleNavigation(warehouse).some(item => item.key === 'warehouse'))
  assert(!visibleNavigation(staff).some(item => item.key === 'warehouse'))
  assert.equal(loginDestination(warehouse), '/warehouse')
  assert.equal(loginDestination({ ...warehouse, mustChangePassword: true }), '/auth/change-password')
  assert.equal(loginDestination(admin), '/dashboard')
  assert(!visibleNavigation({...warehouse,permissions:['inventory:read']}).some(item=>item.key==='warehouse'))
})
test('warehouse-only users see only assigned work plus personal self-service',()=>{
  const picker={...staff,roles:['EMPLOYEE'],permissions:['wms_tasks:read','wms_picking:execute','attendance_self:read','leave_self:read','profile_self:read']}
  assert(warehouseOnlyUser(picker))
  assert.deepEqual(warehouseAreas(picker).map(a=>a.key),['pick'])
  assert.deepEqual(navigationLeaves(workspaceNavigation(picker,'all')).map(i=>i.key),['/warehouse','/attendance/dashboard','/attendance/leaves','/profile'])
  assert.deepEqual(warehouseAreas({...picker,permissions:['wms_picking:execute']}).map(a=>a.key),[])
  const scoped=navigationLeaves(workspaceNavigation(admin,'warehouse')).map(i=>i.key)
  assert(!scoped.includes('/payroll/employees'))
  assert(!scoped.includes('/reports'))
  assert.equal(navigationLeaves(visibleNavigation(admin)).find(i=>i.key==='/admin/after-sales-brands')?.label,'品牌設定')
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
test('DOA repair queues share one authorized route and select the requested queue', () => {
  withMailroomEnabled(true, () => {
    const items = visibleNavigation(repairTechnician)
    const group = items.find(item => item.key === 'repair')
    assert.equal(group?.label, 'DOA 售後維修')
    assert.deepEqual(group?.children?.map(item => [item.key, item.label]), [
      ['/operations/repair', '案件總覽'],
      ['/operations/repair?queue=acceptance', '待認領與簽收'],
      ['/operations/repair?queue=mine', '我的檢修'],
      ['/operations/repair?queue=waiting', '客服與付款進度'],
      ['/operations/repair?queue=delivery', '複驗與交回'],
      ['/operations/repair?queue=records', '檢修與維修紀錄'],
    ])
    assert.equal(activeNavigation(items, '/operations/repair', '')?.label, '案件總覽')
    for (const queue of ['acceptance', 'mine', 'waiting', 'delivery', 'records']) {
      const selected = activeNavigation(items, '/operations/repair', `?queue=${queue}&page=2`)
      assert.equal(selected?.key, `/operations/repair?queue=${queue}`)
      assert.equal(navigationParent(items, selected!.key), 'repair')
    }
    assert.equal(getResourceName('repair_workbench'), 'DOA 售後維修工作台')
    assert.equal(getRoleName('REPAIR_TECHNICIAN'), '維修師')
  })
})
test('repair-only staff retain repair and personal information without customer, finance or stock privileges', () => {
  withMailroomEnabled(true, () => {
    const technician = {
      ...repairTechnician,
      permissions: [...repairTechnician.permissions, 'attendance_self:read', 'leave_self:read', 'expense_self:read', 'expense_self:create'],
    }
    assert(repairOnlyUser(technician))
    assert.equal(operationsWorkspace(technician, '/operations/repair'), 'repair')
    assert.equal(operationsWorkspace(technician, '/profile'), 'repair')
    const items = workspaceNavigation(technician, 'all')
    assert.deepEqual(items.map(item => item.key), ['repair', 'personal'])
    assert.deepEqual(items.find(item => item.key === 'personal')?.children?.map(item => item.key), [
      '/my/inbox', '/ap/expenses', '/attendance/dashboard', '/attendance/leaves', '/profile',
    ])
    for (const permission of ['banking:read', 'banking:update', 'accounts:read', 'after_sales_cases:update', 'inventory:update']) {
      assert(!canAccessRoute(technician, [permission]))
    }
    assert(canAccessRoute(technician, ['repair_workbench:read']))
    assert(canAccessRoute(technician, ['repair_workbench:update']))
    assert(!navigationLeaves(items).some(item => ['/dashboard', '/sales/after-sales', '/banking', '/inventory/products'].includes(item.key)))
    const employeeTechnician = {
      ...technician,
      roles: ['EMPLOYEE', 'REPAIR_TECHNICIAN'],
      permissions: [...technician.permissions, 'payroll_self:read', 'payroll_self_breakdown:read'],
    }
    assert(repairOnlyUser(employeeTechnician))
    assert.deepEqual(workspaceNavigation(employeeTechnician, 'all').map(item => item.key), ['repair', 'personal'])
    assert(navigationLeaves(workspaceNavigation(employeeTechnician, 'all')).some(item => item.key === '/payroll/runs'))
    assert(!canAccessRoute(employeeTechnician, ['payroll_admin:read']))
  })
})
test('repair technicians land in DOA while mailroom staff, dual-duty navigation and warehouse workspaces retain their rules', () => {
  withMailroomEnabled(true, () => {
    assert.equal(loginDestination(repairTechnician), '/operations/repair')
    assert.equal(loginDestination({ ...repairTechnician, mustChangePassword: true }), '/auth/change-password')
    assert.equal(loginDestination({ ...admin, roles: ['ADMIN', 'REPAIR_TECHNICIAN'] }), '/dashboard')
    const mailroom = { roles: ['MAILROOM_OPERATOR'], permissions: ['mailroom:read', 'repair_workbench:read'] } as unknown as User
    assert.equal(loginDestination(mailroom), '/operations/mailroom')
    assert.equal(loginDestination({ ...mailroom, roles: ['MAILROOM_OPERATOR', 'REPAIR_TECHNICIAN'] }), '/operations/repair')
    const dualDuty = { ...repairTechnician, roles: ['REPAIR_TECHNICIAN', 'CUSTOMER_SERVICE'], permissions: [...repairTechnician.permissions, 'after_sales_cases:read'] }
    assert(!repairOnlyUser(dualDuty))
    assert.equal(operationsWorkspace(dualDuty, '/operations/repair'), 'all')
    assert(workspaceNavigation(dualDuty, 'all').some(item => item.key === 'service'))
    assert(workspaceNavigation(admin, 'all').some(item => item.key === 'finance'))
    const warehouseRepair = { ...repairTechnician, permissions: [...repairTechnician.permissions, 'wms_tasks:read', 'wms_picking:execute'] }
    assert(!repairOnlyUser(warehouseRepair))
    assert(!warehouseOnlyUser(warehouseRepair))
    assert.equal(operationsWorkspace(warehouseRepair, '/warehouse'), 'warehouse')
    assert.equal(operationsWorkspace(warehouseRepair, '/operations/repair'), 'all')
    assert(workspaceNavigation(warehouseRepair, 'all').some(item => item.key === 'warehouse'))
  })
})
test('repair navigation and automatic landing require feature enablement plus repair read permission', () => {
  withMailroomEnabled(false, () => {
    assert(!visibleNavigation(repairTechnician).some(item => item.key === 'repair'))
    assert(!visibleNavigation(admin).some(item => item.key === 'repair'))
    assert(!repairOnlyUser(repairTechnician))
    assert.equal(loginDestination(repairTechnician), '/dashboard')
    assert.equal(operationsWorkspace(repairTechnician, '/dashboard'), 'all')
  })
  withMailroomEnabled(true, () => {
    const denied = { ...repairTechnician, permissions: ['repair_workbench:update', 'profile_self:read'] }
    assert(!visibleNavigation(denied).some(item => item.key === 'repair'))
    assert(!repairOnlyUser(denied))
    assert.equal(loginDestination(denied), '/dashboard')
    assert(!canAccessRoute(denied, ['repair_workbench:read']))
  })
})
