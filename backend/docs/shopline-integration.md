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

## 這一版尚未完成

- 尚未接正式 `payout / settlement` API 或報表
- 尚未把實際撥款淨額與手續費回填成 `reconciled`
- webhook 目前已可觸發增量同步，但尚未補簽章驗證與 topic 細緻處理
- 兩年以上或已封存訂單仍需另接 Shopline archived orders 非同步匯出流程

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
