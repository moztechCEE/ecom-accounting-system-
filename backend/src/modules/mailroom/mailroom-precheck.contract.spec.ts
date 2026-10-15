import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { validatePrecheckData } from './mailroom-precheck.contract';
import { resolvePrecheckTemplate } from './mailroom-precheck.templates';
import { SavePrecheckDto, StartPrechecksDto } from './mailroom-precheck.dto';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const item = { entityId: 'company-a', productId: 'product-a', sku: 'P1' };
const product = {
  id: 'product-a',
  entityId: 'company-a',
  sku: 'P1',
  isActive: true,
  attributes: null,
};
const resolution = () =>
  resolvePrecheckTemplate(item, product, 'GENERIC_FUNCTIONAL_V1');
const binding = () => {
  const t = resolution().template!;
  return { id: t.id, revision: t.revision, contentHash: t.contentHash };
};
const input = () => ({
  status: 'READY' as const,
  templateBinding: binding(),
  checks: [{ key: 'basic_function', result: 'NORMAL' as const }],
  evidence: [] as string[],
});

describe('mailroom precheck product templates and independent documents', () => {
  it('offers both versioned presets without name matching or a product-master write', () => {
    const value = resolvePrecheckTemplate(item, product);
    expect(value.template).toBeNull();
    expect(value.availableTemplates.map((t) => t.id)).toEqual([
      'GENERIC_FUNCTIONAL_V1',
      'MOZTECH_POWERBANK_PRO_V1',
    ]);
    expect(value.availableTemplates[1].checks).toHaveLength(5);
    expect(value.availableTemplates[1].checks.every((t) => t.required)).toBe(
      true,
    );
  });
  it.each([
    null,
    { ...product, entityId: 'other' },
    { ...product, isActive: false },
    { ...product, sku: 'OTHER' },
  ])(
    'does not bind a missing, foreign, inactive or wrong-SKU master',
    (candidate) => {
      expect(resolvePrecheckTemplate(item, candidate).state).toBe(
        'PRODUCT_UNBOUND',
      );
    },
  );
  it('binds each preset content hash to company, product and SKU', () => {
    const a = resolution().template!.contentHash;
    const b = resolvePrecheckTemplate(
      { ...item, productId: 'product-b' },
      { ...product, id: 'product-b' },
      'GENERIC_FUNCTIONAL_V1',
    ).template!.contentHash;
    expect(a).not.toBe(b);
  });
  it('uses an explicit valid master template first and never infers features from product text', () => {
    const value = resolvePrecheckTemplate(item, {
      ...product,
      attributes: {
        mailroomPrecheck: {
          schema: 1,
          revision: 7,
          checks: [{ key: 'visual', label: '外觀', required: true }],
        },
      },
    });
    expect(value.template?.id).toBe('product:product-a');
    expect(value.template?.revision).toBe(7);
    expect(value.availableTemplates).toHaveLength(3);
  });
  it('rejects invalid or duplicate master checks instead of guessing a fallback', () => {
    expect(() =>
      resolvePrecheckTemplate(item, {
        ...product,
        attributes: {
          mailroomPrecheck: {
            schema: 1,
            revision: 1,
            checks: [
              { key: 'x', label: 'x', required: true },
              { key: 'x', label: 'x', required: true },
            ],
          },
        },
      }),
    ).toThrow('重複');
  });
  it('accepts a completed required result and keeps initial photos in its document data', () => {
    expect(validatePrecheckData(input(), resolution()).checks[0].result).toBe(
      'NORMAL',
    );
    expect(
      validatePrecheckData(
        {
          ...input(),
          checks: [
            {
              key: 'basic_function',
              result: 'ABNORMAL',
              note: '輸出中斷',
              evidenceIndexes: [0],
            },
          ],
          evidence: [png],
        },
        resolution(),
      ).evidence,
    ).toEqual([png]);
  });
  it.each([
    {
      key: 'basic_function',
      result: 'ABNORMAL',
      note: '',
      evidenceIndexes: [0],
    },
    {
      key: 'basic_function',
      result: 'ABNORMAL',
      note: '故障',
      evidenceIndexes: [],
    },
    { key: 'basic_function', result: 'NOT_APPLICABLE', note: '' },
    { key: 'basic_function', result: 'NORMAL', evidenceIndexes: [1] },
  ])(
    'rejects missing abnormal evidence/reason or foreign photo indexes',
    (check) => {
      expect(() =>
        validatePrecheckData(
          { ...input(), checks: [check as never], evidence: [png] },
          resolution(),
        ),
      ).toThrow();
    },
  );
  it('allows NOT_TESTED in draft but not a required READY item', () => {
    const value = {
      ...input(),
      checks: [{ key: 'basic_function', result: 'NOT_TESTED' as const }],
    };
    expect(
      validatePrecheckData({ ...value, status: 'DRAFT' }, resolution()).checks,
    ).toHaveLength(1);
    expect(() => validatePrecheckData(value, resolution())).toThrow('尚未完成');
  });
  it('keeps unfinished abnormal or not-applicable observations in DRAFT for later completion', () => {
    expect(
      validatePrecheckData(
        {
          ...input(),
          status: 'DRAFT',
          checks: [{ key: 'basic_function', result: 'ABNORMAL' }],
        },
        resolution(),
      ).checks[0].result,
    ).toBe('ABNORMAL');
    expect(
      validatePrecheckData(
        {
          ...input(),
          status: 'DRAFT',
          checks: [{ key: 'basic_function', result: 'NOT_APPLICABLE' }],
        },
        resolution(),
      ).checks[0].result,
    ).toBe('NOT_APPLICABLE');
  });
  it('does not let an unselected template silently pass or waive a selected required form', () => {
    const none = resolvePrecheckTemplate(item, product, null);
    expect(() =>
      validatePrecheckData(
        { status: 'READY', templateBinding: null, checks: [] },
        none,
      ),
    ).toThrow('原因');
    expect(
      validatePrecheckData(
        {
          status: 'READY',
          templateBinding: null,
          checks: [],
          notRequiredReason: '原封配件，不需通電',
        },
        none,
      ).notRequiredReason,
    ).toBe('原封配件，不需通電');
    expect(() =>
      validatePrecheckData(
        { ...input(), notRequiredReason: '略過' },
        resolution(),
      ),
    ).toThrow('必要檢查');
  });
  it('rejects a stale hash, injected key and duplicate check', () => {
    expect(() =>
      validatePrecheckData(
        {
          ...input(),
          templateBinding: { ...binding(), contentHash: '0'.repeat(64) },
        },
        resolution(),
      ),
    ).toThrow('模板已更新');
    expect(() =>
      validatePrecheckData(
        { ...input(), checks: [{ key: 'invented', result: 'NORMAL' }] },
        resolution(),
      ),
    ).toThrow('不屬於');
    expect(() =>
      validatePrecheckData(
        { ...input(), checks: [...input().checks, ...input().checks] },
        resolution(),
      ),
    ).toThrow('重複');
  });
  it('does not accept a URL or an oversized/non-image document as a photo', () => {
    expect(() =>
      validatePrecheckData(
        { ...input(), evidence: ['https://example.invalid/photo'] },
        resolution(),
      ),
    ).toThrow('照片');
  });
});

describe('precheck DTO rejects coerced identities, versions and undefined binding', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const body = () => ({
    entityId: 'company-a',
    requestId: id,
    expectedVersion: 1,
    expectedRevision: 1,
    status: 'DRAFT',
    templateBinding: null,
    checks: [],
  });
  it('accepts the explicit nullable binding', () =>
    expect(
      validateSync(
        plainToInstance(SavePrecheckDto, body(), {
          enableImplicitConversion: true,
        }),
      ),
    ).toEqual([]));
  it.each(['1', true, false, 0, -1])(
    'rejects nonpositive or coerced expectedVersion %p',
    (value) => {
      expect(
        validateSync(
          plainToInstance(
            SavePrecheckDto,
            { ...body(), expectedVersion: value },
            { enableImplicitConversion: true },
          ),
        ).length,
      ).toBeGreaterThan(0);
    },
  );
  it('requires the binding field and a UUID request', () => {
    const missing = { ...body(), templateBinding: undefined };
    expect(
      validateSync(plainToInstance(SavePrecheckDto, missing)).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(SavePrecheckDto, { ...body(), requestId: 'anything' }),
      ).length,
    ).toBeGreaterThan(0);
  });
  it('bounds start batches and validates nested versions', () => {
    expect(
      validateSync(
        plainToInstance(StartPrechecksDto, {
          entityId: 'company-a',
          requestId: id,
          items: [],
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(
          StartPrechecksDto,
          {
            entityId: 'company-a',
            requestId: id,
            items: [{ itemId: id, requestId: id, expectedVersion: true }],
          },
          { enableImplicitConversion: true },
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
});
