import api from "./api";

const DEFAULT_ENTITY_ID =
  import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || "tw-entity-001";

export type ShopifySyncResult = {
  success: boolean;
  fetched: number;
  created: number;
  updated: number;
};

export type ShopifySummary = {
  entityId: string;
  range: { since: string | null; until: string | null };
  orders: {
    count: number;
    gross: number;
    tax: number;
    discount: number;
    shipping: number;
  };
  payouts: {
    gross: number;
    net: number;
    platformFee: number | null;
    platformFeeStatus:
      | "actual"
      | "estimated"
      | "mixed"
      | "unavailable"
      | "not_applicable"
      | "empty";
    platformFeeSource: string;
    platformFeeMessage: string | null;
  };
};

export const shopifyService = {
  async health(): Promise<{ ok: boolean; message?: string }> {
    const response = await api.get("/integrations/shopify/health");
    return response.data;
  },

  async syncOrders(params: {
    entityId?: string;
    since?: string;
    until?: string;
  }): Promise<ShopifySyncResult> {
    const response = await api.post("/integrations/shopify/sync/orders", {
      entityId: params.entityId?.trim() || DEFAULT_ENTITY_ID,
      since: params.since,
      until: params.until,
    });
    return response.data;
  },

  async syncTransactions(params: {
    entityId?: string;
    since?: string;
    until?: string;
  }): Promise<ShopifySyncResult> {
    const response = await api.post("/integrations/shopify/sync/transactions", {
      entityId: params.entityId?.trim() || DEFAULT_ENTITY_ID,
      since: params.since,
      until: params.until,
    });
    return response.data;
  },

  async summary(params?: {
    entityId?: string;
    since?: string;
    until?: string;
  }): Promise<ShopifySummary> {
    const entityId = params?.entityId?.trim() || DEFAULT_ENTITY_ID;
    const query = new URLSearchParams();
    query.append("entityId", entityId);
    if (params?.since) query.append("since", params.since);
    if (params?.until) query.append("until", params.until);

    const response = await api.get(
      `/integrations/shopify/summary?${query.toString()}`,
    );
    return response.data;
  },
};
