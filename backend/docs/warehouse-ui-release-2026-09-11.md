# 儲運主管介面發布 — 2026-09-11

使用者本輪授權將介面同步至正式 ERP。發布範圍僅 frontend；後端、資料庫、WMS、售後來源服務、員工賦權及私有 staging IAM 不變。

## 發布前核對

- 正式前端 `ecom-accounting-frontend-00268-mim` 100%，前次 Actions 來源 `77e5c9035cd48d5bceba8d2cc4688d87124ce2a3`。
- 回滾映像 `asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/ecom-accounting-frontend@sha256:14c4264b5167d318bb2fb3d9ffd5d9739e551f489b58e1dc2c56b2d84af3a802`。
- 正式後端 `ecom-accounting-backend-00506-ray` 100%，generation 509；另有 LUNA off-traffic 候選，必須保留。
- API 仍為 `https://api.erp.corely.cc/api/v1`，WS `https://api.erp.corely.cc`。沒有將正式前端指向 staging。
- `main` push 會觸發整套部署，本輪只推隔離 `codex/operations-corely-20260910` 分支，手動觸發既有 frontend workflow，不觸發 backend 或 stack workflow。

## 前端相容與功能開關

- 四主管報表與總覽入口以原有登入／個別報表 permission 顯示；正式 WMS management API、可信 mappings 尚未上線，預期顯示資料尚未接通，不使用 fixture／零數值冒充正式統計。
- 新增 `STAGED_OPERATIONS_ENABLED`（預設 false）作為前端功能可用性開關，**不是權限或後端安全閘門**。不得僅開此旗標就宣稱整合完成。
- 關閉時保留正式既有 `/sales/after-sales` 來回件頁及其原權限，不替換成尚未驗收的售後工作台；不開啟新版報價、品牌設定、業務新增訂單、WMS 拋單／作業工作站。
- 本機 test entry 顯式打開測試功能，且僅使用合成資料。正式建置不包含測試 entry 或測試帳號切換列。
- 所有後端 migration、staging invocation、公司／品牌／人員／訂單對照、正式命令寫入仍待分開核准驗收。

## 驗證與發布結果

- 本機 frontend build、21 項前端測試通過；backend 43 suites / 181 tests 通過，但此次不部署後端。
- 部署執行 ID、候選／正式 revision、正式域名 smoke 與回滾資訊於發布完成後補入本文件。
