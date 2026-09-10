# 儲運管理中心整合交接

## 核對基準

- WMS 本機 `/Users/moztecheason/Documents/moztech-wms-ecpay`：clean，`codex/wms-ecpay-b2c` / `9b376526f23c90a907553450630634da4aad8fbf`。
- 重新查詢 GitHub main：`d4e2bff12545d9243787d52850c16f36e1db4eed`，不是最新版。
- Cloud Run 2026-09-10 實查：`corely-wms-00010-hug` 100%；`corely-wms-00009-ldj` 的 ecpay-preview tag 無正式流量。latestReady 不是正式流量證據。
- ERP production backend `00506-ray` 100%；frontend `00268-mim` 100%。LUNA `luna-read-248f9555` 是獨立 off-traffic 候選，不能覆蓋其 tag 或把其 read fixes 當作已正式上線。
- ERP main push 觸發 stack workflow，自動 migration / candidate / 100% promotion；獨立 workflow dispatch 也會切正式。這次不用它們直接發布未驗收整合。
- 本輪不修改 WMS checkout 或另一套售後系統，不切 WMS 流量。

## 架構選擇

ERP 統一入口、授權與訂單關聯；WMS 保留獨立作業服務及資料庫。比直接合併程式更能保留既有 Express/React 揀貨、裝箱、SN、附件、列印、例外審核和交易邏輯，代價是必須處理跨服務授權、資料新鮮度與事件重試。不是 iframe，也不從 ERP 直接查寫 WMS 資料表。

程式碼查得：

- `taskRoutes.js` 用 picker/packer/dispatcher/admin 的即時角色及指派範圍產生佇列。
- **`orderRoutes.js GET /orders/:orderId` 會 SELECT FOR UPDATE，並可能把狀態改為 picked/completed。不能包成唯讀工具。** 必須新增不呼叫此 handler 的 exporter。
- `completed` 只是核對完成；物流表、expected_returns 與 orders 是分開的。
- `logisticsRoutes.js` 現在查核 WMS 使用者及管理員角色，不接受 ERP service principal。
- `020_ecpay_tracking.sql` 沒有公司／品牌／ERP order mapping；order_id 可為 null。現有追蹤資料不等於完整訂單資料。

## 分階段交付

1. **本輪**：ERP `/warehouse` 儲運管理中心，依 inventory:read 顯示工作入口。既有權限的非管理者、非售後人員登入可導向儲運；這不建立新 WMS 帳號或擴大權限。提供原 WMS 工作台、公告及管理入口，明示分開登入。物流與實收顯示待串接，不用假計數。
2. WMS 新增獨立 GET-only exporter，ERP server 透過短效 service-to-service OIDC token 呼叫。驗证簽章、issuer、audience、expiry、專用 principal；不共享 JWT_SECRET、不把服務 token 給瀏覽器。服務身分建立/IAM 授權另行核准。Exporter 不接受任意資料表/路徑，禁止既有有副作用 GET。
3. ERP 後端從已認證 actor、membership、功能權限和品牌 scope 建立委派查詢；服務端重查 actor 對照。使用公司/品牌允許集合，空集合拒絕，不以 header 自報公司授權。SELF/DEPARTMENT 必須完成 WMS worker mapping 才開放。WMS 自身使用唯讀 DB role/transaction，指定 allowlist 欄位、bounded cursor、timeout、rate limit、無副作用审計紀錄。
4. SSO 使用同一 OIDC issuer、各自 client/audience、authorization-code + PKCE、一致 logout/撤權；ERP user ID 與 WMS user ID 明確對照。不同角色映射需管理員確認，不能把 ERP inventory:read 等同 WMS admin。跨部門多角色可選工作中心，缺權限顯示申請入口，不自動加角色。
5. 保留原作業服務，逐步讓 ERP 原生操作呼叫同一業務 commands；SN、异常、附件、批次、列印均需原新行為 parity。最後才評估退貨實收與售後交接及 ECOUNT 庫存切換。

## wms.read.v1 契約

本輪新增 `wms-read.contract.ts` 與 `wms-read.service.ts`，為未掛載 live route 的可測 ports/service；沒有呼叫現有 WMS、沒有假稱連線。

- 關聯鍵：entityId + brandCode + erpOrderId + wmsOrderId + accountId + environment + merchantId + logisticsId，必須來自已審核 mapping repository。不能以帳號名稱、品牌名稱、物流單號相似度自動核准。1:N 分批出貨必須逐物流綁定，訂單讀取聚合要保留所有物流腿；目前 port 僅單筆明確綁定，不能當作全量訂單快照。
- snapshot：warehouseStatus、logisticsStatus、warehouseReceivedAt、returnKind、observedAt。未知狀態保留待確認，不推論送達。實收時間只能來自倉庫掃碼實收證據；provider return 不可填入。
- 三種退回：uncollected / customer_return / customer_repair。物流、實收、檢验、銷貨退回、退款、發票各自獨立。
- 回應 allowlist 不含客戶聯絡資訊、raw provider payload、秘密及商戶內部名稱。AI 客服只在另行確認顧客與訂單 ownership 後取得此投影；目前沒有開通 AI 工具。
- 錯公司、品牌、帳號、環境或訂單拒絕；缺 mapping 和來源故障回錯誤，不回 0/空清單。查詢時間不是 provider 事件發生時間。

## 事件契約（設計，未啟用）

採 `wms.event.v1`：eventId、producer、companyId、aggregateId、aggregateVersion、occurredAt、observedAt、schemaVersion、correlationId 及 allowlist payload。WMS 交易提交時寫 outbox，消費端 inbox UNIQUE(producer,eventId)，同 aggregateVersion 不能覆蓋較新快照；cursor 漏洞需補帳。重試帶退避、lease、dead-letter 與告警，不把手動 poll 當排程。

候選事件分開：warehouse.verification_completed、logistics.status_observed、return.expected、warehouse.return_received、inspection.completed；每種有獨立責任者。驗證完成不生成物流交付；物流回中心不生成實收；實收不生成退款/開票/庫存加回。ECOUNT 仍為庫存主系統。

## 尚待驗收

來源 exporter、ERP service principal、公司／品牌／訂單映射、SSO、worker 權限、全量來源搬遷、自動匯入、物流排程、新建物流、逆物流、倉庫實收、售後交接均未完成。部署、資料搬遷、流量切換、財務/庫存写入分別驗收。
