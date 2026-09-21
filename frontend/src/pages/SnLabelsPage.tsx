import { useEffect, useRef, useState } from 'react'
import { Alert, Button, DatePicker, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd'
import dayjs from 'dayjs'
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useEntityContext } from '../hooks/useEntityContext'
import { productService } from '../services/product.service'
import type { Product } from '../services/product.service'
import LabelDesigner from '../features/sn-labels/LabelDesigner'
import CartonPreview from '../features/sn-labels/CartonPreview'
import { cartonEstimate, CONFIRMED_RULES, draftStorageKey, manufacturingYear, newDraft, parseDrafts, PENDING_RULES, sampleSerial, yearCode } from '../features/sn-labels/model'
import type { SnDraft } from '../features/sn-labels/model'
import './SnLabelsPage.css'

export default function SnLabelsPage() {
  const { user } = useAuth()
  const entityId = useEntityContext()
  if (!user || !entityId) return <Alert type="warning" message="請先確認登入公司，再開啟 SN 工作區。" />
  return <SnWorkspace key={`${entityId}:${user.id}`} storageKey={draftStorageKey(entityId, user.id)} />
}

function SnWorkspace({ storageKey }: { storageKey: string }) {
  const [stored] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return { raw, drafts: parseDrafts(raw), error: '' }
    } catch { return { raw: null, drafts: [] as SnDraft[], error: '無法讀取瀏覽器草稿；既有資料已保留，請勿清除瀏覽器資料。' } }
  })
  const [draft, setDraft] = useState(() => newDraft(crypto.randomUUID()))
  const [saved, setSaved] = useState<SnDraft[]>(stored.drafts)
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState('batch')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [productError, setProductError] = useState('')
  const storageError = stored.error
  const [reload, setReload] = useState(0)
  const storageBaseline = useRef<string | null>(stored.raw)
  const [messageApi, messageContext] = message.useMessage()
  const [modal, modalContext] = Modal.useModal()
  useEffect(() => {
    let active = true
    productService.findAll().then(rows => { if (active) setProducts(rows.filter(p => p.type !== 'SERVICE')) })
      .catch(() => { if (active) { setProducts([]); setProductError('產品讀取失敗，請重新載入。草稿中的產品資訊可能已過期。') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const update = (patch: Partial<SnDraft>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true) }
  const replace = (next: SnDraft) => {
    const apply = () => { setDraft(next); setDirty(false); setTab('batch') }
    if (dirty) modal.confirm({ title: '捨棄尚未儲存的變更？', okText: '捨棄變更', cancelText: '繼續編輯', onOk: apply })
    else apply()
  }
  const persist = (next: SnDraft[]) => {
    if (storageError) return false
    try {
      // Do not overwrite a newer draft list from another browser tab.
      if (localStorage.getItem(storageKey) !== storageBaseline.current) {
        messageApi.error('另一個分頁已更新草稿，請先儲存手邊內容至其他地方，再重新載入此頁。')
        return false
      }
      const raw = JSON.stringify(next)
      parseDrafts(raw)
      localStorage.setItem(storageKey, raw)
      storageBaseline.current = raw; setSaved(next)
      return true
    } catch { messageApi.error('草稿儲存失敗，請檢查瀏覽器儲存空間與欄位內容。'); return false }
  }
  const save = () => {
    if (!draft.name.trim()) { messageApi.warning('請填寫批次名稱'); return }
    const next = { ...draft, name: draft.name.trim(), updatedAt: new Date().toISOString() }
    if (persist([next, ...saved.filter(d => d.id !== next.id)])) {
      setDraft(next); setDirty(false); messageApi.success('草稿已儲存在此瀏覽器')
    }
  }
  const selectProduct = (id: string) => {
    const p = products.find(p => p.id === id)
    if (!p) return
    update({ productId: p.id, productName: p.name, sku: p.sku, barcode: p.barcode || '', model: p.modelNumber || '',
      style: '', color: '', modelCode: '', styleCode: '', colorCode: '' })
  }
  let preview = '', previewError = ''
  try { preview = sampleSerial(draft) } catch (error) { previewError = (error as Error).message }
  let yearDisplay = '請先填寫製造日期'
  try { const year = manufacturingYear(draft.manufactureDate); yearDisplay = `${year} → ${yearCode(year)}` } catch { /* Incomplete draft. */ }
  const packing = cartonEstimate(draft.quantity, draft.capacity)
  const field = (key: 'modelCode' | 'styleCode' | 'colorCode', label: string) => <Form.Item label={label}>
    <Input aria-label={label} maxLength={6} value={draft[key]} onChange={e => update({ [key]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
  </Form.Item>
  const dateField = (key: 'orderDate' | 'manufactureDate', label: string) => <Form.Item label={label}>
    <DatePicker aria-label={label} placeholder="YYYY-MM-DD" format="YYYY-MM-DD" style={{ width: '100%' }}
      minDate={dayjs('2000-01-01')} maxDate={dayjs('2099-12-31')} value={draft[key] ? dayjs(draft[key]) : null}
      onChange={value => update({ [key]: value?.format('YYYY-MM-DD') || '' })} />
  </Form.Item>
  const rules = <div className="sn-rules">
    <section className="sn-panel"><h2>編碼預覽</h2><Form layout="vertical">
      <div className="sn-field-triple">{field('modelCode', '型號代碼')}{field('styleCode', '款式代碼')}{field('colorCode', '顏色代碼')}</div>
      {dateField('manufactureDate', '製造日期')}
      <Form.Item label="年份碼"><Input aria-label="年份碼" readOnly value={yearDisplay} /></Form.Item>
    </Form><p className="sn-muted">依製造年取西元後兩碼反轉。型號、款式、顏色與製造年相同時接續流水號；不同組合各自累加。</p>
      <div className="sn-code-parts"><span>品項代碼 4～6 碼</span><span>年份 2 碼</span><span>流水號 6 碼</span></div>
      <output className="sn-code-preview">{preview || '完成編碼資料以預覽'}</output>
      <p className="sn-muted">{preview ? `共 ${preview.length} 碼 · 000001 僅為格式樣張，尚未占用或配發號碼。` : previewError}</p>
    </section>
    <section className="sn-panel"><h2>已確認規則</h2><div className="sn-pending-list">{CONFIRMED_RULES.map(([name, description]) => <div key={name}><strong>{name}</strong><span>{description}</span><Tag>已確認</Tag></div>)}</div>
      <h2 className="sn-section-title">待確認事項</h2><div className="sn-pending-list">{PENDING_RULES.map(([name, description]) => <div key={name}><strong>{name}</strong><span>{description}</span><Tag>待確認</Tag></div>)}</div></section>
  </div>
  return <div className="sn-workspace">
    {messageContext}{modalContext}
    <header className="sn-heading"><div><h1>SN 與標籤</h1><p>建立生產批次，設計產品序號標籤。</p></div>
      <Space wrap><Tag>{dirty ? '尚未儲存' : draft.updatedAt ? '瀏覽器草稿' : '新草稿'}</Tag>
        <Button icon={<PlusOutlined />} onClick={() => replace(newDraft(crypto.randomUUID()))}>新增草稿</Button>
        <Button type="primary" icon={<SaveOutlined />} disabled={!!storageError} onClick={save}>儲存草稿</Button></Space>
    </header>
    <Alert type="info" showIcon message="目前為規劃草稿；正式發號與工廠列印尚未啟用。草稿只保存在此瀏覽器，請在離開前儲存。" />
    {storageError && <Alert type="error" showIcon message={storageError} />}
    {draft.legacyManualYear !== undefined && <Alert type="warning" showIcon message={`這份舊草稿的手填年份 ${draft.legacyManualYear} 已停用。預覽改依製造日期計算反轉年份碼，請重新核對標籤。`} />}
    <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
      { key: 'batch', label: '批次草稿', children: <>
        <div className="sn-batch-grid"><section className="sn-panel"><h2>批次資料</h2><Form layout="vertical">
          <Form.Item label="批次名稱" required><Input aria-label="批次名稱" maxLength={100} placeholder="例如：太空艙 9 月生產" value={draft.name} onChange={e => update({ name: e.target.value })} /></Form.Item>
          <Form.Item label="產品"><Select aria-label="產品" showSearch optionFilterProp="label" loading={loading} value={draft.productId || undefined}
            placeholder="搜尋產品名稱、SKU 或型號" onChange={selectProduct} options={products.map(p => ({ value: p.id, label: `${p.name} · ${p.sku}${p.modelNumber ? ' · ' + p.modelNumber : ''}` }))}
            notFoundContent={loading ? '載入中' : productError ? '讀取失敗' : '沒有符合的產品'} /></Form.Item>
          {productError && <Alert type="error" message={productError} action={<Button size="small" icon={<ReloadOutlined />} onClick={() => { setLoading(true); setProductError(''); setReload(n => n + 1) }}>重試</Button>} />}
          <dl className="sn-product-info"><div><dt>ERP SKU</dt><dd>{draft.sku || '—'}</dd></div><div><dt>國際條碼／保固匯入 SKU</dt><dd>{draft.barcode || '未提供'}</dd></div></dl>
          <div className="sn-field-triple">
            <Form.Item label="型號"><Input aria-label="型號" maxLength={60} value={draft.model} onChange={e => update({ model: e.target.value })} /></Form.Item>
            <Form.Item label="款式"><Input aria-label="款式" maxLength={60} value={draft.style} onChange={e => update({ style: e.target.value })} /></Form.Item>
            <Form.Item label="顏色"><Input aria-label="顏色" maxLength={60} value={draft.color} onChange={e => update({ color: e.target.value })} /></Form.Item>
          </div><p className="sn-muted">型號由產品帶入；款式與顏色先手動填寫，不會回寫產品資料。</p>
          <div className="sn-field-pair">
            {dateField('orderDate', '下單日期')}
            {dateField('manufactureDate', '製造日期')}
            <Form.Item label="預計 SN 數量"><InputNumber aria-label="預計 SN 數量" min={1} max={999999} precision={0} value={draft.quantity} onChange={v => v !== null && update({ quantity: v })} /></Form.Item>
            <Form.Item label="每箱容量（選填）"><InputNumber aria-label="每箱容量" min={1} max={999999} precision={0} placeholder="待確認" value={draft.capacity} onChange={v => update({ capacity: v })} /></Form.Item>
          </div>
        </Form></section>
        <section className="sn-panel sn-batch-summary"><h2>這批的準備進度</h2>
          <div><span>產品資料</span><strong>{draft.productId ? '已選取' : '待選取'}</strong></div>
          <div><span>編碼格式</span><strong>{preview ? '可預覽' : '待設定'}</strong></div>
          <div><span>預計數量</span><strong>{draft.quantity.toLocaleString()} 件</strong></div>
          <div><span>裝箱估算</span><strong>{packing ? `${packing.boxes} 箱` : '待填容量'}</strong></div>
          <div><span>正式配號</span><Tag>尚未啟用</Tag></div>
          <Button block onClick={() => setTab('rules')}>設定編碼</Button>
          <Button block onClick={() => setTab('design')}>設計標籤</Button>
          <p className="sn-muted">標籤與編碼設定隨草稿保存。尚未產生庫存、保固或箱號紀錄。</p>
        </section></div>
        <section className="sn-panel sn-saved"><h2>已存草稿 <span className="sn-muted">{saved.length}</span></h2>
          <Table size="small" rowKey="id" dataSource={saved} pagination={{ pageSize: 5, hideOnSinglePage: true }} scroll={{ x: 600 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未儲存草稿" /> }} columns={[
            { title: '批次', dataIndex: 'name' }, { title: '產品', render: (_, d: SnDraft) => d.productName || '待選取' },
            { title: '數量', dataIndex: 'quantity' }, { title: '更新時間', render: (_, d: SnDraft) => new Date(d.updatedAt).toLocaleString('zh-TW') },
            { title: '操作', render: (_, d: SnDraft) => <Space><Button size="small" onClick={() => replace(d)}>開啟</Button><Button size="small" aria-label={`刪除草稿 ${d.name}`} icon={<DeleteOutlined />} onClick={() => modal.confirm({ title: `刪除草稿「${d.name}」？`, content: '僅刪除此瀏覽器的草稿。', okText: '刪除', cancelText: '取消', onOk: () => { if (persist(saved.filter(s => s.id !== d.id)) && draft.id === d.id) { setDraft(newDraft(crypto.randomUUID())); setDirty(false) } } })} /></Space> },
          ]} />
        </section>
      </> },
      { key: 'design', label: '標籤設計', children: <section className="sn-panel"><LabelDesigner draft={draft} onChange={label => update({ label })} /></section> },
      { key: 'rules', label: '編碼規則', children: rules },
      { key: 'cartons', label: '裝箱規劃', children: <section className="sn-panel"><h2>裝箱估算</h2>
        {packing ? <><div className="sn-carton-metrics"><div><span>預計箱數</span><strong>{packing.boxes}</strong></div><div><span>完整箱</span><strong>{packing.full}</strong></div><div><span>尾箱件數</span><strong>{packing.remainder || '無尾箱'}</strong></div></div>
          <p className="sn-muted">依 {draft.quantity} 件、每箱 {draft.capacity} 件估算。尚未建立箱號或分配箱內 SN。</p></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先在批次草稿填寫每箱容量，即可估算箱數。" />}
        <CartonPreview key={JSON.stringify([draft.id, draft.quantity, draft.capacity, draft.modelCode, draft.styleCode, draft.colorCode, draft.manufactureDate])} draft={draft} />
        <p className="sn-muted">出貨維持連號與固定箱內清單，不開放跳號或任意換箱。箱號沿用 CTN－下單日期－型號－箱序格式；同日多次下單的正式合併與配號尚未啟用。</p>
        <div className="sn-pending-list">{PENDING_RULES.map(([name, description]) => <div key={name}><strong>{name}</strong><span>{description}</span><Tag>待確認</Tag></div>)}</div>
        <Space wrap className="sn-future-actions"><Button disabled>產生箱號</Button><Button disabled>外箱 PDF</Button><Button disabled>倉儲匯入檔</Button><Button disabled>保固匯入檔</Button></Space>
      </section> },
    ]} />
  </div>
}
