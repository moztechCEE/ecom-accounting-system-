import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Select, Space, Spin, Typography } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { nativeAfterSales } from '../../services/native-after-sales.service'
import type { NativeOptions, NativeProduct } from '../../services/native-after-sales.service'
import type { NativeCaseType, NativeCreateValues } from './native-workbench-model'
import { nativeCreateInput, NATIVE_CASE_TYPES } from './native-workbench-model'
import { clearPendingRegistration, PendingRegistrationError, readPendingRegistration, registrationTokenMatchesActor, savePendingRegistration, withPendingRegistrationLock } from './pending-registration'
import type { PendingRegistration, RegistrationScope } from './pending-registration'
import type { ApplicationDraft } from './native-application-model'
import { operationRequestIntent } from './operation-request-intent'

type Props = {
  entityId: string; options?: NativeOptions; optionsError?: string;
  onDirtyChange: (value: boolean) => void; onCancel: () => void; onSaved: (id: string) => void;
  onChangeType: () => Promise<boolean>;
  actorId: string; resumeAttempt?: PendingRegistration; onPendingChange: (pending: boolean) => void;
  onOpenSource: (section: string, caseId?: string) => void;
  applicationDraft?: ApplicationDraft;
}
type Values = NativeCreateValues

function errorText(error: unknown) {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof message === 'string' ? message : Array.isArray(message) ? message.join('；') : '案件未能確認建立，請保留資料並重試'
}

export default function NativeAfterSalesCreate({ entityId, actorId, resumeAttempt, applicationDraft, options, optionsError, onDirtyChange, onCancel, onSaved, onOpenSource, onChangeType, onPendingChange }: Props) {
  const [selectedType, setSelectedType] = useState<NativeCaseType | undefined>(resumeAttempt?.request.payload.type || applicationDraft?.type)
  const [form] = Form.useForm<Values>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(resumeAttempt ? '案件建立結果尚未確認，請重試確認' : '')
  const [unknownResult, setUnknownResult] = useState(Boolean(resumeAttempt))
  const operation = useRef<PendingRegistration | undefined>(resumeAttempt)
  const running = useRef(false)
  const currentScope = useRef({ actorId, entityId })
  currentScope.current = { actorId, entityId }
  const mounted = useRef(false), controller = useRef<AbortController | undefined>(undefined)
  const sessionToken = useRef(localStorage.getItem('access_token') || '')
  const type = NATIVE_CASE_TYPES.find(entry => entry.value === selectedType)
  const brand = Form.useWatch('brand', form)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [actorId, entityId])
  function restore(pending: PendingRegistration) {
    operation.current = pending; setSelectedType(pending.request.payload.type); setUnknownResult(true)
    onPendingChange(true); onDirtyChange(true)
    const payload = pending.request.payload, detail = payload.detail
    form.setFieldsValue({ brand: pending.request.brand, customerKind: pending.request.customerKind, sourceChannel: payload.sourceChannel, contactName: payload.contactName, contactPhone: payload.contactPhone, contactAddress: payload.contactAddress, contactEmail: payload.contactEmail, referenceNumber: payload.referenceNumber, internalNote: payload.internalNote, items: payload.items, serialNumber: String(detail.serialNumber || ''), reshipmentReason: String(detail.reshipmentReason || ''), lossCategory: String(detail.lossCategory || ''), reasonCategory: String(detail.reasonCategory || ''), refundReason: String(detail.refundReason || ''), reason: String(detail.missingContents || detail.faultDescription || detail.reasonNote || detail.issueDescription || payload.internalNote || '') })
  }
  useEffect(() => { if (resumeAttempt) restore(resumeAttempt) }, [resumeAttempt?.requestId])
  useEffect(() => { if (applicationDraft && !resumeAttempt) { form.setFieldsValue({ ...applicationDraft.values, sourceChannel: applicationDraft.values.sourceChannel || (options?.sourceChannels.length === 1 ? options.sourceChannels[0].value : '') }); onDirtyChange(true) } }, [applicationDraft?.applicationId, resumeAttempt?.requestId, options?.sourceChannels])
  async function create(values: Values) {
    if (!selectedType || !unknownResult && !options?.createTypes.includes(selectedType) || running.current || !entityId || !actorId) return
    running.current = true; setBusy(true); setFailure(''); onPendingChange(true); onDirtyChange(true)
    const scope: RegistrationScope = { actorId, entityId }
    const abort = new AbortController(); controller.current = abort
    const token = sessionToken.current
    const activeScope = () => mounted.current && currentScope.current.actorId === actorId && currentScope.current.entityId === entityId
    const assertCurrent = () => { if (abort.signal.aborted || !activeScope() || !registrationTokenMatchesActor(token, actorId) || localStorage.getItem('access_token') !== token) throw new DOMException('登入狀態已變更，請重新登入後確認建單', 'AbortError') }
    let sent = false, priorUnknown = unknownResult
    try {
      assertCurrent()
      await withPendingRegistrationLock(scope, async () => {
        assertCurrent()
        const storage = window.localStorage, prior = readPendingRegistration(storage, scope)
        if (prior && (!operation.current || prior.requestId !== operation.current.requestId)) throw new PendingRegistrationError('CONFLICT', '已有待確認案件，請先重試確認', prior)
        const attempt = unknownResult && operation.current ? operation.current : { schema: 'corely.doa.pending-registration.v1' as const, ...scope, requestId: crypto.randomUUID(), createdAt: new Date().toISOString(), request: { brand: values.brand, customerKind: values.customerKind, payload: nativeCreateInput(selectedType, values), ...(applicationDraft ? { verifiedApplicationRef: applicationDraft.verifiedApplicationRef } : {}) } }
        savePendingRegistration(storage, scope, attempt)
        operation.current = attempt; onPendingChange(true); onDirtyChange(true)
        assertCurrent()
        sent = true
        operationRequestIntent('after_sales.create.request', attempt.requestId)
        const result = await nativeAfterSales.create(attempt.entityId, { requestId: attempt.requestId, ...attempt.request }, { signal: abort.signal, token, expectedActorId: actorId })
        assertCurrent()
        clearPendingRegistration(storage, scope, attempt.requestId)
        onPendingChange(false); onDirtyChange(false); onSaved(result.id)
      }, abort.signal)
    } catch (error) {
      if (activeScope()) {
        if (error instanceof PendingRegistrationError && error.pending) { restore(error.pending); setFailure(error.message); return }
        const status = (error as { response?: { status?: number } })?.response?.status
        const uncertain = priorUnknown || sent && (status == null || status >= 500)
        if (!uncertain && sent && operation.current) {
          try { await withPendingRegistrationLock(scope, async () => { assertCurrent(); clearPendingRegistration(window.localStorage, scope, operation.current!.requestId) }, abort.signal) } catch { setUnknownResult(true); onPendingChange(true); setFailure('待確認建單紀錄未能清除，請重試確認'); return }
          operation.current = undefined
        }
        setUnknownResult(uncertain)
        onPendingChange(uncertain)
        setFailure(uncertain ? '案件建立結果尚未確認，請重試確認' : error instanceof PendingRegistrationError || error instanceof DOMException ? error.message : errorText(error))
      }
    } finally { running.current = false; if (activeScope()) setBusy(false) }
  }
  const required = (message: string) => [{ required: true, whitespace: true, message }]
  const contactRequired = (message: string) => selectedType === 'CUSTOMER_ISSUE' ? [] : required(message)
  if (!options && !optionsError) return <div role="status"><Spin /> 載入案件選項…</div>
  return <div className="native-after-sales-create">
    <Button data-operation-action="erp.nativeaftersalescreate.action.c7511108cff2" className="native-after-sales-back" aria-label="返回案件清單" icon={<ArrowLeftOutlined />} onClick={onCancel} disabled={busy || unknownResult}>返回案件清單</Button>
    {optionsError && <Alert type="error" showIcon message={optionsError} />}
    {!selectedType ? <>
      <Typography.Title level={3}>新增案件</Typography.Title>
      <div className="native-after-sales-type-grid">{NATIVE_CASE_TYPES.filter(entry => options?.createTypes.includes(entry.value)).map(entry => <button data-operation-action={`after_sales.type.${entry.value.toLowerCase()}`} className="native-after-sales-type-choice" type="button" key={entry.value} onClick={() => { setSelectedType(entry.value); form.resetFields(); setFailure('') }}><strong>{entry.label}</strong><span>{entry.description}</span></button>)}</div>
      {options && options.createTypes.length === 0 && <Alert type="warning" showIcon message="目前帳號沒有新增案件權限" />}
    </> : <>
      <div className="native-after-sales-detail-heading"><Typography.Title level={3}>{type?.label}</Typography.Title><Button data-operation-action="erp.nativeaftersalescreate.action.0711ab3ab77d" onClick={() => void (async () => { if (!await onChangeType()) return; setSelectedType(undefined); setFailure('') })()} disabled={busy || unknownResult || !!applicationDraft}>變更類型</Button></div>
      {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 16 }} />}
      <Form className="native-after-sales-create-form" form={form} layout="vertical" disabled={busy || unknownResult} initialValues={{ customerKind: 'TO_C', items: [{ quantity: 1 }] }} onValuesChange={() => onDirtyChange(true)} onFinish={values => void create(values)}>
        <div className="native-after-sales-create-fields">
          <Form.Item name="brand" label="品牌" rules={required('請選擇品牌')}><Select disabled={!!applicationDraft} aria-label="案件品牌" placeholder="選擇品牌" options={(options?.brands || []).map(value => ({ value: value.code, label: value.name }))} /></Form.Item>
          <Form.Item name="customerKind" label="客戶類型" rules={required('請選擇客戶類型')}><Select aria-label="客戶類型" options={options?.customerKinds || []} /></Form.Item>
          <Form.Item name="sourceChannel" label="進線來源" rules={required('請選擇進線來源')}><Select aria-label="進線來源" placeholder="選擇來源" options={options?.sourceChannels || []} /></Form.Item>
          <Form.Item name="referenceNumber" label="原訂單／參考編號"><Input maxLength={120} /></Form.Item>
          <Form.Item name="contactName" label="姓名／聯絡人" rules={contactRequired('請填寫姓名')}><Input disabled={!!applicationDraft} autoComplete="name" maxLength={100} /></Form.Item>
          <Form.Item name="contactPhone" label="電話" rules={contactRequired('請填寫電話')}><Input disabled={!!applicationDraft} autoComplete="tel" inputMode="tel" maxLength={40} /></Form.Item>
          <Form.Item name="contactEmail" label="Email" rules={[...contactRequired('請填寫 Email'), { type: 'email', message: '請填寫有效的 Email' }]}><Input disabled={!!applicationDraft} type="email" autoComplete="email" maxLength={254} /></Form.Item>
          <Form.Item name="contactAddress" label="收件／回寄地址" rules={contactRequired('請填寫地址')}><Input disabled={!!applicationDraft} autoComplete="street-address" maxLength={500} /></Form.Item>
        </div>
        <Form.List name="items" rules={[{ validator: async (_, values: Values['items']) => { if (!values?.length) throw new Error('請新增至少一個品項') } }]}>{(fields, { add, remove }, { errors }) => <>
          {fields.map((field, index) => <div className="native-after-sales-create-item" key={field.key}><div className="native-after-sales-heading"><strong>品項 {index + 1}</strong>{fields.length > 1 && !applicationDraft && <Button data-operation-action="erp.nativeaftersalescreate.action.7efe820259b2" type="text" icon={<DeleteOutlined />} aria-label={`移除品項 ${index + 1}`} onClick={() => remove(field.name)}>移除</Button>}</div><div className="native-after-sales-create-fields">
            <Form.Item name={[field.name, 'productId']} label="產品／配件" rules={required('請選擇產品')}><NativeProductPicker entityId={entityId} initialProducts={Array.from(new Map([...(options?.products || []), ...(applicationDraft?.products || [])].map(product => [product.id, product])).values())} disabled={!!applicationDraft} label={`品項 ${index + 1} 產品`} /></Form.Item>
            <Form.Item name={[field.name, 'quantity']} label="數量" rules={[{ required: true, message: '請填寫數量' }, { type: 'integer', min: 1, max: 9999, message: '數量須為 1–9999' }]}><InputNumber disabled={!!applicationDraft} min={1} max={9999} precision={0} style={{ width: '100%' }} /></Form.Item>
          </div></div>)}
          <Form.ErrorList errors={errors} /><Button data-operation-action="erp.nativeaftersalescreate.action.29a8462cce4d" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })} disabled={busy || unknownResult || !!applicationDraft}>增加品項</Button>
        </>}</Form.List>
        {selectedType === 'REPAIR' && <Form.Item name="serialNumber" label="SN" style={{ marginTop: 16 }}><Input maxLength={120} /></Form.Item>}
        {selectedType === 'RESHIPMENT' && <div className="native-after-sales-create-fields" style={{ marginTop: 16 }}><Form.Item name="reshipmentReason" label="補寄原因" rules={required('請選擇補寄原因')}><Select options={options?.reasonOptions.reshipmentReason || []} /></Form.Item><Form.Item name="lossCategory" label="缺件類別" rules={required('請選擇缺件類別')}><Select options={options?.reasonOptions.lossCategory || []} /></Form.Item></div>}
        {selectedType === 'EXCHANGE_RETURN' && <Form.Item name="reasonCategory" label="換貨原因" rules={required('請選擇換貨原因')} style={{ marginTop: 16 }}><Select options={options?.reasonOptions.exchangeReason || []} /></Form.Item>}
        {selectedType === 'REFUND_PICKUP' && <Form.Item name="refundReason" label="退貨原因" rules={required('請選擇退貨原因')} style={{ marginTop: 16 }}><Select options={options?.reasonOptions.refundReason || []} /></Form.Item>}
        <Form.Item name="reason" label={selectedType === 'RESHIPMENT' ? '補寄內容' : selectedType === 'EXCHANGE_RETURN' ? '換貨說明' : selectedType === 'REFUND_PICKUP' ? '退貨說明' : type?.reason} rules={required('請填寫案件內容')} style={{ marginTop: 16 }}><Input.TextArea rows={3} maxLength={4000} showCount /></Form.Item>
        <Form.Item name="internalNote" label="內部備註"><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
        <Space wrap><Button data-operation-action="erp.nativeaftersalescreate.action.2cd31d3372c6" type="primary" aria-label={unknownResult ? '重試確認' : '建立案件'} htmlType={unknownResult ? 'button' : 'submit'} disabled={busy} loading={busy} onClick={unknownResult ? () => void create(form.getFieldsValue(true)) : undefined}>{unknownResult ? '重試確認' : '建立案件'}</Button><Button data-operation-action="erp.nativeaftersalescreate.action.e8f9c03cb32d" onClick={onCancel} disabled={busy || unknownResult}>取消</Button><Button data-operation-action="erp.nativeaftersalescreate.action.854d498fa925" type="link" disabled={busy || unknownResult || !brand} onClick={() => onOpenSource('customers')}>顧客資料與 LINE</Button></Space>
      </Form>
    </>}
  </div>
}

function NativeProductPicker({ entityId, initialProducts, disabled, label, value, onChange }: { disabled?: boolean; entityId: string; initialProducts: NativeProduct[]; label: string; value?: string; onChange?: (value: string) => void }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ entityId: string; query: string; products: NativeProduct[]; error?: string }>()
  const cache = useRef(new Map<string, NativeProduct>())
  const cacheEntity = useRef(entityId)
  if (cacheEntity.current !== entityId) { cache.current.clear(); cacheEntity.current = entityId }
  for (const product of initialProducts) cache.current.set(product.id, product)
  useEffect(() => {
    if (!query.trim()) return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      void nativeAfterSales.searchProducts(entityId, query.trim(), abort.signal).then(products => {
        if (abort.signal.aborted) return
        for (const product of products) cache.current.set(product.id, product)
        setResult({ entityId, query, products })
      }).catch(error => { if (!abort.signal.aborted) setResult({ entityId, query, products: [], error: errorText(error) }) })
    }, 200)
    return () => { abort.abort(); clearTimeout(timer) }
  }, [entityId, query])
  const current = result?.entityId === entityId && result.query === query ? result : undefined
  const products = query.trim() ? current?.products || [] : initialProducts
  const options = products.map(product => ({ value: product.id, label: `${product.name} · ${product.sku}` }))
  if (value && !options.some(option => option.value === value)) {
    const selected = cache.current.get(value)
    if (selected) options.push({ value, label: `${selected.name} · ${selected.sku}` })
  }
  return <Select disabled={disabled} value={value} onChange={onChange} showSearch aria-label={label} placeholder="搜尋產品名稱、SKU 或型號" filterOption={false} onSearch={setQuery} loading={Boolean(query.trim()) && !current} options={options} notFoundContent={current?.error ? <span role="alert">{current.error}</span> : query.trim() && !current ? <Spin size="small" /> : '沒有符合的產品'} />
}
