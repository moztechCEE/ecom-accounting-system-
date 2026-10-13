import {
  type RepairDispositionProof,
  type RepairDispositionExpected,
  type RepairDispositionPolicy,
  requireRepairDispositionProof,
} from './repair-disposition.contract';

function fixture() {
  const binding = {
    itemId: 'original-piece',
    planVersion: 3,
    planHash: '1'.repeat(64),
    proposalHash: '2'.repeat(64),
  };
  const expected: RepairDispositionExpected = {
    companyId: 'source-tenant',
    caseId: 'source-case',
    brand: 'MOZTECH',
    customerId: 'current-customer',
    customerIdentityId: 'verified-customer-line-identity',
    binding,
    quoteRevision: 4,
    decision: 'RETURN_ORIGINAL',
  };
  const proof: RepairDispositionProof = {
    schema: 'corely.customer.confirmation.v1',
    id: 'confirmation-receipt',
    revision: 2,
    purpose: 'DISPOSITION',
    status: 'APPROVED',
    companyId: expected.companyId,
    caseId: expected.caseId,
    brand: expected.brand,
    customerId: expected.customerId,
    customerIdentityId: expected.customerIdentityId,
    identityProvider: 'LINE',
    identityVerified: true,
    decision: expected.decision,
    binding: { ...binding },
    quoteRevision: 4,
    submittedAt: '2026-10-12T03:00:00.000Z',
    reviewedAt: '2026-10-12T04:00:00.000Z',
    reviewedById: 'source-csr',
    current: true,
    invalidatedAt: null,
    expiresAt: '2026-10-13T03:00:00.000Z',
  };
  const policy: RepairDispositionPolicy = {
    entityId: 'erp-company',
    allowDevStub: false,
    now: new Date('2026-10-13T04:00:00.000Z'),
  };
  return { proof, expected, policy };
}

describe('current verified customer disposition authorization', () => {
  it('accepts an approved exact-customer original-return proof without conflating ERP and Source tenant IDs', () => {
    const { proof, expected, policy } = fixture();
    const receipt = requireRepairDispositionProof([proof], expected, policy);
    expect(receipt).toEqual(proof);
    expect(receipt.companyId).not.toBe(policy.entityId);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.binding)).toBe(true);
    proof.binding.proposalHash = '3'.repeat(64);
    expect(receipt.binding.proposalHash).toBe('2'.repeat(64));
    expect(receipt).not.toHaveProperty('disposedAt');
    expect(receipt).not.toHaveProperty('inventoryPosted');
    expect(receipt).not.toHaveProperty('physicalCustody');
  });

  it('accepts SCRAP as authorization while never turning it into actual disposal', () => {
    const { proof, expected, policy } = fixture();
    proof.decision = 'SCRAP';
    expected.decision = 'SCRAP';
    const receipt = requireRepairDispositionProof([proof], expected, policy);
    expect(receipt.decision).toBe('SCRAP');
    expect(receipt).not.toHaveProperty('execution');
    expect(receipt).not.toHaveProperty('completedAt');
  });

  it('does not let a valid proof for another device interfere with the current device', () => {
    const { proof, expected, policy } = fixture();
    const other = {
      ...structuredClone(proof),
      status: 'SUPERSEDED',
      current: false,
      invalidatedAt: '2026-10-12T05:00:00Z',
      binding: { ...proof.binding, itemId: 'other-piece' },
    };
    expect(
      requireRepairDispositionProof([other, proof], expected, policy),
    ).toEqual(proof);
  });

  it('does not guess a malformed or ambiguous array entry to belong to another device', () => {
    const { proof, expected, policy } = fixture();
    for (const unknown of [null, 'notes', {}, { binding: {} }])
      expect(() =>
        requireRepairDispositionProof([proof, unknown], expected, policy),
      ).toThrow();
  });

  it.each([null, undefined, {}, [], 'customer agreed', 1])(
    'rejects missing or malformed proof collection %j',
    (proofs) => {
      const { expected, policy } = fixture();
      expect(() =>
        requireRepairDispositionProof(proofs, expected, policy),
      ).toThrow();
    },
  );

  it('refuses duplicated current-device proof, including identical retries and competing older receipts', () => {
    const { proof, expected, policy } = fixture();
    const older = {
      ...structuredClone(proof),
      id: 'old-confirmation',
      status: 'SUPERSEDED',
      current: false,
    };
    for (const second of [proof, structuredClone(proof), older])
      expect(() =>
        requireRepairDispositionProof([proof, second], expected, policy),
      ).toThrow('唯一');
  });

  it.each([
    ['companyId', 'other-source-tenant'],
    ['caseId', 'other-case'],
    ['brand', 'BONSON'],
    ['customerId', 'other-customer'],
    ['customerIdentityId', 'other-line-identity'],
  ])('rejects a different current %s', (key, value) => {
    const { proof, expected, policy } = fixture();
    Object.assign(proof, { [key]: value });
    expect(() =>
      requireRepairDispositionProof([proof], expected, policy),
    ).toThrow('身份');
  });

  it.each(['itemId', 'planVersion', 'planHash', 'proposalHash'] as const)(
    'rejects changed %s rather than reusing old consent',
    (field) => {
      const { proof, expected, policy } = fixture();
      if (field === 'itemId') expected.binding.itemId = 'another-current-piece';
      if (field === 'planVersion') expected.binding.planVersion++;
      if (field === 'planHash') expected.binding.planHash = '3'.repeat(64);
      if (field === 'proposalHash')
        expected.binding.proposalHash = '4'.repeat(64);
      expect(() =>
        requireRepairDispositionProof([proof], expected, policy),
      ).toThrow();
    },
  );

  it('invalidates a changed formal quote even when the original technical proposal is unchanged', () => {
    const { proof, expected, policy } = fixture();
    expected.quoteRevision++;
    expect(() =>
      requireRepairDispositionProof([proof], expected, policy),
    ).toThrow('報價已改版');
  });

  it('accepts explicit known quote revision zero, but never guesses an unknown quote revision as zero', () => {
    const { proof, expected, policy } = fixture();
    proof.quoteRevision = 0;
    expected.quoteRevision = 0;
    expect(
      requireRepairDispositionProof([proof], expected, policy).quoteRevision,
    ).toBe(0);
    for (const quoteRevision of [null, undefined, '0', -1, 0.5, Number.NaN]) {
      const invalid = { ...proof, quoteRevision };
      expect(() =>
        requireRepairDispositionProof([invalid], expected, policy),
      ).toThrow();
    }
  });

  it.each(['PENDING', 'SUBMITTED', 'REJECTED', 'SUPERSEDED', 'CANCELLED'])(
    'rejects status %s even with a customer note saying yes',
    (status) => {
      const { proof, expected, policy } = fixture();
      const invalid = { ...proof, status };
      expect(() =>
        requireRepairDispositionProof([invalid], expected, policy),
      ).toThrow('失效');
    },
  );

  it.each([
    { schema: 'corely.customer.confirmation.v0' },
    { purpose: 'QUOTE' },
    { identityProvider: 'MANUAL' },
    { identityProvider: '' },
    { decision: 'DECLINE' },
    { decision: 'CONFIRM' },
    { identityVerified: false },
    { identityVerified: 'true' },
    { current: false },
    { current: 'true' },
    { invalidatedAt: '2026-10-12T05:00:00Z' },
    { reviewedById: '' },
    { submittedAt: null },
    { reviewedAt: 'not-a-date' },
    { revision: 0 },
  ])('fails closed on incorrect proof fields %j', (change) => {
    const { proof, expected, policy } = fixture();
    expect(() =>
      requireRepairDispositionProof(
        [{ ...proof, ...change }],
        expected,
        policy,
      ),
    ).toThrow();
  });

  it('does not mistake approval of original return for approval to scrap, or the reverse', () => {
    for (const disposition of ['RETURN_ORIGINAL', 'SCRAP'] as const) {
      const { proof, expected, policy } = fixture();
      proof.decision = disposition;
      expected.decision = disposition === 'SCRAP' ? 'RETURN_ORIGINAL' : 'SCRAP';
      expect(() =>
        requireRepairDispositionProof([proof], expected, policy),
      ).toThrow('處置方式');
    }
  });

  it('rejects an unknown field or missing required field instead of accepting an undocumented proof', () => {
    const { proof, expected, policy } = fixture();
    expect(() =>
      requireRepairDispositionProof(
        [{ ...proof, reviewNote: 'customer agreed' }],
        expected,
        policy,
      ),
    ).toThrow();
    for (const key of [
      'schema',
      'current',
      'identityVerified',
      'invalidatedAt',
      'quoteRevision',
    ]) {
      const invalid: Record<string, unknown> = { ...proof };
      delete invalid[key];
      expect(() =>
        requireRepairDispositionProof([invalid], expected, policy),
      ).toThrow();
    }
  });

  it('does not accept malformed hash or binding extra keys even when other IDs agree', () => {
    const { proof, expected, policy } = fixture();
    for (const change of [
      { planHash: 'plan' },
      { proposalHash: 'not-original-proof' },
      { planVersion: '3' },
      { itemId: ' ' },
      { decision: 'SCRAP' },
    ])
      expect(() =>
        requireRepairDispositionProof(
          [{ ...proof, binding: { ...proof.binding, ...change } }],
          expected,
          policy,
        ),
      ).toThrow();
  });

  it('permits a reviewed proof after the link submission deadline, with no separate authorization expiry', () => {
    const { proof, expected, policy } = fixture();
    proof.expiresAt = '2026-10-12T03:30:00.000Z';
    // The customer submitted before this deadline; CSR reviewed afterwards.
    expect(requireRepairDispositionProof([proof], expected, policy)).toEqual(
      proof,
    );
  });

  it('refuses a claimed customer submission after the link deadline', () => {
    const { proof, expected, policy } = fixture();
    proof.expiresAt = '2026-10-12T02:59:59.999Z';
    expect(() =>
      requireRepairDispositionProof([proof], expected, policy),
    ).toThrow('提交期限');
  });

  it.each(['2026-10-13T03:59:59.999Z', '2026-10-13T04:00:00.000Z'])(
    'refuses expired independent authorization validUntil %s',
    (validUntil) => {
      const { proof, expected, policy } = fixture();
      proof.validUntil = validUntil;
      expect(() =>
        requireRepairDispositionProof([proof], expected, policy),
      ).toThrow('到期');
    },
  );

  it('accepts a future authorization expiry, explicit null, or no expiry', () => {
    const { proof, expected, policy } = fixture();
    for (const validUntil of ['2026-10-14T04:00:00.000Z', null, undefined]) {
      const value = {
        ...proof,
        ...(validUntil === undefined ? {} : { validUntil }),
      };
      expect(requireRepairDispositionProof([value], expected, policy).id).toBe(
        proof.id,
      );
    }
  });

  it.each([
    { submittedAt: '2026-10-12T05:00:00.000Z' },
    { reviewedAt: '2026-10-13T04:00:00.001Z' },
    { submittedAt: '2026-02-30T03:00:00.000Z' },
    { reviewedAt: '2026-10-12T12:00:00+08:00' },
  ])(
    'rejects reversed, future or invalid UTC receipt timestamps %j',
    (change) => {
      const { proof, expected, policy } = fixture();
      expect(() =>
        requireRepairDispositionProof(
          [{ ...proof, ...change }],
          expected,
          policy,
        ),
      ).toThrow();
    },
  );

  it('accepts short valid UTC fractions without changing the saved receipt', () => {
    const { proof, expected, policy } = fixture();
    proof.reviewedAt = '2026-10-12T04:00:00.1Z';
    expect(
      requireRepairDispositionProof([proof], expected, policy).reviewedAt,
    ).toBe(proof.reviewedAt);
  });

  it('accepts DEV_STUB only with the trusted server flag and exact ERP QA entity, not Source namespace equality', () => {
    const { proof, expected, policy } = fixture();
    proof.identityProvider = 'DEV_STUB';
    policy.allowDevStub = true;
    policy.entityId = 'doa-dev-qa-20261002';
    expect(
      requireRepairDispositionProof([proof], expected, policy).identityProvider,
    ).toBe('DEV_STUB');
    expect(proof.companyId).not.toBe(policy.entityId);
  });

  it.each([
    { allowDevStub: false, entityId: 'doa-dev-qa-20261002' },
    { allowDevStub: true, entityId: 'production-company' },
    { allowDevStub: true, entityId: 'source-tenant' },
    { allowDevStub: 'true', entityId: 'doa-dev-qa-20261002' },
  ])('refuses DEV_STUB with unsafe server policy %j', (change) => {
    const { proof, expected, policy } = fixture();
    proof.identityProvider = 'DEV_STUB';
    const unsafe = { ...policy, ...change } as RepairDispositionPolicy;
    expect(() =>
      requireRepairDispositionProof([proof], expected, unsafe),
    ).toThrow();
  });

  it('rejects malformed server context and clock instead of silently filling unknown values', () => {
    const { proof, expected, policy } = fixture();
    for (const change of [
      { quoteRevision: undefined },
      { customerIdentityId: '' },
      { companyId: '' },
    ])
      expect(() =>
        requireRepairDispositionProof(
          [proof],
          { ...expected, ...change } as RepairDispositionExpected,
          policy,
        ),
      ).toThrow();
    for (const now of [null, '2026-10-13T04:00:00Z', new Date('invalid')])
      expect(() =>
        requireRepairDispositionProof([proof], expected, {
          ...policy,
          now,
        } as RepairDispositionPolicy),
      ).toThrow();
  });
});
