/* All proofs and identities below are synthetic; no provider or database is called. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { ConflictException } from '@nestjs/common';
import {
  productIdentityHash,
  requireCustomerProductDecision,
} from './mailroom-product-decision.contract';

const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERIFIED_CUSTOMER = '0123456789abcdef'.repeat(4);
const GOLDEN_HASH =
  '0c9a9d96be96a16da2ffb3bf47c69fba2b0f74d4dd6804d79e8bdbbce739e2e8';
const production = { devSandbox: false };

function fixture() {
  const item: any = {
    id: ITEM_ID,
    receiptId: RECEIPT_ID,
    entityId: 'company',
    productId: 'product-1',
    productName: '實收投影機',
    sku: 'WANBO-X',
    serialNumber: 'ACTUAL-SN',
    declared: {
      id: 'source-line',
      name: '申報投影機',
      sku: 'CLAIM-SKU',
      serialNumber: 'DECLARED-SN',
      quantity: 2,
    },
    evidence: ['mock://photos/one', 'mock://photos/two'],
    status: 'MISMATCH',
    version: 7,
    custodianId: 'clerk',
    repairOwnerId: null,
    receipt: {
      id: RECEIPT_ID,
      entityId: 'company',
      category: 'REPAIR',
      sourceCaseId: 'case-1',
    },
  };
  const proof: any = {
    proofId: 'product-confirmation-1',
    purpose: 'PRODUCT',
    status: 'APPROVED',
    itemId: ITEM_ID,
    planVersion: 23,
    planHash: productIdentityHash(item),
    actualIdentityHash: productIdentityHash(item),
    customerDecision: 'ACCEPT_ACTUAL',
    verifiedCustomerId: VERIFIED_CUSTOMER,
    provider: 'LINE',
    reviewedById: 'source-reviewer_1',
    submittedAt: '2026-10-13T00:00:00.000Z',
    reviewedAt: '2026-10-13T00:01:00.000Z',
  };
  const source: any = {
    id: 'case-1',
    type: 'REPAIR',
    caseBrand: 'MOZTECH',
    brand: '客戶 workspace label',
    firstReviewErpActorId: 'erp-clerk-unrelated-to-source-reviewer',
    customerProductConfirmations: [proof],
    releaseInfo: {
      invoiceRequired: true,
      invoiceSatisfied: false,
      confirmedPaymentQuoteRevision: null,
      amount: 500,
    },
  };
  return { item, proof, source };
}

describe('fixed actual and declared product identity hash', () => {
  it('matches the exact shared wire golden vector', () => {
    const { item } = fixture();
    expect(productIdentityHash(item)).toBe(GOLDEN_HASH);
  });

  it('custody, status, version, owners, claim, and extra declared counters do not invalidate identity', () => {
    const { item } = fixture();
    const before = productIdentityHash(item);
    Object.assign(item, {
      status: 'REPAIR_RECEIVED',
      version: 900,
      custodianId: 'technician',
      repairOwnerId: 'technician',
      nextUserId: 'new-owner',
      quantity: 999,
    });
    Object.assign(item.declared, {
      receivedQuantity: 10,
      remainingQuantity: 5,
    });
    expect(productIdentityHash(item)).toBe(before);
  });

  it.each([
    [
      'productId',
      (item: any) => {
        item.productId = 'other-product';
      },
    ],
    [
      'product name',
      (item: any) => {
        item.productName = '另一件商品';
      },
    ],
    [
      'SKU',
      (item: any) => {
        item.sku = 'OTHER';
      },
    ],
    [
      'SN',
      (item: any) => {
        item.serialNumber = 'OTHER-SN';
      },
    ],
    [
      'declared line',
      (item: any) => {
        item.declared.id = 'other-line';
      },
    ],
    [
      'declared name',
      (item: any) => {
        item.declared.name = '另一申報';
      },
    ],
    [
      'declared SKU',
      (item: any) => {
        item.declared.sku = 'OTHER-CLAIM';
      },
    ],
    [
      'declared SN',
      (item: any) => {
        item.declared.serialNumber = 'OTHER-CLAIM-SN';
      },
    ],
    [
      'declared quantity',
      (item: any) => {
        item.declared.quantity = 3;
      },
    ],
    [
      'same-count changed photo',
      (item: any) => {
        item.evidence[0] = 'mock://photos/changed';
      },
    ],
    [
      'photo order',
      (item: any) => {
        item.evidence.reverse();
      },
    ],
    [
      'added photo',
      (item: any) => {
        item.evidence.push('mock://photos/three');
      },
    ],
    [
      'removed photo',
      (item: any) => {
        item.evidence.pop();
      },
    ],
    [
      'receipt',
      (item: any) => {
        item.receiptId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      },
    ],
  ])('invalidates prior approval when %s changes', (_name, change) => {
    const { item, source } = fixture();
    change(item);
    expect(productIdentityHash(item)).not.toBe(GOLDEN_HASH);
    expect(() =>
      requireCustomerProductDecision(item, source, production),
    ).toThrow(ConflictException);
  });

  it('normalizes absent nullable fields and absent evidence to the same explicit null/empty wire', () => {
    const { item } = fixture();
    delete item.productId;
    delete item.sku;
    delete item.serialNumber;
    delete item.evidence;
    delete item.declared.sku;
    delete item.declared.serialNumber;
    const absent = productIdentityHash(item);
    Object.assign(item, {
      productId: null,
      sku: null,
      serialNumber: null,
      evidence: [],
    });
    Object.assign(item.declared, { sku: null, serialNumber: null });
    expect(productIdentityHash(item)).toBe(absent);
    item.evidence = null;
    expect(productIdentityHash(item)).toBe(absent);
  });

  it.each([
    [
      'missing declared',
      (item: any) => {
        item.declared = undefined;
      },
    ],
    [
      'missing declared name',
      (item: any) => {
        delete item.declared.name;
      },
    ],
    [
      'missing declared quantity',
      (item: any) => {
        delete item.declared.quantity;
      },
    ],
    [
      'zero declared quantity',
      (item: any) => {
        item.declared.quantity = 0;
      },
    ],
    [
      'fractional declared quantity',
      (item: any) => {
        item.declared.quantity = 1.5;
      },
    ],
    [
      'string declared quantity',
      (item: any) => {
        item.declared.quantity = '2';
      },
    ],
    [
      'invalid native UUID',
      (item: any) => {
        item.id = 'item';
      },
    ],
    [
      'invalid receipt UUID',
      (item: any) => {
        item.receiptId = 'receipt';
      },
    ],
    [
      'non-array evidence',
      (item: any) => {
        item.evidence = { photo: 'mock://one' };
      },
    ],
    [
      'non-string SKU',
      (item: any) => {
        item.sku = 5;
      },
    ],
    [
      'non-string declared SN',
      (item: any) => {
        item.declared.serialNumber = ['SN'];
      },
    ],
  ])('fails closed without guessing %s', (_name, change) => {
    const { item } = fixture();
    change(item);
    expect(() => productIdentityHash(item)).toThrow(ConflictException);
  });
});

describe('fresh signed Source customer product decision', () => {
  it.each(['MOZTECH', 'BONSON', 'WANBO'])(
    'accepts one approved LINE identity for true %s brand',
    (caseBrand) => {
      const { item, source, proof } = fixture();
      source.caseBrand = caseBrand;
      expect(requireCustomerProductDecision(item, source, production)).toEqual(
        proof,
      );
    },
  );

  it('accepts nested RETURN product confirmation independently of invoice/payment and native version', () => {
    const { item, source, proof } = fixture();
    item.receipt.category = source.type = 'RETURN';
    item.version = 999;
    delete source.customerProductConfirmations;
    source.releaseInfo.customerProductConfirmations = [proof];
    expect(requireCustomerProductDecision(item, source, production)).toEqual(
      proof,
    );
  });

  it('claim and assignment changes retain approval without tying Source reviewer to ERP KPI actor', () => {
    const { item, source, proof } = fixture();
    item.custodianId = 'technician';
    item.repairOwnerId = 'technician';
    item.version++;
    expect(source.firstReviewErpActorId).not.toBe(proof.reviewedById);
    expect(requireCustomerProductDecision(item, source, production)).toEqual(
      proof,
    );
  });

  it('ignores unrelated item proofs and obsolete hashes while requiring exactly one current approval', () => {
    const { item, source, proof } = fixture();
    source.customerProductConfirmations.push(
      {
        ...proof,
        proofId: 'other-item',
        itemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
      {
        ...proof,
        proofId: 'old-plan',
        planHash: 'a'.repeat(64),
        actualIdentityHash: 'a'.repeat(64),
      },
      { ...proof, proofId: 'pending-review', status: 'PENDING' },
    );
    expect(requireCustomerProductDecision(item, source, production)).toEqual(
      proof,
    );
  });

  it.each(['product-confirmation-1', 'product-confirmation-2'])(
    'refuses duplicate current approvals in the authoritative array: %s',
    (proofId) => {
      const { item, source, proof } = fixture();
      source.customerProductConfirmations.push({ ...proof, proofId });
      expect(() =>
        requireCustomerProductDecision(item, source, production),
      ).toThrow('唯一顧客確認');
    },
  );

  it('uses the authoritative top array when the same proof is also projected in releaseInfo', () => {
    const { item, source, proof } = fixture();
    source.releaseInfo.customerProductConfirmations = [structuredClone(proof)];
    expect(requireCustomerProductDecision(item, source, production)).toEqual(
      proof,
    );
  });

  it('an empty authoritative top array cannot recover a stale nested approval', () => {
    const { item, source, proof } = fixture();
    source.customerProductConfirmations = [];
    source.releaseInfo.customerProductConfirmations = [proof];
    expect(() =>
      requireCustomerProductDecision(item, source, production),
    ).toThrow('唯一顧客確認');
  });

  it('a valid top array does not depend on a malformed legacy nested field', () => {
    const { item, source, proof } = fixture();
    source.releaseInfo.customerProductConfirmations = { stale: true };
    expect(requireCustomerProductDecision(item, source, production)).toEqual(
      proof,
    );
  });

  it('a malformed present top field cannot fall back to a nested approval', () => {
    const { item, source, proof } = fixture();
    source.customerProductConfirmations = null;
    source.releaseInfo.customerProductConfirmations = [proof];
    expect(() =>
      requireCustomerProductDecision(item, source, production),
    ).toThrow('格式不符');
  });

  it.each([
    [
      'wrong case',
      (item: any, source: any) => {
        source.id = 'other-case';
      },
    ],
    [
      'wrong case type',
      (item: any, source: any) => {
        source.type = 'RETURN';
      },
    ],
    [
      'unidentified true brand',
      (item: any, source: any) => {
        source.caseBrand = null;
        source.brand = 'MOZTECH';
      },
    ],
    [
      'missing true brand',
      (item: any, source: any) => {
        delete source.caseBrand;
        source.brand = 'MOZTECH';
      },
    ],
    [
      'client label as brand',
      (item: any, source: any) => {
        source.caseBrand = 'MOZTECH workspace';
      },
    ],
    [
      'foreign receipt company',
      (item: any) => {
        item.receipt.entityId = 'other-company';
      },
    ],
    [
      'foreign receipt identity',
      (item: any) => {
        item.receipt.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      },
    ],
    [
      'wrong native item',
      (item: any) => {
        item.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      },
    ],
    [
      'missing Source proof',
      (item: any, source: any) => {
        source.customerProductConfirmations = [];
      },
    ],
    [
      'malformed Source proof list',
      (item: any, source: any) => {
        source.customerProductConfirmations = { proof: 'forged' };
      },
    ],
  ])('rejects %s', (_name, change) => {
    const { item, source } = fixture();
    change(item, source);
    expect(() =>
      requireCustomerProductDecision(item, source, production),
    ).toThrow(ConflictException);
  });

  it.each([
    ['customer rejected actual', { customerDecision: 'REJECT_ACTUAL' }],
    ['unapproved', { status: 'PENDING' }],
    ['non-product purpose', { purpose: 'PAYMENT' }],
    ['wrong proof item', { itemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
    ['wrong plan hash', { planHash: 'a'.repeat(64) }],
    ['wrong actual hash', { actualIdentityHash: 'b'.repeat(64) }],
    ['unsafe proof ID', { proofId: '../../proof' }],
    ['empty proof ID', { proofId: '' }],
    ['zero recorded plan version', { planVersion: 0 }],
    ['string recorded plan version', { planVersion: '23' }],
    ['fractional plan version', { planVersion: 23.5 }],
    ['unhashed customer subject', { verifiedCustomerId: 'U-raw-line-subject' }],
    [
      'uppercase customer hash',
      { verifiedCustomerId: VERIFIED_CUSTOMER.toUpperCase() },
    ],
    ['short customer hash', { verifiedCustomerId: 'a'.repeat(63) }],
    ['unknown provider', { provider: 'CLIENT' }],
    ['boxed provider', { provider: new String('LINE') }],
    ['unsafe peer reviewer', { reviewedById: '../reviewer' }],
    ['blank peer reviewer', { reviewedById: ' ' }],
    ['unparseable submitted date', { submittedAt: 'not-a-date' }],
    ['rolled-over date', { submittedAt: '2026-02-31T00:00:00.000Z' }],
    [
      'timezone date outside wire',
      { submittedAt: '2026-10-13T08:00:00+08:00' },
    ],
    ['review before submit', { reviewedAt: '2026-10-12T23:59:59.999Z' }],
  ])('fails closed for %s', (_name, changed) => {
    const { item, source, proof } = fixture();
    Object.assign(proof, changed);
    expect(() =>
      requireCustomerProductDecision(item, source, production),
    ).toThrow(ConflictException);
  });

  it('accepts valid equal timestamps without forcing a native plan version match', () => {
    const { item, source, proof } = fixture();
    proof.submittedAt = proof.reviewedAt = '2026-10-13T00:00:00Z';
    expect(proof.planVersion).not.toBe(item.version);
    expect(requireCustomerProductDecision(item, source, production)).toEqual(
      proof,
    );
  });

  it.each([
    { devSandbox: true, entityId: 'doa-dev-qa-20261002', allowed: true },
    { devSandbox: false, entityId: 'doa-dev-qa-20261002', allowed: false },
    { devSandbox: true, entityId: 'company', allowed: false },
    { devSandbox: false, entityId: 'company', allowed: false },
  ])(
    'DEV_STUB requires trusted sandbox flag and exact QA entity: $devSandbox/$entityId',
    ({ devSandbox, entityId, allowed }) => {
      const { item, source, proof } = fixture();
      item.entityId = item.receipt.entityId = entityId;
      proof.provider = 'DEV_STUB';
      const invoke = () =>
        requireCustomerProductDecision(item, source, { devSandbox });
      if (allowed) expect(invoke()).toEqual(proof);
      else expect(invoke).toThrow(ConflictException);
    },
  );

  it('cannot replace fresh Source approval with command or old receipt snapshot fields', () => {
    const { item, source, proof } = fixture();
    item.customerProductConfirmations = [proof];
    item.clientPlanHash = proof.planHash;
    item.receipt.sourceSnapshot = { ...source };
    source.customerProductConfirmations = [];
    expect(productIdentityHash(item)).toBe(GOLDEN_HASH);
    expect(() =>
      requireCustomerProductDecision(item, source, production),
    ).toThrow(ConflictException);
  });

  it('returns only a cloned proof without modifying Source or preserving unrelated fields', () => {
    const { item, source, proof } = fixture();
    proof.customerPhone = 'synthetic-private-field';
    const before = structuredClone(source);
    const approved = requireCustomerProductDecision(item, source, production);
    expect(approved).not.toHaveProperty('customerPhone');
    approved.reviewedById = 'different-local-reader';
    expect(source).toEqual(before);
  });
});
