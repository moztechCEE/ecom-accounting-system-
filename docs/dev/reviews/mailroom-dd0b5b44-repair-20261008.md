# 維修接收端對收發固定批的獨立審查

日期：2026-10-08。送出視窗：收發室工作台 開發 `01a0f1ea-bd9e-70f0-9a41-72e5c4eccc31`；接收審查：維修工作台 開發 `01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`。

## 固定版本與保護

- Repo：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- 指定 ref：`codex/mailroom-workbench-20261008`；base `f3f14c4104906cc6ca23bd1d38ba4589563b6801`；被審 SHA `dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d`。
- 接收端 explicit fetch 指定 ref，remote tracking 與 `ls-remote` 都核對此完整 SHA，沒有用目前其他工作樹代替被審版本。
- 獨立 detached tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-dd0b5b44-20261008`。建立時與測試後 tracked tree 乾淨；node_modules僅symlink既有依賴，probe在/tmp。
- 維修原開發分支3e及DOA/收發開發樹沒有reset、stash、clean、cherry-pick或其他覆寫；原售後來源仍 `20f583b6284e93e5516a533733b3833120aaae0d` clean。
- 已讀AGENTS、原售後整合矩陣與本批mailroom handoff。無部署、DB、正式資料、庫存或外部通知操作。

## 結果：FAIL，修正後需新固定 SHA 重審

本人accept_return、當前保管、不可變寄出、替換實物／正式OUT核對及維修唯讀相容性 PASS；下列兩個P2不能被既有測試PASS取代。

### P2：實際 HTTP pipe 將非布林確認轉為 true

`backend/src/main.ts:34` 全域 `ValidationPipe` 使用 `transformOptions.enableImplicitConversion=true`。`backend/src/modules/mailroom/mailroom.dto.ts:106` 的共用 `confirmedItems?: boolean` 只用 `@IsBoolean`，原始 `"false"`、`"true"`、數字 `1` 會先轉成 `true`，再通過 `mailroom-dispatch.contract.ts:138` 的 strict-true guard。

本地相同pipe與實際DTO／transition重現：

| raw confirmedItems | pipe結果 | dispatch |
| --- | --- | --- |
| JSON boolean true | true | 允許 |
| JSON boolean false | false | 拒絕 |
| 字串 false | true | **錯誤允許** |
| 字串 true | true | **錯誤允許** |
| 數字1 | true | **錯誤允許** |
| 數字0 | false | 拒絕 |

現 `mailroom-dispatch.service.spec.ts:450` DTO測試pipe漏全域conversion設定，故未抓到此差異。建議收發依DOA分配窄修此欄raw型別驗證，測試帶實際pipe設定，不全域移除轉換。這不表示可以繞過公司／custodian／員工／權限／狀態守門，問題是實際交運確認的請求語意不嚴格。

### P2：關閉／切換丟失未提交寄出草稿

固定版本 `frontend/src/pages/mailroom/MailroomPage.tsx` 沒有dirty／touched／離開確認守門。寄出欄位1264–1268，Form1249–1260無onValuesChange；openItem243–247直接切物件，Drawer522–523直接關閉且destroyOnHidden；choose967–971重設表單，cancel1595直接清action。填carrier／tracking並勾confirmed後關閉或換作業會丟草稿。此為唯讀程式核對，DOA亦已交收發修正；未宣稱本次實際DOM已覆蓋離開確認。

未知結果首次body/key由ItemDetail本地ref842保存；997–1005與1018–1026於同mount同body重試／精確GET可核對。關閉、reloadDetail181–188或version key529重掛會失去ref；這不是跨卸載保存。應保存／阻止離開並先核對本次原請求，不將重開頁面或DISPATCHED旗標當成本次成功回執。

## 實際測試與接口結果

| 實跑 | 結果／範圍 |
| --- | --- |
| 9個後端核心Jest suites | 168/168，dispatch contract/service、stock custody、repair workflow/workbench/access、native contract、tablet、history |
| 3個後端文書／正式stock suites | 67/67，repair-document、after-sales-stock.service、after-sales-stock.receipt；合計12suites235tests |
| terminal immutability獨立probe | 48斷言PASS，22個native actions均不能改已寄出件、workflow actions為空、外部保管優先；另6型DTO matrix重現上述FAIL，root也重跑確認 |
| 前端8個pure檔 | 45/45 |
| MailroomPage及RecipientPicker真React DOM | 各1/1 PASS |
| 真RepairWorkbenchPage額外離線probe | 2/2，DISPATCHED及linked replacement donor；顯承運商與物流，無再次簽收／施工／文件保存提交按鈕、POST=0；原IN列為歷史 |
| root跨固定模組composition | 24斷言PASS，4方案的寄出件無開工／完成能力，carrier/linked物流及原紀錄不變；此不是最後整合commit |
| 完整frontend build及fixed diff check | PASS；保留既有browser資料過期與bundle警告，未安裝／更新 |

後端cwd命令：

```sh
node_modules/.bin/jest --runInBand --no-cache src/modules/mailroom/mailroom-dispatch.contract.spec.ts src/modules/mailroom/mailroom-dispatch.service.spec.ts src/modules/mailroom/repair-stock-custody.contract.spec.ts src/modules/mailroom/repair-workflow.service.spec.ts src/modules/mailroom/repair-workbench.service.spec.ts src/modules/mailroom/mailroom-repair-access.service.spec.ts src/modules/mailroom/mailroom.contract.spec.ts src/modules/mailroom/mailroom-tablet.service.spec.ts src/modules/mailroom/mailroom-workflow-history.service.spec.ts
NODE_PATH=node_modules node_modules/.bin/ts-node --transpile-only --project tsconfig.json /tmp/repair-mailroom-dd0b-immutable-probe.ts
```

前端cwd命令：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test tests/mailroom-workbench.test.ts tests/mailroom-recipient.test.ts tests/mailroom-intake.test.ts tests/notification-refresh.test.ts tests/repair-item-custody.test.ts tests/repair-workbench.test.ts tests/repair-stock-return.test.ts tests/repair-navigation.test.ts
node --test tests/mailroom-workbench-dom.test.mjs
node --test tests/mailroom-recipient-dom.test.mjs
node /tmp/corely-repair-dd0b5b44-custody-probe-20261008.mjs
npm run build
```

接口仍為 `POST /mailroom/items/:id/actions` 的dispatch分支、原native paths及read投影；無controller/schema/migration変更。本人收發accept_return之後，REPAIR為READY_FOR_DISPATCH，RETURN仍走PENDING_WELFARE_STOCK。寄出需本人MAILROOM保管、現行在職employee、同公司／權限／版本，換機只讀已POSTED reservation/CONSUMED unit/正式OUT/SKU/SN，不二次出庫。DISPATCHED/CUSTOMER_CARRIER、來件物流、donor IN及白名單linked物流各自保存。

## 知識、後續與驗收限制

已審本批handoff的雙語mailroom guide提案及6個新sourcePaths；集中知識仍交DOA。root在此固定SHA實跑 `node scripts/dev/generate-copilot-knowledge.cjs --check` 為FAIL，列出8個已審來源hash漂移及generated／manifest差異，未寫檔。不能以build成功掩蓋，knowledge尚非發布PASS。

維修3e面板與此dispatch狀態合併時，RETURN方案會沿用舊未修交回提示；維修另交owned純提示適配，不改shared狀態或dispatch命令。records隊列目前不含DISPATCHED，all仍可查；擴充records查詢須另由DOA協調。

未驗證真實PostgreSQL併發、最後整合SHA、DEV、現場商品及Source／AI消費端。outbound sourceSync保持PENDING_COMPATIBILITY，不建立外部delivery、不發通知、不重扣庫存、不写Source或金流。修正新固定SHA、最後整合與DEV仍需各自回執，不能簽整批PASS。
