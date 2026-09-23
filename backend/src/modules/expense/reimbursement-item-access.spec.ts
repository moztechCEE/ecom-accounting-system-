import { ExpenseRepository } from './expense.repository';
import { canUseReimbursementItem } from './reimbursement-item-access';

describe('Reimbursement item eligibility', () => {
  const restricted = { allowedRoles: ' EMPLOYEE,ACCOUNTANT ', allowedDepartments: ' dept-a,dept-b ' };
  it('requires an exact role and department match together', () => {
    expect(canUseReimbursementItem(restricted, { roles: ['EMPLOYEE'], departmentId: 'dept-a' })).toBe(true);
    expect(canUseReimbursementItem(restricted, { roles: ['SUPER_EMPLOYEE'], departmentId: 'dept-a' })).toBe(false);
    expect(canUseReimbursementItem(restricted, { roles: ['EMPLOYEE'], departmentId: 'dept' })).toBe(false);
    expect(canUseReimbursementItem({ allowedRoles: 'SUPER_ADMIN' }, { roles: ['ADMIN'] })).toBe(false);
  });
  it('denies department-restricted items when the employee has no department', () => {
    expect(canUseReimbursementItem(restricted, { roles: ['EMPLOYEE'] })).toBe(false);
    expect(canUseReimbursementItem(restricted, { departmentId: 'dept-a' })).toBe(false);
  });
  it('keeps null, empty and whitespace-only restrictions unrestricted', () => {
    for (const value of [null, '', ' ,  ']) {
      expect(canUseReimbursementItem({ allowedRoles: value, allowedDepartments: value })).toBe(true);
    }
  });
  it('uses exact matching for the discoverable item list, including missing departments', async () => {
    const items = [
      { id: 'public', allowedRoles: null, allowedDepartments: null },
      { id: 'correct', ...restricted },
      { id: 'prefix-role', allowedRoles: 'SUPER_EMPLOYEE', allowedDepartments: null },
      { id: 'other-dept', allowedRoles: 'EMPLOYEE', allowedDepartments: 'dept-ab' },
    ];
    const prisma = { reimbursementItem: { findMany: jest.fn(async () => items) } };
    const repo = new ExpenseRepository(prisma as never);
    expect((await repo.findActiveReimbursementItems('company', { roles: ['EMPLOYEE'], departmentId: 'dept-a' })).map((item) => item.id)).toEqual(['public', 'correct']);
    expect((await repo.findActiveReimbursementItems('company', { roles: ['EMPLOYEE'] })).map((item) => item.id)).toEqual(['public']);
    expect(prisma.reimbursementItem.findMany).toHaveBeenCalledWith({ where: { entityId: 'company', isActive: true }, orderBy: { name: 'asc' } });
  });
});
