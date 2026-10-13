import { ForbiddenException } from '@nestjs/common';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { OperationLogsService } from './operation-logs.service';
import { IntegrationSettingsService } from './integration-settings.service';
const admin = {
  roles: [{ role: { code: 'SUPER_ADMIN' } }],
  effectivePermissions: [],
};
const access = {
  assertAccess: jest
    .fn()
    .mockResolvedValue({ isSuperAdmin: true, scope: 'ENTITY' }),
};
const auth = { validateUser: jest.fn().mockResolvedValue(admin) };
const source = { read: jest.fn() };
const audit = { create: jest.fn().mockResolvedValue({}) };
const interactions = { createMany: jest.fn(), findMany: jest.fn() };
const connections = {
  findUnique: jest.fn(),
  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
};
const db: any = {
  auditLog: audit,
  operationInteraction: interactions,
  integrationConnection: connections,
  operationLogArchive: { create: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(async (callback) => callback(db)),
};
describe('unified operation boundaries', () => {
  let service: OperationLogsService;
  beforeEach(() => {
    jest.clearAllMocks();
    auth.validateUser.mockResolvedValue(admin);
    access.assertAccess.mockResolvedValue({
      isSuperAdmin: true,
      scope: 'ENTITY',
    });
    service = new OperationLogsService(
      db,
      auth as any,
      access as any,
      source as any,
    );
  });
  it('checks company scope before any logs query', async () => {
    access.assertAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.list('actor', { entityId: 'foreign', source: 'ERP' }),
    ).rejects.toThrow(ForbiddenException);
    expect(db.auditLog.findMany).toBeUndefined();
  });
  it('keeps old source audit grant from widening into ERP logs', async () => {
    auth.validateUser.mockResolvedValue({
      roles: [],
      effectivePermissions: ['after_sales_audit:read'],
    } as any);
    access.assertAccess.mockResolvedValue({
      isSuperAdmin: false,
      scope: 'ENTITY',
    } as any);
    await expect(
      service.list('actor', { entityId: 'company', source: 'ERP' }),
    ).rejects.toThrow(ForbiddenException);
  });
  it('rejects forged actor and committed client result before writing', async () => {
    await expect(
      service.recordInteractions('actor', 'company', [{ actorId: 'foreign' }]),
    ).rejects.toThrow();
    expect(interactions.createMany).not.toHaveBeenCalled();
  });
  it('idempotent interactions retain server actor and company', async () => {
    const input = {
      id: 'e187ba12-9733-4d4c-a512-90e773f4d837',
      actionId: 'after_sales.create',
      workbench: 'AFTER_SALES',
      outcome: 'INTENT',
      occurredAt: new Date().toISOString(),
    };
    interactions.findMany.mockImplementation(
      async () => interactions.createMany.mock.calls.at(-1)![0].data,
    );
    await service.recordInteractions('actor', 'company', [input]);
    const row = interactions.createMany.mock.calls[0][0].data[0];
    expect(row.actorId).toBe('actor');
    expect(row.entityId).toBe('company');
    expect(interactions.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
  it('rejects conflicting UUID from another actor even when insert skipped', async () => {
    interactions.findMany.mockResolvedValue([
      {
        id: 'e187ba12-9733-4d4c-a512-90e773f4d837',
        actorId: 'foreign',
        entityId: 'company',
        requestHash: 'wrong',
      },
    ]);
    await expect(
      service.recordInteractions('actor', 'company', [
        {
          id: 'e187ba12-9733-4d4c-a512-90e773f4d837',
          actionId: 'after_sales.create',
          workbench: 'AFTER_SALES',
          outcome: 'INTENT',
          occurredAt: new Date().toISOString(),
        },
      ]),
    ).rejects.toThrow();
  });
  it('exports gzip with verified readback and never removes hot source', async () => {
    jest
      .spyOn(service, 'list')
      .mockResolvedValue({
        items: [
          {
            id: 'one',
            occurredAt: '2026-10-12',
            source: 'ERP',
            eventClass: 'BUSINESS',
            actorId: 'actor',
            actionId: 'CREATE',
            recordType: 'case',
            recordId: 'one',
            outcome: 'COMMITTED',
            changedFieldNames: [],
          },
        ],
        nextCursor: null,
        sources: ['ERP'],
        sourceStatus: 'AVAILABLE',
      } as any);
    db.operationLogArchive.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: 'archive',
    }));
    const archive = await service.archive('actor', {
      entityId: 'company',
      source: 'ERP',
      from: '2026-10-12',
      to: '2026-10-13',
    });
    expect(archive.manifest.readbackVerified).toBe(true);
    expect(archive.manifest.sourceRecordsRetained).toBe(true);
    expect(archive.manifest.rowCount).toBe(1);
    expect(audit.create).toHaveBeenCalled();
  });
  it('rejects crosscompany archive download before sending bytes', async () => {
    db.operationLogArchive.findUnique.mockResolvedValue({
      entityId: 'foreign',
    });
    await expect(
      service.download('actor', 'company', 'archive'),
    ).rejects.toThrow();
  });
  it('validates checksum before archive download', async () => {
    const content = gzipSync('one');
    db.operationLogArchive.findUnique.mockResolvedValue({
      entityId: 'company',
      content,
      manifest: { sha256: 'wrong' },
    });
    await expect(
      service.download('actor', 'company', 'archive'),
    ).rejects.toThrow('校驗');
    db.operationLogArchive.findUnique.mockResolvedValue({
      entityId: 'company',
      content,
      manifest: { sha256: createHash('sha256').update(content).digest('hex') },
    });
    expect(
      (await service.download('actor', 'company', 'archive')).content.equals(
        content,
      ),
    ).toBe(true);
  });
});
describe('explicit company and brand connector validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auth.validateUser.mockResolvedValue(admin);
    access.assertAccess.mockResolvedValue({
      isSuperAdmin: true,
      scope: 'ENTITY',
    });
  });
  it('does not call global ad probes for foreign company or brand', async () => {
    const meta = {
      getConnectionInfo: jest
        .fn()
        .mockReturnValue({
          configuredAccounts: [
            { accountId: '123', entityId: 'foreign', brand: 'BONSON' },
          ],
        }),
      previewInsights: jest.fn(),
    };
    connections.findUnique.mockResolvedValue({
      id: 'connection',
      entityId: 'company',
      provider: 'META',
      brand: 'MOZTECH',
      accountId: '123',
      category: 'ADS',
      version: 1,
      enabled: true,
    });
    const service = new IntegrationSettingsService(
      db,
      auth as any,
      access as any,
      { get: jest.fn() } as any,
      source as any,
      meta as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const result = await service.verify('actor', 'company', 'connection', 1);
    expect(result.code).toBe('RUNTIME_MAPPING_MISMATCH');
    expect(meta.previewInsights).not.toHaveBeenCalled();
  });
  it('saving metadata resets verification and does not call a provider', async () => {
    connections.findUnique.mockResolvedValue({
      id: 'connection',
      entityId: 'company',
    });
    const service = new IntegrationSettingsService(
      db,
      auth as any,
      access as any,
      {} as any,
      source as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await service.save('actor', {
      id: 'connection',
      entityId: 'company',
      category: 'LINE',
      provider: 'LINE',
      brand: 'MOZTECH',
      accountId: '123',
      displayName: 'LINE',
      environment: 'DEV',
      metadata: {},
      version: 1,
    });
    expect(
      connections.updateMany.mock.calls[0][0].data.verificationStatus,
    ).toBe('UNVERIFIED');
    expect(source.read).not.toHaveBeenCalled();
  });
});
