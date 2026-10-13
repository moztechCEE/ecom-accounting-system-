import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MailroomService } from './mailroom.service';
import { type Actor, type SourceCase } from './mailroom.contract';
import {
  type InspectionDocument,
  type RepairDocument,
  type RepairData,
  inspectionPlanHash,
} from './repair-document.contract';
import {
  sentCustomerWorkflow,
  type RepairWorkflow,
} from './repair-workflow.contract';
import {
  repairSourceBindingForItem,
  validateRepairProposalEvent,
} from './repair-proposal.contract';
import { RepairPrerequisitesService } from './repair-prerequisites.service';
import { type MailroomCommandDto } from './mailroom.dto';

const ITEM = 'aaad7cc6-7273-4000-8abc-333333333333';
const RECEIPT = 'aaad7cc6-7273-4000-8abc-444444444444';
const TIME = '2026-10-13T04:00:00.000Z';
type Row = Record<string, any>;
const actor = (id: string): Actor => ({
  id,
  name: id,
  entityIds: ['company'],
  permissions: new Set(
    id === 'tech'
      ? ['repair_workbench:read', 'repair_workbench:update']
      : id === 'csr'
        ? ['mailroom:read', 'mailroom:review']
        : ['mailroom:read', 'mailroom:update'],
  ),
});
function inspection(fee: 'FREE' | 'PAID' = 'PAID'): InspectionDocument {
  return {
    number: 'INS-REPAIR-001',
    revision: 3,
    status: 'SUBMITTED',
    authorId: 'tech',
    authorName: 'tech',
    submittedAt: TIME,
    updatedAt: TIME,
    data: {
      complaint: '無法開機',
      reproduction: 'YES',
      testConditions: '原廠電源',
      checks: [
        { name: '開機', result: 'FAIL', observation: '供電正常仍不啟動' },
      ],
      diagnosis: '電源模組故障',
      causeStatus: 'CONFIRMED',
      plan: 'REPAIR',
      planNote: '更換電源模組後複驗',
      feeSuggestion: fee,
      estimateAmount: fee === 'PAID' ? 500.01 : 0,
      estimateNote: '電源模組與工資',
    },
  };
}
/** Native tables and the event outbox commit/rollback together; no Prisma connection or HTTP exists. */
function fixture(fee: 'FREE' | 'PAID' = 'PAID') {
  const source: SourceCase = {
    id: 'same-case',
    number: 'CASE-001',
    type: 'REPAIR',
    brand: 'MOZTECH',
    version: TIME,
    status: 'INSPECTING',
    customerLabel: 'SYNTHETIC',
    repairAllowed: false,
    assigneeId: 'csr',
    assigneeName: 'csr',
    assigneeEmail: 'csr@example.invalid',
    releaseInfo: {
      quoteRevision: 4,
      customerApprovedQuoteRevision: 4,
      customerApprovedAt: TIME,
      amount: fee === 'PAID' ? 500.01 : 0,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: fee === 'PAID' ? 4 : null,
      invoiceRequired: fee === 'PAID',
      invoiceStatus: 'ISSUED',
      invoiceSatisfied: true,
      invoiceQuoteRevision: 4,
      quoteBindings: [],
    },
    items: [
      {
        id: 'source-line',
        name: '申報產品',
        sku: 'DECLARED-SKU',
        serialNumber: null,
        quantity: 2,
      },
    ],
  };
  let state: {
    item: Row;
    actions: Row[];
    tasks: Row[];
    notifications: Row[];
    deliveries: Row[];
  } = {
    item: {
      id: ITEM,
      entityId: 'company',
      receiptId: RECEIPT,
      label: 'REPAIR-001',
      version: 9,
      status: 'INSPECTING',
      productName: '合成測試產品',
      productId: 'erp-product',
      sku: 'ORIGINAL-SKU',
      serialNumber: 'ORIGINAL-SN',
      barcode: null,
      declared: { id: 'source-line' },
      location: '維修桌',
      repairOwnerId: 'tech',
      custodianId: 'tech',
      nextUserId: 'tech',
      recipientId: null,
      conditionNote: null,
      matchResult: 'MATCH',
      grade: null,
      disposition: null,
      evidence: [],
      repairInspection: inspection(fee),
      repairReport: null,
      receipt: {
        id: RECEIPT,
        category: 'REPAIR',
        sourceCaseId: source.id,
        sourceNumber: source.number,
        sourceSnapshot: structuredClone(source),
        receivedById: 'clerk',
        customerServiceUserId: 'csr',
        receivedAt: new Date(TIME),
      },
    },
    actions: [],
    tasks: [],
    notifications: [],
    deliveries: [],
  };
  const trace: string[] = [];
  let onLock: (() => void) | undefined;
  let failProposal = false;
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
    mailroomAction: {
      findUnique: jest.fn(async ({ where }: Row) => {
        const key = where.entityId_actorId_requestId;
        return structuredClone(
          state.actions.find(
            (row) =>
              row.entityId === key.entityId &&
              row.actorId === key.actorId &&
              row.requestId === key.requestId,
          ) || null,
        );
      }),
      create: jest.fn(async ({ data }: Row) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          ...structuredClone(data),
        };
        state.actions.push(row);
        trace.push('history.create');
        return structuredClone(row);
      }),
    },
    mailroomTask: {
      findMany: jest.fn(async () => structuredClone(state.tasks)),
      create: jest.fn(async ({ data }: Row) => {
        const row = {
          id: randomUUID(),
          status: 'OPEN',
          ...structuredClone(data),
        };
        state.tasks.push(row);
        return structuredClone(row);
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async () => ({})),
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
        for (const value of data) {
          state.deliveries.push(structuredClone(value));
          trace.push(
            value.payload.kind === 'REPAIR_PROPOSAL'
              ? 'proposal.enqueue'
              : 'progress.enqueue',
          );
          if (failProposal && value.payload.kind === 'REPAIR_PROPOSAL')
            throw new Error('injected proposal outbox failure');
        }
        return { count: data.length };
      }),
    },
    $queryRaw: jest.fn(async () => {
      trace.push('lock');
      if (onLock) {
        const hook = onLock;
        onLock = undefined;
        hook();
      }
      return [];
    }),
    $executeRaw: jest.fn(async () => 1),
    employee: { findFirst: jest.fn(async () => ({ id: 'employee-tech' })) },
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
    consumeForRepair: jest
      .fn()
      .mockRejectedValue(new Error('unexpected replacement stock')),
  };
  // This suite isolates shared transaction ordering; actual registry/material
  // readiness is exercised by RepairPrerequisitesService's producer-backed spec.
  const prerequisites = {
    require: jest.fn((_item: unknown, stage: string) => {
      trace.push('prerequisites.' + stage);
      return Promise.resolve(undefined);
    }),
  };
  const service = new MailroomService(
    db,
    gateway as any,
    sync as any,
    stock as any,
    undefined,
    prerequisites as unknown as RepairPrerequisitesService,
  );
  jest.spyOn(service, 'actor').mockImplementation(async (id) => actor(id));
  jest.spyOn(service as any, 'customerService').mockResolvedValue('csr');
  return {
    service,
    db,
    sync,
    gateway,
    stock,
    prerequisites,
    source,
    trace,
    get state() {
      return state;
    },
    lock(hook: () => void) {
      onLock = hook;
    },
    failProposal() {
      failProposal = true;
    },
    reviewed(status: 'INSPECTING' | 'REPAIRING' = 'INSPECTING') {
      state.item.status = status;
      const workflow = sentCustomerWorkflow(
        state.item as any,
        actor('tech'),
        TIME,
        4,
      );
      state.item.repairWorkflow = {
        ...workflow,
        csr: {
          ...workflow.csr,
          status: 'RESOLVED',
          ownerId: 'csr',
          acceptedAt: TIME,
          resolvedAt: TIME,
          decision: 'APPROVE',
        },
      };
      state.item.repairInspection.review = {
        inspectionRevision: 3,
        actorId: 'csr',
        name: 'csr',
        confirmedAt: TIME,
        decision: 'APPROVE',
        planHash: inspectionPlanHash(state.item.repairInspection),
        quoteRevision: 4,
      };
      source.repairAllowed = true;
      const binding = repairSourceBindingForItem(state.item as any, source);
      state.item.repairWorkflow.csr.proposalHash = binding.proposalHash;
      source.releaseInfo!.quoteBindings = [{ ...binding, quoteRevision: 4 }];
      state.item.repairReport = {
        number: 'REP-REPAIR-001',
        revision: 1,
        inspectionRevision: 3,
        status: 'SUBMITTED',
        authorId: 'tech',
        authorName: 'tech',
        updatedAt: TIME,
        submittedAt: TIME,
        data: {
          outcome: 'REPAIRED',
          workPerformed: '更換電源模組',
          parts: [],
          laborMinutes: 15,
          checks: [{ name: '開機', result: 'PASS', observation: '可正常開機' }],
          qcResult: 'PASS',
          qcNotes: '正常',
          deliveredAccessories: '配件完整',
        },
      };
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
type NativeItem = {
  status: string;
  receipt: { category: string };
  repairInspection: InspectionDocument;
  repairReport: RepairDocument<RepairData>;
  repairWorkflow: RepairWorkflow;
};
const native = (f: Fixture) => f.state.item as NativeItem;
const writes = (f: Fixture) =>
  f.db as {
    mailroomItem: { update: jest.Mock };
    mailroomAction: { create: jest.Mock };
    mailroomDelivery: { createMany: jest.Mock };
  };
const command = (
  f: Fixture,
  action: MailroomCommandDto['action'],
): MailroomCommandDto => ({
  entityId: 'company',
  requestId: randomUUID(),
  expectedVersion: f.state.item.version,
  action,
  note: 'SYNTHETIC 具體確認紀錄',
});

describe('shared native Mailroom repair closure hooks', () => {
  const originalEnabled = process.env.MAILROOM_ENABLED;
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
  });
  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = originalEnabled;
  });
  it('commits the exact server-built proposal and CSR hash with the customer handoff in one transaction', async () => {
    const f = fixture(),
      input = command(f, 'await_customer');
    await f.service.command('tech', ITEM, input);
    expect(f.state.item).toMatchObject({
      status: 'WAITING_CUSTOMER',
      version: 10,
      nextUserId: null,
    });
    const proposals = f.state.deliveries.filter(
      (value) => value.payload.kind === 'REPAIR_PROPOSAL',
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      target: 'AFTER_SALES',
      entityId: 'company',
      itemId: ITEM,
    });
    const event = validateRepairProposalEvent(proposals[0].payload);
    expect(event).toMatchObject({
      itemId: ITEM,
      receiptId: RECEIPT,
      version: 10,
      sourceCaseId: f.source.id,
      proposal: {
        inspectionDocumentId: 'INS-REPAIR-001',
        inspectionRevision: 3,
        amount: 500.01,
        currency: 'TWD',
        original: {
          sourceItemId: 'source-line',
          serialNumber: 'ORIGINAL-SN',
          quantity: 1,
        },
      },
    });
    expect(event).not.toHaveProperty('sourceVersion');
    expect(f.state.item.repairWorkflow.csr).toMatchObject({
      status: 'SENT',
      proposalHash: event.proposal.proposalHash,
      inspectionRevision: 3,
      quoteRevision: 4,
    });
    expect(f.state.actions).toHaveLength(1);
    expect(f.state.tasks).toEqual([
      expect.objectContaining({
        userId: 'csr',
        kind: 'WAITING_CUSTOMER',
        version: 10,
      }),
    ]);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 20000,
    });
    expect(f.trace.indexOf('proposal.enqueue')).toBeLessThan(
      f.trace.indexOf('tx.commit'),
    );
    const reads = f.sync.cases.mock.calls.length,
      before = structuredClone(f.state);
    await expect(f.service.command('tech', ITEM, input)).resolves.toMatchObject(
      { duplicate: true },
    );
    expect(f.sync.cases).toHaveBeenCalledTimes(reads);
    expect(f.state).toEqual(before);
  });
  it('rolls back the CSR state, history, staff tasks and both outboxes when proposal enqueue fails', async () => {
    const f = fixture(),
      before = structuredClone(f.state);
    f.failProposal();
    await expect(
      f.service.command('tech', ITEM, command(f, 'await_customer')),
    ).rejects.toThrow('injected proposal');
    expect(f.trace).toEqual(
      expect.arrayContaining([
        'item.update',
        'history.create',
        'progress.enqueue',
        'proposal.enqueue',
        'tx.rollback',
      ]),
    );
    expect(f.state).toEqual(before);
    expect(f.gateway.sendToUser).not.toHaveBeenCalled();
    expect(f.sync.deliverPending).not.toHaveBeenCalled();
  });
  it.each(['start_repair', 'complete_repair'] as const)(
    'allows %s only with the current CSR, per-item quote, payment and invoice release',
    async (action) => {
      const f = fixture();
      f.reviewed(action === 'start_repair' ? 'INSPECTING' : 'REPAIRING');
      await f.service.command('tech', ITEM, command(f, action));
      expect(f.state.item.status).toBe(
        action === 'start_repair' ? 'REPAIRING' : 'WAITING_RETURN_ACCEPTANCE',
      );
      expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
      expect(f.prerequisites.require).toHaveBeenCalledWith(
        expect.objectContaining({ id: ITEM, entityId: 'company' }),
        action === 'start_repair' ? 'START' : 'COMPLETION',
        f.db,
      );
      expect(
        f.trace.indexOf(
          'prerequisites.' +
            (action === 'start_repair' ? 'START' : 'COMPLETION'),
        ),
      ).toBeLessThan(f.trace.indexOf('item.update'));
    },
  );
  const corporate = (f: Fixture) => {
    f.reviewed('REPAIRING');
    native(f).receipt.category = 'RETURN';
    f.state.item.status = 'REFURBISHING';
    native(f).repairWorkflow.csr!.quoteRevision = null;
    native(f).repairInspection.review!.quoteRevision = null;
    native(f).repairWorkflow.workStart = {
      schema: 'corely.repair.work-start.v1',
      kind: 'REFURBISHMENT',
      entityId: 'company',
      itemId: ITEM,
      inspectionRevision: 3,
      planHash: inspectionPlanHash(native(f).repairInspection),
      ownerId: 'tech',
      custodianId: 'tech',
      startedById: 'tech',
      startedAt: TIME,
    };
  };
  it('allows completion from true current corporate work-start proof without borrowing customer Source finance', async () => {
    const f = fixture();
    corporate(f);
    f.sync.cases.mockRejectedValue(new Error('customer source unavailable'));
    await f.service.command('tech', ITEM, command(f, 'complete_refurbish'));
    expect(f.prerequisites.require).toHaveBeenCalledWith(
      expect.objectContaining({ id: ITEM }),
      'COMPLETION',
      f.db,
    );
    expect(f.state.item.status).toBe('WAITING_RETURN_ACCEPTANCE');
    expect(native(f).repairWorkflow.release).toMatchObject({
      purpose: 'REPAIRED',
    });
    expect(f.sync.cases).not.toHaveBeenCalled();
  });
  it.each([
    'absent',
    'stale-hash',
    'foreign-item',
    'wrong-person',
    'future',
    'non-null-quote',
  ])(
    'blocks corporate completion with %s work-start evidence before readiness or any release',
    async (change) => {
      const f = fixture();
      corporate(f);
      const proof = native(f).repairWorkflow.workStart!;
      if (change === 'absent') delete native(f).repairWorkflow.workStart;
      if (change === 'stale-hash') proof.planHash = '0'.repeat(64);
      if (change === 'foreign-item') proof.itemId = randomUUID();
      if (change === 'wrong-person') proof.startedById = 'other';
      if (change === 'future')
        proof.startedAt = new Date(Date.now() + 86400000).toISOString();
      if (change === 'non-null-quote') {
        native(f).repairWorkflow.csr!.quoteRevision = 4;
        native(f).repairInspection.review!.quoteRevision = 4;
      }
      const before = structuredClone(f.state);
      await expect(
        f.service.command('tech', ITEM, command(f, 'complete_refurbish')),
      ).rejects.toThrow(ConflictException);
      expect(f.state).toEqual(before);
      expect(f.prerequisites.require).not.toHaveBeenCalled();
      expect(writes(f).mailroomItem.update).not.toHaveBeenCalled();
      expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
      expect(f.gateway.sendToUser).not.toHaveBeenCalled();
    },
  );
  it.each(['start_repair', 'complete_repair', 'complete_refurbish'] as const)(
    'rejects %s readiness before native mutation, release, OUT, history or outbound delivery',
    async (action) => {
      const f = fixture();
      if (action === 'complete_refurbish') corporate(f);
      else f.reviewed(action === 'start_repair' ? 'INSPECTING' : 'REPAIRING');
      f.prerequisites.require.mockRejectedValue(
        new ConflictException('actual prerequisites blocked'),
      );
      const before = structuredClone(f.state);
      await expect(
        f.service.command('tech', ITEM, command(f, action)),
      ).rejects.toThrow('actual prerequisites blocked');
      expect(f.state).toEqual(before);
      expect(f.prerequisites.require).toHaveBeenCalledWith(
        expect.objectContaining({ id: ITEM }),
        action === 'start_repair' ? 'START' : 'COMPLETION',
        f.db,
      );
      expect(writes(f).mailroomItem.update).not.toHaveBeenCalled();
      expect(writes(f).mailroomAction.create).not.toHaveBeenCalled();
      expect(writes(f).mailroomDelivery.createMany).not.toHaveBeenCalled();
      expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
      expect(f.gateway.sendToUser).not.toHaveBeenCalled();
      expect(f.sync.deliverPending).not.toHaveBeenCalled();
    },
  );
  it('rejects replacement completion readiness before formal stock OUT is attempted', async () => {
    const f = fixture();
    Object.assign(native(f).repairInspection.data, {
      plan: 'REPLACE',
      replacementSku: 'REPLACEMENT-SKU',
      replacementCondition: 'REFURBISHED',
    });
    f.reviewed('REPAIRING');
    Object.assign(native(f).repairReport.data, {
      outcome: 'REPLACED',
      replacementSku: 'REPLACEMENT-SKU',
      replacementCondition: 'REFURBISHED',
      replacementSerial: 'REPLACEMENT-SN',
      replacementSource: '合成合格整新品',
      originalDisposition: '原件待處置',
    });
    f.prerequisites.require.mockRejectedValue(
      new ConflictException('completion materials not settled'),
    );
    const before = structuredClone(f.state);
    await expect(
      f.service.command('tech', ITEM, command(f, 'complete_repair')),
    ).rejects.toThrow('completion materials not settled');
    expect(f.state).toEqual(before);
    expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
    expect(writes(f).mailroomItem.update).not.toHaveBeenCalled();
    expect(writes(f).mailroomAction.create).not.toHaveBeenCalled();
    expect(writes(f).mailroomDelivery.createMany).not.toHaveBeenCalled();
  });

  it.each(['FREE', 'PAID'] as const)(
    'blocks legacy no-CSR %s customer repair at both start and completion',
    async (fee) => {
      for (const action of ['start_repair', 'complete_repair'] as const) {
        const f = fixture(fee);
        f.reviewed(action === 'start_repair' ? 'INSPECTING' : 'REPAIRING');
        delete f.state.item.repairWorkflow;
        const before = structuredClone(f.state);
        await expect(
          f.service.command('tech', ITEM, command(f, action)),
        ).rejects.toThrow(ConflictException);
        expect(f.state).toEqual(before);
        expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
      }
    },
  );
  it.each(['start_repair', 'complete_repair'] as const)(
    'blocks %s with no linked authoritative Source case',
    async (action) => {
      const f = fixture();
      f.reviewed(action === 'start_repair' ? 'INSPECTING' : 'REPAIRING');
      f.state.item.receipt.sourceCaseId = null;
      const before = structuredClone(f.state);
      await expect(
        f.service.command('tech', ITEM, command(f, action)),
      ).rejects.toThrow(ConflictException);
      expect(f.state).toEqual(before);
      expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
    },
  );
  it.each(['start_repair', 'complete_repair'] as const)(
    'rechecks the latest Source release after the %s row lock',
    async (action) => {
      const f = fixture();
      f.reviewed(action === 'start_repair' ? 'INSPECTING' : 'REPAIRING');
      f.lock(() => {
        f.source.version = '2026-10-13T05:00:00.000Z';
        f.source.repairAllowed = false;
        f.source.releaseInfo!.customerApprovedQuoteRevision = null;
      });
      const before = structuredClone(f.state);
      await expect(
        f.service.command('tech', ITEM, command(f, action)),
      ).rejects.toThrow(ConflictException);
      expect(f.state).toEqual(before);
      expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
    },
  );
  it('rejects a Source case closed while awaiting the proposal row lock', async () => {
    const f = fixture(),
      before = structuredClone(f.state);
    f.lock(() => {
      f.source.status = 'CLOSED';
      f.source.version = '2026-10-13T05:00:00.000Z';
    });
    await expect(
      f.service.command('tech', ITEM, command(f, 'await_customer')),
    ).rejects.toThrow(ConflictException);
    expect(f.state).toEqual(before);
  });
  it('builds the proposal from the authoritative currency and quote revision read after the lock', async () => {
    const f = fixture();
    f.lock(() => {
      f.source.version = '2026-10-13T05:00:00.000Z';
      f.source.releaseInfo!.currency = 'USD';
      f.source.releaseInfo!.quoteRevision = 5;
    });
    await f.service.command('tech', ITEM, command(f, 'await_customer'));
    const proposal = f.state.deliveries.find(
      (value) => value.payload.kind === 'REPAIR_PROPOSAL',
    )!.payload;
    expect(validateRepairProposalEvent(proposal).proposal.currency).toBe('USD');
    expect(f.state.item.repairWorkflow.csr.quoteRevision).toBe(5);
    expect(f.state.item.repairWorkflow.csr.proposalHash).toBe(
      proposal.proposal.proposalHash,
    );
  });
  it.each([
    ['start_repair', 'write'],
    ['start_repair', 'entity'],
    ['complete_repair', 'write'],
    ['complete_repair', 'entity'],
    ['await_customer', 'write'],
    ['await_customer', 'entity'],
  ] as const)(
    'rechecks %s actor %s authority in the same transaction after Source refresh',
    async (action, change) => {
      const f = fixture();
      if (action !== 'await_customer')
        f.reviewed(action === 'start_repair' ? 'INSPECTING' : 'REPAIRING');
      const revoked = actor('tech');
      if (change === 'write')
        revoked.permissions.delete('repair_workbench:update');
      else revoked.entityIds = ['other-company'];
      jest
        .mocked(f.service.actor)
        .mockResolvedValueOnce(actor('tech'))
        .mockResolvedValueOnce(actor('tech'))
        .mockResolvedValueOnce(revoked);
      const before = structuredClone(f.state);
      await expect(
        f.service.command('tech', ITEM, command(f, action)),
      ).rejects.toThrow(ForbiddenException);
      expect(f.service.actor).toHaveBeenNthCalledWith(3, 'tech', f.db);
      expect(f.state).toEqual(before);
    },
  );
  it.each(['start_repair', 'complete_repair'] as const)(
    'replays exact %s with zero new Source reads after an external outage, but rejects changed body',
    async (action) => {
      const f = fixture();
      f.reviewed(action === 'start_repair' ? 'INSPECTING' : 'REPAIRING');
      const input = command(f, action);
      await f.service.command('tech', ITEM, input);
      const reads = f.sync.cases.mock.calls.length,
        evidenceReads = f.prerequisites.require.mock.calls.length,
        before = structuredClone(f.state);
      f.prerequisites.require.mockRejectedValue(
        new ConflictException(
          'changed prerequisites after committed operation',
        ),
      );
      f.sync.cases.mockRejectedValue(new Error('offline Source'));
      await expect(
        f.service.command('tech', ITEM, input),
      ).resolves.toMatchObject({ duplicate: true });
      await expect(
        f.service.command('tech', ITEM, { ...input, note: 'CHANGED' }),
      ).rejects.toThrow(ConflictException);
      expect(f.sync.cases).toHaveBeenCalledTimes(reads);
      expect(f.prerequisites.require).toHaveBeenCalledTimes(evidenceReads);
      expect(f.state).toEqual(before);
      expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
    },
  );
  it.each([
    'invoice-pending',
    'invoice-revision',
    'invoice-unsatisfied',
    'invoice-missing-requirement',
    'sibling-binding',
    'plan-hash',
    'proposal-hash',
    'duplicate-binding',
  ] as const)(
    'blocks invalid %s release at both start and completion',
    async (change) => {
      for (const action of ['start_repair', 'complete_repair'] as const) {
        const f = fixture();
        f.reviewed(action === 'start_repair' ? 'INSPECTING' : 'REPAIRING');
        const info = f.source.releaseInfo!;
        if (change === 'invoice-pending') info.invoiceStatus = 'PENDING';
        if (change === 'invoice-revision') info.invoiceQuoteRevision = 3;
        if (change === 'invoice-unsatisfied') info.invoiceSatisfied = false;
        if (change === 'invoice-missing-requirement')
          delete info.invoiceRequired;
        if (change === 'sibling-binding')
          info.quoteBindings![0].itemId = randomUUID();
        if (change === 'plan-hash')
          info.quoteBindings![0].planHash = 'a'.repeat(64);
        if (change === 'proposal-hash')
          info.quoteBindings![0].proposalHash = 'a'.repeat(64);
        if (change === 'duplicate-binding')
          info.quoteBindings!.push({ ...info.quoteBindings![0] });
        const before = structuredClone(f.state);
        await expect(
          f.service.command('tech', ITEM, command(f, action)),
        ).rejects.toThrow(ConflictException);
        expect(f.state).toEqual(before);
        expect(f.stock.consumeForRepair).not.toHaveBeenCalled();
      }
    },
  );
});
