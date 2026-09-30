# B2B 商品目錄 DEV 預覽部署紀錄（2026-09-30）

## 可檢視網址與範圍

- 前端：<https://b2b-preview-0930---corely-erp-dev-sp5g377smq-de.a.run.app/b2b/shop>
- 配對 API：<https://b2b-preview-0930---corely-erp-api-dev-sp5g377smq-de.a.run.app/api/v1>
- 兩個 Cloud Run revision 都以 `b2b-preview-0930` 標記提供獨立網址，**各接 0% DEV 主流量**。原 DEV API `corely-erp-api-dev-access-870e3b18-r`、web `corely-erp-dev-access-870e3b18-r` 均維持 100%。正式 ERP、WMS 與 ECOUNT 未部署或遷移。
- 這是唯讀預覽。API `B2B_PUBLIC_CATALOG_ENABLED=true`、`B2B_PUBLIC_ORDER_ENABLED=false`、`B2B_PRIVATE_QUOTE_EMAIL_ENABLED=false`；web `B2B_PUBLIC_ORDER_ENABLED=false`。頁面顯示「預覽中，暫不受理採購單」，隱藏數量、購物車與聯絡表單。公開 POST 與採購單查詢在 DEV sandbox 回應 403。
- 目前 `tw-entity-001` 的 `b2b_product_price_books` 為 0 筆、公開勾選也是 0 筆，頁面會顯示沒有公開商品。上線實際商品前，應由人員逐項填入建議售價並勾選公開，不能由既有銷售價或客戶價自動推算。

## 來源、建置與映像

| 項目 | 來源 commit | Cloud Build | 不可變映像 digest | Cloud Run revision |
| --- | --- | --- | --- | --- |
| ERP API | `5ff4c5249ff7e3864620188a4ea5958ef29d9534` | `e31b381c-037c-4722-94a5-52ea7bac05fa` | `sha256:4b89a98c0ee78ffa078421959a010edf1a0ac4393553970576f340555e5192cc` | `corely-erp-api-dev-b2b-preview-0930` |
| ERP web | `2cb036817ecfec0dcd220dfe23534a358e009755` | `9cde82d5-7ac5-4a18-b41e-1fa9afb3e517` | `sha256:35312f8e05b6f6295f9ef9762d12de9fda7d05a321defdd46a17f0d011482bf8` | `corely-erp-dev-b2b-preview-0930` |

兩個 Cloud Build context 均由指定 commit 的 `git archive` 製作，不含工作樹未提交檔案。API 來源已整合當時 DEV 線上的權限、產品成本遮蔽與績效考核來源；web commit 只接續加入唯讀預覽 runtime 開關。遷移工具另以 `2094ac1c30b88ab029bf830293600718c7ed1933` 提交。

## DEV 資料庫遷移

目標固定為 Cloud SQL `moztech-main-db:asia-east1:moztech-main-db`、資料庫 `erp_dev_20260921`、使用者 `erp_dev_runtime`，經 `scripts/dev/b2b-public-release-db.py` 唯讀檢查身份、權限、舊資料相容性、checksum 與未完成遷移後，僅套用並核對以下 5 項：

1. `20260929000000_b2b_public_price_books`
2. `20260929010000_b2b_guest_inquiries`
3. `20260930000000_b2b_catalog_brand`
4. `20260930010000_b2b_guest_to_request`
5. `20260930020000_b2b_private_quote_email`

遷移收據：`/tmp/corely-b2b-pr7-migrations-2094ac1c.json`（本機私有檔）。套用後再次執行 `inspect`，五項均為 `applied`，資料表／索引與 ledger 相符；既有 DEV API 健康檢查仍為 200。工具明確容許已知歷史 checksum 差異 `20260505120000_seed_employee_permission_model`，拒絕其他差異及未套用的非本次 migration。沒有執行通用 `prisma migrate deploy`、seed 或資料修正。

## 驗證與開放條件

- 整合後 Prisma validate/generate、前後端 build、AI 知識檢查、後端完整 93 組／834 項測試與遷移工具 5 項隔離測試通過。前端變更檔案 lint 通過；全庫 lint 有既存、非本次檔案錯誤，未當成本次驗收通過。
- 兩個 Cloud Build 均為 SUCCESS；Cloud Run revision Ready。標記頁 `/b2b/shop` 與 `/config.js`、標記 API 的 `/health` 與公開商品 GET 均為 HTTP 200。`/config.js` 指向配對標記 API，並顯示 `b2bPublicOrderEnabled:false`。瀏覽器實際顯示唯讀預覽、篩選與空商品狀態。公開採購 POST 在 DEV sandbox 回應 403，無採購單建立。
- 原 API/web 所有舊 tag、服務帳號與秘密參照保留；比較前後設定，API 僅變更 B2B 三個開關與候選 `CORS_ORIGIN`，web 僅變更配對 API/WS 網址與送單開關。原兩服務 100% revision 不變。
- 此次未做真實客戶、庫存或 WMS 的操作驗收。開放訪客送單前，仍需逐項核准建議售價與商品公開、補上可受保護的來源 IP 探測並用兩個獨立網路驗證限流、完成客戶／業務操作驗收。專屬報價 Email 保持關閉。
- 候選 API 回應的 CORS 標頭仍見 `Access-Control-Allow-Origin: *`；雖然本次僅提供公開唯讀資料，正式開放客戶流程前須修正 Nest 啟動時重複啟用 CORS 的行為並重測允許來源。

如需關閉預覽，移除 `b2b-preview-0930` 標記即可；原 DEV 主流量本來就未切換。上述新增資料表與約束不因移除標記而回退，不應刪除既有資料。
