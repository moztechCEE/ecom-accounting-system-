import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, Card, Col, Collapse, Descriptions, Empty, Form, Input, InputNumber, Row, Select, Space, Table, Tabs, Tag, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../services/api'
import { hasPermission } from '../../utils/access'
import { errorText } from '../mailroom/model'
import { FEES, PLANS, RESULTS, inspectionReviewCurrent, materialPlanPayload } from './repair-model'
import type { InspectionData, RepairAssessment, RepairData, RepairDocument, RepairItem, RepairTemplateView, RepairDocumentV2Fields } from './repair-model'
import RepairReplacementStock from './RepairReplacementStock'
import { RepairDocumentExtras } from './RepairDocumentExtras'
import { useRepairFeedback } from './repair-feedback'
import type { RepairMessage } from './repair-feedback'

const INSPECTION_STAGES = ['REPAIR_RECEIVED', 'INSPECTING', 'REFURBISHING']
const REPORT_STAGES = ['INSPECTING', 'REPAIRING', 'REFURBISHING']
const REPRODUCTION = { YES: '可重現', INTERMITTENT: '間歇發生', NO: '未重現', NOT_TESTED: '尚未測試' }
const CAUSES = { CONFIRMED: '原因已確認', SUSPECTED: '推測原因，待驗證', UNKNOWN: '原因尚未確認' }
const CONCLUSIONS = { USER_CAUSED: '使用／外力因素已確認', PRODUCT_FAULT: '產品本身異常已確認', UNDETERMINED: '原因待確認' }
const MEDIA_PHASES = { BEFORE: '修前', AFTER: '修後', DIAGNOSTIC: '檢測' }
const OUTCOMES = { REPAIRED: '原機實際維修', REPLACED: '實際替換', FACTORY_REPAIRED: '原廠處理返還' }
const CONDITIONS = { NEW: '全新品', REFURBISHED: '複驗合格整新品' }
const INTERNAL_FEES = { FREE: '公司內部整新處理', PAID: '內部估價項目', REVIEW: '內部處理範圍待確認' }
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }))
const requiredText = (text = '請填寫此項；未測或沒有配件也請明確註記') => [{ required: true, whitespace: true, message: text }]
const date = (value?: string) => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '—'
const textValue = (value: unknown) => typeof value === 'string' ? value : ''
const blankCheck = () => ({ name: '', result: 'NOT_TESTED' as const, observation: '' })
const MATERIAL_MODES = { UNASSESSED: '待確認', NONE: '無需材料', REQUIRED: '需材料' }
function assessmentRecord(value: InspectionData['assessment']): RepairAssessment | undefined {
  return value?.schema === 1 && Object.hasOwn(CONCLUSIONS, value.conclusion) && typeof value.basis === 'string' && typeof value.causalExplanation === 'string'
    && Array.isArray(value.checkKeys) && value.checkKeys.every(key => typeof key === 'string') && Array.isArray(value.mediaIds) && value.mediaIds.every(id => typeof id === 'string') ? value : undefined
}
function documentExtraRows(data: InspectionData | RepairData): [string, string][] {
  const rows: [string, string][] = []
  const assessment = 'assessment' in data ? assessmentRecord(data.assessment) : undefined
  if (typeof data.isUnderWarranty === 'boolean') rows.push(['保固判定', data.isUnderWarranty ? '保固內' : '保固外'])
  if (assessment?.schema === 1) {
    rows.push(['原因', CONCLUSIONS[assessment.conclusion]], ['判斷依據', assessment.basis])
    if ('diagnosis' in data && assessment.causalExplanation !== data.diagnosis) rows.push(['因果說明', assessment.causalExplanation])
    rows.push(['關鍵測項', assessment.checkKeys.map(key => data.checks.find(check => check.key === key)?.name || key).join('、')], ['關鍵影像', assessment.mediaIds.join('、')])
  } else if (typeof data.isAccidentalDamage === 'boolean') rows.push(['人為損壞判定', data.isAccidentalDamage ? '是' : '否'])
  if (data.templateBinding) rows.push(['檢測基準', `${data.templateBinding.id} · v${data.templateBinding.revision}`])
  if ('materialPlan' in data && data.materialPlan) {
    rows.push(['材料需求', MATERIAL_MODES[data.materialPlan.mode]])
    for (const material of data.materialPlan.lines) rows.push([`需求材料：${material.name || material.sku || material.productId}`, `${material.requiredQuantity} · ${material.requiredForStart ? '開工前備妥' : '後續需用'}`])
  }
  if (data.customerVisibleSummary !== undefined) rows.push(['顧客摘要草稿', data.customerVisibleSummary])
  if (data.customerReportDraft) rows.push(['顧客草稿：發現的問題', data.customerReportDraft.findings], ['顧客草稿：實際處置', data.customerReportDraft.handling], ['顧客草稿：複驗結果', data.customerReportDraft.verification])
  if (data.mediaRefs?.length) rows.push(['工作單媒體索引', data.mediaRefs.map(ref => `${ref.mediaId} · ${ref.phase}${ref.checkKey ? ` · ${ref.checkKey}` : ''}`).join('\n')])
  return rows
}

function measuredAssessmentCheck(checks: InspectionData['checks'], keys: string[], template: RepairTemplateView | undefined, binding: InspectionData['templateBinding']): boolean {
  if (!template || !binding || binding.id !== template.id || binding.revision !== template.revision || binding.contentHash !== template.contentHash) return false
  return keys.some(key => {
    const check = checks.find(value => value.key === key), spec = template.checks.find(value => value.key === key)
    if (!check || !spec || check.name !== spec.name || !['PASS', 'FAIL'].includes(check.result) || !check.observation?.trim()) return false
    if (spec.requiresCalibration && (!check.instrumentId?.trim() || !check.calibrationRecordId?.trim() || !check.measuredAt || !Number.isFinite(Date.parse(check.measuredAt)))) return false
    if (spec.standard.kind === 'BOOLEAN') return typeof check.measurementValue === 'boolean'
    return spec.standard.kind === 'NUMBER' && typeof check.measurementValue === 'string' && /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(check.measurementValue) && Number.isFinite(Number(check.measurementValue)) && check.unit === spec.standard.unit
  })
}
function checkMeasurement(check: InspectionData['checks'][number]): string {
  const measured = typeof check.measurementValue === 'boolean' ? check.measurementValue ? '是' : '否' : check.measurementValue || ''
  return [measured ? `${measured}${check.unit ? ` ${check.unit}` : ''}` : '', check.instrumentId ? `設備 ${check.instrumentId}` : '', check.calibrationRecordId ? `校正 ${check.calibrationRecordId}` : '', check.measuredAt || ''].filter(Boolean).join(' · ')
}

function DocumentHeading({ document, title, inspection = false, showTitle = true }: { document?: RepairDocument | null; title: string; inspection?: boolean; showTitle?: boolean }) {
  return <div className="repair-document-heading">
    <Space wrap className="repair-document-identity">
      {showTitle && <Typography.Text strong>{title}</Typography.Text>}
      {document ? <>
        <Typography.Text>{document.number} · 文件 v{document.revision}</Typography.Text>
        <Tag color={document.status === 'SUBMITTED' ? 'green' : 'default'}>{document.status === 'SUBMITTED' ? '已提交' : '草稿'}</Tag>
        {document.inspectionRevision != null && <Tag>依檢修單 v{document.inspectionRevision}</Tag>}
      </> : <Tag>尚未建立</Tag>}
    </Space>
    {document && <div className="repair-document-meta">
      <Typography.Text type="secondary">{document.authorName} · {date(document.updatedAt)}</Typography.Text>
      {inspection && <Space wrap>
        <Tag color={inspectionReviewCurrent(document) ? document.review?.decision==='DECLINE'?'orange':'green' : 'orange'}>{inspectionReviewCurrent(document) ? `客服${document.review?.decision==='DECLINE'?'拒修':'確認'}檢修 v${document.revision}` : '目前方案待客服確認'}</Tag>
        {document.review && <Typography.Text type="secondary">{`${document.review.name} · 確認檢修 v${document.review.inspectionRevision} · ${date(document.review.confirmedAt)}${inspectionReviewCurrent(document) ? '' : '（非目前已提交版次）'}`}</Typography.Text>}
      </Space>}
    </div>}
  </div>
}

function DocumentSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="repair-document-section" aria-label={title}>
    <div className="repair-document-section-heading">
      <Typography.Title level={5}>{title}</Typography.Title>
    </div>
    <div className="repair-document-section-body">{children}</div>
  </section>
}

function CheckFields({ editable, passing = false, title = '檢測項目', template, phase = 'INSPECTION' }: { editable: boolean; passing?: boolean; title?: string; template?: RepairTemplateView; phase?: 'INSPECTION' | 'COMPLETION' }) {
  const form = Form.useFormInstance()
  const checkedValues = Form.useWatch('checks', form) as InspectionData['checks'] | undefined
  return <Form.List name="checks" rules={[{ validator: (_, value) => Array.isArray(value) && value.length > 0 ? Promise.resolve() : Promise.reject(new Error('請至少填寫一項檢測')) }]}>
    {(fields, { add, remove }, { errors }) => <>
      {fields.map((field, index) => {
        const spec = template?.checks.find(check => check.key === form.getFieldValue(['checks', field.name, 'key']))
        const required = !!spec && (phase === 'INSPECTION' ? spec.requiredForInspection : spec.requiredForCompletion)
        const measured = phase === 'COMPLETION' || checkedValues?.[field.name]?.result!=='NOT_TESTED'
        const measuredTextRules = measured ? requiredText() : []
        return <Card key={field.key} className="repair-document-check" size="small" title={spec?.name || `${title} ${index + 1}`} style={{ marginBottom: 12 }}
        extra={editable && !required ? <Button size="small" type="text" danger onClick={() => remove(field.name)}>移除</Button> : required ? <Tag>必測</Tag> : undefined}>
        <Form.Item name={[field.name, 'key']} hidden><Input /></Form.Item>
        <Row gutter={16}>
          <Col xs={24} sm={16}><Form.Item name={[field.name, 'name']} label="項目" rules={requiredText('請填寫測試項目名稱')}><Input maxLength={160} readOnly={!!spec} /></Form.Item></Col>
          <Col xs={24} sm={8}><Form.Item name={[field.name, 'result']} label="結果" rules={[{ required: true }, ...(passing ? [{ validator: (_: unknown, value: string) => value === 'PASS' ? Promise.resolve() : Promise.reject(new Error('總複驗通過時，此項也必須通過')) }] : [])]}>
            <Select options={options(RESULTS)} />
          </Form.Item></Col>
        </Row>
        {spec && <Typography.Paragraph type="secondary">{spec.standard.instruction}{spec.standard.kind === 'NUMBER' ? ` · ${spec.standard.min || '—'}～${spec.standard.max || '—'} ${spec.standard.unit}` : ''}</Typography.Paragraph>}
        {spec?.standard.kind === 'NUMBER' && <Row gutter={12}>
          <Col xs={24} sm={16}><Form.Item name={[field.name, 'measurementValue']} label="實際量測值" rules={[{ required: measured, message: '請填寫實際量測值' }, { pattern: /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/, message: '量測值格式不符' }]}><Input inputMode="decimal" maxLength={20} /></Form.Item></Col>
          <Col xs={24} sm={8}><Form.Item name={[field.name, 'unit']} label="單位"><Input readOnly /></Form.Item></Col>
        </Row>}
        {spec?.standard.kind === 'BOOLEAN' && <Form.Item name={[field.name, 'measurementValue']} label="實際功能結果" rules={[{ required: measured, type: 'boolean' }]}><Select options={[{ value: true, label: '是' }, { value: false, label: '否' }]} /></Form.Item>}
        {spec?.requiresCalibration && <Row gutter={12}>
          <Col xs={24} sm={8}><Form.Item name={[field.name, 'instrumentId']} label="設備編號" rules={measuredTextRules}><Input maxLength={128} /></Form.Item></Col>
          <Col xs={24} sm={8}><Form.Item name={[field.name, 'calibrationRecordId']} label="校正紀錄" rules={measuredTextRules}><Input maxLength={128} /></Form.Item></Col>
          <Col xs={24} sm={8}><Form.Item name={[field.name, 'measuredAt']} label="量測時間" rules={measuredTextRules}><Input maxLength={40} /></Form.Item></Col>
        </Row>}
        <Form.Item name={[field.name, 'observation']} label="觀察" rules={requiredText('請填觀察或未測原因')}><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>
      </Card>})}
      <Form.ErrorList errors={errors} />
      {editable && !template && <Button block type="dashed" disabled={fields.length >= 50} onClick={() => add(blankCheck())} style={{ marginBottom: 20 }}>新增項目</Button>}
    </>}
  </Form.List>
}

function CheckTable({ checks }: { checks: InspectionData['checks'] }) {
  return <Table size="small" rowKey="_rowKey" pagination={false} dataSource={checks.map((check, index) => ({ ...check, _rowKey: index }))} columns={[
    { title: '檢測項目', dataIndex: 'name' },
    { title: '結果', dataIndex: 'result', render: (value: keyof typeof RESULTS) => RESULTS[value] || value },
    { title: '觀察結果／未測原因', dataIndex: 'observation' },
    ...(checks.some(check => check.measurementValue !== undefined || check.instrumentId) ? [{ title: '量測紀錄', render: (_: unknown, check: InspectionData['checks'][number]) => checkMeasurement(check) }] : []),
  ]} />
}

function SavedDocument({ document, kind, customerRepair }: { document: RepairDocument; kind: 'inspection' | 'repair'; customerRepair: boolean }) {
  const data = document.data
  const details = kind === 'inspection' ? (() => {
    const inspection = data as InspectionData
    return [
      ['客訴／故障描述', inspection.complaint], ['故障重現', REPRODUCTION[inspection.reproduction]],
      ['測試條件', inspection.testConditions], ['原因確定度', CAUSES[inspection.causeStatus]],
      ['診斷', inspection.diagnosis], ['建議處理', PLANS[inspection.plan]],
      ...(inspection.plan === 'REPLACE' ? [['方案替換品 SKU', inspection.replacementSku], ['方案替換品品況', inspection.replacementCondition ? CONDITIONS[inspection.replacementCondition] : '未填']] : []),
      ['方案說明', inspection.planNote],
      ['費用建議', (customerRepair ? FEES : INTERNAL_FEES)[inspection.feeSuggestion]], ['內部估價', inspection.estimateAmount ?? '未填'], ['估價項目', inspection.estimateNote],
    ]
  })() : (() => {
    const repair = data as RepairData
    return [
      ['實際處置', OUTCOMES[repair.outcome]], ['施工／替換內容', repair.workPerformed], ['工時（分鐘）', repair.laborMinutes],
      ...(repair.outcome === 'FACTORY_REPAIRED' ? [['原廠委修單號', repair.factoryReference]] : []),
      ['依據檢修版次', document.inspectionRevision != null ? `v${document.inspectionRevision}` : '未綁定；不可據此交付'],
      ['總複驗', RESULTS[repair.qcResult]], ['複驗說明', repair.qcNotes], ['交付配件', repair.deliveredAccessories],
      ...(repair.outcome === 'REPLACED' ? [
        ['替換件品況', repair.replacementCondition ? CONDITIONS[repair.replacementCondition] : '未填'],
        ['替換 SKU', repair.replacementSku], ['替換 SN', repair.replacementSerial], ['替換來源', repair.replacementSource],
        ['原件去向', repair.originalDisposition], ['庫存關聯（不等於出庫完成）', repair.inventoryReference],
      ] : []),
    ]
  })()
  details.push(...documentExtraRows(data))
  return <div>
    <DocumentHeading document={document} title={kind === 'inspection' ? '檢修單' : '維修單'} inspection={kind === 'inspection' && customerRepair} />
    <Descriptions column={1} size="small" bordered items={details.map(([label, value], index) => ({ key: index, label, children: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value === '' || value == null ? '—' : value}</span> }))} />
    <div style={{ marginTop: 16 }}><CheckTable checks={data.checks || []} /></div>
    {kind === 'repair' && <Table style={{ marginTop: 16 }} size="small" pagination={false}
      dataSource={((data as RepairData).parts || []).map((part, index) => ({ ...part, key: index }))}
      columns={[{ title: '實際零件', dataIndex: 'name' }, { title: 'SKU', dataIndex: 'sku' }, { title: '數量', dataIndex: 'quantity' }]} />}
  </div>
}

function printDocument(item: RepairItem, kind: 'inspection' | 'repair', message: RepairMessage) {
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
  fields.push(...documentExtraRows(data))
  let parts = ''
  if (kind === 'inspection') {
    const inspection = data as InspectionData
    fields.push(
      ...(customerRepair ? [
        ['ERP 客服方案確認', inspectionReviewCurrent(document) ? `${document.review?.decision==='DECLINE'?'拒修':'確認'}本版（檢修 v${document.revision}）` : '本版尚未確認'],
        ['關聯售後報價版次', document.review?.quoteRevision ? `v${document.review.quoteRevision}` : '未關聯'],
        ['客服確認紀錄', document.review ? `${document.review.name} · 檢修 v${document.review.inspectionRevision} · ${date(document.review.confirmedAt)}` : '尚無紀錄'],
      ] as [string, unknown][] : []),
      ['客訴／故障描述', inspection.complaint], ['故障重現', REPRODUCTION[inspection.reproduction]], ['測試條件', inspection.testConditions],
      ['原因確定度', CAUSES[inspection.causeStatus]], ['診斷', inspection.diagnosis], ['建議處理', PLANS[inspection.plan]],
      ...(inspection.plan==='REPLACE'?[['方案替換品 SKU',inspection.replacementSku],['方案替換品品況',inspection.replacementCondition?CONDITIONS[inspection.replacementCondition]:'未填']] as [string,unknown][]:[]),
      ['方案說明', inspection.planNote], ['費用建議', (customerRepair ? FEES : INTERNAL_FEES)[inspection.feeSuggestion]], ['內部估價', inspection.estimateAmount ?? '未填'], ['估價項目', inspection.estimateNote],
    )
  } else {
    const repair = data as RepairData
    fields.push(
      ['依據檢修版次', document.inspectionRevision != null ? `v${document.inspectionRevision}` : '未綁定；不可據此交付'],
      ['目前檢修版次', item.repairInspection ? `v${item.repairInspection.revision}` : '尚未建立'],
      ['實際處置', OUTCOMES[repair.outcome]], ['實際施工／替換內容', repair.workPerformed], ['工時（分鐘）', repair.laborMinutes],
      ['總複驗', RESULTS[repair.qcResult]], ['複驗說明', repair.qcNotes], ['交付配件', repair.deliveredAccessories],
      ...(repair.outcome === 'FACTORY_REPAIRED' ? [['原廠委修單號', repair.factoryReference]] as [string, unknown][] : []),
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
  printable.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escape(document.number)} ${title}</title><style>@page{margin:16mm}body{font:14px sans-serif;color:#172534}h1{font-size:22px}p{line-height:1.6}table{width:100%;border-collapse:collapse;margin:16px 0;table-layout:fixed}th,td{border:1px solid #a9b6c4;padding:8px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eef2f6}tr{break-inside:avoid}.label{width:25%}</style></head><body><h1>${title}</h1><table>${fields.map(([label, value]) => `<tr><th class="label">${escape(label)}</th><td>${escape(value)}</td></tr>`).join('')}</table><h2>逐項檢測／複驗</h2><table><thead><tr><th>項目</th><th>結果</th><th>觀察／量測／未測原因</th><th>量測紀錄</th></tr></thead><tbody>${(data.checks || []).map(check => `<tr><td>${escape(check.name)}</td><td>${escape(RESULTS[check.result])}</td><td>${escape(check.observation)}</td><td>${escape(checkMeasurement(check))}</td></tr>`).join('')}</tbody></table>${parts}</body></html>`)
  printable.document.close()
  printable.focus()
  printable.print()
}

export default function RepairDocuments({ item, entityId, onSaved, onDirtyChange, onBeforeSave, feedback }: { item: RepairItem; entityId: string; onSaved: () => void; onDirtyChange?: (dirty: boolean) => void; onBeforeSave?: () => Promise<boolean>; feedback?: RepairMessage }) {
  const { modal, message, contextHolder } = useRepairFeedback(feedback)
  const { user } = useAuth()
  const customerRepair = item.receipt.category === 'REPAIR'
  const [inspectionForm] = Form.useForm<InspectionData>()
  const [repairForm] = Form.useForm<RepairData>()
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const [activeTab,setActiveTab]=useState(() => ['REPAIRING', 'REFURBISHING'].includes(item.status)
    || !!item.repairReport && ['WAITING_RETURN_ACCEPTANCE', 'READY_FOR_DISPATCH', 'DISPATCHED', 'PENDING_WELFARE_STOCK', 'STOCKED'].includes(item.status) ? 'repair' : 'inspection')
  const pendingMedia=useRef({inspection:false,repair:false})
  const dirtyForms=useRef({inspection:false,repair:false})
  const [inspectionEditedVersion, setInspectionEditedVersion] = useState<number>()
  const markDirty=(kind:'inspection'|'repair')=>{dirtyForms.current[kind]=true;if(kind==='inspection')setInspectionEditedVersion(item.version);onDirtyChange?.(true)}
  const [selectedRequiresSerial, setSelectedRequiresSerial] = useState(!!item.serialNumber || !!item.repairReport?.data.replacementSerial)
  const saving = useRef(false)
  const operation = useRef<{ body: string; requestId: string } | null>(null)
  const ownSigned = item.editable === true && !!user?.id && item.repairOwnerId === user.id && item.custodianId === user.id && hasPermission(user, 'repair_workbench:update')
  const canInspect = ownSigned && INSPECTION_STAGES.includes(item.status)
  const canReport = ownSigned && REPORT_STAGES.includes(item.status) && (['REPAIR', 'REPLACE'].includes(item.repairInspection?.data.plan || '') || item.repairInspection?.data.plan === 'FACTORY' && item.repairWorkflow?.factory?.stage === 'RETURNED' && item.repairWorkflow.factory.physicalCustody === 'TECHNICIAN')
  const providedTemplate = item.repairPrerequisites?.template
  const template = providedTemplate?.status === 'REVIEWED' && providedTemplate.entityId === entityId && providedTemplate.productId === item.productId && providedTemplate.sku === item.sku ? providedTemplate : undefined
  const templateBinding = template ? { id: template.id, revision: template.revision, contentHash: template.contentHash } : undefined
  const templateChecks = template?.checks.map(check => ({ key: check.key, name: check.name, result: 'NOT_TESTED' as const, observation: '', ...(check.standard.unit ? { unit: check.standard.unit } : {}) }))
  const providedRepairTemplate = item.repairInspection?.data.plan==='REPLACE' ? item.repairPrerequisites?.repairTemplate : template
  const repairTemplate = providedRepairTemplate?.status==='REVIEWED' && providedRepairTemplate.entityId===entityId && providedRepairTemplate.sku===(item.repairInspection?.data.plan==='REPLACE'?item.repairInspection.data.replacementSku:item.sku) ? providedRepairTemplate : undefined
  const repairTemplateBinding = repairTemplate ? {id:repairTemplate.id,revision:repairTemplate.revision,contentHash:repairTemplate.contentHash} : undefined
  const repairTemplateChecks = repairTemplate?.checks.map(check=>({key:check.key,name:check.name,result:'NOT_TESTED' as const,observation:'',...(check.standard.unit?{unit:check.standard.unit}:{})}))
  const inspectionInitial: InspectionData = { ...(item.repairInspection?.data || {
    complaint: '', reproduction: 'NOT_TESTED', testConditions: '', checks: [blankCheck()],
    diagnosis: '', causeStatus: 'UNKNOWN', plan: 'REPAIR', planNote: '', feeSuggestion: 'REVIEW', estimateNote: '',
    ...(templateBinding ? { templateBinding, checks: templateChecks! } : {}),
  }), protocol: 2, materialPlan: item.repairInspection?.data.materialPlan || { mode: 'UNASSESSED', lines: [] }, mediaRefs: item.repairInspection?.data.mediaRefs || [] }
  const savedAssessment = assessmentRecord(item.repairInspection?.data.assessment)
  inspectionInitial.assessment = savedAssessment?.schema === 1 ? { ...savedAssessment, checkKeys: [...savedAssessment.checkKeys], mediaIds: [...savedAssessment.mediaIds] } : {
    schema: 1, conclusion: 'UNDETERMINED', basis: '', causalExplanation: inspectionInitial.diagnosis, checkKeys: [], mediaIds: [],
  }
  if (savedAssessment?.schema === 1 && savedAssessment.causalExplanation) inspectionInitial.diagnosis = savedAssessment.causalExplanation
  const repairInitial: RepairData = { ...(item.repairReport?.data || {
    outcome: item.repairInspection?.data.plan === 'REPLACE' ? 'REPLACED' : item.repairInspection?.data.plan === 'FACTORY' ? 'FACTORY_REPAIRED' : 'REPAIRED', factoryReference: item.repairWorkflow?.factory?.reference, replacementSku:item.repairInspection?.data.replacementSku, replacementCondition:item.repairInspection?.data.replacementCondition, workPerformed: '',
    parts: [], laborMinutes: 0, checks: [blankCheck()], qcResult: 'NOT_TESTED', qcNotes: '', deliveredAccessories: '',
    ...(repairTemplateBinding ? { templateBinding:repairTemplateBinding, checks: repairTemplateChecks! } : {}),
  }), protocol: 2, mediaRefs: item.repairReport?.data.mediaRefs || [], customerReportDraft: item.repairReport?.data.customerReportDraft || { findings: '', handling: '', verification: '', mediaIds: [] } }
  const plan = Form.useWatch('plan', inspectionForm) || inspectionInitial.plan
  const fee = Form.useWatch('feeSuggestion', inspectionForm) || inspectionInitial.feeSuggestion
  const outcome = Form.useWatch('outcome', repairForm) || repairInitial.outcome
  const qc = Form.useWatch('qcResult', repairForm) || repairInitial.qcResult
  const assessment = Form.useWatch('assessment', { form: inspectionForm, preserve: true }) as RepairAssessment | undefined
  const conclusion = assessment?.conclusion || inspectionInitial.assessment.conclusion
  const assessmentValues = assessment || inspectionInitial.assessment
  const showAssessmentDetails = conclusion !== 'UNDETERMINED' || typeof assessmentValues.basis === 'string' && !!assessmentValues.basis.trim() || (assessmentValues.checkKeys?.length || 0) > 0 || (assessmentValues.mediaIds?.length || 0) > 0
  const legacyReadonly = !canInspect && !!item.repairInspection && !savedAssessment
  const inspectionChecks = (Form.useWatch('checks', inspectionForm) || inspectionInitial.checks) as InspectionData['checks']
  const inspectionMedia = (Form.useWatch('mediaRefs', { form: inspectionForm, preserve: true }) || inspectionInitial.mediaRefs || []) as NonNullable<InspectionData['mediaRefs']>
  const checkOptions = inspectionChecks.filter(check => check.key && inspectionChecks.filter(value => value.key === check.key).length === 1).map(check => ({ value: check.key!, label: check.name }))
  const mediaOptions = inspectionMedia.filter(ref => ['BEFORE', 'DIAGNOSTIC'].includes(ref.phase) && (!ref.checkKey || assessment?.checkKeys?.includes(ref.checkKey))).map((ref, index) => ({ value: ref.mediaId, label: item.repairPrerequisites?.mediaAssets?.find(asset => asset.mediaId === ref.mediaId)?.fileName || `${MEDIA_PHASES[ref.phase]}影像 ${index + 1}` }))
  const review = item.repairWorkflow?.assessmentReview
  const recordedReview = review?.schema === 1 && Number.isInteger(review.inspectionRevision) && review.inspectionRevision > 0 && typeof review.planHash === 'string' && /^[a-f0-9]{64}$/.test(review.planHash)
    && typeof review.reviewerId === 'string' && !!review.reviewerId.trim() && typeof review.reviewerName === 'string' && !!review.reviewerName.trim() && ['APPROVE', 'REVISE'].includes(review.decision)
    && typeof review.note === 'string' && !!review.note.trim() && typeof review.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(review.reviewedAt)
    && Number.isFinite(Date.parse(review.reviewedAt)) && Date.parse(review.reviewedAt) <= Date.now() && new Date(review.reviewedAt).toISOString() === review.reviewedAt
  const currentReview = recordedReview && review && !dirtyForms.current.inspection && inspectionEditedVersion !== item.version && item.repairInspection?.status === 'SUBMITTED' && savedAssessment?.conclusion === 'USER_CAUSED'
    && typeof item.repairInspection.authorId === 'string' && !!item.repairInspection.authorId.trim() && typeof item.repairOwnerId === 'string' && !!item.repairOwnerId.trim()
    && review.inspectionRevision === item.repairInspection.revision && review.reviewerId.trim() !== item.repairInspection.authorId.trim() && review.reviewerId.trim() !== item.repairOwnerId.trim()
    && item.repairWorkflow?.csr?.inspectionRevision === item.repairInspection.revision && item.repairWorkflow.csr.estimateRevision === item.repairInspection.revision && item.repairWorkflow.csr.planHash === review.planHash
  const applyTemplate = (form: FormInstance, selected:RepairTemplateView|undefined=template) => {
    if (!selected) return
    const apply = () => { form.setFieldsValue({ templateBinding:{id:selected.id,revision:selected.revision,contentHash:selected.contentHash}, checks:selected.checks.map(check=>({key:check.key,name:check.name,result:'NOT_TESTED',observation:'',...(check.standard.unit?{unit:check.standard.unit}:{})})) }); markDirty(form===inspectionForm?'inspection':'repair') }
    if ((form.getFieldValue('checks') || []).some((check: InspectionData['checks'][number]) => check.observation?.trim() || check.measurementValue !== undefined || check.instrumentId?.trim() || check.calibrationRecordId?.trim() || check.measuredAt?.trim() || check.result && check.result !== 'NOT_TESTED')) modal.confirm({ title: '套用目前檢測基準？', content: '目前表單的檢測內容將重新填寫。', okText: '套用', cancelText: '取消', onOk: apply })
    else apply()
  }

  async function save(kind: 'inspection' | 'repair', status: 'DRAFT' | 'SUBMITTED') {
    const editable = kind === 'inspection' ? canInspect : canReport
    if (!editable || saving.current) return
    if(pendingMedia.current[kind]){setFailure('影像尚未上傳');return}
    const form = (kind === 'inspection' ? inspectionForm : repairForm) as FormInstance
    saving.current = true
    setBusy(`${kind}:${status}`)
    setFailure('')
    let saved = false
    try {
      if (onBeforeSave && !await onBeforeSave()) return
      if (status === 'SUBMITTED') await form.validateFields()
      const otherForm = kind === 'inspection' ? repairForm : inspectionForm
      if (otherForm.isFieldsTouched() || dirtyForms.current[kind==='inspection'?'repair':'inspection'] || pendingMedia.current[kind==='inspection'?'repair':'inspection']) {
        const discard = await new Promise<boolean>(resolve => modal.confirm({
          title: `另一張${kind === 'inspection' ? '維修單' : '檢修單'}有未保存修改`,
          content: '保存本單後會重新載入案件，另一張未保存的修改會遺失。您可以取消，返回整理或保存草稿。',
          okText: '保存本單並放棄另一張修改', cancelText: '取消，保留草稿',
          onOk: () => { resolve(true) }, onCancel: () => { resolve(false) }, maskClosable: false,
        }))
        if (!discard) return
      }
      const values = form.getFieldsValue(true)
      const checks = (values.checks || []).map((check: InspectionData['checks'][number]) => ({ name: textValue(check.name), result: check.result || 'NOT_TESTED', observation: textValue(check.observation),
        ...(check.key ? { key: textValue(check.key) } : {}), ...(typeof check.measurementValue === 'string' || typeof check.measurementValue === 'boolean' ? { measurementValue: check.measurementValue } : {}),
        ...Object.fromEntries((['unit', 'instrumentId', 'calibrationRecordId', 'measuredAt'] as const).filter(key => check[key] !== undefined).map(key => [key, textValue(check[key])])),
      }))
      const extras: RepairDocumentV2Fields = { protocol: 2,
        ...(typeof values.isUnderWarranty === 'boolean' ? { isUnderWarranty: values.isUnderWarranty } : {}),
        ...(kind === 'repair' && typeof values.isAccidentalDamage === 'boolean' ? { isAccidentalDamage: values.isAccidentalDamage } : {}),
        ...(values.customerVisibleSummary !== undefined ? { customerVisibleSummary: textValue(values.customerVisibleSummary) } : {}),
        ...(values.templateBinding ? { templateBinding: values.templateBinding } : {}),
        mediaRefs: (values.mediaRefs || []).map((ref: NonNullable<RepairDocumentV2Fields['mediaRefs']>[number]) => ({ mediaId: ref.mediaId, phase: ref.phase, ...(ref.checkKey ? { checkKey: ref.checkKey } : {}) })),
        ...(values.customerReportDraft ? { customerReportDraft: { findings: textValue(values.customerReportDraft.findings), handling: textValue(values.customerReportDraft.handling), verification: textValue(values.customerReportDraft.verification), mediaIds: values.customerReportDraft.mediaIds || [] } } : {}),
      }
      const assessmentConclusion: RepairAssessment['conclusion'] = Object.hasOwn(CONCLUSIONS, values.assessment?.conclusion || '') ? values.assessment.conclusion : 'UNDETERMINED'
      const newAssessment: RepairAssessment = { schema: 1, conclusion: assessmentConclusion, basis: textValue(values.assessment?.basis), causalExplanation: textValue(values.diagnosis),
        checkKeys: Array.isArray(values.assessment?.checkKeys) ? [...values.assessment.checkKeys] : [], mediaIds: Array.isArray(values.assessment?.mediaIds) ? [...values.assessment.mediaIds] : [] }
      const data: InspectionData | RepairData = kind === 'inspection' ? {
        ...extras, assessment: newAssessment, materialPlan: materialPlanPayload(values.materialPlan),
        complaint: textValue(values.complaint), reproduction: values.reproduction || 'NOT_TESTED',
        testConditions: textValue(values.testConditions), checks, diagnosis: textValue(values.diagnosis),
        causeStatus: assessmentConclusion === 'UNDETERMINED' ? values.causeStatus === 'SUSPECTED' ? 'SUSPECTED' : 'UNKNOWN' : 'CONFIRMED',
        ...(assessmentConclusion !== 'UNDETERMINED' ? { isAccidentalDamage: assessmentConclusion === 'USER_CAUSED' } : {}),
        plan: values.plan || 'REPAIR', ...(values.plan === 'REPLACE' ? {replacementCondition: values.replacementCondition, replacementSku:textValue(values.replacementSku)} : {}), planNote: textValue(values.planNote), feeSuggestion: values.feeSuggestion || 'REVIEW',
        ...(typeof values.estimateAmount === 'number' ? { estimateAmount: values.estimateAmount } : {}), estimateNote: textValue(values.estimateNote),
      } : {
        ...extras,
        outcome: values.outcome || 'REPAIRED', workPerformed: textValue(values.workPerformed),
        parts: (values.parts || []).map((part: RepairData['parts'][number]) => ({ name: textValue(part.name), sku: textValue(part.sku), quantity: typeof part.quantity === 'number' ? part.quantity : 1 })),
        laborMinutes: typeof values.laborMinutes === 'number' ? values.laborMinutes : 0, checks, qcResult: values.qcResult || 'NOT_TESTED',
        qcNotes: textValue(values.qcNotes), deliveredAccessories: textValue(values.deliveredAccessories),
        ...(values.outcome === 'FACTORY_REPAIRED' ? {factoryReference:textValue(values.factoryReference)} : {}),
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
      dirtyForms.current={inspection:false,repair:false}
      onDirtyChange?.(false)
      await onSaved()
      message.success(status === 'DRAFT' ? '草稿已儲存' : kind === 'inspection' ? '檢修單已提交' : '維修單已提交')
    } catch (error) {
      const fields = (error as { errorFields?: { name: (string | number)[] }[] })?.errorFields
      if (fields?.length) form.scrollToField(fields[0].name)
      else setFailure(saved ? '文件已儲存，重新載入失敗。' : errorText(error))
    } finally { saving.current = false; setBusy(null) }
  }

  const buttons = (kind: 'inspection' | 'repair', editable: boolean) => editable ? <div className="repair-document-actions"><Space wrap>
    <Button disabled={!!busy} loading={busy === `${kind}:DRAFT`} onClick={() => void save(kind, 'DRAFT')}>儲存草稿</Button>
    <Button type="primary" disabled={!!busy} loading={busy === `${kind}:SUBMITTED`} onClick={() => void save(kind, 'SUBMITTED')}>提交{kind === 'inspection' ? '檢修單' : '維修單'}</Button>
  </Space></div> : null

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

  return <div className="repair-documents">
    {contextHolder}
    {failure && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={failure} />}
    <Tabs activeKey={activeTab} onChange={setActiveTab} tabBarExtraContent={<Typography.Text type="secondary" className="repair-document-case-version">案件 v{item.version}</Typography.Text>} items={[
      { key: 'inspection', label: '檢修單', forceRender: true, children: <>
        <div className="repair-document-toolbar">
          <DocumentHeading document={item.repairInspection} title="檢修單" inspection={customerRepair} showTitle={false} />
          <div className="repair-document-heading-actions"><Button icon={<PrinterOutlined />} disabled={!item.repairInspection || !!busy} onClick={() => printDocument(item, 'inspection', message)}>列印</Button></div>
        </div>
        <Form name={`repair-inspection-${item.id}`} form={inspectionForm} layout="vertical" initialValues={inspectionInitial} onValuesChange={() => markDirty('inspection')} disabled={!canInspect || !!busy}>
          <DocumentSection title="收件核對">
          <Form.Item name="complaint" label="顧客問題" rules={requiredText()}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
          </DocumentSection>
          <DocumentSection title="重現問題">
          <Form.Item name="reproduction" label="重現結果" rules={[{ required: true }]}><Select options={options(REPRODUCTION)} /></Form.Item>
          <Form.Item name="testConditions" label="測試條件" rules={requiredText()}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
          </DocumentSection>
          <DocumentSection title="核心檢查">
          <Tag>{template ? `${template.sku} · 檢測基準 v${template.revision}` : '檢測基準待確認'}</Tag>
          {template && canInspect && <Button size="small" disabled={!!busy} onClick={() => applyTemplate(inspectionForm)} style={{ marginBottom: 12 }}>套用檢測基準</Button>}
          <CheckFields editable={canInspect && !busy} template={template} />
          </DocumentSection>
          <DocumentSection title="判斷與佐證">
          <Form.Item name="causeStatus" hidden><Input /></Form.Item>
          {legacyReadonly ? <Descriptions size="small" column={1} items={[
            { key: 'cause', label: '原因確定度', children: CAUSES[item.repairInspection!.data.causeStatus] },
            ...(typeof item.repairInspection!.data.isAccidentalDamage === 'boolean' ? [{ key: 'legacy', label: '人為損壞判定', children: item.repairInspection!.data.isAccidentalDamage ? '是' : '否' }] : []),
          ]} /> : <Form.Item name={['assessment', 'conclusion']} label="原因" rules={[{ required: true }]}><Select options={options(CONCLUSIONS)} /></Form.Item>}
          {showAssessmentDetails && <Form.Item name={['assessment', 'basis']} label="判斷依據" rules={conclusion === 'UNDETERMINED' ? [] : requiredText('請填判斷依據')}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>}
          <Form.Item name="diagnosis" label="因果說明" rules={requiredText('請填因果說明或待確認原因')}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
          {showAssessmentDetails && <>
          <Form.Item name={['assessment', 'checkKeys']} label="關鍵測項" dependencies={['checks', ['assessment', 'conclusion']]} rules={[{ validator: (_, value) => {
            if (inspectionForm.getFieldValue(['assessment', 'conclusion']) === 'UNDETERMINED') return Promise.resolve()
            const selected = value as string[] | undefined, current = (inspectionForm.getFieldValue('checks') || []) as InspectionData['checks']
            return Array.isArray(selected) && selected.length > 0 && new Set(selected).size === selected.length && selected.every(key => current.filter(check => check.key === key && ['PASS', 'FAIL'].includes(check.result) && !!check.observation?.trim()).length === 1)
              ? Promise.resolve() : Promise.reject(new Error('請選已檢測的關鍵測項'))
          } }]}><Select mode="multiple" options={checkOptions} /></Form.Item>
          <Form.Item name={['assessment', 'mediaIds']} label="關鍵影像" dependencies={['checks', 'mediaRefs', 'templateBinding', ['assessment', 'checkKeys'], ['assessment', 'conclusion']]} rules={[{ validator: (_, value) => {
            const selected = Array.isArray(value) ? value as string[] : [], refs = (inspectionForm.getFieldValue('mediaRefs') || []) as NonNullable<InspectionData['mediaRefs']>, keys = (inspectionForm.getFieldValue(['assessment', 'checkKeys']) || []) as string[]
            const attached = selected.every(id => refs.some(ref => ref.mediaId === id && (!ref.checkKey || keys.includes(ref.checkKey))))
            if (!attached) return Promise.reject(new Error('請選本次測項的已掛影像'))
            const causalMedia = selected.some(id => refs.some(ref => ref.mediaId === id && ['BEFORE', 'DIAGNOSTIC'].includes(ref.phase)))
            if (inspectionForm.getFieldValue(['assessment', 'conclusion']) !== 'USER_CAUSED' || causalMedia) return Promise.resolve()
            return measuredAssessmentCheck(inspectionForm.getFieldValue('checks') || [], keys, template, inspectionForm.getFieldValue('templateBinding')) ? Promise.resolve() : Promise.reject(new Error('請選關鍵影像或留下實際量測'))
          } }]}><Select mode="multiple" options={mediaOptions} /></Form.Item>
          </>}
          {(conclusion === 'USER_CAUSED' || recordedReview) && <Space wrap style={{ marginBottom: 16 }} aria-label="佐證覆核">
            <Tag color={currentReview && review?.decision === 'APPROVE' ? 'green' : 'orange'}>佐證覆核 · {currentReview ? review?.decision === 'APPROVE' ? '覆核通過' : '退回補充' : '待覆核'}</Tag>
            {recordedReview && review && <Typography.Text type="secondary">{review.reviewerName} · {date(review.reviewedAt)}</Typography.Text>}
          </Space>}
          <Form.Item name="isUnderWarranty" label="保固"><Select allowClear options={[{ value: true, label: '保固內' }, { value: false, label: '保固外' }]} /></Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item name="plan" label="處理方式" rules={[{ required: true }]}><Select options={options(PLANS)} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="feeSuggestion" label="費用建議" rules={[{ required: true }]}><Select options={options(customerRepair ? FEES : INTERNAL_FEES)} /></Form.Item></Col>
          </Row>
          {plan === 'REPLACE' && <>
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item name="replacementSku" label="方案替換品 SKU" rules={requiredText('請先指定方案中顧客可確認的替換品 SKU')}><Input maxLength={100} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="replacementCondition" label="方案替換品品況" rules={[{required:true,message:'請選擇實際擬交付品況'}]}><Select options={options(CONDITIONS)} /></Form.Item></Col>
            </Row>
          </>}
          <Form.Item name="planNote" label="處理範圍" rules={requiredText()}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
          <Form.Item name="estimateAmount" label="估價" rules={[{ required: fee === 'PAID', type: 'number', min: fee === 'PAID' ? 0.01 : 0, max: 10000000, message: '付費建議需正數估價；金額最多 10,000,000' }]}><InputNumber min={0} max={10000000} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="estimateNote" label="估價項目" rules={fee === 'PAID' ? requiredText('付費建議請填寫估價項目') : []}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
          </DocumentSection>
          <RepairDocumentExtras form={inspectionForm} item={item} entityId={entityId} kind="inspection" active={activeTab==='inspection'} editable={canInspect && !busy} onDirtyChange={()=>markDirty('inspection')} onMediaPendingChange={pending=>{pendingMedia.current.inspection=pending}} />
          {buttons('inspection', canInspect)}
        </Form>
      </> },
      { key: 'repair', label: '維修單', forceRender: true, children: <>
        <div className="repair-document-toolbar">
          <DocumentHeading document={item.repairReport} title="維修單" showTitle={false} />
          <div className="repair-document-heading-actions"><Button icon={<PrinterOutlined />} disabled={!item.repairReport || !!busy} onClick={() => printDocument(item, 'repair', message)}>列印</Button></div>
        </div>
        {item.repairReport && item.repairReport.inspectionRevision !== item.repairInspection?.revision && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="維修單與目前檢修版次不一致" description="請依目前檢修版次重新提交維修單。" />}
        <Form name={`repair-report-${item.id}`} form={repairForm} layout="vertical" initialValues={repairInitial} onValuesChange={() => markDirty('repair')} disabled={!canReport || !!busy}>
          <DocumentSection title="修復與複驗">
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item name="outcome" label="實際處置" rules={[{ required: true }]}><Select options={options(OUTCOMES)} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="laborMinutes" label="實際工時（分鐘）" rules={[{ required: true, type: 'integer', min: 0, max: 100000 }]}><InputNumber min={0} max={100000} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="workPerformed" label="實際施工／替換內容" rules={requiredText()}><Input.TextArea rows={3} maxLength={4000} showCount /></Form.Item>
          {outcome === 'FACTORY_REPAIRED' && <>
            <Form.Item name="factoryReference" label="原廠委修單號（依送修紀錄）" rules={requiredText('請保留原廠送修時的同一委修单號')}><Input maxLength={200} readOnly /></Form.Item>
          </>}
          {outcome === 'REPLACED' && <>
            {canReport && !busy && <div style={{ marginBottom: 16 }}><RepairReplacementStock feedback={message} item={{...item,entityId}} onSelected={selection => {
              setSelectedRequiresSerial(!!item.serialNumber || selection.hasSerialNumbers === true)
              repairForm.setFieldsValue({ replacementSku: selection.sku, replacementCondition: selection.condition, replacementSerial: selection.serialNumber || '', replacementSource: selection.unitLabel, inventoryReference: selection.reservationId })
              markDirty('repair')
            }} onReleased={id => {
              if (repairForm.getFieldValue('inventoryReference') === id) {
                repairForm.setFieldsValue({ inventoryReference: '', replacementSource: '', replacementSerial: '' })
                markDirty('repair')
              }
            }} /></div>}
            <Form.Item name="replacementCondition" label="替換件品況" rules={[{ required: true, message: '請如實選擇全新品或複驗合格整新品' }]}><Select options={options(CONDITIONS)} /></Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item name="replacementSku" label="替換件 SKU" rules={requiredText()}><Input maxLength={100} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="replacementSerial" label="替換件 SN（無 SN 商品可留白）" rules={selectedRequiresSerial ? requiredText('此件需 SN 追溯，請填寫替換實物的真實 SN') : []}><Input maxLength={100} /></Form.Item></Col>
            </Row>
            <Form.Item name="replacementSource" label="替換件來源／複驗紀錄關聯" rules={requiredText()}><Input maxLength={200} /></Form.Item>
            <Form.Item name="originalDisposition" label={`原件去向（原件 SN：${item.serialNumber || '未提供'}）`} rules={requiredText()}><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>
            <Form.Item name="inventoryReference" label="庫存預留關聯"><Input maxLength={200} /></Form.Item>
          </>}
          </DocumentSection>
          <DocumentSection title="實際使用零件">
          <Form.List name="parts">{(fields, { add, remove }) => <>
            {fields.map((field, index) => <Card key={field.key} className="repair-document-part" size="small" title={`零件 ${index + 1}`} style={{ marginBottom: 12 }}
              extra={canReport && !busy ? <Button type="text" size="small" danger onClick={() => remove(field.name)}>移除</Button> : undefined}>
              <Row gutter={16}>
                <Col xs={24} sm={10}><Form.Item name={[field.name, 'name']} label="名稱" rules={requiredText()}><Input maxLength={160} /></Form.Item></Col>
                <Col xs={24} sm={9}><Form.Item name={[field.name, 'sku']} label="SKU／料件編號" rules={requiredText('有使用料件請填寫可追查編號；未編號可先保存草稿')}><Input maxLength={100} /></Form.Item></Col>
                <Col xs={24} sm={5}><Form.Item name={[field.name, 'quantity']} label="數量" rules={[{ required: true, type: 'number', min: 0.0001, max: 100000 }]}><InputNumber min={0.0001} max={100000} precision={4} style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
            </Card>)}
            {canReport && !busy && <Button block type="dashed" disabled={fields.length >= 50} onClick={() => add({ name: '', sku: '', quantity: 1 })} style={{ marginBottom: 20 }}>新增零件</Button>}
            {!fields.length && <Typography.Paragraph type="secondary">未登記零件</Typography.Paragraph>}
          </>}</Form.List>
          </DocumentSection>
          <DocumentSection title="修後複驗">
          <Tag>{repairTemplate?`${repairTemplate.sku} · 複驗基準 v${repairTemplate.revision}`:'複驗基準待確認'}</Tag>
          {repairTemplate && canReport && <Button size="small" disabled={!!busy} onClick={() => applyTemplate(repairForm,repairTemplate)} style={{ marginBottom: 12 }}>套用複驗基準</Button>}
          <CheckFields editable={canReport && !busy} passing={qc === 'PASS'} title="修後／替換件複驗項目" template={repairTemplate} phase="COMPLETION" />
          <Form.Item name="qcResult" label="總複驗結果" rules={[{ required: true }]}><Select options={options(RESULTS)} /></Form.Item>
          <Form.Item name="qcNotes" label="複驗說明與異常" rules={requiredText()}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
          <Form.Item name="deliveredAccessories" label="交付配件（沒有也請註明）" rules={requiredText()}><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>
          </DocumentSection>
          <RepairDocumentExtras form={repairForm} item={item} entityId={entityId} kind="repair" active={activeTab==='repair'} editable={canReport && !busy} onDirtyChange={()=>markDirty('repair')} onMediaPendingChange={pending=>{pendingMedia.current.repair=pending}} />
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
