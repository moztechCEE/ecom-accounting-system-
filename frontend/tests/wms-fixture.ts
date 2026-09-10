import type { Plugin } from 'vite'
import { createSimulation, SimulationError, type FixtureRole } from './wms-simulator'
import { createManagementFixture } from './wms-management-fixture'
export function wmsFixture():Plugin {
  const simulation=createSimulation()
  const management=createManagementFixture(simulation.orders)
  const entries=new Map<string,{orderNumber:string;items:{id:string;name:string;sku:string;barcode:string;quantity:number}[]}>()
  return {name:'local-wms-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    const url=new URL(req.url||'/','http://localhost'), prefix='/api/v1/wms/workbench/orders'
    if(!url.pathname.startsWith('/api/v1/wms/workbench/')&&!['/api/v1/sales/order-options','/api/v1/sales/orders'].includes(url.pathname))return next()
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
    const send=(status:number,data:unknown)=>{res.statusCode=status;res.end(JSON.stringify(data))}
    const requestedRole=String(req.headers['x-wms-fixture-role']||'admin')
    if(!['admin','supervisor','business','worker','picker','packer','dispatcher','shipping'].includes(requestedRole))return send(403,{})
    const station=url.searchParams.get('area')||(/\/pack\//.test(url.pathname)?'pack':'pick')
    const role=(requestedRole==='worker'?(station==='pack'?'packer':'picker'):requestedRole==='business'?'dispatcher':requestedRole) as FixtureRole
    try {
      if(url.pathname.includes('/management/')) {
        if(req.method!=='GET'||!['admin','supervisor'].includes(requestedRole)||url.searchParams.get('entityId')!=='test-entity')return send(403,{})
        if(url.searchParams.get('search')==='simulate-error')return send(503,{})
        const data=management.read(url.pathname.split('/').pop()!,url.searchParams)
        return send(data?200:404,data||{})
      }
      // The supervisor fixture has report access, never a borrowed administrator command identity.
      if(requestedRole==='supervisor') {
        if(req.method!=='GET'||url.searchParams.get('entityId')!=='test-entity')return send(403,{})
        if(url.pathname.endsWith('/stations'))return send(200,['overview','logs','exceptions','scan-errors','defects'])
        if(url.pathname.startsWith(prefix+'/')&&url.searchParams.get('area')==='overview'){
          const detail=simulation.detail(url.pathname.slice(prefix.length+1),'admin');detail.allowedActions=[];return send(200,detail)
        }
        return send(403,{})
      }
      if(url.pathname==='/api/v1/sales/order-options')return ['business','admin'].includes(requestedRole)?send(200,{channels:[{id:'test-channel',name:'測試通路'}],customers:[],products:[{id:'test-cable',sku:'TEST-CABLE',name:'測試配件',salesPrice:100}]}):send(403,{})
      if(url.pathname==='/api/v1/sales/orders'){
        if(req.method!=='POST'||!['business','admin'].includes(requestedRole))return send(403,{})
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{})}
        const body=JSON.parse(raw);if(body.entityId!=='test-entity'||body.channelId!=='test-channel'||!body.externalOrderId?.trim()||!body.items?.length||body.items.some((i:any)=>i.productId!=='test-cable'||!Number.isInteger(i.qty)||i.qty<1))return send(400,{})
        const id='erp-entry-'+Buffer.from(body.externalOrderId).toString('hex');if(entries.has(id))return send(409,{message:'訂單編號已存在，請核對原單'})
        entries.set(id,{orderNumber:body.externalOrderId,items:body.items.map((i:any,n:number)=>({id:'line'+n,name:'測試配件',sku:'TEST-CABLE',barcode:'TEST-CABLE',quantity:i.qty}))});return send(200,{id})
      }
      if(url.pathname.endsWith('/stations'))return send(200,requestedRole==='admin'?['dispatch','pick','pack','overview','logs','exceptions','scan-errors','defects']:requestedRole==='worker'?['pick','pack']:[({picker:'pick',packer:'pack',dispatcher:'dispatch',shipping:'shipping'} as Record<string,string>)[role]])
      if(url.pathname.endsWith('/dispatch-orders'))return ['admin','dispatcher'].includes(role)?send(200,[{id:'erp-new-fixture',orderNumber:'TEST-ERP-NEW'},...Array.from(entries,([id,value])=>({id,orderNumber:value.orderNumber}))]):send(403,{})
      if(url.pathname.includes('/dispatch/')){
        if(!['admin','dispatcher'].includes(role))return send(403,{})
        const entry=entries.get(url.pathname.split('/').pop()!)||{orderNumber:'TEST-ERP-NEW',items:[{id:'new-item',name:'測試配件',sku:'TEST-CABLE',barcode:'TEST-CABLE',quantity:2}]}
        if(req.method==='GET')return send(200,{...entry,brand:'MOZTECH',sourceHash:'a'.repeat(64)})
        if(req.method==='POST'){
          let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{})}
          const body=JSON.parse(raw);if(body.entityId!=='test-entity'||body.sourceHash!=='a'.repeat(64))return send(400,{})
          const id=url.pathname.split('/').pop()!
          let created=simulation.orders.find(o=>o.id===id)
          if(!created){created={...structuredClone(simulation.orders[0]),id,orderNumber:entry.orderNumber,state:'pending',assignee:null,warehouseLabel:'待揀貨',picked:0,packed:0,required:entry.items.reduce((n,i)=>n+i.quantity,0),revision:1,items:entry.items.map(i=>({...i,picked:0,packed:0,serials:[]}))};simulation.orders.push(created)}
          return send(200,created)
        }
      }
      if(req.method==='POST') {
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{})}
        const body=JSON.parse(raw), match=url.pathname.match(/\/orders\/([^/]+)\/(pick|pack)\/(claim|scan)$/)
        if(body.entityId!=='test-entity')return send(403,{})
        if(!match)return send(404,{})
        try { const result=simulation.command(match[1],role,match[2],match[3],body);management.event(match[1],match[2],match[3],body.scanValue||'');return send(200,result) }
        catch(e){if(e instanceof SimulationError&&e.status===400)management.event(match[1],match[2],match[3],body.scanValue||'',true);throw e}
      }
      if(req.method!=='GET')return send(405,{})
      if(url.searchParams.get('entityId')!=='test-entity')return send(403,{})
      if(url.pathname!==prefix){const detail=simulation.detail(url.pathname.slice(prefix.length+1),role);if(url.searchParams.get('area')==='overview')detail.allowedActions=[];return send(200,detail)}
      if(url.searchParams.get('search')==='simulate-error')return send(503,{})
      const area=url.searchParams.get('area')||'overview', view=url.searchParams.get('view')||'all', search=url.searchParams.get('search')||''
      const rows=simulation.orders.filter(r=>simulation.canRead(r,role)&&(!search||r.orderNumber.includes(search))&&
        (area==='pick'?['pending','picking'].includes(r.state):area==='pack'?view==='completed'?r.state==='completed':['picked','packing'].includes(r.state):area==='shipping'?r.state==='completed':true)&&
        (view==='all'||view==='logistics'&&r.logisticsLabel!=='尚無物流紀錄'||view==='returns'&&r.logisticsLabel==='退回物流中心'||view==='packing'&&['picked','packing'].includes(r.state)||r.state===view))
      const page=Math.max(1,Number(url.searchParams.get('page')||1))
      const readyKeys=simulation.orders.filter(r=>simulation.canRead(r,role)&&(area==='pick'?r.state==='pending':area==='pack'?r.state==='picked':['pending','picked'].includes(r.state))).map(r=>r.id)
      send(200,{items:rows.slice((page-1)*25,page*25).map(({items,allowedActions,blockers,...row})=>({...row,...(area==='pack'&&row.state==='picked'?{assignee:null}:{})})),total:rows.length,readyKeys,mode:'read_only',source:'fixture'})
    }catch(e){send(e instanceof SimulationError?e.status:400,{message:e instanceof Error?e.message:'Invalid request'})}
  })}}
}
