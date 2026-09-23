import { BadRequestException } from '@nestjs/common';
import { PurchaseService } from './purchase.service';

describe('PurchaseService.receiveOrder', () => {
  const tx = {
    purchaseOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    warehouse: { findFirst: jest.fn() },
    purchaseLandedCost: {
      updateMany: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    purchaseLandedCostLine: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    purchaseOrder: { findFirst: jest.fn() },
  };
  const inventory = {
    adjustStock: jest.fn(),
    addSerialNumbers: jest.fn(),
  };
  const cost = { recordPurchaseCost: jest.fn() };
  let service: PurchaseService;

  const pendingOrder = {
    id: 'po-1',
    entityId: 'entity-1',
    status: 'pending',
    vendor: { id: 'vendor-1' },
    items: [
      {
        productId: 'product-1',
        qty: 2,
        product: { sku: 'SKU-1', hasSerialNumbers: true },
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PurchaseService(prisma as any, inventory as any, cost as any);
    tx.purchaseOrder.findFirst.mockResolvedValue(pendingOrder);
    tx.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.purchaseOrder.update.mockResolvedValue({ ...pendingOrder, status: 'received' });
    tx.warehouse.findFirst.mockResolvedValue({ id: 'warehouse-1' });
  });

  it('receives stock, serial numbers and cost in the same transaction', async () => {
    const result = await service.receiveOrder('entity-1', 'po-1', {
      warehouseId: 'warehouse-1',
      serialNumbers: [
        { productId: 'product-1', serialNumbers: ['SN-1', 'SN-2'] },
      ],
    });

    expect(result.status).toBe('received');
    expect(inventory.adjustStock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'entity-1',
        warehouseId: 'warehouse-1',
        productId: 'product-1',
        direction: 'IN',
        referenceId: 'po-1',
      }),
      tx,
    );
    expect(inventory.addSerialNumbers).toHaveBeenCalledWith(
      'entity-1',
      'warehouse-1',
      'product-1',
      ['SN-1', 'SN-2'],
      'PURCHASE_ORDER',
      'po-1',
      tx,
    );
    expect(cost.recordPurchaseCost).toHaveBeenCalledWith('po-1', tx);
    expect(tx.purchaseLandedCost.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { purchaseOrderId: 'po-1', status: 'estimated' },
      data: expect.objectContaining({ status: 'applied' }),
    }));
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'received' } }),
    );
  });

  it('rejects duplicate serial numbers before any inventory mutation', async () => {
    await expect(
      service.receiveOrder('entity-1', 'po-1', {
        warehouseId: 'warehouse-1',
        serialNumbers: [
          { productId: 'product-1', serialNumbers: ['SN-1', 'SN-1'] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(inventory.adjustStock).not.toHaveBeenCalled();
    expect(cost.recordPurchaseCost).not.toHaveBeenCalled();
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('treats a retry of an already received order as idempotent', async () => {
    tx.purchaseOrder.findFirst.mockResolvedValue({
      ...pendingOrder,
      status: 'received',
    });

    const result = await service.receiveOrder('entity-1', 'po-1', {
      warehouseId: 'warehouse-1',
    });

    expect(result.status).toBe('received');
    expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
    expect(inventory.adjustStock).not.toHaveBeenCalled();
  });

  it('stores all weights and freight allocations before receipt', async () => {
    tx.purchaseOrder.findFirst.mockResolvedValue({
      ...pendingOrder,
      entity: { baseCurrency: 'TWD' },
      items: [{ id: 'line-1', productId: 'product-1', qty: 2, unitCostBase: 100, product: { sku: 'SKU-1' } }],
    });
    tx.purchaseLandedCost.upsert.mockResolvedValue({ id: 'landed-1' });
    tx.purchaseLandedCost.findUnique.mockResolvedValue({ id: 'landed-1', lines: [{ purchaseOrderItemId: 'line-1' }] });
    const result = await service.saveLandedCost('entity-1', 'po-1', {
      freightCurrency: 'CNY', ratePerKgOriginal: 10, fxRateToBase: 4,
      weights: [{ purchaseOrderItemId: 'line-1', chargeableWeightKg: 1.5 }],
    }, 'staff-1');
    expect(result?.id).toBe('landed-1');
    expect(tx.purchaseLandedCost.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ freightBase: '60.00', goodsBase: '200.00', createdBy: 'staff-1', updatedBy: 'staff-1' }),
    }));
    expect(tx.purchaseLandedCostLine.deleteMany).toHaveBeenCalledWith({ where: { landedCostId: 'landed-1' } });
    expect(tx.purchaseLandedCostLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        purchaseOrderItemId: 'line-1', chargeableWeightKg: '1.5', allocatedFreightBase: '60.00',
      })],
    });
    expect(inventory.adjustStock).not.toHaveBeenCalled();
  });

  it('does not save a freight estimate with omitted purchase lines', async () => {
    tx.purchaseOrder.findFirst.mockResolvedValue({
      ...pendingOrder,
      entity: { baseCurrency: 'TWD' },
      items: [
        { id: 'line-1', productId: 'product-1', qty: 2, unitCostBase: 100, product: { sku: 'SKU-1' } },
        { id: 'line-2', productId: 'product-2', qty: 1, unitCostBase: 50, product: { sku: 'SKU-2' } },
      ],
    });
    await expect(service.saveLandedCost('entity-1', 'po-1', {
      freightCurrency: 'TWD', ratePerKgOriginal: 5, fxRateToBase: 1,
      weights: [{ purchaseOrderItemId: 'line-1', chargeableWeightKg: 1 }],
    }, 'staff-1')).rejects.toThrow('every purchase-order line');
    expect(tx.purchaseLandedCost.upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-unit TWD exchange rate for a TWD-base company', async () => {
    tx.purchaseOrder.findFirst.mockResolvedValue({
      ...pendingOrder,
      entity: { baseCurrency: 'TWD' },
      items: [{ id: 'line-1', productId: 'product-1', qty: 2, unitCostBase: 100, product: { sku: 'SKU-1' } }],
    });
    await expect(service.saveLandedCost('entity-1', 'po-1', {
      freightCurrency: 'TWD', ratePerKgOriginal: 5, fxRateToBase: 2,
      weights: [{ purchaseOrderItemId: 'line-1', chargeableWeightKg: 1 }],
    }, 'staff-1')).rejects.toThrow('匯率必須為 1');
    expect(tx.purchaseLandedCost.upsert).not.toHaveBeenCalled();
  });
});
