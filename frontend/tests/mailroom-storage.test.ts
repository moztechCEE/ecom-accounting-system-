import assert from 'node:assert/strict';
import test from 'node:test';
import { storageFloorBounds, storageItemMatches, storageLocationMatches, storageLocationOptions, storageOutcomeUnknown } from '../src/pages/mailroom/storage-model.ts';
import type { StorageItem, StorageSnapshot } from '../src/pages/mailroom/storage-model.ts';
const item: StorageItem = { id: 'one', productName: '行動電源', sku: 'P-01', serialNumber: 'SN100', sourceNumber: 'R-100', receiptId: 'receipt', receiptNumber: 'MR-100', category: 'REPAIR', storageLocationId: 'a1', status: 'RECEIVED', location: 'A1', custodianId: 'clerk', custodianName: '小明', version: 2, canMove: true };
const data: StorageSnapshot = {
  racks: [{ id: 'a', code: 'A', name: '收件架', zone: 'RECEIVING', rows: 1, columns: 2, layoutX: -100, layoutY: 0, version: 1, isActive: true },
    { id: 'b', code: 'B', name: '待寄架', zone: 'OUTBOUND', rows: 1, columns: 2, layoutX: 300, layoutY: 200, version: 1, isActive: false }],
  locations: [{ id: 'a1', rackId: 'a', code: 'A1', name: '第一格', level: 1, slot: 1, version: 1, isActive: true, items: [item] },
    { id: 'a2', rackId: 'a', code: 'A2', name: '停用格', level: 1, slot: 2, version: 1, isActive: false, items: [] },
    { id: 'b1', rackId: 'b', code: 'B1', name: '其他', level: 1, slot: 1, version: 1, isActive: true, items: [] }],
  unassigned: [{ ...item, id: 'legacy', storageLocationId: null, location: '舊櫃檯' }], counts: { stored: 1, unassigned: 1 }, canManage: true,
};
test('finding a case, actual serial or custodian highlights its bin; legacy text is never assigned a bin', () => {
  for (const query of ['sn100', 'R-100', 'p-01', '小明']) assert.equal(storageItemMatches(item, query), true);
  assert.equal(storageLocationMatches(data.locations[0], data.racks[0], '收件架'), true);
  assert.equal(storageLocationMatches(data.locations[0], data.racks[0], 'sn100'), true);
  assert.equal(storageItemMatches(item, 'missing'), false);
  assert.equal(data.unassigned[0].storageLocationId, null);
  assert.deepEqual(storageLocationOptions(data), [{ value: 'a1', label: '收件區 · A1 · 第一格' }]);
});
test('plan coordinates preserve rack placement including negative positions', () => {
  assert.deepEqual(storageFloorBounds(data.racks), { minX: -100, minY: 0, width: 720, height: 420 });
  assert.deepEqual(storageFloorBounds([]), { minX: 0, minY: 0, width: 600, height: 360 });
});
test('only indeterminate failures preserve an immutable mutation for exact retry', () => {
  assert.equal(storageOutcomeUnknown(new Error('network')), true);
  assert.equal(storageOutcomeUnknown({ response: { status: 503 } }), true);
  assert.equal(storageOutcomeUnknown({ response: { status: 409 } }), false);
  assert.equal(storageOutcomeUnknown({ response: { status: 403 } }), false);
});
