# 維修三入口與本人待辦交付（2026-10-08）

## 產品結果

六個頂部分類縮為「我的待辦」（預設）、「待認領與簽收」、「案件查詢」。我的待辦只呈現目前本人可處理的檢測、文件／複驗、當版放行後施工、原件退回及原廠返還簽收；等待客服、顧客同意及款項不作施工待辦。待認領沿原生認領／本人實物簽收流程。案件查詢保存所有原生類別、等待與歷史資料，分類篩選按需展開；已套用條件可見且能移除。

保留照片、產品／案件名稱、姓名、電話、案件編號及目前進度六欄清單與開案。只有待辦及待認領顯示紅件數；查詢入口不標成新工作。付款與顧客確認資料留在當件，主進度只有本地檢修／客服及來源當版證據相符時才顯示等待款項／待開始維修。原件拒修、送廠及終態不套施工提示。

## 固定基底與編輯邊界

新工作樹 `corely-erp-repair-action-queue-20261008`，branch `codex/repair-action-queue-20261008`，origin `https://github.com/moztechCEE/ecom-accounting-system-.git`。explicit named fetch、FETCH_HEAD、ls-remote核對00b及最新共同a164：`00b76220c25ef9aabb4b955b367a252c61c0aea6` runtime；`a1644999098e488322059148db09ee42c5ae64fc` 只有一份發布文件。DOA通知 API/Web00b 雙100%，本批尚未部署。

前批固定9b6／2c另在此樹以3e7／d26接入，a164文件以e06接入。新功能 diff 起點 `e06f7e751132cdb51f062fa2010843efa89daa46`，累積共同a164→HEAD另含前批六欄與native照片／counts API；兩批不要混為同一次測試。

DOA明確指派本批新增todo service/DTO/contract/spec及 RepairWorkbenchController只讀GET、MailroomModule provider追加。保留 MailroomQuery、mailroom.service/list/views/tasks/native status/write、schema／財務／來源橋接／共享導航原文。Module與收發新增providers由DOA中央逐項合併。knowledge三檔由DOA單一編輯；本檔提供雙語草稿，不能當中央generator或DEV驗收。

## Read API

`GET /repair-workbench/todo?entityId=...&page=1&search=...`；`summary=true` 只省畫面列投影，資格／完整件數仍核對。

回傳：`{items,total,page,queueCounts:{todo?,acceptance},countExact,unknownCount}`。todo件數為全公司本人候選判斷，不受搜尋／頁碼影响；total為已確認待辦之搜尋結果。只在countExact=true回確切todo徽章。來源不可用或預算內未核對完成，unknownCount與countExact=false保留；畫面不造0或空待辦。接手／保管／施工／複驗／款項／发票／通知仍是原有獨立契約。

伺服器重新讀取本人／公司／repair read／update及原生實物，完整候選先分類，待施工以fresh Source去重GET、原生 currentCsrReview與requireSourceConsent(..., true)核當版同意、有效金額及必要實收款，再filter→count→slice50。不依賴mine、OPEN task、PAID字樣、舊snapshot或當頁50列。進行中列為文件／複驗工作不代表交回ready；原完成、庫存与當版放行守門照常重讀。

前端原生查詢成功就先顯示可操作列；todo summary慢或503不攔查詢，依同generation後續更新徽章。任一同範圍401/403立即清除舊聯絡、照片及件數。Source不可用簡短實況告知，不加入操作教學。深連結itemId獨立於隊列；舊all/mine/waiting/delivery/records URL保持原API範圍，查詢點擊明確保留queue=all。草稿退出／切分類／重新讀案維持原confirmDiscard。

## 驗證

Frontend：新 action DOM 15 TAP（14子案例＋父）PASS；原 case-list 10 TAP（9子案例＋父）PASS；root親跑 ui-layout 1、dispatched-page 1 PASS。共27 TAP／25葉案例、無skip，涵蓋三入口、legacy/deep link、on-demand filter／Back／page、dirty cancel、WS／late entity、slow summary仍可操作native列表、unknown不假空、native與summary403清除聯絡／照片／Blob、7種todoKind、新版detail仍欠款不得開工與17組當版進度否定。清單1537／1104／390px及圖片生命週期保留。全部為本機fixtures，不能代簽後端放行或DEV驗收。

Root frontend app/node型別、範圍lint無error、privateVitebuild、diff check PASS；舊 browser-map／caniuse／chunk warnings 保留，未升級依賴。Backend最終固定結果與 raw 證據見下方。原 ui-layout與dispatched-page測試僅修改入口及新的只讀summary mock，原書寫／歷史／readonly斷言保留。

Layout早期先遇Filter圖示可讀名定位，再遇Ant Select input被selection span覆蓋；正式Button補aria-label、測試改點正常可見selector後1/1 PASS，沒有force-click或跳過斷言。新action DOM早期有兩個native案例名稱定位及React URL/effect不同步假設，改用案件row、實際Tag／row可見等待後15 PASS，沒有以舊綠結果覆蓋失敗紀錄。

獨立靜態審查找到兩項P2後已修：過期本地review曾誤顯等待款項；原native list曾等待summary而延遲403清除。修正使用當版本地CSR/review/source與獨立native settle，追加真DOM否定案例。早期未通過測試與最後結果分列，不用mock畫面代簽後端／DEV流程。

## Claw 中文草稿（供DOA中央審查）

維修工作台預設開啟我的待辦。直接開案，依目前實際作業填檢修／維修與複驗。待認領與簽收保留逐件認領、本人收到及核對實物的分別紀錄。等待客服、顧客同意與付款保留在當件進度，當版正式報價、顧客同意、必要實收款與客服方案有效後才回施工待辦；免費案仍需當版同意。已施工案件的文件／複驗待辦不代表可交回，完成仍須原伺服器放行、當版維修單／逐項PASS與實物交接。

案件查詢保存原等待及歷史分類，按篩選選我的案件／等待中／已交辦收發室／完成紀錄；實際篩選可見及可移除。原all/mine/waiting/delivery/records網址保持原范围，帶itemId可直接查原案。待到貨／在途實際資料位於待認領按需展開。新紅件數取完整原生待辦，非頁內筆數；來源或權限讀取失敗不能當0。發票、款項、通知、物流、實物保管及真實庫存能力未因入口整理新增，原操作仍每次核資格／公司／版本／來源。

## Claw English draft

The repair workspace opens My tasks by default. Open the native case and record actual inspection, repair and verification work. Claim and sign-off keep claiming, physically receiving and verifying each item as separate records. Customer-service, consent and payment waits remain within the case. Work requiring release returns to the technician queue only after the current native CSR review, quotation, customer consent and required confirmed payment agree; free repairs still need current consent. Ongoing document/verification tasks do not establish completion eligibility: original server release, current repair report, passing checks and physical handoff still apply.

Case lookup retains waiting and historical categories. Open filters for My cases, Waiting, Handed to mailroom and Completion records; applied filters stay visible and removable. Legacy queue URLs retain their original native scope, and itemId deep links open the same case independently of the list. Arrival/in-transit records are optional under Claim and sign-off. Red counts come from the full native action queue, not the current page. Unavailable release information or denied access must not be represented as zero. This navigation change does not add invoice, payment, notification, logistics, custody or inventory capabilities, and every original command continues its authorization, entity, version and source checks.

Guide source paths: frontend/src/pages/repair/{RepairWorkbenchPage,repair-list-model,RepairCaseList}.tsx/ts; backend/src/modules/mailroom/{repair-todo.service,repair-todo.contract,repair-todo.dto,repair-workbench.controller,mailroom.module}.ts. Final tracked paths/hashes由中央依固定版生成。


## Native operation proof

Root executed AST/byte comparisons against e06f7e751132cdb51f062fa2010843efa89daa46. loadDetail, ArrivalPreview and historyNote are exact. RepairDetail only adds the progress display helper to the status tag; removing that fragment restores the exact native body. CasePhoto lifecycle is exact. Eight protected paths (mailroom.service/dto/repair-list.contract/repair-workbench.service/repair-workflow.contract, RepairDocuments, RepairWorkflowPanel and repair-model) are byte-identical. The original action payload, version/requestId, dirty guards, authorization and finance predicates remain unchanged. Proof /tmp/repair-action-native-proof-20261008.json SHA256: 418aa32283325b20657381b8eff38d3d6d1b4280d310eae8a192c7bcc3002a22.

Full candidate reads select predicate/search/binding/version fields and exclude image evidence, raw source snapshots and repair reports. Source waits are followed by fresh actor and native candidate reads. Only at most 50 current-page rows can hydrate native evidence and contacts, constrained by ID/version and the same scope; summary never hydrates. A changed or absent row is excluded and marked unknown instead of exposing an old ready row or a complete badge. Source launches stop 16 seconds after request start, with the existing 8-second in-flight timeout. This is a read projection, not an action grant or an invoice/payment/notification implementation.


## Backend frozen validation

Four suites / 186 distinct tests PASS: new todo 106 (58 pure predicates, 29 service cases and 19 actual Nest controller/production JWT cases), plus 80 existing tests across three regression suites. Earlier 99/100 intermediate runs are not added. The production JwtStrategy/B2bAwareJwtAuthGuard and actual MailroomService.actor/views were used with synthetic database and Source dependencies; no external fetch or real database/business write occurred.

The new four files pass standard ESLint; the two wiring files pass typechecked ESLint with only formatting disabled to preserve existing methods. Build-config noEmit passes. Full-project strict type check was not rerun; its prior 124 baseline diagnostics are not claimed fixed. Root Nest build and frontend app/node type checks, scoped lint, private Vite build and diff checks pass.

The final narrow todo service re-reads native candidate status/custody/owner/next/inspection after Source waits and hydrates only current-page ID/version/scope rows. Native races, absent/malformed Source data and unlaunched source checks remain unknown; incomplete counts do not become zero or a complete badge. The bounded-launch tests use fake timers and actual service promises, not real 8-second waits.

## Fixed evidence index

Independent review: docs/dev/reviews/repair-action-independent-review-20261008.md, SHA256 fdb685ea381c627b314e7097e693c3d00a3052a529bb346e29db9bcf93b98abf. PASS_SCOPE covers the frozen 14 source/test blobs; it does not establish final integration or DEV acceptance. The parent owns the execution results; the reviewer independently inspected raw results, native AST/bytes and screenshots.

Root ran the frozen new suite with `node_modules/.bin/jest --runInBand src/modules/mailroom/repair-todo.service.spec.ts --json --outputFile=/tmp/repair-todo-final-results-20261008.json` from backend. 106 passed, 0 failed, 0 pending. Raw JSON SHA256 20659d2a50634412d1974fa98a6a01ebca38e27b4fe0820da981568a0dbb385c; stdout /tmp/repair-todo-final-20261008.log SHA256 fdd305ecb70939187bed3f212b27e12ae8a10493f5fafc4d3235268bd800fe6f. This rerun is not added to the 186 distinct tests.

Latest local synthetic previews: /tmp/repair-action-queue-20261008-{1537,1104,390}.png; full hashes are in the independent review. Private Vite output /tmp/repair-action-build-20261008 is not a DEV deployment. Final feature SHA and remote verification are recorded in repair-status.md and the technical handoff after commit. DOA centrally merges provider additions, guides and all peer fixed versions before verifying the final integration SHA.
