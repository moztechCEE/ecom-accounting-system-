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
    const query = this.buildQuery(dto);
    const csvText = await this.fetchCsv(query);

    this.assertApiResponse(csvText);

    const parsedRows = this.parseCsv(csvText);
    const canonicalRows = parsedRows
      .map((row) => this.toCanonicalImportRow(row))
      .filter(
        (row) =>
          row.providerPaymentId || row.providerTradeNo || row.grossAmount,
      );

    if (!canonicalRows.length) {
      return {
        success: true,
        imported: false,
        source: 'ecpay.shopify-api',
        query,
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
      fileName: this.buildVirtualFileName(query),
      notes: this.buildBatchNotes(query),
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
      query,
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

  private buildQuery(dto: SyncEcpayShopifyPayoutsDto): EcpayShopifyQuery {
    if (dto.paymentId?.trim()) {
      return {
        MerchantID: this.merchantId,
        PaymentID: dto.paymentId.trim(),
      };
    }

    const beginDate =
      dto.beginDate ||
      this.formatDate(this.addDays(new Date(), -1 * this.getLookbackDays()));
    const endDate = dto.endDate || this.formatDate(new Date());

    this.assertDateRange(beginDate, endDate);

    return {
      MerchantID: this.merchantId,
      DateType: dto.dateType || this.getDefaultDateType(),
      BeginDate: beginDate,
      EndDate: endDate,
      PaymentType: dto.paymentType,
    };
  }

  private getDefaultDateType(): '1' | '2' {
    const raw =
      this.configService.get<string>('ECPAY_SHOPIFY_QUERY_DATE_TYPE', '2') ||
      '2';
    return raw === '1' ? '1' : '2';
  }

  private getLookbackDays() {
    const raw = Number(
      this.configService.get<string>('ECPAY_SHOPIFY_SYNC_LOOKBACK_DAYS', '14'),
    );
    if (!Number.isFinite(raw)) {
      return 14;
    }
    return Math.min(Math.max(Math.floor(raw), 1), 31);
  }

  private assertDateRange(beginDate: string, endDate: string) {
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

    const diffDays = Math.floor(
      (end.getTime() - begin.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (diffDays > 31) {
      throw new BadRequestException('綠界單次查詢區間最多 1 個月。');
    }
  }

  private async fetchCsv(query: EcpayShopifyQuery) {
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

  private toCanonicalImportRow(row: EcpayCsvRow): CanonicalImportRow {
    const grossAmount = this.parseNumber(row['交易金額']);
    const totalFee =
      this.parseNumber(row['手續費']) ??
      this.parseNumber(row['金流處理費']) ??
      0;
    const refundAmount = this.parseNumber(row['退款金額']) ?? 0;
    const netAmount =
      grossAmount === null
        ? null
        : Number((grossAmount - totalFee - refundAmount).toFixed(2));

    return {
      externalOrderId: row['廠商訂單編號'] || null,
      providerTradeNo: row['綠界交易編號'] || null,
      providerPaymentId: row['PaymentID'] || null,
      statementDate: row['結算日期'] || null,
      payoutDate: row['撥款日期'] || null,
      gateway: row['付款方式'] || null,
      currency: 'TWD',
      grossAmount,
      feeAmount: Number(totalFee.toFixed(2)),
      netAmount,
      refundAmount: Number(refundAmount.toFixed(2)),
      processingFee: this.parseNumber(row['金流處理費']),
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

  private buildVirtualFileName(query: EcpayShopifyQuery) {
    if ('PaymentID' in query) {
      return `ecpay-shopify-payment-${query.PaymentID}.csv`;
    }

    return `ecpay-shopify-${query.BeginDate}-${query.EndDate}.csv`;
  }

  private buildBatchNotes(query: EcpayShopifyQuery) {
    if ('PaymentID' in query) {
      return `source=ecpay.shopify-api; paymentId=${query.PaymentID}`;
    }

    const parts = [
      'source=ecpay.shopify-api',
      `dateType=${query.DateType}`,
      `beginDate=${query.BeginDate}`,
      `endDate=${query.EndDate}`,
    ];
    if (query.PaymentType) {
      parts.push(`paymentType=${query.PaymentType}`);
    }

    return parts.join('; ');
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
