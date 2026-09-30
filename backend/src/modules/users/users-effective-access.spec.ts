import { UsersService } from './users.service';

describe('Server-derived effective access summary', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const service = new UsersService(prisma as any, {} as any);

  const user = (code: string) => ({
    id: 'user-1',
    email: 'worker@example.test',
    name: 'Worker',
    passwordHash: 'hidden',
    isActive: true,
    employee: null,
    employeeDataScope: 'SELF',
    attendanceDataScope: 'SELF',
    payrollDataScope: 'SELF',
    accountingDataScope: 'SELF',
    inventoryDataScope: 'ENTITY',
    salesDataScope: 'SELF',
    purchasingDataScope: 'SELF',
    bankingDataScope: 'SELF',
    entityMemberships: [{ entityId: 'company-1', isPrimary: true }],
    roles: [{ role: { code, name: code, permissions: [
      { permission: { resource: 'inventory', action: 'read' } },
    ] } }],
  });

  beforeEach(() => jest.resetAllMocks());

  it('identifies role permission source and configured company/data scopes', async () => {
    prisma.user.findUnique.mockResolvedValue(user('WAREHOUSE_OPERATOR'));
    const result = await service.findById('user-1') as any;
    expect(result.passwordHash).toBeUndefined();
    expect(result.effectiveAccess.permissionMode).toBe('listed');
    expect(result.effectiveAccess.companyMode).toBe('assigned');
    expect(result.effectiveAccess.companyIds).toEqual(['company-1']);
    expect(result.effectiveAccess.configuredScopes.inventory).toBe('ENTITY');
    expect(result.effectiveAccess.permissionSources).toContainEqual({
      permission: 'inventory:read',
      roles: [{ code: 'WAREHOUSE_OPERATOR', name: 'WAREHOUSE_OPERATOR' }],
      employeeAssignment: false,
      derivedFrom: null,
    });
  });

  it('reports ADMIN permission bypass without implying access to every company', async () => {
    prisma.user.findUnique.mockResolvedValue(user('ADMIN'));
    const result = await service.findById('user-1') as any;
    expect(result.effectiveAccess.permissionMode).toBe('all');
    expect(result.effectiveAccess.companyMode).toBe('assigned');
  });

  it('reports SUPER_ADMIN company access separately', async () => {
    prisma.user.findUnique.mockResolvedValue(user('SUPER_ADMIN'));
    const result = await service.findById('user-1') as any;
    expect(result.effectiveAccess.permissionMode).toBe('all');
    expect(result.effectiveAccess.companyMode).toBe('all');
    expect(result.effectiveAccess.companyIds).toBeNull();
  });
});
