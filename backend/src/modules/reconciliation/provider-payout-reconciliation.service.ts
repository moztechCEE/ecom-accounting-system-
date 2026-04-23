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

type SupportedProvider = 'ecpay' | 'hitrust' | 'linepay';
type ImportRow = Record<string, string | number | boolean | null>;
type MappingConfig = Record<string, string | string[]>;
type MatchCandidate = Prisma.PaymentGetPayload<{
  include: {
    salesOrder: {
      select: {
        id: true;
        externalOrderId: true;
        orderDate: true;
      };
    };
  };
}>;

type NormalizedPayoutLine = {
  provider: SupportedProvider;
  rowIndex: number;
  payoutDate: Date | null;
  statementDate: Date | null;
  transactionDate: Date | null;
  feeRate: string | null;
  currency: string;
  gateway: string | null;
  payoutStatus: string | null;
  externalOrderId: string | null;
  providerPaymentId: string | null;
  providerTradeNo: string | null;
  authorizationCode: string | null;
  grossAmount: Decimal | null;
  feeAmount: Decimal | null;
  gatewayFeeAmount: Decimal | null;
  processingFeeAmount: Decimal | null;
  platformFeeAmount: Decimal | null;
  netAmount: Decimal | null;
  rawData: ImportRow;
};

type MatchResult = {
  candidate: MatchCandidate | null;
  confidence: number;
  message: string;
};

type PayoutJournalContext = {
  bankDepositAccountId: string;
  clearingAccountId: string;
  platformFeeAccountId: string;
  gatewayFeeAccountId: string;
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
  gatewayFeeAmount: [
    'gatewayFeeAmount',
    'gatewayFee',
    '金流手續費',
    '刷卡手續費',
    '信用卡手續費',
    '交易手續費',
    '手續費',
  ],
  processingFeeAmount: [
    'processingFeeAmount',
    'processingFee',
    '處理費',
    '處理手續費',
    '服務費',
  ],
  platformFeeAmount: [
    'platformFeeAmount',
    'platformFee',
    '平台手續費',
    '平台費',
    '通路手續費',
    '商城手續費',
  ],
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
  transactionDate: [
    'transactionDate',
    '交易日期',
    '付款日期',
    '交易時間',
    '付款時間',
    'paidAt',
  ],
  feeRate: ['feeRate', '手續費率', '手續費率(每筆)', '費率'],
  currency: ['currency', '幣別', 'Currency'],
  gateway: ['gateway', '付款方式', '支付方式', '收款方式', '交易方式'],
  payoutStatus: ['payoutStatus', '撥款狀態', '結算狀態', '入帳狀態', 'status'],
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
    gatewayFeeAmount: ['交易手續費', '金流手續費', '手續費'],
    processingFeeAmount: ['處理費', '服務費'],
    platformFeeAmount: ['平台手續費', '平台費'],
    payoutStatus: ['撥款狀態', '結算狀態', '入帳狀態'],
  },
  hitrust: {
    externalOrderId: ['訂單編號', 'OrderNo', '商店訂單編號'],
    providerPaymentId: ['交易序號', '交易編號', '支付單號'],
    providerTradeNo: ['TradeNo', '金流交易編號'],
  },
  linepay: {
    externalOrderId: [
      'orderId',
      'Order ID',
      '商家訂單編號',
      '訂單編號',
      '訂單號碼',
    ],
    providerPaymentId: [
      'transactionId',
      'Transaction ID',
      'LINE Pay 交易序號',
      'LINE Pay 交易編號',
      '交易序號',
    ],
    providerTradeNo: [
      'transactionId',
      'Transaction ID',
      'LINE Pay 交易序號',
      'LINE Pay 交易編號',
    ],
    grossAmount: ['amount', 'paymentAmount', '交易金額', '付款金額'],
    gatewayFeeAmount: ['fee', 'paymentFee', 'LINE Pay 手續費', '手續費'],
    netAmount: ['settlementAmount', 'depositAmount', '撥款金額', '實收金額'],
    payoutDate: ['settlementDate', 'depositDate', '撥款日期', '結算日期'],
    transactionDate: ['transactionDate', 'paidAt', '付款時間', '交易時間'],
    payoutStatus: ['settlementStatus', 'paymentStatus', '結算狀態', '付款狀態'],
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
      const journalContextCache = new Map<string, PayoutJournalContext>();
      const openPeriodCache = new Map<string, string | null>();
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
          userId,
          journalContextCache,
          openPeriodCache,
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
    }, {
      maxWait: 20_000,
      timeout: 120_000,
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
    const gatewayFeeAmount = this.parseDecimal(
      this.pickFieldValue(provider, row, 'gatewayFeeAmount', mapping),
    );
    const processingFeeAmount = this.parseDecimal(
      this.pickFieldValue(provider, row, 'processingFeeAmount', mapping),
    );
    const platformFeeAmount = this.parseDecimal(
      this.pickFieldValue(provider, row, 'platformFeeAmount', mapping),
    );
    let feeAmount = this.parseDecimal(
      this.pickFieldValue(provider, row, 'feeAmount', mapping),
    );
    let netAmount = this.parseDecimal(
      this.pickFieldValue(provider, row, 'netAmount', mapping),
    );

    const splitFeeTotal = [
      gatewayFeeAmount,
      processingFeeAmount,
      platformFeeAmount,
    ]
      .filter((value): value is Decimal => Boolean(value))
      .reduce((sum, value) => sum.add(value), new Decimal(0));

    if (!feeAmount && splitFeeTotal.greaterThan(0)) {
      feeAmount = splitFeeTotal.toDecimalPlaces(2);
    }

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
      transactionDate: this.parseDate(
        this.pickFieldValue(provider, row, 'transactionDate', mapping),
      ),
      feeRate: this.toCleanString(
        this.pickFieldValue(provider, row, 'feeRate', mapping),
      ),
      currency:
        this.toCleanString(
          this.pickFieldValue(provider, row, 'currency', mapping),
        ) || 'TWD',
      gateway: this.toCleanString(
        this.pickFieldValue(provider, row, 'gateway', mapping),
      ),
      payoutStatus: this.toCleanString(
        this.pickFieldValue(provider, row, 'payoutStatus', mapping),
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
      gatewayFeeAmount,
      processingFeeAmount,
      platformFeeAmount,
      netAmount,
      rawData: row,
    };
  }

  private validateNormalizedLine(line: NormalizedPayoutLine) {
    const hasMatchKey = Boolean(
      line.providerPaymentId || line.providerTradeNo || line.externalOrderId,
    );
    const hasAmountContext = Boolean(line.grossAmount || line.netAmount);

    if (!line.feeAmount && !(line.grossAmount && line.netAmount)) {
      return '缺少手續費欄位，且無法由交易金額與撥款金額反推。';
    }

    if (!hasAmountContext && !hasMatchKey) {
      return '缺少交易金額/撥款金額，且沒有可用的訂單或金流識別碼，無法回填實際手續費。';
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
        channel: {
          in: ['SHOPIFY', '1SHOP', 'SHOPLINE'],
        },
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
            orderDate: true,
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
        message: '找不到可對應的收款紀錄。',
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
    const inferredGrossAmount = this.inferGrossAmountFromFeeRate(line);

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
      reasons.push('訂單編號一致');
    }

    if (line.gateway && this.sameText(metadata.gateway, line.gateway)) {
      confidence += 15;
      reasons.push('付款方式一致');
    }

    if (line.grossAmount || inferredGrossAmount) {
      const expectedGross = line.grossAmount || inferredGrossAmount;
      const grossDelta = this.decimalDelta(
        candidate.amountGrossOriginal,
        expectedGross,
      );
      if (grossDelta === 0) {
        confidence += inferredGrossAmount ? 28 : 20;
        reasons.push(
          inferredGrossAmount ? '由費率反推交易金額一致' : '交易金額一致',
        );
      } else if (grossDelta <= 1) {
        confidence += inferredGrossAmount ? 18 : 12;
        reasons.push(
          inferredGrossAmount ? '由費率反推交易金額接近' : '交易金額接近',
        );
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

    if (line.transactionDate) {
      const minuteDelta = this.dateDistanceInMinutes(
        candidate.payoutDate,
        line.transactionDate,
      );
      if (minuteDelta <= 2) {
        confidence += 90;
        reasons.push('交易時間幾乎一致');
      } else if (minuteDelta <= 10) {
        confidence += 72;
        reasons.push('交易時間接近');
      } else if (minuteDelta <= 60) {
        confidence += 48;
        reasons.push('交易時間相近');
      } else if (minuteDelta <= 180) {
        confidence += 28;
        reasons.push('交易時間同日接近');
      }

      if (candidate.salesOrder?.orderDate) {
        const orderMinuteDelta = this.dateDistanceInMinutes(
          candidate.salesOrder.orderDate,
          line.transactionDate,
        );
        if (orderMinuteDelta <= 5) {
          confidence += 86;
          reasons.push('訂單成交時間幾乎一致');
        } else if (orderMinuteDelta <= 30) {
          confidence += 64;
          reasons.push('訂單成交時間接近');
        } else if (orderMinuteDelta <= 180) {
          confidence += 42;
          reasons.push('訂單成交時間相近');
        } else if (orderMinuteDelta <= 24 * 60) {
          confidence += 18;
          reasons.push('訂單成交日一致');
        }
      }
    }

    return { confidence, reasons };
  }

  private async applyActualPayoutToPayment(
    tx: Prisma.TransactionClient,
    batchId: string,
    line: NormalizedPayoutLine,
    payment: MatchCandidate,
    userId: string,
    journalContextCache: Map<string, PayoutJournalContext>,
    openPeriodCache: Map<string, string | null>,
  ) {
    const currency = payment.amountGrossCurrency || line.currency || 'TWD';
    const fxRate = new Decimal(payment.amountGrossFxRate || 1);
    const zero = new Decimal(0);
    const keepShopifyPlatformFee = (payment.notes || '').includes(
      'feeSource=shopify.transaction.fee',
    );
    const actualGross = (
      line.grossAmount || payment.amountGrossOriginal
    ).toDecimalPlaces(2);
    const hasSplitFee =
      Boolean(line.gatewayFeeAmount) ||
      Boolean(line.processingFeeAmount) ||
      Boolean(line.platformFeeAmount);
    const actualPlatformFee = line.platformFeeAmount
      ? line.platformFeeAmount.toDecimalPlaces(2)
      : keepShopifyPlatformFee
        ? payment.feePlatformOriginal
        : zero;
    const actualGatewayFee = hasSplitFee
      ? (line.gatewayFeeAmount || zero)
          .add(line.processingFeeAmount || zero)
          .toDecimalPlaces(2)
      : (line.feeAmount || zero).toDecimalPlaces(2);
    const actualNet = line.netAmount
      ? line.netAmount.toDecimalPlaces(2)
      : actualGross
          .sub(actualPlatformFee)
          .sub(actualGatewayFee)
          .toDecimalPlaces(2);
    const journalEntryId = await this.upsertPayoutJournalEntry(
      tx,
      payment,
      line,
      {
        grossAmount: actualGross,
        platformFeeAmount: actualPlatformFee,
        gatewayFeeAmount: actualGatewayFee,
        netAmount: actualNet,
        currency,
        fxRate,
      },
      userId,
      journalContextCache,
      openPeriodCache,
    );
    const notes = this.buildProviderPayoutNote(payment.notes, {
      provider: line.provider,
      batchId,
      rowIndex: line.rowIndex,
      gateway: line.gateway,
      payoutStatus: line.payoutStatus,
      externalOrderId: line.externalOrderId,
      providerPaymentId: line.providerPaymentId,
      providerTradeNo: line.providerTradeNo,
      authorizationCode: line.authorizationCode,
      gatewayFeeAmount: line.gatewayFeeAmount,
      processingFeeAmount: line.processingFeeAmount,
      platformFeeAmount: line.platformFeeAmount,
      journalEntryId,
      journalStatus: 'approved',
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        feePlatformOriginal: actualPlatformFee,
        feePlatformBase: actualPlatformFee.mul(fxRate),
        feeGatewayOriginal: actualGatewayFee,
        feeGatewayCurrency: currency,
        feeGatewayFxRate: fxRate,
        feeGatewayBase: actualGatewayFee.mul(fxRate),
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
      payoutStatus: string | null;
      externalOrderId: string | null;
      providerPaymentId: string | null;
      providerTradeNo: string | null;
      authorizationCode: string | null;
      gatewayFeeAmount: Decimal | null;
      processingFeeAmount: Decimal | null;
      platformFeeAmount: Decimal | null;
      journalEntryId: string | null;
      journalStatus: string | null;
    },
  ) {
    const parts = [
      `feeStatus=actual`,
      `feeSource=provider-payout:${params.provider}`,
      `batchId=${params.batchId}`,
      `rowIndex=${params.rowIndex}`,
    ];

    if (params.gateway) parts.push(`gateway=${params.gateway}`);
    if (params.payoutStatus) parts.push(`payoutStatus=${params.payoutStatus}`);
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
    if (params.gatewayFeeAmount) {
      parts.push(`gatewayFee=${params.gatewayFeeAmount.toFixed(2)}`);
    }
    if (params.processingFeeAmount) {
      parts.push(`processingFee=${params.processingFeeAmount.toFixed(2)}`);
    }
    if (params.platformFeeAmount) {
      parts.push(`platformFee=${params.platformFeeAmount.toFixed(2)}`);
    }
    if (params.journalEntryId) {
      parts.push(`journalEntryId=${params.journalEntryId}`);
    }
    if (params.journalStatus) {
      parts.push(`journalStatus=${params.journalStatus}`);
    }
    parts.push(`drBank=1113`);
    parts.push(`drPlatformFee=6131`);
    parts.push(`drGatewayFee=6134`);
    parts.push(`crClearing=1191`);

    const payoutNote = `[provider-payout] ${parts.join('; ')}`;
    const preservedNotes = (existingNotes || '')
      .split('\n')
      .filter((line) => !line.startsWith('[provider-payout]'))
      .join('\n')
      .trim();

    return preservedNotes ? `${preservedNotes}\n${payoutNote}` : payoutNote;
  }

  private async upsertPayoutJournalEntry(
    tx: Prisma.TransactionClient,
    payment: MatchCandidate,
    line: NormalizedPayoutLine,
    amounts: {
      grossAmount: Decimal;
      platformFeeAmount: Decimal;
      gatewayFeeAmount: Decimal;
      netAmount: Decimal;
      currency: string;
      fxRate: Decimal;
    },
    userId: string,
    journalContextCache: Map<string, PayoutJournalContext>,
    openPeriodCache: Map<string, string | null>,
  ) {
    const journalContext = await this.resolvePayoutJournalContext(
      tx,
      payment.entityId,
      journalContextCache,
    );
    const openPeriodId = await this.resolveOpenPeriodId(
      tx,
      payment.entityId,
      line.payoutDate || payment.payoutDate,
      openPeriodCache,
    );

    const sourceModule = 'reconciliation_payout';
    const sourceId = payment.id;
    const description = `金流撥款對帳 ${line.provider.toUpperCase()} ${payment.salesOrder?.externalOrderId || payment.id}`;
    const amountBase = (value: Decimal) =>
      value.mul(amounts.fxRate).toDecimalPlaces(2);
    const journalLines: Prisma.JournalLineCreateManyJournalEntryInput[] = [
      {
        accountId: journalContext.bankDepositAccountId,
        debit: amounts.netAmount,
        credit: new Decimal(0),
        currency: amounts.currency,
        fxRate: amounts.fxRate,
        amountBase: amountBase(amounts.netAmount),
        memo: `實際撥款淨額 ${line.provider.toUpperCase()}`,
      },
      ...(amounts.platformFeeAmount.greaterThan(0)
        ? [
            {
              accountId: journalContext.platformFeeAccountId,
              debit: amounts.platformFeeAmount,
              credit: new Decimal(0),
              currency: amounts.currency,
              fxRate: amounts.fxRate,
              amountBase: amountBase(amounts.platformFeeAmount),
              memo: '平台手續費',
            },
          ]
        : []),
      ...(amounts.gatewayFeeAmount.greaterThan(0)
        ? [
            {
              accountId: journalContext.gatewayFeeAccountId,
              debit: amounts.gatewayFeeAmount,
              credit: new Decimal(0),
              currency: amounts.currency,
              fxRate: amounts.fxRate,
              amountBase: amountBase(amounts.gatewayFeeAmount),
              memo: '金流手續費 / 處理費',
            },
          ]
        : []),
      {
        accountId: journalContext.clearingAccountId,
        debit: new Decimal(0),
        credit: amounts.grossAmount,
        currency: amounts.currency,
        fxRate: amounts.fxRate,
        amountBase: amountBase(amounts.grossAmount),
        memo: `沖銷應收帳款 ${payment.salesOrder?.externalOrderId || payment.id}`,
      },
    ];

    const existingJournal = await tx.journalEntry.findFirst({
      where: {
        sourceModule,
        sourceId,
      },
      select: {
        id: true,
      },
    });

    if (existingJournal) {
      await tx.journalLine.deleteMany({
        where: {
          journalEntryId: existingJournal.id,
        },
      });

      await tx.journalEntry.update({
        where: { id: existingJournal.id },
        data: {
          date: line.payoutDate || payment.payoutDate,
          description,
          periodId: openPeriodId,
          approvedBy: userId,
          approvedAt: new Date(),
        },
      });

      await tx.journalLine.createMany({
        data: journalLines.map((entry) => ({
          journalEntryId: existingJournal.id,
          ...entry,
        })),
      });

      return existingJournal.id;
    }

    const createdJournal = await tx.journalEntry.create({
      data: {
        entityId: payment.entityId,
        date: line.payoutDate || payment.payoutDate,
        description,
        sourceModule,
        sourceId,
        periodId: openPeriodId,
        createdBy: userId,
        approvedBy: userId,
        approvedAt: new Date(),
        journalLines: {
          create: journalLines,
        },
      },
      select: {
        id: true,
      },
    });

    return createdJournal.id;
  }

  private async resolvePayoutJournalContext(
    tx: Prisma.TransactionClient,
    entityId: string,
    cache: Map<string, PayoutJournalContext>,
  ) {
    const cached = cache.get(entityId);
    if (cached) {
      return cached;
    }

    const [
      bankDepositAccount,
      clearingAccount,
      platformFeeAccount,
      gatewayFeeAccount,
    ] = await Promise.all([
      tx.account.findUnique({
        where: {
          entityId_code: {
            entityId,
            code: '1113',
          },
        },
        select: { id: true },
      }),
      tx.account.findUnique({
        where: {
          entityId_code: {
            entityId,
            code: '1191',
          },
        },
        select: { id: true },
      }),
      tx.account.findUnique({
        where: {
          entityId_code: {
            entityId,
            code: '6131',
          },
        },
        select: { id: true },
      }),
      tx.account.findUnique({
        where: {
          entityId_code: {
            entityId,
            code: '6134',
          },
        },
        select: { id: true },
      }),
    ]);

    if (
      !bankDepositAccount ||
      !clearingAccount ||
      !platformFeeAccount ||
      !gatewayFeeAccount
    ) {
      throw new NotFoundException(
        '缺少撥款自動對帳所需會計科目（1113 / 1191 / 6131 / 6134）',
      );
    }

    const context = {
      bankDepositAccountId: bankDepositAccount.id,
      clearingAccountId: clearingAccount.id,
      platformFeeAccountId: platformFeeAccount.id,
      gatewayFeeAccountId: gatewayFeeAccount.id,
    };
    cache.set(entityId, context);
    return context;
  }

  private async resolveOpenPeriodId(
    tx: Prisma.TransactionClient,
    entityId: string,
    targetDate: Date,
    cache: Map<string, string | null>,
  ) {
    const cacheKey = `${entityId}:${targetDate.toISOString().slice(0, 10)}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) || null;
    }

    const openPeriod = await tx.period.findFirst({
      where: {
        entityId,
        status: 'open',
        startDate: { lte: targetDate },
        endDate: { gte: targetDate },
      },
      select: { id: true },
    });

    const periodId = openPeriod?.id || null;
    cache.set(cacheKey, periodId);
    return periodId;
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

  private inferGrossAmountFromFeeRate(line: NormalizedPayoutLine) {
    if (line.grossAmount || !line.feeAmount || !line.feeRate) {
      return null;
    }

    const rate = this.parsePercentRate(line.feeRate);
    if (!rate || rate.lte(0)) {
      return null;
    }

    return line.feeAmount.div(rate).toDecimalPlaces(2);
  }

  private parsePercentRate(value: string) {
    const normalized = value.replace(/[%\s]/g, '').trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return new Decimal(parsed).div(100);
  }

  private dateDistanceInDays(left: Date, right: Date) {
    const ms = Math.abs(left.getTime() - right.getTime());
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  private dateDistanceInMinutes(left: Date, right: Date) {
    const ms = Math.abs(left.getTime() - right.getTime());
    return Math.floor(ms / (60 * 1000));
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
