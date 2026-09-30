import React, { useState, useEffect, useMemo, useRef } from 'react'
import { 
  Alert,
  Typography, 
  Card, 
  Row, 
  Col, 
  DatePicker, 
  Button, 
  Tabs, 
  Table, 
  Tag, 
  Statistic,
  Select,
  message,
  Empty,
  Spin,
  Descriptions,
} from 'antd'
import { 
  RiseOutlined, 
  PieChartOutlined,
  BarChartOutlined,
  FileTextOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from 'recharts'
import dayjs from 'dayjs'
import {
  accountingService,
  IncomeStatement,
  BalanceSheet,
  GeneralLedger,
  TrialBalance,
} from '../services/accounting.service'
import {
  dashboardService,
  DashboardOperationsHub,
  EcommerceHistory,
  ManagementSummary,
  ManagementSummaryGroupBy,
  MonthlyChannelReconciliation,
  OrderReconciliationAudit,
} from '../services/dashboard.service'
import { invoicingService, InvoiceQueueResponse } from '../services/invoicing.service'
import { resolveEntityId } from '../services/entities.service'
import { useAuth } from '../contexts/AuthContext'
import { hasPermission } from '../utils/access'

const { Title, Text } = Typography
const { RangePicker } = DatePicker
const { TabPane } = Tabs

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const safeArray = <T,>(value: T[] | null | undefined): T[] => (
  Array.isArray(value) ? value : []
)

const formatNumber = (value: unknown, options?: Intl.NumberFormatOptions) =>
  toNumber(value).toLocaleString('zh-TW', options)

const formatMoney = (value: unknown) => `NT$ ${formatNumber(value, { maximumFractionDigits: 0 })}`

const formatPercent = (value: unknown, digits = 2) => `${toNumber(value).toFixed(digits)}%`

const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const formatOptionalNumber = (value: unknown) => {
  const number = optionalNumber(value)
  return number === null ? '—' : formatNumber(number)
}

const formatOptionalPercent = (value: unknown) => {
  const number = optionalNumber(value)
  return number === null ? '—' : formatPercent(number)
}

const statisticValue = (value: unknown) => optionalNumber(value) ?? '—'

interface ReportRow {
  key: string
  category: string
  amount: number | null
  percentage?: string
  type?: string
  isHeader?: boolean
  isTotal?: boolean
  isNet?: boolean
}

const ReportsPage: React.FC = () => {
  const { user } = useAuth()
  const canViewCost = hasPermission(user, 'product_cost:read')
  const canViewMargin = canViewCost && hasPermission(user, 'financial_margin:read')
  const canViewNetProfit = canViewMargin && hasPermission(user, 'financial_net_profit:read')
  const reportRequestRef = useRef(0)
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('year'), dayjs()])
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatement | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null)
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null)
  const [generalLedger, setGeneralLedger] = useState<GeneralLedger | null>(null)
  const [operationsHub, setOperationsHub] = useState<DashboardOperationsHub | null>(null)
  const [managementSummary, setManagementSummary] = useState<ManagementSummary | null>(null)
  const [ecommerceHistory, setEcommerceHistory] = useState<EcommerceHistory | null>(null)
  const [managementGroupBy, setManagementGroupBy] = useState<ManagementSummaryGroupBy>('month')
  const [monthlyReconciliation, setMonthlyReconciliation] = useState<MonthlyChannelReconciliation | null>(null)
  const [invoiceQueue, setInvoiceQueue] = useState<InvoiceQueueResponse | null>(null)
  const [reconciliationAudit, setReconciliationAudit] = useState<OrderReconciliationAudit | null>(null)
  const [loadIssues, setLoadIssues] = useState<string[]>([])

  const ecommercePeriods = useMemo(() => safeArray(ecommerceHistory?.periods), [ecommerceHistory])
  const ecommerceBrands = useMemo(() => safeArray(ecommerceHistory?.brands), [ecommerceHistory])
  const ecommerceProducts = useMemo(() => safeArray(ecommerceHistory?.products), [ecommerceHistory])
  const managementPeriods = useMemo(() => safeArray(managementSummary?.periods), [managementSummary])

  const ecommercePlatformMix = useMemo(() => {
    const bucket = new Map<string, number>()

    ecommerceBrands.forEach((item) => {
      const key = item.sourceLabel || item.channelCode || '其他來源'
      bucket.set(key, (bucket.get(key) || 0) + toNumber(item.revenue))
    })

    return Array.from(bucket.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value)
  }, [ecommerceBrands])

  const ecommerceBrandMix = useMemo(() => {
    const bucket = new Map<string, { revenue: number; orders: number }>()

    ecommerceBrands.forEach((item) => {
      const key = item.brand || '未分類品牌'
      const current = bucket.get(key) || { revenue: 0, orders: 0 }
      current.revenue += toNumber(item.revenue)
      current.orders += toNumber(item.orderCount)
      bucket.set(key, current)
    })

    return Array.from(bucket.entries())
      .map(([name, value]) => ({
        name,
        revenue: value.revenue,
        orders: value.orders,
        sharePct: ecommerceHistory?.summary?.revenue
          ? (value.revenue / toNumber(ecommerceHistory.summary.revenue || 1)) * 100
          : 0,
      }))
      .sort((left, right) => right.revenue - left.revenue)
  }, [ecommerceBrands, ecommerceHistory])

  const ecommerceMixSummary = useMemo(() => {
    const total = ecommercePlatformMix.reduce((sum, item) => sum + item.value, 0)
    const groupBuyRevenue = ecommercePlatformMix
      .filter((item) => item.name.includes('團購') || item.name.includes('萬魔') || item.name.includes('1Shop'))
      .reduce((sum, item) => sum + item.value, 0)
    const officialSiteRevenue = ecommercePlatformMix
      .filter((item) => item.name.includes('官網') || item.name.includes('MOZTECH') || item.name.includes('Shopify'))
      .reduce((sum, item) => sum + item.value, 0)
    const otherRevenue = Math.max(total - officialSiteRevenue - groupBuyRevenue, 0)

    return {
      total,
      officialSiteRevenue,
      groupBuyRevenue,
      otherRevenue,
    }
  }, [ecommercePlatformMix])

  const topPlatform = ecommercePlatformMix[0]
  const topBrand = ecommerceBrandMix[0]

  const fetchData = async () => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) return
    const requestId = ++reportRequestRef.current
    setLoading(true)
    setLoadIssues([])
    setIncomeStatement(null)
    setBalanceSheet(null)
    setTrialBalance(null)
    setGeneralLedger(null)
    setOperationsHub(null)
    setManagementSummary(null)
    setEcommerceHistory(null)
    setMonthlyReconciliation(null)
    setInvoiceQueue(null)
    setReconciliationAudit(null)
    try {
      const [start, end] = dateRange
      const entityId = await resolveEntityId()
      const accountingStart = start.startOf('day').toISOString()
      const accountingEnd = end.endOf('day').toISOString()
      const results = await Promise.allSettled([
        canViewNetProfit ? accountingService.getIncomeStatement(accountingStart, accountingEnd, entityId) : Promise.resolve(null),
        canViewNetProfit ? accountingService.getBalanceSheet(accountingEnd, entityId) : Promise.resolve(null),
        canViewNetProfit ? accountingService.getTrialBalance(accountingEnd, entityId) : Promise.resolve(null),
        canViewNetProfit ? accountingService.getGeneralLedger(accountingStart, accountingEnd, entityId) : Promise.resolve(null),
        dashboardService.getOperationsHub({
          entityId,
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        }),
        dashboardService.getManagementSummary({
          entityId,
          groupBy: managementGroupBy,
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        }),
        dashboardService.getEcommerceHistory({
          entityId,
          groupBy: managementGroupBy,
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        }),
        canViewNetProfit ? dashboardService.getMonthlyChannelReconciliation({
          entityId,
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        }) : Promise.resolve(null),
        invoicingService.getQueue({
          entityId,
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          limit: 6,
        }),
        canViewNetProfit ? dashboardService.getOrderReconciliationAudit({
          entityId,
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          limit: 50,
        }) : Promise.resolve(null),
      ])

      if (requestId !== reportRequestRef.current) return

      const failedSections: string[] = []

      const [
        incomeResult,
        balanceResult,
        trialResult,
        ledgerResult,
        operationsResult,
        managementResult,
        ecommerceResult,
        monthlyResult,
        invoiceResult,
        auditResult,
      ] = results

      if (incomeResult.status === 'fulfilled') {
        setIncomeStatement(incomeResult.value)
      } else {
        if (canViewNetProfit) failedSections.push('損益表')
      }

      if (balanceResult.status === 'fulfilled') {
        setBalanceSheet(balanceResult.value)
      } else {
        if (canViewNetProfit) failedSections.push('資產負債表')
      }

      if (trialResult.status === 'fulfilled') {
        setTrialBalance(trialResult.value)
      } else {
        if (canViewNetProfit) failedSections.push('試算表')
      }

      if (ledgerResult.status === 'fulfilled') {
        setGeneralLedger(ledgerResult.value)
      } else {
        if (canViewNetProfit) failedSections.push('總分類帳')
      }

      if (operationsResult.status === 'fulfilled') {
        setOperationsHub(operationsResult.value)
      } else {
        failedSections.push('營運總控台')
      }

      if (managementResult.status === 'fulfilled') {
        setManagementSummary(managementResult.value)
      } else {
        failedSections.push('營運彙整')
      }

      if (ecommerceResult.status === 'fulfilled') {
        setEcommerceHistory(ecommerceResult.value)
      } else {
        failedSections.push('電商資料整合')
      }

      if (monthlyResult.status === 'fulfilled') {
        setMonthlyReconciliation(monthlyResult.value)
      } else {
        if (canViewNetProfit) failedSections.push('月度對帳矩陣')
      }

      if (invoiceResult.status === 'fulfilled') {
        setInvoiceQueue(invoiceResult.value)
      } else {
        failedSections.push('發票閉環')
      }

      if (auditResult.status === 'fulfilled') {
        setReconciliationAudit(auditResult.value)
      } else {
        if (canViewNetProfit) failedSections.push('逐筆對帳稽核')
      }

      setLoadIssues(failedSections)
      if (failedSections.length) {
        message.warning(`部分報表區塊讀取失敗：${failedSections.join('、')}`)
      }
    } catch (error) {
      if (requestId !== reportRequestRef.current) return
      console.error(error)
      setLoadIssues(['整體讀取'])
      message.error('無法載入報表數據')
    } finally {
      if (requestId === reportRequestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [dateRange, managementGroupBy, canViewCost, canViewMargin, canViewNetProfit])

  // Transform Income Statement Data
  const getPLData = (): ReportRow[] => {
    if (!incomeStatement) return []
    const totalRev = toNumber(incomeStatement.totalRevenue) || 1 // Avoid division by zero
    
    const revenues: ReportRow[] = safeArray(incomeStatement.revenues).map(r => ({
      key: r.code,
      category: r.name,
      amount: toNumber(r.amount),
      percentage: formatPercent((toNumber(r.amount) / totalRev) * 100, 1),
      type: 'revenue'
    }))

    const expenses: ReportRow[] = safeArray(incomeStatement.expenses).map(e => ({
      key: e.code,
      category: e.name,
      amount: toNumber(e.amount), // Keep positive for display, but logic knows it's expense
      percentage: formatPercent((toNumber(e.amount) / totalRev) * 100, 1),
      type: 'expense'
    }))

    return [
      { key: 'header_rev', category: '營業收入', amount: null, isHeader: true },
      ...revenues,
      { key: 'total_rev', category: '總收入', amount: toNumber(incomeStatement.totalRevenue), isTotal: true },
      { key: 'header_exp', category: '營業費用', amount: null, isHeader: true },
      ...expenses,
      { key: 'total_exp', category: '總費用', amount: toNumber(incomeStatement.totalExpense), isTotal: true },
      { key: 'net_income', category: '淨利', amount: optionalNumber(incomeStatement.netIncome), isTotal: true, isNet: true }
    ]
  }

  // Transform Balance Sheet Data
  const getBSData = (): ReportRow[] => {
    if (!balanceSheet) return []
    
    const assets = safeArray(balanceSheet.assets).map(a => ({ ...a, type: 'asset' }))
    const liabilities = safeArray(balanceSheet.liabilities).map(l => ({ ...l, type: 'liability' }))
    const equity = safeArray(balanceSheet.equity).map(e => ({ ...e, type: 'equity' }))
    const totalLiabilities = toNumber(balanceSheet.totalLiabilities)
    const totalEquity = toNumber(balanceSheet.totalEquity)
    const retainedEarnings = typeof balanceSheet.calculatedRetainedEarnings === 'number'
      && Number.isFinite(balanceSheet.calculatedRetainedEarnings)
      ? balanceSheet.calculatedRetainedEarnings
      : null
    const displayedTotalEquity = totalEquity + (retainedEarnings ?? 0)

    return [
      { key: 'header_asset', category: '資產', amount: null, isHeader: true },
      ...assets.map(a => ({ key: a.code, category: a.name, amount: toNumber(a.amount) })),
      { key: 'total_asset', category: '資產總計', amount: toNumber(balanceSheet.totalAssets), isTotal: true },
      
      { key: 'header_liab', category: '負債', amount: null, isHeader: true },
      ...liabilities.map(l => ({ key: l.code, category: l.name, amount: toNumber(l.amount) })),
      { key: 'total_liab', category: '負債總計', amount: totalLiabilities, isTotal: true },
      
      { key: 'header_equity', category: '權益', amount: null, isHeader: true },
      ...equity.map(e => ({ key: e.code, category: e.name, amount: toNumber(e.amount) })),
      {
        key: 'retained_earnings',
        category: retainedEarnings === null
          ? '本期損益（尚未完成結轉）'
          : '本期損益',
        amount: retainedEarnings,
      },
      { key: 'total_equity', category: '權益總計', amount: displayedTotalEquity, isTotal: true },
      
      { key: 'total_liab_equity', category: '負債與權益總計', amount: totalLiabilities + displayedTotalEquity, isTotal: true, isNet: true }
    ]
  }

  const balanceSheetDifference = balanceSheet && Number.isFinite(Number(balanceSheet.difference))
    ? Number(balanceSheet.difference)
    : null
  const hasCalculatedRetainedEarnings = typeof balanceSheet?.calculatedRetainedEarnings === 'number'
    && Number.isFinite(balanceSheet.calculatedRetainedEarnings)
  const isBalanceSheetBalanced = Boolean(
    balanceSheet
      && balanceSheet.balanced === true
      && balanceSheetDifference !== null
      && Math.abs(balanceSheetDifference) <= 0.01,
  )

  // Expense Analysis Data
  const getExpenseData = () => {
    if (!incomeStatement) return []
    return safeArray(incomeStatement.expenses).map(e => ({
      name: e.name,
      value: toNumber(e.amount)
    })).sort((a, b) => b.value - a.value)
  }

  const columns = [
    {
      title: '項目',
      dataIndex: 'category',
      key: 'category',
      render: (text: string, record: any) => (
        <span className={`
          ${record.isTotal ? 'font-bold text-gray-900' : 'text-gray-600'}
          ${record.isHeader ? 'font-bold text-blue-600 mt-4 block' : ''}
          ${record.isNet ? 'text-lg' : ''}
        `}>
          {text}
        </span>
      ),
    },
    {
      title: '金額',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right' as const,
      render: (value: number | null, record: any) => {
        if (value === null || value === undefined) return null
        const amount = toNumber(value)
        return (
          <span className={`
            ${record.isTotal ? 'font-bold text-gray-900' : 'text-gray-600'}
            ${record.isNet ? 'text-lg text-blue-600' : ''}
          `}>
            {amount < 0 ? `(${formatNumber(Math.abs(amount))})` : formatNumber(amount)}
          </span>
        )
      },
    },
    {
      title: '百分比',
      dataIndex: 'percentage',
      key: 'percentage',
      align: 'right' as const,
      render: (text: string) => <span className="text-gray-500">{text}</span>,
    },
  ]

  return (
    <div className="page-section-stack">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <Title level={2} className="!mb-1 !text-2xl font-light tracking-tight !text-gray-800 sm:!text-3xl">
            報表中心
          </Title>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:w-auto xl:flex xl:flex-wrap xl:justify-end">
          <RangePicker 
            className="w-full sm:col-span-2 xl:w-64"
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs])}
          />
          <Button className="w-full xl:w-auto" icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>重新整理</Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="glass-card min-h-[600px] p-3 sm:p-6">
        <Spin spinning={loading}>
          <Alert
            showIcon
            type="info"
            className="mb-4 rounded-2xl"
            message="報表中心只負責看彙總、佔比與期間報表"
            description="這一頁不處理逐筆核對或會計待辦；銷售訂單看交易明細，對帳中心看是否對上，會計工作台看還缺什麼，報表中心只看營運彙總與佔比。"
          />
          {loadIssues.length ? (
            <Alert
              showIcon
              type="warning"
              className="mb-4 rounded-2xl"
              message="部分報表區塊這次沒有讀取成功"
              description={`目前失敗區塊：${loadIssues.join('、')}。其餘已成功讀到的區塊仍會先顯示，不會整頁空白。`}
            />
          ) : null}
          {canViewNetProfit && managementSummary?.releaseGate?.status === 'blocked' ? (
            <Alert
              showIcon
              type="error"
              className="mb-4 rounded-2xl"
              message={`財務報表暫不可發布：尚有 ${managementSummary.journalApproval.counts.unapproved} 筆未審核分錄`}
              description={managementSummary.releaseGate.reason}
            />
          ) : canViewNetProfit && managementSummary?.releaseGate?.status === 'ready' ? (
            <Alert
              showIcon
              type="success"
              className="mb-4 rounded-2xl"
              message="所選區間分錄審核閘門已通過"
              description="正式損益表、資產負債表、試算表與總分類帳只採用已審核分錄。"
            />
          ) : null}
          <Tabs defaultActiveKey={canViewNetProfit ? '1' : '0.7'} type="card" size="large" className="custom-tabs">
            <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <PieChartOutlined />
                  電商資料整合
                </span>
              }
              key="0.7"
            >
              <Row gutter={[16, 16]}>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="歷年電商營收" value={ecommerceHistory ? (ecommerceHistory.summary?.revenue ?? 0) : '—'} precision={0} prefix={ecommerceHistory ? 'NT$' : undefined} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="訂單數" value={ecommerceHistory ? (ecommerceHistory.summary?.orderCount ?? 0) : '—'} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="客戶數" value={ecommerceHistory ? (ecommerceHistory.summary?.customerCount ?? 0) : '—'} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="品牌 / 商品" value={ecommerceHistory ? `${ecommerceHistory.summary?.brandCount ?? 0} / ${ecommerceHistory.summary?.productCount ?? 0}` : '—'} />
                  </Card>
                </Col>
              </Row>

              <Row gutter={[16, 16]} className="mt-4">
                <Col xs={24} lg={10}>
                  <Card title="歷年電商業績趨勢" bordered={false} className="shadow-sm h-full">
                    {ecommercePeriods.length ? (
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={ecommercePeriods}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" />
                            <YAxis />
                            <Tooltip formatter={(value: number) => formatMoney(value)} />
                            <Legend />
                            <Bar dataKey="revenue" name="營收" fill="#2563eb" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <Empty description="尚無歷年電商資料" />}
                  </Card>
                </Col>
                <Col xs={24} lg={14}>
                  <Card title="品牌 / 來源 / 顧客彙整" bordered={false} className="shadow-sm h-full">
                    <Table
                      rowKey={(record) => `${record.brand}-${record.sourceLabel}`}
                      dataSource={ecommerceBrands}
                      size="small"
                      scroll={{ x: 980 }}
                      pagination={{ pageSize: 8 }}
                      columns={[
                        {
                          title: '品牌 / 來源',
                          key: 'brand',
                          render: (_, record) => (
                            <div>
                              <div className="font-medium text-slate-900">{record.brand}</div>
                              <div className="text-xs text-slate-400">
                                {record.sourceLabel} · {record.channelCode || 'OTHER'}
                              </div>
                            </div>
                          ),
                        },
                        {
                          title: '營收',
                          dataIndex: 'revenue',
                          key: 'revenue',
                          align: 'right',
                          render: (value: number) => formatNumber(value),
                        },
                        {
                          title: '訂單 / 顧客',
                          key: 'counts',
                          align: 'right',
                          render: (_, record) => `${record.orderCount} / ${record.customerCount}`,
                        },
                        {
                          title: '客單價',
                          dataIndex: 'averageOrderValue',
                          key: 'averageOrderValue',
                          align: 'right',
                          render: (value: number) => formatNumber(value),
                        },
                        {
                          title: '熱銷商品',
                          key: 'topProducts',
                          render: (_, record) => (
                            <div className="flex flex-wrap gap-1">
                              {safeArray(record.topProducts).map((item) => (
                              <Tag key={`${record.brand}-${item.sku}`} color="blue">
                                  {item.sku} × {item.quantity}
                                </Tag>
                              ))}
                            </div>
                          ),
                        },
                      ]}
                      locale={{ emptyText: <Empty description="尚無品牌 / 顧客整合資料" /> }}
                    />
                  </Card>
                </Col>
              </Row>

              <div className="mt-4">
                <Row gutter={[16, 16]} className="mb-4">
                  <Col xs={24} lg={9}>
                    <Card title="平台業績佔比" bordered={false} className="shadow-sm h-full">
                      {ecommercePlatformMix.length ? (
                        <div className="h-[260px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={ecommercePlatformMix}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={60}
                                outerRadius={92}
                                paddingAngle={3}
                              >
                                {ecommercePlatformMix.map((entry, index) => (
                                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value: number) => formatMoney(value)} />
                              <Legend />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <Empty description="尚無平台業績佔比資料" />
                      )}
                    </Card>
                  </Col>
                  <Col xs={24} lg={15}>
                    <Card title="平台 / 品牌營收摘要" bordered={false} className="shadow-sm h-full">
                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={8}>
                          <div className="rounded-2xl bg-slate-50 px-4 py-4 h-full">
                            <div className="text-xs text-slate-400">官網業績</div>
                            <div className="mt-2 text-2xl font-semibold text-slate-900">
                              {ecommerceHistory ? formatMoney(ecommerceMixSummary.officialSiteRevenue) : '—'}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {ecommerceHistory ? `佔比 ${formatPercent(ecommerceMixSummary.total ? (ecommerceMixSummary.officialSiteRevenue / ecommerceMixSummary.total) * 100 : 0, 1)}` : '資料未取得'}
                            </div>
                          </div>
                        </Col>
                        <Col xs={24} md={8}>
                          <div className="rounded-2xl bg-slate-50 px-4 py-4 h-full">
                            <div className="text-xs text-slate-400">團購業績</div>
                            <div className="mt-2 text-2xl font-semibold text-slate-900">
                              {ecommerceHistory ? formatMoney(ecommerceMixSummary.groupBuyRevenue) : '—'}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {ecommerceHistory ? `佔比 ${formatPercent(ecommerceMixSummary.total ? (ecommerceMixSummary.groupBuyRevenue / ecommerceMixSummary.total) * 100 : 0, 1)}` : '資料未取得'}
                            </div>
                          </div>
                        </Col>
                        <Col xs={24} md={8}>
                          <div className="rounded-2xl bg-slate-50 px-4 py-4 h-full">
                            <div className="text-xs text-slate-400">其他來源</div>
                            <div className="mt-2 text-2xl font-semibold text-slate-900">
                              {ecommerceHistory ? formatMoney(ecommerceMixSummary.otherRevenue) : '—'}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {ecommerceHistory ? `佔比 ${formatPercent(ecommerceMixSummary.total ? (ecommerceMixSummary.otherRevenue / ecommerceMixSummary.total) * 100 : 0, 1)}` : '資料未取得'}
                            </div>
                          </div>
                        </Col>
                      </Row>

                      <Row gutter={[16, 16]} className="mt-4">
                        <Col xs={24} md={12}>
                          <div className="rounded-2xl border border-slate-100 px-4 py-4 h-full">
                            <div className="text-xs tracking-[0.2em] text-slate-400 uppercase">Top Platform</div>
                            <div className="mt-3 text-lg font-semibold text-slate-900">{topPlatform?.name || '尚無資料'}</div>
                            <div className="mt-1 text-sm text-slate-500">
                              {topPlatform ? `${formatMoney(topPlatform.value)} · ${formatPercent(ecommerceMixSummary.total ? (topPlatform.value / ecommerceMixSummary.total) * 100 : 0, 1)}` : '等待資料'}
                            </div>
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="rounded-2xl border border-slate-100 px-4 py-4 h-full">
                            <div className="text-xs tracking-[0.2em] text-slate-400 uppercase">Top Brand</div>
                            <div className="mt-3 text-lg font-semibold text-slate-900">{topBrand?.name || '尚無資料'}</div>
                            <div className="mt-1 text-sm text-slate-500">
                              {topBrand ? `${formatMoney(topBrand.revenue)} · ${formatPercent(topBrand.sharePct, 1)}` : '等待資料'}
                            </div>
                          </div>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>

                <Row gutter={[16, 16]} className="mb-4">
                  <Col xs={24} lg={12}>
                    <Card title="平台業績排行" bordered={false} className="shadow-sm">
                      <Table
                        rowKey="name"
                        dataSource={ecommercePlatformMix.slice(0, 8)}
                        size="small"
                        scroll={{ x: 520 }}
                        pagination={false}
                        columns={[
                          {
                            title: '平台 / 來源',
                            dataIndex: 'name',
                            key: 'name',
                          },
                          {
                            title: '營收',
                            dataIndex: 'value',
                            key: 'value',
                            align: 'right',
                            render: (value: number) => formatNumber(value),
                          },
                          {
                            title: '佔比',
                            key: 'share',
                            align: 'right',
                            render: (_, record) => formatPercent(ecommerceMixSummary.total ? (record.value / ecommerceMixSummary.total) * 100 : 0, 1),
                          },
                        ]}
                        locale={{ emptyText: <Empty description="尚無平台排行資料" /> }}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card title="品牌銷售排行" bordered={false} className="shadow-sm">
                      <Table
                        rowKey="name"
                        dataSource={ecommerceBrandMix.slice(0, 8)}
                        size="small"
                        scroll={{ x: 620 }}
                        pagination={false}
                        columns={[
                          {
                            title: '品牌',
                            dataIndex: 'name',
                            key: 'name',
                          },
                          {
                            title: '營收',
                            dataIndex: 'revenue',
                            key: 'revenue',
                            align: 'right',
                            render: (value: number) => formatNumber(value),
                          },
                          {
                            title: '訂單數',
                            dataIndex: 'orders',
                            key: 'orders',
                            align: 'right',
                          },
                          {
                            title: '佔比',
                            dataIndex: 'sharePct',
                            key: 'sharePct',
                            align: 'right',
                            render: (value: number) => formatPercent(value, 1),
                          },
                        ]}
                        locale={{ emptyText: <Empty description="尚無品牌排行資料" /> }}
                      />
                    </Card>
                  </Col>
                </Row>

                <Card title="商品與品牌細項" bordered={false} className="shadow-sm">
                  <Table
                    rowKey={(record) => `${record.brand}-${record.sku}`}
                    dataSource={ecommerceProducts}
                    size="small"
                    scroll={{ x: 980 }}
                    pagination={{ pageSize: 10 }}
                    columns={[
                      {
                        title: '商品',
                        key: 'product',
                        render: (_, record) => (
                          <div>
                            <div className="font-medium text-slate-900">{record.name}</div>
                            <div className="text-xs text-slate-400">
                              {record.sku} · {record.category || '未分類'}
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: '品牌',
                        dataIndex: 'brand',
                        key: 'brand',
                      },
                      {
                        title: '營收',
                        dataIndex: 'revenue',
                        key: 'revenue',
                        align: 'right',
                        render: (value: number) => formatNumber(value),
                      },
                      {
                        title: '數量',
                        dataIndex: 'quantity',
                        key: 'quantity',
                        align: 'right',
                        render: (value: number) => formatNumber(value),
                      },
                      {
                        title: '訂單數',
                        dataIndex: 'orderCount',
                        key: 'orderCount',
                        align: 'right',
                      },
                    ]}
                    locale={{ emptyText: <Empty description="尚無商品分類資料" /> }}
                  />
                </Card>
              </div>
            </TabPane>

            <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <RiseOutlined />
                  營運彙整
                </span>
              }
              key="0.5"
            >
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <Title level={4} className="!mb-1 !text-slate-800">
                    年 / 季 / 月 / 週管理報表
                  </Title>
                  <Text className="text-slate-500">
                    {canViewCost || canViewMargin || canViewNetProfit
                      ? '依真實訂單與收款彙整營運數字；成本與損益僅顯示已授權資料。'
                      : '依真實訂單與收款彙整營運數字。'}
                  </Text>
                </div>
                <Select<ManagementSummaryGroupBy>
                  value={managementGroupBy}
                  onChange={setManagementGroupBy}
                  options={[
                    { label: '年度', value: 'year' },
                    { label: '季度', value: 'quarter' },
                    { label: '月度', value: 'month' },
                    { label: '每週', value: 'week' },
                  ]}
                  style={{ width: 160 }}
                />
              </div>

              <Row gutter={[16, 16]}>
                <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="營業額" value={statisticValue(managementSummary?.summary?.revenue)} precision={0} prefix={optionalNumber(managementSummary?.summary?.revenue) === null ? undefined : 'NT$'} />
                  </Card>
                </Col>
                {canViewMargin ? <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="毛利" value={statisticValue(managementSummary?.summary?.grossProfit)} precision={0} prefix={optionalNumber(managementSummary?.summary?.grossProfit) === null ? undefined : 'NT$'} />
                  </Card>
                </Col> : null}
                {canViewMargin ? <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="毛利率" value={statisticValue(managementSummary?.summary?.grossMarginPct)} precision={2} suffix={optionalNumber(managementSummary?.summary?.grossMarginPct) === null ? undefined : '%'} />
                  </Card>
                </Col> : null}
                {canViewNetProfit ? <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="淨利" value={statisticValue(managementSummary?.summary?.netProfit)} precision={0} prefix={optionalNumber(managementSummary?.summary?.netProfit) === null ? undefined : 'NT$'} />
                  </Card>
                </Col> : null}
                {canViewNetProfit ? <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="手續費" value={statisticValue(managementSummary?.summary?.feeTotal)} precision={0} prefix={optionalNumber(managementSummary?.summary?.feeTotal) === null ? undefined : 'NT$'} />
                  </Card>
                </Col> : null}
                <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="應收未收" value={statisticValue(managementSummary?.summary?.openArAmount)} precision={0} prefix={optionalNumber(managementSummary?.summary?.openArAmount) === null ? undefined : 'NT$'} />
                  </Card>
                </Col>
              </Row>

              <Row gutter={[16, 16]} className="mt-4">
                <Col xs={24} lg={10}>
                    <Card title="趨勢總覽" bordered={false} className="shadow-sm h-full">
                    {managementPeriods.length ? (
                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={managementPeriods}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" />
                            <YAxis />
                            <Tooltip formatter={(value: number) => formatMoney(value)} />
                            <Legend />
                            <Line type="monotone" dataKey="revenue" name="營業額" stroke="#2563eb" strokeWidth={2} />
                            {canViewMargin ? <Line type="monotone" dataKey="grossProfit" name="毛利" stroke="#16a34a" strokeWidth={2} /> : null}
                            {canViewNetProfit ? <Line type="monotone" dataKey="netProfit" name="淨利" stroke="#f97316" strokeWidth={2} /> : null}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <Empty description="尚無營運彙整資料" />}
                  </Card>
                </Col>
                <Col xs={24} lg={14}>
                  <Card title="管理報表明細" bordered={false} className="shadow-sm h-full">
                    <Table
                      rowKey="key"
                      dataSource={managementPeriods}
                      size="small"
                      scroll={{ x: 1320 }}
                      pagination={{ pageSize: 8 }}
                      columns={[
                        {
                          title: '期間',
                          dataIndex: 'label',
                          key: 'label',
                          width: 120,
                        },
                        {
                          title: '營業額',
                          dataIndex: 'revenue',
                          key: 'revenue',
                          align: 'right',
                          render: (value: number) => formatNumber(value),
                        },
                        ...(canViewCost ? [{
                          title: '估算成本',
                          dataIndex: 'estimatedCogs',
                          key: 'estimatedCogs',
                          align: 'right' as const,
                          render: (value: number | null | undefined) => formatOptionalNumber(value),
                        }] : []),
                        ...(canViewMargin ? [{
                          title: '毛利 / 毛利率',
                          key: 'grossProfit',
                          align: 'right' as const,
                          render: (_: unknown, record: typeof managementPeriods[number]) => `${formatOptionalNumber(record.grossProfit)} / ${formatOptionalPercent(record.grossMarginPct)}`,
                        }] : []),
                        ...(canViewNetProfit ? [{
                          title: '手續費',
                          dataIndex: 'feeTotal',
                          key: 'feeTotal',
                          align: 'right' as const,
                          render: (value: number | null | undefined) => formatOptionalNumber(value),
                        }] : []),
                        ...(canViewNetProfit ? [{
                          title: '營運費用',
                          dataIndex: 'operatingExpenses',
                          key: 'operatingExpenses',
                          align: 'right' as const,
                          render: (value: number | null | undefined) => formatOptionalNumber(value),
                        }] : []),
                        ...(canViewNetProfit ? [{
                          title: '淨利 / 淨利率',
                          key: 'netProfit',
                          align: 'right' as const,
                          render: (_: unknown, record: typeof managementPeriods[number]) => `${formatOptionalNumber(record.netProfit)} / ${formatOptionalPercent(record.netMarginPct)}`,
                        }] : []),
                        {
                          title: '已收率',
                          dataIndex: 'collectedRatePct',
                          key: 'collectedRatePct',
                          align: 'right',
                          render: (value: number) => formatPercent(value),
                        },
                        {
                          title: '應收未收',
                          dataIndex: 'openArAmount',
                          key: 'openArAmount',
                          align: 'right',
                          render: (value: number) => formatNumber(value),
                        },
                      ]}
                      locale={{ emptyText: <Empty description="尚無管理報表資料" /> }}
                    />
                  </Card>
                </Col>
              </Row>
            </TabPane>

            <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <BarChartOutlined />
                  營運總控台
                </span>
              }
              key="0"
            >
              <Row gutter={[16, 16]}>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="在職員工" value={operationsHub ? (operationsHub.people.activeEmployees ?? 0) : '—'} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="待審假單" value={operationsHub ? (operationsHub.people.pendingLeaveRequests ?? 0) : '—'} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="出勤異常" value={operationsHub ? (operationsHub.people.openAttendanceAnomalies ?? 0) : '—'} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="待開票訂單" value={operationsHub ? (operationsHub.invoicing.pendingInvoiceCount ?? 0) : '—'} />
                  </Card>
                </Col>
              </Row>

              <Row gutter={[16, 16]} className="mt-4">
                <Col xs={24} lg={12}>
                  <Card title="薪資與審批" bordered={false} className="shadow-sm h-full">
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="待審薪資批次">
                        {operationsHub ? (operationsHub.payroll.pendingApprovalRuns ?? 0) : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="已核准薪資批次">
                        {operationsHub ? (operationsHub.payroll.approvedRuns ?? 0) : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="已過帳薪資批次">
                        {operationsHub ? (operationsHub.payroll.postedRuns ?? 0) : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="待審費用">
                        {operationsHub ? (operationsHub.approvals.expenseRequests ?? 0) : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="待審分錄">
                        {operationsHub ? (operationsHub.approvals.journalEntries ?? 0) : '—'}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card title="發票閉環" bordered={false} className="shadow-sm h-full">
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="已開票數">
                        {invoiceQueue ? (invoiceQueue.summary?.issuedCount ?? 0) : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="可批次開票">
                        {invoiceQueue ? (invoiceQueue.summary?.eligibleCount ?? 0) : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="待付款後開票">
                        {invoiceQueue ? (invoiceQueue.summary?.waitingPaymentCount ?? 0) : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label="已作廢發票">
                        {invoiceQueue ? (invoiceQueue.summary?.voidCount ?? 0) : '—'}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
              </Row>
            </TabPane>
            
            {/* Formal statements contain account balances and net profit. */}
            {canViewNetProfit ? <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <FileTextOutlined />
                  財務報表
                </span>
              } 
              key="1"
            >
              <Row gutter={[24, 24]}>
                <Col xs={24} lg={12}>
                  <Card title="損益表" bordered={false} className="shadow-sm">
                    {incomeStatement ? (
                      <Table 
                        dataSource={getPLData()} 
                        columns={columns} 
                        pagination={false} 
                        size="small"
                        rowClassName={(record) => record.isTotal ? 'bg-gray-50' : ''}
                      />
                    ) : <Empty description="無資料" />}
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card title="資產負債表" bordered={false} className="shadow-sm">
                    {balanceSheet ? (
                      <>
                        {!isBalanceSheetBalanced ? (
                          <Alert
                            showIcon
                            type="error"
                            className="mb-4"
                            message="資產負債表尚未平衡，不可作為正式財務報表"
                            description={balanceSheetDifference === null
                              ? '系統未取得可驗證的平衡差額。此表僅供資料查核。'
                              : `目前差額為 ${formatMoney(balanceSheetDifference)}。此表僅供資料查核。`}
                          />
                        ) : !hasCalculatedRetainedEarnings ? (
                          <Alert
                            showIcon
                            type="warning"
                            className="mb-4"
                            message="資產負債表目前平衡，但期末損益結轉尚未完成"
                            description="平衡檢查已通過；保留盈餘仍須在正式結帳流程完成後確認。"
                          />
                        ) : null}
                        <Table
                          dataSource={getBSData()}
                          columns={columns.filter(c => c.key !== 'percentage')}
                          pagination={false}
                          size="small"
                          scroll={{ x: 520 }}
                          rowClassName={(record) => record.isTotal ? 'bg-gray-50' : ''}
                        />
                      </>
                    ) : <Empty description="無資料" />}
                  </Card>
                </Col>
              </Row>
            </TabPane> : null}

            {canViewNetProfit ? <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <FileTextOutlined />
                  會計閉環
                </span>
              }
              key="1.5"
            >
              <Row gutter={[24, 24]}>
                <Col xs={24} lg={10}>
                  <Card title="試算表" bordered={false} className="shadow-sm">
                    {trialBalance ? (
                      <>
                        <div className="mb-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
                          <div>
                            <div className="text-slate-400">截止日</div>
                            <div className="font-medium text-slate-800">
                              {dayjs(trialBalance.asOfDate).format('YYYY/MM/DD')}
                            </div>
                          </div>
                          <Tag color={trialBalance.balanced ? 'green' : 'red'}>
                            {trialBalance.balanced ? '借貸平衡' : '借貸不平'}
                          </Tag>
                        </div>
                        <Table
                          dataSource={safeArray(trialBalance.items)}
                          rowKey="accountId"
                          size="small"
                          pagination={{ pageSize: 8 }}
                          columns={[
                            {
                              title: '科目',
                              key: 'account',
                              render: (_, record) => (
                                <div>
                                  <div className="font-mono text-slate-500">{record.code}</div>
                                  <div className="text-slate-800">{record.name}</div>
                                </div>
                              ),
                            },
                            {
                              title: '借方',
                              dataIndex: 'debit',
                              key: 'debit',
                              align: 'right',
                              render: (value: number) => formatNumber(value),
                            },
                            {
                              title: '貸方',
                              dataIndex: 'credit',
                              key: 'credit',
                              align: 'right',
                              render: (value: number) => formatNumber(value),
                            },
                            {
                              title: '餘額',
                              dataIndex: 'balance',
                              key: 'balance',
                              align: 'right',
                              render: (value: number) => formatNumber(value),
                            },
                          ]}
                        />
                      </>
                    ) : <Empty description="無試算表資料" />}
                  </Card>
                </Col>
                <Col xs={24} lg={14}>
                  <Card title="總分類帳" bordered={false} className="shadow-sm">
                    {generalLedger ? (
                      <>
                        <div className="mb-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl bg-slate-50 px-4 py-3">
                            <div className="text-xs text-slate-400">總借方</div>
                            <div className="mt-1 text-xl font-semibold text-slate-800">
                              {formatNumber(generalLedger.totalDebit)}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-4 py-3">
                            <div className="text-xs text-slate-400">總貸方</div>
                            <div className="mt-1 text-xl font-semibold text-slate-800">
                              {formatNumber(generalLedger.totalCredit)}
                            </div>
                          </div>
                        </div>
                        <Table
                          dataSource={safeArray(generalLedger.entries)}
                          rowKey="id"
                          size="small"
                          scroll={{ x: 980 }}
                          pagination={{ pageSize: 8 }}
                          columns={[
                            {
                              title: '日期',
                              dataIndex: 'date',
                              key: 'date',
                              render: (value: string) => dayjs(value).format('MM/DD'),
                              width: 90,
                            },
                            {
                              title: '科目',
                              key: 'account',
                              render: (_, record) => (
                                <div>
                                  <div className="font-mono text-slate-500">{record.accountCode}</div>
                                  <div className="text-slate-800">{record.accountName}</div>
                                </div>
                              ),
                              width: 180,
                            },
                            {
                              title: '描述',
                              dataIndex: 'description',
                              key: 'description',
                            },
                            {
                              title: '借方',
                              dataIndex: 'debit',
                              key: 'debit',
                              align: 'right',
                              render: (value: number) => toNumber(value) ? formatNumber(value) : '—',
                              width: 120,
                            },
                            {
                              title: '貸方',
                              dataIndex: 'credit',
                              key: 'credit',
                              align: 'right',
                              render: (value: number) => toNumber(value) ? formatNumber(value) : '—',
                              width: 120,
                            },
                            {
                              title: '餘額',
                              dataIndex: 'runningBalance',
                              key: 'runningBalance',
                              align: 'right',
                              render: (value: number) => formatNumber(value),
                              width: 120,
                            },
                          ]}
                        />
                      </>
                    ) : <Empty description="無總分類帳資料" />}
                  </Card>
                </Col>
              </Row>
            </TabPane> : null}

            {/* Tab 2: Sales Analysis */}
            {canViewNetProfit ? <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <BarChartOutlined />
                  月度對帳矩陣
                </span>
              }
              key="1.7"
            >
              <Card
                title="Shopify / 1Shop / 綠界 月度對帳矩陣"
                bordered={false}
                className="shadow-sm"
              >
                {monthlyReconciliation ? (
                  <Table
                    rowKey={(record) => `${record.month}-${record.bucketKey}`}
                    dataSource={safeArray(monthlyReconciliation.items)}
                    size="small"
                    scroll={{ x: 1280 }}
                    pagination={{ pageSize: 12 }}
                    columns={[
                      {
                        title: '月份',
                        dataIndex: 'month',
                        key: 'month',
                        width: 100,
                      },
                      {
                        title: '通路',
                        key: 'bucket',
                        width: 220,
                        render: (_, record) => (
                          <div>
                            <div className="font-medium text-slate-800">{record.bucketLabel}</div>
                            <div className="text-xs text-slate-400">
                              {record.account ? `帳號 ${record.account}` : record.bucketKey}
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: '業績',
                        dataIndex: 'salesGross',
                        key: 'salesGross',
                        align: 'right',
                        render: (value: number) => formatNumber(value),
                      },
                      {
                        title: '訂單數',
                        dataIndex: 'orderCount',
                        key: 'orderCount',
                        align: 'right',
                      },
                      {
                        title: '收款總額',
                        dataIndex: 'payoutGross',
                        key: 'payoutGross',
                        align: 'right',
                        render: (value: number) => formatNumber(value),
                      },
                      {
                        title: '淨入帳',
                        dataIndex: 'payoutNet',
                        key: 'payoutNet',
                        align: 'right',
                        render: (value: number | null | undefined) => formatOptionalNumber(value),
                      },
                      {
                        title: '手續費',
                        dataIndex: 'feeTotal',
                        key: 'feeTotal',
                        align: 'right',
                        render: (value: number | null | undefined) => formatOptionalNumber(value),
                      },
                      {
                        title: '待撥款',
                        dataIndex: 'pendingPayoutCount',
                        key: 'pendingPayoutCount',
                        align: 'right',
                      },
                      {
                        title: '綠界匯入',
                        dataIndex: 'ecpayBatchLineCount',
                        key: 'ecpayBatchLineCount',
                        align: 'right',
                      },
                      {
                        title: '綠界未匹配',
                        dataIndex: 'ecpayUnmatchedLineCount',
                        key: 'ecpayUnmatchedLineCount',
                        align: 'right',
                        render: (value: number) => (
                          <Tag color={value > 0 ? 'red' : 'green'}>{value}</Tag>
                        ),
                      },
                      {
                        title: '業績差額',
                        dataIndex: 'salesVsPayoutGap',
                        key: 'salesVsPayoutGap',
                        align: 'right',
                        render: (value: number) => (
                          <span className={value === 0 ? 'text-slate-500' : 'text-amber-600'}>
                            {formatNumber(value)}
                          </span>
                        ),
                      },
                    ]}
                  />
                ) : <Empty description="無月度對帳資料" />}
              </Card>
            </TabPane> : null}

            {canViewNetProfit ? <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <PieChartOutlined />
                  逐筆對帳稽核
                </span>
              }
              key="1.8"
            >
              <Card
                title="手續費、發票、稅務與帳款逐筆稽核"
                bordered={false}
                className="shadow-sm"
              >
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={6}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic title="已稽核訂單" value={reconciliationAudit ? (reconciliationAudit.summary?.auditedOrderCount ?? 0) : '—'} />
                    </Card>
                  </Col>
                  <Col xs={24} md={6}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic title="發票異常" value={reconciliationAudit ? (reconciliationAudit.summary?.invoiceIssueCount ?? 0) : '—'} />
                    </Card>
                  </Col>
                  <Col xs={24} md={6}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic title="稅務異常" value={reconciliationAudit ? (reconciliationAudit.summary?.taxIssueCount ?? 0) : '—'} />
                    </Card>
                  </Col>
                  <Col xs={24} md={6}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic title="帳款不一致" value={reconciliationAudit ? (reconciliationAudit.summary?.orderPaymentIssueCount ?? 0) : '—'} />
                    </Card>
                  </Col>
                </Row>

                <Row gutter={[16, 16]} className="mt-4">
                  <Col xs={24} md={8}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic
                        title="總手續費"
                        value={statisticValue(reconciliationAudit?.summary?.totalFeeAmount)}
                        precision={0}
                        prefix={optionalNumber(reconciliationAudit?.summary?.totalFeeAmount) === null ? undefined : 'NT$'}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic
                        title="金流手續費"
                        value={statisticValue(reconciliationAudit?.summary?.totalGatewayFeeAmount)}
                        precision={0}
                        prefix={optionalNumber(reconciliationAudit?.summary?.totalGatewayFeeAmount) === null ? undefined : 'NT$'}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic
                        title="平台手續費"
                        value={statisticValue(reconciliationAudit?.summary?.totalPlatformFeeAmount)}
                        precision={0}
                        prefix={optionalNumber(reconciliationAudit?.summary?.totalPlatformFeeAmount) === null ? undefined : 'NT$'}
                        suffix={optionalNumber(reconciliationAudit?.summary?.feeTakeRatePct) === null ? undefined : ` / ${formatOptionalPercent(reconciliationAudit?.summary?.feeTakeRatePct)}`}
                      />
                    </Card>
                  </Col>
                </Row>

                <div className="mt-4">
                  <Table
                    rowKey="orderId"
                    dataSource={safeArray(reconciliationAudit?.items)}
                    size="small"
                    scroll={{ x: 1480 }}
                    pagination={{ pageSize: 10 }}
                    columns={[
                      {
                        title: '訂單',
                        key: 'order',
                        width: 220,
                        render: (_, record) => (
                          <div>
                            <div className="font-medium text-slate-800">
                              {record.externalOrderId || record.orderId}
                            </div>
                            <div className="text-xs text-slate-400">
                              {record.channelName} · {dayjs(record.orderDate).format('YYYY/MM/DD')}
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: '異常',
                        key: 'anomalies',
                        width: 320,
                        render: (_, record) => (
                          <div className="flex flex-wrap gap-1">
                            {safeArray<string>(record.anomalyMessages).map((item: string) => (
                              <Tag key={`${record.orderId}-${item}`} color={record.severity === 'critical' ? 'red' : 'gold'}>
                                {item}
                              </Tag>
                            ))}
                          </div>
                        ),
                      },
                      {
                        title: '訂單 / 收款',
                        key: 'gross',
                        align: 'right',
                        render: (_, record) => `${formatNumber(record.grossAmount, { maximumFractionDigits: 0 })} / ${formatNumber(record.paymentGrossAmount, { maximumFractionDigits: 0 })}`,
                      },
                      {
                        title: '手續費',
                        key: 'fees',
                        align: 'right',
                        render: (_, record) => `${formatOptionalNumber(record.feeTotalAmount)} (${formatOptionalPercent(record.feeRatePct)})`,
                      },
                      {
                        title: '發票',
                        key: 'invoice',
                        render: (_, record) => (
                          <div>
                            <div>{record.invoiceNumber || '待補發票'}</div>
                            <div className="text-xs text-slate-400">
                              {formatNumber(record.invoiceGrossAmount, { maximumFractionDigits: 0 })} / 稅 {formatNumber(record.invoiceTaxAmount, { maximumFractionDigits: 0 })}
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: '建議',
                        dataIndex: 'recommendation',
                        key: 'recommendation',
                        width: 280,
                      },
                    ]}
                    locale={{ emptyText: <Empty description="目前沒有逐筆對帳異常" /> }}
                  />
                </div>
              </Card>
            </TabPane> : null}

            <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <BarChartOutlined />
                  銷售分析
                </span>
              } 
              key="2"
            >
              <div className="p-8 text-center text-gray-500">
                <BarChartOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                <p>銷售趨勢分析功能即將推出</p>
                <p className="text-xs">目前請參考損益表中的收入明細</p>
              </div>
            </TabPane>

            {/* Tab 3: Expense Analysis */}
            {canViewNetProfit ? <TabPane
              tab={
                <span className="flex items-center gap-2">
                  <PieChartOutlined />
                  費用分析
                </span>
              } 
              key="3"
            >
              <Row gutter={[24, 24]}>
                <Col xs={24} md={12}>
                  <Card title="費用類別佔比" bordered={false} className="shadow-sm h-full">
                    {getExpenseData().length > 0 ? (
                      <div className="h-[300px] flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={getExpenseData()}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              fill="#8884d8"
                              paddingAngle={5}
                              dataKey="value"
                              label
                            >
                              {getExpenseData().map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => formatMoney(value)} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <Empty description="無費用資料" />}
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card title="費用明細" bordered={false} className="shadow-sm h-full">
                    <Table 
                      dataSource={getExpenseData()} 
                      columns={[
                        { title: '類別', dataIndex: 'name', key: 'name' },
                        { title: '金額', dataIndex: 'value', key: 'value', render: (val) => formatMoney(val) },
                        { 
                          title: '佔比', 
                          key: 'percent', 
                          render: (_, record) => {
                            const total = toNumber(incomeStatement?.totalExpense) || 1
                            return formatPercent((toNumber(record.value) / total) * 100, 1)
                          } 
                        }
                      ]}
                      pagination={false}
                    />
                  </Card>
                </Col>
              </Row>
            </TabPane> : null}
          </Tabs>
        </Spin>
      </div>

    </div>
  )
}

export default ReportsPage
