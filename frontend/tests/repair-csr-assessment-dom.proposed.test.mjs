import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', chromium.executablePath(), '/usr/bin/chromium'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.REPAIR_TEST_ARTIFACT_DIR ? join(process.env.REPAIR_TEST_ARTIFACT_DIR, 'csr-assessment') : mkdtempSync(join(tmpdir(), 'repair-csr-assessment-artifacts-'));
mkdirSync(output, { recursive: true });
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import CustomerRepairQueue from '/src/pages/repair/CustomerRepairQueue.tsx';
import '/src/pages/repair/repair.css';
window.__APP_CONFIG__={mailroomEnabled:true};
const scenario=new URL(location.href).searchParams.get('scenario')||'current',hash='a'.repeat(64),copy=x=>structuredClone(x);
const doc={number:'SYNTHETIC-INS',revision:3,status:'SUBMITTED',authorId:'tech',authorName:'合成維修師',updatedAt:'2026-10-15T01:00:00.000Z',submittedAt:'2026-10-15T01:00:00.000Z',
 data:{protocol:2,complaint:'無法充電',reproduction:'YES',testConditions:'正常供電與線材',checks:[{key:'power',name:'充電狀態',result:'FAIL',observation:'接入正常供電仍無法充電'}],
 diagnosis:'接口變形造成接觸不良',causeStatus:'CONFIRMED',isAccidentalDamage:true,plan:'REPAIR',planNote:'修復充電接口',feeSuggestion:'PAID',estimateAmount:500,estimateNote:'接口修復費',materialPlan:{mode:'NONE',lines:[]},
 templateBinding:{id:'synthetic-template',revision:1,contentHash:'b'.repeat(64)},mediaRefs:[{mediaId:'synthetic-photo',phase:'DIAGNOSTIC',checkKey:'power'}],
 assessment:{schema:1,conclusion:'USER_CAUSED',basis:'接口變形且接觸不良',causalExplanation:'接口變形造成接觸不良',checkKeys:['power'],mediaIds:['synthetic-photo']}}};
const item={id:'synthetic-item',entityId:'synthetic-company',version:7,label:'SYNTHETIC-ITEM',productId:'synthetic-product',productName:'合成充電器',sku:'SYNTHETIC-SKU',serialNumber:'SYNTHETIC-SN',
 status:'WAITING_CUSTOMER',repairOwnerId:'tech',repairOwnerName:'合成維修師',custodianId:'tech',custodianName:'合成維修師',location:'合成檢修區',physicalCustody:'TECHNICIAN',editable:false,
 allowedWorkflowActions:['review_assessment'],receipt:{category:'REPAIR',number:'SYNTHETIC-RECEIPT',sourceCaseId:'synthetic-source',sourceNumber:'SYNTHETIC-CASE'},repairInspection:doc,repairReport:null,history:[],
 repairWorkflow:{schema:1,assessmentPolicy:{schema:1,inspectionRevision:3,planHash:hash},csr:{status:'ACCEPTED',ownerId:'csr',ownerName:'合成客服',inspectionRevision:3,estimateRevision:3,quoteRevision:null,planHash:hash}},
 repairPrerequisites:{template:{schema:1,id:'synthetic-template',revision:1,contentHash:'b'.repeat(64),entityId:'synthetic-company',productId:'synthetic-product',sku:'SYNTHETIC-SKU',status:'REVIEWED',checks:[{key:'power',name:'充電狀態',requiredForInspection:true,requiredForCompletion:true,requiresCalibration:false,standard:{kind:'OBSERVATION',instruction:'充電狀態'}}]},templateChecks:{inspection:'READY',completion:'READY'},mediaAssets:[],materials:{start:{state:'READY',requiredCount:0},completion:{state:'READY',requiredCount:0}}},
 release:{available:false,sourceCaseId:'synthetic-source',caseBrand:'MOZTECH',releaseInfo:null}};
if(scenario==='normal'){doc.data.assessment.conclusion='PRODUCT_FAULT';doc.data.isAccidentalDamage=false;doc.data.assessment.mediaIds=[];}
if(scenario==='unknown'){doc.data.assessment={schema:1,conclusion:'UNDETERMINED',basis:'',causalExplanation:'原因尚待確認',checkKeys:[],mediaIds:[]};doc.data.diagnosis='原因尚待確認';doc.data.causeStatus='UNKNOWN';delete doc.data.isAccidentalDamage;}
if(scenario==='self-author')doc.authorId='csr';
if(scenario==='self-owner')item.repairOwnerId='csr';
if(scenario==='wrong-owner')item.repairWorkflow.csr.ownerId='other-csr';
if(scenario==='unclaimed')item.repairWorkflow.csr.status='SENT';
if(scenario==='missing-allowed')delete item.allowedWorkflowActions;
if(scenario==='empty-allowed')item.allowedWorkflowActions=[];
if(scenario==='foreign-entity')item.entityId='synthetic-other-company';
if(scenario==='foreign-case')item.id='synthetic-other-item';
if(scenario==='stale-inspection')item.repairWorkflow.csr.inspectionRevision=2;
if(scenario==='stale-estimate')item.repairWorkflow.csr.estimateRevision=2;
if(scenario==='missing-author')delete doc.authorId;
if(scenario==='missing-owner')delete item.repairOwnerId;
if(scenario==='draft')doc.status='DRAFT';
if(scenario==='other-draft')item.allowedWorkflowActions.push('resolve_customer');
const state={scenario,documents:copy(item),gets:[],posts:[],dirty:false,dirtyEvents:[],events:[],failPost:false,holdNextDocument:false,heldDocument:null,
 releaseDocument(overrides){if(!this.heldDocument)throw Error('No held detail request');const held=this.heldDocument;this.heldDocument=null;held.resolve({data:copy(overrides??this.documents)});},
 emit(data){for(const listener of window.__csrListeners||[])listener({category:'mailroom',data});}};
window.__csr=state;
function App(){const [entityId,setEntityId]=useState('synthetic-company');state.switchEntity=setEntityId;return React.createElement(CustomerRepairQueue,{entityId,initialItemId:"synthetic-item",onDirtyChange:dirty=>{state.dirty=dirty;state.dirtyEvents.push(dirty)}});}
createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const api = `
const copy=x=>structuredClone(x);const failure=message=>Object.assign(Error(message),{response:{data:{message}}});
export const API_URL='/synthetic-api-only';
export default {
 async get(path,options={}){
  const state=window.__csr;state.gets.push({path,params:copy(options.params||{})});
  if(path==='/repair-workbench/csr-queue')return {data:{items:[copy(state.documents)],total:1}};
  if(path==='/repair-workbench/items/synthetic-item/documents'){
   state.events.push('detail:'+state.documents.version);
   if(state.holdNextDocument){state.holdNextDocument=false;return await new Promise((resolve,reject)=>{state.heldDocument={resolve,reject};});}
   return {data:copy(state.documents)};
  }
  if(path.endsWith('/media')||path.endsWith('/reports'))return {data:{items:[]}};
  throw failure('Unexpected local fixture GET '+path);
 },
 async post(path,body){
  const state=window.__csr;state.posts.push({path,body:copy(body)});state.events.push('post:'+body.action);
  if(path!=='/repair-workbench/items/synthetic-item/workflow'||body.action!=='review_assessment')throw failure('Unexpected local fixture write');
  if(state.failPost)throw failure('合成覆核儲存失敗');
  const item=state.documents;item.version++;
  item.repairWorkflow.assessmentReview={schema:1,inspectionRevision:3,planHash:'a'.repeat(64),reviewerId:'csr',reviewerName:'合成客服',reviewedAt:new Date().toISOString(),decision:body.decision==='APPROVE'?'APPROVE':'REVISE',note:body.note};
  item.allowedWorkflowActions=[];if(body.decision==='DECLINE')item.status='INSPECTING';
  return {data:{id:item.id,duplicate:false}};
 }
};
`;

test('CSR assessment review uses actual CustomerRepairQueue and AntD in a localhost-only Chrome', { skip: !executablePath && 'Existing browser required; no installation', timeout: 240000 }, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'repair-csr-assessment-vite-'));
  const virtual = '\0repair-csr-assessment-fixture';
  let browser;
  const receipt = { node: process.version, execPath: process.execPath, executablePath, root, cases: [], errors: [], external: [], networkWrites: [], clean: false };
  const server = await createServer({ root, cacheDir, configFile: false,
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'antd', '@ant-design/icons'] },
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-csr-assessment', resolveId(id) { if (id === 'virtual:repair-csr-assessment') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'csr',roles:[],permissions:['mailroom:review','repair_workbench:read']}});`;
        if (id.endsWith('/src/services/websocket.service.ts')) return `window.__csrListeners=new Set();export const webSocketService={subscribe:listener=>{window.__csrListeners.add(listener);return()=>window.__csrListeners.delete(listener)}};`;
      },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__repair-csr-assessment') return next();
        try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml('/__repair-csr-assessment', '<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}#root{padding:16px;min-width:0}</style></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-csr-assessment"></script></body></html>')); } catch (error) { next(error); }
      }); },
    }] });
  t.after(async () => {
    if (browser) await browser.close();
    await server.close();
    receipt.clean = !browser?.isConnected() && server.httpServer?.listening !== true;
    writeFileSync(join(output, 'raw-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    rmSync(cacheDir, { recursive: true, force: true });
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  receipt.origin = origin;
  browser = await chromium.launch({ executablePath, headless: true });
  receipt.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => receipt.errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) { receipt.external.push(request.url()); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { receipt.networkWrites.push(request.method() + ' ' + request.url()); return route.abort(); }
    return route.continue();
  });
  const run = async (name, fn) => {
    if (process.env.CSR_DOM_CASE && !name.includes(process.env.CSR_DOM_CASE)) return;
    await t.test(name, async () => {
      try { await fn(); }
      catch(error) {
        const key = name.replace(/[^a-z0-9]+/gi,'-').slice(0,80);
        receipt.failures ??= [];
        receipt.failures.push({name,error:String(error),state:await page.evaluate(()=>({posts:window.__csr?.posts,gets:window.__csr?.gets,events:window.__csr?.events,dirty:window.__csr?.dirty,text:document.body.innerText,forms:Array.from(document.querySelectorAll('form')).map(e=>({id:e.id,html:e.outerHTML.slice(-2500)})),buttons:Array.from(document.querySelectorAll('button')).filter(e=>e.textContent.includes('覆核')).map(e=>({html:e.outerHTML})),styles:Array.from(document.styleSheets).map(s=>s.href),drawer:(()=>{const el=document.querySelector('.ant-drawer-content-wrapper');if(!el)return null;const css=getComputedStyle(el);return {className:el.parentElement.className,width:css.width,maxWidth:css.maxWidth,transform:css.transform}})()})).catch(()=>null)});
        await page.screenshot({path:join(output,key+'-failure.png'),fullPage:true}).catch(()=>{});
        throw error;
      }
    });
  };
  const form = () => page.locator('form[id^="customer-repair-assessment-"]');
  const solution = () => page.locator('form[id^="customer-repair-review-"]');
  const settleDrawer = async () => {
    await page.waitForFunction(() => {
      const el = document.querySelector('.ant-drawer-content-wrapper'); if(!el)return false;
      const css=getComputedStyle(el), box=el.getBoundingClientRect();
      return css.transform==='none' && box.width>0 && box.width<=innerWidth+1 && box.left>=-1 && box.right<=innerWidth+1;
    });
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const load = async scenario => {
    await page.goto(origin + '/__repair-csr-assessment?scenario=' + scenario);
    await page.getByText('客服維修交辦', { exact: true }).waitFor();
    await page.waitForFunction(() => window.__csr?.gets.some(value => value.path.endsWith('/documents')));
    await page.locator('.ant-drawer-body .ant-spin-spinning').waitFor({ state: 'hidden' });
    await settleDrawer();
    receipt.cases.push(scenario);
  };
  const fill = async (decision = 'APPROVE', note = '已核對本版原因與佐證') => {
    await form().getByLabel(decision === 'APPROVE' ? '通過' : '退回補充', { exact: true }).check();
    await form().getByLabel('覆核紀錄', { exact: true }).fill(note);
  };
  const submit = async () => { const button=form().locator('button[type="submit"]'); assert.equal(await button.isEnabled(),true); await button.click(); };
  const assertPayload = (post, decision, note) => {
    receipt.commands ??= []; receipt.commands.push(structuredClone(post));
    assert.equal(post.path, '/repair-workbench/items/synthetic-item/workflow');
    assert.deepEqual(Object.keys(post.body).sort(), ['action', 'decision', 'entityId', 'expectedVersion', 'inspectionRevision', 'note', 'requestId'].sort());
    assert.deepEqual({ ...post.body, requestId: 'UUID' }, { entityId: 'synthetic-company', expectedVersion: 7, action: 'review_assessment', inspectionRevision: 3, decision, note, requestId: 'UUID' });
    assert.match(post.body.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  };

  await run('ordinary product fault and unknown cases have no assessment review form or blank review card', async () => {
    for (const scenario of ['normal', 'unknown']) {
      await load(scenario);
      assert.equal(await form().count(), 0);
      assert.equal(await page.getByText('唯讀：需本人簽收與編輯權限。', {exact:true}).count(),0);
      assert.equal(await page.locator('.ant-card-head-title').getByText('佐證覆核', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.__csr.posts.length), 0);
    }
  });
  await run('only current claimed nonself USER with explicit server action may show the form', async () => {
    await load('current'); await form().waitFor();
    assert.equal(await form().getByLabel('覆核紀錄', { exact: true }).isEnabled(), true);
    for (const scenario of ['self-author', 'self-owner', 'wrong-owner', 'unclaimed', 'missing-allowed', 'empty-allowed', 'foreign-entity', 'foreign-case', 'stale-inspection', 'stale-estimate', 'missing-author', 'missing-owner', 'draft']) {
      await load(scenario);
      assert.equal(await form().count(), 0, scenario);
      assert.equal(await page.evaluate(() => window.__csr.posts.length), 0, scenario);
    }
  });
  await run('required note does not write; APPROVE and DECLINE send only the native command and no caller proof', async () => {
    for (const decision of ['APPROVE', 'DECLINE']) {
      await load('current'); await form().waitFor();
      await form().getByLabel(decision === 'APPROVE' ? '通過' : '退回補充', { exact: true }).check();
      await submit(); await form().getByText('請填覆核紀錄', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__csr.posts.length), 0);
      await fill(decision, '  已核對本版原因與佐證  '); await submit();
      await page.getByText('已儲存覆核', { exact: true }).waitFor();
      const state = await page.evaluate(() => ({ posts: window.__csr.posts, version: window.__csr.documents.version, dirty: window.__csr.dirty }));
      assert.equal(state.posts.length, 1); assertPayload(state.posts[0], decision, '已核對本版原因與佐證');
      assert.equal(state.version, 8); assert.equal(state.dirty, false);
      assert.equal(await form().count(), 0, 'fresh server action disappearance is respected');
    }
  });
  await run('failed save preserves fields and dirty state, exact retry reuses UUID, changed body gets a new UUID', async () => {
    await load('current'); await fill();
    await page.evaluate(() => { window.__csr.failPost = true; });
    await submit(); await page.getByText('合成覆核儲存失敗', { exact: true }).waitFor();
    assert.equal(await form().getByLabel('覆核紀錄', { exact: true }).inputValue(), '已核對本版原因與佐證');
    assert.equal(await page.evaluate(() => window.__csr.dirty), true);
    await submit(); await page.waitForFunction(() => window.__csr.posts.length === 2);
    let posts = await page.evaluate(() => window.__csr.posts); assert.deepEqual(posts[0], posts[1]);
    await form().getByLabel('覆核紀錄', { exact: true }).fill('修改後的覆核紀錄');
    await submit(); await page.waitForFunction(() => window.__csr.posts.length === 3);
    posts = await page.evaluate(() => window.__csr.posts); assert.notEqual(posts[2].body.requestId, posts[1].body.requestId);
    await page.evaluate(() => { window.__csr.failPost = false; });
    await submit(); await page.getByText('已儲存覆核', { exact: true }).waitFor();
    posts = await page.evaluate(() => window.__csr.posts); assert.deepEqual(posts[2], posts[3]);
  });
  await run('save success waits for a fresh asynchronous detail reload and does not reuse the old form', async () => {
    await load('current'); await fill(); await page.evaluate(() => { window.__csr.holdNextDocument = true; }); await submit();
    await page.waitForFunction(() => !!window.__csr.heldDocument);
    assert.equal(await page.getByText('已儲存覆核', { exact: true }).count(), 0);
    assert.equal(await form().count(), 0);
    assert.equal(await page.evaluate(() => window.__csr.posts.length), 1);
    await page.evaluate(() => window.__csr.releaseDocument());
    await page.getByText('已儲存覆核', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__csr.events.filter(value => value.startsWith('detail:'))), ['detail:7', 'detail:8']);
    assert.equal(await form().count(), 0);
  });
  await run('a stale same-version reload is rejected instead of displaying a false success', async () => {
    await load('current'); await fill(); await page.evaluate(() => { window.__csr.holdNextDocument = true; }); await submit();
    await page.waitForFunction(() => !!window.__csr.heldDocument);
    await page.evaluate(() => { const stale = structuredClone(window.__csr.documents); stale.version = 7; window.__csr.releaseDocument(stale); });
    await page.getByText('回覆已儲存，案件重新載入失敗。', { exact: true }).waitFor();
    assert.equal(await form().count(), 0); assert.equal(await page.getByText('已儲存覆核', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__csr.posts.length), 1);
  });
  await run('dirty drawer close can be cancelled and deliberate discard releases dirty state without posting', async () => {
    await load('current'); await fill();
    await page.locator('.ant-drawer-close').click(); await page.locator('.ant-modal-confirm-title').waitFor();
    await page.getByRole('button', { name: '繼續編輯', exact: true }).click();
    assert.equal(await form().getByLabel('覆核紀錄', { exact: true }).inputValue(), '已核對本版原因與佐證');
    assert.equal(await page.evaluate(() => window.__csr.dirty), true);
    await page.locator('.ant-drawer-close').click(); await page.getByRole('button', { name: '放棄修改', exact: true }).click();
    await page.locator('.ant-drawer-content-wrapper').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__csr.dirty), false); assert.equal(await page.evaluate(() => window.__csr.posts.length), 0);
  });
  await run('another unsaved solution draft needs explicit discard before the assessment command', async () => {
    await load('other-draft'); await solution().getByLabel('回覆依據', { exact: true }).fill('尚未儲存的方案回覆'); await fill(); await submit();
    await page.getByRole('button', { name: '繼續編輯', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__csr.posts.length), 0);
    assert.equal(await solution().getByLabel('回覆依據', { exact: true }).inputValue(), '尚未儲存的方案回覆');
    await submit(); await page.getByRole('button', { name: '放棄修改', exact: true }).click();
    await page.getByText('已儲存覆核', { exact: true }).waitFor();
    const posts = await page.evaluate(() => window.__csr.posts); assert.equal(posts.length, 1); assertPayload(posts[0], 'APPROVE', '已核對本版原因與佐證');
  });
  await run('actual desktop/mobile DOM keeps three document tabs, no additional top tabs and no whole-page overflow', async () => {
    await page.setViewportSize({ width: 1280, height: 960 }); await load('current'); await form().waitFor();
    assert.equal(await page.locator('.repair-documents > .ant-tabs [role="tab"]').count(), 3);
    assert.equal(await page.locator('[role="tab"]').evaluateAll(elements => elements.filter(element => !element.closest('.repair-documents')).length), 0);
    for (const text of ['DOA、一般送修與公司退貨整新共用檢修、替換及原廠返還流程；每一步保留本人簽收與工作單。', '售後來源案件的到貨預告；收發室實收並核對後，才會出現在待認領清單。']) assert.equal(await page.getByText(text, { exact: true }).count(), 0);
    await settleDrawer();
    receipt.desktopSizes=await page.evaluate(()=>{const el=document.querySelector('.ant-drawer-content-wrapper'),box=el.getBoundingClientRect();return {width:innerWidth,left:box.left,right:box.right,drawerWidth:box.width,transform:getComputedStyle(el).transform}});
    assert.equal(await page.getByText('唯讀：需本人簽收與編輯權限。', {exact:true}).count(),0);
    assert.equal(await page.locator('form#repair-inspection-synthetic-item').getByLabel('顧客問題',{exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'儲存草稿',exact:true}).count(),0);
    await page.screenshot({path:join(output,'csr-review-desktop-overview.png'),fullPage:true});
    await form().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, 'csr-review-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await settleDrawer();
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    const sizes = await page.evaluate(() => { const el = document.querySelector('.ant-drawer-content-wrapper'), body = document.querySelector('.ant-drawer-body'); const box = el.getBoundingClientRect(); return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, drawerLeft: box.left, drawerRight: box.right, drawerBodyWidth: body.clientWidth, drawerBodyScrollWidth: body.scrollWidth }; });
    assert(sizes.drawerLeft >= -1 && sizes.drawerRight <= 391, JSON.stringify(sizes));
    assert(sizes.drawerBodyScrollWidth <= sizes.drawerBodyWidth + 1, JSON.stringify(sizes));
    receipt.mobileSizes = sizes;
    await form().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, 'csr-review-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 960 });
  });
  assert.deepEqual(receipt.errors, []); assert.deepEqual(receipt.external, []); assert.deepEqual(receipt.networkWrites, []);
  await page.close();
});
