import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ISalesChannelAdapter,
  UnifiedOrder,
  UnifiedTransaction,
} from '../interfaces/sales-channel-adapter.interface';

export type OneShopStoreConfig = {
  account?: string;
  storeName?: string;
  appId: string;
  secret: string;
};

type OneShopListOrder = {
  order_number: string;
  create_date: string;
  total_price: number | string;
  progress_status?: string;
  payment_status?: string;
  logistic_status?: string;
  name?: string;
  email?: string;
  phone?: string;
  note?: string;
  shop_note?: string;
};

type OneShopListResponse = {
  success: number;
  data?: {
    order?: OneShopListOrder[] | OneShopListOrder;
    page?: {
      total_page?: number;
      correct_page?: number;
      page_order?: number;
      total_order?: number;
    };
  };
  msg?: string;
};

@Injectable()
export class OneShopHttpAdapter implements ISalesChannelAdapter {
  readonly code = '1SHOP';
  private readonly logger = new Logger(OneShopHttpAdapter.name);
  private readonly baseUrl: string;
  private readonly minRequestIntervalMs: number;
  private lastRequestAt = 0;
  private readonly stores: OneShopStoreConfig[];

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('ONESHOP_API_BASE_URL', '') ||
      'https://api.1shop.tw/v1';
    this.minRequestIntervalMs = Number(
      this.configService.get<string>('ONESHOP_MIN_REQUEST_INTERVAL_MS', '1100'),
    );
    this.stores = this.loadStores();
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    if (!this.stores.length) {
      return {
        success: false,
        message: 'ONESHOP stores configuration is required',
      };
    }

    try {
      for (const store of this.stores) {
        await this.fetchOrderPage(store, {
          page: 1,
          start: undefined,
          end: undefined,
        });
      }
      return { success: true, message: 'Connection successful' };
    } catch (error: any) {
      this.logger.error(`1Shop connection failed: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  getStores() {
    return this.stores;
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

  async fetchOrdersForStore(
    store: OneShopStoreConfig,
    params: {
      start: Date;
      end: Date;
    },
  ): Promise<UnifiedOrder[]> {
    this.assertStoreConfig(store);

    const allOrders: UnifiedOrder[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const body = await this.fetchOrderPage(store, {
        page,
        start: params.start,
        end: params.end,
      });
      const orders = this.extractOrders(body);

      for (const order of orders) {
        allOrders.push(this.mapToUnifiedOrder(store, order));
      }

      totalPages = Number(body.data?.page?.total_page || page);
      page += 1;
    } while (page <= totalPages);

    return allOrders;
  }

  async fetchTransactions(): Promise<UnifiedTransaction[]> {
    return [];
  }

  private async fetchOrderPage(
    store: OneShopStoreConfig,
    params: {
    page: number;
    start?: Date;
    end?: Date;
    },
  ) {
    const search = new URLSearchParams({
      appid: store.appId,
      secret: store.secret,
      progress_status: 'all',
      payment_status: 'all',
      logistic_status: 'all',
      page: String(params.page),
    });

    if (params.start) {
      search.set('create_date_start', this.formatDateParam(params.start));
    }
    if (params.end) {
      search.set('create_date_end', this.formatDateParam(params.end));
    }

    return this.request<OneShopListResponse>(`/order?${search.toString()}`);
  }

  private extractOrders(body: OneShopListResponse) {
    const payload = body.data?.order;
    if (!payload) {
      return [] as OneShopListOrder[];
    }

    return Array.isArray(payload) ? payload : [payload];
  }

  private mapToUnifiedOrder(
    store: OneShopStoreConfig,
    raw: OneShopListOrder,
  ): UnifiedOrder {
    const gross = new Decimal(raw.total_price || 0);
    const status = this.mapStatus(raw.progress_status, raw.payment_status);
    const externalOrderId = String(raw.order_number);
    const externalStoreId = store.account || store.appId;

    return {
      externalId: `${externalStoreId}:${externalOrderId}`,
      orderDate: this.parseOneShopDate(raw.create_date),
      status,
      customer: {
        externalId: `${externalStoreId}:${externalOrderId}`,
        email: raw.email || undefined,
        name: raw.name || undefined,
        phone: raw.phone || undefined,
      },
      items: [],
      totals: {
        currency: 'TWD',
        gross,
        tax: new Decimal(0),
        discount: new Decimal(0),
        shipping: new Decimal(0),
        net: gross,
      },
      raw: {
        ...raw,
        sourceStoreAccount: store.account || null,
        sourceStoreName: store.storeName || null,
        sourceAppId: store.appId,
        originalOrderNumber: externalOrderId,
      },
    };
  }

  private mapStatus(
    progressStatus?: string,
    paymentStatus?: string,
  ): 'pending' | 'completed' | 'cancelled' | 'refunded' {
    if (progressStatus === 'cancelled') {
      return 'cancelled';
    }

    if (paymentStatus === 'refunded') {
      return 'refunded';
    }

    if (progressStatus === 'completed') {
      return 'completed';
    }

    return 'pending';
  }

  private parseOneShopDate(value?: string) {
    if (!value) {
      return new Date();
    }

    const normalized = value.replace(' ', 'T');
    return new Date(`${normalized}+08:00`);
  }

  private formatDateParam(value: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }

  private async request<T>(path: string): Promise<T> {
    this.assertConfig();
    await this.waitForRateLimit();

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const bodyText = await response.text();
    let body: any = null;

    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      throw new Error(`1Shop API returned non-JSON response (${response.status})`);
    }

    if (!response.ok) {
      throw new Error(
        `1Shop API Error ${response.status}: ${body?.msg || bodyText || 'Unknown error'}`,
      );
    }

    if (body?.success !== 0) {
      throw new Error(body?.msg || `1Shop API returned success=${body?.success}`);
    }

    return body as T;
  }

  private async waitForRateLimit() {
    const now = Date.now();
    const delta = now - this.lastRequestAt;

    if (delta < this.minRequestIntervalMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minRequestIntervalMs - delta),
      );
    }

    this.lastRequestAt = Date.now();
  }

  private assertConfig() {
    if (!this.baseUrl) {
      throw new Error('1Shop configuration missing: ONESHOP_API_BASE_URL');
    }

    if (!this.stores.length) {
      throw new Error('1Shop configuration missing: ONESHOP stores are required');
    }
  }

  private assertStoreConfig(store: OneShopStoreConfig) {
    if (!store.appId || !store.secret) {
      throw new Error('1Shop store configuration missing: appId and secret are required');
    }
  }

  private loadStores(): OneShopStoreConfig[] {
    const storesJson =
      this.configService.get<string>('ONESHOP_STORES_JSON', '') || '';

    if (storesJson.trim()) {
      try {
        const parsed = JSON.parse(storesJson);
        if (Array.isArray(parsed)) {
          return parsed
            .map((store) => ({
              account:
                typeof store?.account === 'string' ? store.account.trim() : '',
              storeName:
                typeof store?.storeName === 'string'
                  ? store.storeName.trim()
                  : '',
              appId: typeof store?.appId === 'string' ? store.appId.trim() : '',
              secret:
                typeof store?.secret === 'string' ? store.secret.trim() : '',
            }))
            .filter((store) => store.appId && store.secret);
        }
      } catch (error: any) {
        this.logger.error(`Invalid ONESHOP_STORES_JSON config: ${error.message}`);
      }
    }

    const appId = this.configService.get<string>('ONESHOP_APP_ID', '') || '';
    const secret = this.configService.get<string>('ONESHOP_SECRET', '') || '';
    const account =
      this.configService.get<string>('ONESHOP_ACCOUNT', '') || '';
    const storeName =
      this.configService.get<string>('ONESHOP_STORE_NAME', '') || '';

    if (appId && secret) {
      return [
        {
          account,
          storeName,
          appId,
          secret,
        },
      ];
    }

    return [];
  }
}
