import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const outboundSource = ts.createSourceFile('OutboundWorkbench.tsx', readFileSync(join(root, 'src/pages/mailroom/OutboundWorkbench.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const outboundPicker = outboundSource.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'OutboundLocationPicker');
assert.ok(outboundPicker, 'Test the actual bounded production picker');
const pickerModule = `import {useState,useEffect} from 'react';import {Select,Alert,Spin} from 'antd';import api from '/src/services/api.ts';import {errorText} from '/src/pages/mailroom/model.ts';${outboundPicker.getText(outboundSource)};export default OutboundLocationPicker;`;
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import ReceiptLocationPicker from '/src/pages/mailroom/ReceiptLocationPicker.tsx';
import OutboundLocationPicker from 'virtual:storage-outbound-picker';import api from '/src/services/api.ts';
const racks=[{id:'receiving',code:'A',name:'混合架',zone:'RECEIVING',isActive:true},{id:'outbound',code:'B',name:'待寄預設架',zone:'OUTBOUND',isActive:true},{id:'other',code:'C',name:'另一架',zone:'OUTBOUND',isActive:true},{id:'inactive',name:'停用架',zone:'OUTBOUND',isActive:false}];
const locations=[{id:'mixed',rackId:'receiving',code:'SAME',name:'明確待寄',purpose:'OUTBOUND',isActive:true},{id:'receiving',rackId:'receiving',code:'IN-only',name:'明確收件',purpose:'RECEIVING',isActive:true},{id:'inherited-in',rackId:'receiving',code:'IN-null',name:'繼承收件',purpose:null,isActive:true},{id:'legacy',rackId:'outbound',code:'LEGACY',name:'舊資料待寄',isActive:true},{id:'inherited-out',rackId:'outbound',code:'OUT-null',name:'繼承待寄',purpose:null,isActive:true},{id:'override',rackId:'outbound',code:'OVERRIDE-in',name:'改為收件',purpose:'RECEIVING',isActive:true},{id:'duplicate',rackId:'other',code:'SAME',name:'另一架同碼',isActive:true},{id:'off',rackId:'outbound',code:'OFF',name:'停用位置',isActive:false},{id:'off-rack',rackId:'inactive',code:'OFF-RACK',name:'停用架位置',isActive:true}];
window.pickerTest={calls:[],receiptChanges:[],outboundChanges:[]};
api.get=async(path,config)=>{window.pickerTest.calls.push({path,entityId:config.params.entityId});return {data:config.params.entityId==='empty'?{racks:[],locations:[]}:{racks,locations}}};
api.post=async()=>{throw new Error('No mutations are allowed in picker tests')};
function Harness(){const[entityId,setEntity]=useState('company-a'),[disabled,setDisabled]=useState(false);return <main style={{width:'100%',maxWidth:600}}><button onClick={()=>setDisabled(value=>!value)}>切換停用</button><button onClick={()=>setEntity('empty')}>空白公司</button><ReceiptLocationPicker entityId={entityId} active disabled={disabled} onChange={(id,code)=>window.pickerTest.receiptChanges.push({id,code})}/><OutboundLocationPicker entityId={entityId} disabled={disabled} onChange={code=>window.pickerTest.outboundChanges.push(code)}/></main>};
createRoot(document.getElementById('root')).render(<Harness/>);
`;

test('storage pickers use each location purpose, preserve legacy code contracts, and remain usable at 320px', { timeout: 60000, skip: !executablePath && 'No existing browser' }, async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'corely-storage-pickers-'));
  const fixtureId = '\0storage-pickers-fixture', pickerId = '\0storage-outbound-picker';
  const server = await createServer({ root, cacheDir, configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'offline-storage-pickers',
    resolveId(id) { if (id === 'virtual:storage-pickers-fixture') return fixtureId; if (id === 'virtual:storage-outbound-picker') return pickerId; },
    load(id) { if (id === fixtureId) return {code:fixture,map:null}; if (id === pickerId) return {code:pickerModule,map:null}; },
    transform(code,id) { if (id === fixtureId || id === pickerId) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith('/__pickers')) return next(); try {res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__pickers','<html><body><div id="root"></div><script type="module" src="/@id/virtual:storage-pickers-fixture"></script></body></html>'));} catch(error){next(error);} }); },
  }] });
  t.after(async()=>{await server.close();rmSync(cacheDir,{recursive:true,force:true});});await server.listen();
  const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});page.setDefaultTimeout(8000);
  const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__pickers`);
  const receipt=page.getByRole('combobox',{name:'選擇收件儲位',exact:true}), outbound=page.getByRole('combobox',{name:'選擇寄件儲位',exact:true});await receipt.waitFor();
  await outbound.click();let dropdown=page.locator('.ant-select-dropdown:visible');
  for(const label of ['SAME · 混合架 · 明確待寄','LEGACY · 待寄預設架 · 舊資料待寄','OUT-null · 待寄預設架 · 繼承待寄','SAME · 另一架 · 另一架同碼'])await dropdown.getByText(label,{exact:true}).waitFor();
  for(const code of ['IN-only','IN-null','OVERRIDE-in','OFF','OFF-RACK'])assert.equal(await dropdown.getByText(new RegExp('^'+code+' ·')).count(),0);
  await dropdown.getByText('SAME · 另一架 · 另一架同碼',{exact:true}).tap();assert.deepEqual(await page.evaluate(()=>window.pickerTest.outboundChanges),['SAME']);
  await receipt.press('ArrowDown');dropdown=page.locator('.ant-select-dropdown:visible');await dropdown.getByText('SAME · 明確待寄 · 待寄',{exact:true}).tap();
  assert.deepEqual(await page.evaluate(()=>window.pickerTest.receiptChanges),[{id:'mixed',code:'SAME'}]);
  await receipt.press('ArrowDown');dropdown=page.locator('.ant-select-dropdown:visible');await dropdown.getByText('OVERRIDE-in · 改為收件 · 收件',{exact:true}).waitFor();await receipt.press('Escape');await dropdown.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2),false);
  await page.getByRole('button',{name:'切換停用',exact:true}).tap();assert.equal(await receipt.isDisabled(),true);assert.equal(await outbound.isDisabled(),true);
  await page.getByRole('button',{name:'切換停用',exact:true}).tap();await page.getByRole('button',{name:'空白公司',exact:true}).tap();
  await page.waitForFunction(()=>window.pickerTest.calls.filter(call=>call.entityId==='empty').length===2);
  await outbound.press('ArrowDown');await page.getByText('尚未建立寄件儲位',{exact:true}).waitFor();assert.equal(await page.locator('.ant-select-dropdown').filter({hasText:'尚未建立寄件儲位'}).locator('.ant-select-item-option').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
