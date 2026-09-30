import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PerformanceService } from './performance.service';

const role = (code: string, actions: string[]) => ({
  role: {
    code,
    permissions: actions.map((action) => ({
      permission: { resource: 'performance_reviews', action },
    })),
  },
});

const employee = { id: 'reviewer', entityId: 'company', isActive: true };
const reviewerUser = {
  isActive: true,
  employee,
  entityMemberships: [{ entityId: 'company' }],
  roles: [role('PERFORMANCE_REVIEWER', ['read', 'write'])],
};
const hrUser = {
  ...reviewerUser,
  roles: [role('PERFORMANCE_HR', ['read', 'manage'])],
};
const review = {
  id: 'review',
  cycleId: 'cycle',
  subjectEmployeeId: 'subject',
  reviewerEmployeeId: 'reviewer',
  status: 'DRAFT',
  score: 4,
  goals: '目標',
  comment: '評語',
  submittedAt: null,
  cycle: { id: 'cycle', entityId: 'company' },
  subject: { id: 'subject', name: '員工', employeeNo: '001', department: { id: 'dept', name: '部門' } },
  reviewer: { id: 'reviewer', name: '主管', employeeNo: '002', department: { id: 'dept', name: '部門' } },
};

function setup(user: any = reviewerUser) {
  const prisma: any = {
    user: { findUnique: jest.fn(async () => user) },
    entity: { findUnique: jest.fn(async () => ({ id: 'company' })) },
    employee: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    performanceCycle: {
      findUnique: jest.fn(async () => ({ id: 'cycle', entityId: 'company' })),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({ id: 'cycle', ...data })),
    },
    performanceReview: {
      findUnique: jest.fn(async () => review),
      findUniqueOrThrow: jest.fn(async () => review),
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => review),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const audit: any = { record: jest.fn(async () => undefined) };
  return { service: new PerformanceService(prisma, audit), prisma, audit };
}

describe('Performance reviews are separate from salary records', () => {
  it('returns a direct-report roster using identity fields only', async () => {
    const { service, prisma } = setup();
    await service.getRoster('user', 'company');
    const query = prisma.employee.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ entityId: 'company', isActive: true, supervisorEmployeeId: 'reviewer' });
    expect(query.select).toMatchObject({ id: true, name: true, employeeNo: true });
    for (const secret of ['salaryBaseOriginal', 'salaryBaseBase', 'bankInfo', 'compensationSettings', 'nationalId']) {
      expect(JSON.stringify(query.select)).not.toContain(secret);
    }
  });

  it('only lists reviews assigned to the reviewer, not every department employee', async () => {
    const { service, prisma } = setup();
    await service.listReviews('user', 'cycle', 'company');
    const query = prisma.performanceReview.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ cycleId: 'cycle', reviewerEmployeeId: 'reviewer', cycle: { entityId: 'company' } });
    expect(JSON.stringify(query.select)).not.toMatch(/salary|bankInfo|compensationSettings/i);
  });

  it('denies an unassigned manager even when the review is in the same company', async () => {
    const { service, prisma } = setup();
    prisma.performanceReview.findUnique.mockResolvedValue({ ...review, reviewerEmployeeId: 'other-manager' });
    await expect(service.getReview('user', 'review')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateReview('user', 'review', { score: 3 })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.performanceReview.updateMany).not.toHaveBeenCalled();
  });

  it('denies cross-company creation even to an HR template', async () => {
    const { service, prisma } = setup(hrUser);
    await expect(service.createCycle('hr', {
      entityId: 'other-company', title: '2026 下半年', periodStart: '2026-07-01', periodEnd: '2026-12-31',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.performanceCycle.create).not.toHaveBeenCalled();
  });

  it('denies a reviewer trying to list another company', async () => {
    const { service, prisma } = setup();
    await expect(service.listReviews('user', undefined, 'other-company')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.performanceReview.findMany).not.toHaveBeenCalled();
  });

  it('snapshots the currently assigned direct supervisor when HR assigns a review', async () => {
    const { service, prisma } = setup(hrUser);
    prisma.user.findUnique.mockImplementation(async ({ where }: any) => where.id === 'reviewer-user' ? reviewerUser : hrUser);
    prisma.employee.findFirst
      .mockResolvedValueOnce({ id: 'subject', supervisorEmployeeId: 'reviewer' })
      .mockResolvedValueOnce({ id: 'reviewer', userId: 'reviewer-user' });
    await service.assignReview('hr', 'cycle', { subjectEmployeeId: 'subject' });
    expect(prisma.employee.findFirst.mock.calls[1][0].where).toMatchObject({
      id: 'reviewer', entityId: 'company', isActive: true, user: { isActive: true },
    });
    expect(prisma.performanceReview.create.mock.calls[0][0].data).toMatchObject({
      cycleId: 'cycle', subjectEmployeeId: 'subject', reviewerEmployeeId: 'reviewer',
    });
  });

  it('requires the selected reviewer to have the explicit appraisal role', async () => {
    const { service, prisma } = setup(hrUser);
    prisma.user.findUnique.mockImplementation(async ({ where }: any) => where.id === 'reviewer-user'
      ? { ...reviewerUser, roles: [role('EMPLOYEE', [])] }
      : hrUser);
    prisma.employee.findFirst
      .mockResolvedValueOnce({ id: 'subject', supervisorEmployeeId: 'reviewer' })
      .mockResolvedValueOnce({ id: 'reviewer', userId: 'reviewer-user' });
    await expect(service.assignReview('hr', 'cycle', { subjectEmployeeId: 'subject' }))
      .rejects.toThrow('主管考核職務範本');
    expect(prisma.performanceReview.create).not.toHaveBeenCalled();
  });

  it('keeps an assigned review immutable after submission', async () => {
    const { service, prisma } = setup();
    prisma.performanceReview.findUnique.mockResolvedValue({ ...review, status: 'SUBMITTED', submittedAt: new Date() });
    await expect(service.updateReview('user', 'review', { score: 3 })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.submitReview('user', 'review')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.performanceReview.updateMany).not.toHaveBeenCalled();
  });

  it('cannot submit without a score and written assessment', async () => {
    const { service, prisma } = setup();
    prisma.performanceReview.findUnique.mockResolvedValue({ ...review, score: null, comment: null });
    await expect(service.submitReview('user', 'review')).rejects.toThrow('評分與評語');
    expect(prisma.performanceReview.updateMany).not.toHaveBeenCalled();
  });

  it('uses a conditional update so a stale draft cannot overwrite a submitted review', async () => {
    const { service, prisma } = setup();
    prisma.performanceReview.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateReview('user', 'review', { comment: '新的評語' }))
      .rejects.toThrow('狀態已改變');
    expect(prisma.performanceReview.updateMany.mock.calls[0][0].where)
      .toMatchObject({ id: 'review', status: 'DRAFT', reviewerEmployeeId: 'reviewer' });
  });

  it('lets HR read all company reviews but not edit a manager assessment', async () => {
    const { service, prisma } = setup(hrUser);
    await service.listReviews('hr', undefined, 'company');
    expect(prisma.performanceReview.findMany.mock.calls[0][0].where.reviewerEmployeeId).toBeUndefined();
    prisma.performanceReview.findUnique.mockResolvedValue({ ...review, reviewerEmployeeId: 'other-manager' });
    await expect(service.updateReview('hr', 'review', { score: 3 })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
