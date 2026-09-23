import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { useAuth } from '../contexts/AuthContext'
import { useEntityContext } from '../hooks/useEntityContext'
import { hasAnyPermission } from '../utils/access'
import { purchaseService } from '../services/purchase.service'
import type { B2BProcurementSummary, B2BShortageRequest, PurchaseOrderOptions } from '../services/purchase.service'

const { Title, Text } = Typography
type ProcurementForm = {
  vendorId: string
  orderDate: string
  currency: string
  fxRate: number
  items: Array<{ qty: number; unitCost: number }>
}

function errorText(error: unknown): string {
  const value = error as { response?: { data?: { message?: string } }; message?: string }
  return value?.response?.data?.message || value?.message || '操作失敗，請稍後重試。'
}

/** Purchasing sees only reviewed shortage lines; sales pricing and customer credentials stay in Sales. */
export default function B2bProcurementPage() {
  const entityId = useEntityContext()
  const { user } = useAuth()
  const [rows, setRows] = useState<B2BShortageRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<B2BShortageRequest | null>(null)
  const [summary, setSummary] = useState<B2BProcurementSummary | null>(null)
  const [options, setOptions] = useState<PurchaseOrderOptions | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<ProcurementForm>()
  const currency = Form.useWatch('currency', form)
  const requestKeys = useRef<Record<string, string>>({})
  const detailId = useRef('')
  const loadSequence = useRef(0)

  const load = async () => {
    const sequence = ++loadSequence.current
    if (!entityId) { setError('請先選擇事業別。'); setRows([]); return }
    setLoading(true)
    setError('')
    try {
      const result = await purchaseService.b2bShortages(entityId)
      if (sequence === loadSequence.current) setRows(result)
    } catch (reason) {
      if (sequence === loadSequence.current) setError(errorText(reason))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => { loadSequence.current += 1 }
    // The queue is explicitly refreshed after a PO is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  const close = () => {
    detailId.current = ''
    setSelected(null)
    setSummary(null)
    setOptions(null)
    form.resetFields()
  }

  const open = async (request: B2BShortageRequest) => {
    if (!entityId) return
    detailId.current = request.id
    setSelected(request)
    setSummary(null)
    setOptions(null)
    setDetailLoading(true)
    form.resetFields()
    requestKeys.current[request.id] ||= crypto.randomUUID()
    try {
      const [nextSummary, nextOptions] = await Promise.all([
        purchaseService.procurementForB2BRequest(request.id, entityId),
        purchaseService.options(entityId),
      ])
      if (detailId.current !== request.id) return
      setSummary(nextSummary)
      setOptions(nextOptions)
      form.setFieldsValue({
        orderDate: dayjs().format('YYYY-MM-DD'),
        currency: 'TWD',
        fxRate: 1,
        items: nextSummary.items.filter((item) => item.shortage > item.ordered).map((item) => ({
          qty: item.shortage - item.ordered,
          unitCost: 0,
        })),
      })
    } catch (reason) {
      if (detailId.current === request.id) message.error(errorText(reason))
    } finally {
      if (detailId.current === request.id) setDetailLoading(false)
    }
  }

  const save = async () => {
    if (!entityId || !selected || !summary || saving) return
    try {
      const values = await form.validateFields()
      const available = summary.items.filter((item) => item.shortage > item.ordered)
      const items = available.map((line, index) => ({
        requestItemId: line.requestItemId,
        qty: values.items[index]?.qty,
        unitCost: values.items[index]?.unitCost,
      })).filter((item) => item.qty > 0)
      if (!items.length || items.some((item) => {
        const line = available.find((candidate) => candidate.requestItemId === item.requestItemId)
        return !Number.isSafeInteger(item.qty) || !line || item.qty > line.shortage - line.ordered || !Number.isFinite(item.unitCost) || item.unitCost <= 0
      })) {
        message.error('請填至少一項未採購的缺口數量與有效原幣單價。')
        return
      }
      setSaving(true)
      await purchaseService.createFromB2BRequest({
        requestId: selected.id,
        requestKey: requestKeys.current[selected.id],
        vendorId: values.vendorId,
        orderDate: values.orderDate,
        currency: values.currency,
        fxRate: values.currency === 'TWD' ? 1 : values.fxRate,
        items,
      }, entityId)
      delete requestKeys.current[selected.id]
      close()
      message.success('已建立來源關聯採購單。收貨入庫後請由業務重新人工核庫。')
      await load()
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'errorFields' in reason)) {
        message.error(`${errorText(reason)} 若建單結果不明，請保留畫面並重試相同內容；系統會以同一請求鍵避免重複建單。`)
      }
    } finally { setSaving(false) }
  }

  const columns: ColumnsType<B2BShortageRequest> = [
    { title: '需求編號', dataIndex: 'requestNumber', key: 'requestNumber' },
    { title: '建立時間', dataIndex: 'createdAt', key: 'createdAt', render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm') },
    { title: '缺貨品項', key: 'items', render: (_, row) => row.items.map((item) => `${item.sku} × ${item.shortage}`).join('、') },
    { title: '操作', key: 'actions', render: (_, row) => <Button size="small" type="primary" onClick={() => void open(row)}>檢視並建立採購單</Button> },
  ]

  const available = summary?.items.filter((item) => item.shortage > item.ordered) || []
  return <div className="page-section-stack" style={{ maxWidth: 1300, margin: '0 auto', padding: '10px 4px 50px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
      <div><Title level={2} style={{ marginBottom: 4 }}>客戶缺貨採購</Title><Text type="secondary">將已人工核庫的缺口轉成來源關聯的供應商採購單。</Text></div>
      <Button loading={loading} onClick={() => void load()}>重新整理</Button>
    </div>
    <Alert type="info" showIcon message="建立採購單不會自動入庫，也不會替客戶確認供貨。收貨後由業務重新核庫並出具正式報價。" />
    {error ? <Alert type="error" showIcon message={error} /> : null}
    <Card><Table rowKey="id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 780 }} expandable={{ expandedRowRender: (row) => row.items.map((item) => <div key={item.requestItemId}>{item.sku} · {item.name}：申購 {item.requested}、人工確認 {item.confirmed}、缺口 {item.shortage}</div>) }} /></Card>

    <Modal title={`建立缺貨採購單 · ${selected?.requestNumber || ''}`} open={Boolean(selected)} width={850} confirmLoading={saving} onCancel={close} onOk={() => void save()} okText="建立來源關聯採購單" okButtonProps={{ disabled: detailLoading || !available.length || !options?.vendors.length }} destroyOnHidden>
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="採購數量不得超過尚未開單的缺口；供應商與成本由採購人員確認。" />
      {detailLoading ? <Text>正在載入缺口與供應商…</Text> : null}
      {!detailLoading && !summary ? <Alert type="error" message="無法取得採購缺口，請關閉後重試。" /> : null}
      {summary ? <>
        <Table size="small" pagination={false} rowKey="requestItemId" dataSource={summary.items} columns={[
          { title: '商品', key: 'product', render: (_, line) => { const item = selected?.items.find((entry) => entry.requestItemId === line.requestItemId); return item ? `${item.sku} · ${item.name}` : line.requestItemId } },
          { title: '申購', dataIndex: 'requested', key: 'requested' },
          { title: '人工確認', dataIndex: 'confirmed', key: 'confirmed' },
          { title: '缺口', dataIndex: 'shortage', key: 'shortage' },
          { title: '已開採購', dataIndex: 'ordered', key: 'ordered' },
          { title: '尚可採購', key: 'remaining', render: (_, line) => Math.max(0, line.shortage - line.ordered) },
        ]} scroll={{ x: 650 }} />
        {summary.purchaseOrders.length ? <div style={{ marginTop: 14 }}><Text strong>已關聯採購單</Text>{summary.purchaseOrders.map((order) => <div key={order.id}>{order.id.slice(0, 8)} · {order.vendorName} · {order.status} · {dayjs(order.createdAt).format('YYYY-MM-DD')}</div>)}</div> : null}
        {available.length ? <Form form={form} layout="vertical" style={{ marginTop: 20 }}>
          <Space wrap style={{ width: '100%' }}>
            <Form.Item name="vendorId" label="供應商" rules={[{ required: true, message: '請選擇供應商' }]}><Select style={{ width: 220 }} showSearch optionFilterProp="label" options={options?.vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))} /></Form.Item>
            <Form.Item name="orderDate" label="採購日期" rules={[{ required: true, message: '請填採購日期' }]}><Input type="date" /></Form.Item>
            <Form.Item name="currency" label="幣別" rules={[{ required: true, message: '請選擇幣別' }]}><Select style={{ width: 100 }} options={['TWD', 'CNY', 'USD', 'HKD', 'JPY', 'EUR'].map((value) => ({ value, label: value }))} onChange={(value) => form.setFieldValue('fxRate', value === 'TWD' ? 1 : undefined)} /></Form.Item>
            <Form.Item name="fxRate" label="原幣換算本位幣匯率" rules={[{ required: true, message: '請填匯率' }, { type: 'number', min: 0.000001, message: '匯率須大於 0' }]}><InputNumber min={0.000001} precision={6} disabled={currency === 'TWD'} /></Form.Item>
          </Space>
          {available.map((line, index) => {
            const item = selected?.items.find((entry) => entry.requestItemId === line.requestItemId)
            return <div key={line.requestItemId} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'center' }}>
              <Text>{item ? `${item.sku} · ${item.name}` : line.requestItemId}<br /><Text type="secondary">最多 {line.shortage - line.ordered} 件</Text></Text>
              <Form.Item name={['items', index, 'qty']} label="採購數量" rules={[{ required: true, message: '請填數量' }, { type: 'integer', min: 0, max: line.shortage - line.ordered, message: '不可超過尚可採購數量' }]}><InputNumber min={0} max={line.shortage - line.ordered} precision={0} style={{ width: '100%' }} /></Form.Item>
              <Form.Item name={['items', index, 'unitCost']} label="原幣單價" rules={[{ required: true, message: '請填單價，未採購可填 0' }, { type: 'number', min: 0, message: '單價不可為負數' }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item>
            </div>
          })}
        </Form> : <Alert type="info" style={{ marginTop: 16 }} message="全部缺口已有關聯採購單。待完成收貨後由業務重新人工核庫。" />}
        {hasAnyPermission(user, ['purchase_orders:read']) ? <div style={{ marginTop: 12 }}><Link to="/purchasing/orders">前往採購單列表</Link></div> : null}
      </> : null}
    </Modal>
  </div>
}
