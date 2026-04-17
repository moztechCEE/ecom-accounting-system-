import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
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

@Injectable()
export class EcpayShopifyPayoutService {
  private readonly logger = new Logger(EcpayShopifyPayoutService.name);
  private readonly apiUrl: string;
  private readonly merchantId: string;
  private readonly hashKey: string;
  private readonly hashIv: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly providerPayoutService: ProviderPayoutReconciliationService,
  ) {
    this.apiUrl =
      this.configService.get<string>(
        'ECPAY_SHOPIFY_API_URL',
        'https://ecpayment.ecpay.com.tw/Cashier/ShopifyQueryTradeMedia',
      ) || '';
    this.merchantId =
      this.configService.get<string>('ECPAY_SHOPIFY_MERCHANT_ID', '') || '';
    this.hashKey =
      this.configService.get<string>('ECPAY_SHOPIFY_HASH_KEY', '') || '';
    this.hashIv =
      this.configService.get<string>('ECPAY_SHOPIFY_HASH_IV', '') || '';
  }

  @Cron('0 25 8 * * *', {
    name: 'ecpayShopifyPayoutSync',
    timeZone: process.env.TZ || 'Asia/Taipei',
  })
  async handleScheduledSync() {
    if (!this.isSyncEnabled()) {
      return;
    }

    if (!this.hasApiCredentials()) {
      this.logger.warn(
        'Skipping scheduled ECPay Shopify payout sync because API credentials are missing.',
      );
      return;
    }

    const entityId =
      this.configService.get<string>('SHOPIFY_DEFAULT_ENTITY_ID', '') || '';
    if (!entityId) {
      this.logger.warn(
        'Skipping scheduled ECPay Shopify payout sync because SHOPIFY_DEFAULT_ENTITY_ID is not configured.',
      );
      return;
    }

    try {
      const importedBy = await this.resolveSyncUserId();
      const today = new Date();
      const endDate = this.formatDate(today);
      const beginDate = this.formatDate(
        this.addDays(today, -1 * this.getLookbackDays()),
      );

      const result = await this.syncShopifyPayouts(
        {
          entityId,
          beginDate,
          endDate,
          dateType: this.getDefaultDateType(),
        },
        importedBy,
      );

      this.logger.log(
        `Scheduled ECPay Shopify payout sync finished: imported=${result.imported}, recordCount=${result.recordCount}`,
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
    this.assertApiCredentials();

    const entityId = this.resolveEntityId(dto.entityId);
    const queries = this.buildQueries(dto);
    const canonicalRowMap = new Map<string, CanonicalImportRow>();

    for (const query of queries) {
      const csvText = await this.fetchCsv(query);
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
      notes: this.buildBatchNotes(queries),
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
      entityId,
      query: firstQuery,
      queries,
      recordCount: canonicalRows.length,
      importResult,
    };
  }

  private isSyncEnabled() {
    const raw =
      this.configService.get<string>('ECPAY_SHOPIFY_SYNC_ENABLED', 'false') ||
      'false';
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }

  private hasApiCredentials() {
    return Boolean(this.merchantId && this.hashKey && this.hashIv);
  }

  private assertApiCredentials() {
    if (!this.hasApiCredentials()) {
      throw new BadRequestException(
        'ECPAY_SHOPIFY_MERCHANT_ID / ECPAY_SHOPIFY_HASH_KEY / ECPAY_SHOPIFY_HASH_IV 尚未完整設定。',
      );
    }
  }

  private resolveEntityId(input?: string) {
    const entityId =
      input?.trim() ||
      this.configService.get<string>('SHOPIFY_DEFAULT_ENTITY_ID', '') ||
      '';

    if (!entityId) {
      throw new BadRequestException(
        'entityId is required or SHOPIFY_DEFAULT_ENTITY_ID must be configured.',
      );
    }

    return entityId;
  }

  private buildQueries(dto: SyncEcpayShopifyPayoutsDto): EcpayShopifyQuery[] {
    if (dto.paymentId?.trim()) {
      return [
        {
          MerchantID: this.merchantId,
          PaymentID: dto.paymentId.trim(),
        },
      ];
    }

    const beginDate =
      dto.beginDate ||
      this.formatDate(this.addDays(new Date(), -1 * this.getLookbackDays()));
    const endDate = dto.endDate || this.formatDate(new Date());
    const { begin, end } = this.parseDateRange(beginDate, endDate);

    return this.buildDateWindows(begin, end).map(({ beginDate, endDate }) => ({
      MerchantID: this.merchantId,
      DateType: dto.dateType || this.getDefaultDateType(),
      BeginDate: beginDate,
      EndDate: endDate,
      PaymentType: dto.paymentType,
    }));
  }

  private getDefaultDateType(): '1' | '2' {
    const raw =
      this.configService.get<string>('ECPAY_SHOPIFY_QUERY_DATE_TYPE', '2') ||
      '2';
    return raw === '1' ? '1' : '2';
  }

  private getLookbackDays() {
    const raw = Number(
      this.configService.get<string>('ECPAY_SHOPIFY_SYNC_LOOKBACK_DAYS', '90'),
    );
    if (!Number.isFinite(raw)) {
      return 90;
    }
    return Math.min(Math.max(Math.floor(raw), 1), 365);
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

  private buildBatchNotes(queries: EcpayShopifyQuery[]) {
    if (queries.length === 1 && 'PaymentID' in queries[0]) {
      return `source=ecpay.shopify-api; paymentId=${queries[0].PaymentID}`;
    }

    const dateQueries = queries.filter(
      (query): query is Extract<EcpayShopifyQuery, { BeginDate: string }> =>
        'BeginDate' in query,
    );
    const firstQuery = dateQueries[0];
    const lastQuery = dateQueries[dateQueries.length - 1];
    const parts = [
      'source=ecpay.shopify-api',
      `windowCount=${dateQueries.length}`,
      `dateType=${firstQuery?.DateType || this.getDefaultDateType()}`,
      `beginDate=${firstQuery?.BeginDate || ''}`,
      `endDate=${lastQuery?.EndDate || ''}`,
    ];
    if (firstQuery?.PaymentType) {
      parts.push(`paymentType=${firstQuery.PaymentType}`);
    }

    return parts.join('; ');
  }

  private async fetchCsv(query: EcpayShopifyQuery) {
    if ('BeginDate' in query) {
      this.assertWindowRange(query.BeginDate, query.EndDate);
    }

    const encryptedData = this.encryptData(query);
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        MerchantID: this.merchantId,
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

  private encryptData(query: EcpayShopifyQuery) {
    const encoded = encodeURIComponent(JSON.stringify(query));
    const cipher = createCipheriv(
      'aes-128-cbc',
      Buffer.from(this.hashKey, 'utf8'),
      Buffer.from(this.hashIv, 'utf8'),
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

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: process.env.TZ || 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}
