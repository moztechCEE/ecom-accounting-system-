import { type SourceCase } from './mailroom.contract';
import {
  type RepairProposalItem,
  repairSourceBindingForItem,
} from './repair-proposal.contract';
import { requireSourceDisposition } from './repair-disposition-source.contract';

const opaque = 'a'.repeat(64);
function fixture() {
  const item: RepairProposalItem = {
    id: 'piece',
    entityId: 'erp-company',
    receiptId: 'receipt',
    version: 9,
    label: 'SYNTHETIC-PIECE',
    productName: 'SYNTHETIC DEVICE',
    productId: 'product',
    sku: 'SYNTHETIC-SKU',
    serialNumber: 'SYNTHETIC-SN',
    declared: { id: 'source-item' },
    status: 'INSPECTING',
    repairOwnerId: 'tech',
    custodianId: 'tech',
    receipt: {
      category: 'REPAIR',
      sourceCaseId: 'source-case',
      sourceNumber: 'SYNTHETIC-CASE',
    },
    repairInspection: {
      number: 'INS-SYNTHETIC',
      revision: 3,
      status: 'SUBMITTED',
      authorId: 'tech',
      authorName: 'tech',
      updatedAt: '2026-10-05T00:00:00Z',
      data: {
        complaint: '無法啟動',
        reproduction: 'YES',
        testConditions: '原廠電源',
        checks: [{ name: '啟動', result: 'FAIL', observation: '無法啟動' }],
        diagnosis: '主板故障',
        causeStatus: 'CONFIRMED',
        plan: 'RETURN',
        planNote: '原件寄回',
        feeSuggestion: 'FREE',
        estimateNote: '',
      },
    },
  };
  const source: SourceCase = {
    id: 'source-case',
    number: 'SYNTHETIC-CASE',
    type: 'REPAIR',
    brand: 'MOZTECH',
    version: 'source-version',
    status: 'PENDING_SHIPMENT',
    repairAllowed: false,
    customerLabel: 'SYNTHETIC',
    items: [
      {
        id: 'source-item',
        name: item.productName,
        sku: item.sku,
        serialNumber: item.serialNumber,
        quantity: 1,
      },
    ],
    releaseInfo: {
      quoteRevision: 4,
      customerApprovedQuoteRevision: null,
      customerApprovedAt: null,
      amount: 0,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: null,
    },
  };
  Object.assign(source, { caseBrand: 'MOZTECH' });
  const binding = repairSourceBindingForItem(item, source);
  const identity = {
    companyId: 'source-company',
    caseId: source.id,
    brand: source.brand,
    verifiedCustomerId: opaque,
    verified: true,
  };
  const proof = {
    proofId: 'confirmation-id',
    proofRevision: 2,
    status: 'APPROVED',
    purpose: 'DISPOSITION',
    quoteRevision: 4,
    ...binding,
    customerDecision: 'RETURN_ORIGINAL',
    verifiedCustomerId: opaque,
    provider: 'LINE',
    reviewedById: 'csr',
    reviewedAt: '2026-10-05T00:02:00Z',
    submittedAt: '2026-10-05T00:01:00Z',
  };
  const release = Object.assign(source.releaseInfo!, {
    customerIdentity: identity,
    customerDecisions: [proof],
  });
  const policy = {
    allowDevStub: false,
    entityId: item.entityId,
    now: new Date('2026-10-06T00:00:00Z'),
  };
  return { item, source, binding, identity, proof, release, policy };
}

describe('fresh signed Source disposition adapter', () => {
  it('uses opaque current identity and separate Source/ERP namespaces without requiring positive repair consent', () => {
    const { item, source, policy } = fixture();
    const proof = requireSourceDisposition(
      source,
      item,
      'RETURN_ORIGINAL',
      policy,
    );
    expect(proof).toMatchObject({
      companyId: 'source-company',
      revision: 2,
      customerId: opaque,
      customerIdentityId: opaque,
      decision: 'RETURN_ORIGINAL',
    });
    expect(Object.isFrozen(proof)).toBe(true);
  });
  it('accepts an authoritative identity nested in this unique current proof, but never another piece identity', () => {
    const { item, source, proof, release, identity, policy } = fixture();
    const nested = { ...proof, customerIdentity: identity };
    Object.assign(release, {
      customerIdentity: undefined,
      customerDecisions: [nested],
    });
    expect(
      requireSourceDisposition(source, item, 'RETURN_ORIGINAL', policy).id,
    ).toBe(proof.proofId);
    Object.assign(release, {
      customerDecisions: [{ ...nested, itemId: 'other-piece' }, proof],
    });
    expect(() =>
      requireSourceDisposition(source, item, 'RETURN_ORIGINAL', policy),
    ).toThrow();
  });
  it('rejects conflicting parent and nested identity without accepting an authorization', () => {
    const { item, source, proof, release, identity, policy } = fixture();
    Object.assign(release, {
      customerDecisions: [
        { ...proof, customerIdentity: { ...identity, brand: 'BONSON' } },
      ],
    });
    expect(() =>
      requireSourceDisposition(source, item, 'RETURN_ORIGINAL', policy),
    ).toThrow();
  });
  it('uses true caseBrand while a display window differs and rejects absent or unknown caseBrand', () => {
    const { item, source, policy } = fixture();
    source.brand = '售後服務窗口';
    expect(
      requireSourceDisposition(source, item, 'RETURN_ORIGINAL', policy)
        .decision,
    ).toBe('RETURN_ORIGINAL');
    Object.assign(source, { caseBrand: null });
    expect(() =>
      requireSourceDisposition(source, item, 'RETURN_ORIGINAL', policy),
    ).toThrow('案件品牌');
    Object.assign(source, { caseBrand: undefined });
    expect(() =>
      requireSourceDisposition(source, item, 'RETURN_ORIGINAL', policy),
    ).toThrow('案件品牌');
  });
  it.each([
    'identity',
    'proof',
    'revision',
    'brand',
    'case',
    'customer',
    'plan',
    'proposal',
    'quote',
    'provider',
    'duplicate',
    'closed',
    'decision',
    'malformed',
    'entity',
  ])('blocks %s before producing an authorization receipt', (reason) => {
    const { item, source, proof, release, identity, policy } = fixture();
    if (reason === 'identity') identity.verified = false;
    if (reason === 'proof') release.customerDecisions = [];
    if (reason === 'revision') proof.proofRevision = 0;
    if (reason === 'brand') identity.brand = 'BONSON';
    if (reason === 'case') identity.caseId = 'other-case';
    if (reason === 'customer') proof.verifiedCustomerId = 'b'.repeat(64);
    if (reason === 'plan') proof.planVersion += 1;
    if (reason === 'proposal') item.serialNumber = 'OTHER-SN';
    if (reason === 'quote') proof.quoteRevision += 1;
    if (reason === 'provider') proof.provider = 'DEV_STUB';
    if (reason === 'duplicate') release.customerDecisions.push({ ...proof });
    if (reason === 'closed') source.status = 'CLOSED';
    if (reason === 'decision') proof.customerDecision = 'SCRAP';
    if (reason === 'malformed')
      (
        release as unknown as { customerDecisions: unknown[] }
      ).customerDecisions = [null];
    if (reason === 'entity') policy.entityId = 'another-company';
    expect(() =>
      requireSourceDisposition(source, item, 'RETURN_ORIGINAL', policy),
    ).toThrow();
  });
  it('keeps another identified piece from invalidating this piece or approving it', () => {
    const { item, source, proof, release, policy } = fixture();
    release.customerDecisions.push({
      ...proof,
      itemId: 'other-piece',
      customerDecision: 'SCRAP',
    });
    expect(
      requireSourceDisposition(source, item, 'RETURN_ORIGINAL', policy).id,
    ).toBe(proof.proofId);
    expect(() =>
      requireSourceDisposition(source, item, 'SCRAP', policy),
    ).toThrow();
  });
});
