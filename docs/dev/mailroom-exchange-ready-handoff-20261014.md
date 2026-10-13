# 收發室換貨備妥事件交付

本候選修補一般換貨的收發點收回傳。只有指定收發本人完成 `accept`、正式進入 `READY_FOR_DISPATCH`，才依實際寄出物件建立逐件 `EXCHANGE_READY`。備貨出庫、實物點收、交物流、顧客通知及外部庫存確認各自保留。

## 固定範圍與整合順序

- Checkout：`corely-erp-mailroom-outbound-delivery-20261013`；private owner：`/private/tmp/corely-mailroom-erp-owner-20261013.git`。
- 分支：`codex/exchange-ready-proof-20261013`；基底：`454ec8ed0467269717392db8e1a0448e551d01d3`。交付的完整提交 SHA 以外部收發固定票及 named remote 為準；收發不改中央 mutable 候選。
- 中央已有 454 时，只整合本候選 delta。沒有修改 Source、Prisma schema、migration、MailroomModule、constructor、caseProgress 或前端；本次不新增 API route。
- 基底 454 的三模型／兩 migration 仍須中央整合。此次 backend build 使用先前離線生成的私有 Prisma client，不能當 tracked 主 schema 已自含 454 模型或 migration 已套用。
- 中央「DOA 售後工作台 開發」是唯一整合與 DEV 發布者。供方 980 的共享維修 gate、Source serializer、SDK、schema、Claw 接線另依中央最後固定版本驗證。

## Producer

入口在 `MailroomOutboundService.command(..., action: 'accept')`，只處理 `caseType === 'EXCHANGE_RETURN'`；REPAIR 替換、RESHIPMENT、PRIVATE_PURCHASE、RETURN 整新及 `prepare` 不產生此事件。

1. 原 request UUID／body replay、order lock、fresh actor／company、指定本人與最新 Source 放行保持。
2. 同 transaction 的 `stock.verify` 核整張寄件單的正式 OUT，要求每件唯一且完整。沒有二次 OUT 或外部庫存寫入。
3. 每件以正式 OUT 的 productId 讀同公司 active Product，核 SKU／SN／posting／warehouse／單號；實際 `Product.name` 原文寫入 release，不能借來源申報名稱或任意 label。
4. 全部物件驗證並構造完成後，才以同一交易寫入 AFTER_SALES-only delivery outbox、READY 狀態、保管人及 action journal。任一件失敗皆回滾此次點收；已存在的備貨 OUT 不被刪除。
5. 重送保留原 eventId／generation／time／hash／payload。Source 消費端不得把此 outgoing unit 加進 incoming receivedQty。

## Wire 與雜湊

[完整合成 golden event](evidence/mailroom-exchange-ready-20261014/golden-event.json) 與 [四欄 ACK](evidence/mailroom-exchange-ready-20261014/golden-ack.json) 是精確測試向量，不含真公司或顧客資料。

外層固定 `schema=corely.aftersales.workflow.v1`、`kind=EXCHANGE_READY`，包含 entityId／sourceCaseId／sourceNumber／最後真讀的 sourceVersion，以及 outgoing itemId／order receiptId／accept version／occurredAt／actor。release 固定 `schema=corely.mailroom.exchange-ready.v1`，含 orderId、itemId、sourceCaseItemId、原 prepareRequestId、generation、readyAt、實際商品名稱／SKU／SN、quantity=1、正式 stock proof 與 readyHash。

- `release.orderId === receiptId`；`release.itemId === itemId`；`generation === version`；`readyAt === occurredAt`。
- Stock reference 固定 `AFTER_SALES_OUTBOUND`／order UUID，不能借 `AFTER_SALES_REPLACEMENT` reservation。`externalInventoryPosted` 必須為 literal `false`。
- UUID、安全識別碼、canonical UTC ISO（毫秒）、exact key 集合與數量都驗證；重新 hash 的錯別名、假數量或假 external flag 仍拒絕。
- readyHash = UTF-8 SHA256 of sorted-key canonical JSON：`{entityId,sourceCaseId,sourceNumber,sourceVersion,itemId,receiptId,version,occurredAt,replacementRelease}`，其中 release 排除 readyHash；eventId／actor 不列入實物 release hash，但完整 HTTP body 仍由既有 HMAC 簽署。
- Golden readyHash：`abce5a39c47c5d2e2dea42782351def6d2f2f94ec7fc3a4f694da6458d158e29`；獨立 Python canonical hash 與編譯後 producer／ACK validator 相符。

## Transport 與 Source 接口

既有 delivery worker 使用 `POST /api/integration/mailroom/workflow-events`，不採 progress 的 custom eventsPath。傳送前重新核 strict wire，且 `payload.entityId === delivery.entity_id`；AFTER_SALES 以外 target、錯公司或壞 payload 都零 HTTP 呼叫並保持 PENDING。

僅接受 `{accepted:true,eventId,sourceCaseId,acceptedReadyHash}` 的相符值；沒有 `applied:true` 要求。missing／wrong hash、proposal ACK、receipt-only ACK、錯 case／event 或 false accepted 都保持 PENDING。DELIVERED 只代表 Source 收到此證明，不能表示已出貨、已通知顧客或已寫外部庫存。舊 REPAIR_PROPOSAL ACK 與 dispatch 的 applied＋shipmentId 條件保持。

Source consumer 另核該 case 的真品牌、當前 LINE 身分、finance／proposal／receipt binding 與時序。可以按 order／generation 聚合 DRAFT；單件或部分寄件单的事件不能把整案數量宣稱完成。晚到 READY 不能遮蔽 SHIPPED／DELIVERED 或宣稱 LINE 已送达。本候選不代簽 Source 實作、財務、外部系統或顧客接受。

## 實際驗證

- Root final exact-path Jest：4 suites／292 tests PASS。原先 291、子審核 125／79 都在同一範圍內，不相加；final raw JSON／stdout 保存在 evidence。
- Nest backend build PASS；production 四檔及新 contract spec scoped ESLint 0 errors／0 warnings。新 contract spec 的 malformed-wire fixture 有局部 unsafe-type 指令，production 沒有規則抑制。
- 兩份既有 service spec 的完整 ESLint 基底已有 83 errors／18 warnings。原始含 legacy spec 的失敗保留；修正本次新增 mock／assertion typing後，新 delta diagnostics 為 0，沒有放寬舊規則或整體抑制。
- 覆蓋逐件完整正式出庫證明、真 catalog 名稱與 SN、錯 proof／Source／角色／公司、任一件缺證明、outbox／journal rollback、原 request retry、exact route／HMAC／ACK／company gate。
- 全部合成／offline mock，fetch 被替換。沒有真 DB、Source API、LINE、物流、退款、庫存或部署操作。只有四 DEV Cloud Run control-plane metadata 的唯讀 preflight，仍 d3／f56 Ready、唯一正主流量 100%；不當 runtime source 或業務接受。

## Claw 整合審閱

已讀基底的 `mailroom-workbench` 及寄件相關雙語 guide。操作入口未新增；中央最後整合须更新已有寄件內容與 source hashes，再執行 coverage／drift check。本視窗不並行修改中央 catalog／generated manifest。

中文候選內容：一般換貨完成備貨後，指定收發人員須逐件點收；點收完成後回傳備妥狀態。寄出仍須由目前保管的收發人員登記實際物流與單號並確認交運。

English candidate: After exchange goods are prepared, the assigned mailroom person personally checks and accepts each unit. Acceptance reports the goods ready for dispatch. Actual dispatch still requires the current mailroom custodian to record the carrier and tracking number and confirm physical handover.

這是技術交付文件，不將流程教學／實作說明放入日常操作頁面。
