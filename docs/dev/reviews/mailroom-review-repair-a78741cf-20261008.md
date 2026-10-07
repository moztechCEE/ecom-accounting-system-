# Mailroom review of repair a78741cf — 2026-10-08

結論：**修订 helper delta 的限定行为 PASS；「DISPATCHED + RETURN_UNREPAIRED 整页不再显示旧退回下一步」仍 FAIL，1 个 P2 已实际 DOM 重现。** 需 repair owner 修正该相邻唯读说明，再送新固定 SHA；本轮没有产品修改。

## 固定 SHA／范围与保护

- Repository：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- 在 own repository `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-20261008` explicit fetch `codex/repair-workbench-20261008`，FETCH_HEAD 核对为 **a78741cf3c18f05ec079c608749e81e08c726d91**。
- 仅审 parent 已验的 **3e2987410b7e25108290700e6ec381d9474209c3 → a78741cf3c18f05ec079c608749e81e08c726d91**；merge-base 正是 3e298741…。
- 新 detached review tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-a78741cf-20261008`。HEAD 为目标完整 SHA，建立与全部测试后 `git status --short` 均空白。未 reset／stash／clean／cherry-pick 任何旧树或开发树。
- 已读当前 AGENTS、新 repair handoff、两份新增固定版本 review receipts。那些文件的旧版本测试／云端叙述仅作来源资料，本收据只列本人本轮实跑证据。
- 精确 delta **6 文件**：repair-readiness.ts（4+/1-）、repair-readiness.test.ts（20+）、repair-readiness-dom.test.mjs（11+/1-）、repair-workbench-handoff-20261008.md（17+/1-）及两份新增 docs/dev/reviews/doa-ad406d84-repair-20261008.md（73 行）、mailroom-dd0b5b44-repair-20261008.md（79 行）。
- Borrowed ignored frontend/backend node_modules symlinks；private runtime/cache：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i`。所有 Vite server 使用 private cache + HMR false，TypeScript build info 也私有，Node TS runner target ES2022。
- 无产品／catalog 修改、commit、deploy、cloud、DB、真实数据／通知／物流／库存／金融操作；没有跨 Codex chat 传讯。仅本指定 coordination receipt 是本轮持久新增文件。独立静态子审查已完成，不留运行中的旧 review 子任务。

建立命令（own repo cwd）：

```sh
git fetch origin codex/repair-workbench-20261008
git rev-parse FETCH_HEAD
git merge-base 3e2987410b7e25108290700e6ec381d9474209c3 a78741cf3c18f05ec079c608749e81e08c726d91
git worktree add --detach '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-a78741cf-20261008' a78741cf3c18f05ec079c608749e81e08c726d91
```

## FAIL / P2 — 完整維修頁仍显示已经过时的收发签收／安排寄回说明

触发条件：实际維修頁收到 `status=DISPATCHED`、`repairWorkflow.release.purpose=RETURN_UNREPAIRED`，即使正确的 `editable=false`、`allowedWorkflowActions=[]`。

新 readiness 显示「已交物流寄回，待顾客收件」；同一完整详情页的 WorkflowPanel 却仍显示：

> 此件按未修原件交回，不標成已修理或已替換，也不以維修完成複驗冒充處理結果。後續由收發室本人簽收並安排原件寄回。

这段未来式下一步与已交物流状态矛盾。保留「未修原件」历史处置合理，但不能仍要求重新签收／安排已经交运的物件。

確切位置（均指固定 review tree）：

- [RepairWorkflowPanel.tsx:69](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-a78741cf-20261008/frontend/src/pages/repair/RepairWorkflowPanel.tsx:69>) 只检查 release.purpose，没有 DISPATCHED／current stage 条件。
- [RepairWorkbenchPage.tsx:223](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-a78741cf-20261008/frontend/src/pages/repair/RepairWorkbenchPage.tsx:223>) 挂新 ReadinessPanel；同页 [RepairWorkbenchPage.tsx:232](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-a78741cf-20261008/frontend/src/pages/repair/RepairWorkbenchPage.tsx:232>) 始终挂 WorkflowPanel，所以两段会同时出现。
- 新作者 DOM case [repair-readiness-dom.test.mjs:47](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-a78741cf-20261008/frontend/tests/repair-readiness-dom.test.mjs:47>) 没设 `release.purpose=RETURN_UNREPAIRED`，且仅渲染 ReadinessPanel，无法覆盖完整详情页旧说明。

**这不是 a787 delta 新引入的旧程式回归。** 它是与本批目标直接相关、修订后仍存在的相邻提示缺口；不能把 helper-only PASS 扩成整页「不显示旧退回说明」PASS。

### 独立实际完整页探针

运行 actual RepairWorkbenchPage、ReadinessPanel、WorkflowPanel、Documents、repair service 和真实 React/router/Ant Design。仅 auth、websocket subscription、API transport 替换为 synthetic offline boundaries；API GET 返回合成资料，所有 business writes 与外网拒绝。

| 原方案 | release.purpose | 新终态指引 | 作业／文书保存提交按钮 | 旧安排寄回说明 |
| --- | --- | --- | --- | --- |
| REPAIR | REPAIRED | 正确 | 0 | 0 |
| REPLACE | REPLACED | 正确 | 0 | 0 |
| FACTORY | FACTORY_REPAIRED | 正确 | 0 | 0 |
| RETURN | RETURN_UNREPAIRED | 正确 | 0 | **1 / FAIL** |
| REPAIR | RETURN_UNREPAIRED | 正确 | 0 | **1 / FAIL** |
| REPLACE | RETURN_UNREPAIRED | 正确 | 0 | **1 / FAIL** |

六例均 business POST/write=0、externalRequests=0、React errors=0、输入资料未被改写。旧 readiness 标题「保留未修原件，依拒修／退回流程交接」均为 0；失败的是另外的实际 WorkflowPanel 下一步文字。探针最后以 **exit 2** 明确报告 outdatedReturnExplanation=FAIL，terminalControls=PASS。

日志／source／截图均在 private runtime：`terminal-page.log`、`terminal-page-probe.mjs`、`terminal-RETURN-RETURN_UNREPAIRED.png` 等。这里没有点击真实操作、保存、通知或改变案件。

建议 repair owner 对 WorkflowPanel 的 RETURN_UNREPAIRED 说明按当前阶段显示，DISPATCHED 保留历史未修处置、改用实际寄出／顾客收件边界；新增完整 Page + release.purpose 的 DOM 回归。无需扩大到 backend、财务、dispatch 命令或 schema。

## PASS — 本批实际验证的正向与只读范围

- `repair-readiness.ts:45-46` 排除 DISPATCHED ownSigned；`:169-171` 的终态分支先于 unsupportedInternal／RETURN／return_original，优先显示承运交接而不推定顾客收到／结案。
- 独立 helper 探针：**4 原方案 × 4 release.purpose × 2 normal/stale ownership/action flag = 32 cases / 256 assertions PASS**。stale variant 为 editable=true、custodian=viewer、allowedWorkflowActions=['return_original']；仍 ownSigned/startReady/completionReady/showStart/showCompletion=false，新 title/nextStep 正确，输入深拷贝完全一致。
- actual full Page 六例均没有再次认领／实物签收／施工／替换／完成交回／原件退回／文书保存提交按钮。原有只读文书与历史保留。此为正常 terminal server action projection，未宣称虚构任意 server grants 也安全。
- 未变更的 Page :199-204、Documents :15-16 / 171-173 排除终态保存／作业；WorkflowPanel :22 仍以 server allowed actions 为依据。backend repair-workflow.contract.ts :285-289 对 DISPATCHED 不给常规 workflow actions；本 delta 未改变这个 gate。
- 受影响单元 **58/58 PASS**：readiness 20 + 原 repair/workbench/stock/custody/navigation 26 + Source launch 12。
- 实际 React/Chromium 既有 DOM **2/2 PASS**：readiness panel 与 hook feedback。这里的作者测试 PASS 不覆盖上述完整 Page 的失败情境。
- frontend app/node typecheck PASS；3 改动 source/test 文件 ESLint **0 errors / 0 warnings**，exit 0；fixed diff check PASS。保留 library browser-data 过期诊断，没有升级依赖。

## 精确实跑命令

以下 cwd 均为 `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-a78741cf-20261008/frontend`。临时 loaders 不改产品／测试断言：Vite wrapper 只强制 private per-process cache/HMR false；Node env loader 仅在 Node frontend source module 注入空 `import.meta.env`，匹配未配置的 Vite env。自建 TS probe 在 /tmp 外部起初缺 ESM package boundary 而 ERR_REQUIRE_CYCLE_MODULE，添加 private `package.json: {"type":"module"}` 后 PASS；此为 runner setup，不列产品 FAIL。

单元（58/58，504.201084 ms）：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --loader '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i/node-vite-env.mjs' --experimental-specifier-resolution=node --test tests/repair-readiness.test.ts tests/repair-workbench.test.ts tests/repair-stock-return.test.ts tests/repair-item-custody.test.ts tests/repair-navigation.test.ts tests/repair-after-sales-launch.test.ts
```

作者实际 DOM（2/2，7334.737791 ms）：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --import '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i/isolated-vite.mjs' --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/repair-readiness-dom.test.mjs tests/repair-feedback-dom.test.mjs
```

独立 helper 32-case／256-assertion probe（PASS）与 full Page 6-case probe（terminal PASS、old explanation FAIL）：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --loader '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i/node-vite-env.mjs' --experimental-specifier-resolution=node '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i/terminal-guidance-probe.ts'
REVIEW_FRONTEND='/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-repair-a78741cf-20261008/frontend' REVIEW_CACHE='/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i' node '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i/terminal-page-probe.mjs'
```

Types／lint：

```sh
node_modules/.bin/tsc -p tsconfig.app.json --noEmit --incremental --tsBuildInfoFile '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i/tsconfig-app.tsbuildinfo'
node_modules/.bin/tsc -p tsconfig.node.json --noEmit --incremental --tsBuildInfoFile '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-repair-a78741cf-pnvdhp9i/tsconfig-node.tsbuildinfo'
node_modules/.bin/eslint src/pages/repair/repair-readiness.ts tests/repair-readiness.test.ts tests/repair-readiness-dom.test.mjs
```

Review tree root：

```sh
git diff --check 3e2987410b7e25108290700e6ec381d9474209c3 a78741cf3c18f05ec079c608749e81e08c726d91
git diff --name-only 3e2987410b7e25108290700e6ec381d9474209c3 a78741cf3c18f05ec079c608749e81e08c726d91 -- backend frontend/src/pages/mailroom frontend/src/services frontend/src/pages/repair/repair-model.ts frontend/src/pages/repair/RepairWorkbenchPage.tsx frontend/src/pages/repair/RepairWorkflowPanel.tsx frontend/src/pages/repair/RepairDocuments.tsx
git status --short
```

后三项结果依序 fixed diff PASS、scoped delta 空白、tracked status 空白。

## NO-IMPACT／PENDING

- backend／mailroom／services／repair model／原 Page／Documents／WorkflowPanel 在此 3e→a787 delta 全无修改；无 DTO、finance、dispatch命令、状态写入、库存、通知、API、schema/migration 改动。
- Base/target schema blob 同为 `3b9987b168cbcb2499a6f356169cb5310c292132`；mailroom.service blob 同为 `a9e544951ef8548a85d5390e6f3543abb66d4155`；WorkflowPanel blob 同为 `4330e71979858b8a41622619df07c59b67f0c00e`。
- 已核对当前 helper SHA256：`4108c5bfe4615dd1b335ac5a3ac8cf88af1d469d4d340d85747df4b71d586968`，与新 handoff 相同。
- **Knowledge PENDING / 本轮未运行 generator 或写 catalog**：依 owner 指定交 DOA 最后集中双语内容、sourcePaths/hashes 与 coverage/drift 验证；不能将 typecheck 或 helper 测试当知识验收。
- P2 旧说明需新 fixed SHA 重审。最终 merged SHA 的 DISPATCHED/outbound/CUSTOMER_CARRIER、公司 context、严格 confirmedItems HTTP、收发草稿守门与 Source compatibility hold 也须分别整合验收；不把此 helper review 代签 backend/其他台。
- 未验真实 Source/AI dispatch consumer、DEV、DB并发、实物、顾客收到／结案、付款退款、正式库存或通知。本轮不产生此类外部副作用。
