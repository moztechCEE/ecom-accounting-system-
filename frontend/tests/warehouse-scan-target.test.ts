import assert from 'node:assert/strict'
import test from 'node:test'
import { scanTarget } from '../src/services/warehouse-scan-target.ts'
import type { WorkItem } from '../src/services/warehouse.types.ts'

const row = (id: string, barcode: string, picked = 0, packed = 0): WorkItem => ({
  id, name: `商品 ${id}`, sku: `SKU-${id}`, barcode, quantity: 1, picked, packed, serials: [],
})

test('the same barcode on two open source lines requires an explicit line and sends its id', () => {
  const items = [row('line-a', '1234'), row('line-b', '1234')]
  assert.deepEqual(scanTarget(items, 'pick', '1234', ''), {
    matches: items, ambiguous: true, needsSelection: true, itemId: undefined,
  })
  assert.equal(scanTarget(items, 'pick', '1234', 'line-b').itemId, 'line-b')
  assert.equal(scanTarget(items, 'pick', '1234', 'different').needsSelection, true)
  assert.equal(scanTarget(items, 'pick', 'unmatched', 'line-b').itemId, undefined)
})

test('a duplicate source barcode still requires explicit identity after one line is complete', () => {
  const two = [row('line-a', '1234', 1), row('line-b', '1234')]
  assert.deepEqual(scanTarget(two, 'pick', '1234', 'line-a'), {
    matches: [two[1]], ambiguous: true, needsSelection: true, itemId: undefined,
  })
  assert.equal(scanTarget(two, 'pick', '1234', 'line-b').itemId, 'line-b')
  const packing = [row('line-a', '1234', 1), row('line-b', '1234', 1, 1)]
  assert.deepEqual(scanTarget(packing, 'pack', '1234', ''), {
    matches: [packing[0]], ambiguous: true, needsSelection: true, itemId: undefined,
  })
})

test('a single source line keeps the existing scan request without itemId', () => {
  const item = row('single-line', '5678')
  assert.deepEqual(scanTarget([item], 'pick', '5678', ''), {
    matches: [item], ambiguous: false, needsSelection: false, itemId: undefined,
  })
})

test('serial scans target only a pending or picked serial in the current stage', () => {
  const tracked: WorkItem = { ...row('tracked', '1234'), serials: [{ value: 'SN-1', status: 'pending' }] }
  assert.deepEqual(scanTarget([tracked], 'pick', '1234', '').matches, [])
  assert.deepEqual(scanTarget([tracked], 'pick', 'SN-1', '').matches, [tracked])
  assert.deepEqual(scanTarget([tracked], 'pack', 'SN-1', '').matches, [])
})
