# 收發室與維修工作台：本機交接

更新：2026-10-02。使用者已同意繼續本機製作。本版仍未推送、部署、套用正式 migration、指派正式帳號、發送真實通知或執行退款。

## 程式與範圍

| 系統 | 程式庫／本機分支 | 起點 |
|---|---|---|
| ERP 員工工作台 | moztechCEE/ecom-accounting-system-；codex/mailroom-repair-20261001 | 1ef209eadae2a9a6269c6e5e3a38a25ed540c144 |
| 售後案件來源 | moztechCEE/moztech-after-sales-system；codex/mailroom-integration-20261001 | a5f6f5fed82db2b58a816682b1e7d4650eaed035 |

獨立目錄 corely-erp-mailroom-20261001、corely-after-sales-mailroom-20261001 位於本次 AI ERP 系統專案目錄；原有共享 checkout 未修改。2026-10-01 曾讀取售後正式 /api/version 為 a5f6f5f／00282-yin，只是當時觀測，不代表這兩個分支已上線。

售後保管原申報、報價、顧客同意、款項與退款；ERP 保管實物、位置、保管人、交接、進度與待辦。分級目前只記錄預定去向，WMS 正式入庫及退款扣抵尚未串接。

## 實際流程

**收發室**登入 /operations/mailroom，先看「待到貨」，或切換已收件清單。維修人員登入 /operations/repair，只看本人被指派或接手的物件；一般同仁在 /my/inbox 簽領本人的信件／包裹。

- **待到貨**：讀取售後原案件與單號，保留原申報，顯示整案及各品項已收／待收數量。部分收件仍留在清單；尚未收到實物不會產生實物收件紀錄。一般清單刷新不廣播通知。
- **維修**：到件登記 → 核對品項、數量、SKU／SN → 不符交承辦客服確認；相符後指定維修人員 → 本人在收發室平板簽收 → 維修工作台檢測 → 依售後同意及有效款項開始維修 → 完成後交回收發室本人簽收 → 待寄回。
- **退貨**：必填品項是否相符、包裝完整性、產品外觀、配件、處理說明及至少一張有效照片，才可送出檢查分級。不符先交承辦客服確認。AA 待重新入庫；A 選瑕疵補寄／福利品；B／C 指定維修整新，完成後交回收發室，待福利品入庫。
- **客服接手退貨檢查**：承辦客服在待辦中確認已看過檢查結果並留註。這是獨立的客服接手紀錄，不會改變維修／整新實物狀態，也不代表已退款或入庫。相同檢查重送保留既有確認、不重複通知；包裝／產品／配件、相符結果、等級、去向、接收人、說明或照片任一改變，才重新交辦。AA 若非全新未使用或缺配件會拒絕；原商品無附配件可選 NONE_EXPECTED。A／B／C 仍保留人工分級，待公司補齊判定規則。
- **信件／包裹**：指定同公司在職同仁 → 站內通知＋本人待辦 → 本人確認實物並記錄簽領位置 → 完成。看過通知不等於簽收。
- **待辨識、更正、移位、轉派**：保留首次收件時間、原申報與歷程；更正後重新核對。只有實際本人簽收才轉移保管責任。

售後同步逐件實收資料與時間軸，收到實物時同步 receivedAt／hasReceivedProduct。首件完成不等於整案完成；部分收件與超收保留待處理狀態，金融狀態不由實物進度覆寫。免費維修仍須售後核定零元並記錄顧客同意；付費維修依原有報價及有效收款流程。

## 平板本人簽收

收發室目前保管人開啟「維修人員本人簽收」，畫面只顯示這次物件及指定接收人。維修人員輸入員工編號、本人密碼；既有帳號啟用兩步驟驗證時也填六位數驗證碼。核對實物及簽收後位置，再點「確認本人身分並簽收」，不需手寫簽名。

服務端沿用既有登入驗證、檢查指定接收人／同公司在職員工／維修權限，並記錄交付人、接收人、物件與時間。維修 JWT 不回傳或儲存在平板，收發室登入身分不切換；密碼／驗證碼不進入業務歷程，表單送出或關閉後清空。相同請求可安全重送，內容變更或版本衝突會拒絕。

目前失敗嘗試限制為單程序；正式多實例上線前仍需配置既有入口的共用限流。

## 權限與通知

| 身分 | 權限／範圍 |
|---|---|
| MAILROOM_OPERATOR | mailroom:read/create/update；有權公司的收件 |
| REPAIR_TECHNICIAN | repair_workbench:read/update；本人物件 |
| 承辦客服覆核 | mailroom:read＋mailroom:review；明確授權，review 不繼承部門角色 |
| 一般同仁 | 本人收件與本人有權處理的待辦 |

收發室可隸屬行政部。migration 只建立職務／權限範本，不替正式同仁授權。

售後 Case.assignee 的 **員工 email** 映射至 ERP：必須唯一、同公司、在職、已綁定帳號、完成帳號設定且有 mailroom:review。相關交辦／客服確認時重新讀取來源承辦人，更新目前操作物件的承辦人；承辦變更即時 webhook 與整案批次改派尚未實作。未能映射時顯示警告，不通知整個客服部，也不以顧客 email 猜承辦人。真正需要交辦才建立指定人員的通知／待辦，重試及同一未完成待辦去重；權限撤回後不能憑舊待辦讀取物件。

## API 與本機 migration

1. 售後 GET /api/integration/mailroom/cases?awaiting=true&cursor=...&search=... 回傳 {items,nextCursor}，每頁最多 30 筆待到貨、最多掃描 150 筆來源案件。即使本頁 items 為空，也須繼續讀到 nextCursor=null，避免漏掉較舊案件。
2. 清單／詳情保留原 id、number、status，新增中文 statusLabel、assigneeId／Email／Name、整案 expectedQuantity／receivedQuantity／remainingQuantity，以及各申報品項 receivedQuantity／remainingQuantity。實收不符件計入其原申報數量；不同 SKU 的超收不抵銷缺件。
3. 原查詢 GET /api/integration/mailroom/cases?search=... 及詳情 .../cases/:id 保持相容。ERP 保存進度時，交易內寫歷程、待辦、通知及待送事件，再投遞 POST /api/integration/mailroom/events；eventId 去重、逐件 version 排序及重試。
4. 退貨事件附可空的 returnInspection（包裝／產品／配件，以及客服 reviewedAt／reviewedBy），售後保存並顯示。照片留在 ERP；來源事件只有照片數量，沒有影像內容。
5. AI 可受公司限制地讀 GET /api/v1/mailroom/integration/cases/:sourceCaseId，另預留 AI_CUSTOMER_SERVICE 待送事件。真正 Corely AI 接收端尚未接通，現有 AI ACK 是本機測試接收器。LINE AI PM／Corely Assist 部門通知列為後續。

HMAC-SHA256 原文：以換行串接 mailroom.v1、HTTP method、原始 pathname＋query、Unix 秒、entityId、SHA256(raw body)。Headers 為 x-mailroom-key、x-mailroom-entity、x-mailroom-time、x-mailroom-signature；60 秒時效、秘密至少 32 字元，憑證只放伺服器。ACK 必須 accepted=true 且 eventId 相同。

- ERP：MAILROOM_ENABLED 開 API／前端；MAILROOM_SYNC_ENABLED 才投遞；MAILROOM_CONNECTIONS 依公司配置 AFTER_SALES／AI_CUSTOMER_SERVICE；MAILROOM_READERS 配置 AI 查詢身分。
- 售後：MAILROOM_INTEGRATION_ENABLED、MAILROOM_CLIENTS，明確設定 entityId、keyId、secret、sourceChannels、label。舊 Case 沒有 companyId，以明確來源窗口隔離，禁止 * 或不同公司重疊；未確認映射前維持停用。
- 正式來源僅 HTTPS origin，拒絕重導及跨站路徑；MAILROOM_ALLOW_LOCAL 只用於本機測試。
- 原兩邊收發 migration，以及 ERP 20261002090000_mailroom_intake_review 已套至獨立 localhost。後者只新增 mailroom_receipts.customer_service_user_id、mailroom_items.return_inspection；未套正式資料庫。

## 驗證狀態

**2026-10-02 已通過：**

- ERP 29 項針對流程／平板簽收測試；售後 8 項來源與契約測試，另有實際 PostgreSQL queue 測試。
- 既有本機 PostgreSQL 整合及擴充後 mailroom-refinements.e2e.ts。驗證包含真 bcrypt 錯密碼 401、錯簽收人 403、成功與重送 200、改內容 409；無密碼／JWT 業務歷程；不完整退貨檢查回滾；精準通知去重；承辦 A 轉 B 後關閉 A 待辦、拒絕 A 確認且允許 B 接手；相同檢查保留確認、改照片重新交辦；客服接手不改實物狀態；本機全部庫存與付款表前後一致。
- ERP 前端、Nest 及售後 Next.js 建置；Nest 原 tsconfig.build 的型別檢查。ERP 整庫 strict tsc 仍有既有不相關錯誤，不能聲稱全部清零。
- 瀏覽器已驗證收件至維修接手流程：單件到貨、核對、平板錯密碼保留收發室登入、正確本人簽收、維修接手；後續處理由本機 PostgreSQL 整合测试驗證。本機 worker 投遞後，DEMO-R-003 顯示已收 1／4、尚待 3 並留在待到貨；AI 同步顯示只代表本機 ACK stub。截圖 artifacts/mailroom-local/awaiting-cases-20261002.png、tablet-accepted-20261002.png。
- 最後承辦人更新、相同檢查重送及 AA 規則修正後，對應整合測試、Nest／前端／售後建置及原 build config 型別檢查均通過；67 份指南／78 路由／134 來源雜湊檢查與 12 項指南生成測試亦通過。

2026-10-01 的 94 套件／846 項 ERP 測試、售後 11 項保護測試及瀏覽器信件簽領，是上一輪紀錄，沒有在今天冒充重跑。以上均屬本機示範，不代表 DEV／正式實體倉庫驗收。

## 示範與下一步

預覽 http://127.0.0.1:57646/_fixture，選行政收發、維修、客服或一般同仁。平板示範：員編 fixture-repair、密碼 FixturePass2026!，只限本機樣本。程序停止後預覽即不可用。

可重跑 ERP backend/test 的 mailroom-postgres.e2e.ts、mailroom-source-http.e2e.ts、mailroom-refinements.e2e.ts；售後 tests/mailroom-source-queue.local.test.ts。所有實際 SQL 測試都限定專用 localhost／MAILROOM_LOCAL_TEST；資料為 example.invalid／DEMO。

公司仍需指定試用與代理人、售後來源窗口對應公司、整新費用與核准人、顧客不同意的返還規則，以及 AA／A／福利品庫位和複驗責任。A／B／C 外觀與包裝如何共同判級仍待公司定義（先前 A 包裝嚴重瑕疵與圖片 A 輕微磨損需統一）。DEV 接線還需測試憑證、真正 AI 接收端與 WMS 單據驗收；正式部署另依既有流程處理。
