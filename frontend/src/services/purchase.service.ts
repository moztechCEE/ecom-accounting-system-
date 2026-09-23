import api from './api'
import { resolveEntityId } from './entities.service'

export interface PurchaseOrder {
  id: string
  // poNumber: string // Backend doesn't seem to have poNumber, it uses id or maybe I missed it. Schema has id.
  vendorId: string
  vendor: { name: string }
  status: 'pending' | 'receiving' | 'received' | 'completed' | 'cancelled'
  totalAmountOriginal: number
  totalAmountCurrency: string
  totalAmountFxRate?: string | number
  orderDate: string
  items: PurchaseOrderItem[]
  landedCost?: PurchaseLandedCost | null
}

export interface PurchaseOrderItem {
  id: string
  productId: string
  product: { 
    name: string; 
    sku: string;
    hasSerialNumbers?: boolean;
  }
  qty: number // Backend uses qty
  unitCostOriginal: number
  unitCostBase: string | number
  totalPrice: number
}

export interface LandedCostInput {
  freightCurrency: string
  ratePerKgOriginal: number
  fxRateToBase: number
  weights: Array<{ purchaseOrderItemId: string; chargeableWeightKg: number }>
}

export interface LandedCostPreview {
  freightCurrency: string
  ratePerKgOriginal: string
  fxRateToBase: string
  totalChargeableWeightKg: string
  freightOriginal: string
  freightBase: string
  goodsBase: string
  landedTotalBase: string
  lines: Array<{
    purchaseOrderItemId: string
    productId: string
    sku: string
    qty: string
    chargeableWeightKg: string
    goodsBase: string
    allocatedFreightBase: string
    landedTotalBase: string
    landedUnitCostBase: string
  }>
}

export interface PurchaseLandedCost {
  id: string
  freightCurrency: string
  ratePerKgOriginal: string
  fxRateToBase: string
  totalChargeableWeightKg: string
  freightOriginal: string
  freightBase: string
  goodsBase: string
  lines: Array<{
    purchaseOrderItemId: string
    chargeableWeightKg: string
    allocatedFreightBase: string
    landedUnitCostBase: string
  }>
}

export interface CreatePurchaseOrderDto {
  vendorId: string
  currency: string
  items: {
    productId: string
    quantity: number
    unitPrice: number
  }[]
  expectedDate?: string
  notes?: string
}

export const purchaseService = {
  async findAll(explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.get<PurchaseOrder[]>('/purchase-orders', { params: { entityId } })
    return response.data
  },

  async findOne(id: string, explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.get<PurchaseOrder>(`/purchase-orders/${id}`, { params: { entityId } })
    return response.data
  },

  async create(data: CreatePurchaseOrderDto, explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.post<PurchaseOrder>('/purchase-orders', data, { params: { entityId } })
    return response.data
  },

  async receive(id: string, warehouseId: string, serialNumbers?: { productId: string; serialNumbers: string[] }[], explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.put<PurchaseOrder>(`/purchase-orders/${id}/receive`, { warehouseId, serialNumbers }, { params: { entityId } })
    return response.data
  },

  async previewLandedCost(id: string, data: LandedCostInput, explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.post<LandedCostPreview>(`/purchase-orders/${encodeURIComponent(id)}/landed-cost/preview`, data, { params: { entityId } })
    return response.data
  },

  async saveLandedCost(id: string, data: LandedCostInput, explicitEntityId?: string) {
    const entityId = await resolveEntityId(explicitEntityId)
    const response = await api.put<PurchaseLandedCost>(`/purchase-orders/${encodeURIComponent(id)}/landed-cost`, data, { params: { entityId } })
    return response.data
  },
}
