import 'reflect-metadata';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fingerprint, type Actor, type SourceCase } from './mailroom.contract';
import {
  inspectionPlanHash,
  type InspectionDocument,
} from './repair-document.contract';
import { repairSourceBindingForItem } from './repair-proposal.contract';
import {
  RepairMaterialsService,
  type RepairMaterialAllocationRecord,
} from './repair-materials.service';
import {
  AllocateRepairMaterialDto,
  PhysicalRepairMaterialDto,
  ReleaseRepairMaterialDto,
} from './repair-materials.dto';

const ENTITY = 'materials-company',
  ITEM = 'materials-piece',
  TECH = 'materials-tech',
  STOCK = 'materials-stock';
const clone = <T>(value: T): T => structuredClone(value);
function fixture() {
  const doc: InspectionDocument = {
    number: 'INS-MAT',
    revision: 3,
    status: 'SUBMITTED',
    authorId: TECH,
    authorName: 'Technician',
    updatedAt: '2026-10-13T00:00:00Z',
    data: {
      protocol: 2,
      complaint: 'Power fault',
      reproduction: 'YES',
      testConditions: 'Offline bench',
      checks: [{ name: 'Power', result: 'FAIL', observation: 'No output' }],
      diagnosis: 'Connector fault',
      causeStatus: 'CONFIRMED',
      plan: 'REPAIR',
      planNote: 'Replace connector',
      feeSuggestion: 'PAID',
      estimateAmount: 500,
      estimateNote: 'Confirmed connector work',
      materialPlan: {
        mode: 'REQUIRED',
        lines: [
          {
            id: 'connector',
            productId: 'material-product',
            warehouseId: 'material-warehouse',
            requiredQuantity: '2.00',
            requiredForStart: true,
          },
        ],
      },
    },
  };
  doc.review = {
    inspectionRevision: 3,
    planHash: inspectionPlanHash(doc),
    quoteRevision: 4,
    decision: 'APPROVE',
    actorId: 'materials-csr',
    name: 'CSR',
    confirmedAt: '2026-10-13T00:00:00Z',
  };
  const item = {
    id: ITEM,
    entityId: ENTITY,
    receiptId: 'material-receipt',
    label: 'MR-MAT',
    productName: 'Device',
    productId: null,
    sku: 'DEVICE-SKU',
    serialNumber: 'DEVICE-SN',
    declared: { id: 'source-device' },
    status: 'REPAIRING',
    version: 7,
    custodianId: TECH,
    repairOwnerId: TECH,
    repairInspection: doc,
    repairWorkflow: {
      schema: 1,
      csr: {
        status: 'RESOLVED',
        inspectionRevision: 3,
        estimateRevision: 3,
        planHash: inspectionPlanHash(doc),
        quoteRevision: 4,
        decision: 'APPROVE',
        sentToUserId: 'materials-csr',
        sentAt: '2026-10-13T00:00:00Z',
        sentBy: TECH,
      },
    },
    receipt: {
      category: 'REPAIR',
      sourceCaseId: 'material-source',
      sourceNumber: 'CASE-MAT',
      entityId: ENTITY,
    },
  };
  const source: SourceCase = {
    id: 'material-source',
    number: 'CASE-MAT',
    type: 'REPAIR',
    brand: 'MOZTECH',
    version: 'material-source-version',
    status: 'REPAIRING',
    repairAllowed: true,
    customerLabel: 'Offline Customer',
    items: [
      {
        id: 'source-device',
        name: 'Device',
        sku: 'DEVICE-SKU',
        serialNumber: 'DEVICE-SN',
        quantity: 1,
      },
    ],
    releaseInfo: {
      quoteRevision: 4,
      customerApprovedQuoteRevision: 4,
      customerApprovedAt: '2026-10-13T00:00:00Z',
      amount: 500,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: 4,
    },
  };
  Object.assign(source.releaseInfo!, {
    invoiceRequired: true,
    invoiceStatus: 'ISSUED',
    invoiceSatisfied: true,
    invoiceQuoteRevision: 4,
    quoteBindings: [
      { ...repairSourceBindingForItem(item, source), quoteRevision: 4 },
    ],
  });
  return { item, source };
}
type FixtureItem = ReturnType<typeof fixture>['item'];
type Ledger = {
  id: string;
  entityId: string;
  productId: string;
  warehouseId: string;
  direction: string;
  quantity: string;
  referenceType: string;
  referenceId: string;
};
type State = {
  item: FixtureItem;
  allocations: RepairMaterialAllocationRecord[];
  operations: {
    entityId: string;
    actorId: string;
    requestId: string;
    requestHash: string;
    result: unknown;
  }[];
  ledgers: Ledger[];
  stock: {
    id: string;
    qtyOnHand: string;
    qtyAllocated: string;
    qtyAvailable: string;
  };
};

/** In-memory transaction adapter checks persisted stock/ledger results and rolls back on failures. */
function harness() {
  const { item, source } = fixture();
  let state: State = {
    item,
    allocations: [],
    operations: [],
    ledgers: [],
    stock: {
      id: 'snapshot-material',
      qtyOnHand: '10.00',
      qtyAllocated: '0.00',
      qtyAvailable: '10.00',
    },
  };
  let fail: 'save' | 'operation' | 'ledger' | 'stock' | null = null;
  let productActive = true,
    warehouseActive = true,
    serialProduct = false,
    scope = 'ENTITY';
  const actors: Record<string, Actor> = {
    [TECH]: {
      id: TECH,
      name: 'Technician',
      entityIds: [ENTITY],
      permissions: new Set([
        'repair_workbench:read',
        'repair_workbench:update',
      ]),
    },
    [STOCK]: {
      id: STOCK,
      name: 'Stock staff',
      entityIds: [ENTITY],
      permissions: new Set(['inventory:read', 'inventory:update']),
    },
  };
  const queryLog: string[] = [];
  const db = (s: State) => ({
    user: {
      findUnique: jest.fn(() => ({
        inventoryDataScope: scope,
        roles: [],
      })),
    },
    employee: {
      findFirst: jest.fn(
        ({ where }: { where: { userId: string; entityId: string } }) =>
          where.userId === TECH && where.entityId === ENTITY
            ? { id: 'active-employee' }
            : null,
      ),
    },
    mailroomItem: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        where.id === s.item.id ? s.item : null,
      ),
    },
    product: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; entityId: string } }) =>
          productActive &&
          where.id === 'material-product' &&
          where.entityId === ENTITY
            ? { id: where.id, hasSerialNumbers: serialProduct }
            : null,
      ),
    },
    warehouse: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; entityId: string } }) =>
          warehouseActive &&
          where.id === 'material-warehouse' &&
          where.entityId === ENTITY
            ? { id: where.id }
            : null,
      ),
    },
    inventorySnapshot: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            entityId_warehouseId_productId: {
              entityId: string;
              productId: string;
              warehouseId: string;
            };
          };
        }) => {
          expect(
            Object.keys(where.entityId_warehouseId_productId).sort(),
          ).toEqual(['entityId', 'productId', 'warehouseId']);
          return { ...s.stock };
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: State['stock'];
          data: Omit<State['stock'], 'id'>;
        }) => {
          if (fail === 'stock') return { count: 0 };
          if (
            where.id !== s.stock.id ||
            where.qtyOnHand !== s.stock.qtyOnHand ||
            where.qtyAllocated !== s.stock.qtyAllocated ||
            where.qtyAvailable !== s.stock.qtyAvailable
          )
            return { count: 0 };
          Object.assign(s.stock, data);
          return { count: 1 };
        },
      ),
    },
    inventoryTransaction: {
      create: jest.fn(({ data }: { data: Ledger }) => {
        if (fail === 'ledger') throw new Error('ledger failure');
        s.ledgers.push(clone(data));
        return data;
      }),
      findUnique: jest.fn(
        ({ where }: { where: { id: string } }) =>
          s.ledgers.find((x) => x.id === where.id) ?? null,
      ),
      findMany: jest.fn(
        ({ where }: { where: { id: { in: string[] }; entityId: string } }) =>
          s.ledgers.filter(
            (x) => where.id.in.includes(x.id) && x.entityId === where.entityId,
          ),
      ),
    },
    $queryRaw: jest.fn((sql: Prisma.Sql) => {
      const text = sql.text.replace(/\s+/g, ' ').trim(),
        v = sql.values;
      queryLog.push(text);
      if (text.includes('pg_advisory_xact_lock'))
        throw new Prisma.PrismaClientKnownRequestError(
          'PostgreSQL void cannot be deserialized',
          { code: 'P2010', clientVersion: '6.19.0' },
        );
      if (text.startsWith('SELECT id FROM')) return [];
      if (text.includes('FROM repair_material_operations'))
        return s.operations.filter(
          (x) =>
            x.entityId === v[0] && x.actorId === v[1] && x.requestId === v[2],
        );
      if (text.includes('FROM repair_material_allocations'))
        return clone(
          s.allocations.filter(
            (x) =>
              x.entityId === v[0] &&
              x.itemId === v[1] &&
              (v.length < 3 || x.id === v[2]),
          ),
        );
      throw new Error('Unexpected query ' + text);
    }),
    $executeRaw: jest.fn((sql: Prisma.Sql) => {
      const text = sql.text.replace(/\s+/g, ' ').trim(),
        v = sql.values;
      queryLog.push(text);
      if (text.includes('pg_advisory_xact_lock')) {
        expect(sql.sql).toBe(
          'SELECT pg_advisory_xact_lock(hashtextextended(?,0))',
        );
        expect(v).toHaveLength(1);
        expect(v[0]).toMatch(/^[a-f0-9]{64}$/);
        return 0;
      }
      if (text.startsWith('INSERT INTO repair_material_allocations')) {
        s.allocations.push({
          id: v[0],
          entityId: v[1],
          itemId: v[2],
          inspectionRevision: v[3],
          planHash: v[4],
          requirementId: v[5],
          productId: v[6],
          warehouseId: v[7],
          requiredQuantity: v[8],
          allocatedQuantity: v[9],
          activeKey: v[10],
          allocatedById: v[11],
          allocatedAt: v[12],
          reserveTransactionId: v[13],
          receivedQuantity: '0.00',
          consumedQuantity: '0.00',
          returnedQuantity: '0.00',
          releasedQuantity: '0.00',
          status: 'ALLOCATED',
          version: 1,
          physicalReceiptId: null,
          receivedById: null,
          receivedAt: null,
          physicalReturnId: null,
          returnedById: null,
          returnedAt: null,
          returnLocation: null,
          consumedById: null,
          consumedAt: null,
          releasedById: null,
          releasedAt: null,
          outTransactionId: null,
          releaseTransactionId: null,
          costStatus: 'UNKNOWN',
          unitCost: null,
          costCurrency: null,
          costSourceReference: null,
          sourceVersion: null,
        } as RepairMaterialAllocationRecord);
        return 1;
      }
      if (text.startsWith('UPDATE repair_material_allocations')) {
        if (fail === 'save') return 0;
        const keys = [
          'receivedQuantity',
          'consumedQuantity',
          'releasedQuantity',
          'returnedQuantity',
          'status',
          'activeKey',
          'physicalReceiptId',
          'receivedById',
          'receivedAt',
          'physicalReturnId',
          'returnedById',
          'returnedAt',
          'returnLocation',
          'consumedById',
          'consumedAt',
          'releasedById',
          'releasedAt',
          'outTransactionId',
          'releaseTransactionId',
          'sourceVersion',
        ] as const;
        // SQL has twenty assignments before the four guarded WHERE values.
        const found = s.allocations.find(
          (x) =>
            x.id === v[20] &&
            x.entityId === v[21] &&
            x.itemId === v[22] &&
            x.version === v[23],
        );
        if (!found) return 0;
        keys.forEach((key, index) => {
          (found as unknown as Record<string, unknown>)[key] = v[index];
        });
        found.version++;
        return 1;
      }
      if (text.startsWith('INSERT INTO repair_material_operations')) {
        if (fail === 'operation') throw new Error('operation failure');
        s.operations.push({
          entityId: v[1] as string,
          actorId: v[4] as string,
          requestId: v[5] as string,
          requestHash: v[6] as string,
          result: JSON.parse(v[8] as string),
        });
        return 1;
      }
      throw new Error('Unexpected write ' + text);
    }),
  });
  let queue = Promise.resolve();
  let lastTransaction: ReturnType<typeof db> | undefined;
  const prisma = {
    $transaction: async <T>(
      work: (tx: ReturnType<typeof db>) => Promise<T>,
    ) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const draft = clone(state);
      try {
        lastTransaction = db(draft);
        const result = await work(lastTransaction);
        state = draft;
        return result;
      } finally {
        release();
      }
    },
  };
  const mailroom = {
    enabled: jest.fn(),
    actor: jest.fn((userId: string) => {
      const value = actors[userId];
      if (!value) throw new ForbiddenException('inactive');
      return value;
    }),
  };
  const sync = { cases: jest.fn(() => Promise.resolve({ items: [source] })) };
  const service = new RepairMaterialsService(
    prisma as never,
    mailroom as never,
    sync as never,
  );
  let sequence = 0;
  const allocateBody = (
    extra: Partial<AllocateRepairMaterialDto> = {},
  ): AllocateRepairMaterialDto => ({
    entityId: ENTITY,
    requestId: 'allocate-' + ++sequence,
    expectedItemVersion: state.item.version,
    inspectionRevision: state.item.repairInspection.revision,
    planHash: inspectionPlanHash(state.item.repairInspection),
    requirementId: 'connector',
    ...extra,
  });
  const physicalBody = (
    extra: Partial<PhysicalRepairMaterialDto> = {},
  ): PhysicalRepairMaterialDto => ({
    ...allocateBody(),
    requestId: 'physical-' + ++sequence,
    allocationId: state.allocations[0]?.id,
    expectedAllocationVersion: state.allocations[0]?.version,
    quantity: '2.00',
    confirmedItems: true,
    ...extra,
  });
  const releaseBody = (
    extra: Partial<ReleaseRepairMaterialDto> = {},
  ): ReleaseRepairMaterialDto => ({
    entityId: ENTITY,
    requestId: 'release-' + ++sequence,
    allocationId: state.allocations[0]?.id,
    expectedAllocationVersion: state.allocations[0]?.version,
    returnedQuantity: '1.00',
    confirmedReturned: true,
    returnLocation: 'Reviewed bin',
    ...extra,
  });
  return {
    service,
    database: () => db(state),
    lastTransaction: () => {
      if (!lastTransaction) throw new Error('No actual transaction was called');
      return lastTransaction;
    },
    source,
    actors,
    sync,
    mailroom,
    queryLog,
    state: () => state,
    allocateBody,
    physicalBody,
    releaseBody,
    setFail: (value: typeof fail) => {
      fail = value;
    },
    setScope: (value: string) => {
      scope = value;
    },
    setProduct: (active: boolean, serial = false) => {
      productActive = active;
      serialProduct = serial;
    },
    setWarehouse: (active: boolean) => {
      warehouseActive = active;
    },
  };
}

describe('repair materials real stock producer', () => {
  it('reproduces Prisma P2010 for a void queryRaw advisory result', () => {
    const h = harness();
    let caught: unknown;
    try {
      h.database().$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'synthetic'},0))`,
      );
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof Prisma.PrismaClientKnownRequestError))
      throw new Error('Expected the actual Prisma void-result error');
    expect(caught.code).toBe('P2010');
    expect(h.state().allocations).toHaveLength(0);
    expect(h.state().ledgers).toHaveLength(0);
  });
  it('reserves, personally receives, consumes once and physically returns unused quantity without a second deduction', async () => {
    const h = harness();
    const original = clone(h.state().item);
    const input = h.allocateBody();
    await h.service.allocate(STOCK, ITEM, input);
    const tx = h.lastTransaction();
    expect(tx.$executeRaw.mock.calls[0][0].values).toEqual([
      fingerprint({
        entityId: input.entityId,
        userId: STOCK,
        requestId: input.requestId,
      }),
    ]);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.inventorySnapshot.updateMany.mock.invocationCallOrder[0],
    );
    expect(h.state().stock).toMatchObject({
      qtyOnHand: '10.00',
      qtyAllocated: '2.00',
      qtyAvailable: '8.00',
    });
    await h.service.receive(TECH, ITEM, h.physicalBody());
    expect(h.state().stock.qtyOnHand).toBe('10.00');
    await h.service.consume(TECH, ITEM, h.physicalBody({ quantity: '1.00' }));
    expect(h.state().stock).toMatchObject({
      qtyOnHand: '9.00',
      qtyAllocated: '1.00',
      qtyAvailable: '8.00',
    });
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          completion: { state: string };
        }
      ).completion.state,
    ).toBe('BLOCKED');
    await h.service.release(STOCK, ITEM, h.releaseBody());
    expect(h.state().stock).toMatchObject({
      qtyOnHand: '9.00',
      qtyAllocated: '0.00',
      qtyAvailable: '9.00',
    });
    expect(h.state().ledgers.map((x) => [x.direction, x.quantity])).toEqual([
      ['RESERVE', '2.00'],
      ['OUT', '1.00'],
      ['RELEASE', '1.00'],
    ]);
    const projection = (await h.service.read(TECH, ENTITY, ITEM)) as {
      completion: { state: string };
      receipt: { lines: { settlement: unknown }[] };
    };
    expect(projection.completion.state).toBe('READY');
    expect(projection.receipt.lines[0].settlement).toMatchObject({
      consumedQty: '1.00',
      returnedQty: '1.00',
      outstandingQty: '0.00',
      returnedById: STOCK,
    });
    expect(h.state().allocations[0]).toMatchObject({
      costStatus: 'UNKNOWN',
      unitCost: null,
      costCurrency: null,
      costSourceReference: null,
      sourceVersion: h.source.version,
    });
    expect(h.state().item).toEqual(original);
    await expect(
      h.service.allocate(STOCK, ITEM, h.allocateBody()),
    ).rejects.toThrow('重複分配');
  });

  it('allows actual partial receive and one partial OUT, keeps the remainder accountable, then allows receipt of the original remainder', async () => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody({ quantity: '1.00' }));
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          start: { state: string };
        }
      ).start.state,
    ).toBe('BLOCKED');
    await h.service.consume(TECH, ITEM, h.physicalBody({ quantity: '0.50' }));
    await h.service.receive(TECH, ITEM, h.physicalBody({ quantity: '1.00' }));
    await expect(
      h.service.consume(TECH, ITEM, h.physicalBody({ quantity: '0.50' })),
    ).rejects.toThrow('重複扣料');
    await h.service.release(
      STOCK,
      ITEM,
      h.releaseBody({ returnedQuantity: '1.50' }),
    );
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          completion: { state: string };
        }
      ).completion.state,
    ).toBe('READY');
    expect(h.state().ledgers.filter((x) => x.direction === 'OUT')).toHaveLength(
      1,
    );
  });

  it('accepts full actual consumption with no invented return and no remaining allocation', async () => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    await h.service.consume(TECH, ITEM, h.physicalBody());
    expect(h.state().stock).toMatchObject({
      qtyOnHand: '8.00',
      qtyAllocated: '0.00',
      qtyAvailable: '8.00',
    });
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          completion: { state: string };
        }
      ).completion.state,
    ).toBe('READY');
    await expect(
      h.service.release(STOCK, ITEM, h.releaseBody()),
    ).rejects.toThrow('沒有可退');
  });

  it('serializes identical retries and never creates duplicate RESERVE/physical receipt/OUT/RELEASE', async () => {
    const h = harness();
    const alloc = h.allocateBody();
    const [a, b] = await Promise.all([
      h.service.allocate(STOCK, ITEM, alloc),
      h.service.allocate(STOCK, ITEM, alloc),
    ]);
    expect(a).toEqual(b);
    const receive = h.physicalBody();
    expect(await h.service.receive(TECH, ITEM, receive)).toEqual(
      await h.service.receive(TECH, ITEM, receive),
    );
    const consume = h.physicalBody({ quantity: '1.00' });
    expect(await h.service.consume(TECH, ITEM, consume)).toEqual(
      await h.service.consume(TECH, ITEM, consume),
    );
    const release = h.releaseBody();
    expect(await h.service.release(STOCK, ITEM, release)).toEqual(
      await h.service.release(STOCK, ITEM, release),
    );
    expect(h.state().operations).toHaveLength(4);
    expect(h.state().ledgers).toHaveLength(3);
    expect(h.sync.cases).toHaveBeenCalledTimes(1);
    expect(
      h.queryLog.some((sql) => sql.includes('pg_advisory_xact_lock')),
    ).toBe(true);
    expect(
      h.queryLog.some(
        (sql) =>
          sql.includes('inventory_snapshots') && sql.includes('FOR UPDATE'),
      ),
    ).toBe(true);
  });

  it('rejects reuse of an operation key with different content and rechecks live permission before returning a retry', async () => {
    const h = harness();
    const body = h.allocateBody();
    await h.service.allocate(STOCK, ITEM, body);
    await expect(
      h.service.allocate(STOCK, ITEM, { ...body, requirementId: 'different' }),
    ).rejects.toThrow('內容不同');
    h.actors[STOCK].permissions.clear();
    await expect(h.service.allocate(STOCK, ITEM, body)).rejects.toThrow('權限');
    expect(h.state().ledgers).toHaveLength(1);
  });

  it.each(['ledger', 'save', 'operation', 'stock'] as const)(
    'rolls back all stock and ledger changes on %s failure',
    async (failure) => {
      const h = harness();
      await h.service.allocate(STOCK, ITEM, h.allocateBody());
      await h.service.receive(TECH, ITEM, h.physicalBody());
      const before = clone(h.state());
      h.setFail(failure);
      await expect(
        h.service.consume(TECH, ITEM, h.physicalBody()),
      ).rejects.toThrow();
      expect(h.state()).toEqual(before);
    },
  );

  it.each([
    'quantity',
    'receipt',
    'custody',
    'revision',
    'hash',
    'allocationVersion',
    'itemVersion',
    'confirmation',
    'otherReceiver',
  ] as const)('fails closed for %s mismatch without OUT', async (kind) => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    if (kind !== 'receipt')
      await h.service.receive(TECH, ITEM, h.physicalBody());
    const body = h.physicalBody();
    if (kind === 'quantity') body.quantity = '3.00';
    if (kind === 'custody') h.state().item.custodianId = 'other-tech';
    if (kind === 'revision') body.inspectionRevision--;
    if (kind === 'hash') body.planHash = '0'.repeat(64);
    if (kind === 'allocationVersion') body.expectedAllocationVersion--;
    if (kind === 'itemVersion') body.expectedItemVersion--;
    if (kind === 'confirmation') body.confirmedItems = false;
    if (kind === 'otherReceiver')
      h.state().allocations[0].receivedById = 'other-tech';
    const before = clone(h.state());
    await expect(h.service.consume(TECH, ITEM, body)).rejects.toThrow();
    expect(h.state()).toEqual(before);
    expect(h.state().ledgers.some((x) => x.direction === 'OUT')).toBe(false);
  });

  it.each([
    'sourceUnavailable',
    'sourceMismatch',
    'quote',
    'consent',
    'payment',
    'invoiceMissing',
    'invoicePending',
    'invoiceFailed',
    'invoiceStale',
    'proposalHash',
    'itemBinding',
    'csrStale',
    'identityChanged',
  ] as const)('blocks %s before actual material deduction', async (kind) => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    const info = h.source.releaseInfo as unknown as Record<string, unknown>;
    if (kind === 'sourceUnavailable')
      h.sync.cases.mockRejectedValueOnce(new Error('offline source'));
    if (kind === 'sourceMismatch') h.source.id = 'other-source';
    if (kind === 'quote') info.quoteRevision = 5;
    if (kind === 'consent') info.customerApprovedQuoteRevision = 3;
    if (kind === 'payment') info.confirmedPaymentQuoteRevision = 3;
    if (kind === 'invoiceMissing') delete info.invoiceRequired;
    if (kind === 'invoicePending') info.invoiceStatus = 'PENDING';
    if (kind === 'invoiceFailed') info.invoiceSatisfied = false;
    if (kind === 'invoiceStale') info.invoiceQuoteRevision = 3;
    const bindings = info.quoteBindings as Record<string, unknown>[];
    if (kind === 'proposalHash') bindings[0].proposalHash = '0'.repeat(64);
    if (kind === 'itemBinding') bindings[0].itemId = 'other-piece';
    if (kind === 'csrStale') h.state().item.repairWorkflow.csr.planHash = 'old';
    if (kind === 'identityChanged')
      h.state().item.serialNumber = 'different-device';
    const before = clone(h.state());
    await expect(
      h.service.consume(TECH, ITEM, h.physicalBody()),
    ).rejects.toThrow();
    expect(h.state()).toEqual(before);
  });

  it('allows explicit Source invoice policy and current bound free work', async () => {
    for (const mode of ['not-required', 'free']) {
      const h = harness();
      await h.service.allocate(STOCK, ITEM, h.allocateBody());
      await h.service.receive(TECH, ITEM, h.physicalBody());
      Object.assign(h.source.releaseInfo!, { invoiceRequired: false });
      if (mode === 'free')
        Object.assign(h.source.releaseInfo!, {
          amount: 0,
          confirmedPaymentQuoteRevision: null,
        });
      await h.service.consume(TECH, ITEM, h.physicalBody());
      expect(
        h.state().ledgers.filter((x) => x.direction === 'OUT'),
      ).toHaveLength(1);
      expect(h.sync.cases).toHaveBeenCalledTimes(1);
    }
  });

  it('does not infer controlled corporate start from legacy REFURBISHING status or customer financial flags', async () => {
    const h = harness();
    h.state().item.receipt.category = 'RETURN';
    h.state().item.status = 'REFURBISHING';
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    const before = clone(h.state());
    await expect(
      h.service.consume(TECH, ITEM, h.physicalBody()),
    ).rejects.toThrow('尚未由本人確認開工');
    expect(h.state()).toEqual(before);
    expect(h.sync.cases).not.toHaveBeenCalled();
  });

  const corporateStart = (h: ReturnType<typeof harness>) => {
    const item = h.state().item;
    item.receipt.category = 'RETURN';
    item.status = 'REFURBISHING';
    Object.assign(item.repairWorkflow.csr, { quoteRevision: null });
    Object.assign(item.repairInspection.review!, { quoteRevision: null });
    const proof = {
      schema: 'corely.repair.work-start.v1',
      kind: 'REFURBISHMENT',
      entityId: item.entityId,
      itemId: item.id,
      inspectionRevision: item.repairInspection.revision,
      planHash: inspectionPlanHash(item.repairInspection),
      ownerId: item.repairOwnerId,
      custodianId: item.custodianId,
      startedById: item.repairOwnerId,
      startedAt: '2026-10-13T00:00:00Z',
    };
    Object.assign(item.repairWorkflow, { workStart: proof });
    return proof;
  };

  it('allows corporate actual materials only from a current controlled refurbishment start, independent of customer Source flags', async () => {
    const h = harness();
    corporateStart(h);
    h.sync.cases.mockRejectedValue(new Error('customer Source unavailable'));
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    await h.service.consume(TECH, ITEM, h.physicalBody());
    expect(h.state().stock).toMatchObject({
      qtyOnHand: '8.00',
      qtyAllocated: '0.00',
      qtyAvailable: '8.00',
    });
    expect(h.state().allocations[0].sourceVersion).toBeNull();
    expect(h.state().ledgers.filter((x) => x.direction === 'OUT')).toHaveLength(
      1,
    );
    expect(h.sync.cases).not.toHaveBeenCalled();
  });

  it.each([
    'revision',
    'hash',
    'entity',
    'item',
    'owner',
    'custodian',
    'starter',
    'future',
    'malformedTime',
    'numericTime',
    'schema',
    'kind',
    'csrStale',
    'csrDecline',
    'planMismatch',
    'stage',
  ] as const)(
    'rejects corporate controlled start %s mismatch without stock effects',
    async (kind) => {
      const h = harness();
      corporateStart(h);
      await h.service.allocate(STOCK, ITEM, h.allocateBody());
      await h.service.receive(TECH, ITEM, h.physicalBody());
      const proof = (
        h.state().item.repairWorkflow as unknown as {
          workStart: Record<string, unknown>;
        }
      ).workStart;
      if (kind === 'revision') proof.inspectionRevision = 2;
      if (kind === 'hash') proof.planHash = '0'.repeat(64);
      if (kind === 'entity') proof.entityId = 'other-company';
      if (kind === 'item') proof.itemId = 'other-piece';
      if (kind === 'owner') proof.ownerId = 'other-tech';
      if (kind === 'custodian') proof.custodianId = 'other-tech';
      if (kind === 'starter') proof.startedById = 'other-tech';
      if (kind === 'future') proof.startedAt = '2099-10-13T00:00:00Z';
      if (kind === 'malformedTime') proof.startedAt = 'not-a-date';
      if (kind === 'numericTime') proof.startedAt = 0;
      if (kind === 'schema') proof.schema = 'wrong-schema';
      if (kind === 'kind') proof.kind = 'REPAIR';
      if (kind === 'csrStale')
        h.state().item.repairWorkflow.csr.planHash = 'old-plan';
      if (kind === 'csrDecline') {
        h.state().item.repairWorkflow.csr.decision = 'DECLINE';
        h.state().item.repairInspection.review!.decision = 'DECLINE';
      }
      if (kind === 'planMismatch') {
        h.state().item.repairInspection.data.plan = 'RETURN';
        const hash = inspectionPlanHash(h.state().item.repairInspection);
        proof.planHash = hash;
        h.state().item.repairWorkflow.csr.planHash = hash;
        h.state().item.repairInspection.review!.planHash = hash;
        h.state().allocations[0].planHash = hash;
      }
      if (kind === 'stage') h.state().item.status = 'INSPECTING';
      const before = clone(h.state());
      await expect(
        h.service.consume(TECH, ITEM, h.physicalBody()),
      ).rejects.toThrow();
      expect(h.state()).toEqual(before);
      expect(h.sync.cases).not.toHaveBeenCalled();
    },
  );

  it.each([
    'replacement',
    'factoryReturned',
    'factoryNotReturned',
    'factoryStale',
    'factoryCancelled',
  ] as const)(
    'only deducts explicit local materials for %s with current finance and physical custody',
    async (kind) => {
      const h = harness();
      const item = h.state().item,
        doc = item.repairInspection;
      doc.data.plan = kind === 'replacement' ? 'REPLACE' : 'FACTORY';
      if (kind === 'replacement')
        Object.assign(doc.data, {
          replacementCondition: 'NEW',
          replacementSku: 'REPLACEMENT-SKU',
        });
      else item.status = 'INSPECTING';
      doc.review!.planHash = inspectionPlanHash(doc);
      item.repairWorkflow.csr.planHash = doc.review!.planHash;
      Object.assign(h.source.releaseInfo!, {
        quoteBindings: [
          { ...repairSourceBindingForItem(item, h.source), quoteRevision: 4 },
        ],
      });
      if (kind !== 'replacement')
        Object.assign(item.repairWorkflow, {
          factory: {
            stage: kind === 'factoryNotReturned' ? 'RETURNING' : 'RETURNED',
            physicalCustody: 'TECHNICIAN',
            inspectionRevision: kind === 'factoryStale' ? 2 : doc.revision,
            planHash: inspectionPlanHash(doc),
            cancelled: kind === 'factoryCancelled',
          },
        });
      await h.service.allocate(STOCK, ITEM, h.allocateBody());
      await h.service.receive(TECH, ITEM, h.physicalBody());
      const before = clone(h.state());
      if (kind === 'replacement' || kind === 'factoryReturned') {
        await h.service.consume(TECH, ITEM, h.physicalBody());
        expect(
          h.state().ledgers.filter((x) => x.direction === 'OUT'),
        ).toHaveLength(1);
        expect(
          h.state().ledgers.every((x) => x.productId === 'material-product'),
        ).toBe(true);
      } else {
        await expect(
          h.service.consume(TECH, ITEM, h.physicalBody()),
        ).rejects.toThrow();
        expect(h.state()).toEqual(before);
      }
    },
  );

  it.each([
    'techPermission',
    'inventoryScope',
    'foreignEntity',
    'inactiveProduct',
    'inactiveWarehouse',
    'serialProduct',
    'insufficient',
    'inconsistent',
  ] as const)('does not reserve for %s', async (kind) => {
    const h = harness();
    let user = STOCK;
    if (kind === 'techPermission') user = TECH;
    if (kind === 'inventoryScope') h.setScope('OWN');
    if (kind === 'foreignEntity') h.actors[STOCK].entityIds = ['other-company'];
    if (kind === 'inactiveProduct') h.setProduct(false);
    if (kind === 'inactiveWarehouse') h.setWarehouse(false);
    if (kind === 'serialProduct') h.setProduct(true, true);
    if (kind === 'insufficient')
      Object.assign(h.state().stock, {
        qtyOnHand: '1.00',
        qtyAvailable: '1.00',
      });
    if (kind === 'inconsistent') h.state().stock.qtyAllocated = '1.00';
    const before = clone(h.state());
    await expect(
      h.service.allocate(user, ITEM, h.allocateBody()),
    ).rejects.toThrow();
    expect(h.state()).toEqual(before);
  });

  it('uses exact Decimal stock quantities above the per-allocation input limit', async () => {
    const h = harness();
    Object.assign(h.state().stock, {
      qtyOnHand: '9999999999999999.99',
      qtyAvailable: '9999999999999999.99',
    });
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    expect(h.state().stock.qtyAvailable).toBe('9999999999999997.99');
  });

  it('enforces entity inventory read scope and leaves repair queries accessible when material or Source evidence is missing', async () => {
    const h = harness();
    h.setScope('OWN');
    await expect(h.service.read(STOCK, ENTITY, ITEM)).rejects.toThrow('庫存');
    h.sync.cases.mockRejectedValue(new Error('no Source'));
    const read = await h.service.read(TECH, ENTITY, ITEM);
    expect(read.completion.state).toBe('BLOCKED');
    expect(h.sync.cases).not.toHaveBeenCalled();
    expect(h.state().allocations).toHaveLength(0);
  });

  it.each([
    'falseConfirmation',
    'shortReturn',
    'numericReturn',
    'noLocation',
    'techReturn',
  ] as const)('retains unused material responsibility for %s', async (kind) => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    await h.service.consume(TECH, ITEM, h.physicalBody({ quantity: '1.00' }));
    const body = h.releaseBody();
    let user = STOCK;
    if (kind === 'falseConfirmation') body.confirmedReturned = false;
    if (kind === 'shortReturn') body.returnedQuantity = '0.50';
    if (kind === 'numericReturn')
      (body as unknown as Record<string, unknown>).returnedQuantity = 1;
    if (kind === 'noLocation') body.returnLocation = ' ';
    if (kind === 'techReturn') user = TECH;
    const before = clone(h.state());
    await expect(h.service.release(user, ITEM, body)).rejects.toThrow();
    expect(h.state()).toEqual(before);
  });

  it('does not forget old held material when a new inspection says NONE; stock staff can receive it back without a fake current version', async () => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    h.state().item.repairInspection.revision++;
    h.state().item.repairInspection.data.materialPlan = {
      mode: 'NONE',
      lines: [],
    };
    expect(
      (await h.service.read(TECH, ENTITY, ITEM)) as {
        completion: { state: string };
        historicalOutstanding: boolean;
      },
    ).toMatchObject({
      completion: { state: 'BLOCKED' },
      historicalOutstanding: true,
    });
    await h.service.release(
      STOCK,
      ITEM,
      h.releaseBody({ returnedQuantity: '2.00' }),
    );
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          completion: { state: string };
        }
      ).completion.state,
    ).toBe('READY');
    expect(h.state().ledgers.some((x) => x.direction === 'OUT')).toBe(false);
  });

  it('releases an unreceived reserve without inventing physical return and permits a new correct reservation', async () => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.release(
      STOCK,
      ITEM,
      h.releaseBody({
        returnedQuantity: undefined,
        confirmedReturned: undefined,
        returnLocation: undefined,
      }),
    );
    expect(h.state().allocations[0]).toMatchObject({
      activeKey: null,
      physicalReturnId: null,
      returnedQuantity: '0.00',
    });
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    expect(h.state().allocations).toHaveLength(2);
  });

  it('preserves a fully received then fully returned settlement, and a new active reservation requires its own receipt', async () => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    await h.service.release(
      STOCK,
      ITEM,
      h.releaseBody({ returnedQuantity: '2.00' }),
    );
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          completion: { state: string };
        }
      ).completion.state,
    ).toBe('READY');
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          completion: { state: string };
        }
      ).completion.state,
    ).toBe('BLOCKED');
  });

  it('does not project missing physical return evidence as completion even when released quantities are present', async () => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    await h.service.consume(TECH, ITEM, h.physicalBody({ quantity: '1.00' }));
    await h.service.release(STOCK, ITEM, h.releaseBody());
    h.state().allocations[0].physicalReturnId = null;
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          completion: { state: string };
        }
      ).completion.state,
    ).toBe('UNKNOWN');
  });

  it('reads invalid stock evidence as UNKNOWN and refuses to consume against mismatching persisted RESERVE proof', async () => {
    const h = harness();
    await h.service.allocate(STOCK, ITEM, h.allocateBody());
    await h.service.receive(TECH, ITEM, h.physicalBody());
    h.state().ledgers[0].referenceId = 'different-piece';
    Object.assign(h.state().item.repairWorkflow, {
      materialsReceipt: { schema: 1, status: 'READY' },
    });
    expect(
      (
        (await h.service.read(TECH, ENTITY, ITEM)) as {
          completion: { state: string };
        }
      ).completion.state,
    ).toBe('UNKNOWN');
    const before = clone(h.state());
    await expect(
      h.service.consume(TECH, ITEM, h.physicalBody()),
    ).rejects.toThrow('流水');
    expect(h.state()).toEqual(before);
  });
});

describe('repair material command DTO trust boundary', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const body = () => ({
    entityId: ENTITY,
    requestId: 'physical-offline',
    expectedItemVersion: 7,
    inspectionRevision: 3,
    planHash: 'a'.repeat(64),
    allocationId: 'allocation',
    expectedAllocationVersion: 1,
    quantity: '1.25',
    confirmedItems: true,
  });
  it('accepts two-decimal strings and literal booleans', async () => {
    expect(
      await pipe.transform(body(), {
        type: 'body',
        metatype: PhysicalRepairMaterialDto,
      }),
    ).toMatchObject({ quantity: '1.25', confirmedItems: true });
  });
  it.each([0, 1, 1.234, '1.234', '01.00', '1e2', '-1', ' 1.00', 'Infinity'])(
    'rejects quantity %s before any producer call',
    async (quantity) => {
      await expect(
        pipe.transform(
          { ...body(), quantity },
          { type: 'body', metatype: PhysicalRepairMaterialDto },
        ),
      ).rejects.toThrow();
    },
  );
  it.each(['true', 'false', 1, null])(
    'rejects coerced physical confirmation %s',
    async (confirmedItems) => {
      await expect(
        pipe.transform(
          { ...body(), confirmedItems },
          { type: 'body', metatype: PhysicalRepairMaterialDto },
        ),
      ).rejects.toThrow();
    },
  );
  it.each([
    'actorId',
    'unitCost',
    'costCurrency',
    'invoiceSatisfied',
    'sourceProof',
    'physicalReceipt',
    'productId',
    'warehouseId',
  ])('rejects client-owned %s field', async (key) => {
    await expect(
      pipe.transform(
        { ...body(), [key]: 'forged' },
        { type: 'body', metatype: PhysicalRepairMaterialDto },
      ),
    ).rejects.toThrow();
  });
  it('forbids forged return receipt and string confirmation', async () => {
    const value = {
      entityId: ENTITY,
      requestId: 'release-offline',
      allocationId: 'allocation',
      expectedAllocationVersion: 1,
      returnedQuantity: '1.00',
      confirmedReturned: 'true',
    };
    await expect(
      pipe.transform(value, {
        type: 'body',
        metatype: ReleaseRepairMaterialDto,
      }),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { ...value, confirmedReturned: true, returnedById: TECH },
        { type: 'body', metatype: ReleaseRepairMaterialDto },
      ),
    ).rejects.toThrow();
  });
});
