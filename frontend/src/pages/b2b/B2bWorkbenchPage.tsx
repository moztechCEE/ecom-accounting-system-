import { useEffect, useState } from 'react'
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CopyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useEntityContext } from '../../hooks/useEntityContext'
import { hasAnyPermission } from '../../utils/access'
import { b2bAdminService } from '../../services/b2b-admin.service'
import type { B2BAdminRequest, B2BAdminSetup } from '../../services/b2b-admin.service'
import { canConfirmRequest, statusText } from './order'
import CustomerSearchSelect from '../../components/CustomerSearchSelect'
import ProductSearchSelect from './ProductSearchSelect'

const { Title, Text } = Typography
const amount = (value: string | number) => `NT$ ${Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`

function errorText(error: unknown): string {
  const value = error as { response?: { data?: { message?: string } }; message?: string }
  return value?.response?.data?.message || value?.message || '操作失敗，請稍後重試。'
}
const isFormValidationError = (error: unknown) => Boolean(error && typeof error === 'object' && 'errorFields' in error)
const passwordRules = [
  { required: true, message: '請輸入密碼' },
  { validator: (_: unknown, value?: string) => {
    if (value && value.length >= 12 && new TextEncoder().encode(value).length <= 72) return Promise.resolve()
    return Promise.reject(new Error('密碼至少 12 字元，且 UTF-8 不可超過 72 bytes'))
  } },
]

type AccountValues = { accountType: 'CUSTOMER' | 'SUPPLIER'; customerId?: string; vendorId?: string; email: string; name: string; password: string }
type CatalogValues = { productId: string; unitPrice: number; isPublished: boolean }
type PriceValues = { customerId: string; productId: string; unitPrice: number; isActive: boolean; validUntil?: string }

export default function B2bWorkbenchPage() {
  const entityId = useEntityContext()
  const { user } = useAuth()
  const canWrite = hasAnyPermission(user, ['sales_orders:create'])
  const canManageSupplier = hasAnyPermission(user, ['purchase_orders:create'])
  const [setup, setSetup] = useState<B2BAdminSetup | null>(null)
  const [requests, setRequests] = useState<B2BAdminRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const [resetAccount, setResetAccount] = useState<B2BAdminSetup['accounts'][number] | null>(null)
  const [reviewing, setReviewing] = useState<B2BAdminRequest | null>(null)
  const [confirming, setConfirming] = useState<B2BAdminRequest | null>(null)
  const [channelId, setChannelId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Record<string, number>>({})
  const [reviewNote, setReviewNote] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [accountType, setAccountType] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER')
  const [accountForm] = Form.useForm<AccountValues>()
  const [catalogForm] = Form.useForm<CatalogValues>()
  const [priceForm] = Form.useForm<PriceValues>()
  const [resetForm] = Form.useForm<{ password: string }>()
  const catalogProductId = Form.useWatch('productId', catalogForm)
  const priceProductId = Form.useWatch('productId', priceForm)

  const load = async () => {
    if (!entityId) { setError('請先選擇事業別。'); return }
    setLoading(true)
    setError('')
    try {
      const [nextSetup, nextRequests] = await Promise.all([
        b2bAdminService.setup(entityId), b2bAdminService.requests(entityId),
      ])
      setSetup(nextSetup)
      setRequests(nextRequests)
    } catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!entityId) return
    let active = true
    Promise.all([b2bAdminService.setup(entityId), b2bAdminService.requests(entityId)])
      .then(([nextSetup, nextRequests]) => {
        if (!active) return
        setSetup(nextSetup)
        setRequests(nextRequests)
      })
      .catch((reason) => { if (active) setError(errorText(reason)) })
    return () => { active = false }
  }, [entityId])

  const saveAccount = async () => {
    if (!entityId) return
    try {
      const values = await accountForm.validateFields()
      setSaving(true)
      const common = { entityId, email: values.email.trim().toLowerCase(), name: values.name.trim(), password: values.password }
      if (values.accountType === 'SUPPLIER') {
        if (!canManageSupplier) throw new Error('需要採購單建立權限才能管理供應商帳號。')
        if (!values.vendorId) throw new Error('請選擇供應商。')
        await b2bAdminService.createSupplierAccount({ ...common, vendorId: values.vendorId })
      } else {
        if (!values.customerId) throw new Error('請選擇客戶。')
        await b2bAdminService.createAccount({ ...common, customerId: values.customerId })
      }
      message.success('帳號已建立')
      accountForm.resetFields()
      setAccountOpen(false)
      await load()
    } catch (reason) {
      if (!isFormValidationError(reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const updateAccount = async (account: B2BAdminSetup['accounts'][number], isActive: boolean) => {
    if (!entityId) return
    try {
      const update = account.accountType === 'SUPPLIER' ? b2bAdminService.updateSupplierAccount : b2bAdminService.updateAccount
      await update(account.id, { entityId, isActive })
      message.success(isActive ? '帳號已啟用' : '帳號已停用')
      await load()
    } catch (reason) { message.error(errorText(reason)) }
  }

  const resetPassword = async () => {
    if (!entityId || !resetAccount) return
    try {
      const values = await resetForm.validateFields()
      setSaving(true)
      const update = resetAccount.accountType === 'SUPPLIER' ? b2bAdminService.updateSupplierAccount : b2bAdminService.updateAccount
      await update(resetAccount.id, { entityId, isActive: resetAccount.isActive, password: values.password })
      resetForm.resetFields()
      setResetAccount(null)
      message.success('密碼已更新，原有登入已失效。')
      await load()
    } catch (reason) {
      if (!isFormValidationError(reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const saveCatalog = async () => {
    if (!entityId) return
    try {
      const values = await catalogForm.validateFields()
      setSaving(true)
      await b2bAdminService.saveCatalog({ ...values, entityId })
      message.success('商品發布設定已儲存')
      setCatalogOpen(false)
      await load()
    } catch (reason) {
      if (!isFormValidationError(reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const savePrice = async () => {
    if (!entityId) return
    try {
      const values = await priceForm.validateFields()
      setSaving(true)
      await b2bAdminService.savePrice({ ...values, entityId, validUntil: values.validUntil || undefined })
      message.success('客戶專屬價格已儲存')
      setPriceOpen(false)
      await load()
    } catch (reason) {
      if (!isFormValidationError(reason)) message.error(errorText(reason))
    } finally { setSaving(false) }
  }

  const openReview = (request: B2BAdminRequest) => {
    setReviewing(request)
    setConfirmed(Object.fromEntries(request.items.map((item) => [item.id, item.quantity])))
    setReviewNote('')
    setDeliveryDate('')
  }
  const saveReview = async () => {
    if (!entityId || !reviewing) return
    const items = reviewing.items.map((item) => ({ id: item.id, confirmedQuantity: confirmed[item.id] }))
    if (items.some((item, index) => !Number.isSafeInteger(item.confirmedQuantity) || item.confirmedQuantity < 0 || item.confirmedQuantity > reviewing.items[index].quantity)) {
      message.error('每項確認數量需為 0 到申購數量的整數。')
      return
    }
    if (items.some((item, index) => item.confirmedQuantity !== reviewing.items[index].quantity) && !reviewNote.trim()) {
      message.error('供貨數量有調整時，請填寫原因。')
      return
    }
    try {
      setSaving(true)
      await b2bAdminService.reviewRequest(reviewing.id, { entityId, items, ...(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}), ...(deliveryDate ? { deliveryDate } : {}) })
      message.success('庫存人工核對結果已儲存')
      setReviewing(null)
      await load()
    } catch (reason) { message.error(errorText(reason)) }
    finally { setSaving(false) }
  }

  const confirmRequest = async () => {
    if (!entityId || !confirming) return
    if (!channelId || !warehouseId) {
      message.error('請選擇銷售通路與出貨倉庫。')
      return
    }
    try {
      setSaving(true)
      const result = await b2bAdminService.confirmRequest(confirming.id, { entityId, channelId, warehouseId })
      setConfirmedOrderId(result.salesOrderId)
      setConfirming(null)
      message.success(result.alreadyConfirmed ? '此需求先前已建立銷售訂單。' : '已建立 ERP 銷售訂單並預留庫存。')
      await load()
    } catch (reason) { message.error(errorText(reason)) }
    finally { setSaving(false) }
  }

  const copyQuote = async (request: B2BAdminRequest) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/b2b/requests/${encodeURIComponent(request.id)}`)
      message.success('連結已複製，可貼至 LINE。客戶須登入後查看。')
    } catch { message.error('複製失敗，請檢查瀏覽器剪貼簿權限。') }
  }

  const customerName = (id: string | null) => !id ? '—' : setup?.customers.find((item) => item.id === id)?.companyName || setup?.customers.find((item) => item.id === id)?.name || `客戶 ID: ${id}`
  const supplierName = (id: string | null) => setup?.vendors.find((item) => item.id === id)?.name || id || '—'
  const productName = (id: string) => {
    const product = setup?.products.find((item) => item.id === id)
    return product ? `${product.sku} · ${product.name}` : `商品 ID: ${id}`
  }

  const catalogProducts = [...(setup?.products || [])]
  for (const row of setup?.catalog || []) {
    if (!catalogProducts.some((product) => product.id === row.productId)) catalogProducts.push({ id: row.productId, sku: row.productId, name: '已設定（可用 SKU／名稱搜尋）' })
  }

  const requestColumns: ColumnsType<B2BAdminRequest> = [
    { title: '需求編號', dataIndex: 'requestNumber', key: 'requestNumber', width: 170 },
    { title: '客戶', dataIndex: 'customerName', key: 'customerName' },
    { title: '客戶採購單號', dataIndex: 'customerPoNumber', key: 'customerPoNumber' },
    { title: '狀態', dataIndex: 'status', key: 'status', render: (status: B2BAdminRequest['status']) => <Tag color={status === 'stock_confirmed' || status === 'order_confirmed' ? 'green' : status === 'needs_adjustment' ? 'red' : 'gold'}>{statusText[status]}</Tag> },
    { title: '暫估金額', dataIndex: 'total', key: 'total', align: 'right', render: amount },
    { title: '操作', key: 'actions', render: (_, request) => <Space><Button size="small" icon={<CopyOutlined />} onClick={() => void copyQuote(request)}>複製 LINE 連結</Button>{canWrite && request.status === 'pending_stock_review' ? <Button size="small" type="primary" onClick={() => openReview(request)}>人工核庫</Button> : null}{canWrite && canConfirmRequest(request) ? <Button size="small" type="primary" onClick={() => { setChannelId(''); setWarehouseId(''); setConfirming(request) }}>確認接單</Button> : null}{request.salesOrderId ? <Link to="/sales/orders">查看銷售訂單</Link> : null}</Space> },
  ]

  const accountColumns: ColumnsType<B2BAdminSetup['accounts'][number]> = [
    { title: '類型', dataIndex: 'accountType', key: 'type', render: (value: string) => <Tag color={value === 'CUSTOMER' ? 'blue' : 'purple'}>{value === 'CUSTOMER' ? '客戶' : '供應商'}</Tag> },
    { title: '往來對象', key: 'counterparty', render: (_, account) => account.accountType === 'CUSTOMER' ? customerName(account.customerId) : supplierName(account.vendorId) },
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '電子郵件', dataIndex: 'email', key: 'email' },
    { title: '狀態', dataIndex: 'isActive', key: 'isActive', render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '啟用' : '停用'}</Tag> },
    { title: '操作', key: 'actions', render: (_, account) => (account.accountType === 'SUPPLIER' ? canManageSupplier : canWrite) ? <Space><Popconfirm title={account.isActive ? '停用這個帳號？' : '重新啟用這個帳號？'} onConfirm={() => void updateAccount(account, !account.isActive)}><Button size="small">{account.isActive ? '停用' : '啟用'}</Button></Popconfirm><Button size="small" onClick={() => { resetForm.resetFields(); setResetAccount(account) }}>設定新密碼</Button></Space> : null },
  ]

  return <div className="page-section-stack" style={{ maxWidth: 1500, margin: '0 auto', padding: '10px 4px 50px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}><div><Title level={2} style={{ marginBottom: 4 }}>客戶採購入口</Title><Text type="secondary">管理外部帳號、商品價格與客戶採購需求的人工核對。</Text></div><Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>重新整理</Button></div>
    {error ? <Alert type="error" showIcon message={error} /> : null}
    {confirmedOrderId ? <Alert type="success" showIcon message={`已建立銷售訂單 ${confirmedOrderId}`} description={<Space><Link to="/sales/orders">前往 ERP 銷售訂單列表</Link>{hasAnyPermission(user, ['wms_tasks:read']) ? <Link to="/warehouse">開啟儲運工作台</Link> : null}</Space>} closable onClose={() => setConfirmedOrderId(null)} /> : null}
    {setup ? <Alert type="info" showIcon message={`公司登入代碼：${setup.company.loginCode}`} description="請將此代碼與客戶帳號提供給對應窗口。供應商帳號目前可建檔與停用；供應商登入與採購單查看入口仍在後續階段。" /> : null}
    <Card><Tabs items={[
      { key: 'requests', label: `採購需求 (${requests.filter((item) => item.status === 'pending_stock_review').length} 待核對)`, children: <><Alert type="warning" showIcon style={{ marginBottom: 18 }} message="人工核對只記錄確認數量與交期；不會預留或扣除正式庫存。" /><Table rowKey="id" loading={loading} columns={requestColumns} dataSource={requests} scroll={{ x: 960 }} expandable={{ expandedRowRender: (request) => <div><Text strong>商品明細</Text>{request.items.map((item) => <div key={item.id} style={{ padding: '5px 0' }}>{item.sku} · {item.name}：申購 {item.quantity}，確認 {item.confirmedQuantity ?? '待核對'}，單價 {amount(item.unitPrice)}</div>)}{request.note ? <p>客戶備註：{request.note}</p> : null}{request.reviewNote ? <p>核對備註：{request.reviewNote}</p> : null}</div> }} /></> },
      { key: 'accounts', label: '客戶與供應商帳號', children: <><div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>{canWrite || canManageSupplier ? <Button type="primary" icon={<PlusOutlined />} onClick={() => { const defaultType = canWrite ? 'CUSTOMER' : 'SUPPLIER'; setAccountType(defaultType); accountForm.resetFields(); accountForm.setFieldsValue({ accountType: defaultType }); setAccountOpen(true) }}>建立外部帳號</Button> : null}</div><Table rowKey="id" loading={loading} columns={accountColumns} dataSource={setup?.accounts || []} scroll={{ x: 850 }} /></> },
      { key: 'catalog', label: '商品發布', children: <><div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>{canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={() => { catalogForm.resetFields(); catalogForm.setFieldsValue({ isPublished: true }); setCatalogOpen(true) }}>設定商品</Button> : null}</div><Alert type="info" style={{ marginBottom: 12 }} message="商品列表只含快速載入與已設定商品；點「設定商品」可用 SKU 或名稱搜尋其他商品。" /><Table rowKey="id" loading={loading} dataSource={catalogProducts} columns={[{ title: '商品', key: 'product', render: (_, product) => `${product.sku} · ${product.name}` }, { title: '目錄單價', key: 'price', render: (_, product) => { const row = setup?.catalog.find((item) => item.productId === product.id); return row ? amount(row.unitPrice) : '未設定' } }, { title: '對外發布', key: 'published', render: (_, product) => { const row = setup?.catalog.find((item) => item.productId === product.id); return <Tag color={row?.isPublished ? 'green' : 'default'}>{row?.isPublished ? '已發布' : '未發布'}</Tag> } }, { title: '操作', key: 'actions', render: (_, product) => canWrite ? <Button size="small" onClick={() => { const row = setup?.catalog.find((item) => item.productId === product.id); catalogForm.setFieldsValue({ productId: product.id, unitPrice: Number(row?.unitPrice || 0), isPublished: row?.isPublished || false }); setCatalogOpen(true) }}>設定</Button> : null }]} /></> },
      { key: 'prices', label: '客戶專屬價格', children: <><div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>{canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={() => { priceForm.resetFields(); priceForm.setFieldsValue({ isActive: true }); setPriceOpen(true) }}>設定專屬價</Button> : null}</div><Table rowKey={(row) => `${row.customerId}:${row.productId}`} loading={loading} dataSource={setup?.prices || []} columns={[{ title: '客戶', dataIndex: 'customerId', key: 'customer', render: customerName }, { title: '商品', dataIndex: 'productId', key: 'product', render: productName }, { title: '專屬單價', dataIndex: 'unitPrice', key: 'price', render: amount }, { title: '有效至', dataIndex: 'validUntil', key: 'until', render: (value: string | null) => value?.slice(0, 10) || '未設定' }, { title: '狀態', dataIndex: 'isActive', key: 'active', render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '啟用' : '停用'}</Tag> }, { title: '操作', key: 'actions', render: (_, row) => canWrite ? <Button size="small" onClick={() => { priceForm.setFieldsValue({ customerId: row.customerId, productId: row.productId, unitPrice: Number(row.unitPrice), isActive: row.isActive, validUntil: row.validUntil?.slice(0, 10) || undefined }); setPriceOpen(true) }}>設定</Button> : null }]} scroll={{ x: 820 }} /></> },
    ]} /></Card>

    <Modal title="建立外部帳號" open={accountOpen} confirmLoading={saving} onCancel={() => { setAccountOpen(false); accountForm.resetFields() }} onOk={() => void saveAccount()} okText="建立帳號" destroyOnHidden><Form form={accountForm} layout="vertical" autoComplete="off"><Form.Item name="accountType" label="帳號類型" rules={[{ required: true }]}><Select onChange={(value) => setAccountType(value)} options={[{ value: 'CUSTOMER', label: '客戶帳號', disabled: !canWrite }, { value: 'SUPPLIER', label: '供應商帳號（入口待建置）', disabled: !canManageSupplier }]} /></Form.Item>{accountType === 'CUSTOMER' ? <Form.Item name="customerId" label="客戶" rules={[{ required: true, message: '請選擇客戶' }]}><CustomerSearchSelect entityId={entityId} enabled={accountOpen} /></Form.Item> : <Form.Item name="vendorId" label="供應商" rules={[{ required: true, message: '請選擇供應商' }]}><Select showSearch optionFilterProp="label" options={setup?.vendors.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>}<Form.Item name="name" label="使用者姓名" rules={[{ required: true, message: '請填寫姓名' }]}><Input maxLength={80} /></Form.Item><Form.Item name="email" label="登入電子郵件" rules={[{ required: true, type: 'email', message: '請填寫有效電子郵件' }]}><Input autoComplete="off" /></Form.Item><Form.Item name="password" label="初始密碼" rules={passwordRules}><Input.Password autoComplete="new-password" /></Form.Item><Text type="secondary">建立後不會在頁面保存或再次顯示密碼，請透過既有安全流程交付。</Text></Form></Modal>

    <Modal title={`設定新密碼 · ${resetAccount?.name || ''}`} open={Boolean(resetAccount)} confirmLoading={saving} onCancel={() => { resetForm.resetFields(); setResetAccount(null) }} onOk={() => void resetPassword()} okText="更新密碼" destroyOnHidden><Form form={resetForm} layout="vertical" autoComplete="off"><Form.Item name="password" label="新密碼" rules={passwordRules}><Input.Password autoComplete="new-password" /></Form.Item></Form><Alert type="info" message="更新密碼後，這個帳號現有的登入會立即失效。" /></Modal>

    <Modal title="商品發布設定" open={catalogOpen} confirmLoading={saving} onCancel={() => setCatalogOpen(false)} onOk={() => void saveCatalog()} okText="儲存" destroyOnHidden><Form form={catalogForm} layout="vertical"><Form.Item name="productId" label="商品" rules={[{ required: true, message: '請選擇商品' }]}><ProductSearchSelect entityId={entityId} enabled={catalogOpen} selectedProduct={setup?.products.find((item) => item.id === catalogProductId)} /></Form.Item><Form.Item name="unitPrice" label="目錄單價（未稅，TWD）" rules={[{ required: true, message: '請填寫價格' }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item><Form.Item name="isPublished" label="對客戶發布" valuePropName="checked"><Switch /></Form.Item><Alert type="info" message="只發布且有有效價格的商品才會顯示在客戶前台。" /></Form></Modal>

    <Modal title="客戶專屬價格" open={priceOpen} confirmLoading={saving} onCancel={() => setPriceOpen(false)} onOk={() => void savePrice()} okText="儲存" destroyOnHidden><Form form={priceForm} layout="vertical"><Form.Item name="customerId" label="客戶" rules={[{ required: true, message: '請選擇客戶' }]}><CustomerSearchSelect entityId={entityId} enabled={priceOpen} /></Form.Item><Form.Item name="productId" label="商品" rules={[{ required: true, message: '請選擇商品' }]}><ProductSearchSelect entityId={entityId} enabled={priceOpen} selectedProduct={setup?.products.find((item) => item.id === priceProductId)} /></Form.Item><Form.Item name="unitPrice" label="專屬單價（未稅，TWD）" rules={[{ required: true, message: '請填寫價格' }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item><Form.Item name="validUntil" label="有效至（選填）"><Input type="date" /></Form.Item><Form.Item name="isActive" label="啟用專屬價格" valuePropName="checked"><Switch /></Form.Item></Form></Modal>

    <Modal title={`人工核對庫存 · ${reviewing?.requestNumber || ''}`} open={Boolean(reviewing)} confirmLoading={saving} onCancel={() => setReviewing(null)} onOk={() => void saveReview()} okText="儲存核對結果" width={680} destroyOnHidden><Alert type="warning" style={{ marginBottom: 18 }} message="此步驟僅記錄人工確認結果，不預留、不扣正式庫存。" />{reviewing?.items.map((item) => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, margin: '12px 0' }}><span>{item.sku} · {item.name}<br /><Text type="secondary">申購 {item.quantity} 件</Text></span><InputNumber min={0} max={item.quantity} precision={0} value={confirmed[item.id]} onChange={(value) => setConfirmed((current) => ({ ...current, [item.id]: value ?? NaN }))} aria-label={`${item.name} 確認數量`} /></div>)}<div style={{ marginTop: 22 }}><label htmlFor="b2b-review-date">確認交期</label><Input id="b2b-review-date" type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} style={{ margin: '8px 0 18px' }} /><label htmlFor="b2b-review-note">核對備註（數量有異動時必填）</label><Input.TextArea id="b2b-review-note" rows={3} maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} style={{ marginTop: 8 }} /></div></Modal>

    <Modal title={`確認接單 · ${confirming?.requestNumber || ''}`} open={Boolean(confirming)} confirmLoading={saving} onCancel={() => setConfirming(null)} onOk={() => void confirmRequest()} okText="建立銷售訂單" destroyOnHidden><Alert type="info" message="確認後建立正式 ERP 銷售訂單，預留庫存並交接 WMS 出貨。" style={{ marginBottom: 18 }} /><Space direction="vertical" style={{ width: '100%' }} size="middle"><label>銷售通路<Select style={{ width: '100%', marginTop: 7 }} placeholder="選擇銷售通路" value={channelId || undefined} onChange={setChannelId} options={setup?.channels.map((item) => ({ value: item.id, label: item.name }))} /></label><label>出貨倉庫<Select style={{ width: '100%', marginTop: 7 }} placeholder="選擇出貨倉庫" value={warehouseId || undefined} onChange={setWarehouseId} options={setup?.warehouses.map((item) => ({ value: item.id, label: item.code ? `${item.code} · ${item.name}` : item.name }))} /></label></Space>{!setup?.channels.length || !setup?.warehouses.length ? <Alert type="warning" style={{ marginTop: 16 }} message="目前尚無可用通路或倉庫，請先完成主檔設定。" /> : null}</Modal>
  </div>
}
