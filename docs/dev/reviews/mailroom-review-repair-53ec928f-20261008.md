# 收發端獨立複核：repair 53ec928f（2026-10-08）

## 固定版本與界線

- 審查 ref：`codex/repair-workbench-20261008`；named fetch `FETCH_HEAD` 為完整 SHA `53ec928fa4306d64c320d9ad86de77d474c2ff98`，直接 parent 與 merge-base 均為 `a78741cf3c18f05ec079c608749e81e08c726d91`。
- 新 detached tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-53ec928f-20261008`。已讀 AGENTS、repair handoff 與本次 0c 公司審查回執。測後 tracked clean，`git diff --check a787…53ec` PASS；沒有 reset 舊 tree。
- 僅審 parent..53ec 五檔：Page、WorkflowPanel、新整頁 DOM test、handoff、0c 公司 receipt。Backend/API/DTO/schema、finance、dispatch、repair 模型、documents、readiness helper、services、mailroom 前端與共享導航均沒有此 delta。
- 本 tree 仍是 repair 自有 backend 基線，尚未整合收發 `d75ce4359df2f2170b65b1acf984aa9f8439cd34`；不能將此測試當成 d75 dispatch 完整整合驗收。schema blob `3b9987b168cbcb2499a6f356169cb5310c292132`、mailroom service blob `a9e544951ef8548a85d5390e6f3543abb66d4155`。
- 僅合成/offline HTTP 替身與本機 Chromium。沒有雲端、DB、真實案件/通知/物流/庫存、產品修改、commit、部署或跨 chat 訊息。依賴只借用 ignored symlink；Vite private cache / HMR false、types 私有 tsBuildInfo，未修改 shared node_modules cache。

## 結果：本次提示修正 PASS_SCOPE

| 實際驗證 | 結果 |
| --- | --- |
| 新完整 RepairWorkbenchPage DOM + 既有實際 readiness panel DOM | **2/2 PASS**，18,139.447375 ms。整頁測試含 4 個已保存 plan × 拒修無 report/有保存 report，共 8 個 DISPATCHED，再加 READY_FOR_DISPATCH、WAITING_RETURN_ACCEPTANCE 2 個阶段情境。 |
| 接收端獨立舊 6 個完整頁面反例 | **6/6 PASS**。REPAIR/REPAIRED、REPLACE/REPLACED、FACTORY/FACTORY_REPAIRED、RETURN/RETURN_UNREPAIRED、REPAIR/RETURN_UNREPAIRED、REPLACE/RETURN_UNREPAIRED。 |
| frontend app/node type check | **PASS**，exit 0，兩個 private tsBuildInfoFile。 |
| 兩個改動 source + 新 test scoped ESLint | **PASS**，exit 0、0 errors/0 warnings；僅 baseline-browser-mapping 資料老舊提示。 |
| readonly knowledge --check | **FAIL（確認漂移）**，exit 1：Page、WorkflowPanel source hashes 改變，catalog.generated.ts / source-manifest.json 待 DOA 集中雙語語意審查與生成。沒有執行 --write。 |
| diff / tracked cleanliness | **PASS**；本次五檔之外 source delta 空白，tree tracked clean。 |

### 對前次 a787 P2 的具體複核

`RepairWorkflowPanel.tsx:27-31,74` 現在按實際 stage 顯示：DISPATCHED 已交物流，READY_FOR_DISPATCH 收發已簽收待寄且尚未交運，WAITING_RETURN_ACCEPTANCE 等指定本人簽收。6 个独立反例中舊「後續由收發室本人簽收並安排原件寄回」出現次數均 0；三個 RETURN_UNREPAIRED 均看到「原件已交物流寄回；依收發室寄出紀錄核對」。

`RepairWorkbenchPage.tsx:234-237` 將 DISPATCHED 區塊標作「既有進度同步與交接歷程」，明示既有「系統已接收」不證明本次寄出同步或顧客通知。獨立 fixture 原 AFTER_SALES DELIVERED count 2、AI_CUSTOMER_SERVICE DELIVERED count 3 都仍可見，沒有改寫為 dispatch ACK。

6 個反例均以實際「維修單」tab 查看保存處置，再切回「檢修單」；保存文字可見、原 outcome/資料未變、dispatch 歷史「實物紀錄 v12／合成已交物流」保留。全数 terminal 可操作控件 0、業務 POST/寫入 0、React errors 0、外網 0、輸入 deep equality 保持；每案只有 4 個合成讀取。獨立 probe 另帶 `outboundShipment.sourceSync={status:'PENDING_COMPATIBILITY',reason:'DISPATCH_CONSUMER_NOT_CONFIGURED'}` 並確認原資料仍是 pending；此頁 disclaimer 不把它轉為同步成功，也沒有新增 Source/AI consumer。

保留先前 `mailroom-review-repair-a78741cf-20261008.md` 的完整頁面 **FAIL** 歷史；本 receipt 只關閉 53ec 上對應提示缺陷，不改寫舊被審版本結果。author 新 test 的完整頁面替身含真 Page/WorkflowPanel/Documents/ReadinessPanel，但其 repairService.documents 為合成 wrapper、history 為空；因此非空歷史/6 個不同 purpose/outcome 的保留結論來自上述獨立 probe，沒有把未測 coverage 算進 author test。

### 文檔基線與待辦

53ec handoff `:114,128-129` 及 0c receipt `:32` 的「DISPATCHED 不在 records」敘述只對本 tree/0c 的舊 backend 成立（本 tree service `:378-381` 只列 READY_FOR_DISPATCH、PENDING_WELFARE_STOCK）。它不能套用收發 d75：已 read-only 查 d75 service `:385-390` records 包含 DISPATCHED。本次沒有代簽其他 peer 的 service list 8 斷言；文檔更正由 repair 下一固定 docs/test 批提供後另列 below。公司 0c 回執僅本次 read-only 閱讀，沒有冒充重新執行公司測試。

產品 SHA256 已對照 handoff：
- Page：`d8334e974e1339ab90c063408aaa9c8ab6885fb2010dcbd2b3d8b2286aa2cf59`
- WorkflowPanel：`6f6e5299a84edeefcb1d5ba5a322db7c6706ab58e2b823c7c1f5836d756b9b66`

**PENDING**：DOA 集中 knowledge 更新、最後整合 SHA 的 d75 正式保管/寄出投影及 records 查询組合、DEV 真登入/來源相容/現場搬運與營運驗收。這不是發布、Source dispatch 同步成功或顧客收件證明。

## 精確命令與本機證據

Repo 操作在收發 own repo（其他 ref tracking 未拿來代替 FETCH_HEAD）：

```sh
git fetch origin codex/repair-workbench-20261008
git rev-parse FETCH_HEAD
git worktree add --detach '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-53ec928f-20261008' 53ec928fa4306d64c320d9ad86de77d474c2ff98
```

下列在 review tree frontend cwd 執行。私有 runtime：
`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-53ec928f-b4xfem6s`。
`isolated-vite.mjs` 只覆寫 createServer 的 cacheDir/HMR 設定，沒有改產品 source、assertion 或业务 payload。

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --import '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-53ec928f-b4xfem6s/isolated-vite.mjs' --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/repair-dispatched-page-dom.test.mjs tests/repair-readiness-dom.test.mjs
node_modules/.bin/tsc -p tsconfig.app.json --noEmit --incremental --tsBuildInfoFile '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-53ec928f-b4xfem6s/tsconfig-app.tsbuildinfo'
node_modules/.bin/tsc -p tsconfig.node.json --noEmit --incremental --tsBuildInfoFile '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-53ec928f-b4xfem6s/tsconfig-node.tsbuildinfo'
node_modules/.bin/eslint src/pages/repair/RepairWorkbenchPage.tsx src/pages/repair/RepairWorkflowPanel.tsx tests/repair-dispatched-page-dom.test.mjs
REVIEW_FRONTEND='/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-53ec928f-20261008/frontend' REVIEW_CACHE='/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-53ec928f-b4xfem6s' node '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-53ec928f-b4xfem6s/terminal-page-probe.mjs'
```

Repo root：

```sh
node scripts/dev/generate-copilot-knowledge.cjs --check
git diff --check a78741cf3c18f05ec079c608749e81e08c726d91 53ec928fa4306d64c320d9ad86de77d474c2ff98
git status --short
```

原始證據保留上述 runtime 的 `dom.log`、`terminal-page.log`、`terminal-page-probe.mjs`、3 個 RETURN_UNREPAIRED 截圖、`knowledge-check.log`。舊 a787 probe/log/screenshot 與 FAIL receipt 未覆寫。未重跑舊 58 unit、全 backend 或 build；type/lint/本次 DOM 為此次實跑。瀏覽器資料、experimental loader/deprecation 提示是既有依賴環境訊息，非產品 pageerror。

## 追加固定交付 2ade393a：docs/test delta PASS_SCOPE

收到 repair 新固定 ref 後另作 named fetch、`git rev-parse FETCH_HEAD` 及 `git ls-remote origin refs/heads/codex/repair-workbench-20261008`，三者均為完整 SHA `2ade393a69eefca13899085a9874e489ba9c21aa`，直接 parent 為上述 `53ec928fa4306d64c320d9ad86de77d474c2ff98`。新 detached tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-2ade393a-20261008`，已讀該 tree AGENTS 與兩份更正文件。没有 reset 53ec/a787 tree，测后 tracked clean。

`53ec..2ade` **只有 3 檔**：handoff、`docs/dev/reviews/mailroom-dd0b5b44-repair-20261008.md`、原完整 Page DOM test。以 `git diff --name-only 53ec…2ade -- frontend/src backend scripts` 核對產品 source/Backend/knowledge generator **空白**，Page/WorkflowPanel SHA256 與上述 53ec 相同。因此 53ec 的 2 DOM、6 個獨立反例、type/lint source 結論以 product-identical 對照沿用，沒有冒充在 2ade 全部重跑。

文檔更正 **PASS_SCOPE**：handoff `:114,128-135` 與 dd receipt `:79` 明確指出 records 排除 DISPATCHED 是 repair/0c 舊 backend 限制，dd/d75 的原生 records 早已包含 DISPATCHED；合併後可在 records/all 查看，同時保留來源/AI dispatch `PENDING_COMPATIBILITY` 與舊 ACK 不代表寄出同步的邊界。接收端另外 read-only `git show` dd 與 d75 的 `mailroom.service.ts:385-391`，兩者確有 READY_FOR_DISPATCH/DISPATCHED/PENDING_WELFARE_STOCK。文檔載的 actual d75 service list 8 斷言是 repair peer 的執行聲明，**本視窗沒有代簽重跑**，也沒有把 synthetic query 當真 DB 驗收。0c 公司 receipt未被這個 delta修改，保留它當時基線的審查歷史。

追加實跑新的完整 Page DOM **1/1 PASS**（10 原情境，10,343.558459 ms；test 本體 9,773.263125 ms）。在 8 個 DISPATCHED 分支由真 router 的 `queue=records` 進入，實際 Page 發出的首筆 client query 都帶 `entityId=synthetic-company`、`view=repair`、`repairScope=records`，offline API 按 dd/d75 的 status 條件篩選合成列表並開啟 readonly 文件。仍核對 4 plans × refusal/completed、兩個待交接 stage、原保存處置、ACK與零 POST/外網/pageerror。此測試證實 frontend query 與模型列表契約，不證明本 review tree 的舊 backend 已整合 d75 或真 DB 有該資料。

僅新 test scoped ESLint **PASS**，exit 0、0 errors/0 warnings；`git diff --check 53ec…2ade` **PASS**，新 tree tracked clean。private Vite cache/HMR false，未改產品。未重跑舊 units、backend、type/build、6 probe 或 knowledge；本次 knowledge source 與 53ec 相同，先前漂移 **FAIL / DOA 集中更新 PENDING** 仍適用。

精確追加命令：

```sh
# 收發 own repo cwd
git fetch origin codex/repair-workbench-20261008
git rev-parse FETCH_HEAD
git ls-remote origin refs/heads/codex/repair-workbench-20261008
git worktree add --detach '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-2ade393a-20261008' 2ade393a69eefca13899085a9874e489ba9c21aa
git show dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d:backend/src/modules/mailroom/mailroom.service.ts
git show d75ce4359df2f2170b65b1acf984aa9f8439cd34:backend/src/modules/mailroom/mailroom.service.ts

# 新 2ade review tree frontend cwd
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --import '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-2ade393a-lzj90m9h/isolated-vite.mjs' --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test tests/repair-dispatched-page-dom.test.mjs
node_modules/.bin/eslint tests/repair-dispatched-page-dom.test.mjs

# 新 2ade review tree root cwd
git diff --name-only 53ec928fa4306d64c320d9ad86de77d474c2ff98 2ade393a69eefca13899085a9874e489ba9c21aa -- frontend/src backend scripts
git diff --check 53ec928fa4306d64c320d9ad86de77d474c2ff98 2ade393a69eefca13899085a9874e489ba9c21aa
git status --short
```

追加 raw log / private isolation wrapper：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-2ade393a-lzj90m9h/dom.log`、`isolated-vite.mjs`。同一 ignored Vite dependency 實體只借用 library，產品 source 由新 2ade tree 的 root/cwd 載入；cache 使用新的 2ade runtime，HMR false。**結論：2ade 產品同 53ec，docs/test 修訂 PASS_SCOPE；最終共同整合、集中 knowledge、DEV與現場驗收仍 PENDING。**

