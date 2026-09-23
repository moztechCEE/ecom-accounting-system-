import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  WmsHandoverService,
  validateHandoverEvidence,
} from './wms-handover.service';
const d = (x: number) => new Prisma.Decimal(x);
export function eventFixture(): any {
  return {
    contractVersion: 'corely.wms.handover.v1',
    eventId: randomUUID(),
    entityId: 'e',
    warehouseId: 'w',
    salesOrderId: 'order',
    nativeIntakeId: 1,
    wmsOrderId: 2,
    shipmentId: randomUUID(),
    sourceHash: 'a'.repeat(64),
    occurredAt: new Date().toISOString(),
    handover: {
      method: 'carrier_collection',
      carrier: 'QA',
      manifestId: 'M1',
      operatorId: '5',
    },
    lines: [
      {
        shipmentLineId: randomUUID(),
        salesOrderLineId: 'source1',
        productId: 'p',
        sku: 'SKU',
        quantity: 60,
        packages: [{ packageId: 'BOX1', quantity: 60 }],
      },
    ],
  };
}
function fixture() {
  const event = eventFixture();
  const product = {
    id: 'p',
    entityId: 'e',
    sku: 'SKU',
    name: 'Product',
    isActive: true,
    type: 'SIMPLE',
    hasSerialNumbers: false,
    movingAverageCost: d(12.25),
  };
  const order = {
    id: 'order',
    status: 'pending',
    items: [{ id: 'source1', productId: 'p', qty: d(100), product }],
  };
  const intent = {
    status: 'acknowledged',
    payload: {
      sourceHash: event.sourceHash,
      reservationReference: { salesOrderId: 'order', warehouseId: 'w' },
      items: [{ id: 'source1', productId: 'p', sku: 'SKU', quantity: 100 }],
    },
    response: { nativeIntakeId: 1, wmsOrderId: 2, reservationAccepted: true },
  };
  const inbox = {
    id: 'inbox',
    salesOrderId: 'order',
    warehouseId: 'w',
    eventId: event.eventId,
    payload: event,
  };
  const line: any = {
    id: 'line',
    entityId: 'e',
    shipmentId: 'shipment',
    salesOrderLineId: 'source1',
    productId: 'p',
    quantity: d(60),
    inbox,
    salesOrderLine: order.items[0],
    posting: null,
  };
  const stock = {
    id: 'stock',
    qtyOnHand: d(150),
    qtyAllocated: d(100),
    qtyAvailable: d(50),
  };
  const movements = [{ direction: 'RESERVE', quantity: d(100) }];
  const db: any = {
    $queryRaw: jest.fn(async (sql: TemplateStringsArray) =>
      sql.join('').includes('wms_dispatch_intents')
        ? [intent]
        : [{ id: 'locked' }],
    ),
    salesOrder: {
      findFirst: jest.fn(async () => order),
      update: jest.fn(async ({ data }) => {
        order.status = data.status;
        return order;
      }),
    },
    warehouse: { findFirst: jest.fn(async () => ({ id: 'w' })) },
    product: { findFirstOrThrow: jest.fn(async () => product) },
    inventoryTransaction: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () =>
        movements.filter((m) => ['RESERVE', 'RELEASE'].includes(m.direction)),
      ),
      create: jest.fn(async ({ data }) => {
        movements.push(data);
        return { id: randomUUID(), ...data };
      }),
    },
    inventorySnapshot: {
      findUniqueOrThrow: jest.fn(async () => stock),
      updateMany: jest.fn(async ({ data }) => {
        stock.qtyOnHand = stock.qtyOnHand.sub(data.qtyOnHand.decrement);
        stock.qtyAllocated = stock.qtyAllocated.sub(
          data.qtyAllocated.decrement,
        );
        return { count: 1 };
      }),
    },
    wmsHandoverInbox: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({ id: 'inbox', ...data })),
    },
    shipment: {
      create: jest.fn(async () => ({ id: 'shipment' })),
      update: jest.fn(async () => ({})),
    },
    shipmentLine: {
      aggregate: jest.fn(async () => ({ _sum: { quantity: d(0) } })),
      findFirst: jest.fn(async () => line),
      findUniqueOrThrow: jest.fn(async () => line),
      findMany: jest.fn(async () => [line]),
      count: jest.fn(async () => 0),
    },
    wmsShipmentPosting: {
      create: jest.fn(async ({ data }) => {
        line.posting = { id: 'receipt', ...data };
        return line.posting;
      }),
    },
  };
  db.$transaction = jest.fn(async (fn) => fn(db));
  return {
    db,
    service: new WmsHandoverService(db),
    event,
    order,
    intent,
    inbox,
    line,
    stock,
    product,
    movements,
  };
}

describe('WMS handover receipt and inventory posting', () => {
  const previous = process.env.WMS_HANDOVER_ENABLED;
  beforeEach(() => {
    process.env.WMS_HANDOVER_ENABLED = 'true';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.WMS_HANDOVER_ENABLED;
    else process.env.WMS_HANDOVER_ENABLED = previous;
  });
  it('keeps read and write entrypoints closed until the explicit feature flag is enabled', async () => {
    const f = fixture();
    process.env.WMS_HANDOVER_ENABLED = 'false';
    await expect(f.service.list('e')).rejects.toThrow('DISABLED');
    await expect(f.service.detail('e', 'id')).rejects.toThrow('DISABLED');
    await expect(f.service.receive(f.event, 'hash')).rejects.toThrow(
      'DISABLED',
    );
    await expect(f.service.post('e', 'line', 'staff')).rejects.toThrow(
      'DISABLED',
    );
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('accepts durable evidence without writing inventory or changing order status', async () => {
    const f = fixture();
    expect(await f.service.receive(f.event, 'b'.repeat(64))).toEqual({
      accepted: true,
      eventId: f.event.eventId,
      inboxId: 'inbox',
      duplicate: false,
    });
    expect(f.db.shipment.create.mock.calls[0][0].data.status).toBe(
      'pending_review',
    );
    expect(f.db.inventorySnapshot.updateMany).not.toHaveBeenCalled();
    expect(f.db.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(f.db.salesOrder.update).not.toHaveBeenCalled();
  });
  it('acknowledges identical replay even after the order is shipped', async () => {
    const f = fixture();
    f.order.status = 'shipped';
    f.db.wmsHandoverInbox.findUnique.mockResolvedValue({
      id: 'existing',
      bodyHash: 'hash',
    });
    expect((await f.service.receive(f.event, 'hash')).duplicate).toBe(true);
    expect(f.db.shipment.create).not.toHaveBeenCalled();
    await expect(f.service.receive(f.event, 'changed')).rejects.toThrow(
      '不同交運內容',
    );
  });
  it.each(['sourceHash', 'warehouseId', 'nativeIntakeId', 'wmsOrderId'])(
    'rejects a mismatched immutable %s',
    async (field) => {
      const f = fixture();
      (f.event as any)[field] =
        field.endsWith('Id') && ['nativeIntakeId', 'wmsOrderId'].includes(field)
          ? 8
          : 'other';
      await expect(f.service.receive(f.event, 'hash')).rejects.toThrow(
        '原 WMS 拋單不符',
      );
      expect(f.db.shipment.create).not.toHaveBeenCalled();
    },
  );
  it('rejects cross-company source products and historical whole-order ledger postings', async () => {
    const f = fixture();
    f.product.entityId = 'other';
    await expect(f.service.receive(f.event, 'hash')).rejects.toThrow(
      '商品已異動',
    );
    f.product.entityId = 'e';
    f.db.inventoryTransaction.count.mockResolvedValue(1);
    await expect(f.service.receive(f.event, 'hash')).rejects.toThrow(
      '切換對照',
    );
  });
  it('limits accepted quantity by the actual source line, including same SKU on another line', async () => {
    const f = fixture();
    f.order.items.push({ ...f.order.items[0], id: 'source2', qty: d(200) });
    f.intent.payload.items.push({
      ...f.intent.payload.items[0],
      id: 'source2',
      quantity: 200,
    });
    f.db.shipmentLine.aggregate.mockResolvedValue({
      _sum: { quantity: d(50) },
    });
    await expect(f.service.receive(f.event, 'hash')).rejects.toThrow(
      '超過此銷貨訂單行',
    );
    expect(f.db.shipmentLine.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityId: 'e', salesOrderLineId: 'source1' },
      }),
    );
  });
  it('posts 60 then 40 exactly once, freezes each current cost, and only then marks shipped', async () => {
    const f = fixture();
    const first = await f.service.post('e', 'line', 'staff');
    expect(first).toMatchObject({
      alreadyPosted: false,
      unitCostBase: '12.25',
      totalCostBase: '735',
    });
    expect(f.stock.qtyOnHand.toNumber()).toBe(90);
    expect(f.stock.qtyAllocated.toNumber()).toBe(40);
    expect(f.stock.qtyAvailable.toNumber()).toBe(50);
    expect(f.order.status).toBe('partially_shipped');
    expect(f.movements.map((m) => m.direction)).toEqual([
      'RESERVE',
      'RELEASE',
      'OUT',
    ]);
    expect(
      f.db.inventoryTransaction.create.mock.calls[0][0].data,
    ).toMatchObject({ referenceType: 'SALES_ORDER', referenceId: 'order' });
    expect(
      f.db.inventoryTransaction.create.mock.calls[1][0].data,
    ).toMatchObject({
      referenceType: 'WMS_SHIPMENT_LINE',
      referenceId: 'line',
    });
    expect((await f.service.post('e', 'line', 'staff')).alreadyPosted).toBe(
      true,
    );
    expect(f.db.inventoryTransaction.create).toHaveBeenCalledTimes(2);
    const second = { ...f.line, id: 'line2', quantity: d(40), posting: null };
    f.db.shipmentLine.findFirst.mockResolvedValue(second);
    f.db.shipmentLine.findUniqueOrThrow.mockResolvedValue(second);
    f.db.shipmentLine.findMany.mockResolvedValue([f.line, second]);
    f.product.movingAverageCost = d(15);
    f.db.wmsShipmentPosting.create.mockImplementation(async ({ data }) => {
      second.posting = data;
      return data;
    });
    expect(await f.service.post('e', 'line2', 'staff')).toMatchObject({
      totalCostBase: '600',
    });
    expect(f.stock.qtyOnHand.toNumber()).toBe(50);
    expect(f.stock.qtyAllocated.toNumber()).toBe(0);
    expect(f.stock.qtyAvailable.toNumber()).toBe(50);
    expect(f.order.status).toBe('shipped');
    expect(first.totalCostBase).toBe('735');
  });
  it.each(['reservation', 'onHand', 'allocated', 'inconsistent'])(
    'blocks posting with %s stock failure before ledger writes',
    async (kind) => {
      const f = fixture();
      if (kind === 'reservation') f.movements[0].quantity = d(20);
      if (kind === 'onHand') f.stock.qtyOnHand = d(20);
      if (kind === 'allocated') f.stock.qtyAllocated = d(20);
      if (kind === 'inconsistent') f.stock.qtyAvailable = d(5);
      await expect(f.service.post('e', 'line', 'staff')).rejects.toThrow(
        '庫存',
      );
      expect(f.db.inventoryTransaction.create).not.toHaveBeenCalled();
      expect(f.db.wmsShipmentPosting.create).not.toHaveBeenCalled();
    },
  );
  it('rejects an ambiguous partial release instead of consuming another same-SKU line allocation', async () => {
    const f = fixture();
    f.movements.push({ direction: 'RELEASE', quantity: d(20) });
    // 80 still exceeds this 60-unit line, but the order's remaining hold must be 100.
    await expect(f.service.post('e', 'line', 'staff')).rejects.toThrow('庫存');
    expect(f.db.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  it('checks company before any locks or writes', async () => {
    const f = fixture();
    f.db.shipmentLine.findFirst.mockResolvedValue(null);
    await expect(f.service.post('other', 'line', 'staff')).rejects.toThrow(
      '此公司的',
    );
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });
  it('does not let an empty final shipment prematurely close an order with another source line', async () => {
    const f = fixture();
    f.order.items.push({ ...f.order.items[0], id: 'source2', qty: d(10) });
    f.intent.payload.items.push({
      ...f.intent.payload.items[0],
      id: 'source2',
      quantity: 10,
    });
    f.line.quantity = d(100);
    f.movements[0].quantity = d(110);
    f.stock.qtyAllocated = d(110);
    f.stock.qtyAvailable = d(40);
    await f.service.post('e', 'line', 'staff');
    expect(f.order.status).toBe('partially_shipped');
  });
  it('filters by Taiwan business day and rejects impossible dates', async () => {
    const f = fixture();
    f.db.wmsHandoverInbox.findMany = jest.fn(async () => []);
    f.db.wmsHandoverInbox.count = jest.fn(async () => 0);
    await f.service.list('e', 'pending', 2, 20, '2026-09-23', 'PO');
    const q = f.db.wmsHandoverInbox.findMany.mock.calls[0][0];
    expect(q.where.occurredAt.gte.toISOString()).toBe(
      '2026-09-22T16:00:00.000Z',
    );
    expect(q.where.occurredAt.lt.toISOString()).toBe(
      '2026-09-23T16:00:00.000Z',
    );
    expect(q.skip).toBe(20);
    expect(q.where.entityId).toBe('e');
    await expect(
      f.service.list('e', 'pending', 1, 20, '2026-02-31'),
    ).rejects.toThrow('日期無效');
  });
  it('requires carrier evidence, exact package totals, and unique source lines', () => {
    const e = eventFixture();
    delete e.handover.manifestId;
    expect(() => validateHandoverEvidence(e)).toThrow('物流');
    e.handover.method = 'customer_pickup';
    e.lines[0].packages[0].quantity = 1;
    expect(() => validateHandoverEvidence(e)).toThrow('箱明細');
    e.lines[0].packages[0].quantity = 60;
    e.lines.push({ ...e.lines[0], shipmentLineId: randomUUID() });
    expect(() => validateHandoverEvidence(e)).toThrow('重複');
  });
});
