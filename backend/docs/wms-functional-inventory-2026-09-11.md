# WMS 功能盤點與 ERP 流水線整合驗收表

盤點日期：2026-09-11。範圍：實際路由、使用中的前端元件、後端處理、事件與 ERP 現有預覽。這是程式碼盤點，不是正式環境或實體設備驗收。

## 1. 版本與結論

- WMS 來源：`/Users/moztecheason/Documents/moztech-wms-ecpay`，分支 `codex/wms-ecpay-b2c`，commit `9b376526f23c90a907553450630634da4aad8fbf`。盤點時工作樹乾淨，未修改。
- ERP 比對：`/Users/moztecheason/.codex/worktrees/operations-corely-20260910/ecom-accounting-system-`，分支 `codex/operations-corely-20260910`，commit `60bfdcc5`。保留既有未追蹤的 `output/playwright/`。
- ERP 目前是角色工作區、任務表格與掃碼抽屜；不能代表原 WMS 工作站功能已完整整合。預覽使用測試資料；真實掃碼、認領寫入尚未開放。
- 目標必須是「ERP 內直接操作的揀貨站／裝箱站」，保留原流程，不以外部連結、iframe 或管理清單代替作業介面。
- 本次沒有部署、切換流量、執行資料遷移、掃描正式訂單，亦未改 staging 存取權限。

## 2. 現有工作流程

`行政匯入 → 待揀貨 → 認領揀貨 → 逐件掃碼核對 → 待裝箱 → 認領裝箱 → 再次逐件核對 → 核對完成`

原始狀態為 `pending → picking → picked → packing → completed`；另有 `voided`。

**`completed` 是裝箱核對完成，不是物流已收件。** 目前未看到封箱、貼標完成、實際交付物流各自獨立且完整的確認流程。物流事件和公司倉庫實收也不是同一件事。

## 3. 功能清單

以下「已接入口」指該版本程式有可追溯的使用路徑，不表示已在正式環境逐項操作通過。檔案路徑相對於上述 WMS 來源根目錄。

### A. 登入、權限與工作區

| ID | 現有功能 | 證據與限制 | ERP 整合要求 |
|---|---|---|---|
| A01 | 帳密登入、token 更新、登出 | `frontend/src/App.jsx`、`backend/src/routes/authRoutes.js` | 共用 ERP 身分；不在瀏覽器保存另一套服務憑證 |
| A02 | 登入過期、Socket 身分過期處理 | `App.jsx`、`frontend/src/api/socket.js` | 失效後停止作業，不沿用舊身分繼續掃碼 |
| A03 | 揀貨員、裝箱員、拋單員、管理員、最高管理員 | `frontend/src/components/admin/UserManagement.jsx` | 管理員授權多種能力，工作站只在已授權範圍切換 |
| A04 | 建立、編輯、刪除人員及指定角色 | `backend/src/routes/userRoutes.js` | 統一人員 ID，保留操作人的歷史責任紀錄 |
| A05 | 依角色限制任務與管理入口 | `backend/src/utils/taskPagination.js:39`、`frontend/src/ui/AppLayout.jsx` | 後端限制任務與操作；不能只隱藏選單 |
| A06 | 側邊欄收合、寬度調整、離線提醒 | `AppLayout.jsx` | 一般導覽保留；流水線模式只突出當前工作 |
| A07 | 當日角色／工作站切換 | **未找到正式切換流程**；現行使用帳號固定 role | 新增工作站選擇、交接規則；不等於修改帳號權限 |
| A08 | 個人出勤、請假 | 非本次 WMS 既有模組 | 沿用 ERP 個人功能，不向倉儲人員開放他人薪資或無關模組 |

### B. 行政拋單與任務接收

| ID | 現有功能 | 證據與限制 | ERP 整合要求 |
|---|---|---|---|
| B01 | Excel／CSV 匯入、拖曳檔案、進度與結果 | `frontend/src/components/admin/AdminDashboard.jsx` | ERP 新增／匯入後經授權命令拋單，不直接寫 WMS 資料表 |
| B02 | 解析訂單、客戶、品項、數量、條碼、SN | `backend/src/services/orderImportParser.js` | 保留原格式及錯誤行號；規格見第 4 節 |
| B03 | 重複訂單攔截、交易回滾、同單併發保護 | `backend/src/routes/orderRoutes.js:535` | 訂單公司範圍、唯一來源鍵、冪等提交與結果查詢 |
| B04 | 匯入結果不確定時禁止直接重送 | `AdminDashboard.jsx`、`orderRoutes.js` | ERP 也必須顯示待核對，不把逾時當作未建立 |
| B05 | 新任務事件、提示音、語音、桌面通知 | `frontend/src/components/TaskDashboard.jsx:610` | 兩種工作站都需完整事件；現有缺口見第 6 節 |
| B06 | 急單、團隊共享置頂、排序 | `TaskDashboard.jsx`、`backend/src/routes/commentRoutes.js` | 保留優先順序；新任務不能打斷正在掃描的訂單 |
| B07 | 任務認領／繼續、批次認領揀貨 | `TaskDashboard.jsx`、`orderRoutes.js` | 保留領單互斥；批次認領 UI 目前限管理員，不是所有揀貨員都有按鈕 |
| B08 | 訂單作廢、單筆／批次刪除 | `orderRoutes.js` | 屬管理操作，不在作業員主畫面暴露；不因整合擴張破壞性權限 |
| B09 | 任務搜尋、狀態／急單篩選、分頁、統計 | `TaskDashboard.jsx`、`taskPagination.js` | 主站只顯示該站待辦及本人作業；管理員另有全局視圖 |
| B10 | 完成紀錄按日期查詢 | `/api/tasks/completed`、`taskPagination.js` | 日期依台灣時間的訂單更新日期；不可誤稱實際物流出貨日期 |

### C. 揀貨與裝箱工作站

| ID | 現有功能 | 證據與限制 | ERP 整合要求 |
|---|---|---|---|
| C01 | 獨立訂單作業頁、流程階段、客戶與單號 | `frontend/src/components/OrderWorkView.jsx`、`WarehouseOrderHeader.jsx` | 整頁工作站，不以側邊抽屜作主要流水線畫面 |
| C02 | 應核對／已揀／已裝／剩餘數量 | `frontend/src/utils/orderWorkProgress.js` | 大字顯示當前階段；後端確認後才更新成功狀態 |
| C03 | 專注模式 | `OrderWorkView.jsx`、`WarehouseOrderHeader.jsx` | 保留減少次要資訊、已完成品項隱藏；原功能不是瀏覽器全螢幕 API |
| C04 | 條碼槍輸入、Enter 送出、回到掃碼焦點 | `OrderWorkView.jsx` | 掃碼焦點固定且可見；不能被更新或通知搶走 |
| C05 | 相機掃描、選擇相機 | `frontend/src/components/CameraScanner.jsx` | 作業页使用 single 模式；元件的其他模式不視為現行已接流程 |
| C06 | SN 逐件揀貨與裝箱二次核對 | `orderRoutes.js`、`OrderWorkView.jsx` | 裝箱必須驗同一批已揀 SN；未揀不能直接完成装箱 |
| C07 | 無 SN 品項按條碼累計、數量加減 | `OrderWorkView.jsx`、`orderRoutes.js` | 保留角色、阶段與數量限制；人工修正也留紀錄 |
| C08 | 品名／型號／條碼／SN 搜尋、SN 展開 | `OrderWorkView.jsx` | 主畫面仍以待核對品項為主，不要求員工查大表 |
| C09 | 同條碼多品項列、進度排序、完成收起 | `orderWorkProgress.js`、`OrderWorkView.jsx` | 不把同條碼不同訂單列錯誤合併 |
| C10 | 錯碼、重複 SN、超量、階段不符攔截 | `orderRoutes.js` | 畫面錯誤＋錯誤音；不得顯示成功或增加計數 |
| C11 | 送出中防重入、未確認結果鎖定 | `frontend/src/utils/scanSubmission.js` | 同掃描重送冪等、斷線查結果；不能把網路重試當成下一件 |
| C12 | 狀態更新、重連載入、正在查看人數 | `OrderWorkView.jsx` | 先驗授權再訂閱；重連恢復可信快照，不重播歷史成功音 |
| C13 | 完成彈窗、約 2 秒導回完成清單 | `OrderWorkView.jsx:1333` | 流水線應留在當前工作站並呈現下一件任務；不自動認領、不跳去歷史列表 |
| C14 | 封箱／貼標／物流交付逐步確認 | **現有掃碼狀態未完整區分** | 與裝箱核對分開紀錄；實體驗收前不宣稱已出貨 |

### D. 提示音、語音與通知

| ID | 現有功能 | 證據與限制 | ERP 整合要求 |
|---|---|---|---|
| D01 | 新任務、認領、完成、錯誤、一般成功音 | `frontend/src/utils/soundNotification.js` | 保留聲音識別，不只改成文字 toast |
| D02 | 揀貨成功單音、裝箱成功雙音 | 同上 `playScanSuccess` | 每次後端接受一次掃描，播報一次；两站可區分 |
| D03 | 已掃數量／剩餘件數、新任務、錯碼語音 | `frontend/src/utils/voiceNotification.js`、實際呼叫點 | 語音預設關閉；不能把工具函式存在當作每條路徑都有播報 |
| D04 | 音效、語音、桌面通知開關 | `frontend/src/components/SettingsPage.jsx` | 現在保存在該瀏覽器；未有統一工作站設定或喇叭自測流程 |
| D05 | 使用者互動後啟用音訊、桌面通知權限 | `soundNotification.js`、`desktopNotification.js` | 上工時明確「開始作業／測試提示音」；未授權要有可見狀態 |
| D06 | 訊息中心、未讀／緊急數量、全部已讀 | `frontend/src/components/NotificationCenter.jsx` | 與作業通知分級；一般訊息不搶掃碼焦點 |

### E. 異常、協作與列印

| ID | 現有功能 | 證據與限制 | ERP 整合要求 |
|---|---|---|---|
| E01 | 缺貨、破損、多掃、少掃、換 SN、其他、訂單異動 | `backend/src/routes/exceptionRoutes.js:15` | 原分類與現場回報流程完整保留 |
| E02 | 拋單員提出處理、管理員核可／駁回、結案 | `exceptionRoutes.js`、`frontend/src/components/admin/Exceptions.jsx` | 保留角色責任與異常阻擋；不是任意「略過錯誤」 |
| E03 | 訂單異動及掃碼阻擋、附件預覽／下載 | 同上、`OrderWorkView.jsx` | 待審異動不可继续掃描；確認採用版本並保留歷程 |
| E04 | 新品不良換 SN、原因、原／新 SN 紀錄 | `frontend/src/components/DefectReportModal.jsx`、`orderRoutes.js` | 管理員／拋單員原有權限；不同於顧客退修收貨或庫存自動調整 |
| E05 | 訂單即時討論、提及人員、已讀、置頂、撤回／刪除 | 使用中的是 `frontend/src/components/TaskComments-modern.jsx` | 保留訂單上下文及後端權限，不照搬舊版未使用元件 |
| E06 | 浮動討論視窗 | `frontend/src/components/FloatingChatPanel.jsx` | 預設不遮擋扫描區；需要時才展開 |
| E07 | 團隊公告／交辦、指派、期限、優先級、狀態、留言附件 | `TeamBoard.jsx`、`TeamPostView.jsx`、`backend/src/routes/teamBoardRoutes.js` | 部門範圍可見，與訂單作業任務分開 |
| E08 | 訂單標籤、揀貨單、簽核欄 | `frontend/src/components/LabelPrinter.jsx:13`、`:151` | 保留尺寸、單號、品項及紙本用途；需實體印表機驗收 |
| E09 | CODE128 訂單條碼與無法編碼時替代提示 | `frontend/src/utils/orderBarcode.js` | 不改原單號；實印後由兩站條碼槍讀回驗收 |
| E10 | 訂單明細 Excel 匯出 | `WarehouseOrderHeader.jsx`、`OrderWorkView.jsx` | 權限與匯出內容對齊；不將已匯出視作出貨完成 |
| E11 | 批次列印 | **未完成**：`LabelPrinter.jsx:381` 只有 toast／console，未找到有效使用入口 | 不能算現成可用功能；若需要須另做並實印 |
| E12 | 任務轉移 | 後端 `commentRoutes.js:615` 有 API，未找到使用中的前端呼叫 | 權限及狀態檢查不足，不能直接當正式交接功能對外開放 |

### F. 管理、查詢與物流

| ID | 現有功能 | 證據與限制 | ERP 整合要求 |
|---|---|---|---|
| F01 | 操作日誌、筛選、即時更新、CSV | `frontend/src/components/admin/OperationLogs.jsx`、`backend/src/routes/analyticsRoutes.js` | 統一人員／訂單對照與可追溯 request ID |
| F02 | 訂單／完成／商品等分析儀表板 | `frontend/src/components/admin/Analytics.jsx` | 管理入口；不可把核對完成統計叫做物流送達 |
| F03 | 刷錯條碼分析、操作人員／原因／明細、CSV | `frontend/src/components/admin/ScanErrors.jsx` | 現場僅看當下錯誤；管理員另看分析 |
| F04 | 新品不良統計、原新 SN、更換人、報告 | `frontend/src/components/admin/DefectStats.jsx` | 留存追溯，不混入一般維修案件 |
| F05 | 綠界帳號與既有物流單查詢、加入追蹤 | `backend/src/routes/logisticsRoutes.js`、`backend/src/services/ecpay/` | 明確公司／品牌／訂單／商店對照，帳號名稱不當品牌依據 |
| F06 | 貨態手動更新、事件、預期退回、官方託運單預覽 | 同上、`frontend/src/components/LogisticsSettings.jsx` | 到店／取件／退回物流中心與公司實收分開；物流候選部署需另驗 |
| F07 | 自動匯單、正式定時追蹤、新建／逆物流、倉庫實收 | **不得視為本版已完整完成** | 各自建立責任邊界與驗收；不啟用正式庫存／退款／開票寫入 |

## 4. 原匯入格式

解析器目前一次讀一個檔案的第一張工作表，建立一張訂單；不是多張訂單整批匯入精靈。

| 欄位 | 原程式接受方式 |
|---|---|
| 訂單編號 | 憑證號碼／憑證號／訂單編號／訂單號碼／訂單號／單號／Voucher，標籤後或相鄰儲存格 |
| 客戶 | 客戶名稱／客戶／收貨人／Customer；可無值 |
| 條碼 | 品項編碼／國際條碼／條碼，必填 |
| 品名 | 品項名稱，必填 |
| 數量 | 數量，正整數，必填 |
| 型號 | 品項型號／型號／Product Code；亦可從品名中括號讀取，否則用條碼 |
| SN | 摘要／SN／序號；目前限定 12 或 13 碼英數；有 SN 時數量須相符，且整單不可重複 |

上限：10 MiB、5,000 列、100 欄、每單 1,000 品項、10,000 SN、總量 50,000。空內容、缺欄、無有效品項、重複單號及不合法 SN 會拒絕；原子交易確保失敗不留半張單。

現行解析欄位沒有完整的公司／品牌 ID、收件地址／電話、寄送方式或 ERP 訂單關聯。整合不能把客戶名或條碼猜成品牌，也不能把這個舊檔案格式當作完整物流建單契約。

## 5. ERP 尚未保留的工作站能力

目前 `frontend/src/pages/WarehouseCenterPage.tsx` 與 `frontend/src/components/WarehouseOrderPanel.tsx` 只提供表格、進度、篩選、認領／掃碼控制與測試狀態。

還不能取代：整頁專注工作站、聲音／語音、現場單件顯示、下一單交接、相機、原生列印、例外審核、SN 更換、協作討論、實際拋單與真實雙站掃碼。

已有服務間唯讀橋接程式不等於正式作業已接通。真實命令、事件訂閱、資料對照、授權與設備驗收仍必須完成；私有 staging 維持既有授權邊界。

## 6. 本次確認的流程缺口

1. **新任務不是自動刷新完整清單。** `TaskDashboard.jsx:610–660` 的 `new_task` 會提示及發聲，但只標记清單有變更，仍需取得新清單。狀態事件只更新已存在的行，不補入新符合角色的任務。
2. **揀完交給裝箱缺少完整通知鏈。** 匯入在 `orderRoutes.js:595` 發出 `new_task`；掃碼完成在同檔約 934 行發出 `task_status_changed`。裝箱端此事件處理沒有新裝箱任務提示音，且其原列表通常沒有該待揀訂單。這與無人操作滑鼠的流水線螢幕需求不符。
3. **最後一掃播報不一致。** `OrderWorkView.jsx:1333–1364` 自己提交的最後一件會先播一般揀／裝成功音，再進完成分支提前返回，跳過剩餘數量語音。Socket 又會跳過本人送出中的事件，可能沒有專用完成音。不是每次完全無聲，而是完成回饋不一致。
4. **一般聊天音效名稱無實作。** `TaskComments-modern.jsx:172` 呼叫 `play('message')`；`soundNotification.js:225` 附近映射沒有 `message`。提及通知另走其他路徑，不能把全部通知一概稱作無效。
5. **語音可能互相截斷。** `voiceNotification.js` 每次播報先 `cancel()`，連續掃描會取消上一句；缺少錯誤優先、剩餘件數合併、完成不可漏的佇列規則。
6. **完成後導去歷史清單。** 現有流程約 2 秒後前往 completed 視圖；下一單作業需要再切回。不適合連續工作站直接接下一任務。
7. **角色是固定帳號角色。** 不能靠修改網址或前端 role 參數取得另一種工作；須新增經後端授權的當班工作站選擇。
8. **轉移 API 不可直接沿用。** `commentRoutes.js:615` 只檢查接收人及類型非空，未看到處理者／接收人角色、當前任務歸屬、狀態與公司範圍的完整檢查；掛載僅要求登入。這是原碼層面的權限缺口，未對正式資料實際嘗試轉移。
9. **舊訂單 GET 有寫入副作用。** `orderRoutes.js` 的訂單詳情讀取包含狀態更新邏輯，不能拿它直接當 ERP 純查詢 API。需保留新的唯讀服務邊界，把狀態轉換放進明確命令。
10. **封箱、列印、交運不是掃碼完成的同義詞。** 尤其瀏覽器列印視窗關閉不代表紙張成功輸出，預期退回也不代表實收。

未列為可用功能：未被入口引用的 `TaskDashboard-with-batch.jsx`、`OrderTimeline.jsx`、舊版 TaskComments，以及只有框架的批次列印。這些不是已完成的功能證據。

## 7. 整合後的工作站規格

先保留「行政拋單 → 揀貨逐件驗證 → 裝箱逐件二次驗證」核心，不混入售後重構。

| 工作區 | 登入後看見 | 主要動作 |
|---|---|---|
| 拋單 | 建立／匯入、待送出、已拋單、異常回覆 | 確認來源與內容後送單 |
| 揀貨站 | 可接揀貨、本人進行中、當前單／品項／剩餘數 | 認領、掃碼、回報異常、揀貨交接 |
| 裝箱站 | 待裝箱、本人裝箱中、待核對品項及已揀 SN | 認領、二次掃碼、列印、封箱／交運確認 |
| 主管 | 各站進度、積單、例外、指派與審核 | 授權、交接、異常處理；不是作業員預設畫面 |

- 登入同一 ERP；能兼任者只切換已授權工作站。每次操作保留同一員工身分與當次工作站。
- 未完成訂單留在原階段，不因切站改狀態；轉交他人必須明確交接，不假裝自己是另一人。
- 大螢幕主區固定單號、當前階段、待核對品項與剩餘數；掃碼區始終可見。聊天、報表、明細按需展開。
- 任務事件只提示相應授權工作站；帶序號的事件去重、重連補快照，不能漏掉揀貨到裝箱的交接。
- 掃描成功單／雙音、錯誤警示、全單完成音有明確區別。錯誤不能被一般數量語音覆蓋。
- 完成後留在同一工作站，清楚呈現下一張可接任務；不自動認領、不突然跳至其他部門頁面。
- 對外 API 由服務身分與員工授權共同限制；不直接寫 WMS 表、不將全域管理 token 發給前端。

## 8. 必須逐項通過的驗收

| 類別 | 測試 |
|---|---|
| 雙站分流 | 揀貨帳號只收到揀貨任務；裝箱只收到已可裝箱任務；越權 HTTP／Socket 均拒絕 |
| 兼任與交接 | 已授權兼任者可切站；未授權者不可切；切站不丟進度、不換操作人、不繞過已揀驗證 |
| 真實拋單 | 原 Excel 樣本與 ERP 新單建立後，僅建立一次任務；重複提交、部分錯欄、逾時可核對 |
| 雙掃 | 含 SN、無 SN、同條碼多列均驗；錯碼、重複、超量、未揀直接裝箱、兩人搶單均驗 |
| 雙螢幕通知 | A 站揀完，B 站不手動刷新也看見可接任務並聽到提示；不重播、不中斷掃碼焦點 |
| 提示音 | 上工啟用、成功、錯誤、最後一件、靜音／未授權、切到背景、重連、快速連掃均驗 |
| 原流程輔助 | 異常申請／審核／恢復、附件、討論提及、SN 換貨、急單／置頂逐一驗 |
| 設備 | 現場兩套條碼槍、螢幕距離與解析度、兩站喇叭、標籤機與列印後讀回條碼實測 |
| 網路與一致性 | 送出後斷線、回應遺失、重連、重複事件、服務重啟；不能多加數量或顯示假成功 |
| 出貨事實 | 核對完成、封箱、列印、交運、物流狀態、退回實收各自留證據 |

驗收順序：① 本機流程與權限測試 → ② 隔離測試資料雙站操作 → ③ 現場設備驗收 → ④ 獨立核准部署與流量切換。任何一層通過，都不能代替後面的驗收。

本次交付是功能與缺口盤點；未執行上述驗收，也未將本文件中規劃標為已實作。
