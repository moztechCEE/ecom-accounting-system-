import React from 'react'
import { Button, Form, Input, Modal, Popconfirm, Result, Select, Space, Switch, Table, Tag, message } from 'antd'
import { EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useAuth } from '../contexts/AuthContext'
import {
  createEntity,
  deactivateEntity,
  Entity,
  EntityPayload,
  listEntities,
  updateEntity,
} from '../services/entities.service'

const CURRENCY_OPTIONS = ['TWD', 'CNY', 'USD', 'JPY', 'HKD', 'SGD'].map((value) => ({
  label: value,
  value,
}))

const COUNTRY_OPTIONS = [
  { label: 'TW 台灣', value: 'TW' },
  { label: 'CN 中國', value: 'CN' },
  { label: 'US 美國', value: 'US' },
  { label: 'JP 日本', value: 'JP' },
  { label: 'HK 香港', value: 'HK' },
  { label: 'SG 新加坡', value: 'SG' },
]

const BusinessEntitiesPage: React.FC = () => {
  const { user } = useAuth()
  const [form] = Form.useForm<EntityPayload>()
  const [entities, setEntities] = React.useState<Entity[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingEntity, setEditingEntity] = React.useState<Entity | null>(null)
  const isSuperAdmin = (user?.roles ?? []).includes('SUPER_ADMIN')

  const fetchEntities = React.useCallback(async () => {
    setLoading(true)
    try {
      setEntities(await listEntities())
    } catch (error: any) {
      message.error(error?.response?.data?.message || '讀取事業代號失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (isSuperAdmin) {
      void fetchEntities()
    }
  }, [fetchEntities, isSuperAdmin])

  const openCreateModal = () => {
    setEditingEntity(null)
    form.setFieldsValue({
      loginCode: '',
      name: '',
      country: 'TW',
      baseCurrency: 'TWD',
      taxId: '',
      address: '',
      contactEmail: '',
      contactPhone: '',
      isActive: true,
    })
    setModalOpen(true)
  }

  const openEditModal = (entity: Entity) => {
    setEditingEntity(entity)
    form.setFieldsValue({
      loginCode: entity.loginCode,
      name: entity.name,
      country: entity.country || 'TW',
      baseCurrency: entity.baseCurrency || 'TWD',
      taxId: entity.taxId || '',
      address: entity.address || '',
      contactEmail: entity.contactEmail || '',
      contactPhone: entity.contactPhone || '',
      isActive: entity.isActive ?? true,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const payload: EntityPayload = {
        ...values,
        loginCode: values.loginCode.trim(),
        name: values.name.trim(),
        country: values.country.trim().toUpperCase(),
        baseCurrency: values.baseCurrency.trim().toUpperCase(),
        taxId: values.taxId?.trim() || undefined,
        address: values.address?.trim() || undefined,
        contactEmail: values.contactEmail?.trim() || undefined,
        contactPhone: values.contactPhone?.trim() || undefined,
        isActive: values.isActive ?? true,
      }

      setSaving(true)
      if (editingEntity) {
        await updateEntity(editingEntity.id, payload)
        message.success('事業代號已更新')
      } else {
        await createEntity(payload)
        message.success('事業代號已新增')
      }
      setModalOpen(false)
      await fetchEntities()
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.response?.data?.message || '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (entity: Entity) => {
    try {
      await deactivateEntity(entity.id)
      message.success('已停用事業代號')
      await fetchEntities()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '停用失敗')
    }
  }

  const columns: ColumnsType<Entity> = [
    {
      title: '事業代號',
      dataIndex: 'loginCode',
      width: 150,
      render: (value: string) => <span className="font-semibold text-slate-900">{value}</span>,
    },
    {
      title: '公司名稱',
      dataIndex: 'name',
      render: (value: string, record) => (
        <div>
          <div className="font-medium text-slate-900">{value}</div>
          <div className="text-xs text-slate-500">{record.taxId || '未填統編'}</div>
        </div>
      ),
    },
    {
      title: '地區 / 幣別',
      width: 160,
      render: (_, record) => `${record.country || '-'} / ${record.baseCurrency || '-'}`,
    },
    {
      title: '狀態',
      dataIndex: 'isActive',
      width: 120,
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'default'}>{isActive ? '啟用中' : '已停用'}</Tag>
      ),
    },
    {
      title: '操作',
      width: 170,
      render: (_, record) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => openEditModal(record)}>
            編輯
          </Button>
          <Popconfirm
            title="停用事業代號"
            description="停用後登入頁不會再提供此代號。"
            okText="停用"
            cancelText="取消"
            onConfirm={() => handleDeactivate(record)}
            disabled={!record.isActive}
          >
            <Button danger icon={<StopOutlined />} disabled={!record.isActive}>
              停用
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  if (!isSuperAdmin) {
    return (
      <Result
        status="403"
        title="沒有權限"
        subTitle="只有系統最高權限管理者可以新增或維護其他公司的事業代號。"
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="m-0 text-3xl font-semibold text-slate-950">事業代號管理</h1>
          <p className="mt-2 text-slate-500">
            管理各公司登入使用的事業代號。登入頁只會顯示代號，不公開公司名稱。
          </p>
        </div>
        <Button type="primary" size="large" icon={<PlusOutlined />} onClick={openCreateModal}>
          新增公司
        </Button>
      </div>

      <div className="rounded-[24px] border border-white/50 bg-white/65 p-6 shadow-xl shadow-slate-200/50 backdrop-blur">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={entities}
          pagination={{ pageSize: 10 }}
        />
      </div>

      <Modal
        title={editingEntity ? '編輯事業代號' : '新增公司與事業代號'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText="儲存"
        cancelText="取消"
        width={760}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Form.Item
              label="事業代號"
              name="loginCode"
              rules={[
                { required: true, message: '請輸入事業代號' },
                { pattern: /^[A-Za-z0-9_-]+$/, message: '僅可使用英文、數字、底線或連字號' },
              ]}
            >
              <Input placeholder="例如 900324" />
            </Form.Item>
            <Form.Item label="公司名稱" name="name" rules={[{ required: true, message: '請輸入公司名稱' }]}>
              <Input placeholder="內部辨識用，不會顯示在登入頁" />
            </Form.Item>
            <Form.Item label="國家 / 地區" name="country" rules={[{ required: true, message: '請選擇地區' }]}>
              <Select options={COUNTRY_OPTIONS} />
            </Form.Item>
            <Form.Item label="基礎幣別" name="baseCurrency" rules={[{ required: true, message: '請選擇幣別' }]}>
              <Select showSearch options={CURRENCY_OPTIONS} />
            </Form.Item>
            <Form.Item label="統一編號 / 稅籍編號" name="taxId">
              <Input placeholder="選填" />
            </Form.Item>
            <Form.Item label="聯絡信箱" name="contactEmail">
              <Input placeholder="選填" />
            </Form.Item>
            <Form.Item label="聯絡電話" name="contactPhone">
              <Input placeholder="選填" />
            </Form.Item>
            <Form.Item label="啟用狀態" name="isActive" valuePropName="checked">
              <Switch checkedChildren="啟用" unCheckedChildren="停用" />
            </Form.Item>
          </div>
          <Form.Item label="地址" name="address">
            <Input placeholder="選填" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default BusinessEntitiesPage
