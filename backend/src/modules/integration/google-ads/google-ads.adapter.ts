import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type GoogleAdsAccountConfig = {
  customerId: string;
  name?: string;
  brand?: string;
  platform?: string;
  currency?: string;
  entityId?: string;
};

export type GoogleAdsInsight = {
  customerId: string;
  customerName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  date: string;
  costMicros: string | number;
  impressions?: string | number | null;
  clicks?: string | number | null;
  conversions?: string | number | null;
  rawAccount?: GoogleAdsAccountConfig | null;
};

type GoogleAdsSearchResponse = {
  results?: Array<{
    customer?: {
      id?: string;
      descriptiveName?: string;
    };
    campaign?: {
      id?: string;
      name?: string;
    };
    segments?: {
      date?: string;
    };
    metrics?: {
      costMicros?: string | number;
      impressions?: string | number;
      clicks?: string | number;
      conversions?: string | number;
    };
  }>;
  nextPageToken?: string;
  error?: {
    message?: string;
    status?: string;
    details?: unknown[];
  };
};

type GoogleAdsApiError = {
  message?: string;
  status?: string;
  details?: Array<{
    errors?: Array<{
      errorCode?: Record<string, string>;
      message?: string;
    }>;
    requestId?: string;
  }>;
};

@Injectable()
export class GoogleAdsAdapter {
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiBaseUrl =
      this.config.get<string>('GOOGLE_ADS_API_BASE_URL', '') ||
      'https://googleads.googleapis.com';
    this.apiVersion =
      this.config.get<string>('GOOGLE_ADS_API_VERSION', '') || 'v21';
    this.timeoutMs = Math.min(
      Math.max(
        Number(this.config.get<string>('GOOGLE_ADS_TIMEOUT_MS', '30000')),
        5000,
      ),
      120000,
    );
  }

  getConnectionInfo() {
    return {
      apiBaseUrl: this.apiBaseUrl,
      apiVersion: this.apiVersion,
      developerTokenConfigured: Boolean(this.getDeveloperToken()),
      oauthConfigured: Boolean(
        this.getClientId() && this.getClientSecret() && this.getRefreshToken(),
      ),
      configuredAccounts: this.getConfiguredAccounts().map((account) => ({
        customerId: this.normalizeCustomerId(account.customerId),
        name: account.name || null,
        brand: account.brand || null,
        platform: account.platform || null,
        currency: account.currency || null,
        entityId: account.entityId || null,
      })),
      loginCustomerId: this.normalizeCustomerId(
        this.config.get<string>('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '') || '',
      ),
      requiredAccess: [
        'Google Ads API developer token',
        'OAuth refresh token with Google Ads scope',
        'Google Ads customer ID',
      ],
      supports: ['daily spend', 'campaign spend', 'daily expense sync'],
    };
  }

  getConfiguredAccounts(): GoogleAdsAccountConfig[] {
    const json = (
      this.config.get<string>('GOOGLE_ADS_ACCOUNTS_JSON', '') || ''
    ).trim();
    if (json) {
      try {
        const parsed = JSON.parse(json);
        const items = Array.isArray(parsed) ? parsed : parsed.accounts;
        if (Array.isArray(items)) {
          return items
            .map((item) => this.normalizeAccountConfig(item))
            .filter((item): item is GoogleAdsAccountConfig => Boolean(item));
        }
      } catch {
        throw new BadRequestException(
          'GOOGLE_ADS_ACCOUNTS_JSON is not valid JSON',
        );
      }
    }

    return (
      this.config.get<string>('GOOGLE_ADS_CUSTOMER_IDS', '') ||
      this.config.get<string>('GOOGLE_ADS_CUSTOMER_ID', '') ||
      ''
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((customerId) => ({
        customerId: this.normalizeCustomerId(customerId),
      }));
  }

  async fetchInsights(params: {
    since: Date;
    until: Date;
    customerIds?: string[];
    level?: 'account' | 'campaign';
    pageSize?: string | number;
    maxPages?: string | number;
  }) {
    const accounts = this.resolveAccounts(params.customerIds);
    const rows: GoogleAdsInsight[] = [];
    const level = params.level || 'account';
    const pageSize = Math.min(Math.max(Number(params.pageSize || 1000), 1), 10000);
    const maxPages = Math.min(Math.max(Number(params.maxPages || 20), 1), 100);

    for (const account of accounts) {
      let pageToken = '';
      let page = 0;
      do {
        const response = await this.search(account.customerId, {
          query: this.buildSpendQuery(params.since, params.until, level),
          pageSize,
          pageToken,
        });
        const pageRows = Array.isArray(response.results) ? response.results : [];
        rows.push(
          ...pageRows.map((row) => ({
            customerId: this.normalizeCustomerId(
              row.customer?.id || account.customerId,
            ),
            customerName: row.customer?.descriptiveName || account.name || null,
            campaignId: row.campaign?.id || null,
            campaignName: row.campaign?.name || null,
            date: row.segments?.date || this.formatDate(params.since),
            costMicros: row.metrics?.costMicros || 0,
            impressions: row.metrics?.impressions || 0,
            clicks: row.metrics?.clicks || 0,
            conversions: row.metrics?.conversions || 0,
            rawAccount: account,
          })),
        );
        page += 1;
        pageToken = response.nextPageToken || '';
      } while (pageToken && page < maxPages);
    }

    return rows;
  }

  async listAccessibleCustomers() {
    const accessToken = await this.fetchAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        `${this.apiBaseUrl.replace(/\/$/, '')}/${this.apiVersion}/customers:listAccessibleCustomers`,
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': this.assertDeveloperToken(),
            Accept: 'application/json',
          },
        },
      );
      const parsed = (await response.json().catch(() => ({}))) as
        | { resourceNames?: string[]; error?: GoogleAdsApiError }
        | Record<string, unknown>;
      if (!response.ok || parsed.error) {
        throw new BadGatewayException(
          `Google Ads accessible customers request failed: ${this.formatApiError(parsed.error, response.statusText)}`,
        );
      }
      const resourceNames = Array.isArray(parsed.resourceNames)
        ? parsed.resourceNames
        : [];
      return resourceNames
        .map((resourceName) => this.normalizeCustomerId(resourceName))
        .filter(Boolean);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new BadGatewayException(
          'Google Ads accessible customers request timed out',
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  normalizeCustomerId(value: string) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  private resolveAccounts(customerIds?: string[]): GoogleAdsAccountConfig[] {
    const requested = (customerIds || [])
      .map((value) => this.normalizeCustomerId(value))
      .filter(Boolean)
      .map((customerId) => ({ customerId }));
    if (requested.length) {
      return requested;
    }

    const configured = this.getConfiguredAccounts();
    if (!configured.length) {
      throw new BadRequestException(
        'GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_ACCOUNTS_JSON is required',
      );
    }
    return configured.map((account) => ({
      ...account,
      customerId: this.normalizeCustomerId(account.customerId),
    }));
  }

  private async search(
    customerId: string,
    body: { query: string; pageSize: number; pageToken?: string },
  ) {
    const accessToken = await this.fetchAccessToken();
    const url = `${this.apiBaseUrl.replace(/\/$/, '')}/${this.apiVersion}/customers/${this.normalizeCustomerId(customerId)}/googleAds:search`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': this.assertDeveloperToken(),
          ...(this.getLoginCustomerId()
            ? { 'login-customer-id': this.getLoginCustomerId() }
            : {}),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query: body.query,
          pageSize: body.pageSize,
          ...(body.pageToken ? { pageToken: body.pageToken } : {}),
        }),
      });
      const parsed = (await response.json().catch(() => ({}))) as
        | GoogleAdsSearchResponse
        | Record<string, unknown>;
      if (!response.ok || (parsed as GoogleAdsSearchResponse).error) {
        const error = (parsed as GoogleAdsSearchResponse).error;
        throw new BadGatewayException(
          `Google Ads API request failed: ${this.formatApiError(error, response.statusText)}`,
        );
      }
      return parsed as GoogleAdsSearchResponse;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new BadGatewayException('Google Ads API request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchAccessToken() {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    const refreshToken = this.getRefreshToken();
    if (!clientId || !clientSecret || !refreshToken) {
      throw new UnauthorizedException(
        'GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_REFRESH_TOKEN are required',
      );
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new UnauthorizedException(
        `Google OAuth refresh failed: ${body.error_description || body.error || response.statusText}`,
      );
    }
    return body.access_token;
  }

  private buildSpendQuery(
    since: Date,
    until: Date,
    level: 'account' | 'campaign',
  ) {
    const fields = [
      'customer.id',
      'customer.descriptive_name',
      level === 'campaign' ? 'campaign.id' : null,
      level === 'campaign' ? 'campaign.name' : null,
      'segments.date',
      'metrics.cost_micros',
      'metrics.impressions',
      'metrics.clicks',
      'metrics.conversions',
    ]
      .filter(Boolean)
      .join(', ');
    const where = [
      `segments.date BETWEEN '${this.formatDate(since)}' AND '${this.formatDate(until)}'`,
      'metrics.cost_micros > 0',
    ].join(' AND ');
    const resource = level === 'campaign' ? 'campaign' : 'customer';
    return `SELECT ${fields} FROM ${resource} WHERE ${where} ORDER BY segments.date ASC`;
  }

  private assertDeveloperToken() {
    const token = this.getDeveloperToken();
    if (!token) {
      throw new UnauthorizedException(
        'GOOGLE_ADS_DEVELOPER_TOKEN is not configured',
      );
    }
    return token;
  }

  private getDeveloperToken() {
    return (
      this.config.get<string>('GOOGLE_ADS_DEVELOPER_TOKEN', '') || ''
    ).trim();
  }

  private getClientId() {
    return (this.config.get<string>('GOOGLE_ADS_CLIENT_ID', '') || '').trim();
  }

  private getClientSecret() {
    return (
      this.config.get<string>('GOOGLE_ADS_CLIENT_SECRET', '') || ''
    ).trim();
  }

  private getRefreshToken() {
    return (
      this.config.get<string>('GOOGLE_ADS_REFRESH_TOKEN', '') || ''
    ).trim();
  }

  private getLoginCustomerId() {
    return this.normalizeCustomerId(
      this.config.get<string>('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '') || '',
    );
  }

  private formatApiError(error: GoogleAdsApiError | undefined, fallback: string) {
    const details = error?.details
      ?.flatMap((detail) => detail.errors || [])
      .map((item) => {
        const code = item.errorCode
          ? Object.values(item.errorCode).filter(Boolean).join('/')
          : '';
        return [code, item.message].filter(Boolean).join(': ');
      })
      .filter(Boolean);
    return [
      error?.message || fallback,
      error?.status ? `status=${error.status}` : null,
      details?.length ? `details=${details.join(' | ')}` : null,
    ]
      .filter(Boolean)
      .join('; ');
  }

  private normalizeAccountConfig(input: unknown): GoogleAdsAccountConfig | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const item = input as Record<string, unknown>;
    const customerId = this.normalizeCustomerId(
      String(item.customerId || item.customer_id || item.id || ''),
    );
    if (!customerId) {
      return null;
    }
    return {
      customerId,
      name: this.optionalString(item.name),
      brand: this.optionalString(item.brand),
      platform: this.optionalString(item.platform),
      currency: this.optionalString(item.currency),
      entityId: this.optionalString(item.entityId || item.entity_id),
    };
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }
}
