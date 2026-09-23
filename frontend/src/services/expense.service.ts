import api from './api'
import { TaxType } from '../types'

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

export interface ExpenseAccountRef {
  id: string
  code: string
  name: string
}

export interface ApprovalPolicyStep {
  id: string
  stepOrder: number
  approverRoleCode?: string | null
  requiresDepartmentHead?: boolean | null
  minAmount?: string | number | null
  maxAmount?: string | number | null
}

export interface ApprovalPolicySummary {
  id: string
  name: string
  description?: string | null
  isActive?: boolean
  steps?: ApprovalPolicyStep[]
}

export interface ReimbursementItem {
  id: string
  entityId: string
  name: string
  description?: string | null
  accountId: string
  account?: ExpenseAccountRef | null
  keywords?: string | null
  amountLimit?: string | number | null
  defaultTaxType?: TaxType | null
  requiresDepartmentHead?: boolean
  approverRoleCodes?: string | null
  approvalPolicyId?: string | null
  defaultReceiptType?: string | null
  allowedRoles?: string | null
  allowedDepartments?: string | null
  allowedReceiptTypes?: string | null
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
  approvalPolicy?: {
    id: string
    steps: ApprovalPolicyStep[]
  } | null
}

export interface UpsertReimbursementItemPayload {
  entityId?: string
  name: string
  description?: string
  accountId: string
  keywords?: string[]
  amountLimit?: number
  requiresDepartmentHead?: boolean
  approverRoleCodes?: string[]
  approvalPolicyId?: string | null
  defaultReceiptType?: string | null
  allowedRoles?: string[]
  allowedDepartments?: string[]
  allowedReceiptTypes?: string[]
  isActive?: boolean
}

export interface ExpenseRequest {
  canReview?: boolean
  currentApprover?: { id: string; name: string } | null
  approvalSteps?: { id: string; status: string; approverUserId?: string | null; approverUser?: { id: string; name: string } | null }[]
  id: string
  entityId: string
  amountOriginal: number | string
  amountCurrency: string
  amountFxRate: number | string
  amountBase: number | string
  description: string
  remarks?: string | null
  status: string
  priority: string
  dueDate?: string | null
  createdAt: string
  updatedAt: string
  suggestionConfidence?: number | string | null
  suggestedAccount?: ExpenseAccountRef | null
  finalAccount?: ExpenseAccountRef | null
  reimbursementItemId?: string | null
  finalAccountId?: string | null
  reimbursementItem?: ReimbursementItem | null
  payeeType?: string | null
  paymentMethod?: string | null
  paymentStatus?: string
  paymentBankName?: string | null
  paymentAccountLast5?: string | null
  metadata?: Record<string, any> | null
  creator?: {
    id: string
    name: string
    email: string
  }
  attachmentUrl?: string | null
  evidenceFiles?: any[] | null
}

export interface ExpenseHistoryEntry {
  id: string
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  note?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: string
  actor?: {
    id: string
    name: string
    email?: string | null
  } | null
  suggestedAccount?: ExpenseAccountRef | null
  finalAccount?: ExpenseAccountRef | null
}

export interface PredictionResult {
  suggestedItem: ReimbursementItem | null
  confidence: number
  amount?: number
  reason: string
}

export interface SubmitFeedbackPayload {
  suggestedAccountId?: string
  chosenAccountId?: string
  confidence?: number
  label?: string
  features?: Record<string, unknown>
  comment?: string
}

export interface EvidenceFile {
  name: string
  url: string
  mimeType?: string
}

export interface CreateExpenseRequestPayload {
  payeeType?: string
  paymentMethod?: string
  priority?: string
  taxType?: string
  taxAmount?: number
  entityId?: string
  reimbursementItemId: string
  amountOriginal: number
  amountCurrency?: string
  amountFxRate?: number
  dueDate?: string
  description: string
  remarks?: string
  receiptType?: string
  metadata?: Record<string, unknown>
  departmentId?: string
  vendorId?: string
  evidenceFiles?: EvidenceFile[]
}

export interface ApproveExpenseRequestPayload {
  approvalStepId?: string
  finalAccountId?: string
  remark?: string
  metadata?: Record<string, unknown>
}

export interface LegacyApprovalRoutePreview {
  requestId: string
  expectedUpdatedAt: string
  routeToken: string
  requesterName: string
  supervisor: { id: string; name: string; userId: string }
  steps: { order: number; approverName: string | null; roleCode: string | null }[]
}

export interface RejectExpenseRequestPayload {
  approvalStepId?: string
  reason: string
  note?: string
  metadata?: Record<string, unknown>
}

const buildParams = (params: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => Boolean(value)))

export const expenseService = {
  async predictCategory(entityId: string, description: string, model?: string): Promise<PredictionResult | null> {
    const { data } = await api.post<PredictionResult | null>('/expense/predict-category', {
      entityId,
      description,
      model,
    })
    return data
  },

  async getReimbursementItems(
    entityId: string = DEFAULT_ENTITY_ID,
    roles?: string[],
    departmentId?: string,
  ) {
    const effectiveEntityId = entityId?.trim() || DEFAULT_ENTITY_ID
    const params: Record<string, string> = { entityId: effectiveEntityId }
    if (roles && roles.length) {
      params.roles = roles.join(',')
    }
    if (departmentId) {
      params.departmentId = departmentId
    }
    const response = await api.get<ReimbursementItem[]>('/expense/reimbursement-items', { params })
    return response.data
  },

  async getExpenseRequests(options: { entityId?: string; status?: string; mine?: boolean } = {}) {
    const params = buildParams({
      entityId: options.entityId?.trim() || DEFAULT_ENTITY_ID,
      status: options.status,
      mine: options.mine ? 'true' : undefined,
    })
    const response = await api.get<ExpenseRequest[]>('/expense/requests', { params })
    return response.data
  },

  async getExpenseRequest(id: string) {
    const response = await api.get<ExpenseRequest>(`/expense/requests/${id}`)
    return response.data
  },

  async getExpenseRequestHistory(id: string) {
    const response = await api.get<ExpenseHistoryEntry[]>(`/expense/requests/${id}/history`)
    return response.data
  },

  async createExpenseRequest(payload: CreateExpenseRequestPayload) {
    const response = await api.post<ExpenseRequest>('/expense/requests', {
      entityId: payload.entityId?.trim() || DEFAULT_ENTITY_ID,
      reimbursementItemId: payload.reimbursementItemId,
      payeeType: payload.payeeType,
      paymentMethod: payload.paymentMethod,
      remarks: payload.remarks,
      priority: payload.priority,
      taxType: payload.taxType,
      taxAmount: payload.taxAmount,
      amountOriginal: payload.amountOriginal,
      amountCurrency: payload.amountCurrency ?? 'TWD',
      amountFxRate: payload.amountFxRate ?? 1,
      dueDate: payload.dueDate,
      description: payload.description,
      receiptType: payload.receiptType,
      metadata: payload.metadata,
      departmentId: payload.departmentId,
      vendorId: payload.vendorId,
      evidenceFiles: payload.evidenceFiles,
    })
    return response.data
  },

  async submitFeedback(requestId: string, payload: SubmitFeedbackPayload) {
    const response = await api.post(`/expense/requests/${requestId}/feedback`, payload)
    return response.data
  },

  async listReimbursementItemsAdmin(params: { entityId?: string; includeInactive?: boolean } = {}) {
    const query = buildParams({
      entityId: params.entityId?.trim() || DEFAULT_ENTITY_ID,
      includeInactive: params.includeInactive ? 'true' : undefined,
    })
    const response = await api.get<ReimbursementItem[]>('/expense/admin/reimbursement-items', {
      params: query,
    })
    return response.data
  },

  async listApprovalPolicies(entityId?: string) {
    const response = await api.get<ApprovalPolicySummary[]>(
      '/expense/admin/approval-policies',
      {
        params: { entityId: entityId?.trim() || DEFAULT_ENTITY_ID },
      },
    )
    return response.data
  },

  async createReimbursementItemAdmin(payload: UpsertReimbursementItemPayload) {
    const body = buildReimbursementPayload(payload, true)
    const response = await api.post<ReimbursementItem>(
      '/expense/admin/reimbursement-items',
      body,
    )
    return response.data
  },

  async updateReimbursementItemAdmin(
    id: string,
    payload: UpsertReimbursementItemPayload,
  ) {
    const body = buildReimbursementPayload(payload)
    const response = await api.put<ReimbursementItem>(
      `/expense/admin/reimbursement-items/${id}`,
      body,
    )
    return response.data
  },

  async archiveReimbursementItemAdmin(id: string) {
    const response = await api.put<ReimbursementItem>(
      `/expense/admin/reimbursement-items/${id}/archive`,
    )
    return response.data
  },

  async approveExpenseRequest(
    requestId: string,
    payload: ApproveExpenseRequestPayload,
  ) {
    const response = await api.put<ExpenseRequest>(
      `/expense/requests/${requestId}/approve`,
      payload,
    )
    return response.data
  },

  async previewLegacyApprovalRoute(requestId: string) {
    const { data } = await api.get<LegacyApprovalRoutePreview>(`/expense/requests/${requestId}/legacy-approval-route`)
    return data
  },

  async assignLegacyApprovalRoute(requestId: string, preview: LegacyApprovalRoutePreview) {
    const { data } = await api.put<ExpenseRequest>(`/expense/requests/${requestId}/legacy-approval-route`, {
      expectedUpdatedAt: preview.expectedUpdatedAt,
      routeToken: preview.routeToken,
    })
    return data
  },

  async seedAiItems(entityId: string) {
    const response = await api.post(`/expense/seed-ai-items`, { entityId })
    return response.data
  },

  async rejectExpenseRequest(
    requestId: string,
    payload: RejectExpenseRequestPayload,
  ) {
    const response = await api.put<ExpenseRequest>(
      `/expense/requests/${requestId}/reject`,
      payload,
    )
    return response.data
  },

  updatePaymentInfo: async (id: string, data: { 
    bankAccountId?: string;
    amount?: number;
    paymentDate?: string;
    paymentMethod?: string; 
    paymentStatus: string;
    paymentBankName?: string;
    paymentAccountLast5?: string;
  }) => {
    const response = await api.put<ExpenseRequest>(`/expense/requests/${id}/payment-info`, data)
    return response.data
  },
}

const normalizeList = (values?: string[]): string[] | undefined => {
  if (!values) return undefined
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length)
  return normalized.length ? normalized : undefined
}

const buildReimbursementPayload = (
  payload: UpsertReimbursementItemPayload,
  requireEntity = false,
) => {
  const entityId = payload.entityId?.trim() || DEFAULT_ENTITY_ID
  if (requireEntity && !payload.entityId) {
    // ensure entity id is explicitly included when required
    payload = { ...payload, entityId }
  }

  return {
    ...payload,
    entityId,
    keywords: normalizeList(payload.keywords),
    approverRoleCodes: normalizeList(payload.approverRoleCodes),
    allowedRoles: normalizeList(payload.allowedRoles),
    allowedDepartments: normalizeList(payload.allowedDepartments),
    allowedReceiptTypes: normalizeList(payload.allowedReceiptTypes),
  }
}
