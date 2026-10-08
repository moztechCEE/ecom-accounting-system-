# 維修工作台三入口與待辦投影獨立審查 — 2026-10-08

結果：`PASS_SCOPE`（目前已閱讀工作樹內容；正式 feature commit 尚待固定）。未發現尚未修復的確定 P1/P2。本回執只涵蓋下列程式與合成證據，不代表 DEV 發布、整批合併、真實金流、實物或人工驗收。

審查者：`/root/repair_list_independent_review`。唯讀產品 repo；唯一產出為本 `/tmp` 文件。

工作樹：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-action-queue-20261008`；branch `codex/repair-action-queue-20261008`；讀取時 HEAD `e06f7e751132cdb51f062fa2010843efa89daa46`，feature 檔案仍 dirty/untracked。基底包含 runtime `00b76220c25ef9aabb4b955b367a252c61c0aea6` 與上一批列表功能，並保留 DOA read/intake 最新修正；不能以先前 745 基底回退。

- 新後端範圍：`repair-todo.contract.ts`、`repair-todo.dto.ts`、`repair-todo.service.ts`、`repair-todo.service.spec.ts`；`repair-workbench.controller.ts` 只增 `GET todo`；`mailroom.module.ts` 只增 provider/import。
- 前端範圍：`RepairWorkbenchPage.tsx`、`RepairCaseList.tsx`、`repair-list-model.ts`、`repair.css` 及相應四個 DOM 測試檔。新三入口為我的待辦、待認領與簽收、案件查詢。
- 維修 `todoKind` 是只讀的下一項工作名稱，不是原生狀態或動作授權；抽屜另讀 fresh detail，原伺服器寫入權限、版本及放行 guard 繼續生效。

已親自完成的程式檢查與有限執行：

1. 逐段讀完新 todo 六檔及整份 spec；檢查初判、來源詳情重查、Source 後 actor/entity/read 重查、原候選 native 重新讀取、工作單/CSR/Source quote 同版、顧客同意與必要實收款。
2. 候選限定同公司 item/receipt、既有 repair population、本人 repairOwner/custodian、nextUser 為本人或空值及原生候選狀態。`*` 仍不能越过實物保管或本人範圍。REPAIRING/REFURBISHING 的實際施工/複驗工作可以列入，完工/換機寫入仍由原 guard 判斷。
3. factory 返還簽收、拒修原件及 factory 完成使用既有 `allowedWorkflowActions`；已向外交運、已交收發、完成紀錄、未簽收及客服 SENT/ACCEPTED 不被提升成維修可施工待辦。當版檢修資料變更只能回到檢修處理，不能使用舊 CSR 結果放行。
4. 來源透過既有 `sync.cases(entityId, '', sourceId)` 詳情契約，要求單筆 exact id/type 與有效版本及 release metadata；來源 snapshot、PAID 字樣與前端標籤不能代替放行。免費維修仍需要當版同意；正數金額需要當版 confirmedPaymentQuoteRevision。
5. 先掃完整本人候選、按來源 id 去重，分類後才搜尋/分頁；每頁 50；搜尋只影响 total，不影响全域 todo/acceptance 件數。候選及 Source 後 native 回讀的明確 select 排除 evidence、receipt.sourceSnapshot、repairReport；normal 僅 page≤50 的 id+version+原 where 完整 hydrate，重新核對判定與 kind 後才原 views。summary 不 hydrate。late hydrate 發現版本／保管／owner／next／status／receipt entity 變更的列不回舊資料，total 減去受影響列、unknownCount 增加並取消 exact badge。來源缺失、格式錯誤、失敗或未能在預算內核對亦為 unknown；`countExact=false` 不發布 todo:0。已確認原生檢修案件仍可顯示。
6. Source 同時啟動上限 5，request 起算 16 秒停止新啟動，每筆 8 秒 timeout；既有實際 Source request 也有 `AbortSignal.timeout(8000)`。最後一波可能在啟動 deadline 後才結束，此契約不是整個 API 16 秒 hard timeout。
7. spec 確實啟動 Nest HTTP controller、production `JwtStrategy` + `B2bAwareJwtAuthGuard`，以真 `MailroomService.actor` 和 `views` 處理 synthetic DB；AuthService JWT user validation、Prisma 與 Source 為 fixture。無 token / 錯 token 為 401；不符公司、read、帳號/員工有效性為 403；DTO 使用 production implicit-conversion 設定測 malformed query。沒有把 controller 成功 mock 當成實際 JWT 邊界。
8. read-only repair reader 無施工 todo，原公司待簽收件數仍保留。generic mailroom 權限不能使用本 repair endpoint。Source 期間撤銷 read/entity/account 不能投影聯絡資料；撤銷 update 不能保留施工資格。已閱讀原 99 測項、新增 request-start scan-budget 案例及六項 late-hydrate matcher/assertions；root 親跑最後 106 new tests PASS。本審查已解析 raw JSON，核對 106 passed、0 failed/pending 及 SHA256，沒有另重跑這套 Jest。raw JSON `/tmp/repair-todo-final-results-20261008.json` SHA256 `20659d2a50634412d1974fa98a6a01ebca38e27b4fe0820da981568a0dbb385c`；stdout `/tmp/repair-todo-final-20261008.log` SHA256 `fdd305ecb70939187bed3f212b27e12ae8a10493f5fafc4d3235268bd800fe6f`。root 回報同版本 Nest build PASS，build 非本審查執行。
9. 用 Node/TypeScript AST 執行原文比對：原 controller 五個方法 `customerQueue/workflow/documents/inspection/report` exact，唯一新增 `todo`；`loadDetail` exact；`RepairDetail` exact 除狀態 Tag 顯示增加 `repairCaseProgress(item)`。原 command/save/request payload、按鈕 guard 與草稿處理原文均保留。
10. 用 Git object/working bytes 親核下列 15 個既有檔全部 exact：MailroomService、mailroom.contract、RepairWorkbenchService、repair-workflow.contract、repair-list.contract、mailroom.dto、mailroom-sync.service、Prisma schema、repair-model、RepairDocuments、RepairReadinessPanel、RepairWorkflowPanel、repair-navigation、repair service、共享 navigation。
11. 前端缺省/未知 queue 導向 todo；all/mine/waiting/delivery/records/acceptance 舊 URL 保持原 API 範圍。`itemId` 詳情入口獨立，不要求出現在目前列表；案件查詢明確保留 `queue=all`。搜尋/頁碼切換不會重載已開啟的草稿。
12. 原生 query 與 todo summary 並行啟動；query 成功立即顯示案件並解除 loading，不等 summary；每階段 generation 防止舊公司/搜尋/queue 結果覆蓋。任何同範圍 401/403 清除列表、联絡、件數並 unmount 照片。summary 503 則保留 native query 與獨立詳情。
13. 審查中曾找出兩個 P2，均已修復：舊 helper 未核對本版 CSR/inspection 就顯示款項進度；summary 等候阻塞原生 query/403 清除。第一項親自以真 helper/model 的 16 個當版、免費、改版、decision/hash/quote/factory/return 反例執行通過；後者重新讀實作，已閱讀新增 held-summary/company/403 DOM assertions，沒有另跑同一套 browser suite。
14. 目視三張最新合成 PNG：1537、1104、390px。三入口與紅色全域件數、照片、產品名、案件號、顧客姓名/電話及狀態清楚；列表沒有 SKU/SN、位置或工作單摘要。手機沒有先前標題拉高產生的大段空白。合成側欄及紅色 fixture 照片不是正式產品外觀驗收。

親見圖片 SHA256：

| 檔案 | SHA256 |
| --- | --- |
| `/tmp/repair-action-queue-20261008-1537.png` | `17a76e4fc9e61000b54fe75ae052f23242fa061462e3123f1215ab78ebc16c1e` |
| `/tmp/repair-action-queue-20261008-1104.png` | `ae10b2e5ada16a048ee6895016188aa2e90fbe5ab007d6e09a08b9cebd7fab97` |
| `/tmp/repair-action-queue-20261008-390.png` | `3b68b910b86e90acb38a3d5898f7602b261cab24f7c44eafa60e972166d7df15` |

讀取時 feature 內容 SHA256（正式 commit 需重新核對；格式調整亦會改變）：

| 檔案 | SHA256 |
| --- | --- |
| `backend/src/modules/mailroom/repair-todo.contract.ts` | `e9880659b62f4b1bd7374f9731e489981cc98581a14fc9b830816e99d31cbf00` |
| `backend/src/modules/mailroom/repair-todo.dto.ts` | `d9d6e24b1761a2b2d42d48cd66d89d2e7dd53fa8aff8473b1d45d8ad53e6f542` |
| `backend/src/modules/mailroom/repair-todo.service.ts` | `450c7133d92bef8b2b15a16346bf56bd27e7e23ce299f699d7c3d7831093057d` |
| `backend/src/modules/mailroom/repair-todo.service.spec.ts` | `f27eb117ff9bc04b1c4097298983ade92245f0d90957723fe60adb320a11328d` |
| `backend/src/modules/mailroom/repair-workbench.controller.ts` | `550961d0d9c7f18f840136a0819452488aae5ab521a7deb0d51f95dfaa563a3b` |
| `backend/src/modules/mailroom/mailroom.module.ts` | `d62cd8b1507418eed5c8a4ef67445d243f13a3aebb2cd0752fab6637f4b38c74` |
| `frontend/src/pages/repair/RepairCaseList.tsx` | `805f1d5665ec3397f78882d78fe5779c47dc0b82fb78d637fb1d5c1b5b3249d5` |
| `frontend/src/pages/repair/RepairWorkbenchPage.tsx` | `285f22d91281f240945cec782d230ec3e642bec362b4f070375b3d5db2a2791d` |
| `frontend/src/pages/repair/repair-list-model.ts` | `08954b446d9ec1d94c780a1ade89b9bf9a8276a8b25225a02bf2e7e34c5de601` |
| `frontend/src/pages/repair/repair.css` | `6d2a66fdffca14a4d671fe791a827a6cf4f93897d500d5cc6345f0735ebd71a4` |
| `frontend/tests/repair-action-queue-dom.test.mjs` | `8aae41419585b8c623a243852e9c06f72e31c14a81e7cdae152b1da9f156dfea` |
| `frontend/tests/repair-case-list-dom.test.mjs` | `20e143606f88cc2512dbaf3f7a1bf92122e447b7f8111145acaf2cc0bedd0ef8` |
| `frontend/tests/repair-dispatched-page-dom.test.mjs` | `b068a40b0c92f571d561acccdb9d9415f3a280378d49ee7ab7253895627eacc5` |
| `frontend/tests/repair-ui-layout-dom.test.mjs` | `617cfa6b1d6762042e8c4204560acdd269b0abc4bee7cdf3fbe481ad002d69d4` |

同批 peer 契約已有另份固定版回執 `/tmp/repair-mailroom-daea-13be-todo-contract-review-20261008.md`，SHA256 `7388cad1c8a0f0c7677847958335b8080dd0f52720525755ddca7a595e074a39`：ERP `daea6c337a52bf08e5950f587f1eacd2df8e3100` / Source `13be4eac56616902b1b272440d1f37e823d1894f` 為 `PASS_SCOPE`。原 `sync.cases(detail id)` shape、repairAllowed/releaseInfo、Source scope/authorization/write 契約不變；contact phone additive，native PNG/JPEG/WebP 三格式 narrow proof 已執行。peer 與本批 Module provider 合併為 additive，但最後整合 SHA、migration、knowledge/Claw 生成及 Source 歷史 snapshot phone 回補仍不能靠本回執取代。

未執行範圍：本輪未重跑 author 的完整 Jest/browser/build/lint/types；未使用真帳號或連外 Source/API；未親驗原生外殼/真人照片/實際業務資料；未 merge/push/deploy/migrate；未操作正式資料、收款、通知、庫存或物流。成功的 synthetic GET tests 不能代替整批業務流程、physical/human acceptance。Source HTTP fixtures 模擬傳輸/資料，actual Nest + JWT + actor/views 僅為本地邊界證據。

正式固定版回執：待 root 固定 feature SHA 後，比對本次已審 blobs 與變更範圍，並附上執行者最後測試結果；目前不宣稱整批 DEV 或正式發布驗收通過。
