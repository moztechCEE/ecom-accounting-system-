import assert from 'node:assert/strict'
import test from 'node:test'
import { cartonEstimate, constrainLayout, defaultLayout, draftStorageKey, newDraft, parseDrafts, samplePayload, sampleSerial, yearCode } from '../src/features/sn-labels/model.ts'

test('confirmed year encoding is chronological, never reversed; dates do not choose the year', () => {
  assert.equal(yearCode(2024), '24'); assert.equal(yearCode(2026), '26')
  const draft = { ...newDraft('test'), modelCode: 'A16', styleCode: 'L', colorCode: 'K', year: 2026, manufactureDate: '2024-01-01' }
  assert.equal(sampleSerial(draft), 'A16LK26000001')
  assert.equal(samplePayload(draft), 'DRAFT:A16LK26000001')
  assert.equal(sampleSerial(draft, 999999), 'A16LK26999999')
  assert.throws(() => sampleSerial(draft, 1000000))
  assert.throws(() => sampleSerial(draft, 1.5))
  assert.throws(() => yearCode(26)); assert.throws(() => yearCode(2026.5))
  assert.throws(() => sampleSerial({ ...draft, modelCode: 'A' }))
  assert.throws(() => sampleSerial({ ...draft, modelCode: 'A12345' }))
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
test('label geometry bounds drag/resize and enforces QR on retail packaging', () => {
  const l = constrainLayout({ ...defaultLayout(), textX: -10, textY: 100, qrX: 99, qrY: -5, qrSize: 99, showQr: false })
  assert.equal(l.showQr, true); assert.equal(l.textX, 0); assert(l.textY >= 0)
  assert(l.qrX + l.qrSize <= l.width); assert(l.qrY + l.qrSize <= l.height - 1)
  assert.equal(constrainLayout({ ...defaultLayout(), target: 'device', showQr: false }).showQr, false)
})
