import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

describe('payroll compensation boundary', () => {
  it('requires a compensation grant for all coworker payroll reads and writes', () => {
    for (const method of [
      PayrollController.prototype.getPayrollRuns,
      PayrollController.prototype.getEmployeeSalaryRows,
      PayrollController.prototype.getPayrollRun,
      PayrollController.prototype.getPayrolls,
      PayrollController.prototype.getPayroll,
      PayrollController.prototype.downloadPayrollRunPdf,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toContain('employee_compensation:read');
    }
    for (const method of [
      PayrollController.prototype.createPayrollRun,
      PayrollController.prototype.approvePayrollRun,
      PayrollController.prototype.payPayrollRun,
      PayrollController.prototype.createPayroll,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toContain('employee_compensation:update');
    }
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PayrollController.prototype.getEmployees))
      .toEqual(['employees_admin:read']);
  });

  it('rejects explicit salary and allowance writes before employee data access', async () => {
    const service = Object.create(PayrollService.prototype) as PayrollService;
    const hasPermission = jest.fn().mockResolvedValue(false);
    Object.defineProperty(service, 'usersService', { value: { hasPermission } });
    await expect(service.createEmployee('manager', {
      name: 'Employee', hireDate: '2026-09-24', salaryBaseOriginal: 0,
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateEmployee('employee-a', 'manager', {
      compensationSettings: { bonus: 500 },
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasPermission).toHaveBeenCalledWith('manager', 'employee_compensation', 'update');
  });
});
