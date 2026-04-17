import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ISalesChannelAdapter,
  UnifiedOrder,
  UnifiedTransaction,
} from '../interfaces/sales-channel-adapter.interface';

export type ShoplineStoreConfig = {
  token: string;
  handle: string;
  storeName?: string;
  merchantId?: string;
};

type ShoplineMoney = {
  dollars?: number | string;
  cents?: number | string;
  currency_iso?: string;
};

type ShoplineOrderItem = {
  id?: string;
  sku?: string;
  quantity?: number | string;
  item_price?: ShoplineMoney;
  price?: ShoplineMoney;
  title_translations?: Record<string, string>;
  fields_translations?: Record<string, string[]>;
  item_data?: {
    order_discounted_price?: ShoplineMoney;
    variation_data?: {
      sku?: string;
      fields_translations?: Record<string, string[]>;
    };
  };
};

type ShoplineOrderPayload = {
  id?: string;
  order_number?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  customer_id?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  currency_iso?: string;
  total?: ShoplineMoney;
  subtotal?: ShoplineMoney;
  order_discount?: ShoplineMoney;
  user_credit?: ShoplineMoney;
  total_tax_fee?: ShoplineMoney;
  invoice?: {
    invoice_number?: string;
    invoice_status?: string;
  };
  order_payment?: {
    id?: string;
    payment_type?: string;
    status?: string;
    paid_at?: string | null;
    updated_at?: string;
    created_at?: string;
    total?: ShoplineMoney;
    payment_fee?: ShoplineMoney;
    payment_data?: {
      create_payment?: {
        resp?: {
          paymentOrderId?: string;
          merchantOrderId?: string;
          chOrderId?: string;
          amount?: number | string;
          statusCode?: string;
          statusMsg?: string;
          chDealId?: string;
          chDealTime?: string;
        };
      };
      notify_response?: {
        payment_gateway?: string;
        id?: string;
        bizContent?: string;
      };
    };
  };
  order_delivery?: {
    status?: string;
    delivery_status?: string;
    total?: ShoplineMoney;
  };
  delivery_data?: {
    tracking_number?: string;
  };
  subtotal_items?: ShoplineOrderItem[];
};

type ShoplineCustomerPayload = {
  id?: string;
  name?: string;
  email?: string;
  mobile_phone?: string;
  phones?: string[];
  order_count?: number;
  updated_at?: string;
  created_at?: string;
};

type ShoplinePagination = {
  current_page?: number;
  per_page?: number;
  total_pages?: number;
  has_next_page?: boolean;
};

type ShoplineListResponse<T> = {
  items?: T[];
  pagination?: ShoplinePagination;
  error?: {
    code?: string;
    message?: string;
  };
};

type ShoplineTokenInfoResponse = {
  staff?: {
    _id?: string;
    email?: string;
    locale_code?: string;
    merchant_ids?: string[];
    name?: string;
  };
  merchant?: {
    _id?: string;
    email?: string;
    handle?: string;
    name?: string;
  };
  user?: {
    _id?: string;
    email?: string;
    name?: string;
  };
};

@Injectable()
export class ShoplineHttpAdapter implements ISalesChannelAdapter {
  readonly code = 'SHOPLINE';
  private readonly logger = new Logger(ShoplineHttpAdapter.name);
  private readonly baseUrl: string;
  private readonly perPage: number;
  private readonly stores: ShoplineStoreConfig[];

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('SHOPLINE_API_BASE_URL', '') ||
      'https://open.shopline.io/v1';
    this.perPage = Math.min(
      Math.max(
        Number(this.configService.get<string>('SHOPLINE_SYNC_PER_PAGE', '50')),
        1,
      ),
      50,
    );
    this.stores = this.loadStores();
  }

  getStores() {
    return this.stores;
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    if (!this.stores.length) {
      return {
        success: false,
        message: 'SHOPLINE store configuration is required',
      };
    }

    try {
      for (const store of this.stores) {
        await this.fetchTokenInfo(store);
      }

      return { success: true, message: 'Connection successful' };
    } catch (error: any) {
      this.logger.error(`SHOPLINE connection failed: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  async getTokenInfo() {
    this.assertConfig();

    return Promise.all(
      this.stores.map(async (store) => {
        const info = await this.fetchTokenInfo(store);
        return {
          storeName: store.storeName || null,
          handle: store.handle,
          merchantId: info.merchant?._id || store.merchantId || null,
          merchantHandle: info.merchant?.handle || null,
          merchantName: info.merchant?.name || null,
          userEmail: info.user?.email || info.staff?.email || null,
        };
      }),
    );
  }

  async fetchOrders(params: {
    start: Date;
    end: Date;
  }): Promise<UnifiedOrder[]> {
    this.assertConfig();

    const orders = await Promise.all(
      this.stores.map((store) => this.fetchOrdersForStore(store, params)),
    );

    return orders.flat();
  }

  async fetchCustomers(params: {
    start: Date;
    end: Date;
  }): Promise<Array<ShoplineCustomerPayload & { rawStore: ShoplineStoreConfig }>> {
    this.assertConfig();

    const customers = await Promise.all(
      this.stores.map((store) => this.fetchCustomersForStore(store, params)),
    );

    return customers.flat();
  }

  async fetchTransactions(_params: {
    start: Date;
    end: Date;
  }): Promise<UnifiedTransaction[]> {
    this.assertConfig();

    const transactions = await Promise.all(
      this.stores.map((store) => this.fetchTransactionsForStore(store, _params)),
    );

    return transactions.flat();
  }

  private async fetchOrdersForStore(
    store: ShoplineStoreConfig,
    params: {
      start: Date;
      end: Date;
    },
  ) {
    const orders: UnifiedOrder[] = [];
    let previousId: string | undefined;
    let hasNext = true;

    while (hasNext) {
      const search = new URLSearchParams({
        per_page: String(this.perPage),
        sort_by: 'asc',
        updated_after: this.formatUtcDateTime(params.start),
        updated_before: this.formatUtcDateTime(params.end),
      });

      if (previousId) {
        search.set('previous_id', previousId);
      }

      const response = await this.request<ShoplineListResponse<ShoplineOrderPayload>>(
        `/orders?${search.toString()}`,
        store,
      );
      const items = Array.isArray(response.items) ? response.items : [];

      orders.push(...items.map((item) => this.mapToUnifiedOrder(item, store)));

      previousId = items[items.length - 1]?.id?.trim() || undefined;
      hasNext =
        Boolean(previousId) &&
        (response.pagination?.has_next_page === true ||
          items.length >= this.perPage);
    }

    return orders;
  }

  private async fetchTransactionsForStore(
    store: ShoplineStoreConfig,
    params: {
      start: Date;
      end: Date;
    },
  ) {
    const orders = await this.fetchOrdersForStore(store, params);
    return orders
      .map((order) => this.mapOrderToUnifiedTransaction(order))
      .filter((value): value is UnifiedTransaction => Boolean(value));
  }

  private async fetchCustomersForStore(
    store: ShoplineStoreConfig,
    params: {
      start: Date;
      end: Date;
    },
  ) {
    const customers: Array<
      ShoplineCustomerPayload & { rawStore: ShoplineStoreConfig }
    > = [];
    let previousId: string | undefined;
    let hasNext = true;

    while (hasNext) {
      const search = new URLSearchParams({
        per_page: String(this.perPage),
        updated_after: this.formatUtcDateTime(params.start),
        updated_before: this.formatUtcDateTime(params.end),
      });

      if (previousId) {
        search.set('previous_id', previousId);
      }

      const response =
        await this.request<ShoplineListResponse<ShoplineCustomerPayload>>(
          `/customers?${search.toString()}`,
          store,
        );
      const items = Array.isArray(response.items) ? response.items : [];

      customers.push(...items.map((item) => ({ ...item, rawStore: store })));

      previousId = items[items.length - 1]?.id?.trim() || undefined;
      hasNext =
        Boolean(previousId) &&
        (response.pagination?.has_next_page === true ||
          items.length >= this.perPage);
    }

    return customers;
  }

  private async fetchTokenInfo(store: ShoplineStoreConfig) {
    return this.request<ShoplineTokenInfoResponse>('/token/info', store);
  }

  private mapToUnifiedOrder(
    order: ShoplineOrderPayload,
    store: ShoplineStoreConfig,
  ): UnifiedOrder {
    const currency = order.currency_iso || order.total?.currency_iso || 'TWD';
    const totalGross = this.moneyToDecimal(order.total);
    const discount = this.moneyToDecimal(order.order_discount).add(
      this.moneyToDecimal(order.user_credit),
    );
    const tax = this.moneyToDecimal(order.total_tax_fee);
    const shipping = this.moneyToDecimal(order.order_delivery?.total);
    const items = (order.subtotal_items || []).map((item) =>
      this.mapToUnifiedOrderItem(item, currency),
    );

    return {
      externalId: order.order_number || order.id || '',
      orderDate: new Date(order.created_at || order.updated_at || Date.now()),
      status: this.mapOrderStatus(order),
      customer: {
        externalId: order.customer_id || undefined,
        email: order.customer_email || undefined,
        name: order.customer_name || undefined,
        phone: order.customer_phone || undefined,
      },
      items,
      totals: {
        currency,
        gross: totalGross,
        tax,
        discount,
        shipping,
        net: totalGross.sub(tax),
      },
      raw: {
        ...order,
        sourceStoreHandle: store.handle,
        sourceStoreName: store.storeName || '',
      },
    };
  }

  private mapOrderToUnifiedTransaction(
    order: UnifiedOrder,
  ): UnifiedTransaction | null {
    const raw = order.raw || {};
    const payment = raw.order_payment || {};
    const paymentType = this.pickString(
      payment.payment_data?.notify_response?.payment_gateway,
      payment.payment_type,
    );
    const fee = this.moneyToDecimal(payment.payment_fee);
    const amount =
      this.moneyToDecimal(payment.total).greaterThan(0)
        ? this.moneyToDecimal(payment.total)
        : order.totals.gross;
    const status = this.mapTransactionStatus(raw);
    const feeMeta = this.resolveFeeMeta(paymentType, fee);
    const externalId = this.pickString(
      payment.payment_data?.create_payment?.resp?.paymentOrderId,
      payment.payment_data?.notify_response?.id,
      payment.id,
      `${raw.sourceStoreHandle || 'shopline'}:${order.externalId}:payment`,
    );

    const type: UnifiedTransaction['type'] =
      status === 'failed' && order.status === 'refunded' ? 'refund' : 'sale';

    return {
      externalId,
      orderId: order.externalId,
      date: new Date(
        payment.paid_at ||
          payment.updated_at ||
          payment.created_at ||
          raw.updated_at ||
          raw.created_at ||
          order.orderDate,
      ),
      type,
      amount,
      fee,
      net: amount.sub(fee),
      currency: order.totals.currency || 'TWD',
      status,
      gateway: paymentType || undefined,
      feeStatus: feeMeta.status,
      feeSource: feeMeta.source,
      raw,
    };
  }

  private mapToUnifiedOrderItem(item: ShoplineOrderItem, currency: string) {
    const quantity = this.toNumber(item.quantity, 1);
    const unitPrice = this.moneyToDecimal(item.price || item.item_price);
    const total = this.moneyToDecimal(item.item_price || item.price);
    const discountSource = item.item_data?.order_discounted_price;
    const discount = discountSource
      ? unitPrice.sub(this.moneyToDecimal(discountSource))
      : new Decimal(0);

    return {
      sku:
        item.sku ||
        item.item_data?.variation_data?.sku ||
        item.id ||
        'SHOPLINE-ITEM',
      productName: this.resolveItemName(item),
      quantity,
      unitPrice,
      discount,
      tax: new Decimal(0),
      total,
    };
  }

  private mapOrderStatus(
    order: ShoplineOrderPayload,
  ): 'pending' | 'completed' | 'cancelled' | 'refunded' {
    const orderStatus = (order.status || '').trim().toLowerCase();
    const paymentStatus = (order.order_payment?.status || '')
      .trim()
      .toLowerCase();

    if (['cancelled', 'canceled', 'removed'].includes(orderStatus)) {
      return 'cancelled';
    }

    if (['refunded', 'refund'].includes(paymentStatus)) {
      return 'refunded';
    }

    if (
      ['paid', 'completed', 'success'].includes(paymentStatus) ||
      ['completed', 'confirmed'].includes(orderStatus)
    ) {
      return 'completed';
    }

    return 'pending';
  }

  private moneyToDecimal(money?: ShoplineMoney | null) {
    if (!money) {
      return new Decimal(0);
    }

    const value = money.dollars ?? money.cents ?? 0;
    return new Decimal(value || 0);
  }

  private mapTransactionStatus(
    raw: ShoplineOrderPayload,
  ): 'pending' | 'success' | 'failed' {
    const paymentStatus = (raw.order_payment?.status || '').trim().toLowerCase();
    const orderStatus = (raw.status || '').trim().toLowerCase();

    if (
      ['completed', 'paid', 'success'].includes(paymentStatus) ||
      (raw.order_payment?.paid_at && paymentStatus !== 'failed')
    ) {
      return 'success';
    }

    if (
      ['failed', 'cancelled', 'canceled', 'refunded', 'refund'].includes(
        paymentStatus,
      ) ||
      ['cancelled', 'canceled', 'removed'].includes(orderStatus)
    ) {
      return 'failed';
    }

    return 'pending';
  }

  private resolveFeeMeta(
    paymentType: string,
    fee: Decimal,
  ): {
    status: 'actual' | 'estimated' | 'unavailable' | 'not_applicable';
    source: string;
  } {
    const normalized = paymentType.trim().toLowerCase();

    if (
      [
        'cash_on_delivery',
        'cod',
        'cash',
        'bank_transfer',
        'atm',
      ].includes(normalized)
    ) {
      return {
        status: 'not_applicable',
        source: 'shopline.payment.no_fee',
      };
    }

    if (fee.greaterThanOrEqualTo(0)) {
      return {
        status: 'actual',
        source: 'shopline.order_payment.fee',
      };
    }

    return {
      status: 'unavailable',
      source: 'shopline.payment.pending',
    };
  }

  private toNumber(value: unknown, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : fallback;
  }

  private resolveItemName(item: ShoplineOrderItem) {
    const zh =
      item.title_translations?.['zh-hant'] ||
      item.fields_translations?.['zh-hant']?.filter(Boolean).join(' / ');
    const en =
      item.title_translations?.en ||
      item.fields_translations?.en?.filter(Boolean).join(' / ');
    return zh || en || item.sku || 'SHOPLINE Item';
  }

  private pickString(...values: Array<unknown>) {
    return (
      values
        .map((value) =>
          value === undefined || value === null ? '' : String(value).trim(),
        )
        .find((value) => value) || ''
    );
  }

  private async request<T>(path: string, store: ShoplineStoreConfig) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${store.token}`,
        'User-Agent': store.handle,
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(
        `SHOPLINE API Error ${response.status}: ${bodyText || response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }

  private formatUtcDateTime(date: Date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private assertConfig() {
    if (!this.stores.length) {
      throw new Error(
        'SHOPLINE_ACCESS_TOKEN / SHOPLINE_HANDLE or SHOPLINE_STORES_JSON is required',
      );
    }
  }

  private loadStores() {
    const storesJson =
      this.configService.get<string>('SHOPLINE_STORES_JSON', '') || '';

    if (storesJson.trim()) {
      try {
        const parsed = JSON.parse(storesJson);
        if (Array.isArray(parsed)) {
          return parsed
            .map((store) => ({
              token:
                typeof store?.token === 'string' ? store.token.trim() : '',
              handle:
                typeof store?.handle === 'string' ? store.handle.trim() : '',
              storeName:
                typeof store?.storeName === 'string'
                  ? store.storeName.trim()
                  : '',
              merchantId:
                typeof store?.merchantId === 'string'
                  ? store.merchantId.trim()
                  : '',
            }))
            .filter((store) => store.token && store.handle);
        }
      } catch (error: any) {
        this.logger.warn(
          `Failed to parse SHOPLINE_STORES_JSON: ${error.message}`,
        );
      }
    }

    const token =
      this.configService.get<string>('SHOPLINE_ACCESS_TOKEN', '') || '';
    const handle = this.configService.get<string>('SHOPLINE_HANDLE', '') || '';

    if (!token.trim() || !handle.trim()) {
      return [] as ShoplineStoreConfig[];
    }

    return [
      {
        token: token.trim(),
        handle: handle.trim(),
        storeName:
          this.configService.get<string>('SHOPLINE_STORE_NAME', '') || '',
        merchantId:
          this.configService.get<string>('SHOPLINE_MERCHANT_ID', '') || '',
      },
    ];
  }
}
