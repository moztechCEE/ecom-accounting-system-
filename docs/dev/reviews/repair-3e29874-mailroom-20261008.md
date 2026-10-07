# Repair 3e29874：收發室修正差異獨立覆核（2026-10-08）

## 固定版本與範圍

- Repository：`https://github.com/moztechCEE/ecom-accounting-system-.git`
- 本次實際 fetch：`git fetch origin codex/repair-workbench-20261008`，FETCH_HEAD 核對為完整 SHA `3e2987410b7e25108290700e6ec381d9474209c3`。
- 被審 ref：`codex/repair-workbench-20261008`。
- 本次 parent／差異基底：`587b077a59982a436726c02e0c286391e5432ebf`。
- 共用 f3 基底：`f3f14c4104906cc6ca23bd1d38ba4589563b6801`。
- 新 detached review tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-3e29874-20261008`，HEAD／parent 已核對，開始與完成時 tracked／untracked 狀態皆乾淨。
- 舊 `corely-erp-review-repair-587b077-20261008` 保留，未 reset／覆寫；舊收據 `docs/dev/reviews/repair-587b077-mailroom-20261008.md` 保留。
- 已閱讀新 review tree 的 `AGENTS.md`；本輪只審 `587b077..3e29874` 的 helper completion phase gate、兩份專用測試與 handoff 文件。
- 僅在 development tree 新增本收據。未修改 product／backend／root page／shared navigation／configuration／knowledge，未 commit，沒有 app messaging、雲端、資料庫、真實資料或通知操作。
- review tree 的 ignored node_modules symlink 沿用既有 dependencies；未安裝或升級依賴。Node `v24.19.0`。

## 本次結論

**PASS：固定 3e2987410b7e25108290700e6ec381d9474209c3 已修復收發端上次指出的 P2；本次 delta 未發現新的接收端可執行缺陷。Knowledge 集中更新、dispatch、最終整合與 DEV／現場驗收分開列 PENDING／NO-IMPACT，不由本收據代簽。**

| 狀態 | 本次固定 SHA 審查 | 證據與理由 |
| --- | --- | --- |
| PASS | INSPECTING + 維修 DRAFT／SUBMITTED 正確指向開工 | `repair-readiness.ts:144-148` 不再由任意存在的 report 啟用 completion 指引。REPAIR／REPLACE × DRAFT／SUBMITTED 四組都保留 startReady=true、showStart=true、showCompletion=false，title「目前具備送出開工核對的條件」、nextStep「開始維修／替換」。 |
| PASS | 當版來源未齊仍顯示開工缺口 | 新 readiness unit 回歸測例撤除顧客同意時，仍是開工核對而非完工交回；既有 CSR／quote／payment／source failure case 全部重新通過。 |
| PASS | WAITING_CUSTOMER + 既存 report 不跳到完工 | 額外合成探針確認 showStart=true、showCompletion=false；需先取得當階段開工条件，不用已存報告冒充實際開工。 |
| PASS | 原廠返還後缺 CSR／改檢修只展示缺口 | 新 `factoryReturned` 唯讀顯示條件要求 FACTORY 方案、INSPECTING、RETURNED 與 TECHNICIAN physical custody。缺 CSR、檢修v4／維修單依據v3、capability absent／[] 時 showCompletion=true，但 completionReady=false；顯示原因供核對，沒有新增 action/capability。 |
| PASS | 原生實際處置與能力不被改寫 | 新單元與獨立 probes 用前後物件比對；report outcome、文件狀態、版次、allowedWorkflowActions 完全不變。面板本來沒有 action button，本次 actual DOM 重新斷言。 |
| PASS | 既有 receiving custody 顯示及 native predicates | 本次重新跑 frontend custody5／workbench8；交辦、本人接收、正式庫存、原廠與對客物流各自維持原生边界。 |
| NO-IMPACT | backend／API／schema／shared states | 本次 delta4檔案，沒有 backend、mailroom pages、repair-model predicates、RepairWorkbenchPage 或 ReadinessPanel 差異；以 `git diff --quiet` 核對。舊 API legacy gate 缺口未被此修正解決。 |
| NO-IMPACT | dispatch 不在此修訂 | 本次修正不新增或變更寄回、承運商、追蹤號、dispatch 状态与 payload，不視為收發室 dispatch 接口完成或驗收。 |
| PENDING | Claw knowledge | 舊587覆核實跑 knowledge16/17、唯一 Page hash drift FAIL。該 Page 與 knowledge 檔本次沒有變更，本輪沒有重跑或刷新；helper新hash與panel sourcePaths仍交DOA集中雙語審查／生成／最終整合gate。不能把繼承的已知失敗改記本SHA PASS。 |
| PENDING | 最終整合、DEV與實物／通知／物流／款項／庫存驗收 | 僅固定來源與離線合成驗證。新整合SHA、部署、登入角色與真實本人交接另驗；本輪沒有操作外部系統。 |

## 本次 actual checks

### Fetch、detached tree、delta、dirty 與 hash

development tree cwd：

```sh
git fetch origin codex/repair-workbench-20261008
git rev-parse FETCH_HEAD
git show -s --format='%H %P %s' FETCH_HEAD
git worktree list --porcelain
git worktree add --detach '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-3e29874-20261008' 3e2987410b7e25108290700e6ec381d9474209c3
```

new review tree cwd：

```sh
git rev-parse HEAD
git status --short
git diff --stat 587b077a59982a436726c02e0c286391e5432ebf..3e2987410b7e25108290700e6ec381d9474209c3
git diff --check 587b077a59982a436726c02e0c286391e5432ebf..3e2987410b7e25108290700e6ec381d9474209c3
git diff --quiet 587b077a59982a436726c02e0c286391e5432ebf..3e2987410b7e25108290700e6ec381d9474209c3 -- backend/src/modules/mailroom backend/src/modules/ai/knowledge frontend/src/pages/mailroom frontend/src/pages/repair/RepairReadinessPanel.tsx frontend/src/pages/repair/repair-model.ts frontend/src/pages/repair/RepairWorkbenchPage.tsx
shasum -a 256 frontend/src/pages/repair/repair-readiness.ts frontend/src/pages/repair/RepairReadinessPanel.tsx frontend/tests/repair-readiness.test.ts frontend/tests/repair-readiness-dom.test.mjs
```

**PASS**：所有版本与dirty／diff检查符合指定；delta仅4檔案、77 insertions／4 deletions；diff --check、diff --quiet皆exit0。helper hash與更新handoff一致。

| File | 本SHA實讀 SHA256 |
| --- | --- |
| repair-readiness.ts | `235ca26f382e5cd109537cd445b894efdb93f60e34f5a40e5e7c9267dd428234` |
| RepairReadinessPanel.tsx | `3c93901a5b3078b1024313f5825960bc7428248c8c2305d1e79c7868c45731f5` |
| repair-readiness.test.ts | `54a83ebacda4a1c27b443d4e0dee9e3d5608ad2a63bf0d9beabd5c3dbb03d5cf` |
| repair-readiness-dom.test.mjs | `121be93e8b300c3b4a0179c4ffd077b4ca0733b905d5691c2d8acd310640cb52` |

### 新 readiness＋必要 affected frontend tests

new review frontend cwd：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test tests/repair-readiness.test.ts tests/repair-item-custody.test.ts tests/repair-workbench.test.ts
```

**PASS 32/32、exit0、skip0**：新 readiness19／frontend custody5／workbench8。Node experimental-loader／fs.Stats 棄用提示不影響結果。

### Actual new DOM test，隔離 Vite cache／HMR

測試 source 未修改。以本機 temporary Node ESM loader 對「此 test 檔案 import 的 vite」包一層 `createServer`，只覆寫 private cacheDir與`server.hmr=false`；其餘 Vite options、fixture source、case assertions全部原樣。這避免沿用 shared node_modules/.vite HMR／cache，未改任何 repo 程式。

temporary loader：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-repair-3e29874-rvk2m8nu/vite-isolation-loader.mjs`；實際建立的cache：同資料夾的`vite-cache/deps`。loader 的 isolation 行為：

```js
export async function resolve(specifier, context, nextResolve) {
  const original = await nextResolve(specifier, context);
  // Only the exact repair-readiness-dom.test.mjs parent gets this Vite proxy.
  // The proxy reexports real Vite and wraps createServer with:
  // {...options, cacheDir: privateCache, server: {...options.server, hmr:false}}
  // Other imports and the actual committed test source are unchanged.
}
```

實際執行（new review frontend cwd）：

```sh
node --experimental-strip-types --loader '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-repair-3e29874-rvk2m8nu/vite-isolation-loader.mjs' --test tests/repair-readiness-dom.test.mjs
```

**PASS 1/1、exit0、skip0**：15個合成scenario（含新增inspection-draft／inspection-submitted／factory-reinspection）。確認開工指引、保存實際處置、原廠失CSR／修訂版次缺口、唯讀無action button、文字escape、desktop1280／mobile390無橫向溢出、外部請求=[]、pageerror=[]。既有baseline-browser-mapping過期提示未透過升級解決。

### 收發端獨立再現探針

另以同一ts-node runner `--input-type=module` stdin import helper，沒有新增repo測試檔：

- **PASS**：REPAIR／REPLACE × DRAFT／SUBMITTED四組，總提示皆開工且report資料保持原樣。
- **PASS**：WAITING_CUSTOMER有report仍保留開工gate提示，showCompletion=false。
- **PASS**：FACTORY／RETURNED／TECHNICIAN，缺CSR、檢修改v4而report仍v3；分別用absent與[] capability，皆showCompletion=true／completionReady=false，物件資料與capability未改。

共7組合成scenario，與32＋1正式測試分開計數。

## 繼承的587結果與未重跑項目

以下只引用先前本收發覆核收據`docs/dev/reviews/repair-587b077-mailroom-20261008.md`，**不是本新SHA重新執行**：

- backend pure mocked custody28/28：claim不移轉保管；accept才移轉技師；WAITING_RETURN_ACCEPTANCE仍技師持有；accept_return才移轉指定收發本人；LINKED_CASE／UNKNOWN與正式IN／OUT證明。
- frontend repair-stock-return9/9：本人逐件接收、原生SN、版本及exact正式IN回執核對。
- knowledge16/17、exit1：Page hash drift，待DOA集中更新。

本次delta未動上述backend／stockreturn程式或shared contract，所以未重跑全套backend／stock／navigation／build／lint；不把修正方報告的59/59與build當成本覆核實跑。本輪只新增本收據，原587收據及其他工作樹內容均保留。最終整合SHA仍須按DOA規範完成適當checks、knowledge與DEV gate。
