import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

async function measureMobileHeaders(table, page, expectedHeaders) {
  await table.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const drawer = element.closest('.ant-drawer-content-wrapper');
    if (drawer) await Promise.allSettled(drawer.getAnimations().map(animation => animation.finished));
  });
  const measured = await table.evaluate(element => {
    const scroller = element.querySelector('.ant-table-content');
    if (!scroller) throw new Error('Missing actual table scroll container');
    const clip = scroller.getBoundingClientRect();
    const headers = [...element.querySelectorAll('thead th')].map(header => {
      const bounds = header.getBoundingClientRect(), glyphs = [];
      const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let offset = 0; offset < node.textContent.length; offset++) {
          if (!node.textContent[offset].trim()) continue;
          const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
          const rect = range.getBoundingClientRect();
          glyphs.push({ char: node.textContent[offset], x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
      }
      return { text: header.textContent.trim(), left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, glyphs };
    });
    return { headers, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, scrollLeft: scroller.scrollLeft,
      overflowX: getComputedStyle(scroller).overflowX, clip: { left: clip.left, right: clip.right }, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  assert.deepEqual(measured.headers.map(header => header.text), expectedHeaders);
  assert(['auto', 'scroll'].includes(measured.overflowX));
  assert(measured.scrollWidth > measured.clientWidth + 10);
  assert(measured.clip.left >= -1 && measured.clip.right <= measured.viewportWidth + 1, JSON.stringify({ clip: measured.clip, viewportWidth: measured.viewportWidth }));
  assert(measured.documentWidth <= measured.viewportWidth);
  for (const header of measured.headers) {
    assert(header.glyphs.length > 0, header.text);
    const tops = header.glyphs.map(glyph => glyph.y);
    assert(Math.max(...tops) - Math.min(...tops) <= 1.5, header.text + ' must render on one real text line');
    for (const glyph of header.glyphs) {
      assert(glyph.width > 0 && glyph.height > 0, header.text + ' has real rendered glyphs');
      assert(glyph.x >= header.left - 1 && glyph.x + glyph.width <= header.right + 1, header.text + ' fits its column');
      assert(glyph.y >= header.top - 1 && glyph.y + glyph.height <= header.bottom + 1, header.text + ' fits its header height');
    }
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  return measured;
}
async function exposeMobileHeader(table, label) {
  const header = table.getByRole('columnheader', { name: label, exact: true });
  await header.evaluate(async element => {
    const scroller = element.closest('.ant-table-content');
    scroller.scrollLeft += element.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  const measured = await header.evaluate(element => {
    const scroller = element.closest('.ant-table-content'), clip = scroller.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect();
    return { label: element.textContent.trim(), textLeft: text.left, textRight: text.right, clipLeft: clip.left, clipRight: clip.left + scroller.clientWidth, scrollLeft: scroller.scrollLeft };
  });
  assert(measured.textLeft >= measured.clipLeft - 1 && measured.textRight <= measured.clipRight + 1, label + ' text is readable after internal scroll');
  return measured;
}
async function rightMobileAction(table, actionName) {
  const scroller = table.locator('.ant-table-content');
  const scroll = await scroller.evaluate(async element => {
    element.scrollLeft = element.scrollWidth;
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { actual: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth };
  });
  assert(scroll.maximum > 0 && Math.abs(scroll.actual - scroll.maximum) <= 1);
  const action = table.getByRole('button', { name: actionName, exact: true });
  const measured = await action.evaluate(button => {
    const scroller = button.closest('.ant-table-content'), component = button.closest('section[aria-label="檢測標準與校正管理"]');
    const visible = scroller.getBoundingClientRect(), root = component.getBoundingClientRect(), rect = button.getBoundingClientRect();
    const clip = { left: Math.max(0, visible.left, root.left), right: Math.min(innerWidth, visible.left + scroller.clientWidth, root.right),
      top: Math.max(0, visible.top, root.top), bottom: Math.min(innerHeight, visible.bottom, root.bottom) };
    const header = [...scroller.querySelectorAll('thead th')].find(value => value.textContent.trim() === '操作');
    const range = document.createRange(); range.selectNodeContents(header); const text = range.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, hit = document.elementFromPoint(center.x, center.y);
    return { actionName: button.getAttribute('aria-label'), enabled: !button.disabled && button.getAttribute('aria-disabled') !== 'true',
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, clip, center,
      hit: !!hit && (button === hit || button.contains(hit)), headerTextLeft: text.left, headerTextRight: text.right };
  });
  assert(measured.enabled && measured.hit, actionName + ' has a real enabled hit target');
  assert(measured.left >= measured.clip.left - 1 && measured.right <= measured.clip.right + 1, actionName + ' is fully inside horizontal clip');
  assert(measured.top >= measured.clip.top - 1 && measured.bottom <= measured.clip.bottom + 1, actionName + ' is fully inside vertical clip');
  assert(measured.headerTextLeft >= measured.clip.left - 1 && measured.headerTextRight <= measured.clip.right + 1, 'right operation header remains readable');
  return { ...measured, scroll };
}

const fixture = `
import '/src/index.css';import React from 'react';import {createRoot} from 'react-dom/client';import {RouterProvider,createMemoryRouter} from 'react-router-dom';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
const scenario=new URLSearchParams(location.search).get('scenario') || 'ready';
const check={key:'function',name:'實際功能觀察',requiredForInspection:true,requiredForCompletion:true,requiresCalibration:false,standard:{kind:'OBSERVATION',instruction:'合成實際檢測條件'}};
const template={schema:1,id:'synthetic-template',revision:1,contentHash:'c'.repeat(64),status:'REVIEWED',entityId:'synthetic-company',productId:'synthetic-product',sku:'QA-RETURN-SKU',checks:[check]};
const binding={id:template.id,revision:template.revision,contentHash:template.contentHash};
const item={id:'synthetic-return',entityId:'synthetic-company',version:7,status:'REFURBISHING',statusLabel:'整新中',editable:true,repairOwnerId:'tech',custodianId:'tech',custodianName:'合成技師',nextUserId:'tech',location:'合成技師暫存區',physicalCustody:'TECHNICIAN',productId:'synthetic-product',productName:'合成企業退回產品',sku:'QA-RETURN-SKU',serialNumber:'QA-RETURN-SN',label:'QA-RETURN-001',receipt:{category:'RETURN',number:'QA-RCPT-RETURN',sourceCaseId:'synthetic-source',sourceNumber:'QA-CORPORATE-RETURN',customerServiceUserId:'csr'},history:[],todoKind:'START_REFURBISHMENT',allowedWorkflowActions:['start_refurbishment'],
repairInspection:{number:'QA-INS-RETURN',revision:3,status:'SUBMITTED',authorId:'tech',authorName:'合成技師',updatedAt:'2026-10-13T01:00:00Z',submittedAt:'2026-10-13T01:00:00Z',review:{inspectionRevision:3,actorId:'csr',name:'合成客服',confirmedAt:'2026-10-13T02:00:00Z',decision:'APPROVE',planHash:'a'.repeat(64),quoteRevision:null},data:{protocol:2,complaint:'企業退回功能異常',reproduction:'YES',testConditions:'已依實際設備記錄',checks:[{key:'function',name:check.name,result:'PASS',observation:'已保存的功能觀察'}],templateBinding:binding,diagnosis:'實際原因已記錄',causeStatus:'CONFIRMED',plan:'REPAIR',planNote:'已保存的原機整新範圍',feeSuggestion:'FREE',estimateNote:'',materialPlan:{mode:'NONE',lines:[]},mediaRefs:[]}},
repairReport:{number:'QA-REP-RETURN',revision:1,status:'SUBMITTED',authorId:'tech',authorName:'合成技師',updatedAt:'2026-10-13T03:00:00Z',submittedAt:'2026-10-13T03:00:00Z',inspectionRevision:3,data:{protocol:2,outcome:'REPAIRED',workPerformed:'已保存的實際整新紀錄',parts:[],laborMinutes:15,checks:[{key:'function',name:check.name,result:'PASS',observation:'實際複驗通過'}],templateBinding:binding,qcResult:'PASS',qcNotes:'實際複驗紀錄',deliveredAccessories:'原配件',mediaRefs:[]}},
repairWorkflow:{csr:{status:'RESOLVED',decision:'APPROVE',inspectionRevision:3,estimateRevision:3,quoteRevision:null,planHash:'a'.repeat(64),ownerId:'csr',ownerName:'合成客服',acceptedAt:'2026-10-13T01:30:00Z',resolvedAt:'2026-10-13T02:00:00Z'}},
release:{available:false,repairAllowed:false,message:'企業退回不借顧客發票',releaseInfo:{quoteRevision:4,amount:999,currency:'TWD',invoiceRequired:true,invoiceStatus:'FAILED',invoiceSatisfied:false,invoiceQuoteRevision:2,customerApprovedQuoteRevision:null,customerApprovedAt:null,confirmedPaymentQuoteRevision:null}},
repairPrerequisites:{template,templateChecks:{inspection:'READY',completion:'READY'},materials:{start:{state:'READY',reason:'NOT_REQUIRED',requiredCount:0},completion:{state:'READY',reason:'NOT_REQUIRED',requiredCount:0}},mediaAssets:[]}};
if(scenario==='materials-blocked')item.repairPrerequisites.materials.start={state:'BLOCKED',reason:'NOT_RECEIVED',requiredCount:1};
if(scenario==='materials-unknown')delete item.repairPrerequisites.materials.start;
if(scenario==='template-blocked')item.repairPrerequisites.templateChecks.inspection='BLOCKED';
if(scenario==='template-unknown')delete item.repairPrerequisites.templateChecks.inspection;
if(scenario==='custodian'){item.custodianId='other';item.editable=false;}
if(scenario==='physical'){item.physicalCustody='FACTORY';}
if(scenario==='csr-revision')item.repairWorkflow.csr.inspectionRevision=2;
if(scenario==='csr-hash')item.repairWorkflow.csr.planHash='b'.repeat(64);
if(scenario==='csr-quote')item.repairWorkflow.csr.quoteRevision=4;
if(scenario==='customer-quote'){item.repairWorkflow.csr.quoteRevision=4;item.repairInspection.review.quoteRevision=4;}
if(scenario==='missing-csr-quote')delete item.repairWorkflow.csr.quoteRevision;
if(scenario==='missing-review-quote')delete item.repairInspection.review.quoteRevision;
if(scenario==='estimate-revision')item.repairWorkflow.csr.estimateRevision=2;
if(scenario==='completion-proofs-only'){item.repairPrerequisites.materials.completion={state:'UNKNOWN',reason:'UNASSESSED',requiredCount:0};item.repairPrerequisites.templateChecks.completion='UNKNOWN';}
if(scenario==='draft')item.repairInspection.status='DRAFT';
if(scenario==='replacement')item.repairInspection.data.plan='REPLACE';
if(scenario==='completion-unknown'){item.allowedWorkflowActions=[];delete item.todoKind;}
if(scenario==='no-product')delete item.productId;
const calibrationProof={id:'case-calibration',entityId:item.entityId,instrumentId:'actual-case-meter',equipmentType:'synthetic-meter',proofReference:'QA-ACTUAL-CALIBRATION',status:'VALID',validFrom:'2026-10-01T00:00:00Z',validUntil:'2027-10-01T00:00:00Z'};
const managerRow={id:'registry-standard',entityId:item.entityId,productId:'synthetic-product',sku:item.sku,revision:1,status:'DRAFT',data:{checks:[check]},contentHash:'d'.repeat(64),reviewedById:null,reviewedAt:null};
window.__APP_CONFIG__={mailroomEnabled:true};window.__refurbishmentFixture={scenario,item,posts:[],reads:[],standards:[managerRow],calibrations:[calibrationProof],behavior:scenario==='rejected'?'REJECT':'OK'};
const query='/?entityId=synthetic-company'+(scenario==='completion-unknown'?'&queue=all':'');
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router:createMemoryRouter([{path:'/',element:React.createElement(RepairWorkbenchPage)}],{initialEntries:[query]})}));
`;
const api = `export const API_URL='/api/v1';export default {
async get(path,options){const f=window.__refurbishmentFixture;f.reads.push({path,options:structuredClone(options)});
if(path.endsWith('/documents'))return{data:structuredClone(f.item)};
if(path==='/repair-workbench/todo')return{data:{items:[structuredClone(f.item)],total:1,queueCounts:{todo:1,all:1},countExact:true,unknownCount:0}};
if(path==='/mailroom/items')return{data:{items:[structuredClone(f.item)],total:1,queueCounts:{all:1},countExact:true}};
if(path==='/repair-workbench/test-registry'){if(f.scenario==='manager-refresh-fail'&&f.standards[0].status==='REVIEWED')throw Object.assign(new Error('Request failed with status code 503'),{response:{data:{message:'檢測標準暫無法重新讀取'}}});return{data:{standards:structuredClone(f.standards),calibrations:structuredClone(f.calibrations)}};}
if(path.endsWith('/media'))return{data:{items:[]}};
throw Error('Unexpected synthetic read '+path);},
async post(path,body){const f=window.__refurbishmentFixture;f.posts.push({path,body:structuredClone(body)});
if(path.endsWith('/workflow')){if(f.behavior==='REJECT')throw Object.assign(new Error('Request failed with status code 409'),{response:{data:{message:'整新方案已更新，請重新載入'}}});
if(body.action!=='start_refurbishment')throw Error('Unexpected synthetic workflow action');
f.item.repairWorkflow.workStart={schema:'corely.repair.work-start.v1',kind:'REFURBISHMENT',entityId:f.item.entityId,itemId:f.item.id,inspectionRevision:3,planHash:'a'.repeat(64),ownerId:'tech',custodianId:'tech',startedById:'tech',startedAt:'2026-10-13T04:00:00Z'};
f.item.repairPrerequisites.workStart={state:'READY',reason:'READY'};
f.item.allowedWorkflowActions=[];f.item.todoKind='REPAIR_WORK';f.item.version++;return{data:{id:f.item.id,duplicate:false}};}
if(path==='/repair-workbench/test-registry/standards/registry-standard/review'){if(f.scenario==='manager-pending')await new Promise(resolve=>window.__resolveRegistry=resolve);const row=f.standards[0];Object.assign(row,{status:'REVIEWED',reviewedById:'technical-owner',reviewedAt:'2026-10-13T04:00:00Z'});return{data:{id:row.id,revision:row.revision,status:row.status,contentHash:row.contentHash}};}
throw Error('Unexpected synthetic write '+path);}
};`;

test('corporate refurbishment and standard-manager drawer on actual local React/AntD workbench', { skip: !executablePath && 'Existing browser required', timeout: 180000 }, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'repair-refurbishment-dom-'));
  const virtual = '\0repair-refurbishment-dom';
  let browser;
  const server = await createServer({ root, cacheDir, configFile: false, optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react-dom/client', 'react-router-dom', 'antd', '@ant-design/icons', 'dayjs'] }, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'offline-refurbishment-dom', resolveId(id) { if (id === 'virtual:repair-refurbishment-dom') return virtual; },
    load(id) {
      if (id === virtual) return fixture;
      if (id.endsWith('/src/services/api.ts')) return api;
      if (id.endsWith('/src/services/websocket.service.ts')) return 'export const webSocketService={subscribe:()=>()=>{}};';
      if (id.endsWith('/src/contexts/AuthContext.tsx')) return `const scenario=new URLSearchParams(location.search).get('scenario');export const useAuth=()=>({user:{id:'tech',name:'合成技師',roles:['EMPLOYEE'],permissions:['repair_workbench:read',...(scenario==='readonly'?[]:['repair_workbench:update']),...(['manager','manager-pending','manager-refresh-fail','no-product'].includes(scenario)?['repair_workbench:manage']:[])]}});`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__repair-refurbishment') return next();
        try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml('/__repair-refurbishment', '<html lang="zh-Hant"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-refurbishment-dom"></script></body></html>')); }
        catch (error) { next(error); }
      });
    },
  }] });
  t.after(async () => { if (browser) await browser.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }); page.setDefaultTimeout(10000);
  const errors = [], external = [], writes = [], receipts = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method()); return route.abort(); }
    return route.continue();
  });
  const open = async scenario => {
    await page.goto(origin + '/__repair-refurbishment?scenario=' + scenario);
    await page.locator('.repair-case-list').waitFor();
    await page.getByRole('button', { name: /開啟案件：合成企業退回產品/ }).click();
    await page.locator('.repair-editor-sidebar').waitFor();
  };
  const sidebar = () => page.locator('.repair-editor-sidebar');
  const workflowForm = () => page.locator('form#repair-workflow-synthetic-return');
  const repairForm = () => page.locator('form#repair-report-synthetic-return');
  const manager = () => page.getByRole('region', { name: '檢測標準與校正管理', exact: true });
  const managerDrawer = () => page.locator('.ant-drawer-content').filter({ has: manager() });

  await t.test('server TODO and three entries expose one explicit start with keyboard note focus', async () => {
    await page.goto(origin + '/__repair-refurbishment?scenario=ready'); await page.locator('.repair-case-list').waitFor();
    assert.equal(await page.locator('.repair-workbench-page > .ant-tabs .ant-tabs-tab').count(), 3);
    await page.getByText('待開始整新', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/repair-refurbishment-three-entries-20261013.png', fullPage: true });
    await page.getByRole('button', { name: /開啟案件：合成企業退回產品/ }).click(); await sidebar().waitFor();
    const trigger = sidebar().getByRole('button', { name: '開始整新', exact: true });
    assert.equal(await trigger.isDisabled(), false);
    assert.equal(await sidebar().getByRole('button', { name: '開始維修', exact: true }).count(), 0);
    assert.equal(await sidebar().locator('button.ant-btn-primary:visible').count(), 1);
    await trigger.focus(); await page.keyboard.press('Enter'); await workflowForm().waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'repair-workflow-synthetic-return_note');
    assert.equal(await workflowForm().getByRole('checkbox').count(), 0);
    assert.equal(await workflowForm().getByLabel('本人核對後存放位置', { exact: true }).count(), 0);
    assert.equal(await sidebar().locator('button.ant-btn-primary:visible').count(), 1);
    await sidebar().screenshot({ path: '/tmp/repair-refurbishment-start-desktop-20261013.png' });
    await workflowForm().getByRole('button', { name: /取\s*消/ }).click();
    await page.waitForFunction(() => document.activeElement?.textContent === '開始整新');
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0);
  });

  await t.test('internal null-quote review starts through repair workflow with a minimal command and no customer invoice', async () => {
    await open('ready'); await sidebar().getByRole('button', { name: '開始整新', exact: true }).click();
    await workflowForm().getByLabel('開工紀錄', { exact: true }).fill('合成本人依目前整新方案開工');
    await workflowForm().getByRole('button', { name: '確認開始整新', exact: true }).click();
    await page.waitForFunction(() => window.__refurbishmentFixture.item.version === 8);
    const post = await page.evaluate(() => window.__refurbishmentFixture.posts[0]);
    assert.equal(post.path, '/repair-workbench/items/synthetic-return/workflow');
    assert.deepEqual(Object.keys(post.body).sort(), ['action', 'entityId', 'expectedVersion', 'note', 'requestId']);
    assert.equal(post.body.action, 'start_refurbishment'); assert.equal(post.body.expectedVersion, 7);
    assert.equal(post.body.note, '合成本人依目前整新方案開工'); assert.match(post.body.requestId, /^[A-Za-z0-9_-]{8,80}$/);
    const item = await page.evaluate(() => window.__refurbishmentFixture.item);
    assert.equal(item.repairWorkflow.csr.quoteRevision, null); assert.equal(item.repairInspection.review.quoteRevision, null);
    assert.equal(item.release.releaseInfo.invoiceSatisfied, false);
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.some(value => value.path.startsWith('/mailroom/items/'))), false);
    receipts.push({ scenario: 'start', post, customerInvoiceSatisfied: item.release.releaseInfo.invoiceSatisfied });
  });

  await t.test('START materials, INSPECTION template, current CSR identity and real custody fail closed', async () => {
    for (const scenario of ['materials-blocked', 'materials-unknown', 'template-blocked', 'template-unknown', 'custodian', 'physical', 'csr-revision', 'estimate-revision', 'csr-hash', 'csr-quote', 'customer-quote', 'missing-csr-quote', 'missing-review-quote', 'draft', 'replacement']) {
      await open(scenario);
      const action = sidebar().getByRole('button', { name: '開始整新', exact: true });
      assert.equal(await action.isDisabled(), true, scenario);
      assert.equal(await workflowForm().count(), 0, scenario);
      assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0, scenario);
      receipts.push({ scenario, startDisabled: true });
    }
    await open('readonly'); assert.equal(await sidebar().getByRole('button', { name: '開始整新', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0);
    await open('completion-proofs-only');
    assert.equal(await sidebar().getByRole('button', { name: '開始整新', exact: true }).isDisabled(), false);
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0);
  });

  await t.test('legacy REFURBISHING with submitted PASS report still cannot complete without server work-start projection', async () => {
    await open('completion-unknown'); await sidebar().getByLabel('交辦說明', { exact: true }).fill('合成已保存複驗的交回說明');
    const complete = sidebar().getByRole('button', { name: '交回收發室', exact: true });
    assert.equal(await complete.isDisabled(), true);
    const item = await page.evaluate(() => window.__refurbishmentFixture.item);
    assert.equal(item.status, 'REFURBISHING'); assert.equal(item.repairReport.data.qcResult, 'PASS');
    assert.equal(item.repairPrerequisites.workStart, undefined);
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0);
    await page.locator('.repair-readiness-compact .ant-collapse-header').click();
    await page.getByText('整新開工紀錄暫無法確認', { exact: true }).waitFor();
    await sidebar().screenshot({ path: '/tmp/repair-refurbishment-missing-start-desktop-20261013.png' });
    receipts.push({ scenario: 'completion-unknown', completeDisabled: true });
  });

  await t.test('fresh start rejection preserves actual form and request identity for an unchanged retry', async () => {
    await open('rejected'); await sidebar().getByRole('button', { name: '開始整新', exact: true }).click();
    await workflowForm().getByLabel('開工紀錄', { exact: true }).fill('合成同版整新重試');
    await workflowForm().getByRole('button', { name: '確認開始整新', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '整新方案已更新，請重新載入' }).first().waitFor();
    await workflowForm().getByRole('button', { name: '確認開始整新', exact: true }).click();
    await page.waitForFunction(() => window.__refurbishmentFixture.posts.length === 2);
    const posts = await page.evaluate(() => window.__refurbishmentFixture.posts);
    assert.equal(posts[0].body.requestId, posts[1].body.requestId); assert.equal(await page.evaluate(() => window.__refurbishmentFixture.item.version), 7);
  });

  await t.test('manager entry uses configured manage capability and the current actual Product', async () => {
    await open('ready'); assert.equal(await page.getByRole('button', { name: '檢測標準', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.reads.some(value => value.path.includes('/test-registry'))), false);
    await open('manager'); const trigger = page.getByRole('button', { name: '檢測標準', exact: true });
    assert.equal(await trigger.evaluate(element => element.classList.contains('ant-btn-primary')), false);
    await trigger.click(); await manager().waitFor(); await manager().getByRole('button', { name: '審核 v1', exact: true }).waitFor();
    assert.equal(await manager().getByRole('combobox', { name: '管理產品', exact: true }).isDisabled(), true);
    await manager().getByText('合成企業退回產品 · QA-RETURN-SKU', { exact: true }).waitFor();
    const read = await page.evaluate(() => window.__refurbishmentFixture.reads.find(value => value.path === '/repair-workbench/test-registry'));
    assert.deepEqual(read.options.params, { entityId: 'synthetic-company', productId: 'synthetic-product' });
    await manager().getByRole('button', { name: '新增版本', exact: true }).click();
    assert.equal(await page.locator('form#repair-standard-definition input#repair-standard-definition_productId').inputValue(), 'synthetic-product');
    assert.equal(await page.locator('form#repair-standard-definition input#repair-standard-definition_productId').isVisible(), false);
    await page.locator('form#repair-standard-definition').getByRole('button', { name: /取\s*消/ }).click();
    await managerDrawer().getByRole('button', { name: 'Close', exact: true }).click(); await manager().waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0);
    await open('no-product'); await page.getByRole('button', { name: '檢測標準', exact: true }).click();
    await manager().getByText('產品待確認', { exact: true }).waitFor();
    assert.equal(await manager().getByRole('button', { name: '建立草稿', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.reads.some(value => value.path.includes('/test-registry'))), false);
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0);
  });

  await t.test('manager receipt keeps an unsaved document mounted; cancel close retains it and confirm close refreshes', async () => {
    await open('manager'); await page.getByRole('tab', { name: '維修單', exact: true }).click();
    await repairForm().getByLabel('實際施工／替換內容', { exact: true }).fill('UNSAVED actual refurbishment work');
    await page.evaluate(() => { window.__dirtyDocumentNode = document.querySelector('form#repair-report-synthetic-return'); });
    const before = await page.evaluate(() => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length);
    await page.getByRole('button', { name: '檢測標準', exact: true }).click(); await manager().waitFor();
    await manager().getByRole('button', { name: '審核 v1', exact: true }).click();
    const review = page.getByRole('dialog', { name: '審核檢測標準 v1？', exact: true }); await review.waitFor();
    await review.getByRole('button', { name: /^審\s*核$/ }).click(); await manager().getByText('已審核', { exact: true }).waitFor(); await review.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__dirtyDocumentNode === document.querySelector('form#repair-report-synthetic-return') && window.__dirtyDocumentNode.isConnected), true);
    assert.equal(await repairForm().getByLabel('實際施工／替換內容', { exact: true }).inputValue(), 'UNSAVED actual refurbishment work');
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length), before);
    await managerDrawer().screenshot({ path: '/tmp/repair-standard-manager-case-drawer-desktop-20261013.png' });
    await managerDrawer().getByRole('button', { name: 'Close', exact: true }).click();
    const discard = page.getByRole('dialog', { name: '尚有未儲存的修改', exact: true }); await discard.waitFor();
    await discard.getByRole('button', { name: '繼續編輯', exact: true }).click(); await discard.waitFor({ state: 'hidden' });
    assert.equal(await manager().isVisible(), true);
    assert.equal(await repairForm().getByLabel('實際施工／替換內容', { exact: true }).inputValue(), 'UNSAVED actual refurbishment work');
    await managerDrawer().getByRole('button', { name: 'Close', exact: true }).click(); await discard.waitFor();
    await discard.getByRole('button', { name: '放棄修改', exact: true }).click(); await manager().waitFor({ state: 'hidden' });
    await page.waitForFunction(count => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length > count, before);
    await page.getByRole('tab', { name: '維修單', exact: true }).click();
    assert.equal(await repairForm().getByLabel('實際施工／替換內容', { exact: true }).inputValue(), '已保存的實際整新紀錄');
    const post = await page.evaluate(() => window.__refurbishmentFixture.posts[0]);
    assert.equal(post.path, '/repair-workbench/test-registry/standards/registry-standard/review');
    assert.deepEqual(Object.keys(post.body).sort(), ['entityId', 'expectedRevision', 'requestId']);
    receipts.push({ scenario: 'manager-preserves-document', post, cancelledClosePreservedDraft: true, confirmedCloseRefreshed: true });
  });

  await t.test('pending registry writes keep the manager open until a real receipt and closing then refreshes the case', async () => {
    await open('manager-pending'); await page.getByRole('button', { name: '檢測標準', exact: true }).click(); await manager().waitFor();
    const before = await page.evaluate(() => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length);
    await manager().getByRole('button', { name: '審核 v1', exact: true }).click();
    const review = page.getByRole('dialog', { name: '審核檢測標準 v1？', exact: true }); await review.waitFor();
    await review.getByRole('button', { name: /^審\s*核$/ }).click();
    await page.waitForFunction(() => window.__refurbishmentFixture.posts.length === 1);
    assert.equal(await managerDrawer().getByRole('button', { name: 'Close', exact: true }).count(), 0);
    await page.keyboard.press('Escape'); assert.equal(await manager().isVisible(), true);
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length), before);
    await page.evaluate(() => window.__resolveRegistry());
    await manager().getByText('已審核', { exact: true }).waitFor(); await review.waitFor({ state: 'hidden' });
    await managerDrawer().getByRole('button', { name: 'Close', exact: true }).click(); await manager().waitFor({ state: 'hidden' });
    await page.waitForFunction(count => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length > count, before);
    receipts.push({ scenario: 'manager-pending', closeHiddenWhilePending: true, refreshedAfterReceipt: true });
  });

  await t.test('a saved registry receipt followed by a failed registry refresh still causes a fresh case read on close', async () => {
    await open('manager-refresh-fail'); await page.getByRole('button', { name: '檢測標準', exact: true }).click(); await manager().waitFor();
    const before = await page.evaluate(() => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length);
    await manager().getByRole('button', { name: '審核 v1', exact: true }).click();
    const review = page.getByRole('dialog', { name: '審核檢測標準 v1？', exact: true }); await review.waitFor();
    await review.getByRole('button', { name: /^審\s*核$/ }).click();
    await manager().getByText('已儲存，資料暫無法重新載入。', { exact: true }).waitFor(); await review.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.standards[0].status), 'REVIEWED');
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length), before);
    await managerDrawer().getByRole('button', { name: 'Close', exact: true }).click(); await manager().waitFor({ state: 'hidden' });
    await page.waitForFunction(count => window.__refurbishmentFixture.reads.filter(value => value.path.endsWith('/documents')).length > count, before);
    receipts.push({ scenario: 'manager-refresh-fail', serverReceiptSaved: true, refreshedCaseOnClose: true });
  });

  await t.test('390px start and secondary manager drawer preserve focus and avoid horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await open('ready');
    const trigger = sidebar().getByRole('button', { name: '開始整新', exact: true }); await trigger.focus(); await page.keyboard.press('Enter');
    await workflowForm().getByLabel('開工紀錄', { exact: true }).fill('合成手機本人確認整新');
    assert.equal(await sidebar().locator('button.ant-btn-primary:visible').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sidebar().screenshot({ path: '/tmp/repair-refurbishment-start-mobile-20261013.png' });
    await workflowForm().getByRole('button', { name: /取\s*消/ }).click(); await open('manager');
    const manageTrigger = page.getByRole('button', { name: '檢測標準', exact: true }); await manageTrigger.focus(); await page.keyboard.press('Enter');
    await manager().waitFor(); await manager().getByRole('button', { name: '審核 v1', exact: true }).waitFor();
    assert.equal(await managerDrawer().locator('button.ant-btn-primary:visible').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const table = () => manager().locator('.ant-tabs-tabpane-active .ant-table-wrapper');
    const standards = await measureMobileHeaders(table(), page, ['版本', 'SKU', '狀態', '測項', '審核時間', '操作']);
    await managerDrawer().screenshot({ path: '/tmp/repair-standard-manager-case-drawer-mobile-20261013.png' });
    await exposeMobileHeader(table(), '測項');
    const reviewedHeader = await exposeMobileHeader(table(), '審核時間');
    await managerDrawer().screenshot({ path: '/tmp/repair-standard-manager-case-drawer-time-mobile-20261013.png' });
    const reviewAction = await rightMobileAction(table(), '審核 v1');
    await managerDrawer().screenshot({ path: '/tmp/repair-standard-manager-case-drawer-right-mobile-20261013.png' });
    await page.mouse.click(reviewAction.center.x, reviewAction.center.y);
    const review = page.getByRole('dialog', { name: '審核檢測標準 v1？', exact: true }); await review.waitFor();
    await review.getByRole('button', { name: /^取\s*消$/ }).click(); await review.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0);
    await manager().getByRole('tab', { name: '校正證明', exact: true }).click();
    await manager().getByText('QA-ACTUAL-CALIBRATION', { exact: true }).waitFor();
    const calibrations = await measureMobileHeaders(table(), page, ['設備', '校正證明', '有效期間', '狀態', '操作']);
    await managerDrawer().screenshot({ path: '/tmp/repair-calibration-manager-case-drawer-left-mobile-20261013.png' });
    const periodHeader = await exposeMobileHeader(table(), '有效期間');
    await managerDrawer().screenshot({ path: '/tmp/repair-calibration-manager-case-drawer-period-mobile-20261013.png' });
    const revokeAction = await rightMobileAction(table(), '撤銷校正證明 case-calibration');
    await managerDrawer().screenshot({ path: '/tmp/repair-calibration-manager-case-drawer-right-mobile-20261013.png' });
    await page.mouse.click(revokeAction.center.x, revokeAction.center.y);
    const revoke = page.getByRole('dialog', { name: '撤銷此校正證明？', exact: true }); await revoke.waitFor();
    await revoke.getByRole('button', { name: /^取\s*消$/ }).click(); await revoke.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__refurbishmentFixture.posts.length), 0);
    receipts.push({ scenario: '390px-real-table-layout', standards, reviewedHeader, reviewAction, calibrations, periodHeader, revokeAction });
    await managerDrawer().getByRole('button', { name: 'Close', exact: true }).click(); await manager().waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent === '檢測標準');
  });

  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
  writeFileSync('/tmp/repair-refurbishment-ui-receipt-20261013.json', JSON.stringify({ scope: 'local synthetic workbench only; no real corporate return, inventory, storage, registry or customer operation', receipts, errors, external, writes }, null, 2));
});
