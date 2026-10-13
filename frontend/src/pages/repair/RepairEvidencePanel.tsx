import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Modal, Popconfirm, Select, Space, Tag, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { errorText } from '../mailroom/model'
import { repairEvidenceClient } from './repair-evidence-client'
import type { RepairMediaAsset, RepairMediaPhase } from './repair-evidence-client'
import type { RepairDocumentMediaRef, RepairItem } from './repair-model'

const phases = { BEFORE: '修前', AFTER: '修後', DIAGNOSTIC: '檢測' }
const mediaName = (asset: RepairMediaAsset) => `${phases[asset.phase]} · ${asset.contentType.startsWith('video/') ? '錄影' : '照片'} · v${asset.documentRevision}`
const problem = (error: unknown) => {
  const message=(error as {response?:{data?:{message?:unknown}}}|null)?.response?.data?.message
  return typeof message==='string' || Array.isArray(message) ? errorText(error) : error instanceof Error ? error.message : errorText(error ?? {})
}

export default function RepairEvidencePanel({ form, item, entityId, kind, editable, active=true, onDirtyChange,onPendingChange }: { form: FormInstance; item: RepairItem; entityId: string; kind: 'inspection' | 'repair'; editable: boolean;active?:boolean;onDirtyChange?:()=>void;onPendingChange?:(pending:boolean)=>void }) {
  const refs = Form.useWatch('mediaRefs', {form,preserve:true}) as RepairDocumentMediaRef[] | undefined
  const checks = Form.useWatch('checks', form) as { key?: string; name: string }[] | undefined
  const [assets, setAssets] = useState<RepairMediaAsset[]>([])
  const [phase, setPhase] = useState<RepairMediaPhase>(kind === 'inspection' ? 'DIAGNOSTIC' : 'AFTER')
  const [checkKey, setCheckKey] = useState<string>()
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [cameraPending,setCameraPending]=useState(false)
  const [failure, setFailure] = useState('')
  const [preview, setPreview] = useState<{ url: string; type: string }>()
  const live = useRef<HTMLVideoElement>(null)
  const fileInput=useRef<HTMLInputElement>(null)
  const stream = useRef<MediaStream|undefined>(undefined)
  const recorder = useRef<MediaRecorder|undefined>(undefined)
  const abort = useRef<AbortController|undefined>(undefined)
  const urls = useRef(new Set<string>())
  const alive = useRef(true)
  const running = useRef(false)
  const captureAllowed=useRef(active && editable)
  const uploadOperation = useRef<{ key: string; file: File; requestId: string }|undefined>(undefined)
  const nextRevision = (kind === 'inspection' ? item.repairInspection?.revision : item.repairReport?.revision || 0) || 0
  const command = () => ({ entityId, expectedVersion: item.version, requestId: crypto.randomUUID() })
  const stopTracks = useCallback(() => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined; if (live.current) live.current.srcObject = null },[])
  useEffect(()=>{captureAllowed.current=active && editable;if(!captureAllowed.current){if(recorder.current?.state==='recording')recorder.current.stop();stopTracks()}},[active,editable,stopTracks])
  useEffect(()=>{onPendingChange?.(!!file || recording || cameraPending)},[file,recording,cameraPending,onPendingChange])
  useEffect(() => {
    alive.current = true
    void repairEvidenceClient.listMedia(item.id, entityId).then(value => { if (alive.current) setAssets(value) }).catch(error => { if (alive.current) setFailure(problem(error)) })
    const ownedUrls=urls.current
    return () => { alive.current = false; abort.current?.abort(); if (recorder.current?.state === 'recording') recorder.current.stop(); stopTracks(); ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear() }
  }, [entityId, item.id, item.version, stopTracks])
  const writeRefs = (value: RepairDocumentMediaRef[]) => {
    form.setFieldValue('mediaRefs', value)
    const draftIds=form.getFieldValue(['customerReportDraft','mediaIds'])
    if(Array.isArray(draftIds))form.setFieldValue(['customerReportDraft','mediaIds'],draftIds.filter(id=>value.some(ref=>ref.mediaId===id)))
    onDirtyChange?.()
  }
  const attach = (ref: RepairDocumentMediaRef) => {
    const current: RepairDocumentMediaRef[] = form.getFieldValue('mediaRefs') || []
    if (!current.some(value => value.mediaId === ref.mediaId) && current.length < 12) writeRefs([...current, ref])
  }
  async function upload() {
    if (!file || !editable || running.current || recording || (refs?.length || 0) >= 12) return
    running.current = true; setBusy(true); setFailure(''); abort.current = new AbortController()
    try {
      const key = JSON.stringify({ entityId, itemId: item.id, version: item.version, kind, phase, checkKey })
      if (uploadOperation.current?.key !== key || uploadOperation.current.file !== file) uploadOperation.current = { key, file, requestId: crypto.randomUUID() }
      const result = await repairEvidenceClient.uploadMedia(item.id, { ...command(), requestId: uploadOperation.current.requestId, kind, phase, ...(checkKey ? { checkKey } : {}) }, file, { signal: abort.current.signal, expectedDocumentRevision: nextRevision + 1 })
      if (!alive.current) return
      attach(result.mediaRef); setAssets(values => [result.asset, ...values.filter(value => value.mediaId !== result.asset.mediaId)]); setFile(undefined); if(fileInput.current)fileInput.current.value='';uploadOperation.current = undefined
    } catch (error) { if (alive.current && !abort.current?.signal.aborted) setFailure(problem(error)) }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }
  async function startRecording() {
    if (!editable || !captureAllowed.current || busy || recording) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setFailure('此裝置無法錄影'); return }
    setBusy(true); setCameraPending(true);setFailure('')
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true })
      if (!alive.current || !captureAllowed.current) { camera.getTracks().forEach(track => track.stop()); return }
      stream.current = camera
      const type = ['video/webm', 'video/mp4'].find(value => MediaRecorder.isTypeSupported(value))
      if (!type) throw new Error('此裝置不支援錄影格式')
      const value = new MediaRecorder(camera, { mimeType: type }), chunks: Blob[] = []; let failed = false
      recorder.current = value
      value.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      value.onerror = () => { failed = true; if (alive.current) setFailure('錄影失敗'); if (value.state === 'recording') value.stop(); stopTracks() }
      value.onstop = () => { stopTracks(); if (alive.current) { setRecording(false); if (!failed && chunks.length) {setFile(new File(chunks, `錄影-${Date.now()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type }));if(fileInput.current)fileInput.current.value='';onDirtyChange?.()} } }
      value.start(); setRecording(true)
      if (live.current) { live.current.srcObject = camera; void live.current.play().catch(() => undefined) }
    } catch (error) { stopTracks(); if (alive.current) setFailure(error instanceof DOMException && error.name === 'NotAllowedError' ? '相機或麥克風未授權' : error instanceof Error && error.message === '此裝置不支援錄影格式' ? error.message : '無法開啟相機或麥克風') }
    finally { if (alive.current) {setBusy(false);setCameraPending(false)} }
  }
  async function view(asset: RepairMediaAsset) {
    setFailure('')
    try { const blob = await repairEvidenceClient.getMediaFile(item.id, asset.mediaId, entityId); if (!alive.current) return; const url = URL.createObjectURL(blob); urls.current.add(url); setPreview({ url, type: asset.contentType }) }
    catch (error) { if (alive.current) setFailure(problem(error)) }
  }
  async function revoke(asset: RepairMediaAsset) {
    if (!editable || running.current) return
    running.current = true; setBusy(true); setFailure('')
    try { await repairEvidenceClient.revokeMedia(item.id, asset.mediaId, command()); if (!alive.current) return; setAssets(values => values.map(value => value.mediaId === asset.mediaId ? { ...value, status: 'REVOKED' } : value)); writeRefs((form.getFieldValue('mediaRefs') || []).filter((value: RepairDocumentMediaRef) => value.mediaId !== asset.mediaId)) }
    catch (error) { if (alive.current) setFailure(problem(error)) }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }
  return <>
    {editable && <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
      <Space wrap><Select aria-label="影像階段" value={phase} disabled={busy || recording} options={Object.entries(phases).map(([value, label]) => ({ value, label }))} onChange={setPhase} />
        {!!checks?.some(value => value.key) && <Select aria-label="影像測項" allowClear placeholder="選擇測項" value={checkKey} disabled={busy || recording} options={checks.filter(value => value.key).map(value => ({ value: value.key, label: value.name }))} onChange={setCheckKey} />}</Space>
      <input ref={fileInput} type="file" aria-label="選擇照片或錄影" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" style={{maxWidth:'100%'}} disabled={busy || recording} onChange={event => { setFile(event.target.files?.[0]); uploadOperation.current = undefined; setFailure('');onDirtyChange?.() }} />
      <Space wrap><Button disabled={busy} onClick={() => recording ? recorder.current?.stop() : void startRecording()}>{recording ? '停止錄影' : '開始錄影'}</Button><Button disabled={!file || busy || recording || (refs?.length || 0) >= 12} loading={busy && !!file} aria-label="上傳影像" onClick={() => void upload()}>上傳影像</Button>{file && <><Typography.Text>{file.name}</Typography.Text><Button disabled={busy || recording} onClick={()=>{setFile(undefined);uploadOperation.current=undefined;if(fileInput.current)fileInput.current.value=''}}>移除待上傳影像</Button></>}</Space>
      <video ref={live} muted playsInline hidden={!recording} style={{ width: '100%', maxHeight: 300 }} />
    </Space>}
    {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />}
    <Space direction="vertical" style={{ width: '100%' }}>{assets.filter(asset => asset.kind === kind).map(asset => {
      const selected = refs?.some(value => value.mediaId === asset.mediaId)
      return <Space key={asset.mediaId} wrap><Typography.Text>{mediaName(asset)}</Typography.Text><Tag>{asset.status === 'FINALIZED' ? selected ? '已選用' : '已存證' : asset.status === 'PENDING' ? '待上傳' : '已撤回'}</Tag>
        {asset.status === 'FINALIZED' && <Button size="small" disabled={busy} onClick={() => void view(asset)}>檢視</Button>}
        {editable && asset.status === 'FINALIZED' && <Button size="small" disabled={busy || !selected && (refs?.length || 0) >= 12} onClick={() => {if(selected)writeRefs((refs || []).filter(value => value.mediaId !== asset.mediaId));else attach({ mediaId: asset.mediaId, phase: asset.phase, ...(asset.checkKey ? { checkKey: asset.checkKey } : {}) })}}>{selected ? '移除引用' : '選用'}</Button>}
        {editable && asset.status !== 'REVOKED' && <Popconfirm title="撤回此影像？" okText="撤回" cancelText="取消" onConfirm={() => void revoke(asset)}><Button size="small" danger disabled={busy}>撤回影像</Button></Popconfirm>}
      </Space>
    })}</Space>
    {!assets.length && !failure && <Typography.Text type="secondary">未附影像</Typography.Text>}
    <Modal title="工作單影像" open={!!preview} footer={null} onCancel={() => { if (preview) { URL.revokeObjectURL(preview.url); urls.current.delete(preview.url) } setPreview(undefined) }}>
      {preview && (preview.type.startsWith('video/') ? <video src={preview.url} controls playsInline style={{ width: '100%' }} /> : <img src={preview.url} alt="工作單影像" style={{ maxWidth: '100%' }} />)}
    </Modal>
  </>
}
