import React, { useState, useEffect } from "react";
import {
  Row,
  Col,
  Statistic,
  Typography,
  Tag,
  Button,
  Timeline,
  Card,
  Avatar,
  message,
  Radio,
  DatePicker,
} from "antd";
import {
  DollarOutlined,
  ShoppingOutlined,
  BankOutlined,
  FileTextOutlined,
  UserOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import FinancialHealthWidget from "../components/FinancialHealthWidget";
import PageSkeleton from "../components/PageSkeleton";
import AIInsightsWidget from "../components/AIInsightsWidget";
import { shopifyService } from "../services/shopify.service";
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

type PlatformFeeStatus =
  | "actual"
  | "estimated"
  | "mixed"
  | "unavailable"
  | "not_applicable"
  | "empty";

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

const DashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customRange, setCustomRange] = useState<CustomRange>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Live Data State (from API)
  const [revenue, setRevenue] = useState(0);
  const [receivables, setReceivables] = useState(0);
  const [expenses, setExpenses] = useState<number | null>(null);
  const [pendingDocs, setPendingDocs] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [platformFeeStatus, setPlatformFeeStatus] =
    useState<PlatformFeeStatus>("empty");
  const [platformFeeSource, setPlatformFeeSource] =
    useState("尚未同步交易資料");
  const [platformFeeMessage, setPlatformFeeMessage] = useState<string | null>(
    null,
  );

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
        const summary = await shopifyService.summary({
          entityId: storedEntityId,
          since,
          until,
        });

        if (ignore) return;

        // Map backend summary to dashboard KPIs
        setRevenue(summary.orders.gross);
        setReceivables(summary.payouts.gross);
        setExpenses(summary.payouts.platformFee);
        setPlatformFeeStatus(summary.payouts.platformFeeStatus);
        setPlatformFeeSource(summary.payouts.platformFeeSource);
        setPlatformFeeMessage(summary.payouts.platformFeeMessage);
        setPendingDocs(summary.orders.count);
        setLastUpdated("revenue");
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
    setSyncing(true);
    try {
      const [ordersResult, transactionsResult] = await Promise.all([
        shopifyService.syncOrders({ entityId: storedEntityId }),
        shopifyService.syncTransactions({ entityId: storedEntityId }),
      ]);

      message.success(
        `同步完成：訂單 ${ordersResult.created + ordersResult.updated} 筆，撥款 ${
          transactionsResult.created + transactionsResult.updated
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

  const platformFeeTagMap: Record<
    PlatformFeeStatus,
    { color: string; label: string }
  > = {
    actual: { color: "green", label: "實際" },
    estimated: { color: "gold", label: "估算" },
    mixed: { color: "orange", label: "部分估算" },
    unavailable: { color: "default", label: "未串接" },
    not_applicable: { color: "blue", label: "不適用" },
    empty: { color: "default", label: "尚未同步" },
  };

  const platformFeeDisplay = expenses ?? "—";

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

      {/* Key Metrics Cards */}
      <Row
        gutter={[
          { xs: 16, sm: 24 },
          { xs: 16, sm: 24 },
        ]}
      >
        <Col xs={24} sm={12} lg={6}>
          <motion.div
            whileHover={{ y: -5 }}
            className="glass-card p-6 transition-all duration-300 animate-slide-up"
            style={{ animationDelay: "0ms" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center backdrop-blur-sm">
                <DollarOutlined className="text-blue-500 text-xl" />
              </div>
              <Tag
                color="green"
                className="m-0 rounded-full border-none bg-green-500/10 text-green-600 px-3 py-1"
              >
                +12.5%
              </Tag>
            </div>
            <Statistic
              title={<span className="label-text font-medium">今日銷售額</span>}
              value={revenue}
              precision={2}
              prefix="$"
              className={`kpi-number transition-colors duration-300 ${lastUpdated === "revenue" ? "animate-flash-text" : ""}`}
              valueStyle={{
                color: "var(--text-primary)",
                fontWeight: 700,
                fontSize: "28px",
              }}
            />
            <div className="mt-2 text-sm text-gray-400">
              來源：Shopify orders.gross
            </div>
          </motion.div>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <motion.div
            whileHover={{ y: -5 }}
            className="glass-card p-6 transition-all duration-300 animate-slide-up"
            style={{ animationDelay: "100ms" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center backdrop-blur-sm">
                <BankOutlined className="text-orange-500 text-xl" />
              </div>
              <Tag
                color="red"
                className="m-0 rounded-full border-none bg-red-500/10 text-red-600 px-3 py-1"
              >
                12 筆逾期
              </Tag>
            </div>
            <Statistic
              title={
                <span className="label-text font-medium">平台撥款總額</span>
              }
              value={receivables}
              precision={2}
              prefix="$"
              className={`kpi-number transition-colors duration-300 ${lastUpdated === "receivables" ? "animate-flash-text" : ""}`}
              valueStyle={{
                color: "var(--text-primary)",
                fontWeight: 700,
                fontSize: "28px",
              }}
            />
            <div className="mt-2 text-sm text-gray-400">
              來源：Shopify payouts.gross
            </div>
          </motion.div>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <motion.div
            whileHover={{ y: -5 }}
            className="glass-card p-6 transition-all duration-300 animate-slide-up"
            style={{ animationDelay: "200ms" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center backdrop-blur-sm">
                <ShoppingOutlined className="text-purple-500 text-xl" />
              </div>
              <Tag
                color={platformFeeTagMap[platformFeeStatus].color}
                className="m-0 rounded-full px-3 py-1"
              >
                {platformFeeTagMap[platformFeeStatus].label}
              </Tag>
            </div>
            <Statistic
              title={<span className="label-text font-medium">平台費用</span>}
              value={platformFeeDisplay}
              precision={typeof expenses === "number" ? 2 : undefined}
              prefix="$"
              className={`kpi-number transition-colors duration-300 ${lastUpdated === "expenses" ? "animate-flash-text" : ""}`}
              valueStyle={{
                color: "var(--text-primary)",
                fontWeight: 700,
                fontSize: "28px",
              }}
            />
            <div className="mt-2 text-sm text-gray-400">
              來源：{platformFeeSource}
            </div>
            {platformFeeMessage && (
              <div className="mt-2 text-xs leading-5 text-gray-500">
                {platformFeeMessage}
              </div>
            )}
            {platformFeeStatus === "estimated" ||
            platformFeeStatus === "mixed" ? (
              <div className="mt-2 text-xs leading-5 text-amber-600">
                目前是依你設定的金流費率規則估算，不是金流實際對帳單。
              </div>
            ) : null}
            {platformFeeStatus === "unavailable" ? (
              <div className="mt-2 text-xs leading-5 text-gray-500">
                這家店目前使用外部金流，Shopify 不會直接回傳手續費。
              </div>
            ) : null}
            {platformFeeStatus === "not_applicable" ? (
              <div className="mt-2 text-xs leading-5 text-gray-500">
                目前期間內的付款方式沒有平台手續費。
              </div>
            ) : null}
            {platformFeeStatus === "empty" ? (
              <div className="mt-2 text-xs leading-5 text-gray-500">
                先按一次「即時同步」把交易資料拉進來。
              </div>
            ) : null}
          </motion.div>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <motion.div
            whileHover={{ y: -5 }}
            className="glass-card p-6 transition-all duration-300 animate-slide-up"
            style={{ animationDelay: "300ms" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-full bg-teal-500/10 flex items-center justify-center backdrop-blur-sm">
                <FileTextOutlined className="text-teal-500 text-xl" />
              </div>
              <Tag
                color="blue"
                className="m-0 rounded-full border-none bg-blue-500/10 text-blue-600 px-3 py-1"
              >
                3 筆待簽
              </Tag>
            </div>
            <Statistic
              title={<span className="label-text font-medium">訂單數</span>}
              value={pendingDocs}
              className={`kpi-number transition-colors duration-300 ${lastUpdated === "pendingDocs" ? "animate-flash-text" : ""}`}
              valueStyle={{
                color: "var(--text-primary)",
                fontWeight: 700,
                fontSize: "28px",
              }}
            />
            <div className="mt-2 text-sm text-gray-400">
              來源：Shopify orders.count
            </div>
          </motion.div>
        </Col>
      </Row>

      {/* Financial Health Widget */}
      <div className="animate-slide-up" style={{ animationDelay: "400ms" }}>
        <FinancialHealthWidget />
      </div>

      {/* Recent Activity & Tasks */}
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
              title="近期活動 (Recent Activity)"
              className="glass-card !border-0 h-full"
            >
              <Timeline
                items={[
                  {
                    color: "green",
                    children: (
                      <div className="pb-4">
                        <div className="font-medium">
                          收到來自 Tech Solutions 的款項
                        </div>
                        <div className="text-xs text-gray-400">
                          2025-11-21 10:30 AM • NT$ 150,000
                        </div>
                      </div>
                    ),
                  },
                  {
                    color: "blue",
                    children: (
                      <div className="pb-4">
                        <div className="font-medium">開立發票 #INV-2025089</div>
                        <div className="text-xs text-gray-400">
                          2025-11-21 09:15 AM • 給 Global Trade Co.
                        </div>
                      </div>
                    ),
                  },
                  {
                    color: "red",
                    children: (
                      <div className="pb-4">
                        <div className="font-medium">
                          庫存警示：MacBook Pro M3
                        </div>
                        <div className="text-xs text-gray-400">
                          2025-11-20 16:45 PM • 庫存低於安全水位
                        </div>
                      </div>
                    ),
                  },
                  {
                    color: "gray",
                    children: (
                      <div className="pb-4">
                        <div className="font-medium">系統自動備份完成</div>
                        <div className="text-xs text-gray-400">
                          2025-11-20 03:00 AM
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div
            className="h-full animate-slide-up"
            style={{ animationDelay: "600ms" }}
          >
            <Card
              title="待辦事項 (Pending Tasks)"
              className="glass-card !border-0 h-full"
            >
              <div className="space-y-4">
                {[
                  {
                    title: "審核 11 月份行銷費用報銷",
                    user: "Alice",
                    time: "2h ago",
                    tag: "Approval",
                  },
                  {
                    title: "確認 Q4 財務預測報告",
                    user: "Bob",
                    time: "4h ago",
                    tag: "Review",
                  },
                  {
                    title: "更新供應商合約條款",
                    user: "Charlie",
                    time: "1d ago",
                    tag: "Legal",
                  },
                ].map((task, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar
                        style={{
                          backgroundColor:
                            idx === 0
                              ? "#f56a00"
                              : idx === 1
                                ? "#7265e6"
                                : "#ffbf00",
                        }}
                        icon={<UserOutlined />}
                      />
                      <div>
                        <div className="font-medium text-gray-800">
                          {task.title}
                        </div>
                        <div className="text-xs text-gray-400">
                          {task.user} • {task.time}
                        </div>
                      </div>
                    </div>
                    <Tag>{task.tag}</Tag>
                  </div>
                ))}
                <Button type="dashed" block className="mt-4">
                  查看更多待辦
                </Button>
              </div>
            </Card>
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default DashboardPage;
