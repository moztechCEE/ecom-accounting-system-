import type { User } from '../types'
import { mailroomEnabled } from '../pages/mailroom/model'
import { hasPermission, isAdminUser } from '../utils/access'

export type OperationsWorkspace = 'all' | 'warehouse' | 'repair' | 'after-sales' | 'mailroom'
export const WORKSPACE_LABELS: Record<OperationsWorkspace, string> = {
  all: '營運管理', warehouse: '儲運工作台', repair: '維修工作台',
  'after-sales': '售後工作台', mailroom: '收發室工作台',
}
export const WORKSPACE_HOME: Record<OperationsWorkspace, string> = {
  all: '/dashboard', warehouse: '/warehouse', repair: '/operations/repair',
  'after-sales': '/operations/after-sales/workbench', mailroom: '/operations/mailroom',
}
export function workspaceCompanyId(search: string) {
  const explicit = new URLSearchParams(search).get('entityId')
  if (explicit) return explicit
  try { return localStorage.getItem('entityId') || '' } catch { return '' }
}
export function operationsWorkspaceDestination(workspace: OperationsWorkspace, search: string) {
  const explicit = new URLSearchParams(search).get('entityId')
  return WORKSPACE_HOME[workspace] + (explicit ? '?' + new URLSearchParams({ entityId: explicit }).toString() : '')
}
export type WarehouseArea = 'dispatch' | 'pick' | 'pack'
export const WAREHOUSE_AREAS: { key: WarehouseArea; label: string; permission: string }[] = [
  { key: 'dispatch', label: '訂單拋轉', permission: 'wms_orders:create' },
  { key: 'pick', label: '揀貨工作站', permission: 'wms_picking:execute' },
  { key: 'pack', label: '裝箱工作站', permission: 'wms_packing:execute' },
]
export const WAREHOUSE_REPORTS = [
  { key: 'logs', label: '操作日誌', permission: 'wms_logs:read' },
  { key: 'exceptions', label: '例外總覽', permission: 'wms_exceptions:read' },
  { key: 'scan-errors', label: '刷錯分析', permission: 'wms_scan_errors:read' },
  { key: 'defects', label: '新品不良分析', permission: 'wms_defects:read' },
] as const
export const PERSONAL_PATHS = ['/my/inbox', '/attendance/dashboard', '/attendance/leaves', '/ap/expenses', '/profile']
export const REPAIR_PERSONAL_PATHS = [...PERSONAL_PATHS, '/payroll/runs']
export function afterSalesWorkspaceAvailable(user: User | null | undefined) {
  return window.__APP_CONFIG__?.afterSalesModuleEnabled === true &&
    hasPermission(user, 'after_sales_cases:read') && (user?.roles?.includes('SUPER_ADMIN') || user?.salesDataScope === 'ENTITY')
}
export function afterSalesOnlyUser(user: User | null | undefined) {
  return !isAdminUser(user) && afterSalesWorkspaceAvailable(user) &&
    !(user?.permissions || []).some(permission => !afterSalesWorkbenchPermission(permission) && !personalPermission(permission))
}
function afterSalesWorkbenchPermission(permission: string) {
  return ['after_sales_cases:', 'after_sales_shipping:', 'after_sales_accounting:', 'after_sales_invoices:',
    'after_sales_faqs:'].some(prefix => permission.startsWith(prefix))
}
function personalPermission(permission: string) {
  return ['attendance_self:read', 'leave_self:read', 'profile_self:read', 'expense_self:read',
    'expense_self:create', 'payroll_self:read', 'payroll_self_breakdown:read'].includes(permission)
}
export function availableOperationsWorkspaces(user: User | null | undefined): OperationsWorkspace[] {
  if (!user) return []
  const workspaces: OperationsWorkspace[] = []
  if (afterSalesWorkspaceAvailable(user)) workspaces.push('after-sales')
  if (mailroomEnabled() && hasPermission(user, 'mailroom:read')) workspaces.push('mailroom')
  if (mailroomEnabled() && hasPermission(user, 'repair_workbench:read')) workspaces.push('repair')
  if (hasPermission(user, 'wms_tasks:read')) workspaces.push('warehouse')
  if (isAdminUser(user) || !workspaces.length || hasWarehouseManagementAccess(user) || (user.permissions || []).some(permission =>
    !personalPermission(permission) && !afterSalesWorkbenchPermission(permission) &&
    !permission.startsWith('mailroom:') && !permission.startsWith('repair_workbench:') && !permission.startsWith('wms_'))) workspaces.push('all')
  return workspaces
}
// A browser preference is scoped to this employee and company; it never grants access.
export function workspacePreferenceKey(user: User | null | undefined, entityId: string) {
  return user?.id && entityId ? `corely.workspace.default.v1:${encodeURIComponent(entityId)}:${encodeURIComponent(user.id)}` : null
}
export function preferredOperationsWorkspace(user: User | null | undefined, entityId: string): OperationsWorkspace | undefined {
  const key = workspacePreferenceKey(user, entityId)
  if (!key) return undefined
  try {
    const saved = localStorage.getItem(key)
    return availableOperationsWorkspaces(user).find(workspace => workspace === saved)
  } catch { return undefined }
}
export function savePreferredOperationsWorkspace(user: User | null | undefined, entityId: string, workspace: OperationsWorkspace) {
  const key = workspacePreferenceKey(user, entityId)
  if (!key || !availableOperationsWorkspaces(user).includes(workspace)) return false
  try { localStorage.setItem(key, workspace); return true } catch { return false }
}
export function repairOnlyUser(user: User | null | undefined) {
  return !isAdminUser(user) && hasPermission(user, 'repair_workbench:read') && mailroomEnabled() &&
    !(user?.permissions || []).some(permission =>
      !['repair_workbench:read', 'repair_workbench:update', 'attendance_self:read', 'leave_self:read',
        'profile_self:read', 'expense_self:read', 'expense_self:create',
        'payroll_self:read', 'payroll_self_breakdown:read'].includes(permission))
}
export function operationsWorkspace(user: User | null | undefined, pathname: string): OperationsWorkspace {
  const allowed = availableOperationsWorkspaces(user)
  if (pathname.startsWith('/operations/after-sales/') && allowed.includes('after-sales')) return 'after-sales'
  if (pathname === '/operations/mailroom' && allowed.includes('mailroom')) return 'mailroom'
  if (pathname === '/operations/repair' && allowed.includes('repair')) return 'repair'
  if (repairOnlyUser(user)) return 'repair'
  if (afterSalesOnlyUser(user)) return 'after-sales'
  if (allowed.length === 1 && allowed[0] === 'mailroom') return 'mailroom'
  return warehouseWorkspace(user, pathname)
}
export const isWarehousePath = (pathname: string) => pathname === '/warehouse' || pathname.startsWith('/warehouse/')
export function hasWarehouseManagementAccess(user: User | null | undefined) {
  return hasPermission(user, 'wms_tasks:read') &&
    (hasPermission(user, 'wms_overview:read') || WAREHOUSE_REPORTS.some(report => hasPermission(user, report.permission)))
}
export function warehouseWorkspace(user: User | null | undefined, pathname: string): 'all' | 'warehouse' {
  if (warehouseOnlyUser(user)) return 'warehouse'
  if (pathname === '/warehouse/workstation') return 'warehouse'
  return isWarehousePath(pathname) && !hasWarehouseManagementAccess(user) ? 'warehouse' : 'all'
}
export function warehouseAreas(user: User | null | undefined) {
  if (!hasPermission(user, 'wms_tasks:read')) return []
  return WAREHOUSE_AREAS.filter(area => hasPermission(user, area.permission))
}
export function warehouseOnlyUser(user: User | null | undefined) {
  return !isAdminUser(user) && !hasWarehouseManagementAccess(user) && hasPermission(user, 'wms_tasks:read') &&
    !(user?.permissions || []).some(p => !p.startsWith('wms_') &&
      !['attendance_self:read', 'leave_self:read', 'profile_self:read', 'expense_self:read', 'expense_self:create'].includes(p))
}
