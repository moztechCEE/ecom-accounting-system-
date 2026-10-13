import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Collapse, Descriptions, Empty, Input, Pagination, Select, Spin, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, EllipsisOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { useAuth } from '../../contexts/AuthContext'
import { nativeAfterSales } from '../../services/native-after-sales.service'
import type { NativeCaseDetail, NativeCaseList, NativeCaseRow, NativeOptions } from '../../services/native-after-sales.service'
import { changeNativeFilter, nativeCaseTypeLabel, nativeFilters, NATIVE_CASE_TYPES } from './native-workbench-model'
import NativeCaseCommunication from './NativeCaseCommunication'
import NativeAfterSalesCreate from './NativeAfterSalesCreate'
import { canOpenAfterSalesSection } from './workbench-model'
import { STATUS } from '../mailroom/model'
import { CSR_STATUS } from '../repair/repair-model'
import { afterSalesFieldValue } from '../../utils/after-sales-display'
import { readPendingRegistration } from './pending-registration'
import type { PendingRegistration } from './pending-registration'
import './NativeAfterSalesWorkbench.css'

type Props = {
  entityId: string
  onOpenSource: (section: string, caseId?: string) => void
  onOpenTask: (kind: 'repair' | 'intake', itemId: string) => void
  onDirtyChange: (dirty: boolean) => void
  onPendingChange: (pending: boolean) => void
  confirmDiscard: () => Promise<boolean>
}

export function nativeWorkbenchError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } })?.response
  const message = response?.data?.message
  if (typeof message === 'string' && message.length < 500) return message
  if (Array.isArray(message) && message.every(item => typeof item === 'string')) return message.join('；')
  if (response?.status === 403) return '目前帳號沒有此案件權限'
  if (response?.status === 404) return '找不到案件'
  if (response?.status === 503 || response?.status === 502) return '售後資料暫時無法讀取，請重試'
  return '無法完成操作，請重試'
}

const updatedDate = (value: string | null) => value && dayjs(value).isValid() ? dayjs(value).format('MM/DD HH:mm') : '—'

export default function NativeAfterSalesWorkbench({ entityId, onOpenSource, onOpenTask, onDirtyChange, onPendingChange, confirmDiscard }: Props) {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const filters = nativeFilters(params)
  const selectedId = params.get('case') || ''
  const [more, setMore] = useState(Boolean(filters.brand || filters.lifecycle !== 'active'))
  const [creating, setCreating] = useState(false)
  const [resumeAttempt, setResumeAttempt] = useState<PendingRegistration>()
  const [journalError, setJournalError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState(filters.search || '')
  const [listResult, setListResult] = useState<{ key: string; data?: NativeCaseList; error?: string }>()
  const [detailResult, setDetailResult] = useState<{ key: string; data?: NativeCaseDetail; error?: string }>()
  const [optionsResult, setOptionsResult] = useState<{ key: string; data?: NativeOptions; error?: string }>()
  const dirty = useRef(false)
  const pending = useRef(false)
  const scopeKey = JSON.stringify([entityId, user?.id])
  const listKey = JSON.stringify([scopeKey, filters, refresh])
  const detailKey = JSON.stringify([scopeKey, selectedId, refresh])
  const optionsKey = JSON.stringify([scopeKey, refresh])
  const list = listResult?.key === listKey ? listResult.data : undefined
  const listError = !entityId ? '請先選擇公司' : listResult?.key === listKey ? listResult.error : undefined
  const loading = Boolean(entityId) && listResult?.key !== listKey
  const detail = detailResult?.key === detailKey ? detailResult.data : undefined
  const detailError = detailResult?.key === detailKey ? detailResult.error : undefined
  const detailLoading = Boolean(entityId && selectedId) && detailResult?.key !== detailKey
  const options = optionsResult?.key === optionsKey ? optionsResult.data : undefined
  const optionsError = optionsResult?.key === optionsKey ? optionsResult.error : undefined
  const canCreate = !journalError && Boolean(options?.createTypes.length)

  useEffect(() => { setQuery(filters.search || '') }, [filters.search])
  useEffect(() => {
    setCreating(false); setResumeAttempt(undefined); setJournalError(''); dirty.current = false; pending.current = false; onPendingChange(false); onDirtyChange(false)
    if (user?.id && entityId) {
      try {
        const saved = readPendingRegistration(window.localStorage, { actorId: user.id, entityId })
        if (saved) { setResumeAttempt(saved); setCreating(true); pending.current = true; dirty.current = true; onPendingChange(true); onDirtyChange(true) }
      } catch (error) { setJournalError(error instanceof Error ? error.message : '待確認建單資料無法讀取'); pending.current = true; dirty.current = true; onPendingChange(true); onDirtyChange(true) }
    }
    return () => { onPendingChange(false); onDirtyChange(false) }
  }, [scopeKey, onDirtyChange, onPendingChange])
  useEffect(() => {
    const abort = new AbortController()
    if (!entityId) return () => abort.abort()
    void nativeAfterSales.list(entityId, filters, abort.signal).then(data => {
      if (!abort.signal.aborted) setListResult({ key: listKey, data })
    }).catch(error => { if (!abort.signal.aborted) setListResult({ key: listKey, error: nativeWorkbenchError(error) }) })
    return () => abort.abort()
  }, [entityId, listKey])
  useEffect(() => {
    const abort = new AbortController()
    if (!entityId || !selectedId) return () => abort.abort()
    void nativeAfterSales.detail(entityId, selectedId, abort.signal).then(data => {
      if (!abort.signal.aborted) setDetailResult({ key: detailKey, data })
    }).catch(error => { if (!abort.signal.aborted) setDetailResult({ key: detailKey, error: nativeWorkbenchError(error) }) })
    return () => abort.abort()
  }, [entityId, selectedId, detailKey])
  useEffect(() => {
    const abort = new AbortController()
    if (!entityId) return () => abort.abort()
    void nativeAfterSales.options(entityId, abort.signal).then(data => {
      if (!abort.signal.aborted) setOptionsResult({ key: optionsKey, data })
    }).catch(error => { if (!abort.signal.aborted) setOptionsResult({ key: optionsKey, error: nativeWorkbenchError(error) }) })
    return () => abort.abort()
  }, [entityId, optionsKey])

  const markDirty = useCallback((value: boolean) => { dirty.current = value; onDirtyChange(value) }, [onDirtyChange])
  const markPending = useCallback((value: boolean) => { pending.current = value; onPendingChange(value) }, [onPendingChange])
  async function leaveForm() {
    if (pending.current) { await confirmDiscard(); return false }
    if (dirty.current && !await confirmDiscard()) return false
    markDirty(false)
    return true
  }
  const filter = (key: string, value?: string) => setParams(current => changeNativeFilter(current, key, value), { replace: true })
  async function openCase(id?: string) {
    if (!await leaveForm()) return
    setCreating(false)
    setParams(current => changeNativeFilter(current, 'case', id))
  }
  async function openCreate() {
    if (!canCreate || !await leaveForm()) return
    setParams(current => changeNativeFilter(current, 'case'))
    setCreating(true)
  }
  const changedFilters = Boolean(filters.type || filters.stage || filters.brand || filters.search || filters.lifecycle !== 'active')
  const clearFilters = () => setParams(current => {
    const next = new URLSearchParams(current)
    for (const key of ['type', 'stage', 'brand', 'q', 'view', 'page']) next.delete(key)
    return next
  }, { replace: true })
  const stageOptions = options?.stages || []
  const lifecycleLabel = filters.lifecycle === 'closed' ? '已結束' : filters.lifecycle === 'deleted' ? '刪除清單' : '進行中'

  return <section className="native-after-sales" aria-labelledby="native-after-sales-title">
    <header className="native-after-sales-heading">
      <Typography.Title level={2} id="native-after-sales-title" className="native-after-sales-title">售後工作台</Typography.Title>
      <div className="native-after-sales-heading-actions">
        <Button data-operation-action="erp.nativeaftersalesworkbench.action.dc512b9581cf" icon={<ReloadOutlined />} aria-label="更新售後案件" loading={loading || detailLoading} disabled={creating} onClick={() => setRefresh(value => value + 1)}>更新</Button>
        {canCreate && !creating && <Button data-operation-action="erp.nativeaftersalesworkbench.action.bcb069c15ac5" type="primary" aria-label="新增案件" icon={<PlusOutlined />} onClick={() => void openCreate()}>新增案件</Button>}
      </div>
    </header>

    {journalError && <Alert type="error" showIcon message={journalError} style={{ marginBottom: 16 }} />}

    {creating ? <NativeAfterSalesCreate key={scopeKey} actorId={user?.id || ''} entityId={entityId} resumeAttempt={resumeAttempt} options={options} optionsError={optionsError} onPendingChange={markPending} onDirtyChange={markDirty} onChangeType={leaveForm} onCancel={() => void openCase()} onSaved={id => { setResumeAttempt(undefined); markPending(false); markDirty(false); setRefresh(value => value + 1); void openCase(id) }} onOpenSource={onOpenSource} /> : selectedId ? <>
      <Button data-operation-action="erp.nativeaftersalesworkbench.action.f9361d35dd0e" className="native-after-sales-back" aria-label="返回案件清單" icon={<ArrowLeftOutlined />} onClick={() => void openCase()}>返回案件清單</Button>
      {detailLoading && <div role="status"><Spin /> 載入案件…</div>}
      {detailError && <Alert showIcon type="error" message={detailError} action={<Button data-operation-action="erp.nativeaftersalesworkbench.action.4df72e0a5cc6" onClick={() => setRefresh(value => value + 1)}>重試</Button>} />}
      {detail && <NativeDetail detail={detail} entityId={entityId} options={options} onReload={() => setRefresh(value => value + 1)} onDirtyChange={markDirty} onPendingChange={markPending} onOpenSource={onOpenSource} onOpenTask={onOpenTask} canOpen={section => canOpenAfterSalesSection(user, section)} />}
    </> : <>
      <nav className="native-after-sales-tabs" aria-label="案件責任範圍">
        <button data-operation-action="erp.nativeaftersalesworkbench.action.c067c20e75a2" type="button" className="native-after-sales-tab" aria-pressed={filters.scope === 'mine'} onClick={() => filter('scope', 'mine')}>待我處理{list && <span className="native-after-sales-count">{list.summary.mine}</span>}</button>
        {options?.canReadAll && <button data-operation-action="erp.nativeaftersalesworkbench.action.2863b7bba66a" type="button" className="native-after-sales-tab" aria-pressed={filters.scope === 'all'} onClick={() => filter('scope', 'all')}>全部案件{list && <span className="native-after-sales-count">{list.summary.all}</span>}</button>}
      </nav>
      <div className="native-after-sales-filters">
        <div className="native-after-sales-filter native-after-sales-search"><label htmlFor="native-after-sales-search">搜尋案件</label><Input.Search id="native-after-sales-search" value={query} onChange={event => setQuery(event.target.value)} onSearch={value => filter('q', value.trim() || undefined)} allowClear maxLength={120} placeholder="案件、顧客、電話、產品或 SN" /></div>
        <div className="native-after-sales-filter"><label htmlFor="native-after-sales-type">案件類型</label><Select id="native-after-sales-type" aria-label="案件類型" value={filters.type || ''} onChange={value => filter('type', value || undefined)} options={[{ value: '', label: '全部類型' }, ...NATIVE_CASE_TYPES]} /></div>
        <div className="native-after-sales-filter"><label htmlFor="native-after-sales-stage">目前進度</label><Select id="native-after-sales-stage" aria-label="目前進度" value={filters.stage || ''} onChange={value => filter('stage', value || undefined)} options={[{ value: '', label: '全部進度' }, ...stageOptions]} /></div>
        <Button data-operation-action="erp.nativeaftersalesworkbench.action.cc713fd8f2b4" icon={<EllipsisOutlined />} aria-expanded={more} onClick={() => setMore(value => !value)}>更多篩選</Button>
      </div>
      {more && <div className="native-after-sales-advanced">
        <div className="native-after-sales-filter"><label htmlFor="native-after-sales-brand">品牌</label><Select id="native-after-sales-brand" aria-label="品牌" value={filters.brand || ''} onChange={value => filter('brand', value || undefined)} options={[{ value: '', label: '全部授權品牌' }, ...(options?.brands || []).map(brand => ({ value: brand.code, label: brand.name })), { value: 'UNKNOWN', label: '品牌待核對' }]} /></div>
        <div className="native-after-sales-filter"><label htmlFor="native-after-sales-view">案件清單</label><Select id="native-after-sales-view" aria-label="案件清單" value={filters.lifecycle} onChange={value => filter('view', value)} options={[{ value: 'active', label: '進行中' }, { value: 'closed', label: '已結束' }, { value: 'deleted', label: '刪除清單' }]} /></div>
      </div>}
      <div className="native-after-sales-shortcuts" aria-label="常用案件篩選">{stageOptions.filter(stage => stage.quick).map(stage => <Button data-operation-action="erp.nativeaftersalesworkbench.action.1c8913931472" key={stage.value} size="small" type={filters.stage === stage.value ? 'primary' : 'default'} aria-pressed={filters.stage === stage.value} onClick={() => filter('stage', filters.stage === stage.value ? undefined : stage.value)}>{stage.label}</Button>)}</div>
      <div className="native-after-sales-results"><span aria-live="polite">{lifecycleLabel}{list ? ` · ${list.page.totalCount} 件` : ''}</span>{changedFilters && <Button data-operation-action="erp.nativeaftersalesworkbench.action.8b1a85f8df20" type="link" size="small" onClick={clearFilters}>清除篩選</Button>}</div>
      {listError && <Alert type="error" showIcon message={listError} action={<Button data-operation-action="erp.nativeaftersalesworkbench.action.6c511b09078d" onClick={() => setRefresh(value => value + 1)}>重試</Button>} />}
      {optionsError && !listError && <Alert type="warning" showIcon message={optionsError} />}
      {list?.repairQueueHasMore && <Alert type="info" showIcon message="另有維修交辦待確認" action={<Button data-operation-action="erp.nativeaftersalesworkbench.action.832dedaad6f0" onClick={() => onOpenTask('repair', '')}>查看維修交辦</Button>} style={{ marginBottom: 12 }} />}
      <Spin spinning={loading}>
        {!listError && <div className="native-after-sales-list">
          {!!list?.items.length && <div className="native-after-sales-list-head" aria-hidden><span>案件／顧客／產品</span><span>目前進度／下一步</span><span>負責／更新</span><span>操作</span></div>}
          {list?.items.map(row => <NativeCaseListRow key={row.id} row={row} onOpen={() => void openCase(row.id)} />)}
          {!list?.items.length && !loading && <div className="native-after-sales-empty"><Empty description={changedFilters ? '沒有符合條件的案件' : filters.scope === 'mine' ? '目前沒有需要你處理的案件' : '目前沒有案件'} />{filters.scope === 'mine' && options?.canReadAll && <Button data-operation-action="erp.nativeaftersalesworkbench.action.59fe00ec5f90" onClick={() => filter('scope', 'all')}>查看全部案件</Button>}</div>}
        </div>}
      </Spin>
      {list && list.page.totalCount > filters.pageSize && <Pagination className="native-after-sales-pagination" current={filters.page} total={list.page.totalCount} pageSize={filters.pageSize} showSizeChanger={false} responsive onChange={page => filter('page', String(page))} />}
    </>}
  </section>
}

function NativeCaseListRow({ row, onOpen }: { row: NativeCaseRow; onOpen: () => void }) {
  const taskOwner = row.tasks.find(task => task.actionable && task.owner)?.owner?.name
  return <article className="native-after-sales-case-row" aria-label={`${row.caseNumber} ${row.contactName || ''}`}>
    <div className="native-after-sales-case-identity">
      <button data-operation-action="erp.nativeaftersalesworkbench.action.d8371d7464ae" type="button" className="native-after-sales-case-number" onClick={onOpen}>{row.caseNumber}</button>
      <div className="native-after-sales-case-main">{row.contactName || '未提供顧客'}{row.productSummary ? ` · ${row.productSummary}` : ''}</div>
      <div className="native-after-sales-case-secondary">{nativeCaseTypeLabel(row.type)} · {row.brandName || '品牌待核對'}{row.serialNumber ? ` · SN ${row.serialNumber}` : ''}</div>
    </div>
    <div className="native-after-sales-case-step"><Tag color={row.workflow.isLocked ? 'gold' : undefined}>{row.workflow.stageLabel || row.status}</Tag><div className="native-after-sales-case-main">{row.workflow.nextAction || '檢視案件進度'}</div>{row.tasks.map(task => <div key={task.itemId} className="native-after-sales-case-secondary">{task.kind === 'repair' ? '維修：' : '收發：'}{task.status ? STATUS[task.status] || task.status : '待核對'}{task.csr ? ` · ${CSR_STATUS[task.csr.status as keyof typeof CSR_STATUS] || task.csr.status}` : ''}</div>)}</div>
    <div className="native-after-sales-case-owner"><div className="native-after-sales-case-main"><span className="native-after-sales-mobile-label">負責：</span>{taskOwner || row.ownerName || row.workflow.ownerRoleLabel || '待指派'}</div><div className="native-after-sales-case-secondary"><span className="native-after-sales-mobile-label">更新：</span>{updatedDate(row.updatedAt)}</div></div>
    <Button data-operation-action="erp.nativeaftersalesworkbench.action.89c008b87ff3" onClick={onOpen}>{row.primaryActionLabel || '查看'}</Button>
  </article>
}

function NativeDetail({ detail, entityId, options, onReload, onDirtyChange, onPendingChange, onOpenSource, onOpenTask, canOpen }: { detail: NativeCaseDetail; entityId:string; options?:NativeOptions; onReload:()=>void; onDirtyChange:(value:boolean)=>void; onPendingChange:(value:boolean)=>void; onOpenSource: Props['onOpenSource']; onOpenTask: Props['onOpenTask']; canOpen: (section: string) => boolean }) {
  const nextTask = detail.tasks.find(task => task.actionable)
  return <>
    <header className="native-after-sales-detail-heading"><div><h3 className="native-after-sales-detail-number">{detail.caseNumber}</h3><div className="native-after-sales-case-secondary">{nativeCaseTypeLabel(detail.type)} · {detail.brandName || '品牌待核對'}</div></div><Tag>{detail.workflow.stageLabel || detail.status}</Tag></header>
    <div className="native-after-sales-detail-identity"><div className="native-after-sales-case-main">{detail.contactName || '未提供顧客'} · {detail.productSummary || '品項待核對'}</div><div className="native-after-sales-case-secondary">{[detail.contactPhone, detail.serialNumber ? `SN ${detail.serialNumber}` : null].filter(Boolean).join(' · ')}</div></div>
    <dl className="native-after-sales-facts"><div><dt>案件負責</dt><dd>{detail.ownerName || detail.workflow.ownerRoleLabel || '待指派'}</dd></div><div><dt>實物保管</dt><dd>{detail.custodySummary || '未提供保管資訊'}</dd></div><div><dt>款項狀態</dt><dd>{detail.paymentSummary || '尚無款項紀錄'}</dd></div></dl>
    <section className="native-after-sales-step" aria-labelledby="native-after-sales-step-title"><h4 id="native-after-sales-step-title" className="native-after-sales-step-title">{detail.workflow.nextAction || '案件進度'}</h4>
      {detail.currentStepFields.length > 0 && <Descriptions size="small" column={1} items={detail.currentStepFields.map(field => ({ key: field.key, label: field.label, children: afterSalesFieldValue(field.key, field.value) }))} />}
      {detail.blockers.map((blocker, index) => <Alert key={index} type="warning" showIcon message={blocker} style={{ marginTop: 12 }} />)}
      {detail.tasks.map(task => <div key={task.itemId} className="native-after-sales-case-secondary">{task.label} · {task.status ? STATUS[task.status] || task.status : '待核對'}{task.csr ? ` · ${CSR_STATUS[task.csr.status as keyof typeof CSR_STATUS] || task.csr.status}` : ''}{task.owner ? ` · 交辦負責：${task.owner.name}` : ''}</div>)}
      <div className="native-after-sales-detail-actions">{nextTask ? <Button data-operation-action="erp.nativeaftersalesworkbench.action.de0b0a2c269b" type="primary" onClick={() => onOpenTask(nextTask.kind, nextTask.itemId)}>{nextTask.kind === 'repair' ? '處理維修交辦' : '處理收發交辦'}</Button> : detail.sourceSection && <Button data-operation-action="erp.nativeaftersalesworkbench.action.5cb31d7fb5d6" type="primary" onClick={() => onOpenSource(detail.sourceSection!, detail.id)}>{detail.primaryActionLabel || '處理此節點'}</Button>}{detail.tasks.filter(task => task !== nextTask).map(task => <Button data-operation-action="erp.nativeaftersalesworkbench.action.d2281c69754f" key={`${task.kind}:${task.itemId}`} onClick={() => onOpenTask(task.kind, task.itemId)}>{task.kind === 'repair' ? '檢視維修交辦' : '檢視收發交辦'}{detail.tasks.length > 1 ? ` · ${task.label}` : ''}</Button>)}</div>
    </section>
    <NativeCaseCommunication key={JSON.stringify([entityId, detail.id])} entityId={entityId} detail={detail} options={options} onReload={onReload} onDirtyChange={onDirtyChange} onPendingChange={onPendingChange} />
    <nav className="native-after-sales-detail-links" aria-label="案件相關作業">{detail.sourceSection && canOpen(detail.sourceSection) && <Button data-operation-action="erp.nativeaftersalesworkbench.action.c6dd1ba7a928" type="link" onClick={() => onOpenSource(detail.sourceSection!, detail.id)}>完整案件作業</Button>}{[['quotes', '報價與顧客確認'], ['customers', '顧客資料與 LINE'], ['invoices', '發票作業'], ['accounting', '收款與退款核對']].filter(([section]) => canOpen(section)).map(([section, label]) => <Button data-operation-action="erp.nativeaftersalesworkbench.action.b2a6a0c84289" key={section} type="link" onClick={() => onOpenSource(section)}>{label}</Button>)}</nav>
    {detail.sections.length > 0 && <Collapse className="native-after-sales-history" ghost items={detail.sections.map(section => ({ key: section.key, label: section.title, children: section.records.map(record => <Descriptions key={record.key} size="small" column={1} items={record.fields.map(field => ({ key: field.key, label: field.label, children: afterSalesFieldValue(field.key, field.value) }))} />) }))} />}
  </>
}
