const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const preload = path.join(__dirname, 'dev-sandbox.cjs');
const env = { ...process.env, ERP_DEV_SANDBOX: 'true', DB_NAME: 'erp_dev_test', DB_USER: 'erp_dev_runtime', SEED_ON_STARTUP: 'false', RUNTIME_SCHEDULES_ENABLED: 'false', CLOUDSQL_INSTANCE: 'test:region:instance' };
test('DEV fails closed for production database, user and schedules', () => {
  for (const patch of [{ DB_NAME: 'erp_db' }, { DB_USER: 'erp_user' }, { RUNTIME_SCHEDULES_ENABLED: 'true' }, { SEED_ON_STARTUP: 'true' }]) {
    assert.notEqual(spawnSync(process.execPath, ['--require', preload, '-e', ''], { env: { ...env, ...patch } }).status, 0);
  }
});
test('DEV blocks HTTP, fetch, TCP and subprocesses before connection', () => {
  const source = `const assert=require('node:assert/strict'); const check=e=>e.code==='ERP_DEV_EXTERNAL_EFFECT_BLOCKED';
    for(const f of [()=>require('node:http').get('http://127.0.0.1:9999'),()=>require('node:https').get('https://example.com'),()=>require('node:net').connect(5432,'127.0.0.1'),()=>require('node:child_process').spawn('echo',['test'])]) assert.throws(f,check);
    assert.rejects(fetch('https://example.com'),check);`;
  const result = spawnSync(process.execPath, ['--require', preload, '-e', source], { env });
  assert.equal(result.status, 0, result.stderr.toString());
});

// Original transports are replaced before loading the guard. These fixtures exercise
// the real wrapper and async socket context without opening any network connection.
const fakeTransportSource = `
  const assert = require('node:assert/strict');
  const net = require('node:net');
  const calls = { fetch: [], socket: [] };
  net.Socket.prototype.connect = function (...args) { calls.socket.push(args); return this; };
  globalThis.fetch = async (url, options) => {
    calls.fetch.push({ url, options });
    await Promise.resolve();
    const hostname = new URL(url).hostname;
    new net.Socket().connect({ host: hostname, servername: hostname, port: 443 });
    return { ok: true };
  };
  require(${JSON.stringify(preload)});
  const check = error => error.code === 'ERP_DEV_EXTERNAL_EFFECT_BLOCKED';
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'sandbox-test-key' }, body: JSON.stringify({ contents: [] }) };
`;
function isolatedAiCase(source, patch = {}) {
  const result = spawnSync(process.execPath, ['-e', fakeTransportSource + '(async () => {' + source + '})().catch(error => { console.error(error); process.exitCode = 1; });'], {
    env: { ...env, WMS_PORTAL_SSO_ENABLED: 'false', ERP_DEV_AI_ENABLED: 'true', GEMINI_API_KEY: 'sandbox-test-key', ...patch },
  });
  assert.equal(result.status, 0, result.stderr.toString());
}

test('DEV AI remains closed by default, without a key, or without exact opt-in', () => {
  for (const patch of [{ ERP_DEV_AI_ENABLED: '' }, { ERP_DEV_AI_ENABLED: 'false' }, { ERP_DEV_AI_ENABLED: 'TRUE' }, { GEMINI_API_KEY: '' }]) {
    isolatedAiCase(`await assert.rejects(fetch(endpoint, options), check); assert.equal(calls.fetch.length, 0); assert.equal(calls.socket.length, 0);`, patch);
  }
});

test('DEV AI allows only approved generateContent POSTs with no redirects or custom transport', () => {
  isolatedAiCase(`
    for (const model of ['gemini-2.5-flash', 'gemini-2.5-pro']) {
      await fetch(endpoint.replace('gemini-2.5-flash', model), { ...options, dispatcher: { unsafe: true } });
    }
    assert.equal(calls.fetch.length, 2); assert.equal(calls.socket.length, 2);
    assert.ok(calls.fetch.every(call => call.options.redirect === 'error' && call.options.dispatcher === undefined));
    assert.ok(calls.fetch.every(call => Object.keys(call.options.headers).length === 2));
    // The context is released when the approved fetch completes.
    assert.throws(() => new net.Socket().connect({ host: 'generativelanguage.googleapis.com', port: 443 }), check);
    assert.throws(() => require('node:child_process').spawn('echo', ['test']), check);
    assert.equal(calls.socket.length, 2);
  `);
});

test('DEV AI rejects other hosts, non-HTTPS, unsupported paths, credentials and query strings', () => {
  isolatedAiCase(`
    for (const url of [
      'https://example.com/v1beta/models/gemini-2.5-flash:generateContent',
      endpoint.replace('https:', 'http:'),
      endpoint.replace('googleapis.com', 'googleapis.com.evil.invalid'),
      endpoint.replace('googleapis.com', 'googleapis.com:8443'),
      endpoint.replace('gemini-2.5-flash', 'unapproved-model'),
      endpoint.replace(':generateContent', ':streamGenerateContent'),
      endpoint.replace('/v1beta/models/', '/v1/models/'),
      endpoint + '?key=not-allowed', endpoint + '#fragment', endpoint.replace('https://', 'https://user:pass@'),
    ]) await assert.rejects(fetch(url, options), check);
    assert.equal(calls.fetch.length, 0); assert.equal(calls.socket.length, 0);
  `);
});

test('DEV AI rejects alternate methods, redirect opt-in and missing provider credentials', () => {
  isolatedAiCase(`
    for (const patch of [
      { method: 'GET' }, { redirect: 'follow' }, { redirect: 'manual' }, { body: undefined },
      { headers: { 'Content-Type': 'application/json' } },
      { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'wrong-key' } },
    ]) await assert.rejects(fetch(endpoint, { ...options, ...patch }), check);
    await assert.rejects(fetch(new Request(endpoint, options)), check);
    assert.equal(calls.fetch.length, 0); assert.equal(calls.socket.length, 0);
  `);
});

test('DEV AI flag does not permit direct Gemini TCP/HTTPS or unrelated integrations', () => {
  isolatedAiCase(`
    for (const operation of [
      () => require('node:https').get(endpoint),
      () => new net.Socket().connect({ host: 'generativelanguage.googleapis.com', port: 443 }),
      () => new net.Socket().connect({ host: 'example.com', servername: 'generativelanguage.googleapis.com', port: 443 }),
      () => new net.Socket().connect({ host: 'generativelanguage.googleapis.com', port: 80 }),
      () => require('node:child_process').execFile('curl', [endpoint]),
    ]) assert.throws(operation, check);
    await assert.rejects(fetch('https://corely-wms-dev-sp5g377smq-de.a.run.app/api/auth/erp/staff', { ...options, redirect: 'error' }), check);
    assert.equal(calls.fetch.length, 0); assert.equal(calls.socket.length, 0);
  `);
});

test('DEV AI exception preserves the separately configured WMS account-link bridge', () => {
  isolatedAiCase(`
    const bridge = 'https://corely-wms-dev-sp5g377smq-de.a.run.app/api/auth/erp/staff';
    await fetch(bridge, { method: 'POST', redirect: 'error', body: '{}' });
    assert.equal(calls.fetch.length, 1); assert.equal(calls.socket.length, 1);
    await assert.rejects(fetch(bridge.replace('/staff', '/unapproved'), { method: 'POST', redirect: 'error', body: '{}' }), check);
    assert.equal(calls.fetch.length, 1);
  `, { WMS_PORTAL_SSO_ENABLED: 'true', WMS_PORTAL_SERVICE_URL: 'https://corely-wms-dev-sp5g377smq-de.a.run.app' });
});

function isolatedWorkspaceCase(source, patch = {}) {
  const result = spawnSync(process.execPath, ['-e', fakeTransportSource + '(async () => {' + source + '})().catch(error => { console.error(error); process.exitCode = 1; });'], {
    env: { ...env, WMS_PORTAL_SSO_ENABLED: 'false', ERP_DEV_AI_ENABLED: 'false',
      WMS_WORKSPACE_READ_ENABLED: 'true', WMS_WORKSPACE_COMMANDS_ENABLED: 'true',
      WMS_WORKSPACE_URL: 'https://corely-wms-dev-sp5g377smq-de.a.run.app/', ...patch },
  });
  assert.equal(result.status, 0, result.stderr.toString());
}

test('DEV permits only signed-bridge shaped WMS DEV reads and commands through fetch', () => {
  isolatedWorkspaceCase(`
    const host='https://corely-wms-dev-sp5g377smq-de.a.run.app';
    const headers={Authorization:'Bearer a.b.c',Accept:'application/json','Content-Type':'application/json'};
    const command=host+'/api/integrations/erp/workflow/v1/orders/erp-order/dispatch';
    const read=host+'/api/integrations/erp/v1/orders?search=test&page=1';
    await fetch(command,{method:'POST',redirect:'error',headers,body:'{}',dispatcher:{unsafe:true}});
    await fetch(read,{method:'GET',redirect:'error',headers:{Authorization:'Bearer a.b.c',Accept:'application/json'}});
    assert.equal(calls.fetch.length,2); assert.equal(calls.socket.length,2);
    assert.ok(calls.fetch.every(call=>call.options.dispatcher===undefined));
    assert.throws(()=>new net.Socket().connect({host:new URL(host).hostname,port:443}),check);
  `);
});

test('DEV warehouse integration rejects unapproved hosts, routes, credentials and disabled commands', () => {
  isolatedWorkspaceCase(`
    const host='https://corely-wms-dev-sp5g377smq-de.a.run.app';
    const options={method:'POST',redirect:'error',headers:{Authorization:'Bearer a.b.c',Accept:'application/json','Content-Type':'application/json'},body:'{}'};
    const command=host+'/api/integrations/erp/workflow/v1/orders/erp-order/dispatch';
    for(const url of [command.replace('corely-wms-dev','corely-wms'),command.replace('https:','http:'),
      command.replace('/dispatch','/delete'),command+'?token=secret',command+'#fragment',
      command.replace('https://','https://user:pass@')]) await assert.rejects(fetch(url,options),check);
    for(const patch of [{method:'GET'},{redirect:'follow'},{headers:{Accept:'application/json','Content-Type':'application/json'}},
      {headers:{...options.headers,Host:'elsewhere'}},{body:undefined}]) await assert.rejects(fetch(command,{...options,...patch}),check);
    await assert.rejects(fetch(new Request(command,options)),check);
    assert.throws(()=>new net.Socket().connect({host:new URL(host).hostname,port:443}),check);
    assert.equal(calls.fetch.length,0); assert.equal(calls.socket.length,0);
  `);
  isolatedWorkspaceCase(`
    const url='https://corely-wms-dev-sp5g377smq-de.a.run.app/api/integrations/erp/workflow/v1/orders/order/dispatch';
    await assert.rejects(fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer a.b.c',Accept:'application/json','Content-Type':'application/json'},body:'{}'}),check);
    assert.equal(calls.fetch.length,0);
  `,{WMS_WORKSPACE_COMMANDS_ENABLED:'false'});
});

test('DEV AI exception preserves isolated Cloud SQL Unix sockets and rejects other local sockets', () => {
  isolatedAiCase(`
    new net.Socket().connect({ path: '/cloudsql/test:region:instance/.s.PGSQL.5432' });
    assert.equal(calls.socket.length, 1);
    assert.throws(() => new net.Socket().connect({ path: '/cloudsql/another-instance/.s.PGSQL.5432' }), check);
    assert.throws(() => new net.Socket().connect({ path: '/tmp/arbitrary.sock' }), check);
    assert.equal(calls.socket.length, 1);
  `);
});
