import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const { chromium } = require('../../backend/node_modules/playwright')
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)
const root = fileURLToPath(new URL('../', import.meta.url))
const actor = { id: 'clerk-a', roles: ['EMPLOYEE'], permissions: ['mailroom:read', 'mailroom:update', 'inventory:update'] }
const source = { id: 'source-a', number: 'SYNTHETIC-CASE-A', type: 'RESHIPMENT', version: '2026-10-13T00:00:00.000Z', sourceChannel: 'LINE', brand: 'MOZTECH', customerLabel: 'Synthetic recipient', dispatchAllowed: true, blockReason: null,
  items: [{ id: 'line-a', name: 'Synthetic product A', sku: 'SKU-A', quantity: 3, dispatchedQuantity: 1 }, { id: 'line-b', name: 'Synthetic product B', sku: 'SKU-B', quantity: 2, dispatchedQuantity: 0 }], recipient: { name: 'Synthetic recipient', phone: '0900000000', address: 'Synthetic address' } }
const pendingOrder = { id: 'order-a', entityId: 'entity-a', sourceCaseId: source.id, sourceNumber: source.number, caseType: source.type, sourceVersion: source.version, status: 'PENDING_PICK', version: 1, location: null, custodianId: null, custodianName: null, nextUserId: null, nextUserName: null,
  items: [{ unitId: 'unit-a', sourceCaseItemId: 'line-a', productName: 'Synthetic product A', sku: 'SKU-A', quantity: 1 }], outboundShipment: null, sourceSync: { status: 'NOT_DISPATCHED', attempts: 0 }, availableActions: ['prepare', 'cancel'] }
const readyOrder = { ...pendingOrder, status: 'READY_FOR_DISPATCH', version: 3, custodianId: actor.id, custodianName: 'Synthetic clerk', location: 'OUT-A1', availableActions: ['dispatch'], items: [{ ...pendingOrder.items[0], productId: 'erp-a', warehouseId: 'warehouse-a', serialNumber: 'SN-A', postingId: 'posting-a' }] }
const auth = `import {createContext,useContext} from 'react';export const FixtureAuth=createContext({user:null});export const useAuth=()=>useContext(FixtureAuth);`
const api = `
export const API_URL=location.origin+'/api';
const state=window.outboundFixture={order:window.outboundInitial.order,source:window.outboundInitial.source,calls:[],posts:[],errors:[],drafts:[]};
export default {async get(path,options={}){
 const p=options.params||{};state.calls.push({path,params:p});
 if(path==='/mailroom/outbound/orders')return {data:{items:state.order&&state.order.entityId===p.entityId?[structuredClone(state.order)]:[],total:state.order?1:0}};
 if(path.startsWith('/mailroom/outbound/orders/'))return {data:structuredClone(state.order)};
 if(path==='/mailroom/outbound/source-orders')return {data:{items:[structuredClone(state.source)],nextCursor:null}};
 if(path==='/mailroom/outbound/warehouses')return {data:{items:[{id:'warehouse-a',entityId:'entity-a',code:'W-A',name:'Synthetic warehouse'}]}};
 if(path==='/mailroom/people')return {data:[{id:'clerk-a',name:'Synthetic clerk',employeeNo:'S001',department:'行政部',mailroom:true,repair:false}]};
 if(path==='/mailroom/product-options')return {data:{items:[{id:'wrong-product',name:'Wrong product',sku:'SKU-OTHER',hasSerialNumbers:false},{id:'erp-a',name:'ERP product A',sku:'SKU-A',hasSerialNumbers:true}]}};
 if(path==='/mailroom/storage')return {data:{racks:[{id:'out',name:'寄件架',zone:'OUTBOUND',isActive:true},{id:'in',name:'收件架',zone:'INBOUND',isActive:true}],locations:[{rackId:'out',code:'OUT-A1',name:'OUT-A1',isActive:true},{rackId:'in',code:'IN-A1',name:'IN-A1',isActive:true}]}};
 state.errors.push(path);throw Error('Unplanned GET '+path);
}};
`
const fixture = `
import React,{useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';
import {FixtureAuth} from '/src/contexts/AuthContext.tsx';import OutboundWorkbench from '/src/pages/mailroom/OutboundWorkbench.tsx';import '/src/index.css';import '/src/pages/mailroom/mailroom.css';
function Harness(){const [user,setUser]=useState(window.outboundInitial.user),[entityId,setEntity]=useState('entity-a'),[epoch,setEpoch]=useState(0);
 const draft=useCallback(value=>{window.outboundFixture.drafts.push(value);},[]);
 window.outboundHarness={remount:()=>setEpoch(value=>value+1),switchActor:next=>{localStorage.setItem('access_token',window.fixtureToken(next.id));setUser(next);},switchEntity:setEntity};
 return React.createElement(FixtureAuth.Provider,{value:{user}},React.createElement('output',{id:'session-scope'},user.id+' / '+entityId),React.createElement('main',{className:'mailroom-page',style:{padding:16}},React.createElement(OutboundWorkbench,{key:user.id+entityId+epoch,entityId,onDraftChange:draft,initialOrderId:window.outboundInitial.initialOrderId})));
}createRoot(document.getElementById('root')).render(React.createElement(Harness));
`

test('actual outbound React/Ant/axios workflow is scoped, quantity-aware and replays unknown dispatch safely', { skip: !executablePath && 'An existing browser is required; no browser download', timeout: 120000 }, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-outbound-dom-')), virtual = '\0outbound-fixture'
  const server = await createServer({ root, cacheDir, configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'synthetic-outbound-boundaries', resolveId(id) { if (id === 'virtual:outbound-fixture') return virtual },
    load(id) { if (id === virtual) return fixture; if (id.endsWith('/src/contexts/AuthContext.tsx')) return auth; if (id.endsWith('/src/services/api.ts')) return api },
    configureServer(vite) { vite.middlewares.use(async (request, response, next) => { if (request.url !== '/__outbound') return next(); try { response.setHeader('Content-Type', 'text/html'); response.end(await vite.transformIndexHtml('/__outbound', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:outbound-fixture"></script></body></html>')) } catch (e) { next(e) } }) },
  }] })
  let browser, posts = 0
  try {
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    browser = await chromium.launch({ executablePath, headless: true })
    async function open(options = {}) {
      const page = await browser.newPage({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1200, height: 1000 } }); page.setDefaultTimeout(10000)
      const errors = [], external = [], requests = []; let failDispatch = options.failDispatch, release, held
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== origin) { external.push(url.href); return route.abort() }
        if (request.method() === 'GET') return route.continue()
        if (request.method() !== 'POST' || !url.pathname.startsWith('/api/mailroom/outbound/orders')) { external.push(request.method() + url.href); return route.abort() }
        const raw = request.postData(), body = JSON.parse(raw); requests.push({ raw, body, authorization: request.headers().authorization }); posts++
        const result = await page.evaluate(({ body, template }) => {
          const state = window.outboundFixture, previous = state.posts.find(item => item.requestId === body.requestId); state.posts.push(body)
          if (!previous) {
            if (body.sourceCaseId) state.order = structuredClone(template)
            else if (body.action === 'prepare') state.order = { ...state.order, version: 2, status: 'WAITING_MAILROOM_ACCEPTANCE', location: body.location, custodianId: 'clerk-a', custodianName: 'Synthetic clerk', nextUserId: body.nextUserId, nextUserName: 'Synthetic clerk', items: state.order.items.map((item, index) => ({ ...item, ...body.items[index], postingId: 'posting-a' })), availableActions: ['accept'] }
            else if (body.action === 'accept') state.order = { ...state.order, version: 3, status: 'READY_FOR_DISPATCH', location: body.location, custodianId: 'clerk-a', nextUserId: null, availableActions: ['dispatch'] }
            else if (body.action === 'dispatch') state.order = { ...state.order, version: 4, status: 'DISPATCHED', outboundShipment: { carrier: body.carrier, trackingNumber: body.trackingNumber, dispatchedAt: '2026-10-13T00:30:00.000Z' }, sourceSync: { status: 'PENDING', attempts: 0 }, availableActions: ['retry_sync'] }
          }
          return structuredClone(state.order)
        }, { body, template: pendingOrder })
        if (options.holdDispatch && body.action === 'dispatch' && requests.length === 1) { held = true; await new Promise(resolve => { release = resolve }) }
        if (failDispatch && body.action === 'dispatch') { failDispatch = false; return route.fulfill({ status: 503, json: { message: 'Synthetic lost response' } }) }
        try { await route.fulfill({ status: 200, json: result }) } catch { /* aborted old actor request */ }
      })
      await page.addInitScript(value => {
        window.fixtureToken = id => 'header.' + btoa(JSON.stringify({ sub: id })).replace(/=/g, '') + '.signature'
        localStorage.setItem('access_token', window.fixtureToken(value.user.id)); window.outboundInitial = value
      }, { user: actor, source, ...options })
      await page.goto(origin + '/__outbound'); await page.locator('#session-scope').waitFor()
      return { page, errors, external, requests, held: () => held, release: () => release?.() }
    }
    async function clean(f) { const unexpected = await f.page.evaluate(() => window.outboundFixture.errors); assert.deepEqual(unexpected, []); assert.deepEqual(f.errors, []); assert.deepEqual(f.external, []); await f.page.close() }
    async function choose(page, control, option) { await control.focus(); await control.press('ArrowDown'); await page.locator('.ant-select-dropdown:visible').getByText(option, { exact: true }).click() }
    const drawer = page => page.locator('.ant-drawer-content')
    const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const journals = page => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('corely.mailroom.outbound.pending.v1')).map(key => JSON.parse(sessionStorage.getItem(key))))

    await t.test('partial source create → actual ERP stock selection → named clerk acceptance → carrier dispatch', async () => {
      const f = await open({ failDispatch: true }), { page } = f
      await page.getByRole('button', { name: '建立出貨', exact: true }).click()
      await choose(page, page.getByRole('combobox', { name: '搜尋待出貨售後案件' }), 'SYNTHETIC-CASE-A · Synthetic recipient · 補寄')
      await page.getByRole('spinbutton', { name: 'Synthetic product A本次出貨數量' }).fill('1')
      await page.getByRole('spinbutton', { name: 'Synthetic product B本次出貨數量' }).fill('0')
      await page.getByRole('button', { name: '建立本次出貨', exact: true }).click()
      await page.getByRole('button', { name: '正式出庫並交收發', exact: true }).waitFor()
      assert.deepEqual(f.requests[0].body.lines, [{ sourceCaseItemId: 'line-a', quantity: 1 }])
      await choose(page, page.getByRole('combobox', { name: '搜尋實收產品' }), 'Wrong product')
      await drawer(page).getByText('實際產品 SKU 須與售後品項一致', { exact: true }).waitFor()
      await choose(page, page.getByRole('combobox', { name: '搜尋實收產品' }), 'ERP product A')
      await choose(page, drawer(page).getByLabel('出庫倉庫'), 'W-A · Synthetic warehouse')
      await drawer(page).getByLabel('SN', { exact: true }).fill('SN-A')
      await choose(page, page.getByRole('combobox', { name: '收發點收人', exact: true }), '行政部 · Synthetic clerk · S001')
      await page.getByRole('combobox', { name: '選擇寄件儲位' }).click(); assert.equal(await page.locator('.ant-select-dropdown:visible').getByText(/IN-A1/).count(), 0)
      await page.locator('.ant-select-dropdown:visible').getByText('OUT-A1 · 寄件架', { exact: true }).click()
      await page.getByRole('checkbox', { name: '已核對實際產品、數量與 SN' }).check()
      await page.getByRole('button', { name: '正式出庫並交收發', exact: true }).click()
      await page.getByRole('button', { name: '本人確認點收', exact: true }).waitFor()
      assert.deepEqual(f.requests[1].body.items, [{ unitId: 'unit-a', productId: 'erp-a', warehouseId: 'warehouse-a', sku: 'SKU-A', serialNumber: 'SN-A' }])
      assert.equal(f.requests[1].body.nextUserId, 'clerk-a')
      await page.getByRole('checkbox', { name: '已收到並核對本次實物' }).check(); await page.getByRole('button', { name: '本人確認點收', exact: true }).click()
      await page.getByRole('button', { name: '登記交物流', exact: true }).waitFor()
      await drawer(page).getByLabel('物流公司', { exact: true }).fill('Synthetic carrier'); await drawer(page).getByLabel('寄出單號', { exact: true }).fill('SYNTHETIC-TRACK-A')
      await page.getByRole('checkbox', { name: '已核對並將本次實物交給物流' }).check(); await page.getByRole('button', { name: '登記交物流', exact: true }).click()
      await drawer(page).getByText('原操作結果待確認', { exact: true }).waitFor()
      const journal = await journals(page); assert.equal(journal.length, 1)
      await page.evaluate(() => window.outboundHarness.remount()); await drawer(page).getByText('已交物流', { exact: true }).first().waitFor()
      assert.deepEqual(await journals(page), journal, 'A newer GET cannot clear an unknown original command')
      await drawer(page).getByRole('button', { name: '重試原操作', exact: true }).click(); await page.getByRole('button', { name: '重送售後同步', exact: true }).waitFor()
      assert.equal(f.requests[3].raw, f.requests[4].raw, 'Unknown dispatch retries identical UUID and serialized bytes')
      assert.equal(f.requests[4].body.expectedVersion, 3); assert.equal(f.requests[4].body.trackingNumber, 'SYNTHETIC-TRACK-A'); assert.deepEqual(await journals(page), [])
      assert.equal(f.requests.filter(request => request.body.action === 'prepare').length, 1)
      await clean(f)
    })
    await t.test('mailroom-only cannot issue OUT; stock-only cannot create; other person cannot accept or dispatch', async () => {
      for (const [user, order, absent] of [
        [{ ...actor, permissions: ['mailroom:read', 'mailroom:update'] }, pendingOrder, '正式出庫並交收發'],
        [{ ...actor, permissions: ['mailroom:read', 'inventory:update'] }, pendingOrder, '建立出貨'],
        [{ ...actor, id: 'clerk-other' }, { ...pendingOrder, status: 'WAITING_MAILROOM_ACCEPTANCE', version: 2, nextUserId: actor.id, availableActions: ['accept'] }, '本人確認點收'],
        [{ ...actor, id: 'clerk-other' }, readyOrder, '登記交物流'],
      ]) {
        const f = await open({ user, order, initialOrderId: order.id }); await drawer(f.page).getByText('目前進度', { exact: true }).waitFor(); await settle(f.page)
        assert.equal(await f.page.getByRole('button', { name: absent, exact: true }).count(), 0); assert.equal(f.requests.length, 0); await clean(f)
      }
    })
    await t.test('changed token refuses unsent mutation before creating a journal', async () => {
      const f = await open({ order: readyOrder, initialOrderId: readyOrder.id }), { page } = f
      await page.getByRole('button', { name: '登記交物流', exact: true }).waitFor()
      await drawer(page).getByLabel('物流公司', { exact: true }).fill('Synthetic'); await drawer(page).getByLabel('寄出單號', { exact: true }).fill('SYNTHETIC-CHANGE')
      await page.getByRole('checkbox', { name: '已核對並將本次實物交給物流' }).check()
      await page.evaluate(() => localStorage.setItem('access_token', window.fixtureToken('different-actor')))
      await page.getByRole('button', { name: '登記交物流', exact: true }).click(); try { await drawer(page).getByText('登入狀態已變更，請重新登入後核對原操作', { exact: true }).waitFor() } catch(e) { t.diagnostic(await page.locator('body').innerText()); throw e }
      assert.equal(f.requests.length, 0); assert.deepEqual(await journals(page), []); await clean(f)
    })
    await t.test('an actor switch aborts the old reply and preserves only that actor’s original operation for replay', async () => {
      const f = await open({ order: readyOrder, initialOrderId: readyOrder.id, holdDispatch: true }), { page } = f
      await page.getByRole('button', { name: '登記交物流', exact: true }).waitFor()
      await drawer(page).getByLabel('物流公司', { exact: true }).fill('Synthetic'); await drawer(page).getByLabel('寄出單號', { exact: true }).fill('SYNTHETIC-SWITCH')
      await page.getByRole('checkbox', { name: '已核對並將本次實物交給物流' }).check(); await page.getByRole('button', { name: '登記交物流', exact: true }).click()
      await page.waitForFunction(() => window.outboundFixture.posts.length === 1); const original = await journals(page); assert.equal(original.length, 1)
      await page.evaluate(next => window.outboundHarness.switchActor(next), { ...actor, id: 'clerk-other' }); await page.getByText('clerk-other / entity-a', { exact: true }).waitFor(); await drawer(page).getByText('目前進度', { exact: true }).waitFor()
      assert.equal(await drawer(page).getByText('原操作結果待確認', { exact: true }).count(), 0); assert.deepEqual(await journals(page), original); assert.equal(f.requests.length, 1)
      f.release(); await settle(page)
      await page.evaluate(next => window.outboundHarness.switchActor(next), actor); await drawer(page).getByText('原操作結果待確認', { exact: true }).waitFor()
      await drawer(page).getByRole('button', { name: '重試原操作', exact: true }).click(); await page.getByRole('button', { name: '重送售後同步', exact: true }).waitFor()
      assert.equal(f.requests[0].raw, f.requests[1].raw); assert.equal(f.requests[0].authorization, f.requests[1].authorization); assert.deepEqual(await journals(page), []); await clean(f)
    })
    await t.test('390px workbench and actual dispatch fields keep one input surface and a contained Drawer', async () => {
      const f = await open({ mobile: true, order: readyOrder, initialOrderId: readyOrder.id }), { page } = f
      await page.getByRole('button', { name: '登記交物流', exact: true }).waitFor(); await page.locator('.ant-drawer-content-wrapper').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))))
      const geometry = await page.evaluate(() => {
        const body = document.querySelector('.ant-drawer-body'), head = document.querySelector('.ant-card-head')
        return { page: [document.documentElement.clientWidth, document.documentElement.scrollWidth], drawer: [body.clientWidth, body.scrollWidth], header: [head.clientWidth, head.scrollWidth], nestedInputs: [...document.querySelectorAll('.ant-input-affix-wrapper > .ant-input')].filter(input => Number.parseFloat(getComputedStyle(input).borderWidth) > 0).length }
      })
      t.diagnostic(JSON.stringify(geometry)); assert.ok(geometry.page[1] <= geometry.page[0] + 1); assert.ok(geometry.drawer[1] <= geometry.drawer[0] + 1); assert.ok(geometry.header[1] <= geometry.header[0] + 1); assert.equal(geometry.nestedInputs, 0)
      assert.equal(f.requests.length, 0); await clean(f)
    })
    t.diagnostic(`${posts} synthetic POSTs through real axios; no external request, no real Source/ERP/DB command`)
  } finally { if (browser) await browser.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }) }
})
