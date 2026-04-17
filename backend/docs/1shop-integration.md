# 1Shop API v1 串接說明

最後更新：2026-04-17

## 目前已確認的對接條件

- 官方 API 文件：<https://support.1shop.tw/api-v1/>
- API v1 目前以匯出 / 查詢為主，沒有匯入功能。
- Webhook 是否可用，1Shop 客服表示仍需工程確認。
- 現階段先以 API 定期輪詢（polling）為主。
- 驗證方式是把 `appid` 與 `secret` 放在 query string。
- 速率限制依官方文件為每個 `appid` 每 10 秒 10 次請求。
- 目前僅有正式環境。
- 1Shop 最多可設定 10 組白名單 IP。

## 本系統已完成的內容

- 後端新增 `1Shop` 整合模組：
  - `GET /api/v1/integrations/1shop/health`
  - `GET /api/v1/integrations/1shop/connection-info`
  - `POST /api/v1/integrations/1shop/sync/orders`
  - `GET /api/v1/integrations/1shop/summary`
- 已實作 API v1 訂單列表輪詢。
- 同步結果會寫入既有 `sales_orders`，並綁定 `1SHOP` 銷售渠道。
- 可透過 `ONESHOP_SYNC_ENABLED=true` 啟用每日自動輪詢。

## Cloud Run 固定出口 IP

經 2026-04-17 在 GCP 專案 `moztech-main-db` 檢查：

- Cloud Run backend 已設定：
  - `run.googleapis.com/vpc-access-connector: cip-connector-dev`
  - `run.googleapis.com/vpc-access-egress: all-traffic`
- Cloud NAT 使用的靜態 IP：
  - `104.199.246.28`

這個 IP 可以提供給 1Shop 加入白名單。

## 建議提供給 1Shop 的資訊

1. 商店名稱：請填實際 1Shop 商店名稱
2. 白名單 IP：`104.199.246.28`
3. 說明：系統會從 Cloud Run 經由 VPC / Cloud NAT 出口固定 IP 呼叫 1Shop API v1

可直接回覆：

```text
您好，以下提供串接資訊：

1. 商店名稱：<請填入 1Shop 商店名稱>
2. 請協助將 Cloud Run 經由 VPC / Cloud NAT 對外的固定 IP 加入白名單：
   104.199.246.28
3. 我們會先採用 API 定期輪詢方式串接，並以 appid / secret 進行驗證。

如 webhook 後續可開放，也請再提供規格與設定方式，謝謝。
```

## 後端環境變數

請至少設定：

```env
ONESHOP_API_BASE_URL="https://api.1shop.tw/v1"
ONESHOP_APP_ID="..."
ONESHOP_SECRET="..."
ONESHOP_DEFAULT_ENTITY_ID="tw-entity-001"
ONESHOP_STORE_NAME="..."
ONESHOP_SYNC_ENABLED="false"
ONESHOP_SYNC_LOOKBACK_DAYS="3"
ONESHOP_MIN_REQUEST_INTERVAL_MS="1100"
```

## 測試方式

### 檢查設定

```bash
curl -H "Authorization: Bearer <token>" \
  https://<backend>/api/v1/integrations/1shop/health
```

### 手動同步近 3 天訂單

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  https://<backend>/api/v1/integrations/1shop/sync/orders \
  -d '{
    "entityId": "tw-entity-001",
    "since": "2026-04-14T00:00:00.000Z",
    "until": "2026-04-17T23:59:59.000Z"
  }'
```

### 查詢同步後摘要

```bash
curl -H "Authorization: Bearer <token>" \
  "https://<backend>/api/v1/integrations/1shop/summary?entityId=tw-entity-001"
```
