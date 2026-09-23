import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpenseService } from './expense.service';

const D = (n: number) => new Prisma.Decimal(n);
const role = (code: string) => ({ role: { code, permissions: [{ permission: { resource: 'expense_self', action: 'read' } }, { permission: { resource: 'expense_self', action: 'create' } }] } });
const makeActor = (id = 'manager', entityId = 'company') => ({ id, isActive: true, accountingDataScope: 'SELF',
  roles: [role('EMPLOYEE')], entityMemberships: [{ entityId }],
  employee: { id: `employee-${id}`, entityId, isActive: true, departmentId: 'dept', supervisor: null },
});
const makeRequest = () => ({ id: 'request', entityId: 'company', createdBy: 'staff', status: 'pending', paymentStatus: 'pending',
  description: '交通費', amountOriginal: D(100), amountCurrency: 'TWD', amountFxRate: D(1), amountBase: D(100), finalAccountId: null,
  approvalSteps: [{ id: 'step', status: 'pending', stepOrder: 1, approverUserId: 'manager', approverRoleCode: null }],
});

describe('Expense supervisor workflow authorization and payment consistency', () => {
  let request: any;
  let actor: any;
  let prisma: any;
  let service: ExpenseService;
  let repo: any;
  beforeEach(() => {
    request = makeRequest(); actor = makeActor();
    prisma = {
      user: { findUnique: jest.fn(async ({ where }) => where.id === 'boss' ? makeActor('boss') : actor) },
      expenseRequest: {
        findUnique: jest.fn(async () => request),
        findMany: jest.fn(async () => [request]),
        update: jest.fn(async ({ data }) => Object.assign(request, data)),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      approvalStep: { updateMany: jest.fn(async ({ where, data }) => {
        const step = request.approvalSteps.find((s: any) => s.id === where.id && s.status === 'pending');
        if (!step) return { count: 0 };
        Object.assign(step, data); return { count: 1 };
      }) },
      expenseRequestHistory: { create: jest.fn() },
      paymentTask: { create: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
      account: { findFirst: jest.fn() },
      bankAccount: { findFirst: jest.fn(async () => ({ id: 'bank', entityId: 'company', isActive: true, bankName: '付款行', accountNo: '1234567', currency: 'TWD', metaJson: { bankVisibleUserIds: ['manager'] } })) },
      $transaction: jest.fn(async (run) => run(prisma)),
    };
    repo = { findRequestById: jest.fn(async () => request), getReimbursementItemDetail: jest.fn(), createExpenseRequestGraph: jest.fn(async (input) => input) };
    service = new ExpenseService(repo, { suggestAccount: jest.fn(async () => ({ confidence: 0, features: {} })) } as any,
      { create: jest.fn() } as any, prisma, {} as any, { assertAccess: jest.fn(async () => ({ scope: 'ENTITY', isSuperAdmin: false })) } as any);
  });
  it.each(['unrelated', 'staff'])('rejects %s even with a known request id', async (id) => {
    actor = makeActor(id);
    await expect(service.approveExpenseRequest('request', { id }, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.paymentTask.create).not.toHaveBeenCalled();
  });
  it('rejects a supervisor who moved to another company', async () => {
    actor = makeActor('manager', 'other');
    await expect(service.approveExpenseRequest('request', { id: 'manager' }, { approvalStepId: 'step' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows only the snapshotted supervisor and creates one payment task after final approval', async () => {
    actor.employee.supervisorEmployeeId = 'changed-reporting-line';
    await service.approveExpenseRequest('request', { id: 'manager' }, { approvalStepId: 'step' });
    expect(request.status).toBe('approved');
    expect(prisma.paymentTask.create).toHaveBeenCalledTimes(1);
    expect(prisma.paymentTask.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expenseRequestId: 'request', amountOriginal: D(100) }) }));
    await expect(service.approveExpenseRequest('request', { id: 'manager' }, { approvalStepId: 'step' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.paymentTask.create).toHaveBeenCalledTimes(1);
  });
  it('keeps a configured second approval pending and does not create a payable early', async () => {
    request.approvalSteps.push({ id: 'second', status: 'pending', stepOrder: 2, approverUserId: 'accountant' });
    await service.approveExpenseRequest('request', { id: 'manager' }, { approvalStepId: 'step' });
    expect(request.status).toBe('pending'); expect(prisma.paymentTask.create).not.toHaveBeenCalled();
  });
  it('rejects a replay for an old step even when the same supervisor owns the next step', async () => {
    request.approvalSteps.push({ id: 'second', status: 'pending', stepOrder: 2, approverUserId: 'manager' });
    await service.approveExpenseRequest('request', { id: 'manager' }, { approvalStepId: 'step' });
    await expect(service.approveExpenseRequest('request', { id: 'manager' }, { approvalStepId: 'step' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.paymentTask.create).not.toHaveBeenCalled();
  });
  it('denies API access when the expense interface permission was removed', async () => {
    actor.roles = [{ role: { code: 'STAFF', permissions: [] } }];
    await expect(service.listAccessibleRequests('manager')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('keeps read-only expense access from creating a request', async () => {
    actor.roles = [{ role: { code: 'READER', permissions: [{ permission: { resource: 'expense_self', action: 'read' } }] } }];
    await expect(service.submitIntelligentExpenseRequest({ entityId: 'company', description: '交通', amountOriginal: 100 }, { id: 'manager' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.createExpenseRequestGraph).not.toHaveBeenCalled();
  });
  it('does not guess an approver for legacy pending requests without assigned steps', async () => {
    request.approvalSteps = [];
    await expect(service.approveExpenseRequest('request', { id: 'manager' }, { approvalStepId: 'step' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects competing decisions after another request claims the same step', async () => {
    prisma.approvalStep.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approveExpenseRequest('request', { id: 'manager' }, { approvalStepId: 'step' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.expenseRequest.update).not.toHaveBeenCalled(); expect(prisma.paymentTask.create).not.toHaveBeenCalled();
  });
  it('rejects without creating a payable', async () => {
    await service.rejectExpenseRequest('request', { id: 'manager' }, { reason: '缺憑證', approvalStepId: 'step' });
    expect(request.status).toBe('rejected'); expect(prisma.paymentTask.create).not.toHaveBeenCalled();
  });
  it('does not allow a supervisor to nominate an accounting account', async () => {
    await expect(service.approveExpenseRequest('request', { id: 'manager' }, { finalAccountId: 'account', approvalStepId: 'step' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks submission without a configured supervisor before AI classification', async () => {
    await expect(service.submitIntelligentExpenseRequest({ entityId: 'company', description: '交通', amountOriginal: 100 }, { id: 'manager' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createExpenseRequestGraph).not.toHaveBeenCalled();
  });
  it('blocks submission when an active supervisor cannot access the expense interface', async () => {
    actor.employee.supervisor = { id: 'employee-boss', entityId: 'company', isActive: true, user: { id: 'boss', isActive: true } };
    prisma.user.findUnique.mockImplementation(async ({ where }) => where.id === 'boss' ? { ...makeActor('boss'), roles: [] } : actor);
    await expect(service.submitIntelligentExpenseRequest({ entityId: 'company', description: '交通', amountOriginal: 100 }, { id: 'manager' })).rejects.toThrow('請管理員先設定主管權限後再送出');
    expect(repo.createExpenseRequestGraph).not.toHaveBeenCalled();
    expect(prisma.paymentTask.create).not.toHaveBeenCalled();
  });
  it('snapshots the supervisor and employee department instead of trusting the submitted department', async () => {
    actor.employee.supervisor = { id: 'employee-boss', entityId: 'company', isActive: true, user: { id: 'boss', isActive: true } };
    const result: any = await service.submitIntelligentExpenseRequest({ entityId: 'company', description: '交通', amountOriginal: 100, departmentId: 'forged-dept' }, { id: 'manager' });
    expect(result.requestData.departmentId).toBe('dept');
    expect(result.approvalSteps[0]).toEqual(expect.objectContaining({ approverUserId: 'boss', status: 'pending' }));
  });
  it.each([
    { allowedRoles: 'ACCOUNTANT', allowedDepartments: null },
    { allowedRoles: 'SUPER_EMPLOYEE', allowedDepartments: null },
    { allowedRoles: 'EMPLOYEE', allowedDepartments: 'restricted-dept' },
  ])('rejects a directly supplied restricted item id: %j', async (restrictions) => {
    actor.employee.supervisor = { id: 'employee-boss', entityId: 'company', isActive: true, user: { id: 'boss', isActive: true } };
    repo.getReimbursementItemDetail.mockResolvedValue({ id: 'item', entityId: 'company', isActive: true, ...restrictions });
    await expect(service.submitIntelligentExpenseRequest({ entityId: 'company', reimbursementItemId: 'item', description: '交通', amountOriginal: 100, departmentId: 'restricted-dept' }, { id: 'manager', roleCodes: ['ACCOUNTANT'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.createExpenseRequestGraph).not.toHaveBeenCalled();
  });
  it('does not let a missing employee department bypass a restricted item', async () => {
    actor.employee.departmentId = null;
    actor.employee.supervisor = { id: 'employee-boss', entityId: 'company', isActive: true, user: { id: 'boss', isActive: true } };
    repo.getReimbursementItemDetail.mockResolvedValue({ id: 'item', entityId: 'company', isActive: true, allowedDepartments: 'restricted-dept' });
    await expect(service.submitIntelligentExpenseRequest({ entityId: 'company', reimbursementItemId: 'item', description: '交通', amountOriginal: 100, departmentId: 'restricted-dept' }, { id: 'manager' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.createExpenseRequestGraph).not.toHaveBeenCalled();
  });
  it('accepts an eligible restricted item using authoritative employee role and department', async () => {
    actor.employee.supervisor = { id: 'employee-boss', entityId: 'company', isActive: true, user: { id: 'boss', isActive: true } };
    repo.getReimbursementItemDetail.mockResolvedValue({ id: 'item', entityId: 'company', isActive: true, allowedRoles: ' EMPLOYEE,ACCOUNTANT ', allowedDepartments: ' dept,other ', defaultTaxType: 'TAX_FREE' });
    await service.submitIntelligentExpenseRequest({ entityId: 'company', reimbursementItemId: 'item', description: '交通', amountOriginal: 100 }, { id: 'manager' });
    expect(repo.createExpenseRequestGraph).toHaveBeenCalledTimes(1);
  });
  it('keeps staff lists scoped to self and assigned requests within permitted companies', async () => {
    await service.listAccessibleRequests('manager');
    expect(prisma.expenseRequest.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ entityId: { in: ['company'] }, OR: expect.arrayContaining([{ createdBy: 'manager' }]) }));
    await expect(service.listAccessibleRequests('manager', 'other')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires treasury permission for payment records', async () => {
    request.status = 'approved';
    await expect(service.updatePaymentInfo('request', { paymentStatus: 'paid', amount: 100, bankAccountId: 'bank', paymentDate: new Date() }, { id: 'manager' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('records actual payment once and synchronizes expense, task, bank details and history in one transaction', async () => {
    request.status = 'approved'; actor.roles = [role('ADMIN')];
    const paymentDate = new Date('2026-09-23T03:00:00Z');
    await service.updatePaymentInfo('request', { paymentStatus: 'paid', amount: 100, bankAccountId: 'bank', paymentDate }, { id: 'manager' });
    expect(prisma.expenseRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'approved' }), data: expect.objectContaining({ status: 'paid', paymentAccountLast5: '34567' }) }));
    expect(prisma.paymentTask.updateMany).toHaveBeenCalledWith({ where: { expenseRequestId: 'request', status: 'pending' }, data: { status: 'paid', paidDate: paymentDate } });
    expect(prisma.expenseRequestHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'payment_recorded', metadata: expect.objectContaining({ amount: 100, paymentDate: paymentDate.toISOString() }) }) }));
  });
  it('rejects a guessed bank account id outside the bank ACL even for ADMIN', async () => {
    request.status = 'approved'; actor.roles = [role('ADMIN')];
    prisma.bankAccount.findFirst.mockResolvedValue({ currency: 'TWD', metaJson: { bankVisibleUserIds: ['someone-else'] } });
    await expect(service.updatePaymentInfo('request', { paymentStatus: 'paid', amount: 100, bankAccountId: 'bank', paymentDate: new Date() }, { id: 'manager' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects a different-currency account instead of pretending an exchange took place', async () => {
    request.status = 'approved'; actor.roles = [role('ADMIN')];
    prisma.bankAccount.findFirst.mockResolvedValue({ currency: 'USD', metaJson: { allowedUserIds: ['manager'] } });
    await expect(service.updatePaymentInfo('request', { paymentStatus: 'paid', amount: 100, bankAccountId: 'bank', paymentDate: new Date() }, { id: 'manager' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([99, 101])('rejects altered payment amount %i', async (amount) => {
    request.status = 'approved'; actor.roles = [role('ADMIN')];
    await expect(service.updatePaymentInfo('request', { paymentStatus: 'paid', amount, bankAccountId: 'bank', paymentDate: new Date() }, { id: 'manager' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects already paid expenses before updating payment tasks', async () => {
    request.status = 'approved'; actor.roles = [role('ADMIN')]; prisma.expenseRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updatePaymentInfo('request', { paymentStatus: 'paid', amount: 100, bankAccountId: 'bank', paymentDate: new Date() }, { id: 'manager' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.paymentTask.updateMany).not.toHaveBeenCalled();
  });
});
