# 收發寄件、維修提案與產品確認交付

基底 ERP `d3b7ed2c654de1605b6051db75c74789b3a1c068`，供方維修固定 `50ee4618f89e8fb3c5612d838b4c873313b5431d` 已先 cherry-pick 為 `5c2982b6e5b633df01a3278f81f630360a21cf64`。中央若已整合供方，僅 cherry-pick 本次收發提交；不要合併整個分支。中央持有四服務 DEV 發布鎖，收發沒有部署或真業務操作。

## 寄件與串接

- 新 `mailroom/outbound` API 與寄件工作區管理補寄、商品／配件訂購及一般換貨出貨。Source `/api/integration/mailroom/outbound-orders` 是主單，按剩餘量分配實物 UUID，已安排量與已寄出量分開。
- `PENDING_PICK → WAITING_MAILROOM_ACCEPTANCE → READY_FOR_DISPATCH → DISPATCHED`。備貨同交易正式 ERP OUT；指定收發本人確認實物、位置後點收；本人保管及勾選實際交運後保存物流。點收、寄出及同步重試不再扣庫存。
- 權限、公司、在職人員、貨品／倉庫／SN、數量、單據及每件 proof 均重新核對。配貨鎖序與售後整新資格鎖保持同序；一般出庫不隱式使用 QUALIFIED 整新品池。若公司要求外部庫存確認，本地 proof 不能備貨／點收／出貨。
- 每件 `corely.mailroom.dispatch.v1` 固定 eventId／itemId／sourceVersion／receiptId／申報行／數量 1。AFTER_SALES 只收精確 applied ACK；先前進度 ACK 不證明本次寄出。維修品沿原收發點收及實際替換 OUT 證明，原件與替換件分開。
- 同 requestId 同內容只重讀原回執；變更內容衝突。提交後回讀失敗回 503，前端保留原 UUID/body/actor/company；HTTP 成功但 GET 失敗不能清掉原操作。更新來源只更新主單版本，不改保管人或扣庫存。

## 維修與品項不符

- REPAIR 的 await_customer 同交易保存當件／當版檢修提案與 CSR proposalHash，只發 AFTER_SALES outbox。完整提案走 `/api/integration/mailroom/workflow-events`，ACK 的 acceptedProposalHash 必須相同。
- 所有顧客 REPAIR start／complete 都要求 current CSR、每件 quote binding、當版同意及付款，必要發票須當版已開立；不保留無 CSR／免費 legacy 放行旁路。公司 RETURN 整新不套用顧客財務門檻。
- start／complete／await_customer、寄出及一般出貨鎖後重读 Source，遠端讀後再核 actor/company；精確已提交重試不再抓 Source。交易 20 秒。這是 fresh optimistic gate，不能證明跨資料庫原子性。
- resolve_mismatch 必須由目前承辦客服提出，並核最新簽章 Source 的真 caseBrand、該件實收／申報／照片 hash、唯一 APPROVED ACCEPT_ACTUAL proof；頂層 customerProductConfirmations 優先，空陣列不回退舊 releaseInfo。DEV_STUB 限明確 sandbox 與指定 QA 公司。CONFIRMED_ACTUAL 後續交辦／維修／寄出／入庫也重核顧客產品確認；改位置不改 identity。
- `MailroomProductMismatchFact` 是唯一實物原因的證据事實，不是客服過失認定或績效扣分。最初審核人的 ERP 映射只取 Source firstReviewErpActorId，缺失留 null，不猜目前承辦人。實收資料或照片變更會 VOID 舊事實並重新交客服；具有出庫／完工／交運結果的操作不能同時變更已確認身分，整筆回滾。原 VOID 原因不自動復活；新確認保留在新的 action/workflow，原證據維持。

## 中央整合必要步驟

中央 sole schema editor 將 `backend/prisma/fragments/mailroom-outbound.prisma` 的三個模型加入當版 schema，整合兩個新 migration；本分支沒有覆寫共享 schema。收發使用獨立 node_modules，僅以基底 schema 加 fragment 的私有暫存 schema 離線 generate，再完成 build；沒有連 DB 或執行 migration。單純 cherry-pick 後不補 schema 不能建置新 delegate。

Source signed cases 須供應 `caseBrand: MOZTECH|BONSON|WANBO|null`、`firstReviewErpActorId: safe ID|null` 與頂層 `customerProductConfirmations`（RETURN 也提供）。舊 `.brand` 是客戶窗口名稱，不能代替真品牌。ERP 實收 productId 維持真 ERP UUID，不猜 SKU／SN／barcode／保固。

Claw catalog／generated／manifest 由中央統一修改。已讀 mailroom-workbench 雙語 guide；需新增以下兩語步驟及 sourcePaths，再做 coverage/drift check：

- 中文：寄件中的售後出貨選既有主單與本次件數，依序由有庫存權限的人員備貨出庫、指定收發本人點收、目前保管人登記交運。維修品沿原件待寄回清單；已安排件數不是已寄出件數。品項不符須先取得該件實收產品的顧客確認。
- English: In Outbound, select an existing source case and this shipment's quantities. Authorized stock staff prepare the goods, the named mailroom recipient accepts them, and the current custodian records carrier handoff. Repair returns stay in their original return queue. Planned quantity is separate from dispatched quantity. A mismatched item needs customer confirmation of its actual identity.
- 替換舊 boundaries[20] 中英文字：本次寄出依固定事件回執顯示待同步、失敗或已套用售後資料；可重試同步但不重寄、不重扣庫存。歷史 PENDING_COMPATIBILITY 不自動補送。這些回執不代表 AI／LINE 顧客通知送達、顧客簽收或自動結案。
- English replacement: This dispatch shows Pending, Failed, or Applied to after-sales only from its exact event receipt. Retrying sync does not ship or deduct stock again. Historical PENDING_COMPATIBILITY records are not backfilled automatically. The receipt does not prove AI/LINE delivery, customer receipt, or case closure.

## 驗證與保留限制

本批 targeted mock suites、native React/Ant/axios 離線 DOM、scoped lint 及前後端 build 結果由同目錄 evidence receipt 索引；不同 runner／重跑不相加成完整業務通過。前後端既有共 5 項 lint warning、瀏覽器資料及 bundle 體積 warning 保留。

待中央固定合併 SHA 上做六類 DEV synthetic API／資料庫／權限／畫面驗收。未驗證真 PostgreSQL 競爭、實物、外部 WMS/ECOUNT confirmer、物流、顧客 LINE/AI、退款／付款／正式環境。prepared OUT 取消需另有正式回庫流程；歷史未同步寄出不自動補送；Source proof 撤回的 changefeed 及 KPI 消費／公司評分規則仍需中央接線，未宣稱績效閉合。新寄件位置為保管文字，尚未加入舊立體貨架占用投影。Source 出貨頁每批上限 50 主單／100 行／200 件，較大量資料需另外分頁設計。

共用輸入框修復原 `0de3b436`／`5c882235` 已在目前 DEV d3 保留。新離線單框 7/7、静態 35 檔／69 textarea 定義及公開 DEV CSS exact bytes 重核完成；沒有新增 CSS 或部署。此數量不是 69 live 介面驗收。
