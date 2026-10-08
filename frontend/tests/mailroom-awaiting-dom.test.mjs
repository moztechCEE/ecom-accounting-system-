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
const executablePath = [chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import MailroomPage from '/src/pages/mailroom/MailroomPage.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};
const router=createMemoryRouter([{path:'/operations/mailroom',element:React.createElement(MailroomPage)}],
  {initialEntries:['/operations/mailroom?entityId=company-A']});
window.awaitingRouter=router;
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const api = `
const state=window.awaitingFixture={plans:[],calls:[],posts:[],boundaryErrors:[],pending:{}};
function unexpected(message){state.boundaryErrors.push(message);throw Error(message);}
state.release=key=>{const resume=state.pending[key];if(!resume)return unexpected('No pending synthetic GET '+key);delete state.pending[key];resume();};
export const API_URL='/offline-api';
export default {
  async get(path,options={}){
    if(path==='/mailroom/source-summary')return {data:{complete:false,counts:null}};
    if(path==='/mailroom/items')return {data:{items:[],total:0}};
    if(path==='/mailroom/people'||path==='/mailroom/tasks')return {data:[]};
    if(path!=='/mailroom/source-cases')return unexpected('Unexpected synthetic GET '+path);
    const params=structuredClone(options.params||{}),plan=state.plans.shift();
    if(!plan||params.awaiting!==true||params.entityId!==plan.entityId||params.search!==plan.search||params.cursor!==plan.cursor)
      return unexpected('Unexpected awaiting query '+JSON.stringify(params));
    const call={key:plan.key,params,settled:false};state.calls.push(call);
    try{
      if(plan.hold)await new Promise(resolve=>{state.pending[plan.key]=resolve;});
      if(plan.failure)throw {response:{status:503,data:{message:plan.failure}}};
      return {data:{items:structuredClone(plan.items||[]),nextCursor:plan.nextCursor||null}};
    }finally{call.settled=true;}
  },
  async post(path){state.posts.push(path);return unexpected('Business POST forbidden '+path);},
  async put(path){return unexpected('Business PUT forbidden '+path);},
  async delete(path){return unexpected('Business DELETE forbidden '+path);}
};
`;
const row = (number, entityId = 'company-A') => ({
  id: `${entityId}-${number}`, number, type: 'REPAIR', status: 'OPEN', statusLabel: '待收件',
  customerLabel: `Synthetic customer ${entityId}`, assigneeName: 'Synthetic CSR',
  version: '2026-10-08T06:00:00Z', expectedQuantity: 2, receivedQuantity: 0, remainingQuantity: 2,
  items: [{ id: `${number}-line`, name: `Synthetic product ${number}`, quantity: 2, remainingQuantity: 2 }],
});
const plan = (key, search, items = [], extra = {}) => ({ key, entityId: 'company-A', search, items, ...extra });

test('actual awaiting queue separates failed reads from empty results and scopes retained snapshots', {
  skip: !executablePath && 'Requires an existing browser; never installs one', timeout: 90000,
}, async context => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-mailroom-awaiting-dom-'));
  const virtual = '\0mailroom-awaiting-fixture';
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-actual-mailroom-awaiting',
      resolveId(id) { if (id === 'virtual:mailroom-awaiting-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `const user={id:'synthetic-reader',roles:['EMPLOYEE'],permissions:['mailroom:read']};export const useAuth=()=>({user});`;
        if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/services/websocket.service.ts')) return `export const webSocketService={subscribe:()=>()=>{}};`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== '/__mailroom-awaiting') return next();
          try {
            const html = await vite.transformIndexHtml('/__mailroom-awaiting', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:mailroom-awaiting-fixture"></script></body></html>');
            response.setHeader('Content-Type', 'text/html'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
  });
  let browser;
  const errors = [], blocked = [];
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ executablePath, headless: true });
    const enqueue = (page, next) => page.evaluate(value => window.awaitingFixture.plans.push(value), next);
    const settled = (page, key) => page.waitForFunction(value => window.awaitingFixture.calls.some(call => call.key === value && call.settled), key);
    const held = (page, key) => page.waitForFunction(value => Boolean(window.awaitingFixture.pending[value]), key);
    const release = async (page, key) => {
      await page.evaluate(value => window.awaitingFixture.release(value), key);
      await settled(page, key);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const card = page => page.locator('.mailroom-list').filter({ has: page.getByText('售後待到貨', { exact: true }) });
    const header = page => card(page).locator('.ant-card-head').innerText();
    const numbers = page => card(page).locator('.ant-table-tbody strong').allTextContents();
    const search = async (page, query, next) => {
      await enqueue(page, next);
      const input = card(page).getByRole('searchbox', { name: '搜尋待到貨案件', exact: true });
      await input.fill(query); await input.press('Enter');
    };
    const failed = async (page, next) => {
      await settled(page, next.key);
      await card(page).getByText(next.failure, { exact: true }).waitFor();
    };
    const unloaded = async page => {
      assert.doesNotMatch(await header(page), /0\s*筆已載入/, 'A failed/unresolved GET must not establish a zero-count snapshot');
      assert.equal(await card(page).getByText('目前沒有待到貨案件', { exact: true }).count(), 0,
        'Only a successful empty response can establish no awaiting cases');
      assert.match(await card(page).innerText(), /清單未載入|待到貨清單尚未載入/);
      assert.deepEqual(await numbers(page), []);
    };
    const loaded = async (page, expected, stale = false) => {
      await page.waitForFunction(({ expected, stale }) => {
        const actual = [...document.querySelectorAll('.mailroom-list .ant-table-tbody strong')].map(element => element.textContent);
        const title = document.querySelector('.mailroom-list .ant-card-head')?.textContent || '';
        return JSON.stringify(actual) === JSON.stringify(expected)
          && new RegExp(expected.length + '\\s*筆已載入').test(title) && title.includes('未更新') === stale;
      }, { expected, stale });
      assert.deepEqual(await numbers(page), expected);
      assert.match(await header(page), new RegExp(`${expected.length}\\s*筆已載入`));
      assert.equal((await header(page)).includes('未更新'), stale, 'Refresh failure must mark a retained snapshot stale');
    };
    const success = async (page, next, expected) => {
      await settled(page, next.key); await loaded(page, expected);
      assert.equal(await card(page).locator('.ant-alert-warning,.ant-alert-error').count(), 0);
    };
    const empty = async page => {
      await loaded(page, []);
      await card(page).getByText('目前沒有待到貨案件', { exact: true }).waitFor();
      assert.equal(await card(page).locator('.ant-alert-warning,.ant-alert-error').count(), 0);
    };
    const retry = async (page, next) => { await enqueue(page, next); await card(page).getByRole('button', { name: /^重\s*試$/ }).click(); };
    const refresh = async (page, next) => { await enqueue(page, next); await page.getByRole('button', { name: /重新整理$/ }).click(); };
    const open = async first => {
      const page = await browser.newPage({ viewport: { width: 1123, height: 972 } });
      page.setDefaultTimeout(8000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin || request.method() !== 'GET') {
          blocked.push({ method: request.method(), url: request.url() }); return route.abort();
        }
        return route.continue();
      });
      await page.goto(origin + '/__mailroom-awaiting');
      await page.getByRole('heading', { name: '收發室工作台', exact: true }).waitFor();
      await enqueue(page, first);
      await page.getByRole('tab', { name: '售後待到貨', exact: true }).click();
      return page;
    };
    const close = async page => {
      assert.deepEqual(await page.evaluate(() => window.awaitingFixture.posts), []);
      assert.deepEqual(await page.evaluate(() => window.awaitingFixture.boundaryErrors), []);
      assert.deepEqual(await page.evaluate(() => window.awaitingFixture.plans), []);
      assert.deepEqual(await page.evaluate(() => Object.keys(window.awaitingFixture.pending)), []);
      context.diagnostic(`Synthetic awaiting GETs: ${await page.evaluate(() => window.awaitingFixture.calls.length)}; business POSTs: 0; blocked external requests: ${blocked.length}`);
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []); await page.close();
    };

    // First failure is unknown, while a successful empty retry is genuinely empty.
    const initial = plan('initial-failure', '', [], { failure: 'Synthetic initial GET failure' });
    const page = await open(initial);
    await failed(page, initial); await unloaded(page);
    const initialEmpty = plan('initial-empty-retry', '');
    await retry(page, initialEmpty); await success(page, initialEmpty, []); await empty(page);

    // A new query cannot borrow a successful snapshot from the old query.
    const old = plan('old-query', 'OLD', [row('OLD-CASE')]);
    await search(page, 'OLD', old); await success(page, old, ['OLD-CASE']);
    const changed = plan('changed-query-failure', 'NEW', [], { failure: 'Synthetic new-query GET failure' });
    await search(page, 'NEW', changed); await failed(page, changed); await unloaded(page);
    assert.doesNotMatch(await card(page).innerText(), /OLD-CASE/);
    const current = plan('current-query-retry', 'NEW', [row('CURRENT-CASE')]);
    await retry(page, current); await success(page, current, ['CURRENT-CASE']);

    // Header revision and quiet visibility refresh keep only this query's last success.
    const revision = plan('header-refresh-failure', 'NEW', [], { hold: true, failure: 'Synthetic header GET failure' });
    await refresh(page, revision); await held(page, revision.key); await loaded(page, ['CURRENT-CASE']);
    await release(page, revision.key); await failed(page, revision); await loaded(page, ['CURRENT-CASE'], true);
    const refreshed = plan('header-retry-success', 'NEW', [row('REFRESHED-CASE')]);
    await retry(page, refreshed); await success(page, refreshed, ['REFRESHED-CASE']);
    const quiet = plan('quiet-refresh-failure', 'NEW', [], { failure: 'Synthetic quiet GET failure' });
    await enqueue(page, quiet); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await failed(page, quiet); await loaded(page, ['REFRESHED-CASE'], true);
    const laterEmpty = plan('quiet-retry-empty', 'NEW');
    await retry(page, laterEmpty); await success(page, laterEmpty, []); await empty(page);
    const staleEmpty = plan('empty-refresh-failure', 'NEW', [], { failure: 'Synthetic empty refresh GET failure' });
    await refresh(page, staleEmpty); await failed(page, staleEmpty); await loaded(page, [], true);
    assert.equal(await card(page).getByText('目前沒有待到貨案件', { exact: true }).count(), 0);
    await card(page).getByText('上次查詢沒有待到貨案件', { exact: true }).waitFor();
    const emptyRecovery = plan('empty-refresh-recovery', 'NEW');
    await retry(page, emptyRecovery); await success(page, emptyRecovery, []); await empty(page); await close(page);

    // Company B starts unloaded, never displays A, and ignores a late A refresh.
    const firstCompany = plan('company-A-initial', '', [row('A-CASE')]);
    const companyPage = await open(firstCompany); await success(companyPage, firstCompany, ['A-CASE']);
    const lateA = plan('company-A-late-refresh', '', [row('LATE-A')], { hold: true });
    await refresh(companyPage, lateA); await held(companyPage, lateA.key);
    const failedB = plan('company-B-failure', '', [], { entityId: 'company-B', hold: true, failure: 'Synthetic company-B GET failure' });
    await enqueue(companyPage, failedB);
    await companyPage.evaluate(() => window.awaitingRouter.navigate('/operations/mailroom?entityId=company-B'));
    await held(companyPage, failedB.key); await unloaded(companyPage);
    assert.doesNotMatch(await card(companyPage).innerText(), /A-CASE|Synthetic customer company-A/);
    await release(companyPage, failedB.key); await failed(companyPage, failedB); await unloaded(companyPage);
    const successB = plan('company-B-success', '', [row('B-CASE', 'company-B')], { entityId: 'company-B' });
    await retry(companyPage, successB); await success(companyPage, successB, ['B-CASE']);
    await release(companyPage, lateA.key); await loaded(companyPage, ['B-CASE']);
    assert.doesNotMatch(await card(companyPage).innerText(), /LATE-A|Synthetic customer company-A/); await close(companyPage);

    // Initial loading and out-of-order query responses do not invent a snapshot.
    const slow = plan('slow-old-query', '', [row('SLOW-OLD')], { hold: true });
    const orderPage = await open(slow); await held(orderPage, slow.key); await unloaded(orderPage);
    const fast = plan('fast-new-query', 'FAST', [row('FAST-CASE')]);
    await search(orderPage, 'FAST', fast); await success(orderPage, fast, ['FAST-CASE']);
    await release(orderPage, slow.key); await loaded(orderPage, ['FAST-CASE']);
    assert.doesNotMatch(await card(orderPage).innerText(), /SLOW-OLD/); await close(orderPage);

    // A successful extra page cannot make a failed full refresh look current.
    const firstPage = plan('pagination-initial', '', [row('PAGE-1')], { nextCursor: 'synthetic-next' });
    const paginationPage = await open(firstPage); await success(paginationPage, firstPage, ['PAGE-1']);
    const fullFailure = plan('pagination-refresh-failure', '', [], { failure: 'Synthetic paginated refresh GET failure' });
    await refresh(paginationPage, fullFailure); await failed(paginationPage, fullFailure); await loaded(paginationPage, ['PAGE-1'], true);
    const more = plan('pagination-more-success', '', [row('PAGE-2')], { cursor: 'synthetic-next' });
    await enqueue(paginationPage, more);
    await card(paginationPage).getByRole('button', { name: '載入更多待到貨案件', exact: true }).click();
    await settled(paginationPage, more.key); await loaded(paginationPage, ['PAGE-1', 'PAGE-2'], true);
    await card(paginationPage).getByText(fullFailure.failure, { exact: true }).waitFor();
    const refreshedFirst = plan('pagination-full-recovery-first', '', [row('FRESH-1')], { nextCursor: 'synthetic-next' });
    const refreshedSecond = plan('pagination-full-recovery-second', '', [row('FRESH-2')], { cursor: 'synthetic-next' });
    await enqueue(paginationPage, refreshedFirst); await enqueue(paginationPage, refreshedSecond);
    await paginationPage.getByRole('button', { name: /重新整理$/ }).click();
    await success(paginationPage, refreshedSecond, ['FRESH-1', 'FRESH-2']); await close(paginationPage);

    // Alert retry owns the new refresh and releases an obsolete pagination request.
    const busyInitial = plan('busy-initial', '', [row('BUSY-INITIAL')], { nextCursor: 'synthetic-busy-next' });
    const busyPage = await open(busyInitial); await success(busyPage, busyInitial, ['BUSY-INITIAL']);
    const busyFailure = plan('busy-full-refresh-failure', '', [], { failure: 'Synthetic busy refresh GET failure' });
    await refresh(busyPage, busyFailure); await failed(busyPage, busyFailure); await loaded(busyPage, ['BUSY-INITIAL'], true);
    const footer = card(busyPage).locator('.mailroom-load-more');
    const oldMore = plan('busy-obsolete-more', '', [row('LATE-OLD-MORE')], {
      cursor: 'synthetic-busy-next', nextCursor: 'synthetic-stale-cursor', hold: true,
    });
    await enqueue(busyPage, oldMore); await footer.click(); await held(busyPage, oldMore.key);
    assert.equal(await footer.evaluate(button => button.classList.contains('ant-btn-loading')), true,
      'A pending pagination GET must show its busy state');
    const retryRefresh = plan('busy-retry-refresh', '', [row('RETRY-FRESH-1')], {
      nextCursor: 'synthetic-current-next', hold: true,
    });
    await retry(busyPage, retryRefresh); await held(busyPage, retryRefresh.key);
    assert.equal(await footer.isDisabled(), true, 'A pending full refresh must prevent reverse pagination overlap');
    await release(busyPage, retryRefresh.key); await success(busyPage, retryRefresh, ['RETRY-FRESH-1']);
    assert.equal(await footer.evaluate(button => button.classList.contains('ant-btn-loading')), false,
      'Alert retry must release superseded pagination busy state');
    assert.equal(await footer.isEnabled(), true);
    const currentMore = plan('busy-current-more', '', [row('CURRENT-PAGE-2')], {
      cursor: 'synthetic-current-next', nextCursor: 'synthetic-current-next-2', hold: true,
    });
    await enqueue(busyPage, currentMore); await footer.click(); await held(busyPage, currentMore.key);
    assert.equal(await footer.evaluate(button => button.classList.contains('ant-btn-loading')), true);
    await release(busyPage, oldMore.key); await loaded(busyPage, ['RETRY-FRESH-1']);
    assert.doesNotMatch(await card(busyPage).innerText(), /LATE-OLD-MORE/);
    assert.equal(await footer.evaluate(button => button.classList.contains('ant-btn-loading')), true,
      'An obsolete pagination finally must not clear the current pagination busy state');
    await release(busyPage, currentMore.key);
    await success(busyPage, currentMore, ['RETRY-FRESH-1', 'CURRENT-PAGE-2']);
    const pollFirst = plan('busy-poll-first', '', [row('POLL-FRESH-1')], { nextCursor: 'synthetic-poll-next' });
    const pollSecond = plan('busy-poll-second', '', [row('POLL-FRESH-2')], {
      cursor: 'synthetic-poll-next', nextCursor: 'synthetic-poll-remaining',
    });
    await enqueue(busyPage, pollFirst); await enqueue(busyPage, pollSecond);
    await busyPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await success(busyPage, pollSecond, ['POLL-FRESH-1', 'POLL-FRESH-2']);
    assert.equal(await footer.evaluate(button => button.classList.contains('ant-btn-loading')), false);
    assert.equal(await footer.isEnabled(), true); await close(busyPage);
  } catch (error) {
    for (const browserContext of browser?.contexts() || []) {
      for (const page of browserContext.pages()) {
        const diagnostic = await page.evaluate(() => ({ calls: window.awaitingFixture?.calls,
          boundaryErrors: window.awaitingFixture?.boundaryErrors, view: document.querySelector('.mailroom-list')?.innerText,
        })).catch(() => null);
        context.diagnostic(JSON.stringify(diagnostic));
      }
    }
    throw error;
  } finally {
    await browser?.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true });
  }
});
