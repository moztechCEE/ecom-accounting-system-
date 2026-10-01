import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, Drawer, Empty, Input, Modal, Space, Spin, Table, Tabs, Tag, Timeline, Typography, message } from 'antd';
import { ReloadOutlined, ToolOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermission } from '../../utils/access';
import api from '../../services/api';
import { webSocketService } from '../../services/websocket.service';
import { ACTIONS, STATUS, errorText, mailroomEnabled, type Source } from '../mailroom/model';
import { QUEUES, PLANS, inspectionReviewCurrent, repairStartReady, type RepairQueue, type RepairItem } from './repair-model';
import RepairDocuments from './RepairDocuments';
import '../mailroom/mailroom.css';
import './repair.css';
const { Title, Text, Paragraph } = Typography;
const time = (value: string) => dayjs(value).format('MM/DD HH:mm');
const documentReady = (item: RepairItem) => item.repairInspection?.status === 'SUBMITTED';
const reportReady = (item: RepairItem) => documentReady(item) && item.repairReport?.status === 'SUBMITTED' &&
  item.repairReport.data.qcResult === 'PASS' && !!item.repairReport.data.checks.length && item.repairReport.data.checks.every(check => check.result === 'PASS') &&
  item.repairReport.inspectionRevision === item.repairInspection?.revision &&
  (item.repairInspection?.data.plan === 'REPAIR' && item.repairReport.data.outcome === 'REPAIRED' ||
    item.repairInspection?.data.plan === 'REPLACE' && item.repairReport.data.outcome === 'REPLACED');
const confirmDiscard = () => new Promise<boolean>(resolve => Modal.confirm({
  title: '目前工作單有未保存的修改',
  content: '重新載入或離開會放棄未保存的工作單修改。請先保存草稿，或確認以已保存的版本繼續。',
  okText: '放棄未保存修改並繼續', cancelText: '取消，保留草稿', maskClosable: false,
  onOk: () => { resolve(true); }, onCancel: () => { resolve(false); },
}));

export default function RepairWorkbenchPage() {
  const { user } = useAuth();
  const canRead = hasPermission(user, 'repair_workbench:read');
  const [params, setParams] = useSearchParams();
  const candidate = params.get('queue') || 'all';
  const queue: RepairQueue = Object.hasOwn(QUEUES, candidate) ? candidate as RepairQueue : 'all';
  const entityId = params.get('entityId') || localStorage.getItem('entityId') || '';
  const selectedId = params.get('itemId');
  const enabled = mailroomEnabled();
  const [rows, setRows] = useState<RepairItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pagination, setPagination] = useState({queue, page: 1});
  const page = pagination.queue === queue ? pagination.page : 1;
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const [detail, setDetail] = useState<RepairItem>();
  const [detailBusy, setDetailBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const detailDirty = useRef(false);
  const listEntity = useRef(entityId);
  const refresh = useCallback(async (quiet = false) => {
    if (!enabled || !entityId || !canRead) return;
    if (listEntity.current !== entityId) {listEntity.current = entityId;setRows([]);setTotal(0);}
    const request = ++generation.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api.get<{items: RepairItem[]; total: number}>('/mailroom/items', {params: {entityId, view: 'repair', repairScope: queue, page, search}});
      if (request === generation.current) {setRows(result.data.items);setTotal(result.data.total);setFailure('');}
    } catch (error) {if (request === generation.current) setFailure(errorText(error));}
    finally {if (request === generation.current) setLoading(false);}
  }, [enabled, entityId, canRead, queue, page, search]);
  const loadDetail = useCallback(async (checkDraft = false) => {
    if (checkDraft && detailDirty.current && !await confirmDiscard()) return;
    const request = ++detailGeneration.current;
    detailDirty.current = false;
    setDetail(undefined);setChanged(false);setDetailBusy(false);
    if (!selectedId || !enabled || !entityId || !canRead) return;
    setDetailBusy(true);
    try {
      const result = await api.get<RepairItem>(`/repair-workbench/items/${encodeURIComponent(selectedId)}/documents`, {params: {entityId}});
      if (request === detailGeneration.current) setDetail(result.data);
    } catch (error) {if (request === detailGeneration.current) message.error(errorText(error));}
    finally {if (request === detailGeneration.current) setDetailBusy(false);}
  }, [selectedId, entityId, enabled, canRead]);
  useEffect(() => {
    const requests = generation;
    void refresh();
    const update = () => {if (document.visibilityState === 'visible') void refresh(true);};
    const timer = setInterval(update, 30000);
    const stop = webSocketService.subscribe(n => {
      if (n.category === 'mailroom') {update();if (selectedId && n.data?.itemId === selectedId) setChanged(true);}
    });
    return () => {clearInterval(timer);stop();requests.current++;};
  }, [refresh, selectedId]);
  useEffect(() => {const requests = detailGeneration;void loadDetail();return () => {requests.current++;};}, [loadDetail]);
  async function open(id?: string) {
    if (selectedId && id !== selectedId && detailDirty.current && !await confirmDiscard()) return;
    const next = new URLSearchParams(params);
    if (id) next.set('itemId', id);else next.delete('itemId');
    setParams(next);
  }
  if (!enabled) return <Alert type="info" message="DOA 售後維修工作台尚未啟用" description="完成測試與帳號設定後即可開放。" />;
  if (!canRead) return <Alert type="warning" message="沒有 DOA 售後維修工作台讀取權限" />;
  if (!entityId) return <Alert type="warning" message="請先選擇作業公司" />;
  return <div className="mailroom-page repair-workbench-page">
    <div className="mailroom-heading"><div><Title level={2}><ToolOutlined /> DOA 售後維修工作台</Title><Paragraph type="secondary">從到貨預告、本人簽收到檢修與交回，每一步都保留交接紀錄。</Paragraph></div><Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>重新整理</Button></div>
    <Tabs activeKey={queue} onChange={key => {void (async()=>{if (detailDirty.current && !await confirmDiscard()) return;const next = new URLSearchParams(params);if (key==='all') next.delete('queue');else next.set('queue', key);next.delete('itemId');setPagination({queue:key as RepairQueue,page:1});setParams(next);})();}} items={Object.entries(QUEUES).map(([key,label])=>({key,label}))} />
    {(queue === 'all' || queue === 'acceptance') && <ArrivalPreview entityId={entityId} />}
    {queue === 'waiting' && <Alert showIcon type="info" style={{marginBottom:16}} message="客服方案確認與售後放行分開核對" description="所有方案（含免費處理）都需客服確認目前已提交的檢修版次；顧客同意與必要款項仍由售後來源確認。此處顯示同步進度，不代替會計確認收款。" />}
    {failure && <Alert type="error" showIcon message={failure} style={{marginBottom:16}} />}
    <Card className="repair-workbench-list" title={QUEUES[queue]} extra={<Input.Search className="repair-workbench-search" placeholder="案件號／品名／SKU／SN" allowClear onSearch={value=>{setPagination({queue,page:1});setSearch(value);}} />}>
      <Table<RepairItem> rowKey="id" loading={loading} dataSource={rows} scroll={{x:1000}} locale={{emptyText:<Empty description="此分類目前沒有案件" />}} pagination={{current:page,total,pageSize:50,onChange:value=>setPagination({queue,page:value}),showSizeChanger:false}} columns={[
        {title:'案件與產品',key:'product',render:(_,item)=><><Button type="link" style={{padding:0}} onClick={()=>void open(item.id)}>{item.receipt.sourceNumber || item.label}</Button><div>{item.productName}</div><Text type="secondary">{item.sku || '未提供 SKU'} · {item.serialNumber || '未提供 SN'}</Text></>},
        {title:'作業狀態',dataIndex:'status',render:(value:string)=><Tag color={value==='WAITING_CUSTOMER'?'orange':'blue'}>{STATUS[value] || value}</Tag>},
        {title:'實物保管／位置',key:'custody',render:(_,item)=><>{item.custodianName}<div><Text type="secondary">{item.location}</Text></div></>},
        {title:'目前交辦／接收',key:'next',render:(_,item)=>item.status==='WAITING_CUSTOMER'?'承辦客服處理中':item.nextUserName || (['WAITING_REPAIR_ACCEPTANCE','PENDING_REFURBISH'].includes(item.status)?'待維修師認領':'—')},
        {title:'工作單',key:'documents',render:(_,item)=><Space direction="vertical" size={2}><Text>{item.repairInspection ? `檢修單 v${item.repairInspection.revision} · ${item.repairInspection.status==='SUBMITTED'?'已提交':'草稿'}` : '尚無檢修單'}</Text><Text type="secondary">{item.repairReport ? `維修單 v${item.repairReport.revision} · ${item.repairReport.status==='SUBMITTED'?'已提交':'草稿'}` : '尚無維修單'}</Text></Space>},
        {title:'',key:'open',render:(_,item)=><Button onClick={()=>void open(item.id)}>開啟案件</Button>},
      ]} />
    </Card>
    <Drawer rootClassName="repair-workbench-drawer" width={980} open={!!selectedId} title="維修案件" onClose={()=>void open()} destroyOnHidden>
      <Spin spinning={detailBusy}>{detail ? <>
        {changed && <Alert type="info" showIcon message="案件有新進度" description="請先保存目前草稿，再重新載入案件。" action={<Button onClick={()=>void loadDetail(true)}>重新載入</Button>} style={{marginBottom:16}} />}
        <RepairDetail key={`${detail.id}:${detail.version}`} item={detail} entityId={entityId} onDirtyChange={dirty=>{detailDirty.current=dirty;}} onSaved={async()=>{detailDirty.current=false;await loadDetail();await refresh(true);}} />
      </> : !detailBusy && <Empty description="請重新載入案件" />}</Spin>
    </Drawer>
  </div>;
}
function ArrivalPreview({entityId}:{entityId:string}) {
  const [rows,setRows] = useState<Source[]>([]);
  const [cursor,setCursor] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const [failure,setFailure] = useState('');
  const [reload,setReload] = useState(0);
  const generation = useRef(0);
  const load = useCallback(async (next?:string) => {
    const request=++generation.current;setBusy(true);
    try {
      const items:Source[]=[];let current=next;let more:string|null=null;const seen=new Set<string>();
      do {
        const result=await api.get<{items:Source[];nextCursor?:string|null}>('/mailroom/source-cases',{params:{entityId,awaiting:true,cursor:current}});
        items.push(...result.data.items);more=result.data.nextCursor || null;
        if (items.length || !more || seen.has(more)) break;
        seen.add(more);current=more;
      } while(more);
      if(request===generation.current){setRows(old=>next?[...new Map([...old,...items].map(x=>[x.id,x])).values()]:items);setCursor(more);setFailure('');}
    } catch(error){if(request===generation.current)setFailure(errorText(error));}
    finally{if(request===generation.current)setBusy(false);}
  },[entityId]);
  useEffect(()=>{const requests=generation;void load();return()=>{requests.current++;};},[load,reload]);
  return <Card title="待到貨／在途案件" size="small" style={{marginBottom:20}} extra={<Button size="small" onClick={()=>setReload(value=>value+1)} loading={busy}>更新到貨預告</Button>}>
    <Paragraph type="secondary">售後來源案件的到貨預告；收發室實收並核對後，才會出現在待認領清單。</Paragraph>
    {failure?<Alert type="warning" message={failure} />:<Table<Source> size="small" rowKey="id" loading={busy} dataSource={rows} pagination={false} scroll={{x:650}} columns={[
      {title:'售後案件',dataIndex:'number'},
      {title:'來源進度',key:'status',render:(_,source)=><Tag>{source.statusLabel || source.status}</Tag>},
      {title:'申報產品',key:'items',render:(_,source)=>source.items.map(item=>`${item.name} × ${item.quantity}`).join('；')},
      {title:'待收數量',key:'remaining',render:(_,source)=>source.remainingQuantity ?? '依來源申報'},
    ]} locale={{emptyText:'目前沒有待到貨案件'}} />}
    {cursor&&<Button style={{marginTop:12}} loading={busy} onClick={()=>void load(cursor)}>載入更多</Button>}
  </Card>;
}
function RepairDetail({item,entityId,onSaved,onDirtyChange}:{item:RepairItem;entityId:string;onSaved:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void}) {
  const {user}=useAuth();
  const [location,setLocation]=useState(item.location);
  const [confirmed,setConfirmed]=useState(false);
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const operation=useRef<{body:string;id:string}|null>(null);
  const documentsDirty=useRef(false);
  const running=useRef(false);
  const canUpdate=hasPermission(user,'repair_workbench:update');
  const own=canUpdate && item.repairOwnerId===user?.id && item.custodianId===user?.id;
  const waiting=['WAITING_REPAIR_ACCEPTANCE','PENDING_REFURBISH'].includes(item.status);
  const plan=item.repairInspection?.data.plan;
  async function act(action:string) {
    if(running.current)return;
    running.current=true;
    setBusy(true);setFailure('');
    try {
      if(documentsDirty.current&&!await confirmDiscard())return;
      const payload={entityId,action,expectedVersion:item.version,...(action==='accept'?{confirmedItems:confirmed,location:location.trim()}:{}),...(['await_customer','complete_repair','complete_refurbish'].includes(action)?{note}: {})};
      const body=JSON.stringify(payload);
      if(operation.current?.body!==body)operation.current={body,id:crypto.randomUUID()};
      await api.post(`/mailroom/items/${encodeURIComponent(item.id)}/actions`,{...payload,requestId:operation.current.id});message.success('已保存進度與交接紀錄');await onSaved();
    } catch(error){setFailure(errorText(error));}finally{running.current=false;setBusy(false);}
  }
  const actions: {name:string;label:string;disabled?:boolean}[]=[];
  if(canUpdate&&waiting&&!item.nextUserId&&!item.repairOwnerId)actions.push({name:'claim',label:'認領此案件'});
  if(canUpdate&&waiting&&item.nextUserId===user?.id)actions.push({name:'accept',label:'本人確認實物簽收',disabled:!confirmed||!location.trim()});
  if(own&&item.status==='REPAIR_RECEIVED')actions.push({name:'start_inspection',label:'開始檢測'});
  if(own&&['REPAIR_RECEIVED','INSPECTING','REPAIRING'].includes(item.status))actions.push({name:'await_customer',label:'提交客服確認',disabled:!documentReady(item)||!note.trim()||!item.receipt.customerServiceUserId});
  if(own&&item.status==='INSPECTING')actions.push({name:'start_repair',label:plan==='REPLACE'?'開始替換處理':'開始維修',disabled:!repairStartReady(item)});
  if(own&&['REPAIRING','REFURBISHING'].includes(item.status))actions.push({name:item.status==='REFURBISHING'?'complete_refurbish':'complete_repair',label:'複驗完成，交回收發室',disabled:!reportReady(item)||!note.trim()});
  return <Space direction="vertical" size={20} style={{width:'100%'}}>
    <div><Title level={3}>{item.productName}</Title><Space wrap><Tag color="blue">{STATUS[item.status] || item.status}</Tag><Text>{item.receipt.sourceNumber || item.label}</Text>{item.receipt.category==='RETURN'&&<Tag>退貨整新</Tag>}</Space></div>
    <Descriptions bordered size="small" column={{xs:1,sm:2}} items={[
      {key:'sku',label:'SKU',children:item.sku || '未提供'}, {key:'sn',label:'原件 SN',children:item.serialNumber || '未提供'},
      {key:'custodian',label:'目前實物保管',children:item.custodianName},{key:'location',label:'存放位置',children:item.location},
      {key:'handoff',label:'目前交辦',children:item.status==='WAITING_CUSTOMER'?(item.receipt.customerServiceUserId?'承辦客服（已指派）':'承辦客服（尚未對應）'):waiting?'維修師（待本人簽收）':['REPAIR_RECEIVED','INSPECTING','REPAIRING','REFURBISHING'].includes(item.status)?'維修師檢修處理':item.status==='WAITING_RETURN_ACCEPTANCE'?'收發室（待本人簽收）':STATUS[item.status] || item.status},
      {key:'next',label:'下一位實物接收人',children:item.nextUserName || '待安排'}, {key:'receipt',label:'收發室收件單',children:item.receipt.number},
      {key:'source',label:'售後來源狀態',children:item.release?.sourceStatusLabel || item.release?.sourceStatus || item.release?.message || '無來源'},
      {key:'plan',label:'已保存檢修方案',children:plan?PLANS[plan]:'尚未提交'},
      {key:'review',label:'ERP 客服方案確認',children:item.receipt.category==='RETURN'?'公司退貨庫存整新（不適用顧客維修確認）':inspectionReviewCurrent(item.repairInspection)?`已確認檢修 v${item.repairInspection?.revision}`:'目前版次尚未確認'},
    ]} />
    {item.receipt.category==='REPAIR'&&<Alert showIcon type={item.release?.available&&item.release.repairAllowed?'success':'warning'} message={item.release?.available&&item.release.repairAllowed?'售後已放行：顧客同意及必要款項已確認':'尚未取得售後維修放行'} description={item.release?.message || '此狀態來自售後來源案件。技師估價不等於對客報價或已收款；開始處理時後端會再確認。'} />}
    {item.receipt.category==='REPAIR'&&documentReady(item)&&!inspectionReviewCurrent(item.repairInspection)&&<Alert showIcon type="warning" message="目前檢修方案尚未由客服確認，請先提交客服" description="免費顧客維修也需確認本版檢修方案。ERP 客服確認不代表顧客已同意或款項已入帳，開工仍須取得售後來源放行。" />}
    {!item.receipt.customerServiceUserId&&item.receipt.sourceCaseId&&<Alert type="warning" message="來源案件尚未對應承辦客服" description="請先完成客服帳號對應，再交付客服確認。" />}
    {failure&&<Alert type="error" message={failure} showIcon />}
    {actions.length>0&&<Card size="small" title="下一步作業">
      {waiting&&item.nextUserId===user?.id&&<Space direction="vertical" style={{width:'100%',marginBottom:14}}><Text>登入身分：{user?.name}。逐件核對品名、SKU、SN、配件後再簽收。</Text><Input value={location} maxLength={160} onChange={event=>setLocation(event.target.value)} placeholder="簽收後存放位置" /><Checkbox checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}>我已收到並核對此件實物</Checkbox></Space>}
      {own&&<Input.TextArea value={note} maxLength={2000} rows={2} onChange={event=>setNote(event.target.value)} placeholder="交辦說明：診斷與估價原因，或交回品況及配件" style={{marginBottom:12}} />}
      <Space wrap>{actions.map(action=><Button key={action.name} type="primary" loading={busy} disabled={action.disabled || busy} onClick={()=>void act(action.name)}>{action.label}</Button>)}</Space>
      {own&&!documentReady(item)&&<Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>請先提交完整檢修單，才可交客服確認或開始處理。</Paragraph>}
    </Card>}
    <RepairDocuments item={item} entityId={entityId} onSaved={onSaved} onDirtyChange={dirty=>{documentsDirty.current=dirty;onDirtyChange(dirty);}} />
    <Card size="small" title="跨部門同步與交接">
      <Paragraph type="secondary">同步成功表示對方系統已收到事件；實物仍須由下一位同仁本人簽收。</Paragraph>
      <Space wrap style={{marginBottom:16}}>{(item.deliverySummary||[]).map(value=><Tag key={`${value.target}:${value.status}`} color={value.status==='DELIVERED'?'green':value.status==='PENDING'?'orange':'default'}>{value.target==='AFTER_SALES'?'售後系統':value.target==='AI_CUSTOMER_SERVICE'?'AI 客服系統':value.target} · {value.status==='DELIVERED'?'系統已接收':value.status==='PENDING'?'待發送':value.status==='FAILED'?'發送失敗':value.status} ({value.count})</Tag>)}</Space>
      <Timeline items={(item.history||[]).map(history=>({children:<><Text>{ACTIONS[history.action] || ({claim:'認領案件',save_repair_inspection:'儲存檢修草稿',submit_repair_inspection:'提交檢修單',save_repair_repair:'儲存維修草稿',submit_repair_repair:'提交維修單'} as Record<string,string>)[history.action] || history.action}</Text><div><Text type="secondary">{history.actorName} · {time(history.createdAt)} · {STATUS[history.toStatus] || history.toStatus}</Text></div></>}))} />
    </Card>
  </Space>;
}
