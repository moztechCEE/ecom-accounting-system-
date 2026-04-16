# HR & Payroll Handoff - 2026-04-16

## 本次完成

### 資料模型

- `LeaveType`
  - 新增 `balanceResetPolicy`
  - 新增 `allowCarryOver`
  - 新增 `carryOverLimitHours`
- `LeaveBalance`
  - 新增 `periodStart`
  - 新增 `periodEnd`
  - 新增 `manualAdjustmentHours`

對應 migration：

- `backend/prisma/migrations/20260416195500_simplify_leave_rules_for_payroll/migration.sql`
- `backend/prisma/migrations/20260416233000_add_payroll_payment_tracking/migration.sql`
- `backend/prisma/migrations/20260417003000_add_payroll_policy_settings/migration.sql`

### 後端邏輯

- `BalanceService`
  - 可依假別規則建立年度/到職週年額度帳本
  - `ANNUAL` 特休若未設定固定年度額度，會依標準年資級距自動計算
  - 送出假單時預留 `pendingHours`
  - 假單狀態改變時同步 `pendingHours / usedHours`
- `LeaveService`
  - 送單時先驗證與保留額度
  - 新增查詢假別與個人額度
  - 狀態更新時回寫 reviewer 與額度
  - 管理端查年度額度時，會先補齊該年度應有的額度帳本
  - 假單建立、狀態更新、假別建立/修改、額度調整都會寫入 audit log
- `LeaveController`
  - `GET /attendance/leaves/types`
  - `GET /attendance/leaves/balances`
  - `PATCH /attendance/leaves/:id/status`
  - `GET /attendance/leaves/admin/requests`
  - `GET /attendance/leaves/admin/types`
  - `POST /attendance/leaves/admin/types`
  - `PATCH /attendance/leaves/admin/types/:id`
  - `GET /attendance/leaves/admin/balances`
  - `PATCH /attendance/leaves/admin/balances/:id`
- `AttendanceIntegrationService`
  - 回傳 `leaveEntries`
  - 回傳 `deductibleLeaveHours`
- `PayrollService`
  - 新增部門建立
  - 新增員工建立 / 更新 / 單筆查詢
  - 新增 `PayrollPolicy` 設定讀取 / 更新
  - 月薪換算工時、加班倍率、台灣勞保/健保比例、中國社保比例不再寫死在程式
  - 將已核准請假轉為 `LEAVE_DEDUCTION`
  - 新增薪資批次明細查詢
  - 新增薪資批次 audit log 查詢
  - 新增草稿 -> 待批准 -> 已批准狀態流
  - 建立批次時改用真實 `createdBy`
  - 送審/批准時同步 `ApprovalRequest`
  - 新增個人薪資單列表與單張薪資單查詢
  - 新增 `approved -> posted` 過帳流程
  - 過帳時會建立最小可用薪資分錄：
    - 借：`6111 薪資支出`
    - 貸：`2191 應付薪資`
  - 新增 `posted -> paid` 發薪流程
  - 發薪時會記錄：
    - `bankAccountId`
    - `paidBy`
    - `paidAt`
  - 發薪時會建立最小可用付款分錄：
    - 借：`2191 應付薪資`
    - 貸：`1113 銀行存款`
  - 可產生真正的伺服器 PDF 薪資單
  - 薪資設定更新、部門/員工建立更新、薪資批次建立/送審/批准/過帳/發薪皆會寫入 audit log
- `AuditLogService`
  - 新增共用 audit log service，已在 HR / Payroll 流程接上關鍵操作紀錄
- `RolesGuard`
  - 改為同時支援 `role.code` 與 `role.name` 比對，避免名稱/代碼不一致時失效

### 前端

- `attendanceService`
  - 不再使用 mock leave types
  - 改接真實 leave type / leave balance API
- `LeaveRequestPage`
  - 年度額度卡片改用真實資料
  - 請假表單可直接顯示假別支薪比例與剩餘額度
- `AttendanceAdminPage`
  - 已升級為整合工作台
  - 可查看每日出勤、假單審核、假別規則、年度額度
  - 可直接核准/駁回假單
  - 可建立/編輯假別規則
  - 可人工調整年度額度
- `PayrollPage`
  - 可建立草稿薪資批次
  - 可查看批次明細
  - 可送審與批准薪資批次
  - 狀態顯示已對齊 `draft / pending_approval / approved / posted / paid`
  - 已切成「薪資批次 / 我的薪資單」雙視角
  - 員工可直接查看個人已批准薪資單
  - 個人薪資單可直接 `列印 / 另存 PDF`
  - 個人薪資單可直接下載正式 PDF
  - 管理端可直接把已批准批次過帳至會計
  - 管理端可選銀行帳戶並標記已發薪
  - 管理端在薪資批次明細裡可直接查看流程紀錄
- `EmployeesPage`
  - 已接上真實員工/部門 CRUD API
  - 新增員工、編輯員工、新增部門不再打到未實作端點
  - 建立/更新失敗時會顯示後端錯誤訊息，不再只剩前端 500
- `SystemSettingsPage`
  - 已接上真實薪資規則 API
  - 可直接調整月薪換算工時、加班倍率、台灣勞保/健保比例、中國社保比例
  - 通知 / AI / 一般設定仍保留為介面預留區塊
- `AttendanceAdminPage`
  - 特休卡片與編輯彈窗已提示「可依年資自動計算額度」

## 這次的設計決策

- 不做額外的出勤編碼對應層
- `paidPercentage` 直接當成薪資扣款邏輯來源
- `maxDaysPerYear` 仍沿用，但換算成小時後作為年度額度
- `HIRE_ANNIVERSARY` 已能建立週期帳本
- 每個 `Entity` 對應一份 `PayrollPolicy`，先解決目前真正有在用的薪資常數，不額外做過度抽象
- 特休若未填固定天數，會依標準台灣年資級距自動計算；若有填固定天數，固定值優先
- 薪資批次暫時把 `approved` 視為「已批准且封存可發薪前狀態」，先不再拆獨立 lock 狀態
- `posted` 目前代表「已過帳到會計」，不等於銀行已實際撥薪
- `paid` 目前代表「已完成系統內發薪紀錄」，並已同步最小可用付款分錄

## 下一位 Agent 最應該先做的事

1. 補「自訂年資級距」後台 UI，而不只使用內建標準特休級距
2. 把 `paid` 後續流程接到真正銀行出款 / 對帳 / 匯款憑證管理
3. 規劃更細的薪資規則項目，例如公司負擔、扣繳與多階段加班倍率
4. 為假單頁或管理頁補 audit log 時間軸 UI
5. 規劃正式 PDF 樣板（公司 Logo、簽核欄位、固定版頭版尾）

## 已知限制

- `HIRE_ANNIVERSARY` 目前以 `periodStart` 年份作為 `LeaveBalance.year` 唯一鍵
- 特休目前內建標準台灣年資級距，但還沒有做成可視化編輯器
- 角色隔離目前先做到基本層級：
  - 假單審核 / 額度調整 / 假別管理：`SUPER_ADMIN`、`ADMIN`
  - 管理查詢：`SUPER_ADMIN`、`ADMIN`、`ACCOUNTANT`
  - 若之後要支援部門主管審核，還需要再補權限模型
- 年度額度調整目前是人工輸入，還沒有批次工具
- 前端管理頁尚未接匯出與審核備註
- `posted` 目前採最小可用分錄，只先用 `6111 / 2191`，尚未拆出勞健保、代扣稅等更細負債科目
- `paid` 目前採最小可用付款分錄，只先用 `2191 / 1113`，尚未對應到每個實際銀行帳戶的會計科目
- 個人薪資單已可下載伺服器產生的 PDF，但版型仍是第一版，尚未加上品牌樣式與正式簽核區塊
- 薪資規則目前已可配置「現有簡化邏輯」，但還沒支援複雜公式、級距與版本控管

## 建議接手順序

1. 先跑 migration
2. 驗證薪資規則設定頁是否能正確讀寫 `PayrollPolicy`
3. 驗證員工/部門建立與編輯流程
4. 驗證員工送假 -> 核准 -> 薪資計算是否能產生 `LEAVE_DEDUCTION`
5. 驗證薪資批次建立 -> 送審 -> 批准流程
6. 驗證員工端個人薪資單是否能正確只看到自己的資料
7. 驗證薪資過帳是否成功建立 JournalEntry
8. 驗證發薪後是否正確寫入 `paidAt / paidBy / bankAccountId`
9. 再補自訂年資級距、銀行出款對帳與更細的主管審核模型
