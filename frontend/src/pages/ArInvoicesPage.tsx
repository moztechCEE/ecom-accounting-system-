import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  CheckCircleOutlined,
  DollarCircleOutlined,
  FileTextOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs, { Dayjs } from 'dayjs'
import {
  arService,
  ReceivableMonitorItem,
  ReceivableMonitorSummary,
} from '../services/ar.service'
import {
  InvoiceProviderStatusReadiness,
  invoicingService,
} from '../services/invoicing.service'

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
  invoice_issued_unposted: '已開票未落帳',
  invoice_issued_unpaid: '已開票未收款',
  overdue_receivable: '應收已逾期',
}

const feeStatusColorMap: Record<string, string> = {
  actual: 'green',
  estimated: 'gold',
  unavailable: 'red',
}

const feeStatusLabelMap: Record<string, string> = {
  actual: '實際值',
  estimated: '暫估值',
  unavailable: '待回填',
}

const providerMissingLabelMap: Record<string, string> = {
  invoiceNumber: '缺發票號碼',
  invoiceDate: '缺發票日期',
  merchantKeyOrMerchantId: '缺綠界帳號',
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
  outstandingOrderCount: 0,
  overdueReceivableCount: 0,
  overdueReceivableAmount: 0,
  issuedUnpostedCount: 0,
  issuedUnpaidCount: 0,
}

const createDefaultMonitorRange = (): [Dayjs, Dayjs] => [
  dayjs().subtract(90, 'day').startOf('day'),
  dayjs().endOf('day'),
]

const ArInvoicesPage: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentTarget, setPaymentTarget] = useState<ReceivableMonitorItem | null>(null)
  const [searchText, setSearchText] = useState('')
  const [items, setItems] = useState<ReceivableMonitorItem[]>([])
  const [summary, setSummary] = useState<ReceivableMonitorSummary>(EmptySummary)
  const [monitorRange, setMonitorRange] = useState<[Dayjs, Dayjs]>(createDefaultMonitorRange)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [providerReadiness, setProviderReadiness] =
    useState<InvoiceProviderStatusReadiness | null>(null)
  const [providerReadinessLoading, setProviderReadinessLoading] = useState(false)
  const [providerReadinessError, setProviderReadinessError] = useState<string | null>(null)
  const [queryingInvoiceId, setQueryingInvoiceId] = useState<string | null>(null)
  const [form] = Form.useForm()
  const [paymentForm] = Form.useForm()

  const fetchProviderStatusReadiness = async (range: [Dayjs, Dayjs] = monitorRange) => {
    setProviderReadinessLoading(true)
    try {
      const entityId = localStorage.getItem('entityId')?.trim() || 'tw-entity-001'
      const result = await invoicingService.getProviderStatusReadiness({
        entityId,
        limit: 100,
        status: 'issued',
        startDate: range[0].toISOString(),
        endDate: range[1].toISOString(),
      })
      setProviderReadiness(result)
      setProviderReadinessError(null)
    } catch (error: any) {
      setProviderReadiness(null)
      setProviderReadinessError(
        error?.response?.data?.message || '綠界查詢欄位盤點載入失敗',
      )
    } finally {
      setProviderReadinessLoading(false)
    }
  }

  const fetchMonitor = async (range: [Dayjs, Dayjs] = monitorRange) => {
    setLoading(true)
    try {
      const [result] = await Promise.all([
        arService.getReceivableMonitor({
          startDate: range[0].toISOString(),
          endDate: range[1].toISOString(),
        }),
        fetchProviderStatusReadiness(range),
      ])
      setItems(result.items || [])
      setSummary(result.summary || EmptySummary)
      setLoadError(null)
    } catch (error: any) {
      const errorMessage =
        error?.code === 'ECONNABORTED'
          ? '載入應收帳款追蹤逾時，請縮短日期範圍後重試。'
          : error?.response?.data?.message || '載入應收帳款追蹤失敗，請稍後重試。'
      message.error(errorMessage)
      setLoadError(errorMessage)
      setItems([])
      setSummary(EmptySummary)
    } finally {
      setLoading(false)
    }
  }

  const handleMonitorRangeChange = (dates: null | [Dayjs | null, Dayjs | null]) => {
    if (!dates?.[0] || !dates[1]) return

    const nextRange: [Dayjs, Dayjs] = [
      dates[0].startOf('day'),
      dates[1].endOf('day'),
    ]
    setMonitorRange(nextRange)
    fetchMonitor(nextRange)
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

  const handleCreateManualAr = async () => {
    try {
      const values = await form.validateFields()
      setCreating(true)
      const entityId = localStorage.getItem('entityId')?.trim() || undefined
      await arService.createInvoice({
        entityId: entityId || 'tw-entity-001',
        invoiceNo: values.invoiceNo || undefined,
        amountOriginal: Number(values.amountOriginal || 0),
        amountCurrency: 'TWD',
        paidAmountOriginal: 0,
        issueDate: values.issueDate.startOf('day').toISOString(),
        dueDate: values.dueDate.endOf('day').toISOString(),
        status: 'unpaid',
        sourceModule: 'manual_b2b_ar',
        notes: [
          `customerName=${values.customerName}`,
          values.customerEmail ? `customerEmail=${values.customerEmail}` : null,
          'sourceLabel=B2B 月結',
          'sourceBrand=MOZTECH',
        ]
          .filter(Boolean)
          .join('; '),
      })
      message.success('已建立 B2B 應收')
      setCreateModalOpen(false)
      form.resetFields()
      await fetchMonitor()
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.response?.data?.message || '建立 B2B 應收失敗')
    } finally {
      setCreating(false)
    }
  }

  const openPaymentModal = (item: ReceivableMonitorItem) => {
    setPaymentTarget(item)
    paymentForm.setFieldsValue({
      amount: item.outstandingAmount,
      paymentDate: dayjs(),
      paymentMethod: 'bank_transfer',
    })
    setPaymentModalOpen(true)
  }

  const handleRecordPayment = async () => {
    if (!paymentTarget?.arInvoiceId) return

    try {
      const values = await paymentForm.validateFields()
      setReceiving(true)
      await arService.recordPayment(paymentTarget.arInvoiceId, {
        amount: Number(values.amount || 0),
        paymentDate: values.paymentDate?.toISOString(),
        paymentMethod: values.paymentMethod || 'bank_transfer',
      })
      message.success('已記錄收款並嘗試建立沖銷分錄')
      setPaymentModalOpen(false)
      setPaymentTarget(null)
      paymentForm.resetFields()
      await fetchMonitor()
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.response?.data?.message || '記錄收款失敗')
    } finally {
      setReceiving(false)
    }
  }

  const handleQueryProviderStatus = async (item: ReceivableMonitorItem) => {
    if (!item.invoiceId) return

    setQueryingInvoiceId(item.invoiceId)
    try {
      const result = await invoicingService.queryProviderStatus(item.invoiceId)
      Modal.info({
        title: '綠界發票狀態',
        width: 520,
        content: (
          <div className="mt-3 space-y-2 text-sm">
            <div>發票號碼：{result.invoiceNumber}</div>
            <div>內部狀態：{result.localStatus}</div>
            <div>綠界狀態：{result.providerStatus}</div>
            <div>商店代號：{result.merchantId}</div>
            <div>發票日期：{result.invoiceDate}</div>
            {result.providerMessage ? <div>綠界訊息：{result.providerMessage}</div> : null}
          </div>
        ),
      })
    } catch (error: any) {
      message.error(error?.response?.data?.message || '查詢綠界發票狀態失敗')
    } finally {
      setQueryingInvoiceId(null)
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

  const providerReadinessDescription = useMemo(() => {
    if (!providerReadiness) return null
    const missingCounts = providerReadiness.summary.missingCounts || {}
    const parts = Object.entries(missingCounts)
      .filter(([, count]) => Number(count || 0) > 0)
      .map(([field, count]) => `${providerMissingLabelMap[field] || field} ${count} 筆`)

    if (!parts.length) {
      return `本區間已抽查 ${providerReadiness.summary.scannedCount} 張已開立發票，皆具備綠界只讀查詢欄位。`
    }

    return `本區間抽查 ${providerReadiness.summary.scannedCount} 張已開立發票，其中 ${providerReadiness.summary.notReadyCount} 張仍需補欄位：${parts.join('、')}。`
  }, [providerReadiness])

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
      width: 280,
      render: (_: unknown, record: ReceivableMonitorItem) => (
        <div>
          <div className="font-medium text-rose-600">{currency(record.feeTotal)}</div>
          <div className="text-xs text-slate-400">
            金流 {currency(record.gatewayFeeAmount)} · 平台 {currency(record.platformFeeAmount)}
          </div>
          <div className="mt-2">
            <Tag color={feeStatusColorMap[record.feeStatus] || 'default'}>
              {feeStatusLabelMap[record.feeStatus] || record.feeStatus}
            </Tag>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {record.feeDiagnostic}
          </div>
          {record.feeSource ? (
            <div className="text-[11px] text-slate-300 mt-1">
              source: {record.feeSource}
            </div>
          ) : null}
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
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      width: 140,
      render: (_: unknown, record: ReceivableMonitorItem) => {
        const canReceive = Boolean(record.arInvoiceId) && Number(record.outstandingAmount || 0) > 0

        return (
          <Space direction="vertical" size={6}>
            <Button
              size="small"
              icon={<SyncOutlined />}
              disabled={!record.invoiceId}
              loading={queryingInvoiceId === record.invoiceId}
              onClick={() => handleQueryProviderStatus(record)}
            >
              查綠界
            </Button>
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              disabled={!canReceive}
              onClick={() => openPaymentModal(record)}
            >
              記錄收款
            </Button>
          </Space>
        )
      },
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="page-section-stack"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Title level={2} className="!mb-1 !font-light">
              應收帳款
            </Title>
            <Popover
              title="這頁怎麼用"
              content={
                <div className="max-w-xs text-sm leading-6 text-slate-600">
                  <div>銷售訂單：按「同步銷售訂單」轉成應收。</div>
                  <div>B2B 月結：按「新增 B2B 應收」建立追帳項目。</div>
                  <div>收款後：按「記錄收款」沖銷應收並產生收款分錄。</div>
                </div>
              }
              trigger="click"
            >
              <Button
                type="text"
                shape="circle"
                icon={<QuestionCircleOutlined />}
                className="text-slate-400"
              />
            </Popover>
          </div>
          <Text className="text-gray-500">建立應收、追蹤收款、確認入帳。</Text>
        </div>
        <Space wrap>
          <DatePicker.RangePicker
            allowClear={false}
            value={monitorRange}
            onChange={handleMonitorRangeChange}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchMonitor()}>
            重新整理
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            新增 B2B 應收
          </Button>
          <Button
            type="primary"
            icon={<SyncOutlined spin={syncing} />}
            loading={syncing}
            onClick={handleSync}
          >
            同步銷售訂單
          </Button>
        </Space>
      </div>

      {loadError ? (
        <Alert
          showIcon
          type="warning"
          message="應收帳款追蹤沒有成功載入"
          description={`${loadError} 目前查詢區間：${monitorRange[0].format('YYYY-MM-DD')} 至 ${monitorRange[1].format('YYYY-MM-DD')}。`}
          action={
            <Button size="small" onClick={() => fetchMonitor()}>
              重試
            </Button>
          }
        />
      ) : null}

      {providerReadinessError ? (
        <Alert
          showIcon
          type="warning"
          message="綠界發票查詢欄位盤點沒有成功載入"
          description={providerReadinessError}
          action={
            <Button
              size="small"
              loading={providerReadinessLoading}
              onClick={() => fetchProviderStatusReadiness()}
            >
              重試
            </Button>
          }
        />
      ) : providerReadiness ? (
        <Alert
          showIcon
          type={providerReadiness.summary.notReadyCount > 0 ? 'warning' : 'success'}
          message={
            providerReadiness.summary.notReadyCount > 0
              ? '有發票尚未具備綠界狀態查詢欄位'
              : '綠界發票狀態查詢欄位已就緒'
          }
          description={providerReadinessDescription}
          action={
            <Button
              size="small"
              loading={providerReadinessLoading}
              onClick={() => fetchProviderStatusReadiness()}
            >
              重新盤點
            </Button>
          }
        />
      ) : null}

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
          <Text className="text-xs text-slate-400">{filteredItems.length} 筆</Text>
        </div>

        <Table
          rowKey="orderId"
          loading={loading}
          columns={columns}
          dataSource={filteredItems}
          scroll={{ x: 2100 }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </Card>

      <Modal
        title="新增 B2B 應收"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={handleCreateManualAr}
        confirmLoading={creating}
        okText="建立應收"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            issueDate: dayjs(),
            dueDate: dayjs().add(30, 'day'),
          }}
        >
          <Form.Item
            name="customerName"
            label="客戶名稱"
            rules={[{ required: true, message: '請輸入客戶名稱' }]}
          >
            <Input placeholder="例如：某某經銷商 / 公司客戶" />
          </Form.Item>
          <Form.Item name="customerEmail" label="對帳 Email">
            <Input placeholder="可留空" />
          </Form.Item>
          <Form.Item name="invoiceNo" label="發票 / 對帳單號">
            <Input placeholder="尚未開票可留空" />
          </Form.Item>
          <Form.Item
            name="amountOriginal"
            label="應收金額"
            rules={[{ required: true, message: '請輸入應收金額' }]}
          >
            <InputNumber min={0} precision={0} className="w-full" prefix="NT$" />
          </Form.Item>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item
              name="issueDate"
              label="建立日期"
              rules={[{ required: true, message: '請選擇建立日期' }]}
            >
              <DatePicker className="w-full" />
            </Form.Item>
            <Form.Item
              name="dueDate"
              label="收款到期日"
              rules={[{ required: true, message: '請選擇收款到期日' }]}
            >
              <DatePicker className="w-full" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="記錄收款"
        open={paymentModalOpen}
        onCancel={() => {
          setPaymentModalOpen(false)
          setPaymentTarget(null)
        }}
        onOk={handleRecordPayment}
        confirmLoading={receiving}
        okText="確認收款"
        cancelText="取消"
      >
        <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div className="font-medium text-slate-900">{paymentTarget?.orderNumber}</div>
          <div className="mt-1">
            未收 {currency(paymentTarget?.outstandingAmount || 0)} · 客戶 {paymentTarget?.customerName || '-'}
          </div>
        </div>
        <Form
          form={paymentForm}
          layout="vertical"
        >
          <Form.Item
            name="amount"
            label="本次收款金額"
            rules={[{ required: true, message: '請輸入收款金額' }]}
          >
            <InputNumber
              min={1}
              max={paymentTarget?.outstandingAmount || undefined}
              precision={0}
              className="w-full"
              prefix="NT$"
            />
          </Form.Item>
          <Form.Item
            name="paymentDate"
            label="收款日期"
            rules={[{ required: true, message: '請選擇收款日期' }]}
          >
            <DatePicker className="w-full" />
          </Form.Item>
          <Form.Item name="paymentMethod" label="收款方式">
            <Input placeholder="bank_transfer / cash / check" />
          </Form.Item>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default ArInvoicesPage
