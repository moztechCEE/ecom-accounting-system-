import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../backend/package.json', import.meta.url))
const { chromium } = require('playwright')
const output = process.env.DOA_UI_EVIDENCE_DIR || '/private/tmp/doa-native-ui-20261012'
await mkdir(output, { recursive: true })
const dist = fileURLToPath(new URL('../dist', import.meta.url))
const origin = 'https://doa-ui-fixture.invalid'
const contractVersion = 'corely.doa.tasks.v1'
const options = {
  contractVersion, canReadAll: true, createTypes: ['RESHIPMENT', 'PRIVATE_PURCHASE', 'REPAIR', 'EXCHANGE_RETURN', 'REFUND_PICKUP', 'CUSTOMER_ISSUE'],
  brands: [{ value: 'MOZTECH', label: 'MOZTECH' }, { value: 'BONSON', label: 'BONSON' }], customerKinds: [{ value: 'TO_C', label: '一般顧客' }, { value: 'TO_B', label: '代理商／經銷商' }], sourceChannels: [{ value: 'LINE', label: 'LINE' }],
  products: [{ id: 'ERP-P1', name: '示意產品', sku: 'MOCK-P1', model: 'MP1', unitPrice: 200 }],
  reasonOptions: { reshipmentReason: [{ value: '缺件', label: '缺件' }], lossCategory: [{ value: '配件', label: '配件' }], exchangeReason: [{ value: '新品瑕疵', label: '新品瑕疵' }], refundReason: [{ value: '故障', label: '故障' }], refundOption: [] },
}
const row = (id, type, brand, mine, number = id) => ({ id, number, type, status: 'NEW', brand, contact: { name: '示意顧客', phone: '0900000000' }, products: [{ id: 'line-1', productId: 'ERP-P1', name: '示意產品', sku: 'MOCK-P1', quantity: 1 }], serialNumber: 'MOCK-SN', owner: { sourceUserId: mine ? 'qa-user' : 'other', name: mine ? '示意客服' : '另一位客服', kind: 'assigned' }, isMine: mine, isActionable: mine, stage: 'registration', workflow: { queue: 'csr', stageLabel: '待登記審核', nextAction: '核對產品與顧客資料', helperText: null, isLocked: false, isOverdue: false, ownerRoleLabel: '客服' }, registeredAt: '2026-10-12T01:00:00Z', updatedAt: '2026-10-12T01:00:00Z', deletedAt: null, tasks: [] })
const fixtures = [row('case-repair', 'REPAIR', 'MOZTECH', true), row('case-purchase', 'PRIVATE_PURCHASE', 'BONSON', false), row('case-unknown', 'CUSTOMER_ISSUE', null, true)]
let created, createBody, requested = [], createBodies = [], actorId = 'qa-user'
const pendingKey = 'corely.doa.pending-registration.v1:qa-user:fixture-company'
const intake = { id: 'intake-a', entityId: 'fixture-company', label: 'MOCK-INTAKE-A', productName: '示意收件產品', sku: 'MOCK-P1', serialNumber: 'MOCK-SN', status: 'RECEIVED', statusLabel: '已收件', version: 1, receipt: { category: 'UNMATCHED', sourceCaseId: null }, custodianId: 'mailroom-user', custodianName: '示意收發人員', location: '示意收件架', allowedIntakeActions: ['bind_intake'], caseIntake: { status: 'ACCEPTED', ownerId: 'qa-user', ownerName: '示意客服', sentToUserId: 'qa-user', sentToUserName: '示意客服', sourceCaseId: null } }
const pageErrors = [], checks = []
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } })
await context.addInitScript(() => { if (window.top !== window) return; localStorage.setItem('access_token', 'fictional-qa-token'); localStorage.setItem('entityId', 'fixture-company') })
const routeHandler = async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname
  requested.push({ method: request.method(), path })
  if (url.origin !== origin) return route.abort()
  const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
  if (path === '/config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.__APP_CONFIG__={apiUrl:"/api/v1",afterSalesModuleEnabled:true,mailroomEnabled:true,stagedOperationsEnabled:true,defaultEntityId:"fixture-company",wsUrl:"https://doa-ui-fixture.invalid"}' })
  if (path === '/api/v1/users/me') return json({ id: actorId, email: 'qa@example.invalid', name: '示意客服', salesDataScope: 'ENTITY', effectivePermissions: ['after_sales_cases:read', 'after_sales_cases:update', 'mailroom:review'], roles: [{ role: { code: 'CUSTOMER_SERVICE', permissions: [] } }] })
  if (path === '/after-sales-app/api/integration/erp/logout') return route.fulfill({ status: 204 })
  if (path === '/api/v1/mailroom/intake-queue') return json({ items: [intake], total: 1, page: 1, limit: 30, scope: 'mine' })
  if (path === '/api/v1/mailroom/items/intake-a') return json(intake)
  if (path === '/api/v1/mailroom/source-cases') return json({ items: [], nextCursor: null })
  if (path === '/api/v1/repair-workbench/csr-queue') return json({ items: [], total: 0, page: 1, limit: 30 })
  if (path === '/api/v1/after-sales/module/launch') return json({ action: '/after-sales-app/api/integration/erp/session', ticket: 'fictional-source-ticket' })
  if (path === '/after-sales-app/api/integration/erp/session') return route.fulfill({ contentType: 'text/html', body: '<script>location.replace("/after-sales-app/cases")</script>' })
  if (path === '/after-sales-app/cases') return route.fulfill({ contentType: 'text/html', body: '<h1>示意售後案件中心</h1><script>window.parent.postMessage({source:"corely.aftersales.v1",ready:true,path:"/cases"},location.origin)</script>' })
  if (path === '/api/v1/after-sales/tasks/options') return json(options)
  if (path === '/api/v1/after-sales/tasks' && request.method() === 'GET') {
    const scoped = fixtures.filter(item => url.searchParams.get('scope') !== 'mine' || item.isMine)
    const items = scoped.filter(item => (!url.searchParams.get('type') || item.type === url.searchParams.get('type')) && (!url.searchParams.get('brand') || item.brand === url.searchParams.get('brand') || url.searchParams.get('brand') === 'UNKNOWN' && item.brand === null))
    return json({ contractVersion, page: 1, pageSize: 25, total: items.length, items, counts: { mine: 2, all: 3 }, capabilities: { createTypes: options.createTypes }, facets: { types: [], stages: [] } })
  }
  if (path === '/api/v1/after-sales/tasks/cases' && request.method() === 'POST') {
    createBody = request.postDataJSON(); created = row('created-case', createBody.payload.type, createBody.brand, true)
    createBodies.push(createBody)
    if (createBodies.length === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '案件結果待確認' }) })
    if (createBodies.length === 2) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: '示意後續權限變動' }) })
    return json({ contractVersion, item: created })
  }
  if (path.startsWith('/api/v1/after-sales/tasks/cases/') && request.method() === 'GET') {
    const item = [...fixtures, created].find(item => item?.id === path.split('/').at(-1))
    return json({ contractVersion, item, customer: { name: item.contact.name, phone: item.contact.phone, email: 'qa@example.invalid', address: '示意地址' }, notes: { internal: null, customerVisible: null }, details: { repair: { faultDescription: '示意故障現象', requiresPayment: false } }, finance: { payments: [], refunds: [], invoices: [] }, logistics: { incoming: [], outgoing: [] }, line: { brand: item.brand, identityBound: false, notificationEnabled: false }, history: [], tasks: [] })
  }
  if (path.startsWith('/api/v1/')) return json([])
  if (path.startsWith('/socket.io')) return route.abort()
  if (path.startsWith('/assets/')) {
    try { return route.fulfill({ contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'image/png', body: await readFile(join(dist, path)) }) } catch { return route.fulfill({ status: 404 }) }
  }
  if (path.startsWith('/brand/')) return route.fulfill({ status: 204 })
  return route.fulfill({ contentType: 'text/html', body: await readFile(join(dist, 'index.html')) })
}
await context.route('**/*', routeHandler)
const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message)); page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss())
async function check(label, callback) { await callback(); checks.push(label) }
try {
  await page.goto(origin + '/operations/after-sales/workbench?entityId=fixture-company')
  const app = page.locator('.native-after-sales')
  await app.getByRole('heading', { name: '售後工作台', exact: true }).waitFor()
  await app.locator('.native-after-sales-case-row').first().waitFor()
  await check('personal task scope is the default and excludes another owner', async () => { assert.equal(await app.locator('.native-after-sales-case-row').count(), 2); assert.equal(await app.getByRole('button', { name: /^待我處理/ }).getAttribute('aria-pressed'), 'true') })
  await check('repair filter does not widen personal scope', async () => { await app.locator('#native-after-sales-type').focus(); await app.locator('#native-after-sales-type').press('ArrowDown'); await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^檢測與維修$/ }).click(); await page.waitForURL(/type=REPAIR/); assert.equal(new URL(page.url()).searchParams.get('scope'), null); await page.waitForFunction(() => document.querySelectorAll('.native-after-sales-case-row').length === 1); assert.equal(await app.locator('.native-after-sales-case-row').count(), 1) })
  await check('all scope is an explicit action', async () => { await app.getByRole('button', { name: /^全部案件/ }).click(); await page.waitForURL(/scope=all/); await page.waitForFunction(() => document.querySelector('.native-after-sales-tab[aria-pressed="true"]')?.textContent.startsWith('全部案件')); assert.equal(await app.getByRole('button', { name: /^全部案件/ }).getAttribute('aria-pressed'), 'true') })
  await check('same-page case details retain separate money and custody facts', async () => { await app.getByRole('button', { name: 'case-repair', exact: true }).click(); await app.getByRole('heading', { name: 'case-repair', exact: true }).waitFor(); await app.getByText('實物保管', { exact: true }).waitFor(); await app.getByText('款項狀態', { exact: true }).waitFor(); assert.equal(await page.locator('iframe').count(), 0) })
  for (const width of [1366, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(100)
    await check(`case detail fits ${width}px`, async () => { const overflow = await app.evaluate(element => element.scrollWidth > element.clientWidth + 1); assert.equal(overflow, false) })
    await page.screenshot({ path: join(output, `native-detail-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 1000 })
  await app.getByRole('button', { name: '返回案件清單', exact: true }).click()
  await app.getByRole('button', { name: '新增案件', exact: true }).click()
  await check('one native chooser contains six case types', async () => { assert.equal(await app.locator('.native-after-sales-type-choice').count(), 6) })
  await app.locator('.native-after-sales-type-choice').filter({ hasText: '檢測與維修' }).click()
  await check('brand is not silently defaulted', async () => { assert.equal(await app.locator('#brand').inputValue(), ''); assert.equal(await app.getByRole('button', { name: '顧客資料與 LINE', exact: true }).isDisabled(), true) })
  async function select(id, label) { await app.locator(`#${id}`).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]').click(); await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: new RegExp(`^${label}$`) }).click(); await page.waitForTimeout(200) }
  await select('brand', 'BONSON'); await select('customerKind', '代理商／經銷商'); await select('sourceChannel', 'LINE')
  for (const [id, value] of Object.entries({ contactName: '示意經銷商', contactPhone: '0900000000', contactEmail: 'qa@example.invalid', contactAddress: '示意地址', reason: '示意故障現象', serialNumber: 'MOCK-SN' })) await app.locator(`#${id}`).fill(value)
  await app.getByRole('combobox', { name: '品項 1 產品', exact: true }).focus(); await app.getByRole('combobox', { name: '品項 1 產品', exact: true }).press('ArrowDown'); await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^示意產品 · MOCK-P1$/ }).click()
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(100); await check(`case registration fits ${width}px`, async () => assert.equal(await app.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)) }
  await check('native registration sends actual contract payload with stable identity and no premature repair authorization', async () => {
    await app.getByRole('button', { name: '建立案件', exact: true }).click()
    await app.getByRole('button', { name: '重試確認', exact: true }).waitFor()
    assert.equal(await app.locator('#contactName').isDisabled(), true)
    assert.equal(await app.getByRole('button', { name: '變更類型', exact: true }).isDisabled(), true)
    assert.equal(await app.getByRole('button', { name: '返回案件清單', exact: true }).isDisabled(), true)
    assert.equal(await app.getByRole('button', { name: /^取\s*消$/ }).isDisabled(), true)
  })
  await page.setViewportSize({ width: 1366, height: 1000 })
  await check('unknown registration blocks ordinary navigation without discard', async () => {
    const before = page.url()
    await page.getByRole('menuitem', { name: '售後客戶資料', exact: true }).click()
    await page.getByText('案件建立結果尚未確認，請先重試確認', { exact: true }).waitFor()
    assert.equal(page.url(), before)
    assert.equal(await page.getByRole('button', { name: '放棄修改', exact: true }).count(), 0)
  })
  await check('pending registration is isolated from another actor and resumes after logout and reload', async () => {
    const original = await page.evaluate(key => localStorage.getItem(key), pendingKey)
    assert.ok(original)
    await page.getByRole('button', { name: '帳號選單', exact: true }).click()
    await page.getByRole('menuitem', { name: /登出/ }).click()
    await page.waitForURL(/\/login/)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), pendingKey), original)
    actorId = 'other-user'
    await page.goto(origin + '/operations/after-sales/workbench?entityId=fixture-company')
    await app.getByRole('button', { name: '新增案件', exact: true }).waitFor()
    assert.equal(await app.getByRole('button', { name: '重試確認', exact: true }).count(), 0)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), pendingKey), original)
    actorId = 'qa-user'
    await page.reload()
    await app.getByRole('button', { name: '重試確認', exact: true }).waitFor()
    assert.equal(await app.locator('#contactName').inputValue(), '示意經銷商')
    await page.reload()
    await app.getByRole('button', { name: '重試確認', exact: true }).waitFor()
    assert.equal(await page.evaluate(key => localStorage.getItem(key), pendingKey), original)
    assert.equal(createBodies.length, 1)
  })
  await check('later known error cannot discard a previously unknown registration', async () => {
    await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/v1/after-sales/tasks/cases') && response.status() === 403), app.getByRole('button', { name: '重試確認', exact: true }).click()])
    await app.getByRole('button', { name: '重試確認', exact: true }).waitFor()
    assert.equal(await app.getByRole('button', { name: '返回案件清單', exact: true }).isDisabled(), true)
    assert.ok(await page.evaluate(key => localStorage.getItem(key), pendingKey))
    await page.reload()
    await app.getByRole('button', { name: '重試確認', exact: true }).waitFor()
    assert.equal(createBodies.length, 2)
  })
  await check('same UUID and original body are replayed and journal clears only after verified success', async () => {
    await app.getByRole('button', { name: '重試確認', exact: true }).click()
    await app.getByRole('heading', { name: 'created-case', exact: true }).waitFor()
    assert.deepEqual(createBodies[0], createBodies[1])
    assert.deepEqual(createBodies[0], createBodies[2])
    assert.equal(createBody.brand, 'BONSON'); assert.equal(createBody.customerKind, 'TO_B'); assert.equal(createBody.entityId, 'fixture-company'); assert.equal(createBody.payload.items[0].productId, 'ERP-P1'); assert.equal(createBody.payload.detail.requiresPayment, false); assert.equal(createBody.payload.detail.faultDescription, '示意故障現象'); assert.equal('receivedAt' in createBody.payload, false); assert.match(createBody.requestId, /^[0-9a-f-]{36}$/)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), pendingKey), null)
  })
  await check('verified intake URL restores selected receipt after Source case center return', async () => {
    await app.getByRole('button', { name: '返回案件清單', exact: true }).click()
    await page.getByText('部門交辦', { exact: true }).click()
    await page.getByRole('tab', { name: '收發交辦', exact: true }).click()
    await page.getByRole('button', { name: '檢視交辦', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '客服補建與原收件綁定', exact: true })
    await drawer.getByRole('button', { name: '開啟案件中心', exact: true }).click()
    await page.waitForURL(/\/cases\?.*intakeItemId=intake-a/)
    await page.getByRole('button', { name: '返回收件綁定', exact: true }).waitFor()
    await page.frameLocator('iframe').getByRole('heading', { name: '示意售後案件中心', exact: true }).waitFor()
    await page.getByRole('button', { name: '返回收件綁定', exact: true }).click()
    await page.waitForURL(/\/workbench\?.*intakeItemId=intake-a/)
    await drawer.getByText('MOCK-INTAKE-A · v1', { exact: true }).waitFor()
    assert.equal(await page.getByRole('tab', { name: '收發交辦', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(requested.filter(request => request.path === '/api/v1/after-sales/module/launch').length, 1)
  })
  await check('failed durable journal write prevents any native case POST', async () => {
    const failedStorageContext = await browser.newContext({ viewport: { width: 1366, height: 1000 } })
    await failedStorageContext.addInitScript(() => {
      localStorage.setItem('access_token', 'fictional-qa-token'); localStorage.setItem('entityId', 'fixture-company')
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) { if (key.startsWith('corely.doa.pending-registration.v1:')) throw new DOMException('fictional storage unavailable', 'QuotaExceededError'); return original.call(this, key, value) }
    })
    await failedStorageContext.route('**/*', routeHandler)
    const storagePage = await failedStorageContext.newPage()
    storagePage.on('pageerror', error => pageErrors.push(error.message))
    try {
      await storagePage.goto(origin + '/operations/after-sales/workbench?entityId=fixture-company')
      const form = storagePage.locator('.native-after-sales')
      await form.getByRole('button', { name: '新增案件', exact: true }).click()
      await form.locator('.native-after-sales-type-choice').filter({ hasText: '產品問題回報' }).click()
      async function choose(id, label) { await form.locator(`#${id}`).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]').click(); await storagePage.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: new RegExp(`^${label}$`) }).click(); await storagePage.waitForTimeout(200) }
      await choose('brand', 'MOZTECH'); await choose('sourceChannel', 'LINE')
      await form.locator('#reason').fill('示意內部問題')
      await form.getByRole('combobox', { name: '品項 1 產品', exact: true }).focus(); await form.getByRole('combobox', { name: '品項 1 產品', exact: true }).press('ArrowDown'); await storagePage.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^示意產品 · MOCK-P1$/ }).click()
      const before = createBodies.length
      await form.getByRole('button', { name: '建立案件', exact: true }).click()
      await form.getByText('建單資料未能保存，尚未送出', { exact: true }).waitFor()
      assert.equal(createBodies.length, before)
      assert.equal(await form.getByRole('button', { name: '返回案件清單', exact: true }).isDisabled(), false)
    } finally { await failedStorageContext.close() }
  })
  assert.deepEqual(pageErrors, [])
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ scope: 'offline fictional browser fixtures only; no DEV authentication or business effects', pass: true, checks, pageErrors, requests: requested }, null, 2))
  console.log(JSON.stringify({ pass: true, checks: checks.length, evidence: output }))
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ pass: false, checks, error: error.message, pageErrors, requests: requested }, null, 2))
  throw error
} finally { await browser.close() }
