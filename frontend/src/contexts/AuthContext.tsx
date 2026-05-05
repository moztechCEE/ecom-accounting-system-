import React, { createContext, useContext, useState, useEffect } from 'react'
import { authService } from '../services/auth.service'
import { webSocketService } from '../services/websocket.service'
import { User, LoginRequest } from '../types'

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (data: LoginRequest) => Promise<void>
  logout: () => void
  refreshCurrentUser: () => Promise<User | null>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

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
        } catch (error) {
          authService.logout()
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
    const response = await authService.login(data)
    ensureDefaultEntityId()
    setUser(response.user)
    webSocketService.connect()
  }

  const logout = () => {
    authService.logout()
    setUser(null)
    webSocketService.disconnect()
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshCurrentUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
