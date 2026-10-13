import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Space, Spin, Typography } from 'antd'
import { useLocation, useParams } from 'react-router-dom'
import { repairEvidenceClient } from './repair-evidence-client'
import type { RepairPublicReport } from './repair-evidence-client'

function PublicReportMedia({ reportId, media, fragment }: { reportId: string; media: RepairPublicReport['media'][number]; fragment: string }) {
  const [url, setUrl] = useState(''), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false)
  const alive = useRef(true), current = useRef(''), abort = useRef<AbortController|undefined>(undefined)
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); if (current.current) URL.revokeObjectURL(current.current) } }, [])
  async function view() {
    if (busy) return
    setBusy(true); setFailure(''); abort.current = new AbortController()
    try { const file = await repairEvidenceClient.loadPublicMediaFromFragment(reportId, media.mediaId, fragment, abort.current.signal); if (!alive.current) return; if (current.current) URL.revokeObjectURL(current.current); current.current = URL.createObjectURL(file); setUrl(current.current) }
    catch (error) { if (alive.current && !abort.current.signal.aborted) setFailure(error instanceof Error ? error.message : '報告影像無法讀取') }
    finally { if (alive.current) setBusy(false) }
  }
  return <>
    <Button onClick={() => void view()} loading={busy} aria-label={media.contentType.startsWith('video/') ? '檢視錄影' : '檢視照片'}>{media.contentType.startsWith('video/') ? '檢視錄影' : '檢視照片'}</Button>
    {failure && <Alert type="error" message={failure} />}
    <Modal open={!!url} title="報告影像" footer={null} onCancel={() => { URL.revokeObjectURL(current.current); current.current = ''; setUrl('') }}>
      {url && (media.contentType.startsWith('video/') ? <video src={url} controls playsInline style={{ width: '100%' }} /> : <img src={url} alt="顧客報告照片" style={{ maxWidth: '100%' }} />)}
    </Modal>
  </>
}
export default function RepairPublicReportPage() {
  const { id } = useParams<{ id: string }>()
  const fragment = useLocation().hash
  const scope=`${id || ''}:${fragment}`
  const [result,setResult]=useState<{scope:string;report?:RepairPublicReport;failure?:string}>()
  useEffect(() => {
    const abort = new AbortController()
    if (!id) return
    void repairEvidenceClient.readPublicReportFromFragment(id, fragment, abort.signal).then(report => { if (!abort.signal.aborted) setResult({scope,report}) }).catch(error => { if (!abort.signal.aborted) setResult({scope,failure:error instanceof Error ? error.message : '報告無法讀取'}) })
    return () => abort.abort()
  }, [id, fragment,scope])
  const report=result?.scope===scope?result.report:undefined
  const failure=result?.scope===scope?result.failure:undefined
  return <main style={{ maxWidth: 720, margin: '0 auto', padding: 20 }}>
    {!id ? <Alert type="error" message="報告連結無效" /> : result?.scope!==scope ? <Spin /> : failure ? <Alert type="error" message={failure} /> : report && <>
      <Typography.Title level={2} style={{overflowWrap:'anywhere'}}>{report.productName}</Typography.Title><Typography.Paragraph type="secondary" style={{overflowWrap:'anywhere'}}>{report.caseNumber}</Typography.Paragraph>
      {[['發現的問題', report.findings], ['處置說明', report.handling], ['複驗結果', report.verification]].map(([title, value]) => <section key={title}><Typography.Title level={4}>{title}</Typography.Title><Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</Typography.Paragraph></section>)}
      <Space wrap>{report.media.map(media => <PublicReportMedia key={`${report.reportId}:${media.mediaId}`} reportId={report.reportId} media={media} fragment={fragment} />)}</Space>
    </>}
  </main>
}
