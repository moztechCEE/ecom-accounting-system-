import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { OneShopHttpAdapter } from './one-shop.adapter';
import { UnifiedOrder } from '../interfaces/sales-channel-adapter.interface';

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

  async testConnection() {
    return this.adapter.testConnection();
  }

  getConnectionInfo() {
    return {
      storeName: this.config.get<string>('ONESHOP_STORE_NAME', '') || null,
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

    const [ordersAgg, ordersCount] = await Promise.all([
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
        gross: 0,
        net: 0,
        platformFee: null,
        platformFeeStatus: 'unavailable',
        platformFeeSource: '1Shop API v1 尚未提供撥款/手續費資料',
        platformFeeMessage:
          '目前 1Shop API v1 以訂單匯出為主，若之後拿到撥款或業績明細 API，再補平台費與淨額回填。',
      },
    };
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
      const result = await this.syncOrders({
        entityId: this.defaultEntityId,
        since,
        until: new Date(),
      });

      this.logger.log(
        `Scheduled 1Shop sync finished: fetched=${result.fetched}, created=${result.created}, updated=${result.updated}`,
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
          storeName: this.config.get<string>('ONESHOP_STORE_NAME', '') || null,
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
    const notes = [
      '[1shop-sync]',
      `orderId=${order.externalId}`,
      `status=${order.status}`,
    ];

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

  private async ensureCustomer(
    entityId: string,
    customerData: NonNullable<UnifiedOrder['customer']>,
  ) {
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

    if (customer) {
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
}
