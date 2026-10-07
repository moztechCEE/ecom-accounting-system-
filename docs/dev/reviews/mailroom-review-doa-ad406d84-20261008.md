# Mailroom receiving review of fixed DOA integration SHA — 2026-10-08

審查結論：**FAIL / 有 1 個已實際重現的 P2 公司上下文缺陷**。其他本次限定回歸檢查 PASS。這不是「整個整合版無條件可接受」的收據；DOA 應處理下述公司錯置，再以新的固定 SHA 回審。

## 固定版本與操作邊界

- Repository：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-20261008`。
- Remote：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- 指定 ref：`codex/aftersales-workflow-20261005`，read-only fetch 後 FETCH_HEAD 與 detached review HEAD 均為 **ad406d84679bb7b1a54f08bc4df35aa73fc765c3**。
- 比對 base／merge-base：**f3f14c4104906cc6ca23bd1d38ba4589563b6801**。
- 新 detached review tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-doa-ad406d84-20261008`。未 reset、checkout 或修改原 mailroom／其他同事產品工作樹。
- 已讀此 SHA 的 `AGENTS.md`、`docs/dev/doa-workbench-handoff-20261008.md`，並由另一路獨立靜態審查核對導覽／公司／權限／草稿。
- 審查開始與所有測試後 `git status --short` 均空白；只借 ignored dependency symlinks。測試 runtime、Vite cache、tsBuildInfoFile 全在 private temporary directory，HMR false；沒有修改 tracked 產品與測試檔案。
- 沒有雲端、DB、部署、真實公司／案件／通知／出貨／同步操作；沒有跨 Codex chat 發送訊息。API boundary、auth、Source iframe 均使用 synthetic offline fixtures。僅此 coordination receipt 是本輪持久新增文件。
- Private runtime：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr`。

建立／核對命令（cwd 為原 mailroom tree）：

```sh
git fetch origin codex/aftersales-workflow-20261005
git rev-parse FETCH_HEAD
git merge-base f3f14c4104906cc6ca23bd1d38ba4589563b6801 ad406d84679bb7b1a54f08bc4df35aa73fc765c3
git worktree add --detach '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-doa-ad406d84-20261008' ad406d84679bb7b1a54f08bc4df35aa73fc765c3
```

## FAIL — P2：工作區保留網址公司 B，營運管理／原生儲運卻向公司 A 讀取

觸發条件：兼任／管理帳號具可切換 `all` 或 `warehouse` 的資格，`localStorage.entityId=A`，目前收发 deep link 為 `/operations/mailroom?entityId=B`，且 A 與 B 不同。

1. 在實際 `DashboardLayout` 的「工作區」selector 選「營運管理」。
2. URL 變成 `/dashboard?entityId=B`，但實際 `DashboardPage` → 原生 service adapters → API boundary 的讀取目標仍為 A。
3. 同一初始條件選「儲運工作台」，URL 為 `/warehouse?entityId=B`，實際 station／management read 的 `params.entityId` 仍為 A。
4. 使用者依 B 的 deep link 工作，頁面讀取與可用操作卻會依已儲存的 A 取值。後端授權沒有在本輪被繞過；本缺陷是授權公司間的目標錯置。

### 已完成的實際 DOM 重現

以實際 `DashboardLayout.tsx`、`DashboardPage.tsx`、`WarehouseCenterPage.tsx`、原生 `entities.service.ts`／`dashboard.service.ts`，在真 React + memory data router + 已安裝 Chromium 執行。只有 auth 與 `api` transport boundary、與證明無關的 layout widgets 被 mock。沒有把 selector 或目標頁的公司處理邏輯改成 fixture 邏輯。

Probe 使用 synthetic SUPER_ADMIN（可合法選取兩工作區），每次重新載入時 stored A + 收發 query B。實際鍵盤打開 Ant Design Select 並點選 option。下列是實際捕獲資料的必要欄位；Dashboard 原始 GET 另帶日期與 `_ts`：

```json
{
  "label": "營運管理",
  "route": "/dashboard?entityId=synthetic-company-b",
  "stored": "synthetic-company-a",
  "apiBoundaryGET": "/reports/dashboard-sales-overview?entityId=synthetic-company-a",
  "dashboardReadCallsCaptured": 13,
  "externalRequests": 0,
  "reactErrors": 0
}
{
  "label": "儲運工作台",
  "route": "/warehouse?entityId=synthetic-company-b",
  "stored": "synthetic-company-a",
  "calls": [
    {"method": "GET", "path": "/wms/workbench/management/overview", "params": {"entityId": "synthetic-company-a", "search": "", "pickPage": 1, "packPage": 1}},
    {"method": "GET", "path": "/wms/workbench/stations", "params": {"entityId": "synthetic-company-a"}}
  ],
  "externalRequests": 0,
  "reactErrors": 0
}
```

Probe exit 0 表示兩條路徑均捕獲並斷言出 **A/B 錯置**，不是對產品正確性的 PASS。所有外網／非本地 origin 路由拒絕；`api.post/put/delete` 一律拋錯。實際讀取是 service→mock API boundary，沒有送到任何業務後端。

Exact probe command：

```sh
REVIEW_FRONTEND='/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-doa-ad406d84-20261008/frontend' REVIEW_CACHE='/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr' node '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/company-context-dom.mjs'
```

暫存 probe 源與原始 log：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/company-context-dom.mjs`、`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/company-context-dom.log`。Vite 明確配置 private cache、`server.hmr=false`，只聽 127.0.0.1。

### 確切 source call proof

以下相對路徑與行號均指固定 review tree 的 ad406d84：

- `frontend/src/components/DashboardLayout.tsx:95`：`navigate(operationsWorkspaceDestination(value, location.search))`。
- `frontend/src/config/workspaces.ts:19-21`：對包括 `all`／`warehouse` 在內的 destination 保留 query 的 `entityId`。
- `frontend/src/pages/DashboardPage.tsx:337` 只讀 `localStorage.entityId`；`:347` 將這個 A 傳給 `resolveEntityId`；`:384-398` 用 A 呼叫 sales／executive／operations services。
- `frontend/src/services/entities.service.ts:71-76`：明確傳入 A 直接返回 A，不會讀 URL B。
- `frontend/src/services/dashboard.service.ts:599-610`：把 A 寫入 `/reports/dashboard-sales-overview` query。本次 DOM 已驗證實際 boundary GET。
- `frontend/src/pages/WarehouseCenterPage.tsx:21-22` 用 `useEntityContext()`；`frontend/src/hooks/useEntityContext.ts:3-14` 只從 storage/focus 讀 A，沒有 URL query；`WarehouseCenterPage.tsx:38` station read 送 A。本次 DOM 同時捕獲 management overview 送 A。
- `frontend/src/pages/DashboardPage.tsx:589-627` 的「手動同步」亦只讀 stored A，傳給 Shopify／1Shop／Shopline 同步。**這一項僅 source proof，未點擊、未執行任何同步／寫入**。

DashboardPage、WarehouseCenterPage、useEntityContext 都是基底既有程式，這個 SHA 沒修改它們；但本批新增 selector destination 的公司 query 保留宣稱，必須與既有目標頁的公司取值共同成立。測試只驗證 helper 產生 `?entityId=B` 無法證明目標頁真的使用 B。

建議 DOA 以一致的 query-first 公司 context 修正 selector 目標頁，確保切換／登入偏好使用的公司、資料讀取公司及使用者可用動作公司一致。修正應在 DOA owner tree 進行，並新增此 stored A/query B 的實際目標讀取回歸測試；本審查沒有修產品。

## PASS — 限定收發／售後整合回歸

- 售後／收發／維修工作台直接互切，helper 保留 explicit company query；個人待辦、費用、請假、出勤、本人薪資仍出現在對應授權個人導覽。工作區偏好以 user/company key 儲存，未知／已撤銷選項重新驗證；強制改密碼優先。來源：`workspaces.ts:35-80`、`login-destination.ts`、`DashboardLayout.tsx:44-51,98-103`，106-test 回歸含相關 unit。
- Hub 的六個案件入口沿用原 Source form path；invoices/accounting 檢查各自 read grants。SELF／DEPARTMENT／一般 ADMIN+SELF 不會因前端身份名稱取得公司 Source launch。真 React DOM 驗證不授權／integration disabled 不發 synthetic launch。
- `AfterSalesModulePage.tsx:25,49-60` 使用 query-first entity，在 launch 前檢查 feature、company、section grants；`:118-123` Hub navigation 保留公司並僅在 workbench/cases 延續 intakeItemId。
- Native repair／intake tabs `forceRender`、分開 dirty flags；overview 開合不卸載 native drafts。Overview、外頁／Back、same-path 新 intake deep link 的 dirty confirm 均由真 React/router/modal DOM 驗證；cancel 保留、confirm 才切換新 intake。來源：`AfterSalesModulePage.tsx:35-39,124-138`。DOM 的 native queue 邊界是 synthetic draft queue，沒有聲稱完整 native 業務提交已驗收。
- `AfterSalesModulePage.tsx:134` 明示沿用新增案件、回同一原收件綁定；不推定案件已建、實物交接／通知完成。收發 intake helper／source search 單元回歸 PASS。
- 修復導覽／readiness DOM 檢查 customer consent、payment、CSR、QC、physical handoff 的 pending／completed 分離，hook modal/message holders 在 remount 後仍正常。
- 知識檢查與 frontend app/node typecheck PASS，cache 均私有。

### 本轮實跑命令與結果

cwd：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-review-doa-ad406d84-20261008/frontend`。

純函式／導覽／收發／維修回歸：**106/106 PASS，0 failed/skipped/cancelled**，763.629708 ms：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --loader '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/node-vite-env.mjs' --experimental-specifier-resolution=node --test tests/employee-workspaces.test.ts tests/navigation.test.ts tests/repair-navigation.test.ts tests/after-sales-workbench.test.ts tests/after-sales-hub.test.ts tests/repair-workbench.test.ts tests/repair-stock-return.test.ts tests/repair-item-custody.test.ts tests/repair-readiness.test.ts tests/repair-after-sales-launch.test.ts tests/mailroom-intake.test.ts tests/mailroom-source-search.test.ts tests/after-sales-logout.test.ts
```

Bare Node 首輪因 Vite 的 `import.meta.env` 在 Node 不存在而失敗；此為 runner setup 邊界，**不列產品 FAIL**。第二輪使用 private temporary ESM load hook，在 ts-node 完成 transpile 後僅對 review frontend src module 前置 `import.meta.env ??= {};`，模擬未設定的 Vite feature environment；沒有更改 assertions 或 source files。最終 log：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/pure-tests.log`。

真 React／Chromium DOM：**10/10 PASS，0 failed/skipped/cancelled**，26101.045292 ms：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --import '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/isolated-vite.mjs' --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/after-sales-module-dom.test.ts tests/repair-readiness-dom.test.mjs tests/repair-feedback-dom.test.mjs
```

temporary Vite preloader 包装 actual `createServer`，使用 `/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/vite/<process.pid>` 為 cacheDir，强制 `server.hmr=false`。DOM 測試 source／assertions 不變；外部 Source ticket/frame 與 APIs 僅 synthetic。

Frontend typecheck：**app PASS / node PASS，exit 0**，每份 tsBuildInfoFile 明確導到私有目錄：

```sh
node_modules/.bin/tsc -p tsconfig.app.json --noEmit --incremental --tsBuildInfoFile '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/tsconfig-app.tsbuildinfo'
node_modules/.bin/tsc -p tsconfig.node.json --noEmit --incremental --tsBuildInfoFile '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-review-ad406d84-4y4aymsr/tsconfig-node.tsbuildinfo'
```

cwd 為 detached review tree root：

```sh
node scripts/dev/generate-copilot-knowledge.cjs --check
node --test scripts/dev/generate-copilot-knowledge.spec.cjs scripts/dev/mailroom-intake-knowledge.spec.cjs
```

結果：coverage/drift **PASS** — 79 bilingual guides、12 groups、103 routes、198 source hashes，original 24 retained with documented corrections；spec **20/20 PASS**（generator 17 + mailroom intake 3）。未用 generate write mode。

## PASS / NO-IMPACT — 共用 backend／schema／收發模型及 dispatch

`git diff --name-only base target` 的 backend delta 僅 AI knowledge 的 catalog.generated.ts、catalog.source.json、source-manifest.json；沒有 mailroom command DTO/service/contracts、Prisma schema/migration、physical custody 或 inventory writes 的變動。

下列 scoped diff 完全空白：

```sh
git diff --name-only f3f14c4104906cc6ca23bd1d38ba4589563b6801 ad406d84679bb7b1a54f08bc4df35aa73fc765c3 -- backend/src/modules/mailroom backend/prisma frontend/src/pages/mailroom/model.ts frontend/src/pages/mailroom/MailroomPage.tsx frontend/src/pages/mailroom/TabletAcceptance.tsx frontend/src/pages/mailroom/SourceCasePicker.tsx frontend/src/services/mailroom-intake.ts
```

固定 base／target 相同 Git blobs：

| Path | Blob（兩 SHA 相同） |
| --- | --- |
| backend/prisma/schema.prisma | 3b9987b168cbcb2499a6f356169cb5310c292132 |
| backend/src/modules/mailroom/mailroom.dto.ts | 774f46c76abaf12f8f93e615c4bdff0ff3af6f1c |
| backend/src/modules/mailroom/mailroom.service.ts | a9e544951ef8548a85d5390e6f3543abb66d4155 |
| frontend/src/pages/mailroom/model.ts | 1097f14d5fb65ab4d977ec366fa0783e4823236b |

Root 的新 dispatch／outboundShipment／CUSTOMER_CARRIER batch **不包含在 ad406d84**。因此此 DOA delta 对 dispatch 记录、源兼容 HOLD、发货校验与移交没有产品改动（NO-IMPACT）；不能将此收据当作新 dispatch 功能或合并后端的验收。

## PENDING / 基底既有边界

- P2 公司错置尚未修正；需要 DOA owner 的新固定 SHA 与 stored A/query B 目标页回归结果。
- Sidebar、command palette、InboxShortcut 导航会丢 explicit company query，header inbox badge 仅读 saved entity。经 base diff 核对不是本批新增，作为既有边界记录；限定直接 selector／Hub PASS 不能解释为所有导航都保留公司。
- 真 DEV 的登录／SSO ticket、员工公司／部门范围、真实 Source 新案后绑定同一收件、本人签收与通知、源端 dirty form 事件、实物交接／技术人员／库存／支付／退款／客户物流端到端验收均未进行。
- Native intake/repair 完整业务 form 的实际保存不在 mock queue DOM 范围内；本轮仅对应 helpers 单元、真正 Module/Hub/router/tabs/modal 的 DOM。
- 未部署、未改迁移、未操作真数据；没有以本地 PASS 代替 DEV/production/physical acceptance。
