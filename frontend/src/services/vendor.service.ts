import api from './api'
import { Vendor, CreateVendorDto, UpdateVendorDto } from '../types'
import { resolveEntityId } from './entities.service'

export const vendorService = {
  findAll: async (explicitEntityId?: string) => {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.get<Vendor[]>('/vendors', { params: { entityId } })
    return response.data
  },

  findOne: async (id: string, explicitEntityId?: string) => {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.get<Vendor>(`/vendors/${id}`, { params: { entityId } })
    return response.data
  },

  create: async (data: CreateVendorDto, explicitEntityId?: string) => {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.post<Vendor>('/vendors', data, { params: { entityId } })
    return response.data
  },

  update: async (id: string, data: UpdateVendorDto, explicitEntityId?: string) => {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.patch<Vendor>(`/vendors/${id}`, data, { params: { entityId } })
    return response.data
  },

  remove: async (id: string, explicitEntityId?: string) => {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.delete<void>(`/vendors/${id}`, { params: { entityId } })
    return response.data
  },
}
