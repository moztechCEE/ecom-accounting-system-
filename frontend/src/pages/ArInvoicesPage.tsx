import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Input,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  AuditOutlined,
  DollarCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import {
  arService,
  ReceivableMonitorItem,
  ReceivableMonitorSummary,
} from '../services/ar.service'

const { Title, Text } = Typography

const currency = (value: number) => `NT$ ${Number(value || 0).toLocaleString()}`

const statusColorMap: Record<string, string> = {
  paid: 'green',
  partial: 'gold',
  unpaid: 'blue',
  overdue: 'red',
  written_off: 'default',
  issued: 'green',
  pending: 'orange',
  draft: 'default',
}

const warningLabelMap: Record<string, string> = {
  missing_fee: '手續費待補',
  missing_journal: '尚未入帳',
  missing_ar: '未建立應收',
  invoice_pending: '待補發票',
  missing_invoice_record: '發票主檔缺漏',
}

const EmptySummary: ReceivableMonitorSummary = {
  grossAmount: 0,
  paidAmount: 0,
  outstandingAmount: 0,
  gatewayFeeAmount: 0,
  platformFeeAmount: 0,
  netAmount: 0,
  invoiceIssuedCount: 0,
  journalPostedCount: 0,
  missingFeeCount: 0,
  missingJournalCount: 0,
  missingInvoiceCount: 0,
}

const ArInvoicesPage: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [items, setItems] = useState<ReceivableMonitorItem[]>([])
  const [summary, setSummary] = useState<ReceivableMonitorSummary>(EmptySummary)

  const fetchMonitor = async () => {
    setLoading(true)
    try {
      const result = await arService.getReceivableMonitor()
      setItems(result.items || [])
      setSummary(result.summary || EmptySummary)
    } catch (error) {
      message.error('載入應收帳款追蹤失敗')
      setItems([])
      setSummary(EmptySummary)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await arService.syncSalesOrders()
      message.success(
        `已同步 ${result.orderCount || 0} 筆銷售單，補齊 ${result.arUpserted || 0} 筆應收與 ${result.journalsCreated || 0} 筆分錄`,
      )
      await fetchMonitor()
    } catch (error) {
      message.error('同步銷售入帳失敗')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    fetchMonitor()
  }, [])

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return items

    return items.filter((item) =>
      [
        item.orderNumber,
        item.customerName,
        item.customerEmail,
        item.sourceLabel,
        item.sourceBrand,
        item.channelName,
        item.invoiceNumber,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    )
  }, [items, searchText])

  const columns = [
    {
      title: '訂單 / 來源',
      key: 'order',
      width: 260,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <div className="font-semibold text-slate-900">{record.orderNumber}</div>
          <div className="text-xs text-slate-400">
            {record.sourceLabel} · {record.sourceBrand}
          </div>
        </div>
      ),
    },
    {
      title: '客戶',
      key: 'customer',
      width: 220,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <div className="font-medium text-slate-900">{record.customerName}</div>
          <div className="text-xs text-slate-400">
            {record.customerEmail || '未填 Email'}
          </div>
        </div>
      ),
    },
    {
      title: '收入 / 稅額',
      key: 'gross',
      width: 180,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <div className="font-medium text-slate-900">{currency(record.grossAmount)}</div>
          <div className="text-xs text-slate-400">
            收入 {currency(record.revenueAmount)} · 稅 {currency(record.taxAmount)}
          </div>
        </div>
      ),
    },
    {
      title: '應收 / 已收',
      key: 'receivable',
      width: 180,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <div className="font-medium text-slate-900">{currency(record.outstandingAmount)}</div>
          <div className="text-xs text-slate-400">
            已收 {currency(record.paidAmount)}
          </div>
        </div>
      ),
    },
    {
      title: '被抽成費用',
      key: 'fees',
      width: 200,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <div className="font-medium text-rose-600">{currency(record.feeTotal)}</div>
          <div className="text-xs text-slate-400">
            金流 {currency(record.gatewayFeeAmount)} · 平台 {currency(record.platformFeeAmount)}
          </div>
        </div>
      ),
    },
    {
      title: '淨額 / 對帳',
      key: 'net',
      width: 180,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <div className="font-medium text-emerald-600">{currency(record.netAmount)}</div>
          <div className="text-xs text-slate-400">
            {record.reconciledFlag ? '已完成對帳' : '待對帳'} · {record.payoutCount} 筆收款
          </div>
        </div>
      ),
    },
    {
      title: '發票',
      key: 'invoice',
      width: 180,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <div className="font-medium text-slate-900">
            {record.invoiceNumber || '尚未開立'}
          </div>
          <Tag color={statusColorMap[record.invoiceStatus] || 'default'}>
            {record.invoiceStatus}
          </Tag>
        </div>
      ),
    },
    {
      title: '會計入帳',
      key: 'accounting',
      width: 180,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <Tag color={record.accountingPosted ? 'green' : 'orange'}>
            {record.accountingPosted ? '已建立分錄' : '待建立分錄'}
          </Tag>
          <div className="text-xs text-slate-400 mt-1">
            {record.journalEntryId
              ? `分錄 ${record.journalApprovedAt ? '已審核' : '待審核'}`
              : '尚未過帳'}
          </div>
        </div>
      ),
    },
    {
      title: '異常提醒',
      key: 'warnings',
      width: 220,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <Space size={[4, 4]} wrap>
          {record.warningCodes.length ? (
            record.warningCodes.map((code) => (
              <Tag key={code} color="red">
                {warningLabelMap[code] || code}
              </Tag>
            ))
          ) : (
            <Tag color="green">正常</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '日期',
      key: 'dates',
      width: 160,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div className="text-sm">
          <div>{dayjs(record.orderDate).format('YYYY-MM-DD')}</div>
          <div className="text-xs text-slate-400">
            到期 {dayjs(record.dueDate).format('YYYY-MM-DD')}
          </div>
        </div>
      ),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Title level={2} className="!mb-1 !font-light">
            應收帳款與入帳追蹤
          </Title>
          <Text className="text-gray-500">
            直接檢查每筆訂單的收入、應收、手續費、淨額、發票與會計分錄是否都已落下來。
          </Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={fetchMonitor}>
            重新整理
          </Button>
          <Button
            type="primary"
            icon={<SyncOutlined spin={syncing} />}
            loading={syncing}
            onClick={handleSync}
          >
            同步銷售入帳
          </Button>
        </Space>
      </div>

      <Alert
        showIcon
        type="info"
        icon={<AuditOutlined />}
        message="這個頁面現在會把銷售訂單、收款、綠界/平台手續費、發票號碼與會計分錄狀態放在同一張表追蹤。"
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card bordered={false} className="glass-card">
          <Statistic
            title="總收入"
            value={summary.grossAmount}
            precision={0}
            prefix={<DollarCircleOutlined />}
            formatter={(value) => currency(Number(value || 0))}
          />
        </Card>
        <Card bordered={false} className="glass-card">
          <Statistic
            title="未收應收"
            value={summary.outstandingAmount}
            precision={0}
            prefix={<WarningOutlined />}
            valueStyle={{ color: '#cf1322' }}
            formatter={(value) => currency(Number(value || 0))}
          />
        </Card>
        <Card bordered={false} className="glass-card">
          <Statistic
            title="金流手續費"
            value={summary.gatewayFeeAmount}
            precision={0}
            prefix={<DollarCircleOutlined />}
            valueStyle={{ color: '#fa8c16' }}
            formatter={(value) => currency(Number(value || 0))}
          />
        </Card>
        <Card bordered={false} className="glass-card">
          <Statistic
            title="平台手續費"
            value={summary.platformFeeAmount}
            precision={0}
            prefix={<DollarCircleOutlined />}
            valueStyle={{ color: '#722ed1' }}
            formatter={(value) => currency(Number(value || 0))}
          />
        </Card>
        <Card bordered={false} className="glass-card">
          <Statistic
            title="已開立發票 / 已過帳"
            value={`${summary.invoiceIssuedCount} / ${summary.journalPostedCount}`}
            prefix={<FileTextOutlined />}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card bordered={false} className="glass-card">
          <div className="text-sm text-slate-500">手續費欄待補</div>
          <div className="mt-2 text-3xl font-semibold text-rose-600">
            {summary.missingFeeCount}
          </div>
        </Card>
        <Card bordered={false} className="glass-card">
          <div className="text-sm text-slate-500">尚未建立分錄</div>
          <div className="mt-2 text-3xl font-semibold text-amber-600">
            {summary.missingJournalCount}
          </div>
        </Card>
        <Card bordered={false} className="glass-card">
          <div className="text-sm text-slate-500">待補發票</div>
          <div className="mt-2 text-3xl font-semibold text-blue-600">
            {summary.missingInvoiceCount}
          </div>
        </Card>
      </div>

      <Card bordered={false} className="glass-card">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Input
            allowClear
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            prefix={<SearchOutlined />}
            placeholder="搜尋訂單編號、顧客、來源、品牌或發票號碼"
            className="max-w-xl"
          />
          <Text className="text-xs text-slate-400">
            共 {filteredItems.length} 筆，這裡是你要看的真正入帳追蹤，不是單純資料匯入列表。
          </Text>
        </div>

        <Table
          rowKey="orderId"
          loading={loading}
          columns={columns}
          dataSource={filteredItems}
          scroll={{ x: 1800 }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </Card>
    </motion.div>
  )
}

export default ArInvoicesPage
