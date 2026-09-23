import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseService } from './purchase.service';
import { CreateB2bPurchaseOrderDto } from './dto/create-b2b-purchase-order.dto';

const requestId = 'ff837db5-17ce-478b-bba7-0b6c14656c8f';
const requestKey = '4cfce6a0-df94-4bda-9725-8e500e1f2777';
const requestItemId = '67e95b8e-0432-4754-b3ac-5e14bcc791f2';
const anotherItemId = '17e56d27-5b66-4548-9487-eab852c71e3b';
const input = (): CreateB2bPurchaseOrderDto => ({
  requestId,
  requestKey,
  vendorId: 'vendor-a',
  orderDate: '2026-09-24',
  currency: 'TWD',
  fxRate: 1,
  items: [{ requestItemId, qty: 2, unitCost: 18.5 }],
});

describe('B2B shortage to supplier purchase order', () => {
  let tx: any;
  let db: any;
  let service: PurchaseService;
  let inventory: any;
  let cost: any;
  let request: any;

  beforeEach(() => {
    request = {
      id: requestId,
      status: 'needs_adjustment',
      items: [
        {
          id: requestItemId,
          productId: 'product-a',
          quantity: 5,
          confirmedQuantity: 2,
        },
        {
          id: anotherItemId,
          productId: 'product-b',
          quantity: 3,
          confirmedQuantity: 3,
        },
      ],
    };
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: requestId }]),
      b2bPurchaseRequest: {
        findFirst: jest.fn().mockImplementation(async () => request),
      },
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'po-a',
          ...data,
          items: data.items.create,
          vendor: { name: 'Supplier A' },
        })),
      },
      entity: {
        findFirst: jest.fn().mockResolvedValue({ baseCurrency: 'TWD' }),
      },
      vendor: { findFirst: jest.fn().mockResolvedValue({ id: 'vendor-a' }) },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'product-a' }]) },
    };
    db = { ...tx, $transaction: jest.fn((fn) => fn(tx)) };
    inventory = { adjustStock: jest.fn() };
    cost = { recordPurchaseCost: jest.fn() };
    service = new PurchaseService(db, inventory, cost);
  });

  it('creates a linked PO for a selected shortage subset with verified masters and no inventory write', async () => {
    const po = await service.createFromB2bRequest('entity-a', input());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.b2bPurchaseRequest.findFirst).toHaveBeenCalledWith({
      where: { id: requestId, entityId: 'entity-a' },
      select: expect.any(Object),
    });
    expect(tx.purchaseOrder.findMany).toHaveBeenCalledWith({
      where: {
        entityId: 'entity-a',
        sourceB2bRequestId: requestId,
        status: { not: 'cancelled' },
      },
      select: expect.any(Object),
    });
    expect(tx.vendor.findFirst).toHaveBeenCalledWith({
      where: { id: 'vendor-a', entityId: 'entity-a', isActive: true },
      select: { id: true },
    });
    expect(tx.product.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['product-a'] },
        entityId: 'entity-a',
        isActive: true,
      },
      select: { id: true },
    });
    const created = tx.purchaseOrder.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      entityId: 'entity-a',
      vendorId: 'vendor-a',
      status: 'pending',
      sourceB2bRequestId: requestId,
      sourceRequestKey: requestKey,
    });
    expect(created.sourcePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.items.create).toHaveLength(1);
    expect(created.items.create[0]).toMatchObject({
      productId: 'product-a',
      sourceB2bRequestItemId: requestItemId,
    });
    expect(po.totalAmountBase.toFixed(2)).toBe('37.00');
    expect(inventory.adjustStock).not.toHaveBeenCalled();
    expect(cost.recordPurchaseCost).not.toHaveBeenCalled();
  });

  it('replays the same key and canonical body without another PO, then rejects changed content', async () => {
    const first = await service.createFromB2bRequest('entity-a', input());
    tx.purchaseOrder.findFirst.mockResolvedValue(first);
    request.status = 'stock_confirmed'; // A completed staff review must not break an idempotent replay.
    const reordered = { ...input(), orderDate: '2026-09-24T00:00:00.000Z' };
    expect(await service.createFromB2bRequest('entity-a', reordered)).toEqual(
      first,
    );
    expect(tx.purchaseOrder.create).toHaveBeenCalledTimes(1);
    await expect(
      service.createFromB2bRequest('entity-a', {
        ...input(),
        items: [{ requestItemId, qty: 2, unitCost: 19 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchaseOrder.create).toHaveBeenCalledTimes(1);
  });

  it('resolves a unique-key race by comparing the committed PO payload', async () => {
    const committed = await service.createFromB2bRequest('entity-a', input());
    tx.purchaseOrder.findFirst
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(committed);
    tx.purchaseOrder.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    expect(await service.createFromB2bRequest('entity-a', input())).toEqual(
      committed,
    );
    expect(tx.purchaseOrder.create).toHaveBeenCalledTimes(2);
  });

  it('snapshots the buyer-selected vendor, cost and quantity before the request row lock', async () => {
    let release!: (value: unknown) => void;
    tx.$queryRaw.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const body = input();
    const pending = service.createFromB2bRequest('entity-a', body);
    body.vendorId = 'vendor-foreign';
    body.items[0].qty = 99;
    body.items[0].unitCost = 99;
    release([{ id: requestId }]);
    const po = await pending;
    expect(po.vendorId).toBe('vendor-a');
    expect(po.items[0].qty.toNumber()).toBe(2);
    expect(po.items[0].unitCostOriginal.toFixed(2)).toBe('18.50');
  });

  it('subtracts prior non-cancelled POs and rejects quantity beyond the remaining shortage', async () => {
    tx.purchaseOrder.findMany.mockResolvedValue([
      {
        items: [
          { sourceB2bRequestItemId: requestItemId, qty: new Prisma.Decimal(2) },
        ],
      },
    ]);
    await expect(
      service.createFromB2bRequest('entity-a', input()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
    const allowed = input();
    allowed.items[0].qty = 1;
    await expect(
      service.createFromB2bRequest('entity-a', allowed),
    ).resolves.toMatchObject({ id: 'po-a' });
  });

  it('requires a reviewed shortage and source line belonging to the same company request', async () => {
    request.status = 'pending_stock_review';
    await expect(
      service.createFromB2bRequest('entity-a', input()),
    ).rejects.toBeInstanceOf(ConflictException);
    request.status = 'needs_adjustment';
    request.items[0].confirmedQuantity = null;
    await expect(
      service.createFromB2bRequest('entity-a', input()),
    ).rejects.toBeInstanceOf(ConflictException);
    request.items[0].confirmedQuantity = 2;
    const foreignLine = input();
    foreignLine.items[0].requestItemId = '1bedfb2b-f088-4dd5-9989-d98ca581946f';
    await expect(
      service.createFromB2bRequest('entity-a', foreignLine),
    ).rejects.toBeInstanceOf(BadRequestException);
    tx.b2bPurchaseRequest.findFirst.mockResolvedValue(null);
    await expect(
      service.createFromB2bRequest('foreign-entity', input()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('reuses active vendor, product, currency and base-cost rules', async () => {
    tx.vendor.findFirst.mockResolvedValue(null);
    await expect(
      service.createFromB2bRequest('entity-a', input()),
    ).rejects.toBeInstanceOf(BadRequestException);
    tx.vendor.findFirst.mockResolvedValue({ id: 'vendor-a' });
    const wrongFx = { ...input(), fxRate: 2 };
    await expect(
      service.createFromB2bRequest('entity-a', wrongFx),
    ).rejects.toThrow('匯率必須為 1');
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it.each([
    { items: [{ requestItemId, qty: '2', unitCost: 1 }] },
    { items: [{ requestItemId, qty: 2, unitCost: '1' }] },
    { items: [{ requestItemId, qty: 2, unitCost: 0 }] },
    { requestKey: 'reused-without-uuid' },
    { entityId: 'another-company' },
    {
      items: [
        { requestItemId, qty: 1, unitCost: 1 },
        { requestItemId, qty: 1, unitCost: 1 },
      ],
    },
  ])(
    'rejects invalid or injected direct service input %p before write',
    async (change) => {
      await expect(
        service.createFromB2bRequest('entity-a', {
          ...input(),
          ...change,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('shows reviewed shortage and excludes cancelled POs from ordered while retaining history', async () => {
    tx.purchaseOrder.findMany.mockResolvedValue([
      {
        id: 'po-active',
        status: 'pending',
        vendor: { name: 'Supplier A' },
        createdAt: new Date('2026-09-24'),
        items: [
          { sourceB2bRequestItemId: requestItemId, qty: new Prisma.Decimal(2) },
        ],
      },
      {
        id: 'po-cancelled',
        status: 'cancelled',
        vendor: { name: 'Supplier B' },
        createdAt: new Date('2026-09-23'),
        items: [
          { sourceB2bRequestItemId: requestItemId, qty: new Prisma.Decimal(1) },
        ],
      },
    ]);
    expect(await service.b2bProcurement('entity-a', requestId)).toEqual({
      items: [
        { requestItemId, requested: 5, confirmed: 2, shortage: 3, ordered: 2 },
        {
          requestItemId: anotherItemId,
          requested: 3,
          confirmed: 3,
          shortage: 0,
          ordered: 0,
        },
      ],
      purchaseOrders: [
        {
          id: 'po-active',
          status: 'pending',
          vendorName: 'Supplier A',
          createdAt: new Date('2026-09-24'),
        },
        {
          id: 'po-cancelled',
          status: 'cancelled',
          vendorName: 'Supplier B',
          createdAt: new Date('2026-09-23'),
        },
      ],
    });
    expect(tx.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityId: 'entity-a', sourceB2bRequestId: requestId },
      }),
    );
  });
});
