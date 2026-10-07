# Repair 587b077：收發室獨立接收端覆核（2026-10-08）

## 固定版本、所有權與範圍

- Repository：`https://github.com/moztechCEE/ecom-accounting-system-.git`
- 被審 ref：`origin/codex/repair-workbench-20261008`
- 被審完整 SHA：`587b077a59982a436726c02e0c286391e5432ebf`
- 基底及被審提交 parent：`f3f14c4104906cc6ca23bd1d38ba4589563b6801`
- 審查 worktree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-587b077-20261008`，detached HEAD，開始時 tracked／untracked 工作目錄皆乾淨。
- 收據唯一寫入位置：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-20261008/docs/dev/reviews/repair-587b077-mailroom-20261008.md`。此 development tree 的其他修改由其他同仁持有，未更動。
- 已閱讀被審 tree 的 `AGENTS.md`。本次未更動 app／backend／shared navigation／configuration／knowledge、未 commit、未操作雲端、資料庫、正式資料或真實通知。
- 僅在 review tree 建立 ignored `frontend/node_modules`／`backend/node_modules` symlink，以沿用既有 dependencies；沒有安裝或升級依賴。
- `frontend/node_modules` 最終解析至 `corely-erp-doa-20261002/frontend/node_modules`；`backend/node_modules` 解析至 `corely-erp-aftersales-20261005/backend/node_modules`。Node `v24.19.0`。

被審差異只有 handoff 文件、`RepairWorkbenchPage.tsx`、新增 `RepairReadinessPanel.tsx`／`repair-readiness.ts` 與兩份 readiness 測試。沒有 backend、DTO、schema、migration、root page 或通知操作修改。

## 結論

**接收端 custody 契約及隔離測試 PASS；新下一步指引覆核 FAIL，發現一項 P2。Knowledge drift 另列 FAIL／待 DOA 集中整合。不可把本收據標成整批無條件 PASS 或 DEV／現場驗收。**

### P2：已存維修單在開工前使下一步指引誤指向完工交回

`frontend/src/pages/repair/repair-readiness.ts:144` 的 `showCompletion` 將任何已存 `repairReport` 納入，即使案件仍在 `INSPECTING`。同檔 `:185-194` 又優先選擇 `showCompletion`，蓋過 `showStart` 的當階段指引。

這是原生可達情境：`backend/src/modules/mailroom/repair-workbench.service.ts:555-560` 允許在 `INSPECTING` 保存維修草稿或提交維修單；檢修改版亦可能保留原生實際處置紀錄。固定 SHA 上用合成資料重現：

| 案件狀態 | 已存維修單 | 開工條件 | 面板主提示 |
| --- | --- | --- | --- |
| INSPECTING | 無 | startReady=true | 目前具備送出開工核對的條件 |
| INSPECTING | DRAFT | startReady=true | 完成件交回仍有待核對條件 |
| INSPECTING | SUBMITTED／複驗通過 | startReady=true | 完成件交回仍有待核對條件 |

後兩列的 `nextStep` 要求補齊維修单與複驗，未指出當前真正下一步「開始維修／替換」，而且提交單與複驗可能已齊備。面板仍顯示綠色開工檢查，造成總提示與階段矛盾；不會繞過 backend 或移轉實物。

建議在開工前優先顯示 `showStart` 的主提示，或使 completion 的主提示只在實際 completionStage 生效。既有維修單／真實處置仍保留並可展示；加上 `INSPECTING + DRAFT/SUBMITTED report` 與 `WAITING_CUSTOMER + existing report` 的 stage precedence regression 測試。此收據不自行修改 repair-owned 程式。

## 接收端契約結果

| 狀態 | 項目 | 固定 SHA 證據與理由 |
| --- | --- | --- |
| PASS | claim ≠ accept | `mailroom.contract.ts:555-588`：claim 只改 nextUserId，accept 才確認本人、位置並移轉 custodian；backend custody 合成測試實際套用 transition。 |
| PASS | 完工交辦後保管仍在技師 | `mailroom.contract.ts:606-631`、`repair-workflow.contract.ts:118-136`；WAITING_RETURN_ACCEPTANCE 尚未收發簽收。新面板 `repair-readiness.ts:157-159` 清楚寫待本人接收且未代表出貨／入庫。 |
| PASS | accept_return 才轉收發本人 | `mailroom.contract.ts:299-306,634-643`：必須 nextUserId 與 actor 一致、確認實物與位置，才改 custodianId。REPAIR 轉 READY_FOR_DISPATCH，RETURN 轉 PENDING_WELFARE_STOCK。 |
| PASS | PENDING_WELFARE_STOCK 已收發接收、尚未正式入庫 | `repair-readiness.ts:160-162` 不再要求重複收發簽收；17 項 readiness 測試有明確此情境，仍要求後续库存负责人點收與正式 IN 回執。 |
| PASS | return_original 不冒充完成 | `repair-workbench.service.ts:289-306` 記 RETURN_UNREPAIRED、WAITING_RETURN_ACCEPTANCE，仍保留技師 custody。新 helper `:43,176-178` 尊重明確 return_original capability，即使舊建議是 REPAIR／REPLACE；不造維修完成紀錄。 |
| PASS | 原廠物流不等於對客寄回 | `repair-readiness.ts:163-172` 分開待安排寄回、原廠接收、返還在途、本人實際收回與取消；能力允許、RETURNED 及相同委修 reference 才能顯示 factory completion readiness。 |
| PASS | 來源旗標 true 不等於完整當版放行 | `repair-readiness.ts:52-86,103-105,138-141` 及新測試逐項核對 CSR、檢修／估價／方案／報價、免費顧客同意、必要款項；新報價、撤款、CSR未回覆、來源失敗均使總 readiness=false。 |
| PASS | false／absent 能力、legacy 缺 CSR 保守顯示 | 原測試與額外合成斷言覆核 editable=false、來源 available=false、repairAllowed=false、缺 CSR、complete_factory 未提供或空陣列，皆 completionReady=false。明確 capability 加當版 returned factory 證據與来源放行才 true。 |
| NO-IMPACT | backend 舊 API gate 與原生寫入 | 本提交沒有 backend／schema／actions payload／request ID／expectedVersion 修改。既有 legacy 開工／完工 API 較寬的問題仍留在共享 backlog；新前端提示不能當作已修正 API guard。 |
| NO-IMPACT | 角色／導航／收發主頁／真實通知 | 本提交未修改上述檔案或操作；panel 沒有 action button，DOM 測試明確斷言。未接觸 receiving development tree 的其他 app 修改。 |
| FAIL / PENDING | Claw knowledge drift | 實跑 17 項 spec，16 PASS／1 FAIL，列出 RepairWorkbenchPage.tsx source hash 漂移，generated/catalog manifest 尚未刷新。新增 helper／panel 也仍待 DOA 加入 sourcePaths 並集中 bilingual review。 |
| PENDING | DEV、正式、現場操作 | 本次只讀固定來源加離線合成測試；沒有部署、整合 SHA 驗證或真實本人搬運、通知、物流、款項及正式庫存驗收。 |

## 實際命令與結果

以下命令全部在固定 SHA review tree 執行。沒有執行 frontend/backend build，因此沒有寫 shared tsBuildInfo cache，也不援引交付方 build 結果作本覆核 PASS。

### 版本與 diff

```sh
git rev-parse HEAD
git status --short
git remote get-url origin
git show -s --format='%H %P %s'
git diff --stat f3f14c4104906cc6ca23bd1d38ba4589563b6801..587b077a59982a436726c02e0c286391e5432ebf
git diff --check f3f14c4104906cc6ca23bd1d38ba4589563b6801..587b077a59982a436726c02e0c286391e5432ebf
```

**PASS**：HEAD／parent／remote 符合指定值；6 個被審檔案；diff --check exit 0；review tree tracked 狀態保持乾淨。

### 前端 readiness 與 affected custody／stock 回執

frontend cwd：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test tests/repair-readiness.test.ts tests/repair-item-custody.test.ts tests/repair-stock-return.test.ts tests/repair-workbench.test.ts
```

**PASS 39/39，exit 0，skip 0**：新 readiness 17、custody 5、stock return 9、workbench 8。Node experimental-loader／fs.Stats 棄用提示不影響測試。

### 真 React 離線 DOM

frontend cwd：

```sh
node --experimental-strip-types --test tests/repair-readiness-dom.test.mjs
```

**PASS 1/1，exit 0，skip 0**：headless 既有 Chromium；12 個合成畫面情境、React文字逃逸、panel 無 action button、外部請求為空、pageerror 為空；1280px／390px 無橫向溢出。只有 localhost fixture；未操作真实 UI 或資料。

測試產出 `/tmp/corely-repair-readiness-20261008-desktop.png`、`/tmp/corely-repair-readiness-20261008-mobile.png`。既有 baseline-browser-mapping 過期提示未透過升级依賴處理。

### Backend pure mock custody

backend cwd：

```sh
./node_modules/.bin/jest --runInBand --no-cache src/modules/mailroom/repair-stock-custody.contract.spec.ts
```

**PASS 28/28，1 suite，exit 0**：只用 transition/functions/Prisma mocks，沒有資料庫 connection；包括 claim→accept→WAITING_RETURN_ACCEPTANCE→accept_return 的实际 custody，以及 LINKED_CASE／UNKNOWN、正式 IN／OUT 關聯與 audience/entity guards。

### 額外合成探針

使用上述同一 `ts-node/esm.mjs` runner 的 `--input-type=module` stdin import `repairReadiness`，沒有新增测试文件：

- **FAIL（邏輯重現成功）**：同一 INSPECTING／當版放行資料，維修單 absent／DRAFT／SUBMITTED 三組，印出 startReady／completionReady／showStart／showCompletion／title／nextStep。只有加入已存 report 就把總提示轉成完工交回；細節見 P2。
- **PASS 7 個斷言**：missing complete_factory、empty complete_factory、editable=false、source unavailable、source denies repair、legacy missing CSR 全部阻擋；明確 complete_factory 與當版 returned factory 證據可顯示條件具備。此為離線補充探針，不加入前述正式測試數量。

### Knowledge read-only spec

repo root cwd：

```sh
node --test scripts/dev/generate-copilot-knowledge.spec.cjs
```

**FAIL 16/17，exit 1**：唯一失敗訊息為：

```text
Knowledge drift: backend/src/modules/ai/knowledge/catalog.generated.ts, backend/src/modules/ai/knowledge/source-manifest.json
Changed reviewed sources: frontend/src/pages/repair/RepairWorkbenchPage.tsx
Review affected guides, then run --write. No files were changed.
```

保留此結果交 DOA；本覆核未執行 generator --write，未刷新共同 knowledge。修復 P2 後須用新的完整 repair SHA 重新覆核 stage precedence 與受影響面板，再在最終整合 SHA 執行集中 knowledge gate。
