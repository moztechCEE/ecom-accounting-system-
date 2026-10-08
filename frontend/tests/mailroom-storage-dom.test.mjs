import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import StorageWorkbench from '/src/pages/mailroom/StorageWorkbench.tsx';
import api from '/src/services/api.ts';
const item = {id:'item-one',productName:'行動電源',sku:'P-01',serialNumber:'SN100',sourceNumber:'R-100',receiptId:'receipt-one',receiptNumber:'MR-100',category:'REPAIR',storageLocationId:'a1',status:'RECEIVED',location:'A1',custodianId:'clerk',custodianName:'小明',version:4,canMove:true};
const initial = {racks:[{id:'rack-a',code:'A',name:'收件架',zone:'RECEIVING',rows:1,columns:2,layoutX:0,layoutY:0,version:3,isActive:true}],locations:[{id:'a1',code:'A1',name:'第一格',rackId:'rack-a',level:1,slot:1,version:2,isActive:true,items:[item]},{id:'a2',code:'A2',name:'第二格',rackId:'rack-a',level:1,slot:2,version:1,isActive:true,items:[]}],unassigned:[{...item,id:'legacy',storageLocationId:null,productName:'公司信件',sourceNumber:null,location:'舊櫃檯',canMove:false}],counts:{stored:1,unassigned:1},canManage:true};
window.storageTest = {calls:[],opened:[],changed:0,drafts:[],holdA:new URLSearchParams(location.search).has('hold'),held:[],failPost:0,data:initial};
api.get = async (path, config) => {
  const state=window.storageTest, entityId=config.params.entityId;
  state.calls.push({method:'GET',path,entityId});
  if(entityId==='company-a' && state.holdA) return new Promise(resolve=>state.held.push(()=>resolve({data:structuredClone(initial)})));
  if(entityId==='company-b') return {data:{racks:[{...initial.racks[0],id:'rack-c',code:'C',name:'另一公司貨架'}],locations:[{...initial.locations[1],id:'c1',rackId:'rack-c',code:'C1',name:'另一公司格',slot:1}],unassigned:[],counts:{stored:0,unassigned:0},canManage:false}};
  return {data:structuredClone(state.data)};
};
api.post = async (path,body) => {
  const state=window.storageTest; state.calls.push({method:'POST',path,body:structuredClone(body)});
  if(state.failPost-->0) throw {response:{status:503,data:{message:'連線中斷'}}};
  return {data:{duplicate:false}};
};
function Harness(){const [entityId,setEntityId]=useState('company-a');const [reset,setReset]=useState(0);const [refreshRevision,setRefreshRevision]=useState(0);window.storageTest.reset=()=>setReset(value=>value+1);window.storageTest.refresh=()=>setRefreshRevision(value=>value+1);return React.createElement(React.Fragment,null,
React.createElement('button',{id:'switch-company',onClick:()=>setEntityId('company-b')},'切換公司'),
React.createElement(StorageWorkbench,{entityId,onOpenItem:id=>window.storageTest.opened.push(id),onChanged:()=>window.storageTest.changed++,resetDraftRevision:reset,refreshRevision,onDraftChange:draft=>window.storageTest.drafts.push(draft)}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;

test('storage workbench native actions preserve custody, versions, request keys and entity isolation', { timeout: 90000, skip: !executablePath && 'No existing browser' }, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-storage-dom-'));
  const virtual = '\0mailroom-storage-fixture';
  const server = await createServer({root,cacheDir,configFile:false,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[react(),{
    name:'mailroom-storage-offline',resolveId(id){if(id==='virtual:mailroom-storage-fixture')return virtual;},load(id){if(id===virtual)return fixture;},
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/__storage'))return next();
      try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__storage','<html><body><div id="root"></div><script type="module" src="/@id/virtual:mailroom-storage-fixture"></script></body></html>'));}catch(error){next(error);}
    });}
  }]});
  t.after(async()=>{await server.close();rmSync(cacheDir,{recursive:true,force:true});});
  await server.listen();
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const base=`http://127.0.0.1:${server.httpServer.address().port}/__storage`;
  const errors=[], external=[];
  async function pageFor(suffix='',viewport={width:1280,height:1000}){
    const page=await browser.newPage({viewport});page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.href);return route.abort();}return route.continue();});
    await page.goto(base+suffix);
    await page.waitForFunction(()=>document.querySelector('.mailroom-storage')||document.querySelector('vite-error-overlay'));
    assert.equal(await page.locator('vite-error-overlay').count(),0,'The fixture must compile and mount');
    return page;
  }
  await t.test('finds visible bins and original unassigned positions, keyboard selects empty bins and mobile stays readable',async()=>{
    const page=await pageFor();
    await page.getByRole('button',{name:'A1，第一格，1 件',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('.ant-spin-spinning'));
    await page.waitForFunction(()=>[...document.querySelectorAll('.ant-spin-container')].every(element=>getComputedStyle(element).opacity==='1'));
    await page.screenshot({path:'/tmp/corely-mailroom-storage-native-desktop-20261008.png',fullPage:true});
    await page.getByRole('textbox',{name:'搜尋儲位或物品'}).fill('sn100');
    assert.equal(await page.locator('.mailroom-storage-bin.is-match').count(),1);
    await page.getByRole('button',{name:'A1，第一格，1 件',exact:true}).click();
    await page.getByRole('button',{name:'行動電源',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.storageTest.opened),['item-one']);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('textbox',{name:'搜尋儲位或物品'}).fill('');
    const empty=page.getByRole('button',{name:'A2，第二格，0 件',exact:true});await empty.focus();await empty.press('Enter');
    await page.getByText('沒有物品',{exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'未配儲位 1 件',exact:true}).click();
    await page.getByRole('button',{name:'公司信件',exact:true}).waitFor();
    assert.match(await page.locator('.ant-drawer-body').innerText(),/舊櫃檯/);
    assert.equal(await page.getByRole('button',{name:'移動儲位',exact:true}).count(),0);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByText('平面區域',{exact:true}).click();
    const floor=page.locator('.mailroom-storage-floor-rack');await floor.focus();await floor.press('Enter');
    await page.getByRole('button',{name:'A2，第二格，0 件',exact:true}).waitFor();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.getByText('立體貨架',{exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2),false);
    await page.screenshot({path:'/tmp/corely-mailroom-storage-native-mobile-20261008.png',fullPage:true});
    assert.equal((await page.evaluate(()=>window.storageTest.calls)).filter(call=>call.method==='POST').length,0);
    const beforeRefresh=await page.evaluate(()=>window.storageTest.calls.length);
    await page.evaluate(()=>{const state=window.storageTest;state.data.locations[0].items.push({...state.data.locations[0].items[0],id:'new-receipt',productName:'新收到產品'});state.data.counts.stored=2;state.refresh();});
    await page.getByRole('button',{name:'A1，第一格，2 件',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.storageTest.calls.length),beforeRefresh+1,'A mounted workbench rereads after an external receipt');
    await page.evaluate(()=>{const state=window.storageTest;state.data.locations[0].items=[];state.data.counts.stored=0;state.refresh();});
    await page.getByRole('button',{name:'A1，第一格，0 件',exact:true}).waitFor();
    assert.equal(await page.getByText('已放儲位 0 件',{exact:true}).count(),1,'Externally transferred goods do not leave a phantom occupant');
    await page.close();
  });
  await t.test('unknown create retries identical payload; changing layout sends no item movement; single movement carries original item version',async()=>{
    const page=await pageFor();await page.getByRole('button',{name:'新增貨架',exact:true}).click();
    await page.getByRole('textbox',{name:'貨架編碼',exact:true}).fill('B');await page.getByRole('textbox',{name:'貨架名稱',exact:true}).fill('待寄架');
    assert.equal(await page.evaluate(()=>window.storageTest.drafts.at(-1).dirty),true);
    await page.evaluate(()=>window.storageTest.failPost=1);
    await page.getByRole('button',{name:'儲存',exact:true}).click();await page.getByText('結果未確認，請重試原操作。',{exact:true}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'貨架編碼',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'取消',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.storageTest.drafts.at(-1).uncertain),true);
    await page.evaluate(()=>window.storageTest.reset());
    assert.equal(await page.getByRole('textbox',{name:'貨架編碼',exact:true}).inputValue(),'B','Reset never drops an uncertain original command');
    await page.evaluate(()=>window.storageTest.refresh());
    await page.waitForFunction(()=>!document.querySelector('.ant-spin-spinning'));
    assert.equal(await page.getByRole('textbox',{name:'貨架編碼',exact:true}).inputValue(),'B','Snapshot refresh preserves the original uncertain operation');
    await page.getByRole('button',{name:'重試原操作',exact:true}).click();await page.getByText('已儲存儲位配置',{exact:true}).waitFor();
    const createPosts=await page.evaluate(()=>window.storageTest.calls.filter(call=>call.method==='POST'));
    assert.equal(createPosts.length,2);assert.deepEqual(createPosts[0],createPosts[1]);assert.match(createPosts[0].body.requestId,/^storage_/);
    assert.equal(await page.evaluate(()=>window.storageTest.drafts.at(-1).dirty),false);
    await page.getByRole('button',{name:'編輯貨架 A',exact:true}).click();
    await page.getByRole('spinbutton',{name:'平面位置 X',exact:true}).fill('320');await page.getByRole('button',{name:'儲存',exact:true}).click();
    await page.waitForFunction(()=>window.storageTest.calls.filter(call=>call.method==='POST').length===3);
    const edit=(await page.evaluate(()=>window.storageTest.calls.filter(call=>call.method==='POST')))[2];
    assert.equal(edit.path,'/mailroom/storage/racks/rack-a/update');assert.equal(edit.body.expectedVersion,3);assert.equal(edit.body.layoutX,320);
    await page.locator('.ant-modal').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'A1，第一格，1 件',exact:true}).click();await page.getByRole('button',{name:'移動儲位',exact:true}).click();
    const destination=page.getByRole('combobox',{name:'移往儲位',exact:true});await destination.press('ArrowDown');
    await page.locator('.ant-select-dropdown:visible').getByText('收件區 · A2 · 第二格',{exact:true}).click();
    await page.getByRole('button',{name:'確認移位',exact:true}).click();await page.getByText('已更新物品儲位',{exact:true}).waitFor();
    const moves=await page.evaluate(()=>window.storageTest.calls.filter(call=>call.method==='POST'&&call.path.includes('/items/')));
    assert.equal(moves.length,1);assert.equal(moves[0].path,'/mailroom/storage/items/item-one/move');
    assert.equal(moves[0].body.expectedVersion,4);assert.equal(moves[0].body.storageLocationId,'a2');assert.equal(moves[0].body.entityId,'company-a');
    assert.equal('status'in moves[0].body,false);assert.equal('custodianId'in moves[0].body,false);
    await page.locator('.ant-modal').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'新增貨架',exact:true}).click();await page.getByRole('textbox',{name:'貨架編碼',exact:true}).fill('discard');
    await page.evaluate(()=>window.storageTest.reset());await page.locator('.ant-modal').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.storageTest.drafts.at(-1).dirty),false,'Explicit parent discard resets only an uncommitted draft');
    await page.close();
  });
  await t.test('late source-company GET cannot reveal old bins or management after switching companies',async()=>{
    const page=await pageFor('?hold');await page.waitForFunction(()=>window.storageTest.held.length===1);await page.locator('#switch-company').click();
    await page.getByRole('button',{name:'C1，另一公司格，0 件',exact:true}).waitFor();
    await page.evaluate(()=>{window.storageTest.held.forEach(release=>release());window.storageTest.held=[];});
    await page.waitForFunction(()=>!document.querySelector('.ant-spin-spinning'));
    assert.equal(await page.getByRole('button',{name:'A1，第一格，1 件',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'新增貨架',exact:true}).count(),0);
    assert.equal(await page.getByText('未配儲位 0 件',{exact:true}).count(),1);
    assert.equal((await page.evaluate(()=>window.storageTest.calls)).filter(call=>call.method==='POST').length,0);
    await page.close();
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
