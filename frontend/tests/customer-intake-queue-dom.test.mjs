import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Real queue, service, Ant Table/Drawer/Form and assignment/custody helpers.
// Only authenticated session and HTTP transport are synthetic; no business command is allowed.
const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePaths = ['src/pages/mailroom/CustomerIntakeQueue.tsx', 'src/services/mailroom-intake.ts', 'src/pages/mailroom/intake-actions.ts', 'src/pages/mailroom/item-custody.ts', 'src/pages/mailroom/model.ts', 'src/pages/repair/repair-feedback.tsx', 'src/utils/access.ts', 'src/pages/mailroom/SourceCasePicker.tsx'];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
const auth = `import {createContext,useContext} from 'react'; export const FixtureAuth=createContext({user:null}); export const useAuth=()=>useContext(FixtureAuth);`;
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FixtureAuth} from '/src/contexts/AuthContext.tsx';
import CustomerIntakeQueue from '/src/pages/mailroom/CustomerIntakeQueue.tsx';
window.__APP_CONFIG__={mailroomEnabled:window.intakeInitial.enabled!==false};
function Harness(){
  const [user,setUser]=useState(window.intakeInitial.user),[entityId,setEntity]=useState(window.intakeInitial.entityId),[dirty,setDirty]=useState(false);
  window.intakeFixture.actorId=user?.id||'';
  window.intakeHarness={setUser,setEntity};
  return React.createElement(FixtureAuth.Provider,{value:{user}},
    React.createElement('output',{id:'session-scope'},(user?.id||'')+' / '+entityId),
    React.createElement('output',{id:'dirty'},String(dirty)),
    React.createElement(CustomerIntakeQueue,{entityId,onDirtyChange:setDirty,onOpenSource:id=>window.intakeFixture.sourceOpens.push(id)}));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const api = `
const state=window.intakeFixture={plans:window.intakeInitial.plans,calls:[],sourceReads:[],posts:[],sourceOpens:[],boundaryErrors:[],pending:{},details:window.intakeInitial.details||{}};
function unexpected(message){state.boundaryErrors.push(message);throw Error(message);}
state.release=key=>{const resolve=state.pending[key];if(!resolve)return unexpected('Missing held request '+key);delete state.pending[key];resolve();};
export default {
 async get(path,options={}){
  const params=structuredClone(options.params||{}),actorId=state.actorId;
  if(path==='/mailroom/source-cases'){state.sourceReads.push({path,params,actorId});return {data:{items:[],nextCursor:null}};}
  const kind=path==='/mailroom/intake-queue'?'queue':path.startsWith('/mailroom/items/')?'detail':null;
  if(!kind)return unexpected('Unexpected GET '+path);
  const next=state.plans[0];
  if(kind==='detail'&&next?.kind!=='detail'){
   const value=state.details[params.entityId+'|'+actorId+'|'+decodeURIComponent(path.slice('/mailroom/items/'.length))];
   if(!value)return unexpected('Unplanned item detail');
   state.calls.push({kind,path,params,actorId,key:'automatic-detail',settled:true});return {data:structuredClone(value)};
  }
  const plan=state.plans.shift();
  if(!plan||plan.kind!==kind||plan.entityId!==params.entityId||plan.actorId!==actorId||kind==='queue'&&(plan.page!==params.page||plan.search!==params.search)||kind==='detail'&&path!=='/mailroom/items/'+encodeURIComponent(plan.itemId))return unexpected('Unexpected synthetic request '+kind+' '+JSON.stringify({params,actorId}));
  const call={kind,path,params,actorId,key:plan.key,settled:false};state.calls.push(call);
  try{
   if(plan.hold)await new Promise(resolve=>state.pending[plan.key]=resolve);
   if(plan.failure)throw {response:{status:503,data:{message:plan.failure}}};
   return {data:kind==='detail'?structuredClone(plan.item):{items:structuredClone(plan.items||[]),total:plan.total??plan.items?.length??0,page:plan.page,limit:30,scope:plan.scope}};
  }finally{call.settled=true;}
 },
 async post(path){state.posts.push(path);return unexpected('Business POST forbidden');},
 async put(){return unexpected('Business PUT forbidden');},
 async delete(){return unexpected('Business DELETE forbidden');}
};
`;
const csr = id => ({ id, roles: ['EMPLOYEE'], permissions: ['mailroom:review'] });
const supervisor = { id: 'synthetic-supervisor', roles: ['SUPER_ADMIN'], permissions: [] };
const row = (label, ownerId = 'synthetic-csr', stage = 'ACCEPTED') => ({
  id: `synthetic-${label}`, label, productName: `Synthetic product ${label}`, sku: 'SYNTHETIC-SKU', serialNumber: `SYNTHETIC-SN-${label}`,
  version: 4, status: 'RECEIVED', statusLabel: '已收件，待核對', matchResult: 'MATCH',
  custodianId: 'synthetic-clerk', custodianName: 'Synthetic clerk custody', location: 'Synthetic physical shelf', physicalCustody: 'MAILROOM',
  receipt: { category: 'UNMATCHED', sourceCaseId: null }, allowedIntakeActions: ['claim_intake', 'bind_intake'],
  caseIntake: { status: stage, sentToUserId: ownerId, sentToUserName: `Synthetic assigned ${ownerId}`, ownerId: stage === 'ACCEPTED' ? ownerId : null, ownerName: stage === 'ACCEPTED' ? `Synthetic owner ${ownerId}` : null, sourceCaseId: null },
});

test('390px company queue header and read-only Drawer remain operable without page overflow', {
  skip: !executablePath && 'Requires an existing browser; never installs one', timeout: 45000,
}, async t => {
  const before = sourceHashes();
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-intake-queue-mobile-dom-'));
  const virtual = '\0customer-intake-queue-mobile-fixture';
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-actual-customer-intake-queue-mobile',
      resolveId(id) { if (id === 'virtual:customer-intake-queue-mobile-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return auth;
        if (id.endsWith('/src/services/api.ts')) return api;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== '/__intake-queue-mobile') return next();
          try {
            const html = await vite.transformIndexHtml('/__intake-queue-mobile', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:customer-intake-queue-mobile-fixture"></script></body></html>');
            response.setHeader('Content-Type', 'text/html'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    const errors = [], blocked = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin || request.method() !== 'GET') { blocked.push(request.method()); return route.abort(); }
      return route.continue();
    });
    const item = row('MOBILE-COMPANY', 'someone-else');
    await page.addInitScript(value => window.intakeInitial = value, {
      user: supervisor, entityId: 'company-A', plans: [plan('mobile-company', [item], { actorId: supervisor.id, scope: 'company' })],
      details: { [`company-A|${supervisor.id}|${item.id}`]: item },
    });
    await page.goto(origin + '/__intake-queue-mobile');
    const scope = page.locator('.ant-card-head .ant-tag');
    await scope.getByText('公司交辦', { exact: true }).waitFor();
    for (const control of [scope, page.getByRole('button', { name: /更新/ })]) {
      const box = await control.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845,
        'Company scope and refresh must stay visible inside the 390px viewport');
    }
    const geometry = () => page.evaluate(() => ({
      page: { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
      header: { width: document.querySelector('.ant-card-head').clientWidth, scroll: document.querySelector('.ant-card-head').scrollWidth },
      drawer: document.querySelector('.ant-drawer-body') ? { width: document.querySelector('.ant-drawer-body').clientWidth, scroll: document.querySelector('.ant-drawer-body').scrollWidth } : null,
      table: { width: document.querySelector('.ant-table-content').clientWidth, scroll: document.querySelector('.ant-table-content').scrollWidth },
    }));
    const initial = await geometry();
    assert.ok(initial.page.scroll <= initial.page.width + 1, 'Only the Table scroll area may overflow horizontally, not the page');
    assert.ok(initial.header.scroll <= initial.header.width + 1, 'The company title/tag must not overflow the Card header');
    assert.ok(initial.table.scroll > initial.table.width, 'The actual Ant Table retains its intended horizontal scroll');
    await page.getByRole('button', { name: item.label, exact: true }).click();
    const drawer = page.locator('.ant-drawer-content');
    await drawer.getByText(`${item.label} · v4`, { exact: true }).waitFor();
    await page.locator('.ant-drawer-content-wrapper').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    for (const name of ['本人接手補建交辦', '確認綁定收件', '開啟案件中心']) assert.equal(await drawer.getByRole('button', { name, exact: true }).count(), 0);
    const opened = await geometry();
    assert.ok(opened.page.scroll <= opened.page.width + 1);
    assert.ok(opened.drawer.scroll <= opened.drawer.width + 1, 'The read-only Drawer must not require horizontal body scrolling');
    const close = drawer.getByRole('button', { name: 'Close', exact: true });
    const closeBox = await close.boundingBox();
    t.diagnostic(`390px settled header/Drawer geometry: ${JSON.stringify({ initial, opened, closeBox })}`);
    assert.ok(closeBox && closeBox.x >= 0 && closeBox.x + closeBox.width <= 391);
    await close.click(); await drawer.waitFor({ state: 'hidden' });
    const state = await page.evaluate(() => ({ posts: window.intakeFixture.posts, errors: window.intakeFixture.boundaryErrors, plans: window.intakeFixture.plans, pending: Object.keys(window.intakeFixture.pending), calls: window.intakeFixture.calls.length }));
    assert.deepEqual(state.posts, []); assert.deepEqual(state.errors, []); assert.deepEqual(state.plans, []); assert.deepEqual(state.pending, []);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []); assert.deepEqual(sourceHashes(), before);
    t.diagnostic(`390px actual React/Ant geometry: ${JSON.stringify({ initial, opened })}; synthetic GETs ${state.calls}; business POSTs 0; external requests 0`);
    t.diagnostic(`Production source SHA256: ${JSON.stringify(before)}`);
  } finally {
    if (browser) await browser.close();
    await server.close(); rmSync(cacheDir, { recursive: true, force: true });
  }
});
const plan = (key, items = [], extra = {}) => ({ kind: 'queue', key, entityId: 'company-A', actorId: 'synthetic-csr', page: 1, search: '', scope: 'mine', items, ...extra });
const detailPlan = (key, item, extra = {}) => ({ kind: 'detail', key, entityId: 'company-A', actorId: 'synthetic-csr', itemId: item.id, item, ...extra });

test('actual CustomerIntakeQueue preserves read scope and request boundaries with real React/Ant DOM', {
  skip: !executablePath && 'Requires an existing browser; never installs one', timeout: 120000,
}, async t => {
  const before = sourceHashes();
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-intake-queue-dom-'));
  const virtual = '\0customer-intake-queue-fixture';
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-actual-customer-intake-queue',
      resolveId(id) { if (id === 'virtual:customer-intake-queue-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return auth;
        if (id.endsWith('/src/services/api.ts')) return api;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== '/__intake-queue') return next();
          try {
            const html = await vite.transformIndexHtml('/__intake-queue', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:customer-intake-queue-fixture"></script></body></html>');
            response.setHeader('Content-Type', 'text/html'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
  });
  let browser;
  let syntheticGetCount = 0;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ executablePath, headless: true });
    async function open(plans, options = {}) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
      page.setDefaultTimeout(8000);
      const errors = [], blocked = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin || request.method() !== 'GET') {
          blocked.push({ method: request.method(), url: request.url() }); return route.abort();
        }
        return route.continue();
      });
      await page.addInitScript(value => window.intakeInitial = value, { user: csr('synthetic-csr'), entityId: 'company-A', plans, ...options });
      await page.goto(origin + '/__intake-queue');
      await page.locator('#session-scope').waitFor();
      return { page, errors, blocked };
    }
    const enqueue = (page, next) => page.evaluate(value => window.intakeFixture.plans.push(value), next);
    const held = (page, key) => page.waitForFunction(value => Boolean(window.intakeFixture.pending[value]), key);
    const settled = (page, key) => page.waitForFunction(value => window.intakeFixture.calls.some(call => call.key === value && call.settled), key);
    const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const release = async (page, key) => { await page.evaluate(value => window.intakeFixture.release(value), key); await settled(page, key); await frames(page); };
    const labels = page => page.locator('.ant-table-tbody button.ant-btn-link').allTextContents();
    async function rows(page, expected) {
      await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.ant-table-tbody button.ant-btn-link')].map(value => value.textContent)) === JSON.stringify(expected), expected);
      assert.deepEqual(await labels(page), expected);
    }
    async function search(page, query, next) {
      await enqueue(page, next);
      const input = page.getByRole('searchbox', { name: '搜尋待補建收件', exact: true });
      await input.fill(query); await input.press('Enter');
    }
    async function close(fixturePage) {
      const { page, errors, blocked } = fixturePage;
      const state = await page.evaluate(() => ({ posts: window.intakeFixture.posts, errors: window.intakeFixture.boundaryErrors, plans: window.intakeFixture.plans, pending: Object.keys(window.intakeFixture.pending), calls: window.intakeFixture.calls.length }));
      assert.deepEqual(state.posts, [], 'This is read-only DOM acceptance, not command execution');
      assert.deepEqual(state.errors, []); assert.deepEqual(state.plans, []); assert.deepEqual(state.pending, []);
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      syntheticGetCount += state.calls;
      await page.close();
    }

    await t.test('company supervisor reads other assignees without claim/bind or moving physical custody', async () => {
      const sent = row('COMPANY-SENT', 'someone-else', 'SENT'), accepted = row('COMPANY-ACCEPTED', 'someone-else');
      const f = await open([plan('company', [sent, accepted], { actorId: supervisor.id, scope: 'company', hold: true })], {
        user: supervisor, details: { [`company-A|${supervisor.id}|${sent.id}`]: sent, [`company-A|${supervisor.id}|${accepted.id}`]: accepted },
      });
      const { page } = f;
      await held(page, 'company');
      await page.getByText('載入中…', { exact: true }).waitFor();
      assert.equal(await page.getByText('目前沒有待補建的公司交辦', { exact: true }).count(), 0);
      assert.equal(await page.getByText('我的交辦', { exact: true }).count(), 0);
      await release(page, 'company'); await rows(page, [sent.label, accepted.label]);
      await page.getByText('公司交辦', { exact: true }).waitFor();
      for (const item of [sent, accepted]) {
        await page.getByRole('button', { name: item.label, exact: true }).click();
        const drawer = page.locator('.ant-drawer-content');
        await drawer.getByText(`${item.label} · v4`, { exact: true }).waitFor();
        assert.match(await drawer.innerText(), /Synthetic clerk custody \/ Synthetic physical shelf/);
        for (const name of ['本人接手補建交辦', '確認綁定收件', '開啟案件中心']) assert.equal(await drawer.getByRole('button', { name, exact: true }).count(), 0,
          'Company read visibility cannot substitute the assigned CSR even when action strings are present');
        assert.equal(await drawer.locator('form').count(), 0);
        await drawer.getByRole('button', { name: 'Close', exact: true }).click();
        await drawer.waitFor({ state: 'hidden' });
      }
      assert.deepEqual(await page.evaluate(() => window.intakeFixture.sourceOpens), []);
      await close(f);
    });

    await t.test('mine shows only the actual assigned-stage controls; read-only rows remain read-only', async () => {
      const sent = row('MINE-SENT', 'synthetic-csr', 'SENT'), accepted = row('MINE-ACCEPTED'), other = row('MINE-OTHER', 'someone-else');
      const f = await open([plan('mine', [sent, accepted, other])], { details: Object.fromEntries([sent, accepted, other].map(item => [`company-A|synthetic-csr|${item.id}`, item])) });
      const { page } = f;
      await settled(page, 'mine'); await rows(page, [sent.label, accepted.label, other.label]);
      await page.getByText('我的交辦', { exact: true }).waitFor();
      const drawer = page.locator('.ant-drawer-content');
      await page.getByRole('button', { name: sent.label, exact: true }).click();
      await drawer.getByRole('button', { name: '本人接手補建交辦', exact: true }).waitFor();
      assert.equal(await drawer.getByRole('button', { name: '確認綁定收件', exact: true }).count(), 0);
      await drawer.getByRole('button', { name: 'Close', exact: true }).click(); await drawer.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: accepted.label, exact: true }).click();
      await drawer.getByRole('button', { name: '確認綁定收件', exact: true }).waitFor();
      await drawer.getByRole('button', { name: '開啟案件中心', exact: true }).waitFor();
      assert.equal(await drawer.getByRole('button', { name: '本人接手補建交辦', exact: true }).count(), 0);
      await drawer.locator('form textarea').fill('Synthetic local draft only');
      await page.locator('#dirty').filter({ hasText: 'true' }).waitFor();
      await drawer.getByRole('button', { name: 'Close', exact: true }).click();
      const confirm = page.getByRole('dialog').filter({ has: page.getByText('綁案資料尚未保存', { exact: true }) });
      await confirm.getByRole('button', { name: '保留資料', exact: true }).click();
      assert.equal(await drawer.locator('form textarea').inputValue(), 'Synthetic local draft only');
      await drawer.getByRole('button', { name: 'Close', exact: true }).click();
      await confirm.getByRole('button', { name: '放棄未保存資料', exact: true }).click(); await drawer.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: other.label, exact: true }).click();
      await drawer.getByText(`${other.label} · v4`, { exact: true }).waitFor();
      assert.equal(await drawer.getByRole('button', { name: '確認綁定收件', exact: true }).count(), 0);
      assert.equal(await drawer.getByRole('button', { name: '本人接手補建交辦', exact: true }).count(), 0);
      await close(f);
    });

    await t.test('failed GET is an alert, never a fake empty list; successful company/mine/search empty states differ', async () => {
      const f = await open([plan('initial-failure', [], { hold: true, failure: 'Synthetic list GET unavailable' })]);
      const { page } = f;
      await held(page, 'initial-failure'); await page.getByText('載入中…', { exact: true }).waitFor();
      await release(page, 'initial-failure'); await page.getByRole('alert').getByText('Synthetic list GET unavailable', { exact: true }).waitFor();
      assert.equal(await page.locator('.ant-table').count(), 0);
      assert.equal(await page.getByText('目前沒有指定本人補建的收件', { exact: true }).count(), 0);
      await enqueue(page, plan('empty-mine'));
      await page.getByRole('button', { name: /更新/ }).click();
      await page.getByText('目前沒有指定本人補建的收件', { exact: true }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0);
      await search(page, 'NO-SUCH-ITEM', plan('no-results', [], { search: 'NO-SUCH-ITEM' }));
      await page.getByText('沒有符合條件的交辦', { exact: true }).waitFor();
      assert.equal(await page.getByText('目前沒有指定本人補建的收件', { exact: true }).count(), 0);
      await close(f);
      const company = await open([plan('empty-company', [], { actorId: supervisor.id, scope: 'company' })], { user: supervisor });
      await company.page.getByText('目前沒有待補建的公司交辦', { exact: true }).waitFor();
      await company.page.getByText('公司交辦', { exact: true }).waitFor();
      await close(company);
    });

    await t.test('late search and page responses cannot overwrite the active query or clear its loading state', async () => {
      const f = await open([plan('old-search', [row('OLD-SEARCH')], { hold: true })]);
      const { page } = f;
      await held(page, 'old-search');
      await search(page, 'CURRENT', plan('current-search', [row('CURRENT-SEARCH')], { search: 'CURRENT', hold: true }));
      await held(page, 'current-search'); await release(page, 'old-search');
      await page.getByText('載入中…', { exact: true }).waitFor();
      assert.deepEqual(await labels(page), []); assert.equal(await page.locator('.ant-spin-spinning').count() > 0, true);
      await release(page, 'current-search'); await rows(page, ['CURRENT-SEARCH']);
      await search(page, '', plan('page-one', [row('PAGE-ONE')], { total: 61 }));
      await rows(page, ['PAGE-ONE']);
      await enqueue(page, plan('late-page-two', [row('LATE-PAGE-TWO')], { page: 2, total: 61, hold: true }));
      await page.locator('.ant-pagination-next button').click(); await held(page, 'late-page-two');
      await search(page, 'RESET', plan('search-resets-page', [row('RESET-RESULT')], { search: 'RESET', hold: true }));
      await held(page, 'search-resets-page'); await release(page, 'late-page-two');
      await page.getByText('載入中…', { exact: true }).waitFor(); assert.deepEqual(await labels(page), []);
      await release(page, 'search-resets-page'); await rows(page, ['RESET-RESULT']);
      assert.equal(await page.locator('.ant-pagination-item-active').innerText(), '1');
      await close(f);
    });

    await t.test('company and actor changes immediately hide prior rows/scope and ignore late queue/detail responses', async () => {
      const old = row('COMPANY-A-OLD', 'someone-else'), fresh = row('COMPANY-B-CURRENT', 'synthetic-csr-B');
      const f = await open([plan('A', [old], { actorId: supervisor.id, scope: 'company' })], { user: supervisor });
      const { page } = f;
      await rows(page, [old.label]);
      await enqueue(page, detailPlan('late-A-detail', old, { actorId: supervisor.id, hold: true }));
      await page.getByRole('button', { name: old.label, exact: true }).click(); await held(page, 'late-A-detail');
      await enqueue(page, plan('late-A-refresh', [row('LATE-A')], { actorId: supervisor.id, scope: 'company', hold: true }));
      // Refresh preserves selected detail; this explicit list focus event does not discard a business draft.
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await held(page, 'late-A-refresh');
      await enqueue(page, plan('B', [fresh], { entityId: 'company-B', actorId: supervisor.id, scope: 'company', hold: true }));
      await enqueue(page, detailPlan('B-detail', old, { entityId: 'company-B', actorId: supervisor.id, hold: true, failure: 'Synthetic company-B rejects the company-A item' }));
      await page.evaluate(() => window.intakeHarness.setEntity('company-B')); await held(page, 'B'); await held(page, 'B-detail');
      await rows(page, []); assert.equal(await page.getByText('公司交辦', { exact: true }).count(), 0);
      await release(page, 'late-A-detail'); await release(page, 'late-A-refresh');
      await rows(page, []); assert.doesNotMatch(await page.getByRole('dialog').innerText(), /COMPANY-A-OLD|Synthetic clerk custody/);
      await release(page, 'B'); await release(page, 'B-detail'); await rows(page, [fresh.label]);
      await page.getByRole('dialog').getByText('請重新開啟收件', { exact: true }).waitFor();
      assert.doesNotMatch(await page.getByRole('dialog').innerText(), /COMPANY-A-OLD/);
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await enqueue(page, detailPlan('late-B-detail', fresh, { entityId: 'company-B', actorId: supervisor.id, hold: true }));
      await page.getByRole('button', { name: fresh.label, exact: true }).click(); await held(page, 'late-B-detail');
      await enqueue(page, plan('late-supervisor', [row('LATE-SUPERVISOR')], { entityId: 'company-B', actorId: supervisor.id, scope: 'company', hold: true }));
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await held(page, 'late-supervisor');
      const currentDetail = { ...fresh, version: 5 };
      await enqueue(page, plan('mine-new-actor', [currentDetail], { entityId: 'company-B', actorId: 'synthetic-csr-B', scope: 'mine', hold: true }));
      await enqueue(page, detailPlan('new-actor-detail', currentDetail, { entityId: 'company-B', actorId: 'synthetic-csr-B', hold: true }));
      await page.evaluate(user => window.intakeHarness.setUser(user), csr('synthetic-csr-B')); await held(page, 'mine-new-actor'); await held(page, 'new-actor-detail');
      await rows(page, []); assert.equal(await page.getByText('公司交辦', { exact: true }).count(), 0);
      assert.doesNotMatch(await page.getByRole('dialog').innerText(), /COMPANY-B-CURRENT/);
      await release(page, 'late-supervisor'); await release(page, 'late-B-detail'); await rows(page, []);
      assert.doesNotMatch(await page.getByRole('dialog').innerText(), /COMPANY-B-CURRENT/);
      await release(page, 'mine-new-actor'); await release(page, 'new-actor-detail'); await rows(page, [fresh.label]);
      await page.getByRole('dialog').getByText(`${fresh.label} · v5`, { exact: true }).waitFor();
      await page.getByText('我的交辦', { exact: true }).waitFor();
      assert.doesNotMatch(await page.locator('.ant-card').innerText(), /LATE-A|LATE-SUPERVISOR/);
      await close(f);
    });

    await t.test('disabled feature, missing permission and missing company make no intake API calls', async () => {
      for (const options of [{ enabled: false }, { user: { id: 'synthetic-no-grant', roles: ['EMPLOYEE'], permissions: [] } }, { entityId: '' }]) {
        const f = await open([], options);
        await frames(f.page);
        assert.equal(await f.page.locator('.ant-card,.ant-table,.ant-drawer').count(), 0);
        assert.deepEqual(await f.page.evaluate(() => window.intakeFixture.calls), []);
        await close(f);
      }
    });
    assert.deepEqual(sourceHashes(), before, 'Executed production sources must remain unchanged during this run');
    t.diagnostic(`Production source SHA256: ${JSON.stringify(before)}`);
    t.diagnostic(`Actual React/Ant DOM: 6 suites; ${syntheticGetCount} synthetic GETs; business POSTs 0; external requests 0`);
  } finally {
    if (browser) await browser.close();
    await server.close();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
