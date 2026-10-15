import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { webcrypto, createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const require=createRequire(import.meta.url),ts=require('typescript');
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path));
const origin='https://erp.example.test';
const paths=['/mailroom.webmanifest','/mailroom-offline.html','/brand/mailroom-icon.svg','/brand/mailroom-icon-192.png','/brand/mailroom-icon-512.png'];
const workerSource=read('public/mailroom-sw.js').toString();
const registrationJs=ts.transpileModule(read('src/services/mailroom-pwa.ts').toString(),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function registration({url='https://erp.example.test/operations/mailroom',secure=true,supported=true,failure}={}){
  const calls=[],exports={};
  const navigator=supported?{serviceWorker:{register:(...args)=>{calls.push(args);if(failure==='throw')throw Error('blocked');return failure==='reject'?Promise.reject(Error('blocked')):Promise.resolve({});}}}:{};
  runInNewContext(registrationJs,{exports,window:{location:new URL(url),isSecureContext:secure},navigator});
  return {run:exports.registerMailroomPwa,calls};
}

function harness({badAsset,redirectedAsset,offline=false,networkStatus=200}={}){
  const events=new Map(),stores=new Map(),fetches=[],puts=[],deleted=[],lifecycle=[];
  const state={offline,networkStatus};
  const cache={
    async open(name){if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);return {
      async put(key,response){puts.push({name,url:String(key)});entries.set(String(key),response.clone());},
      async match(key){return entries.get(String(key))?.clone();},
    };},
    async keys(){return [...stores.keys()];},async delete(name){deleted.push(name);return stores.delete(name);},
  };
  const fetch=async input=>{
    const request=input instanceof Request?input:new Request(input);
    fetches.push({url:request.url,method:request.method,credentials:request.credentials,cache:request.cache,redirect:request.redirect});
    if(state.offline)throw Error('offline');
    const path=new URL(request.url).pathname,asset=paths.includes(path);
    const body=asset&&path!==badAsset?read('public'+path):'SYNTHETIC PRIVATE RESPONSE';
    const response=new Response(body,{status:asset?200:state.networkStatus,headers:{'Content-Type':path.endsWith('.html')?'text/html':path.endsWith('.png')?'image/png':path.endsWith('.svg')?'image/svg+xml':'application/manifest+json'}});
    Object.defineProperty(response,'url',{value:path===redirectedAsset?origin+'/login':request.url});
    Object.defineProperty(response,'redirected',{value:path===redirectedAsset});
    return response;
  };
  const self={location:{origin},addEventListener:(name,handler)=>events.set(name,handler),skipWaiting:()=>lifecycle.push('skipWaiting'),clients:{claim:()=>lifecycle.push('claim'),matchAll:()=>{lifecycle.push('matchAll');return [];}}};
  runInNewContext(workerSource,{self,caches:cache,fetch,crypto:webcrypto,Request,Response,URL,Uint8Array,Map,Set,Promise});
  async function dispatch(name){let result;events.get(name)({waitUntil:promise=>{result=promise;}});await result;}
  async function request(path,{method='GET',navigate=false}={}){
    const req=new Request(new URL(path,origin),{method,...(method==='GET'?{}:{body:'SYNTHETIC WRITE'})});
    if(navigate)Object.defineProperty(req,'mode',{value:'navigate'});
    let result;events.get('fetch')({request:req,respondWith:promise=>{result=promise;}});
    return result===undefined?undefined:await result;
  }
  return {events,stores,fetches,puts,deleted,lifecycle,state,dispatch,request};
}

test('manifest and app bootstrap provide a standalone mailroom identity without install UI',()=>{
  const manifest=JSON.parse(read('public/mailroom.webmanifest'));
  assert.equal(manifest.id,'/operations/mailroom');assert.equal(manifest.start_url,'/operations/mailroom');
  assert.equal(manifest.scope,'/operations/');assert.equal(manifest.display,'standalone');
  assert.equal(manifest.name,'Corely 收發室');assert.equal(manifest.short_name,'收發室');
  assert.deepEqual(manifest.icons.map(icon=>icon.sizes),['192x192','512x512']);
  for(const icon of manifest.icons){assert.equal(icon.type,'image/png');assert.equal(icon.purpose,'any');assert.ok(icon.src.startsWith('/brand/mailroom-icon-'));const png=read('public'+icon.src),size=Number(icon.sizes.split('x')[0]);assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
  const index=read('index.html').toString(),main=read('src/main.tsx').toString();
  assert.match(index,/<link rel="manifest" href="\/mailroom.webmanifest"/);assert.match(main,/import \{ registerMailroomPwa \} from '\.\/services\/mailroom-pwa'/);assert.match(main,/registerMailroomPwa\(\)/);
  assert.doesNotMatch(workerSource+registrationJs,/beforeinstallprompt|\.reload\(|backgroundSync|sync\.register/);
});

test('registration uses a root script with only operations scope and bypasses HTTP cache',()=>{
  const app=registration();app.run();assert.deepEqual(JSON.parse(JSON.stringify(app.calls)),[['/mailroom-sw.js',{scope:'/operations/',updateViaCache:'none'}]]);
});

test('registration permits trustworthy loopback and rejects nonsecure or unsupported contexts',()=>{
  for(const url of ['http://localhost:5173/','http://127.0.0.1:5173/','http://[::1]:5173/','http://tool.localhost/']){const app=registration({url});app.run();assert.equal(app.calls.length,1,url);}
  for(const options of [{url:'http://erp.example.test/'},{url:'http://localhost.evil.test/'},{url:'file:///operations/mailroom'},{secure:false},{supported:false}]){const app=registration(options);app.run();assert.equal(app.calls.length,0,JSON.stringify(options));}
});

test('unsupported server execution and blocked registration cannot prevent app startup',async()=>{
  const exports={};runInNewContext(registrationJs,{exports});assert.doesNotThrow(()=>exports.registerMailroomPwa());
  for(const failure of ['throw','reject']){const app=registration({failure});assert.doesNotThrow(app.run);await Promise.resolve();await Promise.resolve();assert.equal(app.calls.length,1);}
});

test('install caches only five byte-verified public assets with no credentials or redirect following',async()=>{
  const worker=harness();await worker.dispatch('install');
  assert.deepEqual(worker.fetches.map(call=>new URL(call.url).pathname),paths);
  assert.ok(worker.fetches.every(call=>call.method==='GET'&&call.credentials==='omit'&&call.cache==='reload'&&call.redirect==='error'));
  assert.equal(worker.puts.length,5);assert.ok(worker.puts.every(call=>call.name==='corely-mailroom-public-shell-v1'));
  assert.deepEqual(worker.puts.map(call=>new URL(call.url).pathname).sort(),[...paths].sort());
  for(const path of paths)assert.ok(workerSource.includes(createHash('sha256').update(read('public'+path)).digest('hex')),'Each cached body is pinned to the checked-in asset: '+path);
});

test('SPA fallback or redirected login content rejects install before writing any cache body',async()=>{
  for(const path of paths){const worker=harness({badAsset:path});await assert.rejects(()=>worker.dispatch('install'),/asset mismatch/);assert.equal(worker.puts.length,0);}
  const redirected=harness({redirectedAsset:'/mailroom-offline.html'});await assert.rejects(()=>redirected.dispatch('install'),/asset unavailable/);assert.equal(redirected.puts.length,0);
});

test('activate deletes only previous owned caches and never claims or reloads clients',async()=>{
  const worker=harness();worker.stores.set('another-app-private',new Map());worker.stores.set('corely-mailroom-public-shell-v0',new Map());await worker.dispatch('install');await worker.dispatch('activate');
  assert.deepEqual(worker.deleted,['corely-mailroom-public-shell-v0']);assert.ok(worker.stores.has('another-app-private'));assert.ok(worker.stores.has('corely-mailroom-public-shell-v1'));assert.deepEqual(worker.lifecycle,[]);assert.deepEqual([...worker.events.keys()],['install','activate','fetch']);
});

test('sensitive GETs, assets with queries, foreign origins and every business write pass through untouched',async()=>{
  const worker=harness();await worker.dispatch('install');const calls=worker.fetches.length,puts=worker.puts.length;
  for(const path of ['/api/mailroom/items','/config.js','/index.html','/login','/attachments/photo.png','/operations/after-sales/api/cases','/mailroom.webmanifest?caseId=PRIVATE','https://foreign.example.test/brand/mailroom-icon.svg'])assert.equal(await worker.request(path),undefined,path);
  assert.equal(await worker.request('/operations/after-sales/api/cases',{navigate:true}),undefined);
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(await worker.request('/operations/mailroom',{method}),undefined,method);
  assert.equal(worker.fetches.length,calls);assert.equal(worker.puts.length,puts);
});

test('online navigation returns fresh network data and preserves real HTTP errors without caching',async()=>{
  const worker=harness();await worker.dispatch('install');const puts=worker.puts.length;
  for(const path of ['/operations/mailroom?itemId=SYNTHETIC-PRIVATE','/operations/repair?itemId=SYNTHETIC-PRIVATE']){const response=await worker.request(path,{navigate:true});assert.equal(await response.text(),'SYNTHETIC PRIVATE RESPONSE');assert.equal(worker.fetches.at(-1).cache,'no-store');}
  worker.state.networkStatus=403;assert.equal((await worker.request('/operations/mailroom',{navigate:true})).status,403);
  assert.equal(worker.puts.length,puts);assert.ok(worker.puts.every(call=>!call.url.includes('PRIVATE')));
});

test('offline navigation serves only the neutral shell and never persists a case URL or replays writes',async()=>{
  const worker=harness();await worker.dispatch('install');worker.state.offline=true;const puts=worker.puts.length;
  for(const path of ['/operations/mailroom?itemId=SYNTHETIC-PRIVATE','/operations/repair?itemId=SYNTHETIC-PRIVATE']){const response=await worker.request(path,{navigate:true});const html=await response.text();assert.equal(html,read('public/mailroom-offline.html').toString());assert.match(html,/目前無法連線/);assert.doesNotMatch(html,/SYNTHETIC|<script|<form|<iframe/i);}
  const calls=worker.fetches.length;assert.equal(await worker.request('/api/mailroom/command',{method:'POST'}),undefined);assert.equal(worker.fetches.length,calls);assert.equal(worker.puts.length,puts);
  const response=await worker.request('/brand/mailroom-icon-192.png');assert.equal((await response.arrayBuffer()).byteLength,read('public/brand/mailroom-icon-192.png').byteLength);assert.equal(worker.fetches.length,calls);
});

test('missing public shell cache yields a no-store neutral error rather than cached app HTML',async()=>{
  const worker=harness({offline:true});const response=await worker.request('/operations/mailroom',{navigate:true});assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.match(await response.text(),/目前無法連線/);assert.equal(worker.puts.length,0);
});
