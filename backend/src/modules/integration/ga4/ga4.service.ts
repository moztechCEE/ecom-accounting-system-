import { BadRequestException, Injectable } from '@nestjs/common';
import { Ga4Adapter } from './ga4.adapter';

@Injectable()
export class Ga4Service {
  constructor(private readonly adapter: Ga4Adapter) {}

  getConnectionInfo() {
    return this.adapter.getConnectionInfo();
  }

  async getReadiness(params: { since?: Date; until?: Date } = {}) {
    const info = this.adapter.getConnectionInfo();
    const missing: string[] = [];
    if (!info.configuredPropertyCount) {
      missing.push('GA4_PROPERTIES_JSON or GA4_PROPERTY_IDS');
    }

    const { since, until } = this.resolveRange(params.since, params.until);
    const probes = [];
    for (const property of this.adapter.getConfiguredProperties()) {
      try {
        const report = await this.adapter.runReport({ property, since, until });
        probes.push({
          propertyId: property.propertyId,
          name: property.name || null,
          brand: property.brand || null,
          reportBrand: property.reportBrand || null,
          success: true,
          authMode: report.authMode,
          rowCount: report.response.rowCount || report.response.rows?.length || 0,
          metrics: this.adapter.summarizeMetricRow(report),
        });
      } catch (error: any) {
        probes.push({
          propertyId: property.propertyId,
          name: property.name || null,
          brand: property.brand || null,
          reportBrand: property.reportBrand || null,
          success: false,
          message: error?.message || 'GA4 runReport probe failed',
        });
      }
    }

    return {
      ready: missing.length === 0 && probes.every((probe) => probe.success),
      missing,
      range: {
        since: since.toISOString(),
        until: until.toISOString(),
      },
      configuredPropertyCount: info.configuredPropertyCount,
      configuredProperties: info.configuredProperties,
      oauthClientConfigured: info.oauthClientConfigured,
      defaultRefreshTokenConfigured: info.defaultRefreshTokenConfigured,
      metadataTokenSupported: info.metadataTokenSupported,
      probes,
      nextAction:
        missing.length === 0
          ? 'GA4 runReport 可讀後即可併入每日廣告分析。'
          : '請設定 GA4_PROPERTIES_JSON，並確認 OAuth refresh token 或 Cloud Run runtime service account 具備 GA4 Viewer 以上權限。',
    };
  }

  async report(params: {
    since?: Date;
    until?: Date;
    propertyIds?: string[];
    dimensions?: string[];
    metrics?: string[];
    limit?: string | number;
  }) {
    const { since, until } = this.resolveRange(params.since, params.until);
    const requested = new Set((params.propertyIds || []).filter(Boolean));
    const properties = this.adapter
      .getConfiguredProperties()
      .filter(
        (property) => requested.size === 0 || requested.has(property.propertyId),
      );
    if (!properties.length) {
      throw new BadRequestException('No configured GA4 property matched request');
    }

    const reports = [];
    for (const property of properties) {
      const report = await this.adapter.runReport({
        property,
        since,
        until,
        dimensions: params.dimensions,
        metrics: params.metrics,
        limit: params.limit,
      });
      reports.push({
        propertyId: property.propertyId,
        name: property.name || null,
        brand: property.brand || null,
        reportBrand: property.reportBrand || null,
        authMode: report.authMode,
        rowCount: report.response.rowCount || report.response.rows?.length || 0,
        metrics: this.adapter.summarizeMetricRow(report),
        rows: report.response.rows || [],
      });
    }

    return {
      success: true,
      range: {
        since: since.toISOString(),
        until: until.toISOString(),
      },
      reports,
    };
  }

  async accountSummaries() {
    return this.adapter.fetchAccountSummaries();
  }

  private resolveRange(since?: Date, until?: Date) {
    const end = until && !Number.isNaN(until.getTime()) ? until : new Date();
    const start =
      since && !Number.isNaN(since.getTime())
        ? since
        : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    if (start > end) {
      throw new BadRequestException('since must be before until');
    }
    return { since: start, until: end };
  }
}
