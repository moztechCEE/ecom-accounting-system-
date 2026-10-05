import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const { chromium } = require('../../backend/node_modules/playwright')
const executablePath = [chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = `
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router-dom';
import { useRepairFeedback } from '/src/pages/repair/repair-feedback.tsx';
import { createRepairNavigationGate, useRepairNavigationGuard } from '/src/pages/repair/repair-navigation.ts';
const e = React.createElement;
function SavedChild({ feedback, reload }) {
  const { message, contextHolder } = useRepairFeedback(feedback);
  return e(React.Fragment, null, contextHolder, e('button', { id:'save', onClick:async()=>{
    await reload(); message.success('Synthetic saved action');
  }}, 'Save'));
}
function Harness() {
  const { modal, message, contextHolder } = useRepairFeedback();
  const navigate = useNavigate();
  const dirty = useRef(false);
  const [asks,setAsks] = useState(0), [left,setLeft] = useState(false), [generation,setGeneration] = useState(0);
  const confirm = useCallback(()=>{
    setAsks(n=>n+1);
    return new Promise(resolve=>modal.confirm({ title:'Synthetic unsaved draft', okText:'Discard', cancelText:'Keep',
      maskClosable:false, onOk:()=>resolve(true), onCancel:()=>resolve(false) }));
  },[modal]);
  const gate = useMemo(()=>createRepairNavigationGate(dirty,confirm),[confirm]);
  useRepairNavigationGuard(dirty,confirm);
  return e(React.Fragment,null,contextHolder,
    e('input',{id:'draft',onChange:()=>{dirty.current=true;}}),
    e(Link,{id:'router-leave',to:'/next'},'Another workbench'),
    e('button',{id:'back',onClick:()=>navigate(-1)},'Back'),
    e('button',{id:'leave',onClick:()=>gate(()=>setLeft(true))},'Leave'),
    e('output',{id:'asks'},String(asks)),e('output',{id:'destination'},left?'left':'stay'),
    e('output',{id:'generation'},String(generation)),
    e('button',{id:'fail',onClick:()=>message.error('Synthetic failed action')},'Fail'),
    e(SavedChild,{key:generation,feedback:message,reload:async()=>{
      setGeneration(n=>n+1);await new Promise(resolve=>setTimeout(resolve,25));
    }}));
}
const router = createMemoryRouter([{path:'/draft',element:e(Harness)},
  {path:'/prior',element:e('h2',null,'Previous workbench')},{path:'/next',element:e('h2',null,'Next workbench')}],
  {initialEntries:['/prior','/draft'],initialIndex:1});
createRoot(document.getElementById('root')).render(e(RouterProvider,{router}));
`

test('React 19 hook holders display real confirmation/cancel and messages after detail remount', {
  skip: !executablePath && 'No existing Chromium executable; this test never installs a browser',
  timeout: 60000,
}, async t => {
  const virtual = '\0repair-feedback-dom-fixture'
  const server = await createServer({ root, configFile: false,
    server: { host: '127.0.0.1', port: 0 },
    plugins: [react(), {
      name: 'offline-repair-feedback-test',
      resolveId(id) { if (id === 'virtual:repair-feedback-dom-fixture') return virtual },
      load(id) { if (id === virtual) return fixture },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== '/__repair-feedback') return next()
          try {
            const html = await vite.transformIndexHtml('/__repair-feedback', '<html><body><div id="root"></div><script type="module" src="/@id/virtual:repair-feedback-dom-fixture"></script></body></html>')
            response.setHeader('Content-Type', 'text/html')
            response.end(html)
          } catch (error) { next(error) }
        })
      },
    }],
  })
  t.after(() => server.close())
  await server.listen()
  const browser = await chromium.launch({ executablePath, headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__repair-feedback`)
  await page.waitForFunction(() => document.getElementById('draft') || document.querySelector('vite-error-overlay'), undefined, { timeout: 10000 })
  assert.deepEqual(errors, [], 'The actual React hook fixture must mount without browser errors')
  await page.locator('#draft').fill('Synthetic retained draft')
  await page.locator('#leave').click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible' })
  assert.match(await dialog.innerText(), /Synthetic unsaved draft/)
  assert.equal(await page.locator('#destination').innerText(), 'stay')
  await dialog.getByRole('button', { name: 'Keep', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#draft').inputValue(), 'Synthetic retained draft')
  assert.equal(await page.locator('#destination').innerText(), 'stay')
  for (const control of ['#router-leave', '#back']) {
    await page.locator(control).click()
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: 'Keep', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#draft').inputValue(), 'Synthetic retained draft', 'Cancelled router link and Back retain the same form')
  }
  await page.evaluate(() => { document.getElementById('leave').click(); document.getElementById('leave').click() })
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await page.locator('#asks').innerText(), '4', 'Concurrent exits share one visible confirmation')
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await page.waitForFunction(() => document.getElementById('destination').textContent === 'left')
  await page.locator('#fail').click()
  await page.getByText('Synthetic failed action', { exact: true }).waitFor({ state: 'visible' })
  await page.locator('#save').click()
  await page.getByText('Synthetic saved action', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await page.locator('#generation').innerText(), '1')
  await page.locator('#draft').fill('Synthetic next draft')
  await page.locator('#router-leave').click()
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await page.getByRole('heading', { name: 'Next workbench', exact: true }).waitFor({ state: 'visible' })
  assert.deepEqual(errors, [])
})
