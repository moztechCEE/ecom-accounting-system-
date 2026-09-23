import api from './api'
import type { B2BFormalQuote, B2BRequestDetail } from './b2b.service'

export interface B2BAdminSetup {
  company: { id: string; name: string; loginCode: string }
  customers: Array<{ id: string; name: string; companyName: string; code?: string }>
  vendors: Array<{ id: string; name: string }>
  channels: Array<{ id: string; name: string }>
  warehouses: Array<{ id: string; name: string; code?: string }>
  products: Array<{ id: string; sku: string; name: string }>
  accounts: Array<{ id: string; accountType: 'CUSTOMER' | 'SUPPLIER'; customerId: string | null; vendorId: string | null; email: string; name: string; isActive: boolean }>
  catalog: Array<{ productId: string; unitPrice: string; isPublished: boolean }>
  prices: Array<{ customerId: string; productId: string; unitPrice: string; isActive: boolean; validUntil: string | null }>
}

export interface B2BAdminRequest extends B2BRequestDetail {
  customerName: string
}

export interface B2BProductOption { id: string; sku: string; name: string }

export const b2bAdminService = {
  async productOptions(entityId: string, search = '', limit = 20): Promise<{ rows: B2BProductOption[]; total: number; limit: number; hasMore: boolean }> {
    const { data } = await api.get('/b2b/admin/product-options', { params: { entityId, search: search.trim().slice(0, 200), limit } })
    return data
  },
  async setup(entityId: string): Promise<B2BAdminSetup> {
    const { data } = await api.get<B2BAdminSetup>('/b2b/admin/setup', { params: { entityId } })
    return data
  },
  async requests(entityId: string): Promise<B2BAdminRequest[]> {
    const { data } = await api.get<{ items: B2BAdminRequest[] }>('/b2b/admin/requests', { params: { entityId } })
    return data.items
  },
  async createAccount(input: { entityId: string; customerId: string; email: string; name: string; password: string }): Promise<void> {
    await api.post('/b2b/admin/accounts', input)
  },
  async createSupplierAccount(input: { entityId: string; vendorId: string; email: string; name: string; password: string }): Promise<void> {
    await api.post('/b2b/admin/supplier-accounts', input)
  },
  async updateAccount(id: string, input: { entityId: string; isActive: boolean; password?: string }): Promise<void> {
    await api.patch(`/b2b/admin/accounts/${encodeURIComponent(id)}`, input)
  },
  async updateSupplierAccount(id: string, input: { entityId: string; isActive: boolean; password?: string }): Promise<void> {
    await api.patch(`/b2b/admin/supplier-accounts/${encodeURIComponent(id)}`, input)
  },
  async saveCatalog(input: { entityId: string; productId: string; unitPrice: number; isPublished: boolean }): Promise<void> {
    await api.put('/b2b/admin/catalog', input)
  },
  async savePrice(input: { entityId: string; customerId: string; productId: string; unitPrice: number; isActive: boolean; validUntil?: string }): Promise<void> {
    await api.put('/b2b/admin/prices', input)
  },
  async reviewRequest(id: string, input: { entityId: string; items: Array<{ id: string; confirmedQuantity: number }>; reviewNote?: string; deliveryDate?: string }): Promise<void> {
    await api.post(`/b2b/admin/requests/${encodeURIComponent(id)}/review`, input)
  },
  async issueQuote(id: string, input: { entityId: string; validUntil?: string; paymentTerms?: string; deliveryTerms?: string }): Promise<B2BFormalQuote> {
    const { data } = await api.post<B2BFormalQuote>(`/b2b/admin/requests/${encodeURIComponent(id)}/quotes`, input)
    return data
  },
  async withdrawQuote(id: string, version: number, input: { entityId: string; reason: string }): Promise<B2BFormalQuote> {
    const { data } = await api.post<B2BFormalQuote>(`/b2b/admin/requests/${encodeURIComponent(id)}/quotes/${encodeURIComponent(version)}/withdraw`, input)
    return data
  },
  async confirmRequest(id: string, input: { entityId: string; channelId: string; warehouseId: string }): Promise<{ salesOrderId: string; alreadyConfirmed: boolean }> {
    const { data } = await api.post<{ salesOrderId: string; alreadyConfirmed: boolean }>(`/b2b/admin/requests/${encodeURIComponent(id)}/confirm`, input)
    return data
  },
}
