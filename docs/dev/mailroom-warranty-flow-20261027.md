# 收發室保固核對與問題紀錄（本地候選）

基底 ERP `698486ed39bb4cf9af565a59622e02f9df23217c`。獨立分支 `codex/mailroom-warranty-flow-20261027`。本變更不部署、不連線資料庫、不更改正式保固、既有 DEV 案件或通知。

## 操作與資料邊界

收件與配對沿用既有流程；筆型初檢入口依序提供保固核對、問題紀錄、初步檢測，再回收件紀錄列印。收發人員以原有員工身分外開 `https://admin-warranty.moztech.cc/login` 查核或直接修改日期／購買憑證。ERP 只存人員人工核對紀錄，不代寫或宣稱已同步保固主檔。依公司本輪回答，沒有新增客服審核閘門。

`MailroomPrecheckDocument.data` 正式擴充兩個可選結構，免新增資料表或 migration：

- `warrantyReview`：`schema:1`、`method:MANUAL_EXTERNAL`、`status:CHECKED|NEEDS_CORRECTION|CORRECTED_EXTERNALLY`、`warrantyNumber`（選填 200 字）、`note`（選填 2000 字）、伺服器提供的 `recordedById/recordedByName/recordedAt`。
- `mailroomIssue`：`schema:1`、`symptom`（收發補充問題，2000 字）、`preliminaryReason`（原因初判，2000 字）。此為觀察，非技師已確認原因。

保存使用既有 `POST /mailroom/prechecks/items/:id/save`。省略新欄位保留原紀錄，`null` 明確清除；相同保固狀態、編號與備註不會因後續保存檢測而變更核對人／時間。只接受明確定義欄位；客戶端不得填入稽核身分、時間、method、schema 或宣稱保固已同步。草稿／套用初檢表保留人工核對與補充問題；實收身份變動沿原重新核對語義處理。

現行有效公司、`mailroom:update` 與同公司在職資格保持；保存仍受原實物 `expectedVersion`、文件 `expectedRevision`、identity hash、鎖後權限重驗及原 requestId/body 指紋保護。只有 RECEIVED、收發室保管、未交辦且未由技師簽收的文件可修改。已交辦後，技師只讀取得本版人工核對與問題紀錄；草稿、舊實收身份不投影。

貼紙仍取 Source 原客服描述，不用補充問題、初判原因或內部備註覆蓋；本變更不改標籤、列印佇列或 agent。既有 v12 `READY_FOR_DISPATCH` 案件不補做初檢、不退回節點，原列印功能照常可用；完成後的物件沒有初檢文件時，清單顯示「未留初檢紀錄」，不是要求重做。真正內嵌保固寫入仍需另驗證舊站員工 API、公司／站點與版本映射。

## 驗證

新增後端測試涵蓋合法結構、人工戳記、防注入、清除與省略、現況不變、相同 requestId 重讀、已完成 v12 禁止重開、交辦 hash 對補充內容的並發保護、提交前隱藏與提交後只讀。前端實際 DOM 涵蓋 320px、舊資料不自動核對、保固與問題暫存／回讀、換表保留、明確清除、已交辦及待寄回只讀。實際測試結果與編譯證據另交整合者；此文件不是 DEV 發布或人工驗收憑證。
