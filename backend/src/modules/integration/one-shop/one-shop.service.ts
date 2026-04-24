import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { OneShopHttpAdapter } from './one-shop.adapter';
import {
  UnifiedOrder,
  UnifiedTransaction,
} from '../interfaces/sales-channel-adapter.interface';

const ONESHOP_CHANNEL_CODE = '1SHOP';

@Injectable()
export class OneShopService implements OnModuleInit {
  private readonly logger = new Logger(OneShopService.name);
  private defaultEntityId = 'tw-entity-001';

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: OneShopHttpAdapter,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.defaultEntityId =
      this.config.get<string>('ONESHOP_DEFAULT_ENTITY_ID') || 'tw-entity-001';
  }

  private createSyncWindowCaches() {
    return {
      salesOrdersByExternalId: new Map<string, any>(),
      paymentsByExternalId: new Map<string, any>(),
      customersByEmail: new Map<string, any>(),
      customersByPhone: new Map<string, any>(),
    };
  }

  async testConnection() {
    return this.adapter.testConnection();
  }

  assertSchedulerToken(providedToken?: string | null) {
    const expected =
      this.config.get<string>('ONESHOP_SYNC_JOB_TOKEN', '') ||
      this.config.get<string>('SHOPIFY_SYNC_JOB_TOKEN', '') ||
      '';

    if (!expected) {
      throw new UnauthorizedException(
        'ONESHOP_SYNC_JOB_TOKEN is not configured',
      );
    }

    if (!providedToken || providedToken !== expected) {
      throw new UnauthorizedException('Invalid scheduler token');
    }
  }

  getConnectionInfo() {
    return {
      stores: this.adapter.getStores().map((store) => ({
        account: store.account || null,
        storeName: store.storeName || null,
      })),
      apiBaseUrl:
        this.config.get<string>('ONESHOP_API_BASE_URL', '') ||
        'https://api.1shop.tw/v1',
      authMode: 'query.appid_secret',
      fixedEgressIp:
        this.config.get<string>('CLOUD_RUN_FIXED_EGRESS_IP', '') ||
        '104.199.246.28',
      rateLimit: '10 requests / 10 seconds / appid',
      environment: 'production_only',
      webhookStatus: 'pending_vendor_confirmation',
    };
  }

  async syncOrders(params: { entityId: string; since?: Date; until?: Date }) {
    await this.assertEntityExists(params.entityId);

    const orders = await this.adapter.fetchOrders({
      start: params.since || new Date(0),
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
      } catch (error: any) {
        this.logger.error(
          `Failed to sync 1Shop order ${order.externalId}: ${error.message}`,
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
      try {
        const result = await this.upsertPayment(params.entityId, channel.id, tx);
        if (result === 'created') created++;
        if (result === 'updated') updated++;
      } catch (error: any) {
        this.logger.error(
          `Failed to sync 1Shop payment ${tx.externalId}: ${error.message}`,
        );
      }
    }

    return {
      success: true,
      fetched: transactions.length,
      created,
      updated,
    };
  }

  async autoSync(options?: {
    entityId?: string;
    since?: Date;
    until?: Date;
  }) {
    const enabled =
      this.config.get<string>('ONESHOP_SYNC_ENABLED', 'false') === 'true';

    if (!enabled) {
      return {
        success: false,
        skipped: true,
        message: 'ONESHOP_SYNC_ENABLED is false',
      };
    }

    const entityId = options?.entityId || this.defaultEntityId;
    const lookbackDays = Number(
      this.config.get<string>('ONESHOP_SYNC_LOOKBACK_DAYS', '3'),
    );
    const until = options?.until || new Date();
    const since =
      options?.since ||
      new Date(until.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const { orders, transactions } = await this.syncWindow({
      entityId,
      since,
      until,
      includeDetails: true,
    });

    return {
      success: true,
      entityId,
      since: since.toISOString(),
      until: until.toISOString(),
      orders,
      transactions,
    };
  }

  async backfillHistory(params: {
    entityId: string;
    beginDate: Date;
    endDate: Date;
    windowDays?: number;
    maxWindows?: number;
  }) {
    await this.assertEntityExists(params.entityId);

    const begin = new Date(params.beginDate);
    const end = new Date(params.endDate);
    const windowDays = Math.min(Math.max(params.windowDays || 30, 7), 90);

    if (Number.isNaN(begin.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('beginDate / endDate must be valid dates');
    }

    if (begin > end) {
      throw new BadRequestException('beginDate cannot be later than endDate');
    }

    const allWindows: Array<{
      since: Date;
      until: Date;
    }> = [];

    let cursor = new Date(begin);
    while (cursor <= end) {
      const windowStart = new Date(cursor);
      const windowEnd = new Date(cursor);
      windowEnd.setDate(windowEnd.getDate() + windowDays - 1);
      if (windowEnd > end) {
        windowEnd.setTime(end.getTime());
      }

      allWindows.push({
        since: windowStart,
        until: windowEnd,
      });

      cursor = new Date(windowEnd);
      cursor.setDate(cursor.getDate() + 1);
    }

    const selectedWindows =
      params.maxWindows && params.maxWindows > 0
        ? allWindows.slice(0, params.maxWindows)
        : allWindows;

    const windows: Array<{
      index: number;
      since: string;
      until: string;
      orders: Awaited<ReturnType<OneShopService['syncOrders']>>;
      transactions: Awaited<ReturnType<OneShopService['syncTransactions']>>;
    }> = [];

    const totals = {
      orderFetched: 0,
      orderCreated: 0,
      orderUpdated: 0,
      transactionFetched: 0,
      transactionCreated: 0,
      transactionUpdated: 0,
    };

    let windowIndex = 1;

    for (const window of selectedWindows) {
      const windowStart = new Date(window.since);
      const windowEnd = new Date(window.until);
      const { orders, transactions } = await this.syncWindow({
        entityId: params.entityId,
        since: windowStart,
        until: windowEnd,
        includeDetails: false,
      });

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

      windowIndex += 1;
    }

    const remainingWindows = Math.max(allWindows.length - selectedWindows.length, 0);
    const lastWindow = selectedWindows[selectedWindows.length - 1];
    const nextBeginDate =
      remainingWindows > 0 && lastWindow
        ? new Date(lastWindow.until.getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null;

    return {
      success: true,
      entityId: params.entityId,
      beginDate: selectedWindows[0]?.since.toISOString() || begin.toISOString(),
      endDate:
        selectedWindows[selectedWindows.length - 1]?.until.toISOString() ||
        end.toISOString(),
      windowDays,
      windowCount: windows.length,
      totalWindowCount: allWindows.length,
      remainingWindows,
      nextBeginDate,
      completedAllWindows: remainingWindows === 0,
      totals,
      windows,
    };
  }

  async getSummary(params: { entityId: string; since?: Date; until?: Date }) {
    const { entityId, since, until } = params;
    const channel = await this.ensureSalesChannel(entityId);

    const dateFilter = (field: string) => {
      const filter: Record<string, Date> = {};
      if (since) filter.gte = since;
      if (until) filter.lte = until;
      return Object.keys(filter).length ? { [field]: filter } : {};
    };

    const ordersWhere = {
      entityId,
      channelId: channel.id,
      ...dateFilter('orderDate'),
    };
    const paymentsWhere = {
      entityId,
      channelId: channel.id,
      ...dateFilter('payoutDate'),
    };

    const [ordersAgg, ordersCount, paymentsAgg, reconciledCount, paymentCount] =
      await Promise.all([
      this.prisma.salesOrder.aggregate({
        where: ordersWhere,
        _sum: {
          totalGrossOriginal: true,
          taxAmountOriginal: true,
          discountAmountOriginal: true,
          shippingFeeOriginal: true,
        },
      }),
      this.prisma.salesOrder.count({
        where: ordersWhere,
      }),
      this.prisma.payment.aggregate({
        where: paymentsWhere,
        _sum: {
          amountGrossOriginal: true,
          amountNetOriginal: true,
          feePlatformOriginal: true,
          feeGatewayOriginal: true,
        },
      }),
      this.prisma.payment.count({
        where: {
          ...paymentsWhere,
          reconciledFlag: true,
        },
      }),
      this.prisma.payment.count({
        where: paymentsWhere,
      }),
    ]);

    const num = (value: Decimal | number | null | undefined) =>
      value ? Number(value) : 0;

    return {
      entityId,
      channel: ONESHOP_CHANNEL_CODE,
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
        platformFee:
          num(paymentsAgg._sum.feePlatformOriginal) +
          num(paymentsAgg._sum.feeGatewayOriginal),
        platformFeeStatus: paymentCount
          ? reconciledCount > 0
            ? 'mixed'
            : 'unavailable'
          : 'empty',
        platformFeeSource:
          reconciledCount > 0
            ? '1Shop 訂單 + 綠界/對帳資料'
            : '1Shop 訂單明細 / 待撥款對帳',
        platformFeeMessage:
          reconciledCount > 0
            ? `已有 ${reconciledCount} 筆收款完成對帳，其餘仍待撥款或待匯入對帳單。`
            : '目前已建立待對帳收款紀錄，待綠界撥款或匯入對帳單後可回填實際手續費與淨額。',
        paymentCount,
        reconciledCount,
      },
    };
  }

  private async syncWindow(params: {
    entityId: string;
    since: Date;
    until: Date;
    includeDetails?: boolean;
  }) {
    await this.assertEntityExists(params.entityId);

    const startedAt = Date.now();
    const orders = await this.adapter.fetchOrders(
      {
        start: params.since,
        end: params.until,
      },
      {
        includeDetails: params.includeDetails,
      },
    );
    const transactions = this.adapter.buildTransactionsFromOrders(orders);
    const channel = await this.ensureSalesChannel(params.entityId);
    const caches = this.createSyncWindowCaches();
    await this.primeSyncWindowCaches(
      params.entityId,
      channel.id,
      orders,
      transactions,
      caches,
    );

    let orderCreated = 0;
    let orderUpdated = 0;
    for (const order of orders) {
      try {
        const result = await this.upsertSalesOrder(
          params.entityId,
          channel.id,
          order,
          caches,
        );
        if (result === 'created') orderCreated += 1;
        if (result === 'updated') orderUpdated += 1;
      } catch (error: any) {
        this.logger.error(
          `Failed to sync 1Shop order ${order.externalId}: ${error.message}`,
        );
      }
    }

    let transactionCreated = 0;
    let transactionUpdated = 0;
    for (const tx of transactions) {
      try {
        const result = await this.upsertPayment(
          params.entityId,
          channel.id,
          tx,
          caches,
        );
        if (result === 'created') transactionCreated += 1;
        if (result === 'updated') transactionUpdated += 1;
      } catch (error: any) {
        this.logger.error(
          `Failed to sync 1Shop payment ${tx.externalId}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      [
        '[1shop-sync-window]',
        `entityId=${params.entityId}`,
        `since=${params.since.toISOString()}`,
        `until=${params.until.toISOString()}`,
        `includeDetails=${params.includeDetails !== false}`,
        `orders=${orders.length}`,
        `transactions=${transactions.length}`,
        `durationMs=${Date.now() - startedAt}`,
      ].join(' '),
    );

    return {
      orders: {
        success: true,
        fetched: orders.length,
        created: orderCreated,
        updated: orderUpdated,
      },
      transactions: {
        success: true,
        fetched: transactions.length,
        created: transactionCreated,
        updated: transactionUpdated,
      },
    };
  }

  private async primeSyncWindowCaches(
    entityId: string,
    channelId: string,
    orders: UnifiedOrder[],
    transactions: UnifiedTransaction[],
    caches: ReturnType<OneShopService['createSyncWindowCaches']>,
  ) {
    const uniqueOrderIds = [...new Set(orders.map((order) => order.externalId))];
    const uniquePaymentIds = [
      ...new Set(transactions.map((tx) => tx.externalId).filter(Boolean)),
    ];
    const uniqueEmails = [
      ...new Set(
        orders
          .map((order) => order.customer?.email?.trim().toLowerCase())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const uniquePhones = [
      ...new Set(
        orders
          .map((order) => order.customer?.phone?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    const [existingOrders, existingPayments, customersByEmail, customersByPhone] =
      await Promise.all([
        uniqueOrderIds.length
          ? this.prisma.salesOrder.findMany({
              where: {
                entityId,
                channelId,
                externalOrderId: { in: uniqueOrderIds },
              },
            })
          : Promise.resolve([]),
        uniquePaymentIds.length
          ? this.prisma.payment.findMany({
              where: {
                entityId,
                channelId,
                payoutBatchId: { in: uniquePaymentIds },
              },
            })
          : Promise.resolve([]),
        uniqueEmails.length
          ? this.prisma.customer.findMany({
              where: {
                entityId,
                email: { in: uniqueEmails },
              },
            })
          : Promise.resolve([]),
        uniquePhones.length
          ? this.prisma.customer.findMany({
              where: {
                entityId,
                phone: { in: uniquePhones },
              },
            })
          : Promise.resolve([]),
      ]);

    for (const order of existingOrders) {
      caches.salesOrdersByExternalId.set(order.externalOrderId, order);
    }

    for (const payment of existingPayments) {
      if (payment.payoutBatchId) {
        caches.paymentsByExternalId.set(payment.payoutBatchId, payment);
      }
    }

    for (const customer of customersByEmail) {
      if (customer.email) {
        caches.customersByEmail.set(customer.email.trim().toLowerCase(), customer);
      }
    }

    for (const customer of customersByPhone) {
      if (customer.phone) {
        caches.customersByPhone.set(customer.phone.trim(), customer);
      }
    }
  }

  @Cron('0 40 8 * * *', {
    name: 'oneShopOrderSync',
    timeZone: 'Asia/Taipei',
  })
  async handleScheduledSync() {
    const enabled =
      this.config.get<string>('ONESHOP_SYNC_ENABLED', 'false') === 'true';

    if (!enabled) {
      return;
    }

    const lookbackDays = Number(
      this.config.get<string>('ONESHOP_SYNC_LOOKBACK_DAYS', '3'),
    );
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    try {
      const result = await this.autoSync({
        entityId: this.defaultEntityId,
        since,
        until: new Date(),
      });

      this.logger.log(
        `Scheduled 1Shop sync finished: orders=${result.orders.fetched}, transactions=${result.transactions.fetched}`,
      );
    } catch (error: any) {
      this.logger.error(`Scheduled 1Shop sync failed: ${error.message}`);
    }
  }

  private async ensureSalesChannel(entityId: string) {
    const existing = await this.prisma.salesChannel.findFirst({
      where: { entityId, code: ONESHOP_CHANNEL_CODE },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.salesChannel.create({
      data: {
        entityId,
        name: '1shop 團購',
        code: ONESHOP_CHANNEL_CODE,
        type: 'group_buy',
        defaultCurrency: 'TWD',
        configJson: {
          stores: this.adapter.getStores().map((store) => ({
            account: store.account || null,
            storeName: store.storeName || null,
          })),
          apiBaseUrl:
            this.config.get<string>('ONESHOP_API_BASE_URL', '') ||
            'https://api.1shop.tw/v1',
        },
      },
    });
  }

  private async upsertSalesOrder(
    entityId: string,
    channelId: string,
    order: UnifiedOrder,
    caches?: ReturnType<OneShopService['createSyncWindowCaches']>,
  ): Promise<'created' | 'updated'> {
    const existing =
      caches?.salesOrdersByExternalId.get(order.externalId) ||
      (await this.prisma.salesOrder.findFirst({
        where: {
          entityId,
          channelId,
          externalOrderId: order.externalId,
        },
      }));

    const currency = order.totals.currency;
    const fxRate = new Decimal(await this.getFxRate(currency));
    const toBase = (amount: Decimal) => amount.mul(fxRate);

    const customerId = order.customer
      ? await this.ensureCustomer(entityId, order.customer, caches)
      : undefined;

    const data = {
      customerId,
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
      notes: this.buildOrderNotes(order),
    };

    if (existing) {
      const updated = await this.prisma.salesOrder.update({
        where: { id: existing.id },
        data: {
          ...data,
          hasInvoice: existing.hasInvoice || this.hasEmbeddedInvoice(order),
        },
      });
      await this.syncSalesOrderItems(updated.id, entityId, order, currency, fxRate);
      await this.syncEmbeddedInvoice(updated.id, entityId, order, currency, fxRate);
      await this.syncPendingPaymentDraft(updated.id, entityId, channelId, order, currency, fxRate);
      caches?.salesOrdersByExternalId.set(order.externalId, updated);
      return 'updated';
    }

    const created = await this.prisma.salesOrder.create({
      data: {
        entityId,
        channelId,
        externalOrderId: order.externalId,
        hasInvoice: this.hasEmbeddedInvoice(order),
        ...data,
      },
    });
    await this.syncSalesOrderItems(created.id, entityId, order, currency, fxRate);
    await this.syncEmbeddedInvoice(created.id, entityId, order, currency, fxRate);
    await this.syncPendingPaymentDraft(created.id, entityId, channelId, order, currency, fxRate);
    caches?.salesOrdersByExternalId.set(order.externalId, created);

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
    return `1SHOP-${orderId}-${index + 1}`.slice(0, 120);
  }

  private hasEmbeddedInvoice(order: UnifiedOrder) {
    const receipt = Array.isArray(order.raw?.receipt) ? order.raw.receipt[0] : null;
    return Boolean(
      receipt &&
        typeof receipt.invoice_number === 'string' &&
        receipt.invoice_number.trim(),
    );
  }

  private async syncEmbeddedInvoice(
    salesOrderId: string,
    entityId: string,
    order: UnifiedOrder,
    currency: string,
    fxRate: Decimal,
  ) {
    const receipt = Array.isArray(order.raw?.receipt) ? order.raw.receipt[0] : null;
    const invoiceNumber =
      receipt && typeof receipt.invoice_number === 'string'
        ? receipt.invoice_number.trim()
        : '';
    if (!invoiceNumber) {
      return;
    }

    const issuedAtRaw =
      receipt && typeof receipt.invoice_date === 'string'
        ? receipt.invoice_date.trim()
        : '';
    const issuedAt = issuedAtRaw
      ? new Date(`${issuedAtRaw.replace(' ', 'T')}+08:00`)
      : order.orderDate;
    const taxRate = new Decimal(0.05);
    const totalAmountOriginal = order.totals.gross;
    const amountOriginal = totalAmountOriginal
      .div(new Decimal(1).plus(taxRate))
      .toDecimalPlaces(2);
    const taxAmountOriginal = totalAmountOriginal
      .sub(amountOriginal)
      .toDecimalPlaces(2);
    const totalAmountBase = totalAmountOriginal.mul(fxRate).toDecimalPlaces(2);
    const amountBase = amountOriginal.mul(fxRate).toDecimalPlaces(2);
    const taxAmountBase = taxAmountOriginal.mul(fxRate).toDecimalPlaces(2);

    const buyerName =
      typeof receipt?.receipt_title === 'string' && receipt.receipt_title.trim()
        ? receipt.receipt_title.trim()
        : order.customer?.name?.trim() || null;
    const buyerTaxId =
      typeof receipt?.tax_num === 'string' && receipt.tax_num.trim()
        ? receipt.tax_num.trim()
        : null;
    const buyerEmail =
      typeof receipt?.email === 'string' && receipt.email.trim()
        ? receipt.email.trim()
        : order.customer?.email?.trim() || null;
    const buyerPhone =
      typeof receipt?.phone === 'string' && receipt.phone.trim()
        ? receipt.phone.trim()
        : order.customer?.phone?.trim() || null;
    const buyerAddress =
      typeof receipt?.address === 'string' && receipt.address.trim()
        ? receipt.address.trim()
        : null;

    const invoice = await this.prisma.invoice.upsert({
      where: { invoiceNumber },
      create: {
        entityId,
        orderId: salesOrderId,
        invoiceNumber,
        status: 'issued',
        invoiceType: buyerTaxId ? 'B2B' : 'B2C',
        issuedAt,
        buyerName,
        buyerTaxId,
        buyerEmail,
        buyerPhone,
        buyerAddress,
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
        externalInvoiceId: invoiceNumber,
        externalPlatform: 'ecpay',
        externalPayload: receipt || undefined,
        notes: '[1shop-receipt]',
      },
      update: {
        orderId: salesOrderId,
        status: 'issued',
        invoiceType: buyerTaxId ? 'B2B' : 'B2C',
        issuedAt,
        buyerName,
        buyerTaxId,
        buyerEmail,
        buyerPhone,
        buyerAddress,
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
        externalInvoiceId: invoiceNumber,
        externalPlatform: 'ecpay',
        externalPayload: receipt || undefined,
        notes: '[1shop-receipt]',
      },
    });

    await this.prisma.salesOrder.update({
      where: { id: salesOrderId },
      data: {
        hasInvoice: true,
        invoiceId: invoice.id,
      },
    });
  }

  private async syncPendingPaymentDraft(
    salesOrderId: string,
    entityId: string,
    channelId: string,
    order: UnifiedOrder,
    currency: string,
    fxRate: Decimal,
  ) {
    const paymentStatus =
      typeof order.raw?.payment_status === 'string'
        ? order.raw.payment_status.trim().toLowerCase()
        : '';
    const providerPaymentId =
      typeof order.raw?.payment_third_party_no === 'string'
        ? order.raw.payment_third_party_no.trim()
        : typeof order.raw?.logistics_third_party_no === 'string'
          ? order.raw.logistics_third_party_no.trim()
          : '';

    if (paymentStatus && paymentStatus !== 'pending') {
      return;
    }

    if (providerPaymentId) {
      return;
    }

    const existing = await this.prisma.payment.findFirst({
      where: {
        entityId,
        salesOrderId,
      },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    const zero = new Decimal(0);
    const expectedGross = order.totals.gross.toDecimalPlaces(2);
    const notes = [
      '[1shop-payment-draft]',
      `oneShopOrderId=${order.externalId}`,
      `paymentStatus=${paymentStatus || 'pending'}`,
      `expectedGross=${expectedGross.toFixed(2)}`,
      'feeStatus=unavailable',
      'feeSource=awaiting_payment',
    ].join('; ');

    await this.prisma.payment.create({
      data: {
        entityId,
        channelId,
        salesOrderId,
        payoutBatchId: `draft:${order.externalId}`,
        channel: ONESHOP_CHANNEL_CODE,
        payoutDate: order.orderDate,
        amountGrossOriginal: zero,
        amountGrossCurrency: currency,
        amountGrossFxRate: fxRate,
        amountGrossBase: zero,
        feePlatformOriginal: zero,
        feePlatformCurrency: currency,
        feePlatformFxRate: fxRate,
        feePlatformBase: zero,
        feeGatewayOriginal: zero,
        feeGatewayCurrency: currency,
        feeGatewayFxRate: fxRate,
        feeGatewayBase: zero,
        shippingFeePaidOriginal: zero,
        shippingFeePaidCurrency: currency,
        shippingFeePaidFxRate: fxRate,
        shippingFeePaidBase: zero,
        amountNetOriginal: zero,
        amountNetCurrency: currency,
        amountNetFxRate: fxRate,
        amountNetBase: zero,
        reconciledFlag: false,
        bankAccountId: null,
        status: 'pending',
        notes,
      },
    });
  }

  private async upsertPayment(
    entityId: string,
    channelId: string,
    tx: UnifiedTransaction,
    caches?: ReturnType<OneShopService['createSyncWindowCaches']>,
  ): Promise<'created' | 'updated'> {
    const salesOrder = tx.orderId
      ? caches?.salesOrdersByExternalId.get(tx.orderId) ||
        (await this.prisma.salesOrder.findFirst({
          where: {
            entityId,
            channelId,
            externalOrderId: tx.orderId,
          },
        }))
      : null;

    const existing =
      caches?.paymentsByExternalId.get(tx.externalId) ||
      (await this.prisma.payment.findFirst({
        where: {
          entityId,
          channelId,
          payoutBatchId: tx.externalId,
        },
      }));

    const currency = tx.currency || 'TWD';
    const fxRate = new Decimal(await this.getFxRate(currency));
    const zero = new Decimal(0);
    const draftPaymentId = tx.orderId ? `draft:${tx.orderId}` : null;

    if (draftPaymentId && tx.status !== 'pending') {
      await this.prisma.payment.deleteMany({
        where: {
          entityId,
          channelId,
          salesOrderId: salesOrder?.id ?? undefined,
          payoutBatchId: draftPaymentId,
          status: 'pending',
        },
      });
    }

    const hasLockedProviderPayout = this.hasLockedProviderPayout(existing?.notes);
    const paymentNotes = this.buildPaymentNotes(existing?.notes, tx);

    const data = {
      entityId,
      channelId,
      salesOrderId: salesOrder?.id ?? null,
      payoutBatchId: tx.externalId,
      channel: ONESHOP_CHANNEL_CODE,
      payoutDate: tx.date,
      amountGrossOriginal: tx.amount,
      amountGrossCurrency: currency,
      amountGrossFxRate: fxRate,
      amountGrossBase: tx.amount.mul(fxRate),
      feePlatformOriginal: hasLockedProviderPayout ? existing?.feePlatformOriginal || zero : tx.fee,
      feePlatformCurrency: currency,
      feePlatformFxRate: fxRate,
      feePlatformBase: hasLockedProviderPayout
        ? existing?.feePlatformBase || zero
        : tx.fee.mul(fxRate),
      feeGatewayOriginal: hasLockedProviderPayout ? existing?.feeGatewayOriginal || zero : zero,
      feeGatewayCurrency: currency,
      feeGatewayFxRate: fxRate,
      feeGatewayBase: hasLockedProviderPayout ? existing?.feeGatewayBase || zero : zero,
      shippingFeePaidOriginal: zero,
      shippingFeePaidCurrency: currency,
      shippingFeePaidFxRate: fxRate,
      shippingFeePaidBase: zero,
      amountNetOriginal: hasLockedProviderPayout ? existing?.amountNetOriginal || tx.net : tx.net,
      amountNetCurrency: currency,
      amountNetFxRate: fxRate,
      amountNetBase: hasLockedProviderPayout
        ? existing?.amountNetBase || tx.net.mul(fxRate)
        : tx.net.mul(fxRate),
      reconciledFlag: hasLockedProviderPayout ? existing?.reconciledFlag || false : false,
      bankAccountId: null,
      status: tx.status === 'success' ? 'completed' : tx.status,
      notes: paymentNotes,
    };

    if (existing) {
      const updated = await this.prisma.payment.update({
        where: { id: existing.id },
        data,
      });
      caches?.paymentsByExternalId.set(tx.externalId, updated);
      return 'updated';
    }

    const created = await this.prisma.payment.create({ data });
    caches?.paymentsByExternalId.set(tx.externalId, created);
    return 'created';
  }

  private buildOrderNotes(order: UnifiedOrder) {
    const notes = [
      '[1shop-sync]',
      `orderId=${order.externalId}`,
      `status=${order.status}`,
    ];
    const sourceStoreAccount =
      typeof order.raw?.sourceStoreAccount === 'string'
        ? order.raw.sourceStoreAccount.trim()
        : '';
    const sourceStoreName =
      typeof order.raw?.sourceStoreName === 'string'
        ? order.raw.sourceStoreName.trim()
        : '';
    const originalOrderNumber =
      typeof order.raw?.originalOrderNumber === 'string'
        ? order.raw.originalOrderNumber.trim()
        : '';

    if (sourceStoreAccount) {
      notes.push(`storeAccount=${sourceStoreAccount}`);
    }

    if (sourceStoreName) {
      notes.push(`storeName=${sourceStoreName}`);
    }

    if (originalOrderNumber) {
      notes.push(`originalOrderNumber=${originalOrderNumber}`);
    }

    const receipt = Array.isArray(order.raw?.receipt) ? order.raw.receipt[0] : null;
    const invoiceNumber =
      receipt && typeof receipt.invoice_number === 'string'
        ? receipt.invoice_number.trim()
        : '';
    const invoiceDate =
      receipt && typeof receipt.invoice_date === 'string'
        ? receipt.invoice_date.trim()
        : '';
    const invoiceStatus = invoiceNumber ? 'issued' : 'pending';

    if (invoiceNumber) {
      notes.push(`invoiceNumber=${invoiceNumber}`);
      notes.push(`invoiceStatus=${invoiceStatus}`);
    }

    if (invoiceDate) {
      notes.push(`invoiceDate=${invoiceDate}`);
    }

    const rawNote =
      typeof order.raw?.note === 'string' ? order.raw.note.trim() : '';
    const rawShopNote =
      typeof order.raw?.shop_note === 'string' ? order.raw.shop_note.trim() : '';

    if (rawNote) {
      notes.push(`customerNote=${rawNote}`);
    }

    if (rawShopNote) {
      notes.push(`shopNote=${rawShopNote}`);
    }

    return notes.join('; ');
  }

  private buildPaymentNotes(
    existingNotes: string | null | undefined,
    tx: UnifiedTransaction,
  ) {
    const raw = tx.raw || {};
    const parts = [
      `feeStatus=${tx.feeStatus || 'unavailable'}`,
      `feeSource=${tx.feeSource || 'unknown'}`,
      `gateway=${tx.gateway || raw.payment || ''}`,
      `storeAccount=${raw.sourceStoreAccount || ''}`,
      `storeName=${raw.sourceStoreName || ''}`,
      `originalOrderNumber=${raw.originalOrderNumber || ''}`,
      `paymentStatus=${raw.payment_status || ''}`,
      `logisticStatus=${raw.logistic_status || ''}`,
    ].filter((part) => !part.endsWith('='));

    if (tx.orderId) {
      parts.push(`oneShopOrderId=${tx.orderId}`);
    }

    const providerPaymentId = this.pickMetadata(
      raw.payment_third_party_no,
      raw.logistics_third_party_no,
    );
    const providerTradeNo = this.pickMetadata(
      raw.receipt?.[0]?.invoice_number,
      raw.payment_third_party_no,
    );

    if (providerPaymentId) {
      parts.push(`providerPaymentId=${providerPaymentId}`);
    }

    if (providerTradeNo) {
      parts.push(`providerTradeNo=${providerTradeNo}`);
    }

    const syncNote = `[1shop-sync] ${parts.join('; ')}`;
    const preservedNotes = (existingNotes || '')
      .split('\n')
      .filter((line) => !line.startsWith('[1shop-sync]'))
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

  private async ensureCustomer(
    entityId: string,
    customerData: NonNullable<UnifiedOrder['customer']>,
    caches?: ReturnType<OneShopService['createSyncWindowCaches']>,
  ) {
    let customer = null;
    const normalizedEmail = customerData.email?.trim().toLowerCase();
    const normalizedPhone = customerData.phone?.trim();

    if (normalizedEmail) {
      customer =
        caches?.customersByEmail.get(normalizedEmail) ||
        (await this.prisma.customer.findFirst({
          where: { entityId, email: customerData.email },
        }));
    }

    if (!customer && normalizedPhone) {
      customer =
        caches?.customersByPhone.get(normalizedPhone) ||
        (await this.prisma.customer.findFirst({
          where: { entityId, phone: customerData.phone },
        }));
    }

    if (customer) {
      if (normalizedEmail) {
        caches?.customersByEmail.set(normalizedEmail, customer);
      }
      if (normalizedPhone) {
        caches?.customersByPhone.set(normalizedPhone, customer);
      }
      return customer.id;
    }

    const created = await this.prisma.customer.create({
      data: {
        entityId,
        name: customerData.name || '1Shop Customer',
        email: customerData.email,
        phone: customerData.phone,
      },
    });

    if (normalizedEmail) {
      caches?.customersByEmail.set(normalizedEmail, created);
    }
    if (normalizedPhone) {
      caches?.customersByPhone.set(normalizedPhone, created);
    }

    return created.id;
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

  private async getFxRate(currency: string): Promise<number> {
    if (currency === 'TWD') return 1;
    if (currency === 'USD') return 32.5;
    if (currency === 'CNY') return 4.5;
    if (currency === 'JPY') return 0.21;
    return 1;
  }

  private pickMetadata(...values: Array<unknown>) {
    return values
      .map((value) =>
        value === undefined || value === null ? '' : String(value).trim(),
      )
      .find((value) => value);
  }
}
