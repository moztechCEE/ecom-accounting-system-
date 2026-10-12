import assert from 'node:assert/strict'
import test from 'node:test'
import { changeNativeFilter, nativeCreateInput, nativeFilters, NATIVE_CASE_TYPES } from '../src/pages/after-sales/native-workbench-model.ts'
import { createAfterSalesLaunchSession } from '../src/pages/repair/after-sales-launch.ts'

test('type and lifecycle filters preserve personal scope and company identity', () => {
  const params = new URLSearchParams('entityId=company-a&scope=mine&page=4')
  const repairs = changeNativeFilter(params, 'type', 'REPAIR')
  assert.equal(repairs.get('entityId'), 'company-a')
  assert.equal(repairs.get('scope'), 'mine')
  assert.equal(repairs.has('page'), false)
  const closed = nativeFilters(changeNativeFilter(repairs, 'view', 'closed'))
  assert.equal(closed.scope, 'mine')
  assert.equal(closed.lifecycle, 'closed')
  assert.equal(closed.type, 'REPAIR')
  assert.equal(nativeFilters(new URLSearchParams('page=-1&type=UNKNOWN')).page, 1)
})

test('the six creation types preserve product identity and deferred repair authorization', () => {
  const values = { brand: 'BONSON', customerKind: 'TO_B', sourceChannel: 'LINE', contactName: ' Dealer ', contactPhone: ' 0912345678 ', contactEmail: ' dealer@example.invalid ', contactAddress: ' Return address ', reason: 'Evidence and request', items: [{ productId: 'ERP-product-a', quantity: 2 }], serialNumber: 'SN-1', reshipmentReason: 'WAREHOUSE', lossCategory: 'ACCESSORY', reasonCategory: 'DEFECTIVE', refundReason: 'DEFECTIVE' }
  for (const entry of NATIVE_CASE_TYPES) {
    const payload = nativeCreateInput(entry.value, values)
    assert.deepEqual(payload.items, [{ productId: 'ERP-product-a', quantity: 2 }])
    assert.equal(payload.contactName, 'Dealer')
    assert.equal('receivedAt' in payload, false)
    assert.equal('shipmentDraft' in payload, false)
    assert.equal('reverseShipmentDraft' in payload, false)
    assert.equal('customerApprovedRepair' in payload.detail, false)
  }
  const repair = nativeCreateInput('REPAIR', values)
  assert.equal(repair.detail.requiresPayment, false)
  assert.equal(repair.detail.faultDescription, values.reason)
  assert.equal(repair.detail.serialNumber, 'SN-1')
  assert.equal(nativeCreateInput('CUSTOMER_ISSUE', values).detail.brand, 'BONSON')
  assert.equal(nativeCreateInput('REFUND_PICKUP', values).detail.itemQuantity, 2)
})

test('case-context frame readiness requires the exact authorized case and intent', () => {
  const origin = 'https://erp.example.invalid'
  for (const section of ['cases', 'repairs', 'reshipments', 'private-purchases', 'exchange-returns', 'refund-pickups', 'customer-issues']) {
    const session = createAfterSalesLaunchSession()
    const attempt = session.begin(section, 'company-a', 'case-a')
    const frame = {}
    session.attach(attempt, frame)
    assert.equal(session.ready(attempt, frame, '/cases', origin + '/after-sales-app/cases?type=REPAIR&queue=technician', origin), 'mismatch')
    assert.equal(session.ready(attempt, frame, '/cases/case-b', origin + '/after-sales-app/cases/case-b', origin), 'mismatch')
    assert.equal(session.ready(attempt, frame, '/cases/case-a/edit', origin + '/after-sales-app/cases/case-a/edit', origin), 'mismatch')
    assert.equal(session.ready(attempt, frame, '/cases/case-a', origin + '/after-sales-app/cases/case-a', origin), 'ready')
  }
  const session = createAfterSalesLaunchSession(), frame = {}, edit = session.begin('cases', 'company-a', 'case-a', 'edit')
  session.attach(edit, frame)
  assert.equal(session.ready(edit, frame, '/cases/case-a/edit', origin + '/after-sales-app/cases/case-a/edit', origin), 'ready')
  assert.throws(() => session.begin('invoices', 'company-a', 'case-a'), /不符/)
  for (const id of ['../other', 'case?a=1', 'case#x', 'case/a']) assert.throws(() => session.begin('cases', 'company-a', id), /不符/)
})
