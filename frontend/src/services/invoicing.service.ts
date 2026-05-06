import api from "./api";

const DEFAULT_ENTITY_ID =
  import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || "tw-entity-001";

export type InvoiceQueueItem = {
  orderId: string;
  externalOrderId: string | null;
  orderDate: string;
  channelCode: string | null;
  channelName: string | null;
  customerName: string;
  customerEmail: string | null;
  totalAmount: number;
  paymentStatus: string;
  paymentDate: string | null;
  reconciledFlag: boolean;
  journalLinked: boolean;
  invoiceStatus: "eligible" | "waiting_payment" | "completed";
  invoiceNumber: string | null;
  invoiceIssuedAt: string | null;
  reason: string;
  daysSinceOrder: number;
};

export type InvoiceQueueSummary = {
  issuedCount: number;
  issuedAmount: number;
  voidCount: number;
  pendingCount: number;
  eligibleCount: number;
  waitingPaymentCount: number;
  completedOrderCount: number;
};

export type InvoiceQueueResponse = {
  entityId: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  summary: InvoiceQueueSummary;
  items: InvoiceQueueItem[];
};

export type InvoiceMerchantReadiness = {
  key: string;
  merchantId: string | null;
  entityId: string | null;
  description: string | null;
  env: "stage" | "production";
  issueUrl: string | null;
  queryUrl: string | null;
  invalidUrl: string | null;
  allowanceUrl: string | null;
  ready: boolean;
  missing: string[];
};

export type InvoiceProviderReadiness = {
  provider: "ecpay";
  ready: boolean;
  canIssue: boolean;
  issuingEnabled: boolean;
  message: string;
  requiredEnv: string[];
  accounts: InvoiceMerchantReadiness[];
};

export type InvoiceProviderStatus = {
  invoiceId: string;
  invoiceNumber: string;
  localStatus: string;
  localIssuedAt: string | null;
  providerStatus: "issued" | "void" | "unknown";
  providerMessage: string | null;
  provider: "ecpay";
  merchantKey: string;
  merchantId: string;
  invoiceDate: string;
  raw: Record<string, unknown>;
};

export type InvoiceProviderStatusReadinessItem = {
  invoiceId: string;
  invoiceNumber: string;
  localStatus: string;
  issuedAt: string | null;
  orderId: string | null;
  externalOrderId: string | null;
  channelCode: string | null;
  channelName: string | null;
  merchantKey: string | null;
  merchantId: string | null;
  invoiceDate: string | null;
  queryReady: boolean;
  missing: string[];
};

export type InvoiceProviderStatusReadiness = {
  entityId: string;
  limit: number;
  status: string | null;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  summary: {
    scannedCount: number;
    readyCount: number;
    notReadyCount: number;
    missingCounts: Record<string, number>;
  };
  items: InvoiceProviderStatusReadinessItem[];
};

export type EcpayInvoiceSyncToOrdersResult = {
  success: boolean;
  entityId: string;
  beginDate: string;
  endDate: string;
  dryRun: boolean;
  requestedMerchants: number;
  windows: number;
  fetched: number;
  matched: number;
  created: number;
  updated: number;
  previewed: number;
  unmatched: number;
  invalid: number;
  results: Array<Record<string, unknown>>;
};

export const invoicingService = {
  async getQueue(params?: {
    entityId?: string;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<InvoiceQueueResponse> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<InvoiceQueueResponse>(
      `/invoicing/queue?${query.toString()}`,
    );
    return response.data;
  },

  async getReadiness(): Promise<InvoiceProviderReadiness> {
    const response = await api.get<InvoiceProviderReadiness>(
      `/invoicing/readiness?_ts=${Date.now()}`,
    );
    return response.data;
  },

  async queryProviderStatus(invoiceId: string): Promise<InvoiceProviderStatus> {
    const response = await api.get<InvoiceProviderStatus>(
      `/invoicing/${invoiceId}/provider-status?_ts=${Date.now()}`,
      { timeout: 30000 },
    );
    return response.data;
  },

  async getProviderStatusReadiness(params?: {
    entityId?: string;
    limit?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<InvoiceProviderStatusReadiness> {
    const query = new URLSearchParams();
    query.set("entityId", params?.entityId?.trim() || DEFAULT_ENTITY_ID);
    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    if (params?.status) {
      query.set("status", params.status);
    }
    if (params?.startDate) {
      query.set("startDate", params.startDate);
    }
    if (params?.endDate) {
      query.set("endDate", params.endDate);
    }
    query.set("_ts", String(Date.now()));

    const response = await api.get<InvoiceProviderStatusReadiness>(
      `/invoicing/provider-status/readiness?${query.toString()}`,
      { timeout: 30000 },
    );
    return response.data;
  },

  async syncEcpayInvoiceListToOrders(params: {
    entityId?: string;
    merchantKey?: string;
    merchantId?: string;
    beginDate?: string;
    endDate?: string;
    pageSize?: number;
    maxPages?: number;
    dryRun?: boolean;
  }): Promise<EcpayInvoiceSyncToOrdersResult> {
    const response = await api.post<EcpayInvoiceSyncToOrdersResult>(
      "/invoicing/ecpay/invoices/sync-to-orders",
      {
        entityId: params.entityId?.trim() || DEFAULT_ENTITY_ID,
        merchantKey: params.merchantKey,
        merchantId: params.merchantId,
        beginDate: params.beginDate,
        endDate: params.endDate,
        pageSize: params.pageSize,
        maxPages: params.maxPages,
        dryRun: params.dryRun,
      },
      { timeout: 180000 },
    );
    return response.data;
  },
};
