import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require('../../backend/node_modules/playwright')
const executablePath = [chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
const root = fileURLToPath(new URL('../', import.meta.url))

// Dashboard, Layout, workbench pages, help button, route permissions, company
// hook, router and service methods are real. Auth, unrelated widgets, WebSocket
// subscriptions and the API adapter are controlled. No business write reaches
// the network; workbench assertions use only GET controls.
const auth = `
import React,{createContext,useContext} from 'react';
const Context=createContext({user:null,logout:async()=>true});
export const FixtureAuth=Context.Provider;
export const useAuth=()=>useContext(Context);
`
const readPaths = [
  '/reports/dashboard-sales-overview', '/reports/dashboard-executive-overview',
  '/reports/dashboard-operations-hub', '/invoicing/queue', '/reports/order-reconciliation-audit',
  '/ar/monitor', '/reports/management-summary', '/reports/ad-performance-summary',
  '/reports/connector-readiness', '/ap/invoices', '/banking/accounts',
]
const integrationPaths = [
  '/integrations/shopify/sync/orders', '/integrations/shopify/sync/transactions',
  '/integrations/1shop/sync/orders', '/integrations/1shop/sync/transactions',
  '/integrations/shopline/sync/orders', '/integrations/shopline/sync/customers',
  '/integrations/shopline/sync/transactions', '/integrations/meta-ads/sync', '/integrations/google-ads/sync',
]
const writePaths = [...integrationPaths, '/sales/orders/invoice-status-sync']
const api = `
const readPaths=${JSON.stringify(readPaths)},writePaths=${JSON.stringify(writePaths)};
export const API_URL='http://127.0.0.1:0';
const workbenchReadPaths=['/mailroom/items','/mailroom/source-cases','/mailroom/people'];
function unexpected(message) { window.__boundaryErrors.push(message); throw new Error(message); }
function data(path,entityId) {
  const n={'company-A':111000,'company-B':222000,'company-C':333000}[entityId];
  if(!n) return unexpected('Unknown synthetic company: '+entityId);
  const base={entityId,range:{startDate:null,endDate:null}};
  const bucket={key:'shopify',label:'Synthetic '+entityId,gross:n+1,orderCount:1,payoutGross:n+2,
    payoutNet:n+3,feeTotal:1,paymentCount:1,reconciledCount:1,pendingPayoutCount:0};
  switch(path) {
    case '/reports/dashboard-sales-overview': return {...base,buckets:[bucket],total:bucket};
    case '/reports/dashboard-executive-overview': return {...base,
      expenses:{actualSpend:0,actualSpendCount:0,pendingApprovalAmount:0,pendingApprovalCount:0,approvedUnpaidAmount:0,approvedUnpaidCount:0},
      operations:{pendingPayoutCount:0,feeBackfillCount:0},tasks:[],anomalies:[],reconciliationRules:[],
      inventoryAlerts:[{sku:entityId,name:'Synthetic inventory '+entityId,qtyAvailable:2,qtyOnHand:2,severity:'warning'}]};
    case '/reports/dashboard-operations-hub': return {...base};
    case '/invoicing/queue': return {...base,summary:{pendingCount:0,issuedCount:0,issuedAmount:0,voidCount:0,eligibleCount:0,waitingPaymentCount:0,completedOrderCount:0},items:[]};
    case '/reports/order-reconciliation-audit': return {...base,summary:{anomalousOrderCount:0},items:[]};
    case '/ar/monitor': return {...base,summary:{outstandingAmount:n+4,overdueReceivableAmount:0,overdueReceivableCount:0,
      overpaidReceivableAmount:n+5,overpaidReceivableCount:1,missingInvoiceCount:0,missingJournalCount:0},items:[]};
    case '/reports/management-summary': return {...base,groupBy:'day',periods:[],summary:{revenue:n+6,estimatedCogs:100,
      grossProfit:n+7,grossMarginPct:80,payoutNet:n+8,netProfit:n+9,netMarginPct:75,adSpendAmount:0,adSpendCount:0}};
    case '/reports/ad-performance-summary': return {...base,summary:{revenue:n+6,adSpend:0,roas:null,attributionNote:'Synthetic fixture'},brands:[],sources:[],periods:[]};
    case '/reports/connector-readiness': return {...base,summary:{total:1,ready:1,partial:0,blocked:0},connectors:[
      {key:'ad-spend',label:'Synthetic ads',internallyConfigured:true,status:'ready',nextAction:'Synthetic only'}]};
    case '/ap/invoices': return [{id:'synthetic-'+entityId,status:'open',invoiceDate:new Date().toISOString(),amountOriginal:n+10,paidAmountOriginal:0}];
    case '/banking/accounts': return [{id:'synthetic-'+entityId,balance:n+11}];
    default: return unexpected('Unhandled synthetic GET: '+path);
  }
}
export default {
  async get(raw,config={}) {
    const url=new URL(raw,'https://fixture.invalid');
    const entityId=config.params?.entityId || url.searchParams.get('entityId');
    if(workbenchReadPaths.includes(url.pathname)) {
      if(!['company-A','company-B','company-C'].includes(entityId)) return unexpected('Missing workbench company');
      window.__calls.push({method:'GET',path:url.pathname,entityId,params:structuredClone(config.params)});
      return {data:url.pathname==='/mailroom/people'?[]:{items:[],total:0,nextCursor:null}};
    }
    if(!readPaths.includes(url.pathname)) return unexpected('Unexpected API read: '+raw);
    window.__calls.push({method:'GET',path:url.pathname,entityId});
    const behavior=window.__behaviors[entityId] || {};
    if(behavior.hold) await new Promise(resolve=>window.__pending.push({entityId,resolve}));
    if(behavior.failAll || behavior.failPaths?.includes(url.pathname)) throw new Error('Synthetic failure '+entityId+' '+url.pathname);
    return {data:data(url.pathname,entityId)};
  },
  async post(path,body) {
    if(!writePaths.includes(path)) return unexpected('Unexpected API write: '+path);
    window.__calls.push({method:'POST',path,entityId:body.entityId,body:structuredClone(body)});
    return {data:{success:true,fetched:0,created:0,updated:0,synced:0,skipped:0,failed:0}};
  },
};
`
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider,useLocation} from 'react-router-dom';
import DashboardPage from '/src/pages/DashboardPage.tsx';
import DashboardLayout from '/src/components/DashboardLayout.tsx';
import AfterSalesWorkbenchHub from '/src/pages/after-sales/AfterSalesWorkbenchHub.tsx';
import MailroomPage from '/src/pages/mailroom/MailroomPage.tsx';
import RepairWorkbenchPage from '/src/pages/repair/RepairWorkbenchPage.tsx';
import PermissionRoute from '/src/components/PermissionRoute.tsx';
import {CLAW_HELP_EVENT} from '/src/components/claw/state.ts';
import {useEntityContext} from '/src/hooks/useEntityContext.ts';
import {FixtureAuth} from 'virtual:workspace-company-auth';
const e=React.createElement,q=new URLSearchParams(window.location.search);
const mode=q.get('mode') || 'dashboard',start=q.has('missing-company')?'':q.get('company') || 'company-B';
localStorage.clear();if(!q.has('missing-company')) localStorage.setItem('entityId','company-A');
window.__APP_CONFIG__={stagedOperationsEnabled:true,afterSalesModuleEnabled:true,mailroomEnabled:!q.has('disabled'),wmsPortalUrl:''};
window.__calls=[];window.__boundaryErrors=[];window.__behaviors={};window.__pending=[];window.__helpEvents=0;
window.addEventListener(CLAW_HELP_EVENT,()=>window.__helpEvents++);
if(q.get('hold')) window.__behaviors[start]={hold:true};
window.__releaseCompany=(entityId)=>{
  const matches=window.__pending.filter(item=>item.entityId===entityId);
  window.__pending=window.__pending.filter(item=>item.entityId!==entityId);
  matches.forEach(item=>item.resolve());
};
const user={id:'synthetic-manager',name:'Synthetic manager',email:'manager@example.invalid',roles:['WAREHOUSE_SUPERVISOR'],salesDataScope:q.get('scope') || 'ENTITY',
  permissions:['wms_tasks:read','wms_logs:read','wms_picking:execute','profile_self:read','product_cost:read','financial_margin:read','financial_net_profit:read',
    ...(!q.has('denied')?mode==='doa'?['after_sales_cases:read']:mode==='mailroom'?['mailroom:read']:mode==='repair'?['repair_workbench:read']:[]:[])]};
function Current() { const l=useLocation();return e('output',{id:'current-route'},l.pathname+l.search); }
function WarehouseProbe() {const companyId=useEntityContext();return e('output',{id:'warehouse-company'},companyId);}
function Dashboard() {return e(React.Fragment,null,e(Current),e(DashboardPage));}
function Layout() {return e(React.Fragment,null,e(Current),e(DashboardLayout));}
function DoaHub() {return e(AfterSalesWorkbenchHub,{user,section:'workbench',onOpen:section=>router.navigate('/operations/after-sales/'+section+'?entityId='+start)});}
const router=createMemoryRouter(['layout','doa','mailroom','repair'].includes(mode) ? [{path:'/',element:e(Layout),children:[
  {path:'dashboard',element:e('h2',null,'Synthetic operations home')},
  {path:'warehouse',element:e(WarehouseProbe)},
  {path:'warehouse/workstation',element:e(WarehouseProbe)},
  {path:'profile',element:e('h2',null,'Synthetic personal profile')},
  {path:'operations/after-sales/workbench',element:e(DoaHub)},
  {path:'operations/mailroom',element:e(PermissionRoute,{anyPermissions:['mailroom:read']},e(MailroomPage))},
  {path:'operations/repair',element:e(PermissionRoute,{anyPermissions:['repair_workbench:read']},e(RepairWorkbenchPage))},
]}] : mode==='hook' ? [{path:'/warehouse',element:e(React.Fragment,null,e(Current),e(WarehouseProbe))}]
  : [{path:'/dashboard',element:e(Dashboard)}],
  {initialEntries:[(mode==='doa'?'/operations/after-sales/workbench':['mailroom','repair'].includes(mode)?'/operations/'+mode:mode==='hook'?'/warehouse':'/dashboard')+(start?'?entityId='+start:'')]});
window.__navigate=path=>router.navigate(path);
createRoot(document.getElementById('root')).render(e(FixtureAuth,{value:{user,logout:async()=>true}},e(RouterProvider,{router})));
`

async function ephemeralPort() {
  const server = createNetServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

test('actual React pages isolate company snapshots, requests and workspace navigation', {
  skip: !executablePath && 'No existing Chromium; this test never installs a browser', timeout: 90_000,
}, async t => {
  const cache = mkdtempSync(join(tmpdir(), 'corely-workspace-company-dom-'))
  const virtualModules = {
    'virtual:workspace-company-dom': fixture,
    'virtual:workspace-company-auth': auth,
    'virtual:workspace-company-api': api,
    'virtual:workspace-company-widget': 'export default function Widget(){return null;}',
    'virtual:workspace-company-websocket': 'export const webSocketService={subscribe:()=>()=>{}};',
  }
  const aliases = new Map([
    [resolve(root, 'src/contexts/AuthContext'), 'virtual:workspace-company-auth'],
    [resolve(root, 'src/services/api'), 'virtual:workspace-company-api'],
    ...['src/pages/mailroom/InboxShortcut', 'src/components/NotificationCenter',
      'src/components/SettingsDrawer', 'src/components/AICopilotWidget'].map(path =>
      [resolve(root, path), 'virtual:workspace-company-widget']),
    [resolve(root, 'src/services/websocket.service'), 'virtual:workspace-company-websocket'],
  ])
  const server = await createServer({ root, configFile: false, cacheDir: join(cache, 'vite'),
    server: { host: '127.0.0.1', port: await ephemeralPort(), strictPort: true },
    plugins: [react(), {
      name: 'isolated-workspace-company-dom', enforce: 'pre',
      resolveId(id, importer) {
        if (Object.hasOwn(virtualModules, id)) return '\0' + id
        if (importer && (id.startsWith('.') || id.startsWith(root))) {
          const target = resolve(dirname(importer), id).replace(/\.tsx?$/, '')
          const alias = aliases.get(target)
          if (alias) return '\0' + alias
        }
      },
      load(id) { return virtualModules[id.replace(/^\0/, '')] },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__workspace-company') return next()
          try {
            const html = await vite.transformIndexHtml('/__workspace-company', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:workspace-company-dom"></script></body></html>')
            response.setHeader('Content-Type', 'text/html'); response.end(html)
          } catch (error) { next(error) }
        })
      },
    }],
  })
  let browser
  try {
    await server.listen()
    const address = server.httpServer?.address()
    assert(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ executablePath, headless: true })
    async function open(query = '') {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.setDefaultTimeout(10_000)
      const errors = [], external = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== origin) { external.push(url.origin); return route.abort() }
        assert.equal(request.method(), 'GET', 'The fixture prohibits network business writes')
        return route.continue()
      })
      await page.goto(origin + '/__workspace-company' + query)
      await page.waitForFunction(() => document.getElementById('current-route') || document.querySelector('vite-error-overlay'))
      assert.deepEqual(errors, [], 'Real components must mount without React errors')
      assert.equal(await page.locator('vite-error-overlay').count(), 0)
      await page.locator('#current-route').waitFor()
      return { page, errors, external }
    }
    async function healthy(result) {
      assert.deepEqual(result.errors, [])
      assert.deepEqual(result.external, [], 'No external origin may be requested')
      assert.deepEqual(await result.page.evaluate(() => window.__boundaryErrors), [])
      await result.page.close()
    }
    const calls = page => page.evaluate(() => window.__calls)
    const routeTo = (page, path) => page.evaluate(path => window.__navigate(path), path)
    async function ready(page, companyId) {
      await page.getByRole('heading', { name: '營運儀表板', exact: true }).waitFor()
      await page.getByText('Synthetic inventory ' + companyId, { exact: true }).waitFor()
    }
    const assertCompany = (requests, companyId) => {
      assert(requests.length > 0, 'An empty request list cannot establish company isolation')
      assert.deepEqual([...new Set(requests.map(request => request.entityId))], [companyId])
    }

    await t.test('URL company B overrides stored A for every GET and all three manual synchronization controls', async () => {
      const result = await open(), { page } = result
      await ready(page, 'company-B')
      const initial = await calls(page)
      assert.equal(initial.length, 13)
      assert.deepEqual([...new Set(initial.map(request => request.path))].sort(), [...readPaths].sort())
      assertCompany(initial, 'company-B')
      assert.equal(await page.evaluate(() => localStorage.getItem('entityId')), 'company-A')
      await page.getByRole('button', { name: /即時同步$/ }).click()
      await page.waitForFunction(() => window.__calls.filter(item => item.method === 'POST').length === 9)
      assert.deepEqual((await calls(page)).filter(item => item.method === 'POST').map(item => item.path).sort(), [...integrationPaths].sort())
      await ready(page, 'company-B')
      await page.getByRole('button', { name: '同步本區間廣告費', exact: true }).click()
      await page.waitForFunction(() => window.__calls.filter(item => item.method === 'POST').length === 11)
      await ready(page, 'company-B')
      await page.getByRole('button', { name: '同步發票狀態', exact: true }).click()
      await page.waitForFunction(() => window.__calls.some(item => item.path === '/sales/orders/invoice-status-sync'))
      const all = await calls(page)
      assertCompany(all, 'company-B')
      const writes = all.filter(item => item.method === 'POST')
      assert.equal(writes.length, 12)
      assert.deepEqual(writes.slice(9, 11).map(item => item.path).sort(), ['/integrations/google-ads/sync', '/integrations/meta-ads/sync'])
      assert.equal(writes[11].body.limit, 120)
      assert(writes.every(item => Boolean(item.body.since || item.body.startDate)), 'Every manual sync retains the selected range')
      await healthy(result)
    })

    await t.test('query changes immediately hide A; partial B and failed C never reuse another company snapshot', async () => {
      const result = await open('?company=company-A'), { page } = result
      await ready(page, 'company-A')
      assert.match(await page.locator('body').innerText(), /111,010 元/, 'The A payable amount is visible before changing companies')
      await page.evaluate(() => {
        window.__behaviors['company-B'] = { hold: true, failPaths: [
          '/reports/dashboard-executive-overview', '/reports/management-summary', '/ap/invoices', '/banking/accounts',
        ] }
      })
      await routeTo(page, '/dashboard?entityId=company-B')
      await page.waitForFunction(() => document.getElementById('current-route')?.textContent === '/dashboard?entityId=company-B' && window.__pending.length === 13)
      let body = await page.locator('body').innerText()
      assert.doesNotMatch(body, /Synthetic inventory company-A|111,010 元|111,009 元/, 'A must disappear before B requests resolve')
      await page.evaluate(() => window.__releaseCompany('company-B'))
      await page.getByText('儀表板資料未完整載入', { exact: true }).waitFor()
      body = await page.locator('body').innerText()
      assert.match(body, /222,005 元/, 'A successful B receivable block remains usable')
      assert.doesNotMatch(body, /Synthetic inventory company-A|111,010 元|111,009 元|部分資料可能已過期/, 'Partial B is a fresh snapshot, never an A fallback')
      await page.evaluate(() => { window.__behaviors['company-C'] = { failAll: true } })
      await routeTo(page, '/dashboard?entityId=company-C')
      await page.getByText('無法取得核心儀表板資料', { exact: true }).waitFor()
      body = await page.locator('body').innerText()
      assert.doesNotMatch(body, /Synthetic inventory company-A|222,005 元|111,010 元/)
      for (const companyId of ['company-A', 'company-B', 'company-C']) {
        assertCompany((await calls(page)).filter(item => item.entityId === companyId), companyId)
      }
      assert.equal(await page.evaluate(() => localStorage.getItem('entityId')), 'company-A')
      await healthy(result)
    })

    await t.test('late responses from company A cannot overwrite a newer B dashboard', async () => {
      const result = await open('?company=company-A&hold=true'), { page } = result
      await page.waitForFunction(() => window.__pending.length === 13)
      await routeTo(page, '/dashboard?entityId=company-B')
      await ready(page, 'company-B')
      await page.evaluate(async () => {
        window.__releaseCompany('company-A')
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      const body = await page.locator('body').innerText()
      assert.match(body, /Synthetic inventory company-B/)
      assert.doesNotMatch(body, /Synthetic inventory company-A|111,010 元|111,009 元/)
      await healthy(result)
    })

    await t.test('warehouse hook reacts to query B then C, preserving stored-company fallback without rewriting it', async () => {
      const result = await open('?mode=hook'), { page } = result
      assert.equal(await page.locator('#warehouse-company').innerText(), 'company-B')
      await routeTo(page, '/warehouse?entityId=company-C')
      await page.waitForFunction(() => document.getElementById('warehouse-company')?.textContent === 'company-C')
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      assert.equal(await page.locator('#warehouse-company').innerText(), 'company-C')
      assert.equal(await page.evaluate(() => localStorage.getItem('entityId')), 'company-A')
      await routeTo(page, '/warehouse')
      await page.waitForFunction(() => document.getElementById('warehouse-company')?.textContent === 'company-A')
      await page.evaluate(() => { localStorage.setItem('entityId', 'company-B'); window.dispatchEvent(new Event('focus')) })
      await page.waitForFunction(() => document.getElementById('warehouse-company')?.textContent === 'company-B')
      assert.deepEqual(await calls(page), [], 'The company hook does not invent API work')
      await healthy(result)
    })

    await t.test('warehouse manager selection stays in warehouse workspace and sidebar plus command search retain explicit B', async () => {
      const result = await open('?mode=layout'), { page } = result
      await page.getByRole('heading', { name: 'Synthetic operations home', exact: true }).waitFor()
      await page.locator('.ant-select-selector').first().click()
      await page.locator('.ant-select-item-option-content').filter({ hasText: /^儲運工作台$/ }).click()
      await page.waitForFunction(() => document.getElementById('current-route')?.textContent === '/warehouse/workstation?entityId=company-B')
      assert.equal(await page.locator('#warehouse-company').innerText(), 'company-B')
      assert.equal(await page.locator('.ant-select-selection-item').first().innerText(), '儲運工作台', 'The chosen workspace remains active for a manager')
      await page.getByRole('navigation', { name: '主選單', exact: true }).getByRole('menuitem', { name: /個人資料$/ }).click()
      await page.waitForFunction(() => document.getElementById('current-route')?.textContent === '/profile?entityId=company-B')
      await page.keyboard.press('Control+k')
      await page.getByRole('navigation', { name: '功能搜尋結果', exact: true }).getByRole('button', { name: '作業工作站', exact: true }).click()
      await page.waitForFunction(() => document.getElementById('current-route')?.textContent === '/warehouse/workstation?entityId=company-B')
      assert.equal(await page.evaluate(() => localStorage.getItem('entityId')), 'company-A')
      assert.deepEqual(await calls(page), [])
      await healthy(result)
    })

    await t.test('DOA home keeps one accessible page title and all six services on desktop and mobile', async () => {
      const result = await open('?mode=doa'), { page } = result
      const hub = page.getByRole('region', { name: '售後工作台', exact: true })
      await hub.waitFor()
      assert.equal(await hub.getByRole('heading', { name: '售後工作台', exact: true }).count(), 1)
      assert.equal(await page.locator('.operations-header-title').innerText(), '', 'The shell does not repeat the Hub heading')
      assert.equal(await hub.getByRole('list', { name: '售後案件服務', exact: true }).getByRole('button').count(), 6)
      await hub.getByRole('button', { name: /案件總覽$/ }).waitFor()
      assert.equal(await hub.locator('.after-sales-hub-intro, .after-sales-hub-entry-description').count(), 0, 'Static teaching text does not obscure service controls')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: '開啟主選單', exact: true }).click()
      await page.locator('.operations-mobile-drawer').getByRole('navigation', { name: '主選單', exact: true }).waitFor()
      assert.equal(await hub.getByRole('heading', { name: '售後工作台', exact: true }).count(), 1)
      assert.equal(await page.locator('#operations-content').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'The mobile Hub remains inside the content width')
      assert.deepEqual(await calls(page), [], 'Hub entry display introduces no API writes or reads')
      await healthy(result)

      const denied = await open('?mode=doa&scope=SELF')
      await denied.page.getByText('目前帳號沒有此售後功能權限', { exact: true }).waitFor()
      assert.equal(await denied.page.getByRole('heading', { name: '售後工作台', exact: true }).count(), 0)
      assert.equal(await denied.page.locator('.operations-header-title').innerText(), '售後工作台', 'A blocked Hub keeps the shell page name')
      await healthy(denied)
    })

    await t.test('real mailroom and repair pages keep one title, company GET controls, help and mobile navigation', async () => {
      for (const mode of ['mailroom', 'repair']) {
        const title = mode === 'mailroom' ? '收發室工作台' : '維修工作台'
        const result = await open('?mode=' + mode), { page } = result
        const heading = page.getByRole('heading', { name: new RegExp(title + '$') })
        await heading.waitFor()
        assert.equal(await heading.count(), 1)
        assert.equal(await page.locator('.operations-header-title').innerText(), '', 'The shell does not repeat the actual workbench heading')
        await page.getByRole('button', { name: /這頁怎麼用$/ }).click()
        assert.equal(await page.evaluate(() => window.__helpEvents), 1, 'The real help control still dispatches its event')
        await page.getByRole('button', { name: '帳號選單', exact: true }).click()
        await page.locator('.ant-dropdown').getByRole('menuitem', { name: /個人資料$/ }).waitFor()
        await page.getByRole('button', { name: '帳號選單', exact: true }).click()
        await page.getByRole('button', { name: /重新整理$/ }).click()
        if (mode === 'mailroom') {
          await page.getByRole('tab', { name: '售後待到貨案件', exact: true }).click()
          await page.waitForFunction(() => window.__calls.some(call => call.path === '/mailroom/source-cases'))
        } else {
          await page.getByRole('tab', { name: '我的檢修', exact: true }).click()
          await page.waitForFunction(() => window.__calls.some(call => call.params?.repairScope === 'mine'))
          assert.match(await page.locator('#current-route').innerText(), /entityId=company-B/)
        }
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: '開啟主選單', exact: true }).click()
        await page.locator('.operations-mobile-drawer').getByRole('navigation', { name: '主選單', exact: true }).waitFor()
        assert.equal(await heading.count(), 1)
        await page.locator('.operations-mobile-drawer .ant-drawer-close').click()
        await page.getByRole('button', { name: /這頁怎麼用$/ }).click()
        assert.equal(await page.evaluate(() => window.__helpEvents), 2, 'Help stays operable beside the mobile menu')
        const requests = await calls(page)
        assertCompany(requests, 'company-B')
        assert(requests.every(call => call.method === 'GET'), 'Only read controls were exercised')
        await healthy(result)
      }
    })

    await t.test('unavailable workbench headings never erase the shell title or access feedback', async () => {
      for (const mode of ['mailroom', 'repair']) {
        for (const flag of ['denied', 'disabled']) {
          const result = await open('?mode=' + mode + '&' + flag), { page } = result
          if (flag === 'denied') await page.getByText('沒有權限', { exact: true }).waitFor()
          else await page.getByText((mode === 'mailroom' ? '收發室' : '維修') + '工作台尚未啟用', { exact: true }).waitFor()
          assert.equal(await page.locator('#operations-content h2').count(), 0)
          assert.notEqual((await page.locator('.operations-header-title').innerText()).trim(), '', 'The existing shell fallback stays visible')
          await page.getByRole('button', { name: /這頁怎麼用$/ }).click()
          assert.equal(await page.evaluate(() => window.__helpEvents), 1)
          assert.deepEqual(await calls(page), [], 'Blocked pages do not read or write workbench business data')
          await healthy(result)
        }
      }
      const missing = await open('?mode=repair&missing-company'), { page } = missing
      await page.getByText('請先選擇作業公司', { exact: true }).waitFor()
      assert.equal(await page.locator('#operations-content h2').count(), 0)
      assert.equal(await page.locator('.operations-header-title').innerText(), '維修工作台', 'Repair retains its page name until a company is selected')
      assert.deepEqual(await calls(page), [])
      await healthy(missing)
    })
  } finally {
    await browser?.close()
    await server.close()
    rmSync(cache, { recursive: true, force: true })
  }
})
