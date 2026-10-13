import { type SourceCase } from './mailroom.contract';
import {
  type RepairSourceBinding,
  requireSourceConsent,
} from './repair-workflow.contract';

type ReleaseInfo = NonNullable<SourceCase['releaseInfo']> & {
  invoiceRequired?: boolean;
  invoiceStatus?: string;
  invoiceSatisfied?: boolean;
  invoiceQuoteRevision?: number | null;
  quoteBindings?: (RepairSourceBinding & { quoteRevision: number })[];
};

const binding: RepairSourceBinding = {
  itemId: 'repair-piece',
  planVersion: 3,
  planHash: 'current-plan-hash',
  proposalHash: 'current-proposal-hash',
};

function repairSource(changes: Partial<ReleaseInfo> = {}): SourceCase {
  const releaseInfo: ReleaseInfo = {
    quoteRevision: 4,
    customerApprovedQuoteRevision: 4,
    customerApprovedAt: '2026-10-13T00:00:00Z',
    amount: 500,
    currency: 'TWD',
    confirmedPaymentQuoteRevision: 4,
    invoiceRequired: true,
    invoiceStatus: 'ISSUED',
    invoiceSatisfied: true,
    invoiceQuoteRevision: 4,
    quoteBindings: [{ ...binding, quoteRevision: 4 }],
    ...changes,
  };
  return {
    id: 'repair-case',
    number: 'REPAIR-DEMO',
    type: 'REPAIR',
    brand: 'MOZTECH',
    version: '2026-10-13T00:00:00Z',
    status: 'WAITING_CUSTOMER',
    repairAllowed: true,
    releaseInfo,
    customerLabel: '示範',
    items: [],
  };
}

describe('repair source release invoice gate', () => {
  it('accepts a same-version actual required invoice', () => {
    expect(requireSourceConsent(repairSource(), 4, true, binding)).toBe(4);
  });

  it.each(['PENDING', 'FAILED', 'VOIDED', 'NOT_REQUIRED', undefined])(
    'blocks a required invoice with status %s even when marked satisfied',
    (invoiceStatus) => {
      expect(() =>
        requireSourceConsent(repairSource({ invoiceStatus }), 4, true, binding),
      ).toThrow('必要發票');
    },
  );

  it.each([false, undefined, 'true'])(
    'blocks an issued required invoice without a true actual-result flag: %s',
    (invoiceSatisfied) => {
      expect(() =>
        requireSourceConsent(
          repairSource({ invoiceSatisfied } as Partial<ReleaseInfo>),
          4,
          true,
          binding,
        ),
      ).toThrow('必要發票');
    },
  );

  it.each([3, 5, null, undefined])(
    'blocks invoice proof for a missing or different quote version: %s',
    (invoiceQuoteRevision) => {
      expect(() =>
        requireSourceConsent(
          repairSource({ invoiceQuoteRevision }),
          4,
          true,
          binding,
        ),
      ).toThrow('必要發票');
    },
  );

  it.each([undefined, null, 'false', 'true'])(
    'does not infer that a paid quote needs no invoice: %s',
    (invoiceRequired) => {
      expect(() =>
        requireSourceConsent(
          repairSource({ invoiceRequired } as Partial<ReleaseInfo>),
          4,
          true,
          binding,
        ),
      ).toThrow('必要發票');
    },
  );

  it('accepts an explicit source policy that a paid quote needs no invoice', () => {
    expect(
      requireSourceConsent(
        repairSource({ invoiceRequired: false, invoiceStatus: 'NOT_REQUIRED' }),
        4,
        true,
        binding,
      ),
    ).toBe(4);
  });

  it.each([undefined, false])(
    'accepts a zero-amount quote without a required invoice: %s',
    (invoiceRequired) => {
      expect(
        requireSourceConsent(
          repairSource({
            amount: 0,
            confirmedPaymentQuoteRevision: null,
            invoiceRequired,
            invoiceStatus: 'NOT_REQUIRED',
            invoiceSatisfied: undefined,
            invoiceQuoteRevision: undefined,
          }),
          4,
          true,
          binding,
        ),
      ).toBe(4);
    },
  );

  it('does not let a zero amount bypass an explicitly required invoice', () => {
    expect(() =>
      requireSourceConsent(
        repairSource({
          amount: 0,
          confirmedPaymentQuoteRevision: null,
          invoiceStatus: 'PENDING',
          invoiceSatisfied: false,
        }),
        4,
        true,
        binding,
      ),
    ).toThrow('必要發票');
  });

  it('allows CSR consent review before payment or invoice completion', () => {
    const source = repairSource({
      confirmedPaymentQuoteRevision: null,
      invoiceStatus: 'PENDING',
      invoiceSatisfied: false,
    });
    source.repairAllowed = false;
    expect(requireSourceConsent(source, null, false, binding)).toBe(4);
  });

  it.each([
    { customerApprovedQuoteRevision: 3 },
    { customerApprovedAt: null },
    { customerApprovedAt: 'not-a-date' },
  ])('preserves the current consent gate: %j', (change) => {
    expect(() =>
      requireSourceConsent(repairSource(change), 4, true, binding),
    ).toThrow('同意或報價版本');
  });

  it('preserves the caller quote-version gate', () => {
    expect(() =>
      requireSourceConsent(repairSource(), 3, true, binding),
    ).toThrow('同意或報價版本');
  });

  it.each([
    { confirmedPaymentQuoteRevision: null },
    { confirmedPaymentQuoteRevision: 3 },
    { amount: -1 },
    { amount: Number.NaN },
  ])('preserves the current payment gate: %j', (change) => {
    expect(() =>
      requireSourceConsent(repairSource(change), 4, true, binding),
    ).toThrow('足額確認收款');
  });

  it('does not let an invoice result override source denial', () => {
    const source = repairSource();
    source.repairAllowed = false;
    expect(() => requireSourceConsent(source, 4, true, binding)).toThrow(
      '足額確認收款',
    );
  });
});

describe('repair source per-item plan binding', () => {
  it('requires the actual item binding for work release', () => {
    expect(() => requireSourceConsent(repairSource(), 4, true)).toThrow('綁定');
  });

  it.each([
    undefined,
    [],
    [{ ...binding, itemId: 'another-piece', quoteRevision: 4 }],
    [{ ...binding, planVersion: 2, quoteRevision: 4 }],
    [{ ...binding, planHash: 'previous-plan-hash', quoteRevision: 4 }],
    [{ ...binding, proposalHash: 'previous-proposal-hash', quoteRevision: 4 }],
    [{ ...binding, proposalHash: '', quoteRevision: 4 }],
    [{ ...binding, quoteRevision: 3 }],
    [
      { ...binding, quoteRevision: 4 },
      { ...binding, quoteRevision: 4 },
    ],
  ])(
    'blocks a missing, ambiguous or stale target binding: %j',
    (quoteBindings) => {
      expect(() =>
        requireSourceConsent(repairSource({ quoteBindings }), 4, true, binding),
      ).toThrow('檢修方案');
    },
  );

  it('selects the exact target item from a multi-item quote', () => {
    expect(
      requireSourceConsent(
        repairSource({
          quoteBindings: [
            { ...binding, itemId: 'another-piece', quoteRevision: 4 },
            { ...binding, quoteRevision: 4 },
          ],
        }),
        4,
        true,
        binding,
      ),
    ).toBe(4);
  });

  it('checks a supplied CSR review binding even before financial release', () => {
    expect(() =>
      requireSourceConsent(
        repairSource({ quoteBindings: [] }),
        null,
        false,
        binding,
      ),
    ).toThrow('檢修方案');
  });
});

describe('non-repair source release compatibility', () => {
  it('still rejects a non-repair source that has not released work', () => {
    const source = {
      ...repairSource(),
      type: 'RETURN' as const,
      repairAllowed: false,
    };
    expect(() => requireSourceConsent(source, null, true)).toThrow(
      '售後來源尚未放行',
    );
  });

  it('still accepts a released non-repair source without invoice or plan fields', () => {
    const source = {
      ...repairSource(),
      type: 'RETURN' as const,
      releaseInfo: null,
    };
    expect(requireSourceConsent(source, null, true)).toBeNull();
  });

  it('does not require financial release for non-repair review', () => {
    const source = {
      ...repairSource(),
      type: 'RETURN' as const,
      repairAllowed: false,
      releaseInfo: null,
    };
    expect(requireSourceConsent(source, null, false)).toBeNull();
  });
});
