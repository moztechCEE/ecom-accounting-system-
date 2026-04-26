// @ts-nocheck
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PreviewInvoiceDto } from './dto/preview-invoice.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EcpayEinvoiceAdapter } from './adapters/ecpay-einvoice.adapter';

/**
 * InvoicingService
 *
 * 電子發票服務（實戰版）
 *
 * 功能：
 * 1. 從訂單預覽發票內容
 * 2. 開立正式發票並寫入資料庫
 * 3. 發票作廢
 * 4. 開立折讓單
 * 5. 查詢發票狀態
 */
@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ecpayEinvoiceAdapter: EcpayEinvoiceAdapter,
  ) {}

  getInvoiceProviderReadiness() {
    return this.ecpayEinvoiceAdapter.getReadiness();
  }

  /**
   * 預覽某訂單的發票內容
   *
   * @param orderId - 訂單ID
   * @returns 發票預覽資料
   */
  async previewInvoice(orderId: string) {
    this.logger.log(`預覽發票 - 訂單ID: ${orderId}`);

    // 查詢訂單及明細
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        customer: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`訂單不存在: ${orderId}`);
    }

    // 計算未稅金額（假設含稅總額，稅率 5%）
    const taxRate = new Decimal(0.05);
    const totalAmountOriginal = new Decimal(order.totalGrossOriginal);
    const amountOriginal = totalAmountOriginal.div(
      new Decimal(1).plus(taxRate),
    );
    const taxAmountOriginal = totalAmountOriginal.minus(amountOriginal);

    // 本位幣換算
    const fxRate = new Decimal(order.totalGrossFxRate);
    const amountBase = amountOriginal.mul(fxRate);
    const taxAmountBase = taxAmountOriginal.mul(fxRate);
    const totalAmountBase = amountBase.plus(taxAmountBase);

    // 建立發票明細
    const invoiceLines = order.items.map((item) => {
      const itemAmountOriginal = new Decimal(item.unitPriceOriginal).mul(
        new Decimal(item.qty),
      );
      const itemTaxAmountOriginal = itemAmountOriginal.mul(taxRate);
      const itemAmountBase = itemAmountOriginal.mul(
        new Decimal(item.unitPriceFxRate),
      );
      const itemTaxAmountBase = itemTaxAmountOriginal.mul(
        new Decimal(item.unitPriceFxRate),
      );

      return {
        productId: item.productId,
        description: item.product?.name || '商品',
        qty: new Decimal(item.qty).toNumber(),
        unitPriceOriginal: new Decimal(item.unitPriceOriginal).toNumber(),
        currency: item.unitPriceCurrency,
        amountOriginal: itemAmountOriginal.toFixed(2),
        taxAmountOriginal: itemTaxAmountOriginal.toFixed(2),
      };
    });

    return {
      orderId: order.id,
      invoiceType: 'B2C',
      buyerName: order.customer?.name || '散客',
      buyerTaxId: null,
      currency: order.totalGrossCurrency,
      fxRate: fxRate.toNumber(),
      amountOriginal: amountOriginal.toFixed(2),
      taxAmountOriginal: taxAmountOriginal.toFixed(2),
      totalAmountOriginal: totalAmountOriginal.toFixed(2),
      amountBase: amountBase.toFixed(2),
      taxAmountBase: taxAmountBase.toFixed(2),
      totalAmountBase: totalAmountBase.toFixed(2),
      invoiceLines,
      estimatedInvoiceNumber: this.generateInvoiceNumber(),
      warnings: order.hasInvoice ? ['此訂單已開立過發票'] : [],
    };
  }

  /**
   * 開立正式發票
   *
   * @param orderId - 訂單ID
   * @param dto - 開立發票DTO
   * @param userId - 操作人員ID
   * @returns 發票資料
   */
  async issueInvoice(orderId: string, dto: IssueInvoiceDto, userId: string) {
    this.logger.log(`開立發票 - 訂單ID: ${orderId}, 操作人員: ${userId}`);

    // 1. 查詢訂單
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        channel: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`訂單不存在: ${orderId}`);
    }

    if (order.hasInvoice) {
      throw new ConflictException(`訂單已開立發票，不可重複開立`);
    }

    // 2. 計算發票金額
    const taxRate = new Decimal(0.05);
    const totalAmountOriginal = new Decimal(order.totalGrossOriginal);
    const amountOriginal = totalAmountOriginal.div(
      new Decimal(1).plus(taxRate),
    );
    const taxAmountOriginal = totalAmountOriginal.minus(amountOriginal);
    const fxRate = new Decimal(order.totalGrossFxRate);
    const currency = order.totalGrossCurrency;

    const amountBase = amountOriginal.mul(fxRate);
    const taxAmountBase = taxAmountOriginal.mul(fxRate);
    const totalAmountBase = totalAmountOriginal.mul(fxRate);

    const localStubAllowed = this.isLocalInvoiceStubAllowed();
    const merchantKey =
      dto.merchantKey || this.inferEcpayMerchantKey(order.channel?.code);
    const ecpayResult = localStubAllowed
      ? null
      : await this.ecpayEinvoiceAdapter.issueInvoice({
          merchantKey,
          merchantId: dto.merchantId,
          relateNumber: order.externalOrderId || order.id,
          invoiceType: (dto.invoiceType || 'B2C') as 'B2C' | 'B2B',
          buyerName: dto.buyerName || null,
          buyerTaxId: dto.buyerTaxId || null,
          buyerEmail: dto.buyerEmail || null,
          buyerPhone: dto.buyerPhone || null,
          buyerAddress: dto.buyerAddress || null,
          amount: Number(amountOriginal.toFixed(0)),
          taxAmount: Number(taxAmountOriginal.toFixed(0)),
          totalAmount: Number(totalAmountOriginal.toFixed(0)),
          items: order.items.map((item) => {
            const qty = new Decimal(item.qty).toNumber();
            const unitPrice = new Decimal(item.unitPriceOriginal).toNumber();
            return {
              name: item.product?.name || '商品',
              quantity: qty,
              unitPrice,
              amount: Number(
                new Decimal(item.unitPriceOriginal).mul(item.qty).toFixed(0),
              ),
              taxAmount: Number(
                new Decimal(item.taxAmountOriginal || 0).toFixed(0),
              ),
            };
          }),
        });

    // 3. 取得正式綠界發票號碼，測試環境才允許產生本地 stub 字軌
    const invoiceNumber =
      ecpayResult?.invoiceNumber || this.generateInvoiceNumber();

    // 4. 使用 Transaction 寫入發票資料
    const invoice = await this.prisma.$transaction(async (tx) => {
      // 建立發票主表
      const newInvoice = await tx.invoice.create({
        data: {
          entityId: order.entityId,
          orderId: order.id,
          invoiceNumber,
          status: 'issued',
          invoiceType: dto.invoiceType || 'B2C',
          issuedAt: new Date(),
          buyerName: dto.buyerName || null,
          buyerTaxId: dto.buyerTaxId || null,
          buyerEmail: dto.buyerEmail || null,
          buyerPhone: dto.buyerPhone || null,
          buyerAddress: dto.buyerAddress || null,
          amountOriginal,
          currency,
          fxRate,
          amountBase,
          taxAmountOriginal,
          taxAmountCurrency: currency,
          taxAmountFxRate: fxRate,
          taxAmountBase,
          totalAmountOriginal,
          totalAmountCurrency: currency,
          totalAmountFxRate: fxRate,
          totalAmountBase,
          externalInvoiceId: ecpayResult?.externalInvoiceId || null,
          externalPlatform: ecpayResult ? 'ecpay' : null,
          externalPayload: ecpayResult
            ? {
                provider: ecpayResult.provider,
                merchantKey: ecpayResult.merchantKey,
                merchantId: ecpayResult.merchantId,
                randomNumber: ecpayResult.randomNumber,
                invoiceDate: ecpayResult.invoiceDate,
                raw: ecpayResult.raw,
              }
            : null,
          notes: dto.notes || null,
        },
      });

      // 建立發票明細
      const invoiceLineData = order.items.map((item) => {
        const itemQty = new Decimal(item.qty);
        const itemUnitPriceOriginal = new Decimal(item.unitPriceOriginal);
        const itemAmountOriginal = itemUnitPriceOriginal.mul(itemQty);
        const itemTaxAmountOriginal = itemAmountOriginal.mul(taxRate);
        const itemFxRate = new Decimal(item.unitPriceFxRate);

        return {
          invoiceId: newInvoice.id,
          productId: item.productId,
          description: item.product?.name || '商品',
          qty: itemQty,
          unitPriceOriginal: itemUnitPriceOriginal,
          unitPriceCurrency: item.unitPriceCurrency,
          unitPriceFxRate: itemFxRate,
          unitPriceBase: itemUnitPriceOriginal.mul(itemFxRate),
          amountOriginal: itemAmountOriginal,
          currency: item.unitPriceCurrency,
          fxRate: itemFxRate,
          amountBase: itemAmountOriginal.mul(itemFxRate),
          taxAmountOriginal: itemTaxAmountOriginal,
          taxAmountCurrency: item.unitPriceCurrency,
          taxAmountFxRate: itemFxRate,
          taxAmountBase: itemTaxAmountOriginal.mul(itemFxRate),
        };
      });

      await tx.invoiceLine.createMany({
        data: invoiceLineData,
      });

      // 記錄發票操作日誌
      await tx.invoiceLog.create({
        data: {
          invoiceId: newInvoice.id,
          action: 'issue',
          userId,
          payload: {
            dto,
            invoiceNumber,
            orderId,
            providerResult: ecpayResult,
          },
        },
      });

      // 更新訂單狀態
      await tx.salesOrder.update({
        where: { id: orderId },
        data: {
          hasInvoice: true,
          invoiceId: newInvoice.id,
        },
      });

      return newInvoice;
    });

    this.logger.log(`發票開立成功: ${invoice.invoiceNumber}`);

    return {
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      provider:
        ecpayResult?.provider || (localStubAllowed ? 'local-stub' : null),
      merchantKey: ecpayResult?.merchantKey || merchantKey || null,
      totalAmount: totalAmountOriginal.toFixed(2),
      currency,
    };
  }

  /**
   * 作廢發票
   *
   * @param invoiceId - 發票ID
   * @param reason - 作廢原因
   * @param userId - 操作人員ID
   */
  async voidInvoice(invoiceId: string, reason: string, userId: string) {
    this.logger.log(`作廢發票 - 發票ID: ${invoiceId}, 操作人員: ${userId}`);

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException(`發票不存在: ${invoiceId}`);
    }

    if (invoice.status === 'void') {
      throw new BadRequestException(`發票已作廢，不可重複作廢`);
    }

    if (invoice.status !== 'issued') {
      throw new BadRequestException(`只能作廢已開立的發票`);
    }

    await this.prisma.$transaction(async (tx) => {
      // 更新發票狀態
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'void',
          voidAt: new Date(),
          voidReason: reason,
        },
      });

      // 記錄操作日誌
      await tx.invoiceLog.create({
        data: {
          invoiceId,
          action: 'void',
          userId,
          payload: { reason },
        },
      });

      // 取消訂單的發票標記
      if (invoice.orderId) {
        await tx.salesOrder.update({
          where: { id: invoice.orderId },
          data: {
            hasInvoice: false,
            invoiceId: null,
          },
        });
      }
    });

    this.logger.log(`發票作廢成功: ${invoice.invoiceNumber}`);

    return {
      success: true,
      invoiceNumber: invoice.invoiceNumber,
      voidAt: new Date(),
    };
  }

  /**
   * 開立折讓單
   *
   * @param invoiceId - 原發票ID
   * @param allowanceAmount - 折讓金額
   * @param reason - 折讓原因
   * @param userId - 操作人員ID
   */
  async createAllowance(
    invoiceId: string,
    allowanceAmount: number,
    reason: string,
    userId: string,
  ) {
    this.logger.log(`開立折讓單 - 發票ID: ${invoiceId}, 操作人員: ${userId}`);

    const originalInvoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!originalInvoice) {
      throw new NotFoundException(`發票不存在: ${invoiceId}`);
    }

    if (originalInvoice.status !== 'issued') {
      throw new BadRequestException(`只能對已開立的發票開立折讓單`);
    }

    const allowanceAmountDecimal = new Decimal(allowanceAmount);
    if (allowanceAmountDecimal.lte(0)) {
      throw new BadRequestException(`折讓金額必須大於 0`);
    }

    if (
      allowanceAmountDecimal.gte(
        new Decimal(originalInvoice.totalAmountOriginal),
      )
    ) {
      throw new BadRequestException(`折讓金額不能大於原發票金額`);
    }

    // 建立負項發票（折讓單）
    const allowanceInvoiceNumber = `${originalInvoice.invoiceNumber}-AL-${Date.now().toString().slice(-6)}`;

    const allowanceInvoice = await this.prisma.$transaction(async (tx) => {
      const newAllowance = await tx.invoice.create({
        data: {
          entityId: originalInvoice.entityId,
          orderId: originalInvoice.orderId,
          invoiceNumber: allowanceInvoiceNumber,
          status: 'issued',
          invoiceType: originalInvoice.invoiceType,
          issuedAt: new Date(),
          buyerName: originalInvoice.buyerName,
          buyerTaxId: originalInvoice.buyerTaxId,
          buyerEmail: originalInvoice.buyerEmail,
          amountOriginal: allowanceAmountDecimal.neg(),
          currency: originalInvoice.currency,
          fxRate: originalInvoice.fxRate,
          amountBase: allowanceAmountDecimal
            .mul(new Decimal(originalInvoice.fxRate))
            .neg(),
          taxAmountOriginal: new Decimal(0),
          taxAmountCurrency: originalInvoice.currency,
          taxAmountFxRate: originalInvoice.fxRate,
          taxAmountBase: new Decimal(0),
          totalAmountOriginal: allowanceAmountDecimal.neg(),
          totalAmountCurrency: originalInvoice.currency,
          totalAmountFxRate: originalInvoice.fxRate,
          totalAmountBase: allowanceAmountDecimal
            .mul(new Decimal(originalInvoice.fxRate))
            .neg(),
          notes: `折讓單：${reason}`,
        },
      });

      // 記錄操作日誌
      await tx.invoiceLog.create({
        data: {
          invoiceId: originalInvoice.id,
          action: 'allowance',
          userId,
          payload: {
            allowanceInvoiceId: newAllowance.id,
            allowanceInvoiceNumber: newAllowance.invoiceNumber,
            allowanceAmount,
            reason,
          },
        },
      });

      return newAllowance;
    });

    this.logger.log(`折讓單開立成功: ${allowanceInvoice.invoiceNumber}`);

    return {
      success: true,
      allowanceInvoiceNumber: allowanceInvoice.invoiceNumber,
      allowanceAmount,
      originalInvoiceNumber: originalInvoice.invoiceNumber,
    };
  }

  /**
   * 查詢訂單的發票狀態
   *
   * @param orderId - 訂單ID
   * @returns 發票資料
   */
  async getInvoiceByOrderId(orderId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { orderId },
      include: {
        invoiceLines: {
          include: {
            product: true,
          },
        },
        invoiceLogs: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return invoices;
  }

  async getInvoiceQueue(
    entityId: string,
    options?: {
      limit?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    const normalizedLimit = Math.min(
      Math.max(Math.floor(options?.limit || 12), 5),
      50,
    );
    const orderDate =
      options?.startDate || options?.endDate
        ? {
            ...(options?.startDate ? { gte: options.startDate } : {}),
            ...(options?.endDate ? { lte: options.endDate } : {}),
          }
        : undefined;

    const [orders, issuedAgg, voidAgg] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: {
          entityId,
          status: {
            notIn: ['cancelled', 'refunded'],
          },
          ...(orderDate ? { orderDate } : {}),
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          channel: {
            select: {
              code: true,
              name: true,
            },
          },
          payments: {
            orderBy: {
              payoutDate: 'desc',
            },
            select: {
              id: true,
              payoutDate: true,
              status: true,
              reconciledFlag: true,
              amountNetOriginal: true,
              notes: true,
            },
          },
          invoices: {
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              issuedAt: true,
            },
          },
        },
        orderBy: {
          orderDate: 'desc',
        },
        take: normalizedLimit * 4,
      }),
      this.prisma.invoice.aggregate({
        where: {
          entityId,
          status: 'issued',
          ...(orderDate ? { issuedAt: orderDate } : {}),
        },
        _count: {
          id: true,
        },
        _sum: {
          totalAmountOriginal: true,
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          entityId,
          status: 'void',
          ...(orderDate ? { issuedAt: orderDate } : {}),
        },
        _count: {
          id: true,
        },
      }),
    ]);

    const items = orders
      .map((order) => {
        const latestPayment = order.payments[0] || null;
        const latestInvoice = order.invoices[0] || null;
        const paymentCompleted = order.payments.some((payment) =>
          ['completed', 'success'].includes(
            (payment.status || '').toLowerCase(),
          ),
        );
        const reconciled = order.payments.some(
          (payment) => payment.reconciledFlag,
        );
        const journalLinked = order.payments.some((payment) =>
          (payment.notes || '').includes('journalEntryId='),
        );
        const latestPaymentStatus =
          latestPayment?.status?.toLowerCase() || 'pending';
        const invoiceStatus = order.hasInvoice
          ? 'completed'
          : paymentCompleted || reconciled
            ? 'eligible'
            : 'waiting_payment';
        const reason = order.hasInvoice
          ? '訂單已開立正式發票'
          : paymentCompleted || reconciled
            ? '已付款或已對帳，可進入批次開票'
            : '尚未完成付款或撥款對帳，暫不建議開立';

        return {
          orderId: order.id,
          externalOrderId: order.externalOrderId || null,
          orderDate: order.orderDate.toISOString(),
          channelCode: order.channel?.code || null,
          channelName: order.channel?.name || null,
          customerName: order.customer?.name || '散客',
          customerEmail: order.customer?.email || null,
          totalAmount: Number(order.totalGrossOriginal || 0),
          paymentStatus: latestPaymentStatus,
          paymentDate: latestPayment?.payoutDate?.toISOString() || null,
          reconciledFlag: reconciled,
          journalLinked,
          invoiceStatus,
          invoiceNumber: latestInvoice?.invoiceNumber || null,
          invoiceIssuedAt: latestInvoice?.issuedAt?.toISOString() || null,
          reason,
          daysSinceOrder: Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(order.orderDate).getTime()) /
                (24 * 60 * 60 * 1000),
            ),
          ),
        };
      })
      .sort((left, right) => {
        const score = (status: string) =>
          status === 'eligible' ? 0 : status === 'waiting_payment' ? 1 : 2;
        const scoreDiff =
          score(left.invoiceStatus) - score(right.invoiceStatus);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return right.daysSinceOrder - left.daysSinceOrder;
      });

    const limitedItems = items.slice(0, normalizedLimit);
    const eligibleItems = items.filter(
      (item) => item.invoiceStatus === 'eligible',
    );
    const waitingItems = items.filter(
      (item) => item.invoiceStatus === 'waiting_payment',
    );
    const completedItems = items.filter(
      (item) => item.invoiceStatus === 'completed',
    );

    return {
      entityId,
      range: {
        startDate: options?.startDate?.toISOString() || null,
        endDate: options?.endDate?.toISOString() || null,
      },
      summary: {
        issuedCount: Number(issuedAgg._count.id || 0),
        issuedAmount: Number(issuedAgg._sum.totalAmountOriginal || 0),
        voidCount: Number(voidAgg._count.id || 0),
        pendingCount: items.filter((item) => item.invoiceStatus !== 'completed')
          .length,
        eligibleCount: eligibleItems.length,
        waitingPaymentCount: waitingItems.length,
        completedOrderCount: completedItems.length,
      },
      items: limitedItems,
    };
  }

  async issueEligibleInvoices(
    entityId: string,
    userId: string,
    options?: {
      limit?: number;
      startDate?: Date;
      endDate?: Date;
      invoiceType?: string;
      merchantKey?: string;
      merchantId?: string;
    },
  ) {
    this.assertInvoiceIssuingAvailable(options?.merchantKey);

    const queue = await this.getInvoiceQueue(entityId, options);
    const targets = queue.items.filter(
      (item) => item.invoiceStatus === 'eligible',
    );
    const issued: Array<{
      orderId: string;
      invoiceId: string;
      invoiceNumber: string;
    }> = [];
    const failed: Array<{
      orderId: string;
      externalOrderId: string | null;
      reason: string;
    }> = [];

    for (const item of targets) {
      try {
        const result = await this.issueInvoice(
          item.orderId,
          {
            invoiceType: options?.invoiceType || 'B2C',
            buyerName: item.customerName || undefined,
            buyerEmail: item.customerEmail || undefined,
            merchantKey: options?.merchantKey,
            merchantId: options?.merchantId,
          },
          userId,
        );
        issued.push({
          orderId: item.orderId,
          invoiceId: result.invoiceId,
          invoiceNumber: result.invoiceNumber,
        });
      } catch (error: any) {
        failed.push({
          orderId: item.orderId,
          externalOrderId: item.externalOrderId,
          reason: error?.message || '批次開票失敗',
        });
      }
    }

    return {
      success: failed.length === 0,
      scannedCount: queue.items.length,
      eligibleCount: targets.length,
      issuedCount: issued.length,
      failedCount: failed.length,
      issued,
      failed,
    };
  }

  /**
   * 產生發票號碼（簡化版）
   * TODO: 實作完整的發票字軌管理
   */
  private generateInvoiceNumber(): string {
    const prefix = 'AA'; // 字軌（每兩個月更換）
    const sequence = Math.floor(Math.random() * 90000000) + 10000000; // 8位數流水號
    return `${prefix}${sequence}`;
  }

  private assertInvoiceIssuingAvailable(merchantKey?: string | null) {
    if (this.isLocalInvoiceStubAllowed()) {
      return;
    }

    this.ecpayEinvoiceAdapter.assertReadyForMerchant(merchantKey);
  }

  private isLocalInvoiceStubAllowed() {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.ALLOW_LOCAL_INVOICE_STUB === 'true'
    );
  }

  private inferEcpayMerchantKey(channelCode?: string | null) {
    const normalized = (channelCode || '').trim().toUpperCase();
    if (normalized === 'SHOPIFY') {
      return 'shopify-main';
    }
    if (
      normalized === '1SHOP' ||
      normalized === 'ONESHOP' ||
      normalized === 'SHOPLINE'
    ) {
      return 'groupbuy-main';
    }
    return null;
  }
}
