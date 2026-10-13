import { BadGatewayException } from '@nestjs/common';
import {
  assertMailroomDeliveryAck,
  DISPATCH_SCHEMA,
  MailroomDispatchEvent,
  MailroomOutboundOrder,
  REPAIR_PROPOSAL_SCHEMA,
  validateDispatchEvent,
  validateOutboundOrders,
} from './mailroom-workflow-event.contract';

const eventId = '83362099-c6d6-4831-9d06-0b539ea9ad37';
const itemId = 'c2ea3b22-0a95-47da-b4e3-38cfc33b5873';
const receiptId = 'dba55c14-ab03-4579-bf54-cadbf6244e80';
const time = '2026-10-13T01:00:00.000Z';
const event = (): MailroomDispatchEvent => ({
  schema: DISPATCH_SCHEMA,
  eventId,
  entityId: 'company-a',
  sourceCaseId: 'case-a',
  sourceNumber: 'SYNTHETIC-CASE-A',
  sourceVersion: time,
  itemId,
  receiptId,
  version: 1,
  action: 'dispatch',
  occurredAt: time,
  actor: { id: 'staff-a', name: 'SYNTHETIC Clerk' },
  shipment: {
    purpose: 'RESHIPMENT',
    carrier: 'SYNTHETIC Logistics',
    trackingNumber: 'SYNTHETIC-T-1',
    shippedAt: time,
    declaredItemId: 'declared-line-a',
    quantity: 1,
    productName: 'SYNTHETIC Product',
    sku: 'SYNTHETIC-SKU-A',
    serialNumber: null,
    originalSerialNumber: null,
  },
});
const order = (): MailroomOutboundOrder => ({
  id: 'case-a',
  number: 'SYNTHETIC-CASE-A',
  type: 'RESHIPMENT',
  version: time,
  sourceChannel: 'SYNTHETIC CSR',
  brand: 'MOZTECH',
  customerLabel: 'SYNTHETIC Customer',
  dispatchAllowed: true,
  blockReason: null,
  items: [
    {
      id: 'declared-line-a',
      name: 'SYNTHETIC Product',
      sku: null,
      quantity: 2,
      dispatchedQuantity: 1,
      dispatchedUnitIds: [itemId],
    },
  ],
  recipient: {
    name: 'SYNTHETIC Customer',
    phone: '0900000000',
    address: 'SYNTHETIC Address',
  },
});

describe('authoritative outbound Source contract', () => {
  it('returns an explicit copied projection including posted unit IDs and keeps unknown brand null', () => {
    const original = order();
    original.brand = null;
    const result = validateOutboundOrders(
      { items: [original], nextCursor: null },
      'case-a',
    );
    expect(result).toEqual({ items: [original], nextCursor: null });
    result.items[0].items[0].dispatchedUnitIds.push('another-unit');
    expect(original.items[0].dispatchedUnitIds).toEqual([itemId]);
  });
  it('allows blocked orders with empty recipients and legacy quantity without unit IDs', () => {
    const blocked = order();
    blocked.dispatchAllowed = false;
    blocked.blockReason = '等待客服核對';
    blocked.recipient = { name: '', phone: '', address: '' };
    blocked.items[0].dispatchedUnitIds = [];
    expect(
      validateOutboundOrders({ items: [blocked], nextCursor: 'case-next' })
        .items[0],
    ).toEqual(blocked);
  });
  it.each([
    { items: null, nextCursor: null },
    { items: [], nextCursor: undefined },
    { items: [], nextCursor: '../cursor' },
    { items: [], nextCursor: null, sourceSnapshot: {} },
    { items: [null], nextCursor: null },
    {
      items: [{ ...order(), version: '2026-10-13T01:00:00Z' }],
      nextCursor: null,
    },
    {
      items: [{ ...order(), version: '2026-02-30T01:00:00.000Z' }],
      nextCursor: null,
    },
    { items: [{ ...order(), type: 'REPAIR' }], nextCursor: null },
    { items: [{ ...order(), dispatchAllowed: 'true' }], nextCursor: null },
    {
      items: [{ ...order(), recipient: { name: '', phone: '', address: '' } }],
      nextCursor: null,
    },
    {
      items: [{ ...order(), dispatchAllowed: false, blockReason: null }],
      nextCursor: null,
    },
    { items: [order(), order()], nextCursor: null },
  ])(
    'rejects malformed, excessive, non-authoritative or duplicate order data',
    (page) => {
      expect(() => validateOutboundOrders(page)).toThrow(BadGatewayException);
    },
  );
  it.each([
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: '2' },
    { quantity: 201 },
    { dispatchedQuantity: -1 },
    { dispatchedQuantity: 3 },
    { dispatchedUnitIds: undefined },
    { dispatchedUnitIds: [itemId, itemId], dispatchedQuantity: 2 },
    { dispatchedUnitIds: ['../unit'] },
    { dispatchedUnitIds: [itemId], dispatchedQuantity: 0 },
    { dispatchedQuantity: 2, dispatchedUnitIds: [itemId, 'another-unit'] },
  ])(
    'rejects invalid line quantities or unsafe/missing/repeated unit identities',
    (patch) => {
      const input = order();
      Object.assign(input.items[0], patch);
      expect(() =>
        validateOutboundOrders({ items: [input], nextCursor: null }),
      ).toThrow(BadGatewayException);
    },
  );
  it('rejects duplicate line IDs and reuse of one dispatched physical unit across orders', () => {
    const first = order();
    first.items.push({ ...first.items[0], dispatchedUnitIds: [] });
    expect(() =>
      validateOutboundOrders({ items: [first], nextCursor: null }),
    ).toThrow(BadGatewayException);
    const second = order();
    second.id = 'case-b';
    second.items[0].id = 'declared-line-b';
    expect(() =>
      validateOutboundOrders({ items: [order(), second], nextCursor: null }),
    ).toThrow(BadGatewayException);
  });
  it('bounds the full page to fifty orders, one hundred lines and two hundred units', () => {
    const first = order();
    first.items = Array.from({ length: 100 }, (_, index) => ({
      id: 'line-' + index,
      name: 'SYNTHETIC',
      sku: null,
      quantity: 2,
      dispatchedQuantity: 0,
      dispatchedUnitIds: [],
    }));
    expect(
      validateOutboundOrders({ items: [first], nextCursor: null }).items[0]
        .items,
    ).toHaveLength(100);
    const moreUnits = structuredClone(first);
    moreUnits.items[0].quantity = 3;
    expect(() =>
      validateOutboundOrders({ items: [moreUnits], nextCursor: null }),
    ).toThrow(BadGatewayException);
    const moreLines = order();
    moreLines.id = 'case-b';
    moreLines.items[0].dispatchedUnitIds = [];
    expect(() =>
      validateOutboundOrders({ items: [first, moreLines], nextCursor: null }),
    ).toThrow(BadGatewayException);
    const blocked = order();
    blocked.dispatchAllowed = false;
    blocked.blockReason = 'blocked';
    blocked.items = [];
    expect(() =>
      validateOutboundOrders({
        items: Array.from({ length: 51 }, (_, index) => ({
          ...blocked,
          id: 'case-' + index,
        })),
        nextCursor: null,
      }),
    ).toThrow(BadGatewayException);
  });
  it('pins direct lookup to the requested case without accepting a continuation', () => {
    expect(() =>
      validateOutboundOrders(
        { items: [order()], nextCursor: null },
        'case-other',
      ),
    ).toThrow(BadGatewayException);
    expect(() =>
      validateOutboundOrders(
        { items: [order()], nextCursor: 'next' },
        'case-a',
      ),
    ).toThrow(BadGatewayException);
  });
});

describe('dispatch-v1 physical unit and acknowledgment contract', () => {
  it('keeps each dispatch exactly one unit and permits an existing ERP stock proof without a Source posting', () => {
    const input = event();
    input.shipment.stock = {
      postingId: 'posting-a',
      referenceType: 'AFTER_SALES',
      referenceId: 'reference-a',
      productId: 'product-a',
      warehouseId: 'warehouse-a',
      externalInventoryPosted: false,
    };
    const result = validateDispatchEvent(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
  it('preserves the existing repair-detail claim fallback without treating it as an outbound CaseItem', () => {
    const input = event();
    input.shipment.purpose = 'REPAIRED';
    input.shipment.declaredItemId = 'repair:legacy-detail-a';
    expect(validateDispatchEvent(input).shipment.declaredItemId).toBe(
      'repair:legacy-detail-a',
    );
    input.shipment.declaredItemId = 'repair:../legacy-detail-a';
    expect(() => validateDispatchEvent(input)).toThrow(BadGatewayException);
  });
  it.each([
    { schema: 'corely.mailroom.v1' },
    { eventId: 'not-uuid' },
    { itemId: 'not-uuid' },
    { receiptId: 'not-uuid' },
    { version: 0 },
    { sourceVersion: '2026-10-13T01:00:00Z' },
    { action: 'receive' },
    { sourceCaseId: '../case' },
    { actor: { id: 'staff-a', name: '' } },
  ])('rejects a malformed event envelope', (patch) => {
    expect(() => validateDispatchEvent({ ...event(), ...patch })).toThrow(
      BadGatewayException,
    );
  });
  it.each([
    { quantity: 2 },
    { purpose: 'STOCK' },
    { trackingNumber: '' },
    { declaredItemId: '../line' },
    { serialNumber: '' },
    { serialNumber: undefined },
    { originalSerialNumber: undefined },
    {
      stock: {
        postingId: 'p',
        referenceType: 'AFTER_SALES',
        referenceId: 'r',
        productId: 'p',
        warehouseId: 'w',
        externalInventoryPosted: true,
      },
    },
  ])(
    'rejects ambiguous units, missing serial fields or an external inventory effect',
    (patch) => {
      const input = event();
      Object.assign(input.shipment, patch);
      expect(() => validateDispatchEvent(input)).toThrow(BadGatewayException);
    },
  );
  it('requires a fully applied matching Source dispatch before DELIVERED and returns only the shipment marker', () => {
    const ack = {
      accepted: true,
      eventId,
      applied: true,
      sourceCaseId: 'case-a',
      shipmentId: 'source-shipment-a',
      duplicate: true,
    };
    expect(assertMailroomDeliveryAck(event(), ack)).toEqual({
      shipmentId: 'source-shipment-a',
    });
    for (const patch of [
      { eventId: receiptId },
      { accepted: false },
      { applied: false },
      { sourceCaseId: 'case-b' },
      { shipmentId: '' },
      { shipmentId: undefined },
    ]) {
      expect(() =>
        assertMailroomDeliveryAck(event(), { ...ack, ...patch }),
      ).toThrow(BadGatewayException);
    }
    expect(() =>
      assertMailroomDeliveryAck(event(), { accepted: true, eventId }),
    ).toThrow(BadGatewayException);
  });
  it('retains the existing progress ACK but rejects an unknown workflow schema', () => {
    expect(
      assertMailroomDeliveryAck(
        { schema: 'corely.mailroom.v1', eventId },
        { accepted: true, eventId },
      ),
    ).toBeNull();
    expect(() =>
      assertMailroomDeliveryAck(
        { schema: 'corely.mailroom.v1', eventId },
        { accepted: true, eventId: receiptId },
      ),
    ).toThrow(BadGatewayException);
    expect(() =>
      assertMailroomDeliveryAck(
        { schema: 'corely.mailroom.workflow.v1', eventId },
        { accepted: true, eventId },
      ),
    ).toThrow(BadGatewayException);
  });
  it('requires an exact accepted proposal hash for the separate repair workflow ACK', () => {
    const proposalHash = 'a'.repeat(64);
    const input = {
      schema: REPAIR_PROPOSAL_SCHEMA,
      kind: 'REPAIR_PROPOSAL',
      eventId,
      sourceCaseId: 'case-a',
      proposal: { proposalHash },
    };
    const ack = { accepted: true, eventId, acceptedProposalHash: proposalHash };
    expect(assertMailroomDeliveryAck(input, ack)).toBeNull();
    for (const changed of [
      { accepted: true, eventId },
      { ...ack, acceptedProposalHash: 'b'.repeat(64) },
      { ...ack, acceptedProposalHash: true },
    ])
      expect(() => assertMailroomDeliveryAck(input, changed)).toThrow(
        BadGatewayException,
      );
    for (const changed of [
      { ...input, kind: 'DISPATCH' },
      { ...input, sourceCaseId: '../case' },
      { ...input, proposal: { proposalHash: 'not-a-hash' } },
      { ...input, proposal: { proposalHash: 'A'.repeat(64) } },
    ])
      expect(() => assertMailroomDeliveryAck(changed, ack)).toThrow(
        BadGatewayException,
      );
    const invalidId = { ...input, eventId: 'invalid-event' };
    expect(() =>
      assertMailroomDeliveryAck(invalidId, {
        ...ack,
        eventId: 'invalid-event',
      }),
    ).toThrow(BadGatewayException);
  });
});
