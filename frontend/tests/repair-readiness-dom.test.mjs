import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RepairReadinessPanel from '/src/pages/repair/RepairReadinessPanel.tsx';
import {repairReadiness} from '/src/pages/repair/repair-readiness.ts';
import {repairCaseProgress} from '/src/pages/repair/repair-list-model.ts';
import '/src/pages/repair/repair.css';
const e = React.createElement;
const planHash='a'.repeat(64),proposalHash='b'.repeat(64),templateHash='c'.repeat(64);
const base = {
  id:'synthetic-readiness',entityId:'fixture-company',productId:'fixture-product',sku:'SYNTHETIC-SKU',label:'SYNTHETIC',productName:'合成產品',status:'INSPECTING',statusLabel:'檢測中',version:1,
  editable:true,repairOwnerId:'fixture-tech',custodianId:'fixture-tech',custodianName:'合成維修師',physicalCustody:'TECHNICIAN',
  nextUserId:null,nextUserName:null,location:'合成桌',receipt:{category:'REPAIR',number:'SYNTHETIC',customerServiceUserId:'fixture-csr'},
  repairInspection:{number:'SYNTHETIC-INS',revision:3,status:'SUBMITTED',review:{inspectionRevision:3,decision:'APPROVE',planHash,quoteRevision:4},data:{plan:'REPAIR',protocol:2,
    templateBinding:{id:'fixture-template',revision:1,contentHash:templateHash},materialPlan:{mode:'NONE',lines:[]},
    checks:[{key:'function',name:'合成功能',result:'PASS',observation:'合成通過'}]}},
  repairProposalBinding:{itemId:'synthetic-readiness',planVersion:3,planHash,proposalHash},
  repairPrerequisites:{materials:{start:{state:'READY',requiredCount:0},completion:{state:'READY',requiredCount:0}},
    templateChecks:{inspection:'READY',completion:'READY'},
    template:{id:'fixture-template',entityId:'fixture-company',productId:'fixture-product',sku:'SYNTHETIC-SKU',revision:1,contentHash:templateHash,status:'REVIEWED',
      checks:[{key:'function',name:'合成功能',requiredForInspection:true,requiredForCompletion:true}]}},
  repairWorkflow:{csr:{status:'RESOLVED',ownerName:'合成客服',ownerId:'fixture-csr',acceptedAt:'2026-10-08T01:00:00Z',resolvedAt:'2026-10-08T02:00:00Z',inspectionRevision:3,estimateRevision:3,quoteRevision:4,planHash,decision:'APPROVE'}},
  release:{available:true,repairAllowed:true,message:'合成來源回覆 <script>不執行</script>',releaseInfo:{quoteRevision:4,customerApprovedQuoteRevision:4,customerApprovedAt:'2026-10-08T03:00:00Z',amount:0,currency:'TWD',confirmedPaymentQuoteRevision:null}}
};
base.release.releaseInfo.quoteBindings=[{...base.repairProposalBinding,quoteRevision:4}];
function Harness() {
  const [scenario,setScenario]=useState('ready');
  const item=structuredClone(base);
  if(scenario==='free-pending'){item.release.releaseInfo.customerApprovedAt=null;item.release.releaseInfo.customerApprovedQuoteRevision=null;}
  if(scenario==='paid-pending'){item.release.releaseInfo.amount=399;item.release.releaseInfo.confirmedPaymentQuoteRevision=3;}
  if(scenario==='new-quote'){item.release.releaseInfo.quoteRevision=5;item.release.releaseInfo.customerApprovedQuoteRevision=5;}
  if(scenario==='csr-accepted')item.repairWorkflow.csr.status='ACCEPTED';
  if(scenario==='csr-estimate-stale')item.repairWorkflow.csr.estimateRevision=2;
  if(scenario==='csr-quote-stale')item.repairWorkflow.csr.quoteRevision=3;
  if(scenario==='unknown-amount')item.release.releaseInfo.amount=null;
  if(['paid-ready','invoice-pending','invoice-stale','invoice-unknown'].includes(scenario)){
    Object.assign(item.release.releaseInfo,{amount:399,confirmedPaymentQuoteRevision:4,invoiceRequired:true,invoiceStatus:'ISSUED',invoiceSatisfied:true,invoiceQuoteRevision:4});
    if(scenario==='invoice-pending')Object.assign(item.release.releaseInfo,{invoiceStatus:'PENDING',invoiceSatisfied:false});
    if(scenario==='invoice-stale')item.release.releaseInfo.invoiceQuoteRevision=3;
    if(scenario==='invoice-unknown')delete item.release.releaseInfo.invoiceRequired;
  }
  if(scenario==='source-unknown')item.release={available:false,repairAllowed:false,releaseInfo:null};
  if(scenario==='null-amount-invoice')Object.assign(item.release.releaseInfo,{amount:null,invoiceRequired:true,invoiceStatus:'PENDING',invoiceSatisfied:false,invoiceQuoteRevision:4});
  if(['missing-binding-payment','wrong-binding-payment'].includes(scenario)){
    Object.assign(item.release.releaseInfo,{amount:399,confirmedPaymentQuoteRevision:3,invoiceRequired:false});
    if(scenario==='missing-binding-payment')delete item.repairProposalBinding;
    else item.repairProposalBinding.itemId='another-native-item';
  }
  if(scenario==='disposition-source-unavailable'){
    item.repairInspection.data.plan='RETURN';item.repairInspection.review.decision='DECLINE';item.repairWorkflow.csr.decision='DECLINE';
    item.allowedWorkflowActions=['return_original'];
    item.repairPrerequisites.disposition={returnOriginal:{state:'UNKNOWN',reason:'SOURCE_UNAVAILABLE'},scrapAuthorization:{state:'UNKNOWN',reason:'SOURCE_UNAVAILABLE'},authorization:null};
    item.release={available:false,repairAllowed:false,releaseInfo:null};
  }
  if(scenario==='metadata-absent'){item.repairWorkflow.csr=null;delete item.release.message;}
  if(scenario==='long-evidence'){item.release.repairAllowed=false;item.release.message='合成來源回覆 '+('LONG-SYNTHETIC-NATIVE-REFERENCE-'.repeat(30))+' <script>不執行</script>';}
  if(scenario==='inspection-draft'||scenario==='inspection-submitted'){
    item.repairReport={number:'SYNTHETIC-REP',revision:1,status:scenario==='inspection-draft'?'DRAFT':'SUBMITTED',inspectionRevision:3,
      data:{outcome:'REPAIRED',qcResult:'PASS',checks:[{name:'合成功能',result:'PASS',observation:'合成通過'}]}};
  }
  if(scenario==='factory-reinspection'){
    item.repairInspection.data.plan='FACTORY';item.repairInspection.revision=4;item.repairInspection.review=null;
    item.repairWorkflow.csr=null;item.allowedWorkflowActions=[];
    item.repairWorkflow.factory={stage:'RETURNED',physicalCustody:'TECHNICIAN',reference:'SYNTHETIC-FACTORY'};
    item.repairReport={number:'SYNTHETIC-REP',revision:1,status:'SUBMITTED',inspectionRevision:3,
      data:{outcome:'FACTORY_REPAIRED',factoryReference:'SYNTHETIC-FACTORY',qcResult:'PASS',checks:[{name:'合成功能',result:'PASS',observation:'合成通過'}]}};
  }
  if(scenario==='waiting-mailroom'){item.status='WAITING_RETURN_ACCEPTANCE';item.repairWorkflow.release={purpose:'RETURN_UNREPAIRED'};}
  if(scenario==='dispatched-refusal'){
    item.status='DISPATCHED';item.statusLabel='已交物流寄回，待顧客收件';item.editable=false;
    item.custodianId='fixture-clerk';item.repairInspection.data.plan='RETURN';item.allowedWorkflowActions=[];
  }
  if(scenario==='unclaimed'){item.status='WAITING_REPAIR_ACCEPTANCE';item.repairOwnerId=null;item.editable=false;}
  if(scenario==='refusal'){item.repairInspection.data.plan='RETURN';item.repairWorkflow.csr.decision='DECLINE';}
  if(scenario==='declined-original-plan'){
    item.status='WAITING_CUSTOMER';item.allowedWorkflowActions=['return_original'];
    item.repairWorkflow.csr.decision='DECLINE';item.repairInspection.review.decision='DECLINE';
  }
  if(scenario==='failed-qc'||scenario==='completed-new-quote'||scenario==='completed-ready'){
    item.status='REPAIRING';item.repairReport={number:'SYNTHETIC-REP',revision:1,status:'SUBMITTED',inspectionRevision:3,
      data:{outcome:'REPAIRED',qcResult:'FAIL',qcNotes:'合成異常仍待排除',checks:[{name:'合成功能',result:'NOT_TESTED',observation:'合成設備尚未到位'}]}};
  }
  if(scenario==='completed-new-quote'||scenario==='completed-ready'){
    item.repairReport.data.qcResult='PASS';item.repairReport.data.qcNotes='合成複驗通過';item.repairReport.data.checks[0].result='PASS';
    if(scenario==='completed-new-quote'){item.release.releaseInfo.quoteRevision=5;item.release.releaseInfo.customerApprovedQuoteRevision=5;}
  }
  if(item.repairReport){item.repairReport.data.protocol=2;item.repairReport.data.templateBinding=structuredClone(base.repairInspection.data.templateBinding);
    item.repairReport.data.checks.forEach(check=>{check.key='function';});}
  const canUpdate=scenario!=='readonly';
  window.__readinessFixture={scenario,item,caseProgress:repairCaseProgress(item),readiness:repairReadiness(item,{canUpdate,viewerId:'fixture-tech',handoffNote:'合成交回說明'})};
  return e(React.Fragment,null,
    e('select',{id:'scenario',value:scenario,onChange:event=>setScenario(event.target.value)},
      ['ready','free-pending','paid-pending','new-quote','csr-accepted','csr-estimate-stale','csr-quote-stale','unknown-amount','inspection-draft','inspection-submitted','factory-reinspection','waiting-mailroom','dispatched-refusal','unclaimed','refusal','declined-original-plan','failed-qc','completed-new-quote',
        'paid-ready','invoice-pending','invoice-stale','invoice-unknown','source-unknown','metadata-absent','long-evidence','readonly','completed-ready',
        'null-amount-invoice','missing-binding-payment','wrong-binding-payment','disposition-source-unavailable'].map(value=>e('option',{key:value,value},value))),
    e('div',{id:'panel',className:'repair-editor-sidebar'},e(RepairReadinessPanel,{item,canUpdate,viewerId:'fixture-tech',handoffNote:'合成交回說明',compact:true})));
}
createRoot(document.getElementById('root')).render(e(Harness));
`;

test('actual React panel keeps pending consent, payment, CSR and QC distinct from completed handoff', {
  skip: !executablePath && 'No existing Chromium executable; this test never installs a browser', timeout: 90000,
}, async t => {
  const cacheDir=mkdtempSync(join(tmpdir(),'corely-repair-clean-copy-readiness-'));
  const virtual = '\0repair-readiness-dom-fixture';
  const server = await createServer({ root, cacheDir,configFile: false, server: { host: '127.0.0.1', port: 0,hmr:false }, plugins: [react(), {
    name: 'offline-repair-readiness-test',
    resolveId(id) { if (id === 'virtual:repair-readiness-dom-fixture') return virtual; },
    load(id) { if (id === virtual) return fixture; },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url !== '/__repair-readiness') return next();
        try {
          const html = await vite.transformIndexHtml('/__repair-readiness', '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:16px}#panel{width:296px;max-width:100%;min-width:0}</style></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-readiness-dom-fixture"></script></body></html>');
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    },
  }] });
  t.after(async () => {await server.close();rmSync(cacheDir,{recursive:true,force:true});}); await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], external = [],networkWrites=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request=route.request();const url = new URL(request.url());
    if(!['GET','HEAD'].includes(request.method())){networkWrites.push(request.method()+' '+request.url());return route.abort();}
    if (url.hostname === '127.0.0.1') return route.continue();
    external.push(url.hostname); return route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__repair-readiness`);
  const panel = page.locator('#panel');
  const start=panel.getByRole('region',{name:'開工條件',exact:true});
  const completion=panel.getByRole('region',{name:'交回條件',exact:true});
  const checkKeys={'顧客同意':'customer_consent','客服版次':'csr_versions','客服確認':'csr_decision','款項確認':'payment',
    '報價版本':'source_quote','維修依據版本':'report_revision','逐項複驗':'checks','總複驗':'qc','必要發票':'invoice','本人簽收':'own_signed','維修放行':'source_release',
    '本件方案報價':'proposal_binding','顧客處置授權':'disposition_auth'};
  const row=(region,label)=>region.locator(`details[data-check-key="${checkKeys[label]}"]`);
  const inGroup=async(region,label,ready)=>{
    const check=row(region,label);assert.equal(await check.count(),1,label+': one evidence row');
    assert.equal(await check.getAttribute('data-check-ready'),String(ready),label+': saved gate state');
    assert.equal(await region.locator(ready?'.repair-readiness-complete':'.repair-readiness-pending').locator(`details[data-check-key="${checkKeys[label]}"]`).count(),1,label+': correct pending/complete group');
  };
  const evidence=async(region,label)=>{
    const check=row(region,label),complete=check.locator('xpath=ancestor::details[contains(@class,"repair-readiness-complete")]');
    if(await complete.count() && !await complete.evaluate(node=>node.open))await complete.locator(':scope > summary').click();
    if(!await check.evaluate(node=>node.open))await check.locator(':scope > summary').click();
    const value=check.locator('.repair-readiness-evidence');await value.waitFor({state:'visible'});return value.innerText();
  };
  const status=()=>panel.getByRole('status',{name:'目前進度',exact:true});
  const cleanCopy=async()=>{
    const text=await panel.innerText();
    for(const note of ['以上依目前保存資料與本人作業條件顯示','送出時後端再核對',
      '此處只讀來源確認紀錄，不代替銀行實收或會計對帳','保存新檢修版本後須重新核對客服與維修單',
      '免費方案也須有本報價版顧客同意','依下方缺口取得當版客服結果','此面板不改共同狀態'])
      assert(!text.includes(note),'general explanation is not rendered as operating copy: '+note);
    assert.equal(await panel.locator('.ant-alert-description').count(),0,'feedback contains only the current concise blocker');
    assert.equal(await panel.locator('.ant-alert-info,.ant-alert-success').count(),0,'no routine readiness information or overall success banner');
    assert.equal(await panel.locator('.ant-tag-blue,.ant-tag-orange').count(),0,'saved gates are grouped without repeated status tags');
    assert(!/尚未可(?:開工|交回)：|等 \d+ 項待確認/.test(text),'progress stays concise instead of listing every gap');
    assert.equal(await panel.locator('input,textarea,select').count(),0,'readiness never becomes an editor');
  };
  const select=async scenario=>{
    await page.locator('#scenario').selectOption(scenario);
    await page.waitForFunction(value=>window.__readinessFixture?.scenario===value,scenario);
    await cleanCopy();
  };
  const saved=()=>page.evaluate(()=>window.__readinessFixture);
  const header=panel.locator('.repair-readiness-compact > .ant-collapse > .ant-collapse-item > .ant-collapse-header');
  await header.waitFor();assert.equal(await header.getAttribute('aria-expanded'),'false');
  await header.focus();await header.press('Enter');await start.waitFor({state:'visible'});
  const completed=start.locator('details.repair-readiness-complete');
  assert.equal(await completed.evaluate(node=>node.open),false,'already-met conditions start collapsed');
  assert.match((await completed.locator(':scope > summary').innerText()).trim(),/^已符合\s+13$/);
  await completed.locator(':scope > summary').focus();await completed.locator(':scope > summary').press('Enter');
  assert.equal(await completed.evaluate(node=>node.open),true,'completed group expands from the keyboard');
  const consentSummary=row(start,'顧客同意').locator(':scope > summary');
  assert.equal((await consentSummary.innerText()).trim(),'顧客同意','row summary only names the condition');
  await consentSummary.focus();await consentSummary.press('Space');
  assert.equal(await row(start,'顧客同意').evaluate(node=>node.open),true,'evidence expands from the keyboard');
  await inGroup(start,'顧客同意',true);assert.equal(await evidence(start,'顧客同意'),'已同意 v4');
  await inGroup(start,'客服版次',true);assert.equal(await evidence(start,'客服版次'),'檢修 v3');
  assert.equal(await start.locator('.repair-readiness-pending').count(),0);
  assert.equal((await saved()).readiness.startReady,true);
  await cleanCopy();
  assert.equal(Math.round((await panel.boundingBox()).width),296,'desktop uses the real 296px sidebar width');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Desktop has no horizontal overflow');
  await page.screenshot({ path: '/tmp/corely-repair-readiness-layout-20261029-desktop.png', fullPage: true });
  assert.match(await panel.innerText(), /合成來源回覆 <script>不執行<\/script>/);
  assert.equal(await panel.locator('script').count(), 0, 'Source feedback is rendered as escaped text');
  for (const scenario of ['inspection-draft', 'inspection-submitted']) {
    await select(scenario);
    assert.match(await panel.innerText(), /原機維修/);
    assert.equal(await start.count(),1);assert.equal(await completion.count(),0);
    assert.equal((await saved()).readiness.startReady,true);
    assert.equal(await panel.locator('.ant-alert').count(),0);
  }
  await select('factory-reinspection');
  await status().waitFor();
  assert.equal(await evidence(completion,'客服確認'),'尚未交辦');
  assert.equal(await evidence(completion,'維修依據版本'),'目前檢修 v4／維修依據 v3');
  assert.match(await panel.innerText(),/原廠維修/);
  assert.equal((await saved()).readiness.completionReady,false);
  await inGroup(completion,'維修依據版本',false);
  for (const [scenario, label,expected] of [
    ['free-pending','顧客同意','待同意報價 v4'], ['paid-pending','款項確認','TWD 399 · 待確認報價 v4 款項'],
    ['new-quote','報價版本','報價 v5／客服確認 v4'], ['csr-accepted','客服確認','客服已本人接手'],
    ['csr-estimate-stale','客服版次','估價依據 v2／目前檢修 v3'],
    ['csr-quote-stale','客服版次','客服報價 v3／方案報價 v4'],
    ['unknown-amount','款項確認','金額未確認'],
  ]) {
    await select(scenario);
    await status().waitFor();
    assert.equal(await evidence(start,label),expected,`${scenario} retains its exact saved evidence`);
    await inGroup(start,label,false);
    assert.equal((await saved()).readiness.startReady,false);
    assert(!/待開始|已付款|已放行/.test(await status().innerText()),`${scenario} never claims ready or paid`);
  }
  for(const scenario of ['waiting-mailroom','dispatched-refusal','unclaimed','refusal','declined-original-plan']){
    await select(scenario);
    assert.equal(await start.count(),0);assert.equal(await completion.count(),0);
    assert.equal(await panel.locator('.ant-alert').count(),0,'stage is represented by the case status, not routine panel guidance');
    const fixture=await saved();
    assert.equal(fixture.readiness.startReady,false);assert.equal(fixture.readiness.completionReady,false);
    if(scenario==='dispatched-refusal')assert.equal(fixture.readiness.ownSigned,false);
    if(scenario==='declined-original-plan'){
      assert.equal(fixture.item.repairInspection.data.plan,'REPAIR','refusal never rewrites the saved plan');
      assert.deepEqual(fixture.item.allowedWorkflowActions,['return_original']);
    }
  }
  await select('failed-qc');
  await status().waitFor();
  assert.equal(await evidence(completion,'逐項複驗'),'合成功能：未測／待測 · 合成設備尚未到位');
  await inGroup(completion,'逐項複驗',false);await inGroup(completion,'總複驗',false);
  assert.match(await panel.innerText(),/原機維修/);assert.equal((await saved()).readiness.completionReady,false);
  await select('completed-new-quote');
  await status().waitFor();
  assert.equal(await evidence(completion,'逐項複驗'),'合成功能：通過');await inGroup(completion,'逐項複驗',true);
  assert.equal(await evidence(completion,'報價版本'),'報價 v5／客服確認 v4');await inGroup(completion,'報價版本',false);
  assert.equal((await saved()).readiness.completionReady,false);
  await select('completed-ready');
  assert.equal((await saved()).readiness.completionReady,true,'current QC and release still satisfy the native completion predicate');
  assert.equal(await completion.locator('.repair-readiness-pending').count(),0);
  assert.equal(await status().count(),0,'completed saved checks create no routine success banner');
  await select('paid-ready');
  assert.equal(await evidence(start,'款項確認'),'TWD 399 · 已確認');await inGroup(start,'款項確認',true);
  assert.equal(await evidence(start,'必要發票'),'本版發票已開立 · 報價 v4');await inGroup(start,'必要發票',true);
  assert.equal((await saved()).readiness.startReady,true);
  for(const [scenario,expected] of [['invoice-pending','發票 PENDING · 發票報價 v4'],['invoice-stale','發票 ISSUED · 發票報價 v3'],['invoice-unknown','發票需求未確認']]){
    await select(scenario);await inGroup(start,'款項確認',true);await inGroup(start,'必要發票',false);
    assert.equal(await evidence(start,'必要發票'),expected);
    assert.equal((await saved()).readiness.startReady,false,'confirmed payment alone never authorizes repair: '+scenario);
    assert(!/待開始|已放行/.test(await status().innerText()),scenario+': no false ready status');
  }
  await select('source-unknown');
  assert.equal((await status().locator('strong').innerText()).trim(),'放行資料待確認');
  for(const label of ['顧客同意','款項確認','必要發票'])await inGroup(start,label,false);
  assert.equal(await evidence(start,'款項確認'),'金額未確認');
  assert.equal((await saved()).readiness.startReady,false);
  assert(!/已付款|已放行|待開始/.test(await status().innerText()));
  await select('null-amount-invoice');
  assert.equal((await saved()).caseProgress,'等待發票完成','the broader case projection reproduces the premature invoice counterexample');
  await inGroup(start,'款項確認',false);await inGroup(start,'必要發票',false);
  assert.equal(await evidence(start,'款項確認'),'金額未確認');
  assert.equal((await status().locator('strong').innerText()).trim(),'款項待確認','unknown amount must be resolved before invoice progress');
  assert(!/等待發票|發票待確認|已付款|待開始/.test(await status().innerText()));
  assert.equal((await saved()).readiness.startReady,false);
  for(const scenario of ['missing-binding-payment','wrong-binding-payment']){
    await select(scenario);
    assert.equal((await saved()).caseProgress,'等待款項確認','the broader case projection reproduces the unbound-payment counterexample');
    await inGroup(start,'本件方案報價',false);await inGroup(start,'款項確認',false);
    assert.equal(await evidence(start,'本件方案報價'),'本件方案尚未綁定目前報價');
    assert.equal(await evidence(start,'款項確認'),'TWD 399 · 待確認報價 v4 款項');
    assert.equal((await status().locator('strong').innerText()).trim(),'方案報價待核對','binding integrity precedes payment progress: '+scenario);
    assert(!/等待款項確認|款項待確認|待開始/.test(await status().innerText()));
    assert.equal((await saved()).readiness.startReady,false);
  }
  await select('disposition-source-unavailable');
  const disposition=panel.getByRole('region',{name:'原件處置核對',exact:true});
  const dispositionState=(await saved()).readiness;
  assert.equal(dispositionState.showDisposition,true);assert.equal(dispositionState.dispositionReady,false);
  assert.deepEqual(dispositionState.dispositionChecks.filter(check=>!check.ready).map(check=>check.key),['disposition_auth'],'current CSR and custody remain valid; only disposition authorization is unknown');
  assert.equal((await saved()).item.release.available,false);
  await inGroup(disposition,'顧客處置授權',false);
  assert.equal(await evidence(disposition,'顧客處置授權'),'處置授權暫無法取得');
  assert.equal((await status().locator('strong').innerText()).trim(),'顧客處置授權待確認','repair release unavailability cannot replace disposition authorization status');
  assert(!/放行資料|維修放行|待開始/.test(await status().innerText()));
  assert.equal(dispositionState.startReady,false);assert.equal(dispositionState.completionReady,false);
  await select('readonly');
  await inGroup(start,'本人簽收',false);assert.equal(await evidence(start,'本人簽收'),'未符合本人簽收條件');
  assert.equal((await saved()).readiness.ownSigned,false);assert.equal((await saved()).readiness.startReady,false);
  assert.equal(await status().count(),0,'readonly does not grant an actionable progress state');
  await select('metadata-absent');
  assert.equal(await panel.locator('.repair-readiness-records').count(),0,'missing CSR/source/outcome create no placeholder records');
  assert.equal(await panel.locator('button').count(), 0, 'The panel exposes evidence without creating new action authority');
  await select('long-evidence');
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:844});
    await evidence(start,'維修放行');
    const dimensions=await panel.evaluate(element=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,
      panelWidth:element.clientWidth,panelScroll:element.scrollWidth,
      evidence:[...element.querySelectorAll('.repair-readiness-evidence,.repair-readiness-records dd')].map(node=>({client:node.clientWidth,scroll:node.scrollWidth}))}));
    assert(dimensions.documentWidth<=width,'open evidence fits viewport: '+JSON.stringify(dimensions));
    assert(dimensions.panelScroll<=dimensions.panelWidth+1,'open evidence fits original sidebar: '+JSON.stringify(dimensions));
    assert(dimensions.evidence.every(value=>value.scroll<=value.client+1),'evidence wraps without hiding its text: '+JSON.stringify(dimensions));
    const source=(await saved()).item.release.message;
    assert.equal(await row(start,'維修放行').locator('.repair-readiness-evidence').innerText(),source);
    assert.equal(await panel.locator('.repair-readiness-records dd').last().innerText(),source,'metadata retains the full source response');
    assert.equal(await panel.locator('script').count(),0,'long source response remains escaped');
    await page.screenshot({path:`/tmp/corely-repair-readiness-layout-20261029-evidence-${width}.png`,fullPage:true});
  }
  await select('free-pending');assert.equal((await status().locator('strong').innerText()).trim(),'等待顧客確認');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile has no horizontal overflow');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);assert.deepEqual(networkWrites,[]);
});
