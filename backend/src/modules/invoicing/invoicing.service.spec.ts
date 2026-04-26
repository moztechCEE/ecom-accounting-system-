import { Test, TestingModule } from '@nestjs/testing';
import { InvoicingService } from './invoicing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EcpayEinvoiceAdapter } from './adapters/ecpay-einvoice.adapter';

describe('InvoicingService', () => {
  let service: InvoicingService;
  let prismaService: PrismaService;
  let previousAllowLocalInvoiceStub: string | undefined;

  const mockPrismaService = {
    salesOrder: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
      findUnique: jest.fn(),
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

  beforeEach(async () => {
    previousAllowLocalInvoiceStub = process.env.ALLOW_LOCAL_INVOICE_STUB;
    process.env.ALLOW_LOCAL_INVOICE_STUB = 'true';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicingService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: EcpayEinvoiceAdapter,
          useValue: {
            getReadiness: jest.fn(),
            assertReadyForMerchant: jest.fn(),
            issueInvoice: jest.fn(),
          },
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
});
