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
const router=createMemoryRouter([{path:'/operations/mailroom',element:React.createElement(MailroomPage)}],{initialEntries:['/operations/mailroom?entityId=company'+(initial?'&itemId='+initial:'')]});
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const mockApi = `
export const API_URL='/offline-api';
const clone=v=>JSON.parse(JSON.stringify(v));
const receipt={number:'RECEIPT-1',category:'REPAIR',sourceCaseId:'source',sourceNumber:'DEV-R-1',trackingNumber:'IN-KEEP',carrier:'入件物流',senderLabel:'測試寄件人',receivedAt:'2026-10-08T01:00:00Z'};
const common={id:'repair',label:'ITEM-1',productName:'合成測試品',sku:'SKU-1',serialNumber:'SN-1',status:'RECEIVED',statusLabel:'已收件，待核對',version:7,matchResult:'PENDING',grade:null,disposition:null,conditionNote:null,location:'收發櫃A',custodianId:'clerk',custodianName:'收發人員',nextUserId:null,nextUserName:null,recipientId:null,repairOwnerId:null,mine:false,evidenceCount:0,evidence:[],physicalCustody:'MAILROOM',declared:{name:'來源測試品',sku:'SKU-1',serialNumber:'SN-1'},receipt,history:[],deliverySummary:[]};
const state={items:{repair:common,ready:{...clone(common),id:'ready',status:'READY_FOR_DISPATCH',statusLabel:'待安排寄回'},letter:{...clone(common),id:'letter',status:'WAITING_PICKUP',statusLabel:'待同仁簽領',nextUserId:'colleague',nextUserName:'收件同仁',recipientId:'colleague',recipientName:'收件同仁',receipt:{...receipt,category:'LETTER',sourceCaseId:null,sourceNumber:null}},returned:{...clone(common),id:'returned',status:'WAITING_RETURN_ACCEPTANCE',statusLabel:'待收發室簽收',nextUserId:'clerk',nextUserName:'收發人員',custodianId:'tech',custodianName:'技师本人',repairOwnerId:'tech',physicalCustody:'TECHNICIAN'}},calls:[],posts:[],failNext:false,commitThenLose:false};
window.mailroomFixture=state;
const people=[{id:'clerk',name:'收發人員',employeeNo:'M1',department:'行政部',mailroom:true,repair:false},{id:'tech',name:'維修人員',employeeNo:'R1',department:'維修部',mailroom:false,repair:true},{id:'colleague',name:'收件同仁',employeeNo:'C1',department:'客服部',mailroom:false,repair:false}];
export default {
 async get(path,config={}) {state.calls.push({path,params:clone(config.params||{})});
  if(path==='/mailroom/people')return {data:clone(people)};
  if(path==='/mailroom/items')return {data:{items:Object.values(state.items).filter(x=>!config.params?.status||x.status===config.params.status).map(clone),total:config.params?.status?Object.values(state.items).filter(x=>x.status===config.params.status).length:4}};
  if(path.startsWith('/mailroom/items/'))return {data:clone(state.items[path.split('/')[3]])};
  if(path==='/mailroom/source-cases')return {data:{items:[],nextCursor:null}};
  if(path==='/mailroom/tasks')return {data:[]};
  throw Error('Unexpected mock GET '+path);
 },
 async post(path,body){state.posts.push({path,body:clone(body)});
  if(state.failNext){state.failNext=false;throw {response:{data:{message:'合成回應未知，請重試'}}};}
  if(path==='/mailroom/receipts'){const item={...clone(common),id:'created',status:'WAITING_PICKUP',statusLabel:'待同仁簽領',recipientId:body.recipientId,recipientName:'收件同仁',nextUserId:body.recipientId,nextUserName:'收件同仁',productName:body.items[0].productName,receipt:{...receipt,...body,sourceCaseId:null,sourceNumber:null}};state.items.created=item;return {data:{itemIds:['created']}};}
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
  { skip: !executablePath && "No preinstalled browser", timeout: 90000 },
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
    t.after(() => server.close());
    await server.listen();
    const browser = await chromium.launch({ executablePath, headless: true });
    t.after(() => browser.close());
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
    await go();
    await page
      .getByRole("button", { name: "待收發室點收", exact: true })
      .click();
    await page.waitForFunction(() =>
      window.mailroomFixture.calls.some(
        (x) => x.params.status === "WAITING_RETURN_ACCEPTANCE",
      ),
    );
    await page
      .getByRole("button", { name: "登記信件／包裹", exact: true })
      .click();
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
    await drawer().locator('input[id="location"]').fill("信件櫃");
    await drawer().locator('input[id="items_0_productName"]').fill("合成信件");
    await drawer()
      .getByRole("button", { name: "登記並建立待辦", exact: true })
      .click();
    await page.waitForFunction(() => window.mailroomFixture.posts.length === 1);
    const letter = await page.evaluate(
      () => window.mailroomFixture.posts[0].body,
    );
    assert.equal(letter.recipientId, "colleague");
    assert.equal(letter.senderLabel, "測試公司");
    assert.equal("sku" in letter.items[0], false);
    assert.equal("serialNumber" in letter.items[0], false);
    assert.equal("department" in letter, false);
    await go("repair");
    await drawer()
      .getByRole("button", { name: "核對實收品項", exact: true })
      .first()
      .click();
    await choose(
      drawer().locator('input[id="matchResult"]'),
      "不一致，交客服重新確認",
    );
    await drawer().locator('textarea[id="note"]').fill("實收與來源不符");
    await drawer()
      .getByRole("button", { name: /確認儲存$/ })
      .click();
    await drawer()
      .getByText(
        "產品核對／退貨檢查至少需留存一張有效實物照片，請拍照留底後再儲存。",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.mailroomFixture.posts.length),
      0,
    );
    const photo = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await drawer()
      .locator('input[type="file"]')
      .setInputFiles({
        name: "synthetic-receipt.png",
        mimeType: "image/png",
        buffer: Buffer.from(photo, "base64"),
      });
    await drawer().getByAltText("待上傳照片 1").waitFor();
    await drawer()
      .getByRole("button", { name: /確認儲存$/ })
      .click();
    await page.waitForFunction(
      () => window.mailroomFixture.items.repair.status === "MISMATCH",
    );
    const inspection = await page.evaluate(
      () => window.mailroomFixture.posts[0].body,
    );
    assert.equal(inspection.expectedVersion, 7);
    assert.equal(inspection.matchResult, "MISMATCH");
    assert.equal(inspection.evidence.length, 1);
    assert.equal("nextUserId" in inspection, false);
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
    await go("ready");
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
    await page.evaluate(() => (window.mailroomFixture.failNext = true));
    await drawer()
      .getByRole("button", { name: /確認儲存$/ })
      .click();
    await drawer().getByText("合成回應未知，請重試", { exact: true }).waitFor();
    await page.evaluate(() => (window.mailroomFixture.commitThenLose = true));
    await drawer()
      .getByRole("button", { name: /確認儲存$/ })
      .click();
    await drawer().getByText("寄出紀錄（實際交運）", { exact: true }).waitFor();
    const posts = await page.evaluate(() => window.mailroomFixture.posts);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].body.requestId, posts[1].body.requestId);
    assert.equal(posts[1].body.expectedVersion, 7);
    assert.equal(posts[1].body.carrier, "寄出物流");
    assert.equal("productName" in posts[1].body, false);
    assert.equal("location" in posts[1].body, false);
    await drawer().getByText("入件物流 · IN-KEEP", { exact: true }).waitFor();
    await drawer()
      .getByText("寄出物流 · OUT-NEW", { exact: true })
      .first()
      .waitFor();
    await drawer()
      .getByText("承運商持有（寄回顧客途中）", { exact: true })
      .waitFor();
    await drawer()
      .getByText("已保存寄出；售後／AI 寄出同步待串接", { exact: true })
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
      path: "/tmp/corely-mailroom-workbench-20261008-dispatch.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await drawer().getByText("寄出紀錄（實際交運）", { exact: true }).waitFor();
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
      path: "/tmp/corely-mailroom-workbench-20261008-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
  },
);
