import { mailroomEnabled } from '../pages/mailroom/model'
import type { User } from '../types'
import { hasAnyPermission, isAdminUser } from '../utils/access'
import { PERSONAL_PATHS, REPAIR_PERSONAL_PATHS, repairOnlyUser, warehouseOnlyUser, afterSalesOnlyUser, hasWarehouseManagementAccess, WAREHOUSE_REPORTS, type OperationsWorkspace } from './workspaces'
import { stagedOperationsEnabled } from './release'
import { wmsPortalLinks, wmsPortalOrigin } from './wms-portal'

export type NavigationItem = { key: string; label: string; externalUrl?: string; workRole?: 'dispatcher'; permissions?: string[]; adminOnly?: boolean; superAdminOnly?: boolean; children?: NavigationItem[] }
export const NAVIGATION: NavigationItem[] = [
  { key: '/my/inbox', label: '我的待辦與收件' },
  { key: 'workbenches', label: '工作台', children: [
    { key: '/operations/after-sales/workbench', label: '售後工作台', permissions: ['after_sales_cases:read'] },
    { key: '/operations/mailroom', label: '收發室工作台', permissions: ['mailroom:read'] },
    { key: '/operations/repair', label: '維修工作台', permissions: ['repair_workbench:read'] },
  ] },
  { key: '/dashboard', label: '營運總覽' },
  { key: 'sales', label: '訂單銷售', children: [
    { key: '/sales/orders', label: '銷售訂單', permissions: ['sales_orders:read'] },
    { key: '/sales/quotations', label: '銷售報價', permissions: ['sales_orders:read', 'purchase_orders:read'] },
    { key: '/sales/customers', label: '客戶管理', permissions: ['sales_orders:read'] },
    { key: '/sales/b2b', label: '客戶採購入口', permissions: ['sales_orders:read'] },
  ] },
  { key: 'service', label: '售後管理中心', children: [
    { key: '/operations/after-sales/customers', label: '售後客戶資料', permissions: ['after_sales_cases:read'] },
    { key: '/operations/after-sales/cases', label: '售後案件中心', permissions: ['after_sales_cases:read'] },
    { key: '/operations/after-sales/quotes', label: '報價與顧客確認', permissions: ['after_sales_cases:read'] },
    { key: '/operations/after-sales/shipping', label: '寄回與補寄物流', permissions: ['after_sales_shipping:read'] },
    { key: '/operations/after-sales/customer-issues', label: '產品問題回報', permissions: ['after_sales_cases:read'] },
    { key: '/operations/after-sales/imports', label: '售後資料匯入', permissions: ['after_sales_imports:read'] },
  ] },
  { key: 'warehouse', label: '儲運管理中心', permissions: ['wms_tasks:read'], children: [
    { key: '/warehouse', label: '儲運工作台', permissions: ['wms_tasks:read'] },
    ...WAREHOUSE_REPORTS.map(r => ({ key: '/warehouse/' + r.key, label: r.label, permissions: [r.permission] })),
    { key: '/warehouse/workstation', label: '作業工作站', permissions: ['wms_orders:create', 'wms_picking:execute', 'wms_packing:execute'] },
  ] },
  { key: 'inventory', label: '採購庫存', children: [
    { key: '/purchasing/orders', label: '採購訂單', permissions: ['purchase_orders:read'] },
    { key: '/purchasing/b2b-shortages', label: '客戶缺貨採購', permissions: ['purchase_orders:create'] },
    { key: '/purchasing/supplier-accounts', label: '供應商帳號', permissions: ['purchase_orders:read'] },
    { key: '/vendors', label: '供應商', permissions: ['purchase_orders:read', 'purchase_orders:create', 'accounts:read'] },
    { key: '/inventory/products', label: '產品與庫存', permissions: ['inventory:read'] },
    { key: '/inventory/after-sales-stock', label: '售後良品與整新品', permissions: ['inventory:read', 'after_sales_stock:read'] },
    { key: '/operations/after-sales/products', label: '售後產品與服務價目', permissions: ['after_sales_products:read'] },
    { key: '/inventory/handover-reconciliation', label: '交運待核銷', permissions: ['inventory:read'] },
    { key: '/inventory/sn-labels', label: 'SN 與標籤', permissions: ['inventory:read'] },
    { key: '/manufacturing/assembly', label: '組裝工單', permissions: ['inventory:read'] },
  ] },
  { key: 'finance', label: '財務會計', children: [
    { key: '/accounting/workbench', label: '會計工作台', permissions: ['accounts:read', 'journal_entries:read'] },
    { key: '/operations/after-sales/accounting', label: '售後收付款與退款', permissions: ['after_sales_accounting:read'] },
    { key: '/operations/after-sales/invoices', label: '售後發票', permissions: ['after_sales_invoices:read'] },
    { key: '/reconciliation', label: '對帳中心', permissions: ['banking:read', 'reports:read', 'accounts:read'] },
    { key: '/sales/invoices', label: '應收帳款', permissions: ['sales_orders:read', 'accounts:read'] },
    { key: '/accounting/workbench?focus=missing-invoices', label: '發票核對', permissions: ['accounts:read', 'journal_entries:read'] },
    { key: '/ap/payable', label: '費用付款', permissions: ['purchase_orders:read', 'accounts:read'] },
    { key: '/ap/expenses', label: '費用申請', permissions: ['expense_self:read', 'purchase_orders:read', 'accounts:read'] },
    { key: '/ap/expense-review', label: '費用審核', permissions: ['expense_self:read', 'purchase_orders:read', 'accounts:read'] },
    { key: '/banking', label: '銀行帳戶', permissions: ['banking:read'] },
    { key: '/accounting/journals', label: '會計分錄', permissions: ['journal_entries:read'] },
    { key: '/accounting/accounts', label: '會計科目', permissions: ['accounts:read'] },
    { key: '/accounting/periods', label: '會計期間', permissions: ['accounts:read'] },
    { key: '/reconciliation/timeout', label: '逾期對帳', permissions: ['reconciliation_timeout:read', 'accounts:read', 'journal_entries:read'] },
    { key: '/reports', label: '營運報表', permissions: ['reports:read'] },
  ] },
  { key: 'people', label: '人資考勤', children: [
    { key: '/attendance/dashboard', label: '我的出勤', permissions: ['attendance_self:read'] },
    { key: '/attendance/leaves', label: '請假申請', permissions: ['leave_self:read'] },
    { key: '/payroll/employees', label: '員工與部門', permissions: ['employees_admin:read'] },
    { key: '/performance/reviews', label: '考績與考核', permissions: ['performance_reviews:read'] },
    { key: '/attendance/admin', label: '出勤審核', permissions: ['attendance_admin:read', 'attendance_team:read'] },
    { key: '/payroll/runs', label: '薪資管理', permissions: ['payroll_self:read', 'payroll_admin:read'] },
  ] },
  { key: 'admin', label: '系統管理', adminOnly: true, permissions: ['access_control:read', 'access_control:update', 'after_sales_users:read', 'after_sales_audit:read', 'after_sales_settings:read'], children: [
    { key: '/admin/access-control', label: '帳號與權限', permissions: ['access_control:read', 'access_control:update'] },
    { key: '/operations/after-sales/users', label: '售後來源帳號與權限', permissions: ['after_sales_users:read'] },
    { key: '/operations/after-sales/audit-logs', label: '售後操作紀錄', permissions: ['after_sales_audit:read'] },
    { key: '/operations/after-sales/settings', label: '售後來源設定', permissions: ['after_sales_settings:read'] },
    { key: '/admin/entities', label: '公司管理', superAdminOnly: true },
    { key: '/admin/reimbursement-items', label: '報銷項目', adminOnly: true },
    { key: '/admin/settings', label: '系統設定', adminOnly: true },
    { key: '/admin/after-sales-brands', label: '品牌設定', adminOnly: true },
  ] },
  { key: '/profile', label: '個人資料', permissions: ['profile_self:read'] },
]
export function visibleNavigation(user: User | null | undefined, items = NAVIGATION, staged = stagedOperationsEnabled()): NavigationItem[] {
  return items.flatMap<NavigationItem>((original) => {
    const sourceModuleEnabled=window.__APP_CONFIG__?.afterSalesModuleEnabled===true
    if (original.key.startsWith('/operations/after-sales/') && !sourceModuleEnabled) return []
    if (!mailroomEnabled() && ['/operations/mailroom','/operations/repair','/my/inbox'].includes(original.key)) return []
    if (wmsPortalOrigin()) {
      const portal = wmsPortalLinks(user)
      if (original.key === 'warehouse') {
        if (!hasAnyPermission(user, ['wms_tasks:read'])) return []
        return [{ ...original, children: [
          { key: '/warehouse', label: '作業工作台' },
          ...portal.filter(link => ['/warehouse/dispatch','/warehouse/overview'].includes(link.key)),
        ] }]
      }
      const destinations: Record<string,string[]> = {
        sales: ['/warehouse/logistics'], inventory: ['/warehouse/defects'],
        people: ['/warehouse/scan-errors'], admin: ['/warehouse/logs','/warehouse/settings'],
      }
      if (original.children && destinations[original.key]) {
        original = { ...original, children: [...original.children, ...portal.filter(link => destinations[original.key].includes(link.key))] }
      }
    }
    if (!staged && ['/warehouse/workstation', '/admin/after-sales-brands'].includes(original.key)) return []
    const item = original.key === 'service' && !sourceModuleEnabled
      ? {...original,children:staged?[
        {key:'/sales/after-sales',label:'案件工作台',permissions:['after_sales_cases:read']},
        {key:'/sales/after-sales/quotes',label:'案件報價',permissions:['after_sales_cases:read']},
        {key:'/sales/after-sales?type=REPAIR',label:'維修案件',permissions:['after_sales_cases:read']},
        {key:'/sales/after-sales?type=REPAIR&status=PENDING_QUOTE_CONFIRMATION',label:'維修報價',permissions:['after_sales_cases:read']},
        {key:'/sales/after-sales?type=RESHIPMENT',label:'漏寄補寄',permissions:['after_sales_cases:read']},
        {key:'/sales/after-sales?type=EXCHANGE_RETURN',label:'來回件',permissions:['after_sales_cases:read']},
        {key:'/sales/after-sales?type=REFUND_PICKUP',label:'退款派車',permissions:['after_sales_cases:read']},
        {key:'/sales/after-sales?type=PRIVATE_PURCHASE',label:'私下購買',permissions:['after_sales_cases:read']},
        {key:'/sales/after-sales?type=CUSTOMER_ISSUE',label:'客戶問題',permissions:['after_sales_cases:read']},
      ]:[{key:'/sales/after-sales',label:'來回件',permissions:['after_sales_cases:read','sales_orders:read']}]} : original
    if (item.key === '/warehouse/workstation' && !hasWarehouseManagementAccess(user)) return []
    if (item.key === '/dashboard' && (warehouseOnlyUser(user) || repairOnlyUser(user) || afterSalesOnlyUser(user))) return []
    if (item.superAdminOnly && !user?.roles?.includes('SUPER_ADMIN')) return []
    if (item.adminOnly && !isAdminUser(user) && !hasAnyPermission(user, item.permissions || [])) return []
    if (item.permissions?.length && !hasAnyPermission(user, item.permissions)) return []
    const children = item.children ? visibleNavigation(user, item.children, staged) : undefined
    const label = item.key === '/warehouse' ? (hasWarehouseManagementAccess(user) ? '儲運總覽' : '我的工作站') : item.label
    return item.children && !children?.length ? [] : [{ ...item, label, children }]
  })
}
export function workspaceNavigation(user: User | null | undefined, workspace: OperationsWorkspace): NavigationItem[] {
  const items = visibleNavigation(user)
  if (workspace === 'after-sales' || (workspace === 'all' && afterSalesOnlyUser(user))) {
    const leaves = navigationLeaves(items)
    const work = leaves.filter(item => ['/operations/after-sales/workbench', '/operations/after-sales/cases',
      '/operations/after-sales/quotes', '/operations/after-sales/shipping', '/operations/after-sales/customers'].includes(item.key))
    const personal = leaves.filter(item => REPAIR_PERSONAL_PATHS.includes(item.key)).map(item =>
      item.key === '/payroll/runs' ? { ...item, label: hasAnyPermission(user, ['payroll_admin:read']) ? '薪資管理' : '我的薪資' } : item)
    return [...(work.length ? [{ key: 'service', label: '售後工作台', children: work }] : []),
      ...(personal.length ? [{ key: 'personal', label: '我的資訊', children: personal }] : [])]
  }
  if (workspace === 'mailroom') {
    const leaves = navigationLeaves(items)
    const work = leaves.filter(item => item.key === '/operations/mailroom')
    const personal = leaves.filter(item => REPAIR_PERSONAL_PATHS.includes(item.key))
    return [...(work.length ? [{ key: 'workbenches', label: '收發室工作台', children: work }] : []),
      ...(personal.length ? [{ key: 'personal', label: '我的資訊', children: personal }] : [])]
  }
  if (workspace === 'repair' || repairOnlyUser(user)) {
    const personal = navigationLeaves(items).filter(item => REPAIR_PERSONAL_PATHS.includes(item.key))
    const repair = items.filter(item => item.key === 'workbenches').map(item => ({ ...item, children: item.children?.filter(child => child.key === '/operations/repair') }))
    return [...repair,
      ...(personal.length ? [{ key: 'personal', label: '我的資訊', children: personal }] : [])]
  }
  if (workspace === 'all' && !warehouseOnlyUser(user)) return items
  const personal = navigationLeaves(items).filter(item => PERSONAL_PATHS.includes(item.key))
  return [...items.filter(item => item.key === 'warehouse').map(item => ({...item, children: wmsPortalOrigin() ? item.children?.filter(child => child.key === '/warehouse') : item.children?.filter(child => child.key === '/warehouse' || child.key === '/warehouse/workstation')})),
    ...(personal.length ? [{ key: 'personal', label: '我的資訊', children: personal }] : [])]
}
export function navigationLeaves(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) => item.children ? navigationLeaves(item.children) : [item])
}
export function activeNavigation(items: NavigationItem[], pathname: string, search: string) {
  const current = new URLSearchParams(search)
  return navigationLeaves(items).filter((item) => {
    const [path, query] = item.key.split('?')
    return (path === pathname || pathname.startsWith(path + '/')) &&
      [...new URLSearchParams(query)].every(([key, value]) => current.get(key) === value)
  }).sort((a, b) => b.key.length - a.key.length)[0]
}
export function navigationParent(items: NavigationItem[], key: string) {
  return items.find((item) => item.children?.some((child) => child.key === key))?.key
}
