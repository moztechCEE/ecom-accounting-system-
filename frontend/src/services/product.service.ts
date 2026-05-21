import api from './api'

export interface Product {
  id: string
  sku: string
  name: string
  description?: string
  type: 'RAW_MATERIAL' | 'SEMI_FINISHED' | 'FINISHED_GOOD' | 'SERVICE'
  category?: string
  unit: string
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
  unit: string
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

export const productService = {
  async findAll(params?: { type?: string; category?: string }) {
    const response = await api.get<Product[]>('/products', { params })
    return response.data
  },

  async findOne(id: string) {
    const response = await api.get<Product>(`/products/${id}`)
    return response.data
  },

  async create(data: CreateProductDto) {
    const response = await api.post<Product>('/products', data)
    return response.data
  },

  async update(id: string, data: Partial<CreateProductDto>) {
    const response = await api.patch<Product>(`/products/${id}`, data)
    return response.data
  },

  async delete(id: string) {
    const response = await api.delete(`/products/${id}`)
    return response.data
  }
}
