export const RESOURCE_TRANSLATIONS: Record<string, string> = {
  accounts: '會計科目',
  journal_entries: '會計分錄',
  sales_orders: '銷售訂單',
  purchase_orders: '採購訂單',
  inventory: '庫存管理',
  banking: '銀行管理',
  reports: '報表中心',
  settings: '系統設定',
  users: '使用者管理',
  roles: '角色管理',
  permissions: '權限管理',
  attendance_self: '個人打卡與出勤',
  leave_self: '個人請假',
  payroll_self: '個人薪資單',
  payroll_self_breakdown: '個人薪資明細',
  profile_self: '個人資料',
  employees_admin: '員工與部門管理',
  attendance_admin: '考勤後臺',
  payroll_admin: '薪資管理',
  access_control: '帳號與權限',
}

export const ACTION_TRANSLATIONS: Record<string, string> = {
  create: '新增',
  read: '查看',
  update: '編輯',
  delete: '刪除',
  approve: '核准',
  export: '匯出',
  import: '匯入',
}

export const ROLE_TRANSLATIONS: Record<string, string> = {
  SUPER_ADMIN: '超級管理員',
  ADMIN: '系統管理員',
  ACCOUNTANT: '會計人員',
  OPERATOR: '一般操作員',
  VIEWER: '唯讀使用者',
  EMPLOYEE: '一般員工',
}

export const getResourceName = (resource: string): string => {
  return RESOURCE_TRANSLATIONS[resource] || resource
}

export const getActionName = (action: string): string => {
  return ACTION_TRANSLATIONS[action] || action
}

export const getRoleName = (role: string): string => {
  return ROLE_TRANSLATIONS[role] || role
}
