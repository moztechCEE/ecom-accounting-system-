import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
const output = process.env.REPAIR_TEST_ARTIFACT_DIR ? join(process.env.REPAIR_TEST_ARTIFACT_DIR, 'fair-inspection') : mkdtempSync(join(tmpdir(), 'repair-fair-inspection-artifacts-'));
mkdirSync(output, { recursive: true });
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import RepairDocuments from '/src/pages/repair/RepairDocuments.tsx';
import '/src/pages/repair/repair.css';
const scenario=new URL(location.href).searchParams.get('scenario')||'old-false',hash='a'.repeat(64);
const check={key:'power',name:'充電狀態',result:'FAIL',observation:'接入正常線材仍無法充電'};
const template={schema:1,id:'fair-template',revision:2,contentHash:'b'.repeat(64),status:'REVIEWED',entityId:'synthetic-company',productId:'synthetic-product',sku:'SYNTHETIC-SKU',
  checks:[{key:'power',name:'充電狀態',requiredForInspection:true,requiredForCompletion:true,requiresCalibration:false,standard:{kind:'OBSERVATION',instruction:'充電狀態'}}]};
const inspection={number:'SYNTHETIC-INS',revision:3,status:'DRAFT',authorId:'tech',authorName:'合成技師',updatedAt:'2026-10-15T01:00:00Z',
  data:{protocol:2,complaint:'無法充電',reproduction:'YES',testConditions:'正常線材與供電',checks:[check],diagnosis:'原因尚未確認',causeStatus:'CONFIRMED',
    isAccidentalDamage:false,isUnderWarranty:false,plan:'REPAIR',planNote:'檢查接口',feeSuggestion:'FREE',estimateNote:'',materialPlan:{mode:'NONE',lines:[]},
    templateBinding:{id:template.id,revision:template.revision,contentHash:template.contentHash},mediaRefs:[{mediaId:'old-photo',phase:'BEFORE',checkKey:'power'}]}};
const historical=structuredClone(inspection);historical.number='SYNTHETIC-OLD';historical.revision=2;historical.status='SUBMITTED';historical.data.diagnosis='已保存的舊診斷';
const item={id:'synthetic',entityId:'synthetic-company',version:7,status:'INSPECTING',editable:true,repairOwnerId:'tech',custodianId:'tech',
  productId:'synthetic-product',productName:'SYNTHETIC 充電器',sku:'SYNTHETIC-SKU',serialNumber:'SYNTHETIC-SN',label:'SYNTHETIC',
  receipt:{category:'REPAIR',number:'SYNTHETIC-RCPT',sourceCaseId:'synthetic-source',sourceNumber:'SYNTHETIC-CASE'},
  repairInspection:inspection,repairReport:null,history:[{createdAt:'2026-10-14T01:00:00Z',snapshot:{repairInspection:historical}}],
  repairWorkflow:{csr:{status:'RESOLVED',inspectionRevision:3,estimateRevision:3,planHash:hash,decision:'APPROVE',quoteRevision:4}},
  release:{available:false},repairPrerequisites:{template,templateChecks:{inspection:'READY',completion:'READY'},materials:{start:{state:'READY',reason:'NOT_REQUIRED',requiredCount:0},completion:{state:'READY',reason:'NOT_REQUIRED',requiredCount:0}},
    mediaAssets:[{mediaId:'old-photo',fileName:'收件接口.png',kind:'inspection',documentRevision:3,phase:'BEFORE',checkKey:'power'}]}};
if(scenario==='old-true'||scenario==='readonly-true')inspection.data.isAccidentalDamage=true;
if(scenario==='old-missing')delete inspection.data.isAccidentalDamage;
if(scenario==='suspected')inspection.data.causeStatus='SUSPECTED';
if(scenario==='no-evidence'||scenario==='fake-observation'){inspection.data.mediaRefs=[];if(scenario==='fake-observation')check.measurementValue='0.05';}
if(scenario==='numeric'||scenario==='boolean'){
  inspection.data.mediaRefs=[];
  template.checks[0].standard=scenario==='numeric'?{kind:'NUMBER',instruction:'量測接口輸出',unit:'V',min:'4.5',max:'5.5'}:{kind:'BOOLEAN',instruction:'正常供電功能',expected:true};
  if(scenario==='numeric'){check.measurementValue='0.05';check.unit='V';}else check.measurementValue=false;
}
if(scenario==='after'){
  inspection.data.mediaRefs=[{mediaId:'after-photo',phase:'AFTER',checkKey:'power'}];
  inspection.data.assessment={schema:1,conclusion:'USER_CAUSED',basis:'接口已變形',causalExplanation:'變形造成接觸不良',checkKeys:['power'],mediaIds:['after-photo']};
}
if(scenario==='new'||scenario==='wrong-product'||scenario==='wrong-sku'||scenario==='missing-template'){
  item.repairInspection=null;if(scenario==='wrong-product')template.productId='another-product';if(scenario==='wrong-sku')template.sku='ANOTHER-SKU';if(scenario==='missing-template')delete item.repairPrerequisites.template;
}
if(scenario.startsWith('readonly'))item.editable=false;
if(scenario==='unknown-draft'){
  inspection.data.causeStatus='SUSPECTED';
  inspection.data.assessment={schema:1,conclusion:'UNDETERMINED',basis:'已記錄接觸異常，原因仍待查',causalExplanation:'原因尚待確認',checkKeys:['power'],mediaIds:['old-photo']};
}
if(scenario==='readonly-assessment')inspection.data.assessment={schema:1,conclusion:'PRODUCT_FAULT',basis:'已排除配件異常',causalExplanation:'電源模組功能異常',checkKeys:['power'],mediaIds:[]};
if(scenario.startsWith('review-')){
  inspection.status='SUBMITTED';inspection.data.isAccidentalDamage=true;
  inspection.data.assessment={schema:1,conclusion:'USER_CAUSED',basis:'接口已變形',causalExplanation:'變形造成接觸不良',checkKeys:['power'],mediaIds:['old-photo']};
  if(scenario!=='review-missing')item.repairWorkflow.assessmentReview={schema:1,inspectionRevision:3,planHash:hash,reviewerId:'csr',reviewerName:'合成覆核人',reviewedAt:new Date(Date.now()-1000).toISOString(),decision:'APPROVE',note:'已核對故障與佐證'};
  if(scenario==='review-stale')item.repairWorkflow.assessmentReview.inspectionRevision=2;
  if(scenario==='review-hash')item.repairWorkflow.assessmentReview.planHash='c'.repeat(64);
  if(scenario==='review-self')item.repairWorkflow.assessmentReview.reviewerId='tech';
  if(scenario==='review-time')item.repairWorkflow.assessmentReview.reviewedAt='invalid';
  if(scenario==='review-future')item.repairWorkflow.assessmentReview.reviewedAt=new Date(Date.now()+3600000).toISOString();
  if(scenario==='review-noncanonical')item.repairWorkflow.assessmentReview.reviewedAt='2026-01-01';
  if(scenario==='review-note')item.repairWorkflow.assessmentReview.note='';
  if(scenario==='review-no-csr')delete item.repairWorkflow.csr;
  if(scenario==='review-null')item.repairWorkflow.assessmentReview=null;
  if(scenario==='review-no-author')delete inspection.authorId;
  if(scenario==='review-no-owner')delete item.repairOwnerId;
  if(scenario==='review-self-space')item.repairWorkflow.assessmentReview.reviewerId=' tech ';
}
window.__fair={item,posts:[],gets:[],dirty:false,saved:0,fail:false,camera:0,printed:0,printHtml:''};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.__fair.camera++;throw Error('Camera must not open implicitly');}}});
window.open=()=>({document:{open(){},write(html){window.__fair.printHtml=html},close(){}},focus(){},print(){window.__fair.printed++;}});
createRoot(document.getElementById('root')).render(React.createElement(RepairDocuments,{item,entityId:'synthetic-company',onSaved:()=>{window.__fair.saved++},onDirtyChange:dirty=>{window.__fair.dirty=dirty}}));
`;
const api = `export const API_URL='/api/v1';export default {async get(path){window.__fair.gets.push(path);if(path.endsWith('/reports')||path.endsWith('/media'))return {data:{items:[]}};throw Error('Unexpected offline read '+path);},async post(path,body){window.__fair.posts.push({path,body:structuredClone(body)});if(window.__fair.fail)throw Object.assign(Error('offline failure'),{response:{data:{message:'合成儲存失敗'}}});return {data:{}}}};`;

test('fair inspection on actual saved, editable and readonly React/AntD document forms', { skip: !executablePath && 'Existing browser required', timeout: 240000 }, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'repair-fair-inspection-'));
  const virtual = '\0repair-fair-inspection-fixture'; let browser;
  const server = await createServer({ root, cacheDir, configFile: false,
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'antd', '@ant-design/icons'] },
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-fair-inspection', resolveId(id) { if (id === 'virtual:repair-fair-inspection') return virtual; },
      load(id) { if (id === virtual) return fixture; if (id.endsWith('/src/services/api.ts')) return api;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'tech',roles:[],permissions:(new URL(location.href).searchParams.get('scenario')||'').startsWith('readonly')?['repair_workbench:read']:['repair_workbench:update']}});`; },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__repair-fair') return next();
        try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml('/__repair-fair', '<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-fair-inspection"></script></body></html>')); } catch (error) { next(error); }
      }); },
    }] });
  t.after(async () => { if (browser) await browser.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  page.setDefaultTimeout(10000); const errors = [], external = [], networkWrites = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { const request = route.request(); if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); } if (!['GET', 'HEAD'].includes(request.method())) { networkWrites.push(request.method()); return route.abort(); } return route.continue(); });
  const form = () => page.locator('form#repair-inspection-synthetic');
  const load = async scenario => { await page.goto(origin + '/__repair-fair?scenario=' + scenario); await form().waitFor(); };
  const choose = async (name, label) => { await form().getByLabel(name, { exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(label, { exact: true }).click(); await page.keyboard.press('Escape'); };
  const fillKnown = async (label = '使用／外力因素已確認') => {
    await choose('原因', label); await form().getByLabel('判斷依據', { exact: true }).fill('接口變形且接觸不良');
    await form().getByLabel('因果說明', { exact: true }).fill('接口變形造成接觸不良，與本次充電故障一致'); await choose('關鍵測項', '充電狀態');
  };
  const save = async (status = 'DRAFT') => { await form().getByRole('button', { name: status === 'DRAFT' ? /儲存草稿/ : /提交檢修單/ }).click(); await page.waitForFunction(() => window.__fair.saved === 1); return page.evaluate(() => window.__fair.posts.at(-1)); };

  await t.test('new and legacy false/true/missing conclusions remain unknown and round-trip the complete record', async () => {
    for (const scenario of ['new', 'old-false', 'old-true', 'old-missing', 'suspected']) {
      await load(scenario); assert.equal(await form().getByText('原因待確認', { exact: true }).count(), 1);
      assert.equal(await form().locator('[aria-label="佐證覆核"]').count(), 0);
      for (const name of ['判斷依據', '關鍵測項', '關鍵影像']) assert.equal(await form().getByLabel(name, { exact: true }).count(), 0, 'ordinary unknown has no extra cause evidence controls');
      const post = await save(); assert.equal(post.body.data.assessment.schema, 1); assert.equal(post.body.data.assessment.conclusion, 'UNDETERMINED');
      assert.equal(post.body.data.assessment.basis, ''); assert.equal(post.body.data.assessment.causalExplanation, post.body.data.diagnosis);
      assert.equal(post.body.data.causeStatus, scenario === 'suspected' ? 'SUSPECTED' : 'UNKNOWN'); assert.equal(Object.hasOwn(post.body.data, 'isAccidentalDamage'), false);
      assert.deepEqual(post.body.data.assessment.mediaIds, []); assert.equal(post.body.expectedVersion, 7); assert.match(post.body.requestId, /^[a-f0-9-]{36}$/);
      if (scenario !== 'new') assert.deepEqual(post.body.data.mediaRefs, [{ mediaId: 'old-photo', phase: 'BEFORE', checkKey: 'power' }]);
    }
  });
  await t.test('unknown drafts with selected evidence retain their controls and complete record instead of silently clearing it', async () => {
    await load('unknown-draft'); assert.equal(await form().getByLabel('判斷依據', { exact: true }).inputValue(), '已記錄接觸異常，原因仍待查');
    assert.equal(await form().getByLabel('關鍵測項', { exact: true }).count(), 1); assert.equal(await form().getByLabel('關鍵影像', { exact: true }).count(), 1);
    const post = await save(); assert.deepEqual(post.body.data.assessment, { schema: 1, conclusion: 'UNDETERMINED', basis: '已記錄接觸異常，原因仍待查', causalExplanation: '原因尚待確認', checkKeys: ['power'], mediaIds: ['old-photo'] });
    assert.equal(post.body.data.causeStatus, 'SUSPECTED'); assert.equal(Object.hasOwn(post.body.data, 'isAccidentalDamage'), false);
    assert.deepEqual(post.body.data.mediaRefs, [{ mediaId: 'old-photo', phase: 'BEFORE', checkKey: 'power' }]);
  });
  await t.test('real user-caused input serializes current evidence without using final CSR approval as fair review', async () => {
    await load('old-false'); await fillKnown(); await choose('關鍵影像', '收件接口.png');
    assert.equal(await form().getByText('佐證覆核 · 待覆核', { exact: true }).count(), 1);
    assert.equal(await form().getByText('覆核通過', { exact: false }).count(), 0);
    const post = await save('SUBMITTED'); assert.equal(post.path, '/repair-workbench/items/synthetic/inspection');
    assert.deepEqual(post.body.data.assessment, { schema: 1, conclusion: 'USER_CAUSED', basis: '接口變形且接觸不良', causalExplanation: '接口變形造成接觸不良，與本次充電故障一致', checkKeys: ['power'], mediaIds: ['old-photo'] });
    assert.equal(post.body.data.causeStatus, 'CONFIRMED'); assert.equal(post.body.data.isAccidentalDamage, true); assert.equal(post.body.data.isUnderWarranty, false);
    assert.deepEqual(post.body.data.mediaRefs, [{ mediaId: 'old-photo', phase: 'BEFORE', checkKey: 'power' }]); assert.equal(Object.hasOwn(post.body.data, 'assessmentReview'), false);
    assert.equal(await page.evaluate(() => window.__fair.camera), 0);
  });
  await t.test('product fault is an explicit confirmed choice and retains its checked basis', async () => {
    await load('no-evidence'); await fillKnown('產品本身異常已確認'); const post = await save('SUBMITTED');
    assert.equal(post.body.data.assessment.conclusion, 'PRODUCT_FAULT'); assert.equal(post.body.data.isAccidentalDamage, false); assert.equal(post.body.data.causeStatus, 'CONFIRMED');
    assert.deepEqual(post.body.data.assessment.checkKeys, ['power']); assert.equal(await form().locator('[aria-label="佐證覆核"]').count(), 0);
  });
  await t.test('known findings require basis, causal explanation and actual checked keys; a draft retains incomplete fields', async () => {
    await load('no-evidence'); await choose('原因', '使用／外力因素已確認'); await form().getByLabel('因果說明', { exact: true }).fill('');
    await form().getByRole('button', { name: '提交檢修單', exact: true }).click();
    for (const text of ['請填判斷依據', '請填因果說明或待確認原因', '請選已檢測的關鍵測項']) await form().getByText(text, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__fair.posts.length), 0);
    const post = await save(); assert.equal(post.body.data.assessment.conclusion, 'USER_CAUSED'); assert.equal(post.body.data.assessment.basis, ''); assert.deepEqual(post.body.data.assessment.checkKeys, []);
  });
  await t.test('neither an observation with fake measurement nor an AFTER photo replaces cause evidence', async () => {
    for (const scenario of ['no-evidence', 'fake-observation', 'after']) {
      await load(scenario); if (scenario !== 'after') await fillKnown();
      await form().getByRole('button', { name: '提交檢修單', exact: true }).click(); await form().getByText('請選關鍵影像或留下實際量測', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__fair.posts.length), 0);
      const post = await save(); if (scenario === 'after') { assert.deepEqual(post.body.data.mediaRefs, [{ mediaId: 'after-photo', phase: 'AFTER', checkKey: 'power' }]); assert.deepEqual(post.body.data.assessment.mediaIds, ['after-photo']); }
    }
  });
  await t.test('matching reviewed NUMBER and BOOLEAN actual measurements can support the finding without photographs', async () => {
    for (const scenario of ['numeric', 'boolean']) {
      await load(scenario); await fillKnown(); const post = await save('SUBMITTED'); assert.equal(post.body.data.assessment.conclusion, 'USER_CAUSED');
      assert.deepEqual(post.body.data.assessment.mediaIds, []); assert.equal(post.body.data.checks[0].measurementValue, scenario === 'numeric' ? '0.05' : false);
    }
  });
  await t.test('wrong product, wrong SKU and missing templates never seed fabricated reviewed checks', async () => {
    for (const scenario of ['wrong-product', 'wrong-sku', 'missing-template']) {
      await load(scenario); assert.equal(await form().getByRole('button', { name: '套用檢測基準', exact: true }).count(), 0);
      await form().getByText('檢測基準待確認', { exact: true }).waitFor(); const post = await save();
      assert.equal(Object.hasOwn(post.body.data, 'templateBinding'), false); assert.equal(post.body.data.checks[0].name, ''); assert.equal(Object.hasOwn(post.body.data.checks[0], 'key'), false);
    }
  });
  await t.test('readonly legacy true/false and historical records keep their original fact and saved-only print', async () => {
    for (const scenario of ['readonly', 'readonly-true']) {
      await load(scenario); assert.equal(await form().getByLabel('原因', { exact: true }).count(), 0); await form().getByText('人為損壞判定', { exact: true }).waitFor();
      assert.equal(await form().getByText(scenario==='readonly-true'?'是':'否', { exact: true }).count(), 1); assert.equal(await form().getByText('原因已確認', { exact: true }).count(), 1);
      assert.equal(await form().getByText('原因待確認', { exact: true }).count(), 0); assert.equal(await form().getByRole('button', { name: '儲存草稿', exact: true }).count(), 0);
      assert.equal(await form().locator('[aria-label="佐證覆核"]').count(), 0); assert.equal(await page.evaluate(() => window.__fair.posts.length), 0);
    }
    await load('readonly-assessment'); assert.equal(await form().getByLabel('原因', { exact: true }).isDisabled(), true); await form().getByText('產品本身異常已確認', { exact: true }).waitFor();
    await load('old-false'); await form().getByLabel('因果說明', { exact: true }).fill('未保存新因果');
    await page.locator('.repair-documents .ant-tabs-tabpane-active').getByRole('button', { name: /列印/ }).click();
    const printed = await page.evaluate(() => window.__fair.printHtml); assert(printed.includes('人為損壞判定')); assert(!printed.includes('未保存新因果')); assert(!printed.includes('產品本身異常已確認'));
    await page.getByRole('tab', { name: '版本歷程', exact: true }).click(); const header = page.locator('.repair-documents .ant-collapse-header').filter({ hasText: 'SYNTHETIC-OLD' }); await header.click();
    const history = header.locator('..'); await history.getByText('已保存的舊診斷', { exact: true }).waitFor(); assert.equal(await history.getByText('人為損壞判定', { exact: true }).count(), 1); assert.equal(await history.getByText('否', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.__fair.posts.length), 0);
  });
  await t.test('only actual independent current revision/hash/time review proof displays approval, and edits wait for server proof', async () => {
    await load('review-current'); await form().getByText('佐證覆核 · 覆核通過', { exact: true }).waitFor(); await form().getByText(/合成覆核人/).waitFor();
    await form().getByLabel('判斷依據', { exact: true }).fill('新判斷待重新覆核'); await form().getByText('佐證覆核 · 待覆核', { exact: true }).waitFor();
    await save(); assert.equal(await form().getByText('佐證覆核 · 覆核通過', { exact: true }).count(), 0, 'POST success alone is not fresh review proof');
    for (const scenario of ['review-missing', 'review-null', 'review-stale', 'review-hash', 'review-self', 'review-self-space', 'review-time', 'review-future', 'review-noncanonical', 'review-note', 'review-no-csr', 'review-no-author', 'review-no-owner']) {
      await load(scenario); await form().getByText('佐證覆核 · 待覆核', { exact: true }).waitFor(); assert.equal(await form().getByText('佐證覆核 · 覆核通過', { exact: true }).count(), 0); assert.equal(await page.evaluate(() => window.__fair.posts.length), 0);
    }
  });
  await t.test('offline save failure preserves the typed evidence and reuses the exact retry identity', async () => {
    await load('old-false'); await fillKnown(); await choose('關鍵影像', '收件接口.png'); await page.evaluate(() => { window.__fair.fail = true; });
    await form().getByRole('button', { name: '儲存草稿', exact: true }).click(); await page.getByText('合成儲存失敗', { exact: true }).waitFor();
    assert.equal(await form().getByLabel('判斷依據', { exact: true }).inputValue(), '接口變形且接觸不良'); assert.equal(await page.evaluate(() => window.__fair.dirty), true);
    await page.evaluate(() => { window.__fair.fail = false; }); await save(); const posts = await page.evaluate(() => window.__fair.posts);
    assert.equal(posts.length, 2); assert.equal(posts[0].body.requestId, posts[1].body.requestId); assert.deepEqual(posts[0].body.data.assessment, posts[1].body.data.assessment);
  });
  await t.test('five logical sections keep compact actual names, three document tabs and mobile width without teaching banners', async () => {
    await load('old-false'); for (const title of ['收件核對', '重現問題', '核心檢查', '判斷與佐證']) assert.equal(await form().getByRole('heading', { name: title, exact: true }).count(), 1);
    assert.equal(await page.locator('.repair-documents > .ant-tabs [role="tab"]').count(), 3); assert.equal(await form().locator('[aria-label="佐證覆核"]').count(), 0);
    await page.screenshot({ path: join(output, 'ordinary-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await load('review-current'); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(output, 'review-mobile.png'), fullPage: true });
    await page.getByRole('tab', { name: '維修單', exact: true }).click(); await page.locator('form#repair-report-synthetic').getByRole('heading', { name: '修復與複驗', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__fair.posts.length), 0); assert.equal(await page.evaluate(() => window.__fair.camera), 0);
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(networkWrites, []);
});
