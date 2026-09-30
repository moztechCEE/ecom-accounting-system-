/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- focused Prisma transaction mock */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { B2bGuestService } from './b2b-guest.service';

const entityId = 'entity-a';
const guestId = '33333333-3333-4333-8333-333333333333';
const customerId = '44444444-4444-4444-8444-444444444444';
const firstItemId = '55555555-5555-4555-8555-555555555555';
const secondItemId = '66666666-6666-4666-8666-666666666666';
const input = {
  entityId,
  items: [{ id: firstItemId, quantity: 1, netUnitPrice: 60.25 }],
};

function fixture() {
  const guest = {
    id: guestId,
    entityId,
    reference: 'G-0123456789ABCDEF01234567',
    payloadHash: 'guest-payload-hash',
    status: 'MATCHED',
    matchedCustomerId: customerId,
    matchedAt: new Date('2026-09-30T01:00:00Z'),
    matchedBy: 'staff-a',
    matchReason: '已電話核實公司與聯絡人',
    customerPoNumber: null,
    note: '請先確認庫存',
    items: [
      {
        id: firstItemId,
        productId: 'p1',
        sku: 'SKU-1',
        name: 'Item 1',
        quantity: 2,
        msrp: new Prisma.Decimal('120.00'),
        taxBasis: 'TAX_INCLUDED',
        sortOrder: 0,
      },
      {
        id: secondItemId,
        productId: 'p2',
        sku: 'SKU-2',
        name: 'Item 2',
        quantity: 3,
        msrp: new Prisma.Decimal('200.00'),
        taxBasis: 'TAX_INCLUDED',
        sortOrder: 1,
      },
    ],
  };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    b2bGuestInquiry: { findFirst: jest.fn().mockResolvedValue(guest) },
    b2bPurchaseRequest: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: data.id,
        requestNumber: data.requestNumber,
      })),
    },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: customerId }) },
    product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const db: any = {
    entity: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: entityId, baseCurrency: 'TWD' }),
    },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  return { guest, tx, db, service: new B2bGuestService(db) };
}

describe('B2B guest inquiry conversion', () => {
  it('creates one staff-priced internal request for a selected subset, without stock movement', async () => {
    const { tx, db, service } = fixture();
    const result = await service.convert(guestId, input, 'staff-a');
    expect(result).toEqual({
      requestId: expect.any(String),
      requestNumber: expect.stringMatching(/^B2B-/),
      alreadyConverted: false,
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1'] }, entityId, isActive: true, type: 'SIMPLE' },
      select: { id: true },
    });
    const created = tx.b2bPurchaseRequest.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      entityId,
      customerId,
      accountId: null,
      sourceKind: 'GUEST',
      sourceGuestInquiryId: guestId,
      customerPoNumber: null,
    });
    expect(created).not.toHaveProperty('status');
    expect(created.items.create).toEqual([
      {
        productId: 'p1',
        sku: 'SKU-1',
        name: 'Item 1',
        quantity: 1,
        unitPrice: new Prisma.Decimal('60.25'),
        lineTotal: new Prisma.Decimal('60.25'),
        sortOrder: 0,
      },
    ]);
    expect(created.subtotal.toFixed(2)).toBe('60.25');
    expect(created.tax.toFixed(2)).toBe('3.01');
    expect(created.total.toFixed(2)).toBe('63.26');
    expect(JSON.stringify(created)).not.toContain('120.00');
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CONVERT_GUEST_INQUIRY',
        userId: 'staff-a',
      }),
    });
    expect(tx).not.toHaveProperty('salesOrder');
    expect(tx).not.toHaveProperty('inventoryTransaction');
  });

  it('replays only the same selection and prices, rejecting a changed conversion', async () => {
    const { tx, service } = fixture();
    const first = await service.convert(guestId, input, 'staff-a');
    const created = tx.b2bPurchaseRequest.create.mock.calls[0][0].data;
    tx.b2bPurchaseRequest.findUnique.mockResolvedValue({
      id: first.requestId,
      requestNumber: first.requestNumber,
      sourceHash: created.sourceHash,
    });
    await expect(service.convert(guestId, input, 'staff-a')).resolves.toEqual({
      ...first,
      alreadyConverted: true,
    });
    await expect(
      service.convert(
        guestId,
        {
          ...input,
          items: [{ ...input.items[0], netUnitPrice: 61 }],
        },
        'staff-a',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.b2bPurchaseRequest.create).toHaveBeenCalledTimes(1);
  });

  it('rejects unmatched, unknown and oversized lines before creating an internal request', async () => {
    const { guest, tx, service } = fixture();
    guest.status = 'NEW';
    await expect(
      service.convert(guestId, input, 'staff-a'),
    ).rejects.toBeInstanceOf(ConflictException);
    guest.status = 'MATCHED';
    await expect(
      service.convert(
        guestId,
        {
          ...input,
          items: [{ ...input.items[0], quantity: 3 }],
        },
        'staff-a',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.convert(
        guestId,
        {
          ...input,
          items: [{ ...input.items[0], id: 'unknown' }],
        },
        'staff-a',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.b2bPurchaseRequest.create).not.toHaveBeenCalled();
  });

  it('refuses an inactive matched customer or product before conversion', async () => {
    const { tx, service } = fixture();
    tx.customer.findFirst.mockResolvedValue(null);
    await expect(
      service.convert(guestId, input, 'staff-a'),
    ).rejects.toBeInstanceOf(ConflictException);
    tx.customer.findFirst.mockResolvedValue({ id: customerId });
    tx.product.findMany.mockResolvedValue([]);
    await expect(
      service.convert(guestId, input, 'staff-a'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.b2bPurchaseRequest.create).not.toHaveBeenCalled();
  });
});
