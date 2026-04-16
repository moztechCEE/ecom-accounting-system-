# HR & Payroll Simplification Plan

## 核心原則
- 少即是多。
- 不再建立複雜的「出勤編碼 -> 休假項目 -> 薪資項目」多層對應。
- 以 `休假項目` 為單一規則來源，直接決定：
  - 是否需要年度額度
  - 額度用哪種週期重算
  - 是否扣薪
  - 扣薪比例

## 這次確立的簡化模型

### 1. 休假項目 = 規則
每個 `LeaveType` 直接持有：
- `balanceResetPolicy`
  - `CALENDAR_YEAR`
  - `HIRE_ANNIVERSARY`
  - `NONE`
- `maxDaysPerYear`
- `paidPercentage`
- `allowCarryOver`
- `carryOverLimitHours`

### 2. 年度額度帳本
每位員工每個假別都有自己的 `LeaveBalance`，而且會記錄：
- `periodStart`
- `periodEnd`
- `accruedHours`
- `usedHours`
- `pendingHours`
- `carryOverHours`
- `manualAdjustmentHours`

### 3. 請假流程
- 員工送出假單時，若該假別需要額度，系統先保留 `pendingHours`
- 假單核准後，`pendingHours -> usedHours`
- 假單駁回或取消後，釋放 `pendingHours`

### 4. 薪資流程
- 薪資計算讀取已核准假單
- 依 `paidPercentage` 計算扣薪
- 不再需要一層獨立的出勤編碼對應

## 第一階段範圍
- LeaveType 支援年度週期與結轉欄位
- LeaveBalance 支援週期起訖與人工調整
- LeaveService 支援送單保留額度 / 核准後扣額度
- PayrollService 支援把已核准假單轉成 `LEAVE_DEDUCTION`
- 員工請假頁改成讀真實假別與年度額度

## 第二階段
- 後台管理頁：假別設定、年度額度調整、主管審核
- 特休年資規則自動化
- 薪資項目配置化，而不是全部寫死在 PayrollService
- 薪資批准、封存、員工薪資單
- 權限矩陣：員工 / 主管 / 人資 / 財務

## 第三階段
- 公式引擎版本化
- 會計分錄自動化
- AI 異常檢查與待辦整理
- 電子勞動契約、批次匯入、銀行發薪串接
