import assert from 'node:assert/strict'
import test from 'node:test'
import type { User } from '../src/types/index.ts'
import {
  afterSalesCaseEntries,
  afterSalesSectionDetails,
  afterSalesSupportEntries,
  canOpenAfterSalesSection,
} from '../src/pages/after-sales/workbench-model.ts'
import { AFTER_SALES_SOURCE_PATHS } from '../src/pages/repair/after-sales-launch.ts'

const csr: User = {
  id: 'synthetic-csr', name: 'Synthetic CSR', email: 'synthetic@example.invalid',
  roles: ['CUSTOMER_SERVICE'], permissions: ['after_sales_cases:read'], salesDataScope: 'ENTITY',
}

test('six service entries preserve every original case type and its supported source route', () => {
  const entries = afterSalesCaseEntries(csr)
  assert.equal(entries.length, 6)
  assert.deepEqual(new Set(entries.map(entry => entry.caseType)), new Set([
    'RESHIPMENT', 'PRIVATE_PURCHASE', 'REPAIR', 'EXCHANGE_RETURN', 'REFUND_PICKUP', 'CUSTOMER_ISSUE',
  ]))
  for (const entry of entries) {
    assert.equal(AFTER_SALES_SOURCE_PATHS[entry.section], `/cases/${entry.section}`)
    assert(canOpenAfterSalesSection(csr, entry.section))
  }
  assert.equal(afterSalesSectionDetails('private-purchases')?.title, '商品與配件訂購')
  assert.equal(afterSalesSectionDetails('exchange-returns')?.title, '換貨服務')
})

test('cases access cannot expand SELF, DEPARTMENT or missing scope into company-wide source data', () => {
  for (const salesDataScope of ['SELF', 'DEPARTMENT', undefined] as const) {
    const restricted = { ...csr, salesDataScope }
    assert.deepEqual(afterSalesCaseEntries(restricted), [])
    assert.deepEqual(afterSalesSupportEntries(restricted), [])
    assert.equal(canOpenAfterSalesSection(restricted, 'cases'), false)
    assert.equal(canOpenAfterSalesSection({ ...restricted, roles: ['ADMIN'] }, 'cases'), false)
  }
  assert.equal(canOpenAfterSalesSection({ ...csr, roles: ['SUPER_ADMIN'], permissions: [], salesDataScope: 'SELF' }, 'cases'), true)
})

test('functional grants work for sales and multiple duties without granting the other workbenches access', () => {
  const sales = { ...csr, roles: ['SALES'] }
  assert.equal(afterSalesCaseEntries(sales).length, 6)
  const technician = { ...csr, roles: ['REPAIR_TECHNICIAN'], permissions: ['repair_workbench:read', 'mailroom:read'] }
  assert.deepEqual(afterSalesCaseEntries(technician), [])
  assert.equal(canOpenAfterSalesSection(technician, 'workbench'), false)
  assert.equal(afterSalesCaseEntries({ ...technician, permissions: [...technician.permissions, 'after_sales_cases:read'] }).length, 6)
  assert.equal(canOpenAfterSalesSection({ ...csr, permissions: ['after_sales_cases:update'] }, 'cases'), false)
  assert.equal(canOpenAfterSalesSection(null, 'workbench'), false)
})

test('invoice and payment shortcuts require their own read permissions rather than a cases grant', () => {
  assert.deepEqual(afterSalesSupportEntries(csr).map(entry => entry.section), ['quotes', 'customers'])
  const invoices = { ...csr, permissions: [...csr.permissions, 'after_sales_invoices:read'] }
  assert.equal(canOpenAfterSalesSection(invoices, 'invoices'), true)
  assert.equal(canOpenAfterSalesSection(invoices, 'accounting'), false)
  const accounting = { ...csr, permissions: [...csr.permissions, 'after_sales_accounting:read'] }
  assert.equal(canOpenAfterSalesSection(accounting, 'invoices'), false)
  assert.equal(canOpenAfterSalesSection(accounting, 'accounting'), true)
  const both = { ...csr, permissions: [...invoices.permissions, 'after_sales_accounting:read'] }
  assert.deepEqual(afterSalesSupportEntries(both).map(entry => entry.title), ['報價與顧客確認', '顧客資料', '發票作業', '收款與退款核對'])
})

test('home stays focused while support pages retain their existing permission and section', () => {
  const administrator = { ...csr, roles: ['ADMIN'], permissions: [] }
  const home = [...afterSalesCaseEntries(administrator), ...afterSalesSupportEntries(administrator)]
  assert(!home.some(entry => ['products', 'imports', 'audit-logs', 'faqs', 'shipping'].includes(entry.section)))
  for (const section of ['products', 'imports', 'audit-logs', 'shipping']) {
    assert.equal(canOpenAfterSalesSection(csr, section), false)
    assert.equal(canOpenAfterSalesSection(administrator, section), true)
    assert(section in AFTER_SALES_SOURCE_PATHS)
  }
  for (const section of ['faqs', '__proto__', 'constructor', 'cases/new', '/cases', 'unknown', 'workbench?entityId=other']) {
    assert.equal(afterSalesSectionDetails(section), undefined)
    assert.equal(canOpenAfterSalesSection(administrator, section), false)
  }
})
