# AI 客服／LINE 與售後工作台接口覆核（2026-10-08）

本輪是唯讀來源盤點與接入契約建議。**現有 ERP 有持久事件配送，AI 客服有品牌隔離的 LINE、對話、人工回覆／通知、指派與備註；本次未找到把售後六類主單事件接進 AI 對話的 receiver、案件對話綁定或客服接手回寫接口，不能稱已串通。**

建議把「售後聯絡卡」放進個別案件與既有 AI 客服對話：客服沿用原對話回覆、通知、指派及備註；維修／收發看自己的節點與受權的溝通結果。產品管理、LINE 渠道設定、操作紀錄、付款／退款／發票沿用既有入口，售後工作台不另做第二套。知識庫保留本次使用者提出的例外，不因此擴張其他重複頁面。

本次沒有讀取憑證或營運資料、呼叫產品 API、操作 DB／雲端／部署、發送 LINE 或聯絡其他聊天。只新增本文件。官方 LINE 文件僅用於確認 Provider 與訊息送達語意；本機來源證據不代表目前雲端實際版本或品牌配對已驗收。

## 1. 版本與工作樹

| 來源 | 本次實際 HEAD／分支 | 工作樹與採用界線 |
| --- | --- | --- |
| AI 客服主盤點 | `3f352f7bcee5f4587412de5dfdce7cccba9c3b55`，`codex/webchat-isolated-cases-20261001` | `/Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930`；僅 `outputs/` 未追蹤，沒有開啟輸出或憑證。本次接口證據採此 checkout，不宣稱為雲端最新版。 |
| AI 客服另一既有工作樹 | `4dd0d938b86ee51106fbf7b929d4c6a383f355bd`，`codex/customer-understanding-20260921` | `corely-applicability-20260915`，clean；本次不把較舊工作樹接口混入主盤點。未查遠端 ancestry／部署。 |
| 原售後 Source | `20f583b6284e93e5516a533733b3833120aaae0d`，`codex/aftersales-workflow-20261005` | `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005`，clean。六類主單、原付款／發票／物流按鈕仍以此 Source 為現行來源。 |
| ERP 接口 | `f3f14c4104906cc6ca23bd1d38ba4589563b6801`，`codex/repair-workbench-20261008` | `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008`；維修前端有其他工作者在製作的未提交更動及新增 readiness 檔／交接文。本次不修改或據此宣布完成，接口判斷採未變的後端契約。 |

兩個母資料夾是協調區，Git 尚無 HEAD，不能當產品 repo。已閱讀產品 `AGENTS.md`、[共同規則](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/plans/workbench-coordination/README.md:29>)與 [歷史 DEV 核對範圍](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/.dev-review/aftersales-20261006/DEV核對指南.md:59>)。歷史四角色／19 入口、合成案件與內部通知證據，不能升格成真實 AI／LINE Provider 配對或訊息送達證據。

## 2. Canonical 責任與清爽入口

| 能力 | 保留的既有責任 | DOA 個別案件只呈現／接入 |
| --- | --- | --- |
| 六類案件、客服受理／正式報價／顧客決定 | 原售後 Source 主單；ERP 同源原頁面保存全部既有表單及控制項 | 主單 ID、類型、目前節點、當版報價／決定引用，並受權開啟原頁。不能再建一份 AI 案件工作流。 |
| AI 對話、客戶對話身分、人工指派 | AI 客服 `Conversation`／`EndUser`／`OpsMembership` | 已綁定對話、目前客服、待辦聯絡卡；沿用原回覆、通知、內部備註、結案／重開及匯出功能。AI「對話結案」不等於售後完成。 |
| LINE OA、Messaging／Login／LIFF 設定 | AI 客服既有品牌 LINE 渠道入口；Source 現有 LINE 支付能力需明確連到同一對標 | 只讀品牌配對與身分驗證狀態，以及受權連回既有設定。不要第二組 token 表單，也不要讓收發／維修持有 token。既有 OA webhook 改址仍需獨立授權與驗收。 |
| 產品主資料／服務价目、AI 商品資訊 | ERP／原 Source 商品管理；AI 商品資料是回答用產品知識，不能代替正式庫存 | 引用原 productId／SKU／服務項目；產品管理原頁保留，DOA 不新建產品 CRUD。AI 資料更新可由既有品牌資料入口做受控投影，不雙向互相覆寫。 |
| 收款、退款、對帳、發票與寄件 | ERP／原 Source 既有正式單据與原流程 | 只顯示受權的結果及單據引用。AI 不建第二本帳、不以對話文字或通知成功直接入帳／退款／開票。 |
| 實物、檢修／維修單與換機庫存 | ERP Native item、技術文件版本、正式 IN／預留／OUT | 顯示必要且受權的交接摘要，照片與文件引用原附件服務；不把整份內部技術／金融資料貼進顧客對話。 |
| 操作紀錄、內部通知 | 各系統既有 audit／timeline／Notification；保留每端原事件記錄 | 同一 eventId／requestId 串聯原紀錄，案內一條摘要時間線；不要再複製整套紀錄管理。 |

AI 客服原入口可見於 [既有側欄](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/ops-ui/src/components/layout/sidebar.tsx:45>)：對話／待辦／告警／操作紀錄／人員／品牌。LINE 設定保留 [原連線儲存表單](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/ops-ui/src/app/ops/(protected)/agent/channels/page.tsx:176>)；AI 商品欄位出自 [原產品資訊匯入欄位](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/ops-ui/src/lib/product-catalog-import.ts:15>)與 [回答用產品 catalog](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/brand-ai/brand-ai-runtime.ts:84>)，本次沒有把它們認作 ERP 庫存。

**嵌入界線：**目前 AI Ops 用自己的 bearer 登入與 tenant／brand 上下文，未找到 ERP→AI Ops 的受限一次性 SSO／session bridge。既有 `/ops/chat/:conversationId` 深連可作受權導航；直接放 iframe、傳 localStorage token 或只附 tenant query，不等於整合完成。若要案內保留完整原 AI 按鈕，可重用既有對話元件與後端，或另設受限同源嵌入 session；需要獨立實作登入、權限交集、登出清除、草稿保護、API base path 和原控制項驗收。不能把外鏈標成已完成的案內工作站。

## 3. 現有 API／控制項可沿用什麼

| 現有接口／原按鈕 | 本次程式證據 | 可用範圍與缺口 |
| --- | --- | --- |
| LINE 進線 webhook：`POST /tenants/:tenantId/brands/:brandId/webhooks/line` | [raw body 驗簽](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/webhooks/line/line-signature.guard.ts:44>)；[LINE 入站](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/webhooks/line/line-webhook.controller.ts:621>)，640–646 核對實際 channel tenant／brand | 是 LINE 事件，不是 ERP domain event。不能偽造顧客進線塞案件節點，否則會變成 inbound message 並啟動 AI draft。 |
| `GET /ops/api/conversations`、`/:id`、`/inbox/counts`、`/inbox/search` | [對話列表](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-conversations.controller.ts:1735>)、[對話明細](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-conversations.controller.ts:1988>)、4117／4321 | 可以讀既有對話、未讀／待辦及搜尋。搜尋包含 user ID／名稱／訊息，但不是已驗證的 SourceCase→EndUser 精確映射接口，不能用模糊搜尋自動選中顧客。 |
| `POST /ops/api/conversations/:id/messages`；審核／編輯並核准；「送出並通知」 | [人工回覆 API](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-conversations.controller.ts:3192>)；[原回覆／notifyEndUser](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/ops-ui/src/app/ops/(protected)/chat/[conversationId]/legacy-client.tsx:2920>) | 保留原人工回覆／附件／LINE 通知。訊息保存、對外通知是不同結果。新售後內部卡片不可透過這個 send endpoint 當成顧客訊息，也不能自動取得 AI AUTO 核准。 |
| 原人工指派，`POST /ops/api/actions/assign` | [指派規則](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-actions.controller.ts:86>)；[原指派下拉](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/ops-ui/src/app/ops/(protected)/chat/[conversationId]/legacy-client.tsx:5024>) | 需品牌管理資格、同品牌／wildcard 的 active Ops／Admin 候選，對話必須 PENDING。不是任意外部售後承辦 API，不能直接拿 ERP userId 當 Ops assigneeId。 |
| 原內部備註增／刪、客戶 profile、優先／追蹤、結案／重開 | [備註 API](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-notes.controller.ts:62>)；[原備註按鈕](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/ops-ui/src/app/ops/(protected)/chat/[conversationId]/legacy-client.tsx:4708>)、5075／5103／5135 | 原能力保留；備註 create 沒有外部 eventId 去重字段，不能以反覆 POST notes 當正式售後 event inbox。按對話結案不更新付款或實物。 |
| 對話 JSON／CSV 匯出、匯出至 webhook | [原匯出接口](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-conversations.controller.ts:2548>)；[原匯出控制項](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/ops-ui/src/app/ops/(protected)/chat/[conversationId]/legacy-client.tsx:4919>) | 保留；webhook 是「向外送整份對話匯出」，不是售後事件 receiver，不應拿來轉送完整客戶金融資料。GET export 也會寫 audit；本次沒有觸發。 |
| 品牌 LINE 渠道：`GET /ops/api/channels`、`POST /channels/line/upsert`、`PUT /channels/:id` | [原渠道 API](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-channels.controller.ts:145>)、211／353 | Upsert 會向 LINE bot/info 驗 token、PUT 官方 webhook，然後保存。這是有外部副作用的設定，不能當唯讀 health check；本次未執行。 |
| 告警、政策、失敗重送：`GET /ops/api/alerts`、`/alerts/policy`、`/alerts/dlq`；POST replay | [原告警接口](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-api.controller.ts:1412>)、1653／1662／1673 | 現在是系統／AI 告警與通知政策。既有外送 sink 是 webhook／Slack／email；不是特定售後案件的 CSR 本人接手 inbox。 |
| 原 audit：`GET /ops/api/audit` | [原 audit](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-audit.controller.ts:39>) | 保留原權限與原紀錄，案內以 correlation 引用。 |
| ERP 原生配送至 `AI_CUSTOMER_SERVICE` | [corely.mailroom.v1 與双 target](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008/backend/src/modules/mailroom/mailroom.service.ts:885>)；[POST + ACK](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008/backend/src/modules/mailroom/mailroom-sync.service.ts:294>) | 實際有 sender／outbox；預設目的 `/api/integration/mailroom/events`。AI repo 未找到相符 receiver／驗簽／ACK／卡片／案件綁定，故目前不能對接成功。 |

原對話實作雖檔名是 `legacy-client.tsx`，目前 `client.tsx → client-impl.tsx → legacy-client.tsx` 正在使用，不能誤判為不用的舊 UI。原 UI 中通知修復的 `openRepair` 實際是開客戶 profile（[setIsProfileOpen](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/ops-ui/src/app/ops/(protected)/chat/[conversationId]/legacy-client.tsx:4283>)），不是 DOA 維修案件。

## 4. 品牌與顧客身分：必須先解開的四層對標

| 映射 | 既有證據 | 新接入要求 |
| --- | --- | --- |
| ERP entity／Source instance／案件品牌 → AI tenantId／brandId | AI `Brand` 屬 tenant；ERP 有 preparatory `AfterSalesBrandSettings`／`AfterSalesCaseBrandBinding` | 明確且唯一、啟用、可追版本。不要用品牌顯示名稱、sourceChannel 或串接 client label 當同品牌證明。 |
| 品牌 → LINE Provider／Messaging channel／OA destination／Login channel／LIFF | AI Channel 記錄 scope、OA destination、Login channel 及 credential；Source 有每品牌 env 取值 | 逐品牌核實 Provider 與 OA／Login／LIFF 关系，存非秘密引用及核對版次。兩品牌不共用 fallback，識別字段不可互換。 |
| Source customerId + 品牌 → server-verified LINE subject → AI EndUser／Conversation | Source `CustomerLineIdentity`；AI EndUser 唯一 tenant+brand+channelUserId | 綁定需 server token／已驗簽入站等證據；持久 SourceCase↔conversationId 連結並核 EndUser、channel scope。多對話用既有 canonicalize 規則確認，不靠「最近一筆」「姓名相同」。 |
| Source／ERP 承辦人 → AI OpsUser／會員資格／目前 assignee | Source assigneeId；ERP active 同公司 email 單一比對；AI metadata.opsAssigneeId | 建有證據的人員 ID 映射，變更／停用即時重查。任務交指定人；不自動覆蓋整條對話的原 assignee。人工重新指派需原權限和版本。 |

必守的程式差異：

1. **Source `SourceCase.brand` 不是真實品牌碼。**[toSource](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005/services/mailroom/service.ts:85>)回 `client.label ||「售後」`；六類 Source changefeed 契約也沒有 brand／customerId／LINE identity／conversationId。若不先補映射，不能安全地讓六類事件找到正確 AI 顧客。
2. **已有品牌表不等於已驗證。**Source 主單 `Case` 本身沒有強制 brand；`PaymentRequest.brand` 可空。ERP preparation 讀品牌回 `lineStatus: not_connected`、`invoiceStatus: unverified`（[明確未連線状态](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008/backend/src/modules/integration/after-sales/after-sales-preparation.service.ts:37>)）；`caseBrand` 只由付款品牌／已保存案件品牌取值並阻衝突（155–166），沒有 AI tenant、Provider 或身分驗證。
3. **拒絕 legacy 品牌回退。**[resolveLineBrand](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005/lib/line-brand-config.ts:44>)遇空／無效品牌回預設（可為 MOZTECH）；MOZTECH token／secret／LIFF 支援舊全域 env fallback。[preferred identity](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005/services/customer-line-identity-service.ts:34>)取不到同品牌 identity 會退到 `Customer.lineUserId`。新的橋接及發送 gate 不可使用這兩種回退。
4. **CustomerLineIdentity unique 並不證明 userId 已驗證。**[品牌 identity schema](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005/prisma/schema.prisma:299>)有 customer+brand 與 brand+LINE ID unique；但這条公開付款路徑從 hidden `lineUserId` 讀入（[公開 submission](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005/features/payment-requests/actions.ts:185>)），[raw input 綁定](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005/services/payment-request-service.ts:706>)再寫 submission／request 並調 bind。此受查路徑沒有看到 server LINE token 驗證，因此不能把既存每筆 identity 都視為 serverVerified；付款連結簽名／電話核對也不等於 LINE token 身分證明。
5. **AI 已有較完整的 LINE 驗證可沿用。**OAuth callback 用品牌 state、server token exchange／profile，再簽 brand+LINE subject；WebChat 檢驗 token brand、subject、期限（[OAuth callback](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/public-auth/public-auth.controller.ts:174>)；[server identity gate](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/public-config/public-config.controller.ts:525>)）。仍須新增與 Source customerId 的正式關聯，不是把 token 複製成新的綁定 UI。
6. **channelId 字段不同義。**AI upsert 把 `botInfo.userId` 存進 Channel.channelId（[destination](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/ops-api/ops-channels.controller.ts:271>)），用來對 webhook destination；ERP preparatory channelId 限數字（[數字 channelId](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008/backend/src/modules/integration/after-sales/after-sales-preparation.contract.ts:62>)）。對接必分 `messagingChannelId`、`botDestination`、`lineLoginChannelId`、`providerId`；沒有核實資料不可補猜。

LINE 官方說明：同 Provider 下 Login／Messaging 取得同一使用者 ID；不同 Provider 的 ID 不能當同一顧客。即使兩品牌同 Provider，內部資料與發送仍必須按品牌隔離，不能以同一 userId 放寬 tenant／brand。[Get user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)；client profile／userId 應以 server token 驗證，[Send tokens, not profile data](https://developers.line.biz/en/tips/2026/08/13/send-token-to-server/)。本輪沒有查 LINE Console，所以 MOZTECH／BONSON 的實際 Provider、channel／LIFF 配對均記作**未核實**。

## 5. 哪個狀態代表什麼

| 顯示狀態 | 最少證據 | 絕不推論 |
| --- | --- | --- |
| 事件 PENDING／SENDING | ERP durable outbox／租約與重試紀錄 | 另一端已收到、客服已知道。 |
| AI RECEIVED／ERP delivery DELIVERED | receiver 交易保存、唯一事件 ID／payloadHash，ACK `accepted:true,eventId` | 卡片已在瀏覽器顯示、客服本人接手、對外 LINE 送達。 |
| 內部通知已讀／卡片已看 | 原通知／卡片 read receipt | CSR 已受理、同意方案或保管實物。 |
| CSR SENT → ACCEPTED → RESOLVED | ERP 當版任務，指定客服本人點接手／完成並保存操作者 | 對話 Ops assignee 改了就等於 Native CSR 接手；客服接手就等於顧客接受。 |
| AI 回覆已保存 | 原 Message／ReplyReview／送出結果 | 已送 LINE。[未通知也記 SendLog SUCCESS](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/channel-sender/send-approved-reply.service.ts:1249>)甚至會在不通知 LINE 時保存 SUCCESS+providerMsgId null，不可只讀 SUCCESS。 |
| LINE provider accepted | 原 provider request／message ID、send log、notification 結果 | 消費者已收到／已讀／願意維修。LINE 對封鎖等情況仍可回 200；[Push API 官方說明](https://developers.line.biz/en/reference/messaging-api/nojs/#send-push-message)。沒有獨立證據就顯示「已交 LINE」，不寫「顧客已確認」。 |
| 顧客同意本版／付款本版已確認 | Source 正式 quoteRevision／customerApprovedQuoteRevision／確認款項與金額／幣別 | LINE 發送成功、已讀、回一句「好」或上傳截圖直接釋放維修。 |
| 實物簽收／IN／OUT／發票／退款 | 各原始交易及回執 | 任務／訊息配送代替這些結果。 |

現有 ERP delivery 對 ACK 檢查見 [accepted+eventId gate](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008/backend/src/modules/mailroom/mailroom-sync.service.ts:300>)；目前 ACK 表達上游接受事件，不是員工接手。AI 既有「送出並通知」保存事件 success／failed，但也只代表該動作結果，不能映射成 repair consent。當前報價／同意／足額收款守門可讀 [原 releaseInfo](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005/services/mailroom/service.ts:53>)與 89–95 的 repairAllowed。

## 6. 最小可實作接入契約（提案，尚不存在）

先在既有 AI API 模組補 receiver／綁定與案內卡片，不新增獨立微服務、不複製另一套售後／金融系統。ERP Native 仍用 `corely.mailroom.v1`，用明確 adapter 轉成內部售後投影；Source 六類 changes 補可核實主單映射後，進同一事件接收流程。兩來源 eventId namespace 必須分開，避免同一 UUID／游標碰撞。

**建議新內部接口：**`POST /integrations/erp/after-sales/events`；ERP 可在 `eventsPath` 明確配置，不能宣稱現預設 `/api/integration/mailroom/events` 在 AI 已存在。另需受權的 case-binding／card read／CSR action adapter；初版 CSR action 可直接開原 ERP／Source 表單完成，不在 AI 回覆流程另外改一遍。要在 AI 卡片直接按接手／完成，才補版本化命令代理；後端核 current actor、公司／品牌、任務本人與來源版次，原本實作仍是 authority。

最小 envelope：

```json
{
  "schema": "corely.after-sales.bridge.v1",
  "eventId": "stable-source-event-id",
  "sourceSystem": "ERP_NATIVE_OR_AFTER_SALES",
  "sourceInstance": "configured-instance-reference",
  "entityId": "company-reference",
  "sourceCaseId": "original-case-id",
  "caseType": "REPAIR",
  "sourceVersion": "original-opaque-version",
  "nativeItemId": null,
  "nativeVersion": null,
  "node": "CSR_REVIEW_REQUIRED",
  "occurredAt": "ISO8601",
  "brandBindingId": "verified-brand-mapping-reference",
  "customerBindingId": "verified-customer-identity-reference",
  "staffBindingId": "current-authorized-assignee-reference",
  "documentRefs": [],
  "publicSummaryRef": null
}
```

`sourceVersion` 與 native integer version 分開，`quoteRevision`、檢修版次及付款版次另於需要的 typed refs 保存；不要用郵件 version 當報價版本。receiver 從 server 綁定讀 tenant／brand／channel／EndUser／conversation，不接受前端任意送 LINE userId、conversationId 或任意 redirect URL。角色只收到業務所需投影；顧客摘要必須另欄真實，不把內部換機來源、成本、技師診斷與財務附件自動外送。

**認證／去重：**沿 ERP 現 `x-mailroom-key/entity/time/signature` 所簽 method/path/time/body/entity 格式，配置 key 的 entity／Source instance／AI tenant／brand scope；receiver 驗 body、時間與 key scope。HMAC timestamp 不能代替持久去重。使用唯一 `(sourceSystem, sourceInstance, entityId, eventId)` 及 payloadHash；相同 ID 同 payload 回原 ACK，不重建卡片／通知，不同 payload 拒絕。transaction 內一併保存 inbox、projection、通知任務，再 ACK。晚到舊事件可保存歷史，不能覆蓋新節點或重新指派；變更品牌／person mapping 要新綁定版本。

**綁定未完成：**事件可在同公司／品牌受權的未對標待辦保存，ACK 明確標 `routingStatus: NEEDS_BINDING`；不得冒稱已送指定客服或默認送品牌。若 key／entity／brand scope 錯誤則直接拒絕而不保存跨租戶資料。閉合／停用的對話不自行重開，也不把新的 ERP 事件偽装成顧客問題；需要人工指定有效對話或按原 normal LINE／WebChat 規則建立。

**客服回写：**`claim`／`resolve` 帶 `requestId`、current Source／native／inspection versions。明確綁「這一個售後任務」而非整段對話全局 status。人工在 AI 看到「報價待確認」並發送摘要，Source 顧客同意／款項仍由原流程保存。未取得原系統成功回執顯示待確認；結果未知先查原 requestId，不重報價、不重開案、不重退款或重扣庫存。

## 7. 六類案件的卡片內容與原按鈕保留

六類正式型別來自 [Source CaseType](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-workflow-20261005/prisma/schema.prisma:31>)；Native `REPAIR／RETURN` 只描述實物類別，不能取代六類主單。

| CaseType | 案內卡片／通知重點 | 沿用的原業務按鈕與 authority |
| --- | --- | --- |
| REPAIR | 收件不符重審、檢修送客服、正式報價、顧客本版決定、款項等待／放行、完工寄回 | 原報價與顧客確認、付款確認、技師檢修／維修／QC、交回及物流。保留 free／paid／repair／replace／factory／未修退回分支。 |
| RESHIPMENT | 補寄品項與地址待核、準備寄送、物流結果、顧客回覆 | 原補寄品項／寄件按鈕，引用正式庫存及物流回執；通知成功不當成已出庫。 |
| EXCHANGE_RETURN | 退回品核對、差異覆核、換貨方案確認、返還／寄送結果 | 原退換、逐件收發與換機預留／OUT，交換品與原件去向各有實物紀錄。 |
| REFUND_PICKUP | 收回物流、實收核對、退款審核／等待／結果 | 原派車、退款流程及原付款單引用；退款執行与提醒分離，AI 不自動發起實際退款。 |
| PRIVATE_PURCHASE | 私購需求、海外／地址／幣別必要資訊、原報價／收款、交付進度 | 保留全部私購原表單、欄位／附件／選項、原收款及發票，不重寫成一般維修單。 |
| CUSTOMER_ISSUE | 待補資料、指定承辦人、處理回覆、進度／結案 | 原客訴處理、客戶附件、回覆與案件狀態；AI 對話結案不替代 Source 客訴結案。 |

每張卡只放案號、類型、目前節點、目前承辦／待接手、版次、最近一筆必要摘要及「開啟原案件／對話」。表單、dropdown、下載／匯入／列印、退換／私購特殊分支及金融控制項保留在原頁，不因側欄清爽被刪。缺映射時顯示「待對標」與原因，只供受權客服核對，不向顧客發送。

## 8. 目前能重用的持久性與仍缺的接口

- ERP Native 事件 outbox 有 `(eventId,target)` unique、租約、SKIP LOCKED 及 ACK 後 DELIVERED；schema 見 [MailroomDelivery](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008/backend/prisma/schema.prisma:2466>)。但現 payload 含較完整 item snapshot，不能不過濾就原封成 AI 公開 message。
- Source→ERP six-type changes 有持久 cursor、租約＋transaction 鎖、`(cursorId,sourceEventId)` unique 與內部通知；[lease](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-20261008/backend/src/modules/mailroom/mailroom-source-sync.service.ts:81>)、141／343／355。這個 consumer 只發 ERP Notification（317–338），不等於已推 AI 對話，也不等於人員已接手。
- AI 既有 HAND_RAISE durable event 用 stable ID upsert（[handraise 去重](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/agent-runtime/hand-raise-delivery.ts:19>)），worker 30 秒輪詢、租約及最多五次重試（[原 durable worker](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/worker/src/alerts/hand-raise-delivery.service.ts:29>)）。可重用模式，不能把 replyReview handraise ID 當售後 eventId 或把現告警 receiver 宣稱成新接口。
- AI LINE inbound 的 WebhookEvent／Message 有 rawJson 及 scope，但受查 schema／append path 未見外部 webhookEventId 的唯一去重。新 ERP inbox 要獨立做持久去重，不從 LINE inbound 或 JobOutbox 推論已有售後 exactly-once。
- AI getOrCreateOpenLineConversation 會找同品牌 EndUser、canonicalize、重開 CLOSED 及 retarget channel（[現 LINE thread lifecycle](</Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-qa-import-review-20260930/apps/api/src/conversation-core/conversation.service.ts:555>)）。新 domain receiver 不直接呼叫它來製造／重開顧客對話；只引用有驗證的既存 canonical thread，遷移時保存受權連結。

**實作前必補／核實清單：**品牌／Provider／channel 非秘密對標；Source customer→verified LINE→AI EndUser／Conversation 綁定；CSR 跨系統人員與 current assignee 映射；AI domain inbox／ACK／payloadHash 去重；六類 event 投影＋typed internal card／未對標待辦；受權開原單或版本命令 adapter；ERP→AI session 如要完整嵌入；訊息保存／通知／真人受理／顧客決定／財務结果各自回執。以上不是本輪已完成功能。

## 9. 財務與資料最小共享

卡片只保存原單据的 `sourceSystem + entityId + sourceCaseId + documentType + documentId + revision + safe status`；帳戶、實際收款金額／幣別、發票／退款號碼等在有對應權限時向原服務讀取。對帳繼續放 ERP／原 Source 現有單据；AI 對話只連回原確認動作，不新增 Payment／Invoice／Refund 主表或複製銀行截圖。付款末五碼、客人回報、訊息通知、對話已讀均不能變成確認入帳。

交換新品／整新品內部處置與顧客摘要分開，原品、替代品、實物標籤／SN、正式入出庫紀錄保持真實。若事實是換機，顧客摘要不可虚構「已修某零件」。跨角色只分享該節點必要資訊；技師／收發不因收到 AI 卡片就取得完整客戶金融／員工帳號頁。

## 10. 有意義的下一階段驗收

先用兩品牌專用合成 case／LINE 測試身分，保留既有營運案件、其他角色與正式 provider 行為。最小合格證據：

1. MOZTECH／BONSON 各有明確 entity→tenant→brand→OA／Provider／Login／LIFF 與 server identity 證據；錯品牌、缺品牌、legacy ID、錯 Provider／token都不能發送或掛到別品牌對話。
2. 六類主單各一案；以目前 Source／native 版本產生節點，正確顧客對話與指定客服才出現卡片；沒有實物的補寄／私購／客訴不硬建 Native 收件。
3. 任務送出與本人 ACCEPTED／RESOLVED 分開；變更承辦、停用使用者、跨公司／brand、舊版操作都拒絕，原持有人／位置不變。
4. 同 eventId 重送不增卡／通知，改 payload 同 ID 拒絕，晚到舊事件不蓋新進度；中斷／復原只重送事件或通知，不重做付款／建案／庫存。
5. 回覆保存而通知失敗可明確區分；測 LINE provider accepted、顧客未回覆與本版同意各自證據。不得把 provider 200 或 SendLog SUCCESS 當顧客送達／同意。
6. 原 AI 回覆、附件、指派、備註、匯出、追蹤／結案、LINE 修復入口與原 Source 全部業務控制項，依受影響逐項矩陣驗；未實跑的按鈕維持「來源已讀、操作未驗」。新 iframe/session 必另驗登入／登出、品牌切換及未儲存表單返回。
7. 既有報價／付款／退款／發票／物流／庫存單据引用正確、版次一致；通知故障不變單据，無額外支付／發票／退款／ECOUNT 呼叫。外部真實供應商與現場實物作業另列驗收，不能用本次靜態盤點替代。

本輪只完成來源核對与可審查契約。沒有新 receiver、資料綁定、原頁嵌入、真實 LINE 收送或跨部門本人接手的執行證據；目前不能宣稱「AI 客服與 DOA 已串好」。
