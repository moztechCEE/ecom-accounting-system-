import axios from 'axios'
import { API_URL } from './api'

export interface B2BProfile {
  id: string
  name: string
  customerId: string
  customerName: string
  entityId: string
  companyName: string
}

export interface B2BCatalogItem {
  productId: string
  sku: string
  name: string
  description: string | null
  unitPrice: string
  currency: 'TWD'
}

export interface B2BCatalog {
  currency: 'TWD'
  taxRate: string
  items: B2BCatalogItem[]
}

export type B2BRequestStatus = 'pending_stock_review' | 'stock_confirmed' | 'needs_adjustment' | 'order_confirmed'

export interface B2BRequestDetail {
  id: string
  requestNumber: string
  customerPoNumber: string
  status: B2BRequestStatus
  salesOrderId: string | null
  currency: 'TWD'
  subtotal: string
  tax: string
  total: string
  note: string | null
  createdAt: string
  reviewedAt: string | null
  reviewNote: string | null
  deliveryDate: string | null
  items: Array<{
    id: string
    productId: string
    sku: string
    name: string
    quantity: number
    confirmedQuantity: number | null
    unitPrice: string
    lineTotal: string
  }>
  quotePath: string
  quoteVersion: number | null
  quoteStatus: 'sent' | 'accepted' | 'superseded' | 'withdrawn' | null
  formalQuotePath: string | null
}

export interface B2BFormalQuote {
  id: string
  requestId: string
  requestNumber: string
  customerPoNumber: string
  quotationNo: string
  quotationDate: string
  sellerName: string
  sellerTaxId: string | null
  buyerName: string
  buyerTaxId: string | null
  version: number
  status: 'sent' | 'accepted' | 'superseded' | 'withdrawn'
  validUntil: string | null
  acceptedAt: string | null
  withdrawnAt: string | null
  withdrawalReason: string | null
  currency: 'TWD'
  subtotal: string
  tax: string
  total: string
  deliveryDate: string | null
  paymentTerms: string | null
  deliveryTerms: string | null
  items: Array<{
    requestItemId: string
    productId: string
    sku: string
    name: string
    quantity: number
    unitPrice: string
    lineTotal: string
    taxAmount: string
    total: string
  }>
  quotePath: string
}

export interface B2BRequestInput {
  requestId: string
  customerPoNumber: string
  note?: string
  items: Array<{ productId: string; quantity: number }>
}

// Customer credentials are intentionally independent of employee access_token.
const TOKEN_KEY = 'corely_b2b_access_token'

export const getB2BToken = (): string | null => sessionStorage.getItem(TOKEN_KEY)
export const clearB2BToken = (): void => sessionStorage.removeItem(TOKEN_KEY)

const b2bApi = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

b2bApi.interceptors.request.use((config) => {
  const token = getB2BToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

b2bApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) clearB2BToken()
    return Promise.reject(error)
  },
)

export const b2bService = {
  async login(companyCode: string, email: string, password: string): Promise<B2BProfile> {
    const { data } = await b2bApi.post<{
      token: string
      expiresAt: string
      profile: B2BProfile
    }>('/b2b/portal/login', {
      companyCode: companyCode.trim(),
      email: email.trim().toLowerCase(),
      password,
    })
    sessionStorage.setItem(TOKEN_KEY, data.token)
    return data.profile
  },

  async me(): Promise<B2BProfile> {
    const { data } = await b2bApi.get<B2BProfile>('/b2b/portal/me')
    return data
  },

  async logout(): Promise<void> {
    try {
      await b2bApi.post('/b2b/portal/logout')
    } finally {
      clearB2BToken()
    }
  },

  async catalog(): Promise<B2BCatalog> {
    const { data } = await b2bApi.get<B2BCatalog>('/b2b/portal/catalog')
    return data
  },

  async submitRequest(input: B2BRequestInput): Promise<B2BRequestDetail> {
    const { data } = await b2bApi.post<B2BRequestDetail>('/b2b/portal/requests', input)
    return data
  },

  async requests(): Promise<B2BRequestDetail[]> {
    const { data } = await b2bApi.get<{ items: B2BRequestDetail[] }>('/b2b/portal/requests')
    return data.items
  },

  async request(id: string): Promise<B2BRequestDetail> {
    const { data } = await b2bApi.get<B2BRequestDetail>(`/b2b/portal/requests/${encodeURIComponent(id)}`)
    return data
  },

  async quote(requestId: string, version: number): Promise<B2BFormalQuote> {
    const { data } = await b2bApi.get<B2BFormalQuote>(`/b2b/portal/requests/${encodeURIComponent(requestId)}/quotes/${encodeURIComponent(version)}`)
    return data
  },

  async acceptQuote(requestId: string, version: number): Promise<B2BFormalQuote> {
    const { data } = await b2bApi.post<B2BFormalQuote>(`/b2b/portal/requests/${encodeURIComponent(requestId)}/quotes/${encodeURIComponent(version)}/accept`)
    return data
  },
}

export function b2bErrorMessage(error: unknown, fallback: string, unauthorized = '登入已失效，請重新登入客戶入口。'): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return unauthorized
    const body = error.response?.data as { message?: unknown } | undefined
    if (typeof body?.message === 'string' && body.message.trim()) return body.message
    if (!error.response) return '無法連接系統，請檢查網路後重試。'
  }
  return fallback
}
