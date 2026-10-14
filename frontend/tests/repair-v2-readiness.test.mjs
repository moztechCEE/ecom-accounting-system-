import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
const root = fileURLToPath(new URL('../src/pages/', import.meta.url));
const allowed = new Set(['repair/repair-model.ts', 'repair/repair-readiness.ts', 'repair/repair-nextstep.ts', 'repair/repair-list-model.ts', 'mailroom/item-custody.ts'].map(path => resolve(root, path)));
const modules = new Map();
function load(path) {
  assert(allowed.has(path), `Unexpected runtime dependency ${path}`);
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} }; modules.set(path, module);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', 'require', code)(module, module.exports, specifier => load(resolve(dirname(path), specifier + '.ts')));
  return module.exports;
}
const model = load(resolve(root, 'repair/repair-model.ts')), { repairReadiness } = load(resolve(root, 'repair/repair-readiness.ts'));
const nextstep=load(resolve(root,'repair/repair-nextstep.ts')), listModel=load(resolve(root,'repair/repair-list-model.ts'));
const hash = 'a'.repeat(64), proposalHash = 'b'.repeat(64), context = { canUpdate: true, viewerId: 'tech', handoffNote: 'Actual synthetic handoff' };
function item() {
  const binding = { itemId: 'item', planVersion: 3, planHash: hash, proposalHash };
  const templateBinding = {id:'synthetic-template',revision:1,contentHash:'c'.repeat(64)};
  const check = {key:'function',name:'Actual test',result:'PASS',observation:'Recorded value'};
  const template = {...templateBinding,schema:1,status:'REVIEWED',entityId:'company',productId:'product',sku:'SYNTHETIC-SKU',checks:[{key:'function',name:'Actual test',requiredForInspection:true,requiredForCompletion:true,requiresCalibration:false,standard:{kind:'OBSERVATION',instruction:'SYNTHETIC test fixture'}}]};
  return { id: 'item',entityId:'company',productId:'product',sku:'SYNTHETIC-SKU', status: 'INSPECTING', editable: true, repairOwnerId: 'tech', custodianId: 'tech', receipt: { category: 'REPAIR' }, repairProposalBinding: binding,
    repairInspection: { number: 'INS', revision: 3, status: 'SUBMITTED', review: { inspectionRevision: 3, decision: 'APPROVE', planHash: hash, quoteRevision: 4 }, data: { protocol: 2,templateBinding, plan: 'REPAIR', materialPlan: { mode: 'NONE', lines: [] }, checks: [check] } },
    repairWorkflow: { csr: { status: 'RESOLVED', decision: 'APPROVE', inspectionRevision: 3, estimateRevision: 3, quoteRevision: 4, planHash: hash } },
    release: { available: true, repairAllowed: true, releaseInfo: { quoteRevision: 4, customerApprovedQuoteRevision: 4, customerApprovedAt: '2026-10-13T00:00:00Z', amount: 399, currency: 'TWD', confirmedPaymentQuoteRevision: 4, invoiceRequired: true, invoiceStatus: 'ISSUED', invoiceSatisfied: true, invoiceQuoteRevision: 4, quoteBindings: [{ ...binding, quoteRevision: 4 }] } },
    repairReport: { number: 'REP', revision: 1, status: 'SUBMITTED', inspectionRevision: 3, data: { protocol:2,templateBinding,outcome: 'REPAIRED', workPerformed: 'Recorded actual work', parts: [], laborMinutes: 5, checks: [check], qcResult: 'PASS', qcNotes: 'Recorded QC', deliveredAccessories: 'None' } },
    repairPrerequisites:{template,templateChecks:{inspection:'READY',completion:'READY'},materials:{start:{state:'READY',reason:'NOT_REQUIRED',requiredCount:0},completion:{state:'READY',reason:'NOT_REQUIRED',requiredCount:0}}},
  };
}
function waitingItem() {
  const value = item();
  value.status = 'WAITING_CUSTOMER';
  value.receipt.sourceCaseId = 'source-item'; value.release.sourceCaseId = 'source-item';
  value.release.repairAllowed = false;
  value.repairWorkflow.csr.status = 'ACCEPTED';
  delete value.repairWorkflow.csr.decision; delete value.repairInspection.review;
  value.release.releaseInfo.customerApprovedQuoteRevision = null;
  value.release.releaseInfo.customerApprovedAt = null;
  value.release.releaseInfo.confirmedPaymentQuoteRevision = null;
  value.release.releaseInfo.invoiceStatus = 'PENDING'; value.release.releaseInfo.invoiceSatisfied = false;
  value.release.releaseInfo.invoiceQuoteRevision = null;
  return value;
}
function unquotedItem() {
  const value = waitingItem(); value.release.sourceStatus = 'RECEIVED'; value.repairProposalBinding = null;
  value.release.releaseInfo = { quoteRevision: 1, amount: null, currency: 'TWD', quotePlanVersion: null, quotePlanHash: null,
    quoteBindings: null, customerApprovedQuoteRevision: null, customerApprovedAt: null, confirmedPaymentQuoteRevision: null,
    invoiceRequired: false, invoiceStatus: 'NOT_REQUIRED', invoiceSatisfied: true, invoiceQuoteRevision: null };
  return value;
}
test('waiting progress follows the current quote before final CSR resolution without authorizing repair', () => {
  const value = waitingItem();
  const assertProgress = expected => {
    const before = structuredClone(value);
    assert.equal(listModel.repairCaseProgress(value), expected);
    assert(!model.repairStartReady(value));
    assert.deepEqual(value, before);
  };
  assertProgress('等待顧客確認');
  value.release.releaseInfo.customerApprovedQuoteRevision = 4;
  value.release.releaseInfo.customerApprovedAt = '2026-10-15T00:00:00Z';
  assertProgress('等待款項確認');
  value.release.releaseInfo.confirmedPaymentQuoteRevision = 4;
  assertProgress('等待發票完成');
  Object.assign(value.release.releaseInfo, { invoiceStatus: 'ISSUED', invoiceSatisfied: true, invoiceQuoteRevision: 4 });
  assertProgress('等待客服確認');
  value.status = 'INSPECTING'; value.repairWorkflow.csr.status = 'RESOLVED'; value.repairWorkflow.csr.decision = 'APPROVE';
  value.repairInspection.review = { inspectionRevision: 3, decision: 'APPROVE', planHash: hash, quoteRevision: 4 };
  value.release.repairAllowed = true;
  assert.equal(listModel.repairCaseProgress(value), '待開始維修');
  assert(model.repairStartReady(value));
});
test('a submitted handoff without a current adopted quote distinguishes CSR acceptance from review', () => {
  const value = unquotedItem();
  value.repairWorkflow.csr.status = 'SENT';
  assert.equal(listModel.repairCaseProgress(value), '等待客服接手');
  value.repairWorkflow.csr.status = 'ACCEPTED';
  assert.equal(listModel.repairCaseProgress(value), '等待客服審核');
  assert(!model.repairStartReady(value));
});
test('a foreign or unavailable source cannot look like a known waiting customer or payment state', () => {
  for (const mutate of [value => { value.release.available = false; }, value => { value.release.sourceCaseId = 'another-source'; }, value => { delete value.release; }]) {
    const value = waitingItem(); mutate(value);
    assert.equal(listModel.repairCaseProgress(value), '進度待確認');
    assert(!model.repairStartReady(value));
  }
});
test('both missing and null quote projections remain unknown without the actual unquoted Source shape', () => {
  const value = waitingItem(); delete value.release.releaseInfo;
  assert.equal(listModel.repairCaseProgress(value), '進度待確認');
  value.release.releaseInfo = null;
  assert.equal(listModel.repairCaseProgress(value), '進度待確認');
});
test('unknown invoice policy or a stale issued invoice cannot claim the final CSR checkpoint', () => {
  for (const policy of [undefined, null, 'false']) {
    const value = waitingItem();
    Object.assign(value.release.releaseInfo, { customerApprovedQuoteRevision: 4, customerApprovedAt: '2026-10-15T00:00:00Z', confirmedPaymentQuoteRevision: 4, invoiceRequired: policy });
    assert.equal(listModel.repairCaseProgress(value), '進度待確認');
    assert(!model.repairStartReady(value));
  }
  const value = waitingItem();
  Object.assign(value.release.releaseInfo, { customerApprovedQuoteRevision: 4, customerApprovedAt: '2026-10-15T00:00:00Z', confirmedPaymentQuoteRevision: 4, invoiceStatus: 'ISSUED', invoiceSatisfied: true, invoiceQuoteRevision: 3 });
  assert.equal(listModel.repairCaseProgress(value), '等待發票完成');
});
test('the real Source initial repair placeholder means unquoted, not a zero-price approved repair', () => {
  const initial = unquotedItem;
  for (const stage of ['RECEIVED', 'INSPECTING']) for (const bindings of [null, []]) {
    const value = initial(); value.release.sourceStatus = stage; value.release.releaseInfo.quoteBindings = bindings;
    assert.equal(listModel.repairCaseProgress(value), '等待客服審核');
    value.repairWorkflow.csr.status = 'SENT';
    assert.equal(listModel.repairCaseProgress(value), '等待客服接手');
    assert(!model.repairStartReady(value));
  }
  for (const mutate of [value => { value.release.sourceStatus = 'QUOTED'; }, value => { value.release.repairAllowed = true; },
    value => { value.release.releaseInfo.amount = 0; }, value => { value.release.releaseInfo.quoteRevision = 2; },
    value => { delete value.release.releaseInfo.quotePlanVersion; }, value => { delete value.release.releaseInfo.quoteBindings; },
    value => { value.release.releaseInfo.customerApprovedQuoteRevision = 1; }, value => { value.release.releaseInfo.confirmedPaymentQuoteRevision = 1; },
    value => { value.release.releaseInfo.invoiceStatus = 'ISSUED'; }]) {
    const value = initial(); mutate(value);
    assert.equal(listModel.repairCaseProgress(value), '進度待確認');
    assert(!model.repairStartReady(value));
  }
});
test('superseded or ambiguous quote bindings cannot advance the waiting progress', () => {
  const mutations = [
    value => { value.release.releaseInfo.quoteRevision = 5; },
    value => { value.release.releaseInfo.quoteBindings[0].itemId = 'another-item'; },
    value => { value.release.releaseInfo.quoteBindings.push(structuredClone(value.release.releaseInfo.quoteBindings[0])); },
    value => { value.release.releaseInfo.quoteBindings[0].planVersion = 2; },
    value => { value.release.releaseInfo.quoteBindings[0].planHash = 'c'.repeat(64); },
    value => { value.release.releaseInfo.quoteBindings[0].proposalHash = 'c'.repeat(64); },
    value => { value.repairProposalBinding.itemId = 'another-item'; },
    value => { value.repairProposalBinding.proposalHash = 'malformed'; },
    value => { value.release.releaseInfo.amount = -1; },
  ];
  for (const mutate of mutations) {
    const value = waitingItem(); mutate(value);
    assert.equal(listModel.repairCaseProgress(value), '進度待確認');
    assert(!model.repairStartReady(value));
  }
  const stale = waitingItem(); stale.repairInspection.revision = 4;
  assert.equal(listModel.repairCaseProgress(stale), '進度待確認');
});
test('paid policy and current successful invoice cannot be replaced by a bare issued flag', () => {
  const current = item().release.releaseInfo;
  assert(model.sourceInvoiceCurrent(current));
  for (const patch of [{ invoiceRequired: undefined }, { invoiceRequired: 'false' }, { invoiceStatus: 'DRAFT' }, { invoiceSatisfied: false }, { invoiceSatisfied: 'true' }, { invoiceQuoteRevision: 3 }, { amount: null }]) assert(!model.sourceInvoiceCurrent({ ...current, ...patch }));
  assert(model.sourceInvoiceCurrent({ ...current, invoiceRequired: false, invoiceStatus: 'FAILED', invoiceSatisfied: false }));
  assert(model.sourceInvoiceCurrent({ ...current, amount: 0, invoiceRequired: undefined, invoiceStatus: undefined, invoiceSatisfied: undefined }));
  assert(!model.sourceInvoiceCurrent({ ...current, amount: 0, invoiceRequired: true, invoiceSatisfied: false }));
});
test('exactly one binding must match the current server proposal for this physical item', () => {
  const original = item(); assert(model.sourceItemQuoteBindingCurrent(original));
  for (const patch of [{ itemId: 'other' }, { planVersion: 2 }, { planHash: 'c'.repeat(64) }, { proposalHash: 'd'.repeat(64) }, { quoteRevision: 3 }]) {
    const wrong = item(); wrong.release.releaseInfo.quoteBindings[0] = { ...wrong.release.releaseInfo.quoteBindings[0], ...patch }; assert(!model.sourceItemQuoteBindingCurrent(wrong));
  }
  const missing = item(); missing.repairProposalBinding = null; assert(!model.sourceItemQuoteBindingCurrent(missing));
  const duplicates = item(); duplicates.release.releaseInfo.quoteBindings.push(duplicates.release.releaseInfo.quoteBindings[0]); assert(!model.sourceItemQuoteBindingCurrent(duplicates));
});
test('required materials stay blocked without server proof and deferred requirements apply at completion', () => {
  const current = item(); assert(model.sourceMaterialsCurrent(current));
  current.repairInspection.data.materialPlan = model.materialPlanPayload(undefined); assert(!model.sourceMaterialsCurrent(current));
  current.repairInspection.data.materialPlan = { mode: 'REQUIRED', lines: [{ id: 'battery', productId: 'battery', warehouseId: 'parts', requiredQuantity: '1.25', requiredForStart: true }] };
  assert(!model.sourceMaterialsCurrent(current)); current.repairPrerequisites.materials = {start:{state:'UNKNOWN',reason:'MISSING_RECEIPT',requiredCount:1},completion:{state:'UNKNOWN',reason:'MISSING_RECEIPT',requiredCount:1}}; assert(!model.sourceMaterialsCurrent(current));
  current.repairPrerequisites.materials.start.state = 'READY'; assert(model.sourceMaterialsCurrent(current));
  current.repairPrerequisites.materials.start.requiredCount = 0; assert(!model.sourceMaterialsCurrent(current));
  current.repairInspection.data.materialPlan.lines[0].requiredForStart = false; assert(model.sourceMaterialsCurrent(current, 'START')); assert(!model.sourceMaterialsCurrent(current, 'COMPLETION'));
  current.repairInspection.data.materialPlan.lines[0].requiredQuantity = '1.255'; assert(!model.sourceMaterialsCurrent(current, 'START'));
});
test('unknown template, old document protocol, missing/untested required row and replacement SKU cannot be presented as tested',()=>{
  for(const mutate of [value=>value.repairPrerequisites.templateChecks.inspection='UNKNOWN',value=>delete value.repairInspection.data.protocol,value=>value.repairInspection.data.checks=[],value=>value.repairInspection.data.checks[0].result='NOT_TESTED',value=>value.repairPrerequisites.template.sku='other']){
    const wrong=item();mutate(wrong);assert(!model.sourceTemplateCurrent(wrong));assert(!model.repairStartReady(wrong));assert.equal(repairReadiness(wrong,context).startChecks.find(check=>check.key==='test_standard').ready,false);
  }
  const replacement=item();replacement.status='REPAIRING';replacement.repairInspection.data.plan='REPLACE';replacement.repairInspection.data.replacementSku='REPLACEMENT-SKU';replacement.repairInspection.data.replacementCondition='NEW';replacement.repairReport.data.outcome='REPLACED';replacement.repairReport.data.replacementSku='REPLACEMENT-SKU';replacement.repairReport.data.replacementCondition='NEW';
  assert(!model.sourceTemplateCurrent(replacement,'COMPLETION'));assert(!repairReadiness(replacement,context).completionReady);
});
test('readiness exposes the actual failed invoice/binding/material check and does not mutate documents', () => {
  const current = item(); assert(repairReadiness(current, context).startReady);
  for (const [key, mutate] of [['invoice', value => value.release.releaseInfo.invoiceSatisfied = false], ['proposal_binding', value => value.repairProposalBinding = null], ['materials', value => value.repairInspection.data.materialPlan = { mode: 'UNASSESSED', lines: [] }]]) {
    const wrong = item(); mutate(wrong); const before = structuredClone(wrong), result = repairReadiness(wrong, context);
    assert(!result.startReady); assert.equal(result.startChecks.find(check => check.key === key).ready, false); assert.deepEqual(wrong, before);
    wrong.status = 'REPAIRING'; assert(!repairReadiness(wrong, context).completionReady); assert.equal(wrong.repairReport.data.workPerformed, 'Recorded actual work');
  }
});
test('missing stage projections and malformed rows fail closed without crashing the readonly projection', () => {
  for (const materials of [{ completion: { state: 'READY', requiredCount: 0 } }, { state: 'READY', requiredCount: 0 }, {}]) {
    const current = item(); current.repairPrerequisites.materials = materials;
    assert(!model.sourceMaterialsCurrent(current)); const readiness = repairReadiness(current, context);
    assert(!readiness.startReady); assert.equal(readiness.startChecks.find(check => check.key === 'materials').ready, false);
  }
  const malformed = item(); malformed.repairInspection.data.materialPlan = { mode: 'REQUIRED', lines: [null] };
  assert(!model.sourceMaterialsCurrent(malformed)); assert(!repairReadiness(malformed, context).startReady);
  const wrongCheck = item(); wrongCheck.repairInspection.data.checks = [null];
  assert(!model.sourceTemplateCurrent(wrongCheck)); assert(!repairReadiness(wrongCheck, context).startReady);
  const wrongTemplate = item(); wrongTemplate.repairPrerequisites.template.checks = [null];
  assert(!model.sourceTemplateCurrent(wrongTemplate)); assert(!repairReadiness(wrongTemplate, context).startReady);
  const freeUnknown = item(); Object.assign(freeUnknown.release.releaseInfo, { amount: 0, invoiceRequired: 'false' });
  const invoice = repairReadiness(freeUnknown, context).startChecks.find(check => check.key === 'invoice');
  assert.equal(invoice.ready, false); assert.equal(invoice.detail, '發票需求未確認');
});
test('SCRAP is a proposal with no repair completion or invented finished state', () => {
  const current = item(); current.repairInspection.data.plan = 'SCRAP'; const result = repairReadiness(current, context);
  assert(!model.repairStartReady(current)); assert(!model.repairReportReady(current)); assert(!result.showStart && !result.completionReady); assert.equal(result.title, '原件處置待確認'); assert.equal(current.status, 'INSPECTING');
});
function dispositionItem() {
  const value=item();value.physicalCustody='TECHNICIAN';value.repairInspection.review.decision='DECLINE';value.repairWorkflow.csr.decision='DECLINE';value.allowedWorkflowActions=['return_original','record_scrap_authorization'];
  value.repairPrerequisites.disposition={returnOriginal:{state:'READY',reason:'READY'},scrapAuthorization:{state:'BLOCKED',reason:'DECISION_MISMATCH'},authorization:null};return value;
}
test('refused original return uses exact CSR and server disposition without positive repair gates',()=>{
  const value=dispositionItem();delete value.release;delete value.repairPrerequisites.template;delete value.repairPrerequisites.templateChecks;delete value.repairPrerequisites.materials;
  assert(model.sourceDispositionCurrent(value,'return_original'));assert(nextstep.repairWorkflowGate(value,'return_original',context).ready);
  const ready=repairReadiness(value,context);assert(ready.showDisposition && ready.dispositionReady);assert(!ready.showStart && !ready.startReady && !ready.completionReady);
  assert.deepEqual(nextstep.repairNextStepActions(value,{...context,note:'Recorded handoff'}),[]);
  for(const mutate of [wrong=>delete wrong.repairPrerequisites.disposition,wrong=>wrong.repairPrerequisites.disposition.returnOriginal.state='UNKNOWN',wrong=>wrong.repairPrerequisites.disposition.returnOriginal.state='BLOCKED',wrong=>wrong.repairWorkflow.csr.quoteRevision=3,wrong=>wrong.repairInspection.data.plan='SCRAP',wrong=>wrong.allowedWorkflowActions=[]]){
    const wrong=structuredClone(value);mutate(wrong);assert(!nextstep.repairWorkflowGate(wrong,'return_original',context).ready);assert(!model.sourceDispositionCurrent(wrong,'return_original'));assert(!repairReadiness(wrong,context).dispositionReady);
  }
});
test('scrap authorization remains a source-backed recording action and exact TODO label',()=>{
  const value=dispositionItem();value.repairInspection.data.plan='SCRAP';value.allowedWorkflowActions=['record_scrap_authorization'];value.repairPrerequisites.disposition.scrapAuthorization={state:'READY',reason:'READY'};
  assert(nextstep.repairWorkflowGate(value,'record_scrap_authorization',context).ready);assert(!nextstep.repairWorkflowGate(value,'return_original',context).ready);assert.equal(listModel.repairTodoLabel({...value,todoKind:'SCRAP_AUTHORIZATION'}),'待記錄報廢授權');
  value.repairPrerequisites.disposition.scrapAuthorization={state:'BLOCKED',reason:'ALREADY_RECORDED'};assert.deepEqual(nextstep.repairWorkflowGate(value,'record_scrap_authorization',context),{ready:false,reason:'本版報廢授權已記錄'});assert.equal(value.status,'INSPECTING');assert.equal(value.custodianId,'tech');
  for(const patch of [{canUpdate:false},{viewerId:'other'}])assert(!nextstep.repairWorkflowGate(value,'record_scrap_authorization',{...context,...patch}).ready);
});
test('normal completion and returned factory actions use all current gates rather than QC alone',()=>{
  const value=item();value.status='REPAIRING';let actions=nextstep.repairNextStepActions(value,{...context,note:'Actual accessories'});assert.equal(actions.find(action=>action.name==='complete_repair').disabled,false);
  value.repairPrerequisites.templateChecks.completion='UNKNOWN';actions=nextstep.repairNextStepActions(value,{...context,note:'Actual accessories'});assert.equal(actions.find(action=>action.name==='complete_repair').disabled,true);
  value.allowedWorkflowActions=['complete_factory'];value.status='INSPECTING';value.repairInspection.data.plan='FACTORY';value.repairReport.data.outcome='FACTORY_REPAIRED';value.repairReport.data.factoryReference='actual-ref';value.repairWorkflow.factory={stage:'RETURNED',physicalCustody:'TECHNICIAN',reference:'actual-ref'};
  assert(!nextstep.repairWorkflowGate(value,'complete_factory',context).ready);value.repairPrerequisites.templateChecks.completion='READY';assert(nextstep.repairWorkflowGate(value,'complete_factory',context).ready);
});
function companyItem() {
  const value=item();value.receipt.category='RETURN';value.receipt.customerServiceUserId='csr';value.status='REFURBISHING';value.physicalCustody='TECHNICIAN';
  value.repairInspection.review.quoteRevision=null;value.repairWorkflow.csr.quoteRevision=null;value.allowedWorkflowActions=['start_refurbishment'];
  value.repairPrerequisites.workStart={state:'BLOCKED',reason:'NOT_STARTED'};delete value.release;delete value.repairProposalBinding;return value;
}
test('company refurbishment starts through its own current CSR, physical and stage prerequisites without customer invoice',()=>{
  const value=companyItem(),before=structuredClone(value);assert(model.companyCsrCurrent(value));assert(model.refurbishmentStartReady(value));assert(nextstep.repairWorkflowGate(value,'start_refurbishment',context).ready);
  const ready=repairReadiness(value,context);assert(ready.startReady);assert(ready.startChecks.every(check=>!['invoice','payment','customer_consent','proposal_binding','source_quote'].includes(check.key)));assert.deepEqual(value,before);
  assert.equal(listModel.repairTodoLabel({...value,todoKind:'START_REFURBISHMENT'}),'待開始整新');assert.equal(listModel.repairTodoLabel(value),undefined);
  const actions=nextstep.repairNextStepActions(value,{...context,note:'Actual CSR handoff'});assert(actions.some(action=>action.name==='await_customer'&&!action.disabled));assert(!actions.some(action=>action.name==='start_refurbishment'));
  for(const mutate of [wrong=>wrong.repairWorkflow.csr.quoteRevision=undefined,wrong=>wrong.repairInspection.review.quoteRevision=undefined,wrong=>wrong.repairWorkflow.csr.estimateRevision=2,wrong=>wrong.repairWorkflow.csr.planHash='d'.repeat(64),wrong=>wrong.repairWorkflow.csr.decision='DECLINE',wrong=>wrong.repairInspection.data.plan='REPLACE',wrong=>wrong.repairPrerequisites.materials.start.state='UNKNOWN',wrong=>wrong.repairPrerequisites.templateChecks.inspection='UNKNOWN',wrong=>wrong.physicalCustody='FACTORY',wrong=>wrong.allowedWorkflowActions=[]]){
    const wrong=structuredClone(value);mutate(wrong);assert(!nextstep.repairWorkflowGate(wrong,'start_refurbishment',context).ready);assert(!repairReadiness(wrong,context).startReady);
  }
});
test('company RETURN after CSR approval exposes only its refurbishment workflow, never generic customer repair start',()=>{
  const value=companyItem();value.status='INSPECTING';
  const actions=nextstep.repairNextStepActions(value,{...context,note:'Actual company handoff'});
  assert(!actions.some(action=>action.name==='start_repair'));
  assert(nextstep.repairWorkflowGate(value,'start_refurbishment',context).ready);
  const customer=item();assert(nextstep.repairNextStepActions(customer,{...context,note:'Actual customer handoff'}).some(action=>action.name==='start_repair'&&!action.disabled));
});
test('old REFURBISHING status and passing QC cannot substitute for server current work-start evidence',()=>{
  const value=companyItem();assert(model.repairReportReady(value));assert(!repairReadiness(value,context).completionReady);
  for(const workStart of [undefined,{state:'UNKNOWN',reason:'UNAVAILABLE'},{state:'BLOCKED',reason:'OLD_REVISION'}]){
    value.repairPrerequisites.workStart=workStart;value.repairWorkflow.workStart={schema:'corely.repair.work-start.v1',kind:'REFURBISHMENT',entityId:'company',itemId:'item',inspectionRevision:3,planHash:hash,ownerId:'tech',custodianId:'tech',startedById:'tech',startedAt:'2026-10-13T00:00:00Z'};
    assert(!model.sourceWorkStartCurrent(value));const result=repairReadiness(value,context);assert(!result.completionReady);assert.equal(result.completionChecks.find(check=>check.key==='work_start').ready,false);assert(nextstep.repairNextStepActions(value,{...context,note:'Actual handoff'}).find(action=>action.name==='complete_refurbish').disabled);
  }
  value.repairPrerequisites.workStart={state:'READY',reason:'READY'};value.allowedWorkflowActions=[];assert(model.sourceWorkStartCurrent(value));assert(repairReadiness(value,context).completionReady);assert(!nextstep.repairNextStepActions(value,{...context,note:'Actual handoff'}).some(action=>action.name==='await_customer'));
  value.repairWorkflow.csr.inspectionRevision=2;assert(!model.sourceWorkStartCurrent(value));assert(!repairReadiness(value,context).completionReady);
});
