import { Test, TestingModule } from '@nestjs/testing';
import { InvoicingService } from './invoicing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EcpayEinvoiceAdapter } from './adapters/ecpay-einvoice.adapter';

describe('InvoicingService', () => {
  let service: InvoicingService;
  let prismaService: PrismaService;
  let previousAllowLocalInvoiceStub: string | undefined;
  let previousNodeEnv: string | undefined;

  const mockPrismaService = {
    salesOrder: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    invoiceLine: {
      createMany: jest.fn(),
    },
    invoiceLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };
  const mockEcpayEinvoiceAdapter = {
    getReadiness: jest.fn(),
    assertReadyForMerchant: jest.fn(),
    issueInvoice: jest.fn(),
    queryInvoiceStatus: jest.fn(),
  };

  beforeEach(async () => {
    previousAllowLocalInvoiceStub = process.env.ALLOW_LOCAL_INVOICE_STUB;
    previousNodeEnv = process.env.NODE_ENV;
    process.env.ALLOW_LOCAL_INVOICE_STUB = 'true';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicingService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: EcpayEinvoiceAdapter,
          useValue: mockEcpayEinvoiceAdapter,
        },
      ],
    }).compile();

    service = module.get<InvoicingService>(InvoicingService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (previousAllowLocalInvoiceStub === undefined) {
      delete process.env.ALLOW_LOCAL_INVOICE_STUB;
    } else {
      process.env.ALLOW_LOCAL_INVOICE_STUB = previousAllowLocalInvoiceStub;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  /**
   * Test 1: 預覽發票
   */
  describe('previewInvoice', () => {
    it('應該正確計算發票金額、稅額和本位幣轉換', async () => {
      // Arrange
      const mockOrder = {
        id: 'order-123',
        entityId: 'entity-1',
        totalGrossOriginal: '1050.00',
        totalGrossCurrency: 'TWD',
        totalGrossFxRate: '1.0',
        hasInvoice: false,
        items: [
          {
            productId: 'product-1',
            qty: '2.00',
            unitPriceOriginal: '500.00',
            unitPriceCurrency: 'TWD',
            unitPriceFxRate: '1.0',
            product: { name: '測試商品' },
          },
        ],
        customer: { name: '測試客戶' },
      };

      mockPrismaService.salesOrder.findUnique.mockResolvedValue(mockOrder);

      // Act
      const result = await service.previewInvoice('order-123');

      // Assert
      expect(result.orderId).toBe('order-123');
      expect(result.currency).toBe('TWD');
      expect(parseFloat(result.amountOriginal)).toBeCloseTo(1000.0, 2); // 未稅金額
      expect(parseFloat(result.taxAmountOriginal)).toBeCloseTo(50.0, 2); // 5% 稅額
      expect(parseFloat(result.totalAmountOriginal)).toBeCloseTo(1050.0, 2); // 含稅總額
      expect(result.invoiceLines).toHaveLength(1);
      expect(result.invoiceLines[0].description).toBe('測試商品');
    });

    it('訂單不存在時應拋出 NotFoundException', async () => {
      mockPrismaService.salesOrder.findUnique.mockResolvedValue(null);

      await expect(service.previewInvoice('invalid-order')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  /**
   * Test 2: 開立發票
   */
  describe('issueInvoice', () => {
    it('應該正確寫入發票主表和明細表', async () => {
      // Arrange
      const mockOrder = {
        id: 'order-123',
        entityId: 'entity-1',
        totalGrossOriginal: '1050.00',
        totalGrossCurrency: 'TWD',
        totalGrossFxRate: '1.0',
        hasInvoice: false,
        items: [
          {
            productId: 'product-1',
            qty: '2.00',
            unitPriceOriginal: '500.00',
            unitPriceCurrency: 'TWD',
            unitPriceFxRate: '1.0',
            product: { name: '測試商品' },
          },
        ],
      };

      const mockInvoice = {
        id: 'invoice-123',
        invoiceNumber: 'AA12345678',
      };

      mockPrismaService.salesOrder.findUnique.mockResolvedValue(mockOrder);
      mockPrismaService.invoice.create.mockResolvedValue(mockInvoice);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      const dto = {
        invoiceType: 'B2C',
        buyerName: '測試客戶',
      };

      // Act
      const result = await service.issueInvoice('order-123', dto, 'user-1');

      // Assert
      expect(result.success).toBe(true);
      expect(result.invoiceNumber).toMatch(/^AA\d{8}$/);
      expect(mockPrismaService.invoice.create).toHaveBeenCalled();
      expect(mockPrismaService.invoiceLine.createMany).toHaveBeenCalled();
      expect(mockPrismaService.invoiceLog.create).toHaveBeenCalled();
      expect(mockPrismaService.salesOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: { hasInvoice: true, invoiceId: mockInvoice.id },
      });
    });

    it('訂單已開立發票時應拋出 ConflictException', async () => {
      const mockOrder = {
        id: 'order-123',
        hasInvoice: true,
      };

      mockPrismaService.salesOrder.findUnique.mockResolvedValue(mockOrder);

      const dto = { invoiceType: 'B2C' };

      await expect(
        service.issueInvoice('order-123', dto, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('再次開立發票時必須拋出錯誤', async () => {
      const mockOrder = {
        id: 'order-123',
        hasInvoice: true,
      };

      mockPrismaService.salesOrder.findUnique.mockResolvedValue(mockOrder);

      await expect(
        service.issueInvoice('order-123', { invoiceType: 'B2C' }, 'user-1'),
      ).rejects.toThrow('訂單已開立發票，不可重複開立');
    });
  });

  describe('formal invoice adjustment safeguards', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      delete process.env.ALLOW_LOCAL_INVOICE_STUB;
    });

    it('正式環境不可只在本地作廢發票', async () => {
      mockPrismaService.invoice.findUnique.mockResolvedValue({
        id: 'invoice-123',
        invoiceNumber: 'AA12345678',
        status: 'issued',
        orderId: null,
      });

      await expect(
        service.voidInvoice('invoice-123', '測試作廢', 'user-1'),
      ).rejects.toThrow('正式電子發票作廢尚未接上綠界電子發票 API');
      expect(mockPrismaService.invoice.update).not.toHaveBeenCalled();
    });

    it('正式環境不可只在本地建立折讓單', async () => {
      mockPrismaService.invoice.findUnique.mockResolvedValue({
        id: 'invoice-123',
        entityId: 'entity-1',
        orderId: 'order-123',
        invoiceNumber: 'AA12345678',
        status: 'issued',
        invoiceType: 'B2C',
        buyerName: '測試客戶',
        buyerTaxId: null,
        buyerEmail: 'customer@example.com',
        totalAmountOriginal: '1050.00',
        currency: 'TWD',
        fxRate: '1',
      });

      await expect(
        service.createAllowance('invoice-123', 100, '測試折讓', 'user-1'),
      ).rejects.toThrow('正式電子發票折讓尚未接上綠界電子發票 API');
      expect(mockPrismaService.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe('queryProviderStatus', () => {
    it('應該用 Invoice / SalesOrder metadata 查詢綠界狀態且不更新本地資料', async () => {
      mockPrismaService.invoice.findUnique.mockResolvedValue({
        id: 'invoice-123',
        invoiceNumber: 'AA12345678',
        status: 'issued',
        issuedAt: new Date('2026-04-01T00:00:00+08:00'),
        notes: null,
        externalPayload: null,
        salesOrder: {
          notes:
            '[ecpay-invoice-sync] invoiceDate=2026-04-01 09:30:00; merchantKey=groupbuy-main; merchantId=3150241',
          channel: { code: '1SHOP' },
        },
      });
      mockEcpayEinvoiceAdapter.queryInvoiceStatus.mockResolvedValue({
        success: true,
        provider: 'ecpay',
        merchantKey: 'groupbuy-main',
        merchantId: '3150241',
        invoiceNumber: 'AA12345678',
        invoiceDate: '2026-04-01',
        invoiceIssuedStatus: 'issued',
        rawMessage: '成功',
        raw: { RtnCode: 1, RtnMsg: '成功' },
      });

      const result = await service.queryProviderStatus('invoice-123');

      expect(mockEcpayEinvoiceAdapter.queryInvoiceStatus).toHaveBeenCalledWith({
        merchantKey: 'groupbuy-main',
        merchantId: '3150241',
        invoiceNumber: 'AA12345678',
        invoiceDate: '2026-04-01',
      });
      expect(result.providerStatus).toBe('issued');
      expect(mockPrismaService.invoice.update).not.toHaveBeenCalled();
    });

    it('缺少商店代號時不呼叫綠界並回報原因', async () => {
      mockPrismaService.invoice.findUnique.mockResolvedValue({
        id: 'invoice-123',
        invoiceNumber: 'AA12345678',
        status: 'issued',
        issuedAt: new Date('2026-04-01T00:00:00+08:00'),
        notes: null,
        externalPayload: null,
        salesOrder: {
          notes: null,
          channel: { code: 'UNKNOWN' },
        },
      });

      await expect(service.queryProviderStatus('invoice-123')).rejects.toThrow(
        '找不到可查詢綠界狀態的商店代號',
      );
      expect(mockEcpayEinvoiceAdapter.queryInvoiceStatus).not.toHaveBeenCalled();
    });
  });

  describe('getProviderStatusReadiness', () => {
    it('應該盤點可查詢與缺欄位的發票，不呼叫綠界', async () => {
      mockPrismaService.invoice.findMany.mockResolvedValue([
        {
          id: 'invoice-ready',
          orderId: 'order-1',
          invoiceNumber: 'AA12345678',
          status: 'issued',
          issuedAt: new Date('2026-04-01T00:00:00+08:00'),
          createdAt: new Date('2026-04-01T00:00:00+08:00'),
          notes: null,
          externalPayload: {
            merchantKey: 'shopify-main',
            merchantId: '3290494',
            invoiceDate: '2026-04-01 09:30:00',
          },
          salesOrder: {
            id: 'order-1',
            externalOrderId: 'S1001',
            orderDate: new Date('2026-04-01T00:00:00+08:00'),
            notes: null,
            channel: { code: 'SHOPIFY', name: 'Shopify' },
          },
        },
        {
          id: 'invoice-missing',
          orderId: 'order-2',
          invoiceNumber: 'BB12345678',
          status: 'issued',
          issuedAt: null,
          createdAt: new Date('2026-04-01T00:00:00+08:00'),
          notes: null,
          externalPayload: null,
          salesOrder: {
            id: 'order-2',
            externalOrderId: 'M1001',
            orderDate: new Date('2026-04-01T00:00:00+08:00'),
            notes: null,
            channel: { code: 'UNKNOWN', name: 'Unknown' },
          },
        },
      ]);

      const result = await service.getProviderStatusReadiness('tw-entity-001', {
        limit: 25,
        status: 'issued',
      });

      expect(mockPrismaService.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            entityId: 'tw-entity-001',
            status: 'issued',
          },
          take: 25,
        }),
      );
      expect(result.summary.readyCount).toBe(1);
      expect(result.summary.notReadyCount).toBe(1);
      expect(result.summary.missingCounts.invoiceDate).toBe(1);
      expect(result.summary.missingCounts.merchantKeyOrMerchantId).toBe(1);
      expect(result.items[0].queryReady).toBe(true);
      expect(result.items[0].invoiceDate).toBe('2026-04-01');
      expect(result.items[1].queryReady).toBe(false);
      expect(mockEcpayEinvoiceAdapter.queryInvoiceStatus).not.toHaveBeenCalled();
    });
  });
});
