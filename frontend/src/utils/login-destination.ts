import type { User } from '../types'
import { hasPermission, hasRole, isAdminUser } from './access'

export function loginDestination(user: User | null) {
  if (user?.mustChangePassword) return '/auth/change-password'
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
