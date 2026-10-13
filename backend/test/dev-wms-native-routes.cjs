const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/dev-sandbox.cjs'), 'utf8');
const origin = 'https://native-test---corely-wms-dev-sp5g377smq-de.a.run.app';
function sandbox(overrides = {}) {
  const calls = [], Socket = function () {};
  Socket.prototype.connect = () => true;
  const context = {
    require(name) {
      if (name === 'node:net') return { Socket };
      if (name === 'node:child_process') return {};
      if (name === 'node:async_hooks' || name === 'node:crypto') return require(name);
      if (name === 'node:module') return { syncBuiltinESMExports() {} };
      throw Error('Unexpected module');
    },
    process: { env: { ERP_DEV_SANDBOX: 'true', DB_NAME: 'erp_dev_test', DB_USER: 'erp_dev_runtime', SEED_ON_STARTUP: 'false', RUNTIME_SCHEDULES_ENABLED: 'false',
      WMS_NATIVE_ENABLED: 'true', WMS_PORTAL_SSO_ENABLED: 'true', WMS_PORTAL_SERVICE_URL: origin, WMS_WORKSPACE_URL: origin + '/', ...overrides } },
    URL, Headers, Buffer, Uint8Array, fetch: async (...args) => { calls.push(args); return { ok: true }; },
  };
  vm.runInNewContext(source, context); return { fetch: context.fetch, calls };
}
const auth = { authorization: 'Bearer fixture.header.signature', accept: 'application/json' };
const read = { method: 'GET', redirect: 'error', headers: auth };
const command = { method: 'POST', redirect: 'error', headers: { ...auth, 'content-type': 'application/json' }, body: '{"requestId":"test-original-id"}' };
(async () => {
  const { fetch, calls } = sandbox();
  for (const route of ['/api/auth/me', '/api/tasks', '/api/orders/17/work-snapshot', '/api/admin/exceptions', '/api/comments/unread-summary', '/api/users/basic']) await fetch(origin + route, read);
  await fetch(origin + '/api/auth/erp/exchange', { method: 'POST', redirect: 'error', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ ticket: 'a'.repeat(64), nonce: 'b'.repeat(64) }) });
  await fetch(origin + '/api/orders/update_item', command);
  await fetch(origin + '/api/orders/import', { ...command, headers: { ...auth, 'content-type': 'multipart/form-data; boundary=test-uuid' }, body: Buffer.from('--test-uuid\r\nsynthetic-bytes') });
  await fetch(origin + '/api/marketplace-intakes/17/download-link', { ...command, body: '{"kind":"prepick"}' });
  await fetch(origin + '/api/marketplace-files/17/prepick', { method: 'GET', redirect: 'error', headers: { cookie: 'wms_marketplace_download=fixture.private.cookie', accept: 'application/octet-stream' } });
  const allowed = calls.length;
  for (const [url, options] of [
    ['https://corely-wms-sp5g377smq-de.a.run.app/api/tasks', read],
    ['https://evil.invalid/api/tasks', read],
    [origin + '/api/auth/login', command], [origin + '/api/auth/erp/bind', command],
    [origin + '/api/integrations/erp/v1/orders', read], [origin + '/api/logistics-callbacks/ecpay', command],
    [origin + '/api/admin/bootstrap/superadmin', command], [origin + '/api/admin/maintenance/retention/run', command],
    [origin + '/api/admin/hooks/run', command], [origin + '/api/admin/migrations', command],
    [origin + '/api/orders/%2f..%2fauth/login', command],
    [origin + '/api/tasks', { ...read, headers: { ...auth, 'x-erp-service-key': 'not-allowed' } }],
    [origin + '/api/tasks', { ...read, redirect: 'follow' }],
    [origin + '/api/marketplace-files/17/prepick?token=secret', read],
    [origin + '/api/marketplace-files/17/prepick', { ...read, headers: { cookie: 'other=wrong' } }],
    [origin + '/api/orders/import', { ...command, body: Buffer.alloc(30 * 1024 * 1024 + 1), headers: { ...auth, 'content-type': 'multipart/form-data; boundary=test' } }],
    [origin + '/api/auth/erp/exchange', { ...command, body: JSON.stringify({ ticket: 'a'.repeat(64), nonce: 'b'.repeat(64), role: 'admin' }) }],
  ]) await assert.rejects(fetch(url, options), /DEV 測試環境/);
  assert.equal(calls.length, allowed);
  for (const config of [{ WMS_NATIVE_ENABLED: 'false' }, { WMS_PORTAL_SSO_ENABLED: 'false' }, { WMS_PORTAL_SERVICE_URL: 'https://evil.invalid', WMS_WORKSPACE_URL: 'https://evil.invalid' }]) {
    const closed = sandbox(config); await assert.rejects(closed.fetch(origin + '/api/auth/me', read), /DEV 測試環境/); assert.equal(closed.calls.length, 0);
  }
  console.log('DEV native WMS routes preserve the paired host, bearer/cookie scopes, command bodies and upload bound');
})().catch(error => { console.error(error); process.exitCode = 1; });
