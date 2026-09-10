export const afterSalesTypes: Record<string, string> = {
  RESHIPMENT: '漏寄補寄',
  PRIVATE_PURCHASE: '私下購買',
  REPAIR: '維修',
  EXCHANGE_RETURN: '來回件',
  REFUND_PICKUP: '退款派車',
  CUSTOMER_ISSUE: '客戶問題',
}
export const afterSalesStatuses: Record<string, string> = {
  DRAFT: '草稿',
  NEW: '新建',
  PENDING_PAYMENT: '待付款',
  PAYMENT_CONFIRMED: '已確認付款',
  PENDING_SHIPMENT: '待出貨',
  SHIPPED: '已出貨',
  DELIVERED: '已送達',
  PENDING_REVERSE_SHIPMENT: '待逆物流',
  REVERSE_IN_TRANSIT: '逆物流途中',
  RECEIVED: '已收件',
  INSPECTING: '檢測中',
  PENDING_QUOTE_CONFIRMATION: '待確認報價',
  QUOTE_APPROVED: '已同意報價',
  PENDING_REFUND_CONFIRMATION: '待確認退款',
  REFUND_CONFIRMED: '已確認退款',
  COMPLETED: '已完成',
  CLOSED: '已結案',
  CANCELLED: '已取消',
}
const valueLabels: Record<string, Record<string, string>> = {
  // Preserve source labels: these legacy enum names are not ERP stock movement instructions.
  inventoryDisposition: {
    WAREHOUSE: '入工業',
    NO_STOCK_IN: '入民族',
    SCRAPPED: '不入庫',
  },
  status: {
    ...afterSalesStatuses,
    PENDING: '待處理',
    PREPARING: '準備中',
    RETURNED: '已退回',
    PICKUP_SCHEDULED: '已安排回收',
    IN_TRANSIT: '運送中',
    CONFIRMED: '已確認',
    REJECTED: '已退回',
    REFUNDED: '已退款',
    READY: '已準備',
    SENT: '已發送',
    OPENED: '已開啟',
    SUBMITTED: '已提交',
    INVALIDATED: '已失效',
    EXPIRED: '已過期',
    NEEDS_MORE_INFO: '待補資料',
    PROCESSING: '處理中',
    NOT_REQUIRED: '無需發票',
    ISSUED: '已開立',
    VOIDED: '已作廢',
  },
  refundOption: {
    ONLINE_REFUND: '線上退款',
    NO_REFUND: '不退款',
    MANUAL_HANDOFF: '人工交接',
  },
  refundInvoiceAction: { VOIDED: '作廢', KEEP: '保留', ALLOWANCE: '折讓' },
  trackingSource: { MANUAL: '手動', IMPORT: '匯入' },
  visibility: { INTERNAL: '內部', CUSTOMER_VISIBLE: '客戶可見' },
  receivingAccountType: { TAIWAN: '台灣', OVERSEAS: '海外' },
  accountType: { TAIWAN: '台灣', OVERSEAS: '海外' },
  remittanceMethod: {
    BANK_TRANSFER: '銀行轉帳',
    ATM_TRANSFER: 'ATM 轉帳',
    ONLINE_BANKING: '網路銀行',
    CASH_DEPOSIT_NO_PASSBOOK: '無摺存款',
    OTHER: '其他',
  },
  action: {
    CREATE: '建立',
    UPDATE: '修改',
    STATUS_CHANGE: '變更狀態',
    CONFIRM_PAYMENT: '確認付款',
    CREATE_SHIPMENT: '建立出貨',
    CREATE_REVERSE_SHIPMENT: '建立回收',
    CONFIRM_REFUND: '確認退款',
    ISSUE_INVOICE: '開立發票',
    VOID_INVOICE: '作廢發票',
    ASSIGN: '指派',
    LOGIN: '登入',
    LOGOUT: '登出',
  },
}

export function afterSalesFieldValue(
  key: string,
  value: string | number | boolean | null,
): string {
  if (value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return valueLabels[key]?.[String(value)] ?? String(value)
}
