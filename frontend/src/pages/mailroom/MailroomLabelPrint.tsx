import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Modal, Typography } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { QRCodeSVG } from '@rc-component/qrcode'
import api from '../../services/api'
import type { Item } from './model'
import { physicalLabel } from './mailroom-label'
import type { PhysicalLabel } from './mailroom-label'
import './mailroom-label.css'

function Label({ value }: { value: PhysicalLabel }) {
  return <article className="mailroom-physical-label" data-item-id={value.id}>
    <div className="mailroom-label-qr"><QRCodeSVG value={value.link} size={76} marginSize={4} level="M" /></div>
    <div className="mailroom-label-copy"><div className="mailroom-label-number">{value.numberKind} {value.number}</div><strong>{value.product}</strong><div className="mailroom-label-unit">{value.unit}</div></div>
  </article>
}
const PRINT_STYLE = '@page{size:50mm 30mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#000;background:#fff;font-family:Arial,"Noto Sans TC",sans-serif}.mailroom-physical-label{width:50mm;height:30mm;padding:2mm;display:grid;grid-template-columns:20mm 1fr;gap:2mm;align-items:center;overflow:hidden;break-after:page;page-break-after:always}.mailroom-physical-label:last-child{break-after:auto;page-break-after:auto}.mailroom-label-qr svg{display:block;width:20mm;height:20mm}.mailroom-label-copy{min-width:0;overflow-wrap:anywhere;line-height:1.2}.mailroom-label-number{font-size:7pt;margin-bottom:1mm}.mailroom-label-copy strong{font-size:8pt;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.mailroom-label-unit{font-size:6pt;margin-top:1mm;font-family:monospace}'

export default function MailroomLabelPrint({ entityId, itemIds, disabled, onBusyChange }: {
  entityId: string; itemIds: string[]; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [labels, setLabels] = useState<PhysicalLabel[]>([]), [failure, setFailure] = useState('')
  const request = useRef<AbortController | null>(null), generation = useRef(0), busy = useRef(onBusyChange)
  busy.current = onBusyChange
  const idsKey = JSON.stringify([...new Set(itemIds)])
  useEffect(() => { generation.current++; request.current?.abort(); setOpen(false); setLabels([]); setFailure(''); setLoading(false) }, [entityId, idsKey])
  useEffect(() => { busy.current?.(loading) }, [loading])
  useEffect(() => () => { generation.current++; request.current?.abort(); busy.current?.(false) }, [])
  async function preview() {
    const ids = JSON.parse(idsKey) as string[]
    if (disabled || loading || !ids.length) return
    if (ids.length > 50) { setFailure('每次最多列印 50 件'); return }
    const current = ++generation.current, controller = new AbortController(); request.current?.abort(); request.current = controller
    setLoading(true); setFailure(''); setLabels([])
    try {
      const rows: PhysicalLabel[] = new Array(ids.length)
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (cursor < ids.length) {
          const index = cursor++
          const response = await api.get<Item>('/mailroom/items/' + encodeURIComponent(ids[index]), { params: { entityId }, signal: controller.signal })
          if (response.data.id !== ids[index]) throw new Error('物件資料不一致，請重新載入')
          rows[index] = physicalLabel(response.data, entityId, window.location.origin)
        }
      }))
      if (current !== generation.current) return
      setLabels(rows); setOpen(true)
    } catch (error) { if (current === generation.current && !controller.signal.aborted) setFailure(error instanceof Error ? error.message : '標籤載入失敗') }
    finally { if (current === generation.current) setLoading(false) }
  }
  function print() {
    if (!labels.length) return
    const popup = window.open('', '_blank', 'width=700,height=600')
    if (!popup) { setFailure('請允許開啟列印視窗後再試'); return }
    popup.opener = null
    popup.document.open()
    popup.document.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>案件標籤</title><style>' + PRINT_STYLE + '</style></head><body>' + renderToStaticMarkup(<>{labels.map(value => <Label key={value.id} value={value} />)}</>) + '</body></html>')
    popup.document.close(); popup.focus(); popup.print()
  }
  return <>
    <Button icon={<PrinterOutlined />} aria-label="列印物件標籤" disabled={disabled || itemIds.length === 0} loading={loading} onClick={() => void preview()}>列印標籤</Button>
    {failure && <Typography.Text type="danger" role="alert">{failure}</Typography.Text>}
    <Modal title="物件標籤 · 50 × 30 mm" open={open} onCancel={() => setOpen(false)} width={540} footer={<Button type="primary" icon={<PrinterOutlined />} onClick={print}>列印</Button>}>
      <div className="mailroom-label-preview">{labels.map(value => <Label key={value.id} value={value} />)}</div>
    </Modal>
  </>
}
