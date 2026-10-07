# 收發來源讀取／待到貨快照獨立接收：db86（2026-10-08）

**整批 HOLD：新增 P2 已在實際 MailroomPage DOM 重現。** 原 GET 過度授權守門及未知清單顯示修正通過；但 full-refresh 重試接管 pending pagination 後，`moreBusy` 沒有釋放。不得用前面綠測試宣稱此版本整批通過。

## 固定來源與操作邊界

- 接收 SHA：`db86db7b18dbef610754a5ab139477316199662d`，基底 `9ccabf973e9ee6ee41eb38a289dab371decc893a`。Root 已核 author remote/ref exact；本接收未自行操作 remote。
- 新 detached review：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-ui-review-db86db7b-20261008`。建立後讀 AGENTS、六檔 diff 與 `docs/dev/mailroom-source-read-load-fix-20261008.md`；測試前後 tracked clean。僅增加 ignored node_modules symlink，指向 Root 已有依賴，沒有 install／lock 變更。
- 作者 `corely-erp-mailroom-ui-cleanup-20261008` 最後查核仍 db86 clean；旧9cc review tree仍 clean，沒有 checkout/reset 原 tree。Root 已整合成 `e4a79bae79a8802682b4944032867b33414e57c3`（中央 knowledge/docs 有自己的後續工作），不能說 Root current 仍264或作者 db86。
- 私有證據：`/private/tmp/mailroom-p2-review-4_12txrb`。只讀 Source／actor／Prisma皆 mock，fetch failclosed；DOM僅本機 synthetic Vite fixture＋新無使用者cookie的headless browser。沒有 cloud、DB、實際 Source/API、provider、通知、財務或庫存操作。
- 唯一共享寫入是本接收報告；保留旧9cc失敗報告、EASON code-trace與 Source218更正。錯誤來自 **GET呼叫者** 的 intake Employee資格，不是已證實 Source承辦映射故障，也沒有核實 EASON真正公司／Employee。

## P2（已真實重現）

`frontend/src/pages/mailroom/MailroomPage.tsx:620` 的 `refresh()` 以 generation接管請求但沒有清 `moreBusy`；`:686` 的 `loadMore()` 設 busy，`:715–716` 的 finally只在同generation清busy。

實際正常按鈕順序：

1. 成功載入一頁並有下一cursor。
2. full refresh失敗，顯示可重試alert。
3. 點「載入更多待到貨案件」，合成GET保持pending。
4. 點alert「重試」，新的full refresh成功，列表顯示新資料且error清掉。
5. 舊pagination回覆完成並settled；generation不符，finally不清busy。

此時實際button持續 `ant-btn-loading`、disabled=false；所有四GET都settled。`:676` 的poll要求 `!moreBusy`，因此自動刷新也被卡住。影響是目前query無法正常繼續載入／自動更新，需要另一次header revision／換query才能恢復；不是資料或provider寫入。

- 真Page紅probe：`awaiting-pagination-supersede-db86.mjs`，SHA256 `9af93d4cf029238bd06ca1f9d748ed4417070ed8779834307f432c3193cf6306`。
- 紅log：`awaiting-pagination-supersede-db86.log`，SHA256 `d33bbcf82e33a3f9ab77b3acfeafdb211783c8feb4ebe8d05ba2ab1e945935ed`；1 leaf FAIL，先前六序列29GET仍通過，第七序列4GET重現busy洩漏。0business POST／0外網／0boundaryErrors。
- 最小方向：full refresh接管pagination時釋放／轉移busy ownership；仍保留旧generation不能清掉新pagination busy的守門。本接收不改產品。須由作者新增此交錯情況回歸並給新固定 SHA，再重新接收。
- 接收期間曾送出『目前無新 P1/P2』暫時訊息；新增probe後已立即撤回，最後結論以本HOLD為準。

## 已通過的局部證據（不能替代整批）

| 範圍 | 本接收真正執行結果 |
| --- | --- |
| 自寫 actual MailroomService／IntakeService runner | 9/9 PASS，no-skip。使用真actor與intakeCustomerService、mock Prisma/Source，未override actor。涵 mailroom read無Employee、兼CSR不額外gate；repair+CSR Forbidden僅REPAIR且cursor保留；fresh停用/撤權/company變更拒；非Forbidden/DB錯誤原樣傳遞無fetch；讀取放寬不能授權claim/bind。 |
| 同一自寫runner／旧9cc | 5 PASS／4 FAIL：真重現額外CSR綁定gate、缺少repair降級/fresh核對；不是import/startup問題。 |
| 作者相關backend回歸重跑 | 3 suites／116 tests PASS：new access64＋repair-access33＋intake19。這是同fixture的獨立重跑，不當成另116項新獨立case。 |
| 真Page原fixture＋獨立補例 | 1 leaf PASS，六隔離序列29合成GET（原作者22＋新增7），不是29 tests。包含初次503未知、成功empty才零筆、samequery revision/quiet/retry stale、stale-empty、公司與搜尋立即隔離、late-success、新增late-query-error隔離、pagination失敗同cursor重試去重。0POST/外網/unexpected calls。 |
| 同最終DOMfixture／旧9cc Page | 1 leaf FAIL，首次503實際顯示「0筆已載入／目前沒有待到貨案件」。只換root到固定旧Page；斷言命中原問題。 |
| 原Recipient actual DOM | 1/1 PASS。兩個外部fixture state切換前normal Escape關popup並等待hidden；原selection/department/reset/eligibility斷言保留。 |
| Scope | `scope-proof.json` PASS：service除sourceCases、Page除AwaitingCases byte-equal9cc；intake service、controller/DTO、recipient product、workflow/dispatch pending helpers、schema及AGENTS都沒有此批變動；diff --check PASS。 |

初次獨立補例harness在pagination重試以exact accessible-name抓button，被AntD loading-icon名稱變化卡住；原log保留 `awaiting-extra-fixed.log`。改成正常點擊實際 `button.mailroom-load-more` 後29GET PASS；這不是產品negative control。新增真正supersede紅probe使用同normal button selector，四GET已完成但仍loading，與此harness問題不同。

沒有重跑全backend/full frontend build或全repo typecheck；本接收不引用作者這些結果冒稱自己執行。中央知識更新／最終集成build與DEV正常角色驗收尚待新修正；未跑knowledge --write/check，不將它標PASS。既有DISPATCHED／AI Source同步 `PENDING_COMPATIBILITY` 限制沒有被本批取消。

## 精確命令與證據hash

獨立backend：

```sh
node /private/tmp/mailroom-p2-review-4_12txrb/backend-access.cjs --repo '/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-mailroom-ui-review-db86db7b-20261008' --sha db86db7b18dbef610754a5ab139477316199662d
```

作者三suite（cwd review/backend）：

```sh
node node_modules/jest/bin/jest.js --runInBand --no-cache --cacheDirectory=/private/tmp/mailroom-p2-review-4_12txrb/jest --runTestsByPath src/modules/mailroom/mailroom-source-cases-access.service.spec.ts src/modules/mailroom/mailroom-repair-access.service.spec.ts src/modules/mailroom/mailroom-intake.service.spec.ts --json --outputFile=/private/tmp/mailroom-p2-review-4_12txrb/access-regression.json
```

真Page：`node --test /private/tmp/mailroom-p2-review-4_12txrb/awaiting-extra.mjs`（綠）；`node --test /private/tmp/mailroom-p2-review-4_12txrb/awaiting-extra-counterfactual-final-9cc.mjs`（旧版預期紅）；`node --test /private/tmp/mailroom-p2-review-4_12txrb/awaiting-pagination-supersede-db86.mjs`（新P2紅）。

Recipient（cwd review/frontend）：

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/mailroom-recipient-dom.test.mjs
```

| 證據 | SHA256 |
| --- | --- |
| backend-access.cjs | beef6b2ab21880b69ed219307c7694d3fd0a59d743944247f3571559aed23acb |
| backend-fixed.log | 084e8bd0b2cb653ce7439acc919a27fc9122a5bc5e0ffb5cd6cc456e0c447a75 |
| backend-counterfactual-9cc.log | 42b039717b013d982aa0abf8513a80678f223ef5ae814c78a86888bd8ac637c6 |
| access-regression.json | 259fae897a04571b35c5e5a583defbfbe99d0228a8a847e7f7bef66e44a467f1 |
| awaiting-extra.mjs | eea8f28526c2e430d110a2e830508631a3055a0996bc6fa89259f34c3366c81d |
| awaiting-extra-fixed-2.log | c9139b28abcade724a0d897909b58c0d15b1587a045e4407dd5d584ad1afdeb0 |
| awaiting-extra-counterfactual-final-9cc.log | ffd2bf842cde5d1677868036e42dcc938f98ffbecc0587053d35c4a7b471a440 |
| recipient-fixed.log | 149e68e058dfcc689fb85cad5516860cb9944ab838ed3a44795a4a635941834c |
| scope-proof.json | c293c80ff2e24690eefec97c8ee2a98f768307b44e984c7f8788721ff8cdadee |

固定productionhash：service `220b470dd7f3289340aba4c63cebcc463bcda2f3212746f7cf2a3e98fa438b51`；Page `58237330b3127a2ef583d243f16c76eb03eacfb23467456d0c037e52909d61c9`。相符作者交接，測試後來源clean。
