import assert from 'node:assert/strict'
import test from 'node:test'
import { buildManualPurchaseOrder } from '../src/pages/manual-purchase-order.ts'

const vendors = [{ id: 'v1', isActive: true }, { id: 'v2', isActive: false }]
const products = [{ id: 'p1', isActive: true }, { id: 'p2', isActive: false }]
const input = () => ({ vendorId: 'v1', orderDate: '2026-09-23', currency: 'twd', fxRate: 1, items: [{ productId: 'p1', qty: 2, unitCost: 10.25 }], notes: '  restock  ' })

test('manual PO body matches the backend contract without client company or price aliases', () => {
  assert.deepEqual(buildManualPurchaseOrder(input(), vendors, products), {
    vendorId: 'v1', orderDate: '2026-09-23', currency: 'TWD', fxRate: 1,
    items: [{ productId: 'p1', qty: 2, unitCost: 10.25 }], notes: 'restock',
  })
})

test('manual PO rejects inactive/foreign options and invalid money, quantity, or duplicate lines', () => {
  const invalid = [
    { vendorId: 'v2' }, { vendorId: 'foreign' }, { orderDate: '2026-02-30' },
    { fxRate: 0 }, { fxRate: 1.0000001 }, { items: [] },
    { items: [{ productId: 'p2', qty: 1, unitCost: 1 }] },
    { items: [{ productId: 'p1', qty: 1.5, unitCost: 1 }] },
    { items: [{ productId: 'p1', qty: 1, unitCost: 1.001 }] },
    { items: [{ productId: 'p1', qty: 1, unitCost: 1 }, { productId: 'p1', qty: 1, unitCost: 1 }] },
  ]
  for (const change of invalid) assert.throws(() => buildManualPurchaseOrder({ ...input(), ...change }, vendors, products))
})
