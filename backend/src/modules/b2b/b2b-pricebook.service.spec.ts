/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- the in-memory Prisma mock intentionally uses dynamic jest members */
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { B2bPriceBookService } from './b2b-pricebook.service';
import {
  B2bPriceBookAdminController,
  B2bPublicCatalogController,
} from './b2b-pricebook.controller';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ENTITY_ACCESS_MODULE_KEY } from '../../common/decorators/entity-access.decorator';

const d = (value: string | number) => new Prisma.Decimal(value);
const now = new Date('2026-09-29T00:00:00.000Z');
const productId = '11111111-1111-4111-8111-111111111111';
const product2Id = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const offerId = '44444444-4444-4444-8444-444444444444';

function fixture() {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    b2bProductPriceBook: { findUnique: jest.fn(), upsert: jest.fn() },
    b2bPriceOffer: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    b2bCustomerDiscountRule: { findUnique: jest.fn(), upsert: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const db: any = {
    entity: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'entity', baseCurrency: 'TWD' }),
    },
    product: {
      findFirst: jest.fn().mockResolvedValue({ id: productId }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: productId }, { id: product2Id }]),
    },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: customerId }) },
    b2bProductPriceBook: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    b2bCustomerDiscountRule: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    b2bCustomerPrice: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: (arg: any) => unknown) => fn(tx)),
  };
  return { db, tx, service: new B2bPriceBookService(db) };
}

describe('B2B governed price books', () => {
  it('keeps customer pricing endpoints staff-only and marks only MSRP catalog public', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, B2bPriceBookAdminController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, B2bPriceBookAdminController),
    ).toEqual(['sales_orders:read']);
    expect(
      Reflect.getMetadata(
        ENTITY_ACCESS_MODULE_KEY,
        B2bPriceBookAdminController,
      ),
    ).toBe('sales');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, B2bPublicCatalogController)).toBe(
      true,
    );
  });
  it('saves MSRP, regular and standing group-buy prices independently of mutable product.salesPrice, with transactional audit', async () => {
    const { db, tx, service } = fixture();
    tx.b2bProductPriceBook.findUnique.mockResolvedValue(null);
    tx.b2bProductPriceBook.upsert.mockResolvedValue({
      id: 'book',
      productId,
      brand: 'Corely',
      msrp: d('1000'),
      regularPrice: d('900'),
      groupBuyPrice: d('650'),
      isPublic: false,
      currency: 'TWD',
      taxBasis: 'TAX_INCLUDED',
      updatedAt: now,
    });
    const result = await service.putBook(
      productId,
      {
        entityId: 'entity',
        brand: ' Corely ',
        msrp: 1000,
        regularPrice: 900,
        groupBuyPrice: 650,
        isPublic: false,
        currency: 'TWD',
        taxBasis: 'TAX_INCLUDED',
      },
      'staff',
    );
    expect(result).toMatchObject({
      brand: 'Corely',
      msrp: '1000.00',
      regularPrice: '900.00',
      groupBuyPrice: '650.00',
      isPublic: false,
      taxBasis: 'TAX_INCLUDED',
    });
    expect(tx.b2bProductPriceBook.upsert.mock.calls[0][0].create).toMatchObject(
      {
        productId,
        brand: 'Corely',
        msrp: d(1000),
        regularPrice: d(900),
        groupBuyPrice: d(650),
        isPublic: false,
        createdBy: 'staff',
      },
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'staff',
        tableName: 'b2b_product_price_books',
        recordId: 'book',
        action: 'CREATE',
      }),
    });
    expect(db.product.findFirst.mock.calls[0][0].select).toEqual({ id: true });
    expect(
      JSON.stringify(tx.b2bProductPriceBook.upsert.mock.calls[0][0]),
    ).not.toContain('salesPrice');
  });

  it('requires a staff decision about anonymous MSRP publication on every save', async () => {
    const { tx, service } = fixture();
    await expect(
      service.putBook(
        productId,
        {
          entityId: 'entity',
          msrp: 1000,
          regularPrice: 900,
          currency: 'TWD',
          taxBasis: 'TAX_EXCLUDED',
        } as any,
        'staff',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.b2bProductPriceBook.upsert).not.toHaveBeenCalled();
  });

  it('allows staff to clear a previously assigned brand without changing the public flag', async () => {
    const { tx, service } = fixture();
    tx.b2bProductPriceBook.findUnique.mockResolvedValue({
      id: 'book',
      brand: 'Old',
    });
    tx.b2bProductPriceBook.upsert.mockResolvedValue({
      id: 'book',
      productId,
      brand: null,
      msrp: d('1000'),
      regularPrice: null,
      groupBuyPrice: null,
      isPublic: false,
      currency: 'TWD',
      taxBasis: 'TAX_INCLUDED',
      updatedAt: now,
    });
    const result = await service.putBook(
      productId,
      {
        entityId: 'entity',
        brand: null,
        msrp: 1000,
        isPublic: false,
        currency: 'TWD',
        taxBasis: 'TAX_INCLUDED',
      },
      'staff',
    );
    expect(tx.b2bProductPriceBook.upsert.mock.calls[0][0].update).toMatchObject(
      { brand: null, isPublic: false },
    );
    expect(result).toMatchObject({ brand: null, isPublic: false });
  });

  it('suggests distinct staff-maintained brands across the company pricebook', async () => {
    const { db, service } = fixture();
    db.b2bProductPriceBook.findMany.mockResolvedValue([
      { brand: 'Corely' },
      { brand: 'Other' },
    ]);
    expect(await service.brands('entity')).toEqual({
      brands: ['Corely', 'Other'],
    });
    expect(db.b2bProductPriceBook.findMany).toHaveBeenCalledWith({
      where: { entityId: 'entity', brand: { not: null } },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });
  });

  it('treats group-buy as a standing organizer reference and fails closed without verified organizer classification', async () => {
    const { db, service } = fixture();
    db.b2bProductPriceBook.findUnique.mockResolvedValue({
      msrp: d('1000'),
      regularPrice: d('900'),
      groupBuyPrice: d('650'),
      currency: 'TWD',
      taxBasis: 'TAX_EXCLUDED',
      offers: [
        {
          id: offerId,
          unitPrice: d('600'),
          startsAt: new Date('2026-09-01T00:00:00Z'),
          endsAt: new Date('2026-10-01T00:00:00Z'),
          isActive: true,
          audience: 'CODE',
          audienceCode: 'TEAM-A',
        },
      ],
    });
    await expect(
      service.preview(productId, {
        entityId: 'entity',
        priceType: 'GROUP_BUY',
        quantity: 1,
      }),
    ).resolves.toMatchObject({
      unitPrice: '650.00',
      eligible: false,
      quoteUnitPrice: null,
      reason: 'organizer_classification_required',
    });
    const common = {
      entityId: 'entity',
      priceType: 'CAMPAIGN' as const,
      offerId,
      at: now.toISOString(),
    };
    await expect(
      service.preview(productId, {
        ...common,
        quantity: 1,
        audienceCode: 'WRONG',
      }),
    ).resolves.toMatchObject({
      eligible: false,
      reason: 'audience_code_not_eligible',
    });
    await expect(
      service.preview(productId, {
        ...common,
        quantity: 1,
        audienceCode: 'team-a',
      }),
    ).resolves.toMatchObject({
      eligible: true,
      unitPrice: '600.00',
      lineTotal: '600.00',
      offerId,
    });
    await expect(
      service.preview(productId, {
        ...common,
        quantity: 1,
        audienceCode: 'TEAM-A',
        at: '2026-10-01T00:00:00Z',
      }),
    ).resolves.toMatchObject({
      eligible: false,
      reason: 'offer_outside_validity',
    });
  });

  it('requires a code for a code-targeted campaign before database writes', async () => {
    const { tx, service } = fixture();
    await expect(
      service.createOffer(
        productId,
        {
          entityId: 'entity',
          unitPrice: 550,
          startsAt: '2026-09-01T00:00:00Z',
          endsAt: '2026-10-01T00:00:00Z',
          audience: 'CODE',
        },
        'staff',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.b2bPriceOffer.create).not.toHaveBeenCalled();
  });

  it('keeps the anonymous catalog disabled by default and selects only published product MSRP', async () => {
    const { db, service } = fixture();
    const previous = process.env.B2B_PUBLIC_CATALOG_ENABLED;
    try {
      delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
      await expect(service.publicCatalog('entity')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(db.b2bProductPriceBook.findMany).not.toHaveBeenCalled();
      process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
      db.b2bProductPriceBook.findMany.mockResolvedValue([
        {
          productId,
          brand: 'Corely',
          msrp: d('1000'),
          currency: 'TWD',
          taxBasis: 'TAX_INCLUDED',
          product: {
            sku: 'SKU',
            name: 'Item',
            category: 'Devices',
          },
        },
      ]);
      db.b2bProductPriceBook.count.mockResolvedValue(1);
      const result = await service.publicCatalog('entity', 20, 0, ' SKU ');
      expect(result.items).toEqual([
        {
          productId,
          sku: 'SKU',
          name: 'Item',
          brand: 'Corely',
          category: 'Devices',
          msrp: '1000.00',
          currency: 'TWD',
          taxBasis: 'TAX_INCLUDED',
        },
      ]);
      const query = db.b2bProductPriceBook.findMany.mock.calls[0][0];
      expect(query.where.isPublic).toBe(true);
      expect(query.where.product.OR).toEqual([
        { sku: { contains: 'SKU', mode: 'insensitive' } },
        { name: { contains: 'SKU', mode: 'insensitive' } },
      ]);
      expect(query.where.product.b2bCatalog.some).toEqual({
        entityId: 'entity',
        isPublished: true,
      });
      expect(query.select).toEqual({
        productId: true,
        brand: true,
        msrp: true,
        currency: true,
        taxBasis: true,
        product: {
          select: { sku: true, name: true, category: true },
        },
      });
    } finally {
      if (previous === undefined) delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
      else process.env.B2B_PUBLIC_CATALOG_ENABLED = previous;
    }
  });

  it('filters the anonymous catalog by explicit brand and Product.category within the public eligibility boundary', async () => {
    const { db, service } = fixture();
    const previous = process.env.B2B_PUBLIC_CATALOG_ENABLED;
    try {
      process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
      await service.publicCatalog(
        'entity',
        20,
        0,
        undefined,
        ' Corely ',
        'Devices',
      );
      const query = db.b2bProductPriceBook.findMany.mock.calls[0][0];
      expect(query.where).toMatchObject({
        entityId: 'entity',
        isPublic: true,
        brand: 'Corely',
        product: {
          entityId: 'entity',
          isActive: true,
          type: 'SIMPLE',
          category: 'Devices',
          b2bCatalog: { some: { entityId: 'entity', isPublished: true } },
        },
      });
    } finally {
      if (previous === undefined) delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
      else process.env.B2B_PUBLIC_CATALOG_ENABLED = previous;
    }
  });

  it('provides only facets of eligible public SIMPLE products', async () => {
    const { db, service } = fixture();
    const previous = process.env.B2B_PUBLIC_CATALOG_ENABLED;
    try {
      delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
      await expect(
        service.publicCatalogFacets('entity'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(db.b2bProductPriceBook.findMany).not.toHaveBeenCalled();
      process.env.B2B_PUBLIC_CATALOG_ENABLED = 'true';
      db.b2bProductPriceBook.findMany.mockResolvedValue([
        { brand: 'Corely', product: { category: 'Devices' } },
        { brand: 'Corely', product: { category: 'Accessories' } },
        { brand: null, product: { category: 'Devices' } },
        { brand: 'Other', product: { category: null } },
      ]);
      expect(await service.publicCatalogFacets('entity')).toEqual({
        brands: ['Corely', 'Other'],
        categories: ['Accessories', 'Devices'],
      });
      const query = db.b2bProductPriceBook.findMany.mock.calls[0][0];
      expect(query.where).toMatchObject({
        entityId: 'entity',
        isPublic: true,
        product: {
          entityId: 'entity',
          isActive: true,
          type: 'SIMPLE',
          b2bCatalog: { some: { entityId: 'entity', isPublished: true } },
        },
      });
      expect(query.select).toEqual({
        brand: true,
        product: { select: { category: true } },
      });
    } finally {
      if (previous === undefined) delete process.env.B2B_PUBLIC_CATALOG_ENABLED;
      else process.env.B2B_PUBLIC_CATALOG_ENABLED = previous;
    }
  });

  it('applies 55折 to MSRP but lets an active per-SKU fixed price win without stacking', async () => {
    const { db, service } = fixture();
    db.b2bCustomerDiscountRule.findUnique.mockResolvedValue({
      multiplier: d('0.55'),
      basePriceType: 'MSRP',
      isActive: true,
      validFrom: new Date('2026-09-01T00:00:00Z'),
      validUntil: null,
    });
    db.b2bProductPriceBook.findMany.mockResolvedValue([
      {
        productId,
        msrp: d('1000'),
        regularPrice: d('900'),
        taxBasis: 'TAX_EXCLUDED',
      },
      {
        productId: product2Id,
        msrp: d('800'),
        regularPrice: d('700'),
        taxBasis: 'TAX_EXCLUDED',
      },
    ]);
    db.b2bCustomerPrice.findMany.mockResolvedValue([
      { productId: product2Id, unitPrice: d('390') },
    ]);
    const result = await service.previewDiscount(customerId, {
      entityId: 'entity',
      at: now.toISOString(),
      items: [
        { productId, quantity: 2 },
        { productId: product2Id, quantity: 1 },
      ],
    });
    expect(result.allEligible).toBe(true);
    expect(result.items[0]).toMatchObject({
      source: 'CUSTOMER_DISCOUNT',
      basePriceType: 'MSRP',
      baseUnitPrice: '1000.00',
      multiplier: '0.55',
      selectedUnitPrice: '550.00',
      quoteUnitPrice: '550.00',
      quoteLineTotal: '1100.00',
    });
    expect(result.items[1]).toMatchObject({
      source: 'FIXED_OVERRIDE',
      selectedUnitPrice: '390.00',
      quoteUnitPrice: '390.00',
      multiplier: null,
    });
  });

  it('fails closed for tax-inclusive discounted MSRP until a conversion policy is approved', async () => {
    const { db, service } = fixture();
    db.b2bCustomerDiscountRule.findUnique.mockResolvedValue({
      multiplier: d('0.55'),
      basePriceType: 'MSRP',
      isActive: true,
      validFrom: new Date('2026-09-01T00:00:00Z'),
      validUntil: null,
    });
    db.b2bProductPriceBook.findMany.mockResolvedValue([
      {
        productId,
        msrp: d('1000'),
        regularPrice: null,
        taxBasis: 'TAX_INCLUDED',
      },
    ]);
    const result = await service.previewDiscount(customerId, {
      entityId: 'entity',
      at: now.toISOString(),
      items: [{ productId, quantity: 1 }],
    });
    expect(result).toMatchObject({
      allEligible: false,
      items: [
        {
          selectedUnitPrice: '550.00',
          taxBasis: 'TAX_INCLUDED',
          quoteUnitPrice: null,
          eligible: false,
          reason: 'tax_conversion_policy_required',
        },
      ],
    });
  });

  it('audits customer discount changes in the same transaction and preserves 0.55 exactly', async () => {
    const { tx, service } = fixture();
    tx.b2bCustomerDiscountRule.findUnique.mockResolvedValue(null);
    tx.b2bCustomerDiscountRule.upsert.mockResolvedValue({
      id: 'rule',
      customerId,
      multiplier: d('0.55'),
      basePriceType: 'MSRP',
      validFrom: now,
      validUntil: null,
      isActive: true,
      updatedAt: now,
    });
    const result = await service.putDiscountRule(
      customerId,
      {
        entityId: 'entity',
        multiplier: 0.55,
        basePriceType: 'MSRP',
        validFrom: now.toISOString(),
        validUntil: null,
        isActive: true,
      },
      'staff',
    );
    expect(result.multiplier).toBe('0.55');
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tableName: 'b2b_customer_discount_rules',
        recordId: 'rule',
        userId: 'staff',
        action: 'CREATE',
      }),
    });
  });
});
