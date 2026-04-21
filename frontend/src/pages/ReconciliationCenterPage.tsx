import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Progress,
  Segmented,
  Space,
  Statistic,
  Table,
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
  ExclamationCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs, { Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import {
  dashboardService,
  OrderReconciliationAudit,
  OrderReconciliationAuditItem,
} from '../services/dashboard.service'
import {
  arService,
  ReceivableMonitorItem,
  ReceivableMonitorResponse,
} from '../services/ar.service'
import { salesService } from '../services/sales.service'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

type ReconciliationBucketKey = 'pending_payout' | 'ready_to_clear' | 'cleared' | 'exceptions'

type ReconciliationQueueItem = {
  key: string
  bucket: ReconciliationBucketKey
  orderNumber: string
  customerName: string
  sourceLabel: string
  orderDate: string
  dueDate?: string | null
  grossAmount: number
  paidAmount: number
  netAmount: number
  feeTotal: number
  outstandingAmount: number
  invoiceNumber?: string | null
  feeStatus?: string | null
  reconciledFlag: boolean
  accountingPosted: boolean
  severity: 'healthy' | 'warning' | 'critical'
  reason: string
  nextAction: string
}

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

const money = (value?: number | null) =>
  `NT$ ${Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`

const bucketMeta: Record<
  ReconciliationBucketKey,
  { title: string; subtitle: string; color: string; icon: React.ReactNode }
> = {
  pending_payout: {
    title: '待撥款',
    subtitle: '訂單成立，但綠界或平台款項尚未完成核對',
    color: '#f59e0b',
    icon: <ClockCircleOutlined />,
  },
  ready_to_clear: {
    title: '可核銷',
    subtitle: '款項已進來，下一步是入帳、補發票或補分錄',
    color: '#0ea5e9',
    icon: <BankOutlined />,
  },
  cleared: {
    title: '已核銷',
    subtitle: '訂單、撥款、手續費、發票與分錄都已閉環',
    color: '#10b981',
    icon: <CheckCircleOutlined />,
  },
  exceptions: {
    title: '異常',
    subtitle: '金額、手續費、發票或對帳狀態需要人工確認',
    color: '#ef4444',
    icon: <ExclamationCircleOutlined />,
  },
}

const severityColor = (severity: ReconciliationQueueItem['severity']) => {
  if (severity === 'critical') return 'red'
  if (severity === 'warning') return 'gold'
  return 'green'
}

const normalizeAuditMap = (audit?: OrderReconciliationAudit | null) => {
  const map = new Map<string, OrderReconciliationAuditItem>()
  for (const item of audit?.items || []) {
    map.set(item.orderId, item)
  }
  return map
}

const classifyItem = (
  item: ReceivableMonitorItem,
  auditItem?: OrderReconciliationAuditItem,
): ReconciliationQueueItem => {
  const hasException =
    auditItem?.severity === 'critical' ||
    auditItem?.severity === 'warning' ||
    item.warningCodes.some((code) =>
      [
        'missing_fee',
        'missing_journal',
        'invoice_pending',
        'invoice_issued_unposted',
        'invoice_issued_unpaid',
        'overdue_receivable',
      ].includes(code),
    )

  let bucket: ReconciliationBucketKey = 'pending_payout'
  let reason = item.settlementDiagnostic || '等待綠界或平台撥款資料回填。'
  let nextAction = '等待下一次自動同步，或手動匯入綠界撥款資料。'

  if (
    item.reconciledFlag &&
    item.accountingPosted &&
    item.invoiceNumber &&
    item.feeStatus === 'actual' &&
    item.outstandingAmount <= 0
  ) {
    bucket = 'cleared'
    reason = '訂單、撥款、手續費、發票與分錄已對齊。'
    nextAction = '不需處理。'
  } else if (hasException) {
    bucket = 'exceptions'
    reason =
      auditItem?.anomalyMessages?.[0] ||
      item.warningCodes.join('、') ||
      '這筆訂單有資料缺口，需要人工確認。'
    nextAction =
      auditItem?.recommendation ||
      '先補綠界撥款/手續費或發票狀態，再重新同步。'
  } else if (item.paidAmount > 0 || item.reconciledFlag) {
    bucket = 'ready_to_clear'
    reason = '已看到收款或撥款資料，可以進入核銷檢查。'
    nextAction = '確認手續費、發票與分錄後核銷。'
  }

  return {
    key: item.orderId,
    bucket,
    orderNumber: item.orderNumber,
    customerName: item.customerName,
    sourceLabel: item.sourceLabel,
    orderDate: item.orderDate,
    dueDate: item.dueDate,
    grossAmount: item.grossAmount,
    paidAmount: item.paidAmount,
    netAmount: item.netAmount,
    feeTotal: item.feeTotal,
    outstandingAmount: item.outstandingAmount,
    invoiceNumber: item.invoiceNumber,
    feeStatus: item.feeStatus,
    reconciledFlag: item.reconciledFlag,
    accountingPosted: item.accountingPosted,
    severity: bucket === 'exceptions' ? auditItem?.severity || 'warning' : 'healthy',
    reason,
    nextAction,
  }
}

const ReconciliationCenterPage: React.FC = () => {
  const navigate = useNavigate()
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, 'day').startOf('day'),
    dayjs().endOf('day'),
  ])
  const [activeBucket, setActiveBucket] = useState<ReconciliationBucketKey>('exceptions')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [receivables, setReceivables] = useState<ReceivableMonitorResponse | null>(null)
  const [audit, setAudit] = useState<OrderReconciliationAudit | null>(null)

  const entityId = localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
  const startDate = dateRange[0].startOf('day').toISOString()
  const endDate = dateRange[1].endOf('day').toISOString()

  const fetchData = async () => {
    setLoading(true)
    try {
      const [receivableData, auditData] = await Promise.all([
        arService.getReceivableMonitor({ entityId, startDate, endDate }),
        dashboardService.getOrderReconciliationAudit({
          entityId,
          startDate,
          endDate,
          limit: 300,
        }),
      ])
      setReceivables(receivableData)
      setAudit(auditData)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '讀取對帳中心失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [dateRange[0].valueOf(), dateRange[1].valueOf()])

  const queueItems = useMemo(() => {
    const auditMap = normalizeAuditMap(audit)
    return (receivables?.items || []).map((item) => classifyItem(item, auditMap.get(item.orderId)))
  }, [audit, receivables])

  const bucketSummary = useMemo(() => {
    return queueItems.reduce(
      (acc, item) => {
        acc[item.bucket].count += 1
        acc[item.bucket].grossAmount += item.grossAmount
        acc[item.bucket].outstandingAmount += item.outstandingAmount
        acc[item.bucket].feeTotal += item.feeTotal
        return acc
      },
      {
        pending_payout: { count: 0, grossAmount: 0, outstandingAmount: 0, feeTotal: 0 },
        ready_to_clear: { count: 0, grossAmount: 0, outstandingAmount: 0, feeTotal: 0 },
        cleared: { count: 0, grossAmount: 0, outstandingAmount: 0, feeTotal: 0 },
        exceptions: { count: 0, grossAmount: 0, outstandingAmount: 0, feeTotal: 0 },
      } as Record<ReconciliationBucketKey, { count: number; grossAmount: number; outstandingAmount: number; feeTotal: number }>,
    )
  }, [queueItems])

  const visibleItems = queueItems.filter((item) => item.bucket === activeBucket)
  const totalCount = queueItems.length
  const clearedCount = bucketSummary.cleared.count
  const completionRate = totalCount ? Math.round((clearedCount / totalCount) * 100) : 0
  const exceptionAmount = bucketSummary.exceptions.outstandingAmount
  const pendingAmount = bucketSummary.pending_payout.outstandingAmount

  const handleSyncCore = async () => {
    setSyncing(true)
    try {
      await arService.syncSalesOrders(entityId)
      await salesService.syncInvoiceStatusBatch({ entityId, startDate, endDate, limit: 200 })
      message.success('核心同步完成：已同步 AR 與發票狀態')
      await fetchData()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '核心同步失敗')
    } finally {
      setSyncing(false)
    }
  }

  const columns: ColumnsType<ReconciliationQueueItem> = [
    {
      title: '訂單 / 通路',
      render: (_, record) => (
        <div>
          <div className="font-semibold text-slate-900">{record.orderNumber}</div>
          <div className="text-xs text-slate-400">
            {record.customerName} · {record.sourceLabel} · {dayjs(record.orderDate).format('YYYY/MM/DD')}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Tag color={record.reconciledFlag ? 'green' : 'gold'}>
              {record.reconciledFlag ? '已對帳' : '待對帳'}
            </Tag>
            <Tag color={record.invoiceNumber ? 'green' : 'blue'}>
              {record.invoiceNumber || '待發票'}
            </Tag>
            <Tag color={record.feeStatus === 'actual' ? 'green' : 'red'}>
              {record.feeStatus === 'actual' ? '實際手續費' : '手續費待補'}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: '金額',
      width: 220,
      align: 'right',
      render: (_, record) => (
        <div className="text-sm">
          <div>訂單 {money(record.grossAmount)}</div>
          <div>已收 {money(record.paidAmount)}</div>
          <div className="text-rose-500">未收 {money(record.outstandingAmount)}</div>
          <div className="font-semibold text-emerald-600">淨額 {money(record.netAmount)}</div>
        </div>
      ),
    },
    {
      title: '系統判斷',
      render: (_, record) => (
        <div>
          <Tag color={severityColor(record.severity)}>{bucketMeta[record.bucket].title}</Tag>
          <div className="mt-2 text-sm text-slate-700">{record.reason}</div>
          <div className="mt-1 text-xs text-slate-400">{record.nextAction}</div>
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
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
            Reconciliation Center
          </div>
          <Title level={2} className="!mb-1 !font-light">對帳中心</Title>
          <Text type="secondary">
            不看雜訊，只看每筆訂單是否完成「訂單、綠界/平台撥款、手續費、發票、入帳」閉環。
          </Text>
        </div>
        <Space wrap>
          <RangePicker
            value={dateRange}
            onChange={(value) => {
              if (value?.[0] && value?.[1]) setDateRange([value[0], value[1]])
            }}
            allowClear={false}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchData}>
            重新整理
          </Button>
          <Button
            type="primary"
            icon={<SafetyCertificateOutlined />}
            loading={syncing}
            onClick={handleSyncCore}
            className="bg-slate-950 hover:!bg-slate-800"
          >
            跑核心同步
          </Button>
        </Space>
      </div>

      <Card className="overflow-hidden rounded-[32px] border-0 shadow-sm" bodyStyle={{ padding: 0 }}>
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="bg-[radial-gradient(circle_at_10%_20%,rgba(14,165,233,.35),transparent_32%),linear-gradient(135deg,#07111f,#0f172a_55%,#12312d)] p-7 text-white">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/12 text-xl">
                <AuditOutlined />
              </div>
              <div>
                <div className="text-sm font-semibold text-white/90">今天的任務</div>
                <div className="text-xs text-white/55">先處理異常，再確認可核銷，待撥款只追蹤不焦慮。</div>
              </div>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs text-white/50">異常未收</div>
                <div className="mt-2 text-3xl font-semibold">{money(exceptionAmount)}</div>
              </div>
              <div>
                <div className="text-xs text-white/50">待撥款未收</div>
                <div className="mt-2 text-3xl font-semibold">{money(pendingAmount)}</div>
              </div>
              <div>
                <div className="text-xs text-white/50">閉環完成率</div>
                <div className="mt-2 text-3xl font-semibold">{completionRate}%</div>
              </div>
            </div>
            <Progress
              percent={completionRate}
              showInfo={false}
              strokeColor="#34d399"
              trailColor="rgba(255,255,255,.16)"
              className="mt-6"
            />
          </div>
          <div className="bg-white/75 p-7">
            <div className="text-sm font-semibold text-slate-900">系統只分四種狀態</div>
            <div className="mt-4 space-y-3">
              {(Object.keys(bucketMeta) as ReconciliationBucketKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveBucket(key)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                    activeBucket === key
                      ? 'border-slate-900 bg-slate-950 text-white shadow-lg'
                      : 'border-white/70 bg-white/70 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span style={{ color: activeBucket === key ? '#fff' : bucketMeta[key].color }}>
                      {bucketMeta[key].icon}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{bucketMeta[key].title}</span>
                      <span className={`block text-xs ${activeBucket === key ? 'text-white/60' : 'text-slate-400'}`}>
                        {bucketMeta[key].subtitle}
                      </span>
                    </span>
                  </span>
                  <span className="text-lg font-semibold">{bucketSummary[key].count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {(Object.keys(bucketMeta) as ReconciliationBucketKey[]).map((key) => (
          <Card
            key={key}
            className={`cursor-pointer rounded-3xl border-0 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              activeBucket === key ? 'ring-2 ring-slate-900' : ''
            }`}
            onClick={() => setActiveBucket(key)}
          >
            <Statistic title={bucketMeta[key].title} value={bucketSummary[key].count} />
            <div className="mt-3 text-xs text-slate-400">未收 {money(bucketSummary[key].outstandingAmount)}</div>
            <div className="mt-1 text-xs text-slate-400">手續費 {money(bucketSummary[key].feeTotal)}</div>
          </Card>
        ))}
      </div>

      <Alert
        showIcon
        type={activeBucket === 'exceptions' ? 'warning' : 'info'}
        message={`${bucketMeta[activeBucket].title}處理原則`}
        description={
          activeBucket === 'pending_payout'
            ? '這些單不一定有問題，通常是綠界或平台還沒撥款。系統會保留在途狀態，等撥款資料進來後再自動核銷。'
            : activeBucket === 'ready_to_clear'
              ? '這些單已經看到收款或撥款資料，下一步是補齊手續費、發票與分錄，確認後即可核銷。'
              : activeBucket === 'cleared'
                ? '這些單已經完成閉環，可以作為月報、淨利與會計分錄的可信資料來源。'
                : '這些單需要優先處理：可能是缺綠界手續費、缺發票、金額不符、逾期未收或尚未產生會計分錄。'
        }
      />

      <div className="flex items-center justify-between">
        <Segmented
          value={activeBucket}
          onChange={(value) => setActiveBucket(value as ReconciliationBucketKey)}
          options={(Object.keys(bucketMeta) as ReconciliationBucketKey[]).map((key) => ({
            label: bucketMeta[key].title,
            value: key,
          }))}
        />
        <Space>
          <Button onClick={() => navigate('/accounting/workbench')}>
            進階會計工作台
          </Button>
          <Button onClick={() => navigate('/reports')}>
            報表中心
          </Button>
        </Space>
      </div>

      <Table
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={visibleItems}
        pagination={{ pageSize: 12 }}
        className="rounded-3xl bg-white/60"
      />
    </motion.div>
  )
}

export default ReconciliationCenterPage
