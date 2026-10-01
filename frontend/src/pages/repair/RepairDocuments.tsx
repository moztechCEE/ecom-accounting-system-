import { useRef, useState } from 'react'
import { Alert, Button, Card, Col, Collapse, Descriptions, Empty, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd'
import type { FormInstance } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../services/api'
import { hasPermission } from '../../utils/access'
import { errorText } from '../mailroom/model'
import { FEES, PLANS, RESULTS, inspectionReviewCurrent } from './repair-model'
import type { InspectionData, RepairData, RepairDocument, RepairItem } from './repair-model'

const INSPECTION_STAGES = ['REPAIR_RECEIVED', 'INSPECTING', 'REFURBISHING']
const REPORT_STAGES = ['INSPECTING', 'REPAIRING', 'REFURBISHING']
const REPRODUCTION = { YES: '可重現', INTERMITTENT: '間歇發生', NO: '未重現', NOT_TESTED: '尚未測試' }
const CAUSES = { CONFIRMED: '原因已確認', SUSPECTED: '推測原因，待驗證', UNKNOWN: '原因尚未確認' }
const OUTCOMES = { REPAIRED: '原機實際維修', REPLACED: '實際替換' }
const CONDITIONS = { NEW: '全新品', REFURBISHED: '複驗合格整新品' }
const INTERNAL_FEES = { FREE: '公司內部整新處理', PAID: '內部估價項目', REVIEW: '內部處理範圍待確認' }
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }))
const requiredText = (text = '請填寫此項；未測或沒有配件也請明確註記') => [{ required: true, whitespace: true, message: text }]
const date = (value?: string) => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '—'
const textValue = (value: unknown) => typeof value === 'string' ? value : ''
const blankCheck = () => ({ name: '', result: 'NOT_TESTED' as const, observation: '' })

function DocumentHeading({ document, title, inspection = false }: { document?: RepairDocument | null; title: string; inspection?: boolean }) {
  return <Space wrap style={{ marginBottom: 16 }}>
    <Typography.Text strong>{title}</Typography.Text>
    {document ? <>
      <Typography.Text>{document.number} · 文件 v{document.revision}</Typography.Text>
      <Tag color={document.status === 'SUBMITTED' ? 'green' : 'default'}>{document.status === 'SUBMITTED' ? '已提交' : '草稿'}</Tag>
      {document.inspectionRevision != null && <Tag>依檢修單 v{document.inspectionRevision}</Tag>}
      <Typography.Text type="secondary">{document.authorName} · {date(document.updatedAt)}</Typography.Text>
      {inspection && <>
        <Tag color={inspectionReviewCurrent(document) ? 'green' : 'orange'}>{inspectionReviewCurrent(document) ? `客服已確認檢修 v${document.revision}` : '目前方案待客服確認'}</Tag>
        <Typography.Text type="secondary">{document.review ? `${document.review.name} · 確認檢修 v${document.review.inspectionRevision} · ${date(document.review.confirmedAt)}${inspectionReviewCurrent(document) ? '' : '（非目前已提交版次）'}` : '尚無客服確認紀錄'}</Typography.Text>
      </>}
    </> : <Tag>尚未建立</Tag>}
  </Space>
}

function CheckFields({ editable, passing = false, title = '檢測項目' }: { editable: boolean; passing?: boolean; title?: string }) {
  return <Form.List name="checks" rules={[{ validator: (_, value) => Array.isArray(value) && value.length > 0 ? Promise.resolve() : Promise.reject(new Error('請至少填寫一項檢測')) }]}>
    {(fields, { add, remove }, { errors }) => <>
      {fields.map((field, index) => <Card key={field.key} size="small" title={`${title} ${index + 1}`} style={{ marginBottom: 12 }}
        extra={editable ? <Button size="small" type="text" danger onClick={() => remove(field.name)}>移除</Button> : undefined}>
        <Row gutter={16}>
          <Col xs={24} sm={16}><Form.Item name={[field.name, 'name']} label="項目名稱" rules={requiredText('請填寫測試項目名稱')}><Input maxLength={160} /></Form.Item></Col>
          <Col xs={24} sm={8}><Form.Item name={[field.name, 'result']} label="結果" rules={[{ required: true }, ...(passing ? [{ validator: (_: unknown, value: string) => value === 'PASS' ? Promise.resolve() : Promise.reject(new Error('總複驗通過時，此項也必須通過')) }] : [])]}>
            <Select options={options(RESULTS)} />
          </Form.Item></Col>
        </Row>
        <Form.Item name={[field.name, 'observation']} label="觀察結果／量測值／未測原因" rules={requiredText()}><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>
      </Card>)}
      <Form.ErrorList errors={errors} />
      {editable && <Button block type="dashed" disabled={fields.length >= 50} onClick={() => add(blankCheck())} style={{ marginBottom: 20 }}>新增{title}</Button>}
    </>}
  </Form.List>
}

function CheckTable({ checks }: { checks: InspectionData['checks'] }) {
  return <Table size="small" pagination={false} dataSource={checks.map((check, index) => ({ ...check, key: index }))} columns={[
    { title: '檢測項目', dataIndex: 'name' },
    { title: '結果', dataIndex: 'result', render: (value: keyof typeof RESULTS) => RESULTS[value] || value },
    { title: '觀察結果／未測原因', dataIndex: 'observation' },
  ]} />
}

function SavedDocument({ document, kind, customerRepair }: { document: RepairDocument; kind: 'inspection' | 'repair'; customerRepair: boolean }) {
  const data = document.data
  const details = kind === 'inspection' ? (() => {
    const inspection = data as InspectionData
    return [
      ['客訴／故障描述', inspection.complaint], ['故障重現', REPRODUCTION[inspection.reproduction]],
      ['測試條件', inspection.testConditions], ['原因確定度', CAUSES[inspection.causeStatus]],
      ['診斷', inspection.diagnosis], ['建議處理', PLANS[inspection.plan]], ['方案說明', inspection.planNote],
      ['費用建議', (customerRepair ? FEES : INTERNAL_FEES)[inspection.feeSuggestion]], ['內部估價', inspection.estimateAmount ?? '未填'], ['估價項目', inspection.estimateNote],
    ]
  })() : (() => {
    const repair = data as RepairData
    return [
      ['實際處置', OUTCOMES[repair.outcome]], ['施工／替換內容', repair.workPerformed], ['工時（分鐘）', repair.laborMinutes],
      ['依據檢修版次', document.inspectionRevision != null ? `v${document.inspectionRevision}` : '未綁定；不可據此交付'],
      ['總複驗', RESULTS[repair.qcResult]], ['複驗說明', repair.qcNotes], ['交付配件', repair.deliveredAccessories],
      ...(repair.outcome === 'REPLACED' ? [
        ['替換件品況', repair.replacementCondition ? CONDITIONS[repair.replacementCondition] : '未填'],
        ['替換 SKU', repair.replacementSku], ['替換 SN', repair.replacementSerial], ['替換來源', repair.replacementSource],
        ['原件去向', repair.originalDisposition], ['庫存關聯（不等於出庫完成）', repair.inventoryReference],
      ] : []),
    ]
  })()
  return <div>
    <DocumentHeading document={document} title={kind === 'inspection' ? '檢修單' : '維修單'} inspection={kind === 'inspection' && customerRepair} />
    <Descriptions column={1} size="small" bordered items={details.map(([label, value], index) => ({ key: index, label, children: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value === '' || value == null ? '—' : value}</span> }))} />
    <div style={{ marginTop: 16 }}><CheckTable checks={data.checks || []} /></div>
    {kind === 'repair' && <Table style={{ marginTop: 16 }} size="small" pagination={false}
      dataSource={((data as RepairData).parts || []).map((part, index) => ({ ...part, key: index }))}
      columns={[{ title: '實際零件', dataIndex: 'name' }, { title: 'SKU', dataIndex: 'sku' }, { title: '數量', dataIndex: 'quantity' }]} />}
  </div>
}

function printDocument(item: RepairItem, kind: 'inspection' | 'repair') {
  const document = kind === 'inspection' ? item.repairInspection : item.repairReport
  if (!document) return
  const printable = window.open('', '_blank', 'width=900,height=750')
  if (!printable) { message.warning('列印視窗未能開啟，請允許此網站的彈出視窗。'); return }
  const escape = (value: unknown) => String(value ?? '—').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
  const data = document.data
  const customerRepair = item.receipt.category === 'REPAIR'
  const fields: [string, unknown][] = [
    ['文件', `${document.number} · v${document.revision} · ${document.status === 'SUBMITTED' ? '已提交' : '草稿'}`],
    ['作者／更新時間', `${document.authorName} · ${date(document.updatedAt)}`],
    ['售後案件／收件單', `${item.receipt.sourceNumber || '無售後來源'} / ${item.receipt.number}`],
    ['物件', item.label], ['產品', item.productName], ['原件 SKU／SN', `${item.sku || '未提供'} / ${item.serialNumber || '未提供'}`],
    ['案件目的', customerRepair ? '顧客送修' : '公司退貨庫存整新'],
  ]
  let parts = ''
  if (kind === 'inspection') {
    const inspection = data as InspectionData
    fields.push(
      ...(customerRepair ? [
        ['ERP 客服方案確認', inspectionReviewCurrent(document) ? `本版已確認（檢修 v${document.revision}）` : '本版尚未確認'],
        ['客服確認紀錄', document.review ? `${document.review.name} · 檢修 v${document.review.inspectionRevision} · ${date(document.review.confirmedAt)}` : '尚無紀錄'],
      ] as [string, unknown][] : []),
      ['客訴／故障描述', inspection.complaint], ['故障重現', REPRODUCTION[inspection.reproduction]], ['測試條件', inspection.testConditions],
      ['原因確定度', CAUSES[inspection.causeStatus]], ['診斷', inspection.diagnosis], ['建議處理', PLANS[inspection.plan]],
      ['方案說明', inspection.planNote], ['費用建議', (customerRepair ? FEES : INTERNAL_FEES)[inspection.feeSuggestion]], ['內部估價', inspection.estimateAmount ?? '未填'], ['估價項目', inspection.estimateNote],
    )
  } else {
    const repair = data as RepairData
    fields.push(
      ['依據檢修版次', document.inspectionRevision != null ? `v${document.inspectionRevision}` : '未綁定；不可據此交付'],
      ['目前檢修版次', item.repairInspection ? `v${item.repairInspection.revision}` : '尚未建立'],
      ['實際處置', OUTCOMES[repair.outcome]], ['實際施工／替換內容', repair.workPerformed], ['工時（分鐘）', repair.laborMinutes],
      ['總複驗', RESULTS[repair.qcResult]], ['複驗說明', repair.qcNotes], ['交付配件', repair.deliveredAccessories],
    )
    if (repair.outcome === 'REPLACED') fields.push(
      ['替換件品況', repair.replacementCondition ? CONDITIONS[repair.replacementCondition] : '未填'],
      ['替換件 SKU／SN', `${repair.replacementSku || '未提供'} / ${repair.replacementSerial || '未提供'}`],
      ['替換來源', repair.replacementSource], ['原件去向', repair.originalDisposition], ['庫存關聯（不等於出庫完成）', repair.inventoryReference],
    )
    parts = `<h2>實際使用零件</h2><table><thead><tr><th>名稱</th><th>SKU</th><th>數量</th></tr></thead><tbody>${(repair.parts || []).map(part => `<tr><td>${escape(part.name)}</td><td>${escape(part.sku)}</td><td>${escape(part.quantity)}</td></tr>`).join('')}</tbody></table>`
  }
  const title = kind === 'inspection' ? '內部檢修單' : '內部維修單'
  printable.document.open()
  printable.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escape(document.number)} ${title}</title><style>@page{margin:16mm}body{font:14px sans-serif;color:#172534}h1{font-size:22px}p{line-height:1.6}table{width:100%;border-collapse:collapse;margin:16px 0;table-layout:fixed}th,td{border:1px solid #a9b6c4;padding:8px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eef2f6}tr{break-inside:avoid}.label{width:25%}</style></head><body><h1>DOA 售後維修工作台 · ${title}</h1><p>僅供內部作業；本單為已保存版本，不含尚未儲存的修改。估價為維修師建議，對客報價須由客服審核。ERP 客服方案確認不等於顧客同意或款項入帳；這兩項仍須依售後來源案件核對。維修單須與目前已提交的檢修版次一致，且複驗通過，才能交回。</p><table>${fields.map(([label, value]) => `<tr><th class="label">${escape(label)}</th><td>${escape(value)}</td></tr>`).join('')}</table><h2>逐項檢測／複驗</h2><table><thead><tr><th>項目</th><th>結果</th><th>觀察／量測／未測原因</th></tr></thead><tbody>${(data.checks || []).map(check => `<tr><td>${escape(check.name)}</td><td>${escape(RESULTS[check.result])}</td><td>${escape(check.observation)}</td></tr>`).join('')}</tbody></table>${parts}<p>此單不是對客維修報告，也不代表已付款或已完成庫存出入庫。文件狀態：${document.status === 'DRAFT' ? '草稿（尚未提交）' : '已提交'}。</p></body></html>`)
  printable.document.close()
  printable.focus()
  printable.print()
}

export default function RepairDocuments({ item, entityId, onSaved, onDirtyChange }: { item: RepairItem; entityId: string; onSaved: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { user } = useAuth()
  const customerRepair = item.receipt.category === 'REPAIR'
  const [inspectionForm] = Form.useForm<InspectionData>()
  const [repairForm] = Form.useForm<RepairData>()
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const saving = useRef(false)
  const operation = useRef<{ body: string; requestId: string } | null>(null)
  const ownSigned = item.editable === true && !!user?.id && item.repairOwnerId === user.id && item.custodianId === user.id && hasPermission(user, 'repair_workbench:update')
  const canInspect = ownSigned && INSPECTION_STAGES.includes(item.status)
  const canReport = ownSigned && REPORT_STAGES.includes(item.status)
  const inspectionInitial: InspectionData = item.repairInspection?.data || {
    complaint: '', reproduction: 'NOT_TESTED', testConditions: '', checks: [blankCheck()],
    diagnosis: '', causeStatus: 'UNKNOWN', plan: 'REPAIR', planNote: '', feeSuggestion: 'REVIEW', estimateNote: '',
  }
  const repairInitial: RepairData = item.repairReport?.data || {
    outcome: item.repairInspection?.data.plan === 'REPLACE' ? 'REPLACED' : 'REPAIRED', workPerformed: '',
    parts: [], laborMinutes: 0, checks: [blankCheck()], qcResult: 'NOT_TESTED', qcNotes: '', deliveredAccessories: '',
  }
  const fee = Form.useWatch('feeSuggestion', inspectionForm) || inspectionInitial.feeSuggestion
  const outcome = Form.useWatch('outcome', repairForm) || repairInitial.outcome
  const qc = Form.useWatch('qcResult', repairForm) || repairInitial.qcResult

  async function save(kind: 'inspection' | 'repair', status: 'DRAFT' | 'SUBMITTED') {
    const editable = kind === 'inspection' ? canInspect : canReport
    if (!editable || saving.current) return
    const form = (kind === 'inspection' ? inspectionForm : repairForm) as FormInstance
    saving.current = true
    setBusy(`${kind}:${status}`)
    setFailure('')
    let saved = false
    try {
      if (status === 'SUBMITTED') await form.validateFields()
      const otherForm = kind === 'inspection' ? repairForm : inspectionForm
      if (otherForm.isFieldsTouched()) {
        const discard = await new Promise<boolean>(resolve => Modal.confirm({
          title: `另一張${kind === 'inspection' ? '維修單' : '檢修單'}有未保存修改`,
          content: '保存本單後會重新載入案件，另一張未保存的修改會遺失。您可以取消，返回整理或保存草稿。',
          okText: '保存本單並放棄另一張修改', cancelText: '取消，保留草稿',
          onOk: () => { resolve(true) }, onCancel: () => { resolve(false) }, maskClosable: false,
        }))
        if (!discard) return
      }
      const values = form.getFieldsValue(true)
      const checks = (values.checks || []).map((check: InspectionData['checks'][number]) => ({ name: textValue(check.name), result: check.result || 'NOT_TESTED', observation: textValue(check.observation) }))
      const data: InspectionData | RepairData = kind === 'inspection' ? {
        complaint: textValue(values.complaint), reproduction: values.reproduction || 'NOT_TESTED',
        testConditions: textValue(values.testConditions), checks, diagnosis: textValue(values.diagnosis), causeStatus: values.causeStatus || 'UNKNOWN',
        plan: values.plan || 'REPAIR', planNote: textValue(values.planNote), feeSuggestion: values.feeSuggestion || 'REVIEW',
        ...(typeof values.estimateAmount === 'number' ? { estimateAmount: values.estimateAmount } : {}), estimateNote: textValue(values.estimateNote),
      } : {
        outcome: values.outcome || 'REPAIRED', workPerformed: textValue(values.workPerformed),
        parts: (values.parts || []).map((part: RepairData['parts'][number]) => ({ name: textValue(part.name), sku: textValue(part.sku), quantity: typeof part.quantity === 'number' ? part.quantity : 1 })),
        laborMinutes: typeof values.laborMinutes === 'number' ? values.laborMinutes : 0, checks, qcResult: values.qcResult || 'NOT_TESTED',
        qcNotes: textValue(values.qcNotes), deliveredAccessories: textValue(values.deliveredAccessories),
        ...(values.outcome === 'REPLACED' ? {
          ...(values.replacementCondition ? { replacementCondition: values.replacementCondition } : {}),
          replacementSku: textValue(values.replacementSku), replacementSerial: textValue(values.replacementSerial),
          replacementSource: textValue(values.replacementSource), originalDisposition: textValue(values.originalDisposition),
          inventoryReference: textValue(values.inventoryReference),
        } : {}),
      }
      const body = JSON.stringify({ entityId, expectedVersion: item.version, status, data })
      if (operation.current?.body !== body) operation.current = { body, requestId: crypto.randomUUID() }
      await api.post(`/repair-workbench/items/${encodeURIComponent(item.id)}/${kind === 'inspection' ? 'inspection' : 'repair-report'}`, { ...JSON.parse(body), requestId: operation.current.requestId })
      saved = true
      onDirtyChange?.(false)
      await onSaved()
      message.success(status === 'DRAFT' ? '草稿已保存，尚未提交' : kind === 'inspection' && customerRepair ? '檢修單已提交。下一步請提交客服確認，免費方案也須確認。' : '工作單已提交並保存版本')
    } catch (error) {
      const fields = (error as { errorFields?: { name: (string | number)[] }[] })?.errorFields
      if (fields?.length) form.scrollToField(fields[0].name)
      else setFailure(saved ? '文件已保存，但重新載入失敗。請重新開啟案件查看最新版本。' : errorText(error))
    } finally { saving.current = false; setBusy(null) }
  }

  const buttons = (kind: 'inspection' | 'repair', editable: boolean) => editable ? <Space wrap>
    <Button disabled={!!busy} loading={busy === `${kind}:DRAFT`} onClick={() => void save(kind, 'DRAFT')}>保存草稿</Button>
    <Button type="primary" disabled={!!busy} loading={busy === `${kind}:SUBMITTED`} onClick={() => void save(kind, 'SUBMITTED')}>提交{kind === 'inspection' ? '檢修單' : '維修單'}</Button>
  </Space> : <Typography.Text type="secondary">唯讀：只有本人簽收的維修師，能在可作業階段填寫此單。</Typography.Text>

  type Snapshot = { repairInspection?: RepairDocument<InspectionData> | null; repairReport?: RepairDocument<RepairData> | null }
  const versions = new Map<string, { kind: 'inspection' | 'repair'; document: RepairDocument; recordedAt: string }>()
  for (const action of item.history || []) {
    const snapshot = action.snapshot as Snapshot | undefined
    for (const [kind, document] of [['inspection', snapshot?.repairInspection], ['repair', snapshot?.repairReport]] as const) {
      if (document) {
        const key = `${kind}:${document.number}:${document.revision}`
        const previous = versions.get(key)
        if (!previous || Date.parse(action.createdAt) > Date.parse(previous.recordedAt)) versions.set(key, { kind, document, recordedAt: action.createdAt })
      }
    }
  }
  const history = [...versions.entries()].sort(([, first], [, second]) => Date.parse(second.document.updatedAt) - Date.parse(first.document.updatedAt))

  return <div>
    <Space wrap style={{ marginBottom: 12 }}><Typography.Text strong>本人檢修與維修紀錄</Typography.Text><Tag>案件版本 {item.version}</Tag></Space>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message={customerRepair ? '保存草稿不代表提交。檢修單保存新版本後須重新取得客服方案確認；原版本與確認紀錄保留在歷程。' : '退貨庫存整新為公司內部作業，提交及更正均保留版本；交回仍須檢修與維修版次一致、複驗通過。'} />
    {!ownSigned && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="目前為唯讀；認領不等於本人已簽收。工作單由有編輯權且已簽收、保管此物件的維修師填寫。" />}
    {failure && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={failure} />}
    <Tabs items={[
      { key: 'inspection', label: '檢修單', forceRender: true, children: <>
        <DocumentHeading document={item.repairInspection} title="檢修單" inspection={customerRepair} />
        <Typography.Paragraph type="secondary">{customerRepair ? 'ERP 客服確認的是本版處理方案；顧客同意與收款仍以售後來源放行為準。' : '公司退貨庫存整新不套用顧客維修的客服方案確認、顧客同意或收款放行。'}</Typography.Paragraph>
        <Space wrap style={{ marginBottom: 16 }}><Button icon={<PrinterOutlined />} disabled={!item.repairInspection || !!busy} onClick={() => printDocument(item, 'inspection')}>列印內部檢修單</Button><Typography.Text type="secondary">列印已保存版本；不含未保存修改。</Typography.Text></Space>
        <Form name={`repair-inspection-${item.id}`} form={inspectionForm} layout="vertical" initialValues={inspectionInitial} onValuesChange={() => onDirtyChange?.(true)} disabled={!canInspect || !!busy}>
          <Form.Item name="complaint" label="客訴／故障描述" rules={requiredText()}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item name="reproduction" label="故障重現情況" rules={[{ required: true }]}><Select options={options(REPRODUCTION)} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="causeStatus" label="原因確定度" rules={[{ required: true }]}><Select options={options(CAUSES)} /></Form.Item></Col>
          </Row>
          <Form.Item name="testConditions" label="測試條件／設備／參考基準" rules={requiredText()}><Input.TextArea rows={2} maxLength={2000} showCount placeholder="記錄實際測試環境與機種檢測基準；未測請註明原因。" /></Form.Item>
          <CheckFields editable={canInspect && !busy} />
          <Form.Item name="diagnosis" label="診斷與原因判斷" rules={requiredText()}><Input.TextArea rows={3} maxLength={2000} showCount placeholder="原因未確認時，記錄現有證據與尚待排除項目。" /></Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item name="plan" label="建議處理方式" rules={[{ required: true }]}><Select options={options(PLANS)} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="feeSuggestion" label={customerRepair ? '費用建議（交客服審核）' : '內部處理費用建議'} rules={[{ required: true }]}><Select options={options(customerRepair ? FEES : INTERNAL_FEES)} /></Form.Item></Col>
          </Row>
          <Form.Item name="planNote" label="建議方案與處理範圍" rules={requiredText()}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={customerRepair ? '此處是維修師估價，不是客服正式報價。顧客同意不等於入帳；付費案件須由客服完成同意與會計入帳確認後，通知開工。' : '估價僅作公司內部整新處置紀錄，不是對客報價，也不執行付款或庫存異動。'} />
          <Form.Item name="estimateAmount" label="內部估價金額" rules={[{ required: fee === 'PAID', type: 'number', min: fee === 'PAID' ? 0.01 : 0, max: 10000000, message: '付費建議需正數估價；金額最多 10,000,000' }]}><InputNumber min={0} max={10000000} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="estimateNote" label="估價項目／範圍／費用說明" rules={fee === 'PAID' ? requiredText('付費建議請填寫估價項目') : []}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
          {buttons('inspection', canInspect)}
        </Form>
      </> },
      { key: 'repair', label: '維修單', forceRender: true, children: <>
        <DocumentHeading document={item.repairReport} title="維修單" />
        <Space wrap style={{ marginBottom: 16 }}><Button icon={<PrinterOutlined />} disabled={!item.repairReport || !!busy} onClick={() => printDocument(item, 'repair')}>列印內部維修單</Button><Typography.Text type="secondary">列印已保存版本；維修單保留依據的檢修版次。</Typography.Text></Space>
        {item.repairReport && item.repairReport.inspectionRevision !== item.repairInspection?.revision && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="維修單與目前檢修版次不一致" description="請依目前已提交的檢修單重新提交維修單，確認處置內容及複驗結果後才能交回。" />}
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="只記錄實際執行內容。替換請如實填寫替換；不得捏造原機修理紀錄。總複驗未通過可以留單，仍不能交回收發室。" />
        <Form name={`repair-report-${item.id}`} form={repairForm} layout="vertical" initialValues={repairInitial} onValuesChange={() => onDirtyChange?.(true)} disabled={!canReport || !!busy}>
          <Form.Item name="outcome" label="實際處置" rules={[{ required: true }]}><Select options={options(OUTCOMES)} /></Form.Item>
          <Form.Item name="workPerformed" label="實際施工／替換內容" rules={requiredText()}><Input.TextArea rows={3} maxLength={4000} showCount /></Form.Item>
          {outcome === 'REPLACED' && <>
            <Form.Item name="replacementCondition" label="替換件品況" rules={[{ required: true, message: '請如實選擇全新品或複驗合格整新品' }]}><Select options={options(CONDITIONS)} /></Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item name="replacementSku" label="替換件 SKU" rules={requiredText()}><Input maxLength={100} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="replacementSerial" label="替換件 SN" rules={requiredText()}><Input maxLength={100} /></Form.Item></Col>
            </Row>
            <Form.Item name="replacementSource" label="替換件來源／複驗紀錄關聯" rules={requiredText()}><Input maxLength={200} placeholder="記錄實際來源與可追查單號；沒有可用合格品請勿填作已替換。" /></Form.Item>
            <Form.Item name="originalDisposition" label={`原件去向（原件 SN：${item.serialNumber || '未提供'}）`} rules={requiredText()}><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>
            <Form.Item name="inventoryReference" label="庫存作業關聯（選填）" extra="此欄只記錄關聯單號，不會執行預留、出庫或原件入庫，也不代表庫存異動完成。"><Input maxLength={200} /></Form.Item>
          </>}
          <Form.List name="parts">{(fields, { add, remove }) => <>
            <Typography.Paragraph strong>實際使用零件</Typography.Paragraph>
            {fields.map((field, index) => <Card key={field.key} size="small" title={`零件 ${index + 1}`} style={{ marginBottom: 12 }}
              extra={canReport && !busy ? <Button type="text" size="small" danger onClick={() => remove(field.name)}>移除</Button> : undefined}>
              <Row gutter={16}>
                <Col xs={24} sm={10}><Form.Item name={[field.name, 'name']} label="名稱" rules={requiredText()}><Input maxLength={160} /></Form.Item></Col>
                <Col xs={24} sm={9}><Form.Item name={[field.name, 'sku']} label="SKU／料件編號" rules={requiredText('有使用料件請填寫可追查編號；未編號可先保存草稿')}><Input maxLength={100} /></Form.Item></Col>
                <Col xs={24} sm={5}><Form.Item name={[field.name, 'quantity']} label="數量" rules={[{ required: true, type: 'number', min: 0.0001, max: 100000 }]}><InputNumber min={0.0001} max={100000} precision={4} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
            </Card>)}
            {canReport && !busy && <Button block type="dashed" disabled={fields.length >= 50} onClick={() => add({ name: '', sku: '', quantity: 1 })} style={{ marginBottom: 20 }}>新增實際零件</Button>}
            {!fields.length && <Typography.Paragraph type="secondary">沒有登記使用零件。</Typography.Paragraph>}
          </>}</Form.List>
          <Form.Item name="laborMinutes" label="實際工時（分鐘）" rules={[{ required: true, type: 'integer', min: 0, max: 100000 }]}><InputNumber min={0} max={100000} precision={0} style={{ width: '100%' }} /></Form.Item>
          <CheckFields editable={canReport && !busy} passing={qc === 'PASS'} title="修後／替換件複驗項目" />
          <Form.Item name="qcResult" label="總複驗結果" rules={[{ required: true }]}><Select options={options(RESULTS)} /></Form.Item>
          <Form.Item name="qcNotes" label="複驗說明與異常" rules={requiredText()}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
          <Form.Item name="deliveredAccessories" label="交付配件（沒有也請註明）" rules={requiredText()}><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>
          {buttons('repair', canReport)}
        </Form>
      </> },
      { key: 'history', label: '版本歷程', children: history.length ? <Collapse items={history.map(([key, { kind, document }]) => ({
        key, label: `${kind === 'inspection' ? '檢修單' : '維修單'} ${document.number} · v${document.revision} · ${document.status === 'SUBMITTED' ? '已提交' : '草稿'} · ${document.authorName} · ${date(document.updatedAt)}`,
        children: <SavedDocument document={document} kind={kind} customerRepair={customerRepair} />,
      }))} /> : <Empty description="尚無檢修或維修文件版本" /> },
    ]} />
  </div>
}
