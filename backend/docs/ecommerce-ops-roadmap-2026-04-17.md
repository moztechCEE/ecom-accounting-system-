# E-Commerce Ops Roadmap & Shopline Integration Handoff - 2026-04-17

## 目標

把目前的 ERP / Dashboard / 對帳流程，升級成真正能俯視全公司營運的電商營運中台，涵蓋：

- 通路業績總覽：Shopify、1Shop、Shopline、其他通路
- 訂單 / 顧客 / 金流 / 撥款 / 發票 / 會計分錄的單一事實來源
- 自動對帳：顧客是否付款、平台是否撥款、實收淨額是否一致
- 營運總控台：CEO 可以直接看業績、支出、庫存、異常與待辦

## 目前已完成的底座

### 綠界帳號分流

- `3290494`
  - 用途：`MOZTECH 官方網站`
  - 對應通路：`Shopify`
  - 說明：目前已驗證的綠界匯出檔 [NoEscrowStatistic_20260416182627.xls](</Users/moztecheason/Downloads/NoEscrowStatistic_20260416182627.xls>) 全部來自這個商店代號，且平台名稱皆為 `綠界科技 Shopify`
- `3150241`
  - 用途：`團購`
  - 對應通路：`1Shop`，以及後續 `Shopline`
  - 說明：這個商店代號應獨立成第二條綠界對帳鏈，不可與 Shopify 官方站混用

補充：

- 綠界金流 / MPOS / 電子發票 / 物流 / 電子收據的憑證資訊已由使用者提供
- 基於安全性，憑證本身不寫入本文件，後續應存放於 `GCP Secret Manager`

### 通路整合

- Shopify：
  - 已可同步訂單與交易資料
  - 已有 Cloud Scheduler 自動輪詢
  - 已接綠界 Shopify 撥款查詢 API
- 1Shop：
  - 已支援雙帳號
  - 已同步訂單與收款資料
  - 已接 Dashboard 分通路顯示
  - 已有 Cloud Scheduler 自動輪詢

### 對帳 / Dashboard

- Dashboard 已支援：
  - Shopify 官網業績
  - 1Shop 各帳號業績
  - 總業績
  - 最近收款 / 撥款追蹤
  - CEO 視角的經營總覽
- 對帳資料流已具備：
  - `SalesOrder`
  - `Payment`
  - `Provider Payout Import`
  - 實際 / 預估 / 不可得手續費狀態
- 正在收斂為「多綠界帳號」架構：
  - 綠界帳號 A：Shopify 官方站
  - 綠界帳號 B：1Shop / 團購 / 未來 Shopline

### 可直接複用的技術骨架

- `ISalesChannelAdapter`
- `ShopifyHttpAdapter`
- `OneShopHttpAdapter`
- `SalesOrder` / `Payment` / `Customer` / `SalesChannel` 既有 schema
- `ReportsService` 的 dashboard bucket / reconciliation feed / executive overview

## 2026-04-21 進度更新

### 已完成

- Cloud Run backend 已升級至 `1Gi` 記憶體，避免歷史匯入與大型訂單查詢時被 512MiB 限制殺掉。
- 銷售訂單 API 已補上 `startDate` / `endDate` / `limit`，預設最多回傳 300 筆、硬上限 500 筆，避免前端一次載入所有歷史訂單與 payments / invoices / shipments 關聯資料。
- 銷售訂單前端已把「今天 / 過去 7 天 / 過去一個月 / 過去一年 / 自定義區間」真正傳給 API，不再只做前端篩選。
- backend 已部署至 Cloud Run revision `ecom-accounting-backend-00162-5br`。
- frontend 已部署至 Cloud Run revision `ecom-accounting-frontend-00022-bqx`。
- 1Shop 2025 歷史訂單 / 交易已用 14 天安全窗格補到 `2025-12-31`。

### 1Shop 2025 回補結果

- `2025-01-01` 到 `2025-01-30`：4,875 筆訂單 / 4,875 筆交易。
- `2025-01-31` 到 `2025-04-30`：9,491 筆訂單 / 9,491 筆交易。
- `2025-05-01` 到 `2025-05-14`：329 筆訂單 / 329 筆交易。
- `2025-05-15` 到 `2025-12-31`：10,953 筆訂單 / 10,953 筆交易。
- 2025 年目前合計：25,648 筆訂單 / 25,648 筆交易。

### 仍需接續

- 1Shop 2024 年以前歷史資料回補，需用同樣的 14 天窗格或更小窗格，避免單次資料量過大。
- 綠界 `3150241` / `3290494` 的服務費發票匯入、AP 入帳、Dashboard 警示需要正式串到前端與報表。
- 綠界金流手續費目前需確認來源：若 API 回傳不可得，需以綠界匯出 Excel / 服務費發票作為正式 fee import source，再與 `Payment` 逐筆對帳。
- 發票狀態需從 `SalesOrder` / `Invoice` 接進 AR、報表中心與 AI 待辦，讓未開票、待補發票、稅額異常能形成可追蹤任務。
- 銀行入帳與 AR 核銷已有 service/controller 骨架，下一步要補前端頁面與自動匹配結果呈現。

### 手續費來源與自動對帳判斷

- Shopify：
  - 平台交易費可優先從 Shopify transaction / payout 資料回填。
  - 若訂單是透過綠界收款，金流手續費仍以綠界撥款 / 對帳資料作為最終依據。
  - 系統應保留 `feePlatformOriginal` 與 `feeGatewayOriginal`，不可把平台費與金流費混在同一欄。
- 1Shop：
  - 目前 1Shop API V1 主要是訂單 / 交易匯出，是否含平台抽成需依 API 實際欄位確認。
  - 若 API 沒有平台費，系統不可猜測，應標記為 `feeStatus=unavailable` 或 `feeStatus=pending`。
  - 實際金流手續費以綠界撥款資料、服務費發票或匯出 Excel 回填。
- Shopline：
  - 第一階段先接訂單與顧客。
  - 平台費與金流費需等付款 / 撥款 API 或匯出報表確認欄位後，再納入自動核銷。
- 綠界：
  - 是金流撥款與實際手續費的最終核對來源。
  - 匯入成功後應回填 `Payment.amountNetOriginal`、`Payment.feeGatewayOriginal`、`Payment.feePlatformOriginal`、`Payment.reconciledFlag`，並自動產生分錄。

### 自動核銷目標狀態機

- `SalesOrder created`：建立營收事件與 1191 應收帳款。
- `Payment captured`：消費者已付款，但尚未確認綠界是否撥款。
- `Provider payout matched`：綠界撥款列與訂單 / 付款匹配成功，回填實際手續費與淨額。
- `Journal posted`：借 1113 銀行存款、6131 平台佣金、6134 金流手續費；貸 1191 應收帳款。
- `Invoice verified`：確認客戶發票已開立，綠界服務費發票已進 AP。
- `Closed`：訂單、款項、手續費、發票、分錄全部一致，才視為完成核銷。

### Dashboard UI 原則

- CEO Dashboard 不顯示「最近收款」與「最近對帳批次」流水帳。
- CEO Dashboard 只顯示高價值事件：總業績、實收淨額、應收未收、待撥款、手續費缺口、未開票、庫存警示、AI 風險提醒。
- 最近收款、撥款批次、未匹配列應移到「對帳中心 / 會計工作台」，讓會計處理細節，不佔用 CEO 首頁。

## 這次從 Shopline 官方文件確認到的事情

### 1. OpenAPI 訂單與顧客同步可直接做

Shopline OpenAPI 已提供：

- `GET /v1/orders`
- `GET /v1/customers`
- `GET /v1/token/info`
- Webhook 管理與 payload topic

這表示：

- 訂單資料可以先接進來
- 顧客資料也可以先接進來
- 不需要等會員授權登入功能才能做 ERP 同步

### 2. Shopline OpenAPI 的技術限制

- 需要先申請 OpenAPI 權限，並在後台開啟 `API Auth`
- API 使用 `Authorization: Bearer <access_token>`
- 必帶 `User-Agent` header，而且需使用店家 / handle 對應值
- API 時區以 UTC 為準
- 官方文件寫明標準速率限制為每秒 20 requests，超過會回 `429`

### 3. Orders / Customers 都支援增量同步

`Get Orders` 與 `Get Customers` 都支援：

- `updated_after`
- `updated_before`
- `per_page`
- `page`
- `previous_id`

其中 `previous_id` 是 cursor-based 分頁，官方也明示大量資料建議用這種方式避免 timeout。

### 4. Shopline 訂單同步不能只靠 updated_at

官方文件特別提醒：

- `order_delivery` 更新，不一定會更新 order 本身的 `updated_at`

這代表如果我們只靠 `updated_after` 輪詢訂單，可能漏掉配送狀態異動。  
因此正確做法是：

- 訂單主資料：用 OpenAPI polling
- 配送 / 付款狀態即時異動：搭配 webhook

### 5. Shopline 有「封存訂單」機制

官方文件提到：

- 超過一定條件或兩年以上的訂單，需改用 `Get Archived Orders`
- 部分封存單會在一般查詢回應中標示，或 `Get Order` 直接回 `410`

這代表我們後續要把 Shopline 歷史回補拆成兩種模式：

- 最近資料：`Get Orders`
- 舊資料 / 封存資料：`Get Archived Orders`

### 6. 顧客授權登入是另一條線，不等於顧客主檔同步

Shopline 提到的「顧客資料授權登入」是另一個功能：

- 需要聯繫線上顧問啟用
- 需要安裝 `Customer Login Authorization`
- 我方系統需支援 OAuth 2.0 與 OpenID
- 需要配置 Application ID / Secret / Redirect URL / Endpoint

這條功能的用途比較偏：

- 顧客用我們自己的會員系統資料登入 Shopline 商店

它不是 ERP 讀取顧客主檔所必需的前置條件。  
所以在這次專案裡，應拆成：

- 第一階段：先做 Shopline 訂單 / 顧客同步
- 第二階段：如果真的要做 SSO / 顧客授權登入，再獨立立項

## 我建議的實作排程

### Phase 1：資料模型收斂與專案底稿

目標：

- 固定「訂單 -> 收款 -> 撥款 -> 發票 -> 會計 -> Dashboard」主鏈
- 明確定義每個平台的狀態對應與欄位映射

交付：

- 平台狀態映射表
- 對帳狀態機
- 通路欄位映射文件

### Phase 2：Shopline 訂單 / 顧客同步

目標：

- 把 Shopline 當成第三個正式電商通路接進來

實作項目：

- `backend/src/modules/integration/shopline/`
- `ShoplineHttpAdapter`
- `ShoplineService`
- `ShoplineController`
- 同步 `SalesOrder`
- 同步 `Customer`
- Dashboard 納入 `SHOPLINE` bucket

建議同步順序：

1. `testConnection()` + `token/info`
2. `syncOrders()`
3. `syncCustomers()`
4. `autoSync()` + Cloud Scheduler
5. webhook 訂閱

### Phase 3：Shopline 金流 / 對帳接軌

目標：

- 讓 Shopline 訂單也能進到既有的收款 / 撥款 / 對帳流

實作項目：

- 先把 Shopline order 的 payment / delivery 狀態映射成 `Payment` 草稿紀錄
- 若 Shopline 有外部金流報表或 API，再接 provider payout import
- 將 `已付款 / 待撥款 / 已撥款 / 已對帳` 進 Dashboard

### Phase 4：CEO 總控台

目標：   

- 把營運指標集中成單一總覽頁

實作項目：

- 業績：Shopify / 1Shop / Shopline / Other / Total
- 支出：已支出 / 待審 / 已核准待付款
- 對帳：待付款 / 待撥款 / 未入帳 / 未開票
- 庫存：低庫存 / 缺貨
- 人事：出勤異常 / 待審假單 / 薪資批次狀態
- AI：自動生成重點提醒

## 下一段實作的建議順序

### Sprint A：Shopline 最小可用版

1. 新增 `SHOPLINE` integration module
2. 實作 `GET /token/info`
3. 實作 `syncOrders`
4. 實作 `syncCustomers`
5. Dashboard 顯示 `SHOPLINE` 業績

### Sprint B：Shopline 自動同步

1. 建立 scheduler endpoint
2. 建立 Cloud Scheduler job
3. 新增 webhook endpoint
4. 訂閱：
   - `order/create`
   - `order/update`
   - `order_delivery/update`
   - `order_payment/update`
   - `order_payment/complete`
   - `user/create`
   - `user/update`

### Sprint C：對帳深化

1. Shopline 訂單 payment status 對應 `Payment`
2. 撥款 / 入帳匯入
3. 自動比對手續費與淨額
4. 未撥款 / 差額 / 異常工作台

### Sprint D：應收分類與追帳模型

目標：

- 讓系統不只是「看到訂單」，而是能把訂單自動放進可追帳、可核銷、可出報表的應收分類。

已落地的分類：

- `B2C 平台應收`：Shopify、Shopline、其他電商平台的一般消費者訂單。
- `B2C 貨到付款應收`：貨到付款、超商取貨付款，先列為在途應收，等綠界物流代收款或撥款資料回填後核銷。
- `團購 / 1Shop 應收`：萬魔未來工學院、團購案、1Shop 帳號分開追蹤。
- `Shopline 應收`：先按 Shopline + 付款方式分類，後續再依店鋪 token 拆多店。
- `B2B 月結應收`：公司客戶、`paymentTerm=net30`、`monthlyBilling=true` 這類資料會按客戶拆帳追收。

付款方式分組：

- 信用卡：等綠界金流撥款明細確認實際手續費與淨入帳。
- 超商取貨付款 / 貨到付款：等綠界物流代收與撥款資料回填。
- 銀行匯款 / 月結：按客戶應收與到期日追蹤。
- ATM / 其他金流：先進待確認，再靠撥款或銀行流水核銷。

會計處理原則：

- 訂單成立且應收可認列：借記應收帳款，貸記銷貨收入與銷項稅額。
- 消費者付款但尚未撥款：仍視為在途應收，不直接認列銀行存款。
- 綠界撥款或平台結算入帳：借記銀行存款與手續費，貸記應收帳款。
- 發票已開但未入帳：留在異常待辦，提醒補分錄或確認收款狀態。
- 手續費待補：不亂估為實際成本，標記待補，等綠界/平台撥款或服務費發票回填。

B2B 月結下一步：

1. 在 `Customer` 補正式欄位：付款條件、月結天數、對帳窗口、主要收款窗口。
2. 產生客戶月結對帳單。
3. 按客戶聚合未收款、逾期款、部分收款。
4. 收款後自動核銷 AR，差額進異常待辦。

## 目前已知 blocker

要正式開始做 Shopline，我們還缺這些資料：

1. Shopline `access_token`
2. Shopline `User-Agent / handle code`
3. Shopline 是單店還是多店
4. 是否已開通 webhook
5. 是否有可提供的金流 / 撥款資料來源

如果只先做訂單與顧客同步，實際 blocker 只有前 2 項。

## 我對這個專案的建議

不要再按單點功能補丁方式前進。  
從現在開始，所有新通路都用同一個方法落地：

1. 先接 `Adapter`
2. 再接 `SalesOrder / Customer / Payment`
3. 再接 `Payout / Reconciliation`
4. 最後進 Dashboard / CEO 視角

這樣之後你們就算再加：

- Momo
- 蝦皮
- Amazon
- TTShop

也都能沿用同一條資料鏈。

## 官方參考

- SHOPLINE OpenAPI - Get Token Info:
  - https://open-api.docs.shoplineapp.com/docs/get-token-info
- SHOPLINE OpenAPI - How to get access_token:
  - https://open-api.docs.shoplineapp.com/docs/getting-started
- SHOPLINE OpenAPI - OpenAPI request example:
  - https://open-api.docs.shoplineapp.com/docs/openapi-request-example
- SHOPLINE OpenAPI - Get Orders:
  - https://open-api.docs.shoplineapp.com/docs/get-orders
- SHOPLINE OpenAPI - Get Customers:
  - https://open-api.docs.shoplineapp.com/docs/get-customers
- SHOPLINE OpenAPI - Webhook Topic and Payload Examples:
  - https://open-api.docs.shoplineapp.com/docs/webhook-topic-and-payload-examples
- SHOPLINE Help Center - Customer Login Authorization:
  - https://support.shoplineapp.com/hc/en-us/articles/4472120733337-Customer-Login-Authorization
- 綠界 Support - 金物流代收結算及撥款:
  - https://support.ecpay.com.tw/4809/
- 綠界 Support - 綠界開立請款發票 / 手續費發票:
  - https://support.ecpay.com.tw/8753/
- 綠界 Support - 申請綠界物流及金流:
  - https://support.ecpay.com.tw/26036/
