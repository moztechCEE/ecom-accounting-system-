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

### 後端邏輯

- `BalanceService`
  - 可依假別規則建立年度/到職週年額度帳本
  - 送出假單時預留 `pendingHours`
  - 假單狀態改變時同步 `pendingHours / usedHours`
- `LeaveService`
  - 送單時先驗證與保留額度
  - 新增查詢假別與個人額度
  - 狀態更新時回寫 reviewer 與額度
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
  - 將已核准請假轉為 `LEAVE_DEDUCTION`
  - 新增薪資批次明細查詢
  - 新增草稿 -> 待批准 -> 已批准狀態流
  - 建立批次時改用真實 `createdBy`
  - 送審/批准時同步 `ApprovalRequest`
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
  - 狀態顯示已對齊 `draft / pending_approval / approved / posted`

## 這次的設計決策

- 不做額外的出勤編碼對應層
- `paidPercentage` 直接當成薪資扣款邏輯來源
- `maxDaysPerYear` 仍沿用，但換算成小時後作為年度額度
- `HIRE_ANNIVERSARY` 已能建立週期帳本
- 特休年資級距尚未完成，現在先用固定 `maxDaysPerYear`
- 薪資批次暫時把 `approved` 視為「已批准且封存可發薪前狀態」，先不再拆獨立 lock 狀態

## 下一位 Agent 最應該先做的事

1. 把 PayrollService 裡寫死的保險/薪資邏輯抽成可配置規則
2. 為特休新增年資級距規則
3. 補員工薪資單與個人薪資查詢
4. 補假別/額度/薪資批次操作的 audit log
5. 規劃 `posted` 後續流程，接會計分錄與實際發薪

## 已知限制

- `HIRE_ANNIVERSARY` 目前以 `periodStart` 年份作為 `LeaveBalance.year` 唯一鍵
- 特休尚未做年資級距自動計算
- 角色隔離目前先做到基本層級：
  - 假單審核 / 額度調整 / 假別管理：`SUPER_ADMIN`、`ADMIN`
  - 管理查詢：`SUPER_ADMIN`、`ADMIN`、`ACCOUNTANT`
  - 若之後要支援部門主管審核，還需要再補權限模型
- 年度額度調整目前是人工輸入，還沒有批次工具
- 前端管理頁尚未接匯出與審核備註
- 薪資頁目前尚未做員工薪資單下載與發薪回寫

## 建議接手順序

1. 先跑 migration
2. 驗證員工送假 -> 核准 -> 薪資計算是否能產生 `LEAVE_DEDUCTION`
3. 驗證薪資批次建立 -> 送審 -> 批准流程
4. 再補員工薪資單、會計分錄與更細的主管審核模型
