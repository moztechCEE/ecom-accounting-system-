import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const artifactDir = mkdtempSync(join(tmpdir(), 'repair-precheck-reader-dom-'));
const itemId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const deniedId = '33333333-3333-4333-8333-333333333333';
const company = 'precheck-company';
const companyB = 'precheck-company-b';
const title = '墨子合成維修產品・原案件';
const draftSecret = 'DO_NOT_RENDER_DRAFT_SECRET';
const photoIds = ['a'.repeat(64), 'b'.repeat(64)];
const photoPath = (photoId, revision = 7, id = itemId) => `/mailroom/prechecks/items/${id}/recorded-photos/${photoId}?revision=${revision}`;
const precheckContract = {
  schema: 1, entityId: company, itemId, stage: 'SUBMITTED', revision: 7,
  savedByName: '合成初檢記錄人', savedAt: '2026-10-16T01:02:03.000Z', submittedAt: '2026-10-16T02:03:04.000Z',
  recorded: { id: '44444444-4444-4444-8444-444444444444', revision: 7,
    template: { id: '55555555-5555-4555-8555-555555555555', revision: 2, contentHash: 'c'.repeat(64), title: '合成收發初檢標準' },
    savedByName: '合成初檢記錄人', savedAt: '2026-10-16T01:02:03.000Z', submittedAt: '2026-10-16T02:03:04.000Z', notRequiredReason: null,
    checks: [{ key: 'power', label: '合成通電檢查', result: 'NORMAL', note: '合成電源觀察', photoIds: [photoIds[0]] },
      { key: 'screen', label: '合成顯示檢查', result: 'ABNORMAL', note: '合成螢幕異常', photoIds: [photoIds[1]] },
      { key: 'water', label: '合成防水檢查', result: 'NOT_TESTED', note: '合成缺少防水設備', photoIds: [] },
      { key: 'battery', label: '合成電池檢查', result: 'NOT_APPLICABLE', note: '合成此型號無電池', photoIds: [] }],
    photos: photoIds.map((id, index) => ({ id, digest: (index ? 'e' : 'd').repeat(64), url: photoPath(id) })),
  },
};
const measuredFiles = ['src/pages/repair/RepairPrecheckReadOnly.tsx', 'src/pages/repair/RepairWorkbenchPage.tsx',
  'src/pages/repair/RepairPrecheckQueue.tsx',
  'src/pages/repair/repair-model.ts', 'src/pages/mailroom/mailroom-precheck-record.ts',
  'src/pages/mailroom/MailroomItemScan.tsx', 'src/utils/mailroom-item-link.ts'];
const hashes = () => Object.fromEntries(measuredFiles.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));

// Scope: real precheck view and real page/scan/router/API client; formal document,
// readiness, workflow and standard-manager children are isolated below. The raw
// mailroomPrecheck field follows the shared contract and the real adapter is used.
// No provider, public photo URL or successful write endpoint is substituted.
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
import RepairPrecheckReadOnly from '/src/pages/repair/RepairPrecheckReadOnly.tsx';
import {repairPrecheckView} from '/src/pages/repair/repair-model.ts';
window.__APP_CONFIG__={mailroomEnabled:true};
const submitted=${JSON.stringify(precheckContract)};
window.precheckReaderRecord=submitted;
const originalCreate=URL.createObjectURL.bind(URL),originalRevoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=originalCreate(blob);window.precheckReaderApi.created.push({url,type:blob.type,size:blob.size});return url;};
URL.revokeObjectURL=url=>{window.precheckReaderApi.revoked.push(url);originalRevoke(url);};
function Pure(){const encoded=new URL(location.href).searchParams.get('payload');const[record,setRecord]=useState(()=>encoded?JSON.parse(encoded).value:submitted);
const[scope,setScope]=useState({entityId:'${company}',itemId:'${itemId}'}),[mounted,setMounted]=useState(true);
window.setPrecheckReaderRecord=next=>setRecord(next);window.setPrecheckReaderScope=next=>setScope(next);window.setPrecheckReaderMounted=next=>setMounted(next);
return <main className="pure-shell">{mounted&&<RepairPrecheckReadOnly record={repairPrecheckView(record,scope.entityId,scope.itemId)} entityId={scope.entityId} itemId={scope.itemId}/>}</main>}
const pure=new URL(location.href).searchParams.get('mode')==='pure';
if(pure)createRoot(document.getElementById('root')).render(<Pure/>);
else{const entry=new URL(location.href).searchParams.get('entry')||'/operations/repair?entityId=${company}';
const router=createMemoryRouter([{path:'/operations/repair',element:<RepairWorkbenchPage/>}],{initialEntries:[entry]});window.precheckReaderRouter=router;
createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);}
`;
const api = `
const clone=value=>structuredClone(value);
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const blob=mode=>new Blob([Uint8Array.from(atob(png),character=>character.charCodeAt(0))],{type:mode==='mime'?'text/html':'image/png'});
const photoMode=new URL(location.href).searchParams.get('photoMode')||'png';
const queueScenario=new URL(location.href).searchParams.get('queueScenario')||'normal';
window.precheckReaderApi={gets:[],posts:[],created:[],revoked:[],aborts:[],held:[],heldDetails:[],holdDetails:false,readerRenders:[],detailRenders:[],photoMode,formalProps:[],queueScenario,queuePlans:[],heldQueues:[],
planQueue(match,mode='hold'){this.queuePlans.push({match,mode});},
releaseQueue(index){const pending=this.heldQueues[index];if(!pending)throw Error('Missing held queue '+index);pending.resolve({data:clone(pending.data)});},
releasePhoto(index,mode='png'){const pending=this.held[index];if(!pending)throw Error('Missing held photo '+index);pending.resolve({data:blob(mode)});},
releaseDetail(index){const pending=this.heldDetails[index];if(!pending)throw Error('Missing held detail '+index);pending.resolve({data:clone(pending.data)});}};
const record={id:'${itemId}',entityId:'${company}',label:'SYNTHETIC-NATIVE-ITEM',productName:${JSON.stringify(title)},
sku:'SYNTHETIC-SKU',serialNumber:'SYNTHETIC-SN',status:'WAITING_REPAIR_ACCEPTANCE',statusLabel:'待維修師認領',version:4,
location:'合成收件位置',custodianId:'synthetic-clerk',custodianName:'合成收發同仁',repairOwnerId:null,nextUserId:null,nextUserName:null,
physicalCustody:'MAILROOM',editable:false,allowedWorkflowActions:[],matchResult:'MATCH',evidenceCount:0,
repairOverview:{customerName:'合成顧客',customerPhone:'0900-000-000',photoUrl:null},
receipt:{number:'SYNTHETIC-MR-ORIGINAL',category:'REPAIR',sourceCaseId:'synthetic-source',sourceNumber:'SYNTHETIC-ORIGINAL-CASE',customerServiceUserId:'synthetic-csr'},
repairInspection:null,repairReport:null,repairWorkflow:{},history:[],deliverySummary:[],mailroomPrecheck:${JSON.stringify(precheckContract)}};
if(new URL(location.href).searchParams.get('editable')==='1')Object.assign(record,{status:'INSPECTING',statusLabel:'檢測中',repairOwnerId:'synthetic-technician',custodianId:'synthetic-technician',editable:true,physicalCustody:'TECHNICIAN'});
const encoded=new URL(location.href).searchParams.get('payload');if(encoded)record.mailroomPrecheck=JSON.parse(encoded).value;
const queueRow=(id,name,stage,entityId='${company}')=>({...clone(record),id,entityId,status:'RECEIVED',productName:name,
receipt:{...clone(record.receipt),sourceNumber:'SYNTHETIC-PREVIEW-'+id.slice(0,8)},
precheck:{stage,revision:stage==='NOT_STARTED'?0:3,savedById:stage==='NOT_STARTED'?null:'synthetic-clerk',savedByName:stage==='NOT_STARTED'?null:entityId==='${companyB}'?'合成乙公司初檢人':'合成待交接初檢人',savedAt:stage==='NOT_STARTED'?null:'2026-10-16T01:02:03.000Z',submittedAt:null,
draft:{note:'${draftSecret}'},checks:[{label:'${draftSecret}'}],photos:['${draftSecret}']}});
function queueResult(params){
 if(params.entityId==='${companyB}')return {items:[queueRow('${otherId}','乙公司合成已收維修產品','DRAFT','${companyB}')],total:7,queueCounts:{all:9876,todo:4321}};
 if(params.page===2)return {items:[queueRow('${otherId}','合成第二頁待交接產品','READY')],total:123,queueCounts:{all:9876,todo:4321}};
 const rows=[queueRow('${itemId}','合成初檢中產品','DRAFT'),queueRow('${otherId}','合成完成待交接產品','READY'),queueRow('66666666-6666-4666-8666-666666666666','合成尚未初檢產品','NOT_STARTED')];
 rows[2].receipt.category='RETURN';rows[2].repairOwnerId='synthetic-technician';rows[2].productName='合成已認領整新初檢產品';
 if(window.precheckReaderApi.queueScenario==='unknown')delete rows[2].precheck;
 return {items:rows,total:123,queueCounts:{all:9876,todo:4321}};
}
export const API_URL='/offline-precheck-reader';
export default {
async get(path,options={}){const params=clone(options.params||{}),state=window.precheckReaderApi;
const photo=path.startsWith('/mailroom/prechecks/items/');state.gets.push({path,params,...(photo?{responseType:options.responseType,hasSignal:Boolean(options.signal)}:{})});
if(photo){if(options.signal)options.signal.addEventListener('abort',()=>state.aborts.push(path),{once:true});
if(state.photoMode==='403')throw Object.assign(Error('合成照片無存取權'),{response:{status:403,data:{message:'合成照片無存取權'}}});
if(state.photoMode==='hold')return await new Promise(resolve=>state.held.push({path,signal:options.signal,resolve}));
return {data:blob(state.photoMode)};}
if(path==='/mailroom/items'&&params.status==='RECEIVED'){
const data=queueResult(params),index=state.queuePlans.findIndex(plan=>Object.entries(plan.match).every(([key,value])=>params[key]===value));
if(index>=0){const plan=state.queuePlans.splice(index,1)[0];if(plan.mode==='fail')throw Object.assign(Error('合成初檢清單讀取失敗'),{response:{status:503,data:{message:'合成初檢清單讀取失敗'}}});return await new Promise(resolve=>state.heldQueues.push({resolve,data,params}));}
if(state.queueScenario==='fail')throw Object.assign(Error('合成初檢清單讀取失敗'),{response:{status:503,data:{message:'合成初檢清單讀取失敗'}}});
if(state.queueScenario==='hold-a'&&params.entityId==='${company}')return await new Promise(resolve=>state.heldQueues.push({resolve,data,params}));
return {data};}
if(path==='/mailroom/items'||path==='/repair-workbench/todo')return {data:{items:[],total:0,queueCounts:{todo:0,acceptance:0,all:0},countExact:true,unknownCount:0}};
if(path==='/mailroom/source-cases')return {data:{items:[],nextCursor:null}};
const match=path.match(/^\\/repair-workbench\\/items\\/([^/]+)\\/documents$/);
if(match){if(params.entityId!=='${company}'||match[1]==='${deniedId}')throw Object.assign(Error('合成案件無存取權'),{response:{status:403,data:{message:'合成案件無存取權'}}});
if(!['${itemId}','${otherId}'].includes(match[1]))throw Error('Unexpected synthetic item '+match[1]);
const data={...clone(record),id:match[1],productName:match[1]==='${otherId}'?'墨子合成另一原案件':record.productName};
if(match[1]==='${otherId}'&&data.mailroomPrecheck?.recorded){const precheck=data.mailroomPrecheck;precheck.itemId=match[1];
precheck.savedByName=precheck.recorded.savedByName='合成另一案件初檢記錄人';precheck.recorded.photos.forEach(photo=>{photo.url=photo.url.replace('${itemId}',match[1]);});}
if(state.holdDetails&&match[1]==='${otherId}')return await new Promise(resolve=>state.heldDetails.push({resolve,data}));
return {data};}
throw Error('Unexpected offline GET '+path);},
async post(path,body){window.precheckReaderApi.posts.push({path,body:clone(body)});throw Error('No business writes are permitted in the precheck reader fixture');}
};`;

test('repair precheck read-only view and actual scan/deeplink reader use native scoped GET only', {
  timeout: 180000, skip: !executablePath && 'Requires an existing browser; no installation',
}, async t => {
  const sourceBefore = hashes();
  const cacheDir = mkdtempSync(join(tmpdir(), 'repair-precheck-vite-'));
  const virtual = '\0repair-precheck-reader-fixture';
  const server = await createServer({ root, cacheDir, configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [react(), {
      name: 'offline-repair-precheck-reader',
      resolveId(id) { if (id === 'virtual:repair-precheck-reader-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'synthetic-technician',roles:[],permissions:['repair_workbench:read','repair_workbench:update']}});`;
        if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/services/websocket.service.ts')) return `export const webSocketService={subscribe:()=>()=>{}};`;
        // Capture the component's genuine callback for dirty-state cases while
        // the drawer mask covers the background. Those cases are not claimed
        // to be reachable by pointer scanning through the mask.
        if (id.endsWith('/src/pages/mailroom/MailroomItemScan.tsx')) return `import React,{useLayoutEffect} from 'react';import Actual from '/src/pages/mailroom/MailroomItemScan.tsx?scanActual';export default function ObservedScan(props){useLayoutEffect(()=>{window.precheckReaderApi.openScanned=props.onOpen;});return React.createElement(Actual,props);}`;
        // An observer only: the actual child, adapter and DOM are unchanged. The
        // layout-effect receipt records each committed render before passive
        // detail loading can clear old state; it grants no permission or data.
        if (id.endsWith('/src/pages/repair/RepairPrecheckReadOnly.tsx')) return `import React,{useLayoutEffect} from 'react';import Actual from '/src/pages/repair/RepairPrecheckReadOnly.tsx?precheckActual';export default function Observed(props){useLayoutEffect(()=>{const search=window.precheckReaderRouter?.state.location.search;if(!search)return;window.precheckReaderApi.readerRenders.push({selectedItemId:new URLSearchParams(search).get('itemId'),expectedItemId:props.itemId,state:props.record.state,recordedBy:props.record.recordedBy||null,regionText:document.querySelector('[aria-label="收發初檢紀錄"]')?.textContent||null});});return React.createElement(Actual,props);}`;
        if (id.endsWith('/src/pages/repair/RepairDocuments.tsx')) return `import React,{useLayoutEffect,useState} from 'react';export default function IsolatedDocuments({item,onDirtyChange}){const[value,setValue]=useState(item.repairInspection?.data?.diagnosis||'');window.precheckReaderApi.formalProps.push({itemId:item.id,inspection:structuredClone(item.repairInspection),report:structuredClone(item.repairReport)});useLayoutEffect(()=>{window.precheckReaderApi.detailRenders.push({selectedItemId:new URLSearchParams(window.precheckReaderRouter.state.location.search).get('itemId'),renderedItemId:item.id,regionText:document.querySelector('[aria-label="收發初檢紀錄"]')?.textContent||null});});return React.createElement('input',{'aria-label':'合成正式檢修欄位',value,onChange:event=>{setValue(event.target.value);onDirtyChange(true);}});}`;
        if (['RepairWorkflowPanel.tsx', 'RepairReadinessPanel.tsx', 'RepairTestStandardManager.tsx'].some(name => id.endsWith('/src/pages/repair/' + name))) {
          return `import React from 'react';export default function IsolatedChild(){return null;}`;
        }
      },
      transform(code, id) {
        if (id === virtual) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
      },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/__repair-precheck-reader')) return next();
        try {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(await vite.transformIndexHtml('/__repair-precheck-reader', `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
            *{box-sizing:border-box}body{margin:0;background:#f5f6f8}.fixture-shell{min-width:0;padding:24px}.pure-shell{min-width:0;max-width:960px;background:white;padding:16px}
            @media(max-width:767px){.fixture-shell{padding:12px}}
            </style></head><body><main class="fixture-shell"><div id="root"></div></main><script type="module" src="/@id/virtual:repair-precheck-reader-fixture"></script></body></html>`));
        } catch (error) { next(error); }
      }); },
    }] });
  let browser;
  const errors = [], external = [], networkWrites = [], pages = [], geometry = [], readerSwitches = [];
  t.after(async () => {
    await browser?.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true });
    const receipt = { node: process.version, execPath: process.execPath, browserVersion: browser?.version(), executablePath,
      sourceBefore, sourceAfter: hashes(), errors, external, networkWrites, geometry, readerSwitches,
      cleanup: { browserDisconnected: !browser?.isConnected(), serverStopped: !server.httpServer?.listening, pagesClosed: pages.every(page => page.isClosed()) },
      scope: 'actual adapter/read-only private Blob component/page/scan/router/repairService; formal document/readiness/workflow/standard-manager children stubbed; authoritative projection is synthetic fixed contract, not live backend acceptance' };
    writeFileSync(join(artifactDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    t.diagnostic(JSON.stringify({ artifactDir, ...receipt }));
  });
  await server.listen(); browser = await chromium.launch({ executablePath, headless: true });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  async function open(child, options = {}) {
    const { mode = 'page', entry = `/operations/repair?entityId=${company}`, width = 1280, photoMode = 'png', queueScenario = 'normal', editable = false } = options;
    const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: 'Asia/Taipei' }); pages.push(page);
    const pageNumber = pages.length;
    child.after(async () => {
      if (page.isClosed()) return;
      try { writeFileSync(join(artifactDir, `page-${pageNumber}-final.txt`), await page.locator('body').innerText()); }
      finally { await page.close(); }
    }); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(request.url()); return route.abort(); }
      if (!['GET', 'HEAD'].includes(request.method())) { networkWrites.push(request.method() + ' ' + request.url()); return route.abort(); }
      return route.continue();
    });
    const payload = 'raw' in options ? '&payload=' + encodeURIComponent(JSON.stringify({ value: options.raw })) : '';
    await page.goto(`${origin}/__repair-precheck-reader?mode=${mode}&entry=${encodeURIComponent(entry)}&photoMode=${photoMode}&queueScenario=${queueScenario}&editable=${editable ? 1 : 0}${payload}`);
    await page.locator(mode === 'pure' ? '.pure-shell' : '.repair-tab-label').first().waitFor();
    return page;
  }
  async function tabs(page) {
    assert.deepEqual(await page.locator('.repair-workbench-page > .ant-tabs .repair-tab-label > span:first-child').allTextContents(), ['我的待辦', '待認領與簽收', '案件查詢']);
  }
  const scanButton = page => page.getByRole('button', { name: /掃\s*描/ });
  async function scan(page, value) {
    assert.equal(await scanButton(page).count(), 1); await scanButton(page).click();
    const input = page.getByLabel('掃描物件標籤', { exact: true }); await input.fill(value); await input.press('Enter');
  }
  async function settledDrawer(page) {
    const drawer = page.locator('.repair-workbench-drawer .ant-drawer-content-wrapper');
    await drawer.waitFor();
    await page.waitForFunction(() => {
      const element = document.querySelector('.repair-workbench-drawer .ant-drawer-content-wrapper');
      return element && getComputedStyle(element).transform === 'none' && !element.className.includes('appear') && !element.className.includes('enter');
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return drawer;
  }
  async function noWrites(page) { assert.deepEqual(await page.evaluate(() => window.precheckReaderApi?.posts || []), []); }
  const photoGets = page => page.evaluate(() => window.precheckReaderApi.gets.filter(call => call.path.startsWith('/mailroom/prechecks/items/')));
  async function photosLoaded(page, count = 2) {
    await page.waitForFunction(count => [...document.querySelectorAll('[aria-label="初檢照片"] img')].filter(image => image.src.startsWith('blob:') && image.complete && image.naturalWidth > 0).length === count, count);
  }
  async function settledPrecheck(page) {
    await page.waitForFunction(() => {
      const region = document.querySelector('[aria-label="收發初檢紀錄"]'), content = region?.closest('.ant-collapse-content');
      return region && region.getBoundingClientRect().height > 0 && (!content || content.getBoundingClientRect().height >= region.getBoundingClientRect().height
        && content.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function noFacts(page, safeMetadata = false) {
    assert.equal(await page.locator('.pure-shell li,.pure-shell img,[aria-label="初檢照片"]').count(), 0);
    for (const value of ['合成螢幕異常', '合成通電檢查', '合成電源觀察', draftSecret]) assert.equal(await page.getByText(value, { exact: true }).count(), 0);
    if (!safeMetadata) for (const value of ['合成初檢記錄人', 'v7']) assert.equal(await page.getByText(value, { exact: true }).count(), 0);
    assert.deepEqual(await photoGets(page), []); await noWrites(page);
  }
  async function openQueue(page) {
    const queue = page.getByRole('region', { name: '收發初檢預覽', exact: true }); await queue.waitFor();
    if (await queue.locator('.ant-collapse-header').getAttribute('aria-expanded') !== 'true') await queue.getByText('收發初檢', { exact: true }).click();
    return queue;
  }
  const queueGets = page => page.evaluate(() => window.precheckReaderApi.gets.filter(call => call.path === '/mailroom/items' && call.params.status === 'RECEIVED'));
  async function settledQueue(page) {
    await page.waitForFunction(() => {
      const content = document.querySelector('[aria-label="收發初檢預覽"] .ant-collapse-content'), box = content?.querySelector('.ant-collapse-content-box');
      return content && box && content.getBoundingClientRect().height >= box.getBoundingClientRect().height
        && content.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running');
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  await t.test('submitted view shows four true results, exact metadata and only its dedicated evidence', async child => {
    const page = await open(child, { mode: 'pure' }); const section = page.getByRole('region', { name: '收發初檢紀錄' });
    for (const [label, result, note] of [['合成通電檢查', '正常', '合成電源觀察'], ['合成顯示檢查', '異常', '合成螢幕異常'], ['合成防水檢查', '未測試', '合成缺少防水設備'], ['合成電池檢查', '不適用', '合成此型號無電池']]) {
      const check = section.locator('li').filter({ hasText: label }); await check.getByText(result, { exact: true }).waitFor(); await check.getByText(note, { exact: true }).waitFor();
    }
    const dates = await page.evaluate(() => ['2026-10-16T01:02:03.000Z', '2026-10-16T02:03:04.000Z'].map(value => new Date(value).toLocaleString('zh-TW')));
    assert.deepEqual(await section.locator('.ant-descriptions-item-content').allTextContents(), ['v7', '合成初檢記錄人', ...dates, '合成收發初檢標準 · v2']);
    await photosLoaded(page);
    const created = await page.evaluate(() => window.precheckReaderApi.created);
    assert.deepEqual(await section.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src'))), created.map(value => value.url));
    assert.ok(created.every(value => value.type === 'image/png' && value.size > 0));
    assert.deepEqual(await photoGets(page), photoIds.map(id => ({ path: photoPath(id), params: { entityId: company }, responseType: 'blob', hasSignal: true })));
    assert.deepEqual(await section.locator('img').evaluateAll(images => images.map(image => image.alt)), ['初檢照片 1', '初檢照片 2']);
    assert.equal(await section.locator('input,textarea,button[type="submit"]').count(), 0);
    assert.equal(await page.getByText('DO_NOT_RENDER_GENERAL_CASE_PHOTO').count(), 0);
    await page.screenshot({ path: join(artifactDir, 'precheck-submitted-desktop.png'), fullPage: true });
  });
  await t.test('pending stages show only safe summary metadata while all non-submitted states hide draft facts and photos', async child => {
    for (const [stage, label] of Object.entries({ NOT_STARTED: '尚未初檢', DRAFT: '收發初檢中', READY: '初檢完成待交接', STALE: '初檢紀錄待更新' })) {
      const pending = ['DRAFT', 'READY'].includes(stage);
      const raw = { ...structuredClone(precheckContract), stage, revision: stage === 'NOT_STARTED' ? 0 : 7, recorded: null, submittedAt: null, draft: { diagnosis: draftSecret }, photos: [draftSecret] };
      const page = await open(child, { mode: 'pure', raw }); await page.getByText(label, { exact: true }).waitFor(); await noFacts(page, pending);
      if (pending) {
        await page.getByText('合成初檢記錄人', { exact: true }).waitFor(); await page.getByText('v7', { exact: true }).waitFor();
        const date = await page.evaluate(() => new Date('2026-10-16T01:02:03.000Z').toLocaleString('zh-TW'));
        await page.getByText(date, { exact: true }).waitFor();
      }
      await page.close();
    }
    for (const raw of [undefined, null]) { const page = await open(child, { mode: 'pure', raw }); await page.getByText('初檢紀錄暫無法取得', { exact: true }).waitFor(); await noFacts(page); await page.close(); }
  });
  await t.test('a valid submitted no-check reason remains a record without invented checks or evidence', async child => {
    const raw = structuredClone(precheckContract); Object.assign(raw.recorded, { template: null, checks: [], photos: [], notRequiredReason: '合成密封品由維修師開封檢測' });
    const page = await open(child, { mode: 'pure', raw });
    await page.getByText('不需初檢原因', { exact: true }).waitFor(); await page.getByText('合成密封品由維修師開封檢測', { exact: true }).waitFor();
    assert.equal(await page.locator('li,img').count(), 0); await page.getByText('合成初檢記錄人', { exact: true }).waitFor();
    assert.deepEqual(await photoGets(page), []); await noWrites(page);
  });
  await t.test('actual adapter rejects foreign, stale, malformed and unsafe-photo contracts before any private photo GET', async child => {
    const invalid = [];
    const add = (name, change) => { const raw = structuredClone(precheckContract); change(raw); invalid.push({ name, raw }); };
    add('wrong schema', raw => { raw.schema = 2; });
    add('foreign entity', raw => { raw.entityId = 'another-company'; });
    add('foreign item', raw => { raw.itemId = otherId; });
    add('top revision differs', raw => { raw.revision = 8; });
    add('record revision differs', raw => { raw.recorded.revision = 6; });
    add('missing submitted record', raw => { raw.recorded = null; });
    add('metadata does not match', raw => { raw.savedByName = '舊版記錄人'; });
    add('invalid time', raw => { raw.savedAt = raw.recorded.savedAt = 'not-a-time'; });
    add('invalid result', raw => { raw.recorded.checks[0].result = 'MAYBE'; });
    add('empty checks without reason', raw => { raw.recorded.checks = []; });
    add('draft cannot carry submitted record', raw => { raw.stage = 'DRAFT'; });
    add('pending revision missing', raw => { raw.stage = 'DRAFT'; raw.recorded = null; delete raw.revision; });
    add('pending recorder missing', raw => { raw.stage = 'DRAFT'; raw.recorded = null; raw.savedByName = null; });
    add('pending time invalid', raw => { raw.stage = 'READY'; raw.recorded = null; raw.savedAt = 'not-a-time'; });
    add('unsafe photo ID', raw => { raw.recorded.photos[0].id = 'not-a-photo'; });
    add('unsafe digest', raw => { raw.recorded.photos[0].digest = 'not-a-digest'; });
    add('foreign origin', raw => { raw.recorded.photos[0].url = 'https://foreign.invalid' + raw.recorded.photos[0].url; });
    add('wrong item path', raw => { raw.recorded.photos[0].url = photoPath(photoIds[0], 7, otherId); });
    add('wrong endpoint', raw => { raw.recorded.photos[0].url = `/mailroom/items/${itemId}/repair-photo`; });
    add('mismatched photo path', raw => { raw.recorded.photos[0].url = photoPath(photoIds[1]); });
    add('old revision path', raw => { raw.recorded.photos[0].url = photoPath(photoIds[0], 6); });
    add('duplicate revision query', raw => { raw.recorded.photos[0].url += '&revision=7'; });
    add('data URL', raw => { raw.recorded.photos[0].url = 'data:image/png;base64,AAAA'; });
    add('unbound check evidence', raw => { raw.recorded.checks[0].photoIds = ['f'.repeat(64)]; });
    add('duplicate evidence', raw => { raw.recorded.photos.push(structuredClone(raw.recorded.photos[0])); });
    for (const { name, raw } of invalid) {
      const page = await open(child, { mode: 'pure', raw }); await page.getByText('初檢紀錄暫無法取得', { exact: true }).waitFor();
      await noFacts(page); child.diagnostic(name + ': no facts/private GET'); await page.close();
    }
  });
  await t.test('actual detail expands the saved precheck with private blobs and preserves formal-document props', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&itemId=${itemId}&queue=all` });
    await page.getByRole('heading', { name: title, exact: true }).waitFor(); await settledDrawer(page);
    assert.deepEqual(await photoGets(page), []); assert.equal(await page.getByText('合成初檢記錄人', { exact: true }).count(), 0);
    await page.locator('.repair-case-details').getByText('收發初檢', { exact: true }).click(); await photosLoaded(page);
    for (const label of ['正常', '異常', '未測試', '不適用']) await page.getByRole('region', { name: '收發初檢紀錄' }).getByText(label, { exact: true }).waitFor();
    assert.equal(await page.getByLabel('合成正式檢修欄位').inputValue(), '');
    assert.ok((await page.evaluate(() => window.precheckReaderApi.formalProps)).every(value => value.inspection === null && value.report === null));
    assert.deepEqual(await photoGets(page), photoIds.map(id => ({ path: photoPath(id), params: { entityId: company }, responseType: 'blob', hasSignal: true })));
    assert.ok((await page.locator('[aria-label="初檢照片"] img').evaluateAll(images => images.map(image => image.src))).every(src => src.startsWith('blob:')));
    await noWrites(page); await tabs(page);
    await settledPrecheck(page);
    await page.screenshot({ path: join(artifactDir, 'detail-saved-precheck-private-photos.png'), fullPage: true });
    await page.locator('.repair-workbench-drawer').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => window.precheckReaderApi.created.length === 2 && window.precheckReaderApi.revoked.length === 2);
    assert.equal(await page.getByRole('region', { name: '收發初檢紀錄' }).count(), 0); await noWrites(page);
  });
  await t.test('detail pending, not-started, stale and missing projections show no saved facts or photo reads', async child => {
    for (const [stage, label] of [['DRAFT', '收發初檢中'], ['READY', '初檢完成待交接'], ['NOT_STARTED', '尚未初檢'], ['STALE', '初檢紀錄待更新'], ['MISSING', '初檢紀錄暫無法取得']]) {
      const raw = stage === 'MISSING' ? undefined : { ...structuredClone(precheckContract), stage, revision: stage === 'NOT_STARTED' ? 0 : 7, submittedAt: null, recorded: null };
      const page = await open(child, { entry: `/operations/repair?entityId=${company}&itemId=${itemId}&queue=all`, raw });
      await page.getByRole('heading', { name: title, exact: true }).waitFor(); await settledDrawer(page);
      await page.locator('.repair-case-details').getByText('收發初檢', { exact: true }).click(); await page.getByText(label, { exact: true }).waitFor();
      if (['DRAFT', 'READY'].includes(stage)) await page.getByText('合成初檢記錄人', { exact: true }).waitFor();
      else assert.equal(await page.getByText('合成初檢記錄人', { exact: true }).count(), 0);
      assert.equal(await page.getByText('合成螢幕異常', { exact: true }).count(), 0); assert.equal(await page.locator('[aria-label="初檢照片"]').count(), 0);
      assert.deepEqual(await photoGets(page), []); await noWrites(page); await page.close();
    }
  });
  await t.test('photo403 and invalid MIME remain visible failures and can retry the same private resources', async child => {
    for (const photoMode of ['403', 'mime']) {
      const page = await open(child, { mode: 'pure', photoMode });
      await page.getByRole('alert').filter({ hasText: '初檢照片暫無法取得' }).waitFor();
      assert.equal(await page.locator('[aria-label="初檢照片"] img').count(), 0); assert.deepEqual(await page.evaluate(() => window.precheckReaderApi.created), []);
      assert.equal((await photoGets(page)).length, 2); await page.getByText('合成初檢記錄人', { exact: true }).waitFor();
      await page.evaluate(() => { window.precheckReaderApi.photoMode = 'png'; });
      await page.getByRole('button', { name: '重新載入照片', exact: true }).click(); await photosLoaded(page);
      assert.equal(await page.getByRole('alert').filter({ hasText: '初檢照片暫無法取得' }).count(), 0);
      const requests = await photoGets(page); assert.deepEqual(requests.slice(2), requests.slice(0, 2));
      await noWrites(page); await page.close();
    }
  });
  await t.test('unmount and company changes abort private reads and suppress late responses', async child => {
    for (const change of ['unmount', 'company']) {
      const page = await open(child, { mode: 'pure', photoMode: 'hold' });
      await page.waitForFunction(() => window.precheckReaderApi.held.length === 2);
      await page.evaluate(change => {
        if (change === 'unmount') window.setPrecheckReaderMounted(false);
        else window.setPrecheckReaderScope({ entityId: 'another-company', itemId: window.precheckReaderRecord.itemId });
      }, change);
      await page.waitForFunction(() => window.precheckReaderApi.aborts.length === 2);
      await page.evaluate(() => { window.precheckReaderApi.releasePhoto(0); window.precheckReaderApi.releasePhoto(1); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await page.evaluate(() => window.precheckReaderApi.created), []); assert.equal(await page.locator('img').count(), 0);
      assert.equal((await photoGets(page)).length, 2); await noWrites(page); await page.close();
    }
  });
  await t.test('record changes revoke every old blob and late old revisions cannot flash or create URLs', async child => {
    const next = structuredClone(precheckContract); next.revision = next.recorded.revision = 8;
    next.savedByName = next.recorded.savedByName = '合成新版初檢記錄人';
    next.recorded.photos = ['1'.repeat(64), '2'.repeat(64)].map(id => ({ id, digest: 'f'.repeat(64), url: photoPath(id, 8) }));
    next.recorded.checks[0].photoIds = [next.recorded.photos[0].id]; next.recorded.checks[1].photoIds = [next.recorded.photos[1].id];
    for (const photoMode of ['png', 'hold']) {
      const page = await open(child, { mode: 'pure', photoMode });
      if (photoMode === 'png') await photosLoaded(page); else await page.waitForFunction(() => window.precheckReaderApi.held.length === 2);
      const previous = await page.evaluate(() => window.precheckReaderApi.created.map(value => value.url));
      await page.evaluate(next => { window.precheckReaderApi.photoMode = 'png'; window.setPrecheckReaderRecord(next); }, next);
      await page.getByText('合成新版初檢記錄人', { exact: true }).waitFor(); await photosLoaded(page);
      if (photoMode === 'hold') {
        await page.waitForFunction(() => window.precheckReaderApi.aborts.length >= 2);
        await page.evaluate(() => { window.precheckReaderApi.releasePhoto(0); window.precheckReaderApi.releasePhoto(1); });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      const state = await page.evaluate(() => ({ created: window.precheckReaderApi.created, revoked: window.precheckReaderApi.revoked }));
      assert.equal(state.created.length, photoMode === 'png' ? 4 : 2);
      assert.deepEqual(state.revoked, previous); assert.deepEqual(await page.locator('[aria-label="初檢照片"] img').evaluateAll(images => images.map(image => image.src)), state.created.slice(-2).map(value => value.url));
      await page.evaluate(() => window.setPrecheckReaderMounted(false));
      await page.waitForFunction(() => window.precheckReaderApi.revoked.length === window.precheckReaderApi.created.length);
      assert.equal(await page.locator('img').count(), 0); await noWrites(page); await page.close();
    }
  });
  await t.test('closing the real detail drawer aborts pending photos and rejects their eventual response', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&itemId=${itemId}&queue=all`, photoMode: 'hold' });
    await page.getByRole('heading', { name: title, exact: true }).waitFor(); await settledDrawer(page);
    await page.locator('.repair-case-details').getByText('收發初檢', { exact: true }).click();
    await page.waitForFunction(() => window.precheckReaderApi.held.length === 2);
    await page.locator('.repair-workbench-drawer').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => window.precheckReaderApi.aborts.length === 2);
    await page.evaluate(() => { window.precheckReaderApi.releasePhoto(0); window.precheckReaderApi.releasePhoto(1); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('region', { name: '收發初檢紀錄' }).count(), 0); assert.deepEqual(await page.evaluate(() => window.precheckReaderApi.created), []); await noWrites(page);
  });
  await t.test('each committed reader render follows selectedId while a different detail is still pending', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&itemId=${itemId}&queue=all` });
    await page.getByRole('heading', { name: title, exact: true }).waitFor(); await settledDrawer(page);
    await page.locator('.repair-case-details').getByText('收發初檢', { exact: true }).click(); await photosLoaded(page);
    await page.evaluate(path => {
      window.precheckReaderApi.readerRenders = []; window.precheckReaderApi.detailRenders = []; window.precheckReaderApi.holdDetails = true;
      void window.precheckReaderRouter.navigate(path);
    }, `/operations/repair?entityId=${company}&itemId=${otherId}&queue=all`);
    await page.waitForFunction(() => window.precheckReaderApi.heldDetails.length === 1);
    const pending = await page.evaluate(() => ({ readers: window.precheckReaderApi.readerRenders, details: window.precheckReaderApi.detailRenders }));
    const newSelection = pending.readers.filter(value => value.selectedItemId === otherId);
    const oldDetailCommit = pending.details.filter(value => value.selectedItemId === otherId && value.renderedItemId === itemId);
    assert.ok(oldDetailCommit.length > 0, 'Observe the committed old detail during selection change before passive detail clearing');
    assert.ok(oldDetailCommit.every(value => !value.regionText), JSON.stringify(oldDetailCommit));
    assert.ok(newSelection.every(value => value.expectedItemId === otherId && value.state !== 'SUBMITTED' && !value.regionText), JSON.stringify(newSelection));
    assert.equal(await page.getByRole('region', { name: '收發初檢紀錄' }).count(), 0);
    await page.waitForFunction(() => window.precheckReaderApi.revoked.length === 2);
    await page.evaluate(() => window.precheckReaderApi.releaseDetail(0));
    await page.getByRole('heading', { name: '墨子合成另一原案件', exact: true }).waitFor();
    await page.locator('.repair-case-details').getByText('收發初檢', { exact: true }).click(); await photosLoaded(page);
    await page.getByText('合成另一案件初檢記錄人', { exact: true }).waitFor();
    assert.equal(await page.getByText('合成初檢記錄人', { exact: true }).count(), 0);
    const afterFresh = await page.evaluate(() => window.precheckReaderApi.readerRenders);
    assert.ok(afterFresh.filter(value => value.selectedItemId === otherId).every(value => value.expectedItemId === otherId && value.recordedBy !== '合成初檢記錄人'), JSON.stringify(afterFresh));
    readerSwitches.push({ pending, afterFresh }); await noWrites(page); await tabs(page);
  });
  await t.test('actual page scans the native UUID into the original case, all queue and company-scoped document GET only', async child => {
    const page = await open(child); await tabs(page); await scan(page, itemId);
    await page.getByRole('heading', { name: title, exact: true }).waitFor(); await settledDrawer(page);
    const location = await page.evaluate(() => window.precheckReaderRouter.state.location);
    assert.equal(location.pathname, '/operations/repair'); const params = new URLSearchParams(location.search);
    assert.equal(params.get('itemId'), itemId); assert.equal(params.get('entityId'), company); assert.equal(params.get('queue'), 'all');
    const calls = await page.evaluate(() => window.precheckReaderApi.gets);
    assert.ok(calls.some(call => call.path === `/repair-workbench/items/${itemId}/documents` && call.params.entityId === company));
    assert.ok(calls.some(call => call.path === '/mailroom/items' && call.params.view === 'repair' && call.params.repairScope === 'all' && call.params.entityId === company));
    assert.ok(calls.every(call => call.params.entityId === company));
    await page.getByRole('button', { name: '認領案件', exact: true }).waitFor(); await noWrites(page); await tabs(page);
    await page.screenshot({ path: join(artifactDir, 'scan-original-case-desktop.png'), fullPage: true });
    await page.locator('.repair-workbench-drawer').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(element => element.textContent.replace(/\s/g, '') === '掃描');
      return button && document.activeElement === button && button.getBoundingClientRect().width > 0;
    });
    await scanButton(page).press('Enter');
    await page.getByLabel('掃描物件標籤', { exact: true }).waitFor(); await noWrites(page);
  });
  await t.test('same-origin printed URL opens its existing item without creating or receiving a case', async child => {
    const page = await open(child); await scan(page, `${origin}/operations/mailroom?entityId=${company}&itemId=${otherId}`);
    await page.getByRole('heading', { name: '墨子合成另一原案件', exact: true }).waitFor();
    const params = new URLSearchParams(await page.evaluate(() => window.precheckReaderRouter.state.location.search));
    assert.equal(params.get('itemId'), otherId); assert.equal(params.get('queue'), 'all'); await noWrites(page);
  });
  await t.test('cross-company, foreign origin, serial, malformed and duplicate-query scans are rejected without document GET', async child => {
    const page = await open(child); await scanButton(page).click();
    const input = page.getByLabel('掃描物件標籤', { exact: true });
    const invalid = [`${origin}/operations/repair?entityId=another-company&itemId=${itemId}`, `https://foreign.invalid/operations/repair?entityId=${company}&itemId=${itemId}`,
      'SYNTHETIC-SN-012345', '11111111-not-a-uuid', `/operations/repair?entityId=${company}&itemId=${itemId}&itemId=${otherId}`, `/operations/repair?entityId=${company}&itemId=${itemId}&queue=todo`,
      `/operations/repair?entityId=${company}&itemId=${itemId}#unsafe`, `javascript:alert(1)`];
    for (const value of invalid) {
      await input.fill(value); await input.press('Enter'); await page.getByRole('alert').filter({ hasText: '無法辨識此公司的物件標籤' }).waitFor();
      assert.equal(await page.locator('.repair-detail').count(), 0); assert.equal(new URLSearchParams(await page.evaluate(() => window.precheckReaderRouter.state.location.search)).has('itemId'), false);
    }
    assert.equal((await page.evaluate(() => window.precheckReaderApi.gets)).filter(call => call.path.includes('/documents')).length, 0); await noWrites(page);
  });
  await t.test('initial deep link opens the exact item even when all list results are empty', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&itemId=${itemId}&queue=all` });
    await page.getByRole('heading', { name: title, exact: true }).waitFor(); await settledDrawer(page); await tabs(page); await noWrites(page);
    assert.deepEqual((await page.evaluate(() => window.precheckReaderApi.gets)).filter(call => call.path.includes('/documents')), [{ path: `/repair-workbench/items/${itemId}/documents`, params: { entityId: company } }]);
  });
  await t.test('a forbidden detail deep link exposes no previous case facts or actions', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&itemId=${deniedId}&queue=all` });
    await page.getByText('合成案件無存取權', { exact: true }).waitFor(); await page.getByText('請重新載入案件', { exact: true }).waitFor();
    assert.equal(await page.locator('.repair-detail').count(), 0); assert.equal(await page.getByRole('button', { name: /認領案件|簽收實物|開始檢測|開始維修|送客服確認/ }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: title, exact: true }).count(), 0); await noWrites(page);
  });
  await t.test('forbidden navigation clears a previously readable case instead of retaining its actions', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&itemId=${itemId}&queue=all` });
    await page.getByRole('heading', { name: title, exact: true }).waitFor(); await page.getByRole('button', { name: '認領案件', exact: true }).waitFor();
    await page.evaluate(path => window.precheckReaderRouter.navigate(path), `/operations/repair?entityId=${company}&itemId=${deniedId}&queue=all`);
    await page.getByText('合成案件無存取權', { exact: true }).waitFor(); await page.getByText('請重新載入案件', { exact: true }).waitFor();
    assert.equal(await page.locator('.repair-detail').count(), 0); assert.equal(await page.getByRole('button', { name: '認領案件', exact: true }).count(), 0); await noWrites(page);
  });
  await t.test('genuine scan callback preserves same-item dirty edits and requires discard before a different item', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&queue=acceptance`, editable: true });
    await scanButton(page).click(); await page.getByLabel('掃描物件標籤', { exact: true }).waitFor();
    await page.evaluate(path => window.precheckReaderRouter.navigate(path), `/operations/repair?entityId=${company}&queue=acceptance&itemId=${itemId}`);
    await page.getByRole('heading', { name: title, exact: true }).waitFor(); await settledDrawer(page);
    const field = page.getByLabel('合成正式檢修欄位'); await field.fill('合成尚未保存的技師檢修內容');
    const originalSearch = await page.evaluate(() => window.precheckReaderRouter.state.location.search);
    await page.evaluate(target => window.precheckReaderApi.openScanned(target), { entityId: company, itemId, path: `/operations/repair?entityId=${company}&itemId=${itemId}&queue=all` });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByText('尚有未儲存的修改', { exact: true }).count(), 0);
    assert.equal(await field.inputValue(), '合成尚未保存的技師檢修內容');
    assert.equal(await page.evaluate(() => window.precheckReaderRouter.state.location.search), originalSearch);
    await page.locator('.repair-workbench-drawer').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.ant-modal-confirm-title').filter({ hasText: '尚有未儲存的修改' }).waitFor();
    await page.getByRole('button', { name: '繼續編輯', exact: true }).click();
    await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' });
    assert.equal(await field.inputValue(), '合成尚未保存的技師檢修內容');
    const different = { entityId: company, itemId: otherId, path: `/operations/repair?entityId=${company}&itemId=${otherId}&queue=all` };
    await page.evaluate(target => window.precheckReaderApi.openScanned(target), different);
    await page.locator('.ant-modal-confirm-title').filter({ hasText: '尚有未儲存的修改' }).waitFor();
    await page.getByRole('button', { name: '繼續編輯', exact: true }).click();
    await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' });
    assert.equal(await field.inputValue(), '合成尚未保存的技師檢修內容');
    assert.equal(await page.evaluate(() => window.precheckReaderRouter.state.location.search), originalSearch);
    await page.evaluate(target => window.precheckReaderApi.openScanned(target), different);
    await page.locator('.ant-modal-confirm-title').filter({ hasText: '尚有未儲存的修改' }).waitFor();
    await page.getByRole('button', { name: '放棄修改', exact: true }).click();
    await page.getByRole('heading', { name: '墨子合成另一原案件', exact: true }).waitFor();
    assert.equal(await page.getByLabel('合成正式檢修欄位').inputValue(), '');
    const params = new URLSearchParams(await page.evaluate(() => window.precheckReaderRouter.state.location.search));
    assert.equal(params.get('itemId'), otherId); assert.equal(params.get('queue'), 'all'); await noWrites(page); await tabs(page);
  });
  await t.test('received preview uses the exact query, response total, page-local counts and fixed50 pagination before opening the native case', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&queue=acceptance` }); const queue = await openQueue(page);
    await queue.getByText('已收維修件 123 件', { exact: true }).waitFor();
    await queue.getByText('本頁初檢中 1 件／本頁完成待交接 1 件', { exact: true }).waitFor();
    assert.equal(await queue.locator('ul:not(.ant-pagination) > li').count(), 3);
    await queue.getByText('合成已認領整新初檢產品', { exact: true }).waitFor();
    assert.equal(await queue.getByText('待初檢', { exact: true }).count(), 1); assert.equal(await queue.getByText(draftSecret, { exact: true }).count(), 0);
    assert.deepEqual(await queueGets(page), [{ path: '/mailroom/items', params: { entityId: company, view: 'repair', repairScope: 'all', status: 'RECEIVED', page: 1 } }]);
    assert.equal(await queue.getByText(/9876|4321/).count(), 0);
    await queue.locator('.ant-pagination-item-3').waitFor(); assert.equal(await queue.locator('.ant-pagination-item-4').count(), 0);
    assert.equal(await queue.locator('.ant-pagination-options').count(), 0);
    await queue.locator('.ant-pagination-item-2').click(); await queue.getByText('合成第二頁待交接產品', { exact: true }).waitFor();
    await queue.getByText('本頁初檢中 0 件／本頁完成待交接 1 件', { exact: true }).waitFor();
    assert.deepEqual((await queueGets(page)).at(-1), { path: '/mailroom/items', params: { entityId: company, view: 'repair', repairScope: 'all', status: 'RECEIVED', page: 2 } });
    await queue.locator('.ant-pagination-item-1').click(); await queue.getByText('合成初檢中產品', { exact: true }).waitFor();
    await queue.getByRole('button', { name: /^開啟案件：合成初檢中產品/ }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor(); await settledDrawer(page);
    await page.getByRole('button', { name: '認領案件', exact: true }).waitFor();
    assert.equal(new URLSearchParams(await page.evaluate(() => window.precheckReaderRouter.state.location.search)).get('itemId'), itemId);
    const details = (await page.evaluate(() => window.precheckReaderApi.gets)).filter(call => call.path.endsWith('/documents'));
    assert.deepEqual(details, [{ path: `/repair-workbench/items/${itemId}/documents`, params: { entityId: company } }]);
    assert.deepEqual(await photoGets(page), []); await noWrites(page); await tabs(page);
  });
  await t.test('preview unknown summaries and read failures never fabricate precise counts or zero total', async child => {
    const unknown = await open(child, { entry: `/operations/repair?entityId=${company}&queue=acceptance`, queueScenario: 'unknown' });
    const unknownQueue = await openQueue(unknown); await unknownQueue.getByText('已收維修件 123 件', { exact: true }).waitFor();
    await unknownQueue.getByText('本頁初檢進度未確認', { exact: true }).waitFor(); await unknownQueue.getByText('初檢進度未確認', { exact: true }).waitFor();
    assert.equal(await unknownQueue.getByText(/本頁初檢中 \d+ 件|本頁完成待交接 \d+ 件/).count(), 0); assert.deepEqual(await photoGets(unknown), []); await noWrites(unknown); await unknown.close();
    const failed = await open(child, { entry: `/operations/repair?entityId=${company}&queue=acceptance`, queueScenario: 'fail' });
    const failedQueue = await openQueue(failed); await failedQueue.getByRole('alert').filter({ hasText: '合成初檢清單讀取失敗' }).waitFor();
    assert.equal(await failedQueue.getByText(/已收維修件 0 件|本頁初檢中 \d+ 件|沒有已收維修件/).count(), 0);
    await failed.evaluate(() => { window.precheckReaderApi.queueScenario = 'normal'; });
    await failedQueue.getByRole('button', { name: '重新整理', exact: true }).click(); await failedQueue.getByText('已收維修件 123 件', { exact: true }).waitFor();
    await noWrites(failed); assert.deepEqual(await photoGets(failed), []);
  });
  await t.test('late preview responses from the previous company cannot overwrite current company rows or totals', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&queue=acceptance`, queueScenario: 'hold-a' });
    await openQueue(page); await page.waitForFunction(() => window.precheckReaderApi.heldQueues.length === 1);
    await page.evaluate(path => window.precheckReaderRouter.navigate(path), `/operations/repair?entityId=${companyB}&queue=acceptance`);
    const queue = await openQueue(page); await queue.getByText('乙公司合成已收維修產品', { exact: true }).waitFor(); await queue.getByText('已收維修件 7 件', { exact: true }).waitFor();
    await page.evaluate(() => window.precheckReaderApi.releaseQueue(0));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await queue.getByText('合成初檢中產品', { exact: true }).count(), 0); assert.equal(await queue.getByText('已收維修件 123 件', { exact: true }).count(), 0);
    assert.deepEqual((await queueGets(page)).map(call => call.params.entityId), [company, companyB]); await noWrites(page); await tabs(page);
  });
  await t.test('returning to a previously failed company starts a fresh preview without resurrecting its old error or counts', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&queue=acceptance`, queueScenario: 'fail' });
    let queue = await openQueue(page);
    await queue.getByRole('alert').filter({ hasText: '合成初檢清單讀取失敗' }).waitFor();
    await page.evaluate(({ company, companyB }) => {
      window.precheckReaderApi.queueScenario = 'normal';
      window.precheckReaderApi.planQueue({ entityId: companyB, page: 1 });
      window.precheckReaderApi.planQueue({ entityId: company, page: 1 });
    }, { company, companyB });
    async function pendingWithoutOldState() {
      await queue.locator('[aria-label="收發初檢載入中"]').waitFor();
      assert.equal(await queue.getByRole('alert').count(), 0);
      assert.equal(await queue.getByText(/已收維修件 \d+ 件|本頁初檢中 \d+ 件|本頁完成待交接 \d+ 件|沒有已收維修件/).count(), 0);
      assert.equal(await queue.locator('ul:not(.ant-pagination) > li').count(), 0);
    }
    await page.evaluate(path => window.precheckReaderRouter.navigate(path), `/operations/repair?entityId=${companyB}&queue=acceptance`);
    queue = await openQueue(page); await page.waitForFunction(() => window.precheckReaderApi.heldQueues.length === 1);
    await pendingWithoutOldState();
    await page.evaluate(path => window.precheckReaderRouter.navigate(path), `/operations/repair?entityId=${company}&queue=acceptance`);
    queue = await openQueue(page); await page.waitForFunction(() => window.precheckReaderApi.heldQueues.length === 2);
    await pendingWithoutOldState();
    await page.evaluate(() => window.precheckReaderApi.releaseQueue(0));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await pendingWithoutOldState();
    await page.evaluate(() => {
      const fresh = window.precheckReaderApi.heldQueues[1].data;
      fresh.total = 151; fresh.items[0].productName = '合成重新載入甲公司產品';
      window.precheckReaderApi.releaseQueue(1);
    });
    await queue.getByText('已收維修件 151 件', { exact: true }).waitFor();
    await queue.getByText('合成重新載入甲公司產品', { exact: true }).waitFor();
    await queue.getByText('本頁初檢中 1 件／本頁完成待交接 1 件', { exact: true }).waitFor();
    assert.equal(await queue.getByRole('alert').count(), 0);
    assert.equal(await queue.locator('[aria-label="收發初檢載入中"]').count(), 0);
    assert.equal(await queue.getByText(/已收維修件 (7|123) 件|乙公司合成已收維修產品|合成初檢中產品/).count(), 0);
    assert.deepEqual((await queueGets(page)).map(call => call.params.entityId), [company, companyB, company]);
    await settledQueue(page); await page.screenshot({ path: join(artifactDir, 'received-precheck-revisited-company-after-failure.png'), fullPage: true });
    await noWrites(page); assert.deepEqual(await photoGets(page), []); await tabs(page);
  });
  await t.test('a delayed old page2 cannot replace page1 after leaving and returning to the preview', async child => {
    const page = await open(child, { entry: `/operations/repair?entityId=${company}&queue=acceptance` }); let queue = await openQueue(page);
    await queue.getByText('合成初檢中產品', { exact: true }).waitFor();
    await page.evaluate(() => window.precheckReaderApi.planQueue({ entityId: 'precheck-company', page: 2 }));
    await queue.locator('.ant-pagination-item-2').click(); await page.waitForFunction(() => window.precheckReaderApi.heldQueues.length === 1);
    await page.getByRole('tab', { name: '案件查詢', exact: true }).click();
    await page.getByRole('tab', { name: /待認領與簽收/ }).click(); queue = await openQueue(page);
    await queue.getByText('合成初檢中產品', { exact: true }).waitFor();
    await page.evaluate(() => window.precheckReaderApi.releaseQueue(0)); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await queue.getByText('合成第二頁待交接產品', { exact: true }).count(), 0);
    assert.equal(await queue.locator('.ant-pagination-item-active').innerText(), '1');
    assert.deepEqual((await queueGets(page)).map(call => call.params.page), [1, 2, 1]); await noWrites(page);
  });
  await t.test('expanded received previews fit desktop and 320/390px without hiding overflow or exposing draft content', async child => {
    for (const width of [1280, 320, 390]) {
      const page = await open(child, { entry: `/operations/repair?entityId=${company}&queue=acceptance`, width }); const queue = await openQueue(page);
      await queue.getByText('合成初檢中產品', { exact: true }).waitFor(); await settledQueue(page);
      const dimensions = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        overflowX: [document.documentElement, document.body, document.querySelector('.fixture-shell')].map(element => getComputedStyle(element).overflowX) }));
      geometry.push({ kind: 'received-precheck-preview', ...dimensions }); assert.ok(dimensions.documentWidth <= width && dimensions.bodyWidth <= width, JSON.stringify(dimensions));
      assert.ok(dimensions.overflowX.every(value => !['hidden', 'clip'].includes(value)));
      assert.equal(await queue.getByText(draftSecret, { exact: true }).count(), 0); assert.deepEqual(await photoGets(page), []); await noWrites(page); await tabs(page);
      await page.screenshot({ path: join(artifactDir, `received-precheck-preview-${width}.png`), fullPage: true }); await page.close();
    }
  });
  await t.test('desktop and 320/390px layouts keep the real scan control, three entry tabs and read-only record within the viewport', async child => {
    for (const width of [1280, 320, 390]) {
      const page = await open(child, { width }); await tabs(page); await scanButton(page).click();
      await page.getByLabel('掃描物件標籤', { exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('.ant-popover')].filter(element => element.getBoundingClientRect().width > 0)
        .every(element => element.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const scanGeometry = await page.evaluate(() => {
        const rect = document.querySelector('input[aria-label="掃描物件標籤"]').getBoundingClientRect();
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, scanLeft: rect.left, scanRight: rect.right,
          compatMode:document.compatMode,overflowing:[...document.querySelectorAll('body *')].map(element=>({element,rect:element.getBoundingClientRect()}))
            .filter(({element,rect})=>rect.width>0&&(rect.right>innerWidth||rect.left<0)&&getComputedStyle(element).visibility!=='hidden')
            .map(({element,rect})=>({tag:element.tagName,className:typeof element.className==='string'?element.className:'',left:rect.left,right:rect.right,overflowX:getComputedStyle(element).overflowX})).slice(0,12) };
      });
      await page.screenshot({ path: join(artifactDir, `scan-popover-${width}.png`), fullPage: true });
      geometry.push({ kind: 'page-scan', ...scanGeometry }); assert.ok(scanGeometry.documentWidth <= width, JSON.stringify(scanGeometry)); assert.ok(scanGeometry.bodyWidth <= width, JSON.stringify(scanGeometry));
      assert.ok(scanGeometry.scanLeft >= 0 && scanGeometry.scanRight <= width, JSON.stringify(scanGeometry));
      await noWrites(page);
      const pure = await open(child, { mode: 'pure', width }); await pure.locator('img').first().waitFor();
      const pureGeometry = await pure.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
      geometry.push({ kind: 'pure-readonly', ...pureGeometry }); assert.ok(pureGeometry.documentWidth <= width, JSON.stringify(pureGeometry)); assert.ok(pureGeometry.bodyWidth <= width);
      await pure.screenshot({ path: join(artifactDir, `precheck-readonly-${width}.png`), fullPage: true });
    }
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(networkWrites, []);
  assert.deepEqual(hashes(), sourceBefore, 'Production source changed during the run; do not call it a frozen receipt');
});
