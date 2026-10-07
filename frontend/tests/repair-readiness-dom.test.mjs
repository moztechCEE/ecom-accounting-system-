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
const e = React.createElement;
const base = {
  id:'synthetic-readiness',label:'SYNTHETIC',productName:'合成產品',status:'INSPECTING',statusLabel:'檢測中',version:1,
  editable:true,repairOwnerId:'fixture-tech',custodianId:'fixture-tech',custodianName:'合成維修師',physicalCustody:'TECHNICIAN',
  nextUserId:null,nextUserName:null,location:'合成桌',receipt:{category:'REPAIR',number:'SYNTHETIC',customerServiceUserId:'fixture-csr'},
  repairInspection:{number:'SYNTHETIC-INS',revision:3,status:'SUBMITTED',review:{inspectionRevision:3,decision:'APPROVE',planHash:'synthetic-plan',quoteRevision:4},data:{plan:'REPAIR'}},
  repairWorkflow:{csr:{status:'RESOLVED',ownerName:'合成客服',ownerId:'fixture-csr',acceptedAt:'2026-10-08T01:00:00Z',resolvedAt:'2026-10-08T02:00:00Z',inspectionRevision:3,estimateRevision:3,quoteRevision:4,planHash:'synthetic-plan',decision:'APPROVE'}},
  release:{available:true,repairAllowed:true,message:'合成來源回覆 <script>不執行</script>',releaseInfo:{quoteRevision:4,customerApprovedQuoteRevision:4,customerApprovedAt:'2026-10-08T03:00:00Z',amount:0,currency:'TWD',confirmedPaymentQuoteRevision:null}}
};
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
  if(scenario==='failed-qc'||scenario==='completed-new-quote'){
    item.status='REPAIRING';item.repairReport={number:'SYNTHETIC-REP',revision:1,status:'SUBMITTED',inspectionRevision:3,
      data:{outcome:'REPAIRED',qcResult:'FAIL',qcNotes:'合成異常仍待排除',checks:[{name:'合成功能',result:'NOT_TESTED',observation:'合成設備尚未到位'}]}};
  }
  if(scenario==='completed-new-quote'){
    item.repairReport.data.qcResult='PASS';item.repairReport.data.qcNotes='合成複驗通過';item.repairReport.data.checks[0].result='PASS';
    item.release.releaseInfo.quoteRevision=5;item.release.releaseInfo.customerApprovedQuoteRevision=5;
  }
  window.__readinessFixture={scenario,item,readiness:repairReadiness(item,{canUpdate:true,viewerId:'fixture-tech',handoffNote:'合成交回說明'})};
  return e(React.Fragment,null,
    e('select',{id:'scenario',value:scenario,onChange:event=>setScenario(event.target.value)},
      ['ready','free-pending','paid-pending','new-quote','csr-accepted','csr-estimate-stale','csr-quote-stale','unknown-amount','inspection-draft','inspection-submitted','factory-reinspection','waiting-mailroom','dispatched-refusal','unclaimed','refusal','declined-original-plan','failed-qc','completed-new-quote'].map(value=>e('option',{key:value,value},value))),
    e('div',{id:'panel'},e(RepairReadinessPanel,{item,canUpdate:true,viewerId:'fixture-tech',handoffNote:'合成交回說明'})));
}
createRoot(document.getElementById('root')).render(e(Harness));
`;

test('actual React panel keeps pending consent, payment, CSR and QC distinct from completed handoff', {
  skip: !executablePath && 'No existing Chromium executable; this test never installs a browser', timeout: 60000,
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
          const html = await vite.transformIndexHtml('/__repair-readiness', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:repair-readiness-dom-fixture"></script></body></html>');
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
  const row=(region,label)=>region.locator('.ant-descriptions-item-label').filter({hasText:new RegExp('^'+label+'$')}).locator('xpath=ancestor::tr');
  const cleanCopy=async()=>{
    const text=await panel.innerText();
    for(const note of ['以上依目前保存資料與本人作業條件顯示','送出時後端再核對',
      '此處只讀來源確認紀錄，不代替銀行實收或會計對帳','保存新檢修版本後須重新核對客服與維修單',
      '免費方案也須有本報價版顧客同意','依下方缺口取得當版客服結果','此面板不改共同狀態'])
      assert(!text.includes(note),'general explanation is not rendered as operating copy: '+note);
    assert.equal(await panel.locator('.ant-alert-description').count(),0,'feedback contains only the current concise blocker');
    assert.equal(await panel.locator('.ant-alert-info,.ant-alert-success').count(),0,'no routine readiness information or overall success banner');
  };
  const select=async scenario=>{
    await page.locator('#scenario').selectOption(scenario);
    await page.waitForFunction(value=>window.__readinessFixture?.scenario===value,scenario);
    await cleanCopy();
  };
  const saved=()=>page.evaluate(()=>window.__readinessFixture);
  await start.waitFor();
  assert.equal(await row(start,'顧客同意').locator('.ant-tag-blue').count(),1);
  assert.match(await row(start,'顧客同意').innerText(),/已同意 v4/);
  assert.match(await row(start,'客服版次').innerText(),/檢修 v3/);
  assert.equal(await row(start,'客服版次').locator('.ant-tag-blue').count(),1);
  assert.equal(await start.locator('.ant-tag-orange').count(),0);
  assert.equal((await saved()).readiness.startReady,true);
  await cleanCopy();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Desktop has no horizontal overflow');
  await page.screenshot({ path: '/tmp/corely-repair-clean-copy-20261008-readiness-desktop.png', fullPage: true });
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
  await panel.getByText(/^尚未可交回：/).waitFor();
  assert.match(await row(completion,'客服確認').innerText(),/尚未交辦/);
  assert.match(await row(completion,'維修依據版本').innerText(),/目前檢修 v4／維修依據 v3/);
  assert.match(await panel.innerText(),/原廠維修/);
  assert.equal((await saved()).readiness.completionReady,false);
  assert.equal(await row(completion,'維修依據版本').locator('.ant-tag-orange').count(),1);
  for (const [scenario, label,expected] of [
    ['free-pending','顧客同意','待同意報價 v4'], ['paid-pending','款項確認','TWD 399 · 待確認報價 v4 款項'],
    ['new-quote','報價版本','報價 v5／客服確認 v4'], ['csr-accepted','客服確認','客服已本人接手'],
    ['csr-estimate-stale','客服版次','估價依據 v2／目前檢修 v3'],
    ['csr-quote-stale','客服版次','客服報價 v3／方案報價 v4'],
    ['unknown-amount','款項確認','金額未確認'],
  ]) {
    await select(scenario);
    await panel.getByText(/^尚未可開工：/).waitFor();
    assert((await row(start,label).innerText()).includes(expected),`${scenario} shows its actual blocker`);
    assert.equal(await row(start,label).locator('.ant-tag-orange').count(),1,`${scenario} remains pending`);
    assert.equal((await saved()).readiness.startReady,false);
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
  await panel.getByText(/^尚未可交回：/).waitFor();
  assert.match(await row(completion,'逐項複驗').innerText(),/合成設備尚未到位/);
  assert.equal(await row(completion,'逐項複驗').locator('.ant-tag-orange').count(),1);
  assert.equal(await row(completion,'總複驗').locator('.ant-tag-orange').count(),1);
  assert.match(await panel.innerText(),/原機維修/);assert.equal((await saved()).readiness.completionReady,false);
  await select('completed-new-quote');
  await panel.getByText(/^尚未可交回：/).waitFor();
  assert.match(await row(completion,'逐項複驗').innerText(),/合成功能：通過/);
  assert.equal(await row(completion,'逐項複驗').locator('.ant-tag-blue').count(),1);
  assert.match(await row(completion,'報價版本').innerText(),/報價 v5／客服確認 v4/);
  assert.equal(await row(completion,'報價版本').locator('.ant-tag-orange').count(),1);
  assert.equal((await saved()).readiness.completionReady,false);
  assert.equal(await panel.locator('button').count(), 0, 'The panel exposes evidence without creating new action authority');
  await page.setViewportSize({ width: 390, height: 844 });
  await select('free-pending');
  await panel.getByText(/^尚未可開工：/).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile has no horizontal overflow');
  await page.screenshot({ path: '/tmp/corely-repair-clean-copy-20261008-readiness-mobile.png', fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);assert.deepEqual(networkWrites,[]);
});
