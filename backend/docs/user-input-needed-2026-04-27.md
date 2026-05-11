# 需要使用者補資料 / 確認清單 - 2026-04-27

這份文件專門記錄「Codex 不能自行完成、需要你提供外部資料或明確確認」的項目。  
原則：不要把密碼、HashKey、HashIV、Channel Secret、access token 直接寫進 repo；請放到 GCP Secret Manager / Cloud Run env，或只提供給一次性終端機設定流程。

## 最高優先

### 1. 綠界電子發票正式開票與狀態同步

- 需要你提供 / 確認：
  - 2026-05-04 更新：`3290494` 的 MerchantID / 電子發票 HashKey / HashIV 已由使用者提供，已放入 GCP Secret Manager 並掛到 Cloud Run backend；金鑰不可寫入 repo。Cloud Run readiness 已確認 `shopify-main` ready，正式開票開關仍維持 `false`。
  - 2026-05-04 更新：`3150241` 的 MerchantID / HashKey / HashIV 已由使用者確認為 1Shop 綠界「電子發票」介接金鑰；金鑰不可寫入 repo，已放入 GCP Secret Manager 並掛到 Cloud Run backend。正式開票開關仍維持 `false`，只允許 readiness / 只讀查詢。
  - 兩個帳號是否具備 B2C / B2B 開立、查詢、作廢、折讓、折讓作廢 API 權限。
  - 字軌 / 配號查詢 API 是否可用，以及正式字軌是否已配好。
  - 是否可用 stage 或正式小額測試單測 `Issue` / `GetIssue` / `Invalid` / `Allowance`。
- 目前系統狀態：
  - 已有綠界電子發票 Adapter、readiness API、正式開票開關。
  - 正式環境已阻擋本地假字軌開票、只本地作廢、只本地折讓。
- 暫停原因：
  - 沒有正式密鑰與 API 權限確認前，不能啟用真實開票或作廢折讓。
- 可先做的替代流程：
  - 先用「綠界銷項發票匯入」把正式已開發票回填系統。

### 2. 超收 / 疑似重複收款的真實修正規則

- 需要你確認：
  - 是否要把 `高度疑似重複匯入` 轉成正式人工審核隊列。
  - 審核欄位要記錄哪些資料：審核人、審核時間、原因、附件、保留 Payment、候選重複 Payment。
  - 真正修正資料時要採用哪種方式：作廢重複 Payment、合併 Payment、建立調整分錄、或保留原始資料只標記排除。
- 目前系統狀態：
  - 已有只讀診斷、分類、候選重複 Payment ID、分頁、篩選、CSV 審核清單匯出。
- 暫停原因：
  - 刪除、合併、沖銷 Payment 會改動真實財務資料，必須先有公司規則與人工確認。

### 3. 1Shop + 綠界 `3150241` 歷史閉環資料

- 需要你提供 / 確認：
  - 1Shop 2024 年以前是否允許 API 匯出。
  - 若 API 某段回空，需提供 1Shop 匯出 Excel 補洞。
  - `3150241` 綠界撥款 / 金流對帳報表。
  - `3150241` 綠界銷項發票報表。
  - 團購平台費 / 服務費來源：綠界撥款、服務費發票、平台報表，或其他正式來源。
- 目前系統狀態：
  - 1Shop 2025 歷史資料已大量回補。
  - 1Shop 團購閉環補跑入口已存在。
  - 目前仍有缺發票 / 缺手續費 / 待核銷缺口。
- 暫停原因：
  - 缺正式撥款、發票、平台費來源時，系統不能猜手續費或強行核銷。

### 3-1. 排程自動核銷策略

- 需要你確認：
  - Cloud Scheduler / 自動對帳 Job 是否允許在無人工二次確認下自動寫入核銷分錄。
  - 若允許，需要先定義可自動核銷的營運邊界，例如：只限特定通路、特定日期、特定金額上限、已匯入正式發票與實際手續費、已完成抽樣驗證。
- 目前系統狀態：
  - 前端手動入口已改為「同步 / 補跑」和「核銷」分流。
  - 後端核心對帳、1Shop 團購閉環、LINE Pay 閉環已改成只有明確傳 `autoClear=true` 才會寫入核銷分錄；未傳值時只同步與重算。
  - LINE Pay 退款沖銷也已改成 opt-in；一般狀態刷新與閉環補跑不會順手建立反向分錄。
  - 本機 / 排程 closure-pass script 也改為 opt-in；只有加 `--auto-clear` 才核銷，只有加 `--process-linepay-refund-reversals` 才建立退款反向分錄。
- 暫停原因：
  - 自動核銷會建立正式 Journal / 更新 Payment 狀態，屬於高風險財務寫入；排程是否啟用自動核銷需要公司規則確認。
  - 退款沖銷也會建立正式反向分錄，需確認退款、折讓、發票作廢或折讓單的公司規則後再批次化。

## 通路 / 金流

### 3-2. 綠界金流 / 物流 / 電子收據 / MPOS 服務範圍

- 2026-05-04 更新：
  - 使用者已提供並確認 `3290494`、`3150241` 兩個綠界帳號的介接分類包含：金流 / MPOS、電子發票、物流、電子收據。
  - 金鑰不可寫入 repo；電子發票金鑰已先放入 GCP Secret Manager。金流、物流、電子收據、MPOS 若後續建立正式 connector，也應用各自 service secret / JSON profile 管理，不要混在文件或程式碼裡。
- 後續是否會用到：
  - 金流：一定會用。用途是訂單付款、撥款、退款、實際金流手續費、銀行入帳核銷與關帳。
  - 物流：若 Shopify、1Shop、Shopline 或團購使用綠界物流 / 超商取貨付款 / 貨到付款，就會用到。用途是出貨狀態、物流費、代收款、在途應收與庫存出貨閉環。
  - 電子收據：若有不開電子發票但需要收據 / 憑證的交易或費用流程，就會用到。電子收據不可取代電子發票；需先確認公司哪些場景會用。
  - MPOS：若有實體門市、快閃、展場、電話刷卡或現場刷卡收款，就會用到。這類付款應獨立標記為 `channel=offline/mpos` 或對應營業據點，再跟綠界撥款與銀行入帳核銷。
- 目前系統狀態：
  - 電子發票只讀查詢已完成雙帳號 readiness 與 Cloud Run 驗證。
  - 金流已有 Shopify 綠界同步骨架與撥款 / payout import 流程，但多綠界帳號完整金流同步、退款與手續費回填仍需補齊。
  - 物流、電子收據、MPOS 尚未形成正式 connector。
- 仍需你確認 / 提供：
  - 哪些通路實際使用綠界物流，是否包含代收款 / 貨到付款 / 超商取貨付款。
  - 是否有實體或展場 MPOS 收款；若有，需提供據點 / 活動 / 通路歸屬規則。
  - 是否真的有使用「電子收據」服務，以及它和電子發票的使用邊界。
  - 綠界金流 / 物流 / MPOS / 電子收據是否共用同一組特店代號，但仍需分 service 管理權限與 API 測試。

### 4. Shopify 歷史訂單權限

- 需要你確認：
  - Shopify app 是否具備 `read_all_orders`。
  - 若沒有，需要向 Shopify 申請 / 開通，否則 60 天以前訂單可能無法完整 API 回補。
- 目前系統狀態：
  - Shopify 連線健康狀態曾驗證成功。
  - 已有訂單同步與綠界 Shopify 撥款同步骨架。

### 5. Shopline 正式同步

- 需要你提供：
  - 若未來增加第二間 Shopline 店，需提供每店的 token / handle / 名稱 / merchant id。
  - webhook 是否已開通；可訂閱哪些 topic。
  - Shopline API token 是否已勾選 `read_payment` 權限；若未勾，Payments API 會無法查帳務。
  - 若要補兩年以上資料，需確認 archived orders 匯出流程可用。
- 目前系統狀態：
  - 2026-05-05 更新：使用者已提供 Shopline `access_token`；不可寫入 repo。已放入 GCP Secret Manager 並掛到 Cloud Run backend。
  - 2026-05-05 更新：Shopline adapter 已調整為 token-only 時也可先查 `token-info`，用來確認 token 對應的 merchant / handle；修正後 token 已由 Cloud Run 驗證可讀到 BONSON 店鋪資訊。
  - 2026-05-05 更新：Shopline 後台 IP 白名單已加入 Cloud Run 固定出口 IP；Cloud Run `connection-info` 已可讀到 Shopline 設定。
  - 2026-05-05 更新：已確認正式 `User-Agent / handle code` 使用 `onemorefuture`；程式會在 request header 帶入 `User-Agent: onemorefuture`。
  - 2026-05-05 更新：已確認 Shopline Merchant ID 為 `5e0738e792f5c90009548b54`；Cloud Run 應固定設定 `SHOPLINE_MERCHANT_ID`，避免診斷與後續同步每次都依賴 `token-info` 推導。
  - 2026-05-05 更新：已新增只讀 `agents` 診斷端點，依 Shopline 文件用 `token-info` 取得 `merchant_id` 後呼叫 `GET /v1/agents`；Cloud Run 呼叫成功，目前 Shopline 回傳 agents 0 筆。
  - 2026-05-05 更新：本機直接 curl Shopline 仍會回 IP 白名單錯誤，這是預期狀態；正式驗證要從 Cloud Run backend 走固定出口 IP。
  - 2026-05-05 更新：已新增 `preview/orders`、`preview/customers` 只讀端點；正式匯入前已用最近 30 天 dry-run 驗證 Shopline 回傳 728 筆訂單、1410 筆顧客事件，mapping 可用。
  - 2026-05-05 更新：已用一般 OpenAPI 依 30 天區間回補 `2024-05-05` 到 `2026-05-05`。Cloud Run summary 顯示 SHOPLINE 已進 `SalesOrder` 4689 筆，總額 9,250,001；Payment 4687 筆，gross/net 8,488,187。
  - 2026-05-05 更新：已建立 Cloud Scheduler `ecom-accounting-shopline-auto-sync`，每 20 分鐘呼叫 `POST /integrations/shopline/sync/auto`；`SHOPLINE_SYNC_ENABLED=true`，lookback 240 分鐘。手動驗證 auto sync 成功抓到最近 4 小時 56 筆訂單與 63 筆顧客事件。
  - 2026-05-06 更新：再檢查 Cloud Run 設定，Shopline token / handle / merchant id / sync enabled 都已掛上；手動觸發排程回應 HTTP 201，最近排程記錄可正常完成增量同步。
  - 2026-05-06 更新：官方文件確認 SHOPLINE Payments 有 Admin OpenAPI 可查帳務與提款：`balance_transactions.json`、`transactions.json`、`payouts.json`、`balance.json`，需要 `read_payment` 權限。
  - 2026-05-06 更新：後端已補上 Payments 只讀預覽端點與 `sync/payments/billing-records` 匯入端點，會把 `balance_transactions.json` 的帳務明細轉成 `shoplinepay` provider payout rows。
  - 2026-05-07 更新：Cloud Run 實測一般 Shopline OpenAPI 仍可用，但 Payments Admin OpenAPI 回 HTML / redirect，尚未回有效 JSON。後端已補 `GET /integrations/shopline/payments/readiness` 與明確錯誤訊息，下一次部署後可直接看到是 admin base URL / handle / version / `read_payment` 權限 / Shopline Payments OpenAPI 啟用問題。
  - 2026-05-08 更新：上述診斷已部署到 Cloud Run revision `ecom-accounting-backend-00322-ww8`。`payments/readiness` 顯示一般設定完整，但 `https://onemorefuture.myshopline.com/admin/openapi/v20260301` 會 302 redirect 到 `https://www.shopline.com`，需向 Shopline 確認 Payments Admin OpenAPI 的正確 host / version / `read_payment` 權限或服務啟用狀態。
  - Shopline Adapter / Service / Controller 已存在。
  - 訂單、顧客、Payment 草稿同步骨架已存在。
- 暫停原因：
  - 一般 orders / customers / Payment 草稿資料已進系統；Payments API 程式已補上，但 Cloud Run 實測 Payments Admin API 目前被 302 redirect。剩餘缺口是確認正確 Payments Admin OpenAPI host / version / `read_payment` / Payments OpenAPI 啟用狀態、兩年以上 archived orders 匯出、webhook topic 與簽章驗證、商品 / 分類 / 庫存主檔同步、Shopline invoice 欄位正式回寫。
- 品牌 / 平台歸屬確認：
  - 使用者已確認 `萬魔未來工學院` 是平台，不是商品品牌。
  - 若要精準統計品牌貢獻，需讓商品主檔、SKU 或商品名稱有穩定品牌欄位 / 前綴，例如 `BONSON｜商品名`、`MOZTECH｜商品名`，或後續建立正式商品品牌欄位。
- Shopline Payment 對帳檔確認：
  - 2026-05-06 使用者提供 2026-04 的 Payout / Reserve / Unsettled account consolidated statement。
  - 系統已新增 `shoplinepay` provider 匯入映射，可吃逐筆明細欄位並回填 Payment 實際手續費 / 淨額。
  - 目前檔案主要是月彙總 / 日彙總，逐筆 `帳戶收支明細` 不完整；若要全月逐筆核銷，仍需 Shopline Payment 完整交易明細匯出或 API。
  - 2026-05-06 使用者另提供 `帳務明細查詢.xlsx`，這份是可用的逐筆帳務明細，共 1009 筆資料列；系統 `shoplinepay` 映射已補上這份欄位，可用來測試逐筆 Payment matching。

### 6. LINE Pay / TWQR / 行動支付分流

- 需要你確認 / 提供：
  - LINE Pay / TWQR / 行動支付是否出現在綠界 `3290494` 撥款報表內。
  - 若沒有出現在綠界報表，需提供 LINE Pay Merchant 後台 CAPTURE / 結算報表或可用 API 文件。
  - 第二個 LINE Pay 帳號若要接入，需提供 Merchant ID、Channel ID、Channel Secret、品牌 / 通路歸屬。
  - LINE Pay 不需要電子發票 HashKey / HashIV；電子發票仍由綠界電子發票帳號 `3290494` / `3150241` 開立與查詢。
  - 若是 LINE Pay 直連 API，需提供 LINE Pay Merchant Center 的 Channel ID / Channel Secret；若只是固定付款碼商家，LINE Pay 官方 FAQ 說無法使用 LINE Pay API，也無法查到 Channel ID / Channel Secret。
- 目前系統狀態：
  - 已支援 LINE Pay profile loader、config status、付款查詢、CAPTURE 匯入、狀態刷新、退款反向核銷骨架。
- 暫停原因：
  - 分不清「綠界撥款內的 LINE Pay」或「LINE Pay 獨立撥款」前，不能混入同一條對帳鏈。

## 銀行 / 費用 / 廣告

### 7. 銀行入帳資料

- 需要你提供：
  - 主要銀行帳戶的對帳單 CSV / Excel 範本。
  - 欄位定義：交易日、入帳日、摘要、金額、手續費、餘額、交易序號。
  - 哪些銀行帳戶對應 Shopify / 1Shop / LINE Pay / 廣告扣款 / 一般費用。
- 目前系統狀態：
  - 銀行模組與匯入端點已存在。
  - 正式資料快照顯示 Bank transactions 仍為 0。
  - 銀行交易頁已補上 CSV 匯入範本下載、銀行帳戶選擇與實際匯入流程。
  - 銀行 CSV parser 已支援逗號 / 分號 / tab、引號欄位、民國年日期與常見金額格式。
  - 銀行匯入已改成先預覽、再確認匯入；預覽不會寫入銀行交易。
- 暫停原因：
  - 沒有真實銀行流水或格式範本，無法完成銀行入帳 matching。
  - 系統可先吃標準 CSV 欄位，但仍需要你提供各銀行正式匯出格式，才能做更穩定的欄位 mapping 與小批量驗證。

### 8. 廣告費 connector

- 需要你提供 / 開通：
  - Meta / Facebook / Instagram 廣告帳號與 API 權限。
  - Meta 建議使用 Business Manager 的 System User access token，並授權至少 `ads_read`；若系統需讀取 Business 資產清單 / 廣告帳號清單，通常還需要 `business_management`。
  - Meta token 需放入 Secret Manager 的 `META_ADS_ACCESS_TOKEN`，不可寫入 repo、文件或前端。
  - Meta Ad Account ID，格式通常為 `act_<ad_account_id>`；若有多個廣告帳號，需提供每個帳號對應品牌 / 平台規則，可用 `META_ADS_ACCOUNT_IDS` 或 `META_ADS_ACCOUNTS_JSON`。
  - 建議 `META_ADS_ACCOUNTS_JSON` 格式：
    ```json
    [
      {
        "accountId": "act_1234567890",
        "name": "MOZTECH Meta Ads",
        "brand": "MOZTECH",
        "platform": "Meta",
        "currency": "TWD"
      }
    ]
    ```
  - Google Ads 帳號與 API 權限：
    - `GOOGLE_ADS_DEVELOPER_TOKEN`：Google Ads 後台「工具與設定 > API 中心」取得。
    - `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`：Google Cloud Console OAuth client。
    - `GOOGLE_ADS_REFRESH_TOKEN`：用上述 OAuth client 授權 Google Ads scope 後取得。
    - `GOOGLE_ADS_CUSTOMER_ID` / `GOOGLE_ADS_CUSTOMER_IDS`：目前截圖帳戶為 `6215621647`。
    - 若透過 MCC / manager account 授權，connector 目前會自動展開 manager 底下的 client accounts；手動設定 `GOOGLE_ADS_LOGIN_CUSTOMER_ID` 已不是必要條件。
  - TikTok Ads 帳號與 API 權限。
  - 廣告帳戶與品牌 / 通路對應。
  - 廣告發票或收據來源，以及扣款信用卡 / 銀行帳戶。
- 目前系統狀態：
  - 費用報銷與 AP 模組已有基礎。
  - 2026-05-08 已新增 Meta Ads connector 後端入口：`GET /integrations/meta-ads/readiness`、`GET /integrations/meta-ads/ad-accounts`、`GET /integrations/meta-ads/insights`、`POST /integrations/meta-ads/sync`。
  - `POST /integrations/meta-ads/sync` 會把 Meta spend 以 `sourceModule=meta_ads` 寫入 `Expense / ExpenseItem`，科目代號暫用 `6118 廣告費`；CEO Dashboard 既有 management summary 會把這些列入廣告費。
  - 已新增本機安全設定腳本：`backend/scripts/configure-meta-ads-secrets.sh`，用隱藏輸入把 token 放入 Secret Manager，並掛到 Cloud Run backend。
  - 2026-05-08 實際修復：`META_ADS_ACCESS_TOKEN` 已建立 Secret 並掛到 Cloud Run；Cloud Run runtime service account 已在 Secret 層級取得 `roles/secretmanager.secretAccessor`。
  - 2026-05-08 已依 Meta Ads Manager 截圖設定 `META_ADS_ACCOUNTS_JSON` / `META_ADS_ACCOUNT_IDS`：`bonson` 歸入 BONSON，`MOZTECH US`、`MOZTECH US shopify`、`MOZTECH 墨子科技` 歸入 MOZTECH，並以 US / TW market 區分。
  - 設定腳本已補強，之後更新 token 時會自動補 Cloud Run runtime service account 的 Secret Accessor 權限。
  - 2026-05-08 已驗證 Meta API 與系統 connector 可讀金額；已同步 `2026-01-01` 到 `2026-05-08` daily spend 共 256 筆進 `Expense / ExpenseItem`。
  - 2026-05-08 已追溯同步到 Meta API 允許的最早日期 `2023-04-08`，共 `2087` 筆 daily spend；Meta API 回覆更早資料超過近 37 個月限制，若要補 `2023-04-08` 以前需從 Meta Ads Manager 匯出歷史檔再匯入。
  - 已新增 `GET /reports/ad-performance-summary`：把 Meta spend 與 Shopify 品牌營收合併成 blended ROAS。正式 Cloud Run 已驗證 `2026-01-01` 到 `2026-05-08` 回傳整體 ROAS `1.384`、MOZTECH ROAS `2.1967`；BONSON 目前有廣告花費但未在已同步 Shopify 訂單中辨識到 BONSON 營收。
  - 2026-05-01 到 2026-05-08 的 dashboard management summary 已回傳每日廣告費，區間合計約 `NT$180,904`。
  - Cloud Run 已開啟 `META_ADS_SYNC_ENABLED=true`，每日回刷最近 7 天，處理 Meta 當日 / 近幾日花費校正。
  - CEO Dashboard 已先把廣告花費放入第一層管制區；若系統內已有廣告相關費用或已付款費用申請，會先以描述 / 科目線索彙總成 `adSpendAmount`。
  - 若尚未提供 Meta / Google / TikTok API 與 mapping，Dashboard 會顯示「待串接」，不會假造平台花費。
  - 2026-05-09 已新增 Google Ads connector 程式入口：`GET /integrations/google-ads/readiness`、`GET /integrations/google-ads/insights`、`POST /integrations/google-ads/sync`，並新增 Secret Manager 設定腳本 `backend/scripts/configure-google-ads-secrets.sh`。
  - 2026-05-11 已用可管理 Google Ads 的 OAuth 帳號重新授權，並更新 `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` / `GOOGLE_ADS_REFRESH_TOKEN` Secret 版本；Secret 值不得寫入 repo。
  - 2026-05-11 已確認 `6215621647` 是 manager account，connector 已修正為自動展開 client accounts 並查 spend。正式 Cloud Run revision `ecom-accounting-backend-00360-s7v` 已驗證 `GET /integrations/google-ads/readiness` 回 `ready=true`。
  - 2026-05-01 到 2026-05-09 已抓到 Google Ads spend `NT$341,789.47`，來源包含 `8052579705 MOZTECH 墨子科技` 與 `8602556100 bonson 邦生`。
  - 已補最近 30 天 `2026-04-12` 到 `2026-05-11` 的 Google Ads daily spend：`fetched=72`、`synced=72`、`created=54`、`updated=18`，寫入 `Expense / ExpenseItem`，`sourceModule=google_ads`。
  - Cloud Run 已開啟 `GOOGLE_ADS_SYNC_ENABLED=true`，revision `ecom-accounting-backend-00361-khw` 已驗證 Google Ads readiness 仍為 `ready=true`，每日會回刷最近 7 天。
  - 2026-05-11 使用者確認 Google Ads 品牌歸屬：`8052579705` 是 MOZTECH 全球獨立站目前使用帳戶，`8602556100` 是 BONSON，`8672054842` 是 MORITEK，`5801010919` 歸 MOZTECH。Cloud Run `GOOGLE_ADS_ACCOUNTS_JSON` 已依此設定。
  - 2026-05-11 已重新同步 `2026-04-12` 到 `2026-05-11` Google Ads daily spend，`fetched=72`、`synced=72`、`created=0`、`updated=72`，讓既有費用列補上 brand / platform 描述。
  - 2026-05-11 Cloud Run revision `ecom-accounting-backend-00366-z76` 已驗證 `GET /reports/ad-performance-summary` 合併 Meta Ads + Google Ads，且 `adSource` 顯示 `META_ADS + GOOGLE_ADS`。正式 API 驗證同區間 `adSpend=NT$1,927,783.01`，其中 `MOZTECH=NT$1,221,124.60`、`BONSON=NT$703,230.34`、`MORITEK=NT$3,428.07`。
- 暫停原因：
  - Meta API 讀取 spend 的程式入口、Secret 掛載、帳戶 mapping、每日 spend 匯入與每日排程已補上。
  - 沒有廣告發票 / 收據來源與扣款帳戶前，可以匯入 spend，但還不能完成 AP / 銀行扣款對帳與 ROAS / 現金流聯動。
  - Google Ads spend API 已接通並可同步每日花費；TikTok Ads 尚未接入。
- MCP 使用原則：
  - MCP 可以用來協助開發、測試、讀取你授權的工具或瀏覽器資料。
  - 但正式每日日結 / 月結的廣告費同步，不應只靠 MCP 或人工瀏覽器操作；正式流程應做成 Cloud Run connector + Secret Manager + Cloud Scheduler，才能穩定排程、留紀錄、錯誤重跑與被財務稽核。

## 資料治理 / 主檔

### 9. SKU / 品牌 / 平台商品 mapping

- 需要你提供：
  - 內部 SKU 主檔。
  - Shopify / 1Shop / Shopline / Momo / PChome / Pinkoi / LINE 禮物等平台 SKU 對照。
  - 品牌歸屬：MOZTECH / BONSON / AIRITY / MORITEK。
  - 倉庫、平台倉、3PL 倉、預計到貨日資料來源。
- 目前系統狀態：
  - 產品、倉庫、庫存快照、庫存異動有基礎。
  - 正式 UI 曾顯示產品清單為 No data。
  - 產品 / 庫存頁已補上匯入範本下載與 dry-run 預覽；確認前不會寫入產品或庫存。
- 暫停原因：
  - 沒有真實 SKU / 平台 mapping / 倉庫與預計到貨資料，無法完成庫存治理與採購建議。
  - 可先用系統範本整理第一版 SKU 主檔，再提供正式 Excel / CSV 讓系統做小批量驗證。

### 10. 經銷商 / 代理商規則

- 需要你確認：
  - 經銷商價格層級。
  - 可見商品範圍。
  - 帳期 / 月結 / 信用額度規則。
  - 經銷商訂單是否要開 B2B 發票、是否與一般電商走同一條 AR / 對帳鏈。
- 目前系統狀態：
  - Customer、信用額度、付款條件有基礎。
  - 還不是正式 B2B 下單前台。

## 高風險操作確認邊界

以下操作即使我能寫程式，也需要你明確確認後才能在正式資料上執行：

- 刪除、合併、作廢、排除任何 `Payment`。
- 開立、作廢、折讓、折讓作廢正式電子發票。
- 送出或上傳任何外部平台表單。
- 建立新的 API key、OAuth app、訂閱、付費資源。
- 大批量修改正式訂單、發票、AR、AP、Journal。
- 匯入會改變正式財務結果的報表前，若欄位或來源不明，需要先確認格式與測試小批量。
