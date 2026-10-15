# 收發室四層開放貨架 DEV 候選

## 2026-10-16 真實 DEV 手機寬度回歸修正

本次從固定 `3cadd79a152c569f20819803ab401662d33cd05b` 建立新隔離分支 `codex/mailroom-open-rack-mobile-20261016`；舊分支與工作樹凍結。DOA 已將該版 API 發布，Web 僅 candidate Ready，Web MAIN 仍保留 `95e037ecd7935584001d4c66663beafc128484fe`。purpose migration 已由 DOA APPLIED／VERIFIED，本次不重套 DDL。

Root 在 DOA 限定租約內，以獨立空白瀏覽器、正常收發人員帳密登入實際 candidate，確認儲位深連結、舊貨架讀取及新增預設四層／每層一位置後取消。320px 寬度檢查未通過：document scrollWidth 338px，比 viewport 多 18px。另經核准讀取舊 MAIN 得到 332px，多 12px；兩者不能視為同一結果，也不能把舊版缺陷當新候選接受。

唯讀 DOM 幾何實驗指出，`.mailroom-page` 的自動 grid track 在父頁左右各 12px padding 下仍取 320px，將 Tabs 推到右側 332px，連同貨架深度使頁寬達 338px。以 `grid-template-columns: minmax(0, 1fr)` 限制單欄可縮後，實際候選瀏覽器實驗回到 320px；僅裁切貨架 overflow 仍有 332px，不採用遮藏內容的作法。

產品修正限定為 `.mailroom-page` 新增上述單一 CSS 屬性，沒有重排流程、隱藏控制項或更改 auth／資料／用途契約。既有 real MailroomPage 離線 DOM 測試新增父頁 padding 12px、320px viewport 的回歸，先以舊 CSS 留下失敗幾何，再以單行修正驗證。Claw 中英操作文字重新審閱，既有說明仍適用；來源 manifest 依實際 CSS 重生。

前端實跑保留 RED：只新增的手機子例失敗，原五個場景成功；GREEN 為 7/7、skip 0（六個子例加 parent），document/body 320px、grid track 296px、Tabs right 308px，html/body/parent/page overflow 皆 visible。前端正式 build 成功，限定 lint 0 errors／三個既有 ref-cleanup warnings。沒有重跑未變的 storage 13/13，亦不把先前測試計入本輪數量。

這是局部版面修正與離線回歸，不代表新版本已部署或實機驗收。DOA 仍為唯一 Cloud／DB／業務 QA writer；待新成對 images Ready 後才重新取得正常帳號唯讀 UI 租約，通過後由 DOA 決定 Web MAIN 推進與新合成四層貨架 QA。原維修案、舊貨架、兩筆在途申請與 AI 等待狀態保持原狀。

## 2026-10-16 最新 DEV 整合候選

本次從現役 ERP `95e037ecd7935584001d4c66663beafc128484fe` 建立 `codex/mailroom-open-rack-95e-20261016`，僅重套原 `17845fc1eb502cd6dc658c1130383925c79baf17` 相對 ba0 的 16 個貨架 owned paths。保留最新顧客申請、產品展示、費用欄位守門與 auth；Claw 僅更新 mailroom-workbench 的中英文內容，再於共同基底重新產生 generated 與 manifest。以下舊版測試與組合紀錄保留為歷史；本次實跑與獨立審查另有固定版回執，不將舊 PASS 當新接受。

DOA 為本批唯一 Cloud／DB／業務 QA writer；本台僅本地整合、mock 驗證與獨立分支 push。nullable purpose DDL 必須在新 API 啟用前完成，混合版本期間禁止用途配置寫入或統一由新 writer 處理；回退保留 additive 欄位，不 drop 或 backfill。既有儲位與原案件不重建、不改存量配置；實際四層配置僅由 DOA 在指定合成貨架驗證。AI 持續等待原視窗。

基底：ERP `0855802642216e579a86809b0712dee034e7b303`。分支：`codex/mailroom-open-rack-20261015`。此文件描述隔離候選及驗證；不是 DEV 部署、實際儲位配置或原維修案簽收收據。

後續隔離組合：`codex/mailroom-open-rack-ba0-20261015` 合併已固定貨架 `7e53303cfe9b9eb5bae0f55937411a3f27ec6ca3` 與已部署登入修正 `ba0f38fe60f0f8c44d72be8862e3067de6e98c7d`，保留前者 storage 與後者 auth 的原 blob。重新審閱中英「首次登入與密碼變更」指南，原首次改密碼／重設步驟與新密碼八碼規則不變；更新當版 source hashes。舊7e分支與工作樹保持凍結。此組合仍僅離線準備，下一批發布 lease 待中央顧客申請新 canonical 再指定，不能自行部署或用ba0覆蓋後來的新功能。

## 操作行為

人類確認實體為一座四層貨架，沒有實體分格；儲位是每層自行配置的標示位置。新建預設四層、每層一個初始儲位。既有貨架的層數、ID、code、位置及歷程不強制改寫。

立體視圖每個 rackId 只畫一次，以前後立柱、連續厚層板、腳座／地影與箱體頂／側面呈現深度，沒有直立隔板。每層依既有位置序號排列，可新增、命名或停用空儲位；新增超過目前上限時先調整貨架上限。編碼與座標不因停用而重排；縮小配置仍保留所有現存位置，包括停用位置。箱體最多畫三個裝飾，旁邊數字維持實際件數。

每個儲位可指定收件、待寄或繼承貨架預設；同層、同架可並存兩種用途。收件選單顯示啟用儲位及用途，仍回傳原 ID／code。獨立寄件單 picker 依每位置有效待寄用途篩選，仍儲存原 code 字串。

搜尋只標示原位置，不移動或重排物品。貨架件數僅包含目前收發保管且關聯結構化儲位的實物，不包含獨立 OutboundOrder 的文字位置，不新增容量、滿載率或逾時推算。

## 後端相容與資料邊界

只新增 `MailroomStorageLocation.purpose String?`，資料庫 TEXT 可空欄位配 RECEIVING／OUTBOUND CHECK；無 enum、backfill、其他 model 或 OutboundOrder FK。null 繼承 `rack.zone`，list/create/update 回 `purpose` 與 `effectivePurpose`；舊 saved response 可以仍缺新欄位，前端以 purpose/rack fallback。

舊請求未帶 purpose 時不改原 fingerprint；update omitted 保留目前值，explicit null 才回繼承。相同 requestId／相同原 body 先重播既有 response；同 key 改 purpose 衝突。保留公司／當前權限／版本／鎖及 unknown-result exact retry。

有目前 MAILROOM 保管物品時，不可停用或變更有效用途；相同有效用途的 override／inherit 切換仍允許。變更貨架預設只檢查真正受影響的繼承儲位。歷史 FK 但已由技師、物流或庫存保管不算占用。原 receive／accept_return／Source／庫存／通知契約未改，移位仍只記位置／版本／歷程。

## 已執行驗證

7e＋ba0 隔離組合由 Root 親執行：獨立前後端 `npm ci --ignore-scripts`（lock 未改）、本地 Prisma generate、前後端正式 build、knowledge 20/20、82 中英指南／106 routes／275 source hashes drift check、diff check 均通過。當版 knowledge sourceVersion 為 `fe525db32d292d8294e0d101101e1fbaf6e88608aa7b77dd1be20eda88c23b9e`。Prisma 首次因隔離樹未設 DATABASE_URL 而未執行；改用不可連線的本機 port1 offline placeholder 後 codegen 成功，沒有 migration 或 DB 呼叫。auth 四檔與 ba0、storage／schema／migration／pickers／測試與7e的逐範圍 diff 均空；不重跑已完成的原案或把純組合當新 DEV 接受。

下列專項測試與 strict TSC 數量屬原7e slice的既有執行證據，未冒稱在此組合重新跑完全部套件：

- 後端實作者：storage service＋DTO 兩 suites 104/104 PASS；Prisma generate／validate、限定 ESLint／格式檢查 PASS，使用本分支獨立依賴，未改 lock。
- 前端實作者：storage 專用 13/13 PASS，含 mixed purpose／null 繼承、320px 每個 target 實點、鍵盤 drawer、搜尋、公司切換／draft／unknown exact retry；正常四層 fixture 最後 2/2 PASS；受影響 known repair 收件場景 2/2 PASS。計數含 test runner 的 parent/subtest，不視為相同數量的獨立業務案例。
- 前端最後 build PASS；限定 lint 0 error，原 ReceiptLocationPicker ref-cleanup warning 保留。
- 獨立 review 找出的同架用途無障礙標籤遺漏已修：儲位 accessible name 讀出有效收件／待寄用途。修後受影響 Storage DOM 7/7 及前端 build PASS，包含 null 繼承與明確 OUTBOUND 的原生 accessible-name 精確斷言。
- Root 親執行後端正式 `npm run build` PASS；Claw generator coverage/drift check PASS，82 中英指南／106 routes／275 source hashes；knowledge 兩檔 20/20 PASS。Root 親讀正常桌面與 320px 合成 fixture 圖，沒有 modal、文字與位置可讀。
- Root `git diff --check` PASS。Claw 中英文操作及邊界已審／更新，source manifest 包含新 migration 與實際 picker。

後端完整 strict `tsc --noEmit` 並非 PASS：實作者觀察 136 diagnostics，用同一 client／其他 source 將三個 storage tracked TS 覆寫為固定085內容、排除新 DTO spec 的限定比較仍136、added/removed0。這不是獨立基底 client 或全回歸接受；正式 build 使用原 tsconfig.build 排除 spec 及既有設定並已成功。未因此修改其他模組或放寬 tsconfig。

## 中央發布接受

此批不自行套 DDL、build Cloud images、部署或改 shared DEV；由 DOA 唯一 writer 與最新批准 ERP 組合後成對 review。新 Prisma service 讀 purpose 前必須套相應 migration，舊 reader 可忽略新欄，但混合舊 writer 沒有新增用途 guard，發布窗口要協調。candidate 的正常登入、權限、儲位 API／畫面、原案件只讀兼容及流量／版本由中央另留收據。

貨架 slice 不編輯 auth；新隔離組合保留已部署 ba0 的原 DEV121 實作，DEV123／DEV121 已完成的單次身分變更不重做。原 REPAIR `CASE-20261013-235435-b5e96784eef6`／`MR-20261014-71F4585E-1` 已由 DOA 在現役 ba0＋Source0a，沿原 quote2、c168 inline DEV_STUB 模擬、當版同意與首筆 REPAIR 測試款票、合成維修／QC、交回與本人 accept_return 完成至 READY_FOR_DISPATCH v12，不寄出。本台只讀去敏完成回執，沒有執行該業務；新貨架用途不是返回接受前提，不能重播已完成步驟或以原 c168 補 AI 真接收。

以上原7e／ba0隔離組合沒有 canonical browser 操作、DB apply、真實通知、款項、退款、物流或 ECOUNT 動作；當時截圖與 DOM 測試為隔離合成 fixture，不冒稱線上 DEV 或實物驗收。2026-10-16 新增的實際候選與基底唯讀 UI 證據另列於本文件首節；一般人員主站 session 仍保留給 human。
