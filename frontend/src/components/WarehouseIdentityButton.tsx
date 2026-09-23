import { useState } from 'react'
import { Alert, Button, Modal, Select, Typography, message } from 'antd'
import api from '../services/api'

type Staff = { id:number; name:string; username:string; role:string; erp_user_id:string|null }
export default function WarehouseIdentityButton({userId,name}:{userId:string;name:string}) {
  const [open,setOpen]=useState(false)
  const [loading,setLoading]=useState(false)
  const [staff,setStaff]=useState<Staff[]>([])
  const [selected,setSelected]=useState<number>()
  const [error,setError]=useState('')
  const [loaded,setLoaded]=useState(false)
  const load=async()=>{
    setOpen(true);setLoading(true);setLoaded(false);setError('');setSelected(undefined)
    try {const {data}=await api.get('/wms/portal/staff');setStaff(data.items);setSelected(data.items.find((s:Staff)=>s.erp_user_id===userId)?.id);setLoaded(true)}
    catch(e:any){setError(e.response?.data?.message || '無法取得儲運帳號')}
    finally{setLoading(false)}
  }
  const save=async()=>{
    setLoading(true);setError('')
    try{await api.post('/wms/portal/bind',{userId,wmsUserId:selected});message.success('已連結既有儲運帳號');setOpen(false)}
    catch(e:any){setError(e.response?.data?.message || '無法連結帳號')}
    finally{setLoading(false)}
  }
  const linked=staff.find(s=>s.erp_user_id===userId)
  return <><Button type="text" onClick={load}>儲運帳號</Button><Modal title={`${name} · 儲運帳號`} open={open} onCancel={()=>setOpen(false)} onOk={save} okText="連結帳號" confirmLoading={loading} okButtonProps={{disabled:!loaded || !selected || !!linked}}>
    <Typography.Paragraph>先在角色設定指派倉儲人員，或具備出貨管理權限的角色。新進人員首次進入工作台時，會自動建立儲運身分。</Typography.Paragraph>
    <Typography.Paragraph>已有儲運紀錄的人員，請連結本人原帳號，保留原有任務與操作歷程。連結後改由營運管理系統統一登入。</Typography.Paragraph>
    {error && <Alert type="error" message={error} style={{marginBottom:16}}/>}
    <Select aria-label="既有儲運帳號" style={{width:'100%'}} loading={loading} disabled={!!linked} value={selected} onChange={setSelected} placeholder="選擇本人原有的儲運帳號" options={staff.map(s=>({value:s.id,label:`${s.name}（${s.username}）`,disabled:!!s.erp_user_id && s.erp_user_id!==userId}))}/>
    {linked && <Typography.Paragraph style={{marginTop:12}}>已連結，作業權限由營運管理系統的角色設定決定。</Typography.Paragraph>}
  </Modal></>
}
