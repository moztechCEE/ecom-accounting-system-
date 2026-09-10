import type { User } from '../types'
import { hasPermission, isAdminUser } from '../utils/access'

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
export const PERSONAL_PATHS = ['/attendance/dashboard', '/attendance/leaves', '/profile']
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
      !['attendance_self:read', 'leave_self:read', 'profile_self:read'].includes(p))
}
