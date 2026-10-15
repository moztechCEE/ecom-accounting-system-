import assert from 'node:assert/strict';
import test from 'node:test';
import { storageEffectivePurpose, storageFloorBounds, storageItemMatches, storageLevelLocations, storageLocationMatches, storageLocationOptions, storageNextSlot, storageOutcomeUnknown } from '../src/pages/mailroom/storage-model.ts';
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
test('location purpose overrides its rack while null and legacy values keep inheriting', () => {
  const rack = data.racks[0], location = data.locations[0];
  for (const purpose of [undefined, null] as const) {
    assert.equal(storageEffectivePurpose({ purpose }, rack), 'RECEIVING');
    assert.equal(storageEffectivePurpose({ purpose }, { ...rack, zone: 'OUTBOUND' }), 'OUTBOUND');
  }
  assert.equal(storageEffectivePurpose({ purpose: 'RECEIVING' }, { ...rack, zone: 'OUTBOUND' }), 'RECEIVING');
  assert.equal(storageEffectivePurpose({ purpose: 'OUTBOUND' }, rack), 'OUTBOUND');
  assert.deepEqual(storageLocationOptions({ ...data, locations: [{ ...location, purpose: 'OUTBOUND' }] }), [{ value: 'a1', label: '待寄區 · A1 · 第一格' }]);
});
test('each continuous shelf uses only its real locations in slot order and reserves inactive coordinates', () => {
  const rack = { ...data.racks[0], rows: 4, columns: 8 };
  const locations = [
    { ...data.locations[0], id: 'last', slot: 8 },
    { ...data.locations[0], id: 'middle', slot: 5 },
    { ...data.locations[0], id: 'first', slot: 2 },
    { ...data.locations[1], id: 'inactive', slot: 1 },
    { ...data.locations[0], id: 'another-level', level: 3, slot: 1 },
  ];
  assert.deepEqual(storageLevelLocations(locations.filter(location => location.isActive), rack.id, 1).map(location => location.slot), [2, 5, 8]);
  assert.deepEqual(storageLevelLocations(locations, rack.id, 2), []);
  assert.equal(storageNextSlot(locations, rack, 1), 3);
  assert.equal(storageNextSlot(locations, rack, 2), 1);
  assert.equal(storageNextSlot(locations, { ...rack, columns: 2 }, 1), undefined);
  assert.deepEqual(locations.map(location => location.id), ['last', 'middle', 'first', 'inactive', 'another-level']);
});
