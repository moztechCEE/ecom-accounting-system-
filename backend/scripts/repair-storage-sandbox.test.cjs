const { test }=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const preload=path.resolve(__dirname,'dev-sandbox.cjs');
const env={...process.env,ERP_DEV_SANDBOX:'true',DB_NAME:'erp_dev_fixture',DB_USER:'erp_dev_runtime',SEED_ON_STARTUP:'false',RUNTIME_SCHEDULES_ENABLED:'false',CLOUDSQL_INSTANCE:'test:region:instance',REPAIR_MEDIA_ENABLED:'true',REPAIR_MEDIA_BUCKET:'corely-repair-dev-249593319772'};
const prefix=`const assert=require('node:assert/strict');const net=require('node:net');let calls=0;net.Socket.prototype.connect=function(){return this};globalThis.fetch=async(url,options)=>{calls++;return {ok:true}};require(${JSON.stringify(preload)});const blocked=e=>e.code==='ERP_DEV_EXTERNAL_EFFECT_BLOCKED';const hook=globalThis[Symbol.for('corely.dev.repair-storage.v1')];const bucket='corely-repair-dev-249593319772';const key='repair-media/doa-dev-qa-20261002/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';const object='https://storage.googleapis.com/storage/v1/b/'+bucket+'/o/'+encodeURIComponent(key);`;
function run(code,patch={}){const r=spawnSync(process.execPath,['-e',prefix+'(async()=>{'+code+'})().catch(e=>{console.error(e);process.exitCode=1})'],{env:{...env,...patch}});assert.equal(r.status,0,r.stderr.toString());}
test('storage lazy hook rejects disabled, foreign bucket/company and malformed keys before starting work',()=>{
 run(`let started=false;for(const [b,k]of[['other',key],[bucket,key.replace('doa-dev-qa-20261002','foreign')],[bucket,key+'/extra']]) await assert.rejects(hook(b,k,async()=>{started=true}),blocked);assert.equal(started,false);`);
 for(const patch of [{REPAIR_MEDIA_ENABLED:'false'},{REPAIR_MEDIA_BUCKET:'other'}])run(`let started=false;await assert.rejects(hook(bucket,key,async()=>{started=true}),blocked);assert.equal(started,false);`,patch);
});
test('actual async context permits only scoped metadata/object/mint fetches and releases permission afterwards',()=>run(`
 await assert.rejects(fetch(object),blocked);
 await hook(bucket,key,async()=>{await Promise.resolve();await fetch(object);await fetch(object+'?alt=media');await fetch('http://metadata.google.internal./computeMetadata/v1/instance/service-accounts/default/token?scopes='+encodeURIComponent('https://www.googleapis.com/auth/cloud-platform'));await fetch('https://storage.googleapis.com/upload/storage/v1/b/'+bucket+'/o?uploadType=resumable&name='+encodeURIComponent(key)+'&ifGenerationMatch=0',{method:'POST'});});
 assert.equal(calls,4);await assert.rejects(fetch(object),blocked);
`));
test('scoped hook never admits foreign objects, production hosts, provider notifications or write/delete URLs',()=>run(`
 await hook(bucket,key,async()=>{for(const url of [object.replace(bucket,'other'),object.replace('22222222','33333333'),'https://api.line.me/v2/bot/message/push','https://storage.googleapis.com/storage/v1/b/'+bucket+'/o',object.replace('https:','http:')])await assert.rejects(fetch(url),blocked);await assert.rejects(fetch(object,{method:'DELETE'}),blocked);});assert.equal(calls,0);
`));
