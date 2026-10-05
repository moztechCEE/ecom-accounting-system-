/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { MailroomService } from './mailroom.service';
import { type Actor, type SourceCase } from './mailroom.contract';
import { CreateReceiptDto, MailroomCommandDto } from './mailroom.dto';

describe('one physical native row per external source line capacity', () => {
  let service: MailroomService, db: any, sync: any, source: SourceCase;
  let receipts: any[], pieces: any[], actions: any[];
  const enabled = process.env.MAILROOM_ENABLED;
  const actor = (id: string): Actor => ({
    id,
    name: 'SYNTHETIC CLERK',
    entityIds: ['company'],
    permissions: new Set([
      'mailroom:create',
      'mailroom:read',
      'mailroom:update',
    ]),
  });
  const request = (id: string, lines = ['line-a']): CreateReceiptDto => ({
    entityId: 'company',
    category: 'RETURN',
    sourceCaseId: 'source-case',
    requestId: id,
    location: 'SYNTHETIC CLERK AREA',
    items: lines.map((sourceItemId, index) => ({
      sourceItemId,
      productName: 'SYNTHETIC RETURN',
      sku: 'SYNTHETIC-SKU',
      serialNumber: 'SYNTHETIC-SN-' + index,
    })),
  });
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
    receipts = [];
    pieces = [];
    actions = [];
    source = {
      id: 'source-case',
      number: 'SYNTHETIC-CASE',
      type: 'RETURN',
      brand: 'SYNTHETIC',
      version: '1',
      status: 'PENDING_RECEIPT',
      repairAllowed: false,
      customerLabel: 'SYNTHETIC',
      items: [
        {
          id: 'line-a',
          name: 'SYNTHETIC',
          sku: 'SYNTHETIC-SKU',
          serialNumber: null,
          quantity: 2,
        },
        {
          id: 'line-b',
          name: 'SYNTHETIC',
          sku: 'SYNTHETIC-SKU',
          serialNumber: null,
          quantity: 1,
        },
      ],
    };
    sync = {
      cases: jest.fn(async () => ({ items: [structuredClone(source)] })),
    };
    db = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(async (sql) => {
        if (!sql.sql.includes('COUNT(*)')) return [];
        const [entityId, , sourceCaseId, lineId, excludeId] = sql.values;
        return [
          {
            received: BigInt(
              pieces.filter(
                (piece) =>
                  piece.entityId === entityId &&
                  piece.receipt.entityId === entityId &&
                  piece.receipt.sourceCaseId === sourceCaseId &&
                  piece.declared?.id === lineId &&
                  piece.id !== excludeId,
              ).length,
            ),
          },
        ];
      }),
      mailroomReceipt: {
        findUnique: jest.fn(async ({ where }) => {
          const key = where.entityId_receivedById_requestId;
          const row = receipts.find(
            (receipt) =>
              receipt.entityId === key.entityId &&
              receipt.receivedById === key.receivedById &&
              receipt.requestId === key.requestId,
          );
          return row
            ? {
                ...row,
                items: pieces.filter((piece) => piece.receiptId === row.id),
              }
            : null;
        }),
        create: jest.fn(async ({ data }) => {
          const row = { ...data, id: 'receipt-' + receipts.length };
          receipts.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }) => {
          const row = receipts.find((receipt) => receipt.id === where.id);
          Object.assign(row, data);
          return row;
        }),
      },
      mailroomItem: {
        create: jest.fn(async ({ data }) => {
          const row = {
            ...data,
            id: 'native-' + pieces.length,
            version: 1,
            receipt: receipts.find((receipt) => receipt.id === data.receiptId),
          };
          pieces.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }) =>
          pieces.find((piece) => piece.id === where.id),
        ),
        findUniqueOrThrow: jest.fn(async ({ where }) =>
          pieces.find((piece) => piece.id === where.id),
        ),
        count: jest.fn(
          async ({ where }) =>
            pieces.filter((piece) => piece.receiptId === where.receiptId)
              .length,
        ),
        update: jest.fn(async ({ where, data }) => {
          const row = pieces.find((piece) => piece.id === where.id);
          Object.assign(row, data, { version: row.version + 1 });
          return row;
        }),
      },
      mailroomAction: {
        findUnique: jest.fn(async ({ where }) => {
          const key = where.entityId_actorId_requestId;
          return (
            actions.find(
              (action) =>
                action.actorId === key.actorId &&
                action.requestId === key.requestId &&
                action.entityId === key.entityId,
            ) || null
          );
        }),
      },
    };
    let queue = Promise.resolve();
    db.$transaction = jest.fn((fn) => {
      const run = queue.then(async () => {
        const before = structuredClone({ receipts, pieces, actions });
        try {
          return await fn(db);
        } catch (error) {
          receipts = before.receipts;
          pieces = before.pieces;
          actions = before.actions;
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    });
    service = new MailroomService(db, {} as any, sync);
    jest
      .spyOn(service as any, 'actor')
      .mockImplementation(async (id) => actor(String(id)));
    jest
      .spyOn(service, 'record')
      .mockImplementation(
        async (_tx, acting, item, action, requestId, requestHash) => {
          actions.push({
            actorId: acting.id,
            entityId: item.entityId,
            itemId: item.id,
            action,
            requestId,
            requestHash,
          });
          return [];
        },
      );
    jest.spyOn(service, 'publish').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (enabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = enabled;
  });
  test('a quantity-two declaration produces two independent physical rows; third receipt and batch three are rejected without writes', async () => {
    const received = await service.create(
      'clerk',
      request('request-1', ['line-a', 'line-a']),
    );
    expect(new Set(received.itemIds).size).toBe(2);
    expect(pieces.map((piece) => piece.declared.quantity)).toEqual([2, 2]);
    await expect(
      service.create('other-clerk', request('request-2')),
    ).rejects.toThrow('超過來源申報數量');
    expect(receipts).toHaveLength(1);
    expect(pieces).toHaveLength(2);
    expect(actions).toHaveLength(2);
    await expect(
      service.create(
        'clerk',
        request('request-3', ['line-b', 'line-b', 'line-b']),
      ),
    ).rejects.toThrow('超過來源申報數量');
    expect(receipts).toHaveLength(1);
  });
  test('two concurrent clerks compete for the final source slot; one receives it and one is rejected', async () => {
    source.items[0].quantity = 1;
    const outcomes = await Promise.allSettled([
      service.create('clerk-1', request('request-1')),
      service.create('clerk-2', request('request-2')),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    expect(pieces).toHaveLength(1);
    const locks = db.$executeRaw.mock.calls
      .map(([sql]) => sql.values[0])
      .filter((key) => key.includes('mailroom-source-line'));
    expect(new Set(locks)).toEqual(
      new Set(['company:mailroom-source-line:source-case:line-a']),
    );
  });
  test('exact committed receipt replays during source outage; changed body conflicts before another read or write', async () => {
    const input = request('request-1');
    const first = await service.create('clerk', input);
    sync.cases.mockRejectedValue(new Error('SYNTHETIC SOURCE UNAVAILABLE'));
    sync.cases.mockClear();
    expect(await service.create('clerk', input)).toEqual({
      ...first,
      duplicate: true,
    });
    await expect(
      service.create('clerk', { ...input, location: 'CHANGED' }),
    ).rejects.toThrow('內容不同');
    expect(sync.cases).not.toHaveBeenCalled();
    expect(pieces).toHaveLength(1);
  });
  test('fresh signed source read under capacity lock rejects a reduced quantity or unavailable source before creating a receipt', async () => {
    const baseline = structuredClone(source);
    const reduced = structuredClone(source);
    reduced.items[0].quantity = 1;
    sync.cases
      .mockResolvedValueOnce({ items: [baseline] })
      .mockResolvedValueOnce({ items: [reduced] });
    await expect(
      service.create('clerk', request('request-1', ['line-a', 'line-a'])),
    ).rejects.toThrow('超過來源申報數量');
    sync.cases
      .mockResolvedValueOnce({ items: [baseline] })
      .mockRejectedValueOnce(new Error('SYNTHETIC SOURCE UNAVAILABLE'));
    await expect(service.create('clerk', request('request-2'))).rejects.toThrow(
      'SOURCE UNAVAILABLE',
    );
    expect(db.mailroomReceipt.create).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });
  test.each([0, -1, 1.5, Number.NaN])(
    'invalid source total %s rejects every native receipt',
    async (quantity) => {
      source.items[0].quantity = quantity;
      await expect(
        service.create('clerk', request('request-1')),
      ).rejects.toThrow('正整數');
      expect(pieces).toHaveLength(0);
    },
  );
  test('foreign source response and actor company mismatch cannot consume local capacity', async () => {
    source.id = 'foreign-case';
    await expect(service.create('clerk', request('request-1'))).rejects.toThrow(
      '類別不符',
    );
    source.id = 'source-case';
    await expect(
      service.create('clerk', {
        ...request('request-2'),
        entityId: 'foreign-company',
      }),
    ).rejects.toThrow();
    expect(pieces).toHaveLength(0);
  });
  test('multiple-line locks are sorted independent of form order', async () => {
    await service.create('clerk', request('request-1', ['line-b', 'line-a']));
    const locks = db.$executeRaw.mock.calls
      .map(([sql]) => sql.values[0])
      .filter((key) => key.includes('mailroom-source-line'));
    expect(locks).toEqual([
      'company:mailroom-source-line:source-case:line-a',
      'company:mailroom-source-line:source-case:line-b',
    ]);
  });
  test('identification shares capacity and exact idempotency with direct source intake', async () => {
    source.items[0].quantity = 1;
    const unknown = await service.create('clerk', {
      ...request('unknown'),
      category: 'UNMATCHED',
      sourceCaseId: undefined,
      items: [{ productName: 'SYNTHETIC UNKNOWN' }],
    });
    const command: MailroomCommandDto = {
      entityId: 'company',
      requestId: 'identify-1',
      action: 'identify',
      targetCategory: 'RETURN',
      sourceCaseId: 'source-case',
      sourceItemId: 'line-a',
      expectedVersion: 1,
      note: 'SYNTHETIC VERIFIED SOURCE',
    };
    await service.command('clerk', unknown.itemIds[0], command);
    expect(pieces[0].declared.id).toBe('line-a');
    await expect(service.create('clerk', request('over-cap'))).rejects.toThrow(
      '超過來源申報數量',
    );
    sync.cases.mockClear();
    sync.cases.mockRejectedValue(new Error('SYNTHETIC SOURCE UNAVAILABLE'));
    expect(
      (await service.command('clerk', unknown.itemIds[0], command)).duplicate,
    ).toBe(true);
    expect(sync.cases).not.toHaveBeenCalled();
  });
  test('identification cannot bypass a line already received by another clerk', async () => {
    source.items[0].quantity = 1;
    await service.create('clerk', request('known'));
    const unknown = await service.create('clerk', {
      ...request('unknown'),
      category: 'UNMATCHED',
      sourceCaseId: undefined,
      items: [{ productName: 'SYNTHETIC UNKNOWN' }],
    });
    await expect(
      service.command('clerk', unknown.itemIds[0], {
        entityId: 'company',
        requestId: 'identify-1',
        action: 'identify',
        targetCategory: 'RETURN',
        sourceCaseId: 'source-case',
        sourceItemId: 'line-a',
        expectedVersion: 1,
        note: 'SYNTHETIC',
      }),
    ).rejects.toThrow('超過來源申報數量');
    expect(pieces[1].receipt.category).toBe('UNMATCHED');
    expect(pieces[1].declared).toBeUndefined();
  });
});
