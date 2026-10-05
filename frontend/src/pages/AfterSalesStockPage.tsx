import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Checkbox, Form, Input, Select, Space, Table, Tag } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hasAnyPermission } from '../utils/access'
import { repairStockService } from '../services/repair-stock'
import type { ReplacementUnit, RepairStockCatalog, StockQualification, StockReturnReceiptResult } from '../services/repair-stock'
import { buildReturnStockReceipt, canReceiveReturnStock, validateReturnStockReceipt } from '../services/repair-stock-return'
import type { StockReturnFormValues, StockReturnReceiptInput } from '../services/repair-stock-return'
import { useRepairNavigationGuard } from './repair/repair-navigation'
import { useRepairFeedback } from './repair/repair-feedback'
export default function AfterSalesStockPage() {
  const { modal, message, contextHolder } = useRepairFeedback()
  const confirmDiscard = useCallback(() => new Promise<boolean>(resolve => modal.confirm({ title: '庫存表單尚未完成', content: '請先完成或確認放棄表單。入庫已送出而未取得回執時，請先重試或查核正式入庫，不要另建一筆。既有預留不會因離開頁面而取消。', okText: '離開頁面', cancelText: '保留表單', maskClosable: false, onOk: () => resolve(true), onCancel: () => resolve(false) })), [modal])
  const { user } = useAuth()
  const [params] = useSearchParams()
  const entityId = params.get('entityId') || localStorage.getItem('entityId') || ''
  const canRead = hasAnyPermission(user, ['inventory:read', 'after_sales_stock:read'])
  const canWrite = hasAnyPermission(user, ['inventory:update', 'after_sales_stock:update'])
  const canReceive = canRead && canReceiveReturnStock(user)
  const [rows, setRows] = useState<ReplacementUnit[]>([]), [catalog, setCatalog] = useState<RepairStockCatalog>(), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const [form] = Form.useForm<Omit<StockQualification, 'entityId'>>()
  const [receiveForm] = Form.useForm<StockReturnFormValues>()
  const [receiveAttempt, setReceiveAttempt] = useState<StockReturnReceiptInput>()
  const receiveAttemptRef = useRef<StockReturnReceiptInput | undefined>(undefined)
  const receiveInFlight = useRef(false)
  const [inboundReceipt, setInboundReceipt] = useState<StockReturnReceiptResult>()
  const qualifyDirty = useRef(false), receiveDirty = useRef(false), dirty = useRef(false), generation = useRef(0)
  const syncDirty = () => { dirty.current = qualifyDirty.current || receiveDirty.current }
  useRepairNavigationGuard(dirty, confirmDiscard)
  const productId = Form.useWatch('productId', form), warehouseId = Form.useWatch('warehouseId', form), kind = Form.useWatch('kind', form)
  const returnId = Form.useWatch('sourceItemId', receiveForm)
  const selectedReturn = catalog?.returnItems.find(value => value.id === returnId)
  const returns = catalog?.returnItems.filter(value => value.refurbishmentEligible && ['PENDING_RESTOCK', 'PENDING_WELFARE_STOCK'].includes(value.status || '')) || []
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
  useEffect(() => {
    form.resetFields(); receiveForm.resetFields(); setReceiveAttempt(undefined); receiveAttemptRef.current = undefined; setInboundReceipt(undefined)
    qualifyDirty.current = false; receiveDirty.current = false; dirty.current = false
  }, [entityId, form, receiveForm])
  const submit = async (values: Omit<StockQualification, 'entityId'>) => {
    if (!canWrite || busy) return
    setBusy(true)
    try {
      const input = { ...values, entityId, ...(values.kind === 'NEW' ? { sourceItemId: undefined } : {}) }
      await repairStockService.qualify(input); qualifyDirty.current = false; syncDirty(); form.resetFields(); message.success('已登錄合格商品；庫存數量維持原正式入庫紀錄'); await load()
    } catch { message.error('商品未能登錄，請核對正式入庫、所有權、來源退貨品及合格依據') } finally { setBusy(false) }
  }
  const receiveReturn = async (values: StockReturnFormValues) => {
    if (!canReceive || busy || receiveInFlight.current) return
    receiveInFlight.current = true; setBusy(true)
    const currentGeneration = generation.current
    let input = receiveAttemptRef.current
    try {
      if (!input) {
        input = buildReturnStockReceipt(entityId, values, selectedReturn,
          catalog?.products.find(value => value.id === values.productId), crypto.randomUUID())
        const draft = input
        const allowed = await new Promise<boolean>(resolve => modal.confirm({
          title: '確認本人點收並正式入庫一件整新品',
          content: `來源 ${selectedReturn?.label}；${selectedReturn?.sku}。將由來源位置「${draft.sourceLocation}」交接至「${draft.location}」，正式 ERP 入庫 +1 並登錄整新品。這不代表外部庫存已過帳。`,
          okText: '確認本人簽收並入庫', cancelText: '返回核對', maskClosable: false,
          onOk: () => resolve(true), onCancel: () => resolve(false),
        }))
        if (!allowed) return
        if (currentGeneration !== generation.current) return
        receiveAttemptRef.current = input
        setReceiveAttempt(input)
      }
      const result = await repairStockService.receiveReturn(input)
      validateReturnStockReceipt(result, input, user?.id)
      if (currentGeneration !== generation.current) return
      setInboundReceipt(result); setReceiveAttempt(undefined); receiveAttemptRef.current = undefined; receiveForm.resetFields()
      receiveDirty.current = false; syncDirty()
      message.success(result.duplicate ? '已核對同一筆正式入庫回執，沒有重複增加庫存' : '已正式入庫一件並登錄整新品，實物已由本次庫存人員簽收')
      await load()
    } catch (error) {
      const serverMessage = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
      message.error(typeof serverMessage === 'string' ? serverMessage : error instanceof Error ? error.message : '正式入庫未完成，請保留本筆資料重試並核對正式流水')
    } finally { receiveInFlight.current = false; setBusy(false) }
  }
  const release = async (id: string) => {
    if (!canWrite || busy) return
    setBusy(true)
    try { await repairStockService.release(entityId, id); await load(); message.success('未使用的預留已釋放') }
    catch { message.error('無法釋放，請核對案件及庫存狀態；已出庫不能在此回補') } finally { setBusy(false) }
  }
  if (!entityId) return <>{contextHolder}<Alert type="warning" message="請先選擇作業公司" /></>
  if (!canRead) return <>{contextHolder}<Alert type="warning" message="沒有售後庫存讀取權限" /></>
  return <Space direction="vertical" style={{ width: '100%' }}>
    {contextHolder}
    <h2>售後替換與整新品庫存</h2>
    <Alert type="info" showIcon message="合格實物 → 正式入庫／合格登錄 → 案件預留 → 正式使用" description="合格退貨由庫存負責人本人點收後正式入庫；已正式入庫的商品則只登錄合格資料，不增加數量。預留、取消釋放、ERP 入庫與出庫保留不同流水；外部庫存回執另外追蹤。" />
    {failure && <Alert type="error" message={failure} />}
    <Button loading={loading} disabled={busy} onClick={() => void load()}>更新合格庫存</Button>
    {!canWrite && <Alert type="info" message="目前為唯讀，登錄與取消預留另需庫存更新權限" />}
    {canWrite && <Card title="已正式入庫後登錄合格商品（不增加庫存數量）"><Form name="qualified-existing-stock" form={form} layout="vertical" onFinish={values => void submit(values)} initialValues={{ kind: 'REFURBISHED' }} disabled={busy || !catalog} onValuesChange={changed => {
      qualifyDirty.current = true; syncDirty()
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
      <Space align="start" wrap>{(['sourceReference', 'ownershipReference', 'inspectionReference'] as const).map((name, index) => <Form.Item key={name} name={name} label={['正式入庫／來源單據', '所有權／退貨接收依據', '合格檢驗基準與紀錄版本'][index]} rules={[{ required: true, whitespace: true }]}><Input maxLength={500} /></Form.Item>)}</Space>
      <Button htmlType="submit" type="primary" loading={busy} disabled={!catalog}>登錄合格商品</Button>
    </Form></Card>}
    {canReceive && <Card title="合格退貨正式入庫並登錄整新品">
      <Alert type="info" showIcon message="庫存負責人本人簽收；單件正式 ERP 入庫 +1" description="只接受已完成當版檢修與逐項合格複驗、交由收發保管的退貨實物。外觀分級不代替功能檢驗。選定真實 SKU、SN／實物標籤及目的倉位後，由本人點件簽收；技師不能在維修工作台自行入庫。來源案件可有多件，本次僅點收這一件；有 SN 逐件核對真實 SN，無產品 SN 時每件須貼不可重用的實物標籤，不將來源總量整批入庫。" />
      {receiveAttempt && <Alert type="warning" showIcon message="本筆入庫已送出，尚未確認回執" description="資料與來源版次已保留，請重試同一筆；不要修改資料或另建入庫。離開頁面後，應先由正式流水核對是否已完成。" />}
      {inboundReceipt && <Alert type="success" showIcon message={`正式 ERP 入庫回執：${inboundReceipt.inbound.inTransactionId}`} description={`一件；${inboundReceipt.inbound.fromLocation} → ${inboundReceipt.inbound.toLocation}；原實物版本 ${inboundReceipt.inbound.sourceItemVersion} → 已入庫版本 ${inboundReceipt.inbound.inventoryItemVersion}。外部庫存尚未過帳，請另核對外部回執。`} />}
      {!returns.length && !receiveAttempt && <Alert type="info" message="目前沒有可正式入庫的合格退貨；請先完成原檢修與收發簽收流程" />}
      <Form name="qualified-return-receipt" form={receiveForm} layout="vertical" onFinish={values => void receiveReturn(values)} disabled={busy || !catalog || Boolean(receiveAttempt)} onValuesChange={changed => {
        receiveDirty.current = true; syncDirty()
        if ('sourceItemId' in changed) {
          const source = catalog?.returnItems.find(value => value.id === changed.sourceItemId)
          const product = catalog?.products.find(value => value.sku === source?.sku)
          receiveForm.setFieldsValue({ productId: product?.id, sourceLocation: source?.location || '', serialNumber: source?.serialNumber || '', confirmedItems: false })
          setInboundReceipt(undefined)
        }
      }}>
        <Form.Item name="sourceItemId" label="已合格並由收發保管的來源退貨" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={returns.map(value => ({ value: value.id, label: `${value.label} · ${value.sku || ''} · ${value.receipt.sourceNumber || ''} · 版本 ${value.version}` }))} /></Form.Item>
        {selectedReturn && <Space wrap><Tag>{selectedReturn.sku}</Tag><Tag>檢修版本 {selectedReturn.inspectionRevision}</Tag><Tag>維修版本 {selectedReturn.reportRevision}</Tag><Tag color={selectedReturn.qcResult === 'PASS' ? 'green' : 'orange'}>複驗 {selectedReturn.qcResult || '待核對'}</Tag></Space>}
        <Form.Item name="productId" hidden rules={[{ required: true, message: '來源 SKU 尚未對應有效 ERP 商品，請先核對商品資料' }]}><Input /></Form.Item>
        <Space align="start" wrap>
          <Form.Item name="sourceLocation" label="來源目前實物位置" rules={[{ required: true, whitespace: true }]}><Input readOnly maxLength={160} /></Form.Item>
          <Form.Item name="warehouseId" label="正式入庫倉位" rules={[{ required: true }]}><Select style={{ width: 220 }} options={catalog?.warehouses.map(value => ({ value: value.id, label: `${value.code} ${value.name}` }))} /></Form.Item>
          <Form.Item name="location" label="目的庫存實際位置" rules={[{ required: true, whitespace: true }]}><Input maxLength={160} placeholder="本人點件簽收後的倉位／櫃位" /></Form.Item>
          <Form.Item name="unitLabel" label="唯一實物標籤" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} placeholder="單件標籤，不代替產品 SN" /></Form.Item>
          <Form.Item name="serialNumber" label="來源真實產品 SN"><Input readOnly maxLength={100} placeholder="無 SN 商品不另造序號" /></Form.Item>
        </Space>
        <Space align="start" wrap>{(['ownershipReference', 'inspectionReference'] as const).map((name, index) => <Form.Item key={name} name={name} label={['所有權／退貨接收依據（不等同退款完成）', '本版合格檢驗基準與紀錄'][index]} rules={[{ required: true, whitespace: true }]}><Input maxLength={500} /></Form.Item>)}</Space>
        <Form.Item name="confirmedItems" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error('請本人確認實際點件簽收')) }]}><Checkbox>我已從目前收發持有人實際點收一件，確認 SKU、SN／實物標籤與目的庫存位置</Checkbox></Form.Item>
        <Button htmlType="submit" type="primary" loading={busy} disabled={busy || (!receiveAttempt && (!catalog || !returns.length))}>{receiveAttempt ? '重試同一筆正式入庫' : '確認本人簽收並正式入庫一件'}</Button>
      </Form>
    </Card>}
    <Table<ReplacementUnit> rowKey="id" dataSource={rows} loading={loading} columns={[
      { title: '實物', dataIndex: 'unitLabel' }, { title: 'SKU', render: (_, row) => row.qualification.sku }, { title: '級別', render: (_, row) => row.kind === 'NEW' ? '新品' : '整新品' }, { title: 'SN', dataIndex: 'serialNumber' },
      { title: '狀態', render: (_, row) => <Tag>{row.status === 'QUALIFIED' ? '可預留' : row.status === 'RESERVED' ? '已預留' : row.status}</Tag> },
      { title: '預留案件', render: (_, row) => row.reservations.map(value => <Space key={value.id}>{value.itemId}{canWrite && value.status === 'RESERVED' && <Button size="small" disabled={busy} onClick={() => void release(value.id)}>取消預留</Button>}</Space>) },
    ]} />
  </Space>
}
