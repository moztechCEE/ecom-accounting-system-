import api from './api'
import { ManagedUser, PaginatedResult } from '../types'

export interface CreateUserPayload {
  email: string
  name: string
  password: string
  roleIds?: string[]
  employeeDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY'
  attendanceDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY'
  payrollDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY'
}

export interface UpdateUserPayload {
  name?: string
  isActive?: boolean
  password?: string
  employeeDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY'
  attendanceDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY'
  payrollDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY'
}

export const usersService = {
  async list(page = 1, limit = 25): Promise<PaginatedResult<ManagedUser>> {
    const response = await api.get<PaginatedResult<ManagedUser>>('/users', {
      params: { page, limit },
    })
    return response.data
  },

  async create(payload: CreateUserPayload): Promise<ManagedUser> {
    const response = await api.post<ManagedUser>('/users', payload)
    return response.data
  },

  async update(id: string, payload: UpdateUserPayload): Promise<ManagedUser> {
    const response = await api.patch<ManagedUser>(`/users/${id}`, payload)
    return response.data
  },

  async setRoles(id: string, roleIds: string[]): Promise<ManagedUser> {
    const response = await api.put<ManagedUser>(`/users/${id}/roles`, { roleIds })
    return response.data
  },

  async deactivate(id: string): Promise<ManagedUser> {
    const response = await api.delete<ManagedUser>(`/users/${id}`)
    return response.data
  },
}
