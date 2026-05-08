import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type MetaAdsAccountConfig = {
  accountId: string;
  name?: string;
  brand?: string;
  platform?: string;
  currency?: string;
  entityId?: string;
};

export type MetaAdsAdAccount = {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  account_status?: number;
  business?: {
    id?: string;
    name?: string;
  };
};

export type MetaAdsInsight = {
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  date_start?: string;
  date_stop?: string;
  purchase_roas?: unknown;
  actions?: unknown;
  rawAccount?: MetaAdsAccountConfig | null;
};

type MetaListResponse<T> = {
  data?: T[];
  paging?: {
    cursors?: {
      after?: string;
    };
    next?: string;
  };
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

@Injectable()
export class MetaAdsAdapter {
  private readonly graphBaseUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.graphBaseUrl =
      this.config.get<string>('META_ADS_GRAPH_BASE_URL', '') ||
      'https://graph.facebook.com';
    this.apiVersion =
      this.config.get<string>('META_ADS_API_VERSION', '') || 'v23.0';
    this.timeoutMs = Math.min(
      Math.max(
        Number(this.config.get<string>('META_ADS_TIMEOUT_MS', '30000')),
        5000,
      ),
      120000,
    );
  }

  getConnectionInfo() {
    return {
      apiBaseUrl: this.graphBaseUrl,
      apiVersion: this.apiVersion,
      tokenConfigured: Boolean(this.getToken()),
      configuredAccounts: this.getConfiguredAccounts().map((account) => ({
        accountId: this.normalizeAccountId(account.accountId),
        name: account.name || null,
        brand: account.brand || null,
        platform: account.platform || null,
        currency: account.currency || null,
        entityId: account.entityId || null,
      })),
      requiredPermission: 'ads_read',
      recommendedCredential: 'Meta Business Manager System User access token',
      supports: ['adaccounts', 'insights.spend', 'daily expense sync'],
    };
  }

  getConfiguredAccounts(): MetaAdsAccountConfig[] {
    const json = (
      this.config.get<string>('META_ADS_ACCOUNTS_JSON', '') || ''
    ).trim();
    if (json) {
      try {
        const parsed = JSON.parse(json);
        const items = Array.isArray(parsed) ? parsed : parsed.accounts;
        if (Array.isArray(items)) {
          return items
            .map((item) => this.normalizeAccountConfig(item))
            .filter((item): item is MetaAdsAccountConfig => Boolean(item));
        }
      } catch {
        throw new BadRequestException(
          'META_ADS_ACCOUNTS_JSON is not valid JSON',
        );
      }
    }

    return (this.config.get<string>('META_ADS_ACCOUNT_IDS', '') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((accountId) => ({
        accountId: this.normalizeAccountId(accountId),
      }));
  }

  async fetchAdAccounts(params: { limit?: string | number } = {}) {
    this.assertTokenConfigured();

    const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
    const response = await this.request<MetaListResponse<MetaAdsAdAccount>>(
      '/me/adaccounts',
      {
        fields: 'id,account_id,name,currency,account_status,business{id,name}',
        limit: String(limit),
      },
    );

    return Array.isArray(response.data) ? response.data : [];
  }

  async fetchInsights(params: {
    since: Date;
    until: Date;
    accountIds?: string[];
    level?: 'account' | 'campaign';
    limit?: string | number;
    maxPages?: string | number;
  }) {
    this.assertTokenConfigured();

    const accounts = await this.resolveAccounts(params.accountIds);
    const limit = Math.min(Math.max(Number(params.limit || 250), 1), 500);
    const maxPages = Math.min(Math.max(Number(params.maxPages || 20), 1), 100);
    const level = params.level || 'account';
    const fields = [
      'account_id',
      'account_name',
      level === 'campaign' ? 'campaign_id' : null,
      level === 'campaign' ? 'campaign_name' : null,
      'spend',
      'impressions',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'purchase_roas',
      'actions',
      'date_start',
      'date_stop',
    ]
      .filter(Boolean)
      .join(',');
    const range = {
      since: this.formatDate(params.since),
      until: this.formatDate(params.until),
    };
    const rows: MetaAdsInsight[] = [];

    for (const account of accounts) {
      let after = '';
      let page = 0;
      do {
        const response = await this.request<MetaListResponse<MetaAdsInsight>>(
          `/${this.normalizeAccountId(account.accountId)}/insights`,
          {
            fields,
            level,
            time_increment: '1',
            time_range: JSON.stringify(range),
            limit: String(limit),
            ...(after ? { after } : {}),
          },
        );
        const pageRows = Array.isArray(response.data) ? response.data : [];
        rows.push(
          ...pageRows.map((row) => ({
            ...row,
            rawAccount: account,
          })),
        );
        page += 1;
        after = response.paging?.cursors?.after || '';
      } while (after && page < maxPages);
    }

    return rows;
  }

  normalizeAccountId(value: string) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return trimmed;
    }
    return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
  }

  private async resolveAccounts(accountIds?: string[]) {
    const requested = (accountIds || [])
      .map((value) => value.trim())
      .filter(Boolean)
      .map((accountId) => ({ accountId: this.normalizeAccountId(accountId) }));
    if (requested.length) {
      return requested;
    }

    const configured = this.getConfiguredAccounts();
    if (configured.length) {
      return configured.map((item) => ({
        ...item,
        accountId: this.normalizeAccountId(item.accountId),
      }));
    }

    const apiAccounts = await this.fetchAdAccounts();
    const accounts = apiAccounts
      .map((account) => account.id || account.account_id || '')
      .filter(Boolean)
      .map((accountId) => ({ accountId: this.normalizeAccountId(accountId) }));

    if (!accounts.length) {
      throw new BadRequestException(
        'Meta token is valid, but no readable ad accounts were returned. Configure META_ADS_ACCOUNT_IDS or grant ads_read to the ad account.',
      );
    }

    return accounts;
  }

  private async request<T>(path: string, params: Record<string, string>) {
    const token = this.assertTokenConfigured();
    const url = new URL(
      `${this.graphBaseUrl.replace(/\/$/, '')}/${this.apiVersion}${path}`,
    );
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('access_token', token);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
      const body = (await response.json().catch(() => ({}))) as
        | T
        | MetaListResponse<unknown>;
      if (!response.ok || (body as MetaListResponse<unknown>).error) {
        const error = (body as MetaListResponse<unknown>).error;
        throw new BadGatewayException(
          `Meta Ads API request failed: ${error?.message || response.statusText}`,
        );
      }
      return body as T;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new BadGatewayException('Meta Ads API request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getToken() {
    return (this.config.get<string>('META_ADS_ACCESS_TOKEN', '') || '').trim();
  }

  private assertTokenConfigured() {
    const token = this.getToken();
    if (!token) {
      throw new UnauthorizedException(
        'META_ADS_ACCESS_TOKEN is not configured',
      );
    }
    return token;
  }

  private normalizeAccountConfig(input: unknown): MetaAdsAccountConfig | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const item = input as Record<string, unknown>;
    const accountId = String(
      item.accountId || item.account_id || item.id || '',
    ).trim();
    if (!accountId) {
      return null;
    }
    return {
      accountId: this.normalizeAccountId(accountId),
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
