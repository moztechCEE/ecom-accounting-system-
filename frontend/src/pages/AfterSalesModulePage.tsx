import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { useParams, useSearchParams } from 'react-router-dom'
import api from '../services/api'
import CustomerRepairQueue from './repair/CustomerRepairQueue'
import { useRepairNavigationGuard } from './repair/repair-navigation'
import { Modal } from 'antd'

export default function AfterSalesModulePage() {
  const { section = 'cases' } = useParams()
  const [params] = useSearchParams()
  const entityId = params.get('entityId') || localStorage.getItem('entityId') || ''
  const frame = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [height, setHeight] = useState(950)
  const dirty = useRef(false)
  const iframeDirty = useRef(false), customerDirty = useRef(false)
  useRepairNavigationGuard(dirty, () => new Promise<boolean>(resolve => Modal.confirm({ title: '售後表單有未儲存修改',
    content: '請先儲存，或確認放棄修改後再離開。', okText: '放棄修改', cancelText: '保留表單',
    onOk: () => resolve(true), onCancel: () => resolve(false) })))
  const launch = useCallback(async () => {
    if (!entityId) { setError('請先選擇有售後來源權限的公司'); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/after-sales/module/launch', { entityId, section })
      const result = data.data || data
      if (result.action !== '/after-sales-app/api/integration/erp/session' || typeof result.ticket !== 'string') throw new Error('售後入口回應無效')
      const form = document.createElement('form')
      form.method = 'POST'; form.action = result.action; form.target = 'erp-after-sales-frame'
      const input = document.createElement('input'); input.type = 'hidden'; input.name = 'ticket'; input.value = result.ticket
      form.append(input); document.body.append(form); form.submit(); form.remove()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法開啟售後工作台'); setLoading(false) }
  }, [entityId, section])
  useEffect(() => { iframeDirty.current = false; customerDirty.current = false; dirty.current = false; void launch() }, [launch])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'corely.aftersales.v1') return
      if (event.data.ready) { setLoading(false); setError('') }
      if (typeof event.data.dirty === 'boolean') { iframeDirty.current = event.data.dirty; dirty.current = iframeDirty.current || customerDirty.current }
      if (Number.isFinite(event.data.height)) setHeight(Math.min(16000, Math.max(700, event.data.height)))
    }
    const protect = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('message', receive); window.addEventListener('beforeunload', protect)
    return () => { window.removeEventListener('message', receive); window.removeEventListener('beforeunload', protect) }
  }, [])
  return <div>
    {section === 'workbench' && entityId && <CustomerRepairQueue entityId={entityId} onDirtyChange={value => { customerDirty.current = value; dirty.current = value || iframeDirty.current }} />}
    {error && <Alert type="error" showIcon message="售後工作台未能開啟" description={error} action={<Button onClick={() => void (async () => {
      if (iframeDirty.current && !await new Promise<boolean>(resolve => Modal.confirm({ title: '售後表單尚未儲存', content: '重新開啟會放棄原售後表單修改；維修轉客服回覆仍保留。', okText: '重新開啟', cancelText: '保留表單', onOk: () => resolve(true), onCancel: () => resolve(false) }))) return
      iframeDirty.current = false; dirty.current = customerDirty.current; await launch()
    })()}>重新開啟</Button>} />}
    {loading && <div role="status" style={{ padding: 24 }}><Spin /> 正在開啟售後工作台…</div>}
    <iframe ref={frame} name="erp-after-sales-frame" title="售後案件與流程工作台" onLoad={() => {
      const body = frame.current?.contentDocument?.body?.textContent || ''
      if (body.trim().startsWith('{')) { try { const result = JSON.parse(body); if (result.error) { setError(result.error); setLoading(false) } } catch { /* Normal HTML remains handled by the ready message. */ } }
    }} style={{ width: '100%', height, border: 0, display: error ? 'none' : 'block' }} />
  </div>
}
