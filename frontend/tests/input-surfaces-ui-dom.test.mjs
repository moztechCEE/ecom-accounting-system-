import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const baselineSha = '2e2dba74b6e4d7a342c38c5a9c9316d534093eb7';
const baselineCss = execFileSync('git', ['show', `${baselineSha}:frontend/src/index.css`], { cwd: root, encoding: 'utf8' });
const baselineRequested = process.env.INPUT_SURFACES_BASELINE === '1';
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ConfigProvider,Input,Form,Typography} from 'antd';
import RepairDocuments from '/src/pages/repair/RepairDocuments.tsx';
import '/src/pages/repair/repair.css';
await import(new URLSearchParams(location.search).has('baseline')?'/src/index.css?input-surfaces-baseline':'/src/index.css');
const e=React.createElement;
window.__inputSurfaceProbe={blockedCalls:[],dirty:false};
const check={name:'合成功能檢測',result:'PASS',observation:'合成觀察'};
const inspection={number:'SYNTHETIC-INS',revision:2,status:'DRAFT',authorId:'surface-tech',authorName:'合成維修師',
 updatedAt:'2026-10-08T02:00:00Z',data:{complaint:'合成原始故障描述',reproduction:'YES',testConditions:'合成測試條件',checks:[check],
 diagnosis:'合成診斷',causeStatus:'CONFIRMED',plan:'REPAIR',planNote:'合成處理建議',feeSuggestion:'FREE',estimateNote:''}};
const report={number:'SYNTHETIC-REP',revision:1,status:'DRAFT',inspectionRevision:2,authorId:'surface-tech',authorName:'合成維修師',
 updatedAt:'2026-10-08T02:00:00Z',data:{outcome:'REPAIRED',workPerformed:'合成施工記錄',
 parts:[{name:'合成零件',sku:'SYNTHETIC-PART',quantity:1}],laborMinutes:5,checks:[check],qcResult:'PASS',qcNotes:'合成複驗',deliveredAccessories:'合成配件'}};
const readonly=new URLSearchParams(location.search).has('readonly');
const item={id:'surface-item',version:4,status:'INSPECTING',editable:!readonly,repairOwnerId:'surface-tech',custodianId:'surface-tech',
 productName:'合成產品',sku:'SYNTHETIC-SKU',serialNumber:'SYNTHETIC-SN',label:'SYNTHETIC',history:[],
 receipt:{category:'REPAIR',number:'SYNTHETIC-RCPT',sourceCaseId:'synthetic-source',sourceNumber:'SYNTHETIC-CASE'},
 repairInspection:inspection,repairReport:report};
function Harness(){const [count1000,set1000]=useState(''),[count4000,set4000]=useState(''),[autosize,setAutosize]=useState('one');
 const field=(id,label,control)=>e('div',{'data-probe':id,className:'surface-probe-field'},e('label',null,label),control);
 return e(ConfigProvider,{theme:{token:{borderRadius:8,controlHeight:36,controlHeightLG:44,controlHeightSM:28},components:{Input:{controlHeight:36,borderRadius:8},Card:{borderRadiusLG:12}}}},
 e('main',{className:'surface-fixture'},e(Typography.Title,{level:2},'輸入與工作單表面測試'),
 e('section',{className:'surface-probe-grid','aria-label':'共用輸入控制項'},
 field('plain','一般輸入',e(Input,{'aria-label':'一般輸入',defaultValue:'合成文字'})),
 field('affix','圖示與清除',e(Input,{'aria-label':'圖示與清除',prefix:e('span',null,'@'),suffix:e('span',null,'件'),allowClear:true,defaultValue:'合成文字'})),
 field('search','搜尋',e(Input.Search,{'aria-label':'搜尋',allowClear:true,defaultValue:'SYNTHETIC',enterButton:'搜尋'})),
 field('password','密碼',e(Input.Password,{'aria-label':'密碼',defaultValue:'synthetic-only',autoComplete:'off'})),
 field('standalone','無計數多行',e(Input.TextArea,{'aria-label':'無計數多行',rows:2,defaultValue:'合成文字'})),
 field('count1000','計數 1000',e(Input.TextArea,{'aria-label':'計數 1000',rows:2,maxLength:1000,showCount:true,value:count1000,onChange:event=>set1000(event.target.value)})),
 field('count4000','計數 4000',e(Input.TextArea,{'aria-label':'計數 4000',rows:3,maxLength:4000,showCount:true,value:count4000,onChange:event=>set4000(event.target.value)})),
 field('disabled','停用多行',e(Input.TextArea,{'aria-label':'停用多行',rows:2,maxLength:1000,showCount:true,disabled:true,defaultValue:'唯讀保存內容'})),
 field('disabledPlain','停用輸入',e(Input,{'aria-label':'停用輸入',disabled:true,defaultValue:'保存內容'})),
 field('readonly','唯讀多行',e(Input.TextArea,{'aria-label':'唯讀多行',rows:2,maxLength:1000,showCount:true,readOnly:true,defaultValue:'可選取內容'})),
 field('error','錯誤多行',e(Input.TextArea,{'aria-label':'錯誤多行',rows:2,maxLength:1000,showCount:true,status:'error',defaultValue:'請核對'})),
 field('warning','提醒輸入',e(Input,{'aria-label':'提醒輸入',status:'warning',allowClear:true,defaultValue:'提醒內容'})),
 field('autosize','自動高度',e(Input.TextArea,{'aria-label':'自動高度',autoSize:{minRows:2,maxRows:5},maxLength:4000,showCount:true,value:autosize,onChange:event=>setAutosize(event.target.value)}))),
 e('section',{'aria-label':'實際維修工作單',className:'repair-documents-layout'},e('div',{className:'repair-editor-main'},
 e(RepairDocuments,{item,entityId:'synthetic-company',onSaved:()=>{},onDirtyChange:value=>window.__inputSurfaceProbe.dirty=value})))));
}
createRoot(document.getElementById('root')).render(e(Harness));
`;

async function surface(locator) {
  return locator.evaluate(element => {
    const wrapper = element.closest('.ant-input-affix-wrapper');
    const css = value => {
      const style = getComputedStyle(value);
      return { border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        background: style.backgroundColor, radius: style.borderTopLeftRadius, shadow: style.boxShadow,
        color: style.color, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        height: value.getBoundingClientRect().height, width: value.getBoundingClientRect().width,
        borderColor: style.borderTopColor, cursor: style.cursor };
    };
    return { inner: css(element), outer: css(wrapper || element), wrapped: Boolean(wrapper),
      disabled: element.disabled, readonly: element.readOnly };
  });
}

async function settleHeight(locator) {
  // The real common theme transitions height for 300 ms. A first-frame increase
  // is not the completed autoSize result; observe stable native layout instead.
  await locator.evaluate(element => new Promise((resolve, reject) => {
    const start = performance.now();
    let lastHeight = -1, stableFrames = 0;
    const sample = () => {
      const height = element.getBoundingClientRect().height;
      stableFrames = Math.abs(height - lastHeight) < 0.05 ? stableFrames + 1 : 0;
      lastHeight = height;
      if (performance.now() - start >= 350 && stableFrames >= 4) return resolve();
      if (performance.now() - start > 2500) return reject(new Error('Native textarea height did not settle'));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

function assertSingleSurface(value, context) {
  if (value.wrapped) {
    assert.deepEqual(value.inner.border, ['0px', '0px', '0px', '0px'], `${context}: inner control must not draw another border`);
    assert.equal(value.inner.background, 'rgba(0, 0, 0, 0)', `${context}: inner control must not paint another surface`);
    assert.equal(value.inner.shadow, 'none', `${context}: inner control must not draw another shadow`);
  }
  assert.ok(value.outer.border.some(width => Number.parseFloat(width) > 0), `${context}: one visible outer border remains`);
}

test('native Antd controls and actual repair forms have one input surface, semantic states and responsive groups', {
  skip: !executablePath && 'Requires an existing browser; no installation', timeout: 120000,
}, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-input-surfaces-cache-'));
  const evidenceDir = mkdtempSync(join(tmpdir(), 'corely-input-surfaces-evidence-'));
  const observations = {}, pageErrors = [], external = [], networkWrites = [];
  const virtual = '\0input-surfaces-ui-fixture';
  let browser;
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'offline-input-surfaces-ui',
      resolveId(id) { if (id === 'virtual:input-surfaces-ui-fixture') return virtual; },
      load(id) {
        if (id === virtual) return fixture;
        if (id.endsWith('/src/index.css?input-surfaces-baseline')) return baselineCss;
        if (id.endsWith('/src/contexts/AuthContext.tsx')) return `export const useAuth=()=>({user:{id:'surface-tech',roles:[],permissions:['repair_workbench:read','repair_workbench:update']}});`;
        if (id.endsWith('/src/services/api.ts')) return `export const API_URL='/offline-input-surfaces';export default {async get(path){window.__inputSurfaceProbe.blockedCalls.push('GET '+path);throw Error('Unexpected API read')},async post(path){window.__inputSurfaceProbe.blockedCalls.push('POST '+path);throw Error('No writes permitted')}};`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__input-surfaces-ui') return next();
          try {
            const html = await vite.transformIndexHtml('/__input-surfaces-ui', `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
              <style>.surface-fixture{max-width:1120px;margin:auto;padding:24px;min-width:0}.surface-probe-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px 24px;margin-bottom:44px}.surface-probe-field{min-width:0}.surface-probe-field>label{display:block;margin-bottom:8px}.surface-fixture .repair-documents-layout{grid-template-columns:minmax(0,1fr)}@media(max-width:600px){.surface-fixture{padding:16px}.surface-probe-grid{grid-template-columns:minmax(0,1fr)}}</style></head>
              <body><div id="root"></div><script type="module" src="/@id/virtual:input-surfaces-ui-fixture"></script></body></html>`);
            response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }] });
  t.after(async () => {
    writeFileSync(join(evidenceDir, 'measurements.json'), JSON.stringify({ baselineSha, baselineRequested,
      currentIndexBytes: readFileSync(join(root, 'src/index.css')).length, observations, pageErrors, external, networkWrites }, null, 2));
    if (browser) await browser.close();
    await server.close();
    rmSync(cacheDir, { recursive: true, force: true });
    t.diagnostic(`Screenshots and measurements: ${evidenceDir}`);
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const url = `${origin}/__input-surfaces-ui${baselineRequested ? '?baseline=1' : ''}`;
  browser = await chromium.launch({ executablePath, headless: true });
  const pageFor = async (address = url, width = 1280) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) { external.push(request.url()); return route.abort(); }
      if (!['GET', 'HEAD'].includes(request.method())) { networkWrites.push(`${request.method()} ${request.url()}`); return route.abort(); }
      return route.continue();
    });
    await page.goto(address);
    await page.getByRole('textbox', { name: '計數 1000', exact: true }).waitFor();
    return page;
  };

  await t.test('same fixture with frozen 2e CSS reproduces the counted-textarea nested border', async () => {
    const page = await pageFor(`${origin}/__input-surfaces-ui?baseline=1`);
    const current = await surface(page.getByRole('textbox', { name: '計數 4000', exact: true }));
    observations.baseline = current;
    assert.equal(current.wrapped, true);
    assert.ok(current.inner.border.some(width => Number.parseFloat(width) > 0), 'Frozen 2e draws an inner textarea border');
    assert.ok(current.outer.border.some(width => Number.parseFloat(width) > 0), 'Frozen 2e also draws its enclosing wrapper border');
    await page.screenshot({ path: join(evidenceDir, 'baseline-2e-desktop.png'), fullPage: true });
    await page.close();
  });

  await t.test('normal, hover and keyboard focus keep one boundary for counted and affixed controls', async () => {
    const page = await pageFor();
    observations.states = {};
    for (const name of ['圖示與清除', '密碼', '計數 1000', '計數 4000', '唯讀多行', '錯誤多行']) {
      const locator = page.getByRole('textbox', { name, exact: true });
      // Password fields intentionally have no implicit textbox role.
      const control = name === '密碼' ? page.getByLabel(name, { exact: true }) : locator;
      const normal = await surface(control); assertSingleSurface(normal, `${name} normal`);
      await control.hover(); await page.waitForTimeout(350);
      const hover = await surface(control); assertSingleSurface(hover, `${name} hover`);
      await control.focus(); await page.waitForTimeout(350);
      const focus = await surface(control); assertSingleSurface(focus, `${name} focus`);
      assert.notEqual(focus.outer.shadow, 'none', `${name}: a keyboard focus cue remains on the single outer surface`);
      observations.states[name] = { normal, hover, focus };
      await control.blur();
    }
    for (const name of ['一般輸入', '無計數多行', '搜尋']) {
      const control = page.getByLabel(name, { exact: true });
      assertSingleSurface(await surface(control), `${name} normal`);
      await control.hover(); await page.waitForTimeout(350); assertSingleSurface(await surface(control), `${name} hover`);
      await control.focus(); await page.waitForTimeout(350); assertSingleSurface(await surface(control), `${name} focus`);
      await control.blur();
    }
    observations.search = await page.getByLabel('搜尋', { exact: true }).evaluate(element => ({ type: element.type, tag: element.tagName }));
    assert.deepEqual(await page.evaluate(() => window.__inputSurfaceProbe.blockedCalls), []);
    await page.close();
  });

  await t.test('disabled, readonly and validation error remain distinct without duplicate borders', async () => {
    const page = await pageFor();
    const disabled = await surface(page.getByRole('textbox', { name: '停用多行', exact: true }));
    const disabledPlain = await surface(page.getByRole('textbox', { name: '停用輸入', exact: true }));
    const normal = await surface(page.getByRole('textbox', { name: '計數 1000', exact: true }));
    const readonly = await surface(page.getByRole('textbox', { name: '唯讀多行', exact: true }));
    const errorControl = page.getByRole('textbox', { name: '錯誤多行', exact: true });
    const error = await surface(errorControl);
    for (const [name, value] of Object.entries({ disabled, disabledPlain, readonly, error })) assertSingleSurface(value, name);
    assert.equal(disabled.disabled, true); assert.equal(disabledPlain.disabled, true);
    assert.equal(readonly.readonly, true); assert.equal(readonly.disabled, false);
    assert.equal(disabled.outer.cursor, 'not-allowed');
    assert.notEqual(disabled.outer.background, normal.outer.background, 'Disabled has a distinct surface');
    assert.notEqual(error.outer.borderColor, normal.outer.borderColor, 'Error color remains visible');
    await errorControl.focus(); await page.waitForTimeout(350);
    const focusedError = await surface(errorControl);
    assertSingleSurface(focusedError, 'focused error');
    assert.equal(focusedError.outer.borderColor, error.outer.borderColor, 'Focus must not hide the validation error');
    assert.match(focusedError.outer.shadow, /rgba\(255, 77, 79,/, 'Error focus ring keeps the error hue');
    const warningControl = page.getByLabel('提醒輸入', { exact: true });
    const warning = await surface(warningControl);
    await warningControl.focus(); await page.waitForTimeout(350);
    const focusedWarning = await surface(warningControl);
    assertSingleSurface(focusedWarning, 'focused warning');
    assert.equal(focusedWarning.outer.borderColor, warning.outer.borderColor, 'Focus must not hide the warning');
    assert.match(focusedWarning.outer.shadow, /rgba\(250, 173, 20,/, 'Warning focus ring keeps the warning hue');
    observations.semantics = { normal, disabled, disabledPlain, readonly, error, focusedError, warning, focusedWarning };
    await page.close();
  });

  await t.test('counts update and autosize expands and caps actual rendered height', async () => {
    const page = await pageFor();
    for (const [id, name, maximum] of [['count1000', '計數 1000', 1000], ['count4000', '計數 4000', 4000]]) {
      const field = page.locator(`[data-probe="${id}"]`);
      await page.getByRole('textbox', { name, exact: true }).fill('更新三字');
      await field.getByText(`4 / ${maximum}`, { exact: true }).waitFor();
    }
    const textarea = page.getByRole('textbox', { name: '自動高度', exact: true });
    await settleHeight(textarea);
    const initial = await surface(textarea);
    const lineHeight = await textarea.evaluate(element => Number.parseFloat(getComputedStyle(element).lineHeight));
    await textarea.fill(['one', 'two', 'three', 'four'].join('\n'));
    await settleHeight(textarea);
    const expanded = await surface(textarea);
    await textarea.fill(Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n'));
    await settleHeight(textarea);
    const capped = await surface(textarea);
    assert.ok(expanded.inner.height - initial.inner.height >= lineHeight * 1.5, 'Four lines expand by approximately two rows beyond the two-row minimum');
    assert.ok(capped.inner.height - expanded.inner.height >= lineHeight * 0.75, 'Fifth row is allowed');
    assert.ok(capped.inner.height < initial.inner.height * 3, 'Twenty lines do not override the five-row cap');
    assert.ok(await textarea.evaluate(element => element.scrollHeight > element.clientHeight), 'Overflowing content remains scrollable');
    assertSingleSurface(capped, 'autosize');
    observations.autosize = { lineHeight, initial, expanded, capped };
    await page.close();
  });

  await t.test('actual inspection/report fields and repeated check/part groups avoid outlined nesting', async () => {
    const page = await pageFor();
    const inspection = page.locator('form#repair-inspection-surface-item');
    await inspection.waitFor();
    for (const name of ['客訴／故障描述', '測試條件／設備／參考基準', '診斷與原因判斷', '建議方案與處理範圍', '估價項目／範圍／費用說明', '觀察結果／量測值／未測原因']) {
      assertSingleSurface(await surface(inspection.getByLabel(name, { exact: true })), `actual inspection ${name}`);
    }
    await page.getByRole('tab', { name: '維修單', exact: true }).click();
    const report = page.locator('form#repair-report-surface-item');
    const work = report.getByLabel('實際施工／替換內容', { exact: true });
    await work.fill('更新實際施工');
    await work.locator('..').getByText('6 / 4000', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__inputSurfaceProbe.dirty), true);
    for (const name of ['實際施工／替換內容', '複驗說明與異常', '交付配件（沒有也請註明）', '觀察結果／量測值／未測原因']) {
      assertSingleSurface(await surface(report.getByLabel(name, { exact: true })), `actual report ${name}`);
    }
    const groups = await report.locator('.repair-document-check, .repair-document-part').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element); return { className: element.className, borderWidth: style.borderTopWidth,
        shadow: style.boxShadow, heading: element.querySelector('.ant-card-head-title')?.textContent,
        width: element.getBoundingClientRect().width };
    }));
    assert.equal(groups.length, 2, 'Actual report contains one check and one part group');
    for (const group of groups) { assert.equal(group.borderWidth, '0px', `${group.heading}: inner group is not another outlined card`); assert.equal(group.shadow, 'none'); }
    observations.actualGroups = groups;
    await page.screenshot({ path: join(evidenceDir, 'current-desktop.png'), fullPage: true });
    await page.close();
  });

  await t.test('readonly actual repair and narrow screens preserve content, counters and fit', async () => {
    const readonlyUrl = `${url}${url.includes('?') ? '&' : '?'}readonly=1`;
    const page = await pageFor(readonlyUrl, 390);
    await page.getByText('唯讀：需本人簽收與編輯權限。', { exact: true }).waitFor();
    const inspection = page.locator('form#repair-inspection-surface-item');
    assert.equal(await inspection.getByLabel('客訴／故障描述', { exact: true }).isDisabled(), true);
    assertSingleSurface(await surface(inspection.getByLabel('客訴／故障描述', { exact: true })), 'actual readonly complaint');
    await page.getByRole('tab', { name: '維修單', exact: true }).click();
    const report = page.locator('form#repair-report-surface-item');
    assert.equal(await report.getByLabel('實際施工／替換內容', { exact: true }).isDisabled(), true);
    const overflow = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll('.surface-probe-field,.repair-editor-main,.repair-document-check,.repair-document-part,textarea.ant-input')]
        .filter(element => element.getClientRects().length && element.getBoundingClientRect().right > innerWidth + 1)
        .map(element => ({ className: element.className, right: element.getBoundingClientRect().right })) }));
    assert.ok(overflow.documentWidth <= overflow.width + 1, 'Document fits narrow viewport');
    assert.deepEqual(overflow.offenders, [], 'Visible fields and groups fit narrow viewport');
    observations.mobile = overflow;
    await page.screenshot({ path: join(evidenceDir, 'current-readonly-mobile.png'), fullPage: true });
    assert.deepEqual(await page.evaluate(() => window.__inputSurfaceProbe.blockedCalls), []);
    await page.close();
  });
  assert.deepEqual(pageErrors, []); assert.deepEqual(external, []); assert.deepEqual(networkWrites, []);
});
