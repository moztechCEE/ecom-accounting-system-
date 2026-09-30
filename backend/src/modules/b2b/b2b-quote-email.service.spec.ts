import {
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { B2bService } from './b2b.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const requestId = '00000000-0000-4000-8000-000000000001';
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const input = {
  entityId: 'entity',
  recipientEmail: ' BUYER@EXAMPLE.TEST ',
  verificationReason: 'Confirmed customer master by staff',
};

function fixture() {
  const quotation: any = {
    id: 'quotation',
    entityId: 'entity',
    customerId: 'customer',
    quotationNo: 'B2B-QT-1',
    quotationDate: new Date(),
    validUntil: new Date('2099-12-31T00:00:00Z'),
    currency: 'TWD',
    status: 'pending',
    paymentTerms: null,
    deliveryTerms: null,
    subtotalOriginal: D(100),
    discountAmountOriginal: D(0),
    taxAmountOriginal: D(5),
    totalAmountOriginal: D(105),
    items: [
      {
        productId: 'product',
        itemName: 'Product',
        itemSpec: 'SKU',
        quantity: D(1),
        unitPriceOriginal: D(100),
        discountOriginal: D(0),
        taxRate: D(5),
        taxAmountOriginal: D(5),
        lineTotalOriginal: D(105),
      },
    ],
  };
  const issued: any = {
    id: 'issued',
    requestId,
    quotationId: quotation.id,
    quotation,
    version: 1,
    status: 'delivery_pending',
    acceptedAt: null,
    acceptedByAccountId: null,
    acceptedByEmail: null,
    sellerName: 'Corely',
    sellerTaxId: '12345678',
    buyerName: 'Customer',
    buyerTaxId: '87654321',
    deliveryDate: null,
    withdrawnAt: null,
    withdrawalReason: null,
  };
  const purchase: any = {
    id: requestId,
    entityId: 'entity',
    customerId: 'customer',
    sourceKind: 'GUEST',
    requestNumber: 'B2B-REQ-1',
    customerPoNumber: null,
    currency: 'TWD',
    status: 'stock_confirmed',
    reviewedAt: new Date(),
    salesOrderId: null,
    issuedQuotes: [
      {
        id: issued.id,
        version: 1,
        status: issued.status,
        acceptedAt: null,
        acceptedByAccountId: null,
        acceptedByEmail: null,
      },
    ],
    items: [
      {
        id: 'line',
        productId: 'product',
        sku: 'SKU',
        name: 'Product',
        quantity: 1,
        confirmedQuantity: 1,
        unitPrice: D(100),
        lineTotal: D(100),
      },
    ],
  };
  const customer: any = { email: 'buyer@example.test', statementEmail: null };
  let access: any = null;
  const mail = {
    assertConfigured: jest.fn(),
    send: jest.fn().mockResolvedValue(undefined),
  };
  const salesOrders = { createSalesOrder: jest.fn() };
  const db: any = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (fn: any) => fn(db)),
    b2bPurchaseRequest: { findFirst: jest.fn(async () => purchase) },
    customer: { findFirst: jest.fn(async () => customer) },
    b2bIssuedQuote: {
      findFirst: jest.fn(async () => issued),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(issued, data);
        Object.assign(purchase.issuedQuotes[0], data);
        return issued;
      }),
    },
    b2bQuoteEmailAccess: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (
          !access ||
          (where.issuedQuoteId &&
            access.issuedQuoteId !== where.issuedQuoteId) ||
          (where.id && access.id !== where.id) ||
          (where.tokenHash && access.tokenHash !== where.tokenHash)
        )
          return null;
        return { ...access, issuedQuote: issued };
      }),
      upsert: jest.fn(async ({ create, update }: any) => {
        access = access
          ? { ...access, ...update }
          : { id: 'access', ...create };
        return access;
      }),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(access, data);
        return access;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (
          access?.id === where.id &&
          access.attemptId === where.attemptId &&
          access.sendState === where.sendState
        ) {
          Object.assign(access, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    salesQuotation: {
      update: jest.fn(async ({ data }: any) => {
        Object.assign(quotation, data);
        return quotation;
      }),
    },
    auditLog: { create: jest.fn() },
  };
  const service = new B2bService(db, salesOrders as any, mail as any);
  return {
    service,
    db,
    mail,
    salesOrders,
    issued,
    quotation,
    purchase,
    customer,
    get access() {
      return access;
    },
  };
}

describe('guest private quote email', () => {
  const original = process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED;
  beforeEach(() => {
    process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED = 'true';
  });
  afterAll(() => {
    if (original === undefined)
      delete process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED;
    else process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED = original;
  });

  it('fails closed when disabled, with no database or mail activity', async () => {
    const f = fixture();
    delete process.env.B2B_PRIVATE_QUOTE_EMAIL_ENABLED;
    await expect(
      f.service.emailGuestQuote(requestId, 1, input, 'staff'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(f.db.b2bPurchaseRequest.findFirst).not.toHaveBeenCalled();
    expect(f.mail.send).not.toHaveBeenCalled();
  });

  it('requires the current customer master email, not guest-submitted or arbitrary address', async () => {
    const f = fixture();
    await expect(
      f.service.emailGuestQuote(
        requestId,
        1,
        { ...input, recipientEmail: 'other@example.test' },
        'staff',
      ),
    ).rejects.toThrow('客戶主檔');
    expect(f.mail.send).not.toHaveBeenCalled();
    expect(f.db.b2bQuoteEmailAccess.upsert).not.toHaveBeenCalled();
  });

  it('records SMTP handoff before unlocking the quote, hashes the token, and accepts once', async () => {
    const f = fixture();
    const sent = await f.service.emailGuestQuote(requestId, 1, input, 'staff');
    const token = f.mail.send.mock.calls[0][0].token;
    expect(sent).toMatchObject({
      deliveryStatus: 'sent',
      recipientEmail: 'buyer@example.test',
    });
    expect(JSON.stringify(sent)).not.toContain(token);
    expect(f.access.tokenHash).toBe(tokenHash(token));
    expect(JSON.stringify(f.access)).not.toContain(token);
    expect(
      f.access.expiresAt.getTime() - f.access.verifiedAt.getTime(),
    ).toBeLessThanOrEqual(86_400_000);
    expect(f.issued.status).toBe('sent');
    expect(f.quotation.status).toBe('sent');
    expect((await f.service.previewEmailQuote({ token })).status).toBe('sent');
    const accepted = await f.service.acceptEmailQuote({ token });
    expect(accepted).toMatchObject({
      status: 'accepted',
      quotePath: '/b2b/private-quote',
    });
    expect(f.issued.acceptedByEmail).toBe('buyer@example.test');
    expect(f.access.consumedAt).toBeInstanceOf(Date);
    expect((await f.service.acceptEmailQuote({ token })).status).toBe(
      'accepted',
    );
    expect(f.db.b2bIssuedQuote.update).toHaveBeenCalledTimes(2);
    expect(f.salesOrders.createSalesOrder).not.toHaveBeenCalled();
    expect(
      f.db.auditLog.create.mock.calls.some(
        ([args]: any[]) => args.data.action === 'ACCEPT_BY_VERIFIED_EMAIL',
      ),
    ).toBe(true);
    expect(JSON.stringify(f.db.auditLog.create.mock.calls)).not.toContain(
      token,
    );
  });

  it('keeps failed delivery pending and rotates the token for a safe retry', async () => {
    const f = fixture();
    f.mail.send.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(
      f.service.emailGuestQuote(requestId, 1, input, 'staff'),
    ).rejects.toThrow(ServiceUnavailableException);
    const oldToken = f.mail.send.mock.calls[0][0].token;
    expect(f.issued.status).toBe('delivery_pending');
    expect(f.access.sendState).toBe('FAILED');
    expect(f.access.revokedAt).toBeInstanceOf(Date);
    await expect(
      f.service.previewEmailQuote({ token: oldToken }),
    ).rejects.toThrow(NotFoundException);
    await f.service.emailGuestQuote(requestId, 1, input, 'staff');
    const nextToken = f.mail.send.mock.calls[1][0].token;
    expect(nextToken).not.toBe(oldToken);
    await expect(
      f.service.previewEmailQuote({ token: oldToken }),
    ).rejects.toThrow(NotFoundException);
    expect(
      (await f.service.previewEmailQuote({ token: nextToken })).status,
    ).toBe('sent');
    await f.service.emailGuestQuote(requestId, 1, input, 'staff');
    expect(f.mail.send).toHaveBeenCalledTimes(2);
  });

  it('rejects revoked, expired, older-version, and changed-master-email links', async () => {
    const f = fixture();
    await f.service.emailGuestQuote(requestId, 1, input, 'staff');
    const token = f.mail.send.mock.calls[0][0].token;
    f.access.revokedAt = new Date();
    await expect(f.service.previewEmailQuote({ token })).rejects.toThrow(
      NotFoundException,
    );
    f.access.revokedAt = null;
    f.access.expiresAt = new Date(0);
    await expect(f.service.previewEmailQuote({ token })).rejects.toThrow(
      NotFoundException,
    );
    f.access.expiresAt = new Date(Date.now() + 3600000);
    f.purchase.issuedQuotes[0].id = 'new-version';
    await expect(f.service.previewEmailQuote({ token })).rejects.toThrow(
      NotFoundException,
    );
    f.purchase.issuedQuotes[0].id = f.issued.id;
    f.customer.email = 'new@example.test';
    await expect(f.service.previewEmailQuote({ token })).rejects.toThrow(
      NotFoundException,
    );
    await expect(f.service.acceptEmailQuote({ token })).rejects.toThrow(
      NotFoundException,
    );
    expect(f.salesOrders.createSalesOrder).not.toHaveBeenCalled();
  });
});
