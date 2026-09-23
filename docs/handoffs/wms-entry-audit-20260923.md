# WMS 全入口登入與日誌整合

基底 ERP c3c29e25 已包含 fc82e903 SSO/2FA 和另一視窗的權限費用修改。WMS 基底 1ee777e。獨立 worktrees，不修改他人未提交檔案。

改動：所有入口經 nonce 單次票證，伺服器固定目的頁面與最小角色；WMS 增加唯讀 viewer、ERP-only 開關、簡化返回入口和使用者控制側欄；日誌移除資料廣播、新資料庫操作者快照。具體中央日誌方案見 docs/plans/company-operation-audit.md。

本文件初版時尚未部署；部署版本、測試、migration、回滾與未驗收事項於驗收後補記。不可視為全公司日誌收集已完成。

## DEV 發布結果

已部署，正式環境未變更。ERP runtime source `fa04a2bd` 已包含另一視窗的 `637518d0` 出納修正；後續亦合入 `9299e332` 交接證據（不改 runtime）。WMS API source `dd69666`，web source `92f49ff`。

- ERP API：`corely-erp-api-dev-entry-audit-0923`，100% DEV。
- ERP web：`corely-erp-dev-entry-audit-0923`，100% DEV。
- WMS：`corely-wms-dev-entry-audit2-0923`，100% DEV。
- DEV migrations：`20260923070000_wms_portal_entries`、WMS `035_erp_portal_audit.sql`。未執行正式 migration。
- WMS DEV `ERP_PORTAL_ONLY=true`；舊密碼登入、舊憑證刷新與舊 socket 都拒絕，改從 ERP 進入。並未取消 API 身分驗證。
- WMS 憑證改為分頁 sessionStorage；所有 API、工作身分檢查、批次／放行／討論功能均使用同一分頁憑證。切換作業仍只允許最新授權工作 session，舊分頁失效不會刪掉新分頁憑證。

驗證：ERP 41 個聚焦 backend、14 個 frontend、9 個 sandbox tests，既有 WMS bridge sandbox 檢查；55 個跨系統 PostgreSQL assertions。WMS 284 backend、274 frontend tests、7 個 PostgreSQL actor snapshot／rollback checks。實際 DEV API 43 個 assertions、3 個管理入口與直接書籤共 4 個 browser scenarios；另有舊工作台失效、新分頁繼續操作及重新整理的多分頁驗證。測試只使用獨立 DEV QA 身分，不建立或修改真實訂單。

安全的發布收據、API／瀏覽器結果與截圖位於本機協調區 `artifacts/wms-entry-audit-20260923/`；原始 runtime 快照及 QA credentials 為私有檔，未提交。

回滾：ERP API/web 回 `corely-erp-api-dev-aex-637518d0-c`／`corely-erp-dev-aex-637518d0-f`，WMS 回 `corely-wms-dev-account-sso-0923`。先檢查是否已有更新的 DEV 功能，協調後才以固定 revision 切換；不回滾或刪除新增 audit 資料，舊 session 可由 ERP 重新開啟。只退回分頁修正可回 WMS `corely-wms-dev-entry-audit-0923`。

尚未完成：全公司中央操作日誌 UI、各模組事件覆蓋、outbox／去重、敏感模組範圍與匯出審計；具體需求及順序已列在 `docs/plans/company-operation-audit.md`。本次不宣稱 WMS 全部業務流程、工廠印製或實體倉儲驗收完成。
