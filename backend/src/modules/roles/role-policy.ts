import { BadRequestException } from '@nestjs/common';

export const SYSTEM_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE', 'OPERATOR', 'CUSTOMER_SERVICE', 'WAREHOUSE_PICKER', 'WAREHOUSE_PACKER', 'WAREHOUSE_OPERATOR'];
export const PRIVILEGED_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN'];
export const isPrivilegedRole = (role: { code: string; name: string }) =>
  PRIVILEGED_ROLE_CODES.includes(role.code) || PRIVILEGED_ROLE_CODES.includes(role.name);

// Account maintainers can grant operational access. Financial, payroll,
// account-policy and newly introduced permissions require a policy administrator.
// Keep this list explicit so a future permission cannot become delegable by
// merely attaching it to a custom role.
const ACCOUNT_DELEGABLE_PERMISSIONS = new Set([
  'attendance_self:read',
  'leave_self:read',
  'profile_self:read',
  'expense_self:read',
  'expense_self:create',
  'payroll_self:read',
  'payroll_self_breakdown:read',
  'attendance_team:read',
  'attendance_team:review',
  'inventory:read',
  'inventory:update',
  'sales_orders:read',
  'sales_orders:create',
  'after_sales_cases:read',
  'wms_tasks:read',
  'wms_orders:create',
  'wms_picking:execute',
  'wms_packing:execute',
  'wms_shipping:execute',
  'wms_overview:read',
  'wms_logs:read',
  'wms_exceptions:read',
  'wms_scan_errors:read',
  'wms_defects:read',
]);

export type AccountAssignableRole = {
  code: string;
  name: string;
  permissions?: { permission?: { resource: string; action: string } | null }[];
};

export function isAccountAssignableRole(role: AccountAssignableRole): boolean {
  return !isPrivilegedRole(role) &&
    Array.isArray(role.permissions) &&
    role.permissions.every(({ permission }) =>
      Boolean(permission && ACCOUNT_DELEGABLE_PERMISSIONS.has(`${permission.resource}:${permission.action}`)),
    );
}

export function assertCustomRoleIdentity(code: string, name: string) {
  if (SYSTEM_ROLE_CODES.includes(code) || SYSTEM_ROLE_CODES.includes(name.trim().toUpperCase())) {
    throw new BadRequestException('系統角色代碼及名稱不可由自訂角色使用');
  }
}
