import api from "./api";
export type Connection = {
  id: string;
  category: string;
  provider: string;
  brand: string;
  accountId: string;
  displayName: string;
  environment: string;
  credentialRef?: string | null;
  metadata: Record<string, string>;
  version: number;
  enabled: boolean;
  verificationStatus: string;
  verificationCode?: string;
  verifiedAt?: string;
};
export type IntegrationSummary = {
  connections: Connection[];
  categories: string[];
  source: {
    available: boolean;
    items: {
      brand: string;
      kind: string;
      configured: boolean;
      verified: boolean;
      devStub: boolean;
      issuerName?: string;
    }[];
  };
  invoiceProfiles: {
    key: string;
    environment: string;
    ready: boolean;
    verified: boolean;
  }[];
  canManage: boolean;
  sync: {
    connector: string;
    status: string;
    lastSuccessAt?: string;
    lastFailureAt?: string;
  }[];
};
export type LogRow = {
  id: string;
  occurredAt: string;
  source: string;
  eventClass: string;
  actorId?: string;
  actorName?: string;
  actionId: string;
  recordType: string;
  recordId?: string;
  brand?: string;
  outcome: string;
  requestId?: string;
  changedFieldNames: string[];
  fromStatus?: string;
  toStatus?: string;
};
export type LogsResult = {
  items: LogRow[];
  nextCursor: string | null;
  sources: string[];
  sourceStatus: string;
  portalPath?: string;
  legacyUnscoped?: string;
};
export const operationsAdmin = {
  integrations: async (entityId: string, signal?: AbortSignal) =>
    (
      await api.get<IntegrationSummary>("/admin/integrations", {
        params: { entityId },
        signal,
      })
    ).data,
  save: async (entityId: string, data: Partial<Connection>) =>
    (await api.post("/admin/integrations", { entityId, data })).data,
  verify: async (entityId: string, row: Connection) =>
    (
      await api.post("/admin/integrations/verify", {
        entityId,
        id: row.id,
        version: row.version,
      })
    ).data,
  logs: async (query: Record<string, unknown>, signal?: AbortSignal) =>
    (
      await api.get<LogsResult>("/admin/operation-logs", {
        params: query,
        signal,
      })
    ).data,
  archive: async (query: Record<string, unknown>) =>
    (
      await api.post<{ id: string; manifest: Record<string, unknown> }>(
        "/admin/operation-logs/archives",
        query,
      )
    ).data,
  download: async (entityId: string, id: string) =>
    (
      await api.get<Blob>(
        "/admin/operation-logs/archives/" + encodeURIComponent(id),
        { params: { entityId }, responseType: "blob" },
      )
    ).data,
};
export const adminError = (error: unknown) => {
  const message = (error as any)?.response?.data?.message;
  return typeof message === "string" ? message : "暫時無法完成操作，請重試";
};
