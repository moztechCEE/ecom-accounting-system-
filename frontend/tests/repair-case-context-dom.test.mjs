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
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceIssue = '顧客原述：接線後不亮。\n第二行 <script>不執行</script> 保留原文';
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import RepairCaseContext from '/src/pages/repair/RepairCaseContext.tsx';import '/src/pages/repair/repair.css';
const now='2026-10-29T01:00:00Z';
const item={id:'case-item',entityId:'case-company',productName:'合成維修品',receipt:{category:'REPAIR',sourceCaseId:'source-case',sourceNumber:'CASE-CONTEXT'},
  repairInspection:{data:{complaint:'TECHNICIAN_COMPLAINT_NOT_CUSTOMER',diagnosis:'INTERNAL_DIAGNOSIS_NOT_CUSTOMER'}},
  customerContext:{state:'AVAILABLE',sourceCaseId:'source-case',sourceNumber:'CASE-CONTEXT',customerIssue:${JSON.stringify(sourceIssue)}},
  mailroomPrecheck:{schema:1,entityId:'case-company',itemId:'case-item',stage:'SUBMITTED',revision:2,savedByName:'收發初檢人',savedAt:now,submittedAt:now,
    recorded:{id:'record-2',revision:2,template:null,savedByName:'收發初檢人',savedAt:now,submittedAt:now,notRequiredReason:null,
      checks:[{key:'power',label:'通電初檢',result:'ABNORMAL',note:'初檢指示燈未亮',photoIds:[]}],photos:[],
      mailroomIssue:{schema:1,symptom:'MAILROOM_OBSERVATION_NOT_CUSTOMER',preliminaryReason:'MAILROOM_CAUSE_NOT_CUSTOMER'}}}};
window.__context={gets:[],posts:[]};
function Harness(){const[state,setState]=useState({item,entityId:'case-company',expectedItemId:'case-item'});window.__setContext=patch=>setState(previous=>({...previous,...patch}));window.__baseContext=structuredClone(item);return React.createElement('main',{className:'repair-workbench-drawer'},React.createElement(RepairCaseContext,state))}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;

test('case context displays only the current authoritative customer issue and submitted precheck', {
  skip: !executablePath && 'Existing browser required; no installation', timeout: 90000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'repair-case-context-'));
  const virtual = '\0repair-case-context-dom';
  const server = await createServer({ root, cacheDir, configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'offline-repair-case-context', resolveId(id) { if (id === 'virtual:repair-case-context-dom') return virtual; },
    load(id) {
      if (id === virtual) return fixture;
      if (id.endsWith('/src/services/api.ts')) return `export default {get:async(path)=>{window.__context.gets.push(path);throw Error('No photo or external read expected')},post:async(path)=>{window.__context.posts.push(path);throw Error('No write permitted')}};`;
    },
    configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
      if (request.url?.split('?')[0] !== '/__repair-case-context') return next();
      try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml('/__repair-case-context', '<html lang="zh-Hant"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-case-context-dom"></script></body></html>')); }
      catch (error) { next(error); }
    }); },
  }] });
  t.after(async () => { await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1233, height: 1066 } });
  page.setDefaultTimeout(6000);
  const errors = [], networkWrites = [], external = [];
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { networkWrites.push(request.method()); return route.abort(); }
    return route.continue();
  });
  const load = async () => { await page.goto(origin + '/__repair-case-context'); await page.locator('.repair-case-context').waitFor(); };
  const patchItem = async change => page.evaluate(change => { window.__setContext({ item: { ...structuredClone(window.__baseContext), ...change } }); }, change);
  const issue = () => page.locator('.repair-customer-issue-text');

  await t.test('original source wording and actual preliminary findings are distinct and visible without extra navigation', async () => {
    await load(); assert.equal(await issue().textContent(), sourceIssue);
    assert.equal(await page.locator('.repair-customer-issue script').count(), 0, 'Customer text is escaped');
    await page.getByText('通電初檢', { exact: true }).waitFor(); await page.getByText('初檢指示燈未亮', { exact: true }).waitFor();
    assert.equal(await page.getByText('異常', { exact: true }).count(), 1);
    for (const text of ['TECHNICIAN_COMPLAINT_NOT_CUSTOMER', 'INTERNAL_DIAGNOSIS_NOT_CUSTOMER']) assert(!(await page.locator('main').innerText()).includes(text));
    assert.equal(await page.getByRole('tab').count(), 0, 'Context does not add tabs');
    const disclosure = page.locator('.repair-precheck-metadata .ant-collapse-header');
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
    await disclosure.click(); await page.getByText('記錄人', { exact: true }).waitFor();
    assert.equal(await issue().textContent(), sourceIssue);
  });

  await t.test('unknown, missing and mismatched source data never fall back to technician or mailroom wording', async () => {
    for (const context of [null, { state: 'UNAVAILABLE' }, { state: 'AVAILABLE', sourceCaseId: 'other-case', customerIssue: 'WRONG_CASE_ISSUE' }, { state: 'AVAILABLE', customerIssue: 'UNBOUND_ISSUE' }, { state: 'AVAILABLE', sourceCaseId: 'source-case', customerIssue: ' ' }]) {
      await load(); await patchItem({ customerContext: context });
      await issue().getByText('顧客問題暫無法取得', { exact: true }).waitFor();
      assert(!(await issue().innerText()).includes('NOT_CUSTOMER'));
    }
    await load(); await patchItem({ customerContext: { state: 'NOT_PROVIDED', sourceCaseId: 'source-case' } }); await issue().getByText('未提供', { exact: true }).waitFor();
    for (const sourceCaseId of ['other-case', null]) {
      await patchItem({ customerContext: { state: 'NOT_PROVIDED', sourceCaseId } });
      await issue().getByText('顧客問題暫無法取得', { exact: true }).waitFor();
    }
  });

  await t.test('wrong item/company renders no prior case, while draft prechecks expose progress only', async () => {
    await load(); await page.evaluate(() => window.__setContext({ expectedItemId: 'other-item' })); await page.locator('.repair-case-context').waitFor({ state: 'detached' });
    await page.evaluate(() => window.__setContext({ expectedItemId: 'case-item', entityId: 'other-company' })); assert.equal(await page.locator('.repair-case-context').count(), 0);
    await load(); await page.evaluate(() => {
      const item = structuredClone(window.__baseContext); item.mailroomPrecheck = { schema: 1, entityId: 'case-company', itemId: 'case-item', stage: 'DRAFT', revision: 3, savedByName: '初檢草稿人', savedAt: '2026-10-29T01:00:00Z', recorded: null, draft: { note: 'PRIVATE_DRAFT_SECRET' }, checks: [{ label: 'PRIVATE_DRAFT_SECRET' }] };
      window.__setContext({ item });
    });
    await page.getByRole('region', { name: '收發初檢進度', exact: true }).getByText('收發初檢中', { exact: true }).waitFor();
    assert(!(await page.locator('main').innerText()).includes('PRIVATE_DRAFT_SECRET'));
    assert.equal(await page.getByText('初檢指示燈未亮', { exact: true }).count(), 0);
    await page.evaluate(() => { const item = structuredClone(window.__baseContext); item.mailroomPrecheck.entityId = 'other-company'; window.__setContext({ item }); });
    await page.getByText('初檢紀錄暫無法取得', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  assert.deepEqual(await page.evaluate(() => window.__context), { gets: [], posts: [] });
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(networkWrites, []);
});
