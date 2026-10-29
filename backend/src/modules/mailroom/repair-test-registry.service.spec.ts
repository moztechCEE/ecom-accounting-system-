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
  if (
    Array.isArray(where.OR) &&
    !(where.OR as Row[]).some((clause) => matches(row, clause))
  )
    return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return true;
    if (value && typeof value === 'object') {
      const condition = value as Row;
      if ('contains' in condition)
        return (
          typeof row[key] === 'string' &&
          String(row[key])
            .toLowerCase()
            .includes(String(condition.contains).toLowerCase())
        );
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
    {
      id: 'product',
      name: 'Synthetic product',
      modelNumber: null,
      entityId: COMPANY,
      sku: 'SYNTHETIC-SKU',
      isActive: true,
    },
  ];
  let employeeActive = true;
  const permission = new Map<string, Set<string>>([
    ['manager', new Set(['repair_workbench:manage', 'repair_workbench:read'])],
    ['reviewer', new Set(['repair_workbench:manage', 'repair_workbench:read'])],
    [
      'technician',
      new Set(['repair_workbench:read', 'repair_workbench:update']),
    ],
    ['reader', new Set(['repair_workbench:read'])],
  ]);
  const nativeUpdate = (row: Row, data: Row) => {
    if (
      Object.keys(data).some(
        (key) =>
          [
            'entityId',
            'productId',
            'sku',
            'revision',
            'data',
            'createdById',
            'createdAt',
          ].includes(key) &&
          JSON.stringify(data[key]) !== JSON.stringify(row[key]),
      )
    )
      throw new Error('repair standard revision content is immutable');
    if (
      row.status !== 'DRAFT' &&
      Object.keys(data).some(
        (key) =>
          ['contentHash', 'reviewedById', 'reviewedAt'].includes(key) &&
          JSON.stringify(data[key]) !== JSON.stringify(row[key]),
      )
    )
      throw new Error('reviewed repair standard evidence is immutable');
    if (
      row.status === 'RETIRED' &&
      data.status !== undefined &&
      data.status !== 'RETIRED'
    )
      throw new Error('retired repair standard needs a new revision');
  };
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
      if (rows === standards) nativeUpdate(row, args.data as Row);
      Object.assign(row, structuredClone(args.data as Row));
      return structuredClone(row);
    }),
    updateMany: jest.fn(async (args: Row) => {
      const targets = rows.filter((row) => matches(row, args.where as Row));
      targets.forEach((row) => {
        if (rows === standards) nativeUpdate(row, args.data as Row);
        Object.assign(row, structuredClone(args.data as Row));
      });
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
    await service.review('reviewer', String(made.id), {
      entityId: COMPANY,
      requestId: 'standard-review-1',
      expectedRevision: 1,
      expectedContentHash:
        (standards.find((row) => row.revision === 1)?.contentHash as string) ||
        '0'.repeat(64),
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
    const reviewed = await f.service.review('reviewer', String(response.id), {
      entityId: COMPANY,
      requestId: 'standard-review-1',
      expectedRevision: 1,
      expectedContentHash:
        (f.standards.find((row) => row.revision === 1)
          ?.contentHash as string) || '0'.repeat(64),
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
        reviewedById: 'reviewer',
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
      expectedContentHash:
        (f.standards.find((row) => row.revision === 1)
          ?.contentHash as string) || '0'.repeat(64),
      data: f.create().data,
    });
    expect(next).toMatchObject({ status: 'DRAFT', revision: 2 });
    expect((await f.service.resolve(f.item, 'repair')).template?.revision).toBe(
      1,
    );
    await f.service.review('reviewer', String(next.id), {
      entityId: COMPANY,
      requestId: 'standard-review-2',
      expectedRevision: 2,
      expectedContentHash:
        (f.standards.find((row) => row.revision === 2)
          ?.contentHash as string) || '0'.repeat(64),
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
      expectedContentHash:
        (f.standards.find((row) => row.revision === 1)
          ?.contentHash as string) || '0'.repeat(64),
      data: f.create().data,
    });
    await expect(
      f.service.review('reviewer', String(first.id), {
        entityId: COMPANY,
        requestId: 'standard-review-1',
        expectedRevision: 1,
        expectedContentHash:
          (f.standards.find((row) => row.revision === 1)
            ?.contentHash as string) || '0'.repeat(64),
      }),
    ).rejects.toThrow('最新草稿');
    await expect(
      f.service.newRevision('manager', String(first.id), {
        entityId: COMPANY,
        requestId: 'standard-revise-2',
        expectedRevision: 1,
        expectedContentHash:
          (f.standards.find((row) => row.revision === 1)
            ?.contentHash as string) || '0'.repeat(64),
        data: f.create().data,
      }),
    ).rejects.toThrow('已改版');
  });

  it('requires manage permission and active employment without inferring supervisor privileges from a role name', async () => {
    const f = fixture();
    await expect(f.service.createDraft('reader', f.create())).rejects.toThrow(
      '權限',
    );
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
      f.service.review('reviewer', String(response.id), {
        entityId: COMPANY,
        requestId: 'standard-review-1',
        expectedRevision: 1,
        expectedContentHash:
          (f.standards.find((row) => row.revision === 1)
            ?.contentHash as string) || '0'.repeat(64),
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
        expectedContentHash:
          (f.standards.find((row) => row.revision === 1)
            ?.contentHash as string) || '0'.repeat(64),
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
          expectedContentHash:
            (f.standards.find((row) => row.revision === 1)
              ?.contentHash as string) || '0'.repeat(64),
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
    await f.service.review('reviewer', String(made.id), {
      entityId: COMPANY,
      requestId: 'replacement-review',
      expectedRevision: 1,
      expectedContentHash:
        (f.standards.find((row) => row.revision === 1)
          ?.contentHash as string) || '0'.repeat(64),
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
    expect(
      await f.service.list('technician', { entityId: COMPANY }),
    ).toMatchObject({ calibrations: [] });
    await expect(
      f.service.list('reader', { entityId: COMPANY }),
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

describe('technician template drafting and capability-authorized activation', () => {
  it('emulates the native immutable-row guard for draft content rather than allowing an in-place fixture update', async () => {
    const f = fixture();
    const draft = await f.service.createDraft('technician', f.create());
    const before = structuredClone(f.standards[0]);
    await expect(
      f.tx.repairTestStandard.update({
        where: { id: draft.id },
        data: { data: { checks: [] } },
      }),
    ).rejects.toThrow('revision content is immutable');
    expect(f.standards[0]).toEqual(before);
  });

  it('saves an authors latest draft by appending a new immutable revision', async () => {
    const f = fixture();
    const draft = await f.service.createDraft('technician', f.create());
    const original = structuredClone(f.standards[0]);
    const data = f.create().data;
    data.checks[0].name = 'Edited functional test';
    const input = {
      entityId: COMPANY,
      requestId: 'draft-edit-request',
      expectedRevision: 1,
      expectedContentHash: String(draft.contentHash),
      data,
    };
    const edited = await f.service.updateDraft(
      'technician',
      String(draft.id),
      input,
    );
    expect(edited).toMatchObject({
      revision: 2,
      status: 'DRAFT',
      duplicate: false,
    });
    expect(edited.id).not.toBe(draft.id);
    expect(edited.contentHash).not.toBe(draft.contentHash);
    expect(f.standards).toHaveLength(2);
    expect(f.standards[0]).toEqual(original);
    expect(f.standards[1]).toMatchObject({
      createdById: 'technician',
      reviewedById: null,
    });
    expect(
      await f.service.updateDraft('technician', String(draft.id), input),
    ).toMatchObject({ id: edited.id, duplicate: true });
    expect(f.standards).toHaveLength(2);
    expect(f.tx.repairTestStandard.update).not.toHaveBeenCalled();
    expect((await f.service.resolve(f.item, 'inspection')).state).toBe(
      'UNKNOWN',
    );
    await expect(
      f.service.updateDraft('manager', String(edited.id), {
        ...input,
        requestId: 'other-author-edit',
        expectedRevision: 2,
        expectedContentHash: String(edited.contentHash),
      }),
    ).rejects.toThrow('本人');
  });

  it('rejects stale version screens and a mismatched content hash on a current draft', async () => {
    const f = fixture();
    const draft = await f.service.createDraft('technician', f.create());
    const data = f.create().data;
    data.checks[0].standard.instruction = 'Revised conditions';
    const edited = await f.service.updateDraft('technician', String(draft.id), {
      entityId: COMPANY,
      requestId: 'draft-change-hash',
      expectedRevision: 1,
      expectedContentHash: String(draft.contentHash),
      data,
    });
    await expect(
      f.service.review('reviewer', String(draft.id), {
        entityId: COMPANY,
        requestId: 'stale-review-request',
        expectedRevision: 1,
        expectedContentHash: String(draft.contentHash),
      }),
    ).rejects.toThrow('最新草稿');
    expect(f.standards[0].status).toBe('DRAFT');
    await expect(
      f.service.updateDraft('technician', String(draft.id), {
        entityId: COMPANY,
        requestId: 'stale-update-request',
        expectedRevision: 1,
        expectedContentHash: String(draft.contentHash),
        data,
      }),
    ).rejects.toThrow('最新草稿');
    await expect(
      f.service.review('reviewer', String(edited.id), {
        entityId: COMPANY,
        requestId: 'wrong-hash-review',
        expectedRevision: 2,
        expectedContentHash: String(draft.contentHash),
      }),
    ).rejects.toThrow('內容已更新');
    expect(f.standards.every((row) => row.status === 'DRAFT')).toBe(true);
  });

  it('reports another authors pending draft without telling a technician to reload an intentionally hidden draft', async () => {
    const f = fixture();
    const id = await f.reviewed();
    const active = (await f.service.resolve(f.item, 'inspection')).template!;
    await f.service.newRevision('manager', id, {
      entityId: COMPANY,
      requestId: 'other-authors-draft',
      expectedRevision: 1,
      expectedContentHash: active.contentHash,
      data: f.create().data,
    });
    const visible = await f.service.list('technician', { entityId: COMPANY });
    expect(visible.standards.map((row) => row.id)).toEqual([id]);
    const before = structuredClone(f.standards);
    f.tx.repairTestStandard.create.mockClear();
    await expect(
      f.service.newRevision('technician', id, {
        entityId: COMPANY,
        requestId: 'hidden-latest-draft',
        expectedRevision: 1,
        expectedContentHash: active.contentHash,
        data: f.create().data,
      }),
    ).rejects.toMatchObject({ status: 409, message: '此品項已有待核定草稿' });
    expect(f.tx.repairTestStandard.create).not.toHaveBeenCalled();
    expect(f.standards).toEqual(before);
  });

  it('requires manage capability to activate, allowing an explicitly authorized author and recording the real reviewer', async () => {
    const f = fixture();
    const draft = await f.service.createDraft('manager', f.create());
    const body = {
      entityId: COMPANY,
      requestId: 'authorized-review',
      expectedRevision: 1,
      expectedContentHash: String(draft.contentHash),
    };
    await expect(
      f.service.review('technician', String(draft.id), body),
    ).rejects.toThrow('權限');
    const approved = await f.service.review('manager', String(draft.id), body);
    expect(approved.status).toBe('REVIEWED');
    expect(f.standards[0]).toMatchObject({
      createdById: 'manager',
      reviewedById: 'manager',
    });
    expect(
      await f.service.review('manager', String(draft.id), body),
    ).toMatchObject({ duplicate: true });
    expect(f.tx.repairTestStandard.update).toHaveBeenCalledTimes(1);
    await expect(
      f.service.retire('technician', String(draft.id), {
        ...body,
        requestId: 'technician-retire',
        expectedContentHash: String(approved.contentHash),
      }),
    ).rejects.toThrow('權限');
    const second = fixture();
    const authored = await second.service.createDraft(
      'technician',
      second.create(),
    );
    const next = { ...body, expectedContentHash: String(authored.contentHash) };
    await expect(
      second.service.review('technician', String(authored.id), next),
    ).rejects.toThrow('權限');
    expect(
      await second.service.review('reviewer', String(authored.id), next),
    ).toMatchObject({ status: 'REVIEWED' });
    expect(second.standards[0]).toMatchObject({
      createdById: 'technician',
      reviewedById: 'reviewer',
    });
  });

  it('uses the actual product model and rejects a changed or forged model at activation', async () => {
    const f = fixture();
    f.products[0].modelNumber = 'MODEL-A';
    const draft = await f.service.createDraft('technician', f.create());
    expect(f.standards[0].data).toMatchObject({ modelNumber: 'MODEL-A' });
    f.products[0].modelNumber = 'MODEL-B';
    await expect(
      f.service.review('reviewer', String(draft.id), {
        entityId: COMPANY,
        requestId: 'changed-model-review',
        expectedRevision: 1,
        expectedContentHash: String(draft.contentHash),
      }),
    ).rejects.toThrow('機型');
    const input = f.create('forged-model-create');
    input.data.modelNumber = 'MODEL-Z';
    await expect(f.service.createDraft('technician', input)).rejects.toThrow(
      '已有標準',
    );
    const other = fixture();
    other.products[0].modelNumber = 'MODEL-A';
    const forged = other.create();
    forged.data.modelNumber = 'MODEL-Z';
    await expect(
      other.service.createDraft('technician', forged),
    ).rejects.toThrow('機型');
    expect(other.standards).toHaveLength(0);
  });

  it('checks content hashes on new revision and retirement without changing the active definition', async () => {
    const f = fixture();
    const id = await f.reviewed();
    const before = structuredClone(f.standards);
    await expect(
      f.service.newRevision('technician', id, {
        entityId: COMPANY,
        requestId: 'stale-new-revision',
        expectedRevision: 1,
        expectedContentHash: '0'.repeat(64),
        data: f.create().data,
      }),
    ).rejects.toThrow('內容已更新');
    await expect(
      f.service.retire('reviewer', id, {
        entityId: COMPANY,
        requestId: 'stale-retire-request',
        expectedRevision: 1,
        expectedContentHash: '0'.repeat(64),
      }),
    ).rejects.toThrow('內容已更新');
    expect(f.standards).toEqual(before);
  });

  it('hides other authors drafts from technicians and keeps calibration management private', async () => {
    const f = fixture();
    await f.service.createDraft('manager', f.create());
    expect(
      (await f.service.list('technician', { entityId: COMPANY })).standards,
    ).toEqual([]);
    expect(
      (await f.service.list('manager', { entityId: COMPANY })).standards,
    ).toHaveLength(1);
    f.standards[0].createdById = 'technician';
    expect(
      (await f.service.list('technician', { entityId: COMPANY })).standards,
    ).toHaveLength(1);
    await f.service.recordCalibration('manager', f.calibration());
    expect(
      (await f.service.list('technician', { entityId: COMPANY })).calibrations,
    ).toEqual([]);
    await expect(
      f.service.recordCalibration(
        'technician',
        f.calibration('tech-calibration'),
      ),
    ).rejects.toThrow('權限');
  });

  it('offers company-active product search by name, SKU or model with a bounded hasMore result', async () => {
    const f = fixture();
    for (let i = 0; i < 51; i++)
      f.products.push({
        id: `id-${i}`,
        entityId: COMPANY,
        name: `Device ${i}`,
        sku: `SKU-${i}`,
        modelNumber: `MPN-${i}`,
        isActive: true,
      });
    f.products.push({
      id: 'foreign',
      entityId: 'other',
      name: 'Foreign',
      sku: 'SKU-foreign',
      isActive: true,
    });
    f.products.push({
      id: 'inactive',
      entityId: COMPANY,
      name: 'Inactive',
      sku: 'SKU-inactive',
      isActive: false,
    });
    const result = await f.service.products('technician', {
      entityId: COMPANY,
      q: 'sKu-',
    });
    expect(result.products).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(
      result.products.some((row) => ['foreign', 'inactive'].includes(row.id)),
    ).toBe(false);
    expect(
      (
        await f.service.products('technician', {
          entityId: COMPANY,
          q: 'mPn-50',
        })
      ).products,
    ).toEqual([
      { id: 'id-50', name: 'Device 50', sku: 'SKU-50', modelNumber: 'MPN-50' },
    ]);
    expect(
      (
        await f.service.products('technician', {
          entityId: COMPANY,
          q: 'synthetic PRODUCT',
        })
      ).products,
    ).toHaveLength(1);
    await expect(
      f.service.products('reader', { entityId: COMPANY }),
    ).rejects.toThrow('權限');
    await expect(
      f.service.products('technician', { entityId: 'other' }),
    ).rejects.toThrow('公司');
  });

  it('rejects cross-company drafting and revoked update permission after waiting for the product lock', async () => {
    const f = fixture();
    await expect(
      f.service.createDraft('technician', { ...f.create(), entityId: 'other' }),
    ).rejects.toThrow('公司');
    let calls = 0;
    f.actor.mockImplementation(async (id) => ({
      id,
      name: id,
      entityIds: [COMPANY],
      permissions:
        ++calls <= 2 ? new Set(['repair_workbench:update']) : new Set(),
    }));
    await expect(
      f.service.createDraft('technician', f.create()),
    ).rejects.toThrow('權限');
    expect(f.standards).toHaveLength(0);
  });

  it('keeps trusted case bindings on a retired version while new cases use the newly activated version', async () => {
    const f = fixture();
    const id = await f.reviewed();
    const first = (await f.service.resolve(f.item, 'inspection')).template!;
    const binding = {
      id: first.id,
      revision: first.revision,
      contentHash: first.contentHash,
    };
    const next = await f.service.newRevision('technician', id, {
      entityId: COMPANY,
      requestId: 'next-case-template',
      expectedRevision: 1,
      expectedContentHash: first.contentHash,
      data: f.create().data,
    });
    const approved = await f.service.review('reviewer', String(next.id), {
      entityId: COMPANY,
      requestId: 'next-case-review',
      expectedRevision: 2,
      expectedContentHash: String(next.contentHash),
    });
    const oldItem = {
      ...f.item,
      repairInspection: {
        status: 'SUBMITTED',
        data: { protocol: 2, templateBinding: binding },
      },
    };
    expect(
      (await f.service.resolve(oldItem, 'inspection')).template?.revision,
    ).toBe(1);
    expect(
      (await f.service.resolve(oldItem, 'repair')).template?.revision,
    ).toBe(1);
    expect(
      (await f.service.resolve(f.item, 'inspection')).template?.revision,
    ).toBe(2);
    await f.service.retire('reviewer', String(next.id), {
      entityId: COMPANY,
      requestId: 'stop-new-cases',
      expectedRevision: 2,
      expectedContentHash: String(approved.contentHash),
    });
    expect((await f.service.resolve(f.item, 'inspection')).state).toBe(
      'UNKNOWN',
    );
    expect(
      (await f.service.resolve(oldItem, 'inspection')).template?.revision,
    ).toBe(1);
  });

  it('does not turn an old unverified draft into authority for a retired version', async () => {
    const f = fixture();
    const id = await f.reviewed();
    const first = (await f.service.resolve(f.item, 'inspection')).template!;
    const binding = { id, revision: 1, contentHash: first.contentHash };
    await f.service.retire('reviewer', id, {
      entityId: COMPANY,
      requestId: 'stop-old-template',
      expectedRevision: 1,
      expectedContentHash: first.contentHash,
    });
    const item = {
      ...f.item,
      repairInspection: {
        status: 'DRAFT',
        data: { protocol: 2, templateBinding: binding },
      },
    };
    expect((await f.service.resolve(item, 'inspection')).state).toBe('UNKNOWN');
    Object.assign(item.repairInspection, {
      templateBasis: {
        schema: 1,
        binding,
        verifiedAt: new Date().toISOString(),
      },
    });
    expect(
      (await f.service.resolve(item, 'inspection')).template?.revision,
    ).toBe(1);
    Object.assign(item.repairInspection, {
      templateBasis: {
        schema: 1,
        binding: { ...binding, contentHash: '0'.repeat(64) },
        verifiedAt: new Date().toISOString(),
      },
    });
    expect((await f.service.resolve(item, 'inspection')).state).toBe('UNKNOWN');
  });
});
