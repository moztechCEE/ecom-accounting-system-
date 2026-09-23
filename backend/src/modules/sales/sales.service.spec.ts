import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import { SalesService } from './sales.service';

describe('SalesService.fulfillSalesOrder', () => {
  const tx = {
    $queryRaw: jest.fn(),
    salesOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    inventoryTransaction: { count: jest.fn() },
    warehouse: { findFirst: jest.fn() },
    shipment: { create: jest.fn() },
    billOfMaterial: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const inventory = {
    markSerialNumbersAsSold: jest.fn(),
    shipStock: jest.fn(),
  };
  let service: SalesService;

  const order = {
    id: 'order-1',
    entityId: 'entity-1',
    channelId: 'channel-1',
    externalOrderId: 'LEGACY-1',
    sourceOrderKey: 'channel-1:LEGACY-1',
    b2bRequest: null,
    wmsHandoverInbox: [],
    status: 'paid',
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        qty: 1,
        product: {
          id: 'product-1',
          entityId: 'entity-1',
          sku: 'SKU-1',
          type: ProductType.SIMPLE,
          hasSerialNumbers: true,
        },
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SalesService(prisma as any, inventory as any);
    tx.salesOrder.findFirst.mockResolvedValue(order);
    tx.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.inventoryTransaction.count.mockResolvedValue(0);
    tx.$queryRaw.mockResolvedValue([]);
    tx.warehouse.findFirst.mockResolvedValue({ id: 'warehouse-1', code: 'MAIN' });
    tx.shipment.create.mockResolvedValue({ id: 'shipment-1' });
    tx.salesOrder.update.mockResolvedValue({ ...order, status: 'shipped' });
  });

  it('ships serials, stock, shipment and order status atomically', async () => {
    const result = await service.fulfillSalesOrder({
      entityId: 'entity-1',
      warehouseId: 'warehouse-1',
      salesOrderId: 'order-1',
      itemSerialNumbers: { 'item-1': ['SN-1'] },
    });

    expect(result).toEqual({ success: true, alreadyFulfilled: false, status: 'shipped' });
    expect(inventory.markSerialNumbersAsSold).toHaveBeenCalledWith(
      expect.objectContaining({ serialNumbers: ['SN-1'], outboundRefId: 'order-1' }),
      tx,
    );
    expect(inventory.shipStock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'entity-1',
        warehouseId: 'warehouse-1',
        productId: 'product-1',
        quantity: 1,
        referenceId: 'order-1',
      }),
      tx,
    );
    expect(tx.shipment.create).toHaveBeenCalled();
    expect(tx.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'shipped' } }),
    );
  });

  it('does not deduct inventory again for an already shipped order', async () => {
    tx.salesOrder.findFirst.mockResolvedValue({ ...order, status: 'shipped' });

    const result = await service.fulfillSalesOrder({
      entityId: 'entity-1',
      warehouseId: 'warehouse-1',
      salesOrderId: 'order-1',
    });

    expect(result).toEqual({ success: true, alreadyFulfilled: true, status: 'shipped' });
    expect(inventory.shipStock).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('blocks legacy partial inventory movements instead of double-deducting', async () => {
    tx.inventoryTransaction.count.mockResolvedValue(1);

    await expect(
      service.fulfillSalesOrder({
        entityId: 'entity-1',
        warehouseId: 'warehouse-1',
        salesOrderId: 'order-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(inventory.shipStock).not.toHaveBeenCalled();
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('blocks whole-order deduction after WMS dispatch, pending or acknowledged', async () => {
    for (const status of ['prepared', 'unknown', 'acknowledged']) {
      tx.$queryRaw.mockResolvedValueOnce([{ id: order.id }]).mockResolvedValueOnce([{ status }]);
      await expect(
        service.fulfillSalesOrder({
          entityId: 'entity-1',
          warehouseId: 'warehouse-1',
          salesOrderId: 'order-1',
        }),
      ).rejects.toThrow('晚間核銷');
    }
    expect(inventory.shipStock).not.toHaveBeenCalled();
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['request link', { b2bRequest: { id: 'request-1' }, externalOrderId: 'renamed' }],
    ['original order marker', { externalOrderId: 'B2B:request-1' }],
    ['source-key fallback', { externalOrderId: 'renamed', sourceOrderKey: 'channel-1:B2B:request-1' }],
    ['existing handover', { wmsHandoverInbox: [{ id: 'inbox-1' }] }],
  ])('blocks %s before dispatch, including repeated legacy fulfillment attempts', async (_source, ownership) => {
    tx.salesOrder.findFirst.mockResolvedValue({ ...order, ...ownership });
    for (let retry = 0; retry < 2; retry++) {
      await expect(service.fulfillSalesOrder({
        entityId: 'entity-1', warehouseId: 'warehouse-1', salesOrderId: 'order-1',
      })).rejects.toThrow('晚間核銷');
    }
    // Only the source-row lock ran: no dispatch intent is required to block B2B.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.inventoryTransaction.count).not.toHaveBeenCalled();
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.salesOrder.update).not.toHaveBeenCalled();
    expect(inventory.markSerialNumbersAsSold).not.toHaveBeenCalled();
    expect(inventory.shipStock).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it.each(['shipped', 'completed'])('does not report legacy success for a %s WMS-owned order', async (status) => {
    tx.salesOrder.findFirst.mockResolvedValue({ ...order, status, b2bRequest: { id: 'request-1' } });
    await expect(service.fulfillSalesOrder({
      entityId: 'entity-1', warehouseId: 'warehouse-1', salesOrderId: 'order-1',
    })).rejects.toThrow('晚間核銷');
    expect(inventory.shipStock).not.toHaveBeenCalled();
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('waits for the source-row lock before reading intent committed by an earlier dispatcher', async () => {
    let unlock!: (value: any[]) => void;
    let intentCommitted = false;
    tx.$queryRaw.mockImplementation((sql: TemplateStringsArray) => {
      const statement = sql.join('?');
      if (statement.includes('FROM sales_orders')) {
        expect(statement).toContain('FOR UPDATE');
        return new Promise((resolve) => { unlock = resolve; });
      }
      expect(statement).toContain('FROM wms_dispatch_intents');
      return Promise.resolve(intentCommitted ? [{ status: 'prepared' }] : []);
    });
    const pending = service.fulfillSalesOrder({
      entityId: 'entity-1', warehouseId: 'warehouse-1', salesOrderId: 'order-1',
    });
    expect(tx.salesOrder.findFirst).not.toHaveBeenCalled();
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
    intentCommitted = true;
    unlock([{ id: order.id }]);
    await expect(pending).rejects.toThrow('晚間核銷');
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(inventory.shipStock).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('locks the company-scoped source before ownership reads and any legacy inventory write', async () => {
    await service.fulfillSalesOrder({
      entityId: 'entity-1', warehouseId: 'warehouse-1', salesOrderId: 'order-1',
      itemSerialNumbers: { 'item-1': ['SN-1'] },
    });
    const lock = tx.$queryRaw.mock.calls[0];
    expect(lock[0].join('?')).toMatch(/FROM sales_orders\s+WHERE id=\? AND entity_id=\? FOR UPDATE/);
    expect(lock.slice(1)).toEqual(['order-1', 'entity-1']);
    const lockCall = tx.$queryRaw.mock.invocationCallOrder[0];
    const ownershipRead = tx.salesOrder.findFirst.mock.invocationCallOrder[0];
    const intentRead = tx.$queryRaw.mock.invocationCallOrder[1];
    const claim = tx.salesOrder.updateMany.mock.invocationCallOrder[0];
    expect(lockCall).toBeLessThan(ownershipRead);
    expect(ownershipRead).toBeLessThan(intentRead);
    expect(intentRead).toBeLessThan(claim);
    expect(claim).toBeLessThan(inventory.shipStock.mock.invocationCallOrder[0]);
    expect(tx.salesOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        b2bRequest: { select: { id: true } },
        wmsHandoverInbox: { take: 1, select: { id: true } },
      }),
    }));
  });

  it('rejects an absent or foreign source before querying ownership or touching stock', async () => {
    tx.salesOrder.findFirst.mockResolvedValue(null);
    await expect(service.fulfillSalesOrder({
      entityId: 'entity-foreign', warehouseId: 'warehouse-1', salesOrderId: 'order-1',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.salesOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1', entityId: 'entity-foreign' },
    }));
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(inventory.shipStock).not.toHaveBeenCalled();
  });

});
