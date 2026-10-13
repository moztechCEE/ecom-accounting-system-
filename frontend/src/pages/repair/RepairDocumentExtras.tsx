import { useState } from 'react'
import { Alert, Button, Col, Collapse, Form, Input, Modal, Row, Select, Space, Tag, Typography } from 'antd'
import type { FormInstance } from 'antd'
import type { CustomerRepairReportDraft, RepairDocumentMediaRef, RepairItem } from './repair-model'
import RepairEvidencePanel from './RepairEvidencePanel'
import RepairReportPanel from './RepairReportPanel'

const MATERIAL_MODES = [{ value: 'UNASSESSED', label: '待確認' }, { value: 'NONE', label: '無需材料' }, { value: 'REQUIRED', label: '需材料' }]
const PHASE = { BEFORE: '修前', AFTER: '修後', DIAGNOSTIC: '檢測' }
const quantityRule = (_: unknown, value: unknown) => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0 || Number(value) > 100000)
    return Promise.reject(new Error('請填大於零、最多兩位小數的材料數量'))
  return Promise.resolve()
}

export function RepairMaterialPlanFields({ form, item, editable }: { form: FormInstance; item: RepairItem; editable: boolean }) {
  const mode = Form.useWatch(['materialPlan', 'mode'], form) || 'UNASSESSED'
  const catalog = item.repairPrerequisites?.materialCatalog
  return <>
    <Form.Item name={['materialPlan', 'mode']} label="材料需求" rules={[{ validator: (_, value) => value==='REQUIRED' && !catalog ? Promise.reject(new Error('材料品項尚未載入')) : ['NONE', 'REQUIRED'].includes(value) ? Promise.resolve() : Promise.reject(new Error('請確認材料需求')) }]}>
      <Select options={MATERIAL_MODES} onChange={value => { if (value !== 'REQUIRED') form.setFieldValue(['materialPlan', 'lines'], []) }} />
    </Form.Item>
    {mode === 'REQUIRED' && <>
      {!catalog && <Alert type="warning" message="材料品項尚未載入" style={{ marginBottom: 12 }} />}
      <Form.List name={['materialPlan', 'lines']} rules={[{ validator: (_, lines) => lines?.length ? Promise.resolve() : Promise.reject(new Error('請填寫必要材料')) }]}>
        {(fields, { add, remove }, { errors }) => <>
          {fields.map(field => {
            const stored = form.getFieldValue(['materialPlan', 'lines', field.name]);
            const products = catalog?.products.map(product => ({ value: product.id, label: `${product.name} · ${product.sku}`, disabled: false })) || [];
            const warehouses = catalog?.warehouses.map(warehouse => ({ value: warehouse.id, label: `${warehouse.name} · ${warehouse.code}`, disabled: false })) || [];
            if (stored?.productId && !products.some(product => product.value===stored.productId)) products.push({value:stored.productId,label:stored.name || stored.sku || '材料品項待確認',disabled:true});
            if (stored?.warehouseId && !warehouses.some(warehouse=>warehouse.value===stored.warehouseId)) warehouses.push({value:stored.warehouseId,label:'材料倉位待確認',disabled:true});
            return <div key={field.key} style={{ marginBottom: 12 }}>
            <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
            <Row gutter={12}>
              <Col xs={24} sm={10}><Form.Item name={[field.name, 'productId']} label="材料品項" rules={[{ validator:(_,id)=>catalog?.products.some(product=>product.id===id)?Promise.resolve():Promise.reject(new Error('請選擇有效材料品項')) }]}><Select showSearch optionFilterProp="label" options={products} onChange={id => {
                const product = catalog?.products.find(value => value.id === id)
                if (product) form.setFields([{ name: ['materialPlan', 'lines', field.name, 'sku'], value: product.sku }, { name: ['materialPlan', 'lines', field.name, 'name'], value: product.name }])
              }} /></Form.Item></Col>
              <Col xs={24} sm={8}><Form.Item name={[field.name, 'warehouseId']} label="材料倉位" rules={[{ validator:(_,id)=>catalog?.warehouses.some(warehouse=>warehouse.id===id)?Promise.resolve():Promise.reject(new Error('請選擇有效材料倉位')) }]}><Select options={warehouses} /></Form.Item></Col>
              <Col xs={24} sm={6}><Form.Item name={[field.name, 'requiredQuantity']} label="需求數量" rules={[{ validator: quantityRule }]}><Input inputMode="decimal" maxLength={10} /></Form.Item></Col>
            </Row>
            <Space align="start"><Form.Item name={[field.name, 'requiredForStart']} label="開工前備妥" rules={[{ required: true, type: 'boolean' }]}><Select style={{ minWidth: 120 }} options={[{ value: true, label: '需要' }, { value: false, label: '後續需用' }]} /></Form.Item>
              {editable && <Button danger type="text" onClick={() => remove(field.name)}>移除材料</Button>}</Space>
          </div>})}
          <Form.ErrorList errors={errors} />
          {editable && <Button disabled={fields.length >= 50 || !catalog} onClick={() => add({ id: crypto.randomUUID(), requiredQuantity: '', requiredForStart: true })}>新增材料</Button>}
        </>}
      </Form.List>
    </>}
  </>
}

export function RepairDocumentExtras({ form, item, entityId, kind, editable, active=true,onDirtyChange,onMediaPendingChange }: { form: FormInstance; item: RepairItem; entityId:string;kind: 'inspection' | 'repair'; editable: boolean;active?:boolean;onDirtyChange?:()=>void;onMediaPendingChange?:(pending:boolean)=>void }) {
  const [preview, setPreview] = useState<CustomerRepairReportDraft>()
  const [mediaOpen,setMediaOpen]=useState(false)
  const [mediaPending,setMediaPending]=useState(false)
  const refs = Form.useWatch('mediaRefs', {form,preserve:true}) as RepairDocumentMediaRef[] | undefined
  const assets = (item.repairPrerequisites?.mediaAssets || []).filter(asset=>asset.kind===kind)
  return <>
    <Collapse style={{ marginBottom: 16 }} onChange={keys=>setMediaOpen((Array.isArray(keys)?keys:[keys]).includes('media'))} items={[
      ...(kind === 'inspection' ? [{ key: 'materials', label: '材料需求', forceRender: true, children: <RepairMaterialPlanFields form={form} item={item} editable={editable} /> }] : []),
      { key: 'customer', label: item.receipt.category === 'RETURN' ? '整新摘要紀錄' : '顧客報告草稿', forceRender: true, children: <>
        <Form.Item name="customerVisibleSummary" label={item.receipt.category === 'RETURN' ? '作業摘要' : '顧客摘要'}><Input.TextArea maxLength={2000} rows={3} showCount /></Form.Item>
        <>
          <Form.Item name={['customerReportDraft', 'findings']} label="發現的問題"><Input.TextArea maxLength={2000} rows={2} /></Form.Item>
          <Form.Item name={['customerReportDraft', 'handling']} label="處置說明"><Input.TextArea maxLength={2000} rows={2} /></Form.Item>
          <Form.Item name={['customerReportDraft', 'verification']} label="複驗結果摘要"><Input.TextArea maxLength={2000} rows={2} /></Form.Item>
          {(refs?.length || 0) > 0 && <Form.Item name={['customerReportDraft', 'mediaIds']} label="草稿選用媒體"><Select mode="multiple" options={(refs || []).map((ref,index) => ({ value: ref.mediaId, label: assets.find(asset => asset.mediaId === ref.mediaId)?.fileName || `${PHASE[ref.phase]}影像 ${index+1}` }))} /></Form.Item>}
          <Button disabled={false} onClick={() => setPreview(form.getFieldValue('customerReportDraft') || { findings: '', handling: '', verification: '', mediaIds: [] })}>預覽草稿</Button>
        </>
        {item.receipt.category === 'REPAIR' && <RepairReportPanel form={form} item={item} entityId={entityId} kind={kind} mediaPending={mediaPending} />}
      </> },
      { key: 'media', label: '工作單媒體', children: <RepairEvidencePanel form={form} item={item} entityId={entityId} kind={kind} editable={editable} active={active && mediaOpen} onDirtyChange={onDirtyChange} onPendingChange={pending=>{setMediaPending(pending);onMediaPendingChange?.(pending)}} /> },
    ]} />
    <Modal title={<Space>{item.receipt.category === 'RETURN' ? '整新摘要預覽' : '顧客報告預覽'}<Tag>草稿</Tag></Space>} open={!!preview} onCancel={() => setPreview(undefined)} footer={<Button onClick={() => setPreview(undefined)}>關閉</Button>}>
      {preview && <>{[['發現的問題', preview.findings], ['實際處置', preview.handling], ['複驗結果', preview.verification]].map(([label, value]) => <section key={label}><Typography.Text strong>{label}</Typography.Text><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{value || '未填'}</Typography.Paragraph></section>)}</>}
    </Modal>
  </>
}
