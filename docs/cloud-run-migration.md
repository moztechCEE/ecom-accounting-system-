# Cloud Run 遷移說明

## 目標
- 前端改由 Cloud Run 提供靜態站台
- 後端改由 Cloud Run 執行 NestJS API
- CORS 與 API URL 不再綁定 Render

## 先決條件
- 已安裝並登入 `gcloud`
- 已設定 `gcloud config set project <PROJECT_ID>`
- 已設定 `gcloud config set run/region <REGION>`
- 後端必要環境變數已整理完成

## 前端
- `frontend/Dockerfile` 會在建置時注入 `VITE_API_URL`
- `frontend/server.mjs` 也支援在執行時透過 `API_URL` / `WS_URL` 提供 `/config.js`
- 如果之後改後端網域，不一定要重新改前端程式碼

## 後端
- `backend/Dockerfile` 直接供 Cloud Run 使用
- `backend/scripts/start-prod.js` 會先跑 migration，再依 `SEED_ON_STARTUP` 決定是否 seed
- CORS 由 `CORS_ORIGIN` 控制，支援逗號分隔多個網域

## 一鍵部署
在專案根目錄執行：

```bash
chmod +x scripts/deploy-cloud-run.sh

PROJECT_ID=moztech-main-db \
REGION=asia-east1 \
FRONTEND_API_URL=https://YOUR_BACKEND_URL/api/v1 \
BACKEND_CORS_ORIGIN=https://YOUR_FRONTEND_URL \
BACKEND_ENV_VARS_FILE=backend/.env.cloudrun.yaml \
./scripts/deploy-cloud-run.sh
```

## 後端環境變數檔範例
可以建立 `backend/.env.cloudrun.yaml`：

```yaml
NODE_ENV: production
API_PREFIX: /api/v1
JWT_SECRET: replace-me
JWT_EXPIRES_IN: 7d
TZ: Asia/Taipei
DATABASE_URL: postgresql://USER:PASSWORD@HOST:5432/DB?schema=public
```

如果使用 Cloud SQL，也可以改用既有的 `backend/scripts/start-prod.js` 所支援的：
- `CLOUDSQL_INSTANCE`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

如果後續要把 Shopline 一起部署到 Cloud Run，可一併補上：

```yaml
SHOPLINE_API_BASE_URL: https://open.shopline.io/v1
SHOPLINE_ACCESS_TOKEN: replace-me
SHOPLINE_HANDLE: replace-me
SHOPLINE_STORE_NAME: replace-me
SHOPLINE_MERCHANT_ID: replace-me
SHOPLINE_DEFAULT_ENTITY_ID: tw-entity-001
SHOPLINE_SYNC_ENABLED: "true"
SHOPLINE_SYNC_LOOKBACK_MINUTES: "180"
SHOPLINE_SYNC_PER_PAGE: "50"
SHOPLINE_SYNC_JOB_TOKEN: replace-me
```

如果是多店，建議改用：

```yaml
SHOPLINE_STORES_JSON: >-
  [{"token":"replace-me","handle":"replace-me","storeName":"SHOPLINE 主店","merchantId":"replace-me"}]
```

## 建議遷移順序
1. 先部署後端到 Cloud Run
2. 驗證 `/health`、`/api-docs`、登入 API
3. 再部署前端並把 `FRONTEND_API_URL` 指向新的後端
4. 最後切掉 Render 網域與舊 CORS 設定
