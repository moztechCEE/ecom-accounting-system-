import api from "./api";

const DEFAULT_ENTITY_ID =
  import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || "tw-entity-001";

export type DashboardPerformanceBucket = {
  key: string;
  label: string;
  account?: string;
  storeName?: string | null;
  gross: number;
  orderCount: number;
  payoutGross: number;
  payoutNet: number;
  feeTotal: number;
  paymentCount: number;
  reconciledCount: number;
  pendingPayoutCount: number;
};

export type DashboardSalesOverview = {
  entityId: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  buckets: DashboardPerformanceBucket[];
  total: DashboardPerformanceBucket;
};

export type DashboardReconciliationItem = {
  paymentId: string;
  salesOrderId: string | null;
  externalOrderId: string | null;
  orderDate: string | null;
  payoutDate: string | null;
  channelCode: string | null;
  bucketKey: string;
  bucketLabel: string;
  account: string | null;
  storeName: string | null;
  orderStatus: string | null;
  paymentStatus: string | null;
  logisticStatus: string | null;
  gateway: string | null;
  feeStatus: string;
  feeSource: string | null;
  settlementStatus: "reconciled" | "pending_payout" | "pending_payment" | "failed";
  provider: string | null;
  providerPaymentId: string | null;
  providerTradeNo: string | null;
  gross: number;
  feeTotal: number;
  net: number;
  reconciledFlag: boolean;
};

export type DashboardReconciliationBatch = {
  id: string;
  provider: string;
  sourceType: string;
  importedAt: string;
  fileName: string | null;
  recordCount: number;
  matchedCount: number;
  unmatchedCount: number;
  invalidCount: number;
  notes: string | null;
};

export type DashboardReconciliationFeed = {
  entityId: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  recentItems: DashboardReconciliationItem[];
  recentBatches: DashboardReconciliationBatch[];
};

export type DashboardExecutiveTask = {
  key: string;
  title: string;
  value: number;
  amount: number | null;
  tone: "healthy" | "warning" | "attention" | "critical";
  helper: string;
};

export type DashboardInventoryAlert = {
  sku: string;
  name: string;
  qtyAvailable: number;
  qtyOnHand: number;
  severity: "critical" | "warning";
};

export type DashboardExecutiveAnomaly = {
  key: string;
  title: string;
  count: number;
  amount: number | null;
  tone: "healthy" | "warning" | "attention" | "critical";
  helper: string;
  accountCode: string | null;
  accountName: string | null;
  statusLabel: string;
};

export type DashboardReconciliationRule = {
  key: string;
  title: string;
  status: "active" | "monitoring" | "pending";
  metric: number;
  description: string;
  accountingEntry: string;
  helper: string;
};

export type DashboardExecutiveOverview = {
  entityId: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  expenses: {
    actualSpend: number;
    actualSpendCount: number;
    pendingApprovalAmount: number;
    pendingApprovalCount: number;
    approvedUnpaidAmount: number;
    approvedUnpaidCount: number;
  };
  operations: {
    pendingPayoutCount: number;
    overduePendingPayoutCount: number;
    feeBackfillCount: number;
    missingPayoutJournalCount: number;
    unmatchedPayoutLineCount: number;
    uninvoicedOrdersCount: number;
    inventoryAlertCount: number;
    outOfStockCount: number;
    openAnomalyCount: number;
  };
  inventoryAlerts: DashboardInventoryAlert[];
  anomalies: DashboardExecutiveAnomaly[];
  reconciliationRules: DashboardReconciliationRule[];
  tasks: DashboardExecutiveTask[];
};

export type DashboardOperationsHub = {
  entityId: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  people: {
    activeEmployees: number;
    pendingLeaveRequests: number;
    openAttendanceAnomalies: number;
  };
  payroll: {
    draftRuns: number;
    pendingApprovalRuns: number;
    approvedRuns: number;
    postedRuns: number;
    paidRuns: number;
  };
  invoicing: {
    issuedInvoiceCount: number;
    issuedInvoiceAmount: number;
    pendingInvoiceCount: number;
    pendingInvoiceAmount: number;
  };
  approvals: {
    expenseRequests: number;
    payrollRuns: number;
    journalEntries: number;
    payments: number;
  };
  highlights: Array<{
    key: string;
    label: string;
    value: number;
  }>;
};

export type MonthlyChannelReconciliationItem = {
  month: string;
  bucketKey: string;
  bucketLabel: string;
  account: string | null;
  salesGross: number;
  orderCount: number;
  payoutGross: number;
  payoutNet: number;
  feeTotal: number;
  paymentCount: number;
  reconciledCount: number;
  pendingPayoutCount: number;
  ecpayBatchLineCount: number;
  ecpayMatchedLineCount: number;
  ecpayUnmatchedLineCount: number;
  salesVsPayoutGap: number;
  payoutVsNetGap: number;
};

export type MonthlyChannelReconciliation = {
  entityId: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  items: MonthlyChannelReconciliationItem[];
};

export const dashboardService = {
  async getSalesOverview(params?: {
    entityId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<DashboardSalesOverview> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<DashboardSalesOverview>(
      `/reports/dashboard-sales-overview?${query.toString()}`,
    );
    return response.data;
  },

  async getReconciliationFeed(params?: {
    entityId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<DashboardReconciliationFeed> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<DashboardReconciliationFeed>(
      `/reports/dashboard-reconciliation-feed?${query.toString()}`,
    );
    return response.data;
  },

  async getExecutiveOverview(params?: {
    entityId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<DashboardExecutiveOverview> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<DashboardExecutiveOverview>(
      `/reports/dashboard-executive-overview?${query.toString()}`,
    );
    return response.data;
  },

  async getOperationsHub(params?: {
    entityId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<DashboardOperationsHub> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<DashboardOperationsHub>(
      `/reports/dashboard-operations-hub?${query.toString()}`,
    );
    return response.data;
  },

  async getMonthlyChannelReconciliation(params?: {
    entityId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<MonthlyChannelReconciliation> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<MonthlyChannelReconciliation>(
      `/reports/monthly-channel-reconciliation?${query.toString()}`,
    );
    return response.data;
  },
};
