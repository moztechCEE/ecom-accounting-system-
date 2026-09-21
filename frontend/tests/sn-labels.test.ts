import assert from 'node:assert/strict'
import test from 'node:test'
import { cartonEstimate, constrainLayout, defaultLayout, draftStorageKey, manufacturingYear, newDraft, parseDrafts, previewCartons, samplePayload, sampleSerial, sequenceScopeKey, yearCode } from '../src/features/sn-labels/model.ts'

const draftForTest = () => ({ ...newDraft('test'), modelCode: 'A16', styleCode: 'L', colorCode: 'K', manufactureDate: '2026-09-21' })

test('year suffix reverses manufacturing year and never uses order year or obsolete manual year', () => {
  assert.equal(yearCode(2024), '42'); assert.equal(yearCode(2026), '62'); assert.equal(yearCode(2030), '03')
  const draft = { ...draftForTest(), orderDate: '2025-12-01', legacyManualYear: 2024 }
  assert.equal(sampleSerial(draft), 'A16LK62000001')
  assert.equal(samplePayload(draft), 'DRAFT:A16LK62000001')
  assert.equal(sampleSerial({ ...draft, manufactureDate: '2024-02-29' }), 'A16LK42000001')
  assert.equal(sampleSerial(draft, 999999), 'A16LK62999999')
  assert.throws(() => sampleSerial(draft, 1000000))
  assert.throws(() => sampleSerial(draft, 1.5))
  assert.throws(() => yearCode(26)); assert.throws(() => yearCode(2026.5))
  assert.throws(() => sampleSerial({ ...draft, modelCode: 'A' }))
  assert.throws(() => sampleSerial({ ...draft, modelCode: 'A12345' }))
  assert.throws(() => sampleSerial({ ...draft, styleCode: '' }))
})
test('missing, malformed and impossible manufacturing dates cannot generate sample SN', () => {
  assert.equal(manufacturingYear('2024-02-29'), 2024)
  assert.equal(manufacturingYear('2026-12-31'), 2026)
  for (const manufactureDate of ['', '2026', '2026-02-29', '2026-04-31', '2026-00-12', '2026-01-00', '2026-9-21', '2100-01-01', '2026-09-21T00:00:00Z']) {
    assert.throws(() => sampleSerial({ ...draftForTest(), manufactureDate }))
  }
})
test('sequence groups stay stable across orders but split by model, style, colour and manufacture year', () => {
  const draft = draftForTest(), key = sequenceScopeKey(draft)
  assert.equal(sequenceScopeKey({ ...draft, id: 'new-order', orderDate: '2026-10-01', manufactureDate: '2026-12-31', quantity: 200 }), key)
  for (const patch of [{ modelCode: 'A17' }, { styleCode: 'T' }, { colorCode: 'W' }, { manufactureDate: '2027-01-01' }]) {
    assert.notEqual(sequenceScopeKey({ ...draft, ...patch }), key)
  }
  // Ambiguous concatenations are separate tuples; production must also check SN uniqueness.
  assert.notEqual(sequenceScopeKey({ ...draft, modelCode: 'A1', styleCode: '6L' }), key)
})
test('cartons are consecutive, tail count is actual and preview pages do not allocate whole batches', () => {
  const draft = { ...draftForTest(), quantity: 43, capacity: 20 }
  const plan = previewCartons(draft, 1, 10, 101)
  assert.equal(plan.total, 3)
  assert.deepEqual(plan.rows.map(r => [r.quantity, r.firstSequence, r.lastSequence]), [[20,101,120],[20,121,140],[3,141,143]])
  assert.equal(plan.rows[2].firstSn, 'A16LK62000141'); assert.equal(plan.rows[2].lastSn, 'A16LK62000143')
  const page2 = previewCartons({ ...draft, quantity: 999999, capacity: 1 }, 2, 10)
  assert.equal(page2.rows.length, 10); assert.equal(page2.rows[0].firstSequence, 11)
  assert.equal(page2.total, 999999)
  assert.throws(() => previewCartons(draft, 1, 10, 999980))
  assert.throws(() => previewCartons(draft, 0))
  assert.throws(() => previewCartons(draft, 1, 1000))
  assert.throws(() => previewCartons({ ...draft, capacity: null }))
})
test('carton estimates distinguish exact capacity, partial and unknown without reserving numbers', () => {
  assert.deepEqual(cartonEstimate(100, 20), { boxes: 5, full: 5, remainder: 0 })
  assert.deepEqual(cartonEstimate(101, 20), { boxes: 6, full: 5, remainder: 1 })
  assert.deepEqual(cartonEstimate(3, 20), { boxes: 1, full: 0, remainder: 3 })
  for (const capacity of [null, 0, -1, 1.5, NaN, Infinity]) assert.equal(cartonEstimate(100, capacity), null)
})
test('local drafts are scoped, bounded and reject corrupted records without silently resetting', () => {
  assert.notEqual(draftStorageKey('company-a', 'u'), draftStorageKey('company-b', 'u'))
  assert.notEqual(draftStorageKey('company-a', 'u'), draftStorageKey('company-a', 'v'))
  assert.notEqual(draftStorageKey('a:b', 'c'), draftStorageKey('a', 'b:c'))
  assert.throws(() => draftStorageKey('', 'u'))
  const d = newDraft('test')
  assert.deepEqual(parseDrafts(JSON.stringify([d])), [d])
  assert.deepEqual(parseDrafts(null), [])
  for (const raw of ['{', '{}', '[null]', JSON.stringify([{ ...d, quantity: -1 }]), JSON.stringify([{ ...d, label: {} }]), JSON.stringify(Array(101).fill(d))]) assert.throws(() => parseDrafts(raw))
})
test('v1 drafts migrate without inferring manufacturing date or preserving manual year as authority', () => {
  const old = { ...draftForTest(), version: 1, year: 2024 }
  const [migrated] = parseDrafts(JSON.stringify([old]))
  assert.equal(migrated.version, 2); assert.equal(migrated.legacyManualYear, 2024)
  assert.equal('year' in migrated, false)
  assert.equal(sampleSerial(migrated), 'A16LK62000001')
  const [missingDate] = parseDrafts(JSON.stringify([{ ...old, manufactureDate: '' }]))
  assert.equal(missingDate.manufactureDate, '')
  assert.throws(() => sampleSerial(missingDate))
  assert.deepEqual(parseDrafts(JSON.stringify([migrated])), [migrated])
})
test('label geometry bounds drag/resize and enforces QR on retail packaging', () => {
  const l = constrainLayout({ ...defaultLayout(), textX: -10, textY: 100, qrX: 99, qrY: -5, qrSize: 99, showQr: false })
  assert.equal(l.showQr, true); assert.equal(l.textX, 0); assert(l.textY >= 0)
  assert(l.qrX + l.qrSize <= l.width); assert(l.qrY + l.qrSize <= l.height - 1)
  assert.equal(constrainLayout({ ...defaultLayout(), target: 'device', showQr: false }).showQr, false)
})
