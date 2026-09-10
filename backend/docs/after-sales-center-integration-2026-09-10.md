# Corely AI 營運管理系統：售後管理中心

## 已確認的產品方向

- 售後管理中心是總入口；來回件是案件類型之一，不得把所有售後案件改成來回件。
- 原售後系統的業務邏輯與流程是整合基準，不採用 ERP 原生簡化來回件模型取代。
- 統一品牌、導覽與操作入口，不代表改寫既有案件類型、狀態、權限或帳務規則。
- 保留原售後六類案件、報價、付款回報、對帳、退款、發票、正逆物流、LINE 與歷程。
- 使用原系統角色佇列，不能以狀態文字或當頁資料推算全公司的待辦數量。

## 本次核對的來源

ERP 基底 77e5c903；隔離分支 codex/operations-corely-20260910。接手時已有的未提交工作複製至隔離 worktree，未覆蓋原 checkout。

售後唯讀檢視來源：after-sales-ui worktree HEAD 85135a00f017974d461f46d0bd01e094fbfd8de9。

- services/case-workflow-service.ts：原始轉換與領域操作，包括收貨、檢測、報價、收款、寄件、退款與發票。
- services/case-workbench-service.ts：佇列由案件類型、付款回報、發票、物流及狀態共同判斷；沿用 getCaseOperationalGuidance。
- ERP 既有 AfterSalesWorkbenchPage / after-sales-workbench.service：目前為唯讀 list/detail。
- 完整前次清單見 after-sales-workbench-handoff-2026-09-04.md。本次不主張已驗證正式環境版本或寫入能力。

## 導覽與畫面

總導覽：營運總覽、訂單銷售、售後管理中心、採購庫存、財務會計、人資考勤、系統管理。

售後管理中心目前可見入口：
案件工作台、維修案件、維修報價、漏寄補寄、來回件、退款派車、私下購買、客戶問題。
這些入口使用既有 source 查詢參數；不提供虛構可寫的案件動作。

後續中心首頁加入原系統角色佇列：客服、會計、倉管、維修、逾期。必須先擴充來源 API 的全量篩選/計數，不能只過濾已載入的一頁。

## 同一案件的流程

1. 建案：保留 source case ID、案件編號、原訂單與來源；分別保存收件方式及寄回方式。
2. 收貨：以案件編號、維修編號、消費者回寄參考號、逆物流單號查找原案件；不得憑單號格式推測案件類型。多筆匹配需人工選擇。
3. 檢測與報價：呼叫原售後檢測/報價動作及既有狀態轉換，保留免費、付費、不維修寄回等分支。
4. 消費者確認與付款：沿用原確認與付款回報流程；回報匯款不等於銀行款項已確認。
5. 對帳後處理：原系統確認收款動作成功後，才可依既有 gate 執行後續維修/出貨。
6. 寄回：保留 Shipment / ReverseShipment、收件紀錄及歷程，不把物流狀態當成庫存入帳。

使用者希望客服執行對帳。必須將現有角色/動作授權與 ERP 人員身分逐一對照，不能因看得到客服佇列而直接授予確認款項、退款、開票權限。

## 實作順序與邊界

1. 完成來源流程與表單 parity matrix：正常、失敗、拒絕報價、免費、取消、重複操作、跨租戶/部門拒絕。
2. 擴充唯讀 exporter：來源佇列與計數、物流/維修號查找、可執行動作及阻擋原因、受保護附件。
3. 接 ERP 登入身分與來源 actor/company 映射；伺服器檢查租戶、部門、案件可見性和每個動作权限。未映射 fail closed。
4. 將原領域動作包成具型別的 API commands，讓 ERP 畫面呼叫同一份來源邏輯；禁止任意 PATCH status。
5. commands 帶 idempotency key、expected version、actor 與 audit。來源交易提交後以 outbox 投遞事件；重試不得重複寄 LINE、扣庫存或開票。
6. 庫存、金流、發票各指定唯一寫入者。來源仍负责的開票不可再由 ERP 二次開立；跨系統寫入先建立契約與回覆對照。
7. Staging 逐個角色驗證原畫面與 ERP 畫面的行為/副作用一致後再遷移；正式退款、開票與庫存寫入維持停用，另做上線核准。

## 本次交付邊界

已改本機導覽、產品名稱、Corely 品牌/共用元件樣式及來源案件查詢入口；未改來源售後領域服務，未部署正式環境。
單元驗證涵蓋六類案件入口、權限、查詢條件高亮與既有 source display/login routing。完整 source command API、SSO、角色佇列、物流號全量查找、帳務/庫存整合尚未完成。

## 品牌設定與按件報價：本機實作增量

- 新增管理員「品牌與 LINE」與員工「案件報價」頁面；新增版本沿用原草稿項目，舊草稿不可變更。介面沿用低干擾側欄、統一控制項與顧客版簡潔預覽。
- 後端新增公司範圍品牌設定、案件品牌綁定、不可變報價草稿三張表，migration 為 `20260910110000_after_sales_preparation`。使用參數化 SQL、品牌版本 CAS、actor 與 idempotency key/hash；第一次報價交易綁定案件品牌，不允許後續靜默換品牌。
- 原案件仍從 source 唯讀查詢，僅接受未終止的 REPAIR；來源 paymentRequests 已有品牌時必須一致，多品牌不明確時拒絕。未辨識的品牌不得預設為 MOZTECH。
- 快照保存當時品牌與預定開票設定；顧客預覽使用獨立 allowlist，不包含內部商戶別名或其他品牌。實際發票仍必須顯示經驗證的法定開票資訊，不得以此預覽取代正式發票。
- 使用者指定 AIRITY 的預定開票公司為「萬博創意科技有限公司」，綠界內部名稱「萬魔未來」。目前只在本機合成 fixture 填入，統編與商戶身分未核對，沒有套用到正式公司資料。AIRITY 不共用 BONSON LINE。
- LINE 頁面只保存公开識別資料；不接受 Channel Secret/Token 或客戶端 verified 標記。真正憑證安全綁定、Webhook、發送及綠界開票均未實作/啟用，畫面明確為未連線或待核對。
- 保留 JWT、角色、功能權限、entity/source guard；目前 source company 映射仍限既有單一公司，SELF/DEPARTMENT scope 不放寬。這不是多租戶正式開通驗收。

### 驗證紀錄

- 前後端 build 通過；前端仍有既存大型 bundle 與瀏覽器資料過期警告。
- preparation + workbench Jest：20 tests 通過。前端 navigation + workbench：8 tests 通過。Prisma schema validate 通過，未產生或覆寫共用 Prisma client。
- `scripts/test-after-sales-preparation-sql.cjs` 在隔離的 in-memory PostgreSQL/PGlite 驗證 migration、company/FK、CAS、交易鎖與冪等唯一約束通過；不是 Cloud SQL 實際連線驗證。
- 瀏覽器使用 localhost 合成 fixture：儲存 AIRITY 設定、TEST-0003 報價 1,500.00、顧客預覽、reload 持續保存、AIRITY 自動帶入且鎖定、建立新版帶入既有項目均通過。
- 本機預覽由 `frontend/tests/after-sales-preview.config.ts` 啟動；fixture 持久化在 `output/playwright/after-sales-preparation-fixture.json`，不是正式後端。正式程式頁面呼叫新增的 preparation API。

### 未完成／上線前必要條件

- 本次未部署，migration 未套用正式或 staging；需隔離資料庫與真實角色/公司 API 端到端驗收。
- 尚未把草稿送進原售後 quote/payment 領域動作；不更改來源狀態、不寄 LINE、不建立顧客確認連結、不產生付款請求、不開票、不寫庫存。
- 正式啟用前須核實各品牌 LINE channel、開票公司統編與 ECPay merchant 對應，安全保存憑證，再按既有 source command/outbox 與角色 gate 整合。不要覆蓋原系統使用中的 Webhook。
