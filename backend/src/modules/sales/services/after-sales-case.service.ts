import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';

const VALID_REASON_CATEGORIES = new Set([
  'repair',
  'exchange',
  'return',
  'warranty',
  'trade_in_upgrade',
  'other',
]);

@Injectable()
export class AfterSalesCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(
    entityId: string,
    params: {
      status?: string;
      search?: string;
      limit?: number;
    } = {},
  ) {
    const normalizedLimit = Math.min(Math.max(Number(params.limit || 200), 20), 500);
    const search = params.search?.trim();

    const cases = await this.prisma.afterSalesCase.findMany({
      where: {
        entityId,
        ...(params.status && params.status !== 'all' ? { status: params.status } : {}),
        ...(search
          ? {
              OR: [
                { caseNo: { contains: search, mode: 'insensitive' } },
                { notes: { contains: search, mode: 'insensitive' } },
                { customer: { name: { contains: search, mode: 'insensitive' } } },
                { items: { some: { itemName: { contains: search, mode: 'insensitive' } } } },
                { items: { some: { sku: { contains: search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: this.includeGraph(),
      orderBy: [{ updatedAt: 'desc' }],
      take: normalizedLimit,
    });

    const items = cases.map((item) => this.serializeCase(item));

    return {
      entityId,
      summary: {
        total: items.length,
        awaitingPayment: items.filter((item) => item.status === 'awaiting_payment').length,
        accounting: items.filter((item) => item.status === 'accounting_invoice').length,
        warehouse: items.filter((item) => item.status === 'warehouse_receiving').length,
        shipping: items.filter((item) => item.status === 'customer_service_shipping').length,
        payableAmount: items.reduce((sum, item) => sum + item.paymentAmountOriginal, 0),
      },
      items,
    };
  }

  async create(
    data: {
      entityId: string;
      customerId?: string;
      originalSalesOrderId?: string;
      caseDate?: string;
      reasonCategory: string;
      currency?: string;
      notes?: string;
      items: Array<{
        productId?: string;
        sku?: string;
        itemName?: string;
        quantity?: number;
        unitPriceOriginal?: number;
        paymentRequired?: boolean;
        paymentAmountOriginal?: number;
        notes?: string;
      }>;
    },
    createdBy?: string,
  ) {
    const entityId = data.entityId?.trim();
    if (!entityId) throw new BadRequestException('entityId is required');
    if (!VALID_REASON_CATEGORIES.has(data.reasonCategory)) {
      throw new BadRequestException('reasonCategory is invalid');
    }
    if (!data.items?.length) {
      throw new BadRequestException('items is required');
    }

    if (data.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: data.customerId, entityId },
      });
      if (!customer) throw new NotFoundException('Customer not found');
    }

    if (data.originalSalesOrderId) {
      const order = await this.prisma.salesOrder.findFirst({
        where: { id: data.originalSalesOrderId, entityId },
      });
      if (!order) throw new NotFoundException('Original sales order not found');
    }

    const normalizedItems = await Promise.all(
      data.items.map((item, index) => this.normalizeItem(entityId, item, index)),
    );
    const paymentAmount = this.sumPaymentAmount(normalizedItems);
    const hasPayment = paymentAmount > 0;

    const created = await this.prisma.afterSalesCase.create({
      data: {
        entityId,
        customerId: data.customerId || undefined,
        originalSalesOrderId: data.originalSalesOrderId || undefined,
        caseNo: await this.nextCaseNo(entityId),
        caseDate: data.caseDate ? new Date(data.caseDate) : new Date(),
        reasonCategory: data.reasonCategory,
        status: hasPayment ? 'customer_service' : 'warehouse_receiving',
        currency: data.currency || 'TWD',
        paymentStatus: hasPayment ? 'pending' : 'not_required',
        paymentAmountOriginal: new Decimal(paymentAmount),
        notes: data.notes?.trim() || null,
        createdBy: createdBy || null,
        items: {
          create: normalizedItems.map((item) => ({
            entityId,
            productId: item.productId || null,
            sku: item.sku || null,
            itemName: item.itemName,
            quantity: new Decimal(item.quantity),
            unitPriceOriginal: new Decimal(item.unitPriceOriginal),
            paymentRequired: item.paymentRequired,
            paymentAmountOriginal: new Decimal(item.paymentAmountOriginal),
            notes: item.notes || null,
            sortOrder: item.sortOrder,
          })),
        },
      },
      include: this.includeGraph(),
    });

    return this.serializeCase(created);
  }

  async setItemPaymentRequired(
    entityId: string,
    caseId: string,
    itemId: string,
    data: {
      paymentRequired: boolean;
      paymentAmountOriginal?: number;
    },
  ) {
    await this.ensureCase(entityId, caseId);
    const item = await this.prisma.afterSalesCaseItem.findFirst({
      where: { id: itemId, entityId, afterSalesCaseId: caseId },
    });
    if (!item) throw new NotFoundException('After-sales item not found');

    const fallbackAmount = Number(item.paymentAmountOriginal) || Number(item.unitPriceOriginal) * Number(item.quantity);
    await this.prisma.afterSalesCaseItem.update({
      where: { id: itemId },
      data: {
        paymentRequired: data.paymentRequired,
        paymentAmountOriginal: new Decimal(
          data.paymentRequired ? Number(data.paymentAmountOriginal ?? fallbackAmount) : 0,
        ),
      },
    });

    await this.recalculatePayment(entityId, caseId);
    return this.findOne(entityId, caseId);
  }

  async issuePayment(entityId: string, caseId: string) {
    const afterSalesCase = await this.ensureCase(entityId, caseId);
    const paymentAmount = this.sumPaymentAmount(afterSalesCase.items || []);
    if (paymentAmount <= 0) {
      throw new BadRequestException('此來回件沒有需付款商品');
    }

    const paymentLinkUrl = afterSalesCase.paymentLinkUrl || this.buildPaymentLink(afterSalesCase);
    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        paymentAmountOriginal: new Decimal(paymentAmount),
        paymentStatus: 'pending',
        status: 'awaiting_payment',
        paymentLinkUrl,
        paymentRequestedAt: new Date(),
      },
      include: this.includeGraph(),
    });

    return this.serializeCase(updated);
  }

  async markPaid(entityId: string, caseId: string) {
    const afterSalesCase = await this.ensureCase(entityId, caseId);
    const now = new Date();
    const invoice = afterSalesCase.invoiceId
      ? null
      : await this.createIssuedInvoiceForCase(entityId, afterSalesCase, now);
    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        paymentStatus: 'paid',
        status: 'accounting_invoice',
        paidAt: now,
        accountingReceivedAt: now,
        ...(invoice
          ? {
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
            }
          : {}),
        invoiceIssuedAt: now,
      },
      include: this.includeGraph(),
    });
    return this.serializeCase(updated);
  }

  async confirmAccounting(entityId: string, caseId: string) {
    await this.ensureCase(entityId, caseId);
    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        status: 'warehouse_receiving',
        accountingReceivedAt: new Date(),
      },
      include: this.includeGraph(),
    });
    return this.serializeCase(updated);
  }

  async confirmWarehouseReceived(entityId: string, caseId: string) {
    await this.ensureCase(entityId, caseId);
    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        status: 'customer_service_shipping',
        warehouseReceivedAt: new Date(),
      },
      include: this.includeGraph(),
    });
    return this.serializeCase(updated);
  }

  async ship(entityId: string, caseId: string, data: { trackingNo?: string }) {
    await this.ensureCase(entityId, caseId);
    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        status: 'completed',
        trackingNo: data.trackingNo?.trim() || null,
        shippedAt: new Date(),
      },
      include: this.includeGraph(),
    });
    return this.serializeCase(updated);
  }

  async findOne(entityId: string, caseId: string) {
    const afterSalesCase = await this.ensureCase(entityId, caseId);
    return this.serializeCase(afterSalesCase);
  }

  private async ensureCase(entityId: string, caseId: string) {
    const afterSalesCase = await this.prisma.afterSalesCase.findFirst({
      where: { id: caseId, entityId },
      include: this.includeGraph(),
    });
    if (!afterSalesCase) throw new NotFoundException('After-sales case not found');
    return afterSalesCase;
  }

  private async recalculatePayment(entityId: string, caseId: string) {
    const afterSalesCase = await this.ensureCase(entityId, caseId);
    const amount = this.sumPaymentAmount(afterSalesCase.items || []);
    await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        paymentAmountOriginal: new Decimal(amount),
        paymentStatus: amount > 0 ? afterSalesCase.paymentStatus === 'paid' ? 'paid' : 'pending' : 'not_required',
      },
    });
  }

  private async normalizeItem(
    entityId: string,
    item: {
      productId?: string;
      sku?: string;
      itemName?: string;
      quantity?: number;
      unitPriceOriginal?: number;
      paymentRequired?: boolean;
      paymentAmountOriginal?: number;
      notes?: string;
    },
    index: number,
  ) {
    let product: any = null;
    if (item.productId) {
      product = await this.prisma.product.findFirst({
        where: { id: item.productId, entityId },
      });
      if (!product) throw new NotFoundException('Product not found');
    }

    const quantity = Math.max(Number(item.quantity || 1), 1);
    const unitPrice = Number(item.unitPriceOriginal ?? product?.salesPrice ?? 0);
    const requestedPaymentAmount = Number(item.paymentAmountOriginal ?? unitPrice * quantity);
    const paymentRequired = Boolean(item.paymentRequired);

    return {
      productId: product?.id || item.productId || null,
      sku: item.sku?.trim() || product?.sku || null,
      itemName: item.itemName?.trim() || product?.name || '未命名商品',
      quantity,
      unitPriceOriginal: unitPrice,
      paymentRequired,
      paymentAmountOriginal: paymentRequired ? requestedPaymentAmount : 0,
      notes: item.notes?.trim() || null,
      sortOrder: index,
    };
  }

  private async nextCaseNo(entityId: string) {
    const prefix = `AS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const count = await this.prisma.afterSalesCase.count({
      where: {
        entityId,
        caseNo: { startsWith: prefix },
      },
    });
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  private async createIssuedInvoiceForCase(entityId: string, afterSalesCase: any, issuedAt: Date) {
    const paymentItems = (afterSalesCase.items || []).filter((item) => item.paymentRequired);
    if (!paymentItems.length) return null;

    const invoiceLines = paymentItems.map((item) => {
      const total = Number(item.paymentAmountOriginal || 0);
      const amount = Math.round((total / 1.05) * 100) / 100;
      const tax = Math.round((total - amount) * 100) / 100;
      const qty = Number(item.quantity || 1);
      const unitPrice = qty ? amount / qty : amount;

      return {
        productId: item.productId || undefined,
        description: item.itemName,
        qty: new Decimal(qty),
        unitPriceOriginal: new Decimal(unitPrice),
        unitPriceCurrency: afterSalesCase.currency || 'TWD',
        unitPriceFxRate: new Decimal(1),
        unitPriceBase: new Decimal(unitPrice),
        amountOriginal: new Decimal(amount),
        currency: afterSalesCase.currency || 'TWD',
        fxRate: new Decimal(1),
        amountBase: new Decimal(amount),
        taxAmountOriginal: new Decimal(tax),
        taxAmountCurrency: afterSalesCase.currency || 'TWD',
        taxAmountFxRate: new Decimal(1),
        taxAmountBase: new Decimal(tax),
      };
    });

    const amountOriginal = invoiceLines.reduce(
      (sum, line) => sum + Number(line.amountOriginal),
      0,
    );
    const taxAmountOriginal = invoiceLines.reduce(
      (sum, line) => sum + Number(line.taxAmountOriginal),
      0,
    );
    const totalAmountOriginal = amountOriginal + taxAmountOriginal;
    const invoiceNumber = await this.nextAfterSalesInvoiceNumber(entityId);

    return this.prisma.invoice.create({
      data: {
        entityId,
        invoiceNumber,
        status: 'issued',
        invoiceType: afterSalesCase.customer?.taxId ? 'B2B' : 'B2C',
        issuedAt,
        buyerName: afterSalesCase.customer?.name || null,
        buyerTaxId: afterSalesCase.customer?.taxId || null,
        buyerEmail: afterSalesCase.customer?.email || null,
        buyerPhone: afterSalesCase.customer?.phone || afterSalesCase.customer?.mobile || null,
        buyerAddress: afterSalesCase.customer?.address || null,
        amountOriginal: new Decimal(amountOriginal),
        currency: afterSalesCase.currency || 'TWD',
        fxRate: new Decimal(1),
        amountBase: new Decimal(amountOriginal),
        taxAmountOriginal: new Decimal(taxAmountOriginal),
        taxAmountCurrency: afterSalesCase.currency || 'TWD',
        taxAmountFxRate: new Decimal(1),
        taxAmountBase: new Decimal(taxAmountOriginal),
        totalAmountOriginal: new Decimal(totalAmountOriginal),
        totalAmountCurrency: afterSalesCase.currency || 'TWD',
        totalAmountFxRate: new Decimal(1),
        totalAmountBase: new Decimal(totalAmountOriginal),
        externalPlatform: 'after_sales',
        notes: `售後來回件 ${afterSalesCase.caseNo} 自動開立`,
        invoiceLines: {
          create: invoiceLines,
        },
      },
    });
  }

  private async nextAfterSalesInvoiceNumber(entityId: string) {
    const prefix = `ASINV${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const count = await this.prisma.invoice.count({
      where: {
        entityId,
        invoiceNumber: { startsWith: prefix },
      },
    });
    return `${prefix}${String(count + 1).padStart(3, '0')}`;
  }

  private sumPaymentAmount(items: Array<any>) {
    return items.reduce(
      (sum, item) =>
        sum + (item.paymentRequired ? Number(item.paymentAmountOriginal || 0) : 0),
      0,
    );
  }

  private buildPaymentLink(afterSalesCase: any) {
    const baseUrl =
      this.configService.get<string>('PAYMENT_LINK_BASE_URL', '') ||
      this.configService.get<string>('FRONTEND_PUBLIC_URL', '') ||
      this.configService.get<string>('FRONTEND_URL', '') ||
      '';
    const path = `/after-sales/payment/${encodeURIComponent(afterSalesCase.id)}`;
    return baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : path;
  }

  private includeGraph() {
    return {
      customer: true,
      originalSalesOrder: true,
      items: {
        include: { product: true },
        orderBy: { sortOrder: 'asc' as const },
      },
    };
  }

  private serializeCase(afterSalesCase: any) {
    return {
      ...afterSalesCase,
      paymentAmountOriginal: Number(afterSalesCase.paymentAmountOriginal || 0),
      caseDate: afterSalesCase.caseDate?.toISOString?.() || afterSalesCase.caseDate,
      paymentRequestedAt:
        afterSalesCase.paymentRequestedAt?.toISOString?.() || afterSalesCase.paymentRequestedAt,
      paidAt: afterSalesCase.paidAt?.toISOString?.() || afterSalesCase.paidAt,
      accountingReceivedAt:
        afterSalesCase.accountingReceivedAt?.toISOString?.() ||
        afterSalesCase.accountingReceivedAt,
      invoiceId: afterSalesCase.invoiceId || null,
      invoiceNumber: afterSalesCase.invoiceNumber || null,
      invoiceIssuedAt:
        afterSalesCase.invoiceIssuedAt?.toISOString?.() || afterSalesCase.invoiceIssuedAt,
      warehouseReceivedAt:
        afterSalesCase.warehouseReceivedAt?.toISOString?.() ||
        afterSalesCase.warehouseReceivedAt,
      shippedAt: afterSalesCase.shippedAt?.toISOString?.() || afterSalesCase.shippedAt,
      createdAt: afterSalesCase.createdAt?.toISOString?.() || afterSalesCase.createdAt,
      updatedAt: afterSalesCase.updatedAt?.toISOString?.() || afterSalesCase.updatedAt,
      items: (afterSalesCase.items || []).map((item) => ({
        ...item,
        quantity: Number(item.quantity || 0),
        unitPriceOriginal: Number(item.unitPriceOriginal || 0),
        paymentAmountOriginal: Number(item.paymentAmountOriginal || 0),
      })),
    };
  }
}
