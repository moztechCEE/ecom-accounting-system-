import api from './api'
import type { ReturnStockInboundProof, ReturnStockProduct, ReturnStockSource, StockReturnReceiptInput } from './repair-stock-return'

export type StockReservation = { id: string; itemId: string; status: string; expiresAt?: string }
export type ReplacementUnit = {
  id: string; unitLabel: string; serialNumber?: string | null; status: string; kind: 'NEW' | 'REFURBISHED'
  qualification: { sku: string; name?: string; hasSerialNumbers?: boolean }; reservations: StockReservation[]
}
export type RepairStockCatalog = {
  products: ReturnStockProduct[]
  warehouses: { id: string; code: string; name: string }[]
  serials: { id: string; productId: string; warehouseId: string; serialNumber: string }[]
  returnItems: ReturnStockSource[]
}
export type StockReturnReceiptResult = {
  unit: ReplacementUnit
  inbound: ReturnStockInboundProof
  duplicate: boolean
}
export type StockQualification = {
  entityId: string; productId: string; warehouseId: string; unitLabel: string; kind: 'NEW' | 'REFURBISHED'
  serialNumber?: string; sourceItemId?: string; sourceReference: string; ownershipReference: string; inspectionReference: string
}
const unwrap = <T,>(response: { data: T | { data: T } }): T => {
  const value = response.data
  return typeof value === 'object' && value !== null && 'data' in value ? (value as { data: T }).data : value as T
}
export const repairStockService = {
  async units(entityId: string, itemId?: string) {
    return unwrap(await api.get<ReplacementUnit[] | { data: ReplacementUnit[] }>('/after-sales/stock/units', { params: { entityId, itemId } }))
  },
  async catalog(entityId: string) {
    return unwrap(await api.get<RepairStockCatalog | { data: RepairStockCatalog }>('/after-sales/stock/catalog', { params: { entityId } }))
  },
  async qualify(input: StockQualification) { await api.post('/after-sales/stock/qualify', input) },
  async receiveReturn(input: StockReturnReceiptInput) {
    return unwrap(await api.post<StockReturnReceiptResult | { data: StockReturnReceiptResult }>('/after-sales/stock/receive-return', input))
  },
  async reserve(input: { entityId: string; itemId: string; unitId: string; requestId: string; expectedVersion: number }) {
    return unwrap(await api.post<StockReservation | { data: StockReservation }>('/after-sales/stock/reserve', input))
  },
  async release(entityId: string, id: string) { await api.post(`/after-sales/stock/reservations/${encodeURIComponent(id)}/release`, { entityId }) },
}
