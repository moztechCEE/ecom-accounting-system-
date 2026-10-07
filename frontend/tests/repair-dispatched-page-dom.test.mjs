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
import React from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};
const id=new URL(location.href).searchParams.get('item');
const router=createMemoryRouter([{path:'/operations/repair',element:React.createElement(RepairWorkbenchPage)}],
  {initialEntries:['/operations/repair?entityId=synthetic-company&itemId='+id+(id.includes('-')?'&queue=records':'')]});
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const api = `
const base={id:'synthetic-item',label:'SYNTHETIC',productName:'合成測試品',sku:'SYNTHETIC-SKU',serialNumber:'SYNTHETIC-SN',
  status:'DISPATCHED',statusLabel:'已交物流寄回，待顧客收件',version:12,matchResult:'MATCH',location:'合成歷史位置',
  custodianId:'synthetic-clerk',custodianName:'合成收發員',repairOwnerId:'synthetic-tech',nextUserId:null,nextUserName:null,
  recipientId:null,mine:false,evidenceCount:0,physicalCustody:'UNKNOWN',editable:false,allowedWorkflowActions:[],
  receipt:{number:'SYNTHETIC-RCPT',category:'REPAIR',sourceCaseId:'synthetic-source',sourceNumber:'SYNTHETIC-CASE',customerServiceUserId:'synthetic-csr'},
  repairInspection:{number:'SYNTHETIC-INS',revision:2,status:'SUBMITTED',authorId:'synthetic-tech',authorName:'合成技師',
    updatedAt:'2026-10-08T02:00:00Z',data:{complaint:'合成故障',reproduction:'NO',testConditions:'合成条件',
      checks:[{name:'合成檢測',result:'PASS',observation:'合成觀察'}],diagnosis:'合成診斷',causeStatus:'UNKNOWN',plan:'RETURN',
      planNote:'合成原件退回',feeSuggestion:'FREE',estimateNote:''}},
  repairReport:null,repairWorkflow:{release:{purpose:'RETURN_UNREPAIRED',note:'合成拒修原件品況及配件'}},
  history:[{id:'synthetic-history',action:'dispatch',actorName:'合成收發員',createdAt:'2026-10-08T03:00:00Z',
    toStatus:'DISPATCHED',version:12,note:'合成實際寄出紀錄；承運商 SYN-CARRIER／單號 SYN-OUT-001'}],
  deliverySummary:[{target:'AFTER_SALES',status:'DELIVERED',count:1},
    {target:'AI_CUSTOMER_SERVICE',status:'DELIVERED',count:1},
    {target:'AFTER_SALES',status:'PENDING',count:2},{target:'AI_CUSTOMER_SERVICE',status:'FAILED',count:3}]};
const rows={};
for(const plan of ['RETURN','REPAIR','REPLACE','FACTORY']) for(const refusal of [true,false]) {
  const id=plan+'-'+(refusal?'refusal':'completed');
  const item=structuredClone(base);item.id=id;item.repairInspection.data.plan=plan;
  item.repairWorkflow.release.purpose=refusal?'RETURN_UNREPAIRED':'REPAIRED';
  if(!refusal)item.repairReport={number:'SYNTHETIC-REP',revision:1,status:'SUBMITTED',inspectionRevision:2,
    authorId:'synthetic-tech',authorName:'合成技師',updatedAt:'2026-10-08T02:00:00Z',
    data:{outcome:'REPAIRED',workPerformed:'合成已保存處置',parts:[],laborMinutes:1,
      checks:[{name:'合成複驗',result:'PASS',observation:'合成通過'}],qcResult:'PASS',qcNotes:'合成紀錄',deliveredAccessories:'合成配件'}};
  rows[id]=item;
}
for(const [id,status] of [['waiting','WAITING_RETURN_ACCEPTANCE'],['ready','READY_FOR_DISPATCH']]) {
  rows[id]=structuredClone(base);rows[id].id=id;rows[id].status=status;rows[id].statusLabel=status==='READY_FOR_DISPATCH'?'待寄回':'待收發簽收';rows[id].physicalCustody='MAILROOM';
}
window.__repairPageFixture={rows,posts:[],queries:[]};
export const API_URL='/offline-api';
export const documents=async(_,id)=>structuredClone(rows[id]);
export default {get:async(path,options)=>{
  if(path==='/mailroom/items'){
    window.__repairPageFixture.queries.push(options.params);
    const items=Object.values(rows).filter(row=>options.params.repairScope!=='records'||
      ['READY_FOR_DISPATCH','DISPATCHED','PENDING_WELFARE_STOCK'].includes(row.status));
    return {data:{items,total:items.length}};
  }
  if(path==='/mailroom/source-cases')return {data:{items:[],nextCursor:null}};
  throw Error('Unexpected synthetic GET '+path);
},post:async(path,body)=>{window.__repairPageFixture.posts.push({path,body});throw Error('No write in read-only fixture')}};
`;

test('full repair page keeps dispatched refusal history consistent with readonly guidance across saved plans', {
  skip: !executablePath && 'Requires an existing browser; no installation', timeout: 60000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-repair-dispatched-page-'));
  const virtual = '\0repair-dispatched-page-fixture';
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-full-repair-page',
      resolveId(id) { if (id === 'virtual:repair-dispatched-page-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'synthetic-tech',roles:[],permissions:['repair_workbench:read','repair_workbench:update']}});`;
        if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/services/repair.ts')) return `import {documents} from './api';export const repairService={documents,workflow:async()=>{throw Error('No workflow in readonly fixture')}};`;
        if (id.endsWith('/src/services/websocket.service.ts')) return `export const webSocketService={subscribe:()=>()=>{}};`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/__repair-dispatched-page')) return next();
          try {
            const html = await vite.transformIndexHtml('/__repair-dispatched-page', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:repair-dispatched-page-fixture"></script></body></html>');
            response.setHeader('Content-Type', 'text/html'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }] });
  t.after(async () => { await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [], external = [], networkWrites = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request=route.request();
    const host = new URL(request.url()).hostname;
    if(!['GET','HEAD'].includes(request.method())){networkWrites.push(request.method()+' '+request.url());return route.abort();}
    if (host === '127.0.0.1') return route.continue();
    external.push(host); return route.abort();
  });
  const assertCleanCopy = async drawer => {
    const text=await drawer.innerText();
    for(const note of ['以下「系統已接收」是既有進度的回執','不代表本次寄出已同步，也不代表已通知顧客',
      '以上依目前保存資料與本人作業條件顯示','同步成功表示對方系統已收到事件',
      '客服接手及方案回覆各有獨立紀錄','工作單、版本與估價說明'])
      assert(!text.includes(note),'static instruction must be removed even after disclosure: '+note);
    assert.equal(await page.locator('.mailroom-heading .ant-typography-secondary').count(),0);
    assert.equal(await drawer.locator('.repair-readiness-compact .ant-alert-info').count(),0,'terminal records have no routine informational banner');
  };
  const open = async id => {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__repair-dispatched-page?item=${id}`);
    const drawer = page.locator('.ant-drawer-open');
    await drawer.getByText('案件資料與實物保管', { exact: true }).click();
    await drawer.getByText('目前實物保管', { exact: true }).waitFor();
    await drawer.getByText('原件與原廠作業', { exact: true }).click();
    await drawer.getByText('交接與處理歷程', { exact: true }).click();
    await drawer.locator('.repair-readiness-compact .ant-collapse-header').filter({hasText:'客服與放行'}).click();
    assert.match(await drawer.locator('.repair-detail-identity').innerText(),/SYNTHETIC-CASE/);
    assert.match(await drawer.locator('.repair-detail-identity').innerText(),/合成測試品/);
    assert.equal(await drawer.locator('textarea[id$="_complaint"]').inputValue(),'合成故障');
    return drawer;
  };
  for (const plan of ['RETURN', 'REPAIR', 'REPLACE', 'FACTORY']) for (const refusal of [true, false]) {
    const drawer = await open(`${plan}-${refusal ? 'refusal' : 'completed'}`);
    await drawer.getByText('已交物流寄回，待顧客收件', { exact: true }).last().waitFor();
    const text = await drawer.innerText();
    assert(!text.includes('後續由收發室本人簽收並安排原件寄回'));
    assert(!text.includes('等待指定收發室人員本人簽收'));
    assert(!text.includes('收發室已本人簽收，待安排原件寄回'));
    assert.match(text, /同步紀錄/);
    assert.match(text, /售後系統 · 歷史系統已接收 \(1\)/);
    assert.match(text, /AI 客服系統 · 歷史系統已接收 \(1\)/);
    assert.match(text, /售後系統 · 歷史待發送 \(2\)/);
    assert.match(text, /AI 客服系統 · 歷史發送失敗 \(3\)/);
    assert.match(text, /合成實際寄出紀錄；承運商 SYN-CARRIER／單號 SYN-OUT-001/);
    assert(!text.includes('顧客已收件'));assert(!text.includes('案件已結案'));
    await assertCleanCopy(drawer);
    const query = await page.evaluate(() => window.__repairPageFixture.queries[0]);
    assert.equal(query.entityId, 'synthetic-company');
    assert.equal(query.view, 'repair');
    assert.equal(query.repairScope, 'records');
    if (refusal) {
      assert.match(text, /未修原件 · 已交物流寄回/);
      assert.match(text, /已保存處置\s*未記錄/);
      assert.equal(await page.evaluate(id => window.__repairPageFixture.rows[id].repairReport, `${plan}-refusal`), null);
    } else {
      await drawer.getByRole('tab', { name: '維修單', exact: true }).click();
      await drawer.locator('textarea[id$="_workPerformed"]').waitFor();
      assert.equal(await drawer.locator('textarea[id$="_workPerformed"]').inputValue(),'合成已保存處置');
      assert.match(await drawer.innerText(), /原機實際維修/);
      assert.equal(await page.evaluate(id => window.__repairPageFixture.rows[id].repairReport.data.workPerformed,
        `${plan}-completed`), '合成已保存處置');
    }
    for (const name of ['認領案件','簽收實物','開始檢測','開始維修','開始換機','送客服確認',
      '交回收發室','退回原件','登記送廠','登記原廠收件','登記原廠寄回','取消原廠處理','簽收返還件',
      '認領此案件','本人確認實物簽收','開始替換處理','提交客服確認','複驗完成，交回收發室',
      '收發室簽收處理完成品','原件未修退回收發室','儲存草稿','保存草稿','提交檢修單','提交維修單']) {
      assert.equal(await drawer.getByRole('button', { name, exact: true }).count(), 0, `${plan}: ${name}`);
    }
    assert.equal(await drawer.locator('.repair-document-actions button').count(),0,'terminal documents expose no save or submit authority');
    assert.equal(await drawer.locator('textarea[id$="_complaint"]').isDisabled(),true);
    await assertCleanCopy(drawer);
    assert.equal(await page.evaluate(() => window.__repairPageFixture.posts.length), 0);
  }
  const ready = await open('ready');
  assert.match(await ready.innerText(), /未修原件 · 待收發寄回/);
  assert(!((await ready.innerText()).includes('未修原件 · 已交物流寄回')));
  await assertCleanCopy(ready);
  const waiting = await open('waiting');
  assert.match(await waiting.innerText(), /未修原件 · 待收發簽收/);
  assert(!((await waiting.innerText()).includes('未修原件 · 已交物流寄回')));
  await assertCleanCopy(waiting);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);assert.deepEqual(networkWrites,[]);
});
