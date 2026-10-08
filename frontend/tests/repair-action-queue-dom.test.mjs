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
const title = '墨子 MOZTECH 多功能充電器・合成檢修案件';
const labels = { todo: '我的待辦', acceptance: '待認領與簽收', all: '案件查詢' };
const queryLabels = { all: '全部案件', mine: '我的案件', waiting: '等待中', delivery: '已交辦收發室', records: '完成紀錄' };
const todoLabels = { INSPECTION: '檢修待處理', REPAIR_WORK: '維修與複驗', START_REPAIR: '待開始維修', START_REPLACEMENT: '待開始換機', SEND_FACTORY: '待交運原廠', FACTORY_RETURN_RECEIPT: '待簽收返還件', RETURN_ORIGINAL: '待交回原件' };
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};
window.repairActionRevoked=[];const revokeObjectURL=URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL=url=>{window.repairActionRevoked.push(url);revokeObjectURL(url);};
const entry=new URL(location.href).searchParams.get('entry')||'/operations/repair?entityId=action-company';
const router=createMemoryRouter([{path:'/operations/repair',element:React.createElement(RepairWorkbenchPage)}],{initialEntries:[entry]});
window.repairActionRouter=router;
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const api = `
const clone=value=>structuredClone(value);
const error=(message,status=503)=>Object.assign(Error(message),{response:{status,data:{message}}});
const scenario=new URL(location.href).searchParams.get('scenario')||'normal';
const active={id:'active',entityId:'action-company',label:'NATIVE-ACTIVE',productName:${JSON.stringify(title)},
  sku:'HIDDEN-ACTION-SKU',serialNumber:'HIDDEN-ACTION-SN',status:'INSPECTING',statusLabel:'檢測中',version:5,
  matchResult:'MATCH',location:'HIDDEN-ACTION-LOCATION',custodianId:'action-tech',custodianName:'合成本人技師',
  repairOwnerId:'action-tech',nextUserId:null,nextUserName:null,recipientId:null,mine:true,evidenceCount:1,
  physicalCustody:'TECHNICIAN',editable:true,allowedWorkflowActions:[],todoKind:'INSPECTION',
  repairOverview:{customerName:'合成顧客甲',customerPhone:'0900-000-010',photoUrl:'/mailroom/items/active/repair-photo'},
  receipt:{number:'DEV-RCPT-ACTIVE',category:'REPAIR',sourceCaseId:'source-active',sourceNumber:'DEV-ACTION-ACTIVE',
    customerServiceUserId:'action-csr',carrier:'合成承運商',trackingNumber:'IN-ACTION',senderLabel:'合成顧客甲',receivedAt:'2026-10-08T02:00:00Z'},
  repairInspection:{number:'DEV-INS-ACTIVE',revision:3,status:'DRAFT',authorId:'action-tech',authorName:'合成技師',
    updatedAt:'2026-10-08T03:00:00Z',data:{complaint:'合成原始故障',reproduction:'INTERMITTENT',testConditions:'合成測試條件',
      checks:[{name:'合成檢測',result:'NOT_TESTED',observation:'合成未測原因'}],diagnosis:'合成診斷',causeStatus:'UNKNOWN',
      plan:'REPAIR',planNote:'合成建議',feeSuggestion:'PAID',estimateAmount:399,estimateNote:'合成內部估價'}},
  repairReport:null,repairWorkflow:{},history:[],deliverySummary:[]};
const pending=clone(active);pending.id='pending';pending.productName='邦森合成產品・待當版款項確認';
pending.repairOverview.photoUrl=null;pending.receipt.sourceCaseId='source-pending';pending.receipt.sourceNumber='DEV-ACTION-PENDING';
pending.repairInspection.status='SUBMITTED';pending.repairInspection.number='DEV-INS-PENDING';
pending.repairInspection.review={inspectionRevision:3,decision:'APPROVE',planHash:'synthetic-current-plan',quoteRevision:4};
pending.repairWorkflow.csr={status:'RESOLVED',ownerId:'action-csr',ownerName:'合成客服',inspectionRevision:3,estimateRevision:3,
  quoteRevision:4,planHash:'synthetic-current-plan',decision:'APPROVE',acceptedAt:'2026-10-08T02:00:00Z',resolvedAt:'2026-10-08T03:00:00Z'};
pending.release={available:true,repairAllowed:false,message:'待確認本版款項',releaseInfo:{quoteRevision:4,customerApprovedQuoteRevision:4,
  customerApprovedAt:'2026-10-08T03:00:00Z',amount:399,currency:'TWD',confirmedPaymentQuoteRevision:null}};
if(scenario==='unapproved'||scenario==='free-unapproved'){pending.release.releaseInfo.customerApprovedQuoteRevision=null;pending.release.releaseInfo.customerApprovedAt=null;}
if(scenario==='free-unapproved'||scenario==='free-ready')pending.release.releaseInfo.amount=0;
if(['paid-ready','replace-ready','paid-blocked'].includes(scenario))pending.release.releaseInfo.confirmedPaymentQuoteRevision=4;
if(['free-ready','paid-ready','replace-ready'].includes(scenario))pending.release.repairAllowed=true;
if(scenario==='replace-ready'){pending.repairInspection.data.plan='REPLACE';pending.repairInspection.data.replacementSku='SYNTHETIC-REPLACEMENT';pending.repairInspection.data.replacementCondition='REFURBISHED';}
if(scenario==='review-stale')pending.repairInspection.review.inspectionRevision=2;
if(scenario==='csr-inspection-stale')pending.repairWorkflow.csr.inspectionRevision=2;
if(scenario==='csr-estimate-stale')pending.repairWorkflow.csr.estimateRevision=2;
if(scenario==='csr-quote-stale')pending.repairWorkflow.csr.quoteRevision=3;
if(scenario==='csr-plan-stale')pending.repairWorkflow.csr.planHash='synthetic-old-plan';
if(scenario==='csr-declined')pending.repairWorkflow.csr.decision='DECLINE';
if(scenario==='source-quote-stale')pending.release.releaseInfo.quoteRevision=5;
if(scenario==='source-unavailable')pending.release.available=false;
if(scenario==='factory')pending.repairInspection.data.plan='FACTORY';
if(scenario==='return')pending.repairInspection.data.plan='RETURN';
const acceptance=clone(active);acceptance.id='acceptance';acceptance.productName='合成待認領產品';acceptance.status='WAITING_REPAIR_ACCEPTANCE';
acceptance.statusLabel='待維修師認領';acceptance.repairOwnerId=null;acceptance.editable=false;acceptance.repairOverview.photoUrl=null;
acceptance.receipt.sourceNumber='DEV-ACTION-ACCEPTANCE';
const record=clone(active);record.id='record';record.productName='合成歷史產品';record.status='DISPATCHED';
record.statusLabel='已交物流寄回，待顧客收件';record.editable=false;record.custodianId='action-clerk';record.physicalCustody='CUSTOMER_CARRIER';
record.repairOverview.photoUrl=null;record.receipt.sourceNumber='DEV-ACTION-RECORD';record.repairWorkflow.release={purpose:'RETURN_UNREPAIRED'};
const delivered=clone(record);delivered.id='delivery';delivered.status='WAITING_RETURN_ACCEPTANCE';delivered.statusLabel='待收發室簽收';
delivered.receipt.sourceNumber='DEV-ACTION-DELIVERY';
const pageTwo=clone(active);pageTwo.id='page-two';pageTwo.productName='合成第二頁案件';pageTwo.receipt.sourceNumber='DEV-ACTION-PAGE-TWO';pageTwo.repairOverview.photoUrl=null;
const companyB=clone(active);companyB.id='company-b';companyB.entityId='action-company-b';companyB.productName='公司乙合成維修品';companyB.receipt.sourceNumber='DEV-ACTION-COMPANY-B';
companyB.repairOverview={customerName:'公司乙合成顧客',customerPhone:'0900-000-099',photoUrl:null};
const documents=Object.fromEntries([active,pending,acceptance,record,delivered,pageTwo,companyB].map(item=>[item.id,item]));
const kindRows=Object.keys(${JSON.stringify(todoLabels)}).map(kind=>{
  const row=clone(kind==='INSPECTION'?active:pending);row.id='kind-'+kind;row.productName='合成待辦 '+kind;row.receipt.sourceNumber='DEV-ACTION-'+kind;row.todoKind=kind;row.repairOverview.photoUrl=null;
  if(row.release){row.release.repairAllowed=true;row.release.releaseInfo.confirmedPaymentQuoteRevision=4;}
  if(kind==='REPAIR_WORK'){row.status='REPAIRING';row.statusLabel='維修中';}
  if(kind==='START_REPLACEMENT'){row.repairInspection.data.plan='REPLACE';row.repairInspection.data.replacementSku='SYNTHETIC-REPLACEMENT';row.repairInspection.data.replacementCondition='REFURBISHED';}
  if(kind==='SEND_FACTORY'){row.repairInspection.data.plan='FACTORY';row.allowedWorkflowActions=['send_factory'];}
  if(kind==='FACTORY_RETURN_RECEIPT'){row.status='FACTORY_RETURNING';row.statusLabel='原廠返還途中';row.physicalCustody='FACTORY_CARRIER';row.custodianId='synthetic-factory-carrier';row.editable=false;row.repairInspection.data.plan='FACTORY';row.repairWorkflow.factory={stage:'RETURNING',physicalCustody:'FACTORY_CARRIER',reference:'SYNTHETIC-FACTORY'};row.allowedWorkflowActions=['receive_factory'];}
  if(kind==='RETURN_ORIGINAL'){row.status='WAITING_CUSTOMER';row.statusLabel='客服與顧客確認中';row.repairInspection.data.plan='RETURN';row.repairInspection.review.decision='DECLINE';row.repairWorkflow.csr.decision='DECLINE';row.allowedWorkflowActions=['return_original'];}
  documents[row.id]=clone(row);return row;
});
const startRow=kindRows.find(row=>row.todoKind==='START_REPAIR');documents[startRow.id]={...clone(pending),id:startRow.id,version:6};
for(const kind of ['INVALID_AUTHORITY',null]){const row=clone(active);row.id=kind||'missing-kind';row.productName='合成原生狀態 '+(kind||'missing');row.receipt.sourceNumber='DEV-ACTION-'+row.id;row.todoKind=kind;row.repairOverview.photoUrl=null;kindRows.push(row);documents[row.id]=clone(row);}
const state={gets:[],posts:[],plans:scenario==='held-summary'?[{name:'initial-summary',match:{summary:'true'},mode:'hold'}]:[],held:{},released:false,documents,initialKindStatus:Object.fromEntries(kindRows.map(row=>[row.id,row.status])),
  plan(name,match,mode='hold'){this.plans.push({name,match,mode});},
  settle(name,data){const pending=this.held[name];if(!pending)throw Error('No held request '+name);delete this.held[name];pending.resolve({data:clone(data??pending.data)});},
  fail(name){const pending=this.held[name];if(!pending)throw Error('No held request '+name);delete this.held[name];pending.reject(error('合成摘要讀取失敗'));},
  emit(data={}){for(const listener of window.repairActionSocketListeners||[])listener({category:'mailroom',data});},
  releasePending(){this.released=true;pending.version++;pending.todoKind='START_REPAIR';pending.release.repairAllowed=true;pending.release.message='已放行';pending.release.releaseInfo.confirmedPaymentQuoteRevision=4;},
  result(params){
    if(params.entityId==='action-company-b')return {items:params.summary==='true'?[]:[clone(companyB)],total:99,queueCounts:{todo:11,acceptance:2,all:99},countExact:true,unknownCount:0};
    const scope=params.repairScope||'todo';
    const queueCounts={todo:this.released?65:64,acceptance:5,all:172,mine:92,waiting:7,delivery:13,records:88};
    const rows={todo:scenario==='all-kinds'?kindRows:this.released?[active,pending]:[active],acceptance:[acceptance],all:[active,pending,record,delivered],mine:[active,pending,record],waiting:[pending],delivery:[delivered],records:[record]};
    const items=params.page===2?[pageTwo]:params.search?rows[scope].filter(item=>item.productName.includes(params.search)):rows[scope];
    const data={items:params.summary==='true'?[]:items.map(clone),total:params.search?items.length:queueCounts[scope],queueCounts,countExact:true,unknownCount:0};
    if(scope!=='todo')for(const row of data.items)delete row.todoKind;
    if(scope==='todo'&&['unknown','unknown-empty'].includes(scenario)){delete data.queueCounts.todo;data.countExact=false;data.unknownCount=3;if(scenario==='unknown-empty'){data.items=[];data.total=0;}}
    if(scope==='todo'&&scenario==='known-empty'){data.queueCounts.todo=0;data.items=[];data.total=0;}
    return data;
  }};
window.repairActionFixture=state;
export const API_URL='/offline-repair-action-api';
export default {
  async get(path,options={}){
    const params=clone(options.params||{});if(path==='/repair-workbench/todo')params.repairScope='todo';state.gets.push({path,params,requestParams:clone(options.params||{})});
    if(path==='/mailroom/source-cases')return {data:{items:[],nextCursor:null}};
    if(path==='/mailroom/items/active/repair-photo')return {data:new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),character=>character.charCodeAt(0))],{type:'image/png'})};
    const detail=path.match(/^\\/repair-workbench\\/items\\/([^/]+)\\/documents$/);
    if(detail&&documents[detail[1]])return {data:clone(documents[detail[1]])};
    if(path!=='/mailroom/items'&&path!=='/repair-workbench/todo')throw Error('Unexpected offline GET '+path);
    if(path==='/repair-workbench/todo'&&params.summary==='true'&&scenario==='summary-failure')throw error('合成摘要讀取失敗');
    const planned=state.plans.findIndex(plan=>Object.entries(plan.match).every(([key,value])=>params[key]===value));
    if(planned>=0){const plan=state.plans.splice(planned,1)[0],data=state.result(params);
      if(plan.mode==='fail')throw error('合成新分類讀取失敗');
      if(plan.mode==='forbidden')throw error('合成權限已撤銷',403);
      return await new Promise((resolve,reject)=>{state.held[plan.name]={resolve,reject,data};});
    }
    return {data:state.result(params)};
  },
  async post(path,body){state.posts.push({path,body:clone(body)});throw Error('Business writes blocked in offline fixture');}
};
`;

test('actual three-tab repair workbench preserves native navigation, case access, drafts and server-provided work queues', {
  skip: !executablePath && 'Requires an existing browser; no installation', timeout: 120000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-repair-action-queue-'));
  const virtual = '\0repair-action-queue-fixture';
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-repair-action-queue',
      resolveId(id) { if (id === 'virtual:repair-action-queue-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'action-tech',roles:[],permissions:['repair_workbench:read','repair_workbench:update']}});`;
        if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/services/websocket.service.ts')) return `window.repairActionSocketListeners=new Set();export const webSocketService={subscribe:listener=>{window.repairActionSocketListeners.add(listener);return()=>window.repairActionSocketListeners.delete(listener);}};`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/__repair-action-queue')) return next();
          try {
            const html = await vite.transformIndexHtml('/__repair-action-queue', `<html lang="zh-Hant"><head><meta charset="utf-8"><style>
              *{box-sizing:border-box}body{margin:0;background:#f5f6f8}.fixture-shell{min-width:0;padding:24px 24px 24px 264px}
              .fixture-sidebar{position:fixed;inset:0 auto 0 0;width:240px;background:#172534;color:white;padding:24px}
              @media(max-width:767px){.fixture-shell{padding:12px}.fixture-sidebar{display:none}}
              </style></head><body><aside class="fixture-sidebar">合成工作台側欄</aside><main class="fixture-shell"><div id="root"></div></main>
              <script type="module" src="/@id/virtual:repair-action-queue-fixture"></script></body></html>`);
            response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }] });
  await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  const errors = [], external = [], networkWrites = [];
  const createPage = async (entry = '/operations/repair?entityId=action-company', viewport = { width: 1537, height: 972 }, scenario = 'normal') => {
    const page = await browser.newPage({ viewport }); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request(), host = new URL(request.url()).hostname;
      if (host !== '127.0.0.1') { external.push(host); return route.abort(); }
      if (!['GET', 'HEAD'].includes(request.method())) { networkWrites.push(request.method() + ' ' + request.url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__repair-action-queue?entry=${encodeURIComponent(entry)}&scenario=${encodeURIComponent(scenario)}`);
    await page.locator('.repair-tab-label').first().waitFor();
    return page;
  };
  const tab = (page, name) => page.locator('.repair-tab-label').filter({ hasText: labels[name] });
  const assertBadge = async (page, todo = 64) => {
    assert.equal(await tab(page, 'todo').locator(`[aria-label="${todo} 件"]`).count(), 1);
    assert.equal(await tab(page, 'acceptance').locator('[aria-label="5 件"]').count(), 1);
    assert.equal(await tab(page, 'all').locator('.ant-badge-count').count(), 0);
  };
  const latestScope = page => page.evaluate(() => window.repairActionFixture.gets.filter(value => value.path === '/mailroom/items'||value.path==='/repair-workbench/todo'&&value.params.summary!=='true').at(-1)?.params);
  const selectFilter = async (page, scope) => {
    await page.locator('.repair-query-filter .ant-select-selector').click();
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content').getByText(queryLabels[scope], { exact: true }).click();
    await page.waitForFunction(scope => window.repairActionFixture.gets.filter(value => value.path === '/mailroom/items').at(-1)?.params.repairScope === scope, scope);
  };

  await t.test('default work queue has three tabs, two global badges and clean six-field rows at three widths', async () => {
    for (const viewport of [{ width: 1537, height: 972 }, { width: 1104, height: 1056 }, { width: 390, height: 844 }]) {
      const page = await createPage(undefined, viewport);
      try {
        await page.getByRole('button', { name: title, exact: true }).waitFor();
        assert.equal(await page.locator('.repair-tab-label').count(), 3);
        assert.equal(await tab(page, 'todo').evaluate(node => node.closest('[role="tab"]').getAttribute('aria-selected')), 'true');
        assert.equal((await latestScope(page)).repairScope, 'todo');
        await assertBadge(page);
        assert.equal(await page.locator('.repair-query-filter').count(), 0);
        assert.equal(await page.locator('.repair-arrival-preview').count(), 0);
        assert.equal(await page.evaluate(() => window.repairActionFixture.gets.some(value => value.path === '/mailroom/source-cases')), false);
        const text = await page.locator('.repair-case-list').innerText();
        for (const value of [title, 'DEV-ACTION-ACTIVE', '合成顧客甲', '0900-000-010', '檢修待處理']) assert(text.includes(value));
        for (const value of ['HIDDEN-ACTION-SKU', 'HIDDEN-ACTION-SN', 'HIDDEN-ACTION-LOCATION', '尚無維修單', '待當版款項確認']) assert(!text.includes(value));
        assert.equal(await page.locator('.repair-case-photo').count(), 1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
        if (viewport.width === 390) assert((await page.locator('.mailroom-heading').boundingBox()).height < 140);
        await page.waitForFunction(() => { const img = document.querySelector('.repair-case-photo img'); return img?.complete && img.naturalWidth > 0; });
        await page.screenshot({ path: `/tmp/repair-action-queue-20261008-${viewport.width}.png`, fullPage: true });
      } finally { await page.close(); }
    }
  });

  await t.test('all seven native scopes and invalid old URLs select the correct tab while direct cases open independently', async () => {
    for (const scope of ['todo', 'acceptance', 'all', 'mine', 'waiting', 'delivery', 'records', 'invalid-queue']) {
      const expected = scope === 'invalid-queue' ? 'todo' : scope;
      const currentTab = ['todo', 'acceptance'].includes(expected) ? expected : 'all';
      const page = await createPage(`/operations/repair?entityId=action-company&queue=${scope}&itemId=record`);
      try {
        const drawer = page.locator('.ant-drawer-open');
        await drawer.locator('.repair-detail-identity').getByText('合成歷史產品', { exact: true }).waitFor();
        assert.equal((await latestScope(page)).repairScope, expected);
        assert.equal(await tab(page, currentTab).evaluate(node => node.closest('[role="tab"]').getAttribute('aria-selected')), 'true');
        assert.equal(await page.locator('.repair-tab-label').count(), 3);
        assert.equal(await drawer.locator('textarea[id$="_complaint"]').isDisabled(), true);
        assert.equal(await drawer.getByRole('button', { name: '開始維修', exact: true }).count(), 0);
        assert(await page.evaluate(() => window.repairActionFixture.gets.some(value => value.path === '/repair-workbench/items/record/documents' && value.params.entityId === 'action-company')));
        if (queryLabels[scope] && scope !== 'all') assert((await page.locator('.repair-applied-filter').innerText()).includes(queryLabels[scope]));
      } finally { await page.close(); }
    }
    const page = await createPage('/operations/repair?entityId=action-company&itemId=pending');
    try {
      await page.locator('.ant-drawer-open .repair-detail-identity').getByText('邦森合成產品・待當版款項確認', { exact: true }).waitFor();
      assert.equal((await latestScope(page)).repairScope, 'todo');
      assert.equal(await page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-PENDING' }).count(), 0, 'direct access does not require membership in current work queue');
    } finally { await page.close(); }
  });

  await t.test('case query keeps filtering on demand, preserves native scopes and resets pagination when filters change', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: title, exact: true }).waitFor();
      await tab(page, 'all').click();
      await page.waitForFunction(() => new URLSearchParams(window.repairActionRouter.state.location.search).get('queue') === 'all');
      assert.equal(await page.locator('.repair-query-filter').count(), 0);
      await page.getByRole('button', { name: /篩選/ }).click();
      await selectFilter(page, 'records');
      await page.getByRole('button', { name: '合成歷史產品', exact: true }).waitFor();
      assert((await page.locator('.repair-applied-filter').innerText()).includes('完成紀錄'));
      await page.locator('.repair-case-pagination .ant-pagination-item-2').click();
      await page.getByRole('button', { name: '合成第二頁案件', exact: true }).waitFor();
      assert.equal((await latestScope(page)).page, 2);
      await selectFilter(page, 'waiting');
      await page.getByRole('button', { name: '邦森合成產品・待當版款項確認', exact: true }).waitFor();
      assert.equal((await latestScope(page)).page, 1);
      await assertBadge(page);
      await page.locator('.repair-applied-filter .ant-tag-close-icon').click();
      await page.waitForFunction(() => new URLSearchParams(window.repairActionRouter.state.location.search).get('queue') === 'all');
      await page.locator('.repair-applied-filter').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.repair-applied-filter').count(), 0);
      await page.evaluate(() => window.repairActionRouter.navigate(-1));
      await page.waitForFunction(() => new URLSearchParams(window.repairActionRouter.state.location.search).get('queue') === 'waiting');
      await page.getByRole('button', { name: '邦森合成產品・待當版款項確認', exact: true }).waitFor();
      assert((await page.locator('.repair-applied-filter').innerText()).includes('等待中'));
      await tab(page, 'acceptance').click();
      await page.locator('.repair-arrival-preview').waitFor();
      assert.equal(await page.locator('.repair-query-filter').count(), 0);
      await tab(page, 'todo').click();
      await page.waitForFunction(() => !new URLSearchParams(window.repairActionRouter.state.location.search).has('queue'));
      await page.getByRole('button', { name: title, exact: true }).waitFor();
      assert.equal((await latestScope(page)).repairScope, 'todo');
      await assertBadge(page);
    } finally { await page.close(); }
  });

  await t.test('failed new scope and late previous scope do not show old cases or fabricated task counts', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: title, exact: true }).waitFor();
      await page.evaluate(() => { window.repairActionFixture.plan('old-todo', { repairScope: 'todo', search: '舊搜尋' }); window.repairActionFixture.plan('new-records', { repairScope: 'records' }, 'fail'); });
      const search = page.locator('.repair-workbench-search input'); await search.fill('舊搜尋'); await search.press('Enter');
      await page.waitForFunction(() => !!window.repairActionFixture.held['old-todo']);
      await page.evaluate(() => window.repairActionRouter.navigate('/operations/repair?entityId=action-company&queue=records'));
      await page.getByText('合成新分類讀取失敗', { exact: true }).waitFor();
      assert.equal(await page.locator('.repair-case-row').count(), 0);
      assert.equal(await page.locator('.repair-tab-label .ant-badge-count').count(), 0);
      assert.equal(await page.getByText('此分類目前沒有案件', { exact: true }).count(), 0);
      await page.evaluate(() => window.repairActionFixture.settle('old-todo', { items: [window.repairActionFixture.documents.active], total: 999, queueCounts: { todo: 999, acceptance: 999 } }));
      assert.equal(await page.locator('.repair-case-row').count(), 0);
      assert.equal(await page.locator('.repair-tab-label [aria-label="999 件"]').count(), 0);
      await search.fill(''); await search.press('Enter');
      await page.getByRole('button', { name: '合成歷史產品', exact: true }).waitFor();
      await assertBadge(page);
      assert.equal((await latestScope(page)).repairScope, 'records');
    } finally { await page.close(); }
  });

  await t.test('draft survives cancelled tab navigation, direct-link navigation and incoming case updates', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: title, exact: true }).click();
      const drawer = page.locator('.ant-drawer-open'), complaint = drawer.locator('textarea[id$="_complaint"]');
      await complaint.fill('合成未儲存修改');
      await tab(page, 'all').evaluate(node => node.click());
      await page.locator('.ant-modal-confirm').getByRole('button', { name: '繼續編輯', exact: true }).click();
      assert.equal(await complaint.inputValue(), '合成未儲存修改');
      assert.equal(await page.evaluate(() => new URLSearchParams(window.repairActionRouter.state.location.search).get('itemId')), 'active');
      await page.evaluate(() => window.repairActionRouter.navigate('/operations/repair?entityId=action-company&queue=waiting&itemId=pending'));
      await page.locator('.ant-modal-confirm').getByRole('button', { name: '繼續編輯', exact: true }).click();
      assert.equal(await complaint.inputValue(), '合成未儲存修改');
      await page.evaluate(() => { window.repairActionFixture.documents.active.version++; window.repairActionFixture.documents.active.repairInspection.data.complaint = '合成外部新紀錄'; window.repairActionFixture.emit({ itemId: 'active' }); });
      await drawer.getByText('案件已更新', { exact: true }).waitFor();
      assert.equal(await complaint.inputValue(), '合成未儲存修改', 'quiet list refresh does not reload a dirty case form');
      assert.equal(await page.evaluate(() => window.repairActionFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('payment progress remains within the case and cannot start repair before its current payment confirmation', async () => {
    const page = await createPage('/operations/repair?entityId=action-company&queue=waiting&itemId=pending');
    try {
      const drawer = page.locator('.ant-drawer-open');
      await drawer.locator('.repair-detail-identity').getByText('邦森合成產品・待當版款項確認', { exact: true }).waitFor();
      await drawer.locator('.repair-readiness-compact .ant-collapse-header').click();
      await drawer.getByText('TWD 399 · 待確認報價 v4 款項', { exact: true }).waitFor();
      assert.equal(await drawer.getByRole('button', { name: '開始維修', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.repair-tab-label').filter({ hasText: '付款' }).count(), 0);
      assert.equal(await page.evaluate(() => window.repairActionFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('a socket refresh consumes a server-returned released case as a task without creating payment or repair writes', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: title, exact: true }).waitFor();
      assert.equal(await page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-PENDING' }).count(), 0);
      await assertBadge(page);
      await page.evaluate(() => { window.repairActionFixture.releasePending(); window.repairActionFixture.emit({ itemId: 'pending', sourceCaseId: 'source-pending' }); });
      const released = page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-PENDING' });
      await released.waitFor(); await assertBadge(page, 65);
      assert.equal((await latestScope(page)).repairScope, 'todo');
      await released.locator('.repair-case-open').click();
      const drawer = page.locator('.ant-drawer-open');
      await drawer.locator('.repair-detail-identity').getByText('邦森合成產品・待當版款項確認', { exact: true }).waitFor();
      assert.equal(await drawer.getByRole('button', { name: '開始維修', exact: true }).isEnabled(), true);
      await drawer.locator('.repair-readiness-compact .ant-collapse-header').click();
      await drawer.getByText('TWD 399 · 已確認', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.repairActionFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('drawer progress distinguishes current free, paid and stale customer results without replacing native guards', async () => {
    const scenarios = { normal: '等待款項確認', unapproved: '等待顧客確認', 'free-unapproved': '等待顧客確認',
      'free-ready': '待開始維修', 'paid-ready': '待開始維修', 'replace-ready': '待開始換機', 'paid-blocked': '檢測中',
      'review-stale': '檢測中', 'csr-inspection-stale': '檢測中', 'csr-estimate-stale': '檢測中', 'csr-quote-stale': '檢測中',
      'csr-plan-stale': '檢測中', 'csr-declined': '檢測中', 'source-quote-stale': '檢測中', 'source-unavailable': '檢測中', factory: '檢測中', return: '檢測中' };
    for (const [scenario, expected] of Object.entries(scenarios)) {
      const page = await createPage('/operations/repair?entityId=action-company&queue=waiting&itemId=pending', undefined, scenario);
      try {
        const drawer = page.locator('.ant-drawer-open');
        await drawer.locator('.repair-detail-identity').getByText('邦森合成產品・待當版款項確認', { exact: true }).waitFor();
        assert.equal((await drawer.locator('.repair-detail-summary .ant-tag').first().innerText()).trim(), expected, 'case progress derives only from current bound evidence: ' + scenario);
        if (expected.startsWith('待開始')) assert.equal(await drawer.getByRole('button', { name: scenario === 'replace-ready' ? '開始換機' : '開始維修', exact: true }).isEnabled(), true);
        assert.equal(await page.evaluate(() => window.repairActionFixture.posts.length), 0);
      } finally { await page.close(); }
    }
  });

  await t.test('unknown source eligibility hides the todo badge and never presents an unknown queue as empty', async () => {
    for (const scenario of ['unknown', 'unknown-empty']) {
      const page = await createPage(undefined, undefined, scenario);
      try {
        await page.getByText('有 3 件案件的放行狀態尚未確認', { exact: true }).waitFor();
        assert.equal(await tab(page, 'todo').locator('.ant-badge-count').count(), 0);
        assert.equal(await tab(page, 'acceptance').locator('[aria-label="5 件"]').count(), 1);
        assert.equal(await page.getByText('目前沒有待辦', { exact: true }).count(), 0);
        if (scenario === 'unknown') assert.equal(await page.getByRole('button', { name: title, exact: true }).count(), 1);
        else assert.equal(await page.locator('.repair-case-row').count(), 0);
      } finally { await page.close(); }
    }
    const page = await createPage(undefined, undefined, 'known-empty');
    try {
      await page.getByText('目前沒有待辦', { exact: true }).waitFor();
      assert.equal(await tab(page, 'todo').locator('.ant-badge-count').count(), 0);
      assert.equal(await page.getByText('有 3 件案件的放行狀態尚未確認', { exact: true }).count(), 0);
    } finally { await page.close(); }
  });

  await t.test('unavailable todo summary leaves native case query and direct case documents readable', async () => {
    const page = await createPage('/operations/repair?entityId=action-company&queue=all', undefined, 'summary-failure');
    try {
      await page.getByRole('button', { name: title, exact: true }).waitFor();
      await page.getByText('待辦進度暫無法取得', { exact: true }).waitFor();
      assert.equal(await tab(page, 'todo').locator('.ant-badge-count').count(), 0);
      assert.equal(await tab(page, 'acceptance').locator('[aria-label="5 件"]').count(), 1);
      await page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-RECORD' }).locator('.repair-case-open').click();
      await page.locator('.ant-drawer-open .repair-detail-identity').getByText('合成歷史產品', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.repairActionFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('slow summaries cannot delay native case access and their late result cannot replace newer company counts', async () => {
    const page = await createPage('/operations/repair?entityId=action-company&queue=all', undefined, 'held-summary');
    try {
      await page.waitForFunction(() => !!window.repairActionFixture.held['initial-summary']);
      await page.getByRole('button', { name: title, exact: true }).waitFor();
      assert.equal(await tab(page, 'todo').locator('.ant-badge-count').count(), 0);
      await page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-RECORD' }).locator('.repair-case-open').click();
      await page.locator('.ant-drawer-open .repair-detail-identity').getByText('合成歷史產品', { exact: true }).waitFor();
      await page.evaluate(() => window.repairActionFixture.fail('initial-summary'));
      assert.equal(await page.locator('.ant-drawer-open .repair-detail-identity').getByText('合成歷史產品', { exact: true }).count(), 1);
    } finally { await page.close(); }
    const crossCompany = await createPage('/operations/repair?entityId=action-company&queue=all', undefined, 'held-summary');
    try {
      await crossCompany.waitForFunction(() => !!window.repairActionFixture.held['initial-summary']);
      await crossCompany.getByRole('button', { name: title, exact: true }).waitFor();
      await crossCompany.evaluate(() => window.repairActionRouter.navigate('/operations/repair?entityId=action-company-b&queue=all'));
      await crossCompany.getByRole('button', { name: '公司乙合成維修品', exact: true }).waitFor();
      await crossCompany.waitForFunction(() => !!document.querySelector('.repair-tab-label [aria-label="11 件"]'));
      await crossCompany.evaluate(() => window.repairActionFixture.settle('initial-summary', { items: [], total: 999, queueCounts: { todo: 999, acceptance: 999 }, countExact: true, unknownCount: 0 }));
      assert.equal(await tab(crossCompany, 'todo').locator('[aria-label="11 件"]').count(), 1);
      assert.equal(await tab(crossCompany, 'acceptance').locator('[aria-label="2 件"]').count(), 1);
      assert.equal(await crossCompany.locator('.repair-tab-label [aria-label="999 件"]').count(), 0);
      assert(!(await crossCompany.locator('.repair-case-list').innerText()).includes('0900-000-010'));
    } finally { await crossCompany.close(); }
  });

  await t.test('native permission rejection clears query contacts and photos immediately while its todo summary is still held', async () => {
    const page = await createPage('/operations/repair?entityId=action-company&queue=all');
    try {
      await page.getByRole('button', { name: title, exact: true }).waitFor();
      await page.waitForFunction(() => { const img = document.querySelector('.repair-case-photo img'); return img?.complete && img.naturalWidth > 0; });
      const priorUrl = await page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-ACTIVE' }).locator('.repair-case-photo img').getAttribute('src');
      await page.evaluate(() => { window.repairActionFixture.plan('denied-list', { repairScope: 'all' }, 'forbidden'); window.repairActionFixture.plan('held-count', { summary: 'true' }); });
      await page.locator('.mailroom-heading button').click();
      await page.waitForFunction(() => !!window.repairActionFixture.held['held-count']);
      await page.getByText('合成權限已撤銷', { exact: true }).waitFor();
      assert.equal(await page.locator('.repair-case-row').count(), 0);
      assert.equal(await page.locator('.repair-case-photo').count(), 0);
      assert.equal(await page.locator('.repair-tab-label .ant-badge-count').count(), 0);
      assert(!(await page.locator('.repair-workbench-list').innerText()).includes('0900-000-010'));
      await page.waitForFunction(priorUrl => window.repairActionRevoked.includes(priorUrl), priorUrl);
      await page.evaluate(() => window.repairActionFixture.settle('held-count', { items: [], total: 999, queueCounts: { todo: 999, acceptance: 999 }, countExact: true, unknownCount: 0 }));
      assert.equal(await page.locator('.repair-tab-label .ant-badge-count').count(), 0);
      assert.equal(await page.getByText('此分類目前沒有案件', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.repairActionFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('summary permission rejection clears already loaded native query contacts and photos', async () => {
    const page = await createPage('/operations/repair?entityId=action-company&queue=all');
    try {
      await page.getByRole('button', { name: title, exact: true }).waitFor();
      await assertBadge(page);
      await page.waitForFunction(() => { const img = document.querySelector('.repair-case-photo img'); return img?.complete && img.naturalWidth > 0; });
      const priorUrl = await page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-ACTIVE' }).locator('.repair-case-photo img').getAttribute('src');
      await page.evaluate(() => window.repairActionFixture.plan('denied-summary', { summary: 'true' }, 'forbidden'));
      await page.locator('.mailroom-heading button').click();
      await page.getByText('合成權限已撤銷', { exact: true }).waitFor();
      assert.equal(await page.locator('.repair-case-row').count(), 0);
      assert.equal(await page.locator('.repair-case-photo').count(), 0);
      assert.equal(await page.locator('.repair-tab-label .ant-badge-count').count(), 0);
      assert(!(await page.locator('.repair-workbench-list').innerText()).includes('0900-000-010'));
      await page.waitForFunction(priorUrl => window.repairActionRevoked.includes(priorUrl), priorUrl);
      assert.equal(await page.getByText('此分類目前沒有案件', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.repairActionFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('server task kinds label the next work while unknown kinds and fresh detail retain native status and action guards', async () => {
    const page = await createPage(undefined, undefined, 'all-kinds');
    try {
      await page.getByRole('button', { name: '合成待辦 INSPECTION', exact: true }).waitFor();
      for (const [kind, label] of Object.entries(todoLabels)) {
        const row = page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-' + kind });
        assert.equal((await row.locator('.repair-case-progress').innerText()).trim(), label);
      }
      for (const kind of ['INVALID_AUTHORITY', 'missing-kind']) {
        const row = page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-' + kind });
        assert.equal((await row.locator('.repair-case-progress').innerText()).trim(), '檢測中', 'unknown/missing projected task kind retains native status');
      }
      assert(await page.evaluate(() => Object.values(window.repairActionFixture.documents).every(item => !item.id.startsWith('kind-') || item.status === window.repairActionFixture.initialKindStatus[item.id])), 'displaying a task kind cannot mutate native state');
      await page.locator('.repair-case-row').filter({ hasText: 'DEV-ACTION-START_REPAIR' }).locator('.repair-case-open').click();
      const drawer = page.locator('.ant-drawer-open');
      await drawer.locator('.repair-detail-identity').getByText('邦森合成產品・待當版款項確認', { exact: true }).waitFor();
      assert.equal((await drawer.locator('.repair-detail-summary .ant-tag').first().innerText()).trim(), '等待款項確認');
      assert.equal(await drawer.getByRole('button', { name: '開始維修', exact: true }).isDisabled(), true, 'a list label does not authorize work when the fresh case is still blocked');
      assert.equal(await page.evaluate(() => window.repairActionFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(networkWrites, []);
});
