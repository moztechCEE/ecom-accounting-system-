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
  sourcePlatform?: string
  channelCode?: string
  items?: SalesOrderItem[]
  channelName?: string
  notes?: string
  paidAmountOriginal?: number
  outstandingAmountOriginal?: number
  feeGatewayOriginal?: number
  feePlatformOriginal?: number
  amountNetOriginal?: number
  invoiceNumber?: string | null
  invoiceStatus?: string | null
  invoiceDate?: string | null
  arStatus?: string | null
  arDueDate?: string | null
  journalEntryId?: string | null
  journalApprovedAt?: string | null
  accountingPosted?: boolean
  payments?: Array<{
    id: string
    status: string
    payoutDate?: string
    notes?: string
    amountGrossOriginal?: number
    amountNetOriginal?: number
    feeGatewayOriginal?: number
    feePlatformOriginal?: number
    reconciledFlag?: boolean
  }>
  shipments?: Array<{ id: string; status: string; shipDate?: string }>
}

export interface SalesOrderItem {
  id?: string
  productId?: string
  productName: string
  sku?: string
  category?: string | null
  quantity: number
  unitPrice: number
  discount: number
  taxAmount: number
  lineTotal: number
  currency: string
}

export interface SalesQuotationItem {
  id: string
  productId?: string | null
  itemName: string
  itemSpec?: string | null
  quantity: number
  unitPriceOriginal: number
  discountOriginal: number
  taxRate: number
  taxAmountOriginal: number
  lineTotalOriginal: number
  sortOrder: number
  product?: {
    id: string
    sku: string
    name: string
    modelNumber?: string | null
    category?: string | null
    salesPrice?: number | string
  } | null
}

export interface SalesQuotation {
  id: string
  entityId: string
  customerId?: string | null
  quotationNo: string
  quotationDate: string
  validUntil?: string | null
  ownerName?: string | null
  currency: string
  paymentTerms?: string | null
  deliveryTerms?: string | null
  reference?: string | null
  status: 'draft' | 'pending' | 'approved' | 'sent' | 'accepted' | 'rejected' | 'expired'
  subtotalOriginal: number
  discountAmountOriginal: number
  taxAmountOriginal: number
  totalAmountOriginal: number
  notes?: string | null
  internalNote?: string | null
  approvedAt?: string | null
  createdAt: string
  updatedAt: string
  customer?: {
    id: string
    name: string
    companyName?: string | null
    email?: string | null
    phone?: string | null
    taxId?: string | null
    address?: string | null
    paymentTerms?: string | null
    paymentTermDays?: number | null
  } | null
  items: SalesQuotationItem[]
}

export interface CreateSalesQuotationPayload {
  entityId?: string
  customerId?: string
  quotationDate?: string
  validUntil?: string
  ownerName?: string
  currency?: string
  paymentTerms?: string
  deliveryTerms?: string
  reference?: string
  notes?: string
  internalNote?: string
  items: Array<{
    productId?: string
    itemName: string
    itemSpec?: string
    quantity: number
    unitPriceOriginal: number
    discountOriginal?: number
    taxRate?: number
  }>
}

export type AfterSalesReasonCategory =
  | 'repair'
  | 'exchange'
  | 'return'
  | 'warranty'
  | 'trade_in_upgrade'
  | 'other'

export type AfterSalesCaseStatus =
  | 'customer_service'
  | 'awaiting_payment'
  | 'accounting_invoice'
  | 'warehouse_receiving'
  | 'customer_service_shipping'
  | 'completed'
  | 'cancelled'

export interface AfterSalesCaseItem {
  id: string
  productId?: string | null
  sku?: string | null
  itemName: string
  quantity: number
  unitPriceOriginal: number
  paymentRequired: boolean
  paymentAmountOriginal: number
  notes?: string | null
  product?: {
    id: string
    sku: string
    name: string
  } | null
}

export interface AfterSalesCase {
  id: string
  entityId: string
  customerId?: string | null
  originalSalesOrderId?: string | null
  caseNo: string
  caseDate: string
  reasonCategory: AfterSalesReasonCategory
  status: AfterSalesCaseStatus
  currency: string
  paymentStatus: 'not_required' | 'pending' | 'paid'
  paymentAmountOriginal: number
  paymentLinkUrl?: string | null
  paymentRequestedAt?: string | null
  paidAt?: string | null
  accountingReceivedAt?: string | null
  invoiceId?: string | null
  invoiceNumber?: string | null
  invoiceIssuedAt?: string | null
  warehouseReceivedAt?: string | null
  shippedAt?: string | null
  trackingNo?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  customer?: {
    id: string
    name: string
    companyName?: string | null
    email?: string | null
    phone?: string | null
    mobile?: string | null
  } | null
  items: AfterSalesCaseItem[]
}

export interface AfterSalesCaseListResponse {
  entityId: string
  summary: {
    total: number
    awaitingPayment: number
    accounting: number
    warehouse: number
    shipping: number
    payableAmount: number
  }
  items: AfterSalesCase[]
}

export interface CreateAfterSalesCasePayload {
  entityId?: string
  customerId?: string
  originalSalesOrderId?: string
  caseDate?: string
  reasonCategory: AfterSalesReasonCategory
  currency?: string
  notes?: string
  items: Array<{
    productId?: string
    sku?: string
    itemName?: string
    quantity?: number
    unitPriceOriginal?: number
    paymentRequired?: boolean
    paymentAmountOriginal?: number
    notes?: string
  }>
}

type SalesOrderApiResponse = {
  id: string
  externalOrderId?: string | null
  orderDate: string
  totalGrossOriginal: number | string
  totalGrossCurrency?: string | null
  status: string
  notes?: string | null
  paidAmountOriginal?: number | string
  outstandingAmountOriginal?: number | string
  feeGatewayOriginal?: number | string
  feePlatformOriginal?: number | string
  amountNetOriginal?: number | string
  invoiceNumber?: string | null
  invoiceStatus?: string | null
  arStatus?: string | null
  arDueDate?: string | null
  journalEntryId?: string | null
  journalApprovedAt?: string | null
  accountingPosted?: boolean
  customer?: {
    name?: string | null
    companyName?: string | null
    email?: string | null
    phone?: string | null
    type?: 'individual' | 'company' | null
  } | null
  channel?: {
    code?: string | null
    name?: string | null
  } | null
  items?: Array<{
    id?: string
    productId?: string
    qty?: number | string
    unitPriceOriginal?: number | string
    unitPriceCurrency?: string | null
    discountOriginal?: number | string
    taxAmountOriginal?: number | string
    product?: {
      id?: string
      sku?: string | null
      name?: string | null
      category?: string | null
    } | null
  }>
  payments?: Array<{
    id: string
    status: string
    payoutDate?: string | null
    notes?: string | null
    amountGrossOriginal?: number | string
    amountNetOriginal?: number | string
    feeGatewayOriginal?: number | string
    feePlatformOriginal?: number | string
    reconciledFlag?: boolean
  }>
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

const PLATFORM_KEYWORDS = ['萬魔未來工學院', '萬物未來工學院', '1SHOP', 'SHOPLINE']

const KNOWN_BRANDS = [
  'MOZTECH',
  '墨子科技',
  'BONSON',
  '邦生',
  'AIRITY',
  'MORITEK',
]

const normalizeBrandName = (value?: string | null) => {
  const normalized = (value || '').trim()
  if (!normalized) return ''

  if (/moztech|墨子/i.test(normalized)) return 'MOZTECH'
  if (/bonson|邦生/i.test(normalized)) return 'BONSON'
  if (/airity/i.test(normalized)) return 'AIRITY'
  if (/moritek/i.test(normalized)) return 'MORITEK'

  return normalized
}

const resolveBrandFromItems = (items?: SalesOrderApiResponse['items']) => {
  for (const item of items || []) {
    const productName = item.product?.name?.trim() || ''
    const sku = item.product?.sku?.trim() || ''
    const candidates = [productName, sku]

    for (const candidate of candidates) {
      const [prefix] = candidate.split(/[|｜]/)
      const possibleBrand = normalizeBrandName(prefix)
      if (
        possibleBrand &&
        possibleBrand !== candidate &&
        possibleBrand.length <= 40 &&
        !PLATFORM_KEYWORDS.some((keyword) => possibleBrand.includes(keyword))
      ) {
        return possibleBrand
      }
    }

    for (const brand of KNOWN_BRANDS) {
      if (candidateIncludesBrand(productName, brand) || candidateIncludesBrand(sku, brand)) {
        return normalizeBrandName(brand)
      }
    }
  }

  return ''
}

const candidateIncludesBrand = (candidate: string, brand: string) => {
  if (!candidate || !brand) return false
  return candidate.toLowerCase().includes(brand.toLowerCase())
}

const resolveCommerceBrand = (
  order: SalesOrderApiResponse,
  fallback: string,
) => {
  const itemBrand = resolveBrandFromItems(order.items)
  if (itemBrand) return itemBrand

  const normalizedFallback = normalizeBrandName(fallback)
  if (
    normalizedFallback &&
    !PLATFORM_KEYWORDS.some((keyword) => normalizedFallback.includes(keyword))
  ) {
    return normalizedFallback
  }

  return '未分類品牌'
}

const resolveOrderSource = (order: SalesOrderApiResponse) => {
  const meta = extractMetadata(order.notes)
  const channelCode = order.channel?.code?.trim().toUpperCase() || ''

  if (channelCode === 'SHOPIFY') {
    return {
      sourceLabel: 'MOZTECH 官網',
      sourcePlatform: 'Shopify',
      sourceBrand: 'MOZTECH',
      channelCode,
    }
  }

  if (channelCode === '1SHOP') {
    const storeName = meta.storeName || meta.storeAccount || '萬魔未來工學院團購'
    return {
      sourceLabel: storeName,
      sourcePlatform: storeName,
      sourceBrand: resolveCommerceBrand(order, storeName),
      channelCode,
    }
  }

  if (channelCode === 'SHOPLINE') {
    const storeName = meta.storeName || meta.storeHandle || 'Shopline'
    return {
      sourceLabel: storeName,
      sourcePlatform: storeName,
      sourceBrand: 'BONSON',
      channelCode,
    }
  }

  return {
    sourceLabel: order.channel?.name?.trim() || '其他來源',
    sourcePlatform: order.channel?.name?.trim() || '其他來源',
    sourceBrand: resolveCommerceBrand(order, order.channel?.name?.trim() || '其他來源'),
    channelCode: channelCode || undefined,
  }
}

const resolvePaymentStatus = (order: SalesOrderApiResponse) => {
  const latestPayment = order.payments?.[0]
  const meta = extractMetadata(latestPayment?.notes)
  return meta.gateway || meta.paymentType || latestPayment?.status || 'pending'
}

const resolveInvoiceMetadata = (order: SalesOrderApiResponse) => {
  const meta = extractMetadata(order.notes)

  return {
    invoiceNumber: order.invoiceNumber || meta.invoiceNumber || undefined,
    invoiceStatus:
      order.invoiceStatus ||
      meta.invoiceStatus ||
      (meta.invoiceNumber ? 'issued' : undefined),
    invoiceDate: meta.invoiceDate || undefined,
  }
}

const mapSalesOrder = (order: SalesOrderApiResponse): SalesOrder => ({
  ...resolveOrderSource(order),
  ...resolveInvoiceMetadata(order),
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
  items: (order.items || []).map((item) => {
    const quantity = Number(item.qty || 0)
    const unitPrice = Number(item.unitPriceOriginal || 0)
    const discount = Number(item.discountOriginal || 0)
    const taxAmount = Number(item.taxAmountOriginal || 0)

    return {
      id: item.id,
      productId: item.productId || item.product?.id,
      productName: item.product?.name?.trim() || item.product?.sku?.trim() || '未命名商品',
      sku: item.product?.sku?.trim() || undefined,
      category: item.product?.category || undefined,
      quantity,
      unitPrice,
      discount,
      taxAmount,
      lineTotal: Math.max(quantity * unitPrice - discount, 0),
      currency: item.unitPriceCurrency?.trim() || order.totalGrossCurrency?.trim() || 'TWD',
    }
  }),
  channelName: order.channel?.name?.trim() || '',
  notes: order.notes || undefined,
  paidAmountOriginal: Number(order.paidAmountOriginal || 0),
  outstandingAmountOriginal: Number(order.outstandingAmountOriginal || 0),
  feeGatewayOriginal: Number(order.feeGatewayOriginal || 0),
  feePlatformOriginal: Number(order.feePlatformOriginal || 0),
  amountNetOriginal: Number(order.amountNetOriginal || 0),
  arStatus: order.arStatus || undefined,
  arDueDate: order.arDueDate || undefined,
  journalEntryId: order.journalEntryId || undefined,
  journalApprovedAt: order.journalApprovedAt || undefined,
  accountingPosted: Boolean(order.accountingPosted),
  payments: order.payments?.map((payment) => ({
    id: payment.id,
    status: payment.status,
    payoutDate: payment.payoutDate || undefined,
    notes: payment.notes || undefined,
    amountGrossOriginal: Number(payment.amountGrossOriginal || 0),
    amountNetOriginal: Number(payment.amountNetOriginal || 0),
    feeGatewayOriginal: Number(payment.feeGatewayOriginal || 0),
    feePlatformOriginal: Number(payment.feePlatformOriginal || 0),
    reconciledFlag: Boolean(payment.reconciledFlag),
  })) || [],
  shipments: order.shipments?.map((shipment) => ({
    id: shipment.id,
    status: shipment.status,
    shipDate: shipment.shipDate || undefined,
  })) || [],
})

export const salesService = {
  async findAll(params?: {
    status?: string
    channelId?: string
    entityId?: string
    startDate?: string
    endDate?: string
    limit?: number
  }) {
    const entityId =
      params?.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.get<SalesOrderApiResponse[]>('/sales/orders', {
      params: {
        entityId,
        status: params?.status,
        channelId: params?.channelId,
        startDate: params?.startDate,
        endDate: params?.endDate,
        limit: params?.limit,
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

  async syncInvoiceStatus(id: string) {
    const response = await api.post(`/sales/orders/${id}/invoice-status-sync`)
    return response.data
  },

  async refundOrder(
    id: string,
    payload: {
      refundAmount: number
      reason?: string
      refundDate?: string
    },
  ) {
    const response = await api.post(`/sales/orders/${id}/refund`, payload)
    return response.data
  },

  async syncInvoiceStatusBatch(payload: {
    entityId: string
    channelId?: string
    status?: string
    startDate?: string
    endDate?: string
    limit?: number
  }) {
    const response = await api.post('/sales/orders/invoice-status-sync', payload)
    return response.data
  },

  async importEcpayIssuedInvoices(payload: {
    entityId: string
    merchantKey?: string
    merchantId?: string
    markIssued?: boolean
    rows: Record<string, string | number | boolean | null>[]
    mapping?: Record<string, string | string[]>
  }) {
    const response = await api.post('/sales/orders/ecpay-issued-invoices/import', payload, {
      timeout: 180000,
    })
    return response.data
  },

  async fulfill(id: string, data: { warehouseId: string; itemSerialNumbers?: Record<string, string[]> }, entityId: string) {
    const response = await api.post(`/sales/orders/${id}/fulfill`, data, {
      params: { entityId }
    })
    return response.data
  },

  async findQuotations(params?: {
    entityId?: string
    status?: string
    search?: string
    startDate?: string
    endDate?: string
  }) {
    const entityId =
      params?.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.get<SalesQuotation[]>('/sales/quotations', {
      params: {
        entityId,
        status: params?.status,
        search: params?.search,
        startDate: params?.startDate,
        endDate: params?.endDate,
      },
    })
    return response.data.map(normalizeQuotation)
  },

  async findQuotation(id: string, entityId?: string) {
    const effectiveEntityId = entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.get<SalesQuotation>(`/sales/quotations/${id}`, {
      params: { entityId: effectiveEntityId },
    })
    return normalizeQuotation(response.data)
  },

  async createQuotation(payload: CreateSalesQuotationPayload) {
    const entityId =
      payload.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.post<SalesQuotation>('/sales/quotations', {
      ...payload,
      entityId,
    })
    return normalizeQuotation(response.data)
  },

  async updateQuotationStatus(id: string, status: SalesQuotation['status'], entityId?: string) {
    const effectiveEntityId = entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.post<SalesQuotation>(
      `/sales/quotations/${id}/status`,
      { status },
      { params: { entityId: effectiveEntityId } },
    )
    return normalizeQuotation(response.data)
  },

  async getAfterSalesCases(params?: {
    entityId?: string
    status?: AfterSalesCaseStatus | 'all'
    search?: string
    limit?: number
  }) {
    const entityId =
      params?.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.get<AfterSalesCaseListResponse>('/sales/after-sales-cases', {
      params: {
        entityId,
        status: params?.status,
        search: params?.search,
        limit: params?.limit,
      },
      timeout: 60000,
    })
    return response.data
  },

  async createAfterSalesCase(payload: CreateAfterSalesCasePayload) {
    const entityId =
      payload.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.post<AfterSalesCase>('/sales/after-sales-cases', {
      ...payload,
      entityId,
    })
    return response.data
  },

  async setAfterSalesItemPaymentRequired(
    caseId: string,
    itemId: string,
    data: { paymentRequired: boolean; paymentAmountOriginal?: number },
    entityId?: string,
  ) {
    const resolvedEntityId =
      entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.patch<AfterSalesCase>(
      `/sales/after-sales-cases/${caseId}/items/${itemId}/payment-required`,
      data,
      { params: { entityId: resolvedEntityId } },
    )
    return response.data
  },

  async issueAfterSalesPayment(caseId: string, entityId?: string) {
    const resolvedEntityId =
      entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.post<AfterSalesCase>(
      `/sales/after-sales-cases/${caseId}/issue-payment`,
      {},
      { params: { entityId: resolvedEntityId } },
    )
    return response.data
  },

  async markAfterSalesPaid(caseId: string, entityId?: string) {
    const resolvedEntityId =
      entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.post<AfterSalesCase>(
      `/sales/after-sales-cases/${caseId}/mark-paid`,
      {},
      { params: { entityId: resolvedEntityId } },
    )
    return response.data
  },

  async confirmAfterSalesAccounting(caseId: string, entityId?: string) {
    const resolvedEntityId =
      entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.post<AfterSalesCase>(
      `/sales/after-sales-cases/${caseId}/confirm-accounting`,
      {},
      { params: { entityId: resolvedEntityId } },
    )
    return response.data
  },

  async confirmAfterSalesWarehouseReceived(caseId: string, entityId?: string) {
    const resolvedEntityId =
      entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.post<AfterSalesCase>(
      `/sales/after-sales-cases/${caseId}/confirm-warehouse-received`,
      {},
      { params: { entityId: resolvedEntityId } },
    )
    return response.data
  },

  async shipAfterSalesCase(
    caseId: string,
    data: { trackingNo?: string } = {},
    entityId?: string,
  ) {
    const resolvedEntityId =
      entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
    const response = await api.post<AfterSalesCase>(
      `/sales/after-sales-cases/${caseId}/ship`,
      data,
      { params: { entityId: resolvedEntityId } },
    )
    return response.data
  },
}

const normalizeQuotation = (quotation: SalesQuotation): SalesQuotation => ({
  ...quotation,
  subtotalOriginal: Number(quotation.subtotalOriginal || 0),
  discountAmountOriginal: Number(quotation.discountAmountOriginal || 0),
  taxAmountOriginal: Number(quotation.taxAmountOriginal || 0),
  totalAmountOriginal: Number(quotation.totalAmountOriginal || 0),
  items: (quotation.items || []).map((item) => ({
    ...item,
    quantity: Number(item.quantity || 0),
    unitPriceOriginal: Number(item.unitPriceOriginal || 0),
    discountOriginal: Number(item.discountOriginal || 0),
    taxRate: Number(item.taxRate || 0),
    taxAmountOriginal: Number(item.taxAmountOriginal || 0),
    lineTotalOriginal: Number(item.lineTotalOriginal || 0),
  })),
})
