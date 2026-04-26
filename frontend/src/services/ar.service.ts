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
  paymentTerms?: string | null
  paymentTermDays?: number
  isMonthlyBilling?: boolean
  billingCycle?: string | null
  statementEmail?: string | null
  collectionOwnerName?: string | null
  collectionNote?: string | null
  creditLimit?: number
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
  overpaidAmount?: number
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
  overpaidReceivableCount?: number
  overpaidReceivableAmount?: number
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
  overpaidCount?: number
  overpaidAmount?: number
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

export interface OverpaidReceivablePayment {
  paymentId: string
  payoutBatchId?: string | null
  channel?: string | null
  status?: string | null
  payoutDate: string
  createdAt: string
  amountGrossOriginal: number
  amountNetOriginal: number
  feeGatewayOriginal: number
  feePlatformOriginal: number
  reconciledFlag: boolean
  providerPaymentId?: string | null
  feeStatus?: string | null
  feeSource?: string | null
}

export interface OverpaidReceivableItem {
  orderId: string
  orderNumber: string
  orderDate: string
  channelCode?: string | null
  channelName?: string | null
  grossAmount: number
  paidAmount: number
  overpaidAmount: number
  paymentCount: number
  duplicateAmountGroups: Array<{ amount: number; count: number }>
  exactDoublePaid: boolean
  allPaymentsUnreconciled: boolean
  hasDraftOrPendingPayment?: boolean
  diagnosis: string
  resolutionCategory:
    | 'duplicate_import_candidate'
    | 'multi_payment_review'
    | 'manual_review'
    | string
  resolutionLabel: string
  resolutionAction: string
  resolutionChecks: string[]
  candidateDuplicatePaymentIds: string[]
  payments: OverpaidReceivablePayment[]
}

export interface OverpaidReceivablesResponse {
  entityId: string
  range: {
    startDate?: string | null
    endDate?: string | null
  }
  limit: number
  offset?: number
  filter?: {
    resolutionCategory?: string | null
  }
  totalCount?: number
  filteredCount?: number
  summary: {
    overpaidOrderCount: number
    overpaidAmount: number
    exactDoublePaidCount: number
    unreconciledOverpaidCount: number
    duplicateAmountGroupCount: number
    duplicateImportCandidateCount?: number
    multiPaymentReviewCount?: number
    manualReviewCount?: number
  }
  items: OverpaidReceivableItem[]
}

export interface B2BStatementOrder {
  orderId: string
  orderNumber: string
  orderDate: string
  dueDate: string
  sourceLabel: string
  grossAmount: number
  paidAmount: number
  outstandingAmount: number
  invoiceNumber?: string | null
  invoiceStatus: string
  accountingPosted: boolean
  daysPastDue: number
}

export interface B2BStatementCustomer {
  customerId?: string | null
  customerName: string
  customerEmail?: string | null
  statementEmail?: string | null
  customerPhone?: string | null
  paymentTerms?: string | null
  paymentTermDays: number
  isMonthlyBilling: boolean
  billingCycle?: string | null
  collectionOwner?: string | null
  collectionNote?: string | null
  creditLimit: number
  orderCount: number
  openOrderCount: number
  grossAmount: number
  paidAmount: number
  outstandingAmount: number
  overdueAmount: number
  overdueCount: number
  currentAmount: number
  due1To30Amount: number
  due31To60Amount: number
  due61To90Amount: number
  dueOver90Amount: number
  missingInvoiceCount: number
  missingJournalCount: number
  missingFeeCount: number
  lastOrderDate?: string | null
  nextStatementDate: string
  riskLevel: 'normal' | 'attention' | 'warning' | 'critical' | string
  recommendedAction: string
  orders: B2BStatementOrder[]
}

export interface B2BStatementResponse {
  entityId: string
  asOfDate: string
  summary: {
    customerCount: number
    openCustomerCount: number
    grossAmount: number
    paidAmount: number
    outstandingAmount: number
    overdueAmount: number
    overdueCustomerCount: number
    overCreditCount: number
    missingStatementEmailCount: number
  }
  customers: B2BStatementCustomer[]
}

export interface CreateArInvoicePayload {
  entityId: string
  customerId?: string | null
  invoiceNo?: string | null
  amountOriginal: number
  amountCurrency?: string
  paidAmountOriginal?: number
  issueDate: string
  dueDate: string
  status?: string
  sourceModule?: string | null
  sourceId?: string | null
  notes?: string | null
}

export interface RecordArPaymentPayload {
  amount: number
  paymentDate?: string
  paymentMethod?: string
  note?: string
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

  createInvoice: async (data: CreateArInvoicePayload) => {
    const response = await api.post<ArInvoice>('/ar/invoices', data)
    return response.data
  },

  updateInvoice: async (id: string, data: Partial<ArInvoice>) => {
    const response = await api.patch<ArInvoice>(`/ar/invoices/${id}`, data)
    return response.data
  },

  recordPayment: async (id: string, data: RecordArPaymentPayload) => {
    const response = await api.put<ArInvoice>(`/ar/invoices/${id}/receive`, data)
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
      timeout: 60000,
    })
    return response.data
  },

  getOverpaidReceivables: async (params?: {
    entityId?: string
    startDate?: string
    endDate?: string
    limit?: number
    offset?: number
    resolutionCategory?: string
  }) => {
    const entityId =
      params?.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.get<OverpaidReceivablesResponse>('/ar/overpaid', {
      params: {
        entityId,
        startDate: params?.startDate,
        endDate: params?.endDate,
        limit: params?.limit,
        offset: params?.offset,
        resolutionCategory: params?.resolutionCategory,
      },
      timeout: 60000,
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

  getB2BStatements: async (params?: {
    entityId?: string
    startDate?: string
    asOfDate?: string
  }) => {
    const entityId =
      params?.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.get<B2BStatementResponse>('/ar/b2b-statements', {
      params: {
        entityId,
        startDate: params?.startDate,
        asOfDate: params?.asOfDate,
      },
      timeout: 60000,
    })
    return response.data
  },
}
