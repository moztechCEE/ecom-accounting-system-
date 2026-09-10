import { useEffect, useState } from "react";
import api from "./api";

export type ManagementBase = {
  source: string;
  observedAt: string;
  coverage: string;
};
export type ManagementOrder = {
  id: string;
  orderNumber: string;
  brand: string;
  state: string;
  updatedAt: string;
  picker: string | null;
  packer: string | null;
  required: number;
  picked: number;
  packed: number;
  blocked: number;
};
export type OverviewData = ManagementBase & {
  summary: Record<string, number>;
  pick: { total: number; page: number; items: ManagementOrder[] };
  pack: { total: number; page: number; items: ManagementOrder[] };
};
export type ReportRecord = {
  id: string;
  orderId: string;
  orderNumber: string;
  brand: string;
  actor: string;
  occurredAt: string;
  action?: string;
  status?: string;
  reason?: string;
  scanValue?: string;
  stage?: string;
  product?: string;
  barcode?: string;
  originalSn?: string;
  newSn?: string;
  ackNote?: string;
  resolutionNote?: string;
};
export type ReportData = ManagementBase & {
  days: number;
  page: number;
  total: number;
  records: ReportRecord[];
  breakdown: { label: string; count: number }[];
};
export const statusLabel: Record<string, string> = {
  pending: "待揀貨",
  picking: "揀貨中",
  picked: "待裝箱",
  packing: "裝箱中",
  completed: "核對完成",
  open: "待核可",
  ack: "已核可",
  resolved: "已結案",
  rejected: "已退回",
  stockout: "缺貨",
  damage: "破損",
  over_scan: "多掃",
  under_scan: "少掃",
  sn_replace: "SN 更換",
  order_change: "訂單異動",
  other: "其他",
  pick: "揀貨核對",
  pack: "裝箱核對",
  scan_error: "刷錯",
  claim: "認領",
  pick_claim: "認領揀貨",
  pack_claim: "認領裝箱",
  dispatch: "拋轉訂單",
  import: "匯入訂單",
  void: "作廢",
  defect_exchange: "新品更換",
  WMS_SCAN_NOT_MATCHED: "條碼不符、數量已滿或需掃描 SN",
  WMS_SERIAL_ALREADY_SCANNED: "SN 已核對或不符合目前階段",
  WMS_SERIAL_AMBIGUOUS: "SN 對應不唯一",
};
export const label = (value?: string) =>
  value ? statusLabel[value] || value : "—";
export const time = (value: string, includeYear = false) =>
  new Date(value).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export function useManagement<T extends ManagementBase>(
  section: string,
  params: Record<string, string | number>,
  enabled = true,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0);
  const key = JSON.stringify(params);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError("");
    if (!enabled) {
      setLoading(false);
      return () => abort.abort();
    }
    setLoading(true);
    const poll = async () => {
      try {
        const response = await api.get<T>(
          `/wms/workbench/management/${section}`,
          { params: JSON.parse(key), signal: abort.signal },
        );
        if (!abort.signal.aborted) {
          setData(response.data);
          setError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setData(null);
          setError(
            (e as { response?: { status?: number } }).response?.status === 403
              ? "沒有此公司或報表的存取權限"
              : "WMS 資料尚未接通，請稍後重試",
          );
        }
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          timer = setTimeout(poll, 15000);
        }
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [section, key, enabled, version]);
  return { data, error, loading, refresh: () => setVersion((v) => v + 1) };
}
