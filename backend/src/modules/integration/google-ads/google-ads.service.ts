import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GoogleAdsAdapter, GoogleAdsInsight } from './google-ads.adapter';

const GOOGLE_ADS_SOURCE_MODULE = 'google_ads';
const DEFAULT_ENTITY_ID = 'tw-entity-001';
const AD_EXPENSE_ACCOUNT_CODE = '6118';

@Injectable()
export class GoogleAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: GoogleAdsAdapter,
    private readonly config: ConfigService,
  ) {}

  getConnectionInfo() {
    return this.adapter.getConnectionInfo();
  }

  async getReadiness() {
    const info = this.adapter.getConnectionInfo();
    const missing: string[] = [];
    if (!info.developerTokenConfigured) {
      missing.push('GOOGLE_ADS_DEVELOPER_TOKEN');
    }
    if (!info.oauthConfigured) {
      missing.push(
        'GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN',
      );
    }
    if (!info.configuredAccounts.length) {
      missing.push('GOOGLE_ADS_CUSTOMER_ID or GOOGLE_ADS_ACCOUNTS_JSON');
    }

    let insightProbe: {
      success: boolean;
      count: number;
      spendTotal: number;
      message?: string;
    } | null = null;
    if (!missing.length) {
      try {
        const { since, until } = this.resolveRange(undefined, undefined);
        const rows = await this.adapter.fetchInsights({ since, until });
        insightProbe = {
          success: true,
          count: rows.length,
          spendTotal: rows.reduce(
            (sum, row) => sum + this.costMicrosToAmount(row.costMicros),
            0,
          ),
        };
      } catch (error: any) {
        insightProbe = {
          success: false,
          count: 0,
          spendTotal: 0,
          message: error?.message || 'Google Ads insight probe failed',
        };
      }
    }

    return {
      ready: missing.length === 0 && insightProbe?.success !== false,
      missing,
      apiVersion: info.apiVersion,
      configuredAccountCount: info.configuredAccounts.length,
      configuredAccounts: info.configuredAccounts,
      loginCustomerId: info.loginCustomerId || null,
      insightProbe,
      nextAction:
        missing.length === 0
          ? '可先用 /integrations/google-ads/insights 預覽 spend，再用 /integrations/google-ads/sync 寫入 Expense。'
          : '請到 Google Ads API 中心取得 developer token，並提供 OAuth client / refresh token / customer ID。',
    };
  }

  async previewInsights(params: {
    since?: Date;
    until?: Date;
    customerIds?: string[];
    level?: 'account' | 'campaign';
    pageSize?: string | number;
    maxPages?: string | number;
  }) {
    const { since, until } = this.resolveRange(params.since, params.until);
    const rows = await this.adapter.fetchInsights({
      since,
      until,
      customerIds: params.customerIds,
      level: params.level,
      pageSize: params.pageSize,
      maxPages: params.maxPages,
    });
    const spendTotal = rows.reduce(
      (sum, row) => sum + this.costMicrosToAmount(row.costMicros),
      0,
    );

    return {
      success: true,
      range: {
        since: since.toISOString(),
        until: until.toISOString(),
      },
      level: params.level || 'account',
      count: rows.length,
      spendTotal,
      sample: rows
        .slice(0, Math.min(Number(params.pageSize || 20), 50))
        .map((row) => this.mapInsightPreview(row)),
    };
  }

  async syncInsights(params: {
    entityId?: string;
    since?: Date;
    until?: Date;
    customerIds?: string[];
    includeZeroSpend?: boolean;
    maxPages?: string | number;
  }) {
    const entityId =
      params.entityId ||
      this.config.get<string>('GOOGLE_ADS_DEFAULT_ENTITY_ID', '') ||
      DEFAULT_ENTITY_ID;
    const { since, until } = this.resolveRange(params.since, params.until);
    const rows = await this.adapter.fetchInsights({
      since,
      until,
      customerIds: params.customerIds,
      level: 'account',
      maxPages: params.maxPages,
    });
    const syncableRows = rows.filter(
      (row) =>
        params.includeZeroSpend || this.costMicrosToAmount(row.costMicros) > 0,
    );
    let created = 0;
    let updated = 0;

    for (const row of syncableRows) {
      const result = await this.upsertExpense(entityId, row);
      if (result === 'created') created += 1;
      if (result === 'updated') updated += 1;
    }

    return {
      success: true,
      entityId,
      range: {
        since: since.toISOString(),
        until: until.toISOString(),
      },
      fetched: rows.length,
      synced: syncableRows.length,
      created,
      updated,
      skippedZeroSpend: rows.length - syncableRows.length,
      expenseSourceModule: GOOGLE_ADS_SOURCE_MODULE,
      dashboardEffect:
        'CEO Dashboard management summary counts Google Ads Expense rows as advertising spend.',
    };
  }

  assertSchedulerToken(syncToken?: string) {
    const expected = (
      this.config.get<string>('GOOGLE_ADS_SYNC_JOB_TOKEN', '') || ''
    ).trim();
    if (!expected) {
      throw new BadRequestException(
        'GOOGLE_ADS_SYNC_JOB_TOKEN is not configured',
      );
    }
    if (!syncToken || syncToken !== expected) {
      throw new BadRequestException('Invalid Google Ads sync token');
    }
  }

  @Cron('27 4 * * *', { timeZone: 'Asia/Taipei' })
  async scheduledSync() {
    const enabled =
      (
        this.config.get<string>('GOOGLE_ADS_SYNC_ENABLED', '') || ''
      ).toLowerCase() === 'true';
    if (!enabled) {
      return;
    }
    const until = new Date();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - 7);
    await this.syncInsights({ since, until });
  }

  private async upsertExpense(entityId: string, row: GoogleAdsInsight) {
    if (!row.date || !row.customerId) {
      return 'skipped';
    }

    const amount = new Decimal(this.costMicrosToAmount(row.costMicros));
    const currency =
      row.rawAccount?.currency ||
      this.config.get<string>('GOOGLE_ADS_DEFAULT_CURRENCY', '') ||
      'TWD';
    const sourceId = `${row.customerId}:${row.date}`;
    const description = this.buildExpenseDescription(row);
    const itemDescription = this.buildExpenseItemDescription(row);
    const existing = await this.prisma.expense.findFirst({
      where: {
        entityId,
        sourceModule: GOOGLE_ADS_SOURCE_MODULE,
        sourceId,
      },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.$transaction([
        this.prisma.expense.update({
          where: { id: existing.id },
          data: {
            expenseDate: new Date(`${row.date}T00:00:00.000Z`),
            totalAmountOriginal: amount,
            totalAmountCurrency: currency,
            totalAmountFxRate: new Decimal(1),
            totalAmountBase: amount,
            description,
          },
        }),
        this.prisma.expenseItem.deleteMany({
          where: { expenseId: existing.id },
        }),
        this.prisma.expenseItem.create({
          data: {
            expenseId: existing.id,
            accountCode: AD_EXPENSE_ACCOUNT_CODE,
            amountOriginal: amount,
            amountCurrency: currency,
            amountFxRate: new Decimal(1),
            amountBase: amount,
            description: itemDescription,
          },
        }),
      ]);
      return 'updated';
    }

    await this.prisma.expense.create({
      data: {
        entityId,
        expenseDate: new Date(`${row.date}T00:00:00.000Z`),
        totalAmountOriginal: amount,
        totalAmountCurrency: currency,
        totalAmountFxRate: new Decimal(1),
        totalAmountBase: amount,
        description,
        sourceModule: GOOGLE_ADS_SOURCE_MODULE,
        sourceId,
        items: {
          create: {
            accountCode: AD_EXPENSE_ACCOUNT_CODE,
            amountOriginal: amount,
            amountCurrency: currency,
            amountFxRate: new Decimal(1),
            amountBase: amount,
            description: itemDescription,
          },
        },
      },
    });
    return 'created';
  }

  private resolveRange(since?: Date, until?: Date) {
    const end = until && !Number.isNaN(until.getTime()) ? until : new Date();
    const start =
      since && !Number.isNaN(since.getTime())
        ? since
        : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (start > end) {
      throw new BadRequestException('since must be before until');
    }
    return { since: start, until: end };
  }

  private mapInsightPreview(row: GoogleAdsInsight) {
    return {
      customerId: row.customerId,
      customerName: row.customerName || row.rawAccount?.name || null,
      campaignId: row.campaignId || null,
      campaignName: row.campaignName || null,
      brand: row.rawAccount?.brand || null,
      platform: row.rawAccount?.platform || null,
      date: row.date,
      spend: this.costMicrosToAmount(row.costMicros),
      impressions: this.toNumber(row.impressions),
      clicks: this.toNumber(row.clicks),
      conversions: this.toNumber(row.conversions),
    };
  }

  private buildExpenseDescription(row: GoogleAdsInsight) {
    const parts = [
      'Google Ads 廣告費',
      row.customerName || row.rawAccount?.name || row.customerId,
      row.rawAccount?.brand ? `brand=${row.rawAccount.brand}` : null,
      row.rawAccount?.platform ? `platform=${row.rawAccount.platform}` : null,
      row.date,
    ].filter(Boolean);
    return parts.join(' ');
  }

  private buildExpenseItemDescription(row: GoogleAdsInsight) {
    const parts = [
      'Google Ads spend',
      `customer=${row.customerId}`,
      row.customerName ? `customerName=${row.customerName}` : null,
      row.rawAccount?.brand ? `brand=${row.rawAccount.brand}` : null,
      row.rawAccount?.platform ? `platform=${row.rawAccount.platform}` : null,
      row.impressions ? `impressions=${row.impressions}` : null,
      row.clicks ? `clicks=${row.clicks}` : null,
    ].filter(Boolean);
    return parts.join('; ');
  }

  private costMicrosToAmount(value: unknown) {
    return Number((this.toNumber(value) / 1_000_000).toFixed(2));
  }

  private toNumber(value: unknown) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
