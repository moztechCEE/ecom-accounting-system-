import axios from 'axios'
import { API_URL } from './api'

export interface PublicCatalogItem {
  productId: string
  sku: string
  name: string
  brand: string | null
  category: string | null
  msrp: string
  currency: 'TWD'
  taxBasis: 'TAX_INCLUDED' | 'TAX_EXCLUDED'
}

export interface PublicCatalogPage {
  items: PublicCatalogItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface PublicCatalogFacets {
  brands: string[]
  categories: string[]
}

export interface GuestRequestInput {
  entityId: string
  requestId: string
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone?: string
  customerPoNumber?: string
  note?: string
  items: Array<{ productId: string; quantity: number }>
}

export interface GuestRequestReceipt {
  accepted: true
  reference: string
  orderUrl: string
}

export interface GuestOrderSummary {
  reference: string
  createdAt: string
  status: 'NEW' | 'MATCHED'
  items: Array<{
    sku: string
    name: string
    quantity: number
    msrp: string
    currency: 'TWD'
    taxBasis: 'TAX_INCLUDED' | 'TAX_EXCLUDED'
    lineTotal: string
  }>
}

// Public traffic must never inherit an employee or customer Authorization header.
const publicApi = axios.create({ baseURL: API_URL, timeout: 30000, headers: { 'Content-Type': 'application/json' } })

export const b2bPublicService = {
  async catalog(entityId: string, options: { search?: string; brand?: string; category?: string; limit?: number; offset?: number } = {}): Promise<PublicCatalogPage> {
    const { data } = await publicApi.get<PublicCatalogPage>('/b2b/public/catalog', { params: { entityId, ...options } })
    if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total)) throw new Error('公開商品資料格式不正確')
    return data
  },
  async catalogFacets(entityId: string): Promise<PublicCatalogFacets> {
    const { data } = await publicApi.get<PublicCatalogFacets>('/b2b/public/catalog/facets', { params: { entityId } })
    if (!data || !Array.isArray(data.brands) || !Array.isArray(data.categories)) throw new Error('公開商品篩選資料格式不正確')
    return data
  },
  async submitRequest(input: GuestRequestInput): Promise<GuestRequestReceipt> {
    const { data } = await publicApi.post<GuestRequestReceipt>('/b2b/public/requests', input)
    if (!data || data.accepted !== true || typeof data.reference !== 'string' || typeof data.orderUrl !== 'string' ||
        !/^\/b2b\/order\/G-[0-9A-F]{24}$/.test(data.orderUrl)) throw new Error('採購單受理資料格式不正確')
    return data
  },
  async guestOrder(reference: string): Promise<GuestOrderSummary> {
    const { data } = await publicApi.get<GuestOrderSummary>(`/b2b/public/orders/${encodeURIComponent(reference)}`)
    if (!data || data.reference !== reference || !Array.isArray(data.items)) throw new Error('採購單資料格式不正確')
    return data
  },
}

export function publicB2bError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 503) return '公開採購入口尚未開放，請稍後再試或聯絡業務。'
    if (error.response?.status === 429) return '操作太頻繁，請稍後再試。'
    const body = error.response?.data as { message?: unknown } | undefined
    if (typeof body?.message === 'string' && body.message.trim()) return body.message
    if (!error.response) return '無法連接系統，請檢查網路後重試。'
  }
  return fallback
}
