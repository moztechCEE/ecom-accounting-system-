/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { MailroomIntakeService } from './mailroom-intake.service';
import { MailroomService } from './mailroom.service';
import { MailroomCommandDto } from './mailroom.dto';
import { caseIntakeSummary } from './mailroom-intake.contract';
import { type Actor, type SourceCase } from './mailroom.contract';

// Transactional in-memory adapter runs the actual native record/task/outbox methods;
// it never invokes a Source mutation, network, database, provider or financial command.
function matches(row: any, where: any): boolean {
  return Object.entries(where || {}).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((w: any) => matches(row, w));
    if (key === 'OR') return value.some((w: any) => matches(row, w));
    if (value && typeof value === 'object') {
      if ('path' in value)
        return (
          value.path.reduce((r: any, k: string) => r?.[k], row[key]) ===
          value.equals
        );
      if ('in' in value) return value.in.includes(row[key]);
      if ('contains' in value)
        return String(row[key] || '')
          .toLowerCase()
          .includes(value.contains.toLowerCase());
      return matches(row[key] || {}, value);
    }
    return row[key] === value;
  });
}

describe('unmatched receipt → CSR acceptance → real source binding, without custody or finance writes', () => {
  let db: any,
    mailroom: MailroomService,
    intake: MailroomIntakeService,
    sourceModule: any,
    sync: any;
  let data: {
    items: any[];
    receipts: any[];
    actions: any[];
    tasks: any[];
    notifications: any[];
    deliveries: any[];
  };
  let users: Record<
    string,
    {
      actor: Actor;
      scope: string;
      activeEmployee: boolean;
      sourceAllowed: boolean;
    }
  >;
  let source: SourceCase;
  let beforeTx: (() => void) | undefined;
  const savedEnabled = process.env.MAILROOM_ENABLED;
  const clone = (v: any) => structuredClone(v);
  const permissions = [
    'mailroom:review',
    'after_sales_cases:read',
    'after_sales_cases:update',
  ];
  const person = (id: string, keys: string[], entityIds = ['company']) => ({
    actor: {
      id,
      name: 'SYNTHETIC ' + id,
      permissions: new Set(keys),
      entityIds,
    },
    scope: 'ENTITY',
    activeEmployee: true,
    sourceAllowed: true,
  });
  const fullItem = (id: string) => {
    const row = data.items.find((item) => item.id === id);
    return row
      ? clone({
          ...row,
          receipt: data.receipts.find(
            (receipt) => receipt.id === row.receiptId,
          ),
        })
      : null;
  };
  const add = (id = 'piece') => {
    const receiptId = 'receipt-' + id;
    data.receipts.push({
      id: receiptId,
      number: 'SYNTHETIC-' + receiptId,
      entityId: 'company',
      category: 'UNMATCHED',
      receivedById: 'clerk',
      receivedAt: new Date(),
      sourceCaseId: null,
      sourceNumber: null,
      sourceSnapshot: null,
      customerServiceUserId: null,
    });
    data.items.push({
      id,
      receiptId,
      entityId: 'company',
      version: 1,
      label: 'SYNTHETIC-' + id,
      status: 'RECEIVED',
      productName: 'SYNTHETIC ITEM',
      sku: 'SYNTHETIC-SKU',
      serialNumber: 'SYNTHETIC-SN-' + id,
      location: 'CLERK-A',
      custodianId: 'clerk',
      nextUserId: null,
      recipientId: null,
      repairOwnerId: null,
      matchResult: 'PENDING',
      grade: null,
      disposition: null,
      conditionNote: null,
      repairWorkflow: null,
      repairInspection: null,
      repairReport: null,
      evidence: [],
      declared: null,
    });
  };
  const input = (
    action: MailroomCommandDto['action'],
    overrides: Partial<MailroomCommandDto> = {},
  ): MailroomCommandDto => ({
    entityId: 'company',
    action,
    requestId: 'synthetic-' + action,
    expectedVersion:
      action === 'send_intake' ? 1 : action === 'claim_intake' ? 2 : 3,
    ...(action === 'send_intake'
      ? { csrUserId: 'csr', note: 'SYNTHETIC UNKNOWN PARCEL' }
      : {}),
    ...(action === 'bind_intake'
      ? {
          targetCategory: 'REPAIR' as const,
          sourceCaseId: 'source-case',
          sourceItemId: 'source-line',
          sourceVersion: 'source-version-1',
          note: 'SYNTHETIC NORMAL CASE SELECTED',
        }
      : {}),
    ...overrides,
  });
  const send = (id = 'piece', override: Partial<MailroomCommandDto> = {}) =>
    intake.command('clerk', id, input('send_intake', override));
  const accept = (id = 'piece', override: Partial<MailroomCommandDto> = {}) =>
    intake.command('csr', id, input('claim_intake', override));
  const bind = (id = 'piece', override: Partial<MailroomCommandDto> = {}) =>
    intake.command('csr', id, input('bind_intake', override));
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
    beforeTx = undefined;
    data = {
      items: [],
      receipts: [],
      actions: [],
      tasks: [],
      notifications: [],
      deliveries: [],
    };
    users = {
      clerk: person('clerk', [
        'mailroom:read',
        'mailroom:create',
        'mailroom:update',
      ]),
      csr: person('csr', permissions),
      other: person('other', permissions),
      tech: person('tech', [
        'repair_workbench:read',
        'repair_workbench:update',
      ]),
    };
    add();
    source = {
      id: 'source-case',
      number: 'SYNTHETIC-SOURCE',
      type: 'REPAIR',
      brand: 'SYNTHETIC',
      version: 'source-version-1',
      status: 'PENDING_RECEIPT',
      repairAllowed: false,
      customerLabel: 'SYNTHETIC',
      assigneeId: 'source-csr',
      assigneeEmail: 'csr@example.invalid',
      items: [
        {
          id: 'source-line',
          name: 'SYNTHETIC ITEM',
          sku: 'SYNTHETIC-SKU',
          serialNumber: null,
          quantity: 1,
        },
      ],
    };
    const keyedAction = (where: any) => {
      const k = where.entityId_actorId_requestId;
      return (
        data.actions.find(
          (row) =>
            row.entityId === k.entityId &&
            row.actorId === k.actorId &&
            row.requestId === k.requestId,
        ) || null
      );
    };
    db = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          users[where.id]
            ? { salesDataScope: users[where.id].scope, roles: [] }
            : null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          where.email
            ? [{ id: 'csr' }]
            : Object.values(users)
                .filter((u) => where.id?.in?.includes(u.actor.id))
                .map((u) => ({ id: u.actor.id, name: u.actor.name })),
        ),
      },
      employee: {
        findFirst: jest.fn(async ({ where }: any) =>
          users[where.userId]?.activeEmployee &&
          users[where.userId].actor.entityIds?.includes(where.entityId)
            ? { id: 'employee-' + where.userId }
            : null,
        ),
      },
      mailroomItem: {
        findUnique: jest.fn(async ({ where }: any) => fullItem(where.id)),
        findUniqueOrThrow: jest.fn(async ({ where }: any) =>
          fullItem(where.id),
        ),
        findMany: jest.fn(async ({ where, skip = 0, take = 999 }: any) =>
          data.items
            .map((item) => fullItem(item.id))
            .filter((item) => matches(item, where))
            .slice(skip, skip + take),
        ),
        count: jest.fn(
          async ({ where }: any) =>
            data.items
              .map((item) => fullItem(item.id))
              .filter((item) => matches(item, where)).length,
        ),
        update: jest.fn(async ({ where, data: changes }: any) => {
          const row = data.items.find((item) => item.id === where.id);
          Object.assign(row, changes, {
            version: row.version + changes.version.increment,
          });
          return fullItem(row.id);
        }),
      },
      mailroomReceipt: {
        update: jest.fn(async ({ where, data: changes }: any) => {
          const row = data.receipts.find((r) => r.id === where.id);
          Object.assign(row, changes);
          return clone(row);
        }),
      },
      mailroomAction: {
        findUnique: jest.fn(async ({ where }: any) =>
          clone(keyedAction(where)),
        ),
        create: jest.fn(async ({ data: values }: any) => {
          const row = {
            ...clone(values),
            id: 'event-' + data.actions.length,
            createdAt: new Date(),
          };
          data.actions.push(row);
          return clone(row);
        }),
        findMany: jest.fn(async ({ where }: any) =>
          data.actions.filter((row) => matches(row, where)).map(clone),
        ),
      },
      mailroomTask: {
        findMany: jest.fn(async ({ where }: any) =>
          data.tasks
            .filter((row) => matches(row, where))
            .map((row) => ({ ...clone(row), item: fullItem(row.itemId) })),
        ),
        updateMany: jest.fn(async ({ where, data: changes }: any) => {
          for (const row of data.tasks.filter((r) => matches(r, where)))
            Object.assign(row, changes);
          return { count: 1 };
        }),
        update: jest.fn(async ({ where, data: changes }: any) => {
          const row = data.tasks.find((r) => r.id === where.id);
          Object.assign(row, changes);
          return clone(row);
        }),
        create: jest.fn(async ({ data: values }: any) => {
          const row = {
            ...clone(values),
            id: 'task-' + data.tasks.length,
            status: 'OPEN',
            createdAt: new Date(),
          };
          data.tasks.push(row);
          return clone(row);
        }),
      },
      notification: {
        create: jest.fn(async ({ data: values }: any) => {
          const row = {
            ...clone(values),
            id: 'notice-' + data.notifications.length,
            read: false,
            createdAt: new Date(),
          };
          data.notifications.push(row);
          return clone(row);
        }),
      },
      mailroomDelivery: {
        createMany: jest.fn(async ({ data: values }: any) => {
          data.deliveries.push(...clone(values));
          return { count: values.length };
        }),
        findMany: jest.fn(async ({ where }: any) =>
          data.deliveries.filter((row) => matches(row, where)),
        ),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn(async (sql: any) => {
        if (!sql.sql.includes('COUNT(*)')) return [];
        const [entity, , caseId, lineId, excludeId] = sql.values;
        return [
          {
            received: BigInt(
              data.items
                .map((i) => fullItem(i.id))
                .filter(
                  (i) =>
                    i.entityId === entity &&
                    i.receipt.entityId === entity &&
                    i.receipt.sourceCaseId === caseId &&
                    i.declared?.id === lineId &&
                    i.id !== excludeId,
                ).length,
            ),
          },
        ];
      }),
      $executeRaw: jest.fn(),
    };
    let sequence = Promise.resolve();
    db.$transaction = jest.fn((fn: any) => {
      const run = sequence.then(async () => {
        beforeTx?.();
        beforeTx = undefined;
        const snapshot = clone(data);
        try {
          return await fn(db);
        } catch (error) {
          data = snapshot;
          throw error;
        }
      });
      sequence = run.catch(() => undefined);
      return run;
    });
    sourceModule = {
      actor: jest.fn(async (id: string, entityId: string) => {
        if (!users[id]?.sourceAllowed) throw new Error('SOURCE DENIED');
        return {
          userId: id,
          entityId,
          modules: ['cases', 'dashboard'],
          writeModules: ['cases'],
        };
      }),
    };
    sync = {
      cases: jest.fn(async () => ({ items: [clone(source)] })),
      deliverPending: jest.fn().mockResolvedValue(undefined),
    };
    mailroom = new MailroomService(
      db,
      { sendToUser: jest.fn() } as any,
      sync,
      undefined,
      sourceModule,
    );
    jest
      .spyOn(mailroom, 'actor')
      .mockImplementation(async (id: string) => clone(users[id].actor));
    intake = new MailroomIntakeService(db, mailroom, sync);
  });
  afterEach(() => {
    if (savedEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = savedEnabled;
  });

  test('sent/accepted/resolved records, tasks and notifications stay separate from actual custody; binding emits compatible identify only once', async () => {
    await send();
    expect(data.items[0]).toMatchObject({
      status: 'RECEIVED',
      custodianId: 'clerk',
      location: 'CLERK-A',
      nextUserId: null,
      version: 2,
      repairWorkflow: { intake: { status: 'SENT' } },
    });
    expect(data.tasks.filter((t) => t.status === 'OPEN')).toMatchObject([
      { userId: 'csr', kind: 'INTAKE_SENT' },
    ]);
    expect(data.notifications[0].data.targetPath).toBe(
      '/operations/after-sales/workbench?entityId=company&intakeItemId=piece',
    );
    expect(data.deliveries).toHaveLength(0);
    await accept();
    expect(data.items[0].repairWorkflow.intake).toMatchObject({
      status: 'ACCEPTED',
      ownerId: 'csr',
    });
    expect(data.items[0]).toMatchObject({
      custodianId: 'clerk',
      location: 'CLERK-A',
      nextUserId: null,
      version: 3,
    });
    expect(data.tasks.filter((t) => t.status === 'OPEN')).toMatchObject([
      { userId: 'csr', kind: 'INTAKE_ACCEPTED' },
    ]);
    expect(data.notifications.at(-1)).toMatchObject({
      userId: 'clerk',
      title: '客服已接手補建案件',
    });
    await bind();
    expect(data.items[0]).toMatchObject({
      version: 4,
      custodianId: 'clerk',
      location: 'CLERK-A',
      nextUserId: null,
      status: 'RECEIVED',
      declared: { id: 'source-line' },
      repairWorkflow: {
        intake: { status: 'RESOLVED', sourceCaseId: 'source-case' },
      },
    });
    expect(data.receipts[0]).toMatchObject({
      category: 'REPAIR',
      sourceCaseId: 'source-case',
      sourceNumber: 'SYNTHETIC-SOURCE',
      customerServiceUserId: 'csr',
      sourceSnapshot: { version: 'source-version-1' },
    });
    expect(data.tasks.filter((t) => t.status === 'OPEN')).toHaveLength(0);
    expect(data.actions.map((a) => a.action)).toEqual([
      'send_intake',
      'claim_intake',
      'identify',
    ]);
    expect(data.actions[0].snapshot).toMatchObject({
      caseIntake: { status: 'SENT' },
    });
    expect(data.deliveries).toHaveLength(2);
    expect(
      data.deliveries.every(
        (d) =>
          d.payload.action === 'identify' &&
          d.payload.inventoryPosted === false &&
          d.payload.refundExecuted === false &&
          !('caseIntake' in d.payload.item),
      ),
    ).toBe(true);
    expect(db.$executeRaw).toHaveBeenCalledTimes(4);
    // Each receipt/source association preserves immutable native ID and original receive evidence.
    expect(caseIntakeSummary(data.items[0].repairWorkflow)).toMatchObject({
      lastAction: 'bind_intake',
      lastRequestId: 'synthetic-bind_intake',
    });
    expect(data.items[0].id).toBe('piece');
    expect(data.items[0].receiptId).toBe('receipt-piece');
    expect(sync.cases).toHaveBeenCalledTimes(1); // no HTTP in the local transaction
  });
  test('RETURN binding uses the same single-piece association and preserves clerk custody', async () => {
    source.type = 'RETURN';
    await send();
    await accept();
    await bind('piece', { targetCategory: 'RETURN' });
    expect(data.receipts[0]).toMatchObject({
      category: 'RETURN',
      sourceCaseId: 'source-case',
    });
    expect(data.items[0]).toMatchObject({
      custodianId: 'clerk',
      location: 'CLERK-A',
      nextUserId: null,
      status: 'RECEIVED',
    });
    expect(
      data.deliveries.every((row) => row.payload.action === 'identify'),
    ).toBe(true);
  });
  test('read-only Source module capabilities cannot be misrepresented as a case-create eligible CSR', async () => {
    sourceModule.actor.mockResolvedValue({
      userId: 'csr',
      entityId: 'company',
      modules: ['cases', 'dashboard'],
      writeModules: [],
    });
    await expect(send()).rejects.toThrow('建案權限');
    expect(data.actions).toHaveLength(0);
  });
  test('foreign company receipt scope cannot be used even when the native row is in the requested company', async () => {
    data.receipts[0].entityId = 'foreign';
    await expect(send()).rejects.toThrow('找不到');
    expect(data.actions).toHaveLength(0);
    expect(data.notifications).toHaveLength(0);
  });
  test('a malformed stored intake branch fails closed rather than exposing arbitrary objects in the logistics summary', async () => {
    await send();
    data.items[0].repairWorkflow.intake.sentToUserName = {
      financialSecret: 'DO NOT EXPOSE',
    };
    await expect(mailroom.detail('clerk', 'company', 'piece')).rejects.toThrow(
      '記錄格式',
    );
  });
  test('legacy grouped unmatched receipt cannot silently associate another physical item; it requires supervisor review', async () => {
    await send();
    await accept();
    const extra = {
      ...structuredClone(data.items[0]),
      id: 'legacy-second',
      repairWorkflow: null,
      version: 1,
    };
    data.items.push(extra);
    await expect(bind()).rejects.toThrow(
      '此舊收件包含多個品項，需由主管核對歸屬後再處理',
    );
    expect(data.receipts[0].category).toBe('UNMATCHED');
    expect(data.receipts[0].sourceCaseId).toBeNull();
    expect(data.items[0].version).toBe(3);
    expect(data.items[1].declared).toBeNull();
    expect(data.deliveries).toHaveLength(0);
  });
  test('new intake branch merges existing workflow branches and never erases their immutable traces', async () => {
    data.items[0].repairWorkflow = {
      schema: 1,
      existingSourceTrace: { id: 'SYNTHETIC-PREEXISTING' },
    };
    await send();
    await accept();
    await bind();
    expect(data.items[0].repairWorkflow.existingSourceTrace).toEqual({
      id: 'SYNTHETIC-PREEXISTING',
    });
    expect(
      data.actions.every(
        (row) =>
          row.snapshot.repairWorkflow.existingSourceTrace.id ===
          'SYNTHETIC-PREEXISTING',
      ),
    ).toBe(true);
  });
  test('each exact retry after later states works without fresh source fetch; changed request content is rejected', async () => {
    await send();
    await accept();
    await bind();
    const counts = clone({
      actions: data.actions.length,
      notices: data.notifications.length,
      deliveries: data.deliveries.length,
    });
    sync.cases.mockRejectedValue(new Error('SOURCE UNAVAILABLE'));
    expect(await send()).toMatchObject({ duplicate: true });
    expect(await accept()).toMatchObject({ duplicate: true });
    expect(await bind()).toMatchObject({ duplicate: true });
    expect({
      actions: data.actions.length,
      notices: data.notifications.length,
      deliveries: data.deliveries.length,
    }).toEqual(counts);
    expect(sync.cases).toHaveBeenCalledTimes(1);
    await expect(bind('piece', { note: 'DIFFERENT BODY' })).rejects.toThrow(
      '同一操作識別碼',
    );
  });
  test('missing Source-create grants, Source launch rights, ENTITY scope or active employee cannot become the assigned CSR', async () => {
    users.csr.actor.permissions.delete('after_sales_cases:update');
    await expect(send()).rejects.toThrow();
    users.csr.actor.permissions.add('after_sales_cases:update');
    users.csr.sourceAllowed = false;
    await expect(send()).rejects.toThrow('SOURCE DENIED');
    users.csr.sourceAllowed = true;
    users.csr.scope = 'SELF';
    await expect(send()).rejects.toThrow('公司範圍');
    users.csr.scope = 'ENTITY';
    users.csr.activeEmployee = false;
    await expect(send()).rejects.toThrow('在職員工');
    expect(data.actions).toHaveLength(0);
    expect(data.tasks).toHaveLength(0);
  });
  test('wrong clerk, technician, other CSR and unaccepted bind cannot steal or move the parcel', async () => {
    data.items[0].custodianId = 'other-clerk';
    await expect(send()).rejects.toThrow('實物保管人');
    data.items[0].custodianId = 'clerk';
    await send();
    await expect(
      intake.command('tech', 'piece', input('claim_intake')),
    ).rejects.toThrow();
    await expect(
      intake.command('other', 'piece', input('claim_intake')),
    ).rejects.toThrow('未指派');
    await expect(bind('piece', { expectedVersion: 2 })).rejects.toThrow(
      '本人接手',
    );
    expect(sync.cases).not.toHaveBeenCalled();
    await expect(
      accept('piece', {
        location: 'ILLEGAL',
        nextUserId: 'tech',
        confirmedItems: true,
      }),
    ).rejects.toThrow('實物');
    expect(data.items[0]).toMatchObject({
      version: 2,
      custodianId: 'clerk',
      location: 'CLERK-A',
      nextUserId: null,
    });
  });
  test('transaction fresh role/scope/company rechecks refuse pre-read revocation and even exact retries after revocation', async () => {
    await send();
    beforeTx = () => {
      users.csr.actor.permissions.delete('after_sales_cases:update');
    };
    await expect(accept()).rejects.toThrow();
    expect(data.actions).toHaveLength(1);
    users.csr.actor.permissions.add('after_sales_cases:update');
    await accept();
    beforeTx = () => {
      users.csr.scope = 'SELF';
    };
    await expect(bind()).rejects.toThrow('公司範圍');
    expect(data.receipts[0].sourceCaseId).toBeNull();
    users.csr.scope = 'ENTITY';
    await bind();
    users.csr.actor.permissions.delete('mailroom:review');
    await expect(bind()).rejects.toThrow();
    users.csr.actor.permissions.add('mailroom:review');
    users.csr.actor.entityIds = ['foreign'];
    await expect(bind()).rejects.toThrow();
  });
  test('stale native version, stale source version, wrong source identity/type/line and source cancellation never bind', async () => {
    await send();
    await expect(accept('piece', { expectedVersion: 1 })).rejects.toThrow(
      '資料已更新',
    );
    await accept();
    source.version = 'new-version';
    await expect(bind()).rejects.toThrow('來源案件版次');
    source.version = 'source-version-1';
    source.id = 'foreign-id';
    await expect(bind()).rejects.toThrow('來源案件');
    source.id = 'source-case';
    source.type = 'RETURN';
    await expect(bind()).rejects.toThrow('來源案件');
    source.type = 'REPAIR';
    source.status = 'CANCELLED';
    await expect(bind()).rejects.toThrow('來源案件');
    source.status = 'PENDING_RECEIPT';
    await expect(
      bind('piece', { sourceItemId: 'unknown-line' }),
    ).rejects.toThrow('來源案件');
    expect(data.actions).toHaveLength(2);
    expect(data.receipts[0].sourceCaseId).toBeNull();
  });
  test('same-company Source line capacity includes all earlier physical rows and concurrent bindings; only one succeeds', async () => {
    add('second');
    await send();
    await accept();
    await send('second', { requestId: 'synthetic-send-second' });
    await accept('second', { requestId: 'synthetic-claim-second' });
    const attempts = await Promise.allSettled([
      bind(),
      bind('second', { requestId: 'synthetic-bind-second' }),
    ]);
    expect(attempts.map((a) => a.status)).toEqual(['fulfilled', 'rejected']);
    expect((attempts[1] as PromiseRejectedResult).reason.message).toContain(
      '超過來源申報',
    );
    expect(data.receipts.filter((r) => r.sourceCaseId)).toHaveLength(1);
    expect(data.items[1].repairWorkflow.intake.status).toBe('ACCEPTED');
    expect(data.deliveries).toHaveLength(2);
  });
  test('binding failure rolls back receipt, item, history and tasks; the same request then succeeds after reconciliation', async () => {
    await send();
    await accept();
    db.mailroomAction.create.mockRejectedValueOnce(
      new Error('SYNTHETIC WRITE FAULT'),
    );
    await expect(bind()).rejects.toThrow('WRITE FAULT');
    expect(data.receipts[0].sourceCaseId).toBeNull();
    expect(data.items[0].version).toBe(3);
    expect(data.actions).toHaveLength(2);
    expect(data.deliveries).toHaveLength(0);
    expect(data.tasks.filter((t) => t.status === 'OPEN')).toMatchObject([
      { kind: 'INTAKE_ACCEPTED' },
    ]);
    expect(await bind()).toMatchObject({ duplicate: false });
    expect(data.deliveries).toHaveLength(2);
  });
  test('clerk can track safe sent/accepted summary and history, without full technical documents or intake free text', async () => {
    await send();
    await accept();
    data.items[0].repairWorkflow.secretFinancial = 'DO NOT EXPOSE';
    const detail = await mailroom.detail('clerk', 'company', 'piece');
    expect(detail.caseIntake).toMatchObject({
      status: 'ACCEPTED',
      ownerId: 'csr',
      sentToUserId: 'csr',
    });
    expect(detail.allowedIntakeActions).toEqual([]);
    expect(detail).not.toHaveProperty('repairWorkflow');
    expect(detail.caseIntake).not.toHaveProperty('note');
    expect(detail.history[0].snapshot).toHaveProperty(
      'caseIntake.status',
      'SENT',
    );
    expect(detail.history[0].snapshot).not.toHaveProperty('repairWorkflow');
    expect(JSON.stringify(detail)).not.toContain('DO NOT EXPOSE');
    expect(caseIntakeSummary(data.items[0].repairWorkflow)).toEqual(
      detail.caseIntake,
    );
  });
  test('CSR reads remain assigned-only/company-bound when case-write grants are revoked; command rights are independently withheld', async () => {
    await send();
    const q = { entityId: 'company', page: 1 };
    expect(await intake.queue('csr', q)).toMatchObject({
      total: 1,
      scope: 'mine',
    });
    expect(
      (await intake.queue('csr', q)).items[0].allowedIntakeActions,
    ).toEqual(['claim_intake']);
    expect((await intake.queue('other', q)).total).toBe(0);
    await expect(mailroom.detail('other', 'company', 'piece')).rejects.toThrow(
      '存取權限',
    );
    users.csr.actor.entityIds = ['foreign'];
    await expect(intake.queue('csr', q)).rejects.toThrow();
    users.csr.actor.entityIds = ['company'];
    users.csr.actor.permissions.delete('after_sales_cases:update');
    const readOnly = await intake.queue('csr', q);
    expect(readOnly).toMatchObject({ total: 1, scope: 'mine' });
    expect(readOnly.items[0].allowedIntakeActions).toEqual([]);
    expect(
      (await mailroom.detail('csr', 'company', 'piece')).allowedIntakeActions,
    ).toEqual([]);
    const tasks = await mailroom.tasks('csr', 'company');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].item).toMatchObject({ allowedIntakeActions: [] });
    const before = clone(data);
    await expect(accept()).rejects.toThrow();
    expect(data).toEqual(before);
    users.csr.actor.permissions.delete('mailroom:review');
    await expect(intake.queue('csr', q)).rejects.toThrow();
    await expect(mailroom.detail('csr', 'company', 'piece')).rejects.toThrow();
    expect(await mailroom.tasks('csr', 'company')).toHaveLength(0);
  });
  test('assigned CSR can read without Source eligibility or an active employee association but cannot claim or bind', async () => {
    await send();
    users.csr.sourceAllowed = false;
    users.csr.activeEmployee = false;
    const before = clone(data);
    const queue = await intake.queue('csr', { entityId: 'company' });
    expect(queue).toMatchObject({ total: 1, scope: 'mine' });
    expect(queue.items[0].allowedIntakeActions).toEqual([]);
    expect(
      (await mailroom.detail('csr', 'company', 'piece')).allowedIntakeActions,
    ).toEqual([]);
    expect(await mailroom.tasks('csr', 'company')).toHaveLength(1);
    await expect(accept()).rejects.toThrow('SOURCE DENIED');
    await expect(bind('piece', { expectedVersion: 2 })).rejects.toThrow(
      'SOURCE DENIED',
    );
    users.csr.sourceAllowed = true;
    await expect(accept()).rejects.toThrow('在職員工');
    expect(data).toEqual(before);
    expect(sync.cases).not.toHaveBeenCalled();
  });
  test('a company supervisor with valid command eligibility cannot take another CSR intake through overview reads', async () => {
    await send();
    users.supervisor = person('supervisor', ['*']);
    users.supervisor.actor.entityIds = null;
    db.employee.findFirst.mockResolvedValue({
      id: 'synthetic-supervisor-employee',
    });
    expect(
      await intake.queue('supervisor', { entityId: 'company' }),
    ).toMatchObject({
      scope: 'company',
      total: 1,
    });
    const before = clone(data);
    await expect(
      intake.command('supervisor', 'piece', input('claim_intake')),
    ).rejects.toThrow('未指派');
    await expect(
      intake.command(
        'supervisor',
        'piece',
        input('bind_intake', { expectedVersion: 2 }),
      ),
    ).rejects.toThrow('未指派');
    expect(data).toEqual(before);
    expect(sync.cases).not.toHaveBeenCalled();
    await accept();
    const accepted = clone(data);
    await expect(
      intake.command('supervisor', 'piece', input('bind_intake')),
    ).rejects.toThrow('未指派');
    expect(data).toEqual(accepted);
    expect(sync.cases).not.toHaveBeenCalled();
  });
  test('old direct clerk identify cannot bypass an already sent CSR intake', async () => {
    await send();
    await expect(
      mailroom.command('clerk', 'piece', {
        ...input('send_intake'),
        action: 'identify',
        csrUserId: undefined,
        targetCategory: 'PARCEL',
        expectedVersion: 2,
        requestId: 'synthetic-bypass',
      }),
    ).rejects.toThrow('受理客服');
    expect(data.items[0].version).toBe(2);
    expect(data.receipts[0].category).toBe('UNMATCHED');
  });
  test('before acceptance clerk can reassign once with a new version; old CSR cannot claim and old task completes', async () => {
    await send();
    await send('piece', {
      csrUserId: 'other',
      expectedVersion: 2,
      requestId: 'synthetic-reassign',
    });
    await expect(accept('piece', { expectedVersion: 3 })).rejects.toThrow(
      '未指派',
    );
    expect(data.tasks.filter((t) => t.status === 'OPEN')).toMatchObject([
      { userId: 'other', kind: 'INTAKE_SENT' },
    ]);
    await intake.command(
      'other',
      'piece',
      input('claim_intake', {
        expectedVersion: 3,
        requestId: 'synthetic-other-claim',
      }),
    );
    await expect(
      send('piece', {
        expectedVersion: 4,
        requestId: 'synthetic-reassign-after-accept',
      }),
    ).rejects.toThrow('已接手');
  });
  test('ordinary reviewer keeps existing customer-service options in a company without Source integration; intake adds a separate eligibility flag', async () => {
    users.legacy = person('legacy', ['mailroom:review']);
    users.legacy.sourceAllowed = false;
    db.employee.findMany = jest.fn().mockResolvedValue([
      {
        userId: 'legacy',
        employeeNo: 'SYNTHETIC-LEGACY',
        name: 'SYNTHETIC ordinary reviewer',
        department: { name: 'SYNTHETIC customer service' },
      },
      {
        userId: 'csr',
        employeeNo: 'SYNTHETIC-INTAKE',
        name: 'SYNTHETIC intake reviewer',
        department: { name: 'SYNTHETIC customer service' },
      },
    ]);
    const people = await mailroom.people('clerk', 'company');
    expect(people.find((p) => p.id === 'legacy')).toMatchObject({
      customerService: true,
      intakeCustomerService: false,
    });
    expect(people.find((p) => p.id === 'csr')).toMatchObject({
      customerService: true,
      intakeCustomerService: true,
    });
    await expect(send('piece', { csrUserId: 'legacy' })).rejects.toThrow();
    expect(data.items[0].version).toBe(1);
    expect(data.actions).toHaveLength(0);
  });
});
