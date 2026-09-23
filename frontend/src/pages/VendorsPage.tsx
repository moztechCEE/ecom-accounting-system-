import React, { useEffect, useMemo, useState } from 'react'
import { GlassDrawer, GlassDrawerSection } from '../components/ui/GlassDrawer'
import {
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
  Popconfirm
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ShopOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'
import { vendorService } from '../services/vendor.service'
import { Vendor, CreateVendorDto } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { useEntityContext } from '../hooks/useEntityContext'
import { hasAnyPermission } from '../utils/access'

const { Title, Text } = Typography
const { Option } = Select

const VendorsPage: React.FC = () => {
  const { user } = useAuth()
  const entityId = useEntityContext()
  const canManage = hasAnyPermission(user, ['purchase_orders:create'])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [form] = Form.useForm()

  const loadVendors = async () => {
    setLoading(true)
    try {
      const data = await vendorService.findAll(entityId)
      setVendors(Array.isArray(data) ? data : [])
    } catch (error: any) {
      message.error(error.response?.data?.message || '載入失敗')
      setVendors([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadVendors()
  }, [entityId])

  const stats = useMemo(() => {
    const total = vendors.length
    const active = vendors.filter(v => v.isActive).length
    return { total, active }
  }, [vendors])

  const filteredVendors = useMemo(() => {
    if (!searchKeyword) return vendors
    const lower = searchKeyword.toLowerCase()
    return vendors.filter(
      v =>
        v.name.toLowerCase().includes(lower) ||
        v.taxId?.includes(lower)
    )
  }, [vendors, searchKeyword])

  const handleAdd = () => {
    setEditingVendor(null)
    form.resetFields()
    form.setFieldsValue({ isActive: true, defaultCurrency: 'TWD' })
    setDrawerOpen(true)
  }

  const handleEdit = (record: Vendor) => {
    setEditingVendor(record)
    form.setFieldsValue(record)
    setDrawerOpen(true)
  }

  const handleDeactivate = async (id: string) => {
    try {
      await vendorService.remove(id, entityId)
      message.success('供應商已停用，歷史採購資料保留')
      loadVendors()
    } catch (error: any) {
      message.error(error.response?.data?.message || '停用失敗')
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingVendor) {
        await vendorService.update(editingVendor.id, values, entityId)
        message.success('更新成功')
      } else {
        await vendorService.create(values as CreateVendorDto, entityId)
        message.success('新增成功')
      }
      setDrawerOpen(false)
      loadVendors()
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.message || '供應商儲存失敗')
    }
  }

  const columns = [
    {
      title: '國家／地區',
      dataIndex: 'country',
      key: 'country',
      width: 120,
      render: (text: string) => text || '—'
    },
    {
      title: '名稱',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span className="font-medium text-gray-800">{text}</span>
    },
    {
      title: '統編',
      dataIndex: 'taxId',
      key: 'taxId',
      width: 120,
    },
    {
      title: '聯絡人',
      dataIndex: 'contactPerson',
      key: 'contactPerson',
      width: 120,
    },
    {
      title: 'Email',
      dataIndex: 'contactEmail',
      key: 'contactEmail',
    },
    {
      title: '幣別',
      dataIndex: 'defaultCurrency',
      key: 'defaultCurrency',
      width: 80,
      render: (text: string) => <Tag>{text}</Tag>
    },
    {
      title: '狀態',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'success' : 'default'} className="rounded-full border-none">
          {isActive ? '啟用' : '停用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: Vendor) => canManage ? (
        <Space size="small">
          <Button 
            type="text" 
            icon={<EditOutlined />} 
            onClick={() => handleEdit(record)}
          />
          {record.isActive ? <Popconfirm
            title="確認停用"
            description={`確定要停用供應商 ${record.name} 嗎？歷史採購紀錄會保留。`}
            onConfirm={() => handleDeactivate(record.id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} aria-label={`停用 ${record.name}`} />
          </Popconfirm> : null}
        </Space>
      ) : '—',
    },
  ]

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <Title level={2} className="!mb-1 !font-light">供應商管理</Title>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadVendors}>重新整理</Button>
          {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增供應商</Button>}
        </Space>
      </div>

      <Row gutter={16}>
        <Col span={12}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="供應商總數"
              value={stats.total}
              prefix={<ShopOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card bordered={false} className="glass-card">
            <Statistic
              title="活躍供應商"
              value={stats.active}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Card className="glass-card" bordered={false}>
        <Form layout="inline" className="mb-6">
          <Form.Item name="search">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜尋名稱或統編"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              style={{ minWidth: 280 }}
            />
          </Form.Item>
        </Form>

        <Table 
          columns={columns} 
          dataSource={filteredVendors} 
          rowKey="id" 
          loading={loading}
          scroll={{ x: 1000 }}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <GlassDrawer
        title={editingVendor ? '編輯供應商' : '新增供應商'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={720}
      >
        <Form
          form={form}
          layout="vertical"
          className="h-full flex flex-col"
        >
          <div className="flex-1 space-y-4">
            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">基本資料</div>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="name"
                    label="供應商名稱"
                    rules={[{ required: true, whitespace: true, message: '請輸入名稱' }]}
                  >
                    <Input maxLength={200} placeholder="輸入公司名稱" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="country"
                    label="國家／地區"
                  >
                    <Input maxLength={100} placeholder="例如：台灣" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="taxId" label="統一編號">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="isActive" label="狀態" valuePropName="checked">
                    <Switch checkedChildren="啟用" unCheckedChildren="停用" />
                  </Form.Item>
                </Col>
              </Row>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">聯絡資訊</div>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="contactPerson" label="聯絡人">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="contactPhone" label="電話">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item name="contactEmail" label="Email" rules={[{ type: 'email' }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item name="address" label="地址">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </Col>
              </Row>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">財務設定</div>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="defaultCurrency" label="預設幣別">
                    <Select>
                      <Option value="TWD">TWD - 新台幣</Option>
                      <Option value="USD">USD - 美金</Option>
                      <Option value="EUR">EUR - 歐元</Option>
                      <Option value="JPY">JPY - 日圓</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
            </GlassDrawerSection>
          </div>

          <GlassDrawerSection>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDrawerOpen(false)} className="rounded-full">取消</Button>
              <Button type="primary" onClick={handleSubmit} className="rounded-full bg-blue-600 hover:bg-blue-500 border-none shadow-lg shadow-blue-200">
                {editingVendor ? '更新' : '新增'}
              </Button>
            </div>
          </GlassDrawerSection>
        </Form>
      </GlassDrawer>
    </div>
  )
}

export default VendorsPage
