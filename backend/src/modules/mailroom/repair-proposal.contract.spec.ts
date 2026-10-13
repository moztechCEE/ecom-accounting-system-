import { type Actor, type SourceCase } from './mailroom.contract';
import {
  type InspectionDocument,
  inspectionPlanHash,
} from './repair-document.contract';
import {
  type RepairProposalEvent,
  type RepairProposalItem,
  buildRepairProposalEvent,
  repairProposalHash,
  repairSourceBindingForItem,
  validateRepairProposalEvent,
} from './repair-proposal.contract';

const eventId = '01a117fd-0a9e-7882-a4aa-c9a27d34f1d3';
const itemId = 'aaad7cc6-7273-4000-8abc-333333333333';
const receiptId = 'aaad7cc6-7273-4000-8abc-444444444444';
const actor: Actor = {
  id: 'technician',
  name: '維修師',
  entityIds: ['company'],
  permissions: new Set(['repair_workbench:update']),
};
function fixture() {
  const inspection: InspectionDocument = {
    number: 'INS-REPAIR-001',
    revision: 3,
    status: 'SUBMITTED',
    authorId: actor.id,
    authorName: actor.name,
    submittedAt: '2026-10-13T04:00:00.000Z',
    updatedAt: '2026-10-13T04:00:00.000Z',
    data: {
      complaint: '無法開機',
      reproduction: 'YES',
      testConditions: '原廠電源',
      checks: [
        { name: '開機', result: 'FAIL', observation: '供電正常仍不啟動' },
      ],
      diagnosis: '電源模組故障',
      causeStatus: 'CONFIRMED',
      plan: 'REPAIR',
      planNote: '更換電源模組後複驗',
      feeSuggestion: 'PAID',
      estimateAmount: 500.01,
      estimateNote: '電源模組與工資',
    },
  };
  const item: RepairProposalItem = {
    id: itemId,
    entityId: 'company',
    receiptId,
    version: 9,
    label: 'REPAIR-001',
    productName: '合成測試產品',
    productId: 'erp-product',
    sku: 'ORIGINAL-SKU',
    serialNumber: 'ORIGINAL-SN',
    declared: { id: 'source-line' },
    status: 'WAITING_CUSTOMER',
    repairOwnerId: actor.id,
    custodianId: actor.id,
    repairInspection: inspection,
    receipt: {
      category: 'REPAIR',
      sourceCaseId: 'same-case',
      sourceNumber: 'CASE-001',
    },
  };
  const source: SourceCase = {
    id: 'same-case',
    number: 'CASE-001',
    type: 'REPAIR',
    brand: 'MOZTECH',
    version: '2026-10-13T04:00:00.000Z',
    status: 'INSPECTING',
    customerLabel: '合成顧客',
    repairAllowed: false,
    releaseInfo: {
      quoteRevision: 2,
      customerApprovedQuoteRevision: null,
      customerApprovedAt: null,
      amount: null,
      currency: 'TWD',
      confirmedPaymentQuoteRevision: null,
    },
    items: [
      {
        id: 'source-line',
        name: '申報產品',
        sku: 'DECLARED-SKU',
        serialNumber: null,
        quantity: 2,
      },
    ],
  };
  return {
    eventId,
    occurredAt: '2026-10-13T04:01:00.000Z',
    actor,
    item,
    source,
  };
}
function changed(
  event: RepairProposalEvent,
  edit: (value: RepairProposalEvent) => void,
) {
  const copy = structuredClone(event);
  edit(copy);
  copy.proposal.proposalHash = repairProposalHash(copy);
  return copy;
}

describe('server-built same-case repair proposals', () => {
  it('binds the submitted revision, actual original piece and currency without writing the Source quote', () => {
    const input = fixture();
    const before = structuredClone(input.item);
    const sourceBefore = structuredClone(input.source);
    const event = buildRepairProposalEvent(input);
    expect(event).toMatchObject({
      schema: 'corely.aftersales.workflow.v1',
      kind: 'REPAIR_PROPOSAL',
      sourceCaseId: 'same-case',
      itemId,
      receiptId,
      version: 9,
      proposal: {
        inspectionDocumentId: 'INS-REPAIR-001',
        inspectionRevision: 3,
        planVersion: 3,
        planHash: inspectionPlanHash(
          input.item.repairInspection as InspectionDocument,
        ),
        original: {
          sourceItemId: 'source-line',
          productId: 'erp-product',
          sku: 'ORIGINAL-SKU',
          serialNumber: 'ORIGINAL-SN',
          quantity: 1,
        },
        feeMode: 'PAID',
        amount: 500.01,
        currency: 'TWD',
        isUnderWarranty: null,
        isAccidentalDamage: null,
        customerVisibleSummary: '',
      },
    });
    expect(input.item).toEqual(before);
    expect(input.source).toEqual(sourceBefore);
    expect(event.proposal.proposalHash).toHaveLength(64);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.proposal.original)).toBe(true);
    expect(JSON.stringify(event)).not.toContain('customerLabel');
    expect(JSON.stringify(event)).not.toContain('permissions');
    input.item.sku = 'LATER-SKU';
    (input.item.repairInspection as InspectionDocument).data.diagnosis =
      '後續改版';
    expect(event.proposal.original.sku).toBe('ORIGINAL-SKU');
    expect(event.proposal.summary).toBe('電源模組故障');
  });

  it.each(['FREE', 'REVIEW'] as const)(
    'keeps %s distinct from paid and does not guess REVIEW as free',
    (mode) => {
      const input = fixture();
      const doc = input.item.repairInspection as InspectionDocument;
      doc.data.feeSuggestion = mode;
      const proposal = buildRepairProposalEvent(input).proposal;
      expect(proposal.feeMode).toBe(mode);
      expect(proposal.amount).toBe(mode === 'FREE' ? 0 : null);
    },
  );

  it('keeps no-SN originals and proposed replacement SKU/condition separate', () => {
    const input = fixture();
    input.item.serialNumber = null;
    const doc = input.item.repairInspection as InspectionDocument;
    doc.data.plan = 'REPLACE';
    doc.data.replacementSku = 'REFURB-SKU';
    doc.data.replacementCondition = 'REFURBISHED';
    const proposal = buildRepairProposalEvent(input).proposal;
    expect(proposal.original.serialNumber).toBeNull();
    expect(proposal.original.sku).toBe('ORIGINAL-SKU');
    expect(proposal.replacementSku).toBe('REFURB-SKU');
    expect(proposal.replacementCondition).toBe('REFURBISHED');
  });

  it.each(['FACTORY', 'RETURN'] as const)(
    'preserves the %s proposal without fabricating a repair outcome',
    (plan) => {
      const input = fixture();
      (input.item.repairInspection as InspectionDocument).data.plan = plan;
      const event = buildRepairProposalEvent(input);
      expect(event.proposal.plan).toBe(plan);
      expect(event).not.toHaveProperty('releasePurpose');
      expect(event).not.toHaveProperty('inventoryPosted');
    },
  );

  it('takes explicit assessments/customer summary only from the hash-bound inspection', () => {
    const input = fixture();
    Object.assign((input.item.repairInspection as InspectionDocument).data, {
      isUnderWarranty: true,
      isAccidentalDamage: false,
      customerVisibleSummary: '檢測發現電源模組故障，建議更換並複驗。',
    });
    const proposal = buildRepairProposalEvent(input).proposal;
    expect(proposal).toMatchObject({
      isUnderWarranty: true,
      isAccidentalDamage: false,
    });
    expect(proposal.customerVisibleSummary).toContain('電源模組');
    expect(proposal.planHash).toBe(
      inspectionPlanHash(input.item.repairInspection as InspectionDocument),
    );
  });

  it('recomputes the same binding for the CSR reader without impersonating a technician or creating an event', () => {
    const input = fixture();
    const event = buildRepairProposalEvent(input);
    input.item.status = 'INSPECTING';
    const binding = repairSourceBindingForItem(input.item, input.source);
    expect(binding).toEqual({
      itemId,
      planVersion: 3,
      planHash: event.proposal.planHash,
      proposalHash: event.proposal.proposalHash,
    });
    expect(binding).not.toHaveProperty('actor');
    expect(binding).not.toHaveProperty('eventId');
    expect(Object.isFrozen(binding)).toBe(true);
    // A projection is not a permission grant: event writing still refuses this stage.
    expect(() => buildRepairProposalEvent(input)).toThrow();
  });

  it('accepts nonempty fixture identities in the read projection while enforcing UUIDs at the writer', () => {
    const input = fixture();
    input.item.id = 'piece';
    input.item.receiptId = 'receipt';
    expect(repairSourceBindingForItem(input.item, input.source).itemId).toBe(
      'piece',
    );
    expect(() => buildRepairProposalEvent(input)).toThrow();
  });

  it.each(['sku', 'serialNumber', 'productId', 'currency'] as const)(
    'changes the recomputed proposal hash after current %s changes, even with the old inspection hash',
    (field) => {
      const input = fixture();
      const oldBinding = repairSourceBindingForItem(input.item, input.source);
      if (field === 'currency') input.source.releaseInfo!.currency = 'HKD';
      else input.item[field] = 'CHANGED-IDENTITY';
      const current = repairSourceBindingForItem(input.item, input.source);
      expect(current.planHash).toBe(oldBinding.planHash);
      expect(current.planVersion).toBe(oldBinding.planVersion);
      expect(current.proposalHash).not.toBe(oldBinding.proposalHash);
    },
  );

  it('keeps multiple real pieces of one source line distinct instead of replacing a case-wide hash', () => {
    const input = fixture();
    const first = repairSourceBindingForItem(input.item, input.source);
    input.item.id = receiptId;
    input.item.serialNumber = 'SECOND-ORIGINAL-SN';
    const second = repairSourceBindingForItem(input.item, input.source);
    expect(second.itemId).not.toBe(first.itemId);
    expect(second.proposalHash).not.toBe(first.proposalHash);
    expect(second.planHash).toBe(first.planHash);
  });

  it.each([
    'source case',
    'source line',
    'currency',
    'draft',
    'empty original identity',
  ])('refuses an invalid current %s in the read projection', (field) => {
    const input = fixture();
    if (field === 'source case') input.source.id = 'other';
    if (field === 'source line') input.item.declared = { id: 'other' };
    if (field === 'currency') input.source.releaseInfo = null;
    if (field === 'draft')
      (input.item.repairInspection as InspectionDocument).status = 'DRAFT';
    if (field === 'empty original identity') input.item.id = '';
    expect(() =>
      repairSourceBindingForItem(input.item, input.source),
    ).toThrow();
  });

  it('uses canonical semantic hashing for retries but binds company/case/piece/currency/content', () => {
    const event = buildRepairProposalEvent(fixture());
    const retry = changed(event, (value) => {
      value.eventId = 'aaad7cc6-7273-4000-8abc-555555555555';
      value.version++;
      value.occurredAt = '2026-10-13T04:02:00.000Z';
    });
    expect(retry.proposal.proposalHash).toBe(event.proposal.proposalHash);
    const shuffled = {
      ...Object.fromEntries(Object.entries(event).reverse()),
      proposal: {
        ...Object.fromEntries(Object.entries(event.proposal).reverse()),
        original: Object.fromEntries(
          Object.entries(event.proposal.original).reverse(),
        ),
      },
      actor: Object.fromEntries(Object.entries(event.actor).reverse()),
    };
    expect(
      validateRepairProposalEvent(JSON.parse(JSON.stringify(event))),
    ).toEqual(event);
    expect(validateRepairProposalEvent(shuffled)).toEqual(event);
    for (const edit of [
      (value: RepairProposalEvent) => {
        value.entityId = 'other-company';
      },
      (value: RepairProposalEvent) => {
        value.sourceCaseId = 'other-case';
      },
      (value: RepairProposalEvent) => {
        value.itemId = receiptId;
      },
      (value: RepairProposalEvent) => {
        value.receiptId = itemId;
      },
      (value: RepairProposalEvent) => {
        value.proposal.currency = 'HKD';
      },
      (value: RepairProposalEvent) => {
        value.proposal.original.sku = 'OTHER';
      },
      (value: RepairProposalEvent) => {
        value.proposal.amount = 501;
      },
      (value: RepairProposalEvent) => {
        value.proposal.summary = '另一方案';
      },
    ])
      expect(changed(event, edit).proposal.proposalHash).not.toBe(
        event.proposal.proposalHash,
      );
  });

  it.each([
    'foreign entity',
    'foreign owner',
    'foreign custodian',
    'no write grant',
    'external custody',
    'wrong stage',
    'draft inspection',
    'foreign source case',
    'foreign source number',
    'foreign source line',
    'missing currency',
    'terminal source',
  ])('rejects %s before producing any payload', (reason) => {
    const input = fixture();
    if (reason === 'foreign entity') input.item.entityId = 'other-company';
    if (reason === 'foreign owner') input.item.repairOwnerId = 'other';
    if (reason === 'foreign custodian') input.item.custodianId = 'other';
    if (reason === 'no write grant')
      input.actor = { ...actor, permissions: new Set() };
    if (reason === 'external custody')
      input.item.repairWorkflow = {
        schema: 1,
        factory: { physicalCustody: 'FACTORY' },
      };
    if (reason === 'wrong stage') input.item.status = 'INSPECTING';
    if (reason === 'draft inspection')
      (input.item.repairInspection as InspectionDocument).status = 'DRAFT';
    if (reason === 'foreign source case') input.source.id = 'other-case';
    if (reason === 'foreign source number') input.source.number = 'CASE-OTHER';
    if (reason === 'foreign source line')
      input.item.declared = { id: 'other-line' };
    if (reason === 'missing currency') input.source.releaseInfo = null;
    if (reason === 'terminal source') input.source.status = 'COMPLETED';
    expect(() => buildRepairProposalEvent(input)).toThrow();
  });

  it.each([
    'old plan version',
    'zero paid amount',
    'fractional amount',
    'free positive amount',
    'review zero amount',
    'nonfinite amount',
    'missing replacement',
    'false string',
    'unknown key',
    'unknown envelope key',
    'nonunit quantity',
    'invalid UUID',
    'invalid currency',
    'empty diagnosis',
    'oversize summary',
    'forged hash',
  ])(
    'rejects %s even when the transport signature would be valid',
    (reason) => {
      const event = structuredClone(buildRepairProposalEvent(fixture()));
      const proposal = event.proposal;
      if (reason === 'old plan version') proposal.planVersion++;
      if (reason === 'zero paid amount') proposal.amount = 0;
      if (reason === 'fractional amount') proposal.amount = 1.001;
      if (reason === 'free positive amount') proposal.feeMode = 'FREE';
      if (reason === 'review zero amount') {
        proposal.feeMode = 'REVIEW';
        proposal.amount = 0;
      }
      if (reason === 'nonfinite amount') proposal.amount = Number.NaN;
      if (reason === 'missing replacement') proposal.plan = 'REPLACE';
      if (reason === 'false string')
        Object.assign(proposal, { isUnderWarranty: 'false' });
      if (reason === 'unknown key') Object.assign(proposal, { finalAmount: 1 });
      if (reason === 'unknown envelope key')
        Object.assign(event, { customerApprovedRepair: true });
      if (reason === 'nonunit quantity')
        Object.assign(proposal.original, { quantity: 2 });
      if (reason === 'invalid UUID') event.itemId = 'source-line';
      if (reason === 'invalid currency') proposal.currency = 'NTD$';
      if (reason === 'empty diagnosis') proposal.summary = '';
      if (reason === 'oversize summary') proposal.summary = '測'.repeat(2001);
      proposal.proposalHash = repairProposalHash(event);
      if (reason === 'forged hash') proposal.proposalHash = '0'.repeat(64);
      expect(() => validateRepairProposalEvent(event)).toThrow();
    },
  );
});
