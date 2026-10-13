/* eslint-disable @typescript-eslint/require-await -- In-memory delegates emulate asynchronous Prisma calls. */
import { type Actor } from './mailroom.contract';
import { type PrismaService } from '../../common/prisma/prisma.service';
import { type MailroomService } from './mailroom.service';
import { RepairTestRegistryService } from './repair-test-registry.service';
import { validateTemplateChecks } from './repair-template.contract';
import {
  type CreateRepairStandardDto,
  type RecordRepairCalibrationDto,
} from './repair-test-registry.dto';

type Row = Record<string, unknown>;
const COMPANY = 'company';
function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') {
      const condition = value as Row;
      if ('has' in condition)
        return (row[key] as unknown[])?.includes(condition.has);
      if ('in' in condition)
        return (condition.in as unknown[])?.includes(row[key]);
    }
    return row[key] === value;
  });
}
function fixture() {
  const standards: Row[] = [],
    calibrations: Row[] = [];
  const products: Row[] = [
    { id: 'product', entityId: COMPANY, sku: 'SYNTHETIC-SKU', isActive: true },
  ];
  let employeeActive = true;
  const permission = new Map<string, Set<string>>([
    ['manager', new Set(['repair_workbench:manage', 'repair_workbench:read'])],
    ['technician', new Set(['repair_workbench:read'])],
  ]);
  const delegate = (rows: Row[]) => ({
    findFirst: jest.fn(async (args: Row) => {
      const candidates = rows.filter((row) => matches(row, args.where as Row));
      if ((args.orderBy as Row)?.revision === 'desc')
        candidates.sort((a, b) => Number(b.revision) - Number(a.revision));
      return candidates[0] ? structuredClone(candidates[0]) : null;
    }),
    findMany: jest.fn(async (args: Row) =>
      rows
        .filter((row) => matches(row, args.where as Row))
        .slice(0, Number(args.take ?? rows.length))
        .map((row) => structuredClone(row)),
    ),
    create: jest.fn(async ({ data }: { data: Row }) => {
      rows.push(structuredClone(data));
      return structuredClone(data);
    }),
    update: jest.fn(async (args: Row) => {
      const row = rows.find((entry) => matches(entry, args.where as Row));
      if (!row) throw new Error('not found');
      Object.assign(row, structuredClone(args.data as Row));
      return structuredClone(row);
    }),
    updateMany: jest.fn(async (args: Row) => {
      const targets = rows.filter((row) => matches(row, args.where as Row));
      targets.forEach((row) =>
        Object.assign(row, structuredClone(args.data as Row)),
      );
      return { count: targets.length };
    }),
  });
  const tx = {
    repairTestStandard: delegate(standards),
    repairCalibrationRecord: delegate(calibrations),
    product: {
      findMany: jest.fn(async (args: Row) =>
        products
          .filter((row) => matches(row, args.where as Row))
          .slice(0, Number(args.take ?? products.length))
          .map((row) => structuredClone(row)),
      ),
    },
    employee: {
      findFirst: jest.fn(async () =>
        employeeActive ? { id: 'employee' } : null,
      ),
    },
    $executeRaw: jest.fn(async () => 1),
    mailroomItem: {
      findFirst: jest.fn(async () => ({
        entityId: COMPANY,
        productId: 'product',
        sku: 'SYNTHETIC-SKU',
        repairOwnerId: 'technician',
        receipt: { category: 'REPAIR' },
      })),
    },
  };
  const actor = jest.fn(
    async (id: string): Promise<Actor> => ({
      id,
      name: id,
      entityIds: [COMPANY],
      permissions: new Set(permission.get(id) ?? []),
    }),
  );
  const mailroom = { actor, enabled: jest.fn() };
  const prisma = {
    ...tx,
    $transaction: jest.fn(
      async (fn: (value: typeof tx) => Promise<unknown>) => {
        const beforeStandards = structuredClone(standards),
          beforeCals = structuredClone(calibrations);
        try {
          return await fn(tx);
        } catch (error) {
          standards.splice(0, standards.length, ...beforeStandards);
          calibrations.splice(0, calibrations.length, ...beforeCals);
          throw error;
        }
      },
    ),
  };
  const service = new RepairTestRegistryService(
    prisma as unknown as PrismaService,
    mailroom as unknown as MailroomService,
  );
  const item = {
    entityId: COMPANY,
    productId: 'product',
    sku: 'SYNTHETIC-SKU',
  };
  const create = (
    requestId = 'standard-create-1',
  ): CreateRepairStandardDto => ({
    entityId: COMPANY,
    requestId,
    productId: 'product',
    sku: 'SYNTHETIC-SKU',
    data: {
      checks: [
        {
          key: 'functional-test',
          name: '啟動',
          requiredForInspection: true,
          requiredForCompletion: true,
          requiresCalibration: false,
          standard: {
            kind: 'BOOLEAN',
            instruction: '合成測試定義',
            expected: true,
          },
        },
      ],
    },
  });
  const calibration = (
    requestId = 'calibration-create-1',
  ): RecordRepairCalibrationDto => ({
    entityId: COMPANY,
    requestId,
    instrumentId: 'instrument',
    equipmentType: 'SYNTHETIC-METER',
    proofReference: 'SYNTHETIC-CERT-001',
    validFrom: '2026-10-01T00:00:00Z',
    validUntil: '2026-10-10T00:00:00Z',
  });
  const reviewed = async (requiresCalibration = false) => {
    const body = create();
    body.data.checks[0].requiresCalibration = requiresCalibration;
    if (requiresCalibration)
      body.data.checks[0].equipmentType = 'SYNTHETIC-METER';
    const made = await service.createDraft('manager', body);
    await service.review('manager', String(made.id), {
      entityId: COMPANY,
      requestId: 'standard-review-1',
      expectedRevision: 1,
    });
    return String(made.id);
  };
  return {
    service,
    tx,
    prisma,
    standards,
    calibrations,
    products,
    permission,
    actor,
    item,
    create,
    calibration,
    reviewed,
    deactivate: () => {
      employeeActive = false;
    },
  };
}

describe('reviewed SKU test-standard registry and calibration evidence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-13T04:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('records an immutable draft but returns UNKNOWN until a real manage-authorized review', async () => {
    const f = fixture();
    const body = f.create();
    const response = await f.service.createDraft('manager', body);
    expect(response).toMatchObject({
      status: 'DRAFT',
      revision: 1,
      duplicate: false,
    });
    expect(f.standards[0]).toMatchObject({
      status: 'DRAFT',
      reviewedById: null,
      reviewedAt: null,
    });
    expect(await f.service.resolve(f.item, 'inspection')).toMatchObject({
      state: 'UNKNOWN',
      reason: 'STANDARD_MISSING',
      template: null,
    });
    body.data.checks[0].name = 'later client change';
    expect(
      (f.standards[0].data as CreateRepairStandardDto['data']).checks[0].name,
    ).toBe('啟動');
    const reviewed = await f.service.review('manager', String(response.id), {
      entityId: COMPANY,
      requestId: 'standard-review-1',
      expectedRevision: 1,
    });
    expect(reviewed.status).toBe('REVIEWED');
    const resolved = await f.service.resolve(f.item, 'inspection');
    expect(resolved).toMatchObject({
      state: 'KNOWN',
      context: {
        entityId: COMPANY,
        productId: 'product',
        sku: 'SYNTHETIC-SKU',
        binding: {
          id: response.id,
          revision: 1,
          contentHash: reviewed.contentHash,
        },
      },
      template: {
        reviewedById: 'manager',
        reviewedAt: '2026-10-13T04:00:00.000Z',
      },
    });
    expect(resolved).not.toHaveProperty('ready');
  });

  it('creates a new revision without modifying the reviewed definition, then retires it when the new review succeeds', async () => {
    const f = fixture(),
      id = await f.reviewed();
    const oldDefinition = structuredClone(f.standards[0].data);
    const next = await f.service.newRevision('manager', id, {
      entityId: COMPANY,
      requestId: 'standard-revise-1',
      expectedRevision: 1,
      data: f.create().data,
    });
    expect(next).toMatchObject({ status: 'DRAFT', revision: 2 });
    expect((await f.service.resolve(f.item, 'repair')).template?.revision).toBe(
      1,
    );
    await f.service.review('manager', String(next.id), {
      entityId: COMPANY,
      requestId: 'standard-review-2',
      expectedRevision: 2,
    });
    expect(f.standards[0].data).toEqual(oldDefinition);
    expect(f.standards[0].status).toBe('RETIRED');
    expect((await f.service.resolve(f.item, 'repair')).template?.revision).toBe(
      2,
    );
  });

  it('blocks review of an older draft and stale edit/review revisions', async () => {
    const f = fixture(),
      first = await f.service.createDraft('manager', f.create());
    await f.service.newRevision('manager', String(first.id), {
      entityId: COMPANY,
      requestId: 'standard-revise-1',
      expectedRevision: 1,
      data: f.create().data,
    });
    await expect(
      f.service.review('manager', String(first.id), {
        entityId: COMPANY,
        requestId: 'standard-review-1',
        expectedRevision: 1,
      }),
    ).rejects.toThrow('最新草稿');
    await expect(
      f.service.newRevision('manager', String(first.id), {
        entityId: COMPANY,
        requestId: 'standard-revise-2',
        expectedRevision: 1,
        data: f.create().data,
      }),
    ).rejects.toThrow('已改版');
  });

  it('requires manage permission and active employment without inferring supervisor privileges from a role name', async () => {
    const f = fixture();
    await expect(
      f.service.createDraft('technician', f.create()),
    ).rejects.toThrow('權限');
    f.permission.set('supervisor', new Set(['repair_workbench:read']));
    await expect(
      f.service.createDraft('supervisor', f.create()),
    ).rejects.toThrow('權限');
    f.deactivate();
    await expect(f.service.createDraft('manager', f.create())).rejects.toThrow(
      '在職員工',
    );
    expect(f.tx.repairTestStandard.create).not.toHaveBeenCalled();
  });

  it('rechecks a revoked manager grant after transaction entry and leaves no row', async () => {
    const f = fixture();
    let calls = 0;
    f.actor.mockImplementation(async (id) => ({
      id,
      name: id,
      entityIds: [COMPANY],
      permissions:
        ++calls === 1 ? new Set(['repair_workbench:manage']) : new Set(),
    }));
    await expect(f.service.createDraft('manager', f.create())).rejects.toThrow(
      '權限',
    );
    expect(f.standards).toHaveLength(0);
  });

  it('rechecks state after waiting for a product lock rather than reviewing the same immutable revision twice', async () => {
    const f = fixture(),
      response = await f.service.createDraft('manager', f.create());
    let locks = 0;
    f.tx.$executeRaw.mockImplementation(async () => {
      if (++locks === 2) f.standards[0].status = 'REVIEWED';
      return 1;
    });
    await expect(
      f.service.review('manager', String(response.id), {
        entityId: COMPANY,
        requestId: 'standard-review-1',
        expectedRevision: 1,
      }),
    ).rejects.toThrow('最新草稿');
    expect(f.tx.repairTestStandard.update).not.toHaveBeenCalled();
  });

  it('rechecks manager permission after a product-lock wait, before writing the draft', async () => {
    const f = fixture();
    let calls = 0;
    f.actor.mockImplementation(async (id) => ({
      id,
      name: id,
      entityIds: [COMPANY],
      permissions:
        ++calls <= 2 ? new Set(['repair_workbench:manage']) : new Set(),
    }));
    await expect(f.service.createDraft('manager', f.create())).rejects.toThrow(
      '權限',
    );
    expect(f.standards).toHaveLength(0);
  });

  it('replays exact operations once, rejects a changed body and rejects reuse across standard and calibration operations', async () => {
    const f = fixture(),
      body = f.create();
    const first = await f.service.createDraft('manager', body);
    expect(await f.service.createDraft('manager', body)).toMatchObject({
      id: first.id,
      duplicate: true,
    });
    expect(f.standards).toHaveLength(1);
    await expect(
      f.service.createDraft('manager', { ...body, sku: 'OTHER' }),
    ).rejects.toThrow('識別碼');
    await expect(
      f.service.recordCalibration('manager', {
        ...f.calibration(),
        requestId: body.requestId,
      }),
    ).rejects.toThrow('識別碼');
    expect(f.calibrations).toHaveLength(0);
  });

  it('replay still requires the current manager permission after a successful operation', async () => {
    const f = fixture(),
      body = f.create();
    await f.service.createDraft('manager', body);
    f.permission.set('manager', new Set());
    await expect(f.service.createDraft('manager', body)).rejects.toThrow(
      '權限',
    );
    expect(f.standards).toHaveLength(1);
  });

  it('keeps inactive products UNKNOWN and rejects new versions without reactivating them', async () => {
    const f = fixture();
    const id = await f.reviewed();
    f.products[0].isActive = false;
    expect(await f.service.resolve(f.item, 'repair')).toMatchObject({
      state: 'UNKNOWN',
      context: null,
    });
    await expect(
      f.service.newRevision('manager', id, {
        entityId: COMPANY,
        requestId: 'inactive-new-revision',
        expectedRevision: 1,
        data: f.create().data,
      }),
    ).rejects.toThrow('SKU');
    expect(f.products[0].isActive).toBe(false);
    expect(f.standards).toHaveLength(1);
  });

  it.each([false, undefined])(
    'does not trust an inactive or unverified active product returned by a faulty reader (%s)',
    async (isActive) => {
      const f = fixture();
      await f.reviewed();
      f.tx.product.findMany.mockImplementation(async () => [
        { ...f.products[0], isActive },
      ]);
      expect(await f.service.resolve(f.item, 'repair')).toMatchObject({
        state: 'UNKNOWN',
        context: null,
      });
      expect(
        await f.service.resolveReplacement(f.item, 'SYNTHETIC-SKU'),
      ).toMatchObject({ state: 'UNKNOWN', context: null });
    },
  );

  it('rejects drafts bound to inactive products', async () => {
    const f = fixture();
    f.products[0].isActive = false;
    await expect(f.service.createDraft('manager', f.create())).rejects.toThrow(
      'SKU',
    );
    expect(f.standards).toHaveLength(0);
  });

  it('does not pretend that an absent generated registry delegate is an empty or ready standard', async () => {
    const f = fixture();
    delete (f.prisma as unknown as Row).repairTestStandard;
    await expect(f.service.resolve(f.item, 'inspection')).rejects.toThrow(
      '檢測標準服務尚未就緒',
    );
  });

  it('rejects cross-company requests and mismatched current product SKU', async () => {
    const f = fixture();
    await expect(
      f.service.createDraft('manager', {
        ...f.create(),
        entityId: 'foreign-company',
      }),
    ).rejects.toThrow('公司');
    await expect(
      f.service.createDraft('manager', { ...f.create(), sku: 'OTHER-SKU' }),
    ).rejects.toThrow('SKU');
    expect(f.standards).toHaveLength(0);
  });

  it.each([
    'unbound',
    'wrong SKU',
    'ambiguous product',
    'ambiguous standard',
    'invalid stored hash',
    'retired',
  ])(
    'returns UNKNOWN for %s instead of a fabricated standard',
    async (reason) => {
      const f = fixture(),
        id = await f.reviewed();
      if (reason === 'unbound') f.item.productId = '';
      if (reason === 'wrong SKU') f.products[0].sku = 'CHANGED-SKU';
      if (reason === 'ambiguous product') f.products.push({ ...f.products[0] });
      if (reason === 'ambiguous standard')
        f.standards.push({
          ...structuredClone(f.standards[0]),
          id: 'duplicate',
        });
      if (reason === 'invalid stored hash')
        f.standards[0].contentHash = '0'.repeat(64);
      if (reason === 'retired')
        await f.service.retire('manager', id, {
          entityId: COMPANY,
          requestId: 'standard-retire-1',
          expectedRevision: 1,
        });
      expect(await f.service.resolve(f.item, 'repair')).toMatchObject({
        state: 'UNKNOWN',
        template: null,
        context: null,
      });
    },
  );

  it('resolves the actual replacement SKU separately from the original product, without allocating inventory', async () => {
    const f = fixture();
    f.products.push({
      id: 'replacement-product',
      entityId: COMPANY,
      sku: 'REPLACEMENT-SKU',
      isActive: true,
    });
    const made = await f.service.createDraft('manager', {
      ...f.create('replacement-create'),
      productId: 'replacement-product',
      sku: 'REPLACEMENT-SKU',
    });
    await f.service.review('manager', String(made.id), {
      entityId: COMPANY,
      requestId: 'replacement-review',
      expectedRevision: 1,
    });
    expect(
      await f.service.resolveReplacement(f.item, 'REPLACEMENT-SKU'),
    ).toMatchObject({
      state: 'KNOWN',
      template: { productId: 'replacement-product', sku: 'REPLACEMENT-SKU' },
      context: {
        entityId: COMPANY,
        productId: 'replacement-product',
        sku: 'REPLACEMENT-SKU',
        binding: { id: made.id, revision: 1 },
      },
    });
    f.products[1].isActive = false;
    expect(
      await f.service.resolveReplacement(f.item, 'REPLACEMENT-SKU'),
    ).toMatchObject({ state: 'UNKNOWN', context: null });
    expect((await f.service.resolve(f.item, 'repair')).state).toBe('UNKNOWN');
    expect(f.prisma).not.toHaveProperty('inventoryTransaction');
  });

  it('gives only the assigned technician item-standard reads; manager list remains company scoped', async () => {
    const f = fixture();
    await f.reviewed();
    expect(
      (
        await f.service.itemStandard(
          'technician',
          COMPANY,
          'item',
          'inspection',
        )
      ).state,
    ).toBe('KNOWN');
    f.permission.set('foreign-tech', new Set(['repair_workbench:read']));
    await expect(
      f.service.itemStandard('foreign-tech', COMPANY, 'item', 'inspection'),
    ).rejects.toThrow('本人');
    await expect(
      f.service.list('technician', { entityId: COMPANY }),
    ).rejects.toThrow('權限');
    const listed = await f.service.list('manager', { entityId: COMPANY });
    expect(listed.standards).toHaveLength(1);
    expect(listed.standards[0]).not.toHaveProperty('commands');
  });

  it('retains expired calibration intervals for legitimate earlier measurements, but rejects measurements outside them and revoked proof', async () => {
    const f = fixture();
    await f.reviewed(true);
    const recorded = await f.service.recordCalibration(
      'manager',
      f.calibration(),
    );
    const resolution = await f.service.resolve(f.item, 'repair'),
      template = resolution.template!;
    const check = {
      key: 'functional-test',
      name: '啟動',
      result: 'PASS' as const,
      observation: '合成觀察',
      measurementValue: true,
      instrumentId: 'instrument',
      calibrationRecordId: String(recorded.id),
      measuredAt: '2026-10-05T00:00:00Z',
    };
    const context = {
      entityId: COMPANY,
      productId: f.item.productId,
      sku: f.item.sku,
      binding: {
        id: template.id,
        revision: template.revision,
        contentHash: template.contentHash,
      },
    };
    expect(
      validateTemplateChecks(
        template,
        [check],
        context,
        'COMPLETION',
        resolution.calibrations,
      ),
    ).toEqual(template);
    expect(() =>
      validateTemplateChecks(
        template,
        [{ ...check, measuredAt: '2026-10-13T00:00:00Z' }],
        context,
        'COMPLETION',
        resolution.calibrations,
      ),
    ).toThrow('校正');
    await f.service.revokeCalibration('manager', String(recorded.id), {
      entityId: COMPANY,
      requestId: 'calibration-revoke-1',
    });
    const current = await f.service.resolve(f.item, 'repair');
    expect(current.calibrations).toHaveLength(0);
    expect(() =>
      validateTemplateChecks(
        template,
        [check],
        context,
        'COMPLETION',
        current.calibrations,
      ),
    ).toThrow('校正');
  });

  it('requires a real proof reference and a nonfuture valid-from interval for calibration recording', async () => {
    const f = fixture();
    for (const body of [
      { ...f.calibration(), proofReference: '' },
      { ...f.calibration(), validUntil: f.calibration().validFrom },
      {
        ...f.calibration(),
        validFrom: '2026-10-14T00:00:00Z',
        validUntil: '2026-10-15T00:00:00Z',
      },
      { ...f.calibration(), validFrom: '2026-02-30T00:00:00Z' },
    ])
      await expect(
        f.service.recordCalibration('manager', body),
      ).rejects.toThrow();
    expect(f.calibrations).toHaveLength(0);
  });
});
