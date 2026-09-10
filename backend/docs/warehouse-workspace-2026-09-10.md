# 儲運工作區交接 — 2026-09-10

## 本次交付與驗收層級

ERP 隔離分支 `codex/operations-corely-20260910`。本次新增內容僅本機，未部署、未套用權限 migration、未變更 IAM 或正式人員權限。使用者要求私有 staging 維持私有；沒有授予 ERP 前端呼叫權限。

- 「品牌與 LINE」選單、頁面標題統一為「品牌設定」。
- `/warehouse` 直接呈現 ERP 原生操作介面，不外連、無 iframe。
- 儲運工作區的選單只呈現授權的出貨工作台、我的出勤、請假申請、個人資料；多職務管理員可切回其他授權功能。搜尋與側欄共用相同導覽政策。
- 有 WMS 任務權限的非管理員登入導向工作台；純儲運使用者不進入營運總覽。這不是全站既有 API 權限稽核完成的證明。
- 本機預覽角色僅切換合成測試身分，不會設定真實帳號權限。模擬器只在 `frontend/tests` 開發入口掛載，不進入正式 bundle。

## 工作區與責任

| 工作區 | 預期工作 | 本次實作範圍 |
| --- | --- | --- |
| 訂單調度 | 行政建立、匯入訂單與安排作業 | 授權入口、清單及明細；尚無真實建單／指派功能 |
| 揀貨 | 認領任務、掃商品 SN／條碼、查看進度 | 原生操作面板與本機模擬流程 |
| 裝箱核對 | 接收已揀訂單、掃碼裝箱、查看進度 | 原生操作面板與本機模擬流程 |
| 出貨交接 | 核對完成後交付物流及追蹤 | 授權入口、分離的物流事實；交接指令尚未實作 |

共用一筆訂單的作業進度：待揀貨 → 揀貨中 → 待裝箱 → 裝箱中 → 核對完成。核對完成不等於交付物流，物流中心收到退件不等於公司實收。

售後維修／補寄保留原案件與角色佇列。後續以有公司、品牌、案件、訂單對照的出貨需求交接到儲運，不把報價、收款、維修、退款或發票状态塞入上述倉儲狀態。

## 來源程式核對

WMS `/Users/moztecheason/Documents/moztech-wms-ecpay`：`codex/wms-ecpay-b2c`、`9b376526f23c90a907553450630634da4aad8fbf`，本次唯讀，未修改。另套售後系統未修改。

- `backend/src/routes/taskRoutes.js`：picker／packer／dispatcher 角色與工作佇列。
- `backend/src/routes/orderRoutes.js`：claim 的交易鎖、指派與待審異動限制；scan 的角色、任務歸屬、SN／數量檢查。dispatcher 不可代替 picker／packer 認領。
- `backend/src/utils/orderCompletion.js`：序號與非序號品項的完成判斷、異常阻擋。
- `frontend/src/utils/orderWorkProgress.js`：揀貨與裝箱進度分開。
- 舊訂單 GET 有狀態／鎖定變更副作用，禁止直接當唯讀代理。

## 權限與指令邊界

新增 catalog-only migration `20260910150000_wms_permission_catalog`，只加入五項 permission，不建立角色、不賦權、不改 membership 或 scope：

- `wms_tasks:read`
- `wms_orders:create`
- `wms_picking:execute`
- `wms_packing:execute`
- `wms_shipping:execute`

不能由 `inventory:read` 推定出貨權限。現有管理員角色編輯器將能呈現這些翻譯後權限，但正式人員對照、可選任務範圍與指派介面仍待完成／验收；不得自動賦權。

ERP GET 清單／明細、POST pick/pack claim/scan 皆保留 JWT、權限與公司 guard。操作還需各自 execute + tasks read。未接來源時一律明確回 `503 WMS_SOURCE_NOT_APPROVED`，不是假成功或空清單。

指令帶 `entityId`、`expectedRevision`、`requestId`，掃碼另帶 `scanValue`。UI 阻止同時提交，結果不確定時停止操作並要求重新載入，不盲目重送。正式來源仍須實作可信 actor/company/brand/order mapping、WMS 單一寫入者交易、版本鎖與持久冪等回執；不可僅依前端送來的身分決定權限。

## 驗證

- 前端 13 tests 通過：導航／角色隔離、品牌文字、重複 SN、錯誤條碼、版本衝突、跨角色操作、任務歸屬、待審阻擋、冪等重放與鍵重用拒絕、揀貨轉裝箱。
- 後端 39 suites / 170 tests 通過：包含實際 PermissionsGuard 的操作權限拒絕、DTO 邊界與未核准來源 503。
- 前後端 build 通過；前端保留既存 bundle 大小與瀏覽器資料過期警告。
- 瀏覽器用 TEST-WMS-0001 完成認領揀貨、SN + 兩件配件、轉裝箱佇列、認領裝箱、重複 SN 拒絕、重新載入後完成裝箱。3/3 核對完成，物流仍尚無紀錄，實收仍尚未確認。驗證管理員選單與頁面皆為「品牌設定」。
- 共用 primary button 樣式排除 disabled 狀態，避免停用按鈕仍呈黑色可操作外觀。

## 未完成，不可宣稱上線

1. WMS 服務身分、HTTP 契約掛載、最小範圍與員工／公司／品牌／訂單精確對照；來源讀取與命令全鏈路驗證。
2. 行政建單／匯入、真實指派、任務即時更新與併發處理；來源服務持久冪等、稽核／outbox。
3. 舊功能 parity：SN 正規化／數字比對、多列共用條碼、減量／撤銷、異常審核、備註、附件、批次、匯出與列印。模擬器只有受限的基本掃碼流程，非完整替代。
4. 售後案件出貨需求與逆向實收／檢驗的交接；ECOUNT 仍為庫存依據，無自動扣補、退款或發票寫入。
5. 真實角色帳號的端到端越權測試（含人資自身資料範圍），部署／migration／私有連線／正式切流各別驗收。

上一輪 staging 狀態見 `operations-staging-receipt-2026-09-10.md`，不代表本次工作區增量已部署。
