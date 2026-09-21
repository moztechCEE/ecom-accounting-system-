import { useState } from 'react'
import { Alert, Button, List, Modal, Table } from 'antd'
import { previewCartons, sampleSerial } from './model'
import type { PreviewCarton, SnDraft } from './model'

export default function CartonPreview({ draft }: { draft: SnDraft }) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<PreviewCarton | null>(null)
  const [serialPage, setSerialPage] = useState(1)
  let cartons: ReturnType<typeof previewCartons> | undefined, error = ''
  try { cartons = previewCartons(draft, page) } catch (e) { error = (e as Error).message }
  if (!cartons) return <Alert type="info" showIcon message={`箱內 SN 預覽：${error}`} />
  // Enumerate only the visible page, even for a carton containing many serials.
  const offset = (serialPage - 1) * 20
  const serials = selected ? Array.from({ length: Math.min(20, Math.max(0, selected.quantity - offset)) },
    (_, i) => sampleSerial(draft, selected.firstSequence + offset + i)) : []
  return <>
    <p className="sn-muted">以下以 000001 起號展示本批裝箱方式，並非正式配號或跨訂單接續結果。</p>
    <Table size="small" rowKey="index" dataSource={cartons.rows} scroll={{ x: 680 }} pagination={{ current: page, pageSize: 10, total: cartons.total, showSizeChanger: false, onChange: setPage }} columns={[
      { title: '箱序（預覽）', dataIndex: 'index', render: (index: number) => `第 ${index} 箱` },
      { title: '型號／款式／顏色', render: () => [draft.model || draft.modelCode, draft.style || draft.styleCode, draft.color || draft.colorCode].join('／') },
      { title: '實際數量', dataIndex: 'quantity' },
      { title: '起始 SN', dataIndex: 'firstSn' }, { title: '結束 SN', dataIndex: 'lastSn' },
      { title: '箱內清單', render: (_, carton: PreviewCarton) => <Button size="small" onClick={() => { setSelected(carton); setSerialPage(1) }}>查看序號</Button> },
    ]} />
    <Modal title={selected ? `第 ${selected.index} 箱 · ${selected.quantity} 件（預覽）` : ''} open={!!selected} onCancel={() => setSelected(null)} footer={null}>
      <List size="small" dataSource={serials} renderItem={sn => <List.Item><code>{sn}</code></List.Item>} />
      <div className="sn-export"><Button disabled={serialPage === 1} onClick={() => setSerialPage(p => p - 1)}>上一頁</Button>
        <span>{serialPage} / {Math.ceil((selected?.quantity || 1) / 20)}</span>
        <Button disabled={!selected || offset + 20 >= selected.quantity} onClick={() => setSerialPage(p => p + 1)}>下一頁</Button></div>
    </Modal>
  </>
}
