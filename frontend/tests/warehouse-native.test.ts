import assert from 'node:assert/strict'
import test from 'node:test'
import axios from 'axios'
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import type { NativeWarehouseSession, WarehouseManifest, WarehouseModule } from '../src/services/warehouse-native'

const origin = 'https://corely-wms-dev-sp5g377smq-de.a.run.app'
const storage = new Map<string, string>([['access_token', 'erp-only-fixture']])
const location = { origin: 'https://erp.example.invalid', pathname: '/warehouse', href: 'https://erp.example.invalid/warehouse' }
Object.defineProperty(globalThis, 'window', { configurable: true, value: { __APP_CONFIG__: { apiUrl: 'https://erp.example.invalid/api/v1', devEnvironment: true, wmsPortalUrl: origin }, location } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } })
const { nativeEntryPath, nativeHostSection, nativeWorkPath, warehouseManifest, loadWarehouseModule, nativeTransport, nativeSessionExpired } = await import('../src/services/warehouse-native.ts')
const { companyNavigationDestination } = await import('../src/config/workspaces.ts')

const session: NativeWarehouseSession = { accessToken: 'warehouse.only.fixture', destination: '/tasks?group=pick', user: { id: 41, role: 'picker', erpSubject: 'erp-fixture-user', entityId: 'warehouse-dev' } }
const actor = { token: 'erp-only-fixture', entityId: 'warehouse-dev' }
const manifest = (entry = '/assets/workspace-test.js'): WarehouseManifest => ({ version: 1, sourceCommit: 'a'.repeat(40), entry, styles: ['/assets/workspace-test.css'], portalStyles: ['/assets/portal-test.css'] })
const response = (config: AxiosRequestConfig, data: unknown = {}, status = 200): AxiosResponse => ({ data, status, statusText: 'Fixture', headers: { 'content-type': 'application/json' }, config: config as AxiosResponse['config'] })
const client = (request: (config: AxiosRequestConfig) => Promise<AxiosResponse>, post?: (url: string, data: unknown, config: AxiosRequestConfig) => Promise<AxiosResponse>) => ({ request, post: post || (async (url, data, config) => request({ ...config, url, data, method: 'post' })) }) as AxiosInstance
const safeHeaders = { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }
const abortError = (error: unknown) => error instanceof Error && error.name === 'AbortError'
const noErpCredential = (value: unknown) => assert(!JSON.stringify(value).includes(actor.token), 'ERP bearer must remain in the host transport only')

test('typed warehouse navigation keeps source context and the explicit company on return routes', () => {
  const cases = [
    ['/tasks?group=pick', '/warehouse', '/warehouse/picking'],
    ['/tasks?group=pack', '/warehouse', '/warehouse/packing'],
    ['/tasks?view=completed', '/warehouse', '/warehouse/completed'],
    ['/warehouse-intakes/17', '/warehouse/marketplace', '/warehouse/intakes'],
    ['/team/17', '/warehouse/picking', '/warehouse/team'],
    ['/order/17', '/warehouse/picking', '/warehouse/picking'],
    ['/batches/17', '/warehouse/marketplace', '/warehouse/marketplace'],
    ['/admin/exceptions', '/warehouse/picking', '/warehouse/exceptions'],
  ]
  for (const [path, current, expected] of cases) {
    assert.equal(nativeHostSection(path, current), expected)
    const target = companyNavigationDestination(`${expected}?wms=${encodeURIComponent(path)}`, '?entityId=warehouse-dev')
    const query = new URL(target, location.origin).searchParams
    assert.equal(query.get('entityId'), 'warehouse-dev'); assert.equal(query.get('wms'), path)
    assert.equal(nativeEntryPath(expected, '?' + query), path)
  }
  assert.equal(nativeEntryPath('/warehouse/workstation', ''), '/tasks')
  assert.equal(nativeEntryPath('/warehouse/picking', '?wms=' + encodeURIComponent('/admin/users')), null)
  for (const path of ['https://evil.invalid/tasks', '//evil.invalid/tasks', '/tasks?token=secret', '/tasks?authorization=secret', '/orders/17', '/order/0', '/order/%31', '/tasks\\evil', '/tasks\u0000']) assert.equal(nativeWorkPath(path), null)
})

test('plain intake return uses only the verified station role and preserves company in the next session route', () => {
  for (const [role, expected] of [
    ['picker', '/warehouse/picking'], ['packer', '/warehouse/packing'],
    ['admin', '/warehouse'], ['dispatcher', '/warehouse'], ['viewer', '/warehouse'], ['unknown', '/warehouse'], [undefined, '/warehouse'],
  ] as const) {
    const path = '/tasks?page=2#work'
    assert.equal(nativeHostSection(path, '/warehouse/intakes', role), expected)
    const target = new URL(companyNavigationDestination(`${expected}?wms=${encodeURIComponent(path)}`, '?entityId=warehouse-dev'), location.origin)
    assert.equal(target.pathname, expected); assert.equal(target.searchParams.get('entityId'), 'warehouse-dev')
    assert.equal(target.searchParams.get('wms'), path); assert.equal(nativeEntryPath(expected, target.search), path)
  }
  for (const role of ['picker', 'packer', 'admin', 'dispatcher', 'viewer', undefined]) {
    assert.equal(nativeHostSection('/tasks?group=pick', '/warehouse/intakes', role), '/warehouse/picking')
    assert.equal(nativeHostSection('/tasks?group=pack', '/warehouse/intakes', role), '/warehouse/packing')
    assert.equal(nativeHostSection('/tasks?view=completed', '/warehouse/intakes', role), '/warehouse/completed')
    for (const explicit of ['/tasks?group=', '/tasks?group=other', '/tasks?view=', '/tasks?view=active']) {
      assert.equal(nativeHostSection(explicit, '/warehouse/intakes', role), '/warehouse')
    }
    assert.equal(nativeHostSection('/tasks', '/warehouse/marketplace', role), '/warehouse')
    assert.equal(nativeHostSection('/tasks', '/warehouse/picking', role), '/warehouse/picking')
    assert.equal(nativeHostSection('/tasks', '/warehouse/packing', role), '/warehouse/packing')
    assert.equal(nativeHostSection('/order/17', '/warehouse/intakes', role), '/warehouse/intakes')
  }
})

test('manifest validation limits entry and styles to immutable local assets with an exact SHA', () => {
  const valid = manifest(); assert.deepEqual(warehouseManifest(valid), valid)
  const parsed = warehouseManifest(valid); parsed.styles.push('/assets/extra.css'); assert.equal(valid.styles.length, 1)
  for (const invalid of [null, { ...valid, version: 2 }, { ...valid, sourceCommit: 'latest' }, { ...valid, sourceCommit: 'A'.repeat(40) }, { ...valid, entry: 'https://evil.invalid/app.js' }, { ...valid, entry: '/assets/../app.js' }, { ...valid, entry: '/assets/app.js?token=secret' }, { ...valid, styles: [] }, { ...valid, portalStyles: ['/assets/%2f.css'] }, { ...valid, styles: Array.from({ length: 9 }, () => '/assets/sheet.css') }]) assert.throws(() => warehouseManifest(invalid), /不完整/)
})

test('module loader imports only the paired origin, checks source SHA and forwards cancellation to manifest fetch', async t => {
  const valid = manifest('/assets/workspace-load-valid.js'), abort = new AbortController(), fetched: string[] = [], imported: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => { fetched.push(String(url)); assert.equal(options.signal, abort.signal); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); return new Response(JSON.stringify(valid), { headers: { 'content-type': 'application/json' } }) })
  const module = { sourceCommit: valid.sourceCommit, mountWorkspace: async () => ({ navigate() {}, dispose() {} }) } as WarehouseModule
  for (const invalid of ['', 'https://evil.invalid', origin + '/other', 'https://corely-wms-sp5g377smq-de.a.run.app']) await assert.rejects(loadWarehouseModule(invalid, abort.signal, async () => module), /未設定/)
  assert.equal(fetched.length, 0)
  const loaded = await loadWarehouseModule(origin, abort.signal, async url => { imported.push(url); return module })
  assert.equal(loaded.module, module); assert.deepEqual(imported, [origin + valid.entry]); assert.deepEqual(fetched, [origin + '/workspace-manifest.json'])
  await loadWarehouseModule(origin, abort.signal, async () => { throw new Error('cached module should not import twice') })
  assert.equal(imported.length, 1)
})

test('module loader rejects an invalid asset, mismatched source and cancellation before/after import', async t => {
  let data = manifest('/assets/workspace-sha-mismatch.js'), imported = 0
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(data)))
  const wrongModule = { sourceCommit: 'b'.repeat(40), mountWorkspace: async () => ({ navigate() {}, dispose() {} }) } as WarehouseModule
  await assert.rejects(loadWarehouseModule(origin, new AbortController().signal, async () => { imported++; return wrongModule }), /版本已更新/)
  data = { ...data, entry: '/api/auth/me' }; await assert.rejects(loadWarehouseModule(origin, new AbortController().signal, async () => { imported++; return wrongModule }), /不完整/); assert.equal(imported, 1)
  data = manifest('/assets/workspace-cancel-before-import.js'); const already = new AbortController(); already.abort()
  await assert.rejects(loadWarehouseModule(origin, already.signal, async () => { imported++; return wrongModule }), abortError); assert.equal(imported, 1)
  data = manifest('/assets/workspace-cancel-after-import.js'); const during = new AbortController()
  await assert.rejects(loadWarehouseModule(origin, during.signal, async () => { during.abort(); return wrongModule }), abortError)
})

test('command transport preserves UUID, original body, query, revisions, response and the WMS config identity', async () => {
  const lifecycle = new AbortController(), uuid = '91f8e07b-eef0-4d04-ad9a-966cdfc510b1'
  const body = { commandId: uuid, expectedActor: 41, expectedRevision: 12, state: 'picking', scanValue: 'TEST-SN' }, params = { source: 'TEST:1', page: 2 }, serializer = (values: unknown) => JSON.stringify(values)
  const original: AxiosRequestConfig = { url: '/api/orders/update_item?mode=normal', method: 'post', data: body, params, paramsSerializer: serializer, headers: safeHeaders, timeout: 7500, responseType: 'json', validateStatus: status => status === 409 }
  let calls = 0
  const transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => {
    calls++; assert.equal(config.url, '/wms/native/proxy/api/orders/update_item?mode=normal'); assert.equal(config.method, 'post'); assert.equal(config.data, body); assert.equal(config.params, params); assert.equal(config.paramsSerializer, serializer); assert.equal(config.timeout, 7500); assert.equal(config.validateStatus, original.validateStatus); assert.equal(config.withCredentials, false)
    const headers = axios.AxiosHeaders.from(config.headers); assert.equal(headers.get('Authorization'), `Bearer ${actor.token}`); assert.equal(headers.get('X-WMS-Session'), session.accessToken); assert.equal(headers.get('X-WMS-Entity'), actor.entityId)
    return response(config, { code: 'REVISION_CONFLICT', commandId: uuid }, 409)
  }))
  const result = await transport.request(original); assert.equal(calls, 1); assert.equal(result.status, 409); assert.equal(result.data.commandId, uuid); assert.equal(result.config, original); noErpCredential(result.config); assert.equal(body.commandId, uuid)
})

test('multipart and protected blob transport preserve file identity and leave boundary generation to Axios', async () => {
  const lifecycle = new AbortController(), form = new FormData(), file = new Blob(['TEST,SKU,3\n'], { type: 'text/csv' }); form.set('requestId', '91f8e07b-eef0-4d04-ad9a-966cdfc510b1'); form.set('file', file, 'TEST-import.csv')
  const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), recorded: AxiosRequestConfig[] = []
  const transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => { recorded.push(config); return response(config, config.responseType === 'blob' ? blob : { imported: true }) }))
  await transport.request({ url: '/api/orders/import', method: 'post', data: form, headers: { ...safeHeaders, 'Content-Type': 'multipart/form-data; boundary=stale' } })
  assert.equal(recorded[0].data, form); assert.equal(axios.AxiosHeaders.from(recorded[0].headers).has('Content-Type'), false); assert.equal((form.get('file') as File).name, 'TEST-import.csv'); assert.equal(form.get('requestId'), '91f8e07b-eef0-4d04-ad9a-966cdfc510b1')
  const result = await transport.request({ url: '/api/reports/export', responseType: 'blob', headers: safeHeaders }); assert.equal(result.data, blob); assert.equal(recorded[1].responseType, 'blob'); noErpCredential(result.config)
})

test('request failures keep the original WMS config and never expose ERP credentials or auto-resubmit', async () => {
  const lifecycle = new AbortController(), original: AxiosRequestConfig = { url: '/api/orders/update_item', method: 'post', data: { commandId: 'unchanged-request-id' }, headers: safeHeaders }
  let calls = 0
  const transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => { calls++; throw new axios.AxiosError('upstream denied', 'ERR_BAD_REQUEST', config as AxiosResponse['config'], undefined, response(config, { code: 'REVISION_CONFLICT' }, 409)) }))
  await assert.rejects(transport.request(original), (error: unknown) => { const failure = error as import('axios').AxiosError; assert.equal(failure.config, original); assert.equal(failure.response?.config, original); assert.equal(failure.response?.status, 409); noErpCredential(failure.toJSON()); return true }); assert.equal(calls, 1)
})

test('marketplace XLSX downloads return the Blob and safe WMS-only config on both success and failure', async () => {
  const lifecycle = new AbortController(), blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]), received: AxiosRequestConfig[] = []
  const transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => { received.push(config); return { ...response(config, blob), headers: { 'content-disposition': "attachment; filename*=UTF-8''%E9%A0%90%E6%8F%80.xlsx" } } }))
  const result = await transport.download({ id: 17, kind: 'prepick' }); assert.equal(result.data, blob); assert.equal(received[0].url, '/wms/native/files/17/prepick'); assert.equal(received[0].responseType, 'blob'); assert.equal(received[0].signal, lifecycle.signal); assert.equal(result.config.url, '/api/marketplace-intakes/17/download-link'); noErpCredential(result.config); assert.equal(axios.AxiosHeaders.from(result.config.headers).get('Authorization'), `Bearer ${session.accessToken}`)
  const failing = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => { throw new axios.AxiosError('expired', 'ERR_BAD_REQUEST', config as AxiosResponse['config'], undefined, response(config, new Blob(['expired']), 401)) }))
  await assert.rejects(failing.download({ id: 17, kind: 'prepick' }), (error: unknown) => { const failure = error as import('axios').AxiosError; noErpCredential(failure.config); noErpCredential(failure.response?.config); noErpCredential(failure.toJSON()); assert.equal(failure.response?.status, 401); return true })
  for (const input of [{ id: 0, kind: 'prepick' }, { id: NaN, kind: 'prepick' }, { id: 17, kind: '../auth' }]) await assert.rejects(transport.download(input), /無效/)
})

test('actor changes and already-aborted lifecycles block calls and discard late responses', async () => {
  const lifecycle = new AbortController(); let active = false, calls = 0
  const transport = nativeTransport(actor, session, () => active, lifecycle.signal, client(async config => { calls++; active = false; return response(config) }))
  await assert.rejects(transport.request({ url: '/api/tasks' }), abortError); await assert.rejects(transport.download({ id: 17, kind: 'prepick' }), abortError); assert.equal(calls, 0)
  active = true; await assert.rejects(transport.request({ url: '/api/tasks' }), abortError); assert.equal(calls, 1)
  active = true; lifecycle.abort(); await assert.rejects(transport.request({ url: '/api/tasks' }), abortError); assert.equal(calls, 1)
})

test('caller and workspace cancellation both abort the outgoing transport without a retry', async () => {
  for (const cancelCaller of [true, false]) {
    const lifecycle = new AbortController(), caller = new AbortController(); let calls = 0, outgoing: AbortSignal | undefined
    const transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => {
      calls++; outgoing = config.signal as AbortSignal
      return new Promise((_resolve, reject) => outgoing!.addEventListener('abort', () => reject(new DOMException('fixture canceled', 'AbortError')), { once: true }))
    }))
    const pending = transport.request({ url: '/api/tasks', signal: caller.signal }); (cancelCaller ? caller : lifecycle).abort(); await assert.rejects(pending, abortError); assert.equal(outgoing?.aborted, true); assert.equal(calls, 1)
  }
})

test('invalid API targets or a foreign WMS token are rejected before ERP headers can leave the host', async () => {
  let calls = 0; const lifecycle = new AbortController(), transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => { calls++; return response(config) }))
  for (const url of ['https://evil.invalid/api/tasks', '//evil.invalid/api/tasks', '/api/orders/../auth/login', '/api/orders/%2e%2e/auth/login', '/api//orders', '/api/orders/1#token=secret', '/api/orders\\other', '/api/orders/1\n']) await assert.rejects(transport.request({ url }), /路徑無效/)
  await assert.rejects(transport.request({ url: '/api/tasks', headers: { Authorization: 'Bearer someone-elses-wms-token' } }), /身分已變更/); assert.equal(calls, 0)
})

test('WMS 401 does not remove the separate ERP login, redirect the page or resend the operation', async () => {
  storage.set('access_token', actor.token); location.href = 'https://erp.example.invalid/warehouse'; let calls = 0
  const lifecycle = new AbortController(), transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => { calls++; throw new axios.AxiosError('warehouse session revoked', 'ERR_BAD_REQUEST', config as AxiosResponse['config'], undefined, response(config, { code: 'WMS_SESSION_EXPIRED' }, 401)) }))
  await assert.rejects(transport.request({ url: '/api/tasks', headers: safeHeaders }), (error: unknown) => (error as import('axios').AxiosError).response?.status === 401)
  assert.equal(storage.get('access_token'), actor.token); assert.equal(location.href, 'https://erp.example.invalid/warehouse'); assert.equal(calls, 1)
})

test('small JSON Blob failures distinguish warehouse expiry from ordinary permission denial without decoding a workbook', async () => {
  const lifecycle = new AbortController()
  for (const [status, data, expired] of [
    [401, { message: '作業身分已失效' }, true],
    [403, { code: 'WMS_SESSION_EXPIRED' }, true],
    [403, { message: 'Token 無效或已過期' }, true],
    [403, { code: 'FORBIDDEN', message: '沒有此儲運操作權限' }, false],
    [503, { code: 'AUTH_UNAVAILABLE' }, false],
  ] as const) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => {
      throw new axios.AxiosError('synthetic download failed', 'ERR_BAD_REQUEST', config as AxiosResponse['config'], undefined, response(config, blob, status))
    }))
    await assert.rejects(transport.download({ id: 17, kind: 'prepick' }), (error: unknown) => {
      const failure = error as import('axios').AxiosError
      assert.deepEqual(failure.response?.data, data); assert.equal(nativeSessionExpired(failure), expired)
      noErpCredential(failure.config); noErpCredential(failure.response?.config); return true
    })
  }
  for (const blob of [new Blob(['not JSON'], { type: 'application/octet-stream' }), new Blob([JSON.stringify({ code: 'WMS_SESSION_EXPIRED', detail: 'x'.repeat(16001) })], { type: 'application/json' })]) {
    const transport = nativeTransport(actor, session, () => true, lifecycle.signal, client(async config => {
      const failed = response(config, blob, 403); failed.headers = { 'content-type': blob.type }
      throw new axios.AxiosError('synthetic bounded failure', 'ERR_BAD_REQUEST', config as AxiosResponse['config'], undefined, failed)
    }))
    await assert.rejects(transport.download({ id: 17, kind: 'prepick' }), (error: unknown) => (error as import('axios').AxiosError).response?.data === blob)
  }
})
