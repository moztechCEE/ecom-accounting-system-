import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ImportProviderPayoutsDto } from './dto/import-provider-payouts.dto';

type SupportedProvider = 'ecpay' | 'hitrust';
type ImportRow = Record<string, string | number | boolean | null>;
type MappingConfig = Record<string, string | string[]>;
type MatchCandidate = Prisma.PaymentGetPayload<{
  include: {
    salesOrder: {
      select: {
        id: true;
        externalOrderId: true;
      };
    };
  };
}>;

type NormalizedPayoutLine = {
  provider: SupportedProvider;
  rowIndex: number;
  payoutDate: Date | null;
  statementDate: Date | null;
  currency: string;
  gateway: string | null;
  externalOrderId: string | null;
  providerPaymentId: string | null;
  providerTradeNo: string | null;
  authorizationCode: string | null;
  grossAmount: Decimal | null;
  feeAmount: Decimal | null;
  netAmount: Decimal | null;
  rawData: ImportRow;
};

type MatchResult = {
  candidate: MatchCandidate | null;
  confidence: number;
  message: string;
};

const COMMON_ALIASES: Record<string, string[]> = {
  externalOrderId: [
    'externalOrderId',
    'orderRef',
    'orderNo',
    '訂單編號',
    '訂單號碼',
    '商店訂單編號',
    '商店訂單號碼',
    'merchantOrderNo',
    'merchantTradeNo',
    'merchant_trade_no',
    'MerchantTradeNo',
    'Merchant Order No',
    'OrderNo',
    'Order No',
  ],
  providerPaymentId: [
    'providerPaymentId',
    'paymentId',
    'payment_id',
    'PaymentID',
    '交易序號',
    '支付單號',
    '交易編號',
    '請款序號',
  ],
  providerTradeNo: [
    'providerTradeNo',
    'tradeNo',
    'trade_no',
    'TradeNo',
    '金流交易編號',
    '綠界交易編號',
    '特店交易編號',
    '交易單號',
  ],
  authorizationCode: [
    'authorizationCode',
    'authorization',
    'authCode',
    'AuthCode',
    '授權碼',
    '授權編號',
  ],
  grossAmount: [
    'grossAmount',
    'amount',
    'gross',
    '交易金額',
    '訂單金額',
    '請款金額',
    '收款金額',
    'TradeAmt',
    '金額',
  ],
  feeAmount: ['feeAmount', 'fee', '手續費', '交易手續費', '服務費', '處理費'],
  netAmount: [
    'netAmount',
    'net',
    '淨額',
    '應收款項(淨額)',
    '應收款項淨額',
    '實收金額',
    '撥款金額',
    '入帳金額',
    '結算金額',
  ],
  payoutDate: [
    'payoutDate',
    'settlementDate',
    '入帳日期',
    '撥款日期',
    '請款日期',
    '結算日期',
    '交易日期',
  ],
  statementDate: ['statementDate', '對帳日期', '報表日期', '匯出日期'],
  currency: ['currency', '幣別', 'Currency'],
  gateway: ['gateway', '付款方式', '支付方式', '收款方式', '交易方式'],
};

const PROVIDER_ALIASES: Record<
  SupportedProvider,
  Partial<typeof COMMON_ALIASES>
> = {
  ecpay: {
    externalOrderId: [
      'MerchantTradeNo',
      '廠商訂單編號',
      '商店訂單編號',
      '訂單編號',
    ],
    providerTradeNo: ['TradeNo', '綠界交易編號', '交易單號'],
    providerPaymentId: ['payment_id', 'PaymentID', '交易序號'],
  },
  hitrust: {
    externalOrderId: ['訂單編號', 'OrderNo', '商店訂單編號'],
    providerPaymentId: ['交易序號', '交易編號', '支付單號'],
    providerTradeNo: ['TradeNo', '金流交易編號'],
  },
};

@Injectable()
export class ProviderPayoutReconciliationService {
  private readonly logger = new Logger(
    ProviderPayoutReconciliationService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  async importProviderPayouts(dto: ImportProviderPayoutsDto, userId: string) {
    if (!dto.rows.length) {
      throw new BadRequestException('rows is required');
    }

    await this.assertEntityExists(dto.entityId);

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.payoutImportBatch.create({
        data: {
          entityId: dto.entityId,
          provider: dto.provider,
          sourceType: dto.sourceType || 'statement',
          importedBy: userId,
          fileName: dto.fileName?.trim() || null,
          recordCount: dto.rows.length,
          notes: dto.notes?.trim() || null,
        },
      });

      const normalizedRows = dto.rows.map((row, index) =>
        this.normalizeRow(dto.provider, row, index + 1, dto.mapping),
      );

      const candidatePayments = await this.loadCandidatePayments(
        tx,
        dto.entityId,
        normalizedRows,
      );
      const reservedPaymentIds = new Set<string>();
      const lineWrites: Prisma.PayoutImportLineCreateManyInput[] = [];
      let matchedCount = 0;
      let unmatchedCount = 0;
      let invalidCount = 0;

      for (const line of normalizedRows) {
        const validationError = this.validateNormalizedLine(line);

        if (validationError) {
          invalidCount += 1;
          lineWrites.push(
            this.toLineWrite(batch.id, line, {
              status: 'invalid',
              confidence: 0,
              message: validationError,
            }),
          );
          continue;
        }

        const match = this.findBestPaymentMatch(
          line,
          candidatePayments,
          reservedPaymentIds,
        );

        if (!match.candidate) {
          unmatchedCount += 1;
          lineWrites.push(
            this.toLineWrite(batch.id, line, {
              status: 'unmatched',
              confidence: match.confidence,
              message: match.message,
            }),
          );
          continue;
        }

        reservedPaymentIds.add(match.candidate.id);
        await this.applyActualPayoutToPayment(
          tx,
          batch.id,
          line,
          match.candidate,
        );
        matchedCount += 1;

        lineWrites.push(
          this.toLineWrite(batch.id, line, {
            status: 'matched',
            confidence: match.confidence,
            message: match.message,
            matchedPaymentId: match.candidate.id,
            matchedSalesOrderId: match.candidate.salesOrderId || null,
          }),
        );
      }

      if (lineWrites.length) {
        await tx.payoutImportLine.createMany({
          data: lineWrites,
        });
      }

      await tx.payoutImportBatch.update({
        where: { id: batch.id },
        data: {
          matchedCount,
          unmatchedCount,
          invalidCount,
        },
      });

      return {
        success: true,
        batchId: batch.id,
        provider: dto.provider,
        recordCount: dto.rows.length,
        matchedCount,
        unmatchedCount,
        invalidCount,
      };
    });
  }

  async getPayoutImportBatches(entityId: string, provider?: string) {
    return this.prisma.payoutImportBatch.findMany({
      where: {
        entityId,
        provider: provider?.trim() || undefined,
      },
      orderBy: {
        importedAt: 'desc',
      },
      take: 50,
    });
  }

  async getPayoutImportBatchDetail(batchId: string) {
    const batch = await this.prisma.payoutImportBatch.findUnique({
      where: { id: batchId },
      include: {
        lines: {
          orderBy: {
            rowIndex: 'asc',
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Payout import batch not found: ${batchId}`);
    }

    return batch;
  }

  private normalizeRow(
    provider: SupportedProvider,
    row: ImportRow,
    rowIndex: number,
    mapping?: MappingConfig,
  ): NormalizedPayoutLine {
    const grossAmount = this.parseDecimal(
      this.pickFieldValue(provider, row, 'grossAmount', mapping),
    );
    let feeAmount = this.parseDecimal(
      this.pickFieldValue(provider, row, 'feeAmount', mapping),
    );
    let netAmount = this.parseDecimal(
      this.pickFieldValue(provider, row, 'netAmount', mapping),
    );

    if (!feeAmount && grossAmount && netAmount) {
      feeAmount = grossAmount.sub(netAmount).toDecimalPlaces(2);
    }

    if (!netAmount && grossAmount && feeAmount) {
      netAmount = grossAmount.sub(feeAmount).toDecimalPlaces(2);
    }

    return {
      provider,
      rowIndex,
      payoutDate: this.parseDate(
        this.pickFieldValue(provider, row, 'payoutDate', mapping),
      ),
      statementDate: this.parseDate(
        this.pickFieldValue(provider, row, 'statementDate', mapping),
      ),
      currency:
        this.toCleanString(
          this.pickFieldValue(provider, row, 'currency', mapping),
        ) || 'TWD',
      gateway: this.toCleanString(
        this.pickFieldValue(provider, row, 'gateway', mapping),
      ),
      externalOrderId: this.toCleanString(
        this.pickFieldValue(provider, row, 'externalOrderId', mapping),
      ),
      providerPaymentId: this.toCleanString(
        this.pickFieldValue(provider, row, 'providerPaymentId', mapping),
      ),
      providerTradeNo: this.toCleanString(
        this.pickFieldValue(provider, row, 'providerTradeNo', mapping),
      ),
      authorizationCode: this.toCleanString(
        this.pickFieldValue(provider, row, 'authorizationCode', mapping),
      ),
      grossAmount,
      feeAmount,
      netAmount,
      rawData: row,
    };
  }

  private validateNormalizedLine(line: NormalizedPayoutLine) {
    if (!line.grossAmount && !line.netAmount) {
      return '缺少交易金額或撥款金額，無法回填實際手續費。';
    }

    if (!line.feeAmount && !(line.grossAmount && line.netAmount)) {
      return '缺少手續費欄位，且無法由交易金額與撥款金額反推。';
    }

    return null;
  }

  private async loadCandidatePayments(
    tx: Prisma.TransactionClient,
    entityId: string,
    rows: NormalizedPayoutLine[],
  ) {
    const payoutDates = rows
      .map((row) => row.payoutDate)
      .filter((value): value is Date => value instanceof Date);

    const minDate =
      payoutDates.length > 0
        ? new Date(
            Math.min(...payoutDates.map((date) => date.getTime())) -
              45 * 24 * 60 * 60 * 1000,
          )
        : undefined;
    const maxDate =
      payoutDates.length > 0
        ? new Date(
            Math.max(...payoutDates.map((date) => date.getTime())) +
              45 * 24 * 60 * 60 * 1000,
          )
        : undefined;

    return tx.payment.findMany({
      where: {
        entityId,
        channel: 'SHOPIFY',
        payoutDate:
          minDate && maxDate
            ? {
                gte: minDate,
                lte: maxDate,
              }
            : undefined,
      },
      include: {
        salesOrder: {
          select: {
            id: true,
            externalOrderId: true,
          },
        },
      },
      orderBy: {
        payoutDate: 'desc',
      },
    });
  }

  private findBestPaymentMatch(
    line: NormalizedPayoutLine,
    candidates: MatchCandidate[],
    reservedPaymentIds: Set<string>,
  ): MatchResult {
    const ranked = candidates
      .filter((candidate) => !reservedPaymentIds.has(candidate.id))
      .map((candidate) => ({
        candidate,
        ...this.scorePaymentMatch(line, candidate),
      }))
      .filter((result) => result.confidence > 0)
      .sort((left, right) => right.confidence - left.confidence);

    if (!ranked.length) {
      return {
        candidate: null,
        confidence: 0,
        message: '找不到可對應的 Shopify 收款紀錄。',
      };
    }

    const best = ranked[0];
    const runnerUp = ranked[1];

    if (best.confidence < 60) {
      return {
        candidate: null,
        confidence: best.confidence,
        message: '找到候選收款，但資訊不足以自動核實，請補充對帳欄位。',
      };
    }

    if (runnerUp && best.confidence - runnerUp.confidence < 10) {
      return {
        candidate: null,
        confidence: best.confidence,
        message: '同一列對到多筆相似收款，系統暫時保留給人工確認。',
      };
    }

    return {
      candidate: best.candidate,
      confidence: best.confidence,
      message: best.reasons.join('、'),
    };
  }

  private scorePaymentMatch(
    line: NormalizedPayoutLine,
    candidate: MatchCandidate,
  ) {
    let confidence = 0;
    const reasons: string[] = [];
    const metadata = this.extractMetadata(candidate.notes);

    if (
      line.providerPaymentId &&
      this.sameText(metadata.providerPaymentId, line.providerPaymentId)
    ) {
      confidence += 120;
      reasons.push('provider payment id 一致');
    }

    if (
      line.providerTradeNo &&
      this.sameText(metadata.providerTradeNo, line.providerTradeNo)
    ) {
      confidence += 105;
      reasons.push('provider trade no 一致');
    }

    if (
      line.authorizationCode &&
      this.sameText(metadata.authorization, line.authorizationCode)
    ) {
      confidence += 80;
      reasons.push('授權碼一致');
    }

    if (
      line.externalOrderId &&
      this.sameText(candidate.salesOrder?.externalOrderId, line.externalOrderId)
    ) {
      confidence += 95;
      reasons.push('Shopify 訂單編號一致');
    }

    if (line.gateway && this.sameText(metadata.gateway, line.gateway)) {
      confidence += 15;
      reasons.push('付款方式一致');
    }

    if (line.grossAmount) {
      const grossDelta = this.decimalDelta(
        candidate.amountGrossOriginal,
        line.grossAmount,
      );
      if (grossDelta === 0) {
        confidence += 20;
        reasons.push('交易金額一致');
      } else if (grossDelta <= 1) {
        confidence += 12;
        reasons.push('交易金額接近');
      }
    }

    if (line.netAmount) {
      const netDelta = this.decimalDelta(
        candidate.amountNetOriginal,
        line.netAmount,
      );
      if (netDelta === 0) {
        confidence += 16;
        reasons.push('撥款淨額一致');
      } else if (netDelta <= 1) {
        confidence += 10;
        reasons.push('撥款淨額接近');
      }
    }

    if (line.payoutDate) {
      const dateDelta = this.dateDistanceInDays(
        candidate.payoutDate,
        line.payoutDate,
      );
      if (dateDelta === 0) {
        confidence += 12;
        reasons.push('入帳日期一致');
      } else if (dateDelta <= 3) {
        confidence += 8;
        reasons.push('入帳日期接近');
      } else if (dateDelta <= 7) {
        confidence += 4;
      }
    }

    return { confidence, reasons };
  }

  private async applyActualPayoutToPayment(
    tx: Prisma.TransactionClient,
    batchId: string,
    line: NormalizedPayoutLine,
    payment: MatchCandidate,
  ) {
    const currency = payment.amountGrossCurrency || line.currency || 'TWD';
    const fxRate = new Decimal(payment.amountGrossFxRate || 1);
    const actualFee = line.feeAmount || new Decimal(0);
    const actualNet = line.netAmount || payment.amountNetOriginal;
    const zero = new Decimal(0);
    const keepShopifyPlatformFee = (payment.notes || '').includes(
      'feeSource=shopify.transaction.fee',
    );
    const notes = this.buildProviderPayoutNote(payment.notes, {
      provider: line.provider,
      batchId,
      rowIndex: line.rowIndex,
      gateway: line.gateway,
      externalOrderId: line.externalOrderId,
      providerPaymentId: line.providerPaymentId,
      providerTradeNo: line.providerTradeNo,
      authorizationCode: line.authorizationCode,
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        feePlatformOriginal: keepShopifyPlatformFee
          ? payment.feePlatformOriginal
          : zero,
        feePlatformBase: keepShopifyPlatformFee
          ? payment.feePlatformOriginal.mul(fxRate)
          : zero,
        feeGatewayOriginal: actualFee,
        feeGatewayCurrency: currency,
        feeGatewayFxRate: fxRate,
        feeGatewayBase: actualFee.mul(fxRate),
        amountNetOriginal: actualNet,
        amountNetCurrency: currency,
        amountNetFxRate: fxRate,
        amountNetBase: actualNet.mul(fxRate),
        reconciledFlag: true,
        notes,
      },
    });
  }

  private buildProviderPayoutNote(
    existingNotes: string | null | undefined,
    params: {
      provider: SupportedProvider;
      batchId: string;
      rowIndex: number;
      gateway: string | null;
      externalOrderId: string | null;
      providerPaymentId: string | null;
      providerTradeNo: string | null;
      authorizationCode: string | null;
    },
  ) {
    const parts = [
      `feeStatus=actual`,
      `feeSource=provider-payout:${params.provider}`,
      `batchId=${params.batchId}`,
      `rowIndex=${params.rowIndex}`,
    ];

    if (params.gateway) parts.push(`gateway=${params.gateway}`);
    if (params.externalOrderId)
      parts.push(`externalOrderId=${params.externalOrderId}`);
    if (params.providerPaymentId) {
      parts.push(`providerPaymentId=${params.providerPaymentId}`);
    }
    if (params.providerTradeNo) {
      parts.push(`providerTradeNo=${params.providerTradeNo}`);
    }
    if (params.authorizationCode) {
      parts.push(`authorization=${params.authorizationCode}`);
    }

    const payoutNote = `[provider-payout] ${parts.join('; ')}`;
    const preservedNotes = (existingNotes || '')
      .split('\n')
      .filter((line) => !line.startsWith('[provider-payout]'))
      .join('\n')
      .trim();

    return preservedNotes ? `${preservedNotes}\n${payoutNote}` : payoutNote;
  }

  private toLineWrite(
    batchId: string,
    line: NormalizedPayoutLine,
    result: {
      status: string;
      confidence: number;
      message: string;
      matchedPaymentId?: string | null;
      matchedSalesOrderId?: string | null;
    },
  ): Prisma.PayoutImportLineCreateManyInput {
    return {
      batchId,
      provider: line.provider,
      rowIndex: line.rowIndex,
      payoutDate: line.payoutDate,
      statementDate: line.statementDate,
      currency: line.currency,
      gateway: line.gateway,
      externalOrderId: line.externalOrderId,
      providerPaymentId: line.providerPaymentId,
      providerTradeNo: line.providerTradeNo,
      authorizationCode: line.authorizationCode,
      grossAmountOriginal: line.grossAmount,
      feeAmountOriginal: line.feeAmount,
      netAmountOriginal: line.netAmount,
      matchedPaymentId: result.matchedPaymentId || null,
      matchedSalesOrderId: result.matchedSalesOrderId || null,
      status: result.status,
      confidence: result.confidence,
      message: result.message,
      rawData: line.rawData as Prisma.InputJsonValue,
    };
  }

  private pickFieldValue(
    provider: SupportedProvider,
    row: ImportRow,
    field: string,
    mapping?: MappingConfig,
  ) {
    const aliases = this.resolveAliases(provider, field, mapping);
    const normalizedLookup = new Map(
      Object.entries(row).map(([key, value]) => [
        this.normalizeKey(key),
        value,
      ]),
    );

    for (const alias of aliases) {
      const value = normalizedLookup.get(this.normalizeKey(alias));
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }

    return null;
  }

  private resolveAliases(
    provider: SupportedProvider,
    field: string,
    mapping?: MappingConfig,
  ) {
    const custom = mapping?.[field];
    const customAliases = custom
      ? Array.isArray(custom)
        ? custom
        : [custom]
      : [];
    const providerAliases = PROVIDER_ALIASES[provider][field] || [];
    const commonAliases = COMMON_ALIASES[field] || [];
    return [...customAliases, ...providerAliases, ...commonAliases];
  }

  private parseDecimal(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (value instanceof Decimal) {
      return value;
    }

    const normalized = String(value)
      .replace(/[,\s$]/g, '')
      .trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return new Decimal(parsed).toDecimalPlaces(2);
  }

  private parseDate(value: unknown) {
    const text = this.toCleanString(value);
    if (!text) {
      return null;
    }

    const normalized = text.replace(/\./g, '-').replace(/\//g, '-');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toCleanString(value: unknown) {
    if (value === null || value === undefined) {
      return null;
    }

    const text = String(value).trim();
    return text || null;
  }

  private normalizeKey(value: string) {
    return value.replace(/[\s_\-()（）:/\\]/g, '').toLowerCase();
  }

  private sameText(left?: string | null, right?: string | null) {
    if (!left || !right) {
      return false;
    }

    return this.normalizeKey(left) === this.normalizeKey(right);
  }

  private decimalDelta(left: Prisma.Decimal, right: Decimal) {
    return Number(left.sub(right).abs().toDecimalPlaces(2).toString());
  }

  private dateDistanceInDays(left: Date, right: Date) {
    const ms = Math.abs(left.getTime() - right.getTime());
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  private extractMetadata(notes: string | null | undefined) {
    const metadata: Record<string, string> = {};

    for (const line of (notes || '').split('\n')) {
      const separator = line.indexOf('] ');
      if (separator < 0) {
        continue;
      }

      const rawPairs = line.slice(separator + 2).split(';');
      for (const pair of rawPairs) {
        const [key, ...rest] = pair.split('=');
        if (!key || !rest.length) {
          continue;
        }

        metadata[key.trim()] = rest.join('=').trim();
      }
    }

    return metadata;
  }

  private async assertEntityExists(entityId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true },
    });

    if (!entity) {
      throw new BadRequestException(`Entity not found: ${entityId}`);
    }
  }
}
