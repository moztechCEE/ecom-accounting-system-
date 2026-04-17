import api from './api'

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

export interface SalesOrder {
  id: string
  orderNumber: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  customerType?: 'individual' | 'company'
  totalAmount: number
  currency: string
  status: 'pending' | 'completed' | 'cancelled'
  paymentStatus: string
  fulfillmentStatus: string
  createdAt: string
  sourceLabel?: string
  sourceBrand?: string
  channelCode?: string
  items?: any[]
  channelName?: string
  notes?: string
  payments?: Array<{ id: string; status: string; payoutDate?: string; notes?: string }>
  shipments?: Array<{ id: string; status: string; shipDate?: string }>
}

type SalesOrderApiResponse = {
  id: string
  externalOrderId?: string | null
  orderDate: string
  totalGrossOriginal: number | string
  totalGrossCurrency?: string | null
  status: string
  notes?: string | null
  customer?: {
    name?: string | null
    email?: string | null
    phone?: string | null
    type?: 'individual' | 'company' | null
  } | null
  channel?: {
    code?: string | null
    name?: string | null
  } | null
  items?: any[]
  payments?: Array<{ id: string; status: string; payoutDate?: string | null; notes?: string | null }>
  shipments?: Array<{ id: string; status: string; shipDate?: string | null }>
}

const extractMetadata = (notes?: string | null) => {
  const meta: Record<string, string> = {}

  for (const segment of (notes || '').split(/[;\n]/)) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const [rawKey, ...rest] = trimmed.split('=')
    if (!rawKey || !rest.length) continue
    const key = rawKey.replace(/^\[[^\]]+\]\s*/, '').trim()
    meta[key] = rest.join('=').trim()
  }

  return meta
}

const resolveOrderSource = (order: SalesOrderApiResponse) => {
  const meta = extractMetadata(order.notes)
  const channelCode = order.channel?.code?.trim().toUpperCase() || ''

  if (channelCode === 'SHOPIFY') {
    return { sourceLabel: 'MOZTECH 官網', sourceBrand: 'MOZTECH', channelCode }
  }

  if (channelCode === '1SHOP') {
    const storeName = meta.storeName || meta.storeAccount || '萬魔未來工學院團購'
    return {
      sourceLabel: storeName,
      sourceBrand: storeName.includes('萬魔') ? '萬魔未來工學院' : storeName,
      channelCode,
    }
  }

  if (channelCode === 'SHOPLINE') {
    const storeName = meta.storeName || meta.storeHandle || 'Shopline'
    return {
      sourceLabel: storeName,
      sourceBrand: storeName.includes('萬魔') ? '萬魔未來工學院' : storeName,
      channelCode,
    }
  }

  return {
    sourceLabel: order.channel?.name?.trim() || '其他來源',
    sourceBrand: order.channel?.name?.trim() || '其他來源',
    channelCode: channelCode || undefined,
  }
}

const resolvePaymentStatus = (order: SalesOrderApiResponse) => {
  const latestPayment = order.payments?.[0]
  const meta = extractMetadata(latestPayment?.notes)
  return meta.gateway || meta.paymentType || latestPayment?.status || 'pending'
}

const mapSalesOrder = (order: SalesOrderApiResponse): SalesOrder => ({
  ...resolveOrderSource(order),
  id: order.id,
  orderNumber: order.externalOrderId?.trim() || order.id,
  customerName: order.customer?.name?.trim() || 'Guest',
  customerEmail: order.customer?.email?.trim() || undefined,
  customerPhone: order.customer?.phone?.trim() || undefined,
  customerType: order.customer?.type || 'individual',
  totalAmount: Number(order.totalGrossOriginal || 0),
  currency: order.totalGrossCurrency?.trim() || 'TWD',
  status: (order.status as SalesOrder['status']) || 'pending',
  paymentStatus: resolvePaymentStatus(order),
  fulfillmentStatus: order.shipments?.[0]?.status || 'pending',
  createdAt: order.orderDate,
  items: order.items || [],
  channelName: order.channel?.name?.trim() || '',
  notes: order.notes || undefined,
  payments: order.payments?.map((payment) => ({
    id: payment.id,
    status: payment.status,
    payoutDate: payment.payoutDate || undefined,
    notes: payment.notes || undefined,
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
