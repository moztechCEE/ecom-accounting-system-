import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErpAfterSalesModuleService } from '../integration/after-sales/erp-module.service';
import { serviceSignature } from '../integration/after-sales/erp-module.contract';
import { MailroomService } from './mailroom.service';
import { AfterSalesTasksService } from './after-sales-tasks.service';

const USER = 'synthetic-csr';
const ENTITY = 'doa-dev-qa-20261002';
const SECRET = 'synthetic-native-source-shared-secret-32';
const CONTRACT = 'corely.doa.tasks.v1';
const handoffRow = (
  id: string,
  csrStatus: string,
  ownerId: string | null,
  status = 'WAITING_CUSTOMER',
) => ({
  id,
  entityId: ENTITY,
  status,
  productName: '合成測試產品',
  label: id,
  version: 2,
  receipt: { entityId: ENTITY, sourceCaseId: id },
  repairWorkflow: {
    schema: 1,
    csr: {
      status: csrStatus,
      sentToUserId: csrStatus === 'SENT' ? ownerId : null,
      ownerId: csrStatus === 'ACCEPTED' ? ownerId : null,
    },
  },
});
describe('native after-sales task authentication and ownership', () => {
  const originalFetch = global.fetch;
  let module: { actor: jest.Mock };
  let db: { mailroomItem: { findMany: jest.Mock } };
  let mailroom: { actor: jest.Mock };
  let transport: jest.Mock;
  let service: AfterSalesTasksService;
  let read: string[];
  let write: string[];
  beforeEach(() => {
    read = ['cases', 'repairs'];
    write = ['cases', 'repairs'];
    module = {
      actor: jest.fn(async () => ({
        userId: USER,
        entityId: ENTITY,
        modules: read,
        writeModules: write,
      })),
    };
    db = { mailroomItem: { findMany: jest.fn(async () => []) } };
    mailroom = {
      actor: jest.fn(async () => ({
        id: USER,
        name: '合成客服',
        entityIds: [ENTITY],
        permissions: new Set(['mailroom:review']),
      })),
    };
    transport = jest.fn(async () =>
      Response.json({
        contractVersion: CONTRACT,
        items: [],
        counts: { mine: 0, all: 0 },
      }),
    );
    global.fetch = transport;
    service = new AfterSalesTasksService(
      new ConfigService({
        ERP_DEV_SANDBOX: 'true',
        AFTER_SALES_MODULE_SECRET: SECRET,
        MAILROOM_ENABLED: 'true',
      }),
      module as unknown as ErpAfterSalesModuleService,
      db as unknown as PrismaService,
      mailroom as unknown as MailroomService,
    );
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('binds company actor, full module base path and exact search query in the signature', async () => {
    await service.list(USER, {
      entityId: ENTITY,
      scope: 'mine',
      search: 'MP 001',
    });
    const [url, options] = transport.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    const headers = new Headers(options.headers);
    expect(parsed.pathname).toBe(
      '/after-sales-app/api/integration/erp/workbench/cases',
    );
    expect(parsed.searchParams.get('search')).toBe('MP 001');
    expect(headers.get('x-erp-actor')).toBe(USER);
    expect(headers.get('x-erp-entity')).toBe(ENTITY);
    expect(headers.get('x-erp-signature')).toBe(
      serviceSignature(
        SECRET,
        'GET',
        parsed.pathname.slice('/after-sales-app'.length) + parsed.search,
        headers.get('x-erp-time')!,
        ENTITY,
        USER,
      ),
    );
    expect(options.redirect).toBe('error');
  });
  it('rejects missing read permission before contacting Source', async () => {
    read = [];
    await expect(service.options(USER, { entityId: ENTITY })).rejects.toThrow(
      ForbiddenException,
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects read-only registration before contacting Source', async () => {
    write = [];
    await expect(
      service.register(USER, {
        entityId: ENTITY,
        requestId: '322ae28e-c3fa-4d86-91ae-a04f225b13e2',
        brand: 'BONSON',
        customerKind: 'TO_C',
        payload: { type: 'REPAIR' },
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(transport).not.toHaveBeenCalled();
  });
  it('signs exact registration bytes with POST and removes browser entity from Source body', async () => {
    transport.mockImplementation(async () =>
      Response.json({
        contractVersion: CONTRACT,
        item: { id: 'synthetic-case', number: 'SYNTHETIC-1', type: 'REPAIR' },
      }),
    );
    await service.register(USER, {
      entityId: ENTITY,
      requestId: '322ae28e-c3fa-4d86-91ae-a04f225b13e2',
      brand: 'BONSON',
      customerKind: 'TO_B',
      payload: { type: 'REPAIR', contactName: '合成測試' },
    });
    const [url, options] = transport.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(options.headers);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string).entityId).toBeUndefined();
    expect(headers.get('x-erp-signature')).toBe(
      serviceSignature(
        SECRET,
        'POST',
        new URL(url).pathname.slice('/after-sales-app'.length),
        headers.get('x-erp-time')!,
        ENTITY,
        USER,
        options.body as string,
      ),
    );
  });
  it('rejects revoked permission after an asynchronous upstream read', async () => {
    transport.mockImplementation(async () => {
      read = [];
      return Response.json({ contractVersion: CONTRACT, items: [] });
    });
    await expect(service.options(USER, { entityId: ENTITY })).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('rejects a different case returned by Source', async () => {
    transport.mockImplementation(async () =>
      Response.json({
        contractVersion: CONTRACT,
        item: { id: 'another-case' },
      }),
    );
    await expect(
      service.detail(USER, ENTITY, 'synthetic-case'),
    ).rejects.toThrow(BadGatewayException);
  });
  it('derives ERP handoffs from current node and personal recipient, never another staff owner', async () => {
    const row = (id: string, status: string, ownerId: string | null) => ({
      id,
      entityId: ENTITY,
      status: 'WAITING_CUSTOMER',
      productName: '合成測試產品',
      label: id,
      version: 2,
      receipt: { entityId: ENTITY, sourceCaseId: id },
      repairWorkflow: {
        schema: 1,
        csr: {
          status,
          sentToUserId: status === 'SENT' ? ownerId : null,
          ownerId: status === 'ACCEPTED' ? ownerId : null,
        },
      },
    });
    db.mailroomItem.findMany.mockResolvedValue([
      row('own-case', 'ACCEPTED', USER),
      row('other-case', 'ACCEPTED', 'other-csr'),
      row('unassigned-case', 'SENT', null),
    ]);
    transport.mockImplementation(async () =>
      Response.json({
        contractVersion: CONTRACT,
        items: [{ id: 'own-case', number: 'SYNTHETIC-OWN', type: 'REPAIR' }],
        counts: { mine: 1, all: 1 },
      }),
    );
    const result = await service.list(USER, {
      entityId: ENTITY,
      scope: 'mine',
    });
    const url = new URL(transport.mock.calls[0][0] as string);
    expect(JSON.parse(url.searchParams.get('erpMineCaseIds')!)).toEqual([
      'own-case',
      'unassigned-case',
    ]);
    expect(
      (
        result.items[0].tasks as {
          actionable: boolean;
          owner: { erpUserId: string };
        }[]
      )[0].owner.erpUserId,
    ).toBe(USER);
    expect(db.mailroomItem.findMany.mock.calls[0][0].where.entityId).toBe(
      ENTITY,
    );
    expect(
      db.mailroomItem.findMany.mock.calls[0][0].where.receipt.entityId,
    ).toBe(ENTITY);
  });
  it.each([
    [
      'accepted by another CSR',
      handoffRow('own-case', 'ACCEPTED', 'other-csr'),
    ],
    ['reassigned to another CSR', handoffRow('own-case', 'SENT', 'other-csr')],
    [
      'resolved back to repair',
      handoffRow('own-case', 'ACCEPTED', USER, 'REPAIRING'),
    ],
  ])(
    'rejects the entire stale Source page when a handoff is %s during the RPC',
    async (_label, changed) => {
      const original = handoffRow('own-case', 'SENT', null);
      db.mailroomItem.findMany.mockResolvedValue([original]);
      transport.mockImplementation(() => {
        db.mailroomItem.findMany.mockResolvedValue([changed]);
        return Promise.resolve(
          Response.json({
            contractVersion: CONTRACT,
            total: 42,
            page: 2,
            pageSize: 1,
            counts: { mine: 42, all: 99 },
            items: [
              {
                id: 'own-case',
                number: 'SYNTHETIC-OWN',
                type: 'REPAIR',
                isMine: true,
                isActionable: true,
                assignmentSource: 'ERP_TASK',
                workflow: { nextAction: '處理維修交辦' },
              },
            ],
          }),
        );
      });
      const result = service.list(USER, {
        entityId: ENTITY,
        scope: 'mine',
        page: 2,
        pageSize: 1,
      });
      await expect(result).rejects.toMatchObject({
        status: 409,
        message: '交辦已更新，請重新整理案件清單',
      });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(db.mailroomItem.findMany).toHaveBeenCalledTimes(2);
      const url = new URL(transport.mock.calls[0][0] as string);
      expect(JSON.parse(url.searchParams.get('erpMineCaseIds')!)).toEqual([
        'own-case',
      ]);
      expect(url.searchParams.get('page')).toBe('2');
    },
  );
  it('rejects changed personal totals even when the newly assigned case is outside the returned page', async () => {
    const original = handoffRow('own-case', 'ACCEPTED', USER);
    db.mailroomItem.findMany.mockResolvedValue([original]);
    transport.mockImplementation(() => {
      db.mailroomItem.findMany.mockResolvedValue([
        original,
        handoffRow('new-other-page-case', 'SENT', USER),
      ]);
      return Promise.resolve(
        Response.json({
          contractVersion: CONTRACT,
          total: 1,
          counts: { mine: 1, all: 2 },
          items: [
            {
              id: 'own-case',
              number: 'SYNTHETIC-OWN',
              type: 'REPAIR',
              isMine: true,
              isActionable: true,
            },
          ],
        }),
      );
    });
    await expect(
      service.list(USER, { entityId: ENTITY, scope: 'mine', pageSize: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects another reassignment between the full authority check and the exact task read without retrying indefinitely', async () => {
    const original = handoffRow('own-case', 'ACCEPTED', USER);
    db.mailroomItem.findMany
      .mockResolvedValueOnce([original])
      .mockResolvedValueOnce([original])
      .mockResolvedValueOnce([handoffRow('own-case', 'ACCEPTED', 'other-csr')]);
    transport.mockResolvedValue(
      Response.json({
        contractVersion: CONTRACT,
        total: 1,
        counts: { mine: 1, all: 1 },
        items: [
          {
            id: 'own-case',
            number: 'SYNTHETIC-OWN',
            type: 'REPAIR',
            isMine: true,
            isActionable: true,
            assignmentSource: 'ERP_TASK',
          },
        ],
      }),
    );
    await expect(
      service.list(USER, { entityId: ENTITY, scope: 'mine' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.mailroomItem.findMany).toHaveBeenCalledTimes(3);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('compares the signed union as sets and preserves current tasks when query order changes', async () => {
    const first = handoffRow('z-case', 'ACCEPTED', USER),
      second = handoffRow('a-case', 'SENT', USER);
    db.mailroomItem.findMany
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([second, first])
      .mockResolvedValueOnce([first]);
    transport.mockResolvedValue(
      Response.json({
        contractVersion: CONTRACT,
        total: 2,
        counts: { mine: 2, all: 2 },
        items: [
          {
            id: 'z-case',
            number: 'SYNTHETIC-Z',
            type: 'REPAIR',
            isMine: true,
            isActionable: true,
            assignmentSource: 'ERP_TASK',
          },
        ],
      }),
    );
    const result = await service.list(USER, {
      entityId: ENTITY,
      scope: 'mine',
    });
    expect(result).toMatchObject({ total: 2, counts: { mine: 2, all: 2 } });
    expect(
      (result.items[0].tasks as { actionable: boolean }[])[0].actionable,
    ).toBe(true);
    const url = new URL(transport.mock.calls[0][0] as string);
    expect(JSON.parse(url.searchParams.get('erpMineCaseIds')!)).toEqual([
      'a-case',
      'z-case',
    ]);
  });
  it('preserves genuinely Source-owned personal cases without requiring an ERP handoff', async () => {
    transport.mockResolvedValue(
      Response.json({
        contractVersion: CONTRACT,
        total: 1,
        counts: { mine: 1, all: 1 },
        items: [
          {
            id: 'source-owned-case',
            number: 'SYNTHETIC-SOURCE',
            type: 'REPAIR',
            isMine: true,
            isActionable: true,
            assignmentSource: 'SOURCE_CASE',
          },
        ],
      }),
    );
    const result = await service.list(USER, {
      entityId: ENTITY,
      scope: 'mine',
    });
    expect(result).toMatchObject({ total: 1, counts: { mine: 1, all: 1 } });
    expect(result.items[0]).toMatchObject({
      isMine: true,
      isActionable: true,
      assignmentSource: 'SOURCE_CASE',
      tasks: [],
    });
  });
  it('does not falsely reject a Source-owned case beyond the bounded ERP union when the queue overflows', async () => {
    const initial = Array.from({ length: 101 }, (_, i) =>
      handoffRow('bounded-' + i.toString().padStart(3, '0'), 'ACCEPTED', USER),
    );
    db.mailroomItem.findMany
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce([initial[100]]);
    transport.mockResolvedValue(
      Response.json({
        contractVersion: CONTRACT,
        total: 1,
        counts: { mine: 1, all: 1 },
        items: [
          {
            id: initial[100].receipt.sourceCaseId,
            number: 'SYNTHETIC-SOURCE',
            type: 'REPAIR',
            isMine: true,
            isActionable: true,
            assignmentSource: 'SOURCE_CASE',
          },
        ],
      }),
    );
    const result = await service.list(USER, {
      entityId: ENTITY,
      scope: 'mine',
    });
    expect(result.items[0]).toMatchObject({
      isMine: true,
      assignmentSource: 'SOURCE_CASE',
    });
    expect(result.handoffs.repairQueueHasMore).toBe(true);
    expect(
      (result.items[0].tasks as { actionable: boolean }[])[0].actionable,
    ).toBe(true);
  });
});
