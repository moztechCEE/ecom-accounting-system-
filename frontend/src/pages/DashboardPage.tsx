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
} from "antd";
import {
  BankOutlined,
  DollarOutlined,
  ShoppingOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import PageSkeleton from "../components/PageSkeleton";
import AIInsightsWidget from "../components/AIInsightsWidget";
import { shopifyService } from "../services/shopify.service";
import { oneShopService } from "../services/oneshop.service";
import { shoplineService } from "../services/shopline.service";
import {
  dashboardService,
  DashboardExecutiveOverview,
  DashboardReconciliationBatch,
  DashboardReconciliationFeed,
  DashboardReconciliationItem,
  DashboardPerformanceBucket,
  DashboardSalesOverview,
} from "../services/dashboard.service";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const DASHBOARD_TZ = "Asia/Taipei";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(DASHBOARD_TZ);

type RangeMode = "all" | "today" | "yesterday" | "last7d" | "custom";
type CustomRange = [Dayjs, Dayjs] | null;
type RangeValue = [Dayjs | null, Dayjs | null] | null;

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

function getSettlementMeta(item: DashboardReconciliationItem) {
  if (item.settlementStatus === "reconciled") {
    return {
      color: "green" as const,
      label: "已撥款",
      helper: item.provider ? `${item.provider.toUpperCase()} 已回填` : "已完成對帳",
    };
  }

  if (item.settlementStatus === "pending_payout") {
    return {
      color: "gold" as const,
      label: "待撥款",
      helper: "已付款，等待金流撥款或對帳匯入",
    };
  }

  if (item.settlementStatus === "failed") {
    return {
      color: "red" as const,
      label: "失敗 / 退款",
      helper: "這筆交易已失敗、取消或退款",
    };
  }

  return {
    color: "blue" as const,
    label: "待付款",
    helper: "訂單已進系統，但付款尚未完成",
  };
}

function getFeeMeta(item: DashboardReconciliationItem) {
  if (item.feeStatus === "actual") {
    return { color: "green" as const, label: "實際手續費" };
  }

  if (item.feeStatus === "estimated") {
    return { color: "gold" as const, label: "預估手續費" };
  }

  return { color: "default" as const, label: "待補手續費" };
}

function getBatchMeta(batch: DashboardReconciliationBatch) {
  if (batch.unmatchedCount === 0 && batch.invalidCount === 0) {
    return {
      color: "green" as const,
      label: "已吃進",
    };
  }

  if (batch.matchedCount > 0) {
    return {
      color: "gold" as const,
      label: "部分待處理",
    };
  }

  return {
    color: "blue" as const,
    label: "待匹配",
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

const DashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customRange, setCustomRange] = useState<CustomRange>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [overview, setOverview] = useState<DashboardSalesOverview | null>(null);
  const [feed, setFeed] = useState<DashboardReconciliationFeed | null>(null);
  const [executive, setExecutive] = useState<DashboardExecutiveOverview | null>(null);

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
        const [summary, reconciliationFeed, executiveOverview] = await Promise.all([
          dashboardService.getSalesOverview({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
          }),
          dashboardService.getReconciliationFeed({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
            limit: 10,
          }),
          dashboardService.getExecutiveOverview({
            entityId: storedEntityId,
            startDate: since,
            endDate: until,
          }),
        ]);

        if (ignore) return;

        setOverview(summary);
        setFeed(reconciliationFeed);
        setExecutive(executiveOverview);
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

  if (loading) {
    return <PageSkeleton />;
  }
  const performanceBuckets = overview?.buckets || [];
  const total = overview?.total;
  const recentItems = feed?.recentItems || [];
  const recentBatches = feed?.recentBatches || [];
  const tasks = executive?.tasks || [];
  const inventoryAlerts = executive?.inventoryAlerts || [];

  return (
    <div className="space-y-8">
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
            <div className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
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
                  {(executive?.operations.pendingPayoutCount || 0) +
                    (executive?.operations.inventoryAlertCount || 0) +
                    (executive?.expenses.pendingApprovalCount || 0)}
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
              <div className="text-xs text-slate-400">待審費用</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {executive?.expenses.pendingApprovalCount || 0}
              </div>
            </div>
            <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
              <div className="text-xs text-slate-400">已核准待付款</div>
              <div className="mt-2 text-2xl font-semibold text-sky-600">
                {executive?.expenses.approvedUnpaidCount || 0}
              </div>
            </div>
            <div className="rounded-3xl bg-slate-900/5 px-4 py-4">
              <div className="text-xs text-slate-400">庫存警示</div>
              <div className="mt-2 text-2xl font-semibold text-rose-600">
                {executive?.operations.inventoryAlertCount || 0}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-3xl border border-white/30 bg-white/45 px-4 py-4 text-sm text-slate-600">
            本期經費支出
            <span className="ml-2 font-semibold text-slate-900">
              ${executive?.expenses.actualSpend.toFixed(2) || "0.00"}
            </span>
            ，待開立發票訂單
            <span className="ml-2 font-semibold text-slate-900">
              {executive?.operations.uninvoicedOrdersCount || 0}
            </span>
            筆。
          </div>
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                Reconciliation Feed
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-900">
                最近收款與撥款追蹤
              </div>
              <div className="mt-1 text-sm text-slate-500">
                把信用卡、超商、貨到付款與實際撥款狀態放在同一排，方便每天追帳。
              </div>
            </div>
            <Tag color="blue" className="rounded-full px-3 py-1">
              {recentItems.length} 筆重點
            </Tag>
          </div>

          <div className="mt-5 space-y-3">
            {recentItems.map((item) => {
              const settlement = getSettlementMeta(item);
              const feeMeta = getFeeMeta(item);

              return (
                <div
                  key={item.paymentId}
                  className="rounded-3xl border border-white/30 bg-white/45 px-4 py-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {item.bucketLabel}
                        </div>
                        <Tag color={settlement.color} className="rounded-full">
                          {settlement.label}
                        </Tag>
                        <Tag color={feeMeta.color} className="rounded-full">
                          {feeMeta.label}
                        </Tag>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-slate-500">
                        訂單 {item.externalOrderId || "未綁定"} ·
                        {" "}
                        {item.gateway || "未知付款方式"} ·
                        {" "}
                        付款狀態 {item.paymentStatus || "未回填"} ·
                        {" "}
                        物流 {item.logisticStatus || "未回填"}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">
                        {settlement.helper}
                        {item.providerTradeNo ? ` · 綠界/金流單號 ${item.providerTradeNo}` : ""}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-right text-sm min-w-[260px]">
                      <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                        <div className="text-[11px] text-slate-400">收款總額</div>
                        <div className="mt-1 font-semibold text-slate-900">
                          ${item.gross.toFixed(2)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                        <div className="text-[11px] text-slate-400">手續費</div>
                        <div className="mt-1 font-semibold text-slate-900">
                          ${item.feeTotal.toFixed(2)}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                        <div className="text-[11px] text-slate-400">淨額</div>
                        <div className="mt-1 font-semibold text-slate-900">
                          ${item.net.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {!recentItems.length ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white/30 px-5 py-6 text-sm text-slate-500">
                目前還沒有可顯示的收款追蹤資料，先按一次「即時同步」或等待排程把最新訂單與金流帶進來。
              </div>
            ) : null}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6"
        >
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Provider Batches
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">
            最近對帳批次
          </div>
          <div className="mt-1 text-sm text-slate-500">
            這裡會列出最近匯入的金流對帳批次，方便追哪一批已經回填、哪一批還有未匹配。
          </div>

          <div className="mt-5 space-y-3">
            {recentBatches.map((batch) => {
              const meta = getBatchMeta(batch);
              return (
                <div
                  key={batch.id}
                  className="rounded-3xl border border-white/30 bg-white/45 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {batch.provider.toUpperCase()} 對帳批次
                        </div>
                        <Tag color={meta.color} className="rounded-full">
                          {meta.label}
                        </Tag>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-slate-500">
                        {dayjs(batch.importedAt).tz(DASHBOARD_TZ).format("YYYY/MM/DD HH:mm")}
                        {" · "}
                        {batch.fileName || "系統同步批次"}
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      source: {batch.sourceType}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">匯入列數</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {batch.recordCount}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">已匹配</div>
                      <div className="mt-1 font-semibold text-emerald-600">
                        {batch.matchedCount}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-900/5 px-3 py-3">
                      <div className="text-[11px] text-slate-400">待處理</div>
                      <div className="mt-1 font-semibold text-amber-600">
                        {batch.unmatchedCount + batch.invalidCount}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {!recentBatches.length ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white/30 px-5 py-6 text-sm text-slate-500">
                目前還沒有金流對帳批次。等匯入綠界 / HiTRUST 撥款報表後，這裡會開始顯示。
              </div>
            ) : null}
          </div>
        </motion.div>
      </div>

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
