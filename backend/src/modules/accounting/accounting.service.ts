import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * AccountingService
 * 會計服務，處理會計科目相關的業務邏輯
 */
@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查詢指定實體的會計科目表
   * @param entityId - 公司實體 ID
   * @param type - 科目類型篩選（可選）
   */
  async getAccountsByEntity(entityId: string, type?: string) {
    return this.prisma.account.findMany({
      where: {
        entityId,
        isActive: true,
        ...(type && { type }),
      },
      orderBy: [{ code: 'asc' }],
      include: {
        parent: true,
        children: true,
      },
    });
  }

  /**
   * 根據科目代號查詢科目
   */
  async getAccountByCode(entityId: string, code: string) {
    const account = await this.prisma.account.findUnique({
      where: {
        entityId_code: {
          entityId,
          code,
        },
      },
    });

    if (!account) {
      throw new NotFoundException(
        `Account with code ${code} not found for entity ${entityId}`,
      );
    }

    return account;
  }

  /**
   * 查詢會計期間
   * @param entityId - 公司實體 ID
   * @param status - 期間狀態篩選（可選）
   */
  async getPeriods(entityId: string, status?: string) {
    return this.prisma.period.findMany({
      where: {
        entityId,
        ...(status && { status }),
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * 取得當前開放的會計期間
   */
  async getCurrentOpenPeriod(entityId: string) {
    return this.prisma.period.findFirst({
      where: {
        entityId,
        status: 'open',
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * 檢查期間是否可編輯
   */
  async isPeriodEditable(periodId: string): Promise<boolean> {
    const period = await this.prisma.period.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new NotFoundException(`Period ${periodId} not found`);
    }

    // closed 或 locked 的期間不可編輯
    return period.status === 'open';
  }

  /**
   * 建立手動會計分錄
   * @param data - 分錄資料
   */
  async createManualJournalEntry(data: {
    entityId: string;
    date: Date;
    description: string;
    lines: Array<{
      accountId: string;
      debit: number;
      credit: number;
      currency?: string;
      fxRate?: number;
      memo?: string;
    }>;
    createdBy: string;
  }) {
    // TODO: 實作手動建立會計分錄
    // 1. 驗證借貸平衡
    // 2. 檢查期間是否開放
    // 3. 建立 JournalEntry 與 JournalLines
    this.logger.log('Creating manual journal entry...');
    throw new Error('Not implemented: createManualJournalEntry');
  }

  /**
   * 過帳會計分錄（標記為已審核）
   * @param journalEntryId - 分錄 ID
   * @param approvedBy - 審核者 ID
   */
  async postJournalEntry(journalEntryId: string, approvedBy: string) {
    const journal = await this.prisma.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: {
        journalLines: true,
      },
    });

    if (!journal) {
      throw new NotFoundException(`Journal entry ${journalEntryId} not found`);
    }

    const period = journal.periodId
      ? await this.prisma.period.findUnique({
          where: { id: journal.periodId },
        })
      : null;

    if (period && period.status !== 'open') {
      throw new BadRequestException(
        `Cannot approve journal entry in ${period.status} period`,
      );
    }

    const totalDebit = journal.journalLines.reduce(
      (sum, line) => sum + Number(line.debit || 0),
      0,
    );
    const totalCredit = journal.journalLines.reduce(
      (sum, line) => sum + Number(line.credit || 0),
      0,
    );

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException('Journal entry is not balanced');
    }

    if (journal.approvedAt) {
      return journal;
    }

    const approvedJournal = await this.prisma.journalEntry.update({
      where: { id: journalEntryId },
      data: {
        approvedBy,
        approvedAt: new Date(),
      },
      include: {
        journalLines: {
          include: {
            account: true,
          },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: approvedBy,
        tableName: 'journal_entries',
        recordId: journalEntryId,
        action: 'APPROVE',
        oldData: {
          approvedAt: journal.approvedAt,
          approvedBy: journal.approvedBy,
        },
        newData: {
          approvedAt: approvedJournal.approvedAt?.toISOString() || null,
          approvedBy: approvedJournal.approvedBy,
        },
      },
    });

    return approvedJournal;
  }

  /**
   * 關閉會計期間
   * @param periodId - 期間 ID
   */
  async closePeriod(periodId: string, userId: string) {
    const period = await this.prisma.period.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new NotFoundException(`Period ${periodId} not found`);
    }

    if (period.status === 'locked') {
      throw new BadRequestException('Locked period cannot be closed again');
    }

    if (period.status === 'closed') {
      return period;
    }

    const unapprovedCount = await this.prisma.journalEntry.count({
      where: {
        periodId,
        approvedAt: null,
      },
    });

    if (unapprovedCount > 0) {
      throw new BadRequestException(
        `此期間仍有 ${unapprovedCount} 筆分錄尚未審核，無法關帳。`,
      );
    }

    const closedPeriod = await this.prisma.period.update({
      where: { id: periodId },
      data: { status: 'closed' },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        tableName: 'periods',
        recordId: periodId,
        action: 'CLOSE',
        oldData: { status: period.status },
        newData: { status: closedPeriod.status },
      },
    });

    return closedPeriod;
  }

  async lockPeriod(periodId: string, userId: string) {
    const period = await this.prisma.period.findUnique({
      where: { id: periodId },
    });

    if (!period) {
      throw new NotFoundException(`Period ${periodId} not found`);
    }

    if (period.status === 'locked') {
      return period;
    }

    if (period.status !== 'closed') {
      throw new BadRequestException('Only closed periods can be locked');
    }

    const lockedPeriod = await this.prisma.period.update({
      where: { id: periodId },
      data: { status: 'locked' },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        tableName: 'periods',
        recordId: periodId,
        action: 'LOCK',
        oldData: { status: period.status },
        newData: { status: lockedPeriod.status },
      },
    });

    return lockedPeriod;
  }

  /**
   * 產生銷貨成本分錄（月底結帳）
   * @param entityId - 公司實體 ID
   * @param periodId - 會計期間 ID
   */
  async generateCOGS(entityId: string, periodId: string) {
    // TODO: 實作銷貨成本計算
    // 1. 計算期初存貨
    // 2. 加上本期進貨
    // 3. 減去期末存貨
    // 4. 產生：借：銷貨成本，貸：存貨
    this.logger.log(`Generating COGS for period ${periodId}...`);
    throw new Error('Not implemented: generateCOGS');
  }

  /**
   * 產生折舊分錄（月底結帳）
   * @param entityId - 公司實體 ID
   * @param periodId - 會計期間 ID
   */
  async generateDepreciation(entityId: string, periodId: string) {
    // TODO: 實作折舊計算
    // 1. 查詢所有固定資產
    // 2. 計算本月折舊金額
    // 3. 產生：借：折舊費用，貸：累計折舊
    this.logger.log(`Generating depreciation for period ${periodId}...`);
    throw new Error('Not implemented: generateDepreciation');
  }

  /**
   * 取得總分類帳
   * @param entityId - 公司實體 ID
   * @param startDate - 開始日期
   * @param endDate - 結束日期
   * @param accountId - 科目 ID（可選）
   */
  async getGeneralLedger(
    entityId: string,
    startDate: Date,
    endDate: Date,
    accountId?: string,
  ) {
    this.logger.log('Fetching general ledger...');

    const lines = await this.prisma.journalLine.findMany({
      where: {
        journalEntry: {
          entityId,
          date: {
            gte: startDate,
            lte: endDate,
          },
          approvedAt: {
            not: null,
          },
        },
        ...(accountId ? { accountId } : {}),
      },
      include: {
        account: true,
        journalEntry: true,
      },
      orderBy: [
        { account: { code: 'asc' } },
        { journalEntry: { date: 'asc' } },
      ],
    });

    const balances = new Map<string, number>();
    const entries = lines.map((line) => {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      const delta =
        line.account.type === 'asset' || line.account.type === 'expense'
          ? debit - credit
          : credit - debit;
      const runningBalance = (balances.get(line.accountId) || 0) + delta;
      balances.set(line.accountId, runningBalance);

      return {
        id: line.id,
        journalEntryId: line.journalEntryId,
        date: line.journalEntry.date,
        description: line.journalEntry.description,
        sourceModule: line.journalEntry.sourceModule,
        sourceId: line.journalEntry.sourceId,
        accountId: line.accountId,
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType: line.account.type,
        debit,
        credit,
        currency: line.currency,
        amountBase: Number(line.amountBase || 0),
        memo: line.memo,
        runningBalance,
      };
    });

    const summary = entries.reduce(
      (acc, entry) => ({
        totalDebit: acc.totalDebit + entry.debit,
        totalCredit: acc.totalCredit + entry.credit,
      }),
      { totalDebit: 0, totalCredit: 0 },
    );

    return {
      entityId,
      startDate,
      endDate,
      accountId: accountId || null,
      totalDebit: summary.totalDebit,
      totalCredit: summary.totalCredit,
      entries,
    };
  }

  /**
   * 取得試算表
   * @param entityId - 公司實體 ID
   * @param asOfDate - 截止日期
   */
  async getTrialBalance(entityId: string, asOfDate: Date) {
    this.logger.log(`Fetching trial balance as of ${asOfDate}...`);

    const lines = await this.prisma.journalLine.findMany({
      where: {
        journalEntry: {
          entityId,
          date: {
            lte: asOfDate,
          },
          approvedAt: {
            not: null,
          },
        },
      },
      include: {
        account: true,
      },
      orderBy: {
        account: {
          code: 'asc',
        },
      },
    });

    const accountMap = new Map<
      string,
      {
        accountId: string;
        code: string;
        name: string;
        type: string;
        debit: number;
        credit: number;
        balance: number;
      }
    >();

    for (const line of lines) {
      const current = accountMap.get(line.accountId) || {
        accountId: line.accountId,
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        debit: 0,
        credit: 0,
        balance: 0,
      };
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      current.debit += debit;
      current.credit += credit;
      current.balance =
        current.type === 'asset' || current.type === 'expense'
          ? current.debit - current.credit
          : current.credit - current.debit;
      accountMap.set(line.accountId, current);
    }

    const items = Array.from(accountMap.values()).sort((a, b) =>
      a.code.localeCompare(b.code),
    );
    const totals = items.reduce(
      (acc, item) => ({
        debit: acc.debit + item.debit,
        credit: acc.credit + item.credit,
      }),
      { debit: 0, credit: 0 },
    );

    return {
      entityId,
      asOfDate,
      items,
      totalDebit: totals.debit,
      totalCredit: totals.credit,
      balanced: Math.abs(totals.debit - totals.credit) < 0.01,
    };
  }
}
