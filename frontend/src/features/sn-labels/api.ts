import api from "../../services/api";
import type { SnDraft } from "./model";
export type Entry = {
  id: string;
  status: "draft" | "active";
  revision: number;
  data: SnDraft;
  updated_at: string;
};
export type AllocationPreview = {
  first: number | null;
  last: number | null;
  noSerial: boolean;
  token: string;
  total: number;
  checkedAt: string;
  rows: { id: string; ordinal: number; quantity: number; serials: string[] }[];
};
export type Detail = {
  id: string;
  data: SnDraft;
  first: number | null;
  last: number | null;
  cartons: number;
  boxes: { id: string; ordinal: number; quantity: number; serials: string[] }[];
  events: {
    action: string;
    actor_id: string;
    created_at: string;
    data: Record<string, unknown>;
  }[];
};
export const snApi = (entityId: string) => ({
  list: async (query: Record<string, unknown>) =>
    (
      await api.get<{ rows: Entry[]; total: number }>("/sn-labels", {
        params: { ...query, entityId },
      })
    ).data,
  save: async (d: SnDraft, revision: number) =>
    (
      await api.put<{ id: string; revision: number; data: SnDraft }>(
        `/sn-labels/drafts/${d.id}`,
        { data: d, revision },
        { params: { entityId } },
      )
    ).data,
  preview: async (data: SnDraft, page = 1) =>
    (
      await api.post<AllocationPreview>(
        "/sn-labels/preview",
        { data, page },
        { params: { entityId } },
      )
    ).data,
  remove: async (id: string, revision: number) =>
    (
      await api.delete(`/sn-labels/drafts/${id}`, {
        data: { revision },
        params: { entityId },
      })
    ).data,
  activate: async (id: string, revision: number, previewToken: string) =>
    (
      await api.post<{ batchId: string }>(
        `/sn-labels/drafts/${id}/activate`,
        { revision, previewToken },
        { params: { entityId } },
      )
    ).data,
  detail: async (id: string, page = 1) =>
    (
      await api.get<Detail>(`/sn-labels/batches/${id}`, {
        params: { entityId, page },
      })
    ).data,
  export: async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await api.post(`/sn-labels/batches/${id}/export`, body, {
        params: { entityId },
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SN-${body.kind}-${id}.${["warranty", "warehouse"].includes(String(body.kind)) ? "xlsx" : "pdf"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e: unknown) {
      const data = (e as { response?: { data?: Blob } }).response?.data;
      if (data instanceof Blob) {
        try {
          throw new Error(JSON.parse(await data.text()).message);
        } catch (parsed) {
          if (parsed instanceof SyntaxError) throw e;
          throw parsed;
        }
      }
      throw e;
    }
  },
});
export function errorText(e: unknown) {
  const v = e as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const m = v.response?.data?.message || v.message || "操作失敗，請稍後重試";
  return Array.isArray(m) ? m.join("、") : m;
}
export function productDefaults(p: {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  modelNumber?: string;
  attributes?: Record<string, unknown>;
}) {
  const v = (p.attributes?.snLabels || {}) as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === "string" ? String(v[k]) : "");
  return {
    productId: p.id,
    productName: p.name,
    sku: p.sku,
    barcode: p.barcode || "",
    model: p.modelNumber || "",
    style: str("style"),
    color: str("color"),
    modelCode: str("modelCode").toUpperCase(),
    styleCode: str("styleCode").toUpperCase(),
    colorCode: str("colorCode").toUpperCase(),
  };
}
