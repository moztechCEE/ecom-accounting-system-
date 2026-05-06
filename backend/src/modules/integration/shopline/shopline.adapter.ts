import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ISalesChannelAdapter,
  UnifiedOrder,
  UnifiedTransaction,
} from '../interfaces/sales-channel-adapter.interface';

export type ShoplineStoreConfig = {
  token: string;
  handle?: string;
  storeName?: string;
  merchantId?: string;
};

export type ShoplinePaymentsQuery = {
  start?: Date;
  end?: Date;
  limit?: number | string;
  maxPages?: number | string;
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

export type ShoplinePaymentBillingRecord = Record<string, unknown> & {
  id?: string;
  type?: string;
  source_order_id?: string;
  source_order_transaction_id?: string;
  transaction_amount?: string;
  transaction_currency?: string;
  amount?: string;
  net?: string;
  payment_method_fee?: string | null;
  interchange_fee?: string | null;
  scheme_fee?: string | null;
  revolving_margin_account_balance?: string | null;
  posting_time?: string;
  settlement_batch_id?: string;
  account_type?: string;
  account_currency?: string;
  rawStore?: Pick<ShoplineStoreConfig, 'handle' | 'storeName' | 'merchantId'>;
};

export type ShoplinePaymentStoreTransaction = Record<string, unknown> & {
  id?: string;
  trade_order_id?: string;
  transaction_type?: string;
  status?: string;
  amount?: string;
  currency?: string;
  created_at?: string;
  rawStore?: Pick<ShoplineStoreConfig, 'handle' | 'storeName' | 'merchantId'>;
};

export type ShoplinePaymentPayout = Record<string, unknown> & {
  id?: string;
  payout_transaction_no?: string;
  amount?: string;
  currency?: string;
  status?: string;
  time?: string;
  date?: string;
  rawStore?: Pick<ShoplineStoreConfig, 'handle' | 'storeName' | 'merchantId'>;
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

type ShoplineAgentPayload = {
  id?: string;
  _id?: string;
  name?: string;
  email?: string;
  status?: string;
  role?: string;
  [key: string]: unknown;
};

type ShoplineAdminListResult<T> = {
  items: T[];
  nextPageInfo: string | null;
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
    this.assertTokenConfig();

    return Promise.all(
      this.stores.map(async (store) => {
        const info = await this.fetchTokenInfo(store);
        return {
          storeName: store.storeName || null,
          handle: store.handle || null,
          merchantId: info.merchant?._id || store.merchantId || null,
          merchantHandle: info.merchant?.handle || null,
          merchantName: info.merchant?.name || null,
          userEmail: info.user?.email || info.staff?.email || null,
        };
      }),
    );
  }

  async getAgents(params: { merchantId?: string } = {}) {
    const stores = this.getSyncReadyStores();

    return Promise.all(
      stores.map(async (store) => {
        const configuredMerchantId =
          params.merchantId || store.merchantId || '';
        const tokenInfo = configuredMerchantId
          ? null
          : await this.fetchTokenInfo(store);
        const merchantId =
          configuredMerchantId ||
          tokenInfo?.merchant?._id ||
          tokenInfo?.staff?.merchant_ids?.[0] ||
          '';

        if (!merchantId) {
          throw new Error(
            `SHOPLINE merchant_id is required for agents API (${store.handle})`,
          );
        }

        const search = new URLSearchParams({ merchant_id: merchantId });
        const response = await this.request<
          ShoplineAgentPayload[] | { items?: ShoplineAgentPayload[] }
        >(`/agents?${search.toString()}`, store);
        const agents = Array.isArray(response)
          ? response
          : Array.isArray(response.items)
            ? response.items
            : [];

        return {
          storeName: store.storeName || null,
          handle: store.handle,
          merchantId,
          count: agents.length,
          agents: agents.map((agent) => ({
            id: String(agent._id || agent.id || '').trim() || null,
            name: typeof agent.name === 'string' ? agent.name : null,
            email: typeof agent.email === 'string' ? agent.email : null,
            status: typeof agent.status === 'string' ? agent.status : null,
            role: typeof agent.role === 'string' ? agent.role : null,
          })),
        };
      }),
    );
  }

  async fetchOrders(params: {
    start: Date;
    end: Date;
  }): Promise<UnifiedOrder[]> {
    const stores = this.getSyncReadyStores();

    const orders = await Promise.all(
      stores.map((store) => this.fetchOrdersForStore(store, params)),
    );

    return orders.flat();
  }

  async fetchCustomers(params: {
    start: Date;
    end: Date;
  }): Promise<
    Array<ShoplineCustomerPayload & { rawStore: ShoplineStoreConfig }>
  > {
    const stores = this.getSyncReadyStores();

    const customers = await Promise.all(
      stores.map((store) => this.fetchCustomersForStore(store, params)),
    );

    return customers.flat();
  }

  async fetchTransactions(_params: {
    start: Date;
    end: Date;
  }): Promise<UnifiedTransaction[]> {
    const stores = this.getSyncReadyStores();

    const transactions = await Promise.all(
      stores.map((store) => this.fetchTransactionsForStore(store, _params)),
    );

    return transactions.flat();
  }

  async fetchPaymentBalance() {
    const stores = this.getSyncReadyStores();

    return Promise.all(
      stores.map(async (store) => {
        const response = await this.adminRequest<{ balance?: unknown }>(
          '/payments/store/balance.json',
          store,
        );

        return {
          store: this.toRawStore(store),
          balance: response.data.balance ?? response.data,
          traceId: response.traceId,
        };
      }),
    );
  }

  async fetchPaymentBillingRecords(
    params: ShoplinePaymentsQuery,
  ): Promise<ShoplinePaymentBillingRecord[]> {
    const stores = this.getSyncReadyStores();
    const records = await Promise.all(
      stores.map((store) =>
        this.fetchAdminPaginated<ShoplinePaymentBillingRecord>(
          store,
          '/payments/store/balance_transactions.json',
          params,
          'transactions',
        ),
      ),
    );

    return records.flat();
  }

  async fetchPaymentStoreTransactions(
    params: ShoplinePaymentsQuery,
  ): Promise<ShoplinePaymentStoreTransaction[]> {
    const stores = this.getSyncReadyStores();
    const records = await Promise.all(
      stores.map((store) =>
        this.fetchAdminPaginated<ShoplinePaymentStoreTransaction>(
          store,
          '/payments/store/transactions.json',
          params,
          'transactions',
        ),
      ),
    );

    return records.flat();
  }

  async fetchPaymentPayouts(
    params: ShoplinePaymentsQuery,
  ): Promise<ShoplinePaymentPayout[]> {
    const stores = this.getSyncReadyStores();
    const payouts = await Promise.all(
      stores.map((store) =>
        this.fetchAdminPaginated<ShoplinePaymentPayout>(
          store,
          '/payments/store/payouts.json',
          params,
          'payouts',
        ),
      ),
    );

    return payouts.flat();
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

      const response = await this.request<
        ShoplineListResponse<ShoplineOrderPayload>
      >(`/orders?${search.toString()}`, store);
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

      const response = await this.request<
        ShoplineListResponse<ShoplineCustomerPayload>
      >(`/customers?${search.toString()}`, store);
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

  private async fetchAdminPaginated<T extends Record<string, unknown>>(
    store: ShoplineStoreConfig & { handle: string },
    path: string,
    params: ShoplinePaymentsQuery,
    responseKey: 'transactions' | 'payouts',
  ): Promise<T[]> {
    const maxPages = Math.min(
      Math.max(Number(params.maxPages || (params.pageInfo ? 1 : 20)), 1),
      200,
    );
    const items: T[] = [];
    let pageInfo = params.pageInfo?.trim() || '';
    let page = 0;

    while (page < maxPages) {
      const result = await this.fetchAdminPage<T>(
        store,
        path,
        params,
        responseKey,
        pageInfo || undefined,
      );

      items.push(
        ...result.items.map((item) => ({
          ...item,
          rawStore: this.toRawStore(store),
        })),
      );

      page += 1;
      pageInfo = result.nextPageInfo || '';
      if (!pageInfo || params.pageInfo) {
        break;
      }
    }

    return items;
  }

  private async fetchAdminPage<T extends Record<string, unknown>>(
    store: ShoplineStoreConfig & { handle: string },
    path: string,
    params: ShoplinePaymentsQuery,
    responseKey: 'transactions' | 'payouts',
    pageInfo?: string,
  ): Promise<ShoplineAdminListResult<T>> {
    const search = new URLSearchParams();
    const limit = Math.min(Math.max(Number(params.limit || 100), 1), 100);
    search.set('limit', String(limit));

    if (pageInfo) {
      search.set('page_info', pageInfo);
    } else {
      this.addAdminDateRangeParams(path, search, params);
      this.setSearchParam(search, 'since_id', params.sinceId);
      this.setSearchParam(search, 'payout_id', params.payoutId);
      this.setSearchParam(
        search,
        'payout_transaction_no',
        params.payoutTransactionNo,
      );
      this.setSearchParam(search, 'account_type', params.accountType);
      this.setSearchParam(search, 'transaction_type', params.transactionType);
      this.setSearchParam(search, 'status', params.status);
      this.setSearchParam(search, 'trade_order_id', params.tradeOrderId);

      if (params.isSettlementDetails !== undefined) {
        search.set(
          'is_settlement_details',
          String(
            params.isSettlementDetails === true ||
              params.isSettlementDetails === 'true',
          ),
        );
      }
    }

    const response = await this.adminRequest<Record<string, unknown>>(
      `${path}?${search.toString()}`,
      store,
    );
    const rawItems = response.data[responseKey];
    const pageItems = Array.isArray(rawItems) ? (rawItems as T[]) : [];

    return {
      items: pageItems,
      nextPageInfo: this.extractNextPageInfo(response.link),
    };
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

  mapOrderToUnifiedTransaction(order: UnifiedOrder): UnifiedTransaction | null {
    const raw = order.raw || {};
    const payment = raw.order_payment || {};
    const paymentType = this.pickString(
      payment.payment_data?.notify_response?.payment_gateway,
      payment.payment_type,
    );
    const fee = this.moneyToDecimal(payment.payment_fee);
    const amount = this.moneyToDecimal(payment.total).greaterThan(0)
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
    const paymentStatus = (raw.order_payment?.status || '')
      .trim()
      .toLowerCase();
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
      ['cash_on_delivery', 'cod', 'cash', 'bank_transfer', 'atm'].includes(
        normalized,
      )
    ) {
      return {
        status: 'not_applicable',
        source: 'shopline.payment.no_fee',
      };
    }

    if (fee.greaterThan(0)) {
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
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${store.token}`,
    };
    if (store.handle) {
      headers['User-Agent'] = store.handle;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const bodyText = this.redactSensitiveText(await response.text(), store);
      throw new Error(
        `SHOPLINE API Error ${response.status}: ${bodyText || response.statusText}`,
      );
    }

    return this.parseJsonResponse<T>(await response.text(), {
      source: 'SHOPLINE API',
      status: response.status,
      contentType: response.headers.get('content-type'),
      store,
    });
  }

  private async adminRequest<T>(
    path: string,
    store: ShoplineStoreConfig & { handle: string },
  ) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${store.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (store.handle) {
      headers['User-Agent'] = store.handle;
    }

    const response = await fetch(`${this.getAdminBaseUrl(store)}${path}`, {
      method: 'GET',
      headers,
    });

    const bodyText = await response.text();

    if (!response.ok) {
      throw new BadGatewayException(
        `SHOPLINE Payments API Error ${response.status}: ${
          this.redactSensitiveText(bodyText, store) || response.statusText
        }`,
      );
    }

    return {
      data: this.parseJsonResponse<T>(bodyText, {
        source: 'SHOPLINE Payments API',
        status: response.status,
        contentType: response.headers.get('content-type'),
        store,
      }),
      link: response.headers.get('link'),
      traceId: response.headers.get('traceId'),
    };
  }

  private parseJsonResponse<T>(
    bodyText: string,
    context: {
      source: string;
      status: number;
      contentType: string | null;
      store: ShoplineStoreConfig;
    },
  ) {
    try {
      return JSON.parse(bodyText) as T;
    } catch (error: any) {
      const preview = this.redactSensitiveText(bodyText, context.store)
        .replace(/\s+/g, ' ')
        .slice(0, 240);
      throw new BadGatewayException(
        `${context.source} returned non-JSON response ${context.status} (${context.contentType || 'unknown content-type'}): ${
          preview || error.message
        }`,
      );
    }
  }

  private redactSensitiveText(value: string, store: ShoplineStoreConfig) {
    let redacted = value;
    if (store.token) {
      redacted = redacted.split(store.token).join('[REDACTED_TOKEN]');
    }
    return redacted.replace(
      /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
      'Bearer [REDACTED_TOKEN]',
    );
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

  private formatIsoDateTime(date: Date) {
    return date.toISOString();
  }

  private addAdminDateRangeParams(
    path: string,
    search: URLSearchParams,
    params: ShoplinePaymentsQuery,
  ) {
    if (!params.start || !params.end) {
      return;
    }

    if (path.includes('/transactions.json')) {
      search.set('date_min', this.formatIsoDateTime(params.start));
      search.set('date_max', this.formatIsoDateTime(params.end));
      return;
    }

    search.set('start_time', this.formatIsoDateTime(params.start));
    search.set('end_time', this.formatIsoDateTime(params.end));
  }

  private setSearchParam(
    search: URLSearchParams,
    key: string,
    value?: string | null,
  ) {
    const normalized = value?.trim();
    if (normalized) {
      search.set(key, normalized);
    }
  }

  private extractNextPageInfo(linkHeader: string | null) {
    if (!linkHeader) {
      return null;
    }

    for (const part of linkHeader.split(',')) {
      if (!/rel="?next"?/i.test(part)) {
        continue;
      }
      const match = part.match(/<([^>]+)>/);
      if (!match?.[1]) {
        continue;
      }
      try {
        return new URL(match[1]).searchParams.get('page_info');
      } catch {
        return null;
      }
    }

    return null;
  }

  private getAdminBaseUrl(store: ShoplineStoreConfig & { handle: string }) {
    const explicitBase =
      this.configService.get<string>('SHOPLINE_ADMIN_API_BASE_URL', '') || '';
    if (explicitBase.trim()) {
      return explicitBase
        .trim()
        .replace('{handle}', store.handle)
        .replace(/\/$/, '');
    }

    const version =
      this.configService.get<string>(
        'SHOPLINE_ADMIN_API_VERSION',
        'v20260301',
      ) || 'v20260301';
    return `https://${store.handle}.myshopline.com/admin/openapi/${version}`;
  }

  private toRawStore(store: ShoplineStoreConfig) {
    return {
      handle: store.handle || '',
      storeName: store.storeName || '',
      merchantId: store.merchantId || '',
    };
  }

  private assertTokenConfig() {
    if (!this.stores.length) {
      throw new Error(
        'SHOPLINE_ACCESS_TOKEN or SHOPLINE_STORES_JSON with token is required',
      );
    }
  }

  private getSyncReadyStores() {
    this.assertTokenConfig();

    const stores = this.stores.filter((store) => store.token && store.handle);
    if (!stores.length) {
      throw new Error(
        'SHOPLINE_HANDLE or SHOPLINE_STORES_JSON handle is required for order/customer sync',
      );
    }

    return stores as Array<ShoplineStoreConfig & { handle: string }>;
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
              token: typeof store?.token === 'string' ? store.token.trim() : '',
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
            .filter((store) => store.token);
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

    if (!token.trim()) {
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
