import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  AFTER_SALES_LOGOUT_ORIGINS, AFTER_SALES_LOGOUT_PATH, AFTER_SALES_LOGOUT_TIMEOUT_MS,
  clearAfterSalesBrowserSession, clearInvalidErpSession, completeErpLogin, completeErpLogout,
} from '../src/services/after-sales-logout'
import {
  AFTER_SALES_LOGOUT_ORIGINS as serverOrigins, AFTER_SALES_LOGOUT_PATH as serverPath,
  handleAfterSalesLogout,
} from '../server.mjs'

const origin = AFTER_SALES_LOGOUT_ORIGINS[1]
const host = new URL(origin).host
function request(method = 'POST', from: string | null = origin, requestHost = host, cookie = '') {
  let status = 0, headers: Record<string, string | string[]> = {}, ended = false
  const handled = handleAfterSalesLogout({ method, headers: { origin: from ?? undefined, host: requestHost, cookie } }, {
    writeHead(code: number, values: Record<string, string | string[]>) { status = code; headers = values },
    end() { ended = true },
  }, new URL(origin + serverPath))
  return { handled, status, headers, ended }
}

test('only POST from the same one of three fixed ERP DEV origins clears the module cookie', () => {
  assert.deepEqual(serverOrigins, AFTER_SALES_LOGOUT_ORIGINS)
  assert.equal(serverPath, AFTER_SALES_LOGOUT_PATH)
  for (const allowed of serverOrigins) {
    const response = request('POST', allowed, new URL(allowed).host)
    assert.equal(response.status, 204)
    assert.equal(response.ended, true)
    assert.equal(response.headers['Cache-Control'], 'no-store')
  }
  for (const from of [null, 'null', 'https://pay.corely.cc', 'https://example.invalid', origin + '/', 'http://' + host]) {
    const response = request('POST', from)
    assert.equal(response.status, 403)
    assert.equal(response.headers['Set-Cookie'], undefined)
  }
  assert.equal(request('POST', origin, new URL(serverOrigins[0]).host).status, 403)
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = request(method)
    assert.equal(response.status, 405)
    assert.equal(response.headers.Allow, 'POST')
    assert.equal(response.headers['Set-Cookie'], undefined)
  }
})

test('logout expires the base cookie and only its present numeric chunks at the original path', () => {
  const response = request('POST', origin, host,
    '__Secure-erp-aftersales-session=synthetic; __Secure-erp-aftersales-session.0=a; __Secure-erp-aftersales-session.1=b; __Secure-erp-aftersales-session.1=duplicate; __Secure-erp-aftersales-session.bad=c; other=keep; __Secure-erp-aftersales-session-extra=keep')
  const cookies = response.headers['Set-Cookie'] as string[]
  assert.deepEqual(cookies.map(value => value.split('=', 1)[0]), [
    '__Secure-erp-aftersales-session', '__Secure-erp-aftersales-session.0', '__Secure-erp-aftersales-session.1',
  ])
  for (const cookie of cookies) {
    assert.match(cookie, /=; Path=\/after-sales-app; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT$/)
    assert.doesNotMatch(cookie, /Domain=/)
  }
  assert.equal((request().headers['Set-Cookie'] as string[]).length, 1)
})

test('the fixed local logout is intercepted before upstream proxy and has no module flag dependency', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.ok(server.indexOf('if (handleAfterSalesLogout(req, res, requestUrl)) return') < server.indexOf("const upstream = process.env.AFTER_SALES_MODULE_URL"))
  let touched = false
  assert.equal(handleAfterSalesLogout({ headers: {} }, { writeHead() { touched = true } }, new URL(origin + '/after-sales-app/cases')), false)
  assert.equal(touched, false)
})

test('normal logout awaits cookie clearing and WMS completion before clearing local identity', async () => {
  const events: string[] = []
  let resolveClear!: () => void
  const clear = new Promise<void>(resolve => { resolveClear = resolve })
  const pending = completeErpLogout({
    clearModuleSession: () => { events.push('clear'); return clear },
    logoutWms: async () => { events.push('wms') },
    logoutLocal: () => { events.push('local') },
  })
  assert.deepEqual(events, ['clear'])
  resolveClear(); await pending
  assert.deepEqual(events, ['clear', 'wms', 'local'])
})

test('cookie or WMS failure preserves the local logged-in identity and is retryable', async () => {
  for (const failingStage of ['clear', 'wms']) {
    const events: string[] = []
    await assert.rejects(completeErpLogout({
      clearModuleSession: async () => { events.push('clear'); if (failingStage === 'clear') throw new Error('retry') },
      logoutWms: async () => { events.push('wms'); if (failingStage === 'wms') throw new Error('retry') },
      logoutLocal: () => { events.push('local') },
    }), /retry/)
    assert.deepEqual(events, failingStage === 'clear' ? ['clear'] : ['clear', 'wms'])
    await completeErpLogout({ clearModuleSession: async () => {}, logoutLocal: () => { events.push('local') } })
    assert.equal(events.at(-1), 'local')
  }
})

test('cookie clearing uses fixed same-origin POST with keepalive and requires the local 204 response', async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, AFTER_SALES_LOGOUT_PATH)
    assert.equal(options?.method, 'POST')
    assert.equal(options?.credentials, 'same-origin')
    assert.equal(options?.keepalive, true)
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.cache, 'no-store')
    assert.ok(options?.signal instanceof AbortSignal)
    return new Response(null, { status: 204 })
  }
  await clearAfterSalesBrowserSession(origin, false, fetcher)
  for (const status of [200, 403, 405, 502]) {
    await assert.rejects(clearAfterSalesBrowserSession(origin, true,
      async () => new Response(null, { status })), /請稍後重試/)
  }
  await clearAfterSalesBrowserSession('https://ordinary-erp.example.test', false,
    async () => { throw new Error('ordinary ERP must keep its existing logout') })
})

test('a stalled cookie clear aborts within the fixed three-second deadline without local logout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const events: string[] = []
  let aborted = false
  const fetcher: typeof fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
  })
  const pending = completeErpLogout({
    clearModuleSession: () => clearAfterSalesBrowserSession(origin, true, fetcher),
    logoutLocal: () => { events.push('local') },
  })
  assert.equal(AFTER_SALES_LOGOUT_TIMEOUT_MS, 3000)
  context.mock.timers.tick(AFTER_SALES_LOGOUT_TIMEOUT_MS)
  await assert.rejects(pending, /請稍後重試/)
  assert.equal(aborted, true)
  assert.deepEqual(events, [])
})

test('a new login cannot authenticate or write a new local JWT before the old module session is cleared', async () => {
  const events: string[] = []
  let resolveClear!: () => void
  const clear = new Promise<void>(resolve => { resolveClear = resolve })
  const pending = completeErpLogin({
    clearModuleSession: () => { events.push('clear'); return clear },
    login: async () => { events.push('authenticate', 'write-new-jwt'); return 'new actor' },
  })
  assert.deepEqual(events, ['clear'])
  resolveClear()
  assert.equal(await pending, 'new actor')
  assert.deepEqual(events, ['clear', 'authenticate', 'write-new-jwt'])
})

test('failed module-session cleanup blocks login and new JWT writes until a successful retry', async () => {
  const events: string[] = []
  const login = async () => { events.push('authenticate', 'write-new-jwt'); return 'new actor' }
  await assert.rejects(completeErpLogin({
    clearModuleSession: async () => { events.push('failed-clear'); throw new Error('請稍後重試') },
    login,
  }), /請稍後重試/)
  assert.deepEqual(events, ['failed-clear'])
  await completeErpLogin({ clearModuleSession: async () => { events.push('clear') }, login })
  assert.deepEqual(events, ['failed-clear', 'clear', 'authenticate', 'write-new-jwt'])
})

test('invalid startup login tries module cleanup before local removal, and still removes an invalid JWT if cleanup fails', async () => {
  for (const clearSucceeds of [true, false]) {
    const events: string[] = []
    await clearInvalidErpSession({
      clearModuleSession: async () => { events.push('clear'); if (!clearSucceeds) throw new Error('unavailable') },
      logoutLocal: () => { events.push('remove-invalid-jwt') },
    })
    assert.deepEqual(events, ['clear', 'remove-invalid-jwt'])
  }
})
