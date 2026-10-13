import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const require = createRequire(new URL('../../backend/package.json', import.meta.url)), { chromium } = require('playwright');
const origin = 'https://application-fixture.invalid', dist = fileURLToPath(new URL('../dist', import.meta.url)), output = '/private/tmp/doa-applications-offline-20261013';
const actor = 'qa-user', entity = 'fixture-company', id = 'e187ba12-9733-4d4c-a512-90e773f4d837', erpProductId = '69b793b1-c79e-4d86-b4d9-e46f7b829e01';
const token = who => Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: who })).toString('base64url') + '.fictional';
let posts = [], queries = [], errors = [], checks = [], inviteMode = 'unknown', reviewMode = 'unknown', createMode = 'unknown', mapping = true;
let application = { id, companyId: entity, brand: 'MOZTECH', type: 'REPAIR', status: 'SUBMITTED', revision: 1, caseId: null, contactName: '示意顧客', productDescription: '不確定型號的行動電源', photoCount: 1,
  submittedData: { name: '示意顧客', phone: '0900000000', address: '虛構測試地址', email: 'fixture@example.invalid', productDescription: '不確定型號的行動電源', faultDescription: '不能充電', photos: [{ index: 0, name: 'fixture.png' }] } };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true }), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await context.addInitScript(value => { localStorage.setItem('access_token', value); localStorage.setItem('entityId', 'fixture-company'); }, token(actor));
const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.origin !== origin) return route.abort();
  if (path === '/config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.__APP_CONFIG__={apiUrl:"/api/v1",afterSalesModuleEnabled:true,mailroomEnabled:true,stagedOperationsEnabled:true,defaultEntityId:"fixture-company"}' });
  if (path === '/api/v1/users/me') return json({ id: actor, name: '示意客服', email: 'fixture@example.invalid', salesDataScope: 'ENTITY', effectivePermissions: ['after_sales_cases:read','after_sales_cases:create','after_sales_cases:update'], roles: [{ role: { code: 'CUSTOMER_SERVICE', permissions: [] } }] });
  if (path === '/api/v1/after-sales/tasks/options') return json({ canReadAll: true, createTypes: ['REPAIR'], brands: [{ value: 'MOZTECH', label: 'MOZTECH' }, { value: 'BONSON', label: 'BONSON' }], products: [{ id: 'source-product', name: '已核對行動電源', sku: 'MOCK-SKU', ...(mapping ? { erpProductId } : {}) }], sourceChannels: [{ value: 'LINE', label: '品牌 LINE' }], customerKinds: [{ value: 'TO_C', label: '一般顧客' }], reasonOptions: {} });
  if (path === '/api/v1/after-sales/tasks') return json({ items: [], counts: { mine: 0, all: 0 }, total: 0 });
  if (path === '/api/v1/after-sales/tasks/applications' && req.method() === 'GET') { queries.push(url.search); return json({ items: [application], nextCursor: url.searchParams.has('cursor') ? null : 'opaque-fixture-cursor', hasMore: !url.searchParams.has('cursor'), limit: 100 }); }
  if (path === '/api/v1/after-sales/tasks/applications/' + id && req.method() === 'GET') return json(application);
  if (path.includes('/photos/0')) return json({ photo: { name: 'fixture.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZxoAAAAASUVORK5CYII=' } });
  if (path.startsWith('/api/v1/after-sales/tasks/applications') && req.method() === 'POST') {
    const body = req.postDataJSON(); posts.push({ path, body }); assert.equal(body.entityId, entity); assert.equal(req.headers()['x-doa-actor'], actor); assert.equal(req.headers().authorization, 'Bearer ' + token(actor));
    const command = body.command;
    const journal = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), 'corely.doa.pending-application.v1:qa-user:fixture-company'); assert.deepEqual(journal.command, command);
    if (command.operation === 'CREATE_INVITE') return inviteMode === 'unknown' ? json({ message: '邀請結果待確認' }, 503) : json({ id: command.requestId, status: 'INVITED', url: origin + '/customer/apply/moztech#token=fictional', providerMode: 'DEV_STUB' });
    if (reviewMode === 'unknown') return json({ message: '審核結果待確認' }, 503);
    application = { ...application, status: command.approve ? 'REVIEWED' : 'REJECTED', revision: 2, reviewNote: command.note, verifiedApplicationRef: { id, revision: 2, reviewHash: 'a'.repeat(64) }, nativeCreateDraft: { type: command.type, contactName: command.profile.name, contactPhone: command.profile.phone, contactAddress: command.profile.address, contactEmail: command.profile.email,
      items: command.items.map(i => ({ productId: i.sourceProductId, erpProductId: i.erpProductId, quantity: i.quantity, name: '已核對行動電源', sku: 'MOCK-SKU' })), detail: { faultDescription: command.profile.faultDescription } } };
    return json(application);
  }
  if (path === '/api/v1/after-sales/tasks/cases' && req.method() === 'POST') {
    const body = req.postDataJSON(); posts.push({ path, body }); assert.deepEqual(body.verifiedApplicationRef, application.verifiedApplicationRef); assert.deepEqual(body.payload.items, [{ productId: 'source-product', quantity: 1 }]);
    const journal = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), 'corely.doa.pending-registration.v1:qa-user:fixture-company'); assert.equal(journal.requestId, body.requestId); assert.deepEqual(journal.request.verifiedApplicationRef, body.verifiedApplicationRef);
    if (createMode === 'unknown') return json({ message: '建單結果待確認' }, 503);
    return json({ item: { id: 'case-from-application' } });
  }
  if (path === '/api/v1/after-sales/tasks/cases/case-from-application') return json({ item: { id: 'case-from-application', number: 'SYNTHETIC-APP-CASE', type: 'REPAIR', status: 'DRAFT', brand: 'MOZTECH', contact: { name: '示意顧客', phone: '0900000000' }, products: [], owner: null, serialNumber: null, updatedAt: '2026-10-13T00:00:00.000Z', workflow: { queue: 'csr', stageLabel: '待客服', nextAction: null } }, customer: {}, notes: {}, details: {}, finance: {}, logistics: {}, line: {}, history: [] });
  if (path.startsWith('/api/v1/')) return json([]);
  if (path.startsWith('/socket.io')) return route.abort();
  if (path.startsWith('/assets/')) return route.fulfill({ contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'image/png', body: await readFile(join(dist, path)) });
  return route.fulfill({ contentType: 'text/html', body: await readFile(join(dist, 'index.html')) });
});
const url = origin + '/operations/after-sales/workbench?entityId=' + entity + '&workbenchView=applications';
const load = async () => { await page.goto(url); await page.locator('.native-customer-applications').waitFor(); await page.waitForTimeout(200); };
try {
  await load(); await page.locator('[data-operation-action="after_sales.application.invite.open"]').click();
  const drawer = page.locator('.ant-drawer-open .ant-drawer-body'); await drawer.getByRole('combobox', { name: '填單品牌', exact: true }).click(); await page.locator('.ant-select-dropdown .ant-select-item-option-content').getByText('MOZTECH', { exact: true }).click();
  await drawer.getByRole('combobox', { name: '填單案件類型', exact: true }).click(); await page.locator('.ant-select-dropdown .ant-select-item-option-content').getByText('檢測與維修', { exact: true }).click();
  await page.locator('[data-operation-action="after_sales.application.invite.create"]').click(); await page.getByText('邀請結果待確認', { exact: true }).waitFor(); const invitation = posts.at(-1).body.command;
  inviteMode = 'success'; await load(); await page.locator('[data-operation-action="after_sales.application.retry"]').click(); await page.getByLabel('顧客填單連結').waitFor(); assert.deepEqual(posts.at(-1).body.command, invitation); checks.push('invite unknown reload reuses durable UUID and link fragment remains outside journal');
  await page.locator('[data-operation-action="after_sales.application.next"]').click(); await page.waitForTimeout(150); assert(queries.some(q => q.includes('cursor=opaque-fixture-cursor'))); checks.push('bounded keyset next page is not silently capped at 100');
  mapping = false; await load(); await page.locator('[data-operation-action="after_sales.application.open"]').click(); await page.getByText('第 1 版', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: '核對產品 1', exact: true }).click(); await page.locator('.ant-select-dropdown .ant-select-item-option-content').getByText('已核對行動電源 · MOCK-SKU', { exact: true }).click(); await page.getByLabel('審核備註', { exact: true }).fill('已核對照片'); const before = posts.length;
  await page.locator('[data-operation-action="after_sales.application.review.approve"]').click(); await page.getByText('請搜尋並選擇已完成 ERP 對應的產品', { exact: true }).waitFor(); assert.equal(posts.length, before); checks.push('missing authoritative ERP mapping blocks approval before any POST');
  mapping = true; await load(); await page.locator('[data-operation-action="after_sales.application.open"]').click(); await page.getByRole('combobox', { name: '核對產品 1', exact: true }).click(); await page.locator('.ant-select-dropdown .ant-select-item-option-content').getByText('已核對行動電源 · MOCK-SKU', { exact: true }).click(); await page.getByLabel('審核備註', { exact: true }).fill('已核對照片');
  await page.locator('[data-operation-action="after_sales.application.photo"]').click(); await page.getByAltText('顧客提交的產品外觀').waitFor(); await page.locator('.ant-drawer-close').last().click(); checks.push('single protected photo preview requested on demand');
  await page.locator('[data-operation-action="after_sales.application.review.approve"]').click(); await page.getByText('審核結果待確認', { exact: true }).waitFor(); const review = posts.at(-1).body.command; assert.equal(review.expectedRevision, 1); assert.deepEqual(review.items, [{ sourceProductId: 'source-product', erpProductId, quantity: 1 }]); assert.equal(posts.filter(p => p.path.endsWith('/cases')).length, 0);
  reviewMode = 'success'; await load(); await page.locator('[data-operation-action="after_sales.application.retry"]').click(); await page.locator('[data-operation-action="after_sales.application.create_case"]').waitFor(); assert.deepEqual(posts.at(-1).body.command, review); checks.push('review unknown retains body/revision and does not create case');
  await page.locator('[data-operation-action="after_sales.application.create_case"]').click(); await page.locator('.native-after-sales-create-form').waitFor(); assert.equal(await page.getByLabel('姓名／聯絡人', { exact: true }).inputValue(), '示意顧客');
  await page.getByRole('button', { name: '建立案件', exact: true }).click(); await page.getByText('案件建立結果尚未確認，請重試確認', { exact: true }).waitFor(); const registration = posts.at(-1).body;
  createMode = 'success'; await page.reload(); await page.getByRole('button', { name: '重試確認', exact: true }).click(); await page.getByText('SYNTHETIC-APP-CASE', { exact: true }).waitFor(); assert.deepEqual(posts.at(-1).body, registration); checks.push('reviewed profile prefill keeps proof in existing create journal and retries same UUID after reload');
  assert.deepEqual(errors, []); await mkdir(output, { recursive: true }); await writeFile(join(output, 'receipt.json'), JSON.stringify({ pass: true, checks, postCount: posts.length, errors, origin, scope: 'offline fixtures; zero DEV/provider/database effects' }, null, 2)); console.log(JSON.stringify({ pass: true, checks: checks.length, evidence: output }));
} catch (e) { await mkdir(output, { recursive: true }); await writeFile(join(output, 'failure.html'), await page.content()); await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); console.error('Fixture failure evidence: ' + output); throw e; } finally { await browser.close(); }
