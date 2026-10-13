import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { MailroomOutboundService } from './mailroom-outbound.service';
import {
  MailroomOutboundStockService,
  OutboundStockIssueInput,
  OutboundStockProof,
  OutboundStockVerifyInput,
} from './mailroom-outbound-stock.service';
import { CreateOutboundDto, OutboundCommandDto } from './mailroom-outbound.dto';
import {
  MailroomOutboundOrder as SourceOrder,
  DISPATCH_SCHEMA,
} from './mailroom-workflow-event.contract';
import { OutboundUnit } from './mailroom-outbound.contract';

const COMPANY = 'company-a';
const CREATOR = 'csr-a',
  PICKER = 'picker-a',
  CLERK = 'clerk-a',
  OTHER = 'clerk-b';
const VERSION = '2026-10-13T01:00:00.000Z';
type Row = Record<string, any>;
type NativeState = {
  orders: Row[];
  actions: Row[];
  deliveries: Row[];
  notifications: Row[];
  outs: OutboundStockProof[];
};
function sourceOrder(
  type: SourceOrder['type'] = 'RESHIPMENT',
  quantity = 4,
): SourceOrder {
  return {
    id: 'case-a',
    number: 'SYNTHETIC-CASE-A',
    type,
    version: VERSION,
    sourceChannel: 'SYNTHETIC CSR',
    brand: 'MOZTECH',
    customerLabel: 'SYNTHETIC Customer',
    dispatchAllowed: true,
    blockReason: null,
    items: [
      {
        id: 'line-a',
        name: 'SYNTHETIC Product',
        sku: 'SYNTHETIC-SKU',
        quantity,
        dispatchedQuantity: 0,
        dispatchedUnitIds: [],
      },
    ],
    recipient: {
      name: 'SYNTHETIC Customer',
      phone: '0900000000',
      address: 'SYNTHETIC Address',
    },
  };
}
function creation(quantity = 1): CreateOutboundDto {
  return {
    entityId: COMPANY,
    requestId: randomUUID(),
    sourceCaseId: 'case-a',
    sourceVersion: VERSION,
    lines: [{ sourceCaseItemId: 'line-a', quantity }],
  };
}
function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR')
      return (expected as Row[]).some((condition) => match(row, condition));
    if (key === 'AND')
      return (expected as Row[]).every((condition) => match(row, condition));
    if (
      expected &&
      typeof expected === 'object' &&
      !Array.isArray(expected) &&
      !(expected instanceof Date)
    ) {
      if ('in' in expected) return expected.in.includes(row[key]);
      if ('not' in expected) return row[key] !== expected.not;
      if ('lte' in expected)
        return row[key] instanceof Date && row[key] <= expected.lte;
      if ('contains' in expected)
        return (
          typeof row[key] === 'string' && row[key].includes(expected.contains)
        );
    }
    return row[key] === expected;
  });
}
/** The fixture commits or restores every native table and OUT together. No live Prisma or HTTP is used. */
function fixture(source = sourceOrder()) {
  let state: NativeState = {
    orders: [],
    actions: [],
    deliveries: [],
    notifications: [],
    outs: [],
  };
  const trace: string[] = [];
  const actors = new Map<
    string,
    { permissions: Set<string>; entityIds: string[]; name: string }
  >([
    [
      CREATOR,
      {
        permissions: new Set(['mailroom:read', 'mailroom:update']),
        entityIds: [COMPANY],
        name: 'SYNTHETIC CSR',
      },
    ],
    [
      CLERK,
      {
        permissions: new Set(['mailroom:read', 'mailroom:update']),
        entityIds: [COMPANY],
        name: 'SYNTHETIC Clerk',
      },
    ],
    [
      OTHER,
      {
        permissions: new Set(['mailroom:read', 'mailroom:update']),
        entityIds: [COMPANY],
        name: 'SYNTHETIC Other',
      },
    ],
    [
      PICKER,
      {
        permissions: new Set(['mailroom:read', 'inventory:update']),
        entityIds: [COMPANY],
        name: 'SYNTHETIC Picker',
      },
    ],
    [
      'foreign-clerk',
      {
        permissions: new Set(['mailroom:read', 'mailroom:update']),
        entityIds: ['company-b'],
        name: 'SYNTHETIC Foreign',
      },
    ],
  ]);
  const employees = new Map(
    [...actors].map(([id, actor]) => [
      id,
      {
        id: 'employee-' + id,
        userId: id,
        entityId: actor.entityIds[0],
        isActive: true,
      },
    ]),
  );
  let failAt: 'delivery' | 'notification' | 'action' | undefined;
  let onLock: (() => void | Promise<void>) | undefined;
  let sourceReadHook: (() => void) | undefined;
  let transactionTail = Promise.resolve();
  const orders = {
    findUnique: jest.fn(async ({ where }: Row) =>
      structuredClone(
        state.orders.find((row) =>
          match(row, where.entityId_createdById_requestId),
        ) || null,
      ),
    ),
    findFirst: jest.fn(async ({ where }: Row) =>
      structuredClone(state.orders.find((row) => match(row, where)) || null),
    ),
    findMany: jest.fn(
      async ({ where = {}, skip = 0, take = Number.MAX_SAFE_INTEGER }: Row) =>
        structuredClone(
          state.orders
            .filter((row) => match(row, where))
            .slice(skip, skip + take),
        ),
    ),
    count: jest.fn(
      async ({ where }: Row) =>
        state.orders.filter((row) => match(row, where)).length,
    ),
    create: jest.fn(async ({ data }: Row) => {
      const row = {
        status: 'PENDING_PICK',
        version: 1,
        custodianId: null,
        nextUserId: null,
        preparedById: null,
        stockRequestId: null,
        location: '',
        outboundShipment: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...structuredClone(data),
      };
      state.orders.push(row);
      trace.push('order.create');
      return structuredClone(row);
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = state.orders.find((row) => match(row, where));
      if (!row) throw new Error('missing fixture row');
      for (const [key, value] of Object.entries(data))
        row[key] =
          key === 'version' && value && typeof value === 'object'
            ? row.version + (value as { increment: number }).increment
            : structuredClone(value);
      row.updatedAt = new Date();
      trace.push('order.update');
      return structuredClone(row);
    }),
  };
  const actions = {
    findUnique: jest.fn(async ({ where }: Row) =>
      structuredClone(
        state.actions.find((row) =>
          match(row, where.entityId_actorId_requestId),
        ) || null,
      ),
    ),
    create: jest.fn(async ({ data }: Row) => {
      if (
        state.actions.some(
          (row) =>
            row.entityId === data.entityId &&
            row.actorId === data.actorId &&
            row.requestId === data.requestId,
        )
      )
        throw new ConflictException('fixture duplicate action');
      const row = {
        id: randomUUID(),
        createdAt: new Date(),
        ...structuredClone(data),
      };
      state.actions.push(row);
      trace.push('action.create');
      if (failAt === 'action') throw new Error('injected action failure');
      return structuredClone(row);
    }),
  };
  const deliveries = {
    createMany: jest.fn(async ({ data }: Row) => {
      for (const input of data as Row[]) {
        state.deliveries.push({
          id: randomUUID(),
          status: 'PENDING',
          attempts: 0,
          lastError: null,
          leaseUntil: null,
          nextAttemptAt: new Date('2099-01-01T00:00:00.000Z'),
          ...structuredClone(input),
        });
        trace.push('delivery.create');
        if (failAt === 'delivery')
          throw new Error('injected outbox failure after first insert');
      }
      return { count: data.length };
    }),
    findMany: jest.fn(async ({ where }: Row) =>
      structuredClone(state.deliveries.filter((row) => match(row, where))),
    ),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const rows = state.deliveries.filter((row) => match(row, where));
      for (const row of rows) Object.assign(row, structuredClone(data));
      trace.push('delivery.reschedule');
      return { count: rows.length };
    }),
  };
  const tx = {
    mailroomOutboundOrder: orders,
    mailroomOutboundAction: actions,
    mailroomDelivery: deliveries,
    $executeRaw: jest.fn(async () => {
      trace.push('lock');
      if (onLock) {
        const hook = onLock;
        onLock = undefined;
        await hook();
      }
      return 1;
    }),
    $queryRaw: jest.fn(async () => []),
    employee: {
      findFirst: jest.fn(async ({ where }: Row) =>
        structuredClone(
          [...employees.values()].find((row) => match(row, where)) || null,
        ),
      ),
    },
    notification: {
      create: jest.fn(async ({ data }: Row) => {
        const row = {
          id: randomUUID(),
          read: false,
          createdAt: new Date(),
          ...structuredClone(data),
        };
        state.notifications.push(row);
        trace.push('notification.create');
        if (failAt === 'notification')
          throw new Error('injected notification failure');
        return structuredClone(row);
      }),
    },
  };
  const db = {
    ...tx,
    user: {
      findMany: jest.fn(async ({ where }: Row) =>
        [...actors]
          .filter(([id]) => where.id.in.includes(id))
          .map(([id, actor]) => ({ id, name: actor.name })),
      ),
    },
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => {
        const pending = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await pending;
        const before = structuredClone(state);
        trace.push('tx.begin');
        try {
          const result = await callback(tx);
          trace.push('tx.commit');
          return result;
        } catch (error) {
          state = before;
          trace.push('tx.rollback');
          throw error;
        } finally {
          release();
        }
      },
    ),
  };
  const mailroom = {
    enabled: jest.fn(),
    actor: jest.fn(async (id: string) => {
      const actor = actors.get(id);
      if (!actor) throw new ForbiddenException('fixture disabled actor');
      return { id, ...structuredClone(actor) };
    }),
  };
  const sync = {
    outboundOrders: jest.fn(
      async (_entity: string, _search: string, caseId: string) => {
        trace.push('source.read');
        if (sourceReadHook) sourceReadHook();
        return {
          items: caseId === source.id ? [structuredClone(source)] : [],
          nextCursor: null,
        };
      },
    ),
  };
  const stock = {
    issue: jest.fn(async (_tx: unknown, input: OutboundStockIssueInput) => {
      const proofs = input.items.map((unit) => ({
        ...structuredClone(unit),
        schema: 'corely.mailroom.outbound-stock.v1' as const,
        actorId: input.actorId,
        entityId: input.entityId,
        orderId: input.orderId,
        requestId: input.requestId,
        sourceCaseId: input.sourceCaseId,
        caseType: input.caseType,
        postingId: randomUUID(),
        requestHash: 'a'.repeat(64),
        referenceType: 'AFTER_SALES_OUTBOUND' as const,
        externalInventoryPosted: false as const,
      }));
      state.outs.push(...proofs);
      trace.push('stock.OUT');
      return { items: structuredClone(proofs) };
    }),
    verify: jest.fn(async (_tx: unknown, input: OutboundStockVerifyInput) => {
      trace.push('stock.verify');
      return input.items.map((unit) => {
        const proof = state.outs.find(
          (proof) =>
            proof.unitId === unit.unitId &&
            proof.postingId === unit.postingId &&
            proof.orderId === input.orderId,
        );
        if (!proof) throw new ConflictException('fixture missing OUT proof');
        return structuredClone(proof);
      });
    }),
  };
  const gateway = { sendToUser: jest.fn() };
  const service = new MailroomOutboundService(
    db as unknown as PrismaService,
    mailroom as unknown as MailroomService,
    sync as unknown as MailroomSyncService,
    stock as unknown as MailroomOutboundStockService,
    gateway as unknown as NotificationGateway,
  );
  return {
    service,
    mailroom,
    db,
    tx,
    sync,
    stock,
    gateway,
    trace,
    actors,
    employees,
    source,
    get state() {
      return state;
    },
    fail: (at: typeof failAt) => {
      failAt = at;
    },
    lock: (hook: typeof onLock) => {
      onLock = hook;
    },
    sourceHook: (hook: typeof sourceReadHook) => {
      sourceReadHook = hook;
    },
    row: (id: string) => state.orders.find((row) => row.id === id)!,
    seedOrder(units: OutboundUnit[], status = 'PENDING_PICK') {
      const row = {
        id: randomUUID(),
        entityId: COMPANY,
        sourceCaseId: source.id,
        sourceNumber: source.number,
        caseType: source.type,
        sourceVersion: source.version,
        status,
        version: 1,
        items: structuredClone(units),
        sourceSnapshot: structuredClone(source),
        createdById: CREATOR,
        requestId: randomUUID(),
        requestHash: 'seed',
        custodianId: null,
        nextUserId: null,
        stockRequestId: null,
        outboundShipment: null,
        location: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      state.orders.push(row);
      return row;
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
function command(
  f: Fixture,
  id: string,
  action: OutboundCommandDto['action'],
  extra: Partial<OutboundCommandDto> = {},
): OutboundCommandDto {
  return {
    entityId: COMPANY,
    requestId: randomUUID(),
    expectedVersion: f.row(id).version,
    action,
    ...extra,
  };
}
function preparation(
  f: Fixture,
  id: string,
  nextUserId = CLERK,
): OutboundCommandDto {
  return command(f, id, 'prepare', {
    confirmedItems: true,
    location: 'P1',
    nextUserId,
    items: (f.row(id).items as OutboundUnit[]).map((unit) => ({
      unitId: unit.unitId,
      productId: 'product-a',
      warehouseId: 'warehouse-a',
      sku: unit.sku,
    })),
  });
}
async function ready(f: Fixture, quantity = 2) {
  const input = creation(quantity),
    result = await f.service.create(CREATOR, input);
  const prepare = preparation(f, result.id);
  await f.service.command(PICKER, result.id, prepare);
  const accept = command(f, result.id, 'accept', {
    confirmedItems: true,
    location: 'A1',
  });
  await f.service.command(CLERK, result.id, accept);
  return { id: result.id, input, prepare, accept };
}

describe('native outbound physical chain using a rollback fixture', () => {
  it.each(['RESHIPMENT', 'PRIVATE_PURCHASE', 'EXCHANGE_RETURN'] as const)(
    'creates, posts OUT, personally accepts and dispatches %s as independent physical events',
    async (type) => {
      const f = fixture(sourceOrder(type)),
        result = await ready(f, 2);
      expect(f.row(result.id)).toMatchObject({
        status: 'READY_FOR_DISPATCH',
        custodianId: CLERK,
        nextUserId: null,
        version: 3,
      });
      expect(f.state.outs).toHaveLength(2);
      expect(f.stock.issue).toHaveBeenCalledTimes(1);
      expect(f.state.notifications).toHaveLength(1);
      expect(f.gateway.sendToUser).toHaveBeenCalledWith(
        CLERK,
        expect.objectContaining({ category: 'mailroom' }),
      );
      const dispatch = command(f, result.id, 'dispatch', {
        confirmedItems: true,
        carrier: 'SYNTHETIC',
        trackingNumber: 'SYNTHETIC-T1',
      });
      await f.service.command(CLERK, result.id, dispatch);
      expect(f.row(result.id).status).toBe('DISPATCHED');
      expect(f.stock.issue).toHaveBeenCalledTimes(1);
      expect(f.state.deliveries).toHaveLength(2);
      const ids = f.state.deliveries.map((row) => row.eventId);
      expect(new Set(ids).size).toBe(2);
      for (const delivery of f.state.deliveries) {
        expect(delivery.target).toBe('AFTER_SALES');
        expect(delivery.payload).toMatchObject({
          schema: DISPATCH_SCHEMA,
          receiptId: result.id,
          sourceVersion: VERSION,
          actor: { id: CLERK },
          itemId: delivery.itemId,
          shipment: {
            purpose: type,
            quantity: 1,
            stock: { externalInventoryPosted: false },
          },
        });
      }
      expect(f.state.actions.map((row) => row.action)).toEqual([
        'create',
        'prepare',
        'accept',
        'dispatch',
      ]);
    },
  );
  it('unions Source-ACKed IDs with native allocations without double-counting one ACKed unit', async () => {
    const source = sourceOrder('RESHIPMENT', 3),
      first = randomUUID(),
      second = randomUUID();
    source.items[0].dispatchedQuantity = 1;
    source.items[0].dispatchedUnitIds = [first];
    const f = fixture(source);
    f.seedOrder(
      [first, second].map((unitId) => ({
        unitId,
        sourceCaseItemId: 'line-a',
        productName: 'SYNTHETIC Product',
        sku: 'SYNTHETIC-SKU',
        quantity: 1,
      })),
    );
    await f.service.create(CREATOR, creation(1));
    await expect(f.service.create(CREATOR, creation(1))).rejects.toThrow(
      ConflictException,
    );
    expect(f.state.orders).toHaveLength(2);
    expect(f.state.outs).toHaveLength(0);
  });
  it('includes unmapped legacy dispatch quantity and excludes only cancelled native plans', async () => {
    const source = sourceOrder('PRIVATE_PURCHASE', 3);
    source.items[0].dispatchedQuantity = 1;
    const f = fixture(source);
    const old = f.seedOrder(
      [
        {
          unitId: randomUUID(),
          sourceCaseItemId: 'line-a',
          productName: 'SYNTHETIC Product',
          sku: 'SYNTHETIC-SKU',
          quantity: 1,
        },
      ],
      'CANCELLED',
    );
    const result = await f.service.create(CREATOR, creation(2));
    expect(result.id).not.toBe(old.id);
    await expect(f.service.create(CREATOR, creation(1))).rejects.toThrow(
      ConflictException,
    );
  });
  it('serializes competing partial allocations instead of assigning beyond Source capacity', async () => {
    const f = fixture(sourceOrder('RESHIPMENT', 3));
    const results = await Promise.allSettled([
      f.service.create(CREATOR, creation(2)),
      f.service.create(CREATOR, creation(2)),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(f.state.orders).toHaveLength(1);
    expect(f.state.actions).toHaveLength(1);
  });
  it.each(['version', 'gate', 'line'] as const)(
    'blocks a current Source %s change before physical preparation',
    async (change) => {
      const f = fixture(),
        { id } = await f.service.create(CREATOR, creation());
      if (change === 'version') f.source.version = '2026-10-13T02:00:00.000Z';
      if (change === 'gate') {
        f.source.dispatchAllowed = false;
        f.source.blockReason = '待客服確認';
      }
      if (change === 'line') f.source.items[0].sku = 'CHANGED-SKU';
      await expect(
        f.service.command(PICKER, id, preparation(f, id)),
      ).rejects.toThrow(ConflictException);
      expect(f.row(id).status).toBe('PENDING_PICK');
      expect(f.state.outs).toHaveLength(0);
      expect(f.state.actions).toHaveLength(1);
    },
  );
  it('rejects a Source version change while waiting to acquire the allocation lock', async () => {
    const f = fixture();
    f.lock(() => {
      f.source.version = '2026-10-13T02:00:00.000Z';
    });
    await expect(f.service.create(CREATOR, creation())).rejects.toThrow(
      ConflictException,
    );
    expect(f.state.orders).toHaveLength(0);
    expect(f.state.actions).toHaveLength(0);
  });
  it.each(['gate', 'line'] as const)(
    'rejects a changed Source %s after the physical action lock, before OUT',
    async (change) => {
      const f = fixture(),
        { id } = await f.service.create(CREATOR, creation());
      f.lock(() => {
        if (change === 'gate') {
          f.source.dispatchAllowed = false;
          f.source.blockReason = '已撤回放行';
        } else f.source.items[0].sku = 'CHANGED-SKU';
      });
      await expect(
        f.service.command(PICKER, id, preparation(f, id)),
      ).rejects.toThrow(ConflictException);
      expect(f.row(id).status).toBe('PENDING_PICK');
      expect(f.state.outs).toHaveLength(0);
    },
  );
  it.each(['no-read', 'foreign', 'disabled'] as const)(
    'requires company/read/enabled authority before Source IO (%s)',
    async (variant) => {
      const f = fixture();
      const actor = variant === 'foreign' ? 'foreign-clerk' : CREATOR;
      if (variant === 'no-read')
        f.actors.get(CREATOR)!.permissions.delete('mailroom:read');
      if (variant === 'disabled')
        f.mailroom.enabled.mockImplementation(() => {
          throw new ForbiddenException('disabled');
        });
      await expect(f.service.create(actor, creation())).rejects.toThrow(
        ForbiddenException,
      );
      expect(f.sync.outboundOrders).not.toHaveBeenCalled();
      expect(f.state.orders).toHaveLength(0);
    },
  );
  it('requires stock-write qualification and literal physical confirmation', async () => {
    const f = fixture(),
      { id } = await f.service.create(CREATOR, creation());
    await expect(
      f.service.command(CREATOR, id, preparation(f, id)),
    ).rejects.toThrow(ForbiddenException);
    const missing = preparation(f, id);
    delete missing.confirmedItems;
    await expect(f.service.command(PICKER, id, missing)).rejects.toThrow(
      BadRequestException,
    );
    const falseValue = preparation(f, id);
    falseValue.confirmedItems = false;
    await expect(f.service.command(PICKER, id, falseValue)).rejects.toThrow(
      BadRequestException,
    );
    expect(f.stock.issue).not.toHaveBeenCalled();
    expect(f.state.actions).toHaveLength(1);
  });
  it.each(['foreign', 'inactive', 'no-write'] as const)(
    'requires a same-company active authorized handoff recipient (%s)',
    async (variant) => {
      const f = fixture(),
        { id } = await f.service.create(CREATOR, creation());
      const target = variant === 'foreign' ? 'foreign-clerk' : CLERK;
      if (variant === 'inactive') f.employees.get(CLERK)!.isActive = false;
      if (variant === 'no-write')
        f.actors.get(CLERK)!.permissions.delete('mailroom:update');
      await expect(
        f.service.command(PICKER, id, preparation(f, id, target)),
      ).rejects.toThrow(ForbiddenException);
      expect(f.stock.issue).not.toHaveBeenCalled();
      expect(f.state.notifications).toHaveLength(0);
    },
  );
  it('rechecks current stock permission and employee status after an asynchronous read', async () => {
    const f = fixture(),
      { id } = await f.service.create(CREATOR, creation());
    f.lock(() => {
      f.actors.get(PICKER)!.permissions.delete('inventory:update');
    });
    await expect(
      f.service.command(PICKER, id, preparation(f, id)),
    ).rejects.toThrow(ForbiddenException);
    expect(f.state.outs).toHaveLength(0);
    f.actors.get(PICKER)!.permissions.add('inventory:update');
    f.employees.get(PICKER)!.isActive = false;
    await expect(
      f.service.command(PICKER, id, preparation(f, id)),
    ).rejects.toThrow(ForbiddenException);
  });
  it.each(['create', 'prepare'] as const)(
    'rechecks %s write authority after the locked Source refresh',
    async (action) => {
      const f = fixture();
      const id =
        action === 'prepare'
          ? (await f.service.create(CREATOR, creation())).id
          : null;
      let reads = 0;
      f.sourceHook(() => {
        if (++reads === 2)
          f.actors
            .get(action === 'create' ? CREATOR : PICKER)!
            .permissions.delete(
              action === 'create' ? 'mailroom:update' : 'inventory:update',
            );
      });
      const before = structuredClone(f.state);
      await expect(
        action === 'create'
          ? f.service.create(CREATOR, creation())
          : f.service.command(PICKER, id!, preparation(f, id!)),
      ).rejects.toThrow(ForbiddenException);
      expect(reads).toBe(2);
      expect(f.state).toEqual(before);
      expect(f.stock.issue).not.toHaveBeenCalled();
    },
  );
  it('only permits the selected recipient to accept and the current custodian to dispatch', async () => {
    const f = fixture(),
      { id } = await f.service.create(CREATOR, creation());
    await f.service.command(PICKER, id, preparation(f, id));
    await expect(
      f.service.command(
        OTHER,
        id,
        command(f, id, 'accept', { confirmedItems: true, location: 'A1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
    await f.service.command(
      CLERK,
      id,
      command(f, id, 'accept', { confirmedItems: true, location: 'A1' }),
    );
    await expect(
      f.service.command(
        OTHER,
        id,
        command(f, id, 'dispatch', {
          confirmedItems: true,
          carrier: 'SYNTHETIC',
          trackingNumber: 'T1',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(f.row(id).custodianId).toBe(CLERK);
    expect(f.state.deliveries).toHaveLength(0);
  });
  it.each(['missing', 'duplicated', 'sku'] as const)(
    'refuses incomplete or changed prepared identity (%s)',
    async (variant) => {
      const f = fixture(),
        { id } = await f.service.create(CREATOR, creation(2));
      const input = preparation(f, id);
      if (variant === 'missing') input.items!.pop();
      if (variant === 'duplicated') input.items![1] = { ...input.items![0] };
      if (variant === 'sku') input.items![0].sku = 'CLIENT-SKU';
      await expect(f.service.command(PICKER, id, input)).rejects.toThrow(
        BadRequestException,
      );
      expect(f.stock.issue).not.toHaveBeenCalled();
      expect(f.state.actions).toHaveLength(1);
    },
  );
  it.each(['accept', 'dispatch'] as const)(
    'refuses %s when persisted OUT proof is missing',
    async (action) => {
      const f = fixture(),
        { id } = await f.service.create(CREATOR, creation());
      await f.service.command(PICKER, id, preparation(f, id));
      if (action === 'dispatch')
        await f.service.command(
          CLERK,
          id,
          command(f, id, 'accept', { confirmedItems: true, location: 'A1' }),
        );
      f.state.outs.splice(0);
      const before = structuredClone(f.state);
      await expect(
        f.service.command(
          CLERK,
          id,
          command(
            f,
            id,
            action,
            action === 'accept'
              ? { confirmedItems: true, location: 'A1' }
              : {
                  confirmedItems: true,
                  carrier: 'SYNTHETIC',
                  trackingNumber: 'T1',
                },
          ),
        ),
      ).rejects.toThrow(ConflictException);
      expect(f.state).toEqual(before);
      expect(f.stock.issue).toHaveBeenCalledTimes(1);
    },
  );
  it('adopts a fresh allowed Source version without repeating OUT or altering prepared physical custody', async () => {
    const f = fixture(),
      { id } = await ready(f, 2);
    const previous = structuredClone(f.row(id)),
      counts = { outs: f.state.outs.length, history: f.state.actions.length };
    f.source.version = '2026-10-13T02:00:00.000Z';
    const refresh = command(f, id, 'refresh_source');
    await f.service.command(CLERK, id, refresh);
    expect(f.row(id)).toMatchObject({
      sourceVersion: f.source.version,
      status: previous.status,
      custodianId: previous.custodianId,
      location: previous.location,
      stockRequestId: previous.stockRequestId,
    });
    expect(f.row(id).items).toEqual(previous.items);
    expect(f.state.outs).toHaveLength(counts.outs);
    expect(f.stock.issue).toHaveBeenCalledTimes(1);
    const sourceReads = f.sync.outboundOrders.mock.calls.length;
    expect(await f.service.command(CLERK, id, refresh)).toMatchObject({
      duplicate: true,
    });
    expect(f.sync.outboundOrders).toHaveBeenCalledTimes(sourceReads);
    expect(f.state.actions).toHaveLength(counts.history + 1);
  });
  it.each(['type', 'quantity'] as const)(
    'blocks refresh_source when Source %s invalidates prepared units',
    async (change) => {
      const f = fixture(),
        { id } = await ready(f, 2),
        before = structuredClone(f.state);
      f.source.version = '2026-10-13T02:00:00.000Z';
      if (change === 'type') f.source.type = 'PRIVATE_PURCHASE';
      else f.source.items[0].quantity = 1;
      await expect(
        f.service.command(CLERK, id, command(f, id, 'refresh_source')),
      ).rejects.toThrow(ConflictException);
      expect(f.state).toEqual(before);
      expect(f.stock.issue).toHaveBeenCalledTimes(1);
    },
  );
  it('exact UUID retries perform no new Source read, OUT, history or deliveries; altered content conflicts', async () => {
    const f = fixture(),
      result = await ready(f);
    const dispatch = command(f, result.id, 'dispatch', {
      confirmedItems: true,
      carrier: 'SYNTHETIC',
      trackingNumber: 'T1',
    });
    await f.service.command(CLERK, result.id, dispatch);
    const counts = {
      source: f.sync.outboundOrders.mock.calls.length,
      outs: f.state.outs.length,
      history: f.state.actions.length,
      deliveries: f.state.deliveries.length,
      verify: f.stock.verify.mock.calls.length,
    };
    expect(await f.service.create(CREATOR, result.input)).toMatchObject({
      duplicate: true,
      id: result.id,
    });
    for (const [user, input] of [
      [PICKER, result.prepare],
      [CLERK, result.accept],
      [CLERK, dispatch],
    ] as const)
      expect(await f.service.command(user, result.id, input)).toMatchObject({
        duplicate: true,
        id: result.id,
      });
    expect({
      source: f.sync.outboundOrders.mock.calls.length,
      outs: f.state.outs.length,
      history: f.state.actions.length,
      deliveries: f.state.deliveries.length,
      verify: f.stock.verify.mock.calls.length,
    }).toEqual(counts);
    await expect(
      f.service.create(CREATOR, {
        ...result.input,
        lines: [{ sourceCaseItemId: 'line-a', quantity: 1 }],
      }),
    ).rejects.toThrow(ConflictException);
    await expect(
      f.service.command(CLERK, result.id, {
        ...dispatch,
        trackingNumber: 'CHANGED',
      }),
    ).rejects.toThrow(ConflictException);
    expect(f.sync.outboundOrders).toHaveBeenCalledTimes(counts.source);
  });
  it('does not allow a completed command UUID to become a new create operation', async () => {
    const f = fixture(),
      { id } = await f.service.create(CREATOR, creation());
    const cancel = command(f, id, 'cancel');
    await f.service.command(CREATOR, id, cancel);
    await expect(
      f.service.create(CREATOR, { ...creation(), requestId: cancel.requestId }),
    ).rejects.toThrow(ConflictException);
    expect(f.state.orders).toHaveLength(1);
    expect(f.state.actions).toHaveLength(2);
  });
  it('atomically restores order, first inserted outbox and history after an outbox failure', async () => {
    const f = fixture(),
      { id } = await ready(f);
    const before = structuredClone(f.state);
    f.fail('delivery');
    await expect(
      f.service.command(
        CLERK,
        id,
        command(f, id, 'dispatch', {
          confirmedItems: true,
          carrier: 'SYNTHETIC',
          trackingNumber: 'T1',
        }),
      ),
    ).rejects.toThrow('injected outbox');
    expect(f.trace).toEqual(
      expect.arrayContaining(['delivery.create', 'tx.rollback']),
    );
    expect(f.state).toEqual(before);
    expect(f.row(id).status).toBe('READY_FOR_DISPATCH');
  });
  it.each(['notification', 'missing-location'] as const)(
    'rolls OUT and handoff back when preparation fails after stock.issue (%s)',
    async (variant) => {
      const f = fixture(),
        { id } = await f.service.create(CREATOR, creation());
      const before = structuredClone(f.state);
      const input = preparation(f, id);
      if (variant === 'notification') f.fail('notification');
      else delete input.location;
      await expect(f.service.command(PICKER, id, input)).rejects.toThrow();
      expect(f.trace).toContain('stock.OUT');
      expect(f.trace).toContain('tx.rollback');
      expect(f.state).toEqual(before);
      expect(f.gateway.sendToUser).not.toHaveBeenCalled();
    },
  );
  it('retains a committed handoff notification when the websocket is unavailable', async () => {
    const f = fixture(),
      { id } = await f.service.create(CREATOR, creation());
    f.gateway.sendToUser.mockImplementation(() => {
      throw new Error('offline websocket');
    });
    await f.service.command(PICKER, id, preparation(f, id));
    expect(f.row(id).status).toBe('WAITING_MAILROOM_ACCEPTANCE');
    expect(f.state.notifications).toHaveLength(1);
    expect(f.state.outs).toHaveLength(1);
  });
  it('does not treat a legacy progress delivery as acknowledgment of the new dispatch', async () => {
    const f = fixture(),
      { id } = await ready(f, 1);
    await f.service.command(
      CLERK,
      id,
      command(f, id, 'dispatch', {
        confirmedItems: true,
        carrier: 'SYNTHETIC',
        trackingNumber: 'T1',
      }),
    );
    const current = f.state.deliveries[0];
    f.state.deliveries.push({
      ...structuredClone(current),
      id: randomUUID(),
      eventId: randomUUID(),
      status: 'DELIVERED',
      payload: { schema: 'corely.mailroom.v1', receiptId: id },
    });
    expect((await f.service.detail(CLERK, COMPANY, id)).sourceSync.status).toBe(
      'PENDING',
    );
    current.status = 'DELIVERED';
    expect((await f.service.detail(CLERK, COMPANY, id)).sourceSync.status).toBe(
      'DELIVERED',
    );
  });
  it('retry_sync only reschedules the immutable dispatch IDs, does not OUT or create new events and is idempotent', async () => {
    const f = fixture(),
      { id } = await ready(f, 1);
    await f.service.command(
      CLERK,
      id,
      command(f, id, 'dispatch', {
        confirmedItems: true,
        carrier: 'SYNTHETIC',
        trackingNumber: 'T1',
      }),
    );
    const current = f.state.deliveries[0],
      foreign = {
        ...structuredClone(current),
        id: randomUUID(),
        eventId: randomUUID(),
        payload: { schema: 'corely.mailroom.v1' },
      };
    f.state.deliveries.push(foreign);
    const foreignBefore = structuredClone(foreign),
      eventBefore = structuredClone(current.payload);
    const outCount = f.state.outs.length,
      reads = f.sync.outboundOrders.mock.calls.length,
      history = f.state.actions.length;
    const retry = command(f, id, 'retry_sync');
    await f.service.command(CLERK, id, retry);
    expect(current.nextAttemptAt.getFullYear()).toBeLessThan(2099);
    expect(foreign).toEqual(foreignBefore);
    expect(current.payload).toEqual(eventBefore);
    expect(f.state.deliveries).toHaveLength(2);
    expect(f.state.outs).toHaveLength(outCount);
    expect(f.sync.outboundOrders).toHaveBeenCalledTimes(reads);
    expect(f.state.actions).toHaveLength(history + 1);
    await f.service.command(CLERK, id, retry);
    expect(f.state.actions).toHaveLength(history + 1);
    expect(f.state.outs).toHaveLength(outCount);
  });
  it('retry_sync leaves delivered and actively leased original events untouched', async () => {
    const f = fixture(),
      { id } = await ready(f, 3);
    await f.service.command(
      CLERK,
      id,
      command(f, id, 'dispatch', {
        confirmedItems: true,
        carrier: 'SYNTHETIC',
        trackingNumber: 'T1',
      }),
    );
    const [pending, delivered, leased] = f.state.deliveries;
    delivered.status = 'DELIVERED';
    leased.leaseUntil = new Date('2099-01-01T00:00:00.000Z');
    const deliveredBefore = structuredClone(delivered),
      leasedBefore = structuredClone(leased);
    await f.service.command(CLERK, id, command(f, id, 'retry_sync'));
    expect(pending.nextAttemptAt.getFullYear()).toBeLessThan(2099);
    expect(delivered).toEqual(deliveredBefore);
    expect(leased).toEqual(leasedBefore);
    expect(f.state.deliveries).toHaveLength(3);
    expect(f.stock.issue).toHaveBeenCalledTimes(1);
  });
});
