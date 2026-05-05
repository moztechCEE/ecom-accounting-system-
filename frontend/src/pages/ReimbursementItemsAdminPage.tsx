import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  SearchOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { GlassDrawer, GlassDrawerSection } from '../components/ui/GlassDrawer'
import { motion } from 'framer-motion'
import { expenseService } from '../services/expense.service'
import type {
  ApprovalPolicySummary,
  ReimbursementItem,
  UpsertReimbursementItemPayload,
} from '../services/expense.service'
import { accountingService } from '../services/accounting.service'
import type { Account } from '../types'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text } = Typography

const DEFAULT_ENTITY_ID = import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim() || 'tw-entity-001'
const ROLE_OPTIONS = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'OPERATOR', 'EMPLOYEE']
const RECEIPT_TYPES = ['TAX_INVOICE', 'RECEIPT', 'BANK_SLIP', 'INTERNAL_ONLY']

const toList = (value?: string | null) =>
  value
    ? value
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean)
    : []

const ReimbursementItemsAdminPage: React.FC = () => {
  const { user } = useAuth()
  const isAdmin = user?.roles?.some((role) => role === 'SUPER_ADMIN' || role === 'ADMIN')
  const [form] = Form.useForm()
  const [entityId, setEntityId] = useState(DEFAULT_ENTITY_ID)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [items, setItems] = useState<ReimbursementItem[]>([])
  const [policies, setPolicies] = useState<ApprovalPolicySummary[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingItem, setEditingItem] = useState<ReimbursementItem | null>(null)
  const [seeding, setSeeding] = useState(false)

  const fetchItems = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    try {
      const data = await expenseService.listReimbursementItemsAdmin({
        entityId,
        includeInactive,
      })
      setItems(data)
    } catch (error) {
      console.error(error)
      message.error('無法載入報銷項目，請稍後再試')
    } finally {
      setLoading(false)
    }
  }, [entityId, includeInactive])

  const fetchSupportingData = useCallback(async () => {
    if (!entityId) return
    try {
      const [policyList, accountList] = await Promise.all([
        expenseService.listApprovalPolicies(entityId),
        accountingService.getAccounts(entityId),
      ])
      setPolicies(policyList)
      setAccounts(accountList)
    } catch (error) {
      console.error(error)
      message.error('載入審批政策或會計科目失敗')
    }
  }, [entityId])

  useEffect(() => {
    if (!isAdmin) return
    fetchItems()
  }, [fetchItems, isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    fetchSupportingData()
  }, [fetchSupportingData, isAdmin])

  const handleDrawerClose = () => {
    setDrawerOpen(false)
    setEditingItem(null)
    form.resetFields()
  }

  const handleCreate = () => {
    setEditingItem(null)
    form.setFieldsValue({
      entityId,
      name: '',
      accountId: undefined,
      description: '',
      keywords: [],
      amountLimit: undefined,
      requiresDepartmentHead: false,
      approverRoleCodes: [],
      approvalPolicyId: undefined,
      defaultReceiptType: undefined,
      allowedRoles: [],
      allowedDepartments: [],
      allowedReceiptTypes: [],
      isActive: true,
    })
    setDrawerOpen(true)
  }

  const handleEdit = useCallback(
    (item: ReimbursementItem) => {
      setEditingItem(item)
      form.setFieldsValue({
        entityId: item.entityId,
        name: item.name,
        accountId: item.accountId,
        description: item.description ?? '',
        keywords: toList(item.keywords),
        amountLimit: item.amountLimit ? Number(item.amountLimit) : undefined,
        requiresDepartmentHead: item.requiresDepartmentHead ?? false,
        approverRoleCodes: toList(item.approverRoleCodes),
        approvalPolicyId: item.approvalPolicy?.id ?? item.approvalPolicyId ?? undefined,
        defaultReceiptType: item.defaultReceiptType ?? undefined,
        allowedRoles: toList(item.allowedRoles),
        allowedDepartments: toList(item.allowedDepartments),
        allowedReceiptTypes: toList(item.allowedReceiptTypes),
        isActive: item.isActive ?? true,
      })
      setDrawerOpen(true)
    },
    [form],
  )

  const normalizeListInput = (values?: string[]) =>
    values?.map((value) => value.trim()).filter((value) => value.length)

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const payload: UpsertReimbursementItemPayload = {
        entityId: values.entityId?.trim(),
        name: values.name.trim(),
        accountId: values.accountId,
        description: values.description?.trim() || undefined,
        keywords: normalizeListInput(values.keywords),
        amountLimit:
          typeof values.amountLimit === 'number' ? Number(values.amountLimit) : undefined,
        requiresDepartmentHead: values.requiresDepartmentHead,
        approverRoleCodes: normalizeListInput(values.approverRoleCodes),
        approvalPolicyId: values.approvalPolicyId || undefined,
        defaultReceiptType: values.defaultReceiptType || undefined,
        allowedRoles: normalizeListInput(values.allowedRoles),
        allowedDepartments: normalizeListInput(values.allowedDepartments),
        allowedReceiptTypes: normalizeListInput(values.allowedReceiptTypes),
        isActive: values.isActive,
      }

      if (editingItem) {
        await expenseService.updateReimbursementItemAdmin(editingItem.id, payload)
        message.success('報銷項目已更新')
      } else {
        await expenseService.createReimbursementItemAdmin(payload)
        message.success('報銷項目已建立')
      }
      await fetchItems()
      handleDrawerClose()
    } catch (error) {
      if ((error as any)?.errorFields) {
        return
      }
      console.error(error)
      message.error('保存失敗，請稍後再試')
    } finally {
      setSubmitting(false)
    }
  }

  const handleArchive = useCallback(
    async (item: ReimbursementItem) => {
      try {
        await expenseService.archiveReimbursementItemAdmin(item.id)
        message.success('已停用該報銷項目')
        await fetchItems()
      } catch (error) {
        console.error(error)
        message.error('停用失敗')
      }
    },
    [fetchItems],
  )
  const handleSeedAiItems = async () => {
    setSeeding(true)
    try {
      // Direct API call or add to service
      await expenseService.seedAiItems(entityId)
      message.success('已成功生成 AI 預設報銷項目')
      await fetchItems()
    } catch (error) {
      console.error(error)
      message.error('生成失敗')
    } finally {
      setSeeding(false)
    }
  }
  const columns: ColumnsType<ReimbursementItem> = useMemo(
    () => [
      {
        title: '名稱',
        dataIndex: 'name',
        render: (value, record) => (
          <Space direction="vertical" size={0}>
            <span className="font-medium">{value}</span>
            <span className="text-xs text-gray-500">{record.description}</span>
          </Space>
        ),
      },
      {
        title: '會計科目',
        dataIndex: 'accountId',
        render: (_, record) => (
          <div>
            <div>{record.account?.name ?? '—'}</div>
            <span className="text-xs text-gray-500">{record.account?.code}</span>
          </div>
        ),
      },
      {
        title: '審批政策',
        dataIndex: 'approvalPolicyId',
        render: (_, record) => (
          <div>
            {record.approvalPolicy?.id ? (
              <Tag color="processing">{record.approvalPolicy?.id}</Tag>
            ) : (
              <Tag>未綁定</Tag>
            )}
            {record.requiresDepartmentHead && <Tag color="purple">需部門主管</Tag>}
          </div>
        ),
      },
      {
        title: '關鍵字',
        dataIndex: 'keywords',
        render: (value) =>
          value ? (
            <Space size={[0, 4]} wrap>
              {toList(value).map((keyword) => (
                <Tag key={keyword}>{keyword}</Tag>
              ))}
            </Space>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
      {
        title: '限制',
        dataIndex: 'amountLimit',
        render: (_, record) => (
          <Space direction="vertical" size={0}>
            <span>
              金額上限：{record.amountLimit ? Number(record.amountLimit).toLocaleString() : '無'}
            </span>
            <span className="text-xs text-gray-500">
              允許角色：{record.allowedRoles ? toList(record.allowedRoles).join(', ') : '未限制'}
            </span>
          </Space>
        ),
      },
      {
        title: '狀態',
        dataIndex: 'isActive',
        render: (value) => (
          <Tag color={value ? 'green' : 'red'}>{value ? '啟用' : '停用'}</Tag>
        ),
      },
      {
        title: '操作',
        key: 'actions',
        render: (_, record) => (
          <Space>
            <Tooltip title="編輯">
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              />
            </Tooltip>
            {record.isActive && (
              <Tooltip title="停用">
                <Button
                  type="text"
                  danger
                  icon={<StopOutlined />}
                  onClick={() => handleArchive(record)}
                />
              </Tooltip>
            )}
          </Space>
        ),
      },
    ],
    [handleEdit, handleArchive],
  )

  if (!isAdmin) {
    return (
      <Card className="glass-card">
        <Alert
          message="權限不足"
          description="此頁面僅限系統管理員或超級管理員存取。"
          type="error"
          showIcon
        />
      </Card>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <div className="flex justify-between items-end">
        <div>
          <Title level={2} className="!mb-1 !font-light">報銷項目管理</Title>
          <Text className="text-gray-500">設定費用報銷項目、審核政策與會計科目對應</Text>
        </div>
        <Space>
          <Button icon={<RobotOutlined />} onClick={handleSeedAiItems} loading={seeding}>
            AI 生成預設庫
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchItems}>
            重新整理
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增報銷項目
          </Button>
        </Space>
      </div>

      <Card className="glass-card" bordered={false}>
        <Form layout="inline" className="mb-6">
          <Form.Item label="實體 ID">
            <Input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="輸入實體 ID"
            />
          </Form.Item>
          <Form.Item label="顯示停用">
            <Switch checked={includeInactive} onChange={setIncludeInactive} />
          </Form.Item>
        </Form>

        <Table<ReimbursementItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns}
          locale={{ emptyText: <Empty description="尚無資料" /> }}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1000 }}
        />
      </Card>

      <GlassDrawer
        title={editingItem ? '編輯報銷項目' : '新增報銷項目'}
        placement="right"
        width={420}
        onClose={handleDrawerClose}
        open={drawerOpen}
        destroyOnClose
      >
        <Form layout="vertical" form={form} preserve={false} className="h-full flex flex-col">
          <div className="flex-1 space-y-4">
            <GlassDrawerSection>
              <Form.Item
                label="實體 ID"
                name="entityId"
                rules={[{ required: true, message: '請輸入實體 ID' }]}
              >
                <Input placeholder="例如：tw-entity-001" />
              </Form.Item>

              <Form.Item
                label="報銷項目名稱"
                name="name"
                rules={[{ required: true, message: '請輸入名稱' }]}
              >
                <Input maxLength={80} />
              </Form.Item>

              <Form.Item
                label="對應會計科目"
                name="accountId"
                rules={[{ required: true, message: '請選擇會計科目' }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="選擇會計科目"
                  options={accounts.map((account) => ({
                    label: `${account.code} ｜ ${account.name}`,
                    value: account.id,
                  }))}
                />
              </Form.Item>

              <Form.Item label="描述" name="description">
                <Input.TextArea rows={2} maxLength={200} placeholder="可選" />
              </Form.Item>

              <Form.Item label="關鍵字" name="keywords">
                <Select mode="tags" tokenSeparators={[',']} placeholder="輸入後按 Enter 新增" />
              </Form.Item>

              <Form.Item label="金額上限 (TWD)" name="amountLimit">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="留空則不限" />
              </Form.Item>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">稅務與憑證</div>
              <Form.Item
                label="預設稅別"
                name="defaultTaxType"
              >
                <Select allowClear options={[
                  { label: '應稅 5% (V5)', value: 'TAXABLE_5_PERCENT' },
                  { label: '不可扣抵 5% (VND)', value: 'NON_DEDUCTIBLE_5_PERCENT' },
                  { label: '零稅率 (Z0)', value: 'ZERO_RATED' },
                  { label: '免稅 (F0)', value: 'TAX_FREE' },
                ]} />
              </Form.Item>

              <Form.Item
                label="預設憑證類型"
                name="defaultReceiptType"
              >
                <Select allowClear options={RECEIPT_TYPES.map((type) => ({ label: type, value: type }))} />
              </Form.Item>

              <Form.Item label="允許的憑證類型" name="allowedReceiptTypes">
                <Select
                  mode="multiple"
                  allowClear
                  options={RECEIPT_TYPES.map((type) => ({ label: type, value: type }))}
                />
              </Form.Item>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">審批設定</div>
              <Form.Item label="需要部門主管核准" name="requiresDepartmentHead" valuePropName="checked">
                <Switch />
              </Form.Item>

              <Form.Item label="審批角色代碼" name="approverRoleCodes">
                <Select
                  mode="multiple"
                  allowClear
                  options={ROLE_OPTIONS.map((role) => ({ label: role, value: role }))}
                />
              </Form.Item>

              <Form.Item label="綁定審批政策" name="approvalPolicyId">
                <Select
                  allowClear
                  placeholder="選擇審批政策"
                  options={policies.map((policy) => ({ label: policy.name, value: policy.id }))}
                />
              </Form.Item>
            </GlassDrawerSection>

            <GlassDrawerSection>
              <div className="mb-4 font-semibold text-slate-800">權限與狀態</div>
              <Form.Item label="允許的角色" name="allowedRoles">
                <Select
                  mode="multiple"
                  allowClear
                  options={ROLE_OPTIONS.map((role) => ({ label: role, value: role }))}
                />
              </Form.Item>

              <Form.Item label="允許的部門 ID" name="allowedDepartments">
                <Select mode="tags" tokenSeparators={[',']} placeholder="輸入部門 ID" />
              </Form.Item>

              <Form.Item label="啟用" name="isActive" valuePropName="checked">
                <Switch />
              </Form.Item>
            </GlassDrawerSection>
          </div>

          <GlassDrawerSection>
            <div className="flex justify-end gap-2">
              <Button onClick={handleDrawerClose} className="rounded-full">取消</Button>
              <Button type="primary" loading={submitting} onClick={handleSubmit} className="rounded-full bg-blue-600 hover:bg-blue-500 border-none shadow-lg shadow-blue-200">
                儲存
              </Button>
            </div>
          </GlassDrawerSection>
        </Form>
      </GlassDrawer>
    </motion.div>
  )
}

export default ReimbursementItemsAdminPage
