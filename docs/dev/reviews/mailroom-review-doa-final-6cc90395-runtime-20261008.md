# 收發接收 part：中央固定 6cc runtime／shared title

2026-10-08（Asia/Taipei）。**PASS_SCOPE**：收發 runtime／backend 与固定 owned 9b7 完整 bytes 相同，維修 runtime 可追溯至 4e8，DOA 原 runtime 至 6ad；shared title 新增影響已在最終 6cc 親跑 actual company／Layout DOM通過。未發現此窄範圍新增 P1／P2。這不是中央知識、build、DEV、部署或營運驗收簽章。

## 固定來源與操作邊界

- 被審完整 SHA：`6cc903951d42d3f0e9aa5556598595397734859b`；exact parent：`c932d30f2d9ce8453f9910d257920d5465145c4e`。
- Named ref：`refs/heads/codex/aftersales-workflow-20261005`；root 已自行 named-fetch／FETCH_HEAD／ls-remote 核對 exact，另已確認 explicit push。本 part 沒有 fetch、ls-remote 或任何外網操作。
- 新 detached review tree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-review-doa-final-6cc90395-20261008`。本 part 開始與 actual DOM 結束 HEAD 相同、`git status --porcelain=v1` 為空，AGENTS已讀。
- 根已準備 ignored frontend／backend node_modules links；本 part 只沿用，未建立競爭 links、安裝依賴或變更 lock。Node、Playwright、Vite均取既有本機依賴。
- 本 part 唯一寫入協調檔為本文件；其他寫入僅私有 runtime。未改 product／tests／knowledge、未 commit／push／deploy、未操作雲端／DB／真通知／庫存／財務。

## 來源承接與中央 trace

以下固定提交與中央對應提交的 `git patch-id --stable` 全部相等；完整 path／Git blob OID／SHA256核對另存 `scope-proof.json`。這是本 part 新實查，不靠作者文字推導。

| 作者提交 | 原完整 SHA | 中央對應完整 SHA | 相同 stable patch-id |
| --- | --- | --- | --- |
| DOA 6ad | `6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1` | `1167217bfb3941d1ee8e122f8a82feb80a7dab30` | `713dbe2d84cf33b0ef509f54548bef00406703e5` |
| Shared title 5232 | `5232f7440ccb6eb78f0f668d580022fb23a7018c` | `f8ded7e26423f5f136ab555955ed9efdc1f9ad7a` | `2edf5b8b8dd07910aae5278dfd36cccfbf9b8df7` |
| Repair 4e8 docs | `4e8a5e474763c7abb8d3d40b4f833d2d88999121` | `18638e470db426112bf499cb87eb9f792d69138b` | `ae01e23f66d092659fe85205df60ab452d093595` |
| Mailroom 9b7 | `9b7b86c9d4d4a81219334620d03ef8caff0f5ff1` | `c932d30f2d9ce8453f9910d257920d5465145c4e` | `423c774beecc295b9682155c96eb9186280da64a` |

| Source scope | 固定參照 | 本 part bytes 結果 |
| --- | --- | --- |
| 收發 owned | `9b7b86c9d4d4a81219334620d03ef8caff0f5ff1` | 62 paths 相同：14 frontend runtime、10 frontend tests、22 backend runtime、16 backend specs。 |
| 維修 | `4e8a5e474763c7abb8d3d40b4f833d2d88999121` | 25 paths 相同：13 frontend runtime（含原 helpers/service）、12 tests。 |
| DOA 原頁 | `6ad7dbd12f136f5a35dce97e38e701e9cef7e7a1` | Module、Hub、workbench-model、DOA-owned CustomerIntakeQueue四 runtime及兩 tests相同。 |
| Shared controls | owned 9b7 | 63 runtime paths 相同：config／services／hooks及 App／PermissionRoute／Layout CSS／ClawHelpButton／event state。 |
| Shared title 新來源 | `5232f7440ccb6eb78f0f668d580022fb23a7018c` | DashboardLayout與workspace-company DOM兩檔精確相同；Layout相對6ad確有新bytes。 |

組別可重疊，不能把上述數字相加當測試數。實跑前後去重 **156 source／test paths** 全部 SHA256 不變；不冒稱本 part 查核中央208 curated knowledge sources。

`CustomerIntakeQueue.tsx` 是 DOA-owned，因此不把 mailroom 整目錄都說成與9b7相同；該唯一目錄差異已單獨與6ad核對。其餘收發內容全文相同，包含 DTO、commands、照片／busy／dirty guards、持久 pending dispatch 的原 body／requestId／expectedVersion、精確回執、stock只讀核對及 custody gates。

Backend mailroom整棵 tree OID精確同owned9b7：`619609377191d81968462a13225b6f918c3ca305`。`backend/prisma` tree亦同：`a37087a487bad1a037bdac4c6199f1ad9181ba57`，無新schema／migration。

實讀 `mailroom.service.ts:281-325` 與access spec：mailroom:read獨立讀取先核目前actor／公司，不因附帶CSR grants而要求Employee/CSR資格；repair-only沿原REPAIR來源過濾，不走CSR資格。兼任CSR／repair且CSR資格Forbidden時，fallback才重新核對actor／公司／repair grant，僅返回REPAIR來源；合法CSR仍可沿原全類讀取，純CSR仍走完整資格。這沒有改claim/bind、本人交接、實物接受、寄出或其他write gates。controller:24-30原awaiting/cursor轉交亦不變。

### c932 → 6cc 的精確 delta

`git diff --name-status c932..6cc` 是 **15 paths**：3個 knowledge檔、12個docs（11新增、1修改）。knowledge精確為 `catalog.source.json`、`catalog.generated.ts`、`source-manifest.json`。排除這3檔後 frontend／backend／scripts delta為空；原business runtime及tests與c932完全相同。

因此分類是 **DOCS_AND_KNOWLEDGE**，不是「整棵backend不變」或「全部只是docs」。Guide內容／生成檔有改；其雙語語意、208 hashes與sourceVersion gate由root／中央獨立 part處理，本 part未跑generator／knowledgecheck或改生成物。

## Shared title 靜態 scope與新實跑

[DashboardLayout.tsx:54](</Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-review-doa-final-6cc90395-20261008/frontend/src/components/DashboardLayout.tsx:54>) 僅在exact route、可用workspace、active label相符時隱藏shell重複span；repair另要求 `workspaceCompanyId(search)`非空。售後原條件不變，新增收發／維修條件。

- enabled頁保留native h2；mailroom Page:294-323仍在未啟用先短Alert、正常顯示收發室頁名。
- repair Page:121-126仍依enabled／canRead／entity先提示，再顯示native h2；缺company時shell頁名保留。
- workspace可用仍取原旗標／read grants（workspaces:61-71）；active navigation、原公司query／storage fallback與App／PermissionRoute不變。title predicate沒有新grant、API、route或state/action變更。
- Layout:141-165保留手機menu、Help、account menu、skip link／main target、Outlet與既有motion。CSS未變。

本視窗舊6ad company／Layout證據只含原售後title，不能直接承接新增兩native workbench組合。root授權後，本 part只對最終6cc重跑最後 `workspace-company-dom.test.mjs`，未改來源或assertions。

**實際結果：1檔、1外層parent＋8leaf；Node TAP aggregate 9/9 PASS，0 fail／skip／cancel。** 不寫成9 standalone。Parent body 16,909.702667ms，runner 17,436.069125ms。

| Actual DOM覆蓋 | 真正結果 |
| --- | --- |
| 原5 company情境 | query B勝stored A；partial／failed C不混舊snapshot；late A不蓋B；hook/storage fallback；workspace sidebar與command search保持explicit B。 |
| DOA正常／SELF | 單一可存取h2、六入口／案件總覽；1440 desktop／390×844 mobile menu；Hub內容寬度斷言；SELF blocked保留shell頁名與真提示。 |
| Mailroom＋Repair native組合 | native heading各恰一個、shell不重複；真Help event及account menu；refresh、收發awaiting tab與repair mine tab GET均company-B；1440／390手機menu、Help仍可操作。 |
| 不可用頁面 | mailroom/repair各denied＋disabled、repair缺公司：無native h2、shell非空／對應repair頁名、原短阻擋；無workbench API calls。 |
| 外部邊界 | 每頁healthy檢查0 React/page errors、0 external origins、0unexpected API boundary。HTTP route只准loopback GET。新增兩workbench情境明確GET only。 |

第一個既有dashboard leaf保留 **12次JS adapter synthetic POST**（三個manual sync controls），company-B與日期範圍全按原assertions驗證；它們不進HTTP transport。故整份fixture可說 **實際HTTP／外部／真業務POST=0**，不能說JS mock POST=0。沒有真同步／寫入。

fixture自身用mkdtemp獨立Vite cache＋ephemeral loopback port；私有preload只包createServer設`hmr:false`。無source overrides、無render/API行為替換新增、無assertion弱化；原fixture的auth／API／WebSocket及無關widgets受控邊界維持。

## 本 part沒有重新執行的範圍

- 原owned Awaiting 1/1、五頁29 synthetic GET與Recipient 1/1、backend116：**NO-RERUN／SAME_BYTES**。只以精確9b7 bytes連結先前實跑，不假稱6cc新跑，也不累加GET為tests。
- Module8：**NO-RERUN／SAME_SOURCE_ONLY**；Module/Hub/model/原test同6ad，該fixture不import DashboardLayout。中央reported8或先前receiving8均不列本 part新實跑。
- 維修suites、frontend/backend build／types／lint、Prisma、中央knowledge：本 part未跑；中央與root各自reported或另part結果不代簽。

## 限制

1. 這次是actual components＋synthetic boundaries；未登入真人／測後端token資格、未建立真正Source單或執行business writes。後端sourceCases semantics採source/spec實讀及bytes承接，不冒稱本輪HTTP/DB驗證。
2. Module native客服補建完整DOM、Source四類表單auto-prefill、iframe/native action完整流程未在此套件跑；保留原receiving界線。Help僅驗原event，不是Claw實際答案驗收。
3. Mobile驗menu與Help可操作／heading名字；只有Hub測content overflow。沒有新mailroom/repair composition像素截圖或全keyboard focus／WCAG驗收，不能把role/name assertions擴稱全a11y或所有mobile width PASS。
4. isolated repair disabled fixture直接mount Page短Alert；App實際disabled redirect保持相同source但不是這次DOM覆蓋。Source/AI寄出consumer、LINE／財務／库存與實物簽收仍不由此fixture證實。
5. 本 part沒有cloud metadata、build狀態或traffic查詢；中央Cloud Build／main f3的狀態由發布root另驗。此scope PASS不解除DEV／營運的獨立gate。

## 可重現命令與私有證據

Git命令cwd為review tree；Node命令cwd為其 `frontend`。

```sh
git rev-parse HEAD
git status --porcelain=v1
git show --no-patch --format='%H%n%P%n%s' HEAD
git diff --name-status c932d30f2d9ce8453f9910d257920d5465145c4e 6cc903951d42d3f0e9aa5556598595397734859b
git diff --name-status c932d30f2d9ce8453f9910d257920d5465145c4e 6cc903951d42d3f0e9aa5556598595397734859b -- frontend backend scripts ':(exclude)backend/src/modules/ai/knowledge'
git diff --check c932d30f2d9ce8453f9910d257920d5465145c4e 6cc903951d42d3f0e9aa5556598595397734859b
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --import /var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-final6cc-scope-410rkehc/review-preload.mjs --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-reporter=tap --test-concurrency=1 tests/workspace-company-dom.test.mjs
```

Git ancestry／lineage採本機固定objects，stable patch-id由 `git show --pretty=format: --binary <SHA>`餵給 `git patch-id --stable`。Source比對以兩ref的 `git show <ref>:<path>` bytes、`git rev-parse <ref>:<path>` OID與Python hashlib.sha256，同時比當前tree檔案；詳列於私有JSON。

| 最後來源 | SHA256 |
| --- | --- |
| `frontend/src/pages/mailroom/MailroomPage.tsx` | `1d568fcdc3cdb4f88b276bd804932568542ea2d4a478d835cc9f31d347177e49` |
| `backend/src/modules/mailroom/mailroom.service.ts` | `220b470dd7f3289340aba4c63cebcc463bcda2f3212746f7cf2a3e98fa438b51` |
| `backend/src/modules/mailroom/mailroom-source-cases-access.service.spec.ts` | `d2f303d3e2af2745ac61e0f4548f5659e40cf6356d1cd181145460c7e1c57428` |
| `frontend/src/pages/mailroom/mailroom-dispatch-pending.ts` | `d9e46462a9c000d3b1feca5a5f2930c2071182e1c0de46e8d949d0d363f58c65` |
| `frontend/src/pages/mailroom/mailroom-draft.ts` | `c87cdd43ad6969109c016b4141f054a521234aae542443393bdd10e91064dbd4` |
| `frontend/tests/mailroom-awaiting-dom.test.mjs` | `389e7a2e012b3d60cf4005349b2744e90ba7941637a886bc8d97cf721e1aec85` |
| `frontend/tests/mailroom-recipient-dom.test.mjs` | `779abafef0ed4ffe7c14195038480e22df49e6b3ab195573b273c2c0dc047f63` |
| `frontend/src/components/DashboardLayout.tsx` | `9f0d919c892e1683380c15eae78bffc91d0f682c6937825566b05f7eed86133d` |
| `frontend/tests/workspace-company-dom.test.mjs` | `00c27d7cef9b477c1c801775100ee19d0f95db93b57afa1ea83c0e3411da787c` |

私有runtime：`/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-final6cc-scope-410rkehc`。

| 私有證據 | SHA256 |
| --- | --- |
| scope-proof.json | `c38318400176bebe4c14ec6d32274072dcc4a7778309558654bfd00d39f4beae` |
| lineage-proof.json | `cf82c59d9a9f78d4e5fb573de7bba073a462a83ad033d30d402670f0cae7413c` |
| after-dom-proof.json | `508f04e4ad9573702acce20f154cd1ced8c0359f53c91232076fe623e846719a` |
| company-layout.tap.log | `02d719663664d4134eac6ec290e9c0228ba31de13d5bd60b18d4e26409ed66ba` |
| review-preload.mjs | `cbea4f5dabb72cbe877d6589cf03c60c85a2f0274094e6205937e20fde827db4` |
| vite-wrapper.mjs | `b3f5bbfe0a19e3fc2c182551b5c0a5ad80fcd961855294f56187ba8dedd025b6` |

本 part終了固定HEAD與tracked clean已驗；回執文件位於rootcoord，不寫reviewtree或自引用自身commitSHA。
