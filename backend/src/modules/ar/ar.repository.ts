import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * AR 資料存取層
 */
@Injectable()
export class ArRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findInvoices(filters: { entityId?: string; status?: string }) {
    return this.prisma.arInvoice.findMany({
      where: {
        ...(filters.entityId && { entityId: filters.entityId }),
        ...(filters.status && { status: filters.status }),
      },
      include: {
        customer: true,
        entity: true,
      },
      orderBy: { issueDate: 'desc' },
    });
  }

  async findInvoiceById(id: string) {
    return this.prisma.arInvoice.findUnique({
      where: { id },
      include: {
        customer: true,
      },
    });
  }

  async createInvoice(data: any) {
    return this.prisma.arInvoice.create({
      data,
    });
  }

  async recordPayment(invoiceId: string, data: any) {
    // TODO: 實作收款邏輯
    return this.prisma.arInvoice.update({
      where: { id: invoiceId },
      data: {
        paidAmountOriginal: { increment: data.amount },
        paidAmountBase: { increment: data.amount },
        status: data.newStatus || 'partial',
      },
    });
  }

  async writeOffInvoice(invoiceId: string) {
    return this.prisma.arInvoice.update({
      where: { id: invoiceId },
      data: { status: 'WRITTEN_OFF' },
    });
  }

  /**
   * 應收帳款摘要（2026-04）
   * 回傳未收總額、逾期筆數、逾期金額
   */
  async getSummary(entityId?: string) {
    const now = new Date();

    const unpaidInvoices = await this.prisma.arInvoice.findMany({
      where: {
        ...(entityId && { entityId }),
        status: { notIn: ['paid', 'written_off'] },
      },
      select: {
        amountOriginal: true,
        paidAmountOriginal: true,
        dueDate: true,
      },
    });

    let outstanding = 0;
    let overdueCount = 0;
    let overdueAmount = 0;

    for (const inv of unpaidInvoices) {
      const remaining =
        Number(inv.amountOriginal) - Number(inv.paidAmountOriginal);
      outstanding += remaining;
      if (inv.dueDate < now && remaining > 0) {
        overdueCount += 1;
        overdueAmount += remaining;
      }
    }

    return { outstanding, overdueCount, overdueAmount };
  }
}
