import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ArRepository } from './ar.repository';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JournalService } from '../accounting/services/journal.service';

/**
 * 應收帳款服務
 *
 * 核心功能：
 * 1. AR 發票管理
 * 2. 收款記錄
 * 3. 帳齡分析
 * 4. 呆帳備抵與壞帳處理
 * 5. 催收管理
 */
@Injectable()
export class ArService {
  private readonly logger = new Logger(ArService.name);

  constructor(
    private readonly arRepository: ArRepository,
    private readonly prisma: PrismaService,
    private readonly journalService: JournalService,
  ) {}

  /**
   * 查詢AR發票列表
   */
  async getInvoices(entityId?: string, status?: string) {
    return this.arRepository.findInvoices({ entityId, status });
  }

  async getReceivableMonitor(
    entityId: string,
    status?: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        status: {
          notIn: ['cancelled', 'refunded'],
        },
        ...(startDate || endDate
          ? {
              orderDate: {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
              },
            }
          : {}),
      },
      include: {
        customer: true,
        channel: true,
        payments: {
          orderBy: { payoutDate: 'desc' },
        },
        invoices: {
          orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
      orderBy: { orderDate: 'desc' },
    });

    const orderIds = orders.map((order) => order.id);
    const [arInvoices, standaloneArInvoices, journals] = await Promise.all([
      this.prisma.arInvoice.findMany({
        where: {
          entityId,
          sourceId: {
            in: orderIds.length ? orderIds : ['__none__'],
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.arInvoice.findMany({
        where: {
          entityId,
          ...(startDate || endDate
            ? {
                issueDate: {
                  ...(startDate ? { gte: startDate } : {}),
                  ...(endDate ? { lte: endDate } : {}),
                },
              }
            : {}),
          OR: [
            { sourceId: null },
            { sourceModule: null },
            { sourceModule: { not: 'sales_order' } },
          ],
        },
        include: {
          customer: true,
        },
        orderBy: { issueDate: 'desc' },
      }),
      this.prisma.journalEntry.findMany({
        where: {
          entityId,
          sourceModule: 'sales',
          sourceId: {
            in: orderIds.length ? orderIds : ['__none__'],
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const arMap = new Map<string, (typeof arInvoices)[number]>();
    for (const invoice of arInvoices) {
      if (invoice.sourceId && !arMap.has(invoice.sourceId)) {
        arMap.set(invoice.sourceId, invoice);
      }
    }

    const journalMap = new Map<string, (typeof journals)[number]>();
    for (const journal of journals) {
      if (journal.sourceId && !journalMap.has(journal.sourceId)) {
        journalMap.set(journal.sourceId, journal);
      }
    }

    const standaloneJournalMap = new Map<string, (typeof journals)[number]>();
    if (standaloneArInvoices.length) {
      const standaloneJournals = await this.prisma.journalEntry.findMany({
        where: {
          entityId,
          sourceId: {
            in: standaloneArInvoices.map((invoice) => invoice.id),
          },
          sourceModule: {
            in: ['ar_payment', 'manual_b2b_ar', 'ar_invoice'],
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      for (const journal of standaloneJournals) {
        if (journal.sourceId && !standaloneJournalMap.has(journal.sourceId)) {
          standaloneJournalMap.set(journal.sourceId, journal);
        }
      }
    }

    const salesOrderItems = orders
      .map((order) => {
        const arInvoice = arMap.get(order.id) || null;
        const journal = journalMap.get(order.id) || null;
        const latestInvoice = order.invoices[0] || null;
        const feeTelemetry = this.resolveFeeTelemetry(order.payments);
        const paidAmount = this.sumAmount(order.payments, 'amountGrossOriginal');
        const gatewayFeeAmount = this.sumAmount(
          order.payments,
          'feeGatewayOriginal',
        );
        const platformFeeAmount = this.sumAmount(
          order.payments,
          'feePlatformOriginal',
        );
        const netAmount = this.sumAmount(order.payments, 'amountNetOriginal');
        const grossAmount = Number(order.totalGrossOriginal || 0);
        const taxAmount = this.resolveTaxAmount(order);
        const revenueAmount = Math.max(grossAmount - taxAmount, 0);
        const outstandingAmount = Math.max(grossAmount - paidAmount, 0);
        const overpaidAmount = Math.max(paidAmount - grossAmount, 0);
        const orderMeta = this.extractMetadata(order.notes);
        const termDays = this.resolvePaymentTermDays(order.customer, orderMeta, outstandingAmount);
        const dueDate =
          arInvoice?.dueDate ||
          this.buildDueDate(order.orderDate, outstandingAmount, termDays);
        const computedStatus = this.resolveReceivableStatus({
          grossAmount,
          paidAmount,
          dueDate,
        });
        const source = this.resolveOrderSource(order.channel?.code, order.notes);
        const classification = this.classifyReceivable({
          customerId: order.customerId || null,
          customerName: order.customer?.name || '散客',
          customer: order.customer,
          customerType: order.customer?.type || 'individual',
          channelCode: order.channel?.code || null,
          channelName: order.channel?.name || null,
          source,
          notes: order.notes,
          payments: order.payments,
          outstandingAmount,
          paidAmount,
          reconciledFlag: order.payments.some((payment) => payment.reconciledFlag),
          dueDate,
          termDays,
        });
        const invoiceStatus = latestInvoice?.status
          ? latestInvoice.status
          : order.hasInvoice
            ? 'issued'
            : 'pending';
        const warningCodes: string[] = [];

        if (paidAmount > 0 && gatewayFeeAmount + platformFeeAmount === 0) {
          warningCodes.push('missing_fee');
        }
        if (paidAmount > 0 && !journal) {
          warningCodes.push('missing_journal');
        }
        if (!arInvoice) {
          warningCodes.push('missing_ar');
        }
        if (!latestInvoice && order.hasInvoice) {
          warningCodes.push('missing_invoice_record');
        }
        if (!latestInvoice && paidAmount > 0) {
          warningCodes.push('invoice_pending');
        }
        if ((latestInvoice?.invoiceNumber || arInvoice?.invoiceNo) && !journal) {
          warningCodes.push('invoice_issued_unposted');
        }
        if ((latestInvoice?.invoiceNumber || arInvoice?.invoiceNo) && outstandingAmount > 0) {
          warningCodes.push('invoice_issued_unpaid');
        }
        if (outstandingAmount > 0 && dueDate < new Date()) {
          warningCodes.push('overdue_receivable');
        }
        if (overpaidAmount > 0.01) {
          warningCodes.push('overpaid_receivable');
        }

        return {
          orderId: order.id,
          orderNumber: order.externalOrderId || order.id,
          orderDate: order.orderDate.toISOString(),
          customerId: order.customerId || null,
          customerName: order.customer?.name || '散客',
          customerEmail: order.customer?.email || null,
          customerPhone: order.customer?.phone || null,
          customerType: order.customer?.type || 'individual',
          paymentTerms: order.customer?.paymentTerms || null,
          paymentTermDays: order.customer?.paymentTermDays || 0,
          isMonthlyBilling: order.customer?.isMonthlyBilling || false,
          billingCycle: order.customer?.billingCycle || null,
          statementEmail:
            order.customer?.statementEmail || order.customer?.email || null,
          collectionOwnerName: order.customer?.collectionOwner || null,
          collectionNote: order.customer?.collectionNote || null,
          creditLimit: Number(order.customer?.creditLimit || 0),
          channelCode: order.channel?.code || null,
          channelName: order.channel?.name || null,
          sourceLabel: source.label,
          sourceBrand: source.brand,
          collectionType: classification.collectionType,
          collectionTypeLabel: classification.collectionTypeLabel,
          paymentMethodGroup: classification.paymentMethodGroup,
          paymentMethodLabel: classification.paymentMethodLabel,
          settlementPhase: classification.settlementPhase,
          settlementPhaseLabel: classification.settlementPhaseLabel,
          receivableGroupKey: classification.receivableGroupKey,
          receivableGroupLabel: classification.receivableGroupLabel,
          collectionOwner: classification.collectionOwner,
          collectionOwnerLabel: classification.collectionOwnerLabel,
          termDays: classification.termDays,
          settlementDiagnostic: classification.settlementDiagnostic,
          grossAmount,
          revenueAmount,
          taxAmount,
          paidAmount,
          outstandingAmount,
          overpaidAmount,
          gatewayFeeAmount,
          platformFeeAmount,
          feeTotal: gatewayFeeAmount + platformFeeAmount,
          netAmount,
          reconciledFlag: order.payments.some((payment) => payment.reconciledFlag),
          payoutCount: order.payments.length,
          feeStatus: feeTelemetry.status,
          feeSource: feeTelemetry.source,
          feeDiagnostic: feeTelemetry.diagnostic,
          arInvoiceId: arInvoice?.id || null,
          arStatus: arInvoice?.status || computedStatus,
          dueDate: dueDate.toISOString(),
          invoiceId: latestInvoice?.id || null,
          invoiceNumber: latestInvoice?.invoiceNumber || arInvoice?.invoiceNo || null,
          invoiceStatus,
          invoiceIssuedAt: latestInvoice?.issuedAt?.toISOString() || null,
          journalEntryId: journal?.id || null,
          journalApprovedAt: journal?.approvedAt?.toISOString() || null,
          accountingPosted: Boolean(journal),
          warningCodes,
          notes: order.notes || null,
        };
      });

    const standaloneItems = standaloneArInvoices.map((invoice) => {
      const journal = standaloneJournalMap.get(invoice.id) || null;
      const amount = Number(invoice.amountOriginal || 0);
      const paid = Number(invoice.paidAmountOriginal || 0);
      const outstandingAmount = Math.max(amount - paid, 0);
      const overpaidAmount = Math.max(paid - amount, 0);
      const notesMeta = this.extractMetadata(invoice.notes);
      const dueDate = invoice.dueDate || this.buildDueDate(invoice.issueDate, outstandingAmount);
      const customerName =
        invoice.customer?.name ||
        notesMeta.customerName ||
        notesMeta.companyName ||
        '未指定客戶';
      const invoiceStatus = invoice.invoiceNo ? 'issued' : 'pending';
      const warningCodes: string[] = [];

      if (outstandingAmount > 0 && dueDate < new Date()) {
        warningCodes.push('overdue_receivable');
      }
      if (!invoice.invoiceNo) {
        warningCodes.push('invoice_pending');
      }
      if (paid > 0 && !journal) {
        warningCodes.push('missing_journal');
      }
      if (overpaidAmount > 0.01) {
        warningCodes.push('overpaid_receivable');
      }

      return {
        orderId: `ar:${invoice.id}`,
        orderNumber: invoice.invoiceNo || invoice.id,
        orderDate: invoice.issueDate.toISOString(),
        customerId: invoice.customerId || null,
        customerName,
        customerEmail:
          invoice.customer?.statementEmail || invoice.customer?.email || notesMeta.customerEmail || null,
        customerPhone: invoice.customer?.phone || null,
        customerType: invoice.customer?.type || 'company',
        paymentTerms: invoice.customer?.paymentTerms || notesMeta.paymentTerms || 'net30',
        paymentTermDays: invoice.customer?.paymentTermDays || 30,
        isMonthlyBilling: invoice.customer?.isMonthlyBilling ?? true,
        billingCycle: invoice.customer?.billingCycle || 'monthly',
        statementEmail:
          invoice.customer?.statementEmail || invoice.customer?.email || notesMeta.customerEmail || null,
        collectionOwnerName: invoice.customer?.collectionOwner || null,
        collectionNote: invoice.customer?.collectionNote || null,
        creditLimit: Number(invoice.customer?.creditLimit || 0),
        channelCode: 'manual_ar',
        channelName: '手動應收',
        sourceLabel: notesMeta.sourceLabel || 'B2B 月結',
        sourceBrand: notesMeta.sourceBrand || 'MOZTECH',
        collectionType: 'b2b_monthly',
        collectionTypeLabel: 'B2B 月結應收',
        paymentMethodGroup: 'bank_transfer',
        paymentMethodLabel: '銀行匯款 / 月結',
        settlementPhase: outstandingAmount > 0 ? 'unpaid' : 'cleared',
        settlementPhaseLabel: outstandingAmount > 0 ? '待收款' : '已收款',
        receivableGroupKey: `b2b_manual:${invoice.customerId || customerName}`,
        receivableGroupLabel: `B2B 月結：${customerName}`,
        collectionOwner: invoice.customer?.collectionOwner || 'accounting',
        collectionOwnerLabel: invoice.customer?.collectionOwner || '會計追帳',
        termDays: invoice.customer?.paymentTermDays || 30,
        settlementDiagnostic: '手動建立的 B2B / 月結應收，直接追蹤收款與銷帳。',
        grossAmount: amount,
        revenueAmount: amount,
        taxAmount: 0,
        paidAmount: paid,
        outstandingAmount,
        overpaidAmount,
        gatewayFeeAmount: 0,
        platformFeeAmount: 0,
        feeTotal: 0,
        netAmount: paid,
        reconciledFlag: outstandingAmount <= 0,
        payoutCount: paid > 0 ? 1 : 0,
        feeStatus: 'actual',
        feeSource: 'manual_ar_no_gateway_fee',
        feeDiagnostic: '手動 B2B 應收預設無平台 / 金流抽成。',
        arInvoiceId: invoice.id,
        arStatus: invoice.status,
        dueDate: dueDate.toISOString(),
        invoiceId: null,
        invoiceNumber: invoice.invoiceNo || null,
        invoiceStatus,
        invoiceIssuedAt: invoice.issueDate.toISOString(),
        journalEntryId: journal?.id || null,
        journalApprovedAt: journal?.approvedAt?.toISOString() || null,
        accountingPosted: Boolean(journal),
        warningCodes,
        notes: invoice.notes || null,
      };
    });

    const items = [...salesOrderItems, ...standaloneItems]
      .filter((item) => (status ? item.arStatus === status : true))
      .sort(
        (left, right) =>
          new Date(right.orderDate).getTime() - new Date(left.orderDate).getTime(),
      );

    const summary = items.reduce(
      (acc, item) => {
        acc.grossAmount += item.grossAmount;
        acc.paidAmount += item.paidAmount;
        acc.outstandingAmount += item.outstandingAmount;
        acc.gatewayFeeAmount += item.gatewayFeeAmount;
        acc.platformFeeAmount += item.platformFeeAmount;
        acc.netAmount += item.netAmount;
        acc.invoiceIssuedCount += item.invoiceNumber ? 1 : 0;
        acc.journalPostedCount += item.journalEntryId ? 1 : 0;
        acc.missingFeeCount += item.warningCodes.includes('missing_fee') ? 1 : 0;
        acc.missingJournalCount += item.warningCodes.includes('missing_journal')
          ? 1
          : 0;
        acc.missingInvoiceCount += item.warningCodes.includes('invoice_pending')
          ? 1
          : 0;
        acc.outstandingOrderCount += item.outstandingAmount > 0 ? 1 : 0;
        acc.overdueReceivableCount += item.warningCodes.includes('overdue_receivable')
          ? 1
          : 0;
        acc.overdueReceivableAmount += item.warningCodes.includes('overdue_receivable')
          ? item.outstandingAmount
          : 0;
        acc.overpaidReceivableCount += item.warningCodes.includes(
          'overpaid_receivable',
        )
          ? 1
          : 0;
        acc.overpaidReceivableAmount += item.warningCodes.includes(
          'overpaid_receivable',
        )
          ? item.overpaidAmount
          : 0;
        acc.issuedUnpostedCount += item.warningCodes.includes(
          'invoice_issued_unposted',
        )
          ? 1
          : 0;
        acc.issuedUnpaidCount += item.warningCodes.includes('invoice_issued_unpaid')
          ? 1
          : 0;
        return acc;
      },
      {
        grossAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        gatewayFeeAmount: 0,
        platformFeeAmount: 0,
        netAmount: 0,
        invoiceIssuedCount: 0,
        journalPostedCount: 0,
        missingFeeCount: 0,
        missingJournalCount: 0,
        missingInvoiceCount: 0,
        outstandingOrderCount: 0,
        overdueReceivableCount: 0,
        overdueReceivableAmount: 0,
        overpaidReceivableCount: 0,
        overpaidReceivableAmount: 0,
        issuedUnpostedCount: 0,
        issuedUnpaidCount: 0,
      },
    );

    const classificationGroups = Array.from(
      items
        .reduce((map, item) => {
          const key = item.receivableGroupKey || 'unclassified';
          const current =
            map.get(key) ||
            {
              key,
              label: item.receivableGroupLabel || '未分類應收',
              collectionType: item.collectionType || 'unclassified',
              collectionTypeLabel: item.collectionTypeLabel || '未分類',
              paymentMethodGroup: item.paymentMethodGroup || 'other',
              paymentMethodLabel: item.paymentMethodLabel || '其他應收',
              settlementPhase: item.settlementPhase || 'unpaid',
              settlementPhaseLabel: item.settlementPhaseLabel || '待收款',
              collectionOwner: item.collectionOwner || 'unknown',
              collectionOwnerLabel: item.collectionOwnerLabel || '待確認',
              orderCount: 0,
              grossAmount: 0,
              paidAmount: 0,
              outstandingAmount: 0,
              gatewayFeeAmount: 0,
              platformFeeAmount: 0,
              feeTotal: 0,
              netAmount: 0,
              overdueCount: 0,
              overdueAmount: 0,
              overpaidCount: 0,
              overpaidAmount: 0,
              missingFeeCount: 0,
              missingInvoiceCount: 0,
              missingJournalCount: 0,
            };

          current.orderCount += 1;
          current.grossAmount += item.grossAmount;
          current.paidAmount += item.paidAmount;
          current.outstandingAmount += item.outstandingAmount;
          current.gatewayFeeAmount += item.gatewayFeeAmount;
          current.platformFeeAmount += item.platformFeeAmount;
          current.feeTotal += item.feeTotal;
          current.netAmount += item.netAmount;
          current.overdueCount += item.warningCodes.includes('overdue_receivable')
            ? 1
            : 0;
          current.overdueAmount += item.warningCodes.includes('overdue_receivable')
            ? item.outstandingAmount
            : 0;
          current.overpaidCount += item.warningCodes.includes('overpaid_receivable')
            ? 1
            : 0;
          current.overpaidAmount += item.warningCodes.includes('overpaid_receivable')
            ? item.overpaidAmount
            : 0;
          current.missingFeeCount += item.warningCodes.includes('missing_fee') ? 1 : 0;
          current.missingInvoiceCount += item.warningCodes.includes('invoice_pending')
            ? 1
            : 0;
          current.missingJournalCount += item.warningCodes.includes('missing_journal')
            ? 1
            : 0;

          if (item.settlementPhase === 'overdue') {
            current.settlementPhase = 'overdue';
            current.settlementPhaseLabel = '逾期應收';
          } else if (
            current.settlementPhase !== 'overdue' &&
            item.settlementPhase === 'in_transit'
          ) {
            current.settlementPhase = 'in_transit';
            current.settlementPhaseLabel = '在途待撥款';
          } else if (
            !['overdue', 'in_transit'].includes(current.settlementPhase) &&
            item.settlementPhase === 'pending_payout'
          ) {
            current.settlementPhase = 'pending_payout';
            current.settlementPhaseLabel = '待撥款';
          }

          map.set(key, current);
          return map;
        }, new Map<string, any>())
        .values(),
    ).sort((a, b) => b.outstandingAmount - a.outstandingAmount);

    return {
      entityId,
      summary,
      classificationGroups,
      items,
    };
  }

  async getOverpaidReceivables(
    entityId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
      resolutionCategory?: string;
    },
  ) {
    const normalizedLimit = Math.min(
      Math.max(Math.floor(options?.limit || 100), 1),
      500,
    );
    const normalizedOffset = Math.max(Math.floor(options?.offset || 0), 0);
    const resolutionCategory = options?.resolutionCategory?.trim();
    const orderDate =
      options?.startDate || options?.endDate
        ? {
            ...(options?.startDate ? { gte: options.startDate } : {}),
            ...(options?.endDate ? { lte: options.endDate } : {}),
          }
        : undefined;

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        status: {
          notIn: ['cancelled', 'refunded'],
        },
        ...(orderDate ? { orderDate } : {}),
      },
      include: {
        channel: {
          select: {
            code: true,
            name: true,
          },
        },
        payments: {
          orderBy: [{ payoutDate: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            payoutBatchId: true,
            channel: true,
            payoutDate: true,
            amountGrossOriginal: true,
            amountNetOriginal: true,
            feeGatewayOriginal: true,
            feePlatformOriginal: true,
            reconciledFlag: true,
            status: true,
            notes: true,
            createdAt: true,
          },
        },
      },
      orderBy: { orderDate: 'desc' },
    });

    const allItems = orders
      .map((order) => {
        const grossAmount = Number(order.totalGrossOriginal || 0);
        const paidAmount = this.sumAmount(order.payments, 'amountGrossOriginal');
        const overpaidAmount = Math.max(paidAmount - grossAmount, 0);
        if (overpaidAmount <= 0.01) {
          return null;
        }

        const paymentAmountCounts = order.payments.reduce<Record<string, number>>(
          (acc, payment) => {
            const key = Number(payment.amountGrossOriginal || 0).toFixed(2);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          },
          {},
        );
        const duplicateAmountGroups = Object.entries(paymentAmountCounts)
          .filter(([, count]) => count > 1)
          .map(([amount, count]) => ({
            amount: Number(amount),
            count,
          }));
        const exactDoublePaid =
          grossAmount > 0 && Math.abs(paidAmount - grossAmount * 2) <= 1;
        const allPaymentsUnreconciled = order.payments.every(
          (payment) => !payment.reconciledFlag,
        );
        const hasDraftOrPendingPayment = order.payments.some(
          (payment) =>
            payment.status === 'pending' ||
            (payment.payoutBatchId || '').startsWith('draft:'),
        );
        const paymentDetails = order.payments.map((payment) => {
          const meta = this.extractMetadata(payment.notes);
          return {
            paymentId: payment.id,
            payoutBatchId: payment.payoutBatchId,
            channel: payment.channel,
            status: payment.status,
            payoutDate: payment.payoutDate.toISOString(),
            createdAt: payment.createdAt.toISOString(),
            amountGrossOriginal: Number(payment.amountGrossOriginal || 0),
            amountNetOriginal: Number(payment.amountNetOriginal || 0),
            feeGatewayOriginal: Number(payment.feeGatewayOriginal || 0),
            feePlatformOriginal: Number(payment.feePlatformOriginal || 0),
            reconciledFlag: payment.reconciledFlag,
            providerPaymentId:
              meta.providerPaymentId ||
              meta.oneShopPaymentId ||
              meta.transactionId ||
              null,
            feeStatus: meta.feeStatus || null,
            feeSource: meta.feeSource || null,
          };
        });
        const diagnosis = this.resolveOverpaidDiagnosis({
          paymentCount: order.payments.length,
          duplicateAmountGroups,
          exactDoublePaid,
          allPaymentsUnreconciled,
          hasDraftOrPendingPayment,
        });
        const resolution = this.resolveOverpaidResolution({
          grossAmount,
          paidAmount,
          paymentCount: order.payments.length,
          duplicateAmountGroups,
          exactDoublePaid,
          allPaymentsUnreconciled,
          hasDraftOrPendingPayment,
          payments: paymentDetails,
        });

        return {
          orderId: order.id,
          orderNumber: order.externalOrderId || order.id,
          orderDate: order.orderDate.toISOString(),
          channelCode: order.channel?.code || null,
          channelName: order.channel?.name || null,
          grossAmount,
          paidAmount,
          overpaidAmount,
          paymentCount: order.payments.length,
          duplicateAmountGroups,
          exactDoublePaid,
          allPaymentsUnreconciled,
          hasDraftOrPendingPayment,
          diagnosis,
          resolutionCategory: resolution.category,
          resolutionLabel: resolution.label,
          resolutionAction: resolution.action,
          resolutionChecks: resolution.checks,
          candidateDuplicatePaymentIds: resolution.candidateDuplicatePaymentIds,
          payments: paymentDetails,
        };
      })
      .filter(Boolean)
      .sort((left: any, right: any) => right.overpaidAmount - left.overpaidAmount);

    const filteredItems = resolutionCategory
      ? allItems.filter(
          (item: any) => item.resolutionCategory === resolutionCategory,
        )
      : allItems;
    const limitedItems = filteredItems.slice(
      normalizedOffset,
      normalizedOffset + normalizedLimit,
    );
    const summary = allItems.reduce(
      (acc: any, item: any) => {
        acc.overpaidOrderCount += 1;
        acc.overpaidAmount += item.overpaidAmount;
        acc.exactDoublePaidCount += item.exactDoublePaid ? 1 : 0;
        acc.unreconciledOverpaidCount += item.allPaymentsUnreconciled ? 1 : 0;
        acc.duplicateAmountGroupCount += item.duplicateAmountGroups.length ? 1 : 0;
        acc.duplicateImportCandidateCount +=
          item.resolutionCategory === 'duplicate_import_candidate' ? 1 : 0;
        acc.multiPaymentReviewCount +=
          item.resolutionCategory === 'multi_payment_review' ? 1 : 0;
        acc.manualReviewCount +=
          item.resolutionCategory === 'manual_review' ? 1 : 0;
        return acc;
      },
      {
        overpaidOrderCount: 0,
        overpaidAmount: 0,
        exactDoublePaidCount: 0,
        unreconciledOverpaidCount: 0,
        duplicateAmountGroupCount: 0,
        duplicateImportCandidateCount: 0,
        multiPaymentReviewCount: 0,
        manualReviewCount: 0,
      },
    );

    return {
      entityId,
      range: {
        startDate: options?.startDate?.toISOString() || null,
        endDate: options?.endDate?.toISOString() || null,
      },
      limit: normalizedLimit,
      offset: normalizedOffset,
      filter: {
        resolutionCategory: resolutionCategory || null,
      },
      totalCount: allItems.length,
      filteredCount: filteredItems.length,
      summary,
      items: limitedItems,
    };
  }

  async getB2BStatements(
    entityId: string,
    asOfDate = new Date(),
    startDate?: Date,
  ) {
    const monitor = await this.getReceivableMonitor(
      entityId,
      undefined,
      startDate,
      asOfDate,
    );
    const b2bItems = monitor.items.filter(
      (item: any) =>
        item.collectionType === 'b2b_monthly' ||
        item.customerType === 'company' ||
        item.isMonthlyBilling ||
        Number(item.paymentTermDays || 0) > 0,
    );

    const customerGroups = Array.from(
      b2bItems
        .reduce((map, item: any) => {
          const key = item.customerId || item.customerName || 'unknown';
          const current =
            map.get(key) ||
            {
              customerId: item.customerId || null,
              customerName: item.customerName || '未命名客戶',
              customerEmail: item.customerEmail || null,
              statementEmail: item.statementEmail || item.customerEmail || null,
              customerPhone: item.customerPhone || null,
              paymentTerms: item.paymentTerms || null,
              paymentTermDays: item.paymentTermDays || item.termDays || 30,
              isMonthlyBilling: Boolean(item.isMonthlyBilling),
              billingCycle: item.billingCycle || 'monthly',
              collectionOwner: item.collectionOwnerName || null,
              collectionNote: item.collectionNote || null,
              creditLimit: Number(item.creditLimit || 0),
              orderCount: 0,
              openOrderCount: 0,
              grossAmount: 0,
              paidAmount: 0,
              outstandingAmount: 0,
              overdueAmount: 0,
              overdueCount: 0,
              currentAmount: 0,
              due1To30Amount: 0,
              due31To60Amount: 0,
              due61To90Amount: 0,
              dueOver90Amount: 0,
              missingInvoiceCount: 0,
              missingJournalCount: 0,
              missingFeeCount: 0,
              lastOrderDate: null as string | null,
              nextStatementDate: this.buildNextStatementDate(asOfDate),
              riskLevel: 'normal',
              recommendedAction: '可於月底產生對帳單。',
              orders: [] as any[],
            };

          const outstandingAmount = Number(item.outstandingAmount || 0);
          const daysPastDue = this.daysPastDue(item.dueDate, asOfDate);

          current.orderCount += 1;
          current.openOrderCount += outstandingAmount > 0 ? 1 : 0;
          current.grossAmount += Number(item.grossAmount || 0);
          current.paidAmount += Number(item.paidAmount || 0);
          current.outstandingAmount += outstandingAmount;
          current.missingInvoiceCount += item.warningCodes?.includes('invoice_pending')
            ? 1
            : 0;
          current.missingJournalCount += item.warningCodes?.includes('missing_journal')
            ? 1
            : 0;
          current.missingFeeCount += item.warningCodes?.includes('missing_fee') ? 1 : 0;
          current.lastOrderDate =
            !current.lastOrderDate || item.orderDate > current.lastOrderDate
              ? item.orderDate
              : current.lastOrderDate;

          if (outstandingAmount > 0) {
            if (daysPastDue <= 0) {
              current.currentAmount += outstandingAmount;
            } else if (daysPastDue <= 30) {
              current.due1To30Amount += outstandingAmount;
            } else if (daysPastDue <= 60) {
              current.due31To60Amount += outstandingAmount;
            } else if (daysPastDue <= 90) {
              current.due61To90Amount += outstandingAmount;
            } else {
              current.dueOver90Amount += outstandingAmount;
            }
            if (daysPastDue > 0) {
              current.overdueAmount += outstandingAmount;
              current.overdueCount += 1;
            }
          }

          current.orders.push({
            orderId: item.orderId,
            orderNumber: item.orderNumber,
            orderDate: item.orderDate,
            dueDate: item.dueDate,
            sourceLabel: item.sourceLabel,
            grossAmount: item.grossAmount,
            paidAmount: item.paidAmount,
            outstandingAmount,
            invoiceNumber: item.invoiceNumber,
            invoiceStatus: item.invoiceStatus,
            accountingPosted: item.accountingPosted,
            daysPastDue,
          });

          map.set(key, current);
          return map;
        }, new Map<string, any>())
        .values(),
    )
      .map((customer: any) => {
        const overCredit =
          customer.creditLimit > 0 && customer.outstandingAmount > customer.creditLimit;
        if (customer.dueOver90Amount > 0 || overCredit) {
          customer.riskLevel = 'critical';
          customer.recommendedAction = overCredit
            ? '已超過信用額度，建議暫停放帳並優先聯繫收款。'
            : '逾期超過 90 天，建議升級催收或管理層追蹤。';
        } else if (customer.overdueAmount > 0) {
          customer.riskLevel = 'warning';
          customer.recommendedAction = '已有逾期應收，建議本週寄送催收提醒。';
        } else if (customer.outstandingAmount > 0) {
          customer.riskLevel = 'attention';
          customer.recommendedAction = '月底可產生月結對帳單。';
        }
        return customer;
      })
      .sort((a: any, b: any) => b.outstandingAmount - a.outstandingAmount);

    const summary = customerGroups.reduce(
      (acc: any, customer: any) => {
        acc.customerCount += 1;
        acc.openCustomerCount += customer.outstandingAmount > 0 ? 1 : 0;
        acc.grossAmount += customer.grossAmount;
        acc.paidAmount += customer.paidAmount;
        acc.outstandingAmount += customer.outstandingAmount;
        acc.overdueAmount += customer.overdueAmount;
        acc.overdueCustomerCount += customer.overdueAmount > 0 ? 1 : 0;
        acc.overCreditCount +=
          customer.creditLimit > 0 && customer.outstandingAmount > customer.creditLimit
            ? 1
            : 0;
        acc.missingStatementEmailCount += customer.statementEmail ? 0 : 1;
        return acc;
      },
      {
        customerCount: 0,
        openCustomerCount: 0,
        grossAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        overdueAmount: 0,
        overdueCustomerCount: 0,
        overCreditCount: 0,
        missingStatementEmailCount: 0,
      },
    );

    return {
      entityId,
      asOfDate: asOfDate.toISOString(),
      summary,
      customers: customerGroups,
    };
  }

  async syncSalesReceivables(
    entityId: string,
    userId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    },
  ) {
    const orderDate =
      options?.startDate || options?.endDate
        ? {
            ...(options?.startDate ? { gte: options.startDate } : {}),
            ...(options?.endDate ? { lte: options.endDate } : {}),
          }
        : undefined;
    const take = options?.limit
      ? Math.min(Math.max(Number(options.limit || 0), 1), 5000)
      : undefined;

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        status: {
          notIn: ['cancelled', 'refunded'],
        },
        ...(orderDate ? { orderDate } : {}),
      },
      include: {
        customer: true,
        channel: true,
        payments: true,
        invoices: {
          orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
      orderBy: { orderDate: 'desc' },
      ...(take ? { take } : {}),
    });

    const orderIds = orders.map((order) => order.id);
    const [existingArInvoices, existingJournals, accounts] = await Promise.all([
      this.prisma.arInvoice.findMany({
        where: {
          entityId,
          sourceId: {
            in: orderIds.length ? orderIds : ['__none__'],
          },
        },
      }),
      this.prisma.journalEntry.findMany({
        where: {
          entityId,
          sourceModule: 'sales',
          sourceId: {
            in: orderIds.length ? orderIds : ['__none__'],
          },
        },
      }),
      this.prisma.account.findMany({
        where: {
          entityId,
          code: {
            in: ['1191', '4111', '2194'],
          },
          isActive: true,
        },
      }),
    ]);

    const arMap = new Map(existingArInvoices.map((item) => [item.sourceId, item]));
    const journalMap = new Map(existingJournals.map((item) => [item.sourceId, item]));
    const accountMap = new Map(accounts.map((account) => [account.code, account]));

    const arAccount = accountMap.get('1191');
    const revenueAccount = accountMap.get('4111');
    const taxAccount = accountMap.get('2194') || null;

    if (!arAccount || !revenueAccount) {
      throw new NotFoundException(
        '缺少必要會計科目，請確認已建立 1191 應收帳款與 4111 銷貨收入。',
      );
    }

    const period = await this.prisma.period.findFirst({
      where: {
        entityId,
        status: 'open',
      },
      orderBy: { startDate: 'desc' },
    });

    let arUpserted = 0;
    let journalsCreated = 0;

    for (const order of orders) {
      const latestInvoice = order.invoices[0] || null;
      const paidAmount = this.sumAmount(order.payments, 'amountGrossOriginal');
      const grossAmount = Number(order.totalGrossOriginal || 0);
      const dueDate = this.buildDueDate(order.orderDate, grossAmount - paidAmount);
      const status = this.resolveReceivableStatus({
        grossAmount,
        paidAmount,
        dueDate,
      });
      const existingAr = arMap.get(order.id) || null;
      const invoiceNo = latestInvoice?.invoiceNumber || order.externalOrderId || null;

      const arPayload = {
        entityId: order.entityId,
        customerId: order.customerId,
        invoiceNo,
        amountOriginal: new Decimal(grossAmount),
        amountCurrency: order.totalGrossCurrency,
        amountFxRate: order.totalGrossFxRate,
        amountBase: order.totalGrossBase,
        paidAmountOriginal: new Decimal(paidAmount),
        paidAmountCurrency: order.totalGrossCurrency,
        paidAmountFxRate: order.totalGrossFxRate,
        paidAmountBase: new Decimal(paidAmount).mul(order.totalGrossFxRate),
        issueDate: order.orderDate,
        dueDate,
        status,
        priority:
          status === 'overdue' || status === 'partial' ? 'urgent' : 'normal',
        sourceModule: 'sales_order',
        sourceId: order.id,
        notes: this.buildArNote(order.notes, latestInvoice?.invoiceNumber || null),
      };

      if (existingAr) {
        await this.prisma.arInvoice.update({
          where: { id: existingAr.id },
          data: arPayload,
        });
      } else {
        await this.prisma.arInvoice.create({
          data: arPayload,
        });
      }
      arUpserted += 1;

      if (!journalMap.has(order.id)) {
        const taxAmount = this.resolveTaxAmount(order, latestInvoice?.taxAmountOriginal);
        const revenueAmount = Math.max(grossAmount - taxAmount, 0);
        const lines = [
          {
            accountId: arAccount.id,
            debit: grossAmount,
            credit: 0,
            currency: order.totalGrossCurrency,
            fxRate: Number(order.totalGrossFxRate || 1),
            amountBase: Number(order.totalGrossBase || grossAmount),
            memo: '應收帳款',
          },
        ];

        if (taxAmount > 0 && taxAccount) {
          lines.push({
            accountId: revenueAccount.id,
            debit: 0,
            credit: revenueAmount,
            currency: order.totalGrossCurrency,
            fxRate: Number(order.totalGrossFxRate || 1),
            amountBase: revenueAmount * Number(order.totalGrossFxRate || 1),
            memo: '銷貨收入',
          });
          lines.push({
            accountId: taxAccount.id,
            debit: 0,
            credit: taxAmount,
            currency: order.totalGrossCurrency,
            fxRate: Number(order.totalGrossFxRate || 1),
            amountBase: taxAmount * Number(order.totalGrossFxRate || 1),
            memo: '應付營業稅',
          });
        } else {
          lines.push({
            accountId: revenueAccount.id,
            debit: 0,
            credit: grossAmount,
            currency: order.totalGrossCurrency,
            fxRate: Number(order.totalGrossFxRate || 1),
            amountBase: Number(order.totalGrossBase || grossAmount),
            memo: '銷貨收入',
          });
        }

        await this.journalService.createJournalEntry({
          entityId: order.entityId,
          date: order.orderDate,
          description: `銷售訂單 ${order.externalOrderId || order.id}`,
          sourceModule: 'sales',
          sourceId: order.id,
          periodId: period?.id,
          createdBy: userId,
          lines,
        });
        journalsCreated += 1;
      }
    }

    return {
      entityId,
      range: {
        startDate: options?.startDate?.toISOString() || null,
        endDate: options?.endDate?.toISOString() || null,
      },
      orderCount: orders.length,
      arUpserted,
      journalsCreated,
    };
  }

  /**
   * 查詢單一AR發票
   */
  async getInvoice(id: string) {
    return this.arRepository.findInvoiceById(id);
  }

  /**
   * 建立AR發票
   * TODO: 自動產生會計分錄（借：應收帳款 / 貸：銷貨收入）
   */
  async createInvoice(data: any) {
    if (!data?.entityId || !data?.issueDate || !data?.dueDate) {
      throw new NotFoundException('entityId / issueDate / dueDate 為必填');
    }

    const amountOriginal = Number(data.amountOriginal || 0);
    const paidAmountOriginal = Number(data.paidAmountOriginal || 0);
    const fxRate = Number(data.amountFxRate || 1);
    const paidFxRate = Number(data.paidAmountFxRate || fxRate || 1);
    const dueDate = new Date(data.dueDate);
    const invoice = await this.arRepository.createInvoice({
      entityId: data.entityId,
      customerId: data.customerId || null,
      invoiceNo: data.invoiceNo || null,
      amountOriginal: new Decimal(amountOriginal),
      amountCurrency: data.amountCurrency || 'TWD',
      amountFxRate: new Decimal(fxRate),
      amountBase: new Decimal(
        Number(data.amountBase || (amountOriginal * fxRate).toFixed(2)),
      ),
      paidAmountOriginal: new Decimal(paidAmountOriginal),
      paidAmountCurrency: data.paidAmountCurrency || data.amountCurrency || 'TWD',
      paidAmountFxRate: new Decimal(paidFxRate),
      paidAmountBase: new Decimal(
        Number(data.paidAmountBase || (paidAmountOriginal * paidFxRate).toFixed(2)),
      ),
      issueDate: new Date(data.issueDate),
      dueDate,
      status:
        data.status ||
        this.resolveReceivableStatus({
          grossAmount: amountOriginal,
          paidAmount: paidAmountOriginal,
          dueDate,
        }),
      priority: data.priority || 'normal',
      sourceModule: data.sourceModule || null,
      sourceId: data.sourceId || null,
      notes: data.notes || null,
    });

    return invoice;
  }

  /**
   * 記錄收款
   * TODO: 產生收款分錄（借：銀行存款 / 貸：應收帳款）
   */
  async recordPayment(invoiceId: string, data: any) {
    const invoice = await this.arRepository.findInvoiceById(invoiceId);
    if (!invoice) {
      throw new NotFoundException(`AR invoice ${invoiceId} not found`);
    }

    const paymentAmount = Number(data.amount || 0);
    if (paymentAmount <= 0) {
      throw new NotFoundException('收款金額必須大於 0');
    }

    const paidAmount = Number(invoice.paidAmountOriginal || 0) + paymentAmount;
    const grossAmount = Number(invoice.amountOriginal || 0);
    const dueDate = new Date(invoice.dueDate);
    const newStatus = this.resolveReceivableStatus({
      grossAmount,
      paidAmount,
      dueDate,
    });

    const updatedInvoice = await this.arRepository.recordPayment(invoiceId, {
      amount: paymentAmount,
      newStatus,
    });

    const accounts = await this.prisma.account.findMany({
      where: {
        entityId: invoice.entityId,
        code: { in: ['1113', '1191'] },
        isActive: true,
      },
    });
    const accountMap = new Map(accounts.map((account) => [account.code, account]));
    const bankAccount = accountMap.get('1113');
    const arAccount = accountMap.get('1191');

    if (bankAccount && arAccount) {
      const period = await this.prisma.period.findFirst({
        where: {
          entityId: invoice.entityId,
          status: 'open',
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
        orderBy: { startDate: 'desc' },
      });

      await this.journalService.createJournalEntry({
        entityId: invoice.entityId,
        date: new Date(data.paymentDate || new Date()),
        description: `AR 收款 ${invoice.invoiceNo || invoice.id}`,
        sourceModule: 'ar_payment',
        sourceId: invoice.id,
        periodId: period?.id,
        createdBy: data.userId || 'system',
        lines: [
          {
            accountId: bankAccount.id,
            debit: paymentAmount,
            credit: 0,
            currency: invoice.amountCurrency,
            fxRate: Number(invoice.amountFxRate || 1),
            amountBase: Number(
              (paymentAmount * Number(invoice.amountFxRate || 1)).toFixed(2),
            ),
            memo: '銀行收款',
          },
          {
            accountId: arAccount.id,
            debit: 0,
            credit: paymentAmount,
            currency: invoice.amountCurrency,
            fxRate: Number(invoice.amountFxRate || 1),
            amountBase: Number(
              (paymentAmount * Number(invoice.amountFxRate || 1)).toFixed(2),
            ),
            memo: '沖銷應收帳款',
          },
        ],
      });
    }

    return updatedInvoice;
  }

  /**
   * 提列呆帳備抵
   * 依帳齡或歷史壞帳率提列
   */
  async createAllowanceForDoubtfulAccounts(entityId: string, amount: number) {
    // TODO: 產生分錄（借：呆帳費用 / 貸：備抵呆帳）
  }

  /**
   * 催收管理
   * TODO: 自動發送催收通知
   */
  async sendCollectionReminder(invoiceId: string) {
    // TODO: 發送 Email 或簡訊提醒
    // TODO: 記錄催收歷史
  }

  /**
   * 從訂單建立應收發票
   * @param orderId - 訂單ID
   * @returns 建立的應收發票
   */
  async createArFromOrder(orderId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        invoices: {
          orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Sales order ${orderId} not found`);
    }

    const latestInvoice = order.invoices[0] || null;
    const paidAmount = await this.prisma.payment.aggregate({
      where: { salesOrderId: order.id },
      _sum: { amountGrossOriginal: true },
    });
    const grossAmount = Number(order.totalGrossOriginal || 0);
    const paid = Number(paidAmount._sum.amountGrossOriginal || 0);
    const dueDate = this.buildDueDate(order.orderDate, grossAmount - paid);
    const status = this.resolveReceivableStatus({
      grossAmount,
      paidAmount: paid,
      dueDate,
    });

    const existing = await this.prisma.arInvoice.findFirst({
      where: {
        entityId: order.entityId,
        sourceModule: 'sales_order',
        sourceId: order.id,
      },
    });

    const payload = {
      entityId: order.entityId,
      customerId: order.customerId,
      invoiceNo: latestInvoice?.invoiceNumber || order.externalOrderId || null,
      amountOriginal: new Decimal(grossAmount),
      amountCurrency: order.totalGrossCurrency,
      amountFxRate: order.totalGrossFxRate,
      amountBase: order.totalGrossBase,
      paidAmountOriginal: new Decimal(paid),
      paidAmountCurrency: order.totalGrossCurrency,
      paidAmountFxRate: order.totalGrossFxRate,
      paidAmountBase: new Decimal(
        Number((paid * Number(order.totalGrossFxRate || 1)).toFixed(2)),
      ),
      issueDate: order.orderDate,
      dueDate,
      status,
      priority: status === 'overdue' ? 'urgent' : 'normal',
      sourceModule: 'sales_order',
      sourceId: order.id,
      notes: this.buildArNote(order.notes, latestInvoice?.invoiceNumber || null),
    };

    if (existing) {
      return this.prisma.arInvoice.update({
        where: { id: existing.id },
        data: payload,
      });
    }

    return this.prisma.arInvoice.create({ data: payload });
  }

  /**
   * 套用收款
   * @param invoiceId - 發票ID
   * @param paymentAmount - 收款金額
   * @param paymentDate - 收款日期
   * @returns 更新後的發票資訊
   */
  async applyPayment(
    invoiceId: string,
    paymentAmount: number,
    paymentDate: Date,
  ) {
    return this.recordPayment(invoiceId, {
      amount: paymentAmount,
      paymentDate,
      userId: 'system',
    });
  }

  /**
   * 取得帳齡分析報表
   * @param entityId - 實體ID
   * @param asOfDate - 統計基準日期
   * @returns 帳齡分析報表
   */
  async getAgingReport(entityId: string, asOfDate: Date) {
    const invoices = await this.prisma.arInvoice.findMany({
      where: { entityId },
      include: {
        customer: true,
      },
      orderBy: { dueDate: 'asc' },
    });

    const buckets = {
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      over90: 0,
    };

    const items = invoices.map((invoice) => {
      const amount = Number(invoice.amountOriginal || 0);
      const paid = Number(invoice.paidAmountOriginal || 0);
      const outstanding = Math.max(amount - paid, 0);
      const daysPastDue = Math.max(
        0,
        Math.floor(
          (asOfDate.getTime() - new Date(invoice.dueDate).getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      );

      let bucket: keyof typeof buckets = 'current';
      if (daysPastDue > 90) bucket = 'over90';
      else if (daysPastDue > 60) bucket = 'days61to90';
      else if (daysPastDue > 30) bucket = 'days31to60';
      else if (daysPastDue > 0) bucket = 'days1to30';

      buckets[bucket] += outstanding;

      return {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        customerName: invoice.customer?.name || '散客',
        dueDate: invoice.dueDate,
        status: invoice.status,
        outstandingAmount: outstanding,
        daysPastDue,
        bucket,
      };
    });

    return {
      entityId,
      asOfDate: asOfDate.toISOString(),
      summary: buckets,
      totalOutstanding: items.reduce(
        (sum, item) => sum + item.outstandingAmount,
        0,
      ),
      items,
    };
  }

  /**
   * 呆帳沖銷
   * @param invoiceId - 發票ID
   * @param amount - 沖銷金額
   * @param reason - 沖銷原因
   * @returns 沖銷記錄
   */
  async writeOffBadDebt(invoiceId: string, amount: number, reason: string) {
    const invoice = await this.arRepository.findInvoiceById(invoiceId);
    if (!invoice) {
      throw new NotFoundException(`AR invoice ${invoiceId} not found`);
    }

    const outstanding = Math.max(
      Number(invoice.amountOriginal || 0) - Number(invoice.paidAmountOriginal || 0),
      0,
    );
    const writeOffAmount = Math.min(Math.max(amount, 0), outstanding);

    const updated = await this.prisma.arInvoice.update({
      where: { id: invoiceId },
      data: {
        status: 'written_off',
        notes: [invoice.notes, `[write-off] amount=${writeOffAmount}; reason=${reason}`]
          .filter(Boolean)
          .join('\n'),
      },
    });

    const accounts = await this.prisma.account.findMany({
      where: {
        entityId: invoice.entityId,
        code: { in: ['1191', '6134'] },
        isActive: true,
      },
    });
    const accountMap = new Map(accounts.map((account) => [account.code, account]));
    const arAccount = accountMap.get('1191');
    const badDebtExpense = accountMap.get('6134');

    if (writeOffAmount > 0 && arAccount && badDebtExpense) {
      const period = await this.prisma.period.findFirst({
        where: {
          entityId: invoice.entityId,
          status: 'open',
        },
        orderBy: { startDate: 'desc' },
      });

      await this.journalService.createJournalEntry({
        entityId: invoice.entityId,
        date: new Date(),
        description: `呆帳沖銷 ${invoice.invoiceNo || invoice.id}`,
        sourceModule: 'ar_write_off',
        sourceId: invoice.id,
        periodId: period?.id,
        createdBy: 'system',
        lines: [
          {
            accountId: badDebtExpense.id,
            debit: writeOffAmount,
            credit: 0,
            currency: invoice.amountCurrency,
            fxRate: Number(invoice.amountFxRate || 1),
            amountBase: Number(
              (writeOffAmount * Number(invoice.amountFxRate || 1)).toFixed(2),
            ),
            memo: reason || '呆帳沖銷',
          },
          {
            accountId: arAccount.id,
            debit: 0,
            credit: writeOffAmount,
            currency: invoice.amountCurrency,
            fxRate: Number(invoice.amountFxRate || 1),
            amountBase: Number(
              (writeOffAmount * Number(invoice.amountFxRate || 1)).toFixed(2),
            ),
            memo: '沖銷應收帳款',
          },
        ],
      });
    }

    return updated;
  }

  private sumAmount<T extends Record<string, any>>(
    items: T[],
    field: keyof T,
  ): number {
    return items.reduce((sum, item) => sum + Number(item[field] || 0), 0);
  }

  private buildDueDate(orderDate: Date, outstandingAmount: number, termDays = 30) {
    const dueDate = new Date(orderDate);
    dueDate.setDate(dueDate.getDate() + (outstandingAmount > 0 ? termDays : 0));
    return dueDate;
  }

  private buildNextStatementDate(asOfDate: Date) {
    const statementDate = new Date(asOfDate);
    statementDate.setMonth(statementDate.getMonth() + 1, 5);
    statementDate.setHours(0, 0, 0, 0);
    return statementDate.toISOString();
  }

  private daysPastDue(dueDate: string | Date, asOfDate: Date) {
    const due = new Date(dueDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((asOfDate.getTime() - due.getTime()) / msPerDay);
  }

  private resolvePaymentTermDays(
    customer: {
      type?: string | null;
      paymentTermDays?: number | null;
      paymentTerms?: string | null;
      isMonthlyBilling?: boolean | null;
    } | null,
    meta: Record<string, string>,
    outstandingAmount: number,
  ) {
    if (outstandingAmount <= 0) {
      return 0;
    }

    const customerTermDays = Number(customer?.paymentTermDays || 0);
    if (Number.isFinite(customerTermDays) && customerTermDays > 0) {
      return customerTermDays;
    }

    const explicitTerm = Number(meta.termDays || meta.paymentTermDays || 0);
    if (Number.isFinite(explicitTerm) && explicitTerm > 0) {
      return explicitTerm;
    }

    const paymentTerm = (
      customer?.paymentTerms ||
      meta.paymentTerm ||
      meta.creditTerm ||
      meta.billingTerm ||
      ''
    ).toLowerCase();
    const netMatch = paymentTerm.match(/net\s*([0-9]+)/);
    if (netMatch?.[1]) {
      return Number(netMatch[1]);
    }

    if (
      customer?.type === 'company' ||
      customer?.isMonthlyBilling ||
      ['true', '1', 'yes'].includes(
        (meta.monthlyBilling || meta.isMonthlyBilling || '').toLowerCase(),
      ) ||
      paymentTerm.includes('month') ||
      paymentTerm.includes('月結')
    ) {
      return 30;
    }

    return 30;
  }

  private resolveReceivableStatus(params: {
    grossAmount: number;
    paidAmount: number;
    dueDate: Date;
  }) {
    if (params.paidAmount >= params.grossAmount && params.grossAmount > 0) {
      return 'paid';
    }
    if (params.paidAmount > 0) {
      return params.dueDate.getTime() < Date.now() ? 'overdue' : 'partial';
    }
    return params.dueDate.getTime() < Date.now() ? 'overdue' : 'unpaid';
  }

  private resolveTaxAmount(
    order: {
      totalGrossOriginal: Decimal;
      taxAmountOriginal: Decimal;
    },
    fallbackTaxAmount?: Decimal | null,
  ) {
    const directTax = Number(order.taxAmountOriginal || 0);
    if (directTax > 0) {
      return directTax;
    }

    const invoiceTax = Number(fallbackTaxAmount || 0);
    if (invoiceTax > 0) {
      return invoiceTax;
    }

    return 0;
  }

  private resolveOrderSource(channelCode?: string | null, notes?: string | null) {
    const meta = this.extractMetadata(notes);
    const normalizedChannel = (channelCode || '').trim().toUpperCase();

    if (normalizedChannel === 'SHOPIFY') {
      return {
        label: 'MOZTECH 官網',
        brand: 'MOZTECH',
      };
    }

    if (normalizedChannel === '1SHOP') {
      const storeName = meta.storeName || meta.storeAccount || '萬魔未來工學院團購';
      return {
        label: storeName,
        brand: storeName.includes('萬魔') ? '萬魔未來工學院' : storeName,
      };
    }

    if (normalizedChannel === 'SHOPLINE') {
      const storeName = meta.storeName || meta.storeHandle || 'Shopline';
      return {
        label: storeName,
        brand: storeName.includes('萬魔') ? '萬魔未來工學院' : storeName,
      };
    }

    return {
      label: meta.storeName || meta.storeHandle || '其他來源',
      brand: meta.storeName || meta.storeHandle || '其他來源',
    };
  }

  private classifyReceivable(params: {
    customerId?: string | null;
    customerName: string;
    customerType: string;
    channelCode?: string | null;
    channelName?: string | null;
    source: { label: string; brand: string };
    customer?: {
      type?: string | null;
      paymentTerms?: string | null;
      paymentTermDays?: number | null;
      isMonthlyBilling?: boolean | null;
    } | null;
    notes?: string | null;
    payments: Array<{
      channel: string;
      status: string;
      notes: string | null;
      reconciledFlag: boolean;
      payoutDate: Date | null;
    }>;
    outstandingAmount: number;
    paidAmount: number;
    reconciledFlag: boolean;
    dueDate: Date;
    termDays: number;
  }) {
    const channelCode = (params.channelCode || '').trim().toUpperCase();
    const meta = this.extractMetadata(params.notes);
    const paymentMethodGroup = this.resolvePaymentMethodGroup(params.payments, meta);
    const paymentMethodLabel = this.paymentMethodLabel(paymentMethodGroup);
    const isB2B = this.isB2BReceivable(params.customerType, meta, params.customer);
    const isGroupBuy =
      channelCode === '1SHOP' ||
      params.source.brand.includes('萬魔') ||
      params.source.brand.includes('萬物') ||
      params.source.label.includes('團購');
    const isShopline = channelCode === 'SHOPLINE';
    const isCod = ['cod', 'cvs_pickup_pay'].includes(paymentMethodGroup);

    let collectionType = 'b2c_platform';
    let collectionTypeLabel = 'B2C 平台應收';
    if (isB2B) {
      collectionType = 'b2b_monthly';
      collectionTypeLabel = 'B2B 月結應收';
    } else if (isGroupBuy) {
      collectionType = 'groupbuy';
      collectionTypeLabel = '團購 / 1Shop 應收';
    } else if (isShopline) {
      collectionType = 'shopline';
      collectionTypeLabel = 'Shopline 應收';
    } else if (isCod) {
      collectionType = 'b2c_cod';
      collectionTypeLabel = 'B2C 貨到付款應收';
    }

    const settlementPhase = this.resolveSettlementPhase({
      outstandingAmount: params.outstandingAmount,
      paidAmount: params.paidAmount,
      reconciledFlag: params.reconciledFlag,
      dueDate: params.dueDate,
      paymentMethodGroup,
    });
    const collectionOwner = this.resolveCollectionOwner({
      isB2B,
      paymentMethodGroup,
      channelCode,
    });
    const receivableGroupKey = this.buildReceivableGroupKey({
      collectionType,
      paymentMethodGroup,
      customerId: params.customerId,
      customerName: params.customerName,
      channelCode,
      sourceBrand: params.source.brand,
      termDays: params.termDays,
    });
    const receivableGroupLabel = this.buildReceivableGroupLabel({
      collectionType,
      paymentMethodLabel,
      customerName: params.customerName,
      channelName: params.channelName,
      sourceLabel: params.source.label,
      sourceBrand: params.source.brand,
      termDays: params.termDays,
    });

    return {
      collectionType,
      collectionTypeLabel,
      paymentMethodGroup,
      paymentMethodLabel,
      settlementPhase,
      settlementPhaseLabel: this.settlementPhaseLabel(settlementPhase),
      receivableGroupKey,
      receivableGroupLabel,
      collectionOwner,
      collectionOwnerLabel: this.collectionOwnerLabel(collectionOwner),
      termDays: params.termDays,
      settlementDiagnostic: this.settlementDiagnostic({
        settlementPhase,
        paymentMethodGroup,
        collectionOwner,
      }),
    };
  }

  private resolvePaymentMethodGroup(
    payments: Array<{
      channel: string;
      status: string;
      notes: string | null;
    }>,
    orderMeta: Record<string, string>,
  ) {
    const paymentMetaText = payments
      .map((payment) => {
        const meta = this.extractMetadata(payment.notes);
        return [
          payment.channel,
          payment.status,
          payment.notes,
          meta.paymentMethod,
          meta.paymentType,
          meta.gateway,
          meta.logisticsType,
          meta.logisticType,
          meta.shippingType,
          meta.paymentName,
        ]
          .filter(Boolean)
          .join(' ');
      })
      .join(' ');
    const text = [
      paymentMetaText,
      orderMeta.paymentMethod,
      orderMeta.paymentType,
      orderMeta.gateway,
      orderMeta.logisticsType,
      orderMeta.logisticType,
      orderMeta.shippingType,
      orderMeta.paymentName,
      orderMeta.orderPaymentType,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (
      text.includes('credit') ||
      text.includes('card') ||
      text.includes('信用卡') ||
      text.includes('刷卡')
    ) {
      return 'credit_card';
    }
    if (
      text.includes('取貨付款') ||
      text.includes('超商貨到付款') ||
      text.includes('cvs') ||
      text.includes('pickup')
    ) {
      return 'cvs_pickup_pay';
    }
    if (
      text.includes('cod') ||
      text.includes('cash on delivery') ||
      text.includes('貨到付款')
    ) {
      return 'cod';
    }
    if (
      text.includes('bank') ||
      text.includes('transfer') ||
      text.includes('銀行') ||
      text.includes('匯款')
    ) {
      return 'bank_transfer';
    }
    if (text.includes('atm')) {
      return 'atm';
    }

    return payments.length ? 'gateway_other' : 'unpaid_or_unknown';
  }

  private paymentMethodLabel(paymentMethodGroup: string) {
    const labels: Record<string, string> = {
      credit_card: '信用卡',
      cvs_pickup_pay: '超商取貨付款',
      cod: '貨到付款',
      bank_transfer: '銀行匯款 / 月結',
      atm: 'ATM',
      gateway_other: '其他金流',
      unpaid_or_unknown: '未付款 / 待確認',
    };
    return labels[paymentMethodGroup] || '其他應收';
  }

  private isB2BReceivable(
    customerType: string,
    meta: Record<string, string>,
    customer?: {
      paymentTerms?: string | null;
      paymentTermDays?: number | null;
      isMonthlyBilling?: boolean | null;
    } | null,
  ) {
    const paymentTerm = (
      customer?.paymentTerms ||
      meta.paymentTerm ||
      meta.creditTerm ||
      meta.billingTerm ||
      ''
    ).toLowerCase();
    return (
      customerType === 'company' ||
      Boolean(customer?.isMonthlyBilling) ||
      Number(customer?.paymentTermDays || 0) > 0 ||
      paymentTerm.includes('net') ||
      paymentTerm.includes('月結') ||
      ['true', '1', 'yes'].includes(
        (meta.monthlyBilling || meta.isMonthlyBilling || '').toLowerCase(),
      )
    );
  }

  private resolveSettlementPhase(params: {
    outstandingAmount: number;
    paidAmount: number;
    reconciledFlag: boolean;
    dueDate: Date;
    paymentMethodGroup: string;
  }) {
    if (params.outstandingAmount <= 0 && params.reconciledFlag) {
      return 'settled';
    }
    if (params.outstandingAmount > 0 && params.dueDate.getTime() < Date.now()) {
      return 'overdue';
    }
    if (params.paidAmount <= 0) {
      return 'unpaid';
    }
    if (!params.reconciledFlag) {
      return ['cod', 'cvs_pickup_pay'].includes(params.paymentMethodGroup)
        ? 'in_transit'
        : 'pending_payout';
    }
    if (params.outstandingAmount > 0) {
      return 'partial';
    }
    return 'reconciled';
  }

  private settlementPhaseLabel(phase: string) {
    const labels: Record<string, string> = {
      unpaid: '待收款',
      in_transit: '在途待撥款',
      pending_payout: '待撥款',
      partial: '部分收款',
      reconciled: '已對帳',
      settled: '已核銷',
      overdue: '逾期應收',
    };
    return labels[phase] || '待確認';
  }

  private resolveCollectionOwner(params: {
    isB2B: boolean;
    paymentMethodGroup: string;
    channelCode: string;
  }) {
    if (params.isB2B) {
      return 'customer_ar';
    }
    if (['cod', 'cvs_pickup_pay'].includes(params.paymentMethodGroup)) {
      return 'ecpay_logistics';
    }
    if (['credit_card', 'atm', 'gateway_other'].includes(params.paymentMethodGroup)) {
      return 'ecpay_gateway';
    }
    if (params.channelCode === 'SHOPIFY' || params.channelCode === 'SHOPLINE') {
      return 'platform';
    }
    return 'manual_review';
  }

  private collectionOwnerLabel(owner: string) {
    const labels: Record<string, string> = {
      customer_ar: '客戶月結應收',
      ecpay_logistics: '綠界物流代收',
      ecpay_gateway: '綠界金流撥款',
      platform: '平台結算',
      manual_review: '人工確認',
    };
    return labels[owner] || '待確認';
  }

  private buildReceivableGroupKey(params: {
    collectionType: string;
    paymentMethodGroup: string;
    customerId?: string | null;
    customerName: string;
    channelCode: string;
    sourceBrand: string;
    termDays: number;
  }) {
    if (params.collectionType === 'b2b_monthly') {
      return `b2b:${params.customerId || params.customerName}:net${params.termDays}`;
    }
    if (params.collectionType === 'groupbuy') {
      return `groupbuy:${params.sourceBrand}:${params.paymentMethodGroup}`;
    }
    return `${params.collectionType}:${params.channelCode || 'OTHER'}:${params.paymentMethodGroup}`;
  }

  private buildReceivableGroupLabel(params: {
    collectionType: string;
    paymentMethodLabel: string;
    customerName: string;
    channelName?: string | null;
    sourceLabel: string;
    sourceBrand: string;
    termDays: number;
  }) {
    if (params.collectionType === 'b2b_monthly') {
      return `B2B 月結 · ${params.customerName} · Net ${params.termDays}`;
    }
    if (params.collectionType === 'groupbuy') {
      return `${params.sourceBrand || params.sourceLabel} · ${params.paymentMethodLabel}`;
    }
    if (params.collectionType === 'shopline') {
      return `Shopline · ${params.paymentMethodLabel}`;
    }
    if (params.collectionType === 'b2c_cod') {
      return `${params.sourceLabel || params.channelName || 'B2C'} · ${params.paymentMethodLabel}`;
    }
    return `${params.sourceLabel || params.channelName || '其他平台'} · ${params.paymentMethodLabel}`;
  }

  private settlementDiagnostic(params: {
    settlementPhase: string;
    paymentMethodGroup: string;
    collectionOwner: string;
  }) {
    if (params.settlementPhase === 'settled') {
      return '訂單、收款、撥款與核銷已完成。';
    }
    if (params.settlementPhase === 'overdue') {
      return '已超過應收期限，需優先追蹤未收款或未撥款原因。';
    }
    if (params.collectionOwner === 'ecpay_logistics') {
      return '貨到付款需等消費者取貨付款後，由綠界物流代收款撥款資料回填。';
    }
    if (params.collectionOwner === 'ecpay_gateway') {
      return '需等待綠界金流撥款明細回填，才能確認實際手續費與淨入帳。';
    }
    if (params.collectionOwner === 'customer_ar') {
      return 'B2B 月結應按客戶出帳與收款，逾期後進入催收清單。';
    }
    return '需補足付款方式或平台撥款資料後才能自動核銷。';
  }

  private resolveOverpaidDiagnosis(params: {
    paymentCount: number;
    duplicateAmountGroups: Array<{ amount: number; count: number }>;
    exactDoublePaid: boolean;
    allPaymentsUnreconciled: boolean;
    hasDraftOrPendingPayment: boolean;
  }) {
    if (params.exactDoublePaid && params.duplicateAmountGroups.length) {
      return '已收金額接近訂單金額 2 倍，且存在相同金額付款列，優先檢查是否重複匯入同一筆收款。';
    }
    if (params.duplicateAmountGroups.length) {
      return '存在相同金額付款列，需核對 payoutBatchId / providerPaymentId 是否為同一筆金流。';
    }
    if (params.hasDraftOrPendingPayment) {
      return '付款列包含 draft 或 pending，可能是待付款草稿未在成功收款後清除。';
    }
    if (params.allPaymentsUnreconciled) {
      return '付款列尚未完成撥款 / 銀行核銷，需先核對是否同客戶合併收款或重複同步。';
    }
    if (params.paymentCount > 1) {
      return '同一訂單存在多筆付款，需核對是否為分期、合併收款拆帳、退款折讓未回寫或重複匯入。';
    }
    return '單筆付款金額高於訂單金額，需核對外部平台原始收款與訂單金額。';
  }

  private resolveOverpaidResolution(params: {
    grossAmount: number;
    paidAmount: number;
    paymentCount: number;
    duplicateAmountGroups: Array<{ amount: number; count: number }>;
    exactDoublePaid: boolean;
    allPaymentsUnreconciled: boolean;
    hasDraftOrPendingPayment: boolean;
    payments: Array<{
      paymentId: string;
      amountGrossOriginal: number;
      createdAt: string;
      payoutDate: string;
      reconciledFlag: boolean;
      providerPaymentId?: string | null;
      payoutBatchId?: string | null;
    }>;
  }) {
    const duplicatedFullAmount = params.duplicateAmountGroups.some(
      (group) => Math.abs(Number(group.amount || 0) - params.grossAmount) <= 1,
    );
    const duplicateCandidatePayments = this.findDuplicatePaymentCandidates(
      params.payments,
    );

    if (
      params.paymentCount === 2 &&
      params.exactDoublePaid &&
      params.allPaymentsUnreconciled &&
      duplicatedFullAmount &&
      duplicateCandidatePayments.length === 1
    ) {
      return {
        category: 'duplicate_import_candidate',
        label: '高度疑似重複匯入',
        action:
          '先核對兩筆付款是否對應同一筆外部收款；若確認重複，保留較早建立的付款列，較晚付款列進人工更正流程。',
        checks: [
          '兩筆付款金額皆等於訂單金額',
          '已收金額接近訂單金額 2 倍',
          '兩筆付款尚未核銷',
          '刪除或合併前需核對 providerPaymentId 與 payoutBatchId',
        ],
        candidateDuplicatePaymentIds: duplicateCandidatePayments,
      };
    }

    if (
      params.exactDoublePaid &&
      params.duplicateAmountGroups.length &&
      params.allPaymentsUnreconciled
    ) {
      return {
        category: 'multi_payment_review',
        label: '多筆同金額待審核',
        action:
          '先確認是否為拆帳、合併收款或重複同步；不可直接刪除，需逐筆對 providerPaymentId / payoutBatchId。',
        checks: [
          '存在相同金額付款列',
          '已收金額接近訂單金額 2 倍或以上',
          '目前尚未核銷',
        ],
        candidateDuplicatePaymentIds: duplicateCandidatePayments,
      };
    }

    if (params.hasDraftOrPendingPayment) {
      return {
        category: 'manual_review',
        label: '待付款 / 草稿狀態待查',
        action:
          '先確認 pending 或 draft 付款是否應轉成功、作廢或保留，不可用自動規則更正。',
        checks: ['付款列包含 pending 或 draft 狀態'],
        candidateDuplicatePaymentIds: duplicateCandidatePayments,
      };
    }

    return {
      category: 'manual_review',
      label: '人工判斷',
      action:
        '需人工核對是否為單筆超額付款、退款折讓未回寫、合併收款拆帳或外部平台金額異常。',
      checks: ['目前不符合保守重複匯入候選規則'],
      candidateDuplicatePaymentIds: duplicateCandidatePayments,
    };
  }

  private findDuplicatePaymentCandidates(
    payments: Array<{
      paymentId: string;
      amountGrossOriginal: number;
      createdAt: string;
      payoutDate: string;
    }>,
  ) {
    const grouped = payments.reduce<Record<string, typeof payments>>(
      (acc, payment) => {
        const key = Number(payment.amountGrossOriginal || 0).toFixed(2);
        acc[key] = acc[key] || [];
        acc[key].push(payment);
        return acc;
      },
      {},
    );

    return Object.values(grouped)
      .filter((group) => group.length > 1)
      .flatMap((group) =>
        [...group]
          .sort((left, right) => {
            const leftTime = Date.parse(left.createdAt || left.payoutDate || '');
            const rightTime = Date.parse(right.createdAt || right.payoutDate || '');
            return leftTime - rightTime;
          })
          .slice(1)
          .map((payment) => payment.paymentId),
      );
  }

  private extractMetadata(notes?: string | null) {
    const text = notes || '';
    const meta: Record<string, string> = {};

    for (const segment of text.split(/[;\n]/)) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }
      const [rawKey, ...rest] = trimmed.split('=');
      if (!rawKey || !rest.length) {
        continue;
      }
      const key = rawKey.replace(/^\[[^\]]+\]\s*/, '').trim();
      meta[key] = rest.join('=').trim();
    }

    return meta;
  }

  private resolveFeeTelemetry(
    payments: Array<{ notes: string | null; reconciledFlag: boolean }>,
  ) {
    const candidates = payments.map((payment) => ({
      meta: this.extractMetadata(payment.notes),
      reconciledFlag: payment.reconciledFlag,
    }));

    const actual =
      candidates.find(
        (candidate) =>
          candidate.reconciledFlag || candidate.meta.feeStatus === 'actual',
      ) || null;
    const estimated =
      candidates.find((candidate) => candidate.meta.feeStatus === 'estimated') ||
      null;
    const fallback = candidates[0] || null;
    const resolved = actual || estimated || fallback;
    const status = resolved?.meta.feeStatus || 'unavailable';
    const source = resolved?.meta.feeSource || null;

    if (!payments.length) {
      return {
        status,
        source,
        diagnostic: '尚無收款紀錄，手續費會在收款後才開始追蹤。',
      };
    }

    if (status === 'actual') {
      return {
        status,
        source,
        diagnostic: '已回填實際金流/平台手續費。',
      };
    }

    if (status === 'estimated') {
      return {
        status,
        source,
        diagnostic: '目前仍是暫估手續費，需等待綠界/平台撥款對帳後才會轉成實際值。',
      };
    }

    return {
      status,
      source,
      diagnostic:
        '原始訂單 API 沒有提供實際手續費，需等綠界或平台撥款資料回填。',
    };
  }

  private buildArNote(existingNotes?: string | null, invoiceNumber?: string | null) {
    const parts = ['source=sales-order-auto-sync'];
    if (invoiceNumber) {
      parts.push(`invoiceNumber=${invoiceNumber}`);
    }
    const autoNote = `[sales-ar] ${parts.join('; ')}`;
    const preserved = (existingNotes || '')
      .split('\n')
      .filter((line) => !line.startsWith('[sales-ar]'))
      .join('\n')
      .trim();

    return preserved ? `${preserved}\n${autoNote}` : autoNote;
  }

  /**
   * 應收帳款摘要（2026-04）
   * 供 Dashboard 財務快覽 GET /ar/summary 使用
   */
  async getSummary(entityId?: string) {
    return this.arRepository.getSummary(entityId);
  }
}
