// Planning only. Issuance must eventually be a server transaction with a unique
// constraint, idempotency key and an explicitly approved sequence scope.
export type LabelTarget = 'box' | 'device'
export type LabelLayout = {
  width: number; height: number; showQr: boolean; target: LabelTarget
  textX: number; textY: number; fontSize: number
  qrX: number; qrY: number; qrSize: number
}
export type SnDraft = {
  version: 1; id: string; updatedAt: string; name: string
  productId: string; productName: string; sku: string; barcode: string; model: string
  style: string; color: string; modelCode: string; styleCode: string; colorCode: string
  orderDate: string; manufactureDate: string; year: number
  quantity: number; capacity: number | null; label: LabelLayout
}
export const PENDING_RULES = [
  ['流水號範圍', '各款色獨立或共用流水號、跨批接續與作廢方式'],
  ['箱號規則', '同日多批的箱號接續、未滿箱與重裝箱'],
  ['裝箱對應', '箱內順序、跳號與換箱紀錄'],
  ['匯入格式', '倉儲欄位與保固 SKU 對應'],
  ['掃箱出庫', '查詢、確認出貨與重複掃描的處理'],
] as const
export const defaultLayout = (): LabelLayout => ({
  width: 28, height: 7.5, target: 'box', showQr: true,
  textX: 8, textY: 0.7, fontSize: 1.45, qrX: 0.25, qrY: 0.25, qrSize: 6,
})
export function newDraft(id: string, now = new Date()): SnDraft {
  return {
    version: 1, id, updatedAt: '', name: '', productId: '', productName: '', sku: '', barcode: '', model: '',
    style: '', color: '', modelCode: '', styleCode: '', colorCode: '',
    orderDate: '', manufactureDate: '', year: now.getFullYear(), quantity: 100, capacity: null, label: defaultLayout(),
  }
}
export function yearCode(year: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) throw new Error('編碼年份需介於 2000～2099')
  return String(year).slice(-2)
}
export function sampleSerial(draft: SnDraft, sequence = 1): string {
  const prefix = draft.modelCode + draft.styleCode + draft.colorCode
  if (!draft.modelCode || !/^[A-Z0-9]{4,6}$/.test(prefix)) throw new Error('品項代碼合計需為 4～6 碼大寫英數字')
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999999) throw new Error('流水號超出六碼範圍')
  return prefix + yearCode(draft.year) + String(sequence).padStart(6, '0')
}
export function cartonEstimate(quantity: number, capacity: number | null) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999999 ||
      capacity === null || !Number.isInteger(capacity) || capacity < 1 || capacity > 999999) return null
  return { boxes: Math.ceil(quantity / capacity), full: Math.floor(quantity / capacity), remainder: quantity % capacity }
}
export function constrainLayout(layout: LabelLayout): LabelLayout {
  const bounded = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  const width = bounded(layout.width, 15, 150), height = bounded(layout.height, 7.5, 150)
  const fontSize = bounded(layout.fontSize, 0.8, Math.min(8, (height - 1.5) / 3.6))
  const qrSize = bounded(layout.qrSize, 3, Math.min(width, height - 1))
  return { ...layout, width, height, fontSize, qrSize, showQr: layout.target === 'box' || layout.showQr,
    textX: bounded(layout.textX, 0, width - 5), textY: bounded(layout.textY, 0, height - fontSize * 3.6 - 1),
    qrX: bounded(layout.qrX, 0, width - qrSize), qrY: bounded(layout.qrY, 0, height - qrSize - 1) }
}
export function samplePayload(draft: SnDraft): string {
  // Samples must never be accepted as real stock/warranty serials.
  return 'DRAFT:' + sampleSerial(draft)
}
export function draftStorageKey(entityId: string, userId: string) {
  if (!entityId.trim() || !userId.trim()) throw new Error('缺少公司或使用者資訊')
  return `corely.sn-labels.v1:${encodeURIComponent(entityId)}:${encodeURIComponent(userId)}`
}
export function parseDrafts(raw: string | null): SnDraft[] {
  if (!raw) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || data.length > 100) throw new Error('草稿格式不正確')
  const keys = ['id', 'updatedAt', 'name', 'productId', 'productName', 'sku', 'barcode', 'model', 'style', 'color',
    'modelCode', 'styleCode', 'colorCode', 'orderDate', 'manufactureDate'] as const
  return data.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('草稿格式不正確')
    const d = value as SnDraft
    if (d.version !== 1 || keys.some(k => typeof d[k] !== 'string' || d[k].length > 250) || !d.id ||
        !Number.isInteger(d.quantity) || d.quantity < 1 || d.quantity > 999999 ||
        (d.capacity !== null && (!Number.isInteger(d.capacity) || d.capacity < 1 || d.capacity > 999999))) throw new Error('草稿格式不正確')
    yearCode(d.year)
    const l = d.label
    if (!l || !['box', 'device'].includes(l.target) || typeof l.showQr !== 'boolean' ||
        (['width', 'height', 'textX', 'textY', 'fontSize', 'qrX', 'qrY', 'qrSize'] as const).some(k => !Number.isFinite(l[k]))) throw new Error('標籤格式不正確')
    return { ...d, label: constrainLayout(l) }
  })
}
