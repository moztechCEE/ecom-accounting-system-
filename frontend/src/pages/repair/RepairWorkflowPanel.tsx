import { useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, Space, Tag, Typography, message } from 'antd';
import { repairService } from '../../services/repair';
import { errorText } from '../mailroom/model';
import { CUSTODY, CSR_STATUS, WORKFLOW_ACTIONS, repairReportReady } from './repair-model';
import type { RepairItem, RepairWorkflowAction, RepairWorkflowCommand } from './repair-model';
import { currentPhysicalCustody } from '../mailroom/item-custody';
const TECH_ACTIONS:RepairWorkflowAction[]=['return_original','send_factory','accept_factory','request_factory_return','cancel_factory','receive_factory','complete_factory'];
type Fields={note:string;confirmedItems?:boolean;location?:string;factoryName?:string;reference?:string;carrier?:string;trackingNumber?:string};
const required=[{required:true,whitespace:true,message:'請填寫實際作業資料'}];
export default function RepairWorkflowPanel({item,entityId,canUpdate,onSaved,onDirtyChange,onBeforeAction}:{item:RepairItem;entityId:string;canUpdate:boolean;onSaved:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void;onBeforeAction:()=>Promise<boolean>}) {
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
  async function submit(values:Fields) {
    if(!action||!available.includes(action)||running.current)return;
    running.current=true;setBusy(true);setFailure('');
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
      onDirtyChange(false);await onSaved();message.success('已保存實際作業與交接紀錄');
    } catch(error){setFailure(saved?'作業已保存，但重新載入失敗。請重新開啟案件核對最新進度。':errorText(error));}
    finally{running.current=false;setBusy(false);}
  }
  return <>
    {handoff&&<Card size="small" title="客服部門交辦">
      <Space wrap style={{marginBottom:12}}><Tag color={handoff.status==='ACCEPTED'?'blue':handoff.status==='RESOLVED'?'green':'orange'}>{CSR_STATUS[handoff.status] || handoff.status}</Tag><Tag>依檢修 v{handoff.inspectionRevision}</Tag>{handoff.quoteRevision!=null&&<Tag>售後報價 v{handoff.quoteRevision}</Tag>}{handoff.decision&&<Tag>{handoff.decision==='APPROVE'?'方案確認通過':'方案拒絕／不進行維修'}</Tag>}</Space>
      <Descriptions size="small" column={2} items={[
        {key:'owner',label:'接手客服',children:handoff.ownerName || (handoff.ownerId?item.repairInspection?.review?.name || '已由本人接手':'尚未接手')},
        {key:'sent',label:'交辦時間',children:handoff.sentAt?new Date(handoff.sentAt).toLocaleString('zh-TW'):'—'},
        {key:'accepted',label:'本人接手時間',children:handoff.acceptedAt?new Date(handoff.acceptedAt).toLocaleString('zh-TW'):'尚未接手'},
        {key:'resolved',label:'客服回覆時間',children:handoff.resolvedAt?new Date(handoff.resolvedAt).toLocaleString('zh-TW'):'尚未回覆'},
      ]} />
      {handoff.note&&<Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{handoff.note}</Typography.Paragraph>}
      {handoff.inspectionRevision!==item.repairInspection?.revision&&<Alert type="warning" showIcon message="此交辦不是目前檢修版次，請重新交客服確認" />}
      <Typography.Paragraph type="secondary" style={{marginBottom:0}}>客服接手及方案回覆各有獨立紀錄。正式對客同意與必要款項以售後來源為準；通知送達不等於客服已接手。</Typography.Paragraph>
    </Card>}
    {workflow?.factory&&<Card size="small" title="原廠交運與返還">
      {workflow.factory.cancelled && <Alert showIcon type="warning" style={{marginBottom:12}} message="原廠處理已取消，實物仍依目前持有人" description={workflow.factory.cancellationNote || '取消處理不等於原廠已寄回；請取得實際返還物流後再登記。'} />}
      <Descriptions size="small" bordered column={{xs:1,sm:2}} items={[
        {key:'name',label:'原廠',children:workflow.factory.factoryName || '—'},
        {key:'ref',label:'原廠委修單號',children:workflow.factory.reference || '—'},
        {key:'physical',label:'實際持有人',children:physical?CUSTODY[physical]:'依交接紀錄核對'},
        {key:'tracking',label:'承運商／追蹤號',children:`${workflow.factory.carrier || '—'} / ${workflow.factory.trackingNumber || '—'}`},
      ]} />
      <Typography.Paragraph type="secondary" style={{margin:'12px 0 0'}}>送達原廠、原廠接收、返還在途及維修師本人簽收分別留存。收到返還件後再依原廠處理單記錄實際結果與複驗。</Typography.Paragraph>
    </Card>}
    {workflow?.release?.purpose==='RETURN_UNREPAIRED'&&<Alert showIcon type="info" message="原件未維修退回" description="此件按未修原件交回，不標成已修理或已替換，也不以維修完成複驗冒充處理結果。後續由收發室本人簽收並安排原件寄回。" />}
    {!!available.length&&<Card size="small" title="原件退回／原廠作業">
      <Space wrap>{available.map(value=><Button key={value} disabled={busy || value==='complete_factory'&&!repairReportReady(item)} onClick={()=>setAction(value)}>{WORKFLOW_ACTIONS[value]}</Button>)}</Space>
      {action&&available.includes(action)&&<Form form={form} name={`repair-workflow-${item.id}`} layout="vertical" initialValues={{location:item.location}} onValuesChange={()=>onDirtyChange(true)} onFinish={values=>void submit(values)} disabled={busy} style={{marginTop:16}}>
        <Typography.Paragraph strong>{WORKFLOW_ACTIONS[action]}</Typography.Paragraph>
        {action==='return_original'&&<Alert showIcon type="warning" style={{marginBottom:16}} message="退回的是未修理原件" description="必須有目前版次的客服拒修結果或原件退回方案確認。保留拒修原因、原件品況與配件；此動作不會填造已維修紀錄。" />}
        {action==='send_factory'&&<>
          <Form.Item name="factoryName" label="送修原廠名稱" rules={required}><Input maxLength={160} /></Form.Item>
          <Form.Item name="reference" label="原廠委修單號" rules={required}><Input maxLength={200} /></Form.Item>
        </>}
        {action==='cancel_factory'&&<Alert showIcon type="warning" style={{marginBottom:16}} message="僅取消原廠處理，不改實際持有人" description="請記錄取消原因。原廠尚未交回物流時，不填造追蹤號或將案件記成已寄回；取得返還物流後另登記。" />}
        {action==='request_factory_return'&&<Alert showIcon type="info" style={{marginBottom:16}} message="原廠已實際交運返還" description="核對實際承運商與返還追蹤號後，才記錄為返還在途；要求原廠寄回或取消處理本身不算交運。" />}
        {tracking&&<>
          <Form.Item name="carrier" label={action==='send_factory'?'送廠承運商':'返還承運商'} rules={required}><Input maxLength={100} /></Form.Item>
          <Form.Item name="trackingNumber" label={action==='send_factory'?'送廠追蹤號':'返還追蹤號'} rules={required}><Input maxLength={100} /></Form.Item>
        </>}
        {confirmPhysical&&<>
          <Form.Item name="location" label={action==='send_factory'?'實際交運點／外送位置':'本人核對後存放位置'} rules={required}><Input maxLength={200} /></Form.Item>
          <Form.Item name="confirmedItems" valuePropName="checked" rules={[{validator:(_,value)=>value===true?Promise.resolve():Promise.reject(new Error('請本人核對實物與配件'))}]}><Checkbox>{action==='send_factory'?'我已核對原件、SN與配件並實際交運':action==='receive_factory'?'我本人已收到返還件並核對原件、SN與配件':'我已核對未修原件、SN與交回配件'}</Checkbox></Form.Item>
        </>}
        <Form.Item name="note" label={action==='accept_factory'?'原廠收件證據／確認方式':'作業原因、實際品況與交接依據'} rules={required}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
        {failure&&<Alert style={{marginBottom:12}} type="error" showIcon message={failure} />}
        <Button type="primary" htmlType="submit" loading={busy} disabled={action==='complete_factory'&&!repairReportReady(item)}>確認保存{WORKFLOW_ACTIONS[action]}</Button>
      </Form>}
    </Card>}
  </>;
}
