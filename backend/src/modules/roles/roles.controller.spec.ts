import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesController } from './roles.controller';

describe('Role policy routes', () => {
  const controller = new RolesController({} as any);

  it.each(['create', 'update', 'remove', 'setPermissions'] as const)(
    'requires the SUPER_ADMIN guard for %s',
    async method => {
      const handler = controller[method];
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
      expect(guards).toContain(RolesGuard);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['SUPER_ADMIN']);

      const prisma = { userRole: { findMany: jest.fn().mockResolvedValue([
        { role: { code: 'ADMIN', name: 'ADMIN' } },
      ]) } };
      const guard = new RolesGuard(new Reflector(), prisma as any);
      const context = {
        getHandler: () => handler,
        getClass: () => RolesController,
        switchToHttp: () => ({ getRequest: () => ({ user: { id: 'account-admin' } }) }),
      } as any;
      await expect(guard.canActivate(context)).rejects.toThrow('required roles');
      prisma.userRole.findMany.mockResolvedValue([
        { role: { code: 'SUPER_ADMIN', name: 'SUPER_ADMIN' } },
      ]);
      await expect(guard.canActivate(context)).resolves.toBe(true);
    },
  );
});
