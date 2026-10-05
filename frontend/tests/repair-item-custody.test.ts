import assert from 'node:assert/strict';
import test from 'node:test';
import { currentItemCustody, currentPhysicalCustody } from '../src/pages/mailroom/item-custody.ts';
import type { Item, LinkedReplacementCustody } from '../src/pages/mailroom/model.ts';

const inbound = { status: 'STOCKED', custodianName: '合成入庫人員', location: '原入庫位置', physicalCustody: 'INVENTORY' } satisfies Pick<Item, 'status' | 'custodianName' | 'location' | 'physicalCustody'>;
const replacement: LinkedReplacementCustody = {
  unitId: 'synthetic-unit', reservationId: 'synthetic-reservation', outTransactionId: 'synthetic-out',
  itemId: 'synthetic-replacement-item', sourceCaseId: 'synthetic-case', sourceNumber: 'SYNTHETIC-REPLACEMENT',
  status: 'REPAIRING', statusLabel: '替換處理中', custodianId: 'synthetic-tech', custodianName: '合成維修師',
  location: '維修位置', physicalCustody: 'TECHNICIAN', targetVersion: 8,
};

test('formal replacement outbound follows current linked holder while preserving original inbound history', () => {
  const donor = Object.freeze({ ...inbound, physicalCustody: 'LINKED_CASE' as const, linkedReplacementCustody: replacement });
  const current = currentItemCustody(donor);
  assert.equal(current.holder, '合成維修師');
  assert.equal(current.location, '維修位置');
  assert.equal(current.notice, '已作換機出庫；實物保管依換機案');
  assert.equal(current.reference, 'SYNTHETIC-REPLACEMENT · OUT synthetic-out');
  assert.equal(current.status, '替換處理中');
  assert.equal(donor.custodianName, '合成入庫人員');
  assert.equal(donor.location, '原入庫位置');
  const afterClerkReceipt = currentItemCustody({ ...donor, linkedReplacementCustody: { ...replacement, physicalCustody: 'MAILROOM', custodianName: '合成收發同仁', location: '待寄回位置', statusLabel: '待安排寄回', targetVersion: 9 } });
  assert.equal(afterClerkReceipt.holder, '合成收發同仁');
  assert.equal(afterClerkReceipt.location, '待寄回位置');
  assert.equal(afterClerkReceipt.status, '待安排寄回');
});

test('unknown or missing posted relation never claims historical stock custody as current physical possession', () => {
  for (const donor of [{ ...inbound, physicalCustody: 'UNKNOWN' as const, linkedReplacementCustody: replacement }, { ...inbound, physicalCustody: 'LINKED_CASE' as const }]) {
    const current = currentItemCustody(donor);
    assert.equal(current.holder, '出庫關聯待核對');
    assert.equal(current.location, '目前實物位置待核對');
    assert.equal(current.transferred, true);
    assert.equal(current.reference, undefined);
    assert(!Object.values(current).includes(inbound.custodianName));
    assert(!Object.values(current).includes(inbound.location));
  }
});

test('linked external factory custody overrides its retained technician record', () => {
  const donor = { ...inbound, physicalCustody: 'LINKED_CASE' as const };
  assert.equal(currentItemCustody({ ...donor, linkedReplacementCustody: { ...replacement, physicalCustody: 'FACTORY' } }).holder, '原廠持有');
  assert.equal(currentItemCustody({ ...donor, linkedReplacementCustody: { ...replacement, physicalCustody: 'FACTORY_CARRIER' } }).holder, '承運商持有（原廠交運）');
});

test('ordinary receipt and actual clerk receipt stay mailroom custody, with missing holder distinctly unverified', () => {
  const atClerk = { ...inbound, status: 'READY_FOR_DISPATCH', physicalCustody: 'MAILROOM' as const, custodianName: '合成收發同仁', location: '收發實際位置' };
  assert.deepEqual(currentItemCustody(atClerk), { holder: '合成收發同仁', location: '收發實際位置', transferred: false });
  const unknown = currentItemCustody({ ...atClerk, physicalCustody: 'UNKNOWN', custodianName: '不應視為持有', location: '不應視為實際位置' });
  assert.equal(unknown.holder, '目前實物保管待核對');
  assert.equal(unknown.location, '目前實物位置待核對');
  assert.equal(unknown.transferred, false);
  assert.equal(unknown.reference, undefined);
  assert.equal(currentPhysicalCustody({ ...atClerk, repairWorkflow: { factory: { physicalCustody: 'TECHNICIAN' } } }), 'MAILROOM');
  assert.equal(currentPhysicalCustody({ ...atClerk, physicalCustody: 'UNKNOWN', repairWorkflow: { factory: { physicalCustody: 'TECHNICIAN' } } }), 'UNKNOWN');
});

test('unconsumed inbound and ordinary factory flow retain their current custody without leaking unrelated projection', () => {
  assert.deepEqual(currentItemCustody({ ...inbound, linkedReplacementCustody: replacement }), { holder: '合成入庫人員', location: '原入庫位置', transferred: false });
  const actualFactory = currentItemCustody({ ...inbound, physicalCustody: 'FACTORY', repairWorkflow: { factory: { physicalCustody: 'FACTORY' } } });
  assert.equal(actualFactory.holder, '原廠持有');
  assert.equal(actualFactory.transferred, false);
  const withPrivateData = { ...inbound, physicalCustody: 'LINKED_CASE' as const, linkedReplacementCustody: replacement, customerName: 'PRIVATE CUSTOMER', repairReport: { data: { diagnosis: 'PRIVATE TECHNICAL' } } };
  const current = JSON.stringify(currentItemCustody(withPrivateData));
  assert(!current.includes('PRIVATE'));
  assert(!current.includes('repairReport'));
});
