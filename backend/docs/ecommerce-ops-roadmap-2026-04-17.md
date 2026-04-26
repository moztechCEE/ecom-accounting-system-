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
  - 說明：目前已驗證的綠界匯出檔 [NoEscrowStatistic_20260416182627.xls](/Users/moztecheason/Downloads/NoEscrowStatistic_20260416182627.xls) 全部來自這個商店代號，且平台名稱皆為 `綠界科技 Shopify`
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

### 2026-04-26 綠界電子發票 Adapter 接續

- 已新增 `ECPAY_EINVOICE_ACCOUNTS_JSON` 作為正式銷項電子發票帳號設定來源，明確分流：
  - `shopify-main` / `3290494`：MOZTECH Shopify 官方站
  - `groupbuy-main` / `3150241`：1Shop / 團購 / 未來 Shopline
- 已新增 `GET /invoicing/readiness`，可在不開立真實發票的情況下檢查每個帳號是否缺 `merchantId`、`hashKey`、`hashIv`、`issueUrl`、`queryUrl`、`invalidUrl`、`allowanceUrl`。
- 會計工作台會顯示綠界正式開票 readiness；若缺正式密鑰或 `ECPAY_EINVOICE_ISSUING_ENABLED` 尚未啟用，系統仍引導先用「綠界銷項發票匯入」回填訂單，避免本地假字軌或未測試 API 污染正式資料。
- `POST /invoicing/issue/:orderId` 已可依通路推斷 merchant key，Shopify 走 `shopify-main`，1Shop / Shopline 走 `groupbuy-main`；正式呼叫前會先檢查 profile readiness。
- `POST /invoicing/:invoiceId/void` 與 `POST /invoicing/:invoiceId/allowance` 已在正式環境擋住本地作廢 / 折讓，避免綠界未同步但內部狀態已變更。
- `GET /invoicing/:invoiceId/provider-status` 已新增只讀綠界狀態查詢，不會改資料，可用來比對內部 Invoice 與綠界後台狀態。
- `GET /invoicing/provider-status/readiness` 已新增只讀查詢欄位盤點，可找出缺發票日期或缺商店代號、因此無法向綠界查狀態的內部發票。
- 綠界狀態查詢會把匯入資料中的發票日期正規化為 `YYYY-MM-DD`，避免正式資料含時間造成 API 查詢不穩。
- 應收帳款頁已新增「查綠界」操作，讓會計可對單筆已開立發票做只讀狀態確認。
- 應收帳款頁已新增綠界查詢欄位盤點提示，依目前日期區間顯示哪些已開立發票還缺查詢必要欄位。
- 應收帳款頁已新增超收 / 重複收款風險提示；AR monitor 會標示 `paidAmount > grossAmount` 的訂單，避免重複匯入或合併收款未拆帳被誤判為正常已收。
- 已新增 `GET /ar/overpaid` 與應收帳款頁「查看超收明細」，可只讀展開付款列、payout batch、provider payment id、同金額重複群組與診斷文字；真正刪除 / 合併 / 沖銷 Payment 前仍需人工確認。

待補：

- 將真實 `HashKey` / `HashIV` 放入 Secret Manager / Cloud Run env，不寫入 repo。
- 用綠界 stage 或正式小額測試單驗證 `B2CInvoice/Issue`、`GetIssue`、`Invalid`、`Allowance`。
- 測試通過後才設定 `ECPAY_EINVOICE_ISSUING_ENABLED=true`。
- 補字軌 / 配號查詢與用量警示；目前 readiness 僅確認 API profile，不代表字軌用量充足。
- 補 B2B 發票專用流程、折讓作廢與 reversing journal。

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

- 已完成：先把 Shopline order 的 payment / delivery 狀態映射成 `Payment` 草稿紀錄
  - `syncOrders()` 現在會同步建立 / 更新 Payment 草稿，不必等獨立 transaction sync。
  - `settlementStatus=pending_payment / pending_payout / failed` 會寫入 Payment notes，供 Dashboard / 對帳中心判斷。
  - 未付款訂單只建立 0 元 Payment 草稿並保留 `expectedGross`，避免把待付款誤算成已收款；付款成功後才回填收款金額與淨額。
  - Shopline `payment_fee=0` 不再直接視為實際手續費；只有大於 0 才標記 `feeStatus=actual`，避免把缺漏手續費誤判為 0 元。
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

## 2026-04-21 最新 Hand-off：收斂後的唯一待辦清單

## 2026-04-22 歷史資料與逐筆核對確認

### 歷史資料 API 限制判斷

- Shopify：
  - Shopify Admin API 預設只能讀取最近 60 天訂單；若要拉更舊訂單，需要 app 具備 `read_all_orders`，並與 `read_orders` / `write_orders` 搭配。
  - 系統已有 `sync/backfill` 分窗格回補骨架；若 Shopify 舊資料拉不到，第一優先不是 Excel，而是先確認 Shopify app 是否已有 `read_all_orders`。
- 1Shop：
  - 目前沒有在程式或供應商回覆中看到「一年以上不可 API 拉取」的硬限制。
  - 系統已用 14 天安全窗格完成 2025 年回補；2024 年以前應先繼續用小窗格回補，若 API 回傳空窗或錯誤，再改採 Excel 匯入補洞。
- Shopline：
  - 一般 `GET /orders` 可處理近期 / 一般訂單。
  - Shopline 官方文件說明，已封存訂單或超過兩年以上訂單需使用 `POST /v1/orders/archived_orders`，該流程是非同步匯出，完成後用 webhook 提供下載連結。
  - 目前系統尚未實作 Shopline archived orders 匯入，所以若要補兩年以上 Shopline 歷史資料，需新增 archived export job + callback + CSV import。

### LINE Pay / 行動支付對帳判斷

- 原本系統沒有獨立的 `LINE Pay` provider import / payout reconciliation；2026-04-23 已開始補上 `provider=linepay` 匯入與交易查詢骨架。
- 綠界公開收款工具列出信用卡、Apple Pay、TWQR、超商代碼 / 條碼、ATM、無卡分期、微信支付等；Shopify 綠界安裝文件列出的 Shopify 付款方式也沒有 LINE Pay。
- 綠界 TWQR 由歐付寶 O'Pay 提供，訂單查詢與退款也需依歐付寶平台作業；這與 LINE Pay 直連不是同一條對帳鏈。
- 若綠界後台顯示 LINE Pay / 行動支付選項，需先確認它最後是否出現在綠界撥款對帳報表：
  - 有出現在綠界撥款 / 對帳報表：可先視為 `provider=ecpay`，付款方式標記 `gateway=line_pay` 或 `gateway=twqr_line_pay`。
  - 沒有出現在綠界撥款 / 對帳報表，而是 LINE Pay 後台獨立撥款：需新增 `provider=linepay`，不可混入綠界。
- 若公司未來直接開通 LINE Pay Merchant，LINE Pay 應視為獨立金流來源：
  - 訂單來源仍可來自 Shopify / 1Shop / Shopline。
  - Payment gateway 應標記為 `line_pay`。
  - 撥款、手續費、退款應從 LINE Pay 後台報表或 LINE Pay API 匯入。
  - 對帳中心需新增 `provider=linepay`，不可混入 `provider=ecpay`。
- 現在要向綠界 / LINE Pay 確認的資料：
  - LINE Pay 交易是否會出現在綠界「撥款對帳系統」或「金流對帳報表」。
  - 報表欄位是否有交易序號、商店訂單編號、付款方式、撥款日期、手續費、實收金額。
  - 若是 TWQR / O'Pay，是否能匯出逐筆撥款明細與服務費發票。
  - 若是 LINE Pay 直連，需提供 LINE Pay Merchant ID、報表格式、API 文件與手續費 / 撥款週期。

### 2026-04-23 LINE Pay / MOZTECH Shopify 設定

- 使用者提供的 LINE Pay profile 屬於 `墨子科技 MOZTECH / Shopify`：
  - 公司：`萬博創意科技有限公司`
  - 統編：`85030997`
  - LINE Pay Merchant ID：`TAP-85030997`
  - Channel ID：`1657050272`
  - Channel Secret：已由使用者提供，但不得寫入 repo，需放 Secret Manager。
- 系統分流原則：
  - 綠界 Shopify 官方站仍是 `shopify-main / 3290494`。
  - LINE Pay profile key 建議為 `moztech-shopify`，並標記 `sourceChannel=shopify`、`ecpayMerchantKey=shopify-main`。
  - 若 LINE Pay 交易出現在綠界 3290494 撥款報表，仍走 `provider=ecpay`，付款方式標記 `gateway=line_pay`。
  - 若 LINE Pay 獨立撥款，才走 `provider=linepay` 匯入 LINE Pay 結算報表。
- 已補後端能力：
  - `LINE_PAY_ACCOUNTS_JSON` profile loader。
  - `GET /api/v1/reconciliation/line-pay/config-status`。
  - `GET /api/v1/reconciliation/line-pay/payments?transactionId=...` / `?orderId=...`。
  - `POST /api/v1/reconciliation/payouts/import` 可接受 `provider=linepay`。
- 2026-04-23 已驗證使用者提供的 `TAP-85030997` 報表：
  - `TRANSACTION` 檔可確認付款 / 退款 / 付款方式，但不是撥款依據。
  - `CAPTURE` 檔有 `交易號碼`、`訂單號碼`、`請款日期`、`預計撥款日`、`支付總額`、`手續費`、`營業稅`、`手續費合計`、`預計撥款金額`，可作為 LINE Pay 直連核銷依據。
  - `CAPTURE` 2026-04-01 ~ 2026-04-23：323 筆，支付總額 `463,693`，手續費合計 `10,711.3083`，預計撥款金額 `452,981.6917`。
  - 系統已補 LINE Pay CAPTURE 中文欄位映射；會計工作台可匯入 CAPTURE 檔，逐列留下 matched / unmatched / invalid 結果。
  - 若 LINE Pay CAPTURE 出現負數列（退款 / 反向請款），系統會先用原始交易號、訂單號、退款金額與日期回找原收款；只有高信心單筆命中時才建立反向核銷分錄，找不到或疑似多筆命中會停在 `refund_unmatched` 人工核對。

### 2026-04-22 正式資料快照

- `reports/ecommerce-history` 全期間有效訂單：
  - 總營收：`38,508,500.13`
  - 訂單數：`27,133`
  - 已連結顧客數：`25,564`
  - 2024：`213` 筆 / `344,055.50`
  - 2025：`26,223` 筆 / `37,058,792.63`
  - 2026：`697` 筆 / `1,105,652`
- `dashboard-sales-overview` 2020-2026：
  - 總訂單數：`29,761`
  - 總收款紀錄：`28,640`
  - 已對帳 payment：`273`
  - 待撥款 / 未核銷 payment：`28,367`
  - Shopify 已對帳：`273 / 2,575`
  - 1Shop 兩帳號已對帳：`0 / 26,065`
- 最新 500 筆 `order-reconciliation-audit`：
  - 稽核 500 筆，異常 500 筆。
  - 已付款 497 筆，已對帳 2 筆。
  - 已開票 0 筆。
  - 發票問題 153 筆，稅額問題 500 筆。
- 最新訂單樣本顧客覆蓋：
  - 2024 樣本 163 筆：缺顧客 0，缺 email 0，缺 payment 0，缺發票號碼 163。
  - 2025 樣本 500 筆：缺顧客 0，缺 email 0，缺 payment 0，缺發票號碼 500。
  - 2026 樣本 500 筆：缺顧客 0，缺 email 0，缺 payment 2，缺發票號碼 500。

### 判斷

- 目前不能說「每一筆都有完成核對」；實際狀態是訂單與付款資料已大量進來，但大多仍停在待撥款 / 待核銷，尚未完成綠界撥款、手續費、發票、分錄閉環。
- 顧客資料在最新樣本中看起來有成功建立並連到訂單，但仍需新增全量 customer coverage API，才能百分之百確認所有歷史訂單都無缺顧客。
- 發票與稅額是目前最大缺口：發票號碼沒有落進 `Invoice` / `SalesOrder`，稅額欄位也尚未依內含稅規則正規化。

### 2026-04-22 已開始補上的系統能力

- 新增 `GET /api/v1/reports/data-completeness-audit`
  - 用途：一次檢查指定期間的訂單、顧客、Payment、發票、撥款匯入、銀行入帳與手續費缺口。
  - 可回答：
    - 全期間有幾筆訂單缺顧客。
    - 有幾筆訂單缺 Payment。
    - 有幾筆訂單缺發票。
    - Payment 有幾筆未核銷。
    - 綠界 / provider payout 匯入列 matched rate。
    - 手續費實際值覆蓋率。
    - 是否有 LINE Pay / TWQR LINE Pay 候選交易需要另開對帳來源。
  - 已接到會計工作台「資料完整度」雷達與分頁，會顯示阻塞自動對帳的缺口、各通路覆蓋率與下一步順序。
- 對帳中心「跑核心同步」已改為呼叫 `POST /api/v1/reconciliation/run`
  - 不再只跑 AR 與發票，而是走後端核心 Job：平台訂單、綠界撥款、AR、發票狀態、對帳中心重算。
  - 前端單次 Job timeout 已放寬到 180 秒，避免同步時間較長時被 10 秒預設 timeout 誤判失敗。
- 新增 Cloud Scheduler 專用入口 `POST /api/v1/reconciliation/run/auto`
  - 需帶 `x-sync-token`，由 `RECONCILIATION_SYNC_JOB_TOKEN` 驗證。
  - 與手動核心 Job 共用同一套 `runCoreReconciliationJob()`，避免手動與自動流程分岔。
  - Cloud Run / Cloud Scheduler 設定範例已補到 `docs/cloud-run-migration.md`。
- 新增 `POST /api/v1/reconciliation/clear-ready`
  - 保守自動核銷：只處理已收款、已有實際手續費、訂單與 Payment 金額一致、已有發票、尚未有 `reconciliation_payout` 分錄的 Payment。
  - 已支援多筆 Payment 判斷：同一訂單若拆成多筆付款，需確認所有成功 Payment 合計等於訂單金額，且每筆都有實際手續費來源，才允許逐筆核銷。
  - 部分收款會標記 `partial_payment_waiting_remaining`，不會提前沖銷整筆應收。
  - 若付款日期落在已關帳 / 鎖帳會計期間，會標記 `period_closed` / `period_locked` 並跳過，不會自動入帳。
  - 退款 / 取消訂單不會走一般自動核銷，會標記 `refund_or_cancelled_order_requires_reversal`。
  - 逐筆稽核已新增退款高風險訊號：
    - `refund_without_allowance_or_void_invoice`
    - `refund_after_reconciliation_needs_reversal`
    - `cancelled_order_has_payment`
  - 自動產生核銷分錄：
    - 借：銀行存款 `1113`
    - 借：平台手續費 `6131`
    - 借：金流手續費 `6134`
    - 貸：應收帳款 / 撥款清算 `1191`
  - 對帳中心已新增「核銷可核銷」按鈕。
  - 核心 Job 已預設帶 `autoClear=true`，同步後會自動嘗試核銷符合條件的款項。
- 新增 LINE Pay 狀態刷新與退款追蹤
  - `POST /api/v1/reconciliation/line-pay/refresh-status`
  - `POST /api/v1/reconciliation/line-pay/refresh-status/auto`
  - 核心對帳 Job 會一併刷新已匯入的 LINE Pay CAPTURE 交易狀態。
  - 已匯入 CAPTURE 的正向交易可作為實際手續費、營業稅、預計撥款日與淨入帳來源。
  - 若 LINE Pay API 或 CAPTURE 負數列顯示退款 / 取消，系統不會混入一般撥款核銷；會改走 `reconciliation_refund` 反向分錄流程。
  - 已補保守退款分錄：借記應收 / 撥款清算 `1191`，貸記銀行存款 `1113`、平台手續費 `6131`、金流手續費 `6134`，避免把原收入與退款互相抵掉後失去稽核軌跡。

### LINE Pay 自動對帳目前狀態

- 可做：
  - 匯入 LINE Pay CAPTURE 報表，取得每筆手續費、營業稅、預計撥款金額與預計撥款日。
  - 用交易號碼呼叫 LINE Pay Get Payment Details API 回查交易狀態。
  - 將疑似退款 / 取消交易轉入反向核銷流程；高信心對上原交易時會自動產生 `reconciliation_refund` 分錄。
  - 由核心對帳 Job 或 Cloud Scheduler 持續刷新近幾天交易狀態。
- 尚未能完全自動：
  - LINE Pay 目前沒有由系統主動列出所有結算 CAPTURE 的流程；仍需匯入 CAPTURE 報表，或等後續取得可拉取結算報表的正式 API。
  - 退款分錄已補保守版；仍需補折讓單 / 發票作廢與前端批次檢視。
  - 第二個 LINE Pay 帳號仍需補完整 Merchant ID、Channel ID、Channel Secret、品牌 / 通路歸屬。

### 建議排程

- 每小時：
  - 跑 `POST /api/v1/reconciliation/line-pay/refresh-status/auto`
  - 範圍抓最近 7 天，追蹤付款後退款、取消與狀態延遲。
- 每天凌晨：
  - 跑 `POST /api/v1/reconciliation/run/auto`
  - 同步 Shopify / 1Shop / Shopline、綠界撥款、LINE Pay 狀態、發票狀態，再嘗試保守核銷。
- 每月結帳前：
  - 匯入 LINE Pay CAPTURE / 綠界撥款 / 服務費發票。
  - 查看對帳中心的未匹配、退款待沖銷、發票缺漏與手續費缺漏。

### 使用者目前要做的外部確認清單

1. 綠界 / LINE Pay：
   - 匯出最近 1-3 個月綠界撥款或金流對帳報表。
   - 確認 LINE Pay / TWQR / 行動支付是否出現在綠界撥款報表內。
   - 若沒有出現在綠界報表，請提供 LINE Pay Merchant 後台報表或 API 文件。
2. Shopify：
   - 確認目前 Shopify app 是否具備 `read_all_orders`。
   - 若沒有，要申請 / 開通，否則 60 天以前訂單可能無法完整 API 回補。
3. 1Shop：
   - 確認 2024 年以前是否允許 API 匯出。
   - 若某段回補 API 回空，改提供平台匯出 Excel 作為補洞來源。
4. Shopline：
   - 提供正式 `access_token`、`User-Agent / handle code`、店鋪數量與 webhook 可用性。
   - 若要補兩年以上資料，要確認 archived orders 匯出流程可用。
5. 會計 / 發票：
   - 匯出綠界電子發票開立狀態與服務費發票。
   - 確認發票號碼、發票日期、發票金額、稅額是否能逐筆對回訂單。

### 目前已完成

- `對帳中心入口`：已新增 `/reconciliation`，側邊欄可直接進入。
- `對帳中心 API`：已新增 `GET /api/v1/reconciliation/center`，後端統一產生四個隊列：
  - `pending_payout` / 待撥款
  - `ready_to_clear` / 可核銷
  - `cleared` / 已核銷
  - `exceptions` / 異常
- `AR 分類模型`：已能依通路、付款方式、B2B 月結、團購、Shopline、貨到付款分類應收。
- `B2B 月結欄位`：`Customer` 已有付款條件、帳期天數、月結、對帳單 Email、追帳窗口、信用額度。
- `B2B 月結總覽`：已新增 `GET /api/v1/ar/b2b-statements`，會計工作台有 `B2B 月結` 分頁。
- `綠界服務費發票匯入 UI`：會計工作台已可匯入綠界服務費發票，建立 AP 並比對服務費金額。
- `1Shop 2025 歷史資料`：已回補 2025 年共 25,648 筆訂單 / 交易。
- `品牌與 Logo`：系統名稱已改為 `AI 電子商務營運中樞`，Logo / icon 已更新。

### P0：現在最該完成的核心

1. `對帳 Job / Reconciliation Run`
   - 狀態：部分完成
   - 目標：一鍵或每日自動跑完整對帳流程。
   - 已完成：
     - `POST /api/v1/reconciliation/run`
     - `POST /api/v1/reconciliation/run/auto`
     - 對帳中心按鈕已呼叫核心 Job。
     - 回傳本次處理結果與異常摘要。
     - 已補 `RECONCILIATION_SYNC_JOB_TOKEN` 設定範例與 Cloud Scheduler 指令。
   - 內容：
     - 同步 Shopify / 1Shop / Shopline 訂單。
     - 同步綠界撥款資料。
     - 同步電子發票狀態。
     - 回填手續費與淨入帳。
     - 重算 `/reconciliation/center` 四個隊列。
   - 未完成：
     - Shopline 正式憑證進來後納入核心 Job。
     - 多商店綠界撥款同步的完整 merchant profile 巡檢。
     - 實際在 GCP 建立 Cloud Scheduler job 並綁 Cloud Run URL / token。

2. `可核銷 -> 自動分錄 / 核銷`
   - 狀態：部分完成
   - 目標：當訂單、撥款、手續費、發票都對上時，自動產生或確認會計分錄。
   - 已完成：
     - `POST /api/v1/reconciliation/clear-ready`
     - 對帳中心「核銷可核銷」按鈕
     - 核心 Job 自動執行保守核銷
     - 多筆 Payment 合計核對
     - 部分收款保留在待補 / 待收
     - 已關帳 / 鎖帳期間阻擋自動入帳
     - 退款 / 取消訂單阻擋一般核銷
     - LINE Pay 負數退款列可高信心對回原交易時，會建立 `reconciliation_refund` 反向核銷分錄
     - 退款 / 折讓 / 作廢發票缺口進逐筆稽核異常
   - 分錄原則：
     - 借：銀行存款
     - 借：金流手續費 / 平台佣金 / 物流費
     - 貸：應收帳款
   - 未完成：
     - 退款折讓單 / 發票作廢批次規則。
     - 將核銷結果做成更完整的批次歷史頁。
     - 補上會計期間阻擋原因的前端細節呈現。

3. `綠界多商店撥款自動同步`
   - 狀態：部分完成
   - 已完成：Shopify 綠界 API 同步骨架、provider payout import、匯入批次。
   - 未完成：
     - `3290494` Shopify 官方站完整自動輪詢。
     - `3150241` 團購 / 1Shop / 未來 Shopline 完整自動輪詢。
     - 信用卡、超商取貨付款、貨到付款類型拆分。
   - 交付：
     - 多 merchant 設定檢查
     - sync result 寫入對帳中心

4. `手續費最終來源閉環`
   - 狀態：部分完成
   - 已完成：`Payment` 有 gateway/platform fee 欄位、feeStatus、綠界服務費 AP 匯入 UI。
   - 未完成：
     - 用綠界撥款列逐筆回填實際金流手續費。
     - 用綠界服務費發票驗證月度費用總額。
     - 平台費與金流費不可混用。
   - 交付：
     - 對帳中心可看到「實際手續費 / 預估 / 不可得」原因。

### P1：資料完整度

5. `1Shop 歷史資料回補`
   - 狀態：部分完成
   - 已完成：2025 全年。
   - 未完成：2024 年以前，需用 14 天或更小窗格。

6. `1Shop 發票狀態對應`
   - 狀態：未完成
   - 因電子發票透過綠界開立，需用綠界發票資料與 1Shop 訂單對應。

7. `Shopline 正式同步`
   - 狀態：部分完成 / 等待正式憑證驗證
   - 缺：
     - `access_token`
     - `User-Agent / handle code`
     - 多店資訊
     - webhook 是否可用
   - 已完成：
     - 訂單同步會建立 / 更新 `SalesOrder`。
     - 顧客同步會建立 / 更新 `Customer`。
     - 訂單同步同時建立 / 更新 `Payment` 草稿，讓 Shopline 訂單可進入待付款、待撥款、異常與核銷流程。
     - 未付款 Shopline 訂單不會灌入收款金額，仍會保留原訂單金額作為待收追蹤依據。
     - 手續費欄位只在 Shopline 明確回傳大於 0 時標記為實際值，否則保留待補，等平台金流報表或綠界撥款資料回填。

8. `B2B 月結對帳單`
   - 狀態：部分完成
   - 已完成：月結欄位、B2B statement summary。
   - 未完成：
     - 產生正式對帳單明細。
     - PDF / Email。
     - 收款後自動核銷 AR。

### P2：經營報表與 AI

9. `CEO Dashboard 重整`
   - 狀態：未完成
   - 方向：不再顯示最近流水帳；只顯示本月營收、實收、待撥款、異常、淨利、庫存、人事風險。
   - 資料來源：一律吃 `reconciliation center` 與 management summary。

10. `AI 主動提醒`
    - 狀態：未完成
    - 內容：
      - 每日高風險訂單
      - 待補發票
      - 手續費異常
      - 逾期未收
      - 綠界撥款延遲

11. `年度 / 季度 / 月度 / 週報`
    - 狀態：部分完成
    - 未完成：
      - 報表以已核銷資料作為可信來源。
      - 毛利、淨利、手續費、稅額全部依對帳結果回填。

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

## 2026-04-26 最新 Hand-off：交接給下一個 Context Window

### 本輪已完成的程式變更

最近已 push 到 `main` 的關鍵 commit：

- `5838f84c` `feat(reconciliation): add linepay closure pass`
- `8c6ea29a` `feat(workbench): auto-run closure after ecpay imports`
- `e7d08469` `feat(accounting): add ecpay payout and invoice import actions`
- `f252c02a` `feat(reconciliation): add closure pass script and scoped ar sync`
- `21478d09` `feat(sales): add refund journal closure flow`
- `4e534951` `feat(reconciliation): process line pay refund reversals`
- `eaa1dc59` `feat(workbench): add line pay status refresh action`

### 已落地功能

1. `1Shop + 綠界 3150241` 閉環補跑入口
   - API：
     - `POST /reconciliation/backfill/oneshop-groupbuy-closure`
   - 流程：
     - 補跑 1Shop 歷史訂單
     - 補跑綠界 `3150241` 撥款
     - 補跑 1Shop 團購發票狀態
     - scoped AR sync
     - auto clear
   - 前端：
     - `補跑 1Shop 團購閉環`

2. `綠界手動匯入` 入口
   - API：
     - `POST /reconciliation/payouts/import`
     - `POST /sales/orders/ecpay-issued-invoices/import`
   - 前端：
     - `匯入綠界撥款報表`
     - `匯入綠界銷項發票`
   - 補充：
     - 兩者匯入後會自動再跑一次 `1Shop 團購閉環補跑`

3. `LINE Pay` 狀態刷新 / 退款沖銷 / 閉環補跑
   - API：
     - `POST /reconciliation/line-pay/refresh-status`
     - `POST /reconciliation/line-pay/process-refund-reversals`
     - `POST /reconciliation/line-pay/closure-pass`
   - 前端：
     - `匯入 LINE Pay CAPTURE`
     - `刷新 LINE Pay 狀態`
     - `處理 LINE Pay 退款沖銷`
     - `補跑 LINE Pay 閉環`
   - 補充：
     - `匯入 LINE Pay CAPTURE` 後，會自動接著跑 `LINE Pay 閉環`

4. `退款正式分錄`
   - API：
     - `POST /sales/orders/:id/refund`
   - 已做：
     - 更新 `SalesOrder`
     - 更新 `Payment`
     - 更新 `AR Invoice`
     - 更新 `Invoice / InvoiceLog`
     - 建立退款分錄

5. `AR scoped sync`
   - 原本 `AR sync` 會吃整個 entity 歷史，造成 `1Shop 團購閉環` 易 `503`
   - 現在 `ArService.syncSalesReceivables(...)` 已支援：
     - `startDate`
     - `endDate`
     - `limit`
   - `1Shop 團購閉環` 會只同步指定期間的 AR

### 已確認的事實

1. `1Shop backfill` 本身可正常工作
   - 曾直接驗證 `2026-04-18 ~ 2026-04-24`
   - 成功回來：`fetched 146 / updated 146`

2. `3150241 綠界撥款 backfill` API 可正常工作
   - 先前測到的結果是指定期間 `0` 筆新撥款
   - 代表不是程式壞掉，而是該區間沒有新的可補資料

3. `LINE Pay refresh` 與 `LINE Pay refund reversal` 入口都已存在
   - 但是否真的有資料被成功反向核銷，要看匯入的 LINE Pay CAPTURE / payout line 內容

4. `1SHOP` 缺口曾出現以下狀態
   - `missingPayments` 已可降到 `0`
   - `missingInvoices` 曾從 `223` 降到 `152`
   - `feeMissingPayments` 曾升到 `425`
   - 這不是退步，而是更多 Payment 被建立後，真實暴露出「仍在等撥款 / 手續費回填」

### 真正還沒完成的部分

#### A. `1Shop + 綠界 3150241` 歷史缺口尚未實際補平

程式入口都已補好，但還沒完成「資料層面的最後驗證」：

1. 需要正式重跑一次：
   - `1Shop 團購閉環補跑`
   - 若有綠界撥款報表，再匯入 `綠界撥款報表`
   - 若有綠界銷項發票報表，再匯入 `綠界銷項發票`

2. 重跑後要驗證這三個數字是否下降：
   - `缺 Payment`
   - `缺發票`
   - `缺手續費`

3. 若 `缺發票` 仍高：
   - 代表 1Shop receipt 與綠界 issued invoice 報表仍不足以配對全部訂單
   - 要再查 `relateNumber / originalOrderNumber / oneShopOrderId / externalOrderId` 的實際格式

4. 若 `缺手續費` 仍高：
   - 代表 `3150241` 撥款資料本身還沒進來
   - 或匯入列中的對帳關鍵欄位不足以配回 Payment

#### B. `LINE Pay 退款 -> 反向核銷` 還沒做到最後驗證

現在有流程，但還沒完成這兩件事：

1. 用真實 LINE Pay CAPTURE / payout line 測一次：
   - `refund_pending_reversal`
   - `refund_reversed`
   - `refund_unmatched`
     的實際數量

2. 驗證退款後是否完整同步影響：
   - `Payment.notes`
   - `SalesOrder.status`
   - `AR Invoice`
   - `Invoice / InvoiceLog`
   - `JournalEntry`
   - `對帳中心 summary`

注意：

- `ProviderPayoutReconciliationService.processPendingLinePayRefundReversals(...)`
  現在是針對 `payoutImportLine.status = refund_pending_reversal`
  建立反向核銷分錄
- 但它不是直接呼叫 `SalesOrderService.applyRefund(...)`
- 這代表「金流退款反向核銷」與「訂單層退款」目前是兩條相鄰流程，不是完全同一條
- 下一個 context window 要決定：
  - 保持分開
  - 或把兩者再整合成同一個退款閉環

#### C. `發票 + 手續費 + AR` 還沒到最終閉環

目前還差：

1. 發票
   - 確認所有 1Shop / Shopify / Shopline / LINE Pay 關聯訂單
   - 都能在 `Invoice / SalesOrder / AR / 會計工作台 / 報表中心`
     一致看到同一份發票狀態

2. 手續費
   - 所有 Payment 要能明確落在：
     - `feeStatus=actual`
     - `feeStatus=estimated`
     - `feeStatus=unavailable`
   - 並且 `平台費` 與 `金流費` 不混用

3. AR
   - AR 已有骨架與 scoped sync
   - 但還沒做到「所有 relevant order 都已形成對應應收，且能隨付款 / 退款 / 發票狀態回寫」

#### D. `會計工作台 / 對帳中心` 角色收斂還沒完全做完

現在已經開始拆分，但仍未完全收斂：

- `對帳中心`
  - 應只看：
    - 訂單
    - 撥款
    - 手續費
    - 發票
      是否對上

- `會計工作台`
  - 應只看：
    - 缺什麼要補
    - 哪些待會計分錄
    - 哪些待月結 / 待追帳

還要繼續清：

- 重複卡片
- 重複指標
- 重複說明文字

### 下一個 Context Window 的建議執行順序

1. 先跑 `1Shop 團購閉環補跑`
   - 看 `postAudit.groupbuyChannel`
   - 記錄：
     - `missingPayments`
     - `missingInvoices`
     - `feeMissingPayments`

2. 若仍有大量 `缺發票 / 缺手續費`
   - 手動匯入：
     - `綠界撥款報表`
     - `綠界銷項發票`
   - 再觀察缺口是否下降

3. 再跑 `LINE Pay 閉環`
   - 確認：
     - `refundCandidateCount`
     - `reversedCount`
     - `unmatchedRefundCount`
   - 若有未匹配案例，抽樣查：
     - `providerPaymentId`
     - `originalProviderPaymentId`
     - `externalOrderId`

4. 再驗證 `Invoice + Fee + AR` 是否真正回寫到：
   - `會計工作台`
   - `對帳中心`
   - `報表中心`
   - `銷售訂單詳情`

5. 最後再繼續做 UI 角色收斂

### 交接注意事項

1. 本地目前是乾淨 worktree
2. 最新已 push 的 commit 是：
   - `5838f84c feat(reconciliation): add linepay closure pass`
3. 下一個 context window 不需要先修程式入口，優先做：
   - 實際補跑
   - 驗證缺口是否下降
   - 抽樣核對資料是否真的對上
