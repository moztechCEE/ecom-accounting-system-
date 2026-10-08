/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ForbiddenException } from '@nestjs/common';
import { MailroomIntakeService } from './mailroom-intake.service';
import { MailroomService } from './mailroom.service';

// Synthetic in-memory reads exercise the real actor, queue, detail, views and
// command gates. No employee, Source user or external service is provisioned.
function matches(row: any, where: any): boolean {
  return Object.entries(where || {}).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (value && typeof value === 'object') {
      if ('path' in value)
        return (
          value.path.reduce(
            (part: any, path: string) => part?.[path],
            row[key],
          ) === value.equals
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

describe('intake reads use fresh company/review rights independently of employee acceptance', () => {
  const savedEnabled = process.env.MAILROOM_ENABLED;
  let users: Record<string, any>,
    items: any[],
    db: any,
    sync: any,
    source: any,
    gateway: any;
  let mailroom: MailroomService, intake: MailroomIntakeService;
  const user = (
    id: string,
    role: string,
    permissions: string[] = ['mailroom:review'],
  ) => ({
    id,
    name: 'SYNTHETIC ' + id,
    isActive: true,
    mustChangePassword: false,
    employee: null,
    salesDataScope: 'ENTITY',
    entityMemberships: [{ entityId: 'company' }],
    roles: [
      {
        role: {
          code: role,
          permissions: permissions.map((key) => {
            const [resource, action] = key.split(':');
            return { permission: { resource, action } };
          }),
        },
      },
    ],
  });
  const item = (id: string, sentToUserId: string, ownerId?: string): any => ({
    id,
    entityId: 'company',
    version: 2,
    status: 'RECEIVED',
    label: 'SYNTHETIC-' + id,
    productName: 'SYNTHETIC ITEM ' + id,
    sku: 'SYNTHETIC-SKU',
    serialNumber: 'SYNTHETIC-SN-' + id,
    custodianId: 'clerk',
    location: 'SYNTHETIC-SHELF',
    recipientId: null,
    nextUserId: null,
    repairOwnerId: null,
    matchResult: 'PENDING',
    evidence: [],
    repairInspection: null,
    repairReport: null,
    receipt: {
      id: 'receipt-' + id,
      entityId: 'company',
      category: 'UNMATCHED',
      sourceCaseId: null,
      number: 'SYNTHETIC-RECEIPT-' + id,
      receivedById: 'clerk',
      receivedAt: new Date(),
      customerServiceUserId: null,
      sourceNumber: null,
    },
    repairWorkflow: {
      schema: 1,
      intake: {
        status: ownerId ? 'ACCEPTED' : 'SENT',
        sentToUserId,
        sentToUserName: 'SYNTHETIC ' + sentToUserId,
        sentBy: 'clerk',
        sentAt: '2026-10-08T00:00:00Z',
        note: 'SYNTHETIC INTAKE',
        ...(ownerId ? { ownerId, acceptedAt: '2026-10-08T00:01:00Z' } : {}),
      },
    },
  });
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
    users = {
      supervisor: user('supervisor', 'SUPER_ADMIN', []),
      reviewer: user('reviewer', 'CUSTOMER_SERVICE'),
      admin: user('admin', 'ADMIN', []),
      denied: user('denied', 'EMPLOYEE', []),
    };
    items = [
      item('sent-mine', 'reviewer'),
      item('accepted-mine', 'reviewer', 'reviewer'),
      item('sent-other', 'other'),
      item('accepted-other', 'other', 'other'),
    ];
    db = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => users[where.id] || null),
        findMany: jest.fn(async () =>
          Object.values(users).map(({ id, name }: any) => ({ id, name })),
        ),
      },
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
      mailroomItem: {
        findMany: jest.fn(async ({ where, skip = 0, take = 999 }: any) =>
          items.filter((row) => matches(row, where)).slice(skip, skip + take),
        ),
        count: jest.fn(
          async ({ where }: any) =>
            items.filter((row) => matches(row, where)).length,
        ),
        findUnique: jest.fn(
          async ({ where }: any) =>
            items.find((row) => row.id === where.id) || null,
        ),
        update: jest.fn(),
      },
      mailroomAction: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      mailroomDelivery: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      mailroomTask: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      notification: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    sync = { cases: jest.fn() };
    source = {
      actor: jest.fn(async (id: string, entityId: string) => ({
        userId: id,
        entityId,
        modules: ['dashboard', 'cases'],
        writeModules: ['cases'],
      })),
    };
    gateway = { sendToUser: jest.fn() };
    mailroom = new MailroomService(db, gateway, sync, undefined, source);
    intake = new MailroomIntakeService(db, mailroom, sync);
  });
  afterEach(() => {
    if (savedEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = savedEnabled;
  });
  function expectNoWrites() {
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.mailroomItem.update).not.toHaveBeenCalled();
    expect(db.mailroomAction.create).not.toHaveBeenCalled();
    expect(db.mailroomTask.create).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(gateway.sendToUser).not.toHaveBeenCalled();
    expect(sync.cases).not.toHaveBeenCalled();
  }
  test('a fresh Super Admin without an Employee or Source binding reads every pending intake only in the selected company', async () => {
    source.actor.mockRejectedValue(new Error('SOURCE NOT BOUND'));
    users.supervisor.entityMemberships = [];
    const foreign = item('foreign', 'reviewer');
    foreign.entityId = 'foreign';
    foreign.receipt.entityId = 'foreign';
    const foreignReceipt = item('foreign-receipt', 'reviewer');
    foreignReceipt.receipt.entityId = 'foreign';
    const resolved = item('resolved', 'reviewer', 'reviewer');
    resolved.repairWorkflow.intake.status = 'RESOLVED';
    const linked = item('linked', 'reviewer');
    linked.receipt.sourceCaseId = 'already-linked';
    const repair = item('repair', 'reviewer');
    repair.receipt.category = 'REPAIR';
    const dispatched = item('dispatched', 'reviewer');
    dispatched.status = 'DISPATCHED';
    const unassigned = item('unassigned', 'reviewer');
    unassigned.repairWorkflow = null;
    items.push(
      foreign,
      foreignReceipt,
      resolved,
      linked,
      repair,
      dispatched,
      unassigned,
    );
    const result = await intake.queue('supervisor', { entityId: 'company' });
    expect(result).toMatchObject({
      scope: 'company',
      total: 4,
      page: 1,
      limit: 30,
    });
    expect(result.items.map((row) => row.id)).toEqual([
      'sent-mine',
      'accepted-mine',
      'sent-other',
      'accepted-other',
    ]);
    expect(
      result.items.every((row) => row.allowedIntakeActions.length === 0),
    ).toBe(true);
    expect(db.mailroomItem.count.mock.calls[0][0].where).toEqual(
      db.mailroomItem.findMany.mock.calls[0][0].where,
    );
    expect(db.employee.findFirst).not.toHaveBeenCalled();
    expect(source.actor).not.toHaveBeenCalled();
    expect(
      (await mailroom.detail('supervisor', 'company', 'sent-other')).id,
    ).toBe('sent-other');
    const foreignResult = await intake.queue('supervisor', {
      entityId: 'foreign',
    });
    expect(foreignResult).toMatchObject({ scope: 'company', total: 1 });
    expect(foreignResult.items[0].id).toBe('foreign');
    expectNoWrites();
  });
  test('review-only staff retain both assigned SENT and owned ACCEPTED reads without employee or Source write eligibility', async () => {
    source.actor.mockRejectedValue(new Error('SOURCE NOT BOUND'));
    const result = await intake.queue('reviewer', { entityId: 'company' });
    expect(result).toMatchObject({ scope: 'mine', total: 2 });
    expect(result.items.map((row) => row.id)).toEqual([
      'sent-mine',
      'accepted-mine',
    ]);
    expect(
      result.items.every((row) => row.allowedIntakeActions.length === 0),
    ).toBe(true);
    expect(
      (await mailroom.detail('reviewer', 'company', 'sent-mine'))
        .allowedIntakeActions,
    ).toEqual([]);
    await expect(
      mailroom.detail('reviewer', 'company', 'sent-other'),
    ).rejects.toThrow('存取權限');
    db.mailroomTask.findMany.mockResolvedValue([
      { id: 'own-task', kind: 'INTAKE_SENT', item: items[0] },
    ]);
    const tasks = await mailroom.tasks('reviewer', 'company');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].item).toMatchObject({
      id: 'sent-mine',
      allowedIntakeActions: [],
    });
    expect(db.mailroomTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'reviewer', entityId: 'company', status: 'OPEN' },
      }),
    );
    expect(source.actor).not.toHaveBeenCalled();
    expectNoWrites();
  });
  test('ordinary ADMIN remains assigned-only rather than gaining Super Admin company scope', async () => {
    const own = item('admin-own', 'admin');
    items.push(own);
    const result = await intake.queue('admin', { entityId: 'company' });
    expect(result).toMatchObject({ scope: 'mine', total: 1 });
    expect(result.items[0].id).toBe('admin-own');
    await expect(
      intake.queue('admin', { entityId: 'foreign' }),
    ).rejects.toThrow('公司');
    expectNoWrites();
  });
  test.each(['missing', 'denied', 'inactive', 'password', 'inactive-employee'])(
    '%s fresh accounts cannot read any queue rows',
    async (id) => {
      users.inactive = {
        ...user('inactive', 'SUPER_ADMIN', []),
        isActive: false,
      };
      users.password = {
        ...user('password', 'SUPER_ADMIN', []),
        mustChangePassword: true,
      };
      users['inactive-employee'] = {
        ...user('inactive-employee', 'SUPER_ADMIN', []),
        employee: { isActive: false },
      };
      await expect(intake.queue(id, { entityId: 'company' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.mailroomItem.findMany).not.toHaveBeenCalled();
      expect(db.mailroomItem.count).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );
  test('read grant/company/role changes are checked afresh and no frontend scope field can widen them', async () => {
    expect(
      (await intake.queue('supervisor', { entityId: 'company' })).scope,
    ).toBe('company');
    users.supervisor.roles = users.reviewer.roles;
    expect(
      await intake.queue('supervisor', { entityId: 'company' }),
    ).toMatchObject({ scope: 'mine', total: 0 });
    users.reviewer.superAdmin = true;
    users.reviewer.scope = 'company';
    expect(
      (await intake.queue('reviewer', { entityId: 'company' })).scope,
    ).toBe('mine');
    users.reviewer.roles[0].role.permissions = [];
    await expect(
      intake.queue('reviewer', { entityId: 'company' }),
    ).rejects.toThrow('作業權限');
    await expect(
      intake.queue('denied', { entityId: 'company' }),
    ).rejects.toThrow('作業權限');
    expectNoWrites();
  });
  test('foreign-company and missing-entity reads fail before querying records even for an otherwise valid reviewer', async () => {
    for (const entityId of ['foreign', ''])
      await expect(intake.queue('reviewer', { entityId })).rejects.toThrow(
        '公司',
      );
    await expect(intake.queue('supervisor', { entityId: '' })).rejects.toThrow(
      '公司',
    );
    expect(db.mailroomItem.findMany).not.toHaveBeenCalled();
    expectNoWrites();
  });
  test('company overview still respects search and pagination rather than reading an unbounded cross-company list', async () => {
    const result = await intake.queue('supervisor', {
      entityId: 'company',
      search: 'accepted',
    });
    expect(result.total).toBe(2);
    expect(result.items.map((row) => row.id)).toEqual([
      'accepted-mine',
      'accepted-other',
    ]);
    expect(
      await intake.queue('supervisor', { entityId: 'company', page: 2 }),
    ).toMatchObject({
      scope: 'company',
      total: 4,
      page: 2,
      limit: 30,
      items: [],
    });
    expectNoWrites();
  });
  test.each(['claim_intake', 'bind_intake'] as const)(
    'a supervisor read without Employee cannot become a %s command',
    async (action) => {
      await intake.queue('supervisor', { entityId: 'company' });
      await expect(
        intake.command('supervisor', 'sent-other', {
          entityId: 'company',
          action,
          requestId: 'synthetic-supervisor-command',
          expectedVersion: 2,
        }),
      ).rejects.toThrow('在職員工');
      expectNoWrites();
    },
  );
  test.each(['claim_intake', 'bind_intake'] as const)(
    'a review-only assigned read does not grant %s case-write rights',
    async (action) => {
      await intake.queue('reviewer', { entityId: 'company' });
      await expect(
        intake.command('reviewer', 'sent-mine', {
          entityId: 'company',
          action,
          requestId: 'synthetic-read-only-command',
          expectedVersion: 2,
        }),
      ).rejects.toThrow('作業權限');
      expectNoWrites();
    },
  );
});
