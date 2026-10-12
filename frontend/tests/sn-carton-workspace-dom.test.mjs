import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url), { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const root = fileURLToPath(new URL('../', import.meta.url));
const product = { id: 'synthetic-product', name: '合成無國條商品', sku: 'ERP-SYNTHETIC', barcode: null, modelNumber: 'M1', type: 'FINISHED_GOOD', attributes: { snLabels: { modelCode: 'NSI', style: '', color: '', styleCode: '', colorCode: '' } } };

test('actual workspace accepts exact existing serials / no-EAN cartons and requires reviewed mapping for manifest export', { timeout: 120000 }, async () => {
  let draft, batch; const requests = [], external = [], errors = [];
  const server = await createServer({ root, configFile: false, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') }, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
    name: 'synthetic-carton-workspace',
    resolveId(id) { if (id === '/carton-fixture.tsx') return '\0carton-fixture.tsx'; },
    load(id) { if (id !== '\0carton-fixture.tsx') return null; return `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
      import '/src/index.css'; import 'antd/dist/reset.css'; import SnLabelsPage from '/src/pages/SnLabelsPage';
      import {AuthProvider} from '/src/contexts/AuthContext'; import {authService} from '/src/services/auth.service'; import {webSocketService} from '/src/services/websocket.service';
      localStorage.setItem('entityId','synthetic-company'); authService.getToken=()=> 'synthetic-only'; webSocketService.connect=()=>{};
      authService.getCurrentUser=async()=>({id:'synthetic-user',name:'合成使用者',email:'synthetic@example.invalid',roles:['EMPLOYEE'],permissions:location.search.includes('readonly')?['inventory:read']:['inventory:read','inventory:update']});
      createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(MemoryRouter,null,React.createElement(SnLabelsPage))));
    `; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url?.startsWith('/carton-ui')) { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/carton-ui','<!doctype html><html><body><div id="root"></div><script type="module" src="/carton-fixture.tsx"></script></body></html>')); return; }
      if (!req.url?.startsWith('/api/')) return next();
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {}, path = req.url.split('?')[0]; requests.push({ method: req.method, path, body });
      res.setHeader('Content-Type', 'application/json');
      if (path.startsWith('/api/v1/products')) return res.end(JSON.stringify(path.endsWith('/products') ? [product] : product));
      if (path === '/api/v1/sn-labels' && req.method === 'GET') return res.end('{"rows":[],"total":0}');
      if (path.endsWith('/preview')) {
        const d = body.data, total = Math.ceil(d.quantity / d.capacity), noSerial = d.serialSource !== 'existing';
        const rows = Array.from({length:total},(_,i)=>({id:'CTN-261012-M1-'+String(i+1).padStart(3,'0'),ordinal:i+1,quantity:Math.min(d.capacity,d.quantity-i*d.capacity),serials:noSerial?[]:d.actualSN.slice(i*d.capacity,(i+1)*d.capacity)}));
        return res.end(JSON.stringify({first:noSerial?null:1,last:noSerial?null:d.quantity,noSerial,serialSource:d.serialSource,token:'synthetic-preview',total,rows,checkedAt:'2026-10-12'}));
      }
      if (path.includes('/drafts/') && req.method === 'PUT') { draft = body.data; return res.end(JSON.stringify({id:draft.id,revision:1,data:draft})); }
      if (path.endsWith('/activate')) {
        const noSerial=draft.serialSource!=='existing',boxes=Array.from({length:Math.ceil(draft.quantity/draft.capacity)},(_,i)=>({id:'CTN-261012-M1-'+String(i+1).padStart(3,'0'),ordinal:i+1,quantity:Math.min(draft.capacity,draft.quantity-i*draft.capacity),serials:noSerial?[]:draft.actualSN.slice(i*draft.capacity,(i+1)*draft.capacity)}));
        batch={id:'synthetic-batch',data:draft,first:noSerial?null:1,last:noSerial?null:draft.quantity,cartons:boxes.length,boxes,events:[]}; return res.end('{"batchId":"synthetic-batch"}');
      }
      if (path.endsWith('/manifest')) return res.end(JSON.stringify({format:'corely-cartons-v1',sourceSystem:'corely-erp',sourceReference:batch.id,cartons:batch.boxes.map(b=>({cartonId:b.id,lines:[{itemCode:body.mapping.itemCode,productName:product.name,ean:null,internalScanCode:body.mapping.internalScanCode,quantity:b.quantity,actualSN:b.serials}]}))}));
      if (path.includes('/batches/')) return res.end(JSON.stringify(batch));
      res.statusCode=404;res.end('{}');
    }); },
  }] });
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => { if (route.request().url().startsWith(origin) || route.request().url().startsWith('blob:'+origin)) return route.continue(); external.push(route.request().url()); return route.abort(); });
    await page.goto(origin+'/carton-ui');
    try { await page.getByRole('combobox',{name:'產品',exact:true}).click(); } catch (error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText(),requests:requests.map(r=>r.path)})); throw error; }
    await page.getByText('合成無國條商品 ·  · ERP-SYNTHETIC · M1',{exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'WMS／ECOUNT 品號',exact:true}).inputValue(),'ERP-SYNTHETIC');
    assert.equal(await page.getByRole('textbox',{name:'內部掃描碼',exact:true}).inputValue(),'ITM-ERP-SYNTHETIC');
    await page.getByRole('textbox',{name:'批次名稱',exact:true}).fill('合成既有 SN');
    await page.getByText('生產配號／無 SN',{exact:true}).click();await page.getByText('既有 SN',{exact:true}).click();
    await page.getByRole('textbox',{name:'既有 SN 清單',exact:true}).fill('00001\nVendor-a02\nVendor-A02');
    for (const name of ['下單日期','製造日期']) { await page.getByRole('textbox',{name,exact:true}).fill('2026-10-12');await page.getByRole('textbox',{name,exact:true}).press('Enter'); }
    await page.getByRole('spinbutton',{name:'每箱容量',exact:true}).fill('2');
    try { await page.getByRole('button',{name:'建立箱號',exact:true}).click(); } catch (error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText(),buttons:await page.locator('button').evaluateAll(nodes=>nodes.map(node=>({text:node.innerText,aria:node.getAttribute('aria-label'),disabled:node.disabled}))),requests:requests.map(r=>r.path)})); throw error; }
    await page.getByRole('button',{name:'確認建立箱號',exact:true}).click();
    await page.getByRole('button',{name:'匯出 WMS 箱號',exact:true}).waitFor();
    assert.deepEqual(draft.actualSN,['00001','Vendor-a02','Vendor-A02']);assert.equal(draft.quantity,3);assert.equal(draft.barcode,'');
    assert.deepEqual(batch.boxes.map(b=>b.quantity),[2,1]);
    await page.getByRole('button',{name:'匯出 WMS 箱號',exact:true}).click();const dialog=page.getByRole('dialog').filter({hasText:'匯出 WMS 箱號'});
    await dialog.getByRole('textbox',{name:'WMS／ECOUNT 品號',exact:true}).fill('ECOUNT-SYNTHETIC');
    await dialog.getByRole('button',{name:'下載清單',exact:true}).click();await dialog.getByText('請先核對品號與掃描碼',{exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.path.endsWith('/manifest')).length,0);
    await dialog.getByRole('checkbox',{name:'品號與掃描碼已核對',exact:true}).check();
    try { await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'下載清單',exact:true}).click()]); } catch (error) { console.error(JSON.stringify({errors,external,body:await page.locator('body').innerText(),buttons:await page.locator('button').evaluateAll(nodes=>nodes.map(node=>({text:node.innerText,aria:node.getAttribute('aria-label'),disabled:node.disabled}))),manifestRequests:requests.filter(r=>r.path.endsWith('/manifest'))})); throw error; }
    const manifestRequest=requests.find(r=>r.path.endsWith('/manifest'));assert.deepEqual(manifestRequest.body.mapping,{itemCode:'ECOUNT-SYNTHETIC',internalScanCode:'ITM-ERP-SYNTHETIC',confirmed:true});
    const noSN=await browser.newPage();noSN.setDefaultTimeout(8000);noSN.on('pageerror',e=>errors.push(e.message));
    await noSN.route('**/*',route=>{if(route.request().url().startsWith(origin)||route.request().url().startsWith('blob:'+origin))return route.continue();external.push(route.request().url());return route.abort();});
    await noSN.goto(origin+'/carton-ui');await noSN.getByRole('combobox',{name:'產品',exact:true}).click();await noSN.getByText('合成無國條商品 ·  · ERP-SYNTHETIC · M1',{exact:true}).click();
    await noSN.getByRole('textbox',{name:'批次名稱',exact:true}).fill('合成無 SN');
    await noSN.getByRole('textbox',{name:'下單日期',exact:true}).fill('2026-10-12');await noSN.getByRole('textbox',{name:'下單日期',exact:true}).press('Enter');
    await noSN.getByRole('spinbutton',{name:'SN 數量',exact:true}).fill('10');await noSN.getByRole('spinbutton',{name:'每箱容量',exact:true}).fill('4');
    await noSN.getByRole('button',{name:'建立箱號',exact:true}).click();await noSN.getByRole('button',{name:'確認建立箱號',exact:true}).click();
    await noSN.getByRole('button',{name:'匯出 WMS 箱號',exact:true}).waitFor();assert.deepEqual(batch.boxes.map(box=>[box.quantity,box.serials]),[[4,[]],[4,[]],[2,[]]]);assert.equal(draft.manufactureDate,'');assert.equal(draft.barcode,'');
    const readonly=await browser.newPage();await readonly.goto(origin+'/carton-ui?readonly');await readonly.getByRole('button',{name:'儲存草稿',exact:true}).waitFor();assert.equal(await readonly.getByRole('button',{name:'儲存草稿',exact:true}).isDisabled(),true);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  } finally { await browser.close();await server.close(); }
});
