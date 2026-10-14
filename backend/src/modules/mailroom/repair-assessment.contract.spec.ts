import {
  accidentalDamageFromAssessment,
  defaultInspectionAssessment,
  requireApprovedAssessmentReview,
  requiresAssessmentReview,
  validateAssessmentReview,
  validateInspectionAssessmentShape,
  validateSubmittedInspectionAssessment,
  type AssessmentReview,
  type AssessmentReviewContext,
  type InspectionAssessment,
  type InspectionAssessmentContext,
} from './repair-assessment.contract';
import {
  repairTemplateHash,
  type RepairTestTemplate,
} from './repair-template.contract';

describe('fair inspection assessment, current evidence and independent review', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const assessment = (
    result: InspectionAssessment['conclusion'] = 'USER_CAUSED',
  ): InspectionAssessment => ({
    schema: 1,
    conclusion: result,
    basis: 'SYNTHETIC recorded connector damage',
    causalExplanation: 'SYNTHETIC damaged contact explains failed connection',
    checkKeys: ['connection'],
    mediaIds: ['diagnostic-photo'],
  });
  const context = (): InspectionAssessmentContext => ({
    causeStatus: 'CONFIRMED',
    checks: [
      {
        key: 'connection',
        name: 'SYNTHETIC connection test',
        result: 'FAIL',
        observation: 'SYNTHETIC fixture connection failed',
      },
    ],
    mediaRefs: [
      {
        mediaId: 'diagnostic-photo',
        phase: 'DIAGNOSTIC',
        checkKey: 'connection',
      },
    ],
    now,
  });
  const measuredContext = (
    kind: 'NUMBER' | 'BOOLEAN' = 'NUMBER',
  ): InspectionAssessmentContext => {
    const template: RepairTestTemplate = {
      schema: 1,
      id: 'synthetic-reviewed-standard',
      revision: 2,
      contentHash: '',
      status: 'REVIEWED',
      entityId: 'company',
      productId: 'product',
      sku: 'SYNTHETIC-SKU',
      reviewedById: 'standard-reviewer',
      reviewedAt: '2026-10-14T00:00:00.000Z',
      checks: [
        {
          key: 'connection',
          name: 'SYNTHETIC connection test',
          requiredForInspection: true,
          requiredForCompletion: true,
          requiresCalibration: false,
          standard:
            kind === 'NUMBER'
              ? {
                  kind: 'NUMBER',
                  instruction: 'SYNTHETIC fixture measurement only',
                  unit: 'fixture-unit',
                  min: '1.00',
                  max: '1.25',
                }
              : {
                  kind: 'BOOLEAN',
                  instruction: 'SYNTHETIC fixture continuity only',
                  expected: true,
                },
        },
      ],
    };
    template.contentHash = repairTemplateHash(template);
    return {
      ...context(),
      mediaRefs: [],
      checks: [
        {
          key: 'connection',
          name: 'SYNTHETIC connection test',
          result: 'FAIL',
          observation: 'Actual synthetic measurement outside expected result',
          measurementValue: kind === 'NUMBER' ? '1.26' : false,
          ...(kind === 'NUMBER' ? { unit: 'fixture-unit' } : {}),
        },
      ],
      template,
      templateContext: {
        entityId: 'company',
        productId: 'product',
        sku: 'SYNTHETIC-SKU',
        binding: {
          id: template.id,
          revision: template.revision,
          contentHash: template.contentHash,
        },
      },
      calibrations: [],
    };
  };
  const review = (): AssessmentReview => ({
    schema: 1,
    inspectionRevision: 2,
    planHash: 'a'.repeat(64),
    reviewerId: 'csr',
    reviewerName: 'SYNTHETIC reviewer',
    reviewedAt: '2026-10-15T03:59:00.000Z',
    decision: 'APPROVE',
    note: 'SYNTHETIC current evidence and cause reviewed',
  });
  const reviewContext = (): AssessmentReviewContext => ({
    entityId: 'company',
    inspectionRevision: 2,
    planHash: 'a'.repeat(64),
    authorId: 'technician',
    repairOwnerId: 'technician',
    reviewer: {
      id: 'csr',
      entityId: 'company',
      isActiveEmployee: true,
      canReview: true,
    },
    now,
  });

  it('starts with a fresh unknown assessment without inferring a fault from old false', () => {
    const first = defaultInspectionAssessment();
    first.checkKeys.push('edited');
    expect(defaultInspectionAssessment()).toEqual({
      schema: 1,
      conclusion: 'UNDETERMINED',
      basis: '',
      causalExplanation: '',
      checkKeys: [],
      mediaIds: [],
    });
    expect(accidentalDamageFromAssessment(defaultInspectionAssessment())).toBe(
      undefined,
    );
    expect(requiresAssessmentReview(defaultInspectionAssessment())).toBe(false);
  });
  it('requires an assessment only at this new submission boundary', () => {
    expect(() =>
      validateSubmittedInspectionAssessment(undefined, context()),
    ).toThrow('本版');
    expect(() =>
      validateSubmittedInspectionAssessment(null, context()),
    ).toThrow('本版');
  });
  it.each(['USER_CAUSED', 'PRODUCT_FAULT'] as const)(
    'keeps an incomplete %s draft without authorizing its submitted conclusion',
    (conclusion) => {
      const incomplete = { ...defaultInspectionAssessment(), conclusion };
      expect(validateInspectionAssessmentShape(incomplete)).toEqual(incomplete);
      expect(() =>
        validateSubmittedInspectionAssessment(incomplete, context()),
      ).toThrow('已確認');
    },
  );
  it.each([undefined, null, false, {}, { schema: 1 }])(
    'does not let a new draft omit the assessment shape %#',
    (input) => {
      expect(() => validateInspectionAssessmentShape(input)).toThrow('本版');
    },
  );
  it.each([
    { schema: '1' },
    { conclusion: false },
    { basis: 1 },
    { causalExplanation: null },
    { checkKeys: [1] },
    { mediaIds: [' '] },
    { checkKeys: ['same', 'same'] },
    { mediaIds: ['same', 'same'] },
    { checkKeys: Array.from({ length: 51 }, (_, index) => 'check-' + index) },
    { mediaIds: Array.from({ length: 13 }, (_, index) => 'media-' + index) },
    { basis: 'x'.repeat(2001) },
    { causalExplanation: 'x'.repeat(2001) },
    { legacy: true },
  ])(
    'rejects coercion, extra keys, duplicate refs and limits even in a draft %#',
    (patch) => {
      expect(() =>
        validateInspectionAssessmentShape({
          ...defaultInspectionAssessment(),
          ...patch,
        }),
      ).toThrow();
    },
  );
  it('accepts exact draft length and reference limits without inventing actual evidence', () => {
    const draft = {
      ...defaultInspectionAssessment(),
      basis: 'x'.repeat(2000),
      causalExplanation: 'x'.repeat(2000),
      checkKeys: Array.from({ length: 50 }, (_, index) => 'check-' + index),
      mediaIds: Array.from({ length: 12 }, (_, index) => 'media-' + index),
    };
    expect(validateInspectionAssessmentShape(draft)).toEqual(draft);
    expect(() =>
      validateSubmittedInspectionAssessment(draft, {
        causeStatus: 'UNKNOWN',
        checks: [],
      }),
    ).toThrow('實際');
    const copied = validateInspectionAssessmentShape(draft);
    copied.checkKeys.push('changed');
    expect(draft.checkKeys).toHaveLength(50);
  });
  it('preserves honest unknown observations without requiring false evidence', () => {
    const value = defaultInspectionAssessment();
    expect(
      validateSubmittedInspectionAssessment(value, {
        causeStatus: 'UNKNOWN',
        checks: [],
      }),
    ).toEqual(value);
    expect(
      validateSubmittedInspectionAssessment(
        { ...value, basis: 'Intermittent fault not reproduced' },
        { causeStatus: 'SUSPECTED', checks: [] },
      ).conclusion,
    ).toBe('UNDETERMINED');
  });
  it('does not present an undetermined cause as confirmed', () => {
    expect(() =>
      validateSubmittedInspectionAssessment(defaultInspectionAssessment(), {
        causeStatus: 'CONFIRMED',
        checks: [],
      }),
    ).toThrow('待確認不能');
  });
  it.each(['USER_CAUSED', 'PRODUCT_FAULT'] as const)(
    '%s needs confirmed cause, objective basis, explanation and tested references',
    (result) => {
      const value = assessment(result);
      expect(() =>
        validateSubmittedInspectionAssessment(value, {
          ...context(),
          causeStatus: 'SUSPECTED',
        }),
      ).toThrow('已確認');
      for (const patch of [
        { basis: ' ' },
        { causalExplanation: '' },
        { checkKeys: [] },
      ])
        expect(() =>
          validateSubmittedInspectionAssessment(
            { ...value, ...patch },
            context(),
          ),
        ).toThrow('已確認');
      expect(() =>
        validateSubmittedInspectionAssessment(value, {
          ...context(),
          checks: [
            {
              key: 'connection',
              name: 'SYNTHETIC connection test',
              result: 'NOT_TESTED',
              observation: 'Instrument unavailable',
            },
          ],
        }),
      ).toThrow('實際');
    },
  );
  it('maps only explicit confirmed conclusions to the legacy boolean', () => {
    expect(accidentalDamageFromAssessment(assessment())).toBe(true);
    expect(accidentalDamageFromAssessment(assessment('PRODUCT_FAULT'))).toBe(
      false,
    );
    expect(requiresAssessmentReview(assessment())).toBe(true);
    expect(requiresAssessmentReview(assessment('PRODUCT_FAULT'))).toBe(false);
    expect(
      validateSubmittedInspectionAssessment(assessment(), {
        ...context(),
        isAccidentalDamage: true,
      }).conclusion,
    ).toBe('USER_CAUSED');
  });
  it.each([
    ['USER_CAUSED', false],
    ['PRODUCT_FAULT', true],
    ['UNDETERMINED', false],
    ['UNDETERMINED', true],
    ['USER_CAUSED', 'true'],
    ['USER_CAUSED', null],
  ])(
    'rejects contradictory or coerced compatibility flags %s / %s',
    (value, flag) => {
      expect(() =>
        validateSubmittedInspectionAssessment(
          value === 'UNDETERMINED'
            ? defaultInspectionAssessment()
            : assessment(value as InspectionAssessment['conclusion']),
          {
            ...context(),
            ...(value === 'UNDETERMINED' ? { causeStatus: 'UNKNOWN' } : {}),
            isAccidentalDamage: flag,
          },
        ),
      ).toThrow('欄位');
    },
  );
  it.each([
    { schema: 2 },
    { conclusion: 'NON_HUMAN' },
    { basis: null },
    { causalExplanation: 'x'.repeat(2001) },
    { checkKeys: 'connection' },
    { checkKeys: ['connection', 'connection'] },
    { mediaIds: ['diagnostic-photo', 'diagnostic-photo'] },
    { mediaIds: new Array<string>(13).fill('photo') },
    { reviewed: true },
  ])('rejects malformed assessment shape %#', (patch) => {
    expect(() =>
      validateSubmittedInspectionAssessment(
        { ...assessment(), ...patch },
        context(),
      ),
    ).toThrow();
  });
  it('does not accept missing, duplicate or blank actual check records', () => {
    for (const checks of [
      [],
      [...(context().checks as unknown[]), ...(context().checks as unknown[])],
      [
        {
          key: 'connection',
          name: 'connection',
          result: 'FAIL',
          observation: '',
        },
      ],
    ])
      expect(() =>
        validateSubmittedInspectionAssessment(assessment(), {
          ...context(),
          checks,
        }),
      ).toThrow('實際');
  });
  it('accepts selected current media shapes without claiming they prove a finalized upload', () => {
    expect(
      validateSubmittedInspectionAssessment(assessment(), context()),
    ).toEqual(assessment());
  });
  it('cannot use only a repaired AFTER image to establish the earlier user-caused fault', () => {
    expect(() =>
      validateSubmittedInspectionAssessment(assessment(), {
        ...context(),
        mediaRefs: [
          {
            mediaId: 'diagnostic-photo',
            phase: 'AFTER',
            checkKey: 'connection',
          },
        ],
      }),
    ).toThrow('修前');
  });
  it('allows BEFORE evidence without removing AFTER images from other document records', () => {
    const current = context();
    current.mediaRefs = [
      {
        mediaId: 'diagnostic-photo',
        phase: 'BEFORE',
        checkKey: 'connection',
      },
      { mediaId: 'repair-after-photo', phase: 'AFTER' },
    ];
    const before = JSON.stringify(current);
    expect(
      validateSubmittedInspectionAssessment(assessment(), current).conclusion,
    ).toBe('USER_CAUSED');
    expect(JSON.stringify(current)).toBe(before);
  });
  it('can retain an AFTER selection when a separate valid reviewed measurement supports the cause', () => {
    const measured = measuredContext();
    measured.mediaRefs = [
      {
        mediaId: 'diagnostic-photo',
        phase: 'AFTER',
        checkKey: 'connection',
      },
    ];
    expect(
      validateSubmittedInspectionAssessment(assessment(), measured).conclusion,
    ).toBe('USER_CAUSED');
    const failed = {
      ...measured,
      checks: [
        {
          ...(measured.checks as Record<string, unknown>[])[0],
          measurementValue: null,
        },
      ],
    };
    expect(() =>
      validateSubmittedInspectionAssessment(assessment(), failed),
    ).toThrow();
  });
  it('rejects unknown, duplicate, unrelated and malformed media references', () => {
    for (const refs of [
      [],
      [
        ...(context().mediaRefs as unknown[]),
        ...(context().mediaRefs as unknown[]),
      ],
      [
        {
          mediaId: 'diagnostic-photo',
          phase: 'DIAGNOSTIC',
          checkKey: 'other-test',
        },
      ],
      [{ mediaId: 'diagnostic-photo', phase: 'UNTRUSTED' }],
    ])
      expect(() =>
        validateSubmittedInspectionAssessment(assessment(), {
          ...context(),
          mediaRefs: refs,
        }),
      ).toThrow('影像');
  });
  it('does not invent measurement evidence when an arbitrary observation carries a value', () => {
    const value = { ...assessment(), mediaIds: [] };
    expect(() =>
      validateSubmittedInspectionAssessment(value, {
        ...context(),
        mediaRefs: [],
        checks: [
          {
            key: 'connection',
            name: 'SYNTHETIC connection test',
            result: 'FAIL',
            observation: 'A scratch was observed',
            measurementValue: '1.26',
          },
        ],
      }),
    ).toThrow('有效量測');
    const measured = measuredContext();
    const template = measured.template as RepairTestTemplate;
    template.checks[0].standard = {
      kind: 'OBSERVATION',
      instruction: 'Look at the product',
    };
    template.contentHash = repairTemplateHash(template);
    measured.templateContext!.binding.contentHash = template.contentHash;
    expect(() =>
      validateSubmittedInspectionAssessment(value, measured),
    ).toThrow('有效量測');
  });
  it.each(['NUMBER', 'BOOLEAN'] as const)(
    'accepts a supplied reviewed %s standard and corresponding actual measurement',
    (kind) => {
      expect(
        validateSubmittedInspectionAssessment(
          { ...assessment(), mediaIds: [] },
          measuredContext(kind),
        ).conclusion,
      ).toBe('USER_CAUSED');
    },
  );
  it('rejects draft, hash-changed, foreign or missing current standard binding', () => {
    const value = { ...assessment(), mediaIds: [] };
    for (const changed of [
      { ...measuredContext(), template: undefined },
      { ...measuredContext(), templateContext: undefined },
      {
        ...measuredContext(),
        template: {
          ...(measuredContext().template as RepairTestTemplate),
          status: 'DRAFT',
        },
      },
      {
        ...measuredContext(),
        template: {
          ...(measuredContext().template as RepairTestTemplate),
          contentHash: 'b'.repeat(64),
        },
      },
      {
        ...measuredContext(),
        templateContext: {
          ...measuredContext().templateContext!,
          entityId: 'foreign',
        },
      },
    ])
      expect(() =>
        validateSubmittedInspectionAssessment(value, changed),
      ).toThrow();
  });
  it.each([null, 1.26, 'not-a-number', '', true])(
    'rejects fake number measurements %s',
    (measurementValue) => {
      const measured = measuredContext();
      measured.checks = [
        {
          ...(measured.checks as Record<string, unknown>[])[0],
          measurementValue,
        },
      ];
      expect(() =>
        validateSubmittedInspectionAssessment(
          { ...assessment(), mediaIds: [] },
          measured,
        ),
      ).toThrow();
    },
  );
  it('rejects false relabelled PASS and a string boolean measurement', () => {
    const measured = measuredContext('BOOLEAN');
    for (const patch of [{ result: 'PASS' }, { measurementValue: 'false' }])
      expect(() =>
        validateSubmittedInspectionAssessment(
          { ...assessment(), mediaIds: [] },
          {
            ...measured,
            checks: [
              {
                ...(measured.checks as Record<string, unknown>[])[0],
                ...patch,
              },
            ],
          },
        ),
      ).toThrow();
  });
  it('keeps required calibration validation when measurement is the only evidence', () => {
    const measured = measuredContext();
    const template = measured.template as RepairTestTemplate;
    template.checks[0].requiresCalibration = true;
    template.checks[0].equipmentType = 'synthetic-meter';
    template.contentHash = repairTemplateHash(template);
    measured.templateContext!.binding.contentHash = template.contentHash;
    expect(() =>
      validateSubmittedInspectionAssessment(
        { ...assessment(), mediaIds: [] },
        measured,
      ),
    ).toThrow('校正');
  });
  it('does not convert an unknown cause or proof into a ready review', () => {
    for (const input of [null, undefined, { conclusion: 'INVALID' }]) {
      expect(() =>
        accidentalDamageFromAssessment(input as InspectionAssessment),
      ).toThrow();
      expect(() =>
        requiresAssessmentReview(input as InspectionAssessment),
      ).toThrow();
      expect(() =>
        requireApprovedAssessmentReview(input, reviewContext()),
      ).toThrow();
    }
  });
  it('accepts another active company CSR for the exact current inspection and hash', () => {
    expect(requireApprovedAssessmentReview(review(), reviewContext())).toEqual(
      review(),
    );
  });
  it('records a valid request to revise without treating it as approval', () => {
    const revise = { ...review(), decision: 'REVISE' as const };
    expect(validateAssessmentReview(revise, reviewContext())).toEqual(revise);
    expect(() =>
      requireApprovedAssessmentReview(revise, reviewContext()),
    ).toThrow('尚未覆核通過');
  });
  it.each([{ inspectionRevision: 1 }, { planHash: 'b'.repeat(64) }])(
    'rejects a stale review after any content or revision change %#',
    (patch) => {
      expect(() =>
        requireApprovedAssessmentReview(
          { ...review(), ...patch },
          reviewContext(),
        ),
      ).toThrow('已改版');
    },
  );
  it.each([
    { schema: 2 },
    { inspectionRevision: '2' },
    { planHash: null },
    { reviewerName: ' ' },
    { note: '' },
    { decision: 'DECLINE' },
    { reviewedAt: '2026-02-30T00:00:00.000Z' },
    { reviewedAt: '2026-10-15T04:00:00.001Z' },
    { current: true },
  ])('rejects malformed, fictional or future approval proof %#', (patch) => {
    expect(() =>
      requireApprovedAssessmentReview(
        { ...review(), ...patch },
        reviewContext(),
      ),
    ).toThrow('不完整');
  });
  it('forbids self review even when the actor has administrator review permission', () => {
    for (const patch of [{ authorId: 'csr' }, { repairOwnerId: 'csr' }])
      expect(() =>
        requireApprovedAssessmentReview(review(), {
          ...reviewContext(),
          ...patch,
        }),
      ).toThrow('另一位');
  });
  it.each([
    { entityId: 'foreign' },
    { isActiveEmployee: false },
    { canReview: false },
    { id: 'different-csr' },
  ])(
    'rejects foreign, inactive, unpermitted or impersonated reviewers %#',
    (patch) => {
      expect(() =>
        requireApprovedAssessmentReview(review(), {
          ...reviewContext(),
          reviewer: { ...reviewContext().reviewer, ...patch },
        }),
      ).toThrow('另一位');
    },
  );
  it('rejects different user accounts bound to the same author or custodian employee', () => {
    for (const patch of [
      { authorEmployeeId: 'same-employee' },
      { repairOwnerEmployeeId: 'same-employee' },
    ])
      expect(() =>
        requireApprovedAssessmentReview(review(), {
          ...reviewContext(),
          reviewerEmployeeId: 'same-employee',
          ...patch,
        }),
      ).toThrow('另一位');
    expect(
      requireApprovedAssessmentReview(review(), {
        ...reviewContext(),
        reviewerEmployeeId: 'csr-employee',
        authorEmployeeId: 'tech-employee',
      }).reviewerId,
    ).toBe('csr');
  });
  it('does not mutate evidence, review or caller context', () => {
    const value = assessment();
    const current = context();
    const before = JSON.stringify({ value, current });
    const result = validateSubmittedInspectionAssessment(value, current);
    result.checkKeys.push('edited');
    result.mediaIds.push('edited');
    expect(JSON.stringify({ value, current })).toBe(before);
    const proof = review();
    const returned = validateAssessmentReview(proof, reviewContext());
    returned.note = 'edited';
    expect(proof.note).toBe(review().note);
  });
});
