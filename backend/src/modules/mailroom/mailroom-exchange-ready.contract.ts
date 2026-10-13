import { BadGatewayException, ConflictException } from '@nestjs/common';
import {
  fingerprint,
  requireEntity,
  requirePermission,
  type Actor,
} from './mailroom.contract';
import type { OutboundUnit } from './mailroom-outbound.contract';
import type { OutboundStockProof } from './mailroom-outbound-stock.service';
import type { MailroomOutboundOrder as SourceOrder } from './mailroom-workflow-event.contract';

export const EXCHANGE_READY_SCHEMA = 'corely.aftersales.workflow.v1' as const;
export const EXCHANGE_READY_KIND = 'EXCHANGE_READY' as const;
export const EXCHANGE_RELEASE_SCHEMA =
  'corely.mailroom.exchange-ready.v1' as const;

export type ExchangeReadyRelease = {
  schema: typeof EXCHANGE_RELEASE_SCHEMA;
  orderId: string;
  itemId: string;
  sourceCaseItemId: string;
  prepareRequestId: string;
  generation: number;
  readyAt: string;
  productName: string;
  sku: string;
  serialNumber: string | null;
  quantity: 1;
  stock: {
    postingId: string;
    referenceType: 'AFTER_SALES_OUTBOUND';
    referenceId: string;
    productId: string;
    warehouseId: string;
    externalInventoryPosted: false;
  };
  readyHash: string;
};
export type ExchangeReadyEvent = {
  schema: typeof EXCHANGE_READY_SCHEMA;
  kind: typeof EXCHANGE_READY_KIND;
  eventId: string;
  entityId: string;
  sourceCaseId: string;
  sourceNumber: string;
  sourceVersion: string;
  itemId: string;
  receiptId: string;
  version: number;
  occurredAt: string;
  actor: { id: string; name: string };
  replacementRelease: ExchangeReadyRelease;
};
export type ExchangeReadyOrder = {
  id: string;
  entityId: string;
  sourceCaseId: string;
  sourceNumber: string;
  sourceVersion: string;
  caseType: string;
  status: string;
  version: number;
  stockRequestId: string | null;
  preparedById: string | null;
  custodianId: string | null;
};
export type ExchangeReadyProduct = {
  id: string;
  entityId: string;
  name: string;
  sku: string;
  isActive: boolean;
};
export type BuildExchangeReadyInput = {
  eventId: string;
  occurredAt: string;
  actor: Actor;
  source: SourceOrder;
  order: ExchangeReadyOrder;
  unit: OutboundUnit;
  /** Must be returned by stock.verify in the same acceptance transaction. */
  proof: OutboundStockProof;
  /** The same transaction's active catalog row for proof.productId. */
  product: unknown;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const text = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length <= max && !!value.trim();
const nativeId = (value: unknown): value is string =>
  text(value, 36) && uuid.test(value);
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const positiveInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  Number(value) > 0 &&
  Number(value) <= 2147483647;
const iso = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const invalid = () => new BadGatewayException('換貨備妥事件或證明格式不符');

type ReadyHashInput = Pick<
  ExchangeReadyEvent,
  | 'entityId'
  | 'sourceCaseId'
  | 'sourceNumber'
  | 'sourceVersion'
  | 'itemId'
  | 'receiptId'
  | 'version'
  | 'occurredAt'
  | 'replacementRelease'
>;

/** Hash the physical release and source binding; transport event ID and actor are not release identity. */
export function exchangeReadyHash(event: ReadyHashInput): string {
  const replacementRelease: Partial<ExchangeReadyRelease> = {
    ...event.replacementRelease,
  };
  delete replacementRelease.readyHash;
  return fingerprint({
    entityId: event.entityId,
    sourceCaseId: event.sourceCaseId,
    sourceNumber: event.sourceNumber,
    sourceVersion: event.sourceVersion,
    itemId: event.itemId,
    receiptId: event.receiptId,
    version: event.version,
    occurredAt: event.occurredAt,
    replacementRelease,
  });
}

/** Validate an immutable, single-unit event. This does not perform or authorize any stock posting. */
export function validateExchangeReadyEvent(value: unknown): ExchangeReadyEvent {
  if (
    !object(value) ||
    !exact(value, [
      'schema',
      'kind',
      'eventId',
      'entityId',
      'sourceCaseId',
      'sourceNumber',
      'sourceVersion',
      'itemId',
      'receiptId',
      'version',
      'occurredAt',
      'actor',
      'replacementRelease',
    ]) ||
    value.schema !== EXCHANGE_READY_SCHEMA ||
    value.kind !== EXCHANGE_READY_KIND ||
    !nativeId(value.eventId) ||
    !safeId(value.entityId) ||
    !safeId(value.sourceCaseId) ||
    !text(value.sourceNumber) ||
    !iso(value.sourceVersion) ||
    !nativeId(value.itemId) ||
    !nativeId(value.receiptId) ||
    !positiveInt(value.version) ||
    !iso(value.occurredAt) ||
    !object(value.actor) ||
    !exact(value.actor, ['id', 'name']) ||
    !safeId(value.actor.id) ||
    !text(value.actor.name) ||
    !object(value.replacementRelease)
  )
    throw invalid();
  const release = value.replacementRelease;
  if (
    !exact(release, [
      'schema',
      'orderId',
      'itemId',
      'sourceCaseItemId',
      'prepareRequestId',
      'generation',
      'readyAt',
      'productName',
      'sku',
      'serialNumber',
      'quantity',
      'stock',
      'readyHash',
    ]) ||
    release.schema !== EXCHANGE_RELEASE_SCHEMA ||
    !nativeId(release.orderId) ||
    release.orderId !== value.receiptId ||
    !nativeId(release.itemId) ||
    release.itemId !== value.itemId ||
    !safeId(release.sourceCaseItemId) ||
    !nativeId(release.prepareRequestId) ||
    !positiveInt(release.generation) ||
    release.generation !== value.version ||
    !iso(release.readyAt) ||
    release.readyAt !== value.occurredAt ||
    !text(release.productName) ||
    !text(release.sku, 100) ||
    !(release.serialNumber === null || text(release.serialNumber, 100)) ||
    release.quantity !== 1 ||
    !digest(release.readyHash) ||
    !object(release.stock)
  )
    throw invalid();
  const stock = release.stock;
  if (
    !exact(stock, [
      'postingId',
      'referenceType',
      'referenceId',
      'productId',
      'warehouseId',
      'externalInventoryPosted',
    ]) ||
    !safeId(stock.postingId) ||
    stock.referenceType !== 'AFTER_SALES_OUTBOUND' ||
    stock.referenceId !== release.orderId ||
    !safeId(stock.productId) ||
    !safeId(stock.warehouseId) ||
    stock.externalInventoryPosted !== false
  )
    throw invalid();
  const event = value as unknown as ExchangeReadyEvent;
  if (exchangeReadyHash(event) !== release.readyHash) throw invalid();
  return structuredClone(event);
}

/** The caller verifies the complete order first, then builds all units before saving one transaction's outbox. */
export function buildExchangeReadyEvent(
  input: BuildExchangeReadyInput,
): ExchangeReadyEvent {
  const { source, order, unit, proof, product, actor } = input;
  if (!source || !order || !unit || !proof || !actor || !object(product))
    throw new ConflictException('缺少換貨備妥的實物或正式出庫證明');
  requireEntity(actor, order.entityId);
  requirePermission(actor, 'mailroom:update');
  const declared = Array.isArray(source.items)
    ? source.items.find((line) => line?.id === unit.sourceCaseItemId)
    : undefined;
  if (
    source.type !== 'EXCHANGE_RETURN' ||
    order.caseType !== 'EXCHANGE_RETURN' ||
    proof.caseType !== 'EXCHANGE_RETURN' ||
    source.id !== order.sourceCaseId ||
    source.number !== order.sourceNumber ||
    source.version !== order.sourceVersion ||
    source.dispatchAllowed !== true ||
    source.blockReason !== null ||
    order.status !== 'READY_FOR_DISPATCH' ||
    order.custodianId !== actor.id ||
    !safeId(order.preparedById) ||
    !nativeId(order.stockRequestId) ||
    !positiveInt(order.version) ||
    !declared ||
    declared.name !== unit.productName ||
    declared.sku !== unit.sku ||
    !positiveInt(declared.quantity) ||
    !Number.isSafeInteger(declared.dispatchedQuantity) ||
    declared.dispatchedQuantity < 0 ||
    declared.dispatchedQuantity >= declared.quantity ||
    !Array.isArray(declared.dispatchedUnitIds) ||
    declared.dispatchedUnitIds.includes(unit.unitId) ||
    !nativeId(unit.unitId) ||
    unit.quantity !== 1 ||
    proof.quantity !== 1 ||
    proof.schema !== 'corely.mailroom.outbound-stock.v1' ||
    proof.entityId !== order.entityId ||
    proof.orderId !== order.id ||
    proof.sourceCaseId !== order.sourceCaseId ||
    proof.requestId !== order.stockRequestId ||
    proof.actorId !== order.preparedById ||
    !digest(proof.requestHash) ||
    proof.unitId !== unit.unitId ||
    proof.sourceCaseItemId !== unit.sourceCaseItemId ||
    proof.productId !== unit.productId ||
    proof.warehouseId !== unit.warehouseId ||
    proof.sku !== unit.sku ||
    proof.postingId !== unit.postingId ||
    (proof.serialNumber ?? null) !== (unit.serialNumber ?? null) ||
    proof.referenceType !== 'AFTER_SALES_OUTBOUND' ||
    proof.externalInventoryPosted !== false ||
    (unit.referenceType !== undefined &&
      unit.referenceType !== proof.referenceType) ||
    (unit.referenceId !== undefined && unit.referenceId !== order.id) ||
    (unit.externalInventoryPosted !== undefined &&
      unit.externalInventoryPosted !== false) ||
    product.isActive !== true ||
    product.id !== proof.productId ||
    product.entityId !== order.entityId ||
    !text(product.name) ||
    product.sku !== proof.sku
  )
    throw new ConflictException('換貨備妥的案件、實物或正式出庫證明不符');
  const event: ExchangeReadyEvent = {
    schema: EXCHANGE_READY_SCHEMA,
    kind: EXCHANGE_READY_KIND,
    eventId: input.eventId,
    entityId: order.entityId,
    sourceCaseId: order.sourceCaseId,
    sourceNumber: order.sourceNumber,
    sourceVersion: order.sourceVersion,
    itemId: unit.unitId,
    receiptId: order.id,
    version: order.version,
    occurredAt: input.occurredAt,
    actor: { id: actor.id, name: actor.name },
    replacementRelease: {
      schema: EXCHANGE_RELEASE_SCHEMA,
      orderId: order.id,
      itemId: unit.unitId,
      sourceCaseItemId: unit.sourceCaseItemId,
      prepareRequestId: order.stockRequestId,
      generation: order.version,
      readyAt: input.occurredAt,
      productName: product.name,
      sku: proof.sku,
      serialNumber: proof.serialNumber ?? null,
      quantity: 1,
      stock: {
        postingId: proof.postingId,
        referenceType: 'AFTER_SALES_OUTBOUND',
        referenceId: order.id,
        productId: proof.productId,
        warehouseId: proof.warehouseId,
        externalInventoryPosted: false,
      },
      readyHash: '',
    },
  };
  event.replacementRelease.readyHash = exchangeReadyHash(event);
  return validateExchangeReadyEvent(event);
}
