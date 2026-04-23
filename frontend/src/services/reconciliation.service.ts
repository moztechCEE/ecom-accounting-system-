import api from './api'

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

export type ReconciliationBucketKey =
  | 'pending_payout'
  | 'ready_to_clear'
  | 'cleared'
  | 'exceptions'

export type ReconciliationCenterItem = {
  key: string
  orderId: string
  orderNumber: string
  customerName: string
  sourceLabel: string
  sourceBrand?: string | null
  channelCode?: string | null
  orderDate: string
  dueDate?: string | null
  bucket: ReconciliationBucketKey
  bucketLabel: string
  grossAmount: number
  paidAmount: number
  netAmount: number
  feeTotal: number
  gatewayFeeAmount?: number
  platformFeeAmount?: number
  outstandingAmount: number
  invoiceNumber?: string | null
  invoiceStatus?: string | null
  feeStatus?: string | null
  feeSource?: string | null
  reconciledFlag: boolean
  accountingPosted: boolean
  settlementPhase?: string | null
  settlementPhaseLabel?: string | null
  collectionOwnerLabel?: string | null
  severity: 'healthy' | 'warning' | 'critical'
  reason: string
  nextAction: string
  anomalyCodes?: string[]
  anomalyMessages?: string[]
  providerTradeNo?: string | null
  providerPaymentId?: string | null
}

export type ReconciliationCenterBucket = {
  key: ReconciliationBucketKey
  label: string
  count: number
  grossAmount: number
  paidAmount: number
  netAmount: number
  outstandingAmount: number
  feeTotal: number
  items: ReconciliationCenterItem[]
}

export type ReconciliationCenterResponse = {
  entityId: string
  range: {
    startDate: string | null
    endDate: string | null
  }
  summary: {
    totalCount: number
    pendingPayoutCount: number
    readyToClearCount: number
    clearedCount: number
    exceptionCount: number
    grossAmount: number
    paidAmount: number
    netAmount: number
    outstandingAmount: number
    pendingPayoutAmount: number
    exceptionAmount: number
    feeTotal: number
    completionRate: number
    lastGeneratedAt: string
  }
  buckets: Record<ReconciliationBucketKey, ReconciliationCenterBucket>
  priorityItems: ReconciliationCenterItem[]
  rules: Array<{
    key: string
    label: string
    description: string
  }>
}

export type ReconciliationRunStep = {
  key: string
  label: string
  status: 'success' | 'skipped' | 'failed'
  result?: any
  error?: string
}

export type ReconciliationRunResponse = {
  success: boolean
  entityId: string
  range: {
    startDate: string
    endDate: string
  }
  steps: ReconciliationRunStep[]
  failedCount: number
  summary: ReconciliationCenterResponse['summary']
  priorityItems: ReconciliationCenterItem[]
}

export type ClearReadyPaymentsResponse = {
  entityId: string
  dryRun: boolean
  scanned: number
  cleared: number
  skipped: number
  failed: number
  ready: number
  reasonSummary?: Record<string, number>
  topReasons?: Array<{
    reason: string
    count: number
  }>
  results: Array<{
    paymentId: string
    orderId: string | null
    externalOrderId: string | null
    status: 'cleared' | 'skipped' | 'failed' | 'dry_run'
    reason?: string
    journalEntryId?: string | null
  }>
}

export type ImportProviderPayoutsResponse = {
  success: boolean
  batchId: string
  provider: 'ecpay' | 'hitrust' | 'linepay'
  recordCount: number
  matchedCount: number
  unmatchedCount: number
  invalidCount: number
}

export const reconciliationService = {
  getCenter: async (params?: {
    entityId?: string
    startDate?: string
    endDate?: string
    limit?: number
  }) => {
    const entityId =
      params?.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.get<ReconciliationCenterResponse>('/reconciliation/center', {
      params: {
        entityId,
        startDate: params?.startDate,
        endDate: params?.endDate,
        limit: params?.limit,
      },
    })
    return response.data
  },

  runCore: async (params: {
    entityId?: string
    startDate?: string
    endDate?: string
    syncShopify?: boolean
    syncOneShop?: boolean
    syncEcpayPayouts?: boolean
    syncInvoices?: boolean
    syncLinePayStatuses?: boolean
    autoClear?: boolean
  }) => {
    const entityId =
      params.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.post<ReconciliationRunResponse>(
      '/reconciliation/run',
      {
        entityId,
        startDate: params.startDate,
        endDate: params.endDate,
        syncShopify: params.syncShopify,
        syncOneShop: params.syncOneShop,
        syncEcpayPayouts: params.syncEcpayPayouts,
        syncInvoices: params.syncInvoices,
        syncLinePayStatuses: params.syncLinePayStatuses,
        autoClear: params.autoClear,
      },
      {
        timeout: 180000,
      },
    )
    return response.data
  },

  clearReady: async (params: {
    entityId?: string
    startDate?: string
    endDate?: string
    limit?: number
    dryRun?: boolean
  }) => {
    const entityId =
      params.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.post<ClearReadyPaymentsResponse>(
      '/reconciliation/clear-ready',
      {
        entityId,
        startDate: params.startDate,
        endDate: params.endDate,
        limit: params.limit,
        dryRun: params.dryRun,
      },
      {
        timeout: 120000,
      },
    )
    return response.data
  },

  importProviderPayouts: async (params: {
    entityId?: string
    provider: 'ecpay' | 'hitrust' | 'linepay'
    sourceType?: 'statement' | 'reconciliation'
    fileName?: string
    rows: Record<string, string | number | boolean | null>[]
    mapping?: Record<string, string | string[]>
    notes?: string
  }) => {
    const entityId =
      params.entityId?.trim() || localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID

    const response = await api.post<ImportProviderPayoutsResponse>(
      '/reconciliation/payouts/import',
      {
        entityId,
        provider: params.provider,
        sourceType: params.sourceType || 'statement',
        fileName: params.fileName,
        rows: params.rows,
        mapping: params.mapping,
        notes: params.notes,
      },
      {
        timeout: 180000,
      },
    )
    return response.data
  },
}
