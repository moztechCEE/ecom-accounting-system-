import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReturnStockReceipt, canReceiveReturnStock, validateReturnStockReceipt } from '../src/services/repair-stock-return'
import type { ReturnStockSource, StockReturnFormValues } from '../src/services/repair-stock-return'

const source: ReturnStockSource = {
  id: '10000000-0000-4000-8000-000000000001', label: 'synthetic-return', sku: 'DEV-QA',
  version: 9, location: '收發櫃', status: 'PENDING_RESTOCK', custodianId: 'clerk',
  inspectionRevision: 4, reportRevision: 7, reportInspectionRevision: 4,
  qcResult: 'PASS', refurbishmentEligible: true, receipt: { sourceNumber: 'synthetic-only' },
}
const product = { id: '10000000-0000-4000-8000-000000000002', sku: 'DEV-QA', name: 'synthetic', hasSerialNumbers: false }
const values: StockReturnFormValues = {
  sourceItemId: source.id, productId: product.id, warehouseId: '10000000-0000-4000-8000-000000000003',
  unitLabel: ' DEV-UNIT ', sourceLocation: '收發櫃', location: ' 整新倉A ',
  ownershipReference: ' 公司退貨接收證據 ', inspectionReference: ' 本版PASS檢驗證據 ', confirmedItems: true,
}
const requestId = '10000000-0000-4000-8000-000000000004'
const create = (patch: Partial<StockReturnFormValues> = {}, item: ReturnStockSource = source) =>
  buildReturnStockReceipt('synthetic-entity', { ...values, ...patch }, item, product, requestId)
const owner = { roles: ['WAREHOUSE_OWNER'], permissions: ['after_sales_stock:update'], inventoryDataScope: 'ENTITY' as const }

test('only stock update owners with company scope or SUPER_ADMIN can formally receive returns', () => {
  assert.equal(canReceiveReturnStock(owner), true)
  assert.equal(canReceiveReturnStock({ ...owner, roles: ['REPAIR_TECHNICIAN'], permissions: ['repair_workbench:update'] }), false)
  assert.equal(canReceiveReturnStock({ ...owner, roles: ['MAILROOM_OPERATOR'], permissions: ['mailroom:update'] }), false)
  assert.equal(canReceiveReturnStock({ ...owner, inventoryDataScope: 'SELF' }), false)
  assert.equal(canReceiveReturnStock({ ...owner, inventoryDataScope: 'DEPARTMENT' }), false)
  assert.equal(canReceiveReturnStock({ ...owner, permissions: ['after_sales_stock:read'] }), false)
  assert.equal(canReceiveReturnStock({ roles: ['SUPER_ADMIN'], permissions: [] }), true)
})

test('first request freezes one current physical unit and keeps independent inspection/report versions', () => {
  const input = create()
  assert.equal(input.quantity, 1)
  assert.equal(input.expectedVersion, 9)
  assert.equal(input.unitLabel, 'DEV-UNIT')
  assert.equal(input.location, '整新倉A')
  assert.equal(input.serialNumber, undefined)
  assert.equal(Object.isFrozen(input), true)
  assert.equal('kind' in input, false)
  assert.equal('sourceReference' in input, false)
})

test('retry retains the first request id, full payload and expected source version', () => {
  const input = create()
  const wire = JSON.stringify(input)
  const laterCatalog = { ...source, version: 10, location: '已入庫', refurbishmentEligible: false }
  assert.throws(() => create({}, laterCatalog))
  // The UI retains this first immutable input instead of rebuilding from later catalog data.
  assert.equal(JSON.stringify(input), wire)
  assert.equal(input.requestId, requestId)
  assert.equal(input.expectedVersion, 9)
})

test('appearance grade cannot replace submitted current QC and bound report', () => {
  for (const patch of [
    { refurbishmentEligible: false, grade: 'A' }, { qcResult: 'FAIL' },
    { reportInspectionRevision: 3 }, { inspectionRevision: 0 }, { reportRevision: 0 },
    { inspectionRevision: -1 }, { reportRevision: 1.5 },
    { status: 'STOCKED' }, { status: 'REPAIRING' }, { version: 0 },
  ]) assert.throws(() => create({}, { ...source, ...patch }))
})

test('receive requires personal confirmation, current source location and matching SKU', () => {
  assert.throws(() => create({ confirmedItems: false }))
  assert.throws(() => create({ sourceLocation: '另一位置' }))
  assert.throws(() => create({}, { ...source, sku: 'OTHER' }))
  for (const field of ['unitLabel', 'location', 'ownershipReference', 'inspectionReference', 'warehouseId'] as const)
    assert.throws(() => create({ [field]: ' ' }))
  assert.throws(() => create({ unitLabel: 'x'.repeat(101) }))
})

test('SN is only the real source SN; non-SN items never synthesize an SN', () => {
  assert.throws(() => create({ serialNumber: 'FAKE' }))
  const snProduct = { ...product, hasSerialNumbers: true }
  assert.throws(() => buildReturnStockReceipt('entity', values, source, snProduct, requestId))
  const snSource = { ...source, serialNumber: 'SOLD-REAL-SN' }
  const input = buildReturnStockReceipt('entity', { ...values, serialNumber: 'SOLD-REAL-SN' }, snSource, snProduct, requestId)
  assert.equal(input.serialNumber, 'SOLD-REAL-SN')
  assert.throws(() => buildReturnStockReceipt('entity', { ...values, serialNumber: 'DIFFERENT' }, snSource, snProduct, requestId))
})

const validReceipt = () => {
  const input = create()
  return { input, result: {
    unit: { id: 'unit', kind: 'REFURBISHED', unitLabel: input.unitLabel },
    inbound: {
      inTransactionId: 'IN-synthetic', unitId: 'unit', sourceItemId: input.sourceItemId,
      requestId, warehouseId: input.warehouseId, quantity: 1 as const,
      fromCustodianId: 'clerk', toCustodianId: 'owner', fromLocation: input.sourceLocation, toLocation: input.location,
      sourceItemVersion: 9, inventoryItemVersion: 10, inspectionRevision: 4, reportRevision: 7,
      externalInventoryPosted: false as const,
    },
  } }
}

test('success proof binds the IN transaction, personal custody, exact retry and version transition', () => {
  const { result, input } = validReceipt()
  assert.doesNotThrow(() => validateReturnStockReceipt(result, input, 'owner'))
})

test('wrong IN receipt must stay pending instead of clearing draft or claiming success', () => {
  const { result, input } = validReceipt()
  for (const patch of [
    { inTransactionId: '' }, { sourceItemId: 'other' }, { unitId: 'other' },
    { requestId: 'other' }, { warehouseId: 'other' }, { toCustodianId: 'other' },
    { fromLocation: 'other' }, { toLocation: 'other' },
    { sourceItemVersion: 10 }, { inventoryItemVersion: 9 }, { reportRevision: 0 },
  ]) assert.throws(() => validateReturnStockReceipt({ ...result, inbound: { ...result.inbound, ...patch } }, input, 'owner'))
  assert.throws(() => validateReturnStockReceipt(result, input, undefined))
  assert.throws(() => validateReturnStockReceipt({ ...result, unit: { ...result.unit, kind: 'NEW' } }, input, 'owner'))
})
