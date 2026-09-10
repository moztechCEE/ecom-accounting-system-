# 售後工作台整合：2026-09-04

## 本輪範圍

採用使用者接受的過渡方案：ERP 原生介面經伺服器 API 查詢舊售後資料；需要異動時由明確標示的「舊工作台操作」連結進入原案件。這是唯讀工作台，不是完整交易切換，也不是單一登入。

沒有修改正式庫存、退款、開票旗標，沒有重設帳密，沒有寫入來源案件。尚未部署本輪程式碼。

## 來源與現況

- ERP 開始時 HEAD：`77e5c9035cd48d5bceba8d2cc4688d87124ce2a3`，分支 `codex/erp-resume-20260825`。
- 舊 exporter worktree：`/Users/moztecheason/.codex/worktrees/after-sales-erp-readonly/moztech-after-sales-system`，開始時 HEAD `7dfa2a5`，沿用 `6ed5d6d` 業務邏輯與 `523792c` 功能驗收基線。
- `git fetch origin` 後遠端最新為 `85135a00f017974d461f46d0bd01e094fbfd8de9`，新增「綠界發票重寄與列印」。本輪沒有把該 commit 的交易操作直接移植或啟用；完整切換必須將這兩項列入驗收。
- 本輪唯讀查得舊正式 revision：`moztech-after-sales-system-00254-c96`，100% 流量；舊 staging exporter 仍為 `00001-lt5`，ERP staging backend 仍為 `00002-n44`。
- 舊工作台已在右側開啟。登入失敗的診斷確認為暫時登入限流；帳號啟用、密碼比對相符。未刪除限流紀錄、未修改密碼或權限。登入畫面將限流顯示成通用帳密錯誤，須另行改善錯誤分類。
- 15:48:32 限流自然到期後，15:48:42 再次登入成功，已在右側顯示真實 `/dashboard`。舊畫面總案件 514、進行中 49、急件 1，與新查詢 API 一致；其他工作台顯示客服 17、會計 6、倉管 21、維修 5、逾期 3。此登入成功不是新整合已部署的證明。

## 已建構

| 區塊 | 實作 | 邊界 |
| --- | --- | --- |
| 舊資料查詢 | `/api/integration/v1/workbench/cases` 與 `/:id` | GET；IAM 與現有服務金鑰；唯讀 exporter 模式 |
| ERP API | `/api/v1/after-sales/workbench/cases` 與 `/:id` | JWT、`after_sales_cases:read`、公司存取及來源綁定 |
| 工作台 | `/sales/after-sales` | 六類案件、四種檢視、搜尋、狀態篩選、伺服器分頁 |
| 案件明細 | 原生抽屜及分區 | 個別案件特有欄位、商品、正逆物流、付款請求與提交、付款、退款、發票、附件索引、CASE 時間軸及操作摘要、備註、FAQ 索引 |
| 原有 ERP 案件 | `/sales/after-sales/internal` | 保留既有 ERP 來回件，不將其與來源案件假裝成同一資料模型 |
| 登入導向 | 具公司範圍售後查詢權限的 CUSTOMER_SERVICE | 登入後前往售後；強制改密碼優先；管理者導向不變 |

- 搜尋與計數在資料庫執行，清單每頁 25 / 50 / 100 筆，不載入全量客戶或商品。
- 頁面與計數使用同一 repeatable-read 查詢交易。工作台狀態直接呼叫舊 `getCaseOperationalGuidance()`，避免另寫不同判定規則。
- 服務端投影採明確欄位允許清單，不將原始 JSON、密碼雜湊、任意附件 URL、付款連結或供應商憑證傳到瀏覽器。
- 公司必須明確設定 `AFTER_SALES_LEGACY_ENTITY_ID`；缺設定 fail closed。尚無舊員工與 ERP 員工對照，因此非 SUPER_ADMIN 的 SELF / DEPARTMENT 範圍一律拒絕，不自動放寬到全公司。
- 舊原始匯出及 migration 入口另限管理者，員工只使用已投影的工作台 API。
- 來源故障、401 / 403、格式錯誤不轉為空清單。清單與明細採查詢識別及 AbortController，換查詢後不顯示上一筆結果。
- UI 採單一中文標題、36px 操作控制、白色表格與按需展開區塊，沒有 AI 解釋文字。

## 不能混淆的來源語意

舊程式 `constants/case-field-options.ts` 的顯示定義是：

| 原始碼 | 舊顯示 |
| --- | --- |
| `WAREHOUSE` | 入工業 |
| `NO_STOCK_IN` | 入民族 |
| `SCRAPPED` | 不入庫 |

本輪只保留顯示。不能依 enum 英文名稱自動推導報廢、庫存調整或 ERP 倉庫 ID。

## 驗證收據

- Backend 全套：35 suites / 133 tests 通過；最後筆數一致性調整後工作台 8 tests 再次通過。
- Backend production build、frontend production build 通過。
- 新增前端四個規則測試通過：六類與十八狀態、零值／false／精確金額字串、舊庫存處置標籤、登入導向。
- Exporter auth + query 共 5 tests、TypeScript 檢查、新增檔案 ESLint 與 Next production build 通過；兩個新工作台 API 已列入 build 路由。
- 新增前端工作台檔案 ESLint 通過；未宣稱歷史全專案 lint 清零。
- Computer Use 的本機 fixture 驗證：急件 3 筆、全部 57 筆、第二頁 TEST-0026 至 TEST-0050、搜尋重設頁碼、案件抽屜、發票 false 值與零單價、來源 502 顯示錯誤而非 0 筆。
- Fixture 入口僅為 `frontend/tests/after-sales-preview.html`，不是 production index；只提供虛構資料，API 非 GET 回 405。
- 2026-09-04 約 15:43，使用新 exporter 查詢程式直接唯讀查來源資料庫，經 JSON 序列化後送入 ERP 投影驗證：有效案件 514，待處理 49，急件 1，已結束 465；分類 66 漏寄補寄、137 私下購買、183 維修、68 來回件、60 退款派車、0 客戶問題。五個有資料類型各抽一筆完整明細通過；此為程式＋來源 DB 驗證，不等同已部署的 HTTP／IAM 驗證。
- 約 15:47，新增本機 Next production HTTP → 真實來源 DB → ERP adapter／projection 驗證通過，筆數仍為 514 / 49 / 1 / 465；一筆詳情 15 區塊。未授權 401、唯讀模式拒絕 POST（404）、超過 pageSize 上限 400。服務僅綁本機、測試結束即停止，臨時金鑰未落地；未呼叫來源寫入。這仍不代表 Cloud Run 候選或正式 ERP UI 已上線。
- 安全掃描服務兩次 timeout；第二次明確標記 `audit=unavailable`。不得將無結果視為 0 漏洞。舊版本既有依賴審查仍未解除。
- 前端仍有既存大型 bundle 與瀏覽器相容性資料過期警告，非本輪造成的編譯失敗。

## 後續驗收與切換

1. 先完成來源依賴風險審查，再建置可追溯 image；不要直接 dispatch 會切正式 100% 流量的既有 workflow。
2. 僅部署 IAM 限制的 exporter 候選及 ERP staging 候選。保留 `READ_ONLY_EXPORTER_MODE=true`、隔離 staging DB 與所有外部交易／自動同步停用旗標；不執行 production migration 或改正式流量。
3. 經公司業務範圍核准後，為該單公司來源設定 `AFTER_SALES_LEGACY_ENTITY_ID=tw-entity-001`。API 既有 `/legacy` 及 migration 也受新來源綁定守門，部署前必須配套設定。
4. 驗證 HTTP 端到端：ERP JWT → 公司／角色／範圍守門 → Cloud Run IAM → 服務金鑰 → 真實來源；未登入 401、錯公司 403、低權限 403、未設定 503、缺案件 404，以及分頁與明細。
5. 使用者登入舊工作台後，逐項核對真實操作流程；授權指定員工前仍須確認帳號、角色及可見範圍，不自動沿用舊管理者身分。
6. 交易整合尚需：正式聚合模型、員工與商品／倉庫對照、來源增量截止點、13 筆舊待審與 75 筆舊未對照商品的最新重查、typed commands、冪等鍵／outbox、流程角色守門、付款憑證及附件代理、LINE／LIFF、保固與 FAQ、通知、批次匯入／匯出、列印、發票重寄／作廢／折讓等。歷史待審數字不是本輪更新結果。
7. 正式庫存、退款與發票由 ERP 各自領域服務作為唯一寫入端，逐流程完成影子比對、測試交易及正式啟用核准後才切換；在此之前不稱為「全部功能已融合」或停用舊系統。
