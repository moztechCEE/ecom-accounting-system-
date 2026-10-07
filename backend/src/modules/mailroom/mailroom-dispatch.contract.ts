import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { type Actor, type Command, type ItemState } from './mailroom.contract';
import { physicalCustody } from './repair-workflow.contract';

export type OutboundPhysicalItem = {
  kind: 'ORIGINAL' | 'REPLACEMENT';
  productName: string;
  sku: string | null;
  serialNumber: string | null;
  quantity: 1;
  stock?: {
    reservationId: string;
    postingId: string;
    unitId: string;
    unitLabel: string;
    productId: string;
    warehouseId: string;
    condition: 'NEW' | 'REFURBISHED';
    externalStatus: string;
  };
};
export type OutboundShipment = {
  schema: 1;
  status: 'HANDED_TO_CARRIER';
  entityId: string;
  itemId: string;
  sourceCaseId: string;
  requestId: string;
  fromVersion: number;
  version: number;
  carrier: string;
  trackingNumber: string;
  dispatchedAt: string;
  dispatchedById: string;
  dispatchedByName: string;
  dispatchedByEmployeeId: string;
  note: string | null;
  physicalItem: OutboundPhysicalItem;
  sourceSync: {
    status: 'PENDING_COMPATIBILITY';
    reason: 'DISPATCH_CONSUMER_NOT_CONFIGURED';
  };
};

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();
export function dispatchText(value: unknown, label: string) {
  if (!nonempty(value) || value.length > 100)
    throw new BadRequestException(`請填寫${label}，最多 100 字`);
  return value.trim();
}

/** This immutable logistics branch is exposed separately from technical documents. */
export function outboundShipment(value: unknown): OutboundShipment | null {
  const shipment = object(value).outboundShipment;
  if (shipment === undefined) return null;
  const record = object(shipment);
  const physical = object(record.physicalItem);
  const sync = object(record.sourceSync);
  if (
    record.schema !== 1 ||
    record.status !== 'HANDED_TO_CARRIER' ||
    ![
      record.entityId,
      record.itemId,
      record.sourceCaseId,
      record.requestId,
      record.carrier,
      record.trackingNumber,
      record.dispatchedAt,
      record.dispatchedById,
      record.dispatchedByName,
      record.dispatchedByEmployeeId,
      physical.productName,
    ].every(nonempty) ||
    !Number.isFinite(Date.parse(String(record.dispatchedAt))) ||
    !Number.isSafeInteger(record.fromVersion) ||
    Number(record.fromVersion) < 1 ||
    record.version !== Number(record.fromVersion) + 1 ||
    !['ORIGINAL', 'REPLACEMENT'].includes(String(physical.kind)) ||
    physical.quantity !== 1 ||
    sync.status !== 'PENDING_COMPATIBILITY' ||
    sync.reason !== 'DISPATCH_CONSUMER_NOT_CONFIGURED'
  )
    throw new ConflictException('寄回交物流記錄不完整，請由管理員核對');
  return structuredClone(shipment) as OutboundShipment;
}

/** Keep the native shelf as historical data, never display it as current carrier custody. */
export function dispatchedLocation(item: {
  status: string;
  location: string;
  repairWorkflow?: unknown;
}) {
  if (item.status !== 'DISPATCHED') return item.location;
  const shipment = object(object(item.repairWorkflow).outboundShipment);
  return nonempty(shipment.carrier) && nonempty(shipment.trackingNumber)
    ? `${shipment.carrier.trim()} · ${shipment.trackingNumber.trim()}`
    : '顧客寄回物流（資料待核對）';
}

export function dispatchTransition(
  item: ItemState,
  command: Command,
  actor: Actor,
) {
  if (!actor.permissions.has('*') && !actor.permissions.has('mailroom:update'))
    throw new ForbiddenException('沒有寄回交物流作業權限');
  if (
    command.entityId !== item.entityId ||
    (actor.entityIds !== null && !actor.entityIds.includes(item.entityId))
  )
    throw new ForbiddenException('公司不符');
  if (command.expectedVersion !== item.version)
    throw new ConflictException('資料已更新，請重新整理後操作');
  const source = object(item.receipt.sourceSnapshot);
  const sourceSync = object(source.sourceSync);
  if (
    item.receipt.entityId !== item.entityId ||
    item.receipt.category !== 'REPAIR' ||
    item.status !== 'READY_FOR_DISPATCH' ||
    !item.receipt.sourceCaseId ||
    ['CANCELLED', 'CLOSED', 'COMPLETED'].includes(String(source.status)) ||
    ['DELETED', 'NOT_FOUND'].includes(String(sourceSync.availability)) ||
    object(item.repairWorkflow).outboundShipment !== undefined
  )
    throw new ConflictException('只有已由收發室簽收的待寄回維修件可以交物流');
  if (item.custodianId !== actor.id || physicalCustody(item) !== 'MAILROOM')
    throw new ForbiddenException('只有目前保管實物的收發人員可以交物流');
  if (command.confirmedItems !== true)
    throw new BadRequestException('請確認本次交物流的實際物件');
  const allowed = new Set([
    'entityId',
    'requestId',
    'expectedVersion',
    'action',
    'carrier',
    'trackingNumber',
    'confirmedItems',
    'note',
  ]);
  if (
    Object.entries(command).some(
      ([key, value]) => value !== undefined && !allowed.has(key),
    )
  )
    throw new BadRequestException('交物流不能修改品項、位置、照片或其他流程');
  dispatchText(command.carrier, '寄回物流公司');
  dispatchText(command.trackingNumber, '寄回物流單號');
  return { status: 'DISPATCHED', nextUserId: null };
}

/** Read proven replacement OUT; dispatch does not post inventory a second time. */
export function dispatchedPhysicalItem(
  item: ItemState & { repairReport?: unknown },
  reservation?: unknown,
  product?: unknown,
): OutboundPhysicalItem {
  const workflow = object(item.repairWorkflow);
  const release = object(workflow.release);
  const report = object(item.repairReport);
  const data = object(report.data);
  const replaced =
    release.purpose === 'REPLACED' || data.outcome === 'REPLACED';
  if (!replaced) {
    if (release.stock !== undefined)
      throw new ConflictException('寄回原件與換機出庫記錄不一致，請重新核對');
    return {
      kind: 'ORIGINAL',
      productName: item.productName,
      sku: item.sku,
      serialNumber: item.serialNumber,
      quantity: 1,
    };
  }
  const proof = object(release.stock);
  const posted = object(reservation);
  const unit = object(posted.unit);
  const out = object(posted.outTransaction);
  const actual = object(product);
  const serial = nonempty(data.replacementSerial)
    ? data.replacementSerial.trim()
    : null;
  if (
    release.purpose !== 'REPLACED' ||
    report.status !== 'SUBMITTED' ||
    data.outcome !== 'REPLACED' ||
    data.qcResult !== 'PASS' ||
    report.inspectionRevision !== release.inspectionRevision ||
    !['NEW', 'REFURBISHED'].includes(String(data.replacementCondition)) ||
    !nonempty(data.replacementSku) ||
    !nonempty(proof.reservationId) ||
    !nonempty(proof.postingId) ||
    proof.status !== 'POSTED' ||
    proof.quantity !== 1 ||
    proof.entityId !== item.entityId ||
    proof.itemId !== item.id ||
    posted.id !== proof.reservationId ||
    posted.entityId !== item.entityId ||
    posted.itemId !== item.id ||
    posted.status !== 'POSTED' ||
    posted.outTransactionId !== proof.postingId ||
    !nonempty(unit.id) ||
    posted.unitId !== unit.id ||
    unit.entityId !== item.entityId ||
    unit.status !== 'CONSUMED' ||
    unit.kind !== data.replacementCondition ||
    !nonempty(unit.unitLabel) ||
    unit.unitLabel !== proof.unitLabel ||
    (unit.serialNumber || null) !== serial ||
    (proof.replacementSN || null) !== serial ||
    (item.serialNumber && serial === item.serialNumber.trim()) ||
    actual.id !== unit.productId ||
    actual.entityId !== item.entityId ||
    !nonempty(actual.name) ||
    actual.sku !== data.replacementSku.trim() ||
    out.id !== proof.postingId ||
    out.entityId !== item.entityId ||
    out.productId !== unit.productId ||
    out.warehouseId !== unit.warehouseId ||
    out.direction !== 'OUT' ||
    String(out.quantity) !== '1' ||
    out.referenceType !== 'AFTER_SALES_REPLACEMENT' ||
    out.referenceId !== posted.id
  )
    throw new ConflictException(
      '換機實物、維修單或正式出庫證明不符，不能交物流',
    );
  return {
    kind: 'REPLACEMENT',
    productName: actual.name,
    sku: actual.sku,
    serialNumber: serial,
    quantity: 1,
    stock: {
      reservationId: posted.id,
      postingId: out.id,
      unitId: unit.id,
      unitLabel: unit.unitLabel,
      productId: unit.productId as string,
      warehouseId: unit.warehouseId as string,
      condition: unit.kind as 'NEW' | 'REFURBISHED',
      externalStatus: posted.externalStatus as string,
    },
  };
}
