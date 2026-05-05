# SHOPLINE OpenAPI 串接說明

最後更新：2026-05-05

## 本系統目前已完成

- 已建立 SHOPLINE 整合模組：
  - `GET /api/v1/integrations/shopline/health`
  - `GET /api/v1/integrations/shopline/connection-info`
  - `GET /api/v1/integrations/shopline/token-info`
  - `GET /api/v1/integrations/shopline/agents`
  - `GET /api/v1/integrations/shopline/preview/orders`
  - `GET /api/v1/integrations/shopline/preview/customers`
  - `POST /api/v1/integrations/shopline/sync/orders`
  - `POST /api/v1/integrations/shopline/sync/customers`
  - `POST /api/v1/integrations/shopline/sync/auto`
  - `GET /api/v1/integrations/shopline/summary`
  - `POST /api/v1/integrations/shopline/webhook`
- 已接入 `SalesOrder`
- 已接入 `Customer`
- 已可從 `order_payment` 產生 `Payment` 草稿資料
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

- 尚未接正式 `payout / settlement` API 或報表
- 尚未把實際撥款淨額與手續費回填成 `reconciled`
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
   - 優先找 Shopline 後台是否可匯出結算、撥款、付款手續費報表，欄位至少需包含訂單號、付款單號、撥款日、總額、手續費、淨額、退款。
   - 若 Shopline 有 payout / settlement API，補 API 文件與權限後可做正式 connector。
   - 這份資料用來把目前的 Payment 草稿改成實際撥款資料，並進入對帳核銷。
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

- OpenAPI Base URL：
  - `https://open.shopline.io/v1`
- 驗證方式：
  - `Authorization: Bearer <access_token>`
  - `User-Agent: <handle code>`
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

## 下一步

1. 補 token 後，先跑 `token-info`
2. 確認 handle / merchant id
3. 驗證 `orders / customers / transactions` 三段同步
4. 接 Cloud Scheduler
5. 補 webhook topic 簽章驗證
6. 把 payout / reconciliation 串進既有對帳流程
