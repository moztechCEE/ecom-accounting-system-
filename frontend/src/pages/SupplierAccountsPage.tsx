import { useEffect, useState } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useEntityContext } from '../hooks/useEntityContext'
import { hasAnyPermission } from '../utils/access'
import { b2bSupplierAdminService } from '../services/b2b-supplier-admin.service'
import type { SupplierAccount, SupplierAccountSetup } from '../services/b2b-supplier-admin.service'

const { Title, Text } = Typography
type CreateValues = { vendorId: string; email: string; name: string; password: string }
const passwordRules = [
  { required: true, message: '請輸入密碼' },
  { validator: (_: unknown, value?: string) => value && value.length >= 12 && new TextEncoder().encode(value).length <= 72
    ? Promise.resolve() : Promise.reject(new Error('密碼至少 12 字元，且 UTF-8 不可超過 72 bytes')) },
]

function errorText(error: unknown): string {
  const value = error as { response?: { data?: { message?: string } }; message?: string }
  return value?.response?.data?.message || value?.message || '操作失敗，請稍後重試。'
}

export default function SupplierAccountsPage() {
  const entityId = useEntityContext()
  const { user } = useAuth()
  const canWrite = hasAnyPermission(user, ['purchase_orders:create'])
  const [setup, setSetup] = useState<SupplierAccountSetup | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [resetAccount, setResetAccount] = useState<SupplierAccount | null>(null)
  const [createForm] = Form.useForm<CreateValues>()
  const [resetForm] = Form.useForm<{ password: string }>()

  const load = async () => {
    if (!entityId) { setError('請先選擇事業別。'); setSetup(null); return }
    setLoading(true)
    setError('')
    try { setSetup(await b2bSupplierAdminService.list(entityId)) }
    catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    setSetup(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  const create = async () => {
    if (!entityId || !canWrite || saving) return
    try {
      const values = await createForm.validateFields()
      setSaving(true)
      await b2bSupplierAdminService.create({
        entityId,
        vendorId: values.vendorId,
        email: values.email.trim().toLowerCase(),
        name: values.name.trim(),
        password: values.password,
      })
      createForm.resetFields()
      setCreateOpen(false)
      message.success('供應商帳號已建立。請透過既有安全流程交付初始密碼。')
      await load()
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'errorFields' in reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const toggle = async (account: SupplierAccount) => {
    if (!entityId || !canWrite) return
    try {
      setSaving(true)
      await b2bSupplierAdminService.update(account.id, { entityId, isActive: !account.isActive })
      message.success(account.isActive ? '供應商帳號已停用。' : '供應商帳號已啟用。')
      await load()
    } catch (reason) { message.error(errorText(reason)) }
    finally { setSaving(false) }
  }

  const resetPassword = async () => {
    if (!entityId || !canWrite || !resetAccount || saving) return
    try {
      const values = await resetForm.validateFields()
      setSaving(true)
      await b2bSupplierAdminService.update(resetAccount.id, { entityId, isActive: resetAccount.isActive, password: values.password })
      resetForm.resetFields()
      setResetAccount(null)
      message.success('新密碼已設定，舊登入憑證已撤銷。')
      await load()
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'errorFields' in reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const columns: ColumnsType<SupplierAccount> = [
    { title: '供應商', dataIndex: 'vendorName', key: 'vendor' },
    { title: '使用者姓名', dataIndex: 'name', key: 'name' },
    { title: '登入 Email', dataIndex: 'email', key: 'email' },
    { title: '狀態', dataIndex: 'isActive', key: 'isActive', render: (active: boolean) => <Tag color={active ? 'green' : 'default'}>{active ? '啟用' : '停用'}</Tag> },
    { title: '操作', key: 'actions', render: (_, account) => canWrite ? <Space>
      <Popconfirm title={account.isActive ? '停用這個供應商帳號？' : '重新啟用這個供應商帳號？'} onConfirm={() => void toggle(account)}><Button size="small" disabled={saving}>{account.isActive ? '停用' : '啟用'}</Button></Popconfirm>
      <Button size="small" disabled={saving} onClick={() => { resetForm.resetFields(); setResetAccount(account) }}>設定新密碼</Button>
    </Space> : null },
  ]

  return <div className="page-section-stack" style={{ maxWidth: 1300, margin: '0 auto', padding: '10px 4px 50px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
      <div><Title level={2} style={{ marginBottom: 4 }}>供應商帳號</Title><Text type="secondary">由採購人員建立、停用與重設供應商聯絡帳號。</Text></div>
      <Space>{canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true) }}>建立供應商帳號</Button> : null}<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>重新整理</Button></Space>
    </div>
    <Alert type="info" showIcon message="供應商採購單查看入口尚未開放。此處先管理帳號資料；帳號不能登入客戶採購前台。" />
    {error ? <Alert type="error" showIcon message={error} /> : null}
    <Card><Table rowKey="id" columns={columns} dataSource={setup?.accounts || []} loading={loading} scroll={{ x: 750 }} /></Card>

    <Modal title="建立供應商帳號" open={createOpen} confirmLoading={saving} onCancel={() => { setCreateOpen(false); createForm.resetFields() }} onOk={() => void create()} okText="建立帳號" destroyOnHidden>
      <Form form={createForm} layout="vertical" autoComplete="off">
        <Form.Item name="vendorId" label="供應商" rules={[{ required: true, message: '請選擇供應商' }]}><Select showSearch optionFilterProp="label" options={setup?.vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))} /></Form.Item>
        <Form.Item name="name" label="使用者姓名" rules={[{ required: true, message: '請填寫姓名' }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="email" label="登入 Email" rules={[{ required: true, type: 'email', message: '請填寫有效 Email' }]}><Input autoComplete="off" /></Form.Item>
        <Form.Item name="password" label="初始密碼" rules={passwordRules}><Input.Password autoComplete="new-password" /></Form.Item>
      </Form>
      <Text type="secondary">建立後不會保存或再次顯示明文密碼。</Text>
    </Modal>

    <Modal title={`設定新密碼 · ${resetAccount?.name || ''}`} open={Boolean(resetAccount)} confirmLoading={saving} onCancel={() => { setResetAccount(null); resetForm.resetFields() }} onOk={() => void resetPassword()} okText="更新密碼" destroyOnHidden>
      <Form form={resetForm} layout="vertical" autoComplete="off"><Form.Item name="password" label="新密碼" rules={passwordRules}><Input.Password autoComplete="new-password" /></Form.Item></Form>
      <Alert type="info" message="更新密碼後，原有登入憑證立即失效。" />
    </Modal>
  </div>
}
