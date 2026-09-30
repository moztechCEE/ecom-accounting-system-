/**
 * DashboardPage.tsx
 * 修改（2026-04）：新增財務即時快覽、本週損益快覽、各平台貢獻度橫條圖
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  message,
  Radio,
  DatePicker,
  Modal,
  Tag,
  Typography,
  Progress,
} from "antd";
import {
  AlertOutlined,
  BankOutlined,
  CreditCardOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  FallOutlined,
  FileTextOutlined,
  LineChartOutlined,
  RiseOutlined,
  ShoppingOutlined,
  SyncOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { hasPermission } from "../utils/access";
import PageSkeleton from "../components/PageSkeleton";
import { GlassCard } from "../components/ui/GlassCard";
import { resolveEntityId } from "../services/entities.service";
import { shopifyService } from "../services/shopify.service";
import { oneShopService } from "../services/oneshop.service";
import { shoplineService } from "../services/shopline.service";
import {
  invoicingService,
  InvoiceQueueResponse,
} from "../services/invoicing.service";
import {
  arService,
  ReceivableMonitorResponse,
} from "../services/ar.service";
import { apService } from "../services/ap.service";
import { bankingService } from "../services/banking.service";
import { salesService } from "../services/sales.service";
import { adIntegrationsService } from "../services/adIntegrations.service";
import {
  dashboardService,
  AdPerformanceSummary,
  ConnectorReadiness,
  DashboardExecutiveOverview,
  DashboardSalesOverview,
  ManagementSummary,
  OrderReconciliationAudit,
} from "../services/dashboard.service";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const DASHBOARD_TZ = "Asia/Taipei";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(DASHBOARD_TZ);

type RangeMode = "all" | "today" | "yesterday" | "last7d" | "last30d" | "last1y" | "custom";
type CustomRange = [Dayjs, Dayjs] | null;
type RangeValue = [Dayjs | null, Dayjs | null] | null;
type DashboardLoadState =
  | "initial-loading"
  | "refreshing"
  | "ready"
  | "partial"
  | "stale"
  | "error";

const DASHBOARD_SECTION_LABELS = {
  overview: "銷售與通路概況",
  executive: "CEO 待辦與庫存",
  operations: "營運中心",
  invoices: "發票處理",
  audit: "訂單對帳稽核",
  receivables: "應收帳款",
  trend: "30 天趨勢",
  rangeFinancial: "本期損益",
  todayFinancial: "今日損益",
  ads: "營業額對照",
  connectors: "串接狀態",
  payables: "應付帳款",
  banking: "銀行餘額",
} as const;

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") return fallback;

  const candidate = error as {
    message?: unknown;
    response?: { data?: { message?: unknown } };
  };
  const apiMessage = candidate.response?.data?.message;
  if (typeof apiMessage === "string" && apiMessage.trim()) return apiMessage;
  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return candidate.message;
  }
  return fallback;
}

// ─── 財務快覽型別 ────────────────────────────────────────

interface FinanceSummary {
  arOutstanding: number;
  apOutstanding: number;
  inTransit: number;
  bankBalance: number;
}

interface WeeklyPnl {
  revenue: number | null;
  cost: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  monthlyEarned: number | null;
}

interface PlatformContribution {
  [key: string]: string | number;
  platform: string;
  net: number;
  color: string;
}


interface RevenueTrendPoint {
  date: string;
  revenue: number | null;
  profit: number | null;
  netProfit: number | null;
  payoutNet: number | null;
  adSpend: number | null;
}
// ─── 金額格式化 ──────────────────────────────────────────

const fmtMoney = (n: number) =>
  n.toLocaleString("zh-TW", { minimumFractionDigits: 0 }) + " 元";

const fmtSignedMoney = (n: number) => `${n < 0 ? "-" : ""}${fmtMoney(Math.abs(n))}`;

const optionalNumber = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const sumOptionalNumbers = (values: Array<number | null | undefined>): number | null =>
  values.every((value) => optionalNumber(value) != null)
    ? values.reduce<number>((sum, value) => sum + Number(value), 0)
    : null;

const fmtOptionalMoney = (value: number | null | undefined) =>
  optionalNumber(value) == null ? "—" : fmtMoney(value as number);

const fmtPct = (n: number | null | undefined) =>
  optionalNumber(n) == null ? "—" : `${Number(n).toFixed(1)}%`;

const fmtRoas = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n || 0).toFixed(2)}x`;

const fmtCompact = (n: number) => {
  const value = Number(n || 0);
  if (Math.abs(value) >= 100000000) {
    return `${(value / 100000000).toFixed(1)}億`;
  }
  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(0)}萬`;
  }
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
};

function getRangeModeLabel(mode: RangeMode) {
  switch (mode) {
    case "today":
      return "今日";
    case "yesterday":
      return "昨日";
    case "last7d":
      return "近 7 天";
    case "last30d":
      return "近 30 天";
    case "last1y":
      return "近 1 年";
    case "custom":
      return "自訂區間";
    default:
      return "全部期間";
  }
}

function resolveRange(
  mode: RangeMode,
  timezone: string,
  customRange: CustomRange,
) {
  if (mode === "today") {
    const start = dayjs().tz(timezone).startOf("day");
    const end = dayjs().tz(timezone).endOf("day");
    return { since: start.toISOString(), until: end.toISOString() };
  }

  if (mode === "yesterday") {
    const start = dayjs().tz(timezone).subtract(1, "day").startOf("day");
    const end = dayjs().tz(timezone).subtract(1, "day").endOf("day");
    return { since: start.toISOString(), until: end.toISOString() };
  }

  if (mode === "last7d") {
    const end = dayjs().tz(timezone).endOf("day");
    const start = end.subtract(6, "day").startOf("day");
    return { since: start.toISOString(), until: end.toISOString() };
  }

  if (mode === "last30d") {
    const end = dayjs().tz(timezone).endOf("day");
    const start = end.subtract(29, "day").startOf("day");
    return { since: start.toISOString(), until: end.toISOString() };
  }

  if (mode === "last1y") {
    const end = dayjs().tz(timezone).endOf("day");
    const start = end.subtract(1, "year").add(1, "day").startOf("day");
    return { since: start.toISOString(), until: end.toISOString() };
  }

  if (mode === "custom" && customRange && customRange[0] && customRange[1]) {
    const start = customRange[0].tz(timezone, true).startOf("day");
    const end = customRange[1].tz(timezone, true).endOf("day");
    return { since: start.toISOString(), until: end.toISOString() };
  }

  return { since: undefined, until: undefined };
}

function getTaskToneMeta(tone: DashboardExecutiveOverview["tasks"][number]["tone"]) {
  switch (tone) {
    case "critical":
      return { color: "red" as const, badge: "立即處理" };
    case "warning":
      return { color: "gold" as const, badge: "本週重點" };
    case "attention":
      return { color: "blue" as const, badge: "需追蹤" };
    default:
      return { color: "green" as const, badge: "正常" };
  }
}

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canViewCost = hasPermission(user, "product_cost:read");
  const canViewMargin = canViewCost && hasPermission(user, "financial_margin:read");
  const canViewNetProfit = canViewMargin && hasPermission(user, "financial_net_profit:read");
  const hasSuccessfulSnapshotRef = useRef(false);
  const [loadState, setLoadState] =
    useState<DashboardLoadState>("initial-loading");
  const [failedSections, setFailedSections] = useState<string[]>([]);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<Date | null>(null);
  const [rangeMode, setRangeMode] = useState<RangeMode>("last30d");
  const [customRange, setCustomRange] = useState<CustomRange>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncingAdSpend, setSyncingAdSpend] = useState(false);
  const [syncingInvoiceStatuses, setSyncingInvoiceStatuses] = useState(false);
  const [overview, setOverview] = useState<DashboardSalesOverview | null>(null);
  const [executive, setExecutive] = useState<DashboardExecutiveOverview | null>(null);
  const [invoiceQueue, setInvoiceQueue] = useState<InvoiceQueueResponse | null>(null);
  const [audit, setAudit] = useState<OrderReconciliationAudit | null>(null);
  const [receivableMonitor, setReceivableMonitor] =
    useState<ReceivableMonitorResponse | null>(null);

  // 財務快覽 State
  const [finance, setFinance] = useState<FinanceSummary>({
    arOutstanding: 0,
    apOutstanding: 0,
    inTransit: 0,
    bankBalance: 0,
  })
  const [financeAvailability, setFinanceAvailability] = useState({
    payables: false,
    banking: false,
  })
  const [weeklyPnl, setWeeklyPnl] = useState<WeeklyPnl>({
    revenue: null,
    cost: null,
    grossProfit: null,
    grossMargin: null,
    monthlyEarned: null,
  })
  const [managementSummary, setManagementSummary] = useState<ManagementSummary | null>(null)
  const [rangeManagementSummary, setRangeManagementSummary] = useState<ManagementSummary | null>(null)
  const [adPerformance, setAdPerformance] = useState<AdPerformanceSummary | null>(null)
  const [connectorReadiness, setConnectorReadiness] = useState<ConnectorReadiness | null>(null)
  const [financeOptionsOpen, setFinanceOptionsOpen] = useState(false)


  const [revenueTrend, setRevenueTrend] = useState<RevenueTrendPoint[]>([])

  useEffect(() => {
    if (rangeMode === "custom" && (!customRange?.[0] || !customRange?.[1])) {
      if (hasSuccessfulSnapshotRef.current) {
        setLoadState("stale");
        setFailedSections(["自訂日期區間尚未完成"]);
        setLoadErrorMessage("請選擇完整的開始與結束日期後再更新資料。");
      }
      return;
    }

    const storedEntityId = localStorage.getItem("entityId")?.trim();
    const { since, until } = resolveRange(rangeMode, DASHBOARD_TZ, customRange);
    const hadSnapshot = hasSuccessfulSnapshotRef.current;
    let ignore = false;

    const fetchSummary = async () => {
      setLoadState(hadSnapshot ? "refreshing" : "initial-loading");
      setLoadErrorMessage(null);

      try {
        const entityId = await resolveEntityId(storedEntityId);
        // 30天趨勢 & 損益：固定取最近30天日報，不跟著 rangeMode 走
        const trend30Start = dayjs().tz(DASHBOARD_TZ).subtract(29, 'day').startOf('day').toISOString()
        const trend30End = dayjs().tz(DASHBOARD_TZ).endOf('day').toISOString()
        const todayStart = dayjs().tz(DASHBOARD_TZ).startOf('day').toISOString()
        const todayEnd = dayjs().tz(DASHBOARD_TZ).endOf('day').toISOString()
        // AR monitor is intentionally bounded. The backend can be slow or fail on
        // unbounded history, so the dashboard uses the selected range when present,
        // otherwise the same rolling 90-day window as the AR page.
        const arMonitorStart =
          since || dayjs().tz(DASHBOARD_TZ).subtract(90, 'day').startOf('day').toISOString()
        const arMonitorEnd = until || dayjs().tz(DASHBOARD_TZ).endOf('day').toISOString()
        const inSelectedRange = (dateValue?: string | null) => {
          if (!since && !until) return true
          if (!dateValue) return false
          const value = dayjs(dateValue)
          if (!value.isValid()) return false
          if (since && value.isBefore(dayjs(since))) return false
          if (until && value.isAfter(dayjs(until))) return false
          return true
        }

        const [
          summaryResult,
          executiveResult,
          operationsResult,
          invoiceQueueResult,
          auditResult,
          receivableResult,
          trendResult,
          rangeFinancialResult,
          todayFinancialResult,
          adPerformanceResult,
          connectorReadinessResult,
          payablesResult,
          bankingResult,
        ] = await Promise.allSettled([
          dashboardService.getSalesOverview({
            entityId,
            startDate: since,
            endDate: until,
          }),
          canViewNetProfit ? dashboardService.getExecutiveOverview({
            entityId,
            startDate: since,
            endDate: until,
          }) : Promise.resolve(null),
          dashboardService.getOperationsHub({
            entityId,
            startDate: since,
            endDate: until,
          }),
          invoicingService.getQueue({
            entityId,
            startDate: since,
            endDate: until,
            limit: 24,
          }),
          canViewNetProfit ? dashboardService.getOrderReconciliationAudit({
            entityId,
            startDate: since,
            endDate: until,
            limit: 24,
          }) : Promise.resolve(null),
          arService.getReceivableMonitor({
            entityId,
            startDate: arMonitorStart,
            endDate: arMonitorEnd,
          }),
          dashboardService.getManagementSummary({
            entityId,
            groupBy: 'day',
            startDate: trend30Start,
            endDate: trend30End,
          }),
          dashboardService.getManagementSummary({
            entityId,
            groupBy: rangeMode === 'all' || rangeMode === 'last1y' ? 'month' : 'day',
            startDate: since,
            endDate: until,
          }),
          dashboardService.getManagementSummary({
            entityId,
            groupBy: 'day',
            startDate: todayStart,
            endDate: todayEnd,
          }),
          canViewNetProfit ? dashboardService.getAdPerformanceSummary({
            entityId,
            groupBy: rangeMode === 'all' || rangeMode === 'last1y' ? 'month' : 'day',
            startDate: since,
            endDate: until,
          }) : Promise.resolve(null),
          dashboardService.getConnectorReadiness({
            entityId,
          }),
          apService.getInvoices(entityId).then((invoices) => ({
            outstanding: invoices
              .filter((invoice) => !['paid', 'void', 'cancelled'].includes(String(invoice.status || '').toLowerCase()))
              .filter((invoice) => inSelectedRange(invoice.invoiceDate || invoice.dueDate))
              .reduce(
                (sum, invoice) =>
                  sum + Math.max(0, Number(invoice.amountOriginal || 0) - Number(invoice.paidAmountOriginal || 0)),
                0,
              ),
          })),
          bankingService.getAccounts(entityId).then((accounts) => ({
            balance: accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0),
          })),
        ]);

        if (ignore) return;

        const sectionResults: Array<[PromiseSettledResult<unknown>, string]> = [
          [summaryResult, DASHBOARD_SECTION_LABELS.overview],
          ...(canViewNetProfit ? [[executiveResult, DASHBOARD_SECTION_LABELS.executive] as [PromiseSettledResult<unknown>, string]] : []),
          [operationsResult, DASHBOARD_SECTION_LABELS.operations],
          [invoiceQueueResult, DASHBOARD_SECTION_LABELS.invoices],
          ...(canViewNetProfit ? [[auditResult, DASHBOARD_SECTION_LABELS.audit] as [PromiseSettledResult<unknown>, string]] : []),
          [receivableResult, DASHBOARD_SECTION_LABELS.receivables],
          [trendResult, DASHBOARD_SECTION_LABELS.trend],
          [rangeFinancialResult, DASHBOARD_SECTION_LABELS.rangeFinancial],
          [todayFinancialResult, DASHBOARD_SECTION_LABELS.todayFinancial],
          ...(canViewNetProfit ? [[adPerformanceResult, DASHBOARD_SECTION_LABELS.ads] as [PromiseSettledResult<unknown>, string]] : []),
          [connectorReadinessResult, DASHBOARD_SECTION_LABELS.connectors],
          [payablesResult, DASHBOARD_SECTION_LABELS.payables],
          [bankingResult, DASHBOARD_SECTION_LABELS.banking],
        ];
        const nextFailedSections = sectionResults
          .filter(([result]) => result.status === "rejected")
          .map(([, label]) => label);

        if (summaryResult.status === "fulfilled") setOverview(summaryResult.value);
        if (executiveResult.status === "fulfilled") setExecutive(executiveResult.value);
        if (invoiceQueueResult.status === "fulfilled") setInvoiceQueue(invoiceQueueResult.value);
        if (auditResult.status === "fulfilled") setAudit(auditResult.value);
        if (receivableResult.status === "fulfilled") setReceivableMonitor(receivableResult.value);
        if (trendResult.status === "fulfilled") {
          setManagementSummary(trendResult.value);
          setRevenueTrend(
            (trendResult.value?.periods || []).map((period) => ({
              date: dayjs(period.startDate).tz(DASHBOARD_TZ).format('MM/DD'),
              revenue: optionalNumber(period.revenue),
              profit: canViewMargin ? optionalNumber(period.grossProfit) : null,
              netProfit: canViewNetProfit ? optionalNumber(period.netProfit) : null,
              payoutNet: canViewNetProfit ? optionalNumber(period.payoutNet) : null,
              adSpend: canViewNetProfit ? optionalNumber(period.adSpendAmount) : null,
            })),
          );
        }
        if (rangeFinancialResult.status === "fulfilled") {
          setRangeManagementSummary(rangeFinancialResult.value);
          const summary = rangeFinancialResult.value?.summary;
          setWeeklyPnl(summary ? {
            revenue: optionalNumber(summary.revenue),
            cost: canViewCost ? optionalNumber(summary.estimatedCogs) : null,
            grossProfit: canViewMargin ? optionalNumber(summary.grossProfit) : null,
            grossMargin: canViewMargin && optionalNumber(summary.grossMarginPct) != null
              ? Number(summary.grossMarginPct) / 100 : null,
            monthlyEarned: canViewNetProfit ? optionalNumber(summary.payoutNet) : null,
          } : {
            revenue: null,
            cost: null,
            grossProfit: null,
            grossMargin: null,
            monthlyEarned: null,
          });
        }
        if (adPerformanceResult.status === "fulfilled") setAdPerformance(adPerformanceResult.value);
        if (connectorReadinessResult.status === "fulfilled") {
          setConnectorReadiness(connectorReadinessResult.value);
        }
        setFinance((prev) => ({
          arOutstanding: receivableResult.status === "fulfilled"
            ? (receivableResult.value.summary?.outstandingAmount ?? prev.arOutstanding)
            : prev.arOutstanding,
          apOutstanding: payablesResult.status === "fulfilled"
            ? payablesResult.value.outstanding
            : prev.apOutstanding,
          inTransit: prev.inTransit,
          bankBalance: bankingResult.status === "fulfilled"
            ? bankingResult.value.balance
            : prev.bankBalance,
        }));
        setFinanceAvailability((prev) => ({
          payables: payablesResult.status === "fulfilled" || prev.payables,
          banking: bankingResult.status === "fulfilled" || prev.banking,
        }));

        const coreResults = [
          summaryResult,
          receivableResult,
          rangeFinancialResult,
          ...(canViewNetProfit ? [executiveResult] : []),
        ];
        const coreSuccessCount = coreResults.filter(
          (result) => result.status === "fulfilled",
        ).length;
        const allCoreSucceeded = coreSuccessCount === coreResults.length;

        setFailedSections(nextFailedSections);
        if (allCoreSucceeded) setLastSuccessfulAt(new Date());

        if (coreSuccessCount === 0) {
          setLoadErrorMessage("核心營運資料無法取得，畫面不會以預設 0 取代真實 KPI。");
          setLoadState(hadSnapshot ? "stale" : "error");
          return;
        }

        hasSuccessfulSnapshotRef.current = true;
        setLoadErrorMessage(null);
        if (nextFailedSections.length === 0) {
          setLoadState("ready");
        } else {
          setLoadState(hadSnapshot ? "stale" : "partial");
        }
      } catch (error: unknown) {
        if (ignore) return;
        setFailedSections(["公司實體與核心儀表板資料"]);
        setLoadErrorMessage(
          getRequestErrorMessage(error, "讀取儀表板資料失敗，請稍後重試。"),
        );
        setLoadState(hadSnapshot ? "stale" : "error");
      }
    };

    fetchSummary();

    return () => {
      ignore = true;
    };
  }, [rangeMode, customRange, refreshToken, canViewCost, canViewMargin, canViewNetProfit]);

  const handleCustomRangeChange = (value: RangeValue) => {
    if (!value || !value[0] || !value[1]) {
      setCustomRange(null);
      return;
    }
    setCustomRange([value[0], value[1]]);
  };

  const handleManualSync = async () => {
    const storedEntityId = localStorage.getItem("entityId")?.trim();
    const { since, until } = resolveRange(rangeMode, DASHBOARD_TZ, customRange);
    setSyncing(true);
    try {
      const [
        shopifyOrdersResult,
        shopifyTransactionsResult,
        oneShopOrdersResult,
        oneShopTransactionsResult,
        shoplineOrdersResult,
        shoplineCustomersResult,
        shoplineTransactionsResult,
        metaAdsResult,
        googleAdsResult,
      ] = await Promise.all([
        shopifyService.syncOrders({ entityId: storedEntityId, since, until }),
        shopifyService.syncTransactions({
          entityId: storedEntityId,
          since,
          until,
        }),
        oneShopService.syncOrders({ entityId: storedEntityId, since, until }),
        oneShopService.syncTransactions({
          entityId: storedEntityId,
          since,
          until,
        }),
        shoplineService.syncOrders({
          entityId: storedEntityId,
          since,
          until,
        }),
        shoplineService.syncCustomers({
          entityId: storedEntityId,
          since,
          until,
        }),
        shoplineService.syncTransactions({
          entityId: storedEntityId,
          since,
          until,
        }),
        (canViewNetProfit ? adIntegrationsService.syncMetaAds({
          entityId: storedEntityId,
          since,
          until,
        }).catch((error) => ({
          success: false,
          fetched: 0,
          synced: 0,
          created: 0,
          updated: 0,
          skippedZeroSpend: 0,
          expenseSourceModule: "meta_ads" as const,
          message:
            error?.response?.data?.message ||
            error?.message ||
            "Meta Ads 同步失敗",
        })) : Promise.resolve({ created: 0, updated: 0 })),
        (canViewNetProfit ? adIntegrationsService.syncGoogleAds({
          entityId: storedEntityId,
          since,
          until,
        }).catch((error) => ({
          success: false,
          fetched: 0,
          synced: 0,
          created: 0,
          updated: 0,
          skippedZeroSpend: 0,
          expenseSourceModule: "google_ads" as const,
          message:
            error?.response?.data?.message ||
            error?.message ||
            "Google Ads 同步失敗",
        })) : Promise.resolve({ created: 0, updated: 0 })),
      ]);

      message.success(
        `同步完成：Shopify 訂單 ${
          shopifyOrdersResult.created + shopifyOrdersResult.updated
        } 筆、1Shop 訂單 ${
          oneShopOrdersResult.created + oneShopOrdersResult.updated
        } 筆、Shopify 金流 ${
          shopifyTransactionsResult.created + shopifyTransactionsResult.updated
        } 筆、1Shop 金流 ${
          oneShopTransactionsResult.created + oneShopTransactionsResult.updated
        } 筆、Shopline 訂單 ${
          shoplineOrdersResult.created + shoplineOrdersResult.updated
        } 筆、Shopline 顧客 ${
          shoplineCustomersResult.created + shoplineCustomersResult.updated
        } 筆、Shopline 金流 ${
          shoplineTransactionsResult.created + shoplineTransactionsResult.updated
        } 筆${canViewNetProfit ? `、Meta 廣告費 ${
          metaAdsResult.created + metaAdsResult.updated
        } 筆、Google 廣告費 ${
          googleAdsResult.created + googleAdsResult.updated
        } 筆` : ''}`,
      );
      setRefreshToken((prev) => prev + 1);
    } catch (error: unknown) {
      message.error(getRequestErrorMessage(error, "同步失敗，請稍後再試"));
    } finally {
      setSyncing(false);
    }
  };

  const handleAdSpendSync = async () => {
    if (!canViewNetProfit) return;
    const storedEntityId = localStorage.getItem("entityId")?.trim();
    const { since, until } = resolveRange(rangeMode, DASHBOARD_TZ, customRange);
    setSyncingAdSpend(true);
    try {
      const [metaAdsResult, googleAdsResult] = await Promise.all([
        adIntegrationsService.syncMetaAds({
          entityId: storedEntityId,
          since,
          until,
        }),
        adIntegrationsService.syncGoogleAds({
          entityId: storedEntityId,
          since,
          until,
        }),
      ]);

      const synced =
        metaAdsResult.created +
        metaAdsResult.updated +
        googleAdsResult.created +
        googleAdsResult.updated;
      message.success(
        synced > 0
          ? `廣告費同步完成：寫入 / 更新 ${synced} 筆`
          : "廣告費同步完成：本區間目前沒有平台回傳的花費",
      );
      setRefreshToken((prev) => prev + 1);
    } catch (error: unknown) {
      message.error(getRequestErrorMessage(error, "同步廣告費失敗"));
    } finally {
      setSyncingAdSpend(false);
    }
  };

  const handleSyncInvoiceStatuses = async () => {
    const storedEntityId = localStorage.getItem("entityId")?.trim();
    const { since, until } = resolveRange(rangeMode, DASHBOARD_TZ, customRange);
    setSyncingInvoiceStatuses(true);
    try {
      const entityId = await resolveEntityId(storedEntityId);
      const result = await salesService.syncInvoiceStatusBatch({
        entityId,
        startDate: since,
        endDate: until,
        limit: 120,
      });
      const syncedCount = Number(result?.synced || 0);
      const skippedCount = Number(result?.skipped || 0);
      const failedCount = Number(result?.failed || 0);
      message.success(
        `發票狀態同步完成：成功 ${syncedCount} 筆，略過 ${skippedCount} 筆，失敗 ${failedCount} 筆`,
      );
      setRefreshToken((prev) => prev + 1);
    } catch (error: unknown) {
      message.error(getRequestErrorMessage(error, "同步發票狀態失敗"));
    } finally {
      setSyncingInvoiceStatuses(false);
    }
  };

  const handleRetry = () => setRefreshToken((prev) => prev + 1);

  if (loadState === "initial-loading") {
    return <PageSkeleton />;
  }

  if (loadState === "error") {
    return (
      <div className="page-section-stack page-section-stack--compact">
        <GlassCard className="p-6">
          <Title level={2} className="!mb-2 !text-gray-800">
            營運儀表板
          </Title>
          <Text className="mb-5 block text-sm text-slate-500">
            核心資料尚未成功載入，因此暫不顯示可能被誤認為真實數字的預設 KPI。
          </Text>
          <Alert
            type="error"
            showIcon
            message="無法取得核心儀表板資料"
            description={
              <div className="space-y-1">
                <div>{loadErrorMessage || "請確認連線後重新載入。"}</div>
                {failedSections.length > 0 && (
                  <div>未取得區塊：{failedSections.join("、")}</div>
                )}
              </div>
            }
            action={
              <Button
                danger
                icon={<SyncOutlined />}
                onClick={handleRetry}
              >
                重新載入
              </Button>
            }
          />
        </GlassCard>
      </div>
    );
  }

  const performanceBuckets = overview?.buckets || [];
  const total = overview?.total;
  const tasks = executive?.tasks || [];
  const inventoryAlerts = executive?.inventoryAlerts || [];
  const anomalies = executive?.anomalies || [];
  const invoiceSummary = invoiceQueue?.summary;
  const invoiceItems = invoiceQueue?.items || [];
  const arSummary = receivableMonitor?.summary;
  const auditSummary = audit?.summary;
  const auditItems = audit?.items || [];
  const rangeLabel = getRangeModeLabel(rangeMode);
  const rangeFinancial = rangeManagementSummary?.summary;
  const selectedFinancial = rangeFinancial;
  const selectedNetProfit = canViewNetProfit ? optionalNumber(selectedFinancial?.netProfit) : null;
  const selectedRevenue = optionalNumber(selectedFinancial?.revenue);
  const selectedNetMarginPct = canViewNetProfit ? optionalNumber(selectedFinancial?.netMarginPct) : null;
  const selectedPeriodLabel =
    rangeMode === "custom" && customRange?.[0] && customRange?.[1]
      ? `${customRange[0].format("MM/DD")} - ${customRange[1].format("MM/DD")}`
      : rangeLabel;
  const adConnector = connectorReadiness?.connectors.find((item) => item.key === "ad-spend") || null;
  const missingInvoiceCount = Number(invoiceSummary?.pendingCount || 0);

  // ─── 品牌業績歸因（從通路 bucket 近似推算）───────────────
  const sumBuckets = (arr: typeof performanceBuckets) => ({
    gross: arr.reduce((s, b) => s + (b.gross || 0), 0),
    orderCount: arr.reduce((s, b) => s + (b.orderCount || 0), 0),
    payoutNet: arr.reduce((s, b) => s + (b.payoutNet || 0), 0),
  });
  const moztechBuckets = performanceBuckets.filter(b =>
    /shopify/i.test(b.key || '') || /shopify/i.test(b.label || '')
  );
  const bonsonBuckets = performanceBuckets.filter(b =>
    /shopline/i.test(b.key || '') || /shopline/i.test(b.label || '')
  );
  const teamBuckets = performanceBuckets.filter(b =>
    /1shop|oneshop/i.test(b.key || '') || /1shop/i.test(b.label || '')
  );
  const mOZtechData = sumBuckets(moztechBuckets);
  const bonsonData = sumBuckets(bonsonBuckets);
  const teamData = sumBuckets(teamBuckets);

  // ─── 銷售通路：官網、1Shop 團購、線下、其他 ──────────────
  const PAYMENT_GATEWAY_PATTERN = /ecpay|linepay|jkos|aftee|atome|spgateway|newebpay/i
  const channelDefinitions = [
    { key: "group-buy", label: "1Shop 團購", color: "#4f46e5", pattern: /1shop|oneshop|團購|萬魔/i },
    { key: "official", label: "官網", color: "#0f766e", pattern: /shopify|shopline|official|官網/i },
    { key: "offline", label: "線下通路", color: "#b45309", pattern: /offline|retail|mpos|(?:^|\W)pos(?:\W|$)|門市|線下|展場|快閃|電話/i },
    { key: "other", label: "其他通路", color: "#94a3b8", pattern: /.*/ },
  ] as const
  const platformRevenueRows = channelDefinitions
    .map((definition) => {
      const buckets = performanceBuckets.filter((bucket) => {
        const source = `${bucket.key || ""} ${bucket.label || ""}`
        if (PAYMENT_GATEWAY_PATTERN.test(source)) return false
        const firstMatch = channelDefinitions.find((candidate) => candidate.pattern.test(source))
        return firstMatch?.key === definition.key
      })
      return {
        key: definition.key,
        label: definition.label,
        gross: buckets.reduce((sum, bucket) => sum + Number(bucket.gross || 0), 0),
        payoutNet: canViewNetProfit ? sumOptionalNumbers(buckets.map((bucket) => bucket.payoutNet)) : null,
        orderCount: buckets.reduce((sum, bucket) => sum + Number(bucket.orderCount || 0), 0),
        paymentCount: buckets.reduce((sum, bucket) => sum + Number(bucket.paymentCount || 0), 0),
        color: definition.color,
      }
    })
    .filter((row) => row.gross > 0 || (row.payoutNet ?? 0) > 0 || row.orderCount > 0)
    .sort((left, right) => right.gross - left.gross)
  const topPlatformRevenueRows = platformRevenueRows
  const platformContribs: PlatformContribution[] = platformRevenueRows.filter((row) => canViewNetProfit && row.payoutNet != null).map((row) => ({
    platform: row.label,
    net: row.payoutNet as number,
    color: row.color,
  }))
  const adPerformanceRows = (adPerformance?.brands || [])
    .map((brand) => ({
      brand: brand.brand,
      revenue: Number(brand.revenue || 0),
      adSpend: optionalNumber(brand.adSpend),
      roas: brand.roas,
      orderCount: Number(brand.orderCount || 0),
      revenueShare: Number(brand.revenueShare || 0),
      adSpendShare: optionalNumber(brand.adSpendShare),
    }))
    .sort((left, right) => (right.adSpend ?? -Infinity) - (left.adSpend ?? -Infinity))
  const topAdPerformanceRows = adPerformanceRows.slice(0, 5)
  const adSourceRows = (adPerformance?.sources || []).map((source) => ({
    ...source,
    lastDateLabel: source.lastExpenseDate
      ? dayjs(source.lastExpenseDate).tz(DASHBOARD_TZ).format("MM/DD")
      : "無資料",
  }))
  const channelPieData = platformContribs
    .filter((item) => item.net > 0)
    .sort((left, right) => right.net - left.net)
  const brandColors = ["#475569", "#0f766e", "#4f46e5", "#b45309", "#7e22ce"]
  const brandPieData = adPerformanceRows
    .filter((item) => item.revenue > 0 && item.brand.trim().length > 0)
    .map((item, index) => ({
      name: item.brand,
      value: item.revenue,
      color: brandColors[index % brandColors.length],
    }))
    .sort((left, right) => right.value - left.value)

  // ─── 紅燈警示計數 ──────────────────────────────────────
  const criticalInventory = inventoryAlerts.filter(a => a.severity === 'critical').length;
  const criticalAnomalies = anomalies.filter(a => a.tone === 'critical').length;
  const overdueAR = arSummary?.overdueReceivableCount || 0;
  const overpaidAR = arSummary?.overpaidReceivableCount || 0;
  const overpaidARAmount = arSummary?.overpaidReceivableAmount || 0;
  const financialAuditIssueCount = auditSummary?.anomalousOrderCount || 0;
  const adSpendAmount = canViewNetProfit ? optionalNumber(rangeFinancial?.adSpendAmount) : null;
  const adSpendCount = canViewNetProfit ? optionalNumber(rangeFinancial?.adSpendCount) : null;
  const adSpendTracked = adSpendCount != null && adSpendCount > 0;
  const historicalAdSpendCount = canViewNetProfit ? optionalNumber(managementSummary?.summary?.adSpendCount) : null;
  const hasHistoricalAdSpend = historicalAdSpendCount != null && historicalAdSpendCount > 0;
  const adSpendCanSyncDaily = Boolean(adConnector?.internallyConfigured);
  const adSpendCanShowAmount = adSpendTracked || adSpendCanSyncDaily || hasHistoricalAdSpend;
  const adSpendNeedsSetup = !adSpendCanShowAmount;
  const adSpendNeedsSecretCheck = !adSpendTracked && hasHistoricalAdSpend && !adSpendCanSyncDaily;
  const adSpendNeedsAttention = canViewNetProfit && (adSpendNeedsSetup || adSpendNeedsSecretCheck);
  const adSpendStatusLabel = adSpendTracked
    ? "已入費用"
    : adSpendNeedsSecretCheck
      ? "需檢查 Secret"
      : adSpendCanSyncDaily || hasHistoricalAdSpend
        ? "待確認"
        : "待串接";
  const adSpendHelper = adSpendTracked
    ? `${adSpendCount} 筆廣告費`
    : adSpendNeedsSecretCheck
      ? "Meta / Google 憑證異常"
    : adSpendCanSyncDaily
      ? "本區間無廣告費"
      : adConnector?.nextAction || "尚未串接廣告平台";
  const payableExposure = Math.max(
    Number(finance.apOutstanding || 0),
    Number(executive?.expenses?.approvedUnpaidAmount || 0),
  );
  const cashRiskAmount =
    Number(arSummary?.overdueReceivableAmount || 0) +
    Number(overpaidARAmount || 0) +
    payableExposure;
  const financeWatchCount =
    missingInvoiceCount +
    financialAuditIssueCount +
    overdueAR +
    overpaidAR +
    (adSpendNeedsAttention ? 1 : 0);
  const criticalCount = criticalInventory + criticalAnomalies + overdueAR + overpaidAR;
  const financeOptionRows = [
    {
      key: "missing-invoices",
      title: "缺發票訂單",
      count: missingInvoiceCount,
      helper: "待完成發票",
      actionLabel: "處理缺發票",
      path: "/accounting/workbench?focus=missing-invoices",
      tone: missingInvoiceCount > 0 ? "warning" : "healthy",
    },
    ...(canViewNetProfit ? [{
      key: "order-audit",
      title: "訂單對帳稽核異常",
      count: financialAuditIssueCount,
      helper: "帳務口徑不一致",
      actionLabel: "看報表稽核",
      path: "/reports",
      tone: financialAuditIssueCount > 0 ? "warning" : "healthy",
    }] : []),
    {
      key: "overdue-ar",
      title: "逾期應收帳款",
      count: overdueAR,
      helper: "逾期應收",
      actionLabel: "看應收帳款",
      path: "/sales/invoices",
      tone: overdueAR > 0 ? "critical" : "healthy",
    },
    {
      key: "overpaid",
      title: "超收 / 重複收款",
      count: overpaidAR,
      helper: "疑似重複收款",
      actionLabel: "核對超收",
      path: "/sales/invoices?focus=overpaid",
      tone: overpaidAR > 0 ? "critical" : "healthy",
    },
    ...(canViewNetProfit ? [{
      key: "ad-spend",
      title: "廣告費串接",
      count: adSpendNeedsAttention ? 1 : 0,
      helper: adSpendHelper,
      actionLabel: "看串接準備",
      path: "/accounting/workbench?focus=connector-readiness",
      tone: adSpendNeedsAttention ? "warning" : "healthy",
    }] : []),
  ];
  const riskPriorityRows = [
    {
      label: "未核銷收款",
      count: Number(executive?.operations.pendingPayoutCount || 0),
      color: "#dc2626",
      helper: "收款待核銷",
      path: "/accounting/workbench?focus=data-completeness",
    },
    {
      label: "手續費待補",
      count: Number(executive?.operations.feeBackfillCount || 0),
      color: "#ea580c",
      helper: "手續費待確認",
      path: "/accounting/workbench",
    },
    {
      label: "缺發票",
      count: missingInvoiceCount,
      color: "#d97706",
      helper: "發票待處理",
      path: "/accounting/workbench?focus=missing-invoices",
    },
    ...(canViewNetProfit ? [{
      label: "稽核異常",
      count: financialAuditIssueCount,
      color: "#be123c",
      helper: "帳務資料有落差",
      path: "/reports",
    }] : []),
    {
      label: "庫存警示",
      count: inventoryAlerts.length,
      color: "#0f766e",
      helper: "缺貨或低庫存",
      path: "/inventory/products",
    },
    ...(canViewNetProfit ? [{
      label: "廣告串接",
      count: adSpendNeedsAttention ? 1 : 0,
      color: "#4f46e5",
      helper: adSpendNeedsSecretCheck ? "廣告憑證待確認" : "廣告費待串接",
      path: "/accounting/workbench?focus=connector-readiness",
    }] : []),
  ]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
  const riskChartRows = riskPriorityRows.slice(0, 6)
  const topRiskCount = riskChartRows[0]?.count || 0
  const agingSource = [
    ...invoiceItems.map((item) => ({
      days: Number(item.daysSinceOrder || 0),
      amount: Number(item.totalAmount || 0),
    })),
    ...auditItems
      .filter((item) => item.severity !== "healthy")
      .map((item) => ({
        days: Math.max(dayjs().tz(DASHBOARD_TZ).diff(dayjs(item.orderDate).tz(DASHBOARD_TZ), "day"), 0),
        amount: Number(item.grossAmount || 0),
      })),
  ]
  const agingBuckets = [
    { label: "0-2 天", min: 0, max: 2, color: "#22c55e" },
    { label: "3-7 天", min: 3, max: 7, color: "#f59e0b" },
    { label: "8-14 天", min: 8, max: 14, color: "#f97316" },
    { label: "15 天+", min: 15, max: Infinity, color: "#dc2626" },
  ].map((bucket) => {
    const items = agingSource.filter((item) => item.days >= bucket.min && item.days <= bucket.max)
    return {
      ...bucket,
      count: items.length,
      amount: items.reduce((sum, item) => sum + item.amount, 0),
    }
  })
  const lastSuccessfulLabel = lastSuccessfulAt
    ? dayjs(lastSuccessfulAt).tz(DASHBOARD_TZ).format("YYYY/MM/DD HH:mm:ss")
    : null;
  const dataStatusMeta = {
    "initial-loading": {
      label: "初次載入中",
      className: "border-blue-200 bg-blue-50 text-blue-700",
      icon: <SyncOutlined spin />,
    },
    refreshing: {
      label: "資料更新中",
      className: "border-blue-200 bg-blue-50 text-blue-700",
      icon: <SyncOutlined spin />,
    },
    ready: {
      label: "資料已更新",
      className: "border-green-200 bg-green-50 text-green-700",
      icon: <span className="h-2 w-2 rounded-full bg-green-500" />,
    },
    partial: {
      label: "部分資料",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      icon: <WarningOutlined />,
    },
    stale: {
      label: "資料可能過期",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      icon: <ClockCircleOutlined />,
    },
    error: {
      label: "載入失敗",
      className: "border-red-200 bg-red-50 text-red-700",
      icon: <WarningOutlined />,
    },
  }[loadState];
  const selectedFinancialAvailable = selectedNetProfit != null;
  const overviewAvailable = Boolean(overview);
  const receivablesAvailable = Boolean(arSummary);
  const adFinancialAvailable = Boolean(rangeFinancial);
  const adCardDataAvailable = canViewNetProfit && adFinancialAvailable && (
    Boolean(connectorReadiness) || adSpendTracked || hasHistoricalAdSpend
  );
  const cashRiskDataAvailable = Boolean(arSummary) && (
    financeAvailability.payables || Boolean(executive?.expenses)
  );
  const financeWatchDataAvailable = Boolean(
    invoiceSummary && arSummary && rangeManagementSummary && (!canViewNetProfit || auditSummary),
  );
  const legacyDashboardVisible = false;

  return (
    <div className="page-section-stack page-section-stack--compact">
      {/* ── 頁面標題 + 篩選控制 ── */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Title level={2} className="!text-gray-800 font-light tracking-tight !mb-0 whitespace-nowrap">
              營運儀表板
            </Title>
            <div className={`flex items-center gap-2 rounded-full border px-3 py-1 ${dataStatusMeta.className}`}>
              {dataStatusMeta.icon}
              <span className="text-xs font-medium uppercase tracking-wider">{dataStatusMeta.label}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col xl:items-end gap-3 w-full xl:w-auto">
          <div className="flex flex-wrap justify-start xl:justify-end gap-2 items-center">
            <Radio.Group value={rangeMode} onChange={(e) => {
              const nextMode = e.target.value as RangeMode;
              setRangeMode(nextMode);
              if (nextMode === "custom" && (!customRange?.[0] || !customRange?.[1])) {
                message.info("請選擇自訂日期區間");
              }
            }}>
              <Radio.Button value="today">今天</Radio.Button>
              <Radio.Button value="yesterday">昨天</Radio.Button>
              <Radio.Button value="last7d">近 7 天</Radio.Button>
              <Radio.Button value="last30d">近 30 天</Radio.Button>
              <Radio.Button value="last1y">近 1 年</Radio.Button>
              <Radio.Button value="all">全部</Radio.Button>
              <Radio.Button value="custom">自訂</Radio.Button>
            </Radio.Group>
            <Button type="primary" icon={<SyncOutlined spin={syncing} />} loading={syncing}
              onClick={handleManualSync} className="bg-black hover:bg-gray-800 border-none shadow-sm">
              {syncing ? "同步中..." : "即時同步"}
            </Button>
          </div>
          {rangeMode === "custom" && (
            <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}>
              <RangePicker value={customRange} onChange={handleCustomRangeChange}
                format="YYYY/MM/DD" allowClear className="shadow-sm"
                placeholder={["開始日期", "結束日期"]} />
            </motion.div>
          )}
        </div>
      </div>

      {(loadState === "partial" || loadState === "stale") && (
        <Alert
          type="warning"
          showIcon
          message={loadState === "stale" ? "部分資料可能已過期" : "儀表板資料未完整載入"}
          description={
            <div className="space-y-1">
              <div>
                {loadState === "stale"
                  ? "已保留上一次成功取得的數值；請勿將未更新區塊視為目前即時狀態。"
                  : "已載入成功的區塊可繼續查看，未取得的 KPI 會顯示為「—」。"}
              </div>
              {lastSuccessfulLabel && <div>最後成功取得核心資料：{lastSuccessfulLabel}</div>}
              {failedSections.length > 0 && (
                <div>未完整區塊：{failedSections.join("、")}</div>
              )}
              {loadErrorMessage && <div>{loadErrorMessage}</div>}
            </div>
          }
          action={
            rangeMode === "custom" && (!customRange?.[0] || !customRange?.[1]) ? undefined : (
              <Button
                icon={<SyncOutlined />}
                onClick={handleRetry}
              >
                重新載入
              </Button>
            )
          }
        />
      )}

      {/* ── 🚨 紅燈警示 ── */}
      {criticalCount > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 flex items-center gap-4">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-red-700">待處理：</span>
            <span className="ml-2 text-red-600">
              {criticalInventory > 0 && `${criticalInventory} 個商品斷貨；`}
              {overdueAR > 0 && `${overdueAR} 筆應收逾期；`}
              {overpaidAR > 0 && `${overpaidAR} 筆疑似超收 / 重複收款；`}
              {criticalAnomalies > 0 && `${criticalAnomalies} 個財務異常`}
            </span>
          </div>
          <Tag color="red" className="shrink-0">共 {criticalCount} 項</Tag>
        </motion.div>
      )}

      {overpaidAR > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-red-600 shadow-sm">
                <FallOutlined />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">超收 / 疑似重複收款</span>
                  <Tag color="red">{overpaidAR} 筆待核對</Tag>
                </div>
                <div className="mt-1 text-sm text-slate-600">差額 {fmtMoney(overpaidARAmount)}</div>
              </div>
            </div>
            <Button danger onClick={() => navigate("/sales/invoices?focus=overpaid")}>
              查看超收明細
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm">
              <FileTextOutlined />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">缺發票訂單</span>
                <Tag color={!invoiceSummary ? "default" : missingInvoiceCount > 0 ? "gold" : "green"}>
                  {!invoiceSummary
                    ? "資料未取得"
                    : missingInvoiceCount > 0
                      ? `${missingInvoiceCount} 筆待處理`
                      : "目前無待處理"}
                </Tag>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button onClick={handleSyncInvoiceStatuses} loading={syncingInvoiceStatuses}>
              同步發票狀態
            </Button>
            <Button type="primary" onClick={() => navigate("/accounting/workbench?focus=missing-invoices")}>
              處理缺發票
            </Button>
          </div>
        </div>
      </div>

      {/* ── CEO 財務管制：現金流、淨利、廣告與異常 ── */}
      <div className="glass-card p-6">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-lg font-semibold text-slate-900">財務概況</div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button icon={<AlertOutlined />} onClick={() => setFinanceOptionsOpen(true)}>
              財務選項
            </Button>
            <Button icon={<LineChartOutlined />} onClick={() => navigate("/reconciliation")}>
              對帳中心
            </Button>
          </div>
        </div>

        <div className={`grid gap-4 md:grid-cols-2 ${canViewNetProfit ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
          {canViewNetProfit && <div className={`rounded-2xl border px-5 py-4 ${
            !selectedFinancialAvailable
              ? "border-slate-200 bg-slate-50/70"
              : selectedNetProfit != null && selectedNetProfit < 0
                ? "border-red-200 bg-red-50/70"
                : "border-emerald-100 bg-emerald-50/60"
          }`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
                <DollarOutlined />
              </div>
              <Tag color={!selectedFinancialAvailable ? "default" : selectedNetProfit != null && selectedNetProfit < 0 ? "red" : "green"}>
                {selectedFinancialAvailable ? selectedPeriodLabel : "資料未取得"}
              </Tag>
            </div>
            <div className="text-xs text-slate-500">{selectedPeriodLabel}淨利</div>
            <div className={`mt-1 text-2xl font-bold ${
              selectedNetProfit != null && selectedNetProfit < 0 ? "text-red-700" : "text-slate-900"
            }`}>
              {selectedNetProfit == null ? "—" : fmtSignedMoney(selectedNetProfit)}
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              {selectedFinancialAvailable
                ? `營收 ${fmtOptionalMoney(selectedRevenue)} · 淨利率 ${fmtPct(selectedNetMarginPct)}`
                : "本期損益區塊未成功載入"}
            </div>
          </div>}

          {canViewNetProfit && <div className={`rounded-2xl border px-5 py-4 ${
            adSpendNeedsAttention ? "border-amber-200 bg-amber-50/70" : "border-slate-100 bg-white/60"
          }`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-indigo-700 shadow-sm">
                <CreditCardOutlined />
              </div>
              <Tag color={!adCardDataAvailable ? "default" : adSpendTracked ? "blue" : adSpendNeedsAttention ? "gold" : "green"}>
                {adCardDataAvailable ? adSpendStatusLabel : "資料未取得"}
              </Tag>
            </div>
            <div className="text-xs text-slate-500">{rangeLabel}廣告花費</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {adCardDataAvailable
                ? (adSpendCanShowAmount ? fmtOptionalMoney(adSpendAmount) : "待串接")
                : "—"}
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              {adCardDataAvailable ? adSpendHelper : "本期損益或串接狀態未成功載入"}
            </div>
            {adCardDataAvailable && adSpendCanSyncDaily && !adSpendTracked && (
              <Button
                size="small"
                type="link"
                className="mt-2 !px-0"
                loading={syncingAdSpend}
                onClick={handleAdSpendSync}
              >
                同步本區間廣告費
              </Button>
            )}
          </div>}

          <div className={`rounded-2xl border px-5 py-4 ${
            cashRiskAmount > 0 ? "border-rose-200 bg-rose-50/70" : "border-slate-100 bg-white/60"
          }`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-rose-700 shadow-sm">
                <BankOutlined />
              </div>
              <Tag color={!cashRiskDataAvailable ? "default" : cashRiskAmount > 0 ? "red" : "green"}>
                {cashRiskDataAvailable ? "現金流" : "資料未取得"}
              </Tag>
            </div>
            <div className="text-xs text-slate-500">目前現金流風險金額</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {cashRiskDataAvailable ? fmtMoney(cashRiskAmount) : "—"}
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              {cashRiskDataAvailable
                ? `逾期應收 ${overdueAR} 筆 · 超收 ${overpaidAR} 筆 · 待付款 ${fmtMoney(payableExposure)}`
                : "應收或應付資料未成功載入"}
            </div>
          </div>

          <div className={`rounded-2xl border px-5 py-4 ${
            financeWatchCount > 0 ? "border-red-200 bg-red-50/70" : "border-slate-100 bg-white/60"
          }`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-red-700 shadow-sm">
                <WarningOutlined />
              </div>
              <Tag color={!financeWatchDataAvailable ? "default" : financeWatchCount > 0 ? "red" : "green"}>
                {!financeWatchDataAvailable ? "資料未取得" : financeWatchCount > 0 ? "需追蹤" : "正常"}
              </Tag>
            </div>
            <div className="text-xs text-slate-500">財務異常追蹤</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {financeWatchDataAvailable ? `${financeWatchCount} 項` : "—"}
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              {financeWatchDataAvailable
                ? canViewNetProfit
                  ? `缺發票 ${missingInvoiceCount} · 訂單稽核 ${financialAuditIssueCount} · 廣告費 ${adSpendNeedsAttention ? "需確認" : "可追"}`
                  : `缺發票 ${missingInvoiceCount} · 應收 ${overdueAR} 筆待追`
                : "發票或應收資料未完整載入"}
            </div>
          </div>
        </div>
      </div>

      {/* ── 平台營收與營業額對照 ── */}
      <div className={`grid gap-4 ${canViewNetProfit ? "xl:grid-cols-[1fr_1fr]" : "xl:grid-cols-1"}`}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="text-lg font-semibold text-slate-900">銷售通路</div>
            <Tag className="rounded-full bg-slate-100 text-slate-500 border-slate-200 text-xs">
              {platformRevenueRows.length} 個通路
            </Tag>
          </div>

          {topPlatformRevenueRows.length > 0 ? (
            <div className="space-y-3">
              {topPlatformRevenueRows.map((row) => {
                const netRate = canViewNetProfit && row.gross > 0 && row.payoutNet != null
                  ? (row.payoutNet / row.gross) * 100 : null
                return (
                  <div key={row.key} className="rounded-2xl border border-slate-100 bg-white/65 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: row.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 truncate text-sm font-semibold text-slate-900">{row.label}</div>
                          <div className="text-base font-bold text-slate-900">{fmtMoney(row.gross)}</div>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                          <div>訂單 {row.orderCount.toLocaleString("zh-TW")} 筆</div>
                          {canViewNetProfit && <div>淨入帳 {fmtOptionalMoney(row.payoutNet)}</div>}
                          {canViewNetProfit && <div>淨入帳率 {fmtPct(netRate)}</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex h-[180px] items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
              {overview ? "目前區間尚無平台營收資料" : "銷售與通路概況未取得"}
            </div>
          )}
        </motion.div>

        {canViewNetProfit && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="text-lg font-semibold text-slate-900">營業額對照</div>
            <div className="flex flex-wrap gap-2">
              {adSourceRows.map((source) => (
                <Tag key={source.sourceModule} className="rounded-full bg-slate-100 text-slate-500 border-slate-200 text-xs">
                  {source.label} {source.lastDateLabel}
                </Tag>
              ))}
            </div>
          </div>

          {topAdPerformanceRows.length > 0 ? (
            <div className="space-y-3">
              {topAdPerformanceRows.map((row) => (
                <div key={row.brand} className="rounded-2xl border border-slate-100 bg-white/65 px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{row.brand}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        營收占比 {fmtPct(row.revenueShare)} · 廣告占比 {fmtPct(row.adSpendShare)}
                      </div>
                    </div>
                    <Tag color={row.roas && row.roas >= 2 ? "green" : row.roas && row.roas >= 1 ? "gold" : "red"}>
                      ROAS {fmtRoas(row.roas)}
                    </Tag>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">營業額</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{fmtMoney(row.revenue)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">廣告費</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{fmtOptionalMoney(row.adSpend)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">訂單</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{row.orderCount.toLocaleString("zh-TW")} 筆</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-[180px] items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
              {adPerformance ? "目前區間尚無資料" : "資料未取得"}
            </div>
          )}
        </motion.div>}
      </div>

      {/* ── CEO 快速圖表：趨勢、占比、風險 ── */}
      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.85fr]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="text-lg font-semibold text-slate-900">30 天趨勢</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Tag color="default">營收</Tag>
              {canViewNetProfit && <Tag color="green">淨利</Tag>}
              {canViewNetProfit && <Tag color="blue">淨入帳</Tag>}
              {canViewNetProfit && <Tag color="gold">廣告費</Tag>}
            </div>
          </div>
          {revenueTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={revenueTrend} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ceoRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#475569" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#475569" stopOpacity={0} />
                  </linearGradient>
                  {canViewNetProfit && <linearGradient id="ceoProfitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>}
                  {canViewNetProfit && <linearGradient id="ceoCashGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => fmtCompact(Number(v))} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [fmtMoney(Number(value)), name]}
                  contentStyle={{ borderRadius: "10px", border: "1px solid rgba(0,0,0,0.08)", fontSize: "12px" }} />
                <Area type="monotone" dataKey="revenue" stroke="#475569" strokeWidth={2} fill="url(#ceoRevenueGrad)" name="營收" />
                {canViewNetProfit && <Area type="monotone" dataKey="netProfit" stroke="#16a34a" strokeWidth={2} fill="url(#ceoProfitGrad)" name="淨利" />}
                {canViewNetProfit && <Area type="monotone" dataKey="payoutNet" stroke="#2563eb" strokeWidth={2} fill="url(#ceoCashGrad)" name="淨入帳" />}
                {canViewNetProfit && <Area type="monotone" dataKey="adSpend" stroke="#d97706" strokeWidth={2} fill="transparent" name="廣告費" />}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">
              {managementSummary ? "尚無足夠趨勢資料" : "30 天趨勢資料未取得"}
            </div>
          )}
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
          {canViewNetProfit && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="text-lg font-semibold text-slate-900">銷售通路</div>
              <Tag className="rounded-full bg-slate-100 text-slate-500 border-slate-200 text-xs">淨入帳占比</Tag>
            </div>
            {channelPieData.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-[160px_1fr] xl:grid-cols-[150px_1fr]">
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={channelPieData} dataKey="net" nameKey="platform" innerRadius={48} outerRadius={70} paddingAngle={2}>
                      {channelPieData.map((entry) => (
                        <Cell key={entry.platform} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value: number) => fmtMoney(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {channelPieData.map((item) => (
                    <div key={item.platform} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                      <span className="min-w-0 flex-1 truncate text-slate-600">{item.platform}</span>
                      <span className="font-semibold text-slate-800">{fmtCompact(item.net)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[150px] items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                {overview ? "尚無通路淨入帳資料" : "銷售與通路概況未取得"}
              </div>
            )}
          </motion.div>}

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="text-lg font-semibold text-slate-900">品牌貢獻</div>
            </div>
            {brandPieData.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={brandPieData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={2}>
                      {brandPieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value: number) => fmtMoney(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {brandPieData.map((item) => (
                    <div key={item.name} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                      <span className="flex-1 text-slate-600">{item.name}</span>
                      <span className="font-semibold text-slate-800">{fmtCompact(item.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[140px] items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                尚無品牌營業額資料
              </div>
            )}
          </motion.div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="text-lg font-semibold text-slate-900">待處理事項</div>
            <Button onClick={() => setFinanceOptionsOpen(true)}>財務選項</Button>
          </div>
          {riskChartRows.length > 0 ? (
            <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={riskChartRows} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="label" type="category" width={92} tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <RechartsTooltip formatter={(value: number) => [`${Number(value).toLocaleString("zh-TW")} 項`, "待處理"]} />
                  <Bar dataKey="count" radius={[0, 8, 8, 0]}>
                    {riskChartRows.map((entry) => (
                      <Cell key={entry.label} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="space-y-3">
                {riskChartRows.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className="w-full rounded-2xl border border-slate-100 bg-white/70 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-800">{item.label}</span>
                      <span className="text-sm font-bold" style={{ color: item.color }}>{item.count.toLocaleString("zh-TW")}</span>
                    </div>
                    <Progress
                      percent={topRiskCount ? Math.max(4, Math.round((item.count / topRiskCount) * 100)) : 0}
                      strokeColor={item.color}
                      trailColor="rgba(0,0,0,0.06)"
                      size="small"
                      showInfo={false}
                      className="mt-2"
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
              目前沒有高優先待處理項目
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="mb-5 text-lg font-semibold text-slate-900">異常帳齡</div>
          <div className="space-y-3">
            {agingBuckets.map((bucket) => (
              <div key={bucket.label} className="rounded-2xl border border-slate-100 bg-white/70 px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">{bucket.label}</span>
                  <span className="text-sm font-bold" style={{ color: bucket.color }}>{bucket.count} 件</span>
                </div>
                <Progress
                  percent={agingSource.length ? Math.round((bucket.count / agingSource.length) * 100) : 0}
                  strokeColor={bucket.color}
                  trailColor="rgba(0,0,0,0.06)"
                  size="small"
                  showInfo={false}
                />
                <div className="mt-1 text-xs text-slate-400">影響金額 {fmtMoney(bucket.amount)}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {legacyDashboardVisible && canViewNetProfit && <>
      {/* ── 舊版重複區塊：保留程式兼容，不再顯示 ── */}
      {/* ── 核心 KPI（4 張，全部真實資料）── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: '本期總業績',
            value: overviewAvailable && total ? fmtMoney(total!.gross) : "—",
            sub: overviewAvailable && total ? `${total!.orderCount} 筆訂單` : "銷售概況未取得",
            icon: <ShoppingOutlined className="text-slate-500 text-lg" />,
            accent: 'border-l-slate-500',
            alert: false,
          },
          {
            label: '本期淨入帳',
            value: overviewAvailable && total ? fmtMoney(total!.payoutNet) : "—",
            sub: overviewAvailable && total ? `手續費 ${fmtMoney(total!.feeTotal)}` : "銷售概況未取得",
            icon: <RiseOutlined className="text-teal-600 text-lg" />,
            accent: 'border-l-teal-500',
            alert: false,
          },
          {
            label: '逾期應收帳款',
            value: receivablesAvailable
              ? fmtMoney(arSummary?.overdueReceivableAmount ?? arSummary?.outstandingAmount ?? 0)
              : "—",
            sub: receivablesAvailable ? `${overdueAR} 筆逾期` : "應收帳款未取得",
            icon: <FallOutlined className="text-rose-500 text-lg" />,
            accent: overdueAR > 0 ? 'border-l-rose-500' : 'border-l-slate-200',
            alert: overdueAR > 0,
          },
          {
            label: '超收 / 重複收款',
            value: receivablesAvailable ? fmtMoney(overpaidARAmount) : "—",
            sub: receivablesAvailable ? `${overpaidAR} 筆需核對` : "應收帳款未取得",
            icon: <DollarOutlined className="text-red-500 text-lg" />,
            accent: overpaidAR > 0 ? 'border-l-red-500' : 'border-l-slate-200',
            alert: overpaidAR > 0,
          },
        ].map((item, idx) => (
          <div key={idx}
            className={`glass-card border-l-4 ${item.accent} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center shadow-sm">
                {item.icon}
              </div>
              {item.alert && <Tag color="red" className="!text-[10px]">需追蹤</Tag>}
            </div>
            <div className="text-xs text-slate-400 mb-1">{item.label}</div>
            <div className="text-xl font-bold text-slate-800">{item.value}</div>
            <div className="text-xs text-slate-400 mt-1">{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ── 品牌業績 ── */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 mb-3">Brand Performance</div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              brand: 'Moztech 墨子科技', sub: '3C 手機配件 · Shopify',
              gross: mOZtechData.gross, orders: mOZtechData.orderCount, net: mOZtechData.payoutNet,
              available: overviewAvailable,
              gradient: 'from-slate-700 to-slate-900',
            },
            {
              brand: 'Bonson 邦生', sub: '居家 / 清潔 / 戶外 · Shopline',
              gross: bonsonData.gross, orders: bonsonData.orderCount, net: bonsonData.payoutNet,
              available: overviewAvailable,
              gradient: 'from-teal-700 to-teal-900',
            },
            {
              brand: 'KOL 團購 (1Shop)', sub: 'Moztech + Bonson · 網紅通路',
              gross: teamData.gross, orders: teamData.orderCount, net: teamData.payoutNet,
              available: overviewAvailable,
              gradient: 'from-indigo-700 to-violet-800',
            },
          ].map((b) => (
            <motion.div key={b.brand} whileHover={{ y: -2 }}
              className="glass-card overflow-hidden p-0">
              <div className={`bg-gradient-to-r ${b.gradient} px-5 py-4 text-white`}>
                <div className="font-semibold text-base">{b.brand}</div>
                <div className="text-xs text-white/60 mt-0.5">{b.sub}</div>
              </div>
              <div className="grid grid-cols-3 gap-0 divide-x divide-slate-100">
                <div className="px-4 py-3">
                  <div className="text-xs text-slate-400">業績</div>
                  <div className="mt-1 text-base font-bold text-slate-800">
                    {b.available ? fmtMoney(b.gross) : "—"}
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs text-slate-400">訂單數</div>
                  <div className="mt-1 text-base font-bold text-slate-800">
                    {b.available ? b.orders : "—"}
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs text-slate-400">淨入帳</div>
                  <div className="mt-1 text-base font-bold text-teal-700">
                    {b.available ? fmtMoney(b.net) : "—"}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── 30 天走勢 + 損益概況 ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Revenue Trend</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">30 天營收走勢</div>
            </div>
            <Tag className="rounded-full bg-slate-100 text-slate-500 border-slate-200 text-xs">每日（扣費前）</Tag>
          </div>
          {revenueTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={revenueTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#334155" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#334155" stopOpacity={0} />
                  </linearGradient>
                  {canViewMargin && <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `${(v / 10000).toFixed(0)}萬`} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [fmtMoney(value), name === 'revenue' ? '營收' : '毛利']}
                  contentStyle={{ borderRadius: '10px', border: '1px solid rgba(0,0,0,0.08)', fontSize: '12px' }} />
                <Area type="monotone" dataKey="revenue" stroke="#475569" strokeWidth={2} fill="url(#revGrad)" name="revenue" />
                {canViewMargin && <Area type="monotone" dataKey="profit" stroke="#0d9488" strokeWidth={2} fill="url(#profGrad)" name="profit" />}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-sm text-slate-400">
              {managementSummary ? "尚無足夠趨勢資料" : "30 天趨勢資料未取得"}
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 mb-1">P&L Snapshot</div>
          <div className="text-lg font-semibold text-slate-900 mb-4">損益快照</div>
          {rangeManagementSummary?.summary ? (
            <div className="space-y-3">
              {[
                { label: '區間營收', value: weeklyPnl.revenue, color: 'text-slate-800' },
                ...(canViewCost ? [{ label: '估算銷貨成本', value: weeklyPnl.cost, color: 'text-rose-600' }] : []),
                ...(canViewMargin ? [{ label: '毛利', value: weeklyPnl.grossProfit, color: 'text-teal-700' }] : []),
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-500">{row.label}</span>
                  <span className={`font-bold text-sm ${row.color}`}>{fmtOptionalMoney(row.value)}</span>
                </div>
              ))}
              {canViewMargin && <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5 text-xs text-slate-500">
                  <span>毛利率</span>
                  <span className="font-semibold text-slate-700">{fmtPct(weeklyPnl.grossMargin == null ? null : weeklyPnl.grossMargin * 100)}</span>
                </div>
                {weeklyPnl.grossMargin != null && <Progress percent={Math.round(weeklyPnl.grossMargin * 100)} strokeColor="#0d9488"
                  trailColor="rgba(0,0,0,0.06)" size="small" showInfo={false} />}
              </div>}
              {canViewNetProfit && <div className="rounded-xl bg-slate-50 px-4 py-3 mt-1">
                <div className="text-xs text-slate-400 mb-0.5">淨入帳（扣平台與金流費）</div>
                <div className="text-lg font-bold text-slate-900">{fmtOptionalMoney(weeklyPnl.monthlyEarned)}</div>
              </div>}
            </div>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-sm text-slate-400">
              {rangeManagementSummary ? "目前區間沒有損益資料" : "本期損益資料未取得"}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── 各通路貢獻（排除金流商，只顯示真實通路）── */}
      {platformContribs.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Channel Revenue</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">各通路貢獻</div>
            </div>
            <Tag className="rounded-full bg-slate-100 text-slate-500 border-slate-200 text-xs">淨入帳（扣費後）</Tag>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {(() => {
              const channelTotal = platformContribs.reduce((s, p) => s + p.net, 0);
              return platformContribs.sort((a, b) => b.net - a.net).map((p) => (
                <div key={p.platform} className="rounded-2xl border border-slate-100 bg-white/50 px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                    <span className="font-medium text-slate-700 text-sm">{p.platform}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {channelTotal > 0 ? ((p.net / channelTotal) * 100).toFixed(1) : '0.0'}%
                    </span>
                  </div>
                  <div className="text-xl font-bold text-slate-900 mb-2">{fmtMoney(p.net)}</div>
                  <Progress percent={channelTotal > 0 ? Math.round((p.net / channelTotal) * 100) : 0}
                    strokeColor={p.color} showInfo={false} size="small" trailColor="rgba(0,0,0,0.06)" />
                </div>
              ));
            })()}
          </div>
        </motion.div>
      )}
      </>}

      {/* ── 庫存警示（有才顯示）── */}
      {inventoryAlerts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-lg font-semibold text-slate-900">
                庫存警示
                {criticalInventory > 0 && (
                  <Tag color="red" className="ml-3 rounded-full">{criticalInventory} 項斷貨</Tag>
                )}
              </div>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {inventoryAlerts.map((item) => (
              <div key={`${item.sku}-${item.name}`}
                className={`flex items-center justify-between rounded-xl px-4 py-3 ${
                  item.severity === 'critical' ? 'bg-red-50 border border-red-100' : 'bg-amber-50 border border-amber-100'
                }`}>
                <div>
                  <div className="font-medium text-slate-800 text-sm">{item.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">SKU {item.sku} · 現有 {item.qtyAvailable}</div>
                </div>
                <Tag color={item.severity === 'critical' ? 'red' : 'gold'} className="shrink-0">
                  {item.severity === 'critical' ? '斷貨' : '低庫存'}
                </Tag>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {legacyDashboardVisible && canViewNetProfit && <>
      {/* ── 舊版重複待辦：保留程式兼容，不再顯示 ── */}
      {/* ── CEO 決策清單 ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass-card p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 mb-1">Exception Inbox</div>
          <div className="text-lg font-semibold text-slate-900 mb-4">異常待辦</div>
          <div className="space-y-2">
            {anomalies.map((item) => {
              const tone = getTaskToneMeta(item.tone);
              return (
                <div key={item.key}
                  className={`rounded-xl px-4 py-3 ${
                    item.tone === 'critical' ? 'bg-red-50' : item.tone === 'warning' ? 'bg-amber-50' : 'bg-slate-50'
                  }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-800 text-sm">{item.title}</span>
                        <Tag color={tone.color} className="text-[11px]">{item.statusLabel}</Tag>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate">{item.helper}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-slate-800">{item.count}</div>
                      {item.amount !== null && (
                        <div className="text-[11px] text-slate-400">NT$ {item.amount.toFixed(0)}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {!anomalies.length && (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-400 text-center">
                {executive ? "✓ 目前沒有異常" : "CEO 異常資料未取得"}
              </div>
            )}
          </div>
        </div>

        <div className="glass-card p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 mb-1">Priority Tasks</div>
          <div className="text-lg font-semibold text-slate-900 mb-4">CEO 待辦</div>
          <div className="space-y-2">
            {tasks.map((task, idx) => {
              const tone = getTaskToneMeta(task.tone);
              return (
                <div key={task.key}
                  className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white shrink-0"
                      style={{ backgroundColor: idx % 3 === 0 ? '#475569' : idx % 3 === 1 ? '#2563eb' : '#0891b2' }}>
                      {task.title.slice(0, 1)}
                    </div>
                    <div>
                      <div className="font-medium text-slate-800 text-sm">{task.title}</div>
                      <div className="text-xs text-slate-400">
                        {task.helper}{task.amount ? ` · NT$ ${task.amount.toFixed(0)}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-slate-700">{task.value}</span>
                    <Tag color={tone.color}>{tone.badge}</Tag>
                  </div>
                </div>
              );
            })}
            {!tasks.length && (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-400 text-center">
                {executive ? "✓ 目前沒有待辦事項" : "CEO 待辦資料未取得"}
              </div>
            )}
          </div>
        </div>
      </div>
      </>}

      <Modal
        title="財務追蹤選項"
        open={financeOptionsOpen}
        footer={null}
        onCancel={() => setFinanceOptionsOpen(false)}
        width={760}
      >
        <div className="space-y-3">
          {financeOptionRows.map((item) => {
            const color =
              item.tone === "critical" ? "red" : item.tone === "warning" ? "gold" : "green";
            return (
              <div key={item.key} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{item.title}</span>
                      <Tag color={color}>{item.count} 項</Tag>
                    </div>
                    <div className="mt-1 text-sm leading-6 text-slate-500">{item.helper}</div>
                  </div>
                  <Button
                    className="shrink-0"
                    onClick={() => {
                      setFinanceOptionsOpen(false);
                      navigate(item.path);
                    }}
                  >
                    {item.actionLabel}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
};
export default DashboardPage;
