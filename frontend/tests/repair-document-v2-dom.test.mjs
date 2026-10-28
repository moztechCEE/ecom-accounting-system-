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
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import RepairDocuments from '/src/pages/repair/RepairDocuments.tsx';
import RepairReadinessPanel from '/src/pages/repair/RepairReadinessPanel.tsx';
import {repairReadiness} from '/src/pages/repair/repair-readiness.ts';
import {sourceInvoiceCurrent,sourceItemQuoteBindingCurrent,sourceMaterialsCurrent,repairStartReady} from '/src/pages/repair/repair-model.ts';
import {useRepairFeedback} from '/src/pages/repair/repair-feedback.tsx';import '/src/pages/repair/repair.css';
const hash='a'.repeat(64),proposalHash='b'.repeat(64),binding={itemId:'synthetic',planVersion:2,planHash:hash,proposalHash};
const check={key:'synthetic-function',name:'SYNTHETIC function',result:'PASS',observation:'SAVED observation'};
const template={schema:1,id:'synthetic-template',revision:2,contentHash:'c'.repeat(64),status:'REVIEWED',entityId:'synthetic-company',productId:'synthetic-product',sku:'SYNTHETIC-SKU',checks:[{key:'synthetic-function',name:'SYNTHETIC function',requiredForInspection:true,requiredForCompletion:true,requiresCalibration:false,standard:{kind:'OBSERVATION',instruction:'SYNTHETIC fixture observation only'}}]};
const inspection={number:'SYNTHETIC-INS',revision:2,status:'SUBMITTED',authorId:'tech',authorName:'Synthetic technician',updatedAt:'2026-10-13T00:00:00Z',review:{inspectionRevision:2,actorId:'csr',name:'Synthetic CSR',confirmedAt:'2026-10-13T00:00:00Z',decision:'APPROVE',planHash:hash,quoteRevision:4},data:{protocol:2,isUnderWarranty:false,isAccidentalDamage:true,complaint:'SAVED complaint',reproduction:'YES',testConditions:'SAVED condition',checks:[check],templateBinding:{id:template.id,revision:2,contentHash:template.contentHash},diagnosis:'SAVED diagnosis',causeStatus:'UNKNOWN',plan:'REPAIR',planNote:'SAVED plan',feeSuggestion:'FREE',estimateNote:''}};
const report={number:'SYNTHETIC-REP',revision:1,status:'DRAFT',inspectionRevision:2,authorId:'tech',authorName:'Synthetic technician',updatedAt:'2026-10-13T00:00:00Z',data:{protocol:2,outcome:'REPAIRED',workPerformed:'SAVED work',parts:[],laborMinutes:0,checks:[check],qcResult:'NOT_TESTED',qcNotes:'SAVED QC',deliveredAccessories:'None'}};
const base={id:'synthetic',entityId:'synthetic-company',version:7,status:'INSPECTING',editable:true,repairOwnerId:'tech',custodianId:'tech',productId:'synthetic-product',productName:'Synthetic product',sku:'SYNTHETIC-SKU',serialNumber:'SYNTHETIC-SN',label:'SYNTHETIC',receipt:{category:'REPAIR',number:'SYNTHETIC-RCPT',sourceCaseId:'source',sourceNumber:'SYNTHETIC-CASE'},history:[],repairInspection:inspection,repairReport:report,repairProposalBinding:binding,repairWorkflow:{csr:{status:'RESOLVED',inspectionRevision:2,estimateRevision:2,quoteRevision:4,planHash:hash,decision:'APPROVE'}},release:{available:true,repairAllowed:true,releaseInfo:{quoteRevision:4,customerApprovedQuoteRevision:4,customerApprovedAt:'2026-10-13T00:00:00Z',amount:399,currency:'TWD',confirmedPaymentQuoteRevision:4,invoiceRequired:true,invoiceStatus:'ISSUED',invoiceSatisfied:true,invoiceQuoteRevision:4,quoteBindings:[{...binding,quoteRevision:4}]}},repairPrerequisites:{template,materialCatalog:{products:[{id:'part',name:'Synthetic battery',sku:'SYNTHETIC-PART'}],warehouses:[{id:'warehouse',name:'Synthetic parts',code:'SYN-PARTS'}]}}};
base.repairPrerequisites.materials={start:{state:'READY',reason:'NOT_REQUIRED',requiredCount:0},completion:{state:'READY',reason:'NOT_REQUIRED',requiredCount:0}};base.repairPrerequisites.templateChecks={inspection:'READY',completion:'READY'};
if(new URLSearchParams(location.search).has('ready'))base.repairInspection.data.materialPlan={mode:'NONE',lines:[]};
if(new URLSearchParams(location.search).has('legacy')){delete inspection.data.templateBinding;inspection.data.checks=[{name:'SAVED legacy check',result:'NOT_TESTED',observation:'SAVED reason'}];template.checks[0].standard={kind:'NUMBER',instruction:'SYNTHETIC numeric fixture',unit:'fixture-unit',min:'1.20',max:'1.25'};template.checks[0].requiresCalibration=true;}
if(new URLSearchParams(location.search).has('numeric')){Object.assign(check,{measurementValue:'1.25',unit:'fixture-unit',instrumentId:'meter',calibrationRecordId:'calibration',measuredAt:'2026-10-13T00:00:00Z'});check.observation='Actual recorded measurement';base.history=[{createdAt:'2026-10-13T00:00:00Z',snapshot:{repairInspection:structuredClone(inspection)}}];}
if(new URLSearchParams(location.search).has('noCatalog'))delete base.repairPrerequisites.materialCatalog;
if(new URLSearchParams(location.search).has('workingMeasurement')){check.observation='';check.result='NOT_TESTED';template.checks[0].standard={kind:'NUMBER',instruction:'SYNTHETIC numeric fixture',unit:'fixture-unit',min:'1.20',max:'1.25'};}
window.__v2Probe={posts:[],saved:0,dirty:false};window.__v2Base=base;window.__v2Functions={sourceInvoiceCurrent,sourceItemQuoteBindingCurrent,sourceMaterialsCurrent,repairStartReady,repairReadiness};
window.open=()=>({document:{open(){},write(html){window.__v2Probe.printHtml=html},close(){}},focus(){},print(){window.__v2Probe.printed=true}});
function Harness(){const [item,setItem]=useState(base);const feedback=useRepairFeedback();window.__setV2Item=setItem;
return React.createElement(React.Fragment,null,feedback.contextHolder,React.createElement(RepairDocuments,{key:item.version,item,entityId:'synthetic-company',feedback:feedback.message,onDirtyChange:v=>window.__v2Probe.dirty=v,onSaved:()=>{window.__v2Probe.saved++}}),React.createElement(RepairReadinessPanel,{item,viewerId:'tech',canUpdate:true,handoffNote:'SYNTHETIC handoff'}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const api = `export const API_URL='/api/v1';export default {async get(){throw Error('No provider')},async post(path,body){window.__v2Probe.posts.push({path,body:structuredClone(body)});return {data:{}}}};`;

test('new document v2 actual forms and strict release projection', { skip: !executablePath && 'Existing browser required', timeout: 120000 }, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'repair-document-v2-'));
  const virtual = '\0repair-document-v2-fixture'; let browser;
  const server = await createServer({ root, cacheDir, configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'offline-repair-v2', resolveId(id) { if (id === 'virtual:repair-document-v2') return virtual; },
    load(id) { if (id === virtual) return fixture; if (id.endsWith('/src/services/api.ts')) return api;
      if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'tech',roles:['EMPLOYEE'],permissions:['repair_workbench:update']}});`; },
    configureServer(vite) { vite.middlewares.use(async (request, response, next) => { if (request.url?.split('?')[0] !== '/__repair-v2') return next();
      try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml('/__repair-v2', '<html lang="zh-Hant"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-document-v2"></script></body></html>')); } catch (error) { next(error); } }); },
  }] });
  t.after(async () => { if (browser) await browser.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000); const errors = [], external = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { const request = route.request(); if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); } if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method()); return route.abort(); } return route.continue(); });
  const collapse = (form, name) => form.locator('.ant-collapse-header').filter({ hasText: name });
  const choose = async (control, label) => { await control.locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(label, { exact: true }).click(); };

  await t.test('missing material assessment blocks submission; explicit NONE and SCRAP remain a document proposal', async () => {
    await page.goto(origin + '/__repair-v2'); const form = page.locator('form#repair-inspection-synthetic'); await form.waitFor();
    await collapse(form, '材料需求').click();
    assert.equal(await form.locator('.repair-document-check').getByRole('button', { name: '移除', exact: true }).count(), 0, 'Required template row cannot be deleted');
    await form.getByRole('button', { name: /提交檢修單/ }).click(); await form.getByText('請確認材料需求', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__v2Probe.posts.length), 0);
    await choose(form.getByLabel('材料需求', { exact: true }), '無需材料');
    await choose(form.getByLabel('處理方式', { exact: true }), '報廢建議');
    await form.getByRole('button', { name: /提交檢修單/ }).click(); await page.waitForFunction(() => window.__v2Probe.posts.length === 1);
    const post = await page.evaluate(() => window.__v2Probe.posts[0]);
    assert.equal(post.path, '/repair-workbench/items/synthetic/inspection'); assert.equal(post.body.status, 'SUBMITTED'); assert.equal(post.body.expectedVersion, 7);
    assert.equal(post.body.data.protocol, 2); assert.deepEqual(post.body.data.materialPlan, { mode: 'NONE', lines: [] });
    assert.equal(post.body.data.plan, 'SCRAP'); assert.equal(post.body.data.isUnderWarranty, false);
    assert.equal(post.body.data.assessment.schema, 1); assert.equal(post.body.data.assessment.conclusion, 'UNDETERMINED');
    assert.equal(Object.hasOwn(post.body.data, 'isAccidentalDamage'), false, 'A legacy flag is not current human-cause evidence');
    assert.equal(post.body.data.checks[0].key, 'synthetic-function'); assert.equal(post.body.data.templateBinding.revision, 2);
    assert.match(post.body.requestId, /^[a-f0-9-]{36}$/); assert.equal(await page.evaluate(() => window.__v2Probe.saved), 1);
  });
  await t.test('required quantity stays an exact decimal string; unsupported precision is rejected before POST', async () => {
    await page.goto(origin + '/__repair-v2'); const form = page.locator('form#repair-inspection-synthetic'); await form.waitFor(); await collapse(form, '材料需求').click();
    await choose(form.getByLabel('材料需求', { exact: true }), '需材料'); await form.getByRole('button', { name: '新增材料', exact: true }).click();
    await choose(form.getByLabel('材料品項', { exact: true }), 'Synthetic battery · SYNTHETIC-PART'); await choose(form.getByLabel('材料倉位', { exact: true }), 'Synthetic parts · SYN-PARTS');
    await form.getByLabel('需求數量', { exact: true }).fill('1.255'); await form.getByRole('button', { name: /提交檢修單/ }).click();
    await form.getByText('請填大於零、最多兩位小數的材料數量', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.__v2Probe.posts.length), 0);
    assert.equal(await form.getByLabel('需求數量', { exact: true }).inputValue(), '1.255');
    await form.getByLabel('需求數量', { exact: true }).fill('1.25'); await form.getByRole('button', { name: '儲存草稿', exact: true }).click();
    await page.waitForFunction(() => window.__v2Probe.posts.length === 1); const post = await page.evaluate(() => window.__v2Probe.posts[0]);
    assert.equal(post.body.data.materialPlan.mode, 'REQUIRED'); const [material] = post.body.data.materialPlan.lines;
    assert.equal(material.productId, 'part'); assert.equal(material.warehouseId, 'warehouse'); assert.equal(material.requiredQuantity, '1.25'); assert.equal(material.requiredForStart, true);
    assert.equal(post.body.data.protocol, 2); assert.equal(post.body.status, 'DRAFT'); assert.equal('materialsReceipt' in post.body.data, false);
  });
  await t.test('customer preview is an actual draft and saves its structure without upload or publishing', async () => {
    await page.goto(origin + '/__repair-v2'); await page.getByRole('tab', { name: '維修單', exact: true }).click(); const form = page.locator('form#repair-report-synthetic');
    await collapse(form, '顧客報告草稿').click(); await form.getByLabel('顧客摘要', { exact: true }).fill('Cause remains unknown');
    await form.getByLabel('發現的問題', { exact: true }).fill('Intermittent symptom'); await form.getByLabel('處置說明', { exact: true }).fill('Connector cleaned'); await form.getByLabel('複驗結果摘要', { exact: true }).fill('Further observation required');
    await form.getByRole('button', { name: '預覽草稿', exact: true }).click(); const dialog = page.getByRole('dialog'); await dialog.getByText('草稿', { exact: true }).waitFor();
    for (const text of ['Intermittent symptom', 'Connector cleaned', 'Further observation required']) assert.equal(await dialog.getByText(text, { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.__v2Probe.posts.length), 0); await dialog.getByRole('button', { name: /關\s*閉/ }).click();
    assert.equal(await page.getByRole('button', { name: /發布|上傳/ }).count(), 0); await form.getByRole('button', { name: '儲存草稿', exact: true }).click();
    await page.waitForFunction(() => window.__v2Probe.posts.length === 1); const post = await page.evaluate(() => window.__v2Probe.posts[0]);
    assert.deepEqual(post.body.data.customerReportDraft, { findings: 'Intermittent symptom', handling: 'Connector cleaned', verification: 'Further observation required', mediaIds: [] }); assert.deepEqual(post.body.data.mediaRefs, []);
    assert.equal(post.body.data.customerVisibleSummary, 'Cause remains unknown'); assert.equal('published' in post.body.data.customerReportDraft, false);
  });
  await t.test('required materials cannot be submitted when the central catalog is unavailable', async () => {
    await page.goto(origin + '/__repair-v2?noCatalog=1'); const form = page.locator('form#repair-inspection-synthetic'); await form.waitFor(); await collapse(form, '材料需求').click();
    await choose(form.getByLabel('材料需求', { exact: true }), '需材料'); assert.equal(await form.getByRole('button', { name: '新增材料', exact: true }).isDisabled(), true);
    assert.equal(await form.getByLabel('材料品項', { exact: true }).count(), 0); assert.equal(await form.getByLabel('材料倉位', { exact: true }).count(), 0);
    await form.getByRole('button', { name: /提交檢修單/ }).click(); await form.locator('.ant-form-item-explain-error').getByText('材料品項尚未載入', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__v2Probe.posts.length), 0);
  });
  await t.test('applying a template protects an unsaved measurement even when its observation is still empty', async () => {
    await page.goto(origin + '/__repair-v2?workingMeasurement=1'); const form = page.locator('form#repair-inspection-synthetic'); await form.waitFor();
    await form.getByLabel('實際量測值', { exact: true }).fill('1.21'); await form.getByRole('button', { name: '套用檢測基準', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.locator('.ant-modal-confirm-title').filter({ hasText: '套用目前檢測基準？' }).waitFor(); await dialog.getByRole('button', { name: /取\s*消/ }).click();
    assert.equal(await form.getByLabel('實際量測值', { exact: true }).inputValue(), '1.21'); assert.equal(await page.evaluate(() => window.__v2Probe.posts.length), 0);
  });
  await t.test('strict invoice, current proposal and materials projections keep the visible readiness blocked', async () => {
    await page.goto(origin + '/__repair-v2?ready=1'); await page.locator('form#repair-inspection-synthetic').waitFor();
    const result = await page.evaluate(() => { const fn = window.__v2Functions, base = window.__v2Base, context = { viewerId: 'tech', canUpdate: true, handoffNote: 'handoff' };
      const cases = {}; cases.ready = fn.repairStartReady(base);
      for (const [name, edit] of Object.entries({ missingInvoicePolicy: item => delete item.release.releaseInfo.invoiceRequired, invoiceFlag: item => item.release.releaseInfo.invoiceSatisfied = false, staleInvoice: item => item.release.releaseInfo.invoiceQuoteRevision = 3, missingBinding: item => item.repairProposalBinding = null, otherProposal: item => item.release.releaseInfo.quoteBindings[0].proposalHash = 'd'.repeat(64), duplicateBinding: item => item.release.releaseInfo.quoteBindings.push(item.release.releaseInfo.quoteBindings[0]), unknownMaterials: item => item.repairInspection.data.materialPlan = { mode: 'UNASSESSED', lines: [] } })) { const item = structuredClone(base); edit(item); cases[name] = fn.repairStartReady(item) || fn.repairReadiness(item, context).startReady; }
      const required = structuredClone(base); required.repairInspection.data.materialPlan = { mode: 'REQUIRED', lines: [{ id: 'part', productId: 'part', warehouseId: 'warehouse', requiredQuantity: '1', requiredForStart: true }] }; cases.missingMaterials = fn.sourceMaterialsCurrent(required); required.repairPrerequisites.materials = {start:{state:'UNKNOWN',reason:'MISSING_RECEIPT',requiredCount:1},completion:{state:'UNKNOWN',reason:'MISSING_RECEIPT',requiredCount:1}}; cases.unknownReceipt = fn.sourceMaterialsCurrent(required);
      required.repairInspection.data.materialPlan.lines[0].requiredForStart = false;required.repairPrerequisites.materials.start={state:'READY',reason:'NOT_REQUIRED',requiredCount:0};cases.deferredStart = fn.sourceMaterialsCurrent(required, 'START'); cases.deferredCompletion = fn.sourceMaterialsCurrent(required, 'COMPLETION');
      const blocked = structuredClone(base); blocked.release.releaseInfo.invoiceSatisfied = false; window.__setV2Item(blocked); return cases; });
    assert.equal(result.ready, true); assert.equal(result.deferredStart, true);
    for (const [key, value] of Object.entries(result)) if (!['ready', 'deferredStart'].includes(key)) assert.equal(value, false, key);
    await page.getByRole('status', { name: '目前進度' }).filter({ hasText: /發票/ }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });
  await t.test('legacy working checks can explicitly apply reviewed keys and honestly submit NOT_TESTED without invented measurements',async()=>{
    await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/__repair-v2?legacy=1');const form=page.locator('form#repair-inspection-synthetic');await form.waitFor();
    assert.equal(await form.getByRole('button',{name:'新增項目',exact:true}).count(),0);await form.getByRole('button',{name:'套用檢測基準',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/套\s*用/,exact:false}).click();
    await form.getByLabel('觀察',{exact:true}).fill('Equipment unavailable; test was not performed');await collapse(form,'材料需求').click();await choose(form.getByLabel('材料需求',{exact:true}),'無需材料');
    await form.getByRole('button',{name:/提交檢修單/}).click();await page.waitForFunction(()=>window.__v2Probe.posts.length===1);const data=await page.evaluate(()=>window.__v2Probe.posts[0].body.data);
    assert.equal(data.templateBinding.id,'synthetic-template');assert.equal(data.checks[0].key,'synthetic-function');assert.equal(data.checks[0].result,'NOT_TESTED');assert.equal('measurementValue' in data.checks[0],false);assert.equal('calibrationRecordId' in data.checks[0],false);
  });
  await t.test('saved numeric and calibration evidence stays in history and internal print',async()=>{
    await page.goto(origin+'/__repair-v2?numeric=1');await page.locator('form#repair-inspection-synthetic').waitFor();await page.getByRole('button',{name:/列印/}).click();const html=await page.evaluate(()=>window.__v2Probe.printHtml);
    for(const value of ['1.25 fixture-unit','設備 meter','校正 calibration','2026-10-13T00:00:00Z'])assert(html.includes(value),value);
    await page.getByRole('tab',{name:'版本歷程',exact:true}).click();await page.locator('.repair-documents .ant-collapse-header').filter({hasText:'檢修單 SYNTHETIC-INS'}).click();
    await page.getByText('1.25 fixture-unit · 設備 meter · 校正 calibration · 2026-10-13T00:00:00Z',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__v2Probe.posts.length),0);
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
});
