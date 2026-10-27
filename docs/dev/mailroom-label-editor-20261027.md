# 收發室貼紙文字編輯與列印進度

基底為已實印驗證的 ERP 7a70da4488fbbe7355947c9fc282ec38fb6ef11a。使用獨立 codex/mailroom-label-editor-20261027 分支；此文件本身不是部署或實物驗收證據。

單件列印的主要按鈕保留一鍵送印，旁邊的可觸控選單提供「編輯標籤並列印」。可調整本次貼紙顯示案件號、姓名、電話、品名與問題摘要，提供 50 × 30 mm 示意，並限制各欄輸入長度，並可查看使用同一後端繪製器的實際 PDF。QR、公司、實物及來源案的識別不能編輯；沒有回寫原案、保固、初檢或業務狀態。

新增 POST `/mailroom/print-label-preview`，需 canonical Origin、目前同公司在職收發權限，只產 PDF、不註冊裝置或建立工作。`POST /mailroom/print-jobs` 接可選 `labelEdits`，每件顯示欄位修改綁定載入時 `expectedVersion`。前後端都限制欄位與長度；後端再次核對權限、公司與實物版本，過期回 `LABEL_VERSION_CHANGED`，不得用舊顧客內容套到新實收資料。真正文字修改進入 normalized requestHash，重複 requestId 仍回同工作；沒有修改保持舊 hash 相容。

編輯內容只留本頁記憶體及該次不可變 PDF；瀏覽器待核對工作只保存識別與內容指紋，不保存顧客文字。舊工作未知時先查原結果，本次新文字不能被舊工作成功回執吞掉，也不自動重印。畫面分辨製作、等待接收、處理與已送印；已交 CUPS 不等於紙已印出。

本輪唯讀觀察的第 11–15 張 CUPS 都已 completed，沒有排隊或錯誤；估算建立工作到 CUPS 接收 0.5–3.6 秒，驅動 processing 到 completed 7–9 秒。它們不是實際 click-to-paper 量測，也沒有證據可認定 Cloud Run 冷啟動或 USB 故障。本次保留既有 3 秒 agent 輪詢、原廠驅動、50×30／203dpi／Rotation180，不以改 raw 指令或重配對調整已驗收硬體。

驗證需涵蓋未編輯相容性、編輯預覽與送印同資料、不可變 QR、client stale 及 render 後 CAS、同 requestId 變文拒絕、跨公司／無權拒絕、未知回讀與不重印、長字及320px排版。原維修案第12版與既有初檢草稿保留，AI 等待及正式資料／通知／退款界線不變。
