# 維修接收端審查收發重試 busy 修版（2026-10-08）

**PASS_SCOPE**：固定 `9b7b86c9d4d4a81219334620d03ef8caff0f5ff1` 修復 db86 的重試接管分頁 busy P2。接收端親跑新原 Awaiting DOM 1/1（5序列29合成GET），及獨立舊more失敗／新請求ownership反例1/1（6序列34合成GET）通過，均0skip、0POST／外網／未預期calls／React或page errors／剩plans與pending。未發現新增P1／P2。此結論只涵蓋相對db86的一行修正及其回歸，不簽中央最後整合、knowledge、DEV或營運通過。

原 [db86 FAIL／HOLD](repair-review-mailroom-db86db7b-20261008.md)（SHA256 `34463ccce1aa4e2a74dc77ba6de763f88b9e4af803b690d9b547dbfb783a91bf`）保留，沒有覆寫歷史。

## 固定版本與保護工作樹

- 提交：收發室工作台 開發 `01a0f1ea-bd9e-70f0-9a41-72e5c4eccc31`。
- 接收：維修工作台 開發 `01a117fd-0a9e-7882-a4aa-c9a27d34f1d3`，2026-10-08 07:18 Asia/Taipei；root統合獨立前端reviewer。
- Repo／origin：`https://github.com/moztechCEE/ecom-accounting-system-.git`；ref `codex/mailroom-ui-cleanup-20261008`。
- 被審完整SHA：`9b7b86c9d4d4a81219334620d03ef8caff0f5ff1`；exact parent `db86db7b18dbef610754a5ab139477316199662d`。
- Root自行named fetch、FETCH_HEAD／ls-remote exact核對，再建立新detached `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-9b7b86c9-20261008`，開始／結束clean；已讀新fixed AGENTS、完整3paths diff及handoff。
- 依賴只建立ignored links到既有ERP frontend及aftersales backend node_modules；未安裝或升級。其他測試／輸出全在自有/tmp。
- own repair仍 `4e8a5e474763c7abb8d3d40b4f833d2d88999121`、`codex/repair-ui-cleanup-20261008` clean，未pull/reset/改其他工作樹。

## 修改及接口核對

delta3paths／102insertions、0deletions：

1. `frontend/src/pages/mailroom/MailroomPage.tsx`：refresh取得新generation後，624行新增 `setMoreBusy(false)`，接管被取代分頁的busy。
2. `frontend/tests/mailroom-awaiting-dom.test.mjs`：42行第5隔離頁面回歸。
3. `docs/dev/mailroom-awaiting-retry-busy-fix-20261008.md`：59行handoff，保留兩端紅證據及發布界線。

Root實跑private scope proof：Page刪除上述唯一一行後全文與db86 byte-equal；test刪除唯一第5序列後全文byte-equal。backend、AGENTS、scripts、frontend config/services/repair、Recipient元件及原Recipient DOM的Git objects全相同。diff check PASS。原API、query/params、payload/key/version、schema、Employee／公司／permission資格、forms、writes、照片、本人簽收、物流／財務／通知等程式不變。

原loadMore finally generation guard保留，過時success/error/finally仍不動新請求；原footer `disabled={loading}`保留，full refresh未完成不能反向開始分頁。沒有新增常駐說明／教學文字或AI寫入能力。

## 本輪獨立實跑

| 本輪實際執行 | 結果 |
| --- | --- |
| 新fixed原tracked Awaiting DOM | 1/1 PASS、0skip、exit0，leaf7.643s／total8.236s；5序列29合成GET＝11＋4＋2＋5＋7。不是29tests。 |
| 私有actualPage owner/error probe | 1/1 PASS、0skip、exit0，leaf8.732s／total8.991s；6序列34GET＝原22＋原overlap4＋owner/error/quiet/more8。不是34tests。 |
| Root immutable scope proof | exit0；Page唯一一行、test唯一42行序列、其他Git objects相同，ending clean、diff check PASS。 |
| Root讀證據／目視 | 已讀完整兩份真log、fixedsource與handoff、exacthash及兩張獨立synthetic圖；舊more503後新row無舊error，最後quiet＋more三筆正確且可繼續操作。 |

原fixed第5序列：成功cursor→fullrefresh失敗→held舊more→held Alert retry（footer disabled）→fresh retry成功且busy解除／新cursor→新more held→late舊more success不能改rows/cursor/pages或清新busy→新more完成→visibility quiet精確兩頁更新。第2頁仍有cursor但不允許多抓第3GET，用來核對晚答未增加pages。

私有probe保留原四序列22GET及原db86 counterexample成功舊回覆4GET，另加第6頁：

1. 初次成功cursor及fullrefresh503；舊more held，預定503。
2. Alert Retry成功，rows=`OWNER-FRESH`、stale/error清除、舊more尚pending，busy解除。
3. 正常點actual footer開始新held more；busy=true。
4. 釋放舊more503：舊error不顯示、alerts0、rows仍fresh；pending只有新more，actual busy仍true，舊finally不能清新busy。
5. 新more成功增加`OWNER-NEW-PAGE`且保有follow-up cursor，footer仍存在並busy=false，pending空。
6. visibilitychange触發精確兩頁quiet GET，使用返回的新cursor正常more再GET成功；三筆`OWNER-QUIET-1/2`及`OWNER-MORE-AFTER-QUIET`均保留，busy=false，零pending/errors/posts。

其他原四序列依然通過：首次失敗不是0、成功empty才0，同scope失敗保存snapshot/stale，切公司／搜尋render遮蔽舊rows/cursor/error，generation拒晚答，pagination成功不清fullrefresh stale，fullsuccess才清。

## 未重跑與真實邊界

- backend116＋真service/actor14及build-config noEmit、原Recipient1/1，都是db86接收端實跑證據。此批fixed objects不變，限定承接原結果；**沒有冒稱在9b7重跑backend／Recipient**。其他寫入guard以immutable proof保留，未重跑所有表單。
- 作者handoff的紅0/1、綠1/1、app/node types、lint／privateVitebuild為作者執行聲明；本視窗讀固定handoff與hash，不冒稱親跑作者命令，也未重跑不變fullfrontend/fullbackend/fullstrict。
- DOM走真React／AntD／Router／fixedPage，API／Source／資料全synthetic，持有／失敗回覆由fixture控制；loopback之外HTTP皆阻擋，未操作真人資料或mapping、DB、LINE、物流、金流、發票、退款、庫存、通知或production。
- Private準備稿尚未跑時的預估31GET，於最終執行前在新副本追加quiet兩GET＋normal more一GET，最終34是實際log；原準備稿與db86紅probe未覆寫。

## 命令與固定hash

原suite cwd為新fixed審查樹的frontend：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/mailroom-awaiting-dom.test.mjs
MAILROOM_REVIEW_FRONTEND_ROOT='/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-9b7b86c9-20261008/frontend' node --test --test-concurrency=1 /tmp/corely-repair-9b7b86c9-frontend-probe-20261008/mailroom-awaiting-owner-error-probe.test.mjs
```

| 固定來源／證據 | SHA-256 |
| --- | --- |
| Page | `1d568fcdc3cdb4f88b276bd804932568542ea2d4a478d835cc9f31d347177e49` |
| 原Awaiting test | `389e7a2e012b3d60cf4005349b2744e90ba7941637a886bc8d97cf721e1aec85` |
| 固定handoff | `f9724ec42d4ab280f64ac6ae5f03ed8f8cd8d73ac64f22139139dbac5f02bd7e` |
| `/tmp/repair-9b7b86c9-original-awaiting-20261008.log` | `cf37a40170ef7c3ccd821173b5d6c3934ad71848a1ecaf612af5592aded5f64b` |
| `/tmp/corely-repair-9b7b86c9-frontend-probe-20261008/mailroom-awaiting-owner-error-probe.test.mjs` | `b0fda68e1b4d1e6f6b6669b734658f3b28174c4528ec868b6d769aa296c18b05` |
| 同目錄 `owner-error-final.log` | `e19f72399ee9fdd239be608741f54494900324f161bc348c9193bc5e38491c83` |
| `/tmp/repair-9b7b86c9-scope-proof-20261008.json` | `40695eae85312b04a0598a64051218030a53183a82ab97b607be144d299b8c6c` |
| `/tmp/repair-9b7b86c9-frontend-review-20261008.md` | `3b89ea53bfed79aee4ec260db72d97337da6717603366be239b36a71e902d623` |

Root已目視 `/tmp/corely-repair-mailroom-9b7b86c9-old-rejected-new-pending-20261008.png` 與 `/tmp/corely-repair-mailroom-9b7b86c9-quiet-and-more-recovered-20261008.png`。Private後端service hash仍db86原 `220b470dd7f3289340aba4c63cebcc463bcda2f3212746f7cf2a3e98fa438b51`。

## 中央後續

DOA將修後fixed與原db86 FAIL、新接收回執一起保存／整合，再按最後共同SHA驗證；Page guide sourcehash須改為1d568f…，不能沿用db86的582373…，也不能以先前中央e4a的knowledge/其他PASS替代修後final check。本視窗沒有merge/push收發或中央、沒有knowledge --write、没有部署／切流量；最後新SHA、candidate、正常角色DEV与現場/外部驗收仍由中央統籌。SourceAI dispatch維持PENDING_COMPATIBILITY。
