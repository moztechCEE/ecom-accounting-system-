import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { BankingRepository } from './banking.repository';
import { PrismaService } from '../../common/prisma/prisma.service';

interface ParsedBankStatementTransaction {
  rowNumber: number;
  txnDate: Date;
  valueDate: Date;
  amountOriginal: number;
  amountCurrency: string;
  descriptionRaw: string;
  referenceNo: string | null;
  virtualAccountNo: string | null;
}

interface SkippedBankStatementRow {
  rowNumber: number;
  reason: string;
}

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
  async getBankAccounts(entityId: string, user?: any) {
    const accounts = await this.bankingRepository.findBankAccounts(entityId);
    const visibleAccounts = accounts.filter((account) =>
      this.canViewBankAccount(account, user),
    );

    const balances = await this.getAccountBalances(
      visibleAccounts.map((account) => account.id),
    );

    return visibleAccounts.map((account) =>
      this.serializeBankAccount(account, balances.get(account.id) || 0, user),
    );
  }

  async getBankAccount(id: string, user?: any) {
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

    this.assertCanViewBankAccount(account, user);

    const balance = await this.calculateAccountBalance(id);
    return this.serializeBankAccount(account, balance, user);
  }

  /**
   * 建立銀行帳戶
   */
  async createBankAccount(data: any, user?: any) {
    const allowedUserIds = this.normalizeAllowedUserIds(data.allowedUserIds, user);
    const accountNo = data.accountNo || data.accountNumber;
    if (!accountNo) {
      throw new BadRequestException('accountNo is required');
    }

    const account = await this.bankingRepository.createBankAccount({
      entityId: data.entityId,
      bankName: data.bankName,
      branch: data.branch || null,
      accountNo,
      currency: data.currency || 'TWD',
      isVirtualSupport: Boolean(data.isVirtualSupport),
      metaJson: this.buildBankVisibilityMeta(data.metaJson, allowedUserIds, {
        accountName: data.accountName,
        accountAlias: data.accountAlias,
      }),
      isActive: data.isActive ?? true,
    });

    const openingBalance = Number(data.openingBalance || 0);
    if (openingBalance !== 0) {
      await this.createBankTransaction(
        {
          bankAccountId: account.id,
          txnDate: data.openingBalanceDate || new Date(),
          valueDate: data.openingBalanceDate || new Date(),
          amountOriginal: openingBalance,
          amountCurrency: account.currency,
          descriptionRaw: data.openingBalanceDescription || '期初資金匯入',
          referenceNo: 'OPENING-BALANCE',
          reconcileStatus: 'matched',
        },
        user,
      );
    }

    return this.serializeBankAccount(account, openingBalance, user);
  }

  async updateBankAccountAccess(
    id: string,
    allowedUserIds: string[],
    user?: any,
  ) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }
    this.assertCanManageBankAccount(account, user);

    const normalizedUserIds = this.normalizeAllowedUserIds(allowedUserIds, user);
    const updated = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        metaJson: this.buildBankVisibilityMeta(
          account.metaJson,
          normalizedUserIds,
        ),
      },
    });
    const balance = await this.calculateAccountBalance(updated.id);
    return this.serializeBankAccount(updated, balance, user);
  }

  /**
   * 查詢銀行交易
   */
  async getBankTransactions(
    user: any,
    bankAccountId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const visibleAccountIds = await this.resolveVisibleBankAccountIds(user, bankAccountId);
    if (!visibleAccountIds.length) {
      return [];
    }

    return this.prisma.bankTransaction.findMany({
      where: {
        bankAccountId: { in: visibleAccountIds },
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

  async createBankTransaction(data: any, user?: any) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: data.bankAccountId },
    });
    if (!account) {
      throw new NotFoundException(`Bank account ${data.bankAccountId} not found`);
    }
    this.assertCanManageBankAccount(account, user);

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

  async getAccountBalance(id: string, user?: any) {
    const account = await this.getBankAccount(id, user);
    const aggregate = await this.prisma.bankTransaction.aggregate({
      where: { bankAccountId: id },
      _sum: { amountOriginal: true, amountBase: true },
    });

    const reconciled = await this.prisma.bankTransaction.aggregate({
      where: { bankAccountId: id, reconcileStatus: 'matched' },
      _sum: { amountOriginal: true, amountBase: true },
    });
    const unreconciledCount = await this.prisma.bankTransaction.count({
      where: { bankAccountId: id, reconcileStatus: { not: 'matched' } },
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
      unreconciledCount,
    };
  }

  /**
   * 匯入銀行對帳單（CSV）
   */
  async importBankStatement(user: any, bankAccountId: string, csvFile: Buffer) {
    await this.getBankAccount(bankAccountId, user);

    const parsed = this.parseBankStatementTransactions(csvFile);

    const batchId = `BANK-IMPORT-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let imported = 0;

    for (const transaction of parsed.transactions) {
      await this.createBankTransaction(
        {
          bankAccountId,
          txnDate: transaction.txnDate,
          valueDate: transaction.valueDate,
          amountOriginal: transaction.amountOriginal,
          amountCurrency: transaction.amountCurrency,
          descriptionRaw: transaction.descriptionRaw,
          referenceNo: transaction.referenceNo,
          virtualAccountNo: transaction.virtualAccountNo,
          batchId,
        },
        user,
      );
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
      skippedCount: parsed.skippedRows.length,
      skippedRows: parsed.skippedRows.slice(0, 20),
      reconciliation,
    };
  }

  async previewBankStatement(user: any, bankAccountId: string, csvFile: Buffer) {
    await this.getBankAccount(bankAccountId, user);
    const parsed = this.parseBankStatementTransactions(csvFile);

    return {
      success: true,
      bankAccountId,
      totalRows: parsed.totalRows,
      importableCount: parsed.transactions.length,
      skippedCount: parsed.skippedRows.length,
      sampleRows: parsed.transactions.slice(0, 10).map((row) => ({
        rowNumber: row.rowNumber,
        txnDate: row.txnDate.toISOString(),
        valueDate: row.valueDate.toISOString(),
        amountOriginal: row.amountOriginal,
        amountCurrency: row.amountCurrency,
        descriptionRaw: row.descriptionRaw,
        referenceNo: row.referenceNo,
        virtualAccountNo: row.virtualAccountNo,
      })),
      skippedRows: parsed.skippedRows.slice(0, 20),
    };
  }

  /**
   * 自動對帳匹配
   * 將銀行交易與系統內的 Payment/Receipt 自動配對
   */
  async autoReconcile(user: any, bankAccountId: string, transactionDate: Date) {
    await this.getBankAccount(bankAccountId, user);
    return this.runAutoReconcile(bankAccountId, transactionDate, undefined);
  }

  /**
   * 手動對帳
   */
  async manualReconcile(user: any, bankTransactionId: string, paymentId: string) {
    const [transaction, payment] = await Promise.all([
      this.prisma.bankTransaction.findUnique({ where: { id: bankTransactionId } }),
      this.prisma.payment.findUnique({ where: { id: paymentId } }),
    ]);

    if (!transaction) {
      throw new NotFoundException(`Bank transaction ${bankTransactionId} not found`);
    }
    await this.getBankAccount(transaction.bankAccountId, user);
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
  async getReconciliationReport(user: any, bankAccountId: string, asOfDate: Date) {
    const account = await this.getBankAccount(bankAccountId, user);
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
  async createVirtualAccount(user: any, data: {
    bankAccountId: string;
    customerId: string;
    virtualAccountNumber: string;
    assignedToType?: string;
    assignedToId?: string;
  }) {
    await this.getBankAccount(data.bankAccountId, user);

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
    user?: any,
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
    if (user) {
      this.assertCanViewBankAccount(virtualAccount.bankAccount, user);
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
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });
    if (!account) {
      throw new NotFoundException(`Bank account ${bankAccountId} not found`);
    }
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

  private getRoleCodes(user?: any) {
    return (
      user?.roles
        ?.map((userRole: any) => userRole?.role?.code || userRole?.role?.name)
        .filter(Boolean) || []
    );
  }

  private isSuperAdmin(user?: any) {
    return this.getRoleCodes(user).includes('SUPER_ADMIN');
  }

  private isBankAdmin(user?: any) {
    const roles = this.getRoleCodes(user);
    return roles.includes('SUPER_ADMIN') || roles.includes('ADMIN');
  }

  private getAllowedUserIds(account: { metaJson?: any }) {
    const meta = this.asPlainObject(account.metaJson);
    const ids = Array.isArray(meta.bankVisibleUserIds)
      ? meta.bankVisibleUserIds
      : Array.isArray(meta.allowedUserIds)
        ? meta.allowedUserIds
        : [];
    return ids.map((id) => String(id)).filter(Boolean);
  }

  private canViewBankAccount(account: { metaJson?: any }, user?: any) {
    if (this.isSuperAdmin(user)) return true;
    const allowedUserIds = this.getAllowedUserIds(account);
    return Boolean(user?.id && allowedUserIds.includes(user.id));
  }

  private assertCanViewBankAccount(account: { metaJson?: any }, user?: any) {
    if (!this.canViewBankAccount(account, user)) {
      throw new ForbiddenException('You do not have access to this bank account');
    }
  }

  private assertCanManageBankAccount(account: { metaJson?: any }, user?: any) {
    if (this.isSuperAdmin(user)) return;
    if (this.isBankAdmin(user) && this.canViewBankAccount(account, user)) return;
    throw new ForbiddenException('You cannot manage this bank account');
  }

  private normalizeAllowedUserIds(value: unknown, user?: any) {
    const values = Array.isArray(value) ? value : [];
    const ids = new Set(values.map((id) => String(id)).filter(Boolean));
    if (user?.id && !this.isSuperAdmin(user)) {
      ids.add(user.id);
    }
    return Array.from(ids);
  }

  private buildBankVisibilityMeta(
    metaJson: unknown,
    allowedUserIds: string[],
    extra?: { accountName?: string; accountAlias?: string },
  ) {
    const meta = this.asPlainObject(metaJson);
    const next: Record<string, any> = {
      ...meta,
      bankVisibleUserIds: allowedUserIds,
    };
    if (typeof extra?.accountName !== 'undefined') {
      next.accountName = String(extra.accountName || '').trim();
    }
    if (typeof extra?.accountAlias !== 'undefined') {
      next.accountAlias = String(extra.accountAlias || '').trim();
    }
    return next;
  }

  private serializeBankAccount(account: any, balance: number, user?: any) {
    const meta = this.asPlainObject(account.metaJson);
    return {
      ...account,
      balance,
      allowedUserIds: this.getAllowedUserIds(account),
      accountName: meta.accountName || '',
      accountAlias: meta.accountAlias || '',
      accessScope: this.isSuperAdmin(user) ? 'all' : 'restricted',
    };
  }

  private async calculateAccountBalance(bankAccountId: string) {
    const aggregate = await this.prisma.bankTransaction.aggregate({
      where: { bankAccountId },
      _sum: { amountOriginal: true },
    });
    return Number(aggregate._sum.amountOriginal || 0);
  }

  private async getAccountBalances(bankAccountIds: string[]) {
    const balances = new Map<string, number>();
    if (!bankAccountIds.length) return balances;

    const grouped = await this.prisma.bankTransaction.groupBy({
      by: ['bankAccountId'],
      where: { bankAccountId: { in: bankAccountIds } },
      _sum: { amountOriginal: true },
    });

    for (const row of grouped) {
      balances.set(row.bankAccountId, Number(row._sum.amountOriginal || 0));
    }
    return balances;
  }

  private async resolveVisibleBankAccountIds(user: any, bankAccountId?: string) {
    if (bankAccountId) {
      const account = await this.prisma.bankAccount.findUnique({
        where: { id: bankAccountId },
      });
      if (!account) {
        throw new NotFoundException(`Bank account ${bankAccountId} not found`);
      }
      this.assertCanViewBankAccount(account, user);
      return [bankAccountId];
    }

    const accounts = await this.prisma.bankAccount.findMany({
      where: { isActive: true },
      select: { id: true, metaJson: true },
    });

    return accounts
      .filter((account) => this.canViewBankAccount(account, user))
      .map((account) => account.id);
  }

  private asPlainObject(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }

  private parseDelimitedRows(csvFile: Buffer) {
    const text = csvFile.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (!text) {
      return [] as Array<Record<string, string>>;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.trim().length > 0);

    if (!lines.length) {
      return [] as Array<Record<string, string>>;
    }

    const delimiter = this.countDelimiter(lines[0], '\t') > 0
      ? '\t'
      : this.countDelimiter(lines[0], ';') > this.countDelimiter(lines[0], ',')
        ? ';'
        : ',';

    const headers = this.parseDelimitedLine(lines[0], delimiter).map((header) =>
      this.normalizeHeader(header),
    );

    return lines.slice(1).map((line) => {
      const values = this.parseDelimitedLine(line, delimiter);
      return headers.reduce(
        (acc, header, index) => {
          acc[header] = values[index] || '';
          return acc;
        },
        {} as Record<string, string>,
      );
    });
  }

  private parseBankStatementTransactions(csvFile: Buffer): {
    totalRows: number;
    transactions: ParsedBankStatementTransaction[];
    skippedRows: SkippedBankStatementRow[];
  } {
    const rows = this.parseDelimitedRows(csvFile);
    if (!rows.length) {
      throw new BadRequestException('Bank statement is empty');
    }

    const transactions: ParsedBankStatementTransaction[] = [];
    const skippedRows: SkippedBankStatementRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      try {
        const txnDateValue = this.pickField(row, [
          'txn_date',
          'date',
          '交易日期',
          '入帳日',
        ]);
        const descriptionRaw =
          this.pickField(row, ['description', '摘要', '說明', 'memo']) || '';

        if (!txnDateValue) {
          skippedRows.push({ rowNumber, reason: 'missing transaction date' });
          return;
        }
        if (!descriptionRaw.trim()) {
          skippedRows.push({ rowNumber, reason: 'missing description' });
          return;
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
          skippedRows.push({ rowNumber, reason: 'missing amount' });
          return;
        }

        transactions.push({
          rowNumber,
          txnDate,
          valueDate,
          amountOriginal: amount,
          amountCurrency: this.pickField(row, ['currency', '幣別']) || 'TWD',
          descriptionRaw,
          referenceNo:
            this.pickField(row, ['reference_no', 'reference', '參考號碼']) ||
            null,
          virtualAccountNo:
            this.pickField(row, [
              'virtual_account_no',
              'virtual account',
              '虛擬帳號',
            ]) || null,
        });
      } catch (error) {
        skippedRows.push({
          rowNumber,
          reason: error instanceof Error ? error.message : 'invalid row',
        });
      }
    });

    if (!transactions.length) {
      const firstReason = skippedRows[0]?.reason;
      throw new BadRequestException(
        firstReason
          ? `No importable bank statement rows found: ${firstReason}`
          : 'No importable bank statement rows found',
      );
    }

    return {
      totalRows: rows.length,
      transactions,
      skippedRows,
    };
  }

  private countDelimiter(line: string, delimiter: string) {
    let count = 0;
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && next === '"') {
        index += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }
    return count;
  }

  private parseDelimitedLine(line: string, delimiter: string) {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (char === '"' && next === '"') {
        current += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (!inQuotes && char === delimiter) {
        values.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current.trim());
    return values;
  }

  private normalizeHeader(value: string) {
    return value
      .trim()
      .replace(/^\uFEFF/, '')
      .replace(/^"|"$/g, '')
      .toLowerCase()
      .replace(/\s+/g, '_');
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
    const dateParts = normalized.match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})$/);
    if (dateParts) {
      const yearRaw = Number(dateParts[1]);
      const year = yearRaw < 1911 ? yearRaw + 1911 : yearRaw;
      const month = Number(dateParts[2]);
      const day = Number(dateParts[3]);
      const parsedDate = new Date(year, month - 1, day);
      if (
        parsedDate.getFullYear() === year &&
        parsedDate.getMonth() === month - 1 &&
        parsedDate.getDate() === day
      ) {
        return parsedDate;
      }
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid date value: ${value}`);
    }
    return parsed;
  }

  private parseAmountValue(value?: string) {
    if (!value) return null;
    const raw = value.trim();
    const isParenthesesNegative = /^\(.*\)$/.test(raw);
    const isTrailingNegative = /-$/.test(raw);
    const normalized = raw
      .replace(/[(),]/g, '')
      .replace(/(?:nt\$|twd|n\$|\$|元)/gi, '')
      .replace(/\s+/g, '')
      .replace(/-$/, '');
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException(`Invalid amount value: ${value}`);
    }
    return isParenthesesNegative || isTrailingNegative ? -Math.abs(parsed) : parsed;
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
