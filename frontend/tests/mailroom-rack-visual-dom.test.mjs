import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import React from 'react';import {createRoot} from 'react-dom/client';
import StorageWorkbench from '/src/pages/mailroom/StorageWorkbench.tsx';
import '/src/pages/mailroom/mailroom.css';
window.__APP_CONFIG__={mailroomEnabled:true};
createRoot(document.getElementById('root')).render(React.createElement('main',{id:'rack-visual-content',style:{padding:'16px 12px'}},React.createElement('div',{className:'mailroom-page'},React.createElement(StorageWorkbench,{entityId:'company-a',onOpenItem:id=>window.rackVisualFixture.opened.push(id)}))));
`;
const api = `
export const API_URL='/offline-api';
const dense=new URLSearchParams(location.search).has('dense'),readOnly=new URLSearchParams(location.search).has('readOnly'),single=new URLSearchParams(location.search).has('single');
const rack={id:'rack-a',code:'QA_STORAGE_1016',name:'收發室一號貨架',zone:'RECEIVING',rows:single?1:4,columns:8,layoutX:0,layoutY:0,version:6,isActive:true};
const item={id:'item-one',productName:'行動電源',sku:'P-01',serialNumber:'SN100',sourceNumber:'R-100',receiptId:'receipt-one',receiptNumber:'MR-100',category:'REPAIR',storageLocationId:'loc-4-1',status:'RECEIVED',location:'QA-RECEIVING-A4-01-20261016',custodianId:'clerk',custodianName:'收發人員',version:4,canMove:false};
const counts=single?[1]:dense?[8,1,3,2]:[2,1,3,2];
const names={1:'待寄配件',2:'待寄產品',3:'一般收件',4:'維修待點收'};
const locations=counts.flatMap((count,index)=>Array.from({length:count},(_,slot)=>{
  const level=index+1,purpose=slot===1||(dense&&level===1&&slot===7)?'OUTBOUND':null,amount=(level+slot)%4;
  return {id:'loc-'+level+'-'+(slot+1),code:'QA-'+(purpose?'OUTBOUND':'RECEIVING')+'-A'+level+'-0'+(slot+1)+'-20261016',name:dense&&level===1&&slot===7?'這是完整保留的長儲位名稱，不可被改為假編號':names[level]+(slot+1),rackId:rack.id,level,slot:slot+1,purpose,version:3,isActive:true,items:Array.from({length:amount},(_,n)=>({...item,id:'item-'+level+'-'+slot+'-'+n}))};
}));
const snapshot={racks:[rack],locations,unassigned:[],counts:{stored:locations.reduce((sum,location)=>sum+location.items.length,0),unassigned:0},canManage:!readOnly};
window.rackVisualFixture={calls:[],posts:[],opened:[],unexpected:[],snapshot};
export default {
  async get(path,config={}) {window.rackVisualFixture.calls.push({path,params:structuredClone(config.params||{})});if(path==='/mailroom/storage')return {data:structuredClone(snapshot)};window.rackVisualFixture.unexpected.push(path);throw Error('Unexpected offline GET '+path);},
  async post(path,body) {window.rackVisualFixture.posts.push({path,body});throw Error('No mutation is allowed in rack visual tests');}
};
`;

test('open rack visual hierarchy keeps real identity, mixed purposes and mobile keyboard access', {timeout:90000,skip:!executablePath&&'No existing browser; never installs one'},async t=>{
  const cacheDir=mkdtempSync(join(tmpdir(),'corely-rack-visual-')),virtual='\0rack-visual-fixture';
  const server=await createServer({root,cacheDir,configFile:false,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[react(),{
    name:'offline-rack-visual',resolveId(id){if(id==='virtual:rack-visual-fixture')return virtual;},
    load(id){if(id===virtual)return fixture;if(id.endsWith('/src/services/api.ts'))return api;},
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/__rack-visual'))return next();
      try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__rack-visual','<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0"><div id="root"></div><script type="module" src="/@id/virtual:rack-visual-fixture"></script></body></html>'));}catch(error){next(error);}
    });},
  }]});
  await server.listen();t.after(async()=>{await server.close();rmSync(cacheDir,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  async function open(child,query='',viewport={width:1120,height:1060}){
    const page=await browser.newPage({viewport});page.setDefaultTimeout(8000);const errors=[],external=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!==origin){external.push(request.url());return route.abort();}if(request.method()!=='GET'){writes.push(request.method()+' '+request.url());return route.abort();}return route.continue();});
    child.after(async()=>{assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);assert.deepEqual(await page.evaluate(()=>window.rackVisualFixture.posts),[]);assert.deepEqual(await page.evaluate(()=>window.rackVisualFixture.unexpected),[]);await page.close();});
    await page.goto(origin+'/__rack-visual'+query);await page.locator('.mailroom-storage-bin').first().waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.ant-spin-container')].every(element=>getComputedStyle(element).opacity==='1'));
    return page;
  }
  async function screenshot(page,name){await page.screenshot({path:'/tmp/corely-mailroom-rack-depth-20261027-'+name+'.png',fullPage:true});}
  async function closeDrawer(page){await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('.ant-drawer-content').waitFor({state:'hidden'});}
  async function geometry(page){return page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,outerOverflow:[document.documentElement,document.body,document.getElementById('rack-visual-content'),document.querySelector('.mailroom-page')].map(element=>getComputedStyle(element).overflowX),shelves:[...document.querySelectorAll('.mailroom-storage-shelf-locations')].map(element=>({width:element.clientWidth,scrollWidth:element.scrollWidth,overflow:getComputedStyle(element).overflowX}))}));}

  await t.test('four continuous shelves use actual names, secondary full codes and per-location purposes',async child=>{
    const page=await open(child);const rack=page.locator('[data-rack-id="rack-a"]');
    assert.deepEqual(await rack.locator('.mailroom-storage-shelf').evaluateAll(shelves=>shelves.map(shelf=>[Number(shelf.dataset.level),shelf.querySelectorAll('.mailroom-storage-bin').length])),[[4,2],[3,3],[2,1],[1,2]]);
    assert.equal(await rack.locator('.mailroom-storage-post').count(),4);
    assert.equal(await rack.locator('.mailroom-storage-rack-heading strong').innerText(),'收發室一號貨架');
    const first=rack.locator('[data-location-id="loc-4-1"]');
    assert.equal(await first.locator('.mailroom-storage-bin-name').innerText(),'維修待點收1');
    assert.equal(await first.locator('.mailroom-storage-bin-code').innerText(),'QA-RECEIVING-A4-01-20261016');
    assert.equal(await first.locator('.mailroom-storage-bin-code').getAttribute('title'),'QA-RECEIVING-A4-01-20261016');
    assert.equal(await first.getAttribute('aria-label'),'QA-RECEIVING-A4-01-20261016，維修待點收1，收件，0 件');
    assert.equal(await rack.locator('[data-location-id="loc-4-2"] .mailroom-storage-bin-purpose').innerText(),'待寄');
    assert.equal(await rack.locator('[data-location-id="loc-4-2"]').getAttribute('data-purpose'),'OUTBOUND');
    assert.equal(await rack.locator('.mailroom-storage-shelf-beam>span').first().evaluate(element=>parseFloat(getComputedStyle(element).fontSize)>=12),true);
    await screenshot(page,'desktop');
    await first.click();await page.locator('.ant-drawer-title').filter({hasText:'QA-RECEIVING-A4-01-20261016 · 維修待點收1'}).waitFor();
    await page.getByText('沒有物品',{exact:true}).waitFor();await closeDrawer(page);
  });
  await t.test('320px with 12px parent padding keeps four levels and wraps real locations without clipping',async child=>{
    const page=await open(child,'',{width:320,height:820});const info=await geometry(page);
    assert.equal(info.document,320);assert.equal(info.body,320);assert.ok(info.outerOverflow.every(value=>!['hidden','clip'].includes(value)));
    assert.equal(info.shelves.length,4);assert.ok(info.shelves.every(shelf=>shelf.scrollWidth<=shelf.width));assert.ok(info.shelves.every(shelf=>shelf.overflow==='visible'));
    assert.equal(await page.locator('.mailroom-storage-bin-name').first().evaluate(element=>getComputedStyle(element).transform),'none');
    await screenshot(page,'mobile');
    const target=page.locator('[data-location-id="loc-3-3"]');await page.locator('[data-location-id="loc-3-1"]').focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');
    assert.equal(await target.evaluate(element=>element===document.activeElement),true);
    await page.waitForFunction(()=>{const bounds=document.querySelector('[data-location-id="loc-3-3"]').getBoundingClientRect();return bounds.x>=12&&bounds.right<=308;});
    await target.press('Enter');
    await page.locator('.ant-drawer-title').filter({hasText:'QA-RECEIVING-A3-03-20261016 · 一般收件3'}).waitFor();await closeDrawer(page);
    const bounds=await target.boundingBox();assert.ok(bounds.x>=12&&bounds.x+bounds.width<=308,'The complete keyboard target remains inside the content width');assert.ok(bounds.width>=44&&bounds.height>=44);
    writeFileSync('/tmp/corely-mailroom-rack-depth-20261027-mobile-geometry.json',JSON.stringify(info,null,2)+'\n');
  });
  await t.test('single-level receiving rack remains open and usable at desktop and 320px',async child=>{
    const page=await open(child,'?single=1',{width:1192,height:780});const rack=page.locator('[data-rack-id="rack-a"]');
    assert.equal(await rack.locator('.mailroom-storage-shelf').count(),1);
    assert.equal(await rack.locator('[data-level="1"] .mailroom-storage-bin').count(),1);
    await screenshot(page,'single-desktop');
    await page.setViewportSize({width:320,height:820});
    assert.equal((await geometry(page)).document,320);
    const target=rack.locator('[data-location-id="loc-1-1"]');
    await target.focus();await target.press('Enter');
    await page.locator('.ant-drawer-title').filter({hasText:'QA-RECEIVING-A1-01-20261016 · 待寄配件1'}).waitFor();
    await closeDrawer(page);await screenshot(page,'single-mobile');
    const bounds=await target.boundingBox();assert.ok(bounds.x>=12&&bounds.x+bounds.width<=308);
  });
  await t.test('eight locations keep stable identity and full long names reachable on readonly mobile',async child=>{
    const page=await open(child,'?dense=1&readOnly=1',{width:320,height:820});
    assert.equal(await page.getByRole('button',{name:'新增貨架',exact:true}).count(),0);assert.equal(await page.locator('.mailroom-storage-add-location').count(),0);
    assert.equal(await page.locator('[data-level="1"] .mailroom-storage-bin').count(),8);
    const target=page.locator('[data-location-id="loc-1-8"]');await target.focus();await target.press('Enter');
    await page.locator('.ant-drawer-title').filter({hasText:'QA-OUTBOUND-A1-08-20261016 · 這是完整保留的長儲位名稱，不可被改為假編號'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'編輯儲位',exact:true}).count(),0);await closeDrawer(page);
    assert.equal(await target.locator('.mailroom-storage-bin-name').getAttribute('title'),'這是完整保留的長儲位名稱，不可被改為假編號');
    assert.equal(await target.locator('.mailroom-storage-bin-code').innerText(),'QA-OUTBOUND-A1-08-20261016');
    const bounds=await target.boundingBox();assert.ok(bounds.x>=12&&bounds.x+bounds.width<=308);
    assert.equal((await geometry(page)).document,320);
    await page.getByRole('textbox',{name:'搜尋儲位或物品'}).fill('QA-OUTBOUND-A1-08-20261016');
    assert.equal(await target.evaluate(element=>element.classList.contains('is-match')),true);
    assert.equal(await page.locator('[data-level="1"] .mailroom-storage-bin').count(),8,'Search highlights the original physical location without removing or renumbering positions');
    await screenshot(page,'mobile-dense');
  });
});
