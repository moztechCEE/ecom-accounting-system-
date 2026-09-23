import { effectivePermissionKeys } from '../../common/department-access/department-access';
import { createHash } from 'node:crypto';
import { AssignLegacyApprovalDto } from './dto/assign-legacy-approval.dto';
import { parseReceiptFiles } from './receipt-files';
import { canUseReimbursementItem } from './reimbursement-item-access';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { canViewBankAccountForUser } from '../banking/bank-account-access';
import { EntityAccessService } from '../../common/entity-access/entity-access.service';
import { ConfigService } from '@nestjs/config';
import { Prisma, TaxType } from '@prisma/client';
import {
  ExpenseRepository,
  EXPENSE_REQUEST_INCLUDE,
  ExpenseRequestWithGraph,
} from './expense.repository';
import { CreateExpenseRequestDto } from './dto/create-expense-request.dto';
import { ApproveExpenseRequestDto } from './dto/approve-expense-request.dto';
import { RejectExpenseRequestDto } from './dto/reject-expense-request.dto';
import { SubmitExpenseFeedbackDto } from './dto/submit-feedback.dto';
import { UpdatePaymentInfoDto } from './dto/update-payment-info.dto';
import { AccountingClassifierService } from './accounting-classifier.service';
import {
  CreateReimbursementItemDto,
  UpdateReimbursementItemDto,
} from './dto/manage-reimbursement-item.dto';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AI_AGENT_CORE_PRINCIPLES } from '../ai/ai-principles';

interface ExpenseEmployeeContext {
  id: string;
  entityId: string;
  departmentId: string | null;
  isActive: boolean;
  supervisor: {
    id: string;
    entityId: string;
    isActive: boolean;
    user: { id: string; name?: string; isActive: boolean } | null;
  } | null;
}

interface UserContext {
  id: string;
  roleCodes?: string[];
}

/**
 * 費用管理服務
 *
 * 核心功能：
 * 1. 費用申請單管理
 * 2. 費用分類與科目對應
 * 3. 費用審核流程
 * 4. 費用報銷與付款
 */
@Injectable()
export class ExpenseService {
  private readonly logger = new Logger(ExpenseService.name);

  constructor(
    private readonly expenseRepository: ExpenseRepository,
    private readonly classifierService: AccountingClassifierService,
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly entityAccessService: EntityAccessService,
  ) {}

  /**
   * 建立費用申請單
   */
  async createExpenseRequest(
    data: CreateExpenseRequestDto,
    requestedBy: UserContext,
  ) {
    return this.submitIntelligentExpenseRequest(data, requestedBy);
  }

  async predictReimbursementItem(
    entityId: string,
    description: string,
    model?: string,
  ) {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new BadRequestException('GEMINI_API_KEY is not configured');
    }

    // 1. Use AI to suggest a Reimbursement Item directly
    const suggestion = await this.classifierService.suggestReimbursementItem(
      entityId,
      description,
      model,
    );

    if (!suggestion || !suggestion.itemId) {
      return null;
    }

    // 2. Find the full item details
    const item = await this.prisma.reimbursementItem.findUnique({
      where: { id: suggestion.itemId },
      include: { account: true },
    });

    return {
      suggestedItem: item,
      confidence: suggestion.confidence,
      amount: suggestion.amount,
      reason: 'ai_gemini',
    };
  }

  async seedAiReimbursementItems(entityId: string) {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new BadRequestException('GEMINI_API_KEY is not configured');
    }

    // 1. Fetch all active expense accounts
    const accounts = await this.prisma.account.findMany({
      where: {
        entityId,
        isActive: true,
        OR: [
          { code: { startsWith: '5' } },
          { code: { startsWith: '6' } },
          { code: { startsWith: '7' } },
          { code: { startsWith: '8' } },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
      },
    });

    if (accounts.length === 0) {
      throw new BadRequestException('No expense accounts found to seed from');
    }

    // 2. Prepare prompt for Gemini
    const accountListText = accounts
      .map(
        (a) => `- ${a.code} ${a.name} (${a.description || ''}) [ID: ${a.id}]`,
      )
      .join('\n');

    const prompt = `
${AI_AGENT_CORE_PRINCIPLES}

Role:
You are a Senior CPA and CFO for a Taiwanese e-commerce company.

Goal:
Build practical reimbursement policy master data that employees can actually use.

Context:
- Location: Taiwan (R.O.C.)
- Industry: E-commerce (Cross-border, Retail, B2C/B2B)
- Tax System: VAT (Value Added Tax), GUI (Government Uniform Invoice)

Task:
Generate a practical, tax-compliant list of 40-50 reimbursement items.
The list should bridge employee language and accounting language.
Less is more: avoid duplicate, overly narrow, or hard-to-understand items.

Categories to cover deeply:
1. **Digital Marketing (Ads & Traffic)**:
   - Distinguish between "Domestic Ads" (local invoice) and "Foreign Ads" (Facebook/Google - often Invoice/Withholding tax issues).
   - KOL/Influencer: Distinguish between "Individual (Professional Service)" and "Company (Invoice)".
2. **Logistics & Supply Chain**:
   - Import Duties, Forwarder Fees, Local Courier, Packaging (Consumables vs Inventory).
3. **IT & Infrastructure**:
   - SaaS Subscriptions (Monthly/Yearly), Cloud Infrastructure, Hardware (Assets vs Expense), Domain/SSL.
4. **General & Administrative**:
   - Office Rent, Utilities, Property Management, Cleaning, Security.
   - Office Supplies: Distinguish "Consumables" (Pens/Paper) from "Low-value Assets" (Chairs/Monitors < 80k TWD).
5. **Travel & Representation**:
   - Travel: HSR, Taxi, Flight, Accommodation.
   - Meals: Distinguish "Staff Meal" (Overtime) vs "Business Meal" (Client entertainment - 交際費).
6. **Employee Benefits**:
   - Team Building, Training, Health Checkup, Snacks/Pantry.

For each item, provide:
1. "name": Professional name (e.g., "廣告費-Facebook(境外)", "交際費-客戶餐敘", "文具用品-一般耗材").
2. "description": A precise policy description. Mention tax requirements if applicable (e.g., "需打統編，若為境外公司請附 Invoice").
3. "keywords": 5-8 keywords including slang, English terms, and synonyms (e.g., ["uber", "taxi", "計程車", "小黃", "交通費"]).
4. "accountId": The exact ID of the corresponding account from the provided list.
5. "defaultReceiptType": Best match from ["TAX_INVOICE" (三聯式), "RECEIPT" (收據/二聯), "BANK_SLIP", "INTERNAL_ONLY"].
6. "allowedReceiptTypes": Comma-separated list.

Available Accounts:
${accountListText}

Return the result as a raw JSON array of objects only.
Do not include markdown or explanation.
`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiApiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Gemini API Error: ${response.statusText} - ${errorText}`,
        );
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      const jsonString = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      const items = JSON.parse(jsonString);

      let createdCount = 0;
      for (const item of items) {
        const accountExists = accounts.find((a) => a.id === item.accountId);
        if (!accountExists) continue;

        const existingItem = await this.prisma.reimbursementItem.findFirst({
          where: {
            entityId,
            name: item.name,
          },
        });

        if (existingItem) continue;

        await this.prisma.reimbursementItem.create({
          data: {
            entityId,
            name: item.name,
            description: item.description,
            accountId: item.accountId,
            keywords: item.keywords ? item.keywords.join(',') : null,
            defaultReceiptType: item.defaultReceiptType,
            allowedReceiptTypes: item.allowedReceiptTypes,
            isActive: true,
          },
        });
        createdCount++;
      }

      return { success: true, createdCount };
    } catch (error) {
      this.logger.error('Error seeding AI items', error);
      throw new BadRequestException('Failed to seed AI items: ' + error);
    }
  }

  async testAiConnection() {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return {
        success: false,
        message: 'GEMINI_API_KEY is not configured in environment variables.',
      };
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiApiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say "Hello AI"' }] }],
          }),
        },
      );

      if (!response.ok) {
        return {
          success: false,
          message: `Gemini API Error: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      return {
        success: true,
        message: 'AI connection successful',
        response: text,
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error}`,
      };
    }
  }

  /**
   * 查詢費用申請單列表
   */
  async getExpenseRequests(
    entityId?: string,
    status?: string,
    createdBy?: string,
  ) {
    return this.expenseRepository.listExpenseRequests({
      entityId,
      status,
      createdBy,
    });
  }

  async access(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: {
      employee: { include: { department: { include: { memberRole: { include: { permissions: { include: { permission: true } } } }, supervisorRole: { include: { permissions: { include: { permission: true } } } } } }, supervisor: { include: { user: { select: { id: true, name: true, isActive: true } } } } } },
      entityMemberships: true,
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    } });
    if (!user?.isActive) throw new ForbiddenException('登入帳號未啟用');
    const roles = user.roles.map((r) => r.role.code);
    const permissions = effectivePermissionKeys(user);
    const admin = roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r));
    const finance = admin || permissions.some((p) => ['accounts:read', 'purchase_orders:read'].includes(p));
    if (!finance && !permissions.includes('expense_self:read')) throw new ForbiddenException('沒有費用申請介面的使用權限');
    return { user, roles, permissions, admin, finance,
      entityIds: [...new Set([...user.entityMemberships.map((m) => m.entityId), ...(user.employee?.isActive ? [user.employee.entityId] : [])])] };
  }

  async assertEntityAccess(userId: string, entityId: string) {
    const access = await this.access(userId);
    if (!access.roles.includes('SUPER_ADMIN') && !access.entityIds.includes(entityId)) throw new ForbiddenException('沒有此公司的費用權限');
    return access;
  }

  private canReview(request: any, access: Awaited<ReturnType<ExpenseService['access']>>) {
    if (request.status !== 'pending' || request.createdBy === access.user.id) return false;
    if (!access.user.employee?.isActive || access.user.employee.entityId !== request.entityId) return false;
    const step = request.approvalSteps?.find((s: any) => s.status === 'pending');
    return Boolean(step && (step.approverUserId ? step.approverUserId === access.user.id : step.approverRoleCode && access.roles.includes(step.approverRoleCode)));
  }

  async listAccessibleRequests(userId: string, entityId?: string, status?: string, mine = false) {
    const access = entityId ? await this.assertEntityAccess(userId, entityId) : await this.access(userId);
    const scope = access.roles.includes('SUPER_ADMIN') ? 'ENTITY' : access.user.accountingDataScope;
    const canReadEntity = !mine && access.finance && scope === 'ENTITY';
    const visible: Prisma.ExpenseRequestWhereInput[] = [{ createdBy: userId }];
    if (!mine) {
      visible.push({ approvalSteps: { some: { OR: [{ approverUserId: userId }, { approverUserId: null, approverRoleCode: { in: access.roles } }] } } });
      if (access.finance && scope === 'DEPARTMENT' && access.user.employee?.departmentId) visible.push({ departmentId: access.user.employee.departmentId });
    }
    const records = await this.prisma.expenseRequest.findMany({ where: {
      entityId: entityId || (access.roles.includes('SUPER_ADMIN') ? undefined : { in: access.entityIds }),
      status, ...(canReadEntity ? {} : { OR: visible }),
    }, include: EXPENSE_REQUEST_INCLUDE, orderBy: { createdAt: 'desc' } });
    return records.map((record) => ({ ...record, canReview: this.canReview(record, access), currentApprover: record.approvalSteps.find((s) => s.status === 'pending')?.approverUser || null }));
  }

  async accessibleRequest(id: string, userId: string) {
    const record = await this.ensureExpenseRequest(id);
    const visible = await this.listAccessibleRequests(userId, record.entityId);
    const result = visible.find((r) => r.id === id);
    if (!result) throw new ForbiddenException('無法查看此費用申請');
    return result;
  }

  async approveExpenseRequest(requestId: string, approver: UserContext, payload: ApproveExpenseRequestDto) {
    return this.decideExpense(requestId, approver, 'approved', payload);
  }

  async rejectExpenseRequest(requestId: string, approver: UserContext, payload: RejectExpenseRequestDto) {
    return this.decideExpense(requestId, approver, 'rejected', { ...payload, remark: payload.reason });
  }

  private async decideExpense(requestId: string, actor: UserContext, decision: 'approved' | 'rejected', payload: ApproveExpenseRequestDto) {
    const access = await this.access(actor.id);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.expenseRequest.findUnique({ where: { id: requestId }, include: EXPENSE_REQUEST_INCLUDE });
      if (!request) throw new NotFoundException('找不到費用申請');
      if (!this.canReview(request, access)) throw new ForbiddenException('僅目前指派的主管或審批人可處理待審申請；不得審批自己的申請');
      const step = request.approvalSteps.find((s) => s.status === 'pending')!;
      if (!payload.approvalStepId) throw new BadRequestException('請重新載入目前審批節點');
      if (payload.approvalStepId !== step.id) throw new ConflictException('審批節點已變更，請重新整理後再確認');
      if (payload.finalAccountId) {
        if (!access.finance) throw new ForbiddenException('會計科目需由有會計權限的人員核定');
        const account = await tx.account.findFirst({ where: { id: payload.finalAccountId, entityId: request.entityId, isActive: true } });
        if (!account) throw new BadRequestException('會計科目不屬於此公司或已停用');
      }
      const changed = await tx.approvalStep.updateMany({ where: { id: step.id, status: 'pending' }, data: {
        status: decision, approverUserId: actor.id, decidedAt: new Date(), remark: payload.remark,
      } });
      if (changed.count !== 1) throw new ConflictException('此申請已由其他操作處理，請重新整理');
      const remaining = request.approvalSteps.some((s) => s.id !== step.id && s.status === 'pending');
      const status = decision === 'rejected' ? 'rejected' : remaining ? 'pending' : 'approved';
      const finalAccountId = payload.finalAccountId || request.finalAccountId;
      const updated = await tx.expenseRequest.update({ where: { id: request.id }, data: {
        status, ...(status !== 'pending' ? { approvalUserId: actor.id, approvedAt: new Date() } : {}),
        finalAccountId,
      }, include: EXPENSE_REQUEST_INCLUDE });
      await tx.expenseRequestHistory.create({ data: { expenseRequestId: request.id, action: decision, fromStatus: request.status, toStatus: status,
        actorId: actor.id, actorRoleCode: access.roles[0], note: payload.remark,
        metadata: { approvalStepId: step.id }, finalAccountId,
      } });
      if (status === 'approved') await tx.paymentTask.create({ data: {
        entityId: request.entityId, expenseRequestId: request.id, vendorId: request.vendorId,
        accountId: finalAccountId, status: 'pending', dueDate: request.dueDate,
        amountOriginal: request.amountOriginal, amountCurrency: request.amountCurrency,
        amountFxRate: request.amountFxRate, amountBase: request.amountBase,
        notes: `費用申請：${request.description}`,
      } });
      return { ...updated, canReview: false };
    });
  }

  private async resolveExpenseSupervisor(employee: ExpenseEmployeeContext | null, requesterId: string, entityId: string) {
    const supervisor = employee?.supervisor;
    if (!employee?.isActive || employee.entityId !== entityId) throw new BadRequestException('請先綁定此公司的在職員工資料');
    if (!supervisor?.isActive || supervisor.entityId !== entityId || !supervisor.user?.isActive || supervisor.user.id === requesterId) {
      throw new BadRequestException('尚未設定可審批的直屬主管，請管理員至人員管理設定同公司主管與登入帳號');
    }
    try {
      const supervisorAccess = await this.assertEntityAccess(supervisor.user.id, entityId);
      if (!supervisorAccess.user.employee?.isActive || supervisorAccess.user.employee.id !== supervisor.id || supervisorAccess.user.employee.entityId !== entityId) {
        throw new ForbiddenException('主管員工關係無效');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) throw new BadRequestException('直屬主管尚無此公司的費用讀取權限或有效員工關係，請管理員先設定主管權限後再送出');
      throw error;
    }
    return { employee, supervisor: { ...supervisor, user: supervisor.user } };
  }

  private buildRequestApprovalSteps(item: ExpenseRequestWithGraph['reimbursementItem'], amountOriginal: number, departmentId: string | null, supervisorUserId: string) {
    const policySteps = this.buildApprovalSteps(item?.approvalPolicy?.steps ?? [], amountOriginal, departmentId || undefined);
    const steps = [
      { stepOrder: 1, status: 'pending', approverUserId: supervisorUserId, departmentId, assignedAt: new Date() },
      ...policySteps.map((step, index) => ({ ...step, stepOrder: index + 2,
        ...(item?.approvalPolicy?.steps.find((policy) => policy.stepOrder === step.stepOrder)?.requiresDepartmentHead ? { approverUserId: supervisorUserId } : {}),
      })),
    ];
    if (steps.some((step) => !step.approverUserId && !('approverRoleCode' in step && step.approverRoleCode))) throw new BadRequestException('審批政策有未指定審批人的節點，請管理員修正');
    return steps;
  }

  private async legacyApprovalPlan(request: ExpenseRequestWithGraph) {
    if (request.status !== 'pending' || request.approvalSteps.length !== 0) throw new ConflictException('僅尚未指派任何審批節點的待審申請可建立主管審批');
    const employee = await this.prisma.employee.findUnique({ where: { userId: request.createdBy }, include: {
      user: { select: { isActive: true } },
      supervisor: { include: { user: { select: { id: true, name: true, isActive: true } } } },
    } });
    if (!employee?.user?.isActive) throw new BadRequestException('原申請人的登入帳號或員工關係無效，請先由管理員核對');
    const route = await this.resolveExpenseSupervisor(employee, request.createdBy, request.entityId);
    if (request.reimbursementItem && request.reimbursementItem.entityId !== request.entityId) throw new BadRequestException('原報銷項目公司不符，請先由會計核對');
    const steps = this.buildRequestApprovalSteps(request.reimbursementItem, Number(request.amountOriginal), route.employee.departmentId, route.supervisor.user.id);
    const routeToken = createHash('sha256').update(JSON.stringify({
      requestId: request.id, supervisorEmployeeId: route.supervisor.id,
      steps: steps.map(({ assignedAt: _assignedAt, ...step }: any) => step),
    })).digest('hex');
    return { ...route, steps, routeToken };
  }

  async previewLegacyApprovalRoute(requestId: string, actorId: string) {
    const access = await this.access(actorId);
    if (!access.admin) throw new ForbiddenException('只有系統管理員可為舊申請建立主管審批');
    const request = await this.accessibleRequest(requestId, actorId);
    const route = await this.legacyApprovalPlan(request);
    return {
      requestId, expectedUpdatedAt: request.updatedAt.toISOString(), routeToken: route.routeToken,
      requesterName: request.creator.name,
      supervisor: { id: route.supervisor.id, name: route.supervisor.user.name || '已設定主管', userId: route.supervisor.user.id },
      steps: route.steps.map((step) => ({ order: step.stepOrder, approverName: step.approverUserId === route.supervisor.user.id ? route.supervisor.user.name || '已設定主管' : null,
        roleCode: 'approverRoleCode' in step ? step.approverRoleCode : null })),
    };
  }

  async assignLegacyApprovalRoute(requestId: string, actorId: string, dto: AssignLegacyApprovalDto) {
    const access = await this.access(actorId);
    if (!access.admin) throw new ForbiddenException('只有系統管理員可為舊申請建立主管審批');
    await this.accessibleRequest(requestId, actorId);
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.expenseRequest.findUnique({ where: { id: requestId }, include: EXPENSE_REQUEST_INCLUDE });
      if (!request) throw new NotFoundException('找不到費用申請');
      if (request.updatedAt.toISOString() !== dto.expectedUpdatedAt) throw new ConflictException('申請已變更，請重新預覽主管審批');
      const route = await this.legacyApprovalPlan(request);
      if (route.routeToken !== dto.routeToken) throw new ConflictException('主管或審批政策已變更，請重新預覽並確認');
      // Updating the version claims this legacy request atomically; a competing repair cannot create another route.
      const version = new Date(Math.max(Date.now(), request.updatedAt.getTime() + 1));
      const claimed = await tx.expenseRequest.updateMany({ where: {
        id: requestId, status: 'pending', updatedAt: request.updatedAt, approvalSteps: { none: {} },
      }, data: { updatedAt: version } });
      if (claimed.count !== 1) throw new ConflictException('此申請已被處理，請重新整理');
      await tx.approvalStep.createMany({ data: route.steps.map((step) => ({ ...step, expenseRequestId: requestId })) });
      await tx.expenseRequestHistory.create({ data: {
        expenseRequestId: requestId, action: 'approval_assigned', fromStatus: 'pending', toStatus: 'pending', actorId,
        note: '管理員確認後，依目前已設定主管建立舊申請審批；保留項目額外審批政策',
        metadata: { supervisorEmployeeId: route.supervisor.id, supervisorUserId: route.supervisor.user.id, routeToken: route.routeToken },
      } });
      return tx.expenseRequest.findUnique({ where: { id: requestId }, include: EXPENSE_REQUEST_INCLUDE });
    });
  }

  async updatePaymentInfo(requestId: string, data: UpdatePaymentInfoDto, actor: UserContext) {
    const request = await this.accessibleRequest(requestId, actor.id);
    const access = await this.assertEntityAccess(actor.id, request.entityId);
    if (!access.admin && !access.permissions.includes('banking:update')) throw new ForbiddenException('需要出納付款登記權限');
    if (data.paymentStatus !== 'paid') throw new BadRequestException('付款登記只接受已實際支付的完整金額，不能回退付款狀態');
    if (!data.bankAccountId || !data.paymentDate || data.amount === undefined) throw new BadRequestException('請填寫實際付款銀行、日期與金額');
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: data.bankAccountId, entityId: request.entityId, isActive: true } });
    if (!bank) throw new BadRequestException('付款銀行不屬於此公司或已停用');
    if (!canViewBankAccountForUser(bank, access.user)) throw new ForbiddenException('沒有此銀行帳戶的存取權限');
    const banking = await this.entityAccessService.assertAccess(actor.id, 'banking', request.entityId);
    if (!banking.isSuperAdmin && ((banking.scope === 'SELF' && request.createdBy !== actor.id) || (banking.scope === 'DEPARTMENT' && request.departmentId !== banking.departmentId))) throw new ForbiddenException('此付款超出你的出納資料範圍');
    if (bank.currency !== request.amountCurrency) throw new BadRequestException('付款帳戶與費用幣別不同，請會計先確認換匯及支付金額');

    if (!new Prisma.Decimal(data.amount).equals(request.amountOriginal)) throw new BadRequestException('目前費用付款須以完整核准金額登記');
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.expenseRequest.updateMany({ where: { id: requestId, status: 'approved', paymentStatus: { not: 'paid' } }, data: {
        status: 'paid', paymentStatus: 'paid', paymentMethod: 'bank_transfer',
        paymentBankName: bank.bankName, paymentAccountLast5: bank.accountNo?.slice(-5),
      } });
      if (changed.count !== 1) throw new ConflictException('費用尚未核准或已完成付款登記');
      const task = await tx.paymentTask.updateMany({ where: { expenseRequestId: requestId, status: 'pending' }, data: { status: 'paid', paidDate: data.paymentDate } });
      if (task.count !== 1) throw new ConflictException('找不到唯一待付款任務，請先由會計核對');
      await tx.expenseRequestHistory.create({ data: { expenseRequestId: requestId, action: 'payment_recorded', fromStatus: 'approved', toStatus: 'paid', actorId: actor.id,
        note: '出納登記實際付款；此操作不會向銀行發出匯款',
        metadata: { bankAccountId: bank.id, paymentDate: data.paymentDate.toISOString(), amount: data.amount, currency: request.amountCurrency },
      } });
      return tx.expenseRequest.findUnique({ where: { id: requestId }, include: EXPENSE_REQUEST_INCLUDE });
    });
  }

  /**
   * 費用報銷（產生付款）
   */
  async reimburseExpense(requestId: string) {
    // TODO: 建立付款記錄
    // TODO: 產生會計分錄
  }

  /**
   * 費用分類報表
   */
  async getExpenseByCategory(entityId: string, startDate: Date, endDate: Date) {
    // TODO: 依費用類別統計
  }

  // submitExpenseRequest 已由 submitIntelligentExpenseRequest 取代

  /**
   * 連結至應付發票
   * @param expenseRequestId - 費用申請ID
   * @param apInvoiceId - 應付發票ID
   * @returns 更新後的費用申請單
   */
  async linkToApInvoice(expenseRequestId: string, apInvoiceId: string) {
    this.logger.log(
      `Linking expense request ${expenseRequestId} to AP invoice ${apInvoiceId}`,
    );
    throw new Error('Not implemented: linkToApInvoice');
  }

  /**
   * 按類別統計費用
   * @param entityId - 實體ID
   * @param startDate - 開始日期
   * @param endDate - 結束日期
   * @returns 費用統計報表
   */
  async getExpensesByCategory(
    entityId: string,
    startDate: Date,
    endDate: Date,
  ) {
    this.logger.log(
      `Getting expenses by category for entity ${entityId}, period: ${startDate} - ${endDate}`,
    );
    throw new Error('Not implemented: getExpensesByCategory');
  }

  /**
   * 取得可用的報銷項目（ReimbursementItem）清單
   * 會根據 entity / 角色 / 部門過濾
   */
  async getReimbursementItems(
    entityId: string,
    options?: { roles?: string[]; departmentId?: string },
  ) {
    this.logger.log(
      `Fetching reimbursement items for entity ${entityId} with roles=${options?.roles?.join(',') ?? 'N/A'} department=${
        options?.departmentId ?? 'N/A'
      }`,
    );
    return this.expenseRepository.findActiveReimbursementItems(
      entityId,
      options,
    );
  }

  async listReimbursementItemsAdmin(
    entityId?: string,
    includeInactive?: boolean,
  ) {
    return this.expenseRepository.listReimbursementItemsAdmin({
      entityId,
      includeInactive,
    });
  }

  async getReimbursementItemAdmin(id: string) {
    return this.ensureReimbursementItem(id);
  }

  async createReimbursementItemAdmin(dto: CreateReimbursementItemDto) {
    return this.expenseRepository.createReimbursementItem(
      this.buildReimbursementItemCreatePayload(dto),
    );
  }

  async updateReimbursementItemAdmin(
    id: string,
    dto: UpdateReimbursementItemDto,
  ) {
    await this.ensureReimbursementItem(id);
    return this.expenseRepository.updateReimbursementItem(
      id,
      this.buildReimbursementItemUpdatePayload(dto),
    );
  }

  async archiveReimbursementItemAdmin(id: string) {
    await this.ensureReimbursementItem(id);
    return this.expenseRepository.archiveReimbursementItem(id);
  }

  async listApprovalPolicies(entityId?: string) {
    return this.expenseRepository.listApprovalPolicies(entityId);
  }

  async submitIntelligentExpenseRequest(
    dto: CreateExpenseRequestDto,
    requestedBy: UserContext,
  ) {
    const access = await this.assertEntityAccess(requestedBy.id, dto.entityId);
    if (!access.admin && !access.permissions.includes('expense_self:create')) throw new ForbiddenException('沒有建立費用申請的權限');
    const validatedEvidence = parseReceiptFiles(dto.evidenceFiles || []);
    const { employee, supervisor } = await this.resolveExpenseSupervisor(access.user.employee, requestedBy.id, dto.entityId);
    if (!(dto.amountOriginal > 0) || !Number.isFinite(dto.amountOriginal) || (dto.amountFxRate !== undefined && !(dto.amountFxRate > 0))) throw new BadRequestException('費用金額與匯率必須大於零');
    dto.departmentId = employee.departmentId || undefined;
    const amountCurrency = dto.amountCurrency ?? 'TWD';
    const amountFxRate = dto.amountFxRate ?? 1;
    const amountBase = this.toDecimal(dto.amountOriginal * amountFxRate);

    const reimbursementItem = dto.reimbursementItemId
      ? await this.expenseRepository.getReimbursementItemDetail(
          dto.reimbursementItemId,
        )
      : null;

    if (dto.reimbursementItemId && (!reimbursementItem || reimbursementItem.entityId !== dto.entityId || !reimbursementItem.isActive)) throw new BadRequestException('報銷項目不屬於此公司或已停用');
    if (reimbursementItem && !canUseReimbursementItem(reimbursementItem, { roles: access.roles, departmentId: employee.departmentId || undefined })) {
      throw new ForbiddenException('此報銷項目不適用於你的角色或所屬部門');
    }
    if (dto.vendorId && !await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, entityId: dto.entityId, isActive: true } })) throw new BadRequestException('收款廠商不屬於此公司');

    const taxType = dto.taxType ?? reimbursementItem?.defaultTaxType ?? null;
    let taxAmount = dto.taxAmount;

    if (taxAmount === undefined || taxAmount === null) {
      if (
        taxType === TaxType.TAXABLE_5_PERCENT ||
        taxType === TaxType.NON_DEDUCTIBLE_5_PERCENT
      ) {
        taxAmount = Math.round((dto.amountOriginal / 1.05) * 0.05);
      } else {
        taxAmount = 0;
      }
    }

    const suggestion = await this.classifierService.suggestAccount({
      entityId: dto.entityId,
      description: dto.description,
      amountOriginal: dto.amountOriginal,
      amountCurrency,
      reimbursementItemId: dto.reimbursementItemId,
      reimbursementItemKeywords: this.parseKeywords(
        reimbursementItem?.keywords,
      ),
      reimbursementItemAccountId: reimbursementItem?.accountId,
      vendorId: dto.vendorId,
      departmentId: dto.departmentId,
      receiptType:
        dto.receiptType ?? reimbursementItem?.defaultReceiptType ?? undefined,
      metadata: dto.metadata,
    });

    const approvalSteps = this.buildRequestApprovalSteps(reimbursementItem, dto.amountOriginal, employee.departmentId, supervisor.user.id);

    const requestData: Prisma.ExpenseRequestUncheckedCreateInput = {
      entityId: dto.entityId,
      payeeType: dto.payeeType ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      vendorId: dto.vendorId ?? null,
      reimbursementItemId: dto.reimbursementItemId ?? null,
      amountOriginal: this.toDecimal(dto.amountOriginal),
      amountCurrency,
      amountFxRate: this.toDecimal(amountFxRate),
      amountBase,
      taxType,
      taxAmount: this.toDecimal(taxAmount),
      dueDate: dto.dueDate ?? null,
      description: dto.description,
      remarks: dto.remarks ?? null,
      priority: dto.priority ?? 'normal',
      attachmentUrl: dto.attachmentUrl ?? null,
      evidenceFiles: this.toJsonArray(dto.evidenceFiles),
      departmentId: dto.departmentId ?? null,
      receiptType:
        dto.receiptType ?? reimbursementItem?.defaultReceiptType ?? null,
      createdBy: requestedBy.id,
      status: 'pending',
      suggestedAccountId: suggestion.accountId ?? null,
      finalAccountId: null,
      suggestionConfidence: this.toDecimal(suggestion.confidence),
      metadata: this.buildJsonObject(dto.metadata, {
        classifierFeatures: suggestion.features,
        receiptFingerprints: validatedEvidence.map(file => file.fingerprint),
      }),
    };

    const history = {
      action: 'submitted',
      fromStatus: 'draft',
      toStatus: 'pending',
      actorId: requestedBy.id,
      actorRoleCode: requestedBy.roleCodes?.[0],
      note: dto.description,
      metadata: this.toJsonObject(suggestion.features),
      suggestedAccountId: suggestion.accountId ?? undefined,
    };

    const classifierFeedback = suggestion.accountId
      ? {
          entityId: dto.entityId,
          description: dto.description,
          suggestedAccountId: suggestion.accountId,
          suggestedItemId: dto.reimbursementItemId ?? null,
          chosenItemId: null,
          confidence: this.toDecimal(suggestion.confidence),
          label: 'pending',
          features: this.toJsonObject(suggestion.features),
          createdBy: requestedBy.id,
        }
      : undefined;

    const result = await this.expenseRepository.createExpenseRequestGraph({
      requestData,
      history,
      approvalSteps,
      classifierFeedback,
    });

    try {
      await this.notificationService.create({ userId: supervisor.user.id, title: '待審費用申請', message: `${access.user.name} 提交費用申請：${dto.description}`, type: 'info', category: 'expense', data: { requestId: result.id, entityId: dto.entityId } });
    } catch (error) { this.logger.warn('費用已送審，但主管站內通知未成功'); }

    if (dto.priority === 'urgent') {
      try {
        const admins = await this.prisma.user.findMany({
          where: {
            roles: {
              some: {
                role: {
                  code: { in: ['ADMIN', 'SUPER_ADMIN'] },
                },
              },
            },
          },
        });

        for (const admin of admins) {
          await this.notificationService.create({
            userId: admin.id,
            title: '急件費用申請通知',
            message: `收到一筆急件費用申請：${dto.description}，請盡速處理。`,
            type: 'warning',
            category: 'expense',
            data: {
              requestId: result.id,
              entityId: dto.entityId,
            },
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to send urgent notifications: ${error.message}`,
          error.stack,
        );
      }
    }

    return result;
  }

  async getExpenseRequestHistory(id: string) {
    await this.ensureExpenseRequest(id);
    return this.expenseRepository.listHistories(id);
  }

  async getExpenseRequest(id: string) {
    return this.ensureExpenseRequest(id);
  }

  async submitFeedback(
    requestId: string,
    user: UserContext,
    dto: SubmitExpenseFeedbackDto,
  ) {
    const request = await this.ensureExpenseRequest(requestId);

    return this.expenseRepository.createFeedbackEntry({
      entityId: request.entityId,
      description: dto.description ?? request.description,
      suggestedItemId: dto.suggestedItemId ?? request.suggestedItemId ?? null,
      chosenItemId:
        dto.chosenItemId ??
        request.reimbursementItemId ??
        request.suggestedItemId ??
        null,
      expenseRequestId: requestId,
      suggestedAccountId: dto.suggestedAccountId ?? null,
      chosenAccountId: dto.chosenAccountId ?? null,
      confidence: dto.confidence ? this.toDecimal(dto.confidence) : undefined,
      label: dto.label,
      features: this.toJsonObject(dto.features),
      createdBy: user.id,
    });
  }

  private async ensureExpenseRequest(
    id: string,
  ): Promise<ExpenseRequestWithGraph> {
    const request = await this.expenseRepository.findRequestById(id);
    if (!request) {
      throw new NotFoundException(`Expense request ${id} not found`);
    }
    return request as ExpenseRequestWithGraph;
  }

  private async ensureReimbursementItem(id: string) {
    const item = await this.expenseRepository.getReimbursementItemDetail(id);
    if (!item) {
      throw new NotFoundException(`Reimbursement item ${id} not found`);
    }
    return item;
  }

  private toDecimal(value: number) {
    if (Number.isNaN(value)) {
      throw new BadRequestException('Amount must be a valid number');
    }
    return new Prisma.Decimal(Number(value.toFixed(2)));
  }

  private parseKeywords(value?: string | null) {
    return value
      ? value
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean)
      : [];
  }

  private buildApprovalSteps(
    steps: Array<{
      stepOrder: number;
      approverRoleCode: string | null;
      requiresDepartmentHead: boolean;
      minAmount: Prisma.Decimal | null;
      maxAmount: Prisma.Decimal | null;
    }> = [],
    amountOriginal: number,
    departmentId?: string,
  ) {
    if (!steps.length) {
      return [];
    }

    return steps
      .filter((step) => this.withinThreshold(step, amountOriginal))
      .map((step) => ({
        stepOrder: step.stepOrder,
        status: 'pending',
        approverRoleCode: step.approverRoleCode ?? undefined,
        departmentId: step.requiresDepartmentHead
          ? (departmentId ?? null)
          : null,
        amountThreshold: this.toDecimal(amountOriginal),
      }));
  }

  private withinThreshold(
    step: {
      minAmount?: Prisma.Decimal | null;
      maxAmount?: Prisma.Decimal | null;
    },
    amount: number,
  ) {
    const min = step.minAmount ? Number(step.minAmount) : undefined;
    const max = step.maxAmount ? Number(step.maxAmount) : undefined;
    if (typeof min !== 'undefined' && amount < min) {
      return false;
    }
    if (typeof max !== 'undefined' && amount > max) {
      return false;
    }
    return true;
  }

  private buildJsonObject(
    base?: Record<string, unknown> | null,
    extra?: Record<string, unknown>,
  ): Prisma.JsonObject | undefined {
    if (!base && !extra) {
      return undefined;
    }

    const merged: Record<string, unknown> = {
      ...(base ?? {}),
      ...(extra ?? {}),
    };

    if (!Object.keys(merged).length) {
      return undefined;
    }

    return merged as Prisma.JsonObject;
  }

  private toJsonObject(
    value?: Record<string, unknown> | null,
  ): Prisma.JsonObject | undefined {
    if (!value) {
      return undefined;
    }
    return { ...value } as Prisma.JsonObject;
  }

  private toJsonArray<T>(value?: T[] | null): Prisma.JsonArray | undefined {
    if (!value) {
      return undefined;
    }
    return value as unknown as Prisma.JsonArray;
  }

  private jsonValueToObject(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return { ...(value as Record<string, unknown>) };
  }

  private mergeMetadata(
    existing: Prisma.JsonValue | null | undefined,
    incoming?: Record<string, unknown>,
  ): Prisma.JsonObject | undefined {
    if (!existing && !incoming) {
      return undefined;
    }

    const current = this.jsonValueToObject(existing);
    const merged: Record<string, unknown> = {
      ...current,
      ...(incoming ?? {}),
    };

    if (!Object.keys(merged).length) {
      return undefined;
    }

    return merged as Prisma.JsonObject;
  }

  private buildReimbursementItemCreatePayload(
    dto: CreateReimbursementItemDto,
  ): Prisma.ReimbursementItemUncheckedCreateInput {
    return {
      entityId: dto.entityId,
      name: dto.name,
      accountId: dto.accountId,
      description: dto.description ?? null,
      keywords: this.stringifyList(dto.keywords),
      amountLimit:
        typeof dto.amountLimit === 'number'
          ? this.toDecimal(dto.amountLimit)
          : undefined,
      requiresDepartmentHead: dto.requiresDepartmentHead ?? false,
      approverRoleCodes: this.stringifyList(dto.approverRoleCodes),
      approvalPolicyId: dto.approvalPolicyId ?? null,
      defaultReceiptType: dto.defaultReceiptType ?? null,
      allowedReceiptTypes: this.stringifyList(dto.allowedReceiptTypes),
      allowedRoles: this.stringifyList(dto.allowedRoles),
      allowedDepartments: this.stringifyList(dto.allowedDepartments),
      isActive: dto.isActive ?? true,
    } as Prisma.ReimbursementItemUncheckedCreateInput;
  }

  private buildReimbursementItemUpdatePayload(
    dto: UpdateReimbursementItemDto,
  ): Prisma.ReimbursementItemUncheckedUpdateInput {
    const payload: Prisma.ReimbursementItemUncheckedUpdateInput = {};

    if (typeof dto.entityId !== 'undefined') {
      payload.entityId = dto.entityId;
    }
    if (typeof dto.name !== 'undefined') {
      payload.name = dto.name;
    }
    if (typeof dto.accountId !== 'undefined') {
      payload.accountId = dto.accountId;
    }
    if (typeof dto.description !== 'undefined') {
      payload.description = dto.description ?? null;
    }
    if (typeof dto.keywords !== 'undefined') {
      payload.keywords = this.stringifyList(dto.keywords);
    }
    if (typeof dto.amountLimit !== 'undefined') {
      payload.amountLimit = this.toDecimal(dto.amountLimit);
    }
    if (typeof dto.requiresDepartmentHead !== 'undefined') {
      payload.requiresDepartmentHead = dto.requiresDepartmentHead;
    }
    if (typeof dto.approverRoleCodes !== 'undefined') {
      payload.approverRoleCodes = this.stringifyList(dto.approverRoleCodes);
    }
    if (typeof dto.approvalPolicyId !== 'undefined') {
      payload.approvalPolicyId = dto.approvalPolicyId ?? null;
    }
    if (typeof dto.defaultReceiptType !== 'undefined') {
      payload.defaultReceiptType = dto.defaultReceiptType ?? null;
    }
    if (typeof dto.allowedReceiptTypes !== 'undefined') {
      payload.allowedReceiptTypes = this.stringifyList(dto.allowedReceiptTypes);
    }
    if (typeof dto.allowedRoles !== 'undefined') {
      payload.allowedRoles = this.stringifyList(dto.allowedRoles);
    }
    if (typeof dto.allowedDepartments !== 'undefined') {
      payload.allowedDepartments = this.stringifyList(dto.allowedDepartments);
    }
    if (typeof dto.isActive !== 'undefined') {
      payload.isActive = dto.isActive;
    }

    return payload;
  }

  private stringifyList(values?: string[]) {
    if (!values) {
      return null;
    }
    const normalized = values
      .map((value) => value.trim())
      .filter((value) => value.length);
    return normalized.length ? normalized.join(',') : null;
  }
}
