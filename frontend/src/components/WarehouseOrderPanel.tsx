import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Drawer, Input, Progress, Space, Table, Tag, Typography } from 'antd'
import type { InputRef } from 'antd'
import api from '../services/api'
import type { WarehouseDetail, WarehouseRow, WorkItem, WorkStage } from '../services/warehouse.types'

export default function WarehouseOrderPanel({ order, entityId, station, stage, onClose }: {
  order: WarehouseRow; entityId: string; station: string; stage: WorkStage | null; onClose: () => void;
}) {
  const [data, setData] = useState<WarehouseDetail | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [scan, setScan] = useState('')
  const [reload, setReload] = useState(0), [feedback, setFeedback] = useState('')
  const input = useRef<InputRef>(null), inFlight = useRef(false)
  useEffect(() => {
    const abort = new AbortController(); setData(null); setError('')
    api.get<WarehouseDetail>(`/wms/workbench/orders/${encodeURIComponent(order.id)}`, { params: { entityId, area: station }, signal: abort.signal })
      .then(r => { if (!abort.signal.aborted) setData(r.data) })
      .catch(() => { if (!abort.signal.aborted) setError('無法載入作業明細') })
    return () => abort.abort()
  }, [order.id, entityId, station, reload])
  const action = (kind: string) => !!data?.allowedActions.includes(`${stage}:${kind}`)
  useEffect(() => {
    if (!busy && stage && data?.allowedActions.includes(`${stage}:scan`)) input.current?.focus()
  }, [busy, stage, data])
  async function submit(kind: 'claim' | 'scan') {
    if (!data || !stage || !action(kind) || inFlight.current || kind === 'scan' && !scan.trim()) return
    inFlight.current = true; setBusy(true); setError(''); setFeedback('')
    const value = scan.trim()
    try {
      const r = await api.post<WarehouseDetail>(`/wms/workbench/orders/${encodeURIComponent(order.id)}/${stage}/${kind}`, {
        entityId, expectedRevision: data.revision, requestId: crypto.randomUUID(), ...(kind === 'scan' ? { scanValue: value } : {}),
      })
      setData(r.data); setScan(''); setFeedback(kind === 'scan' ? '已核對 1 件' : '已開始作業')
    } catch (e: unknown) {
      const status = (e as {response?: {status?: number}}).response?.status
      setError(status === 409 ? '資料已變更、重複掃碼或尚未符合核對條件，請重新載入確認' : status === 400 ? '條碼不屬於此訂單，或需要掃描 SN' : '結果尚未確認，請重新載入核對，勿直接重送')
      // Do not retry an uncertain write or continue with stale state.
      setData(current => current ? { ...current, allowedActions: [] } : null)
    } finally { inFlight.current = false; setBusy(false); input.current?.focus() }
  }
  const done = stage === 'pack' ? data?.packed : data?.picked
  return <Drawer title={`${order.orderNumber} · ${stage === 'pick' ? '揀貨' : stage === 'pack' ? '裝箱核對' : '出貨明細'}`}
    open onClose={busy ? undefined : onClose} closable={!busy} maskClosable={!busy} keyboard={!busy} width="min(960px, 100vw)" className="warehouse-work-panel">
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {error && <Alert type="warning" message={error} action={<Button disabled={busy} onClick={() => setReload(x => x + 1)}>重新載入</Button>} />}
      {data && <>
        {data.source === 'fixture' && <Tag>操作預覽 · 測試資料</Tag>}
        <Descriptions column={2} items={[
          { key: 'state', label: '作業狀態', children: data.warehouseLabel },
          { key: 'brand', label: '品牌', children: data.brand || '待對照' },
          { key: 'logistics', label: '物流', children: data.logisticsLabel },
          { key: 'receipt', label: '退回實收', children: data.receiptLabel },
        ]} />
        {stage && <div className="warehouse-scan-zone">
          <div className="warehouse-progress-title"><Typography.Title level={4}>{stage === 'pick' ? '揀貨進度' : '裝箱進度'}</Typography.Title><span>{done} / {data.required} 件</span></div>
          <Progress percent={data.required ? Math.round((done || 0) / data.required * 100) : 0} showInfo={false} strokeColor="#1677ff" />
          {action('claim') && <Button type="primary" loading={busy} onClick={() => submit('claim')}>{stage === 'pick' ? '開始揀貨' : '開始裝箱'}</Button>}
          <form onSubmit={e => { e.preventDefault(); void submit('scan') }} className="warehouse-scan-form">
            <Input ref={input} aria-label="掃描商品條碼或 SN" placeholder="掃描商品條碼或 SN" value={scan} onChange={e => setScan(e.target.value)} disabled={busy || !action('scan')} autoComplete="off" />
            <Button htmlType="submit" type="primary" loading={busy} disabled={!action('scan') || !scan.trim()}>核對</Button>
          </form>
          <div role="status" aria-live="polite">{feedback}</div>
        </div>}
        {data.blockers.length > 0 && <Alert type="warning" message={data.blockers.join('；')} />}
        <Table<WorkItem> rowKey="id" dataSource={data.items} pagination={false} scroll={{ x: 620 }} columns={[
          { title: '商品', dataIndex: 'name', render: (name, item) => <><strong>{name}</strong><div>{item.sku}</div></> },
          { title: '條碼／SN', render: (_, item) => item.serials.length ? item.serials.map(s => <div key={s.value}><code>{s.value}</code> · {s.status === 'pending' ? '待揀貨' : s.status === 'picked' ? '已揀貨' : '已裝箱'}</div>) : <code>{item.barcode}</code> },
          { title: '需求', dataIndex: 'quantity' }, { title: '已揀', dataIndex: 'picked' }, { title: '已裝', dataIndex: 'packed' },
        ]} />
      </>}
    </Space>
  </Drawer>
}
