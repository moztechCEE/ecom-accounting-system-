import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
const root = fileURLToPath(new URL('../',import.meta.url));
const itemA='11111111-1111-4111-8111-111111111111', itemB='22222222-2222-4222-8222-222222222222';
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import RepairCaseScan from '/src/pages/repair/RepairCaseScan.tsx';
localStorage.setItem('access_token','synthetic-token-a');
const state=window.scanFixture={opens:[],gets:[],held:{},mode:'accept',setEntity:null,setActive:null,setDisabled:null,
  settle(code){const held=this.held[code];if(!held)throw Error('missing held '+code);delete this.held[code];held.resolve({data:held.data});},
  finishOpen(accepted){this.openResolve?.(accepted);}};
function App(){
  const [entity,setEntity]=useState('company-a'),[active,setActive]=useState(true),[disabled,setDisabled]=useState(false);
  Object.assign(state,{setEntity,setActive,setDisabled});
  return React.createElement('main',null,React.createElement(RepairCaseScan,{entityId:entity,active,disabled,onOpen:async target=>{
    state.opens.push(target);if(state.mode==='decline')return false;
    if(state.mode==='hold-open')return await new Promise(resolve=>{state.openResolve=resolve;});
    setActive(false);return true;
  }}),React.createElement('input',{'aria-label':'案件表單'}));
}
createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const api = `
const clone=value=>structuredClone(value);
const match=(entityId,itemId,productName,label,receiptNumber)=>({entityId,itemId,productName,label,receiptNumber,sourceNumber:'CASE-MULTI',status:'INSPECTING',statusLabel:'檢測中'});
export default {async get(path,options={}){
  const {entityId,code}=options.params||{};
  if(path!=='/repair-workbench/lookup')throw Error('Unexpected offline request '+path);
  const request={path,params:clone(options.params),aborted:options.signal?.aborted===true};window.scanFixture.gets.push(request);
  options.signal?.addEventListener('abort',()=>{request.aborted=true;},{once:true});
  const first=match(entityId,'${itemA}','Moztech 測試充電座','實物甲','RCPT-001');
  const second=match(entityId,'${itemB}','BONSON 測試風扇','實物乙','RCPT-002');
  let data={kind:'MATCH',entityId,matches:[first]};
  if(code==='CASE-MULTI')data={kind:'MULTIPLE',entityId,matches:[first,second]};
  if(code==='CASE-AMBIG')data={kind:'AMBIGUOUS',entityId,matches:[first,second]};
  if(code==='CASE-NONE')data={kind:'NOT_FOUND',entityId,matches:[]};
  if(code==='CASE-LIMIT')data={kind:'AMBIGUOUS',entityId,matches:[],limitExceeded:true};
  if(code==='CASE-BROKEN')data={kind:'MATCH',entityId,matches:[first,second]};
  if(code==='CASE-CROSS')data={kind:'MATCH',entityId,matches:[{...first,entityId:'other-company'}]};
  if(code==='CASE-ERROR')throw Object.assign(Error('synthetic failure'),{response:{status:503}});
  if(code==='CASE-DENIED')throw Object.assign(Error('synthetic denied'),{response:{status:403}});
  if(code.startsWith('HOLD-'))return await new Promise(resolve=>{window.scanFixture.held[code]={resolve,data};});
  return {data};
},async post(){throw Error('Business write attempted');}};
`;

test('repair scanner resolves native identity and exact case codes without automatic workflow actions',{
  skip:!executablePath && 'Requires an existing browser; no installation',timeout:120000,
},async t=>{
  const cacheDir=mkdtempSync(join(tmpdir(),'corely-repair-case-scan-'));
  const virtual='\0repair-case-scan-fixture.tsx';
  const server=await createServer({root,cacheDir,configFile:false,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[react(),{
    name:'offline-repair-case-scan',
    resolveId(id){if(id==='virtual:repair-case-scan-fixture')return virtual;},
    load(id){if(id===virtual)return fixture;if(id.endsWith('/src/services/api.ts'))return api;},
    configureServer(vite){vite.middlewares.use(async(request,response,next)=>{
      if(!request.url?.startsWith('/__repair-case-scan'))return next();
      try{const html=await vite.transformIndexHtml('/__repair-case-scan',`<html lang="zh-Hant"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:repair-case-scan-fixture"></script></body></html>`);
        response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);
      }catch(error){next(error);}
    });},
  }]});
  t.after(async()=>{await server.close();rmSync(cacheDir,{recursive:true,force:true});});
  await server.listen();
  const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  const errors=[],external=[],writes=[];
  const createPage=async()=>{
    const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const request=route.request();
      if(new URL(request.url()).hostname!=='127.0.0.1'){external.push(request.url());return route.abort();}
      if(!['GET','HEAD'].includes(request.method())){writes.push(request.method()+' '+request.url());return route.abort();}
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__repair-case-scan`);
    await page.locator('.repair-case-scan input[aria-label="掃描 QR code 或輸入案件編號"]').waitFor();return page;
  };
  const scanner=page=>page.locator('.repair-case-scan input[aria-label="掃描 QR code 或輸入案件編號"]');
  const scan=async(page,code)=>{await scanner(page).fill(code);await scanner(page).press('Enter');};
  const opens=page=>page.evaluate(()=>window.scanFixture.opens);

  await t.test('native UUID and same-origin printed QR open the existing item without exact-case HTTP',async()=>{
    for(const makeCode of [()=>itemA,origin=>`${origin}/operations/repair?entityId=company-a&itemId=${itemA}&queue=all`,
      origin=>`${origin}/operations/mailroom?entityId=company-a&itemId=${itemA}`]){
      const page=await createPage();try{
        const code=makeCode(new URL(page.url()).origin);await scan(page,code);
        await page.waitForFunction(()=>window.scanFixture.opens.length===1);
        assert.deepEqual(await opens(page),[{entityId:'company-a',itemId:itemA}]);
        assert.equal(await page.evaluate(()=>window.scanFixture.gets.length),0);
        assert.equal(await scanner(page).inputValue(),'');
      }finally{await page.close();}
    }
  });

  await t.test('Enter resolves exact, case-preserving company code and a successful open clears it',async()=>{
    const page=await createPage();try{
      await scan(page,'  CASE-20261029-lowerSuffix  ');
      await page.waitForFunction(()=>window.scanFixture.opens.length===1);
      assert.deepEqual(await page.evaluate(()=>window.scanFixture.gets.map(({path,params})=>({path,params}))),[
        {path:'/repair-workbench/lookup',params:{entityId:'company-a',code:'CASE-20261029-lowerSuffix'}},
      ]);
      assert.equal(await scanner(page).inputValue(),'');
    }finally{await page.close();}
  });

  await t.test('multiple physical items and ambiguous case identities require an explicit product choice',async()=>{
    for(const code of ['CASE-MULTI','CASE-AMBIG']){
      const page=await createPage();try{
        await scan(page,code);
        await page.getByRole('button',{name:/BONSON 測試風扇/}).waitFor();
        assert.deepEqual(await opens(page),[]);
        assert.equal(await scanner(page).inputValue(),code);
        assert.equal(await page.locator('.repair-case-scan-option').count(),2);
        await page.getByRole('button',{name:/BONSON 測試風扇/}).click();
        await page.waitForFunction(()=>window.scanFixture.opens.length===1);
        assert.deepEqual(await opens(page),[{entityId:'company-a',itemId:itemB}]);
      }finally{await page.close();}
    }
  });

  await t.test('unknown, over-limit, malformed, cross-company and permission errors stay closed with brief feedback',async()=>{
    for(const [code,message] of [['CASE-NONE','找不到此案件'],['CASE-LIMIT','案件號碼無法唯一定位，請掃描實物標籤'],
      ['CASE-BROKEN','案件資料無法確認，請重試'],['CASE-CROSS','案件資料無法確認，請重試'],
      ['CASE-ERROR','無法查詢案件，請重試'],['CASE-DENIED','沒有此案件的查閱權限']]){
      const page=await createPage();try{
        await scan(page,code);await page.getByRole('alert').getByText(message,{exact:true}).waitFor();
        assert.deepEqual(await opens(page),[]);assert.equal(await scanner(page).inputValue(),code);
        assert.equal(await page.locator('.repair-case-scan-option').count(),0);
      }finally{await page.close();}
    }
  });

  await t.test('external URLs, unsafe QR options and query fragments never become lookup or navigation',async()=>{
    const page=await createPage();try{
      const origin=new URL(page.url()).origin;
      for(const code of [`https://outside.invalid/operations/repair?entityId=company-a&itemId=${itemA}`,
        `${origin}/operations/repair?entityId=company-b&itemId=${itemA}&queue=all`,
        `${origin}/operations/repair?entityId=company-a&itemId=${itemA}&queue=all&next=/admin`,
        `${origin}/operations/repair?entityId=company-a&itemId=${itemA}#unsafe`,
        'CASE-ONE?entityId=company-b','CASE/ONE','CASE\\ONE','a'.repeat(201),'CASE ONE']){
        await scan(page,code);await page.getByRole('alert').waitFor();
      }
      assert.deepEqual(await opens(page),[]);assert.equal(await page.evaluate(()=>window.scanFixture.gets.length),0);
    }finally{await page.close();}
  });

  await t.test('a declined dirty-draft open retains both scanned code and explicit product choices',async()=>{
    const page=await createPage();try{
      await page.evaluate(()=>window.scanFixture.mode='decline');await scan(page,'CASE-MULTI');
      await page.getByRole('button',{name:/BONSON 測試風扇/}).click();
      await page.waitForFunction(()=>window.scanFixture.opens.length===1);
      assert.equal(await scanner(page).inputValue(),'CASE-MULTI');assert.equal(await scanner(page).isEnabled(),true);
      assert.equal(await page.locator('.repair-case-scan-option').count(),2);
      await page.evaluate(()=>window.scanFixture.mode='accept');
      await page.getByRole('button',{name:/BONSON 測試風扇/}).click();
      await page.waitForFunction(()=>window.scanFixture.opens.length===2);
      assert.equal(await scanner(page).inputValue(),'');
    }finally{await page.close();}
  });

  await t.test('company changes and later scans invalidate old requests before any case can open',async()=>{
    const page=await createPage();try{
      await scan(page,'HOLD-COMPANY');await page.waitForFunction(()=>!!window.scanFixture.held['HOLD-COMPANY']);
      await page.evaluate(()=>window.scanFixture.setEntity('company-b'));await page.waitForFunction(()=>document.querySelector('.repair-case-scan input').value==='');
      await page.evaluate(()=>window.scanFixture.settle('HOLD-COMPANY'));
      assert.deepEqual(await opens(page),[]);
      await scan(page,'HOLD-OLD');await page.waitForFunction(()=>!!window.scanFixture.held['HOLD-OLD']);
      await scan(page,'CASE-NEW');await page.waitForFunction(()=>window.scanFixture.opens.length===1);
      await page.evaluate(()=>window.scanFixture.settle('HOLD-OLD'));
      assert.deepEqual(await opens(page),[{entityId:'company-b',itemId:itemA}]);
      const gets=await page.evaluate(()=>window.scanFixture.gets);
      assert.equal(gets.find(value=>value.params.code==='HOLD-COMPANY').aborted,true);
      assert.equal(gets.find(value=>value.params.code==='HOLD-OLD').aborted,true);
    }finally{await page.close();}
  });

  await t.test('a token change rejects delayed matches and stale product choices',async()=>{
    const page=await createPage();try{
      await scan(page,'HOLD-TOKEN');await page.waitForFunction(()=>!!window.scanFixture.held['HOLD-TOKEN']);
      await page.evaluate(()=>{localStorage.setItem('access_token','synthetic-token-b');window.scanFixture.settle('HOLD-TOKEN');});
      await page.waitForFunction(()=>document.querySelector('.repair-case-scan').getAttribute('aria-busy')==='false');
      assert.deepEqual(await opens(page),[]);
      await scan(page,'CASE-MULTI');await page.getByRole('button',{name:/BONSON 測試風扇/}).waitFor();
      await page.evaluate(()=>localStorage.setItem('access_token','synthetic-token-c'));
      await page.getByRole('button',{name:/BONSON 測試風扇/}).click();
      await page.getByRole('alert').getByText('登入狀態已變更，請重新掃描',{exact:true}).waitFor();
      assert.deepEqual(await opens(page),[]);assert.equal(await page.locator('.repair-case-scan-option').count(),0);
    }finally{await page.close();}
  });

  await t.test('focus returns when the case closes, disabled state blocks scanning, and form typing is untouched',async()=>{
    const page=await createPage();try{
      await scanner(page).focus();await scan(page,itemA);await page.waitForFunction(()=>window.scanFixture.opens.length===1);
      assert.equal(await scanner(page).isDisabled(),true);
      await page.evaluate(()=>window.scanFixture.setActive(true));await scanner(page).waitFor({state:'visible'});
      await page.waitForFunction(()=>document.activeElement===document.querySelector('.repair-case-scan input'));
      const form=page.getByRole('textbox',{name:'案件表單',exact:true});await form.fill('CASE-FORM');await form.press('Enter');
      assert.equal((await opens(page)).length,1);assert.equal(await page.evaluate(()=>window.scanFixture.gets.length),0);
      await page.evaluate(()=>window.scanFixture.setDisabled(true));await page.waitForFunction(()=>document.querySelector('.repair-case-scan input').disabled);
      await page.evaluate(()=>window.scanFixture.setDisabled(false));await page.waitForFunction(()=>!document.querySelector('.repair-case-scan input').disabled);
      assert.equal(await form.evaluate(node=>document.activeElement===node),true);
      await scanner(page).fill('CASE-NOT-SUBMITTED');assert.equal((await opens(page)).length,1);
    }finally{await page.close();}
  });

  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
});
