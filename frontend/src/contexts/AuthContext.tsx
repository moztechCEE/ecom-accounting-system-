import React, { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'
import { message } from 'antd'
import { wmsPortalOrigin } from '../config/wms-portal'
import { authService } from '../services/auth.service'
import { webSocketService } from '../services/websocket.service'
import { clearAfterSalesBrowserSession, clearInvalidErpSession, completeErpLogin, completeErpLogout } from '../services/after-sales-logout'
import { User, LoginRequest } from '../types'

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (data: LoginRequest) => Promise<User>
  logout: () => Promise<boolean>
  refreshCurrentUser: () => Promise<User | null>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const clearModuleSession = () => clearAfterSalesBrowserSession(
  window.location.origin, window.__APP_CONFIG__?.afterSalesModuleEnabled === true,
)

const DEFAULT_ENTITY_ID =
  window.__APP_CONFIG__?.defaultEntityId?.trim() ||
  import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() ||
  'tw-entity-001'

const ensureDefaultEntityId = () => {
  if (!localStorage.getItem('entityId')?.trim()) {
    localStorage.setItem('entityId', DEFAULT_ENTITY_ID)
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const initAuth = async () => {
      const token = authService.getToken()
      if (token) {
        try {
          const currentUser = await authService.getCurrentUser()
          ensureDefaultEntityId()
          setUser(currentUser)
          webSocketService.connect()
        } catch {
          await clearInvalidErpSession({ clearModuleSession, logoutLocal: () => authService.logout() })
        }
      }
      setLoading(false)
    }
    initAuth()
  }, [])

  const refreshCurrentUser = async () => {
    const token = authService.getToken()
    if (!token) {
      setUser(null)
      return null
    }

    const currentUser = await authService.getCurrentUser()
    setUser(currentUser)
    return currentUser
  }

  const login = async (data: LoginRequest) => {
    const response = await completeErpLogin({ clearModuleSession, login: () => authService.login(data) })
    if (data.entityId?.trim()) {
      localStorage.setItem('entityId', data.entityId.trim())
    } else {
      ensureDefaultEntityId()
    }
    setUser(response.user)
    webSocketService.connect()
    return response.user
  }

  const logout = async () => {
    try {
      await completeErpLogout({
        clearModuleSession,
        logoutWms: wmsPortalOrigin() ? () => api.post('/wms/portal/logout') : undefined,
        logoutLocal: () => {
          authService.logout()
          setUser(null)
          webSocketService.disconnect()
        },
      })
      return true
    } catch {
      message.error('無法完成登出，請稍後重試')
      return false
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshCurrentUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// The existing context exposes its paired consumer hook to the application's pages.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
