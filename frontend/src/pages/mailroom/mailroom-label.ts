import { safeItemReturnTo } from '../../utils/mailroom-item-link.ts'

export type MailroomLabelData = {
  id: string; unit: string; caseNumber: string | null; customerName: string | null;
  customerPhone: string | null; customerIssue: string | null; productName: string;
  qrLink: string; version: number;
}
export type PhysicalLabel = {
  id: string; customerName: string; customerPhone: string; caseNumber: string;
  customerIssue: string; productName: string; link: string;
}
export const LABEL_EDIT_LIMITS = { caseNumber: 64, customerName: 80, customerPhone: 40, productName: 120, customerIssue: 300 } as const
export type LabelEditField = keyof typeof LABEL_EDIT_LIMITS
export type MailroomLabelEdit = { itemId: string; expectedVersion: number } & Partial<Record<LabelEditField, string>>
export type PrintProgress = '製作標籤' | '等待電腦接收' | '印表機處理中' | '已送至印表機'
export type DirectLabelPrint = (request: {
  entityId: string; itemIds: string[]; requestId: string; signal: AbortSignal;
  labelEdits?: MailroomLabelEdit[]; onProgress?: (progress: PrintProgress) => void;
}) => Promise<{ status: 'accepted'; jobId: string; message?: string } | { status: 'unknown'; message?: string }>
export class MailroomPrintBlockedError extends Error {
  name = 'MailroomPrintBlockedError'
}

export function normalizeLabelEdits(value: MailroomLabelEdit[] | undefined, itemIds: string[]): MailroomLabelEdit[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > itemIds.length) throw new MailroomPrintBlockedError('標籤編輯資料不完整')
  const seen = new Set<string>()
  return value.map(edit => {
    if (!edit || typeof edit !== 'object' || !itemIds.includes(edit.itemId) || seen.has(edit.itemId) || !Number.isInteger(edit.expectedVersion) || edit.expectedVersion < 1 || Object.keys(edit).some(key => !['itemId', 'expectedVersion'].includes(key) && !Object.hasOwn(LABEL_EDIT_LIMITS, key))) throw new MailroomPrintBlockedError('標籤編輯資料不一致')
    seen.add(edit.itemId)
    const result: MailroomLabelEdit = { itemId: edit.itemId, expectedVersion: edit.expectedVersion }
    for (const field of Object.keys(LABEL_EDIT_LIMITS) as LabelEditField[]) {
      const raw = edit[field]
      if (raw === undefined) continue
      if (typeof raw !== 'string' || /\p{Cc}/u.test(raw) || raw.length > LABEL_EDIT_LIMITS[field]) throw new MailroomPrintBlockedError('標籤文字格式或長度不正確')
      result[field] = raw.trim().replace(/\s+/g, ' ')
    }
    return result
  }).sort((a, b) => a.itemId.localeCompare(b.itemId))
}
const text = (value: string | null) => value?.trim() || '未提供'
export function labelEditFromData(data: MailroomLabelData): MailroomLabelEdit {
  if (!Number.isInteger(data.version) || data.version < 1) throw new MailroomPrintBlockedError('標籤版本不完整，請重新載入')
  return Object.fromEntries([['itemId', data.id], ['expectedVersion', data.version], ...Object.keys(LABEL_EDIT_LIMITS).map(field => [field, (data[field as LabelEditField] || '').replace(/\p{Cc}/gu, ' ').trim().replace(/\s+/g, ' ').slice(0, LABEL_EDIT_LIMITS[field as LabelEditField])])]) as MailroomLabelEdit
}
export function editedLabel(data: MailroomLabelData, edit: MailroomLabelEdit, entityId: string): PhysicalLabel {
  const [normalized] = normalizeLabelEdits([edit], [data.id])!
  return physicalLabel({ ...data, ...normalized, id: data.id, qrLink: data.qrLink }, entityId)
}
export function physicalLabel(data: MailroomLabelData, entityId: string): PhysicalLabel {
  const url = new URL(data.qrLink)
  const target = safeItemReturnTo(url.pathname + url.search + url.hash, entityId)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !target || new URLSearchParams(url.search).get('itemId') !== data.id) {
    throw new Error('物件標籤連結不一致，請重新載入')
  }
  if (![data.customerName, data.customerPhone, data.caseNumber, data.customerIssue, data.productName].every(value => value === null || typeof value === 'string')) {
    throw new Error('物件標籤資料不完整')
  }
  const issue = [...text(data.customerIssue)]
  return {
    id: data.id, customerName: text(data.customerName), customerPhone: text(data.customerPhone),
    caseNumber: text(data.caseNumber), productName: text(data.productName), customerIssue: issue.length > 160 ? issue.slice(0, 159).join('') + '…' : issue.join(''),
    link: url.href,
  }
}

export const MAILROOM_LABEL_PRINT_STYLE = '@page{size:50mm 30mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#000;background:#fff;font-family:Arial,"Noto Sans TC",sans-serif}.mailroom-physical-label{width:50mm;height:30mm;padding:1.5mm;display:grid;grid-template-columns:20mm minmax(0,1fr);grid-template-rows:5.5mm 20mm;column-gap:1.5mm;row-gap:1mm;overflow:hidden;break-after:page;page-break-after:always}.mailroom-physical-label:last-child{break-after:auto;page-break-after:auto}.mailroom-label-case{grid-column:1/-1;font-size:7pt;line-height:1.1;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.mailroom-label-qr{align-self:end}.mailroom-label-qr svg{display:block;width:20mm;height:20mm}.mailroom-label-copy{min-width:0;overflow:hidden;overflow-wrap:anywhere;line-height:1.2;font-size:7pt;writing-mode:horizontal-tb}.mailroom-label-name{font-size:7.5pt;font-weight:700;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.mailroom-label-phone{margin:.6mm 0;font-size:6.5pt}.mailroom-label-product{font-size:6pt;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin:.4mm 0}.mailroom-label-issue{font-size:6.5pt;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}'
