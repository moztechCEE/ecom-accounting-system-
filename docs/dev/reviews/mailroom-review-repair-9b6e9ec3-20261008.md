# 收發端接收維修 9b6e9ec3 的獨立審查

結論：**PASS_SCOPE**。固定功能版本的唯讀變更可交中央整合；本次限定範圍未發現可具體重現的 P1／P2。這不是累積整合版、DEV、實物簽收或正式環境驗收。

## 固定版本與實際操作範圍

- Review tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-review-repair-9b6e9ec3-20261008`。
- 親驗 HEAD：`9b6e9ec3d4872726934cd006ea53679577573dcd`；feature base：`bb08e190768442e2549eddd78f5df161fdc9ffb3`。
- 起訖 tracked clean；基底至 HEAD 恰 11 檔，無 schema、DTO、權限配置、來源 API、通知、財務、庫存檔案的變更。
- 父任務已另核遠端 named fetch／ls-remote；本審查者未重 fetch，也未碰 shared repo 無效 ref。後續 `2c501f020bcc09366a2697cd6b7e75de9f57d413` 文件提交不屬於此次 code review。
- 只在自己的 clean review tree 新增 ignored `backend/node_modules`、`frontend/node_modules` symlink，指向 intake tree 的現成依賴。沒有安裝、升級或生成 Prisma；沒有修改產品、commit、push、部署、連接 live DB 或使用真實帳號／通知。此報告依父任務授權寫入 intake tree。
- 最後版本／狀態核對時間：2026-10-08T11:16:04Z。依賴為借用現成版本，下面 build-config type 檢查不代表該固定 tree 的實體資料庫或 migration 已驗證。

## 原寫入流程與權限 gate 未改

使用 TypeScript AST 擷取 `MailroomService` 的方法原文，獨立將 live review tree 與 base git object 比對；**18 個既有方法逐字相同**：

`enabled`、`actor`、`canRead`、`target`、`intakeQueueReader`、`intakeCustomerService`、`people`、`sourceCases`、`customerService`、`detail`、`tasks`、`itemSnapshot`、`record`、`publish`、`reserveSourceCapacity`、`create`、`command`、`caseProgress`。

只有 `list`／`views` 改動，新增 `repairPhoto`。既有 controller 的 POST receipt／action 內容亦未變。前端 AST 原文比對 `RepairDetail` 與 `loadDetail` 都同 base。這支持「原收件、來源剩餘量、本人簽收、同意／付款放行、交接、草稿、通知與庫存寫入 gate 未在此 feature 被改動」，並不是重新驗收所有舊流程。

獨立 proof：`/tmp/mailroom-repair-independent-method-proof-9b6e9ec3-20261008.json`，SHA-256 `e0e99fa91fb5f0f08b1cfe2df52b1eccd472e97ee4be3163092fd221a2f4ce8f`。

## 唯讀功能的核對結果

| 範圍 | 親驗結果 |
| --- | --- |
| 六分類數量 | `repairConditions()` 保留原 REPAIR／合格 RETURN population 及既有六分類條件，每次產生新的 nested WHERE。row query 与六個 count 都限制公司；count 不受 search/status/page 改動，不從這頁 50 筆推估、不按 sourceCaseId 去重、不加總重疊分類。service fixture 明確列出 membership，測到 67 筆／第二頁 17 筆及同來源不同實物。 |
| 授權與投影 | 先啟用檢查、fresh actor、公司 membership、`repair_workbench:read`；非 repair list 不加 queueCounts／overview。`views` opt-in 後再檢讀取權限及 native repair population。mailroom-only 讀者不能藉此取得 repair projection；inactive/password/employee/revoked/company/disabled 皆於 row read 前拒絕。 |
| 顧客資料 | `repairOverview()` 只取同公司 receipt 的 sourceSnapshot，先確認 sourceCaseId 與 REPAIR/RETURN type 相符，再 bounded string 取 customerLabel/customerPhone。缺值、錯 source id/type、陣列 snapshot 均不猜；不使用 senderLabel，不暴露整份 snapshot、財務或 CASE 附件。舊 snapshot 無電話保持 null。 |
| 當件實收照片 | 新 GET `/mailroom/items/:id/repair-photo?entityId=…` 沒有 public／service-auth decorator，走現有 production B2bAwareJwtAuthGuard／JwtStrategy。service fresh 角色／公司檢查，驗 item 與 receipt 公司、native repair population。只回 `item.evidence[0]` 的 PNG/JPEG/WebP、MIME magic、≤1 MiB binary，`private, no-store`；外鏈／SVG／無圖／假 MIME 不 fallback 至 Source 或其他物品。 |
| Native HTTP | 新 suite 實際掛 Nest controller、production guard／strategy，配合合成 AuthService／Prisma fixture；親跑無／錯 JWT 401、有效 JWT 200 exact bytes/MIME/no-store、撤權403、異公司／無图404、無 company400。不是對正式 auth／DB 的測試。全部 business write probe 零呼叫。 |
| 前端圖片生命週期 | 僅接受與 item ID 相符的固定 native 路徑，JWT api + 當前 company 讀 Blob；不直接載入來源 URL或帶 token 的 img URL。IntersectionObserver 懶載；entity/id/version/path 變更 abort，晚回應忽略，舊 object URL revoke。缺图、破图、unsafe route 留圖示，不生成假產品照。 |
| 前端資料／件數 | entity/queue/page/search snapshot 與 generation 隔離舊資料。401/403 清 rows、聯絡、照片、counts；首次讀取失敗不顯示假空清單。unknown counts 不猜，0 不顯示 badge。搜尋／分頁不覆蓋 server 全分類數量。 |
| 畫面與詳情 | 1537／1104／390 三尺寸實際 DOM，產品、案件號、姓名、電話、狀態與照片可讀，native 開案仍以 item ID。列表不顯示 SKU/SN/保管/文件版本；詳情保留實際 SKU/SN 與原文件。檢查了本輪生成的 desktop/mobile PNG，沒有頁面横向溢出或狀態／開案按鈕重疊。sidebar、auth、API 為合成 adapter，不是完整正式 Layout 驗收。 |

## 與收發新收件／儲位／產品的相容性

本次交叉讀的是尚未提交的 intake tree 快照，與 fixed 9b6 是分開的來源；沒有假裝它們已 merge。

- 新收件保存的是實收 `item.evidence`，來源 CASE 附件有獨立 `MailroomSourceMediaController`。其 `/mailroom/source-cases/:id/attachments`、`/…/:attachmentId/media` 与本次 `/mailroom/items/:id/repair-photo` 不衝突；維修縮圖仍只代表該實物，沒有把來源 CASE 級照片當成逐件实收证据。
- 收發的 typed addon 为 `customerPhone?: string | null`（backend SourceCase 与 frontend Source），sync optional 欄位允許缺值/null，若存在必須 string 且 ≤100。新 receipt 把核對來源的完整 snapshot 保存，符合 `repairOverview` 的 exact source id/type 契約。舊 snapshot 不會因此自行補電話；本批没有逐列 fetch Source 或 backfill。新增 read 欄位不保證來源 updatedAt/feed會改，不能聲稱所有舊案件電話已串通。
- `storageLocationId`、`productId`、`barcode` 是 item 的 additive nullable link；維修唯讀 overview 沒有拿它們當 custody/庫存/已核對證據，也沒有写入它們。列表拿實收 productName 開案，SN仍留詳情。新收件的實收SN由人員输入，本次讀取沒有新增、推導或覆寫序號。
- 親跑三格式的合成 contract bridge：新 `validateReceiptPayload()` 接受 PNG/JPEG/WebP 後，fixed 9b6 `repairPhoto()` 回同 bytes/MIME；加 storage/product/barcode 欄位仍得到正確 native item 路徑，移除 snapshot 電話則 null，实际 SN 不變。這是契約單元相容，未跑 merged MailroomService 或 schema／API／DB。

Bridge proof：`/tmp/mailroom-repair-independent-compat-9b6e9ec3-20261008.json`，SHA-256 `5616a36cbd01e962d28ff0c5af9a06415521d2a25f47361eeaf238e909abbab0`。

交叉讀取快照 SHA-256：

| intake 檔案 | SHA-256 |
| --- | --- |
| `mailroom-receipt.contract.ts` | `cb826f36f78007746910abfe481b1143d2e8cc8706debe89600990f5e3bb8e87` |
| `mailroom.contract.ts` | `827a85cbfab46ff4361166d7c023cc4b16abc36d4c13bc7507b8e8667fc5d1a2` |
| `mailroom-sync.service.ts` | `9c2a077e932abf8baad97e8412fe5103437313996ebc4d33a3efcc85d5effe1a` |
| `MailroomSourceMediaController` | `f558976f9ec0ced39f6fc0b14e320ff286ed623aca8b0d9b40dab4fa585e9b30` |
| frontend `mailroom/model.ts` | `15e9bf112dce154ffb68931cf56c6572155f31941cbd465fe1517b07d29c273c` |
| intake `schema.prisma`（只作來源識別，未驗 DB） | `ecc12137ad0c866d21cb1513fba5932713ce045ed3a378bedf1f179284229fa2` |

## 本審查者實跑，非供方測試數累加

| 命令與限定範圍 | 結果 |
| --- | --- |
| backend `node node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath src/modules/mailroom/mailroom-repair-list.service.spec.ts` | **37/37 PASS**；1 suite，2.085 秒 |
| frontend `node --test tests/repair-case-list-dom.test.mjs` | **10/10 TAP PASS**＝1 parent + 9 subcases，18.29 秒；零 fixture POST、external／network write、pageerror |
| frontend `node --test tests/repair-ui-layout-dom.test.mjs` | **1/1 PASS**，9.35 秒；因本次 diff 修改此套件断言而补跑，三尺寸、詳情與取消三種 dirty exits／保留草稿 |
| frontend app 與 node `tsc --project … --noEmit --incremental false` | 兩者 exit 0 |
| backend `tsc --project tsconfig.build.json --noEmit --incremental false --pretty false` | exit 0；build-config type 範圍 |
| frontend 三份改動 production TS/TSX scoped ESLint | exit 0、0 errors／0 warnings |
| 基底到 fixed HEAD `git diff --check`、最終 tracked clean | PASS |
| AST identity、三格式 contract bridge | 各 exit 0，範圍如上 |

沒有重跑未變的 capacity／source／intake／write 全套；不能把供方既有 170 個 backend 案例列為本審查者實跑。沒有跑 full backend strict：供方交接的 immutable baseline/full strict 124 diagnostics 是既有 FAIL 記錄，本次 build-config noEmit **不是 full strict PASS**。browser data 過期 warnings仍存在，沒有升級依賴。

## 中央整合與驗收邊界

中央 DOA 完成三端合併後，仍須以最後 cumulative SHA 檢查 shared service、module/controller 路由、typed Source addon、receipt/storage/product schema 及 migration，再核 knowledge guide/source hashes。此次並未跑 knowledge 生成/check，不覆蓋供方記錄的 drift FAIL。

本地 fixture、固定讀 API與 AST 原文相同，均不等於 DEV UI／資料庫、真实 JWT 用户角色、Source 實際回應、现场平板簽收、物流、通知、付款、退款或庫存接受。沒有代簽中央發布，也沒有把 `PASS_SCOPE` 轉成正式／DEV 接受。

## Fixed 9b6 檔案 SHA-256

| 檔案 | SHA-256 |
| --- | --- |
| backend `mailroom.controller.ts` | `6339c3a35d92a50690bb9319c4fe53cd618e41b5c60b16322184d1ad976a15db` |
| backend `mailroom.service.ts` | `8a1335752a9666dfdc5c01ad936f2c5dd34fe89e3fb0ec4acf5f227cd3cfab31` |
| backend `repair-list.contract.ts` | `352664b79bc5e97f05372032c43ddf00aadc37b93a001daf9ae33e44ea667304` |
| backend `mailroom-repair-list.service.spec.ts` | `96f7360013dcda8cc4cc84890803815319c62e709c6f9adade71788135ea216b` |
| frontend `RepairCaseList.tsx` | `f0fd5ecc33d315697ac939a809819573993e4a5913cdde8be15d3f5b1ad722e4` |
| frontend `RepairWorkbenchPage.tsx` | `9f3522420d971ac5bd869b81c37d94f62647b2c3a40a14516e9d660da60e6b6d` |
| frontend `repair-list-model.ts` | `6a66bba465ede0daaaa74a9f47bdf3a13fb23ed2c80386f8203da9daa0368c08` |
| frontend `repair.css` | `3f50304c11c4aceb0290f3a71b598c58e60893937a48e569bfff5774dfa04ff8` |
| `repair-case-list-dom.test.mjs` | `953a764ba51968cee849d23e3677b070464ba9a3f5ac2917fbb38776a7a1e8a8` |
| `repair-ui-layout-dom.test.mjs` | `d772f585d3d53e3ac7513222583fcee35fb14158941bebd3ff7e21e5294ba0f3` |
| feature handoff 文件（只作來源，不當親跑證據） | `2c9817957ad9c0d488963618caa7d2c83c3be56cbe41e9424b1ee76b97d9820e` |
