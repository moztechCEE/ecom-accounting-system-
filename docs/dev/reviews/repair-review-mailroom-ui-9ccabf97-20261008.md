# 維修接收審查：收發介面整理 9ccabf97（2026-10-08）

審查者：維修工作台／獨立 receiving。完成時間：2026-10-08 台灣 06:55。此回執只涵蓋指定收發 UI 差異；**UI 靜態契約與 actual Page 相容 PASS_SCOPE，原 Recipient 指定測試 0/1 定位器 FAIL，不能標兩份原 suite 全 PASS。** 私有 Recipient 契約探針另列 1/1 PASS。未發現此 UI 差異新增的 production P1/P2 證據；全批仍因既有 GET P2、中央知識更新及最後整合驗證待辦而 HOLD，不代簽發布 PASS。

## 固定版本與工作樹

| 項目 | 核對結果 |
| --- | --- |
| Repo／origin | `https://github.com/moztechCEE/ecom-accounting-system-.git` |
| 指定 ref | `refs/heads/codex/mailroom-ui-cleanup-20261008` |
| 指定完整 SHA | `9ccabf973e9ee6ee41eb38a289dab371decc893a` |
| parent／merge-base | 均為 `264352c5b863d9928a36ab2a9dbecc697f35a028` |
| 接收核對 | explicit fetch、ls-remote、FETCH_HEAD 與 review HEAD 均為上述 9cc 完整 SHA |
| 獨立審查樹 | `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-9ccabf97-20261008`，detached HEAD，建立及最後核對 `git status --short` 均空白 |
| 原開發樹保護 | 原維修 UI 樹的分支／dirty 工作保留；沒有 pull、reset、checkout、cherry-pick 或編輯其 production／tests |
| 本機相依 | 只在審查樹建立被 Git 忽略的 frontend/backend `node_modules` symlink，沿用既有相依；未 install／更新 |
| 文件 | 已讀固定版 AGENTS、協調資料及 `docs/dev/mailroom-ui-cleanup-handoff-20261008.md`；DEV 資訊只視為作者交付，這次未自行核讀 Cloud metadata |

```sh
git fetch origin refs/heads/codex/mailroom-ui-cleanup-20261008:refs/remotes/origin/codex/mailroom-ui-cleanup-20261008
git ls-remote origin refs/heads/codex/mailroom-ui-cleanup-20261008
git rev-parse FETCH_HEAD
git show -s --format='%H%n%P%n%s' 9ccabf973e9ee6ee41eb38a289dab371decc893a
git merge-base 264352c5b863d9928a36ab2a9dbecc697f35a028 9ccabf973e9ee6ee41eb38a289dab371decc893a
git worktree add --detach '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-9ccabf97-20261008' 9ccabf973e9ee6ee41eb38a289dab371decc893a
```

審查範圍 `264352c5b863d9928a36ab2a9dbecc697f35a028..9ccabf973e9ee6ee41eb38a289dab371decc893a`：9 檔、120 insertions／201 deletions。六個 production 路徑為 MailroomPage、RecipientPicker、SourceCasePicker、TabletAcceptance、mailroom.css，以及刪除 MailroomNextStep；另兩份 DOM tests 與 handoff。`git diff --check` PASS。backend、API client、schema、shared model、workflow/pending helpers、權限／導航與 repair code 無差異。

## 逐項相容性

以下行號相對指定 review tree。

| 項目 | 結果與證據 |
| --- | --- |
| 原生操作 body／ID／version | PASS_SCOPE。Page 1077–1083 原 JSON body 保留 entityId、action、expectedVersion、photos；1097–1100 仍送原 body 與 requestId。API AST 的直接 `api`／`tabletApi` call arguments 與基底逐一同值。 |
| 寄出結果未知與 reload | PASS_SCOPE。Page 1089 POST 前保存精確 body/key；1104、1117、1145 用精確回執核對；1124/1146 仍核版本及 canDispatch；未知／拒絕原操作保留。對應 pending helper byte 同值。actual Page fixture 已驗證原 request 跨 reload、exact retry／receipt 與 stale 零 POST；不把 sessionStorage 契約擴稱一般跨裝置草稿保存。 |
| 實物照片／busy／strict checkbox | PASS_SCOPE。Page 1069 busy/pending conflict guard、1073 照片門檻保留；Form rules/disabled/preserve 等 AST 同值。actual Page 使用 strict raw confirmedItems、照片、忙碌、dirty 與不符版本情境。 |
| 本人與平板 2FA | PASS_SCOPE 靜態。Tablet 51–70 的 entityId、requestId、version、employeeNo/password、twoFactorToken、strict boolean、location、Authorization 均與基底相同；Modal busy 不能關閉，表單驗證規則同值。未用真人帳號或真 2FA API 驗收。 |
| 同公司具體收件人 | PASS_SCOPE 靜態及私有契約探針。Page people query 的 entityId 未改，Recipient 113 仍只接受 eligible person ID；department 只篩選，不作人員指派。原 suite 的定位器失敗與 probe 限制見下節。 |
| 來源搜尋／原錯誤 | PASS_SCOPE UI 差異。取消舊請求／分頁／搜尋邏輯未改；SourceCasePicker 204–215 載入錯誤及重試保留；Page 637 的 awaiting error 與 701–720 可見失敗／重試保留。未將基底 GET P2 算成 9cc 新引入，亦未在此批代驗其修正。 |
| 案件、產品與 custody | PASS_SCOPE。Page 1169 真實品名；1193 案件號；1212 來源品項；1216–1218 實收品項/SKU/SN；1219–1220 真實位置與保管人。linked replacement 1222 與「原退貨入庫紀錄」1223 分列，不把歷史 custodian 視為目前持有人。平板仍顯示案件／實物／SKU/SN／具體接收人。 |
| 寄出資料與舊 ACK | PASS_SCOPE。Page 1239–1245 「寄出紀錄」保留物流、單號、時間、人員、实际原件或替換品，明列「寄出同步：待串接」；1708 起「既有進度同步」仍呈現既有 deliveries。Source/AI dispatch consumer 未接通，不宣稱顧客已通知、收件、結案。 |
| 清理教學與實際錯誤 | PASS_SCOPE。刪除純 NextStep 常駐教學；原 action 可用性、missing customer service、empty/unavailable recipient、pending conflict、failure Alert 等真阻擋仍在，沒有移除或另造狀態。Recipient 98/133/138 保留異常時 aria-describedby 與 live status。 |
| Handoff／Claw 提案 | PASS_SCOPE 文件語義。雙語提案仍保留具體人員、本人核對及實物簽收、通知另行追蹤、寄出未接通、精確 requestId/回執與同內容重試；新短標籤與實碼相符。提案未等於中央 generated/manifest 已更新。 |

独立 AST 比對去除 source location/comments，核 direct API callee+arguments 與 JSX Form/Form.Item 的 `name/valuePropName/rules/disabled/preserve/initialValues`：Page 13 個直接 API calls、24 個 Form 元素（22 fields + 2 Forms）；Tablet 1 個 API call、6 個 Form 元素（5 fields + 1 Form），兩組均相等。計數口徑僅 direct api/tabletApi，不拿文件的其他計數口徑充當缺陷。

Git blob 證據：

- `mailroom-workflow.ts`：base/HEAD 均 `1ae9c18e08b0b49dd8f43bb42b9754767ddb5708`。
- `mailroom-dispatch-pending.ts`：base/HEAD 均 `398438163e8de8b495aacf72219e53ec71444720`。

## 離線 runtime：原 suite 與私有 probe 分列

cwd 均為 review tree 的 `frontend/`。fixture 使用真 React/Ant/Router 或真 Form、synthetic 資料與 API mocks，Vite 只在 loopback，外网 requests abort。無真 HTTP 業務／DB／通知／金流／庫存副作用。

| 命令／範圍 | 實際結果 |
| --- | --- |
| 作者指定 ts-node loader + original workbench test | 無 leaf 完成結果，持續超過 150 秒；依根節點有界指示只 TERM 自己 child PID 54678，file-level 約 212.3 秒後 exit 1。此為未完成且人工終止，不能據此宣稱產品 FAIL 或 suite PASS。 |
| Plain Node + **原 tracked workbench test，無修改** | **1/1 PASS、0 skip、exit 0**；leaf 47.316 秒，總 47.581 秒。 |
| Plain Node + **原 tracked Recipient test，無修改** | **0/1 FAIL、0 skip、exit 1**；13.516 秒。失敗是 line 123 `#external-person.click()`：已開啟的 Ant Select dropdown option 攔截 pointer events，8 秒 locator timeout。後續 external reset/eligibility 斷言在原 suite 未執行，不能標 PASS。 |
| Plain Node + **私有 Recipient contract probe** | **1/1 PASS、0 skip、exit 0**；leaf 15.895 秒，總 16.225 秒。固定來源相同，保留全部原後續斷言；五處 fixture-only 調整如下。 |

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/mailroom-workbench-dom.test.mjs
node --test --test-concurrency=1 tests/mailroom-workbench-dom.test.mjs
node --test --test-concurrency=1 tests/mailroom-recipient-dom.test.mjs
node --test --test-concurrency=1 '/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-9cc-recipient-probe-nogx_znw/mailroom-recipient-contract-probe.test.mjs'
```

### 原 Recipient fixture 的可重現性缺口

`frontend/tests/mailroom-recipient-dom.test.mjs:118–123` 先打開搜尋下拉，再以 synthetic `#same-list.dispatchEvent('click')` 改候選列表，接著 native click 外部 Form 控制。縮短說明後 fixture 按鈕可被 dropdown 遮住；這個 `external-person` 是 Harness 的 `form.setFieldsValue` 模擬入口，並非產品按鍵。此為本機可重現的測試定位器缺口；**沒有 production 新增 P2 的證據**。

請作者下一批修正 owned test fixture，使 external Form updates 不受 dropdown 位置影響，保留原所有值/reset/eligibility 斷言；於新固定 SHA 重跑指定 Recipient suite 並更新 handoff 證據。根節點最新通知作者已另採 Escape 修正，隨下一 P2 固定 SHA 交付，待新批接收審查。本次不修改原 test、不把私有 probe 通過覆蓋原 suite 0/1 結果。

### 私有 probe 的精確差異

根節點明確授權後，在 private temp copy 僅五處改動：

1. Playwright require 改為固定 review tree backend node_modules 的絕對路徑。
2. Vite root 改為固定 review tree frontend 的絕對路徑，避免 temp dirname 讀錯 source。
3. 原 synthetic `#external-person` `.click()` 改 `.dispatchEvent('click')`。
4. 原 synthetic `#external-reset` 同改。
5. 原 synthetic `#external-repair` 同改。

后三處只模擬 Form 外部寫入，與原 `#same-list` 相同方式；實際 production Select 的鍵盤、候選點擊、department/UUID、搜尋、無效資格／disabled 及全部 value/change assertions 保留。未 force-click 產品按鍵、未刪斷言，且 original source/test 不變。

| 路徑 | SHA-256 |
| --- | --- |
| 原 `tests/mailroom-workbench-dom.test.mjs` | `990305bbda88fdf2e7691ac77139e3fdcbe84c99d75be36b60723ec895cef945` |
| 原 `tests/mailroom-recipient-dom.test.mjs` | `d136a1cbb19e26331aba84cfbf71c9dd0cee56ebfefc1fb6a83812cfe7c5ad6d` |
| 私有 `mailroom-recipient-contract-probe.test.mjs` | `6ed5668b7ca819e144446e7e13c3acdeb8dc155dbb32e3d2b790bb6f5a6e4e35` |

Page 原 fixture 同次產生並目視：

- `/tmp/corely-mailroom-ui-cleanup-20261008-dispatch.png`，1123×972。
- `/tmp/corely-mailroom-ui-cleanup-20261008-mobile.png`，390×1124（viewport 390×844；較長背景保留，抽屜內可捲動）。

產品／案件／保管與物流資料可讀，寄出待串接與既有 ACK 分開，無測得水平溢出。圖片是本機 synthetic 畫面，不能作 DEV 或實物營運驗收。

## Source hash、已知 HOLD 與最後整合待驗

五個修改 source 的 SHA-256 與作者 handoff 全相符：

| frontend/src/pages/mailroom/ | SHA-256 |
| --- | --- |
| MailroomPage.tsx | `dd4d316864527f1324cbf49ee5d306ce8297a2cac47a72731507fa81c00fc63b` |
| RecipientPicker.tsx | `ec4d7ceb7f831fa0e6b535028ff9f0f8753fe3dacbb04a2dfe5f75eb5ae2cd02` |
| SourceCasePicker.tsx | `7986be9ec5b50cea0aa7e14b2a40a9d773e9a11aaa0f72866a10af158b77d7fc` |
| TabletAcceptance.tsx | `080da05cb5c1b575f5c86a2f39639436597eba3ee2d3b086958cffe08b42456c` |
| mailroom.css | `28636075d1163ca07e2eb3254ffcb6188a1692be6bd2b6e0d68bae7145832f76` |

- **原 base264 GET P2：** DOA／根節點告知 SourceCases GET 混權限先套補建 Employee 門檻，以及待到貨 GET 失敗被當 0/空。前者在固定 backend `mailroom.service.ts:281–304` 可見 intakeCustomerService 於一般來源 read gate 之前，與 base byte 相同；後者沿用既有中央缺陷回報，這次不代重現整合修正。收發認領下一固定 SHA。9cc 不改 backend；Page/Picker 原載入 failure UI 保留不足以宣稱整個 GET 流程已修好。
- **中央 knowledge HOLD：** MailroomNextStep.tsx 已刪，catalog.source.json／source-manifest.json 仍引用；作者 `--check` ENOENT 是已知待中央 DOA 更新事項。這次只核對參照及提案，未 `--write`、未代跑中央 generator/build/spec、未宣稱知識通過。
- **最後整合待驗：** 新 GET 修正固定 SHA 的 receiving；原 Recipient owned fixture 修版／指定 suite；DOA 中央 bilingual/catalog/generated/manifest 更新及 generator check；各台對最後整合 SHA、共同權限／來源契約與部署 digest/候選 traffic 的核對。
- **營運仍另驗：** 人員權限及同公司 GET、真人本人 2FA、實物簽收／存放／交運、Source/AI dispatch consumer、顧客通知／收件／結案、金流與庫存，均沒有因 UI scope 或無 Git 衝突得到驗收。

本次共四次 DOM runtime invocation（含一個人工終止、兩份原 suite 與一份私有 probe），有效通過只各自列出，不累加成更多 tests。未重跑 backend/build/lint 或其他代理已負責的檢查。只新增本回執；審查樹 tracked/untracked 狀態仍 clean，未 commit／push／部署或操作真資料。
