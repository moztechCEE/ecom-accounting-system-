import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { b2bAdminService } from '../../services/b2b-admin.service'
import type { B2BGuestRequestDetail, B2BGuestRequestSummary } from '../../services/b2b-admin.service'
import CustomerSearchSelect from '../../components/CustomerSearchSelect'
import { statusText } from './order'

const { Text, Title } = Typography
const pageSize = 20
const money = (value: string | number) => `NT$ ${Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`
const errorText = (error: unknown) => {
  const value = error as { response?: { data?: { message?: string } }; message?: string }
  return value?.response?.data?.message || value?.message || '操作失敗，請稍後重試。'
}

type ConversionLine = { included: boolean; quantity: number | null; netUnitPrice: number | null }
const initialConversionLines = (request: B2BGuestRequestDetail): Record<string, ConversionLine> => Object.fromEntries(
  request.items.map((item) => [item.id, { included: true, quantity: item.quantity, netUnitPrice: null }]),
)
const validNetPrice = (value: number | null) => value != null && Number.isFinite(value) && value > 0 && value <= 100000000 && Number(value.toFixed(2)) === value

export default function GuestInquiryManager({ entityId, canWrite, onOpenRequest }: { entityId: string; canWrite: boolean; onOpenRequest?: (requestId: string) => void }) {
  const [rows, setRows] = useState<B2BGuestRequestSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<B2BGuestRequestSummary['status'] | undefined>('NEW')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<B2BGuestRequestDetail | null>(null)
  const [conversionLines, setConversionLines] = useState<Record<string, ConversionLine>>({})
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [priceApplying, setPriceApplying] = useState(false)
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
    setConversionLines({})
    setDetailLoading(true)
    setRejecting(false)
    setRejectReason('')
    matchForm.resetFields()
    try {
      const request = await b2bAdminService.guestRequest(id, entityId)
      setDetail(request)
      setConversionLines(initialConversionLines(request))
    }
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
      setConversionLines(initialConversionLines(matched))
      message.success('訪客需求已配對客戶主檔；請選擇轉入內部需求的品項、數量及未稅單價。')
      setPage(1)
      setStatus('MATCHED')
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

  const updateConversionLine = (id: string, patch: Partial<ConversionLine>) => {
    setConversionLines((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }))
  }

  const convert = async () => {
    if (!openId || !detail || detail.status !== 'MATCHED' || detail.convertedRequestId || !canWrite || saving) return
    const selected = detail.items.filter((item) => conversionLines[item.id]?.included)
    if (!selected.length || selected.length > 100) { message.error('請選擇 1 至 100 項要轉入內部需求的商品。'); return }
    const items = selected.map((item) => ({
      id: item.id,
      quantity: conversionLines[item.id]?.quantity,
      netUnitPrice: conversionLines[item.id]?.netUnitPrice,
    }))
    if (items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity == null || item.quantity < 1 || item.quantity > (detail.items.find((line) => line.id === item.id)?.quantity || 0))) {
      message.error('每項轉入數量須為正整數，且不可超過訪客原始申購數量。')
      return
    }
    if (items.some((item) => !validNetPrice(item.netUnitPrice))) {
      message.error('請為每項轉入商品人工填寫大於零、最多兩位小數的未稅單價。')
      return
    }
    try {
      setSaving(true)
      const converted = await b2bAdminService.convertGuestRequest(openId, {
        entityId,
        items: items.map((item) => ({ id: item.id, quantity: item.quantity!, netUnitPrice: item.netUnitPrice! })),
      })
      setDetail({ ...detail, convertedRequestId: converted.requestId, convertedRequestNumber: converted.requestNumber, convertedRequestStatus: 'pending_stock_review' })
      message.success(converted.alreadyConverted ? `已確認既有內部需求 ${converted.requestNumber}` : `已建立內部需求 ${converted.requestNumber}，待人工核庫。`)
      try { setDetail(await b2bAdminService.guestRequest(openId, entityId)) }
      catch { message.warning('內部需求已建立，但無法更新畫面狀態；請重新開啟此訪客需求核對。') }
      await reload()
    } catch (reason) {
      message.error(`${errorText(reason)} 若結果不明，請先重新讀取此訪客需求，避免重複轉單。`)
      try { setDetail(await b2bAdminService.guestRequest(openId, entityId)) }
      catch { /* Keep the prior detail visible for staff to reopen. */ }
    } finally { setSaving(false) }
  }

  const applyCustomerPrice = async () => {
    if (!detail?.matchedCustomerId || detail.status !== 'MATCHED' || priceApplying || saving) return
    const selected = detail.items.filter((item) => conversionLines[item.id]?.included)
    if (!selected.length || selected.some((item) => !Number.isSafeInteger(conversionLines[item.id]?.quantity) || (conversionLines[item.id]?.quantity ?? 0) < 1 || (conversionLines[item.id]?.quantity ?? 0) > item.quantity)) {
      message.error('請先選擇品項並確認轉入數量。')
      return
    }
    try {
      setPriceApplying(true)
      const result = await b2bAdminService.previewCustomerDiscount(detail.matchedCustomerId, {
        entityId,
        items: selected.map((item) => ({ productId: item.productId, quantity: conversionLines[item.id].quantity! })),
      })
      if (result.items.length !== selected.length || result.items.some((line, index) =>
        line.productId !== selected[index].productId || !line.eligible || line.quoteUnitPrice == null || !validNetPrice(Number(line.quoteUnitPrice)))) {
        const reason = result.items.find((line) => !line.eligible || line.quoteUnitPrice == null)?.reason
        message.warning(reason === 'tax_conversion_policy_required'
          ? '部分價格含稅，尚無核准的未稅轉換規則；請逐項人工填寫未稅單價。'
          : '無法完整帶入客戶常用未稅價，請逐項核對價格設定後再填寫。')
        return
      }
      setConversionLines((current) => {
        const next = { ...current }
        selected.forEach((item, index) => { next[item.id] = { ...next[item.id], netUnitPrice: Number(result.items[index].quoteUnitPrice) } })
        return next
      })
      message.success('已帶入客戶常用未稅價供本次參考；請逐項確認，轉單不會修改未來價格規則。')
    } catch (reason) { message.error(errorText(reason)) }
    finally { setPriceApplying(false) }
  }

  const columns: ColumnsType<B2BGuestRequestSummary> = [
    { title: '參考編號', dataIndex: 'reference', key: 'reference', width: 170 },
    { title: '公司', dataIndex: 'companyName', key: 'company' },
    { title: '聯絡人', dataIndex: 'contactName', key: 'contact' },
    { title: '採購單號', dataIndex: 'customerPoNumber', key: 'po', render: (value: string | null) => value || '—' },
    { title: '品項數', dataIndex: 'itemCount', key: 'count', align: 'right' },
    { title: '送出時間', dataIndex: 'createdAt', key: 'created', render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm') },
    { title: '訪客需求狀態', dataIndex: 'status', key: 'status', render: (value: B2BGuestRequestSummary['status']) => <Tag color={value === 'NEW' ? 'gold' : value === 'MATCHED' ? 'green' : 'default'}>{value === 'NEW' ? '待核實顧客' : value === 'MATCHED' ? '已配對顧客' : '已標記無效'}</Tag> },
    { title: '後續內部需求', key: 'converted', render: (_, row) => row.convertedRequestId ? <Space direction="vertical" size={0}><Text strong>{row.convertedRequestNumber || row.convertedRequestId}</Text><Text type="secondary">{row.convertedRequestStatus ? statusText[row.convertedRequestStatus] : '請開啟明細確認'}</Text></Space> : <Text type="secondary">尚未建立</Text> },
    { title: '操作', key: 'actions', render: (_, row) => <Button size="small" onClick={() => void open(row.id)}>查看與處理</Button> },
  ]

  return <>
    <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="訪客送出的是待核實的採購需求，建議售價僅供參考，未預留庫存。" description="核實顧客並配對主檔後，由員工選擇商品與數量、逐項填入未稅單價，才能建立內部待人工核庫需求。之後須另行人工核庫、出具正式報價；客戶接受且業務確認接單後才會建立銷貨單並依流程預留庫存。" />
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}><Input.Search placeholder="搜尋公司、聯絡人、Email 或採購單號" allowClear style={{ width: 350 }} onSearch={(value) => { setPage(1); setSearch(value.trim()) }} /><Select<'ALL' | 'NEW' | 'MATCHED' | 'REJECTED'> style={{ width: 150 }} value={status || 'ALL'} onChange={(value) => { setPage(1); setStatus(value === 'ALL' ? undefined : value) }} options={[{ value: 'NEW', label: '待核實顧客' }, { value: 'MATCHED', label: '已配對顧客' }, { value: 'REJECTED', label: '已標記無效' }, { value: 'ALL', label: '全部狀態' }]} /><Button onClick={() => void reload()} loading={loading}>重新整理</Button></div>
    {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
    <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 1120 }} pagination={{ current: page, pageSize, total, showSizeChanger: false, onChange: setPage, showTotal: (count) => `共 ${count} 筆訪客需求` }} />

    <Modal title={`訪客採購需求 · ${detail?.reference || ''}`} open={Boolean(openId)} width={900} footer={<Button onClick={() => { setOpenId(null); setDetail(null) }}>關閉</Button>} onCancel={() => { setOpenId(null); setDetail(null) }} destroyOnHidden>
      {detailLoading ? <Text>正在載入需求…</Text> : null}
      {!detailLoading && !detail ? <Alert type="error" message="無法取得需求明細，請關閉後重試。" /> : null}
      {detail ? <>
        <Space wrap size="large"><div><Text type="secondary">公司</Text><br /><Text strong>{detail.companyName}</Text></div><div><Text type="secondary">聯絡人</Text><br /><Text strong>{detail.contactName}</Text></div><div><Text type="secondary">Email</Text><br /><Text>{detail.contactEmail}</Text></div><div><Text type="secondary">電話</Text><br /><Text>{detail.contactPhone || '—'}</Text></div><div><Text type="secondary">採購單號</Text><br /><Text>{detail.customerPoNumber || '—'}</Text></div></Space>
        {detail.note ? <p style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}><Text type="secondary">顧客備註：</Text>{detail.note}</p> : null}
        <Title level={5} style={{ marginTop: 25 }}>原始訪客需求 · 送出時的建議售價快照</Title>
        <Table size="small" rowKey="id" pagination={false} dataSource={detail.items} columns={[{ title: '商品', key: 'product', render: (_, item) => `${item.sku} · ${item.name}` }, { title: '數量', dataIndex: 'quantity', key: 'qty', align: 'right' }, { title: '建議售價', key: 'msrp', align: 'right', render: (_, item) => `${money(item.msrp)}（${item.taxBasis === 'TAX_INCLUDED' ? '含稅' : '未稅'}）` }]} scroll={{ x: 600 }} />
        {detail.status === 'MATCHED' ? <Alert style={{ marginTop: 18 }} type="success" showIcon message={`已配對：${detail.matchedCustomerName || detail.matchedCustomerId || '客戶主檔'}`} description={detail.matchReason || undefined} /> : detail.status === 'REJECTED' ? <Alert style={{ marginTop: 18 }} type="info" showIcon message="已標記為無效需求" description={detail.rejectionReason || undefined} /> : canWrite ? <div style={{ marginTop: 22 }}><Alert type="info" showIcon message="人工配對客戶主檔" description="請先用既有聯絡方式核實顧客身分；僅同名公司不足以作為配對依據。此操作不會建立銷貨單或扣庫。" /><Form form={matchForm} layout="vertical" style={{ marginTop: 16 }}><Form.Item name="customerId" label="核實後的客戶主檔" rules={[{ required: true, message: '請選擇客戶' }]}><CustomerSearchSelect entityId={entityId} enabled={Boolean(openId)} /></Form.Item><Form.Item name="reason" label="身分核實與配對依據（10–1,000 字）" rules={[{ required: true, min: 10, max: 1000, message: '請填寫 10 至 1,000 字的配對依據' }]}><Input.TextArea rows={3} maxLength={1000} /></Form.Item><Space><Button type="primary" loading={saving} onClick={() => void match()}>確認配對客戶</Button><Button danger disabled={saving} onClick={() => setRejecting(true)}>標記為無效需求</Button></Space></Form></div> : null}
        {detail.convertedRequestId ? <Alert style={{ marginTop: 18 }} type="info" showIcon message={`後續內部需求：${detail.convertedRequestNumber || detail.convertedRequestId}`} description={<Space direction="vertical"><Text>狀態：{detail.convertedRequestStatus ? statusText[detail.convertedRequestStatus] : '請重新整理確認'}。請{onOpenRequest ? '前往' : '切換上方「採購需求」分頁，於'}採購需求工作台查核人工核庫、正式報價及銷貨單紀錄；只有正式接單流程才會預留庫存。訪客建議售價快照不是內部未稅單價。</Text>{onOpenRequest ? <Button type="primary" size="small" onClick={() => { setOpenId(null); onOpenRequest(detail.convertedRequestId!) }}>前往採購需求工作台</Button> : null}</Space>} /> : null}
        {detail.status === 'MATCHED' && !detail.convertedRequestId && canWrite ? <div style={{ marginTop: 22 }}>
          <Alert type="warning" showIcon message="建立內部待人工核庫需求" description="請取消勾選無法供應的品項，或調低要轉入的數量；原始訪客需求快照不會修改。每項未稅單價須由員工人工決定，不能直接把訪客建議售價當作成交價。此步驟不出具正式報價、不建立銷貨單，也不預留庫存。" />
          <Space style={{ marginTop: 18 }} wrap><Title level={5} style={{ margin: 0 }}>轉入品項與未稅試算單價</Title><Button loading={priceApplying} disabled={saving} onClick={() => void applyCustomerPrice()}>帶入客戶常用未稅價</Button></Space>
          <Table size="small" rowKey="id" pagination={false} dataSource={detail.items} scroll={{ x: 760 }} columns={[
            { title: '轉入', key: 'included', width: 70, render: (_, item) => <Checkbox checked={conversionLines[item.id]?.included ?? false} disabled={saving} onChange={(event) => updateConversionLine(item.id, { included: event.target.checked })} aria-label={`轉入 ${item.name}`} /> },
            { title: '商品', key: 'product', render: (_, item) => <><Text strong>{item.name}</Text><br /><Text type="secondary">{item.sku}</Text></> },
            { title: '訪客原始數量', dataIndex: 'quantity', key: 'original', width: 115, align: 'right' },
            { title: '轉入數量', key: 'quantity', width: 125, render: (_, item) => <InputNumber min={1} max={item.quantity} precision={0} style={{ width: 105 }} value={conversionLines[item.id]?.quantity} disabled={!conversionLines[item.id]?.included || saving} onChange={(value) => updateConversionLine(item.id, { quantity: value })} aria-label={`${item.name} 轉入數量`} /> },
            { title: '人工未稅單價', key: 'netPrice', width: 170, render: (_, item) => <InputNumber min={0.01} max={100000000} precision={2} prefix="NT$" style={{ width: 150 }} value={conversionLines[item.id]?.netUnitPrice} disabled={!conversionLines[item.id]?.included || saving} onChange={(value) => updateConversionLine(item.id, { netUnitPrice: value })} aria-label={`${item.name} 人工未稅單價`} /> },
          ]} />
          <Space style={{ marginTop: 12 }} wrap><Text type="secondary">已選 {detail.items.filter((item) => conversionLines[item.id]?.included).length} 項；轉入後仍須人工核庫並另行報價。</Text><Button type="primary" loading={saving} onClick={() => void convert()}>建立內部待核庫需求</Button></Space>
        </div> : null}
      </> : null}
    </Modal>
    <Modal title={`標記無效需求 · ${detail?.reference || ''}`} open={rejecting} onCancel={() => { setRejecting(false); setRejectReason('') }} onOk={() => void reject()} okText="確認標記無效" okButtonProps={{ danger: true, disabled: rejectReason.trim().length < 10 }} confirmLoading={saving} destroyOnHidden>
      <Alert type="warning" showIcon message="此操作會將需求移出待核實清單，不會自動通知訪客。" style={{ marginBottom: 16 }} />
      <label htmlFor="guest-reject-reason">無效原因（10–1,000 字）</label>
      <Input.TextArea id="guest-reject-reason" rows={4} maxLength={1000} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} style={{ marginTop: 8 }} />
    </Modal>
  </>
}
