import assert from 'node:assert/strict';
import test from 'node:test';
import { canDispatch, MAILROOM_QUEUES, mailroomNextStep, matchesDispatchReceipt, matchesMailroomSearch, needsInspectionPhoto } from '../src/pages/mailroom/mailroom-workflow.ts';
import { currentItemCustody } from '../src/pages/mailroom/item-custody.ts';
import type { Item } from '../src/pages/mailroom/model.ts';

const item = {
  id: 'synthetic-item', version: 7, status: 'READY_FOR_DISPATCH', productName: '實收產品', sku: 'SKU-A', serialNumber: 'SN-a',
  custodianId: 'clerk', custodianName: '收發人員', location: '寄回區', physicalCustody: 'MAILROOM',
  nextUserId: null, nextUserName: null, label: 'ITEM-1', recipientName: null,
  receipt: { category: 'REPAIR', sourceCaseId: 'source', sourceNumber: 'DEV-R-1', senderLabel: '合成寄件人', carrier: '入件物流', trackingNumber: 'IN-1' },
} as Item;

test('queues use explicit server statuses; partial page totals cannot become category counters', () => {
  assert.equal(MAILROOM_QUEUES[0].status, undefined);
  assert(MAILROOM_QUEUES.some(queue => queue.status === 'WAITING_RETURN_ACCEPTANCE'));
  assert(MAILROOM_QUEUES.some(queue => queue.status === 'DISPATCHED'));
  assert.equal(new Set(MAILROOM_QUEUES.map(queue => queue.status)).size, MAILROOM_QUEUES.length);
});
test('dispatch offered only to current mailroom custodian after return acceptance', () => {
  assert(canDispatch(item, 'clerk', true));
  for (const changed of [
    { ...item, status: 'WAITING_RETURN_ACCEPTANCE' }, { ...item, status: 'DISPATCHED' },
    { ...item, receipt: { ...item.receipt, category: 'RETURN' } },
    { ...item, physicalCustody: 'TECHNICIAN' }, { ...item, physicalCustody: undefined },
    { ...item, outboundShipment: { requestId: 'already-sent' } },
  ]) assert(!canDispatch(changed as Item, 'clerk', true));
  assert(!canDispatch(item, 'another-clerk', true));
  assert(!canDispatch(item, 'clerk', false));
});
test('return signature, stock processing and customer delivery stay separate', () => {
  const waiting = mailroomNextStep({ ...item, status: 'WAITING_RETURN_ACCEPTANCE', nextUserName: '收發人員', releasePurpose: 'RETURN_UNREPAIRED' });
  assert.match(waiting.title, /未修原件/);
  assert.match(waiting.description, /仍由技師保管/);
  assert.equal(waiting.action, 'accept_return');
  assert.equal(mailroomNextStep({ ...item, status: 'PENDING_WELFARE_STOCK' }).action, undefined);
  assert.match(mailroomNextStep({ ...item, status: 'DISPATCHED' }).description, /不代表顧客已收到/);
  assert.match(mailroomNextStep({ ...item, status: 'WAITING_PICKUP' }).description, /本人/);
});
test('repair and return inspection need a saved or newly selected photo; other actions do not invent photo writes', () => {
  assert(needsInspectionPhoto('inspect', [], []));
  assert(needsInspectionPhoto('grade', undefined, []));
  assert(!needsInspectionPhoto('inspect', ['saved-photo'], []));
  assert(!needsInspectionPhoto('grade', [], ['new-photo']));
  assert(!needsInspectionPhoto('assign', [], []));
  assert(!needsInspectionPhoto('dispatch', [], []));
});
test('personal inbox search supports promised SN and location plus sender/recipient', () => {
  for (const query of [' sn-A ', '寄回區', '合成寄件人', 'dev-r', 'IN-1', '']) assert(matchesMailroomSearch(item, query));
  assert(!matchesMailroomSearch(item, 'nonexistent'));
});
test('unknown dispatch is reconciled by exact immutable receipt, never merely a dispatched status', () => {
  const command = { entityId: 'company', requestId: 'dispatch-request', expectedVersion: 7, carrier: '寄出物流', trackingNumber: ' OUT-1 ' };
  const sent = { ...item, status: 'DISPATCHED', version: 8, outboundShipment: { ...command, itemId: item.id, fromVersion: 7, version: 8, carrier: '寄出物流', trackingNumber: 'OUT-1', dispatchedById: 'clerk' } } as unknown as Item;
  assert(matchesDispatchReceipt(sent, command, 'clerk'));
  for (const patch of [{ requestId: 'other' }, { fromVersion: 6 }, { version: 9 }, { carrier: 'other' }, { trackingNumber: 'other' }, { itemId: 'other' }, { entityId: 'other' }, { dispatchedById: 'other' }])
    assert(!matchesDispatchReceipt({ ...sent, outboundShipment: { ...sent.outboundShipment!, ...patch } }, command, 'clerk'));
  assert(!matchesDispatchReceipt({ ...sent, version: 7 }, command, 'clerk'));
});
test('customer carrier custody also follows the formally linked replacement instead of historic inbound holder', () => {
  assert.match(currentItemCustody({ ...item, status: 'DISPATCHED', physicalCustody: 'CUSTOMER_CARRIER' }).holder, /承運商/);
  const donor = { ...item, status: 'STOCKED', physicalCustody: 'LINKED_CASE', linkedReplacementCustody: {
    itemId: 'replacement', physicalCustody: 'CUSTOMER_CARRIER', custodianName: '舊收發', location: '寄出物流', sourceNumber: 'REPAIR-2', outTransactionId: 'OUT-2', statusLabel: '已交物流',
  } } as unknown as Item;
  const custody = currentItemCustody(donor);
  assert.match(custody.holder, /承運商/);
  assert.notEqual(custody.holder, '舊收發');
  assert(custody.transferred);
});
