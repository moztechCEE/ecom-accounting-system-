import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpenseService } from './expense.service';

const makeUser = (id: string, code: string) => ({
  id, name: id, isActive: true, accountingDataScope: 'ENTITY',
  entityMemberships: [{ entityId: 'company' }],
  employee: { id: `employee-${id}`, entityId: 'company', isActive: true, departmentId: 'dept', supervisor: null },
  roles: [{ role: { code, permissions: [{ permission: { resource: 'expense_self', action: 'read' } }] } }],
});

describe('Explicit assignment of legacy expense approvals', () => {
  let actor: any, supervisor: any, applicant: any, request: any, prisma: any, service: ExpenseService;
  beforeEach(() => {
    actor = makeUser('admin', 'ADMIN'); supervisor = makeUser('boss', 'EMPLOYEE');
    applicant = { id: 'employee-staff', entityId: 'company', isActive: true, departmentId: 'dept', user: { isActive: true },
      supervisor: { id: 'employee-boss', entityId: 'company', isActive: true, user: { id: 'boss', name: '主管甲', isActive: true } } };
    request = { id: 'legacy', entityId: 'company', createdBy: 'staff', creator: { name: '申請人' },
      status: 'pending', updatedAt: new Date('2026-09-23T00:00:00.000Z'), amountOriginal: new Prisma.Decimal(100), approvalSteps: [],
      reimbursementItem: { entityId: 'company', approvalPolicy: { steps: [{ stepOrder: 1, approverRoleCode: 'ACCOUNTANT', requiresDepartmentHead: false, minAmount: null, maxAmount: null }] } },
    };
    prisma = {
      user: { findUnique: jest.fn(async ({ where }) => where.id === 'admin' ? actor : supervisor) },
      employee: { findUnique: jest.fn(async () => applicant) },
      expenseRequest: {
        findUnique: jest.fn(async () => request), findMany: jest.fn(async () => [request]),
        updateMany: jest.fn(async ({ data }) => { Object.assign(request, data); return { count: 1 }; }),
      },
      approvalStep: { createMany: jest.fn(async ({ data }) => { request.approvalSteps = data; return { count: data.length }; }) },
      expenseRequestHistory: { create: jest.fn() }, paymentTask: { create: jest.fn() },
      $transaction: jest.fn(async (run) => run(prisma)),
    };
    service = new ExpenseService({ findRequestById: jest.fn(async () => request) } as any, {} as any, {} as any, prisma, {} as any, {} as any);
  });
  it('previews the configured supervisor and preserves the additional policy without writing', async () => {
    const plan = await service.previewLegacyApprovalRoute('legacy', 'admin');
    expect(plan.supervisor).toMatchObject({ id: 'employee-boss', userId: 'boss', name: '主管甲' });
    expect(plan.steps).toEqual([{ order: 1, approverName: '主管甲', roleCode: null }, { order: 2, approverName: null, roleCode: 'ACCOUNTANT' }]);
    expect(plan.routeToken).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('requires an explicit admin action even for finance readers', async () => {
    actor.roles = makeUser('admin', 'ACCOUNTANT').roles;
    await expect(service.previewLegacyApprovalRoute('legacy', 'admin')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.approvalStep.createMany).not.toHaveBeenCalled();
  });
  it('does not bypass company access for an ADMIN', async () => {
    actor.entityMemberships = [{ entityId: 'other' }]; actor.employee.entityId = 'other';
    await expect(service.previewLegacyApprovalRoute('legacy', 'admin')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not reassign a request that already has approval steps', async () => {
    request.approvalSteps = [{ id: 'existing', status: 'pending', approverUserId: 'someone' }];
    await expect(service.previewLegacyApprovalRoute('legacy', 'admin')).rejects.toBeInstanceOf(ConflictException);
  });
  it('does not repair approved or rejected requests', async () => {
    request.status = 'approved';
    await expect(service.previewLegacyApprovalRoute('legacy', 'admin')).rejects.toBeInstanceOf(ConflictException);
  });
  it('blocks an inactive applicant and a supervisor without expense access', async () => {
    applicant.user.isActive = false;
    await expect(service.previewLegacyApprovalRoute('legacy', 'admin')).rejects.toBeInstanceOf(BadRequestException);
    applicant.user.isActive = true; supervisor.roles = [];
    await expect(service.previewLegacyApprovalRoute('legacy', 'admin')).rejects.toThrow('請管理員先設定主管權限後再送出');
  });
  it('creates a route once with an audit history while leaving approval and payment untouched', async () => {
    const plan = await service.previewLegacyApprovalRoute('legacy', 'admin');
    await service.assignLegacyApprovalRoute('legacy', 'admin', plan);
    expect(prisma.expenseRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'legacy', status: 'pending', updatedAt: new Date(plan.expectedUpdatedAt), approvalSteps: { none: {} } } }));
    expect(request.status).toBe('pending'); expect(request.approvalSteps).toHaveLength(2);
    expect(prisma.expenseRequestHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'approval_assigned', actorId: 'admin', toStatus: 'pending' }) }));
    expect(prisma.paymentTask.create).not.toHaveBeenCalled();
    await expect(service.assignLegacyApprovalRoute('legacy', 'admin', plan)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.approvalStep.createMany).toHaveBeenCalledTimes(1);
  });
  it('requires a new confirmation after the policy changes', async () => {
    const plan = await service.previewLegacyApprovalRoute('legacy', 'admin');
    request.reimbursementItem.approvalPolicy.steps[0].approverRoleCode = 'CFO';
    await expect(service.assignLegacyApprovalRoute('legacy', 'admin', plan)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.expenseRequest.updateMany).not.toHaveBeenCalled();
  });
  it('does not overwrite another admin action that wins the version claim', async () => {
    const plan = await service.previewLegacyApprovalRoute('legacy', 'admin');
    prisma.expenseRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.assignLegacyApprovalRoute('legacy', 'admin', plan)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.approvalStep.createMany).not.toHaveBeenCalled(); expect(prisma.expenseRequestHistory.create).not.toHaveBeenCalled();
  });
});
