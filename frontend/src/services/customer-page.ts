export interface CustomerPage<T> {
  rows: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  nextOffset: number | null
}

export function customerPageParams(input: { limit?: number; offset?: number; search?: string }) {
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50)))
  const offset = Math.max(0, Math.trunc(input.offset ?? 0))
  const search = input.search?.trim().slice(0, 200)
  return { limit, offset, ...(search ? { search } : {}) }
}

export function parseCustomerPage<T>(value: unknown): CustomerPage<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('客戶列表回應格式錯誤：需要分頁資料')
  }
  const page = value as Partial<CustomerPage<T>>
  if (!Array.isArray(page.rows) || !Number.isSafeInteger(page.total) ||
      !Number.isSafeInteger(page.limit) || !Number.isSafeInteger(page.offset) ||
      typeof page.hasMore !== 'boolean' ||
      (page.nextOffset !== null && !Number.isSafeInteger(page.nextOffset))) {
    throw new Error('客戶列表回應格式錯誤：分頁欄位不完整')
  }
  return page as CustomerPage<T>
}

export function includeSelectedCustomer<T extends { id: string }>(rows: T[], selectedId?: string, selected?: T | null): T[] {
  return selectedId && selected?.id === selectedId && !rows.some((row) => row.id === selectedId)
    ? [selected, ...rows]
    : rows
}
