import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { ShopifyHttpAdapter } from './shopify.adapter';
import {
  UnifiedOrder,
  UnifiedTransaction,
} from '../interfaces/sales-channel-adapter.interface';

const SHOPIFY_CHANNEL_CODE = 'SHOPIFY';

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);
  private defaultEntityId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: ShopifyHttpAdapter,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.defaultEntityId =
      this.config.get<string>('SHOPIFY_DEFAULT_ENTITY_ID') || 'tw-entity-001';
  }

  async testConnection() {
    return this.adapter.testConnection();
  }

  async autoSync(options?: {
    entityId?: string;
    since?: Date;
    until?: Date;
  }) {
    const enabled =
      this.config.get<string>('SHOPIFY_SYNC_ENABLED', 'true') !== 'false';

    if (!enabled) {
      return {
        success: false,
        skipped: true,
        message: 'SHOPIFY_SYNC_ENABLED is false',
      };
    }

    const entityId = options?.entityId || this.defaultEntityId;
    const lookbackMinutes = Number(
      this.config.get<string>('SHOPIFY_SYNC_LOOKBACK_MINUTES', '180'),
    );
    const until = options?.until || new Date();
    const since =
      options?.since ||
      new Date(until.getTime() - lookbackMinutes * 60 * 1000);

    this.logger.log(
      `Starting Shopify auto sync for entity=${entityId}, since=${since.toISOString()}, until=${until.toISOString()}`,
    );

    const [orders, transactions] = await Promise.all([
      this.syncOrders({ entityId, since, until }),
      this.syncTransactions({ entityId, since, until }),
    ]);

    const result = {
      success: true,
      entityId,
      since: since.toISOString(),
      until: until.toISOString(),
      orders,
      transactions,
    };

    this.logger.log(
      `Shopify auto sync finished for entity=${entityId}: orders fetched=${orders.fetched}, tx fetched=${transactions.fetched}`,
    );

    return result;
  }

  async backfillHistory(params: {
    entityId: string;
    beginDate: Date;
    endDate: Date;
    windowDays?: number;
  }) {
    await this.assertEntityExists(params.entityId);

    const begin = new Date(params.beginDate);
    const end = new Date(params.endDate);

    if (Number.isNaN(begin.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('beginDate / endDate must be valid dates');
    }

    if (begin > end) {
      throw new BadRequestException('beginDate cannot be later than endDate');
    }

    const windows: Array<{
      index: number;
      since: string;
      until: string;
      orders: Awaited<ReturnType<ShopifyService['syncOrders']>>;
      transactions: Awaited<ReturnType<ShopifyService['syncTransactions']>>;
    }> = [];

    const totals = {
      orderFetched: 0,
      orderCreated: 0,
      orderUpdated: 0,
      transactionFetched: 0,
      transactionCreated: 0,
      transactionUpdated: 0,
    };

    const windowDays = Math.max(1, Math.min(params.windowDays || 31, 31));
    let cursor = new Date(begin);
    let windowIndex = 1;

    while (cursor <= end) {
      const windowStart = new Date(cursor);
      const windowEnd = new Date(cursor);
      windowEnd.setDate(windowEnd.getDate() + windowDays - 1);
      windowEnd.setHours(23, 59, 59, 999);
      if (windowEnd > end) {
        windowEnd.setTime(end.getTime());
      }

      const [orders, transactions] = await Promise.all([
        this.syncOrders({
          entityId: params.entityId,
          since: windowStart,
          until: windowEnd,
        }),
        this.syncTransactions({
          entityId: params.entityId,
          since: windowStart,
          until: windowEnd,
        }),
      ]);

      totals.orderFetched += orders.fetched;
      totals.orderCreated += orders.created;
      totals.orderUpdated += orders.updated;
      totals.transactionFetched += transactions.fetched;
      totals.transactionCreated += transactions.created;
      totals.transactionUpdated += transactions.updated;

      windows.push({
        index: windowIndex,
        since: windowStart.toISOString(),
        until: windowEnd.toISOString(),
        orders,
        transactions,
      });

      cursor = new Date(windowEnd);
      cursor.setMilliseconds(cursor.getMilliseconds() + 1);
      windowIndex += 1;
    }

    return {
      success: true,
      entityId: params.entityId,
      beginDate: begin.toISOString(),
      endDate: end.toISOString(),
      windowCount: windows.length,
      totals,
      windows,
    };
  }

  assertSchedulerToken(providedToken?: string | null) {
    const expected =
      this.config.get<string>('SHOPIFY_SYNC_JOB_TOKEN', '') || '';

    if (!expected) {
      throw new UnauthorizedException(
        'SHOPIFY_SYNC_JOB_TOKEN is not configured',
      );
    }

    if (!providedToken || providedToken !== expected) {
      throw new UnauthorizedException('Invalid scheduler token');
    }
  }

  async syncOrders(params: { entityId: string; since?: Date; until?: Date }) {
    await this.assertEntityExists(params.entityId);

    // Adapter now expects 'start' and 'end'
    const orders = await this.adapter.fetchOrders({
      start: params.since || new Date(0), // Default to epoch if undefined? Or handle in adapter
      end: params.until || new Date(),
    });

    const channel = await this.ensureSalesChannel(params.entityId);
    let created = 0;
    let updated = 0;

    for (const order of orders) {
      try {
        const result = await this.upsertSalesOrder(
          params.entityId,
          channel.id,
          order,
        );
        if (result === 'created') created++;
        if (result === 'updated') updated++;
      } catch (e) {
        this.logger.error(
          `Failed to sync order ${order.externalId}: ${e.message}`,
        );
      }
    }

    return {
      success: true,
      fetched: orders.length,
      created,
      updated,
    };
  }

  async syncTransactions(params: {
    entityId: string;
    since?: Date;
    until?: Date;
  }) {
    await this.assertEntityExists(params.entityId);
    const transactions = await this.adapter.fetchTransactions({
      start: params.since || new Date(0),
      end: params.until || new Date(),
    });

    const channel = await this.ensureSalesChannel(params.entityId);
    let created = 0;
    let updated = 0;

    for (const tx of transactions) {
      const result = await this.upsertPayment(params.entityId, channel.id, tx);
      if (result === 'created') created++;
      if (result === 'updated') updated++;
    }

    return {
      success: true,
      fetched: transactions.length,
      created,
      updated,
    };
  }

  async getSummary(params: { entityId: string; since?: Date; until?: Date }) {
    const { entityId, since, until } = params;
    const channel = await this.ensureSalesChannel(entityId);

    const dateFilter = (field: string) => {
      const filter: any = {};
      if (since) filter.gte = since;
      if (until) filter.lte = until;
      return Object.keys(filter).length ? { [field]: filter } : {};
    };

    const paymentWhere = {
      entityId,
      channelId: channel.id,
      ...dateFilter('payoutDate'),
    };

    const [ordersAgg, paymentsAgg, ordersCount, paymentFlags] =
      await Promise.all([
        this.prisma.salesOrder.aggregate({
          where: {
            entityId,
            channelId: channel.id,
            ...dateFilter('orderDate'),
          },
          _sum: {
            totalGrossOriginal: true,
            taxAmountOriginal: true,
            discountAmountOriginal: true,
            shippingFeeOriginal: true,
          },
        }),
        this.prisma.payment.aggregate({
          where: paymentWhere,
          _sum: {
            amountGrossOriginal: true,
            amountNetOriginal: true,
            feePlatformOriginal: true,
            feeGatewayOriginal: true,
          },
        }),
        this.prisma.salesOrder.count({
          where: {
            entityId,
            channelId: channel.id,
            ...dateFilter('orderDate'),
          },
        }),
        this.prisma.payment.findMany({
          where: paymentWhere,
          select: {
            id: true,
            notes: true,
          },
        }),
      ]);

    const num = (value: any) => (value ? Number(value) : 0);
    const paymentsCount = paymentFlags.length;
    const effectiveFeeMeta = paymentFlags.map((payment) =>
      this.resolveEffectiveFeeMeta(payment.notes),
    );
    const actualFeeCount = effectiveFeeMeta.filter(
      (meta) => meta.status === 'actual',
    ).length;
    const estimatedFeeCount = effectiveFeeMeta.filter(
      (meta) => meta.status === 'estimated',
    ).length;
    const unavailableFeeCount = effectiveFeeMeta.filter(
      (meta) => meta.status === 'unavailable',
    ).length;
    const notApplicableFeeCount = effectiveFeeMeta.filter(
      (meta) => meta.status === 'not_applicable',
    ).length;
    const shopifyActualFeeCount = effectiveFeeMeta.filter(
      (meta) => meta.source === 'shopify.transaction.fee',
    ).length;
    const providerActualFeeCount = effectiveFeeMeta.filter((meta) =>
      meta.source.startsWith('provider-payout:'),
    ).length;
    const hasActualFee = actualFeeCount > 0;
    const hasEstimatedFee = estimatedFeeCount > 0;
    const hasUnavailableFee = unavailableFeeCount > 0;
    const allPaymentsAreNoFee =
      paymentsCount > 0 &&
      notApplicableFeeCount === paymentsCount &&
      !hasActualFee &&
      !hasEstimatedFee;

    let platformFeeStatus:
      | 'actual'
      | 'estimated'
      | 'mixed'
      | 'unavailable'
      | 'not_applicable'
      | 'empty' = 'empty';
    let platformFeeValue: number | null =
      num(paymentsAgg._sum.feePlatformOriginal) +
      num(paymentsAgg._sum.feeGatewayOriginal);
    let platformFeeSource = 'Payments fee total';
    let platformFeeMessage: string | null = null;

    if (!paymentsCount) {
      platformFeeStatus = 'empty';
      platformFeeSource = '尚未同步交易資料';
      platformFeeMessage = '請先執行交易同步，支付手續費才會開始計算。';
    } else if (hasActualFee && !hasEstimatedFee && !hasUnavailableFee) {
      platformFeeStatus = 'actual';
      platformFeeSource =
        providerActualFeeCount > 0
          ? '已匯入金流實際撥款對帳'
          : 'Shopify 實際交易費';
      platformFeeMessage =
        providerActualFeeCount > 0
          ? '這個期間內的手續費來自綠界 / HiTRUST 的實際撥款報表。'
          : '這個期間內的手續費來自 Shopify 回傳的實際交易資料。';
    } else if (hasEstimatedFee && !hasActualFee && !hasUnavailableFee) {
      platformFeeStatus = 'estimated';
      platformFeeSource = '已設定的金流費率規則';
      platformFeeMessage = '這個期間內的支付手續費是依金流費率規則估算。';
    } else if (hasActualFee || hasEstimatedFee) {
      platformFeeStatus = 'mixed';
      platformFeeSource =
        providerActualFeeCount > 0 || shopifyActualFeeCount > 0
          ? '實際對帳 + 金流費率規則'
          : '部分金流費率規則';
      platformFeeMessage =
        '這個期間內有部分交易已核實手續費，但仍有部分外部金流沒有實際報表或費率來源。';
    } else if (allPaymentsAreNoFee) {
      platformFeeStatus = 'not_applicable';
      platformFeeSource = '無支付手續費付款方式';
      platformFeeMessage =
        '這個期間內的交易都屬於貨到付款或其他無支付手續費付款方式。';
    } else {
      platformFeeStatus = 'unavailable';
      platformFeeSource = '外部金流未提供手續費';
      platformFeeValue = null;
      platformFeeMessage =
        '目前 Shopify 對綠界、LINE Pay 這類外部金流不會回傳實際手續費；請匯入金流撥款報表或設定費率規則。';
    }

    return {
      entityId,
      channel: SHOPIFY_CHANNEL_CODE,
      range: {
        since: since?.toISOString() || null,
        until: until?.toISOString() || null,
      },
      orders: {
        count: ordersCount,
        gross: num(ordersAgg._sum.totalGrossOriginal),
        tax: num(ordersAgg._sum.taxAmountOriginal),
        discount: num(ordersAgg._sum.discountAmountOriginal),
        shipping: num(ordersAgg._sum.shippingFeeOriginal),
      },
      payouts: {
        gross: num(paymentsAgg._sum.amountGrossOriginal),
        net: num(paymentsAgg._sum.amountNetOriginal),
        platformFee: platformFeeValue,
        platformFeeStatus,
        platformFeeSource,
        platformFeeMessage,
      },
    };
  }

  async handleWebhook(event: string, payload: any, hmacValid: boolean) {
    this.logger.log(
      `Received Shopify webhook ${event}, hmacValid=${hmacValid}`,
    );

    if (!hmacValid) {
      return { received: false, event, hmacValid };
    }

    const triggerEvents = [
      'orders/create',
      'orders/updated',
      'orders/paid',
      'refunds/create',
      'fulfillments/create',
      'fulfillments/update',
    ];

    if (triggerEvents.includes(event)) {
      try {
        await this.assertEntityExists(this.defaultEntityId);
        const channel = await this.ensureSalesChannel(this.defaultEntityId);
        const externalOrderId = this.extractExternalOrderId(event, payload);

        if (externalOrderId) {
          const orderSync = await this.syncSingleOrder(
            this.defaultEntityId,
            channel.id,
            externalOrderId,
          );
          const transactionSync = await this.syncSingleOrderTransactions(
            this.defaultEntityId,
            channel.id,
            externalOrderId,
          );

          return {
            received: true,
            event,
            hmacValid,
            externalOrderId,
            synced: {
              order: orderSync,
              transactions: transactionSync,
            },
          };
        }

        // Fallback for payloads that do not carry a direct order ID.
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        await this.syncOrders({
          entityId: this.defaultEntityId,
          since: yesterday,
        });
        await this.syncTransactions({
          entityId: this.defaultEntityId,
          since: yesterday,
        });
      } catch (error) {
        this.logger.error(
          `Auto-sync failed for event ${event}: ${error.message}`,
        );
      }
    }

    return { received: true, event, hmacValid };
  }

  private async ensureSalesChannel(entityId: string) {
    const existing = await this.prisma.salesChannel.findFirst({
      where: { entityId, code: SHOPIFY_CHANNEL_CODE },
    });

    if (existing) return existing;

    return this.prisma.salesChannel.create({
      data: {
        entityId,
        name: 'Shopify',
        code: SHOPIFY_CHANNEL_CODE,
        type: 'shopify',
        defaultCurrency: this.config.get<string>('DEFAULT_CURRENCY', 'TWD'),
      },
    });
  }

  private extractExternalOrderId(event: string, payload: any) {
    if (event.startsWith('orders/') && payload?.id) {
      return String(payload.id);
    }

    if (payload?.order_id) {
      return String(payload.order_id);
    }

    return null;
  }

  private async syncSingleOrder(
    entityId: string,
    channelId: string,
    externalOrderId: string,
  ) {
    const order = await this.adapter.fetchOrderById(externalOrderId);
    if (!order) {
      return { fetched: false, action: 'skipped' as const };
    }

    const result = await this.upsertSalesOrder(entityId, channelId, order);
    return { fetched: true, action: result };
  }

  private async syncSingleOrderTransactions(
    entityId: string,
    channelId: string,
    externalOrderId: string,
  ) {
    const transactions =
      await this.adapter.fetchTransactionsForOrder(externalOrderId);
    let created = 0;
    let updated = 0;

    for (const tx of transactions) {
      const result = await this.upsertPayment(entityId, channelId, tx);
      if (result === 'created') created++;
      if (result === 'updated') updated++;
    }

    return {
      fetched: transactions.length,
      created,
      updated,
    };
  }

  private async upsertSalesOrder(
    entityId: string,
    channelId: string,
    order: UnifiedOrder,
  ): Promise<'created' | 'updated'> {
    const existing = await this.prisma.salesOrder.findFirst({
      where: {
        entityId,
        channelId,
        externalOrderId: order.externalId,
      },
    });

    // FX Rate is already handled in Adapter, so here we just use it?
    // Wait, UnifiedOrder result depends on how Adapter constructed it.
    // In our Adapter implementation:
    // currency is set, but we didn't explicitly demand specific fields for 'Original' vs 'Base' in UnifiedOrder.
    // UnifiedOrder.totals.gross is Decimal.
    // We need to calculate Base amount here using the FX rate.

    // Oh, the Adapter's `getFxRate` is private.
    // We need the FX rate that WAS used or should be used.
    // Ideally UnifiedOrder should carry the exchange rate used, or we recalculate it?
    // Let's assume we re-fetch FX rate here or rely on the fact that we fixed the Adapter to use a better rate?
    // Actually, `UnifiedOrder` interface didn't have `fxRate`.
    // I should add `fxRate` to `UnifiedOrder` to persist it!

    // Quick fix: Add getFxRate logic here again OR update Interface.
    // Updating Interface is better.
    // But for now to avoid changing interface file again (which I just wrote),
    // I will use a helper here or duplicate the mock logic.
    // Actually, I can add `fxRate` to `UnifiedOrder` easily if I edit the interface...
    // Let's stick to calculating it here to keep `UnifiedOrder` generic?
    // No, FX rate is a property of the transaction/order time and currency.

    const currency = order.totals.currency;
    const fxRate = new Decimal(await this.getFxRate(currency, order.orderDate));

    const toBase = (amount: Decimal) => amount.mul(fxRate);

    const data = {
      orderDate: order.orderDate,
      totalGrossOriginal: order.totals.gross,
      totalGrossCurrency: currency,
      totalGrossFxRate: fxRate,
      totalGrossBase: toBase(order.totals.gross),
      taxAmountOriginal: order.totals.tax,
      taxAmountCurrency: currency,
      taxAmountFxRate: fxRate,
      taxAmountBase: toBase(order.totals.tax),
      discountAmountOriginal: order.totals.discount,
      discountAmountCurrency: currency,
      discountAmountFxRate: fxRate,
      discountAmountBase: toBase(order.totals.discount),
      shippingFeeOriginal: order.totals.shipping,
      shippingFeeCurrency: currency,
      shippingFeeFxRate: fxRate,
      shippingFeeBase: toBase(order.totals.shipping),
      status: order.status,
      // hasInvoice: existing?.hasInvoice ?? false, // Keep existing flag
      notes: this.mergeShopifyOrderMetadataIntoNotes(existing?.notes, order),
    };

    if (existing) {
      const updated = await this.prisma.salesOrder.update({
        where: { id: existing.id },
        data: {
          ...data,
          hasInvoice: existing.hasInvoice, // Preserve
        },
      });
      await this.syncSalesOrderItems(updated.id, entityId, order, currency, fxRate);
      return 'updated';
    }

    const created = await this.prisma.salesOrder.create({
      data: {
        entityId,
        channelId,
        externalOrderId: order.externalId,
        hasInvoice: false,
        ...data,
        customerId: order.customer
          ? await this.ensureCustomer(entityId, order.customer)
          : undefined,
      },
    });
    await this.syncSalesOrderItems(created.id, entityId, order, currency, fxRate);
    return 'created';
  }

  private async syncSalesOrderItems(
    salesOrderId: string,
    entityId: string,
    order: UnifiedOrder,
    currency: string,
    fxRate: Decimal,
  ) {
    await this.prisma.salesOrderItem.deleteMany({ where: { salesOrderId } });

    for (const [index, item] of (order.items || []).entries()) {
      const sku = this.normalizeLineItemSku(order.externalId, item.sku, index);
      const product = await this.prisma.product.upsert({
        where: { entityId_sku: { entityId, sku } },
        update: {
          name: item.productName || sku,
          salesPrice: item.unitPrice || new Decimal(0),
          isActive: true,
        },
        create: {
          entityId,
          sku,
          name: item.productName || sku,
          salesPrice: item.unitPrice || new Decimal(0),
          purchaseCost: new Decimal(0),
        },
      });

      const quantity = new Decimal(item.quantity || 1);
      const unitPrice = item.unitPrice || new Decimal(0);
      const discount = item.discount || new Decimal(0);
      const tax = item.tax || new Decimal(0);

      await this.prisma.salesOrderItem.create({
        data: {
          salesOrderId,
          productId: product.id,
          qty: quantity,
          unitPriceOriginal: unitPrice,
          unitPriceCurrency: currency,
          unitPriceFxRate: fxRate,
          unitPriceBase: unitPrice.mul(fxRate),
          discountOriginal: discount,
          discountCurrency: currency,
          discountFxRate: fxRate,
          discountBase: discount.mul(fxRate),
          taxAmountOriginal: tax,
          taxAmountCurrency: currency,
          taxAmountFxRate: fxRate,
          taxAmountBase: tax.mul(fxRate),
        },
      });
    }
  }

  private normalizeLineItemSku(orderId: string, sku: string | undefined, index: number) {
    const normalized = (sku || '').trim();
    if (normalized && normalized !== 'UNKNOWN') {
      return normalized.slice(0, 120);
    }
    return `SHOPIFY-${orderId}-${index + 1}`.slice(0, 120);
  }

  private mergeShopifyOrderMetadataIntoNotes(
    existingNotes: string | null | undefined,
    order: UnifiedOrder,
  ) {
    const raw = order.raw || {};
    const parts = [
      `shopifyOrderId=${this.sanitizeNoteValue(order.externalId)}`,
      raw.name
        ? `shopifyOrderName=${this.sanitizeNoteValue(raw.name)}`
        : null,
      raw.order_number
        ? `shopifyOrderNumber=${this.sanitizeNoteValue(raw.order_number)}`
        : null,
      raw.note ? `shopifyNote=${this.sanitizeNoteValue(raw.note)}` : null,
    ].filter((part): part is string => Boolean(part));

    const preservedNotes = (existingNotes || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[shopify-order]'));

    if (parts.length) {
      preservedNotes.push(`[shopify-order] ${parts.join('; ')}`);
    }

    return preservedNotes.length ? preservedNotes.join('\n') : null;
  }

  private sanitizeNoteValue(value: unknown) {
    return String(value ?? '')
      .trim()
      .replace(/[;\n\r]/g, ',');
  }

  private async upsertPayment(
    entityId: string,
    channelId: string,
    tx: UnifiedTransaction,
  ): Promise<'created' | 'updated'> {
    const existing = await this.prisma.payment.findFirst({
      where: {
        entityId,
        channelId,
        payoutBatchId: tx.externalId, // Using transaction ID as batch ID if generic
      },
    });

    const salesOrder = tx.orderId
      ? await this.prisma.salesOrder.findFirst({
          where: {
            entityId,
            channelId,
            externalOrderId: tx.orderId,
          },
        })
      : null;

    const currency = tx.currency;
    const fxRate = new Decimal(await this.getFxRate(currency, tx.date));
    const toBase = (amount: Decimal) => amount.mul(fxRate);
    const hasLockedProviderPayout = this.hasLockedProviderPayout(
      existing?.notes,
    );

    const paymentNotes = this.buildPaymentNotes(existing?.notes, tx);
    const data = {
      entityId,
      channelId,
      salesOrderId: salesOrder?.id ?? null,
      payoutBatchId: tx.externalId,
      channel: 'SHOPIFY',
      payoutDate: tx.date,
      amountGrossOriginal: tx.amount, // Start with Gross
      amountGrossCurrency: currency,
      amountGrossFxRate: fxRate,
      amountGrossBase: toBase(tx.amount),
      // Platform Fee
      feePlatformOriginal: hasLockedProviderPayout
        ? existing?.feePlatformOriginal || new Decimal(0)
        : tx.fee,
      feePlatformCurrency: currency,
      feePlatformFxRate: fxRate,
      feePlatformBase: hasLockedProviderPayout
        ? existing?.feePlatformBase || new Decimal(0)
        : toBase(tx.fee),
      // Gateway Fee (Treat as Platform Fee or Separate? System has feeGateway)
      feeGatewayOriginal: hasLockedProviderPayout
        ? existing?.feeGatewayOriginal || new Decimal(0)
        : new Decimal(0),
      feeGatewayCurrency: currency,
      feeGatewayFxRate: fxRate,
      feeGatewayBase: hasLockedProviderPayout
        ? existing?.feeGatewayBase || new Decimal(0)
        : new Decimal(0),

      shippingFeePaidOriginal: new Decimal(0),
      shippingFeePaidCurrency: currency,
      shippingFeePaidFxRate: fxRate,
      shippingFeePaidBase: new Decimal(0),

      amountNetOriginal: hasLockedProviderPayout
        ? existing?.amountNetOriginal || tx.net
        : tx.net,
      amountNetCurrency: currency,
      amountNetFxRate: fxRate,
      amountNetBase: hasLockedProviderPayout
        ? existing?.amountNetBase || toBase(tx.net)
        : toBase(tx.net),

      reconciledFlag: hasLockedProviderPayout
        ? existing?.reconciledFlag || false
        : false,
      bankAccountId: null,
      notes: paymentNotes,
    };

    if (existing) {
      await this.prisma.payment.update({
        where: { id: existing.id },
        data,
      });
      return 'updated';
    }

    await this.prisma.payment.create({ data });
    return 'created';
  }

  private async ensureCustomer(
    entityId: string,
    customerData: NonNullable<UnifiedOrder['customer']>,
  ) {
    // Check by email or external ID
    let customer = null;
    if (customerData.email) {
      customer = await this.prisma.customer.findFirst({
        where: { entityId, email: customerData.email },
      });
    }

    if (!customer && customerData.externalId) {
      // Search schema doesn't strictly have externalId on Customer unless in 'notes' or custom fields?
      // We'll check email only for now or create new.
    }

    if (customer) return customer.id;

    const newCustomer = await this.prisma.customer.create({
      data: {
        entityId,
        name: customerData.name || 'Unknown',
        email: customerData.email,
        phone: customerData.phone,
        // code field does not exist in schema
      },
    });
    return newCustomer.id;
  }

  private async assertEntityExists(entityId: string) {
    if (!entityId?.trim()) {
      throw new BadRequestException('entityId is required');
    }

    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true },
    });

    if (!entity) {
      throw new BadRequestException(`Entity not found: ${entityId}.`);
    }
  }

  // Duplicate helper for now. In future, use FxService.
  private async getFxRate(currency: string, date: Date): Promise<number> {
    if (currency === 'TWD') return 1;
    if (currency === 'USD') return 32.5;
    if (currency === 'CNY') return 4.5;
    if (currency === 'JPY') return 0.21;
    return 1;
  }

  private buildPaymentNotes(
    existingNotes: string | null | undefined,
    tx: UnifiedTransaction,
  ) {
    const gateway = tx.gateway?.trim();
    const feeStatus = tx.feeStatus || 'unavailable';
    const feeSource = tx.feeSource || 'unknown';
    const parts = [`feeStatus=${feeStatus}`, `feeSource=${feeSource}`];
    const providerMetadata = this.extractProviderMetadata(tx);

    if (gateway) {
      parts.push(`gateway=${gateway}`);
    }

    parts.push(`shopifyTxnId=${tx.externalId}`);
    if (tx.orderId) {
      parts.push(`shopifyOrderId=${tx.orderId}`);
    }
    if (providerMetadata.providerPaymentId) {
      parts.push(`providerPaymentId=${providerMetadata.providerPaymentId}`);
    }
    if (providerMetadata.providerTradeNo) {
      parts.push(`providerTradeNo=${providerMetadata.providerTradeNo}`);
    }
    if (providerMetadata.authorization) {
      parts.push(`authorization=${providerMetadata.authorization}`);
    }

    const syncNote = `[shopify-sync] ${parts.join('; ')}`;
    const preservedNotes = (existingNotes || '')
      .split('\n')
      .filter((line) => !line.startsWith('[shopify-sync]'))
      .join('\n')
      .trim();

    return preservedNotes ? `${preservedNotes}\n${syncNote}` : syncNote;
  }

  private hasLockedProviderPayout(notes: string | null | undefined) {
    const text = notes || '';
    return (
      text.includes('[provider-payout]') && text.includes('feeStatus=actual')
    );
  }

  private resolveEffectiveFeeMeta(notes: string | null | undefined) {
    const parsedLines = (notes || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('] ');
        if (separator < 0) {
          return null;
        }

        const scope = line.slice(1, separator);
        const meta: Record<string, string> = {};
        for (const pair of line.slice(separator + 2).split(';')) {
          const [key, ...rest] = pair.split('=');
          if (!key || !rest.length) {
            continue;
          }
          meta[key.trim()] = rest.join('=').trim();
        }

        return { scope, meta };
      })
      .filter(
        (
          value,
        ): value is {
          scope: string;
          meta: Record<string, string>;
        } => Boolean(value),
      );

    const providerLine = parsedLines.find(
      (line) => line.scope === 'provider-payout',
    );
    if (providerLine?.meta.feeStatus && providerLine.meta.feeSource) {
      return {
        status: providerLine.meta.feeStatus,
        source: providerLine.meta.feeSource,
      };
    }

    const shopifyLine = parsedLines.find(
      (line) => line.scope === 'shopify-sync',
    );
    return {
      status: shopifyLine?.meta.feeStatus || 'unavailable',
      source: shopifyLine?.meta.feeSource || 'unknown',
    };
  }

  private extractProviderMetadata(tx: UnifiedTransaction) {
    const raw = tx.raw || {};
    const receipt = raw.receipt || {};
    const pick = (...values: Array<unknown>) =>
      values
        .map((value) =>
          value === null || value === undefined ? '' : String(value).trim(),
        )
        .find((value) => value);

    return {
      providerPaymentId: pick(
        receipt.payment_id,
        receipt.PaymentID,
        raw.payment_id,
      ),
      providerTradeNo: pick(
        receipt.trade_no,
        receipt.TradeNo,
        receipt.merchant_trade_no,
        receipt.MerchantTradeNo,
        raw.trade_no,
      ),
      authorization: pick(receipt.authorization, raw.authorization),
    };
  }
}
