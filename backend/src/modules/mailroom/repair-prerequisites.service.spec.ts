import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { MailroomService } from './mailroom.service';
import type { RepairData, RepairDocument } from './repair-document.contract';
import type { RepairMaterialReadiness } from './repair-material.contract';
import type { RepairMaterialsService } from './repair-materials.service';
import { RepairPrerequisitesService } from './repair-prerequisites.service';
import { RepairTestRegistryService } from './repair-test-registry.service';
import {
  repairTemplateHash,
  type RepairMeasuredCheck,
  type RepairTestTemplate,
} from './repair-template.contract';

type Item = Parameters<RepairPrerequisitesService['require']>[0];
type Row = Record<string, unknown>;
type Query = { where: Row; take?: number };
const NOW = '2026-10-13T04:00:00Z';
const ready = (): RepairMaterialReadiness => ({
  state: 'READY',
  reason: 'NOT_REQUIRED',
  requiredCount: 0,
});
function template(productId: string, sku: string): RepairTestTemplate {
  const value: RepairTestTemplate = {
    schema: 1,
    id: `standard-${productId}`,
    revision: 2,
    contentHash: '',
    status: 'REVIEWED',
    entityId: 'company',
    productId,
    sku,
    reviewedById: 'technical-owner',
    reviewedAt: '2026-10-12T00:00:00.000Z',
    checks: [
      {
        key: 'synthetic-voltage',
        name: 'Synthetic voltage measurement',
        requiredForInspection: true,
        requiredForCompletion: true,
        requiresCalibration: true,
        equipmentType: 'synthetic-meter',
        standard: {
          kind: 'NUMBER',
          instruction: 'Synthetic test fixture only',
          unit: 'fixture-unit',
          min: '1.20',
          max: '1.25',
        },
      },
    ],
  };
  value.contentHash = repairTemplateHash(value);
  return value;
}
function measured(): RepairMeasuredCheck {
  return {
    key: 'synthetic-voltage',
    name: 'Synthetic voltage measurement',
    result: 'PASS',
    observation: 'Recorded actual synthetic measurement',
    measurementValue: '1.25',
    unit: 'fixture-unit',
    instrumentId: 'meter',
    calibrationRecordId: 'calibration',
    measuredAt: '2026-10-13T00:00:00Z',
  };
}
function binding(value: RepairTestTemplate) {
  return {
    id: value.id,
    revision: value.revision,
    contentHash: value.contentHash,
  };
}
function standard(value: RepairTestTemplate): Row {
  return {
    id: value.id,
    entityId: value.entityId,
    productId: value.productId,
    sku: value.sku,
    revision: value.revision,
    status: value.status,
    data: { checks: structuredClone(value.checks) },
    contentHash: value.contentHash,
    reviewedById: value.reviewedById,
    reviewedAt: new Date(value.reviewedAt),
  };
}
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in value)
      return (value.in as unknown[]).includes(row[key]);
    return row[key] === value;
  });
}
function fixture() {
  const original = template('original-product', 'ORIGINAL-SKU');
  const replacement = template('replacement-product', 'REPLACEMENT-SKU');
  const products: Row[] = [original, replacement].map((value) => ({
    id: value.productId,
    entityId: value.entityId,
    sku: value.sku,
    isActive: true,
  }));
  const standards = [standard(original), standard(replacement)];
  const calibrations: Row[] = [
    {
      id: 'calibration',
      entityId: 'company',
      instrumentId: 'meter',
      equipmentType: 'synthetic-meter',
      proofReference: 'Actual synthetic calibration certificate',
      status: 'VALID',
      validFrom: new Date('2026-10-01T00:00:00Z'),
      validUntil: new Date('2026-10-31T00:00:00Z'),
    },
  ];
  const delegate = (rows: Row[]) => ({
    findMany: jest.fn((query: Query) =>
      Promise.resolve(
        rows
          .filter((row) => matches(row, query.where))
          .slice(0, query.take ?? rows.length)
          .map((row) => structuredClone(row)),
      ),
    ),
  });
  const database = {
    product: delegate(products),
    repairTestStandard: delegate(standards),
    repairCalibrationRecord: delegate(calibrations),
  };
  const tx = database as unknown as Prisma.TransactionClient;
  const registry = new RepairTestRegistryService(
    database as unknown as PrismaService,
    {} as MailroomService,
  );
  const materialProjection = { start: ready(), completion: ready() };
  const projectionForItem = jest.fn(
    (_item: Item, _tx?: Prisma.TransactionClient) => {
      void _item;
      void _tx;
      return Promise.resolve(structuredClone(materialProjection));
    },
  );
  const service = new RepairPrerequisitesService(registry, {
    projectionForItem,
  } as unknown as RepairMaterialsService);
  const report: RepairDocument<RepairData> = {
    number: 'SYNTHETIC-REP',
    revision: 1,
    status: 'SUBMITTED',
    authorId: 'technician',
    authorName: 'Synthetic technician',
    updatedAt: NOW,
    inspectionRevision: 3,
    data: {
      protocol: 2,
      templateBinding: binding(original),
      outcome: 'REPAIRED',
      workPerformed: 'Recorded actual synthetic work',
      parts: [],
      laborMinutes: 5,
      checks: [measured()],
      qcResult: 'PASS',
      qcNotes: 'Recorded actual synthetic QC',
      deliveredAccessories: 'None',
    },
  };
  const item = {
    id: 'repair-item',
    entityId: 'company',
    productId: original.productId,
    sku: original.sku,
    repairOwnerId: 'technician',
    custodianId: 'technician',
    repairInspection: {
      number: 'SYNTHETIC-INS',
      revision: 3,
      status: 'SUBMITTED',
      authorId: 'technician',
      authorName: 'Synthetic technician',
      updatedAt: NOW,
      data: {
        protocol: 2,
        templateBinding: binding(original),
        checks: [measured()],
      },
    },
    repairReport: report,
  } as unknown as Item;
  return {
    item,
    report,
    service,
    registry,
    tx,
    database,
    original,
    replacement,
    products,
    standards,
    calibrations,
    materialProjection,
    projectionForItem,
  };
}

describe('actual registry and material evidence at repair prerequisite boundaries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  it('passes current calibrated evidence and forwards the same transaction to both read producers', async () => {
    const f = fixture();
    const current = await f.service.require(f.item, 'START', f.tx);
    expect(current.templateChecks).toEqual({
      inspection: 'READY',
      completion: 'READY',
    });
    expect(current.materials).toEqual(f.materialProjection);
    expect(f.projectionForItem).toHaveBeenCalledWith(f.item, f.tx);
    expect(f.database.repairTestStandard.findMany).toHaveBeenCalledWith({
      where: {
        entityId: 'company',
        productId: 'original-product',
        sku: 'ORIGINAL-SKU',
        id: f.original.id,
        revision: f.original.revision,
        contentHash: f.original.contentHash,
        status: { in: ['REVIEWED', 'RETIRED'] },
      },
      take: 2,
    });
    await expect(
      f.service.require(f.item, 'COMPLETION', f.tx),
    ).resolves.toEqual(current);
  });

  it.each(['START', 'COMPLETION'] as const)(
    '%s rejects real UNKNOWN or BLOCKED material states',
    async (stage) => {
      for (const state of ['UNKNOWN', 'BLOCKED'] as const) {
        const f = fixture();
        f.materialProjection[stage === 'START' ? 'start' : 'completion'] = {
          state,
          reason:
            state === 'UNKNOWN' ? 'MISSING_RECEIPT' : 'UNSETTLED_MATERIALS',
          requiredCount: 1,
        };
        const projected = await f.service.forItem(f.item, f.tx);
        expect(projected.materials).toEqual(f.materialProjection);
        expect(projected.templateChecks).toEqual({
          inspection: 'READY',
          completion: 'READY',
        });
        await expect(f.service.require(f.item, stage, f.tx)).rejects.toThrow(
          '材料尚未備妥或領用責任尚未結清',
        );
      }
    },
  );

  it('keeps START and COMPLETION material readiness separate', async () => {
    const f = fixture();
    f.materialProjection.completion = {
      state: 'BLOCKED',
      reason: 'UNSETTLED_MATERIALS',
      requiredCount: 1,
    };
    await expect(
      f.service.require(f.item, 'START', f.tx),
    ).resolves.toBeDefined();
    await expect(f.service.require(f.item, 'COMPLETION', f.tx)).rejects.toThrow(
      ConflictException,
    );
    f.materialProjection.completion = ready();
    f.materialProjection.start = {
      state: 'UNKNOWN',
      reason: 'MISSING_RECEIPT',
      requiredCount: 1,
    };
    await expect(
      f.service.require(f.item, 'COMPLETION', f.tx),
    ).resolves.toBeDefined();
    await expect(f.service.require(f.item, 'START', f.tx)).rejects.toThrow(
      ConflictException,
    );
  });

  it.each(['START', 'COMPLETION'] as const)(
    '%s blocks stale binding id, revision or content hash without mutating measurements',
    async (stage) => {
      for (const patch of [
        { id: 'old-template' },
        { revision: 1 },
        { contentHash: 'e'.repeat(64) },
      ]) {
        const f = fixture();
        const document = (stage === 'START'
          ? f.item.repairInspection
          : f.item.repairReport) as unknown as RepairDocument;
        Object.assign(document.data.templateBinding!, patch);
        const before = structuredClone(f.item);
        const current = await f.service.forItem(f.item, f.tx);
        expect(
          current.templateChecks[
            stage === 'START' ? 'inspection' : 'completion'
          ],
        ).not.toBe('READY');
        await expect(f.service.require(f.item, stage, f.tx)).rejects.toThrow(
          '必要檢測或設備校正尚未確認',
        );
        expect(f.item).toEqual(before);
      }
    },
  );

  it('resolves REPLACED report evidence against the unique actual target product and SKU', async () => {
    const f = fixture();
    f.report.data.outcome = 'REPLACED';
    f.report.data.replacementSku = 'REPLACEMENT-SKU';
    f.report.data.templateBinding = binding(f.replacement);
    const current = await f.service.require(f.item, 'COMPLETION', f.tx);
    expect(current.template?.productId).toBe('original-product');
    expect(current.repairTemplate?.productId).toBe('replacement-product');
    expect(current.repairTemplate?.sku).toBe('REPLACEMENT-SKU');
    expect(current.completionTemplate).toEqual(current.repairTemplate);
    expect(f.database.product.findMany).toHaveBeenCalledWith({
      where: { entityId: 'company', sku: 'REPLACEMENT-SKU', isActive: true },
      take: 2,
    });
    await expect(
      f.service.recordValidation(f.item, 'repair', f.report.data, f.tx),
    ).resolves.toEqual({
      state: 'KNOWN',
      reason: 'REVIEWED',
      template: f.replacement,
      context: {
        entityId: 'company',
        productId: 'replacement-product',
        sku: 'REPLACEMENT-SKU',
        binding: binding(f.replacement),
      },
      calibrations: [
        {
          id: 'calibration',
          entityId: 'company',
          instrumentId: 'meter',
          equipmentType: 'synthetic-meter',
          proofReference: 'Actual synthetic calibration certificate',
          status: 'VALID',
          validFrom: '2026-10-01T00:00:00.000Z',
          validUntil: '2026-10-31T00:00:00.000Z',
        },
      ],
    });
    f.report.data.templateBinding = binding(f.original);
    expect(
      (await f.service.forItem(f.item, f.tx)).templateChecks.completion,
    ).not.toBe('READY');
    await expect(
      f.service.recordValidation(f.item, 'repair', f.report.data, f.tx),
    ).rejects.toThrow(ConflictException);
  });

  it.each([
    'missing SKU',
    'missing product',
    'ambiguous product',
    'wrong company',
    'inactive product',
  ])(
    'never substitutes the original template when replacement has %s',
    async (failure) => {
      const f = fixture();
      f.report.data.outcome = 'REPLACED';
      f.report.data.replacementSku = 'REPLACEMENT-SKU';
      f.report.data.templateBinding = binding(f.replacement);
      if (failure === 'missing SKU') delete f.report.data.replacementSku;
      else if (failure === 'missing product') f.products.pop();
      else if (failure === 'ambiguous product')
        f.products.push({ ...f.products[1], id: 'other-target' });
      else if (failure === 'wrong company')
        f.products[1].entityId = 'other-company';
      else f.products[1].isActive = false;
      const current = await f.service.forItem(f.item, f.tx);
      expect(current.template?.sku).toBe('ORIGINAL-SKU');
      expect(current.repairTemplate).toBeNull();
      expect(current.templateChecks.completion).toBe('UNKNOWN');
      await expect(
        f.service.require(f.item, 'COMPLETION', f.tx),
      ).rejects.toThrow(ConflictException);
      await expect(
        f.service.recordValidation(f.item, 'repair', f.report.data, f.tx),
      ).rejects.toThrow();
    },
  );

  it.each([
    'product unbound',
    'binding absent',
    'standard missing',
    'standard draft',
    'standard ambiguous',
    'standard tampered',
  ])(
    'keeps inspection unknown or blocked when %s instead of inventing a default',
    async (failure) => {
      const f = fixture();
      const doc = f.item.repairInspection as unknown as RepairDocument;
      if (failure === 'product unbound') f.item.productId = null;
      else if (failure === 'binding absent') delete doc.data.templateBinding;
      else if (failure === 'standard missing') f.standards.shift();
      else if (failure === 'standard draft') f.standards[0].status = 'DRAFT';
      else if (failure === 'standard ambiguous') {
        doc.status = 'DRAFT'; // Unbound drafts must not choose between ambiguous active standards.
        f.standards.push({ ...f.standards[0], id: 'duplicate-standard' });
      } else f.standards[0].contentHash = 'f'.repeat(64);
      const before = structuredClone(f.item);
      const current = await f.service.forItem(f.item, f.tx);
      expect(current.templateChecks.inspection).not.toBe('READY');
      await expect(f.service.require(f.item, 'START', f.tx)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        f.service.recordValidation(f.item, 'inspection', doc.data, f.tx),
      ).rejects.toThrow(ConflictException);
      expect(f.item).toEqual(before);
    },
  );

  it.each(['FAIL', 'NOT_TESTED'] as const)(
    'RECORD retains honest %s while required completion stays blocked',
    async (result) => {
      const f = fixture();
      const check: RepairMeasuredCheck =
        result === 'FAIL'
          ? {
              ...measured(),
              result,
              measurementValue: '1.19',
              observation: 'Actual result below the reviewed minimum',
            }
          : {
              key: measured().key,
              name: measured().name,
              result,
              observation: 'Actual equipment was unavailable',
            };
      f.report.data.checks = [check];
      f.report.data.qcResult = result;
      const before = structuredClone(f.report.data);
      await expect(
        f.service.recordValidation(f.item, 'repair', f.report.data, f.tx),
      ).resolves.toEqual({
        state: 'KNOWN',
        reason: 'REVIEWED',
        template: f.original,
        context: {
          entityId: 'company',
          productId: 'original-product',
          sku: 'ORIGINAL-SKU',
          binding: binding(f.original),
        },
        calibrations: [
          {
            id: 'calibration',
            entityId: 'company',
            instrumentId: 'meter',
            equipmentType: 'synthetic-meter',
            proofReference: 'Actual synthetic calibration certificate',
            status: 'VALID',
            validFrom: '2026-10-01T00:00:00.000Z',
            validUntil: '2026-10-31T00:00:00.000Z',
          },
        ],
      });
      expect(f.report.data).toEqual(before);
      expect(
        (await f.service.forItem(f.item, f.tx)).templateChecks.completion,
      ).toBe('BLOCKED');
      await expect(
        f.service.require(f.item, 'COMPLETION', f.tx),
      ).rejects.toThrow(ConflictException);
    },
  );

  it('RECORD rejects a fabricated PASS that disagrees with the reviewed numeric limit', async () => {
    const f = fixture();
    f.report.data.checks[0].measurementValue = '1.19';
    await expect(
      f.service.recordValidation(f.item, 'repair', f.report.data, f.tx),
    ).rejects.toThrow('測項判定與實際量測不符');
    expect(
      (await f.service.forItem(f.item, f.tx)).templateChecks.completion,
    ).toBe('BLOCKED');
  });

  it('missing calibration stays blocked even with a saved PASS and known reviewed template', async () => {
    const f = fixture();
    f.calibrations.splice(0);
    const current = await f.service.forItem(f.item, f.tx);
    expect(current.calibrationRecords).toEqual([]);
    expect(current.templateChecks).toEqual({
      inspection: 'BLOCKED',
      completion: 'BLOCKED',
    });
    for (const stage of ['START', 'COMPLETION'] as const)
      await expect(f.service.require(f.item, stage, f.tx)).rejects.toThrow(
        ConflictException,
      );
    await expect(
      f.service.recordValidation(f.item, 'repair', f.report.data, f.tx),
    ).rejects.toThrow('量測設備校正證明缺失或已失效');
  });

  it('unavailable registry delegates propagate their real failure rather than READY defaults', async () => {
    const f = fixture();
    const missingProducer = {} as Prisma.TransactionClient;
    await expect(f.service.forItem(f.item, missingProducer)).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(
      f.service.require(f.item, 'START', missingProducer),
    ).rejects.toThrow('檢測標準服務尚未就緒');
  });
  it('preserves verified submitted and draft bindings after retirement while refusing legacy draft binding injection', async () => {
    const f = fixture();
    f.standards[0].status = 'RETIRED';
    expect(
      (await f.service.forItem(f.item, f.tx)).templateChecks.inspection,
    ).toBe('READY');
    const doc = f.item.repairInspection as unknown as RepairDocument;
    doc.status = 'DRAFT';
    expect(
      (await f.service.forItem(f.item, f.tx)).templateChecks.inspection,
    ).toBe('UNKNOWN');
    await expect(
      f.service.bindingValidation(f.item, 'inspection', doc.data, f.tx),
    ).rejects.toThrow(ConflictException);
    doc.templateBasis = {
      schema: 1,
      binding: binding(f.original),
      verifiedAt: NOW,
    };
    const incomplete = {
      ...doc.data,
      checks: [{ ...measured(), measurementValue: 'unfinished' }],
    };
    expect(
      (
        await f.service.bindingValidation(
          f.item,
          'inspection',
          incomplete,
          f.tx,
        )
      ).template.id,
    ).toBe(f.original.id);
    await expect(
      f.service.require(f.item, 'START', f.tx),
    ).resolves.toBeDefined();
    await expect(
      f.service.recordValidation(f.item, 'inspection', incomplete, f.tx),
    ).rejects.toThrow('量測值');
    doc.templateBasis.binding.contentHash = '0'.repeat(64);
    expect(
      (await f.service.forItem(f.item, f.tx)).templateChecks.inspection,
    ).toBe('UNKNOWN');
  });

  it('validates a first draft against the current registry without requiring completed measurements', async () => {
    const f = fixture();
    const doc = f.item.repairInspection as unknown as RepairDocument;
    doc.status = 'DRAFT';
    const incomplete = {
      ...doc.data,
      checks: [{ ...measured(), measurementValue: 'unfinished' }],
    };
    expect(
      (
        await f.service.bindingValidation(
          f.item,
          'inspection',
          incomplete,
          f.tx,
        )
      ).context.binding,
    ).toEqual(binding(f.original));
    await expect(
      f.service.recordValidation(f.item, 'inspection', incomplete, f.tx),
    ).rejects.toThrow('量測值');
    f.standards[0].status = 'RETIRED';
    const latest = { ...f.original, id: 'new-reviewed-standard', revision: 3 };
    latest.contentHash = repairTemplateHash(latest);
    f.standards.push(standard(latest));
    await expect(
      f.service.bindingValidation(f.item, 'inspection', incomplete, f.tx),
    ).rejects.toThrow('基準不符');
  });

  it('does not reuse the replacement product binding when a new report returns to original-product repair', async () => {
    const f = fixture();
    f.report.data.outcome = 'REPLACED';
    f.report.data.replacementSku = f.replacement.sku;
    f.report.data.templateBinding = binding(f.replacement);
    const incoming = {
      ...f.report.data,
      outcome: 'REPAIRED' as const,
      replacementSku: undefined,
      templateBinding: binding(f.original),
    };
    expect(
      (await f.service.recordValidation(f.item, 'repair', incoming, f.tx))
        .context.productId,
    ).toBe(f.original.productId);
  });
});
