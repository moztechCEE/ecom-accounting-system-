/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MailroomService } from './mailroom.service';
import { MailroomPrecheckService } from './mailroom-precheck.service';
import { MailroomPrecheckController } from './mailroom-precheck.controller';
import { MailroomController } from './mailroom.controller';
import { MailroomIntakeService } from './mailroom-intake.service';
import type { CreateReceiptDto } from './mailroom.dto';
import type { Actor, SourceCase } from './mailroom.contract';

const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';
const NEW = '/mailroom/prechecks/receipts';
const OLD = '/mailroom/receipts';
const copy = <T>(value: T): T => structuredClone(value);
function fixture() {
  const source: SourceCase = {
    id: 'source-case',
    number: 'CASE-SYNTHETIC',
    type: 'REPAIR',
    brand: 'SYNTHETIC',
    version: '2026-10-16T00:00:00.000Z',
    status: 'PENDING_RECEIPT',
    repairAllowed: false,
    customerLabel: 'SYNTHETIC',
    items: [
      {
        id: 'source-line',
        name: 'SYNTHETIC DEVICE',
        sku: 'SKU',
        serialNumber: null,
        quantity: 2,
      },
    ],
  };
  const state: any = {
    receipts: [],
    items: [],
    actions: [],
    tasks: [],
    notifications: [],
    deliveries: [
      {
        eventId: 'OLD-AI-EVENT',
        target: 'AI_CUSTOMER_SERVICE',
        status: 'PENDING',
        itemId: 'OLD-ITEM',
      },
      {
        eventId: 'OLD-SOURCE-EVENT',
        target: 'AFTER_SALES',
        status: 'PENDING',
        itemId: 'OLD-ITEM',
      },
    ],
  };
  const controls = {
    permissions: new Set([
      'mailroom:create',
      'mailroom:read',
      'mailroom:update',
    ]),
    entities: ['company'],
    activeRecipient: true,
    productActive: true,
  };
  const actor = (id: string): Actor => ({
    id,
    name: 'SYNTHETIC ' + id,
    entityIds: controls.entities,
    permissions:
      id === 'clerk'
        ? new Set(controls.permissions)
        : new Set(['mailroom:read']),
  });
  const db: any = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async (sql) =>
      sql.sql.includes('COUNT(*)')
        ? [
            {
              received: BigInt(
                state.items.filter(
                  (row: any) =>
                    row.declared?.id === 'source-line' &&
                    row.entityId === 'company',
                ).length,
              ),
            },
          ]
        : [],
    ),
    employee: {
      findFirst: jest.fn(async ({ where }) =>
        controls.activeRecipient && where.entityId === 'company'
          ? { id: 'employee-' + where.userId }
          : null,
      ),
    },
    user: { findMany: jest.fn(async () => []) },
    product: {
      findFirst: jest.fn(async ({ where }) =>
        controls.productActive &&
        where.entityId === 'company' &&
        where.id === 'product'
          ? { name: 'SYNTHETIC DEVICE', sku: 'SKU', barcode: null }
          : null,
      ),
    },
    mailroomReceipt: {
      findUnique: jest.fn(async ({ where }) => {
        const key = where.entityId_receivedById_requestId;
        const row = state.receipts.find(
          (r: any) =>
            r.entityId === key.entityId &&
            r.receivedById === key.receivedById &&
            r.requestId === key.requestId,
        );
        return row
          ? {
              ...copy(row),
              items: copy(
                state.items.filter((i: any) => i.receiptId === row.id),
              ),
            }
          : null;
      }),
      create: jest.fn(async ({ data }) => {
        const row = {
          id: 'receipt-' + state.receipts.length,
          receivedAt: new Date('2026-10-16T00:00:00Z'),
          ...Object.fromEntries(
            Object.entries(copy(data)).filter(
              ([, value]) => value !== undefined,
            ),
          ),
        };
        state.receipts.push(row);
        return copy(row);
      }),
    },
    mailroomItem: {
      create: jest.fn(async ({ data }) => {
        const row = {
          id: 'item-' + state.items.length,
          version: 1,
          repairOwnerId: null,
          repairWorkflow: null,
          returnInspection: null,
          repairInspection: null,
          repairReport: null,
          recipientId: null,
          nextUserId: null,
          matchResult: 'PENDING',
          // Prisma omits undefined optional fields and applies their null defaults.
          ...Object.fromEntries(
            Object.entries(copy(data)).filter(
              ([, value]) => value !== undefined,
            ),
          ),
          receipt: copy(
            state.receipts.find((r: any) => r.id === data.receiptId),
          ),
        };
        state.items.push(row);
        return copy(row);
      }),
    },
    mailroomAction: {
      create: jest.fn(async ({ data }) => {
        const row = {
          id: 'action-' + state.actions.length,
          createdAt: new Date('2026-10-16T00:01:00Z'),
          ...copy(data),
        };
        state.actions.push(row);
        return copy(row);
      }),
    },
    mailroomTask: {
      findMany: jest.fn(async ({ where }) =>
        copy(
          state.tasks.filter(
            (t: any) => t.itemId === where.itemId && t.status === 'OPEN',
          ),
        ),
      ),
      create: jest.fn(async ({ data }) => {
        const row = {
          id: 'task-' + state.tasks.length,
          status: 'OPEN',
          ...copy(data),
        };
        state.tasks.push(row);
        return copy(row);
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async () => ({})),
    },
    notification: {
      create: jest.fn(async ({ data }) => {
        const row = {
          id: 'notification-' + state.notifications.length,
          read: false,
          createdAt: new Date('2026-10-16T00:01:00Z'),
          ...copy(data),
        };
        state.notifications.push(row);
        return copy(row);
      }),
    },
    mailroomDelivery: {
      createMany: jest.fn(async ({ data }) => {
        state.deliveries.push(
          ...copy(data).map((row: any) => ({ ...row, status: 'PENDING' })),
        );
        return { count: data.length };
      }),
      findMany: jest.fn(() => {
        throw new Error('old pending scan forbidden');
      }),
      updateMany: jest.fn(() => {
        throw new Error('old delivery mutation forbidden');
      }),
    },
    inventoryTransaction: {
      create: jest.fn(() => {
        throw new Error('inventory forbidden');
      }),
    },
  };
  db.$transaction = jest.fn(async (fn: any) => {
    const before = copy(state);
    try {
      return await fn(db);
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  });
  const sync = {
    cases: jest.fn(async () => ({ items: [copy(source)] })),
    deliverPending: jest.fn(async () => ({})),
  };
  const gateway = { sendToUser: jest.fn() };
  const service = new MailroomService(db, gateway as never, sync as never);
  jest.spyOn(service, 'enabled').mockImplementation(() => undefined);
  jest.spyOn(service, 'actor').mockImplementation(async (id) => actor(id));
  const publish = jest.spyOn(service, 'publish'); // Call through: legacy publication is observable.
  const prechecks = new MailroomPrecheckService(db, service);
  const body = (changes: Partial<CreateReceiptDto> = {}): CreateReceiptDto => ({
    entityId: 'company',
    requestId: 'receipt-key-0001',
    category: 'REPAIR',
    sourceCaseId: source.id,
    sourceVersion: source.version,
    location: 'A1',
    items: [
      {
        sourceItemId: 'source-line',
        productId: 'product',
        productName: 'SYNTHETIC DEVICE',
        sku: 'SKU',
        serialNumber: 'SN-1',
        evidence: [PHOTO],
      },
    ],
    ...changes,
  });
  return {
    db,
    source,
    state,
    controls,
    sync,
    gateway,
    service,
    prechecks,
    publish,
    body,
  };
}

describe('new precheck receipt route executes the original native create boundary without global publication', () => {
  let f: ReturnType<typeof fixture>, app: INestApplication;
  beforeEach(async () => {
    f = fixture();
    const mod = await Test.createTestingModule({
      controllers: [MailroomPrecheckController, MailroomController],
      providers: [
        { provide: MailroomPrecheckService, useValue: f.prechecks },
        { provide: MailroomService, useValue: f.service },
        { provide: MailroomIntakeService, useValue: {} },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.use(
      (req: { user: { id: string } }, _res: unknown, next: () => void) => {
        req.user = { id: 'clerk' };
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  const post = (path: string, body: unknown) =>
    request(app.getHttpServer()).post(path).send(body);
  const noDrain = () => {
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.sync.deliverPending).not.toHaveBeenCalled();
    expect(f.db.mailroomDelivery.findMany).not.toHaveBeenCalled();
    expect(f.db.mailroomDelivery.updateMany).not.toHaveBeenCalled();
    expect(f.db.inventoryTransaction.create).not.toHaveBeenCalled();
  };
  it('creates two physical items using the real Source capacity/product locks and only two new AFTER_SALES pending events', async () => {
    const old = copy(f.state.deliveries),
      row = f.body().items[0];
    const result = await post(
      NEW,
      f.body({ items: [row, { ...row, serialNumber: 'SN-2' }] }),
    ).expect(201);
    expect(result.body.itemIds).toEqual(['item-0', 'item-1']);
    expect(f.state.receipts).toHaveLength(1);
    expect(f.state.actions).toHaveLength(2);
    expect(f.state.items.map((i: any) => i.status)).toEqual([
      'RECEIVED',
      'RECEIVED',
    ]);
    expect(f.state.items.map((i: any) => i.custodianId)).toEqual([
      'clerk',
      'clerk',
    ]);
    expect(
      f.state.items.every(
        (i: any) =>
          i.repairOwnerId === null &&
          i.location === 'A1' &&
          i.declared.id === 'source-line',
      ),
    ).toBe(true);
    expect(f.state.deliveries.slice(0, 2)).toEqual(old);
    expect(f.state.deliveries.slice(2)).toHaveLength(2);
    for (const event of f.state.deliveries.slice(2))
      expect(event).toMatchObject({
        target: 'AFTER_SALES',
        status: 'PENDING',
        payload: {
          schema: 'corely.mailroom.v1',
          action: 'receive',
          inventoryPosted: false,
          refundExecuted: false,
        },
      });
    expect(f.state.actions.every((a: any) => !a.snapshot.precheckRef)).toBe(
      true,
    );
    expect(
      f.db.$executeRaw.mock.calls.some(([sql]: any) =>
        String(sql.values[0]).includes(
          'mailroom-source-line:source-case:source-line',
        ),
      ),
    ).toBe(true);
    expect(
      f.db.$queryRaw.mock.calls.some(
        ([sql]: any) =>
          sql.sql.includes('FROM products') && sql.sql.includes('FOR SHARE'),
      ),
    ).toBe(true);
    expect(f.gateway.sendToUser).not.toHaveBeenCalled();
    noDrain();
  });
  it.each(['LETTER', 'PARCEL'] as const)(
    'preserves %s recipient task and persisted notification, pushing only this newly committed notification',
    async (category) => {
      const body = f.body({
        category,
        sourceCaseId: undefined,
        sourceVersion: undefined,
        recipientId: 'recipient',
        senderLabel: 'SYNTHETIC SENDER',
        items: [{ productName: 'SYNTHETIC LETTER' }],
      });
      f.gateway.sendToUser.mockImplementation(() => {
        throw new Error('socket unavailable');
      });
      await post(NEW, body).expect(201);
      expect(f.state.items[0]).toMatchObject({
        status: 'WAITING_PICKUP',
        custodianId: 'clerk',
        recipientId: 'recipient',
        nextUserId: 'recipient',
        version: 1,
      });
      expect(f.state.tasks).toHaveLength(1);
      expect(f.state.tasks[0]).toMatchObject({
        userId: 'recipient',
        kind: 'WAITING_PICKUP',
        status: 'OPEN',
      });
      expect(f.state.notifications).toHaveLength(1);
      expect(f.state.notifications[0]).toMatchObject({
        userId: 'recipient',
        read: false,
      });
      expect(f.gateway.sendToUser).toHaveBeenCalledTimes(1);
      expect(f.gateway.sendToUser).toHaveBeenCalledWith(
        'recipient',
        f.state.notifications[0],
      );
      expect(f.state.deliveries).toHaveLength(2);
      expect(f.state.actions[0].snapshot).not.toHaveProperty('precheckRef');
      noDrain();
      await post(NEW, body)
        .expect(201)
        .expect(({ body: result }) => expect(result.duplicate).toBe(true));
      expect(f.gateway.sendToUser).toHaveBeenCalledTimes(1);
      expect(f.state.tasks).toHaveLength(1);
      expect(f.state.notifications).toHaveLength(1);
      noDrain();
    },
  );
  it('keeps UNMATCHED receipt single-piece without inventing Source or recipient routing', async () => {
    const body = f.body({
      category: 'UNMATCHED',
      sourceCaseId: undefined,
      sourceVersion: undefined,
      items: [{ productName: 'SYNTHETIC UNKNOWN', evidence: [PHOTO] }],
    });
    await post(NEW, body).expect(201);
    expect(f.state.items[0]).toMatchObject({
      status: 'RECEIVED',
      custodianId: 'clerk',
      nextUserId: null,
    });
    expect(f.state.tasks).toHaveLength(0);
    expect(f.state.deliveries).toHaveLength(2);
    expect(f.sync.cases).not.toHaveBeenCalled();
    noDrain();
  });
  it.each([
    [NEW, OLD],
    [OLD, NEW],
  ])(
    'shares the original key/hash across %s then %s and retains old AI rows',
    async (first, second) => {
      const body = f.body(),
        a = await post(first, body).expect(201),
        before = copy(f.state.deliveries);
      f.publish.mockClear();
      f.sync.deliverPending.mockClear();
      f.gateway.sendToUser.mockClear();
      const b = await post(second, body).expect(201);
      expect(b.body).toEqual({ ...a.body, duplicate: true });
      expect(f.state.receipts).toHaveLength(1);
      expect(f.state.actions).toHaveLength(1);
      expect(f.state.deliveries).toEqual(before);
      noDrain();
    },
  );
  it('never publishes an inner transaction duplicate or creates fresh event targets', async () => {
    const body = f.body();
    await post(NEW, body).expect(201);
    const before = copy(f.state);
    f.db.mailroomReceipt.findUnique.mockResolvedValueOnce(null);
    await post(NEW, body)
      .expect(201)
      .expect(({ body: result }) => expect(result.duplicate).toBe(true));
    expect(f.state).toEqual(before);
    noDrain();
  });
  it('rejects a changed body under the same key with 409 and zero extra writes or publication', async () => {
    const body = f.body();
    await post(NEW, body).expect(201);
    const before = copy(f.state);
    await post(NEW, { ...body, trackingNumber: 'CHANGED' }).expect(409);
    expect(f.state).toEqual(before);
    noDrain();
  });
  it.each([
    'NO_PERMISSION',
    'FOREIGN_COMPANY',
    'CAPACITY',
    'PRODUCT_CHANGED',
    'STALE_SOURCE',
    'REVOKED_AFTER_LOCK',
    'SECOND_ITEM_FAILURE',
  ])('preserves original rejection/rollback boundary: %s', async (kind) => {
    let body = f.body();
    const before = copy(f.state);
    if (kind === 'NO_PERMISSION') f.controls.permissions.clear();
    if (kind === 'FOREIGN_COMPANY') body = { ...body, entityId: 'foreign' };
    if (kind === 'CAPACITY') {
      f.source.items[0].quantity = 1;
      body = {
        ...body,
        items: [...body.items, { ...body.items[0], serialNumber: 'SN-2' }],
      };
    }
    if (kind === 'PRODUCT_CHANGED') f.controls.productActive = false;
    if (kind === 'STALE_SOURCE') f.source.version = '2026-10-16T00:01:00.000Z';
    if (kind === 'REVOKED_AFTER_LOCK')
      f.db.$executeRaw.mockImplementation(async () => {
        f.controls.permissions.clear();
        return 1;
      });
    if (kind === 'SECOND_ITEM_FAILURE') {
      body = {
        ...body,
        items: [...body.items, { ...body.items[0], serialNumber: 'SN-2' }],
      };
      f.db.mailroomAction.create
        .mockImplementationOnce(async ({ data }: any) => {
          const row = { id: 'action-0', createdAt: new Date(), ...copy(data) };
          f.state.actions.push(row);
          return row;
        })
        .mockRejectedValueOnce(new Error('second action write failed'));
    }
    const response = await post(NEW, body);
    expect(response.status).toBe(
      kind === 'SECOND_ITEM_FAILURE'
        ? 500
        : ['NO_PERMISSION', 'FOREIGN_COMPANY', 'REVOKED_AFTER_LOCK'].includes(
              kind,
            )
          ? 403
          : 409,
    );
    expect(f.state).toEqual(before);
    expect(f.gateway.sendToUser).not.toHaveBeenCalled();
    noDrain();
  });
  it.each(['internalPolicy', 'policy', 'action', 'ref', 'custodianId'])(
    'strict original DTO rejects client %s before the pipeline',
    async (field) => {
      const response = await post(NEW, {
        ...f.body(),
        [field]: 'PRECHECK_RECEIPT',
      });
      expect({ status: response.status, body: response.body }).toMatchObject({
        status: 400,
      });
      expect(f.db.$transaction).not.toHaveBeenCalled();
      expect(f.sync.cases).not.toHaveBeenCalled();
      noDrain();
    },
  );
  it('retains legacy default publication and both event targets as a separate existing route', async () => {
    await post(OLD, f.body()).expect(201);
    expect(f.publish).toHaveBeenCalledTimes(1);
    expect(f.publish).toHaveBeenCalledWith([]);
    expect(f.sync.deliverPending).toHaveBeenCalledTimes(1);
    expect(f.state.deliveries.slice(2).map((row: any) => row.target)).toEqual([
      'AFTER_SALES',
      'AI_CUSTOMER_SERVICE',
    ]);
  });
  it('rejects applying receipt-only policy to a later action before history/tasks/outboxes', async () => {
    const item: any = {
      id: 'item',
      entityId: 'company',
      version: 2,
      status: 'RECEIVED',
      custodianId: 'clerk',
      repairOwnerId: null,
      nextUserId: null,
      recipientId: null,
      receipt: {
        entityId: 'company',
        category: 'REPAIR',
        receivedById: 'clerk',
      },
    };
    await expect(
      f.service.record(
        f.db,
        {
          id: 'clerk',
          name: 'Clerk',
          entityIds: ['company'],
          permissions: new Set(),
        },
        item,
        'inspect',
        'key',
        'hash',
        null,
        undefined,
        true,
        false,
        undefined,
        { kind: 'PRECHECK_RECEIPT' },
      ),
    ).rejects.toThrow('政策');
    expect(f.state.actions).toHaveLength(0);
    noDrain();
  });
});
