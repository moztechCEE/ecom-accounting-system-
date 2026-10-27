import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, Radio, Space, Spin, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermission } from '../../utils/access';
import { repairService } from '../../services/repair';
import { webSocketService } from '../../services/websocket.service';
import { errorText, mailroomEnabled } from '../mailroom/model';
import { CSR_STATUS, PLANS, sourceQuoteConsentCurrent, inspectionReviewCurrent } from './repair-model';
import type { RepairItem, RepairWorkflowCommand } from './repair-model';
import RepairDocuments from './RepairDocuments';
import { currentItemCustody } from '../mailroom/item-custody';
import { useRepairFeedback } from './repair-feedback';
import type { RepairMessage } from './repair-feedback';
/** Native departmental acceptance; source customer consent and finance remain separate. */
export default function CustomerRepairQueue({entityId,onDirtyChange,initialItemId}:{entityId:string;onDirtyChange?:(dirty:boolean)=>void;initialItemId?:string}) {
  const {modal,message,contextHolder}=useRepairFeedback();
  const confirmDiscard=useCallback(()=>new Promise<boolean>(resolve=>modal.confirm({title:'回覆尚未儲存',content:'要放棄修改並離開嗎？',okText:'放棄修改',cancelText:'繼續編輯',maskClosable:false,onOk:()=>{resolve(true);},onCancel:()=>{resolve(false);}})),[modal]);
  const {user}=useAuth();
  const permitted=hasPermission(user,'mailroom:review')&&mailroomEnabled();
  const [rows,setRows]=useState<RepairItem[]>([]);const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false);const [failure,setFailure]=useState('');
  const [selected,setSelected]=useState<string | undefined>(initialItemId);const [detail,setDetail]=useState<{entityId:string;item:RepairItem}>();
  const [detailBusy,setDetailBusy]=useState(false);const [changed,setChanged]=useState(false);
  const generation=useRef(0);const detailGeneration=useRef(0);const dirty=useRef(false);
  const currentEntity=useRef(entityId);
  const dirtyCallback=useRef(onDirtyChange);
  useEffect(()=>{dirtyCallback.current=onDirtyChange;},[onDirtyChange]);
  useEffect(()=>()=>{dirtyCallback.current?.(false);},[]);
  const setDirty=useCallback((value:boolean)=>{dirty.current=value;dirtyCallback.current?.(value);},[]);
  const load=useCallback(async(quiet=false)=>{
    if(!permitted||!entityId)return;
    const request=++generation.current;if(!quiet)setBusy(true);
    try{const data=await repairService.customerQueue(entityId,{search,page,pageSize:30});if(request===generation.current){setRows(data.items);setTotal(data.total);setFailure('');}}
    catch(error){if(request===generation.current)setFailure(errorText(error));}
    finally{if(request===generation.current)setBusy(false);}
  },[entityId,permitted,page,search]);
  const loadDetail=useCallback(async(afterSave=false,minimumVersion?:number)=>{
    const request=++detailGeneration.current;setDetail(undefined);setChanged(false);
    if(!selected||!permitted||!entityId){setDetailBusy(false);return false;}
    setDetailBusy(true);
    try{
      const data=await repairService.documents(entityId,selected);
      if(request!==detailGeneration.current)return false;
      if(!data || data.id!==selected || data.entityId!==entityId || !Number.isInteger(data.version) || data.version<1 || minimumVersion!==undefined && data.version<minimumVersion)
        throw new Error('案件資料尚未更新，請重新載入');
      setDetail({entityId,item:data});return true;
    }
    catch(error){if(request===detailGeneration.current)message.error(afterSave?'回覆已儲存，案件重新載入失敗。':errorText(error));return false;}
    finally{if(request===detailGeneration.current)setDetailBusy(false);}
  },[selected,permitted,entityId,message]);
  useEffect(()=>{
    if(currentEntity.current!==entityId){currentEntity.current=entityId;setRows([]);setTotal(0);setSelected(undefined);setPage(1);setDirty(false);}
    void load();const requests=generation;
    const update=()=>{if(document.visibilityState==='visible')void load(true);};
    const timer=setInterval(update,30000);const stop=webSocketService.subscribe(notification=>{if(notification.category==='mailroom'){update();if(notification.data?.itemId===selected || notification.data?.sourceCaseId===detail?.item.receipt.sourceCaseId && !!detail?.item.receipt.sourceCaseId)setChanged(true);}});
    return()=>{requests.current++;clearInterval(timer);stop();};
  },[load,entityId,selected,setDirty,detail?.item.receipt.sourceCaseId]);
  useEffect(()=>{const requests=detailGeneration;void loadDetail();return()=>{requests.current++;};},[loadDetail]);
  useEffect(()=>{if(initialItemId){setDirty(false);setSelected(initialItemId);}},[initialItemId,setDirty]);
  async function select(id?:string){if(dirty.current){if(!await confirmDiscard())return;setDirty(false);}setSelected(id);}
  if(!permitted||!entityId)return null;
  const item=detail?.entityId===entityId?detail.item:undefined;
  return <Card title="維修交辦" extra={<Button icon={<ReloadOutlined />} loading={busy} onClick={()=>void load()}>更新</Button>} style={{marginBottom:20}}>
    {contextHolder}
    <Input.Search allowClear maxLength={200} placeholder="案件號／品名／SN" aria-label="搜尋維修轉客服交辦" onSearch={value=>{setPage(1);setSearch(value);}} style={{maxWidth:350,marginBottom:16}} />
    {failure&&<Alert type="error" showIcon message={failure} style={{marginBottom:12}} />}
    <Table<RepairItem> rowKey="id" dataSource={rows} loading={busy} scroll={{x:650}} pagination={{current:page,total,pageSize:30,showSizeChanger:false,onChange:setPage}} locale={{emptyText:<Empty description="目前沒有待客服處理的維修交辦" />}} columns={[
      {title:'案件／產品',key:'case',render:(_,value)=><><Button type="link" onClick={()=>void select(value.id)}>{value.receipt.sourceNumber || value.label}</Button><div>{value.productName} · {value.serialNumber || '未提供 SN'}</div></>},
      {title:'交辦',key:'csr',render:(_,value)=><Space direction="vertical" size={2}><Tag>{value.repairWorkflow?.csr?CSR_STATUS[value.repairWorkflow.csr.status]:'等待接手'}</Tag><Typography.Text type="secondary">檢修 v{value.repairInspection?.revision || '—'}</Typography.Text></Space>},
      {title:'實物保管',key:'custody',render:(_,item)=>{const custody=currentItemCustody(item);return <>{custody.holder}{custody.notice&&<div>{custody.notice}</div>}</>;}},
      {title:'',key:'open',render:(_,value)=><Button onClick={()=>void select(value.id)}>查看</Button>},
    ]} />
    <Drawer rootClassName="repair-workbench-drawer" title="客服維修交辦" width={940} open={!!selected} onClose={()=>void select()} destroyOnHidden>
      <Spin spinning={detailBusy}>{item?<>
        {changed&&<Alert type="warning" showIcon message="案件有新進度，請核對最新檢修版次" action={<Button onClick={()=>void(async()=>{if(dirty.current&&!await confirmDiscard())return;setDirty(false);await loadDetail();})()}>重新載入</Button>} style={{marginBottom:16}} />}
        <CustomerReview feedback={message} key={`${item.id}:${item.version}`} item={item} entityId={entityId} userId={user?.id || ''} onDirty={setDirty} confirmDiscard={confirmDiscard} onSaved={async()=>{setDirty(false);const refreshed=await loadDetail(true,item.version+1);await load(true);if(!refreshed)throw new Error('案件重新載入失敗');}} />
      </>:!detailBusy&&<Empty description="請重新開啟交辦" />}</Spin>
    </Drawer>
  </Card>;
}
type CustomerAction='claim_customer'|'resolve_customer'|'review_assessment';
type ReviewFields={decision:'APPROVE'|'DECLINE';note:string};
type DraftKind='solution'|'assessment'|'documents';
function CustomerReview({item,entityId,userId,onDirty,onSaved,feedback,confirmDiscard}:{item:RepairItem;entityId:string;userId:string;onDirty:(dirty:boolean)=>void;onSaved:()=>Promise<void>;feedback:RepairMessage;confirmDiscard:()=>Promise<boolean>}) {
  const message=feedback;
  const [form]=Form.useForm<ReviewFields>();const [assessmentForm]=Form.useForm<ReviewFields>();
  const [busy,setBusy]=useState<CustomerAction|null>(null);const [failure,setFailure]=useState('');
  const running=useRef(false);const operation=useRef<{body:string;requestId:string}|null>(null);
  const drafts=useRef({solution:false,assessment:false,documents:false});
  const setDraftDirty=(kind:DraftKind,value=true)=>{drafts.current[kind]=value;onDirty(Object.values(drafts.current).some(Boolean));};
  const custody=currentItemCustody(item);
  const csr=item.repairWorkflow?.csr;
  const inspection=item.repairInspection;
  const assessment=inspection?.data.assessment;
  const viewer=typeof userId==='string'?userId.trim():'';
  const author=typeof inspection?.authorId==='string'?inspection.authorId.trim():'';
  const owner=typeof item.repairOwnerId==='string'?item.repairOwnerId.trim():'';
  const csrOwner=typeof csr?.ownerId==='string'?csr.ownerId.trim():'';
  const exception=inspection?.status==='SUBMITTED' && assessment?.schema===1 && assessment.conclusion==='USER_CAUSED'
    && typeof assessment.basis==='string' && !!assessment.basis.trim() && typeof assessment.causalExplanation==='string' && !!assessment.causalExplanation.trim()
    && Array.isArray(assessment.checkKeys) && assessment.checkKeys.length>0 && assessment.checkKeys.every(key=>typeof key==='string' && !!key.trim()) && new Set(assessment.checkKeys).size===assessment.checkKeys.length
    && Array.isArray(assessment.mediaIds) && assessment.mediaIds.every(id=>typeof id==='string' && !!id.trim()) && new Set(assessment.mediaIds).size===assessment.mediaIds.length
    && inspection.data.causeStatus==='CONFIRMED' && inspection.data.isAccidentalDamage===true;
  const canReview=exception && !!inspection && item.entityId===entityId && item.status==='WAITING_CUSTOMER' && Array.isArray(item.allowedWorkflowActions) && item.allowedWorkflowActions.includes('review_assessment')
    && !!viewer && !!author && !!owner && viewer!==author && viewer!==owner && csr?.status==='ACCEPTED' && csrOwner===viewer
    && Number.isInteger(inspection.revision) && inspection.revision>0 && csr.inspectionRevision===inspection.revision && csr.estimateRevision===inspection.revision
    && typeof csr.planHash==='string' && /^[a-f0-9]{64}$/.test(csr.planHash);
  const quoteRevision=item.release?.releaseInfo?.quoteRevision;
  const customerQuoteRequired=item.receipt.category==='REPAIR';
  const canApprove=customerQuoteRequired?sourceQuoteConsentCurrent(item.release?.releaseInfo):!!item.receipt.sourceCaseId&&item.release?.available===true;
  const canClaim=item.allowedWorkflowActions?.includes('claim_customer')===true;
  const canResolve=item.allowedWorkflowActions?.includes('resolve_customer')===true && csr?.status==='ACCEPTED' && csr.ownerId===userId;
  async function act(action:CustomerAction,values?:ReviewFields) {
    if(running.current || action==='claim_customer'&&!canClaim || action==='resolve_customer'&&!canResolve || action==='review_assessment'&&!canReview)return;
    if(action!=='claim_customer' && (!values || !['APPROVE','DECLINE'].includes(values.decision) || typeof values.note!=='string' || !values.note.trim()))return;
    running.current=true;setBusy(action);setFailure('');let saved=false;
    try{
      const otherDraft=action==='review_assessment'?drafts.current.solution || drafts.current.documents:action==='resolve_customer'?drafts.current.assessment || drafts.current.documents:Object.values(drafts.current).some(Boolean);
      if(otherDraft&&!await confirmDiscard())return;
      const payload:Omit<RepairWorkflowCommand,'requestId'>={entityId,expectedVersion:item.version,action,...(values?{inspectionRevision:inspection?.revision,decision:values.decision,note:values.note.trim()}: {})};
      const body=JSON.stringify(payload);if(operation.current?.body!==body)operation.current={body,requestId:crypto.randomUUID()};
      await repairService.workflow(item.id,{...payload,requestId:operation.current.requestId});saved=true;
      drafts.current={solution:false,assessment:false,documents:false};onDirty(false);await onSaved();
      message.success(action==='claim_customer'?'已接手交辦':action==='review_assessment'?'已儲存覆核':'已儲存方案回覆');
    }catch(error){setFailure(saved?'回覆已保存，但重新載入失敗。請重新開啟案件核對。':errorText(error));}finally{running.current=false;setBusy(null);}
  }
  return <Space direction="vertical" size={16} style={{width:'100%'}}>
    <Descriptions bordered size="small" column={1} items={[
      {key:'case',label:'售後主單',children:item.receipt.sourceNumber || item.label},
      {key:'plan',label:'本版檢修方案',children:item.repairInspection?`${PLANS[item.repairInspection.data.plan]} · 檢修 v${item.repairInspection.revision} · ${inspectionReviewCurrent(item.repairInspection)?'本版已確認':'本版待確認'}`:'尚無已提交檢修單'},
      {key:'stage',label:'部門交辦',children:csr?CSR_STATUS[csr.status]:'尚無交辦'},
      {key:'custody',label:'目前實物保管',children:`${custody.holder} / ${custody.location}`},
      ...(custody.transferred?[{key:'linked',label:'換機出庫',children:[custody.notice,custody.reference,custody.status].filter(Boolean).join(' · ')}]:[]),
    ]} />
    {failure&&<Alert type="error" showIcon message={failure} />}
    {canClaim&&<Button type="primary" loading={busy==='claim_customer'} disabled={!!busy} onClick={()=>void act('claim_customer')}>接手交辦</Button>}
    {canResolve&&customerQuoteRequired&&!sourceQuoteConsentCurrent(item.release?.releaseInfo)&&<Alert type="warning" showIcon message={quoteRevision==null?'尚未建立報價':`報價 v${quoteRevision} 尚未取得顧客同意`} />}
    {canResolve&&!customerQuoteRequired&&!canApprove&&<Alert type="warning" showIcon message="售後來源暫無法確認" />}
    {canResolve&&<Form name={`customer-repair-review-${item.id}`} form={form} layout="vertical" onValuesChange={()=>setDraftDirty('solution')} onFinish={values=>void act('resolve_customer',values)} disabled={!!busy}>
      <Form.Item name="decision" label={`檢修 v${item.repairInspection?.revision} 方案結果`} rules={[{required:true,message:'請選擇此版方案結果'}]}><Radio.Group options={[{value:'APPROVE',label:customerQuoteRequired?'同意方案':'核准整新方案',disabled:!canApprove},{value:'DECLINE',label:customerQuoteRequired?'拒修':'不進行整新'}]} /></Form.Item>
      <Form.Item name="note" label="回覆依據" rules={[{required:true,whitespace:true,message:'請記錄方案審核與確認依據'}]}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy==='resolve_customer'} disabled={!!busy}>儲存回覆</Button>
    </Form>}
    <RepairDocuments feedback={message} item={item} entityId={entityId} onSaved={onSaved} onDirtyChange={value=>setDraftDirty('documents',value)} onBeforeSave={async()=>!(drafts.current.solution || drafts.current.assessment) || await confirmDiscard()} />
    {canReview&&<Card size="small" title="佐證覆核" style={{width:'100%'}}>
      <Form name={`customer-repair-assessment-${item.id}`} form={assessmentForm} layout="vertical" onValuesChange={()=>setDraftDirty('assessment')} onFinish={values=>void act('review_assessment',values)} disabled={!!busy}>
        <Form.Item name="decision" label="結果" rules={[{required:true,message:'請選覆核結果'}]}><Radio.Group options={[{value:'APPROVE',label:'通過'},{value:'DECLINE',label:'退回補充'}]} /></Form.Item>
        <Form.Item name="note" label="覆核紀錄" rules={[{required:true,whitespace:true,message:'請填覆核紀錄'}]}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy==='review_assessment'} disabled={!!busy}>儲存覆核</Button>
      </Form>
    </Card>}
  </Space>;
}
