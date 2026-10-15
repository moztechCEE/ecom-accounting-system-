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
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import MailroomPage from '/src/pages/mailroom/MailroomPage.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};
const mode=new URLSearchParams(location.search).get('fixtureMode')||'mailroom';
const router=createMemoryRouter([{path:'/operations/mailroom',element:React.createElement('main',{id:'fixture-operations-content',style:{padding:'16px 12px'}},React.createElement(MailroomPage,{mode}))},{path:'/other',element:React.createElement('h2',null,'其他工作台')}],{initialEntries:['/operations/mailroom'+location.search]});
window.deeplinkRouter=router;
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const api = `
export const API_URL='/offline-api';
const readOnly=new URLSearchParams(location.search).has('readOnly');
const item={id:'item-one',label:'MR-SYNTHETIC',productName:'合成信件',sku:null,serialNumber:null,status:'WAITING_PICKUP',version:1,location:'A1',storageLocationId:'a1',custodianId:'clerk',custodianName:'合成收發人員',physicalCustody:'MAILROOM',nextUserId:null,nextUserName:null,repairOwnerId:null,evidence:[],evidenceCount:0,history:[],allowedIntakeActions:[],receipt:{id:'receipt-one',number:'MR-SYNTHETIC',category:'LETTER',sourceCaseId:null,sourceNumber:null,senderLabel:'合成公司',receivedAt:'2026-10-16T00:00:00Z'}};
const storage={racks:[{id:'rack-a',code:'A',name:'合成貨架',zone:'RECEIVING',rows:4,columns:1,layoutX:0,layoutY:0,version:1,isActive:true}],locations:[{id:'a1',code:'A1',name:'A1',rackId:'rack-a',level:1,slot:1,purpose:null,version:1,isActive:true,items:[]}],unassigned:[],counts:{stored:0,unassigned:0},canManage:!readOnly};
window.deeplinkFixture={calls:[],posts:[],unexpected:[]};
export default {
  async get(path,config={}) {
    const params=structuredClone(config.params||{});window.deeplinkFixture.calls.push({path,params});
    if(path==='/mailroom/people'||path==='/mailroom/tasks')return {data:[]};
    if(path==='/mailroom/items')return {data:{items:[],total:0}};
    if(path==='/mailroom/items/item-one')return {data:structuredClone(item)};
    if(path==='/mailroom/storage')return {data:structuredClone(storage)};
    if(path==='/mailroom/outbound/orders')return {data:{items:[],total:0}};
    window.deeplinkFixture.unexpected.push(path);throw Error('Unexpected offline GET '+path);
  },
  async post(path,body) {window.deeplinkFixture.posts.push({path,body});throw Error('No mutation is allowed in storage deeplink tests');}
};
`;

test('actual mailroom storage deeplink loads directly and preserves other initial tabs and navigation guards', { timeout: 90000, skip: !executablePath && 'No existing browser; never installs one' }, async t => {
  const cacheDir=mkdtempSync(join(tmpdir(),'corely-storage-deeplink-')), virtual='\0storage-deeplink-fixture';
  const server=await createServer({root,cacheDir,configFile:false,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[react(),{
    name:'offline-actual-mailroom-storage-deeplink',
    resolveId(id){if(id==='virtual:storage-deeplink-fixture')return virtual;},
    load(id){
      if(id===virtual)return fixture;
      if(id.endsWith('/src/services/api.ts'))return api;
      if(id.endsWith('/src/contexts/AuthContext.tsx'))return `const user={id:'clerk',roles:[],permissions:new URLSearchParams(location.search).has('readOnly')?['mailroom:read']:['mailroom:read','mailroom:create','mailroom:update']};export const useAuth=()=>({user});`;
      if(id.endsWith('/src/services/websocket.service.ts'))return 'export const webSocketService={subscribe:()=>()=>{}};';
    },
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/__storage-deeplink'))return next();
      try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__storage-deeplink','<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0"><div id="root"></div><script type="module" src="/@id/virtual:storage-deeplink-fixture"></script></body></html>'));}catch(error){next(error);}
    });},
  }]});
  await server.listen();t.after(async()=>{await server.close();rmSync(cacheDir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  async function open(child,query='?entityId=company-a',viewport={width:1280,height:1000}) {
    const page=await browser.newPage({viewport});page.setDefaultTimeout(8000);
    const errors=[],external=[],httpWrites=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const request=route.request();
      if(new URL(request.url()).origin!==origin){external.push(request.url());return route.abort();}
      if(request.method()!=='GET'){httpWrites.push(request.method()+' '+request.url());return route.abort();}
      return route.continue();
    });
    child.after(async()=>{
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(httpWrites,[]);
      assert.deepEqual(await page.evaluate(()=>window.deeplinkFixture.unexpected),[]);
      assert.deepEqual(await page.evaluate(()=>window.deeplinkFixture.posts),[]);
      await page.close();
    });
    await page.addInitScript(()=>localStorage.setItem('entityId','stale-company'));
    await page.goto(origin+'/__storage-deeplink'+query);
    return page;
  }
  async function selected(page,name) {await page.getByRole('tab',{name,exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');}
  const storageCalls=page=>page.evaluate(()=>window.deeplinkFixture.calls.filter(call=>call.path==='/mailroom/storage'));

  await t.test('storage URL selects storage and loads its company without a preceding tab click',async child=>{
    const page=await open(child,'?entityId=company-a&tab=storage');
    await selected(page,'儲位管理');await page.getByRole('button',{name:'A1，A1，收件，0 件',exact:true}).waitFor();
    assert.equal(await page.locator('.mailroom-storage-shelf').count(),4);
    assert.deepEqual((await storageCalls(page)).map(call=>call.params.entityId),['company-a']);
    assert.equal(await page.getByRole('tab',{name:'收件與交接',exact:true}).getAttribute('aria-selected'),'false');
    assert.equal(await page.getByText('物件與進度',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.deeplinkFixture.calls.some(call=>call.path==='/mailroom/outbound/orders')),false);
    await page.waitForFunction(()=>[...document.querySelectorAll('.ant-spin-container')].every(element=>getComputedStyle(element).opacity==='1'));
    await page.screenshot({path:'/tmp/corely-mailroom-storage-deeplink-desktop-20261016.png',fullPage:true});
  });
  await t.test('storage URL at 320px fits inside the actual 12px content padding without hiding overflow',async child=>{
    const page=await open(child,'?entityId=company-a&tab=storage',{width:320,height:740});
    await selected(page,'儲位管理');const target=page.getByRole('button',{name:'A1，A1，收件，0 件',exact:true});await target.waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.ant-spin-container')].every(element=>getComputedStyle(element).opacity==='1'));
    const geometry=await page.evaluate(()=>{
      const parent=document.getElementById('fixture-operations-content'),mailroom=document.querySelector('.mailroom-page'),tabs=mailroom.querySelector('.ant-tabs');
      return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,paddingLeft:getComputedStyle(parent).paddingLeft,paddingRight:getComputedStyle(parent).paddingRight,parentWidth:parent.getBoundingClientRect().width,mailroomWidth:mailroom.getBoundingClientRect().width,tabsRight:tabs.getBoundingClientRect().right,gridColumns:getComputedStyle(mailroom).gridTemplateColumns,outerOverflow:[document.documentElement,document.body,parent,mailroom].map(element=>getComputedStyle(element).overflowX)};
    });
    child.diagnostic(JSON.stringify(geometry));
    const artifact='/tmp/corely-mailroom-storage-mobile-'+(process.env.MAILROOM_MOBILE_STAGE||'current')+'-20261016';
    writeFileSync(artifact+'.json',JSON.stringify(geometry,null,2)+'\n');await page.screenshot({path:artifact+'.png',fullPage:true});
    assert.equal(geometry.paddingLeft,'12px');assert.equal(geometry.paddingRight,'12px');
    assert.ok(geometry.outerOverflow.every(value=>!['hidden','clip'].includes(value)),'Outer containers must expose layout overflow instead of masking it');
    assert.ok(geometry.documentWidth<=geometry.viewport,'Document overflows at 320px: '+JSON.stringify(geometry));
    assert.ok(geometry.bodyWidth<=geometry.viewport,'Body overflows at 320px');
    assert.ok(geometry.tabsRight<=geometry.viewport-12,'Tabs stay inside the actual content padding');
    await target.scrollIntoViewIfNeeded();await target.click({trial:true});await target.focus();await target.press('Enter');
    await page.locator('.ant-drawer-title').filter({hasText:'A1 · A1'}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  });
  await t.test('default received tab loads storage only after selection and retains the real draft navigation guard',async child=>{
    const page=await open(child);await selected(page,'收件與交接');await page.getByText('物件與進度',{exact:true}).waitFor();
    assert.deepEqual(await storageCalls(page),[]);
    await page.getByRole('tab',{name:'儲位管理',exact:true}).click();await selected(page,'儲位管理');await page.getByRole('button',{name:'A1，A1，收件，0 件',exact:true}).waitFor();
    await page.getByRole('tab',{name:'收件與交接',exact:true}).click();await selected(page,'收件與交接');
    await page.getByRole('tab',{name:'儲位管理',exact:true}).click();await selected(page,'儲位管理');
    await page.getByRole('button',{name:'新增貨架',exact:true}).click();await page.getByRole('textbox',{name:'貨架編碼',exact:true}).fill('DRAFT');
    await page.evaluate(()=>{void window.deeplinkRouter.navigate('/other');});
    await page.locator('.ant-modal-confirm-title').filter({hasText:'目前收發工作有未保存的修改'}).waitFor();await page.getByRole('button',{name:'繼續編輯',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'貨架編碼',exact:true}).inputValue(),'DRAFT');await selected(page,'儲位管理');await page.locator('.ant-modal-confirm').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.deeplinkRouter.state.location.pathname),'/operations/mailroom');
    await page.evaluate(()=>{void window.deeplinkRouter.navigate('/other');});await page.getByRole('button',{name:'放棄草稿',exact:true}).click();
    await page.getByRole('heading',{name:'其他工作台',exact:true}).waitFor();
  });
  await t.test('outbound URL retains outbound queue status and does not mount storage',async child=>{
    const page=await open(child,'?entityId=company-a&tab=outbound');await selected(page,'寄件');await page.getByText('維修寄回',{exact:true}).waitFor();
    await page.waitForFunction(()=>window.deeplinkFixture.calls.some(call=>call.path==='/mailroom/outbound/orders'));
    const lists=await page.evaluate(()=>window.deeplinkFixture.calls.filter(call=>call.path==='/mailroom/items'));
    assert.ok(lists.length>0);assert.ok(lists.every(call=>call.params.status==='READY_FOR_DISPATCH'));
    assert.deepEqual(await storageCalls(page),[]);
  });
  await t.test('storage URL preserves itemId, URL company precedence and readonly management boundaries',async child=>{
    const page=await open(child,'?entityId=company-b&tab=storage&itemId=item-one&readOnly=1');await selected(page,'儲位管理');
    await page.getByRole('heading',{name:'合成信件',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'新增貨架',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'登記收件',exact:true}).count(),0);
    const calls=await page.evaluate(()=>window.deeplinkFixture.calls);assert.ok(calls.some(call=>call.path==='/mailroom/items/item-one'));assert.ok(calls.every(call=>call.params.entityId==='company-b'));
    await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('.ant-drawer-content').filter({has:page.getByText('物件進度與交接',{exact:true})}).waitFor({state:'hidden'});await selected(page,'儲位管理');
    await page.getByRole('button',{name:'A1，A1，收件，0 件',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>new URLSearchParams(window.deeplinkRouter.state.location.search).has('itemId')),false);
  });
  await t.test('storage query does not change repair or mine workbench modes',async child=>{
    for(const mode of ['repair','mine']) {
      const page=await open(child,'?entityId=company-a&tab=storage&fixtureMode='+mode);
      await page.getByRole('heading',{name:mode==='repair'?'維修工作台':'我的待辦與收件',exact:true}).waitFor();
      assert.equal(await page.getByRole('tab',{name:'儲位管理',exact:true}).count(),0);assert.deepEqual(await storageCalls(page),[]);
    }
  });
});
