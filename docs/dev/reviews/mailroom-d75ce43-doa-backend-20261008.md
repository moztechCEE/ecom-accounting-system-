# 收發室 d75ce43 後端獨立審查（2026-10-08）

結論：本次 `MailroomCommandDto` 的原始布林值修正通過；dispatch 的公司、本人保管、當版、重試、既有 OUT 及未接通 Source 守門未發現新增 P1／P2。然而，相關的平板簽收、維修交接、退貨入庫三個既有 DTO 仍會將 JSON 字串 `"false"` 轉成 `true`，本輪已用實際 HTTP／主程式管道重現同一根因 P2。不能把本批當成「所有實物確認入口已修正」的放行收據。沒有修改產品、合併、部署或操作真實資料。

## 固定版本與範圍

| 項目 | 實核 |
| --- | --- |
| 審查樹 | `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-review-20261008` |
| 固定 HEAD | `d75ce4359df2f2170b65b1acf984aa9f8439cd34`，detached |
| 修正前父版 | `dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d` |
| Source 相容參照 | `corely-aftersales-workflow-20261005`，clean `20f583b6284e93e5516a533733b3833120aaae0d` |
| 後端 delta | 只有 `mailroom.dto.ts`、`mailroom-dispatch.service.spec.ts`；service／dispatch／custody 的產品邏輯相對 dd 沒有修改 |
| 本輪寫入 | 只有本文件；沿用既有 backend dependencies symlink，Jest cache 使用私有 `/private/tmp` 路徑；未安裝依賴 |

已讀 AGENTS、最新收發交接文件與 dd→d75 差異，核對 actual main 的管道、controller、DTO、service、權限／保管／版本／回執與 Source 消費邊界。舊 dd 審查文件不修改；其結果不能代替本次包含 raw HTTP 的新收據。frontend／知識文件由其他代理負責。

## 仍成立的 P2：其他實物確認 DTO 使用全域隱式布林轉換

`backend/src/main.ts:32–42` 的實際 `ValidationPipe` 開啟 `transform` 與 `enableImplicitConversion`。本批只在 `backend/src/modules/mailroom/mailroom.dto.ts:106–112` 保存原始 `confirmedItems` 值；以下三个 DTO 沒有相同保護，`@IsBoolean()`／`@Equals(true)` 檢查的是已轉換的值。

| 入口與來源 | 用原始 JSON `confirmedItems: "false"` 的實際 HTTP 結果 | 影響 |
| --- | --- | --- |
| `POST /api/v1/mailroom/tablet/items/:id/accept`；`mailroom-tablet.dto.ts:23`、`mailroom-tablet.controller.ts:9–17` | HTTP 200；真 `MailroomTabletService` 通過 `:58` guard，`:136–147` 向原 command 委派 `confirmedItems: true` | 具有有效收發權限、符合保管／派工與有效簽收憑證的請求可以用字串 false 代替實物確認；並非登入或簽收人身分繞過 |
| `POST /api/v1/repair-workbench/items/:id/workflow`，`action: return_original`；`repair-workflow.dto.ts:27`、`repair-workbench.controller.ts:18–25` | HTTP 201；真 service 在既有客服 DECLINE／本人維修保管情境將案件從 INSPECTING 寫為 WAITING_RETURN_ACCEPTANCE | `repair-workbench.service.ts:289–306`、`:443–446` 的本人實物確認不再代表原始 boolean true。相同 DTO 還用於 send_factory／receive_factory；本輪沒有把這兩個動作算作另外完成的 HTTP 測試 |
| `POST /api/v1/after-sales/stock/receive-return`；`after-sales-stock.dto.ts:21`、`after-sales-stock.controller.ts:62–67` | HTTP 201；真 `AfterSalesStockService` 在其餘 RETURN／QC／所有權／庫存權限前提滿足時產生一次 `direction: IN` | `after-sales-stock.service.ts:273–287` 的實物點收 guard 被轉換後的 true 通過。既有去重仍有效，但不能以「避免重複 IN」代替「本人確認實物」 |

三條入口各測 `false`、`"false"`、`true`，共 9 次 loopback HTTP：boolean false 均 HTTP 400 且沒有委派／狀態／庫存寫入；string false 與 boolean true 均通過。每次重建 fixture，使用實際 controller／DTO／service，只有 authentication／Prisma／下游邊界是既有 synthetic fixture。修復方向是沿用本批 raw-value Transform 至這三個 DTO，並用 actual main pipe 的 HTTP negative cases 驗證；不必關閉全域數字轉換。

這三個 DTO dd→d75 均未修改，屬於本輪擴核確認的既有缺陷，不是 d75 新引入。已在寫文件前向父代理回報；本輪沒有替 owner 修改程式。

## 本批 targeted fix 與完整性核對

1. **修正 dispatch／一般 accept／accept_return 的同一 DTO 邊界。** `mailroom.dto.ts:108–112` 的 `@Transform(({ obj, key }) => obj[key], { toClassOnly: true })` 保留原 JSON，`@IsBoolean()` 先拒絕字串、數字、陣列及物件。實際 main 管道仍允許 expectedVersion `"7"` 轉數字 7。dispatch 要求 `confirmedItems === true`（`mailroom-dispatch.contract.ts:138–139`）；null／省略可過 optional DTO，但在業務 guard 被拒絕。

2. **目前操作者／公司／保管／當版及重試仍守門。** `mailroom.service.ts:1305–1336` 使用公司＋actor＋requestId advisory lock、item FOR UPDATE，並在交易內重讀 actor、公司、mailroom:update 與有效 company employee。`:1358–1367` 同 key 同內容回 duplicate，內容／item 不同衝突，新請求重讀 item。`mailroom-dispatch.contract.ts:115–158` 要求 REPAIR、READY_FOR_DISPATCH、有效來源快照、沒有既有 outboundShipment、本人 custodian、MAILROOM custody、當版與物流白名單；管理權限不替代本人實物保管。

3. **不重扣替換品 OUT，既有 IN 不被覆寫。** `mailroom.service.ts:1552–1595` 只讀 POSTED reservation、CONSUMED unit、產品及正式 OUT，`mailroom-dispatch.contract.ts:192–235` 核公司／repair item／產品／warehouse／SKU／SN／quantity 1／AFTER_SALES_REPLACEMENT／同檢修 revision／提交維修單及 QC PASS。dispatch 不呼叫 consumeForRepair 或 inventory／reservation／unit mutation。`:1618–1621` spread 保留原 workflow 與 inventoryReceipt；`repair-stock-custody.contract.ts:120–165` 依有證據的關聯 replacement 投影 CUSTOMER_CARRIER，來源 RETURN 的歷史 IN 留存。另實跑 stock receipt 51 tests，包含同 key／同實物改 key不能再 IN（`after-sales-stock.receipt.spec.ts:267–282`）。以上是 mock transaction 行為驗證，不是實際 PostgreSQL 併發／庫存驗收。

4. **Source 未接通仍只留持久 pending marker。** `mailroom.service.ts:1596–1621` 由伺服器生成回執與 actor／employee／时间／fromVersion→version，sourceSync 固定 PENDING_COMPATIBILITY／DISPATCH_CONSUMER_NOT_CONFIGURED。`:898–905` 排除 dispatch／DISPATCHED 的外部 delivery，`:1780–1782` 不 publish dispatch。沒有 dispatch outbox、AI enqueue、LINE、Source shipment 或自動結案寫入。

## Source 20f 相容性限制

- `services/mailroom/contract.ts:2–22、55–61` 沒有 DISPATCHED status，`:34–81` 沒有 outboundShipment，`:85–105` 沒有新 phase priority。`services/mailroom/service.ts:199–207` 直接推送會被 INVALID_EVENT 擋；不能把未知欄位的解析當成已保存新物流。
- `services/case-workflow-service.ts:1265、1295` 的 REPAIR 只在已有 mailroomState 時要求 READY_FOR_DISPATCH。將新 native DISPATCHED 直接同步進去而未對齊 Source shipment，會使既有待出貨／寄件動作被擋。本批不 enqueue，因此 Source 暫保最後成功投影，沒有自行建立寄件或通知顧客。
- pending marker 是本地未接通證據；既有 deliverySummary 或先前 progress 已送達都不能證明本次寄出已同步。後續 consumer 必須對齊不可變出件實物、native action／版本與去重及 Source shipment／ACK，不能新建 requestId 重送本地 dispatch 來補流程。

## 本人實际执行

| 檢查 | 結果與界線 |
| --- | --- |
| `jest --runInBand --no-cache --cacheDirectory=/private/tmp/corely-doa-release-20261008/jest-d75-backend-review src/modules/mailroom` | 14 suites／253 tests PASS，skip 0，約 3.30 秒；本批 mailroom 測試，非整個 backend |
| `jest --runInBand --no-cache --cacheDirectory=/private/tmp/corely-doa-release-20261008/jest-d75-backend-review-stock src/modules/integration/after-sales/after-sales-stock.receipt.spec.ts` | 1 suite／51 tests PASS，約 0.81 秒；合計 15 suites／304 tests，所有庫存為 fixture |
| `tsc --noEmit --incremental false -p tsconfig.build.json` | PASS；未建立 repo build cache |
| 獨立 raw dispatch HTTP 矩陣 | 16 值，只有 boolean true 201，其餘 15 值 400；拒絕時 item version／狀態不變且沒有 action。相同 request replay 一次 item/action 寫入，撤 update 權限 replay 403；inventory／outbox／gateway／Source worker 呼叫均 0 |
| 舊 dd negative run | 由 `git show dd:mailroom.dto.ts` 在記憶體載入，actual main 選項確實將 raw string false 轉 true；新版 16 值矩陣阻擋，證明測試識別修正前缺陷 |
| 獨立 sibling HTTP 矩陣 | 3 入口 × 3 原始值，共 9 次；確認本報 P2。stock 的唯一 IN 是記憶體 Prisma stub，無實際資料寫入 |
| `git diff --check` | PASS |

兩個獨立 inline HTTP runner 都以 TypeScript AST 擷取該 fixed HEAD 的唯一 `new ValidationPipe(...)` 實際選項，沒有以 spec 的手抄選項作證。Nest TestingModule 用實際 controller／DTO／service，listen 只綁 `127.0.0.1` 隨機 port，HTTP body 以 `JSON.stringify` 送 raw JSON；fixture 由既有 spec 初始化 code 在記憶體載入，沒有修改測試或建立 repo runner。隨後依父代理追加授權保存同樣行為的私有 runner，並在同一固定 d75 實際重跑成功；它還核替換品既有正式 OUT 不增加庫存寫入、stock HTTP exact replay 只建一次 IN／改位置重試 409。

Targeted 16 值為：true、false、string false、string true、空字串、空格、0、1、-1、null、省略、[]、[true]、[false]、{}、{confirmed:true}。所有非布林非 null 型別在 DTO 進入 command 前被拒絕；boolean false／null／省略在業務 guard 拒絕。

### 可重跑的私有 HTTP fixture

- Runner：`/private/tmp/corely-doa-release-20261008/verify-physical-confirmation-http.cjs`，file mode 600／parent dir 700。
- SHA256：`5cbeee3c2510c1205ca33fa53c2e15e5b7788214548f51cd6dfb96e3135cdbff`；`node --check` PASS。
- fixture 來源為固定 checkout 的 `mailroom-dispatch.service.spec.ts` top-level fixture、`mailroom-tablet.service.spec.ts`／`repair-workflow.service.spec.ts`／`after-sales-stock.receipt.spec.ts` beforeEach 初始化。Runner 檢查實際 git HEAD 與 `--sha` 一致，全部 API 使用 ephemeral loopback，authentication／Prisma／外部 service 均為 synthetic boundaries。
- `legacy` 模式以成功執行來重現本報缺陷，不代表放行。`fixed` 模式則要求三條 sibling 全 16 值只容許真 boolean true，任何 string false 通過都會令 runner 失敗；新修正只能在新的固定 HEAD 檢查後另寫收據，不能把 d75 文件改成 PASS。

本次已執行的精確命令：

```sh
node --check /private/tmp/corely-doa-release-20261008/verify-physical-confirmation-http.cjs
node /private/tmp/corely-doa-release-20261008/verify-physical-confirmation-http.cjs \
  --repo '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-review-20261008' \
  --sha d75ce4359df2f2170b65b1acf984aa9f8439cd34 \
  --expect-siblings legacy \
  --baseline-sha dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d
```

後续 fixed 模式使用 parent 提供的新 checkout／完整 SHA，同一 runner 的 `--expect-siblings fixed`；baseline 仍可保留 dd。固定 d75 的 legacy 輸出明確記錄 16 個 targeted HTTP 結果、9 個 sibling HTTP 結果、基底 string false→true、撤權 replay 403、替換品無新增 OUT、stock replay 一次 IN；不輸出密碼、token 或顧客資料。

來源 bytes SHA256：

| 檔案 | SHA256 |
| --- | --- |
| `backend/src/modules/mailroom/mailroom.dto.ts` | `5c60a24372cc40fd467a546c61787604e44d9630dfecb09eba4573b9d85123aa` |
| `backend/src/modules/mailroom/mailroom-dispatch.service.spec.ts` | `8a6cdbea5247b87ae669b3de1a708dcf0ef0f86b06b84475591fed2de4876d40` |
| `backend/src/main.ts` | `4c3ae51ea4a4de15ec4c3fcebfbfd1aa7472b244e44bb5bc21d908bc7a52f4dd` |

本輪未發現新增 P1；一個既有根因 P2 如上。沒有 Cloud Run／candidate／DEV 登入驗收、真實 JWT／DB、實體交接、Source consumer、LINE、付款／發票／退款或外部庫存驗收。私有 DEV UI script 仍只完成 preparation，父代理明確要求暫不 live，本輪未執行。
