import type { Plugin } from 'vite'
const states = ['pending','picking','picked','packing','completed']
const labels:Record<string,string>={pending:'待揀貨',picking:'揀貨中',picked:'待裝箱',packing:'裝箱中',completed:'核對完成'}
export function wmsFixture():Plugin {
  return {name:'local-wms-fixture',configureServer(server){server.middlewares.use((req,res,next)=>{
    const url=new URL(req.url||'/','http://localhost')
    if(url.pathname!=='/api/v1/wms/workbench/orders')return next()
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
    if(req.method!=='GET'){res.statusCode=405;res.end('{}');return}
    if(url.searchParams.get('entityId')!=='test-entity'){res.statusCode=403;res.end('{}');return}
    if(url.searchParams.get('search')==='simulate-error'){res.statusCode=503;res.end('{}');return}
    const all=Array.from({length:38},(_,i)=>({id:'wms-fixture-'+(i+1),orderNumber:'TEST-WMS-'+String(i+1).padStart(4,'0'),brand:i%3===0?null:['AIRITY','MOZTECH','BONSON'][i%3],warehouseLabel:labels[states[i%5]],logisticsLabel:i%7===0?'退回物流中心':i%5===4?'到店待取':'尚無物流紀錄',receiptLabel:'尚未確認',assignee:i%2?'測試揀貨員':null,updatedAt:'2026-09-10T00:00:00Z',state:states[i%5]}))
    const view=url.searchParams.get('view')||'all', search=url.searchParams.get('search')||''
    const rows=all.filter(r=>(!search||r.orderNumber.includes(search))&&(view==='all'||view==='logistics'&&r.logisticsLabel!=='尚無物流紀錄'||view==='returns'&&r.logisticsLabel==='退回物流中心'||view==='packing'&&['picked','packing'].includes(r.state)||r.state===view))
    const page=Math.max(1,Number(url.searchParams.get('page')||1))
    res.end(JSON.stringify({items:rows.slice((page-1)*25,page*25),total:rows.length,mode:'read_only',source:'fixture'}))
  })}}
}
