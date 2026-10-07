import type { User } from '../../types'
import { hasPermission } from '../../utils/access'

export const AFTER_SALES_CASE_ENTRIES = [
  { section: 'reshipments', title: '補寄服務', caseType: 'RESHIPMENT' },
  { section: 'private-purchases', title: '商品與配件訂購', caseType: 'PRIVATE_PURCHASE' },
  { section: 'repairs', title: '檢測與維修', caseType: 'REPAIR' },
  { section: 'exchange-returns', title: '換貨服務', caseType: 'EXCHANGE_RETURN' },
  { section: 'refund-pickups', title: '退貨退款', caseType: 'REFUND_PICKUP' },
  { section: 'customer-issues', title: '產品問題回報', caseType: 'CUSTOMER_ISSUE' },
] as const

const CASE_PERMISSION = 'after_sales_cases:read'
const SECTION_DETAILS = {
  workbench: { title: '售後工作台', permission: CASE_PERMISSION },
  cases: { title: '案件總覽', permission: CASE_PERMISSION },
  quotes: { title: '報價與顧客確認', permission: CASE_PERMISSION },
  customers: { title: '顧客資料', permission: CASE_PERMISSION },
  invoices: { title: '發票作業', permission: 'after_sales_invoices:read' },
  accounting: { title: '收款與退款核對', permission: 'after_sales_accounting:read' },
  shipping: { title: '寄回與補寄物流', permission: 'after_sales_shipping:read' },
  products: { title: '產品與服務價目', permission: 'after_sales_products:read' },
  imports: { title: '資料匯入', permission: 'after_sales_imports:read' },
  users: { title: '來源帳號與權限', permission: 'after_sales_users:read' },
  'audit-logs': { title: '操作紀錄', permission: 'after_sales_audit:read' },
  settings: { title: '來源設定', permission: 'after_sales_settings:read' },
} as const

export function afterSalesSectionDetails(section: string): { title: string; permission: string } | undefined {
  const caseEntry = AFTER_SALES_CASE_ENTRIES.find(entry => entry.section === section)
  if (caseEntry) return { title: caseEntry.title, permission: CASE_PERMISSION }
  if (!Object.prototype.hasOwnProperty.call(SECTION_DETAILS, section)) return undefined
  return SECTION_DETAILS[section as keyof typeof SECTION_DETAILS]
}

// The source exposes company-wide records. Module permission alone must not widen a staff member's data scope.
export function canOpenAfterSalesSection(user: User | null, section: string): boolean {
  const details = afterSalesSectionDetails(section)
  const companyScope = user?.salesDataScope === 'ENTITY' || user?.roles?.includes('SUPER_ADMIN')
  return Boolean(details && companyScope && hasPermission(user, details.permission))
}

export function afterSalesCaseEntries(user: User | null) {
  return AFTER_SALES_CASE_ENTRIES.filter(entry => canOpenAfterSalesSection(user, entry.section))
}

export function afterSalesSupportEntries(user: User | null) {
  return ['quotes', 'customers', 'invoices', 'accounting']
    .filter(section => canOpenAfterSalesSection(user, section))
    .map(section => ({ section, title: afterSalesSectionDetails(section)!.title }))
}
