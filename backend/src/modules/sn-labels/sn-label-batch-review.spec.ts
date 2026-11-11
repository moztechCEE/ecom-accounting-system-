import {
  validateReceiptEvidence,
  validateUsageEvidence,
} from './sn-label-batch-review';

const now = new Date('2026-11-11T16:10:00+08:00');
const receipt = {
  checkedAt: '2026-11-11T16:01:00+08:00',
  company: 'DEV-COMPANY',
  warehouses: 'DEV-WAREHOUSE',
  purchaseSource: 'DEV-PO-001',
  itemCode: 'DEV-ITEM',
  bindingReference: 'DEV-PO-MATCH',
  reportReference: 'DEV-ECOUNT-QUERY',
  from: '2026-11-01',
  to: '2026-11-11',
  receivedQuantity: 0,
  fullScope: true,
};
const usage = {
  checkedAt: receipt.checkedAt,
  wmsReference: 'DEV-WMS-CARTON-SEARCH',
  wmsState: 'not-found',
  labelsState: 'not-issued',
  physicalReference: 'DEV-LABEL-CHECK',
  holdConfirmed: true,
};

describe('supervisor receipt and usage evidence', () => {
  it.each([
    { reportReference: '' },
    { bindingReference: '' },
    { receivedQuantity: undefined },
    { receivedQuantity: '0' },
    { fullScope: false },
    { from: '2026-11-06' },
    { to: '2026-11-10' },
    { checkedAt: '2026-11-11T16:11:00+08:00' },
  ])('does not turn incomplete evidence into zero receiving: %p', (change) => {
    expect(() =>
      validateReceiptEvidence({ ...receipt, ...change }, '2026-11-05', now),
    ).toThrow();
  });
  it('accepts a documented positive receipt independently of full negative-lookup coverage', () => {
    expect(
      validateReceiptEvidence(
        {
          ...receipt,
          receivedQuantity: 0.5,
          receiptReference: 'DEV-ECOUNT-RECEIPT',
          fullScope: false,
          from: '2026-11-06',
        },
        '2026-11-05',
        now,
      ),
    ).toMatchObject({
      method: 'manual-ecount-purchase-query',
      receivedQuantity: 0.5,
      receiptReference: 'DEV-ECOUNT-RECEIPT',
    });
  });
  it('requires independent resolution for issued files or WMS drafts before calling them unused', () => {
    expect(() => validateUsageEvidence(usage, true, now)).toThrow();
    expect(() =>
      validateUsageEvidence({ ...usage, wmsState: 'draft' }, false, now),
    ).toThrow();
    expect(() =>
      validateUsageEvidence({ ...usage, holdConfirmed: false }, false, now),
    ).toThrow();
    expect(
      validateUsageEvidence(
        {
          ...usage,
          wmsState: 'draft-cleared',
          labelsState: 'verified-unused',
        },
        true,
        now,
      ),
    ).toMatchObject({
      wmsState: 'draft-cleared',
      labelsState: 'verified-unused',
    });
  });
  it('rejects a lookup made before the request while permitting a same-day lookup without an arbitrary expiry', () => {
    const sameDay = { ...receipt, checkedAt: '2026-11-11T12:00:00+08:00' };
    expect(() =>
      validateReceiptEvidence(
        sameDay,
        '2026-11-05',
        now,
        new Date('2026-11-11T12:01:00+08:00'),
      ),
    ).toThrow();
    expect(
      validateReceiptEvidence(
        sameDay,
        '2026-11-05',
        now,
        new Date('2026-11-11T11:59:00+08:00'),
      ).receivedQuantity,
    ).toBe(0);
  });
  it('records explicit sources for documented physical use and compatible WMS use', () => {
    const physical = {
      checkedAt: usage.checkedAt,
      usageSource: 'physical',
      physicalReference: 'DEV-PHYSICAL-ISSUE',
    };
    expect(validateUsageEvidence(physical, false, now)).toMatchObject({
      ...physical,
      checkedAt: new Date(physical.checkedAt).toISOString(),
    });
    expect(() =>
      validateUsageEvidence({ ...physical, physicalReference: '' }, false, now),
    ).toThrow();
    expect(
      validateUsageEvidence({ ...usage, wmsState: 'used' }, false, now),
    ).toMatchObject({
      usageSource: 'wms',
      wmsState: 'used',
      wmsReference: usage.wmsReference,
    });
    expect(() =>
      validateUsageEvidence({ ...usage, usageSource: 'other' }, false, now),
    ).toThrow();
  });
});
