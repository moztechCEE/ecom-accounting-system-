import { useEffect, useId, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Dropdown, Form, Input, Modal, Space, Typography, message } from 'antd'
import { DownOutlined, PrinterOutlined } from '@ant-design/icons'
import { QRCodeSVG } from '@rc-component/qrcode'
import api from '../../services/api'
import { previewErrorText } from '../../services/mailroom-print'
import { LABEL_EDIT_LIMITS, MAILROOM_LABEL_PRINT_STYLE, MailroomPrintBlockedError, editedLabel, labelEditFromData, physicalLabel } from './mailroom-label'
import type { DirectLabelPrint, LabelEditField, MailroomLabelData, MailroomLabelEdit, PhysicalLabel, PrintProgress } from './mailroom-label'
import './mailroom-label.css'

export type { DirectLabelPrint } from './mailroom-label'

function Label({ value }: { value: PhysicalLabel }) {
  return <article className="mailroom-physical-label" data-item-id={value.id}>
    <div className="mailroom-label-case">案件 {value.caseNumber}</div>
    <div className="mailroom-label-qr"><QRCodeSVG value={value.link} size={76} marginSize={4} level="M" /></div>
    <div className="mailroom-label-copy"><div className="mailroom-label-name">姓名 {value.customerName}</div><div className="mailroom-label-phone">電話 {value.customerPhone}</div><div className="mailroom-label-product">產品 {value.productName}</div><div className="mailroom-label-issue">問題 {value.customerIssue}</div></div>
  </article>
}

export default function MailroomLabelPrint({ entityId, itemIds, disabled, directDisabled, iconOnly, ariaLabel = '列印物件標籤', pendingActionLabel = '核對後重新列印', onBusyChange, onDirectPrint }: {
  entityId: string; itemIds: string[]; disabled?: boolean; directDisabled?: boolean; iconOnly?: boolean; ariaLabel?: string;
  onBusyChange?: (busy: boolean) => void; onDirectPrint?: DirectLabelPrint;
  pendingActionLabel?: string;
}) {
  const inputPrefix = useId()
  const [messageApi, contextHolder] = message.useMessage()
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [labels, setLabels] = useState<PhysicalLabel[]>([])
  const [editorOpen, setEditorOpen] = useState(false), [labelData, setLabelData] = useState<MailroomLabelData | null>(null), [edit, setEdit] = useState<MailroomLabelEdit | null>(null), [pdfUrl, setPdfUrl] = useState(''), [progress, setProgress] = useState<PrintProgress | ''>('')
  const pdf = useRef(''), editorVisible = useRef(false)
  editorVisible.current = editorOpen
  const [editorScope, setEditorScope] = useState('')
  const [failure, setFailure] = useState(''), [feedbackOpen, setFeedbackOpen] = useState(false), [uncertain, setUncertain] = useState(false), [menuOpen, setMenuOpen] = useState(false)
  const request = useRef<AbortController | null>(null), generation = useRef(0), working = useRef(false), unknownResult = useRef(false), busy = useRef(onBusyChange)
  const operationKind = useRef<'direct' | 'preview' | null>(null), directAllowed = useRef(!directDisabled)
  directAllowed.current = !directDisabled
  busy.current = onBusyChange
  const idsKey = JSON.stringify([...new Set(itemIds)])
  const scope = JSON.stringify([entityId, idsKey, !!disabled]), currentScope = useRef(scope)
  currentScope.current = scope
  useEffect(() => {
    generation.current++; request.current?.abort(); working.current = false; operationKind.current = null; unknownResult.current = false; busy.current?.(false)
    setOpen(false); setEditorOpen(false); setLabelData(null); setEdit(null); clearPdf(); setProgress(''); setLabels([]); setFailure(''); setFeedbackOpen(false); setUncertain(false); setMenuOpen(false); setLoading(false)
  }, [scope])
  useEffect(() => {
    if (!directDisabled) return
    if (editorVisible.current) { setEditorOpen(false); setEdit(null); setLabelData(null); clearPdf() }
    if (operationKind.current !== 'direct' && !editorVisible.current) return
    generation.current++; request.current?.abort(); operationKind.current = null; working.current = false; busy.current?.(false); setLoading(false)
  }, [directDisabled])
  useEffect(() => () => { generation.current++; request.current?.abort(); working.current = false; busy.current?.(false); if (pdf.current) URL.revokeObjectURL(pdf.current) }, [])

  function clearPdf() { if (pdf.current) URL.revokeObjectURL(pdf.current); pdf.current = ''; setPdfUrl('') }
  function closeEditor() { generation.current++; request.current?.abort(); working.current = false; operationKind.current = null; busy.current?.(false); setLoading(false); setEditorOpen(false); setEdit(null); setLabelData(null); clearPdf(); setProgress('') }
  function showFailure(value: string) { setFailure(value); setFeedbackOpen(true) }
  function begin(kind: 'direct' | 'preview') {
    const ids = JSON.parse(idsKey) as string[]
    if (disabled || (kind === 'direct' && directDisabled) || working.current || !entityId || !ids.length) return null
    if (ids.length > 50) { showFailure('每次最多列印 50 件'); return null }
    working.current = true; operationKind.current = kind; busy.current?.(true); setLoading(true); setFailure(''); setFeedbackOpen(false)
    const current = ++generation.current, controller = new AbortController(); request.current?.abort(); request.current = controller
    return { ids, current, controller, scope, kind }
  }
  function active(operation: NonNullable<ReturnType<typeof begin>>) {
    return operation.current === generation.current && operation.scope === currentScope.current && !operation.controller.signal.aborted && (operation.kind !== 'direct' || directAllowed.current)
  }
  function finish(operation: NonNullable<ReturnType<typeof begin>>) {
    if (operation.current !== generation.current || operation.scope !== currentScope.current) return
    working.current = false; operationKind.current = null; busy.current?.(false); setLoading(false)
  }
  async function preview(editing = false) {
    const operation = begin('preview'); if (!operation) return
    setLabels([])
    try {
      const rows: PhysicalLabel[] = new Array(operation.ids.length), originals: MailroomLabelData[] = new Array(operation.ids.length)
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, operation.ids.length) }, async () => {
        while (cursor < operation.ids.length && active(operation)) {
          const index = cursor++, id = operation.ids[index]
          const response = await api.get<MailroomLabelData>('/mailroom/items/' + encodeURIComponent(id) + '/label', { params: { entityId }, signal: operation.controller.signal })
          if (response.data.id !== id) throw new Error('物件標籤資料不一致，請重新載入')
          originals[index] = response.data
          rows[index] = physicalLabel(response.data, entityId)
        }
      }))
      if (active(operation)) {
        if (editing && originals.length === 1) { setEditorScope(operation.scope); setLabelData(originals[0]); setEdit(labelEditFromData(originals[0])); setEditorOpen(true); clearPdf(); setProgress('') }
        else { setLabels(rows); setOpen(true) }
      }
    } catch (error) { if (active(operation)) { showFailure(error instanceof Error ? error.message : '標籤載入失敗'); operation.controller.abort() } }
    finally { finish(operation) }
  }
  async function directPrint(reprint = false, edited?: MailroomLabelEdit) {
    if (disabled || directDisabled || working.current) return
    if (unknownResult.current && !reprint) { setFeedbackOpen(true); return }
    if (!onDirectPrint) { showFailure('尚未連接標籤列印服務'); return }
    const operation = begin('direct'); if (!operation) return
    setProgress('製作標籤')
    const lastProgress: { value: PrintProgress } = { value: '製作標籤' }
    try {
      const result = await onDirectPrint({ entityId, itemIds: operation.ids, requestId: crypto.randomUUID(), signal: operation.controller.signal, ...(edited ? { labelEdits: [edited] } : {}), onProgress: value => { if (active(operation)) { lastProgress.value = value; setProgress(value) } } })
      if (!active(operation)) return
      if (result.status === 'accepted' && typeof result.jobId === 'string' && result.jobId.trim()) {
        unknownResult.current = false; setUncertain(false); void messageApi.success(result.message || (lastProgress.value === '等待電腦接收' ? '等待電腦接收；再次點按只會查詢原工作' : '已加入列印佇列'))
      } else {
        unknownResult.current = true; setUncertain(true); showFailure(result.status === 'unknown' && result.message ? result.message : '列印結果尚未確認，請先核對印表機及工作紀錄')
      }
    } catch (error) { if (active(operation)) {
      if (error instanceof MailroomPrintBlockedError) { unknownResult.current = false; setUncertain(false); showFailure(error.message) }
      else { unknownResult.current = true; setUncertain(true); showFailure('列印結果尚未確認，請先核對印表機及工作紀錄') }
    } }
    finally { finish(operation); if (operation.current === generation.current) setProgress('') }
  }
  async function actualPdf() {
    if (!edit || !labelData || directDisabled) return
    const operation = begin('preview'); if (!operation) return
    clearPdf()
    try {
      const result = await api.post<Blob>('/mailroom/print-label-preview', { entityId, itemId: labelData.id, labelEdit: edit }, { responseType: 'blob', signal: operation.controller.signal })
      if (!active(operation)) return
      if (result.data.type !== 'application/pdf') throw new Error('標籤 PDF 格式不正確')
      pdf.current = URL.createObjectURL(result.data); setPdfUrl(pdf.current)
    } catch (error) {
      if (active(operation)) {
        const text = error && typeof error === 'object' && 'response' in error ? await previewErrorText(error) : error instanceof Error ? error.message : '無法製作標籤預覽'
        if (active(operation)) showFailure(text)
      }
    }
    finally { finish(operation) }
  }
  function browserPrint() {
    if (disabled || working.current || !labels.length) return
    const popup = window.open('', '_blank', 'width=700,height=600')
    if (!popup) { showFailure('請允許開啟列印視窗後再試'); return }
    popup.opener = null
    popup.document.open()
    popup.document.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>案件標籤</title><style>' + MAILROOM_LABEL_PRINT_STYLE + '</style></head><body>' + renderToStaticMarkup(<>{labels.map(value => <Label key={value.id} value={value} />)}</>) + '</body></html>')
    popup.document.close(); popup.focus(); popup.print()
  }
  const unavailable = disabled || !entityId || itemIds.length === 0
  const menu = { items: [{ key: 'edit', label: '編輯標籤並列印', disabled: unavailable || directDisabled || loading || itemIds.length !== 1 }, { key: 'preview', label: '預覽標籤', disabled: unavailable || loading }], onClick: ({ key }: { key: string }) => { setMenuOpen(false); void preview(key === 'edit') } }
  const editorLabel = editorScope === scope && labelData && edit ? editedLabel(labelData, edit, entityId) : null
  const fieldLabels: Record<LabelEditField, string> = { caseNumber: '貼紙案件號', customerName: '姓名', customerPhone: '電話', productName: '產品', customerIssue: '問題摘要' }
  const printButton = <Button className={iconOnly ? 'mailroom-receiving-print' : undefined} icon={<PrinterOutlined aria-hidden />} aria-label={ariaLabel} title="列印標籤" disabled={unavailable || directDisabled} loading={loading} onClick={() => void directPrint()} onKeyDown={event => {
    if (iconOnly && ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')) { event.preventDefault(); setMenuOpen(true) }
  }}>{iconOnly ? undefined : '列印標籤'}</Button>
  return <>
    {contextHolder}
    <Space.Compact className="mailroom-print-actions">{printButton}<Dropdown menu={menu} trigger={['click']} open={menuOpen} onOpenChange={setMenuOpen}><Button className="mailroom-label-more" icon={<DownOutlined aria-hidden />} aria-label={iconOnly ? ariaLabel.replace('列印物件標籤', '標籤其他操作') : '標籤其他操作'} title="編輯或預覽標籤" disabled={unavailable || loading} /></Dropdown></Space.Compact>
    {loading && progress && !editorOpen && <span className="mailroom-print-progress" role="status">{progress}</span>}
    <Modal title="標籤列印" open={feedbackOpen} onCancel={() => setFeedbackOpen(false)} footer={<Space><Button disabled={unavailable || loading} onClick={() => void preview()}>預覽標籤</Button>{uncertain && onDirectPrint && <Button disabled={unavailable || directDisabled || loading} onClick={() => void directPrint(true, editorOpen ? edit || undefined : undefined)}>{pendingActionLabel}</Button>}<Button onClick={() => setFeedbackOpen(false)}>關閉</Button></Space>}>
      <Typography.Text type="danger" role="alert">{failure}</Typography.Text>
    </Modal>
    <Modal key={scope + ":" + !!directDisabled} title="編輯標籤 · 50 × 30 mm" className="mailroom-label-editor" open={editorOpen && editorScope === scope && !directDisabled} onCancel={closeEditor} width={680} footer={<Space wrap><Button disabled={loading || !labelData} onClick={() => { if (labelData) { setEdit(labelEditFromData(labelData)); clearPdf() } }}>恢復原資料</Button><Button disabled={unavailable || directDisabled || loading} onClick={() => void actualPdf()}>查看實際 PDF</Button>{loading && progress && <span className="mailroom-print-progress" role="status">{progress}</span>}<Button type="primary" icon={<PrinterOutlined aria-hidden />} disabled={unavailable || directDisabled || loading || !edit} loading={loading} onClick={() => { if (edit) void directPrint(false, edit) }}>列印這張標籤</Button></Space>}>
      <Typography.Text type="secondary">僅套用這次標籤</Typography.Text>
      <div className="mailroom-label-editor-layout">
        <Form layout="vertical" className="mailroom-label-fields">{editorScope === scope && edit && (Object.keys(LABEL_EDIT_LIMITS) as LabelEditField[]).map(field => <Form.Item key={field} label={<label htmlFor={inputPrefix + '-' + field}>{fieldLabels[field]}</label>}><Input id={inputPrefix + '-' + field} aria-label={fieldLabels[field]} autoComplete="off" disabled={loading || directDisabled} value={edit[field] || ''} maxLength={LABEL_EDIT_LIMITS[field]} onChange={event => { setEdit({ ...edit, [field]: event.target.value.replace(/\p{Cc}/gu, '') }); clearPdf() }} /></Form.Item>)}</Form>
        <div><div className="mailroom-label-preview" aria-label="標籤即時預覽">{editorLabel && <Label value={editorLabel} />}</div><Typography.Text type="secondary" className="mailroom-label-preview-caption">超出貼紙範圍的文字將省略</Typography.Text></div>
      </div>
      {editorOpen && editorScope === scope && !directDisabled && pdfUrl && <div className="mailroom-label-pdf"><a href={pdfUrl} target="_blank" rel="noopener noreferrer">開啟實際 PDF</a><iframe title="實際標籤 PDF" src={pdfUrl} /></div>}
    </Modal>
    <Modal title="物件標籤 · 50 × 30 mm" open={open} onCancel={() => { setOpen(false); setLabels([]) }} width={540} footer={<Button type="primary" icon={<PrinterOutlined aria-hidden />} disabled={unavailable || loading} onClick={browserPrint}>瀏覽器列印</Button>}>
      <div className="mailroom-label-preview">{labels.map(value => <Label key={value.id} value={value} />)}</div>
    </Modal>
  </>
}
