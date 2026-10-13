# 維修第二批交付：實際檢測、備料、存證與顧客報告

Base `50ee4618f89e8fb3c5612d838b4c873313b5431d`（原整合 d3）。本批為本地 supplier，指定最終 SHA 與執行原始檔在協調區固定回執。中央 DOA 持唯一整合／DEV 發布鎖，本台不 push／部署／修改中央主 schema、package、App、JWT 或 shared mailroom 接點。原件、共同案件、財務與處置紀錄沿原契約保留。

## 使用者操作

工作台仍只有「我的待辦」、「待認領與簽收」、「案件查詢」。紅數只算本人實際可處理工作；客服與付款等待留在案件。列表只呈現照片／產品／姓名／電話／案號／狀態。檢修、備料、錄影、對客摘要與檢測標準在案件內操作，不另加上方入口或常駐教學文字；管理標準依 `repair_workbench:manage` 能力顯示，不指定單一主管角色。

新提交工作單使用 protocol 2，保固／人為損壞未知保持未選，materialPlan 明確 UNASSESSED／NONE／REQUIRED，實際 Product／Warehouse 由名稱選取、quantity decimal string 2 位。草稿可未完成，舊歷史仍可讀；提交要求當版已審核標準與實際量測／校正關聯。RECORD 留存真實 FAIL／NOT_TESTED，开工檢測與完工 PASS 分別驗證，不捏造閾值或成功結果。

## 中央接線清單

MailroomModule controllers 增 `RepairTestRegistryController`、`RepairMaterialsController`、`RepairEvidenceController`、`RepairPublicReportController`；providers 增 `RepairTestRegistryService`（Prisma,Mailroom）、`RepairMaterialsService`（Prisma,Mailroom,Sync）、`RepairPrerequisitesService`（Registry,Materials）、`RepairMediaStorageService`、`RepairMediaService`（Prisma,Mailroom,Storage）、`RepairCustomerReportService`（Prisma,Mailroom,Sync,Media）。Workbench constructor 第4／5參數 prerequisites／media；Todo第4參數 prerequisites。缺 reader failclosed／UNKNOWN，不能用 fake READY 解初始化。

共享 MailroomService：row lock／fresh actor 下 customer start_repair（含換機方案） 與 send_factory 必須 `prerequisites.require(row,'START',tx)`；完工 `require(row,'COMPLETION',tx)`。保留 454 的 fresh Source／當版 CSR／逐件 binding／同意／足額款／必要發票 gate。公司 RETURN 不借顧客財務；REFURBISHING 簽收不算正式開工，專用 workflow action `start_refurbishment` 保存 server-built `corely.repair.work-start.v1`；公司耗料和完工先 `requireRefurbishmentWorkStart(row)`，exact inspection/planHash/current owner=custodian=startedBy、TECHNICIAN、明確 null quote。await_customer 需容許尚未開工的公司 REFURBISHING 提交方案；改版清目前 CSR/release/workStart、不清歷史。

App 由中央 import `./pages/repair/RepairPublicReportPage`，增加 `/repair-report/:id` public route，置於員工保護／providers之外。Public API 只有 GET `/api/v1/public/repair-reports/:reportId` 與 `/media/:mediaId`，原 JWT 其他路由不變。中央 CORS 接受 `X-Repair-Report-Token` 並遮罩此header／fragment；DEV Public allowlist只允許這兩個 exact GET。連結秘密放 URL fragment，request只header傳入，不放 query/accesslog；回應 no-store，媒體 nosniff/private serverstream。

## 原生接口

`repair-workbench/test-registry`: GET scoped registry；GET `items/:id`（entityId,kind）；POST `standards`（entityId,requestId,productId,sku,data）；POST `standards/:id/revisions`／`review`／`retire`（expectedRevision）；POST `calibrations`（actual instrument/proof/time）；POST `calibrations/:id/revoke`。標準版本 immutable、review後不改原data，唯一 current reviewed SKU；校正是有權人登錄的實際證明，不當自動校正物理設備。

`repair-workbench/items/:id/materials`: GET；POST `allocate`／`receive`／`consume`／`release`。保留原 ERP inventorySnapshot/Transaction 唯一 RESERVE／OUT／RELEASE ledger；領到實物才可耗料，unused退料需本人實際簽回。所有歷史未結清 allocation 都阻止完工，新版 NONE 不抹平舊責任。costStatus UNKNOWN，不冒稱已證實成本。

`repair-workbench/items/:id/media`: POST `uploads`（entityId,requestId,expectedVersion,kind,phase,checkKey?,contentType）；POST `:mediaId/finalize`／`revoke`（server查實際metadata/bytes）；GET list／`:mediaId/file`。保存新工作單時 server attaches verified exact revision bindings，不能提交 client finalized/ready/calibration proof。檢測照片／錄影放私人 object storage，DB存版本／checksum／generation與關聯；upload command不改native案件version。

`repair-workbench/items/:id/reports`: POST `publish`（entityId,requestId,expectedVersion,kind,expiresInDays 1..30）；GET list；POST `:reportId/revoke`。客服承辦本人審核已保存三段對客摘要／selected media，public whitelist不含內部診斷、聯絡或付款資訊。inspection報告在current CSR ACCEPTED/RESOLVED＋正式逐台報價binding＋verifiedidentity即可發，不要求顧客先同意／付款；repair報告需current approved CSR、財務、實際完工/QC/release。發布／重試 stable fragment link，舊版supersede／撤回／過期／當版方案與身分失效即拒讀；取消案拒讀，已關案歷史若來源保留currentidentity與binding可read，不新增publish。沒有 LINE 通知或自動送客。

F25 `record_scrap_authorization` 是核对當版 Source DISPOSITION proof 後保存報廢同意，無實際報廢／OUT／終結狀態；return_original走原待收發本人點收，不捏造修理和複驗。

## Source 同版 wire

signed Source 必須保留 `.caseBrand` 真 MOZTECH/BONSON/WANBO；`.brand` 是顯示窗口，不能替代。report identity 為 `releaseInfo.customerIdentity {companyId,caseId,brand,verified:true,verifiedCustomerId:64hex}` 與當版 quoteBindings。ERP documents.release 只投影 signed sourceCaseId/caseBrand/currentreleaseInfo。DISPOSITION adapter可使用父identity或唯一該item proof內identity，兩者同時存在必須一致；禁止拿另一件／PRODUCT proof identity補報告。

顧客報廢／原件返還 proof 要最新 approved/unsuperseded、proofId/proofRevision/purpose/decision/quoteRevision/itemId/planVersion/planHash/proposalHash、verifiedcustomer/provider/reviewer/submittedAt/reviewedAt；缺欄位 failclosed。DEV_STUB僅 explicit QA policy + doa-dev-qa-20261002 company，正式不借。正向開工延續 phase1 invoice/binding gate。Source enum須接受 SCRAP，REPAIR_PROPOSAL lost ACK保持原proposalHash並exact回ack。

## Schema / DEV storage

中央三組 fragment＋SQL候選，勿直接執行本供方檔：`backend/prisma/fragments/repair-test-registry.prisma`／`migration-candidates/repair-test-registry.sql`；`fragments/repair-materials.prisma`／`candidates/20261013-repair-materials.sql`；`docs/dev/repair-media-report-schema.fragment.prisma`／`migration-candidates/repair-media-report.sql`。Registry/material共需10個inverse，見 `repair-phase2-inverse-additions.diff`。media fragment scalar IDs沒有Prisma關聯，SQL另加retention FK／integrity CHECK；中央應對齊migration與索引map，不把tmp schema validate當實際DDL或DB競爭驗證。

中央 package/lock exact `@google-cloud/storage@7.19.0`。本樹只使用owned ignored dependency links／tmp package，不改共享client。`REPAIR_MEDIA_ENABLED=true`、`REPAIR_MEDIA_BUCKET`、`REPAIR_MEDIA_UPLOAD_ORIGIN` exact HTTPSweborigin；`REPAIR_PUBLIC_REPORT_ENABLED=true`、`REPAIR_REPORT_PUBLIC_ORIGIN`、`REPAIR_REPORT_LINK_SECRET` >=32字符，config缺就停。HMACsecret輪替撤回舊capability。server finalize metadata MIME/10MiBimage/128MiBvideo、actualbytes SHA256/CRC32C/container magic，固定字串generation；15m為server finalization期限，provider resumable session另有自己的期限。

`repair-storage-context.ts` exports `withRepairStorage<T>(bucket,key,operation:()=>Promise<T>)`。DEV sandbox runtime owns Symbol.for('corely.dev.repair-storage.v1') 同形lazy hook。mint／verify完整SDKpromise/bytehash、private stream完整safe generator＋pipeline都在callback ALS範圍；sandbox缺hook拒絕且operation不開始。只准QA bucket `corely-repair-dev-249593319772`、prefix `repair-media/doa-dev-qa-20261002/<UUID>/<UUID>`、Google metadata/storage hosts；不新增general網路或LINE許可。

## Claw / 最後驗收

中央檢視雙語guide、catalog與source hashes：repair-workbench（3entries/currenttodos）、repair-workflow（controlledRETURN/disposition）、repair-document（v2/tests/material/media/customerreport）、來源報價及客服handoff、materials ledger、registry管理與public link。核心source paths是此批repair専用contracts/services/controllers、frontend repair page/forms/panels。沒有新增AI business mutation tool或借guide授權。

本地 fixture/DOM/build 成功僅供應碼與可審查接口；中央還須合併最後 SHA、正確providers/schema/Sourcewire、DEV migration/SDK私域串接、正常角色UI及跨端actual receipts。真錄影storage、實際校正／領料、顧客觀看／LINE／金融／物流／WMS/ECOUNT與真正封存卸載未由本地測試證實。原歷史接受票保留，不以無Git衝突代業務通過。
