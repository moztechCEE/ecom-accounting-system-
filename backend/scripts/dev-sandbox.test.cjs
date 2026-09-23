const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const preload = path.join(__dirname, 'dev-sandbox.cjs');
const env = { ...process.env, ERP_DEV_SANDBOX: 'true', DB_NAME: 'erp_dev_test', DB_USER: 'erp_dev_runtime', SEED_ON_STARTUP: 'false', RUNTIME_SCHEDULES_ENABLED: 'false', CLOUDSQL_INSTANCE: 'test:region:instance',
  WMS_PORTAL_SSO_ENABLED: 'false', WMS_PORTAL_SERVICE_URL: '', WMS_PORTAL_SHARED_SECRET: '',
  WMS_WORKSPACE_READ_ENABLED: 'false', WMS_WORKSPACE_COMMANDS_ENABLED: 'false', WMS_WORKSPACE_URL: '', ERP_DEV_AI_ENABLED: 'false' };
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
    new net.Socket().connect(globalThis.socketOverride || { host: hostname, servername: hostname, port: 443 });
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
    for (const model of ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro']) {
      await fetch(endpoint.replace('gemini-2.5-flash', model), { ...options, dispatcher: { unsafe: true } });
    }
    assert.equal(calls.fetch.length, 4); assert.equal(calls.socket.length, 4);
    assert.ok(calls.fetch.every(call => call.options.redirect === 'error' && call.options.dispatcher === undefined));
    assert.ok(calls.fetch.every(call => Object.keys(call.options.headers).length === 2));
    // The context is released when the approved fetch completes.
    assert.throws(() => new net.Socket().connect({ host: 'generativelanguage.googleapis.com', port: 443 }), check);
    assert.throws(() => require('node:child_process').spawn('echo', ['test']), check);
    assert.equal(calls.socket.length, 4);
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
      endpoint.replace('gemini-2.5-flash', 'gemini-3.8-flash'),
      endpoint.replace('gemini-2.5-flash', 'gemini-3.5-flash-preview'),
      endpoint.replace('gemini-2.5-flash', 'gemini-3.5-flash-lite-extra'),
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
    const bridgeOptions = { method: 'POST', redirect: 'error', body: '{}', headers: {'Content-Type':'application/json','x-erp-service-key':'sandbox-wms-key'} };
    await fetch(bridge, bridgeOptions);
    assert.equal(calls.fetch.length, 1); assert.equal(calls.socket.length, 1);
    await assert.rejects(fetch(bridge.replace('/staff', '/unapproved'), bridgeOptions), check);
    assert.equal(calls.fetch.length, 1);
  `, { WMS_PORTAL_SSO_ENABLED: 'true', WMS_PORTAL_SERVICE_URL: 'https://corely-wms-dev-sp5g377smq-de.a.run.app', WMS_PORTAL_SHARED_SECRET: 'sandbox-wms-key' });
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

const pairedWarehouse = 'https://pair-a75132f0-0923---corely-wms-dev-sp5g377smq-de.a.run.app';
const pairedEnv = { WMS_PORTAL_SSO_ENABLED: 'true', WMS_PORTAL_SHARED_SECRET: 'sandbox-wms-key',
  WMS_PORTAL_SERVICE_URL: pairedWarehouse, WMS_WORKSPACE_URL: pairedWarehouse };
const pairedSource = `
  const host = ${JSON.stringify(pairedWarehouse)};
  const command = host + '/api/integrations/erp/workflow/v1/orders/erp-order/dispatch';
  const read = host + '/api/integrations/erp/v1/orders?page=1';
  const account = host + '/api/auth/erp/staff';
  const writeOptions = {method:'POST',redirect:'error',headers:{Authorization:'Bearer a.b.c',Accept:'application/json','Content-Type':'application/json'},body:'{}'};
  const readOptions = {method:'GET',redirect:'error',headers:{Authorization:'Bearer a.b.c',Accept:'application/json'}};
  const accountOptions = {method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-erp-service-key':'sandbox-wms-key'},body:'{}'};
`;

test('DEV paired candidate allows only matching configured origins and preserves guarded account/read/command options', () => {
  for (const suffix of ['', '/']) isolatedWorkspaceCase(pairedSource + `
    await fetch(command, {...writeOptions, dispatcher:{unsafe:true}});
    await fetch(read, {...readOptions, dispatcher:{unsafe:true}});
    await fetch(account, {...accountOptions, dispatcher:{unsafe:true}});
    await fetch(account.replace('/staff','/bind'), accountOptions);
    assert.equal(calls.fetch.length,4); assert.equal(calls.socket.length,4);
    assert.ok(calls.fetch.every(call=>call.url.startsWith(host+'/') && call.options.redirect==='error' && call.options.dispatcher===undefined));
    assert.deepEqual(Object.keys(calls.fetch[2].options.headers).sort(),['Content-Type','x-erp-service-key']);
    await assert.rejects(fetch(command.replace(host,'https://corely-wms-dev-sp5g377smq-de.a.run.app'),writeOptions),check);
    assert.throws(()=>new net.Socket().connect({host:new URL(host).hostname,port:443}),check);
    assert.throws(()=>require('node:https').get(account),check);
    assert.equal(calls.socket.length,4);
  `, {...pairedEnv, WMS_WORKSPACE_URL: pairedWarehouse + suffix});
});

test('DEV paired candidate refuses mismatched, missing, malformed or non-DEV configured origins', () => {
  const unsafe = [
    'https://other---corely-wms-dev-sp5g377smq-de.a.run.app',
    pairedWarehouse.replace('https:','http:'), pairedWarehouse.replace('corely-wms-dev','corely-wms'),
    pairedWarehouse + '.evil.invalid', pairedWarehouse + ':443', pairedWarehouse + ':8443',
    pairedWarehouse + '/path', pairedWarehouse + '?x=1', pairedWarehouse + '#fragment',
    pairedWarehouse.replace('https://','https://user:password@'),
    pairedWarehouse.replace('pair-a75132f0-0923','-bad'), pairedWarehouse.replace('pair-a75132f0-0923','bad-'),
    pairedWarehouse.replace('pair-a75132f0-0923','UPPER'), pairedWarehouse.replace('pair-a75132f0-0923','a'.repeat(64)),
    '',
  ];
  for (const origin of unsafe) isolatedWorkspaceCase(pairedSource + `
    await assert.rejects(fetch(command,writeOptions),check);
    await assert.rejects(fetch(read,readOptions),check);
    await assert.rejects(fetch(account,accountOptions),check);
    assert.equal(calls.fetch.length,0); assert.equal(calls.socket.length,0);
  `, {...pairedEnv, WMS_PORTAL_SERVICE_URL: origin, WMS_WORKSPACE_URL: origin});
  for (const patch of [{WMS_WORKSPACE_URL:''}, {WMS_WORKSPACE_URL:'https://corely-wms-dev-sp5g377smq-de.a.run.app'},
    {WMS_PORTAL_SERVICE_URL:''}, {WMS_PORTAL_SERVICE_URL:'https://corely-wms-dev-sp5g377smq-de.a.run.app'}]) {
    isolatedWorkspaceCase(pairedSource + `
      await assert.rejects(fetch(command,writeOptions),check);
      await assert.rejects(fetch(account,accountOptions),check);
      assert.equal(calls.fetch.length,0); assert.equal(calls.socket.length,0);
    `, {...pairedEnv, ...patch});
  }
});

test('DEV paired candidate still requires independent flags and exact account authentication', () => {
  isolatedWorkspaceCase(pairedSource + `
    await assert.rejects(fetch(command,writeOptions),check);
    await fetch(read,readOptions);
    await assert.rejects(fetch(account,accountOptions),check);
    assert.equal(calls.fetch.length,1);
  `,{...pairedEnv,WMS_WORKSPACE_COMMANDS_ENABLED:'false',WMS_PORTAL_SSO_ENABLED:'false'});
  isolatedWorkspaceCase(pairedSource + `
    await assert.rejects(fetch(command,writeOptions),check);
    await assert.rejects(fetch(read,readOptions),check);
    await fetch(account,accountOptions);
    assert.equal(calls.fetch.length,1);
  `,{...pairedEnv,WMS_WORKSPACE_READ_ENABLED:'false'});
});

test('matching unsafe settings never authorize their own non-DEV destination', () => {
  for (const origin of ['https://external.invalid', pairedWarehouse.replace('corely-wms-dev','corely-wms'),
    pairedWarehouse + '.evil.invalid', pairedWarehouse.replace('https:','http:'), pairedWarehouse + ':8443']) {
    isolatedWorkspaceCase(pairedSource + `
      const unsafe=${JSON.stringify(origin)};
      await assert.rejects(fetch(unsafe+'/api/integrations/erp/workflow/v1/orders/erp-order/dispatch',writeOptions),check);
      await assert.rejects(fetch(unsafe+'/api/auth/erp/staff',accountOptions),check);
      assert.equal(calls.fetch.length,0); assert.equal(calls.socket.length,0);
    `,{...pairedEnv,WMS_WORKSPACE_URL:origin,WMS_PORTAL_SERVICE_URL:origin});
  }
});

test('DEV paired candidate rejects redirects, Host/header overrides, mutable Request and unsupported account paths', () => {
  isolatedWorkspaceCase(pairedSource + `
    for(const [url,options] of [[command,writeOptions],[read,readOptions],[account,accountOptions]]) {
      for(const redirect of ['follow','manual',undefined]) await assert.rejects(fetch(url,{...options,redirect}),check);
      for(const key of ['Host','x-forwarded-host','x-custom']) await assert.rejects(fetch(url,{...options,headers:{...options.headers,[key]:'elsewhere'}}),check);
      await assert.rejects(fetch(new Request(url,options)),check);
      await assert.rejects(fetch(url+'#fragment',options),check);
      await assert.rejects(fetch(url.replace('https://','https://user:pass@'),options),check);
    }
    for(const patch of [{method:'GET'},{body:undefined},{headers:{'Content-Type':'application/json'}},
      {headers:{...accountOptions.headers,'x-erp-service-key':'wrong'}}]) await assert.rejects(fetch(account,{...accountOptions,...patch}),check);
    for(const suffix of ['/other','?x=1']) await assert.rejects(fetch(account+suffix,accountOptions),check);
    assert.equal(calls.fetch.length,0); assert.equal(calls.socket.length,0);
  `, pairedEnv);
});

test('DEV paired fetch context refuses wrong socket destination or TLS servername', () => {
  isolatedWorkspaceCase(pairedSource + `
    const expected=new URL(host).hostname;
    for(const socket of [{host:'elsewhere.invalid',servername:expected,port:443},
      {host:expected,servername:'elsewhere.invalid',port:443},{host:expected,servername:expected,port:80}]) {
      globalThis.socketOverride=socket;
      await assert.rejects(fetch(command,writeOptions),check);
      await assert.rejects(fetch(account,accountOptions),check);
    }
    assert.equal(calls.socket.length,0);
    delete globalThis.socketOverride;
    await fetch(account,accountOptions);
    assert.equal(calls.socket.length,1);
  `, pairedEnv);
});
