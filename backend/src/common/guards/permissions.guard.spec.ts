import { PermissionsGuard } from './permissions.guard';

describe('Access management permission implications', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const prisma = { userRole: { findMany: jest.fn() } };
  const context = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => ({ user: { id: 'manager' } }) }) };
  const guard = new PermissionsGuard(reflector as any, prisma as any);
  beforeEach(() => {
    prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'ACCESS_MANAGER', permissions: [{ permission: { resource: 'access_control', action: 'update' } }] } }]);
  });
  it('allows a manager to read the role and user configuration required by editing', async () => {
    reflector.getAllAndOverride.mockReturnValue(['access_control:read']);
    await expect(guard.canActivate(context as any)).resolves.toBe(true);
  });
  it('does not imply unrelated read permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(['accounts:read']);
    await expect(guard.canActivate(context as any)).rejects.toThrow('accounts:read');
  });
  it('does not permit readonly access administrators to write', async () => {
    prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'READER', permissions: [{ permission: { resource: 'access_control', action: 'read' } }] } }]);
    reflector.getAllAndOverride.mockReturnValue(['access_control:update']);
    await expect(guard.canActivate(context as any)).rejects.toThrow('access_control:update');
  });
});
