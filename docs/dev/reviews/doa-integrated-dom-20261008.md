# DOA 主整合樹真 React DOM 審查（2026-10-08）

結論：**PASS（以下 7 個合成 DOM fixtures 的整合範圍），未發現受測情境新增 P1／P2。** 7 個 top-level fixtures、17 個葉測例全部通過；Node TAP 含父測例的計數是 **19／19，fail 0、skip 0、cancelled 0**。本報告不是 DEV、Source 原頁面、正常帳戶或真實業務操作驗收。

## 固定來源與執行範圍

- Repo：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- Worktree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-aftersales-20261005`。
- 執行起始與結束 HEAD 均為 **`a3068ffc621971ade8cf100d7b06b1b461ad0296`**，parent `7b21f09b929f3a469f4e5063e1b5dba51f257642`。
- 起始 tree clean；執行中 root 另改 3 份 backend DTO、中央 knowledge／文件，並新增其他人的 review。本人不修改這些檔案、不以它們為此次前端已驗來源。結束時 frontend tracked／staged diff 均為空，所記錄 52 份相關產品 metadata 的 SHA256 全部未變。
- 本人只新增此報告。沒有產品／test／helper／generated 編輯、commit、backend 測試、DB、Cloud、部署或真 API 業務操作。
- 已先 `rg --files` 核對實際檔名。沒有 `after-sales-workbench-dom` 檔；第七組所指的實際工作台 DOM fixture 是 **`frontend/tests/after-sales-module-dom.test.ts`**。`after-sales-workbench.test.ts` 是純模型，本輪未冒充 DOM 執行。
- 七個檔案逐一 sequential 執行，前一個 exit 0 才啟下一個。使用既有 Chromium／Playwright，不下載瀏覽器。fixture 採臨時或既有 ignored Vite cache、ephemeral／port 0；沒有觀察到 port collision。

## 本人實際測試結果

以下時間為各 top-level test 的實際輸出；TAP count 包含兩個具有 t.test 子測例的父測例。

| 確切檔名（frontend/tests） | 實際命令 | TAP pass／fail／skip | 葉測例 | top-level 時間 |
| --- | --- | --- | --- | --- |
| workspace-company-dom.test.mjs | `node --test tests/workspace-company-dom.test.mjs` | 6／0／0 | 5 | 5.856s |
| after-sales-module-dom.test.ts | `node --experimental-strip-types --test tests/after-sales-module-dom.test.ts` | 8／0／0 | 7 | 16.422s |
| repair-readiness-dom.test.mjs | `node --test tests/repair-readiness-dom.test.mjs` | 1／0／0 | 1 | 2.409s |
| repair-dispatched-page-dom.test.mjs | `node --test tests/repair-dispatched-page-dom.test.mjs` | 1／0／0 | 1 | 11.279s |
| repair-feedback-dom.test.mjs | `node --test tests/repair-feedback-dom.test.mjs` | 1／0／0 | 1 | 3.776s |
| mailroom-workbench-dom.test.mjs | `node --test tests/mailroom-workbench-dom.test.mjs` | 1／0／0 | 1 | 47.439s |
| mailroom-recipient-dom.test.mjs | `node --test tests/mailroom-recipient-dom.test.mjs` | 1／0／0 | 1 | 7.616s |

七份 fixture 的 page route 均拒絕非本機 origin／hostname；API adapter、auth、socket 等外部界線採 synthetic stubs。沒有允許外網請求、真 Source／ERP 業務 POST 或 provider 呼叫。Module fixture 的 session POST 由本機 Playwright fulfill，ticket 為無效合成字串；workspace／mailroom 的 POST 只在 stub 記憶體中運作。這些不是正式發送或 API 成功回執。既有 browsers data／baseline mapping 過期提示保留，無因此更新依賴。

## 已確認的整合情境與實際界線

| 主題 | 此次實際確認 | 未擴大宣稱 |
| --- | --- | --- |
| 公司與工作台 | URL 公司 B 優先於 stored A；dashboard 每個讀取與三組手動 sync 都傳 B；查詢換公司立即隱藏舊快照，部分失敗與晚回應不借用其他公司；warehouse hook、sidebar、command search 與工作模式保留明確公司。 | 真後端 tenant guard、實際帳戶及全站其他頁面未測。 |
| 原生售後首頁 | 初入原生工作台不取 legacy ticket／不開 iframe；概況明確開啟、關閉與再次開啟才 launch。 | Source 的原 dashboard 是合成 iframe 文件，未執行 Source SSR、SSO 或資料查詢。 |
| 六類入口與財務權限 | 補寄、商品與配件訂購、檢測與維修、換貨、退貨退款、產品問題回報的真 Hub 按鈕帶公司到正確 section，API launch body 與 frame-ready path 一致；invoice／accounting 各依自身 read grant。無 grant、SELF、DEPARTMENT、ADMIN SELF、anonymous 及 disabled flag 均不 launch；retry 不繞 ACL。 | 六類 Source 原 form／按鈕或付款、退款、發票、顧客／銀行 provider 未操作，不能稱完整 Source 功能已驗。 |
| 原生草稿與路由 | 真 Tabs／hook modal／data router：切頁籤與概況 close/reopen 不重建兩份 native draft harness；取消 route／Back 保留，確認才離開；新 intake deep link 取消保留舊草稿，確認後才新 mount／選新 tab；beforeunload 事件保持 dirty，明確 discard 後乾淨。 | CustomerRepairQueue／CustomerIntakeQueue 在本組是 controlled draft harness，沒有驗其實際交辦／建案／bind。Back 使用 data-router navigate(-1)，非所有瀏覽器 native history 行為。 |
| 維修當版條件 | 真 readiness panel 區分未同意、免費仍需本版同意、未款、CSR、檢修／維修版次、QC FAIL、來源改版及待收發；已存實際處置保留，來源文字以 React escaped text 呈現。 | 此面板不代替 server 即時放行或實際收款。 |
| 已寄出維修詳情 | 真完整 RepairWorkbenchPage／Documents／WorkflowPanel 以四方案 × 拒修／處理完成共八個 DISPATCHED fixtures 查阅，所有施工、簽收與文件寫入按鈕不存在、posts 0；拒修未補造 report，既有 outcome／處置保持；records 查詢傳 company／view／repairScope，待收發與待寄回提示仍分開。 | 真 backend records 查詢、carrier交運、顧客收件與案件結案未操作。既有 delivered 進度回執明示不是本次寄出 ACK。 |
| React 19 回饋 | 真 hook confirmation／cancel／MemoryRouter Back 保留草稿；確認後導航，child remount 後成功訊息仍可見。 | 不把合成成功訊息當業務操作回執。 |
| 收發與未知寄出 | 真 MailroomPage 涵蓋 Source 預填、信件具體收件人、照片門檻、close／action／換件／route／Back取消保留、busy時兩 combobox disabled、本人 accept_return 後才能 dispatch；unknown route離開／re-enter／真reload恢復首次 body／key，commitThenLost精確核對清除；stale/no-match禁 POST、原 key不丟。 | 所有 commit／lost-response 在 synthetic API 中模擬，未讓真物流／DB 重放。一般照片草稿不保證跨 reload。 |
| 收件人控件 | 真 Ant Form／RecipientPicker：部門只篩選、仍指定具體 person ID；部門切換、外部 reset 與失效名單正確處理，無擴權。 | 人員名單、當前在職與公司資格仍須真 server 檢查。 |

以上覆蓋範圍沒有新 P1／P2。未覆蓋的正式業務、server／Source／DEV 權限不因 DOM PASS 改標成功；本轮沒有重跑 backend、production build、knowledge generator 或其規格測試，集中整合與發布 gate 由 root 另存實際結果。Author 舊 FAIL／review 文件與先前測試結果未覆寫或重新標 current。

## 受測來源識別 SHA256

以下是執行前／後均未變的 52 份相關產品／依賴／服務契約 metadata。雜湊辨識實際 bytes，不等於每個函式都曾執行；外部 API、auth、socket、native queue 等 stub 邊界已在上文明列，舊 after-sales-workbench.service 仅作接口來源識別。兩個先猜測但不存在的 utils 路徑未列入，實際公司／權限依賴為 config/workspaces 與 utils/access。

| Production path | SHA256 |
| --- | --- |
| `frontend/src/components/CommandPalette.tsx` | `25784ef969924c6c0dfc8f8bbcbea72b8a488721de49a6a98217c0bcb0864f05` |
| `frontend/src/components/DashboardLayout.tsx` | `b0f03da18164123a8f93d5750c43734c0bca4511ef7171715c668d1467da9736` |
| `frontend/src/components/WarehouseLink.tsx` | `8d8ae518eb4b7f3799c76b32f7185745c1cf23d99837ef135b76901f62349212` |
| `frontend/src/config/navigation.ts` | `56286c95da1213df4334fdf0433e2fdd87ecab5d4f4f871d15e15045729398a9` |
| `frontend/src/config/workspaces.ts` | `e88ae442633e34c2c35f7f8908cfb592b5926069932274bf3d45619b5dd7e008` |
| `frontend/src/hooks/useEntityContext.ts` | `abe003181b325410c2b9728e70617980421c48bf7d1f378918a2913572e276b0` |
| `frontend/src/pages/after-sales/AfterSalesWorkbenchHub.css` | `c8f9def7fe5f39f0aaf2689292ed442d81ff07506182a3c1d08a1f0263f80000` |
| `frontend/src/pages/after-sales/AfterSalesWorkbenchHub.tsx` | `69f47360622f11d822876758016e91fc6d72d21c5df59abe858962fa53248a72` |
| `frontend/src/pages/after-sales/workbench-model.ts` | `a10f54654eb4d16ef81bcf64f93e1116728fc10bfbec148cc2eca4c1f24d80b2` |
| `frontend/src/pages/AfterSalesModulePage.tsx` | `df9a8581455fd6b4a7027629075e39c4abba4038b0b38699aa02b4b08299504f` |
| `frontend/src/pages/DashboardPage.tsx` | `4407178a88bd8983882956ff82bb771021664da6942131eec5eb88e0c5f9f452` |
| `frontend/src/pages/mailroom/intake-actions.ts` | `3105432ed9f0799551481b8dce257511c78648101f49b044de949d8fbe369f89` |
| `frontend/src/pages/mailroom/item-custody.ts` | `c6ea6bda03054a83ab92145b27367cab6c4f205843e8287a794f620329d64b79` |
| `frontend/src/pages/mailroom/mailroom-dispatch-pending.ts` | `d9e46462a9c000d3b1feca5a5f2930c2071182e1c0de46e8d949d0d363f58c65` |
| `frontend/src/pages/mailroom/mailroom-draft.ts` | `c87cdd43ad6969109c016b4141f054a521234aae542443393bdd10e91064dbd4` |
| `frontend/src/pages/mailroom/mailroom-workflow.ts` | `3ff609fcc30ac56101f02245798b07ea049326e2dae177a92763e0f58b5c22b5` |
| `frontend/src/pages/mailroom/mailroom.css` | `ca160ce54aa3a8fd4c24af69b84e89dd2104d8cfa640ca6dae539dade9a89e5e` |
| `frontend/src/pages/mailroom/MailroomNextStep.tsx` | `081f151d3dfbd94333d42a955e9af23caf052b155dfcf09557514d8d55c28855` |
| `frontend/src/pages/mailroom/MailroomPage.tsx` | `b03c57c4a06ac56c4e52b4000692b651f77e753c1e3628916e8cf1f86a28efa5` |
| `frontend/src/pages/mailroom/model.ts` | `f07a46011a81b97ee379b8b3c670942a596f35416c8983eb68b1f95741937106` |
| `frontend/src/pages/mailroom/recipient-options.ts` | `610356112f9dff8288340d4172233c379bb797fcdcc505073a2868f290cf2fd5` |
| `frontend/src/pages/mailroom/RecipientPicker.tsx` | `2f1238cc2f55d154404089abcd334c0c2f6605d6eb4ebe90bf0f1c5df13037fe` |
| `frontend/src/pages/mailroom/source-search.ts` | `3001cb6879b5c444b44f55417b74357d5de860f9ed3253d694bd44dd7d6c8f2d` |
| `frontend/src/pages/mailroom/SourceCasePicker.tsx` | `383319a77d692ea2bc97e21a2617ad884a24b75a9abb77481e57e339bd5f2459` |
| `frontend/src/pages/mailroom/TabletAcceptance.tsx` | `dd4be754b188a37de5c6099dce1e0a9305d201d177f513457e36e146e419c355` |
| `frontend/src/pages/repair/after-sales-launch.ts` | `6362699c0bd08d5d4e6b7a348803b56a49e6c52707c5e35b6568dd570b00e6ea` |
| `frontend/src/pages/repair/repair-feedback.tsx` | `9e0742ef0ed4c7ced24846e67c7f60c91306ba215ed58b01342c3a7e17d0bb14` |
| `frontend/src/pages/repair/repair-model.ts` | `825d681269bb197a2f2389c4769d17a1aa35fe69e98cc7e3f9564d8fa5f21fcc` |
| `frontend/src/pages/repair/repair-navigation.ts` | `46d5cec64b064ba9b496bbf0cdfc2068e3b741a0a0b9107700bc87091b348072` |
| `frontend/src/pages/repair/repair-readiness.ts` | `4108c5bfe4615dd1b335ac5a3ac8cf88af1d469d4d340d85747df4b71d586968` |
| `frontend/src/pages/repair/repair.css` | `0787fd9a78db40d7aee5fae086c93b302482713a10b0dfbd33c3eba2b31e2289` |
| `frontend/src/pages/repair/RepairDocuments.tsx` | `858da87e28b3758e017aba98260a916e1760d473e299b55fbdf3ad6f2d4d65dd` |
| `frontend/src/pages/repair/RepairReadinessPanel.tsx` | `3c93901a5b3078b1024313f5825960bc7428248c8c2305d1e79c7868c45731f5` |
| `frontend/src/pages/repair/RepairReplacementStock.tsx` | `64fe36d1395e93895d50dff18e120f52529d2b6e3daf3d4e04f8608e7b90d07f` |
| `frontend/src/pages/repair/RepairWorkbenchPage.tsx` | `d8334e974e1339ab90c063408aaa9c8ab6885fb2010dcbd2b3d8b2286aa2cf59` |
| `frontend/src/pages/repair/RepairWorkflowPanel.tsx` | `6f6e5299a84edeefcb1d5ba5a322db7c6706ab58e2b823c7c1f5836d756b9b66` |
| `frontend/src/services/adIntegrations.service.ts` | `e025ff50288f8c58e094954a80c6a4618dd4a63d350227010747963825942296` |
| `frontend/src/services/after-sales-workbench.service.ts` | `d6e4e3cc9dca815c3d3c0b6c570da1f4865f6c0e3d5b0ccaee1dfa084b1f4232` |
| `frontend/src/services/ap.service.ts` | `189654d8be27790cb0609b831056d1071a5588f67d0b65e38eebe59ff6038ea5` |
| `frontend/src/services/ar.service.ts` | `a60ee3c18db725feea506c4772afa582496891a8ebcf60e2c90f6c007bc5ca06` |
| `frontend/src/services/banking.service.ts` | `e3ae05b9fe59cdd13325c54d116558d7d266ba4a55087f4538b1ca1e918fcdc2` |
| `frontend/src/services/dashboard.service.ts` | `0a71203230e1f055fd1c808284771652ee81ba77e2d1408b67cb4999713a959f` |
| `frontend/src/services/entities.service.ts` | `3fb6b974ae6d995ffa678fbd87bcd49ead0025ecb7ee255d410a20ca937e5df0` |
| `frontend/src/services/invoicing.service.ts` | `fbabe48eee43dd0abd69dfbfce8c1d74f1acd045306c4216cd8c68b1c6c22717` |
| `frontend/src/services/mailroom-intake.ts` | `3fcce153290c3f6f1e2d8f754932f35d60e212d2f70fe4263034811f5794ef45` |
| `frontend/src/services/oneshop.service.ts` | `9cc642c9ed3baeb9507fbbe6d1e19f80967b2e89e9f27761bb3e6237a3b953a4` |
| `frontend/src/services/repair-stock.ts` | `b6b9e5a27774b23b3fb903f0bf3589f82f5d3af8c2037fb0dea093c9a187c17f` |
| `frontend/src/services/repair.ts` | `636b3b91bfef9684b8400a0c49243caaec5382b59e76de47d2faaf416460ce9f` |
| `frontend/src/services/sales.service.ts` | `e21a40263ea54266ddf56c9aebc0218f66dd6c7eee06a8e36b5af6fc88d4385a` |
| `frontend/src/services/shopify.service.ts` | `8e15364da71278e7ea9fec4facacb25f715a42c2cf2e1d5cc77663e119f158aa` |
| `frontend/src/services/shopline.service.ts` | `f174c29c8c42402656b21dedfcfa98bad6f856fb81a5d5a9933479ce122de766` |
| `frontend/src/utils/access.ts` | `2483d387421429e10e5f2515eec6045b8509d9e1e98cbcc80eb964470833ede9` |

## 實際測試檔 SHA256

| Test path | SHA256 |
| --- | --- |
| `frontend/tests/workspace-company-dom.test.mjs` | `b4c0bde65e5cbed18c8f8b04a1c839fe2bc357b8042a78096fb5f4264c9a4862` |
| `frontend/tests/after-sales-module-dom.test.ts` | `3be874330730622633ad96a0d36b84612c7bacf384a426214228f70d8b4ae514` |
| `frontend/tests/repair-readiness-dom.test.mjs` | `8b93feb8e71bd1cabcfc002b418c60c01ce6a05eb8237476f14e4c2eacc847d1` |
| `frontend/tests/repair-dispatched-page-dom.test.mjs` | `300fdbe68db030557035704be387ddc8dbfe55bd82531115f29118594347695f` |
| `frontend/tests/repair-feedback-dom.test.mjs` | `e3623f8d108f84876c98765ce0551abf05e9752e3f0e519252642d0accddf53a` |
| `frontend/tests/mailroom-workbench-dom.test.mjs` | `912e500ad000eb7790818a931cfe86f343b8b7250d89574dad80ef808fbe0605` |
| `frontend/tests/mailroom-recipient-dom.test.mjs` | `90e45f9de475fa39e3c5bd314b814dbea041dfda173b38747b334996479ca822` |

