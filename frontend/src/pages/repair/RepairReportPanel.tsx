import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Collapse, Form, Input, Popconfirm, Select, Space, Tag, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { useAuth } from '../../contexts/AuthContext'
import { hasPermission } from '../../utils/access'
import { errorText } from '../mailroom/model'
import { repairEvidenceClient } from './repair-evidence-client'
import type { RepairReportSummary } from './repair-evidence-client'
import { inspectionReviewCurrent, sourceInvoiceCurrent, sourceQuoteConsentCurrent } from './repair-model'
import type { RepairItem } from './repair-model'

const problem = (error: unknown) => {
  const message=(error as {response?:{data?:{message?:unknown}}}|null)?.response?.data?.message
  return typeof message==='string' || Array.isArray(message) ? errorText(error) : error instanceof Error ? error.message : errorText(error ?? {})
}
const time = (value: string) => new Date(value).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
function currentFormalBinding(item: RepairItem) {
  const inspection = item.repairInspection, binding = item.repairProposalBinding, info = item.release?.releaseInfo
  if (!inspection || !binding || !info || !Number.isInteger(inspection.revision) || inspection.revision < 1 || binding.itemId !== item.id || binding.planVersion !== inspection.revision || !/^[a-f0-9]{64}$/.test(binding.planHash) || !/^[a-f0-9]{64}$/.test(binding.proposalHash) || !Number.isInteger(info.quoteRevision) || info.quoteRevision < 1 || !Array.isArray(info.quoteBindings)) return false
  const rows = info.quoteBindings.filter(row => row?.itemId === item.id)
  return rows.length === 1 && rows[0].planVersion === binding.planVersion && rows[0].planHash === binding.planHash && rows[0].proposalHash === binding.proposalHash && rows[0].quoteRevision === info.quoteRevision
}
function currentCustomerIdentity(item: RepairItem) {
  const source = item.release, identity = source?.releaseInfo?.customerIdentity
  return item.receipt.category === 'REPAIR' && source?.available === true && source.sourceCaseId === item.receipt.sourceCaseId && typeof source.sourceCaseId === 'string' && !!source.sourceCaseId.trim() && ['MOZTECH', 'BONSON', 'WANBO'].includes(source.caseBrand || '') && !!identity && identity.verified === true && identity.caseId === source.sourceCaseId && identity.brand === source.caseBrand && typeof identity.companyId === 'string' && !!identity.companyId.trim() && typeof identity.verifiedCustomerId === 'string' && /^[a-f0-9]{64}$/.test(identity.verifiedCustomerId)
}
export default function RepairReportPanel({ form, item, entityId, kind,mediaPending=false }: { form: FormInstance; item: RepairItem; entityId: string; kind: 'inspection' | 'repair';mediaPending?:boolean }) {
  const { user } = useAuth()
  const canReview = hasPermission(user, 'mailroom:review')
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<RepairReportSummary[]>([])
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [shareLink, setShareLink] = useState('')
  const operation = useRef<{ key: string; requestId: string }|undefined>(undefined)
  const running = useRef(false), alive = useRef(true)
  const currentDraft = Form.useWatch('customerReportDraft', {form,preserve:true})
  const currentRefs = Form.useWatch('mediaRefs', {form,preserve:true})
  const document = kind === 'inspection' ? item.repairInspection : item.repairReport
  const csr = item.repairWorkflow?.csr
  const isOwner = !!user?.id && csr?.ownerId === user.id
  const savedDraft = document?.data.customerReportDraft
  const hasDraft = !!savedDraft && [savedDraft.findings, savedDraft.handling, savedDraft.verification].every(value => typeof value === 'string' && !!value.trim())
  const changed = JSON.stringify(currentDraft || form.getFieldValue('customerReportDraft')) !== JSON.stringify(savedDraft) || JSON.stringify(currentRefs || form.getFieldValue('mediaRefs') || []) !== JSON.stringify(document?.data.mediaRefs || [])
  const inspection = item.repairInspection, info = item.release?.releaseInfo
  const currentCsr = inspection?.status === 'SUBMITTED' && !!csr && ['ACCEPTED', 'RESOLVED'].includes(csr.status) && csr.inspectionRevision === inspection.revision && csr.estimateRevision === inspection.revision && csr.planHash === item.repairProposalBinding?.planHash && currentFormalBinding(item)
  const repairApproved = currentCsr && inspectionReviewCurrent(inspection) && inspection?.review?.decision === 'APPROVE' && csr?.status === 'RESOLVED' && csr.decision === 'APPROVE' && csr.planHash === inspection.review.planHash && csr.quoteRevision === inspection.review.quoteRevision && csr.quoteRevision === info?.quoteRevision
  const repairFinance = item.release?.repairAllowed === true && sourceQuoteConsentCurrent(info) && typeof info.amount === 'number' && Number.isFinite(info.amount) && info.amount >= 0 && (info.amount === 0 || info.confirmedPaymentQuoteRevision === info.quoteRevision) && sourceInvoiceCurrent(info)
  const report=item.repairReport, release=item.repairWorkflow?.release
  const expected=report?.data.outcome==='REPLACED'?'REPLACED':report?.data.outcome==='FACTORY_REPAIRED'?'FACTORY_REPAIRED':'REPAIRED'
  const actualCompleted=kind==='inspection' || !!report && report.inspectionRevision === inspection?.revision && report.data.qcResult==='PASS' && report.data.checks.length > 0 && report.data.checks.every(check=>check.result==='PASS') && release?.purpose===expected && release.inspectionRevision===inspection?.revision && !!release.releasedAt && !!report.submittedAt && Number.isFinite(Date.parse(release.releasedAt)) && Number.isFinite(Date.parse(report.submittedAt)) && Date.parse(release.releasedAt)>=Date.parse(report.submittedAt) && (expected!=='REPLACED' || !!release.stock?.postingId)
  const sourceActive = typeof item.release?.sourceStatus === 'string' && !!item.release.sourceStatus && !['CANCELLED', 'CLOSED', 'COMPLETED'].includes(item.release.sourceStatus)
  const ready = isOwner && currentCsr && document?.status === 'SUBMITTED' && hasDraft && !changed && !mediaPending && currentCustomerIdentity(item) && sourceActive && actualCompleted && (kind === 'inspection' || repairApproved && repairFinance)
  const blocker = !isOwner ? '請由本案承辦客服發布' : document?.status !== 'SUBMITTED' ? '請先提交目前工作單' : !hasDraft ? '請先保存報告摘要' : mediaPending ? '影像尚未上傳' : changed ? '報告內容有未保存修改' : !currentCustomerIdentity(item) ? '顧客身分尚未確認' : !sourceActive ? '來源案件無法發布' : !currentCsr ? '目前檢修報價尚未確認' : kind === 'repair' && !repairApproved ? '目前維修方案尚未同意' : kind === 'repair' && !repairFinance ? '目前付款與發票尚未確認' : !actualCompleted ? '目前維修與複驗尚未完成' : ''
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [entityId, item.id, item.version])
  useEffect(() => {
    if (!canReview || !open) return
    let active = true
    void repairEvidenceClient.listReports(item.id, entityId).then(value => { if (active) setRecords(value) }).catch(error => { if (active) setFailure(problem(error)) })
    return () => { active = false }
  }, [canReview, open, item.id, entityId, item.version])
  async function publish() {
    if (!canReview || !ready || running.current) return
    running.current = true; setBusy(true); setFailure('')
    let saved = false
    try {
      const key = JSON.stringify({ entityId, itemId: item.id, expectedVersion: item.version, kind, expiresInDays: days })
      if (operation.current?.key !== key) operation.current = { key, requestId: crypto.randomUUID() }
      const publication = await repairEvidenceClient.publishReport(item.id, { entityId, expectedVersion: item.version, requestId: operation.current.requestId, kind, expiresInDays: days })
      saved = true; operation.current=undefined; if (!alive.current) return; setShareLink(publication.shareLink)
      const values = await repairEvidenceClient.listReports(item.id, entityId); if (alive.current) setRecords(values)
    } catch (error) { if (alive.current) setFailure(saved ? '報告已發布，清單暫無法更新' : problem(error)) }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }
  async function revoke(report: RepairReportSummary) {
    if (!canReview || running.current) return
    running.current = true; setBusy(true); setFailure('')
    try { await repairEvidenceClient.revokeReport(item.id, report.reportId, { entityId, expectedVersion: item.version, requestId: crypto.randomUUID() }); if (!alive.current) return; setRecords(values => values.map(value => value.reportId === report.reportId ? { ...value, status: 'REVOKED' } : value)); if (shareLink.includes(`/repair-report/${encodeURIComponent(report.reportId)}#`)) setShareLink('') }
    catch (error) { if (alive.current) setFailure(problem(error)) }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }
  async function copyLink() {
    if (!navigator.clipboard?.writeText) { setFailure('此裝置無法複製連結'); return }
    try { await navigator.clipboard.writeText(shareLink) } catch { setFailure('無法複製連結') }
  }
  if (!canReview) return null
  return <Collapse ghost activeKey={open ? ['publication'] : []} onChange={keys => { if (!busy) setOpen(keys.includes('publication')) }} items={[{ key: 'publication', label: '報告發布', children: <>
    <Space wrap style={{ marginBottom: 12 }}><Select aria-label="報告有效天數" value={days} disabled={busy} options={Array.from({ length: 30 }, (_, index) => ({ value: index + 1, label: `${index + 1} 天` }))} onChange={value => { setDays(value); operation.current = undefined }} /><Button disabled={!ready || busy} loading={busy} aria-label="發布已保存報告" onClick={() => void publish()}>發布已保存報告</Button></Space>
    {blocker && <Typography.Paragraph type="secondary">{blocker}</Typography.Paragraph>}
    {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />}
    {shareLink && <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}><Input value={shareLink} readOnly aria-label="已發布報告連結" /><Space wrap><Typography.Link href={shareLink} target="_blank" rel="noopener noreferrer">開啟已發布報告</Typography.Link><Button disabled={busy} onClick={() => void copyLink()}>複製連結</Button></Space></Space>}
    <Space direction="vertical" style={{ width: '100%' }}>{records.map(report => <Space key={report.reportId} wrap><Tag>{report.status === 'PUBLISHED' ? Date.parse(report.expiresAt) <= Date.now() ? '已逾期' : '已發布' : '已撤回'}</Tag><Typography.Text>檢修 v{report.inspectionRevision}{report.reportRevision ? ` · 維修 v${report.reportRevision}` : ''} · {time(report.publishedAt)} · 有效至 {time(report.expiresAt)}</Typography.Text>{report.status === 'PUBLISHED' && <Popconfirm title="撤回此報告？" okText="撤回" cancelText="取消" onConfirm={() => void revoke(report)}><Button size="small" danger disabled={busy}>撤回報告</Button></Popconfirm>}</Space>)}</Space>
    {!records.length && !failure && <Typography.Text type="secondary">尚無發布紀錄</Typography.Text>}
  </> }]} />
}
