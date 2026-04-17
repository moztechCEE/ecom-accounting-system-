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
  Select,
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

const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form] = Form.useForm()

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
        customer.email,
        customer.phone,
        customer.taxId,
        customer.primarySourceLabel,
        customer.primarySourceBrand,
        ...sourceLabels,
        ...sourceBrands,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
  }, [customers, searchText, sourceFilter])

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
      title: '客戶',
      key: 'customer',
      render: (_: unknown, record: Customer) => (
        <div>
          <div className="font-medium text-slate-900">{record.name}</div>
          <div className="text-xs text-slate-400">
            {record.email || '未填 Email'}
            {record.phone ? ` · ${record.phone}` : ''}
          </div>
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
      className="p-6 space-y-6"
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
      >
        <Form form={form} layout="vertical" onFinish={handleCreateOrUpdate}>
          <Form.Item name="name" label="客戶名稱" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder="例如: 王小明 或 某某公司" />
          </Form.Item>
          <Form.Item name="type" label="類型" initialValue="individual">
            <Select>
              <Option value="individual">個人 / B2C</Option>
              <Option value="company">公司 / B2B</Option>
            </Select>
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="電話">
            <Input />
          </Form.Item>
          <Form.Item name="taxId" label="統一編號">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default CustomersPage
