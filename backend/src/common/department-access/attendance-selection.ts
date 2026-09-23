import { Prisma } from '@prisma/client';
export const ATTENDANCE_EMPLOYEE_SELECT = {
  id: true, entityId: true, userId: true, employeeNo: true, name: true,
  departmentId: true, isActive: true, attendanceType: true, hireDate: true, terminateDate: true,
  department: { select: { id: true, name: true } },
} as const satisfies Prisma.EmployeeSelect;
