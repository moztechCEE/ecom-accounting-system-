import React, { useMemo } from 'react'
import { Card, Statistic, Row, Col, Typography, Space, Empty, Segmented, DatePicker } from 'antd'
import {
  ThunderboltFilled,
  PieChartOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { motion } from 'framer-motion'
import { SalesOrder } from '../services/sales.service'
import { EcommerceHistory } from '../services/dashboard.service'
import { Dayjs } from 'dayjs'

const { Text, Title } = Typography
const { RangePicker } = DatePicker
type AnalyticsRange = 'today' | 'last7Days' | 'lastMonth' | 'lastYear' | 'custom'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']

const SalesAnalytics: React.FC<{
  orders: SalesOrder[]
  ecommerceHistory?: EcommerceHistory | null
  rangeLabel: string
  quickRange: AnalyticsRange
  customRange: [Dayjs | null, Dayjs | null] | null
  onQuickRangeChange: (value: AnalyticsRange) => void
  onCustomRangeChange: (value: [Dayjs | null, Dayjs | null] | null) => void
}> = ({ orders, ecommerceHistory, rangeLabel, quickRange, customRange, onQuickRangeChange, onCustomRangeChange }) => {
  const filteredOrders = orders
  const hasHistorySummary = Boolean(ecommerceHistory?.summary)
  const revenueTotal = hasHistorySummary
    ? Number(ecommerceHistory?.summary.revenue || 0)
    : filteredOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0)
  const orderTotal = hasHistorySummary
    ? Number(ecommerceHistory?.summary.orderCount || 0)
    : filteredOrders.length
  const completedOrders = filteredOrders.filter((order) => order.status === 'completed').length
  const paidLikeOrders = filteredOrders.filter((order) => {
    const totalAmount = Number(order.totalAmount || 0)
    const paidAmount = Number(order.paidAmountOriginal || 0)
    return totalAmount > 0 && paidAmount >= totalAmount
  }).length
  const averageOrderValue = orderTotal ? revenueTotal / orderTotal : 0
  const paidRate = filteredOrders.length ? (paidLikeOrders / filteredOrders.length) * 100 : 0
  const feeTotal = filteredOrders.reduce(
    (sum, order) => sum + Number(order.feeGatewayOriginal || 0) + Number(order.feePlatformOriginal || 0),
    0,
  )
  const netRevenue = filteredOrders.reduce((sum, order) => sum + Number(order.amountNetOriginal || 0), 0)

  const trendData = useMemo(() => {
    if (ecommerceHistory?.periods?.length) {
      return ecommerceHistory.periods.map((period) => ({
        name: period.label,
        revenue: Number(period.revenue || 0),
        orders: Number(period.orderCount || 0),
        average: Number(period.orderCount || 0)
          ? Number((Number(period.revenue || 0) / Number(period.orderCount || 0)).toFixed(0))
          : 0,
      }))
    }

    const buckets = new Map<string, { name: string; revenue: number; orders: number }>()

    filteredOrders.forEach((order) => {
      const bucketKey =
        rangeLabel.includes('一年')
          ? `${new Date(order.createdAt).getFullYear()}-${String(new Date(order.createdAt).getMonth() + 1).padStart(2, '0')}`
          : `${String(new Date(order.createdAt).getMonth() + 1).padStart(2, '0')}/${String(new Date(order.createdAt).getDate()).padStart(2, '0')}`
      const current = buckets.get(bucketKey) || { name: bucketKey, revenue: 0, orders: 0 }
      current.revenue += Number(order.totalAmount || 0)
      current.orders += 1
      buckets.set(bucketKey, current)
    })

    return Array.from(buckets.values()).map((item) => ({
      ...item,
      average: item.orders ? Number((item.revenue / item.orders).toFixed(0)) : 0,
    }))
  }, [ecommerceHistory, filteredOrders, rangeLabel])

  const platformMix = useMemo(() => {
    if (ecommerceHistory?.brands?.length) {
      const bucket = new Map<string, number>()
      ecommerceHistory.brands.forEach((brand) => {
        const key = brand.sourceLabel || brand.channelCode || '其他來源'
        bucket.set(key, (bucket.get(key) || 0) + Number(brand.revenue || 0))
      })

      return Array.from(bucket.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((left, right) => right.value - left.value)
    }

    const fallbackBucket = new Map<string, number>()
    filteredOrders.forEach((order) => {
      const key = order.sourceLabel || order.channelName || '其他來源'
      fallbackBucket.set(key, (fallbackBucket.get(key) || 0) + Number(order.totalAmount || 0))
    })
    return Array.from(fallbackBucket.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value)
  }, [ecommerceHistory, filteredOrders])

  const brandMix = useMemo(() => {
    if (ecommerceHistory?.brands?.length) {
      const bucket = new Map<string, { value: number; orders: number }>()
      ecommerceHistory.brands.forEach((brand) => {
        const current = bucket.get(brand.brand) || { value: 0, orders: 0 }
        current.value += Number(brand.revenue || 0)
        current.orders += Number(brand.orderCount || 0)
        bucket.set(brand.brand, current)
      })

      return Array.from(bucket.entries())
        .map(([name, value]) => ({ name, value: value.value, orders: value.orders }))
        .sort((left, right) => right.value - left.value)
    }

    const fallbackBucket = new Map<string, { value: number; orders: number }>()
    filteredOrders.forEach((order) => {
      const key = order.sourceBrand || order.sourceLabel || order.channelName || '其他品牌'
      const current = fallbackBucket.get(key) || { value: 0, orders: 0 }
      current.value += Number(order.totalAmount || 0)
      current.orders += 1
      fallbackBucket.set(key, current)
    })
    return Array.from(fallbackBucket.entries())
      .map(([name, value]) => ({ name, value: value.value, orders: value.orders }))
      .sort((left, right) => right.value - left.value)
  }, [ecommerceHistory, filteredOrders])

  const salesMixSummary = useMemo(() => {
    const total = platformMix.reduce((sum, item) => sum + item.value, 0)
    const officialSiteRevenue = platformMix
      .filter((item) => item.name.includes('官網') || item.name.includes('MOZTECH'))
      .reduce((sum, item) => sum + item.value, 0)
    const groupBuyRevenue = platformMix
      .filter((item) => item.name.includes('團購') || item.name.includes('萬魔'))
      .reduce((sum, item) => sum + item.value, 0)
    const otherRevenue = Math.max(total - officialSiteRevenue - groupBuyRevenue, 0)

    return {
      total,
      officialSiteRevenue,
      groupBuyRevenue,
      otherRevenue,
    }
  }, [platformMix])

  const topSource = platformMix[0]
  const topBrand = brandMix[0]

  return (
    <div className="space-y-7">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-500">
            <ThunderboltFilled className="text-xl" />
          </div>
          <div>
            <Title level={4} className="!mb-0">智慧銷售儀表板</Title>
            <Text type="secondary" className="text-xs">
              以真實訂單資料整理目前的營收、客群與來源分布
            </Text>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 md:items-end">
          <Segmented
            options={[
              { label: '今天', value: 'today' },
              { label: '過去 7 天', value: 'last7Days' },
              { label: '過去一個月', value: 'lastMonth' },
              { label: '過去一年', value: 'lastYear' },
              { label: '自定義', value: 'custom' },
            ]}
            value={quickRange}
            onChange={(value) => onQuickRangeChange(value as AnalyticsRange)}
          />
          {quickRange === 'custom' ? (
            <RangePicker
              value={customRange}
              onChange={(value) => onCustomRangeChange((value || null) as [Dayjs | null, Dayjs | null] | null)}
            />
          ) : (
            <div className="rounded-full bg-white/70 px-3 py-2 text-xs text-slate-500 shadow-sm">
              統計區間：{rangeLabel}
            </div>
          )}
        </div>
      </div>

      <Row gutter={[20, 20]}>
        <Col xs={24} md={8}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="glass-card !border-0 h-32 flex flex-col justify-center">
              <Statistic
                title={<span className="text-gray-500 font-medium">總營收</span>}
                value={revenueTotal}
                prefix="NT$"
                precision={0}
                valueStyle={{ fontWeight: 600 }}
              />
              <div className="mt-1 text-xs text-slate-500">
                {orderTotal.toLocaleString()} 筆訂單
                {hasHistorySummary && filteredOrders.length ? ` · 列表顯示 ${filteredOrders.length} 筆` : ''}
              </div>
            </Card>
          </motion.div>
        </Col>

        <Col xs={24} md={8}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="glass-card !border-0 h-32 flex flex-col justify-center">
              <Statistic
                title={<span className="text-gray-500 font-medium">已付款率</span>}
                value={paidRate}
                suffix="%"
                precision={1}
                valueStyle={{ fontWeight: 600 }}
              />
              <div className="mt-1 text-xs text-slate-500">
                依目前列表：已付款 {paidLikeOrders} 筆 / 已完成 {completedOrders} 筆
              </div>
            </Card>
          </motion.div>
        </Col>

        <Col xs={24} md={8}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="glass-card !border-0 h-32 flex flex-col justify-center">
              <Statistic
                title={<span className="text-gray-500 font-medium">平均客單價</span>}
                value={averageOrderValue}
                prefix="NT$"
                precision={0}
                valueStyle={{ fontWeight: 600 }}
              />
              <div className="mt-1 text-xs text-slate-500">
                手續費 NT$ {feeTotal.toLocaleString()} · 淨額 NT$ {netRevenue.toLocaleString()}
              </div>
            </Card>
          </motion.div>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={16}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="h-full">
            <Card className="glass-card !border-0 h-full" title={<Space><LineChartOutlined /> <span className="text-sm font-medium">營收與訂單趨勢</span></Space>}>
              <div className="h-[300px] w-full">
                {trendData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <Tooltip />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <Legend />
                      <Bar dataKey="revenue" name="營收" fill="#1890ff" radius={[4, 4, 0, 0]} barSize={24} />
                      <Line type="monotone" dataKey="orders" name="訂單數" stroke="#52c41a" strokeWidth={3} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty description="這個區間目前沒有真實訂單資料" />
                )}
              </div>
            </Card>
          </motion.div>
        </Col>

        <Col xs={24} lg={8}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="h-full">
            <Card className="glass-card !border-0 h-full" title={<Space><PieChartOutlined /> <span className="text-sm font-medium">平台業績占比</span></Space>}>
              <div className="h-[300px] w-full relative">
                {platformMix.length ? (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={platformMix} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                          {platformMix.map((entry, index) => (
                            <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                      <div className="text-xl font-bold text-gray-700">
                        {topSource?.name || '—'}
                      </div>
                      <div className="text-xs text-gray-400">
                        {topSource ? `NT$ ${topSource.value.toLocaleString()}` : '無資料'}
                      </div>
                    </div>
                  </>
                ) : (
                  <Empty description="平台占比尚無資料" />
                )}
              </div>
            </Card>
          </motion.div>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={8}>
          <Card className="glass-card !border-0 h-full" title={<span className="text-sm font-medium">官網 / 團購 / 其他</span>}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Text className="text-slate-500">官網業績</Text>
                <Text strong>NT$ {salesMixSummary.officialSiteRevenue.toLocaleString()}</Text>
              </div>
              <div className="flex items-center justify-between">
                <Text className="text-slate-500">團購業績</Text>
                <Text strong>NT$ {salesMixSummary.groupBuyRevenue.toLocaleString()}</Text>
              </div>
              <div className="flex items-center justify-between">
                <Text className="text-slate-500">其他業績</Text>
                <Text strong>NT$ {salesMixSummary.otherRevenue.toLocaleString()}</Text>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                官網佔比 {salesMixSummary.total ? ((salesMixSummary.officialSiteRevenue / salesMixSummary.total) * 100).toFixed(1) : '0.0'}%
                {' · '}
                團購佔比 {salesMixSummary.total ? ((salesMixSummary.groupBuyRevenue / salesMixSummary.total) * 100).toFixed(1) : '0.0'}%
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card className="glass-card !border-0 h-full" title={<span className="text-sm font-medium">平台業績排行</span>}>
            <div className="space-y-3">
              {platformMix.slice(0, 5).map((item, index) => (
                <div key={item.name} className="flex items-center justify-between gap-4 rounded-2xl bg-white/70 px-4 py-3">
                  <div>
                    <div className="text-xs text-slate-400">#{index + 1}</div>
                    <div className="font-medium text-slate-800">{item.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-900">NT$ {item.value.toLocaleString()}</div>
                    <div className="text-xs text-slate-400">
                      {salesMixSummary.total ? ((item.value / salesMixSummary.total) * 100).toFixed(1) : '0.0'}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card className="glass-card !border-0 h-full" title={<span className="text-sm font-medium">品牌銷售排行</span>}>
            <div className="space-y-3">
              {brandMix.slice(0, 5).map((item, index) => (
                <div key={item.name} className="flex items-center justify-between gap-4 rounded-2xl bg-white/70 px-4 py-3">
                  <div>
                    <div className="text-xs text-slate-400">#{index + 1}</div>
                    <div className="font-medium text-slate-800">{item.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-900">NT$ {item.value.toLocaleString()}</div>
                    <div className="text-xs text-slate-400">{item.orders.toLocaleString()} 筆</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      <div className="rounded-3xl bg-[linear-gradient(90deg,#1d4ed8,#6d28d9,#7c3aed)] px-6 py-5 text-white shadow-lg">
        <div className="text-sm font-semibold">AI 智慧洞察</div>
        <div className="mt-2 text-sm leading-7 text-white/90">
          {topSource
            ? `目前 ${topSource.name} 是主要平台來源，貢獻 NT$ ${topSource.value.toLocaleString()}。${topBrand ? `${topBrand.name} 則是目前主要品牌，累積銷售 NT$ ${topBrand.value.toLocaleString()}。` : ''} 建議優先檢查這個平台與品牌的高營收訂單、待對帳款項與客戶回購情況。`
            : '目前還沒有足夠的真實訂單資料可供 AI 洞察，先同步 Shopify / 團購 / Shopline 訂單後，這裡就會開始變成真實營運面板。'}
        </div>
      </div>
    </div>
  )
}

export default SalesAnalytics
