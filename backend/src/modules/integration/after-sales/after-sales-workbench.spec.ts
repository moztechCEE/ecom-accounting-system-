import {
  BadGatewayException,
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';
import { PERMISSIONS_KEY } from '../../../common/decorators/permissions.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { AfterSalesSourceGuard } from './after-sales-source.guard';
import { AfterSalesController } from './after-sales.controller';
import {
  projectWorkbenchDetail,
  projectWorkbenchList,
  WORKBENCH_CONTRACT,
} from './after-sales-workbench.projection';

const envelope = {
  mode: 'read_only',
  workbenchContractVersion: WORKBENCH_CONTRACT,
  checkedAt: '2026-09-04T00:00:00Z',
};
const list = () => ({
  ...envelope,
  items: [],
  page: { number: 1, pageSize: 25, totalCount: 0, hasMore: false },
  summary: { total: 0, active: 0, closed: 0, urgent: 0 },
});
const detail = () => ({
  ...envelope,
  item: {
    id: 'source-1',
    caseNumber: 'CASE-001',
    items: [],
    shipments: [],
    reverseShipments: [],
    paymentRecords: [],
    paymentRequests: [],
    paymentSubmissions: [],
    refundRecords: [],
    invoiceRecords: [],
    attachments: [],
    timeline: [],
    auditLog: [],
    notes: [],
    generatedFaqs: [],
  },
});

describe('After-sales workbench contract', () => {
  it('requires compatible read-only data and rejects broken counts', () => {
    expect(projectWorkbenchList(list()).page.totalCount).toBe(0);
    for (const invalid of [
      { ...list(), mode: 'write' },
      { ...list(), workbenchContractVersion: 'older' },
      { ...list(), checkedAt: 'invalid' },
      { ...list(), page: { number: 0, pageSize: 25, totalCount: 0 } },
      { ...list(), page: { number: 1, pageSize: 101, totalCount: 0 } },
      { ...list(), summary: {} },
    ])
      expect(() => projectWorkbenchList(invalid)).toThrow(BadGatewayException);
  });

  it('allowlists summaries and never passes source credentials or arbitrary JSON', () => {
    const result = projectWorkbenchList({
      ...list(),
      page: { ...list().page, totalCount: 1 },
      summary: { total: 1, active: 1, closed: 0, urgent: 0 },
      items: [
        {
          id: 'source-1',
          caseNumber: 'CASE-001',
          passwordHash: 'hidden',
          apiKey: 'hidden',
          metadata: { secret: 'hidden' },
          workflow: {
            stageLabel: '待出貨',
            helperText: 'unnecessary',
            token: 'hidden',
          },
        },
      ],
    });
    expect(result.items[0].workflow.stageLabel).toBe('待出貨');
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(JSON.stringify(result)).not.toContain('unnecessary');
  });

  it('requires every detail collection and matching case identity', () => {
    expect(() => projectWorkbenchDetail(detail(), 'another')).toThrow(
      BadGatewayException,
    );
    expect(() =>
      projectWorkbenchDetail(
        { ...detail(), item: { ...detail().item, invoiceRecords: undefined } },
        'source-1',
      ),
    ).toThrow(BadGatewayException);
    expect(
      projectWorkbenchDetail(detail(), 'source-1').sections.find(
        (section) => section.key === 'invoiceRecords',
      )?.records,
    ).toEqual([]);
  });

  it('preserves decimal strings, currency, false and zero without interpreting legacy stock disposition', () => {
    const result = projectWorkbenchDetail(
      {
        ...detail(),
        item: {
          ...detail().item,
          exchangeReturnDetail: {
            inventoryDisposition: 'NO_STOCK_IN',
            finalAmount: '0.00',
            includesShippingFee: false,
          },
          paymentRecords: [
            {
              id: 'p1',
              amount: '10.25',
              currency: 'USD',
              status: 'CONFIRMED',
              metadata: { secret: 'hidden' },
            },
          ],
          refundRecords: [{ id: 'r1', amount: 0, currency: 'TWD' }],
          attachments: [
            {
              id: 'a1',
              fileName: 'receipt.png',
              fileUrl: 'hidden',
              sizeBytes: 12,
            },
          ],
        },
      },
      'source-1',
    );
    const values = (key: string) =>
      Object.fromEntries(
        result.sections
          .find((section) => section.key === key)!
          .records[0].fields.map((f) => [f.key, f.value]),
      );
    expect(values('exchangeReturnDetail')).toMatchObject({
      inventoryDisposition: 'NO_STOCK_IN',
      finalAmount: '0.00',
      includesShippingFee: false,
    });
    expect(values('paymentRecords')).toMatchObject({
      amount: '10.25',
      currency: 'USD',
    });
    expect(values('refundRecords').amount).toBe(0);
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('requires explicit read permission and restricts raw export and migration to administrators', () => {
    const reflector = new Reflector();
    expect(reflector.get(PERMISSIONS_KEY, AfterSalesController)).toEqual([
      'after_sales_cases:read',
    ]);
    for (const method of [
      'listLegacyCases',
      'getLegacyCase',
      'previewMigration',
      'stageMigrationPage',
    ]) {
      expect(
        reflector.get(ROLES_KEY, AfterSalesController.prototype[method]),
      ).toEqual(['SUPER_ADMIN', 'ADMIN']);
    }
  });

  it('validates and transforms pagination at the HTTP boundary', async () => {
    const dto = Reflect.getMetadata(
      'design:paramtypes',
      AfterSalesController.prototype,
      'workbench',
    )[0];
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { entityId: 'tw', page: '2', pageSize: '25', type: 'REPAIR' },
        { type: 'query', metatype: dto },
      ),
    ).resolves.toMatchObject({ page: 2, pageSize: 25 });
    for (const invalid of [
      { pageSize: '101' },
      { view: 'unknown' },
      { search: 'a'.repeat(121) },
      { type: 'UNKNOWN' },
      { injected: true },
    ]) {
      await expect(
        pipe.transform(
          { entityId: 'tw', ...invalid },
          { type: 'query', metatype: dto },
        ),
      ).rejects.toThrow();
    }
  });
});

describe('AfterSalesSourceGuard', () => {
  const access = { assertAccess: jest.fn() };
  const guard = (binding = 'tw-entity-001') =>
    new AfterSalesSourceGuard(
      new ConfigService({ AFTER_SALES_LEGACY_ENTITY_ID: binding }),
      access as unknown as EntityAccessService,
    );
  const context = (query: unknown, body?: unknown) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'u1' }, query, body }),
      }),
    }) as ExecutionContext;
  beforeEach(() => {
    access.assertAccess
      .mockReset()
      .mockResolvedValue({ scope: 'ENTITY', isSuperAdmin: false });
  });

  it('fails closed without source-company binding or requested company', async () => {
    await expect(
      guard('').canActivate(context({ entityId: 'tw-entity-001' })),
    ).rejects.toThrow(ServiceUnavailableException);
    for (const entityId of [
      undefined,
      null,
      '',
      'cn-entity-001',
      ['tw-entity-001'],
    ])
      await expect(guard().canActivate(context({ entityId }))).rejects.toThrow(
        ForbiddenException,
      );
    await expect(
      guard().canActivate(
        context({ entityId: 'tw-entity-001' }, { entityId: 'cn-entity-001' }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(access.assertAccess).not.toHaveBeenCalled();
  });

  it('enforces company membership and never widens SELF or DEPARTMENT scope', async () => {
    for (const scope of ['SELF', 'DEPARTMENT']) {
      access.assertAccess.mockResolvedValueOnce({ scope, isSuperAdmin: false });
      await expect(
        guard().canActivate(context({ entityId: 'tw-entity-001' })),
      ).rejects.toThrow(ForbiddenException);
    }
    access.assertAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      guard().canActivate(context({ entityId: 'tw-entity-001' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard().canActivate(context({ entityId: 'tw-entity-001' })),
    ).resolves.toBe(true);
  });
});
