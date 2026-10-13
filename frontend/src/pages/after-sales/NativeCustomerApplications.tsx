import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Form, Image, Input, InputNumber, message, Select, Space, Table, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { nativeAfterSales, type NativeApplication, type NativeApplicationList, type NativeOptions, type NativeProduct } from '../../services/native-after-sales.service';
import { NATIVE_CASE_TYPES, nativeCaseTypeLabel, type NativeCaseType } from './native-workbench-model';
import { registrationTokenMatchesActor } from './pending-registration';
import { APPLICATION_STATUS, applicationDraft, applicationPendingKey, clearApplicationPending, readApplicationPending, saveApplicationPending, type ApplicationDraft, type ApplicationPending } from './native-application-model';
import { operationRequestIntent } from './operation-request-intent';
type Props = { entityId: string; options?: NativeOptions; onCreate: (draft: ApplicationDraft) => void; onOpenCase: (id: string) => void; onPendingChange: (v: boolean) => void; onDirtyChange: (v: boolean) => void };
const errorText = (e: any) => typeof e?.response?.data?.message === 'string' ? e.response.data.message : e?.message || '申請資料暫時無法確認';
export default function NativeCustomerApplications({ entityId, options, onCreate, onOpenCase, onPendingChange, onDirtyChange }: Props) {
  const { user } = useAuth(), actorId = user?.id || '', scopeKey = JSON.stringify([actorId, entityId]);
  const current = useRef(scopeKey); current.current = scopeKey;
  const alive = useRef(true), running = useRef(false), controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState('SUBMITTED'), [cursor, setCursor] = useState<string>(), [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<NativeApplicationList>(), [selected, setSelected] = useState<NativeApplication>(), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false), [recheck, setRecheck] = useState(false), [link, setLink] = useState<{ url: string; providerMode?: string }>(), [pending, setPending] = useState<ApplicationPending | null>(null), [photo, setPhoto] = useState<{ name: string; dataUrl: string }>();
  const [reviewForm] = Form.useForm(), [inviteForm] = Form.useForm();
  const reviewType = Form.useWatch('type', reviewForm);
  const [products, setProducts] = useState(new Map<string, NativeProduct>());
  const selectedRef = useRef(selected?.id); selectedRef.current = selected?.id;
  const canWrite = !!options?.createTypes.length, editable = ['SUBMITTED','REVIEWED','REJECTED'].includes(selected?.status || '') && !selected?.caseId && options?.createTypes.includes(selected?.nativeCreateDraft?.type || selected?.type || '');
  useEffect(() => {
    alive.current = true; setSelected(undefined); setList(undefined); setPhoto(undefined); setLink(undefined); setError(''); setCursor(undefined); running.current = false;
    try { const saved = readApplicationPending(localStorage, actorId, entityId); setPending(saved); onPendingChange(!!saved); if (saved) setError('申請操作結果待確認，請使用原請求重試'); } catch (e) { setError(errorText(e)); onPendingChange(true); }
    return () => { alive.current = false; controller.current?.abort(); onPendingChange(false); onDirtyChange(false); };
  }, [scopeKey]);
  useEffect(() => {
    setProducts(new Map((options?.products || []).map(p => [p.id, p])));
  }, [scopeKey, options]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setList(undefined);
    void nativeAfterSales.applications(entityId, status, cursor, abort.signal).then(data => { if (!abort.signal.aborted) setList(data); }).catch(e => { if (!abort.signal.aborted) setError(errorText(e)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [scopeKey, status, cursor, refresh]);
  async function openApplication(row: NativeApplication) {
    if (pending || busy) return;
    const key = scopeKey, abort = new AbortController(); controller.current = abort;
    setError(''); setBusy(true);
    try {
      const item = await nativeAfterSales.application(entityId, row.id, abort.signal);
      if (!alive.current || current.current !== key) return;
      setSelected(item); setRecheck(item.status === 'REJECTED'); reviewForm.resetFields();
      const reviewed = item.reviewedData as any;
      reviewForm.setFieldsValue({ type: reviewed?.type || item.type, profile: reviewed?.profile || item.submittedData, note: '', items: reviewed?.items?.map((p: any) => ({ productId: p.productId, quantity: p.quantity })) || [{ quantity: 1 }] });
    } catch (e) { if (alive.current && current.current === key) setError(errorText(e)); }
    finally { if (alive.current && current.current === key) setBusy(false); }
  }
  async function readPhoto(index: number) {
    if (!selected) return; const id = selected.id, key = scopeKey, token = localStorage.getItem('access_token') || '', abort = new AbortController(); controller.current = abort;
    try { const result = await nativeAfterSales.applicationPhoto(entityId, id, index, abort.signal); if (alive.current && current.current === key && selectedRef.current === id && localStorage.getItem('access_token') === token && registrationTokenMatchesActor(token, actorId)) setPhoto(result); }
    catch (e) { if (alive.current && current.current === key) setError(errorText(e)); }
  }
  async function send(command?: Record<string, unknown>, applicationId: string | null = selected?.id || null) {
    if (running.current || !actorId || !entityId || !pending && !canWrite) return;
    const key = scopeKey, token = localStorage.getItem('access_token') || '', abort = new AbortController(); controller.current = abort;
    const valid = () => alive.current && current.current === key && localStorage.getItem('access_token') === token && registrationTokenMatchesActor(token, actorId);
    let saved = pending; running.current = true; setBusy(true); setError('');
    try {
      if (!valid() || !navigator.locks) throw new Error('登入狀態已變更，申請操作尚未送出');
      await navigator.locks.request(applicationPendingKey(actorId, entityId), { mode: 'exclusive', signal: abort.signal }, async () => {
        if (!valid()) throw new Error('登入狀態已變更，申請操作尚未送出');
        saved = readApplicationPending(localStorage, actorId, entityId);
        if (!saved) {
          if (!command) throw new Error('尚無可送出的申請操作');
          saved = { schema: 'corely.doa.pending-application.v1', actorId, entityId, applicationId, type: command.type as NativeCaseType, command: { ...command, requestId: crypto.randomUUID() } as ApplicationPending['command'] };
          saveApplicationPending(localStorage, saved);
        }
        setPending(saved); onPendingChange(true);
        if (!valid()) throw new Error('登入狀態已變更，請核對原操作');
        operationRequestIntent(saved.applicationId ? 'after_sales.application.review.request' : 'after_sales.application.invite.request', saved.command.requestId, saved.applicationId || undefined);
        const result = await nativeAfterSales.applicationCommand(entityId, saved.applicationId, saved.command, { token, expectedActorId: actorId, signal: abort.signal });
        if (!valid()) return;
        if (result.id !== (saved.applicationId || saved.command.requestId) || !['INVITED','SUBMITTED','REVIEWED','REJECTED','CONVERTED'].includes(String(result.status))) throw new Error('申請回執待確認，請使用原請求重試');
        clearApplicationPending(localStorage, saved); setPending(null); onPendingChange(false); onDirtyChange(false); setInviteOpen(false); setRefresh(v => v + 1);
        if (typeof result.url === 'string') setLink({ url: result.url, providerMode: String(result.providerMode || '') });
        if (saved.applicationId) { setSelected(result as unknown as NativeApplication); setRecheck(false); }
        message.success(APPLICATION_STATUS[String(result.status)] || '申請已儲存');
      });
    } catch (e) { if (alive.current && current.current === key) { setError(errorText(e)); if (saved) setPending(saved); onPendingChange(!!saved); } }
    finally { if (alive.current && current.current === key) { running.current = false; setBusy(false); } }
  }
  async function review(approve: boolean) {
    if (!selected || !editable || pending) return;
    try {
      const values = approve ? await reviewForm.validateFields() : await reviewForm.validateFields([['type'], ['profile','name'], ['profile','phone'], ['profile','address'], ['profile','email'], ['profile','productDescription'], ['profile','faultDescription'], ['note']]);
      const items = approve ? (values.items || []).map((item: any) => {
        const product = products.get(item.productId); if (!product?.erpProductId) throw new Error('請搜尋並選擇已完成 ERP 對應的產品');
        return { sourceProductId: product.id, erpProductId: product.erpProductId, quantity: item.quantity };
      }) : [];
      if (approve && (!items.length || new Set(items.map((i: any) => i.sourceProductId)).size !== items.length)) throw new Error('請選擇產品，並合併重複品項件數');
      await send({ operation: 'REVIEW', expectedRevision: selected.revision, approve, note: values.note.trim(), type: values.type,
        profile: { name: values.profile.name.trim(), phone: values.profile.phone.trim(), address: values.profile.address.trim(), email: values.profile.email?.trim() || '', productDescription: values.profile.productDescription?.trim() || '', faultDescription: values.profile.faultDescription?.trim() || '' }, items }, selected.id);
    } catch (e) { setError(errorText(e)); }
  }
  const disabled = busy || !!pending;
  return <section className="native-customer-applications" aria-label="顧客售後申請">
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="申請狀態" value={status} disabled={disabled} onChange={v => { setStatus(v); setCursor(undefined); setError(''); }} options={Object.entries(APPLICATION_STATUS).map(([value, label]) => ({ value, label }))} />
      <Button data-operation-action="after_sales.application.refresh" disabled={disabled} loading={loading} onClick={() => { setError(''); setRefresh(v => v + 1); }}>更新</Button>
      {canWrite && <Button data-operation-action="after_sales.application.invite.open" disabled={disabled} onClick={() => { inviteForm.resetFields(); setInviteOpen(true); }}>建立顧客填單連結</Button>}
    </Space>
    {error && !selected && !inviteOpen && <Alert type="error" message={error} showIcon action={pending ? <Button data-operation-action="after_sales.application.retry" loading={busy} onClick={() => void send()}>重試原操作</Button> : undefined} />}
    {link && <Space wrap style={{ width: '100%', marginBottom: 16 }}>{link.providerMode === 'DEV_STUB' && <Tag>DEV 模擬登入</Tag>}<Input aria-label="顧客填單連結" readOnly value={link.url} style={{ width: 'min(540px, 70vw)' }} /><Button data-operation-action="after_sales.application.invite.copy" onClick={() => void navigator.clipboard.writeText(link.url).catch(() => message.error('請手動複製連結'))}>複製連結</Button></Space>}
    <Table<NativeApplication> rowKey="id" loading={loading} dataSource={list?.items || []} pagination={false} scroll={{ x: 670 }} locale={{ emptyText: '目前沒有此狀態的顧客申請' }} columns={[
      { title: '顧客／產品', render: (_, row) => <><strong>{row.contactName || '待顧客填寫'}</strong><div className="native-communication-muted">{row.productDescription || '—'}</div></> },
      { title: '類型', render: (_, row) => nativeCaseTypeLabel(row.type) }, { title: '品牌', dataIndex: 'brand', width: 110 },
      { title: '進度', render: (_, row) => <Tag>{APPLICATION_STATUS[row.status] || row.status}</Tag> }, { title: '照片', dataIndex: 'photoCount', width: 70 },
      { title: '', width: 100, render: (_, row) => <Button data-operation-action="after_sales.application.open" data-operation-record-id={row.id} disabled={disabled} onClick={() => void openApplication(row)}>{row.status === 'SUBMITTED' ? '審核' : '查看'}</Button> },
    ]} />
    <Space style={{ marginTop: 16 }}>{cursor && <Button data-operation-action="after_sales.application.latest" disabled={disabled} onClick={() => setCursor(undefined)}>回到最新</Button>}<Button data-operation-action="after_sales.application.next" disabled={disabled || !list?.nextCursor} onClick={() => setCursor(list?.nextCursor || undefined)}>下一頁</Button></Space>
    <Drawer title="顧客售後申請" open={!!selected} width="min(660px, 100vw)" maskClosable={!disabled} onClose={() => { if (!disabled) { setSelected(undefined); setPhoto(undefined); onDirtyChange(false); } }} footer={pending ? <Button data-operation-action="after_sales.application.retry" type="primary" loading={busy} onClick={() => void send()}>重試原操作</Button> : (selected?.status === 'SUBMITTED' || recheck) && editable ? <Space><Button data-operation-action="after_sales.application.review.approve" data-operation-record-id={selected?.id} type="primary" disabled={disabled} loading={busy} onClick={() => void review(true)}>審核完成</Button><Button data-operation-action="after_sales.application.review.reject" data-operation-record-id={selected?.id} disabled={disabled} onClick={() => void review(false)}>退回申請</Button></Space> : selected?.status === 'REVIEWED' ? <Button data-operation-action="after_sales.application.create_case" data-operation-record-id={selected?.id} type="primary" disabled={disabled || !options?.createTypes.includes(selected.nativeCreateDraft?.type || '')} onClick={() => { try { const draft = applicationDraft(selected); setSelected(undefined); onDirtyChange(false); onCreate(draft); } catch (e) { setError(errorText(e)); } }}>帶入資料，建立案件</Button> : selected?.caseId ? <Button data-operation-action="after_sales.application.open_case" onClick={() => onOpenCase(selected.caseId!)}>查看已建立案件</Button> : undefined}>
      {error && <Alert type="error" message={error} showIcon />}
      {selected && <>
        <Space wrap style={{ marginBottom: 12 }}><Tag>{selected.brand}</Tag><Tag>{APPLICATION_STATUS[selected.status]}</Tag><span>第 {selected.revision} 版</span></Space>
        {selected.submittedData?.photos?.length ? <Space wrap style={{ marginBottom: 12 }}>{selected.submittedData.photos.map(p => <Button data-operation-action="after_sales.application.photo" key={p.index} onClick={() => void readPhoto(p.index)}>查看照片 {p.index + 1}</Button>)}</Space> : <p className="native-communication-muted">尚無產品照片</p>}
        {(selected.status === 'SUBMITTED' || recheck) ? <Form form={reviewForm} layout="vertical" disabled={disabled || !editable} onValuesChange={() => onDirtyChange(true)}>
          <Form.Item name="type" label="案件類型" rules={[{ required: true }]}><Select aria-label="審核案件類型" options={NATIVE_CASE_TYPES.filter(t => options?.createTypes.includes(t.value)).map(t => ({ value: t.value, label: t.label }))} /></Form.Item>
          <div className="native-after-sales-create-fields">
            {(['name','phone','address','email'] as const).map(k => <Form.Item key={k} name={['profile',k]} label={{ name: '姓名', phone: '電話', address: '地址', email: 'Email' }[k]} rules={k === 'email' ? [{ type: 'email', message: 'Email格式不正確' }, ...(reviewType === 'CUSTOMER_ISSUE' ? [] : [{ required: true, whitespace: true, message: '請補齊正式建單所需Email' }])] : [{ required: true, whitespace: true, message: '請核對顧客資料' }]}><Input maxLength={{ name: 100, phone: 40, address: 500, email: 254 }[k]} /></Form.Item>)}
          </div>
          <Form.Item name={['profile','productDescription']} label="顧客描述的產品"><Input.TextArea rows={2} maxLength={2000} /></Form.Item><Form.Item name={['profile','faultDescription']} label="問題描述"><Input.TextArea rows={3} maxLength={4000} /></Form.Item>
          <Form.List name="items">{(fields, { add, remove }) => <>
            {fields.map((field, index) => <div key={field.key} className="native-after-sales-create-fields"><Form.Item name={[field.name,'productId']} label={`核對產品 ${index + 1}`}><ApplicationProductPicker label={`核對產品 ${index + 1}`} entityId={entityId} initial={options?.products || []} onFound={found => setProducts(prev => new Map([...prev,...found.map(p => [p.id,p] as const)]))} /></Form.Item><Form.Item name={[field.name,'quantity']} label="數量" rules={[{ required: true }, { type: 'integer', min: 1, max: 999 }]}><InputNumber min={1} max={999} precision={0} /></Form.Item>{fields.length > 1 && <Button data-operation-action="after_sales.application.item.remove" icon={<DeleteOutlined />} aria-label={`移除核對產品 ${index + 1}`} onClick={() => remove(field.name)}>移除</Button>}</div>)}
            <Button data-operation-action="after_sales.application.item.add" disabled={fields.length >= 20} icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>增加產品</Button>
          </>}</Form.List>
          <Form.Item name="note" label="審核備註" style={{ marginTop: 16 }} rules={[{ required: true, whitespace: true, message: '請填寫審核依據或退回原因' }]}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
        </Form> : <><Descriptions column={1} items={['name','phone','address','email','productDescription','faultDescription'].map(k => ({ key: k, label: ({ name: '姓名', phone: '電話', address: '地址', email: 'Email', productDescription: '產品描述', faultDescription: '問題描述' } as any)[k], children: String(((selected.reviewedData as any)?.profile || selected.submittedData)?.[k] || '—') }))} />{selected.reviewNote && <p>審核備註：{selected.reviewNote}</p>}{editable && <Button data-operation-action="after_sales.application.review.reopen" disabled={disabled} onClick={() => setRecheck(true)}>重新核對資料與產品</Button>}</>}
      </>}
    </Drawer>
    <Drawer title="建立顧客填單連結" open={inviteOpen} width="min(420px, 100vw)" maskClosable={!disabled} onClose={() => { if (!disabled) setInviteOpen(false); }} footer={pending ? <Button data-operation-action="after_sales.application.retry" type="primary" loading={busy} onClick={() => void send()}>重試原操作</Button> : <Button data-operation-action="after_sales.application.invite.create" type="primary" disabled={disabled} loading={busy} onClick={() => void inviteForm.validateFields().then(v => send({ operation: 'CREATE_INVITE', brand: v.brand, type: v.type }, null)).catch(() => setError('請選擇品牌與案件類型'))}>建立連結</Button>}>
      {error && <Alert type="error" message={error} showIcon />}
      <Form form={inviteForm} layout="vertical" disabled={disabled}><Form.Item name="brand" label="品牌" rules={[{ required: true }]}><Select aria-label="填單品牌" options={(options?.brands || []).filter(b => ['MOZTECH','BONSON'].includes(b.code)).map(b => ({ value: b.code, label: b.name }))} /></Form.Item><Form.Item name="type" label="案件類型" rules={[{ required: true }]}><Select aria-label="填單案件類型" options={NATIVE_CASE_TYPES.filter(t => options?.createTypes.includes(t.value)).map(t => ({ value: t.value, label: t.label }))} /></Form.Item></Form>
    </Drawer>
    <Drawer title={photo?.name || '產品照片'} open={!!photo} width="min(660px, 100vw)" onClose={() => setPhoto(undefined)}>{photo && <Image src={photo.dataUrl} alt="顧客提交的產品外觀" preview={false} style={{ maxWidth: '100%' }} />}</Drawer>
  </section>;
}
function ApplicationProductPicker({ entityId, initial, label, value, onChange, onFound }: { label: string; entityId: string; initial: NativeProduct[]; value?: string; onChange?: (v: string) => void; onFound: (found: NativeProduct[]) => void }) {
  const [query, setQuery] = useState(''), [result, setResult] = useState<NativeProduct[]>(initial), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(), timer = setTimeout(() => { if (!query.trim()) { setResult(initial); return; } void nativeAfterSales.searchProducts(entityId, query.trim(), abort.signal).then(found => { if (!abort.signal.aborted) { setResult(found); onFound(found); setError(''); } }).catch(e => { if (!abort.signal.aborted) setError(errorText(e)); }); }, 200);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [entityId, query, initial]);
  return <Select aria-label={label} value={value} onChange={onChange} showSearch filterOption={false} onSearch={setQuery} placeholder="搜尋 ERP 產品名稱、SKU 或貨號" options={result.map(p => ({ value: p.id, label: p.name + ' · ' + p.sku }))} notFoundContent={error || '沒有符合的產品'} />;
}
