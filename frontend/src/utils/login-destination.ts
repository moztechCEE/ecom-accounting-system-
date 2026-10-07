import { mailroomEnabled } from '../pages/mailroom/model'
import type { User } from '../types'
import { hasPermission, hasRole, isAdminUser } from './access'
import { afterSalesWorkspaceAvailable, preferredOperationsWorkspace, WORKSPACE_HOME } from '../config/workspaces'

export function loginDestination(user: User | null) {
  if (user?.mustChangePassword) return '/auth/change-password'
  let entityId = ''
  try { entityId = localStorage.getItem('entityId') || '' } catch { /* Use permission-based fallback. */ }
  const preferred = preferredOperationsWorkspace(user, entityId)
  if (preferred) return WORKSPACE_HOME[preferred]
  if (mailroomEnabled() && !isAdminUser(user) && hasRole(user, 'REPAIR_TECHNICIAN') && hasPermission(user, 'repair_workbench:read')) return '/operations/repair'
  if (!isAdminUser(user) && afterSalesWorkspaceAvailable(user)) return '/operations/after-sales/workbench'
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
