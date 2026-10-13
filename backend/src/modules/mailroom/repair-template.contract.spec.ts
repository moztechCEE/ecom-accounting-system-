import {
  repairTemplateHash,
  templateReadiness,
  validateRepairTemplate,
  validateTemplateChecks,
  type RepairTestTemplate,
  type RepairMeasuredCheck,
  type RepairCalibrationProof,
} from './repair-template.contract';

describe('reviewed SKU template and actual calibrated measurements', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-13T04:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  const template = (): RepairTestTemplate => {
    const value: RepairTestTemplate = {
      schema: 1,
      id: 'reviewed-test-fixture',
      revision: 2,
      contentHash: '',
      status: 'REVIEWED',
      entityId: 'company',
      productId: 'actual-product',
      sku: 'SYNTHETIC-SKU',
      reviewedById: 'technical-owner',
      reviewedAt: '2026-10-12T00:00:00Z',
      checks: [
        {
          key: 'synthetic-measurement',
          name: 'SYNTHETIC measurement',
          requiredForInspection: true,
          requiredForCompletion: true,
          requiresCalibration: true,
          equipmentType: 'synthetic-meter',
          standard: {
            kind: 'NUMBER',
            instruction: 'SYNTHETIC laboratory fixture only',
            unit: 'fixture-unit',
            min: '1.20',
            max: '1.25',
          },
        },
      ],
    };
    value.contentHash = repairTemplateHash(value);
    return value;
  };
  const check = (): RepairMeasuredCheck => ({
    key: 'synthetic-measurement',
    name: 'SYNTHETIC measurement',
    result: 'PASS',
    observation: 'Actual synthetic fixture value',
    measurementValue: '1.25',
    unit: 'fixture-unit',
    instrumentId: 'meter',
    calibrationRecordId: 'calibration',
    measuredAt: '2026-10-13T00:00:00Z',
  });
  const proof = (): RepairCalibrationProof => ({
    id: 'calibration',
    entityId: 'company',
    instrumentId: 'meter',
    equipmentType: 'synthetic-meter',
    status: 'VALID',
    validFrom: '2026-10-01T00:00:00Z',
    validUntil: '2026-10-31T00:00:00Z',
  });
  const context = () => {
    const value = template();
    return {
      entityId: 'company',
      productId: 'actual-product',
      sku: 'SYNTHETIC-SKU',
      binding: {
        id: value.id,
        revision: value.revision,
        contentHash: value.contentHash,
      },
    };
  };
  it('absent and unreviewed definitions remain unknown or blocked without inventing a standard', () => {
    expect(
      templateReadiness(undefined, [check()], context(), 'COMPLETION'),
    ).toBe('UNKNOWN');
    expect(
      templateReadiness(
        { ...template(), status: 'DRAFT' },
        [check()],
        context(),
        'COMPLETION',
      ),
    ).toBe('BLOCKED');
  });
  it('accepts the reviewed boundary value with current matching calibration', () => {
    expect(
      validateTemplateChecks(template(), [check()], context(), 'COMPLETION', [
        proof(),
      ]).revision,
    ).toBe(2);
  });
  it('honest unperformed inspection can be recorded without inventing measurement or calibration, but remains unknown and cannot complete', () => {
    const untested = {
      key: 'synthetic-measurement',
      name: 'SYNTHETIC measurement',
      result: 'NOT_TESTED' as const,
      observation: 'Equipment not available; no measurement performed',
    };
    expect(
      validateTemplateChecks(template(), [untested], context(), 'INSPECTION'),
    ).toBeDefined();
    expect(
      templateReadiness(template(), [untested], context(), 'INSPECTION'),
    ).toBe('UNKNOWN');
    expect(() =>
      validateTemplateChecks(template(), [untested], context(), 'COMPLETION'),
    ).toThrow('尚未完成');
  });
  it('failure can describe diagnosis but cannot be relabeled PASS or released after repair', () => {
    const failed = {
      ...check(),
      measurementValue: '1.250001',
      result: 'FAIL' as const,
    };
    expect(
      validateTemplateChecks(template(), [failed], context(), 'INSPECTION', [
        proof(),
      ]),
    ).toBeDefined();
    expect(() =>
      validateTemplateChecks(
        template(),
        [{ ...failed, result: 'PASS' }],
        context(),
        'COMPLETION',
        [proof()],
      ),
    ).toThrow('判定');
    expect(() =>
      validateTemplateChecks(template(), [failed], context(), 'COMPLETION', [
        proof(),
      ]),
    ).toThrow('複驗');
  });
  it('RECORD preserves a truthful numeric FAIL while COMPLETION stays blocked', () => {
    const failed = {
      ...check(),
      measurementValue: '1.26',
      result: 'FAIL' as const,
    };
    expect(
      validateTemplateChecks(template(), [failed], context(), 'RECORD', [
        proof(),
      ]),
    ).toEqual(template());
    expect(failed.result).toBe('FAIL');
    expect(
      templateReadiness(template(), [failed], context(), 'COMPLETION', [
        proof(),
      ]),
    ).toBe('BLOCKED');
    expect(() =>
      validateTemplateChecks(
        template(),
        [{ ...failed, result: 'PASS' }],
        context(),
        'RECORD',
        [proof()],
      ),
    ).toThrow('判定');
  });
  it('RECORD allows a missing required measurement and honest NOT_TESTED without inventing values', () => {
    const untested = {
      key: 'synthetic-measurement',
      name: 'SYNTHETIC measurement',
      result: 'NOT_TESTED' as const,
      observation: 'Waiting for equipment; not measured',
    };
    expect(validateTemplateChecks(template(), [], context(), 'RECORD')).toEqual(
      template(),
    );
    expect(
      validateTemplateChecks(template(), [untested], context(), 'RECORD'),
    ).toEqual(template());
    expect(untested).not.toHaveProperty('measurementValue');
    expect(() =>
      validateTemplateChecks(template(), [], context(), 'INSPECTION'),
    ).toThrow('必要');
    expect(
      templateReadiness(template(), [untested], context(), 'INSPECTION'),
    ).toBe('UNKNOWN');
    expect(
      templateReadiness(template(), [untested], context(), 'COMPLETION'),
    ).toBe('BLOCKED');
  });
  it.each([
    'duplicate',
    'unknown-key',
    'wrong-name',
    'wrong-unit',
    'old-binding',
    'missing-calibration',
  ])(
    'RECORD rejects %s even though recording does not require completion',
    (situation) => {
      const value = check(),
        bound = context();
      if (situation === 'unknown-key') value.key = 'not-in-current-standard';
      if (situation === 'wrong-name') value.name = 'wrong name';
      if (situation === 'wrong-unit') value.unit = 'wrong unit';
      if (situation === 'old-binding') bound.binding.revision = 1;
      expect(() =>
        validateTemplateChecks(
          template(),
          situation === 'duplicate' ? [value, value] : [value],
          bound,
          'RECORD',
          situation === 'missing-calibration' ? [] : [proof()],
        ),
      ).toThrow();
    },
  );
  it('RECORD preserves a truthful Boolean failure and rejects a fabricated passing result', () => {
    const value = template();
    value.checks[0].requiresCalibration = false;
    value.checks[0].standard = {
      kind: 'BOOLEAN',
      instruction: 'SYNTHETIC Boolean fixture',
      expected: false,
    };
    value.contentHash = repairTemplateHash(value);
    const bound = {
        ...context(),
        binding: {
          id: value.id,
          revision: value.revision,
          contentHash: value.contentHash,
        },
      },
      measured = {
        key: value.checks[0].key,
        name: value.checks[0].name,
        result: 'FAIL' as const,
        observation: 'Actual observed true',
        measurementValue: true,
      };
    expect(validateTemplateChecks(value, [measured], bound, 'RECORD')).toEqual(
      value,
    );
    expect(() =>
      validateTemplateChecks(
        value,
        [{ ...measured, result: 'PASS' }],
        bound,
        'RECORD',
      ),
    ).toThrow('判定');
    expect(templateReadiness(value, [measured], bound, 'COMPLETION')).toBe(
      'BLOCKED',
    );
  });
  it.each(['RECORD', 'INSPECTION', 'COMPLETION'] as const)(
    'future measuredAt cannot substantiate %s even inside a calibration interval',
    (phase) => {
      const now = new Date('2026-10-13T00:00:00Z');
      expect(() =>
        validateTemplateChecks(
          template(),
          [{ ...check(), measuredAt: '2026-10-13T00:00:00.001Z' }],
          context(),
          phase,
          [proof()],
          { now },
        ),
      ).toThrow('時間');
      expect(
        validateTemplateChecks(
          template(),
          [check()],
          context(),
          phase,
          [proof()],
          { now },
        ),
      ).toEqual(template());
    },
  );
  it('rejects non-calendar measurement and calibration timestamps', () => {
    expect(() =>
      validateTemplateChecks(
        template(),
        [{ ...check(), measuredAt: '2026-02-30T00:00:00Z' }],
        context(),
        'RECORD',
        [proof()],
      ),
    ).toThrow('時間');
    expect(() =>
      validateTemplateChecks(template(), [check()], context(), 'RECORD', [
        { ...proof(), validFrom: '2026-02-30T00:00:00Z' },
      ]),
    ).toThrow('校正');
  });
  it.each(['missing', 'duplicate', 'unknown-key', 'not-tested'])(
    'required test %s is not satisfied',
    (situation) => {
      const checks =
        situation === 'missing'
          ? []
          : situation === 'duplicate'
            ? [check(), check()]
            : situation === 'unknown-key'
              ? [{ ...check(), key: 'other-test' }]
              : [{ ...check(), result: 'NOT_TESTED' }];
      expect(() =>
        validateTemplateChecks(template(), checks, context(), 'COMPLETION', [
          proof(),
        ]),
      ).toThrow();
    },
  );
  it.each([
    'missing',
    'duplicate',
    'expired',
    'company',
    'instrument',
    'equipment-type',
    'unverified',
  ])(
    'calibration %s cannot substantiate a required measurement',
    (situation) => {
      const value = proof() as unknown as Record<string, unknown>;
      if (situation === 'expired') value.validUntil = '2026-10-12T00:00:00Z';
      if (situation === 'company') value.entityId = 'other';
      if (situation === 'instrument') value.instrumentId = 'other';
      if (situation === 'equipment-type') value.equipmentType = 'other';
      if (situation === 'unverified') value.status = 'PENDING';
      const proofs =
        situation === 'missing'
          ? []
          : situation === 'duplicate'
            ? [value, value]
            : [value];
      expect(() =>
        validateTemplateChecks(
          template(),
          [check()],
          context(),
          'COMPLETION',
          proofs,
        ),
      ).toThrow('校正');
    },
  );
  it('rejects changed SKU, revision, hash, unit and unsupported numeric precision', () => {
    expect(() =>
      validateRepairTemplate(template(), { ...context(), sku: 'other' }),
    ).toThrow('基準不符');
    expect(() =>
      validateRepairTemplate(template(), {
        ...context(),
        binding: { ...context().binding, revision: 1 },
      }),
    ).toThrow('基準不符');
    expect(() =>
      validateRepairTemplate({ ...template(), contentHash: 'b'.repeat(64) }),
    ).toThrow('雜湊');
    expect(() =>
      validateTemplateChecks(
        template(),
        [{ ...check(), unit: 'other' }],
        context(),
        'COMPLETION',
        [proof()],
      ),
    ).toThrow('單位');
    expect(() =>
      validateTemplateChecks(
        template(),
        [{ ...check(), measurementValue: '1.2500001' }],
        context(),
        'COMPLETION',
        [proof()],
      ),
    ).toThrow('格式');
  });
  it.each([
    { result: ['NOT_TESTED'] },
    { result: ['PASS'] },
    { result: ['FAIL'] },
  ])('a JSON array result %p is never a real test result', ({ result }) => {
    const observation = template();
    observation.checks[0].standard = {
      kind: 'OBSERVATION',
      instruction: 'SYNTHETIC observation only',
    };
    observation.checks[0].requiresCalibration = false;
    observation.contentHash = repairTemplateHash(observation);
    const bound = {
      ...context(),
      binding: {
        id: observation.id,
        revision: observation.revision,
        contentHash: observation.contentHash,
      },
    };
    expect(() =>
      validateTemplateChecks(
        observation,
        [{ ...check(), result }],
        bound,
        'INSPECTION',
      ),
    ).toThrow();
    expect(
      templateReadiness(
        observation,
        [{ ...check(), result }],
        bound,
        'INSPECTION',
      ),
    ).toBe('BLOCKED');
  });
  it.each(['check', 'proof', 'both'])(
    'missing calibration ID on %s cannot match an undefined ID',
    (missing) => {
      const value = check(),
        calibration = proof();
      if (missing === 'check' || missing === 'both')
        delete value.calibrationRecordId;
      if (missing === 'proof' || missing === 'both')
        delete (calibration as Partial<RepairCalibrationProof>).id;
      expect(() =>
        validateTemplateChecks(template(), [value], context(), 'COMPLETION', [
          calibration,
        ]),
      ).toThrow('校正');
    },
  );
});
