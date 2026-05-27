import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MetaAdsAdapter, MetaAdsInsight } from './meta-ads.adapter';

const META_ADS_SOURCE_MODULE = 'meta_ads';
const DEFAULT_ENTITY_ID = 'tw-entity-001';
const AD_EXPENSE_ACCOUNT_CODE = '6118';

@Injectable()
export class MetaAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: MetaAdsAdapter,
    private readonly config: ConfigService,
  ) {}

  getConnectionInfo() {
    return this.adapter.getConnectionInfo();
  }

  async getReadiness() {
    const info = this.adapter.getConnectionInfo();
    const missing: string[] = [];
    if (!info.tokenConfigured) missing.push('META_ADS_ACCESS_TOKEN');

    let accountProbe: {
      success: boolean;
      count: number;
      message?: string;
    } | null = null;
    if (info.tokenConfigured) {
      try {
        const accounts = await this.adapter.fetchAdAccounts({ limit: 25 });
        accountProbe = {
          success: true,
          count: accounts.length,
        };
      } catch (error: any) {
        accountProbe = {
          success: false,
          count: 0,
          message: error?.message || 'Meta ad account probe failed',
        };
      }
    }

    const configuredAccountCount = info.configuredAccounts.length;
    const readableAccountCount = accountProbe?.success ? accountProbe.count : 0;
    const readyForInsights =
      missing.length === 0 &&
      (configuredAccountCount > 0 || readableAccountCount > 0);

    return {
      ready: readyForInsights,
      tokenConfigured: info.tokenConfigured,
      missing,
      apiVersion: info.apiVersion,
      configuredAccountCount,
      readableAccountCount,
      accountProbe,
      configuredAccounts: info.configuredAccounts,
      nextAction: readyForInsights
        ? '可先用 /integrations/meta-ads/insights 預覽 spend，再用 /integrations/meta-ads/sync 寫入 Expense。'
        : '請確認 Meta token 具備 ads_read，並提供 META_ADS_ACCOUNT_IDS 或 META_ADS_ACCOUNTS_JSON 帳戶 mapping。',
    };
  }

  async previewAdAccounts(params: { limit?: string | number } = {}) {
    const accounts = await this.adapter.fetchAdAccounts(params);
    return {
      success: true,
      count: accounts.length,
      accounts: accounts.map((account) => ({
        id: account.id || null,
        accountId: account.account_id || null,
        name: account.name || null,
        currency: account.currency || null,
        accountStatus: account.account_status ?? null,
        businessId: account.business?.id || null,
        businessName: account.business?.name || null,
      })),
    };
  }

  async previewInsights(params: {
    since?: Date;
    until?: Date;
    accountIds?: string[];
    level?: 'account' | 'campaign';
    limit?: string | number;
    maxPages?: string | number;
  }) {
    const { since, until } = this.resolveRange(params.since, params.until);
    const rows = await this.adapter.fetchInsights({
      since,
      until,
      accountIds: params.accountIds,
      level: params.level,
      limit: params.limit,
      maxPages: params.maxPages,
    });
    const spendTotal = rows.reduce(
      (sum, row) => sum + this.toNumber(row.spend),
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
        .slice(0, Math.min(Number(params.limit || 20), 50))
        .map((row) => this.mapInsightPreview(row)),
    };
  }

  async syncInsights(params: {
    entityId?: string;
    since?: Date;
    until?: Date;
    accountIds?: string[];
    includeZeroSpend?: boolean;
    maxPages?: string | number;
  }) {
    const entityId =
      params.entityId ||
      this.config.get<string>('META_ADS_DEFAULT_ENTITY_ID', '') ||
      DEFAULT_ENTITY_ID;
    const { since, until } = this.resolveRange(params.since, params.until);
    const rows = await this.adapter.fetchInsights({
      since,
      until,
      accountIds: params.accountIds,
      level: 'account',
      maxPages: params.maxPages,
    });
    const syncableRows = rows.filter(
      (row) => params.includeZeroSpend || this.toNumber(row.spend) > 0,
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
      expenseSourceModule: META_ADS_SOURCE_MODULE,
      dashboardEffect:
        'CEO Dashboard management summary already counts Expense rows whose description/account indicates Meta advertising spend.',
    };
  }

  assertSchedulerToken(syncToken?: string) {
    const expected = (
      this.config.get<string>('META_ADS_SYNC_JOB_TOKEN', '') || ''
    ).trim();
    if (!expected) {
      throw new BadRequestException(
        'META_ADS_SYNC_JOB_TOKEN is not configured',
      );
    }
    if (!syncToken || syncToken !== expected) {
      throw new BadRequestException('Invalid Meta Ads sync token');
    }
  }

  @Cron('17 4 * * *', { timeZone: 'Asia/Taipei' })
  async scheduledSync() {
    const enabled =
      (
        this.config.get<string>('META_ADS_SYNC_ENABLED', '') || ''
      ).toLowerCase() === 'true';
    if (!enabled) {
      return;
    }
    const until = new Date();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - 7);
    await this.syncInsights({ since, until });
  }

  private async upsertExpense(entityId: string, row: MetaAdsInsight) {
    const date = row.date_start || row.date_stop;
    if (!date) {
      return 'skipped';
    }
    const accountId = this.adapter.normalizeAccountId(
      row.rawAccount?.accountId || row.account_id || '',
    );
    if (!accountId) {
      return 'skipped';
    }

    const amount = new Decimal(this.toNumber(row.spend));
    const currency =
      row.rawAccount?.currency ||
      this.config.get<string>('META_ADS_DEFAULT_CURRENCY', '') ||
      'TWD';
    const sourceId = `${accountId}:${date}`;
    const description = this.buildExpenseDescription(row, accountId, date);
    const itemDescription = this.buildExpenseItemDescription(row, accountId);
    const existing = await this.prisma.expense.findFirst({
      where: {
        entityId,
        sourceModule: META_ADS_SOURCE_MODULE,
        sourceId,
      },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.$transaction([
        this.prisma.expense.update({
          where: { id: existing.id },
          data: {
            expenseDate: new Date(`${date}T00:00:00.000Z`),
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
        expenseDate: new Date(`${date}T00:00:00.000Z`),
        totalAmountOriginal: amount,
        totalAmountCurrency: currency,
        totalAmountFxRate: new Decimal(1),
        totalAmountBase: amount,
        description,
        sourceModule: META_ADS_SOURCE_MODULE,
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

  private mapInsightPreview(row: MetaAdsInsight) {
    return {
      accountId: this.adapter.normalizeAccountId(
        row.rawAccount?.accountId || row.account_id || '',
      ),
      accountName: row.account_name || row.rawAccount?.name || null,
      campaignId: row.campaign_id || null,
      campaignName: row.campaign_name || null,
      brand: row.rawAccount?.brand || null,
      reportBrand: row.rawAccount?.reportBrand || null,
      platform: row.rawAccount?.platform || null,
      market: row.rawAccount?.market || null,
      businessUnit: row.rawAccount?.businessUnit || null,
      channelCode: row.rawAccount?.channelCode || null,
      dateStart: row.date_start || null,
      dateStop: row.date_stop || null,
      spend: this.toNumber(row.spend),
      impressions: this.toNumber(row.impressions),
      clicks: this.toNumber(row.clicks),
      ctr: this.toNumber(row.ctr),
      cpc: this.toNumber(row.cpc),
      cpm: this.toNumber(row.cpm),
    };
  }

  private buildExpenseDescription(
    row: MetaAdsInsight,
    accountId: string,
    date: string,
  ) {
    const parts = [
      'Meta Ads 廣告費',
      row.account_name || row.rawAccount?.name || accountId,
      row.rawAccount?.brand ? `brand=${row.rawAccount.brand}` : null,
      row.rawAccount?.reportBrand
        ? `reportBrand=${row.rawAccount.reportBrand}`
        : null,
      row.rawAccount?.platform ? `platform=${row.rawAccount.platform}` : null,
      row.rawAccount?.market ? `market=${row.rawAccount.market}` : null,
      row.rawAccount?.businessUnit
        ? `businessUnit=${row.rawAccount.businessUnit}`
        : null,
      row.rawAccount?.channelCode
        ? `channelCode=${row.rawAccount.channelCode}`
        : null,
      date,
    ].filter(Boolean);
    return parts.join(' ');
  }

  private buildExpenseItemDescription(row: MetaAdsInsight, accountId: string) {
    const parts = [
      'Meta Ads spend',
      `account=${accountId}`,
      row.account_name ? `accountName=${row.account_name}` : null,
      row.rawAccount?.brand ? `brand=${row.rawAccount.brand}` : null,
      row.rawAccount?.reportBrand
        ? `reportBrand=${row.rawAccount.reportBrand}`
        : null,
      row.rawAccount?.platform ? `platform=${row.rawAccount.platform}` : null,
      row.rawAccount?.market ? `market=${row.rawAccount.market}` : null,
      row.rawAccount?.businessUnit
        ? `businessUnit=${row.rawAccount.businessUnit}`
        : null,
      row.rawAccount?.channelCode
        ? `channelCode=${row.rawAccount.channelCode}`
        : null,
      row.impressions ? `impressions=${row.impressions}` : null,
      row.clicks ? `clicks=${row.clicks}` : null,
    ].filter(Boolean);
    return parts.join('; ');
  }

  private toNumber(value: unknown) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
