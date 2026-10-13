import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MailroomService } from './mailroom.service';
import { type Actor, type SourceCase } from './mailroom.contract';
import { type MailroomCommandDto } from './mailroom.dto';
import { productIdentityHash } from './mailroom-product-decision.contract';
import { repairSourceBindingForItem } from './repair-proposal.contract';
import { inspectionPlanHash } from './repair-document.contract';
import { sentCustomerWorkflow } from './repair-workflow.contract';

const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIPT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TIME = '2026-10-13T04:00:00.000Z';
const QA = 'doa-dev-qa-20261002';
const image = (label: string) =>
  'data:image/png;base64,' +
  Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from(label),
  ]).toString('base64');
const PHOTO_A = image('SYNTHETIC-A'),
  PHOTO_B = image('SYNTHETIC-B'),
  PHOTO_C = image('SYNTHETIC-C');
type Row = Record<string, any>;
function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in value)
      return value.in.includes(row[key]);
    if (value && typeof value === 'object' && 'not' in value)
      return row[key] !== value.not;
    return row[key] === value;
  });
}
/** In-memory tables restore the physical row, fact, tasks, history and outbox on rollback. */
function fixture(
  category: 'REPAIR' | 'RETURN' = 'REPAIR',
  entityId = 'company',
) {
  const actors = new Map<string, Actor>([
    [
      'csr',
      {
        id: 'csr',
        name: 'SYNTHETIC CSR',
        entityIds: [entityId],
        permissions: new Set(['mailroom:read', 'mailroom:review']),
      },
    ],
    [
      'other-csr',
      {
        id: 'other-csr',
        name: 'SYNTHETIC OTHER CSR',
        entityIds: [entityId],
        permissions: new Set(['mailroom:read', 'mailroom:review']),
      },
    ],
    [
      'clerk',
      {
        id: 'clerk',
        name: 'SYNTHETIC CLERK',
        entityIds: [entityId],
        permissions: new Set([
          'mailroom:read',
          'mailroom:update',
          'inventory:update',
        ]),
      },
    ],
    [
      'tech',
      {
        id: 'tech',
        name: 'SYNTHETIC TECH',
        entityIds: [entityId],
        permissions: new Set([
          'repair_workbench:read',
          'repair_workbench:update',
          'mailroom:read',
          'mailroom:update',
        ]),
      },
    ],
  ]);
  const source: SourceCase = {
    id: 'case-1',
    number: 'SYNTHETIC-CASE',
    type: category,
    brand: 'Customer workspace label',
    caseBrand: 'MOZTECH',
    firstReviewErpActorId: 'initial-reviewer',
    version: TIME,
    status: 'INSPECTING',
    customerLabel: 'SYNTHETIC',
    repairAllowed: false,
    assigneeId: 'source-csr',
    assigneeEmail: 'csr@example.invalid',
    assigneeName: 'Source CSR',
    releaseInfo: {
      quoteRevision: 4,
      customerApprovedQuoteRevision: 4,
      customerApprovedAt: TIME,
      amount: 500.01,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: 4,
      invoiceRequired: true,
      invoiceStatus: 'ISSUED',
      invoiceSatisfied: true,
      invoiceQuoteRevision: 4,
      quoteBindings: [],
    },
    items: [
      {
        id: 'source-line',
        name: '申報投影機',
        sku: 'CLAIM-SKU',
        serialNumber: 'DECLARED-SN',
        quantity: 2,
      },
    ],
  };
  let state: {
    item: Row;
    facts: Row[];
    actions: Row[];
    tasks: Row[];
    notifications: Row[];
    deliveries: Row[];
  } = {
    item: {
      id: ITEM,
      entityId,
      receiptId: RECEIPT,
      label: 'SYNTHETIC-PIECE',
      status: 'MISMATCH',
      version: 7,
      productId: 'product-1',
      productName: '實收投影機',
      sku: 'ACTUAL-SKU',
      serialNumber: 'ACTUAL-SN',
      barcode: null,
      declared: structuredClone(source.items[0]),
      evidence: [PHOTO_A, PHOTO_B],
      location: 'A1',
      custodianId: 'clerk',
      nextUserId: null,
      repairOwnerId: null,
      recipientId: null,
      matchResult: 'MISMATCH',
      grade: null,
      disposition: null,
      conditionNote: '寄回品項不符',
      returnInspection: null,
      receipt: {
        id: RECEIPT,
        entityId,
        category,
        sourceCaseId: source.id,
        sourceNumber: source.number,
        sourceSnapshot: structuredClone(source),
        customerServiceUserId: 'csr',
        receivedById: 'clerk',
        receivedAt: new Date(TIME),
      },
      repairInspection: {
        number: 'INS-SYNTHETIC',
        revision: 3,
        status: 'SUBMITTED',
        authorId: 'tech',
        authorName: 'SYNTHETIC TECH',
        updatedAt: TIME,
        submittedAt: TIME,
        data: {
          complaint: '無法開機',
          reproduction: 'YES',
          testConditions: '原廠電源',
          checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
          diagnosis: '電源故障',
          causeStatus: 'CONFIRMED',
          plan: 'REPAIR',
          planNote: '維修並複驗',
          feeSuggestion: 'PAID',
          estimateAmount: 500.01,
          estimateNote: '零件與工資',
        },
      },
      repairReport: {
        number: 'REP-SYNTHETIC',
        revision: 1,
        inspectionRevision: 3,
        status: 'SUBMITTED',
        authorId: 'tech',
        authorName: 'SYNTHETIC TECH',
        updatedAt: TIME,
        submittedAt: TIME,
        data: {
          outcome: 'REPAIRED',
          workPerformed: '更換模組',
          parts: [],
          laborMinutes: 15,
          checks: [{ name: '開機', result: 'PASS', observation: '正常' }],
          qcResult: 'PASS',
          qcNotes: '正常',
          deliveredAccessories: '配件完整',
        },
      },
    },
    facts: [],
    actions: [],
    tasks: [],
    notifications: [],
    deliveries: [],
  };
  const proof: Row = {
    proofId: 'product-confirmation-1',
    purpose: 'PRODUCT',
    status: 'APPROVED',
    itemId: ITEM,
    planVersion: 23,
    planHash: productIdentityHash(state.item as any),
    actualIdentityHash: productIdentityHash(state.item as any),
    customerDecision: 'ACCEPT_ACTUAL',
    verifiedCustomerId: '0123456789abcdef'.repeat(4),
    provider: 'LINE',
    reviewedById: 'source-reviewer',
    submittedAt: '2026-10-13T03:00:00.000Z',
    reviewedAt: '2026-10-13T03:01:00.000Z',
  };
  source.customerProductConfirmations = [proof];
  state.item.receipt.sourceSnapshot = structuredClone(source);
  const trace: string[] = [];
  let onLock: (() => void) | undefined,
    failRecord = false;
  const db: any = {
    mailroomItem: {
      findUnique: jest.fn(async () => structuredClone(state.item)),
      findUniqueOrThrow: jest.fn(async () => structuredClone(state.item)),
      update: jest.fn(async ({ data }: Row) => {
        state.item = {
          ...state.item,
          ...structuredClone(data),
          version: state.item.version + data.version.increment,
        };
        trace.push('item.update');
        return structuredClone(state.item);
      }),
    },
    mailroomReceipt: {
      update: jest.fn(async ({ data }: Row) => {
        Object.assign(state.item.receipt, structuredClone(data));
        return structuredClone(state.item.receipt);
      }),
    },
    mailroomProductMismatchFact: {
      findUnique: jest.fn(async ({ where }: Row) =>
        structuredClone(
          state.facts.find((row) =>
            matches(row, where.entityId_itemId_identityHash),
          ) || null,
        ),
      ),
      create: jest.fn(async ({ data }: Row) => {
        if (
          state.facts.some(
            (row) =>
              row.entityId === data.entityId &&
              row.itemId === data.itemId &&
              row.identityHash === data.identityHash,
          )
        )
          throw new Error('fixture duplicate fact');
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          ...structuredClone(data),
        };
        state.facts.push(row);
        trace.push('fact.create');
        return structuredClone(row);
      }),
      count: jest.fn(
        async ({ where }: Row) =>
          state.facts.filter((row) => matches(row, where)).length,
      ),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const rows = state.facts.filter((row) => matches(row, where));
        for (const row of rows) Object.assign(row, structuredClone(data));
        trace.push('fact.void');
        return { count: rows.length };
      }),
    },
    mailroomAction: {
      findUnique: jest.fn(async ({ where }: Row) =>
        structuredClone(
          state.actions.find((row) =>
            matches(row, where.entityId_actorId_requestId),
          ) || null,
        ),
      ),
      create: jest.fn(async ({ data }: Row) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          ...structuredClone(data),
        };
        state.actions.push(row);
        trace.push('history.create');
        if (failRecord) throw new Error('injected record failure');
        return structuredClone(row);
      }),
    },
    mailroomTask: {
      findMany: jest.fn(async ({ where }: Row) =>
        structuredClone(state.tasks.filter((row) => matches(row, where))),
      ),
      create: jest.fn(async ({ data }: Row) => {
        const row = {
          id: randomUUID(),
          status: 'OPEN',
          ...structuredClone(data),
        };
        state.tasks.push(row);
        return structuredClone(row);
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const rows = state.tasks.filter((row) => matches(row, where));
        for (const row of rows) Object.assign(row, structuredClone(data));
        return { count: rows.length };
      }),
      update: jest.fn(async ({ where, data }: Row) => {
        const row = state.tasks.find((row) => row.id === where.id)!;
        Object.assign(row, structuredClone(data));
        return structuredClone(row);
      }),
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
        return structuredClone(row);
      }),
    },
    mailroomDelivery: {
      createMany: jest.fn(async ({ data }: Row) => {
        state.deliveries.push(...structuredClone(data));
        return { count: data.length };
      }),
    },
    user: {
      findMany: jest.fn(async ({ where }: Row) => {
        const person =
          where.email?.equals === 'csr@example.invalid'
            ? 'csr'
            : where.email?.equals === 'other-csr@example.invalid'
              ? 'other-csr'
              : null;
        return person && where.employee?.entityId === entityId
          ? [{ id: person }]
          : [];
      }),
    },
    employee: { findFirst: jest.fn(async () => ({ id: 'active-employee' })) },
    $queryRaw: jest.fn(async () => {
      trace.push('lock');
      if (onLock) {
        const hook = onLock;
        onLock = undefined;
        hook();
      }
      return [{ id: state.item.id }];
    }),
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const before = structuredClone(state);
      trace.push('tx.begin');
      try {
        const result = await callback(db);
        trace.push('tx.commit');
        return result;
      } catch (error) {
        state = before;
        trace.push('tx.rollback');
        throw error;
      }
    }),
  };
  const sync = {
    cases: jest.fn(async () => {
      trace.push('source.read');
      return { items: [structuredClone(source)] };
    }),
    deliverPending: jest.fn().mockResolvedValue(undefined),
  };
  const gateway = { sendToUser: jest.fn() };
  const stock = {
    consumeForRepair: jest.fn().mockRejectedValue(new Error('unexpected OUT')),
    receiveQualified: jest
      .fn()
      .mockRejectedValue(new Error('unexpected stock receipt')),
  };
  const service = new MailroomService(
    db,
    gateway as any,
    sync as any,
    stock as any,
  );
  jest.spyOn(service, 'actor').mockImplementation(async (id) => {
    const value = actors.get(id);
    if (!value) throw new ForbiddenException('disabled actor');
    return structuredClone(value);
  });
  return {
    service,
    db,
    sync,
    gateway,
    stock,
    trace,
    source,
    proof,
    actors,
    get state() {
      return state;
    },
    lock(hook: () => void) {
      onLock = hook;
    },
    failRecord() {
      failRecord = true;
    },
    confirmed(status = 'WAITING_REPAIR_ACCEPTANCE') {
      state.item.status = status;
      state.item.matchResult = 'CONFIRMED_ACTUAL';
      state.item.repairWorkflow = {
        schema: 1,
        productDecision: structuredClone(proof),
      };
      state.facts.push({
        id: randomUUID(),
        entityId,
        itemId: ITEM,
        receiptId: RECEIPT,
        sourceCaseId: source.id,
        identityHash: proof.actualIdentityHash,
        proofId: proof.proofId,
        sourceVersion: source.version,
        caseBrand: source.caseBrand,
        firstReviewErpActorId: source.firstReviewErpActorId,
        reviewedByErpActorId: 'csr',
        status: 'ACTIVE',
        proofSnapshot: structuredClone(proof),
        createdAt: new Date(TIME),
      });
    },
    technician(stage: string) {
      state.item.status = stage;
      state.item.repairOwnerId = 'tech';
      state.item.custodianId = 'tech';
      state.item.nextUserId = 'tech';
      if (category === 'REPAIR') {
        const sent = sentCustomerWorkflow(
          state.item as any,
          actors.get('tech')!,
          TIME,
          4,
        );
        state.item.repairWorkflow = {
          ...state.item.repairWorkflow,
          ...sent,
          csr: {
            ...sent.csr,
            status: 'RESOLVED',
            ownerId: 'csr',
            decision: 'APPROVE',
            acceptedAt: TIME,
          },
        };
        state.item.repairInspection.review = {
          inspectionRevision: 3,
          actorId: 'csr',
          name: 'SYNTHETIC CSR',
          confirmedAt: TIME,
          decision: 'APPROVE',
          quoteRevision: 4,
          planHash: inspectionPlanHash(state.item.repairInspection),
        };
        source.repairAllowed = true;
        source.releaseInfo!.quoteBindings = [
          {
            ...repairSourceBindingForItem(state.item as any, source),
            quoteRevision: 4,
          },
        ];
      }
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
const command = (
  f: Fixture,
  action: MailroomCommandDto['action'] = 'resolve_mismatch',
  extra: Partial<MailroomCommandDto> = {},
): MailroomCommandDto => ({
  entityId: f.state.item.entityId,
  requestId: randomUUID(),
  expectedVersion: f.state.item.version,
  action,
  note: 'SYNTHETIC 已確認目前實物',
  ...extra,
});

describe('fresh product approval gates through the original mailroom command', () => {
  let previous: Record<string, string | undefined>;
  beforeEach(() => {
    previous = {
      MAILROOM_ENABLED: process.env.MAILROOM_ENABLED,
      ERP_DEV_SANDBOX: process.env.ERP_DEV_SANDBOX,
    };
    process.env.MAILROOM_ENABLED = 'true';
    delete process.env.ERP_DEV_SANDBOX;
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  it.each(['REPAIR', 'RETURN'] as const)(
    'commits one exact %s product fact with the same physical handoff transaction',
    async (category) => {
      const f = fixture(category);
      await f.service.command('csr', ITEM, command(f));
      expect(f.state.item).toMatchObject({
        status:
          category === 'REPAIR' ? 'WAITING_REPAIR_ACCEPTANCE' : 'RECEIVED',
        matchResult: 'CONFIRMED_ACTUAL',
        version: 8,
      });
      expect(f.state.item.repairWorkflow.productDecision).toEqual(f.proof);
      expect(f.state.facts).toEqual([
        expect.objectContaining({
          entityId: 'company',
          itemId: ITEM,
          receiptId: RECEIPT,
          sourceCaseId: f.source.id,
          identityHash: f.proof.actualIdentityHash,
          proofId: f.proof.proofId,
          sourceVersion: TIME,
          caseBrand: 'MOZTECH',
          firstReviewErpActorId: 'initial-reviewer',
          reviewedByErpActorId: 'csr',
          status: 'ACTIVE',
          proofSnapshot: f.proof,
        }),
      ]);
      expect(f.db.$transaction).toHaveBeenCalledTimes(1);
      expect(f.trace.indexOf('fact.create')).toBeLessThan(
        f.trace.indexOf('item.update'),
      );
      expect(f.trace.indexOf('history.create')).toBeLessThan(
        f.trace.indexOf('tx.commit'),
      );
      expect(f.db.mailroomProductMismatchFact.findUnique).toHaveBeenCalledWith({
        where: {
          entityId_itemId_identityHash: {
            entityId: 'company',
            itemId: ITEM,
            identityHash: f.proof.actualIdentityHash,
          },
        },
      });
      expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
      expect(f.stock.receiveQualified).not.toHaveBeenCalled();
    },
  );
  it.each([
    'missing',
    'identity-mismatch',
    'REJECT',
    'unknown-brand',
    'purpose',
    'duplicate',
    'closed',
  ] as const)(
    'fails closed on %s instead of treating a CSR note as customer acceptance',
    async (reason) => {
      const f = fixture(),
        before = structuredClone(f.state);
      if (reason === 'missing') f.source.customerProductConfirmations = [];
      if (reason === 'identity-mismatch')
        f.proof.actualIdentityHash = 'a'.repeat(64);
      if (reason === 'REJECT') {
        f.proof.status = 'REJECTED';
        f.proof.customerDecision = 'REJECT_ACTUAL';
      }
      if (reason === 'unknown-brand') {
        f.source.caseBrand = null;
        f.source.brand = 'MOZTECH';
      }
      if (reason === 'purpose') f.proof.purpose = 'REPAIR';
      if (reason === 'duplicate')
        f.source.customerProductConfirmations = [
          f.proof,
          { ...f.proof, proofId: 'another-proof' },
        ];
      if (reason === 'closed') f.source.status = 'CLOSED';
      await expect(f.service.command('csr', ITEM, command(f))).rejects.toThrow(
        ConflictException,
      );
      expect(f.state).toEqual(before);
      expect(f.db.mailroomItem.update).not.toHaveBeenCalled();
      expect(f.db.mailroomProductMismatchFact.create).not.toHaveBeenCalled();
    },
  );
  it('revalidates an approval invalidated while waiting for the item lock', async () => {
    const f = fixture(),
      before = structuredClone(f.state);
    f.lock(() => {
      f.source.version = '2026-10-13T05:00:00.000Z';
      f.source.customerProductConfirmations = [];
    });
    await expect(f.service.command('csr', ITEM, command(f))).rejects.toThrow(
      '唯一顧客確認',
    );
    expect(f.sync.cases).toHaveBeenCalledTimes(2);
    expect(f.state).toEqual(before);
  });
  it.each(['clerk', 'other-csr'] as const)(
    'requires the currently assigned qualified CSR, rejecting %s',
    async (id) => {
      const f = fixture(),
        before = structuredClone(f.state);
      f.source.firstReviewErpActorId = id;
      await expect(f.service.command(id, ITEM, command(f))).rejects.toThrow(
        ForbiddenException,
      );
      expect(f.state).toEqual(before);
      expect(f.state.facts).toHaveLength(0);
    },
  );
  it('uses the new Source CSR assignment read after the lock', async () => {
    const f = fixture(),
      before = structuredClone(f.state);
    f.lock(() => {
      f.source.assigneeId = 'source-other-csr';
      f.source.assigneeEmail = 'other-csr@example.invalid';
    });
    await expect(f.service.command('csr', ITEM, command(f))).rejects.toThrow(
      '承辦客服',
    );
    expect(f.state).toEqual(before);
  });
  it.each(['actor', 'receipt', 'item'] as const)(
    'rejects a wrong %s company scope',
    async (scope) => {
      const f = fixture();
      if (scope === 'actor') f.actors.get('csr')!.entityIds = ['other-company'];
      if (scope === 'receipt') f.state.item.receipt.entityId = 'other-company';
      const input = command(f);
      if (scope === 'item') f.state.item.entityId = 'other-company';
      await expect(f.service.command('csr', ITEM, input)).rejects.toThrow(
        scope === 'actor'
          ? ForbiddenException
          : scope === 'receipt'
            ? ConflictException
            : NotFoundException,
      );
      expect(f.state.facts).toHaveLength(0);
      expect(f.db.mailroomItem.update).not.toHaveBeenCalled();
    },
  );
  it.each([
    [QA, 'true', true],
    [QA, undefined, false],
    [QA, 'TRUE', false],
    [QA, '1', false],
    ['company', 'true', false],
  ] as const)(
    'permits DEV_STUB only with exact sandbox flag/company (%s/%s)',
    async (entity, flag, allowed) => {
      const f = fixture('REPAIR', entity);
      f.proof.provider = 'DEV_STUB';
      if (flag === undefined) delete process.env.ERP_DEV_SANDBOX;
      else process.env.ERP_DEV_SANDBOX = flag;
      const result = f.service.command('csr', ITEM, command(f));
      if (allowed) {
        await expect(result).resolves.toMatchObject({ duplicate: false });
        expect(f.state.facts).toHaveLength(1);
      } else {
        await expect(result).rejects.toThrow(ConflictException);
        expect(f.state.facts).toHaveLength(0);
      }
    },
  );
  it('exact committed retry does not fetch another Source proof or duplicate facts/history, and changed content conflicts', async () => {
    const f = fixture(),
      input = command(f);
    await f.service.command('csr', ITEM, input);
    const before = structuredClone(f.state),
      reads = f.sync.cases.mock.calls.length;
    f.sync.cases.mockRejectedValue(new Error('offline Source'));
    await expect(f.service.command('csr', ITEM, input)).resolves.toMatchObject({
      duplicate: true,
    });
    await expect(
      f.service.command('csr', ITEM, { ...input, note: 'CHANGED' }),
    ).rejects.toThrow(ConflictException);
    expect(f.sync.cases).toHaveBeenCalledTimes(reads);
    expect(f.state).toEqual(before);
  });
  it('keeps the first immutable fact for a repeated approval of the same physical identity', async () => {
    const f = fixture();
    await f.service.command('csr', ITEM, command(f));
    const original = structuredClone(f.state.facts[0]);
    f.state.item.status = 'MISMATCH';
    f.proof.proofId = 'newer-proof';
    f.proof.planVersion++;
    f.source.firstReviewErpActorId = 'newer-reviewer';
    f.source.version = '2026-10-13T05:00:00.000Z';
    await f.service.command('csr', ITEM, command(f));
    expect(f.state.facts).toEqual([original]);
    expect(f.state.actions).toHaveLength(2);
  });
  it('rolls the fact and physical decision back when later history recording fails', async () => {
    const f = fixture(),
      before = structuredClone(f.state);
    f.failRecord();
    await expect(f.service.command('csr', ITEM, command(f))).rejects.toThrow(
      'injected record failure',
    );
    expect(f.trace).toEqual(
      expect.arrayContaining([
        'fact.create',
        'item.update',
        'history.create',
        'tx.rollback',
      ]),
    );
    expect(f.state).toEqual(before);
    expect(f.gateway.sendToUser).not.toHaveBeenCalled();
    expect(f.sync.deliverPending).not.toHaveBeenCalled();
  });
  it.each([
    'accept',
    'claim',
    'start_inspection',
    'await_customer',
    'start_repair',
    'complete_repair',
    'complete_refurbish',
    'stock',
    'dispatch',
  ] as const)(
    'requires fresh product approval before CONFIRMED_ACTUAL %s progresses',
    async (action) => {
      const f = fixture(
        ['complete_refurbish', 'stock'].includes(action) ? 'RETURN' : 'REPAIR',
      );
      const stages = {
        accept: 'WAITING_REPAIR_ACCEPTANCE',
        claim: 'WAITING_REPAIR_ACCEPTANCE',
        start_inspection: 'REPAIR_RECEIVED',
        await_customer: 'INSPECTING',
        start_repair: 'INSPECTING',
        complete_repair: 'REPAIRING',
        complete_refurbish: 'REFURBISHING',
        stock: 'PENDING_RESTOCK',
        dispatch: 'READY_FOR_DISPATCH',
      };
      f.confirmed(stages[action]);
      if (
        [
          'start_inspection',
          'await_customer',
          'start_repair',
          'complete_repair',
          'complete_refurbish',
        ].includes(action)
      )
        f.technician(stages[action]);
      f.state.item.nextUserId = 'tech';
      f.source.customerProductConfirmations = [];
      const before = structuredClone(f.state),
        user = ['stock', 'dispatch'].includes(action) ? 'clerk' : 'tech';
      await expect(
        f.service.command(
          user,
          ITEM,
          command(f, action, {
            confirmedItems: true,
            ...(action === 'dispatch' ? {} : { location: 'T1' }),
            carrier: 'SYNTHETIC',
            trackingNumber: 'SYNTHETIC-1',
          }),
        ),
      ).rejects.toThrow('唯一顧客確認');
      expect(f.state).toEqual(before);
      expect(f.db.mailroomItem.update).not.toHaveBeenCalled();
      expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
      expect(f.stock.receiveQualified).not.toHaveBeenCalled();
    },
  );
  it('allows a physical move without reopening product approval or changing the fact', async () => {
    const f = fixture();
    f.confirmed('INSPECTING');
    f.technician('INSPECTING');
    const original = structuredClone(f.state.facts);
    f.source.customerProductConfirmations = [];
    f.source.status = 'CLOSED';
    await f.service.command(
      'tech',
      ITEM,
      command(f, 'move', { location: 'T2' }),
    );
    expect(f.state.item.location).toBe('T2');
    expect(f.state.facts).toEqual(original);
    expect(f.sync.cases).not.toHaveBeenCalled();
  });
  it('voids the old fact and reopens a CSR mismatch task when same-count photos change', async () => {
    const f = fixture();
    f.confirmed();
    f.state.item.nextUserId = 'tech';
    f.state.tasks.push({
      id: 'prior-task',
      entityId: 'company',
      itemId: ITEM,
      userId: 'tech',
      kind: 'WAITING_REPAIR_ACCEPTANCE',
      status: 'OPEN',
      version: 7,
    });
    const oldProof = structuredClone(f.state.facts[0].proofSnapshot);
    await f.service.command(
      'clerk',
      ITEM,
      command(f, 'correct', {
        productName: f.state.item.productName,
        sku: f.state.item.sku,
        serialNumber: f.state.item.serialNumber,
        evidence: [PHOTO_C, PHOTO_B],
      }),
    );
    expect(f.state.facts).toEqual([
      expect.objectContaining({
        status: 'VOID',
        voidReason: 'PRODUCT_IDENTITY_CHANGED',
        proofSnapshot: oldProof,
      }),
    ]);
    expect(
      Number.isFinite(Date.parse(f.state.facts[0].voidedAt.toISOString())),
    ).toBe(true);
    expect(f.state.item).toMatchObject({
      status: 'MISMATCH',
      matchResult: 'MISMATCH',
      nextUserId: null,
    });
    expect(f.state.item.repairWorkflow).not.toHaveProperty('productDecision');
    expect(f.state.tasks.filter((row) => row.status === 'OPEN')).toEqual([
      expect.objectContaining({ userId: 'csr', kind: 'MISMATCH' }),
    ]);
    expect(f.state.tasks.find((row) => row.id === 'prior-task')!.status).toBe(
      'COMPLETED',
    );
    expect(f.sync.cases).not.toHaveBeenCalled();
  });
  it.each(['productName', 'sku', 'serialNumber'] as const)(
    'voids prior approval when correcting actual %s without uploading photos again',
    async (field) => {
      const f = fixture();
      f.confirmed();
      const previous = structuredClone(f.state.facts[0]);
      const input = command(f, 'correct', {
        productName: f.state.item.productName,
        sku: f.state.item.sku,
        serialNumber: f.state.item.serialNumber,
      });
      input[field] = 'SYNTHETIC-CHANGED';
      await f.service.command('clerk', ITEM, input);
      expect(f.state.item).toMatchObject({
        [field]: 'SYNTHETIC-CHANGED',
        status: 'MISMATCH',
        matchResult: 'MISMATCH',
        nextUserId: null,
      });
      expect(f.state.item.evidence).toEqual([PHOTO_A, PHOTO_B]);
      expect(f.state.item.repairWorkflow).not.toHaveProperty('productDecision');
      expect(f.state.facts).toHaveLength(1);
      expect(f.state.facts[0]).toMatchObject({
        status: 'VOID',
        voidReason: 'PRODUCT_IDENTITY_CHANGED',
        identityHash: previous.identityHash,
        proofSnapshot: previous.proofSnapshot,
      });
      expect(f.state.tasks.filter((row) => row.status === 'OPEN')).toEqual([
        expect.objectContaining({ userId: 'csr', kind: 'MISMATCH' }),
      ]);
      expect(f.sync.cases).not.toHaveBeenCalled();
    },
  );
  it.each(['complete_repair', 'complete_refurbish'] as const)(
    'rolls %s back when its newly supplied evidence no longer matches the accepted physical identity',
    async (action) => {
      const f = fixture(action === 'complete_repair' ? 'REPAIR' : 'RETURN');
      f.confirmed(action === 'complete_repair' ? 'REPAIRING' : 'REFURBISHING');
      f.technician(action === 'complete_repair' ? 'REPAIRING' : 'REFURBISHING');
      const before = structuredClone(f.state);
      await expect(
        f.service.command(
          'tech',
          ITEM,
          command(f, action, { evidence: [PHOTO_C, PHOTO_B] }),
        ),
      ).rejects.toThrow('重新取得顧客產品確認');
      expect(f.trace).toEqual(
        expect.arrayContaining(['fact.void', 'tx.rollback']),
      );
      expect(f.state).toEqual(before);
      expect(f.db.mailroomItem.update).not.toHaveBeenCalled();
      expect(f.state.deliveries).toHaveLength(0);
    },
  );
});
