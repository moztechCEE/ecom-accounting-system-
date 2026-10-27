import assert from 'node:assert/strict';
import test from 'node:test';
import { precheckValidation, precheckValues, precheckSupplementInput, receivingPrecheckStageLabel, type PrecheckRead } from '../src/pages/mailroom/initial-inspection-model.ts';
import { mailroomDraftFingerprint } from '../src/pages/mailroom/mailroom-draft.ts';
import { canOpenPrecheck } from '../src/pages/mailroom/mailroom-workflow.ts';
import type { Item } from '../src/pages/mailroom/model.ts';
const record = { itemId:'one', itemVersion:7, label:'MR-1', category:'REPAIR', stage:'DRAFT', document:{revision:2,status:'DRAFT',identityHash:'identity',templateBinding:{id:'template',revision:1,contentHash:'hash'},checks:[{key:'power',result:'NOT_TESTED'}],evidence:[],notRequiredReason:null,savedById:'clerk',savedByName:'收發人員',savedAt:'2026-10-16T00:00:00Z'},template:{state:'CONFIGURED',template:{id:'template',revision:1,contentHash:'hash',checks:[{key:'power',label:'開機',required:true},{key:'optional',label:'選測',required:false}]},reason:null},capabilities:{canStart:false,canSave:true,canMarkReady:true,canHandoff:false,reason:null},custody:{custodianId:'clerk',location:'A1',storageLocationId:'bin'} } as PrecheckRead;
test('completed items without a document describe missing history without restarting their workflow',()=>{
  for (const status of ['WAITING_RETURN_ACCEPTANCE','READY_FOR_DISPATCH','DISPATCHED','PENDING_WELFARE_STOCK','STOCKED']) assert.equal(receivingPrecheckStageLabel('NOT_STARTED',status),'未留初檢紀錄');
  assert.equal(receivingPrecheckStageLabel('NOT_STARTED','RECEIVED'),'待初檢');
  assert.equal(receivingPrecheckStageLabel('SUBMITTED','READY_FOR_DISPATCH'),'已交維修部門');
});
test('saved drafts preserve results and initialize only new checks as untested',()=>{
  const before=JSON.stringify(record),values=precheckValues(record);
  assert.deepEqual(values.checks.map(check=>check.result),['NOT_TESTED','NOT_TESTED']);
  assert.equal(precheckValidation(record,values,false),undefined);
  assert.equal(precheckValidation(record,values,true),'必要初檢項目尚未完成，可先儲存草稿');
  values.checks[0].result='NORMAL';assert.equal(precheckValidation(record,values,true),undefined);
  assert.equal(JSON.stringify(record),before);
});
test('legacy drafts stay unreviewed and supplementary draft edits participate in the discard fingerprint',()=>{
  const values=precheckValues(record),before=mailroomDraftFingerprint(values);
  assert.deepEqual(precheckSupplementInput(values),{warrantyReview:null,mailroomIssue:null});
  assert.equal(values.warrantyReview?.status,undefined);
  values.warrantyReview!.note='購買憑證日期不清楚';
  assert.notEqual(mailroomDraftFingerprint(values),before);
  assert.equal(precheckValidation(record,values,false),'請選擇保固核對狀態');
  values.warrantyReview!.status='NEEDS_CORRECTION';
  assert.equal(precheckValidation(record,values,false),undefined);
  assert.deepEqual(precheckSupplementInput(values),{warrantyReview:{status:'NEEDS_CORRECTION',note:'購買憑證日期不清楚',warrantyNumber:null},mailroomIssue:null});
  values.mailroomIssue!.symptom=' USB-C 不輸出 ';values.mailroomIssue!.preliminaryReason=' 線路待確認 ';
  assert.deepEqual(precheckSupplementInput(values).mailroomIssue,{symptom:'USB-C 不輸出',preliminaryReason:'線路待確認'});
  values.warrantyReview={};values.mailroomIssue={symptom:' ',preliminaryReason:''};
  assert.deepEqual(precheckSupplementInput(values),{warrantyReview:null,mailroomIssue:null});
});
test('supplement readback retains recorded values but never sends server audit fields',()=>{
  const saved={...record,document:{...record.document!,warrantyReview:{schema:1 as const,method:'MANUAL_EXTERNAL' as const,status:'CORRECTED_EXTERNALLY' as const,note:'已核對購買日期',recordedById:'clerk',recordedByName:'收發人員',recordedAt:'2026-10-27T00:00:00Z'},mailroomIssue:{schema:1 as const,symptom:'充電無反應',preliminaryReason:null}}};
  const before=JSON.stringify(saved),values=precheckValues(saved);
  assert.deepEqual(precheckSupplementInput(values),{warrantyReview:{status:'CORRECTED_EXTERNALLY',note:'已核對購買日期',warrantyNumber:null},mailroomIssue:{symptom:'充電無反應',preliminaryReason:null}});
  assert.equal(JSON.stringify(saved),before);
  assert.notEqual(mailroomDraftFingerprint(values),mailroomDraftFingerprint({...values,mailroomIssue:{...values.mailroomIssue,preliminaryReason:'待進一步檢測'}}));
});
test('abnormal drafts remain editable while ready requires a note and photo from this document',()=>{
  const values=precheckValues(record);values.checks[0]={key:'power',result:'ABNORMAL'};
  assert.equal(precheckValidation(record,values,false),undefined);
  assert.match(precheckValidation(record,values,true)!,/異常/);
  values.checks[0].note='不開機';assert.match(precheckValidation(record,values,true)!,/照片/);
  values.evidence=['data:image/png;base64,AAAA'];values.checks[0].evidenceIndexes=[1];assert.match(precheckValidation(record,values,true)!,/照片/);
  values.checks[0].evidenceIndexes=[0];assert.equal(precheckValidation(record,values,true),undefined);
});
test('not applicable needs an explicit reason; unconfigured and unbound products remain distinct',()=>{
  const values=precheckValues(record);values.checks[0]={key:'power',result:'NOT_APPLICABLE'};
  assert.equal(precheckValidation(record,values,false),undefined);assert.match(precheckValidation(record,values,true)!,/不適用原因/);values.checks[0].note='此實物無電源開關';assert.equal(precheckValidation(record,values,true),undefined);
  const unconfigured={...record,template:{state:'UNCONFIGURED' as const,template:null,reason:'未設項目'}};
  assert.equal(precheckValidation(unconfigured,{checks:[],evidence:[]},true),'請填寫不需初檢原因');
  assert.equal(precheckValidation(unconfigured,{checks:[],evidence:[],notRequiredReason:'封裝配件無需功能測試'},true),undefined);
  const unbound={...record,template:{state:'PRODUCT_UNBOUND' as const,template:null,reason:'請先核對產品主檔'}};
  assert.equal(precheckValidation(unbound,{checks:[],evidence:[],notRequiredReason:'不能豁免'},true),'請先核對產品主檔');
});
test('precheck entry requires saved case identity, mailroom custody and receiving stage; return drafts stay eligible',()=>{
  const item={status:'RECEIVED',physicalCustody:'MAILROOM',receipt:{category:'REPAIR',sourceCaseId:'source'}} as Item;
  assert.equal(canOpenPrecheck(item),true);assert.equal(canOpenPrecheck({...item,receipt:{...item.receipt,category:'RETURN'}}),true);
  for(const changed of [{...item,status:'WAITING_REPAIR_ACCEPTANCE'},{...item,physicalCustody:'TECHNICIAN' as const},{...item,receipt:{...item.receipt,sourceCaseId:null}},{...item,receipt:{...item.receipt,category:'UNMATCHED'}},{...item,receipt:{...item.receipt,category:'LETTER'}}])assert.equal(canOpenPrecheck(changed),false);
});

test('handoff requires authoritative ready repair document hashes and server custody capability', async()=>{
  const {precheckHandoffBlocker}=await import('../src/pages/mailroom/initial-inspection-model.ts');
  const ready={...record,stage:'READY',document:{...record.document!,status:'READY' as const,identityHash:'a'.repeat(64),contentHash:'b'.repeat(64)},capabilities:{...record.capabilities,canHandoff:true}};
  const before=JSON.stringify(ready);assert.equal(precheckHandoffBlocker([ready]),undefined);
  assert.match(precheckHandoffBlocker([{...ready,category:'RETURN'}])!,/退貨/);
  assert.match(precheckHandoffBlocker([{...ready,document:{...ready.document,status:'DRAFT'}}])!,/完成初檢/);
  assert.match(precheckHandoffBlocker([{...ready,document:{...ready.document,contentHash:undefined}}])!,/重新讀取/);
  assert.match(precheckHandoffBlocker([{...ready,capabilities:{...ready.capabilities,canHandoff:false,reason:'請由目前保管人操作'}}])!,/目前保管人/);
  const submitted={...ready,document:{...ready.document,status:'SUBMITTED' as const}};
  assert.equal(precheckHandoffBlocker([submitted,ready]),undefined);assert.match(precheckHandoffBlocker([submitted])!,/沒有待交辦/);
  assert.equal(JSON.stringify(ready),before);
});
