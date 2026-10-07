import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Form } from 'antd';
import RecipientPicker from '/src/pages/mailroom/RecipientPicker.tsx';
const e = React.createElement;
const initialPeople = [
  {id:'exact-repair-uuid',name:'同名同仁',department:'Repair',employeeNo:'R10',repair:true,mailroom:false},
  {id:'other-repair-uuid',name:'同名同仁',department:'Repair',employeeNo:'R2',repair:true,mailroom:false},
  {id:'exact-csr-uuid',name:'同名同仁',department:'客服',employeeNo:'C2',repair:false,mailroom:false},
  {id:'missing-department-id',name:'未分類同仁',department:'',employeeNo:'N1',repair:false,mailroom:false},
];
function Harness() {
  const [form] = Form.useForm();
  const [people, setPeople] = useState(initialPeople);
  const [changes, setChanges] = useState([]);
  const value = Form.useWatch('recipientId', form);
  return e(React.Fragment, null,
    e(Form, {form, onValuesChange:changed=>setChanges(previous=>[...previous, changed.recipientId ?? null])},
      e(Form.Item, {name:'recipientId', label:'指定收件同仁'},
        e(RecipientPicker, {people, label:'收件人'}))),
    e('output', {id:'value'}, value ?? 'none'),
    e('output', {id:'changes'}, JSON.stringify(changes)),
    e('button', {id:'external-person', onClick:()=>form.setFieldsValue({recipientId:'missing-department-id'})}, 'External person'),
    e('button', {id:'external-repair', onClick:()=>form.setFieldsValue({recipientId:'exact-repair-uuid'})}, 'External repair'),
    e('button', {id:'external-reset', onClick:()=>form.setFieldsValue({recipientId:undefined})}, 'External reset'),
    e('button', {id:'same-list', onClick:()=>setPeople([...people].reverse())}, 'Same list'),
    e('button', {id:'remove-repair', onClick:()=>setPeople(initialPeople.filter(person=>person.department !== 'Repair'))}, 'Eligibility changed'),
    e('button', {id:'empty-list', onClick:()=>setPeople([])}, 'Empty list'),
    e('button', {id:'restore-list', onClick:()=>setPeople(initialPeople)}, 'Restore list'));
}
createRoot(document.getElementById('root')).render(e(Harness));
`

test('controlled Ant Form recipient picker selects exact people, clears on department change, and respects external resets and eligible lists', {
  skip: !executablePath && 'No existing Chromium executable; this test never installs a browser',
  timeout: 60000,
}, async t => {
  const virtual = '\0mailroom-recipient-dom-fixture'
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-mailroom-recipient-'))
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }))
  const server = await createServer({ root, cacheDir, configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [react(), {
      name: 'offline-mailroom-recipient-test',
      resolveId(id) { if (id === 'virtual:mailroom-recipient-dom-fixture') return virtual },
      load(id) { if (id === virtual) return fixture },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== '/__mailroom-recipient') return next()
          try {
            const html = await vite.transformIndexHtml('/__mailroom-recipient', '<html><head><style>.mailroom-recipient-controls{display:grid;grid-template-columns:200px 350px;gap:12px}button{margin:8px}</style></head><body><div id="root"></div><script type="module" src="/@id/virtual:mailroom-recipient-dom-fixture"></script></body></html>')
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
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__mailroom-recipient`)
  await page.waitForFunction(() => document.getElementById('value') || document.querySelector('vite-error-overlay'), undefined, { timeout: 10000 })
  assert.deepEqual(errors, [], 'The real React/Ant Form fixture must mount without browser errors')
  const department = page.getByRole('combobox', { name: '收件人部門', exact: true })
  const recipient = page.getByRole('combobox', { name: '收件人', exact: true })
  const dropdown = () => page.locator('.ant-select-dropdown:visible:not(.ant-slide-up-leave)')
  async function choose(control, label) {
    await control.press('ArrowDown')
    await dropdown().getByText(label, { exact: true }).click()
    await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' })
  }
  async function expectValue(expected) {
    await page.waitForFunction(value => document.getElementById('value').textContent === value, expected)
    assert.equal(await page.locator('#value').innerText(), expected)
  }
  await choose(department, 'Repair')
  await expectValue('none')
  assert.equal(await page.locator('#changes').innerText(), '[]', 'A department never becomes a person assignment')
  await recipient.fill('r10')
  await dropdown().getByText('Repair · 同名同仁 · R10', { exact: true }).waitFor()
  assert.doesNotMatch(await dropdown().innerText(), /R2|C2/)
  await dropdown().getByText('Repair · 同名同仁 · R10', { exact: true }).click()
  await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' })
  await expectValue('exact-repair-uuid')
  await choose(department, '客服')
  await expectValue('none')
  assert.equal(await page.locator('#changes').innerText(), '["exact-repair-uuid",null]')
  await choose(recipient, '客服 · 同名同仁 · C2')
  await expectValue('exact-csr-uuid')
  await choose(department, '全部門')
  await recipient.fill('Repair')
  await dropdown().getByText('Repair · 同名同仁 · R2', { exact: true }).waitFor()
  assert.doesNotMatch(await dropdown().innerText(), /C2|N1/)
  await page.locator('#same-list').dispatchEvent('click')
  assert.equal(await recipient.inputValue(), 'Repair', 'An equivalent list rerender retains the typed search')
  await recipient.press('Escape')
  await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' })
  await page.locator('#external-person').click()
  await expectValue('missing-department-id')
  assert.equal(await recipient.inputValue(), '', 'An external person change resets the search')
  assert.match(await page.locator('.mailroom-recipient-department').innerText(), /未設定部門/)
  assert.equal(await page.locator('#changes').innerText(), '["exact-repair-uuid",null,"exact-csr-uuid"]', 'External writes never emit recipient changes')
  await page.locator('#external-reset').click()
  await expectValue('none')
  assert.match(await page.locator('.mailroom-recipient-department').innerText(), /全部門/)
  await recipient.fill('does-not-exist')
  await dropdown().getByText('沒有符合部門、姓名或員工編號的同仁', { exact: true }).waitFor()
  await recipient.press('Escape')
  await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' })
  await page.locator('#external-repair').click()
  await expectValue('exact-repair-uuid')
  await page.locator('#remove-repair').click()
  await page.getByText('原接收人不在名單，請重新選擇。', { exact: true }).waitFor()
  await expectValue('exact-repair-uuid')
  assert.match(await page.locator('.mailroom-recipient-department').innerText(), /全部門/)
  await page.locator('#empty-list').click()
  await page.getByText('目前沒有可指派的收件人', { exact: true }).waitFor()
  assert.equal(await department.isDisabled(), true)
  assert.equal(await recipient.isDisabled(), true)
  await expectValue('exact-repair-uuid')
  assert.equal(await page.locator('#changes').innerText(), '["exact-repair-uuid",null,"exact-csr-uuid"]', 'Eligibility updates never erase an external Form value')
  await page.locator('#restore-list').click()
  assert.equal(await recipient.isDisabled(), false)
  assert.equal(await page.getByText('原接收人不在名單，請重新選擇。', { exact: true }).count(), 0)
  await choose(department, '未設定部門')
  await expectValue('none')
  await choose(recipient, '未設定部門 · 未分類同仁 · N1')
  await expectValue('missing-department-id')
  assert.deepEqual(errors, [])
})
