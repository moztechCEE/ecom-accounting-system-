import assert from 'node:assert/strict';
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
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import RepairDocuments from '/src/pages/repair/RepairDocuments.tsx';
import {useRepairFeedback} from '/src/pages/repair/repair-feedback.tsx';
import '/src/pages/repair/repair.css';
const check={name:'SAVED check',result:'PASS',observation:'SAVED observation'};
const inspectionDocument={number:'SYNTHETIC-INS',revision:2,status:'SUBMITTED',authorId:'tech',authorName:'Synthetic technician',
  updatedAt:'2026-10-08T02:00:00Z',review:{inspectionRevision:1,actorId:'csr',name:'Synthetic CSR',
    confirmedAt:'2026-10-08T01:00:00Z',decision:'APPROVE',planHash:'prior-plan'},
  data:{complaint:'SAVED complaint',reproduction:'YES',testConditions:'SAVED conditions',checks:[check],
    diagnosis:'SAVED diagnosis',causeStatus:'CONFIRMED',plan:'REPAIR',planNote:'SAVED plan',feeSuggestion:'PAID',estimateNote:'SAVED estimate'}};
const report={number:'SYNTHETIC-REP',revision:1,status:'SUBMITTED',inspectionRevision:1,authorId:'tech',authorName:'Synthetic technician',
  updatedAt:'2026-10-08T01:00:00Z',data:{outcome:'REPAIRED',workPerformed:'SAVED work',
    parts:[{name:'SAVED part',sku:'SYNTHETIC-PART',quantity:1}],laborMinutes:5,checks:[check],
    qcResult:'PASS',qcNotes:'SAVED QC',deliveredAccessories:'SAVED accessories'}};
const base={id:'synthetic',version:7,status:'INSPECTING',editable:true,repairOwnerId:'tech',custodianId:'tech',
  productName:'Synthetic product',sku:'SYNTHETIC-SKU',serialNumber:'SYNTHETIC-SN',label:'SYNTHETIC',
  receipt:{category:'REPAIR',number:'SYNTHETIC-RCPT',sourceCaseId:'synthetic-source',sourceNumber:'SYNTHETIC-CASE'},
  history:[],repairInspection:inspectionDocument,repairReport:report};
window.__documentsProbe={posts:[],dirty:false,saved:0,html:'',printed:0,fail:false};
window.__probeReadonly=new URLSearchParams(location.search).has('readonly');
window.open=()=>({document:{open(){},write(html){window.__documentsProbe.html=html},close(){}},
  focus(){},print(){window.__documentsProbe.printed++}});
function Harness(){const [generation,setGeneration]=useState(0);const feedback=useRepairFeedback();
  return React.createElement(React.Fragment,null,feedback.contextHolder,React.createElement(RepairDocuments,
    {key:generation,item:{...base,version:7+generation},entityId:'synthetic-company',feedback:feedback.message,
      onDirtyChange:value=>{window.__documentsProbe.dirty=value},
      onSaved:()=>{window.__documentsProbe.saved++;setGeneration(v=>v+1)}}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const api = `
export const API_URL='/offline-documents-api';
export default {
  async get(){throw Error('No external read')},
  async post(path,body){
    window.__documentsProbe.posts.push({path,body:structuredClone(body)});
    if(window.__documentsProbe.fail)throw Error('SYNTHETIC save failure');
    await new Promise(resolve=>window.__documentsProbe.release=resolve);
    return {data:{}};
  }
};
`;

test('actual repair document forms preserve their save, print, validation and permission contracts', {
  skip: !executablePath && 'Requires an existing browser; no installation', timeout: 120000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-repair-documents-ui-'));
  const virtual = '\0repair-documents-ui-fixture';
  let browser;
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-repair-documents-ui',
      resolveId(id) { if (id === 'virtual:repair-documents-ui-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) {
          return `export const useAuth=()=>({user:{id:window.__probeReadonly?'other':'tech',roles:['EMPLOYEE'],permissions:['repair_workbench:update']}});`;
        }
        if (id.endsWith('/src/services/api.ts')) return api;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__repair-documents-ui') return next();
          try {
            const html = await vite.transformIndexHtml('/__repair-documents-ui', `<html lang="zh-Hant"><head><meta charset="utf-8"></head>
              <body><div id="root"></div><script type="module" src="/@id/virtual:repair-documents-ui-fixture"></script></body></html>`);
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(html);
          } catch (error) { next(error); }
        });
      },
    }] });
  t.after(async () => {
    if (browser) await browser.close();
    await server.close();
    rmSync(cacheDir, { recursive: true, force: true });
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const url = origin + '/__repair-documents-ui';
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

  await t.test('inspection keeps paid validation, dirty/busy state, save payload and saved-version printing', async () => {
    await page.goto(url);
    const inspection = page.locator('form#repair-inspection-synthetic');
    await inspection.waitFor();
    for (const title of ['故障與檢測', '診斷與估價']) {
      assert.equal(await inspection.getByRole('heading', { name: title, exact: true }).count(), 1);
    }
    await page.getByText('（非目前已提交版次）', { exact: false }).waitFor();
    await inspection.getByRole('button', { name: /提交檢修單/ }).click();
    await inspection.getByText('付費建議需正數估價；金額最多 10,000,000', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__documentsProbe.posts.length), 0);
    await inspection.getByLabel('客訴／故障描述', { exact: true }).fill('');
    await inspection.getByRole('button', { name: /提交檢修單/ }).click();
    await inspection.getByText('請填寫此項；未測或沒有配件也請明確註記', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__documentsProbe.posts.length), 0);
    await inspection.getByLabel('客訴／故障描述', { exact: true }).fill('UNSAVED new complaint');
    assert.equal(await page.evaluate(() => window.__documentsProbe.dirty), true);
    await page.getByRole('button', { name: /列印/ }).click();
    assert.equal(await page.evaluate(() => window.__documentsProbe.printed), 1);
    const inspectionPrint = await page.evaluate(() => window.__documentsProbe.html);
    assert.match(inspectionPrint, /<h1>內部檢修單<\/h1>/);
    assert.match(inspectionPrint, /SYNTHETIC-INS · v2 · 已提交/);
    assert.match(inspectionPrint, /SAVED complaint/);
    assert.doesNotMatch(inspectionPrint, /UNSAVED new complaint/);
    assert.doesNotMatch(inspectionPrint, /僅供內部作業；本單為已保存版本/);
    assert.doesNotMatch(inspectionPrint, /此單不是對客維修報告/);
    await inspection.getByLabel('內部估價金額', { exact: true }).fill('125.5');
    await inspection.getByRole('button', { name: /提交檢修單/ }).click();
    await page.waitForFunction(() => window.__documentsProbe.posts.length === 1);
    assert.equal(await inspection.getByRole('button', { name: '儲存草稿', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /列印/ }).isDisabled(), true);
    const post = await page.evaluate(() => window.__documentsProbe.posts[0]);
    assert.equal(post.path, '/repair-workbench/items/synthetic/inspection');
    assert.equal(post.body.expectedVersion, 7);
    assert.equal(post.body.status, 'SUBMITTED');
    assert.equal(post.body.data.estimateAmount, 125.5);
    assert.equal(post.body.data.complaint, 'UNSAVED new complaint');
    assert.equal(post.body.data.checks[0].observation, 'SAVED observation');
    assert.match(post.body.requestId, /^[a-f0-9-]{36}$/);
    await page.evaluate(() => window.__documentsProbe.release());
    await page.waitForFunction(() => window.__documentsProbe.saved === 1 && window.__documentsProbe.dirty === false);
    await page.getByText('檢修單已提交', { exact: true }).waitFor();
  });

  await t.test('repair preserves visible revision warning and actual outcome, parts and reinspection payload', async () => {
    await page.getByRole('tab', { name: '維修單', exact: true }).click();
    const repair = page.locator('form#repair-report-synthetic');
    await repair.waitFor();
    await page.getByText('維修單與目前檢修版次不一致', { exact: true }).waitFor();
    for (const title of ['實際處置', '實際使用零件', '修後複驗']) {
      assert.equal(await repair.getByRole('heading', { name: title, exact: true }).count(), 1);
    }
    await repair.getByLabel('實際施工／替換內容', { exact: true }).fill('UNSAVED actual work');
    await page.getByRole('button', { name: /列印/ }).click();
    const repairPrint = await page.evaluate(() => window.__documentsProbe.html);
    assert.match(repairPrint, /<h1>內部維修單<\/h1>/);
    assert.match(repairPrint, /SYNTHETIC-REP · v1 · 已提交/);
    assert.match(repairPrint, /SAVED work/);
    assert.match(repairPrint, /SYNTHETIC-PART/);
    assert.doesNotMatch(repairPrint, /UNSAVED actual work/);
    assert.doesNotMatch(repairPrint, /僅供內部作業；本單為已保存版本/);
    assert.doesNotMatch(repairPrint, /此單不是對客維修報告/);
    await repair.getByRole('button', { name: '儲存草稿', exact: true }).click();
    await page.waitForFunction(() => window.__documentsProbe.posts.length === 2);
    const post = await page.evaluate(() => window.__documentsProbe.posts[1]);
    assert.equal(post.path, '/repair-workbench/items/synthetic/repair-report');
    assert.equal(post.body.status, 'DRAFT');
    assert.equal(post.body.expectedVersion, 8);
    assert.equal(post.body.data.outcome, 'REPAIRED');
    assert.equal(post.body.data.workPerformed, 'UNSAVED actual work');
    assert.equal(post.body.data.parts[0].sku, 'SYNTHETIC-PART');
    assert.equal(post.body.data.laborMinutes, 5);
    assert.equal(post.body.data.qcResult, 'PASS');
    await page.evaluate(() => window.__documentsProbe.release());
    await page.waitForFunction(() => window.__documentsProbe.saved === 2 && window.__documentsProbe.dirty === false);
    await page.getByText('草稿已儲存', { exact: true }).waitFor();
  });

  await t.test('readonly warning remains visible and disables the form without granting ownership', async () => {
    await page.goto(url + '?readonly=1');
    await page.getByText('唯讀：需本人簽收與編輯權限。', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('客訴／故障描述', { exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__documentsProbe.posts.length), 0);
  });

  await t.test('save failure remains visible and retains the unsaved draft', async () => {
    await page.goto(url);
    await page.getByLabel('內部估價金額', { exact: true }).fill('125.5');
    await page.evaluate(() => window.__documentsProbe.fail = true);
    await page.getByRole('button', { name: /提交檢修單/ }).click();
    await page.getByText('暫時無法完成，請稍後重試。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__documentsProbe.dirty), true);
    assert.equal(Number(await page.getByLabel('內部估價金額', { exact: true }).inputValue()), 125.5);
    assert.equal(await page.getByRole('button', { name: /提交檢修單/ }).isDisabled(), false);
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(networkWrites, []);
});
