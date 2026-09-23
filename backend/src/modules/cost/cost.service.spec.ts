import { Prisma } from '@prisma/client';
import { CostService } from './cost.service';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('CostService.recordPurchaseCost', () => {
  const po = {
    id: 'po', entityId: 'company',
    items: [
      { id: 'a', productId: 'product', qty: d(2), unitCostBase: d(10) },
      { id: 'b', productId: 'product', qty: d(3), unitCostBase: d(20) },
    ],
    landedCost: {
      status: 'estimated',
      lines: [
        { purchaseOrderItemId: 'a', productId: 'product', qty: d(2), allocatedFreightBase: d(2) },
        { purchaseOrderItemId: 'b', productId: 'product', qty: d(3), allocatedFreightBase: d(3) },
      ],
    },
  };
  const db = () => ({
    purchaseOrder: { findUnique: jest.fn().mockResolvedValue(po) },
    product: {
      findUnique: jest.fn().mockResolvedValue({ id: 'product', movingAverageCost: d(20) }),
      update: jest.fn().mockResolvedValue({}),
    },
    inventorySnapshot: { findMany: jest.fn().mockResolvedValue([{ qtyOnHand: d(10) }]) },
  });

  it('includes apportioned freight once across duplicate product lines', async () => {
    const prisma = db();
    await new CostService({} as any, prisma as any).recordPurchaseCost('po');
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    const data = prisma.product.update.mock.calls[0][0].data;
    expect(data.latestPurchasePrice.equals(d(20))).toBe(true);
    expect(data.movingAverageCost.equals(d('18.5'))).toBe(true);
  });

  it('refuses an incomplete freight allocation before changing costs', async () => {
    const prisma = db();
    prisma.purchaseOrder.findUnique.mockResolvedValue({
      ...po, landedCost: { ...po.landedCost, lines: po.landedCost.lines.slice(0, 1) },
    });
    await expect(new CostService({} as any, prisma as any).recordPurchaseCost('po'))
      .rejects.toThrow('incomplete');
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
