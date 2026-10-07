# 待到貨分頁接管修正獨立接收：9b7b（2026-10-08）

**窄範圍 SCOPE PASS，沒有新 P1/P2。** 固定新版本已讓相同 db86失敗探針紅轉綠，並保留舊回覆不能清除新分頁忙碌／污染新資料的守門。這是本機合成實际頁面接收，不是 DEV／Source／真人流程驗收或發布授權。

## 固定來源與保留歷史

- 接收 `9b7b86c9d4d4a81219334620d03ef8caff0f5ff1`，parent `db86db7b18dbef610754a5ab139477316199662d`。Root已驗 author clean／remote exact，本接收沒自行操作 remote。
- 新 detached tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-ui-review-9b7b86c9-20261008`；讀 AGENTS、新 handoff 與完整三檔 delta，執行前後 clean。作者最後查核仍9b7b clean。ignored node_modules symlink只沿用Root現有依賴，沒有安裝／修改 lock。
- 相對db86只有三路徑：Page一行 `setMoreBusy(false)`、原Awaiting DOM新增42行、新增59行交接文件 `docs/dev/mailroom-awaiting-retry-busy-fix-20261008.md`。沒有後端／Source／API／權限／schema／migration修改。
- 原 db86 HOLD：[mailroom-ui-db86db7b-doa-review-20261008.md](mailroom-ui-db86db7b-doa-review-20261008.md)，原封 SHA256 `07c9e23330b9300ccd4f10ce28f84c106c153e32219fb5d9d4e69fac5a7fd456`。原9cc、db86 review trees與所有紅／中途harness log都保留，沒有 reset／覆写失敗。
- 私有新證據：`/private/tmp/mailroom-p2-9b7b-review-aml20ago`。只新增該處探針、log、hash證據與本共享報告；沒有修改作者／Root產品。沒有真DB、Source、API、cloud、provider、通知、財務、庫存或使用者browser操作。

## 實際接收結果

| 實際執行 | 結果與涵蓋 |
| --- | --- |
| 相同 db86紅probe，新9b7b Page | **1/1 PASS**、no skip，9.88s。七隔離序列／34合成GET（六序列29＋新增supersede5，不是34tests），每頁0POST／外網／boundary/page error／pending。只替fixture Source root，原held key、時序與所有斷言相同。busy最後實際沒有 `ant-btn-loading`、disabled=false；visibility-triggered同quiet-poll callback成功重新讀取。 |
| 新作者Awaiting actual DOM | **1/1 PASS**、no skip，8.12s，五序列／29GET（11＋4＋2＋5＋7）。真Page/AntD正常按鈕，新增當頁新more保持pending時放行舊more：舊finally不能清新busy、舊row不可出現；新cursor精確配對、新more後quiet refresh必須只重讀已成功兩頁，禁止額外第三頁。 |
| 原db86紅證據 | 保留FAIL `Retry after superseding pagination must release busy state`；四GET均settled，disabled=false但loading=true。不是把舊票改成新PASS。 |
| Scope／既有證據承接 | `scope-inheritance.json` PASS：移除該一行後整個Page byte-equal db86；service與access/repair/intake specs、intake service、Recipient產品/test、SourcePicker、Tablet及AGENTS皆byte-equal。`git diff --check` PASS。 |

精确修法位置 `frontend/src/pages/mailroom/MailroomPage.tsx:624`：refresh取得新generation時清舊分頁busy，將ownership交給full refresh。loadMore的generation檢查仍保留；新full-refresh等待時footer被loading禁用；舊finally不得清另一新pagination busy。這是一行讀取狀態修正，沒有請求／資料寫入契約變動。

原 db86 本接收親跑的 backend9/9、三suite116/116、Recipient DOM1/1 **本輪不重跑**；由相同 bytes 明確承接原證據。不可說它們是9b7b本輪新執行；也不將重疊DOM GET數相加當獨立功能總數。backend/read資格修正沒有被新一行改寫，intake本人／Employee／公司與原版次、重試、容量守門維持。

visibilitychange實際觸發既有poll handler；未等待30秒timer，此handler的同一callback與interval註冊未變。未重跑全build／全部types或backend／knowledge；中央仍需以最终整合版本審中英指南與Page新hash、build及正常DEV角色接收。Source／AI出件 `PENDING_COMPATIBILITY`、實物簽收及庫存／金流／通知邊界未因此宣稱已完整跨系統打通。

## 命令與可核對證據

相同探針：

```sh
node --test /private/tmp/mailroom-p2-9b7b-review-aml20ago/awaiting-pagination-supersede-9b7b.mjs
```

作者currentfixture（cwd review/frontend）：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/mailroom-awaiting-dom.test.mjs
```

| 證據 | SHA256 |
| --- | --- |
| 原紅probe（旧私有目录） | 9af93d4cf029238bd06ca1f9d748ed4417070ed8779834307f432c3193cf6306 |
| 原红log（旧私有目录） | d33bbcf82e33a3f9ab77b3acfeafdb211783c8feb4ebe8d05ba2ab1e945935ed |
| awaiting-pagination-supersede-9b7b.mjs | 13d43646453f70f43602ded24956cf888d7418f1cec66633ccabe86ed898af99 |
| probe-input-proof.json（只换root） | ede127f3721e5da67137b6da6d5f8260e8c7d56f8ff9a20f67ee8de4157ab8ef |
| independent-supersede-green.log | 874428c615c9f194f0b18eac90459c3f1f297c9d6976b4d26e5510c250ab7777 |
| current-author-awaiting-green.log | 0e265bc4cb10036346bb8ff407a9d6921f1093f8e29f574be1fb2270c48d3bac |
| scope-inheritance.json | a8240dc446682a7daf39aba03879149ddeacc0ba4e778c5441293a6ebe0031c7 |

Page來源 SHA256 `1d568fcdc3cdb4f88b276bd804932568542ea2d4a478d835cc9f31d347177e49`，currentAwaiting test `389e7a2e012b3d60cf4005349b2744e90ba7941637a886bc8d97cf721e1aec85`；backend service仍 `220b470dd7f3289340aba4c63cebcc463bcda2f3212746f7cf2a3e98fa438b51`、Recipienttest仍 `779abafef0ed4ffe7c14195038480e22df49e6b3ab195573b273c2c0dc047f63`，前後核對相同。

工具输出既有browser-data、experimental-loader与端口自动选择警示保留，不安装升级，不视为业务失败。此报告没有把Root整合HEAD与作者SHA混称；Root最终整合／knowledge版本由父任务独立记录。
