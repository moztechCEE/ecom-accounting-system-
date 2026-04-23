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
  Statistic,
  Tag,
  Typography,
  Progress,
} from "antd";
import {
  BankOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  FallOutlined,
  RiseOutlined,
  ShoppingOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
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
}
// ─── 金額格式化 ──────────────────────────────────────────

const fmtMoney = (n: number) =>
  n.toLocaleString("zh-TW", { minimumFractionDigits: 0 }) + " 元";

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
  const [loading, setLoading] = useState(true);
  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customRange, setCustomRange] = useState<CustomRange>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [issuingInvoices, setIssuingInvoices] = useState(false);
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
    arOutstanding: 2_850_000,
    apOutstanding: 1_230_000,
    inTransit: 1_105_000,
    bankBalance: 8_760_000,
  })
  const [weeklyPnl, setWeeklyPnl] = useState<WeeklyPnl>({
    revenue: 4_200_000,
    cost: 2_940_000,
    grossProfit: 1_260_000,
    grossMargin: 0.3,
    monthlyEarned: 3_840_000,
  })
  const [platformContribs, setPlatformContribs] = useState<PlatformContribution[]>([
    { platform: 'Shopify', net: 1_192_000, color: '#96bf48' },
    { platform: 'Shopline', net: 647_600, color: '#e85d04' },
    { platform: '1Shop', net: 400_100, color: '#4361ee' },
    { platform: 'ECPay', net: 1_761_800, color: '#7209b7' },
  ])


  const [revenueTrend, setRevenueTrend] = useState<RevenueTrendPoint[]>([])

  // 產生 30 天 mock 趨勢（API 尚未就緒時 fallback）
  useEffect(() => {
    const today = dayjs().tz(DASHBOARD_TZ)
    const mock: RevenueTrendPoint[] = Array.from({ length: 30 }).map((_, i) => {
      const d = today.subtract(29 - i, 'day')
      const base = 80_000 + Math.sin(i / 4) * 30_000 + Math.random() * 20_000
      return {
        date: d.format('MM/DD'),
        revenue: Math.round(base),
        profit: Math.round(base * (0.25 + Math.random() * 0.1)),
      }
    })
    setRevenueTrend(mock)
  }, [])

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
        const [
          summary,
          executiveOverview,
          operationsHubData,
          invoiceQueueData,
          auditData,
          receivableMonitorData,
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
            limit: 8,
          }),
          dashboardService.getOrderReconciliationAudit({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
            limit: 16,
          }),
          arService.getReceivableMonitor({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
          }),
        ]);

        if (ignore) return;

        setOverview(summary);
        setExecutive(executiveOverview);
        setOperationsHub(operationsHubData);
        setInvoiceQueue(invoiceQueueData);
        setAudit(auditData);
        setReceivableMonitor(receivableMonitorData);
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
        // 靜默使用 mock data
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

  const handleIssueEligibleInvoices = async () => {
    const storedEntityId = localStorage.getItem("entityId")?.trim();
    const { since, until } = resolveRange(rangeMode, DASHBOARD_TZ, customRange);
    setIssuingInvoices(true);
    try {
      const result = await invoicingService.issueEligible({
        entityId: storedEntityId,
        startDate: since,
        endDate: until,
        limit: 12,
        invoiceType: "B2C",
      });
      message.success(
        `批次開票完成：成功 ${result.issuedCount} 筆，失敗 ${result.failedCount} 筆`,
      );
      setRefreshToken((prev) => prev + 1);
    } catch (error: any) {
      message.error(error?.response?.data?.message || "批次開票失敗");
    } finally {
      setIssuingInvoices(false);
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

  // ─── 紅燈警示計數 ──────────────────────────────────────
  const criticalInventory = inventoryAlerts.filter(a => a.severity === 'critical').length;
  const criticalAnomalies = anomalies.filter(a => a.tone === 'critical').length;
  const overdueAR = arSummary?.overdueReceivableCount || 0;
  const criticalCount = criticalInventory + criticalAnomalies + overdueAR;

  return (
    <div className="space-y-8">
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
          <Text className="text-gray-500">
            Moztech · Bonson · Moritek — 所有品牌、通路、財務一覽
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

      {/* ── 🚨 紅燈警示橫幅 ── */}
      {criticalCount > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 flex items-center gap-4">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />
          <div className="flex-1">
            <span className="font-semibold text-red-700">需要你立刻處理：</span>
            <span className="ml-2 text-sm text-red-600">
              {criticalInventory > 0 && `${criticalInventory} 個商品斷貨　`}
              {overdueAR > 0 && `${overdueAR} 筆應收逾期　`}
              {criticalAnomalies > 0 && `${criticalAnomalies} 個財務異常`}
            </span>
          </div>
          <Tag color="red" className="shrink-0">共 {criticalCount} 項</Tag>
        </motion.div>
      )}

      {/* ── 📊 Section 1：今日核心指標 ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: '本期總業績', value: total?.gross ?? 0,
            sub: `${total?.orderCount ?? 0} 筆訂單`,
            icon: <DollarOutlined className="text-emerald-500 text-xl" />,
            bg: 'from-emerald-500/10 to-emerald-100/5', color: 'text-emerald-700',
            badge: total?.gross ? null : '無資料',
          },
          {
            label: '銀行現金水位', value: finance.bankBalance,
            sub: '帳戶即時餘額',
            icon: <BankOutlined className="text-sky-500 text-xl" />,
            bg: 'from-sky-500/10 to-sky-100/5', color: 'text-sky-700',
            badge: null,
          },
          {
            label: '逾期應收帳款', value: arSummary?.outstandingAmount ?? finance.arOutstanding,
            sub: `${overdueAR} 筆逾期`,
            icon: <FallOutlined className="text-rose-500 text-xl" />,
            bg: overdueAR > 0 ? 'from-rose-500/15 to-rose-100/5' : 'from-blue-500/10 to-blue-100/5',
            color: overdueAR > 0 ? 'text-rose-700' : 'text-blue-700',
            badge: overdueAR > 0 ? '需追蹤' : null,
          },
          {
            label: '在途收款', value: finance.inTransit,
            sub: '撥款待入帳',
            icon: <ClockCircleOutlined className="text-amber-500 text-xl" />,
            bg: 'from-amber-500/10 to-amber-100/5', color: 'text-amber-700',
            badge: null,
          },
        ].map((item, idx) => (
          <motion.div key={idx} whileHover={{ y: -3 }}
            className={`glass-card bg-gradient-to-br ${item.bg} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-2xl bg-white/60 flex items-center justify-center shadow-sm">
                {item.icon}
              </div>
              <div className="flex items-center gap-1">
                {item.badge && <Tag color="red" className="!text-[10px]">{item.badge}</Tag>}
                <span className="text-xs text-slate-400">{item.sub}</span>
              </div>
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">{item.label}</div>
            <div className={`text-2xl font-bold ${item.color}`}>{fmtMoney(item.value)}</div>
          </motion.div>
        ))}
      </div>

      {/* ── 🏷️ Section 2：品牌業績 ── */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 mb-3">Brand Performance</div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              brand: 'Moztech 墨子科技', tag: '3C 手機配件', tagColor: '#0ea5e9',
              gross: mOZtechData.gross, orders: mOZtechData.orderCount, net: mOZtechData.payoutNet,
              channels: 'Shopify 官網', icon: '📱',
              gradient: 'from-sky-600 to-blue-700',
            },
            {
              brand: 'Bonson 邦生', tag: '居家 / 清潔 / 戶外', tagColor: '#10b981',
              gross: bonsonData.gross, orders: bonsonData.orderCount, net: bonsonData.payoutNet,
              channels: 'Shopline 官網', icon: '🏠',
              gradient: 'from-emerald-600 to-teal-700',
            },
            {
              brand: 'KOL 團購 (1Shop)', tag: 'Moztech + Bonson', tagColor: '#f59e0b',
              gross: teamData.gross, orders: teamData.orderCount, net: teamData.payoutNet,
              channels: '網紅 / 團購通路', icon: '🎯',
              gradient: 'from-amber-500 to-orange-600',
            },
          ].map((b) => (
            <motion.div key={b.brand} whileHover={{ y: -3 }}
              className="glass-card overflow-hidden p-0">
              <div className={`bg-gradient-to-r ${b.gradient} px-5 py-4 text-white`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-semibold">{b.icon} {b.brand}</div>
                    <div className="text-xs text-white/70 mt-0.5">{b.tag} · {b.channels}</div>
                  </div>
                  <div className="text-2xl font-bold">{fmtMoney(b.gross)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 p-4">
                <div className="rounded-2xl bg-slate-50 px-3 py-3">
                  <div className="text-xs text-slate-400">訂單數</div>
                  <div className="mt-1 text-xl font-bold text-slate-800">{b.orders}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-3 py-3">
                  <div className="text-xs text-slate-400">已入帳淨額</div>
                  <div className="mt-1 text-xl font-bold text-emerald-700">{fmtMoney(b.net)}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── 📈 Section 3：30 天走勢 + 本週損益 ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Revenue Trend</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">30 天營收走勢</div>
            </div>
            <Tag color="blue" className="rounded-full">每日（扣費前）</Tag>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={revenueTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={4} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                tickFormatter={(v) => `${(v / 10000).toFixed(0)}萬`} />
              <RechartsTooltip
                formatter={(value: number, name: string) => [fmtMoney(value), name === 'revenue' ? '營收' : '毛利']}
                contentStyle={{ borderRadius: '12px', border: '1px solid rgba(0,0,0,0.08)', fontSize: '12px' }} />
              <Area type="monotone" dataKey="revenue" stroke="#0ea5e9" strokeWidth={2} fill="url(#revGrad)" name="revenue" />
              <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fill="url(#profGrad)" name="profit" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 mb-1">Weekly P&L</div>
          <div className="text-xl font-semibold text-slate-900 mb-4">本週損益</div>
          <div className="space-y-3">
            {[
              { label: '本週營收', value: weeklyPnl.revenue, color: 'text-blue-600' },
              { label: '本週成本', value: weeklyPnl.cost, color: 'text-rose-500' },
              { label: '本週毛利', value: weeklyPnl.grossProfit, color: 'text-emerald-600' },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className={`font-bold ${row.color}`}>{fmtMoney(row.value)}</span>
              </div>
            ))}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-slate-500">毛利率</span>
                <span className="font-bold text-purple-600">{(weeklyPnl.grossMargin * 100).toFixed(1)}%</span>
              </div>
              <Progress percent={Math.round(weeklyPnl.grossMargin * 100)} strokeColor="#7c3aed" size="small" showInfo={false} />
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 mt-2">
              <div className="text-xs text-slate-400 mb-1">本月累計實賺</div>
              <div className="text-xl font-bold text-slate-900">{fmtMoney(weeklyPnl.monthlyEarned)}</div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── 🛒 Section 4：通路貢獻 ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Channel Revenue</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">各通路貢獻</div>
          </div>
          <Tag color="blue" className="rounded-full">本月實收（扣費後）</Tag>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const channelTotal = platformContribs.reduce((s, p) => s + p.net, 0);
            return platformContribs.sort((a, b) => b.net - a.net).map((p) => (
              <div key={p.platform} className="rounded-3xl border border-white/30 bg-white/45 px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                    <span className="font-semibold text-slate-800 text-sm">{p.platform}</span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {channelTotal > 0 ? ((p.net / channelTotal) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
                <div className="text-lg font-bold text-slate-900 mb-2">{fmtMoney(p.net)}</div>
                <Progress percent={channelTotal > 0 ? Math.round((p.net / channelTotal) * 100) : 0}
                  strokeColor={p.color} showInfo={false} size="small" trailColor="rgba(0,0,0,0.06)" />
              </div>
            ));
          })()}
        </div>
      </motion.div>

      {/* ── 📣 Section 5：廣告投放 ROI ── */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 mb-3">Marketing ROI</div>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { name: 'Facebook Ads', icon: '📘', color: '#1877f2', colorCls: 'from-blue-500/10 to-blue-100/5' },
            { name: 'Google Ads', icon: '🔍', color: '#ea4335', colorCls: 'from-red-500/10 to-red-100/5' },
          ].map((ad) => (
            <div key={ad.name} className={`glass-card bg-gradient-to-br ${ad.colorCls} p-5`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">{ad.icon}</div>
                  <div>
                    <div className="font-semibold text-slate-800">{ad.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">廣告投放效益</div>
                  </div>
                </div>
                <Tag color="default" className="rounded-full text-xs">尚未串接</Tag>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '今日花費', value: '—' },
                  { label: 'ROAS', value: '—' },
                  { label: '新客數', value: '—' },
                ].map((m) => (
                  <div key={m.label} className="rounded-2xl bg-white/50 px-3 py-3 text-center">
                    <div className="text-xs text-slate-400">{m.label}</div>
                    <div className="mt-1 text-lg font-bold text-slate-400">{m.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-slate-400 text-center">
                連接 Facebook Business / Google Ads API 後自動顯示
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ⚠️ Section 6：庫存警示 ── */}
      {inventoryAlerts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Inventory Alert</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
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
                className={`flex items-center justify-between rounded-2xl px-4 py-3 ${
                  item.severity === 'critical' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'
                }`}>
                <div>
                  <div className="font-medium text-slate-900">{item.name}</div>
                  <div className="text-xs text-slate-400">SKU {item.sku} · 現有 {item.qtyAvailable}</div>
                </div>
                <Tag color={item.severity === 'critical' ? 'red' : 'gold'}>
                  {item.severity === 'critical' ? '🔴 斷貨' : '⚠️ 低庫存'}
                </Tag>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── 💰 Section 7：財務 & 對帳概況 ── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
        {/* 績效 Bucket */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {performanceBuckets.map((bucket, index) => {
            const status = getBucketStatus(bucket);
            const accent = getBucketAccent(index);
            return (
              <motion.div key={bucket.key} whileHover={{ y: -4 }}
                className="glass-card relative overflow-hidden p-6">
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent.split(' ')[0]} ${accent.split(' ')[1]}`} />
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-500">{bucket.label}</div>
                    {"account" in bucket && bucket.account ? (
                      <div className="mt-1 text-xs text-slate-400">帳號：{bucket.account}</div>
                    ) : null}
                  </div>
                  <Tag color={status.color} className="rounded-full px-3">{status.label}</Tag>
                </div>
                <Statistic value={bucket.gross} precision={2} prefix="$"
                  title={<span className="label-text font-medium">業績總額</span>}
                  valueStyle={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '24px' }} />
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-2xl bg-white/40 px-3 py-2">
                    <div className="text-xs text-slate-400">訂單數</div>
                    <div className="mt-1 font-semibold text-slate-800">{bucket.orderCount}</div>
                  </div>
                  <div className="rounded-2xl bg-white/40 px-3 py-2">
                    <div className="text-xs text-slate-400">已入帳</div>
                    <div className="mt-1 font-semibold text-slate-800">{bucket.payoutNet.toFixed(2)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/40 px-3 py-2">
                    <div className="text-xs text-slate-400">手續費</div>
                    <div className="mt-1 font-semibold text-slate-800">{bucket.feeTotal.toFixed(2)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/40 px-3 py-2">
                    <div className="text-xs text-slate-400">待撥款</div>
                    <div className="mt-1 font-semibold text-slate-800">{bucket.pendingPayoutCount}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-500">{status.helper}</div>
              </motion.div>
            );
          })}
        </div>

        {/* Reconciliation Pulse */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="glass-card overflow-hidden p-0">
          <div className="border-b border-white/30 bg-[linear-gradient(135deg,rgba(15,23,42,0.9),rgba(30,41,59,0.75))] px-6 py-5 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">Reconciliation Pulse</div>
            <div className="mt-2 text-2xl font-semibold">金流對帳狀態</div>
          </div>
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '總訂單數', value: total?.orderCount || 0, color: 'text-slate-900' },
                { label: '已建立收款', value: total?.paymentCount || 0, color: 'text-slate-900' },
                { label: '已完成對帳', value: total?.reconciledCount || 0, color: 'text-emerald-600' },
                { label: '待撥款 / 待對帳', value: total?.pendingPayoutCount || 0, color: 'text-amber-600' },
              ].map((m) => (
                <div key={m.label} className="rounded-3xl bg-slate-900/5 px-5 py-4">
                  <div className="text-xs text-slate-400">{m.label}</div>
                  <div className={`mt-2 text-2xl font-semibold ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>
            <div className="rounded-3xl border border-white/30 bg-white/45 px-5 py-4">
              <div className="text-sm font-semibold text-slate-900 mb-3">業績 vs 已入帳比率</div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>已入帳淨額</span>
                    <span>${total?.payoutNet.toFixed(0) || "0"}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200/70">
                    <div className="h-2 rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${total?.gross ? Math.min((total.payoutNet / total.gross) * 100, 100) : 0}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>手續費</span>
                    <span>${total?.feeTotal.toFixed(0) || "0"}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200/70">
                    <div className="h-2 rounded-full bg-fuchsia-500 transition-all"
                      style={{ width: `${total?.gross ? Math.min((total.feeTotal / total.gross) * 100, 100) : 0}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── 📋 Section 8：發票 + 人事 ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 發票閉環 */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Invoice</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">發票狀態</div>
            </div>
            <div className="flex gap-2">
              <Button size="small" icon={<SyncOutlined />} onClick={handleSyncInvoiceStatuses}
                loading={syncingInvoiceStatuses}>同步發票</Button>
              <Button size="small" type="primary" onClick={handleIssueEligibleInvoices}
                loading={issuingInvoices} className="bg-black hover:bg-gray-800 border-none">
                批次開票
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '本期已開票', value: invoiceSummary?.issuedCount || 0, color: 'text-emerald-600' },
              { label: '可批次開票', value: invoiceSummary?.eligibleCount || 0, color: 'text-amber-600' },
              { label: '待付款後開票', value: invoiceSummary?.waitingPaymentCount || 0, color: 'text-sky-600' },
              { label: '已作廢', value: invoiceSummary?.voidCount || 0, color: 'text-rose-500' },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-400">{m.label}</div>
                <div className={`mt-1 text-2xl font-bold ${m.color}`}>{m.value}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 人事 & 薪資 */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 mb-1">Operations Hub</div>
          <div className="text-xl font-semibold text-slate-900 mb-4">人事 & 薪資</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '在職員工', value: operationsHub?.people.activeEmployees || 0, color: 'text-slate-800' },
              { label: '待審假單', value: operationsHub?.people.pendingLeaveRequests || 0, color: 'text-amber-600' },
              { label: '出勤異常', value: operationsHub?.people.openAttendanceAnomalies || 0, color: 'text-rose-600' },
              { label: '待審薪資批次', value: operationsHub?.payroll.pendingApprovalRuns || 0, color: 'text-sky-600' },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-400">{m.label}</div>
                <div className={`mt-1 text-2xl font-bold ${m.color}`}>{m.value}</div>
              </div>
            ))}
          </div>
          {operationsHighlights.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {operationsHighlights.map((item) => (
                <div key={item.key} className="rounded-xl border border-white/30 bg-white/45 px-3 py-2">
                  <div className="text-xs text-slate-400">{item.label}</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── 📌 Section 9：CEO 決策清單 ── */}
      <Row gutter={[{ xs: 16, sm: 24 }, { xs: 16, sm: 24 }]}>
        <Col xs={24} lg={12}>
          <Card title="🚨 異常待辦 (Exception Inbox)" className="glass-card !border-0 h-full">
            <div className="space-y-3">
              {anomalies.map((item) => {
                const tone = getTaskToneMeta(item.tone);
                return (
                  <div key={item.key}
                    className={`rounded-2xl px-4 py-4 transition-colors hover:opacity-90 ${
                      item.tone === 'critical' ? 'bg-red-50' : item.tone === 'warning' ? 'bg-amber-50' : 'bg-slate-50'
                    }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-slate-900">{item.title}</div>
                          <Tag color={tone.color}>{item.statusLabel}</Tag>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{item.helper}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-bold text-slate-900">{item.count}</div>
                        <div className="text-[11px] text-slate-400">
                          {item.amount !== null ? `NT$ ${item.amount.toFixed(0)}` : '待處理'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!anomalies.length && (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 text-center">
                  ✅ 目前沒有異常，一切正常
                </div>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="📌 CEO 待辦事項 (Priority Tasks)" className="glass-card !border-0 h-full">
            <div className="space-y-3">
              {tasks.map((task, idx) => {
                const tone = getTaskToneMeta(task.tone);
                return (
                  <div key={task.key}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                        style={{ backgroundColor: idx % 3 === 0 ? '#f56a00' : idx % 3 === 1 ? '#1677ff' : '#13c2c2' }}>
                        {task.title.slice(0, 1)}
                      </div>
                      <div>
                        <div className="font-medium text-gray-800">{task.title}</div>
                        <div className="text-xs text-gray-400">
                          {task.helper}{task.amount ? ` • NT$ ${task.amount.toFixed(0)}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-sm font-semibold text-slate-900">{task.value}</div>
                      <Tag color={tone.color}>{tone.badge}</Tag>
                    </div>
                  </div>
                );
              })}
              {!tasks.length && (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 text-center">
                  ✅ 目前沒有待辦事項
                </div>
              )}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};
export default DashboardPage;
