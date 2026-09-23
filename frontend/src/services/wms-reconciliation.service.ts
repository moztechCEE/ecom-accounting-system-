import api from './api'

export type HandoverEventStatus = 'pending' | 'partial' | 'posted'
export type HandoverLineStatus = 'pending' | 'posted'
export type HandoverListStatus = 'pending' | 'posted' | 'all'

export interface HandoverPackage {
  packageId: string
  quantity: number
}

export interface HandoverLine {
  id: string
  shipmentLineId: string
  salesOrderLineId: string
  productId: string
  sku: string
  productName: string
  quantity: number
  orderedQuantity: number
  postedQuantity: number
  status: HandoverLineStatus
  packages: HandoverPackage[]
  postedAt?: string | null
  postedBy?: string | null
  unitCostBase?: string | number | null
  totalCostBase?: string | number | null
}

export interface HandoverEvent {
  id: string
  eventId: string
  shipmentId: string
  salesOrderId: string
  orderNumber: string
  warehouseId?: string
  nativeIntakeId?: number
  wmsOrderId?: number
  occurredAt: string
  receivedAt?: string
  status: HandoverEventStatus
  handover: {
    method: string
    carrier?: string | null
    trackingNo?: string | null
    manifestId?: string | null
    operatorId: string
    note?: string | null
  }
  lines: HandoverLine[]
}

export interface PostHandoverLineResult {
  lineId: string
  status: 'posted'
  alreadyPosted: boolean
  postedAt: string
  unitCostBase: string | number
  totalCostBase: string | number
}

export interface HandoverEventPage {
  items: HandoverEvent[]
  total: number
  page: number
  pageSize: number
}

export const wmsReconciliationService = {
  async list(entityId: string, status: HandoverListStatus, page: number, pageSize: number, filters: { search?: string; occurredOn?: string } = {}): Promise<HandoverEventPage> {
    const { data } = await api.get<HandoverEventPage>('/wms/reconciliation', {
      params: { entityId, status, page, pageSize, ...filters },
    })
    return data
  },

  async detail(entityId: string, id: string): Promise<HandoverEvent> {
    const { data } = await api.get<HandoverEvent>(`/wms/reconciliation/${encodeURIComponent(id)}`, {
      params: { entityId },
    })
    return data
  },

  async postLine(entityId: string, id: string, note?: string): Promise<PostHandoverLineResult> {
    const { data } = await api.post<PostHandoverLineResult>(
      `/wms/reconciliation/lines/${encodeURIComponent(id)}/post`,
      { entityId, ...(note?.trim() ? { note: note.trim() } : {}) },
    )
    return data
  },
}
