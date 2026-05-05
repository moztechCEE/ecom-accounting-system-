import React from 'react'
import { Navigate } from 'react-router-dom'
import { Result } from 'antd'
import { useAuth } from '../contexts/AuthContext'
import { hasAnyPermission, hasRole, isAdminUser } from '../utils/access'

type PermissionRouteProps = {
  children: React.ReactNode
  anyPermissions?: string[]
  anyRoles?: string[]
  redirectTo?: string
}

const PermissionRoute: React.FC<PermissionRouteProps> = ({
  children,
  anyPermissions = [],
  anyRoles = [],
  redirectTo,
}) => {
  const { user, loading } = useAuth()

  if (loading) {
    return null
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  const roleAllowed =
    anyRoles.length === 0 ||
    isAdminUser(user) ||
    anyRoles.some((role) => hasRole(user, role))
  const permissionAllowed =
    anyPermissions.length === 0 || hasAnyPermission(user, anyPermissions)

  if (roleAllowed && permissionAllowed) {
    return <>{children}</>
  }

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />
  }

  return (
    <Result
      status="403"
      title="沒有權限"
      subTitle="你目前沒有開通這個功能的使用權限，請洽管理員協助。"
    />
  )
}

export default PermissionRoute
