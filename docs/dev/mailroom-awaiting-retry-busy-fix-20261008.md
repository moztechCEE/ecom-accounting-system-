# 待到貨重試接管分頁讀取修復（2026-10-08）

前一批 `db86db7b18dbef610754a5ab139477316199662d` 的固定接收發現新 P2：清單已有刷新失敗提示，使用者先按「載入更多」，在分頁尚未回應時按提示中的「重試」。重試更新 generation，舊分頁的 finally 正確拒絕修改新狀態，但新刷新沒有接管 moreBusy。即使兩次 GET 都結束，分頁按鈕仍顯示忙碌，visibility／30 秒 poll 也停止。

## 版本與單一修改權

- repo `https://github.com/moztechCEE/ecom-accounting-system-.git`；owned tree `corely-erp-mailroom-ui-cleanup-20261008`、ref `codex/mailroom-ui-cleanup-20261008`。
- parent 為 `db86db7b18dbef610754a5ab139477316199662d`；開始 HEAD／ls-remote exact、tracked clean。保留 db86 與原接收失敗，不 amend。
- root 單一編輯 Page；前端子代理只編輯原 awaiting DOM test。中央、維修及 DOA 的工作樹不修改。
- 最後 delta 只有 Page 的 AwaitingCases（一行）、原 actual-awaiting DOM fixture（42 行新序列）與本文件。backend／Recipient／其他表單、API、Guard、Employee、schema、庫存、通知均不改。

## 修法與保留界線

新 refresh 取得 generation 時接管讀取，把舊分頁的 moreBusy 清除；舊 loadMore finally 的 generation 核對保留，避免晚到舊回應清除另一個新分頁的忙碌狀態。原 load-more 按鈕在 loading 時禁用，避免刷新尚未結束時再開始分頁。

同公司／搜尋快照、未知與成功空清單區別、stale 標記、已載入頁數、cursor、API query 與晚回應防護維持 db86。這不是寫入或真人權限修正，沒有新增請求、endpoint 或通知。新 GET 結果才能替換同 scope 快照。

## 原接收失敗證據

DOA 的獨立真 Page probe 已重現，root 已讀實際 log：所有 4 GET 均 settled、boundaryErrors 為空，最後按鈕 disabled=false 但 class 仍 ant-btn-loading。失敗 assertion 為 `Retry after superseding pagination must release busy state`；不是 selector／啟動錯誤。

- 私有 probe `/private/tmp/mailroom-p2-review-4_12txrb/awaiting-pagination-supersede-db86.mjs`，SHA256 `9af93d4cf029238bd06ca1f9d748ed4417070ed8779834307f432c3193cf6306`。
- 原紅 log `/private/tmp/mailroom-p2-review-4_12txrb/awaiting-pagination-supersede-db86.log`，SHA256 `d33bbcf82e33a3f9ab77b3acfeafdb211783c8feb4ebe8d05ba2ab1e945935ed`。
- 維修也以固定 db86 真 Page 獨立重現：4 GET 均 settled、pending／boundaryErrors 為空，POST=0；新 row 與 freshness 正常，但正常點「載入更多」及 visibilitychange 各新增 GET=0。私有 probe `/tmp/corely-repair-db86-frontend-probe-20261008/mailroom-awaiting-overlap-probe.test.mjs`，SHA256 `3bbb12c9d0bcf6d7dbf99205bc31ffed1bfe06baac4e03184c2efb88e8ef0f5d`；原結果 `overlap-final.log` 與 screenshot `corely-repair-db86-frontend-more-retry-stuck-20261008.png` 保留。各視窗原回執保留，不把 db86 已通過的 backend／其他 DOM scopes 改標成全批接受。

## 新回歸與最後接收

原四段 actual Page／AntD DOM assertions 全部保留；新增第五個隔離頁面：full-refresh 失敗 → held more → Alert retry held → 新刷新成功且保有新 cursor → 分頁解除 busy → 開始新 more 並保持未回 → 晚到舊 more 不污染 rows／cursor／頁數，也不能清新 more busy → 新 more 成功 → visibility quiet refresh 按已載入的兩頁更新。合成 GET 以精確 entity／search／cursor plans 核對，拒絕真業務 POST、外網與未預期 calls。

| 本批最後驗證 | 結果與限制 |
| --- | --- |
| 同最後 fixture 對 db86 紅 | 0/1 FAIL，6.63s；原四序列先通過，第五明確 assertion busy=true／expected=false，fresh retry已成功，非定位器／API mock失敗。 |
| 修後 actual Page／AntD DOM | 1/1 PASS，7.09s；5 隔離頁面／29 合成 GET＝11＋4＋2＋5＋7（不是29 tests），舊 finally 不清新 busy，cursor及頁數由精確 plans／禁止多抓第三頁驗證。每頁零 POST、外網、boundary errors、page errors、未耗 plans 或 pending。 |
| Frontend app／node types | 兩個 --noEmit PASS，私有 build info。 |
| Scoped lint／private production build | 0 errors／3既有warnings；Vite PASS 1.21s，既有 browser-data／chunk warning保留，無dependencies升級。 |
| Scope／diff | PASS；Page相對固定db86精確只新增一行setMoreBusy(false)，其他全文 bytes相同；test去除唯一新第五序列後全文同db86；service/spec/Recipient/SourcePicker/Tablet immutable同值。 |
| 不重跑的既有範圍 | backend116／Recipient原DOM及Page其餘form/write guards以固定bytes承接原證據，沒有冒稱本批重新實跑或全backend strict PASS。 |

最後來源 SHA256：Page `1d568fcdc3cdb4f88b276bd804932568542ea2d4a478d835cc9f31d347177e49`；Awaiting fixture `389e7a2e012b3d60cf4005349b2744e90ba7941637a886bc8d97cf721e1aec85`，綠跑前後均相同。原backend service hash仍 `220b470dd7f3289340aba4c63cebcc463bcda2f3212746f7cf2a3e98fa438b51`。

私有 DOM runtime `/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-awaiting-db86-hj1c0xmb` 保存 immutable db86 Page、首紅及最後 `red-db86-final.log`（SHA256 `bb30a9f9561ce02966c9f2825f25c41bfe13219f809a34b53529e1d6cfc5224c`）、`green.log`（`7efe1540455504f4c8e93058d2a38e008b46ff4a2dfb00f39c8bc60c979dc12a`）。Frontend cwd精確DOM命令：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/mailroom-awaiting-dom.test.mjs
```

root其他檢查 private runtime `/tmp/mailroom-awaiting-busy-20261008.019Uu3` 保存 `scope-proof.json`、app/node tsbuildinfo及Vite private dist/cache。Frontend cwd精確命令：

```sh
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json --tsBuildInfoFile /tmp/mailroom-awaiting-busy-20261008.019Uu3/app.tsbuildinfo
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /tmp/mailroom-awaiting-busy-20261008.019Uu3/node.tsbuildinfo
./node_modules/.bin/eslint src/pages/mailroom/MailroomPage.tsx tests/mailroom-awaiting-dom.test.mjs
```

Vite用API `build({cacheDir:<private>/vite-cache,build:{outDir:<private>/dist,emptyOutDir:true}})`，未啟動使用者本機預覽。

維修正式 db86 原 FAIL／HOLD 回執 `plans/workbench-coordination/repair-review-mailroom-db86db7b-20261008.md`，SHA256 `34463ccce1aa4e2a74dc77ba6de763f88b9e4af803b690d9b547dbfb783a91bf` 已實讀核對；原批失敗保留，新完整SHA提交後另交兩端固定接收，不覆寫歷史。沒有把本批綠測試當中央發布接受；新碼尚未部署。

DOA 中央收到固定新 SHA 後接收、更新 Page source hash（勿沿用db86的58237330）與 knowledge，雙語現有流程按觀察行為核對，沒有新增常駐教學或AI write tool。最後整合版本 build 與正常角色 DEV 驗收；root 不自行部署或切流量。Source AI dispatch 仍 PENDING_COMPATIBILITY，實物保管、業務狀態、庫存、通知與收退款保持各自界線。
