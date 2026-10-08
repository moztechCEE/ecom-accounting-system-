# 維修分頁件數與精簡案件清單交付（2026-10-08）

使用者要求六分頁顯示紅色件數，清單只保留照片、案件／產品名稱、顧客姓名、電話、案件編號與目前狀態。此批移除清單 SN、SKU、保管、下一接手人與工單版本摘要；原案件詳情、操作、實際處置與文件完整保留。沒有新增常駐說明文字。

## 基底、範圍及版本界線

- Repo origin：`https://github.com/moztechCEE/ecom-accounting-system-.git`。
- Owned worktree：`/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-list-badges-20261008`，branch `codex/repair-list-badges-20261008`。
- 初始已核准基底：`745b8843d42e3955e740594f471b1283dc28d553`（runtime 同已部署 `6cc903951d42d3f0e9aa5556598595397734859b`）。
- DOA 釋放共享 service 前先指定 `0ba9c189c2a6b173d4e025eb69896d7bc3620d68` intake read hotfix；本視窗 fresh bare fetch 原 owned tree，再 named fetch origin `codex/doa-admin-access-20261008`，FETCH_HEAD／ls-remote full SHA 相同。保留未提交前端後 cherry-pick 為 `bb08e190768442e2549eddd78f5df161fdc9ffb3`，patch exact。此批功能 diff 以 bb08 為起點，不把 DOA 的原 read hotfix當維修新開發。
- 共用 repo fetch 原有無效 ref `refs/heads/codex/aftersales-workflow-20261005 2`；沒有刪除／重置 refs 或其他工作，改以 `/tmp/repair-list-badges-fetch-20261008.git` 核對遠端物件。
- DOA 指定維修單一編輯 `mailroom.service.ts` 的 list／views／新首圖讀取，以及 `mailroom.controller.ts` 一個新 GET。Source 聯絡及附件契約仍由收發單一編輯，Claw catalog／generated／manifest 仍由 DOA 中央維護。
- 本輪起始重讀 ERP DEV：兩主流量仍是 6cc 100%；latestReady 另有 Copilot 1b candidate，不作本輪基底。沒有維修自行部署、切流量、migration、真人資料／通知／財務／庫存操作。

## 唯讀接口

既有 `GET /mailroom/items?entityId=…&view=repair&repairScope=…&page=…&search=…` additive 回傳：

```ts
queueCounts: { all:number; acceptance:number; mine:number; waiting:number; delivery:number; records:number }
items[n].repairOverview: { customerName:string|null; customerPhone:string|null; photoUrl:string|null }
```

- 同一公司、最新有效 actor 與 `repair_workbench:read` 檢查在查詢前完成。六 scalar count 與列表使用同一份原生 population／scope 純函式，未搜尋、未 status 篩選、未分頁；不下載全公司 row、不用目前 50 筆推估、不加總重疊分類、不按來源案件去重。
- all 保留原 REPAIR 與合格維修 RETURN population；mine 保留本人 repairOwner／nextUser（含原歷史）；acceptance 為 WAITING_REPAIR_ACCEPTANCE／PENDING_REFURBISH；waiting 為 WAITING_CUSTOMER 與三原廠狀態；delivery 仍僅 WAITING_RETURN_ACCEPTANCE；records 原三終端狀態不變。這是現有分類件數，沒有捏造未讀／新到事件。
- 非 repair list、default views、detail、tasks 不增加 overview／counts；`views` 的投影明確 opt-in 且再檢 repair 讀權限及原生 population。
- 姓名／電話僅取 `receipt.sourceSnapshot` 的 customerLabel／customerPhone，核對 receipt 公司、sourceCaseId 與 REPAIR／RETURN 類型；不冒用 senderLabel，不回傳財務／附件／整份 snapshot。
- 新 `GET /mailroom/items/:id/repair-photo?entityId=…` 遵守現有 JWT 守門及最新 actor／公司／repair 讀權限，核對 item／receipt 公司及原生維修 population，只回實收當件第一張已驗證 PNG／JPEG／WebP（≤ 1 MiB）binary、MIME、`Cache-Control: private, no-store`。未授權／不存在／無圖不回圖片，沒有 public、signed-service 或外鏈入口。
- 列表 photoUrl 是無 token 的固定 native 路徑；列表不塞原圖。前端以既有 API JWT、目前公司、IntersectionObserver 懶載 Blob；entity／id／version／路徑更動取消舊讀取並 revoke URL，晚答不覆蓋新公司。未知／破圖保持圖示位置，沒有假產品圖。

## 介面與保留項目

- 六分頁紅色數字使用 server totals；0 隱藏，未知不猜，搜尋及翻頁維持整分類件數。清單產品名稱可開案，按鍵仍為「開啟案件」。
- 原列表搜尋能力保留，placeholder 縮成「搜尋案件」；SN／SKU 等值仍在原詳情與原搜尋契約。
- 列表以 entity／queue／page／search snapshot 隔離舊回應；首次失敗不顯示假空態，401／403 清除旧案件、聯絡、照片及 counts。相同條件一般讀取失敗可保留最後成功 row，並顯示實際錯誤。
- 三尺寸 1537／1104／390 實際 DOM 及 PNG 檢查；手機修正原 heading flex-basis 260px 在 column 排列造成的大片空白，清單狀態與按键不重疊。
- `RepairDetail` 與 `loadDetail` 對 745 原文 bytes 相同；本人簽收、客服／當版同意及必要實收款放行、修理／合格換機、工作單、原件及原廠、複驗與交回的 payload／idempotency／guards／draft protection 未改。
- 除 list／views 外，18 個既有 MailroomService method 的 AST 原文逐字同 bb08，僅新增 repairPhoto。0ba 的 intakeQueueReader／detail／tasks 以及原所有 writes 均保留。無 schema／DTO／權限配置／來源寫入／通知／金流／庫存變更。

## 最終本機驗證

- Backend 5 suites **170 個不同案例 PASS**：新37（真實 service／views、六分類條件、>50頁數、來源辨識、fresh account／company／grants、安全照片；實際 Nest GET 使用 production B2bAwareJwtAuthGuard／JwtStrategy，200／401／403／404／400、binary/MIME/no-store），既有133（repair-access33、source-access64、intake21、最新 intake-reader15）。不是重跑累加。
- `nest build`、4 backend 檔 Prettier PASS；ESLint 0 errors，只有 service 原搜尋 concat／通知兩個既有 warnings。
- Full strict `tsc --noEmit --incremental false --pretty false` 仍 FAIL；immutable bb08 archive 與本批相同依賴各124 diagnostics（排除行號位移完全相同），零新增／刪除，4 改檔零 diagnostic。不要稱完整 strict 通過。
- 新 `repair-case-list-dom.test.mjs` 最後 **10 TAP（9 subcases + parent）PASS**：六欄／三尺寸、native 開案、全scope totals與搜尋／頁數、zero／unknown、跨公司／舊搜尋晚答、初次失敗、照片 abort、改版重讀／revoke、403清除資料；手機 heading <140px。
- 既有 `repair-ui-layout-dom.test.mjs` 最後1/1 PASS（三viewport、原文件、三個 dirty 退出取消與原草稿提交契約）。只修改不再適用的列表 SN／SKU／等待摘要 assertions，細節與原放行測試來源不動。
- Frontend app／node types、3 production檔 scoped lint 0 errors／0 warnings、private Vite build、diff check PASS。既有 browser-data／bundle-size warnings仍存在，未升級依賴。
- 獨立 reviewer 已完成 frontend／0ba 窄 scope 靜態與最新 PNG 審查 PASS，未冒稱其重跑 UI tests 或 backend/live 已驗收。fixed feature SHA 後再作 backend／共同接口審查。
- 全部本機 fixture、零真實外部請求／業務寫入。backend proof：`/tmp/repair-list-backend-proof-20261008.json`、`/tmp/repair-list-backend-method-proof-20261008.json`。

## 整合待辦與真實界線

Source 20f 的舊契約只有 customerLabel，customerPhone additive／typed normalization 由收發持有，尚未 fixed／部署。已存在的舊 snapshot 缺電話時回 null、畫面如實缺值；沒有擅自 backfill，亦沒有逐列讀 Source 文件。Source 既有 case 的 updatedAt／feed 不一定因新增 read 欄位而改變，因此不能宣稱所有原案件電話都已接通；安全唯讀補足或明確同步順序由 DOA 決定。照片只依當件實收證據，不把 case-level 來源附件冒充該產品照片。

本批 `generate-copilot-knowledge.cjs --check` 仍因 reviewed sources hash drift FAIL；ZH／EN repair-workbench 文案及三新 sourcePaths（RepairCaseList、repair-list-model、repair-list.contract）已交 DOA，最後整合須中央生成及 check。此文件不是 knowledge PASS 或 DEV 發布證據。

維修 fixed feature commit／remote 與兩台回執在 repair-status 保存；DOA 統籌整合最新 hotfix 與 Source 契約，三台核對最後 SHA、候選 UI／公司／角色／照片及 counts，再發布 DEV。正式環境、真實 LINE／銀行／發票／物流／庫存與现场簽收未在本批驗收。
