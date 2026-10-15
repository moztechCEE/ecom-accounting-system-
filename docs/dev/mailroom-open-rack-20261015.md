# 收發室四層開放貨架 DEV 候選

基底：ERP `0855802642216e579a86809b0712dee034e7b303`。分支：`codex/mailroom-open-rack-20261015`。此文件描述隔離候選及驗證；不是 DEV 部署、實際儲位配置或原維修案簽收收據。

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

- 後端實作者：storage service＋DTO 兩 suites 104/104 PASS；Prisma generate／validate、限定 ESLint／格式檢查 PASS，使用本分支獨立依賴，未改 lock。
- 前端實作者：storage 專用 13/13 PASS，含 mixed purpose／null 繼承、320px 每個 target 實點、鍵盤 drawer、搜尋、公司切換／draft／unknown exact retry；正常四層 fixture 最後 2/2 PASS；受影響 known repair 收件場景 2/2 PASS。計數含 test runner 的 parent/subtest，不視為相同數量的獨立業務案例。
- 前端最後 build PASS；限定 lint 0 error，原 ReceiptLocationPicker ref-cleanup warning 保留。
- 獨立 review 找出的同架用途無障礙標籤遺漏已修：儲位 accessible name 讀出有效收件／待寄用途。修後受影響 Storage DOM 7/7 及前端 build PASS，包含 null 繼承與明確 OUTBOUND 的原生 accessible-name 精確斷言。
- Root 親執行後端正式 `npm run build` PASS；Claw generator coverage/drift check PASS，82 中英指南／106 routes／275 source hashes；knowledge 兩檔 20/20 PASS。Root 親讀正常桌面與 320px 合成 fixture 圖，沒有 modal、文字與位置可讀。
- Root `git diff --check` PASS。Claw 中英文操作及邊界已審／更新，source manifest 包含新 migration 與實際 picker。

後端完整 strict `tsc --noEmit` 並非 PASS：實作者觀察 136 diagnostics，用同一 client／其他 source 將三個 storage tracked TS 覆寫為固定085內容、排除新 DTO spec 的限定比較仍136、added/removed0。這不是獨立基底 client 或全回歸接受；正式 build 使用原 tsconfig.build 排除 spec 及既有設定並已成功。未因此修改其他模組或放寬 tsconfig。

## 中央發布接受

此批不自行套 DDL、build Cloud images、部署或改 shared DEV；由 DOA 唯一 writer 與最新批准 ERP 組合後成對 review。新 Prisma service 讀 purpose 前必須套相應 migration，舊 reader 可忽略新欄，但混合舊 writer 沒有新增用途 guard，發布窗口要協調。candidate 的正常登入、權限、儲位 API／畫面、原案件只讀兼容及流量／版本由中央另留收據。

不改 auth；DEV121 由維修視窗獨立 auth 候選處理，DEV123 已完成的變更不重做。原 REPAIR `CASE-20261013-235435-b5e96784eef6`／`MR-20261014-71F4585E-1` 後續仍沿原 quote2、通知 c168、當版同意與首筆 REPAIR 款票、維修／QC、交回與本人 accept_return。接受返回不要求此新貨架用途，不以儲位開發阻擋原案。

本批沒有 canonical browser 操作、DB apply、真實通知、款項、退款、物流或 ECOUNT 動作；一般人員主站 session 保留給 human。所有截圖與 DOM 測試為隔離合成 fixture，不冒稱線上 DEV 或實物驗收。
