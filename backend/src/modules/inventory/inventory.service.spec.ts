import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryService } from './inventory.service';

describe('InventoryService.shipStock', () => {
  const tx = {
    warehouse: { findFirst: jest.fn() },
    product: { findFirst: jest.fn() },
    inventorySnapshot: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    inventoryTransaction: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };
  const service = new InventoryService({} as any);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.warehouse.findFirst.mockResolvedValue({ id: 'warehouse-1' });
    tx.product.findFirst.mockResolvedValue({ id: 'product-1', sku: 'SKU-1' });
    tx.inventorySnapshot.findUnique.mockResolvedValue({
      qtyOnHand: new Prisma.Decimal(2),
      qtyAllocated: new Prisma.Decimal(2),
      qtyAvailable: new Prisma.Decimal(0),
    });
    tx.inventoryTransaction.findMany.mockResolvedValue([
      { direction: 'RESERVE', quantity: new Prisma.Decimal(2) },
    ]);
    tx.inventoryTransaction.create.mockResolvedValue({ id: 'movement-1' });
    tx.inventorySnapshot.update.mockResolvedValue({ id: 'snapshot-1' });
  });

  it('releases this order reservation and ships without inflating available stock', async () => {
    await service.shipStock(
      {
        entityId: 'entity-1',
        warehouseId: 'warehouse-1',
        productId: 'product-1',
        quantity: 2,
        referenceType: 'SALES_ORDER',
        referenceId: 'order-1',
      },
      tx as any,
    );

    expect(tx.inventoryTransaction.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ direction: 'RELEASE' }) }),
    );
    expect(tx.inventoryTransaction.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ direction: 'OUT' }) }),
    );
    expect(tx.inventorySnapshot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          qtyOnHand: { decrement: expect.any(Prisma.Decimal) },
          qtyAllocated: { decrement: expect.any(Prisma.Decimal) },
          qtyAvailable: { decrement: expect.any(Prisma.Decimal) },
        },
      }),
    );
    const update = tx.inventorySnapshot.update.mock.calls[0][0];
    expect(update.data.qtyAvailable.decrement.toNumber()).toBe(0);
  });

  it('rejects shipment when neither available nor order-reserved stock is sufficient', async () => {
    tx.inventorySnapshot.findUnique.mockResolvedValue({
      qtyOnHand: new Prisma.Decimal(2),
      qtyAllocated: new Prisma.Decimal(0),
      qtyAvailable: new Prisma.Decimal(1),
    });
    tx.inventoryTransaction.findMany.mockResolvedValue([]);

    await expect(
      service.shipStock(
        {
          entityId: 'entity-1',
          warehouseId: 'warehouse-1',
          productId: 'product-1',
          quantity: 2,
          referenceType: 'SALES_ORDER',
          referenceId: 'order-1',
        },
        tx as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(tx.inventorySnapshot.update).not.toHaveBeenCalled();
  });
});

describe('InventoryService.reserveStock', () => {
  const tx = {
    inventorySnapshot: {
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    inventoryTransaction: { create: jest.fn() },
  };
  const service = new InventoryService({} as any);
  const input = {
    entityId: 'entity-1',
    warehouseId: 'warehouse-1',
    productId: 'product-1',
    quantity: 2,
    referenceType: 'SALES_ORDER' as const,
    referenceId: 'order-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.inventorySnapshot.updateMany.mockResolvedValue({ count: 1 });
    tx.inventorySnapshot.findUniqueOrThrow.mockResolvedValue({ id: 'snapshot-1' });
    tx.inventoryTransaction.create.mockResolvedValue({ id: 'movement-1' });
  });

  it('claims available quantity with a conditional update before recording the reservation', async () => {
    const result = await service.reserveStock(input, tx as any);
    expect(tx.inventorySnapshot.updateMany).toHaveBeenCalledWith({
      where: {
        entityId: 'entity-1',
        warehouseId: 'warehouse-1',
        productId: 'product-1',
        qtyAvailable: { gte: new Prisma.Decimal(2) },
      },
      data: {
        qtyAllocated: { increment: new Prisma.Decimal(2) },
        qtyAvailable: { decrement: new Prisma.Decimal(2) },
      },
    });
    expect(tx.inventorySnapshot.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.inventoryTransaction.create.mock.invocationCallOrder[0],
    );
    expect(result.snapshot.id).toBe('snapshot-1');
  });

  it('records nothing when a competing order already claimed the remaining stock', async () => {
    tx.inventorySnapshot.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reserveStock(input, tx as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects a zero or negative reservation before touching the database', async () => {
    for (const quantity of [0, -1]) {
      await expect(
        service.reserveStock({ ...input, quantity }, tx as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(tx.inventorySnapshot.updateMany).not.toHaveBeenCalled();
  });
});
