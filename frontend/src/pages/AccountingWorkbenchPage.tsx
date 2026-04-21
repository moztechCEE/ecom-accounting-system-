import React, { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AuditOutlined,
  BankOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  ExceptionOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs, { Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import {
  dashboardService,
  DashboardExecutiveAnomaly,
  DashboardExecutiveOverview,
  DashboardReconciliationBatch,
  DashboardReconciliationFeed,
  DashboardReconciliationItem,
  OrderReconciliationAudit,
  OrderReconciliationAuditItem,
} from '../services/dashboard.service'
import {
  arService,
  B2BStatementCustomer,
  B2BStatementResponse,
  ReceivableClassificationGroup,
  ReceivableMonitorResponse,
  ReceivableMonitorItem,
} from '../services/ar.service'
import { salesService } from '../services/sales.service'
import { apService } from '../services/ap.service'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

type WorkbenchRange = [Dayjs, Dayjs]

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

const ECPAY_MERCHANT_OPTIONS = [
  { label: '3290494 · MOZTECH 官方網站 / Shopify', value: '3290494' },
  { label: '3150241 · 萬魔未來工學院 / 團購 / 1Shop', value: '3150241' },
]

const money = (value?: number | null) =>
  `NT$ ${Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`

const statusTone = (tone?: string) => {
  if (tone === 'critical') return 'red'
  if (tone === 'warning') return 'gold'
  if (tone === 'attention') return 'blue'
  return 'green'
}

const settlementMeta = (item: DashboardReconciliationItem) => {
  if (item.settlementStatus === 'reconciled') return { color: 'green' as const, label: '已對帳' }
  if (item.settlementStatus === 'pending_payout') return { color: 'gold' as const, label: '待撥款' }
  if (item.settlementStatus === 'failed') return { color: 'red' as const, label: '失敗 / 退款' }
  return { color: 'blue' as const, label: '待付款' }
}

const feeMeta = (status?: string) => {
  if (status === 'actual') return { color: 'green' as const, label: '實際費用' }
  if (status === 'estimated') return { color: 'gold' as const, label: '預估費用' }
  if (status === 'unavailable') return { color: 'red' as const, label: '來源不可得' }
  return { color: 'default' as const, label: '待補費用' }
}

const auditMeta = (severity: OrderReconciliationAuditItem['severity']) => {
  if (severity === 'critical') return { color: 'red' as const, label: '高風險' }
  if (severity === 'warning') return { color: 'gold' as const, label: '需追蹤' }
  return { color: 'green' as const, label: '正常' }
}

const riskMeta = (risk?: string) => {
  if (risk === 'critical') return { color: 'red' as const, label: '高風險' }
  if (risk === 'warning') return { color: 'gold' as const, label: '逾期追蹤' }
  if (risk === 'attention') return { color: 'blue' as const, label: '待出帳' }
  return { color: 'green' as const, label: '正常' }
}

const AccountingWorkbenchPage: React.FC = () => {
  const navigate = useNavigate()
  const [feeImportForm] = Form.useForm()
  const [dateRange, setDateRange] = useState<WorkbenchRange>([
    dayjs().subtract(6, 'day').startOf('day'),
    dayjs().endOf('day'),
  ])
  const [loading, setLoading] = useState(false)
  const [syncingAr, setSyncingAr] = useState(false)
  const [syncingInvoiceStatus, setSyncingInvoiceStatus] = useState(false)
  const [feeImportOpen, setFeeImportOpen] = useState(false)
  const [importingFeeInvoices, setImportingFeeInvoices] = useState(false)
  const [executive, setExecutive] = useState<DashboardExecutiveOverview | null>(null)
  const [feed, setFeed] = useState<DashboardReconciliationFeed | null>(null)
  const [audit, setAudit] = useState<OrderReconciliationAudit | null>(null)
  const [receivables, setReceivables] = useState<ReceivableMonitorResponse | null>(null)
  const [b2bStatements, setB2BStatements] = useState<B2BStatementResponse | null>(null)

  const entityId = localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
  const startDate = dateRange[0].startOf('day').toISOString()
  const endDate = dateRange[1].endOf('day').toISOString()

  const fetchWorkbench = async () => {
    setLoading(true)
    try {
      const [executiveData, feedData, auditData, receivableData, b2bStatementData] = await Promise.all([
        dashboardService.getExecutiveOverview({ entityId, startDate, endDate }),
        dashboardService.getReconciliationFeed({ entityId, startDate, endDate, limit: 24 }),
        dashboardService.getOrderReconciliationAudit({ entityId, startDate, endDate, limit: 80 }),
        arService.getReceivableMonitor({ entityId, startDate, endDate }),
        arService.getB2BStatements({ entityId, asOfDate: endDate }),
      ])
      setExecutive(executiveData)
      setFeed(feedData)
      setAudit(auditData)
      setReceivables(receivableData)
      setB2BStatements(b2bStatementData)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '讀取會計工作台失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkbench()
  }, [dateRange[0].valueOf(), dateRange[1].valueOf()])

  const handleSyncAr = async () => {
    setSyncingAr(true)
    try {
      const result = await arService.syncSalesOrders(entityId)
      message.success(`應收同步完成：新增 ${result.created || 0} 筆，更新 ${result.updated || 0} 筆`)
      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '同步應收失敗')
    } finally {
      setSyncingAr(false)
    }
  }

  const handleSyncInvoiceStatuses = async () => {
    setSyncingInvoiceStatus(true)
    try {
      const result = await salesService.syncInvoiceStatusBatch({
        entityId,
        startDate,
        endDate,
        limit: 120,
      })
      message.success(
        `發票狀態同步完成：成功 ${result.synced || 0} 筆，略過 ${result.skipped || 0} 筆，失敗 ${result.failed || 0} 筆`,
      )
      await fetchWorkbench()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '同步發票狀態失敗')
    } finally {
      setSyncingInvoiceStatus(false)
    }
  }

  const openFeeImportModal = () => {
    feeImportForm.setFieldsValue({
      merchantId: '3290494',
      verifyIssuedStatus: true,
      autoOffsetByMatchedFees: true,
      records: [
        {
          invoiceStatus: 'issued',
          serviceType: 'gateway_fee',
          amountCurrency: 'TWD',
        },
      ],
    })
    setFeeImportOpen(true)
  }

  const handleImportFeeInvoices = async () => {
    try {
      const values = await feeImportForm.validateFields()
      setImportingFeeInvoices(true)
      const records = (values.records || []).map((record: any) => ({
        invoiceNo: record.invoiceNo,
        invoiceDate: record.invoiceDate?.format('YYYY-MM-DD'),
        amountOriginal: Number(record.amountOriginal || 0),
        amountCurrency: record.amountCurrency || 'TWD',
        serviceType: record.serviceType || 'gateway_fee',
        invoiceStatus: record.invoiceStatus || 'issued',
        taxAmount: record.taxAmount !== undefined ? Number(record.taxAmount) : undefined,
        relateNumber: record.relateNumber || undefined,
        note: record.note || undefined,
      }))

      const result = await apService.importEcpayServiceFeeInvoices({
        entityId,
        merchantId: values.merchantId,
        vendorName: values.vendorName || '綠界科技',
        verifyIssuedStatus: values.verifyIssuedStatus,
        autoOffsetByMatchedFees: values.autoOffsetByMatchedFees,
        records,
      })

      message.success(
        `綠界服務費發票匯入完成：新增 ${result.created || 0} 筆，更新 ${result.updated || 0} 筆，驗證 ${result.verifiedCount || 0} 筆`,
      )
      setFeeImportOpen(false)
      await fetchWorkbench()
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.response?.data?.message || '匯入綠界服務費發票失敗')
    } finally {
      setImportingFeeInvoices(false)
    }
  }

  const anomalies = executive?.anomalies || []
  const recentItems = feed?.recentItems || []
  const recentBatches = feed?.recentBatches || []
  const auditItems = audit?.items || []
  const arItems = receivables?.items || []
  const arGroups = receivables?.classificationGroups || []
  const arSummary = receivables?.summary
  const b2bSummary = b2bStatements?.summary
  const b2bCustomers = b2bStatements?.customers || []
  const auditSummary = audit?.summary
  const automationCompletion = auditSummary?.auditedOrderCount
    ? Math.round((auditSummary.reconciledOrderCount / auditSummary.auditedOrderCount) * 100)
    : 0

  const anomalyColumns: ColumnsType<DashboardExecutiveAnomaly> = [
    {
      title: '待辦',
      dataIndex: 'title',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{record.helper}</div>
          {record.accountCode ? (
            <div className="mt-1 text-[11px] text-slate-400">
              科目 {record.accountCode} · {record.accountName}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '狀態',
      width: 120,
      render: (_, record) => <Tag color={statusTone(record.tone)}>{record.statusLabel}</Tag>,
    },
    {
      title: '影響',
      width: 140,
      align: 'right',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.count} 筆</div>
          <div className="text-xs text-slate-400">{record.amount !== null ? money(record.amount) : '待處理'}</div>
        </div>
      ),
    },
  ]

  const paymentColumns: ColumnsType<DashboardReconciliationItem> = [
    {
      title: '訂單 / 通路',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-blue-600">{record.externalOrderId || record.salesOrderId || '未綁定訂單'}</div>
          <div className="text-xs text-slate-400">{record.bucketLabel} · {record.gateway || '未知付款方式'}</div>
        </div>
      ),
    },
    {
      title: '狀態',
      width: 170,
      render: (_, record) => {
        const settlement = settlementMeta(record)
        const fee = feeMeta(record.feeStatus)
        return (
          <Space size={[4, 4]} wrap>
            <Tag color={settlement.color}>{settlement.label}</Tag>
            <Tag color={fee.color}>{fee.label}</Tag>
          </Space>
        )
      },
    },
    {
      title: '金額',
      width: 220,
      align: 'right',
      render: (_, record) => (
        <div className="text-sm">
          <div>總額 {money(record.gross)}</div>
          <div className="text-rose-500">手續費 {money(record.feeTotal)}</div>
          <div className="font-semibold text-emerald-600">淨額 {money(record.net)}</div>
        </div>
      ),
    },
    {
      title: '金流單號',
      width: 170,
      render: (_, record) => (
        <div className="text-xs text-slate-500">
          {record.providerTradeNo || record.providerPaymentId || '待回填'}
        </div>
      ),
    },
  ]

  const batchColumns: ColumnsType<DashboardReconciliationBatch> = [
    {
      title: '批次',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.provider.toUpperCase()} 對帳批次</div>
          <div className="text-xs text-slate-400">
            {dayjs(record.importedAt).format('YYYY/MM/DD HH:mm')} · {record.fileName || '系統同步'}
          </div>
        </div>
      ),
    },
    { title: '匯入', dataIndex: 'recordCount', width: 90, align: 'right' },
    { title: '已匹配', dataIndex: 'matchedCount', width: 90, align: 'right' },
    {
      title: '待處理',
      width: 100,
      align: 'right',
      render: (_, record) => (
        <span className={record.unmatchedCount + record.invalidCount > 0 ? 'font-semibold text-amber-600' : 'text-emerald-600'}>
          {record.unmatchedCount + record.invalidCount}
        </span>
      ),
    },
  ]

  const auditColumns: ColumnsType<OrderReconciliationAuditItem> = [
    {
      title: '訂單',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-blue-600">{record.externalOrderId || record.orderId}</div>
          <div className="text-xs text-slate-400">{record.channelName} · {dayjs(record.orderDate).format('YYYY/MM/DD')}</div>
        </div>
      ),
    },
    {
      title: 'AI 判斷',
      render: (_, record) => {
        const meta = auditMeta(record.severity)
        return (
          <div>
            <Tag color={meta.color}>{meta.label}</Tag>
            <div className="mt-2 flex flex-wrap gap-1">
              {record.anomalyMessages.slice(0, 3).map((item, index) => (
                <Tag key={`${record.orderId}-${index}`} color="red">{item}</Tag>
              ))}
            </div>
          </div>
        )
      },
    },
    {
      title: '核對金額',
      width: 220,
      align: 'right',
      render: (_, record) => (
        <div className="text-sm">
          <div>訂單 / 收款 {money(record.grossAmount)} / {money(record.paymentGrossAmount)}</div>
          <div>手續費 {money(record.feeTotalAmount)} · {record.feeRatePct.toFixed(2)}%</div>
          <div>稅額 {money(record.orderTaxAmount)} / {money(record.invoiceTaxAmount)}</div>
        </div>
      ),
    },
  ]

  const arColumns: ColumnsType<ReceivableMonitorItem> = [
    {
      title: '訂單 / 客戶 / 分類',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-blue-600">{record.orderNumber}</div>
          <div className="text-xs text-slate-400">{record.customerName} · {record.sourceLabel}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Tag color="blue">{record.receivableGroupLabel || '未分類應收'}</Tag>
            <Tag>{record.collectionOwnerLabel || '待確認'}</Tag>
          </div>
        </div>
      ),
    },
    {
      title: '追帳階段',
      width: 180,
      render: (_, record) => (
        <div>
          <Tag color={record.settlementPhase === 'overdue' ? 'red' : record.settlementPhase === 'settled' ? 'green' : 'gold'}>
            {record.settlementPhaseLabel || record.arStatus}
          </Tag>
          <div className="mt-2 text-xs leading-5 text-slate-500">
            {record.settlementDiagnostic || record.feeDiagnostic}
          </div>
        </div>
      ),
    },
    {
      title: '缺口',
      width: 210,
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          {!record.reconciledFlag ? <Tag color="gold">待對帳</Tag> : <Tag color="green">已對帳</Tag>}
          {record.feeStatus !== 'actual' ? <Tag color="red">手續費待補</Tag> : null}
          {!record.invoiceNumber ? <Tag color="blue">待補發票</Tag> : null}
          {!record.accountingPosted ? <Tag>待入帳</Tag> : null}
        </Space>
      ),
    },
    {
      title: '應收',
      width: 180,
      align: 'right',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{money(record.outstandingAmount)}</div>
          <div className="text-xs text-slate-400">淨額 {money(record.netAmount)}</div>
        </div>
      ),
    },
  ]

  const arGroupColumns: ColumnsType<ReceivableClassificationGroup> = [
    {
      title: '應收分類',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.label}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Tag color="blue">{record.collectionTypeLabel}</Tag>
            <Tag>{record.paymentMethodLabel}</Tag>
            <Tag>{record.collectionOwnerLabel}</Tag>
          </div>
        </div>
      ),
    },
    {
      title: '階段',
      width: 150,
      render: (_, record) => (
        <Tag color={record.settlementPhase === 'overdue' ? 'red' : record.settlementPhase === 'settled' ? 'green' : 'gold'}>
          {record.settlementPhaseLabel}
        </Tag>
      ),
    },
    {
      title: '筆數',
      dataIndex: 'orderCount',
      width: 90,
      align: 'right',
    },
    {
      title: '應收未收',
      width: 150,
      align: 'right',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-rose-600">{money(record.outstandingAmount)}</div>
          {record.overdueAmount > 0 ? (
            <div className="text-xs text-rose-400">逾期 {money(record.overdueAmount)}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: '已收 / 淨額',
      width: 170,
      align: 'right',
      render: (_, record) => (
        <div className="text-sm">
          <div>{money(record.paidAmount)}</div>
          <div className="font-semibold text-emerald-600">{money(record.netAmount)}</div>
        </div>
      ),
    },
    {
      title: '待補',
      width: 180,
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          {record.missingFeeCount ? <Tag color="red">費用 {record.missingFeeCount}</Tag> : null}
          {record.missingInvoiceCount ? <Tag color="blue">發票 {record.missingInvoiceCount}</Tag> : null}
          {record.missingJournalCount ? <Tag>分錄 {record.missingJournalCount}</Tag> : null}
          {!record.missingFeeCount && !record.missingInvoiceCount && !record.missingJournalCount ? (
            <Tag color="green">完整</Tag>
          ) : null}
        </Space>
      ),
    },
  ]

  const b2bColumns: ColumnsType<B2BStatementCustomer> = [
    {
      title: '客戶 / 對帳單',
      render: (_, record) => {
        const risk = riskMeta(record.riskLevel)
        return (
          <div>
            <div className="font-semibold text-slate-900">{record.customerName}</div>
            <div className="text-xs text-slate-400">
              {record.statementEmail || '未設定對帳單 Email'} · Net {record.paymentTermDays || 30}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Tag color={risk.color}>{risk.label}</Tag>
              <Tag>{record.billingCycle === 'monthly' ? '每月出帳' : record.billingCycle || '月結'}</Tag>
              {record.collectionOwner ? <Tag color="blue">{record.collectionOwner}</Tag> : null}
            </div>
          </div>
        )
      },
    },
    {
      title: '應收狀態',
      width: 210,
      render: (_, record) => (
        <div className="text-sm">
          <div className="font-semibold text-rose-600">未收 {money(record.outstandingAmount)}</div>
          <div className="text-amber-600">逾期 {money(record.overdueAmount)}</div>
          <div className="text-slate-400">開放 {record.openOrderCount} / 全部 {record.orderCount} 筆</div>
        </div>
      ),
    },
    {
      title: '帳齡',
      width: 260,
      render: (_, record) => (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>未到期 {money(record.currentAmount)}</span>
          <span>1-30 {money(record.due1To30Amount)}</span>
          <span>31-60 {money(record.due31To60Amount)}</span>
          <span>61-90 {money(record.due61To90Amount)}</span>
          <span className="text-rose-500">90+ {money(record.dueOver90Amount)}</span>
          <span>額度 {money(record.creditLimit)}</span>
        </div>
      ),
    },
    {
      title: '待補',
      width: 180,
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          {record.missingInvoiceCount ? <Tag color="blue">發票 {record.missingInvoiceCount}</Tag> : null}
          {record.missingJournalCount ? <Tag>分錄 {record.missingJournalCount}</Tag> : null}
          {record.missingFeeCount ? <Tag color="red">費用 {record.missingFeeCount}</Tag> : null}
          {!record.missingInvoiceCount && !record.missingJournalCount && !record.missingFeeCount ? (
            <Tag color="green">完整</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '建議動作',
      render: (_, record) => (
        <div>
          <div className="text-sm text-slate-700">{record.recommendedAction}</div>
          <div className="mt-1 text-xs text-slate-400">
            下次出帳 {dayjs(record.nextStatementDate).format('YYYY/MM/DD')}
          </div>
        </div>
      ),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="space-y-6 p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Title level={2} className="!mb-1 !font-light">會計工作台</Title>
          <Text type="secondary">集中處理待撥款、手續費、發票、應收與分錄核銷。</Text>
        </div>
        <Space wrap>
          <RangePicker
            value={dateRange}
            onChange={(value) => {
              if (value?.[0] && value?.[1]) setDateRange([value[0], value[1]])
            }}
            allowClear={false}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchWorkbench}>
            重新整理
          </Button>
        </Space>
      </div>

      <Card className="overflow-hidden rounded-3xl border-0 shadow-sm" bodyStyle={{ padding: 0 }}>
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="bg-[linear-gradient(135deg,#0f172a,#1e293b,#0f766e)] px-7 py-7 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-white/55">
              Accounting Control Room
            </div>
            <div className="mt-3 text-4xl font-semibold">自動對帳閉環</div>
            <div className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
              系統先自動比對；只有缺綠界撥款、缺手續費、未開票、金額不一致或尚未產生分錄時，才會留在這裡讓會計處理。
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <div className="text-xs text-white/50">開放異常</div>
                <div className="mt-2 text-2xl font-semibold">{executive?.operations.openAnomalyCount || 0}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <div className="text-xs text-white/50">待補費率</div>
                <div className="mt-2 text-2xl font-semibold">{executive?.operations.feeBackfillCount || 0}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <div className="text-xs text-white/50">已對帳未落帳</div>
                <div className="mt-2 text-2xl font-semibold">{executive?.operations.missingPayoutJournalCount || 0}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <div className="text-xs text-white/50">逾期應收</div>
                <div className="mt-2 text-2xl font-semibold">{arSummary?.overdueReceivableCount || 0}</div>
              </div>
            </div>
          </div>
          <div className="bg-white/70 px-7 py-7">
            <div className="flex items-center gap-3">
              <SafetyCertificateOutlined className="text-2xl text-emerald-600" />
              <div>
                <div className="text-sm font-semibold text-slate-900">自動核銷完成度</div>
                <div className="text-xs text-slate-400">以目前稽核區間已對帳訂單計算</div>
              </div>
            </div>
            <Progress
              percent={automationCompletion}
              strokeColor={{ '0%': '#0f766e', '100%': '#22c55e' }}
              className="mt-6"
            />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Statistic title="已稽核" value={auditSummary?.auditedOrderCount || 0} />
              <Statistic title="已對帳" value={auditSummary?.reconciledOrderCount || 0} />
              <Statistic title="手續費異常" value={auditSummary?.feeIssueCount || 0} />
              <Statistic title="發票異常" value={auditSummary?.invoiceIssueCount || 0} />
            </div>
          </div>
        </div>
      </Card>

      <Alert
        showIcon
        type="info"
        message="自動判斷規則"
        description="平台手續費優先吃平台 API；金流手續費以綠界撥款/對帳資料為最終依據。抓不到時不亂估，而是標記待補並進入會計工作台。"
      />

      <Card className="rounded-3xl border-0 bg-white/65 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Action Rail
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              把警示往核銷推進
            </div>
            <div className="mt-1 text-sm text-slate-500">
              先同步應收與發票狀態；綠界服務費發票與月度稽核則進入 AP / 報表中心處理。
            </div>
          </div>
          <Space wrap>
            <Button
              type="primary"
              icon={<ClockCircleOutlined />}
              loading={syncingAr}
              onClick={handleSyncAr}
              className="bg-slate-950 hover:!bg-slate-800"
            >
              同步銷售到 AR
            </Button>
            <Button
              icon={<SafetyCertificateOutlined />}
              loading={syncingInvoiceStatus}
              onClick={handleSyncInvoiceStatuses}
            >
              同步發票狀態
            </Button>
            <Button
              icon={<BankOutlined />}
              onClick={openFeeImportModal}
            >
              匯入綠界服務費發票
            </Button>
            <Button
              icon={<CheckCircleOutlined />}
              onClick={() => navigate('/ap/payable?tab=ecpay-fees')}
            >
              處理綠界服務費 AP
            </Button>
            <Button
              icon={<AuditOutlined />}
              onClick={() => navigate('/reports')}
            >
              查看報表稽核
            </Button>
          </Space>
        </div>
      </Card>

      <Tabs
        items={[
          {
            key: 'exceptions',
            label: (
              <span><ExceptionOutlined /> 異常待辦</span>
            ),
            children: (
              <Table
                rowKey="key"
                loading={loading}
                columns={anomalyColumns}
                dataSource={anomalies}
                pagination={false}
                className="rounded-3xl bg-white/60"
              />
            ),
          },
          {
            key: 'payments',
            label: (
              <span><BankOutlined /> 收款與撥款</span>
            ),
            children: (
              <Table
                rowKey="paymentId"
                loading={loading}
                columns={paymentColumns}
                dataSource={recentItems}
                pagination={{ pageSize: 10 }}
                className="rounded-3xl bg-white/60"
              />
            ),
          },
          {
            key: 'batches',
            label: (
              <span><CheckCircleOutlined /> 對帳批次</span>
            ),
            children: (
              <Table
                rowKey="id"
                loading={loading}
                columns={batchColumns}
                dataSource={recentBatches}
                pagination={{ pageSize: 10 }}
                className="rounded-3xl bg-white/60"
              />
            ),
          },
          {
            key: 'audit',
            label: (
              <span><AuditOutlined /> 逐筆稽核</span>
            ),
            children: (
              <Table
                rowKey="orderId"
                loading={loading}
                columns={auditColumns}
                dataSource={auditItems}
                pagination={{ pageSize: 10 }}
                className="rounded-3xl bg-white/60"
              />
            ),
          },
          {
            key: 'ar',
            label: (
              <span><ClockCircleOutlined /> 應收缺口</span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col span={24}>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Card><Statistic title="應收未收" value={arSummary?.outstandingAmount || 0} prefix="NT$" precision={0} /></Card>
                    <Card><Statistic title="手續費待補" value={arSummary?.missingFeeCount || 0} /></Card>
                    <Card><Statistic title="待補發票" value={arSummary?.missingInvoiceCount || 0} /></Card>
                    <Card><Statistic title="尚未分錄" value={arSummary?.missingJournalCount || 0} /></Card>
                  </div>
                </Col>
                <Col span={24}>
                  <Card
                    title="應收分類總覽"
                    className="rounded-3xl border-0 bg-white/70 shadow-sm"
                    extra={<Text type="secondary">按平台、付款方式、B2B 月結與團購拆分追帳</Text>}
                  >
                    <Table
                      rowKey="key"
                      loading={loading}
                      columns={arGroupColumns}
                      dataSource={arGroups}
                      pagination={false}
                      className="rounded-2xl bg-white/60"
                    />
                  </Card>
                </Col>
                <Col span={24}>
                  <Table
                    rowKey="orderId"
                    loading={loading}
                    columns={arColumns}
                    dataSource={arItems}
                    pagination={{ pageSize: 10 }}
                    className="rounded-3xl bg-white/60"
                  />
                </Col>
              </Row>
            ),
          },
          {
            key: 'b2b-statements',
            label: (
              <span><BankOutlined /> B2B 月結</span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col span={24}>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Card><Statistic title="月結客戶" value={b2bSummary?.customerCount || 0} /></Card>
                    <Card><Statistic title="開放應收" value={b2bSummary?.outstandingAmount || 0} prefix="NT$" precision={0} /></Card>
                    <Card><Statistic title="逾期金額" value={b2bSummary?.overdueAmount || 0} prefix="NT$" precision={0} /></Card>
                    <Card><Statistic title="超額 / 缺 Email" value={`${b2bSummary?.overCreditCount || 0} / ${b2bSummary?.missingStatementEmailCount || 0}`} /></Card>
                  </div>
                </Col>
                <Col span={24}>
                  <Alert
                    showIcon
                    type="info"
                    message="B2B 月結追帳邏輯"
                    description="公司客戶或已設定月結條件的客戶會集中在這裡。系統會按帳期與到期日自動拆帳齡，月底可用這份資料產生對帳單，收款後再回寫核銷 AR。"
                  />
                </Col>
                <Col span={24}>
                  <Table
                    rowKey={(record) => record.customerId || record.customerName}
                    loading={loading}
                    columns={b2bColumns}
                    dataSource={b2bCustomers}
                    pagination={{ pageSize: 10 }}
                    className="rounded-3xl bg-white/60"
                  />
                </Col>
              </Row>
            ),
          },
        ]}
      />

      <Modal
        title="匯入綠界服務費發票"
        open={feeImportOpen}
        onCancel={() => setFeeImportOpen(false)}
        onOk={handleImportFeeInvoices}
        confirmLoading={importingFeeInvoices}
        okText="匯入並核對"
        cancelText="取消"
        width={860}
      >
        <Alert
          showIcon
          type="warning"
          className="mb-4"
          message="這是綠界開給我們的服務費發票，不是客戶訂單發票"
          description="匯入後會建立 AP 發票，並按月份與 merchant 去核對已回填的綠界金流手續費。若金額對得上，系統可自動標記為已沖抵。"
        />
        <Form
          form={feeImportForm}
          layout="vertical"
          initialValues={{
            merchantId: '3290494',
            vendorName: '綠界科技',
            verifyIssuedStatus: true,
            autoOffsetByMatchedFees: true,
            records: [{ invoiceStatus: 'issued', serviceType: 'gateway_fee', amountCurrency: 'TWD' }],
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item
              name="merchantId"
              label="綠界商店代號"
              rules={[{ required: true, message: '請選擇商店代號' }]}
            >
              <Select options={ECPAY_MERCHANT_OPTIONS} />
            </Form.Item>
            <Form.Item name="vendorName" label="供應商名稱">
              <Input placeholder="綠界科技" />
            </Form.Item>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="verifyIssuedStatus" label="向綠界確認已開立" valuePropName="checked">
              <Switch checkedChildren="驗證" unCheckedChildren="略過" />
            </Form.Item>
            <Form.Item name="autoOffsetByMatchedFees" label="若與手續費金額相符，自動沖抵" valuePropName="checked">
              <Switch checkedChildren="自動" unCheckedChildren="手動" />
            </Form.Item>
          </div>

          <Form.List name="records">
            {(fields, { add, remove }) => (
              <div className="space-y-4">
                {fields.map((field, index) => (
                  <Card
                    key={field.key}
                    size="small"
                    className="rounded-2xl bg-slate-50/80"
                    title={`服務費發票 ${index + 1}`}
                    extra={
                      fields.length > 1 ? (
                        <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      ) : null
                    }
                  >
                    <div className="grid gap-3 md:grid-cols-4">
                      <Form.Item
                        {...field}
                        name={[field.name, 'invoiceNo']}
                        label="發票號碼"
                        rules={[{ required: true, message: '請輸入發票號碼' }]}
                      >
                        <Input placeholder="例如 YM04187700" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'invoiceDate']}
                        label="發票日期"
                        rules={[{ required: true, message: '請選擇發票日期' }]}
                      >
                        <DatePicker className="w-full" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'amountOriginal']}
                        label="發票金額"
                        rules={[{ required: true, message: '請輸入金額' }]}
                      >
                        <InputNumber min={0} precision={0} className="w-full" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'taxAmount']} label="稅額">
                        <InputNumber min={0} precision={0} className="w-full" placeholder="留白自動估算" />
                      </Form.Item>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <Form.Item {...field} name={[field.name, 'serviceType']} label="費用類型">
                        <Select
                          options={[
                            { label: '金流手續費', value: 'gateway_fee' },
                            { label: '電子發票服務費', value: 'einvoice_fee' },
                            { label: '物流服務費', value: 'logistics_fee' },
                            { label: '其他服務費', value: 'service_fee' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'invoiceStatus']} label="發票狀態">
                        <Select
                          options={[
                            { label: '已開立', value: 'issued' },
                            { label: '待確認', value: 'unknown' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'relateNumber']} label="關聯編號">
                        <Input placeholder="選填" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'amountCurrency']} label="幣別">
                        <Select options={[{ label: 'TWD', value: 'TWD' }]} />
                      </Form.Item>
                    </div>
                    <Form.Item {...field} name={[field.name, 'note']} label="備註">
                      <Input.TextArea rows={2} placeholder="例如：2026/03 金物流手續費" />
                    </Form.Item>
                  </Card>
                ))}
                <Button
                  block
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ invoiceStatus: 'issued', serviceType: 'gateway_fee', amountCurrency: 'TWD' })}
                >
                  新增一筆服務費發票
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default AccountingWorkbenchPage
