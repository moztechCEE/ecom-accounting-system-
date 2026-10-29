import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Collapse, Descriptions, Drawer, Empty, Input, Pagination, Select, Space, Spin, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import { FilterOutlined, ReloadOutlined, ToolOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermission } from '../../utils/access';
import api from '../../services/api';
import { repairService } from '../../services/repair';
import { webSocketService } from '../../services/websocket.service';
import { ACTIONS, STATUS, errorText, mailroomEnabled, type Source } from '../mailroom/model';
import { PLANS, REPAIR_STATUS, WORKFLOW_ACTIONS, sourceQuoteConsentCurrent, sourceWorkStartCurrent, inspectionReviewCurrent, type RepairItem } from './repair-model';
import { repairNextStepActions, repairDispositionRoute } from './repair-nextstep';
import RepairDocuments from './RepairDocuments';
import RepairCaseList from './RepairCaseList';
import { REPAIR_WORKBENCH_TABS, REPAIR_QUERY_FILTERS, repairListScope, repairWorkbenchTab, repairQueueCount, repairCaseProgress, type RepairListScope, type RepairWorkbenchTab, type RepairListResponse, type RepairQueueCounts } from './repair-list-model';
import RepairWorkflowPanel from './RepairWorkflowPanel';
import RepairReadinessPanel from './RepairReadinessPanel';
import RepairCaseContext from './RepairCaseContext';
import RepairCaseScan from './RepairCaseScan';
import RepairPrecheckQueue from './RepairPrecheckQueue';
import RepairTestStandardManager from './RepairTestStandardManager';
import { useRepairNavigationGuard } from './repair-navigation';
import { useRepairFeedback } from './repair-feedback';
import type { RepairMessage } from './repair-feedback';
import '../mailroom/mailroom.css';
import './repair.css';
import { currentItemCustody } from '../mailroom/item-custody';
const { Title, Text, Paragraph } = Typography;
const time = (value: string) => dayjs(value).format('MM/DD HH:mm');
type DetailInstance={item:RepairItem;generation:number;scope:string;token:string|null};
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
  const canDraftTemplates = hasPermission(user, 'repair_workbench:update') || hasPermission(user, 'repair_workbench:manage');
  const canManageTemplates = hasPermission(user, 'repair_workbench:manage');
  const [params, setParams] = useSearchParams();
  const queue = repairListScope(params.get('queue'));
  const tab = repairWorkbenchTab(queue);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const entityId = params.get('entityId') || localStorage.getItem('entityId') || '';
  const selectedId = params.get('itemId');
  const navigationScope=JSON.stringify([entityId,params.toString(),user?.id]);
  const latestNavigation=useRef(navigationScope);
  latestNavigation.current=navigationScope;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const navigationCurrent=(scope:string,token:string|null)=>mounted.current && scope===latestNavigation.current && token===localStorage.getItem('access_token');
  const enabled = mailroomEnabled();
  const [list, setList] = useState<{scope: string; data: RepairListResponse}>();
  const [counts, setCounts] = useState<{entityId: string; data: RepairQueueCounts}>();
  const [todoStatus, setTodoStatus] = useState<{entityId: string; message: string}>();
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
  const detailInstance=useRef<DetailInstance|undefined>(undefined);
  const detailDirty = useRef(false);
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const [templatesBusy,setTemplatesBusy]=useState(false);
  const templatesDirty=useRef(false), templatesChanged=useRef(false), templatesClosing=useRef(false);
  const templatesTrigger=useRef<HTMLButtonElement|HTMLAnchorElement|null>(null);
  const pageDirty=useRef({get current(){return detailDirty.current || templatesDirty.current;},set current(value:boolean){if(!value){detailDirty.current=false;templatesDirty.current=false;}}}).current;
  useEffect(()=>{templatesDirty.current=false;templatesChanged.current=false;setTemplatesOpen(false);setTemplatesBusy(false);},[navigationScope]);
  const currentDetail=detail?.id===selectedId && detail.entityId===entityId && detailInstance.current?.item===detail
    && detailInstance.current.scope===navigationScope && detailInstance.current.token===localStorage.getItem('access_token') ? detail : undefined;
  const activeDetailInstance=currentDetail ? detailInstance.current : undefined;
  const detailInstanceCurrent=(instance:DetailInstance|undefined)=>!!instance && detailInstance.current===instance
    && instance.generation===detailGeneration.current && navigationCurrent(instance.scope,instance.token);
  useRepairNavigationGuard(pageDirty, confirmDiscard);
  const listScope = JSON.stringify([entityId, queue, page, search]);
  const currentList = list?.scope === listScope ? list.data : undefined;
  const rows = currentList?.items || [];
  const total = currentList?.total || 0;
  const failure = listFailure?.scope === listScope ? listFailure.text : '';
  const queueCounts = counts?.entityId === entityId ? counts.data : undefined;
  const todoMessage = todoStatus?.entityId === entityId ? todoStatus.message : '';
  const refresh = useCallback(async (quiet = false) => {
    if (!enabled || !entityId || !canRead) return;
    const request = ++generation.current;
    if (!quiet) setLoading(true);
    try {
      const todoParams = {entityId, ...(queue === 'todo' ? {page, search} : {summary:'true'})};
      const listRequest = queue === 'todo' ? api.get<RepairListResponse>('/repair-workbench/todo', {params:todoParams}) : api.get<RepairListResponse>('/mailroom/items', {params: {entityId, view:'repair', repairScope:queue, page, search}});
      let todoError: unknown;
      const todoRequest = queue === 'todo' ? Promise.resolve(undefined) : api.get<RepairListResponse>('/repair-workbench/todo', {params:todoParams}).catch(error=>{todoError=error;return undefined;});
      const result = await listRequest;
      if (request !== generation.current) return;
      const nextCounts: RepairQueueCounts = {...result.data.queueCounts};
      delete nextCounts.todo;
      setList({scope:listScope, data:result.data});
      setCounts({entityId, data:{...nextCounts}});
      setListFailure(undefined);setTodoStatus(undefined);setLoading(false);
      const todo = queue === 'todo' ? result : await todoRequest;
      if (request !== generation.current) return;
      const todoHttpStatus = (todoError as {response?: {status?: number}} | undefined)?.response?.status;
      if (todoHttpStatus === 401 || todoHttpStatus === 403) throw todoError;
      if (todo?.data.countExact === true && repairQueueCount(todo.data.queueCounts, 'todo') !== undefined) nextCounts.todo = todo.data.queueCounts?.todo;
      setCounts({entityId, data:{...nextCounts}});
      const unknown = todo?.data.unknownCount;
      setTodoStatus({entityId, message:!todo ? '待辦進度暫無法取得' : todo.data.countExact !== true ? Number.isSafeInteger(unknown) && Number(unknown) > 0 ? `有 ${unknown} 件案件的放行狀態尚未確認` : '待辦進度尚未確認' : ''});
    } catch (error) {
      if (request === generation.current) {
        setListFailure({scope: listScope, text: errorText(error)});setCounts(undefined);setTodoStatus(undefined);
        const status = (error as {response?: {status?: number}} | null)?.response?.status;
        if (status === 401 || status === 403) setList(undefined);
      }
    }
    finally {if (request === generation.current) setLoading(false);}
  }, [enabled, entityId, canRead, queue, page, search, listScope]);
  const latestRefresh=useRef(refresh);
  latestRefresh.current=refresh;
  const loadDetail = useCallback(async (checkDraft = false) => {
    const scope=JSON.stringify([entityId,params.toString(),user?.id]),token=localStorage.getItem('access_token');
    const instanceBeforeConfirm=detailInstance.current;
    if (checkDraft && detailDirty.current && !await confirmDiscard()) return;
    const currentScope=()=>mounted.current && scope===latestNavigation.current && token===localStorage.getItem('access_token');
    if(!currentScope() || checkDraft && detailInstance.current!==instanceBeforeConfirm)return;
    const request = ++detailGeneration.current;
    detailInstance.current=undefined;
    detailDirty.current = false;
    setDetail(undefined);setChanged(false);setDetailBusy(false);
    if (!selectedId || !enabled || !entityId || !canRead) return;
    setDetailBusy(true);
    try {
      const result = await repairService.documents(entityId,selectedId);
      if (request === detailGeneration.current && currentScope()) {
        const acceptedInstance={item:result,generation:request,scope,token};
        detailInstance.current=acceptedInstance;
        setDetail(result);
        return acceptedInstance;
      }
    } catch (error) {if (request === detailGeneration.current && currentScope()) message.error(errorText(error));}
    finally {if (request === detailGeneration.current && currentScope()) setDetailBusy(false);}
  }, [selectedId, entityId, enabled, canRead, confirmDiscard, message, params, user?.id]);
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
    const scope=navigationScope,token=localStorage.getItem('access_token');
    const instance=detailInstance.current;
    if (selectedId && id !== selectedId && detailDirty.current && !await confirmDiscard()) return;
    if(!navigationCurrent(scope,token) || detailInstance.current!==instance)return;
    if(id!==selectedId)detailDirty.current=false;
    const next = new URLSearchParams(params);
    if (id) next.set('itemId', id);else next.delete('itemId');
    setParams(next);
  }
  async function openScanned(target: {itemId:string;entityId:string}):Promise<boolean> {
    const scope=navigationScope,token=localStorage.getItem('access_token');
    const instance=detailInstance.current;
    if (target.entityId !== entityId) return false;
    if (target.itemId===selectedId) return true;
    if (detailDirty.current && !await confirmDiscard()) return false;
    if(!navigationCurrent(scope,token) || detailInstance.current!==instance)return false;
    detailDirty.current=false;
    const next = new URLSearchParams(params);
    next.set('entityId',entityId);next.set('itemId',target.itemId);next.set('queue','all');
    setPagination({queue:'all',page:1});setParams(next);return true;
  }
  async function changeQueue(nextQueue: RepairListScope) {
    const scope=navigationScope,token=localStorage.getItem('access_token');
    const instance=detailInstance.current;
    if (detailDirty.current && !await confirmDiscard()) return;
    if(!navigationCurrent(scope,token) || detailInstance.current!==instance)return;
    detailDirty.current=false;
    const next = new URLSearchParams(params);
    if (nextQueue === 'todo') next.delete('queue');else next.set('queue', nextQueue);
    next.delete('itemId');
    setPagination({queue:nextQueue,page:1});
    setParams(next);
  }
  async function closeTemplates() {
    if(templatesBusy || templatesClosing.current)return;
    templatesClosing.current=true;
    const scope=navigationScope,token=localStorage.getItem('access_token');
    try {
      if(templatesDirty.current && !await confirmDiscard())return;
      if(!navigationCurrent(scope,token))return;
      templatesDirty.current=false;setTemplatesOpen(false);
      if(templatesChanged.current){templatesChanged.current=false;if(selectedId)await loadDetail(true);if(navigationCurrent(scope,token))await latestRefresh.current(true);}
      if(navigationCurrent(scope,token))requestAnimationFrame(()=>templatesTrigger.current?.focus());
    } finally {templatesClosing.current=false;}
  }
  if (!enabled) return <>{contextHolder}<Alert type="info" message="維修工作台尚未啟用" /></>;
  if (!canRead) return <>{contextHolder}<Alert type="warning" message="沒有維修工作台讀取權限" /></>;
  if (!entityId) return <>{contextHolder}<Alert type="warning" message="請先選擇作業公司" /></>;
  return <div className="mailroom-page repair-workbench-page">
    {contextHolder}
    <div className="mailroom-heading"><div><Title level={2}><ToolOutlined /> 維修工作台</Title></div><Space wrap>{canDraftTemplates && <Button ref={node=>{templatesTrigger.current=node;}} onClick={()=>setTemplatesOpen(true)}>維修範本</Button>}<Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>重新整理</Button></Space></div>
    <Drawer title="維修範本" open={templatesOpen} width="min(900px, 100vw)" maskClosable={false} closable={!templatesBusy} onClose={()=>void closeTemplates()} destroyOnHidden>
      <RepairTestStandardManager key={`${entityId}:${user?.id || ''}`} entityId={entityId} product={null} viewerId={user?.id || ''} canDraft={canDraftTemplates} canManage={canManageTemplates} confirmDiscard={confirmDiscard} onDirtyChange={dirty=>{templatesDirty.current=dirty;}} onBusyChange={setTemplatesBusy} onChanged={()=>{templatesChanged.current=true;}} feedback={message} />
    </Drawer>
    <RepairCaseScan key={entityId} entityId={entityId} active={!selectedId} onOpen={openScanned} />
    <Tabs activeKey={tab} onChange={key => void changeQueue(key as RepairWorkbenchTab)} items={Object.entries(REPAIR_WORKBENCH_TABS).map(([key,label])=>{
      const count=key === 'all' ? undefined : repairQueueCount(queueCounts,key as RepairWorkbenchTab);
      return {key,label:<span className="repair-tab-label"><span>{label}</span>{count !== undefined && count > 0 && <Badge count={count} overflowCount={Infinity} title={`${count} 件`} aria-label={`${count} 件`} />}</span>};
    })} />
    {tab === 'acceptance' && <>
      <Collapse className="repair-arrival-preview" items={[{key:'arrival',label:'待到貨／在途案件',forceRender:true,children:<ArrivalPreview entityId={entityId} />}]} />
      <RepairPrecheckQueue entityId={entityId} onOpen={id=>void open(id)} />
    </>}
    {todoMessage && !failure && <Alert type="warning" showIcon message={todoMessage} style={{marginBottom:16}} />}
    {failure && <Alert type="error" showIcon message={failure} style={{marginBottom:16}} />}
    <Card className="repair-workbench-list" title={REPAIR_WORKBENCH_TABS[tab]} extra={<Space className="repair-query-tools">
      <Input.Search className="repair-workbench-search" placeholder="搜尋案件" allowClear onSearch={value=>{setPagination({queue,page:1});setSearch(value);}} />
      {tab === 'all' && <Button aria-label="篩選" icon={<FilterOutlined />} aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(value=>!value)}>篩選</Button>}
    </Space>}>
      {tab === 'all' && filtersOpen && <Select className="repair-query-filter" aria-label="案件分類" value={queue} options={Object.entries(REPAIR_QUERY_FILTERS).map(([value,label])=>({value,label}))} onChange={value=>void changeQueue(value as RepairListScope)} />}
      {tab === 'all' && queue !== 'all' && <div className="repair-applied-filter"><Tag closable onClose={event=>{event.preventDefault();void changeQueue('all');}}>{REPAIR_QUERY_FILTERS[queue as keyof typeof REPAIR_QUERY_FILTERS]}</Tag></div>}
      <Spin spinning={loading}>
        {rows.length ? <RepairCaseList items={rows} entityId={entityId} onOpen={id => void open(id)} /> :
          currentList && !failure && !(queue === 'todo' && todoMessage) ? <Empty description={tab === 'todo' ? '目前沒有待辦' : '此分類目前沒有案件'} /> : !failure && !(queue === 'todo' && todoMessage) && <div className="repair-list-loading">載入案件…</div>}
      </Spin>
      <Pagination className="repair-case-pagination" current={page} total={total} pageSize={50} onChange={value=>setPagination({queue,page:value})} showSizeChanger={false} hideOnSinglePage />
    </Card>
    <Drawer rootClassName="repair-workbench-drawer" width="min(1180px, 100vw)" open={!!selectedId} title={<div className="repair-detail-identity"><Text type="secondary">{currentDetail?.receipt.sourceNumber || currentDetail?.label || '維修案件'}</Text><Title level={3}>{currentDetail?.productName || '載入案件…'}</Title></div>} onClose={()=>void open()} destroyOnHidden>
      <Spin spinning={detailBusy}>{currentDetail ? <>
        {changed && <Alert type="info" showIcon message="案件已更新" action={<Button onClick={()=>void loadDetail(true)}>重新載入</Button>} style={{marginBottom:16}} />}
        <RepairDetail confirmDiscard={confirmDiscard} feedback={message} key={`${currentDetail.entityId}:${currentDetail.id}:${currentDetail.version}:${activeDetailInstance?.generation}`} item={currentDetail} readerExpectedItemId={selectedId || ''} entityId={entityId} onDirtyChange={dirty=>{if(detailInstanceCurrent(activeDetailInstance))detailDirty.current=dirty;}} onSaved={async()=>{
          if(!detailInstanceCurrent(activeDetailInstance))return;
          detailDirty.current=false;
          const adoptedInstance=await loadDetail();
          if(detailInstanceCurrent(adoptedInstance))await latestRefresh.current(true);
        }} />
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
  return <section className="repair-arrival-list" aria-label="待到貨案件">
    <div className="repair-arrival-toolbar"><Button icon={<ReloadOutlined />} onClick={()=>setReload(value=>value+1)} loading={busy}>更新</Button></div>
    {failure ? <Alert type="warning" message={failure} /> : <Spin spinning={busy}>
      {!!rows.length && <div className="repair-arrival-columns" aria-hidden="true"><span>售後案件</span><span>來源進度</span><span>申報產品</span><span>待收數量</span></div>}
      <ul>{rows.map(source=><li className="repair-arrival-row" key={source.id}>
        <Text className="repair-arrival-number">{source.number}</Text>
        <div><Tag>{source.statusLabel || source.status}</Tag></div>
        <div className="repair-arrival-products">{source.items.map((item,index)=><div key={`${item.name}:${index}`}>{item.name} × {item.quantity}</div>)}</div>
        <div className="repair-arrival-count"><span className="repair-mobile-label">待收數量 </span>{source.remainingQuantity ?? '依來源申報'}</div>
      </li>)}</ul>
      {!rows.length && !busy && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目前沒有待到貨案件" />}
    </Spin>}
    {cursor&&<Button className="repair-arrival-more" loading={busy} onClick={()=>void load(cursor)}>載入更多</Button>}
  </section>;
}
function RepairDetail({item,readerExpectedItemId,entityId,onSaved,onDirtyChange,feedback,confirmDiscard}:{item:RepairItem;readerExpectedItemId:string;entityId:string;onSaved:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void;feedback:RepairMessage;confirmDiscard:()=>Promise<boolean>}) {
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
  const [standardsOpen,setStandardsOpen]=useState(false);
  const [standardsClosing,setStandardsClosing]=useState(false);
  const [standardsBusy,setStandardsBusy]=useState(false);
  const [standardsEpoch,setStandardsEpoch]=useState(0);
  const standardsChanged=useRef(false);
  const standardsDirty=useRef(false);
  const closingStandards=useRef(false);
  const standardsTrigger=useRef<HTMLButtonElement|HTMLAnchorElement|null>(null);
  const [workflowOpen,setWorkflowOpen]=useState<string[]>(()=>item.allowedWorkflowActions?.some(action=>!['claim_customer','resolve_customer','review_assessment'].includes(action))?['workflow']:[]);
  const documentsDirty=useRef(false);
  const workflowDirty=useRef(false);
  const actionDirty=useRef(false);
  const publishDirty=()=>onDirtyChange(documentsDirty.current || workflowDirty.current || actionDirty.current || standardsDirty.current);
  const running=useRef(false);
  const canUpdate=hasPermission(user,'repair_workbench:update');
  const canManage=hasPermission(user,'repair_workbench:manage');
  const own=canUpdate && item.repairOwnerId===user?.id && item.custodianId===user?.id && item.editable===true;
  const waiting=['WAITING_REPAIR_ACCEPTANCE','PENDING_REFURBISH'].includes(item.status);
  const plan=item.repairInspection?.data.plan;
  const noteLabel=['REPAIRING','REFURBISHING'].includes(item.status) && !(item.receipt.category==='RETURN' && !sourceWorkStartCurrent(item))?'交回品況與配件':'交辦說明';
  async function closeStandards() {
    if(closingStandards.current || standardsBusy || busy || workflowBusy)return;
    closingStandards.current=true;setStandardsClosing(true);
    try {
      if((standardsDirty.current || standardsChanged.current && (documentsDirty.current || workflowDirty.current || actionDirty.current)) && !await confirmDiscard())return;
      standardsDirty.current=false;publishDirty();
      setStandardsOpen(false);
      if(standardsChanged.current){
        await onSaved();standardsChanged.current=false;documentsDirty.current=false;workflowDirty.current=false;actionDirty.current=false;
        setNote('');setConfirmed(false);setLocation(item.location);publishDirty();setStandardsEpoch(value=>value+1);
      }
      requestAnimationFrame(()=>standardsTrigger.current?.focus());
    } catch(error){setFailure(errorText(error));}
    finally{closingStandards.current=false;setStandardsClosing(false);}
  }
  async function act(action:string) {
    if(running.current)return;
    running.current=true;
    setBusy(true);setFailure('');
    try {
      if((documentsDirty.current || workflowDirty.current || standardsDirty.current)&&!await confirmDiscard())return;
      const payload={entityId,action,expectedVersion:item.version,...(action==='accept'?{confirmedItems:confirmed,location:location.trim()}:{}),...(['await_customer','complete_repair','complete_refurbish'].includes(action)?{note}: {})};
      const body=JSON.stringify(payload);
      if(operation.current?.body!==body)operation.current={body,id:crypto.randomUUID()};
      await api.post(`/mailroom/items/${encodeURIComponent(item.id)}/actions`,{...payload,requestId:operation.current.id});message.success('已保存進度與交接紀錄');await onSaved();
    } catch(error){setFailure(errorText(error));}finally{running.current=false;setBusy(false);}
  }
  const actions=repairNextStepActions(item,{canUpdate,viewerId:user?.id,confirmed,location,note});
  const primaryAction=actions.find(action=>!action.disabled && ['start_repair','complete_repair','complete_refurbish'].includes(action.name)) || actions.find(action=>!action.disabled) || actions[0];
  const hasWorkflow=!!(item.repairWorkflow?.csr || item.repairWorkflow?.factory || item.repairWorkflow?.release || item.repairWorkflow?.workStart || item.repairWorkflow?.dispositionAuthorization || item.repairPrerequisites?.disposition?.authorization || item.allowedWorkflowActions?.some(action=>!['claim_customer','resolve_customer','review_assessment'].includes(action)));
  return <div className="repair-detail">
    <div className="repair-detail-summary"><Tag color="blue">{repairCaseProgress(item) || item.statusLabel || REPAIR_STATUS[item.status] || STATUS[item.status] || item.status}</Tag>{item.receipt.category==='RETURN'&&<Tag>退貨整新</Tag>}{(canUpdate || canManage)&&<Button ref={node=>{standardsTrigger.current=node;}} disabled={busy || workflowBusy || standardsClosing} onClick={()=>setStandardsOpen(true)}>維修範本</Button>}</div>
    <Drawer title="維修範本" open={standardsOpen} width="min(900px, 100vw)" maskClosable={false} onClose={()=>void closeStandards()} closable={!standardsBusy && !standardsClosing && !busy && !workflowBusy} destroyOnHidden>
      <RepairTestStandardManager key={`${entityId}:${user?.id || ''}:${item.productId || ''}`} entityId={entityId} product={item.productId && item.productName && item.sku?{id:item.productId,name:item.productName,sku:item.sku}:null} canManage={canManage} canDraft={canUpdate || canManage} viewerId={user?.id || ''} confirmDiscard={confirmDiscard} onDirtyChange={dirty=>{standardsDirty.current=dirty;publishDirty();}} feedback={message} onChanged={()=>{standardsChanged.current=true;}} onBusyChange={setStandardsBusy} />
    </Drawer>
    <RepairCaseContext item={item} entityId={entityId} expectedItemId={readerExpectedItemId} />
    {workflowFailure&&<Alert type="error" showIcon message={workflowFailure} />}
    <div className={`repair-documents-layout${waiting?' repair-awaiting-receipt':''}`}>
      <div className="repair-editor-main">{waiting ? <Collapse ghost items={[{key:'documents',label:'檢修紀錄',forceRender:true,children:<RepairDocuments key={`documents:${standardsEpoch}`} feedback={message} item={item} entityId={entityId} onSaved={onSaved} onBeforeSave={async()=>!(workflowDirty.current || actionDirty.current) || await confirmDiscard()} onDirtyChange={dirty=>{documentsDirty.current=dirty;publishDirty();}} />}]} /> : <RepairDocuments key={`documents:${standardsEpoch}`} feedback={message} item={item} entityId={entityId} onSaved={onSaved} onBeforeSave={async()=>!(workflowDirty.current || actionDirty.current) || await confirmDiscard()} onDirtyChange={dirty=>{documentsDirty.current=dirty;publishDirty();}} />}
</div>
      <aside className="repair-editor-sidebar" aria-label="案件操作">
    {!item.receipt.customerServiceUserId&&item.receipt.sourceCaseId&&<Alert type="warning" message="尚未指派承辦客服" />}
    {failure&&<Alert type="error" message={failure} showIcon />}
    {actions.length>0&&<Card size="small" title="案件操作">
      {waiting&&item.nextUserId===user?.id&&<Space direction="vertical" style={{width:'100%',marginBottom:14}}><Text>簽收人：{user?.name}</Text><Input value={location} maxLength={160} onChange={event=>{setLocation(event.target.value);actionDirty.current=true;publishDirty();}} placeholder="存放位置" aria-label="存放位置" /><Checkbox checked={confirmed} onChange={event=>{setConfirmed(event.target.checked);actionDirty.current=true;publishDirty();}}>已收到並核對實物與配件</Checkbox></Space>}
      {own&&<Input.TextArea value={note} maxLength={2000} rows={2} onChange={event=>{setNote(event.target.value);actionDirty.current=true;publishDirty();}} placeholder={noteLabel} aria-label={noteLabel} style={{marginBottom:12}} />}
      <Space wrap>{actions.map(action=><Tooltip key={action.name} title={action.disabled && !busy ? action.reason : undefined}><span><Button type={action===primaryAction && !(workflowOpen.includes('workflow') && item.allowedWorkflowActions?.some(value=>!['claim_customer','resolve_customer','review_assessment'].includes(value)))?'primary':'default'} loading={busy} disabled={action.disabled || busy || workflowBusy} onClick={()=>void act(action.name)}>{action.label}</Button></span></Tooltip>)}</Space>
    </Card>}
        <RepairReadinessPanel compact item={item} canUpdate={canUpdate} viewerId={user?.id} handoffNote={note} />
        {hasWorkflow&&<Collapse activeKey={workflowOpen} onChange={keys=>{if(!workflowBusy)setWorkflowOpen(Array.isArray(keys)?keys:[keys]);}} items={[{key:'workflow',label:item.receipt.category==='RETURN'?'公司整新作業':repairDispositionRoute(item)?'原件處置':'原件與原廠作業',collapsible:workflowBusy?'disabled':undefined,forceRender:true,children:<>    <RepairWorkflowPanel key={`workflow:${standardsEpoch}`} feedback={message} item={item} entityId={entityId} canUpdate={canUpdate && item.repairOwnerId===user?.id && !busy} onSaved={onSaved} onFailure={setWorkflowFailure} onBusyChange={setWorkflowBusy} onDirtyChange={dirty=>{workflowDirty.current=dirty;publishDirty();}} onBeforeAction={async()=>!(documentsDirty.current || actionDirty.current) || await confirmDiscard()} />
</>}]} />}
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
      {key:'review',label:'客服方案確認',children:inspectionReviewCurrent(item.repairInspection)?`${item.repairInspection?.review?.decision==='DECLINE'?'客服拒修':'客服確認'}檢修 v${item.repairInspection?.revision}`:'目前版次尚未確認'},
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
