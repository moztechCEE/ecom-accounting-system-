import React, { useState, useEffect } from 'react'
import { 
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
  Space,
  Select,
  message,
  Empty,
  Spin,
  Modal,
  Descriptions,
} from 'antd'
import { 
  DownloadOutlined, 
  PrinterOutlined, 
  RiseOutlined, 
  FallOutlined,
  PieChartOutlined,
  BarChartOutlined,
  FileTextOutlined,
  ReloadOutlined,
  RobotOutlined
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
import { motion } from 'framer-motion'
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

  // AI State
  const [aiModalVisible, setAiModalVisible] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<any>(null)

  const fetchData = async () => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) return
    setLoading(true)
    try {
      const [start, end] = dateRange
      const [isData, bsData, tbData, glData, opsData, managementData, ecommerceData, monthlyData, invoiceData, auditData] = await Promise.all([
        accountingService.getIncomeStatement(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')),
        accountingService.getBalanceSheet(end.format('YYYY-MM-DD')),
        accountingService.getTrialBalance(end.format('YYYY-MM-DD')),
        accountingService.getGeneralLedger(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')),
        dashboardService.getOperationsHub({
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        }),
        dashboardService.getManagementSummary({
          groupBy: managementGroupBy,
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        }),
        dashboardService.getEcommerceHistory({
          groupBy: managementGroupBy,
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        }),
        dashboardService.getMonthlyChannelReconciliation({
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
        }),
        invoicingService.getQueue({
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          limit: 6,
        }),
        dashboardService.getOrderReconciliationAudit({
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          limit: 50,
        }),
      ])
      setIncomeStatement(isData)
      setBalanceSheet(bsData)
      setTrialBalance(tbData)
      setGeneralLedger(glData)
      setOperationsHub(opsData)
      setManagementSummary(managementData)
      setEcommerceHistory(ecommerceData)
      setMonthlyReconciliation(monthlyData)
      setInvoiceQueue(invoiceData)
      setReconciliationAudit(auditData)
    } catch (error) {
      console.error(error)
      message.error('無法載入報表數據')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [dateRange, managementGroupBy])

  const handleExport = () => {
    message.info('匯出功能開發中')
  }

  const handleAIAnalysis = async () => {
    if (!incomeStatement) return
    setAiModalVisible(true)
    setAiLoading(true)
    try {
      const result = await accountingService.analyzeReport({
        entityId: 'tw-entity-001', // Should come from a selector in real app
        startDate: dateRange[0].format('YYYY-MM-DD'),
        endDate: dateRange[1].format('YYYY-MM-DD'),
        context: 'Income Statement Review'
      })
      setAiResult(result)
    } catch (error) {
      message.error('AI Analysis failed')
    } finally {
      setAiLoading(false)
    }
  }

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
      { key: 'header_rev', category: '營業收入 (Revenue)', amount: null, isHeader: true },
      ...revenues,
      { key: 'total_rev', category: '總收入', amount: toNumber(incomeStatement.totalRevenue), isTotal: true },
      { key: 'header_exp', category: '營業費用 (Expenses)', amount: null, isHeader: true },
      ...expenses,
      { key: 'total_exp', category: '總費用', amount: toNumber(incomeStatement.totalExpense), isTotal: true },
      { key: 'net_income', category: '淨利 (Net Income)', amount: toNumber(incomeStatement.netIncome), isTotal: true, isNet: true }
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
    const retainedEarnings = toNumber(balanceSheet.calculatedRetainedEarnings)

    return [
      { key: 'header_asset', category: '資產 (Assets)', amount: null, isHeader: true },
      ...assets.map(a => ({ key: a.code, category: a.name, amount: toNumber(a.amount) })),
      { key: 'total_asset', category: '資產總計', amount: toNumber(balanceSheet.totalAssets), isTotal: true },
      
      { key: 'header_liab', category: '負債 (Liabilities)', amount: null, isHeader: true },
      ...liabilities.map(l => ({ key: l.code, category: l.name, amount: toNumber(l.amount) })),
      { key: 'total_liab', category: '負債總計', amount: totalLiabilities, isTotal: true },
      
      { key: 'header_equity', category: '權益 (Equity)', amount: null, isHeader: true },
      ...equity.map(e => ({ key: e.code, category: e.name, amount: toNumber(e.amount) })),
      { key: 'retained_earnings', category: '本期損益 (Retained Earnings)', amount: retainedEarnings },
      { key: 'total_equity', category: '權益總計', amount: totalEquity + retainedEarnings, isTotal: true },
      
      { key: 'total_liab_equity', category: '負債與權益總計', amount: totalLiabilities + totalEquity + retainedEarnings, isTotal: true, isNet: true }
    ]
  }

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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <Title level={2} className="!text-gray-800 font-light tracking-tight !mb-1">
            報表中心 (Reports Center)
          </Title>
          <Text className="text-gray-500">
            查看與分析您的財務狀況、銷售績效與營運指標。
          </Text>
        </div>
        <div className="flex gap-3">
          <RangePicker 
            className="w-64" 
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs])}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>重新整理</Button>
          <Button 
            icon={<RobotOutlined />} 
            onClick={handleAIAnalysis} 
            loading={aiLoading}
            className="border-purple-500 text-purple-600 hover:text-purple-700 hover:border-purple-600"
          >
            AI 財務分析
          </Button>
          <Button 
            type="primary" 
            icon={<DownloadOutlined />} 
            onClick={handleExport}
            className="bg-black hover:!bg-gray-800"
          >
            匯出報表
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="glass-card p-6 min-h-[600px]">
        <Spin spinning={loading}>
          <Tabs defaultActiveKey="1" type="card" size="large" className="custom-tabs">
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
                    <Statistic title="歷年電商營收" value={ecommerceHistory?.summary?.revenue || 0} precision={0} prefix="NT$" />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="訂單數" value={ecommerceHistory?.summary?.orderCount || 0} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="客戶數" value={ecommerceHistory?.summary?.customerCount || 0} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="品牌 / 商品" value={`${ecommerceHistory?.summary?.brandCount || 0} / ${ecommerceHistory?.summary?.productCount || 0}`} />
                  </Card>
                </Col>
              </Row>

              <Row gutter={[16, 16]} className="mt-4">
                <Col xs={24} lg={10}>
                  <Card title="歷年電商業績趨勢" bordered={false} className="shadow-sm h-full">
                    {ecommerceHistory?.periods?.length ? (
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={ecommerceHistory.periods}>
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
                      dataSource={ecommerceHistory?.brands || []}
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
                <Card title="商品與品牌細項" bordered={false} className="shadow-sm">
                  <Table
                    rowKey={(record) => `${record.brand}-${record.sku}`}
                    dataSource={ecommerceHistory?.products || []}
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
                    先用真實訂單、收款、手續費、估算成本與費用去彙整公司營運數字。
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
                    <Statistic title="營業額" value={managementSummary?.summary?.revenue || 0} precision={0} prefix="NT$" />
                  </Card>
                </Col>
                <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="毛利" value={managementSummary?.summary?.grossProfit || 0} precision={0} prefix="NT$" />
                  </Card>
                </Col>
                <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="毛利率" value={managementSummary?.summary?.grossMarginPct || 0} precision={2} suffix="%" />
                  </Card>
                </Col>
                <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="淨利" value={managementSummary?.summary?.netProfit || 0} precision={0} prefix="NT$" />
                  </Card>
                </Col>
                <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="手續費" value={managementSummary?.summary?.feeTotal || 0} precision={0} prefix="NT$" />
                  </Card>
                </Col>
                <Col xs={24} md={8} xl={4}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="應收未收" value={managementSummary?.summary?.openArAmount || 0} precision={0} prefix="NT$" />
                  </Card>
                </Col>
              </Row>

              <Row gutter={[16, 16]} className="mt-4">
                <Col xs={24} lg={10}>
                  <Card title="趨勢總覽" bordered={false} className="shadow-sm h-full">
                    {managementSummary?.periods?.length ? (
                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={managementSummary.periods}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" />
                            <YAxis />
                            <Tooltip formatter={(value: number) => formatMoney(value)} />
                            <Legend />
                            <Line type="monotone" dataKey="revenue" name="營業額" stroke="#2563eb" strokeWidth={2} />
                            <Line type="monotone" dataKey="grossProfit" name="毛利" stroke="#16a34a" strokeWidth={2} />
                            <Line type="monotone" dataKey="netProfit" name="淨利" stroke="#f97316" strokeWidth={2} />
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
                      dataSource={managementSummary?.periods || []}
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
                        {
                          title: '估算成本',
                          dataIndex: 'estimatedCogs',
                          key: 'estimatedCogs',
                          align: 'right',
                          render: (value: number) => formatNumber(value),
                        },
                        {
                          title: '毛利 / 毛利率',
                          key: 'grossProfit',
                          align: 'right',
                          render: (_, record) => `${formatNumber(record.grossProfit)} / ${formatPercent(record.grossMarginPct)}`,
                        },
                        {
                          title: '手續費',
                          dataIndex: 'feeTotal',
                          key: 'feeTotal',
                          align: 'right',
                          render: (value: number) => formatNumber(value),
                        },
                        {
                          title: '營運費用',
                          dataIndex: 'operatingExpenses',
                          key: 'operatingExpenses',
                          align: 'right',
                          render: (value: number) => formatNumber(value),
                        },
                        {
                          title: '淨利 / 淨利率',
                          key: 'netProfit',
                          align: 'right',
                          render: (_, record) => `${formatNumber(record.netProfit)} / ${formatPercent(record.netMarginPct)}`,
                        },
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
                    <Statistic title="在職員工" value={operationsHub?.people.activeEmployees || 0} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="待審假單" value={operationsHub?.people.pendingLeaveRequests || 0} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="出勤異常" value={operationsHub?.people.openAttendanceAnomalies || 0} />
                  </Card>
                </Col>
                <Col xs={24} md={6}>
                  <Card bordered={false} className="shadow-sm">
                    <Statistic title="待開票訂單" value={operationsHub?.invoicing.pendingInvoiceCount || 0} />
                  </Card>
                </Col>
              </Row>

              <Row gutter={[16, 16]} className="mt-4">
                <Col xs={24} lg={12}>
                  <Card title="薪資與審批" bordered={false} className="shadow-sm h-full">
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="待審薪資批次">
                        {operationsHub?.payroll.pendingApprovalRuns || 0}
                      </Descriptions.Item>
                      <Descriptions.Item label="已核准薪資批次">
                        {operationsHub?.payroll.approvedRuns || 0}
                      </Descriptions.Item>
                      <Descriptions.Item label="已過帳薪資批次">
                        {operationsHub?.payroll.postedRuns || 0}
                      </Descriptions.Item>
                      <Descriptions.Item label="待審費用">
                        {operationsHub?.approvals.expenseRequests || 0}
                      </Descriptions.Item>
                      <Descriptions.Item label="待審分錄">
                        {operationsHub?.approvals.journalEntries || 0}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card title="發票閉環" bordered={false} className="shadow-sm h-full">
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="已開票數">
                        {invoiceQueue?.summary?.issuedCount || 0}
                      </Descriptions.Item>
                      <Descriptions.Item label="可批次開票">
                        {invoiceQueue?.summary?.eligibleCount || 0}
                      </Descriptions.Item>
                      <Descriptions.Item label="待付款後開票">
                        {invoiceQueue?.summary?.waitingPaymentCount || 0}
                      </Descriptions.Item>
                      <Descriptions.Item label="已作廢發票">
                        {invoiceQueue?.summary?.voidCount || 0}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
              </Row>
            </TabPane>
            
            {/* Tab 1: Financial Statements */}
            <TabPane 
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
                  <Card title="損益表 (Profit & Loss)" bordered={false} className="shadow-sm">
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
                  <Card title="資產負債表 (Balance Sheet)" bordered={false} className="shadow-sm">
                    {balanceSheet ? (
                      <Table 
                        dataSource={getBSData()} 
                        columns={columns.filter(c => c.key !== 'percentage')} 
                        pagination={false} 
                        size="small"
                        rowClassName={(record) => record.isTotal ? 'bg-gray-50' : ''}
                      />
                    ) : <Empty description="無資料" />}
                  </Card>
                </Col>
              </Row>
            </TabPane>

            <TabPane
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
                  <Card title="試算表 (Trial Balance)" bordered={false} className="shadow-sm">
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
                  <Card title="總分類帳 (General Ledger)" bordered={false} className="shadow-sm">
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
            </TabPane>

            {/* Tab 2: Sales Analysis */}
            <TabPane
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
                        render: (value: number) => formatNumber(value),
                      },
                      {
                        title: '手續費',
                        dataIndex: 'feeTotal',
                        key: 'feeTotal',
                        align: 'right',
                        render: (value: number) => formatNumber(value),
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
            </TabPane>

            <TabPane
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
                      <Statistic title="已稽核訂單" value={reconciliationAudit?.summary?.auditedOrderCount || 0} />
                    </Card>
                  </Col>
                  <Col xs={24} md={6}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic title="發票異常" value={reconciliationAudit?.summary?.invoiceIssueCount || 0} />
                    </Card>
                  </Col>
                  <Col xs={24} md={6}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic title="稅務異常" value={reconciliationAudit?.summary?.taxIssueCount || 0} />
                    </Card>
                  </Col>
                  <Col xs={24} md={6}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic title="帳款不一致" value={reconciliationAudit?.summary?.orderPaymentIssueCount || 0} />
                    </Card>
                  </Col>
                </Row>

                <Row gutter={[16, 16]} className="mt-4">
                  <Col xs={24} md={8}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic
                        title="總手續費"
                        value={reconciliationAudit?.summary?.totalFeeAmount || 0}
                        precision={0}
                        prefix="NT$"
                      />
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic
                        title="金流手續費"
                        value={reconciliationAudit?.summary?.totalGatewayFeeAmount || 0}
                        precision={0}
                        prefix="NT$"
                      />
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card bordered={false} className="bg-slate-50">
                      <Statistic
                        title="平台手續費"
                        value={reconciliationAudit?.summary?.totalPlatformFeeAmount || 0}
                        precision={0}
                        prefix="NT$"
                        suffix={` / ${formatPercent(reconciliationAudit?.summary?.feeTakeRatePct)}`}
                      />
                    </Card>
                  </Col>
                </Row>

                <div className="mt-4">
                  <Table
                    rowKey="orderId"
                    dataSource={reconciliationAudit?.items || []}
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
                        render: (_, record) => `${formatNumber(record.feeTotalAmount, { maximumFractionDigits: 0 })} (${formatPercent(record.feeRatePct)})`,
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
            </TabPane>

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
            <TabPane 
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
            </TabPane>
          </Tabs>
        </Spin>
      </div>

      <Modal
        title={<span><RobotOutlined className="text-purple-600 mr-2" /> AI 財務分析報告 (Expense Intelligence)</span>}
        open={aiModalVisible}
        onCancel={() => setAiModalVisible(false)}
        footer={null}
        width={800}
      >
        {aiLoading ? (
           <div className="flex flex-col items-center justify-center py-12">
             <Spin size="large" />
             <Text className="mt-4 text-gray-500">正在分析財務數據...</Text>
           </div>
        ) : aiResult ? (
          <div className="space-y-8">
             {aiResult.analysis === 'AI service not configured.' && (
               <div className="bg-orange-50 p-4 rounded text-orange-700">
                 請聯繫管理員配置 GEMINI_API_KEY 以啟用 AI 功能。
               </div>
             )}
             
             {aiResult.insights && (
               <Card size="small" title="📊 關鍵洞察 (Insights)" className="border-purple-100">
                  <Text>{aiResult.insights}</Text>
               </Card>
             )}

             {aiResult.anomalies && (
               <Card size="small" title="⚠️ 異常偵測 (Anomalies)" className="border-red-100">
                  <Text>{aiResult.anomalies}</Text>
               </Card>
             )}

             {aiResult.suggestions && (
               <Card size="small" title="💡 優化建議 (Suggestions)" className="border-green-100">
                  <Text>{aiResult.suggestions}</Text>
               </Card>
             )}

             {/* Fallback for raw text response */}
             {!aiResult.insights && !aiResult.analysis && (
               <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded text-sm">
                 {JSON.stringify(aiResult, null, 2)}
               </pre>
             )}
          </div>
        ) : (
          <Empty description="點擊分析按鈕以生成報告" />
        )}
      </Modal>
    </div>
  )
}

export default ReportsPage
