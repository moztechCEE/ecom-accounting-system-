import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SalesOrderService } from '../sales/services/sales-order.service';
import { B2bService } from './b2b.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const requestId = '00000000-0000-4000-8000-000000000001';
const firstId = '00000000-0000-4000-8000-000000000002';
const secondId = '00000000-0000-4000-8000-000000000003';
const reviewId = '00000000-0000-4000-8000-000000000004';
const amendmentId = '00000000-0000-4000-8000-000000000005';
const baseDto = {
  entityId: 'entity-a',
  amendmentId,
  expectedStockReviewId: reviewId,
  reason: '已與客戶確認第一項減量，第二項缺貨取消',
  items: [{ requestItemId: firstId, quantity: 2 }],
};
type SavedAudit = {
  tableName: string;
  recordId: string;
  action: string;
  oldData: { total: string; items: Array<{ id: string; quantity: number }> };
  newData: {
    payloadHash: string;
    total: string;
    reason: string;
    items: Array<{
      requestItemId: string;
      quantity: number;
      lineTotal: string;
    }>;
  };
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    entityId: 'entity-a',
    sourceKind: 'GUEST',
    requestNumber: 'B2B-GUEST-001',
    status: 'needs_adjustment',
    salesOrderId: null,
    subtotal: D('40.05'),
    tax: D('2.00'),
    total: D('42.05'),
    stockReviews: [{ id: reviewId }],
    issuedQuotes: [],
    items: [
      {
        id: firstId,
        productId: 'product-a',
        quantity: 3,
        confirmedQuantity: 2,
        unitPrice: D('10.01'),
        lineTotal: D('30.03'),
      },
      {
        id: secondId,
        productId: 'product-b',
        quantity: 1,
        confirmedQuantity: 0,
        unitPrice: D('10.02'),
        lineTotal: D('10.02'),
      },
    ],
    ...overrides,
  };
}

function setup() {
  const db = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    b2bPurchaseRequest: { findFirst: jest.fn(), update: jest.fn() },
    b2bRequestItem: { update: jest.fn(), deleteMany: jest.fn() },
    purchaseOrder: { count: jest.fn().mockResolvedValue(0) },
    auditLog: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    inventorySnapshot: { findMany: jest.fn() },
  };
  db.$transaction.mockImplementation(
    async (work: (tx: typeof db) => Promise<unknown>) => work(db),
  );
  db.b2bPurchaseRequest.findFirst.mockResolvedValue(request());
  const service = new B2bService(
    db as unknown as PrismaService,
    {} as SalesOrderService,
  );
  return { db, service };
}

describe('guest request correction and stock reference', () => {
  it('reduces quantity, removes the shortage line and requires a fresh stock review', async () => {
    const { db, service } = setup();
    const result = await service.reviseGuestRequest(
      requestId,
      baseDto,
      'staff-a',
    );
    expect(result).toMatchObject({ requestId, alreadyApplied: false });
    expect(db.b2bRequestItem.update).toHaveBeenCalledWith({
      where: { id: firstId },
      data: { quantity: 2, confirmedQuantity: null, lineTotal: D('20.02') },
    });
    expect(db.b2bRequestItem.deleteMany).toHaveBeenCalledWith({
      where: {
        requestId,
        id: { notIn: [firstId] },
      },
    });
    const updateCall = db.b2bPurchaseRequest.update.mock
      .calls[0] as unknown as [
      {
        where: { id: string };
        data: {
          status: string;
          subtotal: Prisma.Decimal;
          tax: Prisma.Decimal;
          total: Prisma.Decimal;
          reviewedAt: Date | null;
          reviewedBy: string | null;
          deliveryDate: Date | null;
        };
      },
    ];
    expect(updateCall[0].where.id).toBe(requestId);
    expect(updateCall[0].data.status).toBe('pending_stock_review');
    expect(updateCall[0].data.subtotal.toFixed(2)).toBe('20.02');
    expect(updateCall[0].data.tax.toFixed(2)).toBe('1.00');
    expect(updateCall[0].data.total.toFixed(2)).toBe('21.02');
    expect(updateCall[0].data.reviewedAt).toBeNull();
    expect(updateCall[0].data.reviewedBy).toBeNull();
    expect(updateCall[0].data.deliveryDate).toBeNull();
    const auditCall = db.auditLog.create.mock.calls[0] as unknown as [
      { data: SavedAudit & { id: string; userId: string } },
    ];
    const saved = auditCall[0].data;
    expect(saved.id).toBe(amendmentId);
    expect(saved.userId).toBe('staff-a');
    expect(saved.action).toBe('REVISE_GUEST_REQUEST');
    expect(saved.oldData.total).toBe('42.05');
    expect(
      saved.oldData.items.some(
        (item) => item.id === secondId && item.quantity === 1,
      ),
    ).toBe(true);
    expect(saved.newData.total).toBe('21.02');
    expect(saved.newData.reason).toBe(baseDto.reason);
    expect(saved.newData.items).toEqual([
      {
        requestItemId: firstId,
        productId: 'product-a',
        quantity: 2,
        unitPrice: '10.01',
        lineTotal: '20.02',
      },
    ]);
  });

  it('replays the same amendment but rejects reuse for changed content', async () => {
    const { db, service } = setup();
    await service.reviseGuestRequest(requestId, baseDto, 'staff-a');
    const saved = (
      db.auditLog.create.mock.calls[0] as unknown as [{ data: SavedAudit }]
    )[0].data;
    db.auditLog.findUnique.mockResolvedValue({
      tableName: saved.tableName,
      recordId: saved.recordId,
      action: saved.action,
      newData: saved.newData,
    });
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(
      request({ status: 'pending_stock_review' }),
    );
    expect(
      await service.reviseGuestRequest(requestId, baseDto, 'staff-a'),
    ).toMatchObject({ alreadyApplied: true });
    await expect(
      service.reviseGuestRequest(
        requestId,
        { ...baseDto, reason: '這次是不同的修訂理由，不能重用編號' },
        'staff-a',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it.each([
    ['stale review', { stockReviews: [{ id: 'new-review' }] }, 0],
    ['issued quote', { issuedQuotes: [{ id: 'quote-a' }] }, 0],
    ['sales order', { salesOrderId: 'order-a' }, 0],
    ['linked purchase order', {}, 1],
  ])(
    'blocks %s before editing any line',
    async (_label, override, purchaseOrders) => {
      const { db, service } = setup();
      db.b2bPurchaseRequest.findFirst.mockResolvedValue(request(override));
      db.purchaseOrder.count.mockResolvedValue(purchaseOrders);
      await expect(
        service.reviseGuestRequest(requestId, baseDto, 'staff-a'),
      ).rejects.toThrow(ConflictException);
      expect(db.b2bRequestItem.update).not.toHaveBeenCalled();
    },
  );

  it('rejects upward quantities and a no-op', async () => {
    const { db, service } = setup();
    await expect(
      service.reviseGuestRequest(
        requestId,
        { ...baseDto, items: [{ requestItemId: firstId, quantity: 4 }] },
        'staff-a',
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.reviseGuestRequest(
        requestId,
        {
          ...baseDto,
          items: [
            { requestItemId: firstId, quantity: 3 },
            { requestItemId: secondId, quantity: 1 },
          ],
        },
        'staff-a',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns only quantities from active warehouses in the same company', async () => {
    const { db, service } = setup();
    db.b2bPurchaseRequest.findFirst.mockResolvedValue({
      items: [{ id: firstId, productId: 'product-a' }],
    });
    db.inventorySnapshot.findMany.mockResolvedValue([
      {
        productId: 'product-a',
        qtyOnHand: D(8),
        qtyAllocated: D(3),
        qtyAvailable: D(5),
        warehouse: { id: 'wh-a', code: 'A', name: '台北' },
      },
    ]);
    const snapshot = await service.stockSnapshot('entity-a', requestId);
    expect(snapshot.items[0]).toMatchObject({
      totalOnHand: '8.00',
      totalAllocated: '3.00',
      totalAvailable: '5.00',
    });
    expect(snapshot.items[0]).not.toHaveProperty('cost');
    const snapshotQuery = (
      db.inventorySnapshot.findMany.mock.calls[0] as unknown as [
        {
          where: {
            entityId: string;
            warehouse: { entityId: string; isActive: boolean };
          };
          select: {
            qtyOnHand: boolean;
            qtyAllocated: boolean;
            qtyAvailable: boolean;
          };
        },
      ]
    )[0];
    expect(snapshotQuery).toMatchObject({
      where: {
        entityId: 'entity-a',
        warehouse: { entityId: 'entity-a', isActive: true },
      },
      select: { qtyOnHand: true, qtyAllocated: true, qtyAvailable: true },
    });
    db.b2bPurchaseRequest.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.stockSnapshot('other-entity', requestId),
    ).rejects.toThrow(NotFoundException);
  });
});
