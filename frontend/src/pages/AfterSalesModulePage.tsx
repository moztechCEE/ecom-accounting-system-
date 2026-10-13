import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Collapse, Spin, Tabs } from 'antd'
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
import { trustedSourceInteractionBatch } from '../services/source-interaction-bridge'
import NativeAfterSalesWorkbench from './after-sales/NativeAfterSalesWorkbench'

type FrameLaunch = { attempt: AfterSalesAttempt; ticket: string; name: string }
export default function AfterSalesModulePage({ sectionOverride }: {sectionOverride?:string} = {}) {
  const { modal, message, contextHolder } = useRepairFeedback()
  const { section: routeSection = 'cases' } = useParams()
  const section = sectionOverride || routeSection
  const navigate = useNavigate(), {user} = useAuth()
  const [params] = useSearchParams()
  const entityId = params.get('entityId') || localStorage.getItem('entityId') || ''
  const intakeItemId=params.get('intakeItemId') || ''
  const sourceCaseId = params.get('sourceCaseId') || ''
  const sourceIntent = params.get('intent') === 'edit' ? 'edit' : 'detail'
  const canOpenSection = canOpenAfterSalesSection(user, section)
  const canReviewIntake = hasPermission(user, 'mailroom:review')
  const [intakeContext,setIntakeContext]=useState<{entityId:string;itemId:string;userId:string;item:Item}>()
  const frame = useRef<HTMLIFrameElement>(null)
  const session = useRef(createAfterSalesLaunchSession()), deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [frameLaunch, setFrameLaunch] = useState<FrameLaunch>()
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [height, setHeight] = useState(950)
  const [handoffsOpen, setHandoffsOpen] = useState(false)
  const [handoffTab, setHandoffTab] = useState('repair')
  const [repairItemId, setRepairItemId] = useState('')
  const [selectedIntakeId, setSelectedIntakeId] = useState('')
  const handoffRef = useRef<HTMLDivElement>(null)
  const dirty = useRef(false)
  const iframeDirty = useRef(false), customerDirty = useRef(false), intakeDirty = useRef(false), nativeDirty = useRef(false)
  const nativePending = useRef(false)
  const confirmDiscard = useCallback(() => {
    if (nativePending.current) { message.warning('案件建立結果尚未確認，請先重試確認'); return Promise.resolve(false) }
    return new Promise<boolean>(resolve => modal.confirm({ title: '售後表單有未儲存修改', content: '要放棄修改並離開嗎？', okText: '放棄修改', cancelText: '保留表單', onOk: () => resolve(true), onCancel: () => resolve(false) }))
  }, [modal, message])
  useRepairNavigationGuard(dirty, confirmDiscard)
  const clearDeadline = useCallback(() => { if (deadline.current !== undefined) clearTimeout(deadline.current); deadline.current = undefined }, [])
  const showFailure = useCallback((attempt: AfterSalesAttempt, message: string) => {
    if (session.current.current() !== attempt) return
    session.current.fail(attempt); clearDeadline(); setFrameLaunch(undefined); setError(message); setLoading(false)
  }, [clearDeadline])
  const launch = useCallback(async () => {
    clearDeadline(); session.current.invalidate(); setFrameLaunch(undefined)
    iframeDirty.current = false; dirty.current = customerDirty.current || intakeDirty.current || nativeDirty.current
    setHeight(950); setLoading(true); setError('')
    if (window.__APP_CONFIG__?.afterSalesModuleEnabled !== true) { setError('售後工作台尚未開通'); setLoading(false); return }
    if (!entityId) { setError('請先選擇公司'); setLoading(false); return }
    if (!canOpenSection) { setError('目前帳號無此售後功能權限'); setLoading(false); return }
    if (section === 'workbench') { setLoading(false); return }
    let attempt: AfterSalesAttempt
    try { attempt = session.current.begin(section, entityId, sourceCaseId || undefined, sourceIntent) }
    catch { setError('售後功能入口不存在'); setLoading(false); return }
    deadline.current = setTimeout(() => {
      if (session.current.timeout(attempt)) showFailure(attempt, '開啟逾時，請重新開啟')
    }, AFTER_SALES_READY_TIMEOUT_MS)
    try {
      const { data } = await api.post('/after-sales/module/launch', { entityId, section, ...(sourceCaseId ? { caseId: sourceCaseId, intent: sourceIntent } : {}) })
      if (!session.current.isCurrent(attempt)) return
      const result = data.data || data
      if (result.action !== '/after-sales-app/api/integration/erp/session' || typeof result.ticket !== 'string' || !result.ticket || result.ticket.length > 8192) throw new Error('售後入口回應無效')
      setFrameLaunch({ attempt, ticket: result.ticket, name: `erp-after-sales-frame-${attempt.id}` })
    } catch (cause) {
      if (session.current.isCurrent(attempt)) showFailure(attempt, cause instanceof Error ? cause.message : '無法開啟售後工作台')
    }
  }, [entityId, section, canOpenSection, sourceCaseId, sourceIntent, clearDeadline, showFailure, user?.id])
  useEffect(() => {
    iframeDirty.current = false; dirty.current = customerDirty.current || intakeDirty.current || nativeDirty.current; void launch()
    const currentSession = session.current
    return () => { currentSession.invalidate(); clearDeadline() }
  }, [launch, clearDeadline, intakeItemId])
  const visibleLaunch = frameLaunch?.attempt.section === section && frameLaunch.attempt.entityId === entityId && (frameLaunch.attempt.caseId || '') === sourceCaseId && (!sourceCaseId || frameLaunch.attempt.intent === sourceIntent) ? frameLaunch : undefined
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
      if (!attempt || event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.source !== attempt.frame) return
      if (event.data?.source === 'corely.aftersales.interactions.v1') {
        if (attempt.phase !== 'READY') return
        const items = trustedSourceInteractionBatch(event, window.location.origin, attempt.frame, attempt.phase)
        for (const detail of items) window.dispatchEvent(new CustomEvent('operation-interaction', { detail }))
        return
      }
      if (event.data?.source !== 'corely.aftersales.v1') return
      if (event.data.ready && attempt.phase === 'LOADING') {
        let url = ''
        try { url = frame.current?.contentWindow?.location.href || '' } catch { /* Cross-origin or error documents cannot prove readiness. */ }
        const result = session.current.ready(attempt, event.source, event.data.path, url, window.location.origin)
        if (result === 'mismatch') { showFailure(attempt, '頁面與所選功能不符，請重新開啟'); return }
        if (result === 'ready') { clearDeadline(); setLoading(false); setError('') }
      }
      if (attempt.phase !== 'READY') return
      if (typeof event.data.dirty === 'boolean') { iframeDirty.current = event.data.dirty; dirty.current = iframeDirty.current || customerDirty.current || intakeDirty.current || nativeDirty.current }
      if (Number.isFinite(event.data.height)) setHeight(Math.min(16000, Math.max(700, event.data.height)))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [clearDeadline, showFailure])
  useEffect(() => {
    let current = true
    if (!['cases', 'workbench'].includes(section) || !entityId || !user?.id || !canReviewIntake || !/^[A-Za-z0-9_-]{1,160}$/.test(intakeItemId)) return
    const actorId = user.id
    void mailroomIntake.item(entityId, intakeItemId).then(async item => {
      if (!current || item.id !== intakeItemId || (item as Item & { entityId?: string }).entityId && (item as Item & { entityId?: string }).entityId !== entityId || !item.caseIntake || item.caseIntake.ownerId !== actorId || !['ACCEPTED', 'RESOLVED'].includes(item.caseIntake.status)) return
      setIntakeContext({ entityId, itemId: intakeItemId, userId: actorId, item })
      if (section !== 'workbench') return
      if ((customerDirty.current || intakeDirty.current || nativeDirty.current || nativePending.current) && !await confirmDiscard()) return
      if (!current) return
      setSelectedIntakeId(intakeItemId); setHandoffTab('intake'); setHandoffsOpen(true)
    }).catch(() => { /* Invalid or unavailable URL context does not grant an intake action. */ })
    return () => { current = false }
  }, [section, entityId, intakeItemId, user?.id, canReviewIntake, confirmDiscard])
  const visibleIntake=canReviewIntake && intakeContext?.entityId===entityId && intakeContext.itemId===intakeItemId && intakeContext.userId===user?.id ? intakeContext.item:undefined
  const checkFrame = () => {
    const attempt = session.current.current()
    if (!attempt || frame.current?.contentWindow !== attempt.frame || attempt.phase === 'ERROR') return
    try {
      const doc = frame.current?.contentDocument
      const failure = afterSalesFrameFailure(doc?.body?.textContent || '', doc?.contentType || '', !!doc?.getElementById('__next_error__'))
      if (failure) showFailure(attempt, failure)
    } catch { showFailure(attempt, '售後頁面無法驗證來源，請重新開啟') }
  }
  const onNativeDirty = useCallback((value: boolean) => { nativeDirty.current = value; dirty.current = value || nativePending.current || iframeDirty.current || customerDirty.current || intakeDirty.current }, [])
  const onNativePending = useCallback((value: boolean) => { nativePending.current = value; dirty.current = value || nativeDirty.current || iframeDirty.current || customerDirty.current || intakeDirty.current }, [])
  const openSource = (destination: string, caseId?: string) => {
    if (!canOpenAfterSalesSection(user, destination)) return
    const query = new URLSearchParams()
    if (entityId) query.set('entityId', entityId)
    if (caseId) query.set('sourceCaseId', caseId)
    if (intakeItemId && ['workbench', 'cases'].includes(destination)) query.set('intakeItemId', intakeItemId)
    navigate(`/operations/after-sales/${destination}${query.size ? '?' + query.toString() : ''}`)
  }
  const openTask = (kind: 'repair' | 'intake', itemId: string) => void (async () => {
    if ((customerDirty.current || intakeDirty.current || nativeDirty.current) && !await confirmDiscard()) return
    setHandoffsOpen(true); setHandoffTab(kind)
    if (kind === 'repair') setRepairItemId(itemId)
    else setSelectedIntakeId(itemId)
    requestAnimationFrame(() => handoffRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  })()
  return <div>
    {contextHolder}
    {window.__APP_CONFIG__?.afterSalesModuleEnabled === true && section !== 'workbench' && <AfterSalesWorkbenchHub user={user} section={section} onOpen={destination => openSource(destination)} />}
    {window.__APP_CONFIG__?.afterSalesModuleEnabled === true && section === 'workbench' && canOpenSection && <NativeAfterSalesWorkbench entityId={entityId} onOpenSource={openSource} onOpenTask={openTask} onDirtyChange={onNativeDirty} onPendingChange={onNativePending} confirmDiscard={confirmDiscard} />}
    {section === 'workbench' && entityId && hasPermission(user, 'mailroom:review') && <div className="native-after-sales-handoffs" ref={handoffRef}><Collapse ghost activeKey={handoffsOpen ? ['handoffs'] : []} onChange={keys => void (async () => {
      const open = keys.includes('handoffs')
      if (!open && (customerDirty.current || intakeDirty.current) && !await confirmDiscard()) return
      setHandoffsOpen(open)
    })()} items={[{ key: 'handoffs', label: '部門交辦', children: <Tabs key={`${entityId}:${intakeItemId}`}
      activeKey={handoffTab} onChange={tab => void (async () => { if ((customerDirty.current || intakeDirty.current) && !await confirmDiscard()) return; setHandoffTab(tab) })()}
      items={[
        { key: 'repair', label: '維修交辦', forceRender: true, children: <CustomerRepairQueue key={entityId} entityId={entityId} initialItemId={repairItemId || undefined} onDirtyChange={value => { customerDirty.current = value; dirty.current = value || iframeDirty.current || intakeDirty.current || nativeDirty.current }} /> },
        { key: 'intake', label: '收發交辦', forceRender: true, children: <CustomerIntakeQueue key={`${entityId}:${selectedIntakeId}`} entityId={entityId} initialItemId={selectedIntakeId || undefined} onDirtyChange={value=>{intakeDirty.current=value;dirty.current=value||iframeDirty.current||customerDirty.current||nativeDirty.current;}} onOpenSource={itemId=>navigate(intakeSourceEntry(entityId,itemId))} /> },
      ]} /> }]} /></div>}
    {section==='cases' && visibleIntake && <Alert showIcon type="info" style={{marginBottom:16}} message={`收件 ${visibleIntake.label}：${visibleIntake.caseIntake?.status==='RESOLVED'?'已綁定案件':'待綁定案件'}`} description={visibleIntake.caseIntake?.status==='RESOLVED'?undefined:'新增案件後，返回此收件完成綁定。'} action={<Button data-operation-action="erp.aftersalesmodulepage.action.49f0fb17874d" onClick={()=>navigate(intakeReturnEntry(entityId,visibleIntake.id))}>返回收件綁定</Button>} />}
    {error && <Alert type="error" showIcon message="售後工作台未能開啟" description={error} action={<Button data-operation-action="erp.aftersalesmodulepage.action.117befe676c8" onClick={() => void (async () => {
      if (iframeDirty.current && !await new Promise<boolean>(resolve => modal.confirm({ title: '售後表單尚未儲存', content: '重新開啟會放棄此表單未儲存的修改。', okText: '重新開啟', cancelText: '保留表單', onOk: () => resolve(true), onCancel: () => resolve(false) }))) return
      await launch()
    })()}>重新開啟</Button>} />}
    {loading && <div role="status" style={{ padding: 24 }}><Spin /> 正在開啟售後工作台…</div>}
    {visibleLaunch && <iframe key={visibleLaunch.attempt.id} ref={attachFrame} name={visibleLaunch.name} title="售後案件與流程工作台" onLoad={checkFrame} onError={() => showFailure(visibleLaunch.attempt, '售後頁面載入失敗，請重新開啟')} style={{ width: '100%', height, border: 0, display: error ? 'none' : 'block' }} />}
  </div>
}
