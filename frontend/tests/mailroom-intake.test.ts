import assert from 'node:assert/strict';
import test from 'node:test';
import { hasIntakeAction, intakeBindPayload, intakeSourceEntry, intakeReturnEntry } from '../src/pages/mailroom/intake-actions.ts';
import type { Item, Source } from '../src/pages/mailroom/model.ts';
const item = { id: 'synthetic-native', version: 4, status: 'RECEIVED', custodianId: 'clerk', custodianName: '合成收發', location: '合成實物位置', receipt: { category: 'UNMATCHED', sourceCaseId: null }, allowedIntakeActions: ['send_intake', 'claim_intake', 'bind_intake'], caseIntake: {status:'ACCEPTED',ownerId:'csr',sentToUserId:'csr'} } as Item;
const source = { id:'synthetic-source',number:'SYNTHETIC',type:'REPAIR',version:'2026-10-06T12:00:00.000Z',items:[{id:'synthetic-line',quantity:2,remainingQuantity:1}] } as Source;
test('backend action, actor and intake stage all required; physical possession alone cannot bind',()=>{
  assert(hasIntakeAction(item,'bind_intake','csr'));
  assert(!hasIntakeAction(item,'bind_intake','clerk'));
  assert(!hasIntakeAction({...item,allowedIntakeActions:[]},'bind_intake','csr'));
  assert(!hasIntakeAction({...item,caseIntake:{...item.caseIntake!,status:'SENT'}},'bind_intake','csr'));
  assert(!hasIntakeAction({...item,receipt:{...item.receipt,sourceCaseId:'already-bound'}},'bind_intake','csr'));
});
test('designated CSR must claim before binding; clerk sends only unbound undecided intake',()=>{
  const sent={...item,caseIntake:{...item.caseIntake!,status:'SENT' as const}};
  assert(hasIntakeAction(sent,'claim_intake','csr'));assert(!hasIntakeAction(sent,'claim_intake','other'));
  assert(!hasIntakeAction(item,'send_intake','clerk'));assert(hasIntakeAction(sent,'send_intake','clerk'));
  assert(hasIntakeAction({...item,caseIntake:null},'send_intake','clerk'));
  assert(!hasIntakeAction({...item,caseIntake:null},'send_intake','csr'));
});
test('bind carries selected source version and native version without changing custody or creating a case',()=>{
  const before=JSON.stringify(item),body=intakeBindPayload(item,source,'synthetic-line','synthetic-company','csr',' 核對實物 ');
  assert.equal(body.sourceVersion,source.version);assert.equal(body.expectedVersion,4);assert.equal(body.sourceItemId,'synthetic-line');assert.equal(body.targetCategory,'REPAIR');assert.equal(body.note,'核對實物');
  assert.equal(JSON.stringify(item),before);assert.equal('custodianId' in body,false);assert.equal('nextUserId' in body,false);assert.equal('location' in body,false);
});
test('stale or unsupported source, exhausted line and missing evidence do not produce a bind command',()=>{
  for(const s of [{...source,version:undefined},{...source,type:'PRIVATE_PURCHASE'},{...source,items:[{...source.items[0],remainingQuantity:0}]},{...source,items:[{...source.items[0],quantity:1.5}]}])assert.throws(()=>intakeBindPayload(item,s,'synthetic-line','synthetic-company','csr','核對'));
  assert.throws(()=>intakeBindPayload(item,source,'wrong-line','synthetic-company','csr','核對'));
  assert.throws(()=>intakeBindPayload(item,source,'synthetic-line','synthetic-company','csr',' '));
});
test('Source entry and return preserve original native ID without bypassing original Source case form',()=>{
  const entry=new URL(intakeSourceEntry('company','native'), 'https://synthetic.invalid'),back=new URL(intakeReturnEntry('company','native'),'https://synthetic.invalid');
  assert.equal(entry.pathname,'/operations/after-sales/cases');assert.equal(back.pathname,'/operations/after-sales/workbench');assert.equal(entry.searchParams.get('intakeItemId'),'native');assert.equal(back.searchParams.get('intakeItemId'),'native');
});

test('unknown response is acknowledged by request and exact bound case/line, not merely any resolved state', async () => {
  const { matchesIntakeReceipt } = await import('../src/pages/mailroom/intake-actions.ts');
  const command={requestId:'synthetic-request',action:'bind_intake' as const,expectedVersion:4,sourceCaseId:'synthetic-source',sourceItemId:'synthetic-line'};
  const bound={...item,version:5,receipt:{...item.receipt,sourceCaseId:'synthetic-source'},caseIntake:{...item.caseIntake!,status:'RESOLVED' as const,lastAction:'bind_intake' as const,lastRequestId:'synthetic-request',sourceCaseId:'synthetic-source',sourceItemId:'synthetic-line'}};
  assert(matchesIntakeReceipt(bound,command,'csr'));
  for(const changed of [{...bound,version:4},{...bound,caseIntake:{...bound.caseIntake,lastRequestId:'other'}},{...bound,caseIntake:{...bound.caseIntake,sourceItemId:'other'}},{...bound,caseIntake:{...bound.caseIntake,ownerId:'other'}}])assert(!matchesIntakeReceipt(changed,command,'csr'));
  assert(!matchesIntakeReceipt(bound,{...command,sourceCaseId:'different'},'csr'));
});
