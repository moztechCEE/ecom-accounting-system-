# 人員權限、費用申請與 ERP Copilot 交付紀錄

日期：2026-09-23（Asia/Taipei）。更新：已合入最新 DEV SSO、push 獨立分支、套用 DEV migration，並完成 DEV 100% 流量部署。正式環境未變更。部署版本 `637518d0e39702065633b8877ad3c9ea5c75eb3c`；20:21 Asia/Taipei 核對兩服務 Ready／100%。

使用者確認的流程：所有修正先到 DEV，驗收滿意後，才另行整合正式環境。已記入 repo `AGENTS.md`。完整映像、流量與驗收見 [發布收據](access-expense-ai-release-20260923.json)。

## 版本與協作界線

- 工作目錄：`/Users/moztecheason/ecom-access-expense-ai-20260923`
- 分支：`codex/access-expense-ai-20260923`
- 起始版本：`8897ddcbc5c6c3a1128f0ad81df6c611202ca1b8`，當時最新倉庫整合版本。
- 原始主 checkout `/Users/moztecheason/ecom-accounting-system-` 有其他工作，未修改其原始碼。
- 部署前重新核對共享 DEV，合入 `fc82e903`（SSO runtime `70702171`），保留最新雙重驗證、帳戶資料修改、倉儲人員／出貨 SSO、角色刪除保護、產品儲存修正與四個既有倉儲 migrations。B2B／庫存平行工作未混入。
- 遠端 main 為 `a3791c48`；既有 PR #1–#3 不屬於本次工作。

## 完成的行為

### 人員權限

權限管理提供依模組分組的勾選矩陣、搜尋、角色範本複製與「可見介面」預覽；人員預覽依所有角色聯集計算。管理員可分別看出功能可見性、操作能力、公司與資料範圍。

公司／八類資料範圍只允許 SUPER_ADMIN 修改。後端同時防止自訂角色改名為系統管理員、授予管理員角色、修改高權限帳號以及刪除仍有人使用的角色。角色 ID 仍以資料庫存在性驗證，兼容既有 seed ID。API 及前端都執行權限檢查，不僅隱藏選單。

### 費用申請到出納

```mermaid
flowchart LR
 A[員工上傳原始憑證] --> B[AI 辨識並填入建議]
 B --> C[員工核對後送出]
 C --> D[指派直屬主管]
 D --> E[完成項目設定的額外審批]
 E --> F[建立唯一出納待付款任務]
 F --> G[實際付款後登錄付款資訊]
```

- 員工管理新增直屬主管，同公司、啟用帳號、不得自己當主管或形成循環；未完成主管設定或主管沒有費用介面權限時會明確拒絕送出，不會偷偷授予權限。
- 支援 JPG／PNG／WebP／PDF，每檔 5 MB、最多 5 檔、合計 10 MB。辨識及直接送出都檢查格式與內容。原檔可在申請詳情與審核中心預覽／下載。
- 真實 Gemini 辨識金額、日期、供應商、憑證號碼與現有可用報銷項目。AI 結果需人工核對；外幣不直接填進 TWD 金額欄，多筆交易提示拆開申請，重複附件只提示，不自動拒絕或核准。
- 更換憑證會清除未修改的舊 AI 建議、保留人工修改、重設核對確認。模型故障仍可人工填寫；無 key 或 sandbox 封鎖時明確顯示不可用。
- 角色／部門限制由伺服器以使用者資料判斷；不能偽造部門或報銷項目 ID 繞過限制。
- 送出時記錄主管 approverUserId；主管只可核准當前指派步驟、不可自己審自己。既有報銷項目的額外審批政策繼續有效；沒有額外政策時，主管核准即進入待付款。
- 最後一步核准以 transaction 及唯一索引建立一筆 PaymentTask，付款登錄同步申請、待付款任務與歷程，防止重複核准與重複付款登錄。
- 出納付款需要實付金額、日期、同幣別且有存取權限的銀行帳戶；本版一次全額登錄。科目由有權限的財會人員確認，員工與一般主管不必選 GL 科目。
- 舊 AP 發票列表不再把 PaymentTask 假裝成另一張發票，避免重複計入與繞過費用付款流程。

本版的「付款」是付款事實登錄，不會發動銀行轉帳，也不會自動產生正式分錄或完成對帳。對沒有任何 approvalSteps 的歷史待審申請，ADMIN／SUPER_ADMIN 可在審核中心點「建立主管審批」，先預覽目前直屬主管及項目額外政策，確認後才建立步驟並記錄歷程。主管／政策或原單版本已變更時拒絕舊確認；不會自動核准、建立付款或修改已有指派的案件。

### 全站 Copilot

每個登入後頁面都有小型 Copilot 按鈕，支援桌機與手機。對話帶入目前頁面與所選公司；回覆顯示查詢時間、資料範圍與可開啟的來源。

- 24 篇版本化操作指南，涵蓋權限、費用、會計、採購、銷售、庫存、SN、儲運、人事等入口。
- 9 個即時讀取工具：銷售統計、訂單、客戶、商品、供應商、費用統計、商品成本／庫存快照、銀行匯入交易淨額、薪資批次摘要。
- 查詢從後端資料庫取值，再讓模型回答；費用依自己／部門／公司範圍取數，其他工具缺少可靠列級權限時拒絕，敏感成本、銀行、薪資工具限 SUPER_ADMIN。
- 每次工具執行重新確認啟用狀態、角色、公司與資料範圍；AI 等待期間權限被撤銷也不能繼續取數。
- 支援標準／深度模型模式、明確錯誤與逾時；AI 斷線時的內建指南清楚標示「沒有查詢即時資料」。

指南需隨功能變更維護；本版沒有動態讀取所有原始碼／外部知識庫、全模組資料工具、跨工具完整分析或讓 Copilot 修改設定／核准／付款。不能稱為「已完整了解整套 ERP 並全面以真實業務資料驗收」。費用統計依申請建立日與本位幣，銀行值是匯入交易淨額，薪資批次人數可能跨批次重複；並非完整財務報表。

## 初次本機驗證紀錄（部署驗收另見下節）

- 權限與資料範圍：backend 5 suites／29 tests；frontend access/navigation/WMS 19 tests，全通過。
- 費用工作流、主管、項目資格、憑證辨識：backend 5 suites／56 tests，全通過。
- Copilot、provider failure 與受控 AI 開關：backend 2 suites／30 tests，全通過。
- 費用管理 API 8 tests、隔離 PostgreSQL 26 checks 通過；build/UI 結果見本文件收尾驗證。
- 真實 AI（含保留 sandbox 的 opt-in 模式）：以標示 TEST 的合成憑證辨識，返回 TWD 1,200、日期、供應商與項目；沒有傳送真實業務憑證。
- 真實 Copilot：實際 Gemini 選工具與生成回答，production service + 注入合成 Prisma 資料，驗證公司／SELF 範圍、TWD 1,200／2 筆與來源；9 個檢查通過。前兩次模型第二階段 HTTP 503 的失敗證據亦保留。
- 瀏覽器使用實際前端與攔截 API 的合成資料，驗證可見介面、模組矩陣、憑證自填／人工確認／送出、原檔預覽、更換憑證、Copilot 桌機／手機、普通員工403及歷史申請補建審批。這不是已部署的端到端業務驗收。

### 可重現命令

在 backend 目錄：

```sh
npm test -- --runInBand roles.service.spec.ts users-access-management.spec.ts permissions.guard.spec.ts entity-access.service.spec.ts entity-access.guard.spec.ts
npm test -- --runInBand expense-workflow.spec.ts expense-legacy-approval.spec.ts reimbursement-item-access.spec.ts expense-receipt.service.spec.ts payroll-supervisor.spec.ts
npm test -- --runInBand ai-copilot.service.spec.ts ai.service.spec.ts
npm run test:e2e -- --runInBand expense-admin.e2e-spec.ts
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node test/expense-workflow.integration.cjs
node --test scripts/dev-sandbox.test.cjs
node test/dev-workspace-sandbox.cjs
npm run build
```

PGlite script 驗證 migration／索引／約束／transaction，不是 Prisma 連實際 DEV DB 的全流程測試。PGlite 為本機既有工具庫，未新增產品依賴。

在 frontend 目錄：

```sh
node --import jiti/register --test tests/access-preview.test.ts tests/navigation.test.ts tests/wms-portal.test.ts
npm run build
```

瀏覽器：啟動 Vite `--host 127.0.0.1 --port 4179` 後，在 repo 根目錄執行 `node artifacts/access-expense-ai/ui-smoke.cjs`。harness 使用本機 Chrome 與合成 API，封鎖其他網域，不使用真實帳號。

### 本機證據

- [合成憑證真模型結果](../../artifacts/access-expense-ai/live-ai-receipt-smoke.json)／[可重跑腳本](../../artifacts/access-expense-ai/live-receipt-smoke.cjs)
- [保留 sandbox 的真模型憑證結果](../../artifacts/access-expense-ai/live-ai-receipt-sandbox-smoke.json)
- [Copilot 真模型結果](../../artifacts/access-expense-ai/live-copilot-smoke.json)
- [Copilot 可重跑腳本](../../artifacts/access-expense-ai/live-copilot-smoke.cjs)
- [UI 結果](../../artifacts/access-expense-ai/ui-smoke.json)
- [權限預覽](../../artifacts/access-expense-ai/access-preview.png)
- [模組權限設定](../../artifacts/access-expense-ai/permission-matrix.png)
- [費用 AI 填入](../../artifacts/access-expense-ai/expense-ai.png)
- [原始憑證](../../artifacts/access-expense-ai/receipt-evidence.png)
- [歷史申請補建審批確認](../../artifacts/access-expense-ai/legacy-supervisor-confirm.png)
- [Copilot 桌面](../../artifacts/access-expense-ai/copilot-desktop.png)／[手機](../../artifacts/access-expense-ai/copilot-mobile.png)

## DEV 部署與實際驗收

- Cloud Build `8a6f8a0e-fcab-491d-97fc-b82960cfac4c` 成功；前後端以原 SSO immutable image 為依賴基底，重新編譯並在 Linux image 產生 Prisma client。前端最終指向 stable DEV API。
- DEV API `corely-erp-api-dev-aex-637518d0-c`、web `corely-erp-dev-aex-637518d0-f` 各接收 100% 流量。正式 ERP 與 DEV／正式 WMS 的 configuration/traffic 比對均未變。
- 僅在 `erp_dev_20260921` 套本次 expense migration：preflight 無重複 PaymentTask、無未完成 migration、無歷史零步驟待審單；schema、checksum、FK/check/unique index 均核對通過。未自動修改任何既有使用者角色或主管。
- 保留 DEV sandbox 與所有既有 WMS／DB/JWT secrets；明確開啟 `ERP_DEV_AI_ENABLED=true`，僅賦予 DEV runtime 讀取指定 Gemini secret 的權限。其餘外連隔離與排程停用設定不變。
- 隔離 QA 公司四個身分完成真實 HTTP／Prisma／DEV PostgreSQL：角色範本／effective permission、合成 PDF 真 Gemini 辨識、主管快照及原檔查看、禁止自審／無關審批、核准、出納付款、重複付款拒絕。無銀行匯款、正式分錄、真實憑證或真實人員異動。
- 第一個候選驗收找到公司範圍出納看不到已核准申請，原因為 Prisma 忽略 `OR` 內空物件。修復後新增 6 項範圍回歸；保留原失敗證據，以原同一筆申請續測，未重送。
- 修正版 337 tests／59 suites、candidate 續測 20 checks、stable DEV 14 個登入／唯讀檢查、資料庫 5 個唯一性檢查通過。資料庫證明恰一筆付款任務及恰一筆付款歷程。
- 真 Copilot 查詢 QA 員工資料得出 1 筆／TWD 1,200，回答含範圍與來源。瀏覽器以實際登入驗證浮動入口、權限矩陣／搜尋／可見介面及真 AI 操作指南回答，未攔截或 mock 回應。
- Stable DEV 瀏覽器以公司代號／員工代碼登入出納帳號，實際看到 TWD 1,200 已付款申請、原始 PDF 連結及員工提交／主管核准／出納登錄歷程。四個 QA 帳號／公司已停用、session／角色已撤銷、兩個臨時角色移除；費用與付款稽核保留。已登出並保留 DEV 登入頁。
- 證據：[`artifacts/access-expense-ai/dev-20260923`](../../artifacts/access-expense-ai/dev-20260923)。本機合成 UI 與真 DEV 驗收分開保存；原 HTTP failure 不刪除。

正式導入前仍需由管理者依真實組織設定直屬主管、員工／主管權限、出納資料範圍與銀行 ACL，並由使用者在 DEV 確認實際作業。24 篇指南／9 個讀取工具不代表全部 ERP 模組已接通或整站業務驗收；未驗真銀行轉帳、正式分錄／對帳、現場倉庫操作或每個既有儀表板資料區塊。

回退僅可將 DEV API／web 分別切回 `corely-erp-api-dev-account-sso2-0923`、`corely-erp-dev-account-sso2-0923`。新增 schema 向後相容，回退不刪除費用／付款／審批資料。執行前仍需重新核對其他工作是否已更新 DEV。

## 本機依賴處理紀錄

最初複製 node_modules 時，來源本身是 symlink，Prisma generate 曾更新共享的產生檔。發現後已將本 worktree 的前後端依賴轉成獨立實體目錄；完成時先比對共享產生 schema 沒有他人介入變更，再以既有 `8897ddcb` schema 恢復共享 Prisma generated client（以無連線假 DATABASE_URL 執行 generate，不連 DB）。原始碼及 migration 未被改動，本 worktree 的 generated client 保留本次新 schema。此後全部 build/tests 使用獨立依賴。

## 初次本機收尾驗證（歷史記錄）

- Backend build 通過；Frontend TypeScript + production build 通過。
- Backend 合計 115 個聚焦 unit tests 通過；另 8 個費用管理 API e2e tests 通過。
- PGlite 26 個 migration／約束／transaction 檢查通過。
- Frontend 19 個聚焦 tests 通過。
- UI 8 個場景通過、無 pageerror；原圖確實載入，PDF 建立 Blob 開啟／下載連結，更換憑證清掉舊 AI 金額並保留人工修改。
- DEV sandbox 9 項自動測試及既有 WMS sandbox fixture 通過；真實 Gemini 的 sandbox TEST 憑證測試 6 個檢查通過，另有不允許網域被阻擋的 assertion。
- 新增前端元件／工具的 targeted ESLint 與 `git diff --check` 通過。
- Frontend build 仍有既有大型 bundle 與 Browserslist 資料過舊提醒，未因此擴大本次變更。

