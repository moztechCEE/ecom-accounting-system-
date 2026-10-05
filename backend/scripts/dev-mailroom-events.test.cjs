const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { Prisma } = require('@prisma/client');

const origin = 'https://moztech-after-sales-dev-sp5g377smq-de.a.run.app';
const entityId = 'doa-dev-qa-20261002';
const secret = 'synthetic-mailroom-events-20261002-test-key';
const env = {
  ERP_DEV_SANDBOX: 'true', DB_NAME: 'erp_dev_test', DB_USER: 'erp_dev_runtime',
  SEED_ON_STARTUP: 'false', RUNTIME_SCHEDULES_ENABLED: 'false', CLOUDSQL_INSTANCE: 'test:region:instance',
  MAILROOM_ENABLED: 'true', MAILROOM_SYNC_ENABLED: 'true',
  ERP_DEV_MAILROOM_SOURCE_ENABLED: 'true', ERP_DEV_MAILROOM_EVENTS_ENABLED: 'true',
  ERP_DEV_MAILROOM_SOURCE_URL: origin,
  MAILROOM_CONNECTIONS: JSON.stringify([{ entityId, target: 'AFTER_SALES', baseUrl: origin, keyId: 'dev-events', secret }]),
};
const payload = { schema: 'corely.mailroom.v1', eventId: 'f12c7e29-bf96-4142-b311-128bcd2ae612', entityId,
  inventoryPosted: false, refundExecuted: false };
const preload = path.join(__dirname, 'dev-sandbox.cjs');
const setup = `
  const assert = require('node:assert/strict');
  const net = require('node:net');
  const crypto = require('node:crypto');
  const calls = { fetch: [], socket: [] };
  net.Socket.prototype.connect = function (...args) { calls.socket.push(args); return this; };
  globalThis.fetch = async (url, options) => {
    calls.fetch.push({ url, options });
    await Promise.resolve();
    const host = new URL(url).hostname;
    new net.Socket().connect(globalThis.socketOverride || { host, servername: host, port: 443 });
    return { ok: true };
  };
  require(${JSON.stringify(preload)});
  const check = error => error.code === 'ERP_DEV_EXTERNAL_EFFECT_BLOCKED';
  const origin = ${JSON.stringify(origin)};
  const eventPath = '/api/integration/mailroom/events';
  const payload = ${JSON.stringify(payload)};
  function signed(body = JSON.stringify(payload), route = eventPath, method = 'POST') {
    const timestamp = String(Math.floor(Date.now()/1000));
    const signature = crypto.createHmac('sha256', ${JSON.stringify(secret)}).update([
      'mailroom.v1', method, route, timestamp, ${JSON.stringify(entityId)},
      crypto.createHash('sha256').update(body).digest('hex')
    ].join('\\n')).digest('hex');
    return { method, redirect: 'error', ...(method === 'POST' ? {body} : {}),
      headers: {'content-type':'application/json', 'x-mailroom-key':'dev-events',
      'x-mailroom-entity':${JSON.stringify(entityId)}, 'x-mailroom-time':timestamp, 'x-mailroom-signature':signature} };
  }
`;
function isolated(source, patch = {}) {
  const result = spawnSync(process.execPath, ['-e', setup + '(async () => {' + source + '})().catch(error => {console.error(error); process.exitCode=1;});'], {
    env: { PATH: process.env.PATH, ...env, ...patch }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

test('DEV events allow only the signed canonical POST and preserve exact forwarded body', () => {
  isolated(`
    const options = signed();
    await fetch(origin + eventPath, {...options, dispatcher:{unsafe:true}});
    assert.equal(calls.fetch.length,1); assert.equal(calls.socket.length,1);
    assert.equal(calls.fetch[0].url, origin + eventPath);
    assert.equal(calls.fetch[0].options.body, options.body);
    assert.equal(calls.fetch[0].options.method,'POST');
    assert.equal(calls.fetch[0].options.redirect,'error');
    assert.equal(calls.fetch[0].options.dispatcher,undefined);
    assert.deepEqual(Object.keys(calls.fetch[0].options.headers).sort(),Object.keys(options.headers).sort());
  `);
});
test('DEV events remain closed without each independent source/events/mailroom flag', () => {
  for (const patch of [{ERP_DEV_MAILROOM_EVENTS_ENABLED:'false'}, {ERP_DEV_MAILROOM_EVENTS_ENABLED:''},
    {ERP_DEV_MAILROOM_EVENTS_ENABLED:'TRUE'}, {MAILROOM_SYNC_ENABLED:'false'},
    {ERP_DEV_MAILROOM_SOURCE_ENABLED:'false'}, {MAILROOM_ENABLED:'false'},
    {MAILROOM_CONNECTIONS:'[]'}]) {
    isolated(`await assert.rejects(fetch(origin+eventPath,signed()),check); assert.equal(calls.fetch.length,0);`,patch);
  }
});
test('DEV events reject production, candidate tags, LINE, other paths, queries and redirects', () => {
  isolated(`
    for (const url of [origin.replace('-dev','')+eventPath,
      origin.replace('https://','https://candidate---')+eventPath,
      'https://api.line.me/v2/bot/message/push', origin+eventPath+'/extra',
      origin+'/api/integration/mailroom/cases', origin+eventPath+'?x=1', origin+eventPath+'#x',
      origin.replace('https:','http:')+eventPath, origin+'.evil.invalid'+eventPath,
      origin.replace('https://','https://user:pass@')+eventPath, origin+':8443'+eventPath])
      await assert.rejects(fetch(url,signed()),check);
    for (const redirect of ['follow','manual',undefined])
      await assert.rejects(fetch(origin+eventPath,{...signed(),redirect}),check);
    await assert.rejects(fetch(new Request(origin+eventPath,signed())),check);
    assert.equal(calls.fetch.length,0); assert.equal(calls.socket.length,0);
  `);
  const candidate = origin.replace('https://','https://candidate---');
  isolated(`await assert.rejects(fetch(${JSON.stringify(candidate)}+eventPath,signed()),check); assert.equal(calls.fetch.length,0);`, {
    ERP_DEV_MAILROOM_SOURCE_URL:candidate,
    MAILROOM_CONNECTIONS:JSON.stringify([{entityId,target:'AFTER_SALES',baseUrl:candidate,keyId:'dev-events',secret}]),
  });
});
test('DEV signed body rejects other entities, financial flags, invalid schema and 40KB or larger bytes', () => {
  isolated(`
    for (const patch of [{entityId:'tw-entity-001'}, {schema:'wrong'}, {eventId:'not-uuid'},
      {inventoryPosted:true}, {inventoryPosted:undefined}, {refundExecuted:true}, {refundExecuted:undefined}])
      await assert.rejects(fetch(origin+eventPath,signed(JSON.stringify({...payload,...patch}))),check);
    for (const body of ['invalid', '[]', 'null', JSON.stringify({...payload,padding:'中'.repeat(14000)}),
      JSON.stringify(payload).padEnd(40*1024,' ')])
      await assert.rejects(fetch(origin+eventPath,signed(body)),check);
    assert.equal(calls.fetch.length,0); assert.equal(calls.socket.length,0);
  `);
});
test('DEV event HMAC binds body, entity, key, method, exact path and fresh timestamp', () => {
  isolated(`
    const options = signed();
    for (const patch of [{body: options.body+' '}, {method:'PUT'},
      {headers:{...options.headers,'x-mailroom-entity':'tw-entity-001'}},
      {headers:{...options.headers,'x-mailroom-key':'other-key'}},
      {headers:{...options.headers,'x-mailroom-time':'1000000000'}},
      {headers:{...options.headers,'x-mailroom-signature':'0'.repeat(64)}},
      {headers:{...options.headers,Host:'example.com'}}])
      await assert.rejects(fetch(origin+eventPath,{...options,...patch}),check);
    await assert.rejects(fetch(origin+eventPath,signed(options.body,'/api/integration/mailroom/cases')),check);
    assert.equal(calls.fetch.length,0); assert.equal(calls.socket.length,0);
  `);
});
test('DEV event validation snapshots body once and releases the scoped socket permission', () => {
  isolated(`
    const options = signed(); let reads=0;
    Object.defineProperty(options,'body',{get(){reads++;return reads===1?JSON.stringify(payload):JSON.stringify({...payload,refundExecuted:true});}});
    await fetch(origin+eventPath,options);
    assert.equal(reads,1); assert.equal(calls.fetch[0].options.body,JSON.stringify(payload));
    assert.throws(()=>new net.Socket().connect({host:new URL(origin).hostname,port:443}),check);
    assert.throws(()=>require('node:https').get(origin+eventPath),check);
    assert.throws(()=>require('node:child_process').execFile('curl',[origin+eventPath]),check);
    assert.equal(calls.socket.length,1);
  `);
});
test('DEV event socket token rejects another host, port or TLS server name', () => {
  isolated(`
    const expected=new URL(origin).hostname;
    for (const override of [{host:'elsewhere.invalid',servername:expected,port:443},
      {host:expected,servername:'elsewhere.invalid',port:443},{host:expected,servername:expected,port:80}]) {
      globalThis.socketOverride=override;
      await assert.rejects(fetch(origin+eventPath,signed()),check);
    }
    assert.equal(calls.socket.length,0);
  `);
});

function worker(patch = {}, queue = []) {
  const timers = [], cleared = [], queries = [], writes = [], sends = [];
  class ServiceUnavailableException extends Error {}
  class BadGatewayException extends Error {}
  const context = {
    exports: {}, process: {env:{...env,...patch}}, URL, AbortSignal, Date, console,
    setInterval(callback,milliseconds) {
      const timer = {callback,milliseconds,unrefs:0,unref(){this.unrefs++;}};
      timers.push(timer); return timer;
    },
    clearInterval(timer) {cleared.push(timer);},
    require(name) {
      if (name==='@nestjs/common') return {Injectable:()=>target=>target,ServiceUnavailableException,BadGatewayException};
      if (name==='@nestjs/schedule') return {Interval:()=>()=>{}};
      if (name==='@prisma/client') return {Prisma};
      if (name==='node:crypto') return crypto;
      if (name.endsWith('prisma.service')) return {};
      if (name==='./mailroom.contract') return {signRequest(){return 'synthetic';}};
      if (name==='./mailroom-source.contract') {
        const source=readFileSync(path.join(__dirname,'../src/modules/mailroom/mailroom-source.contract.ts'),'utf8');
        const contract={exports:{},require(name){
          if(name==='@nestjs/common')return{BadGatewayException};
          throw new Error('unexpected source contract import '+name);
        }};
        vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
          target:ts.ScriptTarget.ES2022}}).outputText,contract);
        return contract.exports;
      }
      throw new Error('unexpected mock import '+name);
    },
  };
  const source=readFileSync(path.join(__dirname,'../src/modules/mailroom/mailroom-sync.service.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,context);
  const prisma = {
    async $queryRaw(query) {
      queries.push(query);
      const scoped = query.values.includes(entityId) && query.values.includes('AFTER_SALES');
      const row = queue.find(row=>(row.status==='PENDING'||row.status==='SENDING_EXPIRED') &&
        (!scoped || row.entity_id===entityId&&row.target==='AFTER_SALES'));
      if (!row) return [];
      row.status='SENDING'; return [row];
    },
    mailroomDelivery:{async updateMany(write) {
      writes.push(write); const row=queue.find(row=>row.id===write.where.id);
      if(row)row.status=write.data.status;
      return {count:1};
    }},
  };
  const service=new context.exports.MailroomSyncService(prisma);
  service.request=async(entry,method,route,body)=>{sends.push({entry,method,route,body});return{accepted:true,eventId:JSON.parse(body).eventId};};
  return {service,timers,cleared,queries,writes,sends};
}
test('DEV mailroom timer runs independently with global schedules false and cleans up', async () => {
  const fixture=worker();
  fixture.service.onModuleInit(); fixture.service.onModuleInit();
  assert.equal(fixture.timers.length,1); assert.equal(fixture.timers[0].milliseconds,15000);
  assert.equal(fixture.timers[0].unrefs,1); assert.equal(env.RUNTIME_SCHEDULES_ENABLED,'false');
  fixture.timers[0].callback(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fixture.queries.length,1);
  fixture.service.onModuleDestroy(); fixture.service.onModuleDestroy();
  assert.deepEqual(fixture.cleared,[fixture.timers[0]]);
  const throwing=worker(); throwing.service.deliverPending=()=>Promise.reject(new Error('synthetic delivery failure'));
  throwing.service.onModuleInit(); throwing.timers[0].callback();
  await new Promise(resolve=>setImmediate(resolve)); throwing.service.onModuleDestroy();
});
test('DEV worker leases only the synthetic company AFTER_SALES rows and leaves AI/other companies untouched',async()=>{
  const queue = [
    {id:'ai',entity_id:entityId,target:'AI_CUSTOMER_SERVICE',status:'PENDING',payload,attempts:0},
    {id:'other-pending',entity_id:'other-company',target:'AFTER_SALES',status:'PENDING',payload,attempts:0},
    {id:'other-expired',entity_id:'other-company',target:'AFTER_SALES',status:'SENDING_EXPIRED',payload,attempts:0},
    {id:'dev-pending',entity_id:entityId,target:'AFTER_SALES',status:'PENDING',payload,attempts:0},
    {id:'dev-expired',entity_id:entityId,target:'AFTER_SALES',status:'SENDING_EXPIRED',payload,attempts:0},
  ];
  const fixture=worker({},queue); await fixture.service.deliverPending();
  assert.deepEqual(fixture.writes.map(write=>write.where.id),['dev-pending','dev-expired']);
  assert.equal(fixture.sends.length,2);
  assert.deepEqual(queue.slice(0,3).map(row=>row.status),['PENDING','PENDING','SENDING_EXPIRED']);
  for(const query of fixture.queries) {
    assert.match(query.text,/WHERE \(\(status='PENDING'.*\) OR\s*\(status='SENDING'.*\)\)\s+AND entity_id=\$\d+ AND target=\$\d+/s);
    assert.ok(query.values.includes(entityId));assert.ok(query.values.includes('AFTER_SALES'));
  }
});
test('DEV worker is closed unless both sync and events flags are enabled; production worker behavior stays unchanged',async()=>{
  for(const patch of [{MAILROOM_SYNC_ENABLED:'false'},{ERP_DEV_MAILROOM_EVENTS_ENABLED:'false'},
    {ERP_DEV_MAILROOM_SOURCE_ENABLED:'false'},{ERP_DEV_MAILROOM_SOURCE_URL:origin.replace('-dev','')}]) {
    const fixture=worker(patch);fixture.service.onModuleInit();await fixture.service.deliverPending();
    assert.equal(fixture.timers.length,0);assert.equal(fixture.queries.length,0);
  }
  const production=worker({ERP_DEV_SANDBOX:'false',ERP_DEV_MAILROOM_EVENTS_ENABLED:'false'});
  production.service.onModuleInit();await production.service.deliverPending();
  assert.equal(production.timers.length,0);assert.equal(production.queries.length,1);
  assert.ok(!production.queries[0].text.includes('AND entity_id='));
  assert.equal(production.queries[0].values.length,1);
});
test('DEV source polling shares the 15-second independent timer only after explicit opt-in and unregisters cleanly',async()=>{
  const off=worker();let offCalls=0;
  off.service.registerSourceConsumer(async()=>{offCalls++;});
  await off.service.deliverPending();assert.equal(offCalls,0);
  const fixture=worker({MAILROOM_SOURCE_SYNC_ENABLED:'true'});let calls=0;
  fixture.service.registerSourceConsumer(async()=>{calls++;});
  fixture.service.onModuleInit();fixture.timers[0].callback();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  fixture.service.registerSourceConsumer(undefined);
  await fixture.service.deliverPending();assert.equal(calls,1);
  fixture.service.onModuleDestroy();assert.equal(fixture.cleared.length,1);
  for(const patch of [{MAILROOM_SYNC_ENABLED:'false'},{ERP_DEV_MAILROOM_EVENTS_ENABLED:'false'},
    {ERP_DEV_MAILROOM_SOURCE_ENABLED:'false'},{ERP_DEV_MAILROOM_SOURCE_URL:origin.replace('-dev','')}]) {
    const blocked=worker({MAILROOM_SOURCE_SYNC_ENABLED:'true',...patch});let count=0;
    blocked.service.registerSourceConsumer(async()=>{count++;});
    await blocked.service.deliverPending();assert.equal(count,0);
  }
});
