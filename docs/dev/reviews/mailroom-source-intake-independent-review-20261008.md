# Source 收發入件查詢與申報照片獨立審查 — 2026-10-08

結果：**PASS_SCOPE**。本次獨立審查先發現兩項可具體觸發的 P2 資料一致性問題，原 Source owner 修正後，我對凍結的新檔案再次核對並親跑回歸；本審查範圍沒有未解決的 P1／P2。此結果是程式、合成測試與靜態跨端契約的結論，不是正式／DEV、實際 PostgreSQL 或 GCS 的驗收。

## 版本與範圍

- Source 工作樹：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-mailroom-intake-20261008`。
- 分支：`codex/mailroom-intake-20261008`；基底 `20f583b6284e93e5516a533733b3833120aaae0d`。親跑測試時本批 staged bytes 位於此基底上；root 隨後凍結成 `13be4eac56616902b1b272440d1f37e823d1894f`，審查者再核 HEAD／tracked clean 與下列主要檔案 hash 相同。原測試適用於相同 bytes，沒有因僅 commit 再重複計數；push／remote 接收證據由 root 負責。
- 新增 GET：`/api/integration/mailroom/summary`、`/api/integration/mailroom/cases/:id/attachments`、`/api/integration/mailroom/cases/:id/attachments/:attachmentId/media`；既有 cases 查詢新增字面搜尋、游標、待到貨摘要與物流唯讀欄位。
- 核對搜尋排序、公司／client scope、摘要與列一致性、私人附件路徑與實際讀取上限、sharp lock 差異，以及原 receive／staff 寫入程式的變更邊界。跨端另靜態閱讀 ERP `mailroom-source-media.service.ts`、`mailroom-sync.service.ts`。
- 審查者只寫本報告及 `/tmp` 證據 JSON；沒有修改產品程式、安裝／生成依賴、commit、部署、讀取金鑰或進行真實網路／資料操作。使用 Source 已有 node_modules symlink 與既有 sharp。

## 先發現、後修正的兩項 P2

### P2-1：舊維修明細可能讓搜尋結果與目前申報產品矛盾 — 已解決

初稿 SQL 無條件把 `RepairCaseDetail`／`Product` 加入搜尋 OR，但 `sourceItems()` 在存在 `CaseItem` 時只回傳目前 CaseItem。當案件目前申報 A、舊明細仍是 T 時，輸入 T 會找到案件，結果卻只顯示 A；這可使收發室選到不相符的案件。

最終 `services/mailroom/service.ts:222` 增加 `NOT EXISTS (SELECT 1 FROM "CaseItem" declared WHERE declared."caseId"=c.id)`，只讓沒有 CaseItem 的舊案件使用維修明細 fallback。原 CaseItem 查詢、客戶／單號／物流查詢及 scope 不變。

親跑 `tests/mailroom-intake-read.test.ts:589` 回歸：目前 A＋舊 T 不得出現在 T 搜尋結果，無 CaseItem 的舊 T 仍可查到，真正目前申報 T 仍可查到；同時斷言 SQL gate 與綁定值。這是 SQL 契約／Prisma adapter fixture，不是實際 PostgreSQL 執行。

### P2-2：在途狀態可能被最新 100 筆物流 metadata 截斷 — 已解決

初稿列資料從最新 100 筆 reverseShipments 的 `.some(IN_TRANSIT)` 決定 `inTransit`，摘要則看完整關聯。若唯一 IN_TRANSIT 是第 101 筆舊紀錄，摘要為 1，但案件列為 false。

最終 shared include 的 `services/mailroom/service.ts:16` 與 summary 的 `:323` 都讀取全案件、只篩 `status=IN_TRANSIT` 的 relation `_count`；`:140` 的列判定與摘要都以剩餘實收數量大於 0 且 filtered count 大於 0 決定。物流顯示 metadata 仍只回傳最新 100 筆，不以截斷資料推導 whole-case 狀態。

親跑 `tests/mailroom-intake-read.test.ts:674` 回歸：101 筆合成物流、只有最舊一筆在途；確認 metadata 100 筆中沒有 IN_TRANSIT，但列為 true 且摘要在途數為 1；filtered count=0 或實物全收到時均為 false。這是關聯查詢形狀與合成資料的驗證，未假定 DEV／正式實際存在此資料分布。

## 最終程式核對

### 搜尋、游標與摘要

- 使用 `Prisma.sql`／`Prisma.join` 參數化；文字包含查詢用 `POSITION(lower(parameter) in lower(field))`，`%`、`_`、反斜線是字面值，沒有拼接任意 SQL。搜尋長度上限 100，id／cursor 上限 128。
- 查詢限 client sourceChannels、非刪除、REPAIR／EXCHANGE_RETURN／REFUND_PICKUP，搜尋列排除 CANCELLED／CLOSED／COMPLETED；raw id 再 hydration 時重複相同 scope。projection 另限 `client.entityId` 與所查 caseIds。
- 案件／參考單號精確命中優先；之後 updatedAt DESC、id DESC。搜尋游標延用相同 rank 與時間／id 邊界；非搜尋按時間／id。電話搜尋只接受電話字元，886 正規化為 0；非電話關鍵字不會變成空電話廣泛匹配。
- 待到貨最多掃 150、回 30 筆，已全收到的 scan 仍保留 continuation，使較舊未到貨案件可被繼續查找。remaining 逐申報品項計數，不把多收別的品項抵銷欠收。
- 摘要與分頁無關，讀完整 scoped open set；超過 5,000 件回 `complete:false, counts:null`，不回假的完整總數。實際原 schema 沒有 shippedAt，物流契約明確回 null。

### 公司與照片範圍

- 原 `auth.ts` 未變：server-configured keyId／entity／sourceChannels、exact method＋path/query＋body hash＋entity HMAC、時間窗與 timingSafeEqual。公司 header 不可覆寫 client 公司；不允許 wildcard channel，拒絕不同 entity 的 sourceChannel overlap。
- 照片 metadata 與 media 都在查 GCS 前確認 case scope、open status、caseId／attachmentId 關聯。metadata 不回 `fileUrl`、bucket、objectPath 或直接公開圖片連結；標註 `scope:CASE`，不假造照片屬於某個申報產品。
- 僅 configured bucket 的 `gcs://<bucket>/case-attachments/<caseId>/<safe filename>` 可讀，拒絕其他 case／bucket、外部 URL、斜線與編碼／雙點路徑。ID、檔名及圖片副檔名均有 allowlist。
- metadata 最多選 13 判斷 hasMore、回前 12 張符合規則的照片；不是完整附件盤點。success response private/no-store、nosniff；error private/no-store 且沒有 cloud path 洩漏。新 endpoint 只有 GET。

### GCS 讀取與轉圖的實際限制

- DB size 與 GCS metadata 都須為正整數且不超過 30 MiB，兩者 size／contentType 一致。實际 AsyncIterable stream 計數同樣限制 30 MiB；超限即拋出並停止讀取，讀完還核 length==metadata size。未沿用既有 unrestricted download helper。
- JPEG／PNG／WebP allowlist＋magic，再用實際 sharp decode；20,000,000 input pixels、非動畫，旋轉後縮到 600×600 以內、不放大，輸出 WebP quality 75。輸出 magic 再核、最多 1 MiB，未保留來源 EXIF／ICC。
- 合成測試使用真 sharp 0.34.5，含大於 1 MiB 的 noise JPEG 降至預覽上限，JPEG／PNG／WebP metadata 移除，stream overflow 提前結束、metadata／DB／stream mismatch、跨公司／case／path 拒絕。GCS object、metadata 與 stream 是注入 fixture；沒有連到真 bucket，也沒有驗證 IAM／現有檔案可讀性。

### 原寫入流程與依賴

- 對最終 service bytes 做 TypeScript AST 原文比較：`scope`、`sourceItems`、`receive` 與 20f 完全相同；`toSource`、`cases` 有唯讀改動，新增 `normalizedPhone`、`summary`。維修同意／quote revision／確認付款 gating 的既有 predicate 保持。
- 從 20f 列出的 61 個既有 `services`、`app/api`、`lib/case-attachment-storage.ts` TS 檔案中，只有 `services/mailroom/service.ts` 的既有檔案內容改變。AST 查得的 3 個 function-declared POST／PUT／PATCH／DELETE route、原 staff services、原 upload helper 均未改。3 個 route 是此 AST 類型的子集，不是所有 server actions／業務寫入的總數。
- shared include 新增唯讀投影，不能只憑 receive 原文未改就宣稱所有實際 receive 行為已完整重驗；本次另親跑 workflow-binding 11 項合成測試覆蓋原事件、同意、付款與數量行為。
- sharp 從原 lock 中已有的 0.34.5 改成 package.json 直接依賴 `0.34.5`。JSON lock 比較沒有新增／刪除 package node，也沒有 version／resolved／integrity 漂移；只新增 root dependency 並移除 `@img/colour`、sharp、sharp 內 semver 的 optional，以及 detect-libc 的 devOptional 標記。平台 binary node 其餘不變。審查者沒有 install／npm ci／postinstall。

## ERP 靜態契約複核

- `mailroom-source-media.service.ts` mirror 現有 full Source read qualification：mailroom read 全域；客服需 read／update 加 strict company／module／employee gate；維修 read 可只查 REPAIR。case type 在讀附件前確認；外部 await 後重讀 actor／公司／permission，摘要只限 ALL。
- DOA 的 native assigned intakeQueueReader 不等於 full Source-wide summary／photos 權限。此報告不建議用它替換 qualification；若後續引入有公司／本人／module 驗證的 full Source 客服唯讀 helper，三端 cumulative review 需明確接入該 helper。
- sync 要求 configured HTTPS origin、禁止 credentials/query/hash/path，簽 exact encoded path；redirect:error／timeout。摘要完整性與非負安全整數先驗證；照片只接受 CASE metadata、12 筆／30 MiB 原始 size，media response 實際 stream 上限 1 MiB，magic 再核並移除未知 URL 欄位。
- 這裡是目前 ERP 檔案的靜態複核，沒有把其他 agent 的 ERP 測試數算成本審查親跑，也沒有把 native RepairPhoto 冒充 Source CaseAttachment。

## 審查者親跑結果

工作目錄為 Source tree，全部使用既有依賴，不安裝／生成，不作真實 HTTP／GCS／資料庫寫入。

```sh
node --import tsx --test tests/mailroom-intake-read.test.ts tests/mailroom-contract.test.ts tests/mailroom-source-queue.test.ts tests/mailroom-consent.test.ts tests/aftersales-workflow-binding.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
node node_modules/eslint/bin/eslint.js services/mailroom/service.ts services/mailroom/attachments.ts tests/mailroom-intake-read.test.ts tests/mailroom-source-queue.test.ts 'app/api/integration/mailroom/cases/[id]/attachments/route.ts' 'app/api/integration/mailroom/cases/[id]/attachments/[attachmentId]/media/route.ts' app/api/integration/mailroom/summary/route.ts --max-warnings=0
git diff --check
git diff --cached --check
```

- 最終 35／35 PASS，0 fail／skip（1,049.905584 ms）：原 22＋兩項新回歸＋11 workflow-binding；不是把之前跑過的 22 再重複加總。
- 完整 Source TypeScript noEmit：exit 0；上述 scoped ESLint：exit 0。
- unstaged／staged diff whitespace：均 exit 0。
- 最新 AST／lock proof 另存 `/tmp/mailroom-source-independent-write-proof-20261008.json`（SHA256 `b09765ac4a3cdc9fab946c322125616c2fcf8d03871cb7e57c634c7905e395ed`）、`/tmp/mailroom-source-independent-lock-proof-20261008.json`（`b430a832d597d55fc45df80279cc7ab6e108021ad4cf1b94bbbcbd10b4702699`）。重要結論已寫入本文件，無須依賴暫存檔保存。

## 最終 SHA256 邊界

| 檔案（Source tree 相對路徑） | SHA256 |
| --- | --- |
| services/mailroom/service.ts | `4ef6bf14836c9b867904a20350b42ad5b39aac0a58fb76bc2406298ab0f3b414` |
| tests/mailroom-intake-read.test.ts | `c249bd99946c492d1806fef06257bd2a1b905f52bd1d828a5174a99eb42848df` |
| services/mailroom/attachments.ts | `72ca17659ce94a236f8a50954a0368d2818cb0f9e36d1d4ddc3aa6cdf4273bc7` |
| services/mailroom/auth.ts | `7f6d606fd97f7ba2e898f79f970be95303883ea22b24aa76dabbd0af050afffc` |
| tests/mailroom-source-queue.test.ts | `a5fa1c6ef96dc6b675f7c17ec66203896c6228bcb50615a885a20b746d765a32` |
| tests/mailroom-contract.test.ts | `cad40c568c0c6c0c98e3cf317bdf997a5986f436886d738bb86dc1ae41c81b82` |
| tests/mailroom-consent.test.ts | `f0ad5b4db626742271a736fde8a4476c667f22d5dccc52fc72c2f6f73a456b7b` |
| tests/aftersales-workflow-binding.test.ts | `341ca9eb8f2c70a8b7a2e55953d7b0e7cf575f0b4ceaa18e6d3f26fccf3302b9` |
| package.json | `0bee961a48a3cb1a218b756863b8bef2e073190106c35f22925730259ca5d279` |
| package-lock.json | `cd8b2b739d77bd3038ac9cba7858e15c19f6d1fc4365b89a948db5975b5a0ea4` |
| app/api/integration/mailroom/cases/[id]/attachments/route.ts | `d608f6a7c9def7cd7865a8498a46a230928f45840e9167d5a5fe57f2e1db2f27` |
| app/api/integration/mailroom/cases/[id]/attachments/[attachmentId]/media/route.ts | `b2969e2a43ecb98993d4a99447bffdbccaade0d9764635dd91eb9f4a39fcab03` |
| app/api/integration/mailroom/summary/route.ts | `8bd6a69cc3923a43e8ff8c90e041f0fe677cb01256d1c065215145b1cf95462e` |
| docs/mailroom-intake-read-20261008.md | `fb91d9ab00da5e96522602749377555a86e1cb555b4b084eb41482e8f8693ede` |

ERP tree 靜態核對快照：`backend/src/modules/mailroom/mailroom-source-media.service.ts` SHA256 `cb240cfd06f89b9bbf8f16771db66ca56342d4cd55348df32e91400791fde058`；`backend/src/modules/mailroom/mailroom-sync.service.ts` SHA256 `9c2a077e932abf8baad97e8412fe5103437313996ebc4d33a3efcc85d5effe1a`。後續三端整合與 release 應使用新 commit／cumulative bytes 再界定範圍；本報告沒有宣稱 migration physical FK、live SQL／IAM、人工簽收、通知、退款、庫存或 DEV 已驗收。
