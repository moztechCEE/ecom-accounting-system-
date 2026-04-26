# 營運中樞缺口清單 - 2026-04-26

這份文件用來記錄 MOZTECH / BONSON 營運中樞目前不能忘記的缺口。目標不是單純列功能，而是把「公司真正需要的營運閉環」和「系統目前還缺什麼」固定下來，避免後續只做零散頁面。

## 本輪實際驗證範圍

- 目前可用正式入口：`https://ecom-accounting-frontend-sp5g377smq-de.a.run.app`
- Cloud Run frontend `/config.js` 已指向 `https://ecom-accounting-backend-sp5g377smq-de.a.run.app/api/v1`
- Cloud Run backend Swagger 可達：`/api-docs`
- Render frontend 仍可載入登入頁，但 `/config.js` 是空設定
- Render backend 回應 `Service Suspended`，不可作為正式驗證入口
- 本機 `localhost:5173` 與 `localhost:3000` 本輪沒有服務在跑
- Google Chrome / Codex / Codex Computer Use 的 macOS Accessibility 權限後續已開通；Computer Use 可讀取 Chrome 畫面與操作一般 UI
- 已用系統安裝的 Chrome headless 驗證 Cloud Run 登入頁可載入
- 種子預設帳密在 Cloud Run 回應 `Invalid credentials`，因此本輪尚未進入已登入後台畫面
- 後續已用管理員帳號成功登入 Cloud Run backend，並以 Chrome headless 檢查登入後 UI
- 登入後若瀏覽器沒有 `localStorage.entityId`，多個頁面會停在 skeleton / spinner；手動設定 `tw-entity-001` 後 Dashboard、對帳中心、庫存、費用、報表頁可正常顯示內容

## 核心產品目標

系統要成為公司的營運中樞與數位會計師，能把訂單、收款、撥款、發票、銀行入帳、庫存、費用、人事、廣告費與財務報表收斂在同一套資料治理流程裡。

完成態應回答：

- 每筆訂單是否已付款
- 款項是否已從平台或金流撥入銀行
- 手續費是否為實際值，不是估算值
- 發票是否已開立、作廢、折讓或待補
- AR / AP 是否已沖銷
- 會計分錄是否已落帳
- 庫存是否足夠，是否需要採購
- 哪些異常會影響關帳或管理決策

## 最高優先缺口

### 1. 綠界電子發票正式 API 尚未完成

目前內部 `Invoice` 模組已存在，但仍不是完整綠界電子發票串接。

必補能力：

- 綠界電子發票 Adapter
- B2C / B2B 開立
- 發票狀態查詢
- 作廢
- 折讓
- 折讓作廢
- 字軌 / 配號查詢與用量警示
- 綠界正式發票號碼、日期、隨機碼、外部 ID 回寫 `Invoice` 與 `SalesOrder`
- 發票狀態要同步顯示在銷售訂單、AR、Dashboard、會計工作台

### 2. 訂單到核銷尚未真正閉環

目標狀態：

1. `SalesOrder created`
2. `Payment captured`
3. `Provider payout matched`
4. `Bank transaction matched`
5. `Invoice verified`
6. `AR cleared`
7. `Journal posted`
8. `Closed`

目前仍需補齊：

- 銷售訂單穩定自動建立 AR
- 收款成功後自動沖銷 AR
- 綠界撥款與 Payment 的完整 matching
- 銀行入帳與金流淨額 matching
- 收款分錄、手續費分錄、收入分錄完整自動化
- 退款 / 折讓 / 作廢的 reversing journal
- 未完成閉環的逐筆異常隊列

### 3. 1Shop 與雙綠界帳號對帳尚未完成

公司實際規則：

- `3290494`：MOZTECH Shopify 官網
- `3150241`：團購 / 1Shop / 未來 Shopline

必補能力：

- 1Shop 歷史訂單完整回補
- 1Shop 訂單對 `3150241` 綠界撥款 matching
- 1Shop 訂單對綠界電子發票狀態核對
- 團購手續費不可猜測，必須以綠界撥款、服務費發票或匯出報表為準
- 1Shop 未匹配工作台
- `3150241` 和 `3290494` 不可混用同一條對帳鏈

### 4. Dashboard 還不是完整總控台

Dashboard 最終不應只是展示業績，而是要主動揭露營運風險。

必補指標：

- 總業績
- 實收淨額
- 待撥款
- 已撥款未入帳
- 缺發票訂單
- 發票金額 / 稅額異常
- AR 逾期
- AP 到期
- 廣告費未核銷
- 庫存水位警示
- 未匹配金流 / 銀行交易
- 可關帳 / 不可關帳原因

### 5. 對帳中心需要成為會計的工作台

目前 API surface 已有 `reconciliation/center`、`run`、`clear-ready`、`payouts/import`、`backfill/oneshop-groupbuy-closure` 等端點，但產品上仍需確認登入後畫面是否真的能完成日常工作。

必補能力：

- 可核銷、待撥款、已核銷、異常四隊列
- 手動 matching
- 批次核銷
- unmatched payout lines 處理
- 缺發票、缺手續費、缺銀行入帳的原因說明
- 每個異常能 drill down 到訂單 / Payment / Payout / Invoice / Journal

## 你補充後新增的不可忘記缺口

### 6. 經銷商 / 代理商前台

目前系統有 `Customer`、信用額度、付款條件等基礎，但還不是經銷商下單前台。

必補能力：

- 經銷商 / 代理商帳號
- B2B 價格層級
- 客戶可見商品範圍
- 即時可售庫存
- 預計到貨時間
- 經銷商自主下單
- 帳期 / 月結 / 信用額度控管
- B2B 對帳單
- 經銷商訂單和一般電商訂單進同一條 AR / 發票 / 對帳鏈

### 7. 產品、庫存與採購治理

目前有產品、倉庫、庫存快照與庫存異動，但需要往營運決策層補齊。

必補能力：

- 全品牌 SKU 主檔治理
- MOZTECH / BONSON / AIRITY / MORITEK 品牌欄位
- 平台 SKU 對內部 SKU mapping
- 多倉庫、平台倉、3PL 倉
- 庫存週轉率
- 安全庫存
- 預計到貨日
- 建議採購量
- 缺貨風險
- COGS 與批次成本
- 銷售扣庫存與採購入庫閉環

### 8. 多平台銷售整合

除 Shopify、1Shop、Shopline 外，還需要逐步納入：

- LINE 禮物
- 有設計
- Momo
- 東森
- Pinkoi
- PChome
- 其他品牌官網

每個平台都要定義：

- 訂單來源
- 顧客來源
- 收款來源
- 撥款來源
- 平台費來源
- 金流費來源
- 發票來源
- 庫存是否由平台控倉
- API、匯出報表或人工匯入策略

### 9. 廣告費用自動對帳

目前費用報銷可處理一般費用，但廣告平台尚未形成正式 connector。

必補平台：

- Meta / Facebook / Instagram
- Google Ads
- TikTok Ads

必補能力：

- 廣告花費 API 匯入
- 廣告帳戶與品牌 / 通路 mapping
- 發票或收據匯入
- 信用卡 / 銀行扣款 matching
- AP 或費用入帳
- 廣告費分錄
- ROAS / 毛利 / 現金流聯動

### 10. 人事、費用與審批治理

目前已有費用申請、AI 分類、薪資、出勤等模組，但主管自主核銷還需要收斂。

必補能力：

- 部門主管審批
- 多層審批規則
- 審批通知
- 付款進度
- 費用到 AP
- AP 到付款
- 付款到銀行交易
- 付款分錄
- 報支項目治理
- 發票後補追蹤

## 本輪從實際系統 surface 看到的產品落差

### A. Render 與 Cloud Run 入口並存，容易誤用

- Render frontend 可以開，但 backend 已 suspended
- Cloud Run frontend 才有正確 runtime config
- 後續文件、操作手冊、使用者入口應統一指向 Cloud Run

### B. 未登入畫面可載入，但尚未完成 authenticated Chrome 盤點

目前已確認登入頁可載入；桌面 Chrome 控制仍受限，但已用 Chrome headless 完成登入後抽查。

已抽查頁面：

- Dashboard
- 對帳中心
- 銷售訂單
- AR
- AP
- 銀行
- 庫存
- 費用申請 / 審核
- 報表中心

仍需補查：

- 會計工作台
- 採購
- 製造 / 組裝
- 薪資 / 出勤
- 系統管理

### B-1. 實際登入後資料完整度

Cloud Run 正式資料目前已經不是空系統，但核心治理缺口很大。

已驗證數字：

- 訂單：28,172 筆
- 訂單總額：約 40,150,707 元
- 顧客：27,973 筆
- Payment：30,327 筆
- Invoice：72 筆
- Payout import lines：11,939 筆
- Bank transactions：0 筆
- 發票覆蓋率：0.32%
- Payment 核銷率：0.9%
- Payout line matched rate：2.66%
- Bank transaction matched rate：0%
- 實際手續費覆蓋率：1.14%

主要缺口：

- 缺發票訂單：28,081 筆
- Payment 尚未核銷：30,054 筆
- 手續費待補：23,886 筆
- 訂單缺 Payment：1,966 筆
- 未匹配 payout lines：11,493 筆
- invalid payout lines：128 筆
- AR outstanding：約 2,896,478 元
- AR overdue：1,965 筆，約 2,895,379 元

通路狀態：

- 1Shop：23,460 筆訂單，約 32,954,510 元；缺發票 23,369 筆；reconciled payment 0 筆
- Shopify：4,712 筆訂單，約 7,196,197 元；缺 payment 1,966 筆；reconciled payment 273 筆；缺發票 4,712 筆
- Shopline / Momo / PChome / Pinkoi / LINE 禮物等其他通路目前尚未形成實際訂單資料流

### B-2. 實際整合健康狀態

- Shopify health：成功，connection successful
- 1Shop health：503 Service Unavailable
- Shopline health：超過 8 秒仍未回應
- LINE Pay config：已設定 production profile

### B-3. 實際 UI 狀態

- Dashboard 可顯示 yesterday summary、待補發票、稅額異常、手續費待補等資訊
- 對帳中心可顯示任務區與四隊列入口
- 產品與庫存頁可載入，但產品清單是 `No data`
- 費用申請頁可載入，但目前沒有費用申請資料
- 報表中心可載入且已有分區說明
- 若沒有 `localStorage.entityId`，上述頁面會卡在 loading skeleton / spinner，這是實際可見的 usability blocker

### C. 前端與後端 API 有至少一個明確命名落差

已看到：

- 前端 `banking.service.ts` 使用 `/banking/accounts/{id}/import`
- 後端 Swagger 顯示銀行匯入端點是 `/banking/accounts/{id}/import-statement`

這會造成銀行對帳單匯入功能在前端可能失敗。需修正前端 service 或後端補 alias。

本地已修正前端 service，改呼叫 `/banking/accounts/{id}/import-statement`。

### D. Swagger 與實際模組揭露不一致

`AppModule` 已載入 product、purchase、assembly、attendance、Shopify、1Shop、Shopline 等模組，但 Swagger 分組沒有完整列出部分 controller。這代表 API 文件不是完整產品驗收依據，需要用登入後 UI 和 controller/service 逐項驗證。

### E. 公司實體 API 預設查詢有 bug

`GET /entities` 未帶 `isActive` 時，controller 會把 `undefined` 轉成 `false`，導致只查 inactive entities；正式環境回空陣列。這會讓前端無法可靠取得預設公司實體，進而導致登入後頁面缺 `entityId`。

本地已修正為：未帶 `isActive` 時不加 filter；只有明確帶 `isActive=true/false` 才套用篩選。

### F. 缺發票訂單的正確處理入口

使用者不應該在銷售訂單、報表中心與對帳中心之間猜發票要在哪裡補。

本地已把處理入口收斂為：

- 儀表板：新增「缺發票訂單處理入口」，可直接前往 `/accounting/workbench?focus=missing-invoices`
- 對帳中心：保留核對與狀態判斷，但缺發票 / 補分錄動作導向會計工作台
- 會計工作台：新增發票處理區，明確放置同步發票狀態、匯入綠界銷項發票、補跑 1Shop 團購閉環、查看原始訂單、查看核銷狀態

目前判斷：「缺發票訂單」不在報表中心處理；報表中心只看彙總。原始交易仍在銷售訂單看，核銷狀態在對帳中心看，補發票與會計補件統一在會計工作台處理。

### G. 前端 runtime config 載入順序

本機 Chrome 驗證時發現：production build 後主程式 module 會被 Vite 提到 `<head>`，但 `/config.js` 原本留在 `<body>` 底部。結果前端先啟動時讀不到 `window.__APP_CONFIG__.apiUrl`，會退回同 origin `/api/v1`，造成登入後 `/users/me` 打錯位置並被導回登入頁。

本地已修正 `frontend/index.html`：`/config.js` 改放在主程式 module 前載入。修正後以 headless Chrome 驗證，本機前端可讀到 Cloud Run API URL，登入 token 可通過 `/users/me`，並能開啟 `/accounting/workbench?focus=missing-invoices`。

### H. 對帳中心正式畫面與 API 資料不一致

2026-04-26 用 Computer Use 檢查正式 Chrome 畫面時，Dashboard 顯示已有高風險對帳、待補發票與待撥款資料；但 `/reconciliation` 對帳中心畫面一開始曾顯示四隊列全為 0，表格為 `No data`，且重新整理按鈕長時間停在 loading。後續重新整理後正式站已可顯示待撥款 1 筆、異常 1,447 筆與明細表格，因此這不是後端無資料，而是前端讀取等待時間、載入狀態與錯誤提示需要更穩定。

同一組正式 API、同一個公司實體 `tw-entity-001`、同一段日期直接呼叫 `/reconciliation/center` 可正常回傳資料：

- totalCount：1,448
- pendingPayoutCount：1
- exceptionCount：1,447
- returned payload：約 1.57 MB
- API 回應時間：約 6.3 秒

本地已修正：

- `frontend/src/services/api.ts`：全域 axios timeout 由 10 秒調整為 30 秒
- `frontend/src/services/reconciliation.service.ts`：對帳中心讀取 timeout 調整為 60 秒
- `frontend/src/services/ar.service.ts`：AR monitor 讀取 timeout 調整為 60 秒，避免會計工作台被同類查詢拖垮
- `frontend/src/pages/ReconciliationCenterPage.tsx`：讀取失敗時顯示頁面錯誤，不再讓使用者誤判為 0 筆資料
- `backend/src/modules/reconciliation/reconciliation.service.ts`：對帳中心保留完整統計，但每個隊列只回傳前 `limit` 筆明細，避免一次把 1,400+ 筆明細塞給前端表格

### I. 會計工作台 AR / B2B 區塊讀取不穩

2026-04-26 檢查 `/accounting/workbench?focus=missing-invoices` 時，正式頁面可顯示缺發票 1,660 筆、發票覆蓋率 5.2%、1Shop 缺口 216、Shopify 缺口 1,444。但頁面提示「應收追蹤、B2B 月結」讀取失敗。

正式 API 驗證結果：

- `/ar/monitor` 在 90 天區間會成功，但需約 14.6 秒，舊前端 10 秒 timeout 會誤判失敗
- `/ar/b2b-statements` 原本未吃工作台日期範圍，會掃全歷史資料，正式環境約 11.9 秒後回 503

本地已修正：

- `frontend/src/services/ar.service.ts`：`/ar/monitor` 與 `/ar/b2b-statements` 讀取 timeout 調整為 60 秒
- `frontend/src/pages/AccountingWorkbenchPage.tsx`：B2B 月結查詢改傳入工作台目前的 `startDate`
- `backend/src/modules/ar/ar.controller.ts`：`GET /ar/b2b-statements` 新增 `startDate` query
- `backend/src/modules/ar/ar.service.ts`：B2B 月結查詢改用 `startDate` 到 `asOfDate` 的區間，不再每次掃全歷史

### J. 應收帳款頁無日期查詢造成正式站 CORS/503

2026-04-26 以已登入 headless Chrome 巡檢正式站主要頁面時，Dashboard、對帳中心、會計工作台、銀行、費用、員工、庫存與採購頁面沒有前端 runtime error；但 `/sales/invoices` 觸發 `/ar/monitor?entityId=tw-entity-001` 無日期範圍查詢，正式後端約 9.9 秒後回 503，瀏覽器呈現為 CORS / `net::ERR_FAILED`，導致使用者看到應收帳款頁資料載入失敗。

同一 API 帶 90 天區間可成功：

- `/ar/monitor?entityId=tw-entity-001&startDate=2026-01-26T16:00:00.000Z&endDate=2026-04-26T15:59:59.999Z`
- HTTP 200，約 7.1 秒
- items：1,751
- missingInvoiceCount：1,678

本地已修正：

- `frontend/src/pages/ArInvoicesPage.tsx`：應收帳款頁預設查詢最近 90 天
- 新增日期區間選擇器，讓使用者可縮短或調整查詢範圍
- 載入失敗時顯示明確警示與重試，不再只顯示空表格

### K. 薪資個人列表未綁員工資料時不應造成前端紅字

同一輪正式站巡檢中，`/payroll/runs` 的管理員薪資批次可載入，但個人薪資單列表會呼叫 `/payroll/my/runs`。目前登入帳號尚未綁定員工資料，後端回 `Current user is not linked to an employee record` 的 404；前端雖有提示，但瀏覽器 console 仍出現 404 錯誤。

這不是薪資路由缺失，而是列表查詢不應把「沒有個人員工綁定」視為系統錯誤。單張薪資單與 PDF 下載仍應保留權限/找不到的 404 行為。

本地已修正：

- `backend/src/modules/payroll/payroll.service.ts`：`getMyPayrollRuns` 找不到使用者對應員工時回傳空陣列
- `getMyPayrollRunById` 與 `getMyPayrollRunPdf` 保留原本保護，不讓未綁定使用者查特定薪資單

### L. 綠界銷項發票匯入必須選商店代號

會計工作台原本的「匯入綠界銷項發票」直接把所有匯入檔送到 `merchantId: 3150241` / `merchantKey: groupbuy-main`。這對 1Shop / 團購可以成立，但 MOZTECH Shopify 官網使用的是另一個綠界帳號 `3290494`；若 Shopify 官網的銷項發票也從同一按鈕直接匯入，會造成訂單發票回填與對帳歸屬混用。

本地已修正：

- `frontend/src/pages/AccountingWorkbenchPage.tsx`：銷項發票匯入改成 Modal，不再直接上傳
- 匯入前必須選擇 `3290494 · MOZTECH 官方網站 / Shopify` 或 `3150241 · 萬魔未來工學院 / 團購 / 1Shop`
- 系統依商店代號帶入 `shopify-main` 或 `groupbuy-main`，只在 `3150241` 匯入後補跑 1Shop 團購閉環
- Modal 明確區分「客戶訂單銷項發票」與「綠界服務費發票」，避免會計操作時把 AP 服務費發票與 SalesOrder 發票混在一起

### M. 正式環境不可用本地假字軌開立電子發票

`backend/src/modules/invoicing/invoicing.service.ts` 原本的 `issueInvoice` / `issueEligibleInvoices` 會用 `AA########` 隨機號碼建立 `Invoice`，但它沒有串綠界電子發票 API、沒有字軌管理、沒有隨機碼、也沒有取得綠界正式回應。若正式環境誤觸，會讓系統資料看起來像已開立正式發票，實際卻不是合法綠界發票。

本地已修正：

- 正式環境呼叫 `POST /invoicing/issue/:orderId` 或 `POST /invoicing/issue-eligible` 會回錯誤，提示需先接上綠界電子發票 API
- 只有 `NODE_ENV=test` 或明確設定 `ALLOW_LOCAL_INVOICE_STUB=true` 時，才允許使用本地 stub 供測試
- Dashboard 移除未使用的批次開票呼叫，避免未來 UI 誤接到這個尚未完成的正式開票流程

後續已接續修正：

- `backend/src/modules/invoicing/adapters/ecpay-einvoice.adapter.ts`：新增綠界電子發票 Adapter，統一處理 AES payload、正式開票 API 呼叫與回應解析。
- `backend/src/modules/invoicing/services/ecpay-einvoice-config.service.ts`：新增 merchant profile / readiness loader，優先讀 `ECPAY_EINVOICE_ACCOUNTS_JSON`，並向後相容 `ECPAY_INVOICE_MERCHANTS_JSON`、`ECPAY_MERCHANTS_JSON`。
- `GET /invoicing/readiness`：新增只讀 readiness API，可確認 `3290494` / `3150241` 是否具備 `merchantId`、`hashKey`、`hashIv`、issue/query/invalid/allowance URL。
- `frontend/src/pages/AccountingWorkbenchPage.tsx`：會計工作台新增綠界正式開票 readiness 提示，讓會計知道目前只能匯入銷項發票，還是已具備正式 API 開票條件。
- `backend/.env.example`：新增 `ECPAY_EINVOICE_ACCOUNTS_JSON` 範例，不寫入真實密鑰。

仍需使用者提供 / 確認：

- `3290494` 與 `3150241` 的綠界電子發票正式 `HashKey` / `HashIV` 是否已開通並放入 Secret Manager / Cloud Run env。
- 是否有 B2B API、字軌 / 配號查詢、作廢、折讓、折讓作廢的實際開通權限。
- 正式上線前需以綠界 stage 或小額測試單驗證 `Issue` / `GetIssue` / `Invalid` / `Allowance` 的回應欄位，再開啟批次開票入口。

## 建議收斂順序

### Sprint 1：入口與驗證基礎

- 統一正式入口為 Cloud Run
- 修正 Render 舊入口或下線舊入口
- 取得可用管理員登入方式
- 完成 authenticated Chrome UI 盤點
- 修正前後端 API 明確落差，例如 banking import endpoint

### Sprint 2：發票與對帳主線

- 實作綠界電子發票 Adapter
- 補訂單發票狀態回寫
- 補 1Shop 對 `3150241` matching
- 補對帳中心 unmatched 工作流

### Sprint 3：AR / AP / Journal 閉環

- 訂單自動建 AR
- 收款自動沖 AR
- AP 付款閉環
- Journal 自動落帳
- 退款、折讓、作廢反向分錄

### Sprint 4：庫存、採購與經銷前台

- SKU / 品牌 / 平台 mapping
- 即時可售庫存
- 預計到貨日
- 經銷商登入與下單
- B2B 帳期與月結對帳

### Sprint 5：廣告費與管理報表

- Meta / Google / TikTok 廣告費 connector
- 廣告費付款與發票 matching
- ROAS、毛利、現金流聯動
- CEO Dashboard 風險提醒

## 待使用者協助確認

- 可用的管理員帳號登入方式
- Codex/Terminal/Computer Use 權限目前已可操作 Chrome；後續仍要避免讓 agent 直接提交金流、刪除或高風險資料變更
- 目前正式入口是否確定為 Cloud Run，而不是 Render
- 綠界電子發票 API 權限、HashKey / HashIV、字軌設定是否已開通
- `3150241` 是否確定只給 1Shop / 團購 / 未來 Shopline 使用
- 各平台是否有 API、還是只能先用匯出報表
