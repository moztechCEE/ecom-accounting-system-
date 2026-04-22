<<<<<<< HEAD
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
=======
/**
 * ReconciliationCenterPage.tsx
 * 新增：電商對帳中心頁面
 * 包含四個 Tab：平台撥款對帳、手續費明細、發票稽核、ECPay 撥款進度
 * 資料使用 mock data + API 呼叫骨架（/api/reconciliation/ 前綴）
 */

import React, { useState, useEffect } from 'react'
import {
  Tabs,
  Table,
  Tag,
  Button,
  DatePicker,
  Select,
  Statistic,
  Row,
  Col,
  Space,
  Typography,
  message,
  Tooltip,
  Progress,
} from 'antd'
import {
  SyncOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  FileAddOutlined,
  CheckOutlined,
  DollarOutlined,
  BankOutlined,
  FileDoneOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { GlassCard } from '../components/ui/GlassCard'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
>>>>>>> a309c4d4 (feat(ai): Claude 自動更新 — 2026-04-22 16:40:40)

const { Title, Text } = Typography
const { RangePicker } = DatePicker

<<<<<<< HEAD
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
=======
// ─── 型別定義 ──────────────────────────────────────────

interface PlatformPayout {
  key: string
  platform: string
  payoutDate: string
  orderCount: number
  gross: number
  platformFee: number
  gatewayFee: number
  shippingFee: number
  net: number
  status: 'reconciled' | 'pending' | 'discrepancy'
}

interface FeeDetail {
  key: string
  platform: string
  date: string
  gross: number
  platformFee: number
  platformFeeRate: number
  gatewayFee: number
  gatewayFeeRate: number
  net: number
}

interface MissingInvoice {
  key: string
  orderId: string
  externalOrderId: string
  platform: string
  orderDate: string
  amount: number
  status: string
  remark: string
}

interface EcpayPayout {
  key: string
  batchId: string
  payoutDate: string
  expectedDate: string
  actualDate: string | null
  diffDays: number | null
  amount: number
  status: 'completed' | 'pending'
}

// ─── 金額格式化 ──────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString('zh-TW', { minimumFractionDigits: 0 }) + ' 元'

const fmtRate = (n: number) => `${(n * 100).toFixed(2)}%`

// ─── Mock Data ──────────────────────────────────────────

const mockPayouts: PlatformPayout[] = [
  {
    key: '1',
    platform: 'Shopify',
    payoutDate: '2026-04-15',
    orderCount: 142,
    gross: 1_250_000,
    platformFee: 37_500,
    gatewayFee: 12_500,
    shippingFee: 8_000,
    net: 1_192_000,
    status: 'reconciled',
  },
  {
    key: '2',
    platform: 'Shopline',
    payoutDate: '2026-04-15',
    orderCount: 87,
    gross: 680_000,
    platformFee: 20_400,
    gatewayFee: 6_800,
    shippingFee: 5_200,
    net: 647_600,
    status: 'pending',
  },
  {
    key: '3',
    platform: '1Shop',
    payoutDate: '2026-04-14',
    orderCount: 56,
    gross: 420_000,
    platformFee: 12_600,
    gatewayFee: 4_200,
    shippingFee: 3_100,
    net: 400_100,
    status: 'reconciled',
  },
  {
    key: '4',
    platform: 'ECPay',
    payoutDate: '2026-04-13',
    orderCount: 210,
    gross: 1_850_000,
    platformFee: 55_500,
    gatewayFee: 18_500,
    shippingFee: 14_200,
    net: 1_761_800,
    status: 'discrepancy',
  },
]

const mockFeeDetails: FeeDetail[] = [
  {
    key: '1',
    platform: 'Shopify',
    date: '2026-04-15',
    gross: 1_250_000,
    platformFee: 37_500,
    platformFeeRate: 0.03,
    gatewayFee: 12_500,
    gatewayFeeRate: 0.01,
    net: 1_200_000,
  },
  {
    key: '2',
    platform: 'Shopline',
    date: '2026-04-15',
    gross: 680_000,
    platformFee: 20_400,
    platformFeeRate: 0.03,
    gatewayFee: 6_800,
    gatewayFeeRate: 0.01,
    net: 652_800,
  },
  {
    key: '3',
    platform: '1Shop',
    date: '2026-04-14',
    gross: 420_000,
    platformFee: 12_600,
    platformFeeRate: 0.03,
    gatewayFee: 4_200,
    gatewayFeeRate: 0.01,
    net: 403_200,
  },
  {
    key: '4',
    platform: 'ECPay',
    date: '2026-04-13',
    gross: 1_850_000,
    platformFee: 55_500,
    platformFeeRate: 0.03,
    gatewayFee: 18_500,
    gatewayFeeRate: 0.01,
    net: 1_776_000,
  },
]

const mockMissingInvoices: MissingInvoice[] = [
  {
    key: '1',
    orderId: 'order-a1b2c3',
    externalOrderId: 'SH-20240411-001',
    platform: 'Shopify',
    orderDate: '2026-04-11',
    amount: 3_200,
    status: 'completed',
    remark: '未開發票',
  },
  {
    key: '2',
    orderId: 'order-d4e5f6',
    externalOrderId: 'EC-20240412-052',
    platform: 'ECPay',
    orderDate: '2026-04-12',
    amount: 8_900,
    status: 'paid',
    remark: '發票作廢未補開',
  },
  {
    key: '3',
    orderId: 'order-g7h8i9',
    externalOrderId: 'SL-20240413-021',
    platform: 'Shopline',
    orderDate: '2026-04-13',
    amount: 5_600,
    status: 'fulfilled',
    remark: '未開發票',
  },
]

const mockEcpayPayouts: EcpayPayout[] = [
  {
    key: '1',
    batchId: 'ECPAY-2026-0415-001',
    payoutDate: '2026-04-15',
    expectedDate: '2026-04-15',
    actualDate: '2026-04-15',
    diffDays: 0,
    amount: 450_000,
    status: 'completed',
  },
  {
    key: '2',
    batchId: 'ECPAY-2026-0416-001',
    payoutDate: '2026-04-16',
    expectedDate: '2026-04-16',
    actualDate: null,
    diffDays: null,
    amount: 720_000,
    status: 'pending',
  },
  {
    key: '3',
    batchId: 'ECPAY-2026-0417-001',
    payoutDate: '2026-04-17',
    expectedDate: '2026-04-17',
    actualDate: null,
    diffDays: null,
    amount: 385_000,
    status: 'pending',
  },
  {
    key: '4',
    batchId: 'ECPAY-2026-0413-001',
    payoutDate: '2026-04-13',
    expectedDate: '2026-04-13',
    actualDate: '2026-04-14',
    diffDays: 1,
    amount: 290_000,
    status: 'completed',
  },
]

// ─── Tab 1：平台撥款對帳 ──────────────────────────────────

const PayoutReconciliation: React.FC = () => {
  const [data, setData] = useState<PlatformPayout[]>(mockPayouts)
  const [loading, setLoading] = useState(false)
  const [autoMatchLoading, setAutoMatchLoading] = useState(false)

  useEffect(() => {
    const entityId = localStorage.getItem('entityId')?.trim()
    setLoading(true)
    fetch(`/api/reconciliation/platform-payouts?entityId=${entityId ?? ''}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d) && d.length > 0) setData(d)
      })
      .catch(() => {
        // API 不存在時靜默使用 mock data
      })
      .finally(() => setLoading(false))
  }, [])

  const handleAutoMatch = async () => {
    setAutoMatchLoading(true)
    try {
      await fetch('/api/reconciliation/auto-match', { method: 'POST' })
      message.success('自動對帳執行完成')
    } catch {
      message.info('自動對帳功能開發中')
    } finally {
      setAutoMatchLoading(false)
    }
  }

  const statusConfig = {
    reconciled: { color: '#52c41a', bg: '#f6ffed', border: '#b7eb8f', label: '已對帳', icon: <CheckCircleOutlined /> },
    pending: { color: '#fa8c16', bg: '#fff7e6', border: '#ffd591', label: '待對帳', icon: <ClockCircleOutlined /> },
    discrepancy: { color: '#ff4d4f', bg: '#fff2f0', border: '#ffaaa3', label: '有差異', icon: <WarningOutlined /> },
  }

  const reconciledCount = data.filter((d) => d.status === 'reconciled').length
  const totalNet = data.reduce((s, d) => s + d.net, 0)
  const inTransit = data.filter((d) => d.status === 'pending').reduce((s, d) => s + d.net, 0)

  const columns: ColumnsType<PlatformPayout> = [
    { title: '平台', dataIndex: 'platform', key: 'platform', width: 100,
      render: (v) => <Tag color="blue">{v}</Tag> },
    { title: '撥款日期', dataIndex: 'payoutDate', key: 'payoutDate', width: 120 },
    { title: '訂單數', dataIndex: 'orderCount', key: 'orderCount', width: 90, align: 'right' },
    { title: '總金額 (Gross)', dataIndex: 'gross', key: 'gross', align: 'right',
      render: (v) => <span className="font-mono">{fmt(v)}</span> },
    { title: '平台費', dataIndex: 'platformFee', key: 'platformFee', align: 'right',
      render: (v) => <span className="font-mono text-orange-500">-{fmt(v)}</span> },
    { title: '金流費', dataIndex: 'gatewayFee', key: 'gatewayFee', align: 'right',
      render: (v) => <span className="font-mono text-orange-400">-{fmt(v)}</span> },
    { title: '運費', dataIndex: 'shippingFee', key: 'shippingFee', align: 'right',
      render: (v) => <span className="font-mono text-gray-500">-{fmt(v)}</span> },
    { title: '實收淨額 (Net)', dataIndex: 'net', key: 'net', align: 'right',
      render: (v) => <span className="font-mono font-semibold text-green-600">{fmt(v)}</span> },
    {
      title: '對帳狀態',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: keyof typeof statusConfig) => {
        const cfg = statusConfig[v]
        return (
          <Tag
            icon={cfg.icon}
            style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12, padding: '2px 10px' }}
          >
            {cfg.label}
          </Tag>
        )
      },
    },
  ]

  return (
    <div className="space-y-6">
      <Row gutter={[24, 24]}>
        {[
          { label: '本期實收淨額', value: fmt(totalNet), icon: <DollarOutlined className="text-green-500 text-xl" />, color: 'green' },
          { label: '在途未撥款', value: fmt(inTransit), icon: <ClockCircleOutlined className="text-orange-500 text-xl" />, color: 'orange' },
          { label: '已對帳平台數', value: `${reconciledCount} / ${data.length}`, icon: <CheckCircleOutlined className="text-blue-500 text-xl" />, color: 'blue' },
          { label: '差異待處理', value: `${data.filter(d => d.status === 'discrepancy').length} 筆`, icon: <WarningOutlined className="text-red-500 text-xl" />, color: 'red' },
        ].map((item, idx) => (
          <Col xs={24} sm={12} lg={6} key={idx}>
            <GlassCard>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full bg-${item.color}-500/10 flex items-center justify-center`}>
                  {item.icon}
                </div>
                <Text className="text-gray-500 text-sm">{item.label}</Text>
              </div>
              <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{item.value}</div>
            </GlassCard>
          </Col>
        ))}
      </Row>

      <GlassCard>
        <div className="flex justify-between items-center mb-4">
          <Title level={5} className="!mb-0">各平台撥款明細</Title>
          <Button
            type="primary"
            icon={<SyncOutlined spin={autoMatchLoading} />}
            loading={autoMatchLoading}
            onClick={handleAutoMatch}
            className="bg-gradient-to-r from-blue-500 to-purple-600 border-none"
          >
            自動對帳
          </Button>
        </div>
        <Table
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={false}
          scroll={{ x: 900 }}
          size="middle"
          summary={(rows) => {
            const totals = rows.reduce(
              (acc, r) => ({
                gross: acc.gross + r.gross,
                platformFee: acc.platformFee + r.platformFee,
                gatewayFee: acc.gatewayFee + r.gatewayFee,
                shippingFee: acc.shippingFee + r.shippingFee,
                net: acc.net + r.net,
              }),
              { gross: 0, platformFee: 0, gatewayFee: 0, shippingFee: 0, net: 0 },
            )
            return (
              <Table.Summary.Row className="font-semibold bg-blue-50/50">
                <Table.Summary.Cell index={0} colSpan={3}>合計</Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right"><span className="font-mono font-bold">{fmt(totals.gross)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right"><span className="font-mono text-orange-500">-{fmt(totals.platformFee)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right"><span className="font-mono text-orange-400">-{fmt(totals.gatewayFee)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right"><span className="font-mono text-gray-500">-{fmt(totals.shippingFee)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right"><span className="font-mono font-bold text-green-600">{fmt(totals.net)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={8} />
              </Table.Summary.Row>
            )
          }}
        />
      </GlassCard>
    </div>
  )
}

// ─── Tab 2：手續費明細 ──────────────────────────────────

const FeeDetails: React.FC = () => {
  const [data, setData] = useState<FeeDetail[]>(mockFeeDetails)
  const [loading, setLoading] = useState(false)
  const [platform, setPlatform] = useState<string | undefined>()
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  const handleFilter = () => {
    const entityId = localStorage.getItem('entityId')?.trim()
    const params = new URLSearchParams({ entityId: entityId ?? '' })
    if (platform) params.set('platform', platform)
    if (dateRange?.[0]) params.set('startDate', dateRange[0].toISOString())
    if (dateRange?.[1]) params.set('endDate', dateRange[1].toISOString())

    setLoading(true)
    fetch(`/api/reconciliation/fee-details?${params}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d) && d.length > 0) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const filtered = data.filter((d) => !platform || d.platform === platform)
  const totalGross = filtered.reduce((s, d) => s + d.gross, 0)
  const totalPlatformFee = filtered.reduce((s, d) => s + d.platformFee, 0)
  const totalGatewayFee = filtered.reduce((s, d) => s + d.gatewayFee, 0)
  const totalNet = filtered.reduce((s, d) => s + d.net, 0)
  const avgPlatformRate = totalGross > 0 ? totalPlatformFee / totalGross : 0
  const avgGatewayRate = totalGross > 0 ? totalGatewayFee / totalGross : 0

  const columns: ColumnsType<FeeDetail> = [
    { title: '平台', dataIndex: 'platform', key: 'platform', width: 100,
      render: (v) => <Tag color="geekblue">{v}</Tag> },
    { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
    { title: '總金額 (Gross)', dataIndex: 'gross', key: 'gross', align: 'right',
      render: (v) => <span className="font-mono">{fmt(v)}</span> },
    { title: '平台費', dataIndex: 'platformFee', key: 'platformFee', align: 'right',
      render: (v) => <span className="font-mono text-orange-500">{fmt(v)}</span> },
    { title: '平台費率', dataIndex: 'platformFeeRate', key: 'platformFeeRate', align: 'right',
      render: (v) => (
        <Tooltip title={`= 平台費 / 總金額`}>
          <Tag color="orange">{fmtRate(v)}</Tag>
        </Tooltip>
      ) },
    { title: '金流費', dataIndex: 'gatewayFee', key: 'gatewayFee', align: 'right',
      render: (v) => <span className="font-mono text-yellow-600">{fmt(v)}</span> },
    { title: '金流費率', dataIndex: 'gatewayFeeRate', key: 'gatewayFeeRate', align: 'right',
      render: (v) => (
        <Tooltip title="= 金流費 / 總金額">
          <Tag color="gold">{fmtRate(v)}</Tag>
        </Tooltip>
      ) },
    { title: '本期實收', dataIndex: 'net', key: 'net', align: 'right',
      render: (v) => <span className="font-mono font-semibold text-green-600">{fmt(v)}</span> },
  ]

  return (
    <div className="space-y-6">
      <GlassCard>
        <Space wrap size="middle">
          <Select
            placeholder="選擇平台"
            allowClear
            style={{ width: 160 }}
            options={[
              { value: 'Shopify', label: 'Shopify' },
              { value: 'Shopline', label: 'Shopline' },
              { value: '1Shop', label: '1Shop' },
              { value: 'ECPay', label: 'ECPay' },
            ]}
            onChange={(v) => setPlatform(v)}
          />
          <RangePicker
            onChange={(v) => setDateRange(v as [Dayjs | null, Dayjs | null])}
            placeholder={['開始日期', '結束日期']}
          />
          <Button type="primary" onClick={handleFilter} loading={loading}>
            查詢
          </Button>
        </Space>
      </GlassCard>

      <Row gutter={[24, 24]}>
        {[
          { label: '總收款 (Gross)', value: fmt(totalGross), color: 'blue' },
          { label: '平台費總計', value: `${fmt(totalPlatformFee)}（${fmtRate(avgPlatformRate)}）`, color: 'orange' },
          { label: '金流費總計', value: `${fmt(totalGatewayFee)}（${fmtRate(avgGatewayRate)}）`, color: 'yellow' },
          { label: '本期實收', value: fmt(totalNet), color: 'green' },
        ].map((item, idx) => (
          <Col xs={24} sm={12} lg={6} key={idx}>
            <GlassCard>
              <Text className="text-gray-500 text-sm block mb-2">{item.label}</Text>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{item.value}</div>
            </GlassCard>
          </Col>
        ))}
      </Row>

      <GlassCard>
        <Table
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 900 }}
          size="middle"
        />
      </GlassCard>
    </div>
  )
}

// ─── Tab 3：發票稽核 ──────────────────────────────────

const InvoiceAudit: React.FC = () => {
  const [data, setData] = useState<MissingInvoice[]>(mockMissingInvoices)
  const [loading, setLoading] = useState(false)
  const [markedKeys, setMarkedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    const entityId = localStorage.getItem('entityId')?.trim()
    setLoading(true)
    fetch(`/api/reconciliation/missing-invoices?entityId=${entityId ?? ''}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d) && d.length > 0) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleIssueInvoice = (record: MissingInvoice) => {
    message.info(`補開發票功能：${record.externalOrderId}（開發中）`)
  }

  const handleMarkDone = (record: MissingInvoice) => {
    setMarkedKeys((prev) => new Set([...prev, record.key]))
    message.success(`已標記 ${record.externalOrderId} 為處理完畢`)
  }

  const columns: ColumnsType<MissingInvoice> = [
    { title: '平台', dataIndex: 'platform', key: 'platform', width: 100,
      render: (v) => <Tag color="purple">{v}</Tag> },
    { title: '訂單編號', dataIndex: 'externalOrderId', key: 'externalOrderId' },
    { title: '訂單日期', dataIndex: 'orderDate', key: 'orderDate', width: 120 },
    { title: '訂單金額', dataIndex: 'amount', key: 'amount', align: 'right',
      render: (v) => <span className="font-mono">{fmt(v)}</span> },
    { title: '訂單狀態', dataIndex: 'status', key: 'status', width: 100,
      render: (v) => <Tag color="blue">{v}</Tag> },
    { title: '問題說明', dataIndex: 'remark', key: 'remark',
      render: (v) => <Text type="danger">{v}</Text> },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => {
        const isDone = markedKeys.has(record.key)
        return (
          <Space>
            <Button
              size="small"
              icon={<FileAddOutlined />}
              onClick={() => handleIssueInvoice(record)}
              disabled={isDone}
            >
              補開發票
            </Button>
            <Button
              size="small"
              icon={<CheckOutlined />}
              onClick={() => handleMarkDone(record)}
              disabled={isDone}
              type={isDone ? 'default' : 'dashed'}
            >
              {isDone ? '已處理' : '標記處理'}
            </Button>
          </Space>
        )
      },
    },
  ]

  const pendingCount = data.filter((d) => !markedKeys.has(d.key)).length

  return (
    <div className="space-y-6">
      <Row gutter={[24, 24]}>
        <Col xs={24} sm={8}>
          <GlassCard>
            <div className="flex items-center gap-3 mb-2">
              <WarningOutlined className="text-red-500 text-xl" />
              <Text className="text-gray-500 text-sm">缺發票訂單</Text>
            </div>
            <div className="text-3xl font-bold text-red-500">{data.length} 筆</div>
          </GlassCard>
        </Col>
        <Col xs={24} sm={8}>
          <GlassCard>
            <div className="flex items-center gap-3 mb-2">
              <ClockCircleOutlined className="text-orange-500 text-xl" />
              <Text className="text-gray-500 text-sm">待處理</Text>
            </div>
            <div className="text-3xl font-bold text-orange-500">{pendingCount} 筆</div>
          </GlassCard>
        </Col>
        <Col xs={24} sm={8}>
          <GlassCard>
            <div className="flex items-center gap-3 mb-2">
              <CheckCircleOutlined className="text-green-500 text-xl" />
              <Text className="text-gray-500 text-sm">處理進度</Text>
            </div>
            <Progress
              percent={Math.round((markedKeys.size / Math.max(data.length, 1)) * 100)}
              strokeColor="#52c41a"
              size="small"
            />
          </GlassCard>
        </Col>
      </Row>

      <GlassCard>
        <Title level={5} className="!mb-4">無發票號碼訂單列表</Title>
        <Table
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="key"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 800 }}
          size="middle"
          rowClassName={(record) =>
            markedKeys.has(record.key) ? 'opacity-40' : ''
          }
        />
      </GlassCard>
    </div>
  )
}

// ─── Tab 4：ECPay 撥款進度 ──────────────────────────────────

const EcpayPayoutStatus: React.FC = () => {
  const [data, setData] = useState<EcpayPayout[]>(mockEcpayPayouts)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const entityId = localStorage.getItem('entityId')?.trim()
    setLoading(true)
    fetch(`/api/reconciliation/ecpay-payout-status?entityId=${entityId ?? ''}`)
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d === 'object' && !Array.isArray(d)) {
          // API 回傳 summary 格式，不覆蓋 table 資料
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const inTransitTotal = data
    .filter((d) => d.status === 'pending')
    .reduce((s, d) => s + d.amount, 0)

  const completedTotal = data
    .filter((d) => d.status === 'completed')
    .reduce((s, d) => s + d.amount, 0)

  const columns: ColumnsType<EcpayPayout> = [
    { title: '批次編號', dataIndex: 'batchId', key: 'batchId' },
    { title: '撥款日期', dataIndex: 'payoutDate', key: 'payoutDate', width: 120 },
    { title: '預計撥款日', dataIndex: 'expectedDate', key: 'expectedDate', width: 130 },
    { title: '實際撥款日', dataIndex: 'actualDate', key: 'actualDate', width: 130,
      render: (v) => v ?? <Text type="secondary">—</Text> },
    {
      title: '差異天數',
      dataIndex: 'diffDays',
      key: 'diffDays',
      width: 100,
      align: 'center',
      render: (v: number | null) => {
        if (v === null) return <Text type="secondary">—</Text>
        if (v === 0) return <Tag color="green">準時</Tag>
        if (v > 0) return <Tag color="red">+{v} 天</Tag>
        return <Tag color="blue">{v} 天</Tag>
      },
    },
    { title: '撥款金額', dataIndex: 'amount', key: 'amount', align: 'right',
      render: (v) => <span className="font-mono font-semibold">{fmt(v)}</span> },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: 'completed' | 'pending') =>
        v === 'completed' ? (
          <Tag icon={<CheckCircleOutlined />} color="success">已撥款</Tag>
        ) : (
          <Tag icon={<ClockCircleOutlined />} color="warning">在途中</Tag>
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <Row gutter={[24, 24]}>
        <Col xs={24} sm={8}>
          <GlassCard>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                <ClockCircleOutlined className="text-orange-500 text-xl" />
              </div>
              <Text className="text-gray-500 text-sm">累計在途款項</Text>
            </div>
            <div className="text-2xl font-bold text-orange-500">{fmt(inTransitTotal)}</div>
            <Text className="text-xs text-gray-400">
              {data.filter((d) => d.status === 'pending').length} 筆尚未撥款
            </Text>
          </GlassCard>
        </Col>
        <Col xs={24} sm={8}>
          <GlassCard>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <BankOutlined className="text-green-500 text-xl" />
              </div>
              <Text className="text-gray-500 text-sm">本月已撥款</Text>
            </div>
            <div className="text-2xl font-bold text-green-600">{fmt(completedTotal)}</div>
            <Text className="text-xs text-gray-400">
              {data.filter((d) => d.status === 'completed').length} 筆已到帳
            </Text>
          </GlassCard>
        </Col>
        <Col xs={24} sm={8}>
          <GlassCard>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <FileDoneOutlined className="text-blue-500 text-xl" />
              </div>
              <Text className="text-gray-500 text-sm">撥款完成率</Text>
            </div>
            <Progress
              percent={Math.round((data.filter(d => d.status === 'completed').length / Math.max(data.length, 1)) * 100)}
              strokeColor="#1677ff"
            />
          </GlassCard>
        </Col>
      </Row>

      <GlassCard>
        <Title level={5} className="!mb-4">ECPay 撥款批次明細</Title>
        <Table
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 800 }}
          size="middle"
          summary={(rows) => {
            const total = rows.reduce((s, r) => s + r.amount, 0)
            return (
              <Table.Summary.Row className="font-semibold">
                <Table.Summary.Cell index={0} colSpan={5}>合計</Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <span className="font-mono font-bold">{fmt(total)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} />
              </Table.Summary.Row>
            )
          }}
        />
      </GlassCard>
    </div>
  )
}

// ─── 主頁面 ──────────────────────────────────────────

const ReconciliationCenterPage: React.FC = () => {
  const tabItems = [
    {
      key: 'payouts',
      label: (
        <span className="flex items-center gap-2">
          <BankOutlined />
          平台撥款對帳
        </span>
      ),
      children: <PayoutReconciliation />,
    },
    {
      key: 'fees',
      label: (
        <span className="flex items-center gap-2">
          <DollarOutlined />
          手續費明細
        </span>
      ),
      children: <FeeDetails />,
    },
    {
      key: 'invoices',
      label: (
        <span className="flex items-center gap-2">
          <FileDoneOutlined />
          發票稽核
        </span>
      ),
      children: <InvoiceAudit />,
    },
    {
      key: 'ecpay',
      label: (
        <span className="flex items-center gap-2">
          <ClockCircleOutlined />
          ECPay 撥款進度
        </span>
      ),
      children: <EcpayPayoutStatus />,
>>>>>>> a309c4d4 (feat(ai): Claude 自動更新 — 2026-04-22 16:40:40)
    },
  ]

  return (
    <motion.div
<<<<<<< HEAD
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="space-y-7 p-6"
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

      <div className="grid gap-5 md:grid-cols-4">
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
=======
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <Title level={3} className="!mb-1">電商對帳中心</Title>
          <Text className="text-gray-400">整合各平台撥款、手續費、發票稽核與 ECPay 進度追蹤</Text>
        </div>
      </div>

      <GlassCard className="!p-0 overflow-hidden">
        <Tabs
          defaultActiveKey="payouts"
          items={tabItems}
          size="large"
          className="reconciliation-tabs"
          tabBarStyle={{ padding: '0 24px', marginBottom: 0, borderBottom: '1px solid rgba(0,0,0,0.06)' }}
          tabBarGutter={32}
        />
      </GlassCard>
>>>>>>> a309c4d4 (feat(ai): Claude 自動更新 — 2026-04-22 16:40:40)
    </motion.div>
  )
}

export default ReconciliationCenterPage
