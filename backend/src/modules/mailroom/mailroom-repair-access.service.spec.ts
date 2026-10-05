import { ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { MailroomService } from './mailroom.service';
import { MailroomQuery } from './mailroom.dto';
import { type Actor } from './mailroom.contract';
import { inspectionPlanHash } from './repair-document.contract';
import { sentCustomerWorkflow } from './repair-workflow.contract';

const actor = (
  id: string,
  permissions = ['repair_workbench:read', 'repair_workbench:update'],
): Actor => ({
  id,
  name: id,
  entityIds: ['company'],
  permissions: new Set(permissions),
});
const piece = (
  id: string,
  category = 'REPAIR',
  status = 'WAITING_REPAIR_ACCEPTANCE',
  overrides: Record<string, unknown> = {},
) => ({
  id,
  entityId: 'company',
  status,
  version: 1,
  productName: id,
  sku: null,
  serialNumber: null,
  location: '收發室',
  custodianId: 'clerk',
  nextUserId: null,
  repairOwnerId: null,
  recipientId: null,
  matchResult: 'MATCH',
  grade: null,
  disposition: null,
  evidence: [],
  receipt: { category, receivedById: 'clerk', sourceCaseId: null },
  ...overrides,
});

// A small in-memory query adapter exercises the observable access results,
// including nested AND/OR filters, rather than returning unrestricted mocked rows.
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND')
      return value.every((condition: any) => matches(row, condition));
    if (key === 'OR')
      return value.some((condition: any) => matches(row, condition));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('contains' in value)
        return String(row[key] || '')
          .toLowerCase()
          .includes(value.contains.toLowerCase());
      return matches(row[key] || {}, value);
    }
    return row[key] === value;
  });
}

describe('repair workbench company overview and claim access', () => {
  let service: MailroomService;
  let prisma: any;
  let sync: any;
  let stock: any;
  let rows: any[];
  const originalEnabled = process.env.MAILROOM_ENABLED;
  beforeEach(() => {
    process.env.MAILROOM_ENABLED = 'true';
    rows = [
      piece('pool'),
      piece('mine', 'REPAIR', 'INSPECTING', {
        repairOwnerId: 'tech',
        custodianId: 'tech',
        nextUserId: 'tech',
      }),
      piece('other', 'REPAIR', 'REPAIRING', {
        repairOwnerId: 'another',
        custodianId: 'another',
      }),
      piece('customer', 'REPAIR', 'WAITING_CUSTOMER', {
        repairOwnerId: 'another',
      }),
      piece('handoff', 'REPAIR', 'WAITING_RETURN_ACCEPTANCE', {
        repairOwnerId: 'another',
        nextUserId: 'clerk',
      }),
      piece('completed', 'REPAIR', 'READY_FOR_DISPATCH', {
        repairOwnerId: 'another',
      }),
      piece('refurbish', 'RETURN', 'PENDING_REFURBISH'),
      piece('refurbished', 'RETURN', 'PENDING_WELFARE_STOCK', {
        repairOwnerId: 'another',
      }),
      piece('restock', 'RETURN', 'PENDING_RESTOCK'),
      piece('letter', 'LETTER', 'WAITING_PICKUP'),
      piece('parcel', 'PARCEL', 'WAITING_PICKUP'),
      piece('other-company', 'REPAIR', 'WAITING_REPAIR_ACCEPTANCE', {
        entityId: 'other-company',
      }),
    ];
    prisma = {
      mailroomItem: {
        findMany: jest.fn(async ({ where }: any) =>
          rows.filter((row) => matches(row, where)),
        ),
        count: jest.fn(
          async ({ where }: any) =>
            rows.filter((row) => matches(row, where)).length,
        ),
        findUnique: jest.fn(async ({ where }: any) =>
          structuredClone(rows.find((row) => row.id === where.id) || null),
        ),
        findUniqueOrThrow: jest.fn(async ({ where }: any) =>
          structuredClone(rows.find((row) => row.id === where.id)),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const index = rows.findIndex((row) => row.id === where.id);
          rows[index] = {
            ...rows[index],
            ...data,
            version: rows[index].version + data.version.increment,
          };
          return structuredClone(rows[index]);
        }),
      },
      mailroomAction: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      mailroomTask: { findMany: jest.fn().mockResolvedValue([]) },
      mailroomReceipt: { update: jest.fn().mockResolvedValue({}) },
      mailroomDelivery: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'employee' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    let transactionQueue: Promise<unknown> = Promise.resolve();
    prisma.$transaction.mockImplementation((callback: any) => {
      const result = transactionQueue.then(() => callback(prisma));
      transactionQueue = result.catch(() => undefined);
      return result;
    });
    sync = {
      cases: jest.fn(),
      deliverPending: jest.fn().mockResolvedValue(undefined),
    };
    stock = {
      consumeForRepair: jest
        .fn()
        .mockResolvedValue({
          reservationId: 'reserve-1',
          status: 'POSTED',
          postingId: 'out-1',
          externalStatus: 'PENDING',
          quantity: 1,
          entityId: 'company',
          itemId: 'mine',
          unitLabel: 'UNIT-DEMO',
          replacementSN: 'REPLACEMENT-SN',
        }),
    };
    service = new MailroomService(prisma, {} as any, sync, stock);
    jest.spyOn(service, 'actor').mockImplementation(async (id) => actor(id));
    jest
      .spyOn(service as any, 'views')
      .mockImplementation(async (items: any) => items);
    jest.spyOn(service, 'record').mockResolvedValue([]);
    jest.spyOn(service, 'publish').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.MAILROOM_ENABLED;
    else process.env.MAILROOM_ENABLED = originalEnabled;
  });

  it.each([
    [
      'all',
      [
        'pool',
        'mine',
        'other',
        'customer',
        'handoff',
        'completed',
        'refurbish',
        'refurbished',
      ],
    ],
    ['mine', ['mine']],
    ['acceptance', ['pool', 'refurbish']],
    ['waiting', ['customer']],
    ['delivery', ['handoff']],
    ['records', ['completed', 'refurbished']],
  ] as const)(
    'scope %s exposes only authorized company repair/refurbish pieces',
    async (repairScope, expected) => {
      const result = await service.list('tech', {
        entityId: 'company',
        view: 'repair',
        repairScope,
      });
      expect(result.items.map((row: any) => row.id)).toEqual(expected);
      expect(result.total).toBe(expected.length);
    },
  );

  it('defaults to the company overview and retains page/search/status filters', async () => {
    expect(
      (await service.list('tech', { entityId: 'company', view: 'repair' }))
        .items,
    ).toHaveLength(8);
    const result = await service.list('tech', {
      entityId: 'company',
      view: 'repair',
      search: 'mine',
      status: 'INSPECTING',
      page: 2,
    });
    expect(result.items.map((row: any) => row.id)).toEqual(['mine']);
    expect(prisma.mailroomItem.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 50, skip: 50 }),
    );
  });

  it('allows repair-only users to read other technicians repair details while protecting general and unprocessed return items', async () => {
    expect((await service.detail('tech', 'company', 'other')).id).toBe('other');
    expect((await service.detail('tech', 'company', 'refurbish')).id).toBe(
      'refurbish',
    );
    for (const id of ['letter', 'parcel', 'restock'])
      await expect(service.detail('tech', 'company', id)).rejects.toThrow(
        '無此物件',
      );
    await expect(
      service.detail('tech', 'other-company', 'other-company'),
    ).rejects.toThrow('無此公司');
  });

  it('redacts complete technical documents from logistics lists, details, nested history and personal tasks without changing saved history', async () => {
    (service as any).views.mockRestore();
    jest
      .spyOn(service, 'actor')
      .mockResolvedValue(actor('clerk', ['mailroom:read']));
    const row = rows.find((entry) => entry.id === 'pool');
    row.repairInspection = {
      status: 'SUBMITTED',
      data: { diagnosis: 'private-inspection-content' },
    };
    row.repairReport = {
      status: 'SUBMITTED',
      data: { workPerformed: 'private-repair-content' },
    };
    row.repairWorkflow = {
      schema: 1,
      csr: { note: 'private-customer-workflow' },
    };
    const snapshot = {
      location: '收發室',
      repairInspection: row.repairInspection,
      repairReport: row.repairReport,
      repairWorkflow: row.repairWorkflow,
      earlier: [{ repairInspection: row.repairInspection }],
    };
    prisma.mailroomAction.findMany.mockResolvedValue([
      { action: 'submit_repair_inspection', snapshot },
    ]);
    prisma.mailroomTask.findMany.mockResolvedValue([
      { id: 'task', kind: 'HANDOFF', item: row },
    ]);
    const outputs = [
      await service.list('clerk', { entityId: 'company', view: 'mailroom' }),
      await service.detail('clerk', 'company', 'pool'),
      await service.tasks('clerk', 'company'),
    ];
    for (const result of outputs) {
      expect(JSON.stringify(result)).not.toContain('repairInspection');
      expect(JSON.stringify(result)).not.toContain('repairReport');
      expect(JSON.stringify(result)).not.toContain('repairWorkflow');
      expect(JSON.stringify(result)).not.toContain('private-customer-workflow');
      expect(JSON.stringify(result)).not.toContain(
        'private-inspection-content',
      );
      expect(JSON.stringify(result)).not.toContain('private-repair-content');
    }
    expect((outputs[1] as any).history[0].snapshot.location).toBe('收發室');
    expect(snapshot.repairInspection).toBe(row.repairInspection);
    expect(snapshot.earlier[0].repairInspection).toBe(row.repairInspection);
  });

  it.each([
    { permissions: ['repair_workbench:read'] },
    { permissions: ['mailroom:read', 'mailroom:review'] },
    { permissions: ['*'] },
  ])(
    'retains complete document versions for explicit technical/review permission $permissions',
    async ({ permissions }) => {
      (service as any).views.mockRestore();
      jest
        .spyOn(service, 'actor')
        .mockResolvedValue(actor('authorized', permissions));
      const row = rows.find((entry) => entry.id === 'pool');
      row.repairInspection = { revision: 1, status: 'SUBMITTED' };
      row.repairReport = { inspectionRevision: 1, status: 'SUBMITTED' };
      prisma.mailroomAction.findMany.mockResolvedValue([
        {
          action: 'submit_repair_inspection',
          snapshot: {
            repairInspection: row.repairInspection,
            repairReport: row.repairReport,
          },
        },
      ]);
      const result = await service.detail('authorized', 'company', 'pool');
      expect(result.repairInspection).toEqual(row.repairInspection);
      expect(result.repairReport).toEqual(row.repairReport);
      expect(result.history[0].snapshot).toMatchObject({
        repairInspection: row.repairInspection,
        repairReport: row.repairReport,
      });
    },
  );

  it('filters source pages to repair only and preserves the upstream cursor even on an empty filtered page', async () => {
    const sourceRepair = { id: 'repair', type: 'REPAIR' };
    sync.cases
      .mockResolvedValueOnce({
        items: [{ id: 'return', type: 'RETURN' }],
        nextCursor: 'next-1',
      })
      .mockResolvedValueOnce({ items: [sourceRepair], nextCursor: null });
    expect(
      await service.sourceCases('tech', 'company', 'keyword', {
        awaiting: true,
      }),
    ).toEqual({ items: [], nextCursor: 'next-1' });
    expect(
      await service.sourceCases('tech', 'company', 'keyword', {
        awaiting: true,
        cursor: 'next-1',
      }),
    ).toEqual({ items: [sourceRepair], nextCursor: null });
    expect(sync.cases).toHaveBeenLastCalledWith(
      'company',
      'keyword',
      undefined,
      { awaiting: true, cursor: 'next-1' },
    );
    jest
      .spyOn(service, 'actor')
      .mockResolvedValue(actor('clerk', ['mailroom:read']));
    sync.cases.mockResolvedValue({
      items: [sourceRepair, { id: 'return', type: 'RETURN' }],
      nextCursor: null,
    });
    expect((await service.sourceCases('clerk', 'company')).items).toHaveLength(
      2,
    );
  });

  it('denies absent read permission and other company source/list access before querying', async () => {
    jest.spyOn(service, 'actor').mockResolvedValue(actor('tech', []));
    await expect(service.sourceCases('tech', 'company')).rejects.toThrow(
      '沒有此作業權限',
    );
    await expect(
      service.list('tech', { entityId: 'company', view: 'repair' }),
    ).rejects.toThrow('沒有此作業權限');
    jest.spyOn(service, 'actor').mockResolvedValue(actor('tech'));
    await expect(service.sourceCases('tech', 'other-company')).rejects.toThrow(
      '無此公司',
    );
    await expect(
      service.list('tech', { entityId: 'other-company', view: 'repair' }),
    ).rejects.toThrow('無此公司');
    expect(sync.cases).not.toHaveBeenCalled();
    expect(prisma.mailroomItem.findMany).not.toHaveBeenCalled();
  });

  it('serializes competing claims and leaves custody with the clerk until a separate signature', async () => {
    const command = {
      entityId: 'company',
      requestId: 'claim-001',
      expectedVersion: 1,
      action: 'claim' as const,
    };
    const results = await Promise.allSettled([
      service.command('tech', 'pool', command),
      service.command('another', 'pool', {
        ...command,
        requestId: 'claim-002',
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failed = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConflictException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.mailroomItem.update).toHaveBeenCalledTimes(1);
    expect(rows.find((row) => row.id === 'pool')).toMatchObject({
      nextUserId: 'tech',
      repairOwnerId: null,
      custodianId: 'clerk',
      location: '收發室',
      status: 'WAITING_REPAIR_ACCEPTANCE',
      version: 2,
    });
  });

  it('rechecks update rights and active employment inside the claim transaction', async () => {
    const command = {
      entityId: 'company',
      requestId: 'claim-001',
      expectedVersion: 1,
      action: 'claim' as const,
    };
    jest
      .spyOn(service, 'actor')
      .mockResolvedValueOnce(actor('tech'))
      .mockResolvedValueOnce(actor('tech', ['repair_workbench:read']));
    await expect(service.command('tech', 'pool', command)).rejects.toThrow(
      '沒有此作業權限',
    );
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
    jest.spyOn(service, 'actor').mockResolvedValue(actor('tech'));
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.command('tech', 'pool', command)).rejects.toThrow(
      '在職員工',
    );
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
  });

  it('overview read access does not permit another technician to operate the piece', async () => {
    await expect(
      service.command('tech', 'other', {
        entityId: 'company',
        requestId: 'action-001',
        expectedVersion: 1,
        action: 'start_inspection',
        note: 'attempt',
      }),
    ).rejects.toThrow('本人已簽收');
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
  });

  it('requires a submitted inspection before requesting customer handling or starting repair, and keeps factory/return plans outside direct repair', async () => {
    const mine = rows.find((row) => row.id === 'mine');
    const command = {
      entityId: 'company',
      requestId: 'document-001',
      expectedVersion: 1,
      action: 'await_customer' as const,
      note: '請客服確認方案',
    };
    await expect(service.command('tech', 'mine', command)).rejects.toThrow(
      '先提交',
    );
    mine.repairInspection = {
      revision: 1,
      status: 'SUBMITTED',
      data: {
        complaint: '無法開機',
        testConditions: '原配件',
        diagnosis: '已確認故障',
        planNote: '送原廠',
        plan: 'FACTORY',
        feeSuggestion: 'FREE',
        checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
      },
    };
    await expect(
      service.command('tech', 'mine', { ...command, action: 'start_repair' }),
    ).rejects.toThrow('不能直接開始維修');
    mine.repairInspection.data.plan = 'RETURN';
    await expect(
      service.command('tech', 'mine', { ...command, action: 'start_repair' }),
    ).rejects.toThrow('不能直接開始維修');
    await expect(
      service.command('tech', 'mine', command),
    ).resolves.toMatchObject({ id: 'mine', duplicate: false });
    expect(rows.find((row) => row.id === 'mine').status).toBe(
      'WAITING_CUSTOMER',
    );
    expect(rows.find((row) => row.id === 'mine').nextUserId).toBeNull();
    expect(
      rows.find((row) => row.id === 'mine').repairWorkflow.csr,
    ).toMatchObject({
      status: 'SENT',
      inspectionRevision: 1,
      estimateRevision: 1,
    });
  });

  it.each([
    {
      source: { id: 'different-case', type: 'REPAIR', repairAllowed: true },
      allowed: false,
    },
    {
      source: { id: 'source-case', type: 'RETURN', repairAllowed: true },
      allowed: false,
    },
    {
      source: { id: 'source-case', type: 'REPAIR', repairAllowed: false },
      allowed: false,
    },
    {
      source: { id: 'source-case', type: 'REPAIR', repairAllowed: true },
      allowed: true,
    },
  ])(
    'starts repair only with current consent/payment from the exact source case and category: $source',
    async ({ source, allowed }) => {
      const mine = rows.find((row) => row.id === 'mine');
      mine.receipt.sourceCaseId = 'source-case';
      mine.repairInspection = {
        revision: 1,
        status: 'SUBMITTED',
        review: {
          inspectionRevision: 1,
          actorId: 'csr',
          name: '客服',
          confirmedAt: '2026-10-02T04:00:00.000Z',
        },
        data: {
          complaint: '無法開機',
          testConditions: '原配件',
          diagnosis: '已確認故障',
          planNote: '維修',
          plan: 'REPAIR',
          feeSuggestion: 'FREE',
          checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
        },
      };
      sync.cases.mockResolvedValue({ items: [source] });
      const operation = service.command('tech', 'mine', {
        entityId: 'company',
        requestId: 'start-repair-001',
        expectedVersion: 1,
        action: 'start_repair',
      });
      if (allowed) {
        await expect(operation).resolves.toMatchObject({
          id: 'mine',
          duplicate: false,
        });
        expect(rows.find((row) => row.id === 'mine').status).toBe('REPAIRING');
      } else {
        await expect(operation).rejects.toThrow('必要款項');
        expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
      }
    },
  );

  it('binds the assigned CSR decision to the exact submitted inspection revision and records the reviewed document', async () => {
    const mine = rows.find((row) => row.id === 'mine');
    mine.status = 'WAITING_CUSTOMER';
    mine.repairInspection = {
      revision: 2,
      status: 'SUBMITTED',
      data: {
        complaint: '無法開機',
        testConditions: '原配件',
        diagnosis: '已確認故障',
        planNote: '維修',
        plan: 'REPAIR',
        feeSuggestion: 'FREE',
        checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
      },
    };
    jest
      .spyOn(service, 'actor')
      .mockImplementation(async (id) =>
        id === 'csr'
          ? actor(id, ['mailroom:read', 'mailroom:review'])
          : actor(id),
      );
    jest.spyOn(service as any, 'customerService').mockResolvedValue('csr');
    await expect(
      service.command('csr', 'mine', {
        entityId: 'company',
        requestId: 'review-inspection-001',
        expectedVersion: 1,
        action: 'resolve_customer',
        note: '顧客同意本版方案，必要款項另由來源放行',
      }),
    ).resolves.toMatchObject({ duplicate: false });
    const reviewed = rows.find((row) => row.id === 'mine');
    expect(reviewed.status).toBe('INSPECTING');
    expect(reviewed.repairInspection.review).toEqual({
      inspectionRevision: 2,
      actorId: 'csr',
      name: 'csr',
      confirmedAt: expect.any(String),
    });
    expect(
      Number.isNaN(Date.parse(reviewed.repairInspection.review.confirmedAt)),
    ).toBe(false);
    expect(service.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ id: 'csr' }),
      expect.objectContaining({ repairInspection: reviewed.repairInspection }),
      'resolve_customer',
      'review-inspection-001',
      expect.any(String),
      'WAITING_CUSTOMER',
      expect.any(String),
      true,
      false,
      undefined,
    );
  });

  it.each([undefined, { status: 'DRAFT', revision: 1, data: {} }])(
    'returns legacy customer handoffs without submitted inspection to inspection without inventing a CSR release',
    async (document) => {
      const mine = rows.find((row) => row.id === 'mine');
      mine.status = 'WAITING_CUSTOMER';
      mine.repairInspection = document;
      jest
        .spyOn(service, 'actor')
        .mockImplementation(async (id) =>
          id === 'csr'
            ? actor(id, ['mailroom:read', 'mailroom:review'])
            : actor(id),
        );
      jest.spyOn(service as any, 'customerService').mockResolvedValue('csr');
      await service.command('csr', 'mine', {
        entityId: 'company',
        requestId: 'legacy-customer-001',
        expectedVersion: 1,
        action: 'resolve_customer',
        note: '請維修師補齊檢修單',
      });
      const updated = rows.find((row) => row.id === 'mine');
      expect(updated.status).toBe('INSPECTING');
      expect(updated.repairInspection?.review).toBeUndefined();
      await expect(
        service.command('tech', 'mine', {
          entityId: 'company',
          requestId: 'legacy-start-001',
          expectedVersion: 2,
          action: 'start_repair',
        }),
      ).rejects.toThrow('先提交');
    },
  );

  it('rejects malformed submitted inspection on CSR resolution instead of assigning a release', async () => {
    const mine = rows.find((row) => row.id === 'mine');
    mine.status = 'WAITING_CUSTOMER';
    mine.repairInspection = { revision: 1, status: 'SUBMITTED', data: {} };
    jest
      .spyOn(service, 'actor')
      .mockResolvedValue(actor('csr', ['mailroom:read', 'mailroom:review']));
    jest.spyOn(service as any, 'customerService').mockResolvedValue('csr');
    await expect(
      service.command('csr', 'mine', {
        entityId: 'company',
        requestId: 'invalid-review-001',
        expectedVersion: 1,
        action: 'resolve_customer',
        note: '非法完整標記',
      }),
    ).rejects.toThrow('請完成');
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
  });

  it.each(['FREE', 'PAID'] as const)(
    'requires a current-version CSR review for %s plans even when the source is already released',
    async (feeSuggestion) => {
      const mine = rows.find((row) => row.id === 'mine');
      mine.receipt.sourceCaseId = 'source-case';
      sync.cases.mockResolvedValue({
        items: [{ id: 'source-case', type: 'REPAIR', repairAllowed: true }],
      });
      mine.repairInspection = {
        revision: 2,
        status: 'SUBMITTED',
        data: {
          complaint: '無法開機',
          testConditions: '原配件',
          diagnosis: '已確認故障',
          planNote: '維修',
          plan: 'REPAIR',
          feeSuggestion,
          estimateAmount: 350,
          estimateNote: '零件及工時',
          checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
        },
      };
      const command = {
        entityId: 'company',
        requestId: 'review-required-001',
        expectedVersion: 1,
        action: 'start_repair' as const,
      };
      await expect(service.command('tech', 'mine', command)).rejects.toThrow(
        '尚未由客服確認',
      );
      mine.repairInspection.review = {
        inspectionRevision: 1,
        actorId: 'csr',
        name: '客服',
        confirmedAt: '2026-10-02T04:00:00.000Z',
      };
      await expect(service.command('tech', 'mine', command)).rejects.toThrow(
        '尚未由客服確認',
      );
      expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
      mine.repairInspection.review.inspectionRevision = 2;
      await expect(
        service.command('tech', 'mine', command),
      ).resolves.toMatchObject({ duplicate: false });
    },
  );

  it('a new CSR workflow cannot use an old source quote, a missing versioned source approval or the legacy resolve action to bypass personal acceptance', async () => {
    const mine = rows.find((row) => row.id === 'mine');
    mine.receipt.sourceCaseId = 'source-case';
    mine.repairInspection = {
      revision: 2,
      status: 'SUBMITTED',
      data: {
        complaint: '無法開機',
        testConditions: '原配件',
        diagnosis: '故障',
        planNote: '維修',
        plan: 'REPAIR',
        feeSuggestion: 'PAID',
        estimateAmount: 500,
        estimateNote: '零件及工時',
        checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
      },
    };
    const hash = inspectionPlanHash(mine.repairInspection);
    mine.repairWorkflow = sentCustomerWorkflow(
      mine,
      actor('tech'),
      '2026-10-05T00:00:00Z',
      4,
    );
    Object.assign(mine.repairWorkflow.csr, {
      status: 'RESOLVED',
      ownerId: 'csr',
      decision: 'APPROVE',
    });
    mine.repairInspection.review = {
      inspectionRevision: 2,
      actorId: 'csr',
      name: '客服',
      confirmedAt: '2026-10-05T00:00:00Z',
      decision: 'APPROVE',
      planHash: hash,
      quoteRevision: 4,
    };
    const source = {
      id: 'source-case',
      type: 'REPAIR',
      repairAllowed: true,
      releaseInfo: {
        quoteRevision: 5,
        customerApprovedQuoteRevision: 5,
        customerApprovedAt: '2026-10-05T00:00:00Z',
        amount: 500,
        currency: 'TWD',
        confirmedPaymentQuoteRevision: 5,
      },
    };
    sync.cases.mockResolvedValue({ items: [source] });
    const command = {
      entityId: 'company',
      requestId: 'new-source-gate-001',
      expectedVersion: 1,
      action: 'start_repair' as const,
    };
    await expect(service.command('tech', 'mine', command)).rejects.toThrow(
      '報價版本',
    );
    sync.cases.mockResolvedValue({ items: [{ ...source, releaseInfo: null }] });
    await expect(service.command('tech', 'mine', command)).rejects.toThrow(
      '報價版本',
    );
    sync.cases.mockResolvedValue({
      items: [
        {
          ...source,
          releaseInfo: {
            ...source.releaseInfo,
            quoteRevision: 4,
            customerApprovedQuoteRevision: 4,
            confirmedPaymentQuoteRevision: null,
          },
        },
      ],
    });
    await expect(service.command('tech', 'mine', command)).rejects.toThrow(
      '足額',
    );
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
    sync.cases.mockResolvedValue({
      items: [
        {
          ...source,
          releaseInfo: {
            ...source.releaseInfo,
            quoteRevision: 4,
            customerApprovedQuoteRevision: 4,
            confirmedPaymentQuoteRevision: 4,
          },
        },
      ],
    });
    await expect(
      service.command('tech', 'mine', command),
    ).resolves.toMatchObject({ duplicate: false });
    expect(rows.find((row) => row.id === 'mine').status).toBe('REPAIRING');
  });

  it.each([
    ['complete_repair', 'REPAIRING', 'REPAIR'],
    ['complete_refurbish', 'REFURBISHING', 'RETURN'],
  ] as const)(
    'does not let %s bypass submitted reports and passing final inspection',
    async (action, status, category) => {
      const mine = rows.find((row) => row.id === 'mine');
      mine.status = status;
      mine.receipt.category = category;
      const command = {
        entityId: 'company',
        requestId: 'completion-001',
        expectedVersion: 1,
        action,
        note: '處理完成',
      };
      await expect(service.command('tech', 'mine', command)).rejects.toThrow(
        '先提交',
      );
      mine.repairInspection = {
        revision: 1,
        status: 'SUBMITTED',
        data: {
          complaint: '無法開機',
          testConditions: '原配件',
          diagnosis: '已確認故障',
          planNote: '維修',
          plan: 'REPAIR',
          feeSuggestion: 'FREE',
          checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
        },
      };
      await expect(service.command('tech', 'mine', command)).rejects.toThrow(
        '先提交維修單',
      );
      mine.repairReport = {
        inspectionRevision: 1,
        status: 'SUBMITTED',
        data: {
          outcome: 'REPAIRED',
          workPerformed: '更換零件',
          parts: [],
          qcResult: 'FAIL',
          qcNotes: '仍有問題',
          deliveredAccessories: '完整',
          checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
        },
      };
      await expect(service.command('tech', 'mine', command)).rejects.toThrow(
        '複驗通過',
      );
      expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
      mine.repairReport.data.qcResult = 'PASS';
      mine.repairReport.data.checks[0].result = 'PASS';
      await expect(
        service.command('tech', 'mine', command),
      ).resolves.toMatchObject({ id: 'mine', duplicate: false });
      expect(rows.find((row) => row.id === 'mine')).toMatchObject({
        status: 'WAITING_RETURN_ACCEPTANCE',
        nextUserId: 'clerk',
        custodianId: 'tech',
      });
    },
  );

  it('completes replacement only with the same transaction formal unit posting and preserves external pending honestly; failed release never consumes stock', async () => {
    const mine = rows.find((row) => row.id === 'mine');
    mine.status = 'REPAIRING';
    mine.receipt.sourceCaseId = 'source-case';
    mine.serialNumber = 'ORIGINAL-SN';
    mine.repairInspection = {
      revision: 2,
      status: 'SUBMITTED',
      data: {
        complaint: '故障',
        testConditions: '原配件',
        diagnosis: '故障已確認',
        plan: 'REPLACE',
        planNote: '整新品換機',
        replacementSku: 'DEMO-SKU',
        replacementCondition: 'REFURBISHED',
        feeSuggestion: 'FREE',
        estimateNote: '保固',
        checks: [{ name: '開機', result: 'FAIL', observation: '未啟動' }],
      },
    };
    mine.repairWorkflow = sentCustomerWorkflow(
      mine,
      actor('tech'),
      '2026-10-05T00:00:00Z',
      4,
    );
    Object.assign(mine.repairWorkflow.csr, {
      status: 'RESOLVED',
      ownerId: 'csr',
      decision: 'APPROVE',
    });
    mine.repairInspection.review = {
      inspectionRevision: 2,
      actorId: 'csr',
      name: '客服',
      confirmedAt: '2026-10-05T00:00:00Z',
      decision: 'APPROVE',
      planHash: inspectionPlanHash(mine.repairInspection),
      quoteRevision: 4,
    };
    mine.repairReport = {
      status: 'SUBMITTED',
      inspectionRevision: 2,
      data: {
        outcome: 'REPLACED',
        workPerformed: '實物一對一替換',
        parts: [],
        laborMinutes: 15,
        checks: [{ name: '開機', result: 'PASS', observation: '功能正常' }],
        qcResult: 'PASS',
        qcNotes: '合格',
        deliveredAccessories: '配件完整',
        replacementSku: 'DEMO-SKU',
        replacementSerial: 'REPLACEMENT-SN',
        replacementCondition: 'REFURBISHED',
        replacementSource: '退貨複驗合格整新品',
        originalDisposition: '原件待故障品處置',
        inventoryReference: '自由文字追溯不冒充出庫證明',
      },
    };
    const source = {
      id: 'source-case',
      type: 'REPAIR',
      repairAllowed: false,
      releaseInfo: {
        quoteRevision: 4,
        customerApprovedQuoteRevision: 4,
        customerApprovedAt: '2026-10-05T00:00:00Z',
        amount: 0,
        currency: 'TWD',
        confirmedPaymentQuoteRevision: null,
      },
    };
    sync.cases.mockResolvedValue({ items: [source] });
    const input = {
      entityId: 'company',
      requestId: 'stock-complete-001',
      expectedVersion: 1,
      action: 'complete_repair' as const,
      note: '換機複驗完成',
    };
    await expect(service.command('tech', 'mine', input)).rejects.toThrow(
      '尚未放行',
    );
    expect(stock.consumeForRepair).not.toHaveBeenCalled();
    sync.cases.mockResolvedValue({
      items: [{ ...source, repairAllowed: true }],
    });
    stock.consumeForRepair.mockRejectedValueOnce(
      new ConflictException('預留已失效'),
    );
    await expect(service.command('tech', 'mine', input)).rejects.toThrow(
      '預留已失效',
    );
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
    stock.consumeForRepair.mockResolvedValueOnce({
      reservationId: 'reserve-1',
      status: 'POSTED',
      postingId: 'out-1',
      externalStatus: 'PENDING',
      quantity: 1,
      entityId: 'other',
      itemId: 'mine',
      unitLabel: 'UNIT-DEMO',
      replacementSN: 'REPLACEMENT-SN',
    });
    await expect(service.command('tech', 'mine', input)).rejects.toThrow(
      '出庫證明不符',
    );
    expect(prisma.mailroomItem.update).not.toHaveBeenCalled();
    await service.command('tech', 'mine', input);
    expect(stock.consumeForRepair).toHaveBeenLastCalledWith(
      prisma,
      'company',
      expect.objectContaining({ id: 'mine' }),
      'tech',
      'stock-complete-001',
      'REPLACEMENT-SN',
      'DEMO-SKU',
      'REFURBISHED',
    );
    expect(
      rows.find((row) => row.id === 'mine').repairWorkflow.release,
    ).toMatchObject({
      purpose: 'REPLACED',
      stock: {
        postingId: 'out-1',
        externalStatus: 'PENDING',
        entityId: 'company',
        itemId: 'mine',
      },
    });
  });

  it('validates the repair scope query without introducing arbitrary scopes', async () => {
    expect(
      await validate(
        Object.assign(new MailroomQuery(), {
          entityId: 'company',
          view: 'repair',
          repairScope: 'acceptance',
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new MailroomQuery(), {
          entityId: 'company',
          view: 'repair',
          repairScope: 'everything',
        }),
      ),
    ).not.toHaveLength(0);
  });
});
