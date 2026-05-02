import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Drawer,
  Modal,
  Select,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  Upload,
  Statistic,
  Row,
  Col,
  Space,
  Alert
} from 'antd'
import { 
  BankOutlined, 
  HistoryOutlined, 
  PlusOutlined, 
  UploadOutlined,
  DollarOutlined,
  DownloadOutlined
} from '@ant-design/icons'
import { GlassDrawer, GlassDrawerSection } from '../components/ui/GlassDrawer'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import { bankingService } from '../services/banking.service'
import { BankAccount, BankTransaction, ManagedUser } from '../types'
import { usersService } from '../services/users.service'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text } = Typography
const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

const bankStatementTemplateRows = [
  ['txn_date', 'value_date', 'description', 'credit', 'debit', 'amount', 'currency', 'reference_no', 'virtual_account_no'],
  ['2026-04-27', '2026-04-27', '綠界撥款 3150241', '125000', '', '', 'TWD', 'ECPAY-3150241-20260427', ''],
  ['2026-04-27', '2026-04-27', '廣告信用卡扣款 Google Ads', '', '8800', '', 'TWD', 'GOOGLE-ADS-20260427', ''],
]

interface BankStatementPreview {
  totalRows: number
  importableCount: number
  skippedCount: number
  sampleRows: Array<{
    rowNumber: number
    txnDate: string
    amountOriginal: number
    amountCurrency: string
    descriptionRaw: string
    referenceNo?: string | null
  }>
  skippedRows: Array<{
    rowNumber: number
    reason: string
  }>
}

const csvEscape = (value: string | number | null | undefined) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const downloadCsv = (filename: string, rows: Array<Array<string | number>>) => {
  const content = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const AccountsTab = () => {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [accessModalOpen, setAccessModalOpen] = useState(false)
  const [accessTarget, setAccessTarget] = useState<BankAccount | null>(null)
  const [form] = Form.useForm()
  const [accessForm] = Form.useForm()
  const canManageBankAccess = (user?.roles ?? []).some((role) => role === 'SUPER_ADMIN' || role === 'ADMIN')

  const fetchAccounts = async () => {
    setLoading(true)
    try {
      const result = await bankingService.getAccounts()
      setAccounts(Array.isArray(result) ? result : [])
    } catch (error) {
      message.error('載入帳戶失敗')
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    if (!canManageBankAccess) return
    try {
      const result = await usersService.list(1, 100)
      setUsers(result.items || [])
    } catch {
      setUsers([])
    }
  }

  useEffect(() => {
    fetchAccounts()
    fetchUsers()
  }, [canManageBankAccess])

  const stats = useMemo(() => {
    const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0)
    const totalAccounts = accounts.length
    return { totalBalance, totalAccounts }
  }, [accounts])

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      await bankingService.createAccount({
        ...values,
        entityId: values.entityId || localStorage.getItem('entityId') || DEFAULT_ENTITY_ID,
      })
      message.success('帳戶建立成功')
      setDrawerOpen(false)
      form.resetFields()
      fetchAccounts()
    } catch (error) {
      // Error
    }
  }

  const openAccessModal = (account: BankAccount) => {
    setAccessTarget(account)
    accessForm.setFieldsValue({
      allowedUserIds: account.allowedUserIds || [],
    })
    setAccessModalOpen(true)
  }

  const handleUpdateAccess = async () => {
    if (!accessTarget) return
    try {
      const values = await accessForm.validateFields()
      await bankingService.updateAccountAccess(accessTarget.id, values.allowedUserIds || [])
      message.success('可檢視人員已更新')
      setAccessModalOpen(false)
      setAccessTarget(null)
      fetchAccounts()
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.response?.data?.message || '更新銀行權限失敗')
    }
  }

  const columns = [
    {
      title: '銀行帳戶',
      key: 'bank',
      render: (_: unknown, record: BankAccount) => (
        <div>
          <div className="font-medium text-slate-900">{record.bankName}</div>
          <div className="text-xs text-slate-500">
            {record.accountName || '未填戶名'}{record.branch ? ` · ${record.branch}` : ''}
          </div>
        </div>
      ),
    },
    { title: '帳號', dataIndex: 'accountNo', key: 'accountNo' },
    { title: '幣別', dataIndex: 'currency', key: 'currency' },
    {
      title: '餘額',
      dataIndex: 'balance',
      key: 'balance',
      render: (val?: number) => <Text strong>${(val ?? 0).toLocaleString()}</Text>,
    },
    {
      title: '可檢視',
      key: 'visibility',
      render: (_: unknown, record: BankAccount) => (
        <Tag color={record.accessScope === 'all' ? 'blue' : 'gold'}>
          {record.accessScope === 'all'
            ? '超級管理員'
            : `${record.allowedUserIds?.length || 0} 人`}
        </Tag>
      ),
    },
    {
      title: '狀態',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'red'}>{isActive ? '啟用' : '停用'}</Tag>
      ),
    },
    ...(canManageBankAccess
      ? [
          {
            title: '操作',
            key: 'actions',
            render: (_: unknown, record: BankAccount) => (
              <Button size="small" onClick={() => openAccessModal(record)}>
                權限
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="page-section-stack">
      <Row gutter={16}>
        <Col span={12}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="總資產餘額 (預估)"
              value={stats.totalBalance}
              precision={0}
              prefix={<DollarOutlined />}
              suffix="TWD"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="銀行帳戶數"
              value={stats.totalAccounts}
              prefix={<BankOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
      </Row>

      {canManageBankAccess && (
        <div className="flex justify-end">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
            新增帳戶
          </Button>
        </div>
      )}

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={accounts}
      />

      <GlassDrawer
        title="新增銀行帳戶"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={420}
      >
        <Form form={form} layout="vertical" className="h-full flex flex-col">
          <div className="flex-1 space-y-4">
            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">帳戶資訊</div>
              <Form.Item name="bankName" label="銀行名稱" rules={[{ required: true, message: '請輸入銀行名稱' }]}>
                <Select
                  showSearch
                  placeholder="選擇或輸入銀行名稱"
                  options={[
                    { label: '玉山銀行', value: '玉山銀行' },
                    { label: '中國信託', value: '中國信託' },
                    { label: '台灣銀行', value: '台灣銀行' },
                    { label: '華南銀行', value: '華南銀行' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="accountName" label="戶名" rules={[{ required: true, message: '請輸入戶名' }]}>
                <Input placeholder="例如：萬博創意科技有限公司" />
              </Form.Item>
              <Form.Item name="accountNo" label="帳號" rules={[{ required: true, message: '請輸入帳號' }]}>
                <Input placeholder="例如：123-456-789" />
              </Form.Item>
              <Form.Item name="branch" label="分行">
                <Input placeholder="例如：台北分行" />
              </Form.Item>
              <Form.Item name="accountAlias" label="帳戶暱稱">
                <Input placeholder="例如：台銀主要收款帳戶" />
              </Form.Item>
            </GlassDrawerSection>
            
            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">設定</div>
              <Form.Item name="currency" label="幣別" initialValue="TWD">
                <Select>
                  <Select.Option value="TWD">TWD</Select.Option>
                  <Select.Option value="USD">USD</Select.Option>
                  <Select.Option value="EUR">EUR</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="glAccountId" label="對應會計科目">
                <Input placeholder="例如: 1101" />
              </Form.Item>
              <Form.Item name="openingBalance" label="期初資金 / 目前餘額">
                <InputNumber
                  min={0}
                  precision={0}
                  controls={false}
                  className="banking-balance-input w-full"
                  prefix="NT$"
                  placeholder="例如：300000"
                />
              </Form.Item>
              <Form.Item name="allowedUserIds" label="允許檢視人員">
                <Select
                  mode="multiple"
                  placeholder="未選擇時，只有超級管理員與建立者可見"
                  options={users.map((item) => ({
                    label: `${item.name} (${item.email})`,
                    value: item.id,
                  }))}
                />
              </Form.Item>
            </GlassDrawerSection>
          </div>

          <GlassDrawerSection>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDrawerOpen(false)} className="rounded-full">取消</Button>
              <Button type="primary" onClick={handleCreate} className="rounded-full bg-blue-600 hover:bg-blue-500 border-none shadow-lg shadow-blue-200">
                建立
              </Button>
            </div>
          </GlassDrawerSection>
        </Form>
      </GlassDrawer>

      <Modal
        title={`設定銀行權限${accessTarget ? `：${accessTarget.bankName}` : ''}`}
        open={accessModalOpen}
        onCancel={() => setAccessModalOpen(false)}
        onOk={handleUpdateAccess}
        okText="儲存"
        cancelText="取消"
      >
        <Form form={accessForm} layout="vertical">
          <Form.Item name="allowedUserIds" label="允許檢視人員">
            <Select
              mode="multiple"
              placeholder="選擇可以看到這個銀行帳戶的人"
              options={users.map((item) => ({
                label: `${item.name} (${item.email})`,
                value: item.id,
              }))}
            />
          </Form.Item>
          <Text type="secondary">
            超級管理員永遠可以看到全部銀行資產；一般管理員只看得到被授權的銀行。
          </Text>
        </Form>
      </Modal>
    </div>
  )
}

const TransactionsTab = () => {
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState<string>()
  const [importing, setImporting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<BankStatementPreview | null>(null)

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      const result = await bankingService.getTransactions()
      setTransactions(result.items)
    } catch (error) {
      message.error('載入交易失敗')
    } finally {
      setLoading(false)
    }
  }

  const fetchAccounts = async () => {
    try {
      const result = await bankingService.getAccounts()
      setAccounts(Array.isArray(result) ? result : [])
      if (!selectedAccountId && Array.isArray(result) && result.length === 1) {
        setSelectedAccountId(result[0].id)
      }
    } catch {
      setAccounts([])
    }
  }

  useEffect(() => {
    fetchTransactions()
    fetchAccounts()
  }, [])

  const handleDownloadTemplate = () => {
    downloadCsv('bank-statement-import-template.csv', bankStatementTemplateRows)
  }

  const handleOpenImport = () => {
    if (!accounts.length) {
      message.warning('請先建立銀行帳戶，再匯入對帳單')
      return
    }
    setPendingImportFile(null)
    setImportPreview(null)
    setImportModalOpen(true)
  }

  const handlePreviewStatement = async (file: File) => {
    if (!selectedAccountId) {
      message.warning('請先選擇要匯入的銀行帳戶')
      return Upload.LIST_IGNORE
    }

    setPreviewing(true)
    try {
      const result = await bankingService.previewTransactionsImport(selectedAccountId, file)
      setPendingImportFile(file)
      setImportPreview(result)
      message.success(`已解析 ${result.importableCount ?? 0} 筆可匯入銀行交易`)
    } catch (error: any) {
      setPendingImportFile(null)
      setImportPreview(null)
      message.error(error?.response?.data?.message || '解析銀行對帳單失敗')
    } finally {
      setPreviewing(false)
    }

    return Upload.LIST_IGNORE
  }

  const handleConfirmImport = async () => {
    if (!selectedAccountId || !pendingImportFile || !importPreview) {
      message.warning('請先選擇並預覽銀行對帳單')
      return
    }

    setImporting(true)
    try {
      const result = await bankingService.importTransactions(selectedAccountId, pendingImportFile)
      message.success(`已匯入 ${result.importedCount ?? 0} 筆銀行交易`)
      setImportModalOpen(false)
      setPendingImportFile(null)
      setImportPreview(null)
      await fetchTransactions()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '匯入銀行對帳單失敗')
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    {
      title: '日期',
      dataIndex: 'txnDate',
      key: 'txnDate',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
    },
    { title: '摘要', dataIndex: 'descriptionRaw', key: 'descriptionRaw' },
    {
      title: '金額',
      dataIndex: 'amountOriginal',
      key: 'amountOriginal',
      render: (val: number, record: BankTransaction) => (
        <Text type={val >= 0 ? 'success' : 'danger'}>
          {val >= 0 ? '+' : ''}{Math.abs(val).toLocaleString()} {record.amountCurrency}
        </Text>
      ),
    },
    {
      title: '狀態',
      dataIndex: 'reconcileStatus',
      key: 'reconcileStatus',
      render: (status: string) => {
        const isMatched = status?.toLowerCase() === 'matched'
        return <Tag color={isMatched ? 'green' : 'orange'}>{isMatched ? '已調節' : '未調節'}</Tag>
      },
    },
  ]

  return (
    <div className="page-section-stack">
      <div className="flex justify-between items-center">
        <Title level={4} className="!mb-0 !font-light">交易明細</Title>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
            下載匯入範本
          </Button>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={handleOpenImport}
            disabled={!accounts.length}
            title={!accounts.length ? '請先建立銀行帳戶' : undefined}
          >
            匯入對帳單
          </Button>
        </Space>
      </div>

      {!accounts.length && (
        <Alert
          type="warning"
          showIcon
          message="尚未建立銀行帳戶"
          description="請先到「銀行帳戶」分頁建立主要收款帳戶，再回到交易明細匯入銀行對帳單。範本仍可先下載給財務或銀行窗口對欄位。"
        />
      )}

      <Alert
        type="info"
        showIcon
        message="銀行匯入會建立銀行交易並執行初步自動對帳"
        description="支援欄位：交易日期 txn_date / date / 交易日期 / 入帳日、帳務日期 value_date、摘要 description / 摘要 / 說明、收入 credit / deposit / 收入 / 存入、支出 debit / withdrawal / 支出 / 提出、或單一金額 amount / 金額 / 交易金額。"
      />

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={transactions}
      />

      <Modal
        title="匯入銀行對帳單"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        okText="確認匯入"
        cancelText="取消"
        onOk={handleConfirmImport}
        okButtonProps={{
          disabled: !importPreview || !pendingImportFile || importing || previewing,
          loading: importing,
        }}
        destroyOnClose
      >
        <div className="space-y-4">
          <Alert
            type="warning"
            showIcon
            message="匯入前請確認銀行帳戶"
            description="這會新增銀行交易資料並嘗試與系統付款配對；若銀行格式不同，請先下載範本比對欄位。"
          />

          <Select
            className="w-full"
            placeholder="選擇銀行帳戶"
            value={selectedAccountId}
            onChange={(value) => {
              setSelectedAccountId(value)
              setPendingImportFile(null)
              setImportPreview(null)
            }}
            options={accounts.map((account) => ({
              label: `${account.bankName} · ${account.accountName || account.accountNo}`,
              value: account.id,
            }))}
          />

          <Upload.Dragger
            accept=".csv,.txt"
            maxCount={1}
            showUploadList={false}
            disabled={importing || previewing}
            beforeUpload={handlePreviewStatement}
          >
            <p className="ant-upload-drag-icon">
              <UploadOutlined />
            </p>
            <p className="ant-upload-text">拖曳 CSV 到這裡，或點擊選擇檔案先預覽</p>
            <p className="ant-upload-hint">預覽不會寫入資料；確認匯入後才會建立銀行交易並執行初步對帳。</p>
          </Upload.Dragger>

          {importPreview && (
            <div className="space-y-3">
              <Alert
                type={importPreview.skippedCount > 0 ? 'warning' : 'success'}
                showIcon
                message={`可匯入 ${importPreview.importableCount} 筆，略過 ${importPreview.skippedCount} 筆`}
                description={`原始資料列共 ${importPreview.totalRows} 筆。請確認筆數與金額方向正確後再按「確認匯入」。`}
              />
              <Table
                size="small"
                rowKey="rowNumber"
                pagination={false}
                dataSource={importPreview.sampleRows || []}
                columns={[
                  { title: '列', dataIndex: 'rowNumber', width: 64 },
                  {
                    title: '日期',
                    dataIndex: 'txnDate',
                    render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
                  },
                  { title: '摘要', dataIndex: 'descriptionRaw' },
                  {
                    title: '金額',
                    key: 'amount',
                    render: (_: unknown, row: BankStatementPreview['sampleRows'][number]) => (
                      <Text type={row.amountOriginal >= 0 ? 'success' : 'danger'}>
                        {row.amountOriginal.toLocaleString()} {row.amountCurrency}
                      </Text>
                    ),
                  },
                ]}
              />
              {importPreview.skippedRows?.length > 0 && (
                <Alert
                  type="info"
                  showIcon
                  message="略過資料列"
                  description={importPreview.skippedRows
                    .slice(0, 5)
                    .map((row) => `第 ${row.rowNumber} 列：${row.reason}`)
                    .join('；')}
                />
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

const BankingPage: React.FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="page-section-stack"
    >
      <div>
        <Title level={2} className="!mb-1 !font-light">銀行與資金</Title>
        <Text className="text-gray-500">管理銀行帳戶與資金流向</Text>
      </div>

      <Card className="glass-card" bordered={false}>
        <Tabs
          defaultActiveKey="accounts"
          items={[
            {
              key: 'accounts',
              label: (
                <span>
                  <BankOutlined />
                  銀行帳戶
                </span>
              ),
              children: <AccountsTab />,
            },
            {
              key: 'transactions',
              label: (
                <span>
                  <HistoryOutlined />
                  交易明細
                </span>
              ),
              children: <TransactionsTab />,
            },
          ]}
        />
      </Card>
    </motion.div>
  )
}

export default BankingPage
