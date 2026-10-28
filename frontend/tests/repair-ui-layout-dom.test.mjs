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
const productName = '墨子 MOZTECH 多功能充電器測試機・長產品名稱與維修辨識測試';
const caseNumber = 'DEV-REPAIR-LAYOUT-20261008-001';
const nativeLabel = 'NATIVE-LAYOUT-001';
const sku = 'MOZTECH-SKU-' + '1234567890'.repeat(9);
const serial = 'MOZTECH-SN-' + 'ABCDEFGHIJ'.repeat(9);
const customerIssue = '顧客原述：接上充電線後沒有反應，換線後仍無法充電。';
const removedNotes = [
  '選擇產品與案件，完成檢測、維修及複驗紀錄。', '客服方案確認與售後放行分開核對',
  '售後來源案件的到貨預告；', '以上依目前保存資料與本人作業條件顯示。',
  '送出時後端再核對', '客服接手及方案回覆各有獨立紀錄。',
  '送達原廠、原廠接收、返還在途及維修師本人簽收分別留存。',
  '同步成功表示對方系統已收到事件；', '請先提交完整檢修單，才可交客服確認或開始處理。',
  '工作單、版本與估價說明',
];
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};
const router=createMemoryRouter([{path:'/operations/repair',element:React.createElement(RepairWorkbenchPage)},
  {path:'/other',element:React.createElement('h2',null,'合成其他工作台')}],
  {initialEntries:['/operations/repair?entityId=layout-company&queue=mine']});
window.repairLayoutRouter=router;
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const api = `
const clone=value=>structuredClone(value);
const primary={id:'layout-primary',entityId:'layout-company',label:${JSON.stringify(nativeLabel)},
  productName:${JSON.stringify(productName)},sku:${JSON.stringify(sku)},serialNumber:${JSON.stringify(serial)},
  status:'INSPECTING',statusLabel:'檢測中',version:7,matchResult:'MATCH',location:'合成維修區 A／測試架 1',
  custodianId:'layout-tech',custodianName:'合成本人技師',repairOwnerId:'layout-tech',nextUserId:'layout-tech',nextUserName:'合成本人技師',
  recipientId:null,mine:true,evidenceCount:0,evidence:[],physicalCustody:'TECHNICIAN',editable:true,allowedWorkflowActions:[],
  receipt:{number:'DEV-RCPT-LAYOUT-001',category:'REPAIR',sourceCaseId:'layout-source',sourceNumber:${JSON.stringify(caseNumber)},
    customerServiceUserId:'layout-csr',receivedAt:'2026-10-08T02:00:00Z',carrier:'合成入件物流',trackingNumber:'IN-LAYOUT-001'},
  declared:{name:${JSON.stringify(productName)},sku:${JSON.stringify(sku)},serialNumber:${JSON.stringify(serial)}},
  customerContext:{state:'AVAILABLE',sourceCaseId:'layout-source',sourceNumber:${JSON.stringify(caseNumber)},customerIssue:${JSON.stringify(customerIssue)}},
  mailroomPrecheck:{schema:1,entityId:'layout-company',itemId:'layout-primary',stage:'SUBMITTED',revision:2,
    savedByName:'合成收發人員',savedAt:'2026-10-08T02:10:00Z',submittedAt:'2026-10-08T02:15:00Z',
    recorded:{id:'layout-precheck',revision:2,template:null,savedByName:'合成收發人員',savedAt:'2026-10-08T02:10:00Z',submittedAt:'2026-10-08T02:15:00Z',notRequiredReason:null,
      checks:[{key:'appearance',label:'外觀初檢',result:'NORMAL',note:'外觀無明顯破損',photoIds:[]},{key:'power',label:'充電初檢',result:'ABNORMAL',note:'接線後指示燈未亮',photoIds:[]}],photos:[],
      mailroomIssue:{schema:1,symptom:'收發補充：線材已核對',preliminaryReason:'原因仍待技師確認'}}},
  repairInspection:{number:'DEV-INS-LAYOUT-001',revision:2,status:'DRAFT',authorId:'layout-tech',authorName:'合成本人技師',
    updatedAt:'2026-10-08T03:00:00Z',data:{complaint:'合成原始故障描述',reproduction:'INTERMITTENT',testConditions:'合成測試條件與設備',
      checks:[{name:'合成功能檢測',result:'NOT_TESTED',observation:'合成未測原因'}],diagnosis:'合成診斷待排除',
      causeStatus:'SUSPECTED',plan:'REPAIR',planNote:'合成處理建議',feeSuggestion:'REVIEW',estimateNote:'合成內部估價'}},
  repairReport:{number:'DEV-REP-LAYOUT-001',revision:1,status:'DRAFT',inspectionRevision:2,authorId:'layout-tech',authorName:'合成本人技師',
    updatedAt:'2026-10-08T03:00:00Z',data:{outcome:'REPAIRED',workPerformed:'合成保存的實際處置',parts:[],laborMinutes:5,
      checks:[{name:'合成修後檢測',result:'NOT_TESTED',observation:'合成尚待複驗'}],qcResult:'NOT_TESTED',qcNotes:'合成複驗草稿',deliveredAccessories:'合成配件'}},
  release:{available:false,repairAllowed:false,message:'合成來源放行尚待客服核對'},repairWorkflow:{schema:1},
  history:[{id:'layout-history',action:'save_repair_inspection',actorName:'合成本人技師',createdAt:'2026-10-08T03:00:00Z',
    toStatus:'INSPECTING',version:7,note:'{"documentNumber":"DEV-INS-LAYOUT-001","revision":2,"status":"DRAFT"}'}],
  deliverySummary:[{target:'AFTER_SALES',status:'DELIVERED',count:1}]};
const second={...clone(primary),id:'layout-second',label:'NATIVE-LAYOUT-002',productName:'邦森居家用品・合成風扇',
  sku:'BONSEN-FAN-002',serialNumber:'BONSEN-SN-002',editable:false,receipt:{...clone(primary.receipt),sourceNumber:'DEV-REPAIR-LAYOUT-002'}};
const waitingCurrent=clone(primary);
waitingCurrent.id='waiting-current';waitingCurrent.status='WAITING_CUSTOMER';waitingCurrent.statusLabel='客服與顧客確認中';
waitingCurrent.receipt.sourceNumber='DEV-REPAIR-WAITING-CURRENT';waitingCurrent.repairInspection.status='SUBMITTED';
waitingCurrent.repairInspection.review={inspectionRevision:2,decision:'APPROVE',planHash:'synthetic-current-plan',quoteRevision:4};
waitingCurrent.repairWorkflow.csr={status:'RESOLVED',ownerId:'layout-csr',ownerName:'合成客服',inspectionRevision:2,
  estimateRevision:2,quoteRevision:4,planHash:'synthetic-current-plan',decision:'APPROVE',acceptedAt:'2026-10-08T02:00:00Z',resolvedAt:'2026-10-08T03:00:00Z'};
waitingCurrent.release={available:true,repairAllowed:true,releaseInfo:{quoteRevision:4,customerApprovedQuoteRevision:4,
  customerApprovedAt:'2026-10-08T03:00:00Z',amount:0,currency:'TWD',confirmedPaymentQuoteRevision:null}};
const waitingRows=[waitingCurrent];
for(const [suffix,field,value] of [['ESTIMATE','estimateRevision',1],['QUOTE','quoteRevision',3],['DECISION','decision','DECLINE']]){
  const row=clone(waitingCurrent);row.id='waiting-'+suffix.toLowerCase();row.productName='合成客服待重新確認 '+suffix;
  row.receipt.sourceNumber='DEV-REPAIR-WAITING-'+suffix;row.repairWorkflow.csr[field]=value;waitingRows.push(row);
}
const state={rows:{'layout-primary':primary,'layout-second':second},waitingRows,gets:[],posts:[],blockedWrites:[]};
window.repairLayoutFixture=state;
export const API_URL='/offline-layout-api';
export default {
  async get(path,options={}){
    state.gets.push({path,params:clone(options.params||{})});
    if(path==='/repair-workbench/todo')return {data:{items:[],total:0,page:1,queueCounts:{todo:2,acceptance:0},countExact:true,unknownCount:0}};
    if(path==='/mailroom/items'){
      if(options.params?.status==='RECEIVED')return {data:{items:[],total:0}};
      const items=options.params?.repairScope==='waiting'?state.waitingRows:Object.values(state.rows);
      return {data:{items:items.map(clone),total:items.length}};
    }
    if(path==='/mailroom/source-cases')return {data:{items:[
      {id:'arrival-long',number:'CASE-20261015-135851-4f47ae620aff',status:'IN_TRANSIT',statusLabel:'逆物流途中',remainingQuantity:1,items:[{name:${JSON.stringify(productName)},quantity:1}]},
      {id:'arrival-multi',number:'DEV-R-003',status:'IN_TRANSIT',statusLabel:'逆物流途中',remainingQuantity:4,items:[{name:'DEV 測試多件維修品',quantity:4}]}],nextCursor:null}};
    const match=path.match(/^\\/repair-workbench\\/items\\/([^/]+)\\/documents$/);
    if(match&&state.rows[match[1]])return {data:clone(state.rows[match[1]])};
    throw Error('Unexpected offline GET '+path);
  },
  async post(path,body){
    if(path!=='/repair-workbench/items/layout-primary/inspection'||body.status!=='DRAFT'||state.posts.length){
      state.blockedWrites.push({path,body:clone(body)});throw Error('Blocked non-fixture write '+path);
    }
    state.posts.push({path,body:clone(body)});
    primary.version++;primary.repairInspection={...primary.repairInspection,revision:primary.repairInspection.revision+1,
      status:'DRAFT',data:clone(body.data),updatedAt:'2026-10-08T04:00:00Z'};
    return {data:{id:primary.id,duplicate:false}};
  }
};
`;

test('actual repair UI keeps product/case legible in constrained layouts and preserves drafts through cancelled exits', {
  skip: !executablePath && 'Requires an existing browser; no installation', timeout: 120000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-repair-ui-layout-'));
  const virtual = '\0repair-ui-layout-fixture';
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-repair-ui-layout',
      resolveId(id) { if (id === 'virtual:repair-ui-layout-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'layout-tech',roles:[],permissions:['repair_workbench:read','repair_workbench:update']}});`;
        if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/services/websocket.service.ts')) return `export const webSocketService={subscribe:callback=>{window.__repairLayoutNotify=callback;return()=>{if(window.__repairLayoutNotify===callback)delete window.__repairLayoutNotify;}}};`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/__repair-ui-layout')) return next();
          try {
            const html = await vite.transformIndexHtml('/__repair-ui-layout', `<html lang="zh-Hant"><head><meta charset="utf-8"><style>
              *{box-sizing:border-box}body{margin:0;background:#f5f6f8}.fixture-shell{min-width:0;padding:24px 24px 24px 264px}
              .fixture-sidebar{position:fixed;inset:0 auto 0 0;width:240px;background:#172534;color:white;padding:24px}
              @media(max-width:767px){.fixture-shell{padding:12px}.fixture-sidebar{display:none}}
              </style></head><body><aside class="fixture-sidebar">合成 240px 工作台側欄</aside><main class="fixture-shell"><div id="root"></div></main>
              <script type="module" src="/@id/virtual:repair-ui-layout-fixture"></script></body></html>`);
            response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }] });
  t.after(async () => { await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [], external = [], networkWrites = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1') { external.push(host); return route.abort(); }
    if (!['GET','HEAD'].includes(request.method())) { networkWrites.push(request.method() + ' ' + request.url()); return route.abort(); }
    return route.continue();
  });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__repair-ui-layout`;
  const assertPageWidth = async () => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'page must not overflow horizontally');
  };
  const assertCleanCopy = async scope => {
    const text = await scope.innerText();
    for (const note of removedNotes) assert(!text.includes(note), 'routine instruction must not be visible: ' + note);
  };
  const assertDrawerWidth = async drawer => {
    const width = await drawer.locator('.ant-drawer-body').evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth }));
    assert(width.scroll <= width.client + 1, 'drawer body must not overflow horizontally: ' + JSON.stringify(width));
    await assertPageWidth();
    assert.equal(await page.locator('.mailroom-heading .ant-typography-secondary').count(),0,'page heading has no explanatory subtitle');
    await assertCleanCopy(page.locator('body'));
  };
  for (const viewport of [{name:'desktop',width:1537,height:972},{name:'comment-desktop',width:1233,height:1066},{name:'compact-desktop',width:1024,height:972},{name:'narrow-desktop',width:900,height:972},{name:'mobile',width:390,height:844}]) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto(url);
    const product = page.getByRole('button', {name:productName,exact:true});
    await product.waitFor();
    const box = await product.boundingBox();
    assert(box && box.width > 200, viewport.name + ': product should occupy a readable width, not a narrow table column');
    assert(box.height < 150, viewport.name + ': product must not become a vertical character column');
    await assertPageWidth();
    assert.equal(await page.locator('.repair-case-open').count(),2);
    assert.equal(await page.locator('.repair-workbench-page > .ant-tabs [role="tab"]').count(),3);
    await page.getByLabel('掃描 QR code 或輸入案件編號',{exact:true}).waitFor();
    const list = page.locator('.repair-workbench-list');
    assert.match(await list.innerText(), new RegExp(caseNumber));
    assert(!(await list.innerText()).includes(sku));assert(!(await list.innerText()).includes(serial));
    await page.screenshot({path:`/tmp/corely-repair-ux-20261029-${viewport.name}-list.png`,fullPage:true,animations:'disabled'});
    if(viewport.name==='compact-desktop')await page.locator('.repair-case-open').first().click();
    else await product.click();
    const drawer = page.locator('.ant-drawer-open');
    try { await drawer.locator('textarea[id$="_complaint"]').waitFor({timeout:10000}); }
    catch(error) {
      await page.screenshot({path:'/tmp/corely-repair-clean-copy-20261008-load-failure.png',fullPage:true});
      t.diagnostic(JSON.stringify({errors,content:await page.locator('body').innerText(),calls:await page.evaluate(()=>window.repairLayoutFixture.gets)}));
      throw error;
    }
    const identity = drawer.locator('.repair-detail-identity');
    assert.match(await identity.innerText(),new RegExp(caseNumber));
    assert((await identity.innerText()).includes(productName));
    assert.equal(await drawer.locator('textarea[id$="_complaint"]').inputValue(),'合成原始故障描述');
    const context=drawer.locator('.repair-case-context');
    await context.getByText(customerIssue,{exact:true}).waitFor();
    await context.getByText('外觀初檢',{exact:true}).waitFor();
    await context.getByText('接線後指示燈未亮',{exact:true}).waitFor();
    assert(!((await context.locator('.repair-customer-issue').innerText()).includes('合成原始故障描述')),'Source issue must stay distinct from technician complaint');
    assert(await context.evaluate(node=>!!(node.compareDocumentPosition(document.querySelector('.repair-documents-layout'))&Node.DOCUMENT_POSITION_FOLLOWING)),'Case context precedes the document editor');
    await assertCleanCopy(drawer);
    assert.equal(await drawer.getByRole('button',{name:'送客服確認',exact:true}).count(),1);
    assert.equal(await drawer.getByRole('button',{name:'開始維修',exact:true}).count(),1);
    for (const name of ['提交客服確認','認領此案件','本人確認實物簽收','複驗完成，交回收發室'])
      assert.equal(await drawer.getByRole('button',{name,exact:true}).count(),0,'action labels remain concise: '+name);
    for(const name of ['收件核對','重現問題','核心檢查','判斷與佐證'])assert(await drawer.getByRole('heading',{name,exact:true}).isVisible());
    const summary = drawer.locator('.repair-detail-summary');
    assert(!(await summary.innerText()).includes(sku));assert(!(await summary.innerText()).includes(serial));
    const dataToggle=drawer.locator('.repair-case-details .ant-collapse-header').filter({hasText:'案件資料與實物保管'});
    await dataToggle.click();
    const actualData=drawer.locator('.repair-case-details');
    assert((await actualData.innerText()).includes(sku));assert((await actualData.innerText()).includes(serial));
    await dataToggle.click();
    assert.equal(await page.evaluate(() => new URLSearchParams(window.repairLayoutRouter.state.location.search).get('itemId')),'layout-primary');
    await assertDrawerWidth(drawer);
    await drawer.getByRole('tab',{name:'維修單',exact:true}).click();
    await drawer.locator('textarea[id$="_workPerformed"]').waitFor();
    assert.equal(await drawer.locator('textarea[id$="_workPerformed"]').inputValue(),'合成保存的實際處置');
    await assertCleanCopy(drawer);
    assert(await drawer.getByRole('heading',{name:'修復與複驗',exact:true}).isVisible());
    assert(await drawer.getByRole('heading',{name:'實際使用零件',exact:true}).isVisible());
    assert(await drawer.getByRole('heading',{name:'修後複驗',exact:true}).isVisible());
    await assertDrawerWidth(drawer);
    await drawer.getByRole('tab',{name:'檢修單',exact:true}).click();
    await drawer.locator('.ant-drawer-body').evaluate(node => { node.scrollTop=0; });
    await page.screenshot({path:`/tmp/corely-repair-ux-20261029-${viewport.name}-drawer.png`,animations:'disabled'});
    assert.equal(await page.evaluate(() => window.repairLayoutFixture.posts.length),0);
  }

  await page.setViewportSize({width:1537,height:972});
  await page.goto(url);
  await page.getByRole('button',{name:productName,exact:true}).waitFor();
  await page.getByRole('button',{name:'篩選',exact:true}).click();
  await page.locator('.repair-query-filter .ant-select-selector').click();
  await page.getByTitle('等待中',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.repair-case-row').length===4);
  const waitingCurrentRow=page.locator('.repair-case-row').filter({hasText:'DEV-REPAIR-WAITING-CURRENT'});
  assert.equal((await waitingCurrentRow.locator('.repair-case-progress').innerText()).trim(),'客服與顧客確認中');
  for(const suffix of ['ESTIMATE','QUOTE','DECISION']){
    const row=page.locator('.repair-case-row').filter({hasText:'DEV-REPAIR-WAITING-'+suffix});
    assert.equal((await row.locator('.repair-case-progress').innerText()).trim(),'客服與顧客確認中');
  }
  assert.equal(await page.evaluate(()=>window.repairLayoutFixture.posts.length),0,'changing lists cannot release or submit a case');
  await assertCleanCopy(page.locator('body'));
  await page.getByRole('tab',{name:/^待認領與簽收/}).click();
  const arrival=page.locator('.repair-arrival-preview');
  const arrivalHeader=arrival.locator('.ant-collapse-header');
  await arrivalHeader.waitFor();
  await arrivalHeader.click();
  try {
    await page.waitForFunction(()=>document.querySelector('.repair-arrival-preview .ant-collapse-header')?.getAttribute('aria-expanded')==='true',undefined,{timeout:5000});
    const arrivalUpdate=arrival.locator('.repair-arrival-toolbar button');
    await arrivalUpdate.waitFor({timeout:5000});
    assert.equal((await arrivalUpdate.innerText()).replace(/\s/g,''),'更新');
  } catch(error) {
    await page.screenshot({path:'/tmp/corely-repair-clean-copy-20261008-arrival-failure.png',fullPage:true});
    t.diagnostic(JSON.stringify({route:await page.evaluate(()=>window.repairLayoutRouter.state.location),arrival:await arrival.innerText(),header:await arrivalHeader.getAttribute('aria-expanded')}));
    throw error;
  }
  for(const viewport of [{width:1233,height:1066},{width:1024,height:972},{width:900,height:972},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await arrival.getByText('CASE-20261015-135851-4f47ae620aff',{exact:true}).waitFor();
    assert.equal(await arrival.locator('.ant-table').count(),0,'Arrival rows avoid nested table/header borders');
    const readable=await arrival.locator('.repair-arrival-number').first().evaluate(node=>({font:parseFloat(getComputedStyle(node).fontSize),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}));
    assert(readable.font>=16&&readable.width>120&&readable.height<120,JSON.stringify({viewport,readable}));
    const toolbar=await arrival.locator('.repair-arrival-toolbar').boundingBox(),first=await arrival.locator('.repair-arrival-row').first().boundingBox();
    assert(toolbar&&first&&toolbar.y+toolbar.height<=first.y,'Arrival update controls must not overlap rows or their separator');
    const quantity=await arrival.locator('.repair-arrival-count').first().boundingBox();
    assert(quantity&&quantity.width>=30,'Quantity remains legible');
    const availableWidth=await arrival.locator('.repair-arrival-list').evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth}));
    assert(availableWidth.scroll<=availableWidth.client+1,'Arrival content must not be clipped inside Collapse: '+JSON.stringify({viewport,...availableWidth}));
    await assertPageWidth();
  }
  await assertCleanCopy(page.locator('body'));

  await page.setViewportSize({width:1024,height:972});
  await page.goto(url);
  await page.getByRole('button',{name:productName,exact:true}).click();
  const drawer = page.locator('.ant-drawer-open');
  const complaint = drawer.locator('textarea[id$="_complaint"]');
  const draft = '合成修改：取消關閉、切頁與路由後仍須保留此故障描述';
  await complaint.fill(draft);
  await complaint.evaluate(node => { window.layoutOriginalTextarea = node; });
  await drawer.getByRole('tab',{name:'維修單',exact:true}).click();
  await drawer.getByRole('tab',{name:'檢修單',exact:true}).click();
  assert.equal(await complaint.inputValue(),draft);
  assert(await complaint.evaluate(node => node === window.layoutOriginalTextarea),'tab switch must preserve mounted inspection form');
  const disclosure = drawer.locator('.repair-case-details .ant-collapse-header').filter({hasText:'交接與處理歷程'});
  const nativeHistory = drawer.locator('.repair-case-details .ant-timeline');
  assert.equal(await nativeHistory.count(),1,'collapsed native history must remain mounted');
  await nativeHistory.evaluate(node => { window.layoutOriginalHistory=node; });
  assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
  await disclosure.click();
  await drawer.getByText('實物紀錄 v7',{exact:false}).waitFor();
  await assertCleanCopy(drawer);
  assert.match(await drawer.innerText(),/DEV-INS-LAYOUT-001/,'native document identity survives copy cleanup');
  assert.equal(await complaint.inputValue(),draft);
  await disclosure.click();
  assert(await complaint.evaluate(node => node === window.layoutOriginalTextarea),'secondary disclosure must not replace the document form');
  assert(await nativeHistory.evaluate(node => node===window.layoutOriginalHistory),'closing history must keep the native history mounted');
  await drawer.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('.ant-modal-confirm .ant-modal-confirm-title').waitFor();
  assert.equal(await page.locator('.ant-modal-confirm .ant-modal-confirm-title').innerText(),'尚有未儲存的修改');
  await page.locator('.ant-modal-confirm').getByRole('button',{name:'繼續編輯',exact:true}).click();
  assert.equal(await complaint.inputValue(),draft);
  await page.evaluate(() => { void window.repairLayoutRouter.navigate('/other'); });
  await page.locator('.ant-modal-confirm').getByRole('button',{name:'繼續編輯',exact:true}).click();
  assert.equal(await complaint.inputValue(),draft);
  assert.equal(await page.evaluate(() => window.repairLayoutRouter.state.location.pathname),'/operations/repair');
  const beforeReload=await page.evaluate(()=>window.repairLayoutFixture.gets.filter(value=>value.path.endsWith('/documents')).length);
  await page.evaluate(()=>window.__repairLayoutNotify({category:'mailroom',data:{itemId:'layout-primary'}}));
  await drawer.getByRole('button',{name:'重新載入',exact:true}).click();
  await page.locator('.ant-modal-confirm .ant-modal-confirm-title').waitFor();
  await page.evaluate(()=>{window.__layoutOldToken=localStorage.getItem('access_token');localStorage.setItem('access_token','synthetic-new-login-token');});
  await page.locator('.ant-modal-confirm').getByRole('button',{name:'放棄修改',exact:true}).click();
  await page.locator('.ant-modal-confirm').waitFor({state:'detached'});
  assert.equal(await complaint.inputValue(),draft,'A confirmation from a superseded login cannot discard the current draft');
  assert.equal(await page.evaluate(()=>window.repairLayoutFixture.gets.filter(value=>value.path.endsWith('/documents')).length),beforeReload,'A stale reload confirmation makes no detail read');
  await page.evaluate(()=>{if(window.__layoutOldToken===null)localStorage.removeItem('access_token');else localStorage.setItem('access_token',window.__layoutOldToken);});
  await drawer.getByRole('button',{name:'儲存草稿',exact:true}).first().click();
  await page.getByText('草稿已儲存',{exact:true}).waitFor();
  const writes = await page.evaluate(() => window.repairLayoutFixture.posts);
  assert.equal(writes.length,1);assert.equal(writes[0].path,'/repair-workbench/items/layout-primary/inspection');
  assert.equal(writes[0].body.entityId,'layout-company');assert.equal(writes[0].body.expectedVersion,7);
  assert.equal(writes[0].body.status,'DRAFT');assert.equal(writes[0].body.data.complaint,draft);
  assert.match(writes[0].body.requestId,/^[A-Za-z0-9_-]{8,80}$/);
  await page.evaluate(() => { void window.repairLayoutRouter.navigate('/other'); });
  await page.getByRole('heading',{name:'合成其他工作台',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.repairLayoutFixture.blockedWrites),[]);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(networkWrites,[]);
});
