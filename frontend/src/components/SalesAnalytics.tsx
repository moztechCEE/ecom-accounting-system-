import React, { useMemo } from 'react'
import { Card, Statistic, Row, Col, Typography, Space, Empty } from 'antd'
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

const { Text, Title } = Typography

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']

const SalesAnalytics: React.FC<{
  orders: SalesOrder[]
  rangeLabel: string
}> = ({ orders, rangeLabel }) => {
  const filteredOrders = orders
  const revenueTotal = filteredOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0)
  const completedOrders = filteredOrders.filter((order) => order.status === 'completed').length
  const paidLikeOrders = filteredOrders.filter((order) => {
    const totalAmount = Number(order.totalAmount || 0)
    const paidAmount = Number(order.paidAmountOriginal || 0)
    return totalAmount > 0 && paidAmount >= totalAmount
  }).length
  const averageOrderValue = filteredOrders.length ? revenueTotal / filteredOrders.length : 0
  const paidRate = filteredOrders.length ? (paidLikeOrders / filteredOrders.length) * 100 : 0
  const feeTotal = filteredOrders.reduce(
    (sum, order) => sum + Number(order.feeGatewayOriginal || 0) + Number(order.feePlatformOriginal || 0),
    0,
  )
  const netRevenue = filteredOrders.reduce((sum, order) => sum + Number(order.amountNetOriginal || 0), 0)

  const trendData = useMemo(() => {
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
  }, [filteredOrders, rangeLabel])

  const pieData = useMemo(() => {
    const bucket = new Map<string, number>()
    filteredOrders.forEach((order) => {
      const key = order.sourceBrand || order.sourceLabel || order.channelName || '其他來源'
      bucket.set(key, (bucket.get(key) || 0) + Number(order.totalAmount || 0))
    })
    return Array.from(bucket.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 6)
  }, [filteredOrders])

  const topSource = pieData[0]

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
        <div className="rounded-full bg-white/70 px-3 py-2 text-xs text-slate-500 shadow-sm">
          統計區間：{rangeLabel}
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
                {filteredOrders.length} 筆訂單
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
                已付款 {paidLikeOrders} 筆 / 已完成 {completedOrders} 筆
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
            <Card className="glass-card !border-0 h-full" title={<Space><PieChartOutlined /> <span className="text-sm font-medium">來源品牌占比</span></Space>}>
              <div className="h-[300px] w-full relative">
                {pieData.length ? (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                          {pieData.map((entry, index) => (
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
                  <Empty description="來源占比尚無資料" />
                )}
              </div>
            </Card>
          </motion.div>
        </Col>
      </Row>

      <div className="rounded-3xl bg-[linear-gradient(90deg,#1d4ed8,#6d28d9,#7c3aed)] px-6 py-5 text-white shadow-lg">
        <div className="text-sm font-semibold">AI 智慧洞察</div>
        <div className="mt-2 text-sm leading-7 text-white/90">
          {topSource
            ? `目前 ${topSource.name} 是主要來源，這個區間貢獻 NT$ ${topSource.value.toLocaleString()}。建議搭配訂單列表的來源與客群欄位，優先檢查該來源的高價值客戶與待對帳訂單。`
            : '目前還沒有足夠的真實訂單資料可供 AI 洞察，先同步 Shopify / 團購 / Shopline 訂單後，這裡就會開始變成真實營運面板。'}
        </div>
      </div>
    </div>
  )
}

export default SalesAnalytics
