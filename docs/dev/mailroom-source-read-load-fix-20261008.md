# 收發來源讀取與未知清單修復交接（2026-10-08）

此批修復兩個原有 P2：已有收發讀取權限的人，因額外客服權限而被建案本人資格擋住 GET；以及清單讀取失敗仍顯示「0 筆／沒有案件」。DOA 的只讀 trace 已確認前者核對的是目前 GET 呼叫者的 Employee，並非 Source 案件承辦客服映射。本視窗先前以「客服帳號綁定錯誤」概稱，已更正。未核實或更改 EASON 的實際 Employee／公司資料。

## 固定基底與修改權

- repo `https://github.com/moztechCEE/ecom-accounting-system-.git`；隔離 tree `corely-erp-mailroom-ui-cleanup-20261008`，ref `codex/mailroom-ui-cleanup-20261008`。
- parent／前 UI 批 `9ccabf973e9ee6ee41eb38a289dab371decc893a`，開始 clean、ls-remote exact；新 commit 保留 9cc，不 amend。完整新 SHA 於提交後另交接並核對遠端。
- DOA 明確將 `MailroomService.sourceCases()` 純讀取分支及 owned `AwaitingCases` 交本視窗修復；各檔單一編輯，未在中央／他人工作樹修改。
- 相對 9cc 六個路徑：service、Page、兩個新 meaningful tests（source access／actual awaiting）、原 Recipient DOM 的 normal Escape 穩定修正、本文件。原 UI cleanup 六 production 路徑仍按前份交接追溯。

## 權限與資料行為

| 讀取能力 | sourceCases 結果 |
| --- | --- |
| mailroom:read（含額外 CSR grants） | 先驗現行 active actor 與公司，沿原 full-list read；不要求 intake Employee／sales write資格，也不呼叫 intake 模組資格檢查。 |
| repair_workbench:read only | 沿原 REPAIR filter，不新增 RETURN讀取。 |
| CSR-only，完整 intake 資格成立 | 仍驗原 Employee、sales ENTITY、Source modules／writeModules及三個 Native grants，才回全類清單。 |
| CSR-only，不成立 | 原錯誤拒絕、零來源 fetch。 |
| repair＋CSR，完整 intake 資格成立 | 保留原合法 CSR 全類清單。 |
| repair＋CSR，intake 明確 ForbiddenException | fresh actor／公司／repair_workbench:read 重新核對仍有效後，僅回 REPAIR；撤權、停用、跨公司仍拒絕且零來源 fetch。 |
| gate 未知／DB／ServiceUnavailable 錯誤 | 不吞掉或 fallback，原樣拋出。 |

enabled、active account、公司及來源 search／awaiting／cursor 均保留。除 sourceCases 以外 service 各方法文字完全相同；原 create／claim／bind／physical acceptance／inventory／notification／transaction 等 write gates 沒有改動，讀取成功不等於有本人接手或寫入資格。沒有新增 endpoint、permission、schema、migration 或 AI tool。

待到貨使用同公司＋同搜尋的成功 snapshot 與 scope-keyed error：

- 未有成功回應時顯示「清單未載入」，不建立零筆快照；只有成功 empty 才顯示 0／目前無案件。
- 同 scope 的 revision、manual retry 或 quiet refresh 失敗，保留最後成功 rows／數量並標「未更新」。已知 empty 遇失敗改稱「上次查詢沒有待到貨案件」。
- 公司／搜尋一變，在 render 即不顯示另一 scope 的 rows、cursor 或 error；舊回應仍須符合 generation 才可更新。新 scope 從第一頁讀取。
- refresh 保留已載入頁數，完整刷新成功才替換快照；load-more 不會清除之前 full refresh 的失敗標記。pagination 成功不是整份清單已更新。
- 顯示處理不改原收件、照片、Source 版本／容量核對、pending body/key、dirty、本人簽收、寄出、庫存及通知語意。

## 最後來源測試

測試全部 synthetic／離線；沒有真人帳號查詢、DB、真 HTTP business write、外網、通知、退款或庫存操作。

| 項目 | 最後有效證據 |
| --- | --- |
| 原 9cc backend counterfactual | 新 access matrix 64 中 41 PASS／23 FAIL，真正重現 mailroom+CSR 過度 gate 與 repair fallback／fresh recheck 差異；原失敗保留。 |
| 修後 backend | 3 suites／116 tests PASS：access64＋原repair-access33＋intake19；所有 matrix 情境均斷言零 writes／notifications，拒絕情境零 sync.cases。 |
| 最終 Awaiting actual DOM | 1/1 PASS（6.55s），4 個隔離頁面序列／22 次合成 GET（不是22 tests）；首次503、真empty、search/company切換、revision/quiet/retry、stale empty、晚到回應與pagination不假清freshness。零 POST／外網／未預期 calls。 |
| 相同最終 DOM fixture＋9cc Page | 0/1 FAIL，首次503同時顯示零筆與無案件；固定 bytes hash dd4d3168，確定不是 selector/startup 錯誤。 |
| 原 Page／Recipient DOM | 2/2 PASS：照片／忙碌／實物點收／草稿／reload同body-key／stale／mobile原斷言保留；Recipient保留所有原斷言，只在兩個外部 fixture state 按鈕前正常 Escape 關 AntSelect popup 並 wait hidden，避免popup攔 click。DOA 的原9cc Recipient receiving FAIL不覆寫，本批補正正常操作。 |
| Types | app／node及backend build-config --noEmit PASS，私有 build info。完整 backend tsconfig 嚴格檢查仍124項既有診斷；與固定9cc每項相同，零新增／移除，不能冒稱全 tsconfig PASS。 |
| Vite production build | PASS，私有cache/dist；既有browser-data/chunk警示保留，未升級dependencies。 |
| Scoped lint | Page＋兩affected前端tests：0error／3既有warnings；service＋new spec：0error／2既有warnings。 |
| Scope／diff | service除sourceCases byte-equal；Page delta只AwaitingCases；其它寫入／guard helpers保持9cc；diff check PASS。 |
| Knowledge --check | FAIL：仍先遇9cc已刪NextStep引用ENOENT。未write；由DOA中央合UI packs後更新雙語、paths/hashes，再以最後整合SHA重跑。 |

實際 runner 使用私有 Vitecache／HMRfalse／ES2022，typed fixtures載入真 Page／AntD，而非單獨重造UI。AntD按鈕正常accessible-name空格與input的searchbox角色已按實際DOM修正；harness途中錯誤不算產品counterfactual。最後綠來源 hash 前後相同。

## 來源 hash 與精確命令

| 路徑 | 最後 SHA-256 |
| --- | --- |
| backend/src/modules/mailroom/mailroom.service.ts | `220b470dd7f3289340aba4c63cebcc463bcda2f3212746f7cf2a3e98fa438b51` |
| backend/src/modules/mailroom/mailroom-source-cases-access.service.spec.ts | `d2f303d3e2af2745ac61e0f4548f5659e40cf6356d1cd181145460c7e1c57428` |
| frontend/src/pages/mailroom/MailroomPage.tsx | `58237330b3127a2ef583d243f16c76eb03eacfb23467456d0c037e52909d61c9` |
| frontend/tests/mailroom-awaiting-dom.test.mjs | `2b6f654f3593132c8dd73b7542466fef632d22409b872158c9db39d4fd1e9711` |
| frontend/tests/mailroom-recipient-dom.test.mjs | `779abafef0ed4ffe7c14195038480e22df49e6b3ab195573b273c2c0dc047f63` |

Backend cwd：`node node_modules/jest/bin/jest.js --runInBand --no-cache --cacheDirectory=<private>/jest-final --runTestsByPath src/modules/mailroom/mailroom-source-cases-access.service.spec.ts src/modules/mailroom/mailroom-repair-access.service.spec.ts src/modules/mailroom/mailroom-intake.service.spec.ts --json --outputFile=<private>/final.json`。`<private>`為 `/tmp/mailroom-source-access-20261008.T7BPHX`，保留 `red-corrected.json`、`final.json`、`scope-proof.json`、`typecheck-delta.json`。

Frontend cwd：`TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/mailroom-awaiting-dom.test.mjs`。同命令按上述名稱跑原Page／Recipient；private runtime `/var/folders/b2/yl3zcrj945983rzqthtk07fc0000gn/T/corely-mailroom-awaiting-9cc-uuq9i9xl`保留 `green-final-3.log`／`red-final.log`／immutable9cc source與read-onlyoverride。

## 中央指南與發布

除前份 UI cleanup 的 sourcePath刪除／雙語新標籤外，DOA 應重新核對 Page與service最新hash（不是沿用9cc Page hash）。mailroom-workbench中英對應 step2／權限 boundary 補述以下可觀察行為，不新增grants或AI寫入工具：

- 中文：`清單尚未讀取成功時顯示未載入，不判定零件數；更新失敗保留同公司與同搜尋的上次資料並標未更新，重試成功後才更新。公司或搜尋切換不沿用其他清單。`
- 英文：`An unsuccessful read remains unloaded rather than proving zero cases. A failed refresh retains only the last successful snapshot for the same company and search, marked not updated. A successful retry replaces it; switching company or query does not reuse another list.`
- 中文權限：`既有收發讀取不要求客服補建資格。維修讀取限維修來源；合法客服讀取仍需完整補建本人與公司資格。兼任者資格不成立時，只可依重新核實的原維修讀取顯示維修件；寫入本人、公司及接手守門保持獨立。`
- 英文權限：`Existing mailroom read is independent of CSR intake eligibility. Repair read remains limited to repairs; full CSR read still requires intake identity and company eligibility. An ineligible combined CSR/repair role may retain only freshly verified repair read. Personal acceptance and write gates remain independent.`

DOA 暫停2643 promotion；9cc、新P2版、維修215（最新4e8文件版）與DOA6ad是不同固定批。接收端須核對新完整SHA／原失敗與修後證據，再由中央保存receipts、整合最新approved各pack與AGENTS、雙語／knowledge、build候選及普通角色DEV驗收；root不自行部署或切流量。既有候選Ready／83項UI查核不能套到此新程式。Source／AI dispatch仍PENDING_COMPATIBILITY，實物／通知／收付款／退款／庫存的界線不變。

台灣2026-10-08 06:56:25–06:57:22最後只讀部署核對：main DEV web／API仍f3f14c4104906cc6ca23bd1d38ba4589563b6801、各100%；aftersales-review配對web／API為264352c5b863d9928a36ab2a9dbecc697f35a028、Ready且主流量0%。完整來源以Artifact Registry full-SHA tags＋immutable image digests核對，revision本身沒有source SHA label。aftersales-final tag兩端當時尚不配對，不視作本批驗收。root未部署或操作流量。
