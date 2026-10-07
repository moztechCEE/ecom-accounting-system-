import assert from 'node:assert/strict';
import test from 'node:test';
import { createMailroomDiscardConfirmation, mailroomDraftFingerprint } from '../src/pages/mailroom/mailroom-draft.ts';
import { dispatchPendingKey, loadPendingDispatch, savePendingDispatch, clearPendingDispatch, type PendingDispatch } from '../src/pages/mailroom/mailroom-dispatch-pending.ts';

test('draft comparison ignores registration order and blank optional values but preserves actual nested changes', () => {
  const initial = { items: [{ productName: 'received', sku: '' }], recipientId: 'person' };
  assert.equal(mailroomDraftFingerprint(initial), mailroomDraftFingerprint({ note: undefined, recipientId: 'person', items: [{ sku: undefined, productName: 'received' }] }));
  assert.notEqual(mailroomDraftFingerprint(initial), mailroomDraftFingerprint({ ...initial, recipientId: 'other' }));
  assert.notEqual(mailroomDraftFingerprint(initial), mailroomDraftFingerprint({ ...initial, items: [{ productName: 'different' }] }));
});

test('one confirmation owns the destination and cancellation permits a later independent request', async () => {
  let answer!: (value: boolean) => void; let count = 0;
  const confirm = createMailroomDiscardConfirmation(() => ({ dirty: true, busy: false }), () => { count++; return new Promise<boolean>(resolve => { answer = resolve; }); }, () => {});
  const first = confirm(); assert.equal(await confirm(), false); assert.equal(count, 1);
  answer(false); assert.equal(await first, false);
  const second = confirm(); answer(true); assert.equal(await second, true);
});

test('busy saves cannot be discarded, including a save starting while confirmation is open', async () => {
  let busy = true; let asks = 0; let blocked = 0; let answer!: (value: boolean) => void;
  const confirm = createMailroomDiscardConfirmation(() => ({ dirty: true, busy }), () => { asks++; return new Promise<boolean>(resolve => { answer = resolve; }); }, () => { blocked++; });
  assert.equal(await confirm(), false); assert.equal(asks, 0); assert.equal(blocked, 1);
  busy = false; const pending = confirm(); busy = true; answer(true); assert.equal(await pending, false);
});

const scope = { entityId: 'company', userId: 'clerk', itemId: 'piece' };
const command: PendingDispatch = { entityId: 'company', action: 'dispatch', requestId: 'stable-key', expectedVersion: 7, carrier: 'carrier', trackingNumber: 'OUT', confirmedItems: true, note: 'physical handover' };
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('pending logistics survives new readers with exactly the original request and isolated company/user/item scope', () => {
  const saved = storage(); savePendingDispatch(saved, scope, command);
  assert.deepEqual(loadPendingDispatch(saved, scope), command);
  for (const other of [{ ...scope, entityId: 'other' }, { ...scope, userId: 'other' }, { ...scope, itemId: 'other' }]) assert.equal(loadPendingDispatch(saved, other), null);
  assert.notEqual(dispatchPendingKey({ ...scope, entityId: 'a:b' }), dispatchPendingKey({ ...scope, entityId: 'a', userId: 'b:clerk' }));
  clearPendingDispatch(saved, scope); assert.equal(loadPendingDispatch(saved, scope), null);
});

test('storage failure or failed read-back blocks safe send and preserves the original request identity', () => {
  const saved = storage();
  assert.throws(() => savePendingDispatch({ ...saved, setItem: () => { throw new Error('quota'); } }, scope, command), /quota/);
  assert.throws(() => savePendingDispatch({ ...saved, getItem: () => null }, scope, command), /安全保存/);
  assert.equal(command.requestId, 'stable-key');
});

test('corrupt, cross-scope or widened pending data is blocked instead of deleting or reusing it', () => {
  const saved = storage(); const key = dispatchPendingKey(scope);
  for (const payload of [{ schema: 1, ...scope, userId: 'other', command }, { schema: 1, ...scope, command: { ...command, expectedVersion: 0 } }, { schema: 1, ...scope, command: { ...command, expectedVersion: 2147483647 } }, { schema: 1, ...scope, command: { ...command, requestId: 'bad!' } }, { schema: 1, ...scope, command: { ...command, requestId: 'x'.repeat(81) } }, { schema: 1, ...scope, command: { ...command, evidence: ['private-photo'] } }]) {
    saved.setItem(key, JSON.stringify(payload));
    assert.throws(() => loadPendingDispatch(saved, scope), /格式或範圍/);
    assert(saved.values.has(key));
  }
});
