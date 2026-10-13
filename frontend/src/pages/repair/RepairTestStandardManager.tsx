import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Col, DatePicker, Empty, Form, Input, Row, Select, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import api from '../../services/api';
import { errorText } from '../mailroom/model';
import { useRepairFeedback } from './repair-feedback';
import type { RepairMessage } from './repair-feedback';

export type RepairManagedProduct = { id: string; name: string; sku: string };
export type RepairRegistryTransport = {
  get(path: string, options: { params: { entityId: string; productId: string } }): Promise<{ data: unknown }>;
  post(path: string, body: unknown): Promise<{ data: unknown }>;
};
export type RepairTestStandardManagerProps = {
  entityId: string; product: RepairManagedProduct | null; canManage: boolean;
  onChanged?: () => void | Promise<void>; onBusyChange?: (busy: boolean) => void; feedback?: RepairMessage; transport?: RepairRegistryTransport;
};
type StandardCheck = {
  key: string; name: string; requiredForInspection: boolean; requiredForCompletion: boolean;
  requiresCalibration: boolean; equipmentType?: string;
  standard: { kind: 'OBSERVATION' | 'NUMBER' | 'BOOLEAN'; instruction: string; unit?: string; min?: string; max?: string; expected?: boolean };
};
type Definition = { modelNumber?: string; checks: StandardCheck[] };
type StandardRow = {
  id: string; entityId: string; productId: string; sku: string; revision: number;
  status: 'DRAFT' | 'REVIEWED' | 'RETIRED'; data: Definition; contentHash: string;
  reviewedAt: string | null; reviewedById: string | null;
};
type CalibrationRow = {
  id: string; entityId: string; instrumentId: string; equipmentType: string; proofReference: string;
  status: 'VALID' | 'REVOKED'; validFrom: string; validUntil: string;
};
type Registry = { standards: StandardRow[]; calibrations: CalibrationRow[] };
type StandardForm = Definition & { productId: string };
type CalibrationForm = { instrumentId: string; equipmentType: string; proofReference: string; validFrom: Dayjs; validUntil: Dayjs };
const path = '/repair-workbench/test-registry';
const standardStatus = { DRAFT: '草稿', REVIEWED: '已審核', RETIRED: '已停用' };
const yesNo = [{ value: true, label: '是' }, { value: false, label: '否' }];
const kindOptions = [{ value: 'OBSERVATION', label: '觀察' }, { value: 'NUMBER', label: '數值' }, { value: 'BOOLEAN', label: '功能' }];
const required = [{ required: true, whitespace: true, message: '請填寫此項' }];
const booleanRules = [{ required: true, type: 'boolean' as const, message: '請明確選擇是或否' }];
const decimalPattern = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const blankCheck = () => ({ key: '', name: '', standard: { instruction: '' } });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
class RegistryInputError extends Error {}
const invalid = (message: string): never => { throw new RegistryInputError(message); };
const text = (value: unknown, max = 128): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483646;
function decimal(value: unknown): bigint {
  if (typeof value !== 'string' || !decimalPattern.test(value)) return invalid('上下限須為最多六位小數的數值字串');
  const sign = value.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return sign * (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0')));
}
function definition(value: unknown): Definition {
  if (!object(value) || !Array.isArray(value.checks) || !value.checks.length || value.checks.length > 50 ||
    value.modelNumber !== undefined && value.modelNumber !== '' && !text(value.modelNumber, 160)) return invalid('請完成檢測標準');
  const keys = new Set<string>();
  const checks = value.checks.map(row => {
    if (!object(row) || !text(row.key) || keys.has(row.key) || !text(row.name, 160) || typeof row.requiredForInspection !== 'boolean' ||
      typeof row.requiredForCompletion !== 'boolean' || typeof row.requiresCalibration !== 'boolean' || !object(row.standard))
      return invalid('測項代碼、名稱、條件與必測階段須完整且不可重複');
    keys.add(row.key);
    const raw = row.standard;
    if (!text(raw.instruction, 2000)) return invalid('請填寫實際測試條件');
    const instruction = raw.instruction;
    let standard: StandardCheck['standard'];
    if (raw.kind === 'NUMBER') {
      const min = raw.min === undefined || raw.min === '' ? undefined : raw.min;
      const max = raw.max === undefined || raw.max === '' ? undefined : raw.max;
      if (!text(raw.unit, 30) || min === undefined && max === undefined) return invalid('數值測項須填單位及至少一個上下限');
      const low = min === undefined ? undefined : decimal(min), high = max === undefined ? undefined : decimal(max);
      if (low !== undefined && high !== undefined && low > high) return invalid('下限不得高於上限');
      standard = { kind: 'NUMBER', instruction, unit: raw.unit,
        ...(min !== undefined ? { min: min as string } : {}), ...(max !== undefined ? { max: max as string } : {}) };
    } else if (raw.kind === 'BOOLEAN') {
      if (typeof raw.expected !== 'boolean') return invalid('功能測項須選擇預期結果');
      standard = { kind: 'BOOLEAN', instruction, expected: raw.expected };
    } else if (raw.kind === 'OBSERVATION') standard = { kind: 'OBSERVATION', instruction };
    else return invalid('請選擇測項判定方式');
    if (row.requiresCalibration && !text(row.equipmentType, 100)) return invalid('請填寫校正設備類型');
    return { key: row.key, name: row.name, requiredForInspection: row.requiredForInspection, requiredForCompletion: row.requiredForCompletion,
      requiresCalibration: row.requiresCalibration, ...(row.requiresCalibration ? { equipmentType: row.equipmentType as string } : {}), standard };
  });
  return { ...(value.modelNumber ? { modelNumber: value.modelNumber as string } : {}), checks };
}
function iso(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = new Date(value), day = new Date(value.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10);
}
function calibration(value: unknown, now = Date.now()) {
  if (!object(value) || !text(value.instrumentId) || !text(value.equipmentType, 100) || !text(value.proofReference, 500) ||
    !iso(value.validFrom) || !iso(value.validUntil) || Date.parse(value.validFrom) > now || Date.parse(value.validUntil) <= Date.parse(value.validFrom))
    return invalid('請核對校正設備、證明與有效期間');
  return { instrumentId: value.instrumentId, equipmentType: value.equipmentType, proofReference: value.proofReference,
    validFrom: value.validFrom, validUntil: value.validUntil };
}
function registry(value: unknown, entityId: string, productId: string): Registry {
  if (!object(value) || !Array.isArray(value.standards) || !Array.isArray(value.calibrations)) return invalid('檢測標準服務尚未就緒');
  const standards = value.standards.map(row => {
    if (!object(row) || !text(row.id) || row.entityId !== entityId || row.productId !== productId || !text(row.sku, 100) ||
      !revision(row.revision) || typeof row.status !== 'string' || !['DRAFT', 'REVIEWED', 'RETIRED'].includes(row.status) ||
      typeof row.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.contentHash) ||
      row.status === 'REVIEWED' && (!text(row.reviewedById) || !iso(row.reviewedAt)))
      return invalid('檢測標準與目前產品不符');
    return { id: row.id, entityId, productId, sku: row.sku, revision: row.revision, status: row.status as StandardRow['status'],
      data: definition(row.data), contentHash: row.contentHash,
      reviewedAt: typeof row.reviewedAt === 'string' ? row.reviewedAt : null, reviewedById: typeof row.reviewedById === 'string' ? row.reviewedById : null };
  });
  const calibrations = value.calibrations.map(row => {
    if (!object(row) || !text(row.id) || row.entityId !== entityId || !text(row.instrumentId) || !text(row.equipmentType, 100) ||
      !text(row.proofReference, 500) || row.status !== 'VALID' && row.status !== 'REVOKED' || !iso(row.validFrom) || !iso(row.validUntil))
      return invalid('校正證明資料不完整');
    return { id: row.id, entityId, instrumentId: row.instrumentId, equipmentType: row.equipmentType, proofReference: row.proofReference,
      status: row.status as CalibrationRow['status'], validFrom: row.validFrom, validUntil: row.validUntil };
  });
  if (new Set(standards.map(row => row.id)).size !== standards.length || new Set(calibrations.map(row => row.id)).size !== calibrations.length)
    return invalid('檢測標準記錄不唯一');
  return { standards, calibrations };
}
function receipt(value: unknown, status: string, id?: string, expectedRevision?: number) {
  if (!object(value) || !text(value.id) || value.status !== status || id !== undefined && value.id !== id ||
    expectedRevision !== undefined && value.revision !== expectedRevision || value.duplicate !== undefined && typeof value.duplicate !== 'boolean' ||
    status === 'REVIEWED' && (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)))
    return invalid('服務回執不完整，請重新載入');
}
const defaultTransport: RepairRegistryTransport = { get: (url, options) => api.get(url, options), post: (url, body) => api.post(url, body) };
const time = (value: string) => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
const headerCell = (width: number) => () => ({ style: { minWidth: width, whiteSpace: 'nowrap' as const } });
const problem = (error: unknown) => error instanceof RegistryInputError ? error.message : errorText(error);

export default function RepairTestStandardManager({ entityId, product, canManage, onChanged, onBusyChange, feedback, transport = defaultTransport }: RepairTestStandardManagerProps) {
  const { modal, message, contextHolder } = useRepairFeedback(feedback);
  const [snapshot, setSnapshot] = useState<Registry>();
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [editing, setEditing] = useState(false), [calibrationOpen, setCalibrationOpen] = useState(false);
  const [draftBase, setDraftBase] = useState<{ id: string; revision: number } | null>(null);
  const [standardForm] = Form.useForm<StandardForm>(), [calibrationForm] = Form.useForm<CalibrationForm>();
  const checks = Form.useWatch('checks', standardForm) as StandardCheck[] | undefined;
  const generation = useRef(0), running = useRef(false);
  const operation = useRef<{ key: string; requestId: string } | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const productId = product?.id || '', sku = product?.sku || '';
  const bound = text(entityId) && text(productId) && text(sku, 100) && !!product?.name.trim();
  const refresh = useCallback(async () => {
    if (!canManage || !entityId || !productId || !sku) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const value = registry((await transport.get(path, { params: { entityId, productId } })).data, entityId, productId);
      if (request === generation.current) { setSnapshot(value); setFailure(''); }
    } catch (error) {
      if (request === generation.current) { setSnapshot(undefined); setFailure(problem(error)); }
      throw error;
    } finally { if (request === generation.current) setLoading(false); }
  }, [canManage, entityId, productId, sku, transport]);
  useEffect(() => {
    const requests = generation;
    setSnapshot(undefined); setEditing(false); setCalibrationOpen(false); setFailure('');
    standardForm.resetFields(); calibrationForm.resetFields();
    if (bound && canManage) void refresh().catch(() => undefined);
    return () => { requests.current++; };
  }, [bound, canManage, refresh, standardForm, calibrationForm]);
  const current = snapshot?.standards.filter(row => row.sku === sku).sort((a, b) => b.revision - a.revision)[0];
  const writable = canManage && bound && !!snapshot && !loading && !busy;
  async function mutate(url: string, body: Record<string, unknown>, expectedStatus: string, id?: string, expectedRevision?: number) {
    if (!writable || running.current) return;
    running.current = true; setBusy(true); onBusyChange?.(true); setFailure('');
    let saved = false;
    try {
      const key = JSON.stringify({ url, entityId, body });
      if (operation.current?.key !== key) operation.current = { key, requestId: crypto.randomUUID() };
      receipt((await transport.post(url, { entityId, requestId: operation.current.requestId, ...body })).data, expectedStatus, id, expectedRevision);
      saved = true;
      await onChanged?.();
      await refresh();
      setEditing(false); setCalibrationOpen(false);
      standardForm.resetFields(); calibrationForm.resetFields();
      message.success('已儲存');
    } catch (error) { setFailure(saved ? '已儲存，資料暫無法重新載入。' : problem(error)); }
    finally { running.current = false; setBusy(false); onBusyChange?.(false); }
  }
  function openDraft() {
    if (!writable) return;
    setDraftBase(current ? { id: current.id, revision: current.revision } : null);
    standardForm.setFieldsValue({ productId, ...(current?.data ? structuredClone(current.data) : { modelNumber: '', checks: [blankCheck()] as unknown as StandardCheck[] }) });
    setEditing(true); setFailure('');
  }
  async function saveDraft(values: StandardForm) {
    try {
      const data = definition(values);
      await mutate(draftBase ? path + '/standards/' + encodeURIComponent(draftBase.id) + '/revisions' : path + '/standards',
        draftBase ? { expectedRevision: draftBase.revision, data } : { productId, sku, data }, 'DRAFT', undefined, (draftBase?.revision || 0) + 1);
    } catch (error) { setFailure(problem(error)); }
  }
  const decide = (row: StandardRow, action: 'review' | 'retire') => modal.confirm({
    title: (action === 'review' ? '審核檢測標準 v' : '停用檢測標準 v') + row.revision + '？',
    okText: action === 'review' ? '審核' : '停用', cancelText: '取消',
    onOk: () => mutate(path + '/standards/' + encodeURIComponent(row.id) + '/' + action,
      { expectedRevision: row.revision }, action === 'review' ? 'REVIEWED' : 'RETIRED', row.id, row.revision),
  });
  const standardContent = <>
    <Space wrap style={{ marginBottom: 12 }}><Button ref={node => { trigger.current = node; }} type={editing || current?.status === 'DRAFT' ? 'default' : 'primary'} disabled={!writable || editing || calibrationOpen} onClick={openDraft}>{current ? '新增版本' : '建立草稿'}</Button><Button disabled={loading || busy} onClick={() => void refresh().catch(() => undefined)}>重新載入</Button></Space>
    {editing && <Form form={standardForm} name="repair-standard-definition" layout="vertical" disabled={busy} onFinish={values => void saveDraft(values)} scrollToFirstError>
      <Form.Item name="productId" hidden><Input /></Form.Item>
      <Form.Item name="modelNumber" label="機種"><Input maxLength={160} /></Form.Item>
      <Form.List name="checks" rules={[{ validator: (_, values) => { try { definition({ checks: values }); return Promise.resolve(); } catch (error) { return Promise.reject(error); } } }]}>
        {(fields, { add, remove }, { errors }) => <>
          {fields.map((field, index) => {
            const check = checks?.[field.name], selectedKind = check?.standard?.kind;
            return <section key={field.key} aria-label={'測項 ' + (index + 1)} style={{ padding: '12px 0', borderTop: '1px solid #edf0f4' }}>
              <Space style={{ marginBottom: 8 }}><Typography.Text strong>{'測項 ' + (index + 1)}</Typography.Text><Button danger type="text" onClick={() => remove(field.name)}>移除測項</Button></Space>
              <Row gutter={12}><Col xs={24} sm={10}><Form.Item name={[field.name, 'key']} label="測項代碼" rules={required}><Input autoFocus={index === 0} maxLength={128} /></Form.Item></Col><Col xs={24} sm={14}><Form.Item name={[field.name, 'name']} label="測項名稱" rules={required}><Input maxLength={160} /></Form.Item></Col></Row>
              <Form.Item name={[field.name, 'standard', 'instruction']} label="測試條件" rules={required}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
              <Form.Item name={[field.name, 'standard', 'kind']} label="判定方式" rules={[{ required: true, message: '請選擇判定方式' }]}><Select options={kindOptions} /></Form.Item>
              {selectedKind === 'NUMBER' && <Row gutter={12}><Col xs={24} sm={8}><Form.Item name={[field.name, 'standard', 'unit']} label="單位" rules={required}><Input maxLength={30} /></Form.Item></Col>{(['min', 'max'] as const).map(key => <Col key={key} xs={24} sm={8}><Form.Item name={[field.name, 'standard', key]} label={key === 'min' ? '下限' : '上限'} rules={[{ pattern: decimalPattern, message: '請填最多六位小數的數值' }]}><Input inputMode="decimal" maxLength={20} /></Form.Item></Col>)}</Row>}
              {selectedKind === 'BOOLEAN' && <Form.Item name={[field.name, 'standard', 'expected']} label="預期結果" rules={booleanRules}><Select options={yesNo} /></Form.Item>}
              <Row gutter={12}><Col xs={24} sm={8}><Form.Item name={[field.name, 'requiredForInspection']} label="檢修必測" rules={booleanRules}><Select options={yesNo} /></Form.Item></Col><Col xs={24} sm={8}><Form.Item name={[field.name, 'requiredForCompletion']} label="複驗必測" rules={booleanRules}><Select options={yesNo} /></Form.Item></Col><Col xs={24} sm={8}><Form.Item name={[field.name, 'requiresCalibration']} label="使用校正設備" rules={booleanRules}><Select options={yesNo} /></Form.Item></Col></Row>
              {check?.requiresCalibration === true && <Form.Item name={[field.name, 'equipmentType']} label="設備類型" rules={required}><Input maxLength={100} /></Form.Item>}
            </section>;
          })}
          <Form.ErrorList errors={errors} />
          <Button disabled={fields.length >= 50} onClick={() => add(blankCheck())}>新增測項</Button>
        </>}
      </Form.List>
      <Space wrap style={{ margin: '16px 0' }}><Button aria-label="保存草稿" type="primary" htmlType="submit" loading={busy}>保存草稿</Button><Button disabled={busy} onClick={() => { standardForm.resetFields(); setEditing(false); requestAnimationFrame(() => trigger.current?.focus()); }}>取消</Button></Space>
    </Form>}
    {snapshot && (snapshot.standards.length ? <Table size="small" rowKey="id" pagination={false} dataSource={snapshot.standards} tableLayout="fixed" scroll={{ x: 888 }} columns={[
      { title: '版本', width: 96, onHeaderCell: headerCell(96), render: (_, row: StandardRow) => 'v' + row.revision },
      { title: 'SKU', width: 180, onHeaderCell: headerCell(180), dataIndex: 'sku' },
      { title: '狀態', width: 112, onHeaderCell: headerCell(112), render: (_, row: StandardRow) => <Tag color={row.status === 'REVIEWED' ? 'green' : undefined}>{standardStatus[row.status]}</Tag> },
      { title: '測項', width: 100, onHeaderCell: headerCell(100), render: (_, row: StandardRow) => <details><summary>{row.data.checks.length + ' 項'}</summary>{row.data.checks.map(check => <div key={check.key} style={{ overflowWrap: 'anywhere' }}><Typography.Text strong>{check.name}</Typography.Text><div>{check.standard.instruction}</div><div>{check.standard.kind === 'NUMBER' ? (check.standard.min || '—') + '～' + (check.standard.max || '—') + ' ' + check.standard.unit : check.standard.kind === 'BOOLEAN' ? '預期：' + (check.standard.expected ? '是' : '否') : '觀察'}</div><div>{[check.requiredForInspection ? '檢修必測' : '', check.requiredForCompletion ? '複驗必測' : '', check.requiresCalibration ? check.equipmentType : ''].filter(Boolean).join(' · ')}</div></div>)}</details> },
      { title: '審核時間', width: 220, onHeaderCell: headerCell(220), render: (_, row: StandardRow) => row.reviewedAt ? time(row.reviewedAt) : '—' },
      { title: '操作', width: 180, onHeaderCell: headerCell(180), render: (_, row: StandardRow) => <Space><Button aria-label={'審核 v' + row.revision} type={!editing && !calibrationOpen && row.status === 'DRAFT' && row.id === current?.id ? 'primary' : 'default'} disabled={!writable || editing || calibrationOpen || row.sku !== sku || row.status !== 'DRAFT' || row.id !== current?.id} onClick={() => decide(row, 'review')}>審核</Button><Button aria-label={'停用 v' + row.revision} disabled={!writable || editing || calibrationOpen || row.sku !== sku || row.status !== 'REVIEWED'} onClick={() => decide(row, 'retire')}>停用</Button></Space> },
    ]} /> : <Empty description="尚無檢測標準" />)}
  </>;
  const calibrationContent = <>
    <Button type={calibrationOpen ? 'default' : 'primary'} disabled={!writable || editing || calibrationOpen} onClick={() => { calibrationForm.resetFields(); setCalibrationOpen(true); }} style={{ marginBottom: 12 }}>登錄校正證明</Button>
    {calibrationOpen && <Form form={calibrationForm} name="repair-calibration-definition" layout="vertical" disabled={busy} scrollToFirstError onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLElement && event.target.closest('.ant-picker')) event.preventDefault();
    }} onFinish={values => {
      try { const data = calibration({ ...values, validFrom: values.validFrom?.toISOString(), validUntil: values.validUntil?.toISOString() }); void mutate(path + '/calibrations', data, 'VALID'); }
      catch (error) { setFailure(problem(error)); }
    }}>
      <Form.Item name="instrumentId" label="設備編號" rules={required}><Input autoFocus maxLength={128} /></Form.Item>
      <Form.Item name="equipmentType" label="設備類型" rules={required}><Input maxLength={100} /></Form.Item>
      <Form.Item name="proofReference" label="校正證明編號／依據" rules={required}><Input maxLength={500} /></Form.Item>
      <Row gutter={12}><Col xs={24} sm={12}><Form.Item name="validFrom" label="有效起日" rules={[{ required: true, message: '請選擇有效起日' }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} /></Form.Item></Col><Col xs={24} sm={12}><Form.Item name="validUntil" label="有效迄日" rules={[{ required: true, message: '請選擇有效迄日' }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} /></Form.Item></Col></Row>
      <Space wrap style={{ marginBottom: 16 }}><Button aria-label="保存校正證明" type="primary" htmlType="submit" loading={busy}>保存校正證明</Button><Button disabled={busy} onClick={() => { calibrationForm.resetFields(); setCalibrationOpen(false); }}>取消</Button></Space>
    </Form>}
    {snapshot && (snapshot.calibrations.length ? <Table size="small" rowKey="id" pagination={false} dataSource={snapshot.calibrations} tableLayout="fixed" scroll={{ x: 932 }} columns={[
      { title: '設備', width: 180, onHeaderCell: headerCell(180), render: (_, row: CalibrationRow) => <span>{row.instrumentId}<br />{row.equipmentType}</span> },
      { title: '校正證明', width: 260, onHeaderCell: headerCell(260), render: (_, row: CalibrationRow) => <Space direction="vertical" size={0}><Typography.Text style={{ overflowWrap: 'anywhere' }}>{row.proofReference}</Typography.Text><Typography.Text type="secondary" copyable>{row.id}</Typography.Text></Space> },
      { title: '有效期間', width: 260, onHeaderCell: headerCell(260), render: (_, row: CalibrationRow) => <span>{time(row.validFrom)}<br />{time(row.validUntil)}</span> },
      { title: '狀態', width: 112, onHeaderCell: headerCell(112), render: (_, row: CalibrationRow) => <Tag>{row.status === 'VALID' ? '已登錄' : '已撤銷'}</Tag> },
      { title: '操作', width: 120, onHeaderCell: headerCell(120), render: (_, row: CalibrationRow) => <Button aria-label={'撤銷校正證明 ' + row.id} disabled={!writable || editing || calibrationOpen || row.status !== 'VALID'} onClick={() => modal.confirm({ title: '撤銷此校正證明？', okText: '撤銷', cancelText: '取消', onOk: () => mutate(path + '/calibrations/' + encodeURIComponent(row.id) + '/revoke', {}, 'REVOKED', row.id) })}>撤銷</Button> },
    ]} /> : <Empty description="尚無校正證明" />)}
  </>;
  return <section aria-label="檢測標準與校正管理" style={{ minWidth: 0 }}>
    {contextHolder}
    {!canManage ? <Alert type="warning" message="沒有檢測標準管理權限" /> : !bound ? <Alert type="warning" message="產品待確認" /> : <>
      <Form layout="vertical"><Form.Item label="產品"><Select aria-label="管理產品" disabled value={productId} options={[{ value: productId, label: product!.name + ' · ' + sku }]} /></Form.Item></Form>
      {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />}
      <Spin spinning={loading}><Tabs items={[{ key: 'standards', label: '檢測標準', children: standardContent }, { key: 'calibrations', label: '校正證明', children: calibrationContent }]} /></Spin>
    </>}
  </section>;
}
