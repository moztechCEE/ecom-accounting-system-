import api from './api'

export interface Customer {
  id: string
  code?: string
  name: string
  email?: string
  phone?: string
  phoneExtension?: string
  taxId?: string
  type: 'individual' | 'company'
  contactPerson?: string
  address?: string
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
  async findAll() {
    const response = await api.get<Customer[]>('/customers')
    return response.data
  },

  async findOne(id: string) {
    const response = await api.get<Customer>(`/customers/${id}`)
    return response.data
  },

  async create(data: Partial<Customer>) {
    const response = await api.post<Customer>('/customers', data)
    return response.data
  },

  async update(id: string, data: Partial<Customer>) {
    const response = await api.patch<Customer>(`/customers/${id}`, data)
    return response.data
  },

  async delete(id: string) {
    const response = await api.delete(`/customers/${id}`)
    return response.data
  }
}
