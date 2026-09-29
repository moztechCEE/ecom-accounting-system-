import { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { b2bAdminService } from '../../services/b2b-admin.service'
import type { B2BCustomerDiscount, B2BCustomerDiscountPreviewLine } from '../../services/b2b-admin.service'
import CustomerSearchSelect from '../../components/CustomerSearchSelect'
import ProductSearchSelect from './ProductSearchSelect'

const { Text } = Typography
const pageSize = 20
const errorText = (error: unknown) => {
  const value = error as { response?: { data?: { message?: string } }; message?: string }
  return value?.response?.data?.message || value?.message || '操作失敗，請稍後重試。'
}
const localTime = (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm')
const amount = (value: string | null) => value == null ? '—' : `NT$ ${Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`

type DiscountValues = {
  customerId: string
  percent: number
  basePriceType: B2BCustomerDiscount['basePriceType']
  validFrom: string
  validUntil?: string
  isActive: boolean
}
type PreviewValues = { productId: string; quantity: number }

export default function CustomerDiscountManager({ entityId, canWrite, customers }: {
  entityId: string
  canWrite: boolean
  customers: Array<{ id: string; name: string; companyName: string }>
}) {
  const [rows, setRows] = useState<B2BCustomerDiscount[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<B2BCustomerDiscount | 'new' | null>(null)
  const [previewCustomer, setPreviewCustomer] = useState<B2BCustomerDiscount | null>(null)
  const [previewResult, setPreviewResult] = useState<B2BCustomerDiscountPreviewLine | null>(null)
  const [discountForm] = Form.useForm<DiscountValues>()
  const [previewForm] = Form.useForm<PreviewValues>()
  const percent = Form.useWatch('percent', discountForm)
  const previewProductId = Form.useWatch('productId', previewForm)

  const reload = async () => {
    if (!entityId) return
    setLoading(true)
    setError('')
    try {
      const result = await b2bAdminService.customerDiscounts(entityId, { search, limit: pageSize, offset: (page - 1) * pageSize })
      setRows(result.rows)
      setTotal(result.total)
    }
    catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!entityId) return
    let active = true
    b2bAdminService.customerDiscounts(entityId, { search, limit: pageSize, offset: (page - 1) * pageSize })
      .then((result) => { if (active) { setRows(result.rows); setTotal(result.total) } })
      .catch((reason) => { if (active) setError(errorText(reason)) })
    return () => { active = false }
  }, [entityId, page, search])

  const customerName = (id: string) => customers.find((item) => item.id === id)?.companyName || customers.find((item) => item.id === id)?.name || id
  const openEdit = (rule?: B2BCustomerDiscount) => {
    discountForm.resetFields()
    discountForm.setFieldsValue(rule ? {
      customerId: rule.customerId,
      percent: Number(rule.multiplier) * 100,
      basePriceType: rule.basePriceType,
      validFrom: dayjs(rule.validFrom).format('YYYY-MM-DDTHH:mm'),
      validUntil: rule.validUntil ? dayjs(rule.validUntil).format('YYYY-MM-DDTHH:mm') : undefined,
      isActive: rule.isActive,
    } : { percent: 55, basePriceType: 'MSRP', validFrom: dayjs().format('YYYY-MM-DDTHH:mm'), isActive: true })
    setEditing(rule || 'new')
  }

  const save = async () => {
    try {
      const values = await discountForm.validateFields()
      if (!Number.isFinite(values.percent) || values.percent <= 0 || values.percent > 100 || Math.round(values.percent * 100) !== values.percent * 100) throw new Error('成交比例須大於 0%、不超過 100%，最多小數兩位。')
      if (!dayjs(values.validFrom).isValid() || (values.validUntil && (!dayjs(values.validUntil).isValid() || !dayjs(values.validUntil).isAfter(dayjs(values.validFrom))))) throw new Error('有效期限必須晚於生效時間。')
      setSaving(true)
      await b2bAdminService.saveCustomerDiscount(values.customerId, {
        entityId,
        multiplier: values.percent / 100,
        basePriceType: values.basePriceType,
        validFrom: dayjs(values.validFrom).toISOString(),
        validUntil: values.validUntil ? dayjs(values.validUntil).toISOString() : null,
        isActive: values.isActive,
      })
      setEditing(null)
      message.success('客戶常用成交比例已儲存')
      await reload()
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'errorFields' in reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const preview = async () => {
    if (!previewCustomer) return
    try {
      const values = await previewForm.validateFields()
      setSaving(true)
      const result = await b2bAdminService.previewCustomerDiscount(previewCustomer.customerId, {
        entityId,
        items: [{ productId: values.productId, quantity: values.quantity }],
      })
      setPreviewResult(result.items[0] || null)
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'errorFields' in reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const columns: ColumnsType<B2BCustomerDiscount> = [
    { title: '客戶', key: 'customer', render: (_, row) => row.customerName || customerName(row.customerId) },
    { title: '價格基準', dataIndex: 'basePriceType', key: 'base', render: (value: string) => value === 'MSRP' ? '建議售價' : '常態售價' },
    { title: '成交比例', dataIndex: 'multiplier', key: 'multiplier', render: (value: string) => `${Number(value) * 100}%` },
    { title: '生效期間', key: 'validity', render: (_, row) => `${localTime(row.validFrom)} ～ ${row.validUntil ? localTime(row.validUntil) : '未設截止'}` },
    { title: '狀態', dataIndex: 'isActive', key: 'active', render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '啟用' : '停用'}</Tag> },
    { title: '操作', key: 'actions', render: (_, row) => <Space>{canWrite ? <Button size="small" onClick={() => openEdit(row)}>編輯</Button> : null}<Button size="small" onClick={() => { previewForm.resetFields(); setPreviewResult(null); setPreviewCustomer(row) }}>試算</Button></Space> },
  ]

  return <>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="為客戶設定長期使用的成交比例，例如建議售價 × 50% 或 × 55%。" description="單一 SKU 的固定價格例外仍在下方「客戶專屬價格」設定，試算時會優先採用。業務可將試算結果帶入本次報價後再編修；修改規則不會改動已出具的報價。" />
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}><Input.Search placeholder="搜尋客戶名稱或編號" allowClear style={{ width: 280 }} onSearch={(value) => { setPage(1); setSearch(value.trim()) }} /><Space><Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>重新整理</Button>{canWrite ? <Button icon={<PlusOutlined />} type="primary" onClick={() => openEdit()}>設定客戶成交比例</Button> : null}</Space></div>
    {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
    <Table rowKey="customerId" dataSource={rows} columns={columns} loading={loading} scroll={{ x: 820 }} pagination={{ current: page, pageSize, total, showSizeChanger: false, onChange: setPage, showTotal: (count) => `共 ${count} 位客戶已設定` }} />

    <Modal title="客戶常用成交比例" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void save()} okText="儲存未來價格規則" confirmLoading={saving} destroyOnHidden>
      <Form form={discountForm} layout="vertical">
        {editing === 'new'
          ? <Form.Item name="customerId" label="客戶" rules={[{ required: true, message: '請選擇客戶' }]}><CustomerSearchSelect entityId={entityId} enabled /></Form.Item>
          : <><Form.Item name="customerId" hidden><Input /></Form.Item><div style={{ marginBottom: 18 }}><Text type="secondary">客戶</Text><br /><Text strong>{editing ? editing.customerName || customerName(editing.customerId) : ''}</Text></div></>}
        <Form.Item name="basePriceType" label="以哪種價格為基準" rules={[{ required: true }]}><Select options={[{ value: 'MSRP', label: '建議售價' }, { value: 'REGULAR', label: '常態售價' }]} /></Form.Item>
        <Form.Item name="percent" label="成交比例（%）" rules={[{ required: true, message: '請填成交比例' }, { type: 'number', min: 0.01, max: 100, message: '請填 0.01～100' }]}><InputNumber min={0.01} max={100} precision={2} addonAfter="%" style={{ width: '100%' }} /></Form.Item>
        <Space><Button size="small" onClick={() => discountForm.setFieldValue('percent', 50)}>50%（5 折）</Button><Button size="small" onClick={() => discountForm.setFieldValue('percent', 55)}>55%（5.5 折）</Button></Space>
        <div style={{ margin: '10px 0 18px' }}><Text type="secondary">例：價格 NT$ 1,000 × {Number(percent || 0)}% = NT$ {(1000 * Number(percent || 0) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}。實際正式報價另由業務確認。</Text></div>
        <Form.Item name="validFrom" label="生效時間" rules={[{ required: true, message: '請填生效時間' }]}><Input type="datetime-local" /></Form.Item>
        <Form.Item name="validUntil" label="截止時間（選填）"><Input type="datetime-local" /></Form.Item>
        <Form.Item name="isActive" label="啟用規則" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>

    <Modal title={`客戶價格試算 · ${previewCustomer ? previewCustomer.customerName || customerName(previewCustomer.customerId) : ''}`} open={Boolean(previewCustomer)} onCancel={() => { setPreviewCustomer(null); setPreviewResult(null) }} footer={<Button onClick={() => setPreviewCustomer(null)}>關閉</Button>} destroyOnHidden>
      <Form form={previewForm} layout="vertical" onFinish={() => void preview()}>
        <Form.Item name="productId" label="商品" rules={[{ required: true, message: '請選擇商品' }]}><ProductSearchSelect entityId={entityId} enabled={Boolean(previewCustomer)} selectedProduct={undefined} /></Form.Item>
        <Form.Item name="quantity" label="數量" rules={[{ required: true, message: '請填數量' }, { type: 'integer', min: 1, max: 100000 }]}><InputNumber min={1} max={100000} precision={0} style={{ width: '100%' }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} disabled={!previewProductId}>試算價格</Button>
      </Form>
      {previewResult ? <Alert style={{ marginTop: 16 }} showIcon type={previewResult.eligible && previewResult.quoteUnitPrice != null ? 'success' : 'warning'} message={previewResult.quoteUnitPrice != null ? `建議本次未稅報價單價 ${amount(previewResult.quoteUnitPrice)}` : '目前不可直接帶入正式報價'} description={<div>來源：{previewResult.source === 'FIXED_OVERRIDE' ? 'SKU 固定價' : previewResult.source === 'CUSTOMER_DISCOUNT' ? '客戶成交比例' : '未命中'}；基準價 {amount(previewResult.baseUnitPrice)} × {previewResult.multiplier == null ? '—' : `${Number(previewResult.multiplier) * 100}%`}；選定價格 {amount(previewResult.selectedUnitPrice)}（{previewResult.taxBasis === 'TAX_INCLUDED' ? '含稅' : previewResult.taxBasis === 'TAX_EXCLUDED' ? '未稅' : '稅別未設定'}）。{previewResult.reason ? `原因：${previewResult.reason}` : ''}</div>} /> : null}
    </Modal>
  </>
}
