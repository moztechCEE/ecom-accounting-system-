import api from './api'
import { LoginRequest, LoginResponse, ManagedUser, User } from '../types'

const mapManagedUserToUser = (managed: ManagedUser): User => {
  const roleSet = new Set<string>()
  const permissionSet = new Set<string>()

  managed.roles?.forEach((userRole) => {
    const roleCode = userRole.role?.code
    if (roleCode) {
      roleSet.add(roleCode)
    }

    userRole.role?.permissions?.forEach((rolePermission) => {
      const permission = rolePermission.permission
      if (permission) {
        permissionSet.add(`${permission.resource}:${permission.action}`)
      }
    })
  })

  return {
    id: managed.id,
    email: managed.email,
    name: managed.name,
    mustChangePassword: managed.mustChangePassword,
    employeeDataScope: managed.employeeDataScope,
    attendanceDataScope: managed.attendanceDataScope,
    payrollDataScope: managed.payrollDataScope,
    roles: Array.from(roleSet),
    permissions: Array.from(permissionSet),
  }
}

export const authService = {
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await api.post<{ access_token: string; user: { id: string; email: string; name: string } }>('/auth/login', data)
    const token = response.data.access_token
    if (token) {
      localStorage.setItem('access_token', token)
    }

    const currentUser = await this.getCurrentUser()

    return {
      access_token: token,
      user: currentUser,
    }
  },

  async getLoginEntities(): Promise<Array<{ id: string; name: string; country?: string; baseCurrency?: string; loginCode: string }>> {
    const response = await api.get('/auth/login-entities')
    return response.data
  },

  async getCurrentUser(): Promise<User> {
    const response = await api.get<ManagedUser>('/users/me')
    return mapManagedUserToUser(response.data)
  },

  async get2FASetup() {
    const response = await api.get<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup')
    return response.data
  },

  async enable2FA(token: string, secret: string) {
    const response = await api.post('/auth/2fa/enable', { token, secret })
    return response.data
  },

  async changePassword(data: { currentPassword: string; newPassword: string; email?: string }) {
    const response = await api.post('/auth/change-password', data)
    return response.data
  },

  async requestPasswordReset(email: string) {
    const response = await api.post('/auth/password-reset/request', { email })
    return response.data
  },

  async confirmPasswordReset(data: { token: string; newPassword: string }) {
    const response = await api.post('/auth/password-reset/confirm', data)
    return response.data
  },


  logout() {
    localStorage.removeItem('access_token')
  },

  getToken(): string | null {
    return localStorage.getItem('access_token')
  },
}
