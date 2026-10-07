# 維修接收端對收發 d75 修訂的獨立審查

2026-10-08。送出收發 `01a0f1ea-bd9e-70f0-9a41-72e5c4eccc31`；接收維修 `01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`。

## 固定版本與保護

- Repo `https://github.com/moztechCEE/ecom-accounting-system-.git`，ref `codex/mailroom-workbench-20261008`。
- 固定 SHA `d75ce4359df2f2170b65b1acf984aa9f8439cd34`；parent `dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d`；shared base `f3f14c4104906cc6ca23bd1d38ba4589563b6801`。
- 接收端 explicit fetch、remote tracking與ls-remote皆同值；新 detached tree `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-d75ce435-20261008`，建立／測後tracked clean。
- 只symlink既有node_modules；probe／cache在/tmp，未安裝、reset、stash、clean或覆寫自己的未提交工作／其他視窗工作。已讀AGENTS與本批handoff；產品diff parent..d75為8檔，base..d75為27檔／16產品来源。
- 本回執與repair-status為本視窗協調紀錄，不修改收發產品／mailroom-status。没有部署、DB、真實金融／庫存／通知／物流操作。

## 結果：修訂三項 P2 與受影響契約 PASS_SCOPE

原dd FAIL歷史保留。本次固定修訂確認值、草稿／未知寄出及RecipientPicker忙碌保護通過，未發現新增P1/P2；不替代集中knowledge、最後整合SHA、DEV或營運驗收。

| 獨立實跑／對照 | 結果及實際範圍 |
| --- | --- |
| backend全部mailroom suites | 14 suites／253 tests PASS；含與main完整pipe一致的真controller/DTO/service HTTP 10 raw值及accept/accept_return truefalse4種。 |
| 獨立raw確認probe | 17 raw＋4簽收情境、65斷言PASS；只有JSON true能dispatch，其他非布林DTO拒絕，false/null/omitted在native service拒絕。 |
| root舊問題同構probe於新tree | 22 native action不可變／保管48斷言PASS；原「false」「true」、1、0都DTO拒絕；JSON false拒絕，true允許。 |
| frontend指定pure | 30/30 PASS（draft/pending、workbench、recipient、intake、notification-refresh、custody），runner target ES2022；另source-search3/3。 |
| actual MailroomPage作者DOM獨立重跑 | 1/1 PASS，35.15秒；close/action/換件/route/Back取消保留欄位照片原key、busy收件兩picker disabled、成功後clean、未知寄出離開/重入/真reload原body/key、explicitretry、stale/no-match人工核對不POST/新key、discard不刪pending。 |
| 獨立actualUI補證 | 1/1（3情境）PASS，9.35秒；detail部門/人員picker busy disabled，保存中關Drawer/切route受阻，成功後routeclean；session write/readback失敗兩種都0POST且取消保留內容。 |
| root actual MailroomService.list probe | 8斷言PASS；records含DISPATCHED與READY_FOR_DISPATCH、delivery僅待交回、all保留、foreign scope拒絕。Prisma/auth/views為離線替身。 |
| handoff来源hash／路徑 | 16/16 SHA256相符，涵蓋全16產品來源；9追加sourcePaths存在、尚未在舊mailroom guide，route/permission保留。 |
| 完整frontend build、fixed diff、tree | PASS；原瀏覽器資料過期與bundle警告保留，沒有升級。 |
| root knowledge readonly check | **FAIL，8來源漂移**；沒有--write。集中guide/path/hash待DOA最後整合，不假裝發布門檻全PASS。 |

## 三項修訂判斷

1. DTO toClassOnly Transform取原始JSON再驗證，修掉全域enableImplicitConversion把字串false轉true。main全域設定不變；合法bool的其他本人簽收行為保持。後端產品delta僅DTO，dispatch/stock/source/notification服務相對dd未改。
2. Drawer、動作、換件、route/Back及beforeunload共享草稿保護；取消保留，保存／讀圖中不能切換，成功後不由舊finally復活dirty。一般未保存照片只在當頁記憶體，沒有承諾reload恢復。
3. 未知寄出首包按公司／本人／item用窄sessionStorage保存并POST前readback；失敗不send。重掛／真reload仍同body/requestId，精確entity/item/key/fromVersion/version/actor/物流回執才clear。stale/no-match轉人工核對，沒有自動POST或造新key；discard不刪尚未核對的寄出。session不跨tab/device，沒有保存照片或密碼。兩個RecipientPicker繼承busy/uncertain，不覆蓋Form鎖定。

## 維修及外部接口

相對dd，維修source/model、custody、API client、Prisma schema、controller、dispatch、stock custody及repair workflow契約diff空。原工作單／实际處置／各原生workflow分支／IN歷史／入件物流保留。派送只讀已核對正式OUT，不二次消耗庫存；DISPATCHED/CUSTOMER_CARRIER只證明交承運商，不證明顧客收件／整案結案。

dispatch sourceSync仍PENDING_COMPATIBILITY／DISPATCH_CONSUMER_NOT_CONFIGURED，不建dispatch delivery/outbox，不加Source/AI consumer或自動補送。既有deliverySummary ACK不含本次寄出；53ec owned維修Page提示修訂另在維修分支交兩台審，不能宣稱d75單独舊Page沒有相鄰提示P2。

**更正舊維修dd回執與53ec handoff：** dd及d75 service已將DISPATCHED加入repairScope=records；先前接收端把0c舊backend限制套到收發批，是審查遺漏。此項現有契約不是新維修shared修改，root已actualservice查詢probe確認；維修2ade文檔／Page records參數回歸更正已push，通知兩台。最後Claw依整合後records/all可查寫雙語，不沿舊排除限制。

## 重跑與界線

backend cwd：

```sh
node_modules/.bin/jest --runInBand --no-cache src/modules/mailroom
NODE_PATH=node_modules node_modules/.bin/ts-node --transpile-only --project tsconfig.json /tmp/repair-mailroom-d75-confirmation-probe.ts
NODE_PATH=node_modules node_modules/.bin/ts-node --transpile-only --project tsconfig.json /tmp/repair-mailroom-d75-immutable-probe.ts
NODE_PATH=node_modules node_modules/.bin/ts-node --transpile-only --project tsconfig.json /tmp/repair-mailroom-d75-records-probe.ts
```

frontend cwd：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test tests/mailroom-draft.test.ts tests/mailroom-workbench.test.ts tests/mailroom-recipient.test.ts tests/mailroom-intake.test.ts tests/notification-refresh.test.ts tests/repair-item-custody.test.ts tests/mailroom-source-search.test.ts
node --test tests/mailroom-workbench-dom.test.mjs
node /tmp/corely-mailroom-d75-independent-dom-probe-20261008.mjs
npm run build
```

repo root：

```sh
node scripts/dev/generate-copilot-knowledge.cjs --check
git diff --check dd0b5b4453eb0cf348fd7b3a4b4b39c2ea73d91d d75ce4359df2f2170b65b1acf984aa9f8439cd34
git diff --check f3f14c4104906cc6ca23bd1d38ba4589563b6801 d75ce4359df2f2170b65b1acf984aa9f8439cd34
git status --short
```

臨時獨立probe只在本機接收端，不當成倉庫可移植測試。未驗真DB並發、實際Source/AI消費／通知ACK、承運商或顧客接收；最後整合固定SHA須含DOA公司修訂、維修53ec+2ade、收發d75及中央Claw，交三台再核對後由DOA統籌DEV。
