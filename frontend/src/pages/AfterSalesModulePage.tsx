import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Spin, Tabs } from 'antd'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import CustomerIntakeQueue from './mailroom/CustomerIntakeQueue'
import { mailroomIntake } from '../services/mailroom-intake'
import { intakeReturnEntry, intakeSourceEntry } from './mailroom/intake-actions'
import type { Item } from './mailroom/model'
import api from '../services/api'
import CustomerRepairQueue from './repair/CustomerRepairQueue'
import { useRepairNavigationGuard } from './repair/repair-navigation'
import { useRepairFeedback } from './repair/repair-feedback'
import { AFTER_SALES_READY_TIMEOUT_MS, afterSalesFrameFailure, createAfterSalesLaunchSession } from './repair/after-sales-launch'
import type { AfterSalesAttempt } from './repair/after-sales-launch'
import AfterSalesWorkbenchHub from './after-sales/AfterSalesWorkbenchHub'
import { canOpenAfterSalesSection } from './after-sales/workbench-model'
import { hasPermission } from '../utils/access'

type FrameLaunch = { attempt: AfterSalesAttempt; ticket: string; name: string }
export default function AfterSalesModulePage() {
  const { modal, contextHolder } = useRepairFeedback()
  const { section = 'cases' } = useParams()
  const navigate = useNavigate(), {user} = useAuth()
  const [params] = useSearchParams()
  const entityId = params.get('entityId') || localStorage.getItem('entityId') || ''
  const intakeItemId=params.get('intakeItemId') || ''
  const canOpenSection = canOpenAfterSalesSection(user, section)
  const [intakeContext,setIntakeContext]=useState<{entityId:string;itemId:string;item:Item}>()
  const frame = useRef<HTMLIFrameElement>(null)
  const session = useRef(createAfterSalesLaunchSession()), deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [frameLaunch, setFrameLaunch] = useState<FrameLaunch>()
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [height, setHeight] = useState(950)
  const [showOverview, setShowOverview] = useState(false)
  const dirty = useRef(false)
  const iframeDirty = useRef(false), customerDirty = useRef(false), intakeDirty = useRef(false)
  useRepairNavigationGuard(dirty, () => new Promise<boolean>(resolve => modal.confirm({ title: '售後表單有未儲存修改',
    content: '請先儲存，或確認放棄修改後再離開。', okText: '放棄修改', cancelText: '保留表單',
    onOk: () => resolve(true), onCancel: () => resolve(false) })))
  const clearDeadline = useCallback(() => { if (deadline.current !== undefined) clearTimeout(deadline.current); deadline.current = undefined }, [])
  const showFailure = useCallback((attempt: AfterSalesAttempt, message: string) => {
    if (session.current.current() !== attempt) return
    session.current.fail(attempt); clearDeadline(); setFrameLaunch(undefined); setError(message); setLoading(false)
  }, [clearDeadline])
  const launch = useCallback(async () => {
    clearDeadline(); session.current.invalidate(); setFrameLaunch(undefined)
    iframeDirty.current = false; dirty.current = customerDirty.current || intakeDirty.current
    setHeight(950); setLoading(true); setError('')
    if (window.__APP_CONFIG__?.afterSalesModuleEnabled !== true) { setError('售後工作台尚未開通'); setLoading(false); return }
    if (!entityId) { setError('請先選擇有售後來源權限的公司'); setLoading(false); return }
    if (!canOpenSection) { setError('此帳號沒有目前售後功能或公司範圍的權限'); setLoading(false); return }
    if (section === 'workbench' && !showOverview) { setLoading(false); return }
    let attempt: AfterSalesAttempt
    try { attempt = session.current.begin(section, entityId) }
    catch { setError('售後功能入口不存在'); setLoading(false); return }
    deadline.current = setTimeout(() => {
      if (session.current.timeout(attempt)) showFailure(attempt, '售後頁面未能在限定時間內開啟，請重新開啟；若持續發生，請聯絡管理者')
    }, AFTER_SALES_READY_TIMEOUT_MS)
    try {
      const { data } = await api.post('/after-sales/module/launch', { entityId, section })
      if (!session.current.isCurrent(attempt)) return
      const result = data.data || data
      if (result.action !== '/after-sales-app/api/integration/erp/session' || typeof result.ticket !== 'string' || !result.ticket || result.ticket.length > 8192) throw new Error('售後入口回應無效')
      setFrameLaunch({ attempt, ticket: result.ticket, name: `erp-after-sales-frame-${attempt.id}` })
    } catch (cause) {
      if (session.current.isCurrent(attempt)) showFailure(attempt, cause instanceof Error ? cause.message : '無法開啟售後工作台')
    }
  }, [entityId, section, canOpenSection, showOverview, clearDeadline, showFailure])
  useEffect(() => {
    iframeDirty.current = false; dirty.current = customerDirty.current || intakeDirty.current; void launch()
    const currentSession = session.current
    return () => { currentSession.invalidate(); clearDeadline() }
  }, [launch, clearDeadline, intakeItemId])
  const visibleLaunch = frameLaunch?.attempt.section === section && frameLaunch.attempt.entityId === entityId ? frameLaunch : undefined
  const attachFrame = useCallback((node: HTMLIFrameElement | null) => {
    frame.current = node
    if (!node || !visibleLaunch) return
    const { attempt, ticket, name } = visibleLaunch
    if (!node.contentWindow || !session.current.attach(attempt, node.contentWindow)) return
    const form = document.createElement('form')
    form.method = 'POST'; form.action = '/after-sales-app/api/integration/erp/session'; form.target = name
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'ticket'; input.value = ticket
    form.append(input); document.body.append(form)
    try { form.submit() } catch { showFailure(attempt, '無法開啟售後登入入口，請重新開啟') }
    finally { form.remove() }
  }, [visibleLaunch, showFailure])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const attempt = session.current.current()
      if (!attempt || event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.source !== attempt.frame || event.data?.source !== 'corely.aftersales.v1') return
      if (event.data.ready && attempt.phase === 'LOADING') {
        let url = ''
        try { url = frame.current?.contentWindow?.location.href || '' } catch { /* Cross-origin or error documents cannot prove readiness. */ }
        const result = session.current.ready(attempt, event.source, event.data.path, url, window.location.origin)
        if (result === 'mismatch') { showFailure(attempt, '售後頁面與所選入口不一致，請重新開啟並核對公司與功能權限'); return }
        if (result === 'ready') { clearDeadline(); setLoading(false); setError('') }
      }
      if (attempt.phase !== 'READY') return
      if (typeof event.data.dirty === 'boolean') { iframeDirty.current = event.data.dirty; dirty.current = iframeDirty.current || customerDirty.current || intakeDirty.current }
      if (Number.isFinite(event.data.height)) setHeight(Math.min(16000, Math.max(700, event.data.height)))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [clearDeadline, showFailure])
  useEffect(()=>{let current=true;if(section!=='cases' || !entityId || !intakeItemId || !/^[A-Za-z0-9_-]{1,160}$/.test(intakeItemId))return;void mailroomIntake.item(entityId,intakeItemId).then(item=>{if(current && item.caseIntake && item.caseIntake.ownerId===user?.id && ['ACCEPTED','RESOLVED'].includes(item.caseIntake.status))setIntakeContext({entityId,itemId:intakeItemId,item});}).catch(()=>{/* Original source form remains independent; invalid intake context gives no bind capability. */});return()=>{current=false;};},[section,entityId,intakeItemId,user?.id])
  const visibleIntake=intakeContext?.entityId===entityId && intakeContext.itemId===intakeItemId ? intakeContext.item:undefined
  const checkFrame = () => {
    const attempt = session.current.current()
    if (!attempt || frame.current?.contentWindow !== attempt.frame || attempt.phase === 'ERROR') return
    try {
      const doc = frame.current?.contentDocument
      const failure = afterSalesFrameFailure(doc?.body?.textContent || '', doc?.contentType || '', !!doc?.getElementById('__next_error__'))
      if (failure) showFailure(attempt, failure)
    } catch { showFailure(attempt, '售後頁面無法驗證來源，請重新開啟') }
  }
  return <div>
    {contextHolder}
    {window.__APP_CONFIG__?.afterSalesModuleEnabled === true && <AfterSalesWorkbenchHub user={user} section={section} onOpen={destination => {
      const query = new URLSearchParams()
      if (entityId) query.set('entityId', entityId)
      if (intakeItemId && ['workbench', 'cases'].includes(destination)) query.set('intakeItemId', intakeItemId)
      navigate(`/operations/after-sales/${destination}${query.size ? '?' + query.toString() : ''}`)
    }} />}
    {section === 'workbench' && entityId && hasPermission(user, 'mailroom:review') && <Tabs key={`${entityId}:${intakeItemId}`}
      defaultActiveKey={intakeItemId ? 'intake' : 'repair'}
      items={[
        { key: 'repair', label: '維修交辦', forceRender: true, children: <CustomerRepairQueue key={entityId} entityId={entityId} onDirtyChange={value => { customerDirty.current = value; dirty.current = value || iframeDirty.current || intakeDirty.current }} /> },
        { key: 'intake', label: '收發交辦', forceRender: true, children: <CustomerIntakeQueue key={entityId} entityId={entityId} initialItemId={intakeItemId} onDirtyChange={value=>{intakeDirty.current=value;dirty.current=value||iframeDirty.current||customerDirty.current;}} onOpenSource={itemId=>navigate(intakeSourceEntry(entityId,itemId))} /> },
      ]} />}
    {section === 'workbench' && entityId && window.__APP_CONFIG__?.afterSalesModuleEnabled === true && canOpenAfterSalesSection(user, 'workbench') && <Button style={{ marginBottom: 16 }} onClick={() => void (async () => {
      if (showOverview && iframeDirty.current && !await new Promise<boolean>(resolve => modal.confirm({ title: '案件概況有未儲存修改', content: '請先儲存，或確認放棄修改後再收起。', okText: '收起', cancelText: '保留', onOk: () => resolve(true), onCancel: () => resolve(false) }))) return
      setShowOverview(value => !value)
    })()}>{showOverview ? '收起案件概況' : '查看案件概況'}</Button>}
    {section==='cases' && visibleIntake && <Alert showIcon type="info" style={{marginBottom:16}} message={`原收件 ${visibleIntake.label}：${visibleIntake.caseIntake?.status==='RESOLVED'?'已綁定來源案件':'客服本人補建中'}`} description="請沿用下方原售後『新增案件』表單。案件建立成功後，返回同一原收件選擇來源品項與版次完成綁定；此提示不表示案件已建立或實物已交接。" action={<Button onClick={()=>navigate(intakeReturnEntry(entityId,visibleIntake.id))}>返回原收件綁案</Button>} />}
    {error && <Alert type="error" showIcon message="售後工作台未能開啟" description={error} action={<Button onClick={() => void (async () => {
      if (iframeDirty.current && !await new Promise<boolean>(resolve => modal.confirm({ title: '售後表單尚未儲存', content: '重新開啟會放棄原售後表單修改；維修轉客服回覆仍保留。', okText: '重新開啟', cancelText: '保留表單', onOk: () => resolve(true), onCancel: () => resolve(false) }))) return
      await launch()
    })()}>重新開啟</Button>} />}
    {loading && <div role="status" style={{ padding: 24 }}><Spin /> 正在開啟售後工作台…</div>}
    {visibleLaunch && <iframe key={visibleLaunch.attempt.id} ref={attachFrame} name={visibleLaunch.name} title="售後案件與流程工作台" onLoad={checkFrame} onError={() => showFailure(visibleLaunch.attempt, '售後頁面載入失敗，請重新開啟')} style={{ width: '100%', height, border: 0, display: error ? 'none' : 'block' }} />}
  </div>
}
