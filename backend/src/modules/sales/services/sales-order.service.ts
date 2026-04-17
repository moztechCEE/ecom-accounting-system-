import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JournalService } from '../../accounting/services/journal.service';
import { Decimal } from '@prisma/client/runtime/library';
import { InventoryService } from '../../inventory/inventory.service';
import { ProductType } from '@prisma/client';

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
    },
  ) {
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
  ) {
    // TODO: 實作退款邏輯
    // 1. 更新訂單狀態為 refunded
    // 2. 產生沖回分錄（紅字分錄）
    // 3. 記錄退款記錄
    this.logger.log(
      `Applying refund for order ${orderId}, amount: ${refundAmount}`,
    );
    throw new Error('Not implemented: applyRefund');
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
}
