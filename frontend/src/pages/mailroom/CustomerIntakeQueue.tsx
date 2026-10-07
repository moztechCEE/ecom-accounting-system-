import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermission } from '../../utils/access';
import { mailroomIntake } from '../../services/mailroom-intake';
import { useRepairFeedback } from '../repair/repair-feedback';
import type { RepairMessage } from '../repair/repair-feedback';
import { INTAKE_STATUS, errorText, mailroomEnabled } from './model';
import type { Item, Source } from './model';
import { currentItemCustody } from './item-custody';
import { hasIntakeAction, intakeBindPayload, matchesIntakeReceipt } from './intake-actions';
import SourceCasePicker from './SourceCasePicker';

type Props = { entityId: string; initialItemId?: string; onDirtyChange: (dirty: boolean) => void; onOpenSource: (itemId: string) => void };
export default function CustomerIntakeQueue({ entityId, initialItemId, onDirtyChange, onOpenSource }: Props) {
  const { user } = useAuth(), { modal, message, contextHolder } = useRepairFeedback();
  const permitted = hasPermission(user, 'mailroom:review') && mailroomEnabled();
  const [list, setList] = useState<{entityId:string;rows:Item[];total:number;limit:number}>(), [page, setPage] = useState(1), [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>(initialItemId || ''), [detail, setDetail] = useState<{ entityId: string; item: Item }>(), [loading, setLoading] = useState(false), [detailLoading, setDetailLoading] = useState(false), [failure, setFailure] = useState('');
  const listRunning=useRef(false), listGeneration = useRef(0), detailGeneration = useRef(0), dirty = useRef(false), dirtyCallback = useRef(onDirtyChange);
  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => () => { dirtyCallback.current(false); }, []);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; dirtyCallback.current(value); }, []);
  const confirmDiscard = useCallback(() => new Promise<boolean>(resolve => modal.confirm({ title: '綁案資料尚未保存', content: '離開會放棄未保存的選案與核對資料。', okText: '放棄未保存資料', cancelText: '保留資料', maskClosable: false, onOk: () => resolve(true), onCancel: () => resolve(false) })), [modal]);
  const load = useCallback(async () => {
    if (!permitted || !entityId || listRunning.current) return;
    listRunning.current=true; const id = ++listGeneration.current; setLoading(true);
    try { const value = await mailroomIntake.queue(entityId, page, search); if (listGeneration.current === id) { setList({entityId,rows:value.items,total:value.total,limit:value.limit}); setFailure(''); } }
    catch (error) { if (listGeneration.current === id) setFailure(errorText(error)); }
    finally { listRunning.current=false;if (listGeneration.current === id) setLoading(false); }
  }, [permitted, entityId, page, search]);
  const loadDetail = useCallback(async () => {
    const id = ++detailGeneration.current; setDetail(undefined);
    if (!selected || !permitted || !entityId) { setDetailLoading(false); return; }
    setDetailLoading(true);
    try { const item = await mailroomIntake.item(entityId, selected); if (detailGeneration.current === id) setDetail({ entityId, item }); }
    catch (error) { if (detailGeneration.current === id) message.error(errorText(error)); }
    finally { if (detailGeneration.current === id) setDetailLoading(false); }
  }, [entityId, selected, permitted, message]);
  useEffect(() => { const requests=listGeneration;void load();const tick=()=>{if(document.visibilityState==='visible')void load();};const timer=setInterval(tick,15000);window.addEventListener('focus',tick);return()=>{requests.current++;clearInterval(timer);window.removeEventListener('focus',tick);}; }, [load]);
  useEffect(() => { const requests=detailGeneration;void loadDetail(); return () => { requests.current++; }; }, [loadDetail]);
  async function select(id: string) { if (dirty.current && !await confirmDiscard()) return; setDirty(false); setSelected(id); }
  async function refresh() { if (dirty.current && !await confirmDiscard()) return; setDirty(false); await loadDetail(); await load(); }
  if (!permitted || !entityId) return null;
  const rows=list?.entityId===entityId?list.rows:[], total=list?.entityId===entityId?list.total:0;
  const item = detail?.entityId === entityId ? detail.item : undefined;
  return <Card title="收發轉客服補建案件" extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>更新補建交辦</Button>} style={{ marginBottom: 20 }}>
    {contextHolder}
    <Input.Search aria-label="搜尋待補建收件" placeholder="收件號／品名／SN" allowClear maxLength={200} onSearch={value => { setPage(1); setSearch(value); }} style={{ maxWidth: 350, marginBottom: 16 }} />
    {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 12 }} />}
    <Table<Item> rowKey="id" dataSource={rows} loading={loading} scroll={{ x: 650 }} locale={{ emptyText: <Empty description="目前沒有指定本人補建的收件" /> }} pagination={{ current: page, total, pageSize: list?.entityId === entityId ? list.limit : 30, showSizeChanger: false, onChange: setPage }} columns={[
      { title: '原收件／實物', key: 'item', render: (_, row) => <><Button type="link" onClick={() => void select(row.id)}>{row.label}</Button><div>{row.productName} · {row.serialNumber || '未提供 SN'}</div></> },
      { title: '客服交辦', key: 'intake', render: (_, row) => <><Tag>{INTAKE_STATUS[row.caseIntake?.status || ''] || '待核對'}</Tag><div>{row.caseIntake?.ownerName || row.caseIntake?.sentToUserName}</div></> },
      { title: '實物保管', key: 'custody', render: (_, row) => { const c = currentItemCustody(row); return <>{c.holder}<div>{c.location}</div></>; } },
      { title: '', key: 'open', render: (_, row) => <Button onClick={() => void select(row.id)}>檢視交辦</Button> },
    ]} />
    <Drawer title="客服補建與原收件綁定" width={800} open={!!selected} onClose={() => void select('')} destroyOnHidden>
      <Spin spinning={detailLoading}>{item ? <IntakeDetail key={`${item.id}:${item.version}`} item={item} entityId={entityId} userId={user?.id || ''} onDirty={setDirty} feedback={message} onSaved={async () => { setDirty(false); await loadDetail(); await load(); }} onOpenSource={() => void (async () => { if (dirty.current && !await confirmDiscard()) return; setDirty(false); onOpenSource(item.id); })()} /> : !detailLoading && <Empty description="請重新開啟指定本人的收件" />}</Spin>
    </Drawer>
  </Card>;
}
function IntakeDetail({ item, entityId, userId, onDirty, onSaved, onOpenSource, feedback }: { item: Item; entityId: string; userId: string; onDirty: (value: boolean) => void; onSaved: () => Promise<void>; onOpenSource: () => void; feedback: RepairMessage }) {
  const [form] = Form.useForm<{ sourceCaseId: string; sourceItemId: string; note: string }>();
  const [source, setSource] = useState<Source>(), [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const operation = useRef<{ body: string; requestId: string } | undefined>(undefined), running = useRef(false);
  const custody = currentItemCustody(item), canClaim = hasIntakeAction(item, 'claim_intake', userId), canBind = hasIntakeAction(item, 'bind_intake', userId);
  async function command(action: 'claim_intake' | 'bind_intake', values?: { sourceItemId: string; note: string }) {
    if (running.current || action === 'claim_intake' && !canClaim || action === 'bind_intake' && !canBind) return;
    running.current = true; setBusy(true); setFailure(''); let saved = false;
    try {
      const payload = action === 'bind_intake' ? intakeBindPayload(item, source, values?.sourceItemId || '', entityId, userId, values?.note || '') : { action, entityId, expectedVersion: item.version };
      const body = JSON.stringify(payload); if (operation.current?.body !== body) operation.current = { body, requestId: crypto.randomUUID() };
      await mailroomIntake.command(item.id, { ...payload, requestId: operation.current.requestId }); saved = true; onDirty(false); await onSaved(); feedback.success(action === 'claim_intake' ? '已接手交辦' : '收件已綁定售後案件');
    } catch (error) { if(!saved && operation.current){try{const latest=await mailroomIntake.item(entityId,item.id),request={...JSON.parse(operation.current.body),requestId:operation.current.requestId};if(matchesIntakeReceipt(latest,request,userId)){saved=true;onDirty(false);await onSaved();feedback.success('已核對本次操作成功');return;}}catch{/* An unavailable or nonmatching receipt remains unknown; no automatic retry. */}} setFailure(saved ? '已保存，請重開此收件核對；勿重建案件。' : errorText(error)); }
    finally { running.current = false; setBusy(false); }
  }
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Descriptions bordered size="small" column={1} items={[
      { key: 'native', label: '原收件', children: `${item.label} · v${item.version}` },
      { key: 'native-id', label: '原收件識別碼', children: <Typography.Text copyable>{item.id}</Typography.Text> },
      { key: 'intake', label: '客服交辦', children: INTAKE_STATUS[item.caseIntake?.status || ''] || '待核對' },
      { key: 'csr', label: '指定／受理客服', children: item.caseIntake?.ownerName || item.caseIntake?.sentToUserName || '待核對' },
      { key: 'actual', label: '實收產品', children: `${item.productName} · SKU ${item.sku || '未提供'} · SN ${item.serialNumber || '未提供'}` },
      { key: 'custody', label: '實物保管與位置', children: `${custody.holder} / ${custody.location}` },
      ...(item.caseIntake?.sourceCaseId ? [{ key: 'source', label: '已綁定來源', children: item.caseIntake.sourceNumber || item.caseIntake.sourceCaseId }] : []),
    ]} />
    {failure && <Alert type="error" showIcon message={failure} />}
    {canClaim && <Button type="primary" loading={busy} onClick={() => void command('claim_intake')}>本人接手補建交辦</Button>}
    {canBind && <>
      <Button onClick={onOpenSource} disabled={busy}>開啟案件中心</Button>
      <Form form={form} layout="vertical" disabled={busy} onValuesChange={() => onDirty(true)} onFinish={values => void command('bind_intake', values)}>
        <Form.Item name="sourceCaseId" label="售後案件" rules={[{ required: true, message: '請選擇售後來源案件' }]}>
          <SourceCasePicker entityId={entityId} active={canBind} selectedSource={source} onSelectSource={value => { setSource(value); form.setFieldValue('sourceItemId', undefined); onDirty(true); }} />
        </Form.Item>
        {source && (!['REPAIR', 'RETURN'].includes(source.type) || !source.version) && <Alert type="warning" showIcon message="此案件無法綁定，請核對類型與版次" />}
        <Form.Item name="sourceItemId" label="對應申報品項" rules={[{ required: true, message: '請核對並選擇來源品項' }]}><Select options={(source?.items || []).map(line => ({ value: line.id, label: `${line.name} · SKU ${line.sku || '未提供'} · SN ${line.serialNumber || '未提供'} · 申報 ${line.quantity}`, disabled: !Number.isInteger(line.quantity) || line.quantity < 1 || line.remainingQuantity === 0 }))} /></Form.Item>
        <Form.Item name="note" label="核對依據" rules={[{ required: true, whitespace: true, message: '請記錄核對依據' }]}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>確認綁定收件</Button>
      </Form>
    </>}
  </Space>;
}
