# 儲運管理工具與工作區增量 — 2026-09-11

狀態：本機實作與測試完成，未部署、未提交／push、未套用正式 migration。私有 staging 保持原權限；没有新增 frontend invoke grant。正式資料、員工角色、WMS 流量與售後 source 程式未更動。

## 工作版本

- ERP：隔離 checkout `operations-corely-20260910/ecom-accounting-system-`，分支 `codex/operations-corely-20260910`，本輪基準 `171df6ba`。
- WMS：隔離 checkout `wms-erp-read-20260910`，分支 `codex/wms-erp-read-20260910`，本輪基準 `0120a59`。原 WMS checkout 仍為 `9b376526`，沒有覆蓋。
- 本文件涵蓋上述基準上的未提交增量；不可拿基準 SHA 當作包含本輪成果的發布版本。
- 本機預覽：`http://127.0.0.1:4396/tests/operations-preview.html?screen=%2Fwarehouse&role=admin`。所有 `TEST-*` 記錄為合成資料，重新載入會重置；測試帳號列不會編入正式入口。

## 原生 ERP 介面

- 管理員有 `wms_overview:read` 時直接進儲運總覽：待揀貨、揀貨中、待裝箱、裝箱中，以及左右兩條工作佇列。每筆顯示品牌、人員、核對件數、更新時間與未結例外；查詢明細不認領工作。
- 作業角色只保留揀貨／裝箱；有雙授權才可選工作站。業務的訂單拋轉保持獨立，不新增「出貨人員」。既有 shipping 權限值暫留後端相容，未作為可見工作角色。
- 工作者導覽只有授權工作及個人出勤／請假／資料；管理報表另行授權。主管的 `/warehouse` 與四項報表保留 ERP 授權模組導覽，作業人員及明確進入 `/warehouse/workstation` 的使用者才使用工作站導覽。
- 工作站提供手動大字模式、Escape 退出；新任務提示與本筆掃描結果分開。保留成功、錯誤、完成音效及可選語音，未代表實體喇叭驗收。
- 共用按鈕高度統一為控制項 token，預設 40px，掃碼區明確使用 56px；修正舊 primary 44px 覆蓋統一樣式、造成啟用／停用高度不同的原因。

| 工具 | 來源與操作 | ERP 權限 |
| --- | --- | --- |
| 操作日誌 | WMS `operation_logs`；訂單、人員、動作與允许清單內的掃碼內容 | `wms_logs:read` |
| 例外總覽 | WMS `order_exceptions`；原類型、原因、核可／結案狀態與備註；預設全部期間未結案 | `wms_exceptions:read` |
| 刷錯分析 | `scan_error` 記錄；依人員彙總、掃描值與原因明細 | `wms_scan_errors:read` |
| 新品不良分析 | WMS `product_defects`；商品回報數、原因、原 SN／更換 SN | `wms_defects:read` |

四者集中在 ERP 側欄「儲運管理中心」，依個別報表授權顯示。移除工作台底部四個重複入口；有授權的訂單明細仍可帶入訂單查詢字串，不代表名稱是權限依據。新品不良是倉內回報，不自動等同售後 DOA、退貨、庫存報廢或退款。回報數沒有已驗收分母，因此不稱為不良率／刷錯率。

## 主管介面修正 — 2026-09-11 使用者回饋

- 四項分析是 ERP 的主管功能，不是另一套 WMS 工作站的外連。主管總覽不再放「我的揀貨站／我的裝箱站／訂單拋轉」操作按鈕；另有作業授權者可由側欄「作業工作站」進入，純查核主管沒有此入口。
- 四個狀態改為獨立 24px 圓角卡片：待揀貨琥珀、揀貨中藍、待裝箱綠、裝箱中紫；標籤和件數保留，顏色不是唯一辨識方式。窄螢幕改為雙欄。
- 新增本機唯讀主管 fixture `role=supervisor`，只有總覽、四項報表和個人資訊；fixture 不允許主管 POST 或工作站操作。這不是修改正式帳號角色。
- 主管預覽：`http://127.0.0.1:4396/tests/operations-preview.html?screen=%2Fwarehouse&role=supervisor`。管理員仍可用 `role=admin` 查看包含其他授權模組的完整 ERP 導覽。
- 本次只調整 ERP 前端及測試，沒有修改來源 WMS、售後系統、正式資料、IAM 或部署狀態。
- 本次 frontend build、16 項導覽／工作流程／音效測試與 `git diff --check` 通過。瀏覽器驗證主管四報表、管理員 ERP→作業站→ERP 導覽、揀貨員無報表及直接開頁被拒絕；390px 畫面沒有水平溢出，桌面四卡各為 24px 圓角且背景顏色不同。截圖為 `output/playwright/warehouse-supervisor-colors-20260911.png` 與 `warehouse-supervisor-mobile-20260911.png`。

## API 與資料邊界

ERP `GET /wms/workbench/management/:section` 經登入、公司範圍、基本 `wms_tasks:read` 與即時個別報表權限，短效 RS256 委派到 WMS `GET /api/integrations/erp/v1/management/:section`。`section` 為 overview / logs / exceptions / scan-errors / defects。

WMS 再核對員工對照與該公司／品牌／report grant，只讀取 `erp_workspace_orders` 已核准且未撤銷的對照訂單。未對照、其他公司／品牌、無訂單的全域日誌不會洩入 ERP。公司從授權與 mapping 取得，不從顯示名稱猜測。

- WMS 查詢使用 REPEATABLE READ、READ ONLY transaction 與 statement timeout；總數、前十類彙總及分頁明細為同一快照。管理兩佇列各 10 筆、報表每頁 25 筆，不把前 1,000 筆或目前頁當作全部。
- ERP 嚴格驗證 `wms.management-read.v1`、source、section、唯讀 mode、coverage、空 allowedActions、各頁應有列數及彙總不超過總數；僅投影允许欄位。舊日誌自由文字不直接外洩。
- 管理總覽明細即使 command flag 開啟，仍走純讀取路徑，不認領、不改狀態。
- 報表日期用臺灣曆日；例外允許 `days=0` 全部期間，預設未結案，避免 120 天以前的問題消失。
- **上線前須核對歷史時區**：`order_exceptions` 與 `product_defects` 的 `created_at` 為無時區 timestamp。WMS `ERP_WORKSPACE_LEGACY_TIME_ZONE` 僅接受經稽核的 `UTC` 或 `Asia/Taipei`。未確認時不猜測，這兩類報表回 503。本輪未設定任何雲端變數。
- 查詢失敗會清除舊資料並顯示未接通，不呈現為零筆；撤銷權限後不再保留報表／抽屜資料。
- 管理畫面完成請求後每 15 秒輪詢；既有工作站為 3 秒，不是 WebSocket、跨裝置推播或離線通知保證。

## 刷錯紀錄修正

原 ERP/WMS 新命令流程對錯碼丟錯誤並回滾，沒有可供分析的持久刷錯紀錄。現在已授權、已認領的掃碼遇到不符／重複 SN／SN 歧義時，在同一交易記錄 `scan_error` 和 request receipt，再於提交後回傳拒絕。重送相同 requestId 回放原拒絕，不重複累計、不增加核對數量、不更動訂單 revision。權限、歸屬及過期版本拒絕不算員工刷錯。

命令仍預設關閉，且限獨立 staging DB；此修正沒有開啟正式寫入，也不會追補不存在的歷史錯碼。

## 驗證證據

- ERP 前後端 build 通過；backend 43 suites / 181 tests、frontend 指定導覽／工作流程／音效測試 15 tests 通過。
- WMS read／workspace／commands／management 共 6 tests（含 PGlite 真 SQL、簽章 HTTP）通過：1,005 筆統計、完整分頁、異品牌／公司隔離、撤權、唯讀、逾 90 天未結例外、錯碼重送只記一次。
- 跨 repo localhost HTTP 與兩個暫存資料庫的既有端到端 4 tests 通過。這不是真實 Cloud SQL、正式員工登入或生產通道驗收。
- 瀏覽器完成四報表導覽、SN 明細、分頁／搜尋、工作區保留、雙站選擇、大字模式／Escape、揀貨員直接開報表被拒絕，以及來源中斷不當作零筆等檢查。截圖位於 ERP checkout `output/playwright/warehouse-*-20260911.png`。
- 仍有既有 Ant Design Input.Search deprecation、bundle 大小及 browserslist 過期警告，不宣稱全站零警告。

## 後續驗收 gate

1. 審核兩 repo diff，分開提交／PR；不要覆蓋原 dirty ERP checkout，也不要推 main 觸發部署。
2. 隔離測試 DB 驗收新 WMS `023_erp_management_read.sql` 与 ERP `20260911130000_wms_management_permissions`；migration 只擴充 permission catalog／grant 型別，不自動賦權。
3. 取得實際公司／品牌／訂單／員工 mapping 核准、歷史時區證據與私有服務連線核准，才驗證真實來源。不得繞過使用者「維持私有 staging」決定。
4. 例外核可／結案、新品換貨／SN 寫入、完整管理日誌與舊資料移轉仍待獨立 command 契約與驗收；目前這四工具為唯讀。
5. 每日人力排班、Excel 全格式、SN 配置、封箱／貼標／交付物流、實收及庫存／發票／退款仍是前輪記錄的未完項。裝箱核對完成不代表已交給物流。

重新啟動預覽：在 ERP `frontend` 執行 `npm exec vite -- --config tests/after-sales-preview.config.ts --host 127.0.0.1 --port 4396`。不要把本機 fixture URL 當作正式服務。
