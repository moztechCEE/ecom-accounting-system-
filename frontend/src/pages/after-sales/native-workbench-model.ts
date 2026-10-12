export const NATIVE_CASE_TYPES = [
  { value: 'RESHIPMENT', label: '補寄服務', description: '補寄品項、缺件原因與收件資料', reason: '補寄原因' },
  { value: 'PRIVATE_PURCHASE', label: '商品與配件訂購', description: '商品、配件、數量與購買需求', reason: '購買需求' },
  { value: 'REPAIR', label: '檢測與維修', description: '故障現象、產品與回收方式', reason: '故障現象' },
  { value: 'EXCHANGE_RETURN', label: '換貨服務', description: '交換原因、回收與寄回資料', reason: '換貨原因' },
  { value: 'REFUND_PICKUP', label: '退貨退款', description: '退回品項、退款原因與收回方式', reason: '退貨原因' },
  { value: 'CUSTOMER_ISSUE', label: '產品問題回報', description: '問題細節、產品與留底資料', reason: '問題細節' },
] as const

export type NativeCaseType = typeof NATIVE_CASE_TYPES[number]['value']
export type NativeScope = 'mine' | 'all'
export type NativeLifecycle = 'active' | 'closed' | 'deleted'
export type NativeFilters = { scope: NativeScope; lifecycle: NativeLifecycle; type?: string; stage?: string; brand?: string; search?: string; page: number; pageSize: number }
export type NativeCreateValues = {
  brand: string; customerKind: string; sourceChannel: string; contactName: string; contactPhone: string;
  contactAddress: string; contactEmail: string; referenceNumber?: string; internalNote?: string;
  reason: string; reshipmentReason?: string; lossCategory?: string; reasonCategory?: string; refundReason?: string;
  items: { productId: string; quantity: number }[]; serialNumber?: string;
}

export function nativeCreateInput(type: NativeCaseType, values: NativeCreateValues) {
  let detail: Record<string, string | number | boolean | null> = {}
  if (type === 'RESHIPMENT') detail = { reshipmentReason: values.reshipmentReason || '', lossCategory: values.lossCategory || '', missingContents: values.reason, requiresPayment: false }
  if (type === 'PRIVATE_PURCHASE') detail = { paymentRegion: 'TAIWAN', requiresPayment: true, currency: 'TWD' }
  if (type === 'REPAIR') detail = { faultDescription: values.reason, serialNumber: values.serialNumber || null, requiresPayment: false, productId: values.items[0]?.productId || null }
  if (type === 'EXCHANGE_RETURN') detail = { reasonCategory: values.reasonCategory || '', reasonNote: values.reason, requiresPayment: false }
  if (type === 'REFUND_PICKUP') detail = { refundReason: values.refundReason || '', itemQuantity: values.items.reduce((sum, item) => sum + item.quantity, 0) }
  if (type === 'CUSTOMER_ISSUE') detail = { brand: values.brand, issueDescription: values.reason }
  return {
    type, sourceChannel: values.sourceChannel, contactName: values.contactName?.trim() || '', contactPhone: values.contactPhone?.trim() || '',
    contactAddress: values.contactAddress?.trim() || '', contactEmail: values.contactEmail?.trim() || '',
    referenceNumber: values.referenceNumber?.trim() || undefined,
    internalNote: [values.internalNote?.trim(), type === 'PRIVATE_PURCHASE' || type === 'REFUND_PICKUP' ? values.reason.trim() : undefined].filter(Boolean).join('\n') || undefined,
    items: values.items.map(item => ({ productId: item.productId, quantity: item.quantity })), detail,
  }
}

export function nativeCaseTypeLabel(type: string): string {
  return NATIVE_CASE_TYPES.find(entry => entry.value === type)?.label || type
}

export function nativeFilters(params: URLSearchParams): NativeFilters {
  const lifecycle = params.get('view')
  const type = params.get('type') || undefined
  const page = Number(params.get('page') || 1)
  return {
    scope: params.get('scope') === 'all' ? 'all' : 'mine',
    lifecycle: lifecycle === 'closed' || lifecycle === 'deleted' ? lifecycle : 'active',
    type: NATIVE_CASE_TYPES.some(entry => entry.value === type) ? type : undefined,
    stage: params.get('stage') || undefined,
    brand: params.get('brand') || undefined,
    search: (params.get('q') || '').slice(0, 120),
    page: Number.isInteger(page) && page > 0 && page <= 100000 ? page : 1,
    pageSize: 25,
  }
}

export function changeNativeFilter(params: URLSearchParams, key: string, value?: string): URLSearchParams {
  const next = new URLSearchParams(params)
  if (value) next.set(key, value)
  else next.delete(key)
  if (key !== 'page' && key !== 'case') next.delete('page')
  return next
}
