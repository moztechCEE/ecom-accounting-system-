import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import dayjs, { type Dayjs } from 'dayjs'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ReloadOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useEntityContext } from '../hooks/useEntityContext'
import { hasPermission } from '../utils/access'
import {
  wmsReconciliationService,
  type HandoverEvent,
  type HandoverLine,
  type HandoverListStatus,
} from '../services/wms-reconciliation.service'
import { reviewHandoverLine } from './wms-handover-review'

const { Text, Title } = Typography

const eventStatus: Record<HandoverEvent['status'], { label: string; color: string }> = {
  pending: { label: '待核銷', color: 'gold' },
  partial: { label: '部分已過帳', color: 'blue' },
  posted: { label: '已完成過帳', color: 'green' },
}

function dateTime(value?: string | null): string {
  return value ? dayjs(value).format('YYYY/MM/DD HH:mm') : '—'
}

function handoverMethod(value?: string | null): string {
  return value === 'carrier_collection' ? '物流收件' : value === 'customer_pickup' ? '客戶自取' : value || '待確認'
}

function apiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { message?: string | string[] } | undefined
    const detail = Array.isArray(body?.message) ? body.message.join('；') : body?.message
    if (detail) return detail
    if (error.response?.status === 409) return '庫存或來源訂單已變更，請重新核對後再試。'
    if (!error.response) return '無法連接系統，請檢查網路後重試。'
  }
  return fallback
}

export default function WmsHandoverReconciliationPage() {
  const { user } = useAuth()
  const entityId = useEntityContext()
  const canPost = hasPermission(user, 'inventory:update')
  const [status, setStatus] = useState<HandoverListStatus>('pending')
  const [events, setEvents] = useState<HandoverEvent[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [search, setSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [handoverDate, setHandoverDate] = useState<Dayjs | null>(null)
  const occurredOn = handoverDate?.format('YYYY-MM-DD')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HandoverEvent | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [refreshDetail, setRefreshDetail] = useState(0)
  const [postingLine, setPostingLine] = useState<HandoverLine | null>(null)
  const [posting, setPosting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [postNote, setPostNote] = useState('')
  const [postConflict, setPostConflict] = useState('')
  const listRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++listRequest.current
    if (!entityId) {
      setEvents([])
      setTotal(0)
      setListError('請先選擇作業公司。')
      setLoading(false)
      return
    }
    setLoading(true)
    setListError('')
    try {
      const result = await wmsReconciliationService.list(entityId, status, page, pageSize, {
        ...(submittedSearch ? { search: submittedSearch } : {}),
        ...(occurredOn ? { occurredOn } : {}),
      })
      if (request === listRequest.current) {
        setEvents(result.items)
        setTotal(result.total)
        if (page > 1 && result.total <= (page - 1) * pageSize) setPage(Math.max(1, Math.ceil(result.total / pageSize)))
      }
    } catch (error) {
      if (request === listRequest.current) setListError(apiError(error, '無法載入交運待核銷清單。'))
    } finally {
      if (request === listRequest.current) setLoading(false)
    }
  }, [entityId, status, page, submittedSearch, occurredOn])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSubmittedSearch(search.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    void load()
    return () => { listRequest.current += 1 }
  }, [load])

  useEffect(() => {
    if (!selectedId || !entityId) return
    let active = true
    setDetail(null)
    setDetailLoading(true)
    setDetailError('')
    wmsReconciliationService.detail(entityId, selectedId)
      .then((row) => { if (active) setDetail(row) })
      .catch((error) => { if (active) setDetailError(apiError(error, '無法載入交運明細。')) })
      .finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [selectedId, entityId, refreshDetail])

  const openPost = (line: HandoverLine) => {
    setPostConflict('')
    setPostNote('')
    setConfirmed(false)
    setPostingLine(line)
  }

  const post = async () => {
    if (!entityId || !detail || !postingLine || !confirmed || posting || !canPost) return
    const review = reviewHandoverLine(postingLine)
    if (review.blocking || !detail.handover?.method || !detail.handover?.operatorId) return
    setPosting(true)
    setPostConflict('')
    try {
      const result = await wmsReconciliationService.postLine(entityId, postingLine.id, postNote)
      message.success(result.alreadyPosted ? '這筆明細先前已過帳，未重複扣庫。' : '已核准本次交運，正式出庫過帳完成。')
      setPostingLine(null)
      setRefreshDetail((current) => current + 1)
      await load()
    } catch (error) {
      const text = apiError(error, '正式出庫過帳失敗，請重新核對。')
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setPostConflict(text)
        setPostingLine(null)
        setConfirmed(false)
        setRefreshDetail((current) => current + 1)
        await load()
      } else {
        message.error(text)
      }
    } finally {
      setPosting(false)
    }
  }

  const eventColumns: ColumnsType<HandoverEvent> = [
    { title: '銷售訂單', dataIndex: 'orderNumber', key: 'orderNumber', render: (value: string) => <Text strong>{value}</Text> },
    { title: '實際交運時間', dataIndex: 'occurredAt', key: 'occurredAt', render: dateTime },
    { title: '交運方式／物流', key: 'handover', render: (_, row) => <span>{handoverMethod(row.handover?.method)}<br /><Text type="secondary">{row.handover?.carrier || row.handover?.trackingNo || (row.handover?.method === 'customer_pickup' ? '由客戶自取' : '未填物流資料')}</Text></span> },
    { title: '待核銷明細', key: 'pendingCount', align: 'right', render: (_, row) => row.lines.filter((line) => line.status === 'pending').length },
    { title: '狀態', dataIndex: 'status', key: 'status', render: (value: HandoverEvent['status']) => <Tag color={eventStatus[value]?.color || 'default'}>{eventStatus[value]?.label || value}</Tag> },
    { title: '操作', key: 'action', render: (_, row) => <Button size="small" onClick={() => { setSelectedId(row.id); setPostConflict('') }}>查看逐行證據</Button> },
  ]

  const lineColumns: ColumnsType<HandoverLine> = [
    { title: '商品', key: 'product', width: 180, render: (_, line) => <span><Text strong>{line.productName}</Text><br /><Text type="secondary">{line.sku}</Text></span> },
    { title: '銷單量', dataIndex: 'orderedQuantity', key: 'orderedQuantity', align: 'right', width: 82 },
    { title: '已過帳', dataIndex: 'postedQuantity', key: 'postedQuantity', align: 'right', width: 82 },
    { title: '本次實交', dataIndex: 'quantity', key: 'quantity', align: 'right', width: 92, render: (value: number) => <Text strong>{value}</Text> },
    { title: '數量核對', key: 'review', width: 190, render: (_, line) => {
      const review = reviewHandoverLine(line)
      return <span><Tag color={review.color}>{review.label}</Tag><br /><Text type="secondary" style={{ fontSize: 12 }}>{review.detail}</Text></span>
    } },
    { title: '箱件證據', key: 'packages', width: 175, render: (_, line) => line.packages?.length ? <Space size={[2, 3]} wrap>{line.packages.map((box) => <Tag key={box.packageId}>{box.packageId} · {box.quantity} 件</Tag>)}</Space> : <Text type="secondary">無箱件資料</Text> },
    { title: '過帳結果', key: 'posted', width: 165, render: (_, line) => line.status === 'posted' ? <span><Tag color="green">已正式出庫</Tag><br /><Text type="secondary">{dateTime(line.postedAt)}<br />過帳人 {line.postedBy || '—'}<br />本幣成本 {line.totalCostBase ?? '—'}</Text></span> : <Tag color="gold">尚未扣正式庫存</Tag> },
    { title: '操作', key: 'action', width: 125, render: (_, line) => {
      const review = reviewHandoverLine(line)
      const hasEvidence = Boolean(detail?.handover?.method && detail?.handover?.operatorId)
      return line.status === 'pending' && canPost
        ? <Button type="primary" size="small" disabled={review.blocking || !hasEvidence} onClick={() => openPost(line)}>核准過帳</Button>
        : null
    } },
  ]

  const selectedReview = postingLine ? reviewHandoverLine(postingLine) : null
  const selectedHandover = detail?.handover
  const pendingLines = events.reduce((count, row) => count + row.lines.filter((line) => line.status === 'pending').length, 0)

  return <div className="page-section-stack" style={{ maxWidth: 1500, margin: '0 auto', padding: '10px 4px 50px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
      <div><Title level={2} style={{ marginBottom: 4 }}>交運待核銷</Title><Text type="secondary">比對 WMS 實際交運與 ERP 銷售訂單，按明細人工核准正式出庫。</Text></div>
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>重新整理</Button>
    </div>
    <Alert type="warning" showIcon message="裝箱完成不等於已交運或已出庫" description="只有 WMS 留下實際交運事件與箱件／物流證據後，才會出現在這裡。逐行核准後才正式扣除 ERP 帳面庫存；待核銷期間仍須保留原銷單預留。" />
    {!canPost ? <Alert type="info" showIcon message="目前為檢視模式" description="需要「庫存更新」權限才能核准正式出庫。" /> : null}
    <Card>
      <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 18 }}>
        <Space wrap>
          <Segmented value={status} onChange={(value) => { setPage(1); setStatus(value as HandoverListStatus) }} options={[{ label: '待核銷', value: 'pending' }, { label: '已過帳', value: 'posted' }, { label: '全部', value: 'all' }]} />
          <Input.Search allowClear maxLength={128} placeholder="搜尋銷單、交運事件、SKU" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 300 }} />
          <DatePicker value={handoverDate} onChange={(date) => { setPage(1); setHandoverDate(date) }} placeholder="交運日期（台灣時間）" allowClear />
        </Space>
        <Text type="secondary">共 {total} 筆事件 · 本頁待核銷 {pendingLines} 筆明細</Text>
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>搜尋與交運日期套用至全部事件，日期以台灣時間計算。</Text>
      {listError ? <Alert type="error" showIcon message={listError} style={{ marginBottom: 16 }} action={entityId ? <Button size="small" onClick={() => void load()}>重試</Button> : undefined} /> : null}
      <Table rowKey="id" columns={eventColumns} dataSource={events} loading={loading} scroll={{ x: 920 }} pagination={{ current: page, pageSize, total, showSizeChanger: false, onChange: setPage }} locale={{ emptyText: status === 'pending' ? '目前沒有待核銷交運事件。裝箱完成但未交運的訂單不會出現在此。' : '目前沒有符合條件的交運事件。' }} />
    </Card>

    <Drawer title={detail ? `交運證據 · ${detail.orderNumber}` : '交運證據'} open={Boolean(selectedId)} width={1120} closable={!posting} maskClosable={!posting} onClose={() => { if (posting) return; setSelectedId(null); setDetail(null); setPostConflict(''); setPostingLine(null) }} destroyOnClose>
      {detailLoading ? <Text>正在載入實際交運證據…</Text> : null}
      {detailError ? <Alert type="error" showIcon message={detailError} action={<Button size="small" onClick={() => setRefreshDetail((current) => current + 1)}>重試</Button>} /> : null}
      {postConflict ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message="本次核准未過帳；資料已更新，請重新核對" description={postConflict} /> : null}
      {detail ? <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert type="info" showIcon message="以下為實際交運紀錄；只核准有證據且數量未超過銷單餘量的明細。" />
        <Descriptions title="交運來源與物流證據" bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="銷售訂單">{detail.orderNumber}</Descriptions.Item>
          <Descriptions.Item label="交運狀態"><Tag color={eventStatus[detail.status]?.color || 'default'}>{eventStatus[detail.status]?.label || detail.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="實際交運時間">{dateTime(detail.occurredAt)}</Descriptions.Item>
          <Descriptions.Item label="ERP 收到事件">{dateTime(detail.receivedAt)}</Descriptions.Item>
          <Descriptions.Item label="交運方式">{handoverMethod(selectedHandover?.method)}</Descriptions.Item>
          <Descriptions.Item label="承運商">{selectedHandover?.carrier || '—'}</Descriptions.Item>
          <Descriptions.Item label="物流單號">{selectedHandover?.trackingNo || '—'}</Descriptions.Item>
          <Descriptions.Item label="交運清單">{selectedHandover?.manifestId || '—'}</Descriptions.Item>
          <Descriptions.Item label="WMS 操作人 ID">{selectedHandover?.operatorId || '—'}</Descriptions.Item>
          <Descriptions.Item label="來源事件 ID"><Text copyable>{detail.eventId}</Text></Descriptions.Item>
          <Descriptions.Item label="WMS 出貨 ID"><Text copyable>{detail.shipmentId}</Text></Descriptions.Item>
          {detail.nativeIntakeId ? <Descriptions.Item label="WMS 預揀單號">{detail.nativeIntakeId}</Descriptions.Item> : null}
          {detail.wmsOrderId ? <Descriptions.Item label="WMS 工作單號">{detail.wmsOrderId}</Descriptions.Item> : null}
          {selectedHandover?.note ? <Descriptions.Item label="交運備註" span={2}>{selectedHandover.note}</Descriptions.Item> : null}
        </Descriptions>
        {!selectedHandover?.method || !selectedHandover?.operatorId ? <Alert type="error" showIcon message="交運證據不完整，請先查明 WMS 事件" /> : null}
        <div><Title level={4}>逐行核對與過帳</Title><Text type="secondary">「已過帳」為同一銷單明細先前累計；待核銷行的本次實交量尚未計入。</Text></div>
        <Table rowKey="id" size="small" columns={lineColumns} dataSource={detail.lines} scroll={{ x: 1100 }} pagination={false} locale={{ emptyText: '沒有交運明細，無法核准過帳。' }} />
      </Space> : null}
    </Drawer>

    <Modal title="核准正式出庫過帳" open={Boolean(postingLine)} confirmLoading={posting} okText="確認核准並過帳" okButtonProps={{ danger: true, disabled: !confirmed || Boolean(selectedReview?.blocking) }} onOk={() => void post()} onCancel={() => { if (!posting) setPostingLine(null) }} closable={!posting} maskClosable={!posting}>
      {postingLine && detail ? <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="warning" showIcon message="核准後即正式扣除 ERP 帳面庫存" description="請核對 WMS 實際交運、箱件證據、銷售訂單與數量。裝箱紀錄本身不能作為正式出庫依據。" />
        <Descriptions size="small" bordered column={1}>
          <Descriptions.Item label="銷售訂單">{detail.orderNumber}</Descriptions.Item>
          <Descriptions.Item label="商品">{postingLine.sku} · {postingLine.productName}</Descriptions.Item>
          <Descriptions.Item label="訂購／既有過帳／本次實交">{postingLine.orderedQuantity}／{postingLine.postedQuantity}／{postingLine.quantity} 件</Descriptions.Item>
          <Descriptions.Item label="本次過帳後累計">{postingLine.postedQuantity + postingLine.quantity} 件</Descriptions.Item>
          <Descriptions.Item label="箱件">{postingLine.packages?.map((box) => `${box.packageId} × ${box.quantity}`).join('、') || '無箱件資料'}</Descriptions.Item>
          <Descriptions.Item label="交運事件">{detail.eventId}</Descriptions.Item>
        </Descriptions>
        {selectedReview ? <Alert type={selectedReview.blocking ? 'error' : 'info'} message={selectedReview.detail} /> : null}
        <Input.TextArea rows={3} maxLength={1000} value={postNote} onChange={(event) => setPostNote(event.target.value)} placeholder="核對備註（選填，會記入過帳紀錄）" aria-label="過帳核對備註" />
        <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>我已逐行比對銷單數量、實際交運與箱件／物流證據</Checkbox>
      </Space> : null}
    </Modal>
  </div>
}
