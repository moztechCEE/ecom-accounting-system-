import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JournalService } from '../../accounting/services/journal.service';
import { Decimal } from '@prisma/client/runtime/library';
import { InventoryService } from '../../inventory/inventory.service';
import { ProductType } from '@prisma/client';
import { ApService } from '../../ap/ap.service';

/**
 * SalesOrderService
 * 銷售訂單服務
 *
 * 核心功能：
 * - 建立銷售訂單
 * - 訂單完成時自動產生會計分錄
 * - 計算平台費、金流費
 * - 處理退款與退貨
 *
 * 分錄邏輯示範：
 * 假設訂單金額 10,000，平台費 500，金流費 200
 *
 * 訂單完成時：
 * 借：應收帳款 10,000
 * 　貸：銷貨收入 10,000
 *
 * 實際收款時（扣除費用）：
 * 借：銀行存款 9,300
 * 借：平台費用 500
 * 借：金流手續費 200
 * 　貸：應收帳款 10,000
 */
@Injectable()
export class SalesOrderService {
  private readonly logger = new Logger(SalesOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalService: JournalService,
    private readonly inventoryService: InventoryService,
    private readonly apService: ApService,
  ) {}

  /**
   * 建立銷售訂單
   * @param data - 訂單資料
   * @param createdBy - 建立者 ID
   */
  async createSalesOrder(
    data: {
      entityId: string;
      channelId: string;
      warehouseId?: string; // 出貨倉庫（預留給庫存預留使用）
      customerId?: string;
      externalOrderId?: string;
      orderDate: Date;
      currency?: string;
      fxRate?: number;
      items: Array<{
        productId: string;
        qty: number;
        unitPrice: number;
        discount?: number;
      }>;
    },
    createdBy: string,
  ) {
    // 計算訂單金額
    const totalGross = data.items.reduce(
      (sum, item) => sum + item.qty * item.unitPrice - (item.discount || 0),
      0,
    );

    // 建立訂單
    const order = await this.prisma.salesOrder.create({
      data: {
        entityId: data.entityId,
        channelId: data.channelId,
        customerId: data.customerId,
        externalOrderId: data.externalOrderId,
        orderDate: data.orderDate,
        totalGrossOriginal: new Decimal(totalGross),
        totalGrossCurrency: data.currency || 'TWD',
        totalGrossFxRate: new Decimal(data.fxRate || 1),
        totalGrossBase: new Decimal(totalGross).mul(data.fxRate || 1),
        taxAmountOriginal: new Decimal(0),
        taxAmountCurrency: data.currency || 'TWD',
        taxAmountFxRate: new Decimal(data.fxRate || 1),
        taxAmountBase: new Decimal(0),
        discountAmountOriginal: new Decimal(0),
        discountAmountCurrency: data.currency || 'TWD',
        discountAmountFxRate: new Decimal(data.fxRate || 1),
        discountAmountBase: new Decimal(0),
        shippingFeeOriginal: new Decimal(0),
        shippingFeeCurrency: data.currency || 'TWD',
        shippingFeeFxRate: new Decimal(data.fxRate || 1),
        shippingFeeBase: new Decimal(0),
        status: 'pending',
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            qty: new Decimal(item.qty),
            unitPriceOriginal: new Decimal(item.unitPrice),
            unitPriceCurrency: data.currency || 'TWD',
            unitPriceFxRate: new Decimal(data.fxRate || 1),
            unitPriceBase: new Decimal(item.unitPrice).mul(data.fxRate || 1),
            discountOriginal: new Decimal(item.discount || 0),
            discountCurrency: data.currency || 'TWD',
            discountFxRate: new Decimal(data.fxRate || 1),
            discountBase: new Decimal(item.discount || 0).mul(data.fxRate || 1),
            taxAmountOriginal: new Decimal(0),
            taxAmountCurrency: data.currency || 'TWD',
            taxAmountFxRate: new Decimal(data.fxRate || 1),
            taxAmountBase: new Decimal(0),
          })),
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        channel: true,
      },
    });

    this.logger.log(`Created sales order ${order.id}`);

    // 若有提供 warehouseId，建立訂單後預留庫存
    if (data.warehouseId) {
      for (const item of order.items) {
        await this.reserveInventoryForItem(
          data.entityId,
          data.warehouseId,
          order.id,
          item.product,
          Number(item.qty),
        );
      }
      this.logger.log(
        `Reserved inventory for sales order ${order.id} in warehouse ${data.warehouseId}`,
      );
    }

    return order;
  }

  /**
   * 遞迴預留庫存 (支援 Bundle 展開)
   */
  private async reserveInventoryForItem(
    entityId: string,
    warehouseId: string,
    orderId: string,
    product: any,
    qty: number,
  ) {
    if (product.type === ProductType.BUNDLE) {
      // 展開 BOM
      const bom = await this.prisma.billOfMaterial.findMany({
        where: { parentId: product.id },
        include: { child: true },
      });

      if (bom.length === 0) {
        this.logger.warn(`Bundle product ${product.sku} has no BOM components defined.`);
        return;
      }

      for (const component of bom) {
        const requiredQty = Number(component.quantity) * qty;
        await this.reserveInventoryForItem(
          entityId,
          warehouseId,
          orderId,
          component.child,
          requiredQty,
        );
      }
    } else {
      if (product.type === ProductType.SERVICE) return;

      await this.inventoryService.reserveStock({
        entityId,
        warehouseId,
        productId: product.id,
        quantity: qty,
        referenceType: 'SALES_ORDER',
        referenceId: orderId,
      });
    }
  }



  /**
   * 完成訂單並產生收入分錄
   * @param orderId - 訂單 ID
   * @param createdBy - 操作者 ID
   *
   * 此方法示範如何在訂單完成時自動產生會計分錄
   */
  async completeSalesOrder(orderId: string, createdBy: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Sales order ${orderId} not found`);
    }

    // 更新訂單狀態
    await this.prisma.salesOrder.update({
      where: { id: orderId },
      data: { status: 'completed' },
    });

    // TODO: 實際環境中，科目 ID 應該從設定檔或資料庫取得
    // 這裡示範邏輯：需要先建立預設科目，然後依照科目代號查詢

    // 產生收入分錄
    // 簡化版：假設全額記應收，實際應依付款狀態決定
    const totalAmount = Number(order.totalGrossOriginal);

    // 未來應該這樣取得科目：
    // const arAccount = await this.getAccountByCode(order.entityId, '1120'); // 應收帳款
    // const revenueAccount = await this.getAccountByCode(order.entityId, '4101'); // 銷貨收入

    // 目前先記錄日誌，待 seeding 完成後可實作
    this.logger.log(
      `Would create journal entry for order ${orderId}, amount: ${totalAmount}`,
    );

    /*
    // 完整實作範例（需要先有科目資料）：
    await this.journalService.createJournalEntry({
      entityId: order.entityId,
      date: new Date(),
      description: `銷售訂單 ${order.externalOrderId || order.id}`,
      sourceModule: 'sales',
      sourceId: order.id,
      createdBy,
      lines: [
        {
          accountId: arAccount.id,
          debit: totalAmount,
          credit: 0,
          currency: order.currency,
          fxRate: Number(order.fxRate),
          amountBase: totalAmount * Number(order.fxRate),
          memo: '應收銷貨款',
        },
        {
          accountId: revenueAccount.id,
          debit: 0,
          credit: totalAmount,
          currency: order.currency,
          fxRate: Number(order.fxRate),
          amountBase: totalAmount * Number(order.fxRate),
          memo: '銷貨收入',
        },
      ],
    });
    */

    this.logger.log(
      `Completed sales order ${orderId} and created journal entry`,
    );

    return order;
  }

  /**
   * 查詢銷售訂單
   */
  async getSalesOrders(
    entityId: string,
    filters?: {
      channelId?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    },
  ) {
    const limit = Math.max(1, Math.min(filters?.limit || 300, 500));

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        ...(filters?.channelId && { channelId: filters.channelId }),
        ...(filters?.status && { status: filters.status }),
        ...(filters?.startDate && {
          orderDate: {
            gte: filters.startDate,
            ...(filters?.endDate && { lte: filters.endDate }),
          },
        }),
      },
      include: {
        channel: true,
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
        payments: {
          orderBy: {
            payoutDate: 'desc',
          },
        },
        invoices: {
          orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        },
        shipments: {
          orderBy: {
            shipDate: 'desc',
          },
        },
      },
      orderBy: { orderDate: 'desc' },
      take: limit,
    });

    const orderIds = orders.map((order) => order.id);
    const [journals, arInvoices] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: {
          entityId,
          sourceModule: 'sales',
          sourceId: {
            in: orderIds.length ? orderIds : ['__none__'],
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.arInvoice.findMany({
        where: {
          entityId,
          sourceId: {
            in: orderIds.length ? orderIds : ['__none__'],
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const journalMap = new Map<string, (typeof journals)[number]>();
    for (const journal of journals) {
      if (journal.sourceId && !journalMap.has(journal.sourceId)) {
        journalMap.set(journal.sourceId, journal);
      }
    }

    const arMap = new Map<string, (typeof arInvoices)[number]>();
    for (const invoice of arInvoices) {
      if (invoice.sourceId && !arMap.has(invoice.sourceId)) {
        arMap.set(invoice.sourceId, invoice);
      }
    }

    return orders.map((order) => {
      const latestInvoice = order.invoices[0] || null;
      const arInvoice = arMap.get(order.id) || null;
      const journal = journalMap.get(order.id) || null;
      const grossAmount = Number(order.totalGrossOriginal || 0);
      const paidAmount = order.payments.reduce(
        (sum, payment) => sum + Number(payment.amountGrossOriginal || 0),
        0,
      );
      const gatewayFeeAmount = order.payments.reduce(
        (sum, payment) => sum + Number(payment.feeGatewayOriginal || 0),
        0,
      );
      const platformFeeAmount = order.payments.reduce(
        (sum, payment) => sum + Number(payment.feePlatformOriginal || 0),
        0,
      );
      const netAmount = order.payments.reduce(
        (sum, payment) => sum + Number(payment.amountNetOriginal || 0),
        0,
      );

      return {
        ...order,
        paidAmountOriginal: paidAmount,
        outstandingAmountOriginal: Math.max(grossAmount - paidAmount, 0),
        feeGatewayOriginal: gatewayFeeAmount,
        feePlatformOriginal: platformFeeAmount,
        amountNetOriginal: netAmount,
        invoiceNumber: latestInvoice?.invoiceNumber || null,
        invoiceStatus: latestInvoice?.status || (order.hasInvoice ? 'issued' : 'pending'),
        arStatus: arInvoice?.status || null,
        arDueDate: arInvoice?.dueDate || null,
        journalEntryId: journal?.id || null,
        journalApprovedAt: journal?.approvedAt || null,
        accountingPosted: Boolean(journal),
      };
    });
  }

  async syncOrderInvoiceStatus(orderId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        channel: true,
        customer: true,
        invoices: {
          orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Sales order ${orderId} not found`);
    }

    const invoiceCandidate = this.resolveInvoiceCandidate(order.notes, order.invoices?.[0]);
    if (!invoiceCandidate.invoiceNumber || !invoiceCandidate.invoiceDate) {
      return {
        success: false,
        orderId: order.id,
        orderNumber: order.externalOrderId || order.id,
        invoiceNumber: invoiceCandidate.invoiceNumber || null,
        invoiceDate: invoiceCandidate.invoiceDate || null,
        invoiceStatus: invoiceCandidate.invoiceNumber ? 'unknown' : 'pending',
        message: '找不到可查詢的發票號碼或發票日期',
      };
    }

    const merchantProfile = this.resolveEcpayMerchantProfile(order.channel?.code || '');
    const result = await this.apService.queryEcpayServiceFeeInvoiceStatus({
      merchantKey: merchantProfile.merchantKey,
      merchantId: merchantProfile.merchantId,
      invoiceNo: invoiceCandidate.invoiceNumber,
      invoiceDate: invoiceCandidate.invoiceDate,
    });

    const mergedNotes = this.mergeInvoiceMetadataIntoNotes(order.notes, {
      invoiceNumber: invoiceCandidate.invoiceNumber,
      invoiceDate: invoiceCandidate.invoiceDate,
      invoiceStatus: result.invoiceIssuedStatus || (result.success ? 'issued' : 'unknown'),
      merchantKey: merchantProfile.merchantKey,
      merchantId: merchantProfile.merchantId,
      verificationMessage: result.rawMessage || null,
      verifiedAt: new Date().toISOString(),
    });

    const invoiceRecord = await this.materializeInvoiceCandidate(order, invoiceCandidate, {
      externalPlatform: 'ecpay',
      externalPayload: result.raw || undefined,
      verificationMessage: result.rawMessage || null,
      issued: result.success,
    });

    await this.prisma.salesOrder.update({
      where: { id: order.id },
      data: {
        hasInvoice: result.success || order.hasInvoice,
        invoiceId: invoiceRecord?.id || order.invoiceId || null,
        notes: mergedNotes,
      },
    });

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.externalOrderId || order.id,
      invoiceNumber: invoiceCandidate.invoiceNumber,
      invoiceDate: invoiceCandidate.invoiceDate,
      invoiceStatus: result.invoiceIssuedStatus || 'unknown',
      merchantKey: merchantProfile.merchantKey,
      merchantId: merchantProfile.merchantId,
      rawMessage: result.rawMessage || null,
      raw: result.raw,
    };
  }

  async syncInvoiceStatusForOrders(params: {
    entityId: string;
    channelId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }) {
    const limit = Math.max(1, Math.min(params.limit || 50, 200));
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId: params.entityId,
        ...(params.channelId && { channelId: params.channelId }),
        ...(params.status && { status: params.status }),
        ...(params.startDate && {
          orderDate: {
            gte: params.startDate,
            ...(params.endDate && { lte: params.endDate }),
          },
        }),
      },
      include: {
        channel: true,
        invoices: {
          orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
      orderBy: { orderDate: 'desc' },
      take: limit,
    });

    const results = [];
    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const order of orders) {
      try {
        const invoiceCandidate = this.resolveInvoiceCandidate(order.notes, order.invoices?.[0]);
        if (!invoiceCandidate.invoiceNumber || !invoiceCandidate.invoiceDate) {
          skipped += 1;
          results.push({
            orderId: order.id,
            orderNumber: order.externalOrderId || order.id,
            success: false,
            skipped: true,
            reason: 'missing_invoice_candidate',
          });
          continue;
        }

        const result = await this.syncOrderInvoiceStatus(order.id);
        synced += result.success ? 1 : 0;
        results.push(result);
      } catch (error) {
        failed += 1;
        results.push({
          orderId: order.id,
          orderNumber: order.externalOrderId || order.id,
          success: false,
          skipped: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: true,
      entityId: params.entityId,
      requested: orders.length,
      synced,
      skipped,
      failed,
      results,
    };
  }

  async importEcpayIssuedInvoices(params: {
    entityId: string;
    merchantKey?: string;
    merchantId?: string;
    markIssued?: boolean;
    dryRun?: boolean;
    rows: Record<string, string | number | boolean | null>[];
    mapping?: Record<string, string | string[]>;
  }) {
    const merchantKey =
      params.merchantKey?.trim() ||
      (params.merchantId?.trim() === '3150241' ? 'groupbuy-main' : 'shopify-main');
    const merchantId =
      params.merchantId?.trim() ||
      (merchantKey === 'groupbuy-main' ? '3150241' : '3290494');
    const markIssued = params.markIssued !== false;

    let matched = 0;
    let created = 0;
    let updated = 0;
    let unmatched = 0;
    let invalid = 0;
    let previewed = 0;
    const results: Array<{
      invoiceNumber?: string | null;
      relateNumber?: string | null;
      orderId?: string | null;
      orderNumber?: string | null;
      status:
        | 'created'
        | 'updated'
        | 'would_create'
        | 'would_update'
        | 'unmatched'
        | 'invalid';
      message: string;
    }> = [];

    for (const row of params.rows || []) {
      const normalized = this.normalizeEcpayIssuedInvoiceRow(row, params.mapping);
      if (!normalized.invoiceNumber || !normalized.invoiceDate) {
        invalid += 1;
        results.push({
          invoiceNumber: normalized.invoiceNumber,
          relateNumber: normalized.relateNumber,
          status: 'invalid',
          message: '缺少發票號碼或發票日期',
        });
        continue;
      }

      const order = await this.findSalesOrderForEcpayInvoiceImport({
        entityId: params.entityId,
        merchantKey,
        merchantId,
        invoiceNumber: normalized.invoiceNumber,
        relateNumber: normalized.relateNumber,
      });

      if (!order) {
        unmatched += 1;
        results.push({
          invoiceNumber: normalized.invoiceNumber,
          relateNumber: normalized.relateNumber,
          status: 'unmatched',
          message: '找不到可回填的訂單',
        });
        continue;
      }

      const existingInvoice = await this.prisma.invoice.findUnique({
        where: { invoiceNumber: normalized.invoiceNumber },
        select: { id: true },
      });

      if (params.dryRun) {
        matched += 1;
        previewed += 1;
        results.push({
          invoiceNumber: normalized.invoiceNumber,
          relateNumber: normalized.relateNumber,
          orderId: order.id,
          orderNumber: order.externalOrderId || order.id,
          status: existingInvoice ? 'would_update' : 'would_create',
          message: existingInvoice
            ? 'dryRun：可更新既有發票並回填訂單'
            : 'dryRun：可建立發票並回填訂單',
        });
        continue;
      }

      const invoiceRecord = await this.materializeInvoiceCandidate(
        order,
        {
          invoiceNumber: normalized.invoiceNumber,
          invoiceDate: normalized.invoiceDate,
        },
        {
          externalPlatform: 'ecpay',
          externalPayload: row,
          verificationMessage: normalized.note || 'manual_import',
          issued: markIssued,
        },
      );

      const mergedNotes = this.mergeInvoiceMetadataIntoNotes(order.notes, {
        invoiceNumber: normalized.invoiceNumber,
        invoiceDate: normalized.invoiceDate,
        invoiceStatus: markIssued ? 'issued' : 'draft',
        merchantKey,
        merchantId,
        verificationMessage: normalized.note || 'manual_import',
        verifiedAt: new Date().toISOString(),
      });

      await this.prisma.salesOrder.update({
        where: { id: order.id },
        data: {
          hasInvoice: markIssued || order.hasInvoice,
          invoiceId: invoiceRecord?.id || order.invoiceId || null,
          notes: mergedNotes,
        },
      });

      matched += 1;
      if (existingInvoice) {
        updated += 1;
      } else {
        created += 1;
      }
      results.push({
        invoiceNumber: normalized.invoiceNumber,
        relateNumber: normalized.relateNumber,
        orderId: order.id,
        orderNumber: order.externalOrderId || order.id,
        status: existingInvoice ? 'updated' : 'created',
        message: existingInvoice ? '已更新既有發票並回填訂單' : '已建立發票並回填訂單',
      });
    }

    return {
      success: true,
      entityId: params.entityId,
      merchantKey,
      merchantId,
      dryRun: params.dryRun === true,
      requested: params.rows.length,
      matched,
      created,
      updated,
      previewed,
      unmatched,
      invalid,
      results,
    };
  }

  /**
   * 處理退款
   * @param orderId - 訂單 ID
   * @param refundAmount - 退款金額
   * @param reason - 退款原因
   * @param createdBy - 操作者 ID
   */
  async applyRefund(
    orderId: string,
    refundAmount: number,
    reason: string,
    createdBy: string,
    refundDate = new Date(),
  ) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        payments: {
          orderBy: { payoutDate: 'desc' },
        },
        invoices: {
          orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Sales order ${orderId} not found`);
    }

    const grossAmount = Number(order.totalGrossOriginal || 0);
    if (refundAmount <= 0) {
      throw new BadRequestException('refundAmount 必須大於 0');
    }
    if (refundAmount - grossAmount > 0.01) {
      throw new BadRequestException('refundAmount 不可大於訂單總額');
    }
    if ((order.notes || '').includes('[manual-refund]')) {
      throw new BadRequestException('此訂單已建立退款紀錄，請避免重複退款');
    }

    const latestInvoice = order.invoices[0] || null;
    const paidAmount = order.payments.reduce(
      (sum, payment) => sum + Number(payment.amountGrossOriginal || 0),
      0,
    );
    const hadCashReceipt = paidAmount > 0;
    const fullRefund = refundAmount >= grossAmount - 0.01;
    const taxRate = 0.05;
    const refundRevenueAmount = Number(
      (refundAmount / (1 + taxRate)).toFixed(2),
    );
    const refundTaxAmount = Number(
      (refundAmount - refundRevenueAmount).toFixed(2),
    );
    const fxRate = Number(order.totalGrossFxRate || 1);
    const refundBaseAmount = Number((refundAmount * fxRate).toFixed(2));
    const refundRevenueBase = Number((refundRevenueAmount * fxRate).toFixed(2));
    const refundTaxBase = Number((refundTaxAmount * fxRate).toFixed(2));
    const refundNote = [
      `[manual-refund] refundAmount=${refundAmount.toFixed(2)}`,
      `refundDate=${refundDate.toISOString()}`,
      `reason=${(reason || '售後退款').replace(/;/g, ',')}`,
    ].join('; ');

    const accounts = await this.prisma.account.findMany({
      where: {
        entityId: order.entityId,
        code: { in: ['1113', '1191', '4111', '2194'] },
        isActive: true,
      },
    });
    const accountMap = new Map(accounts.map((account) => [account.code, account]));
    const bankAccount = accountMap.get('1113');
    const arAccount = accountMap.get('1191');
    const revenueAccount = accountMap.get('4111');
    const taxAccount = accountMap.get('2194') || null;

    if (!revenueAccount) {
      throw new NotFoundException('缺少 4111 銷貨收入科目，無法建立退款分錄');
    }
    if (!bankAccount && !arAccount) {
      throw new NotFoundException('缺少 1113 或 1191 科目，無法建立退款分錄');
    }

    const period = await this.prisma.period.findFirst({
      where: {
        entityId: order.entityId,
        status: 'open',
        startDate: { lte: refundDate },
        endDate: { gte: refundDate },
      },
      orderBy: { startDate: 'desc' },
    });

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const nextOrder = await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          status: fullRefund ? 'refunded' : order.status,
          notes: [order.notes, refundNote].filter(Boolean).join('\n'),
        },
      });

      if (order.payments.length) {
        await Promise.all(
          order.payments.map((payment) =>
            tx.payment.update({
              where: { id: payment.id },
              data: {
                status: fullRefund ? 'refunded' : payment.status,
                reconciledFlag: false,
                notes: [payment.notes, refundNote].filter(Boolean).join('\n'),
              },
            }),
          ),
        );
      }

      const arInvoice = await tx.arInvoice.findFirst({
        where: {
          entityId: order.entityId,
          sourceId: order.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (arInvoice) {
        const nextAmountOriginal = fullRefund
          ? 0
          : Math.max(Number(arInvoice.amountOriginal || 0) - refundAmount, 0);
        const nextAmountBase = fullRefund
          ? 0
          : Math.max(Number(arInvoice.amountBase || 0) - refundBaseAmount, 0);
        const nextPaidOriginal = fullRefund
          ? 0
          : Math.min(
              Number(arInvoice.paidAmountOriginal || 0),
              nextAmountOriginal,
            );
        const nextPaidBase = fullRefund
          ? 0
          : Math.min(Number(arInvoice.paidAmountBase || 0), nextAmountBase);
        const nextStatus = fullRefund
          ? 'written_off'
          : nextPaidOriginal >= nextAmountOriginal - 0.01
            ? 'paid'
            : nextPaidOriginal > 0
              ? 'partial'
              : 'unpaid';

        await tx.arInvoice.update({
          where: { id: arInvoice.id },
          data: {
            amountOriginal: new Decimal(nextAmountOriginal),
            amountBase: new Decimal(nextAmountBase),
            paidAmountOriginal: new Decimal(nextPaidOriginal),
            paidAmountBase: new Decimal(nextPaidBase),
            status: nextStatus,
            notes: [arInvoice.notes, refundNote].filter(Boolean).join('\n'),
          },
        });
      }

      if (latestInvoice) {
        if (fullRefund) {
          await tx.invoice.update({
            where: { id: latestInvoice.id },
            data: {
              status: 'void',
              voidAt: refundDate,
              voidReason: reason || '售後退款',
              notes: [latestInvoice.notes, refundNote].filter(Boolean).join('\n'),
            },
          });
          await tx.invoiceLog.create({
            data: {
              invoiceId: latestInvoice.id,
              action: 'void',
              userId: createdBy,
              payload: {
                refundAmount,
                refundDate: refundDate.toISOString(),
                reason,
              },
            },
          });
        } else {
          await tx.invoice.update({
            where: { id: latestInvoice.id },
            data: {
              notes: [
                latestInvoice.notes,
                `${refundNote}; refundType=allowance; 折讓`,
              ]
                .filter(Boolean)
                .join('\n'),
            },
          });
          await tx.invoiceLog.create({
            data: {
              invoiceId: latestInvoice.id,
              action: 'allowance',
              userId: createdBy,
              payload: {
                refundAmount,
                refundDate: refundDate.toISOString(),
                reason,
              },
            },
          });
        }
      }

      return nextOrder;
    });

    const creditAccount = hadCashReceipt ? bankAccount : arAccount;
    if (!creditAccount) {
      throw new NotFoundException('缺少退款沖銷對應科目');
    }

    const journalLines = [
      {
        accountId: revenueAccount.id,
        debit: refundRevenueAmount,
        credit: 0,
        currency: order.totalGrossCurrency,
        fxRate,
        amountBase: refundRevenueBase,
        memo: fullRefund ? '退款沖回銷貨收入' : '部分退款沖回銷貨收入',
      },
      ...(taxAccount && refundTaxAmount > 0
        ? [
            {
              accountId: taxAccount.id,
              debit: refundTaxAmount,
              credit: 0,
              currency: order.totalGrossCurrency,
              fxRate,
              amountBase: refundTaxBase,
              memo: fullRefund ? '退款沖回銷項稅額' : '部分退款沖回銷項稅額',
            },
          ]
        : []),
      {
        accountId: creditAccount.id,
        debit: 0,
        credit: refundAmount,
        currency: order.totalGrossCurrency,
        fxRate,
        amountBase: refundBaseAmount,
        memo: hadCashReceipt ? '退款支付 / 平台退刷' : '沖回應收帳款',
      },
    ];

    const journal = await this.journalService.createJournalEntry({
      entityId: order.entityId,
      date: refundDate,
      description: `銷售退款 ${order.externalOrderId || order.id}`,
      sourceModule: 'sales_refund',
      sourceId: order.id,
      periodId: period?.id,
      createdBy,
      lines: journalLines,
    });

    this.logger.log(
      `Applied refund for order ${orderId}, amount: ${refundAmount}, journal=${journal.id}`,
    );

    return {
      success: true,
      orderId: updatedOrder.id,
      orderStatus: updatedOrder.status,
      refundAmount,
      fullRefund,
      journalEntryId: journal.id,
      invoiceStatus: fullRefund
        ? 'void'
        : latestInvoice
          ? 'allowance_pending'
          : 'no_invoice',
      creditTarget: hadCashReceipt ? 'bank' : 'ar',
    };
  }

  /**
   * 將訂單過帳至會計系統
   * @param orderId - 訂單 ID
   * @param createdBy - 操作者 ID
   */
  async postOrderToAccounting(orderId: string, createdBy: string) {
    // TODO: 實作訂單過帳
    // 1. 檢查訂單狀態
    // 2. 產生完整會計分錄（包含平台費、金流費）
    // 3. 更新訂單為已過帳狀態
    this.logger.log(`Posting order ${orderId} to accounting...`);
    throw new Error('Not implemented: postOrderToAccounting');
  }

  /**
   * 建立模擬訂單（用於測試）
   * @param entityId - 公司實體 ID
   * @param createdBy - 建立者 ID
   */
  async createMockOrder(entityId: string, createdBy: string) {
    // TODO: 建立測試用訂單
    // 1. 隨機產生訂單資料
    // 2. 自動完成並產生分錄
    // 3. 用於驗證系統流程
    this.logger.log(`Creating mock order for entity ${entityId}...`);
    throw new Error('Not implemented: createMockOrder');
  }

  private resolveInvoiceCandidate(
    existingNotes?: string | null,
    invoice?: { invoiceNumber?: string | null; issuedAt?: Date | null } | null,
  ) {
    const metadata = this.extractMetadata(existingNotes);
    const invoiceNumber =
      invoice?.invoiceNumber?.trim() ||
      metadata.invoiceNumber ||
      null;
    const invoiceDate =
      (invoice?.issuedAt ? invoice.issuedAt.toISOString().slice(0, 10) : null) ||
      metadata.invoiceDate ||
      null;

    return {
      invoiceNumber,
      invoiceDate,
    };
  }

  private resolveEcpayMerchantProfile(channelCode: string) {
    const normalized = channelCode.trim().toUpperCase();
    if (normalized === 'SHOPIFY') {
      return {
        merchantKey: 'shopify-main',
        merchantId: '3290494',
      };
    }

    if (normalized === '1SHOP' || normalized === 'SHOPLINE') {
      return {
        merchantKey: 'groupbuy-main',
        merchantId: '3150241',
      };
    }

    throw new BadRequestException(`Unsupported channel for ECPay invoice sync: ${channelCode}`);
  }

  private normalizeEcpayIssuedInvoiceRow(
    row: Record<string, string | number | boolean | null>,
    mapping?: Record<string, string | string[]>,
  ) {
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const value = row[key];
        if (value === undefined || value === null) {
          continue;
        }
        const normalized = String(value).trim();
        if (normalized) {
          return normalized;
        }
      }
      return '';
    };

    const fromMapping = (target: string, fallbacks: string[]) => {
      const configured = mapping?.[target];
      if (Array.isArray(configured)) {
        const value = pick(...configured, ...fallbacks);
        return value;
      }
      if (typeof configured === 'string') {
        const value = pick(configured, ...fallbacks);
        return value;
      }
      return pick(...fallbacks);
    };

    return {
      invoiceNumber: fromMapping('invoiceNo', [
        'invoiceNo',
        'InvoiceNo',
        'InvoiceNO',
        'IIS_Number',
        'IIS_Invoice_No',
        'InvoiceNumber',
        '發票號碼',
        'invoice_number',
      ]),
      invoiceDate: this.normalizeEcpayIssuedInvoiceDate(
        fromMapping('invoiceDate', [
          'invoiceDate',
          'InvoiceDate',
          'IIS_Create_Date',
          'IIS_Date',
          '發票日期',
          '開立日期',
          'invoice_date',
        ]),
      ),
      relateNumber: fromMapping('relateNumber', [
        'relateNumber',
        'RelateNumber',
        'IIS_Relate_Number',
        'MerchantTradeNo',
        'MerchantOrderNo',
        '關聯號碼',
        '關聯號',
        '訂單編號',
        'orderNumber',
        'MerchantTradeNo',
      ]),
      note: fromMapping('note', ['note', '備註', 'Remark', '發票備註']),
    };
  }

  private normalizeEcpayIssuedInvoiceDate(value?: string | null) {
    const raw = value?.trim();
    if (!raw) {
      return '';
    }

    const dateOnly = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return raw;
  }

  private async findSalesOrderForEcpayInvoiceImport(params: {
    entityId: string;
    merchantKey: string;
    merchantId: string;
    invoiceNumber: string;
    relateNumber?: string;
  }) {
    const channelCodes =
      params.merchantKey === 'groupbuy-main' || params.merchantId === '3150241'
        ? ['1SHOP', 'SHOPLINE']
        : ['SHOPIFY'];
    const relateNumber = params.relateNumber?.trim();
    const normalizedRelateNumber = relateNumber?.replace(/^#/, '');
    const relateNumberMatchers = relateNumber
      ? [
          { externalOrderId: relateNumber },
          { externalOrderId: { endsWith: `:${relateNumber}` } },
          { notes: { contains: `originalOrderNumber=${relateNumber}` } },
          { notes: { contains: `oneShopOrderId=${relateNumber}` } },
          { notes: { contains: `shopifyOrderName=${relateNumber}` } },
          { notes: { contains: `shopifyOrderNumber=${relateNumber}` } },
          ...(normalizedRelateNumber && normalizedRelateNumber !== relateNumber
            ? [
                { externalOrderId: normalizedRelateNumber },
                {
                  notes: {
                    contains: `shopifyOrderNumber=${normalizedRelateNumber}`,
                  },
                },
                {
                  notes: {
                    contains: `shopifyOrderName=#${normalizedRelateNumber}`,
                  },
                },
              ]
            : []),
        ]
      : [];

    return this.prisma.salesOrder.findFirst({
      where: {
        entityId: params.entityId,
        channel: {
          code: {
            in: channelCodes,
          },
        },
        OR: [
          { invoices: { some: { invoiceNumber: params.invoiceNumber } } },
          { notes: { contains: `invoiceNumber=${params.invoiceNumber}` } },
          ...relateNumberMatchers,
        ],
      },
      include: {
        customer: true,
      },
      orderBy: { orderDate: 'desc' },
    });
  }

  private async materializeInvoiceCandidate(
    order: {
      id: string;
      entityId: string;
      totalGrossOriginal: Decimal;
      totalGrossCurrency: string;
      totalGrossFxRate: Decimal;
      customer?: {
        name?: string | null;
        email?: string | null;
        phone?: string | null;
        taxId?: string | null;
        address?: string | null;
      } | null;
    },
    invoiceCandidate: { invoiceNumber: string | null; invoiceDate: string | null },
    options?: {
      externalPlatform?: string | null;
      externalPayload?: unknown;
      verificationMessage?: string | null;
      issued?: boolean;
    },
  ) {
    if (!invoiceCandidate.invoiceNumber) {
      return null;
    }

    const issuedAt =
      invoiceCandidate.invoiceDate &&
      !Number.isNaN(new Date(invoiceCandidate.invoiceDate).getTime())
        ? new Date(`${invoiceCandidate.invoiceDate}T00:00:00+08:00`)
        : null;
    const taxRate = new Decimal(0.05);
    const fxRate = new Decimal(order.totalGrossFxRate || 1);
    const totalAmountOriginal = new Decimal(order.totalGrossOriginal || 0).toDecimalPlaces(2);
    const amountOriginal = totalAmountOriginal
      .div(new Decimal(1).plus(taxRate))
      .toDecimalPlaces(2);
    const taxAmountOriginal = totalAmountOriginal
      .sub(amountOriginal)
      .toDecimalPlaces(2);
    const amountBase = amountOriginal.mul(fxRate).toDecimalPlaces(2);
    const taxAmountBase = taxAmountOriginal.mul(fxRate).toDecimalPlaces(2);
    const totalAmountBase = totalAmountOriginal.mul(fxRate).toDecimalPlaces(2);

    return this.prisma.invoice.upsert({
      where: { invoiceNumber: invoiceCandidate.invoiceNumber },
      create: {
        entityId: order.entityId,
        orderId: order.id,
        invoiceNumber: invoiceCandidate.invoiceNumber,
        status: options?.issued === false ? 'draft' : 'issued',
        invoiceType: order.customer?.taxId ? 'B2B' : 'B2C',
        issuedAt,
        buyerName: order.customer?.name || null,
        buyerTaxId: order.customer?.taxId || null,
        buyerEmail: order.customer?.email || null,
        buyerPhone: order.customer?.phone || null,
        buyerAddress: order.customer?.address || null,
        amountOriginal,
        currency: order.totalGrossCurrency || 'TWD',
        fxRate,
        amountBase,
        taxAmountOriginal,
        taxAmountCurrency: order.totalGrossCurrency || 'TWD',
        taxAmountFxRate: fxRate,
        taxAmountBase,
        totalAmountOriginal,
        totalAmountCurrency: order.totalGrossCurrency || 'TWD',
        totalAmountFxRate: fxRate,
        totalAmountBase,
        externalInvoiceId: invoiceCandidate.invoiceNumber,
        externalPlatform: options?.externalPlatform || null,
        externalPayload: (options?.externalPayload as any) || undefined,
        notes: options?.verificationMessage || null,
      },
      update: {
        orderId: order.id,
        status: options?.issued === false ? 'draft' : 'issued',
        issuedAt,
        externalInvoiceId: invoiceCandidate.invoiceNumber,
        externalPlatform: options?.externalPlatform || null,
        externalPayload: (options?.externalPayload as any) || undefined,
        notes: options?.verificationMessage || null,
      },
    });
  }

  private extractMetadata(notes?: string | null) {
    const metadata: Record<string, string> = {};

    for (const line of (notes || '').split('\n')) {
      const rawLine = line.replace(/^\[[^\]]+\]\s*/, '').trim();
      for (const pair of rawLine.split(';')) {
        const [key, ...rest] = pair.split('=');
        if (!key || !rest.length) continue;
        metadata[key.trim()] = rest.join('=').trim();
      }
    }

    return metadata;
  }

  private mergeInvoiceMetadataIntoNotes(
    existingNotes: string | null | undefined,
    payload: {
      invoiceNumber: string;
      invoiceDate: string;
      invoiceStatus: string;
      merchantKey: string;
      merchantId: string;
      verificationMessage?: string | null;
      verifiedAt: string;
    },
  ) {
    const preserved = (existingNotes || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[ecpay-invoice-sync]'));

    const metadata = [
      `invoiceNumber=${payload.invoiceNumber}`,
      `invoiceDate=${payload.invoiceDate}`,
      `invoiceStatus=${payload.invoiceStatus}`,
      `merchantKey=${payload.merchantKey}`,
      `merchantId=${payload.merchantId}`,
      `verifiedAt=${payload.verifiedAt}`,
      payload.verificationMessage
        ? `verificationMessage=${payload.verificationMessage.replace(/;/g, ',')}`
        : null,
    ]
      .filter(Boolean)
      .join('; ');

    preserved.push(`[ecpay-invoice-sync] ${metadata}`);
    return preserved.join('\n');
  }
}
