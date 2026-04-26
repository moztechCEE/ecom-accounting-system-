// @ts-nocheck
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ImportBankTransactionsDto } from './dto/import-bank-transactions.dto';
import { AutoMatchDto } from './dto/auto-match.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { ArService } from '../ar/ar.service';
import { ReportsService } from '../reports/reports.service';
import { ShopifyService } from '../integration/shopify/shopify.service';
import { OneShopService } from '../integration/one-shop/one-shop.service';
import { EcpayShopifyPayoutService } from './ecpay-shopify-payout.service';
import { SalesOrderService } from '../sales/services/sales-order.service';
import { LinePayService } from './line-pay.service';
import { ProviderPayoutReconciliationService } from './provider-payout-reconciliation.service';

/**
 * ReconciliationService
 * 銀行對帳服務（實戰版）
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly arService: ArService,
    private readonly reportsService: ReportsService,
    private readonly shopifyService: ShopifyService,
    private readonly oneShopService: OneShopService,
    private readonly ecpayShopifyPayoutService: EcpayShopifyPayoutService,
    private readonly salesOrderService: SalesOrderService,
    private readonly linePayService: LinePayService,
    private readonly providerPayoutService: ProviderPayoutReconciliationService,
  ) {}

  assertSchedulerToken(providedToken?: string | null) {
    const expected =
      this.configService.get<string>('RECONCILIATION_SYNC_JOB_TOKEN', '') ||
      this.configService.get<string>('ECPAY_SYNC_JOB_TOKEN', '') ||
      this.configService.get<string>('SHOPIFY_SYNC_JOB_TOKEN', '') ||
      '';

    if (!expected) {
      throw new UnauthorizedException(
        'RECONCILIATION_SYNC_JOB_TOKEN is not configured',
      );
    }

    if (!providedToken || providedToken !== expected) {
      throw new UnauthorizedException('Invalid scheduler token');
    }
  }

  async runCoreReconciliationJob(params: {
    entityId: string;
    startDate?: Date;
    endDate?: Date;
    userId?: string;
    syncShopify?: boolean;
    syncOneShop?: boolean;
    syncEcpayPayouts?: boolean;
    syncInvoices?: boolean;
    syncLinePayStatuses?: boolean;
    processLinePayRefundReversals?: boolean;
    autoClear?: boolean;
  }) {
    const entityId = params.entityId;
    const until = params.endDate || new Date();
    const since =
      params.startDate || new Date(until.getTime() - 3 * 24 * 60 * 60 * 1000);
    const steps: Array<{
      key: string;
      label: string;
      status: 'success' | 'skipped' | 'failed';
      result?: any;
      error?: string;
    }> = [];

    const runStep = async (
      key: string,
      label: string,
      enabled: boolean,
      task: () => Promise<any>,
    ) => {
      if (!enabled) {
        steps.push({ key, label, status: 'skipped', result: { skipped: true } });
        return null;
      }
      try {
        const result = await task();
        steps.push({ key, label, status: 'success', result });
        return result;
      } catch (error: any) {
        this.logger.warn(`${label} failed: ${error?.message || error}`);
        steps.push({
          key,
          label,
          status: 'failed',
          error: error?.message || String(error),
        });
        return null;
      }
    };

    await runStep(
      'shopify-sync',
      '同步 Shopify 訂單與交易',
      params.syncShopify !== false,
      () => this.shopifyService.autoSync({ entityId, since, until }),
    );

    await runStep(
      'oneshop-sync',
      '同步 1Shop 訂單與交易',
      params.syncOneShop !== false,
      () => this.oneShopService.autoSync({ entityId, since, until }),
    );

    await runStep(
      'ecpay-payout-sync',
      '同步綠界撥款（官網 / 團購）',
      params.syncEcpayPayouts !== false,
      () =>
        this.ecpayShopifyPayoutService.syncConfiguredMerchantPayouts(
          {
            entityId,
            beginDate: this.formatDate(since),
            endDate: this.formatDate(until),
            merchantKeys: ['shopify-main', 'groupbuy-main'],
          },
          params.userId,
        ),
    );

    await runStep(
      'ar-sync',
      '同步銷售訂單到 AR / 分錄',
      true,
      () =>
        this.arService.syncSalesReceivables(entityId, params.userId || '', {
          startDate: params.startDate,
          endDate: params.endDate,
          limit: 5000,
        }),
    );

    await runStep(
      'invoice-status-sync',
      '同步電子發票狀態',
      params.syncInvoices !== false,
      () =>
        this.salesOrderService.syncInvoiceStatusForOrders({
          entityId,
          startDate: since,
          endDate: until,
          limit: 300,
        }),
    );

    await runStep(
      'linepay-status-refresh',
      '刷新 LINE Pay 交易 / 退款狀態',
      params.syncLinePayStatuses !== false,
      () =>
        this.linePayService.refreshImportedPayoutStatuses({
          entityId,
          startDate: since,
          endDate: until,
          limit: 300,
        }),
    );

    await runStep(
      'linepay-refund-reversal',
      '處理 LINE Pay 退款沖銷',
      params.processLinePayRefundReversals === true,
      () =>
        this.providerPayoutService.processPendingLinePayRefundReversals({
          entityId,
          startDate: since,
          endDate: until,
          limit: 300,
          userId: params.userId || '',
        }),
    );

    await runStep(
      'auto-clear-ready-payments',
      '自動核銷可核銷款項',
      params.autoClear === true,
      () =>
        this.clearReadyPayments({
          entityId,
          startDate: since,
          endDate: until,
          userId: params.userId,
          limit: 300,
        }),
    );

    const center = await this.getReconciliationCenter(entityId, since, until, 500);
    const failedCount = steps.filter((step) => step.status === 'failed').length;

    return {
      success: failedCount === 0,
      entityId,
      range: {
        startDate: since.toISOString(),
        endDate: until.toISOString(),
      },
      steps,
      failedCount,
      summary: center.summary,
      priorityItems: center.priorityItems,
    };
  }

  async backfillOneShopGroupbuyClosure(params: {
    entityId: string;
    beginDate: Date;
    endDate: Date;
    orderWindowDays?: number;
    payoutWindowDays?: number;
    maxWindows?: number;
    invoiceBatchLimit?: number;
    autoClear?: boolean;
    userId?: string;
  }) {
    const entityId = params.entityId;
    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }

    const beginDate = new Date(params.beginDate);
    const endDate = new Date(params.endDate);

    if (Number.isNaN(beginDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('beginDate / endDate must be valid dates');
    }

    if (beginDate > endDate) {
      throw new BadRequestException('beginDate cannot be later than endDate');
    }

    const steps: Array<{
      key: string;
      label: string;
      status: 'success' | 'skipped' | 'failed';
      result?: any;
      error?: string;
    }> = [];

    const runStep = async (
      key: string,
      label: string,
      task: () => Promise<any>,
    ) => {
      try {
        const result = await task();
        steps.push({ key, label, status: 'success', result });
        return result;
      } catch (error: any) {
        this.logger.warn(`${label} failed: ${error?.message || error}`);
        steps.push({
          key,
          label,
          status: 'failed',
          error: error?.message || String(error),
        });
        return null;
      }
    };

    const oneShopWindowDays = Math.min(
      Math.max(params.orderWindowDays || 14, 1),
      31,
    );
    const payoutWindowDays = Math.min(
      Math.max(params.payoutWindowDays || 31, 1),
      31,
    );
    const invoiceWindowDays = Math.min(
      Math.max(params.orderWindowDays || 14, 1),
      31,
    );
    const invoiceBatchLimit = Math.min(
      Math.max(params.invoiceBatchLimit || 200, 1),
      500,
    );
    const syncUserId = await this.resolveSyncUserId(params.userId);

    const invoiceWindows = this.buildRollingWindows(
      beginDate,
      endDate,
      invoiceWindowDays,
    );
    const selectedInvoiceWindows =
      params.maxWindows && params.maxWindows > 0
        ? invoiceWindows.slice(0, params.maxWindows)
        : invoiceWindows;

    await runStep('oneshop-backfill', '補跑 1Shop 團購歷史訂單', () =>
      this.oneShopService.backfillHistory({
        entityId,
        beginDate,
        endDate,
        windowDays: oneShopWindowDays,
        maxWindows: params.maxWindows,
      }),
    );

    await runStep('groupbuy-ecpay-backfill', '補跑綠界 3150241 撥款', () =>
      this.ecpayShopifyPayoutService.backfillHistory(
        {
          entityId,
          beginDate: this.formatDate(beginDate),
          endDate: this.formatDate(endDate),
          merchantKeys: ['groupbuy-main'],
          windowDays: payoutWindowDays,
          maxWindows: params.maxWindows,
        },
        syncUserId,
      ),
    );

    await runStep('groupbuy-invoice-backfill', '補跑 1Shop 團購發票狀態', async () => {
      const windows: Array<{
        beginDate: string;
        endDate: string;
        result: any;
      }> = [];

      for (const window of selectedInvoiceWindows) {
        const result = await this.salesOrderService.syncInvoiceStatusForOrders({
          entityId,
          channelId: 'channel-oneshop',
          startDate: this.parseDate(window.beginDate),
          endDate: this.parseEndDate(window.endDate),
          limit: invoiceBatchLimit,
        });

        windows.push({
          beginDate: window.beginDate,
          endDate: window.endDate,
          result,
        });
      }

      return {
        requestedWindows: selectedInvoiceWindows.length,
        windows,
      };
    });

    await runStep('groupbuy-ar-sync', '同步 1Shop 團購應收 / 分錄', () =>
      this.arService.syncSalesReceivables(entityId, syncUserId, {
        startDate: beginDate,
        endDate,
        limit: 5000,
      }),
    );

    if (params.autoClear === true) {
      await runStep('groupbuy-auto-clear', '核銷可核銷團購款項', () =>
        this.clearReadyPayments({
          entityId,
          startDate: beginDate,
          endDate,
          limit: 500,
          userId: syncUserId,
        }),
      );
    } else {
      steps.push({
        key: 'groupbuy-auto-clear',
        label: '核銷可核銷團購款項',
        status: 'skipped',
        result: { skipped: true },
      });
    }

    const audit = await this.reportsService.getDataCompletenessAudit(
      entityId,
      beginDate,
      endDate,
    );
    const groupbuyChannel =
      audit.channelBreakdown.find((item) => item.channelCode === '1SHOP') || null;

    return {
      success: !steps.some((step) => step.status === 'failed'),
      entityId,
      range: {
        beginDate: beginDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      steps,
      postAudit: {
        generatedAt: audit.generatedAt,
        groupbuyChannel,
      },
    };
  }

  async runLinePayClosurePass(params: {
    entityId: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    syncInvoices?: boolean;
    processRefundReversals?: boolean;
    autoClear?: boolean;
    userId?: string;
  }) {
    const entityId = params.entityId;
    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }

    const until = params.endDate || new Date();
    const since =
      params.startDate ||
      new Date(until.getTime() - 31 * 24 * 60 * 60 * 1000);
    const limit = Math.min(Math.max(params.limit || 300, 1), 500);
    const syncUserId = await this.resolveSyncUserId(params.userId);
    const steps: Array<{
      key: string;
      label: string;
      status: 'success' | 'skipped' | 'failed';
      result?: any;
      error?: string;
    }> = [];

    const runStep = async (
      key: string,
      label: string,
      enabled: boolean,
      task: () => Promise<any>,
    ) => {
      if (!enabled) {
        steps.push({ key, label, status: 'skipped', result: { skipped: true } });
        return null;
      }

      try {
        const result = await task();
        steps.push({ key, label, status: 'success', result });
        return result;
      } catch (error: any) {
        this.logger.warn(`${label} failed: ${error?.message || error}`);
        steps.push({
          key,
          label,
          status: 'failed',
          error: error?.message || String(error),
        });
        return null;
      }
    };

    const refreshResult = await runStep(
      'linepay-status-refresh',
      '刷新 LINE Pay 交易 / 退款狀態',
      true,
      () =>
        this.linePayService.refreshImportedPayoutStatuses({
          entityId,
          startDate: since,
          endDate: until,
          limit,
        }),
    );

    const reversalResult = await runStep(
      'linepay-refund-reversal',
      '處理 LINE Pay 退款沖銷',
      params.processRefundReversals === true,
      () =>
        this.providerPayoutService.processPendingLinePayRefundReversals({
          entityId,
          startDate: since,
          endDate: until,
          limit,
          userId: syncUserId,
        }),
    );

    await runStep(
      'linepay-ar-sync',
      '同步 LINE Pay 關聯訂單到 AR / 分錄',
      true,
      () =>
        this.arService.syncSalesReceivables(entityId, syncUserId, {
          startDate: since,
          endDate: until,
          limit: 5000,
        }),
    );

    await runStep(
      'linepay-invoice-sync',
      '同步 LINE Pay 關聯訂單發票狀態',
      params.syncInvoices !== false,
      () =>
        this.salesOrderService.syncInvoiceStatusForOrders({
          entityId,
          startDate: since,
          endDate: until,
          limit,
        }),
    );

    await runStep(
      'linepay-auto-clear',
      '核銷可核銷 LINE Pay 款項',
      params.autoClear === true,
      () =>
        this.clearReadyPayments({
          entityId,
          startDate: since,
          endDate: until,
          limit: 300,
          userId: syncUserId,
        }),
    );

    const center = await this.getReconciliationCenter(entityId, since, until, 300);

    return {
      success: !steps.some((step) => step.status === 'failed'),
      entityId,
      range: {
        startDate: since.toISOString(),
        endDate: until.toISOString(),
      },
      steps,
      failedCount: steps.filter((step) => step.status === 'failed').length,
      summary: center.summary,
      linePay: {
        checkedCount: refreshResult?.checkedCount || 0,
        refundCandidateCount: refreshResult?.refundCandidateCount || 0,
        reversedCount: reversalResult?.reversed || 0,
        unmatchedRefundCount: reversalResult?.unmatched || 0,
        skippedRefundCount: reversalResult?.skipped || 0,
      },
    };
  }

  async clearReadyPayments(params: {
    entityId: string;
    startDate?: Date;
    endDate?: Date;
    userId?: string;
    limit?: number;
    dryRun?: boolean;
  }) {
    const entityId = params.entityId;
    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }

    const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
    const payoutDateFilter = this.buildDateFilter(params.startDate, params.endDate);
    const userId = params.dryRun
      ? params.userId || 'dry-run'
      : await this.resolveSyncUserId(params.userId);

    const payments = await this.prisma.payment.findMany({
      where: {
        entityId,
        ...(payoutDateFilter ? { payoutDate: payoutDateFilter } : {}),
        status: { in: ['completed', 'success'] },
        amountGrossOriginal: { gt: 0 },
        OR: [
          { reconciledFlag: true },
          { notes: { contains: 'feeStatus=actual' } },
          { notes: { contains: 'feeSource=provider-payout' } },
        ],
      },
      orderBy: { payoutDate: 'asc' },
      take: limit,
      include: {
        salesOrder: {
          include: {
            payments: {
              select: {
                id: true,
                status: true,
                amountGrossOriginal: true,
                feeGatewayOriginal: true,
                feePlatformOriginal: true,
                amountNetOriginal: true,
                reconciledFlag: true,
                notes: true,
              },
            },
            invoices: {
              orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
              take: 1,
            },
          },
        },
      },
    });

    const results: Array<{
      paymentId: string;
      orderId: string | null;
      externalOrderId: string | null;
      status: 'cleared' | 'skipped' | 'failed' | 'dry_run';
      reason?: string;
      journalEntryId?: string | null;
    }> = [];
    const journalContextCache = new Map<string, any>();
    const openPeriodCache = new Map<string, { periodId: string | null; blockedReason: string | null }>();

    for (const payment of payments) {
      const order = payment.salesOrder;
      const existingJournal = await this.prisma.journalEntry.findFirst({
        where: {
          sourceModule: 'reconciliation_payout',
          sourceId: payment.id,
        },
        select: { id: true },
      });

      const grossAmount = new Decimal(payment.amountGrossOriginal || 0);
      const orderGross = new Decimal(order?.totalGrossOriginal || 0);
      const gatewayFee = new Decimal(payment.feeGatewayOriginal || 0);
      const platformFee = new Decimal(payment.feePlatformOriginal || 0);
      const totalFee = gatewayFee.plus(platformFee);
      const netAmount = new Decimal(payment.amountNetOriginal || 0);
      const hasActualFee =
        payment.reconciledFlag ||
        (payment.notes || '').includes('feeStatus=actual') ||
        (payment.notes || '').includes('feeSource=provider-payout');
      const hasInvoice =
        Boolean(order?.hasInvoice) ||
        Boolean(order?.invoiceId) ||
        Boolean(order?.invoices?.[0]?.invoiceNumber);
      const orderPayments = (order?.payments || []).filter((item) =>
        ['completed', 'success'].includes(item.status),
      );
      const orderPaymentGross = orderPayments.reduce(
        (sum, item) => sum.plus(new Decimal(item.amountGrossOriginal || 0)),
        new Decimal(0),
      );
      const orderPaymentCount = orderPayments.length;
      const orderFullyPaidByPayments =
        order && orderPaymentGross.minus(orderGross).abs().lessThanOrEqualTo(1);
      const allOrderPaymentsHaveActualFees =
        orderPaymentCount > 0 &&
        orderPayments.every((item) =>
          this.paymentHasActualFeeTelemetry({
            reconciledFlag: item.reconciledFlag,
            notes: item.notes,
          }),
        );
      const singlePaymentMatches =
        order && grossAmount.minus(orderGross).abs().lessThanOrEqualTo(1);
      const amountMatches =
        singlePaymentMatches ||
        (orderPaymentCount > 1 &&
          orderFullyPaidByPayments &&
          allOrderPaymentsHaveActualFees);

      const baseResult = {
        paymentId: payment.id,
        orderId: order?.id || null,
        externalOrderId: order?.externalOrderId || null,
      };

      if (existingJournal) {
        results.push({
          ...baseResult,
          status: 'skipped',
          reason: 'already_has_reconciliation_journal',
          journalEntryId: existingJournal.id,
        });
        continue;
      }
      if (!order) {
        results.push({ ...baseResult, status: 'skipped', reason: 'missing_order' });
        continue;
      }
      if (['cancelled', 'refunded'].includes((order.status || '').toLowerCase())) {
        results.push({
          ...baseResult,
          status: 'skipped',
          reason: 'refund_or_cancelled_order_requires_reversal',
        });
        continue;
      }
      if (!hasInvoice) {
        results.push({ ...baseResult, status: 'skipped', reason: 'missing_invoice' });
        continue;
      }
      if (!amountMatches) {
        const reason =
          orderPaymentCount > 1 && orderPaymentGross.lessThan(orderGross)
            ? 'partial_payment_waiting_remaining'
            : 'amount_mismatch';
        results.push({ ...baseResult, status: 'skipped', reason });
        continue;
      }
      if (!hasActualFee || (orderPaymentCount > 1 && !allOrderPaymentsHaveActualFees)) {
        results.push({ ...baseResult, status: 'skipped', reason: 'missing_actual_fee' });
        continue;
      }
      if (netAmount.lessThan(0) || grossAmount.lessThanOrEqualTo(0)) {
        results.push({ ...baseResult, status: 'skipped', reason: 'invalid_amount' });
        continue;
      }
      if (netAmount.plus(gatewayFee).plus(platformFee).minus(grossAmount).abs().greaterThan(1)) {
        results.push({
          ...baseResult,
          status: 'skipped',
          reason: 'net_fee_gross_mismatch',
        });
        continue;
      }
      const periodProbe = await this.resolveEditablePeriod(
        this.prisma as any,
        entityId,
        payment.payoutDate,
        openPeriodCache,
      );
      if (periodProbe.blockedReason) {
        results.push({
          ...baseResult,
          status: 'skipped',
          reason: periodProbe.blockedReason,
        });
        continue;
      }

      if (params.dryRun) {
        results.push({ ...baseResult, status: 'dry_run', reason: 'ready_to_clear' });
        continue;
      }

      try {
        const journalEntryId = await this.prisma.$transaction(async (tx) => {
          const journalContext = await this.resolvePayoutJournalContext(
            tx,
            entityId,
            journalContextCache,
          );
          const period = await this.resolveEditablePeriod(
            tx,
            entityId,
            payment.payoutDate,
            openPeriodCache,
          );
          if (period.blockedReason) {
            throw new BadRequestException(period.blockedReason);
          }
          const journalId = await this.upsertAutoClearingJournalEntry(tx, {
            payment,
            order,
            userId,
            periodId: period.periodId,
            journalContext,
            grossAmount,
            netAmount,
            gatewayFee,
            platformFee,
          });

          await tx.payment.update({
            where: { id: payment.id },
            data: {
              reconciledFlag: true,
              notes: this.buildAutoClearNote(payment.notes, {
                journalEntryId: journalId,
                gatewayFee,
                platformFee,
                totalFee,
              }),
            },
          });

          return journalId;
        });

        results.push({
          ...baseResult,
          status: 'cleared',
          journalEntryId,
        });
      } catch (error: any) {
        this.logger.warn(
          `Auto clear failed for payment ${payment.id}: ${error?.message || error}`,
        );
        results.push({
          ...baseResult,
          status: 'failed',
          reason: error?.message || String(error),
        });
      }
    }

    const countByStatus = results.reduce(
      (acc, result) => {
        acc[result.status] = (acc[result.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const reasonSummary = results.reduce(
      (acc, result) => {
        if (result.status === 'cleared') return acc;
        const reason = result.reason || 'unknown';
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const topReasons = Object.entries(reasonSummary)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      entityId,
      dryRun: Boolean(params.dryRun),
      scanned: payments.length,
      cleared: countByStatus.cleared || 0,
      skipped: countByStatus.skipped || 0,
      failed: countByStatus.failed || 0,
      ready: countByStatus.dry_run || 0,
      reasonSummary,
      topReasons,
      results,
    };
  }

  async getReconciliationCenter(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
    limit?: number,
  ) {
    const normalizedLimit = Math.min(Math.max(Number(limit || 300), 20), 500);
    const [receivables, audit] = await Promise.all([
      this.arService.getReceivableMonitor(entityId, undefined, startDate, endDate),
      this.reportsService.getOrderReconciliationAudit(
        entityId,
        startDate,
        endDate,
        normalizedLimit,
      ),
    ]);

    const auditMap = new Map(
      (audit.items || []).map((item) => [item.orderId, item]),
    );
    const items = (receivables.items || []).map((item) =>
      this.classifyReconciliationQueueItem(item, auditMap.get(item.orderId)),
    );

    const buckets = {
      pending_payout: this.emptyCenterBucket('pending_payout', '待撥款'),
      ready_to_clear: this.emptyCenterBucket('ready_to_clear', '可核銷'),
      cleared: this.emptyCenterBucket('cleared', '已核銷'),
      exceptions: this.emptyCenterBucket('exceptions', '異常'),
    };

    for (const item of items) {
      const bucket = buckets[item.bucket] || buckets.exceptions;
      bucket.count += 1;
      bucket.grossAmount += item.grossAmount;
      bucket.paidAmount += item.paidAmount;
      bucket.netAmount += item.netAmount;
      bucket.outstandingAmount += item.outstandingAmount;
      bucket.feeTotal += item.feeTotal;
      if (bucket.items.length < normalizedLimit) {
        bucket.items.push(item);
      }
    }

    const totalCount = items.length;
    const clearedCount = buckets.cleared.count;
    const summary = {
      totalCount,
      pendingPayoutCount: buckets.pending_payout.count,
      readyToClearCount: buckets.ready_to_clear.count,
      clearedCount,
      exceptionCount: buckets.exceptions.count,
      grossAmount: this.sumCenterItems(items, 'grossAmount'),
      paidAmount: this.sumCenterItems(items, 'paidAmount'),
      netAmount: this.sumCenterItems(items, 'netAmount'),
      outstandingAmount: this.sumCenterItems(items, 'outstandingAmount'),
      pendingPayoutAmount: buckets.pending_payout.outstandingAmount,
      exceptionAmount: buckets.exceptions.outstandingAmount,
      feeTotal: this.sumCenterItems(items, 'feeTotal'),
      completionRate: totalCount ? Math.round((clearedCount / totalCount) * 100) : 0,
      lastGeneratedAt: new Date().toISOString(),
    };

    const priorityItems = items
      .filter((item) => item.bucket === 'exceptions')
      .sort((left, right) => {
        const severityScore = { critical: 3, warning: 2, healthy: 1 };
        return (
          (severityScore[right.severity] || 0) -
            (severityScore[left.severity] || 0) ||
          right.outstandingAmount - left.outstandingAmount
        );
      })
      .slice(0, 12);

    return {
      entityId,
      range: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      summary,
      buckets,
      priorityItems,
      rules: [
        {
          key: 'orders-create-ar',
          label: '訂單先形成應收',
          description: '平台訂單代表應收，不代表現金已入帳。',
        },
        {
          key: 'ecpay-payout-final-cash',
          label: '綠界撥款才是實收依據',
          description:
            '信用卡、超商取貨付款、貨到付款都要等撥款資料回填後才能確認淨入帳。',
        },
        {
          key: 'fee-invoice-close-loop',
          label: '手續費與發票要閉環',
          description:
            '每筆撥款需核對金流手續費、平台費、物流費與發票狀態，完整後才能核銷。',
        },
      ],
    };
  }

  private emptyCenterBucket(key: string, label: string) {
    return {
      key,
      label,
      count: 0,
      grossAmount: 0,
      paidAmount: 0,
      netAmount: 0,
      outstandingAmount: 0,
      feeTotal: 0,
      items: [],
    };
  }

  private classifyReconciliationQueueItem(item: any, auditItem?: any) {
    const hasException =
      auditItem?.severity === 'critical' ||
      auditItem?.severity === 'warning' ||
      (item.warningCodes || []).some((code) =>
        [
          'missing_fee',
          'missing_journal',
          'invoice_pending',
          'invoice_issued_unposted',
          'invoice_issued_unpaid',
          'overdue_receivable',
        ].includes(code),
      );

    let bucket = 'pending_payout';
    let reason = item.settlementDiagnostic || '等待綠界或平台撥款資料回填。';
    let nextAction = '等待下一次自動同步，或手動匯入綠界撥款資料。';

    if (
      item.reconciledFlag &&
      item.accountingPosted &&
      item.invoiceNumber &&
      item.feeStatus === 'actual' &&
      Number(item.outstandingAmount || 0) <= 0
    ) {
      bucket = 'cleared';
      reason = '訂單、撥款、手續費、發票與分錄已對齊。';
      nextAction = '不需處理。';
    } else if (hasException) {
      bucket = 'exceptions';
      reason =
        auditItem?.anomalyMessages?.[0] ||
        (item.warningCodes || []).join('、') ||
        '這筆訂單有資料缺口，需要人工確認。';
      nextAction =
        auditItem?.recommendation ||
        '先補綠界撥款/手續費或發票狀態，再重新同步。';
    } else if (Number(item.paidAmount || 0) > 0 || item.reconciledFlag) {
      bucket = 'ready_to_clear';
      reason = '已看到收款或撥款資料，可以進入核銷檢查。';
      nextAction = '確認手續費、發票與分錄後核銷。';
    }

    return {
      key: item.orderId,
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      customerName: item.customerName,
      sourceLabel: item.sourceLabel,
      sourceBrand: item.sourceBrand,
      channelCode: item.channelCode,
      orderDate: item.orderDate,
      dueDate: item.dueDate,
      bucket,
      bucketLabel:
        bucket === 'pending_payout'
          ? '待撥款'
          : bucket === 'ready_to_clear'
            ? '可核銷'
            : bucket === 'cleared'
              ? '已核銷'
              : '異常',
      grossAmount: Number(item.grossAmount || 0),
      paidAmount: Number(item.paidAmount || 0),
      netAmount: Number(item.netAmount || 0),
      feeTotal: Number(item.feeTotal || 0),
      gatewayFeeAmount: Number(item.gatewayFeeAmount || 0),
      platformFeeAmount: Number(item.platformFeeAmount || 0),
      outstandingAmount: Number(item.outstandingAmount || 0),
      invoiceNumber: item.invoiceNumber || null,
      invoiceStatus: item.invoiceStatus || null,
      feeStatus: item.feeStatus || 'unavailable',
      feeSource: item.feeSource || null,
      reconciledFlag: Boolean(item.reconciledFlag),
      accountingPosted: Boolean(item.accountingPosted),
      settlementPhase: item.settlementPhase || null,
      settlementPhaseLabel: item.settlementPhaseLabel || null,
      collectionOwnerLabel: item.collectionOwnerLabel || null,
      severity: bucket === 'exceptions' ? auditItem?.severity || 'warning' : 'healthy',
      reason,
      nextAction,
      anomalyCodes: auditItem?.anomalyCodes || item.warningCodes || [],
      anomalyMessages: auditItem?.anomalyMessages || [],
      providerTradeNo: auditItem?.providerTradeNo || null,
      providerPaymentId: auditItem?.providerPaymentId || null,
    };
  }

  private sumCenterItems(items: any[], field: string) {
    return items.reduce((sum, item) => sum + Number(item[field] || 0), 0);
  }

  private formatDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 匯入銀行交易明細
   */
  async importBankTransactions(dto: ImportBankTransactionsDto, userId: string) {
    this.logger.log(
      `匯入銀行交易 - 來源: ${dto.source}, 筆數: ${dto.transactions.length}`,
    );

    // 建立匯入批次
    const batch = await this.prisma.bankImportBatch.create({
      data: {
        entityId: dto.entityId,
        source: dto.source,
        importedBy: userId,
        fileName: dto.fileName || null,
        recordCount: dto.transactions.length,
        notes: dto.notes || null,
      },
    });

    // 批次寫入銀行交易
    const bankTransactions = dto.transactions.map((tx) => ({
      bankAccountId: dto.bankAccountId,
      batchId: batch.id,
      txnDate: new Date(tx.transactionDate),
      valueDate: new Date(tx.transactionDate),
      amountOriginal: new Decimal(tx.amount),
      amountCurrency: tx.currency || 'TWD',
      amountFxRate: new Decimal(tx.fxRate || 1),
      amountBase: new Decimal(tx.amount).mul(new Decimal(tx.fxRate || 1)),
      descriptionRaw: tx.description,
      referenceNo: tx.referenceNo || null,
      virtualAccountNo: tx.virtualAccount || null,
      reconcileStatus: 'unmatched',
    }));

    await this.prisma.bankTransaction.createMany({
      data: bankTransactions,
    });

    this.logger.log(`匯入完成 - BatchID: ${batch.id}`);

    return {
      success: true,
      batchId: batch.id,
      recordCount: dto.transactions.length,
    };
  }

  /**
   * 自動匹配銀行交易
   */
  async autoMatchTransactions(batchId: string, config?: AutoMatchDto) {
    this.logger.log(`自動對帳 - BatchID: ${batchId}`);

    const dateTolerance = config?.dateTolerance || 1;
    const amountTolerance = config?.amountTolerance || 0;

    // 取得該批次的未匹配交易
    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        batchId,
        reconcileStatus: 'unmatched',
      },
    });

    let matchedCount = 0;
    let fuzzyMatchedCount = 0;

    for (const tx of transactions) {
      // 嘗試精準匹配 - 金額相同且日期接近的 Payment
      const exactMatch = await this.prisma.payment.findFirst({
        where: {
          amountOriginal: tx.amountOriginal,
          paymentDate: {
            gte: new Date(
              tx.txnDate.getTime() - dateTolerance * 24 * 60 * 60 * 1000,
            ),
            lte: new Date(
              tx.txnDate.getTime() + dateTolerance * 24 * 60 * 60 * 1000,
            ),
          },
        },
      });

      if (exactMatch) {
        await this.createReconciliationResult(
          tx.id,
          'payment',
          exactMatch.id,
          100,
          'exact_amount',
        );
        await this.prisma.bankTransaction.update({
          where: { id: tx.id },
          data: {
            reconcileStatus: 'matched',
            matchedType: 'payment',
            matchedId: exactMatch.id,
          },
        });
        matchedCount++;
        continue;
      }

      // 模糊匹配 - 檢查描述是否包含訂單編號
      if (config?.useFuzzyMatch) {
        const orderIdMatch = tx.descriptionRaw.match(/order-[a-z0-9-]+/i);
        if (orderIdMatch) {
          const orderId = orderIdMatch[0];
          const order = await this.prisma.salesOrder.findFirst({
            where: { id: orderId },
          });

          if (order) {
            await this.createReconciliationResult(
              tx.id,
              'sales_order',
              order.id,
              70,
              'keyword',
            );
            await this.prisma.bankTransaction.update({
              where: { id: tx.id },
              data: {
                reconcileStatus: 'matched',
                matchedType: 'sales_order',
                matchedId: order.id,
              },
            });
            fuzzyMatchedCount++;
          }
        }
      }
    }

    this.logger.log(
      `對帳完成 - 精準: ${matchedCount}, 模糊: ${fuzzyMatchedCount}`,
    );

    return {
      success: true,
      totalTransactions: transactions.length,
      exactMatched: matchedCount,
      fuzzyMatched: fuzzyMatchedCount,
      unmatched: transactions.length - matchedCount - fuzzyMatchedCount,
    };
  }

  /**
   * 取得待對帳項目
   */
  async getPendingReconciliation(entityId: string) {
    const pendingTransactions = await this.prisma.bankTransaction.findMany({
      where: {
        bankAccount: {
          entityId,
        },
        reconcileStatus: 'unmatched',
      },
      include: {
        bankAccount: true,
        importBatch: true,
      },
      orderBy: {
        txnDate: 'desc',
      },
      take: 100,
    });

    return pendingTransactions;
  }

  /**
   * 手動對帳
   */
  async manualMatch(
    bankTransactionId: string,
    matchedType: string,
    matchedId: string,
    userId: string,
  ) {
    this.logger.log(
      `手動對帳 - 銀行交易: ${bankTransactionId}, 匹配: ${matchedType}/${matchedId}`,
    );

    await this.prisma.$transaction(async (tx) => {
      await this.createReconciliationResult(
        bankTransactionId,
        matchedType,
        matchedId,
        100,
        'manual',
      );

      await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: {
          reconcileStatus: 'matched',
          matchedType,
          matchedId,
        },
      });
    });

    return { success: true };
  }

  /**
   * 取消對帳
   */
  async unmatch(bankTransactionId: string, userId: string) {
    this.logger.log(`取消對帳 - 銀行交易: ${bankTransactionId}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.reconciliationResult.deleteMany({
        where: { bankTransactionId },
      });

      await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: {
          reconcileStatus: 'unmatched',
          matchedType: null,
          matchedId: null,
        },
      });
    });

    return { success: true };
  }

  private buildDateFilter(startDate?: Date, endDate?: Date) {
    if (!startDate && !endDate) {
      return null;
    }
    return {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    };
  }

  private buildRollingWindows(begin: Date, end: Date, windowDays: number) {
    const windows: Array<{ beginDate: string; endDate: string }> = [];
    const cursor = new Date(begin);

    while (cursor <= end) {
      const windowStart = new Date(cursor);
      const windowEnd = new Date(cursor);
      windowEnd.setDate(windowEnd.getDate() + windowDays - 1);
      if (windowEnd > end) {
        windowEnd.setTime(end.getTime());
      }

      windows.push({
        beginDate: this.formatDate(windowStart),
        endDate: this.formatDate(windowEnd),
      });

      cursor.setTime(windowEnd.getTime());
      cursor.setDate(cursor.getDate() + 1);
    }

    return windows;
  }

  private parseDate(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private parseEndDate(value: string) {
    return new Date(`${value}T23:59:59.999Z`);
  }

  private async resolveSyncUserId(preferredUserId?: string | null) {
    if (preferredUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: preferredUserId },
        select: { id: true },
      });
      if (user) {
        return user.id;
      }
    }

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
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!fallbackUser) {
      throw new InternalServerErrorException(
        '找不到可用來建立自動核銷分錄的系統使用者。',
      );
    }

    return fallbackUser.id;
  }

  private async resolvePayoutJournalContext(
    tx: Prisma.TransactionClient,
    entityId: string,
    cache: Map<string, any>,
  ) {
    const cached = cache.get(entityId);
    if (cached) {
      return cached;
    }

    const [bankDepositAccount, clearingAccount, platformFeeAccount, gatewayFeeAccount] =
      await Promise.all([
        tx.account.findUnique({
          where: { entityId_code: { entityId, code: '1113' } },
          select: { id: true },
        }),
        tx.account.findUnique({
          where: { entityId_code: { entityId, code: '1191' } },
          select: { id: true },
        }),
        tx.account.findUnique({
          where: { entityId_code: { entityId, code: '6131' } },
          select: { id: true },
        }),
        tx.account.findUnique({
          where: { entityId_code: { entityId, code: '6134' } },
          select: { id: true },
        }),
      ]);

    if (!bankDepositAccount || !clearingAccount || !platformFeeAccount || !gatewayFeeAccount) {
      throw new NotFoundException(
        '缺少自動核銷所需會計科目（1113 / 1191 / 6131 / 6134）',
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

  private paymentHasActualFeeTelemetry(payment: {
    reconciledFlag?: boolean | null;
    notes?: string | null;
  }) {
    const notes = payment.notes || '';
    return (
      Boolean(payment.reconciledFlag) ||
      notes.includes('feeStatus=actual') ||
      notes.includes('feeSource=provider-payout') ||
      notes.includes('[auto-clear]')
    );
  }

  private async resolveEditablePeriod(
    tx: Prisma.TransactionClient,
    entityId: string,
    targetDate: Date,
    cache: Map<string, { periodId: string | null; blockedReason: string | null }>,
  ) {
    const cacheKey = `${entityId}:${targetDate.toISOString().slice(0, 10)}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }

    const period = await tx.period.findFirst({
      where: {
        entityId,
        startDate: { lte: targetDate },
        endDate: { gte: targetDate },
      },
      orderBy: { startDate: 'desc' },
      select: { id: true, status: true, name: true },
    });

    const result = !period
      ? {
          periodId: null,
          blockedReason: null,
        }
      : period.status === 'open'
        ? {
            periodId: period.id,
            blockedReason: null,
          }
        : {
            periodId: period.id,
            blockedReason: `period_${period.status}:${period.name}`,
          };

    cache.set(cacheKey, result);
    return result;
  }

  private async upsertAutoClearingJournalEntry(
    tx: Prisma.TransactionClient,
    params: {
      payment: any;
      order: any;
      userId: string;
      periodId: string | null;
      journalContext: any;
      grossAmount: Decimal;
      netAmount: Decimal;
      gatewayFee: Decimal;
      platformFee: Decimal;
    },
  ) {
    const sourceModule = 'reconciliation_payout';
    const sourceId = params.payment.id;
    const currency = params.payment.amountGrossCurrency || 'TWD';
    const fxRate = new Decimal(params.payment.amountGrossFxRate || 1);
    const amountBase = (value: Decimal) =>
      value.mul(fxRate).toDecimalPlaces(2);
    const description = `自動核銷撥款 ${params.order.externalOrderId || params.order.id}`;
    const journalLines = [
      {
        accountId: params.journalContext.bankDepositAccountId,
        debit: params.netAmount,
        credit: new Decimal(0),
        currency,
        fxRate,
        amountBase: amountBase(params.netAmount),
        memo: '實際撥款淨額',
      },
      ...(params.platformFee.greaterThan(0)
        ? [
            {
              accountId: params.journalContext.platformFeeAccountId,
              debit: params.platformFee,
              credit: new Decimal(0),
              currency,
              fxRate,
              amountBase: amountBase(params.platformFee),
              memo: '平台手續費',
            },
          ]
        : []),
      ...(params.gatewayFee.greaterThan(0)
        ? [
            {
              accountId: params.journalContext.gatewayFeeAccountId,
              debit: params.gatewayFee,
              credit: new Decimal(0),
              currency,
              fxRate,
              amountBase: amountBase(params.gatewayFee),
              memo: '金流手續費 / 處理費',
            },
          ]
        : []),
      {
        accountId: params.journalContext.clearingAccountId,
        debit: new Decimal(0),
        credit: params.grossAmount,
        currency,
        fxRate,
        amountBase: amountBase(params.grossAmount),
        memo: `沖銷應收帳款 ${params.order.externalOrderId || params.order.id}`,
      },
    ];

    const existingJournal = await tx.journalEntry.findFirst({
      where: { sourceModule, sourceId },
      select: { id: true },
    });

    if (existingJournal) {
      return existingJournal.id;
    }

    const createdJournal = await tx.journalEntry.create({
      data: {
        entityId: params.payment.entityId,
        date: params.payment.payoutDate,
        description,
        sourceModule,
        sourceId,
        periodId: params.periodId,
        createdBy: params.userId,
        approvedBy: params.userId,
        approvedAt: new Date(),
        journalLines: {
          create: journalLines,
        },
      },
      select: { id: true },
    });

    return createdJournal.id;
  }

  private buildAutoClearNote(
    existingNotes: string | null | undefined,
    params: {
      journalEntryId: string;
      gatewayFee: Decimal;
      platformFee: Decimal;
      totalFee: Decimal;
    },
  ) {
    const autoClearNote = [
      '[auto-clear]',
      'status=cleared',
      `journalEntryId=${params.journalEntryId}`,
      `gatewayFee=${params.gatewayFee.toFixed(2)}`,
      `platformFee=${params.platformFee.toFixed(2)}`,
      `totalFee=${params.totalFee.toFixed(2)}`,
      'drBank=1113',
      'drPlatformFee=6131',
      'drGatewayFee=6134',
      'crClearing=1191',
    ].join(' ');
    const preservedNotes = (existingNotes || '')
      .split('\n')
      .filter((line) => !line.startsWith('[auto-clear]'))
      .join('\n')
      .trim();

    return preservedNotes ? `${preservedNotes}\n${autoClearNote}` : autoClearNote;
  }

  // ── 新增 Summary Methods（2026-04）──────────────────────────

  /**
   * 依平台分組加總 Payment 資料
   * GET /reconciliation/platform-payouts
   */
  async getPlatformPayouts(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
    platform?: string,
  ) {
    const where: any = { entityId };
    if (startDate || endDate) {
      where.payoutDate = {};
      if (startDate) where.payoutDate.gte = startDate;
      if (endDate) where.payoutDate.lte = endDate;
    }
    if (platform) {
      where.channel = { contains: platform.toUpperCase() };
    }

    const payments = await this.prisma.payment.findMany({ where });

    // 依 channel 分組
    const grouped = new Map<
      string,
      {
        count: number;
        gross: number;
        platformFee: number;
        gatewayFee: number;
        shippingFee: number;
        net: number;
        reconciledCount: number;
      }
    >();

    for (const p of payments) {
      const key = p.channel;
      if (!grouped.has(key)) {
        grouped.set(key, {
          count: 0,
          gross: 0,
          platformFee: 0,
          gatewayFee: 0,
          shippingFee: 0,
          net: 0,
          reconciledCount: 0,
        });
      }
      const g = grouped.get(key)!;
      g.count += 1;
      g.gross += Number(p.amountGrossOriginal);
      g.platformFee += Number(p.feePlatformOriginal);
      g.gatewayFee += Number(p.feeGatewayOriginal);
      g.shippingFee += Number(p.shippingFeePaidOriginal);
      g.net += Number(p.amountNetOriginal);
      if (p.reconciledFlag) g.reconciledCount += 1;
    }

    return Array.from(grouped.entries()).map(([channel, stats]) => ({
      platform: channel,
      ...stats,
    }));
  }

  /**
   * 查詢有訂單但無發票的 SalesOrder
   * GET /reconciliation/missing-invoices
   */
  async getMissingInvoices(entityId: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        hasInvoice: false,
        status: { in: ['paid', 'fulfilled', 'completed'] },
      },
      include: {
        channel: { select: { name: true, code: true } },
      },
      orderBy: { orderDate: 'desc' },
      take: 200,
    });

    return orders.map((o) => ({
      orderId: o.id,
      externalOrderId: o.externalOrderId,
      platform: o.channel?.code ?? 'UNKNOWN',
      orderDate: o.orderDate,
      amount: Number(o.totalGrossOriginal),
      status: o.status,
      remark: '未開發票',
    }));
  }

  /**
   * 查詢 ECPay 通路 Payment 狀態統計
   * GET /reconciliation/ecpay-payout-status
   */
  async getEcpayPayoutStatus(entityId: string) {
    const payments = await this.prisma.payment.findMany({
      where: {
        entityId,
        channel: { contains: 'ECPAY' },
      },
    });

    const pending = payments.filter((p) => p.status === 'pending');
    const completed = payments.filter((p) => p.status === 'completed');

    const pendingAmount = pending.reduce(
      (s, p) => s + Number(p.amountNetOriginal),
      0,
    );
    const completedAmount = completed.reduce(
      (s, p) => s + Number(p.amountNetOriginal),
      0,
    );

    return {
      pending: { count: pending.length, amount: pendingAmount },
      completed: { count: completed.length, amount: completedAmount },
      inTransit: pendingAmount,
    };
  }

  /**
   * 建立對帳結果記錄
   */
  private async createReconciliationResult(
    bankTransactionId: string,
    matchedType: string,
    matchedId: string,
    confidence: number,
    ruleUsed: string,
  ) {
    await this.prisma.reconciliationResult.create({
      data: {
        bankTransactionId,
        matchedType,
        matchedId,
        confidence,
        ruleUsed,
      },
    });
  }
}
