# 維修接收端對 DOA 公司與導航修訂的固定版本審查

2026-10-08。送出 DOA `01a0f8f7-a9b6-7172-a28a-aafc8b6e8be2`；接收維修 `01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`。

## 固定版本及範圍

- Repo `https://github.com/moztechCEE/ecom-accounting-system-.git`；ref `codex/aftersales-workflow-20261005`。
- 前次被審 `ad406d84679bb7b1a54f08bc4df35aa73fc765c3`；本次 `0c4eacb04511d00678f0b342871dbd1c886680ec`，ad..0c 共22檔，含公司修訂、已審維修 a787 的 cherry-pick 2136a673 及集中 knowledge。
- 本視窗 explicit fetch、remote ref 及 ls-remote 核對完整 SHA，獨立 detached tree `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-doa-0c4eacb0-20261008`；建立與測後 tracked clean。既有依賴 symlink、probe 在 /tmp；沒有覆寫任何其他視窗或自己的未提交開發內容。
- 已讀 AGENTS、handoff 及 Claw 差異。a787 所有維修 source/tests 在本次固定版本 byte-identical；shared mailroom/repair service、API與Prisma schema相對 f3 未變。

## 結果：公司與導航修訂 PASS_SCOPE

前次 ad 三個公司／入口 P2 的本次對應修訂通過以下獨立驗證；保留 ad 原 FAIL 歷史。

| 實跑或對照 | 結果 |
| --- | --- |
| 實際 Layout、Ant Select/Menu、CommandPalette probe | 3/3：有儲運管理 grant 選儲運到 `/warehouse/workstation?entityId=B`，選單為儲運、預設存 warehouse；維修側欄與 Ctrl+K 個人入口保留 B。storage A 未改、foreign request及React error皆0。 |
| employee-workspaces / navigation / repair-navigation pure | 26/26（7+15+4）；環境 loader 僅注入 Vite env。 |
| 實際 Dashboard/Layout/CommandPalette/useEntityContext DOM | 6/6（父＋5子）；URL B 立即優先、storage fallback、公司切換與晚到 response 隔離、13個GET與manual sync皆同公司。業務 widgets/auth/API為合成替身，不是真實帳務。 |
| 獨立 helper/API契約 probe | 24斷言：公司及目的地參數保留、偏好依公司/帳號、撤權及強制改密碼、預設與切台目的地一致。API與全域公司寫入皆0。 |
| 集中 knowledge readonly check | PASS：79 bilingual guides、103 routes、200 source hashes。 |
| knowledge generation/drift與mailroom intake specs | 20/20 PASS（17+3）。 |
| 完整 frontend build與ad..0c diff check | PASS；保留既有瀏覽器資料及bundle警告，沒有升級依賴。 |

實作核對：useEntityContext 即時優先 URL 公司、不回寫 global storage；Dashboard 按公司 keyed mount，GET、manual sync採同context，切公司後舊 response 不回填；Layout/CommandPalette保留 explicit公司及目的地query/hash；儲運選台與登入預設共用目的地。沒有發現此修訂新 P1/P2。

## 未簽完整共同批通過

- 本次 fixed SHA 還未含收發 dd 的 DTO、草稿保護、RecipientPicker busy 修訂；不把該批前次 FAIL 轉成 PASS。
- 收發另以完整維修 Page 發現 a787 殘留拒修提示 P2；root認領 WorkflowPanel 修正並加實際整頁回歸。本次a787同碼仍有该提示，故公司修訂 PASS_SCOPE 不代表全案發布通過。
- Claw repair guide 已有 DISPATCHED steps，尚缺待 Source/AI 相容、舊 ACK 不等於寄出 ACK、DISPATCHED records 隊列未含的雙語 boundary。已送 DOA，由維修 handoff 提供確切內容；hash check PASS 不替代語意審查。
- 未覆蓋每個既有 useEntityContext caller、已送出舊公司 sync 的實際取消、Source 真session、薪資、銀行、發票、通知或庫存；最後整合 SHA、DEV UI/流程與營運尚待驗證。沒有部署、DB或外部业务操作。

## 重跑

reviewtree frontend cwd：

```sh
node --test tests/workspace-company-dom.test.mjs
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext"}' node --loader ../backend/node_modules/ts-node/esm.mjs --loader /tmp/corely-doa-review-env-loader-20261008.mjs --experimental-specifier-resolution=node --test tests/employee-workspaces.test.ts tests/navigation.test.ts tests/repair-navigation.test.ts
node /tmp/corely-doa-layout-probe-0c4eacb0-20261008.mjs
node /tmp/doa-company-0c-probe.cjs
npm run build
```

repo root：

```sh
node scripts/dev/generate-copilot-knowledge.cjs --check
node --test scripts/dev/generate-copilot-knowledge.spec.cjs scripts/dev/mailroom-intake-knowledge.spec.cjs
git diff --check ad406d84679bb7b1a54f08bc4df35aa73fc765c3 0c4eacb04511d00678f0b342871dbd1c886680ec
```

獨立 probe 路徑为接收端本機審查產物，不當成產品倉库可移植 tests；共享的6 DOM及20 knowledge specs随DOA fixed commit保存。Source固定20f不在本修訂；最終共同發布由DOA交三台重審。
