import { RolesService } from './roles.service';
import { validate } from 'class-validator';
import { CreateRoleDto } from './dto/create-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { SetUserRolesDto } from '../users/dto/set-user-roles.dto';

describe('Role administration boundaries', () => {
  const prisma = {
    role: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    userRole: { count: jest.fn() },
    rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: RolesService;
  const employee = { id: 'employee', code: 'EMPLOYEE', name: 'EMPLOYEE', permissions: [{ permissionId: 'warehouse-expense-self-read' }] };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(callback => callback(prisma));
    service = new RolesService(prisma as any);
  });

  it.each(['ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT'])('rejects forged %s identity before writing', async code => {
    await expect(service.create({ code, name: 'Custom role' })).rejects.toThrow('系統角色');
    await expect(service.create({ code: 'CUSTOM_ROLE', name: code })).rejects.toThrow('系統角色');
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('does not allow changing an existing custom code to an administrator or privileged name', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'custom', code: 'CUSTOM', name: '一般角色' });
    await expect(service.update('custom', { code: 'ADMIN' })).rejects.toThrow('角色代碼');
    await expect(service.update('custom', { name: 'SUPER_ADMIN' })).rejects.toThrow('系統角色名稱');
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('protects administrator permission lists and system role deletion', async () => {
    prisma.role.findUnique.mockResolvedValue({ code: 'ADMIN', name: 'ADMIN' });
    await expect(service.setPermissions('admin', [])).rejects.toThrow('管理員');
    await expect(service.remove('admin')).rejects.toThrow('系統角色不可刪除');
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('copies only the template permission links into an independent role', async () => {
    prisma.role.findUnique.mockResolvedValue(employee);
    prisma.role.create.mockResolvedValue({ id: 'new' });
    await service.create({ code: 'TEAM_ASSISTANT', name: '團隊助理', templateRoleId: 'employee' });
    expect(prisma.role.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      code: 'TEAM_ASSISTANT', permissions: { create: [{ permissionId: 'warehouse-expense-self-read' }] },
    }) }));
  });

  it('does not delete custom roles still assigned to people', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'custom', code: 'CUSTOM', name: 'Custom' });
    prisma.userRole.count.mockResolvedValue(1);
    await expect(service.remove('custom')).rejects.toThrow('仍有人員使用');
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('accepts seeded warehouse string IDs and rejects empty IDs', async () => {
    for (const [dto, field, value] of [
      [new SetUserRolesDto(), 'roleIds', ['warehouse-picker']],
      [new SetRolePermissionsDto(), 'permissionIds', ['warehouse-expense-self-read']],
      [Object.assign(new CreateRoleDto(), { code: 'CUSTOM', name: 'Custom' }), 'templateRoleId', 'warehouse-picker'],
    ] as const) {
      Object.assign(dto, { [field]: value });
      expect(await validate(dto)).toHaveLength(0);
      Object.assign(dto, { [field]: Array.isArray(value) ? [''] : '' });
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
});
