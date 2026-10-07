# 維修接收端審查收發 db86（2026-10-08）

**結論：FAIL／HOLD，新增 P2 已在 actual MailroomPage 重現。** 載入更多尚未完成時按失敗 Alert「重試」，整份重試雖成功，分頁 busy 卻永久保留，後續分頁及背景刷新停止。後端限定範圍 PASS_SCOPE（116/116＋獨立14情境）；原 Awaiting／Recipient DOM 各1/1 PASS，與新增反例0/1 FAIL分開記錄。須作者新 commit 修正後重新接收，不以原綠測試或無 Git 衝突簽整批通過。

## 固定物件與接收範圍

- 提交：收發室工作台 開發 `01a0f1ea-bd9e-70f0-9a41-72e5c4eccc31`。
- 審查：維修工作台 開發 `01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`，2026-10-08 07:08 Asia/Taipei；root 統合兩名獨立接收 reviewer。DOA另有獨立反例，不冒稱本視窗執行對方 probe。
- Origin：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- 指定 ref：`codex/mailroom-ui-cleanup-20261008`。root 先 named fetch 與 ls-remote 核對完整 SHA，建立新 detached 審查樹。
- 被審：`db86db7b18dbef610754a5ab139477316199662d`；exact parent `9ccabf973e9ee6ee41eb38a289dab371decc893a`。
- 審查樹：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-db86db7b-20261008`；開始／結束 HEAD exact、tracked/untracked clean、diff check PASS。
- own repair 仍為 `4e8a5e474763c7abb8d3d40b4f833d2d88999121`，獨立 `codex/repair-ui-cleanup-20261008` clean；沒有在他人樹 pull/reset/覆蓋。
- 6 paths，951 insertions／31 deletions：sourceCases service／新增 access spec、AwaitingCases／新增 Awaiting DOM、原 Recipient fixture 兩處正常 Escape、handoff。
- 原接口、schema、permission names、write commands、native contracts、DTO、來源版次、本人簽收、request key/hash、款項／庫存／通知入口未改。Page 的 AwaitingCases 以外前後全文 bytes 與9cc相同；service移除唯一 sourceCases 節點後全文 bytes與9cc相同。
- 已讀固定 AGENTS、handoff及共同規則；重用 ignored node_modules symlinks，沒有安裝／升級依賴。

## 確认 P2 與可重現行號

所有行號指被審 db86 的 `frontend/src/pages/mailroom/MailroomPage.tsx`：

1. 第一頁成功、有 cursor；full refresh 503後保留同 scope snapshot與未更新標示。
2. 正常點「載入更多」，將該合成 GET保持未回。
3. 正常點原 Alert「重試」（744行在moreBusy時仍可點）；refresh成功取得新第一頁及cursor，stale清除。
4. 釋放舊 more 回應；generation正確拒絕舊rows，但busy沒有釋放。
5. 4個反例GET皆settled、pending=[]、boundaryErrors=[]、POST=0；實際 `.mailroom-load-more` 仍含 `ant-btn-loading`、disabled=false，fresh row正常。正常Playwright再點按鈕（無force）新增GET=0；visibilitychange quiet新增GET=0。

根因：refresh 623行換generation卻未清moreBusy；658行只清loading；715–716行新guard使舊loadMore finally不再清moreBusy。後续687行直接拒絕loadMore，675–677行poll也被busy阻擋。scope／revision effect 668行或全頁重新整理可恢復，Alert重試成功本身不能恢復。

建議作者在full refresh接管時釋放被取代分頁的busy，或另追蹤request ownership；保留晚答generation拒絕，避免舊finally清新請求。新增正常操作重疊回歸，驗fresh footer可用、舊回應不改rows/cursor/pages、新more及quiet可再請求。維修不代改收發程式。

## 實跑結果與語意

| 實跑／核對 | 結果與界線 |
| --- | --- |
| backend指定3 suites | 116/116 PASS，fail/pending0，1.416s；source access64＋repair-access33＋intake19。 |
| 獨立backend真service/actor probe | 14情境PASS；fresh撤repair權限／公司membership／active／Employee資格反例零Source cases fetch，未知Error／503同object拋出。 |
| backend build-config noEmit | exit0、診斷0bytes；沒有重跑full strict，也不把既有124診斷改成PASS。 |
| 原tracked Awaiting DOM | 1/1 PASS，0skip，leaf5.823s／total6.292s；四序列22合成GET（非22 tests），POST／外網／boundary errors0。 |
| 原tracked Recipient DOM | 1/1 PASS，0skip，leaf7.617s／total7.999s；正常Escape前置修正保留原UUID／Form外部更新／disabled／本人eligible等斷言；production Recipient未變。 |
| 私有actualPage overlap反例 | 0/1 FAIL、0skip、exit1，leaf6.736s／total6.991s；真assertion `true !== false`，非fixture啟動／定位器錯誤。原四序列先通過，第五序列4GET全完成仍卡busy。 |
| Page/service immutable範圍 | PASS_SCOPE；原其他write／photo／dirty／pending／payload／key／version／本人及交運guards無變。 |
| root ending evidence | own4e8與reviewdb86皆exact clean，diff check PASS，root已讀完整兩memo、final log及程式行號，目視synthetic screenshot新rows＋殘留spinner。 |

後端語意：獨立mailroom read略過CSR資格但保留enabled/現行actor/entity；CSR-only仍需完整Employee／公司／Source scope與三native grants；repair-only原REPAIR filter保留。只有ForbiddenException＋原repair read可走fresh actor/entity/repair permission重查後REPAIR降階，撤權／停用／跨公司拒絕且零fetch；未知／DB／503不吞掉或轉空。讀取放行沒有放寬intake寫入。

Awaiting其餘範圍：首次失敗顯未載入而非0；成功empty才顯0；同scope失敗保留最後成功snapshot；render依company/search即时遮蔽舊scope；late response拒絕；full refresh全部成功才替換，保留已載頁數；pagination成功不清full-refresh stale。busy ownership漏洞獨立列P2，不能用其他通過覆蓋。

9cc原Recipient0/1 locator FAIL及私有Form probe1/1 PASS歷史保留。db86本次是修Escape後原tracked suite親跑PASS，沒有用private probe替原測試簽PASS。新overlap初版accessible-name定位timeout已改成只讀class後得到真assertion FAIL；初版runner／locator錯誤不累加為產品反例或通過數。

## 重跑命令及證據

Backend cwd 為固定審查樹的 `backend`，私人輸出 `/tmp/repair-db86-backend-20261008.21lQgM`：

```sh
node node_modules/jest/bin/jest.js --runInBand --no-cache --cacheDirectory=/tmp/repair-db86-backend-20261008.21lQgM/jest --runTestsByPath src/modules/mailroom/mailroom-source-cases-access.service.spec.ts src/modules/mailroom/mailroom-repair-access.service.spec.ts src/modules/mailroom/mailroom-intake.service.spec.ts --json --outputFile=/tmp/repair-db86-backend-20261008.21lQgM/results.json
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --tsBuildInfoFile /tmp/repair-db86-backend-20261008.21lQgM/backend.tsbuildinfo
node /tmp/repair-db86-backend-20261008.21lQgM/probe.cjs '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-db86db7b-20261008'
```

Frontend cwd為固定審查樹的 `frontend`：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/mailroom-awaiting-dom.test.mjs
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/mailroom-recipient-dom.test.mjs
node --test --test-concurrency=1 /tmp/corely-repair-db86-frontend-probe-20261008/mailroom-awaiting-overlap-probe.test.mjs
```

| 本機證據 | SHA-256 |
| --- | --- |
| `/tmp/repair-db86-backend-review-20261008.md` | `7128f8159a0730b2a64cf13ae0195da340faf09658f9b9b9bb13783075cb7ded` |
| `/tmp/repair-db86-frontend-review-20261008.md` | `87ea33d107e2e83e74ddced6060fb79418870cfd5d511e7ddbc21fcf873a4327` |
| `/tmp/corely-repair-db86-frontend-probe-20261008/mailroom-awaiting-overlap-probe.test.mjs` | `3bbb12c9d0bcf6d7dbf99205bc31ffed1bfe06baac4e03184c2efb88e8ef0f5d` |
| `/tmp/corely-repair-db86-frontend-probe-20261008/overlap-final.log` | `2a531ae457eade4b44e26747ac7eb85b8f9679927c43216d931f0698598dbed9` |
| `/tmp/corely-repair-db86-frontend-more-retry-stuck-20261008.png` | `0bd52a269fc9f422f8382a0aa5196d41b3548358a85cbfaf2a2c98ac69eb6ccb` |

固定service `220b470dd7f3289340aba4c63cebcc463bcda2f3212746f7cf2a3e98fa438b51`、Page `58237330b3127a2ef583d243f16c76eb03eacfb23467456d0c037e52909d61c9`、access spec `d2f303d3e2af2745ac61e0f4548f5659e40cf6356d1cd181145460c7e1c57428`、Awaiting test `2b6f654f3593132c8dd73b7542466fef632d22409b872158c9db39d4fd1e9711`、Recipient test `779abafef0ed4ffe7c14195038480e22df49e6b3ab195573b273c2c0dc047f63`，與作者handoff一致。

## 後續與未驗界線

- 已向DOA及收發發完整P2證據。收發認領單一編輯Awaiting＋overlap regression，以新commit交完整SHA，不amend db86。DOA已通知中央整合e4a含db86，须保持HOLD，不把e4a知識／其他局部通過當本P2解除。
- 此回執及原FAIL須由DOA隨產品repo保存，修後追加獨立回執，不覆蓋歷史。修後主要重審Awaiting接管busy／舊finally／freshness／scope／晚答及新regression，對未改backend／Recipient以fixed bytes對照保留原scope證據。
- 全部API／DB／Source／外部邊界為synthetic；本視窗未操作真DB、LINE、通知、金流、退款、庫存、production，也未commit/push/merge/deploy收發程式。
- 未親驗真人EASON／普通員工DEV配置、物品交接、銀行／發票／物流／ECOUNT；未驗中央最後新SHA或新candidate。固定db86 knowledge歷史ENOENT與中央另批guide PASS分開，沒有--write或借用中央結果簽本批發布。
- DEV主流量f3、264候選0的最近資訊是DOA／作者唯讀報告，本回執未重新讀雲端即時值，不宣稱目前部署已變。
