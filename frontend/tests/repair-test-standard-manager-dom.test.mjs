import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import '/src/index.css';import React from 'react';import {createRoot} from 'react-dom/client';
import Manager from '/src/pages/repair/RepairTestStandardManager.tsx';
const scenario=new URLSearchParams(location.search).get('scenario');
const product=scenario==='missing-product'?null:{id:'actual-product',name:'合成實際產品',sku:'ACTUAL-SKU'};
createRoot(document.getElementById('root')).render(React.createElement(Manager,{entityId:'company',product,canManage:scenario!=='readonly',onChanged:()=>window.__standardManagerFixture.changed++}));
`;
const api = `
const scenario=new URLSearchParams(location.search).get('scenario');
const check={key:'synthetic-voltage',name:'合成電壓',requiredForInspection:true,requiredForCompletion:true,requiresCalibration:true,equipmentType:'synthetic-meter',standard:{kind:'NUMBER',instruction:'合成檢測條件',unit:'fixture-unit',min:'1.20',max:'1.25'}};
const row={id:'server-standard',entityId:'company',productId:'actual-product',sku:'ACTUAL-SKU',revision:1,status:'DRAFT',data:{modelNumber:'ACTUAL model',checks:[check]},contentHash:'a'.repeat(64),reviewedById:null,reviewedAt:null};
const proof={id:'server-calibration',entityId:'company',instrumentId:'actual-meter',equipmentType:'synthetic-meter',proofReference:'ACTUAL-CERT',status:'VALID',validFrom:'2026-10-01T00:00:00Z',validUntil:'2027-10-01T00:00:00Z'};
const state={gets:[],posts:[],changed:0,behavior:scenario==='wrong-receipt'?'WRONG':scenario==='rejected'?'REJECT':'OK',standards:scenario==='existing'||scenario==='rejected'?[row]:[],calibrations:[proof],failReads:0};window.__standardManagerFixture=state;
const error=message=>({response:{status:503,data:{message}}});
export default {
async get(path,options){state.gets.push({path,options:structuredClone(options)});if(scenario==='unavailable'||state.failReads-->0)throw error('檢測標準服務尚未就緒');return{data:{standards:structuredClone(state.standards),calibrations:structuredClone(state.calibrations)}}},
async post(path,body){
state.posts.push({path,body:structuredClone(body)});if(state.behavior==='REJECT')throw error('標準版本已更新，請重新載入');
if(path.endsWith('/review')){const found=state.standards.find(item=>path.includes('/'+item.id+'/'));Object.assign(found,{status:'REVIEWED',reviewedById:'technical-owner',reviewedAt:'2026-10-13T00:00:00.000Z'});return{data:{id:found.id,revision:found.revision,status:'REVIEWED',contentHash:found.contentHash}}}
if(path.endsWith('/retire')){const found=state.standards.find(item=>path.includes('/'+item.id+'/'));found.status='RETIRED';return{data:{id:found.id,revision:found.revision,status:'RETIRED'}}}
if(path.endsWith('/calibrations/server-calibration/revoke')){state.calibrations[0].status='REVOKED';return{data:{id:'server-calibration',status:'REVOKED'}}}
if(path.endsWith('/calibrations')){const found={id:'new-calibration',entityId:body.entityId,instrumentId:body.instrumentId,equipmentType:body.equipmentType,proofReference:body.proofReference,validFrom:body.validFrom,validUntil:body.validUntil,status:'VALID'};state.calibrations.push(found);return{data:{id:found.id,status:'VALID'}}}
if(path.endsWith('/standards')||path.endsWith('/revisions')){const found={...row,id:'new-standard',revision:body.expectedRevision?body.expectedRevision+1:1,data:body.data,status:'DRAFT'};if(!state.standards.some(item=>item.id===found.id))state.standards.push(found);return{data:{id:found.id,revision:found.revision,status:state.behavior==='WRONG'?'REVIEWED':'DRAFT'}}}
throw Error('Unexpected synthetic operation '+path);
}};
`;

test('actual management panel uses configured capability and server-owned draft/review/calibration states', { skip: !executablePath && 'Existing browser required', timeout: 120000 }, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'repair-standard-manager-'));
  const virtual = '\0repair-standard-manager-fixture';
  const server = await createServer({ root, cacheDir, configFile: false, optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react-dom/client', 'react-router-dom', 'antd', '@ant-design/icons', 'dayjs'] }, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'offline-standard-manager',
    resolveId(id) { if (id === 'virtual:repair-standard-manager') return virtual; },
    load(id) { if (id === virtual) return fixture; if (id.endsWith('/src/services/api.ts')) return api; },
    configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
      if (request.url?.split('?')[0] !== '/__standard-manager') return next();
      try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml('/__standard-manager',
        '<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:12px;box-sizing:border-box"><div id="root"></div><script type="module" src="/@id/virtual:repair-standard-manager"></script></body></html>')); } catch (error) { next(error); }
    }); },
  }] });
  let browser;
  t.after(async () => { if (browser) await browser.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen(); const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, timezoneId: 'Asia/Taipei' });
  page.setDefaultTimeout(8000);
  const errors = [], external = [], writes = [], mobileTableReceipts = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method()); return route.abort(); }
    return route.continue();
  });
  const open = async scenario => { await page.goto(origin + '/__standard-manager?scenario=' + scenario); await page.getByRole('region', { name: '檢測標準與校正管理' }).waitFor(); };
  const choose = async (control, label) => {
    await control.locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click();
    const list = await control.getAttribute('aria-controls'); assert(list);
    await page.locator('[id="' + list + '"]').locator('xpath=ancestor::div[contains(@class,"ant-select-dropdown")]').locator('.ant-select-item-option-content').getByText(label, { exact: true }).click();
  };
  const definitionForm = () => page.locator('form#repair-standard-definition');
  const fillNumeric = async () => {
    const form = definitionForm(); await form.waitFor();
    await form.getByLabel('測項代碼', { exact: true }).fill('synthetic-voltage');
    await form.getByLabel('測項名稱', { exact: true }).fill('合成電壓');
    await form.getByLabel('測試條件', { exact: true }).fill('合成檢測條件');
    await choose(form.getByLabel('判定方式', { exact: true }), '數值');
    await form.getByLabel('單位', { exact: true }).fill('fixture-unit');
    await form.getByLabel('下限', { exact: true }).fill('1.20');
    await form.getByLabel('上限', { exact: true }).fill('1.25');
    await choose(form.getByLabel('檢修必測', { exact: true }), '是');
    await choose(form.getByLabel('複驗必測', { exact: true }), '否');
    await choose(form.getByLabel('使用校正設備', { exact: true }), '是');
    await form.getByLabel('設備類型', { exact: true }).fill('synthetic-meter');
  };
  await t.test('missing capability or actual Product cannot expose management mutations', async () => {
    await open('readonly'); await page.getByText('沒有檢測標準管理權限', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__standardManagerFixture.gets), []);
    assert.equal(await page.getByRole('button', { name: '建立草稿', exact: true }).count(), 0);
    await open('missing-product'); await page.getByText('產品待確認', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__standardManagerFixture.gets), []);
    assert.deepEqual(await page.evaluate(() => window.__standardManagerFixture.posts), []);
  });
  await t.test('current Product stays fixed; unsupported precision is preserved and blocked before POST', async () => {
    await open('new'); await page.getByRole('button', { name: '建立草稿', exact: true }).waitFor();
    await page.getByText('合成實際產品 · ACTUAL-SKU', { exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '管理產品', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '建立草稿', exact: true }).click(); await fillNumeric();
    await definitionForm().getByLabel('上限', { exact: true }).fill('1.2500001');
    await definitionForm().getByRole('button', { name: '保存草稿', exact: true }).click();
    await definitionForm().getByText('請填最多六位小數的數值', { exact: true }).waitFor();
    assert.equal(await definitionForm().getByLabel('上限', { exact: true }).inputValue(), '1.2500001');
    assert.equal(await page.evaluate(() => window.__standardManagerFixture.posts.length), 0);
    await definitionForm().getByLabel('上限', { exact: true }).fill('1.25');
    await definitionForm().getByRole('button', { name: '保存草稿', exact: true }).click();
    await page.waitForFunction(() => window.__standardManagerFixture.posts.length === 1);
    await page.getByText('草稿', { exact: true }).waitFor();
    const post = await page.evaluate(() => window.__standardManagerFixture.posts[0]);
    assert.equal(post.path, '/repair-workbench/test-registry/standards');
    assert.equal(post.body.productId, 'actual-product'); assert.equal(post.body.sku, 'ACTUAL-SKU');
    assert.equal(post.body.data.checks[0].standard.min, '1.20'); assert.equal(post.body.data.checks[0].standard.max, '1.25');
    assert.equal(post.body.data.checks[0].requiredForCompletion, false);
    assert.equal('status' in post.body, false); assert.equal('reviewedById' in post.body, false);
    assert.equal(await page.getByText('已審核', { exact: true }).count(), 0);
  });
  await t.test('review and retire require their own server receipts and expected revision', async () => {
    await open('existing'); await page.getByText('草稿', { exact: true }).waitFor();
    await page.getByRole('button', { name: '審核 v1', exact: true }).click();
    await page.getByRole('dialog').filter({ hasText: '審核檢測標準 v1？' }).getByRole('button', { name: /審\s*核/, exact: false }).click();
    await page.getByText('已審核', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.__standardManagerFixture.posts[0])).body.expectedRevision, 1);
    await page.getByRole('button', { name: '停用 v1', exact: true }).click();
    await page.getByRole('dialog').filter({ hasText: '停用檢測標準 v1？' }).getByRole('button', { name: /停\s*用/, exact: false }).click();
    await page.getByText('已停用', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__standardManagerFixture.posts.map(value => value.path)),
      ['/repair-workbench/test-registry/standards/server-standard/review', '/repair-workbench/test-registry/standards/server-standard/retire']);
  });
  await t.test('rejected revision stays editable and identical retry retains its request id', async () => {
    await open('rejected'); await page.getByText('草稿', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新增版本', exact: true }).click(); await definitionForm().getByLabel('測試條件', { exact: true }).fill('實際改版條件');
    await definitionForm().getByRole('button', { name: '保存草稿', exact: true }).click();
    await page.getByText('標準版本已更新，請重新載入', { exact: true }).waitFor();
    assert.equal(await definitionForm().getByLabel('測試條件', { exact: true }).inputValue(), '實際改版條件');
    await definitionForm().getByRole('button', { name: '保存草稿', exact: true }).click();
    await page.waitForFunction(() => window.__standardManagerFixture.posts.length === 2);
    const posts = await page.evaluate(() => window.__standardManagerFixture.posts);
    assert.deepEqual(posts[0], posts[1]); assert.equal(posts[0].body.expectedRevision, 1);
    assert.equal(posts[0].path, '/repair-workbench/test-registry/standards/server-standard/revisions');
  });
  await t.test('missing producer and incorrect status receipts never display invented reviewed results', async () => {
    await open('unavailable'); await page.getByText('檢測標準服務尚未就緒', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '建立草稿', exact: true }).isDisabled(), true);
    await open('wrong-receipt'); await page.getByRole('button', { name: '建立草稿', exact: true }).click(); await fillNumeric();
    await definitionForm().getByRole('button', { name: '保存草稿', exact: true }).click();
    await page.getByText('服務回執不完整，請重新載入', { exact: true }).waitFor();
    assert.equal(await page.getByText('已審核', { exact: true }).count(), 0); assert.equal(await definitionForm().count(), 1);
  });
  await t.test('actual calibration references and revoke remain a distinct server record', async () => {
    await open('existing'); await page.getByRole('tab', { name: '校正證明', exact: true }).click();
    await page.getByText('ACTUAL-CERT', { exact: true }).waitFor(); await page.getByText('server-calibration', { exact: true }).waitFor();
    await page.getByRole('button', { name: '撤銷校正證明 server-calibration', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /撤\s*銷/, exact: false }).click();
    await page.getByText('已撤銷', { exact: true }).waitFor();
    const post = await page.evaluate(() => window.__standardManagerFixture.posts[0]);
    assert.equal(post.path, '/repair-workbench/test-registry/calibrations/server-calibration/revoke');
    assert.deepEqual(Object.keys(post.body).sort(), ['entityId', 'requestId']);
  });
  await t.test('calibration authoring sends actual evidence and ISO dates only after its period is valid', async () => {
    await open('existing'); await page.getByRole('tab', { name: '校正證明', exact: true }).click();
    await page.getByRole('button', { name: '登錄校正證明', exact: true }).click();
    const form = page.locator('form#repair-calibration-definition');
    await form.getByLabel('設備編號', { exact: true }).fill('new-actual-meter');
    await form.getByLabel('設備類型', { exact: true }).fill('synthetic-meter');
    await form.getByLabel('校正證明編號／依據', { exact: true }).fill('NEW-ACTUAL-CERT');
    await form.getByLabel('有效起日', { exact: true }).fill('2020-01-01 10:00'); await form.getByLabel('有效起日', { exact: true }).press('Enter');
    await form.getByLabel('有效迄日', { exact: true }).fill('2020-01-01 10:00'); await form.getByLabel('有效迄日', { exact: true }).press('Enter');
    await form.getByRole('button', { name: '保存校正證明', exact: true }).click();
    await page.getByText('請核對校正設備、證明與有效期間', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__standardManagerFixture.posts.length), 0);
    await form.getByLabel('有效迄日', { exact: true }).fill('2030-01-01 10:00'); await form.getByLabel('有效迄日', { exact: true }).press('Enter');
    await form.getByRole('button', { name: '保存校正證明', exact: true }).click();
    await page.getByText('NEW-ACTUAL-CERT', { exact: true }).waitFor(); await page.getByText('new-calibration', { exact: true }).waitFor();
    const post = await page.evaluate(() => window.__standardManagerFixture.posts[0]);
    assert.equal(post.path, '/repair-workbench/test-registry/calibrations');
    assert.equal(post.body.proofReference, 'NEW-ACTUAL-CERT');
    assert.equal(post.body.validFrom, '2020-01-01T02:00:00.000Z'); assert.equal(post.body.validUntil, '2030-01-01T02:00:00.000Z');
    assert.equal('status' in post.body, false); assert.equal('id' in post.body, false);
  });
  await t.test('mobile authoring preserves one primary action and cancellation returns keyboard focus', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await open('new');
    const trigger = page.getByRole('button', { name: '建立草稿', exact: true }); await trigger.focus(); await page.keyboard.press('Enter'); await fillNumeric();
    await page.keyboard.press('Escape');
    await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
    await page.getByText('測項 1', { exact: true }).click();
    assert.equal(await page.locator('button.ant-btn-primary:visible').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('region', { name: '檢測標準與校正管理' }).screenshot({ path: '/tmp/repair-standard-manager-mobile-20261013.png' });
    await definitionForm().getByRole('button', { name: /取\s*消/ }).click();
    await page.waitForFunction(() => document.activeElement?.textContent === '建立草稿');
    assert.equal(await definitionForm().count(), 0);
    assert.equal(await page.evaluate(() => window.__standardManagerFixture.posts.length), 0);
  });
  await t.test('390px tables render every header on one real text line and expose readable clickable right actions', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await open('existing');
    const region = page.getByRole('region', { name: '檢測標準與校正管理', exact: true });
    const table = () => region.locator('.ant-tabs-tabpane-active .ant-table-wrapper');
    await region.getByRole('button', { name: '審核 v1', exact: true }).waitFor();
    const standards = await measureMobileHeaders(table(), page, ['版本', 'SKU', '狀態', '測項', '審核時間', '操作']);
    await region.screenshot({ path: '/tmp/repair-standard-manager-table-left-mobile-20261013.png' });
    await exposeMobileHeader(table(), '測項');
    const reviewedHeader = await exposeMobileHeader(table(), '審核時間');
    await region.screenshot({ path: '/tmp/repair-standard-manager-table-time-mobile-20261013.png' });
    const reviewAction = await rightMobileAction(table(), '審核 v1');
    await region.screenshot({ path: '/tmp/repair-standard-manager-table-right-mobile-20261013.png' });
    await page.mouse.click(reviewAction.center.x, reviewAction.center.y);
    const review = page.getByRole('dialog', { name: '審核檢測標準 v1？', exact: true }); await review.waitFor();
    await review.getByRole('button', { name: /^取\s*消$/ }).click(); await review.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__standardManagerFixture.posts.length), 0);
    await region.getByRole('tab', { name: '校正證明', exact: true }).click();
    await region.getByText('ACTUAL-CERT', { exact: true }).waitFor();
    const calibrations = await measureMobileHeaders(table(), page, ['設備', '校正證明', '有效期間', '狀態', '操作']);
    await region.screenshot({ path: '/tmp/repair-calibration-manager-table-left-mobile-20261013.png' });
    const periodHeader = await exposeMobileHeader(table(), '有效期間');
    await region.screenshot({ path: '/tmp/repair-calibration-manager-table-period-mobile-20261013.png' });
    const revokeAction = await rightMobileAction(table(), '撤銷校正證明 server-calibration');
    await region.screenshot({ path: '/tmp/repair-calibration-manager-table-right-mobile-20261013.png' });
    await page.mouse.click(revokeAction.center.x, revokeAction.center.y);
    const revoke = page.getByRole('dialog', { name: '撤銷此校正證明？', exact: true }); await revoke.waitFor();
    await revoke.getByRole('button', { name: /^取\s*消$/ }).click(); await revoke.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__standardManagerFixture.posts.length), 0);
    mobileTableReceipts.push({ standards, reviewedHeader, reviewAction, calibrations, periodHeader, revokeAction });
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
  writeFileSync('/tmp/repair-standard-manager-mobile-table-receipt-20261013.json', JSON.stringify({ scope: '390px actual local component with existing app CSS; glyph geometry, internal scroll and physical pointer hit checks; no real registry write', mobileTableReceipts, errors, external, writes }, null, 2));
});
