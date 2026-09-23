import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  B2bService,
  B2bIdentity,
  publicRequest,
  requestSourceHash,
} from './b2b.service';

const identity: B2bIdentity = {
  id: 'account-a',
  entityId: 'entity-a',
  customerId: 'customer-a',
  name: 'Buyer',
  customerName: 'Customer A',
  companyName: 'Corely',
  tokenHash: 'token-hash',
};
const requestId = '00000000-0000-4000-8000-000000000001';
const lineId = '00000000-0000-4000-8000-000000000002';
const D = (n: string | number) => new Prisma.Decimal(n);
function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    entityId: 'entity-a',
    customerId: 'customer-a',
    accountId: 'account-a',
    requestId,
    sourceHash: 'hash',
    requestNumber: 'B2B-TEST',
    customerPoNumber: 'PO-01',
    status: 'pending_stock_review',
    salesOrderId: null,
    currency: 'TWD',
    subtotal: D('30.03'),
    tax: D('1.50'),
    total: D('31.53'),
    note: null,
    createdAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    deliveryDate: null,
    customer: { name: 'Customer A', companyName: null },
    issuedQuotes: overrides.status === 'stock_confirmed'
      ? [{ id: 'issued-quote', version: 1, status: 'accepted' }]
      : [],
    items: [
      {
        id: lineId,
        requestId,
        productId: 'p1',
        sku: 'SKU-1',
        name: 'Product',
        quantity: 3,
        confirmedQuantity: null,
        unitPrice: D('10.01'),
        lineTotal: D('30.03'),
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}
function makeDb() {
  const db: any = {
    entity: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'entity-a',
        name: 'Corely',
        loginCode: 'CORELY',
        isActive: true,
        baseCurrency: 'TWD',
      }),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'customer-a',
        entityId: 'entity-a',
        isActive: true,
      }),
    },
    product: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'p1',
            type: 'SIMPLE',
            hasSerialNumbers: false,
            barcode: '471000000001',
          },
        ]),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'p1', entityId: 'entity-a', isActive: true }),
    },
    vendor: { findFirst: jest.fn() },
    b2bAccount: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    b2bSession: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    b2bCatalogItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          productId: 'p1',
          unitPrice: D('20'),
          product: { sku: 'SKU-1', name: 'Product', description: 'Details' },
        },
      ]),
    },
    b2bCustomerPrice: {
      upsert: jest.fn(),
      findMany: jest
        .fn()
        .mockResolvedValue([{ productId: 'p1', unitPrice: D('10.01') }]),
    },
    b2bPurchaseRequest: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    b2bRequestItem: { update: jest.fn() },
    b2bStockReview: { create: jest.fn().mockResolvedValue({ id: 'review-event' }) },
    b2bIssuedQuote: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    salesQuotation: { create: jest.fn(), update: jest.fn() },
    inventorySnapshot: { update: jest.fn() },
    inventoryTransaction: { create: jest.fn(), findFirst: jest.fn() },
    salesOrder: { create: jest.fn(), findFirst: jest.fn() },
    purchaseOrder: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return db;
}
describe('B2B account and request boundaries', () => {
  let db: any,
    service: B2bService,
    salesOrders: { createSalesOrder: jest.Mock };
  const original = process.env.B2B_PORTAL_ENABLED;
  const originalBrands = process.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON;
  beforeEach(() => {
    process.env.B2B_PORTAL_ENABLED = 'true';
    process.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON = JSON.stringify({
      'entity-a': { p1: 'MOZTECH' },
    });
    db = makeDb();
    salesOrders = { createSalesOrder: jest.fn() };
    service = new B2bService(db, salesOrders as any);
  });
  afterAll(() => {
    if (originalBrands === undefined)
      delete process.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON;
    else process.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON = originalBrands;
    if (original === undefined) delete process.env.B2B_PORTAL_ENABLED;
    else process.env.B2B_PORTAL_ENABLED = original;
  });
  it('rejects an employee JWT before looking up a customer session', async () => {
    await expect(
      service.authenticate('Bearer eyJhbGci.employee.token'),
    ).rejects.toThrow(UnauthorizedException);
    expect(db.b2bSession.findUnique).not.toHaveBeenCalled();
  });
  it.each(['inactive', 'expired', 'revoked', 'wrong-company', 'supplier'])(
    'rejects %s session on customer APIs',
    async (kind) => {
      const customer = {
        id: 'customer-a',
        entityId: 'entity-a',
        name: 'Customer',
        isActive: true,
      };
      const account: any = {
        ...identity,
        accountType: 'CUSTOMER',
        isActive: true,
        customer,
        entity: { name: 'Corely', isActive: true },
      };
      const session: any = {
        account,
        expiresAt: new Date(Date.now() + 60000),
        revokedAt: null,
      };
      if (kind === 'inactive') account.isActive = false;
      if (kind === 'expired') session.expiresAt = new Date(0);
      if (kind === 'revoked') session.revokedAt = new Date();
      if (kind === 'wrong-company') customer.entityId = 'entity-b';
      if (kind === 'supplier') {
        account.accountType = 'SUPPLIER';
        account.customer = null;
        account.customerId = null;
      }
      db.b2bSession.findUnique.mockResolvedValue(session);
      await expect(
        service.authenticate('Bearer b2b_' + 'a'.repeat(64)),
      ).rejects.toThrow(UnauthorizedException);
    },
  );
  it('returns an account-scoped profile and never a password or employee role', async () => {
    db.b2bSession.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
      account: {
        ...identity,
        accountType: 'CUSTOMER',
        isActive: true,
        passwordHash: 'secret',
        customer: {
          entityId: 'entity-a',
          isActive: true,
          name: 'A',
          companyName: 'A Ltd',
        },
        entity: { isActive: true, name: 'Corely' },
      },
    });
    const result = await service.authenticate('Bearer b2b_' + 'a'.repeat(64));
    expect(result).toMatchObject({
      entityId: 'entity-a',
      customerId: 'customer-a',
      customerName: 'A Ltd',
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('roles');
  });
  it('only reads published active products and prices for the authenticated customer', async () => {
    const catalog = await service.catalog(identity);
    expect(catalog.items[0].unitPrice).toBe('10.01');
    expect(db.b2bCatalogItem.findMany.mock.calls[0][0].where).toEqual({
      entityId: 'entity-a',
      isPublished: true,
      product: { entityId: 'entity-a', isActive: true, type: 'SIMPLE' },
    });
    expect(db.b2bCustomerPrice.findMany.mock.calls[0][0].where).toMatchObject({
      entityId: 'entity-a',
      customerId: 'customer-a',
      isActive: true,
      OR: [{ validUntil: null }, { validUntil: { gt: expect.any(Date) } }],
    });
    expect(catalog.items[0]).not.toHaveProperty('purchaseCost');
    expect(catalog.items[0]).not.toHaveProperty('qtyAvailable');
  });
  it('uses explicitly published catalog price when no currently effective customer override exists', async () => {
    db.b2bCustomerPrice.findMany.mockResolvedValue([]);
    expect((await service.catalog(identity)).items[0].unitPrice).toBe('20.00');
  });
  it('keeps a date-only customer price through the full Taiwan day, then expires at midnight', async () => {
    const cutoff = new Date('2026-09-23T16:00:00.000Z'); // Sep 24 00:00 Asia/Taipei
    const input = {
      entityId: 'entity-a', customerId: 'customer-a', productId: 'p1',
      unitPrice: 10.01, isActive: true, validUntil: '2026-09-23',
    };
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T15:59:59.999Z'));
    try {
      db.b2bCustomerPrice.upsert.mockResolvedValue({});
      await service.setPrice(input, 'staff');
      expect(db.b2bCustomerPrice.upsert.mock.calls[0][0].create.validUntil).toEqual(cutoff);
      expect(db.b2bCustomerPrice.upsert.mock.calls[0][0].update.validUntil).toEqual(cutoff);
      db.b2bCustomerPrice.findMany.mockImplementation(({ where }: any) =>
        cutoff > where.OR[1].validUntil.gt
          ? [{ productId: 'p1', unitPrice: D('10.01') }]
          : [],
      );
      expect((await service.catalog(identity)).items[0].unitPrice).toBe('10.01');
      jest.setSystemTime(cutoff);
      expect((await service.catalog(identity)).items[0].unitPrice).toBe('20.00');
      await expect(service.setPrice(input, 'staff')).rejects.toThrow('有效期限必須晚於現在');
      await expect(service.setPrice({ ...input, validUntil: '2026-02-31' }, 'staff'))
        .rejects.toThrow('有效期限不是有效日期');
    } finally {
      jest.useRealTimers();
    }
  });
  it('snapshots server prices with decimal tax and writes no inventory/order records on customer PO submission', async () => {
    db.b2bPurchaseRequest.create.mockImplementation(({ data }: any) => ({
      ...requestRow(),
      ...data,
      items: data.items.create.map((i: any) => ({
        ...i,
        id: lineId,
        confirmedQuantity: null,
      })),
      customer: { name: 'A' },
    }));
    const result = await service.submit(identity, {
      requestId,
      customerPoNumber: 'PO-01',
      items: [{ productId: 'p1', quantity: 3 }],
    });
    expect(result).toMatchObject({
      subtotal: '30.03',
      tax: '1.50',
      total: '31.53',
      status: 'pending_stock_review',
    });
    expect(db.b2bPurchaseRequest.create.mock.calls[0][0].data).toMatchObject({
      entityId: 'entity-a',
      customerId: 'customer-a',
      accountId: 'account-a',
    });
    for (const table of [
      'inventorySnapshot',
      'inventoryTransaction',
      'salesOrder',
      'purchaseOrder',
    ])
      for (const method of Object.values(db[table]) as jest.Mock[])
        expect(method).not.toHaveBeenCalled();
  });
  it('rejects unpublished or foreign products as one complete submission', async () => {
    await expect(
      service.submit(identity, {
        requestId,
        customerPoNumber: 'PO-01',
        items: [{ productId: 'foreign', quantity: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(db.b2bPurchaseRequest.create).not.toHaveBeenCalled();
  });
  it('returns original quote snapshot on an identical submission retry without recalculating prices', async () => {
    const dto = {
      requestId,
      customerPoNumber: 'PO-01',
      items: [{ productId: 'p1', quantity: 3 }],
    };
    db.b2bPurchaseRequest.findUnique.mockResolvedValue(
      requestRow({ sourceHash: requestSourceHash(dto) }),
    );
    expect((await service.submit(identity, dto)).total).toBe('31.53');
    expect(db.b2bCatalogItem.findMany).not.toHaveBeenCalled();
    expect(db.b2bPurchaseRequest.create).not.toHaveBeenCalled();
  });
  it('rejects reuse of a submission id with changed quantities', async () => {
    db.b2bPurchaseRequest.findUnique.mockResolvedValue(
      requestRow({ sourceHash: 'other' }),
    );
    await expect(
      service.submit(identity, {
        requestId,
        customerPoNumber: 'PO-01',
        items: [{ productId: 'p1', quantity: 4 }],
      }),
    ).rejects.toThrow(ConflictException);
  });
  it('resolves concurrent duplicate create to its original request', async () => {
    const dto = {
      requestId,
      customerPoNumber: 'PO-01',
      items: [{ productId: 'p1', quantity: 3 }],
    };
    db.b2bPurchaseRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        requestRow({ sourceHash: requestSourceHash(dto) }),
      );
    db.b2bPurchaseRequest.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    expect((await service.submit(identity, dto)).id).toBe(requestId);
  });
  it('scopes quote detail to both company and customer, not an unguessable ID alone', async () => {
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(null);
    await expect(service.detail(identity, 'someone-else')).rejects.toThrow(
      NotFoundException,
    );
    expect(db.b2bPurchaseRequest.findFirst.mock.calls[0][0].where).toEqual({
      id: 'someone-else',
      entityId: 'entity-a',
      customerId: 'customer-a',
    });
  });
  it('requires shortfall explanation and rejects an over-confirmation', async () => {
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(requestRow());
    await expect(
      service.review(
        requestId,
        { entityId: 'entity-a', items: [{ id: lineId, confirmedQuantity: 4 }] },
        'staff',
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.review(
        requestId,
        { entityId: 'entity-a', items: [{ id: lineId, confirmedQuantity: 2 }] },
        'staff',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(db.b2bRequestItem.update).not.toHaveBeenCalled();
  });
  it('records manual shortfall without changing original quote or stock', async () => {
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(requestRow());
    db.b2bPurchaseRequest.update.mockImplementation(({ data }: any) =>
      requestRow(data),
    );
    const result = await service.review(
      requestId,
      {
        entityId: 'entity-a',
        items: [{ id: lineId, confirmedQuantity: 2 }],
        reviewNote: '只剩 2 件',
      },
      'staff',
    );
    expect(result.status).toBe('needs_adjustment');
    expect(result.total).toBe('31.53');
    expect(db.b2bPurchaseRequest.update.mock.calls[0][0].data).toMatchObject({
      reviewedBy: 'staff',
      reviewedAt: expect.any(Date),
    });
    expect(db.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(db.salesOrder.create).not.toHaveBeenCalled();
  });
  it('cannot overwrite an already reviewed request', async () => {
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(
      requestRow({ status: 'stock_confirmed' }),
    );
    await expect(
      service.review(
        requestId,
        { entityId: 'entity-a', items: [{ id: lineId, confirmedQuantity: 3 }] },
        'staff',
      ),
    ).rejects.toThrow(ConflictException);
  });
  it('stores a salted password hash and keeps customer identities outside employee tables', async () => {
    db.b2bAccount.create.mockResolvedValue({
      id: 'a',
      email: 'buyer@example.com',
    });
    await service.createAccount(
      {
        entityId: 'entity-a',
        customerId: 'customer-a',
        email: 'BUYER@example.com',
        name: 'Buyer',
        password: 'strong-password-2026',
      },
      'staff',
    );
    const data = db.b2bAccount.create.mock.calls[0][0].data;
    expect(data.email).toBe('buyer@example.com');
    expect(data.passwordHash).not.toBe('strong-password-2026');
    expect(
      await bcrypt.compare('strong-password-2026', data.passwordHash),
    ).toBe(true);
    expect(db.b2bAccount.create.mock.calls[0][0].select).not.toHaveProperty(
      'passwordHash',
    );
  });
  it('revokes all existing sessions when an account is deactivated', async () => {
    db.b2bAccount.findFirst.mockResolvedValue({ id: 'a' });
    await service.updateAccount('a', { entityId: 'entity-a', isActive: false });
    expect(db.b2bAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'a', entityId: 'entity-a', accountType: 'CUSTOMER' },
    });
    expect(db.b2bSession.updateMany).toHaveBeenCalledWith({
      where: { accountId: 'a', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
  it('keeps supplier account mutation separate from customer account mutation', async () => {
    db.b2bAccount.findFirst.mockResolvedValue({ id: 'supplier-a' });
    await service.updateAccount('supplier-a', { entityId: 'entity-a', isActive: false }, 'SUPPLIER');
    expect(db.b2bAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'supplier-a', entityId: 'entity-a', accountType: 'SUPPLIER' },
    });
  });
  it('public quote projection strips internal account, hash, reviewer and customer graph', () => {
    const result = publicRequest(requestRow() as any);
    expect(result.quotePath).toBe(`/b2b/requests/${requestId}`);
    for (const field of [
      'sourceHash',
      'accountId',
      'reviewedBy',
      'customer',
      'entityId',
    ])
      expect(result).not.toHaveProperty(field);
  });
  it('logout uses the hash of the current session only', async () => {
    await service.logout(identity);
    expect(db.b2bSession.updateMany.mock.calls[0][0].where).toEqual({
      tokenHash: identity.tokenHash,
    });
  });
  it('requires a full human stock review before confirmation', async () => {
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(requestRow());
    await expect(
      service.confirm(
        requestId,
        {
          entityId: 'entity-a',
          warehouseId: 'warehouse-a',
          channelId: 'b2b-channel',
        },
        'staff',
      ),
    ).rejects.toThrow(ConflictException);
    expect(salesOrders.createSalesOrder).not.toHaveBeenCalled();
  });
  it('passes order creation and reserve into the same request transaction', async () => {
    const reviewed = requestRow({
      status: 'stock_confirmed',
      reviewedAt: new Date(),
    });
    reviewed.items[0].confirmedQuantity = 3 as never;
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(reviewed);
    salesOrders.createSalesOrder.mockResolvedValue({ id: 'order-a' });
    db.b2bPurchaseRequest.update.mockImplementation(({ data }: any) => ({
      ...reviewed,
      ...data,
    }));
    const result = await service.confirm(
      requestId,
      {
        entityId: 'entity-a',
        warehouseId: 'warehouse-a',
        channelId: 'b2b-channel',
      },
      'staff',
    );
    expect(salesOrders.createSalesOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'entity-a',
        customerId: 'customer-a',
        warehouseId: 'warehouse-a',
        channelId: 'b2b-channel',
        externalOrderId: `B2B:${requestId}`,
        items: [{ productId: 'p1', qty: 3, unitPrice: 10.01, taxAmount: 1.5 }],
      }),
      'staff',
      db,
    );
    expect(result).toMatchObject({
      status: 'order_confirmed',
      salesOrderId: 'order-a',
      alreadyConfirmed: false,
    });
  });
  it('leaves the request unconfirmed when atomic order/reservation creation rejects', async () => {
    const reviewed = requestRow({
      status: 'stock_confirmed',
      reviewedAt: new Date(),
    });
    reviewed.items[0].confirmedQuantity = 3 as never;
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(reviewed);
    salesOrders.createSalesOrder.mockRejectedValue(
      new BadRequestException('Insufficient available stock'),
    );
    await expect(
      service.confirm(
        requestId,
        {
          entityId: 'entity-a',
          warehouseId: 'warehouse-a',
          channelId: 'b2b-channel',
        },
        'staff',
      ),
    ).rejects.toThrow('Insufficient available stock');
    expect(db.b2bPurchaseRequest.update).not.toHaveBeenCalled();
    expect(salesOrders.createSalesOrder.mock.calls[0][2]).toBe(db);
  });
  it('returns a repeated confirmation without creating another order or reservation', async () => {
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(
      requestRow({ status: 'order_confirmed', salesOrderId: 'order-a' }),
    );
    db.salesOrder.findFirst.mockResolvedValue({
      id: 'order-a',
      channelId: 'b2b-channel',
    });
    db.inventoryTransaction.findFirst.mockResolvedValue({
      warehouseId: 'warehouse-a',
    });
    const result = await service.confirm(
      requestId,
      {
        entityId: 'entity-a',
        warehouseId: 'warehouse-a',
        channelId: 'b2b-channel',
      },
      'staff',
    );
    expect(result.alreadyConfirmed).toBe(true);
    expect(salesOrders.createSalesOrder).not.toHaveBeenCalled();
  });
  it.each(['channel', 'warehouse'])(
    'rejects a confirmed retry that changes %s',
    async (changed) => {
      db.b2bPurchaseRequest.findFirst.mockResolvedValue(
        requestRow({ status: 'order_confirmed', salesOrderId: 'order-a' }),
      );
      db.salesOrder.findFirst.mockResolvedValue({
        id: 'order-a',
        channelId: changed === 'channel' ? 'other' : 'b2b-channel',
      });
      db.inventoryTransaction.findFirst.mockResolvedValue({
        warehouseId: changed === 'warehouse' ? 'other' : 'warehouse-a',
      });
      await expect(
        service.confirm(
          requestId,
          {
            entityId: 'entity-a',
            warehouseId: 'warehouse-a',
            channelId: 'b2b-channel',
          },
          'staff',
        ),
      ).rejects.toThrow(ConflictException);
      expect(salesOrders.createSalesOrder).not.toHaveBeenCalled();
    },
  );
  it.each([
    'serial',
    'bundle',
    'no-barcode',
    'inactive',
    'no-brand',
    'invalid-json',
    'numeric-brand',
  ])(
    'does not create reserved orders when WMS prerequisite is %s',
    async (reason) => {
      const reviewed = requestRow({
        status: 'stock_confirmed',
        reviewedAt: new Date(),
      });
      reviewed.items[0].confirmedQuantity = 3 as never;
      db.b2bPurchaseRequest.findFirst.mockResolvedValue(reviewed);
      const product: any = {
        id: 'p1',
        type: 'SIMPLE',
        hasSerialNumbers: false,
        barcode: '471000000001',
      };
      if (reason === 'serial') product.hasSerialNumbers = true;
      if (reason === 'bundle') product.type = 'BUNDLE';
      if (reason === 'no-barcode') product.barcode = '';
      db.product.findMany.mockResolvedValue(
        reason === 'inactive' ? [] : [product],
      );
      if (reason === 'no-brand')
        process.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON = '{}';
      if (reason === 'invalid-json')
        process.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON = 'not-json';
      if (reason === 'numeric-brand')
        process.env.WMS_DISPATCH_PRODUCT_BRANDS_JSON = JSON.stringify({
          'entity-a': { p1: 7 },
        });
      await expect(
        service.confirm(
          requestId,
          {
            entityId: 'entity-a',
            warehouseId: 'warehouse-a',
            channelId: 'b2b-channel',
          },
          'staff',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(salesOrders.createSalesOrder).not.toHaveBeenCalled();
      expect(db.b2bPurchaseRequest.update).not.toHaveBeenCalled();
    },
  );
  it('requires an accepted formal quote before reserving stock', async () => {
    const reviewed = requestRow({ status: 'stock_confirmed', reviewedAt: new Date(), issuedQuotes: [] });
    reviewed.items[0].confirmedQuantity = 3 as never;
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(reviewed);
    await expect(service.confirm(requestId, {
      entityId: 'entity-a', warehouseId: 'warehouse-a', channelId: 'b2b-channel',
    }, 'staff')).rejects.toThrow('須先開立正式報價並取得客戶登入確認');
    expect(salesOrders.createSalesOrder).not.toHaveBeenCalled();
  });
  it('issues an immutable quotation from reviewed snapshot and replays identical terms', async () => {
    const reviewed = requestRow({ status: 'stock_confirmed', reviewedAt: new Date() });
    reviewed.items[0].confirmedQuantity = 3 as never;
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(reviewed);
    let createdQuotation: any;
    db.b2bIssuedQuote.findFirst.mockResolvedValueOnce(null).mockImplementation(async () => ({
      id: 'issued-q', requestId, quotationId: 'quotation-q', version: 1, status: 'sent',
      acceptedAt: null, quotation: createdQuotation,
    }));
    db.salesQuotation.create.mockImplementation(async ({ data }: any) => {
      createdQuotation = { ...data, id: 'quotation-q', items: data.items.create };
      return createdQuotation;
    });
    db.b2bIssuedQuote.create.mockResolvedValue({ id: 'issued-q', requestId,
      quotationId: 'quotation-q', version: 1, status: 'sent', acceptedAt: null });
    const input = { entityId: 'entity-a', validUntil: '2099-12-31',
      paymentTerms: '月結', deliveryTerms: '確認後出貨' };
    const first = await service.issueQuote(requestId, input, 'staff');
    expect(first).toMatchObject({ version: 1, status: 'sent', total: '31.53',
      quotePath: `/b2b/requests/${requestId}/quote/1` });
    expect(first.items[0]).toMatchObject({ quantity: 3, lineTotal: '30.03', taxAmount: '1.50' });
    expect(db.salesQuotation.create.mock.calls[0][0].data).toMatchObject({
      entityId: 'entity-a', customerId: 'customer-a', status: 'sent',
      subtotalOriginal: D('30.03'), taxAmountOriginal: D('1.50'), totalAmountOriginal: D('31.53'),
    });
    const retry = await service.issueQuote(requestId, input, 'staff');
    expect(retry.id).toBe(first.id);
    expect(db.salesQuotation.create).toHaveBeenCalledTimes(1);
    expect(db.inventoryTransaction.create).not.toHaveBeenCalled();
  });
  it('records customer acceptance only for the latest visible quote and scopes it to that customer', async () => {
    const reviewed = requestRow({ status: 'stock_confirmed', reviewedAt: new Date(),
      issuedQuotes: [{ id: 'issued-q', version: 1, status: 'sent' }] });
    reviewed.items[0].confirmedQuantity = 3 as never;
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(reviewed);
    const quotation = { id: 'quotation-q', quotationNo: 'B2B-QT',
      validUntil: new Date('2099-12-31T00:00:00Z'), paymentTerms: null,
      deliveryTerms: null, subtotalOriginal: D('30.03'), taxAmountOriginal: D('1.50'),
      totalAmountOriginal: D('31.53'), items: [{ taxAmountOriginal: D('1.50'), lineTotalOriginal: D('31.53') }] };
    db.b2bIssuedQuote.findFirst.mockResolvedValue({ id: 'issued-q', version: 1, status: 'sent',
      quotationId: 'quotation-q', acceptedAt: null, quotation });
    db.b2bIssuedQuote.update.mockResolvedValue({ id: 'issued-q', version: 1, status: 'accepted',
      quotationId: 'quotation-q', acceptedAt: new Date(), quotation });
    const accepted = await service.acceptQuote(identity, requestId, 1);
    expect(accepted.status).toBe('accepted');
    expect(db.b2bIssuedQuote.update.mock.calls[0][0].data.acceptedByAccountId).toBe('account-a');
    expect(db.salesQuotation.update).toHaveBeenCalledWith({ where: { id: 'quotation-q' }, data: { status: 'accepted' } });
    expect(salesOrders.createSalesOrder).not.toHaveBeenCalled();
    db.b2bPurchaseRequest.findFirst.mockResolvedValueOnce(null);
    await expect(service.formalQuote({ ...identity, customerId: 'customer-b' }, requestId, 1)).rejects.toThrow(NotFoundException);
  });
  it('accepts through the Taiwan expiry date and rejects at the next local midnight', async () => {
    const reviewed = requestRow({ status: 'stock_confirmed', reviewedAt: new Date(),
      issuedQuotes: [{ id: 'issued-q', version: 1, status: 'sent' }] });
    reviewed.items[0].confirmedQuantity = 3 as never;
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(reviewed);
    const quotation = { id: 'quotation-q', quotationNo: 'B2B-QT',
      validUntil: new Date('2030-03-20T00:00:00Z'), paymentTerms: null,
      deliveryTerms: null, subtotalOriginal: D('30.03'), taxAmountOriginal: D('1.50'),
      totalAmountOriginal: D('31.53'), items: [{ taxAmountOriginal: D('1.50'), lineTotalOriginal: D('31.53') }] };
    db.b2bIssuedQuote.findFirst.mockResolvedValue({ id: 'issued-q', version: 1, status: 'sent',
      quotationId: 'quotation-q', acceptedAt: null, quotation });
    db.b2bIssuedQuote.update.mockResolvedValue({ id: 'issued-q', version: 1, status: 'accepted',
      quotationId: 'quotation-q', acceptedAt: new Date(), quotation });
    const clock = jest.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(new Date('2030-03-20T15:59:59.999Z').getTime());
      expect((await service.acceptQuote(identity, requestId, 1)).status).toBe('accepted');
      clock.mockReturnValue(new Date('2030-03-20T16:00:00.000Z').getTime());
      await expect(service.acceptQuote(identity, requestId, 1)).rejects.toThrow('正式報價已逾有效期限');
      expect(db.b2bIssuedQuote.update).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('rejects accepting an older quote version after a replacement was issued', async () => {
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(requestRow({ status: 'stock_confirmed',
      issuedQuotes: [{ id: 'issued-v2', version: 2, status: 'sent' }] }));
    db.b2bIssuedQuote.findFirst.mockResolvedValue({ id: 'issued-v1', version: 1,
      status: 'superseded', quotationId: 'quotation-v1' });
    await expect(service.acceptQuote(identity, requestId, 1)).rejects.toThrow('此報價版本已失效');
    expect(db.b2bIssuedQuote.update).not.toHaveBeenCalled();
  });
  it('allows a shortage to be manually reviewed again while retaining review history', async () => {
    const short = requestRow({ status: 'needs_adjustment', reviewedAt: new Date() });
    short.items[0].confirmedQuantity = 1 as never;
    db.b2bPurchaseRequest.findFirst.mockResolvedValue(short);
    db.b2bPurchaseRequest.update.mockImplementation(async ({ data }: any) => ({
      ...short, ...data, items: short.items.map((item: any) => ({ ...item, confirmedQuantity: 3 })),
    }));
    const result = await service.review(requestId, { entityId: 'entity-a',
      items: [{ id: lineId, confirmedQuantity: 3 }], reviewNote: '收貨後重查' }, 'staff');
    expect(result.status).toBe('stock_confirmed');
    expect(db.b2bStockReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      requestId, reviewedBy: 'staff', resultStatus: 'stock_confirmed',
      confirmedQuantities: [{ requestItemId: lineId, confirmedQuantity: 3 }],
    }) });
  });
});
