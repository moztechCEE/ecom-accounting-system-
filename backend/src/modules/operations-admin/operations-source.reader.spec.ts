import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { OperationsSourceReader } from './operations-source.reader';
const SECRET = 'synthetic-offline-shared-settings-secret-32';
describe('scoped Source admin reader', () => {
  let actor: any;
  let authority: any;
  let fetchMock: jest.Mock;
  let original: typeof fetch;
  let service: OperationsSourceReader;
  beforeEach(() => {
    original = global.fetch;
    actor = { modules: ['settings', 'audit_logs'], writeModules: [] };
    authority = { actor: jest.fn(async () => actor) };
    fetchMock = jest.fn(
      async () =>
        new Response(
          JSON.stringify({ contractVersion: 'corely.doa.tasks.v1', items: [] }),
        ),
    );
    global.fetch = fetchMock;
    service = new OperationsSourceReader(
      new ConfigService({
        ERP_DEV_SANDBOX: 'true',
        AFTER_SALES_MODULE_SECRET: SECRET,
      }),
      authority,
    );
  });
  afterEach(() => {
    global.fetch = original;
  });
  it('reads settings with explicit settings grant without requiring cases grant', async () => {
    const result = await service.read('actor', 'company', 'integration-status');
    expect(result.items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
    expect(fetchMock.mock.calls[0][1].headers['x-erp-actor']).toBe('actor');
    expect(fetchMock.mock.calls[0][1].headers['x-erp-entity']).toBe('company');
  });
  it('cannot use a settings grant to read audits', async () => {
    actor.modules = ['settings'];
    await expect(
      service.read('actor', 'company', 'audit-logs'),
    ).rejects.toThrow(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refreshes Source actor permissions after upstream read', async () => {
    authority.actor
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce({ modules: [] });
    await expect(
      service.read('actor', 'company', 'audit-logs'),
    ).rejects.toThrow(ForbiddenException);
  });
  it('does not follow unexpected Source contract', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ contractVersion: 'other', items: [] })),
    );
    await expect(
      service.read('actor', 'company', 'audit-logs'),
    ).rejects.toThrow('版本');
  });
  it('bounds returned JSON to one megabyte', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(1048577)));
    await expect(
      service.read('actor', 'company', 'audit-logs'),
    ).rejects.toThrow('過大');
  });
  it('rejects credential bearing or arbitrary path Source URLs', async () => {
    for (const url of [
      'https://user:pass@source.example/after-sales-app',
      'https://source.example/arbitrary',
      'http://source.example/',
    ]) {
      service = new OperationsSourceReader(
        new ConfigService({
          AFTER_SALES_TASK_SOURCE_URL: url,
          AFTER_SALES_MODULE_SECRET: SECRET,
        }),
        authority,
      );
      await expect(
        service.read('actor', 'company', 'integration-status'),
      ).rejects.toThrow('設定不符');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
