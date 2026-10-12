import api from './api'
import type { NativeCaseType, NativeFilters } from '../pages/after-sales/native-workbench-model'
import { afterSalesFieldValue } from '../utils/after-sales-display'

export type NativeField = { key: string; label: string; value: string | number | boolean | null }
export type NativeTask = { kind: 'repair' | 'intake'; itemId: string; label: string; actionable: boolean; status?: string; owner?: { erpUserId: string | null; name: string; status: string }; csr?: { status: string; ownerId?: string | null; sentToUserId?: string | null } | null }
export type NativeWorkflow = { queue: string | null; stageLabel: string | null; ownerRoleLabel: string | null; nextAction: string | null; isLocked: boolean; isOverdue: boolean }
export type NativeCaseRow = {
  id: string; caseNumber: string; type: string; status: string; contactName: string | null; contactPhone: string | null;
  brandCode: string | null; brandName: string | null; productSummary: string | null; serialNumber: string | null;
  ownerName: string | null; updatedAt: string | null; workflow: NativeWorkflow; primaryActionLabel: string | null;
  tasks: NativeTask[];
}
export type NativeCaseList = { items: NativeCaseRow[]; summary: { mine: number; all: number }; page: { totalCount: number }; repairQueueHasMore: boolean }
export type NativeCaseDetail = NativeCaseRow & {
  tasks: NativeTask[]; custodySummary: string | null; paymentSummary: string | null; currentStepFields: NativeField[];
  blockers: string[]; sourceSection: string | null;
  sections: { key: string; title: string; records: { key: string; fields: NativeField[] }[] }[];
}
export type NativeBrand = { code: string; name: string }
export type NativeProduct = { id: string; name: string; sku: string; model?: string | null; brand?: string | null }
export type NativeOptions = {
  canReadAll: boolean; createTypes: string[]; brands: NativeBrand[]; products: NativeProduct[];
  stages: { value: string; label: string; quick?: boolean }[];
  sourceChannels: { value: string; label: string }[];
  customerKinds: { value: string; label: string }[];
  reasonOptions: Record<string, { value: string; label: string }[]>;
}
export type NativeCaseInput = {
  type: NativeCaseType; sourceChannel: string;
  contactName: string; contactPhone: string; contactEmail: string; contactAddress: string;
  referenceNumber?: string; internalNote?: string;
  items: { productId: string; quantity: number }[];
  detail: Record<string, string | number | boolean | null>;
}

type WireRow = {
  id: string; number: string; type: string; status: string; brand: string | { code: string; name: string } | null;
  contact: { name: string | null; phone: string | null };
  products: { id: string; name: string; sku: string | null; quantity: number }[];
  serialNumber: string | null; owner: { sourceUserId?: string | null; name: string | null; kind: string | null } | null;
  workflow: { queue: string | null; stageLabel: string | null; ownerRoleLabel?: string | null; nextAction: string | null; blockerText?: string | null; isLocked: boolean; isOverdue: boolean };
  updatedAt: string | null; primaryActionLabel?: string | null;
  tasks?: NativeTask[];
}
const sourceSection = (type: string) => ({ RESHIPMENT: 'reshipments', PRIVATE_PURCHASE: 'private-purchases', REPAIR: 'repairs', EXCHANGE_RETURN: 'exchange-returns', REFUND_PICKUP: 'refund-pickups', CUSTOMER_ISSUE: 'customer-issues' }[type] || 'cases')
function row(value: WireRow): NativeCaseRow {
  return {
    id: value.id, caseNumber: value.number, type: value.type, status: value.status,
    contactName: value.contact?.name || null, contactPhone: value.contact?.phone || null,
    brandCode: typeof value.brand === 'string' ? value.brand : value.brand?.code || null,
    brandName: typeof value.brand === 'string' ? value.brand : value.brand?.name || null,
    productSummary: (value.products || []).map(product => `${product.name} × ${product.quantity}`).join('、') || null,
    serialNumber: value.serialNumber || null, ownerName: value.owner?.name || null,
    updatedAt: value.updatedAt || null, primaryActionLabel: value.primaryActionLabel || null,
    tasks: value.tasks || [],
    workflow: { queue: value.workflow?.queue || null, stageLabel: value.workflow?.stageLabel || null, ownerRoleLabel: value.workflow?.ownerRoleLabel || null, nextAction: value.workflow?.nextAction || null, isLocked: value.workflow?.isLocked === true, isOverdue: value.workflow?.isOverdue === true },
  }
}
const path = '/after-sales/tasks'
export const nativeAfterSales = {
  async list(entityId: string, filters: NativeFilters, signal?: AbortSignal): Promise<NativeCaseList> {
    const value = (await api.get<{ items: WireRow[]; counts: { mine: number; all: number }; total: number; handoffs?: { repairQueueHasMore: boolean } }>(path, { params: { entityId, ...filters }, signal })).data
    return { items: value.items.map(row), summary: value.counts, page: { totalCount: value.total }, repairQueueHasMore: value.handoffs?.repairQueueHasMore === true }
  },
  async options(entityId: string, signal?: AbortSignal): Promise<NativeOptions> {
    const value = (await api.get<Omit<NativeOptions, 'brands' | 'stages'> & { brands: { value: string; label: string }[] }>(path + '/options', { params: { entityId }, signal })).data
    return { ...value, canReadAll: value.canReadAll === true, brands: value.brands.map(brand => ({ code: brand.value, name: brand.label })), stages: [
      { value: 'registration', label: '待登記審核', quick: true }, { value: 'customer', label: '待聯繫顧客', quick: true }, { value: 'payment', label: '等待核款' }, { value: 'repair', label: '檢測與維修中' }, { value: 'logistics', label: '收件與寄送' }, { value: 'issue', label: '產品問題追蹤' }, { value: 'closed', label: '已結束' },
    ] }
  },
  async searchProducts(entityId: string, search: string, signal?: AbortSignal): Promise<NativeProduct[]> {
    return (await api.get<{ products: NativeProduct[] }>(path + '/options', { params: { entityId, search }, signal })).data.products
  },
  async detail(entityId: string, id: string, signal?: AbortSignal): Promise<NativeCaseDetail> {
    const value = (await api.get<WireDetail>(path + '/cases/' + encodeURIComponent(id), { params: { entityId }, signal })).data
    return projectNativeDetail(value)
  },
  async create(entityId: string, data: { requestId: string; brand: string; customerKind: string; payload: NativeCaseInput }): Promise<{ id: string }> {
    const value = (await api.post<{ item: WireRow }>(path + '/cases', { entityId, ...data })).data
    return { id: value.item.id }
  },
}

type WireDetail = {
  item: WireRow;
  customer: { name: string; phone: string; address: string; email: string };
  notes: { internal: string | null; customerVisible: string | null };
  details: Record<string, Record<string, unknown> | null>;
  finance: { payments: Record<string, unknown>[]; refunds: Record<string, unknown>[]; invoices: Record<string, unknown>[] };
  logistics: { incoming: Record<string, unknown>[]; outgoing: Record<string, unknown>[] };
  line: { brand: string | null; identityBound: boolean; notificationEnabled: boolean };
  history: Record<string, unknown>[];
  tasks?: NativeTask[]; custodySummary?: string | null; paymentSummary?: string | null;
}
const fieldLabels: Record<string, string> = {
  faultDescription: '故障現象', diagnosis: '檢測結果', repairActions: '維修處理', repairStatus: '維修進度', customerApprovedRepair: '顧客維修意願', quoteAmount: '報價金額', repairNumber: '維修單號', productModel: '產品型號', serialNumber: 'SN', warrantyStatus: '保固狀態', hasReceivedProduct: '產品收件', missingContents: '補寄內容', reshipmentReason: '補寄原因', lossCategory: '缺件類別', shipmentInstruction: '寄送安排', requiresPayment: '需收款', requiresInvoice: '需開發票', reasonCategory: '換貨原因', reasonNote: '換貨說明', refundReason: '退貨原因', refundOption: '退款方式', refundAmount: '退款金額', returnedItemCondition: '退回品狀況', itemQuantity: '品項數量', issueCategory: '問題分類', issueDescription: '問題細節', analysisSummary: '分析補充', paymentRegion: '付款地區', transferLastFive: '匯款末五碼', finalAmount: '金額', currency: '幣別', invoiceNumber: '發票號碼', receivingAccountLabel: '收款帳戶', createdAt: '建立時間', updatedAt: '更新時間', status: '狀態', amount: '金額', carrier: '物流公司', trackingNumber: '物流單號', registeredAt: '登記時間', action: '操作', detail: '內容', message: '內容', note: '備註', actorName: '操作人員', recipientAddress: '收件地址', pickupAddress: '收回地址', buyerTaxId: '統一編號', brand: '品牌', contactName: '姓名', contactPhone: '電話', contactAddress: '地址', contactEmail: 'Email',
}
function fields(record: Record<string, unknown> | null | undefined): NativeField[] {
  return Object.entries(record || {}).filter(([key, value]) => fieldLabels[key] && (value == null || ['string', 'boolean', 'number'].includes(typeof value))).map(([key, value]) => ({ key, label: fieldLabels[key], value: value as NativeField['value'] }))
}
function records(values: Record<string, unknown>[]): { key: string; fields: NativeField[] }[] {
  return values.map((value, index) => ({ key: typeof value.id === 'string' ? value.id : String(index), fields: fields(value) }))
}
function projectNativeDetail(value: WireDetail): NativeCaseDetail {
  const current = Object.values(value.details || {}).find(detail => detail != null)
  const sections: NativeCaseDetail['sections'] = [
    { key: 'customer', title: '顧客與 LINE', records: [{ key: 'customer', fields: [
      { key: 'name', label: '姓名', value: value.customer.name }, { key: 'phone', label: '電話', value: value.customer.phone }, { key: 'address', label: '地址', value: value.customer.address }, { key: 'email', label: 'Email', value: value.customer.email }, { key: 'brand', label: 'LINE 品牌', value: value.line.brand }, { key: 'lineBound', label: 'LINE 帳號綁定', value: value.line.identityBound },
    ] }] },
    { key: 'logistics', title: '收回與寄送紀錄', records: records([...(value.logistics?.incoming || []), ...(value.logistics?.outgoing || [])]) },
    { key: 'finance', title: '款項與發票紀錄', records: records([...(value.finance?.payments || []), ...(value.finance?.refunds || []), ...(value.finance?.invoices || [])]) },
    { key: 'history', title: '操作歷程', records: records(value.history || []) },
    { key: 'notes', title: '案件備註', records: [{ key: 'notes', fields: [{ key: 'internal', label: '內部備註', value: value.notes?.internal || null }, { key: 'customer', label: '顧客可見備註', value: value.notes?.customerVisible || null }] }] },
  ].filter(section => section.records.length > 0)
  return { ...row(value.item), tasks: value.tasks || value.item.tasks || [], custodySummary: value.custodySummary || null, paymentSummary: value.paymentSummary || ([...(value.finance?.payments || []), ...(value.finance?.refunds || [])].map(entry => typeof entry.status === 'string' ? afterSalesFieldValue('status', entry.status) : '').filter(Boolean).join(' · ') || null), currentStepFields: fields(current), blockers: value.item.workflow?.blockerText ? [value.item.workflow.blockerText] : [], sourceSection: sourceSection(value.item.type), sections }
}
