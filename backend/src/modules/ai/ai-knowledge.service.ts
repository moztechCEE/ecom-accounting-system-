import { Injectable } from '@nestjs/common';

export interface AiKnowledgeEntry {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  path?: string;
  module: string;
}

@Injectable()
export class AiKnowledgeService {
  private readonly entries: AiKnowledgeEntry[] = [
    {
      id: 'dashboard',
      title: '儀表板總覽',
      summary: '查看營收、毛利、待辦與 AI 昨日重點的總入口。',
      keywords: [
        'dashboard',
        '首頁',
        '總覽',
        '營收',
        '毛利',
        '昨日重點',
        '儀表板',
      ],
      path: '/dashboard',
      module: 'dashboard',
    },
    {
      id: 'expense-requests',
      title: '費用申請',
      summary: '建立員工代墊或廠商直付申請，並可讓助手先判斷報銷項目與金額。',
      keywords: [
        '費用申請',
        '報銷',
        '請款',
        '代墊',
        '直付',
        'expense',
        'reimbursement',
      ],
      path: '/ap/expenses',
      module: 'expense',
    },
    {
      id: 'expense-review',
      title: '費用審核中心',
      summary: '集中審核待處理的費用申請，適合會計或主管進行複核。',
      keywords: [
        '審核',
        '簽核',
        '複核',
        'pending',
        'expense review',
        '費用審核',
      ],
      path: '/ap/expense-review',
      module: 'expense',
    },
    {
      id: 'accounts-payable',
      title: '應付與待付款中心',
      summary: '查看待付款項、應付發票與費用相關付款任務。',
      keywords: ['應付', '付款', 'ap', 'payable', '待付款', '付款中心'],
      path: '/ap/payable',
      module: 'ap',
    },
    {
      id: 'reimbursement-items',
      title: '報銷項目管理',
      summary: '管理報銷項目、關鍵字、對應科目與 AI 預設題庫。',
      keywords: [
        '報銷項目',
        '題庫',
        'AI 題庫',
        'reimbursement item',
        '關鍵字',
        '會計科目',
      ],
      path: '/admin/reimbursement-items',
      module: 'expense',
    },
    {
      id: 'system-settings',
      title: '系統設定',
      summary: '管理通知、安全性與 AI 協作方式，例如標準模式與深度模式。',
      keywords: [
        '設定',
        'system settings',
        'AI 模式',
        '標準模式',
        '深度模式',
        '通知',
        '安全性',
      ],
      path: '/admin/settings',
      module: 'settings',
    },
    {
      id: 'access-control',
      title: '權限管理',
      summary: '管理使用者、角色與權限，適合處理誰能看什麼資料。',
      keywords: [
        '權限',
        '角色',
        '使用者',
        'rbac',
        'access control',
        '權限管理',
      ],
      path: '/admin/access-control',
      module: 'auth',
    },
    {
      id: 'sales-orders',
      title: '銷售訂單',
      summary: '查看訂單狀態、客戶、渠道與銷售金額的主要頁面。',
      keywords: [
        '訂單',
        'sales order',
        '銷售',
        'order',
        '客戶訂單',
        '平台訂單',
      ],
      path: '/sales/orders',
      module: 'sales',
    },
    {
      id: 'customers',
      title: '客戶管理',
      summary: '查詢客戶基本資料、聯絡方式與客戶類型。',
      keywords: ['客戶', 'customer', '客戶管理', '聯絡方式', '公司', '個人'],
      path: '/sales/customers',
      module: 'sales',
    },
    {
      id: 'products',
      title: '商品管理',
      summary: '查看商品 SKU、名稱、成本、售價與庫存快照。',
      keywords: ['商品', 'product', 'sku', '成本', '售價', '庫存', '品項'],
      path: '/inventory/products',
      module: 'inventory',
    },
    {
      id: 'vendors',
      title: '供應商管理',
      summary: '查詢供應商聯絡方式、幣別與付款資訊。',
      keywords: ['供應商', 'vendor', '廠商', '聯絡人', '付款資訊'],
      path: '/vendors',
      module: 'vendor',
    },
    {
      id: 'purchase-orders',
      title: '採購單',
      summary: '建立與追蹤採購單，管理採購流程與進貨。',
      keywords: ['採購', 'purchase order', '進貨', '採購單'],
      path: '/purchasing/orders',
      module: 'purchase',
    },
    {
      id: 'banking',
      title: '銀行帳務',
      summary: '查看銀行帳戶餘額、資金流與對帳資訊。',
      keywords: ['銀行', 'banking', '餘額', '對帳', '資金', '帳戶'],
      path: '/banking',
      module: 'banking',
    },
    {
      id: 'payroll',
      title: '薪資管理',
      summary: '查看薪資批次、薪資成本與員工薪資相關資料。',
      keywords: ['薪資', 'payroll', '薪資成本', '員工成本', '薪資批次'],
      path: '/payroll/runs',
      module: 'payroll',
    },
    {
      id: 'attendance',
      title: '出勤與請假',
      summary: '處理出勤、請假與人員日常出勤管理。',
      keywords: ['出勤', '請假', 'attendance', 'leave', '打卡'],
      path: '/attendance/dashboard',
      module: 'attendance',
    },
    {
      id: 'ai-principles',
      title: 'AI 助手原則',
      summary:
        '核心原則是少即是多，大道至簡：先理解問題，再找最相關的資料與最短答案。',
      keywords: ['AI 原則', '少即是多', '大道至簡', 'agent', 'copilot', '知識'],
      path: '/admin/settings',
      module: 'ai',
    },
  ];

  search(query: string, limit = 5): AiKnowledgeEntry[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) {
      return this.entries.slice(0, limit);
    }

    return this.entries
      .map((entry) => ({
        entry,
        score: this.score(entry, tokens),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.entry);
  }

  private score(entry: AiKnowledgeEntry, tokens: string[]): number {
    const haystacks = [
      entry.title.toLowerCase(),
      entry.summary.toLowerCase(),
      entry.module.toLowerCase(),
      entry.path?.toLowerCase() || '',
    ];

    let score = 0;

    for (const token of tokens) {
      if (
        entry.keywords.some((keyword) => keyword.toLowerCase().includes(token))
      ) {
        score += 5;
      }

      if (entry.title.toLowerCase().includes(token)) {
        score += 4;
      }

      if (haystacks.some((text) => text.includes(token))) {
        score += 2;
      }
    }

    return score;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}/-]+/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
  }
}
