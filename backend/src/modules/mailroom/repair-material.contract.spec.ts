import {
  materialQuantityCents,
  materialReadiness,
  requireMaterialReadiness,
  validateMaterialPlan,
  type RepairMaterialContext,
  type RepairMaterialPlan,
  type RepairMaterialReceipt,
} from './repair-material.contract';

describe('repair material readiness requires the current allocated and physically received parts', () => {
  it.each([
    { mode: ['NONE'] },
    { mode: ['REQUIRED'] },
    { mode: ['UNASSESSED'] },
  ])(
    'a JSON array mode %p cannot be inferred as assessed materials',
    ({ mode }) => {
      expect(() => validateMaterialPlan({ mode, lines: [] }, true)).toThrow();
      expect(
        materialReadiness(
          {
            entityId: 'company',
            itemId: 'item',
            inspectionRevision: 1,
            planHash: 'a'.repeat(64),
          },
          { mode, lines: [] },
          null,
        ).state,
      ).toBe('BLOCKED');
    },
  );
  const context: RepairMaterialContext = {
    entityId: 'company',
    itemId: 'repair-unit',
    inspectionRevision: 3,
    planHash: 'a'.repeat(64),
    requiredReceiverId: 'technician',
  };
  const plan: RepairMaterialPlan = {
    mode: 'REQUIRED',
    lines: [
      {
        id: 'battery',
        productId: 'battery-product',
        warehouseId: 'parts-warehouse',
        requiredQuantity: '1.25',
        requiredForStart: true,
      },
    ],
  };
  const receipt = (): RepairMaterialReceipt => ({
    ...context,
    schema: 1,
    status: 'READY',
    lines: [
      {
        requirementId: 'battery',
        productId: 'battery-product',
        warehouseId: 'parts-warehouse',
        allocationId: 'allocated-battery',
        allocatedQty: '1.25',
        physicalReceipt: {
          ...context,
          id: 'physical-battery',
          status: 'RECEIVED',
          productId: 'battery-product',
          warehouseId: 'parts-warehouse',
          quantity: '1.25',
          receivedById: 'technician',
          receivedAt: '2026-10-13T00:00:00Z',
        },
      },
    ],
  });
  it('only explicit NONE passes without inventory proof; an absent plan and UNASSESSED never become NONE', () => {
    expect(
      materialReadiness(context, { mode: 'NONE', lines: [] }, undefined).state,
    ).toBe('READY');
    expect(materialReadiness(context, undefined, undefined).state).toBe(
      'BLOCKED',
    );
    expect(
      materialReadiness(context, { mode: 'UNASSESSED', lines: [] }, undefined)
        .state,
    ).toBe('UNKNOWN');
    expect(() =>
      validateMaterialPlan({ mode: 'NONE', lines: plan.lines }),
    ).toThrow();
    expect(() =>
      validateMaterialPlan({ mode: 'REQUIRED', lines: [] }),
    ).toThrow();
  });
  it.each(['1.255', '1e2', ' 1', '01', '0', '-1', 1, '100000.01'])(
    'rejects unsupported quantity %p without rounding',
    (quantity) => {
      expect(() => materialQuantityCents(quantity)).toThrow();
    },
  );
  it('matches decimals exactly and respects deferred material requirements by stage', () => {
    expect(requireMaterialReadiness(context, plan, receipt()).state).toBe(
      'READY',
    );
    const later = structuredClone(plan);
    later.lines[0].requiredForStart = false;
    expect(materialReadiness(context, later, null, 'START').reason).toBe(
      'NOT_REQUIRED',
    );
    expect(materialReadiness(context, later, null, 'COMPLETION').state).toBe(
      'UNKNOWN',
    );
    const equivalent = receipt();
    equivalent.lines[0].allocatedQty = '1.25';
    expect(materialReadiness(context, plan, equivalent).state).toBe('READY');
  });
  it.each(['entityId', 'itemId', 'inspectionRevision', 'planHash'])(
    'a %s changed after receipt blocks work',
    (key) => {
      const proof = receipt() as unknown as Record<string, unknown>;
      proof[key] = key === 'inspectionRevision' ? 2 : 'other';
      expect(materialReadiness(context, plan, proof).state).toBe('BLOCKED');
    },
  );
  it.each(['productId', 'warehouseId', 'allocatedQty', 'allocationId'])(
    'unmatched allocation %s cannot pass',
    (key) => {
      const proof = receipt();
      (proof.lines[0] as unknown as Record<string, unknown>)[key] =
        key === 'allocatedQty' ? '1.26' : '';
      expect(() => requireMaterialReadiness(context, plan, proof)).toThrow(
        '本版備料',
      );
    },
  );
  it.each([
    'entityId',
    'itemId',
    'inspectionRevision',
    'planHash',
    'productId',
    'warehouseId',
    'quantity',
    'receivedById',
    'receivedAt',
    'status',
  ])('actual physical receipt %s must agree', (key) => {
    const proof = receipt(),
      physical = proof.lines[0].physicalReceipt as unknown as Record<
        string,
        unknown
      >;
    physical[key] =
      key === 'quantity'
        ? '1.24'
        : key === 'inspectionRevision'
          ? 4
          : key === 'receivedById'
            ? ''
            : 'wrong';
    expect(materialReadiness(context, plan, proof).state).toBe('BLOCKED');
  });
  it('unknown proof, duplicate requirements and double-use of a physical receipt never authorize work', () => {
    const proof = receipt();
    proof.status = 'UNKNOWN';
    expect(materialReadiness(context, plan, proof).state).toBe('UNKNOWN');
    expect(() =>
      validateMaterialPlan({ ...plan, lines: [...plan.lines, ...plan.lines] }),
    ).toThrow('重複');
    const two = structuredClone(plan);
    two.lines.push({ ...two.lines[0], id: 'second-battery' });
    const duplicate = receipt();
    duplicate.lines.push({
      ...duplicate.lines[0],
      requirementId: 'second-battery',
    });
    expect(materialReadiness(context, two, duplicate).state).toBe('BLOCKED');
    const missing = receipt();
    (missing.lines[0] as unknown as Record<string, unknown>).physicalReceipt =
      undefined;
    expect(materialReadiness(context, plan, missing).state).toBe('BLOCKED');
  });
  it('another recipient or an unknown current recipient cannot establish personal receipt', () => {
    const proof = receipt();
    proof.lines[0].physicalReceipt!.receivedById = 'other-technician';
    expect(materialReadiness(context, plan, proof).state).toBe('BLOCKED');
    expect(
      materialReadiness(
        { ...context, requiredReceiverId: undefined },
        plan,
        receipt(),
      ).state,
    ).toBe('UNKNOWN');
  });
  it('a global partial receipt can cover only the actual start subset and cannot certify completion', () => {
    const two = structuredClone(plan);
    two.lines.push({ ...two.lines[0], id: 'later', requiredForStart: false });
    const partial = receipt();
    partial.status = 'PARTIAL';
    expect(materialReadiness(context, two, partial, 'START')).toEqual({
      state: 'READY',
      reason: 'READY',
      requiredCount: 1,
    });
    expect(materialReadiness(context, two, partial, 'COMPLETION').state).toBe(
      'BLOCKED',
    );
    (
      partial.lines[0].physicalReceipt as unknown as { quantity: string }
    ).quantity = '1.24';
    expect(materialReadiness(context, two, partial, 'START').state).toBe(
      'BLOCKED',
    );
  });
  const settled = () => {
    const proof = receipt();
    proof.lines[0].settlement = {
      consumedQty: '1.00',
      returnedQty: '0.25',
      outstandingQty: '0.00',
      outTransactionId: 'out-battery',
      releaseTransactionId: 'release-battery',
      returnedById: 'stock-staff',
      returnedAt: '2026-10-13T03:00:00Z',
    };
    return proof;
  };
  it('full physical receipt is separate from exact consumed/returned settlement', () => {
    expect(materialReadiness(context, plan, receipt(), 'START').state).toBe(
      'READY',
    );
    expect(
      materialReadiness(context, plan, receipt(), 'COMPLETION').reason,
    ).toBe('MISSING_SETTLEMENT');
    expect(
      materialReadiness(context, plan, settled(), 'COMPLETION').state,
    ).toBe('READY');
    const consumed = settled();
    consumed.lines[0].settlement = {
      consumedQty: '1.25',
      returnedQty: '0',
      outstandingQty: '0',
      outTransactionId: 'out-battery',
      releaseTransactionId: null,
      returnedById: null,
      returnedAt: null,
    };
    expect(materialReadiness(context, plan, consumed, 'COMPLETION').state).toBe(
      'READY',
    );
    const returned = settled();
    returned.lines[0].settlement!.consumedQty = '0';
    returned.lines[0].settlement!.returnedQty = '1.25';
    returned.lines[0].settlement!.outTransactionId = null;
    expect(materialReadiness(context, plan, returned, 'COMPLETION').state).toBe(
      'READY',
    );
  });
  it.each([
    { consumedQty: '1.255' },
    { consumedQty: 1 },
    { consumedQty: '1.01' },
    { returnedQty: '0.26' },
    { outstandingQty: '0.01' },
    { outTransactionId: null },
    { releaseTransactionId: null },
    { returnedById: null },
    { returnedAt: 'unknown' },
  ])(
    'unsettled or unverifiable actual use %p cannot certify completion',
    (patch) => {
      const proof = settled();
      Object.assign(proof.lines[0].settlement!, patch);
      expect(materialReadiness(context, plan, proof, 'COMPLETION').state).toBe(
        'BLOCKED',
      );
    },
  );
  it('one formal consumption or release transaction cannot settle two requirements', () => {
    const two = structuredClone(plan);
    two.lines.push({ ...two.lines[0], id: 'second' });
    for (const duplicate of [
      'outTransactionId',
      'releaseTransactionId',
    ] as const) {
      const proof = settled(),
        row = structuredClone(proof.lines[0]);
      row.requirementId = 'second';
      row.allocationId = 'allocated-second';
      row.physicalReceipt!.id = 'physical-second';
      row.settlement!.outTransactionId = 'out-second';
      row.settlement!.releaseTransactionId = 'release-second';
      row.settlement![duplicate] = proof.lines[0].settlement![duplicate];
      proof.lines.push(row);
      expect(materialReadiness(context, two, proof, 'COMPLETION').state).toBe(
        'BLOCKED',
      );
    }
  });
});
