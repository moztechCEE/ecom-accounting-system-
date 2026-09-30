import { UsersService } from './users.service';
import { UsersController } from './users.controller';

describe('Account management actor authorization', () => {
  const prisma = {
    userRole: { findFirst: jest.fn(), findMany: jest.fn() },
    role: { findMany: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: UsersService;
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.userRole.findFirst.mockResolvedValue(null);
    prisma.userRole.findMany.mockResolvedValue([]);
    prisma.role.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findUnique.mockResolvedValue({
      employee: null,
      entityMemberships: [{ entityId: 'company-1' }],
    });
    prisma.$transaction.mockImplementation(values => Promise.all(values));
    service = new UsersService(prisma as any, {} as any);
  });

  it('prevents ordinary access administrators granting themselves ADMIN', async () => {
    prisma.role.findMany.mockResolvedValue([{ code: 'ADMIN', name: 'ADMIN', permissions: [] }]);
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'actor', roleIds: ['admin'] })).rejects.toThrow('含敏感權限的角色');
  });

  it('prevents credential reset, role replacement and deactivation of administrator accounts', async () => {
    prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'ADMIN', name: 'ADMIN', permissions: [] } }]);
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'admin', data: { password: 'temporary-password' } })).rejects.toThrow('含敏感權限的帳號');
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'admin', roleIds: [] })).rejects.toThrow('含敏感權限的帳號');
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'admin' })).rejects.toThrow('含敏感權限的帳號');
  });

  it.each(['entityIds', 'accountingDataScope', 'bankingDataScope', 'payrollDataScope'])('restricts %s to the same SUPER_ADMIN policy as the UI', async field => {
    await expect(service.assertAccessManagementAllowed('actor', { data: { [field]: field === 'entityIds' ? [] : 'ENTITY' } })).rejects.toThrow('公司與資料範圍');
  });

  it('allows normal account changes and a super admin assigning ADMIN with company scopes', async () => {
    prisma.role.findMany.mockResolvedValue([{ code: 'EMPLOYEE', name: 'EMPLOYEE', permissions: [
      { permission: { resource: 'payroll_self', action: 'read' } },
    ] }]);
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'employee', data: { name: '員工' }, roleIds: ['employee'] })).resolves.toBeUndefined();
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'actor' });
    prisma.role.findMany.mockResolvedValue([{ code: 'ADMIN', name: 'ADMIN', permissions: [] }]);
    await expect(service.assertAccessManagementAllowed('actor', { data: { entityIds: ['company'], accountingDataScope: 'ENTITY' }, roleIds: ['admin'] })).resolves.toBeUndefined();
  });

  it('keeps SUPER_ADMIN assignment out of ordinary account management for everyone', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'actor' });
    prisma.role.findMany.mockResolvedValue([{ code: 'SUPER_ADMIN', name: 'SUPER_ADMIN', permissions: [] }]);
    await expect(service.assertAccessManagementAllowed('actor', { roleIds: ['super'] })).rejects.toThrow('最高管理員角色不在');
  });

  it('does not expose a hidden SUPER_ADMIN through the single-user read route', async () => {
    prisma.userRole.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: 'super' });
    await expect(service.assertUserVisibleToActor('account-admin', 'super')).rejects.toThrow('not found');
  });

  it('hides cross-company accounts from single-user reads and updates', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ employee: null, entityMemberships: [{ entityId: 'company-1' }] })
      .mockResolvedValueOnce({ employee: null, entityMemberships: [{ entityId: 'company-2' }] });
    await expect(service.assertUserVisibleToActor('actor', 'other-company')).rejects.toThrow('not found');

    prisma.user.findUnique
      .mockResolvedValueOnce({ employee: null, entityMemberships: [{ entityId: 'company-1' }] })
      .mockResolvedValueOnce({ employee: null, entityMemberships: [{ entityId: 'company-1' }, { entityId: 'company-2' }] });
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'mixed-company', data: { name: 'Changed' } }))
      .rejects.toThrow('not found');
    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
  });

  it('lets a multi-company manager maintain a target wholly within those companies', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ employee: null, entityMemberships: [
        { entityId: 'company-1' }, { entityId: 'company-2' },
      ] })
      .mockResolvedValueOnce({ employee: { entityId: 'company-2' }, entityMemberships: [
        { entityId: 'company-1' }, { entityId: 'company-2' },
      ] });
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'assigned', data: { name: 'Changed' } }))
      .resolves.toBeUndefined();
  });

  it('reserves accounts without a company for super administrators', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ employee: null, entityMemberships: [{ entityId: 'company-1' }] })
      .mockResolvedValueOnce({ employee: null, entityMemberships: [] });
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'unassigned', data: { name: 'Changed' } }))
      .rejects.toThrow('not found');
  });

  it('assigns the sole company to accounts created by an ordinary account manager', async () => {
    const dto = { name: 'Worker', email: 'worker@example.test', password: 'temporary-password', roleIds: [] };
    await expect(service.prepareManagedUserCreate('actor', dto))
      .resolves.toEqual({ ...dto, entityIds: ['company-1'] });
  });

  it('rejects account creation when an ordinary manager has zero or multiple companies', async () => {
    const dto = { name: 'Worker', email: 'worker@example.test', password: 'temporary-password' };
    prisma.user.findUnique.mockResolvedValueOnce({ employee: null, entityMemberships: [] });
    await expect(service.prepareManagedUserCreate('actor', dto)).rejects.toThrow('僅屬於一家公司');
    prisma.user.findUnique.mockResolvedValueOnce({ employee: null, entityMemberships: [
      { entityId: 'company-1' }, { entityId: 'company-2' },
    ] });
    await expect(service.prepareManagedUserCreate('actor', dto)).rejects.toThrow('僅屬於一家公司');
  });

  it('requires a super administrator to choose a company when creating an account', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'actor' });
    await expect(service.prepareManagedUserCreate('actor', {
      name: 'Worker', email: 'worker@example.test', password: 'temporary-password',
    })).rejects.toThrow('請先選擇新帳號可存取的公司');
  });

  it.each(['payroll_admin', 'employees_admin', 'reports', 'access_control', 'unreviewed_resource'])(
    'does not allow account maintainers to assign a role containing %s',
    async resource => {
      prisma.role.findMany.mockResolvedValue([{ code: 'CUSTOM', name: '自訂', permissions: [
        { permission: { resource, action: 'read' } },
      ] }]);
      await expect(service.assertAccessManagementAllowed('actor', { roleIds: ['custom'] }))
        .rejects.toThrow('含敏感權限的角色');
    },
  );

  it('does not allow an account maintainer to reset or deactivate an existing finance account', async () => {
    prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'ACCOUNTANT', name: '會計', permissions: [
      { permission: { resource: 'payroll_admin', action: 'read' } },
    ] } }]);
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'finance', data: { password: 'temporary-password' } }))
      .rejects.toThrow('含敏感權限的帳號');
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'finance' }))
      .rejects.toThrow('含敏感權限的帳號');
  });

  it('filters active users by role before pagination', async () => {
    await service.findAll(2, 10, { status: 'active', roleId: 'role-1' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10,
      take: 10,
      where: { AND: [
        { roles: { none: { role: { code: 'SUPER_ADMIN' } } } },
        { isActive: true },
        { roles: { some: { roleId: 'role-1' } } },
      ] },
    }));
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { AND: [
      { roles: { none: { role: { code: 'SUPER_ADMIN' } } } },
      { isActive: true },
      { roles: { some: { roleId: 'role-1' } } },
    ] } });
  });

  it('filters inactive users across employee and explicit company memberships', async () => {
    await service.findAll(1, 25, { status: 'inactive', entityId: 'company-1' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [
      { roles: { none: { role: { code: 'SUPER_ADMIN' } } } },
      { isActive: false },
      { OR: [
        { entityMemberships: { some: { entityId: 'company-1' } } },
        { employee: { is: { entityId: 'company-1' } } },
      ] },
    ] } }));
  });

  it('filters all account lists to fully manageable companies before pagination and count', async () => {
    await service.findAll(1, 25, { requesterId: 'actor', status: 'active' });
    const companyBoundary = { AND: [
      { OR: [
        { entityMemberships: { some: { entityId: { in: ['company-1'] } } } },
        { employee: { is: { entityId: { in: ['company-1'] } } } },
      ] },
      { entityMemberships: { none: { entityId: { notIn: ['company-1'] } } } },
      { OR: [
        { employee: { is: null } },
        { employee: { is: { entityId: { in: ['company-1'] } } } },
      ] },
    ] };
    const where = { AND: [
      { roles: { none: { role: { code: 'SUPER_ADMIN' } } } },
      companyBoundary,
      { isActive: true },
    ] };
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 0, take: 25 }));
    expect(prisma.user.count).toHaveBeenCalledWith({ where });
  });
});

describe('Account creation API company assignment', () => {
  it('passes the server-assigned company to the persistence method', async () => {
    const dto = { name: 'Worker', email: 'worker@example.test', password: 'temporary-password' };
    const checked = { ...dto, entityIds: ['company-1'] };
    const service = {
      prepareManagedUserCreate: jest.fn().mockResolvedValue(checked),
      createUser: jest.fn().mockResolvedValue({ id: 'new-user' }),
    };
    const controller = new UsersController(service as any);
    await expect(controller.createUser(dto, 'actor')).resolves.toEqual({ id: 'new-user' });
    expect(service.prepareManagedUserCreate).toHaveBeenCalledWith('actor', dto);
    expect(service.createUser).toHaveBeenCalledWith(checked);
  });
});
