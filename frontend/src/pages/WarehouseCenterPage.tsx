import { useEffect, useState } from 'react'
import { Alert, Button, Descriptions, Drawer, Empty, Input, Segmented, Space, Table, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useEntityContext } from '../hooks/useEntityContext'
import api from '../services/api'
import './WarehouseCenterPage.css'

type Row = { id: string; orderNumber: string; brand: string | null; warehouseLabel: string; logisticsLabel: string; receiptLabel: string; assignee: string | null; updatedAt: string }
type Page = { items: Row[]; total: number; mode: 'read_only'; source: string }
export default function WarehouseCenterPage() {
  const entityId = useEntityContext()
  return <WarehouseWorkspace key={entityId} entityId={entityId} />
}
function WarehouseWorkspace({entityId}:{entityId:string}) {
  const [view,setView]=useState('all'), [search,setSearch]=useState(''), [query,setQuery]=useState('')
  const [page,setPage]=useState(1), [refresh,setRefresh]=useState(0), [loading,setLoading]=useState(false)
  const [data,setData]=useState<Page|null>(null), [error,setError]=useState(''), [selected,setSelected]=useState<Row|null>(null)
  useEffect(()=>{
    const abort=new AbortController(); setLoading(true); setData(null); setError(''); setSelected(null)
    if(!entityId){setError('請先選擇公司');setLoading(false);return ()=>abort.abort()}
    api.get<Page>('/wms/workbench/orders',{params:{entityId,view,search:query,page,pageSize:25},signal:abort.signal})
      .then(response=>{if(!abort.signal.aborted)setData(response.data)})
      .catch(err=>{if(!abort.signal.aborted)setError(err.response?.status===503?'WMS 安全連線與員工對照尚未開通':'無法讀取儲運資料，請重試或確認權限')})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false)})
    return ()=>abort.abort()
  },[entityId,view,query,page,refresh])
  return <section className="warehouse-center">
    <header><Typography.Title level={2}>儲運管理中心</Typography.Title><Button icon={<ReloadOutlined />} onClick={()=>setRefresh(x=>x+1)} loading={loading}>重新整理</Button></header>
    <Space wrap className="warehouse-toolbar">
      <Segmented value={view} onChange={value=>{setView(value);setPage(1)}} options={[
        {label:'全部',value:'all'},{label:'待揀貨',value:'pending'},{label:'揀貨中',value:'picking'},
        {label:'裝箱',value:'packing'},{label:'核對完成',value:'completed'},
        {label:'物流追蹤',value:'logistics'},{label:'未取退回',value:'returns'},
      ]}/>
      <Input.Search aria-label="搜尋訂單或物流單號" placeholder="訂單／物流單號" value={search} allowClear onChange={event=>setSearch(event.target.value)} onSearch={value=>{setQuery(value);setPage(1)}} style={{width:250}}/>
    </Space>
    {error && <Alert type="warning" showIcon message={error} description="本頁不會改動既有 WMS；無法連線不代表沒有訂單。" />}
    {data?.source==='fixture' && <Tag>本機測試資料</Tag>}
    <Table<Row> rowKey="id" dataSource={data?.items||[]} loading={loading} scroll={{x:900}}
      locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error?'資料尚未載入':'沒有符合的工作項目'} />}}
      pagination={data?{current:page,pageSize:25,total:data.total,showSizeChanger:false,onChange:setPage}:false}
      columns={[
        {title:'訂單',dataIndex:'orderNumber',render:(text,row)=><Button type="link" onClick={()=>setSelected(row)}>{text}</Button>},
        {title:'品牌',dataIndex:'brand',render:value=>value||'待對照'},
        {title:'倉儲作業',dataIndex:'warehouseLabel'}, {title:'物流',dataIndex:'logisticsLabel'},
        {title:'退回實收',dataIndex:'receiptLabel'}, {title:'處理人員',dataIndex:'assignee',render:value=>value||'未指派'},
        {title:'操作',render:(_,row)=><Button onClick={()=>setSelected(row)}>查看</Button>},
      ]}/>
    <Drawer title={selected?.orderNumber||'訂單'} open={!!selected} onClose={()=>setSelected(null)} width="min(640px, 100vw)">
      {selected && <Space direction="vertical" size={24} style={{width:'100%'}}>
        <Descriptions column={1} items={[
          {key:'brand',label:'品牌',children:selected.brand||'待對照'},
          {key:'warehouse',label:'倉儲作業',children:selected.warehouseLabel},
          {key:'logistics',label:'物流',children:selected.logisticsLabel},
          {key:'receipt',label:'退回實收',children:selected.receiptLabel},
          {key:'assignee',label:'處理人員',children:selected.assignee||'未指派'},
          {key:'time',label:'查詢時間',children:selected.updatedAt},
        ]}/>
        <Alert type="info" message="作業寫入待驗收" description="認領、掃碼、裝箱與交接尚未開通；核對完成不等於已交付物流。" />
      </Space>}
    </Drawer>
  </section>
}
