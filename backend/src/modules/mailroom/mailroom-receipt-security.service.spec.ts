/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { type Actor, type SourceCase } from './mailroom.contract';
import { MailroomService } from './mailroom.service';
import { CreateReceiptDto } from './mailroom.dto';

const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';
const SOURCE: SourceCase = {
  id: 'source',
  number: 'CASE-SYNTHETIC',
  version: 'v1',
  type: 'REPAIR',
  brand: 'Synthetic',
  status: 'NEW',
  repairAllowed: false,
  customerLabel: 'Synthetic',
  items: [
    {
      id: 'declared',
      name: 'DECLARED ORIGINAL',
      sku: 'DECLARED-SKU',
      serialNumber: 'DECLARED-SN',
      quantity: 1,
    },
  ],
};
const request = (
  changes: Partial<CreateReceiptDto> = {},
): CreateReceiptDto => ({
  entityId: 'company',
  requestId: 'receipt-request',
  category: 'REPAIR',
  sourceCaseId: 'source',
  sourceVersion: 'v1',
  location: 'A1',
  items: [
    {
      sourceItemId: 'declared',
      productId: 'actual-product',
      productName: 'ACTUAL PRODUCT',
      sku: 'ACTUAL-SKU',
      barcode: '4710000000000',
      serialNumber: 'SCANNED-SN',
      evidence: [PHOTO],
    },
  ],
  ...changes,
});

function fixture() {
  const state = {
    receipts: [] as any[],
    items: [] as any[],
    actions: [] as any[],
    deliveries: [] as any[],
  };
  const db: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(async (sql) =>
      sql.sql.includes('COUNT(*)')
        ? [{ received: BigInt(state.items.length) }]
        : [],
    ),
    product: {
      findFirst: jest.fn().mockResolvedValue({
        name: 'ACTUAL PRODUCT',
        sku: 'ACTUAL-SKU',
        barcode: '4710000000000',
      }),
    },
    mailroomStorageLocation: {
      findFirst: jest.fn(async ({ select }) =>
        select.code
          ? { id: 'bin', rackId: 'rack', code: 'B2', isActive: true }
          : { id: 'bin', rackId: 'rack' },
      ),
    },
    mailroomStorageRack: {
      findFirst: jest.fn().mockResolvedValue({ isActive: true }),
    },
    mailroomReceipt: {
      findUnique: jest.fn(async ({ where }) => {
        const key = where.entityId_receivedById_requestId;
        const receipt = state.receipts.find(
          (row) =>
            row.entityId === key.entityId &&
            row.receivedById === key.receivedById &&
            row.requestId === key.requestId,
        );
        return receipt
          ? {
              ...receipt,
              items: state.items.filter(
                (item) => item.receiptId === receipt.id,
              ),
            }
          : null;
      }),
      create: jest.fn(async ({ data }) => {
        const receipt = {
          ...data,
          id: 'receipt',
          receivedAt: new Date('2026-10-08T00:00:00Z'),
        };
        state.receipts.push(receipt);
        return receipt;
      }),
    },
    mailroomItem: {
      findUnique: jest.fn(async ({ where }) =>
        state.items.find((row) => row.id === where.id),
      ),
      findUniqueOrThrow: jest.fn(async ({ where }) =>
        state.items.find((row) => row.id === where.id),
      ),
      update: jest.fn(async ({ where, data }) => {
        const row = state.items.find((value) => value.id === where.id);
        const version = row.version + data.version.increment;
        Object.assign(row, data, { version });
        return row;
      }),
      create: jest.fn(async ({ data }) => {
        const item = {
          ...data,
          id: 'item-' + state.items.length,
          version: 1,
          matchResult: 'PENDING',
          receipt: state.receipts[0],
        };
        state.items.push(item);
        return item;
      }),
    },
    mailroomAction: {
      findUnique: jest.fn(async ({ where }) => {
        const key = where.entityId_actorId_requestId;
        return (
          state.actions.find(
            (action) =>
              action.entityId === key.entityId &&
              action.actorId === key.actorId &&
              action.requestId === key.requestId,
          ) || null
        );
      }),
      create: jest.fn(async ({ data }) => {
        const action = {
          ...data,
          id: 'action-' + state.actions.length,
          createdAt: new Date('2026-10-08T00:00:00Z'),
        };
        state.actions.push(action);
        return action;
      }),
    },
    mailroomTask: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }) => data),
    },
    mailroomDelivery: {
      createMany: jest.fn(async ({ data }) => {
        state.deliveries.push(...data);
        return { count: data.length };
      }),
    },
    notification: {
      create: jest.fn().mockRejectedValue(new Error('Unexpected notification')),
    },
    inventoryTransaction: {
      create: jest.fn().mockRejectedValue(new Error('Unexpected inventory')),
    },
  };
  db.$transaction = jest.fn(async (work) => {
    const before = structuredClone(state);
    try {
      return await work(db);
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  });
  const sync = {
    cases: jest.fn().mockResolvedValue({ items: [structuredClone(SOURCE)] }),
    deliverPending: jest
      .fn()
      .mockRejectedValue(new Error('Unexpected external delivery')),
  };
  const gateway = {
    sendToUser: jest
      .fn()
      .mockRejectedValue(new Error('Unexpected real notification')),
  };
  const service = new MailroomService(db, gateway as any, sync as any);
  const actor: Actor = {
    id: 'clerk',
    name: 'Synthetic clerk',
    permissions: new Set([
      'mailroom:create',
      'mailroom:read',
      'mailroom:update',
    ]),
    entityIds: ['company'],
  };
  const actorRead = jest.spyOn(service, 'actor').mockResolvedValue(actor);
  const publishMock = jest
    .spyOn(service, 'publish')
    .mockImplementation(() => undefined);
  return { service, db, sync, gateway, state, actorRead, actor, publishMock };
}

describe('receipt atomic version, identity, location and evidence writes', () => {
  const before = process.env.MAILROOM_ENABLED;
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
  });
  afterAll(() => {
    if (before === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = before;
  });

  test('create persists the actual product, scanned SN, photos and current bin while preserving the original declared claim and PENDING inspection', async () => {
    const f = fixture();
    await expect(
      f.service.create(
        'clerk',
        request({ storageLocationId: 'bin', location: 'STALE A1' }),
      ),
    ).resolves.toMatchObject({ duplicate: false });
    expect(f.state.items[0]).toMatchObject({
      productId: 'actual-product',
      productName: 'ACTUAL PRODUCT',
      sku: 'ACTUAL-SKU',
      barcode: '4710000000000',
      serialNumber: 'SCANNED-SN',
      evidence: [PHOTO],
      location: 'B2',
      storageLocationId: 'bin',
      status: 'RECEIVED',
      matchResult: 'PENDING',
      declared: SOURCE.items[0],
    });
    expect(f.state.actions).toHaveLength(1);
    expect(f.state.actions[0]).toMatchObject({
      action: 'receive',
      snapshot: {
        productId: 'actual-product',
        barcode: '4710000000000',
        storageLocationId: 'bin',
        evidence: [PHOTO],
        evidenceCount: 1,
        matchResult: 'PENDING',
      },
    });
    expect(f.state.deliveries[0].payload).toMatchObject({
      inventoryPosted: false,
      refundExecuted: false,
      item: { declared: SOURCE.items[0], evidenceCount: 1 },
    });
    expect(f.state.deliveries[0].payload.item.evidence).toBeUndefined();
    expect(f.gateway.sendToUser).not.toHaveBeenCalled();
    expect(f.sync.deliverPending).not.toHaveBeenCalled();
    expect(f.db.inventoryTransaction.create).not.toHaveBeenCalled();
    const locks = f.db.$queryRaw.mock.calls.map(([sql]) => sql.sql);
    expect(
      locks.findIndex((sql) => sql.includes('mailroom_storage_racks')),
    ).toBeLessThan(
      locks.findIndex((sql) => sql.includes('mailroom_storage_locations')),
    );
  });
  test('a stale selected Source version rejects before receipt creation', async () => {
    const f = fixture();
    f.sync.cases.mockResolvedValueOnce({
      items: [{ ...SOURCE, version: 'v2' }],
    });
    await expect(f.service.create('clerk', request())).rejects.toThrow(
      '已更新',
    );
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.state.receipts).toHaveLength(0);
  });
  test('Source changes between baseline and capacity-locked read roll back without creating a receipt', async () => {
    const f = fixture();
    f.sync.cases
      .mockResolvedValueOnce({ items: [SOURCE] })
      .mockResolvedValueOnce({ items: [{ ...SOURCE, version: 'v2' }] });
    await expect(f.service.create('clerk', request())).rejects.toThrow(
      '已更新',
    );
    expect(f.db.mailroomReceipt.create).not.toHaveBeenCalled();
    expect(f.state.items).toHaveLength(0);
    expect(f.state.actions).toHaveLength(0);
  });
  test('a paused bin or inactive/foreign/stale product stops before any receipt/history/outbox writes', async () => {
    for (const kind of ['bin', 'product'] as const) {
      const f = fixture();
      if (kind === 'bin')
        f.db.mailroomStorageRack.findFirst.mockResolvedValueOnce({
          isActive: false,
        });
      else f.db.product.findFirst.mockResolvedValueOnce(null);
      await expect(
        f.service.create('clerk', request({ storageLocationId: 'bin' })),
      ).rejects.toThrow();
      expect(f.db.mailroomReceipt.create).not.toHaveBeenCalled();
      expect(f.state.actions).toHaveLength(0);
      expect(f.state.deliveries).toHaveLength(0);
    }
  });
  test('fresh actor permission revocation blocks the transaction before physical or catalog writes', async () => {
    const f = fixture();
    f.actorRead.mockResolvedValueOnce(f.actor).mockResolvedValueOnce({
      ...f.actor,
      permissions: new Set(['mailroom:read']),
    });
    await expect(f.service.create('clerk', request())).rejects.toThrow();
    expect(f.db.product.findFirst).not.toHaveBeenCalled();
    expect(f.state.receipts).toHaveLength(0);
  });
  test('exact retry succeeds during Source outage; changed photo, product, Source version or bin conflicts without a second write', async () => {
    const f = fixture();
    const input = request({ storageLocationId: 'bin' });
    const first = await f.service.create('clerk', input);
    f.sync.cases.mockClear();
    f.sync.cases.mockRejectedValue(new Error('Source unavailable'));
    expect(await f.service.create('clerk', input)).toEqual({
      ...first,
      duplicate: true,
    });
    const mutations: CreateReceiptDto[] = [
      { ...input, sourceVersion: 'v2' },
      { ...input, storageLocationId: 'other-bin' },
      { ...input, items: [{ ...input.items[0], productId: 'other-product' }] },
      {
        ...input,
        items: [
          {
            ...input.items[0],
            evidence: ['data:image/png;base64,iVBORw0KGgoA'],
          },
        ],
      },
    ];
    for (const body of mutations)
      await expect(f.service.create('clerk', body)).rejects.toThrow('內容不同');
    expect(f.sync.cases).not.toHaveBeenCalled();
    expect(f.db.mailroomReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.state.items).toHaveLength(1);
    expect(f.state.actions).toHaveLength(1);
    expect(f.state.deliveries).toHaveLength(2);
  });
  test('missing photos and Source version fail before any source/catalog/storage/transaction access', async () => {
    for (const input of [
      request({ sourceVersion: undefined }),
      request({
        items: [{ productName: 'Synthetic', sourceItemId: 'declared' }],
      }),
    ]) {
      const f = fixture();
      await expect(f.service.create('clerk', input)).rejects.toThrow();
      expect(f.sync.cases).not.toHaveBeenCalled();
      expect(f.db.product.findFirst).not.toHaveBeenCalled();
      expect(f.db.$transaction).not.toHaveBeenCalled();
    }
  });
  test('a write failure rolls back the receipt with no persisted history/outbox or publish', async () => {
    const f = fixture();
    f.db.mailroomItem.create.mockRejectedValueOnce(new Error('Write failed'));
    await expect(f.service.create('clerk', request())).rejects.toThrow(
      'Write failed',
    );
    expect(f.state.receipts).toHaveLength(0);
    expect(f.state.items).toHaveLength(0);
    expect(f.state.actions).toHaveLength(0);
    expect(f.state.deliveries).toHaveLength(0);
    expect(f.publishMock).not.toHaveBeenCalled();
  });
  test.each(['move', 'correct', 'accept', 'accept_return'] as const)(
    'actual %s command clears stale structured links through the persisted write',
    async (action) => {
      const f = fixture();
      await f.service.create(
        'clerk',
        request({
          category: 'UNMATCHED',
          sourceCaseId: undefined,
          sourceVersion: undefined,
          storageLocationId: 'bin',
          items: [{ ...request().items[0], sourceItemId: undefined }],
        }),
      );
      const item = f.state.items[0];
      if (action === 'accept' || action === 'accept_return') {
        item.receipt.category = 'REPAIR';
        item.status =
          action === 'accept'
            ? 'WAITING_REPAIR_ACCEPTANCE'
            : 'WAITING_RETURN_ACCEPTANCE';
        item.nextUserId = 'clerk';
        f.actor.permissions.add('repair_workbench:update');
      }
      await f.service.command('clerk', item.id, {
        entityId: 'company',
        requestId: 'command-request',
        expectedVersion: 1,
        action,
        note: 'Synthetic',
        ...(action === 'correct'
          ? { productName: 'CORRECTED', sku: 'CORRECTED-SKU' }
          : { location: 'FREE POSITION', confirmedItems: true }),
      });
      expect(f.state.items[0]).toMatchObject(
        action === 'correct'
          ? { productId: null, barcode: null, storageLocationId: 'bin' }
          : { storageLocationId: null, location: 'FREE POSITION' },
      );
      expect(f.state.actions[1].snapshot).toMatchObject(
        action === 'correct'
          ? { productId: null, barcode: null }
          : { storageLocationId: null },
      );
      expect(f.gateway.sendToUser).not.toHaveBeenCalled();
      expect(f.db.inventoryTransaction.create).not.toHaveBeenCalled();
    },
  );
});
