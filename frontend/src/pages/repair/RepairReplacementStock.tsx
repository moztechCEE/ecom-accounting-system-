import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Select, Space, Tag, Tooltip } from 'antd'
import { repairStockService } from '../../services/repair-stock'
import type { ReplacementUnit } from '../../services/repair-stock'
import type { RepairItem } from './repair-model'
import { useRepairFeedback } from './repair-feedback'
import type { RepairMessage } from './repair-feedback'
import { errorText } from '../mailroom/model'
export type ReplacementSelection = { reservationId: string; unitLabel: string; sku: string; condition: 'NEW' | 'REFURBISHED'; serialNumber?: string; hasSerialNumbers?: boolean; version: number }
export default function RepairReplacementStock({ item, onSelected, onReleased, feedback }: {
  item: RepairItem & { entityId: string }; onSelected: (value: ReplacementSelection) => void; onReleased?: (reservationId: string) => void; feedback?: RepairMessage
}) {
  const { message, contextHolder } = useRepairFeedback(feedback)
  const [units, setUnits] = useState<ReplacementUnit[]>([]), [selected, setSelected] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false)
  const generation = useRef(0), operation = useRef<{ unitId: string; requestId: string } | undefined>(undefined)
  const load = useCallback(async () => {
    const current = ++generation.current
    try { const rows = await repairStockService.units(item.entityId, item.id); if (current === generation.current) { setUnits(rows); setError('') } }
    catch (failure) { if (current === generation.current) setError(errorText(failure)) }
    finally { if (current === generation.current) setLoaded(true) }
  }, [item.entityId, item.id])
  useEffect(() => { void load(); const current = generation; return () => { current.current++ } }, [load, item.version])
  const own = units.flatMap(unit => unit.reservations.filter(row => row.itemId === item.id && row.status === 'RESERVED').map(row => ({ unit, row })))
  const proposed = item.repairInspection?.data
  const eligible = units.filter(unit => unit.qualification.sku === proposed?.replacementSku && unit.kind === proposed?.replacementCondition &&
    (unit.status === 'QUALIFIED' || unit.reservations.some(row => row.itemId === item.id && row.status === 'RESERVED')))
  const reserve = async () => {
    const unit = eligible.find(value => value.id === selected); if (!unit || busy) return
    setBusy(true); setError('')
    try {
      const current = unit.reservations.find(value => value.itemId === item.id && value.status === 'RESERVED')
      if (current?.expiresAt && Date.parse(current.expiresAt) <= Date.now()) throw new Error('expired')
      if (operation.current?.unitId !== unit.id) operation.current = { unitId: unit.id, requestId: crypto.randomUUID() }
      const value = current || await repairStockService.reserve({ entityId: item.entityId, itemId: item.id, unitId: unit.id, requestId: operation.current.requestId, expectedVersion: item.version })
      onSelected({ reservationId: value.id, unitLabel: unit.unitLabel, sku: unit.qualification.sku, condition: unit.kind, serialNumber: unit.serialNumber || undefined, hasSerialNumbers: unit.qualification.hasSerialNumbers, version: item.version })
      await load(); message.success('已預留替換品')
    } catch (failure) { setError(failure instanceof Error && failure.message==='expired'?'預留已過期，請重新核對。':errorText(failure)) } finally { setBusy(false) }
  }
  const release = async (id: string) => {
    if (busy) return
    setBusy(true); setError('')
    try { await repairStockService.release(item.entityId, id); onReleased?.(id); operation.current = undefined; await load(); message.success('已取消預留') }
    catch (failure) { setError(errorText(failure)) } finally { setBusy(false) }
  }
  return <Space direction="vertical" style={{ width: '100%' }}>
    {contextHolder}
    {error && <Alert type="warning" message={error} />}
    {own.map(({ unit, row }) => <Space key={row.id} wrap><Tag color="blue">已預留 · {unit.unitLabel}</Tag><span>{row.expiresAt ? `效期 ${new Date(row.expiresAt).toLocaleString('zh-TW')}` : ''}</span><Button danger disabled={busy} onClick={() => void release(row.id)}>取消預留</Button></Space>)}
    {!error && loaded && (!proposed?.replacementSku || !proposed.replacementCondition || !eligible.length) && <Alert type="warning" message={!proposed?.replacementSku || !proposed.replacementCondition?'請先填寫換機 SKU 與品況':`沒有符合 ${proposed.replacementSku} 的${proposed.replacementCondition==='NEW'?'新品':'整新品'}`} />}
    <Space wrap><Select style={{ minWidth: 280, maxWidth:'100%' }} placeholder="選擇替換品" aria-label="選擇替換品" value={eligible.some(unit => unit.id === selected) ? selected : undefined} disabled={busy} onChange={setSelected} options={eligible.map(unit => ({ value: unit.id, label: `${unit.unitLabel} · ${unit.qualification.sku} · ${unit.kind === 'NEW' ? '新品' : '整新品'}${unit.serialNumber ? ' · SN ' + unit.serialNumber : ''}` }))} />
      <Tooltip title={!eligible.some(unit=>unit.id===selected)?'請選擇替換品':undefined}><span><Button loading={busy} disabled={!eligible.some(unit => unit.id === selected)} onClick={() => void reserve()}>預留並帶入</Button></span></Tooltip></Space>
  </Space>
}
