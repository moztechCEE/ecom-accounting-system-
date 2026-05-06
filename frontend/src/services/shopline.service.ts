import api from "./api";

const DEFAULT_ENTITY_ID =
  import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || "tw-entity-001";

type SyncResult = {
  success: boolean;
  fetched: number;
  created: number;
  updated: number;
  skipped?: boolean;
  message?: string;
};

type ShoplinePaymentSyncResult = {
  success: boolean;
  fetched: number;
  importable?: number;
  imported?: number;
  skipped?: boolean;
  message?: string;
  batchId?: string;
  provider?: "shoplinepay";
  recordCount?: number;
  matchedCount?: number;
  unmatchedCount?: number;
  invalidCount?: number;
};

export const shoplineService = {
  async syncOrders(params?: {
    entityId?: string;
    since?: string;
    until?: string;
  }): Promise<SyncResult> {
    const response = await api.post<SyncResult>(
      "/integrations/shopline/sync/orders",
      {
        entityId: params?.entityId?.trim() || DEFAULT_ENTITY_ID,
        since: params?.since,
        until: params?.until,
      },
    );
    return response.data;
  },

  async syncCustomers(params?: {
    entityId?: string;
    since?: string;
    until?: string;
  }): Promise<SyncResult> {
    const response = await api.post<SyncResult>(
      "/integrations/shopline/sync/customers",
      {
        entityId: params?.entityId?.trim() || DEFAULT_ENTITY_ID,
        since: params?.since,
        until: params?.until,
      },
    );
    return response.data;
  },

  async syncTransactions(params?: {
    entityId?: string;
    since?: string;
    until?: string;
  }): Promise<SyncResult> {
    const response = await api.post<SyncResult>(
      "/integrations/shopline/sync/transactions",
      {
        entityId: params?.entityId?.trim() || DEFAULT_ENTITY_ID,
        since: params?.since,
        until: params?.until,
      },
    );
    return response.data;
  },

  async syncPaymentBillingRecords(params?: {
    entityId?: string;
    since?: string;
    until?: string;
    maxPages?: string | number;
    payoutId?: string;
    accountType?: string;
  }): Promise<ShoplinePaymentSyncResult> {
    const response = await api.post<ShoplinePaymentSyncResult>(
      "/integrations/shopline/sync/payments/billing-records",
      {
        entityId: params?.entityId?.trim() || DEFAULT_ENTITY_ID,
        since: params?.since,
        until: params?.until,
        maxPages: params?.maxPages,
        payoutId: params?.payoutId,
        accountType: params?.accountType,
      },
      {
        timeout: 180000,
      },
    );
    return response.data;
  },
};
