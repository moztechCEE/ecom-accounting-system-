/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- the in-memory Prisma mock intentionally uses dynamic jest members */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { B2bGuestService } from './b2b-guest.service';
import { B2bGuestSubmitDto } from './b2b-guest.dto';
import {
  B2bGuestAdminController,
  B2bGuestPublicController,
} from './b2b-guest.controller';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ENTITY_ACCESS_MODULE_KEY } from '../../common/decorators/entity-access.decorator';

const entityId = 'entity-a';
const requestId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const inquiryId = '33333333-3333-4333-8333-333333333333';
const customerId = '44444444-4444-4444-8444-444444444444';
const input: B2bGuestSubmitDto = {
  entityId,
  requestId,
  companyName: '  測試商行 ',
  contactName: ' 王小姐 ',
  contactEmail: ' BUYER@EXAMPLE.COM ',
  contactPhone: '0912345678',
  customerPoNumber: 'PO-001',
  note: '請先確認庫存',
  items: [{ productId, quantity: 2 }],
};

function fixture() {
  const tx: any = {
    b2bGuestRateBucket: {
      upsert: jest.fn().mockResolvedValue({ attempts: 1 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    b2bGuestInquiry: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: customerId }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const db: any = {
    entity: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: entityId, baseCurrency: 'TWD' }),
    },
    $transaction: jest.fn((fn: (client: any) => unknown) => fn(tx)),
    $executeRaw: jest.fn().mockResolvedValue(0),
    b2bGuestInquiry: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ reference: 'G-REFERENCE' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
    },
    b2bProductPriceBook: {
      findMany: jest.fn().mockResolvedValue([
        {
          productId,
          msrp: new Prisma.Decimal('1000.00'),
          currency: 'TWD',
          taxBasis: 'TAX_INCLUDED',
          product: { sku: 'SKU-1', name: 'Item' },
        },
      ]),
    },
  };
  tx.b2bProductPriceBook = db.b2bProductPriceBook;
  tx.b2bGuestInquiry.create = db.b2bGuestInquiry.create;
  return { db, tx, service: new B2bGuestService(db) };
}

describe('B2B anonymous guest inquiry boundary', () => {
  const previous = {
    order: process.env.B2B_PUBLIC_ORDER_ENABLED,
    catalog: process.env.B2B_PUBLIC_CATALOG_ENABLED,
    secret: process.env.B2B_PUBLIC_ORDER_RATE_SECRET,
  };
  beforeEach(() => {
    process.env.B2B_PUBLIC_ORDER_ENABLED = 'true';
    process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
    process.env.B2B_PUBLIC_ORDER_RATE_SECRET =
      'isolated-test-secret-long-enough-for-hmac-rate-keys';
  });
  afterAll(() => {
    if (previous.order === undefined)
      delete process.env.B2B_PUBLIC_ORDER_ENABLED;
    else process.env.B2B_PUBLIC_ORDER_ENABLED = previous.order;
    if (previous.catalog === undefined)
      delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
    else process.env.B2B_PUBLIC_CATALOG_ENABLED = previous.catalog;
    if (previous.secret === undefined)
      delete process.env.B2B_PUBLIC_ORDER_RATE_SECRET;
    else process.env.B2B_PUBLIC_ORDER_RATE_SECRET = previous.secret;
  });

  it('keeps anonymous POST separate from staff-only list/detail/match', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, B2bGuestPublicController)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, B2bGuestAdminController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, B2bGuestAdminController),
    ).toEqual(['sales_orders:read']);
    expect(
      Reflect.getMetadata(ENTITY_ACCESS_MODULE_KEY, B2bGuestAdminController),
    ).toBe('sales');
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        Object.getOwnPropertyDescriptor(
          B2bGuestAdminController.prototype,
          'match',
        )?.value,
      ),
    ).toEqual(['sales_orders:read', 'sales_orders:create']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        Object.getOwnPropertyDescriptor(
          B2bGuestAdminController.prototype,
          'reject',
        )?.value,
      ),
    ).toEqual(['sales_orders:read', 'sales_orders:create']);
  });

  it('fails closed unless both public flags and dedicated HMAC secret are configured', async () => {
    const { db, service } = fixture();
    delete process.env.B2B_PUBLIC_ORDER_ENABLED;
    await expect(service.submit(input, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    process.env.B2B_PUBLIC_ORDER_ENABLED = 'true';
    delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
    await expect(service.submit(input, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
    delete process.env.B2B_PUBLIC_ORDER_RATE_SECRET;
    await expect(service.submit(input, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('stores only HMAC rate keys, enforces triple publication, snapshots server MSRP and returns no PII', async () => {
    const { db, tx, service } = fixture();
    const result = await service.submit(input, '203.0.113.1');
    expect(result).toEqual({ accepted: true, reference: 'G-REFERENCE' });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.b2bGuestRateBucket.upsert).toHaveBeenCalledTimes(3);
    for (const [call] of tx.b2bGuestRateBucket.upsert.mock.calls) {
      expect(call.create.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(call)).not.toContain('203.0.113.1');
      expect(JSON.stringify(call)).not.toContain('buyer@example.com');
    }
    const query = db.b2bProductPriceBook.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      entityId,
      isPublic: true,
      product: { b2bCatalog: { some: { entityId, isPublished: true } } },
    });
    expect(query.select).toEqual({
      productId: true,
      msrp: true,
      currency: true,
      taxBasis: true,
      product: { select: { sku: true, name: true } },
    });
    const created = db.b2bGuestInquiry.create.mock.calls[0][0].data;
    expect(created.contactEmail).toBe('buyer@example.com');
    expect(created.items.create).toMatchObject([
      {
        productId,
        sku: 'SKU-1',
        quantity: 2,
        msrp: new Prisma.Decimal('1000'),
        lineTotal: new Prisma.Decimal('2000'),
        taxBasis: 'TAX_INCLUDED',
      },
    ]);
    expect(created).not.toHaveProperty('customerId');
    expect(JSON.stringify(result)).not.toContain('buyer@example.com');
  });

  it('replays the same idempotency key without a second inquiry, and rejects changed payload', async () => {
    const { db, service } = fixture();
    await service.submit(input, '203.0.113.1');
    const hash = db.b2bGuestInquiry.create.mock.calls[0][0].data.payloadHash;
    db.b2bGuestInquiry.findUnique.mockResolvedValue({
      payloadHash: hash,
      reference: 'G-REFERENCE',
    });
    expect(await service.submit(input, '203.0.113.1')).toEqual({
      accepted: true,
      reference: 'G-REFERENCE',
    });
    expect(db.b2bGuestInquiry.create).toHaveBeenCalledTimes(1);
    await expect(
      service.submit({ ...input, note: '不同內容' }, '203.0.113.1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('counts denied IP attempts without consuming shared entity quota', async () => {
    const { db, tx, service } = fixture();
    tx.b2bGuestRateBucket.upsert.mockResolvedValueOnce({ attempts: 21 });
    await expect(service.submit(input, '203.0.113.1')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(db.b2bGuestInquiry.create).not.toHaveBeenCalled();
    expect(tx.b2bGuestRateBucket.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not create email buckets when the entity has reached its cap', async () => {
    const { db, tx, service } = fixture();
    tx.b2bGuestRateBucket.upsert
      .mockResolvedValueOnce({ attempts: 1 })
      .mockResolvedValueOnce({ attempts: 101 });
    await expect(service.submit(input, '203.0.113.1')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(db.b2bGuestInquiry.create).not.toHaveBeenCalled();
    expect(tx.b2bGuestRateBucket.upsert).toHaveBeenCalledTimes(2);
  });

  it('refuses unpublished product lines and duplicate product IDs', async () => {
    const { db, service } = fixture();
    db.b2bProductPriceBook.findMany.mockResolvedValue([]);
    await expect(service.submit(input, '203.0.113.1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.b2bGuestInquiry.create).not.toHaveBeenCalled();
    await expect(
      service.submit(
        { ...input, items: [input.items[0], input.items[0]] },
        '203.0.113.1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('matches only an active same-entity customer with an audited staff reason, without conversion', async () => {
    const { db, tx, service } = fixture();
    tx.b2bGuestInquiry.findFirst.mockResolvedValue({
      id: inquiryId,
      status: 'NEW',
      matchedCustomerId: null,
      matchedAt: null,
      matchedBy: null,
      matchReason: null,
    });
    tx.b2bGuestInquiry.update.mockResolvedValue({
      id: inquiryId,
      status: 'MATCHED',
      matchedCustomerId: customerId,
      matchedAt: new Date('2026-09-29T00:00:00Z'),
      matchedBy: 'staff',
      matchReason: '已電話核實公司及聯絡人',
    });
    db.b2bGuestInquiry.findFirst.mockResolvedValue({
      id: inquiryId,
      reference: 'G-REFERENCE',
      status: 'MATCHED',
      companyName: '測試商行',
      contactName: '王小姐',
      contactEmail: 'buyer@example.com',
      contactPhone: null,
      customerPoNumber: null,
      note: null,
      createdAt: new Date(),
      matchedCustomerId: customerId,
      matchedCustomer: { name: '客戶甲' },
      matchedAt: new Date(),
      matchedBy: 'staff',
      matchReason: '已電話核實公司及聯絡人',
      items: [],
    });
    const detail = await service.match(
      inquiryId,
      {
        entityId,
        customerId,
        reason: '已電話核實公司及聯絡人',
      },
      'staff',
    );
    expect(detail).toMatchObject({
      status: 'MATCHED',
      matchedCustomerId: customerId,
    });
    expect(tx.customer.findFirst).toHaveBeenCalledWith({
      where: { id: customerId, entityId, isActive: true },
      select: { id: true },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'staff',
        tableName: 'b2b_guest_inquiries',
        action: 'MATCH_CUSTOMER',
      }),
    });
    expect(db).not.toHaveProperty('b2bPurchaseRequest');
  });

  it('rejects a second customer match instead of overwriting the verified identity', async () => {
    const { tx, service } = fixture();
    tx.b2bGuestInquiry.findFirst.mockResolvedValue({
      id: inquiryId,
      status: 'MATCHED',
    });
    await expect(
      service.match(
        inquiryId,
        {
          entityId,
          customerId,
          reason: '再次要求變更客戶對象',
        },
        'staff',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.b2bGuestInquiry.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('audits NEW-to-REJECTED dismissal and disallows repeat dismissal', async () => {
    const { db, tx, service } = fixture();
    tx.b2bGuestInquiry.findFirst
      .mockResolvedValueOnce({
        id: inquiryId,
        status: 'NEW',
        rejectedAt: null,
        rejectedBy: null,
        rejectionReason: null,
      })
      .mockResolvedValueOnce({ id: inquiryId, status: 'REJECTED' });
    tx.b2bGuestInquiry.update.mockResolvedValue({
      id: inquiryId,
      status: 'REJECTED',
      rejectedAt: new Date('2026-09-29T00:00:00Z'),
      rejectedBy: 'staff',
      rejectionReason: '無效測試資料不予處理',
    });
    db.b2bGuestInquiry.findFirst.mockResolvedValue({
      id: inquiryId,
      reference: 'G-REFERENCE',
      status: 'REJECTED',
      companyName: '測試商行',
      contactName: '王小姐',
      contactEmail: 'buyer@example.com',
      contactPhone: null,
      customerPoNumber: null,
      note: null,
      createdAt: new Date(),
      matchedCustomerId: null,
      matchedCustomer: null,
      matchedAt: null,
      matchedBy: null,
      matchReason: null,
      rejectedAt: new Date(),
      rejectedBy: 'staff',
      rejectionReason: '無效測試資料不予處理',
      items: [],
    });
    const first = await service.reject(
      inquiryId,
      { entityId, reason: '無效測試資料不予處理' },
      'staff',
    );
    expect(first).toMatchObject({ status: 'REJECTED', rejectedBy: 'staff' });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'REJECT',
        userId: 'staff',
        tableName: 'b2b_guest_inquiries',
      }),
    });
    await expect(
      service.reject(
        inquiryId,
        { entityId, reason: '再次要求駁回無效資料' },
        'staff',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.b2bGuestInquiry.update).toHaveBeenCalledTimes(1);
  });
});
