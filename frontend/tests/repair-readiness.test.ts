import assert from 'node:assert/strict';
import test from 'node:test';
import { repairReadiness } from '../src/pages/repair/repair-readiness.ts';
import { repairReportReady, repairStartReady } from '../src/pages/repair/repair-model.ts';
import type { RepairItem } from '../src/pages/repair/repair-model.ts';

const context = { canUpdate: true, viewerId: 'fixture-tech', handoffNote: '本人核對原件、電源與配件交回' };
const fixture = (): RepairItem => ({
  id: 'synthetic-repair', label: 'SYNTHETIC-UNIT', productName: '合成測試品', sku: 'SYNTHETIC-SKU', serialNumber: 'SYNTHETIC-SN',
  status: 'INSPECTING', statusLabel: '檢測中', version: 8, editable: true, repairOwnerId: 'fixture-tech', custodianId: 'fixture-tech',
  custodianName: '合成維修師', physicalCustody: 'TECHNICIAN', nextUserId: null, nextUserName: null, location: '合成檢修桌',
  receipt: { number: 'SYNTHETIC-RCPT', category: 'REPAIR', sourceCaseId: 'synthetic-source', sourceNumber: 'SYNTHETIC-CASE', customerServiceUserId: 'fixture-csr' },
  repairInspection: {
    number: 'SYNTHETIC-INS', revision: 3, status: 'SUBMITTED', authorId: 'fixture-tech', authorName: '合成維修師', updatedAt: '2026-10-08T01:00:00Z',
    review: { inspectionRevision: 3, actorId: 'fixture-csr', name: '合成客服', confirmedAt: '2026-10-08T02:00:00Z', decision: 'APPROVE', planHash: 'synthetic-plan', quoteRevision: 4 },
    data: { complaint: '合成故障', reproduction: 'YES', testConditions: '合成環境', checks: [], diagnosis: '合成診斷', causeStatus: 'CONFIRMED', plan: 'REPAIR', planNote: '原機處理', feeSuggestion: 'FREE', estimateNote: '' },
  },
  repairWorkflow: { csr: { status: 'RESOLVED', inspectionRevision: 3, estimateRevision: 3, quoteRevision: 4, planHash: 'synthetic-plan', decision: 'APPROVE', ownerId: 'fixture-csr', ownerName: '合成客服', acceptedAt: '2026-10-08T02:00:00Z', resolvedAt: '2026-10-08T02:30:00Z' } },
  release: { available: true, repairAllowed: true, message: '合成來源提供目前版次核對資料', releaseInfo: { quoteRevision: 4, customerApprovedQuoteRevision: 4, customerApprovedAt: '2026-10-08T03:00:00Z', amount: 0, currency: 'TWD', confirmedPaymentQuoteRevision: null } },
  repairReport: {
    number: 'SYNTHETIC-REP', revision: 2, inspectionRevision: 3, status: 'SUBMITTED', authorId: 'fixture-tech', authorName: '合成維修師', updatedAt: '2026-10-08T04:00:00Z',
    data: { outcome: 'REPAIRED', workPerformed: '合成實際維修', parts: [], laborMinutes: 10, checks: [{ name: '合成功能', result: 'PASS', observation: '合成通過' }], qcResult: 'PASS', qcNotes: '合成複驗通過', deliveredAccessories: '合成配件' },
  },
} as RepairItem);
const gate = (item: RepairItem, key: string) => repairReadiness(item, context).startChecks.find(value => value.key === key)!;

test('source green flags cannot substitute for current consent, and free service still requires consent', () => {
  const item = fixture();
  assert(repairReadiness(item, context).startReady);
  item.release!.releaseInfo!.customerApprovedQuoteRevision = null;
  item.release!.releaseInfo!.customerApprovedAt = null;
  const result = repairReadiness(item, context);
  assert(!result.startReady);
  assert(!gate(item, 'customer_consent').ready);
  assert.match(gate(item, 'customer_consent').detail, /免費方案也須/);
  assert.match(result.title, /待核對/);
  assert.equal(result.startReady, repairStartReady(item));
});

test('a refreshed quote invalidates previous CSR approval even if new consent and payment arrive', () => {
  const item = fixture();
  Object.assign(item.release!.releaseInfo!, { quoteRevision: 5, customerApprovedQuoteRevision: 5, amount: 399, confirmedPaymentQuoteRevision: 5 });
  assert(!repairReadiness(item, context).startReady);
  assert(!gate(item, 'source_quote').ready);
  assert(gate(item, 'customer_consent').ready);
  assert(gate(item, 'payment').ready);
  assert.match(gate(item, 'source_quote').detail, /來源目前報價 v5；客服確認報價 v4/);
  item.repairInspection!.review!.quoteRevision = 5;
  item.repairWorkflow!.csr!.quoteRevision = 5;
  assert(repairReadiness(item, context).startReady);
});

test('paid release requires the current confirmed payment version and never infers bank receipt', () => {
  const item = fixture();
  Object.assign(item.release!.releaseInfo!, { amount: 399, confirmedPaymentQuoteRevision: 3 });
  assert(!repairReadiness(item, context).startReady);
  assert(!gate(item, 'payment').ready);
  assert.match(gate(item, 'payment').detail, /尚未確認本版必要款項/);
  item.release!.releaseInfo!.confirmedPaymentQuoteRevision = 4;
  assert(repairReadiness(item, context).startReady);
  assert.match(gate(item, 'payment').detail, /來源確認本版必要款項/);
  assert.match(gate(item, 'payment').detail, /不代替銀行實收/);
});

test('unknown or invalid amounts are pending rather than free, and malformed consent times remain pending', () => {
  for (const amount of [null, -1, NaN]) {
    const item = fixture(); item.release!.releaseInfo!.amount = amount;
    assert(!repairReadiness(item, context).startReady);
    assert(!gate(item, 'payment').ready);
    assert.match(gate(item, 'payment').detail, /不能當成免費方案/);
  }
  const item = fixture(); item.release!.releaseInfo!.customerApprovedAt = 'invalid-time';
  assert(!gate(item, 'customer_consent').ready);
  assert(!repairReadiness(item, context).startReady);
});

test('CSR SENT, ACCEPTED and RESOLVED remain separate from notification and customer consent', () => {
  const item = fixture();
  for (const status of ['SENT', 'ACCEPTED'] as const) {
    item.repairWorkflow!.csr!.status = status;
    const result = repairReadiness(item, context);
    assert(!result.startReady);
    assert.match(result.csrEvidence, status === 'SENT' ? /待客服接手/ : /客服已本人接手/);
    assert.match(result.csrEvidence, /合成客服/);
    assert(!gate(item, 'csr_decision').ready);
  }
  item.repairWorkflow!.csr!.status = 'RESOLVED';
  assert(repairReadiness(item, context).startReady);
  item.repairWorkflow!.csr!.decision = 'DECLINE';
  assert(!repairReadiness(item, context).startReady);
  assert.match(gate(item, 'csr_decision').detail, /拒修/);
});

test('reinspection invalidates both CSR and the existing repair report without changing actual disposition', () => {
  const item = fixture(); item.status = 'REPAIRING';
  assert(repairReadiness(item, context).completionReady);
  item.repairInspection!.revision = 4;
  const before = structuredClone(item);
  const result = repairReadiness(item, context);
  assert(!result.startReady);
  assert(!result.completionReady);
  assert(!result.completionChecks.find(value => value.key === 'report_revision')!.ready);
  assert.match(result.completionChecks.find(value => value.key === 'report_revision')!.detail, /目前檢修 v4；維修單依據檢修 v3/);
  assert.match(result.actualOutcome, /原機實際維修/);
  assert.deepEqual(item, before);
});

test('stale estimate, quote or plan identity cannot create a ready display', () => {
  for (const patch of [{ inspectionRevision: 2 }, { estimateRevision: 2 }, { quoteRevision: 3 }, { planHash: 'different-plan' }]) {
    const item = fixture(); Object.assign(item.repairWorkflow!.csr!, patch);
    assert(!repairReadiness(item, context).startReady);
    assert(!gate(item, 'csr_versions').ready);
    assert.match(gate(item, 'csr_versions').detail, /未齊備或不一致/);
  }
});

test('personal ownership, explicit editability and permission are required without any fixed-role assumption', () => {
  const item = fixture();
  for (const changed of [{ ...context, canUpdate: false }, { ...context, viewerId: 'another-tech' }, { ...context, viewerId: undefined }]) {
    assert(!repairReadiness(item, changed).startReady);
    assert(!repairReadiness({ ...item, status: 'REPAIRING' }, changed).completionReady);
  }
  assert(!repairReadiness({ ...item, editable: false }, context).startReady);
  assert(!repairReadiness({ ...item, custodianId: 'another-tech' }, context).startReady);
  const waiting = { ...item, status: 'WAITING_REPAIR_ACCEPTANCE', repairOwnerId: null, nextUserId: 'fixture-tech', editable: false };
  assert.match(repairReadiness(waiting, context).nextStep, /認領不等於已收到實物/);
  assert(!repairReadiness(waiting, context).startReady);
});

test('failed and untested checks show actual observations and block completed handoff', () => {
  const item = fixture(); item.status = 'REPAIRING';
  item.repairReport!.data.qcResult = 'FAIL';
  item.repairReport!.data.qcNotes = '合成異常仍待排除';
  item.repairReport!.data.checks = [{ name: '電源', result: 'FAIL', observation: '合成電源異常' }, { name: '長時間測試', result: 'NOT_TESTED', observation: '尚待測試設備' }];
  const result = repairReadiness(item, context);
  assert(!result.completionReady);
  assert.match(result.completionChecks.find(value => value.key === 'qc')!.detail, /合成異常仍待排除/);
  assert.match(result.completionChecks.find(value => value.key === 'checks')!.detail, /電源：不通過（合成電源異常）/);
  assert.match(result.completionChecks.find(value => value.key === 'checks')!.detail, /未測／待測（尚待測試設備）/);
  assert.equal(result.reportReady, repairReportReady(item));
  item.repairReport!.data.qcResult = 'PASS'; item.repairReport!.data.checks = [];
  assert(!repairReadiness(item, context).completionReady);
});

test('replacement identity and condition must match the saved plan while original actual outcome is retained', () => {
  const item = fixture(); item.status = 'REPAIRING';
  Object.assign(item.repairInspection!.data, { plan: 'REPLACE', replacementSku: 'SYNTHETIC-NEW', replacementCondition: 'REFURBISHED' });
  const result = repairReadiness(item, context);
  assert(!result.completionReady);
  assert.match(result.actualOutcome, /原機實際維修/);
  Object.assign(item.repairReport!.data, { outcome: 'REPLACED', replacementSku: 'SYNTHETIC-NEW', replacementCondition: 'NEW' });
  assert(!repairReadiness(item, context).completionReady);
  item.repairReport!.data.replacementCondition = 'REFURBISHED';
  assert(repairReadiness(item, context).completionReady);
  assert(!repairReadiness(item, { ...context, handoffNote: '  ' }).completionReady);
});

test('original refusal return never uses repaired-completion readiness or invents a report', () => {
  const item = fixture(); item.repairInspection!.data.plan = 'RETURN';
  item.repairInspection!.review!.decision = 'DECLINE'; item.repairWorkflow!.csr!.decision = 'DECLINE';
  const before = structuredClone(item);
  const result = repairReadiness(item, context);
  assert(!result.startReady); assert(!result.completionReady); assert(!result.showStart); assert(!result.showCompletion);
  assert.match(result.title, /未修原件/);
  assert.match(result.nextStep, /保留當版客服拒修/);
  assert.match(result.actualOutcome, /原機實際維修/);
  assert.deepEqual(item, before);
  item.status = 'WAITING_RETURN_ACCEPTANCE'; item.repairWorkflow!.release = { purpose: 'RETURN_UNREPAIRED' };
  const waiting = repairReadiness(item, context);
  assert.match(waiting.title, /未修原件已交辦/);
  assert.match(waiting.nextStep, /不等於收發已接收、已出貨或已入庫/);
});

test('factory cancellation, transit, personal return and matching factory reference are distinct', () => {
  const item = fixture(); item.repairInspection!.data.plan = 'FACTORY';
  item.status = 'FACTORY_RECEIVED'; item.editable = false;
  item.repairWorkflow!.factory = { stage: 'ACCEPTED', physicalCustody: 'FACTORY', reference: 'SYNTHETIC-FACTORY', cancelled: true };
  assert.match(repairReadiness(item, context).nextStep, /取消本身不表示已返還/);
  item.status = 'FACTORY_RETURNING';
  assert.match(repairReadiness(item, context).nextStep, /返還在途不等於本人收到/);
  item.status = 'INSPECTING'; item.editable = true; item.allowedWorkflowActions = ['complete_factory'];
  Object.assign(item.repairReport!.data, { outcome: 'FACTORY_REPAIRED', factoryReference: 'SYNTHETIC-FACTORY' });
  Object.assign(item.repairWorkflow!.factory, { stage: 'RETURNED', physicalCustody: 'TECHNICIAN' });
  assert(repairReadiness(item, { ...context, handoffNote: '' }).completionReady);
  assert.match(repairReadiness(item, context).nextStep, /原廠作業填寫實際品況/);
  item.repairReport!.data.factoryReference = 'DIFFERENT-FACTORY';
  assert(!repairReadiness(item, context).completionReady);
});

test('source failure text is preserved verbatim rather than replaced by generic readiness', () => {
  const item = fixture(); item.release = { available: false, repairAllowed: false, message: '合成來源暫時無法查詢；請重新核對。' };
  const result = repairReadiness(item, context);
  assert.equal(result.sourceMessage, item.release.message);
  assert.equal(gate(item, 'source_release').detail, item.release.message);
  assert(!result.startReady);
});

test('internal return refurbishment does not turn unsupported replacement, factory or return plans into ready handoff', () => {
  for (const plan of ['REPLACE', 'FACTORY', 'RETURN'] as const) {
    const item = fixture(); item.receipt.category = 'RETURN'; item.status = 'REFURBISHING';
    Object.assign(item.repairInspection!.data, { plan, replacementSku: 'SYNTHETIC-NEW', replacementCondition: 'REFURBISHED' });
    if (plan === 'REPLACE') Object.assign(item.repairReport!.data, { outcome: 'REPLACED', replacementSku: 'SYNTHETIC-NEW', replacementCondition: 'REFURBISHED' });
    if (plan === 'FACTORY') {
      item.allowedWorkflowActions = ['complete_factory'];
      item.repairWorkflow!.factory = { stage: 'RETURNED', physicalCustody: 'TECHNICIAN', reference: 'SYNTHETIC-FACTORY' };
      Object.assign(item.repairReport!.data, { outcome: 'FACTORY_REPAIRED', factoryReference: 'SYNTHETIC-FACTORY' });
    }
    const before = structuredClone(item), result = repairReadiness(item, context);
    assert(!result.completionReady); assert(result.showCompletion);
    assert.match(result.title, /不支援此完成流程/);
    assert.match(result.nextStep, /不能將真實處置改成修理/);
    assert.deepEqual(item, before);
  }
  const supported = fixture(); supported.receipt.category = 'RETURN'; supported.status = 'REFURBISHING';
  assert(repairReadiness(supported, context).completionReady);
});

test('post-clerk return awaiting stock is distinct from awaiting clerk personal acceptance', () => {
  const item = fixture(); item.receipt.category = 'RETURN'; item.status = 'PENDING_WELFARE_STOCK';
  item.custodianId = 'fixture-clerk'; item.custodianName = '合成收發'; item.physicalCustody = 'MAILROOM';
  const result = repairReadiness(item, context);
  assert.match(result.title, /已交回收發室/);
  assert.match(result.nextStep, /收發室已本人接收/);
  assert.match(result.nextStep, /待入庫/);
  assert(!result.nextStep.includes('等待收發室接手人'));
  assert(!result.completionReady); assert(!result.showCompletion);
});

test('completion rechecks refreshed source and CSR after work starts even when all repair-document QC is passing', () => {
  const mutations = [
    (item: RepairItem) => { item.release!.available = false; },
    (item: RepairItem) => { item.release!.repairAllowed = false; },
    (item: RepairItem) => { Object.assign(item.release!.releaseInfo!, { quoteRevision: 5, customerApprovedQuoteRevision: 5, amount: 399, confirmedPaymentQuoteRevision: 5 }); },
    (item: RepairItem) => { item.release!.releaseInfo!.customerApprovedQuoteRevision = 3; },
    (item: RepairItem) => { Object.assign(item.release!.releaseInfo!, { amount: 399, confirmedPaymentQuoteRevision: null }); },
    (item: RepairItem) => { item.repairWorkflow!.csr!.planHash = 'another-plan'; },
    (item: RepairItem) => { item.repairWorkflow!.csr!.status = 'ACCEPTED'; },
  ];
  for (const mutate of mutations) {
    const item = fixture(); item.status = 'REPAIRING';
    assert(repairReadiness(item, context).completionReady);
    mutate(item);
    const result = repairReadiness(item, context);
    assert(result.reportReady, 'Saved report still passes its native document gate');
    assert(!result.completionReady, 'A saved passing report cannot substitute for current customer release');
    assert(result.completionChecks.some(value => ['csr_decision', 'csr_versions', 'source_release', 'source_quote', 'customer_consent', 'payment'].includes(value.key) && !value.ready));
    assert.match(result.title, /待核對/);
  }
  const internal = fixture(); internal.receipt.category = 'RETURN'; internal.status = 'REFURBISHING';
  internal.release = { available: false, repairAllowed: false, message: '合成退貨沒有顧客維修放行' };
  internal.repairWorkflow = null;
  assert(repairReadiness(internal, context).completionReady, 'Internal refurbishment does not borrow customer payment rules');
});

test('native permission for refusal return takes precedence over the older REPAIR or REPLACE recommendation', () => {
  for (const plan of ['REPAIR', 'REPLACE'] as const) {
    const item = fixture(); item.status = 'WAITING_CUSTOMER'; item.repairInspection!.data.plan = plan;
    item.repairWorkflow!.csr!.decision = 'DECLINE'; item.repairInspection!.review!.decision = 'DECLINE';
    item.allowedWorkflowActions = ['return_original'];
    const before = structuredClone(item), result = repairReadiness(item, context);
    assert.match(result.title, /未修原件/);
    assert.match(result.nextStep, /伺服器目前允許原件未修退回/);
    assert(!result.startReady); assert(!result.completionReady); assert(!result.showStart); assert(!result.showCompletion);
    assert.deepEqual(item, before, 'Refusal guidance must preserve original recommendation and actual report');
  }
});
