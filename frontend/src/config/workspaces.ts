import type { User } from '../types'
import { hasPermission, isAdminUser } from '../utils/access'

export type WarehouseArea = 'dispatch' | 'pick' | 'pack' | 'shipping'
export const WAREHOUSE_AREAS: { key: WarehouseArea; label: string; permission: string }[] = [
  { key: 'dispatch', label: '訂單調度', permission: 'wms_orders:create' },
  { key: 'pick', label: '揀貨工作區', permission: 'wms_picking:execute' },
  { key: 'pack', label: '裝箱核對', permission: 'wms_packing:execute' },
  { key: 'shipping', label: '出貨交接', permission: 'wms_shipping:execute' },
]
export const PERSONAL_PATHS = ['/attendance/dashboard', '/attendance/leaves', '/profile']
export function warehouseAreas(user: User | null | undefined) {
  if (!hasPermission(user, 'wms_tasks:read')) return []
  return WAREHOUSE_AREAS.filter(area => hasPermission(user, area.permission))
}
export function warehouseOnlyUser(user: User | null | undefined) {
  return !isAdminUser(user) && hasPermission(user, 'wms_tasks:read') &&
    !(user?.permissions || []).some(p => !p.startsWith('wms_') &&
      !['attendance_self:read', 'leave_self:read', 'profile_self:read'].includes(p))
}
