import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService } from './ai.service';
import { AiKnowledgeService } from './ai-knowledge.service';
import {
  AI_AGENT_CORE_PRINCIPLES,
  AI_AGENT_RESPONSE_STYLE,
} from './ai-principles';
import dayjs from 'dayjs';

interface CopilotIntent {
  tool: string;
  params: Record<string, any>;
  reply?: string;
}

export interface AiCopilotSource {
  kind: 'metric' | 'record' | 'knowledge';
  title: string;
  detail?: string;
  path?: string;
}

interface CopilotResponse {
  reply: string;
  data?: any;
  sources?: AiCopilotSource[];
}

@Injectable()
export class AiCopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly knowledgeService: AiKnowledgeService,
  ) {}

  async processChat(
    entityId: string,
    userId: string,
    message: string,
    modelId?: string,
  ): Promise<CopilotResponse> {
    const prompt = `
${AI_AGENT_CORE_PRINCIPLES}

Role:
You are a business copilot inside an e-commerce accounting system.

User Query: "${message}"
Current Date: ${dayjs().format('YYYY-MM-DD')}

Available Tools:
1. get_sales_stats(startDate: string, endDate: string)
2. get_expense_stats(startDate: string, endDate: string, status?: string)
3. get_product_cost(productName: string)
4. find_product(keyword: string)
5. find_sales_order(keyword: string)
6. find_customer(keyword: string)
7. find_vendor(keyword: string)
8. search_system_knowledge(query: string)
9. get_bank_balances()
10. get_payroll_summary(month?: string)
11. general_chat()

Decision Rules:
- First understand the user's real goal.
- If the user is asking how to use the system, where to find something, or what a page is for, use "search_system_knowledge".
- If the user mentions an order number, customer order, platform order, or wants to find a specific order, use "find_sales_order".
- If the user wants to find a customer record, use "find_customer".
- If the user wants to find a vendor or supplier, use "find_vendor".
- If the user wants to find a product record or SKU, use "find_product".
- If the user asks about product cost or stock value, use "get_product_cost".
- If the user asks about bank balance, cash, or money in bank, use "get_bank_balances".
- If the user asks about payroll, salaries, or employee costs, use "get_payroll_summary".
- Convert natural language dates into exact YYYY-MM-DD ranges.
- If no date is specified for sales or expenses, default to the current month through today.
- If the user asks for "pending" or "waiting" expenses, set status to "pending".
- If the request is greeting, chit-chat, or cannot be answered with current tools, use "general_chat".

Return JSON ONLY:
{ "tool": "TOOL_NAME", "params": { ... }, "reply": "Optional short conversational filler" }
`;

    const aiResponse = await this.aiService.generateContent(prompt, modelId);
    const intent =
      this.aiService.parseJsonOutput<CopilotIntent>(aiResponse || '{}') ||
      ({
        tool: 'general_chat',
        params: {},
      } satisfies CopilotIntent);

    if (!intent.tool) {
      return { reply: '抱歉，我暫時無法理解您的需求。' };
    }

    if (
      ['get_product_cost', 'get_bank_balances', 'get_payroll_summary'].includes(
        intent.tool,
      )
    ) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });

      const isSuperAdmin = user?.roles.some(
        (relation) => relation.role.code === 'SUPER_ADMIN',
      );

      if (!isSuperAdmin) {
        return {
          reply: `抱歉，您沒有權限查詢此敏感資訊 (${intent.tool})。此功能僅限超級管理員使用。`,
        };
      }
    }

    let toolResult = '';
    let toolData: unknown = null;
    let sources: AiCopilotSource[] = [];

    switch (intent.tool) {
      case 'get_sales_stats': {
        const data = await this.getSalesStats(
          entityId,
          intent.params.startDate,
          intent.params.endDate,
        );
        toolData = data;
        toolResult = `Sales: TWD ${data.total} (${data.count} orders)`;
        sources = [
          {
            kind: 'metric',
            title: '銷售訂單',
            detail: `${data.startDate} 至 ${data.endDate}`,
            path: '/sales/orders',
          },
        ];
        break;
      }

      case 'get_expense_stats': {
        const data = await this.getExpenseStats(
          entityId,
          intent.params.startDate,
          intent.params.endDate,
          intent.params.status,
        );
        toolData = data;
        toolResult = `Expenses: TWD ${data.total} (${data.count} requests)`;
        sources = [
          {
            kind: 'metric',
            title:
              intent.params.status === 'pending' ? '待審費用申請' : '費用申請',
            detail: `${data.startDate} 至 ${data.endDate}`,
            path:
              intent.params.status === 'pending'
                ? '/ap/expense-review'
                : '/ap/expenses',
          },
        ];
        break;
      }

      case 'get_product_cost': {
        const productName =
          intent.params.productName || intent.params.keyword || message;
        const data = await this.getProductCost(entityId, productName);
        toolData = data;
        toolResult = data
          ? `Product: ${data.name} (${data.sku})
Floating Cost: TWD ${data.movingAverageCost}
Latest Purchase Price: TWD ${data.latestPurchasePrice}
Stock: ${data.stock} units`
          : `Product "${productName}" not found.`;
        sources = data
          ? [
              {
                kind: 'record',
                title: `${data.name} (${data.sku})`,
                detail: `庫存 ${data.stock}，移動平均成本 TWD ${data.movingAverageCost}`,
                path: '/inventory/products',
              },
            ]
          : [];
        break;
      }

      case 'find_product': {
        const keyword = intent.params.keyword || message;
        const data = await this.findProducts(entityId, keyword);
        toolData = data;
        toolResult = data.length
          ? `Matching products:
${data
  .map(
    (product) =>
      `- ${product.name} (${product.sku}) / ${product.category || '未分類'} / ${product.isActive ? '啟用中' : '停用中'}`,
  )
  .join('\n')}`
          : `No product found for "${keyword}".`;
        sources = data.map((product) => ({
          kind: 'record',
          title: `${product.name} (${product.sku})`,
          detail: product.category || '商品資料',
          path: '/inventory/products',
        }));
        break;
      }

      case 'find_sales_order': {
        const keyword = intent.params.keyword || message;
        const data = await this.findSalesOrders(entityId, keyword);
        toolData = data;
        toolResult = data.length
          ? `Matching orders:
${data
  .map(
    (order) =>
      `- ${order.externalOrderId || order.id} / ${order.customerName || '未指定客戶'} / ${order.channelName} / ${order.status} / TWD ${order.total}`,
  )
  .join('\n')}`
          : `No order found for "${keyword}".`;
        sources = data.map((order) => ({
          kind: 'record',
          title: order.externalOrderId || order.id,
          detail: `${order.customerName || '未指定客戶'} / ${order.channelName} / ${order.status}`,
          path: '/sales/orders',
        }));
        break;
      }

      case 'find_customer': {
        const keyword = intent.params.keyword || message;
        const data = await this.findCustomers(entityId, keyword);
        toolData = data;
        toolResult = data.length
          ? `Matching customers:
${data
  .map(
    (customer) =>
      `- ${customer.name} / ${customer.type} / ${customer.email || '無 Email'} / ${customer.phone || '無電話'}`,
  )
  .join('\n')}`
          : `No customer found for "${keyword}".`;
        sources = data.map((customer) => ({
          kind: 'record',
          title: customer.name,
          detail: `${customer.type} / ${customer.email || customer.phone || '無聯絡方式'}`,
          path: '/sales/customers',
        }));
        break;
      }

      case 'find_vendor': {
        const keyword = intent.params.keyword || message;
        const data = await this.findVendors(entityId, keyword);
        toolData = data;
        toolResult = data.length
          ? `Matching vendors:
${data
  .map(
    (vendor) =>
      `- ${vendor.name} / ${vendor.contactPerson || '無聯絡人'} / ${vendor.contactEmail || vendor.contactPhone || '無聯絡方式'}`,
  )
  .join('\n')}`
          : `No vendor found for "${keyword}".`;
        sources = data.map((vendor) => ({
          kind: 'record',
          title: vendor.name,
          detail:
            vendor.contactPerson ||
            vendor.contactEmail ||
            vendor.contactPhone ||
            '供應商資料',
          path: '/vendors',
        }));
        break;
      }

      case 'search_system_knowledge': {
        const query = intent.params.query || message;
        const data = this.knowledgeService.search(query);
        toolData = data;
        toolResult = data.length
          ? `Knowledge results:
${data
  .map(
    (entry) =>
      `- ${entry.title} / ${entry.summary}${entry.path ? ` / Path: ${entry.path}` : ''}`,
  )
  .join('\n')}`
          : `No system knowledge found for "${query}".`;
        sources = data.map((entry) => ({
          kind: 'knowledge',
          title: entry.title,
          detail: entry.summary,
          path: entry.path,
        }));
        break;
      }

      case 'get_bank_balances': {
        const data = await this.getBankBalances(entityId);
        toolData = data;
        toolResult = `Bank Balances:
${data.map((item) => `- ${item.name}: ${item.currency} ${item.balance}`).join('\n')}`;
        sources = [
          {
            kind: 'metric',
            title: '銀行帳戶餘額',
            detail: '目前帳戶資金與餘額摘要',
            path: '/banking',
          },
        ];
        break;
      }

      case 'get_payroll_summary': {
        const data = await this.getPayrollSummary(
          entityId,
          intent.params.month,
        );
        toolData = data;
        toolResult = `Payroll Summary for ${data.month}:
Total Cost: TWD ${data.totalCost}
Headcount: ${data.headcount}`;
        sources = [
          {
            kind: 'metric',
            title: '薪資批次摘要',
            detail: `${data.month} / 共 ${data.headcount} 人`,
            path: '/payroll/runs',
          },
        ];
        break;
      }

      default:
        return { reply: intent.reply || '您好！我是您的 AI 助手。' };
    }

    const finalPrompt = `
${AI_AGENT_CORE_PRINCIPLES}
${AI_AGENT_RESPONSE_STYLE}

User Query: "${message}"
Tool Result:
${toolResult}

Relevant Sources:
${sources.map((source) => `- ${source.title}${source.detail ? ` / ${source.detail}` : ''}${source.path ? ` / ${source.path}` : ''}`).join('\n') || '- none'}

Task:
Answer the user's question directly based on the tool result.
If there are matching records, summarize the best matches clearly.
If a route or page is relevant, mention it naturally.
If nothing was found, say so honestly and suggest the simplest next keyword or action.
`;

    const finalReply = await this.aiService.generateContent(
      finalPrompt,
      modelId,
    );

    return {
      reply: finalReply || '資料已查詢完成，但暫時無法整理回覆。',
      data: toolData,
      sources,
    };
  }

  private async getSalesStats(
    entityId: string,
    startDate?: string,
    endDate?: string,
  ) {
    const range = this.resolveDateRange(startDate, endDate);
    const data = await this.prisma.salesOrder.aggregate({
      where: {
        entityId,
        orderDate: {
          gte: range.start,
          lte: range.end,
        },
      },
      _sum: { totalGrossBase: true },
      _count: { id: true },
    });

    return {
      startDate: range.startLabel,
      endDate: range.endLabel,
      total: data._sum.totalGrossBase || 0,
      count: data._count.id || 0,
    };
  }

  private async getExpenseStats(
    entityId: string,
    startDate?: string,
    endDate?: string,
    status?: string,
  ) {
    const range = this.resolveDateRange(startDate, endDate);
    const where: any = {
      entityId,
      createdAt: {
        gte: range.start,
        lte: range.end,
      },
    };

    if (status) {
      where.status = status;
    }

    const data = await this.prisma.expenseRequest.aggregate({
      where,
      _sum: { amountOriginal: true },
      _count: { id: true },
    });

    return {
      startDate: range.startLabel,
      endDate: range.endLabel,
      total: data._sum.amountOriginal || 0,
      count: data._count.id || 0,
    };
  }

  private resolveDateRange(startDate?: string, endDate?: string) {
    const start = startDate
      ? dayjs(startDate).startOf('day')
      : dayjs().startOf('month');
    const end = endDate ? dayjs(endDate).endOf('day') : dayjs().endOf('day');

    return {
      start: start.toDate(),
      end: end.toDate(),
      startLabel: start.format('YYYY-MM-DD'),
      endLabel: end.format('YYYY-MM-DD'),
    };
  }

  private async getProductCost(entityId: string, productName: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        entityId,
        OR: [
          { name: { contains: productName, mode: 'insensitive' } },
          { sku: { contains: productName, mode: 'insensitive' } },
        ],
      },
      include: {
        inventorySnapshots: true,
      },
    });

    if (!product) return null;

    const totalStock = product.inventorySnapshots.reduce(
      (sum, snapshot) => sum + Number(snapshot.qtyOnHand),
      0,
    );

    return {
      name: product.name,
      sku: product.sku,
      movingAverageCost: Number(product.movingAverageCost),
      latestPurchasePrice: Number(product.latestPurchasePrice),
      stock: totalStock,
    };
  }

  private async findProducts(entityId: string, keyword: string) {
    const products = await this.prisma.product.findMany({
      where: {
        entityId,
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { sku: { contains: keyword, mode: 'insensitive' } },
          { barcode: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });

    return products;
  }

  private async findSalesOrders(entityId: string, keyword: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        OR: [
          { externalOrderId: { contains: keyword, mode: 'insensitive' } },
          { id: { contains: keyword, mode: 'insensitive' } },
          {
            customer: {
              is: { name: { contains: keyword, mode: 'insensitive' } },
            },
          },
        ],
      },
      include: {
        customer: true,
        channel: true,
      },
      orderBy: { orderDate: 'desc' },
      take: 5,
    });

    return orders.map((order) => ({
      id: order.id,
      externalOrderId: order.externalOrderId,
      customerName: order.customer?.name || null,
      channelName: order.channel.name,
      status: order.status,
      total: Number(order.totalGrossBase),
    }));
  }

  private async findCustomers(entityId: string, keyword: string) {
    const customers = await this.prisma.customer.findMany({
      where: {
        entityId,
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { email: { contains: keyword, mode: 'insensitive' } },
          { phone: { contains: keyword, mode: 'insensitive' } },
          { taxId: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        type: true,
        email: true,
        phone: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });

    return customers;
  }

  private async findVendors(entityId: string, keyword: string) {
    const vendors = await this.prisma.vendor.findMany({
      where: {
        entityId,
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { contactPerson: { contains: keyword, mode: 'insensitive' } },
          { contactEmail: { contains: keyword, mode: 'insensitive' } },
          { contactPhone: { contains: keyword, mode: 'insensitive' } },
          { taxId: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        contactPerson: true,
        contactEmail: true,
        contactPhone: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });

    return vendors;
  }

  private async getBankBalances(entityId: string) {
    const accounts = await this.prisma.account.findMany({
      where: {
        entityId,
        code: { startsWith: '11' },
      },
      include: {
        journalLines: true,
      },
    });

    return accounts.map((account) => {
      const balance = account.journalLines.reduce((sum, line) => {
        return sum + Number(line.debit) - Number(line.credit);
      }, 0);

      return {
        name: account.name,
        currency: 'TWD',
        balance,
      };
    });
  }

  private async getPayrollSummary(entityId: string, month?: string) {
    const targetMonth = month ? dayjs(month) : dayjs();
    const startOfMonth = targetMonth.startOf('month').toDate();
    const endOfMonth = targetMonth.endOf('month').toDate();

    const payrollRuns = await this.prisma.payrollRun.findMany({
      where: {
        entityId,
        periodStart: { gte: startOfMonth },
        periodEnd: { lte: endOfMonth },
      },
      include: {
        items: true,
      },
    });

    let totalCost = 0;
    let headcount = 0;

    for (const run of payrollRuns) {
      const runCost = run.items.reduce((sum, item) => {
        if (
          ['INS_EMP_LABOR', 'INS_EMP_HEALTH', 'TAX_WITHHOLD'].includes(
            item.type,
          )
        ) {
          return sum;
        }
        return sum + Number(item.amountBase);
      }, 0);

      totalCost += runCost;
      headcount += new Set(run.items.map((item) => item.employeeId)).size;
    }

    return {
      month: targetMonth.format('YYYY-MM'),
      totalCost,
      headcount,
    };
  }
}
