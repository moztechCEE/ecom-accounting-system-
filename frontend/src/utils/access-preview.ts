import type { Permission, Role, User } from '../types'
import { hasAnyPermission, hasRole, isAdminUser } from './access'

export const PRIVILEGED_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN']
export const SYSTEM_ROLE_CODES = [...PRIVILEGED_ROLE_CODES, 'ACCOUNTANT', 'EMPLOYEE', 'OPERATOR', 'CUSTOMER_SERVICE', 'WAREHOUSE_PICKER', 'WAREHOUSE_PACKER', 'WAREHOUSE_OPERATOR']
export const isPrivilegedRole = (role: Pick<Role, 'code' | 'name'>) =>
  PRIVILEGED_ROLE_CODES.includes(role.code) || PRIVILEGED_ROLE_CODES.includes(role.name)

export function effectiveAccess(roles: Role[]): User {
  return {
    id: 'access-preview', email: '', name: '權限預覽',
    roles: [...new Set(roles.map(role => role.code))],
    permissions: [...new Set(roles.flatMap(role => (role.permissions || [])
      .map(link => `${link.permission.resource}:${link.permission.action}`)))],
  }
}

export function groupPermissions(permissions: Permission[]): { resource: string; permissions: Permission[] }[] {
  const groups = new Map<string, Permission[]>()
  for (const permission of permissions) {
    groups.set(permission.resource, [...(groups.get(permission.resource) || []), permission])
  }
  return [...groups].map(([resource, items]) => ({ resource, permissions: items }))
}

// A group toggle changes only its own IDs, preserving selections in other groups.
export function togglePermissionGroup(selected: string[], group: string[], enabled: boolean): string[] {
  const ids = new Set(selected)
  for (const id of group) {
    if (enabled) ids.add(id)
    else ids.delete(id)
  }
  return [...ids]
}

export function canAccessRoute(user: User | null | undefined, permissions: string[] = [], roles: string[] = []): boolean {
  if (!user) return false
  const roleAllowed = !roles.length || roles.some(role => hasRole(user, role)) ||
    (isAdminUser(user) && !roles.includes('SUPER_ADMIN'))
  return roleAllowed && (!permissions.length || hasAnyPermission(user, permissions))
}
