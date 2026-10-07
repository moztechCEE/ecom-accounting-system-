import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const baselineSha = '28b5f06c7889085d9246aab7c33ab7090669c7a6';
const baselineRequested = process.env.REPAIR_TEST_BASELINE === '1';
const legacy = name => execFileSync('git', ['show', `${baselineSha}:frontend/src/pages/repair/${name}`], {
  cwd: root, encoding: 'utf8',
});
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
${baselineRequested ? "import BaselinePage from '/src/pages/repair/RepairWorkbenchPage.tsx?feedback-baseline';" : 'const BaselinePage=RepairWorkbenchPage;'}
import RepairReplacementStock from '/src/pages/repair/RepairReplacementStock.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};
const query=new URLSearchParams(location.search),state=window.__workflowFeedbackProbe;
let element;
if(query.get('kind')==='stock')element=React.createElement(RepairReplacementStock,{
  item:state.item,onSelected:value=>state.selections.push(value),onReleased:id=>state.released.push(id)});
else {
  const Page=query.has('baseline')?BaselinePage:RepairWorkbenchPage;
  const router=createMemoryRouter([{path:'/operations/repair',element:React.createElement(Page)}],
    {initialEntries:['/operations/repair?entityId=feedback-company&queue=mine&itemId=feedback-item']});
  element=React.createElement(RouterProvider,{router});
}
createRoot(document.getElementById('root')).render(element);
`;
const api = `
const query=new URLSearchParams(location.search),clone=value=>structuredClone(value);
const item={id:'feedback-item',entityId:'feedback-company',label:'SYNTHETIC-FEEDBACK',productName:'合成原廠測試品',
  sku:'SYNTHETIC-SKU',serialNumber:'SYNTHETIC-SN',status:'FACTORY_RECEIVED',statusLabel:'原廠已收件',version:17,
  matchResult:'MATCH',location:'合成原廠位置',custodianId:'feedback-tech',custodianName:'合成維修師',
  repairOwnerId:query.has('foreign')?'other-tech':'feedback-tech',nextUserId:null,nextUserName:null,
  recipientId:null,mine:true,evidenceCount:0,evidence:[],physicalCustody:'FACTORY',editable:true,
  allowedWorkflowActions:query.has('no-action')?[]:['cancel_factory'],
  receipt:{number:'SYNTHETIC-RCPT',category:'REPAIR',sourceCaseId:'synthetic-source',sourceNumber:'SYNTHETIC-CASE',
    customerServiceUserId:'synthetic-csr'},
  repairInspection:{number:'SYNTHETIC-INS',revision:3,status:'SUBMITTED',authorId:'feedback-tech',authorName:'合成維修師',
    updatedAt:'2026-10-08T02:00:00Z',data:{complaint:'合成故障',reproduction:'YES',testConditions:'合成條件',
      checks:[{name:'合成測試',result:'FAIL',observation:'合成觀察'}],diagnosis:'合成診斷',causeStatus:'CONFIRMED',
      plan:query.get('kind')==='stock'?'REPLACE':'FACTORY',replacementSku:'SYNTHETIC-REPLACEMENT',replacementCondition:'NEW',
      planNote:'合成方案',feeSuggestion:'FREE',estimateNote:''}},repairReport:null,
  repairWorkflow:{factory:{stage:'RECEIVED',physicalCustody:'FACTORY',factoryName:'合成原廠',reference:'SYNTHETIC-FACTORY-REF',
    carrier:'合成送廠物流',trackingNumber:'SYNTHETIC-OUTBOUND'}},history:[],deliverySummary:[]};
const own=['release-403','expired'].includes(query.get('stock'));
const unit={id:'synthetic-unit',unitLabel:'SYNTHETIC-UNIT',serialNumber:'SYNTHETIC-REPLACEMENT-SN',status:own?'RESERVED':'QUALIFIED',
  kind:'NEW',qualification:{sku:'SYNTHETIC-REPLACEMENT',hasSerialNumbers:true},
  reservations:own?[{id:'synthetic-reservation',itemId:item.id,status:'RESERVED',
    expiresAt:query.get('stock')==='expired'?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z'}]:[]};
const state={item,gets:[],posts:[],blockedWrites:[],pending:[],selections:[],released:[]};
window.__workflowFeedbackProbe=state;
const responseError=message=>({response:{status:403,data:{message}}});
export const API_URL='/offline-workflow-feedback-api';
export default {
  async get(path,options={}) {
    state.gets.push({path,params:clone(options.params||{})});
    if(path==='/mailroom/items')return {data:{items:[clone(item)],total:1}};
    if(path==='/mailroom/source-cases')return {data:{items:[],nextCursor:null}};
    if(path==='/repair-workbench/items/feedback-item/documents')return {data:clone(item)};
    if(path==='/after-sales/stock/units'){
      if(query.get('stock')==='units-403')throw responseError('SYNTHETIC 403：沒有合格庫存讀取權限');
      if(query.get('stock')==='units-network')throw Error('SYNTHETIC Network Error');
      return {data:[clone(unit)]};
    }
    throw Error('Unexpected offline GET '+path);
  },
  async post(path,body) {
    state.posts.push({path,body:clone(body)});
    if(path==='/repair-workbench/items/feedback-item/workflow'&&body.action==='cancel_factory'){
      await new Promise((resolve,reject)=>state.pending.push({resolve,reject}));
      return {data:{id:item.id,duplicate:false}};
    }
    if(path==='/after-sales/stock/reserve'&&query.get('stock')==='reserve-403')
      throw responseError('SYNTHETIC 403：沒有替換品預留權限');
    if(path==='/after-sales/stock/reservations/synthetic-reservation/release'&&query.get('stock')==='release-403')
      throw responseError('SYNTHETIC 403：沒有預留釋放權限');
    state.blockedWrites.push({path,body:clone(body)});
    throw Error('Unexpected offline POST '+path);
  }
};
`;

test('actual repair page and replacement stock preserve feedback, mounted forms and native command contracts', {
  skip: !executablePath && 'Requires an existing browser; no installation', timeout: 120000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-repair-workflow-feedback-'));
  const virtual = '\0repair-workflow-feedback-fixture';
  const baselinePage = baselineRequested ? legacy('RepairWorkbenchPage.tsx').replace("from './RepairWorkflowPanel'", "from './RepairWorkflowPanel.tsx?feedback-baseline'") : undefined;
  const baselineWorkflow = baselineRequested ? legacy('RepairWorkflowPanel.tsx') : undefined;
  let browser;
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-repair-workflow-feedback',
      resolveId(id) { if (id === 'virtual:repair-workflow-feedback-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/pages/repair/RepairWorkbenchPage.tsx?feedback-baseline')) return baselinePage;
        if (id.endsWith('/src/pages/repair/RepairWorkflowPanel.tsx?feedback-baseline')) return baselineWorkflow;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'feedback-tech',roles:[],permissions:new URLSearchParams(location.search).has('readonly')?['repair_workbench:read']:['repair_workbench:read','repair_workbench:update']}});`;
        if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/services/websocket.service.ts')) return `export const webSocketService={subscribe:()=>()=>{}};`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__repair-workflow-feedback') return next();
          try {
            const html = await vite.transformIndexHtml('/__repair-workflow-feedback', '<html lang="zh-Hant"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-workflow-feedback-fixture"></script></body></html>');
            response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }] });
  t.after(async () => {
    if (browser) await browser.close();
    await server.close(); rmSync(cacheDir, { recursive: true, force: true });
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [], external = [], networkWrites = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { networkWrites.push(request.method() + ' ' + request.url()); return route.abort(); }
    return route.continue();
  });
  const openWorkflow = async query => {
    await page.goto(origin + '/__repair-workflow-feedback?' + query);
    const drawer = page.locator('.ant-drawer-open');
    const disclosure = drawer.locator('.repair-editor-sidebar .ant-collapse-header').filter({ hasText: /原件.*原廠作業/ });
    await disclosure.waitFor(); await disclosure.click();
    return { drawer, disclosure, form: drawer.locator('form#repair-workflow-feedback-item') };
  };
  const rejectPending = async () => page.evaluate(() => window.__workflowFeedbackProbe.pending.shift().reject({
    response: { status: 403, data: { message: 'SYNTHETIC 403：原廠取消作業無權限' } },
  }));
  const expectedWorkflow = { entityId: 'feedback-company', expectedVersion: 17, action: 'cancel_factory', note: '合成取消原因：原廠不可修' };
  const assertWorkflowCommand = post => {
    assert.equal(post.path, '/repair-workbench/items/feedback-item/workflow');
    assert.deepEqual(Object.keys(post.body).sort(), ['action', 'entityId', 'expectedVersion', 'note', 'requestId']);
    assert.deepEqual({ ...post.body, requestId: undefined }, { ...expectedWorkflow, requestId: undefined });
    assert.match(post.body.requestId, /^[a-f0-9-]{36}$/);
  };

  if (baselineRequested) await t.test('fixed 28b5 baseline reproduces collapsible pending submission and hidden failure', async () => {
    const { drawer, disclosure, form } = await openWorkflow('baseline=1');
    await drawer.getByRole('button', { name: /^取消原廠處理/ }).click();
    await form.locator('textarea').fill('  合成取消原因：原廠不可修  ');
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.__workflowFeedbackProbe.pending.length === 1);
    await disclosure.click();
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false', 'baseline permits collapsing a pending workflow');
    await form.waitFor({ state: 'hidden' });
    await rejectPending();
    const alert = form.getByText('SYNTHETIC 403：原廠取消作業無權限', { exact: true });
    await alert.waitFor({ state: 'attached' });
    assert.equal(await alert.isVisible(), false, 'baseline failure remains inside hidden collapsed content');
    assert.equal(await drawer.locator('.repair-detail > .ant-alert-error').count(), 0);
    assertWorkflowCommand(await page.evaluate(() => window.__workflowFeedbackProbe.posts[0]));
  });

  await t.test('current page locks pending collapse and keeps error visible, typed DOM and retry request identity', async () => {
    const { drawer, disclosure, form } = await openWorkflow('');
    await drawer.getByRole('button', { name: '取消原廠處理', exact: true }).click();
    const note = form.locator('textarea');
    await note.fill('  合成取消原因：原廠不可修  ');
    await note.evaluate(node => { window.__workflowOriginalTextarea = node; });
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.__workflowFeedbackProbe.pending.length === 1);
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
    assert.equal(await disclosure.getAttribute('aria-disabled'), 'true');
    await disclosure.click({ force: true });
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'true', 'pending submission cannot collapse');
    assert.match(await form.locator('button[type="submit"]').getAttribute('class'), /ant-btn-loading/);
    assert.equal(await note.isDisabled(), true);
    await form.evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.__workflowFeedbackProbe.posts.length), 1, 'pending repeat submission must not issue another command');
    const first = await page.evaluate(() => window.__workflowFeedbackProbe.posts[0]);
    assertWorkflowCommand(first);
    await rejectPending();
    const alert = drawer.locator('.repair-detail > .ant-alert-error');
    await alert.getByText('SYNTHETIC 403：原廠取消作業無權限', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.repair-editor-sidebar .ant-collapse-header')?.getAttribute('aria-disabled') !== 'true');
    await disclosure.click();
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
    await note.waitFor({ state: 'hidden' });
    assert.equal(await alert.isVisible(), true, 'failure must stay visible outside the collapsed operation');
    assert.equal(await note.isVisible(), false);
    assert.equal(await note.inputValue(), '  合成取消原因：原廠不可修  ');
    assert(await note.evaluate(node => node === window.__workflowOriginalTextarea), 'collapse must not replace the typed form');
    await disclosure.click();
    assert.equal(await note.inputValue(), '  合成取消原因：原廠不可修  ');
    assert(await note.evaluate(node => node === window.__workflowOriginalTextarea));
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(() => window.__workflowFeedbackProbe.pending.length === 1 && window.__workflowFeedbackProbe.posts.length === 2);
    assert.equal(await alert.count(), 0, 'a new attempt clears the stale failure');
    const retry = await page.evaluate(() => window.__workflowFeedbackProbe.posts[1]);
    assertWorkflowCommand(retry);
    assert.equal(retry.body.requestId, first.body.requestId, 'same failed command retains its native idempotency key');
    await rejectPending();
    await alert.waitFor();
  });

  for (const [query, reason] of [['readonly=1', 'update permission'], ['foreign=1', 'assigned repair owner'], ['no-action=1', 'server action allowlist']]) {
    await t.test(`current page still enforces ${reason}`, async () => {
      const { drawer, form } = await openWorkflow(query);
      assert.equal(await drawer.getByRole('button', { name: '取消原廠處理', exact: true }).count(), 0);
      assert.equal(await form.count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.posts), []);
    });
  }

  const openStock = async mode => {
    await page.goto(origin + '/__repair-workflow-feedback?kind=stock&stock=' + mode);
    await page.getByRole('combobox', { name: '選擇替換品', exact: true }).waitFor();
    await page.waitForFunction(() => window.__workflowFeedbackProbe.gets.some(row => row.path === '/after-sales/stock/units'));
  };
  const chooseUnit = async () => {
    await page.getByRole('combobox', { name: '選擇替換品', exact: true }).click();
    await page.locator('.ant-select-item-option-content').getByText('SYNTHETIC-UNIT', { exact: false }).click();
    await page.getByRole('button', { name: '預留並帶入', exact: true }).click();
  };
  const assertNoInventedStockReason = async () => {
    const text = await page.locator('body').innerText();
    assert.doesNotMatch(text, /庫存尚未準備|取消本案舊預留|方案也可能已更新|預留未完成或已過期/);
  };
  await t.test('units 403 preserves the actual response and scope', async () => {
    await openStock('units-403');
    await page.getByText('SYNTHETIC 403：沒有合格庫存讀取權限', { exact: true }).waitFor();
    await assertNoInventedStockReason();
    const reads = await page.evaluate(() => window.__workflowFeedbackProbe.gets);
    assert.deepEqual(reads, [{ path: '/after-sales/stock/units', params: { entityId: 'feedback-company', itemId: 'feedback-item' } }]);
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.posts), []);
  });
  await t.test('units network failure uses neutral existing errorText, not an inventory diagnosis', async () => {
    await openStock('units-network');
    await page.getByText('暫時無法完成，請稍後重試。', { exact: true }).waitFor();
    await assertNoInventedStockReason();
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.posts), []);
  });
  await t.test('reserve 403 preserves actual feedback, payload and retry key without advising cancellation', async () => {
    await openStock('reserve-403'); await chooseUnit();
    await page.getByText('SYNTHETIC 403：沒有替換品預留權限', { exact: true }).waitFor();
    await assertNoInventedStockReason();
    const first = await page.evaluate(() => window.__workflowFeedbackProbe.posts[0]);
    assert.equal(first.path, '/after-sales/stock/reserve');
    assert.deepEqual(Object.keys(first.body).sort(), ['entityId', 'expectedVersion', 'itemId', 'requestId', 'unitId']);
    assert.deepEqual({ ...first.body, requestId: undefined }, {
      entityId: 'feedback-company', itemId: 'feedback-item', unitId: 'synthetic-unit', expectedVersion: 17, requestId: undefined,
    });
    assert.match(first.body.requestId, /^[a-f0-9-]{36}$/);
    await page.getByRole('button', { name: '預留並帶入', exact: true }).click();
    await page.waitForFunction(() => window.__workflowFeedbackProbe.posts.length === 2);
    const retry = await page.evaluate(() => window.__workflowFeedbackProbe.posts[1]);
    assert.deepEqual(retry, first);
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.selections), []);
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.released), []);
  });
  await t.test('release 403 preserves actual feedback and release payload without clearing the reservation', async () => {
    await openStock('release-403');
    await page.getByRole('button', { name: '取消預留', exact: true }).click();
    await page.getByText('SYNTHETIC 403：沒有預留釋放權限', { exact: true }).waitFor();
    await assertNoInventedStockReason();
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.posts), [{
      path: '/after-sales/stock/reservations/synthetic-reservation/release', body: { entityId: 'feedback-company' },
    }]);
    assert.equal(await page.getByText('已預留 · SYNTHETIC-UNIT', { exact: true }).isVisible(), true);
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.released), []);
  });
  await t.test('only a locally expired reservation produces the expiry hint, without a reserve or release write', async () => {
    await openStock('expired'); await chooseUnit();
    await page.getByText('預留已過期，請重新核對。', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.posts), []);
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.selections), []);
    assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.released), []);
  });
  assert.deepEqual(await page.evaluate(() => window.__workflowFeedbackProbe.blockedWrites), []);
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(networkWrites, []);
});
