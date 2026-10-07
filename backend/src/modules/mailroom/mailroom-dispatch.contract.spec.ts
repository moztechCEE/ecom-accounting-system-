/* Runtime-boundary fixtures deliberately include malformed external proof. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  type Actor,
  type Command,
  type ItemState,
  transition,
} from './mailroom.contract';
import {
  dispatchedPhysicalItem,
  dispatchedLocation,
  dispatchTransition,
  outboundShipment,
} from './mailroom-dispatch.contract';
import { physicalCustody } from './repair-workflow.contract';

const actor: Actor = {
  id: 'clerk',
  name: '收發同仁',
  entityIds: ['company'],
  permissions: new Set(['mailroom:read', 'mailroom:update']),
};
const item = (): ItemState => ({
  id: 'repair-piece',
  entityId: 'company',
  status: 'READY_FOR_DISPATCH',
  version: 7,
  productName: '原件',
  sku: 'ORIGINAL-SKU',
  serialNumber: 'ORIGINAL-SN',
  location: '寄回區',
  custodianId: 'clerk',
  recipientId: null,
  nextUserId: null,
  repairOwnerId: 'tech',
  matchResult: 'MATCH',
  grade: null,
  disposition: null,
  repairWorkflow: { schema: 1, release: { purpose: 'REPAIRED' } },
  receipt: {
    entityId: 'company',
    category: 'REPAIR',
    sourceCaseId: 'source-case',
    receivedById: 'clerk',
  },
});
const command = (): Command => ({
  entityId: 'company',
  requestId: 'dispatch-0001',
  expectedVersion: 7,
  action: 'dispatch',
  confirmedItems: true,
  carrier: ' 示範物流 ',
  trackingNumber: ' OUT-001 ',
});

function replacement() {
  const row = item();
  row.repairWorkflow = {
    schema: 1,
    release: {
      purpose: 'REPLACED',
      inspectionRevision: 3,
      stock: {
        reservationId: 'reserve',
        postingId: 'formal-out',
        status: 'POSTED',
        quantity: 1,
        entityId: 'company',
        itemId: row.id,
        unitLabel: 'replacement-unit',
        replacementSN: 'NEW-SN',
      },
    },
  };
  const report = {
    status: 'SUBMITTED',
    inspectionRevision: 3,
    data: {
      outcome: 'REPLACED',
      qcResult: 'PASS',
      replacementCondition: 'NEW',
      replacementSku: 'NEW-SKU',
      replacementSerial: 'NEW-SN',
    },
  };
  const posted = {
    id: 'reserve',
    entityId: 'company',
    itemId: row.id,
    unitId: 'unit',
    status: 'POSTED',
    outTransactionId: 'formal-out',
    externalStatus: 'CONFIRMED',
    unit: {
      id: 'unit',
      entityId: 'company',
      productId: 'new-product',
      warehouseId: 'warehouse',
      unitLabel: 'replacement-unit',
      serialNumber: 'NEW-SN',
      status: 'CONSUMED',
      kind: 'NEW',
    },
    outTransaction: {
      id: 'formal-out',
      entityId: 'company',
      productId: 'new-product',
      warehouseId: 'warehouse',
      direction: 'OUT',
      quantity: '1',
      referenceType: 'AFTER_SALES_REPLACEMENT',
      referenceId: 'reserve',
    },
  };
  const product = {
    id: 'new-product',
    entityId: 'company',
    name: '替換實物名稱',
    sku: 'NEW-SKU',
  };
  return { row: { ...row, repairReport: report }, posted, product };
}

describe('customer return dispatch contract', () => {
  it('records carrier handoff without claiming customer delivery or case completion', () => {
    expect(transition(item(), command(), actor).changes).toEqual({
      status: 'DISPATCHED',
      nextUserId: null,
    });
    expect(physicalCustody({ ...item(), status: 'DISPATCHED' })).toBe(
      'CUSTOMER_CARRIER',
    );
  });
  it('allows one person with both capabilities to dispatch after completing their mailroom return acceptance', () => {
    const row = { ...item(), repairOwnerId: 'clerk' };
    expect(physicalCustody(row)).toBe('MAILROOM');
    expect(dispatchTransition(row, command(), actor).status).toBe('DISPATCHED');
  });
  it.each(['RETURN', 'LETTER', 'PARCEL', 'UNMATCHED'])(
    'rejects category %s',
    (category) => {
      const row = item();
      row.receipt.category = category;
      expect(() => dispatchTransition(row, command(), actor)).toThrow(
        ConflictException,
      );
    },
  );
  it.each([
    'REPAIRING',
    'WAITING_RETURN_ACCEPTANCE',
    'FACTORY_OUTBOUND',
    'FACTORY_RECEIVED',
    'FACTORY_RETURNING',
    'STOCKED',
    'DISPATCHED',
  ])('rejects state %s', (status) => {
    expect(() =>
      dispatchTransition({ ...item(), status }, command(), actor),
    ).toThrow(ConflictException);
  });
  it.each(['CANCELLED', 'CLOSED', 'COMPLETED'])(
    'rejects visible source terminal status %s',
    (status) => {
      const row = item();
      row.receipt.sourceSnapshot = { status };
      expect(() => dispatchTransition(row, command(), actor)).toThrow(
        ConflictException,
      );
    },
  );
  it.each(['DELETED', 'NOT_FOUND'])(
    'rejects unavailable source %s',
    (availability) => {
      const row = item();
      row.receipt.sourceSnapshot = { sourceSync: { availability } };
      expect(() => dispatchTransition(row, command(), actor)).toThrow(
        ConflictException,
      );
    },
  );
  it('rejects foreign company, receipt scope, wrong custodian, absent permission, stale version and missing confirmation', () => {
    expect(() =>
      dispatchTransition(item(), command(), {
        ...actor,
        entityIds: ['foreign'],
      }),
    ).toThrow(ForbiddenException);
    const foreignReceipt = item();
    foreignReceipt.receipt.entityId = 'foreign';
    expect(() => dispatchTransition(foreignReceipt, command(), actor)).toThrow(
      ConflictException,
    );
    expect(() =>
      dispatchTransition({ ...item(), custodianId: 'other' }, command(), actor),
    ).toThrow(ForbiddenException);
    expect(() =>
      dispatchTransition(item(), command(), {
        ...actor,
        permissions: new Set(['mailroom:read']),
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      dispatchTransition(item(), { ...command(), expectedVersion: 6 }, actor),
    ).toThrow(ConflictException);
    expect(() =>
      dispatchTransition(
        item(),
        { ...command(), confirmedItems: false },
        actor,
      ),
    ).toThrow(BadRequestException);
  });
  it.each(['FACTORY', 'FACTORY_CARRIER'])(
    'does not override inconsistent factory custody %s with READY_FOR_DISPATCH',
    (custody) => {
      const row = item();
      row.repairWorkflow = { schema: 1, factory: { physicalCustody: custody } };
      expect(() => dispatchTransition(row, command(), actor)).toThrow(
        ForbiddenException,
      );
    },
  );
  it.each(['carrier', 'trackingNumber'] as const)(
    'requires a trimmed nonempty bounded %s',
    (key) => {
      expect(() =>
        dispatchTransition(item(), { ...command(), [key]: '   ' }, actor),
      ).toThrow(BadRequestException);
      expect(() =>
        dispatchTransition(
          item(),
          { ...command(), [key]: 'x'.repeat(101) },
          actor,
        ),
      ).toThrow(BadRequestException);
    },
  );
  it('refuses client timestamp, item edits and a second shipment; dispatched item cannot be moved', () => {
    expect(() =>
      dispatchTransition(
        item(),
        { ...command(), dispatchedAt: 'forged' } as Command,
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      dispatchTransition(item(), { ...command(), sku: 'altered' }, actor),
    ).toThrow(BadRequestException);
    const row = item();
    row.repairWorkflow = { schema: 1, outboundShipment: {} };
    expect(() => dispatchTransition(row, command(), actor)).toThrow(
      ConflictException,
    );
    expect(() =>
      transition(
        { ...item(), status: 'DISPATCHED' },
        { ...command(), action: 'move', location: 'fake', note: 'fake' },
        actor,
      ),
    ).toThrow(ConflictException);
  });
  it('keeps the original-unit identity when no replacement was posted', () => {
    expect(dispatchedPhysicalItem(item())).toEqual({
      kind: 'ORIGINAL',
      productName: '原件',
      sku: 'ORIGINAL-SKU',
      serialNumber: 'ORIGINAL-SN',
      quantity: 1,
    });
  });
  it('does not present a historical clerk shelf as current location for a legacy dispatched item', () => {
    expect(dispatchedLocation({ ...item(), status: 'DISPATCHED' })).toBe(
      '顧客寄回物流（資料待核對）',
    );
    expect(dispatchedLocation(item())).toBe('寄回區');
  });
  it('snapshots the actual replacement product and the proven formal OUT instead of the old original', () => {
    const { row, posted, product } = replacement();
    expect(dispatchedPhysicalItem(row, posted, product)).toMatchObject({
      kind: 'REPLACEMENT',
      productName: '替換實物名稱',
      sku: 'NEW-SKU',
      serialNumber: 'NEW-SN',
      quantity: 1,
      stock: {
        reservationId: 'reserve',
        postingId: 'formal-out',
        unitId: 'unit',
        condition: 'NEW',
      },
    });
  });
  it.each([
    'reserved',
    'wrong-item',
    'wrong-company',
    'wrong-sku',
    'wrong-sn',
    'wrong-quantity',
    'wrong-reference',
    'failed-qc',
    'stale-report',
  ])('blocks replacement proof %s', (problem) => {
    const { row, posted, product } = replacement();
    if (problem === 'reserved') posted.status = 'RESERVED';
    if (problem === 'wrong-item') posted.itemId = 'other';
    if (problem === 'wrong-company') posted.unit.entityId = 'other';
    if (problem === 'wrong-sku') product.sku = 'other';
    if (problem === 'wrong-sn') posted.unit.serialNumber = 'other';
    if (problem === 'wrong-quantity') posted.outTransaction.quantity = '2';
    if (problem === 'wrong-reference')
      posted.outTransaction.referenceId = 'other';
    if (problem === 'failed-qc') row.repairReport.data.qcResult = 'FAIL';
    if (problem === 'stale-report') row.repairReport.inspectionRevision = 2;
    expect(() => dispatchedPhysicalItem(row, posted, product)).toThrow(
      ConflictException,
    );
  });
  it('blocks absent replacement OUT and malformed shipment reads', () => {
    expect(() => dispatchedPhysicalItem(replacement().row)).toThrow(
      ConflictException,
    );
    expect(outboundShipment({ schema: 1 })).toBeNull();
    expect(() => outboundShipment({ schema: 1, outboundShipment: {} })).toThrow(
      ConflictException,
    );
  });
});
