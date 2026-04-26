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
  message: string;
  requiredEnv: string[];
  accounts: InvoiceMerchantReadiness[];
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
};
