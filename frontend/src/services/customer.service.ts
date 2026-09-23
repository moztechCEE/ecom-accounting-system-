import api from './api'
import { resolveEntityId } from './entities.service'

export interface Customer {
  id: string
  code?: string
  name: string
  email?: string
  phone?: string
  phoneExtension?: string
  mobile?: string
  taxId?: string
  companyName?: string
  type: 'individual' | 'company'
  contactPerson?: string
  address?: string
  summary?: string
  paymentTerms?: string
  paymentTermDays?: number
  isMonthlyBilling?: boolean
  billingCycle?: string
  statementEmail?: string
  collectionOwner?: string
  collectionNote?: string
  creditLimit?: number | string
  paymentSummary?: string
  isActive: boolean
  totalOrders?: number
  lastOrderDate?: string | null
  sourceLabels?: string[]
  sourceBrands?: string[]
  primarySourceLabel?: string
  primarySourceBrand?: string
}

export const customerService = {
  async findAll(explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.get<Customer[]>('/customers', { params: { entityId } })
    return response.data
  },

  async findOne(id: string, explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.get<Customer>(`/customers/${id}`, { params: { entityId } })
    return response.data
  },

  async create(data: Partial<Customer>, explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.post<Customer>('/customers', data, { params: { entityId } })
    return response.data
  },

  async update(id: string, data: Partial<Customer>, explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.patch<Customer>(`/customers/${id}`, data, { params: { entityId } })
    return response.data
  },

  async delete(id: string, explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.delete(`/customers/${id}`, { params: { entityId } })
    return response.data
  }
}
