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
- GitHub source `6814f67f1381ac1eaf06a61af55855a9ea3cee6c` 已推送；Actions `34521877689` 的 quality、deploy 均成功。沒有 dispatch backend／stack。
- Cloud Build `64266d92-40af-4e2b-a502-f3f12a68baa2` SUCCESS；image digest `sha256:577a48f3b30d3b84a0dd7e634413d079f4bef5648b2228010b9775d6a14e3810`。
- 正式前端 `ecom-accounting-frontend-00270-vob` Ready=True、100% 流量、generation 271；candidate tag `c-34521877689-1`，既有候選 tags 保留。
- 正式 `https://erp.corely.cc/warehouse` 回新版 HTML，JS `index-CEQJR-aE.js`、CSS `index-Bf9hHfGu.css` 均 200；config.js 確認原 API／WS 網域與 `stagedOperationsEnabled:false`。API `/api/v1/health/ready` 回 ready。
- 使用既有登入 session 的實際瀏覽器驗證：ERP 導覽含四報表，逐頁路由與標題正確，來源未連線如實顯示警示，沒有 TEST-WMS 或測試帳號切換列；沒有作業工作站入口，既有來回件頁仍可開啟。沒有建立、掃描、拋單、退款或開票。
- 截圖 `output/playwright/warehouse-production-6814f67f.png` 為已登入正式介面，不是 fixture。
- 追加唯讀檢查：既有 `/sales/after-sales-cases` 兩次回 200；客戶選项 `/customers` 曾出現 CORS/network error，再試 20 秒內未取得回應，OPTIONS 則回 204 且允許 ERP origin。此客戶清單連線問題未在本輪定位／修正，不宣稱舊來回件的新增流程已完成端到端驗收；本次沒有修改其 API 呼叫或正式後端。
- 發布後正式 backend 仍為 `00506-ray` 100% / generation 509；私有 staging 仍 `00003-jxn` / generation 3；WMS 仍 `00010-hug` 100% / generation 13。未套任何 migration 或修改員工權限。
- 已知非零警告：WMS 未接通的 GET 404、Ant Design Input deprecation；Actions Node 20 deprecation 與 checkout cleanup git warning 不影響兩個 job 成功。`/healthz` 在新舊 Cloud Run tagged URL 均回 404，因此不將該路徑當作本次健康成功證據，以 Ready condition、正式資源與既有 API readiness 驗證。

## 回滾

只回滾前端流量，不動後端／資料庫／WMS：

```bash
gcloud run services update-traffic ecom-accounting-frontend --project moztech-main-db --region asia-east1 --to-revisions=ecom-accounting-frontend-00268-mim=100
```

上述為需要回滾時使用的指令，本輪沒有執行回滾。後續文件補記 commit 不代表另一次前端部署；正式程式 source 固定為上列 `6814f67f`。
