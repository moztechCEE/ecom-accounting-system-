# Corely B2B 與 WMS 交運核銷整合

本機隔離工作樹 `/Users/moztecheason/ecom-erp-b2b-handover-20260923`，分支 `codex/erp-b2b-handover-20260923`。以已上 DEV 的 `53188aab` 基底，合入 B2B 三個本機提交 `4d395380`、`0fcda532`、`23066337`；schema、App、navigation 自動合併。此文件不表示 migration、DEV 聯調或正式驗收已完成。

## 資料流與庫存界線

Corely ERP 是正式庫存唯一主帳。訂單確認先預留（allocated 增、available 減，onHand 不變），WMS 管真實揀貨、裝箱與交運。

`POST /api/v1/integration/wms/events` 接受 `corely.wms.handover.v1`，成功只代表 append-only inbox、pending_review Shipment 與逐行 ShipmentLine 已持久保存，完全不動庫存。ACK 固定 `{accepted:true,eventId,inboxId,duplicate:boolean}`。同事件相同原始 bytes 可重送；事件／出貨／行識別碼重用而內容改變，回 409。DB trigger 禁止修改／刪除原始 inbox、交運行與過帳收據；更正需未來獨立沖回流程。

員工在 ERP 逐行核對交運證據及銷單後人工過帳：

- `GET /api/v1/wms/reconciliation?entityId=...&status=pending|posted|all&page=1&pageSize=50&occurredOn=2026-09-23&search=...`。
- `occurredOn` 使用台北 UTC+08:00 交運日；search 比對訂單號、訂單 ID、事件 ID、SKU。pending 包含仍有未過帳行的部分核銷事件。
- `GET /api/v1/wms/reconciliation/:id?entityId=...` 回傳該公司單一完整事件。
- `POST /api/v1/wms/reconciliation/lines/:id/post` body `{entityId,note?}`。回 `{lineId,status:'posted',alreadyPosted,postedAt,unitCostBase,totalCostBase}`。
- 員工 JWT、公司 inventory 存取範圍及 `inventory:read` 權限必備；POST 另需 `inventory:update`。客戶 B2B session 不能代替員工權限。
- 清單回 `{items,total,page,pageSize}`；event 含物流／取貨證據、sourceHash、原生 WMS ID，line 含箱件、實交量、訂購量與該 source salesOrderLine 累計 postedQuantity。已過帳行的 postedQuantity 包含自己，待核銷行不含自己。

每次接收與過帳都鎖銷單與來源行，再驗證當初 acknowledged dispatch intent 的 sourceHash、nativeIntakeId、wmsOrderId、warehouseId、reservationAccepted，以及每條銷單行 ID／商品 ID／SKU／訂購量。不同銷單行即使同 SKU 仍分別限制累計；accepted 不可超過 ordered。一般非 SN 商品才允許拋單；組合、製成、服務與 SN 商品於預覽階段即拒絕。

單行過帳在同一 DB transaction 鎖庫存 snapshot、確認原 SALES_ORDER 剩餘預留精確等於各來源行原訂量減已過帳量（拒絕無逐行對照的手動釋放），並確認足量 onHand／allocated，寫 RELEASE（SALES_ORDER reference）、OUT（WMS_SHIPMENT_LINE reference）、唯一 WmsShipmentPosting 收據。onHand 與 allocated 同減實交數量，available 不變；收據固定當下 movingAverageCost、總成本、核對人、時間與備註。重送同一行回原收據，不再扣庫。未全部訂購数量過帳為 partially_shipped，全部來源行達到原訂量才 shipped。舊整單 fulfill 對 WMS-managed order 仍封鎖；已有舊 SALES_ORDER OUT 的訂單拒絕進入新核銷流程，避免歷史 ECOUNT／ERP 已扣帳再扣一次。

## 認證與設定

`WMS_HANDOVER_ENABLED=true` 才啟用接收與過帳，預設關閉。固定 `WMS_HANDOVER_JWT_ISSUER`、`WMS_HANDOVER_JWT_AUDIENCE` 與 RSA >= 2048 位元 `WMS_HANDOVER_PUBLIC_KEY`（或 `_PUBLIC_KEY_FILE`）；只有 RS256。JWT 必帶 `scope=wms.shipment.handover`、`entityId`、`method=POST`、`path=/api/v1/integration/wms/events`、`bodyHash=SHA256(raw wire JSON bytes)`、iat、exp，最長 120 秒。簽名／公司／路徑／原始內容不符回 401。此路由經專用服務認證，不使用 Public 裝飾器，不放寬 DEV 的其他公開回呼。

物流收件需 carrier 及 trackingNo 或 manifestId；自行取貨仍要 operatorId 與箱件證據。每行 packages 不可空白、不重複，數量加總須等於實交量。WMS outbox 的 accepted 只是 ERP 待人工核銷確認，並不等於正式出庫。

## Migration 與驗證界線

原先尚未部署的 B2B／運費 migration 已順移，避免置於新 DEV migration 之前：

1. `20260923080000_b2b_customer_portal`（原 040000）。
2. `20260923090000_purchase_landed_cost`（原 050000）。
3. `20260923100000_wms_handover_reconciliation`。

Prisma client 在獨立實體 node_modules 產生，不共用他人 client。dummy localhost DATABASE_URL 只供 generate，未連接業務資料庫。測試分成服務邏輯 fixtures、RS256 真簽章/HTTP、PGlite SQL constraints/rollback、本機 TypeScript build；不能據此宣稱真 Prisma/DEV PostgreSQL 交易或實體倉儲驗收。

PGlite proof 執行：`PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node backend/src/modules/integration/wms/wms-handover.migration.cjs`。涵蓋唯一事件／shipment／line／posting receipt、FK、正整數、append-only 與中途錯誤／重複過帳整筆 rollback，60+40 後 available 不變。

待正式 DEV 驗收：指定 QA 公司／商品／客戶／倉庫／通路與 SKU 品牌對照，遷移 checksum、兩端 RS256 keys/grants、SSO 跳預揀、重送丟 ACK、部分 60/40、同 SKU 不同行、跨公司拒絕、兩人併發核銷、故障 rollback、歷史來源切換 mapping，以及倉管實際交運操作。不得用原始 shared checkout 或舊 deploy-built.sh 覆蓋新 DEV；發布需與 Claw candidate 擁有者協調並重查 live traffic，正式環境需另行授權。

本機驗證結果：交運 service 19、RS256 auth 13、HTTP 9、dispatch 9，共 50 項通過；跨端物流欄位 200 字上限已一致並以 HTTP 測試確認。原 B2B／進貨／庫存／銷單／WMS bridge 聚焦測試通過；其中 B2B HTTP 初輪在 CPU 忙碌下碰到預設 5 秒 timeout，單獨以 `--testTimeout=30000` 重跑通過（scenario 約 1.8 秒）。PGlite 交運 26、B2B 18 checks 通過；Prisma validate、backend build、git diff --check 通過。沒有推送、套用 DEV／正式 migration 或變更服務流量。
