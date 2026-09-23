import { BadRequestException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

describe('Employee supervisor configuration', () => {
  const validate = (prisma: any, supervisor: string | null, employee = 'employee') =>
    (PayrollService.prototype as any).validateSupervisor.call({ prisma }, supervisor, 'company', employee);
  it('allows an explicit clear without inventing a replacement supervisor', async () => {
    const prisma = { employee: { findFirst: jest.fn() } };
    await validate(prisma, null);
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });
  it('rejects self-supervision before any write', async () => {
    await expect(validate({}, 'employee')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('requires same company, active employment and active login', async () => {
    const prisma = { employee: { findFirst: jest.fn(async () => null) } };
    await expect(validate(prisma, 'other-company')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.employee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'other-company', entityId: 'company', isActive: true, user: { isActive: true } } }));
  });
  it('rejects an indirect reporting cycle', async () => {
    const prisma = { employee: {
      findFirst: jest.fn(async () => ({ id: 'manager', supervisorEmployeeId: 'employee' })),
      findUnique: jest.fn(async () => ({ id: 'employee', supervisorEmployeeId: null })),
    } };
    await expect(validate(prisma, 'manager')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects a pre-existing cycle in the manager chain', async () => {
    const prisma = { employee: {
      findFirst: jest.fn(async () => ({ id: 'manager', supervisorEmployeeId: 'manager' })),
      findUnique: jest.fn(async () => ({ id: 'manager', supervisorEmployeeId: 'manager' })),
    } };
    await expect(validate(prisma, 'manager')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('accepts a valid independent manager', async () => {
    const prisma = { employee: { findFirst: jest.fn(async () => ({ id: 'manager', supervisorEmployeeId: null })) } };
    await expect(validate(prisma, 'manager')).resolves.toBeUndefined();
  });
});
