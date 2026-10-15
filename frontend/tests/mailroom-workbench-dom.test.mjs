import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const require = createRequire(import.meta.url);
const { chromium } = require("../../backend/node_modules/playwright");
const executablePath = [
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find(existsSync);
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import MailroomPage from '/src/pages/mailroom/MailroomPage.tsx';
window.__APP_CONFIG__={mailroomEnabled:true};
const initial=new URL(location.href).searchParams.get('item');
const router=createMemoryRouter([{path:'/operations/mailroom',element:React.createElement(MailroomPage)},{path:'/other',element:React.createElement('h2',null,'其他工作台')}],{initialEntries:['/operations/mailroom?entityId=company'+(initial?'&itemId='+initial:'')]});
window.mailroomRouter=router;
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const mockApi = `
export const API_URL='/offline-api';
const clone=v=>JSON.parse(JSON.stringify(v));
const receipt={number:'RECEIPT-1',category:'REPAIR',sourceCaseId:'source',sourceNumber:'DEV-R-1',trackingNumber:'IN-KEEP',carrier:'入件物流',senderLabel:'測試寄件人',receivedAt:'2026-10-08T01:00:00Z'};
const common={id:'repair',label:'ITEM-1',productName:'合成測試品',sku:'SKU-1',serialNumber:'SN-1',status:'RECEIVED',statusLabel:'已收件，待核對',version:7,matchResult:'PENDING',grade:null,disposition:null,conditionNote:null,location:'收發櫃A',custodianId:'clerk',custodianName:'收發人員',nextUserId:null,nextUserName:null,recipientId:null,repairOwnerId:null,mine:false,evidenceCount:0,evidence:[],physicalCustody:'MAILROOM',declared:{name:'來源測試品',sku:'SKU-1',serialNumber:'SN-1'},receipt,history:[],deliverySummary:[]};
const state={items:{repair:common,ready:{...clone(common),id:'ready',label:'ITEM-READY',status:'READY_FOR_DISPATCH',statusLabel:'待安排寄回'},letter:{...clone(common),id:'letter',label:'ITEM-LETTER',status:'WAITING_PICKUP',statusLabel:'待同仁簽領',nextUserId:'colleague',nextUserName:'收件同仁',recipientId:'colleague',recipientName:'收件同仁',receipt:{...receipt,category:'LETTER',sourceCaseId:null,sourceNumber:null}},returned:{...clone(common),id:'returned',label:'ITEM-RETURNED',status:'WAITING_RETURN_ACCEPTANCE',statusLabel:'待收發室簽收',nextUserId:'clerk',nextUserName:'收發人員',custodianId:'tech',custodianName:'技师本人',repairOwnerId:'tech',physicalCustody:'TECHNICIAN'}},calls:[],posts:[],failNext:false,commitThenLose:false,holdNext:false,rejectNext:false};
window.mailroomFixture=state;
const initialTemplate={id:'GENERIC_FUNCTIONAL_V1',revision:1,contentHash:'a'.repeat(64),checks:[{key:'power',label:'開機',required:true}]};
const precheckRead=()=>({itemId:'repair',itemVersion:state.items.repair.version,label:'ITEM-1',category:'REPAIR',stage:state.precheck?.status||'NOT_STARTED',document:state.precheck||null,template:{state:'CONFIGURED',template:initialTemplate,reason:null},selectedTemplate:initialTemplate,availableTemplates:[],capabilities:{canStart:!state.precheck,canSave:!!state.precheck,canMarkReady:!!state.precheck,canHandoff:false,reason:null},custody:{custodianId:'clerk',location:'收發櫃A',storageLocationId:null}});
const people=[{id:'clerk',name:'收發人員',employeeNo:'M1',department:'行政部',mailroom:true,repair:false},{id:'tech',name:'維修人員',employeeNo:'R1',department:'維修部',mailroom:false,repair:true},{id:'colleague',name:'收件同仁',employeeNo:'C1',department:'客服部',mailroom:false,repair:false}];
export default {
 async get(path,config={}) {state.calls.push({path,params:clone(config.params||{})});
  if(path==='/mailroom/prechecks/items/repair')return {data:clone(precheckRead())};
  if(path==='/mailroom/people')return {data:clone(people)};
  if(path==='/mailroom/items')return {data:{items:Object.values(state.items).filter(x=>!config.params?.status||x.status===config.params.status).map(clone),total:config.params?.status?Object.values(state.items).filter(x=>x.status===config.params.status).length:4}};
  if(path.startsWith('/mailroom/items/'))return {data:clone(state.items[path.split('/')[3]])};
  if(path==='/mailroom/source-cases')return {data:{items:[{id:'source',number:'DEV-R-1',type:'REPAIR',status:'OPEN',customerLabel:'合成顧客',version:'2026-10-08T01:00:00Z',items:[{id:'source-line',name:'合成來源產品',sku:'SOURCE-SKU',serialNumber:'SOURCE-SN',quantity:1}],expectedQuantity:1,receivedQuantity:0}],nextCursor:null}};
  if(path==='/mailroom/storage')return {data:{racks:[],locations:[],unassigned:[],counts:{stored:0,unassigned:0},canManage:true}};
  if(path==='/mailroom/product-options')return {data:{items:[]}};
  if(path==='/mailroom/tasks')return {data:[]};
  throw Error('Unexpected mock GET '+path);
 },
 async post(path,body){state.posts.push({path,body:clone(body)});
  if(state.holdNext){state.holdNext=false;await new Promise(resolve=>state.releasePost=resolve);}
  if(state.rejectNext){state.rejectNext=false;throw {response:{status:400,data:{message:'合成伺服器拒絕寄出'}}};}
  if(state.failNext){state.failNext=false;throw {response:{data:{message:'合成回應未知，請重試'}}};}
  if(path==='/mailroom/prechecks/receipts'){const item={...clone(common),id:'created',status:'WAITING_PICKUP',statusLabel:'待同仁簽領',recipientId:body.recipientId,recipientName:'收件同仁',nextUserId:body.recipientId,nextUserName:'收件同仁',productName:body.items[0].productName,receipt:{...receipt,...body,sourceCaseId:null,sourceNumber:null}};state.items.created=item;return {data:{itemIds:['created']}};}
  if(path==='/mailroom/prechecks/start'){state.precheck={revision:1,status:'DRAFT',identityHash:'identity',templateBinding:initialTemplate,checks:[],evidence:[],notRequiredReason:null,savedById:'clerk',savedByName:'收發人員',savedAt:'2026-10-16T00:00:00Z'};return {data:{items:[precheckRead()]}};}
  if(path==='/mailroom/prechecks/items/repair/save'){state.precheck={...state.precheck,...body,revision:state.precheck.revision+1,savedAt:'2026-10-16T01:00:00Z'};return {data:precheckRead()};}
  const item=state.items[path.split('/')[3]];
  if(body.action==='dispatch'){item.outboundShipment={schema:1,status:'HANDED_TO_CARRIER',entityId:body.entityId,itemId:item.id,sourceCaseId:'source',requestId:body.requestId,fromVersion:body.expectedVersion,version:body.expectedVersion+1,carrier:body.carrier,trackingNumber:body.trackingNumber,dispatchedAt:'2026-10-08T02:00:00Z',dispatchedById:'clerk',dispatchedByName:'收發人員',dispatchedByEmployeeId:'emp-clerk',note:null,physicalItem:{kind:'ORIGINAL',productName:item.productName,sku:item.sku,serialNumber:item.serialNumber,quantity:1},sourceSync:{status:'PENDING_COMPATIBILITY',reason:'DISPATCH_CONSUMER_NOT_CONFIGURED'}};item.status='DISPATCHED';item.statusLabel='已交物流，待顧客收件';item.physicalCustody='CUSTOMER_CARRIER';item.version++;if(state.commitThenLose){state.commitThenLose=false;throw Error('Synthetic lost response after commit');}}
  if(body.action==='accept_return'){item.custodianId='clerk';item.custodianName='收發人員';item.physicalCustody='MAILROOM';item.location=body.location;item.status='READY_FOR_DISPATCH';item.statusLabel='待安排寄回';item.nextUserId=null;item.nextUserName=null;item.version++;}
  if(body.action==='inspect'){item.status=body.matchResult==='MISMATCH'?'MISMATCH':'WAITING_REPAIR_ACCEPTANCE';item.statusLabel=item.status==='MISMATCH'?'品項不符，待客服確認':'待維修簽收';item.evidence=body.evidence||[];item.evidenceCount=item.evidence.length;item.version++;}
  return {data:{id:item.id,duplicate:false}};
 }
};
`;

test(
  "real receiving workbench keeps correspondence, photo inspection, physical return and dispatch receipts distinct",
  { skip: !executablePath && "No preinstalled browser", timeout: 150000 },
  async (t) => {
    const virtual = "\0mailroom-workbench-fixture";
    const cacheDir = mkdtempSync(join(tmpdir(), "corely-mailroom-fixture-"));
    t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
    const server = await createServer({
      root,
      cacheDir,
      configFile: false,
      server: { host: "127.0.0.1", port: 0, hmr: false },
      plugins: [
        react(),
        {
          name: "offline-mailroom-workbench",
          resolveId(id) {
            if (id === "virtual:mailroom-workbench-fixture") return virtual;
          },
          load(id) {
            if (id === virtual) return fixture;
            if (id.endsWith("/src/contexts/AuthContext.tsx"))
              return `const user={id:'clerk',roles:[],permissions:['mailroom:read','mailroom:update','mailroom:create']};export const useAuth=()=>({user});`;
            if (id.endsWith("/src/services/api.ts")) return mockApi;
            if (id.endsWith("/src/services/websocket.service.ts"))
              return `export const webSocketService={subscribe:()=>()=>{}};`;
          },
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (!req.url?.startsWith("/__mailroom-workbench")) return next();
              try {
                const html = await vite.transformIndexHtml(
                  "/__mailroom-workbench",
                  '<html><body><div id="root"></div><script type="module" src="/@id/virtual:mailroom-workbench-fixture"></script></body></html>',
                );
                res.setHeader("Content-Type", "text/html");
                res.end(html);
              } catch (e) {
                next(e);
              }
            });
          },
        },
      ],
    });
    await server.listen();
    const browser = await chromium.launch({ executablePath, headless: true });
    t.after(async () => { await browser.close(); await server.close(); });
    const page = await browser.newPage({
      viewport: { width: 1123, height: 972 },
    });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Warning:"))
        errors.push(message.text());
    });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    let drawerTitle = "登記收件";
    const go = async (item = "") => {
      drawerTitle = item ? "物件進度與交接" : "登記收件";
      await page.goto(
        "http://127.0.0.1:" +
          server.httpServer.address().port +
          "/__mailroom-workbench" +
          (item ? "?item=" + item : ""),
      );
      await page.waitForFunction(
        () =>
          document.querySelector("h2") ||
          document.querySelector("vite-error-overlay"),
      );
      assert.deepEqual(errors, [], await page.locator("body").innerText());
      await page
        .getByRole("heading", { name: "收發室工作台", exact: true })
        .waitFor();
    };
    const drawer = () =>
      page
        .locator(".ant-drawer-content")
        .filter({ has: page.getByText(drawerTitle, { exact: true }) });
    const dropdown = () =>
      page.locator(".ant-select-dropdown:visible:not(.ant-slide-up-leave)");
    const choose = async (control, text) => {
      await control.press("ArrowDown");
      await dropdown().getByText(text, { exact: true }).click();
      await page
        .locator(".ant-select-dropdown:visible")
        .waitFor({ state: "hidden" });
    };
    const discard = async (keep = true) => {
      const modal = page.getByRole("dialog").filter({ hasText: "目前收發工作有未保存的修改" });
      await modal.getByRole("button", { name: keep ? "繼續編輯" : "放棄草稿", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
    };
    const closeDrawer = () => drawer().getByRole("button", { name: "Close", exact: true }).click();
    const changeRoute = () => page.evaluate(() => { void window.mailroomRouter.navigate('/other'); });
    const pending = () => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('corely.mailroom.dispatch.v1:')).map(key => JSON.parse(sessionStorage.getItem(key))));

    await go();
    // Opening defaults is clean; department search without selecting a person remains clean.
    await page.getByRole("button", { name: "登記收件", exact: true }).click();
    await closeDrawer();
    assert.equal(await page.getByRole("dialog").filter({ hasText: "目前收發工作有未保存的修改" }).count(), 0);
    await page.waitForFunction(() => !document.querySelector(".ant-drawer-open"));
    await page.getByRole("button", { name: "登記收件" }).click();
    await drawer().locator(".mailroom-category-options label").filter({ hasText: "維修品" }).click();
    await choose(drawer().getByRole("combobox", { name: "搜尋售後案件", exact: true }), "DEV-R-1");
    await closeDrawer(); await discard();
    assert.equal(await drawer().locator('#items_0_productName').inputValue(), "");
    assert.equal(await drawer().locator('#items_0_sku').inputValue(), "");
    await changeRoute(); await discard();
    assert.equal(await drawer().locator('#items_0_serialNumber').inputValue(), "");
    await closeDrawer(); await discard(false);
    await page.getByRole("button", { name: "登記收件", exact: true }).click();
    await drawer().locator(".mailroom-category-options label").filter({ hasText: "公司信件" }).click();
    await choose(drawer().getByRole("combobox", { name: "收件同仁部門", exact: true }), "客服部");
    await closeDrawer(); await discard(false);
    await page
      .getByRole("button", { name: "待收發室點收", exact: true })
      .click();
    await page.waitForFunction(() =>
      window.mailroomFixture.calls.some(
        (x) => x.params.status === "WAITING_RETURN_ACCEPTANCE",
      ),
    );
    await page
      .getByRole("button", { name: "登記收件", exact: true })
      .click();
    await drawer().locator(".mailroom-category-options label").filter({ hasText: "公司信件" }).click();
    await drawer()
      .getByText("對方公司名稱／寄件人姓名", { exact: true })
      .waitFor();
    assert.equal(await drawer().getByText("SKU", { exact: true }).count(), 0);
    assert.equal(await drawer().getByText("SN", { exact: true }).count(), 0);
    await choose(
      drawer().getByRole("combobox", { name: "收件同仁部門", exact: true }),
      "客服部",
    );
    await choose(
      drawer().getByRole("combobox", { name: "收件同仁", exact: true }),
      "客服部 · 收件同仁 · C1",
    );

    await drawer().locator('input[id="senderLabel"]').fill("測試公司");
    await drawer().getByRole("checkbox", { name: "使用臨時存放位置", exact: true }).check();
    await drawer().locator('input[id="location"]').fill("信件櫃");
    await drawer().locator('input[id="items_0_productName"]').fill("合成信件");
    await closeDrawer(); await discard();
    assert.equal(await drawer().locator('#items_0_productName').inputValue(), "合成信件");
    assert.equal(await drawer().locator('#senderLabel').inputValue(), "測試公司");
    assert.equal(await drawer().locator(".mailroom-recipient-person").innerText(), "客服部 · 收件同仁 · C1");
    await drawer().getByRole("button", { name: "下一步", exact: true }).click();
    await drawer().getByRole("button", { name: "下一步", exact: true }).click();
    await page.evaluate(() => { window.mailroomFixture.holdNext = true; });
    await drawer()
      .getByRole("button", { name: "確認並登記收件", exact: true })
      .click();
    await page.waitForFunction(() => window.mailroomFixture.posts.length === 1);
    assert.equal(await drawer().locator(".mailroom-recipient-person input").isDisabled(), true);
    assert.equal(await drawer().locator(".mailroom-recipient-department input").isDisabled(), true);
    await closeDrawer();
    await changeRoute();
    await page.getByText("正在保存或讀取照片，請稍候。", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("dialog").filter({ hasText: "目前收發工作有未保存的修改" }).count(), 0);
    assert.equal(await drawer().locator('#items_0_productName').inputValue(), "合成信件");
    await page.evaluate(() => window.mailroomFixture.releasePost());
    await page.waitForFunction(() => window.mailroomFixture.items.created);
    const letterPost = await page.evaluate(() => window.mailroomFixture.posts[0]);
    assert.equal(letterPost.path, "/mailroom/prechecks/receipts");
    const letter = letterPost.body;
    assert.deepEqual(Object.keys(letter).sort(), ["category", "entityId", "items", "location", "recipientId", "requestId", "senderLabel"]);
    assert.equal(letter.recipientId, "colleague");
    assert.equal(letter.senderLabel, "測試公司");
    assert.equal("sku" in letter.items[0], false);
    assert.equal("serialNumber" in letter.items[0], false);
    assert.equal("department" in letter, false);
    await changeRoute(); await page.getByRole("heading", { name: "其他工作台", exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").filter({ hasText: "目前收發工作有未保存的修改" }).count(), 0);
    console.log('offline workbench: initial precheck');
    await go("repair");
    assert.equal(await drawer().getByRole('button',{name:'核對實收品項',exact:true}).count(),0);
    await drawer().getByRole('button',{name:'更新存放位置',exact:true}).waitFor();
    await closeDrawer();await drawer().waitFor({state:'hidden'});
    await page.getByRole('button',{name:'編輯初檢 ITEM-1',exact:true}).click();
    const precheck=page.locator('.ant-drawer-content').filter({has:page.getByText('收發初檢',{exact:true})});
    await precheck.getByRole('button',{name:'建立初檢草稿',exact:true}).click();
    await precheck.getByRole('combobox',{name:'開機結果',exact:true}).waitFor();
    await choose(precheck.getByRole('combobox',{name:'開機結果',exact:true}),'正常');
    await precheck.getByRole('textbox',{name:'開機說明',exact:true}).fill('可開機，已確認實物');
    console.log('offline workbench: dirty initial-precheck close guard');
    await precheck.getByRole('button',{name:/關\s*閉/}).click();await discard();
    assert.equal(await precheck.getByRole('textbox',{name:'開機說明',exact:true}).inputValue(),'可開機，已確認實物');
    await page.evaluate(()=>{void window.mailroomRouter.navigate('/operations/mailroom?entityId=company&itemId=ready');});await discard();
    await changeRoute();await discard();
    console.log('offline workbench: save initial-precheck draft');
    await precheck.getByRole('button',{name:'儲存草稿',exact:true}).click();
    await page.waitForFunction(()=>window.mailroomFixture.precheck?.revision===2);
    const inspection=await page.evaluate(()=>window.mailroomFixture.posts.find(post=>post.path.endsWith('/save')).body);
    assert.equal(inspection.expectedVersion,7);assert.equal(inspection.expectedRevision,1);assert.equal(inspection.status,'DRAFT');
    assert.equal(inspection.checks[0].result,'NORMAL');assert.equal(inspection.checks[0].note,'可開機，已確認實物');
    for(const key of ['nextUserId','custodianId','location','action'])assert.equal(key in inspection,false);
    await precheck.getByText(/收發人員 · v2 ·/).waitFor();
    await precheck.getByRole('button',{name:/關\s*閉/}).click();await precheck.waitFor({state:'hidden'});
    const native=await page.evaluate(()=>window.mailroomFixture.items.repair);assert.equal(native.status,'RECEIVED');assert.equal(native.version,7);assert.equal(native.custodianId,'clerk');
    console.log('offline workbench: physical return acceptance');
    await go("returned");
    await drawer().getByText("技师本人", { exact: true }).waitFor();
    assert.equal(
      await drawer()
        .getByRole("button", { name: "登記實際寄出", exact: true })
        .count(),
      0,
    );
    await drawer()
      .getByRole("button", { name: "收發室簽收處理完成品", exact: true })
      .first()
      .click();
    await drawer()
      .getByRole("checkbox", {
        name: "我已逐件確認物件，並由本人接收保管",
        exact: true,
      })
      .check();
    await drawer()
      .getByRole("button", { name: /確認儲存$/ })
      .click();
    await page.waitForFunction(
      () =>
        window.mailroomFixture.items.returned.status === "READY_FOR_DISPATCH",
    );
    assert.equal(
      await page.evaluate(() => window.mailroomFixture.posts[0].body.action),
      "accept_return",
    );
    await drawer()
      .getByRole("button", { name: "登記實際寄出", exact: true })
      .first()
      .waitFor();
    console.log('offline workbench: outbound dispatch');
    await go("ready");
    await page.evaluate(() => { void window.mailroomRouter.navigate('/operations/mailroom?entityId=company&itemId=ready&probe=1'); });
    await drawer()
      .getByRole("button", { name: "登記實際寄出", exact: true })
      .first()
      .click();
    await drawer().locator('input[id="carrier"]').fill("寄出物流");
    await drawer().locator('input[id="trackingNumber"]').fill("OUT-NEW");
    await drawer()
      .getByRole("button", { name: /確認儲存$/ })
      .click();
    await drawer()
      .getByText("請逐件核對並確認實物已交給物流", { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.mailroomFixture.posts.length),
      0,
    );
    await drawer()
      .getByRole("checkbox", {
        name: "我已核對實際寄出的產品與 SN，並將實物交給物流",
        exact: true,
      })
      .check();
    await closeDrawer(); await discard();
    await page.evaluate(() => { void window.mailroomRouter.navigate(-1); }); await discard();
    await changeRoute(); await discard();
    assert.equal(await drawer().locator('#trackingNumber').inputValue(), "OUT-NEW");
    await page.evaluate(() => (window.mailroomFixture.failNext = true));
    await drawer()
      .getByRole("button", { name: /確認儲存$/ })
      .click();
    await drawer().getByText("合成回應未知，請重試", { exact: true }).waitFor();
    const originalUnknown = await page.evaluate(() => window.mailroomFixture.posts[0].body);
    assert.equal((await pending())[0].command.requestId, originalUnknown.requestId);
    await closeDrawer(); await discard();
    await drawer().getByRole("button", { name: "更新存放位置", exact: true }).click(); await discard();
    await page.evaluate(() => { void window.mailroomRouter.navigate('/operations/mailroom?entityId=company&itemId=repair'); }); await discard();
    await changeRoute(); await discard();
    assert.equal(await drawer().locator('#trackingNumber').inputValue(), "OUT-NEW");
    assert.equal(await drawer().locator('#trackingNumber').isDisabled(), true);
    await changeRoute(); await discard(false);
    await page.getByRole("heading", { name: "其他工作台", exact: true }).waitFor();
    await page.evaluate(() => { void window.mailroomRouter.navigate('/operations/mailroom?entityId=company&itemId=ready'); });
    await drawer().getByText("已保留原寄出請求；只可核對回執或以原請求重試", { exact: true }).waitFor();
    assert.equal(await drawer().locator('#trackingNumber').inputValue(), "OUT-NEW");
    // A real reload drops all React refs and resets the fixture backend, but keeps session pending.
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await drawer().getByText("已保留原寄出請求；只可核對回執或以原請求重試", { exact: true }).waitFor();
    assert.equal((await pending())[0].command.requestId, originalUnknown.requestId);
    await page.evaluate(() => (window.mailroomFixture.commitThenLose = true));
    await drawer()
      .getByRole("button", { name: /確認儲存$/ })
      .click();
    await drawer().getByText("寄出紀錄", { exact: true }).waitFor();
    const posts = await page.evaluate(() => window.mailroomFixture.posts);
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body, originalUnknown);
    assert.equal(posts[0].body.expectedVersion, 7);
    assert.equal(posts[0].body.carrier, "寄出物流");
    assert.equal("productName" in posts[0].body, false);
    assert.equal("location" in posts[0].body, false);
    assert.deepEqual(await pending(), []);
    await drawer().getByText("入件物流 · IN-KEEP", { exact: true }).waitFor();
    await drawer()
      .getByText("寄出物流 · OUT-NEW", { exact: true })
      .first()
      .waitFor();
    await drawer()
      .getByText("承運商持有（寄回顧客途中）", { exact: true })
      .waitFor();
    await drawer()
      .locator(".mailroom-dispatch-record").getByText("待核對歷史寄出", { exact: true })
      .waitFor();
    assert.equal(
      await drawer()
        .getByRole("button", { name: "登記實際寄出", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await drawer()
        .getByRole("button", { name: "更新存放位置", exact: true })
        .count(),
      0,
    );
    await page.screenshot({
      path: "/tmp/corely-mailroom-ui-cleanup-20261008-dispatch.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await drawer().getByText("寄出紀錄", { exact: true }).waitFor();
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll(
          ".ant-drawer-open .ant-drawer-content-wrapper",
        ),
      ].every(
        (element) =>
          element.getBoundingClientRect().left >= -1 &&
          element.getBoundingClientRect().right <= innerWidth + 1,
      ),
    );
    const bounds = await drawer().evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    assert(bounds.left >= -1 && bounds.right <= 391, JSON.stringify(bounds));
    assert(bounds.scroll <= bounds.client + 1, JSON.stringify(bounds));
    await page.screenshot({
      path: "/tmp/corely-mailroom-ui-cleanup-20261008-mobile.png",
      fullPage: true,
    });
    await closeDrawer();
    await page.waitForFunction(() => !document.querySelector(".ant-drawer-open"));
    assert.equal(await page.getByRole("dialog").filter({ hasText: "目前收發工作有未保存的修改" }).count(), 0);

    // Stale pending requests survive leaving, and never turn into a new key or automatic send.
    console.log('offline workbench: outbound dispatch');
    await go("ready");
    await page.evaluate(command => {
      sessionStorage.setItem('corely.mailroom.dispatch.v1:company:clerk:ready', JSON.stringify({ schema: 1, entityId: 'company', userId: 'clerk', itemId: 'ready', command }));
      window.mailroomFixture.items.ready.version = 8;
      void window.mailroomRouter.navigate('/other');
    }, originalUnknown);
    await page.getByRole("heading", { name: "其他工作台", exact: true }).waitFor();
    await page.evaluate(() => { void window.mailroomRouter.navigate('/operations/mailroom?entityId=company&itemId=ready'); });
    await drawer().getByText("原寄出請求需人工核對，不能重新送出", { exact: true }).waitFor();
    assert.equal(await drawer().getByRole("button", { name: /確認儲存$/ }).isDisabled(), true);
    assert.equal(await drawer().locator('#trackingNumber').inputValue(), "OUT-NEW");
    assert.equal((await pending())[0].command.requestId, originalUnknown.requestId);
    assert.equal(await page.evaluate(() => window.mailroomFixture.posts.length), 0);
    await drawer().getByRole("button", { name: "核對本次寄出回執", exact: true }).click();
    await drawer().getByText("尚未找到本次寄出回執；版本或保管不符時請人工核對，勿建立新的寄出。", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.mailroomFixture.posts.length), 0);
    assert.equal((await pending())[0].command.requestId, originalUnknown.requestId);
    await changeRoute(); await discard(false);
    await page.getByRole("heading", { name: "其他工作台", exact: true }).waitFor();
    await page.evaluate(() => { void window.mailroomRouter.navigate('/operations/mailroom?entityId=company&itemId=ready'); });
    await drawer().getByText("原寄出請求需人工核對，不能重新送出", { exact: true }).waitFor();
    assert.equal((await pending())[0].command.requestId, originalUnknown.requestId);
    assert.deepEqual(errors, []);
  },
);

test('mismatch exception uses the original inspect command and preserves actual identity, evidence and CSR routing', { skip: !executablePath && 'No existing browser', timeout: 60000 }, async t => {
  const cacheDir=mkdtempSync(join(tmpdir(),'corely-mailroom-mismatch-')),virtual='\0mailroom-mismatch-fixture';
  const mismatchApi=mockApi.replace('window.mailroomFixture=state;', `state.invalidCsr=true;state.notifications=[];state.items.repair.sku='ACTUAL-DIFFERENT-SKU';state.items.repair.serialNumber='ACTUAL-DIFFERENT-SN';window.mailroomFixture=state;`).replace("if(body.action==='inspect'){", `if(body.action==='inspect'){
    if(state.invalidCsr)throw {response:{status:400,data:{message:'無法確認此售後案件目前的承辦客服'}}};
    if(body.matchResult!=='MISMATCH')throw Error('Mismatch-only entry cannot submit MATCH');
    item.receipt.customerServiceUserId='csr';item.nextUserId=null;
    item.history.push({id:'action-mismatch',actorName:'收發人員',action:'inspect',toStatus:'MISMATCH',version:item.version+1,note:body.note,createdAt:'2026-10-16T00:00:00Z'});
    item.deliverySummary=[{target:'AFTER_SALES',status:'PENDING',count:1},{target:'AI_CUSTOMER_SERVICE',status:'PENDING',count:1}];
    state.notifications.push({userId:'csr',category:'mailroom',data:{itemId:item.id,entityId:body.entityId}});`);
  const server=await createServer({root,cacheDir,configFile:false,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[react(),{
    name:'offline-native-mismatch-exception',resolveId(id){if(id==='virtual:mailroom-mismatch-fixture')return virtual;},
    load(id){
      if(id===virtual)return fixture;
      if(id.endsWith('/src/services/api.ts'))return mismatchApi;
      if(id.endsWith('/src/contexts/AuthContext.tsx'))return `const user={id:'clerk',roles:[],permissions:['mailroom:read','mailroom:update','mailroom:create']};export const useAuth=()=>({user});`;
      if(id.endsWith('/src/services/websocket.service.ts'))return 'export const webSocketService={subscribe:()=>()=>{}};';
    },configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/__mismatch-exception'))return next();
      try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__mismatch-exception','<html><body style="margin:0"><div id="root"></div><script type="module" src="/@id/virtual:mailroom-mismatch-fixture"></script></body></html>'));}catch(error){next(error);}
    });},
  }]});
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const browser=await chromium.launch({executablePath,headless:true});t.after(async()=>{await browser.close();await server.close();rmSync(cacheDir,{recursive:true,force:true});});
  const page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(7000);
  const errors=[],external=[],httpWrites=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!==origin){external.push(request.url());return route.abort();}if(request.method()!=='GET'){httpWrites.push(request.url());return route.abort();}return route.continue();});
  await page.goto(origin+'/__mismatch-exception?item=repair');
  const drawer=page.locator('.ant-drawer-content').filter({has:page.getByText('物件進度與交接',{exact:true})});
  await drawer.getByRole('button',{name:'收發初檢',exact:true}).waitFor();
  const entry=drawer.getByRole('button',{name:'回報品項差異',exact:true});assert.doesNotMatch(await entry.getAttribute('class'),/ant-btn-primary|ant-btn-variant-solid/);await entry.click();
  assert.equal(await drawer.locator('#matchResult').isDisabled(),true);assert.equal(await drawer.getByText('一致，通知維修簽收',{exact:true}).count(),0);assert.equal(await drawer.locator('#nextUserId').count(),0);
  assert.equal(await drawer.locator('#sku').inputValue(),'ACTUAL-DIFFERENT-SKU');assert.equal(await drawer.locator('#serialNumber').inputValue(),'ACTUAL-DIFFERENT-SN');
  const save=drawer.getByRole('button',{name:/確認儲存$/});await save.click();await drawer.getByText('請填寫處理結果',{exact:true}).waitFor();
  await drawer.locator('#note').fill('實收 SKU 與 SN 和來源申報不同');await save.click();await drawer.getByText('請附上至少一張實物照片。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.mailroomFixture.posts.length),0);
  const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  await drawer.locator('.mailroom-action input[type="file"]').setInputFiles({name:'synthetic-mismatch.png',mimeType:'image/png',buffer:png});await drawer.getByAltText('待上傳照片 1',{exact:true}).waitFor();
  await save.click();await drawer.getByText('無法確認此售後案件目前的承辦客服',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.mailroomFixture.items.repair.status),'RECEIVED');
  assert.equal(await drawer.locator('#note').inputValue(),'實收 SKU 與 SN 和來源申報不同');await drawer.getByAltText('待上傳照片 1',{exact:true}).waitFor();
  await page.evaluate(()=>{window.mailroomFixture.invalidCsr=false;});await save.click();await drawer.getByText('品項不符，待客服確認',{exact:true}).waitFor();
  const state=await page.evaluate(()=>({posts:window.mailroomFixture.posts,item:window.mailroomFixture.items.repair,notifications:window.mailroomFixture.notifications}));
  assert.equal(state.posts.length,2);assert.deepEqual(state.posts[0],state.posts[1]);const command=state.posts[1];assert.equal(command.path,'/mailroom/items/repair/actions');
  assert.deepEqual(Object.keys(command.body).sort(),['action','entityId','evidence','expectedVersion','matchResult','note','productName','requestId','serialNumber','sku'].sort());
  assert.equal(command.body.action,'inspect');assert.equal(command.body.matchResult,'MISMATCH');assert.equal(command.body.expectedVersion,7);assert.equal(command.body.sku,'ACTUAL-DIFFERENT-SKU');assert.equal(command.body.serialNumber,'ACTUAL-DIFFERENT-SN');assert.equal(command.body.evidence.length,1);
  assert.equal(state.item.status,'MISMATCH');assert.equal(state.item.version,8);assert.equal(state.item.location,'收發櫃A');assert.equal(state.item.custodianId,'clerk');assert.equal(state.item.physicalCustody,'MAILROOM');assert.equal(state.item.nextUserId,null);assert.equal(state.item.receipt.customerServiceUserId,'csr');
  assert.equal(state.item.declared.sku,'SKU-1');assert.equal(state.item.declared.serialNumber,'SN-1');assert.equal(state.item.history.at(-1).action,'inspect');assert.deepEqual(state.item.deliverySummary.map(row=>row.target),['AFTER_SALES','AI_CUSTOMER_SERVICE']);assert.equal(state.notifications.length,1);assert.equal(state.notifications[0].userId,'csr');
  assert.equal(await drawer.getByRole('button',{name:'回報品項差異',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.mailroomFixture.calls.some(call=>call.path.startsWith('/mailroom/prechecks'))),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(httpWrites,[]);t.diagnostic(JSON.stringify({offlineMock:true,posts:state.posts.length,action:command.body.action,matchResult:command.body.matchResult,nativeStatus:state.item.status,errors,external,httpWrites}));
});
