import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const artifactPrefix = process.env.MAILROOM_PRECHECK_ARTIFACT_PREFIX || '/tmp/corely-mailroom-precheck-20261016';
const itemA = '11111111-1111-4111-8111-111111111111';
const itemB = '22222222-2222-4222-8222-222222222222';

const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import InitialInspectionDrawer from '/src/pages/mailroom/InitialInspectionDrawer.tsx';
import ReceivingItemList from '/src/pages/mailroom/ReceivingItemList.tsx';
import {useRepairFeedback} from '/src/pages/repair/repair-feedback.tsx';
import '/src/pages/mailroom/mailroom.css';
function Harness(){
  const [entityId,setEntityId]=useState('company-a'),[itemIds,setItemIds]=useState((new URLSearchParams(location.search).get('items')||'repair-a').split(',').map(id=>window.precheckFixture.aliases[id]||id)),[open,setOpen]=useState(true);
  const {message,contextHolder}=useRepairFeedback();
  window.precheckFixture.setEntity=setEntityId;window.precheckFixture.setItems=setItemIds;window.precheckFixture.setOpen=setOpen;
  return <main style={{padding:'12px',minWidth:0}}>{contextHolder}<InitialInspectionDrawer entityId={entityId} itemIds={itemIds} open={open} feedback={message} guardChange={change=>change()} onDraftChange={draft=>window.precheckFixture.drafts.push(structuredClone(draft))} onClose={()=>setOpen(false)} onSaved={value=>window.precheckFixture.saved.push(structuredClone(value??null))}/></main>;
}
function ReceivingHarness(){
  const [entityId,setEntityId]=useState('company-a'),[selectedIds,setSelectedIds]=useState([]);
  window.precheckFixture.setEntity=setEntityId;
  return <main id="receiving-fixture-list" style={{padding:'16px 12px',minWidth:0,marginTop:new URLSearchParams(location.search).has('spacer')?1600:0}}><ReceivingItemList entityId={entityId} items={window.precheckFixture.receivingRows(entityId)} total={8} page={1} loading={false} selectedIds={selectedIds} onSelect={ids=>{setSelectedIds(ids);window.precheckFixture.selections.push([...ids]);}} onPage={page=>window.precheckFixture.pages.push(page)} onOpen={id=>window.precheckFixture.opened.push(id)} onInspect={ids=>window.precheckFixture.inspected.push([...ids])} canEdit/></main>;
}
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('fixture')==='receiving'?<ReceivingHarness/>:<Harness/>);
`;

// All requests and mutations remain inside this browser context. The fixture's
// exact item/document shapes are shared by the GET, atomic start and save paths.
const api = `
export const API_URL='/offline-precheck-api';
const clone=value=>structuredClone(value);
const aliases={'repair-a':'${itemA}','repair-b':'${itemB}','return':'33333333-3333-4333-8333-333333333333','unconfigured':'44444444-4444-4444-8444-444444444444','unbound':'55555555-5555-4555-8555-555555555555'};
const custom={id:'product:synthetic-product',title:'產品主檔初檢表',schema:1,revision:3,contentHash:'a'.repeat(64),productId:'synthetic-product',sku:'ACTUAL-SKU',checks:[{key:'power',label:'電源',required:true},{key:'charging',label:'充電',required:true},{key:'accessory',label:'配件',required:false},{key:'appearance',label:'外觀',required:false}]};
const generic={...custom,id:'GENERIC_FUNCTIONAL_V1',title:'基本功能初檢',revision:1,contentHash:'b'.repeat(64),checks:[{key:'basic_function',label:'基本功能',required:true}]};
const pro={...generic,id:'MOZTECH_POWERBANK_PRO_V1',title:'萬能充 Pro 初檢表',contentHash:'c'.repeat(64),checks:[{key:'builtin_type_c',label:'自帶 Type-C 線',required:true},{key:'builtin_lightning',label:'自帶 Lightning 線',required:true},{key:'usb_c_output',label:'USB-C 輸出',required:true},{key:'usb_a_output',label:'USB-A 輸出',required:true},{key:'wireless_charging',label:'無線充電',required:true}]};
const state={aliases,calls:[],posts:[],drafts:[],saved:[],unexpected:[],items:{},documents:{},committed:{},held:{},holdReads:{},failNext:false,commitThenLose:false,commits:0,photoPending:[],photoAborted:[],objectURLs:[],revokedURLs:[],inspected:[],selections:[],opened:[],pages:[],handoffMode:'applied',handoffBatches:{},handoffChildren:{},handoffReceipts:[],handoffApplied:0};
for(const [name,id]of Object.entries(aliases))state.items[id]={id,entityId:'company-a',label:'合成實物 '+name,version:name==='repair-b'?11:7,category:name==='return'?'RETURN':'REPAIR',status:'RECEIVED',physicalCustody:'MAILROOM',custodianId:'clerk',location:'A1',storageLocationId:'bin-a1',productId:name==='unbound'?null:'synthetic-product',sku:'ACTUAL-SKU',serialNumber:'ACTUAL-'+name,unconfigured:name==='unconfigured',unbound:name==='unbound'};
function binding(template){return template?{id:template.id,revision:template.revision,contentHash:template.contentHash}:null;}
function templates(item){return item.unbound?[]:item.unconfigured?[generic,pro]:[custom,generic,pro];}
function selected(item,document){return item.unbound?null:document?templates(item).find(template=>template.id===document.templateBinding?.id)||null:item.unconfigured?null:custom;}
function read(item){const document=state.documents[item.id]||null,template=selected(item,document),templateStale=!!document&&JSON.stringify(document.templateBinding)!==JSON.stringify(binding(template)),editable=item.status==='RECEIVED'&&document?.status!=='SUBMITTED';return {itemId:item.id,itemVersion:item.version,label:item.label,category:item.category,productName:'合成實收產品',productId:item.productId,sku:item.sku,serialNumber:item.serialNumber,stage:document?.status||'NOT_STARTED',document:clone(document),availableTemplates:clone(templates(item)),selectedTemplate:clone(template),template:{state:item.unbound?'PRODUCT_UNBOUND':template?'CONFIGURED':'UNCONFIGURED',template:clone(template),availableTemplates:clone(templates(item)),reason:item.unbound?'請先核對實物產品主檔':template?null:'請選擇初檢表或明確填寫不需初檢原因'},capabilities:{canStart:editable,canSave:!!document&&editable,canMarkReady:!!document&&editable&&!item.unbound&&!templateStale,canHandoff:!!document&&editable&&!templateStale&&document.status==='READY'&&item.category==='REPAIR'&&item.custodianId==='clerk'&&item.physicalCustody==='MAILROOM'&&!item.nextUserId,reason:!editable?'目前進度不能編輯收發初檢':templateStale?'產品初檢表已更新，請重新選擇並保存草稿':null},custody:{custodianId:item.custodianId,location:item.location,storageLocationId:item.storageLocationId,physicalCustody:item.physicalCustody},evidenceThumbnailUrl:null};}
function reject(status,message){throw {response:{status,data:{message}}};}
function scoped(id,entityId){const item=state.items[id];if(!item||item.entityId!==entityId)reject(404,'找不到本公司實物');return item;}
function saveDocument(item,body){const previous=state.documents[item.id],revision=(previous?.revision||0)+1;const document={id:'synthetic-document-'+item.id,itemId:item.id,revision,status:body.status||'DRAFT',identityHash:item.id.replaceAll('-','').repeat(2),contentHash:item.id.replaceAll('-','')+revision.toString(16).padStart(32,'0'),templateBinding:clone(body.templateBinding===undefined?binding(selected(item,null)):body.templateBinding),checks:clone(body.checks||[]),evidence:clone(body.evidence||[]),notRequiredReason:body.notRequiredReason?.trim()||null,savedById:'clerk',savedByName:'合成收發人員',savedAt:'2026-10-16T00:00:00.000Z',submittedById:null,submittedAt:null};state.documents[item.id]=document;return read(item);}
if(new URLSearchParams(location.search).has('ready'))for(const name of (new URLSearchParams(location.search).get('items')||'repair-a').split(',')){const item=state.items[aliases[name]||name];saveDocument(item,{status:'READY',templateBinding:binding(selected(item,null)),checks:custom.checks.map(check=>({key:check.key,result:'NORMAL'})),evidence:[]});}
function handoff(body){
  const batchKey=body.entityId+':'+body.requestId,hash=JSON.stringify(body),old=state.handoffBatches[batchKey];
  if(old&&old.hash!==hash)reject(409,'同一批次識別碼的內容不同');
  const batch=old||(state.handoffBatches[batchKey]={id:'99999999-9999-4999-8999-'+body.requestId.slice(-12),hash,round:0});batch.round++;
  const items=body.items.map((part,index)=>{
    const childKey=body.entityId+':'+part.requestId,childHash=JSON.stringify({batchRequestId:body.requestId,...part}),previous=state.handoffChildren[childKey];
    if(previous){if(previous.hash!==childHash)reject(409,'同一操作識別碼的內容不同');return {...clone(previous.result),duplicate:true};}
    if(state.handoffMode==='partial'&&index===body.items.length-1)return {itemId:part.itemId,requestId:part.requestId,status:'FAILED',code:'HANDOFF_REJECTED',message:'合成實物版本已更新，未交辦'};
    if(state.handoffMode==='unknown-once'&&batch.round===1&&index===body.items.length-1)return {itemId:part.itemId,requestId:part.requestId,status:'UNKNOWN',code:'RESULT_UNKNOWN',message:'結果尚未確認，請保留原操作識別碼重試'};
    const item=scoped(part.itemId,body.entityId),document=state.documents[item.id];
    if(!read(item).capabilities.canHandoff||item.version!==part.expectedVersion||document.revision!==part.precheckRevision||document.contentHash!==part.precheckHash||document.identityHash!==part.identityHash)return {itemId:part.itemId,requestId:part.requestId,status:'FAILED',code:'HANDOFF_REJECTED',message:'初檢或實收版本已更新，請重新讀取'};
    item.version++;item.status='WAITING_REPAIR_ACCEPTANCE';item.matchResult='MATCH';item.nextUserId=null;document.status='SUBMITTED';document.submittedById='clerk';document.submittedAt='2026-10-16T01:00:00.000Z';
    const result={itemId:item.id,requestId:part.requestId,status:'APPLIED',duplicate:false,itemVersion:item.version,actionId:part.requestId};
    state.handoffApplied++;state.handoffChildren[childKey]={hash:childHash,result:clone(result)};return result;
  });
  const result={batchId:batch.id,requestId:body.requestId,notificationRecipientCount:items.some(item=>item.status==='APPLIED')?2:0,items};
  if(state.handoffMode==='wrong-child-once'&&batch.round===1)result.items[0]={...result.items[0],requestId:'77777777-7777-4777-8777-777777777777'};
  state.handoffReceipts.push(clone(result));return {data:clone(result)};
}
state.receivingRows=entityId=>Array.from({length:8},(_,index)=>({id:entityId+'-photo-'+(index+1),label:'MR-'+(index+1),productName:'合成實收產品 VeryLongActualProductName '+(index+1),sku:'ACTUAL-SKU-'+index,serialNumber:'SERIAL-'+(index+1),status:'RECEIVED',statusLabel:'已收到，待核對',version:1,matchResult:'PENDING',grade:null,disposition:null,conditionNote:null,location:'A1',custodianId:'clerk',custodianName:'合成收發人員',physicalCustody:'MAILROOM',nextUserId:null,nextUserName:null,recipientId:null,repairOwnerId:null,mine:false,evidenceCount:1,evidenceThumbnailUrl:'/mailroom/prechecks/items/'+entityId+'-photo-'+(index+1)+'/photo',receipt:{number:'RECEIPT-'+(index+1),category:index===7?'LETTER':'REPAIR',sourceCaseId:'synthetic-source',sourceNumber:'SYNTHETIC-SOURCE-'+(index+1),senderLabel:'合成寄件人'},precheck:{stage:'DRAFT',revision:1,savedById:'clerk',savedByName:'初檢同仁',savedAt:'2026-10-16T00:00:00Z'}}));
const nativeCreate=URL.createObjectURL.bind(URL),nativeRevoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const src=nativeCreate(blob);state.objectURLs.push({src,entityId:blob.fixtureEntity||null});return src;};
URL.revokeObjectURL=src=>{state.revokedURLs.push(src);return nativeRevoke(src);};
function photo(entityId){const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const context=canvas.getContext('2d');context.fillStyle=entityId==='company-a'?'#1677ff':'#00aa55';context.fillRect(0,0,2,2);const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),char=>char.charCodeAt(0)),blob=new Blob([bytes],{type:'image/png'});Object.defineProperty(blob,'fixtureEntity',{value:entityId});return blob;}
state.releasePhoto=entityId=>{const entry=state.photoPending.find(entry=>entry.entityId===entityId);if(entry)entry.release();};
state.releasePhotos=entityId=>{for(const entry of [...state.photoPending])if(entry.entityId===entityId)entry.release();};
state.updateCustomTemplate=()=>{custom.revision=4;custom.contentHash='d'.repeat(64);};
window.precheckFixture=state;
export default {
  async get(path,config={}){
    state.calls.push({path,params:clone(config.params||{}),responseType:config.responseType||null});
    if(/^\\/mailroom\\/prechecks\\/items\\/[^/]+\\/photo$/.test(path)){
      if(config.responseType!=='blob'){state.unexpected.push('Non-blob photo GET '+path);throw Error('Photo must use authenticated blob response');}
      return new Promise(resolve=>{const entityId=config.params.entityId,onAbort=()=>state.photoAborted.push({path,entityId}),entry={path,entityId,release:()=>{config.signal?.removeEventListener('abort',onAbort);state.photoPending=state.photoPending.filter(row=>row!==entry);resolve({data:photo(entityId)});}};state.photoPending.push(entry);config.signal?.addEventListener('abort',onAbort,{once:true});});
    }
    const match=path.match(/^\\/mailroom\\/prechecks\\/items\\/([^/]+)$/);
    if(match){const item=scoped(decodeURIComponent(match[1]),config.params?.entityId),result=clone(read(item));if(state.holdReads[item.id])return new Promise(resolve=>state.held[item.id]=()=>{delete state.held[item.id];resolve({data:result});});return {data:result};}
    state.unexpected.push('GET '+path);throw Error('Unexpected offline GET '+path);
  },
  async post(path,body){
    state.posts.push({path,body:clone(body)});
    if(path==='/mailroom/prechecks/handoff')return handoff(body);
    const key=body.entityId+':'+body.requestId,hash=JSON.stringify({path,body});
    if(state.committed[key]){if(state.committed[key].hash!==hash)reject(409,'相同操作識別碼不能更改內容');return {data:clone(state.committed[key].data)};}
    if(state.failNext){state.failNext=false;reject(503,'合成連線中斷');}
    let data;
    if(path==='/mailroom/prechecks/start'){
      const items=body.items.map(row=>{const item=scoped(row.itemId,body.entityId);if(item.version!==row.expectedVersion)reject(409,'實物資料已更新，請重新整理後操作');if(state.documents[item.id])reject(409,'初檢已建立');return item;});
      data={batchId:body.requestId,requestId:body.requestId,items:items.map((item,index)=>({requestId:body.items[index].requestId,...saveDocument(item,{status:'DRAFT',templateBinding:binding(selected(item,null)),checks:[],evidence:[]})})),duplicate:false};
    }else{
      const match=path.match(/^\\/mailroom\\/prechecks\\/items\\/([^/]+)\\/save$/);
      if(!match){state.unexpected.push('POST '+path);throw Error('Unexpected offline POST '+path);}
      const item=scoped(decodeURIComponent(match[1]),body.entityId),previous=state.documents[item.id];
      if(item.version!==body.expectedVersion)reject(409,'實物資料已更新，請重新整理後操作');
      if(!previous||previous.revision!==body.expectedRevision)reject(409,'初檢版本已更新，請重新讀取');
      const template=templates(item).find(template=>template.id===body.templateBinding?.id)||null;
      if(JSON.stringify(binding(template))!==JSON.stringify(body.templateBinding??null))reject(409,'初檢模板已更新');
      if(JSON.stringify(previous.templateBinding)!==JSON.stringify(body.templateBinding)&&(body.status!=='DRAFT'||body.checks.length))reject(400,'更換初檢表時請先清空檢查結果並保存草稿');
      data={requestId:body.requestId,duplicate:false,...saveDocument(item,body)};
    }
    state.commits++;state.committed[key]={hash,data:clone(data)};
    if(state.commitThenLose){state.commitThenLose=false;reject(503,'合成已提交但回應遺失');}
    return {data:clone(data)};
  }
};
`;

test('actual initial inspection drawer preserves physical identity, revisions and exact retries offline', { timeout: 120000, skip: !executablePath && 'No existing browser; never installs one' }, async t => {
  const virtual = '\0mailroom-precheck-fixture';
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-mailroom-precheck-'));
  const server = await createServer({ root, cacheDir, configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'offline-initial-inspection-drawer',
    resolveId(id) { if (id === 'virtual:mailroom-precheck-fixture') return virtual; },
    load(id) {
      if (id === virtual) return fixture;
      if (id.endsWith('/src/services/api.ts')) return api;
      if (id.endsWith('/src/contexts/AuthContext.tsx')) return "export const useAuth=()=>({user:{id:'clerk',roles:[],permissions:['mailroom:read','mailroom:create','mailroom:update']}});";
      if (id.endsWith('/src/services/websocket.service.ts')) return 'export const webSocketService={subscribe:()=>()=>{}};';
    },
    transform(code, id) { if (id === virtual) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText; },
    configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/__precheck')) return next();
      try { response.setHeader('Content-Type', 'text/html');response.end(await vite.transformIndexHtml('/__precheck', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0"><div id="root"></div><script type="module" src="/@id/virtual:mailroom-precheck-fixture"></script></body></html>')); } catch (error) { next(error); }
    }); },
  }] });
  t.after(async () => { await server.close();rmSync(cacheDir, { recursive: true, force: true }); });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const summaries = [];
  async function scene(name, run, query = '', viewport = { width: 1280, height: 970 }) {
    if (process.env.MAILROOM_PRECHECK_SCENE && !name.includes(process.env.MAILROOM_PRECHECK_SCENE)) return;
    await t.test(name, { timeout: 30000 }, async child => {
      const page = await browser.newPage({ viewport, hasTouch: true });
      page.setDefaultTimeout(8000);
      const errors = [], external = [], httpWrites = [];let completed = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin) { external.push(request.url());return route.abort(); }
        if (request.method() !== 'GET') { httpWrites.push(request.method() + ' ' + request.url());return route.abort(); }
        return route.continue();
      });
      child.after(async () => {
        const result = await page.evaluate(() => ({ posts: window.precheckFixture?.posts || [], unexpected: window.precheckFixture?.unexpected || [], commits: window.precheckFixture?.commits || 0, handoffApplied: window.precheckFixture?.handoffApplied || 0, handoffReceipts: window.precheckFixture?.handoffReceipts || [], thumbnailCalls: (window.precheckFixture?.calls || []).filter(call => call.path.endsWith('/photo')), photoAborted: window.precheckFixture?.photoAborted || [], objectURLs: window.precheckFixture?.objectURLs || [], revokedURLs: window.precheckFixture?.revokedURLs || [] }));
        summaries.push({ name, ...result, errors, external, httpWrites });
        if (!completed || errors.length || result.unexpected.length) {
          writeFileSync(artifactPrefix + '-failure-' + summaries.length + '.txt', await page.locator('body').innerText());
          writeFileSync(artifactPrefix + '-failure-' + summaries.length + '-aria.txt', await page.locator('body').ariaSnapshot());
          await page.screenshot({ path: artifactPrefix + '-failure-' + summaries.length + '.png', fullPage: true });
        }
        await page.close();
        assert.deepEqual(errors, []);assert.deepEqual(external, []);assert.deepEqual(httpWrites, []);assert.deepEqual(result.unexpected, []);
      });
      await page.goto(origin + '/__precheck' + query);
      await page.waitForFunction(() => window.precheckFixture || document.querySelector('vite-error-overlay'));
      assert.equal(await page.locator('vite-error-overlay').count(), 0, 'The actual drawer must compile and mount');
      await run(page);
      completed = true;
    });
  }

  t.after(() => writeFileSync(artifactPrefix + '-results.json', JSON.stringify(summaries, null, 2) + '\n'));
  const posts = page => page.evaluate(() => structuredClone(window.precheckFixture.posts));
  async function loaded(page) { await page.getByText('收發初檢', { exact: true }).waitFor();await page.waitForFunction(() => window.precheckFixture.calls.length > 0 && !document.querySelector('.ant-spin-spinning')); }
  async function start(page) { await loaded(page);await page.getByRole('button', { name: '建立初檢草稿', exact: true }).click();await page.getByRole('button', { name: '儲存草稿', exact: true }).waitFor(); }
  async function choose(page, name, text) { const input = page.getByRole('combobox', { name, exact: true });await input.press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByText(text, { exact: true }).click();await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' }); }
  async function save(page, ready = false) { const before = (await posts(page)).length;await page.getByRole('button', { name: ready ? '完成初檢' : '儲存草稿', exact: true }).click();await page.waitForFunction(count => window.precheckFixture.posts.length > count, before);await page.waitForFunction(() => !document.querySelector('.ant-spin-spinning')); }
  const handoffButton = (page, count = 1) => page.getByRole('button', { name: '交維修部門' + (count > 1 ? `（${count} 件）` : ''), exact: true });
  const handoffResults = page => page.locator('[aria-label="逐件交辦結果"]');
  const handoffPosts = page => page.evaluate(() => structuredClone(window.precheckFixture.posts.filter(post => post.path === '/mailroom/prechecks/handoff')));
  const authority = (page, ids) => page.evaluate(ids => ids.map(id => ({ itemId: id, expectedVersion: window.precheckFixture.items[id].version, precheckRevision: window.precheckFixture.documents[id].revision, precheckHash: window.precheckFixture.documents[id].contentHash, identityHash: window.precheckFixture.documents[id].identityHash })), ids);
  function assertHandoffRequest(request, expected) {
    assert.equal(request.path, '/mailroom/prechecks/handoff');assert.deepEqual(Object.keys(request.body).sort(), ['entityId', 'items', 'requestId']);assert.equal(request.body.entityId, 'company-a');
    const requestIds = [request.body.requestId, ...request.body.items.map(item => item.requestId)];assert.equal(new Set(requestIds).size, expected.length + 1);assert.ok(requestIds.every(id => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)));
    assert.deepEqual(request.body.items.map(({ requestId, ...item }) => item), expected);
    for (const item of request.body.items) { assert.deepEqual(Object.keys(item).sort(), ['expectedVersion', 'identityHash', 'itemId', 'precheckHash', 'precheckRevision', 'requestId']);assert.match(item.precheckHash, /^[a-f0-9]{64}$/);assert.match(item.identityHash, /^[a-f0-9]{64}$/); }
  }

  await scene('atomic start preserves both item identities and drafts survive item navigation', async page => {
    await start(page);
    let requests = await posts(page);
    assert.equal(requests.length, 1);assert.equal(requests[0].path, '/mailroom/prechecks/start');
    assert.deepEqual(requests[0].body.items.map(row => [row.itemId, row.expectedVersion]), [[itemA, 7], [itemB, 11]]);
    assert.equal(new Set([requests[0].body.requestId, ...requests[0].body.items.map(row => row.requestId)]).size, 3);
    await choose(page, '電源結果', '正常');await save(page);
    await page.getByRole('button', { name: '下一件', exact: true }).click();await page.getByText('合成實物 repair-b', { exact: true }).waitFor();
    await page.getByRole('button', { name: '上一件', exact: true }).click();
    assert.match(await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '電源結果', exact: true }) }).innerText(), /正常/);
    requests = await posts(page);assert.equal(requests[1].body.status, 'DRAFT');assert.equal(requests[1].body.expectedVersion, 7);assert.equal(requests[1].body.expectedRevision, 1);
    assert.equal(requests[1].body.checks.find(check => check.key === 'power').result, 'NORMAL');
    const actual = await page.evaluate(id => window.precheckFixture.items[id], itemA);
    assert.equal(actual.status, 'RECEIVED');assert.equal(actual.physicalCustody, 'MAILROOM');assert.equal(actual.custodianId, 'clerk');assert.equal(actual.serialNumber, 'ACTUAL-repair-a');
  }, '?items=repair-a,repair-b');

  await scene('four honest results require reasons and same-document photos before ready at 320px', async page => {
    await start(page);const initial = (await posts(page)).length;
    await page.getByRole('button', { name: '完成初檢', exact: true }).click();await page.getByText('必要初檢項目尚未完成，可先儲存草稿', { exact: true }).waitFor();assert.equal((await posts(page)).length, initial);
    await choose(page, '電源結果', '正常');await choose(page, '充電結果', '異常');
    await page.getByRole('button', { name: '完成初檢', exact: true }).click();await page.getByText('充電：異常請補上說明與照片', { exact: true }).waitFor();assert.equal((await posts(page)).length, initial);
    await page.getByRole('textbox', { name: '充電說明', exact: true }).fill('接上電源後沒有反應');
    const photo = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas');canvas.width = canvas.height = 2;const context = canvas.getContext('2d');context.fillStyle = '#1677ff';context.fillRect(0, 0, 2, 2);return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
    await page.locator('input[type="file"][aria-label="加入初檢照片"]').setInputFiles({ name: 'synthetic-precheck.png', mimeType: 'image/png', buffer: photo });
    await page.getByRole('checkbox', { name: /照片 1/ }).check();
    await choose(page, '配件結果', '不適用');await page.getByRole('button', { name: '完成初檢', exact: true }).click();await page.getByText('配件：請填寫不適用原因', { exact: true }).waitFor();assert.equal((await posts(page)).length, initial);
    await page.getByRole('textbox', { name: '配件說明', exact: true }).fill('本型號沒有此配件');await save(page, true);
    const body = (await posts(page)).at(-1).body;
    assert.equal(body.status, 'READY');assert.deepEqual(body.checks.map(check => check.result), ['NORMAL', 'ABNORMAL', 'NOT_APPLICABLE', 'NOT_TESTED']);
    assert.deepEqual(body.checks[1].evidenceIndexes, [0]);assert.match(body.evidence[0], /^data:image\/(png|jpeg);base64,/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.ant-drawer-body').evaluate(element => {element.scrollTop=0;});
    await page.screenshot({ path: artifactPrefix + '-ready-320.png', fullPage: true });
  }, '', { width: 320, height: 740 });

  await scene('an incomplete abnormal and not-applicable draft saves and reopens without becoming ready', async page => {
    await start(page);await choose(page, '充電結果', '異常');await choose(page, '配件結果', '不適用');
    await save(page);
    const requests = await posts(page);assert.equal(requests.length, 2);assert.equal(requests[1].body.status, 'DRAFT');
    const saved = await page.evaluate(id => structuredClone(window.precheckFixture.documents[id]), itemA);
    assert.equal(saved.status, 'DRAFT');assert.equal(saved.revision, 2);assert.deepEqual(saved.evidence, []);
    assert.equal(saved.checks.find(check => check.key === 'power').result, 'NOT_TESTED');
    assert.equal(saved.checks.find(check => check.key === 'charging').result, 'ABNORMAL');
    assert.equal(saved.checks.find(check => check.key === 'charging').note || '', '');
    assert.deepEqual(saved.checks.find(check => check.key === 'charging').evidenceIndexes || [], []);
    assert.equal(saved.checks.find(check => check.key === 'accessory').result, 'NOT_APPLICABLE');
    assert.equal(saved.checks.find(check => check.key === 'accessory').note || '', '');
    await page.getByRole('button', { name: /^關\s*閉$/ }).click();await page.locator('.ant-drawer-content:visible').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.precheckFixture.setOpen(true));await page.getByRole('combobox', { name: '充電結果', exact: true }).waitFor();
    assert.match(await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '充電結果', exact: true }) }).innerText(), /異常/);
    assert.match(await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '配件結果', exact: true }) }).innerText(), /不適用/);
    await page.getByText('初檢草稿', { exact: true }).waitFor();assert.equal(await page.getByText('初檢完成', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('textbox', { name: '充電說明', exact: true }).inputValue(), '');
    assert.equal(await page.getByRole('textbox', { name: '配件說明', exact: true }).inputValue(), '');
    await page.getByRole('button', { name: '完成初檢', exact: true }).click();await page.getByText('充電：異常請補上說明與照片', { exact: true }).waitFor();
    assert.equal((await posts(page)).length, 2, 'An incomplete draft must not become READY or trigger another mutation');
    assert.equal(await page.evaluate(id => window.precheckFixture.items[id].status, itemA), 'RECEIVED');
    assert.equal(await page.evaluate(id => window.precheckFixture.items[id].physicalCustody, itemA), 'MAILROOM');
  });

  await scene('an unknown committed save retries the immutable body and revision exactly once', async page => {
    await start(page);await choose(page, '電源結果', '正常');
    await page.evaluate(() => { window.precheckFixture.commitThenLose = true; });await save(page);
    await page.getByText('保存結果尚未確認', { exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '電源結果', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).uncertain), true);
    await page.getByRole('button', { name: '重試原保存', exact: true }).click();await page.getByRole('button', { name: '儲存草稿', exact: true }).waitFor();
    const requests = await posts(page);assert.equal(requests.length, 3);assert.deepEqual(requests[1], requests[2]);
    assert.equal(await page.evaluate(() => window.precheckFixture.commits), 2);
    assert.equal(await page.evaluate(id => window.precheckFixture.documents[id].revision, itemA), 2);
    assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).uncertain), false);
  });

  await scene('conflicting start is atomic and stale document revisions require a reread', async page => {
    await loaded(page);await page.evaluate(id => { window.precheckFixture.items[id].version++; }, itemB);
    await page.getByRole('button', { name: '建立初檢草稿', exact: true }).click();await page.getByText('實物資料已更新，請重新整理後操作', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => Object.keys(window.precheckFixture.documents)), []);
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();await start(page);
    await page.evaluate(id => { window.precheckFixture.documents[id].revision++; }, itemA);
    await page.getByRole('textbox', { name: '電源說明', exact: true }).fill('保留本機草稿');await save(page);
    await page.getByText('初檢版本已更新，請重新讀取', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '電源說明', exact: true }).inputValue(), '保留本機草稿');
    assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).uncertain), false);
    assert.equal(await page.getByRole('button', { name: '儲存草稿', exact: true }).isDisabled(), false);
    await page.getByRole('button', { name: '重新讀取', exact: true }).click();await page.waitForFunction(() => !document.querySelector('.ant-spin-spinning'));
    await save(page);const requests = await posts(page);assert.equal(requests.at(-1).body.expectedRevision, 2);assert.notEqual(requests.at(-1).body.requestId, requests.at(-2).body.requestId);
  }, '?items=repair-a,repair-b');

  await scene('template selection uses a bound draft and a return can draft without a repair handoff', async page => {
    await start(page);
    await choose(page, '初檢表', '萬能充 Pro 初檢表');await page.getByRole('button', { name: '套用初檢表', exact: true }).click();
    await page.getByRole('combobox', { name: '自帶 Type-C 線結果', exact: true }).waitFor();
    const request = (await posts(page)).at(-1);assert.equal(request.body.templateBinding.id, 'MOZTECH_POWERBANK_PRO_V1');assert.deepEqual(request.body.checks, []);assert.equal(request.body.status, 'DRAFT');
    assert.equal(await page.getByRole('combobox', { name: '電源結果', exact: true }).count(), 0);
    assert.equal(await page.getByRole('combobox', { name: '無線充電結果', exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.precheckFixture.posts.some(post => /handoff|transfer|actions/.test(post.path))), false);
    assert.equal(await page.evaluate(() => window.precheckFixture.items[window.precheckFixture.aliases.return].status), 'RECEIVED');
  }, '?items=return');

  await scene('the same template ID with a new revision and hash requires an explicit empty draft rebind', async page => {
    await start(page);await choose(page, '電源結果', '正常');await choose(page, '充電結果', '正常');await save(page);
    await page.evaluate(() => window.precheckFixture.updateCustomTemplate());
    await page.getByRole('button', { name: /^關\s*閉$/ }).click();await page.locator('.ant-drawer-content:visible').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.precheckFixture.setOpen(true));
    await page.getByText('產品初檢表已更新，請重新選擇並保存草稿', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '完成初檢', exact: true }).isDisabled(), true);
    const apply = page.getByRole('button', { name: '套用初檢表', exact: true });
    assert.equal(await apply.isDisabled(), false, 'A changed binding remains applicable even when its template ID is unchanged');
    await apply.click();await page.waitForFunction(id => window.precheckFixture.documents[id].templateBinding.revision === 4, itemA);
    await page.waitForFunction(() => !document.querySelector('.ant-spin-spinning'));
    const rebind = (await posts(page)).at(-1).body;
    assert.equal(rebind.status, 'DRAFT');assert.equal(rebind.expectedRevision, 2);assert.deepEqual(rebind.checks, []);
    assert.deepEqual(rebind.templateBinding, { id: 'product:synthetic-product', revision: 4, contentHash: 'd'.repeat(64) });
    assert.match(await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '電源結果', exact: true }) }).innerText(), /未測試/);
    assert.equal(await page.getByText('產品初檢表已更新，請重新選擇並保存草稿', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '完成初檢', exact: true }).isDisabled(), false);
    const beforeReady = (await posts(page)).length;
    await page.getByRole('button', { name: '完成初檢', exact: true }).click();await page.getByText('必要初檢項目尚未完成，可先儲存草稿', { exact: true }).waitFor();assert.equal((await posts(page)).length, beforeReady);
    await choose(page, '電源結果', '正常');await choose(page, '充電結果', '正常');await save(page, true);
    const ready = (await posts(page)).at(-1).body;
    assert.equal(ready.status, 'READY');assert.equal(ready.expectedRevision, 3);assert.deepEqual(ready.templateBinding, rebind.templateBinding);
    assert.equal(await page.evaluate(id => window.precheckFixture.documents[id].status, itemA), 'READY');
  });

  await scene('an unconfigured product needs an explicit exemption and late prior-company reads stay hidden', async page => {
    await start(page);await page.getByRole('button', { name: '完成初檢', exact: true }).click();await page.getByText('請填寫不需初檢原因', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: '不需初檢原因', exact: true }).fill('僅核對外包裝，本次不作功能初檢');await save(page, true);
    const body = (await posts(page)).at(-1).body;assert.equal(body.templateBinding, null);assert.deepEqual(body.checks, []);assert.equal(body.status, 'READY');
    await page.evaluate(() => { const state = window.precheckFixture,id=state.aliases.unconfigured;state.holdReads[id]=true;state.setOpen(false); });
    await page.evaluate(() => window.precheckFixture.setOpen(true));await page.waitForFunction(() => Object.keys(window.precheckFixture.held).length === 1);
    await page.evaluate(() => { const state = window.precheckFixture,id='66666666-6666-4666-8666-666666666666';state.items[id]={...state.items[state.aliases['repair-a']],id,entityId:'company-b',label:'另一公司實物'};state.setEntity('company-b');state.setItems([id]); });
    await page.getByText('另一公司實物', { exact: true }).waitFor();await page.evaluate(() => Object.values(window.precheckFixture.held).forEach(release => release()));
    assert.equal(await page.getByText('合成實物 unconfigured', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('textbox', { name: '不需初檢原因', exact: true }).count(), 0);
  }, '?items=unconfigured');

  await scene('a product without an actual master binding cannot mark an exemption ready', async page => {
    await start(page);await page.getByText('請先核對實物產品主檔', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '不需初檢原因', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '完成初檢', exact: true }).isDisabled(), true);
    assert.equal((await posts(page)).length, 1);
    await save(page);assert.equal((await posts(page)).at(-1).body.status, 'DRAFT');
  }, '?items=unbound');

  await scene('formal handoff sends a single READY repair with its authoritative version and hashes', async page => {
    await loaded(page);const expected = await authority(page, [itemA]);assert.equal(await handoffButton(page).isDisabled(), false);
    await handoffButton(page).click();await handoffResults(page).getByText('已交維修部門', { exact: true }).waitFor();
    const requests = await handoffPosts(page);assert.equal(requests.length, 1);assertHandoffRequest(requests[0], expected);
    await handoffResults(page).getByText('合成實物 repair-a', { exact: true }).waitFor();
    const actual = await page.evaluate(id => ({ item: window.precheckFixture.items[id], document: window.precheckFixture.documents[id] }), itemA);
    assert.equal(actual.item.status, 'WAITING_REPAIR_ACCEPTANCE');assert.equal(actual.item.version, 8);assert.equal(actual.item.physicalCustody, 'MAILROOM');assert.equal(actual.item.custodianId, 'clerk');assert.equal(actual.item.location, 'A1');assert.equal(actual.item.nextUserId, null);
    assert.equal(actual.document.status, 'SUBMITTED');assert.equal(actual.document.revision, 1);assert.equal(actual.document.contentHash, expected[0].precheckHash);
    assert.equal(await page.evaluate(() => window.precheckFixture.handoffApplied), 1);
  }, '?ready=1');

  await scene('formal handoff sends multiple READY repairs with unique parent and child request IDs', async page => {
    await loaded(page);const expected = await authority(page, [itemA, itemB]);assert.equal(await handoffButton(page, 2).isDisabled(), false);
    await handoffButton(page, 2).click();await handoffResults(page).waitFor();
    assert.equal(await handoffResults(page).getByText('已交維修部門', { exact: true }).count(), 2);
    assertHandoffRequest((await handoffPosts(page))[0], expected);
    for (const label of ['合成實物 repair-a', '合成實物 repair-b']) await handoffResults(page).getByText(label, { exact: true }).waitFor();
    const versions = await page.evaluate(ids => ids.map(id => [window.precheckFixture.items[id].version, window.precheckFixture.items[id].custodianId, window.precheckFixture.items[id].physicalCustody]), [itemA, itemB]);
    assert.deepEqual(versions, [[8, 'clerk', 'MAILROOM'], [12, 'clerk', 'MAILROOM']]);
  }, '?ready=1&items=repair-a,repair-b');

  await scene('formal handoff blocks a mixed READY return and repair without sending a partial batch', async page => {
    await loaded(page);await page.getByText('合成實物 return：退貨檢查仍交客服處理', { exact: true }).waitFor();
    assert.equal(await handoffButton(page, 2).isDisabled(), true);assert.deepEqual(await handoffPosts(page), []);
    assert.deepEqual(await page.evaluate(() => Object.values(window.precheckFixture.documents).map(document => document.status)), ['READY', 'READY']);
    assert.equal(await page.evaluate(() => window.precheckFixture.handoffApplied), 0);
  }, '?ready=1&items=repair-a,return');

  await scene('formal handoff displays APPLIED and FAILED per item while native custody stays in mailroom', async page => {
    await loaded(page);await page.evaluate(() => { window.precheckFixture.handoffMode = 'partial'; });
    await handoffButton(page, 2).click();await handoffResults(page).getByText('未交辦', { exact: true }).waitFor();
    const applied = handoffResults(page).locator(':scope > div').filter({ hasText: '合成實物 repair-a' });
    const failed = handoffResults(page).locator(':scope > div').filter({ hasText: '合成實物 repair-b' });
    await applied.getByText('已交維修部門', { exact: true }).waitFor();await failed.getByText('未交辦', { exact: true }).waitFor();await failed.getByText('· 合成實物版本已更新，未交辦', { exact: true }).waitFor();
    const native = await page.evaluate(ids => ids.map(id => ({ status: window.precheckFixture.items[id].status, version: window.precheckFixture.items[id].version, custodianId: window.precheckFixture.items[id].custodianId, physicalCustody: window.precheckFixture.items[id].physicalCustody, documentStatus: window.precheckFixture.documents[id].status })), [itemA, itemB]);
    assert.deepEqual(native, [{ status: 'WAITING_REPAIR_ACCEPTANCE', version: 8, custodianId: 'clerk', physicalCustody: 'MAILROOM', documentStatus: 'SUBMITTED' }, { status: 'RECEIVED', version: 11, custodianId: 'clerk', physicalCustody: 'MAILROOM', documentStatus: 'READY' }]);
    assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).uncertain), false);assert.equal((await handoffPosts(page)).length, 1);
  }, '?ready=1&items=repair-a,repair-b');

  await scene('formal handoff treats an HTTP 200 UNKNOWN child as locked and retries every original request exactly', async page => {
    await loaded(page);await page.evaluate(() => { window.precheckFixture.handoffMode = 'unknown-once'; });
    await handoffButton(page, 2).click();await handoffResults(page).getByText('結果未確認', { exact: true }).waitFor();
    await page.getByText('交辦結果尚未確認', { exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '電源結果', exact: true }).isDisabled(), true);assert.equal(await page.getByRole('combobox', { name: '選擇初檢實物', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).uncertain), true);assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).dirty), true);
    await page.getByRole('button', { name: '重試原交辦', exact: true }).click();await page.waitForFunction(() => window.precheckFixture.handoffReceipts.length === 2);
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="逐件交辦結果"] .ant-tag')].filter(tag => tag.textContent === '已交維修部門').length === 2);
    const requests = await handoffPosts(page);assert.equal(requests.length, 2);assert.deepEqual(requests[0], requests[1]);
    const receipts = await page.evaluate(() => window.precheckFixture.handoffReceipts);assert.deepEqual(receipts[0].items.map(item => item.status), ['APPLIED', 'UNKNOWN']);assert.deepEqual(receipts[1].items.map(item => item.status), ['APPLIED', 'APPLIED']);assert.equal(receipts[1].items[0].duplicate, true);
    assert.equal(await page.evaluate(() => window.precheckFixture.handoffApplied), 2);assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).uncertain), false);
    assert.equal(await handoffResults(page).getByText('結果未確認', { exact: true }).count(), 0);
  }, '?ready=1&items=repair-a,repair-b');

  await scene('formal handoff remains disabled while a READY document has unsaved local edits', async page => {
    await loaded(page);assert.equal(await handoffButton(page).isDisabled(), false);
    await page.getByRole('textbox', { name: '電源說明', exact: true }).fill('尚未儲存的補充說明');assert.equal(await handoffButton(page).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).dirty), true);assert.deepEqual(await handoffPosts(page), []);
    await page.getByRole('textbox', { name: '電源說明', exact: true }).fill('');assert.equal(await handoffButton(page).isDisabled(), false);
    await choose(page, '初檢表', '萬能充 Pro 初檢表');assert.equal(await handoffButton(page).isDisabled(), true, 'An unapplied template choice cannot hand off the previous saved binding');
    await choose(page, '初檢表', '產品主檔初檢表');assert.equal(await handoffButton(page).isDisabled(), false);
    assert.equal(await page.evaluate(id => window.precheckFixture.documents[id].status, itemA), 'READY');assert.deepEqual(await handoffPosts(page), []);
  }, '?ready=1');

  await scene('formal handoff refuses a mismatched child receipt and retains the original immutable retry', async page => {
    await loaded(page);await page.evaluate(() => { window.precheckFixture.handoffMode = 'wrong-child-once'; });
    await handoffButton(page, 2).click();await page.getByText('交辦結果尚未確認', { exact: true }).waitFor();
    assert.equal(await handoffResults(page).count(), 0, 'A receipt for a different child request is never displayed as success');
    assert.equal(await page.evaluate(() => window.precheckFixture.drafts.at(-1).uncertain), true);assert.equal(await page.getByRole('combobox', { name: '電源結果', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '重試原交辦', exact: true }).click();await handoffResults(page).waitFor();
    assert.equal(await handoffResults(page).getByText('已交維修部門', { exact: true }).count(), 2);
    const requests = await handoffPosts(page);assert.equal(requests.length, 2);assert.deepEqual(requests[0], requests[1]);assert.equal(await page.evaluate(() => window.precheckFixture.handoffApplied), 2);
    assert.equal(await page.evaluate(() => window.precheckFixture.handoffReceipts[1].items.every(item => item.duplicate)), true);
  }, '?ready=1&items=repair-a,repair-b');

  await scene('receiving thumbnails wait for viewport intersection and start only four authenticated blobs at a time', async page => {
    await page.getByRole('button', { name: '編輯初檢 MR-1', exact: true }).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo')).length), 0, 'Offscreen rows must not start photo requests');
    await page.evaluate(() => document.getElementById('receiving-fixture-list').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo')).length === 4);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo')).length), 4, 'Eight intersecting rows share a maximum of four active requests');
    await page.evaluate(() => window.precheckFixture.releasePhotos('company-a'));
    await page.waitForFunction(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo')).length === 8);
    assert.equal(await page.locator('.mailroom-receiving-photo img').count(), 4);
    await page.evaluate(() => window.precheckFixture.releasePhotos('company-a'));
    await page.waitForFunction(() => [...document.querySelectorAll('.mailroom-receiving-photo img')].length === 8 && [...document.querySelectorAll('.mailroom-receiving-photo img')].every(image => image.complete && image.naturalWidth === 2));
    const calls = await page.evaluate(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo')));
    assert.ok(calls.every(call => call.params.entityId === 'company-a' && call.responseType === 'blob'));
    assert.equal((await posts(page)).length, 0);
  }, '?fixture=receiving&spacer=1');

  await scene('company changes abort old thumbnail queues and keyboard edit remains reachable at 320px', async page => {
    await page.waitForFunction(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo')).length === 4);
    await page.evaluate(() => window.precheckFixture.releasePhoto('company-a'));
    await page.waitForFunction(() => document.querySelectorAll('.mailroom-receiving-photo img').length === 1 && window.precheckFixture.calls.filter(call => call.path.endsWith('/photo')).length === 5);
    const oldSource = await page.locator('.mailroom-receiving-photo img').getAttribute('src');
    await page.evaluate(() => window.precheckFixture.setEntity('company-b'));
    await page.waitForFunction(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo') && call.params.entityId === 'company-b').length === 4);
    assert.equal(await page.locator('.mailroom-receiving-photo img').count(), 0);
    assert.ok(await page.evaluate(src => window.precheckFixture.revokedURLs.includes(src), oldSource), 'An already rendered old-company blob is revoked');
    assert.equal(await page.evaluate(() => window.precheckFixture.photoAborted.filter(call => call.entityId === 'company-a').length), 4);
    await page.evaluate(() => window.precheckFixture.releasePhotos('company-a'));
    await page.evaluate(() => window.precheckFixture.releasePhotos('company-b'));
    await page.waitForFunction(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo') && call.params.entityId === 'company-b').length === 8);
    await page.evaluate(() => window.precheckFixture.releasePhotos('company-b'));
    await page.waitForFunction(() => document.querySelectorAll('.mailroom-receiving-photo img').length === 8);
    assert.equal(await page.evaluate(() => window.precheckFixture.calls.filter(call => call.path.endsWith('/photo') && call.params.entityId === 'company-a').length), 5, 'Aborted old-company queue entries never start later requests');
    assert.equal(await page.evaluate(() => window.precheckFixture.objectURLs.filter(row => row.entityId === 'company-a').length), 1, 'Late old-company blobs never produce a new object URL');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.mailroom-receiving-photo img')].every(image => window.precheckFixture.objectURLs.some(row => row.src === image.getAttribute('src') && row.entityId === 'company-b'))), true);
    await page.setViewportSize({ width: 320, height: 740 });
    const edit = page.getByRole('button', { name: '編輯初檢 MR-1', exact: true });await edit.scrollIntoViewIfNeeded();await edit.click({ trial: true });await edit.focus();await edit.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.precheckFixture.inspected), [['company-b-photo-1']]);
    await page.getByRole('checkbox', { name: '選取 MR-1', exact: true }).focus();await page.getByRole('checkbox', { name: '選取 MR-1', exact: true }).press('Space');
    assert.deepEqual(await page.evaluate(() => window.precheckFixture.selections.at(-1)), ['company-b-photo-1']);
    assert.equal(await page.getByRole('button', { name: '編輯初檢 MR-8', exact: true }).isDisabled(), true, 'Correspondence is not an inspection candidate');
    const geometry = await page.evaluate(() => { const parent = document.getElementById('receiving-fixture-list');return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, paddingLeft: getComputedStyle(parent).paddingLeft, paddingRight: getComputedStyle(parent).paddingRight, outerOverflow: [document.documentElement, document.body, parent].map(element => getComputedStyle(element).overflowX) }; });
    assert.equal(geometry.paddingLeft, '12px');assert.equal(geometry.paddingRight, '12px');assert.ok(geometry.documentWidth <= geometry.width, JSON.stringify(geometry));assert.ok(geometry.outerOverflow.every(value => !['hidden', 'clip'].includes(value)));
    writeFileSync(artifactPrefix + '-receiving-320.json', JSON.stringify(geometry, null, 2) + '\n');await page.screenshot({ path: artifactPrefix + '-receiving-320.png', fullPage: true });
    assert.equal((await posts(page)).length, 0);
  }, '?fixture=receiving');

  assert.ok(summaries.length > 0, 'The scene filter must match at least one real scenario');
});
