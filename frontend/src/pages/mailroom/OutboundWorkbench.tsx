import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Checkbox, Col, Descriptions, Drawer, Empty, Form, Input, InputNumber, Row, Select, Space, Spin, Steps, Table, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import { hasPermission } from '../../utils/access'
import api from '../../services/api'
import { mailroomOutbound, outboundIdentityCurrent } from '../../services/mailroom-outbound'
import type { OutboundAction, OutboundCommand, OutboundOrder, OutboundSourceOrder, OutboundWarehouse } from '../../services/mailroom-outbound'
import { canOutboundAction, clearOutboundPending, matchesOutboundResult, outboundLines, outboundRemaining, outboundStep, OUTBOUND_STATUS, OUTBOUND_SYNC, OUTBOUND_TYPES, readOutboundPending, saveOutboundPending, OutboundClientError } from './mailroom-outbound-model'
import type { OutboundPending } from './mailroom-outbound-model'
import type { MailroomDraftState } from './mailroom-draft'
import type { Person } from './model'
import { errorText } from './model'
import ReceivedProductPicker from './ReceivedProductPicker'
import type { ReceivedProduct } from './ReceivedProductPicker'
import RecipientPicker from './RecipientPicker'
import { useRepairFeedback } from '../repair/repair-feedback'

type Props = { entityId: string; onDraftChange: (state: MailroomDraftState) => void; resetDraftRevision?: number; initialOrderId?: string }
type Preparation = { location: string; nextUserId: string; confirmedItems: boolean;
  items: { unitId: string; productId: string; warehouseId: string; sku: string; serialNumber?: string }[] }
const date = (value: string) => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
const outboundError = (error: unknown) => error instanceof OutboundClientError ? error.message : errorText(error)

export default function OutboundWorkbench({ entityId, onDraftChange, resetDraftRevision = 0, initialOrderId }: Props) {
  const { user } = useAuth(), { modal, message, contextHolder } = useRepairFeedback()
  const actorId = user?.id || '', scope = actorId + ':' + entityId
  const inventory = hasPermission(user, 'inventory:update') || hasPermission(user, 'after_sales_stock:update')
  const grants = { inventory, mailroom: hasPermission(user, 'mailroom:update') }
  const [rows, setRows] = useState<OutboundOrder[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>(), [search, setSearch] = useState(''), [revision, setRevision] = useState(0)
  const [listLoading, setListLoading] = useState(false), [failure, setFailure] = useState('')
  const [mode, setMode] = useState<'source' | 'order' | undefined>(initialOrderId ? 'order' : undefined), [selectedId, setSelectedId] = useState(initialOrderId || '')
  const [order, setOrder] = useState<OutboundOrder>(), [detailLoading, setDetailLoading] = useState(false)
  const [sourceSearch, setSourceSearch] = useState(''), [sources, setSources] = useState<OutboundSourceOrder[]>([])
  const [source, setSource] = useState<OutboundSourceOrder>(), [sourceLoading, setSourceLoading] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number | null>>({})
  const [busy, setBusy] = useState(false), [changed, setChanged] = useState(false), [pending, setPending] = useState<OutboundPending | null>(null)
  const [storageFailure, setStorageFailure] = useState('')
  const running = useRef(false), currentScope = useRef(scope), mounted = useRef(false), mutation = useRef<AbortController | undefined>(undefined)
  const resetRevision = useRef(resetDraftRevision)
  const callbacks = useRef(onDraftChange), token = useRef(localStorage.getItem('access_token') || '')
  currentScope.current = scope; callbacks.current = onDraftChange
  useEffect(() => {
    mounted.current = true
    try {
      const saved = readOutboundPending(sessionStorage, actorId, entityId)
      setPending(saved)
      if (saved) { setMode(saved.kind === 'create' ? 'source' : 'order'); setSelectedId(saved.orderId || '') }
    } catch (e) { setStorageFailure(outboundError(e)) }
    return () => { mounted.current = false; mutation.current?.abort(); callbacks.current({ dirty: false, busy: false }) }
  }, [scope, actorId, entityId])
  useEffect(() => { onDraftChange({ dirty: changed || !!pending || !!storageFailure, busy, uncertain: !!pending }) }, [changed, pending, busy, storageFailure, onDraftChange])
  useEffect(() => { if (resetRevision.current !== resetDraftRevision) { resetRevision.current = resetDraftRevision; if (!pending && !running.current) { setChanged(false); setMode(undefined); setSource(undefined) } } }, [resetDraftRevision, pending])
  useEffect(() => {
    const abort = new AbortController()
    setListLoading(true)
    const timer = setTimeout(() => {
      void mailroomOutbound.orders(entityId, status, search.trim(), page, abort.signal).then(data => {
        if (!abort.signal.aborted) { setRows(data.items); setTotal(data.total); setFailure('') }
      }).catch(e => { if (!abort.signal.aborted) { setRows([]); setTotal(0); setFailure(errorText(e)) } }).finally(() => { if (!abort.signal.aborted) setListLoading(false) })
    }, search ? 250 : 0)
    return () => { clearTimeout(timer); abort.abort() }
  }, [scope, entityId, status, search, page, revision])
  useEffect(() => {
    const abort = new AbortController()
    if (mode !== 'order' || !selectedId) { setOrder(undefined); return }
    setOrder(undefined); setDetailLoading(true)
    void mailroomOutbound.order(entityId, selectedId, abort.signal).then(value => {
      if (!abort.signal.aborted && value.id === selectedId && value.entityId === entityId) setOrder(value)
    }).catch(e => { if (!abort.signal.aborted) setFailure(errorText(e)) }).finally(() => { if (!abort.signal.aborted) setDetailLoading(false) })
    return () => abort.abort()
  }, [scope, entityId, mode, selectedId, revision])
  useEffect(() => {
    const abort = new AbortController()
    if (mode !== 'source') return
    const caseId = pending?.kind === 'create' ? (JSON.parse(pending.body) as { sourceCaseId: string }).sourceCaseId : undefined
    setSourceLoading(true)
    const timer = setTimeout(() => void mailroomOutbound.sources(entityId, sourceSearch.trim(), caseId, abort.signal).then(data => {
      if (abort.signal.aborted) return
      setSources(data.items)
      if (caseId) {
        const match = data.items.find(item => item.id === caseId)
        setSource(match)
        setQuantities(Object.fromEntries((JSON.parse(pending!.body).lines as { sourceCaseItemId: string; quantity: number }[]).map(line => [line.sourceCaseItemId, line.quantity])))
      }
    }).catch(e => { if (!abort.signal.aborted) { setSources([]); setFailure(errorText(e)) } }).finally(() => { if (!abort.signal.aborted) setSourceLoading(false) }), sourceSearch ? 250 : 0)
    return () => { clearTimeout(timer); abort.abort() }
  }, [scope, entityId, mode, sourceSearch, pending, revision])
  const discard = useCallback(async () => {
    if (busy) { message.info('正在保存，請稍候'); return false }
    if (pending || storageFailure) { message.info('請先核對原操作'); return false }
    if (!changed) return true
    return new Promise<boolean>(resolve => modal.confirm({ title: '出貨資料尚未保存', content: '要放棄修改嗎？', okText: '放棄修改', cancelText: '繼續編輯', onOk: () => resolve(true), onCancel: () => resolve(false) }))
  }, [busy, pending, storageFailure, changed, modal, message])
  async function open(nextMode: 'source' | 'order', id = '') {
    if (!await discard()) return
    setChanged(false); setFailure(''); setMode(nextMode); setSelectedId(id); setSource(undefined); setQuantities({})
  }
  async function send(kind: 'create' | 'action', body: object, orderId?: string) {
    if (running.current || storageFailure) return
    if (!outboundIdentityCurrent({ actorId, token: token.current })) { setFailure('登入狀態已變更，請重新登入後核對原操作'); return }
    const atScope = scope, alreadyPending = !!pending
    let saved: OutboundPending | undefined, sent = false
    const abort = new AbortController(); mutation.current = abort
    const active = () => mounted.current && currentScope.current === atScope && !abort.signal.aborted
    const identityCurrent = () => outboundIdentityCurrent({ actorId, token: token.current })
    running.current = true; setBusy(true); setFailure('')
    try {
      saved = pending || (() => { const requestId = crypto.randomUUID(); return { schema: 'corely.mailroom.outbound.pending.v1' as const, actorId, entityId, kind, orderId, requestId, body: JSON.stringify({ ...body, entityId, requestId }) } })()
      saveOutboundPending(sessionStorage, saved)
      setPending(saved)
      sent = true
      const result = await mailroomOutbound.mutate(saved.kind, saved.orderId, saved.body, { actorId, token: token.current }, abort.signal)
      if (!active()) return
      if (!identityCurrent()) { setFailure('登入狀態已變更，請重新登入後核對原操作'); return }
      if (!matchesOutboundResult(result, saved)) throw new OutboundClientError('回執不符，請重試核對原操作')
      clearOutboundPending(sessionStorage, saved)
      setPending(null); setChanged(false); setSelectedId(result.id); setMode('order'); setOrder(result); setRevision(value => value + 1)
      message.success('已保存出貨進度')
    } catch (e) {
      if (!active()) return
      if (!identityCurrent()) { setFailure('登入狀態已變更，請重新登入後核對原操作'); return }
      const responseStatus = (e as { response?: { status?: number } }).response?.status
      if (saved && sent && !alreadyPending && responseStatus && responseStatus >= 400 && responseStatus < 500) {
        try { clearOutboundPending(sessionStorage, saved); setPending(null) } catch { setFailure('原操作尚待核對，請重試'); return }
      }
      setFailure(sent && (!responseStatus || responseStatus >= 500 || alreadyPending) ? '操作結果待確認，請重試原操作。' : outboundError(e))
    } finally { running.current = false; if (active()) setBusy(false) }
  }
  const retry = () => { if (pending) void send(pending.kind, {}, pending.orderId) }
  const visibleSources = [...new Map([...sources, ...(source ? [source] : [])].map(value => [value.id, value])).values()]
  return <Card className="mailroom-list" title="售後出貨" style={{ marginBottom: 24, minWidth: 0 }} extra={<Space wrap><Button icon={<ReloadOutlined />} disabled={busy || !!pending} onClick={() => void (async () => { if (await discard()) { setChanged(false); setRevision(value => value + 1) } })()}>更新</Button>{grants.mailroom && <Button type="primary" disabled={!!pending || !!storageFailure} onClick={() => void open('source')}>建立出貨</Button>}</Space>}>
    {contextHolder}
    {(failure || storageFailure) && <Alert type="error" showIcon message={storageFailure || failure} style={{ marginBottom: 16 }} />}
    {pending && <Alert type="warning" showIcon message="出貨操作待確認" action={<Button disabled={busy} loading={busy} onClick={retry}>重試原操作</Button>} style={{ marginBottom: 16 }} />}
    <Space wrap style={{ marginBottom: 16 }}><Input.Search aria-label="搜尋售後出貨" placeholder="案件號或儲位" allowClear maxLength={100} onSearch={value => { setSearch(value); setPage(1) }} /><Select aria-label="篩選出貨進度" value={status} placeholder="全部進度" allowClear style={{ minWidth: 180 }} options={Object.entries(OUTBOUND_STATUS).map(([value, label]) => ({ value, label }))} onChange={value => { setStatus(value); setPage(1) }} /></Space>
    <Table<OutboundOrder> rowKey="id" dataSource={rows} loading={listLoading} scroll={{ x: 700 }} locale={{ emptyText: <Empty description={search ? '沒有符合的出貨' : '目前沒有售後出貨'} /> }} pagination={{ current: page, total, pageSize: 20, showSizeChanger: false, onChange: setPage }} columns={[
      { title: '案件／品項', key: 'case', render: (_, value) => <><Button type="link" onClick={() => void open('order', value.id)}>{value.sourceNumber}</Button><div>{OUTBOUND_TYPES[value.caseType]} · {value.items.length} 件</div></> },
      { title: '目前進度', key: 'status', render: (_, value) => <Tag>{OUTBOUND_STATUS[value.status]}</Tag> },
      { title: '儲位／接手人', key: 'custody', render: (_, value) => <>{value.location || '—'}<div>{value.custodianName || value.nextUserName || '待指定'}</div></> },
      { title: '售後同步', key: 'sync', render: (_, value) => OUTBOUND_SYNC[value.sourceSync.status] },
      { title: '', key: 'open', render: (_, value) => <Button onClick={() => void open('order', value.id)}>查看</Button> },
    ]} />
    <Drawer title={mode === 'source' ? '建立售後出貨' : order?.sourceNumber || '出貨進度'} open={!!mode} width={900} destroyOnHidden onClose={() => void (async () => { if (await discard()) { setChanged(false); setMode(undefined) } })()}>
      {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 16 }} />}
      {pending && <Alert type="warning" showIcon message="原操作結果待確認" action={<Button loading={busy} onClick={retry}>重試原操作</Button>} style={{ marginBottom: 16 }} />}
      {pending && <PendingSummary pending={pending} />}
      {mode === 'source' ? <>
        <Form layout="vertical"><Form.Item label="售後案件"><Select aria-label="搜尋待出貨售後案件" showSearch filterOption={false} disabled={busy || !!pending} value={source?.id} loading={sourceLoading} placeholder="搜尋案件號、姓名或產品" style={{ width: '100%' }} onSearch={setSourceSearch} options={visibleSources.map(item => ({ value: item.id, label: `${item.number} · ${item.customerLabel} · ${OUTBOUND_TYPES[item.type]}` }))} onChange={id => {
          const value = visibleSources.find(item => item.id === id)
          if (value) { setSource(value); setQuantities(Object.fromEntries(value.items.map(item => [item.id, Math.max(0, outboundRemaining(item))]))); setChanged(true) }
        }} notFoundContent={sourceLoading ? <Spin size="small" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="沒有符合的待出貨案件" />} /></Form.Item></Form>
        {source && <>
          {!source.dispatchAllowed && <Alert type="warning" showIcon message={source.blockReason || '此案件尚未開放出貨'} style={{ marginBottom: 16 }} />}
          {source.dispatchAllowed && !source.items.some(item => outboundRemaining(item) > 0) && <Alert type="info" showIcon message="本案品項已安排出貨，請查看既有寄件單" style={{ marginBottom: 16 }} />}
          <Descriptions size="small" column={1} items={[{ key: 'recipient', label: '收件人', children: `${source.recipient.name} · ${source.recipient.phone}` }, { key: 'address', label: '寄送地址', children: source.recipient.address }, { key: 'brand', label: '品牌', children: source.brand || '待核對' }]} />
          <Table rowKey="id" dataSource={source.items} pagination={false} scroll={{ x: 450 }} style={{ margin: '16px 0' }} columns={[
            { title: '申報品項', key: 'item', render: (_, item) => <>{item.name}<div><Typography.Text type="secondary">{item.sku || '未提供 SKU'}</Typography.Text></div></> },
            { title: '可安排件數', key: 'remaining', render: (_, item) => <>{Math.max(0, outboundRemaining(item))}{!!item.plannedQuantity && <div><Typography.Text type="secondary">已安排 {item.plannedQuantity} 件</Typography.Text></div>}</> },
            { title: '本次件數', key: 'quantity', render: (_, item) => <InputNumber aria-label={`${item.name}本次出貨數量`} min={0} max={Math.max(0, outboundRemaining(item))} precision={0} value={quantities[item.id]} disabled={busy || !!pending || !source.dispatchAllowed || outboundRemaining(item) <= 0} onChange={value => { setQuantities(current => ({ ...current, [item.id]: value })); setChanged(true) }} /> },
          ]} />
          {!pending && <Button type="primary" loading={busy} disabled={!source.dispatchAllowed || !source.items.some(item => outboundRemaining(item) > 0)} onClick={() => { try { void send('create', { sourceCaseId: source.id, sourceVersion: source.version, lines: outboundLines(source, quantities) }) } catch (e) { setFailure(outboundError(e)) } }}>建立本次出貨</Button>}
        </>}
      </> : <Spin spinning={detailLoading}>{order && <>
        <Steps current={outboundStep(order)} status={order.status === 'CANCELLED' ? 'error' : undefined} size="small" responsive items={[{ title: '備貨出庫' }, { title: '收發點收' }, { title: order.status === 'DISPATCHED' ? '已交物流' : '交物流' }]} style={{ marginBottom: 24 }} />
        <Descriptions size="small" column={1} items={[{ key: 'type', label: '案件類別', children: OUTBOUND_TYPES[order.caseType] }, { key: 'status', label: '目前進度', children: OUTBOUND_STATUS[order.status] }, { key: 'location', label: '儲位', children: order.location || '—' }, { key: 'owner', label: '目前保管／接手人', children: order.custodianName || order.nextUserName || '待指定' }]} />
        {!pending && canOutboundAction(order, 'refresh_source', actorId, grants) && <Button disabled={busy} onClick={() => void (async () => { if (await discard()) { setChanged(false); void send('action', { expectedVersion: order.version, action: 'refresh_source' }, order.id) } })()}>更新案件</Button>}
        <Table rowKey="unitId" dataSource={order.items} pagination={false} scroll={{ x: 500 }} style={{ margin: '16px 0' }} columns={[{ title: '品項', dataIndex: 'productName' }, { title: 'SKU', dataIndex: 'sku' }, { title: 'SN', key: 'sn', render: (_, item) => item.serialNumber || '—' }]} />
        {order.outboundShipment && <Descriptions size="small" column={1} items={[{ key: 'tracking', label: '寄出物流／單號', children: `${order.outboundShipment.carrier} · ${order.outboundShipment.trackingNumber}` }, { key: 'date', label: '交運時間', children: date(order.outboundShipment.dispatchedAt) }, { key: 'sync', label: '售後同步', children: OUTBOUND_SYNC[order.sourceSync.status] }]} />}
        {order.sourceSync.status === 'FAILED' && <Alert showIcon type="error" message="寄出同步失敗" description={order.sourceSync.lastError} style={{ marginTop: 16 }} />}
        {!pending && order.sourceSync.status !== 'DELIVERED' && canOutboundAction(order, 'retry_sync', actorId, grants) && <Button style={{ marginTop: 16 }} loading={busy} onClick={() => void send('action', { expectedVersion: order.version, action: 'retry_sync' }, order.id)}>重送售後同步</Button>}
        {!pending && <OrderAction key={`${order.id}:${order.version}`} order={order} entityId={entityId} actorId={actorId} grants={grants} busy={busy} onDirty={() => setChanged(true)} onSubmit={command => void send('action', command, order.id)} />}
      </>}</Spin>}
    </Drawer>
  </Card>
}

function OrderAction({ order, entityId, actorId, grants, busy, onDirty, onSubmit }: { order: OutboundOrder; entityId: string; actorId: string; grants: { mailroom: boolean; inventory: boolean }; busy: boolean; onDirty: () => void; onSubmit: (command: Omit<OutboundCommand, 'entityId' | 'requestId'>) => void }) {
  const { modal, contextHolder } = useRepairFeedback()
  const [form] = Form.useForm<Preparation & { carrier: string; trackingNumber: string }>()
  const [warehouses, setWarehouses] = useState<OutboundWarehouse[]>([]), [people, setPeople] = useState<Person[]>([])
  const [products, setProducts] = useState<Record<string, ReceivedProduct>>({}), [failure, setFailure] = useState('')
  const prepare = canOutboundAction(order, 'prepare', actorId, grants), accept = canOutboundAction(order, 'accept', actorId, grants), dispatch = canOutboundAction(order, 'dispatch', actorId, grants)
  const cancel = canOutboundAction(order, 'cancel', actorId, grants)
  useEffect(() => {
    const abort = new AbortController()
    if (!prepare) return
    void Promise.all([mailroomOutbound.warehouses(entityId, abort.signal), api.get<Person[]>('/mailroom/people', { params: { entityId }, signal: abort.signal })]).then(([values, response]) => { if (!abort.signal.aborted) { setWarehouses(values); setPeople(response.data.filter(person => person.mailroom)) } }).catch(e => { if (!abort.signal.aborted) setFailure(errorText(e)) })
    return () => abort.abort()
  }, [entityId, prepare])
  const action: OutboundAction | undefined = prepare ? 'prepare' : accept ? 'accept' : dispatch ? 'dispatch' : undefined
  const cancelButton = cancel && <Button danger disabled={busy} onClick={() => modal.confirm({ title: '取消本次出貨？', okText: '確認取消', cancelText: '保留出貨', onOk: () => onSubmit({ expectedVersion: order.version, action: 'cancel' }) })}>取消本次出貨</Button>
  if (!action) return <>{contextHolder}{cancelButton}</>
  return <Form form={form} layout="vertical" disabled={busy} initialValues={{ location: order.location || undefined, items: order.items.map(item => ({ unitId: item.unitId })) }} onValuesChange={onDirty} onFinish={values => {
    setFailure('')
    if (values.confirmedItems !== true) { setFailure('請確認本次實物'); return }
    if (prepare && order.items.some(item => products[item.unitId]?.hasSerialNumbers && !values.items.find(value => value.unitId === item.unitId)?.serialNumber?.trim())) { setFailure('請填寫序號商品的 SN'); return }
    onSubmit({ expectedVersion: order.version, action, confirmedItems: true,
      ...(prepare ? { location: values.location, nextUserId: values.nextUserId, items: values.items.map(item => ({ ...item, serialNumber: item.serialNumber?.trim() || undefined })) } : accept ? { location: values.location } : { carrier: values.carrier.trim(), trackingNumber: values.trackingNumber.trim() }) })
  }} style={{ marginTop: 24 }}>
    {contextHolder}
    {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 16 }} />}
    {prepare && <><Form.List name="items">{fields => fields.map((field, index) => <div key={field.key} style={{ borderTop: '1px solid #edf0f4', paddingTop: 16, marginBottom: 16 }}>
      <Typography.Text strong>{order.items[index].productName} · 第 {index + 1} 件</Typography.Text><div><Typography.Text type="secondary">{order.items[index].sku || '未提供 SKU'}</Typography.Text></div>
      <Form.Item name={[field.name, 'unitId']} hidden><Input /></Form.Item><Form.Item name={[field.name, 'sku']} hidden><Input /></Form.Item>
      <Row gutter={16} style={{ marginTop: 12 }}><Col xs={24} md={12}><Form.Item label="實際出庫產品" required>
        <Form.Item name={[field.name, 'productId']} noStyle rules={[{ required: true, message: '請選擇實際產品' }]}><Input type="hidden" /></Form.Item>
        <ReceivedProductPicker entityId={entityId} active={true} value={products[order.items[index].unitId]?.id || ''} selected={products[order.items[index].unitId]} onChange={product => { if (!product.sku || product.sku !== order.items[index].sku) { setFailure('實際產品 SKU 須與售後品項一致'); return } setFailure(''); setProducts(value => ({ ...value, [order.items[index].unitId]: product })); form.setFieldValue(['items', field.name, 'productId'], product.id); form.setFieldValue(['items', field.name, 'sku'], product.sku); onDirty() }} />
      </Form.Item></Col><Col xs={24} md={12}><Form.Item name={[field.name, 'warehouseId']} label="出庫倉庫" rules={[{ required: true, message: '請選擇出庫倉庫' }]}><Select showSearch optionFilterProp="label" options={warehouses.map(value => ({ value: value.id, label: `${value.code} · ${value.name}` }))} /></Form.Item></Col></Row>
      <Form.Item name={[field.name, 'serialNumber']} label="SN" rules={products[order.items[index].unitId]?.hasSerialNumbers ? [{ required: true, whitespace: true, message: '請填寫 SN' }] : []}><Input maxLength={100} /></Form.Item>
    </div>)}</Form.List><Form.Item name="nextUserId" label="指定點收人" rules={[{ required: true, message: '請指定收發點收人' }]}><RecipientPicker people={people} label="收發點收人" /></Form.Item></>}
    {(prepare || accept) && <Form.Item name="location" label={prepare ? '交接儲位' : '實際存放儲位'} rules={[{ required: true, message: '請選擇寄件儲位' }]}><OutboundLocationPicker entityId={entityId} /></Form.Item>}
    {dispatch && <Row gutter={16}><Col xs={24} md={12}><Form.Item name="carrier" label="物流公司" rules={[{ required: true, whitespace: true, message: '請填寫物流公司' }]}><Input maxLength={100} /></Form.Item></Col><Col xs={24} md={12}><Form.Item name="trackingNumber" label="寄出單號" rules={[{ required: true, whitespace: true, message: '請填寫寄出單號' }]}><Input maxLength={100} /></Form.Item></Col></Row>}
    <Form.Item name="confirmedItems" valuePropName="checked" rules={[{ validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('請確認本次實物')) }]}><Checkbox>{prepare ? '已核對實際產品、數量與 SN' : accept ? '已收到並核對本次實物' : '已核對並將本次實物交給物流'}</Checkbox></Form.Item>
    <Space wrap><Button type="primary" htmlType="submit" loading={busy}>{prepare ? '正式出庫並交收發' : accept ? '本人確認點收' : '登記交物流'}</Button>{cancelButton}</Space>
  </Form>
}

function PendingSummary({ pending }: { pending: OutboundPending }) {
  const body = JSON.parse(pending.body) as OutboundCommand & { lines?: { quantity: number }[] }
  const labels = { prepare: '備貨出庫', accept: '本人點收', dispatch: '交物流', cancel: '取消出貨', retry_sync: '重送售後同步', refresh_source: '更新案件' }
  return <Descriptions size="small" column={1} style={{ marginBottom: 16 }} items={[
    { key: 'action', label: '原操作', children: pending.kind === 'create' ? `建立出貨 · ${body.lines!.reduce((sum, line) => sum + line.quantity, 0)} 件` : labels[body.action] },
    ...(body.location ? [{ key: 'location', label: '原儲位', children: body.location }] : []),
    ...(body.items ? [{ key: 'units', label: '原備貨品項', children: body.items.map(item => `${item.sku} · ${item.serialNumber || '無 SN'}`).join('；') }] : []),
    ...(body.carrier ? [{ key: 'tracking', label: '原物流／單號', children: `${body.carrier} · ${body.trackingNumber}` }] : []),
  ]} />
}

function OutboundLocationPicker({ entityId, value, onChange, disabled }: { entityId: string; value?: string; onChange?: (value: string) => void; disabled?: boolean }) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]), [failure, setFailure] = useState(''), [loading, setLoading] = useState(true)
  useEffect(() => {
    const abort = new AbortController()
    void api.get<{ racks: { id: string; name: string; zone: string; isActive: boolean }[]; locations: { rackId: string; code: string; name: string; isActive: boolean; purpose?: string | null }[] }>('/mailroom/storage', { params: { entityId }, signal: abort.signal }).then(response => {
      if (abort.signal.aborted) return
      const racks = new Map(response.data.racks.filter(rack => rack.isActive).map(rack => [rack.id, rack]))
      setOptions(response.data.locations.filter(location => location.isActive && racks.has(location.rackId) && (location.purpose ?? racks.get(location.rackId)!.zone) === 'OUTBOUND').map(location => ({ value: location.code, label: `${location.code} · ${racks.get(location.rackId)!.name}${location.name !== location.code ? ' · ' + location.name : ''}` })))
    }).catch(e => { if (!abort.signal.aborted) setFailure(errorText(e)) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [entityId])
  return <><Select aria-label="選擇寄件儲位" showSearch optionFilterProp="label" value={value} onChange={onChange} disabled={disabled} loading={loading} options={options} placeholder="選擇寄件儲位" notFoundContent={loading ? <Spin size="small" /> : '尚未建立寄件儲位'} />{failure && <Alert type="error" message={failure} />}</>
}
