import { BadRequestException } from '@nestjs/common';

export const SYSTEM_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE', 'OPERATOR', 'CUSTOMER_SERVICE', 'WAREHOUSE_PICKER', 'WAREHOUSE_PACKER', 'WAREHOUSE_OPERATOR'];
export const PRIVILEGED_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN'];
export const isPrivilegedRole = (role: { code: string; name: string }) =>
  PRIVILEGED_ROLE_CODES.includes(role.code) || PRIVILEGED_ROLE_CODES.includes(role.name);

export function assertCustomRoleIdentity(code: string, name: string) {
  if (SYSTEM_ROLE_CODES.includes(code) || SYSTEM_ROLE_CODES.includes(name.trim().toUpperCase())) {
    throw new BadRequestException('系統角色代碼及名稱不可由自訂角色使用');
  }
}
