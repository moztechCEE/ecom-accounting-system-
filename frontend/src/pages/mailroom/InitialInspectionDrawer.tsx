import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, Drawer, Empty, Form, Input, Select, Space, Spin, Tag, Typography } from 'antd';
import { mailroomReceiving, type PrecheckSave, type PrecheckStart } from '../../services/mailroom-receiving';
import { CATEGORIES, errorText } from './model';
import { PRECHECK_RESULTS, PRECHECK_STAGES, precheckValidation, precheckValues, precheckHandoffBlocker, type PrecheckRead, type PrecheckValues, type PrecheckHandoff, type PrecheckHandoffResult } from './initial-inspection-model';
import { mailroomDraftFingerprint, type MailroomDraftState } from './mailroom-draft';
import type { RepairMessage } from '../repair/repair-feedback';
import ReceiptPhotoInput from './ReceiptPhotoInput';

type Operation = { kind: 'start'; body: PrecheckStart } | { kind: 'save'; itemId: string; body: PrecheckSave } | { kind: 'handoff'; body: PrecheckHandoff };
export default function InitialInspectionDrawer({ entityId, itemIds, open, feedback, guardChange, onDraftChange, onClose, onSaved }: {
  entityId: string; itemIds: string[]; open: boolean; feedback: RepairMessage;
  guardChange: (change: () => void) => void; onDraftChange: (draft: MailroomDraftState) => void;
  onClose: () => void; onSaved: () => void;
}) {
  const [form] = Form.useForm<PrecheckValues>();
  const [records, setRecords] = useState<PrecheckRead[]>([]), [activeId, setActiveId] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [templateId, setTemplateId] = useState<string>(), [handoffResult, setHandoffResult] = useState<PrecheckHandoffResult>();
  const generation = useRef(0), baseline = useRef(''), working = useRef(false), reading = useRef(false), unknown = useRef(false), operation = useRef<Operation | undefined>(undefined);
  const idsKey = JSON.stringify(itemIds);
  const record = records.find(row => row.itemId === activeId);
  const values = Form.useWatch([], form) as PrecheckValues | undefined;
  const publish = useCallback(() => onDraftChange({ dirty: unknown.current || baseline.current !== mailroomDraftFingerprint(form.getFieldsValue(true)), busy: working.current || reading.current, uncertain: unknown.current }), [form, onDraftChange]);
  const apply = useCallback((next: PrecheckRead) => {
    const data = precheckValues(next); form.resetFields(); form.setFieldsValue(data); baseline.current = mailroomDraftFingerprint(data);
    setTemplateId((next.selectedTemplate || next.template.template)?.id); onDraftChange({ dirty: false, busy: false });
  }, [form, onDraftChange]);
  const load = useCallback(async () => {
    const scope = ++generation.current; setLoading(true); setError('');
    try {
      const result = await Promise.all((JSON.parse(idsKey) as string[]).map(id => mailroomReceiving.item(entityId, id)));
      if (generation.current !== scope) return;
      setRecords(result); setActiveId(previous => result.some(row => row.itemId === previous) ? previous : result[0]?.itemId || '');
      return result;
    } catch (e) { if (generation.current === scope) setError(errorText(e)); }
    finally { if (generation.current === scope) setLoading(false); }
  }, [entityId, idsKey]);
  const cancelReads = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    if (open) { operation.current = undefined; unknown.current = false; working.current = false; reading.current = false; setUncertain(false); setBusy(false); setPhotoBusy(false); setHandoffResult(undefined); setRecords([]); setActiveId(''); void load(); }
    return () => { cancelReads(); onDraftChange({ dirty: false, busy: false }); };
  }, [open, load, onDraftChange, cancelReads]);
  useEffect(() => { if (record) apply(record); }, [record, apply]);
  async function execute(next: Operation) {
    if (working.current || reading.current) return;
    if (next.kind === 'handoff' && !unknown.current) setHandoffResult(undefined);
    const scope = generation.current; operation.current = next; working.current = true; setBusy(true); setError(''); publish();
    let succeeded = false;
    try {
      let result: PrecheckHandoffResult | undefined;
      if (next.kind === 'start') await mailroomReceiving.start(next.body);
      else if (next.kind === 'handoff') result = await mailroomReceiving.handoff(next.body);
      else await mailroomReceiving.save(next.itemId, next.body);
      if (generation.current !== scope) return;
      if (next.kind === 'handoff' && result) {
        if (result.requestId !== next.body.requestId || !Array.isArray(result.items) || result.items.length !== next.body.items.length || new Set(result.items.map(row => row.itemId)).size !== next.body.items.length || result.items.some(row => !['APPLIED', 'FAILED', 'UNKNOWN'].includes(row.status) || !next.body.items.some(part => part.itemId === row.itemId && part.requestId === row.requestId))) throw new Error('Invalid handoff receipt');
        setHandoffResult(result); onSaved();
        if (result.items.some(row => row.status === 'UNKNOWN')) {
          unknown.current = true; setUncertain(true); setError('部分交辦結果尚未確認，請重試原交辦。'); return;
        }
      }
      succeeded = true; operation.current = undefined; unknown.current = false; setUncertain(false);
      onDraftChange({ dirty: false, busy: false }); if (next.kind === 'handoff') {
        const applied = result!.items.filter(row => row.status === 'APPLIED').length;
        if (applied) feedback.success(`已交維修部門 ${applied} 件`);
      } else { feedback.success(next.kind === 'start' ? '已建立初檢草稿' : next.body.status === 'READY' ? '已完成初檢' : '已儲存初檢草稿'); onSaved(); }
    } catch (e) {
      if (generation.current !== scope) return;
      const status = (e as { response?: { status?: number } }).response?.status;
      unknown.current = !status || status >= 500; setUncertain(unknown.current);
      if (!unknown.current) operation.current = undefined;
      setError(errorText(e));
    } finally {
      if (generation.current === scope) { working.current = false; setBusy(false); publish(); }
    }
    if (succeeded) await load();
  }
  function start() {
    const pending = records.filter(row => !row.document || row.stage === 'STALE');
    const blocked = pending.find(row => !row.capabilities.canStart);
    if (blocked) { setError(`${blocked.label}：${blocked.capabilities.reason || '目前不能建立初檢'}`); return; }
    if (!pending.length) return;
    void execute({ kind: 'start', body: { entityId, requestId: crypto.randomUUID(), items: pending.map(row => ({ itemId: row.itemId, expectedVersion: row.itemVersion, requestId: crypto.randomUUID() })) } });
  }
  async function save(ready: boolean, changeTemplate = false) {
    if (!record?.document || working.current || reading.current) return;
    const data = form.getFieldsValue(true) as PrecheckValues;
    const selected = changeTemplate ? record.availableTemplates?.find(row => row.id === templateId) : record.selectedTemplate || record.template.template;
    const problem = changeTemplate ? undefined : precheckValidation(record, data, ready);
    if (problem) { setError(problem); return; }
    void execute({ kind: 'save', itemId: record.itemId, body: {
      entityId, requestId: crypto.randomUUID(), expectedVersion: record.itemVersion, expectedRevision: record.document.revision,
      status: ready ? 'READY' : 'DRAFT', templateBinding: selected ? { id: selected.id, revision: selected.revision, contentHash: selected.contentHash } : null,
      checks: changeTemplate ? [] : data.checks || [], evidence: data.evidence || [], ...(changeTemplate ? {} : { notRequiredReason: data.notRequiredReason }),
    } });
  }
  function handoff() {
    const problem = precheckHandoffBlocker(records);
    if (problem) { setError(problem); return; }
    const pending = records.filter(row => row.document?.status !== 'SUBMITTED');
    void execute({ kind: 'handoff', body: { entityId, requestId: crypto.randomUUID(), items: pending.map(row => ({ itemId: row.itemId, requestId: crypto.randomUUID(), expectedVersion: row.itemVersion, precheckRevision: row.document!.revision, precheckHash: row.document!.contentHash!, identityHash: row.document!.identityHash })) } });
  }
  const pendingHandoff = records.filter(row => row.document?.status !== 'SUBMITTED');
  const handoffBlocker = precheckHandoffBlocker(records);
  const localEdits = baseline.current !== mailroomDraftFingerprint(values || form.getFieldsValue(true));
  const blockedStart = records.find(row => (!row.document || row.stage === 'STALE') && !row.capabilities.canStart);
  const locked = busy || photoBusy || uncertain || loading;
  const editable = !!record?.document && record.capabilities.canSave;
  const chosenTemplate = record?.availableTemplates?.find(row => row.id === templateId);
  const savedBinding = record?.document?.templateBinding;
  const templateChanged = !!chosenTemplate && (!savedBinding || chosenTemplate.id !== savedBinding.id || chosenTemplate.revision !== savedBinding.revision || chosenTemplate.contentHash !== savedBinding.contentHash);
  function navigate(id: string) { guardChange(() => { setActiveId(id); setError(''); }); }
  return <Drawer title="收發初檢" rootClassName="mailroom-precheck-drawer" open={open} width="min(820px, 100vw)" onClose={() => guardChange(onClose)} destroyOnHidden footer={<Space wrap>
    {uncertain ? <Button type="primary" loading={busy} onClick={() => operation.current && void execute(operation.current)}>{operation.current?.kind === 'handoff' ? '重試原交辦' : '重試原保存'}</Button> : <>
      {records.some(row => !row.document || row.stage === 'STALE') && <Button type="primary" disabled={locked || !!blockedStart} onClick={start}>建立初檢草稿</Button>}
      {editable && <><Button disabled={locked} onClick={() => void save(false)}>儲存草稿</Button><Button type="primary" disabled={locked || !record?.capabilities.canMarkReady} onClick={() => void save(true)}>完成初檢</Button></>}
      {pendingHandoff.some(row => row.category === "REPAIR") && <Button disabled={locked || localEdits || templateChanged || !!handoffBlocker} onClick={handoff}>交維修部門{pendingHandoff.length > 1 ? `（${pendingHandoff.length} 件）` : ""}</Button>}
    </>}
    <Button disabled={busy || photoBusy} onClick={() => guardChange(onClose)}>關閉</Button>
  </Space>}>
    {blockedStart && records.length > 1 && <Alert type="warning" message={`${blockedStart.label}：${blockedStart.capabilities.reason || "目前不能建立初檢"}`} />}
    <Spin spinning={loading}>
      {records.length > 1 && <div className="mailroom-precheck-navigation"><Select aria-label="選擇初檢實物" value={activeId} disabled={locked} onChange={navigate} options={records.map(row => ({ value: row.itemId, label: `${row.label}${row.productName ? ` · ${row.productName}` : ''} · ${PRECHECK_STAGES[row.stage] || row.stage}` }))} />
        <Space><Button disabled={locked || records[0]?.itemId === activeId} onClick={() => navigate(records[records.findIndex(row => row.itemId === activeId) - 1].itemId)}>上一件</Button><Button disabled={locked || records.at(-1)?.itemId === activeId} onClick={() => navigate(records[records.findIndex(row => row.itemId === activeId) + 1].itemId)}>下一件</Button></Space></div>}
      {record ? <>
        <Descriptions size="small" column={1} items={[{ key: 'item', label: '實物', children: record.label }, ...(record.productName ? [{ key: 'product', label: '實收產品', children: [record.productName, record.sku, record.serialNumber ? `SN ${record.serialNumber}` : null].filter(Boolean).join(' · ') }] : []), { key: 'location', label: '存放位置', children: record.custody.location }, { key: 'kind', label: '類型', children: CATEGORIES[record.category] || record.category }, { key: 'stage', label: '初檢', children: <Tag>{PRECHECK_STAGES[record.stage] || record.stage}</Tag> }, ...(record.document ? [{ key: 'version', label: '最近編輯', children: `${record.document.savedByName} · v${record.document.revision} · ${new Date(record.document.savedAt).toLocaleString('zh-TW')}` }] : [])]} />
        {(record.capabilities.reason || record.template.state === "PRODUCT_UNBOUND") && <Alert type="warning" message={record.capabilities.reason || record.template.reason || "請先核對實物產品主檔"} />}
        {record.document && <Form form={form} layout="vertical" disabled={locked || !editable} onValuesChange={publish}>
          {!!record.availableTemplates?.length && <div className="mailroom-precheck-template"><Select aria-label="初檢表" placeholder="選擇初檢表" value={templateId} disabled={locked || !editable} onChange={setTemplateId} options={record.availableTemplates.map(row => ({ value: row.id, label: row.title }))} /><Button disabled={locked || !editable || !templateChanged} onClick={() => void save(false, true)}>套用初檢表</Button></div>}
          <Form.List name="checks">{fields => fields.map(field => {
            const definition = record.template.template?.checks.find(row => row.key === values?.checks?.[field.name]?.key);
            const check = values?.checks?.[field.name]; const label = definition?.label || check?.key || '';
            return <Card className="mailroom-precheck-check" key={field.key} size="small" title={<>{label}{definition?.required && <Typography.Text type="secondary"> · 必檢</Typography.Text>}</>}>
              <Form.Item name={[field.name, 'key']} hidden><Input /></Form.Item>
              <Form.Item name={[field.name, 'result']} label={`${label}結果`}><Select aria-label={`${label}結果`} options={Object.entries(PRECHECK_RESULTS).map(([value, text]) => ({ value, label: text }))} /></Form.Item>
              <Form.Item name={[field.name, 'note']} label={`${label}說明`}><Input.TextArea aria-label={`${label}說明`} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
              {check?.result === 'ABNORMAL' && <Form.Item name={[field.name, 'evidenceIndexes']} label={`${label}異常照片`}><Checkbox.Group options={(values?.evidence || []).map((photo, index) => ({ value: index, label: <span className="mailroom-precheck-photo-choice"><img src={photo} alt={`初檢照片 ${index + 1}`} />照片 {index + 1}</span> }))} /></Form.Item>}
            </Card>;
          })}</Form.List>
          {record.template.state === "UNCONFIGURED" && <Form.Item name="notRequiredReason" label="不需初檢原因"><Input.TextArea maxLength={2000} autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>}
          <Form.Item name="evidence" label="本件初檢照片"><ReceiptPhotoInput photoLabel="初檢照片" disabled={busy || uncertain || loading || !editable} onBusyChange={value => { reading.current = value; setPhotoBusy(value); publish(); }} onChange={photos => {
            form.setFieldValue('evidence', photos);
            form.setFieldValue('checks', (form.getFieldValue('checks') || []).map((check: PrecheckValues['checks'][number]) => ({ ...check, evidenceIndexes: [] })));
            publish();
          }} /></Form.Item>
        </Form>}
        {!record.document && !record.capabilities.canStart && <Empty description="此物件目前不能建立初檢" />}
      </> : !loading && !error ? <Empty description="未選擇實物" /> : null}
    </Spin>
    {handoffResult && <div className="mailroom-handoff-results" aria-label="逐件交辦結果">{handoffResult.items.map(result => <div key={result.itemId}><Tag color={result.status === 'APPLIED' ? 'green' : 'orange'}>{result.status === 'APPLIED' ? '已交維修部門' : result.status === 'FAILED' ? '未交辦' : '結果未確認'}</Tag><span>{records.find(row => row.itemId === result.itemId)?.label || result.itemId}</span>{result.message && <Typography.Text type="secondary"> · {result.message}</Typography.Text>}</div>)}</div>}
    {!uncertain && handoffBlocker && pendingHandoff.some(row => row.document?.status === 'READY') && <Alert type="warning" message={handoffBlocker} />}
    {uncertain && <Alert type="warning" message={operation.current?.kind === 'handoff' ? '交辦結果尚未確認' : '保存結果尚未確認'} description={operation.current?.kind === 'handoff' ? '請重試原交辦。逐件請求已鎖定。' : '請重試原保存。欄位與照片已鎖定。'} />}
    {error && <Alert type="error" message={error} action={!uncertain && <Button disabled={busy || photoBusy} onClick={() => guardChange(() => void load())}>重新讀取</Button>} />}
  </Drawer>;
}
