# 維修第一批：必要發票與逐台報價提案

2026-10-13，基底 ERP `d3b7ed2c654de1605b6051db75c74789b3a1c068`；Source 對照 `f56b794401b267d1a3b3490f2e8d63923277377b`。分支 `codex/repair-closure-20261013`。本提交提供 F06／F19 的維修守門、提案契約與讀取投影；尚須中央 Source writer／consumer 及收發共用接點整合，不是完整同步或 DEV 發布回執。

已收款事實不受發票失败回滾。必要發票 PENDING／FAILED、舊 quote 票、其他實物的 quote、原件身份或幣別變動，均不能透過維修守門放行。CSR 確認方案仍可在未開票／未收足款時完成，施工與完工另外重讀放行。

## 本提交接口

- `requireSourceConsent(source, quoteRevision, requirePayment, expectedBinding)`：`requirePayment=true` 需要唯一當版實物 binding，必要票 `ISSUED`／`invoiceSatisfied===true`／同版 invoiceQuoteRevision。付費缺 invoiceRequired 判斷拒絕；免費無必要票保留，仍需 CSR、顧客同意及 binding。
- `repairSourceBindingForItem(item, source)`：純投影回 `{itemId,planVersion,planHash,proposalHash}`，由當前實物、原品、Source 幣別與已提交檢修內容重算。CSR 讀取不冒用技師身份、不授予寫入權。
- `buildRepairProposalEvent({eventId,occurredAt,actor,item,source})`：本人技師／公司／實物／WAITING_CUSTOMER 守門。協議 `corely.aftersales.workflow.v1`，`kind=REPAIR_PROPOSAL`，最大 64 KiB。來源品項取 `item.declared.id`，須在當案 Source items 中；實物 quantity 固定 1。FREE 金額為 0，PAID 為正數估價，REVIEW 為 null。
- 保留原 `inspectionPlanHash` 算法（revision＋完整 inspection data）。新增 proposalHash 覆蓋 schema、kind、公司、來源主單／編號、itemId、receiptId 和完整 compact proposal，排除 eventId／時間／actor／item version，以便重算當前身份。
- `GET /repair-workbench/items/:id/documents` 增加 server-current `repairProposalBinding`（不能解析則 null）。技師開始／CSR 通過／原廠送出與完成均使用同一 binding；待辦 producer 補選 receiptId／productId／declared，缺身份或 Source 不可讀為 unknown。
- 顧客 REPAIRING 和原廠返還的可施工待辦也重查當版 Source gate。文件查看與保存保留，沒有把付款／發票缺口變成不能保存實際維修紀錄。

## 中央與收發必須完成的接點

Source `releaseInfo` 返回 invoiceRequired／invoiceStatus／invoiceSatisfied／invoiceQuoteRevision 及逐台 `quoteBindings[{itemId,planVersion,planHash,proposalHash,quoteRevision}]`。真 ECPAY 當版 provider receipt 的判定由 Source writer／serializer 負責；不能在讀取時替舊票補蓋目前 quote revision。

Source consumer 接 `/api/integration/mailroom/workflow-events`，沿現有 HMAC。採用提案保存完整原品及方案、處理同案多台與方案改版，不把提案接收當顧客同意。ACK 應精確匹配 eventId 與 acceptedProposalHash；只 accepted=true 或舊事件 ACK 不能表示本提案已同步。

收發 sole editor 在 `mailroom.service.ts` 的 await_customer 同交易建立上述 AFTER_SALES-only outbox，保存 CSR proposalHash；不向 AI 送技術與內部估價快照。在 start_repair／complete_repair 補所有 customer REPAIR 的 current CSR、當版 Source 與 helper，移除無 CSR 的 legacy 放行旁路；公司 RETURN 整新不套顧客款票。共用 SourceCase 型別及 normalize、sync route／exact ACK、schema／module 由既定單一編輯者整合。

本提交不改 mailroom.service／mailroom.contract／schema／module／庫存 writer／Source／導航／共用 CSS／Claw catalog，沒有重做整機 IN／RESERVE／OUT。材料、工作單 v2／媒體、顧客報告與 F25 拒修／報廢另批交付，不能將本守門提交宣稱為那些功能完成。

## 驗證

供方 owned tree 四個針對性 Jest suite 共 **231 tests PASS**：release、proposal、todo、workflow。包含缺票／失敗／舊票、逐台 binding、原品／SN／receipt／幣別改而原 planHash 不變、缺身份、免費、CSR 款票等待、實物保管、版本與重試。純 fixture／mock，不操作銀行、ECPAY、LINE、真正 Source、DB、物流、實物或庫存。

固定提交的回執、scoped lint／build 與獨立檢查另隨協調票保存；不將可變工作樹測試冒稱固定提交或 DEV 營運驗收。DEV 四服務由 DOA 唯一整合／發布，中央最後須更新相關雙語頁面指南及 hashes，驗最後整合 SHA。
