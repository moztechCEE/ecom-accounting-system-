import React, { useEffect, useMemo, useState } from 'react'
import {
  Card,
  Typography,
  Table,
  Button,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  message,
  Popconfirm,
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  EditOutlined,
  UserOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import { customerService, Customer } from '../services/customer.service'

const { Title, Text } = Typography
const { Option } = Select

const formatCurrency = (value?: number | string | null) =>
  `NT$ ${Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`

const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form] = Form.useForm()
  const watchedTaxId = Form.useWatch('taxId', form)

  const fetchCustomers = async () => {
    setLoading(true)
    try {
      const data = await customerService.findAll()
      setCustomers(data)
    } catch (error) {
      message.error('無法載入客戶列表')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCustomers()
  }, [])

  const sourceOptions = useMemo(() => {
    return Array.from(
      new Set(
        customers.flatMap((customer) => customer.sourceLabels || []),
      ),
    ).sort((left, right) => left.localeCompare(right, 'zh-Hant'))
  }, [customers])

  const filteredCustomers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()

    return customers.filter((customer) => {
      const sourceLabels = customer.sourceLabels || []
      const sourceBrands = customer.sourceBrands || []
      const matchesSource =
        sourceFilter === 'all' || sourceLabels.includes(sourceFilter)

      if (!matchesSource) {
        return false
      }

      if (!keyword) {
        return true
      }

      return [
        customer.name,
        customer.code,
        customer.email,
        customer.phone,
        customer.phoneExtension,
        customer.mobile,
        customer.taxId,
        customer.contactPerson,
        customer.address,
        customer.summary,
        customer.primarySourceLabel,
        customer.primarySourceBrand,
        ...sourceLabels,
        ...sourceBrands,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
  }, [customers, searchText, sourceFilter])

  useEffect(() => {
    if (!isModalVisible) {
      return
    }

    const normalizedTaxId = String(watchedTaxId || '').replace(/\D/g, '')
    const currentCode = form.getFieldValue('code')

    if (normalizedTaxId) {
      if (currentCode !== normalizedTaxId) {
        form.setFieldsValue({ code: normalizedTaxId, type: 'company' })
      }
      return
    }

    if (!editingId && currentCode) {
      form.setFieldsValue({ code: undefined })
    }
  }, [editingId, form, isModalVisible, watchedTaxId])

  const handleCreateOrUpdate = async (values: Partial<Customer>) => {
    try {
      if (editingId) {
        await customerService.update(editingId, values)
        message.success('客戶更新成功')
      } else {
        await customerService.create(values)
        message.success('客戶建立成功')
      }
      setIsModalVisible(false)
      form.resetFields()
      setEditingId(null)
      fetchCustomers()
    } catch (error) {
      message.error('操作失敗')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await customerService.delete(id)
      message.success('客戶已刪除')
      fetchCustomers()
    } catch (error) {
      message.error('刪除失敗')
    }
  }

  const openEditModal = (record: Customer) => {
    setEditingId(record.id)
    form.setFieldsValue(record)
    setIsModalVisible(true)
  }

  const columns = [
    {
      title: '客戶編號',
      key: 'code',
      width: 140,
      render: (_: unknown, record: Customer) => (
        <div className="font-medium text-slate-900">
          {record.code || '系統待產生'}
        </div>
      ),
    },
    {
      title: '客戶',
      key: 'customer',
      render: (_: unknown, record: Customer) => (
        <div>
          <div className="font-medium text-slate-900">{record.name}</div>
          <div className="text-xs text-slate-400">
            {record.email || '未填 Email'}
          </div>
          <div className="text-xs text-slate-400">
            {record.contactPerson ? `聯絡人：${record.contactPerson}` : '未填聯絡人'}
          </div>
          {record.summary ? (
            <div className="mt-1 line-clamp-2 text-xs text-slate-500">
              摘要：{record.summary}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '來源',
      key: 'source',
      render: (_: unknown, record: Customer) => (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(record.sourceLabels || ['手動建立 / 未歸戶']).map((label) => (
              <Tag key={`${record.id}-${label}`} color="blue">
                {label}
              </Tag>
            ))}
          </div>
          <div className="text-xs text-slate-400">
            品牌：{(record.sourceBrands || ['未歸戶']).join(' / ')}
          </div>
        </div>
      ),
    },
    {
      title: '客群',
      key: 'type',
      render: (_: unknown, record: Customer) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.type === 'company' ? 'purple' : 'green'}>
            {record.type === 'company' ? 'B2B / 公司' : 'B2C / 個人'}
          </Tag>
          <span className="text-xs text-slate-400">
            {record.taxId || '未填統編'}
          </span>
        </Space>
      ),
    },
    {
      title: '聯絡電話',
      key: 'contactPhones',
      render: (_: unknown, record: Customer) => (
        <Space direction="vertical" size={2}>
          <span className="text-sm text-slate-700">
            電話：{record.phone || '未填'}
            {record.phoneExtension ? ` #${record.phoneExtension}` : ''}
          </span>
          <span className="text-sm text-slate-700">
            手機：{record.mobile || '未填'}
          </span>
        </Space>
      ),
    },
    {
      title: '帳期 / 追帳',
      key: 'paymentTerms',
      render: (_: unknown, record: Customer) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.isMonthlyBilling || record.paymentTermDays ? 'gold' : 'default'}>
            {record.paymentSummary || (record.type === 'company' ? '公司客戶' : '一般現結')}
          </Tag>
          <span className="text-xs text-slate-400">
            {record.statementEmail || record.email || '未設定對帳單 Email'}
          </span>
          {Number(record.creditLimit || 0) > 0 ? (
            <span className="text-xs text-slate-400">
              額度 {formatCurrency(record.creditLimit)}
            </span>
          ) : null}
        </Space>
      ),
    },
    {
      title: '訂單歸戶',
      key: 'orders',
      render: (_: unknown, record: Customer) => (
        <div>
          <div className="font-medium text-slate-900">
            {record.totalOrders || 0} 筆
          </div>
          <div className="text-xs text-slate-400">
            {record.lastOrderDate
              ? `最近下單 ${dayjs(record.lastOrderDate).format('YYYY/MM/DD')}`
              : '尚未歸戶到訂單'}
          </div>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Customer) => (
        <Space size="middle">
          <Button icon={<EditOutlined />} onClick={() => openEditModal(record)} />
          <Popconfirm title="確定要刪除嗎？" onConfirm={() => handleDelete(record.id)}>
            <Button icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="p-6 space-y-8"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Title level={2} className="!mb-0">客戶管理</Title>
          <Text className="text-gray-500">
            清楚歸戶每位顧客來自哪個品牌、通路與來源，方便你在 MOZTECH 官網、團購與 Shopline 間快速檢索。
          </Text>
        </div>
        <Space wrap>
          <Input
            allowClear
            placeholder="搜尋客戶、Email、電話、來源"
            prefix={<SearchOutlined className="text-gray-400" />}
            className="w-72"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <Select
            value={sourceFilter}
            onChange={setSourceFilter}
            className="min-w-[220px]"
            options={[
              { label: '全部來源', value: 'all' },
              ...sourceOptions.map((source) => ({
                label: source,
                value: source,
              })),
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchCustomers}>重新整理</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={() => {
              setEditingId(null)
              form.resetFields()
              setIsModalVisible(true)
            }}
          >
            新增客戶
          </Button>
        </Space>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="shadow-sm rounded-xl border-0">
          <div className="text-xs text-slate-400">客戶總數</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {customers.length}
          </div>
        </Card>
        <Card className="shadow-sm rounded-xl border-0">
          <div className="text-xs text-slate-400">MOZTECH 官網</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {customers.filter((customer) =>
              (customer.sourceLabels || []).some((source) => source.includes('MOZTECH 官網')),
            ).length}
          </div>
        </Card>
        <Card className="shadow-sm rounded-xl border-0">
          <div className="text-xs text-slate-400">萬魔未來工學院 / 團購</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {customers.filter((customer) =>
              (customer.sourceBrands || []).some((brand) => brand.includes('萬魔')),
            ).length}
          </div>
        </Card>
        <Card className="shadow-sm rounded-xl border-0">
          <div className="text-xs text-slate-400">未歸戶 / 手動建立</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {customers.filter((customer) => !customer.totalOrders).length}
          </div>
        </Card>
      </div>

      <Card className="shadow-sm rounded-xl border-0">
        <Table
          columns={columns}
          dataSource={filteredCustomers}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editingId ? '編輯客戶' : '新增客戶'}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        onOk={() => form.submit()}
        okText={editingId ? '儲存變更' : '建立客戶'}
        cancelText="取消"
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={handleCreateOrUpdate}>
          <Form.Item name="name" label="客戶名稱" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder="例如: 王小明 或 某某公司" />
          </Form.Item>
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item
              name="code"
              label="客戶/供應商編碼"
              extra="有統編時會自動同步；無統編時建立後由系統產生個人編號。"
            >
              <Input readOnly placeholder="系統自動帶入" />
            </Form.Item>
            <Form.Item
              name="taxId"
              label="統一編號"
              extra="開立 B2B 發票時會帶入買受人統編。"
              normalize={(value) => String(value || '').replace(/\D/g, '').slice(0, 8)}
            >
              <Input inputMode="numeric" maxLength={8} placeholder="例如 12345678" />
            </Form.Item>
          </div>
          <Form.Item name="type" label="類型" initialValue="individual">
            <Select>
              <Option value="individual">個人 / B2C</Option>
              <Option value="company">公司 / B2B</Option>
            </Select>
          </Form.Item>
          <Form.Item name="contactPerson" label="聯絡人">
            <Input placeholder="公司客戶的對接窗口，例如：王小姐" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ type: 'email', message: 'Email 格式不正確' }]}
            extra="需要寄送電子發票或對帳資料時會優先使用這個信箱。"
          >
            <Input placeholder="invoice@example.com" />
          </Form.Item>
          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
            <Form.Item name="phone" label="電話">
              <Input placeholder="市話，例如 02-12345678" />
            </Form.Item>
            <Form.Item name="phoneExtension" label="分機">
              <Input placeholder="例如 123" />
            </Form.Item>
          </div>
          <Form.Item name="mobile" label="手機">
            <Input placeholder="手機，例如 0912-345-678" />
          </Form.Item>
          <Form.Item
            name="address"
            label="地址"
            rules={[{ required: true, message: '請填入地址' }]}
          >
            <Input.TextArea rows={2} placeholder="發票、報價單或出貨聯絡可使用的地址" />
          </Form.Item>
          <div className="mb-4 rounded-2xl bg-slate-50 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">摘要 / 員工備註</div>
            <Form.Item name="summary" className="!mb-0">
              <Input.TextArea
                rows={4}
                placeholder="記錄客戶背景、偏好、需求重點或內部交接注意事項"
              />
            </Form.Item>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">B2B 月結 / 應收條件</div>
            <Form.Item name="isMonthlyBilling" label="是否月結帳戶" valuePropName="checked">
              <Switch checkedChildren="月結" unCheckedChildren="現結" />
            </Form.Item>
            <div className="grid gap-3 md:grid-cols-2">
              <Form.Item name="paymentTerms" label="付款條件">
                <Select
                  allowClear
                  placeholder="選擇付款條件"
                  options={[
                    { label: '現結 / 預付', value: 'prepaid' },
                    { label: '月結 30 天', value: 'net30' },
                    { label: '月結 45 天', value: 'net45' },
                    { label: '月結 60 天', value: 'net60' },
                    { label: '自訂', value: 'custom' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="paymentTermDays" label="帳期天數">
                <InputNumber min={0} max={180} className="w-full" placeholder="例如 30" />
              </Form.Item>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Form.Item name="billingCycle" label="對帳週期">
                <Select
                  allowClear
                  placeholder="選擇週期"
                  options={[
                    { label: '每月出帳', value: 'monthly' },
                    { label: '每兩週出帳', value: 'biweekly' },
                    { label: '自訂', value: 'custom' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="creditLimit" label="信用額度">
                <InputNumber min={0} precision={0} className="w-full" placeholder="例如 100000" />
              </Form.Item>
            </div>
            <Form.Item name="statementEmail" label="對帳單 Email">
              <Input placeholder="若留空，使用客戶 Email" />
            </Form.Item>
            <Form.Item name="collectionOwner" label="內部追帳窗口">
              <Input placeholder="例如：財務部 / Eason / 會計窗口" />
            </Form.Item>
            <Form.Item name="collectionNote" label="追帳備註">
              <Input.TextArea rows={2} placeholder="例如：每月 5 日寄送上月對帳單，下月 5 日前收款" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default CustomersPage
