import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TaxType } from '@prisma/client';
import {
  ExpenseRepository,
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
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

  /**
   * 審核費用申請
   */
  async approveExpenseRequest(
    requestId: string,
    approver: UserContext,
    payload: ApproveExpenseRequestDto,
  ) {
    const request = await this.ensureExpenseRequest(requestId);
    const finalAccountId =
      payload.finalAccountId ||
      request.finalAccountId ||
      request.suggestedAccountId;

    const updated =
      await this.expenseRepository.updateExpenseRequestWithHistory(
        requestId,
        {
          status: 'approved',
          approvalUserId: approver.id,
          approvedAt: payload.decidedAt ?? new Date(),
          finalAccountId: finalAccountId ?? null,
          metadata: this.mergeMetadata(request.metadata, payload.metadata),
        },
        {
          action: 'approved',
          fromStatus: request.status,
          toStatus: 'approved',
          actorId: approver.id,
          actorRoleCode: approver.roleCodes?.[0],
          note: payload.remark,
          metadata: this.toJsonObject(payload.metadata),
          attachments: this.toJsonArray(payload.attachments),
          suggestedAccountId: request.suggestedAccountId ?? undefined,
          finalAccountId: finalAccountId ?? undefined,
        },
        request.suggestedAccountId
          ? {
              entityId: request.entityId,
              description: request.description,
              suggestedAccountId: request.suggestedAccountId,
              chosenAccountId: finalAccountId ?? request.suggestedAccountId,
              suggestedItemId: request.suggestedItemId ?? null,
              chosenItemId: request.reimbursementItemId ?? null,
              confidence: request.suggestionConfidence ?? new Prisma.Decimal(0),
              label:
                finalAccountId && request.suggestedAccountId !== finalAccountId
                  ? 'incorrect'
                  : 'correct',
              features: request.metadata ?? undefined,
              createdBy: approver.id,
            }
          : undefined,
        {
          entityId: request.entityId,
          vendorId: request.vendorId,
          status: 'pending',
          dueDate: request.dueDate,
          amountOriginal: request.amountOriginal,
          amountCurrency: request.amountCurrency,
          amountFxRate: request.amountFxRate,
          amountBase: request.amountBase,
          notes: `Expense Request Approved: ${request.description}`,
        },
      );

    return updated;
  }

  /**
   * 駁回費用申請
   */
  async rejectExpenseRequest(
    requestId: string,
    approver: UserContext,
    payload: RejectExpenseRequestDto,
  ) {
    const request = await this.ensureExpenseRequest(requestId);

    const result = await this.expenseRepository.updateExpenseRequestWithHistory(
      requestId,
      {
        status: 'rejected',
        approvalUserId: approver.id,
        approvedAt: payload.decidedAt ?? new Date(),
        metadata: this.mergeMetadata(request.metadata, payload.metadata),
      },
      {
        action: 'rejected',
        fromStatus: request.status,
        toStatus: 'rejected',
        actorId: approver.id,
        actorRoleCode: approver.roleCodes?.[0],
        note: payload.reason,
        metadata: this.toJsonObject(payload.metadata),
        attachments: this.toJsonArray(payload.attachments),
        suggestedAccountId: request.suggestedAccountId ?? undefined,
        finalAccountId: request.finalAccountId ?? undefined,
      },
      request.suggestedAccountId
        ? {
            entityId: request.entityId,
            description: request.description,
            suggestedAccountId: request.suggestedAccountId,
            chosenAccountId: request.finalAccountId ?? null,
            suggestedItemId: request.suggestedItemId ?? null,
            chosenItemId: request.reimbursementItemId ?? null,
            confidence: request.suggestionConfidence ?? new Prisma.Decimal(0),
            label: 'rejected',
            features: request.metadata ?? undefined,
            createdBy: approver.id,
          }
        : undefined,
    );

    // Send notification to the requester
    try {
      await this.notificationService.create({
        userId: request.createdBy,
        title: '費用申請已駁回',
        message: `您的費用申請「${request.description}」已被駁回。原因：${payload.reason}`,
        type: 'error',
        category: 'expense',
        data: { requestId: request.id },
      });
    } catch (error) {
      this.logger.error(`Failed to send rejection notification: ${error}`);
      // Do not throw error, let the rejection proceed
    }

    return result;
  }

  /**
   * 更新費用申請的付款資訊
   */
  async updatePaymentInfo(
    requestId: string,
    data: UpdatePaymentInfoDto,
    user: UserContext,
  ) {
    const request = await this.ensureExpenseRequest(requestId);

    const updateData: Prisma.ExpenseRequestUpdateInput = {
      paymentStatus: data.paymentStatus,
    };

    if (data.paymentMethod) {
      updateData.paymentMethod = data.paymentMethod;
    }

    // 若付款狀態變更為已付款，且之前未付款，則更新主狀態為 paid
    if (data.paymentStatus === 'paid' && request.paymentStatus !== 'paid') {
      updateData.status = 'paid';
    }

    const updated = await this.prisma.expenseRequest.update({
      where: { id: requestId },
      data: updateData,
    });

    // 記錄操作歷史
    await this.prisma.expenseRequestHistory.create({
      data: {
        expenseRequestId: requestId,
        action: 'payment_update',
        fromStatus: request.paymentStatus,
        toStatus: data.paymentStatus,
        actorId: user.id,
        actorRoleCode: user.roleCodes?.[0],
        note: `Payment info updated: Status=${data.paymentStatus}, Method=${data.paymentMethod || 'N/A'}`,
      },
    });

    return updated;
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
    const amountCurrency = dto.amountCurrency ?? 'TWD';
    const amountFxRate = dto.amountFxRate ?? 1;
    const amountBase = this.toDecimal(dto.amountOriginal * amountFxRate);

    const reimbursementItem = dto.reimbursementItemId
      ? await this.expenseRepository.getReimbursementItemDetail(
          dto.reimbursementItemId,
        )
      : null;

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

    const approvalSteps = this.buildApprovalSteps(
      reimbursementItem?.approvalPolicy?.steps ?? [],
      dto.amountOriginal,
      dto.departmentId,
    );

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
