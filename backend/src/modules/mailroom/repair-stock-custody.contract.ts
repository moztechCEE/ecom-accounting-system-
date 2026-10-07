/** A native RETURN keeps its immutable IN handoff. Once that unit has a proven
 * replacement OUT, current custody belongs to the linked REPAIR item. */
import { dispatchedLocation } from './mailroom-dispatch.contract';
export type LinkedReplacementCustody = {
  unitId: string;
  reservationId: string;
  outTransactionId: string;
  itemId: string;
  sourceCaseId: string | null;
  sourceNumber: string | null;
  status: string;
  statusLabel: string;
  custodianId: string;
  custodianName: string;
  location: string;
  physicalCustody:
    | 'TECHNICIAN'
    | 'MAILROOM'
    | 'FACTORY_CARRIER'
    | 'FACTORY'
    | 'CUSTOMER_CARRIER';
  targetVersion: number;
};
export type StockCustodyProjection = {
  physicalCustody: 'LINKED_CASE' | 'UNKNOWN';
  statusLabel: string;
  linkedReplacementCustody?: LinkedReplacementCustody;
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();
const uncertain = (): StockCustodyProjection => ({
  physicalCustody: 'UNKNOWN',
  statusLabel: '退貨品出庫關聯待核對',
});

export function consumedReturnCustody(
  value: unknown,
  relatedUnits: unknown[],
): StockCustodyProjection | undefined {
  const item = object(value),
    receipt = object(item.receipt);
  if (item.status !== 'STOCKED' || receipt.category !== 'RETURN') return;
  const consumed = relatedUnits
    .map(object)
    .filter(
      (unit) => unit.sourceItemId === item.id && unit.status === 'CONSUMED',
    );
  if (!consumed.length) return;
  if (consumed.length !== 1) return uncertain();
  const unit = consumed[0];
  const qualification = object(unit.qualification);
  const inbound = object(qualification.inbound);
  const original = object(object(item.repairWorkflow).inventoryReceipt);
  const reservations = Array.isArray(unit.reservations)
    ? unit.reservations
    : [];
  if (
    !text(item.id) ||
    !text(item.entityId) ||
    !text(receipt.sourceCaseId) ||
    !text(object(item.declared).id) ||
    unit.entityId !== item.entityId ||
    !text(unit.id) ||
    !text(unit.productId) ||
    !text(unit.warehouseId) ||
    unit.kind !== 'REFURBISHED' ||
    unit.serialNumber !== item.serialNumber ||
    qualification.sku !== item.sku ||
    inbound.unitId !== unit.id ||
    original.unitId !== unit.id ||
    !text(inbound.inTransactionId) ||
    inbound.inTransactionId !== original.inTransactionId ||
    inbound.sourceItemId !== item.id ||
    original.sourceItemId !== item.id ||
    inbound.sourceCaseId !== receipt.sourceCaseId ||
    original.sourceCaseId !== receipt.sourceCaseId ||
    inbound.sourceCaseItemId !== object(item.declared).id ||
    original.sourceCaseItemId !== object(item.declared).id ||
    inbound.quantity !== 1 ||
    original.quantity !== 1 ||
    reservations.length !== 1
  )
    return uncertain();
  const reservation = object(reservations[0]),
    out = object(reservation.outTransaction);
  const target = object(reservation.item),
    targetReceipt = object(target.receipt);
  if (
    reservation.entityId !== item.entityId ||
    reservation.unitId !== unit.id ||
    reservation.status !== 'POSTED' ||
    !text(reservation.id) ||
    !text(reservation.outTransactionId) ||
    out.id !== reservation.outTransactionId ||
    out.entityId !== item.entityId ||
    out.productId !== unit.productId ||
    out.warehouseId !== unit.warehouseId ||
    out.direction !== 'OUT' ||
    String(out.quantity) !== '1' ||
    out.referenceType !== 'AFTER_SALES_REPLACEMENT' ||
    out.referenceId !== reservation.id ||
    target.id !== reservation.itemId ||
    !text(target.id) ||
    !text(reservation.itemId) ||
    target.id === item.id ||
    target.entityId !== item.entityId ||
    targetReceipt.entityId !== item.entityId ||
    targetReceipt.category !== 'REPAIR' ||
    target.sku !== item.sku ||
    !text(target.custodianId) ||
    !text(target.location) ||
    !text(target.status) ||
    !Number.isInteger(target.version) ||
    Number(target.version) < 1
  )
    return uncertain();
  const factoryCustody = object(
    object(target.repairWorkflow).factory,
  ).physicalCustody;
  const physicalCustody =
    target.status === 'FACTORY_RECEIVED' || factoryCustody === 'FACTORY'
      ? 'FACTORY'
      : ['FACTORY_OUTBOUND', 'FACTORY_RETURNING'].includes(
            String(target.status),
          ) || factoryCustody === 'FACTORY_CARRIER'
        ? 'FACTORY_CARRIER'
        : target.status === 'DISPATCHED'
          ? 'CUSTOMER_CARRIER'
          : target.status === 'READY_FOR_DISPATCH'
            ? 'MAILROOM'
            : target.custodianId === target.repairOwnerId
              ? 'TECHNICIAN'
              : 'MAILROOM';
  return {
    physicalCustody: 'LINKED_CASE',
    statusLabel: '已作換機出庫，實物保管依換機案件',
    linkedReplacementCustody: {
      unitId: unit.id,
      reservationId: reservation.id,
      outTransactionId: reservation.outTransactionId,
      itemId: target.id,
      sourceCaseId:
        typeof targetReceipt.sourceCaseId === 'string'
          ? targetReceipt.sourceCaseId
          : null,
      sourceNumber:
        typeof targetReceipt.sourceNumber === 'string'
          ? targetReceipt.sourceNumber
          : null,
      status: target.status,
      // The caller formats the existing status label; no customer or technical document is exposed.
      statusLabel: target.status,
      custodianId: target.custodianId,
      custodianName: '未綁定',
      location: dispatchedLocation({
        status: target.status,
        location: target.location,
        repairWorkflow: target.repairWorkflow,
      }),
      physicalCustody,
      targetVersion: Number(target.version),
    },
  };
}
