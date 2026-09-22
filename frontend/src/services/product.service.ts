import api from './api'

export interface Product {
  id: string
  sku: string
  name: string
  description?: string
  type: 'SIMPLE' | 'BUNDLE' | 'MANUFACTURED' | 'SERVICE'
  category?: string
  unit?: string
  minStockLevel: number
  safetyStockLevel: number
  salesPrice?: number
  purchaseCost?: number
  movingAverageCost: number
  latestPurchasePrice: number
  inventorySnapshots?: any[]
  parentId?: string
  attributes?: any
  barcode?: string
  modelNumber?: string
  hasSerialNumbers?: boolean
  hsCode?: string
  countryOfOrigin?: string
  packageLength?: number
  packageWidth?: number
  packageHeight?: number
  weight?: number
  grossWeight?: number
  netWeight?: number
}

export interface CreateProductDto {
  sku: string
  name: string
  type: string
  category?: string
  unit?: string
  minStockLevel?: number
  safetyStockLevel?: number
  parentId?: string
  attributes?: any
  barcode: string
  modelNumber?: string
  hasSerialNumbers?: boolean
  hsCode?: string
  countryOfOrigin?: string
  packageLength?: number
  packageWidth?: number
  packageHeight?: number
  weight?: number
  grossWeight?: number
  netWeight?: number
}

const companyParams = () => ({ entityId: localStorage.getItem('entityId')?.trim() || undefined })

export const productService = {
  async findAll(params?: { type?: string; category?: string }) {
    const response = await api.get<Product[]>('/products', { params: { ...companyParams(), ...params } })
    return response.data
  },

  async findOne(id: string) {
    const response = await api.get<Product>(`/products/${id}`, { params: companyParams() })
    return response.data
  },

  async create(data: CreateProductDto) {
    const response = await api.post<Product>('/products', data, { params: companyParams() })
    return response.data
  },

  async update(id: string, data: Partial<CreateProductDto>) {
    const response = await api.patch<Product>(`/products/${id}`, data, { params: companyParams() })
    return response.data
  },

  async updateSnProfile(id: string, data: Record<string, string>) {
    return (await api.patch<Product>(`/products/${id}/sn-profile`, data, { params: companyParams() })).data
  },

  async delete(id: string) {
    const response = await api.delete(`/products/${id}`, { params: companyParams() })
    return response.data
  }
}
