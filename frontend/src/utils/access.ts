import { User } from '../types'

export const isAdminUser = (user?: User | null) =>
  Boolean(
    user &&
      (user.roles ?? []).some((role) => role === 'SUPER_ADMIN' || role === 'ADMIN'),
  )

export const hasRole = (user: User | null | undefined, role: string) =>
  Boolean(user && (user.roles ?? []).includes(role))

export const hasPermission = (
  user: User | null | undefined,
  permission: string,
) => isAdminUser(user) || Boolean(user && (user.permissions ?? []).includes(permission))

export const hasAnyPermission = (
  user: User | null | undefined,
  permissions: string[],
) => isAdminUser(user) || permissions.some((permission) => hasPermission(user, permission))

export const hasAllPermissions = (
  user: User | null | undefined,
  permissions: string[],
) => isAdminUser(user) || permissions.every((permission) => hasPermission(user, permission))
