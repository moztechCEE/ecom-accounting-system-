import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  UnifiedOrder,
  UnifiedTransaction,
} from '../interfaces/sales-channel-adapter.interface';
import {
  ShoplineHttpAdapter,
  ShoplinePaymentBillingRecord,
  ShoplinePaymentPayout,
  ShoplinePaymentStoreTransaction,
} from './shopline.adapter';
import { ProviderPayoutReconciliationService } from '../../reconciliation/provider-payout-reconciliation.service';

const SHOPLINE_CHANNEL_CODE = 'SHOPLINE';

type ShoplinePaymentQueryParams = {
  since?: Date;
  until?: Date;
  limit?: string | number;
  maxPages?: string | number;
  pageInfo?: string;
  sinceId?: string;
  payoutId?: string;
  payoutTransactionNo?: string;
  accountType?: string;
  isSettlementDetails?: boolean | string;
  transactionType?: string;
  status?: string;
  tradeOrderId?: string;
};

type ShoplinePayPayoutRow = Record<string, string | number | boolean | null>;

@Injectable()
export class ShoplineService {
  private readonly logger = new Logger(ShoplineService.name);
  private defaultEntityId = 'tw-entity-001';

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: ShoplineHttpAdapter,
    private readonly config: ConfigService,
    private readonly providerPayoutService: ProviderPayoutReconciliationService,
  ) {}

  onModuleInit() {
    this.defaultEntityId =
      this.config.get<string>('SHOPLINE_DEFAULT_ENTITY_ID') || 'tw-entity-001';
  }

  async testConnection() {
    return this.adapter.testConnection();
  }

  async getConnectionInfo() {
    return {
      stores: this.adapter.getStores().map((store) => ({
        handle: store.handle,
        storeName: store.storeName || null,
        merchantId: store.merchantId || null,
      })),
      apiBaseUrl:
        this.config.get<string>('SHOPLINE_API_BASE_URL', '') ||
        'https://open.shopline.io/v1',
      authMode: 'bearer_token',
      requiredHeaders: ['Authorization', 'User-Agent'],
      rateLimit: '20 requests / second',
      supports: [
        'orders',
        'customers',
        'webhooks',
        'payments.balance',
        'payments.balance_transactions',
        'payments.transactions',
        'payments.payouts',
      ],
      paymentsApi: {
        baseUrlPattern:
          'https://{handle}.myshopline.com/admin/openapi/{version}',
        version:
          this.config.get<string>('SHOPLINE_ADMIN_API_VERSION', 'v20260301') ||
          'v20260301',
        requiredScope: 'read_payment',
      },
    };
  }

  async getTokenInfo() {
    return this.adapter.getTokenInfo();
  }

  async getAgents(params: { merchantId?: string } = {}) {
    return this.adapter.getAgents(params);
  }

  async previewOrders(params: {
    since?: Date;
    until?: Date;
    limit?: string | number;
  }) {
    const { since, until } = this.resolvePreviewRange(
      params.since,
      params.until,
    );
    const limit = this.parsePreviewLimit(params.limit);
    const orders = await this.adapter.fetchOrders({ start: since, end: until });

    return {
      success: true,
      range: {
        since: since.toISOString(),
        until: until.toISOString(),
      },
      fetched: orders.length,
      sample: orders.slice(0, limit).map((order) => ({
        externalId: order.externalId,
        orderDate: order.orderDate.toISOString(),
        status: order.status,
        currency: order.totals.currency,
        gross: Number(order.totals.gross),
        net: Number(order.totals.net),
        tax: Number(order.totals.tax),
        discount: Number(order.totals.discount),
        shipping: Number(order.totals.shipping),
        itemCount: order.items.length,
        customerLinked: Boolean(
          order.customer?.externalId ||
            order.customer?.email ||
            order.customer?.phone,
        ),
        paymentStatus: this.pickRawString(order.raw, 'order_payment', 'status'),
        paymentType:
          this.pickRawString(order.raw, 'order_payment', 'payment_type') ||
          this.pickRawString(
            order.raw,
            'order_payment',
            'payment_data',
            'notify_response',
            'payment_gateway',
          ),
        sourceStoreHandle: this.pickRawString(order.raw, 'sourceStoreHandle'),
        sourceStoreName: this.pickRawString(order.raw, 'sourceStoreName'),
      })),
    };
  }

  async previewCustomers(params: {
    since?: Date;
    until?: Date;
    limit?: string | number;
  }) {
    const { since, until } = this.resolvePreviewRange(
      params.since,
      params.until,
    );
    const limit = this.parsePreviewLimit(params.limit);
    const customers = await this.adapter.fetchCustomers({
      start: since,
      end: until,
    });

    return {
      success: true,
      range: {
        since: since.toISOString(),
        until: until.toISOString(),
      },
      fetched: customers.length,
      sample: customers.slice(0, limit).map((customer) => ({
        id: customer.id || null,
        namePresent: Boolean(customer.name),
        emailPresent: Boolean(customer.email),
        phonePresent: Boolean(
          customer.mobile_phone ||
            (Array.isArray(customer.phones) && customer.phones.length),
        ),
        orderCount:
          typeof customer.order_count === 'number'
            ? customer.order_count
            : null,
        createdAt: customer.created_at || null,
        updatedAt: customer.updated_at || null,
        sourceStoreHandle: customer.rawStore.handle || null,
        sourceStoreName: customer.rawStore.storeName || null,
      })),
    };
  }

  async previewPaymentBalance() {
    const balances = await this.adapter.fetchPaymentBalance();

    return {
      success: true,
      stores: balances.map((item) => ({
        store: item.store,
        balance: item.balance,
        traceId: item.traceId,
      })),
    };
  }

  async getPaymentsReadiness() {
    const stores = this.adapter.getStores();
    const version =
      this.config.get<string>('SHOPLINE_ADMIN_API_VERSION', 'v20260301') ||
      'v20260301';
    const explicitBase =
      this.config.get<string>('SHOPLINE_ADMIN_API_BASE_URL', '') || '';
    const configured = stores.map((store) => {
      const missing: string[] = [];
      if (!store.token) missing.push('token');
      if (!store.handle) missing.push('handle');

      return {
        storeName: store.storeName || null,
        handle: store.handle || null,
        merchantId: store.merchantId || null,
        readyForAttempt: missing.length === 0,
        missing,
        adminBaseUrl: store.handle
          ? (explicitBase.trim()
              ? explicitBase.trim().replace('{handle}', store.handle)
              : `https://${store.handle}.myshopline.com/admin/openapi/${version}`)
          : null,
      };
    });

    if (!stores.length) {
      return {
        ready: false,
        configured,
        message: 'SHOPLINE_ACCESS_TOKEN / SHOPLINE_STORES_JSON 尚未設定。',
      };
    }

    if (configured.some((store) => !store.readyForAttempt)) {
      return {
        ready: false,
        configured,
        message: 'SHOPLINE Payments 查詢需要 token 與 handle。',
      };
    }

    try {
      const balance = await this.previewPaymentBalance();
      return {
        ready: true,
        configured,
        balance,
        message: 'SHOPLINE Payments API 可讀取。',
      };
    } catch (error: any) {
      return {
        ready: false,
        configured,
        error: error?.message || String(error),
        message:
          'SHOPLINE 一般 OpenAPI 已可用，但 Payments Admin OpenAPI 尚未確認可讀；請確認 read_payment 權限、SHOPLINE_ADMIN_API_BASE_URL 與 handle 對應的 admin openapi host。',
      };
    }
  }

  async previewPaymentBillingRecords(params: ShoplinePaymentQueryParams) {
    const query = this.resolvePaymentsQuery(params, 3);
    const records = await this.adapter.fetchPaymentBillingRecords({
      ...query,
      maxPages: params.maxPages || 1,
      isSettlementDetails: params.isSettlementDetails ?? true,
    });
    const limit = this.parsePreviewLimit(params.limit);

    return {
      success: true,
      range: this.toRangeResponse(query.start, query.end),
      fetched: records.length,
      sample: records
        .slice(0, limit)
        .map((record) => this.summarizeBillingRecord(record)),
    };
  }

  async previewPaymentTransactions(params: ShoplinePaymentQueryParams) {
    const query = this.resolvePaymentsQuery(params, 6);
    const transactions = await this.adapter.fetchPaymentStoreTransactions({
      ...query,
      maxPages: params.maxPages || 1,
    });
    const limit = this.parsePreviewLimit(params.limit);

    return {
      success: true,
      range: this.toRangeResponse(query.start, query.end),
      fetched: transactions.length,
      sample: transactions
        .slice(0, limit)
        .map((transaction) => this.summarizeStoreTransaction(transaction)),
    };
  }

  async previewPaymentPayouts(params: ShoplinePaymentQueryParams) {
    const query = this.resolvePaymentsQuery(params, 3);
    const payouts = await this.adapter.fetchPaymentPayouts({
      ...query,
      maxPages: params.maxPages || 1,
    });
    const limit = this.parsePreviewLimit(params.limit);

    return {
      success: true,
      range: this.toRangeResponse(query.start, query.end),
      fetched: payouts.length,
      sample: payouts
        .slice(0, limit)
        .map((payout) => this.summarizePayout(payout)),
    };
  }

  assertSchedulerToken(providedToken?: string | null) {
    const expected =
      this.config.get<string>('SHOPLINE_SYNC_JOB_TOKEN', '') ||
      this.config.get<string>('SHOPIFY_SYNC_JOB_TOKEN', '') ||
      '';

    if (!expected) {
      throw new UnauthorizedException(
        'SHOPLINE_SYNC_JOB_TOKEN is not configured',
      );
    }

    if (!providedToken || providedToken !== expected) {
      throw new UnauthorizedException('Invalid scheduler token');
    }
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
    let paymentDraftCreated = 0;
    let paymentDraftUpdated = 0;

    for (const order of orders) {
      try {
        const result = await this.upsertSalesOrder(
          params.entityId,
          channel.id,
          order,
        );
        if (result === 'created') created++;
        if (result === 'updated') updated++;

        const transaction = this.adapter.mapOrderToUnifiedTransaction(order);
        if (transaction) {
          const paymentResult = await this.upsertPayment(
            params.entityId,
            channel.id,
            transaction,
          );
          if (paymentResult === 'created') paymentDraftCreated++;
          if (paymentResult === 'updated') paymentDraftUpdated++;
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to sync SHOPLINE order ${order.externalId}: ${error.message}`,
        );
      }
    }

    return {
      success: true,
      fetched: orders.length,
      created,
      updated,
      paymentDraftCreated,
      paymentDraftUpdated,
    };
  }

  async syncCustomers(params: {
    entityId: string;
    since?: Date;
    until?: Date;
  }) {
    await this.assertEntityExists(params.entityId);

    const customers = await this.adapter.fetchCustomers({
      start: params.since || new Date(0),
      end: params.until || new Date(),
    });

    let created = 0;
    let updated = 0;

    for (const customer of customers) {
      const result = await this.upsertCustomer(params.entityId, {
        name: customer.name || 'SHOPLINE Customer',
        email: customer.email || undefined,
        phone:
          customer.mobile_phone ||
          (Array.isArray(customer.phones) ? customer.phones[0] : undefined),
      });
      if (result === 'created') created++;
      if (result === 'updated') updated++;
    }

    return {
      success: true,
      fetched: customers.length,
      created,
      updated,
    };
  }

  async syncTransactions(_params: {
    entityId: string;
    since?: Date;
    until?: Date;
  }) {
    await this.assertEntityExists(_params.entityId);

    const transactions = await this.adapter.fetchTransactions({
      start: _params.since || new Date(0),
      end: _params.until || new Date(),
    });

    const channel = await this.ensureSalesChannel(_params.entityId);
    let created = 0;
    let updated = 0;

    for (const tx of transactions) {
      try {
        const result = await this.upsertPayment(
          _params.entityId,
          channel.id,
          tx,
        );
        if (result === 'created') created++;
        if (result === 'updated') updated++;
      } catch (error: any) {
        this.logger.error(
          `Failed to sync SHOPLINE payment ${tx.externalId}: ${error.message}`,
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

  async syncPaymentBillingRecords(params: {
    entityId: string;
    since?: Date;
    until?: Date;
    accountType?: string;
    payoutId?: string;
    maxPages?: string | number;
    userId?: string | null;
  }) {
    await this.assertEntityExists(params.entityId);
    const query = this.resolvePaymentsQuery(
      {
        since: params.since,
        until: params.until,
        accountType: params.accountType,
        payoutId: params.payoutId,
        maxPages: params.maxPages,
        isSettlementDetails: true,
      },
      3,
    );
    const records = await this.adapter.fetchPaymentBillingRecords(query);
    const rows = records
      .filter((record) => this.isImportableBillingRecord(record))
      .map((record) => this.toShoplinePayPayoutRow(record));

    if (!rows.length) {
      return {
        success: true,
        skipped: true,
        fetched: records.length,
        imported: 0,
        message:
          'SHOPLINE Payments 回傳資料內沒有可自動對應訂單的 PAYMENT / REFUND 帳務列。',
      };
    }

    const importedBy = await this.resolveSyncUserId(params.userId);
    const result = await this.providerPayoutService.importProviderPayouts(
      {
        entityId: params.entityId,
        provider: 'shoplinepay',
        sourceType: 'reconciliation',
        fileName: `shoplinepay-balance-transactions-${this.formatDateForFile(
          query.start,
        )}-${this.formatDateForFile(query.end)}.json`,
        rows,
        notes:
          'source=shopline.payments.balance_transactions; isSettlementDetails=true',
      },
      importedBy,
    );

    return {
      success: true,
      fetched: records.length,
      importable: rows.length,
      ...result,
    };
  }

  async autoSync(options?: { entityId?: string; since?: Date; until?: Date }) {
    const enabled =
      this.config.get<string>('SHOPLINE_SYNC_ENABLED', 'false') === 'true';

    if (!enabled) {
      return {
        success: false,
        skipped: true,
        message: 'SHOPLINE_SYNC_ENABLED is false',
      };
    }

    const entityId = options?.entityId || this.defaultEntityId;
    const lookbackMinutes = Number(
      this.config.get<string>('SHOPLINE_SYNC_LOOKBACK_MINUTES', '180'),
    );
    const until = options?.until || new Date();
    const since =
      options?.since || new Date(until.getTime() - lookbackMinutes * 60 * 1000);

    const [orders, customers, transactions] = await Promise.all([
      this.syncOrders({ entityId, since, until }),
      this.syncCustomers({ entityId, since, until }),
      this.syncTransactions({ entityId, since, until }),
    ]);

    const syncPayments =
      this.config.get<string>('SHOPLINE_PAYMENTS_SYNC_ENABLED', 'false') ===
      'true';
    const payments = syncPayments
      ? await this.syncPaymentBillingRecords({ entityId, since, until })
      : {
          skipped: true,
          message: 'SHOPLINE_PAYMENTS_SYNC_ENABLED is false',
        };

    return {
      success: true,
      entityId,
      since: since.toISOString(),
      until: until.toISOString(),
      orders,
      customers,
      transactions,
      payments,
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

    const [ordersAgg, ordersCount, paymentsAgg, paymentCount] =
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
        this.prisma.salesOrder.count({ where: ordersWhere }),
        this.prisma.payment.aggregate({
          where: paymentsWhere,
          _sum: {
            amountGrossOriginal: true,
            amountNetOriginal: true,
            feePlatformOriginal: true,
            feeGatewayOriginal: true,
          },
        }),
        this.prisma.payment.count({ where: paymentsWhere }),
      ]);

    const num = (value: Decimal | number | null | undefined) =>
      value ? Number(value) : 0;

    return {
      entityId,
      channel: SHOPLINE_CHANNEL_CODE,
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
        paymentCount,
        platformFeeStatus: paymentCount ? 'mixed' : 'empty',
        platformFeeSource:
          'SHOPLINE payouts will be finalized in the reconciliation phase.',
      },
    };
  }

  async handleWebhook(topic: string, payload: any) {
    const normalizedTopic = (topic || '').trim().toLowerCase();
    const lookbackMinutes = Number(
      this.config.get<string>('SHOPLINE_WEBHOOK_LOOKBACK_MINUTES', '240'),
    );
    const until = new Date();
    const since = new Date(until.getTime() - lookbackMinutes * 60 * 1000);

    if (
      [
        'order/create',
        'order/update',
        'order/confirm',
        'order/complete',
        'order_payment/update',
        'order_payment/complete',
        'order_delivery/update',
        'order_delivery/status_update',
      ].includes(normalizedTopic)
    ) {
      await this.autoSync({
        entityId: this.defaultEntityId,
        since,
        until,
      });
    }

    if (
      ['user/create', 'user/update', 'user/remove'].includes(normalizedTopic)
    ) {
      await this.syncCustomers({
        entityId: this.defaultEntityId,
        since,
        until,
      });
    }

    return {
      success: true,
      accepted: true,
      topic,
      message: 'SHOPLINE webhook accepted and queued for incremental sync.',
      resourceId:
        payload?.resource?.id || payload?.resource?._id || payload?.id || null,
    };
  }

  @Cron('0 */20 * * * *', {
    name: 'shoplineAutoSync',
    timeZone: 'Asia/Taipei',
  })
  async handleScheduledSync() {
    const enabled =
      this.config.get<string>('SHOPLINE_SYNC_ENABLED', 'false') === 'true';

    if (!enabled) {
      return;
    }

    try {
      const result = await this.autoSync({ entityId: this.defaultEntityId });
      this.logger.log(
        `Scheduled SHOPLINE sync finished: orders=${result.orders.fetched}, customers=${result.customers.fetched}`,
      );
    } catch (error: any) {
      this.logger.error(`Scheduled SHOPLINE sync failed: ${error.message}`);
    }
  }

  private async ensureSalesChannel(entityId: string) {
    const existing = await this.prisma.salesChannel.findFirst({
      where: { entityId, code: SHOPLINE_CHANNEL_CODE },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.salesChannel.create({
      data: {
        entityId,
        name: 'SHOPLINE',
        code: SHOPLINE_CHANNEL_CODE,
        type: 'ecommerce',
        defaultCurrency: 'TWD',
        configJson: {
          stores: this.adapter.getStores().map((store) => ({
            handle: store.handle,
            storeName: store.storeName || null,
            merchantId: store.merchantId || null,
          })),
          apiBaseUrl:
            this.config.get<string>('SHOPLINE_API_BASE_URL', '') ||
            'https://open.shopline.io/v1',
        },
      },
    });
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

    const currency = order.totals.currency;
    const fxRate = new Decimal(await this.getFxRate(currency));
    const toBase = (amount: Decimal) => amount.mul(fxRate);
    const customerId = order.customer
      ? await this.ensureCustomer(entityId, order.customer)
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
          hasInvoice: existing.hasInvoice,
        },
      });
      await this.syncSalesOrderItems(
        updated.id,
        entityId,
        order,
        currency,
        fxRate,
      );
      return 'updated';
    }

    const created = await this.prisma.salesOrder.create({
      data: {
        entityId,
        channelId,
        externalOrderId: order.externalId,
        hasInvoice: false,
        ...data,
      },
    });
    await this.syncSalesOrderItems(
      created.id,
      entityId,
      order,
      currency,
      fxRate,
    );

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

  private normalizeLineItemSku(
    orderId: string,
    sku: string | undefined,
    index: number,
  ) {
    const normalized = (sku || '').trim();
    if (
      normalized &&
      normalized !== 'UNKNOWN' &&
      normalized !== 'SHOPLINE-ITEM'
    ) {
      return normalized.slice(0, 120);
    }
    return `SHOPLINE-${orderId}-${index + 1}`.slice(0, 120);
  }

  private buildOrderNotes(order: UnifiedOrder) {
    const raw = order.raw || {};
    const notes = [
      '[shopline-sync]',
      `orderId=${order.externalId}`,
      `status=${order.status}`,
      `storeHandle=${raw.sourceStoreHandle || ''}`,
      `storeName=${raw.sourceStoreName || ''}`,
      `paymentStatus=${raw.order_payment?.status || ''}`,
      `paymentType=${raw.order_payment?.payment_type || ''}`,
      `deliveryStatus=${raw.order_delivery?.delivery_status || ''}`,
      `invoiceStatus=${raw.invoice?.invoice_status || ''}`,
      `invoiceNumber=${raw.invoice?.invoice_number || ''}`,
      `trackingNumber=${raw.delivery_data?.tracking_number || ''}`,
    ].filter((part) => !part.endsWith('='));

    return notes.join('; ');
  }

  private async upsertPayment(
    entityId: string,
    channelId: string,
    tx: UnifiedTransaction,
  ): Promise<'created' | 'updated'> {
    const salesOrder = tx.orderId
      ? await this.prisma.salesOrder.findFirst({
          where: {
            entityId,
            channelId,
            externalOrderId: tx.orderId,
          },
        })
      : null;

    const existing = await this.prisma.payment.findFirst({
      where: {
        entityId,
        channelId,
        payoutBatchId: tx.externalId,
      },
    });

    const currency = tx.currency || 'TWD';
    const fxRate = new Decimal(await this.getFxRate(currency));
    const zero = new Decimal(0);
    const hasLockedProviderPayout = this.hasLockedProviderPayout(
      existing?.notes,
    );
    const isPaymentCaptured = tx.status === 'success';
    const capturedAmount = isPaymentCaptured ? tx.amount : zero;
    const capturedFee = isPaymentCaptured ? tx.fee : zero;
    const capturedNet = isPaymentCaptured ? tx.net : zero;
    const paymentNotes = this.buildPaymentNotes(existing?.notes, tx);

    const data = {
      entityId,
      channelId,
      salesOrderId: salesOrder?.id ?? null,
      payoutBatchId: tx.externalId,
      channel: SHOPLINE_CHANNEL_CODE,
      payoutDate: tx.date,
      amountGrossOriginal: hasLockedProviderPayout
        ? existing?.amountGrossOriginal || capturedAmount
        : capturedAmount,
      amountGrossCurrency: currency,
      amountGrossFxRate: fxRate,
      amountGrossBase: hasLockedProviderPayout
        ? existing?.amountGrossBase || capturedAmount.mul(fxRate)
        : capturedAmount.mul(fxRate),
      feePlatformOriginal: hasLockedProviderPayout
        ? existing?.feePlatformOriginal || zero
        : capturedFee,
      feePlatformCurrency: currency,
      feePlatformFxRate: fxRate,
      feePlatformBase: hasLockedProviderPayout
        ? existing?.feePlatformBase || zero
        : capturedFee.mul(fxRate),
      feeGatewayOriginal: hasLockedProviderPayout
        ? existing?.feeGatewayOriginal || zero
        : zero,
      feeGatewayCurrency: currency,
      feeGatewayFxRate: fxRate,
      feeGatewayBase: hasLockedProviderPayout
        ? existing?.feeGatewayBase || zero
        : zero,
      shippingFeePaidOriginal: zero,
      shippingFeePaidCurrency: currency,
      shippingFeePaidFxRate: fxRate,
      shippingFeePaidBase: zero,
      amountNetOriginal: hasLockedProviderPayout
        ? existing?.amountNetOriginal || capturedNet
        : capturedNet,
      amountNetCurrency: currency,
      amountNetFxRate: fxRate,
      amountNetBase: hasLockedProviderPayout
        ? existing?.amountNetBase || capturedNet.mul(fxRate)
        : capturedNet.mul(fxRate),
      reconciledFlag: hasLockedProviderPayout
        ? existing?.reconciledFlag || false
        : false,
      bankAccountId: null,
      status: tx.status === 'success' ? 'completed' : tx.status,
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
    const result = await this.upsertCustomer(entityId, customerData);

    if (typeof result === 'string') {
      return result;
    }

    return result.id;
  }

  private async upsertCustomer(
    entityId: string,
    customerData: {
      name?: string;
      email?: string;
      phone?: string;
      externalId?: string;
    },
  ): Promise<{ id: string } | 'created' | 'updated'> {
    let customer = null;

    if (customerData.email) {
      customer = await this.prisma.customer.findFirst({
        where: { entityId, email: customerData.email },
      });
    }

    if (!customer && customerData.phone) {
      customer = await this.prisma.customer.findFirst({
        where: { entityId, phone: customerData.phone },
      });
    }

    const data = {
      name: customerData.name || 'SHOPLINE Customer',
      email: customerData.email || null,
      phone: customerData.phone || null,
    };

    if (customer) {
      const updated = await this.prisma.customer.update({
        where: { id: customer.id },
        data,
      });

      return customerData.externalId ? { id: updated.id } : 'updated';
    }

    const created = await this.prisma.customer.create({
      data: {
        entityId,
        ...data,
      },
    });

    return customerData.externalId ? { id: created.id } : 'created';
  }

  private buildPaymentNotes(
    existingNotes: string | null | undefined,
    tx: UnifiedTransaction,
  ) {
    const raw = tx.raw || {};
    const payment = raw.order_payment || {};
    const paymentData = payment.payment_data || {};
    const createResp = paymentData.create_payment?.resp || {};
    const notifyResponse = paymentData.notify_response || {};
    const parts = [
      `feeStatus=${tx.feeStatus || 'unavailable'}`,
      `feeSource=${tx.feeSource || 'unknown'}`,
      `settlementStatus=${this.resolveSettlementStatus(tx)}`,
      `expectedGross=${tx.amount.toFixed(2)}`,
      `gateway=${tx.gateway || payment.payment_type || ''}`,
      `storeHandle=${raw.sourceStoreHandle || ''}`,
      `storeName=${raw.sourceStoreName || ''}`,
      `paymentStatus=${payment.status || ''}`,
      `deliveryStatus=${raw.order_delivery?.delivery_status || ''}`,
      `invoiceStatus=${raw.invoice?.invoice_status || ''}`,
      `invoiceNumber=${raw.invoice?.invoice_number || ''}`,
      `providerPaymentId=${this.pickMetadata(
        createResp.paymentOrderId,
        notifyResponse.id,
      )}`,
      `providerTradeNo=${this.pickMetadata(
        createResp.chDealId,
        createResp.chOrderId,
      )}`,
      `authorization=${this.pickMetadata(
        createResp.merchantOrderId,
        createResp.orderId,
      )}`,
    ].filter((part) => !part.endsWith('='));

    if (tx.orderId) {
      parts.push(`shoplineOrderId=${tx.orderId}`);
    }

    const syncNote = `[shopline-sync] ${parts.join('; ')}`;
    const preservedNotes = (existingNotes || '')
      .split('\n')
      .filter((line) => !line.startsWith('[shopline-sync]'))
      .join('\n')
      .trim();

    return preservedNotes ? `${preservedNotes}\n${syncNote}` : syncNote;
  }

  private resolveSettlementStatus(tx: UnifiedTransaction) {
    if (tx.status === 'success') {
      return 'pending_payout';
    }

    if (tx.status === 'failed') {
      return 'failed';
    }

    return 'pending_payment';
  }

  private hasLockedProviderPayout(notes: string | null | undefined) {
    const text = notes || '';
    return (
      text.includes('[provider-payout]') && text.includes('feeStatus=actual')
    );
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

  private resolvePreviewRange(since?: Date, until?: Date) {
    const resolvedUntil = until || new Date();
    const resolvedSince =
      since || new Date(resolvedUntil.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (resolvedSince.getTime() > resolvedUntil.getTime()) {
      throw new BadRequestException('since must be before until');
    }

    return {
      since: resolvedSince,
      until: resolvedUntil,
    };
  }

  private parsePreviewLimit(value?: string | number) {
    const parsed = Number(value ?? 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(Math.max(Math.trunc(parsed), 1), 50);
  }

  private pickRawString(raw: unknown, ...path: string[]) {
    let cursor: any = raw;
    for (const key of path) {
      if (!cursor || typeof cursor !== 'object') return null;
      cursor = cursor[key];
    }
    if (cursor === undefined || cursor === null) return null;
    const value = String(cursor).trim();
    return value || null;
  }

  private resolvePaymentsQuery(
    params: ShoplinePaymentQueryParams,
    maxMonths: number,
  ) {
    const { since, until } = this.resolvePreviewRange(
      params.since,
      params.until,
    );
    const maxWindowMs = maxMonths * 31 * 24 * 60 * 60 * 1000;

    if (!params.payoutId && until.getTime() - since.getTime() > maxWindowMs) {
      throw new BadRequestException(
        `SHOPLINE Payments 查詢區間不可超過 ${maxMonths} 個月。`,
      );
    }

    return {
      start: since,
      end: until,
      limit: Math.min(Math.max(Number(params.limit || 100), 1), 100),
      maxPages: params.maxPages,
      pageInfo: params.pageInfo,
      sinceId: params.sinceId,
      payoutId: params.payoutId,
      payoutTransactionNo: params.payoutTransactionNo,
      accountType: params.accountType,
      isSettlementDetails: params.isSettlementDetails,
      transactionType: params.transactionType,
      status: params.status,
      tradeOrderId: params.tradeOrderId,
    };
  }

  private toRangeResponse(since?: Date, until?: Date) {
    return {
      since: since?.toISOString() || null,
      until: until?.toISOString() || null,
    };
  }

  private summarizeBillingRecord(record: ShoplinePaymentBillingRecord) {
    return {
      id: this.toCleanString(record.id),
      type: this.toCleanString(record.type),
      orderId: this.toCleanString(record.source_order_id),
      transactionId: this.toCleanString(record.source_order_transaction_id),
      gross: this.toCleanString(record.transaction_amount || record.amount),
      net: this.toCleanString(record.net),
      fee: this.computeShoplinePaymentFee(record),
      currency: this.toCleanString(
        record.transaction_currency || record.account_currency,
      ),
      postingTime: this.toCleanString(record.posting_time),
      settlementBatchId: this.toCleanString(record.settlement_batch_id),
      accountType: this.toCleanString(record.account_type),
      storeHandle: this.toCleanString(record.rawStore?.handle),
    };
  }

  private summarizeStoreTransaction(
    transaction: ShoplinePaymentStoreTransaction,
  ) {
    return {
      id: this.toCleanString(transaction.id),
      tradeOrderId: this.toCleanString(transaction.trade_order_id),
      type: this.toCleanString(transaction.transaction_type),
      status: this.toCleanString(transaction.status),
      amount: this.toCleanString(transaction.amount),
      currency: this.toCleanString(transaction.currency),
      createdAt: this.toCleanString(transaction.created_at),
      storeHandle: this.toCleanString(transaction.rawStore?.handle),
    };
  }

  private summarizePayout(payout: ShoplinePaymentPayout) {
    return {
      id: this.toCleanString(payout.id || payout.payout_transaction_no),
      status: this.toCleanString(payout.status),
      amount: this.toCleanString(payout.amount),
      currency: this.toCleanString(payout.currency),
      time: this.toCleanString(payout.time || payout.date),
      storeHandle: this.toCleanString(payout.rawStore?.handle),
    };
  }

  private isImportableBillingRecord(record: ShoplinePaymentBillingRecord) {
    const type = this.toCleanString(record.type).toUpperCase();
    const hasOrderKey = Boolean(
      this.toCleanString(record.source_order_id) ||
        this.toCleanString(record.source_order_transaction_id),
    );
    const hasAmountContext = Boolean(
      this.toCleanString(record.transaction_amount || record.amount) ||
        this.toCleanString(record.net),
    );

    if (!hasOrderKey || !hasAmountContext) {
      return false;
    }

    if (type.includes('PAYOUT') || type.includes('TRANSFER')) {
      return false;
    }

    return (
      type.startsWith('PAYMENT') ||
      type.startsWith('REFUND') ||
      type.includes('CHARGEBACK')
    );
  }

  private toShoplinePayPayoutRow(
    record: ShoplinePaymentBillingRecord,
  ): ShoplinePayPayoutRow {
    const gross = this.toCleanString(
      record.transaction_amount || record.amount,
    );
    const net = this.toCleanString(record.net);
    const fee = this.computeShoplinePaymentFee(record);
    const processingFee = this.sumAbsDecimalStrings(
      record.interchange_fee,
      record.scheme_fee,
    );

    return {
      provider: 'shoplinepay',
      externalOrderId: this.toCleanString(record.source_order_id),
      providerPaymentId: this.toCleanString(
        record.source_order_transaction_id || record.id,
      ),
      providerTradeNo: this.toCleanString(record.id),
      grossAmount: gross,
      feeAmount: fee,
      gatewayFeeAmount: this.absDecimalString(record.payment_method_fee),
      processingFeeAmount: processingFee,
      platformFeeAmount: this.absDecimalString(
        record.revolving_margin_account_balance,
      ),
      netAmount: net,
      payoutDate: this.toCleanString(record.posting_time),
      transactionDate: this.toCleanString(record.posting_time),
      currency:
        this.toCleanString(record.transaction_currency) ||
        this.toCleanString(record.account_currency) ||
        'TWD',
      gateway: 'SHOPLINE Payments',
      payoutStatus: this.toCleanString(record.type),
      settlementBatchId: this.toCleanString(record.settlement_batch_id),
      accountType: this.toCleanString(record.account_type),
      sourceStoreHandle: this.toCleanString(record.rawStore?.handle),
      sourceStoreName: this.toCleanString(record.rawStore?.storeName),
      sourceMerchantId: this.toCleanString(record.rawStore?.merchantId),
      shoplineBillingRecordId: this.toCleanString(record.id),
    };
  }

  private computeShoplinePaymentFee(record: ShoplinePaymentBillingRecord) {
    const gross = this.parseDecimalLike(
      record.transaction_amount || record.amount,
    );
    const net = this.parseDecimalLike(record.net);

    if (gross && net) {
      return gross.sub(net).abs().toDecimalPlaces(2).toString();
    }

    return this.sumAbsDecimalStrings(
      record.payment_method_fee,
      record.interchange_fee,
      record.scheme_fee,
      record.revolving_margin_account_balance,
    );
  }

  private sumAbsDecimalStrings(...values: unknown[]) {
    const total = values.reduce<Decimal>((sum, value) => {
      const decimal = this.parseDecimalLike(value);
      return decimal ? sum.add(decimal.abs()) : sum;
    }, new Decimal(0));

    return total.greaterThan(0) ? total.toDecimalPlaces(2).toString() : null;
  }

  private absDecimalString(value: unknown) {
    const decimal = this.parseDecimalLike(value);
    return decimal ? decimal.abs().toDecimalPlaces(2).toString() : null;
  }

  private parseDecimalLike(value: unknown) {
    const normalized = this.toCleanString(value).replace(/,/g, '');
    if (!normalized) {
      return null;
    }

    try {
      const decimal = new Decimal(normalized);
      return decimal.isFinite() ? decimal : null;
    } catch {
      return null;
    }
  }

  private toCleanString(value: unknown) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim();
  }

  private formatDateForFile(date?: Date) {
    if (!date) {
      return 'na';
    }
    return date.toISOString().slice(0, 10);
  }

  private async resolveSyncUserId(preferredUserId?: string | null) {
    if (preferredUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: preferredUserId },
        select: { id: true },
      });
      if (user) {
        return user.id;
      }
    }

    const preferredEmail =
      this.config.get<string>('SUPER_ADMIN_EMAIL', '') || '';
    if (preferredEmail.trim()) {
      const user = await this.prisma.user.findUnique({
        where: { email: preferredEmail.trim() },
        select: { id: true },
      });
      if (user) {
        return user.id;
      }
    }

    const fallbackUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!fallbackUser) {
      throw new InternalServerErrorException(
        '找不到可用來記錄 Shopline Payment 匯入批次的系統使用者。',
      );
    }

    return fallbackUser.id;
  }
}
