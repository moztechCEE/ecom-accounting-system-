import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { BankingRepository } from './banking.repository';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 銀行管理服務
 *
 * 核心功能：
 * 1. 銀行帳戶管理
 * 2. 虛擬帳號管理
 * 3. 銀行對帳（Bank Reconciliation）
 * 4. 銀行交易匯入
 */
@Injectable()
export class BankingService {
  private readonly logger = new Logger(BankingService.name);

  constructor(
    private readonly bankingRepository: BankingRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 查詢銀行帳戶列表
   */
  async getBankAccounts(entityId: string) {
    return this.bankingRepository.findBankAccounts(entityId);
  }

  async getBankAccount(id: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id },
      include: {
        bankTransactions: {
          orderBy: { txnDate: 'desc' },
          take: 20,
        },
        virtualAccounts: {
          orderBy: { virtualAccountNo: 'asc' },
        },
      },
    });

    if (!account) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }

    return account;
  }

  /**
   * 建立銀行帳戶
   */
  async createBankAccount(data: any) {
    return this.bankingRepository.createBankAccount({
      entityId: data.entityId,
      bankName: data.bankName,
      branch: data.branch || null,
      accountNo: data.accountNo,
      currency: data.currency || 'TWD',
      isVirtualSupport: Boolean(data.isVirtualSupport),
      metaJson: data.metaJson || null,
      isActive: data.isActive ?? true,
    });
  }

  /**
   * 查詢銀行交易
   */
  async getBankTransactions(
    bankAccountId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    return this.prisma.bankTransaction.findMany({
      where: {
        ...(bankAccountId && { bankAccountId }),
        ...(startDate || endDate
          ? {
              txnDate: {
                ...(startDate && { gte: startDate }),
                ...(endDate && { lte: endDate }),
              },
            }
          : {}),
      },
      include: {
        bankAccount: true,
      },
      orderBy: { txnDate: 'desc' },
    });
  }

  async createBankTransaction(data: any) {
    const amountOriginal = Number(data.amountOriginal || 0);
    const amountFxRate = Number(data.amountFxRate || 1);

    return this.bankingRepository.createBankTransaction({
      bankAccountId: data.bankAccountId,
      txnDate: new Date(data.txnDate || new Date()),
      valueDate: new Date(data.valueDate || data.txnDate || new Date()),
      amountOriginal: new Decimal(amountOriginal),
      amountCurrency: data.amountCurrency || 'TWD',
      amountFxRate: new Decimal(amountFxRate),
      amountBase: new Decimal(
        Number(data.amountBase || (amountOriginal * amountFxRate).toFixed(2)),
      ),
      descriptionRaw: data.descriptionRaw || '',
      referenceNo: data.referenceNo || null,
      virtualAccountNo: data.virtualAccountNo || null,
      batchId: data.batchId || null,
      matchedType: data.matchedType || null,
      matchedId: data.matchedId || null,
      reconcileStatus: data.reconcileStatus || 'unmatched',
    });
  }

  async updateReconciliation(bankTransactionId: string, data: any) {
    return this.prisma.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        matchedType: data.matchedType || null,
        matchedId: data.matchedId || null,
        reconcileStatus: data.reconcileStatus || 'matched',
      },
    });
  }

  async getAccountBalance(id: string) {
    const account = await this.getBankAccount(id);
    const aggregate = await this.prisma.bankTransaction.aggregate({
      where: { bankAccountId: id },
      _sum: { amountOriginal: true, amountBase: true },
    });

    const reconciled = await this.prisma.bankTransaction.aggregate({
      where: { bankAccountId: id, reconcileStatus: 'matched' },
      _sum: { amountOriginal: true, amountBase: true },
    });

    return {
      account: {
        id: account.id,
        bankName: account.bankName,
        branch: account.branch,
        accountNo: account.accountNo,
        currency: account.currency,
      },
      balanceOriginal: Number(aggregate._sum.amountOriginal || 0),
      balanceBase: Number(aggregate._sum.amountBase || 0),
      reconciledOriginal: Number(reconciled._sum.amountOriginal || 0),
      reconciledBase: Number(reconciled._sum.amountBase || 0),
      unreconciledCount: account.bankTransactions.filter(
        (txn) => txn.reconcileStatus !== 'matched',
      ).length,
    };
  }

  /**
   * 匯入銀行對帳單（CSV）
   */
  async importBankStatement(bankAccountId: string, csvFile: Buffer) {
    await this.getBankAccount(bankAccountId);

    const rows = this.parseDelimitedRows(csvFile);
    if (!rows.length) {
      throw new BadRequestException('Bank statement is empty');
    }

    const batchId = `BANK-IMPORT-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let imported = 0;

    for (const row of rows) {
      const txnDateValue = this.pickField(row, [
        'txn_date',
        'date',
        '交易日期',
        '入帳日',
      ]);
      const descriptionRaw =
        this.pickField(row, ['description', '摘要', '說明', 'memo']) || '';

      if (!txnDateValue || !descriptionRaw.trim()) {
        continue;
      }

      const txnDate = this.parseDateValue(txnDateValue);
      const valueDate = this.parseDateValue(
        this.pickField(row, ['value_date', '帳務日期', 'value date']) ||
          txnDateValue,
      );

      const credit = this.parseAmountValue(
        this.pickField(row, ['credit', 'deposit', '收入', '存入']),
      );
      const debit = this.parseAmountValue(
        this.pickField(row, ['debit', 'withdrawal', '支出', '提出']),
      );
      const amount =
        credit !== null
          ? credit
          : debit !== null
            ? -Math.abs(debit)
            : this.parseAmountValue(
                this.pickField(row, ['amount', '金額', '交易金額']),
              );

      if (amount === null) {
        continue;
      }

      await this.createBankTransaction({
        bankAccountId,
        txnDate,
        valueDate,
        amountOriginal: amount,
        amountCurrency: this.pickField(row, ['currency', '幣別']) || 'TWD',
        descriptionRaw,
        referenceNo:
          this.pickField(row, ['reference_no', 'reference', '參考號碼']) ||
          null,
        virtualAccountNo:
          this.pickField(row, ['virtual_account_no', 'virtual account', '虛擬帳號']) ||
          null,
        batchId,
      });
      imported += 1;
    }

    const reconciliation = await this.runAutoReconcile(
      bankAccountId,
      undefined,
      batchId,
    );

    return {
      success: true,
      bankAccountId,
      batchId,
      importedCount: imported,
      reconciliation,
    };
  }

  /**
   * 自動對帳匹配
   * 將銀行交易與系統內的 Payment/Receipt 自動配對
   */
  async autoReconcile(bankAccountId: string, transactionDate: Date) {
    return this.runAutoReconcile(bankAccountId, transactionDate, undefined);
  }

  /**
   * 手動對帳
   */
  async manualReconcile(bankTransactionId: string, paymentId: string) {
    const [transaction, payment] = await Promise.all([
      this.prisma.bankTransaction.findUnique({ where: { id: bankTransactionId } }),
      this.prisma.payment.findUnique({ where: { id: paymentId } }),
    ]);

    if (!transaction) {
      throw new NotFoundException(`Bank transaction ${bankTransactionId} not found`);
    }
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    const updatedTxn = await this.prisma.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        matchedType: 'payment',
        matchedId: paymentId,
        reconcileStatus: 'matched',
      },
    });

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        bankAccountId: transaction.bankAccountId,
        reconciledFlag: true,
        status: 'completed',
      },
    });

    return {
      success: true,
      transaction: updatedTxn,
      matchedType: 'payment',
      matchedId: paymentId,
    };
  }

  /**
   * 產生對帳報表
   */
  async getReconciliationReport(bankAccountId: string, asOfDate: Date) {
    const account = await this.getBankAccount(bankAccountId);
    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        bankAccountId,
        txnDate: { lte: asOfDate },
      },
      orderBy: { txnDate: 'desc' },
    });

    const totalAmount = transactions.reduce(
      (sum, txn) => sum + Number(txn.amountOriginal || 0),
      0,
    );
    const matchedTransactions = transactions.filter(
      (txn) => txn.reconcileStatus === 'matched',
    );
    const unmatchedTransactions = transactions.filter(
      (txn) => txn.reconcileStatus !== 'matched',
    );

    return {
      account: {
        id: account.id,
        bankName: account.bankName,
        accountNo: account.accountNo,
        currency: account.currency,
      },
      asOfDate: asOfDate.toISOString(),
      summary: {
        totalCount: transactions.length,
        matchedCount: matchedTransactions.length,
        unmatchedCount: unmatchedTransactions.length,
        matchedAmount: matchedTransactions.reduce(
          (sum, txn) => sum + Number(txn.amountOriginal || 0),
          0,
        ),
        unmatchedAmount: unmatchedTransactions.reduce(
          (sum, txn) => sum + Number(txn.amountOriginal || 0),
          0,
        ),
        ledgerBalance: totalAmount,
      },
      unmatchedItems: unmatchedTransactions.slice(0, 50),
    };
  }

  /**
   * 虛擬帳號管理
   */
  async createVirtualAccount(data: {
    bankAccountId: string;
    customerId: string;
    virtualAccountNumber: string;
    assignedToType?: string;
    assignedToId?: string;
  }) {
    await this.getBankAccount(data.bankAccountId);

    return this.prisma.virtualAccount.create({
      data: {
        bankAccountId: data.bankAccountId,
        virtualAccountNo: data.virtualAccountNumber,
        assignedToType: data.assignedToType || 'customer',
        assignedToId: data.assignedToId || data.customerId,
        status: 'active',
      },
    });
  }

  /**
   * 虛擬帳號收款自動對帳
   */
  async matchVirtualAccountPayment(
    virtualAccountNumber: string,
    amount: number,
  ) {
    const virtualAccount = await this.prisma.virtualAccount.findFirst({
      where: {
        virtualAccountNo: virtualAccountNumber,
        status: 'active',
      },
      include: {
        bankAccount: true,
      },
    });

    if (!virtualAccount) {
      throw new NotFoundException(
        `Virtual account ${virtualAccountNumber} not found`,
      );
    }

    const candidateTransactions = await this.prisma.bankTransaction.findMany({
      where: {
        bankAccountId: virtualAccount.bankAccountId,
        virtualAccountNo: virtualAccountNumber,
        reconcileStatus: 'unmatched',
      },
      orderBy: { txnDate: 'asc' },
    });

    const targetTransaction = candidateTransactions.find(
      (txn) => Number(txn.amountOriginal || 0) === Number(amount),
    );

    if (!targetTransaction) {
      return {
        success: false,
        matched: false,
        reason: 'No unmatched bank transaction found for this virtual account',
      };
    }

    if (virtualAccount.assignedToType === 'ar_invoice' && virtualAccount.assignedToId) {
      const invoice = await this.prisma.arInvoice.findUnique({
        where: { id: virtualAccount.assignedToId },
      });
      if (!invoice) {
        throw new NotFoundException(
          `AR invoice ${virtualAccount.assignedToId} not found`,
        );
      }

      const paidAmountOriginal =
        Number(invoice.paidAmountOriginal || 0) + Number(amount);
      const amountOriginal = Number(invoice.amountOriginal || 0);
      const status =
        paidAmountOriginal >= amountOriginal
          ? 'paid'
          : paidAmountOriginal > 0
            ? 'partial'
            : invoice.status;

      await this.prisma.arInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmountOriginal: new Decimal(paidAmountOriginal),
          paidAmountBase: new Decimal(paidAmountOriginal),
          status,
        },
      });

      await this.prisma.bankTransaction.update({
        where: { id: targetTransaction.id },
        data: {
          matchedType: 'ar_invoice',
          matchedId: invoice.id,
          reconcileStatus: 'matched',
        },
      });

      return {
        success: true,
        matched: true,
        matchedType: 'ar_invoice',
        matchedId: invoice.id,
        bankTransactionId: targetTransaction.id,
      };
    }

    if (virtualAccount.assignedToType === 'customer' && virtualAccount.assignedToId) {
      const invoice = await this.prisma.arInvoice.findFirst({
        where: {
          customerId: virtualAccount.assignedToId,
          status: { in: ['unpaid', 'partial', 'overdue'] },
        },
        orderBy: { dueDate: 'asc' },
      });

      if (!invoice) {
        return {
          success: false,
          matched: false,
          reason: 'No open AR invoice found for the assigned customer',
        };
      }

      const paidAmountOriginal =
        Number(invoice.paidAmountOriginal || 0) + Number(amount);
      const amountOriginal = Number(invoice.amountOriginal || 0);
      const status =
        paidAmountOriginal >= amountOriginal
          ? 'paid'
          : paidAmountOriginal > 0
            ? 'partial'
            : invoice.status;

      await this.prisma.arInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmountOriginal: new Decimal(paidAmountOriginal),
          paidAmountBase: new Decimal(paidAmountOriginal),
          status,
        },
      });

      await this.prisma.bankTransaction.update({
        where: { id: targetTransaction.id },
        data: {
          matchedType: 'ar_invoice',
          matchedId: invoice.id,
          reconcileStatus: 'matched',
        },
      });

      return {
        success: true,
        matched: true,
        matchedType: 'ar_invoice',
        matchedId: invoice.id,
        bankTransactionId: targetTransaction.id,
      };
    }

    return {
      success: false,
      matched: false,
      reason: 'Virtual account is not assigned to a supported target',
    };
  }

  private async runAutoReconcile(
    bankAccountId: string,
    transactionDate?: Date,
    batchId?: string,
  ) {
    const account = await this.getBankAccount(bankAccountId);
    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        bankAccountId,
        reconcileStatus: 'unmatched',
        ...(batchId ? { batchId } : {}),
        ...(transactionDate
          ? {
              txnDate: {
                gte: this.startOfDay(transactionDate),
                lte: this.endOfDay(transactionDate),
              },
            }
          : {}),
      },
      orderBy: { txnDate: 'asc' },
    });

    let matchedCount = 0;
    let suspiciousCount = 0;

    for (const txn of transactions) {
      const matched = await this.tryMatchBankTransaction(account.entityId, txn);
      if (matched === 'matched') matchedCount += 1;
      if (matched === 'suspicious') suspiciousCount += 1;
    }

    return {
      success: true,
      bankAccountId,
      transactionCount: transactions.length,
      matchedCount,
      suspiciousCount,
      unmatchedCount: Math.max(transactions.length - matchedCount - suspiciousCount, 0),
    };
  }

  private async tryMatchBankTransaction(
    entityId: string,
    txn: {
      id: string;
      amountOriginal: any;
      descriptionRaw: string;
      txnDate: Date;
      bankAccountId: string;
      virtualAccountNo: string | null;
    },
  ) {
    if (txn.virtualAccountNo) {
      const matchedVirtual = await this.matchVirtualAccountPayment(
        txn.virtualAccountNo,
        Number(txn.amountOriginal || 0),
      ).catch(() => null);
      if (matchedVirtual?.matched) {
        return 'matched' as const;
      }
    }

    const amount = Number(txn.amountOriginal || 0);
    const startDate = new Date(txn.txnDate);
    startDate.setDate(startDate.getDate() - 7);
    const endDate = new Date(txn.txnDate);
    endDate.setDate(endDate.getDate() + 7);

    const payments = await this.prisma.payment.findMany({
      where: {
        entityId,
        payoutDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { payoutDate: 'asc' },
      take: 50,
    });

    const exactPayment = payments.find((payment) => {
      const gross = Number(payment.amountGrossOriginal || 0);
      const net = Number(payment.amountNetOriginal || 0);
      return gross === amount || net === amount;
    });

    if (exactPayment) {
      await Promise.all([
        this.prisma.bankTransaction.update({
          where: { id: txn.id },
          data: {
            matchedType: 'payment',
            matchedId: exactPayment.id,
            reconcileStatus: 'matched',
          },
        }),
        this.prisma.payment.update({
          where: { id: exactPayment.id },
          data: {
            bankAccountId: txn.bankAccountId,
            reconciledFlag: true,
            status: 'completed',
          },
        }),
      ]);
      return 'matched' as const;
    }

    const arInvoices = await this.prisma.arInvoice.findMany({
      where: {
        entityId,
        status: { in: ['unpaid', 'partial', 'overdue'] },
        dueDate: { lte: endDate },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    const exactInvoice = arInvoices.find((invoice) => {
      const outstanding =
        Number(invoice.amountOriginal || 0) - Number(invoice.paidAmountOriginal || 0);
      return outstanding === amount;
    });

    if (exactInvoice) {
      const paidAmountOriginal =
        Number(exactInvoice.paidAmountOriginal || 0) + amount;
      const invoiceAmount = Number(exactInvoice.amountOriginal || 0);
      await Promise.all([
        this.prisma.arInvoice.update({
          where: { id: exactInvoice.id },
          data: {
            paidAmountOriginal: new Decimal(paidAmountOriginal),
            paidAmountBase: new Decimal(paidAmountOriginal),
            status: paidAmountOriginal >= invoiceAmount ? 'paid' : 'partial',
          },
        }),
        this.prisma.bankTransaction.update({
          where: { id: txn.id },
          data: {
            matchedType: 'ar_invoice',
            matchedId: exactInvoice.id,
            reconcileStatus: 'matched',
          },
        }),
      ]);
      return 'matched' as const;
    }

    const hasCloseAmount =
      payments.some(
        (payment) =>
          Math.abs(Number(payment.amountGrossOriginal || 0) - amount) <= 5 ||
          Math.abs(Number(payment.amountNetOriginal || 0) - amount) <= 5,
      ) ||
      arInvoices.some((invoice) => {
        const outstanding =
          Number(invoice.amountOriginal || 0) - Number(invoice.paidAmountOriginal || 0);
        return Math.abs(outstanding - amount) <= 5;
      });

    if (hasCloseAmount) {
      await this.prisma.bankTransaction.update({
        where: { id: txn.id },
        data: {
          reconcileStatus: 'suspicious',
        },
      });
      return 'suspicious' as const;
    }

    return 'unmatched' as const;
  }

  private parseDelimitedRows(csvFile: Buffer) {
    const text = csvFile.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (!text) {
      return [] as Array<Record<string, string>>;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return [] as Array<Record<string, string>>;
    }

    const delimiter = lines[0].includes('\t')
      ? '\t'
      : lines[0].includes(';')
        ? ';'
        : ',';

    const headers = lines[0].split(delimiter).map((header) => this.normalizeHeader(header));

    return lines.slice(1).map((line) => {
      const values = line.split(delimiter).map((value) => value.trim());
      return headers.reduce(
        (acc, header, index) => {
          acc[header] = values[index] || '';
          return acc;
        },
        {} as Record<string, string>,
      );
    });
  }

  private normalizeHeader(value: string) {
    return value.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_');
  }

  private pickField(row: Record<string, string>, candidates: string[]) {
    for (const candidate of candidates) {
      const normalized = this.normalizeHeader(candidate);
      if (row[normalized]) {
        return row[normalized];
      }
    }
    return '';
  }

  private parseDateValue(value: string) {
    const normalized = value.trim().replace(/\./g, '-').replace(/\//g, '-');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid date value: ${value}`);
    }
    return parsed;
  }

  private parseAmountValue(value?: string) {
    if (!value) return null;
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`Invalid amount value: ${value}`);
    }
    return parsed;
  }

  private startOfDay(date: Date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  private endOfDay(date: Date) {
    const value = new Date(date);
    value.setHours(23, 59, 59, 999);
    return value;
  }
}
