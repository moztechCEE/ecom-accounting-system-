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

  async getReceivableMonitor(entityId: string, status?: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        status: {
          notIn: ['cancelled', 'refunded'],
        },
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
    const [arInvoices, journals] = await Promise.all([
      this.prisma.arInvoice.findMany({
        where: {
          entityId,
          sourceId: {
            in: orderIds.length ? orderIds : ['__none__'],
          },
        },
        orderBy: { createdAt: 'desc' },
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

    const items = orders
      .map((order) => {
        const arInvoice = arMap.get(order.id) || null;
        const journal = journalMap.get(order.id) || null;
        const latestInvoice = order.invoices[0] || null;
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
        const dueDate =
          arInvoice?.dueDate || this.buildDueDate(order.orderDate, outstandingAmount);
        const computedStatus = this.resolveReceivableStatus({
          grossAmount,
          paidAmount,
          dueDate,
        });
        const source = this.resolveOrderSource(order.channel?.code, order.notes);
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

        return {
          orderId: order.id,
          orderNumber: order.externalOrderId || order.id,
          orderDate: order.orderDate.toISOString(),
          customerId: order.customerId || null,
          customerName: order.customer?.name || '散客',
          customerEmail: order.customer?.email || null,
          customerPhone: order.customer?.phone || null,
          customerType: order.customer?.type || 'individual',
          channelCode: order.channel?.code || null,
          channelName: order.channel?.name || null,
          sourceLabel: source.label,
          sourceBrand: source.brand,
          grossAmount,
          revenueAmount,
          taxAmount,
          paidAmount,
          outstandingAmount,
          gatewayFeeAmount,
          platformFeeAmount,
          feeTotal: gatewayFeeAmount + platformFeeAmount,
          netAmount,
          reconciledFlag: order.payments.some((payment) => payment.reconciledFlag),
          payoutCount: order.payments.length,
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
      })
      .filter((item) => (status ? item.arStatus === status : true));

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
      },
    );

    return {
      entityId,
      summary,
      items,
    };
  }

  async syncSalesReceivables(entityId: string, userId: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        status: {
          notIn: ['cancelled', 'refunded'],
        },
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
    // TODO: 驗證資料
    // TODO: 計算金額
    // TODO: 呼叫 AccountingService.createJournalEntry()
    return this.arRepository.createInvoice(data);
  }

  /**
   * 記錄收款
   * TODO: 產生收款分錄（借：銀行存款 / 貸：應收帳款）
   */
  async recordPayment(invoiceId: string, data: any) {
    // TODO: 更新AR發票的 paid_amount
    // TODO: 檢查是否已全部收清（status = PAID）
    // TODO: 產生會計分錄
    return this.arRepository.recordPayment(invoiceId, data);
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
    this.logger.log(`Creating AR invoice from order: ${orderId}`);
    throw new Error('Not implemented: createArFromOrder');
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
    this.logger.log(
      `Applying payment of ${paymentAmount} to invoice ${invoiceId}`,
    );
    throw new Error('Not implemented: applyPayment');
  }

  /**
   * 取得帳齡分析報表
   * @param entityId - 實體ID
   * @param asOfDate - 統計基準日期
   * @returns 帳齡分析報表
   */
  async getAgingReport(entityId: string, asOfDate: Date) {
    this.logger.log(
      `Generating aging report for entity ${entityId} as of ${asOfDate}`,
    );
    throw new Error('Not implemented: getAgingReport');
  }

  /**
   * 呆帳沖銷
   * @param invoiceId - 發票ID
   * @param amount - 沖銷金額
   * @param reason - 沖銷原因
   * @returns 沖銷記錄
   */
  async writeOffBadDebt(invoiceId: string, amount: number, reason: string) {
    this.logger.log(
      `Writing off bad debt for invoice ${invoiceId}, amount: ${amount}, reason: ${reason}`,
    );
    throw new Error('Not implemented: writeOffBadDebt');
  }

  private sumAmount<T extends Record<string, any>>(
    items: T[],
    field: keyof T,
  ): number {
    return items.reduce((sum, item) => sum + Number(item[field] || 0), 0);
  }

  private buildDueDate(orderDate: Date, outstandingAmount: number) {
    const dueDate = new Date(orderDate);
    dueDate.setDate(dueDate.getDate() + (outstandingAmount > 0 ? 30 : 0));
    return dueDate;
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
}
