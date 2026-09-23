import type { CreatePurchaseOrderDto } from '../services/purchase.service'

type Choice = { id: string; isActive?: boolean }
type ManualPurchaseOrderInput = CreatePurchaseOrderDto

export function buildManualPurchaseOrder(
  input: ManualPurchaseOrderInput,
  vendors: Choice[],
  products: Choice[],
): CreatePurchaseOrderDto {
  const vendorId = input.vendorId?.trim()
  if (!vendors.some((vendor) => vendor.id === vendorId && vendor.isActive !== false)) throw new Error('請選擇目前公司的有效供應商。')
  const orderDate = input.orderDate?.trim()
  const date = new Date(`${orderDate}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== orderDate) {
    throw new Error('請填寫有效的採購日期。')
  }
  const currency = input.currency?.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('請選擇有效幣別。')
  if (!Number.isFinite(input.fxRate) || input.fxRate <= 0 || input.fxRate > 1_000_000 || Number(input.fxRate.toFixed(6)) !== input.fxRate) {
    throw new Error('匯率需大於 0，且最多六位小數。')
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 1000) throw new Error('請加入 1 至 1000 項商品。')
  const seen = new Set<string>()
  const items = input.items.map(({ productId, qty, unitCost }) => {
    const id = productId?.trim()
    if (!products.some((product) => product.id === id && product.isActive !== false)) throw new Error('採購品項包含無效或非目前公司的商品。')
    if (seen.has(id)) throw new Error('同一商品請合併為一行。')
    seen.add(id)
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1_000_000) throw new Error('採購數量需為 1 至 1,000,000 的整數。')
    if (!Number.isFinite(unitCost) || unitCost <= 0 || unitCost > 100_000_000 || Number(unitCost.toFixed(2)) !== unitCost) throw new Error('商品單價需大於 0、不超過 100,000,000，且最多兩位小數。')
    return { productId: id, qty, unitCost }
  })
  return { vendorId, orderDate, currency, fxRate: input.fxRate, items, notes: input.notes?.trim() || undefined }
}
