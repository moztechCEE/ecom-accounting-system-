# ERP / WMS 工作區查詢橋接 — 2026-09-11

## 已交付，未部署

ERP `codex/operations-corely-20260910`；WMS `codex/wms-erp-read-20260910`，來源基準仍為 `9b376526`。保留兩個原 checkout、另一套售後程式與所有正式環境不動。

本次從純 503 placeholder 推進到可連線的 GET 清單／明細服務。工作台 URL 與登入身分仍屬 ERP；員工不用取得 WMS 瀏覽器 token。工作站是授權範圍內的操作情境，不是改帳號角色、假冒另一位員工或把庫存讀取權限升成 WMS 管理員。

查詢路徑：

`ERP JWT + 現行權限／公司 guard → WmsWorkspaceBridge → 45 秒簽章委派 → WMS 專用 router → 員工／工作站／品牌／訂單 mapping → READ ONLY SQL → allowlist 投影 → ERP 原生工作台`

### ERP

- `WmsWorkbenchController` 的 GET 清單、明細已連接 `WmsWorkspaceBridge`；`GET stations` 讀取現行 ERP 帳號可用工作站。認領／掃碼 POST 仍固定 503，未轉送舊 handler。
- 每次查詢重查 ERP user active、強制改密狀態及角色權限；同一 actor 可以有 pick / pack 兩項權限。WMS 又會檢查來源端授權，不以畫面切換作為權限。
- 只從 `request.user.id` 委派 actor；公司沿用 EntityAccessGuard。後端簽發只可讀取、45 秒有效、固定 issuer / audience / RS256 的委派，無角色自報、無 JWT_SECRET 共用。
- 固定受信來源 origin、HTTPS（僅 test 允許 127.0.0.1 HTTP）、禁止 redirect、5 秒 timeout、最多 1 MiB 回應、契約版本與欄位 allowlist。來源故障不回假空清單。
- 明細帶入目前工作站，防止同時獲准 pick / pack 的人查明細時落到預設站。

### WMS

- 獨立 `/api/integrations/erp/v1/orders` 和 `/orders/:id` 掛載點，不經既有有副作用的 order GET。
- 預設關閉；開啟時必須有明確 issuer / audience / 至少 2048-bit RSA 公鑰。拒絕錯 audience、過期、過長有效期、未知 scope、偽造公司查詢參數及非 GET。
- 新 `021_erp_workspace_read.sql` 只建立空的員工對照、工作站品牌授權、訂單對照三表，沒有種入任何實際人員、品牌或訂單，也沒有改舊 user.role。
- 來源端每次 SQL transaction 檢查未撤銷的 actor + entity + brand + station；綁定來源 user 必須仍存在且具有已知作業角色。
- 純工作角色只能讀到本人或尚未指派的相關階段任務；已指派他人的任務不可因 pending / picked 狀態而外洩。拋單、出貨工作站也只限已授權品牌。
- SN 品項依實際 SN 狀態算進度，非 SN 依數量欄位。READ ONLY transaction，不會自動將已掃滿訂單標為完成。
- `allowedActions` 固定空集合；revision 0 明示非可寫入版本。物流尚未掛載 mapping，顯示「尚未接入物流對照」；物流／退回篩選回明確未接入錯誤，不是假零筆。

## 設定與核准界線

只記錄設定名稱，不填入帳密、金鑰或正式 mapping：

- ERP：`WMS_WORKSPACE_READ_ENABLED`、`WMS_WORKSPACE_URL`、`WMS_WORKSPACE_ISSUER`、`WMS_WORKSPACE_AUDIENCE`、`WMS_WORKSPACE_PRIVATE_KEY`。
- WMS：`ERP_WORKSPACE_READ_ENABLED`、`ERP_WORKSPACE_ISSUER`、`ERP_WORKSPACE_AUDIENCE`、`ERP_WORKSPACE_PUBLIC_KEY`。

正式私鑰只可在核准後經秘密管理服務提供，不能放 Git、前端或對話。沒有建立／儲存正式金鑰。本機測試臨時產生的 key 僅存測試 process 記憶體。此 application-level 委派不是 Google Cloud Run IAM/OIDC grant；若來源未來設為私有，仍須另外驗收平台服務身分與 invocation。不得為方便測試公開 staging 或變更使用者先前拒絕的 frontend invocation。

公司、品牌、actor、WMS user 和訂單 mapping 須逐項核准，不得依 email 相似、名稱或帳號商戶名稱猜測。actor 可具多工作站，但新權限 catalog、mapping 與部署都是不同驗收，尚未執行。現有 mapping 僅支援一個 ERP order 對一個 WMS order；分批／拆單不在本次完成範圍。

## 驗證結果

- ERP backend build、40 suites / 173 tests 通過；前端 build、13 tests 通過。前端既存 bundle size／browser data 警告仍在。
- WMS 兩個既有唯讀測試及新增 HTTP / PostgreSQL 授權測試通過（3 tests）。包含同人雙站、錯誤 audience、token 過期、撤權、跨公司、跨訂單、他人已指派任務、未知參數、非 GET 拒絕。
- 跨 repo `backend/test/wms-source-bridge.e2e.cjs` 通過：編譯後的 ERP bridge → 真正 localhost HTTP → WMS router 簽章驗證 → PGlite PostgreSQL 三表 mapping／SQL → ERP 回應投影。只使用合成資料與 stub ERP 身分儲存，不是完整 Nest/JWT/Cloud SQL 或雲端登入驗收。
- 本機預覽服務原已停止，本次恢復於 127.0.0.1:4396。瀏覽器確認裝箱清單與 TEST-WMS-0003 明細可讀；畫面依然是明示 fixture，不冒充 WMS 真實訂單。

重跑跨 repo 測試：先 backend `npm run build`，設 `WMS_WORKSPACE_SOURCE_ROOT` 為已核對 WMS checkout。必要時 `NODE_PATH` 指向該 WMS 的 backend/node_modules，執行 `node --test test/wms-source-bridge.e2e.cjs`。不連正式 DB。

## 接續項目

1. 使用者確認拋單、揀貨、裝箱、出貨人員及各自公司／品牌範圍；可同人授予揀貨＋裝箱，但不可由預覽角色自動賦權。
2. 核准／建立專用連線身分與 secrets、映射及獨立候選部署；保持 staging 私有，以測試帳號驗證真正登入／撤權／公司邊界。
3. 從 WMS 現有交易服務抽離共用的匯入、認領、掃碼 commands，再做持久冪等、版本控制、作業日誌、事件 outbox。不可將舊 Express handler 以假 role 包裝代理，也不能 ERP 直接寫 WMS 表。
4. 既有 Excel 相容匯入、語音／通知、SN 修正／異常／附件／列印完整 parity；核對、封箱、貼標、交付物流分开。這些真實作業尚未接通，不能宣稱出貨整合完成。
5. 真實硬體、兩位員工並行及交接驗收後，另行批准正式寫入與流量切換；ECOUNT 庫存、退款、開票本次無影響。
