# 收發室工作台交接與 Claw 雙語審閱建議（2026-10-08）

本批補齊分類收件、實物照片核對、部門／具體同仁選擇及實際交物流寄回。dispatch 只保存本系統交運回執：售後／AI 寄出消費端尚未接通，不能宣稱已通知顧客、顧客已收到或案件已結案。既有進度同步事件不包含 dispatch。

本文件作者實讀本批前後端新內容、修改差異、dispatch 交易／契約、現行 mailroom-workbench guide 及相關 fixture；本文件作者沒有重新執行測試。下列測試結果依 root 與 backend agent 的本輪實際執行紀錄整理，只新增本文件，不修改 catalog、共享設定、產品程式、測試或資料；不部署、不操作雲端／正式資料、不發真實通知、不 commit。

## 版本與範圍

| 項目 | 已核對內容 |
| --- | --- |
| Development tree | /Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-20261008 |
| Branch | codex/mailroom-workbench-20261008 |
| Base／建立工作樹時 HEAD full SHA | f3f14c4104906cc6ca23bd1d38ba4589563b6801 |
| Origin | https://github.com/moztechCEE/ecom-accounting-system-.git |
| 本批產品來源 | 14 檔：backend 6、frontend 8，均為此 development tree 相對 base 的本批修改 |
| 版本辨識方法 | 下方 14 檔 SHA-256 識別本批來源；包含本文件的完整提交 SHA 另由交接訊息／進度登記及接收端 fetch 核對，base 不代表本批發布版本 |
| Ownership | 收發室工作台本批；共享 navigation／API／configuration 與集中 knowledge 更新由 DOA 管理，repair 工作台變更由另一工作流管理 |
| Schema／migration | 無 Prisma schema 或 migration 修改；沿用既有字串狀態、action 紀錄及 repairWorkflow JSON |
| 發布狀態 | 本機程式／本機驗證與 knowledge、DEV 部署、正式驗收分開記錄；本文不是發布回執或正式核准 |

遵循 AGENTS.md：工作流程改動需先實讀 Claw guide，審閱雙語與來源雜湊，發布前完成 coverage／drift check；新增 guide 內容不授權新增 AI 資料工具或業務操作。DEV 驗證及之後的正式整合仍依原先核准程序。

## 四項功能與實作界線

| 功能 | 現在行為 | 主要來源定位 |
| --- | --- | --- |
| 1. 分類收件與工作佇列 | 首頁預設「收件與交接工作」；「登記信件／包裹」預設 LETTER、「登記售後收件」預設 REPAIR，仍可選原有類別。快捷佇列沿用伺服器 status filter，包含待核對、待同仁簽領、待技師簽收、待收發室點收、待寄回、已交物流、品項不符；沒有新增分類 API、數量彙總或跨頁計數。 | frontend/src/pages/mailroom/MailroomPage.tsx:125、:303、:346、:374；mailroom-workflow.ts:3 |
| 2. 實物照片與來源核對 | 清單顯示照片張數；詳情分列售後來源品項及實收名稱／SKU／SN。inspect 和 grade 在前端沒有既有或新增照片時阻止送出；grade 保持後端既有照片與分級驗證。照片與文字申報由同仁核對，沒有 AI 圖像判讀、來源照片配對或新的通用信件拍照入口。退貨實收資料要更正時先走 correct，grade 本身不改品項。 | MailroomPage.tsx:454、:990、:1086、:1367、:1523；mailroom-workflow.ts:73；backend/src/modules/mailroom/mailroom.contract.ts:348、:398 |
| 3. 部門篩選與具體同仁 | RecipientPicker 先選部門，再搜尋姓名／員編並選擇具體 user ID；不把部門當接收人、不自動選第一位。同部門候選保持原有公司／作業資格；名單變更或 Form reset 會同步篩選，已失效人員要求重新選擇。一般信件／包裹不送 SKU／SN。下一步提示與按鈕依既有 actions 決定，不授權額外操作。 | RecipientPicker.tsx:21；recipient-options.ts:40；MailroomNextStep.tsx:5；MailroomPage.tsx:960、:1442、:1722、:1853 |
| 4. 實際交物流寄回 | 只對收發室本人保管、已點收的 REPAIR／READY_FOR_DISPATCH 提供 dispatch。要求寄出物流、寄出單號及實物交運勾選；保存原件或經正式 OUT 證明核對的替換品快照，顯示交運人與時間、CUSTOMER_CARRIER 保管與物流位置。入件物流獨立保留。DISPATCHED 不再提供移位或重寄操作，不自動結案。 | mailroom-workflow.ts:77、:82；MailroomPage.tsx:929、:997、:1118、:1258；backend/src/modules/mailroom/mailroom-dispatch.contract.ts:119；mailroom.service.ts:1546 |

兩個 Drawer 已由固定 720／700px 改為 min(720px, 100vw)／min(700px, 100vw)，保留桌面寬度並容納手機。部門與同仁欄位在窄螢幕轉為單欄。這是版面調整，操作權限及簽收流程仍由原契約判定。

## API、dispatch guards 與不可變回執

以下路徑相對於目前設定的 API base／前綴。沿用 MailroomController 原路由（backend/src/modules/mailroom/mailroom.controller.ts:18、:42、:58）；本批新增 action 名稱及資料投影，沒有新增 controller endpoint 或修改共享 API client。

| API | 本批使用 |
| --- | --- |
| GET /mailroom/people?entityId=… | 取得可選人員；部門篩選與姓名／員編搜尋在候選名單內進行 |
| GET /mailroom/items?entityId=…&status=… | 原列表與進度 filter；新增 DISPATCHED 投影 |
| GET /mailroom/items/:id?entityId=… | 詳情、歷程、獨立 outboundShipment；用於結果未知時查回執 |
| GET /mailroom/source-cases | 原售後待到貨及來源搜尋；不將寄出變成新的來源寫入 |
| GET /mailroom/tasks | 原個人待辦；指定／通知與本人點收保持分離 |
| POST /mailroom/receipts | 原分類收件；一般信件／包裹送具體 recipientId，不送 SKU／SN |
| POST /mailroom/items/:id/actions | 新增 action=dispatch，原操作入口不變 |
| GET /mailroom/integration/cases/:id | 原服務身份驗證的唯讀來源投影新增 outboundShipment；投影不等於外部系統已消費寄出事件 |

dispatch 的窄化請求示意（全為示意值，不是實際操作）：

~~~json
{
  "entityId": "example-company",
  "requestId": "one-stable-operation-id",
  "expectedVersion": 7,
  "action": "dispatch",
  "carrier": "example-carrier",
  "trackingNumber": "EXAMPLE-OUT-001",
  "confirmedItems": true,
  "note": "已逐件核對並實際交運"
}
~~~

後端檢查如下：

1. 公司範圍、mailroom:update／既有 * 權限、可讀物件及目前公司在職 employee 綁定。精確重試仍重新驗證當下權限及 employee 綁定，不因曾成功而保留失效權限。
2. 每件資料版本符合 expectedVersion；receipt 與 item 公司一致；分類 REPAIR、狀態 READY_FOR_DISPATCH、有來源主單；收件保存的 sourceSnapshot 不得為 CANCELLED／CLOSED／COMPLETED，sourceSync availability 不得為 DELETED／NOT_FOUND。dispatch 不另 fetch 最新 Source，也不重新核准付款或顧客決定；不能把這個快照 guard 寫成即時 Source 放行查核。
3. 操作者就是目前實物 custodian，physicalCustody 為 MAILROOM；原廠／原廠物流保管不能借 READY_FOR_DISPATCH 或歷史 custodian ID 取得 dispatch 能力。
4. confirmedItems 必須嚴格為 true；carrier、trackingNumber 非空且最長 100 字。白名單只接受 entityId、requestId、expectedVersion、action、carrier、trackingNumber、confirmedItems、note；產品、SN、位置、照片、其他流程欄位不能混入交物流請求。伺服器產生交運時間及身份，HTTP DTO 不允許偽造 dispatchedAt。
5. 已有 outboundShipment、錯誤階段或版本不符阻止第二次 dispatch。DISPATCHED 在 move 契約及 UI 都被擋下。

command 交易先以公司／操作者／requestId advisory lock，再鎖定 item row。原 action 唯一鍵與內容 fingerprint 維持：相同 requestId、相同完整內容回 duplicate=true；同 key 換內容或換 item 會衝突；不同 key 的第二份舊版本請求不能再交運一次。交易中只有一次 item 版本遞增、一次原生 action／歷程寫入。

outboundShipment 放入既有 repairWorkflow 的獨立命名空間，schema=1、status=HANDED_TO_CARRIER；保留 entityId、itemId、sourceCaseId、requestId、fromVersion、version、物流、伺服器交運人／employee／時間、note、physicalItem、sourceSync。寫入採原 workflow spread，只追加此分支，保持 intake、csr、factory、release、inventoryReceipt 及其他既有分支；不覆寫原收件單、申報、原件 SKU／SN 或入件物流。現有 API 未提供覆寫／刪除寄出回執功能，重放不重建快照。讀取投影另外驗證最小回執結構並 clone，不以技術文件權限隱藏出件物流，但也不授予技術文件。

前端送出只序列化物流、勾選與 note，避免 Form 殘留品項／位置欄位。發生結果未知時先 GET 詳情，比對本次 entity、item、requestId、fromVersion、下一版 version、操作者及 trim 後 carrier／tracking。只看到 DISPATCHED 不能證明本次請求成功。未能精確核對時保留首次內容與 requestId，明確重試沿用同 key；只有精確匹配回執才顯示已保存。來源：mailroom.service.ts:1216、:1330、:1546；mailroom-workflow.ts:82；MailroomPage.tsx:990。

## 庫存、實物保管及 SourceAI 相容性

原件寄回快照取 native productName／SKU／SN，數量固定 1。替換品從既有 release.stock、已提交且 QC PASS 的維修單、POSTED reservation、CONSUMED unit、產品與正式 OUT 核對：同公司、同 repair item、reservation／posting／unit／warehouse／product 連結、數量 1、替換條件 NEW／REFURBISHED、SKU 與實際 SN、AFTER_SALES_REPLACEMENT reference 都需相符。替換 SN 不得等於原 SN；未提供 SN 只記 null，不從 unit label 或其他編碼猜出序號。

dispatch 對 stock 只讀（含既有 reservation 的 FOR SHARE）；沒有 consumeForRepair、庫存 transaction create、unit／reservation update、外部 ERP 寫入或二次出庫。正式 OUT 已在既有維修完成流程執行；此處只驗證並保存該 OUT 的證明。原合格退貨的 IN／inventoryReceipt 仍是歷史；若已作換機 OUT，其現在保管與位置依關聯 REPAIR 投影，包括 CUSTOMER_CARRIER 寄回物流，而非原入庫人員或舊貨架。關聯不足顯示待核對，不虛構保管人。來源：mailroom-dispatch.contract.ts:175；mailroom.service.ts:1553；repair-stock-custody.contract.ts:121；frontend/src/pages/mailroom/item-custody.ts:34。

| 已保存狀態／事件 | 真實流程意義 |
| --- | --- |
| 指派、claim、通知已讀／送達 | 不等於本人簽收；claim 只認領責任，不移轉實物保管 |
| WAITING_REPAIR_ACCEPTANCE／PENDING_REFURBISH | 指定技師或先認領，再經本人身份及實物確認簽收；完成前原保管人持有 |
| WAITING_RETURN_ACCEPTANCE | 技師仍保管，指定收發同仁本人以 accept_return、逐件勾選及位置完成點收後，才成為 READY_FOR_DISPATCH |
| releasePurpose=RETURN_UNREPAIRED | 未修原件交回／寄回，不能寫成維修已完成或案件已結束 |
| PENDING_WELFARE_STOCK | 已完成收發室點收；下一步庫存處理，不再要求一次技師返還簽收 |
| FACTORY／FACTORY_CARRIER | 原廠與原廠物流；不能當作 CUSTOMER_CARRIER 顧客寄回 |
| DISPATCHED／HANDED_TO_CARRIER | 實物交承運商；顧客收件、物流送達、顧客通知及售後結案另行核對 |
| STOCKED 且已有換機 OUT | 原 IN 保留歷史；目前實物沿已核對的關聯換機物流投影追蹤 |

所有 dispatch 回執目前均為 sourceSync.status=PENDING_COMPATIBILITY、reason=DISPATCH_CONSUMER_NOT_CONFIGURED。mailroom.service.record 明確排除 action=dispatch 及 status=DISPATCHED 的 corely.mailroom.v1 外部 delivery 建立；dispatch 後也不呼叫 publish／deliverPending。沒有新增 SourceAI 消費端、LINE 發送、站內寄出通知、退款、付款或自動結案。

持久待相容狀態位於 repairWorkflow.outboundShipment.sourceSync，不是為 AFTER_SALES／AI_CUSTOMER_SERVICE 各建一筆 held MailroomDelivery；dispatch 不 enqueue delivery／outbox，沒有 autoRetry 或既有 worker 自動補送能力。root 的 Source 20f 相容性審閱指出：來源 consumer 的 whitelist 尚無 DISPATCHED，aggregateStatus 尚無對應 phase，Zod 尚未承接 outbound 格式，原 source createCaseShipment 仍要求 READY；AI receiver／ACK 也待接通。這些 Source 端項目沿用 root 的交接發現，本文件作者未另跑該 Source 版本。

日後補送僅列為待設計／待驗證：DOA 需對齊 sourceShipment 與本地 outboundShipment 的去重及實際寄出品項，沿原 native action eventID／version 核對與重播連續版次。不得用新 requestId 再 dispatch 來製造外部事件，也不能宣稱現有 scheduler 會自動完成；需另驗 Source／AI 消費與 ACK 後，才可新增其對應同步結果。

畫面「售後／AI 系統同步」下的 deliverySummary／deliveries 是既有進度事件的回執，不包含本次 dispatch；另顯示寄出紀錄及待串接警示。沒有同步紀錄時 Tag 為中性色，不用 green 宣稱成功；既有事件全部 delivered 也不能推論 dispatch 已同步。現有 webhook schema、消費者映射、來源端寄出更新及將來的通知／顧客送達確認需另外設計、授權並驗證，不能用重登寄出代替相容性接通。來源：mailroom.service.ts:898、:1780；MailroomPage.tsx:1118、:1601。

## 本輪實際驗證來源與結果

以下屬本機離線／synthetic fixture。結果由 root 或 backend agent 提供；本文件作者只核對來源與整理紀錄，沒有自稱新跑，沒有另存測試報告。

| 實際執行者 | 檢查 | 結果及範圍 |
| --- | --- | --- |
| backend agent | backend cwd：node_modules/.bin/jest --runInBand src/modules/mailroom | PASS，14 suites、239/239；本批 mailroom 相關契約／service／stock custody 測試，不是全 repository 測試 |
| backend agent | backend cwd：node_modules/.bin/tsc --noEmit -p tsconfig.build.json | PASS，exit 0 |
| backend agent | Scoped ESLint，後端本批 9 檔（6 production + dispatch 契約／service spec + stock custody spec） | PASS，0 error、2 existing warnings；mailroom.service.ts:401:19 的 search.concat as any 與 :1173:18 的既有 create／publish notifications any[]，已對照 f3 base 為既有 |
| root | backend cwd：npm run build | PASS；root 本輪實跑 build，不將 backend agent 的 239 tests 或 type／lint 說成 root 新重跑 |
| root | frontend pure tests，最終合併執行下方完整命令 | PASS，24/24；包含先前 helpers 11/11 與 existing 13/13，不重複加總成另一批測試數 |
| root | frontend/tests/mailroom-recipient-dom.test.mjs，實際 React／AntD DOM | PASS，1/1；各 fixture 私有 Vite cacheDir、hmr=false |
| root | frontend/tests/mailroom-workbench-dom.test.mjs，完整 actual MailroomPage React DOM | PASS，1/1；具體 recipient user ID、信件沒有 SKU／SN、inspect 缺照片阻止送出到上傳成功、技師 custody 不可 dispatch、accept_return、dispatch 勾選必填、unknown 未 commit 以同 key 重試、commitThenLost 以本次精確回執 reconcile、IN 歷史保留及寄出後 no move |
| root | 同一 actual Page DOM 的手機與桌面 fixture／目視 | PASS；390×844 Drawer 左右無溢出，1123px 桌面目視通過；synthetic PNG 在 /tmp，非 production 截圖或真實案件驗收 |
| root | Frontend 最終兩個 tsc 檢查使用獨立 tsBuildInfoFile，再 vite build | PASS；不同 build cache 避免共享 .tmp 並行干擾 |
| root | Frontend scoped lint／diff check | PASS；0 error、3 existing hook warnings；diff check PASS |
| root | Knowledge generator --check | FAIL；未 --write |
| root | Knowledge spec | 16/17；唯一失敗為 known-8 既有 source hash drift；本批新 guide 來源尚需加入 sourcePaths |
| 本批未執行 | Candidate／DEV 部署、資料庫 migration、雲端／正式資料、SourceAI dispatch 消費、真實通知、承運商／顧客實物驗收 | PENDING／NO-IMPACT：未部署、無 migration、不含外部業務操作；不把本機 PASS 作為正式驗收 |

root 最終前端 pure test 命令（frontend cwd；target=ES2022 保留 Map 迭代語意）：

~~~sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test tests/mailroom-workbench.test.ts tests/mailroom-recipient.test.ts tests/mailroom-intake.test.ts tests/notification-refresh.test.ts tests/repair-item-custody.test.ts
~~~

後端 lint 涵蓋檔案：mailroom.contract.ts、mailroom.dto.ts、mailroom.service.ts、repair-workflow.contract.ts、repair-stock-custody.contract.ts、mailroom-dispatch.contract.ts、mailroom-dispatch.contract.spec.ts、mailroom-dispatch.service.spec.ts、repair-stock-custody.contract.spec.ts（均位於 backend/src/modules/mailroom）。除上列已取得完整命令，其他 row 保留實際工具／範圍及執行者，未杜撰沒有收到的完整 flags。

本機測試主要覆蓋：不可變 namespace／入件物流保留；服務時間／身份；無 outbox／notification；技術文件 redaction 下仍可看物流投影；精確 replay、內容變動 conflict、失效權限／employee 與併發第二請求；原件／替換品證明及 read-only stock；DTO 偽造時間／超長值；既有 custody 及原 IN 投影。不取代資料庫真實併發、外部消費端與實物交接驗收。Knowledge 仍未完成集中收斂，所以本批不得宣稱 guide 已同步或已具備發布條件。

## Claw mailroom-workbench 審閱建議

已實讀 backend/src/modules/ai/knowledge/catalog.source.json 的 mailroom-workbench 現行 entry。路由 /operations/mailroom、permissions=[mailroom:read]、related guides、其他原有來源與既有收發／客服補建界線維持。建議由 DOA 在集中整合時採納下列已逐條對照實作的 ZH／EN 內容，再更新 source hashes 及執行 coverage／drift check；本文件不套用 catalog 修改，不新開 AI write tool、不新增 permission。

建議 summary：

- ZH：分類登記信件、同仁包裹與售後實物，拍照核對、指定具體接收人並追蹤本人簽收；完成收發室點收後保存實際寄回物流。
- EN: Register letters, staff parcels and after-sales items by category; verify physical evidence, assign a specific recipient and track personal acceptance. Record actual outbound logistics after mailroom return acceptance.

下列為同一份經實讀的雙語 steps 建議；調整既有重疊段落，保留售後待到貨、平板本人驗證、退貨分級、客服補建／綁回等未變更步驟。

| Step | 中文建議 | English proposal |
| --- | --- | --- |
| S1 | 收發室預設顯示「收件與交接工作」；依待核對、待同仁簽領、待技師簽收、待收發室點收、待寄回、已交物流或品項不符篩選。尚未收到的售後件在「售後待到貨案件」另行查看。 | Mailroom opens on Receiving and handoff work. Filter items awaiting verification, staff pickup, technician acceptance, mailroom return acceptance, outbound dispatch, handed to carrier, or mismatched items. View unreceived after-sales items in the separate Awaiting after-sales arrival tab. |
| S2 | 信件／同仁包裹選「登記信件／包裹」，填寄件人、內容、入件物流及位置；先依部門篩選，再以姓名或員編選具體收件同仁。一般信件／包裹不填 SKU／SN。售後件由「登記售後收件」選來源案件，逐件登記本次實收數量。 | Choose Register letter/parcel for correspondence, entering sender, contents, incoming logistics and location. Filter by department, then select a specific person by name or employee number. Letters and staff parcels do not use SKU/serial-number fields. For after-sales items, choose Register after-sales receipt, select the source case and register only pieces received this time. |
| S3 | 登記售後收件後，在詳情拍照並比對來源品項與實收名稱／SKU／SN；產品核對與退貨檢查至少保留一張實物照片。相符維修件指定有資格的技師，不符保留原因與照片交承辦客服；退貨另記包裝、外觀、配件與分級。 | After registering an after-sales receipt, open its detail, retain physical photos and compare the source item with the actual name, SKU and serial number. Product verification and return inspection require at least one physical photo in the workbench. Assign matching repairs to an eligible technician; retain mismatch reasons and photos for responsible customer service. Returns separately record packaging, appearance, accessories and grade. |
| S4 | 查看「下一步／接收人」；部門只是篩選，接收人必須是具體同仁。指派或技師認領後仍須本人核對身份及實物簽收；在完成前原保管人繼續持有。通知送達與通知已讀另行追蹤。 | Use Next step/recipient for guidance. A department is a filter; the recipient must be a specific person. Assignment or technician claim still requires personal identity and physical acceptance. Custody stays with the current holder until acceptance. Notification delivery and reading remain separate records. |
| S5 | 技師交回處理品或未修原件後，由指定收發同仁逐件核對並本人 accept_return；WAITING_RETURN_ACCEPTANCE 期間仍由技師保管。只有成為 READY_FOR_DISPATCH 且本人保管的維修件，才登記寄回顧客的物流、單號並勾選已核對且實際交運。換機須核對實際替換品與 SN。 | When a technician returns a processed item or an unrepaired original, the assigned mailroom person checks each piece and personally performs accept_return. The technician retains custody during WAITING_RETURN_ACCEPTANCE. Only a REPAIR item in READY_FOR_DISPATCH with the clerk's current custody can record its outbound carrier/tracking and confirmation of actual handover. For replacements, verify the actual replacement product and serial number. |
| S6 | 寄出後查看獨立的「寄出紀錄（實際交運）」及承運商保管；入件單號保留在原收件單。若送出結果未知，先核對本次 requestId、版本、操作者與物流回執；未確認前以首次相同內容與 requestId 重試，不重登寄出。 | After dispatch, inspect the separate actual-handover shipment record and carrier custody; incoming tracking stays on the original receipt. If the result is unknown, reconcile this request's ID, versions, actor and logistics receipt first. If still unconfirmed, retry only the original identical body and requestId; do not register a second shipment. |

配對 boundaries 建議如下；保留現有權限、補建資格、來源事件輪詢與財務／技術文件限制。

| Boundary | 中文建議 | English proposal |
| --- | --- | --- |
| B1 | 下一步提示、候選人名單與部門篩選不授予新權限；每次寫入仍核對公司、現行權限、資格、指派、版本與實物保管。產品核對新增照片守門位於前端，退貨分級維持原有後端照片驗證；不宣稱新增所有 API 的照片強制規則。 | Guidance, candidate lists and department filters grant no new authority. Each write still checks company, current access, eligibility, assignment, version and physical custody. The added product-photo gate is in the frontend; return grading keeps its existing backend photo validation. Do not describe this as a new mandatory-photo rule for every API. |
| B2 | 指派／認領、通知、本人簽收、處理完成、物流交運、顧客收件與結案是不同狀態。WAITING_RETURN_ACCEPTANCE 尚待收發室本人點收；PENDING_WELFARE_STOCK 已完成收發室點收，依庫存流程處理。RETURN_UNREPAIRED 是未修原件返還，不是完成維修。 | Assignment/claim, notification, personal acceptance, completed work, carrier handover, customer receipt and case closure are distinct states. WAITING_RETURN_ACCEPTANCE still awaits the clerk's physical acceptance; PENDING_WELFARE_STOCK already has mailroom acceptance and proceeds through stock workflow. RETURN_UNREPAIRED returns an unrepaired original; it does not mean completed repair. |
| B3 | 原廠／原廠物流與寄回顧客物流分開。dispatch 僅允許收發室本人保管的 REPAIR／READY_FOR_DISPATCH；不因顯示舊 custodian 或一般收發讀取權限而允許交運。 | Factory/factory-carrier custody is separate from customer-return logistics. Dispatch is limited to a REPAIR item in READY_FOR_DISPATCH with the clerk's own current mailroom custody. Historical custodian fields or basic read access do not authorize handover. |
| B4 | 寄出回執以獨立不可變命名空間保留交運物流、身份、時間、版本與實物快照；不改入件物流、原申報、原件 SN、技術文件或其他 workflow 分支。已交物流物件不能再移位或重寄，修正需要另行授權設計，不覆寫本次回執。 | The immutable outbound namespace retains logistics, identity, time, versions and a physical snapshot without changing incoming logistics, original claims, original serial numbers, technical documents or other workflow branches. Dispatched pieces cannot be moved or dispatched again. Corrections require a separately authorized design rather than overwriting this receipt. |
| B5 | 換機寄出只讀已正式 POSTED 的 reservation／OUT 證明並核對替換品；不二次出庫、不猜 SN、不更改庫存、退款或付款。原退貨 IN 仍保留歷史，目前保管沿已核對的關聯換機物流投影。 | Replacement dispatch reads the existing POSTED reservation/OUT proof and verifies the replacement. It neither posts outbound stock again, guesses serial numbers nor changes inventory, refunds or payments. Original return IN history is retained; current custody follows the verified linked replacement logistics projection. |
| B6 | 售後／AI 寄出同步目前為 PENDING_COMPATIBILITY／DISPATCH_CONSUMER_NOT_CONFIGURED。既有進度事件同步不包含 dispatch；沒有同步紀錄不是成功，全數已送達的舊事件也不是本次寄出回執。不得自動發顧客訊息、聲稱顧客已收到或自動結案。 | After-sales/AI dispatch sync is currently PENDING_COMPATIBILITY / DISPATCH_CONSUMER_NOT_CONFIGURED. Existing progress deliveries exclude dispatch. No delivery records are not success, and delivered earlier events do not acknowledge this shipment. Do not automatically message customers, claim customer receipt or close the case. |
| B7 | 結果未知時只有精確符合本次 requestId、版本、身份、公司／物件與物流的回執可證明成功；只看到 DISPATCHED 不夠。保留首次內容與 key，禁止另建主單、重收或重寄同一件。 | Unknown results require a receipt matching this request ID, versions, actor, company/item and logistics. DISPATCHED alone is insufficient. Retain the original body/key; do not recreate the source case, receive the item again or register another shipment. |
| B8 | 本批無新 schema／migration、新增 controller endpoint 或 AI write tool；既有 action API 新增 dispatch，並擴充唯讀出件投影。雙語 guide／source hash 由 DOA 集中更新後須通過 knowledge coverage／drift check；本機測試不代表 SourceAI、DEV、正式通知或實物驗收已通過。 | This batch adds no schema/migration, controller endpoint or AI write tool; the existing action API gains dispatch and read projections gain outbound logistics. DOA must centrally update both guide languages/source hashes and pass knowledge coverage/drift checks. Local tests do not establish SourceAI integration, DEV deployment, real notification or physical acceptance. |

現行 entry 已覆蓋本批其他 production source，缺少下列 6 個。機器可讀的追加建議（僅交接，不是已套用的 patch；原 sourcePaths 全部保留）：

~~~json
{
  "guideId": "mailroom-workbench",
  "target": "backend/src/modules/ai/knowledge/catalog.source.json",
  "mode": "DOA_REVIEW_REQUIRED",
  "appendSourcePaths": [
    "backend/src/modules/mailroom/mailroom-dispatch.contract.ts",
    "frontend/src/pages/mailroom/MailroomNextStep.tsx",
    "frontend/src/pages/mailroom/RecipientPicker.tsx",
    "frontend/src/pages/mailroom/mailroom-workflow.ts",
    "frontend/src/pages/mailroom/mailroom.css",
    "frontend/src/pages/mailroom/recipient-options.ts"
  ],
  "preserveGuidePath": "/operations/mailroom",
  "preservePermissions": ["mailroom:read"],
  "requiresBilingualReview": true,
  "requiresRegeneratedSourceHashes": true,
  "requiresKnowledgeCoverageAndDriftCheck": true,
  "addsAiWriteTool": false
}
~~~

## 本批全部 production source SHA-256

以下 14 檔為 root 通知最後產品來源固定（含手機 Drawer 修正）後，在此 development tree 讀取原始 bytes 計算。排除測試、文件、generated files、build cache 及本文件自身；這些雜湊只辨識本批來源內容，不代表 knowledge catalog 已更新、部署或正式核准。

| Production source | SHA-256 |
| --- | --- |
| backend/src/modules/mailroom/mailroom-dispatch.contract.ts | c3af2a7db3f3951bbc440e3ba2819aed7f5699523d503814fa610c2fe0c41f61 |
| backend/src/modules/mailroom/mailroom.contract.ts | 21b564188d58cc8169afb889a676f29601127fd671a8c85cd8995f318fb83d44 |
| backend/src/modules/mailroom/mailroom.dto.ts | dcb41d56500cd3a953337ab4872e01193e584069e57fbc40d54abfb81c3f1bb1 |
| backend/src/modules/mailroom/mailroom.service.ts | ae0091115500d8bc3f752dec876f24486adffd10890fa86f89e1e17c2282c613 |
| backend/src/modules/mailroom/repair-stock-custody.contract.ts | c290d0b5a1072d4e9035d50ea38bed8698fd9e8d86e50cd7ff4ab86212141e8d |
| backend/src/modules/mailroom/repair-workflow.contract.ts | 119e5adfbe6788ccd1979a869ba98624ab5c328fd411171a6f3bea0b2620e127 |
| frontend/src/pages/mailroom/MailroomNextStep.tsx | 081f151d3dfbd94333d42a955e9af23caf052b155dfcf09557514d8d55c28855 |
| frontend/src/pages/mailroom/MailroomPage.tsx | ef9dde53ac253e4f6f88288a4249a71f211a2157b89bcce6c5a9be6e08725ce0 |
| frontend/src/pages/mailroom/RecipientPicker.tsx | 2f1238cc2f55d154404089abcd334c0c2f6605d6eb4ebe90bf0f1c5df13037fe |
| frontend/src/pages/mailroom/item-custody.ts | c6ea6bda03054a83ab92145b27367cab6c4f205843e8287a794f620329d64b79 |
| frontend/src/pages/mailroom/mailroom-workflow.ts | 3ff609fcc30ac56101f02245798b07ea049326e2dae177a92763e0f58b5c22b5 |
| frontend/src/pages/mailroom/mailroom.css | ca160ce54aa3a8fd4c24af69b84e89dd2104d8cfa640ca6dae539dade9a89e5e |
| frontend/src/pages/mailroom/model.ts | f07a46011a81b97ee379b8b3c670942a596f35416c8983eb68b1f95741937106 |
| frontend/src/pages/mailroom/recipient-options.ts | 610356112f9dff8288340d4172233c379bb797fcdcc505073a2868f290cf2fd5 |

## 集中整合時的待辦

1. DOA 對照最後整合來源，審閱並更新 mailroom-workbench 的 ZH／EN summary、steps、boundaries，追加上述 6 個 sourcePaths；不要只刷新 hash 掩蓋語意差異。
2. 釐清本輪 known-8 既有來源 hash drift 與其他工作流 ownership，集中生成 knowledge 後重跑 coverage／drift 及 spec，保留新的實際結果。本文的 FAIL 不因 local build PASS 被改成通過。
3. 保留本批 dispatch 待相容狀態及既有同步事件與寄出回執的界線；SourceAI dispatch 消費、通知、顧客收件與結案另案對齊契約、授權及實際驗收，不自動開通。
4. 後續取得 commit、DEV candidate／traffic 與驗收證據時，另記外部發布回執及回滾依據；不要將本文所列 base SHA 當成含本批修改的發布版本。
