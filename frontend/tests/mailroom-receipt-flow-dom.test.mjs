import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const router=createMemoryRouter([{path:'/operations/mailroom',element:React.createElement(MailroomPage)},{path:'/other',element:React.createElement('h2',null,'其他工作台')}],{initialEntries:['/operations/mailroom?entityId=company']});
window.receiptRouter=router;
createRoot(document.getElementById('root')).render(React.createElement(RouterProvider,{router}));
`;
const api = `
export const API_URL='/offline-api';
const clone=value=>JSON.parse(JSON.stringify(value));
const source=(id='source',type='REPAIR',quantity=1)=>({id,number:id==='source'?'DEV-R-1':id.toUpperCase(),type,status:'NEW',customerLabel:'合成顧客',customerPhone:'0900000000',version:'2026-10-08T00:00:00Z',items:[{id:'declared-'+id,name:'申報產品 '+id,sku:'DECLARED-SKU',serialNumber:'DECLARED-SN',quantity,remainingQuantity:quantity}],expectedQuantity:quantity,receivedQuantity:0,remainingQuantity:quantity});
const product=(id='product')=>({id,name:id==='product'?'實收產品':id.toUpperCase(),sku:id==='product'?'ACTUAL-SKU':'SKU-'+id,barcode:'4710000000000',modelNumber:'MODEL',hasSerialNumbers:true});
const people=[{id:'colleague',name:'收件同仁',department:'客服部',employeeNo:'C1',mailroom:false,repair:false}];
const state={calls:[],posts:[],plans:[],pending:{},releases:{},items:{},sources:[source()],products:[product()],created:0,committed:{},commitThenLose:false,mediaBase64:'',blocked:[],photoReaders:[],photoDecoders:[],photoTransforms:[]};
state.source=source;state.product=product;window.receiptFixture=state;
async function planned(path,params) {
 const index=state.plans.findIndex(plan=>plan.path===path&&(plan.search===undefined||plan.search===(params.search||''))&&(plan.entity===undefined||plan.entity===params.entityId));
 if(index<0)return null;const plan=state.plans.splice(index,1)[0];state.pending[plan.token]=true;
 const result=await new Promise(resolve=>state.releases[plan.token]=()=>{delete state.pending[plan.token];delete state.releases[plan.token];resolve(plan);});
 if(result.fail)throw {response:{status:503,data:{message:'合成讀取失敗'}}};return {data:clone(result.data)};
}
export default {
 async get(path,config={}) {const params=clone(config.params||{});state.calls.push({path,params,responseType:config.responseType||null});
 const delayed=await planned(path,params);if(delayed){if(path.endsWith('/media'))return {data:new Blob([Uint8Array.from(atob(delayed.data.base64),c=>c.charCodeAt(0))],{type:delayed.data.contentType})};return delayed;}
 if(path==='/mailroom/people')return {data:clone(people)};
 if(path==='/mailroom/items')return {data:{items:Object.values(state.items).map(clone),total:Object.keys(state.items).length}};
 if(path.startsWith('/mailroom/items/'))return {data:clone(state.items[path.split('/')[3]])};
 if(path==='/mailroom/tasks')return {data:[]};
 if(path==='/mailroom/storage')return {data:{racks:[{id:'rack',code:'A',name:'收件貨架',zone:'INBOUND',isActive:true},{id:'paused-rack',code:'P',name:'停用貨架',zone:'INBOUND',isActive:false}],locations:[{id:'bin',rackId:'rack',code:'A1',name:'A1',isActive:true},{id:'inactive-bin',rackId:'rack',code:'A2',name:'停用格',isActive:false},{id:'paused-bin',rackId:'paused-rack',code:'P1',name:'P1',isActive:true}],unassigned:[],counts:{stored:0,unassigned:0},canManage:true}};
 if(path==='/mailroom/source-cases') {const search=(params.search||'').toLowerCase();return {data:{items:clone(state.sources.filter(s=>!search||[s.number,s.customerLabel,s.customerPhone].some(v=>v.toLowerCase().includes(search)))),nextCursor:null}};}
 if(path==='/mailroom/product-options'){const search=(params.search||'').toLowerCase();return {data:{items:clone(state.products.filter(p=>!search||[p.name,p.sku,p.barcode].some(v=>v.toLowerCase().includes(search))))}};}
 if(/^\\/mailroom\\/source-cases\\/[^/]+\\/attachments$/.test(path))return {data:{items:[{id:'image',fileName:path.split('/')[3]+'-案件照片.png',contentType:'image/png',scope:'CASE'}]}};
 if(path.endsWith('/media')){const binary=atob(state.mediaBase64);return {data:new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:'image/png'})};}
 throw Error('Unexpected GET '+path);
 },
 async post(path,body){state.posts.push({path,body:clone(body)});if(path!=='/mailroom/receipts')throw Error('Unexpected POST '+path);
 const known=state.committed[body.requestId];if(known){if(JSON.stringify(known.body)!==JSON.stringify(body))throw Error('Changed retry body');return {data:{itemIds:known.ids,duplicate:true}};}
 const id='created-'+(++state.created);const correspondence=['LETTER','PARCEL'].includes(body.category);const row=body.items[0];
 state.items[id]={id,label:'MR-SYNTHETIC',...row,status:correspondence?'WAITING_PICKUP':'RECEIVED',statusLabel:correspondence?'待同仁簽領':'已收到，待核對',matchResult:'PENDING',version:1,location:body.location,storageLocationId:body.storageLocationId,custodianId:'clerk',custodianName:'收發人員',nextUserId:body.recipientId||null,recipientId:body.recipientId||null,recipientName:correspondence?'收件同仁':null,nextUserName:correspondence?'收件同仁':null,repairOwnerId:null,physicalCustody:'MAILROOM',evidence:row.evidence||[],evidenceCount:row.evidence?.length||0,declared:null,history:[],deliverySummary:[],receipt:{...body,number:'MR-SYNTHETIC',sourceNumber:body.sourceCaseId?'DEV-R-1':null,receivedAt:'2026-10-08T00:00:00Z'},allowedIntakeActions:body.category==='UNMATCHED'?['send_intake']:[]};
 state.committed[body.requestId]={body:clone(body),ids:[id]};
 if(state.commitThenLose){state.commitThenLose=false;throw Error('合成已提交但回應遺失');}
 return {data:{itemIds:[id],duplicate:false}};
 }
};
`;

test(
  "native three-step receipt preserves source claims, photos, products, storage and exact retry boundaries",
  {
    skip: !executablePath && "No preinstalled browser; never installs one",
    timeout: 360000,
  },
  async (t) => {
    const virtual = "\0mailroom-receipt-flow-fixture";
    const cacheDir = mkdtempSync(
      join(tmpdir(), "corely-mailroom-receipt-flow-"),
    );
    const server = await createServer({
      root,
      cacheDir,
      configFile: false,
      server: { host: "127.0.0.1", port: 0, hmr: false },
      plugins: [
        react(),
        {
          name: "offline-native-mailroom-receipt",
          resolveId(id) {
            if (id === "virtual:mailroom-receipt-flow-fixture") return virtual;
          },
          load(id) {
            if (id === virtual) return fixture;
            if (id.endsWith("/src/contexts/AuthContext.tsx"))
              return `const user={id:'clerk',roles:[],permissions:['mailroom:read','mailroom:create','mailroom:update']};export const useAuth=()=>({user});`;
            if (id.endsWith("/src/services/api.ts")) return api;
            if (id.endsWith("/src/services/websocket.service.ts"))
              return "export const webSocketService={subscribe:()=>()=>{}};";
          },
          configureServer(vite) {
            vite.middlewares.use(async (request, response, next) => {
              if (request.url !== "/__receipt-flow") return next();
              try {
                response.setHeader("Content-Type", "text/html");
                response.end(
                  await vite.transformIndexHtml(
                    "/__receipt-flow",
                    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/@id/virtual:mailroom-receipt-flow-fixture"></script></body></html>',
                  ),
                );
              } catch (error) {
                next(error);
              }
            });
          },
        },
      ],
    });
    await server.listen();
    const browser = await chromium.launch({ executablePath, headless: true });
    t.after(async () => {
      await browser.close();
      await server.close();
      rmSync(cacheDir, { recursive: true, force: true });
    });
    const summaries = [];
    async function scene(name, run, viewport = { width: 1280, height: 970 }) {
      if (
        process.env.MAILROOM_RECEIPT_SCENE &&
        !name.includes(process.env.MAILROOM_RECEIPT_SCENE)
      )
        return;
      await t.test(name, { timeout: 120000 }, async (child) => {
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(7000);
        let completed = false;
        child.diagnostic("Opening native receipt scene");
        const errors = [],
          external = [],
          httpPosts = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => {
          const request = route.request(),
            url = new URL(request.url());
          if (request.method() === "POST") httpPosts.push(url.href);
          if (url.hostname !== "127.0.0.1") {
            external.push(url.href);
            return route.abort();
          }
          return route.continue();
        });
        await page.addInitScript(() => {
          const NativeReader = window.FileReader;
          const nativeBitmap = window.createImageBitmap.bind(window);
          window.createImageBitmap = (...args) => {
            if (!window.__holdBitmapReads) return nativeBitmap(...args);
            return new Promise((resolve, reject) =>
              window.receiptFixture.photoDecoders.push(() =>
                nativeBitmap(...args).then(resolve, reject),
              ),
            );
          };
          window.FileReader = class extends NativeReader {
            readAsDataURL(file) {
              if (window.__holdFileReads)
                window.receiptFixture.photoReaders.push(() =>
                  super.readAsDataURL(file),
                );
              else super.readAsDataURL(file);
            }
          };
        });
        child.after(async () => {
          const state = await page.evaluate(() => ({
            gets: window.receiptFixture?.calls.length || 0,
            posts: window.receiptFixture?.posts.length || 0,
            pending: Object.keys(window.receiptFixture?.pending || {}),
            plans: window.receiptFixture?.plans.length || 0,
            readers: window.receiptFixture?.photoReaders.length || 0,
            decoders: window.receiptFixture?.photoDecoders.length || 0,
            photoTransforms: window.receiptFixture?.photoTransforms || [],
          }));
          summaries.push({ name, ...state, errors, external, httpPosts });
          if (!completed) {
            writeFileSync(
              `/tmp/mailroom-receipt-flow-failure-${summaries.length}-20261008.txt`,
              await page.locator("body").innerText(),
            );
            writeFileSync(
              `/tmp/mailroom-receipt-flow-failure-${summaries.length}-20261008-aria.txt`,
              await page.locator("body").ariaSnapshot(),
            );
            writeFileSync(
              `/tmp/mailroom-receipt-flow-failure-${summaries.length}-20261008-dom.html`,
              await page.locator("body").innerHTML(),
            );
            await page
              .screenshot({
                path: `/tmp/mailroom-receipt-flow-failure-${summaries.length}-20261008.png`,
              })
              .catch(() => {});
          }
          await page.close();
        });
        await page.goto(
          `http://127.0.0.1:${server.httpServer.address().port}/__receipt-flow`,
        );
        await page
          .getByRole("heading", { name: "收發室工作台", exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "登記收件", exact: true })
            .count(),
          1,
        );
        assert.equal(
          await page
            .getByRole("button", { name: /登記售後收件|登記信件／包裹/ })
            .count(),
          0,
        );
        await page
          .getByRole("button", { name: "登記收件", exact: true })
          .click();
        const drawer = page
          .locator(".ant-drawer-content")
          .filter({ has: page.getByText("登記收件", { exact: true }) });
        const dropdown = () =>
          page.locator(".ant-select-dropdown:visible:not(.ant-slide-up-leave)");
        async function choose(control, label) {
          await control.press("ArrowDown");
          await dropdown().getByText(label, { exact: true }).click();
          await page
            .locator(".ant-select-dropdown:visible")
            .waitFor({ state: "hidden" });
        }
        const category = (label) =>
          drawer
            .locator(".mailroom-category-options label")
            .filter({ hasText: label })
            .click();
        const next = () =>
          drawer.getByRole("button", { name: "下一步", exact: true }).click();
        const posts = () => page.evaluate(() => window.receiptFixture.posts);
        async function selectSource(label = "DEV-R-1") {
          await choose(
            drawer.getByRole("combobox", { name: "搜尋售後案件", exact: true }),
            label,
          );
        }
        async function selectProduct(index = 0, label = "實收產品") {
          await choose(
            drawer
              .getByRole("combobox", { name: "搜尋實收產品", exact: true })
              .nth(index),
            label,
          );
        }
        async function selectBin() {
          await drawer
            .getByRole("combobox", { name: "選擇收件儲位", exact: true })
            .press("ArrowDown");
          assert.doesNotMatch(await dropdown().innerText(), /停用格|P1/);
          await dropdown().getByText("A1", { exact: true }).click();
          await page
            .locator(".ant-select-dropdown:visible")
            .waitFor({ state: "hidden" });
        }
        async function tinyPhoto() {
          return Buffer.from(
            await page.evaluate(() => {
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 2;
              const context = canvas.getContext("2d");
              context.fillStyle = "#007aff";
              context.fillRect(0, 0, 2, 2);
              context.fillStyle = "#ffd200";
              context.fillRect(0, 0, 1, 1);
              return canvas.toDataURL("image/png").split(",")[1];
            }),
            "base64",
          );
        }
        async function upload(index = 0, buffer = undefined, expected = 1) {
          await drawer
            .locator(".mailroom-receipt-item")
            .nth(index)
            .locator('input[type="file"]')
            .setInputFiles({
              name: "synthetic.png",
              mimeType: "image/png",
              buffer: buffer || (await tinyPhoto()),
            });
          await drawer
            .locator(".mailroom-receipt-item")
            .nth(index)
            .getByAltText(`實收照片 ${expected}`, { exact: true })
            .waitFor();
        }
        await run({
          page,
          drawer,
          dropdown,
          choose,
          category,
          next,
          posts,
          selectSource,
          selectProduct,
          selectBin,
          tinyPhoto,
          upload,
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        assert.deepEqual(httpPosts, []);
        const final = await page.evaluate(() => ({
          pending: Object.keys(window.receiptFixture.pending),
          plans: window.receiptFixture.plans.length,
          readers: window.receiptFixture.photoReaders.length,
          decoders: window.receiptFixture.photoDecoders.length,
        }));
        assert.deepEqual(final, {
          pending: [],
          plans: 0,
          readers: 0,
          decoders: 0,
        });
        completed = true;
      });
    }

    await scene(
      "known repair selects actual catalog product without copying declared SKU/SN, then saves exactly once",
      async ({
        page,
        drawer,
        category,
        next,
        posts,
        selectSource,
        selectProduct,
        selectBin,
        upload,
      }) => {
        await category("維修品");
        await selectSource();
        await drawer
          .getByText(
            "申報：申報產品 source · SKU DECLARED-SKU · SN DECLARED-SN",
            { exact: true },
          )
          .waitFor();
        for (const field of ["productName", "sku", "serialNumber"])
          assert.equal(
            await drawer.locator(`#items_0_${field}`).inputValue(),
            "",
          );
        await selectProduct();
        assert.equal(
          await drawer.locator("#items_0_productName").inputValue(),
          "實收產品",
        );
        assert.equal(
          await drawer.locator("#items_0_sku").inputValue(),
          "ACTUAL-SKU",
        );
        assert.equal(
          await drawer.locator("#items_0_barcode").inputValue(),
          "4710000000000",
        );
        assert.equal(
          await drawer.locator("#items_0_serialNumber").inputValue(),
          "",
        );
        await drawer.locator("#items_0_serialNumber").fill("SCANNED-ACTUAL-SN");
        await selectBin();
        await next();
        await next();
        await drawer
          .getByText("請為每件實收產品拍照留底", { exact: true })
          .waitFor();
        assert.deepEqual(await posts(), []);
        await upload();
        await next();
        await drawer
          .getByRole("button", { name: "確認並登記收件", exact: true })
          .waitFor();
        await page.screenshot({
          path: "/tmp/mailroom-receipt-summary-1280-20261008.png",
        });
        await drawer
          .getByRole("button", { name: "確認並登記收件", exact: true })
          .click();
        await page.waitForFunction(() => window.receiptFixture.created === 1);
        const requests = await posts();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].path, "/mailroom/receipts");
        assert.equal(requests[0].body.sourceCaseId, "source");
        assert.equal(requests[0].body.sourceVersion, "2026-10-08T00:00:00Z");
        assert.equal(requests[0].body.storageLocationId, "bin");
        assert.equal(requests[0].body.location, "A1");
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(requests[0].body.items[0]).filter(
              ([key]) => key !== "evidence",
            ),
          ),
          {
            productName: "實收產品",
            productId: "product",
            sku: "ACTUAL-SKU",
            barcode: "4710000000000",
            serialNumber: "SCANNED-ACTUAL-SN",
            sourceItemId: "declared-source",
          },
        );
        assert.equal(requests[0].body.items[0].evidence.length, 1);
        const state = await page.evaluate(() => ({
          item: window.receiptFixture.items["created-1"],
          calls: window.receiptFixture.calls,
        }));
        assert.equal(state.item.status, "RECEIVED");
        assert.equal(state.item.matchResult, "PENDING");
        assert.equal(
          state.calls.some(
            (call) =>
              call.path.startsWith("/inventory") ||
              call.path.startsWith("/products"),
          ),
          false,
        );
      },
    );

    await scene(
      "letter requires sender and actual person, omits product fields and supports a temporary location",
      async ({ page, drawer, category, next, posts, choose }) => {
        await category("公司信件");
        assert.equal(
          await drawer
            .locator("#items_0_sku, #items_0_serialNumber, #items_0_barcode")
            .count(),
          0,
        );
        await choose(
          drawer.getByRole("combobox", { name: "收件同仁部門", exact: true }),
          "客服部",
        );
        await choose(
          drawer.getByRole("combobox", { name: "收件同仁", exact: true }),
          "客服部 · 收件同仁 · C1",
        );
        await drawer
          .getByRole("checkbox", { name: "使用臨時存放位置", exact: true })
          .check();
        await drawer.locator("#location").fill("信件暫存桌");
        await drawer.locator("#items_0_productName").fill("合成信件");
        await next();
        await drawer
          .locator(
            ".ant-form-item:has(#senderLabel) .ant-form-item-explain-error",
          )
          .waitFor();
        assert.deepEqual(await posts(), []);
        await drawer.locator("#senderLabel").fill("合成寄件公司");
        await next();
        await next();
        await drawer
          .getByRole("button", { name: "確認並登記收件", exact: true })
          .click();
        await page.waitForFunction(() => window.receiptFixture.created === 1);
        const body = (await posts())[0].body;
        assert.equal(body.recipientId, "colleague");
        assert.equal(body.senderLabel, "合成寄件公司");
        assert.equal(body.location, "信件暫存桌");
        for (const field of [
          "sourceCaseId",
          "sourceVersion",
          "storageLocationId",
        ])
          assert.equal(field in body, false);
        assert.deepEqual(body.items[0], { productName: "合成信件" });
      },
    );

    await scene(
      "unknown receipt requires photo, holds reading guards, and preserves an exact committed retry with locked edits and route",
      async ({
        page,
        drawer,
        category,
        next,
        posts,
        selectProduct,
        selectBin,
        tinyPhoto,
      }) => {
        await category("找不到售後案件");
        await selectProduct();
        await selectBin();
        await next();
        await next();
        await drawer
          .getByText("請為每件實收產品拍照留底", { exact: true })
          .waitFor();
        await page.evaluate(() => {
          window.__holdFileReads = true;
        });
        await drawer.locator('input[type="file"]').setInputFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: await tinyPhoto(),
        });
        await page.waitForFunction(
          () => window.receiptFixture.photoReaders.length === 1,
        );
        assert.equal(
          await drawer
            .getByRole("button", { name: "下一步", exact: true })
            .isDisabled(),
          true,
        );
        await drawer
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await page
          .getByText("正在保存或讀取照片，請稍候。", { exact: true })
          .first()
          .waitFor();
        await page.evaluate(() => {
          window.__holdFileReads = false;
          window.receiptFixture.photoReaders.shift()();
        });
        await drawer.getByAltText("實收照片 1", { exact: true }).waitFor();
        await next();
        await page.evaluate(() => {
          window.receiptFixture.commitThenLose = true;
        });
        await drawer
          .getByRole("button", { name: "確認並登記收件", exact: true })
          .click();
        await drawer.getByText("登記結果尚未確認", { exact: true }).waitFor();
        assert.equal(
          await drawer
            .getByRole("button", { name: "上一步", exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(
          await drawer.locator("#items_0_serialNumber").isDisabled(),
          true,
        );
        await drawer.getByRole("button", { name: /取\s*消/ }).click();
        await page
          .getByText("請先重試原操作，確認保存結果後再離開。", { exact: true })
          .first()
          .waitFor();
        await page.evaluate(() => {
          void window.receiptRouter.navigate("/other");
        });
        await page
          .getByText("請先重試原操作，確認保存結果後再離開。", { exact: true })
          .first()
          .waitFor();
        assert.equal(
          await page
            .getByRole("heading", { name: "其他工作台", exact: true })
            .count(),
          0,
        );
        await drawer.getByRole("button", { name: /重試原登記$/ }).click();
        await page.waitForFunction(
          () => window.receiptFixture.posts.length === 2,
        );
        const requests = await posts();
        assert.deepEqual(requests[0].body, requests[1].body);
        assert.equal(requests[0].body.category, "UNMATCHED");
        assert.equal("sourceCaseId" in requests[0].body, false);
        assert.equal("sourceVersion" in requests[0].body, false);
        const state = await page.evaluate(() => ({
          created: window.receiptFixture.created,
          item: window.receiptFixture.items["created-1"],
        }));
        assert.equal(state.created, 1);
        assert.equal(state.item.status, "RECEIVED");
        assert.equal(state.item.matchResult, "PENDING");
      },
    );

    await scene(
      "return receipt requires evidence and is usable at 390px without changing inspection status",
      async ({
        page,
        drawer,
        category,
        next,
        posts,
        selectSource,
        selectProduct,
        selectBin,
        upload,
      }) => {
        await page.evaluate(() => {
          window.receiptFixture.sources = [
            window.receiptFixture.source("source", "RETURN"),
          ];
        });
        await category("退貨品");
        await selectSource();
        await selectProduct();
        await selectBin();
        await next();
        await next();
        await drawer
          .getByText("請為每件實收產品拍照留底", { exact: true })
          .waitFor();
        assert.deepEqual(await posts(), []);
        for (let photo = 1; photo <= 4; photo++)
          await upload(0, undefined, photo);
        assert.equal(
          await drawer
            .getByRole("button", { name: /拍照／選擇照片$/ })
            .isDisabled(),
          true,
        );
        await next();
        await page.screenshot({
          path: "/tmp/mailroom-receipt-summary-390-20261008.png",
        });
        const geometry = await drawer.boundingBox();
        assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= 391);
        await drawer
          .getByRole("button", { name: "確認並登記收件", exact: true })
          .click();
        await page.waitForFunction(() => window.receiptFixture.created === 1);
        const body = (await posts())[0].body;
        assert.equal(body.category, "RETURN");
        assert.equal(body.items[0].evidence.length, 4);
        const item = await page.evaluate(
          () => window.receiptFixture.items["created-1"],
        );
        assert.equal(item.status, "RECEIVED");
        assert.equal(item.matchResult, "PENDING");
      },
      { width: 390, height: 844 },
    );

    await scene(
      "camera decodes a real large PNG locally, saves a JPEG at most 1MiB and 1600px, and locks controls through decode and read",
      async ({
        page,
        drawer,
        category,
        next,
        posts,
        selectProduct,
        selectBin,
        upload,
      }) => {
        await category("找不到售後案件");
        await selectProduct();
        await selectBin();
        await next();
        await upload();
        const original = Buffer.from(
          await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = 2000;
            canvas.height = 1500;
            const context = canvas.getContext("2d"),
              pixels = context.createImageData(canvas.width, canvas.height);
            let seed = 0x12345678;
            function random() {
              seed ^= seed << 13;
              seed ^= seed >>> 17;
              seed ^= seed << 5;
              return seed >>> 0;
            }
            for (let pixel = 0; pixel < pixels.data.length; pixel += 4) {
              const bits = random();
              pixels.data[pixel] = bits & 255;
              pixels.data[pixel + 1] = (bits >>> 8) & 255;
              pixels.data[pixel + 2] = (bits >>> 16) & 255;
              pixels.data[pixel + 3] = 255;
            }
            context.putImageData(pixels, 0, 0);
            return canvas.toDataURL("image/png").split(",")[1];
          }),
          "base64",
        );
        assert.ok(
          original.length > 1024 * 1024 && original.length < 30 * 1024 * 1024,
        );
        assert.deepEqual(
          [...original.subarray(0, 8)],
          [137, 80, 78, 71, 13, 10, 26, 10],
        );
        await page.evaluate(() => {
          window.__holdBitmapReads = true;
          window.__holdFileReads = true;
        });
        await drawer
          .locator('input[type="file"]')
          .setInputFiles({
            name: "synthetic-real-camera.png",
            mimeType: "image/png",
            buffer: original,
          });
        await page.waitForFunction(
          () => window.receiptFixture.photoDecoders.length === 1,
        );
        assert.equal(
          await drawer
            .getByRole("button", { name: "下一步", exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(
          await drawer
            .getByRole("button", { name: /拍照／選擇照片$/ })
            .isDisabled(),
          true,
        );
        assert.equal(
          await drawer
            .getByRole("button", { name: "移除實收照片 1", exact: true })
            .isDisabled(),
          true,
        );
        await drawer
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await page
          .getByText("正在保存或讀取照片，請稍候。", { exact: true })
          .first()
          .waitFor();
        assert.deepEqual(await posts(), []);
        await page.evaluate(() => {
          window.__holdBitmapReads = false;
          window.receiptFixture.photoDecoders.shift()();
        });
        await page.waitForFunction(
          () => window.receiptFixture.photoReaders.length === 1,
        );
        assert.equal(
          await drawer
            .getByRole("button", { name: "下一步", exact: true })
            .isDisabled(),
          true,
        );
        await page.evaluate(() => {
          window.__holdFileReads = false;
          window.receiptFixture.photoReaders.shift()();
        });
        const preview = drawer.getByAltText("實收照片 2", { exact: true });
        await preview.waitFor();
        await page.waitForFunction(() => {
          const image = document.querySelector('img[alt="實收照片 2"]');
          return image?.complete && image.naturalWidth > 0;
        });
        const prepared = await preview.getAttribute("src"),
          bytes = Buffer.from(prepared.split(",")[1], "base64");
        assert.match(prepared, /^data:image\/jpeg;base64,/);
        assert.ok(bytes.length > 0 && bytes.length <= 1024 * 1024);
        assert.equal(bytes.readUInt16BE(0), 0xffd8);
        const size = await preview.evaluate((image) => ({
          width: image.naturalWidth,
          height: image.naturalHeight,
        }));
        assert.deepEqual(size, { width: 1600, height: 1200 });
        await page.evaluate(
          (transform) => window.receiptFixture.photoTransforms.push(transform),
          {
            originalBytes: original.length,
            savedBytes: bytes.length,
            originalSize: { width: 2000, height: 1500 },
            savedSize: size,
            originalType: "image/png",
            savedType: "image/jpeg",
          },
        );
        await upload(0, undefined, 3);
        await upload(0, undefined, 4);
        assert.equal(
          await drawer
            .getByRole("button", { name: /拍照／選擇照片$/ })
            .isDisabled(),
          true,
        );
        assert.equal(await drawer.getByAltText(/^實收照片 [1-4]$/).count(), 4);
        await next();
        await drawer
          .getByRole("button", { name: "確認並登記收件", exact: true })
          .click();
        await page.waitForFunction(() => window.receiptFixture.created === 1);
        const requests = await posts();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].body.items[0].evidence.length, 4);
        assert.equal(requests[0].body.items[0].evidence[1], prepared);
        assert.ok(
          requests[0].body.items[0].evidence.reduce(
            (sum, value) =>
              sum + Buffer.from(value.split(",")[1], "base64").length,
            0,
          ) <=
            3 * 1024 * 1024,
        );
      },
    );

    await scene(
      "native photo input rejects per-item overflow, blocks 13MB and submits exactly 12MB after removing the unreceived item",
      async ({
        page,
        drawer,
        category,
        next,
        posts,
        selectSource,
        selectProduct,
        selectBin,
        tinyPhoto,
        upload,
      }) => {
        await page.evaluate(() => {
          window.receiptFixture.sources = [
            window.receiptFixture.source("source", "REPAIR", 5),
          ];
        });
        await category("維修品");
        await selectSource();
        for (let index = 0; index < 5; index++) await selectProduct(index);
        await selectBin();
        await next();
        const padded = Buffer.alloc(1024 * 1024);
        (await tinyPhoto()).copy(padded);
        for (let index = 0; index < 4; index++)
          for (let photo = 1; photo <= 3; photo++)
            await upload(index, padded, photo);
        await drawer
          .locator(".mailroom-receipt-item")
          .nth(0)
          .locator('input[type="file"]')
          .setInputFiles({
            name: "overflow.png",
            mimeType: "image/png",
            buffer: padded,
          });
        await drawer
          .getByText("每件照片合計不可超過 3 MB", { exact: true })
          .waitFor();
        assert.equal(
          await drawer
            .locator(".mailroom-receipt-item")
            .nth(0)
            .getByAltText(/實收照片/)
            .count(),
          3,
        );
        await upload(4, padded);
        await next();
        await drawer
          .getByText("本次收件照片合計不可超過 12 MB，請分批登記", {
            exact: true,
          })
          .waitFor();
        assert.deepEqual(await posts(), []);
        await drawer
          .getByRole("button", { name: "上一步", exact: true })
          .click();
        await drawer
          .locator(".mailroom-receipt-item")
          .nth(4)
          .getByRole("button", { name: /移\s*除/ })
          .click();
        await next();
        await next();
        await drawer
          .getByRole("button", { name: "確認並登記收件", exact: true })
          .click();
        await page.waitForFunction(() => window.receiptFixture.created === 1);
        const requests = await posts();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].body.items.length, 4);
        const bytes = (value) =>
          Buffer.from(value.split(",")[1], "base64").length;
        assert.equal(
          requests[0].body.items.reduce(
            (sum, item) =>
              sum + item.evidence.reduce((n, value) => n + bytes(value), 0),
            0,
          ),
          12 * 1024 * 1024,
        );
        for (const item of requests[0].body.items) {
          assert.equal(item.evidence.length, 3);
          assert.equal(
            item.evidence.reduce((n, value) => n + bytes(value), 0),
            3 * 1024 * 1024,
          );
        }
      },
    );

    await scene(
      "held source and product searches cannot replace the current query, and case photos load only as scoped metadata plus authenticated blobs",
      async ({
        page,
        drawer,
        dropdown,
        category,
        selectSource,
        selectProduct,
        tinyPhoto,
      }) => {
        await page.evaluate(() => {
          const state = window.receiptFixture;
          state.sources.push(
            state.source("newsource"),
            state.source("othercase"),
          );
          state.products.push(state.product("newproduct"));
          state.plans.push(
            {
              path: "/mailroom/source-cases",
              search: "old",
              token: "oldsource",
              data: { items: [state.source("oldsource")], nextCursor: null },
            },
            {
              path: "/mailroom/product-options",
              search: "oldproduct",
              token: "oldproduct",
              data: { items: [state.product("oldproduct")] },
            },
          );
        });
        await category("維修品");
        const sourceInput = drawer.getByRole("combobox", {
          name: "搜尋售後案件",
          exact: true,
        });
        await sourceInput.press("ArrowDown");
        await sourceInput.fill("old");
        await page.waitForFunction(
          () => window.receiptFixture.pending.oldsource,
        );
        await sourceInput.fill("newsource");
        await dropdown().getByText("NEWSOURCE", { exact: true }).click();
        await page
          .locator(".ant-select-dropdown:visible")
          .waitFor({ state: "hidden" });
        await page.evaluate(() => window.receiptFixture.releases.oldsource());
        await drawer
          .getByText(
            "申報：申報產品 newsource · SKU DECLARED-SKU · SN DECLARED-SN",
            { exact: true },
          )
          .waitFor();
        assert.equal(await drawer.getByText(/申報產品 oldsource/).count(), 0);
        const productInput = drawer.getByRole("combobox", {
          name: "搜尋實收產品",
          exact: true,
        });
        await productInput.press("ArrowDown");
        await productInput.fill("oldproduct");
        await page.waitForFunction(
          () => window.receiptFixture.pending.oldproduct,
        );
        await productInput.fill("newproduct");
        await dropdown().getByText("NEWPRODUCT", { exact: true }).click();
        await page
          .locator(".ant-select-dropdown:visible")
          .waitFor({ state: "hidden" });
        await page.evaluate(() => window.receiptFixture.releases.oldproduct());
        assert.equal(
          await drawer.locator("#items_0_productName").inputValue(),
          "NEWPRODUCT",
        );
        assert.equal(
          await drawer.locator("#items_0_serialNumber").inputValue(),
          "",
        );
        assert.equal(
          await page.evaluate(() =>
            window.receiptFixture.calls.some((call) =>
              call.path.includes("/attachments"),
            ),
          ),
          false,
        );
        const image = (await tinyPhoto()).toString("base64");
        await page.evaluate((base64) => {
          window.receiptFixture.mediaBase64 = base64;
          window.receiptFixture.plans.push({
            path: "/mailroom/source-cases/newsource/attachments/image/media",
            token: "oldmedia",
            data: { base64, contentType: "image/png" },
          });
        }, image);
        await drawer
          .getByRole("button", { name: "查看售後案件照片", exact: true })
          .click();
        await drawer
          .getByRole("button", { name: "newsource-案件照片.png", exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(() =>
            window.receiptFixture.calls.some((call) =>
              call.path.endsWith("/media"),
            ),
          ),
          false,
        );
        await drawer
          .getByRole("button", { name: "newsource-案件照片.png", exact: true })
          .click();
        await page.waitForFunction(
          () => window.receiptFixture.pending.oldmedia,
        );
        await sourceInput.press("ArrowDown");
        await sourceInput.fill("othercase");
        await dropdown().getByText("OTHERCASE", { exact: true }).click();
        await page
          .locator(".ant-select-dropdown:visible")
          .waitFor({ state: "hidden" });
        await page.evaluate(() => window.receiptFixture.releases.oldmedia());
        assert.equal(
          await drawer
            .getByAltText("來源案件照片：newsource-案件照片.png", {
              exact: true,
            })
            .count(),
          0,
        );
        assert.equal(
          await drawer.locator("#items_0_productName").inputValue(),
          "",
        );
        await drawer
          .getByRole("button", { name: "查看售後案件照片", exact: true })
          .click();
        await drawer
          .getByRole("button", { name: "othercase-案件照片.png", exact: true })
          .click();
        const preview = drawer.getByAltText(
          "來源案件照片：othercase-案件照片.png",
          { exact: true },
        );
        await preview.waitFor();
        assert.match(await preview.getAttribute("src"), /^blob:/);
        await drawer
          .getByRole("button", { name: "收起案件照片", exact: true })
          .click();
        await drawer
          .getByRole("button", { name: "查看售後案件照片", exact: true })
          .click();
        await drawer
          .getByRole("button", { name: "othercase-案件照片.png", exact: true })
          .click();
        await preview.waitFor();
        const mediaCalls = await page.evaluate(() =>
          window.receiptFixture.calls.filter((call) =>
            call.path.includes("/attachments"),
          ),
        );
        assert.equal(
          mediaCalls.filter((call) => call.path.endsWith("/media")).length,
          3,
        );
        for (const call of mediaCalls) {
          assert.deepEqual(call.params, { entityId: "company" });
          assert.doesNotMatch(call.path, /token|jwt|bearer/i);
          if (call.path.endsWith("/media"))
            assert.equal(call.responseType, "blob");
        }
      },
    );

    await scene(
      "company change discards the draft and rejects held product, source and image metadata from the previous scope",
      async ({ page, drawer, dropdown, category, selectSource }) => {
        await category("維修品");
        await selectSource();
        await page.evaluate(() => {
          const state = window.receiptFixture;
          state.plans.push(
            {
              path: "/mailroom/source-cases/source/attachments",
              entity: "company",
              token: "metadata",
              data: {
                items: [
                  {
                    id: "late",
                    fileName: "舊公司照片.png",
                    contentType: "image/png",
                    scope: "CASE",
                  },
                ],
              },
            },
            {
              path: "/mailroom/product-options",
              search: "old",
              entity: "company",
              token: "oldcompanyproduct",
              data: { items: [state.product("oldcompanyproduct")] },
            },
            {
              path: "/mailroom/source-cases",
              search: "old",
              entity: "company",
              token: "oldcompanysource",
              data: {
                items: [state.source("oldcompanysource")],
                nextCursor: null,
              },
            },
          );
        });
        await drawer
          .getByRole("button", { name: "查看售後案件照片", exact: true })
          .click();
        await page.waitForFunction(
          () => window.receiptFixture.pending.metadata,
        );
        const productInput = drawer.getByRole("combobox", {
          name: "搜尋實收產品",
          exact: true,
        });
        await productInput.press("ArrowDown");
        await productInput.fill("old");
        await page.waitForFunction(
          () => window.receiptFixture.pending.oldcompanyproduct,
        );
        await productInput.press("Escape");
        const sourceInput = drawer.getByRole("combobox", {
          name: "搜尋售後案件",
          exact: true,
        });
        await sourceInput.press("ArrowDown");
        await sourceInput.fill("old");
        await page.waitForFunction(
          () => window.receiptFixture.pending.oldcompanysource,
        );
        await sourceInput.press("Escape");
        await page.evaluate(() => {
          void window.receiptRouter.navigate(
            "/operations/mailroom?entityId=other-company",
          );
        });
        const modal = page
          .getByRole("dialog")
          .filter({ hasText: "目前收發工作有未保存的修改" });
        await modal
          .getByRole("button", { name: "放棄草稿", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            window.receiptRouter.state.location.search ===
            "?entityId=other-company",
        );
        await page.waitForFunction(() =>
          window.receiptFixture.calls.some(
            (call) =>
              call.path === "/mailroom/product-options" &&
              call.params.entityId === "other-company",
          ),
        );
        await page.evaluate(() => {
          const state = window.receiptFixture;
          state.releases.metadata();
          state.releases.oldcompanyproduct();
          state.releases.oldcompanysource();
        });
        // The keyed drawer is a new instance in the new company. It may stay open, but its previous selection cannot remain.
        if (
          !(await drawer
            .getByRole("combobox", { name: "搜尋售後案件", exact: true })
            .count())
        )
          await category("維修品");
        await drawer
          .getByText(
            "申報：申報產品 source · SKU DECLARED-SKU · SN DECLARED-SN",
            { exact: true },
          )
          .waitFor({ state: "hidden" });
        assert.equal(
          await drawer.getByText("舊公司照片.png", { exact: true }).count(),
          0,
        );
        await selectSource();
        const newProductInput = drawer.getByRole("combobox", {
          name: "搜尋實收產品",
          exact: true,
        });
        await newProductInput.press("ArrowDown");
        await dropdown().getByText("實收產品", { exact: true }).waitFor();
        assert.doesNotMatch(await dropdown().innerText(), /OLDCOMPANYPRODUCT/);
        const calls = await page.evaluate(() => window.receiptFixture.calls);
        assert.ok(
          calls.some(
            (call) =>
              call.path === "/mailroom/product-options" &&
              call.params.entityId === "other-company",
          ),
        );
      },
    );

    writeFileSync(
      "/tmp/mailroom-receipt-flow-dom-results-20261008.json",
      JSON.stringify(summaries, null, 2),
    );
  },
);
