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
      summary:
        '建立費用時先選員工代墊或廠商直付、上傳憑證並確認辨識草稿，再選報銷項目、金額、幣別、日期與說明後送出。AI 辨識或分類只是建議，需核對憑證，不會自動付款。',
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
      summary:
        '主管在費用審核中心查看指派給自己的申請與憑證、核准或退回。直屬主管來自員工資料的主管設定，未設定或無有效審批人員時須先由管理員補齊；主管核准後，若該報銷項目有額外審批政策，仍須完成後續審批；全部核准後才進入出納待付款。',
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
      summary:
        '已完成必要審核的費用進入出納待付款任務。出納應核對受款人、幣別、應付金額與付款方式，實際付款後再登錄付款資訊。申請、憑證、審核、付款與正式會計入帳是不同狀態，核准不表示已付款或已入帳。',
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
      summary:
        '個人介面設定可由右上角帳號選單開啟；系統設定由管理員維護。Copilot 支援標準與深度模式，AI 連線由部署環境的管理員設定，畫面不會提供或顯示金鑰。',
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
      summary:
        '在權限管理先選人員、設定角色，再點「可見介面」預覽。需要新組合時，在角色頁新增角色、選擇範本，以模組矩陣勾選讀取、新增、修改等操作後儲存，再指派給人員；多角色權限取聯集。公司與八類資料範圍只有最高管理員能設定，資料範圍分自己、部門、公司。主管另外在員工管理維護；看得到選單不代表可以修改或核准。',
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
      id: 'employee-supervisor',
      title: '員工資料與直屬主管設定',
      summary:
        '具備員工管理權限的人員到員工管理編輯員工，在「直屬主管」選擇同公司的有效主管後儲存。主管須有啟用的登入帳號和費用介面讀取權限；管理員可在權限管理指派費用申請與主管審批角色，再檢查可見介面。不得自己當主管或形成循環。變更主管只影響新送出的申請，既有已指派申請仍交給原審批人。',
      keywords: ['員工', '人員', '直屬主管', '主管設定', '費用審批', '組織', 'employees'],
      path: '/payroll/employees',
      module: 'employees',
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
    {
      id: 'warehouse',
      title: '儲運工作區',
      summary:
        '依角色開放儲運工作站、收貨、揀貨、出貨與報表；資料由目前已連線的 WMS 來源提供。沒有實際串接資料不能當成完成出貨。',
      keywords: ['儲運', '倉庫', '揀貨', '出貨', 'WMS', '工作站'],
      path: '/warehouse',
      module: 'warehouse',
    },
    {
      id: 'sn-labels',
      title: 'SN 序號與箱標',
      summary:
        '在 SN 標籤頁建立序號批次、配對外箱並下載標籤。序號、箱號與產品必須可追溯；下載 PDF 不代表已完成工廠印刷或掃碼驗收。',
      keywords: ['SN', '序號', '箱號', '箱標', '條碼', '標籤'],
      path: '/inventory/sn-labels',
      module: 'inventory',
    },
    {
      id: 'accounting-workbench',
      title: '會計工作台',
      summary:
        '集中檢查來源單據、科目、傳票與差異。費用項目是員工申請選項，會計科目是入帳分類；分類不確定時交由會計確認，不可直接以 AI 建議當成正式入帳。',
      keywords: ['會計', '科目', '入帳', '傳票', '分錄'],
      path: '/accounting/workbench',
      module: 'accounting',
    },
    {
      id: 'reconciliation',
      title: '對帳中心',
      summary:
        '核對訂單、收款、發票、退款與手續費，依差異追溯來源單據。營收、收款、應收與銀行餘額的口徑不同，請以原單據及對帳狀態確認。',
      keywords: ['對帳', '差異', '收款', '發票', '退款', '手續費'],
      path: '/reconciliation',
      module: 'accounting',
    },
    {
      id: 'reports',
      title: '營運與財務報表',
      summary:
        '依公司與日期區間查看報表，先確認資料來源、幣別與計算口徑。Copilot 目前支援單次授權資料查詢，尚未提供所有報表的跨模組分析。',
      keywords: ['報表', '損益', '營運', '分析', 'reports'],
      path: '/reports',
      module: 'reports',
    },
    {
      id: 'profile',
      title: '個人資料',
      summary:
        '由右上角帳號選單進入個人資料，確認自己的基本資料。需要調整角色、所屬公司、部門或直屬主管時，請具備人員管理權限的管理員處理。',
      keywords: ['個人', '帳號', '密碼', '資料', '主管', '部門'],
      path: '/profile',
      module: 'profile',
    },
    {
      id: 'leave',
      title: '請假申請',
      summary:
        '在請假申請填寫假別、起迄日期及原因，送出後查看申請狀態；假別額度與審批結果以系統即時資料為準。',
      keywords: ['請假', '假別', '休假', 'leave'],
      path: '/attendance/leaves',
      module: 'attendance',
    },
  ];

  search(query: string, limit = 5, currentPath?: string): AiKnowledgeEntry[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) {
      return [...this.entries]
        .sort(
          (a, b) =>
            Number(b.path === currentPath) - Number(a.path === currentPath),
        )
        .slice(0, limit);
    }

    return this.entries
      .map((entry) => ({
        entry,
        score: this.score(entry, tokens) + (entry.path === currentPath ? 1 : 0),
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
        entry.keywords.some(
          (keyword) =>
            keyword.toLowerCase().includes(token) ||
            token.includes(keyword.toLowerCase()),
        )
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
    const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}/-]+/gu, ' ');
    const words = [
      ...new Intl.Segmenter('zh-TW', { granularity: 'word' }).segment(
        normalized,
      ),
    ]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment);
    const stopwords = new Set([
      '如何',
      '怎麼',
      '使用',
      '什麼',
      '這頁',
      '這個',
      '可以',
      '請問',
      '能否',
      '想要',
    ]);
    return [...new Set([...normalized.split(/\s+/), ...words])]
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopwords.has(token));
  }
}
