# 修理 UI 215991e 收發視窗獨立接收回執

2026-10-08（Asia/Taipei）。收發視窗委派獨立覆核。結論：**PASS_SCOPE，可接收此固定程式批；中央知識與 DEV 發布仍未通過。** 本次沒有發現新增 P1／P2。舊 `28b5` 的 FAIL／HELD 原文保留；本回執不覆蓋它，也不把本 UI 批當作已進入先前 `2643` candidate。

## 固定來源與邊界

- Origin `https://github.com/moztechCEE/ecom-accounting-system-.git`。從收發 owned repo explicit fetch `refs/heads/codex/repair-ui-cleanup-20261008`；FETCH_HEAD 與 `git ls-remote` 同時核對 **`215991e18e5c33c5045921b1668482142dc2f70d`**。
- 累積基底 `264352c5b863d9928a36ab2a9dbecc697f35a028`；前版 `28b5f06c7889085d9246aab7c33ab7090669c7a6`。累積精確 17 檔：AGENTS、7 runtime、5 DOM tests、4 docs；相對 28b5 delta 15 檔。
- 全新 detached receiving tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-review-repair-ui-215991e-20261008`。開始及結束 HEAD 精確相同，tracked／非 ignored status clean。只複用 ignored node_modules symlinks；沒有改產品、測試、中央指南、manifest、lockfile或他人工作樹。
- 已讀該固定版 AGENTS、新 handoff 及舊 FAIL；實際讀 runtime diff、native service calls、動作與表單門檻。另以保固 repo `git show 6f59aa230bcc841bc261f3125f368a9208a034ca:docs/ui-design-principles.md` 核對引用方向。未讀寫 DB、部署、Cloud Run 流量、真人權限／員工映射、通知、退款、付款或庫存。

## 原 P2 接收結果

前版的「原廠作業 pending 仍能收合，API reject 後錯誤位於隱藏 DOM」在 optional baseline 控制中 **親跑重現**；同一個 actual Page 的新版路徑通過：

- `RepairWorkbenchPage.tsx:253` 在 workflowBusy 時 disabled 且阻止 activeKey 變更；強制點擊仍無法收合。
- `RepairWorkflowPanel.tsx:32-47` UI-only busy／failure callbacks 不改原 command；拒絕後 failure 顯在 `RepairWorkbenchPage.tsx:241` 外層。
- 拒絕後自行收合，外層 Alert 仍可見；同 textarea DOM 與原草稿保留。新嘗試清除舊錯誤，原 body／expectedVersion／requestId 維持，busy 重送不多發 command。
- update permission、assigned owner、server allowlist 三種負向場景均無操作入口／POST；Stock units 403、network、reserve 403、release 403 均保留真實 errorText，只有本地確定過期才顯 expired 且沒有 reserve／release write。

範圍限制：本批 actual DOM 親跑的是 **POST reject**，没有保存成功後 GET reload reject。子元件的 `saved` catch 外層回饋有 source 路徑，但 actual Page 的 loadDetail／refresh 自行 catch（與 2643 相同），不向 child throw；因此不以本回執宣稱整個「已保存但 reload 失敗」父頁路徑已独立驗收。CustomerRepairQueue 是 native AST／guard 接收，沒有本批獨立客服 queue DOM。這些限制不改原 P2 已修復的結論。

## 實跑測試與靜態契約

| 親跑項目 | 結果 |
|---|---|
| 五個 actual DOM files，sequential、私有 Vite cache／HMR false | **Node 18／18 PASS，53,724.550334 ms**；Terminal 1、Documents 5（parent＋4）、Readiness 1、Layout 1、Workflow feedback 10（parent＋9）。沒有 skip。 |
| Optional 28b5 baseline 與新固定 feedback | **11／11 PASS，11,799.407375 ms**；前版缺陷實際重現，新版修正與負向守門再通過。此為負向對照，不把舊版標成產品 PASS。 |
| app／node TypeScript | **PASS**；ES2022 app、私有 tsBuildInfoFile，不污染共用 dependency cache。 |
| 6 變動 TSX＋5 DOM tests scoped eslint | **PASS，0 error／0 eslint warning**。 |
| private production Vite build | **PASS，1.08s**；只輸出私有 dist/cache，既有 browsers data 老化及 chunk-size warnings，沒有升級 dependencies。 |
| `git diff --check 2643..HEAD` | **PASS**。 |
| 中央 `generate-copilot-knowledge.cjs --check` | **預期 FAIL：精確 7 owned runtime hash drift**；未執行 --write、無生成檔更動。 |

測試載入實際 React Page／Documents／Readiness／Workflow／Stock、AntD、native repair services。只有合成 Auth／API／websocket stub；所有五檔確認 browser runtime errors、外部請求、真 HTTP writes 均為 0。合成 API JS stub 記錄是測試證據，不是業務寫入。

Layout 親跑 1537×972、1024×972、390×844 三尺寸：長產品／案件／SN／SKU 清楚、兩個開案入口、工作單兩／三區、無水平溢出；取消退出／切單保留 DOM 與草稿，離線儲存一次合成 payload 正確。等待清單正例顯待維修接手，CSR estimate／quote／decision mismatch 三負例均顯待客服重新確認且不假放行。Readiness 18 情境及 Terminal 10 情境的資料、當版同意／款項、CSR／QC、唯讀、歴史 ACK／寄出界線仍完整。目視核對桌面清單、1024 抽屜、390 抽屜；這些是合成測試圖片，不是 DEV 登入／營運接受。

原生 TypeScript AST 由 reviewer 自行解析 base／HEAD：core 16 payload/gate declarations 加其他 11 occurrence，**27 initializer AST 相同**；五元件 **21 API／UUID／permission call AST 相同**；六個 Page action if 條件及去除 display label/reason 後的 name／disabled object AST 相同；Workflow 7、Documents 31、Customer queue 2 共 **40 Form.Item name／rules／valuePropName 相同**。沒有照抄作者的 13-count 檢查結論。backend 完整 Git tree、frontend services、repair model/readiness/navigation helper、mailroom 完整目錄及兩個 lockfile 均與 base tree OID 相同。新版等待原因是 readonly projection，沒有新增 business action。

## 中央整合與指南

AGENTS 原發布內容 **1,613 bytes 完整前綴逐字保留**（原使用者 DEV-first 段落及 7 條 release bullets，合計 8 項約定）；新增低干擾規則沒有弱化 production approval、候選驗收、權限或知識更新要求。保固固定版本中的一頁一名、資料優先、按需次要操作、條件可辨識可清除、DEV／錯誤／權限真實、草稿／儲存／列印分別及焦點手機要求均保留。

新 handoff 的中英提案與已審的品名入口、工作單分區、桌面側欄／手機表單先行、原件／原廠與歷史按需展開、外層 reject feedback、独立預留及舊 ACK標示相符。現有 repair-workbench zh/en guide 均 11 steps／11 boundaries，相關頁與 grant 未變；新增提案不能只換 hash，需要 DOA 覆核後集中更新交互說明，保留本人／公司、版本、顧客同意／必要款項、库存／QC與 dispatch compatibility 邊界。

**發布仍有 gate：** 七 source drift 必須中央雙語更新並通過 check；最後整合 SHA 要再核對 affected tests／candidate source proof及普通合成帳號的 DEV UI。收發 GET 呼叫者 Employee 資格不應取消獨立 read 的 P2，以及 false-empty P2，是 Root／DOA另批認領；這不是 Source 案件承辦客服映射錯誤，本 receiving 不修改、不將它們算作 215 引入。Source／AI dispatch consumer 仍 PENDING_COMPATIBILITY／DISPATCH_CONSUMER_NOT_CONFIGURED，歷史 ACK 不代表本次寄出同步、真通知或顧客收件。

## 命令、hash 及 artifacts

所有命令 cwd 是上列 detached tree（types／DOM／lint／build cwd frontend）：

```sh
git fetch --no-tags origin refs/heads/codex/repair-ui-cleanup-20261008
git rev-parse FETCH_HEAD
git ls-remote origin refs/heads/codex/repair-ui-cleanup-20261008
node --import <private>/screenshot-preload.mjs --test --test-concurrency=1 tests/repair-dispatched-page-dom.test.mjs tests/repair-readiness-dom.test.mjs tests/repair-ui-layout-dom.test.mjs tests/repair-documents-ui-dom.test.mjs tests/repair-workflow-feedback-dom.test.mjs
REPAIR_TEST_BASELINE=1 node --import <private>/screenshot-preload.mjs --test tests/repair-workflow-feedback-dom.test.mjs
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json --tsBuildInfoFile <private>/app.tsbuildinfo
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile <private>/node.tsbuildinfo
./node_modules/.bin/eslint src/pages/repair/CustomerRepairQueue.tsx src/pages/repair/RepairDocuments.tsx src/pages/repair/RepairReadinessPanel.tsx src/pages/repair/RepairReplacementStock.tsx src/pages/repair/RepairWorkbenchPage.tsx src/pages/repair/RepairWorkflowPanel.tsx tests/repair-dispatched-page-dom.test.mjs tests/repair-documents-ui-dom.test.mjs tests/repair-readiness-dom.test.mjs tests/repair-ui-layout-dom.test.mjs tests/repair-workflow-feedback-dom.test.mjs
git diff --check 264352c5b863d9928a36ab2a9dbecc697f35a028..HEAD
node scripts/dev/generate-copilot-knowledge.cjs --check
```

build 使用 Vite API `build({cacheDir:<private>/vite-build-cache,build:{outDir:<private>/dist,emptyOutDir:true}})`。preload 只重定向 screenshot 路徑到私有資料夾，不改產品、mock/assertions或瀏覽器策略；各 test 自建私有 cache 並清理。沒有啟動使用者本機預覽。

| Owned runtime | 親算 SHA256（7 檔全與 handoff 相符） |
|---|---|
| CustomerRepairQueue.tsx | `c882e9a075024cd80888ddde1418424c6653bd0e61ea23fdb8027e0cebf994b9` |
| RepairDocuments.tsx | `7d9e62fc0e3f66b8453cfc6c67ee20de2b6749b0175416d0fd3e3111a9e65323` |
| RepairReadinessPanel.tsx | `d5083d34857961a32ef4c288b5f0be257b2d970c7f334c515cef5c2b99ac88b7` |
| RepairReplacementStock.tsx | `c907bafd3688ab2913259c9f1bb6024b9fa26c9212c2882e7d37911dbae6ca8e` |
| RepairWorkbenchPage.tsx | `7a90ca43bd50826ee4ed2508701c13df505d09504d51692c973883677d83685b` |
| RepairWorkflowPanel.tsx | `e812edcc4cb1e91a5f34a5fc6c1dc7fed61bd8eaaa949e9230308cd59e227278` |
| repair.css | `9b316c77a01fdd02e823a6032d12706456d7d3861c8ad4f2b1a9f8c46b76f616` |

舊 FAIL 原文 SHA256 `5f10cc9d0b75adcf7e576eb02a464b98e987a4bc0d877c5634668ae80b19ce31` 核對相符，沒有覆寫。

私有證據目錄 `<private>`：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/repair-ui-215991e-mailroom-review-uaw0jhjc`。含 `metadata.json`（原始測試 logs、兩份 AST JSON、8 screenshots、preload 的 SHA256）、`dom-tests.log`、`workflow-baseline.log`、`types-lint.log`、`build.log`、`knowledge-check.log`。metadata及本回執以完工固定版再確認，tree clean。未 commit／push 本 receiving，也未建立 PR 或傳送外部訊息。
