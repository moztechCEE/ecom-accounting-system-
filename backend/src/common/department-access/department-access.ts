import { Prisma } from '@prisma/client';

const roleInclude = { include: { permissions: { include: { permission: true } } } } as const;
export const DEPARTMENT_ACCESS_SELECT = {
  id: true, name: true, entityId: true, departmentId: true, isActive: true,
  isDepartmentSupervisor: true,
  department: { include: { memberRole: roleInclude, supervisorRole: roleInclude } },
} as const satisfies Prisma.EmployeeSelect;

type EmployeeAccess = Prisma.EmployeeGetPayload<{ select: typeof DEPARTMENT_ACCESS_SELECT }>;
const PERSONAL = ['attendance_self:read', 'leave_self:read', 'profile_self:read', 'expense_self:read', 'expense_self:create'];
// Department assignment never grants account administration, finance, salary or
// system-wide audit access. Those remain explicit individual role assignments.
const OPERATIONAL_RESOURCES = new Set([
  'attendance_self','leave_self','profile_self','expense_self',
  'inventory','sales_orders','wms_tasks','wms_picking','wms_packing',
  'wms_orders','wms_overview','wms_exceptions','wms_scan_errors','wms_defects',
]);

export function departmentAccess(employee?: EmployeeAccess | null) {
  const department = employee?.department;
  if (!employee?.isActive || !department?.isActive || department.entityId !== employee.entityId || department.id !== employee.departmentId) {
    return { permissions: [] as string[], isSupervisor: false, roleNames: [] as string[] };
  }
  const isSupervisor = employee.isDepartmentSupervisor === true;
  const roles = [department.memberRole, ...(isSupervisor ? [department.supervisorRole] : [])]
    .filter(role => role && !['ADMIN','SUPER_ADMIN'].includes(role.code) && !['ADMIN','SUPER_ADMIN'].includes(role.name));
  const permissions = roles.flatMap(role => role!.permissions
    .filter(({ permission }) => OPERATIONAL_RESOURCES.has(permission.resource))
    .map(({ permission }) => `${permission.resource}:${permission.action}`));
  return {
    permissions: [...new Set([...PERSONAL, ...permissions, ...(isSupervisor ? ['attendance_team:read','attendance_team:review'] : [])])],
    isSupervisor, roleNames: roles.map(role => role!.name),
  };
}

export function effectivePermissionKeys(user: {
  roles?: { role: { permissions: { permission: { resource: string; action: string } }[] } }[];
  employee?: EmployeeAccess | null;
}) {
  const held = new Set([
    ...(user.roles || []).flatMap(({ role }) => role.permissions.map(({ permission }) => `${permission.resource}:${permission.action}`)),
    ...departmentAccess(user.employee).permissions,
  ]);
  if (held.has('access_control:update')) held.add('access_control:read');
  if (held.has('attendance_admin:read')) held.add('attendance_team:read');
  if (held.has('attendance_admin:update')) held.add('attendance_team:review');
  return [...held];
}
