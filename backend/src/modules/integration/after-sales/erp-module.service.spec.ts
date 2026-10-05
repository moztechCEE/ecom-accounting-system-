import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EntityAccessService,
  UserDataAccessContext,
} from '../../../common/entity-access/entity-access.service';
import { AuthService } from '../../auth/auth.service';
import {
  hasSourceAdministrationPermissions,
  moduleGrants,
  serviceSignature,
  SOURCE_ADMIN_PERMISSIONS,
  SOURCE_MODULE_RESOURCES,
} from './erp-module.contract';
import { ErpAfterSalesModuleService } from './erp-module.service';

const ENTITY = 'synthetic-source-company';
const USER = 'synthetic-source-supervisor';
const SECRET = 'synthetic-offline-test-secret-32-characters';

describe('explicit after-sales supervisor actor authorization', () => {
  let permissions: string[];
  let roles: string[];
  let mustChangePassword: boolean;
  let employee: { isActive: boolean } | null;
  let access: UserDataAccessContext;
  let auth: { validateUser: jest.Mock };
  let entityAccess: { assertAccess: jest.Mock };
  let service: ErpAfterSalesModuleService;

  beforeEach(() => {
    permissions = [...SOURCE_ADMIN_PERMISSIONS];
    roles = ['DOA_DEV_QA_REVIEW'];
    mustChangePassword = false;
    employee = { isActive: true };
    access = {
      scope: 'ENTITY',
      entityId: ENTITY,
      employeeId: 'synthetic-employee',
      departmentId: null,
      noAccess: false,
      isSuperAdmin: false,
    };
    auth = {
      validateUser: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: USER,
          email: 'synthetic-supervisor@example.invalid',
          roles: roles.map((code) => ({ role: { code } })),
          effectivePermissions: permissions,
          mustChangePassword,
          employee,
        }),
      ),
    };
    entityAccess = {
      assertAccess: jest.fn().mockImplementation(() => Promise.resolve(access)),
    };
    service = new ErpAfterSalesModuleService(
      new ConfigService({
        AFTER_SALES_MODULE_ENABLED: 'true',
        AFTER_SALES_MODULE_ENTITY_ID: ENTITY,
        AFTER_SALES_MODULE_SECRET: SECRET,
      }),
      auth as unknown as AuthService,
      entityAccess as unknown as EntityAccessService,
    );
  });

  it('derives a source supervisor from all explicit grants without native ERP admin rights', async () => {
    const actor = await service.actor(USER, ENTITY);
    expect(actor.role).toBe('admin');
    expect(actor.modules).toEqual(Object.keys(SOURCE_MODULE_RESOURCES));
    expect(actor.writeModules).toEqual(
      Object.keys(SOURCE_MODULE_RESOURCES).filter(
        (module) => module !== 'audit_logs',
      ),
    );
    expect(roles).toEqual(['DOA_DEV_QA_REVIEW']);
    expect(permissions).toEqual([...SOURCE_ADMIN_PERMISSIONS]);
    expect(entityAccess.assertAccess).toHaveBeenCalledWith(
      USER,
      'sales',
      ENTITY,
    );
  });

  it.each(SOURCE_ADMIN_PERMISSIONS)(
    'does not derive admin when %s is absent',
    async (missing) => {
      permissions = permissions.filter((permission) => permission !== missing);
      const actor = await service.actor(USER, ENTITY);
      expect(actor.role).toBe('sales');
      expect(actor.modules).toEqual(moduleGrants(permissions, false).read);
      expect(actor.writeModules).toEqual(
        moduleGrants(permissions, false).write,
      );
    },
  );

  it('does not treat users/settings updates or wildcard grants as subsystem administration', async () => {
    permissions = [
      'after_sales_users:read',
      'after_sales_users:update',
      'after_sales_settings:read',
      'after_sales_settings:update',
      'after_sales:*',
      '*:*',
    ];
    expect((await service.actor(USER, ENTITY)).role).toBe('sales');
    expect(hasSourceAdministrationPermissions(permissions)).toBe(false);
    await expect(
      service.launch(
        USER,
        ENTITY,
        'cases',
        'https://aftersales-review---corely-erp-dev-sp5g377smq-de.a.run.app',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('preserves a read-only actor without write grants or supervisor role', async () => {
    permissions = SOURCE_ADMIN_PERMISSIONS.filter((permission) =>
      permission.endsWith(':read'),
    );
    const actor = await service.actor(USER, ENTITY);
    expect(actor.role).toBe('sales');
    expect(actor.modules).toEqual(Object.keys(SOURCE_MODULE_RESOURCES));
    expect(actor.writeModules).toEqual([]);
  });

  it.each([
    ['CUSTOMER_SERVICE', 'customer_service'],
    ['DOA_DEV_QA_CSR', 'customer_service'],
    ['ACCOUNTANT', 'accounting'],
    ['REPAIR_TECHNICIAN', 'technician'],
    ['MAILROOM_OPERATOR', 'warehouse'],
  ])(
    'preserves %s actor behavior with its limited module grants',
    async (code, expected) => {
      roles = [code];
      permissions = ['after_sales_cases:read'];
      const actor = await service.actor(USER, ENTITY);
      expect(actor.role).toBe(expected);
      expect(actor.modules).toEqual(['dashboard', 'cases', 'repairs']);
      expect(actor.writeModules).toEqual([]);
    },
  );

  it('retains the original native ERP administrator behavior', async () => {
    roles = ['ADMIN'];
    permissions = [];
    expect((await service.actor(USER, ENTITY)).role).toBe('admin');
    expect((await service.actor(USER, ENTITY)).modules).toEqual(
      Object.keys(SOURCE_MODULE_RESOURCES),
    );
  });

  it('checks live permissions again for signed source requests after a grant is revoked', async () => {
    expect((await service.actor(USER, ENTITY)).role).toBe('admin');
    permissions = ['after_sales_cases:read'];
    const time = String(Math.floor(Date.now() / 1000));
    const path = `/api/v1/after-sales/module/actors/${USER}?entityId=${ENTITY}`;
    const actor = await service.inspect(
      {
        method: 'GET',
        originalUrl: path,
        headers: {
          'x-erp-time': time,
          'x-erp-entity': ENTITY,
          'x-erp-actor': USER,
          'x-erp-signature': serviceSignature(
            SECRET,
            'GET',
            path,
            time,
            ENTITY,
            USER,
          ),
        },
      },
      USER,
      ENTITY,
    );
    expect(actor.role).toBe('sales');
    expect(actor.modules).toEqual(['dashboard', 'cases', 'repairs']);
    expect(actor.writeModules).toEqual([]);
    expect(auth.validateUser).toHaveBeenCalledTimes(2);
  });

  it.each(['SELF', 'DEPARTMENT'] as const)(
    'does not widen %s company scope for a supervisor',
    async (scope) => {
      access.scope = scope;
      await expect(service.actor(USER, ENTITY)).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  it('rejects another company before looking up an actor', async () => {
    await expect(service.actor(USER, 'different-company')).rejects.toThrow(
      ForbiddenException,
    );
    expect(auth.validateUser).not.toHaveBeenCalled();
    expect(entityAccess.assertAccess).not.toHaveBeenCalled();
  });

  it('preserves fresh company membership authorization', async () => {
    entityAccess.assertAccess.mockRejectedValueOnce(
      new ForbiddenException('membership revoked'),
    );
    await expect(service.actor(USER, ENTITY)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a user whose fresh authentication is inactive or revoked', async () => {
    auth.validateUser.mockRejectedValueOnce(new UnauthorizedException());
    await expect(service.actor(USER, ENTITY)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(entityAccess.assertAccess).not.toHaveBeenCalled();
  });

  it('rejects an inactive employee even with the full supervisor permission set', async () => {
    employee = { isActive: false };
    await expect(service.actor(USER, ENTITY)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a pending password change even with the full supervisor permission set', async () => {
    mustChangePassword = true;
    await expect(service.actor(USER, ENTITY)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
