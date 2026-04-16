import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ISalesChannelAdapter,
  UnifiedOrder,
  UnifiedTransactionFeeStatus,
  UnifiedTransaction,
} from '../interfaces/sales-channel-adapter.interface';

interface ShopifyOrderPayload {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  currency: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  financial_status: string;
  fulfillment_status: string;
  email: string;
  customer?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
  };
  line_items: any[];
  shipping_lines: any[];
  cancelled_at: string | null;
}

type GatewayFeeRule = {
  match: string;
  rate: number;
  fixed: number;
};

@Injectable()
export class ShopifyHttpAdapter implements ISalesChannelAdapter {
  readonly code = 'SHOPIFY';
  private readonly logger = new Logger(ShopifyHttpAdapter.name);
  private readonly shopDomain: string;
  private readonly token: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiVersion: string;
  private readonly gatewayFeeRules: GatewayFeeRule[];
  private accessTokenCache: { token: string; expiresAt: number } | null = null;
  private accessTokenPromise: Promise<string> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.shopDomain = this.configService.get<string>('SHOPIFY_SHOP', '') || '';
    this.token = this.configService.get<string>('SHOPIFY_TOKEN', '') || '';
    this.clientId =
      this.configService.get<string>('SHOPIFY_CLIENT_ID', '') || '';
    this.clientSecret =
      this.configService.get<string>('SHOPIFY_CLIENT_SECRET', '') || '';
    this.apiVersion = this.configService.get<string>(
      'SHOPIFY_API_VERSION',
      '2024-10',
    );
    this.gatewayFeeRules = this.parseGatewayFeeRules(
      this.configService.get<string>('SHOPIFY_GATEWAY_FEE_RULES', '') || '',
    );
  }

  private get baseUrl() {
    const domain = this.shopDomain
      .replace(/^https?:\/\//, '')
      .replace(/\.myshopify\.com$/, '');
    return `https://${domain}.myshopify.com/admin/api/${this.apiVersion}`;
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    if (
      !this.shopDomain ||
      (!this.token && !(this.clientId && this.clientSecret))
    ) {
      return {
        success: false,
        message:
          'SHOPIFY_SHOP and either SHOPIFY_TOKEN or SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET are required',
      };
    }
    try {
      await this.request('GET', '/shop.json');
      return { success: true, message: 'Connection successful' };
    } catch (error: any) {
      this.logger.error(`Shopify connection failed: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  async fetchOrders(params: {
    start: Date;
    end: Date;
  }): Promise<UnifiedOrder[]> {
    this.assertConfig();
    const limit = 250;
    let path = `/orders.json?status=any&limit=${limit}`;

    if (params.start) path += `&updated_at_min=${params.start.toISOString()}`;
    if (params.end) path += `&updated_at_max=${params.end.toISOString()}`;

    let allOrders: UnifiedOrder[] = [];
    let hasNext = true;

    try {
      while (hasNext) {
        const { body, headers } = await this.request('GET', path);
        if (!body.orders) break;

        // Sequential processing to allow async FX rate fetching
        const mappedOrders: UnifiedOrder[] = [];
        for (const order of body.orders) {
          mappedOrders.push(await this.mapToUnifiedOrder(order));
        }
        allOrders = allOrders.concat(mappedOrders);

        const linkHeader = headers.get('Link');
        if (linkHeader) {
          const nextLink = linkHeader
            .split(',')
            .find((s: string) => s.includes('rel="next"'));
          if (nextLink) {
            const match = nextLink.match(/<([^>]+)>/);
            if (match) {
              path = match[1];
            } else {
              hasNext = false;
            }
          } else {
            hasNext = false;
          }
        } else {
          hasNext = false;
        }
      }
      return allOrders;
    } catch (error: any) {
      this.logger.error(`Failed to fetch orders: ${error.message}`);
      throw error;
    }
  }

  async fetchOrderById(orderId: string): Promise<UnifiedOrder | null> {
    this.assertConfig();

    try {
      const { body } = await this.request('GET', `/orders/${orderId}.json`);
      if (!body.order) {
        return null;
      }
      return this.mapToUnifiedOrder(body.order);
    } catch (error: any) {
      if (String(error.message).includes('Shopify API Error 404')) {
        this.logger.warn(`Shopify order ${orderId} not found`);
        return null;
      }
      throw error;
    }
  }

  async fetchTransactionsForOrder(
    orderId: string,
    order?: UnifiedOrder,
  ): Promise<UnifiedTransaction[]> {
    this.assertConfig();

    const resolvedOrder = order ?? (await this.fetchOrderById(orderId));
    if (!resolvedOrder) {
      return [];
    }

    const { body } = await this.request(
      'GET',
      `/orders/${orderId}/transactions.json`,
    );
    return Promise.all(
      (body.transactions || []).map((tx: any) =>
        this.mapToUnifiedTransaction(tx, resolvedOrder),
      ),
    );
  }

  async fetchTransactions(params: {
    start: Date;
    end: Date;
  }): Promise<UnifiedTransaction[]> {
    this.assertConfig();
    const orders = await this.fetchOrders(params);
    const transactions: UnifiedTransaction[] = [];

    for (const order of orders) {
      try {
        const txs = await this.fetchTransactionsForOrder(
          order.externalId,
          order,
        );
        transactions.push(...txs);
      } catch (error: any) {
        this.logger.error(
          `Failed to fetch txs for order ${order.externalId}: ${error.message}`,
        );
      }
    }
    return transactions;
  }

  // --- Private Helpers ---

  private async mapToUnifiedOrder(
    raw: ShopifyOrderPayload,
  ): Promise<UnifiedOrder> {
    const currency = raw.currency;
    const fxRate = await this.getFxRate(currency, new Date(raw.created_at));

    const totalGross = new Decimal(raw.total_price);
    const totalTax = new Decimal(raw.total_tax);
    const totalDiscount = new Decimal(raw.total_discounts);

    const shippingAmount = (raw.shipping_lines || []).reduce(
      (sum: Decimal, line: any) => sum.add(new Decimal(line.price)),
      new Decimal(0),
    );

    let status: 'pending' | 'completed' | 'cancelled' | 'refunded' = 'pending';
    if (raw.cancelled_at) status = 'cancelled';
    else if (raw.financial_status === 'refunded') status = 'refunded';
    else if (raw.financial_status === 'paid') status = 'completed';

    // Calculate Net Sales (Gross - Tax - Discount + Shipping ?? )
    // Usually: Gross (Total Price user pays) = ItemsTotal - Discount + Tax + Shipping
    // Net for Accounting usually means Excl. Tax.
    // UnifiedOrderTotals.net here is just a placeholder, usage depends on service logic.
    // We'll set it to Total Price for now.

    return {
      externalId: raw.id.toString(),
      orderDate: new Date(raw.created_at),
      status,
      customer: raw.customer
        ? {
            externalId: raw.customer.id.toString(),
            email: raw.customer.email || raw.email,
            name: `${raw.customer.first_name} ${raw.customer.last_name}`.trim(),
            phone: raw.customer.phone,
          }
        : undefined,
      items: (raw.line_items || []).map((item: any) => ({
        sku: item.sku || 'UNKNOWN',
        productName: item.title,
        quantity: item.quantity,
        unitPrice: new Decimal(item.price),
        discount: new Decimal(item.total_discount || 0),
        tax: new Decimal(0), // Shopify items don't easily expose tax per line without digging
        total: new Decimal(item.price)
          .mul(item.quantity)
          .sub(item.total_discount || 0),
      })),
      totals: {
        currency,
        gross: totalGross,
        tax: totalTax,
        discount: totalDiscount,
        shipping: shippingAmount,
        net: totalGross,
      },
      raw,
    };
  }

  private async mapToUnifiedTransaction(
    raw: any,
    order: UnifiedOrder,
  ): Promise<UnifiedTransaction> {
    const currency = raw.currency;
    const amount = new Decimal(raw.amount);
    const feeResolution = this.resolveTransactionFee(raw, amount);

    return {
      externalId: raw.id.toString(),
      orderId: order.externalId,
      date: new Date(raw.processed_at || raw.created_at),
      type: raw.kind === 'refund' ? 'refund' : 'sale',
      amount,
      fee: feeResolution.fee,
      net: amount.sub(feeResolution.fee),
      currency,
      status: raw.status === 'success' ? 'success' : 'failed',
      gateway: raw.gateway || undefined,
      feeStatus: feeResolution.status,
      feeSource: feeResolution.source,
      raw,
    };
  }

  private resolveTransactionFee(raw: any, amount: Decimal) {
    const gateway = String(raw.gateway || '').trim();
    const actualFee = this.extractActualFee(raw);

    if (actualFee) {
      return {
        fee: actualFee,
        status: 'actual' as UnifiedTransactionFeeStatus,
        source: 'shopify.transaction.fee',
      };
    }

    const gatewayRule = this.matchGatewayFeeRule(gateway);
    if (gatewayRule) {
      const estimatedFee = amount
        .mul(gatewayRule.rate)
        .add(gatewayRule.fixed)
        .toDecimalPlaces(2);
      return {
        fee: estimatedFee,
        status: 'estimated' as UnifiedTransactionFeeStatus,
        source: `gateway-rule:${gatewayRule.match}`,
      };
    }

    if (this.isNoFeeGateway(gateway, raw)) {
      return {
        fee: new Decimal(0),
        status: 'not_applicable' as UnifiedTransactionFeeStatus,
        source: gateway ? `gateway:${gateway}` : 'manual-gateway',
      };
    }

    return {
      fee: new Decimal(0),
      status: 'unavailable' as UnifiedTransactionFeeStatus,
      source: gateway ? `gateway:${gateway}` : 'unknown-gateway',
    };
  }

  private extractActualFee(raw: any) {
    const receipt = raw?.receipt || {};
    const directCandidates = [
      raw?.fee,
      raw?.fees,
      receipt?.fee,
      receipt?.payment_fee,
      receipt?.processor_fee,
      receipt?.handling_fee,
    ];

    for (const candidate of directCandidates) {
      if (candidate === null || candidate === undefined || candidate === '') {
        continue;
      }

      try {
        return new Decimal(candidate);
      } catch {
        continue;
      }
    }

    return null;
  }

  private isNoFeeGateway(gateway: string, raw: any) {
    const normalizedGateway = gateway.toLowerCase();
    const sourceName = String(raw?.source_name || '').toLowerCase();
    const noFeeKeywords = [
      'cash on delivery',
      'cod',
      'bank transfer',
      'manual',
      '貨到付款',
      '超商貨到付款',
      '銀行轉帳',
      'atm',
    ];

    return noFeeKeywords.some(
      (keyword) =>
        normalizedGateway.includes(keyword) || sourceName.includes(keyword),
    );
  }

  private matchGatewayFeeRule(gateway: string) {
    if (!gateway) {
      return null;
    }

    const exactMatch = this.gatewayFeeRules.find(
      (rule) => rule.match === gateway,
    );
    if (exactMatch) {
      return exactMatch;
    }

    return this.gatewayFeeRules.find((rule) => gateway.includes(rule.match));
  }

  private parseGatewayFeeRules(rawRules: string): GatewayFeeRule[] {
    if (!rawRules.trim()) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawRules) as Record<
        string,
        number | { rate?: number; fixed?: number }
      >;

      return Object.entries(parsed)
        .map(([match, config]) => {
          if (typeof config === 'number') {
            return { match, rate: config, fixed: 0 };
          }

          return {
            match,
            rate: Number(config?.rate || 0),
            fixed: Number(config?.fixed || 0),
          };
        })
        .filter(
          (rule) =>
            rule.match &&
            Number.isFinite(rule.rate) &&
            Number.isFinite(rule.fixed),
        );
    } catch (error: any) {
      this.logger.warn(
        `Invalid SHOPIFY_GATEWAY_FEE_RULES config: ${error.message}`,
      );
      return [];
    }
  }

  private async getFxRate(currency: string, date: Date): Promise<number> {
    if (currency === 'TWD') return 1;
    if (currency === 'USD') return 32.5;
    if (currency === 'CNY') return 4.5;
    if (currency === 'JPY') return 0.21;
    return 1;
  }

  private async request(
    method: string,
    path: string,
    body?: any,
  ): Promise<{ body: any; headers: Headers }> {
    const url = path.startsWith('https://') ? path : `${this.baseUrl}${path}`;
    const accessToken = await this.getAccessToken();
    const options: RequestInit = {
      method,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    };

    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      // Handle HTML error pages (e.g. 404) gracefully if possible, or just throw
      throw new Error(`Shopify API Error ${res.status}: ${text}`);
    }
    return { body: await res.json(), headers: res.headers };
  }

  private assertConfig() {
    if (!this.shopDomain) {
      throw new Error('Shopify configuration missing: SHOPIFY_SHOP');
    }

    if (!this.token && !(this.clientId && this.clientSecret)) {
      throw new Error(
        'Shopify configuration missing: provide SHOPIFY_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET',
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    this.assertConfig();

    if (this.token) {
      return this.token;
    }

    const now = Date.now();
    if (
      this.accessTokenCache &&
      this.accessTokenCache.expiresAt - 60_000 > now
    ) {
      return this.accessTokenCache.token;
    }

    if (!this.accessTokenPromise) {
      this.accessTokenPromise =
        this.fetchAccessTokenWithClientCredentials().finally(() => {
          this.accessTokenPromise = null;
        });
    }

    return this.accessTokenPromise;
  }

  private async fetchAccessTokenWithClientCredentials(): Promise<string> {
    const domain = this.shopDomain
      .replace(/^https?:\/\//, '')
      .replace(/\.myshopify\.com$/, '');

    const response = await fetch(
      `https://${domain}.myshopify.com/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Shopify token request failed ${response.status}: ${text}`,
      );
    }

    const data = await response.json();
    const expiresIn = Number(data.expires_in || 0);
    const accessToken = data.access_token;

    if (!accessToken) {
      throw new Error(
        'Shopify token request succeeded but no access_token was returned',
      );
    }

    this.accessTokenCache = {
      token: accessToken,
      expiresAt: Date.now() + Math.max(expiresIn, 300) * 1000,
    };

    return accessToken;
  }
}
