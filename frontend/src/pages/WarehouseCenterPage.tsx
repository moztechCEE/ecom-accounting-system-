import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Input, Progress, Segmented, Space, Table, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useEntityContext } from '../hooks/useEntityContext'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { warehouseAreas } from '../config/workspaces'
import type { WarehouseRow as Row } from '../services/warehouse.types'
import WarehouseOrderPanel from '../components/WarehouseOrderPanel'
import './WarehouseCenterPage.css'

type Page = { items: Row[]; total: number; mode: 'read_only'; source: string }
export default function WarehouseCenterPage() {
  const entityId = useEntityContext()
  return <WarehouseWorkspace key={entityId} entityId={entityId} />
}
function WarehouseWorkspace({entityId}:{entityId:string}) {
  const { user } = useAuth()
  const areas = warehouseAreas(user)
  const [chosenArea, setChosenArea] = useState('')
  const area = areas.find(a => a.key === chosenArea)?.key || areas[0]?.key || 'overview'
  const [view,setView]=useState('all'), [search,setSearch]=useState(''), [query,setQuery]=useState('')
  const [page,setPage]=useState(1), [refresh,setRefresh]=useState(0), [loading,setLoading]=useState(false)
  const [data,setData]=useState<Page|null>(null), [error,setError]=useState(''), [selected,setSelected]=useState<Row|null>(null)
  useEffect(()=>{
    const abort=new AbortController(); setLoading(true); setData(null); setError(''); setSelected(null)
    if(!entityId){setError('請先選擇公司');setLoading(false);return ()=>abort.abort()}
    api.get<Page>('/wms/workbench/orders',{params:{entityId,area,view,search:query,page,pageSize:25},signal:abort.signal})
      .then(response=>{if(!abort.signal.aborted)setData(response.data)})
      .catch(err=>{if(!abort.signal.aborted)setError(err.response?.status===503?'WMS 安全連線與員工對照尚未開通':'無法讀取儲運資料，請重試或確認權限')})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false)})
    return ()=>abort.abort()
  },[entityId,area,view,query,page,refresh])
  return <section className="warehouse-center">
    <header><Typography.Title level={2}>{areas.find(a=>a.key===area)?.label || '出貨工作台'}</Typography.Title><Button icon={<ReloadOutlined />} onClick={()=>setRefresh(x=>x+1)} loading={loading}>重新整理</Button></header>
    {areas.length > 1 && <Segmented aria-label="作業區域" value={area} options={areas.map(a=>({value:a.key,label:a.label}))} onChange={value=>{setChosenArea(value);setView('all');setPage(1);setSelected(null)}} />}
    <Space wrap className="warehouse-toolbar">
      <Segmented value={view} onChange={value=>{setView(value);setPage(1)}} options={area==='pick' ? [
        {label:'待處理',value:'all'},{label:'待揀貨',value:'pending'},{label:'揀貨中',value:'picking'},
      ] : area==='pack' ? [{label:'待處理',value:'all'},{label:'核對完成',value:'completed'}] : [
        {label:'全部',value:'all'},{label:'待揀貨',value:'pending'},{label:'揀貨中',value:'picking'},
        {label:'裝箱',value:'packing'},{label:'核對完成',value:'completed'},
        {label:'物流追蹤',value:'logistics'},{label:'未取退回',value:'returns'},
      ]}/>
      <Input.Search aria-label="搜尋訂單或物流單號" placeholder="訂單／物流單號" value={search} allowClear onChange={event=>setSearch(event.target.value)} onSearch={value=>{setQuery(value);setPage(1)}} style={{width:250}}/>
    </Space>
    {error && <Alert type="warning" showIcon message={error} description="本頁不會改動既有 WMS；無法連線不代表沒有訂單。" />}
    {data?.source==='fixture' && <Tag>操作預覽 · 測試資料</Tag>}
    <Table<Row> rowKey="id" dataSource={data?.items||[]} loading={loading} scroll={{x:900}}
      locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error?'資料尚未載入':'沒有符合的工作項目'} />}}
      pagination={data?{current:page,pageSize:25,total:data.total,showSizeChanger:false,onChange:setPage}:false}
      columns={[
        {title:'訂單',dataIndex:'orderNumber',render:(text,row)=><Button type="link" onClick={()=>setSelected(row)}>{text}</Button>},
        {title:'品牌',dataIndex:'brand',render:value=>value||'待對照'},
        {title:'作業狀態',dataIndex:'warehouseLabel'},
        ...(['pick','pack'].includes(area) ? [{title:'進度',render:(_:unknown,row:Row)=>{const count=area==='pick'?row.picked:row.packed;return <div style={{minWidth:100}}>{count} / {row.required} 件<Progress percent={row.required?Math.round(count/row.required*100):0} showInfo={false} size="small" /></div>}}] : [{title:'物流',dataIndex:'logisticsLabel'},{title:'退回實收',dataIndex:'receiptLabel'}]),
        {title:'處理人員',dataIndex:'assignee',render:value=>value||'未指派'},
        {title:'操作',render:(_,row)=><Button onClick={()=>setSelected(row)}>{area==='pick'?'揀貨':area==='pack'?'裝箱核對':'查看'}</Button>},
      ]}/>
    {selected && <WarehouseOrderPanel key={`${entityId}:${selected.id}:${area}`} entityId={entityId} order={selected} station={area} stage={area==='pick'||area==='pack'?area:null}
      onClose={()=>{setSelected(null);setRefresh(x=>x+1)}} />}
  </section>
}
