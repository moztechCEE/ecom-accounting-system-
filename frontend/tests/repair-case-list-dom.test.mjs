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
const productName = '墨子 MOZTECH 多功能充電器・合成長產品名稱與案件辨識測試';
const caseNumber = 'DEV-LIST-20261008-PRIMARY';
const customerName = '合成顧客甲';
const customerPhone = '0900-000-001';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const queueLabels = { todo: '我的待辦', acceptance: '待認領與簽收', all: '案件查詢' };
const counts = { todo: 73, all: 137, acceptance: 7, mine: 62, waiting: 0, delivery: 12, records: 61 };
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};
window.repairListPhotoUrls={created:[],revoked:[]};
const createObjectURL=URL.createObjectURL.bind(URL),revokeObjectURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createObjectURL(blob);window.repairListPhotoUrls.created.push(url);return url;};
URL.revokeObjectURL=url=>{window.repairListPhotoUrls.revoked.push(url);revokeObjectURL(url);};
const router=createMemoryRouter([{path:'/operations/repair',element:React.createElement(RepairWorkbenchPage)}],
  {initialEntries:['/operations/repair?entityId=company-a']});
window.repairListRouter=router;
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const api = `
const clone=value=>structuredClone(value);
const readError=(message,status=503)=>Object.assign(Error(message),{response:{status,data:{message}}});
const primary={id:'primary',entityId:'company-a',label:'NATIVE-LIST-PRIMARY',productName:${JSON.stringify(productName)},
  sku:'HIDDEN-SKU-PRIMARY',serialNumber:'HIDDEN-SN-PRIMARY',status:'INSPECTING',statusLabel:'檢測中',version:5,
  matchResult:'MATCH',location:'HIDDEN-LOCATION-PRIMARY',custodianId:'list-tech',custodianName:'HIDDEN-CUSTODIAN-PRIMARY',
  repairOwnerId:'list-tech',nextUserId:null,nextUserName:null,recipientId:null,mine:false,evidenceCount:1,
  physicalCustody:'TECHNICIAN',editable:false,allowedWorkflowActions:[],
  repairOverview:{customerName:${JSON.stringify(customerName)},customerPhone:${JSON.stringify(customerPhone)},photoUrl:'/mailroom/items/primary/repair-photo'},
  receipt:{number:'DEV-RCPT-LIST-PRIMARY',category:'REPAIR',sourceCaseId:'source-primary',sourceNumber:${JSON.stringify(caseNumber)},
    customerServiceUserId:'list-csr',carrier:'合成承運商',trackingNumber:'IN-LIST-001',senderLabel:'HIDDEN-SENDER-PRIMARY',receivedAt:'2026-10-08T02:00:00Z'},
  repairInspection:{number:'HIDDEN-INSPECTION-PRIMARY',revision:17,status:'DRAFT',authorId:'list-tech',authorName:'合成技師',
    updatedAt:'2026-10-08T03:00:00Z',data:{complaint:'合成故障描述',reproduction:'NOT_TESTED',testConditions:'合成檢測條件',
      checks:[],diagnosis:'合成診斷',causeStatus:'UNKNOWN',plan:'REPAIR',planNote:'合成建議',feeSuggestion:'REVIEW',estimateNote:''}},
  repairReport:null,repairWorkflow:{},history:[],deliverySummary:[]};
const missing={...clone(primary),id:'missing-photo',productName:'邦森居家用品・合成風扇',receipt:{...clone(primary.receipt),sourceNumber:'DEV-LIST-MISSING'},
  repairOverview:{customerName:null,customerPhone:null,photoUrl:null}};
const broken={...clone(primary),id:'broken-photo',productName:'合成破圖案件',receipt:{...clone(primary.receipt),sourceNumber:'DEV-LIST-BROKEN'},
  repairOverview:{customerName:'合成顧客乙',customerPhone:'0900-000-002',photoUrl:'/mailroom/items/broken-photo/repair-photo'}};
const unsafe={...clone(primary),id:'unsafe-photo',productName:'合成無效圖片案件',receipt:{...clone(primary.receipt),sourceNumber:'DEV-LIST-UNSAFE'},
  repairOverview:{customerName:'合成顧客丙',customerPhone:'0900-000-003',photoUrl:'javascript:window.__unsafePhotoExecuted=true'}};
const second={...clone(primary),id:'company-b-item',entityId:'company-b',productName:'公司乙合成產品',
  receipt:{...clone(primary.receipt),sourceNumber:'DEV-LIST-COMPANY-B'},
  repairOverview:{customerName:'公司乙合成顧客',customerPhone:'0900-000-099',photoUrl:null}};
const pageTwo={...clone(primary),id:'page-two',productName:'合成第二頁產品',receipt:{...clone(primary.receipt),sourceNumber:'DEV-LIST-PAGE-TWO'}};
const queueCounts=${JSON.stringify(counts)};
const documents=Object.fromEntries([primary,missing,broken,unsafe,second,pageTwo].map(item=>[item.id,item]));
const scenario=new URL(location.href).searchParams.get('scenario')||'normal';
const photoBlob=()=>new Blob([Uint8Array.from(atob(${JSON.stringify(image.split(',')[1])}),character=>character.charCodeAt(0))],{type:'image/png'});
const state={gets:[],posts:[],plans:[],held:{},photoGets:[],photoHeld:{},scenario,documents,
  plan(name,match,mode='hold',data){this.plans.push({name,match,mode,data});},
  settle(name,data){const pending=this.held[name];if(!pending)throw Error('No held request '+name);delete this.held[name];pending.resolve({data:clone(data??pending.data)});},
  fail(name,message='合成讀取失敗'){const pending=this.held[name];if(!pending)throw Error('No held request '+name);delete this.held[name];pending.reject(readError(message));},
  result(params={}){
    const entity=params.entityId||'company-a';
    if(entity==='company-b')return {items:params.summary==='true'?[]:[clone(second)],total:9,queueCounts:{todo:9,all:9,acceptance:0,mine:9,waiting:0,delivery:3,records:0},countExact:true,unknownCount:0};
    const scope=params.repairScope||'todo';
    const items=params.page===2?[pageTwo]:params.search?[primary]:[primary,missing,broken,unsafe];
    const result={items:params.summary==='true'?[]:items.map(clone),total:params.search?1:queueCounts[scope],queueCounts:clone(queueCounts),countExact:true,unknownCount:0};
    if(scenario==='missing-counts')delete result.queueCounts;
    if(scenario==='partial-counts')result.queueCounts={todo:73,all:137,waiting:0,delivery:12};
    return result;
  }};
window.repairListFixture=state;
export const API_URL='/offline-repair-list-api';
export default {
  async get(path,options={}){
    const params=clone(options.params||{});if(path==='/repair-workbench/todo')params.repairScope='todo';state.gets.push({path,params,requestParams:clone(options.params||{})});
    const photo=path.match(/^\\/mailroom\\/items\\/([^/]+)\\/repair-photo$/);
    if(photo){
      const request={path,params,responseType:options.responseType,aborted:options.signal?.aborted===true};state.photoGets.push(request);
      options.signal?.addEventListener('abort',()=>{request.aborted=true;},{once:true});
      if(scenario==='held-photo'&&photo[1]==='primary')return await new Promise(resolve=>{state.photoHeld.primary=()=>resolve({data:photoBlob()});});
      return {data:photo[1]==='broken-photo'?new Blob(['invalid synthetic image'],{type:'image/png'}):photoBlob()};
    }
    if(path==='/mailroom/source-cases')return {data:{items:[],nextCursor:null}};
    const detail=path.match(/^\\/repair-workbench\\/items\\/([^/]+)\\/documents$/);
    if(detail&&documents[detail[1]])return {data:clone(documents[detail[1]])};
    if(path!=='/mailroom/items'&&path!=='/repair-workbench/todo')throw Error('Unexpected offline GET '+path);
    if(scenario==='initial-failure')throw readError('合成首次讀取失敗');
    const planned=state.plans.findIndex(plan=>Object.entries(plan.match).every(([key,value])=>params[key]===value));
    if(planned>=0){
      const plan=state.plans.splice(planned,1)[0],data=plan.data??state.result(params);
      if(plan.mode==='forbidden')throw readError('合成權限已撤銷',403);
      if(plan.mode==='fail')throw readError('合成指定讀取失敗');
      if(plan.mode==='hold')return await new Promise((resolve,reject)=>{state.held[plan.name]={resolve,reject,data};});
      return {data:clone(data)};
    }
    return {data:state.result(params)};
  },
  async post(path,body){state.posts.push({path,body:clone(body)});throw Error('Business writes blocked in offline fixture');}
};
`;

test('actual repair list uses concise case identity and server queue totals across layouts and asynchronous reads', {
  skip: !executablePath && 'Requires an existing browser; no installation', timeout: 120000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-repair-case-list-'));
  const virtual = '\0repair-case-list-fixture';
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-repair-case-list',
      resolveId(id) { if (id === 'virtual:repair-case-list-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'list-tech',roles:[],permissions:['repair_workbench:read']}});`;
        if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/services/websocket.service.ts')) return `export const webSocketService={subscribe:()=>()=>{}};`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/__repair-case-list')) return next();
          try {
            const html = await vite.transformIndexHtml('/__repair-case-list', `<html lang="zh-Hant"><head><meta charset="utf-8"><style>
              *{box-sizing:border-box}body{margin:0;background:#f5f6f8}.fixture-shell{min-width:0;padding:24px 24px 24px 264px}
              .fixture-sidebar{position:fixed;inset:0 auto 0 0;width:240px;background:#172534;color:white;padding:24px}
              @media(max-width:767px){.fixture-shell{padding:12px}.fixture-sidebar{display:none}}
              </style></head><body><aside class="fixture-sidebar">合成工作台側欄</aside><main class="fixture-shell"><div id="root"></div></main>
              <script type="module" src="/@id/virtual:repair-case-list-fixture"></script></body></html>`);
            response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }] });
  t.after(async () => { await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const errors = [], external = [], networkWrites = [];
  const createPage = async (scenario = 'normal', viewport = { width: 1537, height: 972 }) => {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      const host = new URL(request.url()).hostname;
      if (host !== '127.0.0.1') { external.push(host); return route.abort(); }
      if (!['GET', 'HEAD'].includes(request.method())) { networkWrites.push(request.method() + ' ' + request.url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__repair-case-list?scenario=${scenario}`);
    return page;
  };
  const tabLabel = (page, queue) => page.locator('.repair-tab-label').filter({ hasText: queueLabels[queue] });
  const assertCounts = async (page, expected = counts) => {
    assert.equal(await page.locator('.repair-tab-label').count(), 3, 'only the three workbench tabs remain');
    assert.equal(await tabLabel(page, 'all').locator('.ant-badge-count').count(), 0, 'case query is not an urgent notification badge');
    for (const queue of ['todo', 'acceptance']) {
      const count = expected[queue];
      const label = tabLabel(page, queue);
      assert.equal(await label.count(), 1, queue + ': one tab label');
      if (count > 0) assert.equal(await label.locator(`[aria-label="${count} 件"]`).count(), 1, queue + ': server count must be visible and accessible');
      else assert.equal(await label.locator('.ant-badge-count').count(), 0, queue + ': zero has no red badge');
    }
  };
  const assertNoPriorCompany = async page => {
    const list = page.locator('.repair-workbench-list');
    const text = await list.innerText();
    for (const value of [productName, caseNumber, customerName, customerPhone]) assert(!text.includes(value), 'previous company identity must disappear: ' + value);
    assert.equal(await page.locator('.repair-tab-label [aria-label="73 件"]').count(), 0, 'previous company counts must disappear');
  };

  await t.test('six requested fields stay legible, photos fall back, and native details open at three widths', async () => {
    for (const viewport of [{ width: 1537, height: 972 }, { width: 1104, height: 1056 }, { width: 390, height: 844 }]) {
      const page = await createPage('normal', viewport);
      try {
        await page.getByRole('button', { name: productName, exact: true }).waitFor();
        const row = page.locator('.repair-case-row').filter({ hasText: caseNumber });
        const text = await row.innerText();
        for (const value of [productName, caseNumber, customerName, customerPhone, '檢測中']) assert(text.includes(value), 'requested case field: ' + value);
        const listText = await page.locator('.repair-workbench-list').innerText();
        for (const value of ['HIDDEN-SKU', 'HIDDEN-SN', 'HIDDEN-LOCATION', 'HIDDEN-CUSTODIAN', 'HIDDEN-SENDER', 'HIDDEN-INSPECTION', '尚無維修單', '檢修單 v17'])
          assert(!listText.includes(value), 'secondary data must stay out of list: ' + value);
        await assertCounts(page);
        const titleBox = await row.locator('.repair-product-title').boundingBox();
        assert(titleBox && titleBox.width > 180 && titleBox.height < 150, 'case name remains readable at ' + viewport.width);
        if (viewport.width === 390) {
          const headingBox = await page.locator('.mailroom-heading').boundingBox();
          assert(headingBox && headingBox.height > 0 && headingBox.height < 140, 'mobile heading must not reserve a large blank column: ' + JSON.stringify(headingBox));
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'page must not overflow at ' + viewport.width);
        await page.waitForFunction(() => {
          const row = [...document.querySelectorAll('.repair-case-row')].find(node => node.textContent.includes('DEV-LIST-20261008-PRIMARY'));
          const image = row?.querySelector('.repair-case-photo img');
          return image?.complete && image.naturalWidth > 0;
        });
        for (const number of ['DEV-LIST-MISSING', 'DEV-LIST-BROKEN', 'DEV-LIST-UNSAFE']) {
          const photo = page.locator('.repair-case-row').filter({ hasText: number }).locator('.repair-case-photo');
          assert.equal(await photo.count(), 1, number + ': photo position is retained');
          await photo.scrollIntoViewIfNeeded();
          await page.waitForFunction(number => {
            const row = [...document.querySelectorAll('.repair-case-row')].find(node => node.textContent.includes(number));
            const img = row?.querySelector('.repair-case-photo img');
            return !img || getComputedStyle(img).display === 'none' || getComputedStyle(img).visibility === 'hidden';
          }, number);
          const box = await photo.boundingBox();
          assert(box && box.width >= 40 && box.height >= 40, number + ': fallback has stable size');
        }
        assert.equal(await page.evaluate(() => window.__unsafePhotoExecuted === true), false);
        const photos = await page.evaluate(() => window.repairListFixture.photoGets);
        assert(photos.some(value => value.path === '/mailroom/items/primary/repair-photo' && value.params.entityId === 'company-a' && value.responseType === 'blob'), 'photo is fetched through the authenticated API in current company');
        assert(!photos.some(value => value.path.includes('missing-photo') || value.path.includes('unsafe-photo')), 'missing and unsafe photos make no API request');
        assert((await row.locator('.repair-case-photo img').getAttribute('src')).startsWith('blob:'), 'thumbnail uses fetched Blob URL');
        await page.screenshot({ path: `/tmp/repair-case-list-20261008-${viewport.width}.png`, fullPage: true });
        await row.locator('.repair-case-open').click();
        await page.locator('.ant-drawer-open .repair-detail-identity').getByText(productName, { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => new URLSearchParams(window.repairListRouter.state.location.search).get('itemId')), 'primary');
        const gets = await page.evaluate(() => window.repairListFixture.gets);
        assert(gets.some(value => value.path === '/repair-workbench/items/primary/documents' && value.params.entityId === 'company-a'));
        assert.equal(await page.evaluate(() => window.repairListFixture.posts.length), 0);
      } finally { await page.close(); }
    }
  });

  await t.test('page and search totals do not replace the global actionable queue counts', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: productName, exact: true }).waitFor();
      await assertCounts(page);
      await page.locator('.repair-case-pagination .ant-pagination-item-2').click();
      await page.getByRole('button', { name: '合成第二頁產品', exact: true }).waitFor();
      await assertCounts(page);
      const search = page.locator('.repair-workbench-search input');
      await search.fill('合成顧客'); await search.press('Enter');
      await page.getByRole('button', { name: productName, exact: true }).waitFor();
      await page.waitForFunction(() => window.repairListFixture.gets.some(value => value.params.search === '合成顧客' && value.params.page === 1));
      assert.equal(await page.locator('.repair-case-row').count(), 1);
      await assertCounts(page);
      await tabLabel(page, 'acceptance').click();
      await page.waitForFunction(() => window.repairListFixture.gets.some(value => value.params.repairScope === 'acceptance'));
      await assertCounts(page);
      assert.equal(await page.evaluate(() => window.repairListFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('missing count projections never fabricate zero or derive counts from rows', async () => {
    for (const scenario of ['missing-counts', 'partial-counts']) {
      const page = await createPage(scenario);
      try {
        await page.getByRole('button', { name: productName, exact: true }).waitFor();
        if (scenario === 'missing-counts') assert.equal(await page.locator('.repair-tab-label .ant-badge-count').count(), 0);
        else {
          await assertCounts(page, { todo: 73 });
          assert.equal(await tabLabel(page, 'acceptance').locator('.ant-badge-count').count(), 0, 'unknown acceptance has no invented badge');
        }
        assert.equal(await page.locator('.repair-tab-label [aria-label="4 件"]').count(), 0, 'loaded row count is not a queue count');
      } finally { await page.close(); }
    }
  });

  await t.test('late old-company success cannot overwrite new-company failure or recovered data', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: productName, exact: true }).waitFor();
      await page.evaluate(() => {
        window.repairListFixture.plan('old-a', { entityId: 'company-a' });
        window.repairListFixture.plan('new-b', { entityId: 'company-b' });
      });
      await page.locator('.mailroom-heading button').click();
      await page.waitForFunction(() => !!window.repairListFixture.held['old-a']);
      await page.evaluate(() => window.repairListRouter.navigate('/operations/repair?entityId=company-b'));
      await page.waitForFunction(() => !!window.repairListFixture.held['new-b']);
      await assertNoPriorCompany(page);
      await page.evaluate(() => window.repairListFixture.fail('new-b', '合成公司乙讀取失敗'));
      await page.getByText('合成公司乙讀取失敗', { exact: true }).waitFor();
      await assertNoPriorCompany(page);
      assert.equal(await page.getByText('此分類目前沒有案件', { exact: true }).count(), 0, 'read failure is not a known empty queue');
      await page.evaluate(() => window.repairListFixture.settle('old-a'));
      await page.getByText('合成公司乙讀取失敗', { exact: true }).waitFor();
      await assertNoPriorCompany(page);
      await page.locator('.mailroom-heading button').click();
      await page.getByRole('button', { name: '公司乙合成產品', exact: true }).waitFor();
      await assertCounts(page, { todo: 9, acceptance: 0 });
      const text = await page.locator('.repair-workbench-list').innerText();
      assert(text.includes('公司乙合成顧客')); assert(text.includes('0900-000-099'));
      await assertNoPriorCompany(page);
      assert.equal(await page.getByText('合成公司乙讀取失敗', { exact: true }).count(), 0);
    } finally { await page.close(); }
  });

  await t.test('old search response cannot replace a newer queue or its server counts', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: productName, exact: true }).waitFor();
      await page.evaluate(() => window.repairListFixture.plan('old-search', { entityId: 'company-a', repairScope: 'todo', search: '舊搜尋' }));
      const search = page.locator('.repair-workbench-search input');
      await search.fill('舊搜尋'); await search.press('Enter');
      await page.waitForFunction(() => !!window.repairListFixture.held['old-search']);
      await tabLabel(page, 'all').click();
      await page.waitForFunction(() => window.repairListFixture.gets.some(value => value.params.repairScope === 'all'));
      await assertCounts(page);
      await page.evaluate(() => window.repairListFixture.settle('old-search', {
        items: [], total: 0, queueCounts: { todo: 999, all: 999, acceptance: 999, mine: 999, waiting: 999, delivery: 999, records: 999 },
      }));
      await assertCounts(page);
      assert.equal(await page.locator('.repair-tab-label [aria-label="999 件"]').count(), 0);
      assert.equal(await page.locator('.repair-case-row').count(), 1, 'current queue/search rows survive stale response');
    } finally { await page.close(); }
  });

  await t.test('initial read failure has no fake empty queue or badge counts', async () => {
    const page = await createPage('initial-failure');
    try {
      await page.getByText('合成首次讀取失敗', { exact: true }).waitFor();
      assert.equal(await page.locator('.repair-case-row').count(), 0);
      assert.equal(await page.locator('.repair-tab-label .ant-badge-count').count(), 0);
      assert.equal(await page.getByText('此分類目前沒有案件', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.repairListFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('photo read is aborted when company changes and its late blob cannot enter another company', async () => {
    const page = await createPage('held-photo');
    try {
      await page.getByRole('button', { name: productName, exact: true }).waitFor();
      await page.waitForFunction(() => !!window.repairListFixture.photoHeld.primary);
      await page.evaluate(() => window.repairListRouter.navigate('/operations/repair?entityId=company-b'));
      await page.getByRole('button', { name: '公司乙合成產品', exact: true }).waitFor();
      await page.waitForFunction(() => window.repairListFixture.photoGets.some(value => value.path === '/mailroom/items/primary/repair-photo' && value.aborted));
      await page.evaluate(() => window.repairListFixture.photoHeld.primary());
      await assertNoPriorCompany(page);
      assert.equal(await page.locator('.repair-case-photo img').count(), 0, 'old native photo cannot appear in new company');
      assert.equal(await page.evaluate(() => window.repairListFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('refreshing the same photo endpoint at a new item version reloads and revokes the prior Blob URL', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: productName, exact: true }).waitFor();
      const row = page.locator('.repair-case-row').filter({ hasText: caseNumber });
      await page.waitForFunction(() => {
        const row = [...document.querySelectorAll('.repair-case-row')].find(node => node.textContent.includes('DEV-LIST-20261008-PRIMARY'));
        const img = row?.querySelector('.repair-case-photo img');
        return img?.complete && img.naturalWidth > 0;
      });
      const priorUrl = await row.locator('.repair-case-photo img').getAttribute('src');
      assert.equal(await page.evaluate(() => window.repairListFixture.photoGets.filter(value => value.path === '/mailroom/items/primary/repair-photo').length), 1);
      await page.evaluate(() => { window.repairListFixture.documents.primary.version++; });
      await page.locator('.mailroom-heading button').click();
      await page.waitForFunction(priorUrl => {
        const row = [...document.querySelectorAll('.repair-case-row')].find(node => node.textContent.includes('DEV-LIST-20261008-PRIMARY'));
        const img = row?.querySelector('.repair-case-photo img');
        return img?.complete && img.naturalWidth > 0 && img.src !== priorUrl;
      }, priorUrl);
      const newUrl = await row.locator('.repair-case-photo img').getAttribute('src');
      assert.notEqual(newUrl, priorUrl, 'updated case version receives a newly fetched Blob');
      const proof = await page.evaluate(() => ({ requests: window.repairListFixture.photoGets.filter(value => value.path === '/mailroom/items/primary/repair-photo'), ...window.repairListPhotoUrls }));
      assert.equal(proof.requests.length, 2, 'same native endpoint is fetched again after its case version changes');
      assert(proof.requests.every(value => value.params.entityId === 'company-a' && value.responseType === 'blob'));
      assert(proof.revoked.includes(priorUrl), 'old case image Blob URL is released');
      assert(proof.created.includes(newUrl), 'new case image Blob URL comes from the fetched payload');
      assert(!proof.revoked.includes(newUrl), 'new active case image stays available');
      await assertCounts(page);
      assert.equal(await page.evaluate(() => window.repairListFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  await t.test('a forbidden list refresh removes the previous contact and photo and releases its Blob URL', async () => {
    const page = await createPage();
    try {
      await page.getByRole('button', { name: productName, exact: true }).waitFor();
      await page.waitForFunction(() => {
        const row = [...document.querySelectorAll('.repair-case-row')].find(node => node.textContent.includes('DEV-LIST-20261008-PRIMARY'));
        const img = row?.querySelector('.repair-case-photo img');
        return img?.complete && img.naturalWidth > 0;
      });
      const priorUrl = await page.locator('.repair-case-row').filter({ hasText: caseNumber }).locator('.repair-case-photo img').getAttribute('src');
      await assertCounts(page);
      await page.evaluate(() => window.repairListFixture.plan('forbidden', { entityId: 'company-a' }, 'forbidden'));
      await page.locator('.mailroom-heading button').click();
      await page.getByText('合成權限已撤銷', { exact: true }).waitFor();
      await assertNoPriorCompany(page);
      assert.equal(await page.locator('.repair-case-row').count(), 0, 'permission rejection unmounts the previously allowed cases');
      assert.equal(await page.locator('.repair-case-photo').count(), 0, 'permission rejection unmounts the previous photos');
      assert.equal(await page.locator('.repair-tab-label .ant-badge-count').count(), 0, 'permission rejection clears previous counts');
      assert.equal(await page.getByText('此分類目前沒有案件', { exact: true }).count(), 0, 'permission rejection is not a successful empty queue');
      await page.waitForFunction(priorUrl => window.repairListPhotoUrls.revoked.includes(priorUrl), priorUrl);
      assert.equal(await page.evaluate(() => window.repairListFixture.posts.length), 0);
    } finally { await page.close(); }
  });

  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(networkWrites, []);
});
