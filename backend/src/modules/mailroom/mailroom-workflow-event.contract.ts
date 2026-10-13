import { BadGatewayException } from '@nestjs/common';
import {
  EXCHANGE_READY_KIND,
  validateExchangeReadyEvent,
} from './mailroom-exchange-ready.contract';

export const DISPATCH_SCHEMA = 'corely.mailroom.dispatch.v1' as const;
export const REPAIR_PROPOSAL_SCHEMA = 'corely.aftersales.workflow.v1' as const;
export const DISPATCH_PURPOSES = [
  'REPAIRED',
  'REPLACED',
  'RETURN_UNREPAIRED',
  'RESHIPMENT',
  'PRIVATE_PURCHASE',
  'EXCHANGE_RETURN',
] as const;
export type DispatchPurpose = (typeof DISPATCH_PURPOSES)[number];
export type MailroomDispatchEvent = {
  schema: typeof DISPATCH_SCHEMA;
  eventId: string;
  entityId: string;
  sourceCaseId: string;
  sourceNumber: string;
  sourceVersion: string;
  itemId: string;
  receiptId: string;
  version: number;
  action: 'dispatch';
  occurredAt: string;
  actor: { id: string; name: string };
  shipment: {
    purpose: DispatchPurpose;
    carrier: string;
    trackingNumber: string;
    shippedAt: string;
    declaredItemId: string;
    quantity: 1;
    productName: string;
    sku: string | null;
    serialNumber: string | null;
    originalSerialNumber: string | null;
    stock?: {
      postingId: string;
      referenceType: string;
      referenceId: string;
      productId: string;
      warehouseId: string;
      externalInventoryPosted: false;
    };
  };
};
export const OUTBOUND_ORDER_TYPES = [
  'RESHIPMENT',
  'PRIVATE_PURCHASE',
  'EXCHANGE_RETURN',
] as const;
export type MailroomOutboundOrder = {
  id: string;
  number: string;
  type: (typeof OUTBOUND_ORDER_TYPES)[number];
  version: string;
  sourceChannel: string;
  brand: string | null;
  customerLabel: string;
  dispatchAllowed: boolean;
  blockReason: string | null;
  items: Array<{
    id: string;
    name: string;
    sku: string | null;
    quantity: number;
    dispatchedQuantity: number;
    dispatchedUnitIds: string[];
  }>;
  recipient: { name: string; phone: string; address: string };
};
export type MailroomOutboundOrdersPage = {
  items: MailroomOutboundOrder[];
  nextCursor: string | null;
};

const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown, max = 200, allowEmpty = false): value is string =>
  typeof value === 'string' &&
  value.length <= max &&
  (allowEmpty || value.trim().length > 0);
const id = (value: unknown): value is string =>
  typeof value === 'string' && identifier.test(value);
const declaredId = (value: unknown): value is string =>
  id(value) ||
  (typeof value === 'string' && /^repair:[A-Za-z0-9_-]{1,128}$/.test(value));
const nullableText = (value: unknown, max = 128): value is string | null =>
  value === null || text(value, max);
const iso = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const invalidOrder = () => new BadGatewayException('售後寄件資料格式不符');
const invalidDispatch = () => new BadGatewayException('寄出事件格式不符');

/** Only validated server data is returned; browser snapshots cannot become Source authority. */
export function validateOutboundOrders(
  value: unknown,
  expectedCaseId?: string,
): MailroomOutboundOrdersPage {
  if (
    !object(value) ||
    !only(value, ['items', 'nextCursor']) ||
    !Array.isArray(value.items) ||
    value.items.length > 50 ||
    !(value.nextCursor === null || id(value.nextCursor)) ||
    (expectedCaseId !== undefined && !id(expectedCaseId))
  )
    throw invalidOrder();
  let lineCount = 0;
  let unitCount = 0;
  const orderIds = new Set<string>();
  const dispatchedUnits = new Set<string>();
  const items = value.items.map((entry): MailroomOutboundOrder => {
    if (
      !object(entry) ||
      !only(entry, [
        'id',
        'number',
        'type',
        'version',
        'sourceChannel',
        'brand',
        'customerLabel',
        'dispatchAllowed',
        'blockReason',
        'items',
        'recipient',
      ]) ||
      !id(entry.id) ||
      orderIds.has(entry.id) ||
      (expectedCaseId !== undefined && entry.id !== expectedCaseId) ||
      !text(entry.number) ||
      !OUTBOUND_ORDER_TYPES.includes(
        entry.type as MailroomOutboundOrder['type'],
      ) ||
      !iso(entry.version) ||
      !text(entry.sourceChannel) ||
      !nullableText(entry.brand) ||
      !text(entry.customerLabel) ||
      typeof entry.dispatchAllowed !== 'boolean' ||
      !(entry.dispatchAllowed
        ? entry.blockReason === null
        : text(entry.blockReason, 1000)) ||
      !Array.isArray(entry.items) ||
      entry.items.length > 100 ||
      !object(entry.recipient) ||
      !only(entry.recipient, ['name', 'phone', 'address']) ||
      !text(entry.recipient.name, 200, !entry.dispatchAllowed) ||
      !text(entry.recipient.phone, 128, !entry.dispatchAllowed) ||
      !text(entry.recipient.address, 1000, !entry.dispatchAllowed)
    )
      throw invalidOrder();
    orderIds.add(entry.id);
    const lineIds = new Set<string>();
    const lines = entry.items.map((line) => {
      if (
        !object(line) ||
        !only(line, [
          'id',
          'name',
          'sku',
          'quantity',
          'dispatchedQuantity',
          'dispatchedUnitIds',
        ]) ||
        !id(line.id) ||
        lineIds.has(line.id) ||
        !text(line.name) ||
        !nullableText(line.sku) ||
        !integer(line.quantity, 1, 200) ||
        !integer(line.dispatchedQuantity, 0, Number(line.quantity)) ||
        !Array.isArray(line.dispatchedUnitIds) ||
        line.dispatchedUnitIds.length > line.dispatchedQuantity ||
        !line.dispatchedUnitIds.every(
          (unitId) => id(unitId) && !dispatchedUnits.has(unitId),
        )
      )
        throw invalidOrder();
      const unitIds = line.dispatchedUnitIds as string[];
      for (const unitId of unitIds) {
        if (dispatchedUnits.has(unitId)) throw invalidOrder();
        dispatchedUnits.add(unitId);
      }
      lineIds.add(line.id);
      lineCount++;
      unitCount += line.quantity;
      if (lineCount > 100 || unitCount > 200) throw invalidOrder();
      return {
        id: line.id,
        name: line.name,
        sku: line.sku,
        quantity: line.quantity,
        dispatchedQuantity: line.dispatchedQuantity,
        dispatchedUnitIds: [...unitIds],
      };
    });
    if (
      entry.dispatchAllowed &&
      !lines.some((line) => line.dispatchedQuantity < line.quantity)
    )
      throw invalidOrder();
    return {
      id: entry.id,
      number: entry.number,
      type: entry.type as MailroomOutboundOrder['type'],
      version: entry.version,
      sourceChannel: entry.sourceChannel,
      brand: entry.brand,
      customerLabel: entry.customerLabel,
      dispatchAllowed: entry.dispatchAllowed,
      blockReason: entry.blockReason as string | null,
      items: lines,
      recipient: {
        name: entry.recipient.name,
        phone: entry.recipient.phone,
        address: entry.recipient.address,
      },
    };
  });
  if (expectedCaseId !== undefined && value.nextCursor !== null)
    throw invalidOrder();
  return {
    items,
    nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null,
  };
}

/** One event refers to exactly one physical unit, even for a multi-piece shipment. */
export function validateDispatchEvent(value: unknown): MailroomDispatchEvent {
  if (
    !object(value) ||
    !only(value, [
      'schema',
      'eventId',
      'entityId',
      'sourceCaseId',
      'sourceNumber',
      'sourceVersion',
      'itemId',
      'receiptId',
      'version',
      'action',
      'occurredAt',
      'actor',
      'shipment',
    ]) ||
    value.schema !== DISPATCH_SCHEMA ||
    !text(value.eventId, 36) ||
    !uuid.test(value.eventId) ||
    !id(value.entityId) ||
    !id(value.sourceCaseId) ||
    !text(value.sourceNumber) ||
    !iso(value.sourceVersion) ||
    !text(value.itemId, 36) ||
    !uuid.test(value.itemId) ||
    !text(value.receiptId, 36) ||
    !uuid.test(value.receiptId) ||
    !integer(value.version, 1, 2147483647) ||
    value.action !== 'dispatch' ||
    !iso(value.occurredAt) ||
    !object(value.actor) ||
    !only(value.actor, ['id', 'name']) ||
    !id(value.actor.id) ||
    !text(value.actor.name) ||
    !object(value.shipment) ||
    !only(value.shipment, [
      'purpose',
      'carrier',
      'trackingNumber',
      'shippedAt',
      'declaredItemId',
      'quantity',
      'productName',
      'sku',
      'serialNumber',
      'originalSerialNumber',
      'stock',
    ])
  )
    throw invalidDispatch();
  const shipment = value.shipment;
  if (
    !DISPATCH_PURPOSES.includes(shipment.purpose as DispatchPurpose) ||
    !text(shipment.carrier, 128) ||
    !text(shipment.trackingNumber, 128) ||
    !iso(shipment.shippedAt) ||
    !declaredId(shipment.declaredItemId) ||
    shipment.quantity !== 1 ||
    !text(shipment.productName) ||
    !nullableText(shipment.sku) ||
    !nullableText(shipment.serialNumber) ||
    !nullableText(shipment.originalSerialNumber)
  )
    throw invalidDispatch();
  const stock = shipment.stock;
  if (
    stock !== undefined &&
    (!object(stock) ||
      !only(stock, [
        'postingId',
        'referenceType',
        'referenceId',
        'productId',
        'warehouseId',
        'externalInventoryPosted',
      ]) ||
      ![
        'postingId',
        'referenceType',
        'referenceId',
        'productId',
        'warehouseId',
      ].every((key) => id(stock[key])) ||
      stock.externalInventoryPosted !== false)
  )
    throw invalidDispatch();
  return structuredClone(value) as unknown as MailroomDispatchEvent;
}

/** A legacy receipt ACK cannot acknowledge that a new dispatch was applied. */
export function assertMailroomDeliveryAck(
  payload: unknown,
  response: unknown,
): { shipmentId: string } | null {
  if (
    !object(payload) ||
    !object(response) ||
    response.accepted !== true ||
    response.eventId !== payload.eventId
  )
    throw new BadGatewayException('收發事件回執不符');
  if (payload.schema === DISPATCH_SCHEMA) {
    const event = validateDispatchEvent(payload);
    if (
      response.applied !== true ||
      response.sourceCaseId !== event.sourceCaseId ||
      !id(response.shipmentId)
    )
      throw new BadGatewayException('寄出事件尚未完成來源套用');
    return { shipmentId: response.shipmentId };
  } else if (payload.schema === REPAIR_PROPOSAL_SCHEMA) {
    if (payload.kind === EXCHANGE_READY_KIND) {
      const event = validateExchangeReadyEvent(payload);
      if (
        response.sourceCaseId !== event.sourceCaseId ||
        response.acceptedReadyHash !== event.replacementRelease.readyHash
      )
        throw new BadGatewayException('換貨準備回執或內容雜湊不符');
      return null;
    }
    if (
      payload.kind !== 'REPAIR_PROPOSAL' ||
      typeof payload.eventId !== 'string' ||
      !uuid.test(payload.eventId) ||
      !id(payload.sourceCaseId) ||
      !object(payload.proposal) ||
      typeof payload.proposal.proposalHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(payload.proposal.proposalHash) ||
      response.acceptedProposalHash !== payload.proposal.proposalHash
    )
      throw new BadGatewayException('維修提案回執或內容雜湊不符');
  } else if (payload.schema !== 'corely.mailroom.v1') {
    throw new BadGatewayException('收發事件契約不符');
  }
  return null;
}
