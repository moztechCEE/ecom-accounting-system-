import api from "./api";

const DEFAULT_ENTITY_ID =
  import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || "tw-entity-001";

type AdSyncResult = {
  success: boolean;
  fetched: number;
  synced: number;
  created: number;
  updated: number;
  skippedZeroSpend?: number;
  expenseSourceModule: "meta_ads" | "google_ads";
};

type AdSyncParams = {
  entityId?: string;
  since?: string;
  until?: string;
  maxPages?: string | number;
};

export const adIntegrationsService = {
  async syncMetaAds(params?: AdSyncParams): Promise<AdSyncResult> {
    const response = await api.post<AdSyncResult>(
      "/integrations/meta-ads/sync",
      {
        entityId: params?.entityId?.trim() || DEFAULT_ENTITY_ID,
        since: params?.since,
        until: params?.until,
        maxPages: params?.maxPages,
      },
      {
        timeout: 180000,
      },
    );
    return response.data;
  },

  async syncGoogleAds(params?: AdSyncParams): Promise<AdSyncResult> {
    const response = await api.post<AdSyncResult>(
      "/integrations/google-ads/sync",
      {
        entityId: params?.entityId?.trim() || DEFAULT_ENTITY_ID,
        since: params?.since,
        until: params?.until,
        maxPages: params?.maxPages,
      },
      {
        timeout: 180000,
      },
    );
    return response.data;
  },
};
