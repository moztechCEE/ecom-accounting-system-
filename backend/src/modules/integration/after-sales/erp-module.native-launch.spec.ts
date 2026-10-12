import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../auth/auth.service';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';
import { ErpAfterSalesModuleService } from './erp-module.service';
import { serviceSignature } from './erp-module.contract';

const ENTITY = 'synthetic-native-company';
const USER = 'synthetic-native-csr';
const ORIGIN = 'https://corely-erp-dev-sp5g377smq-de.a.run.app';
const SOURCE =
  'https://corely-aftersales-module-dev-sp5g377smq-de.a.run.app/after-sales-app';
const SECRET = 'synthetic-native-launch-secret-32-characters';

describe('native after-sales contextual launch gates', () => {
  const originalFetch = global.fetch;
  let service: ErpAfterSalesModuleService;
  let actor: jest.SpyInstance;
  let fetch: jest.Mock;
  let modules: string[];
  let writeModules: string[];
  beforeEach(() => {
    modules = ['cases', 'repairs'];
    writeModules = ['cases', 'repairs'];
    service = new ErpAfterSalesModuleService(
      new ConfigService({
        AFTER_SALES_MODULE_ENABLED: 'true',
        AFTER_SALES_MODULE_ENTITY_ID: ENTITY,
        AFTER_SALES_MODULE_SECRET: SECRET,
        AFTER_SALES_TASK_SOURCE_URL: SOURCE,
      }),
      {} as AuthService,
      {} as EntityAccessService,
    );
    actor = jest.spyOn(service, 'actor').mockImplementation(() =>
      Promise.resolve({
        userId: USER,
        entityId: ENTITY,
        email: 'synthetic-csr@example.invalid',
        role: 'customer_service',
        modules,
        writeModules,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    fetch = jest.fn(() =>
      Promise.resolve(
        Response.json({
          contractVersion: 'corely.doa.tasks.v1',
          item: { id: 'synthetic-case', type: 'REPAIR' },
          actions: [{ id: 'open_source' }, { id: 'edit_source' }],
        }),
      ),
    );
    global.fetch = fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    actor.mockRestore();
  });

  it('resolves the exact Source case using one canonical signed path before issuing its contextual ticket', async () => {
    const result = await service.launch(
      USER,
      ENTITY,
      'repairs',
      ORIGIN,
      'synthetic-case',
      'edit',
    );
    const [url, request] = fetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(request.headers);
    expect(url).toBe(
      SOURCE + '/api/integration/erp/workbench/cases/synthetic-case',
    );
    expect(request.method).toBe('GET');
    expect(request.redirect).toBe('error');
    expect(headers.get('x-erp-signature')).toBe(
      serviceSignature(
        SECRET,
        'GET',
        '/api/integration/erp/workbench/cases/synthetic-case',
        headers.get('x-erp-time')!,
        ENTITY,
        USER,
      ),
    );
    const value = JSON.parse(
      Buffer.from(result.ticket.split('.')[0], 'base64url').toString('utf8'),
    ) as { path: string; userId: string; entityId: string };
    expect(value.path).toBe('/cases/synthetic-case/edit');
    expect(value.userId).toBe(USER);
    expect(value.entityId).toBe(ENTITY);
    expect(actor).toHaveBeenCalledTimes(2);
  });

  it('denies invalid context, missing section grant and read-only edit before contacting Source', async () => {
    await expect(
      service.launch(USER, ENTITY, 'repairs', ORIGIN, '../synthetic-case'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.launch(USER, ENTITY, 'invoices', ORIGIN, 'synthetic-case'),
    ).rejects.toThrow(ForbiddenException);
    modules = ['cases'];
    await expect(
      service.launch(USER, ENTITY, 'repairs', ORIGIN, 'synthetic-case'),
    ).rejects.toThrow(ForbiddenException);
    modules = ['cases', 'repairs'];
    writeModules = [];
    await expect(
      service.launch(USER, ENTITY, 'repairs', ORIGIN, 'synthetic-case', 'edit'),
    ).rejects.toThrow(ForbiddenException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing case',
      () => Response.json({ error: 'missing' }, { status: 404 }),
    ],
    [
      'wrong actual case',
      () =>
        Response.json({
          contractVersion: 'corely.doa.tasks.v1',
          item: { id: 'other-case', type: 'REPAIR' },
          actions: [{ id: 'edit_source' }],
        }),
    ],
    [
      'wrong contract',
      () =>
        Response.json({
          contractVersion: 'other.v1',
          item: { id: 'synthetic-case', type: 'REPAIR' },
          actions: [{ id: 'edit_source' }],
        }),
    ],
    [
      'missing Source write action',
      () =>
        Response.json({
          contractVersion: 'corely.doa.tasks.v1',
          item: { id: 'synthetic-case', type: 'REPAIR' },
          actions: [{ id: 'open_source' }],
        }),
    ],
  ])(
    'does not issue a contextual edit ticket for %s',
    async (_label, response) => {
      fetch.mockImplementation(() => Promise.resolve(response()));
      await expect(
        service.launch(
          USER,
          ENTITY,
          'repairs',
          ORIGIN,
          'synthetic-case',
          'edit',
        ),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('checks the actual repair grant even when the caller uses a generic cases section', async () => {
    modules = ['cases'];
    await expect(
      service.launch(USER, ENTITY, 'cases', ORIGIN, 'synthetic-case'),
    ).rejects.toThrow(ForbiddenException);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rechecks current actor membership before signing the contextual ticket', async () => {
    actor.mockResolvedValueOnce({
      userId: USER,
      entityId: ENTITY,
      email: 'synthetic-csr@example.invalid',
      role: 'customer_service',
      modules,
      writeModules,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    actor.mockRejectedValueOnce(new ForbiddenException('membership revoked'));
    await expect(
      service.launch(USER, ENTITY, 'repairs', ORIGIN, 'synthetic-case'),
    ).rejects.toThrow('membership revoked');
  });

  it('keeps the original fixed quote launch compatible without a contextual case read', async () => {
    const result = await service.launch(USER, ENTITY, 'quotes', ORIGIN);
    const value = JSON.parse(
      Buffer.from(result.ticket.split('.')[0], 'base64url').toString('utf8'),
    ) as { path: string };
    expect(value.path).toBe('/cases/repair-quotes');
    expect(fetch).not.toHaveBeenCalled();
  });
});
