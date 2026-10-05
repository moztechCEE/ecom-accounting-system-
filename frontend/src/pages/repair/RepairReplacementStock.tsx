import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Select, Space, Tag, message } from 'antd'
import { repairStockService } from '../../services/repair-stock'
import type { ReplacementUnit } from '../../services/repair-stock'
import type { RepairItem } from './repair-model'
export type ReplacementSelection = { reservationId: string; unitLabel: string; sku: string; condition: 'NEW' | 'REFURBISHED'; serialNumber?: string; hasSerialNumbers?: boolean; version: number }
export default function RepairReplacementStock({ item, onSelected, onReleased }: {
  item: RepairItem & { entityId: string }; onSelected: (value: ReplacementSelection) => void; onReleased?: (reservationId: string) => void
}) {
  const [units, setUnits] = useState<ReplacementUnit[]>([]), [selected, setSelected] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0), operation = useRef<{ unitId: string; requestId: string } | undefined>(undefined)
  const load = useCallback(async () => {
    const current = ++generation.current
    try { const rows = await repairStockService.units(item.entityId, item.id); if (current === generation.current) { setUnits(rows); setError('') } }
    catch { if (current === generation.current) setError('合格替換庫存尚未準備完成，請庫存人員核對') }
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
      await load(); message.success('已預留替換商品；維修單草稿仍須保存，複驗與放行通過後才正式出庫')
    } catch { setError('預留未完成或已過期，請先核對或取消本案舊預留，再選取；方案也可能已更新') } finally { setBusy(false) }
  }
  const release = async (id: string) => {
    if (busy) return
    setBusy(true); setError('')
    try { await repairStockService.release(item.entityId, id); onReleased?.(id); operation.current = undefined; await load(); message.success('本案未使用的預留已釋放；尚未正式出庫') }
    catch { setError('取消預留未完成，請核對目前權限、實物及庫存狀態；已出庫不能在此回補') } finally { setBusy(false) }
  }
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Alert type="info" showIcon message="換機使用合格庫存" description="選擇已檢驗合格實物。預留獨立保存，放棄維修單草稿或離開頁面不會取消預留；不用的預留請明確取消。正式出庫仍須本版維修單、複驗及放行。" />
    {error && <Alert type="warning" message={error} />}
    {own.map(({ unit, row }) => <Space key={row.id} wrap><Tag color="blue">本案已預留：{unit.unitLabel}</Tag><span>{row.expiresAt ? `效期 ${new Date(row.expiresAt).toLocaleString('zh-TW')}` : ''}</span><Button danger disabled={busy} onClick={() => void release(row.id)}>取消本案預留</Button></Space>)}
    <Space wrap><Select style={{ minWidth: 280 }} placeholder="選擇符合檢修方案的替換實物" value={eligible.some(unit => unit.id === selected) ? selected : undefined} disabled={busy} onChange={setSelected} options={eligible.map(unit => ({ value: unit.id, label: `${unit.unitLabel} · ${unit.qualification.sku} · ${unit.kind === 'NEW' ? '新品' : '整新品'}${unit.serialNumber ? ' · SN ' + unit.serialNumber : ''}` }))} />
      <Button loading={busy} disabled={!eligible.some(unit => unit.id === selected)} onClick={() => void reserve()}>預留並填入維修單</Button><Tag>一件對一件</Tag></Space>
  </Space>
}
