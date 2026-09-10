import api from './api'

export const LEGACY_WORKBENCH_URL =
  'https://moztech-after-sales-system-sp5g377smq-de.a.run.app/dashboard'
export const legacyCaseUrl = (id: string) =>
  `${new URL(LEGACY_WORKBENCH_URL).origin}/cases/${encodeURIComponent(id)}`
export type WorkbenchView = 'active' | 'urgent' | 'closed' | 'all'
export type WorkbenchWorkflow = {
  queue: string | null
  queueLabel: string | null
  stageLabel: string | null
  ownerRoleLabel: string | null
  nextAction: string | null
  isLocked: boolean | null
  isOverdue: boolean | null
  overdueLabel: string | null
}
export type WorkbenchCase = {
  id: string
  caseNumber: string
  type: string
  status: string
  sourceChannel: string | null
  referenceNumber: string | null
  contactName: string | null
  isUrgent: boolean
  handlerName: string | null
  assigneeName: string | null
  registeredAt: string | null
  updatedAt: string | null
  workflow: WorkbenchWorkflow
}
export type WorkbenchEnvelope = {
  mode: 'read_only'
  checkedAt: string
  sourceCommit: string | null
  featureBaseline: string | null
}
export type WorkbenchList = WorkbenchEnvelope & {
  items: WorkbenchCase[]
  summary: { total: number; active: number; urgent: number; closed: number }
  page: {
    number: number
    pageSize: number
    totalCount: number
    hasMore: boolean
  }
}
export type WorkbenchField = {
  key: string
  label: string
  value: string | number | boolean | null
}
export type WorkbenchDetail = WorkbenchEnvelope & {
  id: string
  caseNumber: string
  type: string
  status: string
  workflow: WorkbenchWorkflow
  sections: {
    key: string
    title: string
    records: { key: string; fields: WorkbenchField[] }[]
  }[]
}
export type WorkbenchFilters = {
  page: number
  pageSize: number
  view: WorkbenchView
  type?: string
  status?: string
  search?: string
}

function requireEntity(entityId: string) {
  if (!entityId.trim()) throw new Error('請先選擇登入公司')
  return entityId.trim()
}

export const afterSalesWorkbench = {
  async list(entityId: string, filters: WorkbenchFilters, signal: AbortSignal) {
    const response = await api.get<WorkbenchList>(
      '/after-sales/workbench/cases',
      { params: { ...filters, entityId: requireEntity(entityId) }, signal },
    )
    return response.data
  },
  async detail(entityId: string, id: string, signal: AbortSignal) {
    const response = await api.get<WorkbenchDetail>(
      `/after-sales/workbench/cases/${encodeURIComponent(id)}`,
      { params: { entityId: requireEntity(entityId) }, signal },
    )
    return response.data
  },
}
