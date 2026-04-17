import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService } from './ai.service';
import {
  AI_AGENT_CORE_PRINCIPLES,
  AI_AGENT_RESPONSE_STYLE,
} from './ai-principles';
import dayjs from 'dayjs';
import { ReportsService } from '../reports/reports.service';

export type DailyBriefingAlert = {
  key: string;
  title: string;
  count: number;
  tone: 'healthy' | 'warning' | 'critical';
  helper: string;
};

@Injectable()
export class AiInsightsService {
  private readonly logger = new Logger(AiInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly reportsService: ReportsService,
  ) {}

  async getDailyBriefing(
    entityId: string,
    modelId?: string,
  ): Promise<{ insight: string; alerts: DailyBriefingAlert[] }> {
    const yesterday = dayjs().subtract(1, 'day').startOf('day').toDate();
    const today = dayjs().startOf('day').toDate();
    const auditWindowStart = dayjs().subtract(14, 'day').startOf('day').toDate();

    // 1. Gather Data (Direct Prisma for performance/avoiding circular deps)
    const [salesData, expenseData, audit, executive] = await Promise.all([
      this.prisma.salesOrder.aggregate({
        where: {
          entityId,
          createdAt: { gte: yesterday, lt: today },
        },
        _sum: { totalGrossBase: true },
        _count: { id: true },
      }),
      this.prisma.expenseRequest.aggregate({
        where: {
          entityId,
          createdAt: { gte: yesterday, lt: today },
        },
        _sum: { amountOriginal: true },
        _count: { id: true },
      }),
      this.reportsService.getOrderReconciliationAudit(
        entityId,
        auditWindowStart,
        today,
        80,
      ),
      this.reportsService.getDashboardExecutiveOverview(
        entityId,
        auditWindowStart,
        today,
      ),
    ]);

    const salesTotal = salesData._sum.totalGrossBase || 0;
    const salesCount = salesData._count.id || 0;
    const expenseTotal = expenseData._sum.amountOriginal || 0;
    const expenseCount = expenseData._count.id || 0;

    // 2. Generate Prompt
    const prompt = `
${AI_AGENT_CORE_PRINCIPLES}
${AI_AGENT_RESPONSE_STYLE}

Role:
You are a CFO assistant analyzing yesterday's financial data for the dashboard.

Data:
- Date: ${dayjs(yesterday).format('YYYY-MM-DD')}
- Total Sales: TWD ${salesTotal} (${salesCount} orders)
- Total Expenses: TWD ${expenseTotal} (${expenseCount} requests)

Task:
Write a concise, one-sentence "Daily Financial Insight" in Traditional Chinese (Taiwan).
Highlight the net flow (Sales - Expenses) and mention if it was a busy day or quiet day.
Less is more: focus on the single most important signal.
Tone: Professional, encouraging, and insightful.
Max length: 50 words.
`;

    // 3. Call AI
    try {
      const insight = await this.aiService.generateContent(prompt, modelId);
      return {
        insight: insight?.trim() || '昨日財務數據處理中，請稍後再試。',
        alerts: this.buildProactiveAlerts(audit, executive),
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate daily briefing for entity ${entityId}`,
        error,
      );
      return {
        insight: '暫時無法整理昨日重點，請稍後再試。',
        alerts: this.buildProactiveAlerts(audit, executive),
      };
    }
  }

  async checkExpenseAnomaly(
    entityId: string,
    amount: number,
    reimbursementItemId: string,
    modelId?: string,
  ): Promise<{ isAnomaly: boolean; reason?: string }> {
    // 1. Get historical average for this item
    const stats = await this.prisma.expenseRequest.aggregate({
      where: {
        entityId,
        reimbursementItemId,
        status: 'approved',
      },
      _avg: { amountOriginal: true },
      _count: { id: true },
    });

    const avgAmount = stats._avg.amountOriginal;
    const count = stats._count.id || 0;

    // Not enough data to judge
    if (count < 5) return { isAnomaly: false };

    const avgVal = avgAmount ? Number(avgAmount) : 0;

    // Simple Rule: > 200% of average
    if (amount > avgVal * 2) {
      return {
        isAnomaly: true,
        reason: `金額 TWD ${amount} 顯著高於歷史平均 (TWD ${avgVal.toFixed(0)})`,
      };
    }

    // AI Check for context (optional, if description provided)
    // For now, rule-based is faster and cheaper for "Anomaly"
    return { isAnomaly: false };
  }

  private buildProactiveAlerts(audit: any, executive: any): DailyBriefingAlert[] {
    const items = Array.isArray(audit?.items) ? audit.items : [];
    const missingInvoice = items.filter((item) =>
      item.anomalyCodes?.includes('missing_invoice_after_payment') ||
      item.anomalyCodes?.includes('reconciled_without_invoice'),
    );
    const taxAnomalies = items.filter((item) =>
      item.anomalyCodes?.includes('order_tax_mismatch') ||
      item.anomalyCodes?.includes('invoice_tax_mismatch'),
    );
    const feeAnomalies = items.filter((item) =>
      item.anomalyCodes?.includes('fee_mismatch') ||
      item.anomalyCodes?.includes('fee_backfill_needed'),
    );
    const paymentMismatch = items.filter((item) =>
      item.anomalyCodes?.includes('order_payment_mismatch'),
    );

    const alerts: DailyBriefingAlert[] = [
      {
        key: 'high-risk',
        title: '高風險對帳單',
        count: items.filter((item) => item.severity === 'critical').length,
        tone: items.some((item) => item.severity === 'critical')
          ? 'critical'
          : 'healthy',
        helper: '優先追有金額差、稅額差或已付款未開票的訂單。',
      },
      {
        key: 'invoice',
        title: '待補發票',
        count: missingInvoice.length,
        tone: missingInvoice.length ? 'warning' : 'healthy',
        helper: '已付款或已對帳卻還沒有正式發票的訂單，需要先補發票。',
      },
      {
        key: 'tax',
        title: '疑似稅額異常',
        count: taxAnomalies.length,
        tone: taxAnomalies.length ? 'critical' : 'healthy',
        helper: '系統抓到訂單稅額或發票稅額與 5% 口徑不一致。',
      },
      {
        key: 'fees',
        title: '手續費待補 / 待追',
        count: feeAnomalies.length + Number(executive?.operations?.feeBackfillCount || 0),
        tone:
          feeAnomalies.length || Number(executive?.operations?.feeBackfillCount || 0)
            ? 'warning'
            : 'healthy',
        helper: '確認綠界與平台抽成是否已回填到淨額，避免帳款看起來對、實際費率卻不對。',
      },
      {
        key: 'order-payment',
        title: '訂單與帳款不一致',
        count: paymentMismatch.length,
        tone: paymentMismatch.length ? 'critical' : 'healthy',
        helper: '優先檢查退款、折讓、超商未取與貨到付款造成的差額。',
      },
    ];

    return alerts.filter((alert) => alert.count > 0).slice(0, 4);
  }
}
