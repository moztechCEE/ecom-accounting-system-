const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const preload = path.join(__dirname, 'dev-sandbox.cjs');
const source = `
const assert=require('node:assert/strict'),net=require('node:net');
const {createHash,createHmac}=require('node:crypto');
let calls=0,sockets=0;
net.Socket.prototype.connect=function(){sockets++;return this;};
global.fetch=async(url,options)=>{calls++;assert.equal(options.dispatcher,undefined);new net.Socket().connect({host:new URL(url).hostname,port:443});return {ok:true};};
require(${JSON.stringify(preload)});
const origin='https://corely-aftersales-module-dev-sp5g377smq-de.a.run.app';
const prefix='/after-sales-app/api/integration/erp/workbench';
const blocked=e=>e.code==='ERP_DEV_EXTERNAL_EFFECT_BLOCKED';
function signed(path,method='GET',body){const time=String(Math.floor(Date.now()/1000));const headers={'x-erp-time':time,'x-erp-entity':'doa-dev-qa-20261002','x-erp-actor':'synthetic-csr','content-type':'application/json'};
headers['x-erp-signature']=createHmac('sha256',process.env.AFTER_SALES_MODULE_SECRET).update(['erp.aftersales.v1',method,path.replace(/^\\/after-sales-app(?=\\/api\\/integration\\/erp\\/workbench)/,''),time,headers['x-erp-entity'],headers['x-erp-actor'],createHash('sha256').update(body||'').digest('hex')].join('\\n')).digest('hex');return {method,redirect:'error',headers,...(body?{body}:{}),dispatcher:{unsafe:true}};}
`;
function run(body, envPatch={}) {
  const result=spawnSync(process.execPath,['-e',source+'(async()=>{'+body+'})().catch(e=>{console.error(e);process.exitCode=1;});'],{env:{...process.env,ERP_DEV_SANDBOX:'true',DB_NAME:'erp_dev_test',DB_USER:'erp_dev_runtime',SEED_ON_STARTUP:'false',RUNTIME_SCHEDULES_ENABLED:'false',CLOUDSQL_INSTANCE:'synthetic:region:instance',AFTER_SALES_MODULE_ENABLED:'true',AFTER_SALES_MODULE_ENTITY_ID:'doa-dev-qa-20261002',AFTER_SALES_MODULE_SECRET:'synthetic-native-source-shared-secret-32',...envPatch}});
  assert.equal(result.status,0,result.stderr.toString());
}
test('native signed reads/register reach only exact isolated module transport',()=>run(`
for(const p of [prefix+'/cases?scope=mine&search=MP+001',prefix+'/cases/synthetic-case',prefix+'/options?search=MP'])await fetch(origin+p,signed(p));
const body=JSON.stringify({requestId:'322ae28e-c3fa-4d86-91ae-a04f225b13e2',brand:'BONSON',customerKind:'TO_C',payload:{type:'REPAIR'}});
await fetch(origin+prefix+'/cases',signed(prefix+'/cases','POST',body));
assert.equal(calls,4);assert.equal(sockets,4);
assert.throws(()=>new net.Socket().connect({host:new URL(origin).hostname,port:443}),blocked);
`));
test('native transport rejects signature/body/query/entity tampering before any connection',()=>run(`
const p=prefix+'/cases?scope=mine';const o=signed(p);
for(const patch of [{headers:{...o.headers,'x-erp-entity':'other-company'}},{headers:{...o.headers,'x-erp-signature':'0'.repeat(64)}},{redirect:'follow'},{method:'POST'}])await assert.rejects(fetch(origin+p,{...o,...patch}),blocked);
await assert.rejects(fetch(origin+p+'&scope=all',signed(p+'&scope=all')),blocked);
const body=JSON.stringify({requestId:'322ae28e-c3fa-4d86-91ae-a04f225b13e2',brand:'BONSON',customerKind:'TO_C',payload:{type:'REPAIR'}});
await assert.rejects(fetch(origin+prefix+'/cases',{...signed(prefix+'/cases','POST',body),body:body.replace('BONSON','MOZTECH')}),blocked);
assert.equal(calls,0);assert.equal(sockets,0);
`));
test('native opt-in never grants provider/refund/payment/technician/other-origin operations',()=>run(`
for(const p of [prefix+'/cases/synthetic-case/refund',prefix+'/cases/synthetic-case/payment',prefix+'/cases/synthetic-case/repair-report','/after-sales-app/api/line/push'])await assert.rejects(fetch(origin+p,signed(p,'POST','{}')),blocked);
for(const host of [origin.replace('https:','http:'),origin+'.evil.invalid',origin.replace('.app','.app:8443'),'https://moztech-after-sales-system-sp5g377smq-de.a.run.app'])await assert.rejects(fetch(host+prefix+'/cases',signed(prefix+'/cases')),blocked);
assert.equal(calls,0);assert.equal(sockets,0);
`));
test('native reads remain closed without exact paired-module opt-in',()=>{
for(const patch of [{AFTER_SALES_MODULE_ENABLED:'false'},{AFTER_SALES_MODULE_ENTITY_ID:'other-company'},{AFTER_SALES_MODULE_SECRET:'short'}])run(`const p=prefix+'/cases';await assert.rejects(fetch(origin+p,signed(p)),blocked);assert.equal(calls,0);`,patch);
});
