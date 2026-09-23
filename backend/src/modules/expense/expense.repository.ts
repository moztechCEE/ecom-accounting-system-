import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseReimbursementItem } from './reimbursement-item-access';

export const EXPENSE_REQUEST_INCLUDE = {
  creator: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  approver: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  reimbursementItem: {
    include: {
      account: true,
      approvalPolicy: {
        include: {
          steps: {
            orderBy: { stepOrder: 'asc' },
          },
        },
      },
    },
  },
  suggestedAccount: true,
  finalAccount: true,
  approvalSteps: {
    orderBy: { stepOrder: 'asc' },
    include: { approverUser: { select: { id: true, name: true } } },
  },
} as const satisfies Prisma.ExpenseRequestInclude;

const REIMBURSEMENT_ITEM_INCLUDE = {
  account: true,
  approvalPolicy: {
    include: {
      steps: {
        orderBy: { stepOrder: 'asc' },
      },
    },
  },
} as const satisfies Prisma.ReimbursementItemInclude;

export type ExpenseRequestWithGraph = Prisma.ExpenseRequestGetPayload<{
  include: typeof EXPENSE_REQUEST_INCLUDE;
}>;

@Injectable()
export class ExpenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: any) {
    return this.prisma.expenseRequest.findMany({
      where: filters,
      include: { creator: true, approver: true },
    });
  }

  async create(data: any) {
    return this.prisma.expenseRequest.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.expenseRequest.update({ where: { id }, data });
  }

  async findReimbursementItemByAccount(entityId: string, accountId: string) {
    return this.prisma.reimbursementItem.findFirst({
      where: {
        entityId,
        accountId,
        isActive: true,
      },
      include: REIMBURSEMENT_ITEM_INCLUDE,
    });
  }

  async findActiveReimbursementItems(
    entityId: string,
    options?: { roles?: string[]; departmentId?: string },
  ) {
    const items = await this.prisma.reimbursementItem.findMany({
      where: {
        entityId,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
    return items.filter((item) => canUseReimbursementItem(item, options));
  }

  async listReimbursementItemsAdmin(options?: {
    entityId?: string;
    includeInactive?: boolean;
  }) {
    return this.prisma.reimbursementItem.findMany({
      where: {
        entityId: options?.entityId,
        ...(options?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
      include: REIMBURSEMENT_ITEM_INCLUDE,
    });
  }

  async createReimbursementItem(
    data: Prisma.ReimbursementItemUncheckedCreateInput,
  ) {
    return this.prisma.reimbursementItem.create({
      data,
      include: REIMBURSEMENT_ITEM_INCLUDE,
    });
  }

  async updateReimbursementItem(
    id: string,
    data: Prisma.ReimbursementItemUncheckedUpdateInput,
  ) {
    return this.prisma.reimbursementItem.update({
      where: { id },
      data,
      include: REIMBURSEMENT_ITEM_INCLUDE,
    });
  }

  async archiveReimbursementItem(id: string) {
    return this.prisma.reimbursementItem.update({
      where: { id },
      data: { isActive: false },
      include: REIMBURSEMENT_ITEM_INCLUDE,
    });
  }

  async listApprovalPolicies(entityId?: string) {
    return this.prisma.approvalPolicy.findMany({
      where: {
        entityId,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async getReimbursementItemDetail(id: string) {
    return this.prisma.reimbursementItem.findUnique({
      where: { id },
      include: REIMBURSEMENT_ITEM_INCLUDE,
    });
  }

  async createExpenseRequestGraph(input: {
    requestData: Prisma.ExpenseRequestUncheckedCreateInput;
    history?: Omit<
      Prisma.ExpenseRequestHistoryUncheckedCreateInput,
      'expenseRequestId'
    >;
    approvalSteps?: Array<
      Omit<Prisma.ApprovalStepUncheckedCreateInput, 'expenseRequestId'>
    >;
    classifierFeedback?: Omit<
      Prisma.AccountingClassifierFeedbackUncheckedCreateInput,
      'expenseRequestId'
    >;
  }): Promise<ExpenseRequestWithGraph> {
    return this.prisma.$transaction(async (tx) => {
      const expenseRequest = await tx.expenseRequest.create({
        data: input.requestData,
        include: EXPENSE_REQUEST_INCLUDE,
      });

      if (input.history) {
        await tx.expenseRequestHistory.create({
          data: {
            ...input.history,
            expenseRequestId: expenseRequest.id,
          },
        });
      }

      if (input.approvalSteps?.length) {
        await tx.approvalStep.createMany({
          data: input.approvalSteps.map((step) => ({
            ...step,
            expenseRequestId: expenseRequest.id,
          })),
        });
      }

      if (input.classifierFeedback) {
        await tx.accountingClassifierFeedback.create({
          data: {
            ...input.classifierFeedback,
            expenseRequestId: expenseRequest.id,
          },
        });
      }

      return expenseRequest;
    });
  }

  async updateExpenseRequestWithHistory(
    id: string,
    data: Prisma.ExpenseRequestUncheckedUpdateInput,
    history: Omit<
      Prisma.ExpenseRequestHistoryUncheckedCreateInput,
      'expenseRequestId'
    >,
    feedback?: Omit<
      Prisma.AccountingClassifierFeedbackUncheckedCreateInput,
      'expenseRequestId'
    >,
    paymentTask?: Omit<
      Prisma.PaymentTaskUncheckedCreateInput,
      'expenseRequestId'
    >,
  ): Promise<ExpenseRequestWithGraph> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.expenseRequest.update({
        where: { id },
        data,
        include: EXPENSE_REQUEST_INCLUDE,
      });

      await tx.expenseRequestHistory.create({
        data: {
          ...history,
          expenseRequestId: id,
        },
      });

      if (feedback) {
        await tx.accountingClassifierFeedback.create({
          data: {
            ...feedback,
            expenseRequestId: id,
          },
        });
      }

      if (paymentTask) {
        await tx.paymentTask.create({
          data: {
            ...paymentTask,
            expenseRequestId: id,
          },
        });
      }

      return updated;
    });
  }

  async findRequestById(id: string) {
    return this.prisma.expenseRequest.findUnique({
      where: { id },
      include: {
        ...EXPENSE_REQUEST_INCLUDE,
        histories: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async listExpenseRequests(filters: {
    entityId?: string;
    status?: string;
    createdBy?: string;
    approverId?: string;
  }) {
    return this.prisma.expenseRequest.findMany({
      where: {
        entityId: filters.entityId,
        status: filters.status,
        createdBy: filters.createdBy,
        approvalUserId: filters.approverId,
      },
      orderBy: { createdAt: 'desc' },
      include: EXPENSE_REQUEST_INCLUDE,
    });
  }

  async listHistories(expenseRequestId: string) {
    return this.prisma.expenseRequestHistory.findMany({
      where: { expenseRequestId },
      orderBy: { createdAt: 'asc' },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        suggestedAccount: true,
        finalAccount: true,
      },
    });
  }

  async createHistoryEntry(
    history: Prisma.ExpenseRequestHistoryUncheckedCreateInput,
  ) {
    return this.prisma.expenseRequestHistory.create({ data: history });
  }

  async createFeedbackEntry(
    data: Prisma.AccountingClassifierFeedbackUncheckedCreateInput,
  ) {
    return this.prisma.accountingClassifierFeedback.create({ data });
  }
}
