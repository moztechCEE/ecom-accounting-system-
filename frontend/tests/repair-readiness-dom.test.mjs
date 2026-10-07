import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
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
  return e(React.Fragment,null,
    e('select',{id:'scenario',value:scenario,onChange:event=>setScenario(event.target.value)},
      ['ready','free-pending','paid-pending','new-quote','csr-accepted','unknown-amount','inspection-draft','inspection-submitted','factory-reinspection','waiting-mailroom','unclaimed','refusal','declined-original-plan','failed-qc','completed-new-quote'].map(value=>e('option',{key:value,value},value))),
    e('div',{id:'panel'},e(RepairReadinessPanel,{item,canUpdate:true,viewerId:'fixture-tech',handoffNote:'合成交回說明'})));
}
createRoot(document.getElementById('root')).render(e(Harness));
`;

test('actual React panel keeps pending consent, payment, CSR and QC distinct from completed handoff', {
  skip: !executablePath && 'No existing Chromium executable; this test never installs a browser', timeout: 60000,
}, async t => {
  const virtual = '\0repair-readiness-dom-fixture';
  const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 }, plugins: [react(), {
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
  t.after(() => server.close()); await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    external.push(url.hostname); return route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__repair-readiness`);
  const panel = page.locator('#panel');
  await panel.getByText('目前具備送出開工核對的條件', { exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Desktop has no horizontal overflow');
  await page.screenshot({ path: '/tmp/corely-repair-readiness-20261008-desktop.png', fullPage: true });
  assert.match(await panel.innerText(), /合成來源回覆 <script>不執行<\/script>/);
  assert.equal(await panel.locator('script').count(), 0, 'Source feedback is rendered as escaped text');
  for (const scenario of ['inspection-draft', 'inspection-submitted']) {
    await page.locator('#scenario').selectOption(scenario);
    await panel.getByText('目前具備送出開工核對的條件', { exact: true }).waitFor();
    assert.match(await panel.innerText(), /原機實際維修/);
    assert.match(await panel.innerText(), /開始維修／替換/);
    assert.equal(await panel.getByRole('region', { name: '複驗與完成件交回核對' }).count(), 0);
    assert.equal(await panel.getByText('完成件交回仍有待核對條件', { exact: true }).count(), 0);
  }
  await page.locator('#scenario').selectOption('factory-reinspection');
  await panel.getByText('完成件交回仍有待核對條件', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /尚無原生客服交辦結果/);
  assert.match(await panel.innerText(), /目前檢修 v4；維修單依據檢修 v3/);
  assert.match(await panel.innerText(), /原廠處理返還/);
  assert.equal(await panel.getByText('目前具備送出交回核對的條件', { exact: true }).count(), 0);
  for (const [scenario, expected] of [
    ['free-pending', '免費方案也須有本報價版顧客同意'], ['paid-pending', '尚未確認本版必要款項'],
    ['new-quote', '來源目前報價 v5；客服確認報價 v4'], ['csr-accepted', '客服已本人接手'],
    ['unknown-amount', '金額未提供或無效，不能當成免費方案'],
  ]) {
    await page.locator('#scenario').selectOption(scenario);
    await panel.getByText('維修開工仍有待核對條件', { exact: true }).waitFor();
    assert((await panel.innerText()).includes(expected), `${scenario} must show its actual blocker`);
    assert.equal(await panel.getByText('目前具備送出開工核對的條件', { exact: true }).count(), 0);
    assert.equal(await panel.locator('.ant-alert-success').count(), 0, 'Pending gates never show an overall success alert');
  }
  await page.locator('#scenario').selectOption('waiting-mailroom');
  await panel.getByText('未修原件已交辦收發室，待本人接收', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /不等於收發已接收、已出貨或已入庫/);
  await page.locator('#scenario').selectOption('unclaimed');
  await panel.getByText('待認領／本人實物簽收', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /可先認領此件，再依交接安排本人收到/);
  await page.locator('#scenario').selectOption('refusal');
  await panel.getByText('保留未修原件，依拒修／退回流程交接', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /不走開始維修或複驗完成/);
  await page.locator('#scenario').selectOption('declined-original-plan');
  await panel.getByText('保留未修原件，依拒修／退回流程交接', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /伺服器目前允許原件未修退回/);
  assert.equal(await panel.getByRole('region', { name: '開始維修／替換核對' }).count(), 0);
  assert.equal(await panel.getByRole('region', { name: '複驗與完成件交回核對' }).count(), 0);
  await page.locator('#scenario').selectOption('failed-qc');
  await panel.getByText('完成件交回仍有待核對條件', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /合成設備尚未到位/);
  assert.match(await panel.innerText(), /原機實際維修/);
  await page.locator('#scenario').selectOption('completed-new-quote');
  await panel.getByText('完成件交回仍有待核對條件', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /已保存 1 項複驗通過/);
  assert.match(await panel.innerText(), /來源目前報價 v5；客服確認報價 v4/);
  assert.equal(await panel.getByText('目前具備送出交回核對的條件', { exact: true }).count(), 0);
  assert.equal(await panel.locator('button').count(), 0, 'The panel exposes evidence without creating new action authority');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#scenario').selectOption('free-pending');
  await panel.getByText('維修開工仍有待核對條件', { exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile has no horizontal overflow');
  await page.screenshot({ path: '/tmp/corely-repair-readiness-20261008-mobile.png', fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
