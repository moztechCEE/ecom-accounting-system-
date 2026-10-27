import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Dropdown, Modal, Space, Typography, message } from 'antd'
import { DownOutlined, PrinterOutlined } from '@ant-design/icons'
import { QRCodeSVG } from '@rc-component/qrcode'
import api from '../../services/api'
import { MAILROOM_LABEL_PRINT_STYLE, MailroomPrintBlockedError, physicalLabel } from './mailroom-label'
import type { DirectLabelPrint, MailroomLabelData, PhysicalLabel } from './mailroom-label'
import './mailroom-label.css'

export type { DirectLabelPrint } from './mailroom-label'

function Label({ value }: { value: PhysicalLabel }) {
  return <article className="mailroom-physical-label" data-item-id={value.id}>
    <div className="mailroom-label-case">案件 {value.caseNumber}</div>
    <div className="mailroom-label-qr"><QRCodeSVG value={value.link} size={76} marginSize={4} level="M" /></div>
    <div className="mailroom-label-copy"><div className="mailroom-label-name">姓名 {value.customerName}</div><div className="mailroom-label-phone">電話 {value.customerPhone}</div><div className="mailroom-label-issue">問題 {value.customerIssue}</div></div>
  </article>
}

export default function MailroomLabelPrint({ entityId, itemIds, disabled, directDisabled, iconOnly, ariaLabel = '列印物件標籤', pendingActionLabel = '核對後重新列印', onBusyChange, onDirectPrint }: {
  entityId: string; itemIds: string[]; disabled?: boolean; directDisabled?: boolean; iconOnly?: boolean; ariaLabel?: string;
  onBusyChange?: (busy: boolean) => void; onDirectPrint?: DirectLabelPrint;
  pendingActionLabel?: string;
}) {
  const [messageApi, contextHolder] = message.useMessage()
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [labels, setLabels] = useState<PhysicalLabel[]>([])
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
    setOpen(false); setLabels([]); setFailure(''); setFeedbackOpen(false); setUncertain(false); setMenuOpen(false); setLoading(false)
  }, [scope])
  useEffect(() => {
    if (!directDisabled || operationKind.current !== 'direct') return
    generation.current++; request.current?.abort(); operationKind.current = null; working.current = false; busy.current?.(false); setLoading(false)
  }, [directDisabled])
  useEffect(() => () => { generation.current++; request.current?.abort(); working.current = false; busy.current?.(false) }, [])

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
  async function preview() {
    const operation = begin('preview'); if (!operation) return
    setLabels([])
    try {
      const rows: PhysicalLabel[] = new Array(operation.ids.length)
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, operation.ids.length) }, async () => {
        while (cursor < operation.ids.length && active(operation)) {
          const index = cursor++, id = operation.ids[index]
          const response = await api.get<MailroomLabelData>('/mailroom/items/' + encodeURIComponent(id) + '/label', { params: { entityId }, signal: operation.controller.signal })
          if (response.data.id !== id) throw new Error('物件標籤資料不一致，請重新載入')
          rows[index] = physicalLabel(response.data, entityId)
        }
      }))
      if (active(operation)) { setLabels(rows); setOpen(true) }
    } catch (error) { if (active(operation)) { showFailure(error instanceof Error ? error.message : '標籤載入失敗'); operation.controller.abort() } }
    finally { finish(operation) }
  }
  async function directPrint(reprint = false) {
    if (disabled || directDisabled || working.current) return
    if (unknownResult.current && !reprint) { setFeedbackOpen(true); return }
    if (!onDirectPrint) { showFailure('尚未連接標籤列印服務'); return }
    const operation = begin('direct'); if (!operation) return
    try {
      const result = await onDirectPrint({ entityId, itemIds: operation.ids, requestId: crypto.randomUUID(), signal: operation.controller.signal })
      if (!active(operation)) return
      if (result.status === 'accepted' && typeof result.jobId === 'string' && result.jobId.trim()) {
        unknownResult.current = false; setUncertain(false); void messageApi.success(result.message || '已加入列印佇列')
      } else {
        unknownResult.current = true; setUncertain(true); showFailure(result.status === 'unknown' && result.message ? result.message : '列印結果尚未確認，請先核對印表機及工作紀錄')
      }
    } catch (error) { if (active(operation)) {
      if (error instanceof MailroomPrintBlockedError) { unknownResult.current = false; setUncertain(false); showFailure(error.message) }
      else { unknownResult.current = true; setUncertain(true); showFailure('列印結果尚未確認，請先核對印表機及工作紀錄') }
    } }
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
  const menu = { items: [{ key: 'preview', label: '預覽標籤', disabled: unavailable || loading }], onClick: () => { setMenuOpen(false); void preview() } }
  const printButton = <Button className={iconOnly ? 'mailroom-receiving-print' : undefined} icon={<PrinterOutlined aria-hidden />} aria-label={ariaLabel} title="列印標籤" disabled={unavailable || directDisabled} loading={loading} onClick={() => void directPrint()} onKeyDown={event => {
    if (iconOnly && ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')) { event.preventDefault(); setMenuOpen(true) }
  }}>{iconOnly ? undefined : '列印標籤'}</Button>
  return <>
    {contextHolder}
    {iconOnly ? <Dropdown trigger={['contextMenu']} menu={menu} open={menuOpen} onOpenChange={setMenuOpen}>{printButton}</Dropdown> : <Space.Compact>{printButton}<Dropdown menu={menu} trigger={['click']}><Button icon={<DownOutlined aria-hidden />} aria-label="標籤其他操作" disabled={unavailable || loading} /></Dropdown></Space.Compact>}
    <Modal title="標籤列印" open={feedbackOpen} onCancel={() => setFeedbackOpen(false)} footer={<Space><Button disabled={unavailable || loading} onClick={() => void preview()}>預覽標籤</Button>{uncertain && onDirectPrint && <Button disabled={unavailable || directDisabled || loading} onClick={() => void directPrint(true)}>{pendingActionLabel}</Button>}<Button onClick={() => setFeedbackOpen(false)}>關閉</Button></Space>}>
      <Typography.Text type="danger" role="alert">{failure}</Typography.Text>
    </Modal>
    <Modal title="物件標籤 · 50 × 30 mm" open={open} onCancel={() => { setOpen(false); setLabels([]) }} width={540} footer={<Button type="primary" icon={<PrinterOutlined aria-hidden />} disabled={unavailable || loading} onClick={browserPrint}>瀏覽器列印</Button>}>
      <div className="mailroom-label-preview">{labels.map(value => <Label key={value.id} value={value} />)}</div>
    </Modal>
  </>
}
