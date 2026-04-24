import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createCipheriv } from 'crypto';
import { ImportProviderPayoutsDto } from './dto/import-provider-payouts.dto';
import { SyncEcpayShopifyPayoutsDto } from './dto/sync-ecpay-shopify-payouts.dto';
import { ProviderPayoutReconciliationService } from './provider-payout-reconciliation.service';
import { PrismaService } from '../../common/prisma/prisma.service';

type EcpayShopifyQuery =
  | {
      MerchantID: string;
      PaymentID: string;
    }
  | {
      MerchantID: string;
      DateType: '1' | '2';
      BeginDate: string;
      EndDate: string;
      PaymentType?: '01' | '02' | '03' | '11';
    };

type EcpayCsvRow = Record<string, string>;
type CanonicalImportRow = Record<string, string | number | null>;
type EcpayMerchantProfile = {
  key: string;
  merchantId: string;
  hashKey: string;
  hashIv: string;
  apiUrl: string;
  entityId?: string;
  syncEnabled: boolean;
  lookbackDays: number;
  dateType: '1' | '2';
  description?: string;
};

@Injectable()
export class EcpayShopifyPayoutService {
  private readonly logger = new Logger(EcpayShopifyPayoutService.name);
  private readonly merchantProfiles: EcpayMerchantProfile[];

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly providerPayoutService: ProviderPayoutReconciliationService,
  ) {
    this.merchantProfiles = this.loadMerchantProfiles();
  }

  @Cron('0 25 8 * * *', {
    name: 'ecpayShopifyPayoutSync',
    timeZone: process.env.TZ || 'Asia/Taipei',
  })
  async handleScheduledSync() {
    const profiles = this.merchantProfiles.filter(
      (profile) => profile.syncEnabled && this.hasApiCredentials(profile),
    );

    if (!profiles.length) {
      return;
    }

    try {
      const importedBy = await this.resolveSyncUserId();
      const today = new Date();
      const summaries = [];

      for (const profile of profiles) {
        const entityId =
          profile.entityId ||
          this.configService.get<string>('SHOPIFY_DEFAULT_ENTITY_ID', '') ||
          '';
        if (!entityId) {
          this.logger.warn(
            `Skipping scheduled ECPay payout sync for ${profile.key} because entityId is not configured.`,
          );
          continue;
        }

        const endDate = this.formatDate(today);
        const beginDate = this.formatDate(
          this.addDays(today, -1 * profile.lookbackDays),
        );

        const result = await this.syncShopifyPayouts(
          {
            merchantKey: profile.key,
            entityId,
            beginDate,
            endDate,
            dateType: profile.dateType,
          },
          importedBy,
        );

        summaries.push(
          `${profile.key}: imported=${result.imported}, recordCount=${result.recordCount}`,
        );
      }

      this.logger.log(
        `Scheduled ECPay payout sync finished: ${summaries.join(' | ')}`,
      );
    } catch (error) {
      this.logger.error(
        `Scheduled ECPay Shopify payout sync failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async syncShopifyPayouts(
    dto: SyncEcpayShopifyPayoutsDto,
    importedBy?: string,
  ) {
    const profile = this.resolveMerchantProfile(dto.merchantKey);
    this.assertApiCredentials(profile);

    const entityId = this.resolveEntityId(dto.entityId, profile.entityId);
    const queries = this.buildQueries(dto, profile);
    const canonicalRowMap = new Map<string, CanonicalImportRow>();

    for (const query of queries) {
      const csvText = await this.fetchCsv(query, profile);
      this.assertApiResponse(csvText);

      const parsedRows = this.parseCsv(csvText);
      for (const row of parsedRows) {
        const canonical = this.toCanonicalImportRow(row);
        if (
          !(
            canonical.providerPaymentId ||
            canonical.providerTradeNo ||
            canonical.grossAmount
          )
        ) {
          continue;
        }
        canonicalRowMap.set(this.buildCanonicalRowKey(canonical), canonical);
      }
    }

    const canonicalRows = Array.from(canonicalRowMap.values());
    const firstQuery = queries[0];

    if (!canonicalRows.length) {
      return {
        success: true,
        imported: false,
        source: 'ecpay.shopify-api',
        merchantKey: profile.key,
        merchantId: profile.merchantId,
        query: firstQuery,
        queries,
        entityId,
        recordCount: 0,
        message: '綠界本次查詢沒有新的 Shopify 撥款資料。',
      };
    }

    const userId = importedBy || (await this.resolveSyncUserId());
    const payload: ImportProviderPayoutsDto = {
      entityId,
      provider: 'ecpay',
      sourceType: 'reconciliation',
      fileName: this.buildVirtualFileName(queries),
      notes: this.buildBatchNotes(queries, profile),
      rows: canonicalRows,
    };

    const importResult = await this.providerPayoutService.importProviderPayouts(
      payload,
      userId,
    );

    return {
      success: true,
      imported: true,
      source: 'ecpay.shopify-api',
      merchantKey: profile.key,
      merchantId: profile.merchantId,
      entityId,
      query: firstQuery,
      queries,
      recordCount: canonicalRows.length,
      importResult,
    };
  }

  assertSchedulerToken(providedToken?: string | null) {
    const expected =
      this.configService.get<string>('ECPAY_SYNC_JOB_TOKEN', '') ||
      this.configService.get<string>('SHOPIFY_SYNC_JOB_TOKEN', '') ||
      '';

    if (!expected) {
      throw new UnauthorizedException(
        'ECPAY_SYNC_JOB_TOKEN is not configured',
      );
    }

    if (!providedToken || providedToken !== expected) {
      throw new UnauthorizedException('Invalid scheduler token');
    }
  }

  async backfillHistory(
    params: {
      entityId: string;
      beginDate: string;
      endDate: string;
      merchantKeys?: string[];
      dateType?: '1' | '2';
      paymentType?: '01' | '02' | '03' | '11';
      windowDays?: number;
      maxWindows?: number;
    },
    importedBy?: string,
  ) {
    const merchantKeys =
      params.merchantKeys && params.merchantKeys.length
        ? Array.from(new Set(params.merchantKeys.map((key) => key.trim()).filter(Boolean)))
        : this.merchantProfiles
            .filter((profile) => this.hasApiCredentials(profile))
            .map((profile) => profile.key);

    if (!merchantKeys.length) {
      throw new BadRequestException(
        'No ECPay merchant profiles are available for historical backfill.',
      );
    }

    const { begin, end } = this.parseDateRange(params.beginDate, params.endDate);
    const windows = this.buildRollingWindows(
      begin,
      end,
      Math.max(1, Math.min(params.windowDays || 31, 31)),
    );
    const limitedWindows =
      params.maxWindows && params.maxWindows > 0
        ? windows.slice(0, params.maxWindows)
        : windows;

    const results = [];
    let totalRecordCount = 0;
    let importedMerchantCount = 0;
    let processedWindowCount = 0;

    for (const merchantKey of merchantKeys) {
      let merchantImported = false;

      for (const window of limitedWindows) {
        const result = await this.syncShopifyPayouts(
          {
            entityId: params.entityId,
            merchantKey,
            beginDate: window.beginDate,
            endDate: window.endDate,
            dateType: params.dateType,
            paymentType: params.paymentType,
          },
          importedBy,
        );

        totalRecordCount += Number(result.recordCount || 0);
        if (result.imported) {
          merchantImported = true;
        }
        results.push({
          ...result,
          requestedWindow: window,
        });
      }

      if (merchantImported) {
        importedMerchantCount += 1;
      }
    }

    if (!limitedWindows.length) {
      return {
        success: true,
        entityId: params.entityId,
        beginDate: params.beginDate,
        endDate: params.endDate,
        merchantCount: merchantKeys.length,
        importedMerchantCount: 0,
        totalRecordCount: 0,
        processedWindowCount: 0,
        totalWindowCount: 0,
        remainingWindows: 0,
        nextBeginDate: null,
        completedAllWindows: true,
        results: [],
      };
    }

    processedWindowCount = limitedWindows.length;
    const remainingWindows = Math.max(windows.length - processedWindowCount, 0);
    const lastProcessedWindow = limitedWindows[limitedWindows.length - 1];
    const nextBeginDate =
      remainingWindows > 0
        ? this.formatDate(
            this.addDays(
              this.parseDateRange(
                lastProcessedWindow.endDate,
                lastProcessedWindow.endDate,
              ).end,
              1,
            ),
          )
        : null;

    const requestedWindow = {
      beginDate: limitedWindows[0].beginDate,
      endDate: lastProcessedWindow.endDate,
    };

    return {
      success: true,
      entityId: params.entityId,
      beginDate: requestedWindow.beginDate,
      endDate: requestedWindow.endDate,
      merchantCount: merchantKeys.length,
      importedMerchantCount,
      totalRecordCount,
      processedWindowCount,
      totalWindowCount: windows.length,
      remainingWindows,
      nextBeginDate,
      completedAllWindows: remainingWindows === 0,
      results,
    };
  }

  async syncConfiguredMerchantPayouts(
    params: {
      entityId: string;
      beginDate: string;
      endDate: string;
      merchantKeys?: string[];
    },
    importedBy?: string,
  ) {
    const requestedKeys =
      params.merchantKeys && params.merchantKeys.length
        ? Array.from(new Set(params.merchantKeys.map((key) => key.trim()).filter(Boolean)))
        : this.merchantProfiles
            .filter((profile) => this.hasApiCredentials(profile))
            .map((profile) => profile.key);
    const merchantKeys = requestedKeys.filter((merchantKey) =>
      this.merchantProfiles.some(
        (profile) =>
          (profile.key === merchantKey || profile.merchantId === merchantKey) &&
          this.hasApiCredentials(profile),
      ),
    );

    const results = [];
    let importedCount = 0;
    let totalRecordCount = 0;

    for (const merchantKey of requestedKeys) {
      if (!merchantKeys.includes(merchantKey)) {
        results.push({
          success: false,
          imported: false,
          merchantKey,
          recordCount: 0,
          skipped: true,
          reason: 'missing_profile_or_credentials',
        });
      }
    }

    for (const merchantKey of merchantKeys) {
      const result = await this.syncShopifyPayouts(
        {
          entityId: params.entityId,
          merchantKey,
          beginDate: params.beginDate,
          endDate: params.endDate,
        },
        importedBy,
      );
      if (result.imported) {
        importedCount += 1;
      }
      totalRecordCount += Number(result.recordCount || 0);
      results.push(result);
    }

    return {
      success: true,
      entityId: params.entityId,
      merchantCount: merchantKeys.length,
      importedMerchantCount: importedCount,
      totalRecordCount,
      results,
    };
  }

  private isTruthy(value?: string | boolean | null) {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  private hasApiCredentials(profile?: EcpayMerchantProfile | null) {
    return Boolean(
      profile?.merchantId &&
        profile.hashKey &&
        profile.hashIv &&
        profile.apiUrl,
    );
  }

  private assertApiCredentials(profile: EcpayMerchantProfile) {
    if (!this.hasApiCredentials(profile)) {
      throw new BadRequestException(
        `綠界 merchant profile ${profile.key} 的 MerchantID / HashKey / HashIV 尚未完整設定。`,
      );
    }
  }

  private resolveEntityId(input?: string, fallbackEntityId?: string) {
    const entityId =
      input?.trim() ||
      fallbackEntityId?.trim() ||
      this.configService.get<string>('SHOPIFY_DEFAULT_ENTITY_ID', '') ||
      '';

    if (!entityId) {
      throw new BadRequestException(
        'entityId is required or SHOPIFY_DEFAULT_ENTITY_ID must be configured.',
      );
    }

    return entityId;
  }

  private buildQueries(
    dto: SyncEcpayShopifyPayoutsDto,
    profile: EcpayMerchantProfile,
  ): EcpayShopifyQuery[] {
    if (dto.paymentId?.trim()) {
      return [
        {
          MerchantID: profile.merchantId,
          PaymentID: dto.paymentId.trim(),
        },
      ];
    }

    const beginDate =
      dto.beginDate ||
      this.formatDate(this.addDays(new Date(), -1 * profile.lookbackDays));
    const endDate = dto.endDate || this.formatDate(new Date());
    const { begin, end } = this.parseDateRange(beginDate, endDate);

    return this.buildDateWindows(begin, end).map(({ beginDate, endDate }) => ({
      MerchantID: profile.merchantId,
      DateType: dto.dateType || profile.dateType,
      BeginDate: beginDate,
      EndDate: endDate,
      PaymentType: dto.paymentType,
    }));
  }

  private parseDateRange(beginDate: string, endDate: string) {
    const begin = new Date(`${beginDate}T00:00:00+08:00`);
    const end = new Date(`${endDate}T00:00:00+08:00`);

    if (Number.isNaN(begin.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException(
        'beginDate / endDate 格式必須為 yyyy-MM-dd',
      );
    }

    if (begin > end) {
      throw new BadRequestException('beginDate cannot be later than endDate');
    }

    return { begin, end };
  }

  private buildDateWindows(begin: Date, end: Date) {
    const windows: Array<{ beginDate: string; endDate: string }> = [];
    let cursor = new Date(begin);

    while (cursor <= end) {
      const windowEnd = new Date(
        Math.min(this.endOfMonth(cursor).getTime(), end.getTime()),
      );
      windows.push({
        beginDate: this.formatDate(cursor),
        endDate: this.formatDate(windowEnd),
      });
      cursor = this.addDays(windowEnd, 1);
    }

    return windows;
  }

  private buildRollingWindows(begin: Date, end: Date, windowDays: number) {
    const windows: Array<{ beginDate: string; endDate: string }> = [];
    let cursor = new Date(begin);

    while (cursor <= end) {
      const windowEnd = new Date(cursor);
      windowEnd.setDate(windowEnd.getDate() + windowDays - 1);
      const boundedEnd = new Date(Math.min(windowEnd.getTime(), end.getTime()));
      windows.push({
        beginDate: this.formatDate(cursor),
        endDate: this.formatDate(boundedEnd),
      });
      cursor = this.addDays(boundedEnd, 1);
    }

    return windows;
  }

  private endOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  private assertWindowRange(beginDate: string, endDate: string) {
    const { begin, end } = this.parseDateRange(beginDate, endDate);
    const diffDays = Math.floor(
      (end.getTime() - begin.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (diffDays > 31) {
      throw new BadRequestException('綠界單次查詢區間最多 1 個月。');
    }
  }

  private buildCanonicalRowKey(row: CanonicalImportRow) {
    return [
      row.providerPaymentId || '',
      row.providerTradeNo || '',
      row.externalOrderId || '',
      row.transactionDate || row.payoutDate || row.statementDate || '',
      row.grossAmount ?? '',
    ].join('::');
  }

  private getNetAmount(row: EcpayCsvRow) {
    return (
      this.parseNumber(row['撥款金額']) ??
      this.parseNumber(row['結算金額']) ??
      this.parseNumber(row['應收款項(淨額)']) ??
      this.parseNumber(row['應收款項淨額']) ??
      this.parseNumber(row['實收金額']) ??
      this.parseNumber(row['入帳金額'])
    );
  }

  private toCanonicalImportRow(row: EcpayCsvRow): CanonicalImportRow {
    const grossAmount = this.parseNumber(row['交易金額']);
    const gatewayFeeAmount =
      this.parseNumber(row['交易手續費']) ??
      this.parseNumber(row['金流手續費']) ??
      this.parseNumber(row['信用卡手續費']);
    const processingFeeAmount =
      this.parseNumber(row['金流處理費']) ??
      this.parseNumber(row['處理費']) ??
      this.parseNumber(row['服務費']);
    const platformFeeAmount =
      this.parseNumber(row['平台手續費']) ??
      this.parseNumber(row['平台費']);
    const fallbackFee =
      this.parseNumber(row['手續費']) ?? this.parseNumber(row['交易手續費']);
    const splitFeeTotal = [
      gatewayFeeAmount,
      processingFeeAmount,
      platformFeeAmount,
    ]
      .filter((value): value is number => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const totalFee =
      splitFeeTotal > 0 ? splitFeeTotal : (fallbackFee ?? 0);
    const refundAmount = this.parseNumber(row['退款金額']) ?? 0;
    const netAmount =
      this.getNetAmount(row) ??
      (grossAmount === null
        ? null
        : Number((grossAmount - totalFee - refundAmount).toFixed(2)));

    return {
      externalOrderId: row['廠商訂單編號'] || null,
      providerTradeNo: row['綠界交易編號'] || row['TradeNo'] || null,
      providerPaymentId: row['PaymentID'] || row['payment_id'] || null,
      statementDate: row['結算日期'] || row['報表日期'] || null,
      payoutDate: row['撥款日期'] || row['入帳日期'] || null,
      gateway: row['付款方式'] || null,
      payoutStatus: row['撥款狀態'] || row['結算狀態'] || null,
      currency: 'TWD',
      grossAmount,
      feeAmount: Number(totalFee.toFixed(2)),
      gatewayFeeAmount:
        gatewayFeeAmount === null
          ? null
          : Number(gatewayFeeAmount.toFixed(2)),
      processingFeeAmount:
        processingFeeAmount === null
          ? null
          : Number(processingFeeAmount.toFixed(2)),
      platformFeeAmount:
        platformFeeAmount === null
          ? null
          : Number(platformFeeAmount.toFixed(2)),
      netAmount,
      refundAmount: Number(refundAmount.toFixed(2)),
      processingFee: processingFeeAmount,
      transactionDate: row['交易日期'] || null,
      feeRate: row['手續費率'] || null,
    };
  }

  private parseNumber(value?: string) {
    if (!value) {
      return null;
    }

    const normalized = value.replace(/[,\s$]/g, '').trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private buildVirtualFileName(queries: EcpayShopifyQuery[]) {
    if (queries.length === 1 && 'PaymentID' in queries[0]) {
      return `ecpay-shopify-payment-${queries[0].PaymentID}.csv`;
    }

    const dateQueries = queries.filter(
      (query): query is Extract<EcpayShopifyQuery, { BeginDate: string }> =>
        'BeginDate' in query,
    );
    const beginDate = dateQueries[0]?.BeginDate || this.formatDate(new Date());
    const endDate =
      dateQueries[dateQueries.length - 1]?.EndDate || beginDate;

    return `ecpay-shopify-${beginDate}-${endDate}.csv`;
  }

  private buildBatchNotes(
    queries: EcpayShopifyQuery[],
    profile: EcpayMerchantProfile,
  ) {
    if (queries.length === 1 && 'PaymentID' in queries[0]) {
      return `source=ecpay.shopify-api; merchantKey=${profile.key}; merchantId=${profile.merchantId}; paymentId=${queries[0].PaymentID}`;
    }

    const dateQueries = queries.filter(
      (query): query is Extract<EcpayShopifyQuery, { BeginDate: string }> =>
        'BeginDate' in query,
    );
    const firstQuery = dateQueries[0];
    const lastQuery = dateQueries[dateQueries.length - 1];
    const parts = [
      'source=ecpay.shopify-api',
      `merchantKey=${profile.key}`,
      `merchantId=${profile.merchantId}`,
      `windowCount=${dateQueries.length}`,
      `dateType=${firstQuery?.DateType || profile.dateType}`,
      `beginDate=${firstQuery?.BeginDate || ''}`,
      `endDate=${lastQuery?.EndDate || ''}`,
    ];
    if (firstQuery?.PaymentType) {
      parts.push(`paymentType=${firstQuery.PaymentType}`);
    }

    return parts.join('; ');
  }

  private async fetchCsv(
    query: EcpayShopifyQuery,
    profile: EcpayMerchantProfile,
  ) {
    if ('BeginDate' in query) {
      this.assertWindowRange(query.BeginDate, query.EndDate);
    }

    const encryptedData = this.encryptData(query, profile);
    const response = await fetch(profile.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        MerchantID: profile.merchantId,
        RqHeader: {
          Timestamp: Math.floor(Date.now() / 1000),
        },
        Data: encryptedData,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `綠界 Shopify 對帳 API 失敗 (${response.status})`,
      );
    }

    return text;
  }

  private encryptData(query: EcpayShopifyQuery, profile: EcpayMerchantProfile) {
    const encoded = encodeURIComponent(JSON.stringify(query));
    const cipher = createCipheriv(
      'aes-128-cbc',
      Buffer.from(profile.hashKey, 'utf8'),
      Buffer.from(profile.hashIv, 'utf8'),
    );

    let encrypted = cipher.update(encoded, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  private assertApiResponse(csvText: string) {
    const text = csvText.trim();
    if (!text) {
      throw new InternalServerErrorException(
        '綠界 Shopify 對帳 API 回傳空白內容。',
      );
    }

    if (
      text.includes(
        "Please check if the downloaded IP is the same as the settings on merchant's dashboard.",
      )
    ) {
      throw new BadRequestException(
        '綠界已拒絕目前的來源 IP。請先把 Cloud Run 對外出口靜態 IP 加到綠界後台白名單。',
      );
    }
  }

  private parseCsv(csvText: string): EcpayCsvRow[] {
    const lines = csvText
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return [];
    }

    const headers = this.parseCsvLine(lines[0]).map((cell) =>
      this.cleanCsvCell(cell),
    );
    const rows: EcpayCsvRow[] = [];

    for (const line of lines.slice(1)) {
      const values = this.parseCsvLine(line).map((cell) =>
        this.cleanCsvCell(cell),
      );
      if (!values.some((value) => value)) {
        continue;
      }

      const row: EcpayCsvRow = {};
      headers.forEach((header, index) => {
        if (!header) {
          return;
        }
        row[header] = values[index] || '';
      });
      rows.push(row);
    }

    return rows;
  }

  private parseCsvLine(line: string) {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];

      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
          continue;
        }

        inQuotes = !inQuotes;
        current += char;
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current);
    return values;
  }

  private cleanCsvCell(cell: string) {
    let value = cell.trim();

    if (value.startsWith('="') && value.endsWith('"')) {
      value = value.slice(2, -1);
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    value = value.replace(/""/g, '"').trim();

    if (value === '-') {
      return '';
    }

    return value;
  }

  private async resolveSyncUserId() {
    const preferredEmail =
      this.configService.get<string>('SUPER_ADMIN_EMAIL', '') || '';

    if (preferredEmail.trim()) {
      const user = await this.prisma.user.findUnique({
        where: { email: preferredEmail.trim() },
        select: { id: true },
      });
      if (user) {
        return user.id;
      }
    }

    const fallbackUser = await this.prisma.user.findFirst({
      orderBy: {
        createdAt: 'asc',
      },
      select: { id: true },
    });

    if (!fallbackUser) {
      throw new InternalServerErrorException(
        '找不到可用來記錄匯入批次的系統使用者。',
      );
    }

    return fallbackUser.id;
  }

  private addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private getDefaultApiUrl() {
    return (
      this.configService.get<string>(
        'ECPAY_SHOPIFY_API_URL',
        'https://ecpayment.ecpay.com.tw/Cashier/ShopifyQueryTradeMedia',
      ) || ''
    );
  }

  private getLegacyProfile(): EcpayMerchantProfile | null {
    const merchantId =
      this.configService.get<string>('ECPAY_SHOPIFY_MERCHANT_ID', '') || '';
    const hashKey =
      this.configService.get<string>('ECPAY_SHOPIFY_HASH_KEY', '') || '';
    const hashIv =
      this.configService.get<string>('ECPAY_SHOPIFY_HASH_IV', '') || '';

    if (!merchantId && !hashKey && !hashIv) {
      return null;
    }

    const lookbackRaw = Number(
      this.configService.get<string>('ECPAY_SHOPIFY_SYNC_LOOKBACK_DAYS', '90'),
    );
    const dateTypeRaw =
      this.configService.get<string>('ECPAY_SHOPIFY_QUERY_DATE_TYPE', '2') ||
      '2';

    return {
      key: 'shopify-main',
      merchantId: merchantId.trim(),
      hashKey: hashKey.trim(),
      hashIv: hashIv.trim(),
      apiUrl: this.getDefaultApiUrl(),
      entityId:
        this.configService.get<string>('SHOPIFY_DEFAULT_ENTITY_ID', '') || '',
      syncEnabled: this.isTruthy(
        this.configService.get<string>('ECPAY_SHOPIFY_SYNC_ENABLED', 'false'),
      ),
      lookbackDays: Number.isFinite(lookbackRaw)
        ? Math.min(Math.max(Math.floor(lookbackRaw), 1), 365)
        : 90,
      dateType: dateTypeRaw === '1' ? '1' : '2',
      description: 'Legacy Shopify ECPay merchant profile',
    };
  }

  private loadMerchantProfiles() {
    const profiles: EcpayMerchantProfile[] = [];
    const raw = this.configService.get<string>('ECPAY_MERCHANTS_JSON', '') || '';

    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const merchantId =
              typeof item?.merchantId === 'string' ? item.merchantId.trim() : '';
            const hashKey =
              typeof item?.hashKey === 'string' ? item.hashKey.trim() : '';
            const hashIv =
              typeof item?.hashIv === 'string' ? item.hashIv.trim() : '';

            if (!merchantId || !hashKey || !hashIv) {
              continue;
            }

            const lookbackRaw =
              typeof item?.lookbackDays === 'number'
                ? item.lookbackDays
                : Number(item?.lookbackDays || 90);

            profiles.push({
              key:
                typeof item?.key === 'string' && item.key.trim()
                  ? item.key.trim()
                  : merchantId,
              merchantId,
              hashKey,
              hashIv,
              apiUrl:
                typeof item?.apiUrl === 'string' && item.apiUrl.trim()
                  ? item.apiUrl.trim()
                  : this.getDefaultApiUrl(),
              entityId:
                typeof item?.entityId === 'string' ? item.entityId.trim() : '',
              syncEnabled: this.isTruthy(item?.syncEnabled),
              lookbackDays: Number.isFinite(lookbackRaw)
                ? Math.min(Math.max(Math.floor(lookbackRaw), 1), 365)
                : 90,
              dateType: item?.dateType === '1' ? '1' : '2',
              description:
                typeof item?.description === 'string'
                  ? item.description.trim()
                  : '',
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to parse ECPAY_MERCHANTS_JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const legacy = this.getLegacyProfile();
    if (
      legacy &&
      !profiles.some(
        (profile) =>
          profile.key === legacy.key || profile.merchantId === legacy.merchantId,
      )
    ) {
      profiles.unshift(legacy);
    }

    return profiles;
  }

  private getDefaultScheduledProfile() {
    return (
      this.merchantProfiles.find((profile) => profile.syncEnabled) ||
      this.merchantProfiles[0] ||
      null
    );
  }

  private resolveMerchantProfile(merchantKey?: string) {
    const normalizedKey = merchantKey?.trim();

    if (normalizedKey) {
      const matched = this.merchantProfiles.find(
        (profile) =>
          profile.key === normalizedKey || profile.merchantId === normalizedKey,
      );

      if (!matched) {
        throw new BadRequestException(
          `找不到綠界 merchant profile: ${normalizedKey}`,
        );
      }

      return matched;
    }

    const profile = this.getDefaultScheduledProfile();
    if (!profile) {
      throw new BadRequestException(
        '找不到可用的綠界 merchant profile，請先設定 ECPAY_MERCHANTS_JSON 或既有 ECPAY_SHOPIFY_* 環境變數。',
      );
    }

    return profile;
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: process.env.TZ || 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}
