# 共用串接設定與操作日誌

2026-10-13。`/admin/integrations` 與 `/admin/operation-logs` 是單一管理入口。舊 `/operations/after-sales/settings`、`audit-logs` URL 保留轉向；售後來源與模板 writer 仍可從「案件來源與通知模板」進入 `/operations/after-sales/settings/advanced`。

## 連線權威與權限

`integration_connections` 持久保存公司、品牌、外部帳號、環境與 Secret Manager **參照**，不接受原始憑證。頁面讀取不外呼廣告 provider，也不發通知或開票。保存 metadata 會清除驗證結果；連線探測結果跟 runtime 配置、同步狀態分開。

新權限 `integration_settings:read/update` 可以由權限管理分別授予。舊 `after_sales_settings` 權限只能操作 LINE、售後連線的 registry；不因此取得广告／其他公司設定權限。Source 帳號與 scope 交集繼續由簽名 RPC 驗證。共用設定權限只映射 Source settings，日誌 read 只映射 Source audit_logs，不能因此建立 Source admin。

LINE Messaging channel、Login channel、OA ID 必須分別保存。Source invoice 仍使用使用者確認的萬博創意科技有限公司，共用於 MOZTECH/BONSON；ERP 銷售發票 profile 另按 runtime/company 映射。Metadata 保存不是 env/provider runtime 變更，也不是 provider 已連線。

廣告讀取驗證先檢查 runtime 中同公司、同品牌、同 account/property 對應，僅探測指定帳號；DEV 外部 provider 探測停用。尚無安全 probe 的商城項目明示待串接，未顯示已驗證。售後 RPC 是契約可讀驗證，不能等同 LINE 實際送達或 invoice 真實開立。

## 統一 reader 與互動

操作日誌依來源提供一個公司隔離、有界日期（31 天）、游標分頁（最多 100 筆）的 viewer：ERP scoped audit、互動、收發／維修動作、出貨交辦、跨系統 delivery 狀態、Source audit。WMS 尚無受控 reader 時保留原 portal 次層入口，狀態為 `PORTAL_ONLY`；Source 不可讀返回 `UNAVAILABLE`，不冒充全部零筆。原 ERP 沒有 company attribution 的歷史 records 不在新 viewer 跨公司暴露；本次不推測 backfill。

新 `operation_interactions` 收 server actor/company/role snapshot、stable actionId、INTENT／CANCELLED／VALIDATION_BLOCKED。前端不能上報 COMMITTED 或 provider 成功。重試相同 UUID 使用唯一 key 與 body hash 防重；衝突 actor/company/hash 拒絕。每次批次最多 20 筆，不記 DOM 文字、表單值、查詢關鍵字、顧客身分、token、cookie 或完整 URL。

ERP tracker 僅收有 `data-operation-action` 的已啟用控制項。Source 透過 `corely.aftersales.interactions.v1` 送 `{events:[{actionId:'source.…',outcome:'INTENT'}]}`；外層僅接受同 origin、當前 iframe、當前 READY 登入 attempt，不能借其他 iframe 注入。所有作用中的 ERP／Source 控制項仍須依 catalog 提供 stable action ID，WMS 需要在本系統內自行 instrumentation；不能說跨 origin parent 已覆蓋全部控制項。

## 可驗證匯出

`operation_logs:export` 提供最多 1000 筆的 JSONL.gz、manifest（schema/range/count/SHA256）及讀回驗證。匯出對 actor/company 重新查權限，下載再次核 checksum，並寫自身稽核。

此版持久保存 bounded archive bytes，提供安全管理者下載；**不是已搬至 GCS 冷存、不是容量已降低**。沒有熱資料 DELETE、TTL、排程、WORM lock、permission owner 回執清理或舊冪等鍵移除。Source「退回前一步」、Mailroom/Outbound request receipt 及 WMS import owner 仍保留原權威 records。大規模 GCS lifecycle、長期 retention、媒體正文搬移與效能量測需另行完成。

## 本地驗證

- Backend Jest：admin metadata／scope／privacy／idempotency／compressed readback／shared purpose grants／Source transport bound-and-fresh authorization。
- `node --test scripts/dev/operation-interaction-bridge.test.cjs`：同源當前 frame、READY、oversized batch、forged private fields與假 COMMITTED。
- `npm run build --prefix frontend` / `npm run build --prefix backend`。

本地通過不代表部署完成、provider 真實驗證、顧客通知送達或完整業務驗收；DEV 由本次 release owner 提供固定 SHA 與部署回執。

## 原生案件溝通操作

原生案件明細新增顧客確認／LINE 通知／維修提案／工廠問題交辦。顧客確認 CREATE 在送出前保存 actor/company/case 隔離的 UUID 與白名單請求；網路未知結果、重新整理及跨分頁登入切換保留同一次 UUID，不保存簽名連結或登入 token。授權 summary 提供目前有效確認連結；照片透過單張受控 reader 按需預覽。

客服先審核通知草稿，才可發送；顯示 DRAFT、APPROVED、SENDING、FAILED、UNKNOWN、SENT 與 SIMULATED 原始節點。「LINE 已接受」與「DEV 模擬完成」分開，不宣稱消費者送達。UNKNOWN 先核讀案件，不能直接盲重送。QUOTE 顧客回覆的客服審核保留證據；不自動冒充正式報價同意、核款或技師放行。

維修提案按全部目前品項採用，REVIEW/null 金額及 overflow 在 UI 阻擋；最終完整數量／版本／收款／方案 binding 由 Source transaction 再核實。DISPOSITION 綁定每件 item/planVersion/planHash/proposalHash；PRODUCT 使用收發實際品項版本，不假造維修檢測。

工廠交辦指派使用 Source 活躍帳號選單，接手／回覆／核定各帶版本；目前接手人或管理者才顯示後續動作。`caseActivity` URL 只保存展開區塊名稱，重新讀取後維持工作位置，不含顧客資料。

新增 `frontend/tests/native-communication-model.test.ts` 7 項純邊界檢查；`native-communication.test.mjs` 9 個離線 DOM 情境涵蓋 unknown UUID 重開、實際 POST 身分、跨分頁 Web Lock、READONLY、品牌缺失、待審報價不能轉免費、通知審核／發送／模擬及工廠四節點／390px。所有資料為本地虛構 fixture，沒有 DEV 或外部業務效果。
