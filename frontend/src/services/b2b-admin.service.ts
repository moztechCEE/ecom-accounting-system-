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
  customerId?: string
}

export interface B2BProductOption { id: string; sku: string; name: string }

export interface B2BPriceOffer {
  id: string
  unitPrice: string
  startsAt: string
  endsAt: string
  audience: 'ALL' | 'CODE'
  audienceCode: string | null
  isActive: boolean
}

export interface B2BPriceBook {
  productId: string
  sku: string
  name: string
  isPublished: boolean
  isPublic: boolean
  currency: 'TWD'
  taxBasis: 'TAX_INCLUDED' | 'TAX_EXCLUDED'
  msrp: string | null
  regularPrice: string | null
  groupBuyPrice: string | null
  updatedAt: string | null
  offers: B2BPriceOffer[]
}

export interface B2BPriceOfferInput {
  entityId: string
  unitPrice: number
  startsAt: string
  endsAt: string
  audience: B2BPriceOffer['audience']
  audienceCode?: string | null
  isActive?: boolean
}

export interface B2BCustomerDiscount {
  customerId: string
  customerName?: string
  multiplier: string
  basePriceType: 'MSRP' | 'REGULAR'
  validFrom: string
  validUntil: string | null
  isActive: boolean
}

export interface B2BCustomerDiscountPreviewLine {
  productId: string
  quantity: number
  source: 'FIXED_OVERRIDE' | 'CUSTOMER_DISCOUNT' | null
  basePriceType: 'MSRP' | 'REGULAR' | null
  baseUnitPrice: string | null
  multiplier: string | null
  selectedUnitPrice: string | null
  taxBasis: 'TAX_INCLUDED' | 'TAX_EXCLUDED' | null
  quoteUnitPrice: string | null
  quoteLineTotal: string | null
  eligible: boolean
  reason?: string
}

export interface B2BAdminPage<T> {
  rows: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export const b2bAdminService = {
  async productOptions(entityId: string, search = '', limit = 20): Promise<{ rows: B2BProductOption[]; total: number; limit: number; hasMore: boolean }> {
    const { data } = await api.get('/b2b/admin/product-options', { params: { entityId, search: search.trim().slice(0, 200), limit } })
    return data
  },
  async priceBooks(entityId: string, options: { search?: string; limit?: number; offset?: number } = {}): Promise<B2BAdminPage<B2BPriceBook>> {
    const { data } = await api.get<B2BAdminPage<B2BPriceBook>>('/b2b/admin/price-books', { params: { entityId, ...options } })
    return data
  },
  async savePriceBook(productId: string, input: { entityId: string; currency: 'TWD'; taxBasis: B2BPriceBook['taxBasis']; msrp: number; regularPrice: number | null; groupBuyPrice: number | null; isPublic: boolean }): Promise<B2BPriceBook> {
    const { data } = await api.put<B2BPriceBook>(`/b2b/admin/price-books/${encodeURIComponent(productId)}`, input)
    return data
  },
  async createPriceOffer(productId: string, input: B2BPriceOfferInput): Promise<B2BPriceOffer> {
    const { data } = await api.post<B2BPriceOffer>(`/b2b/admin/price-books/${encodeURIComponent(productId)}/offers`, input)
    return data
  },
  async updatePriceOffer(productId: string, offerId: string, input: B2BPriceOfferInput): Promise<B2BPriceOffer> {
    const { data } = await api.patch<B2BPriceOffer>(`/b2b/admin/price-books/${encodeURIComponent(productId)}/offers/${encodeURIComponent(offerId)}`, input)
    return data
  },
  async previewPrice(productId: string, input: { entityId: string; priceType: 'MSRP' | 'REGULAR' | 'GROUP_BUY' | 'CAMPAIGN'; offerId?: string; quantity: number; at?: string; audienceCode?: string }): Promise<{ priceType: string; unitPrice: string | null; lineTotal: string | null; currency: 'TWD'; taxBasis: B2BPriceBook['taxBasis']; eligible: boolean; reason?: string }> {
    const { data } = await api.post(`/b2b/admin/price-books/${encodeURIComponent(productId)}/preview`, input)
    return data
  },
  async customerDiscounts(entityId: string, options: { search?: string; limit?: number; offset?: number } = {}): Promise<B2BAdminPage<B2BCustomerDiscount>> {
    const { data } = await api.get<B2BAdminPage<B2BCustomerDiscount>>('/b2b/admin/customer-discounts', { params: { entityId, ...options } })
    return data
  },
  async saveCustomerDiscount(customerId: string, input: { entityId: string; multiplier: number; basePriceType: B2BCustomerDiscount['basePriceType']; validFrom: string; validUntil: string | null; isActive: boolean }): Promise<B2BCustomerDiscount> {
    const { data } = await api.put<B2BCustomerDiscount>(`/b2b/admin/customer-discounts/${encodeURIComponent(customerId)}`, input)
    return data
  },
  async previewCustomerDiscount(customerId: string, input: { entityId: string; items: Array<{ productId: string; quantity: number }>; at?: string }): Promise<{ currency: 'TWD'; items: B2BCustomerDiscountPreviewLine[] }> {
    const { data } = await api.post<{ currency: 'TWD'; items: B2BCustomerDiscountPreviewLine[] }>(`/b2b/admin/customer-discounts/${encodeURIComponent(customerId)}/preview`, input)
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
  async formalQuote(id: string, version: number, entityId: string): Promise<B2BFormalQuote> {
    const { data } = await api.get<B2BFormalQuote>(`/b2b/admin/requests/${encodeURIComponent(id)}/quotes/${encodeURIComponent(version)}`, { params: { entityId } })
    return data
  },
  async issueQuote(id: string, input: {
    entityId: string
    items: Array<{ requestItemId: string; quantity: number; unitPrice: number }>
    validUntil?: string
    paymentTerms?: string
    deliveryTerms?: string
  }): Promise<B2BFormalQuote> {
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
