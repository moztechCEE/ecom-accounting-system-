import api from './api'
import { Account } from '../types'

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

export const accountingService = {
  async getAccounts(entityId?: string): Promise<Account[]> {
    const effectiveEntityId = entityId?.trim() || DEFAULT_ENTITY_ID
    const response = await api.get<Account[]>('/accounting/accounts', {
      params: { entityId: effectiveEntityId },
    })
    return response.data
  },

  async getAccountById(id: string): Promise<Account> {
    const response = await api.get<Account>(`/accounting/accounts/${id}`)
    return response.data
  },

  async getPeriods(entityId?: string, status?: string): Promise<AccountingPeriod[]> {
    const effectiveEntityId = entityId?.trim() || DEFAULT_ENTITY_ID
    const response = await api.get<AccountingPeriod[]>('/accounting/periods', {
      params: { entityId: effectiveEntityId, status },
    })
    return response.data
  },

  async getJournals(entityId?: string, periodId?: string): Promise<JournalEntry[]> {
    const effectiveEntityId = entityId?.trim() || DEFAULT_ENTITY_ID
    const response = await api.get<JournalEntry[]>('/accounting/journals', {
      params: { entityId: effectiveEntityId, periodId },
    })
    return response.data
  },

  async getIncomeStatement(startDate: string, endDate: string, entityId?: string): Promise<IncomeStatement> {
    const effectiveEntityId = entityId?.trim() || DEFAULT_ENTITY_ID
    const response = await api.get<IncomeStatement>('/accounting/reports/income-statement', {
      params: { entityId: effectiveEntityId, startDate, endDate },
    })
    return response.data
  },

  async getBalanceSheet(asOfDate: string, entityId?: string): Promise<BalanceSheet> {
    const effectiveEntityId = entityId?.trim() || DEFAULT_ENTITY_ID
    const response = await api.get<BalanceSheet>('/accounting/reports/balance-sheet', {
      params: { entityId: effectiveEntityId, asOfDate },
    })
    return response.data
  },

  async analyzeReport(data: { entityId: string; startDate: string; endDate: string; context?: string }): Promise<any> {
    const response = await api.post('/reports/analyze', data)
    return response.data
  },

}

export interface AccountingPeriod {
  id: string
  entityId: string
  name: string
  startDate: string
  endDate: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface JournalLine {
  id: string
  debit: number | string
  credit: number | string
  currency: string
  amountBase: number | string
  memo?: string | null
  account: {
    id: string
    code: string
    name: string
    type: string
  }
}

export interface JournalEntry {
  id: string
  entityId: string
  date: string
  description: string
  sourceModule?: string | null
  sourceId?: string | null
  periodId?: string | null
  approvedAt?: string | null
  journalLines: JournalLine[]
}

export interface ReportItem {
  code: string
  name: string
  amount: number
}

export interface IncomeStatement {
  entityId: string
  startDate: string
  endDate: string
  revenues: ReportItem[]
  expenses: ReportItem[]
  totalRevenue: number
  totalExpense: number
  netIncome: number
}

export interface BalanceSheet {
  entityId: string
  asOfDate: string
  assets: ReportItem[]
  liabilities: ReportItem[]
  equity: ReportItem[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  calculatedRetainedEarnings: number
}
