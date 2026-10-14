import type { PrismaService } from '../../common/prisma/prisma.service';
import type { MailroomSyncService } from './mailroom-sync.service';
import { type Actor, type SourceCase } from './mailroom.contract';
import { repairEvidenceFixture } from './repair-evidence.test.fixture';
import {
  MailroomService,
  REPAIR_LIST_SOURCE_CONCURRENCY,
  REPAIR_LIST_SOURCE_DEADLINE_MS,
} from './mailroom.service';
import { repairSourceBindingForItem } from './repair-proposal.contract';

type Item = Parameters<MailroomService['views']>[0][number];
const COMPANY = 'synthetic-erp-company';
const actor = (permissions = ['repair_workbench:read']): Actor => ({
  id: 'tech',
  name: 'Synthetic technician',
  entityIds: [COMPANY],
  permissions: new Set(permissions),
});
function fixture(id = 'piece', sourceId = 'synthetic-case') {
  const existing = repairEvidenceFixture();
  const source = structuredClone(existing.source) as SourceCase;
  source.id = sourceId;
  source.number = 'SYNTHETIC-' + sourceId;
  const rawIdentity = source.releaseInfo as NonNullable<
    SourceCase['releaseInfo']
  > & { customerIdentity: { caseId: string } };
  rawIdentity.customerIdentity.caseId = sourceId;
  const item = {
    ...structuredClone(existing.item),
    id,
    status: 'WAITING_CUSTOMER',
    recipientId: null,
    nextUserId: 'tech',
    evidence: [],
    location: 'Synthetic shelf',
    receipt: {
      ...existing.item.receipt,
      entityId: COMPANY,
      id: 'synthetic-receipt',
      number: 'MR-SYNTHETIC',
      receivedById: 'clerk',
      sourceCaseId: sourceId,
      sourceNumber: source.number,
      carrier: null,
      trackingNumber: null,
      senderLabel: 'Synthetic sender',
      receivedAt: new Date('2026-10-13T00:00:00Z'),
      sourceSnapshot: structuredClone(source),
    },
  } as unknown as Item;
  const binding = repairSourceBindingForItem(item, source);
  source.releaseInfo!.quoteBindings = [
    { ...binding, quoteRevision: source.releaseInfo!.quoteRevision },
  ];
  return { item, source, binding };
}
function current(row: Item) {
  return {
    id: row.id,
    entityId: row.entityId,
    version: row.version,
    status: row.status,
    receiptId: row.receiptId,
    receipt: {
      entityId: row.receipt.entityId,
      category: row.receipt.category,
      sourceCaseId: row.receipt.sourceCaseId,
      sourceNumber: row.receipt.sourceNumber,
    },
  };
}
function harness(fixtures = [fixture()]) {
  const rows = fixtures.map((f) => f.item);
  const nativeRead = jest.fn<Promise<ReturnType<typeof current>[]>, []>(() =>
    Promise.resolve(rows.map(current)),
  );
  const sources = new Map(fixtures.map((f) => [f.source.id, f.source]));
  const sync = {
    cases: jest.fn((entityId: string, search: string, id: string) =>
      Promise.resolve({ items: sources.has(id) ? [sources.get(id)] : [] }),
    ),
  };
  const prisma = {
    mailroomItem: {
      findMany: jest.fn((args: { select?: unknown }) =>
        args.select ? nativeRead() : Promise.resolve(rows),
      ),
      count: jest.fn().mockResolvedValue(rows.length),
      update: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    mailroomAction: { create: jest.fn() },
    mailroomDelivery: { create: jest.fn() },
  };
  const service = new MailroomService(
    prisma as unknown as PrismaService,
    {} as never,
    sync as unknown as MailroomSyncService,
  );
  jest.spyOn(service, 'enabled').mockImplementation(() => undefined);
  jest.spyOn(service, 'actor').mockResolvedValue(actor());
  const views = () =>
    service.views(rows, 'tech', actor(), {
      repairOverview: true,
      repairProgress: true,
    });
  return { service, prisma, sync, rows, sources, nativeRead, views };
}

describe('repair list fresh, scoped, read-only progress projection', () => {
  afterEach(() => jest.useRealTimers());

  it.each(['SENT', 'ACCEPTED', 'RESOLVED'] as const)(
    'projects current quote evidence during CSR %s without authorizing a command',
    async (status) => {
      const f = fixture();
      const workflow = f.item.repairWorkflow as Record<string, unknown>;
      (workflow.csr as Record<string, unknown>).status = status;
      const h = harness([f]);
      const before = structuredClone(f.item);
      const result = await h.service.list('tech', {
        entityId: COMPANY,
        view: 'repair',
        repairScope: 'waiting',
      });
      expect(result.items[0]).toMatchObject({
        release: {
          available: true,
          sourceCaseId: f.source.id,
          caseBrand: 'MOZTECH',
          repairAllowed: true,
          releaseInfo: {
            quoteRevision: 4,
            customerApprovedQuoteRevision: 4,
            confirmedPaymentQuoteRevision: 4,
            invoiceRequired: true,
            invoiceStatus: 'ISSUED',
            invoiceSatisfied: true,
            invoiceQuoteRevision: 4,
          },
        },
        repairProposalBinding: f.binding,
      });
      expect(h.sync.cases).toHaveBeenCalledWith(COMPANY, '', f.source.id);
      expect(h.prisma.mailroomItem.update).not.toHaveBeenCalled();
      expect(h.prisma.mailroomAction.create).not.toHaveBeenCalled();
      expect(h.prisma.mailroomDelivery.create).not.toHaveBeenCalled();
      expect(f.item).toEqual(before);
    },
  );

  it('allows pending consent, payment and invoice only as current evidence, never synthesized completion', async () => {
    const f = fixture();
    Object.assign(f.source.releaseInfo!, {
      customerApprovedQuoteRevision: null,
      customerApprovedAt: null,
      confirmedPaymentQuoteRevision: null,
      invoiceStatus: 'PENDING',
      invoiceSatisfied: false,
      invoiceQuoteRevision: null,
    });
    f.source.repairAllowed = false;
    const [row] = await harness([f]).views();
    expect(row.release).toMatchObject({
      available: true,
      repairAllowed: false,
      releaseInfo: {
        customerApprovedQuoteRevision: null,
        confirmedPaymentQuoteRevision: null,
        invoiceStatus: 'PENDING',
        invoiceSatisfied: false,
      },
    });
  });

  it('distinguishes a successful no-quote read from an unavailable source', async () => {
    const f = fixture();
    f.source.releaseInfo = null;
    // Native snapshots establish no current positive release evidence.
    f.item.receipt.sourceSnapshot = {};
    const [row] = await harness([f]).views();
    expect(row.release).toMatchObject({
      available: true,
      repairAllowed: false,
      releaseInfo: null,
    });
    expect(row.repairProposalBinding).toBeNull();
  });

  it.each([null, []])(
    'retains the actual Source initial revision-1 placeholder with bindings %j as a successful unquoted read',
    async (quoteBindings) => {
      const f = fixture();
      f.source.status = 'INSPECTING';
      f.source.repairAllowed = false;
      Object.assign(f.source.releaseInfo!, {
        quoteRevision: 1,
        customerApprovedQuoteRevision: null,
        customerApprovedAt: null,
        amount: null,
        confirmedPaymentQuoteRevision: null,
        invoiceRequired: false,
        invoiceStatus: 'NOT_REQUIRED',
        invoiceSatisfied: true,
        invoiceQuoteRevision: null,
        quotePlanVersion: null,
        quotePlanHash: null,
        quoteBindings,
      });
      const [row] = await harness([f]).views();
      expect(row.release).toMatchObject({
        available: true,
        repairAllowed: false,
        releaseInfo: {
          quoteRevision: 1,
          amount: null,
          quotePlanVersion: null,
          quotePlanHash: null,
          quoteBindings,
        },
      });
      expect(row.repairProposalBinding).toBeNull();
    },
  );

  it.each([
    ['later revision', { quoteRevision: 2 }],
    ['old amount', { amount: 500 }],
    ['old plan version', { quotePlanVersion: 3 }],
    ['old plan hash', { quotePlanHash: 'a'.repeat(64) }],
    ['old consent', { customerApprovedQuoteRevision: 1 }],
    ['old consent date', { customerApprovedAt: '2026-10-13T00:00:00Z' }],
    ['old payment', { confirmedPaymentQuoteRevision: 1 }],
    ['required invoice', { invoiceRequired: true }],
    ['issued invoice', { invoiceStatus: 'ISSUED' }],
  ] as const)(
    'does not mistake %s for an initial unquoted placeholder',
    async (_name, change) => {
      const f = fixture();
      f.source.status = 'INSPECTING';
      f.source.repairAllowed = false;
      Object.assign(f.source.releaseInfo!, {
        quoteRevision: 1,
        amount: null,
        quotePlanVersion: null,
        quotePlanHash: null,
        quoteBindings: null,
        customerApprovedQuoteRevision: null,
        customerApprovedAt: null,
        confirmedPaymentQuoteRevision: null,
        invoiceRequired: false,
        invoiceStatus: 'NOT_REQUIRED',
        ...change,
      });
      const [row] = await harness([f]).views();
      expect(row.release).toEqual({ available: false });
      expect(row.repairProposalBinding).toBeNull();
    },
  );

  it('uses the signed ERP entity scope while retaining the distinct Source company namespace and excluding private fields', async () => {
    const f = fixture();
    Object.assign(f.source.releaseInfo!, {
      providerKey: 'PRIVATE-PROVIDER',
      customerDecisions: [{ privateNote: 'PRIVATE-DECISION' }],
    });
    const [row] = await harness([f]).views();
    expect(row.release?.available).toBe(true);
    const projection = JSON.stringify({
      release: row.release,
      binding: row.repairProposalBinding,
    });
    for (const value of [
      'customerIdentity',
      'verifiedCustomerId',
      'synthetic-source-company',
      'PRIVATE-PROVIDER',
      'PRIVATE-DECISION',
      'customerLabel',
      'customerPhone',
    ])
      expect(projection).not.toContain(value);
  });

  it('deduplicates an exact company/source read for multiple independently bound pieces', async () => {
    const first = fixture('piece-1');
    const second = fixture('piece-2');
    first.source.items[0].quantity = 2;
    first.source.releaseInfo!.quoteBindings!.push({
      ...second.binding,
      quoteRevision: 4,
    });
    const h = harness([first, second]);
    h.sources.set(first.source.id, first.source);
    const result = await h.views();
    expect(h.sync.cases).toHaveBeenCalledTimes(1);
    expect(result.map((row) => row.release?.available)).toEqual([true, true]);
    expect(result[0].release?.releaseInfo?.quoteBindings).toHaveLength(1);
    expect(result[1].repairProposalBinding?.itemId).toBe(second.item.id);
  });

  it.each([
    'wrong-id',
    'wrong-number',
    'wrong-type',
    'unknown-brand',
    'changed-brand',
    'foreign-source-company',
    'foreign-identity-case',
    'foreign-identity-brand',
    'older-source',
    'malformed-release',
    'missing-binding',
    'duplicate-binding',
    'old-plan',
    'old-proposal',
    'old-quote',
    'changed-native-plan',
  ])(
    'returns unknown for %s without falling back to the positive receipt snapshot',
    async (kind) => {
      const f = fixture();
      const source = f.source as unknown as Record<string, unknown>;
      const info = f.source.releaseInfo! as NonNullable<
        SourceCase['releaseInfo']
      > & {
        customerIdentity: { companyId: string; caseId: string; brand: string };
      };
      const binding = info.quoteBindings![0];
      if (kind === 'wrong-id') source.id = 'foreign-case';
      if (kind === 'wrong-number') source.number = 'foreign-case-number';
      if (kind === 'wrong-type') source.type = 'RETURN';
      if (kind === 'unknown-brand') source.caseBrand = null;
      if (kind === 'changed-brand') source.caseBrand = 'BONSON';
      if (kind === 'foreign-source-company')
        info.customerIdentity.companyId = 'foreign-company';
      if (kind === 'foreign-identity-case')
        info.customerIdentity.caseId = 'foreign-case';
      if (kind === 'foreign-identity-brand')
        info.customerIdentity.brand = 'BONSON';
      if (kind === 'older-source') source.version = '2026-10-12T00:00:00Z';
      if (kind === 'malformed-release')
        (info as unknown as Record<string, unknown>).amount = '500';
      if (kind === 'missing-binding') info.quoteBindings = [];
      if (kind === 'duplicate-binding')
        info.quoteBindings!.push({ ...binding });
      if (kind === 'old-plan') binding.planVersion--;
      if (kind === 'old-proposal') binding.proposalHash = 'b'.repeat(64);
      if (kind === 'old-quote') binding.quoteRevision--;
      if (kind === 'changed-native-plan') {
        (f.item.repairInspection as { revision: number }).revision++;
      }
      const h = harness([f]);
      // Keep the transport response under the exact requested ID even for a wrong-ID body.
      h.sync.cases.mockResolvedValue({ items: [f.source] });
      const [row] = await h.views();
      expect(row.release).toEqual({ available: false });
      expect(row.repairProposalBinding).toBeNull();
    },
  );

  it.each(['missing', 'duplicate', 'reject'])(
    'does not turn a %s fresh response into an empty successful quote',
    async (kind) => {
      const h = harness();
      if (kind === 'missing') h.sync.cases.mockResolvedValue({ items: [] });
      if (kind === 'duplicate') {
        const source = [...h.sources.values()][0];
        h.sync.cases.mockResolvedValue({ items: [source, source] });
      }
      if (kind === 'reject')
        h.sync.cases.mockRejectedValue(new Error('unavailable'));
      const [row] = await h.views();
      expect(row.release).toEqual({ available: false });
      expect(row.repairProposalBinding).toBeNull();
    },
  );

  it.each(['version', 'status', 'source-link', 'missing', 'reject'])(
    'invalidates a successful external read when native %s changes during the wait',
    async (kind) => {
      const h = harness();
      const reread = current(h.rows[0]);
      if (kind === 'version') reread.version++;
      if (kind === 'status') reread.status = 'REPAIRING';
      if (kind === 'source-link') reread.receipt.sourceCaseId = 'foreign-case';
      h.nativeRead.mockResolvedValue(kind === 'missing' ? [] : [reread]);
      if (kind === 'reject')
        h.nativeRead.mockRejectedValue(new Error('unavailable'));
      const [row] = await h.views();
      expect(row.release).toEqual({ available: false });
      expect(row.repairProposalBinding).toBeNull();
    },
  );

  it('keeps ordinary views, unauthorized actors and RETURN refurbishment free of Source finance reads', async () => {
    const h = harness();
    expect(
      (await h.service.views(h.rows, 'tech', actor()))[0].release,
    ).toBeUndefined();
    expect(
      (
        await h.service.views(h.rows, 'clerk', actor(['mailroom:read']), {
          repairOverview: true,
          repairProgress: true,
        })
      )[0].release,
    ).toBeUndefined();
    h.rows[0].receipt.category = 'RETURN';
    expect((await h.views())[0].release).toBeUndefined();
    expect(h.sync.cases).not.toHaveBeenCalled();
    expect(h.nativeRead).not.toHaveBeenCalled();
  });

  it('does not fetch Source for a foreign company or malformed native company link', async () => {
    const h = harness([fixture('piece-1'), fixture('piece-2')]);
    h.rows[0].entityId = 'foreign-erp-company';
    h.rows[1].receipt.entityId = 'foreign-erp-company';
    const result = await h.views();
    expect(result.map((row) => row.release?.available)).toEqual([false, false]);
    expect(h.sync.cases).not.toHaveBeenCalled();
  });

  it('preserves the list permission/company guard before projection', async () => {
    const h = harness();
    jest.spyOn(h.service, 'actor').mockResolvedValue(actor(['mailroom:read']));
    await expect(
      h.service.list('tech', { entityId: COMPANY, view: 'repair' }),
    ).rejects.toThrow();
    jest.spyOn(h.service, 'actor').mockResolvedValue(actor());
    await expect(
      h.service.list('tech', { entityId: 'foreign-company', view: 'repair' }),
    ).rejects.toThrow();
    expect(h.sync.cases).not.toHaveBeenCalled();
    expect(h.prisma.mailroomItem.findMany).not.toHaveBeenCalled();
  });

  it('bounds concurrency and total launch time, retaining timeout and unlaunched rows as unknown', async () => {
    jest.useFakeTimers();
    const h = harness(
      Array.from({ length: 51 }, (_, i) => fixture('piece-' + i, 'case-' + i)),
    );
    let inFlight = 0;
    let maximum = 0;
    h.sync.cases.mockImplementation(() => {
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight--;
          resolve({ items: [] });
        }, 9000);
      });
    });
    const pending = h.views();
    await jest.advanceTimersByTimeAsync(REPAIR_LIST_SOURCE_DEADLINE_MS);
    const rows = await pending;
    // Each underlying MailroomSync request has its own 8-second abort. This mock
    // settles later, so timeout races may temporarily overlap at most two waves.
    expect(maximum).toBeLessThanOrEqual(REPAIR_LIST_SOURCE_CONCURRENCY * 2);
    expect(h.sync.cases.mock.calls.length).toBeLessThanOrEqual(10);
    expect(rows).toHaveLength(51);
    expect(rows.every((row) => row.release?.available === false)).toBe(true);
    await jest.advanceTimersByTimeAsync(10000);
  });
});
