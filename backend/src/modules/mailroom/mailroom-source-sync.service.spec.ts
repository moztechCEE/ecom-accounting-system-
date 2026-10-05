import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { type Actor } from './mailroom.contract';
import { MailroomSourceSyncService } from './mailroom-source-sync.service';
import {
  sourceSyncSummary,
  validateSourceChanges,
} from './mailroom-source.contract';

const event = (id = '1', fields: Record<string, unknown> = {}) => ({
  id,
  caseId: 'case-1',
  caseNumber: 'DEMO-R-001',
  caseType: 'REPAIR',
  change: 'UPDATED',
  occurredAt: '2026-10-06T00:00:00Z',
  sourceChannel: 'MOZTECH',
  ...fields,
});
describe('durable source cursor and authorized ERP notifications', () => {
  let service: MailroomSourceSyncService;
  let db: any;
  let sync: any;
  let mailroom: any;
  let notifications: any;
  let cursor: any;
  let changes: Map<string, any>;
  let receipts: any[];
  let storedNotices: any[];
  let inTransaction: boolean;
  let originalDev: string | undefined;
  const instance = 'https://after-sales.example.invalid';
  const company = 'company';
  const roles: Record<string, string[]> = {
    tech: ['repair_workbench:read'],
    clerk: ['mailroom:read'],
    csr: ['mailroom:review'],
    accounting: ['after_sales_accounting:read'],
    source: ['after_sales_cases:read'],
    self: ['after_sales_cases:read'],
    revoked: ['mailroom:read'],
    foreign: ['mailroom:read'],
  };
  beforeEach(() => {
    originalDev = process.env.ERP_DEV_SANDBOX;
    delete process.env.ERP_DEV_SANDBOX;
    cursor = {
      id: 'cursor',
      entityId: company,
      sourceInstance: instance,
      cursor: 0n,
      version: 1,
      leaseToken: null,
      leaseUntil: null,
    };
    changes = new Map();
    storedNotices = [];
    inTransaction = false;
    receipts = [
      {
        id: 'receipt',
        entityId: company,
        sourceCaseId: 'case-1',
        customerServiceUserId: 'csr',
        receivedById: 'clerk',
        sourceSnapshot: {
          version: 'old',
          customerLabel: 'private-customer',
          repairAllowed: false,
        },
        items: [
          {
            id: 'piece',
            status: 'INSPECTING',
            version: 5,
            repairOwnerId: 'tech',
            custodianId: 'tech',
            nextUserId: 'tech',
            repairInspection: { status: 'SUBMITTED' },
            repairWorkflow: { schema: 1 },
          },
        ],
      },
    ];
    db = {
      mailroomSourceCursor: {
        upsert: jest.fn(async () => structuredClone(cursor)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.leaseToken && cursor.leaseToken !== where.leaseToken)
            return { count: 0 };
          if (where.OR && cursor.leaseUntil && cursor.leaseUntil > new Date())
            return { count: 0 };
          cursor = { ...cursor, ...data };
          return { count: 1 };
        }),
        findUniqueOrThrow: jest.fn(async () => structuredClone(cursor)),
        update: jest.fn(async ({ data }: any) => {
          cursor = {
            ...cursor,
            ...data,
            version: cursor.version + data.version.increment,
          };
          return structuredClone(cursor);
        }),
      },
      mailroomSourceChange: {
        findMany: jest.fn(async ({ where }: any) =>
          [...changes.values()].filter((x) =>
            where.sourceEventId.in.includes(x.sourceEventId),
          ),
        ),
        createMany: jest.fn(async ({ data }: any) => {
          for (const row of data) changes.set(row.sourceEventId, row);
          return { count: data.length };
        }),
      },
      mailroomReceipt: {
        findMany: jest.fn(async ({ where }: any) =>
          structuredClone(
            receipts.filter(
              (r) =>
                r.entityId === where.entityId &&
                r.sourceCaseId === where.sourceCaseId,
            ),
          ),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = receipts.find((r) => r.id === where.id);
          Object.assign(row, data);
          return structuredClone(row);
        }),
      },
      user: {
        findMany: jest.fn(async () =>
          Object.keys(roles).map((id) => ({
            id,
            salesDataScope: ['source', 'accounting'].includes(id)
              ? 'ENTITY'
              : 'SELF',
          })),
        ),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (callback: any) => {
        const before = {
          cursor: structuredClone(cursor),
          changes: new Map(changes),
          receipts: structuredClone(receipts),
          notices: structuredClone(storedNotices),
        };
        inTransaction = true;
        try {
          return await callback(db);
        } catch (error) {
          cursor = before.cursor;
          changes = before.changes;
          receipts = before.receipts;
          storedNotices = before.notices;
          throw error;
        } finally {
          inTransaction = false;
        }
      }),
    };
    sync = {
      sourcePollingEnabled: jest.fn().mockReturnValue(true),
      sourceScopes: jest
        .fn()
        .mockReturnValue([{ entityId: company, sourceInstance: instance }]),
      registerSourceConsumer: jest.fn(),
      changes: jest.fn(async (_entity: string, current: string) => ({
        events: BigInt(current) < 1n ? [event()] : [],
        nextCursor: BigInt(current) < 1n ? '1' : current,
        hasMore: false,
      })),
      cases: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'case-1',
            number: 'DEMO-R-001',
            type: 'REPAIR',
            version: 'fresh',
            repairAllowed: true,
            items: [],
          },
        ],
      }),
    };
    mailroom = {
      actor: jest.fn(async (id: string): Promise<Actor> => {
        if (id === 'revoked') throw new ForbiddenException('已停用');
        return {
          id,
          name: id,
          permissions: new Set(roles[id]),
          entityIds: [id === 'foreign' ? 'other-company' : company],
        };
      }),
    };
    notifications = {
      createDeferred: jest.fn(async (_tx: any, data: any) => {
        expect(inTransaction).toBe(true);
        const notice = { id: `notice-${storedNotices.length}`, ...data };
        storedNotices.push(notice);
        return notice;
      }),
      publishPersisted: jest.fn(() => expect(inTransaction).toBe(false)),
    };
    service = new MailroomSourceSyncService(db, sync, mailroom, notifications);
  });
  afterEach(() => {
    if (originalDev === undefined) delete process.env.ERP_DEV_SANDBOX;
    else process.env.ERP_DEV_SANDBOX = originalDev;
  });

  it('atomically saves the cursor, change receipt and deduplicated authorized notifications then pushes only after commit; never advances physical work', async () => {
    const items = structuredClone(receipts[0].items);
    expect(await service.consume(company, instance)).toEqual({
      processed: 1,
      hasMore: false,
    });
    expect(cursor.cursor).toBe(1n);
    expect(cursor.leaseToken).toBeNull();
    expect([...changes.keys()]).toEqual(['1']);
    expect(storedNotices.map((n) => n.userId).sort()).toEqual([
      'accounting',
      'clerk',
      'csr',
      'source',
      'tech',
    ]);
    expect(receipts[0].items).toEqual(items);
    expect(receipts[0].sourceSnapshot).toMatchObject({
      version: 'fresh',
      sourceSync: { eventId: '1', availability: 'AVAILABLE' },
    });
    expect(JSON.stringify(storedNotices)).not.toContain('private-customer');
    expect(JSON.stringify(storedNotices)).not.toContain('repairAllowed');
    expect(notifications.publishPersisted).toHaveBeenCalledTimes(1);
    await service.consume(company, instance);
    expect(storedNotices).toHaveLength(5);
    expect(sync.changes).toHaveBeenLastCalledWith(company, '1');
  });

  it('coalesces multiple updates to one latest case notification and remembers every source event without depending on Number precision', async () => {
    const id = '9007199254740995';
    sync.changes.mockResolvedValue({
      events: [event('9007199254740994'), event(id)],
      nextCursor: id,
      hasMore: false,
    });
    await service.consume(company, instance);
    expect(cursor.cursor).toBe(9007199254740995n);
    expect(changes.size).toBe(2);
    expect(storedNotices).toHaveLength(5);
    expect(storedNotices[0].data.sourceEventId).toBe(id);
    expect(sync.cases).toHaveBeenCalledTimes(1);
  });

  it('bootstraps initial source cases with a projection and durable cursor but without old-case notifications', async () => {
    const items = structuredClone(receipts[0].items);
    sync.changes.mockResolvedValue({
      events: [event('1', { initial: true })],
      nextCursor: '1',
      hasMore: false,
    });
    await service.consume(company, instance);
    expect(cursor.cursor).toBe(1n);
    expect(changes.get('1').initial).toBe(true);
    expect(receipts[0].sourceSnapshot).toMatchObject({
      version: 'fresh',
      sourceSync: { initial: true, eventId: '1' },
    });
    expect(receipts[0].items).toEqual(items);
    expect(storedNotices).toHaveLength(0);
    expect(notifications.createDeferred).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'notifies only when the last source event for a case is not initial (lastInitial=%s)',
    async (lastInitial) => {
      sync.changes.mockResolvedValue({
        events: [
          event('1', { initial: !lastInitial }),
          event('2', { initial: lastInitial }),
        ],
        nextCursor: '2',
        hasMore: false,
      });
      await service.consume(company, instance);
      expect(changes.size).toBe(2);
      expect(storedNotices).toHaveLength(lastInitial ? 0 : 5);
      expect(receipts[0].sourceSnapshot.sourceSync.eventId).toBe('2');
    },
  );

  it('deduplicates a persisted source event even if an administrator deliberately replays an older cursor', async () => {
    await service.consume(company, instance);
    cursor.cursor = 0n;
    await service.consume(company, instance);
    expect(storedNotices).toHaveLength(5);
    expect(changes.size).toBe(1);
    expect(cursor.cursor).toBe(1n);
  });

  it('preserves custody, work sheets and the previous source projection on deletion, with an explicit unavailable marker', async () => {
    const physical = structuredClone(receipts[0].items);
    sync.changes.mockResolvedValue({
      events: [event('1', { change: 'DELETED' })],
      nextCursor: '1',
      hasMore: false,
    });
    await service.consume(company, instance);
    expect(sync.cases).not.toHaveBeenCalled();
    expect(receipts[0].items).toEqual(physical);
    expect(receipts[0].sourceSnapshot).toMatchObject({
      version: 'old',
      sourceSync: { availability: 'DELETED', change: 'DELETED' },
    });
    expect(storedNotices.every((n) => n.type === 'warning')).toBe(true);
    expect(JSON.stringify(storedNotices)).not.toContain('private-customer');
  });

  it('nonphysical case types are never mapped to RETURN or fetched through physical projection; company module scope is enforced', async () => {
    sync.changes.mockResolvedValue({
      events: [
        event('1', { caseId: 'purchase-case', caseType: 'PRIVATE_PURCHASE' }),
      ],
      nextCursor: '1',
      hasMore: false,
    });
    await service.consume(company, instance);
    expect(sync.cases).not.toHaveBeenCalled();
    expect(db.mailroomReceipt.update).not.toHaveBeenCalled();
    expect(storedNotices.map((n) => n.userId).sort()).toEqual([
      'accounting',
      'source',
    ]);
    expect(
      storedNotices.find((notice) => notice.userId === 'accounting').data
        .targetPath,
    ).toBe('/operations/after-sales/accounting?entityId=company');
    expect(
      storedNotices.find((notice) => notice.userId === 'source').data
        .targetPath,
    ).toBe('/operations/after-sales/cases?entityId=company');
  });

  it('an unreceived REPAIR points each current role to an authorized view, retaining company and source context without granting source access', async () => {
    receipts = [];
    const beforeRoles = structuredClone(roles);
    await service.consume(company, instance);
    const paths = new Map(
      storedNotices.map((notice) => [notice.userId, notice.data.targetPath]),
    );
    expect(paths.get('tech')).toBe('/operations/repair?entityId=company');
    expect(paths.get('clerk')).toBe('/operations/mailroom?entityId=company');
    expect(paths.get('source')).toBe(
      '/operations/after-sales/cases?entityId=company',
    );
    expect(paths.get('accounting')).toBe(
      '/operations/after-sales/accounting?entityId=company',
    );
    expect(paths.get('csr')).toBe('/my/inbox?entityId=company');
    expect(paths.has('self')).toBe(false);
    expect(paths.has('foreign')).toBe(false);
    expect(paths.has('revoked')).toBe(false);
    expect(
      storedNotices.every(
        (notice) =>
          notice.data.entityId === company &&
          notice.data.sourceCaseId === 'case-1',
      ),
    ).toBe(true);
    expect(roles).toEqual(beforeRoles);
    expect(cursor.cursor).toBe(1n);
    expect(changes.size).toBe(1);
    await service.consume(company, instance);
    expect(storedNotices).toHaveLength(5);
  });

  it('CSR and QA reviewer case readers need ENTITY scope; shipping and invoice readers get only their original authorized module', async () => {
    receipts = [];
    const permissions: Record<string, string[]> = {
      csr: ['after_sales_cases:read', 'mailroom:review'],
      reviewer: [
        'after_sales_cases:read',
        'mailroom:read',
        'repair_workbench:read',
      ],
      shipping: ['after_sales_shipping:read'],
      invoice: ['after_sales_invoices:read'],
      selfTech: ['after_sales_cases:read', 'repair_workbench:read'],
    };
    db.user.findMany.mockResolvedValue(
      Object.keys(permissions).map((id) => ({
        id,
        salesDataScope: id === 'selfTech' ? 'SELF' : 'ENTITY',
      })),
    );
    mailroom.actor.mockImplementation(async (id: string) => ({
      id,
      name: id,
      entityIds: [company],
      permissions: new Set(permissions[id]),
    }));
    await service.consume(company, instance);
    const paths = new Map(
      storedNotices.map((notice) => [notice.userId, notice.data.targetPath]),
    );
    expect(paths.get('csr')).toBe(
      '/operations/after-sales/cases?entityId=company',
    );
    expect(paths.get('reviewer')).toBe(
      '/operations/after-sales/cases?entityId=company',
    );
    expect(paths.get('shipping')).toBe(
      '/operations/after-sales/shipping?entityId=company',
    );
    expect(paths.get('invoice')).toBe(
      '/operations/after-sales/invoices?entityId=company',
    );
    expect(paths.get('selfTech')).toBe('/operations/repair?entityId=company');
  });

  it('native physical items retain their Inbox path for all recipients rather than opening an unassigned source module', async () => {
    await service.consume(company, instance);
    expect(
      storedNotices.every(
        (notice) =>
          notice.data.targetPath === '/my/inbox?itemId=piece&entityId=company',
      ),
    ).toBe(true);
    expect(receipts[0].items[0].custodianId).toBe('tech');
  });

  it('a source or mismatched projection failure leaves the cursor and all notifications untouched, releases the lease and retries later', async () => {
    sync.cases.mockRejectedValueOnce(
      new BadGatewayException({
        message: 'temporarily unavailable',
        upstreamStatus: 503,
      }),
    );
    await expect(service.consume(company, instance)).rejects.toThrow();
    expect(cursor.cursor).toBe(0n);
    expect(cursor.leaseToken).toBeNull();
    expect(changes.size).toBe(0);
    expect(storedNotices).toHaveLength(0);
    sync.cases.mockResolvedValueOnce({ items: [{ id: 'other-case' }] });
    await expect(service.consume(company, instance)).rejects.toThrow(
      '識別不符',
    );
    expect(cursor.cursor).toBe(0n);
    await service.consume(company, instance);
    expect(cursor.cursor).toBe(1n);
  });

  it('handles a fresh source 404 after an earlier UPDATED event without blocking the later deletion or pretending the item disappeared', async () => {
    sync.cases.mockRejectedValueOnce(
      new BadGatewayException({
        message: 'source not found',
        upstreamStatus: 404,
      }),
    );
    await service.consume(company, instance);
    expect(receipts[0].sourceSnapshot.sourceSync.availability).toBe(
      'NOT_FOUND',
    );
    expect(receipts[0].items[0].custodianId).toBe('tech');
    expect(cursor.cursor).toBe(1n);
  });

  it('rolls back notifications and cursor together if persistence fails and never publishes a rolled back notification', async () => {
    db.mailroomSourceChange.createMany.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(service.consume(company, instance)).rejects.toThrow();
    expect(cursor.cursor).toBe(0n);
    expect(storedNotices).toHaveLength(0);
    expect(notifications.publishPersisted).not.toHaveBeenCalled();
    expect(receipts[0].sourceSnapshot.version).toBe('old');
  });

  it('a competing or expired lease cannot advance the cursor or publish notifications from stale network results', async () => {
    cursor.leaseToken = 'other-worker';
    cursor.leaseUntil = new Date(Date.now() + 100000);
    await service.consume(company, instance);
    expect(sync.changes).not.toHaveBeenCalled();
    cursor.leaseUntil = new Date(0);
    sync.cases.mockImplementationOnce(async () => {
      cursor.leaseToken = 'new-worker';
      return { items: [{ id: 'case-1', type: 'REPAIR', items: [] }] };
    });
    await expect(service.consume(company, instance)).rejects.toThrow('租約');
    expect(cursor.leaseToken).toBe('new-worker');
    expect(cursor.cursor).toBe(0n);
    expect(storedNotices).toHaveLength(0);
  });

  it('is opt-in, fixed-company and fixed-origin in DEV and unregisters its callback during shutdown', async () => {
    service.onModuleInit();
    expect(sync.registerSourceConsumer).toHaveBeenCalledWith(
      expect.any(Function),
    );
    service.onModuleDestroy();
    expect(sync.registerSourceConsumer).toHaveBeenLastCalledWith(undefined);
    sync.sourcePollingEnabled.mockReturnValue(false);
    await service.consume(company, instance);
    expect(db.mailroomSourceCursor.upsert).not.toHaveBeenCalled();
    sync.sourcePollingEnabled.mockReturnValue(true);
    process.env.ERP_DEV_SANDBOX = 'true';
    await service.consume(company, instance);
    expect(db.mailroomSourceCursor.upsert).not.toHaveBeenCalled();
  });
});

describe('source feed decimal/order contract', () => {
  it.each([
    { events: [event('1'), event('1')], nextCursor: '1', hasMore: false },
    { events: [event('2'), event('1')], nextCursor: '2', hasMore: false },
    { events: [event('1')], nextCursor: '0', hasMore: false },
    { events: [], nextCursor: '0', hasMore: true },
    {
      events: [event('9223372036854775808')],
      nextCursor: '9223372036854775808',
      hasMore: false,
    },
    {
      events: [event('1', { caseType: 'OTHER' })],
      nextCursor: '1',
      hasMore: false,
    },
    {
      events: [event('1', { occurredAt: 'not-a-date' })],
      nextCursor: '1',
      hasMore: false,
    },
    {
      events: [event('1', { initial: 'true' })],
      nextCursor: '1',
      hasMore: false,
    },
  ])(
    'rejects invalid, duplicate or backward events without rounding IDs',
    (value) => {
      expect(() => validateSourceChanges(value, '0')).toThrow();
    },
  );
  it('accepts gaps from source-side channel filtering, including a scanned empty page', () => {
    expect(
      validateSourceChanges(
        { events: [], nextCursor: '15', hasMore: false },
        '0',
      ).nextCursor,
    ).toBe('15');
  });
  it('defaults old source events to noninitial and discards uncontracted data', () => {
    const page = validateSourceChanges(
      {
        events: [
          event('1', { customerPhone: 'private', payment: { amount: 999 } }),
        ],
        nextCursor: '1',
        hasMore: false,
      },
      '0',
    );
    expect(page.events[0].initial).toBe(false);
    expect(page.events[0]).not.toHaveProperty('customerPhone');
    expect(page.events[0]).not.toHaveProperty('payment');
  });
  it('only exposes a bounded source sync delivery marker to mailroom logistics readers', () => {
    expect(
      sourceSyncSummary({
        customerLabel: 'private',
        sourceSync: {
          eventId: '1',
          occurredAt: '2026-10-06T00:00:00Z',
          change: 'UPDATED',
          availability: 'AVAILABLE',
          sourceChannel: 'MOZTECH',
          sourceInstance: 'https://private.example.invalid',
          customerPhone: 'private',
          initial: true,
        },
      }),
    ).toEqual({
      eventId: '1',
      occurredAt: '2026-10-06T00:00:00Z',
      change: 'UPDATED',
      availability: 'AVAILABLE',
      sourceChannel: 'MOZTECH',
      initial: true,
    });
    expect(sourceSyncSummary({ sourceSync: { eventId: 'bad' } })).toBeNull();
  });
});
