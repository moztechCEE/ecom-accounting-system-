import api from './api'

export interface Customer {
  id: string
  name: string
  email?: string
  phone?: string
  taxId?: string
  type: 'individual' | 'company'
  address?: string
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
