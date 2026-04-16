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
- `AttendanceIntegrationService`
  - 回傳 `leaveEntries`
  - 回傳 `deductibleLeaveHours`
- `PayrollService`
  - 將已核准請假轉為 `LEAVE_DEDUCTION`

### 前端
- `attendanceService`
  - 不再使用 mock leave types
  - 改接真實 leave type / leave balance API
- `LeaveRequestPage`
  - 年度額度卡片改用真實資料
  - 請假表單可直接顯示假別支薪比例與剩餘額度

## 這次的設計決策
- 不做額外的出勤編碼對應層
- `paidPercentage` 直接當成薪資扣款邏輯來源
- `maxDaysPerYear` 仍沿用，但換算成小時後作為年度額度
- `HIRE_ANNIVERSARY` 已能建立週期帳本
- 特休年資級距尚未完成，現在先用固定 `maxDaysPerYear`

## 下一位 Agent 最應該先做的事
1. 補假別管理後台 UI
2. 補年度額度調整 UI
3. 補主管審核 UI 與權限
4. 把 PayrollService 裡寫死的保險/薪資邏輯抽成可配置規則
5. 為特休新增年資級距規則

## 已知限制
- `HIRE_ANNIVERSARY` 目前以 `periodStart` 年份作為 `LeaveBalance.year` 唯一鍵
- 特休尚未做年資級距自動計算
- 目前沒有 leave type admin CRUD UI
- `PATCH /attendance/leaves/:id/status` 已可用，但尚未加細緻 RBAC
- 前端請假頁目前仍是員工視角，主管審核頁還沒開始做

## 建議接手順序
1. 先跑 migration
2. 驗證員工送假 -> 核准 -> 薪資計算是否能產生 `LEAVE_DEDUCTION`
3. 再補主管審核與假別後台
4. 最後進入薪資計算週期與員工薪資單
