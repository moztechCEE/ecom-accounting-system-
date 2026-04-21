import api from './api'
import { ArInvoice, PaginatedResult } from '../types'

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

export interface ReceivableMonitorItem {
  orderId: string
  orderNumber: string
  orderDate: string
  customerId?: string | null
  customerName: string
  customerEmail?: string | null
  customerPhone?: string | null
  customerType?: 'individual' | 'company'
  channelCode?: string | null
  channelName?: string | null
  sourceLabel: string
  sourceBrand: string
  collectionType?: string
  collectionTypeLabel?: string
  paymentMethodGroup?: string
  paymentMethodLabel?: string
  settlementPhase?: string
  settlementPhaseLabel?: string
  receivableGroupKey?: string
  receivableGroupLabel?: string
  collectionOwner?: string
  collectionOwnerLabel?: string
  termDays?: number
  settlementDiagnostic?: string
  grossAmount: number
  revenueAmount: number
  taxAmount: number
  paidAmount: number
  outstandingAmount: number
  gatewayFeeAmount: number
  platformFeeAmount: number
  feeTotal: number
  netAmount: number
  reconciledFlag: boolean
  payoutCount: number
  feeStatus: 'actual' | 'estimated' | 'unavailable' | string
  feeSource?: string | null
  feeDiagnostic: string
  arInvoiceId?: string | null
  arStatus: string
  dueDate: string
  invoiceId?: string | null
  invoiceNumber?: string | null
  invoiceStatus: string
  invoiceIssuedAt?: string | null
  journalEntryId?: string | null
  journalApprovedAt?: string | null
  accountingPosted: boolean
  warningCodes: string[]
  notes?: string | null
}

export interface ReceivableMonitorSummary {
  grossAmount: number
  paidAmount: number
  outstandingAmount: number
  gatewayFeeAmount: number
  platformFeeAmount: number
  netAmount: number
  invoiceIssuedCount: number
  journalPostedCount: number
  missingFeeCount: number
  missingJournalCount: number
  missingInvoiceCount: number
  outstandingOrderCount: number
  overdueReceivableCount: number
  overdueReceivableAmount: number
  issuedUnpostedCount: number
  issuedUnpaidCount: number
}

export interface ReceivableClassificationGroup {
  key: string
  label: string
  collectionType: string
  collectionTypeLabel: string
  paymentMethodGroup: string
  paymentMethodLabel: string
  settlementPhase: string
  settlementPhaseLabel: string
  collectionOwner: string
  collectionOwnerLabel: string
  orderCount: number
  grossAmount: number
  paidAmount: number
  outstandingAmount: number
  gatewayFeeAmount: number
  platformFeeAmount: number
  feeTotal: number
  netAmount: number
  overdueCount: number
  overdueAmount: number
  missingFeeCount: number
  missingInvoiceCount: number
  missingJournalCount: number
}

export interface ReceivableMonitorResponse {
  entityId: string
  summary: ReceivableMonitorSummary
  classificationGroups?: ReceivableClassificationGroup[]
  items: ReceivableMonitorItem[]
}

export const arService = {
  getInvoices: async (page = 1, limit = 20) => {
    const response = await api.get<PaginatedResult<ArInvoice>>('/ar/invoices', {
      params: { page, limit },
    })
    return response.data
  },

  getInvoice: async (id: string) => {
    const response = await api.get<ArInvoice>(`/ar/invoices/${id}`)
    return response.data
  },

  createInvoice: async (data: Partial<ArInvoice>) => {
    const response = await api.post<ArInvoice>('/ar/invoices', data)
    return response.data
  },

  updateInvoice: async (id: string, data: Partial<ArInvoice>) => {
    const response = await api.patch<ArInvoice>(`/ar/invoices/${id}`, data)
    return response.data
  },

  deleteInvoice: async (id: string) => {
    await api.delete(`/ar/invoices/${id}`)
  },

  getReceivableMonitor: async (params?: {
    entityId?: string
    status?: string
    startDate?: string
    endDate?: string
  }) => {
    const entityId =
      params?.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.get<ReceivableMonitorResponse>('/ar/monitor', {
      params: {
        entityId,
        status: params?.status,
        startDate: params?.startDate,
        endDate: params?.endDate,
      },
    })
    return response.data
  },

  syncSalesOrders: async (entityId?: string) => {
    const resolvedEntityId =
      entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.post('/ar/sync/sales-orders', null, {
      params: {
        entityId: resolvedEntityId,
      },
    })
    return response.data
  },
}
