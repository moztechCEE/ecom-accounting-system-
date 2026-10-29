import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const pagePath = 'src/pages/repair/RepairWorkbenchPage.tsx';
const documentsPath = 'src/pages/repair/RepairDocuments.tsx';
const baselineSha = 'fd63cef980d96fd962f498acb4bdb2d718411158';
const baseline = process.env.REPAIR_DETAIL_BASELINE === '1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pageSource = baseline ? execFileSync('git', ['show', baselineSha + ':frontend/' + pagePath], { cwd: root }) : readFileSync(join(root, pagePath));
const documentsSource = readFileSync(join(root, documentsPath));
const servedHashes = { [pagePath]: digest(pageSource), [documentsPath]: digest(documentsSource) };
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};localStorage.setItem('access_token','synthetic-token-1');
const router=createMemoryRouter([{path:'/operations/repair',element:React.createElement(RepairWorkbenchPage)},
  {path:'/other',element:React.createElement('h2',null,'合成其他頁面')}],{initialEntries:['/operations/repair?entityId=instance-company&queue=all']});
window.__instanceRouter=router;
function Harness(){const[mounted,setMounted]=useState(true);window.__instanceUnmount=()=>setMounted(false);return mounted?React.createElement(RouterProvider,{router}):React.createElement('p',null,'已卸載合成工作台')}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const auth = `
import {useSyncExternalStore} from 'react';
let user={id:'instance-tech',name:'合成維修師',roles:[],permissions:['repair_workbench:read','repair_workbench:update']};const listeners=new Set();
window.__instanceSetUser=id=>{user={...user,id};for(const listener of listeners)listener()};
export const useAuth=()=>({user:useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>user)});
`;
const api = `
const clone=value=>structuredClone(value),now='2026-10-29T01:00:00Z';
function item(id,name){return {id,entityId:'instance-company',label:id,productId:'instance-product',productName:name,sku:'SYNTHETIC-SKU',serialNumber:null,status:'INSPECTING',statusLabel:'檢測中',version:7,
  matchResult:'MATCH',location:'合成檢測區',custodianId:'instance-tech',custodianName:'合成維修師',repairOwnerId:'instance-tech',nextUserId:null,nextUserName:null,
  recipientId:null,mine:true,evidenceCount:0,evidence:[],physicalCustody:'TECHNICIAN',editable:true,allowedWorkflowActions:[],
  receipt:{number:'RCPT-'+id,category:'REPAIR',sourceCaseId:'source-'+id,sourceNumber:'CASE-'+id,customerServiceUserId:'synthetic-csr',receivedAt:now},
  customerContext:{state:'AVAILABLE',sourceCaseId:'source-'+id,customerIssue:'顧客原述 '+id},mailroomPrecheck:null,
  repairInspection:{number:'INS-'+id,revision:2,status:'DRAFT',authorId:'instance-tech',authorName:'合成維修師',updatedAt:now,
    data:{protocol:2,complaint:'已保存問題 '+id,reproduction:'YES',testConditions:'合成供電條件',checks:[{name:'合成通電測試',result:'FAIL',observation:'無反應'}],
      diagnosis:'原因待確認',causeStatus:'UNKNOWN',plan:'REPAIR',planNote:'檢查電源',feeSuggestion:'REVIEW',estimateNote:'',materialPlan:{mode:'NONE',lines:[]}}},
  repairReport:null,repairWorkflow:{},release:{available:false},history:[],deliverySummary:[]}}
const state={rows:{'item-a':item('item-a','合成 A 產品'),'item-b':item('item-b','合成 B 產品')},gets:[],posts:[],pendingPosts:[],pendingGets:[],holdGets:[],deferCommit:false,
  releasePost(index){const pending=this.pendingPosts[index];if(!pending||pending.released)throw Error('Invalid pending post');if(pending.commit)pending.commit();pending.released=true;pending.resolve({data:{id:pending.id,duplicate:false}})},
  releaseGet(index){const pending=this.pendingGets[index];if(!pending||pending.released)throw Error('Invalid pending read');pending.released=true;pending.resolve({data:clone(pending.item)})}};
window.__instance=state;
export const API_URL='/offline-detail-instance';
export default {
 async get(path,options={}){const params=clone(options.params||{});state.gets.push({path,params});
   if(path==='/mailroom/items')return {data:{items:params.status==='RECEIVED'?[]:Object.values(state.rows).filter(item=>item.entityId===params.entityId).map(clone),total:params.status==='RECEIVED'?0:Object.values(state.rows).filter(item=>item.entityId===params.entityId).length}};
   if(path==='/repair-workbench/test-registry/products')return{data:{products:[{id:'instance-product',name:'合成產品',sku:'SYNTHETIC-SKU',modelNumber:'SYNTHETIC-MODEL'}],hasMore:false}};
   if(path==='/repair-workbench/test-registry')return{data:{standards:[],calibrations:[]}};
   if(path==='/repair-workbench/todo')return {data:{items:[],total:0,queueCounts:{todo:0},countExact:true,unknownCount:0}};
   if(path==='/mailroom/source-cases')return {data:{items:[],nextCursor:null}};
   const match=path.match(/^\\/repair-workbench\\/items\\/([^/]+)\\/documents$/);
   if(match){const row=clone(state.rows[match[1]]);if(!row||row.entityId!==params.entityId)throw Error('Wrong synthetic detail scope');
     const planned=state.holdGets.indexOf(match[1]);if(planned>=0){state.holdGets.splice(planned,1);return await new Promise(resolve=>state.pendingGets.push({item:row,resolve,released:false}))}return {data:row}}
   throw Error('Unexpected offline GET '+path)
 },
 async post(path,body){state.posts.push({path,body:clone(body)});const match=path.match(/^\\/repair-workbench\\/items\\/([^/]+)\\/inspection$/);
   if(!match||body.status!=='DRAFT')throw Error('Only the actual inspection draft save is permitted');
   const row=state.rows[match[1]];if(!row||row.entityId!==body.entityId||row.version!==body.expectedVersion)throw Error('Synthetic version/scope mismatch');
   const commit=()=>{if(row.version!==body.expectedVersion)throw Error('Synthetic commit version mismatch');row.version++;row.repairInspection={...row.repairInspection,revision:row.repairInspection.revision+1,status:body.status,data:clone(body.data)}};
   if(!state.deferCommit)commit();
   return await new Promise(resolve=>state.pendingPosts.push({id:match[1],resolve,released:false,commit:state.deferCommit?commit:null}))
 }
};
`;

test('detail instances fence late real document-save callbacks and adopted responses', {
  skip: !executablePath && 'Existing browser required; no installation', timeout: 180000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'repair-detail-instance-'));
  const virtual = '\0repair-detail-instance-dom';
  const server = await createServer({ root, cacheDir, configFile: false, optimizeDeps:{noDiscovery:true,include:['react','react/jsx-runtime','react-dom/client','react-router-dom','antd','@ant-design/icons','dayjs']}, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'offline-detail-instance', resolveId(id) { if (id === 'virtual:repair-detail-instance-dom') return virtual; },
    load(id) {
      if (id === virtual) return fixture;
      if (id.endsWith('/' + pagePath)) return pageSource.toString();
      if (id.endsWith('/' + documentsPath)) return documentsSource.toString();
      if (id.endsWith('/src/contexts/AuthContext.tsx')) return auth;
      if (id.endsWith('/src/services/api.ts')) return api;
      if (id.endsWith('/src/services/websocket.service.ts')) return `export const webSocketService={subscribe:callback=>{window.__instanceNotify=callback;return()=>{if(window.__instanceNotify===callback)delete window.__instanceNotify}}};`;
    },
    configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
      if (request.url?.split('?')[0] !== '/__detail-instance') return next();
      try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml('/__detail-instance', '<html lang="zh-Hant"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-detail-instance-dom"></script></body></html>')); }
      catch (error) { next(error); }
    }); },
  }] });
  let browser;
  t.after(async () => { if(browser)await browser.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen(); const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1233, height: 1066 } }); page.setDefaultTimeout(6000);
  const errors = [], external = [], networkWrites = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { networkWrites.push(request.method()); return route.abort(); }
    return route.continue();
  });
  const load = async () => { await page.goto(origin + '/__detail-instance'); await page.getByRole('button', { name: '合成 A 產品', exact: true }).waitFor(); };
  const drawer = () => page.locator('.ant-drawer-open');
  const complaint = () => drawer().locator('textarea[id$="_complaint"]');
  const open = async id => { await page.getByRole('button', { name: id === 'item-a' ? '合成 A 產品' : '合成 B 產品', exact: true }).click(); await complaint().waitFor(); };
  const close = async (dirty = true) => {
    await drawer().getByRole('button', { name: 'Close', exact: true }).click();
    if (dirty) { const modal = page.locator('.ant-modal-confirm'); await modal.getByRole('button', { name: '放棄修改', exact: true }).click(); }
    await page.locator('.ant-drawer-open').waitFor({ state: 'detached' });
  };
  const settle = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  const saveA = async () => {
    await open('item-a'); await complaint().fill('A7 已送出草稿');
    await drawer().getByRole('button', { name: '儲存草稿', exact: true }).click();
    await page.waitForFunction(() => window.__instance.pendingPosts.length === 1);
    const post = await page.evaluate(() => window.__instance.posts[0]);
    assert.equal(post.path, '/repair-workbench/items/item-a/inspection'); assert.equal(post.body.entityId, 'instance-company');
    assert.equal(post.body.expectedVersion, 7); assert.equal(post.body.status, 'DRAFT'); assert.equal(post.body.data.complaint, 'A7 已送出草稿');
    assert.match(post.body.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(await drawer().getByRole('button', { name: /儲存草稿/ }).isDisabled(), true);
  };
  const markCurrentDraft = async value => { await complaint().fill(value); await complaint().evaluate(node => { window.__currentDraftNode = node; }); };
  const assertDraftProtected = async value => {
    assert.equal(await complaint().inputValue(), value); assert(await complaint().evaluate(node => node === window.__currentDraftNode), 'A late callback cannot remount the current document');
    await drawer().getByRole('button', { name: 'Close', exact: true }).click();
    const modal = page.locator('.ant-modal-confirm'); await modal.locator('.ant-modal-confirm-title').waitFor();
    assert.equal(await modal.locator('.ant-modal-confirm-title').innerText(), '尚有未儲存的修改');
    await modal.getByRole('button', { name: '繼續編輯', exact: true }).click();
    assert.equal(await complaint().inputValue(), value);
  };

  t.diagnostic(JSON.stringify({ mode: baseline ? 'fixed-fd63-baseline' : 'actual-worktree', servedHashes }));
  const scenario = async(name,run) => { if(process.env.REPAIR_DETAIL_ONLY && !process.env.REPAIR_DETAIL_ONLY.split('|').some(fragment=>name.includes(fragment)))return; await t.test(name,async()=>{try{await run()}catch(error){t.diagnostic(error.stack);t.diagnostic((await page.locator('body').innerText()).slice(0,4000));throw error}}); };

  await scenario('A7 success after B editing cannot clear B dirty, reload it or bypass its close confirmation', async () => {
    await load(); await saveA(); await close(); await open('item-b'); await markCurrentDraft('B 必須保留的未儲存草稿');
    const reads = await page.evaluate(() => window.__instance.gets.length);
    await page.evaluate(() => window.__instance.releasePost(0)); await settle();
    assert.equal(await page.evaluate(() => window.__instance.gets.length), reads, 'An obsolete save must not start detail/list reads');
    await assertDraftProtected('B 必須保留的未儲存草稿'); assert.equal(await page.evaluate(() => window.__instance.posts.length), 1);
  });

  await scenario('same item A8 is a new instance and rejects its prior A7 save callback', async () => {
    await load(); await saveA(); await page.evaluate(() => window.__instanceNotify({ category: 'mailroom', data: { itemId: 'item-a' } }));
    await drawer().getByRole('button', { name: '重新載入', exact: true }).click();
    await page.locator('.ant-modal-confirm').getByRole('button', { name: '放棄修改', exact: true }).click();
    await drawer().getByText('案件 v8', { exact: true }).waitFor(); await markCurrentDraft('A8 後續編輯不能被 A7 清除');
    const reads = await page.evaluate(() => window.__instance.gets.length);
    await page.evaluate(() => window.__instance.releasePost(0)); await settle();
    assert.equal(await page.evaluate(() => window.__instance.gets.length), reads); await assertDraftProtected('A8 後續編輯不能被 A7 清除');
  });

  await scenario('closing and reopening the same item and version creates a distinct callback instance', async () => {
    await load(); await page.evaluate(() => { window.__instance.deferCommit = true; });
    await saveA(); await close(); await open('item-a'); await drawer().getByText('案件 v7', { exact: true }).waitFor();
    await markCurrentDraft('重新開啟的 A7 是另一個草稿'); const reads = await page.evaluate(() => window.__instance.gets.length);
    await page.evaluate(() => window.__instance.releasePost(0)); await settle();
    assert.equal(await page.evaluate(() => window.__instance.gets.length), reads); await assertDraftProtected('重新開啟的 A7 是另一個草稿');
  });

  await scenario('late A7 GET cannot replace newly adopted A8 or its draft', async () => {
    await load(); await page.evaluate(() => window.__instance.holdGets.push('item-a'));
    await page.getByRole('button', { name: '合成 A 產品', exact: true }).click();
    await page.waitForFunction(() => window.__instance.pendingGets.length === 1);
    await close(false); await page.evaluate(() => { window.__instance.rows['item-a'].version = 8; }); await open('item-a');
    await drawer().getByText('案件 v8', { exact: true }).waitFor(); await markCurrentDraft('新 A8 草稿');
    await page.evaluate(() => window.__instance.releaseGet(0)); await settle();
    await drawer().getByText('案件 v8', { exact: true }).waitFor(); await assertDraftProtected('新 A8 草稿');
  });

  for (const boundary of ['token', 'user', 'company', 'route']) await scenario(boundary + ' boundary invalidates a pending save before another current draft', async () => {
    await load(); await saveA(); await close();
    if (boundary === 'token') await page.evaluate(() => localStorage.setItem('access_token', 'synthetic-token-2'));
    if (boundary === 'user') await page.evaluate(() => { Object.assign(window.__instance.rows['item-b'], { repairOwnerId: 'other-tech', custodianId: 'other-tech' }); window.__instanceSetUser('other-tech'); });
    if (boundary === 'company') await page.evaluate(async () => { window.__instance.rows['item-b'].entityId = 'other-company'; await window.__instanceRouter.navigate('/operations/repair?entityId=other-company&queue=all'); });
    if (boundary === 'route') {
      await page.evaluate(async () => { await window.__instanceRouter.navigate('/other'); }); await page.getByRole('heading', { name: '合成其他頁面', exact: true }).waitFor();
      await page.evaluate(async () => { await window.__instanceRouter.navigate('/operations/repair?entityId=instance-company&queue=all'); });
    }
    await open('item-b'); await markCurrentDraft(boundary + ' 新草稿'); const reads = await page.evaluate(() => window.__instance.gets.length);
    await page.evaluate(() => window.__instance.releasePost(0)); await settle();
    assert.equal(await page.evaluate(() => window.__instance.gets.length), reads, boundary + ': no obsolete detail or list read');
    await assertDraftProtected(boundary + ' 新草稿');
  });

  await scenario('unmounted page receives no late detail/list activity from its document save', async () => {
    await load(); await saveA(); await page.evaluate(() => window.__instanceUnmount()); await page.getByText('已卸載合成工作台', { exact: true }).waitFor();
    const reads = await page.evaluate(() => window.__instance.gets.length); await page.evaluate(() => window.__instance.releasePost(0)); await settle();
    assert.equal(await page.evaluate(() => window.__instance.gets.length), reads);
  });

  await scenario('onSaved rechecks the instance after its held reload and cannot refresh old scope over B', async () => {
    await load(); await saveA(); await page.evaluate(() => { window.__instance.holdGets.push('item-a'); window.__instance.releasePost(0); });
    await page.waitForFunction(() => window.__instance.pendingGets.length === 1); await close(false); await open('item-b'); await markCurrentDraft('B 在 A reload 期間編輯');
    const reads = await page.evaluate(() => window.__instance.gets.length); await page.evaluate(() => window.__instance.releaseGet(0)); await settle();
    assert.equal(await page.evaluate(() => window.__instance.gets.length), reads, 'No old-scope refresh after the awaited reload becomes obsolete'); await assertDraftProtected('B 在 A reload 期間編輯');
  });

  await scenario('current successful save still reloads its saved version and refreshes queues once', async () => {
    await load(); await saveA(); const before = await page.evaluate(() => window.__instance.gets.length);
    await page.evaluate(() => window.__instance.releasePost(0)); await drawer().getByText('案件 v8', { exact: true }).waitFor(); await settle();
    assert.equal(await complaint().inputValue(), 'A7 已送出草稿');
    const reads = await page.evaluate(before => window.__instance.gets.slice(before), before);
    assert.equal(reads.filter(value => value.path.endsWith('/documents')).length, 1);
    assert.equal(reads.filter(value => value.path === '/mailroom/items').length, 1, 'A current save still refreshes the visible list');
    assert.equal(reads.filter(value => value.path === '/repair-workbench/todo').length, 1);
    await close(false); assert.equal(await page.locator('.ant-modal-confirm').count(), 0);
  });

  await scenario('header template authoring requires no case and keeps three global entries', async () => {
    await load(); assert.equal(await drawer().count(),0);
    assert.equal(await page.locator('.repair-workbench-page > .ant-tabs [role=tablist]').first().getByRole('tab').count(),3);
    await page.locator('.mailroom-heading').getByRole('button',{name:'維修範本',exact:true}).click();
    const manager=page.getByRole('dialog',{name:'維修範本',exact:true});
    const product=manager.getByRole('combobox',{name:'管理產品',exact:true});
    await product.locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click();
    const list=await product.getAttribute('aria-controls');
    await page.locator('[id="'+list+'"]').locator('xpath=ancestor::div[contains(@class,"ant-select-dropdown")]').getByText('合成產品 · SYNTHETIC-SKU · SYNTHETIC-MODEL',{exact:true}).click();
    await manager.getByRole('button',{name:'建立草稿',exact:true}).click();
    await manager.getByLabel('測項名稱',{exact:true}).fill('無案件範本草稿');
    await manager.getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('.ant-modal-confirm').getByRole('button',{name:'繼續編輯',exact:true}).click();
    assert.equal(await manager.getByLabel('測項名稱',{exact:true}).inputValue(),'無案件範本草稿');
    await page.evaluate(()=>{void window.__instanceRouter.navigate('/other')});
    await page.locator('.ant-modal-confirm').getByRole('button',{name:'繼續編輯',exact:true}).click();
    assert.equal(await manager.getByLabel('測項名稱',{exact:true}).inputValue(),'無案件範本草稿');
    await page.evaluate(()=>{void window.__instanceRouter.navigate('/other')});
    await page.locator('.ant-modal-confirm').getByRole('button',{name:'放棄修改',exact:true}).click();
    await page.getByRole('heading',{name:'合成其他頁面',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__instance.posts.length),0);
  });

  await scenario('template draft protects nested drawer close and navigation to another case', async () => {
    await load(); await open('item-a');
    await drawer().getByRole('button',{name:'維修範本',exact:true}).click();
    const manager=page.getByRole('dialog',{name:'維修範本',exact:true});
    await manager.getByRole('button',{name:'建立草稿',exact:true}).click();
    await manager.getByLabel('測項名稱',{exact:true}).fill('案件 A 尚未保存的範本');
    await manager.getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('.ant-modal-confirm').getByRole('button',{name:'繼續編輯',exact:true}).click();
    assert.equal(await manager.getByLabel('測項名稱',{exact:true}).inputValue(),'案件 A 尚未保存的範本');
    await page.evaluate(()=>{void window.__instanceRouter.navigate('/operations/repair?entityId=instance-company&queue=all&itemId=item-b')});
    await page.locator('.ant-modal-confirm').getByRole('button',{name:'繼續編輯',exact:true}).click();
    assert.equal(await manager.getByLabel('測項名稱',{exact:true}).inputValue(),'案件 A 尚未保存的範本');
    await page.evaluate(()=>{void window.__instanceRouter.navigate('/operations/repair?entityId=instance-company&queue=all&itemId=item-b')});
    await page.locator('.ant-modal-confirm').getByRole('button',{name:'放棄修改',exact:true}).click();
    await page.getByRole('heading',{name:'合成 B 產品',exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog',{name:'維修範本',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.__instance.posts.length),0);
    assert.equal(await page.locator('.repair-workbench-page > .ant-tabs [role=tablist]').first().getByRole('tab').count(),3);
  });

  const currentHashes = Object.fromEntries([pagePath, documentsPath].map(path => [path, digest(readFileSync(join(root, path)))]));
  t.diagnostic(JSON.stringify({ servedHashes, currentHashes, currentProductStable: !baseline && JSON.stringify(currentHashes) === JSON.stringify(servedHashes) }));
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(networkWrites, []);
});
