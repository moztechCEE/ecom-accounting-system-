/**
 * DashboardPage.tsx
 * 修改（2026-04）：新增財務即時快覽、本週損益快覽、各平台貢獻度橫條圖
 */
import React, { useState, useEffect } from "react";
import {
  Row,
  Col,
  Button,
  Card,
  message,
  Radio,
  DatePicker,
  Modal,
  Statistic,
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
import PageSkeleton from "../components/PageSkeleton";
import AIInsightsWidget from "../components/AIInsightsWidget";
import { GlassCard } from "../components/ui/GlassCard";
import { shopifyService } from "../services/shopify.service";
import { oneShopService } from "../services/oneshop.service";
import { shoplineService } from "../services/shopline.service";
import {
  invoicingService,
  InvoiceQueueItem,
  InvoiceQueueResponse,
} from "../services/invoicing.service";
import {
  arService,
  ReceivableMonitorResponse,
} from "../services/ar.service";
import { salesService } from "../services/sales.service";
import {
  dashboardService,
  ConnectorReadiness,
  DashboardExecutiveOverview,
  DashboardOperationsHub,
  DashboardPerformanceBucket,
  DashboardSalesOverview,
  ManagementSummary,
  OrderReconciliationAudit,
  OrderReconciliationAuditItem,
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

type RangeMode = "all" | "today" | "yesterday" | "last7d" | "custom";
type CustomRange = [Dayjs, Dayjs] | null;
type RangeValue = [Dayjs | null, Dayjs | null] | null;

// ─── 財務快覽型別 ────────────────────────────────────────

interface FinanceSummary {
  arOutstanding: number;
  apOutstanding: number;
  inTransit: number;
  bankBalance: number;
}

interface WeeklyPnl {
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMargin: number;
  monthlyEarned: number;
}

interface PlatformContribution {
  platform: string;
  net: number;
  color: string;
}


interface RevenueTrendPoint {
  date: string;
  revenue: number;
  profit: number;
  netProfit: number;
  payoutNet: number;
  adSpend: number;
}
// ─── 金額格式化 ──────────────────────────────────────────

const fmtMoney = (n: number) =>
  n.toLocaleString("zh-TW", { minimumFractionDigits: 0 }) + " 元";

const fmtSignedMoney = (n: number) => `${n < 0 ? "-" : ""}${fmtMoney(Math.abs(n))}`;

const fmtPct = (n: number | null | undefined) => `${Number(n || 0).toFixed(1)}%`;

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

  if (mode === "custom" && customRange && customRange[0] && customRange[1]) {
    const start = customRange[0].tz(timezone, true).startOf("day");
    const end = customRange[1].tz(timezone, true).endOf("day");
    return { since: start.toISOString(), until: end.toISOString() };
  }

  return { since: undefined, until: undefined };
}

function getBucketAccent(index: number) {
  const accents = [
    "from-sky-500/15 to-sky-100/10 text-sky-600",
    "from-emerald-500/15 to-emerald-100/10 text-emerald-600",
    "from-amber-500/15 to-amber-100/10 text-amber-600",
    "from-fuchsia-500/15 to-fuchsia-100/10 text-fuchsia-600",
    "from-slate-700/15 to-slate-100/10 text-slate-700",
  ];
  return accents[index % accents.length];
}

function getBucketStatus(bucket: DashboardPerformanceBucket) {
  if (!bucket.paymentCount) {
    return {
      color: "default" as const,
      label: "待同步金流",
      helper: "目前只有訂單，尚未建立收款或撥款資料",
    };
  }

  if (bucket.pendingPayoutCount === 0) {
    return {
      color: "green" as const,
      label: "已完成對帳",
      helper: "這個區塊的收款都已完成對帳回填",
    };
  }

  if (bucket.reconciledCount > 0) {
    return {
      color: "gold" as const,
      label: "部分待撥款",
      helper: "已有部分收款完成對帳，仍有款項待撥或待核對",
    };
  }

  return {
    color: "blue" as const,
    label: "待撥款 / 待對帳",
    helper: "訂單已進系統，但金流與撥款明細尚未全部完成回填",
  };
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


function getAuditSeverityMeta(
  severity: OrderReconciliationAuditItem["severity"],
) {
  if (severity === "critical") {
    return { color: "red" as const, label: "高風險" };
  }
  if (severity === "warning") {
    return { color: "gold" as const, label: "需追蹤" };
  }
  return { color: "green" as const, label: "正常" };
}

function getInvoiceQueueMeta(item: InvoiceQueueItem) {
  if (item.invoiceStatus === "completed") {
    return { color: "green" as const, label: "已開票" };
  }
  if (item.invoiceStatus === "eligible") {
    return { color: "gold" as const, label: "可批次開票" };
  }
  return { color: "blue" as const, label: "待付款後開票" };
}

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customRange, setCustomRange] = useState<CustomRange>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncingInvoiceStatuses, setSyncingInvoiceStatuses] = useState(false);
  const [overview, setOverview] = useState<DashboardSalesOverview | null>(null);
  const [executive, setExecutive] = useState<DashboardExecutiveOverview | null>(null);
  const [operationsHub, setOperationsHub] = useState<DashboardOperationsHub | null>(null);
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
  const [weeklyPnl, setWeeklyPnl] = useState<WeeklyPnl>({
    revenue: 0,
    cost: 0,
    grossProfit: 0,
    grossMargin: 0,
    monthlyEarned: 0,
  })
  const [managementSummary, setManagementSummary] = useState<ManagementSummary | null>(null)
  const [rangeManagementSummary, setRangeManagementSummary] = useState<ManagementSummary | null>(null)
  const [todayManagementSummary, setTodayManagementSummary] = useState<ManagementSummary | null>(null)
  const [connectorReadiness, setConnectorReadiness] = useState<ConnectorReadiness | null>(null)
  const [financeOptionsOpen, setFinanceOptionsOpen] = useState(false)


  const [revenueTrend, setRevenueTrend] = useState<RevenueTrendPoint[]>([])

  useEffect(() => {
    if (rangeMode === "custom" && (!customRange?.[0] || !customRange?.[1])) {
      setLoading(false);
      return;
    }

    const storedEntityId = localStorage.getItem("entityId")?.trim();
    const { since, until } = resolveRange(rangeMode, DASHBOARD_TZ, customRange);

    let ignore = false;

    const fetchSummary = async () => {
      setLoading(true);
      try {
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

        const [
          summary,
          executiveOverview,
          operationsHubData,
          invoiceQueueData,
          auditData,
          receivableMonitorData,
          mgmtSummaryData,
          rangeMgmtSummaryData,
          todayMgmtSummaryData,
          connectorReadinessData,
        ] = await Promise.all([
          dashboardService.getSalesOverview({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
          }),
          dashboardService.getExecutiveOverview({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
          }),
          dashboardService.getOperationsHub({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
          }),
          invoicingService.getQueue({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
            limit: 24,
          }),
          dashboardService.getOrderReconciliationAudit({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
            limit: 24,
          }),
          arService.getReceivableMonitor({
            entityId: storedEntityId,
            startDate: arMonitorStart,
            endDate: arMonitorEnd,
          }),
          dashboardService.getManagementSummary({
            entityId: storedEntityId,
            groupBy: 'day',
            startDate: trend30Start,
            endDate: trend30End,
          }),
          dashboardService.getManagementSummary({
            entityId: storedEntityId,
            groupBy: rangeMode === 'all' ? 'month' : 'day',
            startDate: since,
            endDate: until,
          }),
          dashboardService.getManagementSummary({
            entityId: storedEntityId,
            groupBy: 'day',
            startDate: todayStart,
            endDate: todayEnd,
          }),
          dashboardService.getConnectorReadiness({
            entityId: storedEntityId,
          }),
        ]);

        if (ignore) return;

        setOverview(summary);
        setExecutive(executiveOverview);
        setOperationsHub(operationsHubData);
        setInvoiceQueue(invoiceQueueData);
        setAudit(auditData);
        setReceivableMonitor(receivableMonitorData);
        setManagementSummary(mgmtSummaryData);
        setRangeManagementSummary(rangeMgmtSummaryData);
        setTodayManagementSummary(todayMgmtSummaryData);
        setConnectorReadiness(connectorReadinessData);

        // 30天走勢圖 — 真實日報資料
        if (mgmtSummaryData?.periods?.length) {
          setRevenueTrend(
            mgmtSummaryData.periods.map((p) => ({
              date: dayjs(p.startDate).tz(DASHBOARD_TZ).format('MM/DD'),
              revenue: p.revenue,
              profit: p.grossProfit,
              netProfit: p.netProfit,
              payoutNet: p.payoutNet,
              adSpend: p.adSpendAmount,
            }))
          )
        }

        // 本期損益 — 使用本次查詢範圍的彙總，不再拿 30 天趨勢資料充當今日數字
        if (rangeMgmtSummaryData?.summary) {
          const s = rangeMgmtSummaryData.summary
          setWeeklyPnl({
            revenue: s.revenue,
            cost: s.estimatedCogs + s.operatingExpenses,
            grossProfit: s.grossProfit,
            grossMargin: s.grossMarginPct / 100,
            monthlyEarned: s.payoutNet,
          })
        }
      } catch (error: any) {
        if (!ignore) {
          message.error(error?.response?.data?.message || "讀取儀表板資料失敗");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchSummary();

    return () => {
      ignore = true;
    };
  }, [rangeMode, customRange, refreshToken]);

  // 財務快覽資料（API + mock fallback）
  useEffect(() => {
    const entityId = localStorage.getItem('entityId')?.trim() ?? ''

    const fetchFinance = async () => {
      try {
        const [arRes, apRes, bankRes] = await Promise.allSettled([
          fetch(`/api/ar/summary?entityId=${entityId}`).then((r) => r.json()),
          fetch(`/api/ap/summary?entityId=${entityId}`).then((r) => r.json()),
          fetch(`/api/banking/balance?entityId=${entityId}`).then((r) => r.json()),
        ])

        setFinance((prev) => ({
          arOutstanding: arRes.status === 'fulfilled' ? (arRes.value?.outstanding ?? prev.arOutstanding) : prev.arOutstanding,
          apOutstanding: apRes.status === 'fulfilled' ? (apRes.value?.outstanding ?? prev.apOutstanding) : prev.apOutstanding,
          inTransit: prev.inTransit, // from reconciliation endpoint
          bankBalance: bankRes.status === 'fulfilled' ? (bankRes.value?.balance ?? prev.bankBalance) : prev.bankBalance,
        }))
      } catch {
        // API 失敗時靜默保留上一次值（初始為 0）
      }
    }

    fetchFinance()
  }, [refreshToken])

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
        } 筆`,
      );
      setRefreshToken((prev) => prev + 1);
    } catch (error: any) {
      message.error(error?.response?.data?.message || "同步失敗，請稍後再試");
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncInvoiceStatuses = async () => {
    const storedEntityId = localStorage.getItem("entityId")?.trim();
    const { since, until } = resolveRange(rangeMode, DASHBOARD_TZ, customRange);
    setSyncingInvoiceStatuses(true);
    try {
      const result = await salesService.syncInvoiceStatusBatch({
        entityId: storedEntityId || "tw-entity-001",
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
    } catch (error: any) {
      message.error(error?.response?.data?.message || "同步發票狀態失敗");
    } finally {
      setSyncingInvoiceStatuses(false);
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  const performanceBuckets = overview?.buckets || [];
  const total = overview?.total;
  const tasks = executive?.tasks || [];
  const inventoryAlerts = executive?.inventoryAlerts || [];
  const anomalies = executive?.anomalies || [];
  const invoiceSummary = invoiceQueue?.summary;
  const invoiceItems = invoiceQueue?.items || [];
  const operationsHighlights = operationsHub?.highlights || [];
  const arSummary = receivableMonitor?.summary;
  const auditSummary = audit?.summary;
  const auditItems = audit?.items || [];
  const rangeLabel = getRangeModeLabel(rangeMode);
  const todayFinancial = todayManagementSummary?.summary;
  const rangeFinancial = rangeManagementSummary?.summary;
  const adConnector = connectorReadiness?.connectors.find((item) => item.key === "ad-spend") || null;
  const missingInvoiceCount =
    Number(invoiceSummary?.pendingCount || 0) + Number(invoiceSummary?.eligibleCount || 0);

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

  // ─── 通路貢獻（從真實 performanceBuckets 計算）──────────────
  const channelColorMap: [RegExp, string][] = [
    [/shopify/i, '#475569'],
    [/shopline/i, '#0f766e'],
    [/1shop|oneshop/i, '#4f46e5'],
    [/ecpay/i, '#6d28d9'],
    [/citiesocial/i, '#7e22ce'],
    [/pchome/i, '#1d4ed8'],
    [/momo/i, '#9f1239'],
    [/pinkoi/i, '#b45309'],
    [/line/i, '#166534'],
  ]
  const getChannelColor = (key: string): string => {
    for (const [re, color] of channelColorMap) {
      if (re.test(key)) return color
    }
    return '#adb5bd'
  }
  // 排除金流商（ECPay 是收款工具，不算銷售通路）
  const PAYMENT_GATEWAY_PATTERN = /ecpay|linepay|jkos|aftee|atome|spgateway|newebpay/i
  const platformContribs: PlatformContribution[] = performanceBuckets
    .filter(b => !PAYMENT_GATEWAY_PATTERN.test(b.key || ''))
    .map(b => ({
      platform: b.label,
      net: b.payoutNet,
      color: getChannelColor(b.key),
    }))
  const channelPieData = (() => {
    const sorted = platformContribs
      .filter((item) => item.net > 0)
      .sort((a, b) => b.net - a.net)
    const top = sorted.slice(0, 5)
    const other = sorted.slice(5).reduce((sum, item) => sum + item.net, 0)
    return other > 0
      ? [...top, { platform: "其他通路", net: other, color: "#94a3b8" }]
      : top
  })()
  const brandPieData = [
    { name: "MOZTECH", value: mOZtechData.payoutNet, color: "#475569" },
    { name: "BONSON", value: bonsonData.payoutNet, color: "#0f766e" },
    { name: "團購", value: teamData.payoutNet, color: "#4f46e5" },
  ].filter((item) => item.value > 0)

  // ─── 紅燈警示計數 ──────────────────────────────────────
  const criticalInventory = inventoryAlerts.filter(a => a.severity === 'critical').length;
  const criticalAnomalies = anomalies.filter(a => a.tone === 'critical').length;
  const overdueAR = arSummary?.overdueReceivableCount || 0;
  const overpaidAR = arSummary?.overpaidReceivableCount || 0;
  const overpaidARAmount = arSummary?.overpaidReceivableAmount || 0;
  const financialAuditIssueCount = auditSummary?.anomalousOrderCount || 0;
  const adSpendAmount = rangeFinancial?.adSpendAmount || 0;
  const adSpendCount = rangeFinancial?.adSpendCount || 0;
  const adSpendTracked = adSpendCount > 0;
  const adSpendConnectorIncomplete = adConnector?.status !== "ready";
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
    (adSpendConnectorIncomplete && !adSpendTracked ? 1 : 0);
  const criticalCount = criticalInventory + criticalAnomalies + overdueAR + overpaidAR;
  const financeOptionRows = [
    {
      key: "missing-invoices",
      title: "缺發票訂單",
      count: missingInvoiceCount,
      helper: "已付款或已對帳但尚未完成正式發票流程。",
      actionLabel: "處理缺發票",
      path: "/accounting/workbench?focus=missing-invoices",
      tone: missingInvoiceCount > 0 ? "warning" : "healthy",
    },
    {
      key: "order-audit",
      title: "訂單對帳稽核異常",
      count: financialAuditIssueCount,
      helper: "訂單、付款、發票、稅額或手續費口徑不一致的項目。",
      actionLabel: "看報表稽核",
      path: "/reports",
      tone: financialAuditIssueCount > 0 ? "warning" : "healthy",
    },
    {
      key: "overdue-ar",
      title: "逾期應收帳款",
      count: overdueAR,
      helper: "影響現金流的逾期 AR，需財務或業務追款。",
      actionLabel: "看應收帳款",
      path: "/sales/invoices",
      tone: overdueAR > 0 ? "critical" : "healthy",
    },
    {
      key: "overpaid",
      title: "超收 / 重複收款",
      count: overpaidAR,
      helper: "疑似重複匯入、合併收款未拆帳或退款折讓未反映。",
      actionLabel: "核對超收",
      path: "/sales/invoices?focus=overpaid",
      tone: overpaidAR > 0 ? "critical" : "healthy",
    },
    {
      key: "ad-spend",
      title: "廣告費串接",
      count: adSpendConnectorIncomplete && !adSpendTracked ? 1 : 0,
      helper: adSpendTracked
        ? "已有內部費用資料，後續可補 Meta / Google / TikTok 自動匯入。"
        : "尚缺廣告 API、帳戶 mapping、發票 / 收據與扣款來源。",
      actionLabel: "看串接準備",
      path: "/accounting/workbench?focus=connector-readiness",
      tone: adSpendConnectorIncomplete && !adSpendTracked ? "warning" : "healthy",
    },
  ];
  const riskPriorityRows = [
    {
      label: "待撥款 / 對帳",
      count: Number(executive?.operations.pendingPayoutCount || 0),
      color: "#dc2626",
      helper: "付款已進來但尚未完成撥款或對帳。",
      path: "/reconciliation/center",
    },
    {
      label: "手續費待補",
      count: Number(executive?.operations.feeBackfillCount || 0),
      color: "#ea580c",
      helper: "費率仍是預估或空白，會影響淨利判斷。",
      path: "/accounting/workbench",
    },
    {
      label: "缺發票",
      count: missingInvoiceCount,
      color: "#d97706",
      helper: "成交後仍未完成發票流程。",
      path: "/accounting/workbench?focus=missing-invoices",
    },
    {
      label: "稽核異常",
      count: financialAuditIssueCount,
      color: "#be123c",
      helper: "訂單、付款、發票或稅額有落差。",
      path: "/reports",
    },
    {
      label: "庫存警示",
      count: inventoryAlerts.length,
      color: "#0f766e",
      helper: "缺貨或低庫存會直接影響銷售。",
      path: "/inventory/products",
    },
    {
      label: "廣告串接",
      count: adSpendConnectorIncomplete && !adSpendTracked ? 1 : 0,
      color: "#4f46e5",
      helper: "廣告費尚未形成自動對帳鏈。",
      path: "/accounting/workbench?focus=connector-readiness",
    },
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

  return (
    <div className="page-section-stack page-section-stack--compact">
      {/* AI Insights Widget */}
      <AIInsightsWidget />

      {/* ── 頁面標題 + 篩選控制 ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Title level={2} className="!text-gray-800 font-light tracking-tight !mb-0">
              CEO 儀表板
            </Title>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-green" />
              <span className="text-xs font-medium text-green-600 uppercase tracking-wider">即時資料</span>
            </div>
          </div>
          <Text className="text-slate-400 text-sm">
            Moztech · Bonson · Moritek — 三品牌、三通路、財務一覽
          </Text>
        </div>
        <div className="flex flex-col sm:items-end gap-3 w-full sm:w-auto">
          <div className="flex flex-wrap justify-end gap-2 items-center">
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

      {/* ── 🚨 紅燈警示 ── */}
      {criticalCount > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 flex items-center gap-4">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-red-700">需要立刻處理：</span>
            <span className="ml-2 text-red-600">
              {criticalInventory > 0 && `${criticalInventory} 個商品斷貨　`}
              {overdueAR > 0 && `${overdueAR} 筆應收逾期　`}
              {overpaidAR > 0 && `${overpaidAR} 筆疑似超收 / 重複收款　`}
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
                <div className="mt-1 text-sm leading-6 text-slate-600">
                  本區間已收金額高於訂單應收，差額合計 {fmtMoney(overpaidARAmount)}。請到應收帳款頁查看付款列、payout batch 與 provider payment id。
                </div>
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
                <span className="font-semibold text-slate-900">缺發票訂單處理入口</span>
                <Tag color={missingInvoiceCount > 0 ? "gold" : "green"}>
                  {missingInvoiceCount > 0 ? `${missingInvoiceCount} 筆待處理` : "目前無待處理"}
                </Tag>
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-600">
                訂單明細仍在銷售訂單頁查看；補發票、同步綠界發票、匯入綠界銷項發票與後續入帳，統一到會計工作台處理。
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
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">CEO Control Tower</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">財務管制與營運風險</div>
            <div className="mt-1 text-sm text-slate-500">
              今日淨利、現金流壓力、廣告花費與需要財務追蹤的異常集中在這裡。
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button icon={<AlertOutlined />} onClick={() => setFinanceOptionsOpen(true)}>
              財務選項
            </Button>
            <Button icon={<LineChartOutlined />} onClick={() => navigate("/reconciliation/center")}>
              對帳中心
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className={`rounded-2xl border px-5 py-4 ${
            (todayFinancial?.netProfit || 0) < 0 ? "border-red-200 bg-red-50/70" : "border-emerald-100 bg-emerald-50/60"
          }`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
                <DollarOutlined />
              </div>
              <Tag color={(todayFinancial?.netProfit || 0) < 0 ? "red" : "green"}>今天</Tag>
            </div>
            <div className="text-xs text-slate-500">今天淨利</div>
            <div className={`mt-1 text-2xl font-bold ${
              (todayFinancial?.netProfit || 0) < 0 ? "text-red-700" : "text-slate-900"
            }`}>
              {fmtSignedMoney(todayFinancial?.netProfit || 0)}
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              營收 {fmtMoney(todayFinancial?.revenue || 0)} · 淨利率 {fmtPct(todayFinancial?.netMarginPct)}
            </div>
          </div>

          <div className={`rounded-2xl border px-5 py-4 ${
            adSpendConnectorIncomplete && !adSpendTracked ? "border-amber-200 bg-amber-50/70" : "border-slate-100 bg-white/60"
          }`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-indigo-700 shadow-sm">
                <CreditCardOutlined />
              </div>
              <Tag color={adSpendTracked ? "blue" : adSpendConnectorIncomplete ? "gold" : "green"}>
                {adSpendTracked ? "已入費用" : adSpendConnectorIncomplete ? "待串接" : "已設定"}
              </Tag>
            </div>
            <div className="text-xs text-slate-500">{rangeLabel}廣告花費</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {adSpendTracked ? fmtMoney(adSpendAmount) : "待串接"}
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              {adSpendTracked
                ? `${adSpendCount} 筆廣告相關費用；Meta / Google / TikTok API 仍可補自動化。`
                : adConnector?.nextAction || "請提供廣告平台 API、帳戶 mapping 與扣款來源。"}
            </div>
          </div>

          <div className={`rounded-2xl border px-5 py-4 ${
            cashRiskAmount > 0 ? "border-rose-200 bg-rose-50/70" : "border-slate-100 bg-white/60"
          }`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-rose-700 shadow-sm">
                <BankOutlined />
              </div>
              <Tag color={cashRiskAmount > 0 ? "red" : "green"}>現金流</Tag>
            </div>
            <div className="text-xs text-slate-500">現金流風險金額</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{fmtMoney(cashRiskAmount)}</div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              逾期 AR {overdueAR} 筆 · 超收 {overpaidAR} 筆 · 待付款費用 {fmtMoney(payableExposure)}
            </div>
          </div>

          <div className={`rounded-2xl border px-5 py-4 ${
            financeWatchCount > 0 ? "border-red-200 bg-red-50/70" : "border-slate-100 bg-white/60"
          }`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-red-700 shadow-sm">
                <WarningOutlined />
              </div>
              <Tag color={financeWatchCount > 0 ? "red" : "green"}>
                {financeWatchCount > 0 ? "需追蹤" : "正常"}
              </Tag>
            </div>
            <div className="text-xs text-slate-500">財務異常追蹤</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{financeWatchCount} 項</div>
            <div className="mt-2 text-xs leading-5 text-slate-500">
              缺發票 {missingInvoiceCount} · 訂單稽核 {financialAuditIssueCount} · 廣告串接 {adSpendConnectorIncomplete && !adSpendTracked ? "待補" : "可追"}
            </div>
          </div>
        </div>
      </div>

      {/* ── CEO 快速圖表：趨勢、占比、風險 ── */}
      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.85fr]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">CEO Trend</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">30 天關鍵趨勢</div>
              <div className="mt-1 text-sm text-slate-500">
                同時看營收、淨利、淨入帳與廣告費，快速判斷成長是否真的變成現金。
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Tag color="default">營收</Tag>
              <Tag color="green">淨利</Tag>
              <Tag color="blue">淨入帳</Tag>
              <Tag color="gold">廣告費</Tag>
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
                  <linearGradient id="ceoProfitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ceoCashGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => fmtCompact(Number(v))} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [fmtMoney(Number(value)), name]}
                  contentStyle={{ borderRadius: "10px", border: "1px solid rgba(0,0,0,0.08)", fontSize: "12px" }} />
                <Area type="monotone" dataKey="revenue" stroke="#475569" strokeWidth={2} fill="url(#ceoRevenueGrad)" name="營收" />
                <Area type="monotone" dataKey="netProfit" stroke="#16a34a" strokeWidth={2} fill="url(#ceoProfitGrad)" name="淨利" />
                <Area type="monotone" dataKey="payoutNet" stroke="#2563eb" strokeWidth={2} fill="url(#ceoCashGrad)" name="淨入帳" />
                <Area type="monotone" dataKey="adSpend" stroke="#d97706" strokeWidth={2} fill="transparent" name="廣告費" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">
              尚無足夠趨勢資料
            </div>
          )}
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Revenue Mix</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">錢從哪裡來</div>
              </div>
              <Tag className="rounded-full bg-slate-100 text-slate-500 border-slate-200 text-xs">淨入帳占比</Tag>
            </div>
            {channelPieData.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-[160px_1fr] xl:grid-cols-[150px_1fr]">
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={channelPieData as any[]} dataKey="net" nameKey="platform" innerRadius={48} outerRadius={70} paddingAngle={2}>
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
                尚無通路淨入帳資料
              </div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Brand Mix</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">品牌現金貢獻</div>
              </div>
            </div>
            {brandPieData.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={brandPieData as any[]} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={2}>
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
                尚無品牌淨入帳資料
              </div>
            )}
          </motion.div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Risk Priority</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">現在最需要注意的事</div>
              <div className="mt-1 text-sm text-slate-500">依數量排序，CEO 先看最大阻塞，再交給財務或營運往下處理。</div>
            </div>
            <Button size="small" onClick={() => setFinanceOptionsOpen(true)}>展開財務選項</Button>
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
                    <div className="mt-1 text-xs leading-5 text-slate-500">{item.helper}</div>
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
          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Exception Aging</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">異常拖多久了</div>
            <div className="mt-1 text-sm text-slate-500">以缺發票與對帳異常樣本估算，越紅代表越不能再拖。</div>
          </div>
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

      {/* ── 核心 KPI（4 張，全部真實資料）── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: '本期總業績',
            value: fmtMoney(total?.gross ?? 0),
            sub: `${total?.orderCount ?? 0} 筆訂單`,
            icon: <ShoppingOutlined className="text-slate-500 text-lg" />,
            accent: 'border-l-slate-500',
            alert: false,
          },
          {
            label: '本期淨入帳',
            value: fmtMoney(total?.payoutNet ?? 0),
            sub: `手續費 ${fmtMoney(total?.feeTotal ?? 0)}`,
            icon: <RiseOutlined className="text-teal-600 text-lg" />,
            accent: 'border-l-teal-500',
            alert: false,
          },
          {
            label: '逾期應收帳款',
            value: fmtMoney(arSummary?.overdueReceivableAmount ?? arSummary?.outstandingAmount ?? 0),
            sub: `${overdueAR} 筆逾期`,
            icon: <FallOutlined className="text-rose-500 text-lg" />,
            accent: overdueAR > 0 ? 'border-l-rose-500' : 'border-l-slate-200',
            alert: overdueAR > 0,
          },
          {
            label: '超收 / 重複收款',
            value: fmtMoney(overpaidARAmount),
            sub: `${overpaidAR} 筆需核對`,
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
              gradient: 'from-slate-700 to-slate-900',
            },
            {
              brand: 'Bonson 邦生', sub: '居家 / 清潔 / 戶外 · Shopline',
              gross: bonsonData.gross, orders: bonsonData.orderCount, net: bonsonData.payoutNet,
              gradient: 'from-teal-700 to-teal-900',
            },
            {
              brand: 'KOL 團購 (1Shop)', sub: 'Moztech + Bonson · 網紅通路',
              gross: teamData.gross, orders: teamData.orderCount, net: teamData.payoutNet,
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
                  <div className="mt-1 text-base font-bold text-slate-800">{fmtMoney(b.gross)}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs text-slate-400">訂單數</div>
                  <div className="mt-1 text-base font-bold text-slate-800">{b.orders}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs text-slate-400">淨入帳</div>
                  <div className="mt-1 text-base font-bold text-teal-700">{fmtMoney(b.net)}</div>
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
                  <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `${(v / 10000).toFixed(0)}萬`} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [fmtMoney(value), name === 'revenue' ? '營收' : '毛利']}
                  contentStyle={{ borderRadius: '10px', border: '1px solid rgba(0,0,0,0.08)', fontSize: '12px' }} />
                <Area type="monotone" dataKey="revenue" stroke="#475569" strokeWidth={2} fill="url(#revGrad)" name="revenue" />
                <Area type="monotone" dataKey="profit" stroke="#0d9488" strokeWidth={2} fill="url(#profGrad)" name="profit" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-sm text-slate-400">
              資料讀取中…
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 mb-1">P&L Snapshot</div>
          <div className="text-lg font-semibold text-slate-900 mb-4">損益快照</div>
          {weeklyPnl.revenue > 0 ? (
            <div className="space-y-3">
              {[
                { label: '區間營收', value: weeklyPnl.revenue, color: 'text-slate-800' },
                { label: '估算成本', value: weeklyPnl.cost, color: 'text-rose-600' },
                { label: '毛利', value: weeklyPnl.grossProfit, color: 'text-teal-700' },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-500">{row.label}</span>
                  <span className={`font-bold text-sm ${row.color}`}>{fmtMoney(row.value)}</span>
                </div>
              ))}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5 text-xs text-slate-500">
                  <span>毛利率</span>
                  <span className="font-semibold text-slate-700">{(weeklyPnl.grossMargin * 100).toFixed(1)}%</span>
                </div>
                <Progress percent={Math.round(weeklyPnl.grossMargin * 100)} strokeColor="#0d9488"
                  trailColor="rgba(0,0,0,0.06)" size="small" showInfo={false} />
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 mt-1">
                <div className="text-xs text-slate-400 mb-0.5">淨入帳（實賺）</div>
                <div className="text-lg font-bold text-slate-900">{fmtMoney(weeklyPnl.monthlyEarned)}</div>
              </div>
            </div>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-sm text-slate-400">
              請選擇日期範圍
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

      {/* ── 庫存警示（有才顯示）── */}
      {inventoryAlerts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Inventory Alert</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
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
                ✓ 目前沒有異常
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
                ✓ 目前沒有待辦事項
              </div>
            )}
          </div>
        </div>
      </div>

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
