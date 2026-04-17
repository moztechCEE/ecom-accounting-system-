import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  Descriptions,
  Empty,
  Tabs,
  DatePicker,
  InputNumber,
  Tooltip,
  Statistic,
  Row,
  Col
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckCircleOutlined,
  BankOutlined,
  DollarOutlined,
  FileTextOutlined,
  ShopOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { GlassCard } from '../components/ui/GlassCard'
import { GlassButton } from '../components/ui/GlassButton'
import { useAuth } from '../contexts/AuthContext'
import { expenseService, type ExpenseRequest } from '../services/expense.service'
import { apService } from '../services/ap.service'
import { bankingService } from '../services/banking.service'
import type {
  BankAccount,
  ApInvoice,
  EcpayServiceFeeInvoiceSummary,
} from '../types'
import { Link, useSearchParams } from 'react-router-dom'

const { Title, Text } = Typography

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'

const AccountsPayablePage: React.FC = () => {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const isAdmin = useMemo(
    () => (user?.roles ?? []).some((role) => role === 'SUPER_ADMIN' || role === 'ADMIN'),
    [user],
  )

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'expenses')
  const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>([])
  const [invoices, setInvoices] = useState<ApInvoice[]>([])
  const [ecpayFeeSummary, setEcpayFeeSummary] =
    useState<EcpayServiceFeeInvoiceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [banks, setBanks] = useState<BankAccount[]>([])
  
  // Payment Modal State
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRequest | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<ApInvoice | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const entityId = DEFAULT_ENTITY_ID

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [expensesData, invoicesData, banksData, feeSummaryData] = await Promise.all([
        expenseService.getExpenseRequests({ entityId, status: 'approved' }),
        apService.getInvoices(entityId),
        bankingService.getAccounts(),
        apService.getEcpayServiceFeeInvoiceSummary({ entityId }),
      ])

      setExpenseRequests(Array.isArray(expensesData) ? expensesData : [])
      
      // Filter invoices that are not fully paid
      const pendingInvoices = (Array.isArray(invoicesData) ? invoicesData : [])
        .filter(inv => inv.status !== 'paid')
      setInvoices(pendingInvoices)

      setBanks(Array.isArray(banksData) ? banksData : [])
      setEcpayFeeSummary(feeSummaryData || null)
    } catch (error) {
      console.error(error)
      message.error('無法載入資料')
    } finally {
      setLoading(false)
    }
  }, [entityId])

  useEffect(() => {
    if (isAdmin) {
      loadData()
    }
  }, [isAdmin, loadData])

  // Calculate totals
  const totalExpenseAmount = useMemo(() => 
    expenseRequests.reduce((sum, req) => sum + Number(req.amountOriginal), 0),
    [expenseRequests]
  )

  const totalInvoiceAmount = useMemo(() => 
    invoices.reduce((sum, inv) => sum + Number(inv.amountOriginal), 0),
    [invoices]
  )

  const overdueCount = useMemo(() => {
    const now = dayjs()
    const overdueExpenses = expenseRequests.filter(r => r.dueDate && dayjs(r.dueDate).isBefore(now, 'day')).length
    const overdueInvoices = invoices.filter(i => i.dueDate && dayjs(i.dueDate).isBefore(now, 'day')).length
    return overdueExpenses + overdueInvoices
  }, [expenseRequests, invoices])

  const handleOpenExpensePayment = (record: ExpenseRequest) => {
    setSelectedExpense(record)
    setSelectedInvoice(null)
    form.resetFields()
    form.setFieldsValue({

      amount: record.amountOriginal,
      paymentDate: dayjs()
    })
    setPaymentModalOpen(true)
  }

  const handleOpenInvoicePayment = (record: ApInvoice) => {
    setSelectedInvoice(record)
    setSelectedExpense(null)
    form.resetFields()
    form.setFieldsValue({
      amount: record.amountOriginal, // Default to full amount, but user can change for partial
      paymentDate: dayjs()
    })
    setPaymentModalOpen(true)
  }

  const handlePaymentSubmit = async () => {
    try {
      const values = await form.validateFields()
      const selectedBank = banks.find(b => b.id === values.bankAccountId)
      
      if (!selectedBank) {
        message.error('請選擇付款銀行')
        return
      }

      setSubmitting(true)

      if (selectedExpense) {
        // Pay Expense Request
        const accountNo = selectedBank.accountNo || ''
        const last5 = accountNo.length > 5 ? accountNo.slice(-5) : accountNo

        await expenseService.updatePaymentInfo(selectedExpense.id, {
          paymentStatus: 'paid',
          paymentMethod: 'bank_transfer',
          paymentBankName: selectedBank.bankName,
          paymentAccountLast5: last5
        })
        message.success('費用單據付款成功')
      } else if (selectedInvoice) {
        // Pay Vendor Invoice
        await apService.recordPayment(selectedInvoice.id, {
          amount: values.amount,
          paymentDate: values.paymentDate.toISOString(),
          bankAccountId: values.bankAccountId,
          newStatus: values.amount >= selectedInvoice.amountOriginal ? 'paid' : 'partial'
        })
        message.success('採購發票付款成功')
      }

      setPaymentModalOpen(false)
      loadData()
    } catch (error) {
      console.error(error)
      message.error('付款失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const expenseColumns: ColumnsType<ExpenseRequest> = [
    {
      title: '申請資訊',
      key: 'info',
      render: (_, record) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-slate-800">{record.reimbursementItem?.name || '--'}</span>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <FileTextOutlined />
            <span>{record.description || '無備註'}</span>
          </div>
        </div>
      )
    },
    {
      title: '申請人',
      dataIndex: ['creator', 'name'],
      key: 'creator',
      render: (text) => <Tag>{text}</Tag>
    },
    {
      title: '金額',
      dataIndex: 'amountOriginal',
      key: 'amountOriginal',
      align: 'right',
      render: (val, record) => (
        <Text className="font-mono font-semibold text-slate-700">
          {record.amountCurrency} {Number(val).toLocaleString()}
        </Text>
      )
    },
    {
      title: '預計付款日',
      dataIndex: 'dueDate',
      key: 'dueDate',
      render: (date) => {
        if (!date) return '--'
        const isOverdue = dayjs(date).isBefore(dayjs(), 'day')
        return (
          <span className={isOverdue ? 'text-red-500 font-medium' : 'text-slate-600'}>
            {dayjs(date).format('YYYY-MM-DD')}
            {isOverdue && <Tooltip title="已逾期"><ExclamationCircleOutlined className="ml-1" /></Tooltip>}
          </span>
        )
      }
    },
    {
      title: '操作',
      key: 'action',
      align: 'center',
      render: (_, record) => (
        <Button 
          type="primary" 
          icon={<DollarOutlined />} 
          onClick={() => handleOpenExpensePayment(record)}
          className="bg-green-600 hover:bg-green-500 border-none shadow-sm"
          size="small"
        >
          付款
        </Button>
      )
    }
  ]

  const invoiceColumns: ColumnsType<ApInvoice> = [
    {
      title: '發票資訊',
      key: 'info',
      render: (_, record) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-slate-800">{record.invoiceNo}</span>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ShopOutlined />
            <span>{record.vendor?.name || '未知廠商'}</span>
          </div>
        </div>
      )
    },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const colors: Record<string, string> = { pending: 'gold', partial: 'blue', overdue: 'red' }
        const labels: Record<string, string> = { pending: '待付款', partial: '部分付款', overdue: '逾期' }
        return <Tag color={colors[status]}>{labels[status] || status}</Tag>
      }
    },
    {
      title: '應付金額',
      dataIndex: 'amountOriginal',
      key: 'amountOriginal',
      align: 'right',
      render: (val, record) => (
        <Text className="font-mono font-semibold text-slate-700">
          {record.amountCurrency} {Number(val).toLocaleString()}
        </Text>
      )
    },
    {
      title: '到期日',
      dataIndex: 'dueDate',
      key: 'dueDate',
      render: (date) => {
        if (!date) return '--'
        const isOverdue = dayjs(date).isBefore(dayjs(), 'day')
        return (
          <span className={isOverdue ? 'text-red-500 font-medium' : 'text-slate-600'}>
            {dayjs(date).format('YYYY-MM-DD')}
            {isOverdue && <Tooltip title="已逾期"><ExclamationCircleOutlined className="ml-1" /></Tooltip>}
          </span>
        )
      }
    },
    {
      title: '操作',
      key: 'action',
      align: 'center',
      render: (_, record) => (
        <Button 
          type="primary" 
          icon={<DollarOutlined />} 
          onClick={() => handleOpenInvoicePayment(record)}
          className="bg-blue-600 hover:bg-blue-500 border-none shadow-sm"
          size="small"
        >
          付款
        </Button>
      )
    }
  ]

  if (!isAdmin) {
    return <div className="p-8 text-center">無權限存取此頁面</div>
  }

  return (
    <div className="space-y-6 animate-[fadeInUp_0.4s_ease-out]">
      <div className="flex justify-between items-end">
        <div>
          <Title level={2} className="!mb-1 !font-light">應付帳款 (AP)</Title>
          <Text className="text-gray-500">集中管理所有待付款項，包含員工報銷與廠商發票</Text>
        </div>
        <div className="flex gap-2">
          <GlassButton onClick={loadData}>
            <ClockCircleOutlined className="mr-2" />
            重新整理
          </GlassButton>
        </div>
      </div>

      {/* Summary Cards */}
      <Row gutter={16}>
        <Col span={8}>
          <GlassCard className="h-full flex flex-col justify-center">
            <Statistic 
              title="待付總額 (Total Payable)" 
              value={totalExpenseAmount + totalInvoiceAmount} 
              precision={0}
              prefix={<DollarOutlined />}
              suffix="TWD"
              valueStyle={{ color: '#3f8600' }}
            />
          </GlassCard>
        </Col>
        <Col span={8}>
          <GlassCard className="h-full flex flex-col justify-center">
            <Statistic 
              title="待處理單據 (Pending Items)" 
              value={expenseRequests.length + invoices.length} 
              suffix="筆"
            />
          </GlassCard>
        </Col>
        <Col span={8}>
          <GlassCard className="h-full flex flex-col justify-center">
            <Statistic 
              title="已逾期 (Overdue)" 
              value={overdueCount} 
              valueStyle={{ color: '#cf1322' }}
              prefix={<WarningOutlined />}
              suffix="筆"
            />
          </GlassCard>
        </Col>
        <Col span={8}>
          <GlassCard className="h-full flex flex-col justify-center">
            <Statistic
              title="綠界服務費發票"
              value={ecpayFeeSummary?.summary.invoiceCount || 0}
              prefix={<BankOutlined />}
              suffix="筆"
            />
            <div className="mt-2 text-xs text-slate-500">
              已匯入 NT$ {(ecpayFeeSummary?.summary.invoiceAmount || 0).toLocaleString()}，
              待核對 {ecpayFeeSummary?.summary.unmatchedCount || 0} 筆
            </div>
          </GlassCard>
        </Col>
      </Row>

      <GlassCard className="p-0 overflow-hidden min-h-[600px]">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          className="px-6 pt-4"
          items={[
            {
              key: 'expenses',
              label: (
                <span className="flex items-center gap-2">
                  <FileTextOutlined /> 費用報銷 (員工)
                  <Tag className="ml-1 rounded-full bg-green-100 text-green-600 border-none">{expenseRequests.length}</Tag>
                </span>
              ),
              children: (
                <Table
                  rowKey="id"
                  columns={expenseColumns}
                  dataSource={expenseRequests}
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  className="w-full mt-2"
                />
              )
            },
            {
              key: 'invoices',
              label: (
                <span className="flex items-center gap-2">
                  <ShopOutlined /> 採購發票 (廠商)
                  <Tag className="ml-1 rounded-full bg-blue-100 text-blue-600 border-none">{invoices.length}</Tag>
                </span>
              ),
              children: (
                <Table
                  rowKey="id"
                  columns={invoiceColumns}
                  dataSource={invoices}
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  className="w-full mt-2"
                />
              )
            },
            {
              key: 'ecpay-fees',
              label: (
                <span className="flex items-center gap-2">
                  <BankOutlined /> 綠界服務費發票
                  <Tag className="ml-1 rounded-full bg-violet-100 text-violet-600 border-none">
                    {ecpayFeeSummary?.summary.invoiceCount || 0}
                  </Tag>
                </span>
              ),
              children: (
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={ecpayFeeSummary?.items || []}
                  pagination={{ pageSize: 10 }}
                  className="w-full mt-2"
                  columns={[
                    {
                      title: '發票資訊',
                      key: 'invoice',
                      render: (_, record) => (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-slate-800">{record.invoiceNo}</span>
                          <div className="text-xs text-slate-500">
                            {dayjs(record.invoiceDate).format('YYYY-MM-DD')} · {record.vendorName || '綠界科技'}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: '類型 / Merchant',
                      key: 'meta',
                      render: (_, record) => (
                        <div className="flex flex-col gap-1">
                          <Tag color="blue">{record.serviceType || 'gateway_fee'}</Tag>
                          <span className="text-xs text-slate-500">
                            {record.merchantKey || record.merchantId || '--'}
                          </span>
                        </div>
                      ),
                    },
                    {
                      title: '發票狀態',
                      key: 'issued',
                      render: (_, record) => (
                        <Tag color={record.invoiceIssuedStatus === 'issued' ? 'green' : 'gold'}>
                          {record.invoiceIssuedStatus === 'issued' ? '已確認開立' : '待確認'}
                        </Tag>
                      ),
                    },
                    {
                      title: '金額 / 已核對',
                      key: 'amount',
                      render: (_, record) => (
                        <div className="text-right">
                          <div className="font-medium text-slate-800">
                            NT$ {Number(record.amountOriginal).toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-500">
                            已比對 NT$ {Number(record.matchedGatewayFeeAmount || 0).toLocaleString()}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: 'AP 狀態',
                      key: 'status',
                      render: (_, record) => (
                        <div className="flex flex-col gap-1">
                          <Tag color={record.status === 'paid' ? 'green' : 'gold'}>
                            {record.status === 'paid' ? '已沖抵' : '待處理'}
                          </Tag>
                          <span className="text-xs text-slate-500">
                            {record.coverageStatus === 'matched' ? '已對上手續費' : '尚未完整對上'}
                          </span>
                        </div>
                      ),
                    },
                  ]}
                />
              )
            }
          ]}
        />
      </GlassCard>

      <Modal
        title={
          <div className="flex items-center gap-2 text-lg">
            <BankOutlined className="text-blue-600" />
            <span>{selectedExpense ? '支付費用報銷' : '支付採購發票'}</span>
          </div>
        }
        open={paymentModalOpen}
        onCancel={() => setPaymentModalOpen(false)}
        onOk={handlePaymentSubmit}
        confirmLoading={submitting}
        okText="確認付款"
        cancelText="取消"
        width={500}
      >
        <Form form={form} layout="vertical" className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-100">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="付款對象">
                <span className="font-medium">
                  {selectedExpense ? selectedExpense.creator?.name : selectedInvoice?.vendor?.name}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="項目/單號">
                {selectedExpense ? selectedExpense.reimbursementItem?.name : selectedInvoice?.invoiceNo}
              </Descriptions.Item>
              <Descriptions.Item label="應付金額">
                <span className="font-bold text-lg text-slate-700">
                  {selectedExpense ? selectedExpense.amountCurrency : selectedInvoice?.amountCurrency} 
                  {' '}
                  {Number(selectedExpense ? selectedExpense.amountOriginal : selectedInvoice?.amountOriginal).toLocaleString()}
                </span>
              </Descriptions.Item>
            </Descriptions>
          </div>

          <Form.Item
            name="bankAccountId"
            label="出帳銀行帳戶"
            rules={[{ required: true, message: '請選擇出帳銀行' }]}
          >
            <Select 
              placeholder="請選擇公司銀行帳戶"
              className="h-10"
              notFoundContent={
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="無可用銀行帳戶">
                  <Link to="/banking"><Button type="link">新增銀行帳戶</Button></Link>
                </Empty>
              }
            >
              {banks.map(bank => (
                <Select.Option key={bank.id} value={bank.id}>
                  <div className="flex justify-between items-center">
                    <span>{bank.bankName}</span>
                    <span className="text-gray-400 text-xs">{bank.accountNo}</span>
                  </div>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item
              name="paymentDate"
              label="付款日期"
              rules={[{ required: true, message: '請選擇付款日期' }]}
            >
              <DatePicker className="w-full h-10" />
            </Form.Item>
            
            {selectedInvoice && (
              <Form.Item
                name="amount"
                label="本次付款金額"
                rules={[{ required: true, message: '請輸入金額' }]}
              >
                <InputNumber 
                  className="w-full h-10" 
                  formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value!.replace(/\$\s?|(,*)/g, '')}
                />
              </Form.Item>
            )}
          </div>
          
          <div className="text-xs text-gray-500 mt-2 bg-blue-50 p-3 rounded text-blue-700">
            <p>• 系統將自動記錄銀行交易紀錄</p>
            <p>• {selectedExpense ? '費用單據將標記為已付款' : '發票狀態將根據付款金額更新'}</p>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

export default AccountsPayablePage
