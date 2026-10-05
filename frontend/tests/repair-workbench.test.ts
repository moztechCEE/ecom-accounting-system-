import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectionReviewCurrent, repairStartReady, repairReportReady, workflowActionAllowed } from '../src/pages/repair/repair-model.ts'
import type { InspectionData, RepairDocument, RepairItem } from '../src/pages/repair/repair-model.ts'
import { canAccessRoute } from '../src/utils/access-preview.ts'
import type { User } from '../src/types/index.ts'

const inspection: RepairDocument<InspectionData> = {
  number: 'INS-FIXTURE', revision: 3, status: 'SUBMITTED', authorId: 'fixture-tech', authorName: '維修師',
  updatedAt: '2026-10-02T01:00:00Z',
  review: { inspectionRevision: 3, actorId: 'fixture-csr', name: '承辦客服', confirmedAt: '2026-10-02T02:00:00Z', decision:'APPROVE', planHash:'fixture-plan-hash',quoteRevision:4 },
  data: { complaint: '合成故障', reproduction: 'YES', testConditions: '合成測試', checks: [], diagnosis: '合成診斷', causeStatus: 'CONFIRMED', plan: 'REPAIR', planNote: '原機處理', feeSuggestion: 'FREE', estimateNote: '' },
}
const item = { status: 'INSPECTING', receipt: { category: 'REPAIR' }, repairInspection: inspection, repairWorkflow:{csr:{status:'RESOLVED',inspectionRevision:3,estimateRevision:3,quoteRevision:4,planHash:'fixture-plan-hash',decision:'APPROVE'}}, release: { available: true, repairAllowed: true, releaseInfo:{quoteRevision:4,customerApprovedQuoteRevision:4,customerApprovedAt:'2026-10-05T01:00:00Z',amount:0,currency:'TWD',confirmedPaymentQuoteRevision:null} } } as RepairItem

test('CSR confirmation applies only to the current submitted inspection revision', () => {
  assert(inspectionReviewCurrent(inspection))
  assert(!inspectionReviewCurrent({ ...inspection, revision: 4 }))
  assert(!inspectionReviewCurrent({ ...inspection, status: 'DRAFT' }))
  assert(!inspectionReviewCurrent({ ...inspection, review: undefined }))
  assert(!inspectionReviewCurrent(null))
})

test('free, paid and review suggestions all require current CSR confirmation plus independent source release', () => {
  for (const feeSuggestion of ['FREE', 'PAID', 'REVIEW'] as const) {
    const current = { ...inspection, data: { ...inspection.data, feeSuggestion } }
    assert(repairStartReady({ ...item, repairInspection: current }))
    assert(!repairStartReady({ ...item, repairInspection: { ...current, review: undefined } }))
    assert(!repairStartReady({ ...item, repairInspection: { ...current, revision: 4 } }))
    assert(!repairStartReady({ ...item, repairInspection: current, release: { available: true, repairAllowed: false } }))
    assert(!repairStartReady({ ...item, repairInspection: current, release: { available: false, repairAllowed: true } }))
  }
  assert(!repairStartReady({ ...item, status: 'WAITING_CUSTOMER' }))
  assert(!repairStartReady({ ...item, receipt: { ...item.receipt, category: 'RETURN' } }))
  for (const plan of ['FACTORY', 'RETURN'] as const) {
    assert(!repairStartReady({ ...item, repairInspection: { ...inspection, data: { ...inspection.data, plan } } }))
  }
})

test('repair document editing does not grant CSR confirmation or customer agreement authority', () => {
  const technician = { roles: ['REPAIR_TECHNICIAN'], permissions: ['repair_workbench:read', 'repair_workbench:update'] } as User
  const customerService = { roles: ['CUSTOMER_SERVICE'], permissions: ['mailroom:read', 'mailroom:review'] } as User
  assert(canAccessRoute(technician, ['repair_workbench:update']))
  assert(!canAccessRoute(technician, ['mailroom:review']))
  assert(!canAccessRoute(technician, ['after_sales_cases:update']))
  assert(canAccessRoute(customerService, ['mailroom:review']))
  assert(!canAccessRoute(customerService, ['repair_workbench:update']))
})

test('original return and factory dispatch never masquerade as repair completion', () => {
  const base={...item,repairReport:{number:'REP-FIXTURE',revision:1,status:'SUBMITTED',authorId:'fixture-tech',authorName:'維修師',updatedAt:'2026-10-05T01:00:00Z',inspectionRevision:3,data:{outcome:'FACTORY_REPAIRED',factoryReference:'FACT-QA-1',workPerformed:'原廠處理憑據',parts:[],laborMinutes:0,checks:[{name:'安全及功能複驗',result:'PASS',observation:'合成合格'}],qcResult:'PASS',qcNotes:'本人複驗',deliveredAccessories:'原配件'}}} as RepairItem;
  assert(!repairReportReady({...base,repairInspection:{...inspection,data:{...inspection.data,plan:'RETURN'}}}));
  const factory={...base,repairInspection:{...inspection,data:{...inspection.data,plan:'FACTORY'}},repairWorkflow:{factory:{stage:'RETURNED',physicalCustody:'TECHNICIAN',reference:'FACT-QA-1'}}} as RepairItem;
  assert(repairReportReady(factory));
  for(const stage of ['SENT','ACCEPTED','RETURNING'])assert(!repairReportReady({...factory,repairWorkflow:{factory:{...factory.repairWorkflow!.factory!,stage}}}));
  assert(!repairReportReady({...factory,repairWorkflow:{factory:{...factory.repairWorkflow!.factory!,physicalCustody:'FACTORY'}}}));
  assert(!repairReportReady({...factory,repairReport:{...factory.repairReport!,data:{...factory.repairReport!.data,factoryReference:'OTHER'}}}));
  assert(!repairReportReady({...factory,repairReport:{...factory.repairReport!,inspectionRevision:2}}));
  assert(!repairReportReady({...factory,repairReport:{...factory.repairReport!,data:{...factory.repairReport!.data,checks:[{name:'功能',result:'FAIL',observation:'異常'}]}}}));
});
test('new workflow commands are unavailable when server does not explicitly grant this item action',()=>{
  assert(!workflowActionAllowed(item,'return_original'));
  assert(workflowActionAllowed({...item,allowedWorkflowActions:['return_original']},'return_original'));
  assert(!workflowActionAllowed({...item,allowedWorkflowActions:['return_original']},'send_factory'));
});


test('departmental acceptance, decision, plan hash and actual source quote revision remain separate release gates', () => {
  const csr=item.repairWorkflow!.csr!;
  for (const status of ['SENT','ACCEPTED'] as const) assert(!repairStartReady({...item,repairWorkflow:{csr:{...csr,status}}}));
  assert(!repairStartReady({...item,repairWorkflow:{csr:{...csr,decision:'DECLINE'}}}));
  assert(!repairStartReady({...item,repairInspection:{...inspection,review:{...inspection.review!,decision:'DECLINE'}}}));
  for (const patch of [{inspectionRevision:2},{estimateRevision:2},{quoteRevision:3},{planHash:'another-plan'}]) {
    assert(!repairStartReady({...item,repairWorkflow:{csr:{...csr,...patch}}}));
  }
  // FREE retains an accepted real quote revision; the inspection number is not that revision.
  assert(!repairStartReady({...item,repairInspection:{...inspection,review:{...inspection.review!,quoteRevision:null}},repairWorkflow:{csr:{...csr,quoteRevision:null}}}));
  assert(repairStartReady(item));
});

test('replacement completion must match the submitted SKU and truthful product condition', () => {
  const replacement={...item,repairInspection:{...inspection,data:{...inspection.data,plan:'REPLACE',replacementSku:'SYNTHETIC-SKU',replacementCondition:'REFURBISHED'}},repairReport:{number:'REP-SYNTHETIC',revision:1,status:'SUBMITTED',authorId:'fixture-tech',authorName:'維修師',updatedAt:'2026-10-05T01:00:00Z',inspectionRevision:3,data:{outcome:'REPLACED',replacementSku:'SYNTHETIC-SKU',replacementCondition:'REFURBISHED',workPerformed:'合格實物替換',parts:[],laborMinutes:0,checks:[{name:'安全功能',result:'PASS',observation:'合成合格'}],qcResult:'PASS',qcNotes:'本人複驗',deliveredAccessories:'原配件'}}} as RepairItem;
  assert(repairReportReady(replacement));
  assert(!repairReportReady({...replacement,repairReport:{...replacement.repairReport!,data:{...replacement.repairReport!.data,replacementSku:'OTHER-SKU'}}}));
  assert(!repairReportReady({...replacement,repairReport:{...replacement.repairReport!,data:{...replacement.repairReport!.data,replacementCondition:'NEW'}}}));
});


test('fresh source consent and payment revisions can invalidate an otherwise current CSR result', () => {
  const release=item.release!, info=release.releaseInfo!;
  assert(!repairStartReady({...item,release:{...release,releaseInfo:null}}));
  for (const patch of [{quoteRevision:5,customerApprovedQuoteRevision:5},{customerApprovedQuoteRevision:3},{customerApprovedAt:null},{customerApprovedAt:'not-a-date'},{amount:null},{amount:-1},{amount:399,confirmedPaymentQuoteRevision:null},{amount:399,confirmedPaymentQuoteRevision:3}]) {
    assert(!repairStartReady({...item,release:{...release,releaseInfo:{...info,...patch}}}));
  }
  assert(repairStartReady({...item,release:{...release,releaseInfo:{...info,amount:399,confirmedPaymentQuoteRevision:4}}}));
});
