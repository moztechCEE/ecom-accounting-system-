# DOA UI 6ad7dbd1 收發視窗獨立接收回執

2026-10-08（Asia/Taipei）。結論：**PASS_SCOPE，可接收固定介面批；中央知識與最後 DEV 整合仍待完成。** 沒有新增 P1／P2 證據。本回執只涵蓋八檔介面 delta，不將程式／離線測試接收稱為 Source、DEV 或營運驗收。

## 固定來源與實際範圍

- Origin `https://github.com/moztechCEE/ecom-accounting-system-.git`。从收發 owned repo named fetch `refs/heads/codex/doa-ui-cleanup-20261008`；FETCH_HEAD／ls-remote 均精確 **`6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1`**。
- Base `264352c5b863d9928a36ab2a9dbecc697f35a028`。精確八檔：五 runtime（Hub、model、DOA-owned CustomerIntakeQueue、Module、Layout）、兩既有 DOM tests及 `docs/dev/doa-ui-cleanup-handoff-20261008.md`。没有新增 API、CRUD、enum、角色或 schema。
- 全新 detached tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-review-doa-ui-6ad7dbd1-20261008`。開始／結束 HEAD 相同，status clean。僅建立 ignored node_modules symlink與 private review files，没有修改 Root 正在9cc上的 dirty Page／backend／tests或其他工作樹。
- 已讀固定 AGENTS／new handoff／完整五 runtime diff。handoff「尚未 push」是提交當時快照；本次已以遠端 exact SHA 實證 push，不推導已 merge／deploy。
- 沒有部署、cloud／DB 操作、真人權限映射、真通知、退款、付款、庫存、PR或跨 thread 發訊息；測試與回執之外沒有產品修改。

## 互串、標題與契約核對

移除的是首頁／六入口常駐教學及指定長文，實際案件、保管、位置、SN、申報數量、公司、版次、既有來源与必要錯誤保留。CustomerIntakeQueue 的 claim_intake／bind_intake 指令、同 JSON body 的 requestId、expectedVersion、sourceVersion／sourceItemId、actor／stage／allowlist、strict source validity／remaining count、unknown-response 精確回執核對均不變。縮短成功訊息沒有新增成功條件或自動重建。

SourceCasePicker 相容以固定 Git blobs 核對：2643 和收發固定 `9ccabf973e9ee6ee41eb38a289dab371decc893a` 的 **Props type AST 及 parameters 相同**（id/value/onChange/entityId/active/selectedSource/onSelectSource）；DOA使用 selectedSource及 onSelectSource，選案後同樣清 sourceItemId並設 dirty。9cc的搜尋文字整理不影響此接法；沒有讀 Root dirty product 作證。

Layout 只在精確 `/operations/after-sales/workbench`、可用 after-sales workspace及一致 active label 時隱藏 shell 重複頁名；Hub h2／id／aria-labelledby保留。實際 Layout＋Hub桌面1440與手機390親跑：單一可存取頁名、六入口、案件總覽、手機主選單及內容區不溢出；SELF 阻擋仍保留 shell 頁名及真權限提示。不是全面隱藏其他頁名。登入偏好只縮短 feedback，仍原 user／entity／browser storage scope。

六 enum／section／title的 AST（只移除 description 後）與 base 相同；六原路由、finance專用 grant、ENTITY／SUPER_ADMIN／SELF／DEPARTMENT限制、原 launch／origin/frame/readiness／timeout／same-company及 dirty blockers都維持。不存在 FAQ等新快捷入口或授權。

獨立 TypeScript AST：**19 指定 declaration initializer、41 native API／session／permission／routing calls、model四 function AST及 intake三 Form.Item name／rules均與 base 相同**。backend整棵 tree、services、repair整目錄、intake-actions、SourceCasePicker、mailroom model、config、兩 lockfiles與AGENTS tree OID亦精確相同。沒有用作者 PASS 代替親核。

## 親跑驗證

| 項目 | 實際結果 |
|---|---|
| Module actual DOM | **8／8 PASS**（parent＋7情境），15,713.512208ms；六 route、公司保留、金融專用 grant、SELF／DEPARTMENT／ADMIN SELF blocked、disabled integration、overview native draft保留／放棄、intake deeplink換案確認。 |
| company＋actual Layout／Hub DOM | **7／7 PASS**（parent＋6），7,853.507459ms；query B蓋stored A、failed/partial C不混舊公司、late A不蓋B、query hooks／sidebar command search、桌面／手機Hub与SELF blocked。 |
| 兩 DOM合計 | **15／15 PASS，24,454.589041ms，skip 0**。 |
| Hub＋Intake pure | **11／11 PASS，898.144667ms，skip 0**；原六enum／route／scope、claim/bind guard、原指令／實物不異動、source stale／類型／數量／品項／依據負例、intake return ID、exact receipt與unknown-response。 |
| TypeScript app及node | **PASS**，私有tsbuildinfo，ES2022 app。 |
| 五 runtime＋兩 tests scoped eslint | **PASS，0 error／0 eslint warning**；既有 baseline browser data提示沒有升級。 |
| `git diff --check base..HEAD` | **PASS**。 |
| 中央 knowledge --check | **預期 FAIL：精確五 reviewed source drift**；沒有執行 --write，沒有修改生成檔／manifest。 |

實際 Hub／Module／Layout、router、AntD modal及dirty guard正常載入；auth/API／無關widgets与原Source iframe受控。Module 的 CustomerRepairQueue／CustomerIntakeQueue以受控 native queue boundary檢查父頁draft／routing，故本回執**不宣稱親跑完整原生客服補建元件DOM**；其 changed text／native command採AST＋pure接收。Source iframe是合成原始路由頁，不是真Source表單。

兩 test原有privatecache與ephemeral loopback port保留；review preload只補HMR false、ES2022 TS解析及合成圖片輸出。外部origin全部阻擋，runtime errors 0。Module session POST由 Playwright route直接fulfill合成303及已知source path，其他HTTP business writes禁止；JS stub POST仅合成記錄。**實際外部HTTP業務寫入0**，不是聲稱瀏覽器從未產生合成POST。

已目視私有桌面Hub、手機Hub及SELF blocked圖片；手機capture在選單展開動畫中，主選單可操作的結論以DOM/a11y assertions為據，不將此截圖當menu動畫最終像素驗收。外層debug-route標記是fixture資料；內容區width assertion不代表全fixture像素與正式shell完全一致。没有提供或啟動使用者本機預覽，沒有重跑不變backend／全面build。

## 限制與中央發布gate

Source原空白新增表單的預設RESHIPMENT不在本批修改範圍。**四類待修Source新增表單不能宣稱點入口就auto-prefill正確類型**；本 receiving沒有Source repo修改、真表單建立或營運測試。六入口只保留原分類路由，建立前仍需核對案件類型。

中央知識須合併後審中英操作說明再生成，不能只換hash；重點為新舊六類對照、教學移除後的原表單／概況／draft、接手→案件中心新增或選既有→同一收件綁定、不可重建、source品項／版次與physical handoff分別、登入偏好限本人／公司／browser。實際catalog source引用本批五檔，受影響guide還含dashboard、after-sales、mailroom/inbox/repair及既有native guides（包含FAQ既有依賴）；hash依賴不授權新增FAQ快捷入口。本批AGENTS未變，後續全系統clean-interface規則由repair/central另批整合。

最終整合SHA、Clawcheck／coverage、candidate/source proof、普通帳號公司／role及DEV UI需要中央再驗。本6ad接收不代收發Root另外修的mailroomGET/composed-permissions與false-empty P2，不代來源／AI dispatch consumer相容、LINE真通知／退款或實物交接驗收。

## 命令與證據

命令cwd為detachedtree；node/tsc/eslint cwd frontend，`<private>`見下。

```sh
git fetch --no-tags origin refs/heads/codex/doa-ui-cleanup-20261008
git rev-parse FETCH_HEAD
git ls-remote origin refs/heads/codex/doa-ui-cleanup-20261008
node --import <private>/review-preload.mjs --test --test-concurrency=1 tests/after-sales-module-dom.test.ts tests/workspace-company-dom.test.mjs
node --import <private>/review-preload.mjs --test --test-concurrency=1 tests/after-sales-hub.test.ts tests/mailroom-intake.test.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json --tsBuildInfoFile <private>/app.tsbuildinfo
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile <private>/node.tsbuildinfo
./node_modules/.bin/eslint src/pages/after-sales/AfterSalesWorkbenchHub.tsx src/pages/after-sales/workbench-model.ts src/pages/mailroom/CustomerIntakeQueue.tsx src/pages/AfterSalesModulePage.tsx src/components/DashboardLayout.tsx tests/after-sales-module-dom.test.ts tests/workspace-company-dom.test.mjs
git diff --check 264352c5b863d9928a36ab2a9dbecc697f35a028..HEAD
node scripts/dev/generate-copilot-knowledge.cjs --check
```

| runtime | 親算SHA256 |
|---|---|
| frontend/src/components/DashboardLayout.tsx | `187e02e40538d6cb71d5ad9364adc7c7c56c466949ef0c1ca79ba051271540af` |
| frontend/src/pages/AfterSalesModulePage.tsx | `8c911cbe6da50b4847b5e71b5b1c3d513c8ecfc3a51740dfee173d634057be4b` |
| frontend/src/pages/after-sales/AfterSalesWorkbenchHub.tsx | `0e8362f5d2f506fd767288bdcb7fd113ec1cdc16cedca58b02dc1be323ef5dd0` |
| frontend/src/pages/after-sales/workbench-model.ts | `8c9beaef2a4e085ee1d00d28874eef76a955cf26934800a6199f98e4b1535aab` |
| frontend/src/pages/mailroom/CustomerIntakeQueue.tsx | `3fa526fd63f793c9b6e53a01d70799e4f148ac3363ca98c637492c663297f6ee` |

`<private>`＝`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/doa-ui-6ad7dbd1-mailroom-review-r8wqcd6o`。含dom-tests.log、pure-tests.log、types-lint.log、knowledge-check.log、native-ast.json、source-picker-compatibility.json、preload＋Vite wrapper、三張合成圖片；metadata.json存完整SHA256。Receiving tree保持exact6ad／clean，未commit／push／部署。
