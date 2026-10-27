import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Divider, Input, Modal, Select, Space, Typography } from 'antd'
import { CopyOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import api, { API_URL } from '../../services/api'
import { getSelectedPrinter, printerDevices, printerErrorText, setSelectedPrinter } from '../../services/mailroom-print'
import type { PrinterDevice } from '../../services/mailroom-print'
import { MailroomPrintBlockedError } from './mailroom-label'

type PairCode = { deviceId: string; pairCode: string; expiresAt: string }
export default function MailroomPrinterSettings({ entityId, userId, disabled }: {
  entityId: string; userId: string; disabled?: boolean;
}) {
  const scope = useMemo(() => ({ apiUrl: API_URL, entityId, userId }), [entityId, userId])
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false)
  const [devices, setDevices] = useState<PrinterDevice[]>([]), [selected, setSelected] = useState<string>(), [name, setName] = useState('收發室標籤機')
  const [pair, setPair] = useState<PairCode>(), [failure, setFailure] = useState(''), [copied, setCopied] = useState(false)
  const request = useRef<AbortController | null>(null), generation = useRef(0), working = useRef(false)
  useEffect(() => {
    generation.current++; request.current?.abort(); working.current = false
    setOpen(false); setBusy(false); setReady(false); setDevices([]); setSelected(undefined); setName('收發室標籤機'); setPair(undefined); setFailure(''); setCopied(false)
    return () => { request.current?.abort(); working.current = false }
  }, [scope, disabled])
  useEffect(() => {
    if (!pair) return
    const timer = setTimeout(() => { setPair(undefined); setCopied(false); setFailure('配對碼已到期，請重新建立') }, Math.min(300000, Math.max(0, Date.parse(pair.expiresAt) - Date.now())))
    return () => clearTimeout(timer)
  }, [pair])
  const unavailable = !!disabled || !entityId || !userId
  function begin() {
    if (unavailable || working.current) return null
    working.current = true; setBusy(true); setFailure('')
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    return { controller, current: ++generation.current }
  }
  function active(operation: NonNullable<ReturnType<typeof begin>>) { return operation.current === generation.current && !operation.controller.signal.aborted }
  function finish(operation: NonNullable<ReturnType<typeof begin>>) { if (active(operation)) { working.current = false; setBusy(false) } }
  async function load() {
    const operation = begin(); if (!operation) return
    try {
      const response = await api.get<unknown>('/mailroom/print-devices', { params: { entityId }, signal: operation.controller.signal })
      if (!active(operation)) return
      const values = printerDevices(response.data)
      setDevices(values); setSelected(getSelectedPrinter(scope, localStorage) || undefined); setReady(true)
    } catch (error) { if (active(operation)) { setReady(false); setFailure(error instanceof MailroomPrintBlockedError ? error.message : printerErrorText(error)) } }
    finally { finish(operation) }
  }
  async function createPair() {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 40 || [...trimmed].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) { setFailure('請填寫 40 字以內的印表機名稱'); return }
    if (!ready) return
    const operation = begin(); if (!operation) return
    setPair(undefined); setCopied(false)
    try {
      const response = await api.post<PairCode>('/mailroom/print-devices/pair', { entityId, name: trimmed }, { signal: operation.controller.signal })
      if (!active(operation)) return
      const value = response.data
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value?.deviceId) || !/^[A-Za-z0-9_-]{43}$/.test(value?.pairCode) || !Number.isFinite(Date.parse(value?.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new MailroomPrintBlockedError('配對資料不完整，請重新建立')
      setPair({ deviceId: value.deviceId, pairCode: value.pairCode, expiresAt: value.expiresAt })
    } catch (error) { if (active(operation)) setFailure(error instanceof MailroomPrintBlockedError ? error.message : printerErrorText(error)) }
    finally { finish(operation) }
  }
  async function revoke() {
    const device = devices.find(value => value.id === selected)
    if (!ready || !device?.owned) return
    const operation = begin(); if (!operation) return
    try {
      const response = await api.post<{ id: string; revoked: boolean }>('/mailroom/print-devices/' + device.id + '/revoke', { entityId }, { signal: operation.controller.signal })
      if (!active(operation)) return
      if (response.data.id !== device.id || response.data.revoked !== true) throw new MailroomPrintBlockedError('撤銷結果尚未確認，請重新載入')
      setSelectedPrinter(scope, null, localStorage); setSelected(undefined); setDevices(values => values.filter(value => value.id !== device.id))
    } catch (error) { if (active(operation)) setFailure(error instanceof MailroomPrintBlockedError ? error.message : printerErrorText(error)) }
    finally { finish(operation) }
  }
  function choose(value: string) {
    if (unavailable || busy || !devices.some(device => device.id === value)) return
    try { setSelectedPrinter(scope, value, localStorage); setSelected(value); setFailure('') }
    catch (error) { setFailure(error instanceof Error ? error.message : '無法保存印表機設定') }
  }
  function close() {
    generation.current++; request.current?.abort(); working.current = false
    setOpen(false); setBusy(false); setPair(undefined); setCopied(false); setFailure('')
  }
  async function copy() {
    if (!pair || Date.parse(pair.expiresAt) <= Date.now()) return
    try { await navigator.clipboard.writeText(pair.pairCode); setCopied(true) }
    catch { setFailure('無法複製配對碼，請手動選取') }
  }
  const selectedDevice = devices.find(value => value.id === selected)
  return <>
    <Button icon={<PrinterOutlined aria-hidden />} disabled={unavailable} onClick={() => { setOpen(true); setPair(undefined); setCopied(false); void load() }}>印表機</Button>
    {open && <Modal title="標籤印表機" open onCancel={close} width={520} footer={<Button onClick={close}>關閉</Button>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space.Compact style={{ width: '100%' }}><Select aria-label="標籤印表機" placeholder="選擇標籤印表機" disabled={unavailable || busy || !ready} value={selectedDevice?.id} style={{ flex: 1 }} options={devices.map(device => ({ value: device.id, label: device.name + ' · ' + (device.online ? '連線中' : '離線') }))} onChange={choose} /><Button icon={<ReloadOutlined aria-hidden />} aria-label="重新載入印表機" disabled={unavailable || busy} onClick={() => void load()} /></Space.Compact>
        {selectedDevice?.owned && <Button danger disabled={unavailable || busy} onClick={() => void revoke()}>撤銷此配對</Button>}
        <Divider style={{ margin: 0 }} />
        <label htmlFor="mailroom-printer-name">印表機名稱</label>
        <Input id="mailroom-printer-name" value={name} maxLength={40} disabled={unavailable || busy} onChange={event => setName(event.target.value)} />
        <Button disabled={unavailable || busy || !ready} loading={busy} onClick={() => void createPair()}>新增配對</Button>
        {pair && <div aria-label="一次性配對碼"><Typography.Paragraph>請在標籤機所在電腦輸入裝置代碼與配對碼。</Typography.Paragraph><Typography.Text type="secondary">裝置代碼</Typography.Text><Typography.Paragraph code style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{pair.deviceId}</Typography.Paragraph><Typography.Text type="secondary">配對碼</Typography.Text><Typography.Paragraph code style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{pair.pairCode}</Typography.Paragraph><Space wrap><Button icon={<CopyOutlined aria-hidden />} onClick={() => void copy()}>{copied ? '已複製' : '複製配對碼'}</Button><Typography.Text type="secondary">有效至 {new Date(pair.expiresAt).toLocaleTimeString('zh-TW', { hour12: false })}</Typography.Text></Space></div>}
        {failure && <Alert type="error" message={failure} showIcon />}
      </Space>
    </Modal>}
  </>
}
