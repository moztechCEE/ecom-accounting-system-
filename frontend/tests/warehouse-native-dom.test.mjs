import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.WAREHOUSE_PLAYWRIGHT_MODULE || '../../backend/node_modules/playwright')
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)
const root = fileURLToPath(new URL('../', import.meta.url))
const wmsOrigin = 'https://corely-wms-dev-sp5g377smq-de.a.run.app'
const sha = 'a'.repeat(40)
const manifest = { version: 1, sourceCommit: sha, entry: '/assets/workspace-dom-fixture.js', styles: ['/assets/workspace-dom-fixture.css'], portalStyles: ['/assets/portal-dom-fixture.css'] }
const auth = `
import {createContext,useContext} from 'react';
const Context=createContext({user:null,refreshCurrentUser:async()=>null});
export const FixtureAuth=Context.Provider;
export const useAuth=()=>useContext(Context);
`
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider,useLocation} from 'react-router-dom';
import WarehouseWorkspacePage from '/src/pages/WarehouseWorkspacePage.tsx';
import WarehousePortalPage from '/src/pages/WarehousePortalPage.tsx';
import {FixtureAuth} from 'virtual:warehouse-native-auth';
const e=React.createElement;
window.__APP_CONFIG__={wmsPortalUrl:${JSON.stringify(wmsOrigin)},devEnvironment:true};
localStorage.clear();localStorage.setItem('entityId','warehouse-A');localStorage.setItem('access_token','erp-token-operator-A');
window.__sdkRecords=[];window.__sdkHosts=[];window.__windowOpens=0;window.__refreshes=0;
window.__stationRole=new URLSearchParams(location.search).get('station')||'admin';
window.__holdMount=new URLSearchParams(location.search).has('hold');
window.open=()=>{window.__windowOpens++;throw Error('Unexpected external workbench window');};
function Current(){const value=useLocation();return e('output',{id:'current-route'},value.pathname+value.search);}
const routes=[{path:'/warehouse',element:e(React.Fragment,null,e(Current),e(WarehouseWorkspacePage))},
{path:'/warehouse/:report',element:e(React.Fragment,null,e(Current),e(WarehousePortalPage))},
{path:'/profile',element:e(React.Fragment,null,e(Current),e('h1',null,'Synthetic profile'))}];
const router=createMemoryRouter(routes,{initialEntries:['/warehouse?entityId=warehouse-A']});
window.__routeTo=path=>router.navigate(path);window.__routeBack=()=>router.navigate(-1);
function Harness(){
const [user,setUser]=useState({id:'operator-A',name:'Synthetic operator',roles:window.__stationRole==='admin'?['ADMIN']:window.__stationRole==='superadmin'?['SUPER_ADMIN']:['STAFF'],permissions:['admin','superadmin'].includes(window.__stationRole)?[]:window.__stationRole==='csr'?['wms_tasks:read']:['wms_tasks:read',window.__stationRole==='picker'?'wms_picking:execute':'wms_packing:execute']});
window.__changeActor=id=>{localStorage.setItem('access_token','erp-token-'+id);setUser({...user,id});};
return e(FixtureAuth,{value:{user,refreshCurrentUser:async()=>{window.__refreshes++;return user;}}},e(RouterProvider,{router}));
}
createRoot(document.getElementById('root')).render(e(Harness));
`
// Only the module facade is synthetic. The host pages, company hook, module
// loader, manifest validation, session request and HTTP transport are real.
const sdk = `
export const sourceCommit=${JSON.stringify(sha)};
export async function mountWorkspace(container,host){
const shadow=container.shadowRoot||container.attachShadow({mode:'open'});
const element=document.createElement('section');shadow.appendChild(element);
const record={actor:host.session.user.erpSubject,entityId:host.session.user.entityId,path:host.initialPath,disposed:false,navigations:[],aborted:false};
window.__sdkRecords.push(record);window.__sdkHosts.push(host);
host.signal.addEventListener('abort',()=>{record.aborted=true;},{once:true});
const draw=path=>{
record.path=path;element.innerHTML='<h2>SDK 作業 '+path+'</h2><button id="sdk-order">模組訂單</button><button id="sdk-home">模組返回工作台</button><button id="sdk-expire">模組逾時</button><button id="sdk-command">測試一次作業</button><output id="sdk-command-result"></output>';
element.querySelector('#sdk-order').onclick=()=>host.navigate('/order/17',{replace:false});
element.querySelector('#sdk-home').onclick=()=>host.navigate('/tasks',{replace:false});
element.querySelector('#sdk-expire').onclick=()=>host.onAuthRequired();
element.querySelector('#sdk-command').onclick=async()=>{try{await host.transport({url:'/api/orders/update_item',method:'post',data:{commandId:'TEST-original-uuid',state:'picking',expectedActor:41},headers:{Authorization:'Bearer '+host.session.accessToken,'Content-Type':'application/json'},validateStatus:status=>status>=200&&status<300});}catch(error){window.__lastCommandError={code:error.response?.data?.code,name:error.name,message:error.message};element.querySelector('#sdk-command-result').textContent=error.response?.data?.code||error.name;}};
};draw(host.initialPath);
const handle={navigate(path){record.navigations.push(path);draw(path);},dispose(){if(record.disposed)return;record.disposed=true;element.remove();}};
if(window.__holdMount)await new Promise(resolve=>{window.__releaseMount=resolve;});
return handle;
}
`

test('real warehouse host stays in one browser and retires old identity, company, route and expired work sessions', {
  skip: !executablePath && 'No existing Chrome; this test does not install a browser', timeout: 90_000,
}, async t => {
  const cache = mkdtempSync(join(tmpdir(), 'corely-warehouse-native-dom-'))
  const modules = { 'virtual:warehouse-native-fixture': fixture, 'virtual:warehouse-native-auth': auth }
  const server = await createServer({ root, configFile: false, cacheDir: join(cache, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [react(), { name: 'offline-native-warehouse-host', enforce: 'pre',
      resolveId(id, importer) {
        if (Object.hasOwn(modules, id)) return '\0' + id
        if (importer && id.startsWith('.') && resolve(dirname(importer), id).replace(/\.tsx?$/, '') === resolve(root, 'src/contexts/AuthContext')) return '\0virtual:warehouse-native-auth'
      },
      load(id) { return modules[id.replace(/^\0/, '')] },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__warehouse-native') return next()
          try {
            const html = await vite.transformIndexHtml('/__warehouse-native', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:warehouse-native-fixture"></script></body></html>')
            response.setHeader('Content-Type', 'text/html'); response.end(html)
          } catch (error) { next(error) }
        })
      },
    }],
  })
  let browser
  try {
    await server.listen()
    const address = server.httpServer.address(), origin = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ executablePath, headless: true })
    async function open(query = '') {
      const context = await browser.newContext(), page = await context.newPage(), errors = [], calls = [], deniedNetwork = []
      let accessCalls = 0, releaseRecovery, recoveryStartedResolve
      const recoveryStarted = new Promise(resolve => { recoveryStartedResolve = resolve })
      const recoveryGate = new Promise(resolve => { releaseRecovery = resolve })
      page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message))
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname
        const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) })
        if (url.origin === wmsOrigin) {
          if (request.method() === 'GET' && path === '/workspace-manifest.json') return json(manifest)
          if (request.method() === 'GET' && path === manifest.entry) return route.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: sdk })
          deniedNetwork.push(request.method() + ' ' + url.href); return route.abort()
        }
        if (url.origin !== origin) { deniedNetwork.push(request.method() + ' ' + url.href); return route.abort() }
        if (!path.startsWith('/api/v1/')) {
          assert.equal(request.method(), 'GET'); return route.continue()
        }
        calls.push({ method: request.method(), path, headers: request.headers(), body: request.postData() ? request.postDataJSON() : null })
        if (path === '/api/v1/wms/portal/access' && request.method() === 'GET') {
          accessCalls++
          const params = new URLSearchParams(query), actor = request.headers().authorization?.replace('Bearer erp-token-', ''), station = params.get('station') || 'admin'
          if (accessCalls > 1 && params.has('access-denied')) return json({ message: '沒有此儲運公司的存取權限' }, 403)
          if (accessCalls > 1 && params.has('access-disabled')) return json({ message: '儲運統一登入尚未啟用' }, 503)
          if (accessCalls > 1 && params.has('access-expired')) return json({ message: 'Unauthorized' }, 401)
          if (accessCalls > 1 && actor === 'operator-B' && params.has('new-actor-denied')) return json({ message: '沒有此儲運公司的存取權限' }, 403)
          if (accessCalls === 2 && params.has('hold-recovery')) { recoveryStartedResolve(); await recoveryGate }
          return json({ userId: accessCalls > 1 && params.has('wrong-actor') ? 'other-actor' : actor,
            entityId: accessCalls > 1 && params.has('invalid-company') ? 'warehouse-A?admin=true' : 'warehouse-A',
            admin: ['admin', 'superadmin'].includes(station),
            permissions: accessCalls > 1 && params.has('grant-removed') ? [] : ['wms_tasks:read', station === 'picker' ? 'wms_picking:execute' : station === 'packer' ? 'wms_packing:execute' : 'wms_orders:create'],
            roles: station === 'csr' ? [] : ['picker', 'packer', 'dispatcher'] })
        }
        if (path === '/api/v1/wms/native/session' && request.method() === 'POST') {
          const body = request.postDataJSON(), actor = request.headers().authorization?.replace('Bearer erp-token-', '')
          assert.match(body.nonce, /^[a-f0-9]{64}$/); assert.equal(body.entityId, request.headers()['x-wms-entity'])
          if (new URLSearchParams(query).has('permission-denied')) return json({ message: 'Missing permissions: [wms_orders:create]' }, 403)
          if (body.entityId !== 'warehouse-A') return json({ message: 'WMS_NATIVE_ENTITY_MISMATCH' }, 403)
          const selectedStation = new URLSearchParams(query).get('station') || 'admin', stationRole = selectedStation === 'superadmin' ? 'admin' : selectedStation
          return json({ accessToken: 'synthetic.wms.session', destination: body.entry === 'marketplace' ? '/admin/marketplace-converter' : body.entry === 'picking' ? '/tasks?group=pick' : body.entry === 'packing' ? '/tasks?group=pack' : body.entry === 'intakes' ? '/warehouse-intakes' : '/tasks',
            user: { id: 41, role: stationRole, erpSubject: actor, entityId: body.entityId } })
        }
        if (path === '/api/v1/wms/native/proxy/api/orders/update_item' && request.method() === 'POST') return json({ code: 'WMS_NATIVE_RESULT_UNKNOWN' }, 503)
        deniedNetwork.push(request.method() + ' ' + url.href); return route.abort()
      })
      await page.goto(origin + '/__warehouse-native' + query)
      if (new URLSearchParams(query).get('station') === 'csr') await page.getByText('尚未指派儲運作業權限，請聯絡管理員', { exact: true }).waitFor()
      else await page.getByRole('button', { name: '預揀與倉庫放行', exact: true }).waitFor()
      assert.deepEqual(errors, []); assert.equal(await page.locator('vite-error-overlay').count(), 0)
      return { context, page, errors, calls, deniedNetwork, recoveryStarted, releaseRecovery }
    }
    const route = page => page.locator('#current-route').innerText()
    const records = page => page.evaluate(() => window.__sdkRecords)
    const enter = async page => { await page.getByRole('button', { name: '通路訂單轉檔', exact: true }).click(); await page.getByRole('heading', { name: 'SDK 作業 /admin/marketplace-converter', exact: true }).waitFor() }
    async function healthy(result) {
      assert.deepEqual(result.errors, []); assert.deepEqual(result.deniedNetwork, []); assert.equal(await result.page.evaluate(() => window.__windowOpens), 0)
      assert.equal(result.context.pages().length, 1); assert.equal(await result.page.locator('iframe').count(), 0); await result.context.close()
    }
    await t.test('home, marketplace, internal order, back and workbench use the current tab and retain company', async () => {
      const result = await open(), { page } = result
      const screenshotDir = process.env.WAREHOUSE_NATIVE_SCREENSHOT_DIR
      if (screenshotDir) { mkdirSync(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'erp-native-home.png'), fullPage: true }) }
      await enter(page); assert.equal(await route(page), '/warehouse/marketplace?entityId=warehouse-A')
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'erp-native-module.png'), fullPage: true })
      await page.getByRole('button', { name: '模組訂單', exact: true }).click(); await page.getByRole('heading', { name: 'SDK 作業 /order/17', exact: true }).waitFor()
      assert.equal(new URL(await route(page), origin).searchParams.get('entityId'), 'warehouse-A'); assert.equal((await records(page)).length, 1)
      await page.evaluate(() => window.__routeBack()); await page.getByRole('heading', { name: 'SDK 作業 /admin/marketplace-converter', exact: true }).waitFor(); assert.equal((await records(page)).length, 1)
      await page.getByRole('button', { name: '模組返回工作台', exact: true }).click(); await page.getByRole('heading', { name: 'SDK 作業 /tasks', exact: true }).waitFor()
      const current = new URL(await route(page), origin); assert.equal(current.pathname, '/warehouse'); assert.equal(current.searchParams.get('entityId'), 'warehouse-A'); assert.equal(current.searchParams.get('wms'), '/tasks')
      assert.equal((await records(page))[0].disposed, true); await healthy(result)
    })
    for (const [stationRole, section] of [['picker', 'picking'], ['packer', 'packing']]) {
      await t.test(`${stationRole} intake return retires the intake session and opens its assigned station inside ERP`, async () => {
        const result = await open('?station=' + stationRole), { page } = result
        assert.equal(await page.getByRole('button', { name: '通路訂單轉檔', exact: true }).count(), 0)
        await page.getByRole('button', { name: '預揀與倉庫放行', exact: true }).click()
        await page.getByRole('heading', { name: 'SDK 作業 /warehouse-intakes', exact: true }).waitFor()
        assert.equal(await route(page), '/warehouse/intakes?entityId=warehouse-A')
        await page.getByRole('button', { name: '模組返回工作台', exact: true }).click()
        await page.getByRole('heading', { name: 'SDK 作業 /tasks', exact: true }).waitFor()
        const current = new URL(await route(page), origin)
        assert.equal(current.pathname, '/warehouse/' + section); assert.equal(current.searchParams.get('entityId'), 'warehouse-A'); assert.equal(current.searchParams.get('wms'), '/tasks')
        const sessions = result.calls.filter(call => call.path.endsWith('/native/session'))
        assert.deepEqual(sessions.map(call => call.body.entry), ['intakes', section])
        assert(sessions.every(call => call.body.entityId === 'warehouse-A'))
        const mounted = await records(page)
        assert.equal(mounted.length, 2); assert.equal(mounted[0].disposed, true); assert.equal(mounted[0].aborted, true)
        assert.equal(mounted[1].disposed, false); assert.equal(mounted[1].path, '/tasks')
        assert(sessions.every(call => call.headers.authorization === 'Bearer erp-token-operator-A'))
        await healthy(result)
      })
    }
    await t.test('actor, company and route changes dispose old handles and deny their stale transports', async () => {
      const result = await open(), { page } = result
      await enter(page); await page.evaluate(() => window.__changeActor('operator-B'))
      await page.waitForFunction(() => window.__sdkRecords.length === 2 && window.__sdkRecords[1].actor === 'operator-B')
      assert.equal((await records(page))[0].disposed, true); assert.equal((await records(page))[0].aborted, true)
      const stale = await page.evaluate(async () => { try { await window.__sdkHosts[0].transport({ url: '/api/tasks' }); return 'unexpected' } catch (error) { return error.name } }); assert.equal(stale, 'AbortError')
      await page.evaluate(() => window.__routeTo('/warehouse/marketplace?entityId=warehouse-B')); await page.getByText('請切換至倉儲公司', { exact: true }).waitFor()
      assert.equal((await records(page))[1].disposed, true); assert.equal(result.calls.filter(call => call.path.endsWith('/native/session')).at(-1).body.entityId, 'warehouse-B')
      await page.evaluate(() => window.__routeTo('/profile?entityId=warehouse-B')); await page.getByRole('heading', { name: 'Synthetic profile' }).waitFor(); assert.equal(result.calls.filter(call => call.path.includes('/native/proxy/')).length, 0)
      await healthy(result)
    })
    for (const [station, section, workPath] of [['admin', 'marketplace', '/admin/marketplace-converter'], ['superadmin', 'marketplace', '/admin/marketplace-converter'], ['picker', 'picking', '/tasks?group=pick']]) {
      await t.test(`${station} explicitly switches only to the already authorized warehouse without directory reads`, async () => {
        const result = await open('?station=' + station), { page } = result
        const search = '?entityId=warehouse-B&wms=' + encodeURIComponent(workPath) + '&filter=queued'
        await page.evaluate(path => window.__routeTo(path), '/warehouse/' + section + search)
        await page.getByText('請切換至倉儲公司', { exact: true }).waitFor()
        assert.equal((await records(page)).length, 0)
        assert.equal(await route(page), '/warehouse/' + section + search)
        await page.getByRole('button', { name: '切換至倉儲公司', exact: true }).click()
        await page.getByRole('heading', { name: 'SDK 作業 ' + workPath, exact: true }).waitFor()
        const destination = new URL(await route(page), origin)
        assert.equal(destination.pathname, '/warehouse/' + section)
        assert.equal(destination.searchParams.get('entityId'), 'warehouse-A')
        assert.equal(destination.searchParams.get('wms'), workPath)
        assert.equal(destination.searchParams.get('filter'), 'queued')
        const sessions = result.calls.filter(call => call.path.endsWith('/native/session'))
        assert.deepEqual(sessions.map(call => call.body.entityId), ['warehouse-B', 'warehouse-A'])
        assert.equal(result.calls.filter(call => call.path === '/api/v1/entities').length, 0)
        assert.equal(await page.evaluate(() => localStorage.getItem('entityId')), 'warehouse-A')
        await healthy(result)
      })
    }
    await t.test('denied, disabled, invalid or differently owned recovery metadata never creates a switch target', async () => {
      for (const [query, section, feedback] of [
        ['?access-denied', 'marketplace', '沒有此儲運功能權限，請聯絡管理員'],
        ['?access-disabled', 'marketplace', '無法確認倉儲公司，請重試'],
        ['?access-expired', 'marketplace', '作業連線已逾時，請重新連線'],
        ['?wrong-actor', 'marketplace', '無法確認倉儲公司，請重試'],
        ['?invalid-company', 'marketplace', '無法確認倉儲公司，請重試'],
        ['?station=picker&grant-removed', 'picking', '無法確認倉儲公司，請重試'],
      ]) {
        const result = await open(query), { page } = result
        await page.evaluate(path => window.__routeTo(path), '/warehouse/' + section + '?entityId=warehouse-B')
        await page.getByText(feedback, { exact: true }).waitFor()
        assert.equal(await page.getByRole('button', { name: '切換至倉儲公司', exact: true }).count(), 0)
        assert.equal((await records(page)).length, 0)
        assert.equal(result.calls.filter(call => call.path.endsWith('/native/session')).length, 1)
        assert.equal(result.calls.filter(call => call.path === '/api/v1/entities').length, 0)
        await healthy(result)
      }
    })
    await t.test('an unauthorized CSR cannot obtain a warehouse-company recovery action by guessing its route', async () => {
      const result = await open('?station=csr'), { page } = result
      await page.evaluate(() => window.__routeTo('/warehouse/marketplace?entityId=warehouse-B'))
      await page.getByText('沒有此儲運功能權限', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '切換至倉儲公司', exact: true }).count(), 0)
      assert.equal(result.calls.filter(call => call.path.endsWith('/native/session')).length, 0)
      assert.equal(result.calls.filter(call => call.path === '/api/v1/wms/portal/access').length, 1)
      await healthy(result)
    })
    await t.test('a late recovery response cannot restore a switch action for an old actor or company', async () => {
      for (const change of ['actor', 'company']) {
        const result = await open('?hold-recovery&new-actor-denied'), { page } = result
        await page.evaluate(() => window.__routeTo('/warehouse/marketplace?entityId=warehouse-B'))
        await result.recoveryStarted
        if (change === 'actor') {
          await page.evaluate(() => window.__changeActor('operator-B'))
          await page.getByText('沒有此儲運功能權限，請聯絡管理員', { exact: true }).waitFor()
        } else {
          await page.evaluate(() => window.__routeTo('/warehouse/marketplace?entityId=warehouse-A'))
          await page.getByRole('heading', { name: 'SDK 作業 /admin/marketplace-converter', exact: true }).waitFor()
        }
        result.releaseRecovery()
        await page.waitForTimeout(100)
        assert.equal(await page.getByRole('button', { name: '切換至倉儲公司', exact: true }).count(), 0)
        assert.equal((await records(page)).length, change === 'company' ? 1 : 0)
        assert.equal(result.calls.filter(call => call.path.endsWith('/native/session')).length, 2)
        await healthy(result)
      }
    })
    await t.test('company recovery does not normalize a work path belonging to another section', async () => {
      const result = await open(), { page } = result
      await page.evaluate(() => window.__routeTo('/warehouse/marketplace?entityId=warehouse-B&wms=%2Fadmin%2Fusers'))
      await page.getByText('找不到這筆儲運作業', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '切換至倉儲公司', exact: true }).count(), 0)
      assert.equal(result.calls.filter(call => call.path.endsWith('/native/session')).length, 0)
      assert.equal(result.calls.filter(call => call.path === '/api/v1/wms/portal/access').length, 1)
      await healthy(result)
    })
    await t.test('a recovery action cannot switch company after its ERP token changes before the click', async () => {
      const result = await open(), { page } = result
      await page.evaluate(() => window.__routeTo('/warehouse/marketplace?entityId=warehouse-B'))
      await page.getByRole('button', { name: '切換至倉儲公司', exact: true }).waitFor()
      await page.evaluate(() => localStorage.setItem('access_token', 'erp-token-new-login'))
      await page.getByRole('button', { name: '切換至倉儲公司', exact: true }).click()
      assert.equal(await route(page), '/warehouse/marketplace?entityId=warehouse-B')
      assert.equal(result.calls.filter(call => call.path.endsWith('/native/session')).length, 1)
      assert.equal((await records(page)).length, 0)
      await healthy(result)
    })
    await t.test('an actual permission denial retains its existing feedback and offers no company workaround', async () => {
      const result = await open('?permission-denied'), { page } = result
      await page.getByRole('button', { name: '通路訂單轉檔', exact: true }).click()
      await page.getByText('沒有此儲運功能權限，請聯絡管理員', { exact: true }).waitFor()
      assert.equal(await page.getByRole('combobox', { name: '公司', exact: true }).count(), 0)
      assert.equal(result.calls.filter(call => call.path === '/api/v1/entities').length, 0)
      assert.equal((await records(page)).length, 0)
      await healthy(result)
    })
    await t.test('expiry reconnect creates a fresh auth session without replaying an uncertain business command', async () => {
      const result = await open(), { page } = result
      await enter(page); await page.getByRole('button', { name: '測試一次作業', exact: true }).click(); await page.waitForFunction(() => window.__lastCommandError)
      assert.equal(await page.evaluate(() => window.__lastCommandError.code), 'WMS_NATIVE_RESULT_UNKNOWN', JSON.stringify(await page.evaluate(() => window.__lastCommandError)))
      await page.getByRole('button', { name: '模組逾時', exact: true }).click(); await page.getByText('作業連線已逾時，請重新連線', { exact: true }).waitFor()
      assert.equal((await records(page))[0].disposed, true); assert.equal(await page.evaluate(() => localStorage.getItem('access_token')), 'erp-token-operator-A')
      await page.getByRole('button', { name: '重新連線', exact: true }).click(); await page.getByRole('heading', { name: 'SDK 作業 /admin/marketplace-converter', exact: true }).waitFor()
      assert.equal((await records(page)).length, 2); assert.equal(result.calls.filter(call => call.path.endsWith('/native/session')).length, 2)
      const commands = result.calls.filter(call => call.path.includes('/native/proxy/')); assert.equal(commands.length, 1); assert.equal(commands[0].body.commandId, 'TEST-original-uuid'); assert.equal(commands[0].headers['x-wms-entity'], 'warehouse-A')
      await healthy(result)
    })
    await t.test('logout focus and a late module mount cannot restore an abandoned workspace', async () => {
      const result = await open('?hold'), { page } = result
      await page.getByRole('button', { name: '通路訂單轉檔', exact: true }).click(); await page.waitForFunction(() => typeof window.__releaseMount === 'function')
      await page.evaluate(() => window.__routeTo('/profile?entityId=warehouse-A')); await page.getByRole('heading', { name: 'Synthetic profile' }).waitFor(); await page.evaluate(() => window.__releaseMount())
      await page.waitForFunction(() => window.__sdkRecords[0].disposed === true); assert.equal((await records(page))[0].aborted, true)
      await page.evaluate(() => { window.__holdMount = false; window.__routeTo('/warehouse/marketplace?entityId=warehouse-A') }); await page.getByRole('heading', { name: 'SDK 作業 /admin/marketplace-converter', exact: true }).waitFor()
      await page.evaluate(() => { localStorage.removeItem('access_token'); window.dispatchEvent(new Event('focus')) }); await page.getByText('請重新登入並選擇公司', { exact: true }).waitFor()
      assert.equal((await records(page))[1].disposed, true); assert.equal(result.calls.filter(call => call.path.includes('/native/proxy/')).length, 0)
      await healthy(result)
    })
  } finally {
    await browser?.close(); await server.close(); rmSync(cache, { recursive: true, force: true })
  }
})
