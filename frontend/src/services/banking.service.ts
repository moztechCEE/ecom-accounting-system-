import api from './api'
import { BankAccount, BankTransaction, PaginatedResult } from '../types'

export const bankingService = {
  getAccounts: async () => {
    const response = await api.get<BankAccount[]>('/banking/accounts')
    return response.data
  },

  getAccount: async (id: string) => {
    const response = await api.get<BankAccount>(`/banking/accounts/${id}`)
    return response.data
  },

  createAccount: async (
    data: Partial<BankAccount> & {
      openingBalance?: number
      openingBalanceDate?: string
      allowedUserIds?: string[]
      accountName?: string
      accountAlias?: string
    },
  ) => {
    const response = await api.post<BankAccount>('/banking/accounts', data)
    return response.data
  },

  updateAccountAccess: async (id: string, allowedUserIds: string[]) => {
    const response = await api.put<BankAccount>(`/banking/accounts/${id}/access`, {
      allowedUserIds,
    })
    return response.data
  },

  getTransactions: async (options: { accountId?: string; page?: number; limit?: number } = {}) => {
    const { accountId, page = 1, limit = 20 } = options
    const response = await api.get<PaginatedResult<BankTransaction> | BankTransaction[]>('/banking/transactions', {
      params: {
        bankAccountId: accountId,
        page,
        limit,
      },
    })
    if (Array.isArray(response.data)) {
      return {
        items: response.data,
        meta: {
          total: response.data.length,
          page,
          limit,
          totalPages: 1,
        },
      }
    }
    return response.data
  },

  importTransactions: async (accountId: string, file: File) => {
    const csvContent = await file.text()
    const response = await api.post(`/banking/accounts/${accountId}/import-statement`, {
      csvContent,
    })
    return response.data
  },
}
