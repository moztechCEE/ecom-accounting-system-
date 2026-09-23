const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/dev-sandbox.cjs'), 'utf8');
const candidate = 'https://quote-pair-test---corely-wms-dev-sp5g377smq-de.a.run.app';

function sandbox(overrides = {}) {
  const calls = [];
  const Socket = function () {};
  Socket.prototype.connect = () => true;
  const env = {
    ERP_DEV_SANDBOX: 'true', DB_NAME: 'erp_dev_test', DB_USER: 'erp_dev_runtime',
    SEED_ON_STARTUP: 'false', RUNTIME_SCHEDULES_ENABLED: 'false', CLOUDSQL_INSTANCE: 'test',
    WMS_PORTAL_SERVICE_URL: candidate, WMS_WORKSPACE_URL: candidate + '/',
    WMS_WORKSPACE_READ_ENABLED: 'true', WMS_WORKSPACE_COMMANDS_ENABLED: 'true',
    ...overrides,
  };
  const context = {
    require(name) {
      if (name === 'node:net') return { Socket };
      if (name === 'node:child_process') return {};
      if (name === 'node:async_hooks') return require('node:async_hooks');
      if (name === 'node:module') return { syncBuiltinESMExports() {} };
      throw Error(`Unexpected import: ${name}`);
    },
    process: { env }, URL, Headers,
    fetch: async (...args) => { calls.push(args); return { ok: true }; },
  };
  vm.runInNewContext(source, context);
  return { fetch: context.fetch, calls };
}

const auth = { Authorization: 'Bearer a.b.c', Accept: 'application/json' };
const read = { method: 'GET', redirect: 'error', headers: auth };
const command = { method: 'POST', redirect: 'error', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"requestId":"one"}' };

(async () => {
  const { fetch, calls } = sandbox();
  for (const route of [
    '/api/integrations/erp/v1/orders',
    '/api/integrations/erp/v1/orders/order-1',
    '/api/integrations/erp/workflow/v1/orders/order-1',
  ]) assert.equal((await fetch(candidate + route, read)).ok, true);
  for (const action of ['pick/claim', 'pick/scan', 'pack/claim', 'pack/scan', 'dispatch']) {
    assert.equal((await fetch(candidate + '/api/integrations/erp/workflow/v1/orders/order-1/' + action, command)).ok, true);
  }
  assert.equal(calls.length, 8);
  for (const [url, options] of calls) {
    assert.equal(new URL(url).origin, candidate);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(Object.keys(options.headers).sort(), options.method === 'GET' ? ['Accept', 'Authorization'] : ['Accept', 'Authorization', 'Content-Type']);
  }

  for (const [url, options] of [
    [candidate + '/api/integrations/erp/workflow/v1/orders/order-1?unexpected=1', read],
    [candidate + '/api/integrations/erp/workflow/v1/orders/order-1/pick/claim', read],
    [candidate + '/api/integrations/erp/workflow/v1/orders/order-1/claim', command],
    [candidate + '/api/integrations/erp/workflow/v1/orders/order-1/pick/dispatch', command],
    [candidate + '/api/integrations/erp/workflow/v1/orders/order-1/pack/claim?x=1', command],
    [candidate + '/api/integrations/erp/workflow/v1/orders/order-1/pick/claim', { ...command, redirect: 'follow' }],
    [candidate + '/api/integrations/erp/workflow/v1/orders/order-1/pick/claim', { ...command, headers: { ...command.headers, Host: 'evil.invalid' } }],
    ['https://corely-wms-dev-sp5g377smq-de.a.run.app/api/integrations/erp/workflow/v1/orders/order-1', read],
    ['https://quote-pair-test---corely-wms-dev-sp5g377smq-de.a.run.app.evil.invalid/api/integrations/erp/workflow/v1/orders/order-1', read],
  ]) await assert.rejects(fetch(url, options), /DEV 測試環境/);
  assert.equal(calls.length, 8);

  for (const config of [
    { WMS_WORKSPACE_COMMANDS_ENABLED: 'false' },
    { WMS_WORKSPACE_URL: 'https://other---corely-wms-dev-sp5g377smq-de.a.run.app/' },
  ]) {
    const closed = sandbox(config);
    await assert.rejects(closed.fetch(candidate + '/api/integrations/erp/workflow/v1/orders/order-1', read), /DEV 測試環境/);
    await assert.rejects(closed.fetch(candidate + '/api/integrations/erp/workflow/v1/orders/order-1/pick/claim', command), /DEV 測試環境/);
    assert.equal(closed.calls.length, 0);
  }
  console.log('DEV WMS workspace routes allow only the configured candidate and exact signed workflow paths');
})().catch(error => { console.error(error); process.exitCode = 1; });
