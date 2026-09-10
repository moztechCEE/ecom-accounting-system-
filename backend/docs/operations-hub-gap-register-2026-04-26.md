# 營運中樞缺口清單 - 2026-04-26

這份文件用來記錄 MOZTECH / BONSON 營運中樞目前不能忘記的缺口。目標不是單純列功能，而是把「公司真正需要的營運閉環」和「系統目前還缺什麼」固定下來，避免後續只做零散頁面。

## 本輪實際驗證範圍

- ERP 正式入口：`https://erp.corely.cc`
- ERP 正式 API：`https://api.erp.corely.cc/api/v1`
- Cloud Run 原生網址只保留作候選版本驗證與故障排查，不作為日常對外入口
- Cloud Run backend Swagger 可達：`/api-docs`
- Render frontend 仍可載入登入頁，但 `/config.js` 是空設定
- Render backend 回應 `Service Suspended`，不可作為正式驗證入口
- 本機 `localhost:5173` 與 `localhost:3000` 本輪沒有服務在跑
- Google Chrome / Codex / Codex Computer Use 的 macOS Accessibility 權限後續已開通；但 2026-05-06 再測時 `Computer Use get_app_state` 對 Chrome / Safari 回 `cgWindowNotFound`，對 Atlas / VS Code 逾時。`list_apps` 可讀取應用清單，`osascript` 顯示 Chrome 視窗數為 0、Atlas 視窗數為 1；目前較像桌面擷取層抓不到可控制視窗，不是發票串接程式阻塞。
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

2026-05-04 更新：

- `3150241` / `groupbuy-main` 的綠界電子發票金鑰已放入 GCP Secret Manager，並掛到 Cloud Run backend；readiness 已可讓 1Shop / 團購發票 profile 進入 ready 狀態。
- 正式開票開關仍維持關閉，避免未完成小額測試前發生真實開票。
- 後端已新增只讀綠界查詢 API：多筆發票清單 `B2CInvoice/GetIssueList` 與財政部字軌配號 `B2CInvoice/GetGovInvoiceWordSetting`。
- Cloud Run 已驗證 `groupbuy-main` 只讀查詢成功：`2026-05-01` 到 `2026-05-04` 多筆發票查詢總筆數 120、樣本回傳 5 筆；民國 115 年字軌配號查詢回傳 3 組。
- `3290494` / `shopify-main` 的電子發票金鑰已放入 GCP Secret Manager，並掛到 Cloud Run backend；readiness 已可讓 Shopify 官方站發票 profile 進入 ready 狀態。
- Cloud Run 已驗證 `shopify-main` 只讀查詢成功：`2026-05-01` 到 `2026-05-04` 多筆發票查詢總筆數 142、樣本回傳 5 筆；民國 115 年字軌配號查詢回傳 3 組。

2026-05-06 再驗證：

- `GET /invoicing/readiness` 顯示 `shopify-main` / `groupbuy-main` 兩個 profile 都 ready，`ECPAY_EINVOICE_ISSUING_ENABLED=false`，因此仍不可正式自動開票。
- `GET /invoicing/provider-status/readiness?limit=10` 掃描 10 筆內部發票，10 筆都具備綠界狀態查詢必要欄位。
- `GET /invoicing/ecpay/invoices` 只讀查詢成功：`groupbuy-main` 在 `2026-05-01` 到 `2026-05-06` 查到 148 筆，`shopify-main` 查到 155 筆。
- `GET /invoicing/ecpay/word-settings` 需使用民國年三碼，例如 `115`；兩個 profile 的民國 115 年字軌配號查詢都成功，回傳 3 組。

2026-05-06 串接與回寫更新：

- 新增 `POST /invoicing/ecpay/invoices/sync-to-orders`，會從雙綠界帳號只讀拉取已開立發票清單，並回填 `Invoice` / `SalesOrder`。此流程只做查詢與回寫，不會開立、作廢或折讓真實發票。
- Shopify 訂單同步已補上 `shopifyOrderName=#xxxxx` / `shopifyOrderNumber=xxxxx` metadata，避免綠界 `IIS_Relate_Number` 使用 Shopify 顯示訂單號時無法匹配。
- 綠界發票匹配邏輯已支援 Shopify `#訂單號` 與不含 `#` 的訂單號。
- Cloud Run backend 已部署至 revision `ecom-accounting-backend-00307-99p`。
- 實測 `2026-05-01` 到 `2026-05-06`：雙帳號共抓 303 張發票；dry-run 可匹配 91 張，其中 `groupbuy-main / 3150241` 匹配 31 張、`shopify-main / 3290494` 匹配 60 張。
- 已正式寫入同區間匹配結果：新增 60 張 Shopify 綠界發票、更新 31 張團購 / 1Shop 綠界發票；未匹配仍有 212 張。
- `GET /reports/data-completeness-audit?entityId=tw-entity-001&startDate=2026-05-01&endDate=2026-05-06` 回傳：orders 311、payments 384、invoices 91、missingInvoiceOrders 283、invoiceLinkedRate 9%。注意此稽核用訂單日期作口徑，而發票同步用發票日期作口徑，因此 5 月開立但對到更早訂單的發票不會全部拉高該訂單日期區間的覆蓋率。
- 90 天一次同步曾遇到 upstream timeout；後續需要改為背景工作、分段同步或增量排程，避免前端長區間按鈕等待過久。

2026-05-07 未匹配原因拆解與修正：

- 真因之一不是綠界少資料，而是 1Shop 發票關聯號會出現 `DI...a...` 後綴；原本匹配邏輯只吃完整關聯號，沒有拆回 1Shop 原始訂單號。
- 已更新 `SalesOrderService`：綠界發票關聯號匹配會同時嘗試原值、去 `#`、去 1Shop `a...` 後綴與兩者組合，並讓未匹配結果回傳 `reasonCode` / 中文原因 / 候選訂單摘要。
- Cloud Run backend 已部署至 revision `ecom-accounting-backend-00309-vd9`。
- 修正後 dry-run 驗證 `2026-05-01` 到 `2026-05-06`：雙帳號共抓 303 張發票；可匹配由 91 張提升到 201 張，未匹配由 212 張降到 102 張。
- 已正式寫入修正後可匹配結果：新增 110 張 `Invoice`、更新 91 張既有 `Invoice`；其中 `groupbuy-main / 3150241` 匹配 138 張、剩 10 張未匹配，`shopify-main / 3290494` 匹配 63 張、剩 92 張未匹配。
- 剩餘 102 張分類：
  - `groupbuy-main` 10 張為 `manual_or_batch_invoice_mapping_required`：關聯號像 `20260505U009` / `20260506-18`，不是目前系統可辨識訂單號；需要綠界或 1Shop 的手開 / 批次發票對應表，或補上上游訂單來源。
  - `shopify-main` 87 張為 `shopify_order_not_synced`：關聯號是 Shopify 顯示訂單號（例如 `#148675`），但系統找不到對應 Shopify 訂單；下一步需確認 Shopify app 是否具備 `read_all_orders`，並跑更長區間的 Shopify 歷史訂單回補。
  - `shopify-main` 5 張為 `channel_mismatch`：資料庫有疑似候選，但通路不是 Shopify；目前保守不自動配，需確認是否為數字碰撞、手動單或帳號 mapping 錯置。
- `GET /reports/data-completeness-audit?entityId=tw-entity-001&startDate=2026-05-01&endDate=2026-05-06` 仍顯示 `missingInvoiceOrders=283`，原因是該稽核用訂單日期口徑；本次回填的發票多數對到較早訂單，因此不會等比例反映在 5/1-5/6 訂單日期區間。

必補能力：

- B2C / B2B 開立的小額測試與正式啟用流程
- 發票狀態查詢結果回寫與異常隊列
- 作廢
- 折讓
- 折讓作廢
- 字軌 / 配號查詢結果的前端呈現與用量警示
- 綠界正式發票號碼、日期、隨機碼、外部 ID 回寫 `Invoice` 與 `SalesOrder`
- 發票狀態要同步顯示在銷售訂單、AR、Dashboard、會計工作台
- 已開立發票清單的長區間同步需要改成 job / queue / incremental cursor，不能只靠單次 HTTP request。

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

2026-05-07 連線與核銷狀態再確認：

- `GET /integrations/1shop/health` live 回傳 `Connection successful`，代表 1Shop API 本身可連。
- `GET /integrations/1shop/summary?entityId=tw-entity-001` live 顯示 `orders.count=26352`、`payouts.paymentCount=26846`，但 `platformFeeStatus=unavailable`、`reconciledCount=0`。
- `GET /reports/connector-readiness` 原本把 1Shop 標為 `blocked`，原因是誤把 `ONESHOP_API_BASE_URL` 當必填；實際 1Shop adapter 內建預設 API host，且 live health 已成功。已把 `ONESHOP_API_BASE_URL` 改為 optional readiness 欄位，避免前端誤判 1Shop 尚未設定。
- 2026-05-08 已部署至 Cloud Run revision `ecom-accounting-backend-00322-ww8` 並重測：`GET /reports/connector-readiness?entityId=tw-entity-001` 顯示 8 個 connector 全部為 `partial`、`blocked=0`；1Shop 不再被誤標為 blocked。
- 判斷：1Shop 訂單與付款草稿已大量進系統，但還沒有完成「綠界實際撥款 / 手續費 / 銀行入帳」三方核銷。不可把目前的 1Shop 狀態說成已完成對帳。
- 下一步：先補 `3150241` 綠界金流撥款 / 手續費來源，再讓 1Shop Payment draft 對到 provider payout row；最後才可進入銀行入帳與 AR clear。

必補能力：

- 1Shop 歷史訂單完整回補
- 1Shop 訂單對 `3150241` 綠界撥款 matching
- 1Shop 訂單對綠界電子發票狀態核對
- 團購手續費不可猜測，必須以綠界撥款、服務費發票或匯出報表為準
- 1Shop 未匹配工作台
- `3150241` 和 `3290494` 不可混用同一條對帳鏈

### 3-1. 綠界非發票服務也要納入營運中樞範圍

2026-05-04 更新：使用者確認兩個綠界帳號都有金流 / MPOS、電子發票、物流、電子收據的介接資訊。電子發票已先完成 secrets 與只讀查詢；其餘 service 仍需排進後續 connector。

必補能力：

- 金流：雙帳號付款、撥款、退款、實際手續費與銀行入帳核銷。
- 物流：綠界物流、超商取貨付款、貨到付款、物流費、代收款與出貨狀態回填。
- 電子收據：確認是否有非發票收據 / 憑證場景；不可與電子發票混用。
- MPOS：實體、展場、快閃、電話刷卡或現場刷卡收款，需獨立標記通路 / 據點 / 活動，並回到同一套 Payment / payout / bank reconciliation。
- Secret 管理：金流、物流、電子收據、MPOS 後續若接 API，應各自放 Secret Manager 或 service profile，不可把金鑰寫入 repo 或文件。

2026-08-28 雙帳號撥款 API 盤點與底層修正：

- 綠界後台唯讀確認 `3150241` 為團購 / 1Shop，`3290494` 為萬博創意科技加開商代；兩者都已將 Cloud Run 固定出口 `104.199.246.28` 加入允許 IP，且該 IP 仍由正式 GCP 專案的 Cloud NAT 使用。
- 依撥款入帳日期查詢 `2026-07-28` 至 `2026-08-28`：`3150241` 共 357 筆、交易 495,150 元、服務費 9,893 元、淨撥 485,257 元；`3290494` 共 126 筆、交易 155,763 元、服務費 3,156 元、淨撥 152,607 元。
- 問題不在綠界缺資料，而是 profile 名稱被誤當成協定來源：`3290494` 的 Shopify 專用 API 可連線但同區間回 0 筆；兩個帳號呼叫新版 AES `QueryTradeMedia` 都回 `128 System exception`。
- 介接頁實際提供的是既有特店 `PaymentMedia/TradeNoAio` 文件。`EcpayShopifyPayoutService` 已新增明確 `apiKind=trade-media|general|shopify`，由帳號實際開通協定決定，不再依 profile 名稱推測。
- 新增 `POST /reconciliation/payouts/ecpay/preview`：只讀取、正規化、加總與回傳樣本，不寫入 Payment、匯入批次或會計分錄。
- 修正欄位語意：一般綠界支援特店交易編號、金流 / 平台 / 處理費與應收淨額；Trade Media V3 以交易金額減退款及應收淨額反推總費用，避免手續費、處理費、交易手續費與平台手續費重複計算；Shopify 的「手續費」視為含處理費總額；負數退刷費用不再被當成 0。
- Trade Media V3 的未加引號儲存格會以 `=790` 形式傳輸；共用 CSV 清理層已統一移除 `=` 包裝，避免金額全被解析為空值，也避免訂單編號保留多餘前綴。
- `TradeNoAio` 不保證包含全部信用卡退款；系統會再查 `CreditDetail/FundingReconDetail`，只合併主媒體檔未出現的負數退款。`3150241` 同區間信用卡補檔有 5 筆退款；`3290494` 有 6 筆，其中預期 2 筆已存在主媒體檔，最終仍以 357 / 126 筆及後台總額作驗收。
- 日期切片改為連續最多一個月，不再因跨自然月把 `7/28~8/28` 拆成兩個即時 API 呼叫。
- 驗證：官方 SHA-256 CheckMacValue 範例、Trade Media 表單、三種費用語意及既有對帳邏輯共 8/8 測試通過；前一版 `npm run build` 通過，Trade Media 版待重新建置與 Cloud Run 唯讀查核。
- 尚未啟用正式匯入：必須先以 Cloud Run preview 對照同區間後台總額，並完成 provider payout 與 bank reconciliation 狀態分離。

2026-09-01 Shopline 排程責任與同步健康修正：

- 正式 Cloud Scheduler 連續回傳 `401`，但同分鐘 Cloud Run 內建 `@Cron` 仍完成訂單 / 顧客同步。根因是 Shopline 同時存在 Cloud Scheduler 與 application cron 兩個固定觸發來源，而且 Scheduler header 與目前 Cloud Run 使用的同步 Secret 失配；不能把 application log 的成功當成 Cloud Scheduler 健康。
- 已將 Shopline 固定輪詢收斂為單一 Cloud Scheduler，移除 service 內每 20 分鐘的重複 `@Cron`。Webhook 仍可觸發增量回刷，但與 Scheduler 共用同一個資料庫租約。
- 新增 `ConnectorSyncState`：以 `entityId + connector` 唯一列原子取得有期限的執行租約，避免 Cloud Run 多 instance、Scheduler、Webhook 或人工重跑同時打上游；只有同一個 lock token 能寫回成功或失敗，舊 worker 不會誤解除新 worker 的鎖。
- `GET /reports/connector-readiness` 會回傳 connector 最近開始、完成、成功、失敗、錯誤與精簡 metrics；會計工作台直接標示同步正常、同步中、同步失敗、同步逾時或尚無紀錄，不再只顯示「憑證有設定」。
- Scheduler token 對齊既有 Secret 後，原本的 `401` 已排除，並暴露第二個底層問題：Scheduler 沒有 request body 時 controller 直接讀 `body.entityId` 造成 `500`。Controller 已改成接受空 body 並使用 default entity，不要求排程傳入假欄位。
- 本機驗證：Prisma schema validate / generate、backend build、22 suites / 79 tests、frontend production build 均通過。正式 migration、candidate revision、Scheduler 2xx 與登入後 UI smoke 仍是獨立發布 gate。

### 4. Dashboard 還不是完整總控台

Dashboard 最終不應只是展示業績，而是要主動揭露營運風險。

2026-05-11 銷售儀錶板區間修正：

- 使用者發現「過去 7 天 / 過去一個月 / 過去一年」顯示的總營收、平均客單與圖表看起來相同。
- 實際排查結果：正式後端 `GET /reports/ecommerce-history` 會依日期區間回傳不同資料；2026-05-11 驗證 `過去 7 天`、`過去一個月`、`過去一年` 分別回傳不同 revenue / orderCount。
- 真正問題在前端：銷售訂單頁為了效能只抓 `limit=300` 筆明細，但儀錶板卡片與趨勢圖也拿這 300 筆去重算，因此大區間會被「最新 300 筆」限制住。
- 已修正 `SalesAnalytics`：總營收、訂單數、平均客單與趨勢圖優先使用 `ecommerceHistory.summary` / `ecommerceHistory.periods`，訂單列表仍維持 300 筆作為明細預覽。
- 品牌歸屬也同步抽成後端可設定規則：`COMMERCE_SOURCE_BRANDS_JSON` / `SALES_CHANNEL_BRANDS_JSON` 可依 Shopify / Shopline 帳號、handle、domain 指定品牌與顯示名稱。現行正式規則為 Shopify = MOZTECH、Shopline = BONSON；未來若新增 MORITEK 的 Shopify / Shopline 帳號，只需新增對應 rule，不需要改程式。

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

2026-05-08 Meta Ads connector 更新：

- 已新增 Meta Ads 後端 connector，不會把 token 寫入 repo：
  - `GET /integrations/meta-ads/connection-info`
  - `GET /integrations/meta-ads/readiness`
  - `GET /integrations/meta-ads/ad-accounts`
  - `GET /integrations/meta-ads/insights`
  - `POST /integrations/meta-ads/sync`
  - `POST /integrations/meta-ads/sync/auto`
- `readiness` 會檢查 `META_ADS_ACCESS_TOKEN` 是否設定，並嘗試讀取可用 ad accounts。
- `insights` 會從 Meta Marketing API 讀取 daily spend，可用 `account` 或 `campaign` level 預覽。
- `sync` 會把 daily account spend 寫入 `Expense / ExpenseItem`，`sourceModule=meta_ads`、科目代號 `6118 廣告費`，讓 CEO Dashboard 的廣告花費可以吃到 API 匯入資料。
- `reports/connector-readiness` 的 `ad-spend` 已改為會檢查 `META_ADS_ACCESS_TOKEN`，並顯示 `META_ADS_ACCOUNT_IDS` / `META_ADS_ACCOUNTS_JSON` / `META_ADS_SYNC_ENABLED` 等設定狀態。
- Meta token 已由使用者用隱藏輸入放入 Secret Manager `META_ADS_ACCESS_TOKEN`，並掛到 Cloud Run backend revision `ecom-accounting-backend-00339-7j8`。
- 部署時曾因 Cloud Run runtime service account `ecom-accounting-rt@moztech-main-db.iam.gserviceaccount.com` 沒有讀取新 Secret 的權限而失敗；已在 Secret 層級授予 `roles/secretmanager.secretAccessor`，不需開整個 project 層級權限。
- 2026-05-08 已依 Meta Ads Manager 截圖加入廣告帳戶 mapping，並部署到 Cloud Run backend；後續依營運歸屬修正 bonson 帳戶為 BONSON：
  - `act_412541399921576`：bonson / Ads Manager selected account，歸入 BONSON / TW。
  - `act_1375134063493419`：MOZTECH US，歸入 MOZTECH / US。
  - `act_1010503451002666`：MOZTECH US shopify，歸入 MOZTECH / US。
  - `act_938172323581797`：MOZTECH 墨子科技，歸入 MOZTECH / TW。
- `backend/scripts/configure-meta-ads-secrets.sh` 已補強：新增或更新 token 版本後，會自動把 Cloud Run runtime service account 加到該 Secret 的 `roles/secretmanager.secretAccessor`，避免之後重複部署失敗。
- 已用正式 Cloud Run backend 驗證 `GET /integrations/meta-ads/readiness`：`ready=true`、`configuredAccountCount=4`、`readableAccountCount=17`。
- 已正式同步 `2026-01-01` 到 `2026-05-08` 的 Meta daily spend，寫入 `Expense / ExpenseItem` 共 256 筆，`sourceModule=meta_ads`。
- 2026-05-08 進一步追溯測試：Meta API 回覆最早只能查近 37 個月，因此以目前日期可回填到 `2023-04-08`；已同步 `2023-04-08` 到 `2026-05-08`，共 `2087` 筆非零 spend，每日資料已進 `Expense / ExpenseItem`，區間合計約 `NT$41,593,881`。
- 已新增 `GET /reports/ad-performance-summary`，用 Meta daily spend + Shopify 訂單品牌營收產出會計口徑 blended ROAS。正式 Cloud Run 已驗證 `2026-01-01` 到 `2026-05-08` 可回 `adSpend=NT$3,403,986`、Shopify revenue `NT$4,711,195`、整體 ROAS `1.384`；其中 MOZTECH ROAS `2.1967`，BONSON 目前只有 Meta 花費、尚未在已同步 Shopify 訂單中辨識到 BONSON 營收。
- `2026-05-01` 到 `2026-05-08` 的 management summary 已可按日看到 Meta 廣告費，合計約 `NT$180,904`；Meta 當日與近幾日數字可能會持續校正，因此每日排程會回刷最近 7 天。
- Cloud Run backend 已設定 `META_ADS_SYNC_ENABLED=true`，revision `ecom-accounting-backend-00343-wgp` 100% 流量，會每日同步最近 7 天 Meta spend。
- 尚未完成：需補廣告發票 / 收據與扣款信用卡 / 銀行帳戶 mapping，才能完成 AP 與銀行扣款對帳。

2026-05-09 Google Ads connector 開發更新：

- 從使用者 Google Ads 後台截圖可先辨識帳戶 customer ID：`621-562-1647`，系統設定時需寫成 `6215621647`。
- 已新增 Google Ads 後端 connector，不會把 token 寫入 repo：
  - `GET /integrations/google-ads/connection-info`
  - `GET /integrations/google-ads/readiness`
  - `GET /integrations/google-ads/insights`
  - `POST /integrations/google-ads/sync`
  - `POST /integrations/google-ads/sync/auto`
- `insights` 會用 Google Ads API GAQL 查詢 `segments.date` 與 `metrics.cost_micros`，可用 `account` 或 `campaign` level 預覽每日 spend。
- `sync` 會把 daily account spend 寫入 `Expense / ExpenseItem`，`sourceModule=google_ads`、科目代號 `6118 廣告費`，CEO Dashboard 既有 management summary 會把這些列入廣告費。
- 已新增 `backend/scripts/configure-google-ads-secrets.sh`：用隱藏輸入把 `GOOGLE_ADS_DEVELOPER_TOKEN`、`GOOGLE_ADS_CLIENT_ID`、`GOOGLE_ADS_CLIENT_SECRET`、`GOOGLE_ADS_REFRESH_TOKEN` 放入 Secret Manager，並自動補 Cloud Run runtime service account 的 Secret Accessor 權限。
- 已部署到 Cloud Run backend revision `ecom-accounting-backend-00350-5sh`，100% 流量。正式 API 已驗證 Google Ads 路由存在：`connection-info` / `readiness` 回 200。
- 2026-05-11 已改用可管理 Google Ads 的 OAuth 帳號重新授權，並更新 `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` / `GOOGLE_ADS_REFRESH_TOKEN` Secret 版本；Secret 值不得寫入 repo。
- 2026-05-11 正式診斷確認 `6215621647` 是 Google Ads manager account，底下可讀 client accounts 包含：
  - `8052579705`：MOZTECH 墨子科技，TWD。
  - `8602556100`：bonson 邦生，TWD。
  - `5801010919`：MOZTECH Official，目前測試區間無 spend。
  - `8672054842`：moritek，目前測試區間無 spend。
- 已修正 Google Ads connector：
  - Google Ads API v21 不接受 `pageSize`，已移除 search request 的 `pageSize`。
  - 若設定的是 manager account，connector 會自動查 `customer_client` 並展開非 manager client account。
  - 查 client spend 時會自動帶入 manager 作為 `login-customer-id`，避免 `REQUESTED_METRICS_FOR_MANAGER` / `USER_PERMISSION_DENIED`。
- Cloud Run backend 已部署 revision `ecom-accounting-backend-00360-s7v`，100% 流量。
- 正式 API 已驗證 Google Ads 可抓 spend：
  - `GET /integrations/google-ads/readiness` 回 `ready=true`，`insightProbe.count=16`，`spendTotal=263363.63`。
  - `GET /integrations/google-ads/insights?since=2026-05-01&until=2026-05-09&level=account` 回 `count=18`、Google Ads spend 合計 `NT$341,789.47`，包含 MOZTECH 墨子科技與 bonson 邦生每日資料。
  - `POST /integrations/google-ads/sync` 已先同步 `2026-05-01` 到 `2026-05-09`，寫入 `Expense / ExpenseItem` 18 筆。
  - 已再補最近 30 天 `2026-04-12` 到 `2026-05-11`，`fetched=72`、`synced=72`、`created=54`、`updated=18`，`sourceModule=google_ads`。
- `GET /reports/management-summary?entityId=tw-entity-001&groupBy=day&startDate=2026-04-12T00:00:00%2B08:00&endDate=2026-05-11T23:59:59%2B08:00` 已確認 Dashboard summary 可讀到每日廣告費；目前區間 `adSpendAmount=NT$1,926,620.23`、`adSpendCount=130`，此數字包含已存在的 Meta Ads 與新同步的 Google Ads。
- Cloud Run 已開啟 `GOOGLE_ADS_SYNC_ENABLED=true` 並部署 revision `ecom-accounting-backend-00361-khw`；正式 readiness 再驗證 `ready=true`，每日排程會回刷最近 7 天 Google Ads spend。
- 2026-05-11 Google Ads 品牌 mapping 更新：Cloud Run `GOOGLE_ADS_ACCOUNTS_JSON` 已設定 `8052579705 => MOZTECH`（使用者確認 MOZTECH 全球獨立站目前用此帳戶）、`8602556100 => BONSON`、`8672054842 => MORITEK`、`5801010919 => MOZTECH`。
- 2026-05-11 已重新同步 `2026-04-12` 到 `2026-05-11` Google Ads daily spend，`fetched=72`、`synced=72`、`created=0`、`updated=72`，讓既有 `Expense / ExpenseItem` 帶入 brand / platform 描述。
- 2026-05-11 已修正並部署 Cloud Run revision `ecom-accounting-backend-00366-z76`：`GET /reports/ad-performance-summary` 的廣告花費來源從只看 `meta_ads` 改為合併 `meta_ads + google_ads`，並依 Google Ads customer ID 解析品牌。正式 API 已驗證同區間 `adSpend=NT$1,927,783.01`，品牌拆分為 `MOZTECH=NT$1,221,124.60`、`BONSON=NT$703,230.34`、`MORITEK=NT$3,428.07`；`adSource` 已改為 `META_ADS + GOOGLE_ADS`。
- 2026-05-11 已修正並部署 Cloud Run revision `ecom-accounting-backend-00368-7tc`：`GET /reports/ad-performance-summary` 的營收來源從只看 Shopify 改為合併 Shopify + Shopline + 1Shop，避免 BONSON 主要營收在 Shopline / 1Shop 時 ROAS 顯示為 0。正式 API 已驗證 `2026-04-12` 到 `2026-05-11` 回傳 `salesSource=SHOPIFY + SHOPLINE + 1SHOP`、整體 `revenue=NT$3,454,888`、`adSpend=NT$1,928,246.65`、`ROAS=1.7917`；品牌拆分為 `MOZTECH revenue=NT$2,085,083 / adSpend=NT$1,221,528.49 / ROAS=1.7069`、`BONSON revenue=NT$999,594 / adSpend=NT$703,290.09 / ROAS=1.4213`、`MORITEK adSpend=NT$3,428.07`。
- 2026-05-11 已依使用者確認的業績歸屬規則再部署 Cloud Run revision `ecom-accounting-backend-00370-w7r`：Shopify 固定歸 MOZTECH、Shopline 固定歸 BONSON、1Shop 才依商品 / SKU 拆 MORITEK / BONSON / MOZTECH / AIRITY。正式 API 驗證同區間 `GET /reports/ecommerce-history`：Shopify 只列 MOZTECH `NT$1,724,240`，Shopline 只列 BONSON `NT$557,930`，1Shop 拆出 BONSON `NT$442,654`、MOZTECH `NT$360,843`、AIRITY `NT$126,420`、未分類 `NT$243,791`。`GET /reports/ad-performance-summary` 同區間回 `BONSON revenue=NT$1,000,584 / adSpend=NT$703,290.09 / ROAS=1.4227`。
- 尚未完成：Google Ads 已可同步 spend，但廣告發票 / 收據、扣款信用卡 / 銀行帳戶 mapping 尚未補齊；因此目前可做費用與 ROAS 分析，尚不能完整做 AP / 銀行扣款核銷。

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
- Shopline 已取得可用 OpenAPI access token，已掛入 Secret Manager / Cloud Run，白名單已加入 Cloud Run 固定出口 IP；Cloud Run `token-info` 已確認可讀到 BONSON 店鋪 merchant / handle。一般 OpenAPI 可取回的 `2024-05-05` 到 `2026-05-05` 訂單 / 顧客已正式同步進 Cloud SQL：SHOPLINE `SalesOrder` 4689 筆、訂單總額 9,250,001，Payment 4687 筆。2026-05-12 已依 Shopline 官方回覆改判定：SHOPLINE Payments Admin OpenAPI / `read_payment` 目前不對外開放，撥款、手續費、保留款與未結算帳務不能靠 OpenAPI 自動拉取，需改走 Shopline Payments 對帳單匯入 `shoplinepay` 對帳流程。Momo / PChome / Pinkoi / LINE 禮物等其他通路目前尚未形成實際訂單資料流。
- 2026-05-11 使用者確認通路業績歸屬：Shopify 帳號歸 MOZTECH；Shopline 歸 BONSON；1Shop 團購平台混合 MORITEK、BONSON、MOZTECH、AIRITY，需依商品 / SKU / 品牌欄位拆分。後端報表已依此規則調整並部署到 `ecom-accounting-backend-00370-w7r`，避免把 Shopline handle / 1Shop 平台名誤當成品牌。

### B-2. 實際整合健康狀態

- Shopify health：成功，connection successful
- 1Shop health：2026-05-07 Cloud Run live 回傳 `Connection successful`；summary 顯示 `orders.count=26352`、`payouts.paymentCount=26846`，但 `platformFeeStatus=unavailable`、`reconciledCount=0`，因此目前是訂單 / 付款草稿可進系統，尚未完成綠界撥款、手續費與銀行入帳核銷。
- Shopline health：Cloud Run `connection-info` 已可讀到 Shopline 設定；修正後的 OpenAPI token 已通過 Cloud Run `token-info` 驗證，merchant handle 為 `onemorefuture`，merchant id 已確認為 `5e0738e792f5c90009548b54`。已新增只讀 `agents`、`preview/orders`、`preview/customers` 診斷端點；Cloud Run 呼叫成功。`sync/orders`、`sync/customers` 已完成 2024-05-05 至 2026-05-05 回補，且 `ecom-accounting-shopline-auto-sync` 已建立，每 20 分鐘增量同步。2026-05-12 已確認 Payments Admin OpenAPI / `read_payment` 不對外開放，因此剩餘缺口改為 Shopline Payments 對帳單匯入、兩年以上 archived orders、webhook topic 與簽章驗證、商品 / 分類 / 庫存、Shopline invoice 正式回寫。本機直連 Shopline 仍會因 IP 白名單被擋，一般 OpenAPI 驗證仍以 Cloud Run 固定出口為準。
- 2026-05-12 修正：原先會計工作台的「同步 Shopline Payments 帳務」方向不再作為主流程；Shopline Payments 的撥款 / settlement / 手續費 / reserve / unsettled 明細需從後台下載對帳單後匯入，系統再以 `shoplinepay` provider payout 流程做付款匹配、手續費回填、淨額回填與後續銀行核銷。
- 2026-05-12 UI 補強：會計工作台已在「匯入 Shopline Payments 對帳單」旁新增 CSV 範本下載，範本欄位包含訂單號碼、交易序號、交易金額、應收手續費、交易淨額、交易完成時間、結帳記錄時間、支付方式與交易詳情，對齊後端 `shoplinepay` parser 可辨識欄位，降低財務匯入時猜欄位的風險。
- 2026-05-12 後端防呆：`/integrations/shopline/payments/*` 診斷與同步端點預設不再主動呼叫 SHOPLINE Payments Admin OpenAPI；會直接回覆 `officialUnavailable=true` 與「請匯入對帳單」的下一步，避免 302 redirect 被誤判為 token / host / 白名單設定問題。若未來 SHOPLINE 特別開放此 scope，可用 `SHOPLINE_PAYMENTS_OPENAPI_OVERRIDE=true` 重新允許測試。
- 2026-05-07 至 2026-05-08 實測保留結論：Cloud Run `payments/balance` 與 `payments/billing-records` 回 HTML / `302` redirect，不是有效 JSON；當時診斷曾指向 host / version / `read_payment` / OpenAPI 啟用狀態。2026-05-12 官方已明確回覆 Payments API 不對外開放，所以該 redirect 不再追為 token 設定問題。
- LINE Pay config：已設定 production profile

### B-3. 實際 UI 狀態

- Dashboard 可顯示 yesterday summary、待補發票、稅額異常、手續費待補等資訊
- 對帳中心可顯示任務區與四隊列入口
- 對帳中心核銷操作已改為兩段式：先 dry-run 預覽可核銷筆數、阻擋原因與樣本 Payment，只有使用者在確認視窗再次按下「確認核銷」才會寫入真實核銷分錄
- 對帳中心手動「跑核心同步」已改為只同步與重算，不再順手自動核銷；正式核銷統一走預覽與二次確認
- 會計工作台的 1Shop 團購閉環與 LINE Pay 閉環補跑也已改為 `autoClear=false`，同步、匯入、補跑和核銷分流

2026-05-08 對帳中心異常原因拆解：

- 使用者在對帳中心看到約 2,409 筆異常時，主要問題不是單一 bug，而是同一批訂單同時卡在發票、手續費、AR 與分錄閉環。
- 已修正 `GET /reconciliation/center`：同一筆訂單的稅額稽核碼與 AR warning codes 會合併，不再因為有 `order_tax_mismatch` 就蓋掉 `missing_fee` / `invoice_pending` / `missing_ar` / `missing_journal`。
- 已新增 `summary.exceptionBreakdown`，前端異常頁會顯示「異常原因拆解」卡片，讓財務和 CEO 可直接看到卡點。
- Cloud Run backend 已部署至 revision `ecom-accounting-backend-00329-kg4`，frontend 已部署至 revision `ecom-accounting-frontend-00160-hwh`。
- 正式 API 驗證 `2026-04-08` 到 `2026-05-08`：`totalCount=2377`、`exceptionCount=2369`、`exceptionAmount=7841`。
- 主要原因：
  - `missing_fee` 2,307 筆：已有收款，但尚未回填金流或平台實際扣費。
  - `invoice_pending` 1,822 筆：已有收款，但系統尚未找到可連結的發票紀錄。
  - `missing_ar` 1,530 筆：訂單尚未建立完整應收帳款追蹤紀錄。
  - `missing_journal` 1,522 筆：款項 / 發票資料尚未產生會計分錄。
  - `overpaid_receivable` 608 筆：收款總額高於訂單金額，需拆重複付款、合併款或資料歸戶。
  - `invoice_issued_unposted` 466 筆：已有發票號碼，但尚未建立會計分錄。
  - `missing_invoice_after_payment` 130 筆：訂單已付款或已對帳，但尚未匹配到電子發票。
  - `order_payment_mismatch` 57 筆：平台訂單金額與付款總額不同，需核對退款、折讓或重複付款。
- 注意：原因數會大於異常筆數，因為同一筆訂單可能同時缺發票、缺手續費、缺 AR、缺分錄。
- 後端自動核銷預設已收斂為 opt-in：核心對帳、1Shop 團購閉環與 LINE Pay 閉環只有明確收到 `autoClear=true` 才會寫入核銷分錄
- LINE Pay 退款沖銷也已從一般同步 / 閉環補跑拆出；只有明確選擇退款沖銷或傳入 `processLinePayRefundReversals=true` 才會建立反向分錄
- 本機 / 排程 closure-pass script 也已改為保守預設；必須顯式加 `--auto-clear` 或 `--process-linepay-refund-reversals` 才會做財務寫入
- 會計工作台「串接準備」分頁已新增「複製待補清單」與「匯出 CSV」，可把 Shopify、1Shop、Shopline、綠界、LINE Pay、銀行與廣告費的待補資料整理給內部同仁或外部平台窗口
- 銀行交易明細頁已補齊「下載匯入範本」與「匯入對帳單」流程；匯入前必須選銀行帳戶，前端會讀取 CSV 文字內容送到 `/banking/accounts/:id/import-statement`，不再使用後端未接的 multipart 形式
- 銀行匯入解析已補強：支援逗號 / 分號 / tab 分隔、CSV 引號欄位、民國年日期，以及 `NT$1,234`、`(1,234)`、`1,234-` 等常見銀行金額格式
- 銀行對帳單匯入已改成二段式：`POST /banking/accounts/:id/import-statement/preview` 先只讀解析可匯入筆數、略過列與樣本資料；使用者在前端確認後才呼叫正式匯入，避免格式錯誤時直接寫入銀行交易
- 產品與庫存頁可載入；若產品清單是 `No data`，現在會明確提示先建立產品主檔或下載範本整理 SKU、條碼、倉庫與初始庫存
- 產品 / 庫存批次匯入已改成二段式：前端先以 `dryRun=true` 預覽可匯入列數、新建倉庫、新建產品、更新產品與庫存行數，使用者確認後才正式寫入產品與庫存
- 費用申請頁可載入，但目前沒有費用申請資料
- 報表中心可載入且已有分區說明
- 若沒有 `localStorage.entityId`，上述頁面會卡在 loading skeleton / spinner，這是實際可見的 usability blocker

### C. 前端與後端 API 有至少一個明確命名落差

已看到：

- 前端 `banking.service.ts` 使用 `/banking/accounts/{id}/import`
- 後端 Swagger 顯示銀行匯入端點是 `/banking/accounts/{id}/import-statement`

這會造成銀行對帳單匯入功能在前端可能失敗。需修正前端 service 或後端補 alias。

本地已修正前端 service，改呼叫 `/banking/accounts/{id}/import-statement`。
後續已補齊銀行交易頁的帳戶選擇、CSV 範本下載與實際匯入動作；前端改為讀取檔案文字後送 `{ csvContent }`，與後端目前的 JSON body contract 對齊。

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
- `ECPAY_EINVOICE_ISSUING_ENABLED`：新增正式開票獨立開關；即使 profile 已就緒，未啟用前仍只允許 readiness / 匯入，避免未測試前誤觸真實發票。
- `frontend/src/pages/AccountingWorkbenchPage.tsx`：會計工作台新增綠界正式開票 readiness 提示，讓會計知道目前只能匯入銷項發票，還是已具備正式 API 開票條件。
- `backend/.env.example`：新增 `ECPAY_EINVOICE_ACCOUNTS_JSON` 範例，不寫入真實密鑰。

### N. 正式環境不可只做本地發票作廢 / 折讓

`voidInvoice` 與 `createAllowance` 原本會直接更新本地 `Invoice` 狀態或建立負項折讓單，但尚未呼叫綠界電子發票作廢 / 折讓 API。這會造成另一種財務風險：系統顯示發票已作廢或已折讓，綠界後台卻仍是原狀。

本地已修正：

- 正式環境呼叫 `POST /invoicing/:invoiceId/void` 會先擋下，不允許只在本地作廢。
- 正式環境呼叫 `POST /invoicing/:invoiceId/allowance` 會先擋下，不允許只在本地建立折讓。
- 只有 `NODE_ENV=test` 或 `ALLOW_LOCAL_INVOICE_STUB=true` 時才保留本地 stub 作廢 / 折讓，供測試使用。
- Swagger 說明已標註作廢 / 折讓仍待綠界 API Adapter 啟用。

### O. 銷項發票需要正式綠界狀態查詢

只靠匯入檔或本地 `Invoice.status`，會讓財務無法快速確認「系統內發票」和「綠界後台狀態」是否一致。

本地已新增：

- `GET /invoicing/:invoiceId/provider-status`：依內部 Invoice 的發票號碼、發票日期與 merchant profile 向綠界查詢狀態。
- 這是只讀查詢，不會開票、作廢、折讓或更新本地資料。
- 查詢會優先從 `Invoice.externalPayload`、`Invoice.notes`、`SalesOrder.notes` 取得 `merchantKey` / `merchantId` / `invoiceDate`，不足時用銷售通路推斷 `shopify-main` 或 `groupbuy-main`。
- `EcpayEinvoiceAdapter` 新增 `queryInvoiceStatus`，後續可給銷售訂單、AR、會計工作台共用。
- `frontend/src/pages/ArInvoicesPage.tsx`：應收帳款頁的操作欄新增「查綠界」，可直接對單筆 Invoice 做只讀查詢並顯示綠界狀態。

接續已新增：

- `GET /invoicing/provider-status/readiness`：只讀盤點內部 `Invoice` / `SalesOrder` 是否具備綠界狀態查詢需要的 `invoiceNumber`、`invoiceDate`、`merchantKey` / `merchantId`。
- 單筆查詢若缺商店代號會先回明確錯誤，不會誤打綠界 API。
- 從匯入資料取得的 `invoiceDate` 若含時間，查詢前會正規化為 `YYYY-MM-DD`，避免把 `2026-04-24 11:07:04` 直接送進綠界狀態查詢。
- 應收帳款頁會依目前日期區間顯示綠界查詢欄位盤點結果，讓會計先知道是欄位缺漏，還是單筆綠界回應異常。

仍需使用者提供 / 確認：

- `3290494` 與 `3150241` 的綠界電子發票正式 `HashKey` / `HashIV` 是否已開通並放入 Secret Manager / Cloud Run env。
- 是否有 B2B API、字軌 / 配號查詢、作廢、折讓、折讓作廢的實際開通權限。
- 正式上線前需以綠界 stage 或小額測試單驗證 `Issue` / `GetIssue` / `Invalid` / `Allowance` 的回應欄位，再開啟批次開票入口。

### P. AR 應標示超收 / 重複收款風險

正式 AR 頁抽查時可看到部分訂單的已收金額高於訂單應收，例如同一訂單有多筆 Payment 疊加後，`paidAmount > grossAmount`。這類情境可能是重複匯入、同客戶合併收款未拆帳，或退款 / 折讓尚未反映；若只顯示「已收」而不標示風險，會讓會計誤以為該筆已完成。

2026-08-27 底層修正：

- 新增 `Payment.sourceTransactionKey` 與 entity 內唯一索引，來源交易以資料庫約束保證冪等；Shopify、Shopline、1Shop 改用原子 upsert，不再依賴 `findFirst` 後 `create` 的競態流程。
- 共用付款完整性規則只讓 `completed` / `success` 影響應收；`pending`、`failed`、`ignored`、`superseded` 保留稽核資料但不計入已收。
- Shopify 授權與 void 不再當成 sale，refund 以負向應收異動記錄；同步會正確寫入 Payment 狀態。
- 1Shop 不再把物流第三方編號當成付款編號；待付款只保留零元草稿，正式付款進來後將草稿標記為 `superseded`，不刪除原始稽核軌跡。
- 遷移只為每組歷史來源交易指定一筆 canonical source key；既有重複付款不刪除、不合併、不沖銷，正式清理仍須另行人工確認。
- 本地驗證：Prisma schema validate 通過；backend 16 個 test suites、58 個測試全數通過；Nest backend build 通過。
- 正式部署驗收：migration execution `ecom-accounting-db-migrate-cdj7x` 成功；Cloud Run revision `ecom-accounting-backend-00484-kib`（tag `pi-v2`）已承接 100% 流量。近 30 天正式 `/ar/overpaid` 由舊版 384 筆／NT$527,709.4 降為 0 筆／NT$0；重新整理正式 Dashboard 後，現金流風險顯示 0 元、超收 0 筆。
- 正式來源回刷：Shopify 近 30 天依 5 天視窗完成 1,431 個交易事件更新、0 筆新增；Shopline 近 30 天完成 583 筆更新、0 筆新增；1Shop 已完成單日 35 筆更新、0 筆新增，並由既有每 20 分鐘排程持續回刷最近 3 天。三個通路排程均為 ENABLED；既有歷史重複列保留稽核，不列入會計有效收款。

本地已新增：

- `backend/src/modules/ar/ar.service.ts`：AR monitor 對銷售訂單與手動 AR 都計算 `overpaidAmount`，並以 `overpaid_receivable` warning 標示。
- AR summary 新增 `overpaidReceivableCount` / `overpaidReceivableAmount`，供 Dashboard 或 AR 頁優先揭露超收風險。
- `frontend/src/pages/ArInvoicesPage.tsx`：若本區間存在超收 / 重複收款風險，會在表格上方顯示高優先警示，並在逐筆異常標籤顯示「超收/重複收款」。
- `GET /ar/overpaid`：新增只讀超收診斷 API，列出訂單、付款列、payout batch、provider payment id、同金額重複群組、是否接近雙倍付款與診斷文字。
- `frontend/src/pages/ArInvoicesPage.tsx`：超收警示新增「查看超收明細」，可展開付款列核對 batch / provider id / fee / reconciled 狀態。
- `frontend/src/pages/DashboardPage.tsx`：CEO Dashboard 紅燈警示與 KPI 會顯示超收 / 疑似重複收款筆數與差額，並導向 `sales/invoices?focus=overpaid`；當 Dashboard 選「全部」沒有日期邊界時，AR 風險監控會改用最近 90 天，避免正式環境無界 `/ar/monitor` 查詢失敗造成漏報。
- `frontend/src/pages/ArInvoicesPage.tsx`：若 URL 帶 `focus=overpaid`，應收帳款頁在 monitor 載入完成且存在超收風險時會自動打開「超收 / 疑似重複收款明細」。
- `GET /ar/overpaid` 已加上只讀處理分類：`高度疑似重複匯入`、`多筆同金額待審核`、`人工判斷`。每筆會列出候選重複 `Payment` ID、保守檢查條件與建議處理動作，但不會刪除、合併或沖銷付款。
- `frontend/src/pages/ArInvoicesPage.tsx`：超收明細表新增「處理分類」欄，展開後會標示候選重複付款列與人工核對條件，讓財務可以先做 review queue，不直接動資料。
- 超收明細已改為後端分頁與分類篩選，避免正式環境 697 筆超收訂單只看得到前 100 筆；財務可以依 `高度疑似重複匯入`、`多筆同金額待審核`、`人工判斷` 分批核對，並匯出目前篩選條件下的審核清單。

仍需確認：

- 是否要把 `高度疑似重複匯入` 轉成正式人工審核隊列，並記錄審核人、審核時間與處理原因。
- 是否要提供安全的資料修正流程。刪除 Payment、合併 Payment、沖銷退款或補折讓都會改動真實財務資料，必須另行確認後才能操作。

### Q. CEO Dashboard 需要從業績頁升級成現金流與風險管制頁

使用者明確希望 CEO 儀錶板不要只看銷售業績，而要看到 CEO 真正需要管控的財務、庫存、廣告、現金流與異常事件。特別是廣告花費、今天淨利、發票異常，以及財務人員可追蹤的對不上帳項。

本地已新增：

- `backend/src/modules/reports/reports.service.ts`：management summary 新增 `adSpendAmount` / `adSpendCount`，從已入帳 `Expense` 明細與已付款 `ExpenseRequest` 中，以廣告平台、廣告費、投放、關鍵字、行銷等描述 / 科目線索辨識廣告費用。
- `frontend/src/pages/DashboardPage.tsx`：新增「財務管制與營運風險」區塊，顯示所選期間淨利、區間廣告花費、目前現金流風險金額、財務異常追蹤，並提供「財務選項」與「對帳中心」入口。
- Dashboard 的損益快照改用目前查詢區間的 management summary；30 天趨勢仍只負責圖表，不再拿 30 天資料冒充今日或本期淨利。
- 2026-05-09 修正：此區塊原本第一張卡片仍固定使用 `todayManagementSummary` 並標示「今天淨利」，導致使用者切換昨天 / 近 7 天 / 自訂日期時以為 Dashboard 沒有套用日期。現已改為使用 `rangeManagementSummary` 顯示所選期間淨利；現金流風險改標示為「目前」未結狀態，因為它混合逾期 AR、超收與 AP exposure，不是純期間損益。
- 廣告 connector 尚未就緒時，Dashboard 會顯示待串接與下一步需求，不會假造 Meta / Google / TikTok API 花費。
- Dashboard 已補快速圖表：30 天營收 / 淨利 / 淨入帳 / 廣告費趨勢、通路淨入帳 donut、品牌現金貢獻 donut、風險優先排序橫條圖，以及缺發票 / 對帳異常 aging。這些圖表使用現有 management summary、通路 bucket、invoice queue 與 audit items，不依賴尚未取得的廣告 API。
- Dashboard 的 CEO 對帳入口已修正為正式前端路由 `/reconciliation`，避免從風險排序或「對帳中心」按鈕導到不存在的 `/reconciliation/center`。
- Dashboard 財務快覽已改用共用 API client 與既有 service 讀取 AR、AP 與銀行帳戶餘額，不再直接打 frontend origin 的 `/api/...`，避免正式站 runtime config 正確時仍讀不到財務快覽。
- 2026-05-12 修正：Dashboard 財務快覽的 AR exposure 不再另打全歷史 `/ar/summary`；改共用主 Dashboard 查詢已取得、且跟目前日期區間一致的 `receivableMonitor.summary.outstandingAmount`。AP 仍依所選日期範圍過濾發票日 / 到期日，銀行餘額維持目前快照，避免切換日期時混用全歷史應收與區間損益。
- 2026-05-12 修正：CEO Dashboard 的廣告費卡片不再把「Meta / Google 憑證已設定但所選區間沒有 spend」誤顯示成「待串接」。現在只有 connector 內部憑證尚未設定時才顯示待串接；若可同步但本區間無資料，顯示 `0 元` 與補同步提示。
- 2026-05-12 追加修正：若系統已存在 30 天歷史廣告費，但目前 connector readiness 沒讀到完整 Secret，Dashboard 會顯示所選區間 `0 元` 與「需檢查 Secret」，不再把已有資料的狀態混成「待串接」。正式環境仍需用 Cloud Run / Secret Manager 確認 Meta / Google Ads secrets 是否掛在目前流量 revision。
- 對帳中心已支援 `?bucket=pending_payout|ready_to_clear|cleared|exceptions` 深連結；CEO Dashboard 的「待撥款 / 對帳」現在會直接開到待撥款隊列，會計切換隊列時 URL 也會同步，方便分享給同仁接手處理。
- Dashboard 風險排序中的全歷史未核銷 Payment 已改名為「未核銷收款」，並導向 `/accounting/workbench?focus=data-completeness`；這避免把全歷史未核銷數誤導到對帳中心某一天或 30 天的「待撥款」bucket，造成 CEO 看到大紅燈但處理頁顯示 0。
- 會計工作台已支援 `focus` 參數切換分頁，例如 `focus=data-completeness` 會直接打開資料完整度分頁，`focus=missing-invoices` 會導向資料完整度並保留缺發票處理入口。

仍需確認：

- Meta / Google / TikTok Ads API 權限、廣告帳戶與品牌 / 通路 mapping、發票或收據來源、扣款銀行或信用卡來源。
- 廣告費若先用報表匯入，需確認匯入格式與費用科目，避免與一般行銷費混淆。
- 財務異常追蹤下一步可再拆成正式 review queue，讓財務主管標記處理狀態與責任人。

### R. 多公司資料邊界必須由後端強制執行

2026-08-25 程式稽核發現，會計、報表、AI、對帳與公司清單部分 API 會直接採信前端傳入的 `entityId`。原本 `ENTITY` scope 使用者即使綁定單一公司，也可能用修改 request 的方式查詢其他公司；只帶 journal、period、bank transaction、bank import batch 或 payout batch ID 的端點也缺少一致的公司歸屬驗證。

本地已修正（尚未部署）：

- 新增集中式 `EntityAccessService` / `EntityAccessGuard`：`SUPER_ADMIN` 可跨公司；其他使用者必須綁定 Employee，且只能存取 Employee 所屬公司。沒有 Employee 綁定時一律 fail closed，不再退回第一間公司。
- 會計、報表、AI 與對帳 controller 對 query/body/param 中的 `entityId` 統一執行後端驗證；受 scheduler token 保護的 `@Public()` 排程端點維持獨立驗證，不套用登入使用者規則。
- `GET /entities` 對一般使用者只回傳所屬公司，`GET /entities/:id` 也會驗證公司歸屬；只有 `SUPER_ADMIN` 可列出全部公司。
- 分錄審核、關帳與鎖帳會先從資料庫取得實際 `entityId` 再驗證，避免只帶資源 ID 繞過公司邊界。
- 銀行匯入、auto-match、manual-match、unmatch 與 payout batch detail 已補資源歸屬驗證；manual-match 另限制銀行交易與 Payment / SalesOrder / AR / AP 必須屬於同一公司。
- 修正銀行匯入 DTO 與 service 欄位不一致（`date` 被誤讀成 `transactionDate`、不存在的 `entityId/source/fileName` 被直接使用），改由 BankAccount 推導公司並以單一 transaction 建立 batch 與交易明細。
- 修正 reconciliation controller 使用不存在的 `user.userId`，統一改讀 JWT user 的 `id`。
- 自動銀行匹配改用正確的 Payment 欄位 `amountGrossOriginal` / `payoutDate`，並限制只能匹配同公司 Payment / SalesOrder。
- 新增只讀 `GET /reports/journal-approval-readiness`，依公司與日期區間盤點已審核／未審核分錄筆數、借貸金額與最多 20 筆未審核樣本，不會自動核准或修改正式財務資料。
- 管理報表回傳 `dataBasis=operational_sources` 與 `releaseGate`；只要區間仍有未審核分錄，報表中心會顯示紅色「暫不可發布」警示。正式損益表、資產負債表、試算表與總分類帳維持 approved-only。
- 後端原本仍會回傳假 `downloadUrl` 的報表匯出端點已改為明確 `501 Not Implemented`，避免前端或第三方誤把不存在的匯出結果當正式文件。
- 生產容器啟動已移除 `prisma migrate deploy` 與 seed；Cloud Run 發布流程會先用同一個 image 執行單次 migration Job，成功後才建立無流量 candidate revision。應用程序也已開啟 Nest shutdown hooks 並轉送 `SIGTERM` / `SIGINT`。
- ERP 導覽已改為桌面版固定側邊欄：收合時保留 80px 圖示軌道，不再整個消失；目前路由所在群組會保持展開。所有一般操作按鈕統一為 40px 高。
- Dashboard 已移除浮動 AI 助手、昨日 AI 提示、中英雙標題、重複 KPI / 品牌 / 趨勢 / 通路 / 待辦區塊；設定與報表頁的未上線 AI 介面預留也不再顯示。
- 銷售通路與品牌貢獻已拆成獨立維度：通路固定彙總為「官網」、「1Shop 團購」、「線下通路」、「其他通路」；品牌圖只使用廣告業績 API 的實際品牌營業額，不再把「團購」當成品牌。
- 採購收貨與銷售出貨已改為原子交易：單據狀態 claim、庫存異動、庫存快照、序號、移動平均成本、Shipment 與最終狀態同時成功或全數 rollback。重試已收貨 / 已出貨單據不會再次加扣庫存；若發現舊版留下的部分出庫異動，會中止並要求人工複核。
- 採購 API 已改為必傳 `entityId` 並套用 purchasing entity access guard，不再依賴 JWT 中不存在的 `req.user.entityId`。採購頁已提供真實倉庫選擇與序號掃描收貨流程；銷售訂單側欄的出貨按鈕也已啟用相同倉庫 / 序號驗證。
- 後端 build 通過，全部 7 個 test suites、33 個 tests 通過；新增 entity access service / guard 的 own-entity、cross-entity、unlinked-user、department-scope、public scheduler 與 malformed entityId 測試。
- 2026-08-25 再次驗證：backend build、10 suites / 41 tests、frontend production build、兩份 GitHub Actions YAML 解析均通過。Frontend 全專案 lint 仍有大量歷史錯誤，本次不將「編譯通過」誤報為「lint 已清零」。

正式部署前仍需：

- 只讀盤點正式環境所有 ADMIN / ACCOUNTANT 是否有正確 Employee 與 Entity 綁定，避免舊帳號因新 fail-closed 規則被擋；`SUPER_ADMIN` 不受此限制。
- 2026-08-25 正式介面只讀盤點：3 個最高權限帳號均有 `SUPER_ADMIN`，不受 Employee 綁定限制；一般帳號另有 `admin@example.com`（ADMIN）與 `mozlemon@moztech.cc`（ACCOUNTANT），但員工名單目前只有 1 筆，因此兩者不可能都已完成 Employee / Entity 綁定。部署前需由負責人確認這兩個帳號各自對應哪位員工與公司，或確認停用不用的帳號；不得用「第一間公司」作為權限 fallback。
- 完成 release quality gate、候選 revision 無流量驗證與登入後 smoke test，再切正式流量。

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

2026-05-13 更新：

- 已修正 Dashboard / 報表在「昨天」等單日區間可能漏算 Meta / Google 廣告費的日期口徑問題：一般費用仍用精準時間範圍，`meta_ads` / `google_ads` 匯入的每日廣告費改用台北營運日轉成日期型範圍查詢。
- 已把 `sourceModule=meta_ads/google_ads` 納入廣告費判斷，避免描述文字異動時漏算正式匯入的廣告費。
- 後端 build 通過，並已部署 Cloud Run backend revision `ecom-accounting-backend-00390-7jp`，100% 流量。
- 正式報表 API 需要登入權限，終端機未帶瀏覽器登入 token 時會回 `401 Unauthorized`；畫面端重新整理後應使用新版後端計算。

2026-08-27 電商與廣告來源復原盤點：

- 正式環境實測 Shopify 與 1Shop health 均成功；2026-08-01 至 2026-08-27 已存在 Shopify `758` 筆、營業額 `NT$958,368.83`，1Shop `748` 筆、營業額 `NT$826,750`。來源沒有被刪除，Dashboard 原本預設「今日」使長區間貢獻不易看見，前端預設改為「近 30 天」。
- Meta Ads readiness 與帳戶探測成功，2026-08-20 至 2026-08-27 live API 可讀 `24` 筆、花費 `NT$116,978`；手動正式同步已更新最近 7 天 `24` 筆 Expense。
- Google Ads 中斷根因確認為新版 connector 未讀取 `GOOGLE_ADS_ACCOUNTS_JSON` 內各帳戶的 `refreshTokenEnv`，誤用共用 refresh token 後回 `USER_PERMISSION_DENIED`；不是 Google 帳號失權，也不需要重新 OAuth。`c81813ca` 已恢復依帳戶選取 OAuth 憑證，候選 readiness 回 `ready=true`，2026-08-20 至 2026-08-27 live API 可讀 `16` 筆、花費 `NT$132,394.69`，包含 MOZTECH 與 BONSON，並已補同步至 Expense。
- 補同步後的正式報表核對發現，新舊 connector 使用不同 `sourceId` 格式，造成同一 Google customer / date 被重複計入。`d0bc6d87` 改以 Google customer ID + 日期作為邏輯唯一鍵，保留標準列並清除 `42` 筆舊格式重複列。無快取報表驗證 2026-08-01 至 2026-08-27 Google Ads 為 `119` 筆、`NT$455,023.83`、最後日期 `2026-08-27`；Meta + Google Ads 合計 `NT$1,018,350.83`，會計口徑 ROAS `2.328`。
- Dashboard 廣告品牌歸屬修正為優先使用 `brand`，`reportBrand=MOZTECH_TW / MOZTECH_US` 僅保留為市場報表維度，不再把 MOZTECH 營收與 MOZTECH_TW 廣告費拆成兩個品牌而產生錯誤 ROAS。
- `ad-performance-summary` 新增 Meta / Google Ads 各來源的花費、筆數與最後資料日期；Dashboard 以精簡標籤顯示來源最後日期，避免排程仍存在但來源已停止更新時看不出來。
- 因診斷輸出曾包含同步排程權杖，Shopify / 1Shop、Meta、Google Ads 權杖已全部輪替並寫入 Secret Manager。四條 Cloud Scheduler 正式排程均已回 HTTP 201：Shopify、1Shop、Meta Ads、Google Ads；含 OAuth 與去重修正的程式版本為 `d0bc6d87`。
- 2026-08-27 同步韌性補強：Shopify 維持每 15 分鐘回刷最近 180 分鐘，1Shop 維持每 20 分鐘回刷最近 3 天；Meta Ads 改為每小時第 5 分鐘、Google Ads 改為每小時第 15 分鐘回刷最近 7 天。四條 Cloud Scheduler 均補上最多 5 次自動重試與退避時間，避免一次網路或平台失敗就形成資料洞。
- 排程權杖再次輪替至 Secret Manager version 3，正式後端改由 `ecom-accounting-backend-token-v3` 100% 流量並載入 `latest` Secret。切換前的 401 / 400 已由新重試機制自動恢復；正式日誌再次確認 Shopify、1Shop、Meta Ads、Google Ads 全數回 HTTP 201。2026-08-01 至 2026-08-27 無快取報表為營收 `NT$2,370,748`、Meta `NT$563,558`、Google Ads `NT$455,145.06`、總廣告費 `NT$1,018,703.06`、ROAS `2.3272`，兩個廣告來源最後日期皆為 2026-08-27。

2026-08-28 綠界撥款 API 串接：

- 兩個商店均確認使用 `PaymentMedia/TradeNoAio`，並以信用卡 `FundingReconDetail` 補齊退款；Cloud Run 固定出口 `104.199.246.28` 已在兩帳號白名單。商店 profile 仍為 `syncEnabled=false`，只開放唯讀預覽，不自動寫入會計資料。
- 找到綠界信用卡 CSV 會混入沒有訂單號、授權單號與交易日期的「每日小計」列；底層解析現在只接受追溯欄位齊全的負數退款，避免把彙總金額誤當交易。
- 2026-07-28 至 2026-08-28 唯讀核對：1SHOP `3150241` 為 `357` 筆、交易額 `NT$495,150.00`、手續費 `NT$9,893.25`、實撥 `NT$485,256.75`；MOZTECH `3290494` 為 `126` 筆、交易額 `NT$155,763.00`、手續費 `NT$3,155.85`、實撥 `NT$152,607.15`，均與後台一致。
- Backend 測試 `2` suites / `8` tests 與 build 通過。Cloud Run revision `ecom-accounting-backend-00486-vis` 先以零流量通過 readiness `200` 與未登入 `401` 保護測試，再切至正式 `100%` 流量；正式 readiness 仍為 `200`。
- 對帳中心新增精簡「綠界撥款」入口，沿用頁面日期一次唯讀查詢兩個商店，只顯示筆數、交易額、手續費與實撥。Frontend production build 通過；revision `ecom-accounting-frontend-00254-yak` 的根頁、runtime config 與候選 bundle 驗證通過後切至正式 `100%` 流量。

### S. 發票待辦與來源訂單完整性必須使用同一底層口徑

2026-08-28 本地修正（尚未部署）：

- Dashboard 的缺發票數原本把 `pendingCount + eligibleCount` 相加，但後端 `pendingCount` 已包含 eligible，造成 65 筆 pending 與 41 筆 eligible 被顯示成 106 筆。前端現只讀後端 `pendingCount`。
- 發票隊列原本只載入 `limit * 4` 筆訂單後計算摘要；Dashboard `limit=24` 時，摘要實際只涵蓋最新 96 筆，不是完整日期區間。現在 `completed / eligible / waiting_payment` 由資料庫對完整區間做三個互斥 count，明細 limit 不再影響摘要。
- 已開票完成改以 `Invoice.status=issued` 為正式來源，不再只信任可能漂移的 `SalesOrder.hasInvoice`；可開票只接受 `Payment.status=completed/success`，單純 `reconciledFlag` 不會把未完成付款提升成可開票。
- 批次開票目標改為直接查詢完整 eligible 集合並套用自身 limit，不再從 Dashboard 明細頁的 `queue.items` 篩選，避免頁面分頁造成漏處理。
- 新增 `SalesOrder.sourceOrderKey` 與 entity 內唯一索引。Shopify、1Shop、Shopline 及人工建立訂單均以 `channelId + externalOrderId` 建立來源鍵；三個 connector 改用資料庫原子 upsert，付款回連訂單也使用同一來源鍵，不再使用競態式 `findFirst -> create`。
- 遷移不刪除或合併歷史訂單。每個重複群組只選一筆具有正式發票、`hasInvoice`、Payment、items 等下游資料較完整的 canonical 取得來源鍵，其餘舊列保留稽核且不再進入 Dashboard、管理報表、廣告業績、AR、對帳中心及一般訂單列表。
- 正式 Cloud SQL 一次性唯讀 Job `ecom-accounting-sales-order-audit-2fjn5` 已成功：46,729 筆來源訂單列、46,235 個唯一來源訂單、494 個重複群組 / 494 筆額外列；近 30 天有 142 組。最新樣本均為 SHOPLINE，包含畫面抽查的 `20260827035046324`。Job 只執行 SELECT，未修改資料。
- 自動綠界發票回填新增受 `x-sync-token` 保護的排程入口，並以 `ECPAY_EINVOICE_SYNC_ENABLED=false` 預設關閉。啟用後只讀綠界既有發票並回填內部 Invoice / SalesOrder，不會開票、作廢或折讓；正式啟用前仍需雙帳號同區間 dry-run 核對。
- 驗證：Prisma schema validate / generate 通過；backend 18 個 suites、70 個 tests 全數通過；backend build 與 frontend production build 通過。

正式發布關卡：

- 先執行單次 migration Job，再建立零流量 backend candidate；確認 494 組只被 canonical 化、沒有刪除 SalesOrder / Payment / Invoice。
- candidate 登入後核對同一 30 天區間的發票互斥式：`pendingCount = eligibleCount + waitingPaymentCount`，且三類總和等於 canonical 非取消 / 非退款訂單數。
- 分別以 `3290494 / shopify-main` 與 `3150241 / groupbuy-main` 執行同區間 dry-run；matched / unmatched / invalid 樣本核對完成後，才開啟內部回填與 Cloud Scheduler。
- 自動同步啟用後仍保持 `ECPAY_EINVOICE_ISSUING_ENABLED=false`，避免「同步既有發票」被誤解成允許系統自動開票。

2026-08-28 正式發布與 1SHOP 發票來源回補：

- 兩個 1SHOP 正式帳號 `0978072278`、`0938970369` 連線成功；1SHOP 訂單 detail API 會回傳 `receipt.invoice_number` / `invoice_date`，既有 connector 可將訂單、付款與內嵌發票寫入同一來源鍵。
- 歷史大量回補曾使用 `includeDetails=false`，所以只建立訂單 / 付款而沒有抓 detail 內的 receipt。2026-08-22 至 2026-08-24 已用含 detail 的單日安全窗重拉：訂單分別更新 168、7、12 筆，沒有新增重複訂單。
- 綠界 `3150241` 最近 7 天在重拉前為 354 張、240 張匹配、114 張未匹配。未匹配中的 102 張使用 `原始 1SHOP 訂單號 + ai + 6 碼英數簽章` 關聯號；底層訂單號正規化新增這個正式格式，沒有用模糊金額或客戶資料猜測配對。
- 候選 revision `ecom-accounting-backend-00493-pig` 驗證：總計 464 張綠界發票、452 張匹配、102 張建立、12 張未匹配、0 張 invalid；其中 `3150241` 為 342 / 354 匹配，`3290494` 為 110 / 110 匹配。候選通過後切至正式 100% 流量，正式再次執行為 created=0 / updated=452，證明同步冪等。
- 同一 2026-07-29 至 2026-08-28 發票隊列口徑，含 1SHOP detail receipt 與新關聯號回填後，pending 從 888 降至 645、issued 從 1,674 增至 1,917；共補回 243 張可追溯發票。
- Cloud Build `847011e2-2468-4396-800b-622b865ba400` 成功；backend 19 suites / 72 tests 與 build 通過。自動發票同步仍維持每 20 分鐘，且 `ECPAY_EINVOICE_ISSUING_ENABLED=false`。
- 剩餘 12 張不是可由現有 1SHOP 訂單號確定配對的格式：10 張 `CASE-*`、1 張 `FU*`、1 張 `U*-*`。必須追另一個上游來源或取得明確對照表，系統保持 unmatched，不做猜測回填。

2026-09-01 電商同步責任與執行紀錄收斂：

- Shopline 原本同時由應用程式內部排程與 Cloud Scheduler 啟動，且正式 Scheduler 權杖與 Secret 不一致而回 `401`。目前已移除內部固定排程，正式固定輪詢由 Cloud Scheduler 單一負責；webhook 只負責事件增量同步。
- 修正 Cloud Scheduler 未傳 JSON body 時同步入口讀取 `body.entityId` 造成的 `500`；入口現在接受空 body 並安全使用預設 entity。
- 新增資料庫層 `ConnectorSyncState` 與原子 lease，同一 entity / connector 同時間只能有一個有效同步執行。Scheduler、webhook 與人工觸發共用相同協調器，並記錄觸發來源、執行窗、最近成功／失敗、錯誤與同步筆數；過期 lease 可安全接手。
- `GET /reports/connector-readiness` 與會計工作台「串接準備」新增同步健康度，區分正常、執行中、失敗、過期與尚未追蹤，不顯示密鑰內容。
- Prisma validate / generate、backend build、frontend production build 通過；backend `22` suites / `79` tests 全數通過。
- 正式 migration Job `ecom-accounting-db-migrate-29hc2` 成功。Backend revision `ecom-accounting-backend-00496-net` 先以零流量通過 readiness 與空 body Shopline 真實同步，再切至 `100%`；該次同步更新 3 筆訂單、3 筆付款草稿、166 筆客戶及 3 筆交易，沒有新增重複資料。正式 Shopline Scheduler 隨後回 HTTP `201`，先前 `401` / `500` 已排除。
- Frontend revision `ecom-accounting-frontend-00262-cim` 的根頁與 runtime `config.js` 候選驗證通過後切至 `100%`。Cloud Run 對 `/healthz` 於應用程式前回 Google `404`，發布流程因此改用動態 `config.js` 作為前端存活與後端指向的單一驗證端點，候選與切流後都必須匹配正式 API URL。
- 正式入口固定為 `https://ecom-accounting-frontend-sp5g377smq-de.a.run.app`；舊的 revision tag 網址不再作為日常入口。

## 待使用者協助確認

完整清單另存於 `backend/docs/user-input-needed-2026-04-27.md`，後續凡是缺外部 API 權限、正式報表、密鑰或高風險資料修正規則，都集中更新那份文件。
會計工作台已新增「串接準備」分頁，會從 `GET /reports/connector-readiness` 只讀顯示 Shopify、1Shop、Shopline、綠界、LINE Pay、銀行與廣告費 connector 的內部設定缺口與外部資料需求，不顯示任何密鑰內容。
「串接準備」分頁可直接複製待補清單或匯出 CSV，方便使用者不用讀 Markdown 文件也能逐項補齊資料。

- 可用的管理員帳號登入方式
- Codex/Terminal/Computer Use 權限目前已可操作 Chrome；後續仍要避免讓 agent 直接提交金流、刪除或高風險資料變更
- 目前正式入口是否確定為 Cloud Run，而不是 Render
- 綠界電子發票 API 權限、HashKey / HashIV、字軌設定是否已開通
- `3150241` 是否確定只給 1Shop / 團購 / 未來 Shopline 使用
- 各平台是否有 API、還是只能先用匯出報表

### T. 進項信箱與 ECOUNT 電子發票必須先經過標準化待審層

2026-09-01 已部署並完成正式環境驗收：

- ECOUNT 現場唯讀盤點確認，電子發票模組分為銷項、進項與折讓；目前登入公司的近兩個月銷項有資料，進項清單為 0 筆，進項報表可匯出 Excel。
- ECOUNT 固定 IP 白名單已登錄 Cloud Run 出口 IP `104.199.246.28`，並已簽發測試 API 金鑰；金鑰內容未讀取或輸出。官方公開的 Open API 清單未列出電子發票查詢，且目前尚無已驗證 API，因此不可先假設能直接用 API 拉電子發票。
- 目前 Gmail 連線帳號為 `info@moztech.cc`，可看見部分轉寄到其他收件信箱的郵件，但六個收件信箱並非全部完整覆蓋；正式同步必須採每個信箱獨立 OAuth / 授權與獨立 cursor，不能只靠單一轉寄信箱。
- 新增 `InvoiceSource`、`ExternalInvoiceRecord`、`InvoiceSourceEvidence` 三層模型：來源設定不保存密鑰；標準化發票與原始信箱 / ECOUNT 證據分離；同一發票可保留多個來源證據但只形成一筆 canonical record。
- 新增 `/invoice-sync` readiness、來源登錄、候選查詢與證據 ingestion API。外部資料只先進 staging，不直接建立 AP / AR，也不會開立、作廢或折讓發票。
- 進項發票必須核對收件公司統編；統編不符、缺發票號碼 / 日期 / 含稅金額、或未稅加稅額不等於含稅金額時，一律標記 `needs_review`。已匹配或已匯入的 record 不會因重跑被降級。
- 證據 metadata 會移除 access token、refresh token、Authorization、password、secret、HashKey / HashIV、API key、cookie 等欄位，且限制最大 64 KB，避免把憑證或整封郵件無界寫入資料庫。
- 同一來源的 `externalRecordId` 冪等；同一發票被不同信箱轉寄時，以法人、方向、單據類型、買賣方統編、發票號碼與日期形成 canonical key，不會重複建立候選。
- ECOUNT 與自建 ERP `900324` 已確認為同一法律實體；自建 ERP 主檔已更新並重新讀回統編 `85030997`。
- 公司主檔建立與編輯契約已從前端、DTO、service 三層分離；編輯不再顯示或傳送首位管理員欄位，後端也拒絕更新 API 夾帶管理員欄位，避免密碼管理器自動填入造成儲存失敗。
- Prisma schema validate / generate、backend 26 個 test suites / 91 個 tests、backend build 與 frontend production build 已通過。
- migration job `ecom-accounting-db-migrate-r6fmv` 成功；backend revision `ecom-accounting-backend-00498-fom` 與 frontend revision `ecom-accounting-frontend-00264-zul` 已各承接 100% 正式流量，健康檢查與登入後公司主檔 smoke test 通過，發布後 20 分鐘 error log 均為 0。

正式啟用前關卡：

- 每個 Gmail / Google Workspace 帳號分別完成唯讀 OAuth，token 只放 Secret Manager；先做歷史 dry-run 與各信箱筆數 / 日期範圍核對。
- ECOUNT 先確認電子發票是否有正式查詢 API；若沒有，先用進項 / 銷項 Excel 匯出做歷史回補，再評估受控的唯讀自動匯出流程。
- staging 對照供應商、採購單、收貨單與付款後，才允許人工批准轉 AP；銷項則對照 SalesOrder / Invoice。正式切換前 ECOUNT 維持來源系統，不啟用雙向寫入。

### U. ECOUNT 系統移轉採 API 增量與 Excel 歷史回補雙軌

2026-09-01 已完成第一輪唯讀移轉盤點：

- 登入後 Open API 手冊逐項核對，真正可唯讀查詢的範圍為品項、採購單、庫存總量與分倉庫庫存；客戶／供應商、銷售、進貨、會計憑證、電子發票、職員與出勤沒有對等的查詢 API。採購單每次最多查 30 日、每頁最多 100 筆，正式 connector 必須分日期窗、分頁並保存 cursor。
- 已從 ECOUNT 唯讀匯出 9 份移轉來源：含停用品的完整品項 8,363、客戶／供應商 640、倉庫／工廠 7、部門 9、承辦人 21、專案 17、會計科目 459、職員 20，以及 2026-09-01 分倉庫非零庫存 1,371 列。九份公司抬頭均為 `萬博創意科技有限公司`，原始主鍵皆無空白、無重複。
- 第一次品項匯出只有 1,012 個啟用品，庫存報表卻包含停用品，造成 563 個庫存品號看似不在主檔；重新使用「包括中止使用」匯出 8,363 個品項後，1,371 個庫存品號全部可在主檔找到。這是來源篩選口徑問題，不是遺失 563 筆庫存資料。
- 分倉庫報表的每列庫存合計、六個顯示倉庫加總及報表總計均平衡，六個倉庫欄也都能對應倉庫主檔；但仍有 6 列負庫存、合計 -46,554，必須先分類為允許負庫存、非實體品項或歷史錯帳，不能自動改成零。
- 原始 Excel 只保留在本機 Downloads，未加入 Git；稽核表只保存檔名、工作表、筆數、主鍵名稱與 SHA-256，不複製客戶、聯絡人或員工明細。
- ECOUNT 匯出格式第一列是公司名稱、第二列才是欄名，最後一列另有匯出時間；若使用一般 `sheet_to_json` 預設欄名會誤判資料。新增 `common/imports/ecount-export.ts`，會偵測真正欄名列、排除 ECOUNT 匯出時間、核對公司名稱、必填欄位、原始主鍵與跨檔公司一致性；無法辨識時停止，不猜欄位。
- 新增 `npm run audit:ecount-migration -- --file ...`，只輸出筆數、欄位、雜湊、跨檔核對與問題碼，不輸出逐筆個資。實際 9 份匯出檔 dry-run 目前為 `needs_review`，唯一未通過關卡是 6 列負庫存；資料尚未匯入正式表。
- `artifacts/ECOUNT移轉盤點_2026-09-01.xlsx` 已整理主檔／庫存筆數、API 覆蓋、原始檔雜湊、跨檔核對與正式切換關卡；尚未將任何 ECOUNT 資料寫入自建 ERP 正式資料表。

後續底層原則：

- 品項、採購單與分倉庫庫存改用唯讀 API 做增量同步；API 金鑰只放 Secret Manager，登入 session 短期使用，固定出口 IP 與速率限制由 connector 管理。
- 其他歷史資料由 ECOUNT Excel 匯出進 staging，保留來源檔雜湊、ECOUNT 原始代碼、來源日期與每列 checksum；重跑以來源鍵冪等，不直接 upsert 正式財務資料。
- ECOUNT 的承辦人不等同自建 ERP 員工；客戶／供應商共用主檔也必須拆成 Customer / Vendor；會計科目、倉庫與部門先做 mapping，再由人工批准轉正式主檔。
- 正式切換前仍需補：指定切換日的最終分倉庫庫存、銷貨／訂貨、進貨／採購、庫存異動、總帳與期初餘額、AR/AP、銀行與現金、電子發票／折讓／作廢、薪資與出勤歷史。每一批都先 dry-run、核對筆數與金額平衡，再允許寫入。

### V. ERP 正式自訂網域

2026-09-02 已完成正式網域設定與驗收：

- ERP 對外正式入口改為 `https://erp.corely.cc`；GoDaddy DNS 新增 `erp` CNAME 指向 `ghs.googlehosted.com`，TTL 為 30 分鐘。
- Cloud Run domain mapping 將 `erp.corely.cc` 綁定正式 frontend service `ecom-accounting-frontend`；`Ready`、`CertificateProvisioned`、`DomainRoutable` 均為 `True`。
- Google 管理憑證的 CN / SAN 均為 `erp.corely.cc`；`https://erp.corely.cc/login` 與 `https://erp.corely.cc/config.js` 實測回 HTTP 200。
- 動態 `config.js` 仍指向正式 backend `https://ecom-accounting-backend-sp5g377smq-de.a.run.app/api/v1`，未改接候選或測試環境。
- Chrome 實際載入 `https://erp.corely.cc/login`，頁面標題為「電子商務 ERP」，公司、帳號、密碼與登入控制項均正常顯示。
- 原 Cloud Run 網址 `https://ecom-accounting-frontend-sp5g377smq-de.a.run.app` 保留作為故障排查與復原入口，不再作為日常對外網址；既有 Corely AI 產品子網域未變更。

2026-09-02 ERP API 自訂網域與全鏈路切換：

- 建立 `api.erp.corely.cc` Cloud Run domain mapping，指向正式 backend service `ecom-accounting-backend`；GoDaddy `api.erp` CNAME 指向 `ghs.googlehosted.com`，`Ready`、`CertificateProvisioned`、`DomainRoutable` 均為 `True`。
- Google 管理憑證的 CN / SAN 為 `api.erp.corely.cc`。正式健康檢查、公開登入法人清單、受保護 API 的 `401` 邊界、`erp.corely.cc` CORS 與 Socket.IO polling handshake 全數通過。
- Backend 使用既有正式 image 建立 config-only revision `ecom-accounting-backend-00502-qek`，100% 流量；`CORS_ORIGIN` 只保留 `https://erp.corely.cc`，並將 `APP_BASE_URL`、`FRONTEND_PUBLIC_URL`、`FRONTEND_URL`、`PAYMENT_LINK_BASE_URL` 統一為 `https://erp.corely.cc`。
- Frontend 使用既有正式 image 建立 config-only revision `ecom-accounting-frontend-00266-xah`，100% 流量；正式 `/config.js` 的 REST API 與 WebSocket 分別為 `https://api.erp.corely.cc/api/v1`、`https://api.erp.corely.cc`。
- GitHub Variables `FRONTEND_API_URL`、`FRONTEND_WS_URL`、`ERP_PUBLIC_FRONTEND_URL`、`ERP_PUBLIC_API_URL` 已同步為 Corely ERP 網域；前後端 workflow 新增正式網域契約與發布後 custom-domain smoke test，避免後續部署退回 Cloud Run 原生網址。
- 電子發票、Shopify、1Shop、Shopline、Meta Ads、Google Ads 六條 Cloud Scheduler URI 均改為 `api.erp.corely.cc`；更新前後逐項比對 schedule、timezone、state、retry、method、headers、body 均未改變。切換後實際執行收據為電子發票 HTTP 200，其餘五條 HTTP 201。
- 瀏覽器重新載入 `erp.corely.cc/login` 後，登入法人 API 由 `api.erp.corely.cc` 回 HTTP 200。第三方 Shopify、1Shop、Shopline、綠界、Meta、Google 官方 API host 不改寫、不經自建網域代理。
- Cloud Run 自動產生的 service / revision tag 網址仍存在，僅用於零流量候選驗證、平台維運與故障復原；ERP 的人員操作、前端 runtime、公開連結與正式排程一律使用 Corely 自訂網域。

### W. 售後管理整併採完整功能保留與 ERP 單一資料源

2026-09-02 已完成第一輪唯讀盤點與整併規格：

- 使用者確認現有售後系統每項功能皆為已設計的正式需求；整併不得以簡化模組取代、不得使用 iframe，也不得讓舊系統與 ERP 長期雙寫庫存、付款、退款或發票。
- 正式售後 Cloud Run service `moztech-after-sales-system` 的 revision `00253-vfv` 目前承接 100% 流量，使用獨立資料庫、認證、LINE / LIFF、付款憑證、綠界發票與保固來源。
- 正式資料唯讀基準為 613 筆案件，其中 499 筆有效、114 筆軟刪除；有效案件包含漏寄補寄 66、私下購買 131、來回件 67、退款派車 58、維修 177。另有 682 筆商品明細、371 筆正向物流、284 筆逆物流、268 筆付款、51 筆退款、521 筆發票、4,911 筆 Timeline 與 5,138 筆 Audit。
- 499 筆有效案件都有 Timeline 與 Audit。75 筆歷史商品明細缺 `productId`，必須進人工 mapping queue；不允許用名稱、金額或相似 SKU 猜測配對。
- 現有售後系統只保存庫存處置結果，尚未寫入 ERP `InventoryTransaction`；商品服務目前也仍讀售後資料庫自己的 Product 表，不是真正的 ERP 商品 API。
- ERP 現有 `AfterSalesCase` 僅涵蓋簡化來回件流程；`markPaid()` 會直接製造內部已開立 Invoice，而收件與出貨只改案件狀態、不產生庫存流水。這三項必須先從 domain logic 拆開，不能以畫面補丁處理。
- 完整功能保留、資料責任、狀態機、庫存與發票規則、遷移階段及驗收門檻已整理於 `backend/docs/after-sales-erp-integration-audit-2026-09-02.md`。
- GitHub 遠端再核對後發現售後本機 checkout `523792c` 落後 `origin/main=6ed5d6d` 共 70 個 commits、97 個檔案；新增或修正維修報價、保固來源、ERP 商品搜尋、物流稽核、發票重開與角色權限等能力。依使用者後續指定，`523792c` 固定為不得遺失的功能驗收基線；遠端 70 個 commits 逐項當作候選修正審核，不直接混入或覆蓋。ERP 工作分支 `7f60c5e3` 相對 `origin/main` 為 ahead 20 / behind 0，但本機仍有未提交工作，因此未執行 pull、reset 或 checkout。

2026-09-02 第一個安全建構切片：

- `523792c` 功能驗收基線與隔離的 `origin/main=6ed5d6d` 候選都已新增受服務金鑰保護的 health、案件增量清單與案件完整明細 API；使用明確 select 排除 `passwordHash` 與認證設定。
- ERP 已新增 `/api/v1/after-sales/readiness`、`/api/v1/after-sales/legacy/cases` 與案件明細入口，瀏覽器不接觸舊系統金鑰；JWT 與角色權限保持在 ERP 邊界。
- 缺設定、授權失敗、網路失敗與查詢逾時都 fail closed，不會以空資料代表同步成功。
- 70 個遠端 commits 已逐項分類並固定功能差異矩陣；完整清單與採用邊界記錄於 `backend/docs/after-sales-523792c-remote-delta-review-2026-09-02.md`。
- ERP 已建立售後類型／狀態契約、來源 payload 稽核器、穩定 checksum、重複來源與商品 mapping 待審規則，以及 preview、preview-page、stage-page 三個管理入口。
- 已產生但尚未套用 `AfterSalesImportRun` / `AfterSalesImportCandidate` staging migration；stage-page 只寫暫存快照與稽核結果，不建立正式案件，也不觸發庫存、付款、退款或開票。
- `markPaid()` 已在 domain service 從付款與發票耦合中拆開，且補上會計、收件、出貨階段守門與冪等測試；前端不再宣稱付款時已自動開票。
- 建案、商品付款設定與出貨 API 已改用 typed DTO，會在進入服務層前拒絕未知欄位、無效 ID、空明細、負數金額與無效日期。
- 兩個舊售後候選的 Next production build 與 lint 通過；隔離候選 auth test 1/1 通過；ERP backend 33 suites / 119 tests、backend build、frontend build 及 Prisma format / validate / generate 通過。舊售後依賴樹另有 29 個 audit 項目，列為部署前阻擋條件。
- 此切片尚未建立正式 Secret、尚未套用 migration、尚未部署，也沒有正式庫存、付款、退款或發票寫入。

2026-09-02 staging 部署與影子匯入收據：

- 使用者只授權進入 staging，未授權正式庫存、退款或開票寫入。正式 `moztech-after-sales-system-00253-vfv` 與 `ecom-accounting-backend-00502-qek` revision 及其正式流量均未變更。
- 新增 IAM 限制的 `moztech-after-sales-exporter-staging-00001-lt5`。服務以 `READ_ONLY_EXPORTER_MODE=true` 啟動，明確跳過 migration / bootstrap，只允許 `/api/integration/v1/*` 的 GET / HEAD；未授權請求為 HTTP 403，只有 ERP runtime service account 可 invoke，應用層另以 Secret Manager 金鑰驗證。
- 新增隔離 PostgreSQL database `erp_after_sales_staging`。空白資料庫第一次重建揭露歷史 seed migration 的 raw SQL 未提供 UUID 主鍵；已從 migration 根因修正並加入回歸測試，成功 execution 為 `ecom-accounting-after-sales-staging-migrate-ncvd5`。bootstrap 亦改用與正式啟動相同的 Cloud SQL URL 組裝邏輯，成功 execution 為 `ecom-accounting-after-sales-staging-bootstrap-8bhvj`。
- ERP staging service `ecom-accounting-backend-after-sales-staging-00002-n44` 使用 image digest `sha256:21b72502d63bf232bb27b5f96ff39423f9e17fd2a68fb8fe8f45b97f181eada7`；Cloud Build `839fbb8d-1cce-437c-bd39-5f5ea8efadc6` 成功。服務只連 staging DB，Shopify、1Shop、Shopline、ECPay invoice、Meta、Google 與 reconciliation 自動同步旗標均明確關閉。
- 端到端 readiness 經 Cloud Run IAM token、ERP JWT 與 exporter 應用金鑰三層驗證回 HTTP 200：`connected=true`、`mode=read_only`、`sourceCommit=6ed5d6d`、`featureBaseline=523792c`。
- 目前來源為 614 筆：500 筆有效、114 筆軟刪除。有效案件為漏寄補寄 66、私下購買 132、來回件 67、退款派車 58、維修 177；相較 16:12 的基準新增 1 筆私下購買案件，屬來源真實增量，不覆寫舊基準。
- 13 頁全量 dry-run 為 candidate 487、needs review 13、deleted 114，另有 75 個商品明細缺 ERP product mapping。第一次 staging 建立 614 筆候選；立即重跑結果為 `created=0`、`updated=0`、`unchanged=614`，證明 source key + checksum 冪等。ERP 正式 `AfterSalesCase` 在隔離資料庫仍為 0。
- case-scoped 子表 shadow count 為商品 684、正向物流 371、逆物流 286、付款 270、付款請求 328、付款提交 225、退款 51、發票 522、CASE Timeline 4,710、CASE Audit 4,374。來源整張表另有 INVOICE Timeline 220 與其他 entityType Audit 783；直接分組查詢證明先前 4,911 / 5,138 是全 entityType 基準，CASE payload 數量較少不是遺失。
- 售後切片最終驗證為 6 suites / 24 tests、Nest production build 與 `git diff --check` 通過。Secret 值、JWT、客戶個資與來源 payload 均未寫入文件或終端收據。
- 為避免主工作目錄既有未提交內容被混入，已在隔離 worktree 建立可追溯的本機 commits：ERP `fa73e85e`、售後 exporter `7dfa2a5`；尚未推送遠端，也未替使用者整理或提交主工作目錄的其他變更。

下一步：加入 `snapshotAt` / high-watermark 契約，核對 staging payload 內付款、退款與發票金額及關聯欄位，處理 13 筆待審案件與 75 個商品 mapping；再建立 ERP 正式售後案件聚合模型與 typed commands，讓 inventory、payment/reconciliation、refund、invoice 各自由原生服務持有 single-writer。在逐欄 shadow compare、測試交易與另一次正式啟用授權完成前，不啟用正式庫存、退款或開票寫入。

2026-09-04 唯讀工作台建構（尚未部署）：

- ERP `/sales/after-sales` 已新增原生工作台；經服務端 API 查詢舊案件，保留六類流程與各案件相關明細，沒有將舊系統直接 iframe 嵌入或共用密碼。
- 新增服務端分頁搜尋、來源版本與明細完整性驗證、欄位允許清單、公司綁定、專用售後讀取權限及資料範圍守門；故障不顯示成零筆、切換查詢不顯示舊結果。
- 真實來源唯讀驗證有效案件 514 筆、待處理 49、急件 1、已結束 465；五個有資料類型的明細通過投影驗證。這是新程式直接查來源資料庫的結果，不是新 HTTP 候選已部署的證明。
- Backend 35 suites / 133 tests、frontend 四項規則測試、來源五項測試、前後端 build、新增檔案 lint 及本機瀏覽器驗證通過。套件安全掃描服務逾時，該 gate 仍未通過。
- 遠端新增發票重寄／列印 commit `85135a0` 已納入待驗收清單。舊 enum 與庫存顯示名稱不一致，禁止依名稱猜測 ERP 庫存動作。
- 詳見 `backend/docs/after-sales-workbench-handoff-2026-09-04.md`。本輪未部署、未改正式流量、未開通正式交易寫入；完整交易整合與單一登入尚未完成。

2026-09-09 LUNA 公司範圍讀取授權（獨立於售後工作台）：

- 使用者明確確認 MOZTECH 各模組的公司資料讀取，不限報表；投放、付款、退款、出貨等寫入仍需具體確認。
- 原 LUNA 服務身分沒有角色或公司 membership，八項 data scopes 都是 SELF，報表回 403。已建立專用 `LUNA_MOZTECH_BUSINESS_READ` 角色，持續性賦予既有十類業務 read、八項 ENTITY scopes，唯一公司為 `tw-entity-001`；沒有授予 ADMIN／SUPER_ADMIN 或建立新憑證。
- 正常賦權 API 發現 `SetRolePermissionsDto` 的 UUID v4 限制與正式資料庫七項 legacy `perm_*` ID 不相容。未更名 ID、未借用管理員角色；沿用正式 immutable image 的一次性維護工作，以單一 Serializable transaction 寫入精確的 role permissions、user role、membership 與 scope，沒有業務資料寫入。成功 execution：`luna-company-read-apply-676674fb1b8cf762-9vpwv`。正式 ERP revision／traffic 未變更。
- LUNA 自有身分實測十項 read 與唯一公司均通過；兩種報表與會計科目可讀，新倉庫／庫存／供應商 GET 投影回空清單，不解讀為零庫存或完整資料。LUNA 容器的所有新增工具和既有四來源驗證通過，主程式沒有重啟。
- 仍需窄幅正常修正並發佈 DTO：有界非空 string IDs + 既有 permission catalog 存在性檢查，保留權限與交易守門。另有部分舊 products/customers 路由未明確限公司、GET 具有寫入副作用、leave nested User 可能含機密欄位，未將它們開放到 LUNA 的私有讀取接口。這些是 source review 發現，尚未聲稱全部 production routes 已修好。
- 驗證／程式與完整未接通範圍記錄在 `luna-single-agent/single-agent/COMPANY-READ-ACCEPTANCE.md`。本次保留此 ERP 工作樹全部既有售後變更，沒有打包或部署整份工作樹。

2026-09-10 Corely AI 營運管理系統／售後管理中心（本機候選）：

- 在隔離分支 `codex/operations-corely-20260910` 整理品牌與導覽；沒有覆蓋原 checkout 的未提交工作。
- 總入口命名「售後管理中心」，來回件保留 source EXCHANGE_RETURN 案件分類。維修、報價、補寄等入口使用原售後查詢，不走 ERP 原生簡化來回件流程。
- 桌機取消 768–1023px 強制收合；預設展開分組，手動收合/展開持久化；手機用 Drawer。依使用者原權限過濾選單，新增帶 query 的精確選取。
- Corely 品牌與共用控制項 token、登入名稱已修改；移除登入假社群按鈕及密碼強度提示。功能搜尋與 sidebar 共用路由/權限，不再呈現無作用的假命令。
- `npx --package tsx tsx --test tests/navigation.test.ts tests/after-sales-workbench.test.ts` 8/8 通過；前端 TypeScript/Vite build 通過，仍有既存 bundle 大小及 browserslist 資料過期警告。
- 本機 fixture 瀏覽器：900px sidebar 248px；手動收合並 reload 後 72px；390px 手機 Drawer 320px、頁面無水平溢出、可 Escape 關閉。非正式資料驗證，沒有 production mutation。
- 既有 Ant Design Input.Search addonAfter deprecation 仍有警告，不宣稱全站零警告。正式部署、來源 command API、SSO、全量物流號查找及角色佇列仍未完成。
- 實作次序與原流程邊界見 `after-sales-center-integration-2026-09-10.md`。售後 source 領域服務本次未修改；正式庫存、退款、發票寫入未啟用。

2026-09-10 品牌設定／案件報價草稿（本機候選，未部署）：

- 新增品牌 metadata 管理、原維修案件品牌解析、不可變報價草稿與建立新版／顧客版預覽。AIRITY 保持獨立品牌；預定「萬博創意科技有限公司／萬魔未來」僅存本機合成 fixture，統編與正式商戶映射仍待核對。
- 新增三表 migration、company/source guard、品牌 CAS、案件品牌交易綁定、actor + idempotency key/hash、精確小數金額及顧客欄位 allowlist。未知或衝突品牌 fail closed，不回退 MOZTECH。
- 前後端 build、後端 20 tests、前端 8 tests、Prisma validate 通過；isolated in-memory PostgreSQL migration/constraints 測試通過。瀏覽器完成品牌保存、測試案件草稿、預覽、重新載入、鎖定品牌與建立新版驗證。
- 未驗收真正 Cloud SQL/Nest/source 全链路；預覽用 localhost 合成 fixture。未部署／未套用 migration，正式 LINE 憑證、發送、付款、發票與庫存寫入均未啟用。source command API 與多租戶/部門角色 parity 仍未完成。

2026-09-10 儲運原生介面與私有 staging（更新上述本機候選狀態）：

- 使用者否定外部工作台連結；已移除外連，改為 ERP 原生 `/warehouse` 清單、揀貨／裝箱／物流／未取退回篩選、分頁、搜尋與站內明細。預覽使用明示合成資料，真實 command 尚未開通。
- WMS 以實際 `9b376526` 為基準建立獨立 worktree，查得舊 order GET 有修改狀態副作用；新增 READ ONLY transaction、即時角色與可信 mapping 邊界的獨立 read service，不轉接舊有副作用 handler。尚未掛載 HTTP 或部署 WMS。
- ERP 契約及 company/brand/order/logistics 嚴格對照、故障拒絕和事實分離測試已加入；未接來源的受權限保護 route 明確 503，不回假零筆。ERP 後端 38 suites / 166 tests、前端 9 tests、WMS 2 tests 與 builds 通過。
- 新三表 migration 只套用到 `erp_after_sales_staging`，execution `erp-ops-schema-0910-xdhxt` 成功。私有候選後端 `00003-jxn` Ready；健康與 DB readiness 200，匿名 403，排程與 startup seed 關閉。
- 使用者拒絕 frontend invoke grant：未新增 IAM、未公開 staging。前端已 build 但未部署，真實瀏覽器聯調、售後來源版本／公司 mapping、WMS service identity、employee/order/brand mapping 與交易 parity 仍是阻擋項。
- 正式 ERP／WMS 流量、原 checkout 與另一套售後程式未更動。詳見 `operations-staging-receipt-2026-09-10.md`、`wms-integration-2026-09-10.md`。不能宣稱完整整合或正式上線。

2026-09-10 儲運職務工作區與原生掃碼（本機增量）：

- 品牌設定命名統一；新增儲運工作區導覽／登入導向、訂單調度／揀貨／裝箱／出貨區域，純儲運角色只見出貨與自己的資訊。搜尋共用同一份權限導覽。
- 原生揀貨／裝箱面板、進度、SN／條碼輸入及測試角色切換完成。瀏覽器完成同一合成訂單揀貨→裝箱→核對完成，重複 SN 不增加數量；沒有產生物流交接或實收事實。
- 新增五項 WMS 權限 catalog migration，未套用、未賦權；後端不再以 inventory:read 當作出貨權限。未接來源的 GET／POST 仍受 guard 保護並回 503，沒有真實命令寫入。
- 前端 13 tests、後端 39 suites / 170 tests 與前後端 build 通過。正式角色指派、來源身分與 mappings、持久命令交易、建單匯入、完整舊功能 parity、真實人資範圍與端到端驗證未完成。
- 本輪沒有部署、IAM 或正式流量變更，遵守私有 staging 限制。具體責任與缺口見 `warehouse-workspace-2026-09-10.md`。

2026-09-11 ERP / WMS 同人多工作站查詢橋接（本機增量）：

- ERP GET 清單／明細由 placeholder 改接預設關閉的受控服務；每次重查員工啟用與工作站權限，簽發固定 scope 的短效委派。來源 WMS 新增獨立唯讀 router、空 mapping 三表 migration 和任務歸屬檢查，不轉接舊有副作用 GET。
- 同一 actor 的 pick / pack 雙授權及撤銷已測試；不修改帳號 role，不把 inventory:read 升為出貨操作。來源品牌／公司／訂單與未指派／本人任務隔離；正式 POST 仍不開通。
- 真正 localhost HTTP 串連 ERP 編譯後 bridge、WMS 簽章驗證與隔離 PGlite SQL 通過；不是前端 fixture，也不是正式登入／雲端 DB 驗收。ERP 40 suites / 173 tests、前端 13 tests、WMS 3 tests 與 builds 通過。
- 未建立正式金鑰、未寫正式 mapping、未套 migration、未部署或改 IAM。私有 staging 及原 checkout 不動；恢復本機 4396 fixture 並驗證清單／明細。
- 仍需實際帳號／公司／品牌範圍核准、source commands 共用服務、拋單匯入、語音通知、封箱貼標交接、硬體與全流程驗收。詳見 `wms-source-bridge-2026-09-11.md`，不得宣稱整套出貨已整合上線。

2026-09-11 業務建單、揀貨／裝箱工作站与持久命令（本機增量，未部署）：

- 業務新增 pending 訂單、同公司通路／客戶／商品驗證、建單權限、既有單號搜尋與拋單預覽接入 ERP。存單與拋轉分開，不自動扣庫存／開票；移除訂單頁標題下冗長旁白。
- 揀貨／裝箱改成原生整頁工作站，明確任務、大字剩餘件數、固定掃碼區、成功／錯誤／整單完成音效與可選語音。完成不跳離本站；工作站切換限定已授權角色，純倉儲導覽維持自身工作＋個人資訊。
- ERP durable dispatch intent、WMS transaction/CAS/receipt/audit、逐項 SN／條碼核對、tracking intent、撤銷與公司品牌權限守門已實作。來源成功但回應遺失的重試不建立第二張訂單；SN 遺失或數量異常拒絕作業。
- 查詢完成後隔 3 秒更新；新任務 readyKeys 不受頁碼／搜尋影響。這不是 Socket 推送或持久離線事件。音訊裝置錯誤不影響已保存的命令結果。
- ERP backend 42 suites / 179 tests、frontend 18 tests 與前後端 build 通過；WMS read/commands 5 tests、跨 repo 兩個暫存 DB＋localhost HTTP 4 tests 通過。合成瀏覽器測試走完建單→拋單→揀貨錯碼／正確掃碼→另一裝箱站二次核對；不是正式帳號、Cloud SQL 或硬體驗收。
- 所有新 migrations 均未套用，無部署、push、IAM 或正式流量變動。Write router 限定獨立 staging DB 並核對實際 DB 名稱，拒絕 `corely_wms`；舊 WMS direct writers 尚未完成安全共存隔離，不能僅打開 flag 就上線。
- SN 配置來源（業務先指定／揀貨才綁定）已詢問使用者，未自行假設；需 SN、混合品牌、組合／服務商品先擋下。正式 mappings／員工賦權、Excel全部格式、每日排班、標籤／封箱／物流、實收、庫存財務與完整 parity 仍待驗收。
- 交接與重跑指令見 `warehouse-workflow-2026-09-11.md`。私有 staging 限制、原 checkout 及另一套售後系統均維持不動。
