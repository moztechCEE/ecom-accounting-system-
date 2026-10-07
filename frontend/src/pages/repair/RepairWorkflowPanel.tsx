import { useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, Space, Tag, Tooltip, Typography } from 'antd';
import { repairService } from '../../services/repair';
import { errorText } from '../mailroom/model';
import { CUSTODY, CSR_STATUS, repairReportReady } from './repair-model';
import type { RepairItem, RepairWorkflowAction, RepairWorkflowCommand } from './repair-model';
import { currentPhysicalCustody } from '../mailroom/item-custody';
import { useRepairFeedback } from './repair-feedback';
import type { RepairMessage } from './repair-feedback';
const TECH_ACTIONS:RepairWorkflowAction[]=['return_original','send_factory','accept_factory','request_factory_return','cancel_factory','receive_factory','complete_factory'];
const ACTION_LABELS:Partial<Record<RepairWorkflowAction,string>>={return_original:'退回原件',send_factory:'登記送廠',accept_factory:'登記原廠收件',request_factory_return:'登記原廠寄回',cancel_factory:'取消原廠處理',receive_factory:'簽收返還件',complete_factory:'交回收發室'};
type Fields={note:string;confirmedItems?:boolean;location?:string;factoryName?:string;reference?:string;carrier?:string;trackingNumber?:string};
const required=[{required:true,whitespace:true,message:'請填寫實際作業資料'}];
export default function RepairWorkflowPanel({item,entityId,canUpdate,onSaved,onDirtyChange,onBeforeAction,feedback,onFailure,onBusyChange}:{item:RepairItem;entityId:string;canUpdate:boolean;onSaved:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void;onBeforeAction:()=>Promise<boolean>;feedback?:RepairMessage;onFailure?:(value:string)=>void;onBusyChange?:(value:boolean)=>void}) {
  const {message,contextHolder}=useRepairFeedback(feedback);
  const [action,setAction]=useState<RepairWorkflowAction>();
  const [form]=Form.useForm<Fields>();
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const running=useRef(false);
  const operation=useRef<{body:string;requestId:string}|null>(null);
  const workflow=item.repairWorkflow;
  const available=canUpdate?TECH_ACTIONS.filter(value=>item.allowedWorkflowActions?.includes(value)):[];
  const physical=currentPhysicalCustody(item);
  const handoff=workflow?.csr;
  const confirmPhysical=action==='return_original'||action==='send_factory'||action==='receive_factory';
  const tracking=action==='send_factory'||action==='request_factory_return';
  const originalReturnStatus=item.status==='DISPATCHED'?'已交物流寄回':item.status==='READY_FOR_DISPATCH'?'待收發寄回':item.status==='WAITING_RETURN_ACCEPTANCE'?'待收發簽收':item.statusLabel || item.status;
  const completionReason=item.repairInspection?.status!=='SUBMITTED'?'請先提交檢修單':item.repairReport?.status!=='SUBMITTED'?'請先提交維修單':item.repairReport.inspectionRevision!==item.repairInspection.revision?'維修單依據的檢修版本已變更':item.repairWorkflow?.factory?.stage!=='RETURNED'?'尚未簽收原廠返還件':item.repairReport.data.factoryReference!==item.repairWorkflow.factory.reference?'委修單號不一致':'複驗尚未通過';
  async function submit(values:Fields) {
    if(!action||!available.includes(action)||running.current)return;
    running.current=true;setBusy(true);setFailure('');onBusyChange?.(true);onFailure?.('');
    let saved=false;
    try {
      if(!await onBeforeAction())return;
      const payload:Omit<RepairWorkflowCommand,'requestId'>={entityId,expectedVersion:item.version,action,note:values.note.trim(),
        ...(confirmPhysical?{confirmedItems:values.confirmedItems,location:values.location?.trim()}:{}),
        ...(action==='send_factory'?{factoryName:values.factoryName?.trim(),reference:values.reference?.trim()}:{}),
        ...(tracking?{carrier:values.carrier?.trim(),trackingNumber:values.trackingNumber?.trim()}:{}),
      };
      const body=JSON.stringify(payload);
      if(operation.current?.body!==body)operation.current={body,requestId:crypto.randomUUID()};
      await repairService.workflow(item.id,{...payload,requestId:operation.current.requestId});saved=true;
      onDirtyChange(false);await onSaved();message.success('已儲存');
    } catch(error){const text=saved?'作業已儲存，重新載入失敗。':errorText(error);setFailure(text);onFailure?.(text);if(onFailure)message.error(text);}
    finally{running.current=false;setBusy(false);onBusyChange?.(false);}
  }
  return <>
    {contextHolder}
    {handoff&&<Card size="small" title="客服交辦">
      <Space wrap style={{marginBottom:12}}><Tag color={handoff.status==='ACCEPTED'?'blue':handoff.status==='RESOLVED'?'green':'orange'}>{CSR_STATUS[handoff.status] || handoff.status}</Tag><Tag>依檢修 v{handoff.inspectionRevision}</Tag>{handoff.quoteRevision!=null&&<Tag>售後報價 v{handoff.quoteRevision}</Tag>}{handoff.decision&&<Tag>{handoff.decision==='APPROVE'?'方案確認通過':'方案拒絕／不進行維修'}</Tag>}</Space>
      <Descriptions size="small" column={2} items={[
        {key:'owner',label:'接手客服',children:handoff.ownerName || (handoff.ownerId?item.repairInspection?.review?.name || '已由本人接手':'尚未接手')},
        {key:'sent',label:'交辦時間',children:handoff.sentAt?new Date(handoff.sentAt).toLocaleString('zh-TW'):'—'},
        {key:'accepted',label:'本人接手時間',children:handoff.acceptedAt?new Date(handoff.acceptedAt).toLocaleString('zh-TW'):'尚未接手'},
        {key:'resolved',label:'客服回覆時間',children:handoff.resolvedAt?new Date(handoff.resolvedAt).toLocaleString('zh-TW'):'尚未回覆'},
      ]} />
      {handoff.note&&<Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{handoff.note}</Typography.Paragraph>}
      {handoff.inspectionRevision!==item.repairInspection?.revision&&<Alert type="warning" showIcon message="檢修已改版，請重新送客服確認" />}
    </Card>}
    {workflow?.factory&&<Card size="small" title="原廠交運與返還">
      {workflow.factory.cancelled && <Alert showIcon type="warning" style={{marginBottom:12}} message="原廠處理已取消" description={workflow.factory.cancellationNote || undefined} />}
      <Descriptions size="small" bordered column={{xs:1,sm:2}} items={[
        {key:'name',label:'原廠',children:workflow.factory.factoryName || '—'},
        {key:'ref',label:'原廠委修單號',children:workflow.factory.reference || '—'},
        {key:'physical',label:'實際持有人',children:physical?CUSTODY[physical]:'依交接紀錄核對'},
        {key:'tracking',label:'承運商／追蹤號',children:`${workflow.factory.carrier || '—'} / ${workflow.factory.trackingNumber || '—'}`},
      ]} />
    </Card>}
    {workflow?.release?.purpose==='RETURN_UNREPAIRED'&&<Tag>未修原件 · {originalReturnStatus}</Tag>}
    {!!available.length&&<Card size="small" title="原件退回／原廠作業">
      <Space wrap>{available.map(value=><Tooltip key={value} title={value==='complete_factory'&&!repairReportReady(item)?completionReason:undefined}><span><Button disabled={busy || value==='complete_factory'&&!repairReportReady(item)} onClick={()=>setAction(value)}>{ACTION_LABELS[value]}</Button></span></Tooltip>)}</Space>
      {action&&available.includes(action)&&<Form form={form} name={`repair-workflow-${item.id}`} layout="vertical" initialValues={{location:item.location}} onValuesChange={()=>onDirtyChange(true)} onFinish={values=>void submit(values)} disabled={busy} style={{marginTop:16}}>
        <Typography.Paragraph strong>{ACTION_LABELS[action]}</Typography.Paragraph>
        {action==='send_factory'&&<>
          <Form.Item name="factoryName" label="送修原廠名稱" rules={required}><Input maxLength={160} /></Form.Item>
          <Form.Item name="reference" label="原廠委修單號" rules={required}><Input maxLength={200} /></Form.Item>
        </>}
        {tracking&&<>
          <Form.Item name="carrier" label={action==='send_factory'?'送廠承運商':'返還承運商'} rules={required}><Input maxLength={100} /></Form.Item>
          <Form.Item name="trackingNumber" label={action==='send_factory'?'送廠追蹤號':'返還追蹤號'} rules={required}><Input maxLength={100} /></Form.Item>
        </>}
        {confirmPhysical&&<>
          <Form.Item name="location" label={action==='send_factory'?'實際交運點／外送位置':'本人核對後存放位置'} rules={required}><Input maxLength={200} /></Form.Item>
          <Form.Item name="confirmedItems" valuePropName="checked" rules={[{validator:(_,value)=>value===true?Promise.resolve():Promise.reject(new Error('請本人核對實物與配件'))}]}><Checkbox>{action==='send_factory'?'我已核對原件、SN與配件並實際交運':action==='receive_factory'?'我本人已收到返還件並核對原件、SN與配件':'我已核對未修原件、SN與交回配件'}</Checkbox></Form.Item>
        </>}
        <Form.Item name="note" label={action==='accept_factory'?'收件依據':action==='cancel_factory'?'取消原因':'作業紀錄'} rules={required}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
        {failure&&!onFailure&&<Alert style={{marginBottom:12}} type="error" showIcon message={failure} />}
        <Button type="primary" htmlType="submit" loading={busy} disabled={action==='complete_factory'&&!repairReportReady(item)}>確認{ACTION_LABELS[action]}</Button>
      </Form>}
    </Card>}
  </>;
}
