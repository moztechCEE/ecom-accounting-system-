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

function getRuleStatusMeta(status: "active" | "monitoring" | "pending") {
  switch (status) {
    case "monitoring":
      return { color: "gold" as const, badge: "持續監控" };
    case "pending":
      return { color: "blue" as const, badge: "待補齊" };
    default:
      return { color: "green" as const, badge: "已啟用" };
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
  const accountingAutomationSteps = [
    {
      title: "訂單成立",
      status: "自動建立應收",
      detail: "Shopify、1Shop、Shopline 進來後先統一成 SalesOrder，應收帳款留在 1191。",
      account: "借 1191；貸 4111 / 2194",
    },
    {
      title: "付款完成",
      status: "等待撥款",
      detail: "Payment 紀錄付款方式、金額與通路，尚未看到撥款前不直接當成銀行入帳。",
      account: "仍留 1191",
    },
    {
      title: "綠界撥款",
      status: "回填實際費用",
      detail: "用綠界撥款列匹配訂單/交易，回填金流手續費、平台手續費與實收淨額。",
      account: "借 1113 / 6131 / 6134；貸 1191",
    },
    {
      title: "發票與核銷",
      status: "自動完成閉環",
      detail: "客戶發票接 AR，綠界服務費發票接 AP，異常才丟給會計工作台。",
      account: "AR / AP / 分錄審核",
    },
  ];
  const feeSourcePolicies = [
    {
      platform: "Shopify",
      status: "可自動抓取較完整",
      detail: "Shopify transaction / payout 可提供平台交易費；綠界信用卡金流費仍以綠界撥款資料回填為準。",
      tone: "green" as const,
    },
    {
      platform: "1Shop",
      status: "需用綠界撥款補實際費用",
      detail: "1Shop API 目前偏訂單/交易匯出，平台抽成若 API 沒提供，就標記待補，改用綠界撥款、服務費發票或匯出檔核對。",
      tone: "gold" as const,
    },
    {
      platform: "Shopline",
      status: "先接訂單，再接付款/撥款來源",
      detail: "Shopline 訂單與顧客可先進系統；平台費與金流費需等付款/撥款報表或 API 欄位確認後納入自動核銷。",
      tone: "blue" as const,
    },
    {
      platform: "綠界",
      status: "金流手續費的最終依據",
      detail: "實際有沒有撥款、扣多少手續費、淨收多少，以綠界撥款/對帳資料和服務費發票做最後閉環。",
      tone: "purple" as const,
    },
  ];

  return (
    <div className="space-y-10">
      {/* AI Insights Widget */}
      <AIInsightsWidget />

      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Title
              level={2}
              className="!text-gray-800 font-light tracking-tight !mb-0"
            >
              Dashboard
            </Title>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-green"></div>
              <span className="text-xs font-medium text-green-600 uppercase tracking-wider">
                Live Updates
              </span>
            </div>
          </div>
          <Text className="text-gray-500">
            歡迎回來，管理員。這是您今天的財務健康概況。
          </Text>
        </div>
        <div className="flex flex-col sm:items-end gap-3 w-full sm:w-auto">
          <div className="flex flex-wrap justify-end gap-2 items-center">
            <Radio.Group
              value={rangeMode}
              onChange={(e) => {
                const nextMode = e.target.value as RangeMode;
                setRangeMode(nextMode);
                if (
                  nextMode === "custom" &&
                  (!customRange?.[0] || !customRange?.[1])
                ) {
                  message.info("請選擇自訂日期區間");
                }
              }}
              className="shadow-sm"
            >
              <Radio.Button value="today">今天</Radio.Button>
              <Radio.Button value="yesterday">昨天</Radio.Button>
              <Radio.Button value="last7d">最近 7 天</Radio.Button>
              <Radio.Button value="all">全部期間</Radio.Button>
              <Radio.Button value="custom">自訂</Radio.Button>
            </Radio.Group>

            <Button
              type="primary"
              icon={<SyncOutlined spin={syncing} />}
              loading={syncing}
              onClick={handleManualSync}
              className="bg-black hover:bg-gray-800 border-none shadow-sm"
            >
              {syncing ? "同步中..." : "即時同步"}
            </Button>
          </div>

          {rangeMode === "custom" && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full sm:w-auto"
            >
              <RangePicker
                value={customRange}
                onChange={handleCustomRangeChange}
                format="YYYY/MM/DD"
                allowClear
                className="w-full shadow-sm"
                placeholder={["開始日期", "結束日期"]}
              />
            </motion.div>
          )}

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
            System Status: Operational
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.95fr)]"
      >
        <div className="glass-card overflow-hidden p-0">
          <div className="bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.82),rgba(56,189,248,0.18))] px-7 py-7 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-white/55">
              CEO Overview
            </div>
            <div className="mt-3 text-5xl font-semibold tracking-tight sm:text-6xl xl:text-7xl">
              ${total?.gross.toFixed(2) || "0.00"}
            </div>
            <div className="mt-2 text-sm text-white/72">
              這是目前選定區間內的總業績，下面同步看已入帳、支出與關鍵待辦。
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-white/8 px-4 py-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/55">
                  <DollarOutlined />
                  已入帳
                </div>
                <div className="mt-3 text-2xl font-semibold">
                  ${total?.payoutNet.toFixed(2) || "0.00"}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/8 px-4 py-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/55">
                  <BankOutlined />
                  經費支出
                </div>
                <div className="mt-3 text-2xl font-semibold">
                  ${executive?.expenses.actualSpend.toFixed(2) || "0.00"}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/8 px-4 py-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/55">
                  <ShoppingOutlined />
                  關鍵待辦
                </div>
                <div className="mt-3 text-2xl font-semibold">
                  {executive?.operations.openAnomalyCount || 0}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            CEO Snapshot
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">
            業績、花費與營運風險
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
              <div className="text-xs text-slate-400">待撥款 / 待對帳</div>
              <div className="mt-2 text-2xl font-semibold text-amber-600">
                {executive?.operations.pendingPayoutCount || 0}
              </div>
            </div>
            <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
              <div className="text-xs text-slate-400">待補實際費率</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {executive?.operations.feeBackfillCount || 0}
              </div>
            </div>
            <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
              <div className="text-xs text-slate-400">已對帳未落帳</div>
              <div className="mt-2 text-2xl font-semibold text-sky-600">
                {executive?.operations.missingPayoutJournalCount || 0}
              </div>
            </div>
            <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
              <div className="text-xs text-slate-400">綠界服務費發票</div>
              <div className="mt-2 text-2xl font-semibold text-violet-600">
                {executive?.operations.ecpayServiceFeeInvoiceCount || 0}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                待核對 {executive?.operations.ecpayServiceFeeInvoicePendingCount || 0}
              </div>
            </div>
            <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
              <div className="text-xs text-slate-400">庫存警示</div>
              <div className="mt-2 text-2xl font-semibold text-rose-600">
                {executive?.operations.inventoryAlertCount || 0}
              </div>
            </div>
            <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
              <div className="text-xs text-slate-400">應收未收</div>
              <div className="mt-2 text-2xl font-semibold text-red-600">
                {arSummary?.outstandingOrderCount || 0}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                NT$ {(arSummary?.outstandingAmount || 0).toFixed(0)}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-3xl border border-white/30 bg-white/45 px-4 py-4 text-sm text-slate-600">
            本期經費支出
            <span className="ml-2 font-semibold text-slate-900">
              ${executive?.expenses.actualSpend.toFixed(2) || "0.00"}
            </span>
            ，綠界服務費發票差額
            <span className="ml-2 font-semibold text-slate-900">
              ${Math.abs(executive?.operations.ecpayServiceFeeInvoiceGapAmount || 0).toFixed(2)}
            </span>
            ，待開立發票訂單
            <span className="ml-2 font-semibold text-slate-900">
              {executive?.operations.uninvoicedOrdersCount || 0}
            </span>
            筆，逾期應收
            <span className="ml-2 font-semibold text-slate-900">
              {arSummary?.overdueReceivableCount || 0}
            </span>
            筆。
          </div>
        </div>
      </motion.div>


      {/* ══════════════════════════════════════════════════
          CEO 即時快覽 — 財務核心指標、趨勢、平台貢獻
      ══════════════════════════════════════════════════ */}

      {/* 4 大 KPI 卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: '本期營收',
            value: overview?.grossAmount ?? 0,
            sub: `淨額 ${fmtMoney(overview?.netAmount ?? 0)}`,
            icon: <DollarOutlined className="text-emerald-500 text-xl" />,
            bg: 'from-emerald-500/10 to-emerald-100/5',
            color: 'text-emerald-700',
          },
          {
            label: '銀行現金',
            value: finance.bankBalance,
            sub: '即時餘額',
            icon: <BankOutlined className="text-sky-500 text-xl" />,
            bg: 'from-sky-500/10 to-sky-100/5',
            color: 'text-sky-700',
          },
          {
            label: '應收帳款',
            value: finance.arOutstanding,
            sub: '未收款',
            icon: <RiseOutlined className="text-blue-500 text-xl" />,
            bg: 'from-blue-500/10 to-blue-100/5',
            color: 'text-blue-700',
          },
          {
            label: '在途收款',
            value: finance.inTransit,
            sub: '撥款待入帳',
            icon: <ClockCircleOutlined className="text-amber-500 text-xl" />,
            bg: 'from-amber-500/10 to-amber-100/5',
            color: 'text-amber-700',
          },
        ].map((item, idx) => (
          <motion.div key={idx} whileHover={{ y: -3 }} className={`glass-card bg-gradient-to-br ${item.bg} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-2xl bg-white/60 flex items-center justify-center shadow-sm">
                {item.icon}
              </div>
              <span className="text-xs text-slate-400">{item.sub}</span>
            </div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">{item.label}</div>
            <div className={`text-2xl font-bold ${item.color}`}>
              {fmtMoney(item.value)}
            </div>
          </motion.div>
        ))}
      </div>

      {/* 營收趨勢圖 + 本週損益 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* 30 天營收趨勢 */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Revenue Trend</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">30 天營收走勢</div>
            </div>
            <Tag color="blue" className="rounded-full">每日（扣費前）</Tag>
          </div>
          <ResponsiveContainer width="100%" height={220}>
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
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 10000).toFixed(0)}萬`} />
              <RechartsTooltip
                formatter={(value: number, name: string) => [fmtMoney(value), name === 'revenue' ? '營收' : '毛利']}
                contentStyle={{ borderRadius: '12px', border: '1px solid rgba(0,0,0,0.08)', fontSize: '12px' }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#0ea5e9" strokeWidth={2} fill="url(#revGrad)" name="revenue" />
              <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fill="url(#profGrad)" name="profit" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* 本週損益摘要 */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 mb-2">Weekly P&L</div>
          <div className="text-xl font-semibold text-slate-900 mb-5">本週損益快覽</div>
          <div className="space-y-4">
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
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-500">毛利率</span>
                <span className="font-bold text-purple-600">{(weeklyPnl.grossMargin * 100).toFixed(1)}%</span>
              </div>
              <Progress percent={Math.round(weeklyPnl.grossMargin * 100)} strokeColor="#7c3aed" size="small" showInfo={false} />
            </div>
            <div className="pt-3 rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-400 mb-1">本月累計實賺</div>
              <div className="text-xl font-bold text-slate-900">{fmtMoney(weeklyPnl.monthlyEarned)}</div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* 各平台貢獻度 */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Platform Revenue</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">各平台貢獻度</div>
          </div>
          <Tag color="blue" className="rounded-full">本月實收（扣費後）</Tag>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const total = platformContribs.reduce((s, p) => s + p.net, 0)
            return platformContribs.sort((a, b) => b.net - a.net).map((p) => (
              <div key={p.platform} className="rounded-3xl border border-white/30 bg-white/45 px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                    <span className="font-semibold text-slate-800 text-sm">{p.platform}</span>
                  </div>
                  <span className="text-xs text-slate-400">{total > 0 ? ((p.net / total) * 100).toFixed(1) : '0.0'}%</span>
                </div>
                <div className="text-lg font-bold text-slate-900 mb-2">{fmtMoney(p.net)}</div>
                <Progress percent={total > 0 ? Math.round((p.net / total) * 100) : 0} strokeColor={p.color} showInfo={false} size="small" trailColor="rgba(0,0,0,0.06)" />
              </div>
            ))
          })()}
        </div>
      </motion.div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {performanceBuckets.map((bucket, index) => {
            const status = getBucketStatus(bucket);
            const accent = getBucketAccent(index);

            return (
              <motion.div
                key={bucket.key}
                whileHover={{ y: -4 }}
                className="glass-card relative overflow-hidden p-6 transition-all duration-300"
              >
                <div
                  className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent.split(" ")[0]} ${accent.split(" ")[1]}`}
                />
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-500">
                      {bucket.label}
                    </div>
                    {"account" in bucket && bucket.account ? (
                      <div className="mt-1 text-xs text-slate-400">
                        帳號：{bucket.account}
                      </div>
                    ) : null}
                  </div>
                  <Tag color={status.color} className="rounded-full px-3 py-1">
                    {status.label}
                  </Tag>
                </div>

                <Statistic
                  title={<span className="label-text font-medium">業績總額</span>}
                  value={bucket.gross}
                  precision={2}
                  prefix="$"
                  valueStyle={{
                    color: "var(--text-primary)",
                    fontWeight: 700,
                    fontSize: "28px",
                  }}
                />

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white/40 px-4 py-3">
                    <div className="text-xs text-slate-400">訂單數</div>
                    <div className="mt-1 font-semibold text-slate-800">
                      {bucket.orderCount}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/40 px-4 py-3">
                    <div className="text-xs text-slate-400">已入帳 / 收款</div>
                    <div className="mt-1 font-semibold text-slate-800">
                      {bucket.payoutNet.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/40 px-4 py-3">
                    <div className="text-xs text-slate-400">手續費</div>
                    <div className="mt-1 font-semibold text-slate-800">
                      {bucket.feeTotal.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/40 px-4 py-3">
                    <div className="text-xs text-slate-400">待撥 / 待對帳</div>
                    <div className="mt-1 font-semibold text-slate-800">
                      {bucket.pendingPayoutCount}
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-xs leading-5 text-slate-500">
                  {status.helper}
                </div>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card overflow-hidden p-0"
        >
          <div className="border-b border-white/30 bg-[linear-gradient(135deg,rgba(15,23,42,0.9),rgba(30,41,59,0.75))] px-6 py-5 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">
              Reconciliation Pulse
            </div>
            <div className="mt-2 text-2xl font-semibold">金流與入帳狀態</div>
            <div className="mt-2 text-sm leading-6 text-white/75">
              這裡會把訂單、收款、手續費、待撥款與已對帳的狀態壓成一個管理視圖，方便每天追追帳。
            </div>
          </div>

          <div className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-3xl bg-slate-900/5 px-5 py-4">
                <div className="text-xs text-slate-400">總訂單數</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {total?.orderCount || 0}
                </div>
              </div>
              <div className="rounded-3xl bg-slate-900/5 px-5 py-4">
                <div className="text-xs text-slate-400">已建立收款</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {total?.paymentCount || 0}
                </div>
              </div>
              <div className="rounded-3xl bg-slate-900/5 px-5 py-4">
                <div className="text-xs text-slate-400">已完成對帳</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-600">
                  {total?.reconciledCount || 0}
                </div>
              </div>
              <div className="rounded-3xl bg-slate-900/5 px-5 py-4">
                <div className="text-xs text-slate-400">待撥款 / 待對帳</div>
                <div className="mt-2 text-2xl font-semibold text-amber-600">
                  {total?.pendingPayoutCount || 0}
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/30 bg-white/45 px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    總業績 vs 已入帳
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    用來看業績已經進來多少、實際撥款與淨額又落到多少。
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">總業績</div>
                  <div className="text-xl font-semibold text-slate-900">
                    ${total?.gross.toFixed(2) || "0.00"}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>已入帳淨額</span>
                    <span>${total?.payoutNet.toFixed(2) || "0.00"}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200/70">
                    <div
                      className="h-2 rounded-full bg-emerald-500 transition-all"
                      style={{
                        width: `${
                          total?.gross
                            ? Math.min((total.payoutNet / total.gross) * 100, 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>手續費</span>
                    <span>${total?.feeTotal.toFixed(2) || "0.00"}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200/70">
                    <div
                      className="h-2 rounded-full bg-fuchsia-500 transition-all"
                      style={{
                        width: `${
                          total?.gross
                            ? Math.min((total.feeTotal / total.gross) * 100, 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.9fr)]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card overflow-hidden p-0"
        >
          <div className="border-b border-white/30 bg-[linear-gradient(135deg,rgba(2,6,23,0.92),rgba(15,23,42,0.76),rgba(20,184,166,0.18))] px-6 py-6 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-white/55">
              AI Accounting Engine
            </div>
            <div className="mt-2 text-2xl font-semibold">
              自動對帳與核銷流程
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-white/72">
              系統會把訂單、付款、綠界撥款、平台抽成、發票與會計分錄串成同一條閉環；只有缺資料或金額不一致時，才進入會計工作台。
            </div>
          </div>

          <div className="grid gap-3 p-6 md:grid-cols-2">
            {accountingAutomationSteps.map((step, index) => (
              <div
                key={step.title}
                className="rounded-3xl border border-white/30 bg-white/50 px-5 py-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                    {index + 1}
                  </div>
                  <Tag color="blue" className="rounded-full">
                    {step.status}
                  </Tag>
                </div>
                <div className="mt-4 text-lg font-semibold text-slate-900">
                  {step.title}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  {step.detail}
                </div>
                <div className="mt-4 rounded-2xl bg-slate-900/5 px-4 py-3 text-xs font-medium text-slate-600">
                  {step.account}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6"
        >
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Fee Source Policy
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">
            手續費資料來源判斷
          </div>
          <div className="mt-1 text-sm leading-6 text-slate-500">
            平台費與金流費不能混在一起。系統會先抓平台 API，有缺口時再用綠界撥款與服務費發票補實際數字。
          </div>

          <div className="mt-5 space-y-3">
            {feeSourcePolicies.map((policy) => (
              <div
                key={policy.platform}
                className="rounded-3xl border border-white/30 bg-white/45 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {policy.platform}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-500">
                      {policy.detail}
                    </div>
                  </div>
                  <Tag color={policy.tone} className="rounded-full">
                    {policy.status}
                  </Tag>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-3xl bg-slate-950 px-5 py-5 text-white">
            <div className="text-xs uppercase tracking-[0.24em] text-white/45">
              Current Automation Signal
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-white/45">待補實際費率</div>
                <div className="mt-1 text-2xl font-semibold">
                  {executive?.operations.feeBackfillCount || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-white/45">手續費異常</div>
                <div className="mt-1 text-2xl font-semibold">
                  {auditSummary?.feeIssueCount || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-white/45">綠界服務費發票缺口</div>
                <div className="mt-1 text-2xl font-semibold">
                  NT$ {Math.abs(executive?.operations.ecpayServiceFeeInvoiceGapAmount || 0).toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-white/45">已對帳未落帳</div>
                <div className="mt-1 text-2xl font-semibold">
                  {executive?.operations.missingPayoutJournalCount || 0}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Operations Hub
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              人事、薪資與出勤總覽
            </div>
            <div className="mt-1 text-sm text-slate-500">
              把員工、假單、出勤異常、薪資批次與待審事項集中在同一個營運總控台。
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">在職員工</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {operationsHub?.people.activeEmployees || 0}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">待審假單</div>
            <div className="mt-2 text-2xl font-semibold text-amber-600">
              {operationsHub?.people.pendingLeaveRequests || 0}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">出勤異常</div>
            <div className="mt-2 text-2xl font-semibold text-rose-600">
              {operationsHub?.people.openAttendanceAnomalies || 0}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">待審薪資批次</div>
            <div className="mt-2 text-2xl font-semibold text-sky-600">
              {operationsHub?.payroll.pendingApprovalRuns || 0}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {operationsHighlights.map((item) => (
            <div
              key={item.key}
              className="rounded-2xl border border-white/30 bg-white/45 px-4 py-4"
            >
              <div className="text-xs text-slate-400">{item.label}</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Invoice Closure
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              發票閉環與批次開票
            </div>
            <div className="mt-1 text-sm text-slate-500">
              這裡會把已付款可開票、尚待付款、已開票的訂單放在同一個隊列，讓營運可以直接推進發票流程。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<SyncOutlined />}
              onClick={handleSyncInvoiceStatuses}
              loading={syncingInvoiceStatuses}
              className="shadow-sm"
            >
              {syncingInvoiceStatuses ? "同步中..." : "同步綠界發票狀態"}
            </Button>
            <Button
              type="primary"
              onClick={handleIssueEligibleInvoices}
              loading={issuingInvoices}
              className="bg-black hover:bg-gray-800 border-none shadow-sm"
            >
              {issuingInvoices ? "批次開票中..." : "批次開立可開票訂單"}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">本期已開票</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-600">
              {invoiceSummary?.issuedCount || 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              NT$ {invoiceSummary?.issuedAmount.toFixed(0) || "0"}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">可批次開票</div>
            <div className="mt-2 text-2xl font-semibold text-amber-600">
              {invoiceSummary?.eligibleCount || 0}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">待付款後開票</div>
            <div className="mt-2 text-2xl font-semibold text-sky-600">
              {invoiceSummary?.waitingPaymentCount || 0}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">已作廢發票</div>
            <div className="mt-2 text-2xl font-semibold text-rose-600">
              {invoiceSummary?.voidCount || 0}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/30 bg-white/45 px-4 py-4">
            <div className="text-xs text-slate-400">待補發票</div>
            <div className="mt-2 text-xl font-semibold text-amber-600">
              {arSummary?.missingInvoiceCount || 0}
            </div>
          </div>
          <div className="rounded-2xl border border-white/30 bg-white/45 px-4 py-4">
            <div className="text-xs text-slate-400">已開票未落帳</div>
            <div className="mt-2 text-xl font-semibold text-violet-600">
              {arSummary?.issuedUnpostedCount || 0}
            </div>
          </div>
          <div className="rounded-2xl border border-white/30 bg-white/45 px-4 py-4">
            <div className="text-xs text-slate-400">已開票未收款</div>
            <div className="mt-2 text-xl font-semibold text-sky-600">
              {arSummary?.issuedUnpaidCount || 0}
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {invoiceItems.map((item) => {
            const meta = getInvoiceQueueMeta(item);
            return (
              <div
                key={item.orderId}
                className="rounded-3xl border border-white/30 bg-white/45 px-4 py-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-900">
                        {item.externalOrderId || item.orderId}
                      </div>
                      <Tag color={meta.color}>{meta.label}</Tag>
                      {item.journalLinked ? <Tag color="green">已落帳</Tag> : <Tag color="blue">待落帳檢查</Tag>}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-500">
                      {item.channelName || item.channelCode || "未知通路"} ·
                      {" "}
                      {item.customerName} ·
                      {" "}
                      下單 {dayjs(item.orderDate).tz(DASHBOARD_TZ).format("YYYY/MM/DD")}
                      {" "}
                      · 已過 {item.daysSinceOrder} 天
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-400">
                      {item.reason}
                      {item.invoiceNumber ? ` · 發票 ${item.invoiceNumber}` : ""}
                    </div>
                  </div>

                  <div className="grid min-w-[260px] grid-cols-3 gap-3 text-right text-sm">
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">訂單金額</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        ${item.totalAmount.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">付款狀態</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {item.paymentStatus}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">對帳狀態</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {item.reconciledFlag ? "已對帳" : "待對帳"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {!invoiceItems.length ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white/30 px-5 py-6 text-sm text-slate-500">
              目前沒有待追發票隊列。這裡會集中顯示可批次開票與仍待付款的訂單。
            </div>
          ) : null}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              AI Reconciliation Audit
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              逐筆對帳稽核與會計提醒
            </div>
            <div className="mt-1 text-sm text-slate-500">
              系統會逐筆檢查手續費、發票、稅額與訂單收款是否一致，方便你像輔助會計一樣從高處看整體營運。
            </div>
          </div>
          <div className="rounded-3xl border border-white/30 bg-white/45 px-4 py-4 text-right">
            <div className="text-xs text-slate-400">抽成率</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {auditSummary?.feeTakeRatePct.toFixed(2) || "0.00"}%
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              總手續費 NT$ {auditSummary?.totalFeeAmount.toFixed(0) || "0"}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">已稽核訂單</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {auditSummary?.auditedOrderCount || 0}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">手續費 / 發票異常</div>
            <div className="mt-2 text-2xl font-semibold text-amber-600">
              {(auditSummary?.feeIssueCount || 0) + (auditSummary?.invoiceIssueCount || 0)}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">稅務異常</div>
            <div className="mt-2 text-2xl font-semibold text-rose-600">
              {auditSummary?.taxIssueCount || 0}
            </div>
          </div>
          <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
            <div className="text-xs text-slate-400">帳款 / 訂單不一致</div>
            <div className="mt-2 text-2xl font-semibold text-sky-600">
              {auditSummary?.orderPaymentIssueCount || 0}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/30 bg-white/45 px-4 py-4">
            <div className="text-xs text-slate-400">金流手續費</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              NT$ {auditSummary?.totalGatewayFeeAmount.toFixed(0) || "0"}
            </div>
          </div>
          <div className="rounded-2xl border border-white/30 bg-white/45 px-4 py-4">
            <div className="text-xs text-slate-400">平台手續費</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              NT$ {auditSummary?.totalPlatformFeeAmount.toFixed(0) || "0"}
            </div>
          </div>
          <div className="rounded-2xl border border-white/30 bg-white/45 px-4 py-4">
            <div className="text-xs text-slate-400">異常涉及業績</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              NT$ {auditSummary?.flaggedGrossAmount.toFixed(0) || "0"}
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {auditItems.map((item) => {
            const severity = getAuditSeverityMeta(item.severity);
            return (
              <div
                key={item.orderId}
                className="rounded-3xl border border-white/30 bg-white/45 px-4 py-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-900">
                        {item.externalOrderId || item.orderId}
                      </div>
                      <Tag color={severity.color}>{severity.label}</Tag>
                      <Tag color={item.reconciledFlag ? "green" : "blue"}>
                        {item.reconciledFlag ? "已對帳" : "待對帳"}
                      </Tag>
                      {item.invoiceNumber ? (
                        <Tag color="purple">發票 {item.invoiceNumber}</Tag>
                      ) : (
                        <Tag color="gold">待補發票</Tag>
                      )}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-500">
                      {item.channelName} · 下單{" "}
                      {dayjs(item.orderDate).tz(DASHBOARD_TZ).format("YYYY/MM/DD")}
                      {item.providerTradeNo ? ` · 金流單號 ${item.providerTradeNo}` : ""}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.anomalyMessages.map((messageText, index) => (
                        <Tag key={`${item.orderId}-${index}`} color="red">
                          {messageText}
                        </Tag>
                      ))}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-400">
                      {item.recommendation}
                    </div>
                  </div>

                  <div className="grid min-w-[320px] grid-cols-2 gap-3 text-right text-sm lg:grid-cols-4">
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">訂單 / 收款</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {item.grossAmount.toFixed(0)} / {item.paymentGrossAmount.toFixed(0)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">手續費</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {item.feeTotalAmount.toFixed(0)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">稅額</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {item.orderTaxAmount.toFixed(0)} / {item.invoiceTaxAmount.toFixed(0)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">抽成率</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {item.feeRatePct.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {!auditItems.length ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white/30 px-5 py-6 text-sm text-slate-500">
              目前這個區間沒有抓到需要優先處理的逐筆對帳異常。系統仍會持續監測手續費、發票與稅務一致性。
            </div>
          ) : null}
        </div>
      </motion.div>

      <Row
        gutter={[
          { xs: 16, sm: 24 },
          { xs: 16, sm: 24 },
        ]}
      >
        <Col xs={24} lg={12}>
          <div
            className="h-full animate-slide-up"
            style={{ animationDelay: "480ms" }}
          >
            <Card
              title="異常待辦清單 (Exception Inbox)"
              className="glass-card !border-0 h-full"
            >
              <div className="space-y-4">
                {anomalies.map((item) => {
                  const tone = getTaskToneMeta(item.tone);
                  return (
                    <div
                      key={item.key}
                      className="rounded-2xl bg-slate-50 px-4 py-4 transition-colors hover:bg-slate-100"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-slate-900">
                              {item.title}
                            </div>
                            <Tag color={tone.color}>{item.statusLabel}</Tag>
                          </div>
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            {item.helper}
                          </div>
                          {item.accountCode ? (
                            <div className="mt-2 text-[11px] text-slate-400">
                              會計科目：{item.accountCode}
                              {item.accountName ? ` · ${item.accountName}` : ""}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-slate-900">
                            {item.count}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {item.amount !== null
                              ? `NT$ ${item.amount.toFixed(0)}`
                              : "待處理"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!anomalies.length ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                    目前沒有高風險異常。這裡會集中顯示未撥款、未開票、待補費率與未匹配撥款匯入。
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div
            className="h-full animate-slide-up"
            style={{ animationDelay: "520ms" }}
          >
            <Card
              title="自動對帳規則 (Auto Reconciliation Rules)"
              className="glass-card !border-0 h-full"
            >
              <div className="space-y-4">
                {reconciliationRules.map((rule) => {
                  const status = getRuleStatusMeta(rule.status);
                  return (
                    <div
                      key={rule.key}
                      className="rounded-2xl bg-slate-50 px-4 py-4 transition-colors hover:bg-slate-100"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-slate-900">
                              {rule.title}
                            </div>
                            <Tag color={status.color}>{status.badge}</Tag>
                          </div>
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            {rule.description}
                          </div>
                          <div className="mt-3 rounded-xl bg-white px-3 py-3 text-xs text-slate-600">
                            <div className="font-medium text-slate-900">
                              會計分錄建議
                            </div>
                            <div className="mt-1">{rule.accountingEntry}</div>
                          </div>
                          <div className="mt-2 text-[11px] leading-5 text-slate-400">
                            {rule.helper}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-slate-900">
                            {rule.metric}
                          </div>
                          <div className="text-[11px] text-slate-400">影響筆數</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </Col>
      </Row>

      <Row
        gutter={[
          { xs: 16, sm: 24 },
          { xs: 16, sm: 24 },
        ]}
      >
        <Col xs={24} lg={12}>
          <div
            className="h-full animate-slide-up"
            style={{ animationDelay: "500ms" }}
          >
            <Card
              title="庫存警示 (Inventory Alerts)"
              className="glass-card !border-0 h-full"
            >
              <div className="space-y-3">
                {inventoryAlerts.map((item) => (
                  <div
                    key={`${item.sku}-${item.name}`}
                    className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <div className="font-medium text-slate-900">{item.name}</div>
                      <div className="text-xs text-slate-400">
                        SKU {item.sku} · 現有 {item.qtyAvailable}
                      </div>
                    </div>
                    <Tag color={item.severity === "critical" ? "red" : "gold"}>
                      {item.severity === "critical" ? "缺貨" : "低庫存"}
                    </Tag>
                  </div>
                ))}
                {!inventoryAlerts.length ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                    目前沒有庫存警示，這一區會優先顯示需要補貨的商品。
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div
            className="h-full animate-slide-up"
            style={{ animationDelay: "600ms" }}
          >
            <Card
              title="CEO 待辦事項 (Priority Tasks)"
              className="glass-card !border-0 h-full"
            >
              <div className="space-y-4">
                {tasks.map((task, idx) => {
                  const tone = getTaskToneMeta(task.tone);
                  return (
                  <div
                    key={task.key}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
                        style={{
                          backgroundColor:
                            idx % 3 === 0 ? "#f56a00" : idx % 3 === 1 ? "#1677ff" : "#13c2c2",
                        }}
                      >
                        {task.title.slice(0, 1)}
                      </div>
                      <div>
                        <div className="font-medium text-gray-800">
                          {task.title}
                        </div>
                        <div className="text-xs text-gray-400">
                          {task.helper}
                          {task.amount ? ` • NT$ ${task.amount.toFixed(0)}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-slate-900">{task.value}</div>
                      <Tag color={tone.color}>{tone.badge}</Tag>
                    </div>
                  </div>
                )})}
                {!tasks.length ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                    目前沒有需要特別追蹤的待辦，這裡會聚焦影響營運的關鍵項目。
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default DashboardPage;
