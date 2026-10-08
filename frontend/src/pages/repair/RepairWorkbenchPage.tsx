import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Collapse, Descriptions, Drawer, Empty, Input, Pagination, Space, Spin, Table, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import { ReloadOutlined, ToolOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermission } from '../../utils/access';
import api from '../../services/api';
import { repairService } from '../../services/repair';
import { webSocketService } from '../../services/websocket.service';
import { ACTIONS, STATUS, errorText, mailroomEnabled, type Source } from '../mailroom/model';
import { QUEUES, PLANS, REPAIR_STATUS, WORKFLOW_ACTIONS, sourceQuoteConsentCurrent, inspectionReviewCurrent, repairStartReady, repairReportReady, type RepairQueue, type RepairItem } from './repair-model';
import RepairDocuments from './RepairDocuments';
import RepairCaseList from './RepairCaseList';
import { repairQueueCount, type RepairListResponse, type RepairQueueCounts } from './repair-list-model';
import RepairWorkflowPanel from './RepairWorkflowPanel';
import RepairReadinessPanel from './RepairReadinessPanel';
import { useRepairNavigationGuard } from './repair-navigation';
import { useRepairFeedback } from './repair-feedback';
import type { RepairMessage } from './repair-feedback';
import '../mailroom/mailroom.css';
import './repair.css';
import { currentItemCustody } from '../mailroom/item-custody';
const { Title, Text, Paragraph } = Typography;
const time = (value: string) => dayjs(value).format('MM/DD HH:mm');
const documentReady = (item: RepairItem) => item.repairInspection?.status === 'SUBMITTED';
function historyNote(action: string, note: string): string {
  if (!['save_repair_inspection','submit_repair_inspection','save_repair_repair','submit_repair_repair'].includes(action)) return note;
  try {
    const document = JSON.parse(note);
    if (typeof document.documentNumber !== 'string' || !Number.isInteger(document.revision) || document.revision < 1 || !['DRAFT','SUBMITTED'].includes(document.status)) return note;
    return `${action.endsWith('inspection') ? '檢修單' : '維修單'} ${document.documentNumber} · v${document.revision} · ${document.status === 'SUBMITTED' ? '已提交' : '草稿'}`;
  } catch { return note; }
}

export default function RepairWorkbenchPage() {
  const { modal, message, contextHolder } = useRepairFeedback();
  const confirmDiscard = useCallback(() => new Promise<boolean>(resolve => modal.confirm({
    title: '尚有未儲存的修改',
    content: '要放棄修改並離開嗎？',
    okText: '放棄修改', cancelText: '繼續編輯', maskClosable: false,
    onOk: () => { resolve(true); }, onCancel: () => { resolve(false); },
  })), [modal]);
  const { user } = useAuth();
  const canRead = hasPermission(user, 'repair_workbench:read');
  const [params, setParams] = useSearchParams();
  const candidate = params.get('queue') || 'all';
  const queue: RepairQueue = Object.hasOwn(QUEUES, candidate) ? candidate as RepairQueue : 'all';
  const entityId = params.get('entityId') || localStorage.getItem('entityId') || '';
  const selectedId = params.get('itemId');
  const enabled = mailroomEnabled();
  const [list, setList] = useState<{scope: string; data: RepairListResponse}>();
  const [counts, setCounts] = useState<{entityId: string; data: RepairQueueCounts}>();
  const [pagination, setPagination] = useState({queue, page: 1});
  const page = pagination.queue === queue ? pagination.page : 1;
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [listFailure, setListFailure] = useState<{scope: string; text: string}>();
  const [detail, setDetail] = useState<RepairItem>();
  const [detailBusy, setDetailBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const detailDirty = useRef(false);
  useRepairNavigationGuard(detailDirty, confirmDiscard);
  const listScope = JSON.stringify([entityId, queue, page, search]);
  const currentList = list?.scope === listScope ? list.data : undefined;
  const rows = currentList?.items || [];
  const total = currentList?.total || 0;
  const failure = listFailure?.scope === listScope ? listFailure.text : '';
  const queueCounts = counts?.entityId === entityId ? counts.data : undefined;
  const refresh = useCallback(async (quiet = false) => {
    if (!enabled || !entityId || !canRead) return;
    const request = ++generation.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api.get<RepairListResponse>('/mailroom/items', {params: {entityId, view: 'repair', repairScope: queue, page, search}});
      if (request === generation.current) {
        setList({scope: listScope, data: result.data});
        setCounts(result.data.queueCounts ? {entityId, data: result.data.queueCounts} : undefined);
        setListFailure(undefined);
      }
    } catch (error) {
      if (request === generation.current) {
        setListFailure({scope: listScope, text: errorText(error)});setCounts(undefined);
        const status = (error as {response?: {status?: number}} | null)?.response?.status;
        if (status === 401 || status === 403) setList(undefined);
      }
    }
    finally {if (request === generation.current) setLoading(false);}
  }, [enabled, entityId, canRead, queue, page, search, listScope]);
  const loadDetail = useCallback(async (checkDraft = false) => {
    if (checkDraft && detailDirty.current && !await confirmDiscard()) return;
    const request = ++detailGeneration.current;
    detailDirty.current = false;
    setDetail(undefined);setChanged(false);setDetailBusy(false);
    if (!selectedId || !enabled || !entityId || !canRead) return;
    setDetailBusy(true);
    try {
      const result = await repairService.documents(entityId,selectedId);
      if (request === detailGeneration.current) setDetail(result);
    } catch (error) {if (request === detailGeneration.current) message.error(errorText(error));}
    finally {if (request === detailGeneration.current) setDetailBusy(false);}
  }, [selectedId, entityId, enabled, canRead, confirmDiscard, message]);
  useEffect(() => {
    const requests = generation;
    void refresh();
    const update = () => {if (document.visibilityState === 'visible') void refresh(true);};
    const timer = setInterval(update, 30000);
    const stop = webSocketService.subscribe(n => {
      if (n.category === 'mailroom') {update();if (selectedId && (n.data?.itemId === selectedId || n.data?.sourceCaseId === detail?.receipt.sourceCaseId && !!detail?.receipt.sourceCaseId)) setChanged(true);}
    });
    return () => {clearInterval(timer);stop();requests.current++;};
  }, [refresh, selectedId, detail?.receipt.sourceCaseId]);
  useEffect(() => {const requests = detailGeneration;void loadDetail();return () => {requests.current++;};}, [loadDetail]);
  async function open(id?: string) {
    if (selectedId && id !== selectedId && detailDirty.current) {if (!await confirmDiscard()) return;detailDirty.current=false;}
    const next = new URLSearchParams(params);
    if (id) next.set('itemId', id);else next.delete('itemId');
    setParams(next);
  }
  if (!enabled) return <>{contextHolder}<Alert type="info" message="維修工作台尚未啟用" /></>;
  if (!canRead) return <>{contextHolder}<Alert type="warning" message="沒有維修工作台讀取權限" /></>;
  if (!entityId) return <>{contextHolder}<Alert type="warning" message="請先選擇作業公司" /></>;
  return <div className="mailroom-page repair-workbench-page">
    {contextHolder}
    <div className="mailroom-heading"><div><Title level={2}><ToolOutlined /> 維修工作台</Title></div><Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>重新整理</Button></div>
    <Tabs activeKey={queue} onChange={key => {void (async()=>{if (detailDirty.current) {if (!await confirmDiscard()) return;detailDirty.current=false;}const next = new URLSearchParams(params);if (key==='all') next.delete('queue');else next.set('queue', key);next.delete('itemId');setPagination({queue:key as RepairQueue,page:1});setParams(next);})();}} items={Object.entries(QUEUES).map(([key,label])=>{const count=repairQueueCount(queueCounts,key as RepairQueue);return {key,label:<span className="repair-tab-label"><span>{label}</span>{count !== undefined && count > 0 && <Badge count={count} overflowCount={Infinity} title={`${count} 件`} aria-label={`${count} 件`} />}</span>};})} />
    {(queue === 'all' || queue === 'acceptance') && <Collapse className="repair-arrival-preview" items={[{key:'arrival',label:'待到貨／在途案件',forceRender:true,children:<ArrivalPreview entityId={entityId} />}]} />}
    {failure && <Alert type="error" showIcon message={failure} style={{marginBottom:16}} />}
    <Card className="repair-workbench-list" title={QUEUES[queue]} extra={<Input.Search className="repair-workbench-search" placeholder="搜尋案件" allowClear onSearch={value=>{setPagination({queue,page:1});setSearch(value);}} />}>
      <Spin spinning={loading}>
        {rows.length ? <RepairCaseList items={rows} entityId={entityId} onOpen={id => void open(id)} /> :
          currentList && !failure ? <Empty description="此分類目前沒有案件" /> : !failure && <div className="repair-list-loading">載入案件…</div>}
      </Spin>
      <Pagination className="repair-case-pagination" current={page} total={total} pageSize={50} onChange={value=>setPagination({queue,page:value})} showSizeChanger={false} hideOnSinglePage />
    </Card>
    <Drawer rootClassName="repair-workbench-drawer" width="min(1180px, 100vw)" open={!!selectedId} title={<div className="repair-detail-identity"><Text type="secondary">{detail?.receipt.sourceNumber || detail?.label || '維修案件'}</Text><Title level={3}>{detail?.productName || '載入案件…'}</Title></div>} onClose={()=>void open()} destroyOnHidden>
      <Spin spinning={detailBusy}>{detail ? <>
        {changed && <Alert type="info" showIcon message="案件已更新" action={<Button onClick={()=>void loadDetail(true)}>重新載入</Button>} style={{marginBottom:16}} />}
        <RepairDetail confirmDiscard={confirmDiscard} feedback={message} key={`${detail.id}:${detail.version}`} item={detail} entityId={entityId} onDirtyChange={dirty=>{detailDirty.current=dirty;}} onSaved={async()=>{detailDirty.current=false;await loadDetail();await refresh(true);}} />
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
  return <Card size="small" style={{marginBottom:20}} extra={<Button size="small" onClick={()=>setReload(value=>value+1)} loading={busy}>更新</Button>}>
    {failure?<Alert type="warning" message={failure} />:<Table<Source> size="small" rowKey="id" loading={busy} dataSource={rows} pagination={false} scroll={{x:650}} columns={[
      {title:'售後案件',dataIndex:'number'},
      {title:'來源進度',key:'status',render:(_,source)=><Tag>{source.statusLabel || source.status}</Tag>},
      {title:'申報產品',key:'items',render:(_,source)=>source.items.map(item=>`${item.name} × ${item.quantity}`).join('；')},
      {title:'待收數量',key:'remaining',render:(_,source)=>source.remainingQuantity ?? '依來源申報'},
    ]} locale={{emptyText:'目前沒有待到貨案件'}} />}
    {cursor&&<Button style={{marginTop:12}} loading={busy} onClick={()=>void load(cursor)}>載入更多</Button>}
  </Card>;
}
function RepairDetail({item,entityId,onSaved,onDirtyChange,feedback,confirmDiscard}:{item:RepairItem;entityId:string;onSaved:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void;feedback:RepairMessage;confirmDiscard:()=>Promise<boolean>}) {
  const message = feedback;
  const {user}=useAuth();
  const custody=currentItemCustody(item);
  const [location,setLocation]=useState(item.location);
  const [confirmed,setConfirmed]=useState(false);
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const operation=useRef<{body:string;id:string}|null>(null);
  const [workflowFailure,setWorkflowFailure]=useState('');
  const [workflowBusy,setWorkflowBusy]=useState(false);
  const [workflowOpen,setWorkflowOpen]=useState<string[]>([]);
  const documentsDirty=useRef(false);
  const workflowDirty=useRef(false);
  const actionDirty=useRef(false);
  const publishDirty=()=>onDirtyChange(documentsDirty.current || workflowDirty.current || actionDirty.current);
  const running=useRef(false);
  const canUpdate=hasPermission(user,'repair_workbench:update');
  const own=canUpdate && item.repairOwnerId===user?.id && item.custodianId===user?.id && item.editable===true;
  const waiting=['WAITING_REPAIR_ACCEPTANCE','PENDING_REFURBISH'].includes(item.status);
  const plan=item.repairInspection?.data.plan;
  const reportReason=!documentReady(item)?'請先提交檢修單':item.repairReport?.status!=='SUBMITTED'?'請先提交維修單':item.repairReport.inspectionRevision!==item.repairInspection?.revision?'維修單依據的檢修版本已變更':item.repairReport.data.qcResult!=='PASS'||!item.repairReport.data.checks.length||item.repairReport.data.checks.some(check=>check.result!=='PASS')?'複驗尚未通過':'請核對方案與實際處置';
  async function act(action:string) {
    if(running.current)return;
    running.current=true;
    setBusy(true);setFailure('');
    try {
      if((documentsDirty.current || workflowDirty.current)&&!await confirmDiscard())return;
      const payload={entityId,action,expectedVersion:item.version,...(action==='accept'?{confirmedItems:confirmed,location:location.trim()}:{}),...(['await_customer','complete_repair','complete_refurbish'].includes(action)?{note}: {})};
      const body=JSON.stringify(payload);
      if(operation.current?.body!==body)operation.current={body,id:crypto.randomUUID()};
      await api.post(`/mailroom/items/${encodeURIComponent(item.id)}/actions`,{...payload,requestId:operation.current.id});message.success('已保存進度與交接紀錄');await onSaved();
    } catch(error){setFailure(errorText(error));}finally{running.current=false;setBusy(false);}
  }
  const actions: {name:string;label:string;disabled?:boolean;reason?:string}[]=[];
  if(canUpdate&&waiting&&!item.nextUserId&&!item.repairOwnerId)actions.push({name:'claim',label:'認領案件'});
  if(canUpdate&&waiting&&item.nextUserId===user?.id)actions.push({name:'accept',label:'簽收實物',disabled:!confirmed||!location.trim(),reason:!location.trim()?'請填存放位置':'請確認已核對實物'});
  if(own&&item.status==='REPAIR_RECEIVED')actions.push({name:'start_inspection',label:'開始檢測'});
  if(own&&['REPAIR_RECEIVED','INSPECTING','REPAIRING'].includes(item.status))actions.push({name:'await_customer',label:'送客服確認',disabled:!documentReady(item)||!note.trim()||!item.receipt.customerServiceUserId,reason:!documentReady(item)?'請先提交檢修單':!item.receipt.customerServiceUserId?'請指派承辦客服':'請填交辦說明'});
  if(own&&item.status==='INSPECTING'&&['REPAIR','REPLACE'].includes(plan || ''))actions.push({name:'start_repair',label:plan==='REPLACE'?'開始換機':'開始維修',disabled:!repairStartReady(item),reason:'請完成客服與放行核對'});
  if(own&&['REPAIRING','REFURBISHING'].includes(item.status))actions.push({name:item.status==='REFURBISHING'?'complete_refurbish':'complete_repair',label:'交回收發室',disabled:!repairReportReady(item)||!note.trim(),reason:!repairReportReady(item)?reportReason:'請填交回品況與配件'});
  const primaryAction=actions.find(action=>!action.disabled && ['start_repair','complete_repair','complete_refurbish'].includes(action.name)) || actions.find(action=>!action.disabled) || actions[0];
  return <div className="repair-detail">
    <div className="repair-detail-summary"><Tag color="blue">{item.statusLabel || REPAIR_STATUS[item.status] || STATUS[item.status] || item.status}</Tag>{item.receipt.category==='RETURN'&&<Tag>退貨整新</Tag>}<Text type="secondary">SN：{item.serialNumber || '未提供'} · SKU：{item.sku || '未提供'}</Text></div>
    <RepairReadinessPanel compact item={item} canUpdate={canUpdate} viewerId={user?.id} handoffNote={note} />
    {workflowFailure&&<Alert type="error" showIcon message={workflowFailure} />}
    <div className="repair-documents-layout">
      <div className="repair-editor-main">    <RepairDocuments feedback={message} item={item} entityId={entityId} onSaved={onSaved} onBeforeSave={async()=>!(workflowDirty.current || actionDirty.current) || await confirmDiscard()} onDirtyChange={dirty=>{documentsDirty.current=dirty;publishDirty();}} />
</div>
      <aside className="repair-editor-sidebar" aria-label="案件操作">
    {!item.receipt.customerServiceUserId&&item.receipt.sourceCaseId&&<Alert type="warning" message="尚未指派承辦客服" />}
    {failure&&<Alert type="error" message={failure} showIcon />}
    {actions.length>0&&<Card size="small" title="案件操作">
      {waiting&&item.nextUserId===user?.id&&<Space direction="vertical" style={{width:'100%',marginBottom:14}}><Text>簽收人：{user?.name}</Text><Input value={location} maxLength={160} onChange={event=>{setLocation(event.target.value);actionDirty.current=true;publishDirty();}} placeholder="存放位置" aria-label="存放位置" /><Checkbox checked={confirmed} onChange={event=>{setConfirmed(event.target.checked);actionDirty.current=true;publishDirty();}}>已收到並核對實物與配件</Checkbox></Space>}
      {own&&<Input.TextArea value={note} maxLength={2000} rows={2} onChange={event=>{setNote(event.target.value);actionDirty.current=true;publishDirty();}} placeholder={['REPAIRING','REFURBISHING'].includes(item.status)?'交回品況與配件':'交辦說明'} aria-label={['REPAIRING','REFURBISHING'].includes(item.status)?'交回品況與配件':'交辦說明'} style={{marginBottom:12}} />}
      <Space wrap>{actions.map(action=><Tooltip key={action.name} title={action.disabled && !busy ? action.reason : undefined}><span><Button type={action===primaryAction?'primary':'default'} loading={busy} disabled={action.disabled || busy} onClick={()=>void act(action.name)}>{action.label}</Button></span></Tooltip>)}</Space>
    </Card>}
        <Collapse activeKey={workflowOpen} onChange={keys=>{if(!workflowBusy)setWorkflowOpen(Array.isArray(keys)?keys:[keys]);}} items={[{key:'workflow',label:'原件與原廠作業',collapsible:workflowBusy?'disabled':undefined,forceRender:true,children:<>    <RepairWorkflowPanel feedback={message} item={item} entityId={entityId} canUpdate={canUpdate && item.repairOwnerId===user?.id} onSaved={onSaved} onFailure={setWorkflowFailure} onBusyChange={setWorkflowBusy} onDirtyChange={dirty=>{workflowDirty.current=dirty;publishDirty();}} onBeforeAction={async()=>!(documentsDirty.current || actionDirty.current) || await confirmDiscard()} />
</>}]} />
      </aside>
    </div>
    <Collapse className="repair-case-details" items={[
      {key:'details',label:'案件資料與實物保管',forceRender:true,children:<>    <Descriptions bordered size="small" column={{xs:1,sm:2}} items={[
      {key:'sku',label:'SKU',children:item.sku || '未提供'}, {key:'sn',label:'原件 SN',children:item.serialNumber || '未提供'},
      {key:'custodian',label:'目前實物保管',children:custody.holder},{key:'location',label:'目前實物位置',children:custody.location},
      ...(custody.transferred?[{key:'linked',label:'換機出庫',children:[custody.notice,custody.reference,custody.status].filter(Boolean).join(' · ')},{key:'in-history',label:'原退貨入庫紀錄',children:`${item.custodianName} / ${item.location}（歷史接收，不代表目前持有）`}]:[]),
      {key:'handoff',label:'目前交辦',children:item.status==='WAITING_CUSTOMER'?(item.receipt.customerServiceUserId?'承辦客服（已指派）':'承辦客服（尚未對應）'):waiting?'維修師（待本人簽收）':['REPAIR_RECEIVED','INSPECTING','REPAIRING','REFURBISHING'].includes(item.status)?'維修師檢修處理':item.status==='WAITING_RETURN_ACCEPTANCE'?'收發室（待本人簽收）':REPAIR_STATUS[item.status] || STATUS[item.status] || item.status},
      {key:'next',label:'下一位實物接收人',children:item.nextUserName || '待安排'}, {key:'receipt',label:'收發室收件單',children:item.receipt.number},
      {key:'source',label:'售後來源狀態',children:item.release?.sourceStatusLabel || item.release?.sourceStatus || item.release?.message || '無來源'},
      {key:'plan',label:'已保存檢修方案',children:plan?PLANS[plan]:'尚未提交'},
      {key:'review',label:'客服方案確認',children:item.receipt.category==='RETURN'?'不適用':inspectionReviewCurrent(item.repairInspection)?`${item.repairInspection?.review?.decision==='DECLINE'?'客服拒修':'客服確認'}檢修 v${item.repairInspection?.revision}`:'目前版次尚未確認'},
    ]} />
    {item.receipt.category==='REPAIR' && item.release?.releaseInfo && <Descriptions size="small" bordered column={{xs:1,sm:2}} style={{marginBottom:16}} items={[
      {key:'quoteRevision',label:'報價版次',children:`v${item.release.releaseInfo.quoteRevision}`},
      {key:'consent',label:'顧客同意本報價版',children:sourceQuoteConsentCurrent(item.release.releaseInfo)?`已確認 · ${item.release.releaseInfo.customerApprovedAt ? new Date(item.release.releaseInfo.customerApprovedAt).toLocaleString('zh-TW') : ''}`:'尚未確認目前報價版'},
      {key:'amount',label:'本報價金額',children:item.release.releaseInfo.amount==null?'尚未提供':`${item.release.releaseInfo.currency} ${item.release.releaseInfo.amount}`},
      {key:'paymentRevision',label:'款項確認',children:item.release.releaseInfo.amount===0?'免費方案，無需款項':item.release.releaseInfo.confirmedPaymentQuoteRevision===item.release.releaseInfo.quoteRevision?'來源確認本版必要款項':'尚未確認目前報價版必要款項'},
    ]} />}
</>},
      {key:'history',label:'交接與處理歷程',forceRender:true,children:<>    <Card size="small" title="同步紀錄">
      <Space wrap style={{marginBottom:16}}>{(item.deliverySummary||[]).map(value=><Tag key={`${value.target}:${value.status}`} color={value.status==='DELIVERED'?'green':value.status==='PENDING'?'orange':'default'}>{value.target==='AFTER_SALES'?'售後系統':value.target==='AI_CUSTOMER_SERVICE'?'AI 客服系統':value.target} · {item.status==='DISPATCHED'?'歷史':''}{value.status==='DELIVERED'?'系統已接收':value.status==='PENDING'?'待發送':value.status==='FAILED'?'發送失敗':value.status} ({value.count})</Tag>)}</Space>
      <Timeline items={(item.history||[]).map(history=>({children:<><Text>{ACTIONS[history.action] || (WORKFLOW_ACTIONS as Record<string,string>)[history.action] || ({claim:'認領案件',save_repair_inspection:'儲存檢修草稿',submit_repair_inspection:'提交檢修單',save_repair_repair:'儲存維修草稿',submit_repair_repair:'提交維修單'} as Record<string,string>)[history.action] || history.action}</Text><div><Text type="secondary">{history.actorName} · {time(history.createdAt)} · {REPAIR_STATUS[history.toStatus] || STATUS[history.toStatus] || history.toStatus} · 實物紀錄 v{history.version}</Text></div>{history.note&&<Paragraph style={{whiteSpace:'pre-wrap',marginTop:4,marginBottom:0}}>{historyNote(history.action,history.note)}</Paragraph>}</>}))} />
    </Card>
</>},
    ]} />
  </div>;
}
