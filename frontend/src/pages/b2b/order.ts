import type { B2BCatalogItem, B2BRequestInput, B2BRequestStatus } from '../../services/b2b.service'

export const statusText: Record<B2BRequestStatus, string> = {
  pending_stock_review: '待人工核對庫存與交期',
  stock_confirmed: '已確認庫存',
  needs_adjustment: '需要調整',
  order_confirmed: '已確認接單',
}

export function buildRequestInput(
  requestId: string,
  customerPoNumber: string,
  note: string,
  quantities: Record<string, number>,
  catalog: B2BCatalogItem[],
): B2BRequestInput {
  const number = customerPoNumber.trim()
  if (!number) throw new Error('請填寫貴公司的採購單號。')

  const visibleProducts = new Set(catalog.map((item) => item.productId))
  const items = Object.entries(quantities)
    .filter(([, quantity]) => quantity !== 0)
    .map(([productId, quantity]) => {
      if (!visibleProducts.has(productId) || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100000) {
        throw new Error('商品或數量無效，請重新檢查。')
      }
      return { productId, quantity }
    })
  if (!items.length) throw new Error('請先選擇至少一項商品。')
  if (items.length > 100) throw new Error('每筆需求最多可包含 100 項商品。')

  return {
    requestId,
    customerPoNumber: number,
    ...(note.trim() ? { note: note.trim() } : {}),
    items,
  }
}

export function quotePath(id: string): string {
  return `/b2b/requests/${encodeURIComponent(id)}`
}

export function formalQuotePath(id: string, version: number): string {
  return `${quotePath(id)}/quote/${encodeURIComponent(version)}`
}

export function canConfirmRequest(request: {
  status: B2BRequestStatus
  quoteVersion: number | null
  quoteStatus: 'sent' | 'accepted' | 'superseded' | null
  salesOrderId: string | null
  items: Array<{ quantity: number; confirmedQuantity: number | null }>
}): boolean {
  return request.status === 'stock_confirmed' && Number.isSafeInteger(request.quoteVersion) && Number(request.quoteVersion) > 0 && request.quoteStatus === 'accepted' && !request.salesOrderId && request.items.length > 0 &&
    request.items.every((item) => item.quantity > 0 && item.confirmedQuantity === item.quantity)
}

export function canIssueQuote(request: {
  status: B2BRequestStatus
  quoteVersion: number | null
  quoteStatus: 'sent' | 'accepted' | 'superseded' | null
  salesOrderId: string | null
  items: Array<{ quantity: number; confirmedQuantity: number | null }>
}): boolean {
  return request.status === 'stock_confirmed' && request.quoteStatus !== 'accepted' && !request.salesOrderId && request.items.length > 0 &&
    request.items.every((item) => item.quantity > 0 && item.confirmedQuantity === item.quantity)
}
