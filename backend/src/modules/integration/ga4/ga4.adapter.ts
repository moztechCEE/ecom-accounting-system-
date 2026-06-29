import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type Ga4PropertyConfig = {
  propertyId: string;
  name?: string;
  brand?: string;
  reportBrand?: string;
  platform?: string;
  market?: string;
  businessUnit?: string;
  channelCode?: string;
  entityId?: string;
  refreshTokenEnv?: string;
  clientIdEnv?: string;
  clientSecretEnv?: string;
};

export type Ga4MetricSummary = {
  sessions: number;
  totalUsers: number;
  activeUsers: number;
  screenPageViews: number;
  eventCount: number;
  purchaseRevenue: number;
};

type Ga4RunReportResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  rowCount?: number;
  error?: {
    message?: string;
    status?: string;
    details?: unknown[];
  };
};

@Injectable()
export class Ga4Adapter {
  private readonly dataApiBaseUrl: string;
  private readonly adminApiBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.dataApiBaseUrl =
      this.config.get<string>('GA4_DATA_API_BASE_URL', '') ||
      'https://analyticsdata.googleapis.com';
    this.adminApiBaseUrl =
      this.config.get<string>('GA4_ADMIN_API_BASE_URL', '') ||
      'https://analyticsadmin.googleapis.com';
    this.timeoutMs = Math.min(
      Math.max(Number(this.config.get<string>('GA4_TIMEOUT_MS', '30000')), 5000),
      120000,
    );
  }

  getConnectionInfo() {
    const properties = this.getConfiguredProperties();
    return {
      dataApiBaseUrl: this.dataApiBaseUrl,
      adminApiBaseUrl: this.adminApiBaseUrl,
      configuredPropertyCount: properties.length,
      configuredProperties: properties.map((property) => ({
        propertyId: property.propertyId,
        name: property.name || null,
        brand: property.brand || null,
        reportBrand: property.reportBrand || null,
        platform: property.platform || 'GA4',
        market: property.market || null,
        businessUnit: property.businessUnit || null,
        channelCode: property.channelCode || null,
        entityId: property.entityId || null,
        refreshTokenEnv: property.refreshTokenEnv || null,
      })),
      oauthClientConfigured: Boolean(this.getClientId() && this.getClientSecret()),
      defaultRefreshTokenConfigured: Boolean(
        this.config.get<string>('GA4_REFRESH_TOKEN', ''),
      ),
      metadataTokenSupported: true,
      requiredScope: 'https://www.googleapis.com/auth/analytics.readonly',
    };
  }

  getConfiguredProperties(): Ga4PropertyConfig[] {
    const json = (this.config.get<string>('GA4_PROPERTIES_JSON', '') || '').trim();
    if (json) {
      try {
        const parsed = JSON.parse(json);
        const items = Array.isArray(parsed) ? parsed : parsed.properties;
        if (Array.isArray(items)) {
          return items
            .map((item) => this.normalizePropertyConfig(item))
            .filter((item): item is Ga4PropertyConfig => Boolean(item));
        }
      } catch {
        throw new BadRequestException('GA4_PROPERTIES_JSON is not valid JSON');
      }
    }

    return (
      this.config.get<string>('GA4_PROPERTY_IDS', '') ||
      this.config.get<string>('GA4_PROPERTY_ID', '') ||
      ''
    )
      .split(',')
      .map((propertyId) => propertyId.trim())
      .filter(Boolean)
      .map((propertyId) => ({ propertyId: this.normalizePropertyId(propertyId) }))
      .filter((property) => Boolean(property.propertyId));
  }

  async runReport(params: {
    property: Ga4PropertyConfig;
    since: Date;
    until: Date;
    dimensions?: string[];
    metrics?: string[];
    limit?: string | number;
  }) {
    const metrics = params.metrics?.length
      ? params.metrics
      : [
          'sessions',
          'totalUsers',
          'activeUsers',
          'screenPageViews',
          'eventCount',
          'purchaseRevenue',
        ];
    const access = await this.fetchAccessToken(params.property);
    const url = `${this.dataApiBaseUrl.replace(/\/$/, '')}/v1beta/properties/${params.property.propertyId}:runReport`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          dateRanges: [
            {
              startDate: this.formatDate(params.since),
              endDate: this.formatDate(params.until),
            },
          ],
          ...(params.dimensions?.length
            ? { dimensions: params.dimensions.map((name) => ({ name })) }
            : {}),
          metrics: metrics.map((name) => ({ name })),
          limit: String(Math.min(Math.max(Number(params.limit || 100), 1), 10000)),
        }),
      });
      const parsed = (await response.json().catch(() => ({}))) as
        | Ga4RunReportResponse
        | Record<string, unknown>;
      if (!response.ok || (parsed as Ga4RunReportResponse).error) {
        const error = (parsed as Ga4RunReportResponse).error;
        throw new BadGatewayException(
          `GA4 Data API runReport failed for property ${params.property.propertyId}: ${this.formatApiError(error, response.statusText)}`,
        );
      }

      return {
        property: params.property,
        authMode: access.authMode,
        metrics,
        response: parsed as Ga4RunReportResponse,
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new BadGatewayException(
          `GA4 Data API runReport timed out for property ${params.property.propertyId}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchAccountSummaries() {
    const properties = this.getConfiguredProperties();
    const access = await this.fetchAccessToken(properties[0]);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        `${this.adminApiBaseUrl.replace(/\/$/, '')}/v1beta/accountSummaries`,
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${access.accessToken}`,
            Accept: 'application/json',
          },
        },
      );
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok || parsed?.error) {
        throw new BadGatewayException(
          `GA4 Admin API accountSummaries failed: ${this.formatApiError(parsed?.error, response.statusText)}`,
        );
      }
      return {
        authMode: access.authMode,
        accountSummaries: Array.isArray(parsed.accountSummaries)
          ? parsed.accountSummaries
          : [],
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new BadGatewayException('GA4 Admin API accountSummaries timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  summarizeMetricRow(
    report: Awaited<ReturnType<Ga4Adapter['runReport']>>,
  ): Ga4MetricSummary {
    const values = report.response.rows?.[0]?.metricValues || [];
    const byName = new Map(
      report.metrics.map((name, index) => [
        name,
        this.toNumber(values[index]?.value),
      ]),
    );
    return {
      sessions: byName.get('sessions') || 0,
      totalUsers: byName.get('totalUsers') || 0,
      activeUsers: byName.get('activeUsers') || 0,
      screenPageViews: byName.get('screenPageViews') || 0,
      eventCount: byName.get('eventCount') || 0,
      purchaseRevenue: byName.get('purchaseRevenue') || 0,
    };
  }

  private async fetchAccessToken(property?: Ga4PropertyConfig) {
    const authMode = (
      this.config.get<string>('GA4_AUTH_MODE', '') || 'auto'
    )
      .trim()
      .toLowerCase();
    if (
      ['metadata', 'service_account', 'service-account', 'service_account_metadata'].includes(
        authMode,
      )
    ) {
      return this.fetchMetadataAccessToken();
    }

    const oauth = await this.fetchOAuthAccessToken(property);
    if (oauth) {
      return oauth;
    }
    return this.fetchMetadataAccessToken();
  }

  private async fetchOAuthAccessToken(property?: Ga4PropertyConfig) {
    const clientId = this.getClientId(property);
    const clientSecret = this.getClientSecret(property);
    const refreshToken = this.getRefreshToken(property);
    if (!clientId || !clientSecret || !refreshToken) {
      return null;
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
        `GA4 OAuth refresh failed for property ${property?.propertyId || 'default'}: ${body.error_description || body.error || response.statusText}`,
      );
    }
    return { accessToken: body.access_token, authMode: 'oauth' as const };
  }

  private async fetchMetadataAccessToken() {
    const response = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fanalytics.readonly',
      {
        method: 'GET',
        headers: { 'Metadata-Flavor': 'Google' },
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new UnauthorizedException(
        `GA4 metadata token failed: ${body.error_description || body.error || response.statusText}`,
      );
    }
    return { accessToken: body.access_token, authMode: 'metadata' as const };
  }

  private getClientId(property?: Ga4PropertyConfig) {
    return (
      this.config.get<string>(property?.clientIdEnv || '', '') ||
      this.config.get<string>('GA4_CLIENT_ID', '') ||
      this.config.get<string>('GOOGLE_ADS_CLIENT_ID', '') ||
      ''
    ).trim();
  }

  private getClientSecret(property?: Ga4PropertyConfig) {
    return (
      this.config.get<string>(property?.clientSecretEnv || '', '') ||
      this.config.get<string>('GA4_CLIENT_SECRET', '') ||
      this.config.get<string>('GOOGLE_ADS_CLIENT_SECRET', '') ||
      ''
    ).trim();
  }

  private getRefreshToken(property?: Ga4PropertyConfig) {
    const propertyToken =
      property?.refreshTokenEnv &&
      this.config.get<string>(property.refreshTokenEnv, '');
    if (propertyToken) {
      return propertyToken.trim();
    }
    return (
      this.config.get<string>('GA4_REFRESH_TOKEN', '') ||
      (property?.brand === 'BONSON'
        ? this.config.get<string>('GA4_BONSON_REFRESH_TOKEN', '')
        : this.config.get<string>('GA4_MOZTECH_REFRESH_TOKEN', '')) ||
      ''
    ).trim();
  }

  private normalizePropertyConfig(input: unknown): Ga4PropertyConfig | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const item = input as Record<string, unknown>;
    const propertyId = this.normalizePropertyId(
      String(item.propertyId || item.property_id || item.id || ''),
    );
    if (!propertyId) {
      return null;
    }
    return {
      propertyId,
      name: this.optionalString(item.name),
      brand: this.optionalString(item.brand),
      reportBrand: this.optionalString(
        item.reportBrand || item.report_brand || item.reportingBrand,
      ),
      platform: this.optionalString(item.platform) || 'GA4',
      market: this.optionalString(item.market || item.country),
      businessUnit: this.optionalString(
        item.businessUnit || item.business_unit,
      ),
      channelCode: this.optionalString(item.channelCode || item.channel_code),
      entityId: this.optionalString(item.entityId || item.entity_id),
      refreshTokenEnv: this.optionalString(
        item.refreshTokenEnv || item.refresh_token_env,
      ),
      clientIdEnv: this.optionalString(item.clientIdEnv || item.client_id_env),
      clientSecretEnv: this.optionalString(
        item.clientSecretEnv || item.client_secret_env,
      ),
    };
  }

  private normalizePropertyId(value: string) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private toNumber(value: unknown) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  private formatApiError(
    error: Ga4RunReportResponse['error'] | undefined,
    fallback: string,
  ) {
    return [error?.message || fallback, error?.status].filter(Boolean).join('; ');
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }
}
