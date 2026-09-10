import type { User } from '../types'
import { hasAnyPermission, isAdminUser } from '../utils/access'

export type NavigationItem = { key: string; label: string; permissions?: string[]; adminOnly?: boolean; superAdminOnly?: boolean; children?: NavigationItem[] }
export const NAVIGATION: NavigationItem[] = [
  { key: '/dashboard', label: '營運總覽' },
  { key: 'sales', label: '訂單銷售', children: [
    { key: '/sales/orders', label: '銷售訂單', permissions: ['sales_orders:read'] },
    { key: '/sales/quotations', label: '銷售報價', permissions: ['sales_orders:read', 'purchase_orders:read'] },
    { key: '/sales/customers', label: '客戶管理', permissions: ['sales_orders:read'] },
  ] },
  { key: 'service', label: '售後管理中心', children: [
    { key: '/sales/after-sales', label: '案件工作台', permissions: ['after_sales_cases:read'] },
    { key: '/sales/after-sales/quotes', label: '案件報價', permissions: ['after_sales_cases:read'] },
    { key: '/sales/after-sales?type=REPAIR', label: '維修案件', permissions: ['after_sales_cases:read'] },
    { key: '/sales/after-sales?type=REPAIR&status=PENDING_QUOTE_CONFIRMATION', label: '維修報價', permissions: ['after_sales_cases:read'] },
    { key: '/sales/after-sales?type=RESHIPMENT', label: '漏寄補寄', permissions: ['after_sales_cases:read'] },
    { key: '/sales/after-sales?type=EXCHANGE_RETURN', label: '來回件', permissions: ['after_sales_cases:read'] },
    { key: '/sales/after-sales?type=REFUND_PICKUP', label: '退款派車', permissions: ['after_sales_cases:read'] },
    { key: '/sales/after-sales?type=PRIVATE_PURCHASE', label: '私下購買', permissions: ['after_sales_cases:read'] },
    { key: '/sales/after-sales?type=CUSTOMER_ISSUE', label: '客戶問題', permissions: ['after_sales_cases:read'] },
  ] },
  { key: 'warehouse', label: '儲運管理中心', children: [
    { key: '/warehouse', label: '儲運工作台', permissions: ['inventory:read'] },
  ] },
  { key: 'inventory', label: '採購庫存', children: [
    { key: '/purchasing/orders', label: '採購訂單', permissions: ['purchase_orders:read'] },
    { key: '/vendors', label: '供應商', permissions: ['purchase_orders:read', 'accounts:read'] },
    { key: '/inventory/products', label: '產品與庫存', permissions: ['inventory:read'] },
    { key: '/manufacturing/assembly', label: '組裝工單', permissions: ['inventory:read'] },
  ] },
  { key: 'finance', label: '財務會計', children: [
    { key: '/accounting/workbench', label: '會計工作台', permissions: ['accounts:read', 'journal_entries:read'] },
    { key: '/reconciliation', label: '對帳中心', permissions: ['banking:read', 'reports:read', 'accounts:read'] },
    { key: '/sales/invoices', label: '應收帳款', permissions: ['sales_orders:read', 'accounts:read'] },
    { key: '/accounting/workbench?focus=missing-invoices', label: '發票核對', permissions: ['accounts:read', 'journal_entries:read'] },
    { key: '/ap/payable', label: '費用付款', permissions: ['purchase_orders:read', 'accounts:read'] },
    { key: '/ap/expenses', label: '費用申請', permissions: ['purchase_orders:read', 'accounts:read'] },
    { key: '/ap/expense-review', label: '費用審核', permissions: ['purchase_orders:read', 'accounts:read'] },
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
    { key: '/attendance/admin', label: '出勤審核', permissions: ['attendance_admin:read'] },
    { key: '/payroll/runs', label: '薪資管理', permissions: ['payroll_self:read', 'payroll_admin:read'] },
  ] },
  { key: 'admin', label: '系統管理', adminOnly: true, permissions: ['access_control:read', 'access_control:update'], children: [
    { key: '/admin/access-control', label: '帳號與權限' },
    { key: '/admin/entities', label: '公司管理', superAdminOnly: true },
    { key: '/admin/reimbursement-items', label: '報銷項目' },
    { key: '/admin/settings', label: '系統設定' },
    { key: '/admin/after-sales-brands', label: '品牌與 LINE' },
  ] },
  { key: '/profile', label: '個人資料', permissions: ['profile_self:read'] },
]
export function visibleNavigation(user: User | null | undefined, items = NAVIGATION): NavigationItem[] {
  return items.flatMap((item) => {
    if (item.superAdminOnly && !user?.roles?.includes('SUPER_ADMIN')) return []
    if (item.adminOnly && !isAdminUser(user) && !hasAnyPermission(user, item.permissions || [])) return []
    if (item.permissions?.length && !hasAnyPermission(user, item.permissions)) return []
    const children = item.children ? visibleNavigation(user, item.children) : undefined
    return item.children && !children?.length ? [] : [{ ...item, children }]
  })
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
