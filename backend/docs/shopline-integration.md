# SHOPLINE OpenAPI 串接說明

最後更新：2026-05-06

## 本系統目前已完成

- 已建立 SHOPLINE 整合模組：
  - `GET /api/v1/integrations/shopline/health`
  - `GET /api/v1/integrations/shopline/connection-info`
  - `GET /api/v1/integrations/shopline/token-info`
  - `GET /api/v1/integrations/shopline/agents`
  - `GET /api/v1/integrations/shopline/preview/orders`
  - `GET /api/v1/integrations/shopline/preview/customers`
  - `GET /api/v1/integrations/shopline/payments/balance`
  - `GET /api/v1/integrations/shopline/payments/billing-records`
  - `GET /api/v1/integrations/shopline/payments/transactions`
  - `GET /api/v1/integrations/shopline/payments/payouts`
  - `POST /api/v1/integrations/shopline/sync/orders`
  - `POST /api/v1/integrations/shopline/sync/customers`
  - `POST /api/v1/integrations/shopline/sync/payments/billing-records`
  - `POST /api/v1/integrations/shopline/sync/auto`
  - `GET /api/v1/integrations/shopline/summary`
  - `POST /api/v1/integrations/shopline/webhook`
- 已接入 `SalesOrder`
- 已接入 `Customer`
- 已可從 `order_payment` 產生 `Payment` 草稿資料
- 已接入 SHOPLINE Payments Admin OpenAPI 只讀查詢：
  - 帳戶餘額：`/payments/store/balance.json`
  - 帳務 / 帳單明細：`/payments/store/balance_transactions.json`
  - 付款 / 退款 / 爭議交易：`/payments/store/transactions.json`
  - 提款紀錄：`/payments/store/payouts.json`
- 已可把 `balance_transactions.json` 的 `PAYMENT / REFUND / CHARGEBACK` 明細轉成 `shoplinepay` provider payout import rows，進入既有付款匹配、手續費回填、淨額回填流程。
- 已可把 `待付款 / 待撥款 / 待對帳` 狀態送進 Dashboard 對帳視角
- Dashboard reports bucket 已預留 `Shopline 業績`
- 2026-05-05 已驗證 BONSON Shopline 店：
  - `handle`: `onemorefuture`
  - `merchantId`: `5e0738e792f5c90009548b54`
  - 一般 OpenAPI 已回補 `2024-05-05` 到 `2026-05-05`
  - Cloud Run summary：`SalesOrder` 4689 筆、訂單總額 9,250,001；Payment 4687 筆、gross/net 8,488,187
  - Cloud Scheduler `ecom-accounting-shopline-auto-sync` 已建立，每 20 分鐘增量同步，lookback 240 分鐘
- 2026-05-06 再驗證：
  - Cloud Run backend 已掛上 Shopline token / handle / merchant id / sync enabled 設定。
  - `ecom-accounting-shopline-auto-sync` 排程為 ENABLED，手動觸發 `sync/auto` 回應 HTTP 201。
  - 最近排程記錄可正常完成增量同步；03:00 Asia/Taipei 記錄為 orders=3、customers=18。

## 這一版尚未完成

- SHOPLINE Payments API 已接程式，但仍需在 Cloud Run 上實測目前 token 是否已具備 `read_payment` 權限。
- `sync/payments/billing-records` 會把 API 明細送進既有對帳匯入器；是否自動建立核銷分錄仍受既有對帳規則控制，不會在未確認的情況下無條件關帳。
- `SHOPLINE_PAYMENTS_SYNC_ENABLED` 預設仍為 `false`；確認 Cloud Run 實測成功後，才建議打開讓 `sync/auto` 一併拉 Payments 帳務。
- webhook 目前已可觸發增量同步，但尚未補簽章驗證與 topic 細緻處理
- 兩年以上或已封存訂單仍需另接 Shopline archived orders 非同步匯出流程
- 尚未接 Shopline 商品主檔 / 分類 / 庫存主檔 API；目前只會從訂單明細建立最小商品資料。
- Shopline invoice 欄位目前只保存在訂單 / Payment notes，尚未作為正式 `Invoice` 狀態回寫來源。

## 品牌 / 平台歸屬規則

- `萬魔未來工學院` 是銷售平台 / 來源，不是品牌。
- 銷售訂單畫面應分開顯示：
  - 品牌：MOZTECH、BONSON、AIRITY、MORITEK 等實際商品品牌。
  - 平台：Shopify、Shopline、1Shop、萬魔未來工學院團購等成交來源。
- 目前前端會優先用商品名稱或 SKU 的品牌前綴判斷品牌，例如 `BONSON｜商品名`、`MOZTECH | 商品名`。
- 若商品名稱 / SKU 沒有品牌前綴，也沒有命中已知品牌關鍵字，訂單會暫列 `未分類品牌`，但平台仍保留為 `萬魔未來工學院` / Shopline / 1Shop。

## 補資料方式

1. Shopline 撥款 / settlement / 手續費
   - 2026-05-06 已依官方 Admin REST API 補上正式 connector：
     - `GET https://{handle}.myshopline.com/admin/openapi/{version}/payments/store/balance_transactions.json`
     - `GET https://{handle}.myshopline.com/admin/openapi/{version}/payments/store/transactions.json`
     - `GET https://{handle}.myshopline.com/admin/openapi/{version}/payments/store/payouts.json`
     - `GET https://{handle}.myshopline.com/admin/openapi/{version}/payments/store/balance.json`
   - 這些 API 需要 `read_payment` 權限；若 token 權限不足，會在 Cloud Run 實測時回 401 / 權限錯誤。
   - 對帳主流程優先使用 `balance_transactions.json?is_settlement_details=true`，因為它能提供帳務明細、訂單 / 交易識別、交易金額、淨額、手續費、結算批次與記帳時間。
   - `transactions.json` 用於補查支付 / 退款 / 爭議交易狀態；`payouts.json` 用於提款批次與銀行入帳區間核對；`balance.json` 用於 CEO / 財務 Dashboard 餘額監控。
   - 2026-05-06 檢查使用者提供的 Shopline Payment 月綜合對帳單：
     - `Payout account` / `Reserve account` / `Unsettled account` 都有 `帳單總覽` 與 `帳戶收支明細`。
     - 可用逐筆欄位包含：`交易狀態`、`訂單號碼`、`交易序號`、`支付標籤`、`類型`、`幣別`、`金額`、`手續費`、`實際收款金額`、`交易時間`、`結帳時間`。
     - 已將系統 provider payout 匯入器擴充為支援 `shoplinepay` provider，這些欄位可映射到現有 Payment matching / 實際手續費 / 淨額回填流程。
     - 但本次三份檔案的 `帳戶收支明細` 並不是完整月內逐筆交易：Payout 只有提款手續費一列，Reserve 空白，Unsettled 只有一筆 4/30 付款。若要逐筆核銷所有 Shopline 訂單，仍需匯出完整交易明細或 payout API。
   - 2026-05-06 後續檢查 `帳務明細查詢.xlsx`：
     - 這份是可用的 Shopline Payment 逐筆帳務明細，共 1009 筆資料列。
     - 欄位包含：`商戶id`、`結算批次號`、`訂單號碼`、`交易序號`、`交易類型`、`交易詳情`、`支付方式`、`交易金額`、`交易手續費`、`應收手續費`、`交易淨額`、`交易完成時間`、`結帳記錄時間`、`結算狀態`。
     - `shoplinepay` 映射已補上這份欄位，且 Shopline Payment 報表中的負數手續費會在匯入時轉成正的 fee amount，以符合系統分錄邏輯。
2. 兩年以上 / archived orders
   - 使用 Shopline archived orders 非同步匯出流程取得檔案或下載連結。
   - 匯入後補回 `SalesOrder` / `SalesOrderItem`，避免兩年以上歷史營收缺漏。
3. 商品主檔 / 分類 / 庫存
   - 需要 Shopline 商品、分類、庫存相關 API 權限，或先提供匯出的商品 / 庫存檔。
   - 匯入後才能建立正式商品品牌、品類、SKU 與庫存水位，而不是只靠訂單明細反推。
4. 發票
   - 若 Shopline 訂單本身帶 invoice 欄位，先作為對照資訊。
   - 正式發票狀態仍應以綠界電子發票 API / 報表回寫 `Invoice`，避免只相信平台文字欄位。

## 官方條件摘要

- 一般 OpenAPI Base URL：
  - `https://open.shopline.io/v1`
- SHOPLINE Payments Admin OpenAPI Base URL：
  - `https://{handle}.myshopline.com/admin/openapi/{version}`
  - 預設版本：`v20260301`，可用 `SHOPLINE_ADMIN_API_VERSION` 覆寫。
- 驗證方式：
  - `Authorization: Bearer <access_token>`
  - `User-Agent: <handle code>`
- Payments API 權限：
  - `read_payment`
- 官方標準 rate limit：
  - `20 requests / second`
- API 時區：
  - `UTC +0`

## 後端環境變數

單店可用：

```env
SHOPLINE_API_BASE_URL="https://open.shopline.io/v1"
SHOPLINE_ACCESS_TOKEN=""
SHOPLINE_HANDLE=""
SHOPLINE_STORE_NAME=""
SHOPLINE_MERCHANT_ID=""
SHOPLINE_DEFAULT_ENTITY_ID="tw-entity-001"
SHOPLINE_SYNC_ENABLED="false"
SHOPLINE_SYNC_LOOKBACK_MINUTES="180"
SHOPLINE_SYNC_PER_PAGE="50"
SHOPLINE_SYNC_JOB_TOKEN=""
SHOPLINE_ADMIN_API_VERSION="v20260301"
SHOPLINE_PAYMENTS_SYNC_ENABLED="false"
```

多店建議用：

```env
SHOPLINE_STORES_JSON='[
  {
    "token": "...",
    "handle": "your-shop-handle",
    "storeName": "SHOPLINE 主店",
    "merchantId": "..."
  }
]'
```

## 建議測試順序

### 1. 驗證憑證

```bash
curl -H "Authorization: Bearer <token>" \
  https://<backend>/api/v1/integrations/shopline/health
```

### 2. 查 token 對應店家資訊

```bash
curl -H "Authorization: Bearer <token>" \
  https://<backend>/api/v1/integrations/shopline/token-info
```

### 3. 手動同步近三天訂單

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  https://<backend>/api/v1/integrations/shopline/sync/orders \
  -d '{
    "entityId": "tw-entity-001",
    "since": "2026-04-14T00:00:00.000Z",
    "until": "2026-04-17T23:59:59.000Z"
  }'
```

### 4. 手動同步近三天顧客

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  https://<backend>/api/v1/integrations/shopline/sync/customers \
  -d '{
    "entityId": "tw-entity-001",
    "since": "2026-04-14T00:00:00.000Z",
    "until": "2026-04-17T23:59:59.000Z"
  }'
```

### 5. 查摘要

```bash
curl -H "Authorization: Bearer <token>" \
  "https://<backend>/api/v1/integrations/shopline/summary?entityId=tw-entity-001"
```

### 6. 手動同步近三天收款草稿

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  https://<backend>/api/v1/integrations/shopline/sync/transactions \
  -d '{
    "entityId": "tw-entity-001",
    "since": "2026-04-14T00:00:00.000Z",
    "until": "2026-04-17T23:59:59.000Z"
  }'
```

### 7. 預覽 SHOPLINE Payments 帳務明細

```bash
curl -H "Authorization: Bearer <token>" \
  "https://<backend>/api/v1/integrations/shopline/payments/billing-records?since=2026-05-01T00:00:00.000Z&until=2026-05-06T00:00:00.000Z&maxPages=1&isSettlementDetails=true"
```

### 8. 匯入 SHOPLINE Payments 帳務明細進對帳流程

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  https://<backend>/api/v1/integrations/shopline/sync/payments/billing-records \
  -d '{
    "entityId": "tw-entity-001",
    "since": "2026-05-01T00:00:00.000Z",
    "until": "2026-05-06T00:00:00.000Z",
    "maxPages": "20"
  }'
```

## 下一步

1. 補 token 後，先跑 `token-info`
2. 確認 handle / merchant id
3. 驗證 `orders / customers / transactions` 三段同步
4. 接 Cloud Scheduler
5. 補 webhook topic 簽章驗證
6. 從 Cloud Run 實測 `payments/billing-records` 是否具備 `read_payment`
7. 若成功，開啟 `SHOPLINE_PAYMENTS_SYNC_ENABLED=true`，讓排程一併同步 Payments 帳務
8. 把 payout / reconciliation 結果接到 CEO Dashboard / 財務異常隊列
