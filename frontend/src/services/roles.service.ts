import api from './api'
import { Role } from '../types'

export interface CreateRolePayload {
  templateRoleId?: string
  code: string
  name: string
  description?: string
  hierarchyLevel?: number
}

export type UpdateRolePayload = Partial<CreateRolePayload>

export const rolesService = {
  async list(): Promise<Role[]> {
    const response = await api.get<Role[]>('/roles')
    return response.data
  },

  async create(payload: CreateRolePayload): Promise<Role> {
    const response = await api.post<Role>('/roles', payload)
    return response.data
  },

  async update(id: string, payload: UpdateRolePayload): Promise<Role> {
    const response = await api.patch<Role>(`/roles/${id}`, payload)
    return response.data
  },

  async remove(id: string): Promise<Role> {
    const response = await api.delete<Role>(`/roles/${id}`)
    return response.data
  },

  async setPermissions(id: string, permissionIds: string[]): Promise<Role> {
    const response = await api.put<Role>(`/roles/${id}/permissions`, { permissionIds })
    return response.data
  },
}
