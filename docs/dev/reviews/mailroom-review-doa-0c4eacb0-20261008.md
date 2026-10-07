# 收發室對 DOA 公司修訂固定 SHA 複核 — 2026-10-08

本輪判定：**SCOPE_PASS**。舊 ad406d84 公司 A/B 錯置 P2 在本輪固定版本的實際 Dashboard、原生 WarehouseCenterPage 與導覽操作中已無法重現；新增公司切換、錯誤與晚回應隔離測試通過。此收據只簽下述公司／導覽修訂及限定回歸，**不代替三工作台最後合併 SHA、DEV、Source、AI、實物簽收或金融驗收**。舊 FAIL 收据保留，不改寫歷史結果。

## 固定版本、隔離與操作邊界

- Remote：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- 指定 ref：`codex/aftersales-workflow-20261005`。named fetch 後 FETCH_HEAD 與新 detached HEAD 均為 **0c4eacb04511d00678f0b342871dbd1c886680ec**。
- 前次已審版本：**ad406d84679bb7b1a54f08bc4df35aa73fc765c3**；最初 shared base：**f3f14c4104906cc6ca23bd1d38ba4589563b6801**。
- 新審查工作樹：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-doa-0c4eacb0-20261008`。
- 已讀此 SHA 的 `AGENTS.md`、`docs/dev/doa-workbench-handoff-20261008.md`、`docs/dev/reviews/doa-company-20261008.md`，並独立閱讀六個 company/navigation production delta。
- 沒有 reset 舊 review tree；沒有修改正在編輯的 mailroom 工作樹、DOA、維修或 Source。僅在 detached tree 加 ignored node_modules symlinks，私有 cache 與 tsBuildInfoFile 在下述 temp directory。
- 審查開始、typecheck、所有測試及 scoped diff 後 `git status --short` 均空白，`git diff --check ad406d84 HEAD` exit 0。
- 沒有雲端、DB、實際業務 API、真通知、出貨、退款、付款、庫存、部署、commit 或跨 chat 訊息操作。所有 API transport 為 synthetic boundary，外網請求皆阻擋。
- 唯一持久寫入為本 coordination receipt；runtime 為 `/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-0c4eacb0-qhqyi5gp`。

建立命令（cwd 為 own mailroom tree）：

```sh
git fetch origin codex/aftersales-workflow-20261005
git rev-parse FETCH_HEAD
git worktree add --detach '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-doa-0c4eacb0-20261008' 0c4eacb04511d00678f0b342871dbd1c886680ec
```

## PASS — 獨立實際 native page／service 邊界重測

沿用前次真正反例 probe 的 React/Chromium/Vite 結構，**改成驗證公司 B 及實際 App 對 workstation 的 props**，而不是只比 helper 或以替身頁推定原生 API 正確。

本輪私有 `company-context-dom.mjs` 使用真 `DashboardLayout.tsx`、`DashboardPage.tsx`、`WarehouseCenterPage.tsx`、`WarehouseOverview.tsx`、`CommandPalette.tsx`、原生 entities/dashboard services 與 React memory data router。只有 auth、API transport 和無關 widgets 受控。API POST/PUT/DELETE 皆拒絕；GET 保留真 service 所產生的完整 path/params 後回傳 synthetic failure/empty station。所有非 local origin 拒絕，沒有對業務後端送請求。Vite cache 私有，`server.hmr=false`。

條件：storage 保存 `synthetic-company-a`；收發起始網址帶 `?entityId=synthetic-company-b`。以實際 Ant Design selector 選取工作台。

| 本輪實際操作 | 捕獲結果 | 結論 |
| --- | --- | --- |
| 選「營運管理」 | route `/dashboard?entityId=synthetic-company-b`，Dashboard 13 個 GET 全為 B；原 storage 仍為 A。 | PASS，關閉舊 A/B read 錯置 |
| 在真 sidebar 點個人資料，再用真 CommandPalette 點營運總覽 | profile/dashboard 路由都保留 B；第二次 Dashboard load 使全程累計 26 GET，全部 B。 | PASS |
| 管理者選「儲運工作台」 | route `/warehouse/workstation?entityId=synthetic-company-b`；真 WarehouseCenterPage `workstationOnly=true`，GET `/wms/workbench/stations` params B；沒有管理 overview GET；selector 仍顯「儲運工作台」。 | PASS，切入真正工作站 |
| 由同實際 router 打開原 `/warehouse?entityId=B` 管理總覽 | 真 WarehouseOverview GET `/wms/workbench/management/overview` params B，station GET 亦 B。 | PASS，原 native manager read 同公司 |
| synthetic EMPLOYEE 僅 mailroom:read/profile_self:read | 不出現工作區選擇器，sidebar／功能搜尋只有收發與個人授權入口；沒有維修、儲運、營運或售後工作台選項；API calls 空白。 | PASS，未增 grant |

各 page `reactErrors=0`、`externalRequests=0`；stored company A 沒有被 query B 改寫。此 probe exit 0 是正確性 assertions 通過；前次 ad probe exit 0 則是錯置反例重現，两者不混称。

命令：

```sh
REVIEW_FRONTEND='/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-doa-0c4eacb0-20261008/frontend' REVIEW_CACHE='/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-0c4eacb0-qhqyi5gp' node '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-0c4eacb0-qhqyi5gp/company-context-dom.mjs'
```

原始結果：同 private directory 的 `company-context-final.log`。本輪先驗 query-first 的中間 probe 曾仍把 workstation route render 為 overview（没有跟 App 傳 workstationOnly），该 log 不作为工作站 props 的驗收；最終上述 probe 已用正确 App props 並明確斷言沒有 management overview。產品檔未改。

## PASS — 新公司 snapshot／晚回應 actual DOM 回歸

在固定 SHA 原有 `frontend/tests/workspace-company-dom.test.mjs` 重新實跑 **6/6 PASS**（5 個子情境 + 父測試，0 failed/skipped/cancelled，6896.14 ms）。使用真 Dashboard/Services/Layout/CommandPalette/hook，Warehouse hook 的独立情境是 output probe；已另外以上述 native page 補驗，沒有把 hook output 冒充 Warehouse 業務頁。

- query B/storage A：13 個 initial dashboard GET 均 B。三個使用者同步控制發出的 9+2+1 POST 全記在 mock API boundary，均 B，沒有真實同步。此項只驗 controller/service 參數與日期，不是金融或 provider 操作驗收。
- A→B query 變更時，B 尚未回應就移除 A 的數字；部分 B 讀取失敗不回退 A；C 核心資料全失敗亦不保留 A/B 數字。
- A 的晚回應不會覆蓋新的 B dashboard。
- hook 對 B→C query、focus、移除 query 的 storage fallback 立即反應；顯式公司不被 storage 覆蓋。
- 管理者切工作站、sidebar、CommandPalette 都保留 B；原 storage A 保留。

cwd：detached review `frontend`：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --import '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-0c4eacb0-qhqyi5gp/isolated-vite.mjs' --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/workspace-company-dom.test.mjs
```

private preloader 强制 Vite 的 cacheDir 为 own temp、hmr=false；没有改测试 assertions 或 tracked source。log：`company-suite.log`。

## PASS — 限定 pure、型別與知識回歸

cwd 同 review frontend：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --loader '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-0c4eacb0-qhqyi5gp/node-vite-env.mjs' --experimental-specifier-resolution=node --test tests/employee-workspaces.test.ts tests/navigation.test.ts tests/repair-navigation.test.ts tests/after-sales-workbench.test.ts tests/after-sales-hub.test.ts tests/mailroom-intake.test.ts tests/mailroom-source-search.test.ts tests/after-sales-logout.test.ts
node_modules/.bin/tsc -p tsconfig.app.json --noEmit --incremental --tsBuildInfoFile '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-0c4eacb0-qhqyi5gp/tsconfig-app.tsbuildinfo'
node_modules/.bin/tsc -p tsconfig.node.json --noEmit --incremental --tsBuildInfoFile '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-0c4eacb0-qhqyi5gp/tsconfig-node.tsbuildinfo'
```

結果：**54/54 pure PASS**，0 failed/skipped/cancelled，592.001041 ms；app/node TypeScript 各 exit 0。Node-vite-env loader 僅補未設定 Vite env 的 Node runner，source 不改。没有借用旧 106 tests 数字，也没有在此签维修寄回方案适配。

cwd 同 review root：

```sh
node scripts/dev/generate-copilot-knowledge.cjs --check
node --test scripts/dev/generate-copilot-knowledge.spec.cjs scripts/dev/mailroom-intake-knowledge.spec.cjs
```

結果：**check PASS** — 79 bilingual guides、12 groups、103 routes、**200 source hashes**；spec **20/20 PASS**，0 failed/skipped/cancelled，2709.267334 ms。没有 generate write。这是固定 0c4 的 central catalog 状态，**尚未包含 root mailroom dispatch/draft 后续合并的新来源，不能继承为最后合并 SHA 知识通过**。

Baseline/browser-data、experimental loader 及 fs.Stats dependency warnings 留在 log，没有升级 dependency。

## PASS / NO-IMPACT — 共用收发接口、schema 与 dispatch base

下列 ad→0c4 scoped diff 为空：

```sh
git diff --name-only ad406d84679bb7b1a54f08bc4df35aa73fc765c3 HEAD -- backend/src/modules/mailroom backend/prisma frontend/src/pages/mailroom frontend/src/services/mailroom-intake.ts
```

| Path | ad / 0c4 相同 blob |
| --- | --- |
| backend/prisma/schema.prisma | 3b9987b168cbcb2499a6f356169cb5310c292132 |
| backend/src/modules/mailroom/mailroom.dto.ts | 774f46c76abaf12f8f93e615c4bdff0ff3af6f1c |
| backend/src/modules/mailroom/mailroom.service.ts | a9e544951ef8548a85d5390e6f3543abb66d4155 |
| frontend/src/pages/mailroom/model.ts | 1097f14d5fb65ab4d977ec366fa0783e4823236b |

前次已证明这些 ad blobs 与 f3 base 相同。本轮因此不改变 mailroom shared command/schema/模型；root dd dispatch＋后续 P2 修订未纳入 0c4。这里只证明新 DOA company delta 没有覆盖 root 接口，**没有签署未合并 dispatch API、草稿、busy recipient 或真实 JSON confirmation**。

## 源码支持与审查限制

- `frontend/src/hooks/useEntityContext.ts:9-22` 在 render 读 query first；storage/focus 只更新 fallback，卸载清监听。
- `frontend/src/pages/DashboardPage.tsx:276-282` keyed company snapshot；`:344`、`:596`、`:705`、`:741` 分别统一 initial reads/三项手动控制公司。effect cleanup 的 ignore 挡旧 mount 晚响应。
- `frontend/src/config/workspaces.ts:19-29` 保留目标自己的公司/query/hash，管理者使用 workstation；login preference 走同 destination helper，不新增 grants。
- `frontend/src/components/DashboardLayout.tsx:82,95,141` 与 `CommandPalette.tsx:34` 对 internal navigation 保留 explicit company。
- 非此次新增的 InboxShortcut/通知内部导航和其他 useEntityContext caller 未逐页全面验收；本批没有宣称所有全站入口已正确保留公司。
- 修订包含维修 a787 cherry-pick，本作者未在此签署其 full RETURN_UNREPAIRED panel 行为；由指定独立维修 delta review 处理。
- 后端公司/部门/人员授权、真实 Source SSO、新案绑定、AI receiver/ACK、现场平板签收、正式库存与 financial/provider 均须各自验收。
- 本轮未 build/deploy，只完成上述 typecheck/DOM/unit/knowledge 静态验证；不能以它们替代 DEV image/revision/traffic 或真实操作证明。
