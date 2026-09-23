import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

const valid = (): CreatePurchaseOrderDto => ({
  vendorId: 'vendor-a',
  orderDate: '2026-09-23',
  currency: 'TWD',
  fxRate: 1,
  items: [
    { productId: 'product-a', qty: 3, unitCost: 0.1 },
    { productId: 'product-b', qty: 1, unitCost: 0.2 },
  ],
});

describe('Manual purchase-order creation', () => {
  let tx: any, db: any, service: PurchaseService, inventory: any, cost: any;
  beforeEach(() => {
    tx = {
      entity: {
        findFirst: jest.fn().mockResolvedValue({ baseCurrency: 'TWD' }),
      },
      vendor: { findFirst: jest.fn().mockResolvedValue({ id: 'vendor-a' }) },
      product: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'product-a' }, { id: 'product-b' }]),
      },
      purchaseOrder: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'po-a', ...data, items: data.items.create }),
          ),
      },
    };
    db = {
      $transaction: jest.fn((callback) => callback(tx)),
      vendor: {
        findMany: jest.fn().mockResolvedValue([{ id: 'vendor-a', name: 'A' }]),
      },
      product: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'product-a', name: 'A', sku: 'A' }]),
      },
    };
    inventory = { adjustStock: jest.fn() };
    cost = { recordPurchaseCost: jest.fn() };
    service = new PurchaseService(db, inventory, cost);
  });

  it('uses Decimal, verified active company masters and a single transaction without stock/cost writes', async () => {
    const result = await service.create(' entity-a ', valid());
    expect(result.totalAmountOriginal.toFixed(2)).toBe('0.50');
    expect(result.totalAmountBase.toFixed(2)).toBe('0.50');
    expect(result.status).toBe('pending');
    expect(result.entityId).toBe('entity-a');
    expect(tx.entity.findFirst).toHaveBeenCalledWith({
      where: { id: 'entity-a', isActive: true },
      select: { baseCurrency: true },
    });
    expect(tx.vendor.findFirst).toHaveBeenCalledWith({
      where: { id: 'vendor-a', entityId: 'entity-a', isActive: true },
      select: { id: true },
    });
    expect(tx.product.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['product-a', 'product-b'] },
        entityId: 'entity-a',
        isActive: true,
      },
      select: { id: true },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(inventory.adjustStock).not.toHaveBeenCalled();
    expect(cost.recordPurchaseCost).not.toHaveBeenCalled();
  });

  it.each(['entity', 'vendor', 'product'])(
    'rejects missing/inactive/foreign %s before writing any order',
    async (name) => {
      if (name === 'product')
        tx.product.findMany.mockResolvedValue([{ id: 'product-a' }]);
      else tx[name].findFirst.mockResolvedValue(null);
      await expect(service.create('entity-a', valid())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
    },
  );

  it('rounds base unit prices once and sums the same values used by receipt costing', async () => {
    const input = valid();
    input.currency = ' usd ';
    input.fxRate = 1.5;
    input.items = [{ productId: 'product-a', qty: 3, unitCost: 0.01 }];
    tx.product.findMany.mockResolvedValue([{ id: 'product-a' }]);
    const result = await service.create('entity-a', input);
    expect(result.totalAmountCurrency).toBe('USD');
    expect(result.totalAmountOriginal.toFixed(2)).toBe('0.03');
    expect(result.items[0].unitCostBase.toFixed(2)).toBe('0.02');
    expect(result.totalAmountBase.toFixed(2)).toBe('0.06');
    expect(
      result.totalAmountBase.equals(
        result.items[0].qty.mul(result.items[0].unitCostBase),
      ),
    ).toBe(true);
    expect(input.currency).toBe(' usd ');
  });

  it('keeps duplicate SKU lines with their individual costs while checking unique product membership', async () => {
    const input = valid();
    input.items[1].productId = 'product-a';
    tx.product.findMany.mockResolvedValue([{ id: 'product-a' }]);
    const result = await service.create('entity-a', input);
    expect(result.items).toHaveLength(2);
    expect(result.totalAmountOriginal.toFixed(2)).toBe('0.50');
  });

  it('requires fxRate 1 for the company base currency', async () => {
    await expect(
      service.create('entity-a', { ...valid(), fxRate: 2 }),
    ).rejects.toThrow('匯率必須為 1');
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it.each([
    ['empty lines', { items: [] }],
    ['invalid day', { orderDate: '2026-02-30' }],
    ['blank vendor', { vendorId: ' ' }],
    ['invalid currency', { currency: 'NT$' }],
    ['zero fx', { fxRate: 0 }],
    ['negative fx', { fxRate: -1 }],
    ['infinite fx', { fxRate: Infinity }],
    ['fx precision', { fxRate: 1.1234567 }],
    ['fx boolean', { fxRate: true }],
    ['fx string', { fxRate: '1' }],
    ['body company', { entityId: 'foreign' }],
    ['pre-received status', { status: 'received' }],
    [
      'too many lines',
      { items: Array(1001).fill({ productId: 'p', qty: 1, unitCost: 1 }) },
    ],
  ])('rejects %s even for direct service callers', async (_name, overrides) => {
    await expect(
      service.create('entity-a', { ...valid(), ...overrides } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it.each([
    { qty: 0 },
    { qty: -1 },
    { qty: 1.5 },
    { qty: true },
    { qty: '1' },
    { qty: NaN },
    { qty: 1000001 },
    { unitCost: 0 },
    { unitCost: -0.1 },
    { unitCost: 0.001 },
    { unitCost: Infinity },
    { unitCost: '1' },
    { productId: '' },
    { productId: 12 },
  ])('rejects invalid line %p without any write', async (bad) => {
    const input = valid();
    input.items = [
      { productId: 'product-a', qty: 1, unitCost: 1, ...bad },
    ] as any;
    await expect(service.create('entity-a', input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a positive foreign cost that rounds to a zero stored base cost', async () => {
    await expect(
      service.create('entity-a', {
        ...valid(),
        currency: 'USD',
        fxRate: 0.001,
      }),
    ).rejects.toThrow('換算後本位幣單價低於 0.01');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects overflowing header amounts before starting a transaction', async () => {
    const input = {
      ...valid(),
      currency: 'USD',
      fxRate: 1000000,
      items: [{ productId: 'product-a', qty: 1000000, unitCost: 100000000 }],
    };
    await expect(service.create('entity-a', input)).rejects.toThrow(
      '採購金額超過支援範圍',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('snapshots the entire normalized input before async membership lookup', async () => {
    let resume!: (value: any) => void;
    tx.vendor.findFirst.mockImplementation(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    const input = valid();
    input.vendorId = ' vendor-a ';
    const pending = service.create('entity-a', input);
    input.vendorId = 'foreign-vendor';
    input.items[0].productId = 'foreign-product';
    input.items[0].qty = 1000;
    input.currency = 'USD';
    input.fxRate = 999;
    resume({ id: 'vendor-a' });
    const result = await pending;
    expect(result.vendorId).toBe('vendor-a');
    expect(result.totalAmountCurrency).toBe('TWD');
    expect(result.totalAmountFxRate.equals(new Prisma.Decimal(1))).toBe(true);
    expect(result.items[0].productId).toBe('product-a');
    expect(result.items[0].qty.toNumber()).toBe(3);
  });

  it('returns only scoped active options with no costs or inventory fields selected', async () => {
    const result = await service.options('entity-a');
    expect(db.vendor.findMany).toHaveBeenCalledWith({
      where: { entityId: 'entity-a', isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { entityId: 'entity-a', isActive: true },
      select: { id: true, name: true, sku: true },
      orderBy: { sku: 'asc' },
    });
    expect(result).toEqual({
      vendors: [{ id: 'vendor-a', name: 'A' }],
      products: [{ id: 'product-a', name: 'A', sku: 'A' }],
    });
  });
});
