import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import type { Browser, Page } from '../../backend/node_modules/playwright'

const require = createRequire(import.meta.url)
const { chromium } = require('../../backend/node_modules/playwright') as typeof import('../../backend/node_modules/playwright')
const executablePath = [chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
const root = fileURLToPath(new URL('../', import.meta.url))

// Only the external boundaries are replaced. Hub, ModulePage, the data router,
// native Tabs, Ant Design hook modals and the navigation blocker are real.
const auth = `
import React, { createContext, useContext } from 'react';
const Context = createContext({user:null});
export const FixtureAuth = Context.Provider;
export const useAuth = () => useContext(Context);
`
const api = `
export default {
  async post(path, body) {
    window.__moduleCalls.push({path,body:structuredClone(body)});
    if(path !== '/after-sales/module/launch') throw new Error('Unexpected fixture API write');
    return {data:{action:'/after-sales-app/api/integration/erp/session',ticket:'SYNTHETIC-FIXTURE-TICKET-NOT-VALID'}};
  },
  async get() { throw new Error('Unexpected fixture API read'); }
};
`
function nativeQueue(kind: string) {
  return `
import React, { useEffect, useState } from 'react';
export default function DraftQueue({onDirtyChange,initialItemId}) {
  const [value,setValue] = useState('');
  useEffect(()=>{ window.__queueMounts.${kind}++; return ()=>onDirtyChange(false); },[]);
  return React.createElement('label',null,'Synthetic ${kind} draft',
    React.createElement('output',{id:'${kind}-initial-item'},initialItemId || ''),
    React.createElement('input',{id:'${kind}-draft',value,onChange:event=>{
      setValue(event.target.value);onDirtyChange(true);
    }}));
}
`
}
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import AfterSalesModulePage from '/src/pages/AfterSalesModulePage.tsx';
import { FixtureAuth } from 'virtual:after-sales-module-auth';
const e=React.createElement;
const query=new URLSearchParams(window.location.search);
const profile=query.get('profile') || 'csr';
const base={id:'synthetic-csr',name:'Synthetic CSR',email:'synthetic@example.invalid',roles:['CUSTOMER_SERVICE'],
  permissions:['after_sales_cases:read','mailroom:review'],salesDataScope:'ENTITY'};
let user={...base,permissions:[...base.permissions]};
if(profile==='invoices') user.permissions.push('after_sales_invoices:read');
if(profile==='accounting') user.permissions.push('after_sales_accounting:read');
if(profile==='both') user.permissions.push('after_sales_invoices:read','after_sales_accounting:read');
if(profile==='no-grants') user.permissions=[];
if(profile==='admin-self') user={...user,roles:['ADMIN'],permissions:[],salesDataScope:'SELF'};
if(profile==='self') user.salesDataScope='SELF';
if(profile==='department') user.salesDataScope='DEPARTMENT';
if(profile==='anonymous') user=null;
window.__APP_CONFIG__={afterSalesModuleEnabled:query.get('enabled')!=='false'};
window.__moduleCalls=[];window.__queueMounts={repair:0,intake:0};
function Current() {
  const location=useLocation(),navigate=useNavigate();
  return e(React.Fragment,null,e('output',{id:'current-route'},location.pathname+location.search),
    e('button',{id:'fixture-back',onClick:()=>navigate(-1)},'Synthetic browser Back'),
    e('button',{id:'fixture-next-intake',onClick:()=>navigate('/operations/after-sales/workbench?entityId=synthetic-company&intakeItemId=synthetic-intake-second')},'Synthetic next intake'));
}
function Workbench() { return e(React.Fragment,null,e(Current),e(AfterSalesModulePage)); }
const section=query.get('section') || 'workbench';
const router=createMemoryRouter([
  {path:'/operations/after-sales/:section',element:e(Workbench)},
  {path:'/prior',element:e(React.Fragment,null,e(Current),e('h2',null,'Synthetic prior page'))},
],{initialEntries:['/prior','/operations/after-sales/'+section+'?entityId=synthetic-company'],initialIndex:1});
createRoot(document.getElementById('root')).render(e(FixtureAuth,{value:{user}},e(RouterProvider,{router})));
`

const sourcePaths: Record<string, string> = {
  workbench: '/dashboard', cases: '/cases', quotes: '/cases/repair-quotes',
  repairs: '/cases/repairs', reshipments: '/cases/reshipments',
  'private-purchases': '/cases/private-purchases', 'exchange-returns': '/cases/exchange-returns',
  'refund-pickups': '/cases/refund-pickups', 'customer-issues': '/cases/customer-issues',
  invoices: '/invoices', accounting: '/accounting-workbench', customers: '/customers',
}
const sourceFrameHtml = (path: string) => `<html><body><h2>Synthetic original overview</h2><button id="frame-dirty">Synthetic original draft</button><script>
  parent.postMessage({source:'corely.aftersales.v1',ready:true,path:${JSON.stringify(path)}},location.origin);
  document.getElementById('frame-dirty').onclick=()=>parent.postMessage({source:'corely.aftersales.v1',dirty:true},location.origin);
</script></body></html>`
const globals = async (page: Page) => page.evaluate(() => {
  const metadata = window as Window & {
    __moduleCalls: { path: string; body: { entityId: string; section: string } }[]
    __queueMounts: { repair: number; intake: number }
  }
  return { calls: metadata.__moduleCalls, mounts: metadata.__queueMounts }
})

async function ephemeralPort() {
  const server = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

test('actual DOA hub and module preserve routing, least privilege and native drafts', {
  skip: !executablePath && 'No existing Chromium; this test never installs a browser', timeout: 90_000,
}, async t => {
  const cache = mkdtempSync(join(tmpdir(), 'corely-after-sales-module-dom-'))
  t.after(() => rmSync(cache, { recursive: true, force: true }))
  const virtualModules: Record<string, string> = {
    'virtual:after-sales-module-dom': fixture,
    'virtual:after-sales-module-auth': auth,
    'virtual:after-sales-module-api': api,
    'virtual:after-sales-module-repair': nativeQueue('repair'),
    'virtual:after-sales-module-intake': nativeQueue('intake'),
  }
  const aliases = new Map([
    [resolve(root, 'src/contexts/AuthContext'), 'virtual:after-sales-module-auth'],
    [resolve(root, 'src/services/api'), 'virtual:after-sales-module-api'],
    [resolve(root, 'src/pages/repair/CustomerRepairQueue'), 'virtual:after-sales-module-repair'],
    [resolve(root, 'src/pages/mailroom/CustomerIntakeQueue'), 'virtual:after-sales-module-intake'],
  ])
  const server = await createServer({ root, configFile: false, cacheDir: join(cache, 'vite'),
    server: { host: '127.0.0.1', port: await ephemeralPort(), strictPort: true },
    plugins: [react(), {
      name: 'isolated-after-sales-module-dom',
      enforce: 'pre',
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
          if (request.url?.startsWith('/after-sales-app/')) {
            const path = request.url.split('?')[0].slice('/after-sales-app'.length)
            if (request.method !== 'GET' || !Object.values(sourcePaths).includes(path)) {
              response.statusCode = 403; response.end('Unknown fixture page'); return
            }
            // Redirect targets bypass Playwright's first-request route handler.
            // Serve the synthetic source document here, never the ERP index.
            response.setHeader('Content-Type', 'text/html'); response.end(sourceFrameHtml(path)); return
          }
          if (request.url?.split('?')[0] !== '/__after-sales-module') return next()
          try {
            const html = await vite.transformIndexHtml('/__after-sales-module', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:after-sales-module-dom"></script></body></html>')
            response.setHeader('Content-Type', 'text/html'); response.end(html)
          } catch (error) { next(error) }
        })
      },
    }],
  })
  t.after(() => server.close())
  await server.listen()
  const address = server.httpServer?.address()
  assert(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const browser: Browser = await chromium.launch({ executablePath, headless: true })
  t.after(() => browser.close())

  async function open(query = '') {
    const page = await browser.newPage()
    page.setDefaultTimeout(10_000)
    const errors: string[] = [], external: string[] = [], framePosts: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { external.push(url.origin); return route.abort() }
      if (url.pathname === '/after-sales-app/api/integration/erp/session') {
        assert.equal(request.method(), 'POST')
        const requests = await globals(page)
        const section = requests.calls.at(-1)?.body.section
        assert(section && sourcePaths[section], 'The fixture only accepts the requested known module section')
        framePosts.push(section)
        return route.fulfill({ status: 303, headers: { location: '/after-sales-app' + sourcePaths[section] }, body: '' })
      }
      if (url.pathname.startsWith('/after-sales-app/')) {
        const path = url.pathname.slice('/after-sales-app'.length)
        return route.fulfill({ contentType: 'text/html', body: sourceFrameHtml(path) })
      }
      assert.equal(request.method(), 'GET', 'All network business writes are prohibited by this fixture')
      return route.continue()
    })
    await page.goto(origin + '/__after-sales-module' + query)
    await page.waitForFunction(() => document.getElementById('current-route') || document.querySelector('vite-error-overlay'), undefined, { timeout: 10_000 })
    assert.deepEqual(errors, [], 'The controlled fixture must mount the real components without React errors')
    assert.equal(await page.locator('vite-error-overlay').count(), 0, 'Vite must resolve all real component and boundary imports')
    await page.locator('#current-route').waitFor({ timeout: 10_000 })
    return { page, errors, external, framePosts }
  }
  async function healthy(result: Awaited<ReturnType<typeof open>>) {
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.external, [])
    await result.page.close()
  }
  async function frameReady(result: Awaited<ReturnType<typeof open>>) {
    try {
      await result.page.frameLocator('iframe').getByRole('heading', { name: 'Synthetic original overview' }).waitFor()
    } catch {
      assert.fail(JSON.stringify({ errors: result.errors, calls: (await globals(result.page)).calls,
        framePosts: result.framePosts, frames: result.page.frames().map(frame => frame.url()),
        text: await result.page.locator('body').innerText() }))
    }
  }

  await t.test('native home does not consume a legacy launch ticket until overview is requested', async () => {
    const result = await open(), { page } = result
    await page.getByRole('heading', { name: '售後工作台', exact: true }).waitFor()
    await page.locator('#repair-draft').waitFor()
    assert.deepEqual((await globals(page)).calls, [])
    assert.equal(await page.locator('iframe').count(), 0)
    assert.equal(await page.locator('[role="status"]').count(), 0)
    await page.getByRole('button', { name: '查看案件概況', exact: true }).click()
    await frameReady(result)
    await page.waitForFunction(() => !document.querySelector('[role="status"]'))
    assert.deepEqual((await globals(page)).calls, [{ path: '/after-sales/module/launch', body: { entityId: 'synthetic-company', section: 'workbench' } }])
    await page.getByRole('button', { name: '收起案件概況', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('iframe'))
    await page.getByRole('button', { name: '查看案件概況', exact: true }).click()
    await frameReady(result)
    assert.equal((await globals(page)).calls.length, 2)
    assert.deepEqual(result.framePosts, ['workbench', 'workbench'])
    await healthy(result)
  })

  await t.test('all six rendered service controls navigate to their real requested section with company preserved', async () => {
    const controls = [
      ['補寄服務', 'reshipments'], ['商品與配件訂購', 'private-purchases'], ['檢測與維修', 'repairs'],
      ['換貨服務', 'exchange-returns'], ['退貨退款', 'refund-pickups'], ['產品問題回報', 'customer-issues'],
    ]
    for (const [label, section] of controls) {
      const result = await open(), { page } = result
      await page.getByRole('button', { name: new RegExp('^' + label) }).click()
      await page.waitForFunction(expected => document.getElementById('current-route')?.textContent === expected,
        '/operations/after-sales/' + section + '?entityId=synthetic-company')
      await frameReady(result)
      assert.deepEqual((await globals(page)).calls, [{ path: '/after-sales/module/launch', body: { entityId: 'synthetic-company', section } }])
      await healthy(result)
    }
  })

  await t.test('invoice and accounting controls require their own grants and open only that allowed module', async () => {
    for (const [profile, visible, absent, section] of [
      ['csr', '', '', ''], ['invoices', '發票作業', '收款與退款核對', 'invoices'],
      ['accounting', '收款與退款核對', '發票作業', 'accounting'],
    ]) {
      const result = await open('?profile=' + profile), { page } = result
      await page.getByRole('heading', { name: '售後工作台', exact: true }).waitFor()
      if (!visible) {
        assert.equal(await page.getByRole('button', { name: '發票作業', exact: true }).count(), 0)
        assert.equal(await page.getByRole('button', { name: '收款與退款核對', exact: true }).count(), 0)
      } else {
        assert.equal(await page.getByRole('button', { name: absent, exact: true }).count(), 0)
        await page.getByRole('button', { name: visible, exact: true }).click()
        await frameReady(result)
        assert.equal((await globals(page)).calls.at(-1)?.body.section, section)
      }
      await healthy(result)
    }
  })

  await t.test('ungranted, SELF, DEPARTMENT and ADMIN SELF direct links never call module launch', async () => {
    for (const profile of ['no-grants', 'self', 'department', 'admin-self', 'anonymous']) {
      const result = await open('?section=cases&profile=' + profile), { page } = result
      await page.getByText('此帳號沒有目前售後功能或公司範圍的權限', { exact: true }).waitFor()
      assert.deepEqual((await globals(page)).calls, [])
      assert.equal(await page.locator('iframe').count(), 0)
      assert.equal(await page.getByRole('button', { name: '案件總覽', exact: true }).count(), 0)
      // A visible retry must re-run the same authorization boundary, not launch.
      await page.getByRole('button', { name: '重新開啟', exact: true }).click()
      assert.deepEqual((await globals(page)).calls, [])
      await healthy(result)
    }
    for (const [profile, section] of [['csr', 'invoices'], ['invoices', 'accounting'], ['accounting', 'invoices']]) {
      const result = await open('?section=' + section + '&profile=' + profile)
      await result.page.getByText('此帳號沒有目前售後功能或公司範圍的權限', { exact: true }).waitFor()
      assert.deepEqual((await globals(result.page)).calls, [])
      await healthy(result)
    }
  })

  await t.test('disabled integration never mounts a legacy frame or requests a ticket', async () => {
    const result = await open('?section=cases&enabled=false')
    await result.page.getByText('售後工作台尚未開通', { exact: true }).waitFor()
    assert.deepEqual((await globals(result.page)).calls, [])
    assert.equal(await result.page.locator('iframe').count(), 0)
    await healthy(result)
  })

  await t.test('tab drafts remain mounted through overview close/reopen and cancel leaves; confirm permits navigation', async () => {
    const result = await open(), { page } = result
    await page.locator('#repair-draft').fill('SYNTHETIC repair draft')
    await page.getByRole('tab', { name: '收發交辦', exact: true }).click()
    await page.locator('#intake-draft').fill('SYNTHETIC intake draft')
    await page.getByRole('tab', { name: '維修交辦', exact: true }).click()
    assert.equal(await page.locator('#repair-draft').inputValue(), 'SYNTHETIC repair draft')
    assert.equal(await page.locator('#intake-draft').inputValue(), 'SYNTHETIC intake draft')
    assert.deepEqual((await globals(page)).mounts, { repair: 1, intake: 1 })

    await page.getByRole('button', { name: '查看案件概況', exact: true }).click()
    await page.frameLocator('iframe').getByRole('button', { name: 'Synthetic original draft' }).click()
    await page.getByRole('button', { name: '收起案件概況', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    assert.match(await dialog.innerText(), /案件概況有未儲存修改/)
    await dialog.getByRole('button', { name: /^保\s*留$/ }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('iframe').count(), 1)
    await page.getByRole('button', { name: '收起案件概況', exact: true }).click()
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: /^收\s*起$/ }).click()
    await page.waitForFunction(() => !document.querySelector('iframe'))
    assert.equal(await page.locator('#repair-draft').inputValue(), 'SYNTHETIC repair draft')
    assert.equal(await page.locator('#intake-draft').inputValue(), 'SYNTHETIC intake draft')
    await page.getByRole('button', { name: '查看案件概況', exact: true }).click()
    await frameReady(result)
    assert.deepEqual((await globals(page)).mounts, { repair: 1, intake: 1 })
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }), true, 'Reload protection remains active for native drafts after overview resets iframe dirtiness')

    for (const control of [page.getByRole('button', { name: '報價與顧客確認', exact: true }), page.locator('#fixture-back')]) {
      await control.click()
      await dialog.waitFor({ state: 'visible' })
      assert.match(await dialog.innerText(), /售後表單有未儲存修改/)
      await dialog.getByRole('button', { name: '保留表單', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await page.locator('#current-route').innerText(), '/operations/after-sales/workbench?entityId=synthetic-company')
      assert.equal(await page.locator('#repair-draft').inputValue(), 'SYNTHETIC repair draft')
      assert.equal(await page.locator('#intake-draft').inputValue(), 'SYNTHETIC intake draft')
      assert.deepEqual((await globals(page)).mounts, { repair: 1, intake: 1 })
    }
    await page.getByRole('button', { name: '報價與顧客確認', exact: true }).click()
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: '放棄修改', exact: true }).click()
    await page.waitForFunction(() => document.getElementById('current-route')?.textContent === '/operations/after-sales/quotes?entityId=synthetic-company')
    assert.equal(await page.locator('#repair-draft').count(), 0)
    assert.equal(await page.locator('#intake-draft').count(), 0)
    assert.equal((await globals(page)).calls.at(-1)?.body.section, 'quotes')
    await healthy(result)
  })

  await t.test('a second intake deep link asks before discarding and mounts the new intake only after consent', async () => {
    const result = await open(), { page } = result
    await page.locator('#repair-draft').fill('SYNTHETIC original repair draft')
    await page.locator('#fixture-next-intake').click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: '保留表單', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#current-route').innerText(), '/operations/after-sales/workbench?entityId=synthetic-company')
    assert.equal(await page.locator('#repair-draft').inputValue(), 'SYNTHETIC original repair draft')
    assert.equal(await page.getByRole('tab', { name: '維修交辦', exact: true }).getAttribute('aria-selected'), 'true')
    assert.deepEqual((await globals(page)).mounts, { repair: 1, intake: 1 })

    await page.locator('#fixture-next-intake').click()
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: '放棄修改', exact: true }).click()
    await page.waitForFunction(() => document.getElementById('current-route')?.textContent?.endsWith('&intakeItemId=synthetic-intake-second'))
    await page.waitForFunction(() => document.getElementById('intake-initial-item')?.textContent === 'synthetic-intake-second')
    assert.equal(await page.getByRole('tab', { name: '收發交辦', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('#repair-draft').inputValue(), '')
    assert.equal(await page.locator('#intake-draft').inputValue(), '')
    assert.deepEqual((await globals(page)).mounts, { repair: 2, intake: 2 })
    assert.deepEqual((await globals(page)).calls, [], 'Changing native intake should not consume a legacy launch ticket')
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }), false, 'An explicitly discarded and remounted clean native form must not retain old draft dirtiness')
    await healthy(result)
  })
})
