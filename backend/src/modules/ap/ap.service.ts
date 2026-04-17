import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TaxType } from '@prisma/client';
import { ApRepository } from './ap.repository';
import {
  ApPaymentFrequency,
  BatchCreateApInvoicesDto,
} from './dto/batch-create-ap-invoices.dto';
import { ImportEcpayServiceFeeInvoicesDto } from './dto/import-ecpay-service-fee-invoices.dto';
import { QueryEcpayServiceFeeInvoiceDto } from './dto/query-ecpay-service-fee-invoice.dto';
import { UpdateApInvoiceDto } from './dto/update-ap-invoice.dto';

type EcpayInvoiceProfile = {
  key: string;
  merchantId: string;
  hashKey: string;
  hashIv: string;
  apiUrl: string;
  description?: string;
};

/**
 * 應付帳款服務
 *
 * 核心功能：
 * 1. AP 發票管理
 * 2. 付款記錄
 * 3. 到期應付款報表
 * 4. 付款排程
 */
@Injectable()
export class ApService {
  private readonly logger = new Logger(ApService.name);
  private readonly ecpayInvoiceProfiles: EcpayInvoiceProfile[];

  constructor(
    private readonly apRepository: ApRepository,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.ecpayInvoiceProfiles = this.loadEcpayInvoiceProfiles();
  }

  async getInvoices(entityId?: string) {
    const [invoices, paymentTasks] = await Promise.all([
      this.apRepository.findInvoices(entityId),
      this.apRepository.findPaymentTasks(entityId),
    ]);

    const mappedInvoices = invoices.map((inv) => {
      const metadata = this.extractMetadata(inv.notes);
      const sourceModule = inv.sourceModule || metadata.sourceModule || null;
      const matchedFeeAmount = Number(metadata.matchedGatewayFeeAmount || 0);

      return {
        ...inv,
        source: 'ap_invoice',
        sourceModule,
        serviceType: metadata.serviceType || null,
        merchantKey: metadata.merchantKey || null,
        merchantId: metadata.merchantId || null,
        invoiceIssuedStatus: metadata.invoiceIssuedStatus || null,
        matchedFeeAmount,
        coverageStatus: metadata.coverageStatus || null,
      };
    });

    const taskInvoices = paymentTasks.map((task) => ({
      id: task.id,
      entityId: task.entityId,
      invoiceNo:
        task.expenseRequest?.description?.slice(0, 20) ||
        `EXP-${task.expenseRequestId?.slice(0, 8)}`,
      vendorId: task.vendorId || 'EMP-REIMBURSE',
      vendor: task.vendor || {
        id: 'EMP-REIMBURSE',
        name: task.expenseRequest?.creator?.name
          ? `${task.expenseRequest.creator.name} (員工報銷)`
          : '員工報銷 / 零用金',
        code: 'EMP',
      },
      amountOriginal: task.amountOriginal,
      amountCurrency: task.amountCurrency,
      paidAmountOriginal: task.paidDate ? task.amountOriginal : 0,
      status: task.status === 'pending' ? 'pending' : 'paid',
      invoiceDate: task.createdAt,
      dueDate: task.dueDate || task.createdAt,
      paymentFrequency: 'one_time',
      notes: task.notes,
      source: 'payment_task',
      taxType: null,
      taxAmount: 0,
    }));

    return [...mappedInvoices, ...taskInvoices].sort(
      (a, b) =>
        new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime(),
    );
  }

  /**
   * 建立AP發票
   * TODO: 產生分錄（借：進貨或費用 / 貸：應付帳款）
   */
  async createInvoice(data: any) {
    return this.apRepository.createInvoice(data);
  }

  async importEcpayServiceFeeInvoices(
    payload: ImportEcpayServiceFeeInvoicesDto,
    importedBy?: string,
  ) {
    await this.assertEntityExists(payload.entityId);

    const merchantKey = payload.merchantKey?.trim() || null;
    const merchantId = payload.merchantId?.trim() || null;
    const vendorId = await this.ensureEcpayVendor(
      payload.entityId,
      payload.vendorName?.trim() ||
        this.resolveEcpayVendorLabel(merchantKey, merchantId),
    );
    const autoOffset = payload.autoOffsetByMatchedFees !== false;
    const shouldVerify = payload.verifyIssuedStatus === true;
    const monthlyCoverageCache = new Map<
      string,
      { matchedGatewayFeeAmount: number; coverageStatus: string }
    >();

    let created = 0;
    let updated = 0;
    let paidOffsetCount = 0;
    let verifiedCount = 0;
    let importedAmount = 0;

    for (const record of payload.records) {
      const invoiceNo = record.invoiceNo.trim();
      const invoiceDate = new Date(record.invoiceDate);
      if (Number.isNaN(invoiceDate.getTime())) {
        throw new BadRequestException(`Invalid invoiceDate: ${record.invoiceDate}`);
      }

      const amountOriginal = Number(record.amountOriginal || 0);
      if (amountOriginal <= 0) {
        throw new BadRequestException(
          `Invoice ${invoiceNo} has invalid amountOriginal.`,
        );
      }

      const serviceType = this.normalizeServiceType(record.serviceType);
      const invoiceStatus = (record.invoiceStatus || 'issued').trim() || 'issued';
      const coverageKey = `${merchantKey || merchantId || 'all'}:${this.toMonthKey(invoiceDate)}`;
      let coverage = monthlyCoverageCache.get(coverageKey);
      if (!coverage) {
        coverage = await this.calculateMerchantFeeCoverage(
          payload.entityId,
          merchantKey,
          merchantId,
          invoiceDate,
          serviceType,
        );
        monthlyCoverageCache.set(coverageKey, coverage);
      }

      let issuedStatus = invoiceStatus;
      let verificationNote: string | null = null;
      if (shouldVerify) {
        try {
          const verified = await this.queryEcpayServiceFeeInvoiceStatus({
            merchantKey: merchantKey || undefined,
            merchantId: merchantId || undefined,
            invoiceNo,
            invoiceDate: record.invoiceDate,
          });
          issuedStatus = verified.invoiceIssuedStatus || issuedStatus;
          verificationNote = verified.rawMessage || null;
          if (verified.success) {
            verifiedCount += 1;
          }
        } catch (error) {
          verificationNote =
            error instanceof Error ? error.message : String(error);
        }
      }

      const autoPaid =
        autoOffset &&
        serviceType === 'gateway_fee' &&
        coverage.coverageStatus === 'matched';

      const taxAmount =
        record.taxAmount !== undefined
          ? Number(record.taxAmount)
          : this.calculateIncludedTax(amountOriginal, 0.05);

      const noteLine = this.buildEcpayServiceFeeInvoiceNote({
        merchantKey,
        merchantId,
        serviceType,
        invoiceIssuedStatus: issuedStatus,
        importedBy: importedBy || null,
        matchedGatewayFeeAmount: coverage.matchedGatewayFeeAmount,
        coverageStatus: coverage.coverageStatus,
        relateNumber: record.relateNumber || null,
        verificationNote,
        sourceModule: 'ecpay_service_fee_invoice',
      });

      const sourceId = `${merchantKey || merchantId || 'ecpay'}:${invoiceNo}`;
      const existing = await this.prisma.apInvoice.findFirst({
        where: {
          entityId: payload.entityId,
          sourceModule: 'ecpay_service_fee_invoice',
          sourceId,
        },
      });

      const baseData = {
        entityId: payload.entityId,
        vendorId,
        invoiceNo,
        amountOriginal,
        amountCurrency: (record.amountCurrency || 'TWD').trim() || 'TWD',
        amountFxRate: 1,
        amountBase: amountOriginal,
        invoiceDate,
        dueDate: invoiceDate,
        nextDueDate: null,
        taxType: TaxType.TAXABLE_5_PERCENT,
        taxAmount,
        paymentFrequency: 'one_time',
        isRecurringMonthly: false,
        recurringDayOfMonth: null,
        sourceModule: 'ecpay_service_fee_invoice',
        sourceId,
        approvalStatus: 'approved',
        paidAmountOriginal: autoPaid ? amountOriginal : 0,
        paidAmountCurrency: (record.amountCurrency || 'TWD').trim() || 'TWD',
        paidAmountFxRate: 1,
        paidAmountBase: autoPaid ? amountOriginal : 0,
        status: autoPaid ? 'paid' : 'pending',
        notes: this.mergeNotes(existing?.notes, noteLine, record.note),
      };

      if (existing) {
        await this.prisma.apInvoice.update({
          where: { id: existing.id },
          data: baseData,
        });
        updated += 1;
      } else {
        await this.prisma.apInvoice.create({
          data: baseData,
        });
        created += 1;
      }

      if (autoPaid) {
        paidOffsetCount += 1;
      }
      importedAmount += amountOriginal;
    }

    return {
      entityId: payload.entityId,
      merchantKey,
      merchantId,
      created,
      updated,
      paidOffsetCount,
      verifiedCount,
      importedCount: payload.records.length,
      importedAmount: Number(importedAmount.toFixed(2)),
    };
  }

  async batchImportInvoices(payload: BatchCreateApInvoicesDto) {
    const invoices = payload.invoices.map((invoice) => {
      const dueDate = new Date(invoice.dueDate);
      const invoiceDate = new Date(invoice.invoiceDate);
      const isMonthly = invoice.paymentFrequency === ApPaymentFrequency.MONTHLY;

      const taxType = invoice.taxType ?? null;
      let taxAmount = invoice.taxAmount;

      if (taxAmount === undefined || taxAmount === null) {
        if (
          taxType === TaxType.TAXABLE_5_PERCENT ||
          taxType === TaxType.NON_DEDUCTIBLE_5_PERCENT
        ) {
          taxAmount = Math.round((invoice.amountOriginal / 1.05) * 0.05);
        } else {
          taxAmount = 0;
        }
      }

      return {
        entityId: payload.entityId,
        vendorId: invoice.vendorId,
        invoiceNo: invoice.invoiceNo,
        amountOriginal: invoice.amountOriginal,
        amountCurrency: invoice.amountCurrency ?? 'TWD',
        amountFxRate: 1,
        amountBase: invoice.amountOriginal,
        taxType,
        taxAmount,
        invoiceDate,
        dueDate,
        nextDueDate: isMonthly ? dueDate : null,
        paymentFrequency: invoice.paymentFrequency ?? ApPaymentFrequency.ONE_TIME,
        isRecurringMonthly: isMonthly,
        recurringDayOfMonth: isMonthly ? dueDate.getUTCDate() : null,
        notes: invoice.notes ?? null,
      };
    });

    return this.apRepository.createInvoicesBatch(invoices);
  }

  /**
   * 記錄付款
   * TODO: 產生分錄（借：應付帳款 / 貸：銀行存款）
   */
  async recordPayment(invoiceId: string, data: any) {
    // Check if it's a payment task
    const task = await this.apRepository.findPaymentTaskById(invoiceId);
    if (task) {
      const status = data.newStatus === 'paid' ? 'paid' : 'pending';

      let bankInfo;
      if (data.bankAccountId) {
        const bankAccount = await this.apRepository.findBankAccount(
          data.bankAccountId,
        );
        if (bankAccount) {
          const accountNo = bankAccount.accountNo || '';
          const last5 =
            accountNo.length > 5 ? accountNo.slice(-5) : accountNo;
          bankInfo = {
            bankName: bankAccount.bankName,
            accountLast5: last5,
          };
        }
      }

      if (bankInfo) {
        return this.apRepository.updatePaymentTaskWithBankInfo(
          invoiceId,
          status,
          bankInfo,
        );
      }

      return this.apRepository.updatePaymentTaskStatus(invoiceId, status);
    }

    return this.apRepository.recordPayment(invoiceId, data);
  }

  async updateInvoice(id: string, dto: UpdateApInvoiceDto) {
    const data: Record<string, unknown> = {};
    if (dto.paymentFrequency) {
      data.paymentFrequency = dto.paymentFrequency;
      if (dto.paymentFrequency === ApPaymentFrequency.MONTHLY) {
        data.isRecurringMonthly = true;
        if (dto.recurringDayOfMonth) {
          data.recurringDayOfMonth = dto.recurringDayOfMonth;
        }
      } else {
        data.isRecurringMonthly = false;
        data.recurringDayOfMonth = null;
        data.nextDueDate = null;
      }
    }
    if (typeof dto.isRecurringMonthly === 'boolean') {
      data.isRecurringMonthly = dto.isRecurringMonthly;
    }
    if (dto.recurringDayOfMonth) {
      data.recurringDayOfMonth = dto.recurringDayOfMonth;
    }
    if (dto.dueDate) {
      const dueDate = new Date(dto.dueDate);
      data.dueDate = dueDate;
      if (data.isRecurringMonthly || dto.paymentFrequency === ApPaymentFrequency.MONTHLY) {
        data.nextDueDate = dueDate;
      }
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes;
    }

    return this.apRepository.updateInvoice(id, data);
  }

  /**
   * 到期應付款報表
   * 依到期日分組統計
   */
  async getDuePayablesReport(entityId: string) {
    // TODO: 依 due_date 分組
    return {
      entityId,
      asOfDate: new Date(),
      buckets: [
        { label: '已逾期', amount: 0 },
        { label: '7天內到期', amount: 0 },
        { label: '30天內到期', amount: 0 },
        { label: '30天後到期', amount: 0 },
      ],
      totalAp: 0,
    };
  }

  /**
   * 批次付款
   */
  async batchPayment(invoiceIds: string[], paymentDate: Date) {
    // TODO: 批次產生付款記錄與分錄
  }

  /**
   * 付款排程
   */
  async schedulePayment(invoiceId: string, scheduledDate: Date) {
    // TODO: 設定付款排程
  }

  /**
   * 從費用申請建立應付發票
   * @param expenseRequestId - 費用申請ID
   * @returns 建立的應付發票
   */
  async createApFromExpenseRequest(expenseRequestId: string) {
    this.logger.log(
      `Creating AP invoice from expense request: ${expenseRequestId}`,
    );
    throw new Error('Not implemented: createApFromExpenseRequest');
  }

  /**
   * 標記為已付款
   * @param invoiceId - 發票ID
   * @param paymentDate - 付款日期
   * @param bankAccountId - 銀行帳戶ID
   * @returns 更新後的發票資訊
   */
  async markAsPaid(
    invoiceId: string,
    paymentDate: Date,
    bankAccountId: string,
  ) {
    this.logger.log(
      `Marking invoice ${invoiceId} as paid, payment date: ${paymentDate}`,
    );
    throw new Error('Not implemented: markAsPaid');
  }

  /**
   * 取得到期報表
   * @param entityId - 實體ID
   * @param asOfDate - 統計基準日期
   * @returns 到期報表
   */
  async getDueReport(entityId: string, asOfDate: Date) {
    this.logger.log(
      `Generating due report for entity ${entityId} as of ${asOfDate}`,
    );
    throw new Error('Not implemented: getDueReport');
  }

  /**
   * 套用折扣
   * @param invoiceId - 發票ID
   * @param discountAmount - 折扣金額
   * @returns 更新後的發票資訊
   */
  async applyDiscount(invoiceId: string, discountAmount: number) {
    this.logger.log(
      `Applying discount of ${discountAmount} to invoice ${invoiceId}`,
    );
    throw new Error('Not implemented: applyDiscount');
  }

  async getInvoiceAlerts(entityId?: string) {
    return this.apRepository.getInvoiceAlerts(entityId);
  }

  async getEcpayServiceFeeInvoiceSummary(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    await this.assertEntityExists(entityId);
    const dateWhere =
      startDate || endDate
        ? {
            invoiceDate: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {};

    const invoices = await this.prisma.apInvoice.findMany({
      where: {
        entityId,
        sourceModule: 'ecpay_service_fee_invoice',
        ...dateWhere,
      },
      orderBy: { invoiceDate: 'desc' },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const items = invoices.map((invoice) => {
      const metadata = this.extractMetadata(invoice.notes);
      const amountOriginal = Number(invoice.amountOriginal || 0);
      const paidAmountOriginal = Number(invoice.paidAmountOriginal || 0);
      return {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        invoiceDate: invoice.invoiceDate.toISOString(),
        amountOriginal,
        paidAmountOriginal,
        status: invoice.status,
        vendorName: invoice.vendor?.name || null,
        merchantKey: metadata.merchantKey || null,
        merchantId: metadata.merchantId || null,
        serviceType: metadata.serviceType || null,
        invoiceIssuedStatus: metadata.invoiceIssuedStatus || null,
        matchedGatewayFeeAmount: Number(metadata.matchedGatewayFeeAmount || 0),
        coverageStatus: metadata.coverageStatus || null,
      };
    });

    const summary = items.reduce(
      (acc, item) => {
        acc.invoiceCount += 1;
        acc.invoiceAmount += item.amountOriginal;
        acc.paidOffsetAmount += item.paidAmountOriginal;
        if (item.invoiceIssuedStatus === 'issued') {
          acc.issuedCount += 1;
        }
        if (item.status === 'paid') {
          acc.paidOffsetCount += 1;
        }
        if (item.coverageStatus === 'matched') {
          acc.matchedCount += 1;
        }
        if (item.coverageStatus !== 'matched') {
          acc.unmatchedCount += 1;
        }
        return acc;
      },
      {
        invoiceCount: 0,
        invoiceAmount: 0,
        paidOffsetAmount: 0,
        issuedCount: 0,
        paidOffsetCount: 0,
        matchedCount: 0,
        unmatchedCount: 0,
      },
    );

    return {
      entityId,
      range: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      summary: {
        ...summary,
        invoiceAmount: Number(summary.invoiceAmount.toFixed(2)),
        paidOffsetAmount: Number(summary.paidOffsetAmount.toFixed(2)),
      },
      items,
    };
  }

  async queryEcpayServiceFeeInvoiceStatus(
    dto: QueryEcpayServiceFeeInvoiceDto,
  ) {
    const profile = this.resolveEcpayInvoiceProfile(dto.merchantKey, dto.merchantId);
    if (!profile) {
      throw new BadRequestException(
        '找不到可用的綠界電子發票 merchant profile，請先配置 ECPAY_INVOICE_MERCHANTS_JSON。',
      );
    }

    const invoiceDate = new Date(dto.invoiceDate);
    if (Number.isNaN(invoiceDate.getTime())) {
      throw new BadRequestException(`Invalid invoiceDate: ${dto.invoiceDate}`);
    }

    const payload = {
      MerchantID: profile.merchantId,
      InvoiceNo: dto.invoiceNo.trim(),
      InvoiceDate: this.formatInvoiceDate(invoiceDate),
    };
    const body = {
      MerchantID: profile.merchantId,
      RqHeader: {
        Timestamp: Math.floor(Date.now() / 1000),
      },
      Data: this.encryptEcpayInvoicePayload(payload, profile),
    };

    const response = await fetch(profile.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await response.json();

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `綠界電子發票查詢失敗 (${response.status})`,
      );
    }

    if (Number(json?.TransCode) !== 1 || !json?.Data) {
      throw new ServiceUnavailableException(
        json?.TransMsg || '綠界電子發票查詢未成功受理。',
      );
    }

    const decrypted = this.decryptEcpayInvoicePayload(json.Data, profile);
    const result =
      typeof decrypted === 'string' && decrypted.trim()
        ? JSON.parse(decrypted)
        : {};

    return {
      merchantKey: profile.key,
      merchantId: profile.merchantId,
      invoiceNo: dto.invoiceNo.trim(),
      invoiceDate: this.formatInvoiceDate(invoiceDate),
      success: Number(result?.RtnCode) === 1,
      invoiceIssuedStatus: Number(result?.RtnCode) === 1 ? 'issued' : 'unknown',
      rawMessage: result?.RtnMsg || json?.TransMsg || null,
      raw: result,
    };
  }

  private async ensureEcpayVendor(entityId: string, vendorName: string) {
    const existing = await this.prisma.vendor.findFirst({
      where: {
        entityId,
        name: vendorName,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return existing.id;
    }

    const created = await this.prisma.vendor.create({
      data: {
        entityId,
        name: vendorName,
        defaultCurrency: 'TWD',
        contactPerson: 'ECPay',
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    return created.id;
  }

  private resolveEcpayVendorLabel(
    merchantKey: string | null,
    merchantId: string | null,
  ) {
    if (merchantKey === 'shopify-main' || merchantId === '3290494') {
      return '綠界科技（MOZTECH 官網）';
    }
    if (merchantKey === 'groupbuy-main' || merchantId === '3150241') {
      return '綠界科技（團購 / Shopline）';
    }
    return '綠界科技';
  }

  private normalizeServiceType(serviceType?: string | null) {
    const value = (serviceType || '').trim();
    if (!value) {
      return 'gateway_fee';
    }
    if (value.includes('電子發票')) {
      return 'einvoice_fee';
    }
    if (value.includes('金物流') || value.includes('手續費')) {
      return 'gateway_fee';
    }
    return value;
  }

  private async calculateMerchantFeeCoverage(
    entityId: string,
    merchantKey: string | null,
    merchantId: string | null,
    invoiceDate: Date,
    serviceType: string,
  ) {
    if (serviceType !== 'gateway_fee') {
      return {
        matchedGatewayFeeAmount: 0,
        coverageStatus: 'not_applicable',
      };
    }

    const monthStart = new Date(
      Date.UTC(invoiceDate.getUTCFullYear(), invoiceDate.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    const monthEnd = new Date(
      Date.UTC(invoiceDate.getUTCFullYear(), invoiceDate.getUTCMonth() + 1, 0, 23, 59, 59, 999),
    );

    const channelCodes = this.resolveMerchantChannelCodes(merchantKey, merchantId);
    const payments = await this.prisma.payment.findMany({
      where: {
        entityId,
        reconciledFlag: true,
        payoutDate: {
          gte: monthStart,
          lte: monthEnd,
        },
        notes: {
          contains: 'feeSource=provider-payout:ecpay',
        },
        ...(channelCodes.length
          ? {
              OR: [
                {
                  channel: {
                    in: channelCodes,
                  },
                },
                {
                  salesOrder: {
                    channel: {
                      code: {
                        in: channelCodes,
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        feeGatewayOriginal: true,
      },
    });

    const matchedGatewayFeeAmount = payments.reduce(
      (sum, payment) => sum + Number(payment.feeGatewayOriginal || 0),
      0,
    );

    return {
      matchedGatewayFeeAmount: Number(matchedGatewayFeeAmount.toFixed(2)),
      coverageStatus: matchedGatewayFeeAmount > 0 ? 'matched' : 'pending_fee_backfill',
    };
  }

  private resolveMerchantChannelCodes(
    merchantKey: string | null,
    merchantId: string | null,
  ) {
    if (merchantKey === 'shopify-main' || merchantId === '3290494') {
      return ['SHOPIFY'];
    }
    if (merchantKey === 'groupbuy-main' || merchantId === '3150241') {
      return ['1SHOP', 'SHOPLINE'];
    }
    return [];
  }

  private buildEcpayServiceFeeInvoiceNote(params: {
    merchantKey: string | null;
    merchantId: string | null;
    serviceType: string;
    invoiceIssuedStatus: string;
    importedBy: string | null;
    matchedGatewayFeeAmount: number;
    coverageStatus: string;
    relateNumber: string | null;
    verificationNote: string | null;
    sourceModule: string;
  }) {
    const parts = [`sourceModule=${params.sourceModule}`];

    if (params.merchantKey) parts.push(`merchantKey=${params.merchantKey}`);
    if (params.merchantId) parts.push(`merchantId=${params.merchantId}`);
    if (params.serviceType) parts.push(`serviceType=${params.serviceType}`);
    if (params.invoiceIssuedStatus) {
      parts.push(`invoiceIssuedStatus=${params.invoiceIssuedStatus}`);
    }
    parts.push(`matchedGatewayFeeAmount=${params.matchedGatewayFeeAmount.toFixed(2)}`);
    parts.push(`coverageStatus=${params.coverageStatus}`);
    if (params.importedBy) parts.push(`importedBy=${params.importedBy}`);
    if (params.relateNumber) parts.push(`relateNumber=${params.relateNumber}`);
    if (params.verificationNote) {
      parts.push(`verificationNote=${params.verificationNote.replace(/;/g, ',')}`);
    }

    return `[ecpay-fee-invoice] ${parts.join('; ')}`;
  }

  private mergeNotes(
    existingNotes: string | null | undefined,
    metadataLine: string,
    note?: string | null,
  ) {
    const preservedLines = (existingNotes || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[ecpay-fee-invoice]'));
    if (note?.trim()) {
      preservedLines.push(note.trim());
    }
    preservedLines.push(metadataLine);
    return preservedLines.join('\n');
  }

  private extractMetadata(notes?: string | null) {
    const metadata: Record<string, string> = {};

    for (const line of (notes || '').split('\n')) {
      const separator = line.indexOf('] ');
      const raw = separator >= 0 ? line.slice(separator + 2) : line;
      for (const pair of raw.split(';')) {
        const [key, ...rest] = pair.split('=');
        if (!key || !rest.length) {
          continue;
        }
        metadata[key.trim()] = rest.join('=').trim();
      }
    }

    return metadata;
  }

  private calculateIncludedTax(grossAmount: number, taxRate: number) {
    if (!grossAmount) {
      return 0;
    }
    return Number((grossAmount - grossAmount / (1 + taxRate)).toFixed(2));
  }

  private toMonthKey(date: Date) {
    return date.toISOString().slice(0, 7);
  }

  private async assertEntityExists(entityId: string) {
    if (!entityId?.trim()) {
      throw new BadRequestException('entityId is required');
    }

    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId.trim() },
      select: { id: true },
    });
    if (!entity) {
      throw new BadRequestException(`Entity not found: ${entityId}`);
    }
  }

  private loadEcpayInvoiceProfiles() {
    const profiles: EcpayInvoiceProfile[] = [];
    const raw =
      this.configService.get<string>('ECPAY_INVOICE_MERCHANTS_JSON', '') || '';
    const fallbackRaw =
      this.configService.get<string>('ECPAY_MERCHANTS_JSON', '') || '';
    const source = raw.trim() ? raw : fallbackRaw;

    if (!source.trim()) {
      return profiles;
    }

    try {
      const parsed = JSON.parse(source);
      if (!Array.isArray(parsed)) {
        return profiles;
      }

      for (const item of parsed) {
        const merchantId =
          typeof item?.merchantId === 'string' ? item.merchantId.trim() : '';
        const hashKey =
          typeof item?.invoiceHashKey === 'string'
            ? item.invoiceHashKey.trim()
            : typeof item?.hashKey === 'string'
              ? item.hashKey.trim()
              : '';
        const hashIv =
          typeof item?.invoiceHashIv === 'string'
            ? item.invoiceHashIv.trim()
            : typeof item?.hashIv === 'string'
              ? item.hashIv.trim()
              : '';

        if (!merchantId || !hashKey || !hashIv) {
          continue;
        }

        profiles.push({
          key:
            typeof item?.key === 'string' && item.key.trim()
              ? item.key.trim()
              : merchantId,
          merchantId,
          hashKey,
          hashIv,
          apiUrl:
            (typeof item?.invoiceApiUrl === 'string' && item.invoiceApiUrl.trim()) ||
            'https://einvoice.ecpay.com.tw/B2CInvoice/GetIssue',
          description:
            typeof item?.description === 'string' ? item.description.trim() : '',
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to parse ECPAY_INVOICE_MERCHANTS_JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return profiles;
  }

  private resolveEcpayInvoiceProfile(
    merchantKey?: string | null,
    merchantId?: string | null,
  ) {
    const normalizedKey = merchantKey?.trim();
    const normalizedMerchantId = merchantId?.trim();
    return this.ecpayInvoiceProfiles.find(
      (profile) =>
        (normalizedKey &&
          (profile.key === normalizedKey ||
            profile.merchantId === normalizedKey)) ||
        (normalizedMerchantId && profile.merchantId === normalizedMerchantId),
    );
  }

  private encryptEcpayInvoicePayload(
    payload: Record<string, unknown>,
    profile: EcpayInvoiceProfile,
  ) {
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const cipher = createCipheriv(
      'aes-128-cbc',
      Buffer.from(profile.hashKey, 'utf8'),
      Buffer.from(profile.hashIv, 'utf8'),
    );
    let encrypted = cipher.update(encoded, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  private decryptEcpayInvoicePayload(
    encrypted: string,
    profile: EcpayInvoiceProfile,
  ) {
    const decipher = createDecipheriv(
      'aes-128-cbc',
      Buffer.from(profile.hashKey, 'utf8'),
      Buffer.from(profile.hashIv, 'utf8'),
    );
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decodeURIComponent(decrypted);
  }

  private formatInvoiceDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }
}
