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

export type ConnectorReadinessItem = {
  key: string;
  label: string;
  category: string;
  status: "ready" | "partial" | "blocked";
  internallyConfigured: boolean;
  missingRequired: string[];
  requiredConfig: Array<{ name: string; present: boolean }>;
  credentialGroups: Array<{ names: string[]; ready: boolean }>;
  optionalConfig: Array<{ name: string; present: boolean }>;
  jsonSummary?: {
    name: string;
    present: boolean;
    valid: boolean;
    count: number;
    error?: string | null;
  } | null;
  externalNeeds: string[];
  nextAction: string;
};

export type ConnectorReadiness = {
  entityId: string;
  generatedAt: string;
  summary: {
    total: number;
    ready: number;
    partial: number;
    blocked: number;
  };
  connectors: ConnectorReadinessItem[];
  inputDocument: string;
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
    ecpayServiceFeeInvoiceCount: number;
    ecpayServiceFeeInvoicePendingCount: number;
    ecpayServiceFeeInvoiceGapAmount: number;
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

export type OrderReconciliationAuditItem = {
  orderId: string;
  externalOrderId: string | null;
  orderDate: string;
  orderStatus: string;
  channelCode: string | null;
  channelName: string;
  bucketKey: string;
  bucketLabel: string;
  hasInvoice: boolean;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceIssuedAt: string | null;
  paymentStatus: string | null;
  reconciledFlag: boolean;
  grossAmount: number;
  orderTaxAmount: number;
  expectedOrderTaxAmount: number;
  paymentGrossAmount: number;
  paymentNetAmount: number;
  gatewayFeeAmount: number;
  platformFeeAmount: number;
  shippingPaidAmount: number;
  feeTotalAmount: number;
  feeRatePct: number;
  invoiceGrossAmount: number;
  invoiceTaxAmount: number;
  expectedInvoiceTaxAmount: number;
  providerTradeNo: string | null;
  providerPaymentId: string | null;
  anomalyCodes: string[];
  anomalyMessages: string[];
  severity: "healthy" | "warning" | "critical";
  recommendation: string;
};

export type OrderReconciliationAudit = {
  entityId: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  summary: {
    auditedOrderCount: number;
    anomalousOrderCount: number;
    paidOrderCount: number;
    invoicedOrderCount: number;
    reconciledOrderCount: number;
    invoiceIssueCount: number;
    taxIssueCount: number;
    feeIssueCount: number;
    orderPaymentIssueCount: number;
    totalGrossAmount: number;
    totalPaymentGrossAmount: number;
    totalPaymentNetAmount: number;
    totalGatewayFeeAmount: number;
    totalPlatformFeeAmount: number;
    totalFeeAmount: number;
    flaggedGrossAmount: number;
    flaggedFeeAmount: number;
    feeTakeRatePct: number;
  };
  items: OrderReconciliationAuditItem[];
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

export type ManagementSummaryGroupBy =
  | "year"
  | "quarter"
  | "month"
  | "week"
  | "day";

export type ManagementSummaryPeriod = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  revenue: number;
  taxAmount: number;
  estimatedCogs: number;
  payoutGross: number;
  payoutNet: number;
  gatewayFee: number;
  platformFee: number;
  feeTotal: number;
  actualExpenseAmount: number;
  fallbackExpenseAmount: number;
  operatingExpenses: number;
  grossProfit: number;
  grossMarginPct: number;
  netProfit: number;
  netMarginPct: number;
  orderCount: number;
  paymentCount: number;
  reconciledCount: number;
  expenseCount: number;
  fallbackExpenseCount: number;
  openArAmount: number;
  arInvoiceCount: number;
  collectedRatePct: number;
};

export type ManagementSummary = {
  entityId: string;
  groupBy: ManagementSummaryGroupBy;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  summary: Omit<ManagementSummaryPeriod, "key" | "label" | "startDate" | "endDate">;
  periods: ManagementSummaryPeriod[];
};

export type EcommerceHistoryPeriod = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  revenue: number;
  orderCount: number;
  customerCount: number;
};

export type EcommerceHistoryBrand = {
  brand: string;
  sourceLabel: string;
  channelCode: string | null;
  revenue: number;
  orderCount: number;
  customerCount: number;
  averageOrderValue: number;
  topProducts: Array<{
    sku: string;
    quantity: number;
  }>;
};

export type EcommerceHistoryProduct = {
  sku: string;
  name: string;
  category: string | null;
  brand: string;
  revenue: number;
  quantity: number;
  orderCount: number;
};

export type EcommerceHistory = {
  entityId: string;
  groupBy: ManagementSummaryGroupBy;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  summary: {
    revenue: number;
    orderCount: number;
    customerCount: number;
    brandCount: number;
    productCount: number;
  };
  periods: EcommerceHistoryPeriod[];
  brands: EcommerceHistoryBrand[];
  products: EcommerceHistoryProduct[];
};

export type DataCompletenessAuditBlocker = {
  key: string;
  label: string;
  count: number;
  severity: "healthy" | "warning" | "critical";
  nextAction: string;
};

export type DataCompletenessChannelBreakdown = {
  channelCode: string;
  channelName: string;
  orders: number;
  grossAmount: number;
  missingCustomers: number;
  missingPayments: number;
  missingInvoices: number;
  payments: number;
  reconciledPayments: number;
  unreconciledPayments: number;
  feeMissingPayments: number;
  reasonBreakdown?: {
    missingPaymentPendingCandidates: number;
    missingInvoiceEmbeddedCandidates: number;
    missingInvoiceEcpayBackfillCandidates: number;
    feeMissingPayoutBackfillCandidates: number;
  };
  firstOrder: {
    orderNumber: string | null;
    orderDate: string;
  } | null;
  lastOrder: {
    orderNumber: string | null;
    orderDate: string;
  } | null;
};

export type DataCompletenessAudit = {
  entityId: string;
  generatedAt: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  historicalData: {
    olderThanOneYearOrders: number;
    needsShopifyReadAllOrdersCheck: boolean;
    needsShoplineArchivedOrdersFlow: boolean;
    needsOneShopPre2025Backfill: boolean;
  };
  totals: {
    orders: number;
    grossAmount: number;
    customers: number;
    customersWithOrders: number;
    payments: number;
    invoices: number;
    payoutImportLines: number;
    bankTransactions: number;
  };
  coverage: {
    customerLinkedRate: number;
    paymentLinkedRate: number;
    invoiceLinkedRate: number;
    paymentReconciledRate: number;
    payoutLineMatchedRate: number;
    bankTransactionMatchedRate: number;
    feeActualRate: number;
  };
  gaps: {
    missingCustomerOrders: number;
    missingPaymentOrders: number;
    missingInvoiceOrders: number;
    pendingPayments: number;
    completedPayments: number;
    reconciledPayments: number;
    feeActualPayments: number;
    feeMissingPayments: number;
    ecpayProviderPayments: number;
    linePayCandidatePayments: number;
    matchedPayoutLines: number;
    unmatchedPayoutLines: number;
    invalidPayoutLines: number;
    matchedBankTransactions: number;
  };
  channelBreakdown: DataCompletenessChannelBreakdown[];
  blockers: DataCompletenessAuditBlocker[];
  recommendedNextSteps: string[];
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

  async getOrderReconciliationAudit(params?: {
    entityId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<OrderReconciliationAudit> {
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

    const response = await api.get<OrderReconciliationAudit>(
      `/reports/order-reconciliation-audit?${query.toString()}`,
    );
    return response.data;
  },

  async getManagementSummary(params?: {
    entityId?: string;
    groupBy?: ManagementSummaryGroupBy;
    startDate?: string;
    endDate?: string;
  }): Promise<ManagementSummary> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    query.set("groupBy", params?.groupBy || "month");
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<ManagementSummary>(
      `/reports/management-summary?${query.toString()}`,
    );
    return response.data;
  },

  async getEcommerceHistory(params?: {
    entityId?: string;
    groupBy?: ManagementSummaryGroupBy;
    startDate?: string;
    endDate?: string;
  }): Promise<EcommerceHistory> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    query.set("groupBy", params?.groupBy || "month");
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<EcommerceHistory>(
      `/reports/ecommerce-history?${query.toString()}`,
    );
    return response.data;
  },

  async getDataCompletenessAudit(params?: {
    entityId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<DataCompletenessAudit> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<DataCompletenessAudit>(
      `/reports/data-completeness-audit?${query.toString()}`,
    );
    return response.data;
  },

  async getConnectorReadiness(params?: {
    entityId?: string;
  }): Promise<ConnectorReadiness> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    query.set("_ts", String(Date.now()));

    const response = await api.get<ConnectorReadiness>(
      `/reports/connector-readiness?${query.toString()}`,
    );
    return response.data;
  },
};
