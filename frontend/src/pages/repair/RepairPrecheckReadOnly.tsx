import { useEffect, useState } from 'react';
import { Button, Descriptions, Image, Space, Spin, Tag, Typography } from 'antd';
import api from '../../services/api';
import { repairPrecheckPhotoUrl, type RepairPrecheckPhoto, type RepairPrecheckView } from './repair-model';

const RESULTS = { NORMAL:'正常', ABNORMAL:'異常', NOT_TESTED:'未測試', NOT_APPLICABLE:'不適用' } as const;
const date = (value:string) => new Date(value).toLocaleString('zh-TW');
export default function RepairPrecheckReadOnly({record,entityId,itemId}:{record:RepairPrecheckView;entityId:string;itemId:string}) {
  if (record.state==='PENDING') return <section aria-label="收發初檢進度">
    <Tag>{record.stage==='DRAFT'?'收發初檢中':'初檢完成待交接'}</Tag>
    <Descriptions size="small" column={{xs:1,sm:2}} items={[
      {key:'revision',label:'版次',children:`v${record.revision}`},
      {key:'author',label:'記錄人',children:record.recordedBy},
      {key:'recordedAt',label:'記錄時間',children:date(record.recordedAt)},
    ]} />
  </section>;
  if (record.state !== 'SUBMITTED') return <Typography.Text type="secondary">{{NOT_STARTED:'尚未初檢',STALE:'初檢紀錄待更新',UNAVAILABLE:'初檢紀錄暫無法取得'}[record.state]}</Typography.Text>;
  return <section aria-label="收發初檢紀錄" style={{minWidth:0,overflowWrap:'anywhere'}}>
    <Descriptions size="small" column={{xs:1,sm:2}} items={[
      {key:'revision',label:'版次',children:`v${record.revision}`},
      {key:'author',label:'記錄人',children:record.recordedBy},
      {key:'recordedAt',label:'記錄時間',children:date(record.recordedAt)},
      {key:'submittedAt',label:'交辦時間',children:date(record.submittedAt)},
      ...(record.templateTitle ? [{key:'template',label:'初檢表',children:`${record.templateTitle} · v${record.templateRevision}`}] : []),
    ]} />
    {record.notRequiredReason && <Descriptions size="small" column={1} items={[{key:'reason',label:'不需初檢原因',children:record.notRequiredReason}]} />}
    {record.warrantyReview && <Descriptions size="small" column={1} items={[
      {key:'warranty',label:'人工保固核對',children:({CHECKED:'已人工核對',NEEDS_CORRECTION:'待修正',CORRECTED_EXTERNALLY:'已於保固後台修正'} as const)[record.warrantyReview.status]},
      {key:'warranty-author',label:'核對紀錄',children:`${record.warrantyReview.recordedByName} · ${date(record.warrantyReview.recordedAt)}`},
      ...(record.warrantyReview.warrantyNumber ? [{key:'warranty-number',label:'保固編號',children:record.warrantyReview.warrantyNumber}] : []),
      ...(record.warrantyReview.note ? [{key:'warranty-note',label:'核對說明',children:record.warrantyReview.note}] : []),
    ]} />}
    {record.mailroomIssue && <Descriptions size="small" column={1} items={[
      ...(record.mailroomIssue.symptom ? [{key:'symptom',label:'收發補充問題',children:record.mailroomIssue.symptom}] : []),
      ...(record.mailroomIssue.preliminaryReason ? [{key:'preliminary',label:'原因初判',children:record.mailroomIssue.preliminaryReason}] : []),
    ]} />}
    <ul style={{listStyle:'none',padding:0,margin:0}}>{record.checks.map(check=><li key={check.key} style={{marginBottom:12}}>
      <Space wrap><Typography.Text strong>{check.label}</Typography.Text><Tag color={check.result==='ABNORMAL'?'orange':undefined}>{RESULTS[check.result]}</Tag></Space>
      {check.note && <div style={{whiteSpace:'pre-wrap'}}>{check.note}</div>}
    </li>)}</ul>
    {!!record.photos.length && <PrecheckPhotos entityId={entityId} itemId={itemId} revision={record.revision} photos={record.photos} />}
  </section>;
}

function PrecheckPhotos({entityId,itemId,revision,photos}:{entityId:string;itemId:string;revision:number;photos:RepairPrecheckPhoto[]}) {
  const [attempt,setAttempt]=useState(0);
  const scope=JSON.stringify({entityId,itemId,revision,photos,attempt});
  const [loaded,setLoaded]=useState<{scope:string;images:{id:string;url:string}[];failed:boolean}>();
  useEffect(()=>{
    const current=JSON.parse(scope) as {entityId:string;itemId:string;revision:number;photos:RepairPrecheckPhoto[]};
    const controller=new AbortController(), urls:string[]=[];
    let active=true;
    void Promise.all(current.photos.map(async photo=>{
      try {
        const path=repairPrecheckPhotoUrl(photo,current.itemId,current.revision);
        if (!path || !current.entityId) return undefined;
        const response=await api.get<Blob>(path,{params:{entityId:current.entityId},responseType:'blob',signal:controller.signal});
        if (!active) return undefined;
        const blob=response.data;
        if (!(blob instanceof Blob) || !['image/jpeg','image/png','image/webp'].includes(blob.type) || !blob.size || blob.size>1024*1024) return undefined;
        const url=URL.createObjectURL(blob);urls.push(url);
        return {id:photo.id,url};
      } catch { return undefined; }
    })).then(results=>{
      if (active) setLoaded({scope,images:results.filter((image):image is {id:string;url:string}=>!!image),failed:results.some(image=>!image)});
    });
    return ()=>{active=false;controller.abort();urls.forEach(url=>URL.revokeObjectURL(url));};
  },[scope]);
  const current=loaded?.scope===scope ? loaded : undefined;
  return <div aria-label="初檢照片">
    {!current && <Spin size="small" />}
    {!!current?.images.length && <Image.PreviewGroup><Space wrap>{current.images.map((image,index)=><Image key={image.id} width={96} height={96} style={{objectFit:'cover'}} src={image.url} alt={`初檢照片 ${index+1}`} />)}</Space></Image.PreviewGroup>}
    {current?.failed && <Space wrap><Typography.Text role="alert" type="danger">初檢照片暫無法取得</Typography.Text><Button size="small" onClick={()=>setAttempt(value=>value+1)}>重新載入照片</Button></Space>}
  </div>;
}
