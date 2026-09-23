import { BadRequestException } from '@nestjs/common';
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
      tx.$queryRaw.mockResolvedValueOnce([{ status }]);
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
});
