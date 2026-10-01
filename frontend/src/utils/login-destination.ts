import { mailroomEnabled } from '../pages/mailroom/model'
import type { User } from '../types'
import { hasPermission, hasRole, isAdminUser } from './access'

export function loginDestination(user: User | null) {
  if (user?.mustChangePassword) return '/auth/change-password'
  if (mailroomEnabled() && !isAdminUser(user) && hasRole(user, 'REPAIR_TECHNICIAN') && hasPermission(user, 'repair_workbench:read')) return '/operations/repair'
  if (mailroomEnabled() && !isAdminUser(user) && hasPermission(user, 'mailroom:read')) return '/operations/mailroom'
  if (mailroomEnabled() && !isAdminUser(user) && hasPermission(user, 'repair_workbench:read')) return '/operations/repair'
  if (!isAdminUser(user) && hasPermission(user, 'wms_tasks:read')) return '/warehouse'
  if (
    !isAdminUser(user) &&
    hasRole(user, 'CUSTOMER_SERVICE') &&
    user?.salesDataScope === 'ENTITY' &&
    hasPermission(user, 'after_sales_cases:read')
  )
    return '/sales/after-sales'
  return '/dashboard'
}
