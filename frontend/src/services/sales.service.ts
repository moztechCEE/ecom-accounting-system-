import api from './api'

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

export interface SalesOrder {
  id: string
  orderNumber: string
  customerName?: string
  totalAmount: number
  currency: string
  status: 'pending' | 'completed' | 'cancelled'
  paymentStatus: string
  fulfillmentStatus: string
  createdAt: string
  items?: any[]
  channelName?: string
  payments?: Array<{ id: string; status: string; payoutDate?: string }>
  shipments?: Array<{ id: string; status: string; shipDate?: string }>
}

type SalesOrderApiResponse = {
  id: string
  externalOrderId?: string | null
  orderDate: string
  totalGrossOriginal: number | string
  totalGrossCurrency?: string | null
  status: string
  customer?: {
    name?: string | null
  } | null
  channel?: {
    name?: string | null
  } | null
  items?: any[]
  payments?: Array<{ id: string; status: string; payoutDate?: string | null }>
  shipments?: Array<{ id: string; status: string; shipDate?: string | null }>
}

const mapSalesOrder = (order: SalesOrderApiResponse): SalesOrder => ({
  id: order.id,
  orderNumber: order.externalOrderId?.trim() || order.id,
  customerName: order.customer?.name?.trim() || 'Guest',
  totalAmount: Number(order.totalGrossOriginal || 0),
  currency: order.totalGrossCurrency?.trim() || 'TWD',
  status: (order.status as SalesOrder['status']) || 'pending',
  paymentStatus: order.payments?.[0]?.status || 'pending',
  fulfillmentStatus: order.shipments?.[0]?.status || 'pending',
  createdAt: order.orderDate,
  items: order.items || [],
  channelName: order.channel?.name?.trim() || '',
  payments: order.payments?.map((payment) => ({
    id: payment.id,
    status: payment.status,
    payoutDate: payment.payoutDate || undefined,
  })) || [],
  shipments: order.shipments?.map((shipment) => ({
    id: shipment.id,
    status: shipment.status,
    shipDate: shipment.shipDate || undefined,
  })) || [],
})

export const salesService = {
  async findAll(params?: { status?: string; channelId?: string; entityId?: string }) {
    const entityId =
      params?.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.get<SalesOrderApiResponse[]>('/sales/orders', {
      params: {
        entityId,
        status: params?.status,
        channelId: params?.channelId,
      },
    })
    return response.data.map(mapSalesOrder)
  },

  async findOne(id: string) {
    const response = await api.get<SalesOrder>(`/sales/orders/${id}`)
    return response.data
  },

  async create(data: any) {
    const response = await api.post<SalesOrder>('/sales/orders', data)
    return response.data
  },

  async complete(id: string) {
    const response = await api.post<SalesOrder>(`/sales/orders/${id}/complete`)
    return response.data
  },

  async fulfill(id: string, data: { warehouseId: string; itemSerialNumbers?: Record<string, string[]> }, entityId: string) {
    const response = await api.post(`/sales/orders/${id}/fulfill`, data, {
      params: { entityId }
    })
    return response.data
  }
}
