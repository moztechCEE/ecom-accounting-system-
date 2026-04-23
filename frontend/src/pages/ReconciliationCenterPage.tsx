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
  reconciliationService,
  ReconciliationBucketKey,
  ReconciliationCenterItem,
  ReconciliationCenterResponse,
} from '../services/reconciliation.service'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

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

const severityColor = (severity: ReconciliationCenterItem['severity']) => {
  if (severity === 'critical') return 'red'
  if (severity === 'warning') return 'gold'
  return 'green'
}

const clearBlockerLabels: Record<string, string> = {
  already_has_reconciliation_journal: '已建立核銷分錄',
  missing_order: '找不到對應訂單',
  refund_or_cancelled_order_requires_reversal: '退款 / 取消單需人工反向核銷',
  missing_invoice: '缺發票',
  partial_payment_waiting_remaining: '部分收款，等尾款',
  amount_mismatch: '訂單與收款金額不一致',
  missing_actual_fee: '缺實際手續費',
  invalid_amount: '金額異常',
  net_fee_gross_mismatch: '淨額 / 手續費 / 總額不一致',
  period_closed: '會計期間已關帳',
  period_locked: '會計期間已鎖帳',
  ready_to_clear: '可核銷',
  unknown: '未知原因',
}

const describeClearBlockers = (
  topReasons?: Array<{ reason: string; count: number }>,
) => {
  const blockers = (topReasons || []).filter((item) => item.reason !== 'ready_to_clear')
  if (!blockers.length) return ''

  return blockers
    .slice(0, 3)
    .map((item) => `${clearBlockerLabels[item.reason] || item.reason} ${item.count} 筆`)
    .join('、')
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
  const [clearing, setClearing] = useState(false)
  const [center, setCenter] = useState<ReconciliationCenterResponse | null>(null)

  const entityId = localStorage.getItem('entityId')?.trim() || DEFAULT_ENTITY_ID
  const startDate = dateRange[0].startOf('day').toISOString()
  const endDate = dateRange[1].endOf('day').toISOString()

  const fetchData = async () => {
    setLoading(true)
    try {
      const centerData = await reconciliationService.getCenter({
        entityId,
        startDate,
        endDate,
        limit: 300,
      })
      setCenter(centerData)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '讀取對帳中心失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [dateRange[0].valueOf(), dateRange[1].valueOf()])

  const bucketSummary = center?.buckets || {
    pending_payout: { count: 0, grossAmount: 0, outstandingAmount: 0, feeTotal: 0, items: [] },
    ready_to_clear: { count: 0, grossAmount: 0, outstandingAmount: 0, feeTotal: 0, items: [] },
    cleared: { count: 0, grossAmount: 0, outstandingAmount: 0, feeTotal: 0, items: [] },
    exceptions: { count: 0, grossAmount: 0, outstandingAmount: 0, feeTotal: 0, items: [] },
  }
  const visibleItems = center?.buckets?.[activeBucket]?.items || []
  const completionRate = center?.summary.completionRate || 0
  const exceptionAmount = center?.summary.exceptionAmount || 0
  const pendingAmount = center?.summary.pendingPayoutAmount || 0

  const handleSyncCore = async () => {
    setSyncing(true)
    try {
      const result = await reconciliationService.runCore({
        entityId,
        startDate,
        endDate,
        syncShopify: true,
        syncOneShop: true,
        syncEcpayPayouts: true,
        syncInvoices: true,
        autoClear: true,
      })
      const successSteps = result.steps.filter((step) => step.status === 'success').length
      if (result.success) {
        message.success(`核心對帳完成：${successSteps} 個步驟成功，已重算對帳中心`)
      } else {
        message.warning(`核心對帳完成但有 ${result.failedCount} 個步驟失敗，請查看異常隊列`)
      }
      await fetchData()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '核心對帳 Job 執行失敗')
    } finally {
      setSyncing(false)
    }
  }

  const handleClearReady = async () => {
    setClearing(true)
    try {
      const result = await reconciliationService.clearReady({
        entityId,
        startDate,
        endDate,
        limit: 200,
      })
      if (result.failed > 0) {
        const blockers = describeClearBlockers(result.topReasons)
        message.warning(
          blockers
            ? `核銷完成：成功 ${result.cleared} 筆；主要卡在 ${blockers}`
            : `核銷完成：成功 ${result.cleared} 筆，失敗 ${result.failed} 筆，略過 ${result.skipped} 筆`,
        )
      } else {
        const blockers = describeClearBlockers(result.topReasons)
        if (blockers) {
          message.info(`目前可自動核銷 ${result.cleared} 筆；其餘主要卡在 ${blockers}`)
        } else {
          message.success(`核銷完成：成功 ${result.cleared} 筆，略過 ${result.skipped} 筆`)
        }
      }
      await fetchData()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '核銷可核銷款項失敗')
    } finally {
      setClearing(false)
    }
  }

  const columns: ColumnsType<ReconciliationCenterItem> = [
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
      className="space-y-10 p-6"
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
          <Button
            icon={<CheckCircleOutlined />}
            loading={clearing}
            onClick={handleClearReady}
          >
            核銷可核銷
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

      <div className="mt-3 grid gap-6 md:grid-cols-4 xl:mt-4">
        {(Object.keys(bucketMeta) as ReconciliationBucketKey[]).map((key) => (
          <Card
            key={key}
            bodyStyle={{ padding: '26px 24px 24px' }}
            className={`cursor-pointer rounded-3xl border-0 shadow-sm transition hover:-translate-y-1 hover:shadow-md ${
              activeBucket === key ? 'ring-2 ring-slate-900' : ''
            }`}
            onClick={() => setActiveBucket(key)}
          >
            <Statistic title={bucketMeta[key].title} value={bucketSummary[key].count} />
            <div className="mt-4 text-xs text-slate-400">未收 {money(bucketSummary[key].outstandingAmount)}</div>
            <div className="mt-2 text-xs text-slate-400">手續費 {money(bucketSummary[key].feeTotal)}</div>
          </Card>
        ))}
      </div>

      <Alert
        showIcon
        type={activeBucket === 'exceptions' ? 'warning' : 'info'}
        className="rounded-3xl !px-6 !py-4 shadow-sm"
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

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
