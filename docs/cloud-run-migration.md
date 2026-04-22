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

## Git Push 自動部署

目前已補上 GitHub Actions 自動部署：

- `.github/workflows/deploy-cloudrun-frontend.yml`
  - `main` 分支有任何 push 時，自動部署 `ecom-accounting-frontend`。
- `.github/workflows/deploy-cloudrun-backend.yml`
  - `main` 分支有任何 push 時，自動部署 `ecom-accounting-backend`。

GitHub repo 需要設定以下 Secrets：

```text
GCP_WIF_PROVIDER=projects/249593319772/locations/global/workloadIdentityPools/github-actions/providers/ecom-accounting-system
GCP_WIF_SERVICE_ACCOUNT=ecom-accounting-gh-deployer@moztech-main-db.iam.gserviceaccount.com
GCP_PROJECT_ID=moztech-main-db
GCP_REGION=asia-east1
CLOUD_RUN_FRONTEND_SERVICE=ecom-accounting-frontend
CLOUD_RUN_BACKEND_SERVICE=ecom-accounting-backend
```

如果 GitHub Actions 卡在 `Authenticate to Google Cloud`，通常就是 `GCP_WIF_PROVIDER` 或
`GCP_WIF_SERVICE_ACCOUNT` 沒有設定到目前 repo，或 repo 轉移組織後舊 secrets 沒跟著生效。

如果沿用舊 backend workflow 的 secret，也可以保留：

```text
CLOUD_RUN_SERVICE=ecom-accounting-backend
```

建議設定以下 GitHub Variables：

```text
CLOUD_RUN_ARTIFACT_REPOSITORY=cloud-run
FRONTEND_API_URL=https://ecom-accounting-backend-sp5g377smq-de.a.run.app/api/v1
FRONTEND_WS_URL=https://ecom-accounting-backend-sp5g377smq-de.a.run.app
DEFAULT_ENTITY_ID=tw-entity-001
```

部署邏輯：

1. GitHub Actions 用 Workload Identity 登入 GCP。
2. Cloud Build 建立 Docker image 並推到 Artifact Registry。
3. Cloud Run 使用該 image 建立新 revision。
4. 前端會把 `API_URL` / `WS_URL` 寫進 Cloud Run runtime env，讓 `/config.js` 指向正確後端。

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
RECONCILIATION_SYNC_JOB_TOKEN: replace-me
```

如果是多店，建議改用：

```yaml
SHOPLINE_STORES_JSON: >-
  [{"token":"replace-me","handle":"replace-me","storeName":"SHOPLINE 主店","merchantId":"replace-me"}]
```

如果要把雙綠界帳號一起部署到 Cloud Run，建議使用：

```yaml
ECPAY_MERCHANTS_JSON: >-
  [{"key":"shopify-main","merchantId":"3290494","hashKey":"replace-me","hashIv":"replace-me","entityId":"tw-entity-001","syncEnabled":true,"lookbackDays":90,"dateType":"2","description":"MOZTECH 官方網站 / Shopify"},{"key":"groupbuy-main","merchantId":"3150241","hashKey":"replace-me","hashIv":"replace-me","entityId":"tw-entity-001","syncEnabled":false,"lookbackDays":90,"dateType":"2","description":"團購 / 1Shop / 未來 Shopline"}]
```

建議把 `hashKey / hashIv` 放進 `GCP Secret Manager` 後，再在 Cloud Run 用 secret 或 env file 注入，不要直接寫進 repo。

核心對帳排程可用 Cloud Scheduler 呼叫：

```bash
gcloud scheduler jobs create http ecom-reconciliation-daily \
  --location=asia-east1 \
  --schedule="20 7 * * *" \
  --time-zone="Asia/Taipei" \
  --uri="https://YOUR_BACKEND_CLOUD_RUN_URL/api/v1/reconciliation/run/auto" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-sync-token=YOUR_RECONCILIATION_SYNC_JOB_TOKEN" \
  --message-body='{"entityId":"tw-entity-001","syncShopify":true,"syncOneShop":true,"syncEcpayPayouts":true,"syncInvoices":true}'
```

這個 Job 會跑同一套核心流程：平台訂單、綠界撥款、AR、發票狀態、對帳中心重算。

## 建議遷移順序
1. 先部署後端到 Cloud Run
2. 驗證 `/health`、`/api-docs`、登入 API
3. 再部署前端並把 `FRONTEND_API_URL` 指向新的後端
4. 最後切掉 Render 網域與舊 CORS 設定
