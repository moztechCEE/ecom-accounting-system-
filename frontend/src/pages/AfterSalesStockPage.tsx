import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hasAnyPermission } from '../utils/access'
import { repairStockService } from '../services/repair-stock'
import type { ReplacementUnit, RepairStockCatalog, StockQualification } from '../services/repair-stock'
import { useRepairNavigationGuard } from './repair/repair-navigation'
const confirmDiscard = () => new Promise<boolean>(resolve => Modal.confirm({ title: '合格庫存表單尚未儲存', content: '請先登錄或確認放棄表單。既有預留不會因離開頁面而取消。', okText: '放棄表單', cancelText: '保留表單', maskClosable: false, onOk: () => resolve(true), onCancel: () => resolve(false) }))
export default function AfterSalesStockPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const entityId = params.get('entityId') || localStorage.getItem('entityId') || ''
  const canRead = hasAnyPermission(user, ['inventory:read', 'after_sales_stock:read'])
  const canWrite = hasAnyPermission(user, ['inventory:update', 'after_sales_stock:update'])
  const [rows, setRows] = useState<ReplacementUnit[]>([]), [catalog, setCatalog] = useState<RepairStockCatalog>(), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const [form] = Form.useForm<Omit<StockQualification, 'entityId'>>()
  const dirty = useRef(false), generation = useRef(0)
  useRepairNavigationGuard(dirty, confirmDiscard)
  const productId = Form.useWatch('productId', form), warehouseId = Form.useWatch('warehouseId', form), kind = Form.useWatch('kind', form)
  const load = useCallback(async () => {
    if (!entityId || !canRead) return
    const current = ++generation.current; setLoading(true)
    try { const units = await repairStockService.units(entityId); if (current === generation.current) { setRows(units); setFailure('') } }
    catch { if (current === generation.current) setFailure('無法讀取售後庫存，請確認公司範圍及庫存讀取權限') }
    if (canWrite) {
      try { const options = await repairStockService.catalog(entityId); if (current === generation.current) setCatalog(options) }
      catch { if (current === generation.current) { setCatalog(undefined); setFailure('已讀取列表，但無法載入合格登錄選項；請核對公司與庫存管理權限') } }
    } else setCatalog(undefined)
    if (current === generation.current) setLoading(false)
  }, [entityId, canRead, canWrite])
  useEffect(() => { setRows([]); setCatalog(undefined); void load(); const current = generation; return () => { current.current++ } }, [load])
  useEffect(() => { form.resetFields(); dirty.current = false }, [entityId, form])
  const submit = async (values: Omit<StockQualification, 'entityId'>) => {
    if (!canWrite || busy) return
    setBusy(true)
    try {
      const input = { ...values, entityId, ...(values.kind === 'NEW' ? { sourceItemId: undefined } : {}) }
      await repairStockService.qualify(input); dirty.current = false; form.resetFields(); message.success('已登錄合格商品；庫存數量維持原正式入庫紀錄'); await load()
    } catch { message.error('商品未能登錄，請核對正式入庫、所有權、來源退貨品及合格依據') } finally { setBusy(false) }
  }
  const release = async (id: string) => {
    if (!canWrite || busy) return
    setBusy(true)
    try { await repairStockService.release(entityId, id); await load(); message.success('未使用的預留已釋放') }
    catch { message.error('無法釋放，請核對案件及庫存狀態；已出庫不能在此回補') } finally { setBusy(false) }
  }
  if (!entityId) return <Alert type="warning" message="請先選擇作業公司" />
  if (!canRead) return <Alert type="warning" message="沒有售後庫存讀取權限" />
  return <Space direction="vertical" style={{ width: '100%' }}>
    <h2>售後替換與整新品庫存</h2>
    <Alert type="info" showIcon message="合格實物 → 案件預留 → 正式使用" description="只登錄已正式入庫且有合格檢驗與所有權依據的商品。預留、取消釋放及正式出庫保留不同流水；外部庫存回執另外追蹤。" />
    {failure && <Alert type="error" message={failure} />}
    <Button loading={loading} disabled={busy} onClick={() => void load()}>更新合格庫存</Button>
    {!canWrite && <Alert type="info" message="目前為唯讀，登錄與取消預留另需庫存更新權限" />}
    {canWrite && <Card title="登錄合格商品"><Form form={form} layout="vertical" onFinish={values => void submit(values)} initialValues={{ kind: 'REFURBISHED' }} disabled={busy || !catalog} onValuesChange={changed => {
      dirty.current = true
      if ('productId' in changed || 'warehouseId' in changed) form.setFieldsValue({ serialNumber: undefined })
    }}>
      <Space align="start" wrap>
        <Form.Item name="kind" label="商品級別" rules={[{ required: true }]}><Select style={{ width: 140 }} options={[{ value: 'NEW', label: '新品' }, { value: 'REFURBISHED', label: '整新品' }]} /></Form.Item>
        <Form.Item name="productId" label="商品" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" style={{ width: 280 }} options={catalog?.products.map(value => ({ value: value.id, label: `${value.sku} ${value.name}` }))} /></Form.Item>
        <Form.Item name="warehouseId" label="入庫倉位" rules={[{ required: true }]}><Select style={{ width: 200 }} options={catalog?.warehouses.map(value => ({ value: value.id, label: `${value.code} ${value.name}` }))} /></Form.Item>
        <Form.Item name="unitLabel" label="實物標籤" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} placeholder="單件內部標籤，不代替產品 SN" /></Form.Item>
        <Form.Item name="serialNumber" label="產品 SN" rules={catalog?.products.find(value => value.id === productId)?.hasSerialNumbers ? [{ required: true }] : []}><Select allowClear style={{ width: 220 }} options={catalog?.serials.filter(value => value.productId === productId && value.warehouseId === warehouseId).map(value => ({ value: value.serialNumber, label: value.serialNumber }))} /></Form.Item>
      </Space>
      {kind === 'REFURBISHED' && <Form.Item name="sourceItemId" label="來源退貨實物" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={catalog?.returnItems.map(value => ({ value: value.id, label: `${value.label} · ${value.sku || ''} · ${value.grade || ''} · ${value.receipt.sourceNumber || ''}` }))} /></Form.Item>}
      <Space align="start" wrap>{(['sourceReference', 'ownershipReference', 'inspectionReference'] as const).map((name, index) => <Form.Item key={name} name={name} label={['正式入庫／來源單據', '所有權／退款確認依據', '合格檢驗基準與紀錄版本'][index]} rules={[{ required: true, whitespace: true }]}><Input maxLength={500} /></Form.Item>)}</Space>
      <Button htmlType="submit" type="primary" loading={busy} disabled={!catalog}>登錄合格商品</Button>
    </Form></Card>}
    <Table<ReplacementUnit> rowKey="id" dataSource={rows} loading={loading} columns={[
      { title: '實物', dataIndex: 'unitLabel' }, { title: 'SKU', render: (_, row) => row.qualification.sku }, { title: '級別', render: (_, row) => row.kind === 'NEW' ? '新品' : '整新品' }, { title: 'SN', dataIndex: 'serialNumber' },
      { title: '狀態', render: (_, row) => <Tag>{row.status === 'QUALIFIED' ? '可預留' : row.status === 'RESERVED' ? '已預留' : row.status}</Tag> },
      { title: '預留案件', render: (_, row) => row.reservations.map(value => <Space key={value.id}>{value.itemId}{canWrite && value.status === 'RESERVED' && <Button size="small" disabled={busy} onClick={() => void release(value.id)}>取消預留</Button>}</Space>) },
    ]} />
  </Space>
}
