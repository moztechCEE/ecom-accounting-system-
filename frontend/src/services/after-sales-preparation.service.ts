import api from "./api";
export type BrandSettings = {
  code: string;
  name: string;
  active: boolean;
  lineOfficialId: string;
  channelId: string;
  liffId: string;
  invoiceLegalName: string;
  invoiceTaxId: string;
  invoiceMerchantLabel: string;
};
export type Brand = BrandSettings & {
  version: number;
  lineStatus: "not_connected";
  invoiceStatus: "unverified";
};
export type QuoteLine = {
  description: string;
  quantity: number;
  unitPrice: string;
};
export type CustomerQuote = {
  brandName: string;
  caseNumber: string;
  currency: "TWD";
  lines: QuoteLine[];
  total: string;
  customerNote: string;
};
export type QuoteDraft = {
  id: string;
  status: "draft";
  createdAt: string;
  sourceCaseId: string;
  sourceCaseNumber: string;
  brandCode: string;
  brandVersion: number;
  brandSnapshot: BrandSettings;
  customerPreview: CustomerQuote;
};
export type QuoteInput = {
  sourceCaseId: string;
  brandCode: string;
  brandVersion: number;
  lines: QuoteLine[];
  customerNote: string;
};
const path = "/after-sales/preparation";
export const preparation = {
  caseBrand: async (
    entityId: string,
    sourceCaseId: string,
    signal?: AbortSignal,
  ): Promise<{ sourceCaseId: string; brandCode: string | null }> =>
    (
      await api.get(path + "/case-brand", {
        params: { entityId, sourceCaseId },
        signal,
      })
    ).data,
  brands: async (entityId: string, signal?: AbortSignal): Promise<Brand[]> =>
    (await api.get(path + "/brands", { params: { entityId }, signal })).data,
  saveBrand: async (
    entityId: string,
    version: number,
    data: BrandSettings,
  ): Promise<Brand> =>
    (await api.post(path + "/brands", { entityId, version, data })).data,
  drafts: async (
    entityId: string,
    signal?: AbortSignal,
  ): Promise<QuoteDraft[]> =>
    (await api.get(path + "/quote-drafts", { params: { entityId }, signal }))
      .data,
  saveDraft: async (
    entityId: string,
    requestKey: string,
    data: QuoteInput,
  ): Promise<QuoteDraft> =>
    (await api.post(path + "/quote-drafts", { entityId, requestKey, data }))
      .data,
};
export function preparationError(error: unknown) {
  const message = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.join("；");
  return "無法完成操作，請確認服務已部署並重試";
}
