import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationDraft, applicationInvite, clearApplicationPending, originalIntakeProductLabel, readApplicationPending, saveApplicationPending, type ApplicationPending } from '../src/pages/after-sales/native-application-model.ts';
import { readPendingRegistration, savePendingRegistration } from '../src/pages/after-sales/pending-registration.ts';
const id = 'e187ba12-9733-4d4c-a512-90e773f4d837', scope = { actorId: 'actor', entityId: 'company' };
const reference = { id, revision: 2, reviewHash: 'a'.repeat(64) };
const application: any = { id, revision: 2, brand: 'MOZTECH', status: 'REVIEWED', caseId: null, verifiedApplicationRef: reference,
  nativeCreateDraft: { type: 'REPAIR', contactName: '測試', contactPhone: '0900000000', contactAddress: '測試地址', contactEmail: 'fixture@example.invalid',
    items: [{ productId: 'source-product', erpProductId: id, quantity: 1, name: '產品', sku: 'SKU' }], detail: { faultDescription: '不充電' } } };
function storage() { const rows = new Map<string,string>(); return { getItem: (k: string) => rows.get(k) || null, setItem: (k: string,v: string) => { rows.set(k,v); }, removeItem: (k: string) => { rows.delete(k); } }; }
test('only reviewed current application can prefill a case and never claims case creation', () => {
  const draft = applicationDraft(application); assert.equal(draft.applicationId, id); assert.equal(draft.type, 'REPAIR'); assert.deepEqual(draft.verifiedApplicationRef, reference);
  assert.deepEqual(draft.values.items, [{ productId: 'source-product', quantity: 1 }]); assert.equal(draft.values.sourceChannel, '');
  for (const change of [{ status: 'SUBMITTED' }, { status: 'CONVERTED' }, { caseId: 'existing-case' }, { revision: 3 }, { verifiedApplicationRef: null }]) assert.throws(() => applicationDraft({ ...application, ...change }), /審核/);
});
test('reviewed application uses existing create journal with exact top-level proof, Source FK items only', () => {
  const store = storage(), draft = applicationDraft(application);
  const value = { ...scope, schema: 'corely.doa.pending-registration.v1' as const, requestId: id, createdAt: new Date().toISOString(), request: { brand: draft.brand, customerKind: 'TO_C', verifiedApplicationRef: draft.verifiedApplicationRef,
    payload: { type: 'REPAIR' as const, sourceChannel: 'LINE', contactName: draft.values.contactName, contactPhone: draft.values.contactPhone, contactAddress: draft.values.contactAddress, contactEmail: draft.values.contactEmail, items: draft.values.items, detail: { faultDescription: draft.values.reason } } } };
  savePendingRegistration(store, scope, value); assert.deepEqual(readPendingRegistration(store, scope), value);
  assert.throws(() => savePendingRegistration(store, scope, { ...value, request: { ...value.request, verifiedApplicationRef: { ...reference, reviewHash: 'bad' } } }), /建單/);
});
test('unknown invite retains exact request UUID and does not store its secret URL', () => {
  const store = storage(), value: ApplicationPending = { ...scope, schema: 'corely.doa.pending-application.v1', applicationId: null, type: 'REPAIR', command: { operation: 'CREATE_INVITE', requestId: id, brand: 'MOZTECH', type: 'REPAIR' } };
  saveApplicationPending(store, value); assert.deepEqual(readApplicationPending(store, scope.actorId, scope.entityId), value);
  assert.equal(readApplicationPending(store, 'other', scope.entityId), null);
  assert.equal(JSON.stringify(value).includes('token'), false);
  assert.throws(() => saveApplicationPending(store, { ...value, command: { ...value.command, brand: 'BONSON' } }), /原請求/);
  clearApplicationPending(store, value); assert.equal(readApplicationPending(store, scope.actorId, scope.entityId), null);
});
test('review retry retains revision, reviewed profile and exact ERP product mapping', () => {
  const store = storage(), value: ApplicationPending = { ...scope, schema: 'corely.doa.pending-application.v1', applicationId: id, type: 'REPAIR', command: { operation: 'REVIEW', requestId: id, type: 'REPAIR', expectedRevision: 1, approve: true, note: '已核對照片', profile: { name: '測試', phone: '0900000000', address: '測試地址', email: 'fixture@example.invalid', productDescription: '產品', faultDescription: '故障' }, items: [{ sourceProductId: 'source-product', erpProductId: id, quantity: 1 }] } };
  saveApplicationPending(store, value); assert.deepEqual(readApplicationPending(store, scope.actorId, scope.entityId), value);
  assert.throws(() => saveApplicationPending(storage(), { ...value, command: { ...value.command, token: 'private' } }), /無法讀取/);
  assert.throws(() => saveApplicationPending(storage(), { ...value, command: { ...value.command, items: [{ sourceProductId: 'source-product', erpProductId: id, quantity: 0 }] } }), /無法讀取/);
});
test('blocked storage prevents a new invite from being dispatched without durable UUID', () => {
  const value: ApplicationPending = { ...scope, schema: 'corely.doa.pending-application.v1', applicationId: null, type: 'REPAIR', command: { operation: 'CREATE_INVITE', requestId: id, brand: 'MOZTECH', type: 'REPAIR' } };
  assert.throws(() => saveApplicationPending({ getItem: () => null, setItem: () => {} }, value), /尚未送出/);
});

test('fresh invite recovery is bounded to its same brand and application, never a readonly or converted capability', () => {
  const invite: any = { ...application, status: 'INVITED', inviteUrl: 'https://source.example.invalid/customer/apply/moztech?invite=' + id + '#token=' + 'a'.repeat(64), providerMode: 'DEV_STUB' };
  assert.equal(applicationInvite(invite, true)?.url, invite.inviteUrl);
  assert.equal(applicationInvite(invite, true)?.providerMode, 'DEV_STUB');
  assert.equal(applicationInvite(invite, false), null);
  for (const changes of [{ status: 'SUBMITTED' }, { status: 'CONVERTED' }, { caseId: 'case' }, { inviteUrl: null }, { brand: 'BONSON' }, { id: 'other' },
    { inviteUrl: invite.inviteUrl.replace('https:', 'http:') }, { inviteUrl: invite.inviteUrl.replace('#token=', '&token=') }, { inviteUrl: invite.inviteUrl + '&extra=private' }])
    assert.equal(applicationInvite({ ...invite, ...changes }, true), null);
});

test('second-track invite recovery pairs mode route with original type and brand, preserving the old apply route', () => {
  for (const [type, mode] of [['REPAIR','repair'], ['REFUND_PICKUP','return']]) {
    const invite: any = { ...application, type, status: 'INVITED', inviteUrl: `https://source.example.invalid/customer/moztech/${mode}?invite=${id}#token=${'a'.repeat(64)}` };
    assert.equal(applicationInvite(invite, true)?.url, invite.inviteUrl);
    for (const change of [{ brand: 'BONSON' }, { type: type === 'REPAIR' ? 'REFUND_PICKUP' : 'REPAIR' }, { type: 'CUSTOMER_ISSUE' },
      { inviteUrl: invite.inviteUrl.replace('moztech', 'bonson') }, { inviteUrl: invite.inviteUrl + '&extra=x' }]) assert.equal(applicationInvite({ ...invite, ...change }, true), null);
  }
});
test('original second-track input stays separate from reviewed ERP items and corrected return contact', () => {
  const submittedData = { name: '原名', phone: '原電話', address: '106原地址', email: 'original@example.invalid', productDescription: '顧客俗名', faultDescription: '原故障', photos: [{ index: 0, name: 'original.png' }],
    intake: { version: 2, mode: 'repair', address: { postalCode: '106', region: '臺北市', district: '大安區', detail: '原地址' }, products: [{ id, quantity: 2 }], barcode: '4710000000000', barcodeUnavailable: false,
      noticeVersion: '2026-10-15', packagingAcknowledged: true, emailVerification: { status: 'UNVERIFIED', verifiedAt: null } } };
  const draft = applicationDraft({ ...application, submittedData });
  assert.equal(draft.originalSubmission, submittedData); assert.equal(draft.values.contactAddress, '測試地址'); assert.equal(draft.values.contactEmail, 'fixture@example.invalid');
  assert.deepEqual(draft.values.items, [{ productId: 'source-product', quantity: 1 }]);
  assert.equal((draft.values as any).intake, undefined); assert.equal(draft.originalSubmission?.intake?.emailVerification.status, 'UNVERIFIED');
});
test('original candidate matching supports ERP mapping and direct IDs while retaining name and SKU', () => {
  const candidate = { id, quantity: 2 };
  for (const product of [{ id: 'source-product', erpProductId: id, name: '核對品名', sku: 'ERP-SKU' }, { id, name: '核對品名', sku: 'ERP-SKU' }]) {
    assert.equal(originalIntakeProductLabel(candidate, [product]), '核對品名 · ERP-SKU × 2');
    assert.deepEqual(candidate, { id, quantity: 2 });
  }
});
test('a candidate outside the loaded first 50 retains its complete original ID without becoming a reviewed ERP product', () => {
  const products = Array.from({ length: 50 }, (_, i) => ({ id: 'loaded-source-' + i, erpProductId: 'loaded-erp-' + i, name: '其他品名', sku: 'SKU-' + i }));
  assert.equal(originalIntakeProductLabel({ id, quantity: 3 }, products), '待核對商品（原選品編號：' + id + '） × 3');
  assert.deepEqual(applicationDraft(application).values.items, [{ productId: 'source-product', quantity: 1 }]);
  assert.equal(products.some(p => p.id === id || p.erpProductId === id), false);
});
