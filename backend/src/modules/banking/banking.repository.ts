import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class BankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBankAccounts(entityId: string) {
    return this.prisma.bankAccount.findMany({
      where: {
        ...(entityId ? { entityId } : {}),
        isActive: true,
      },
      orderBy: { accountNo: 'asc' },
    });
  }

  async createBankAccount(data: any) {
    return this.prisma.bankAccount.create({ data });
  }

  async findBankTransactions(bankAccountId: string, filters?: any) {
    return this.prisma.bankTransaction.findMany({
      where: { bankAccountId },
      orderBy: { txnDate: 'desc' },
    });
  }

  async createBankTransaction(data: any) {
    return this.prisma.bankTransaction.create({ data });
  }

  async updateReconciliationStatus(id: string, isReconciled: boolean) {
    return this.prisma.bankTransaction.update({
      where: { id },
      data: { reconcileStatus: isReconciled ? 'matched' : 'unmatched' },
    });
  }
}
