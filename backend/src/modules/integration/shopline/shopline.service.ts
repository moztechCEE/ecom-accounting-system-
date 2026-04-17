import {
  BadRequestException,
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
import { ShoplineHttpAdapter } from './shopline.adapter';

const SHOPLINE_CHANNEL_CODE = 'SHOPLINE';

@Injectable()
export class ShoplineService {
  private readonly logger = new Logger(ShoplineService.name);
  private defaultEntityId = 'tw-entity-001';

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: ShoplineHttpAdapter,
    private readonly config: ConfigService,
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
      supports: ['orders', 'customers', 'webhooks'],
    };
  }

  async getTokenInfo() {
    return this.adapter.getTokenInfo();
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
          `Failed to sync SHOPLINE order ${order.externalId}: ${error.message}`,
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

  async autoSync(options?: {
    entityId?: string;
    since?: Date;
    until?: Date;
  }) {
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
      options?.since ||
      new Date(until.getTime() - lookbackMinutes * 60 * 1000);

    const [orders, customers, transactions] = await Promise.all([
      this.syncOrders({ entityId, since, until }),
      this.syncCustomers({ entityId, since, until }),
      this.syncTransactions({ entityId, since, until }),
    ]);

    return {
      success: true,
      entityId,
      since: since.toISOString(),
      until: until.toISOString(),
      orders,
      customers,
      transactions,
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
        payload?.resource?.id ||
        payload?.resource?._id ||
        payload?.id ||
        null,
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
      await this.prisma.salesOrder.update({
        where: { id: existing.id },
        data: {
          ...data,
          hasInvoice: existing.hasInvoice,
        },
      });
      return 'updated';
    }

    await this.prisma.salesOrder.create({
      data: {
        entityId,
        channelId,
        externalOrderId: order.externalId,
        hasInvoice: false,
        ...data,
      },
    });

    return 'created';
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
    const hasLockedProviderPayout = this.hasLockedProviderPayout(existing?.notes);
    const paymentNotes = this.buildPaymentNotes(existing?.notes, tx);

    const data = {
      entityId,
      channelId,
      salesOrderId: salesOrder?.id ?? null,
      payoutBatchId: tx.externalId,
      channel: SHOPLINE_CHANNEL_CODE,
      payoutDate: tx.date,
      amountGrossOriginal: tx.amount,
      amountGrossCurrency: currency,
      amountGrossFxRate: fxRate,
      amountGrossBase: tx.amount.mul(fxRate),
      feePlatformOriginal: hasLockedProviderPayout
        ? existing?.feePlatformOriginal || zero
        : tx.fee,
      feePlatformCurrency: currency,
      feePlatformFxRate: fxRate,
      feePlatformBase: hasLockedProviderPayout
        ? existing?.feePlatformBase || zero
        : tx.fee.mul(fxRate),
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
        ? existing?.amountNetOriginal || tx.net
        : tx.net,
      amountNetCurrency: currency,
      amountNetFxRate: fxRate,
      amountNetBase: hasLockedProviderPayout
        ? existing?.amountNetBase || tx.net.mul(fxRate)
        : tx.net.mul(fxRate),
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
}
