import { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { b2bAdminService } from '../../services/b2b-admin.service'
import type { B2BGuestRequestDetail, B2BGuestRequestSummary } from '../../services/b2b-admin.service'
import CustomerSearchSelect from '../../components/CustomerSearchSelect'

const { Text, Title } = Typography
const pageSize = 20
const money = (value: string | number) => `NT$ ${Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`
const errorText = (error: unknown) => {
  const value = error as { response?: { data?: { message?: string } }; message?: string }
  return value?.response?.data?.message || value?.message || '操作失敗，請稍後重試。'
}

export default function GuestInquiryManager({ entityId, canWrite }: { entityId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<B2BGuestRequestSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<B2BGuestRequestSummary['status'] | undefined>('NEW')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<B2BGuestRequestDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [matchForm] = Form.useForm<{ customerId: string; reason: string }>()

  const reload = async () => {
    if (!entityId) return
    setLoading(true)
    setError('')
    try {
      const result = await b2bAdminService.guestRequests(entityId, { status, search, limit: pageSize, offset: (page - 1) * pageSize })
      setRows(result.rows)
      setTotal(result.total)
    } catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!entityId) return
    let active = true
    b2bAdminService.guestRequests(entityId, { status, search, limit: pageSize, offset: (page - 1) * pageSize })
      .then((result) => { if (active) { setRows(result.rows); setTotal(result.total) } })
      .catch((reason) => { if (active) setError(errorText(reason)) })
    return () => { active = false }
  }, [entityId, page, search, status])

  const open = async (id: string) => {
    setOpenId(id)
    setDetail(null)
    setDetailLoading(true)
    setRejecting(false)
    setRejectReason('')
    matchForm.resetFields()
    try { setDetail(await b2bAdminService.guestRequest(id, entityId)) }
    catch (reason) { message.error(errorText(reason)) }
    finally { setDetailLoading(false) }
  }

  const match = async () => {
    if (!openId || !detail || detail.status !== 'NEW' || !canWrite) return
    try {
      const values = await matchForm.validateFields()
      const reason = values.reason.trim()
      if (reason.length < 10 || reason.length > 1000) throw new Error('配對依據需 10 至 1,000 字，請記錄如何核實顧客身分。')
      setSaving(true)
      const matched = await b2bAdminService.matchGuestRequest(openId, { entityId, customerId: values.customerId, reason })
      setDetail(matched)
      message.success('訪客需求已配對客戶主檔；請繼續人工核對商品、庫存與正式報價。')
      await reload()
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'errorFields' in reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const reject = async () => {
    if (!openId || !detail || detail.status !== 'NEW' || !canWrite || saving) return
    const reason = rejectReason.trim()
    if (reason.length < 10 || reason.length > 1000) { message.error('無效原因需 10 至 1,000 字。'); return }
    try {
      setSaving(true)
      setDetail(await b2bAdminService.rejectGuestRequest(openId, { entityId, reason }))
      setRejecting(false)
      setRejectReason('')
      message.success('已將此需求標記為無效；系統不會自動通知訪客。')
      await reload()
    } catch (error) { message.error(errorText(error)) }
    finally { setSaving(false) }
  }

  const columns: ColumnsType<B2BGuestRequestSummary> = [
    { title: '參考編號', dataIndex: 'reference', key: 'reference', width: 170 },
    { title: '公司', dataIndex: 'companyName', key: 'company' },
    { title: '聯絡人', dataIndex: 'contactName', key: 'contact' },
    { title: '採購單號', dataIndex: 'customerPoNumber', key: 'po', render: (value: string | null) => value || '—' },
    { title: '品項數', dataIndex: 'itemCount', key: 'count', align: 'right' },
    { title: '送出時間', dataIndex: 'createdAt', key: 'created', render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm') },
    { title: '狀態', dataIndex: 'status', key: 'status', render: (value: B2BGuestRequestSummary['status']) => <Tag color={value === 'NEW' ? 'gold' : value === 'MATCHED' ? 'green' : 'default'}>{value === 'NEW' ? '待核實顧客' : value === 'MATCHED' ? '已配對顧客' : '已標記無效'}</Tag> },
    { title: '操作', key: 'actions', render: (_, row) => <Button size="small" onClick={() => void open(row.id)}>查看與處理</Button> },
  ]

  return <>
    <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="訪客送出的是待核實的採購需求，不是 ERP 銷貨單，也未預留庫存。" description="請先聯絡顧客並核對身分，再配對客戶主檔。配對本身不會建立既有 B2B 採購需求、正式報價或銷貨單；後續單據仍須依核准流程建立。" />
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}><Input.Search placeholder="搜尋公司、聯絡人、Email 或採購單號" allowClear style={{ width: 350 }} onSearch={(value) => { setPage(1); setSearch(value.trim()) }} /><Select<'ALL' | 'NEW' | 'MATCHED' | 'REJECTED'> style={{ width: 150 }} value={status || 'ALL'} onChange={(value) => { setPage(1); setStatus(value === 'ALL' ? undefined : value) }} options={[{ value: 'NEW', label: '待核實顧客' }, { value: 'MATCHED', label: '已配對顧客' }, { value: 'REJECTED', label: '已標記無效' }, { value: 'ALL', label: '全部狀態' }]} /><Button onClick={() => void reload()} loading={loading}>重新整理</Button></div>
    {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
    <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 980 }} pagination={{ current: page, pageSize, total, showSizeChanger: false, onChange: setPage, showTotal: (count) => `共 ${count} 筆訪客需求` }} />

    <Modal title={`訪客採購需求 · ${detail?.reference || ''}`} open={Boolean(openId)} width={820} footer={<Button onClick={() => { setOpenId(null); setDetail(null) }}>關閉</Button>} onCancel={() => { setOpenId(null); setDetail(null) }} destroyOnHidden>
      {detailLoading ? <Text>正在載入需求…</Text> : null}
      {!detailLoading && !detail ? <Alert type="error" message="無法取得需求明細，請關閉後重試。" /> : null}
      {detail ? <>
        <Space wrap size="large"><div><Text type="secondary">公司</Text><br /><Text strong>{detail.companyName}</Text></div><div><Text type="secondary">聯絡人</Text><br /><Text strong>{detail.contactName}</Text></div><div><Text type="secondary">Email</Text><br /><Text>{detail.contactEmail}</Text></div><div><Text type="secondary">電話</Text><br /><Text>{detail.contactPhone || '—'}</Text></div><div><Text type="secondary">採購單號</Text><br /><Text>{detail.customerPoNumber || '—'}</Text></div></Space>
        {detail.note ? <p style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}><Text type="secondary">顧客備註：</Text>{detail.note}</p> : null}
        <Title level={5} style={{ marginTop: 25 }}>商品與送出時的建議售價快照</Title>
        <Table size="small" rowKey="id" pagination={false} dataSource={detail.items} columns={[{ title: '商品', key: 'product', render: (_, item) => `${item.sku} · ${item.name}` }, { title: '數量', dataIndex: 'quantity', key: 'qty', align: 'right' }, { title: '建議售價', key: 'msrp', align: 'right', render: (_, item) => `${money(item.msrp)}（${item.taxBasis === 'TAX_INCLUDED' ? '含稅' : '未稅'}）` }]} scroll={{ x: 600 }} />
        {detail.status === 'MATCHED' ? <Alert style={{ marginTop: 18 }} type="success" showIcon message={`已配對：${detail.matchedCustomerName || detail.matchedCustomerId || '客戶主檔'}`} description={detail.matchReason || undefined} /> : detail.status === 'REJECTED' ? <Alert style={{ marginTop: 18 }} type="info" showIcon message="已標記為無效需求" description={detail.rejectionReason || undefined} /> : canWrite ? <div style={{ marginTop: 22 }}><Alert type="info" showIcon message="人工配對客戶主檔" description="請先用既有聯絡方式核實顧客身分；僅同名公司不足以作為配對依據。此操作不會建立銷貨單或扣庫。" /><Form form={matchForm} layout="vertical" style={{ marginTop: 16 }}><Form.Item name="customerId" label="核實後的客戶主檔" rules={[{ required: true, message: '請選擇客戶' }]}><CustomerSearchSelect entityId={entityId} enabled={Boolean(openId)} /></Form.Item><Form.Item name="reason" label="身分核實與配對依據（10–1,000 字）" rules={[{ required: true, min: 10, max: 1000, message: '請填寫 10 至 1,000 字的配對依據' }]}><Input.TextArea rows={3} maxLength={1000} /></Form.Item><Space><Button type="primary" loading={saving} onClick={() => void match()}>確認配對客戶</Button><Button danger disabled={saving} onClick={() => setRejecting(true)}>標記為無效需求</Button></Space></Form></div> : null}
      </> : null}
    </Modal>
    <Modal title={`標記無效需求 · ${detail?.reference || ''}`} open={rejecting} onCancel={() => { setRejecting(false); setRejectReason('') }} onOk={() => void reject()} okText="確認標記無效" okButtonProps={{ danger: true, disabled: rejectReason.trim().length < 10 }} confirmLoading={saving} destroyOnHidden>
      <Alert type="warning" showIcon message="此操作會將需求移出待核實清單，不會自動通知訪客。" style={{ marginBottom: 16 }} />
      <label htmlFor="guest-reject-reason">無效原因（10–1,000 字）</label>
      <Input.TextArea id="guest-reject-reason" rows={4} maxLength={1000} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} style={{ marginTop: 8 }} />
    </Modal>
  </>
}
