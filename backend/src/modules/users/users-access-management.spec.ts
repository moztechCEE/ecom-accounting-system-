import { UsersService } from './users.service';

describe('Account management actor authorization', () => {
  const prisma = { userRole: { findFirst: jest.fn(), findMany: jest.fn() }, role: { findMany: jest.fn() } };
  let service: UsersService;
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.userRole.findFirst.mockResolvedValue(null);
    prisma.userRole.findMany.mockResolvedValue([]);
    prisma.role.findMany.mockResolvedValue([]);
    service = new UsersService(prisma as any, {} as any);
  });

  it('prevents ordinary access administrators granting themselves ADMIN', async () => {
    prisma.role.findMany.mockResolvedValue([{ code: 'ADMIN', name: 'ADMIN' }]);
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'actor', roleIds: ['admin'] })).rejects.toThrow('最高管理員指派');
  });

  it('prevents credential reset, role replacement and deactivation of administrator accounts', async () => {
    prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'ADMIN', name: 'ADMIN' } }]);
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'admin', data: { password: 'temporary-password' } })).rejects.toThrow('最高管理員調整');
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'admin', roleIds: [] })).rejects.toThrow('最高管理員調整');
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'admin' })).rejects.toThrow('最高管理員調整');
  });

  it.each(['entityIds', 'accountingDataScope', 'bankingDataScope', 'payrollDataScope'])('restricts %s to the same SUPER_ADMIN policy as the UI', async field => {
    await expect(service.assertAccessManagementAllowed('actor', { data: { [field]: field === 'entityIds' ? [] : 'ENTITY' } })).rejects.toThrow('公司與資料範圍');
  });

  it('allows normal account changes and a super admin assigning ADMIN with company scopes', async () => {
    await expect(service.assertAccessManagementAllowed('actor', { targetUserId: 'employee', data: { name: '員工' }, roleIds: ['employee'] })).resolves.toBeUndefined();
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'actor' });
    prisma.role.findMany.mockResolvedValue([{ code: 'ADMIN', name: 'ADMIN' }]);
    await expect(service.assertAccessManagementAllowed('actor', { data: { entityIds: ['company'], accountingDataScope: 'ENTITY' }, roleIds: ['admin'] })).resolves.toBeUndefined();
  });

  it('keeps SUPER_ADMIN assignment out of ordinary account management for everyone', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ userId: 'actor' });
    prisma.role.findMany.mockResolvedValue([{ code: 'SUPER_ADMIN', name: 'SUPER_ADMIN' }]);
    await expect(service.assertAccessManagementAllowed('actor', { roleIds: ['super'] })).rejects.toThrow('最高管理員角色不在');
  });
});
