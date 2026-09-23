import 'reflect-metadata';
import { SalesOrderService } from './sales-order.service';
import { SalesController } from '../sales.controller';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Reflector } from '@nestjs/core';
describe('business order entry for warehouse handoff', () => {
  const input = {
    entityId: 'company',
    channelId: 'channel',
    externalOrderId: 'TEST-ENTRY',
    orderDate: new Date('2026-09-11'),
    items: [{ productId: 'product', qty: 2, unitPrice: 10 }],
  };
  function setup() {
    const prisma = {
      salesChannel: {
        findFirst: jest.fn().mockResolvedValue({ id: 'channel' }),
      },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'product' }]) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'customer' }) },
      salesOrder: {
        create: jest.fn().mockResolvedValue({ id: 'order', items: [] }),
      },
    };
    const inventory = { reserve: jest.fn() },
      journal = { create: jest.fn() };
    return {
      prisma,
      inventory,
      journal,
      service: new SalesOrderService(
        prisma as any,
        journal as any,
        inventory as any,
        {} as any,
        {} as any,
      ),
    };
  }
  it('creates pending ERP order, but does not issue invoice, reserve stock or dispatch automatically', async () => {
    const { prisma, service, inventory, journal } = setup();
    await service.createSalesOrder(input, 'employee');
    const data = prisma.salesOrder.create.mock.calls[0][0].data;
    expect(data.status).toBe('pending');
    expect(Number(data.totalGrossOriginal)).toBe(20);
    expect(data.sourceOrderKey).toBeTruthy();
    expect(inventory.reserve).not.toHaveBeenCalled();
    expect(journal.create).not.toHaveBeenCalled();
    expect(prisma.product.findMany.mock.calls[0][0].where.entityId).toBe(
      'company',
    );
  });
  it('rejects missing company-scoped references and invalid quantities before persistence', async () => {
    const { prisma, service } = setup();
    prisma.product.findMany.mockResolvedValue([]);
    await expect(service.createSalesOrder(input, 'employee')).rejects.toThrow(
      '不屬於目前公司',
    );
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    for (const items of [
      [],
      [{ productId: 'product', qty: 0, unitPrice: 10 }],
      [{ productId: 'product', qty: 1, unitPrice: 10, discount: 11 }],
    ])
      await expect(
        service.createSalesOrder({ ...input, items }, 'employee'),
      ).rejects.toThrow('訂單品項');
  });
  it('warehouse execution permission does not grant business order creation', async () => {
    const guard = new PermissionsGuard(new Reflector(), {
      userRole: {
        findMany: async () => [
          {
            role: {
              code: 'EMPLOYEE',
              permissions: [
                { permission: { resource: 'wms_picking', action: 'execute' } },
              ],
            },
          },
        ],
      },
    } as any);
    const context = {
      getHandler: () => SalesController.prototype.createSalesOrder,
      getClass: () => SalesController,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'worker' } }) }),
    } as any;
    await expect(guard.canActivate(context)).rejects.toThrow(
      'sales_orders:create',
    );
  });

  it('creates the order and all stock holds inside one transaction when a warehouse is selected', async () => {
    const { prisma, inventory, service } = setup();
    const tx = {
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'warehouse' }) },
      salesOrder: {
        create: jest.fn().mockResolvedValue({
          id: 'order',
          items: [
            { qty: 2, product: { id: 'product', type: 'SIMPLE' } },
            { qty: 1, product: { id: 'product-2', type: 'SIMPLE' } },
          ],
        }),
      },
    };
    prisma.product.findMany.mockResolvedValue([{ id: 'product' }, { id: 'product-2' }]);
    (prisma as any).$transaction = jest.fn((callback) => callback(tx));
    (inventory as any).reserveStock = jest.fn().mockResolvedValue({});

    await service.createSalesOrder(
      {
        ...input,
        warehouseId: 'warehouse',
        items: [
          ...input.items,
          { productId: 'product-2', qty: 1, unitPrice: 10 },
        ],
      },
      'employee',
    );

    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(tx.salesOrder.create).toHaveBeenCalledTimes(1);
    expect((inventory as any).reserveStock).toHaveBeenCalledTimes(2);
    for (const call of (inventory as any).reserveStock.mock.calls) {
      expect(call[1]).toBe(tx);
      expect(call[0].referenceId).toBe('order');
    }
  });
});
