# 完整 ERP DEV 部署交接 — 2026-09-21

## 授權與版本範圍

使用者要求可在雲端登入完整 ERP、含 SN 功能與真實資料的 DEV。DEV 使用正式資料副本，外部平台同步與發送停用，不切換正式版本。

- 獨立目錄 `/Users/moztecheason/ecom-erp-dev-20260921`，分支 `codex/erp-dev-environment-20260921`。
- 來源 `36688f16`（SN 規則與箱內預覽）＋本輪 DEV 執行環境 `0ec36da1f6f9c2403d67958d48e5cdc4afe360ae`。
- 原始 repo `codex/erp-resume-20260825` 的既有修改、operations checkout 的未提交儲運／登入修改皆保留。operations 本機另有 `65ea165b` 未推；遠端為 `2ec8282d`。本 DEV 未自行帶入該工作目錄內容。
- 已檢查 GitHub stack workflow 與 Cloud Build triggers；沒有 push main、合併或觸發正式 workflow。
- 開始時正式流量：frontend `ecom-accounting-frontend-00270-vob`、backend `ecom-accounting-backend-00506-ray` 各 100%。backend 的 latestReady 是其他人的零流量候選，不能當成正式版本。
- 正式 backend immutable image：`sha256:6186da9785932044ccb702ebaf62754d4e042c5ad2ecdb46cb4b15e240753a3a`。

## DEV 資料與保護

- Cloud SQL instance 沿用 `moztech-main-db`，新增獨立 database `erp_dev_20260921`；不是獨立 SQL instance，因此仍共用 instance 資源。
- 2026-09-21 16:31 台灣時間完成 `erp_db` 一致性 pg_dump／pg_restore：84 張來源表、1,730 產品、49,392 訂單、45,336 客戶、52,061 收款、6,141 發票、28,418 分錄、57,211 分錄行、28,041 應收發票。
- 資料是當次快照，不持續同步。空表仍為空，不用合成資料冒充已整合的庫存／WMS／售後來源。
- 專用 `erp_dev_runtime` PostgreSQL login：NOSUPERUSER、NOCREATEDB、NOCREATEROLE、NOINHERIT。檢查正式 public schema 全部資料表，該角色可 SELECT／INSERT／UPDATE／DELETE／TRUNCATE 的表數為 0。
- DEV backend 專用 service account `corely-erp-dev-rt`，僅配置 Cloud SQL client 及兩個 DEV secret 的存取；web 使用 `corely-erp-dev-web`。沒有授予正式 secret 存取。
- DEV 使用獨立 JWT secret；沿用副本中的帳號密碼與權限，不修改正式帳號，清除副本中的密碼重設 token。
- `ERP_DEV_SANDBOX=true` 啟動前驗證 DEV database／user，並要求 seed 與排程停用。Node TCP／HTTP／fetch 與子程序自動化被阻擋，僅允許 Cloud SQL Unix socket。沒有配置正式外部串接憑證。
- DEV 公開路由僅保留登入、登入事業別及健康檢查；公開註冊、密碼重設、webhook／外部回呼拒絕。其他路由沿用既有 JWT 與業務權限。
- DEV 前端沿用完整 production entry，提供明確測試橫幅及快照日期；不是 tests fixture entry。

## Migration 查核

來源有 53 筆 ledger：52 筆已完成及一筆歷史 rolled-back。
其中 `20260505120000_seed_employee_permission_model` checksum 與目前檔案不同，但與原始提交 `e6efa3b1` 精確吻合；後續原始碼修正了 raw SQL 的 UUID 主鍵。此歷史紀錄保留，不重放、不改 checksum。
另外 51 筆已完成 checksum 與目前檔案相符。

只在 DEV 套用以下 4 項 migration：

- `20260910110000_after_sales_preparation`
- `20260910150000_wms_permission_catalog`
- `20260911090000_wms_dispatch_intents`
- `20260911130000_wms_management_permissions`

新增 catalog 不代表員工已取得 WMS 權限，也不代表跨系統來源已連線。

## 建置與本機驗證

- 前後端 production build 通過（新 checkout 必須先手動執行 Prisma generate）。
- 後端原有 43 suites／181 tests 通過；新增 DEV 公開入口測試 2 項通過。
- DEV subprocess sandbox 2 項測試通過；前端 SN／navigation 共 18 項通過。
- Cloud Build：`1901f55b-3a88-4fb2-b58b-8c84f877969a`，source commit `0ec36da1`；Cloud Run 部署結果待下節補記。
- 既有大型 bundle／browsers data 過期警告仍在。

## 維護入口與未完成範圍

- `cloudbuild.dev.yaml` 只產生 DEV image；`scripts/dev/deploy-built.sh <成功的 build ID>` 僅部署命名固定的 DEV 前後端 immutable digest。
- 後續發布先 fetch、核對其他 Codex、DEV 現行 image／流量與資料庫，再執行上述 DEV 入口；此腳本不適用正式發布。
- `scripts/dev/create-snapshot.py` 拒絕覆寫既有資料庫。不可為更新快照直接重跑或清除使用者測試結果；需另行規劃保留／刷新流程。
- `scripts/dev/verify-api.py` 以既有管理員登入，讀取產品、訂單、報表，建立及刪除單一 DEV 測試產品；不輸出 token、密碼或個資。
- SN 仍是本機草稿與預覽，沒有正式配號／同日併單／外箱 PDF／匯入／重印履歷。部署完整 ERP 不代表這些未實作項目自動完成。
- WMS、售後、電商、綠界、郵件、AI 等對外來源呼叫在本 DEV 停用；資料庫已有歷史資料可測試，跨系統交易尚不能在此做真實操作。
- 公司自訂子網域尚未設定；先交付 Cloud Run HTTPS DEV hostname。未建立資料刷新排程。

## 真實資料聯調發現與修正

第一個 DEV revision 登入及 readiness 通過，但產品 API 回 0 筆。原因是原 ProductController 使用 `req.user.entityId`，而驗證後 user 並沒有此可信純量欄位，導致讀取不存在的 `default-entity-id`。

已逐檔審查另一 Codex 的 `28e8e676` 候選（功能提交 `e8ba7bd7`／`248f9555`），只重用公司範圍 helper、相關測試、產品／客戶讀取及採購讀取權限修正。沒有合併整條候選分支或採用它的 runtime／role DTO／文件。另把本 DEV 的產品寫入與 BOM 操作改成相同可信公司解析，保留既有 inventory:update 權限，前端 products API 明確傳入選取公司。

此修正後前後端 build 通過；後端 46 suites／212 tests、前端 18 tests 通過。新增測試涵蓋跨公司產品寫入被拒絕。這些修正仍只發布 DEV，正式問題未在本輪處理。

第二次 build 使用已驗證 runtime immutable digest 加入重新編譯的 dist；`scripts/dev/build-runtime-update.py` 要求乾淨提交，且確認依賴、schema、啟動腳本及前端 server 與基準不變。這不是對既有映像 tag 覆写；新 source SHA 使用新 tag，再以 digest 部署。
