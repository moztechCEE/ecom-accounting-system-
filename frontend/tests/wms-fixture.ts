import type { Plugin } from 'vite'
import { createSimulation, SimulationError, type FixtureRole } from './wms-simulator'
export function wmsFixture():Plugin {
  const simulation=createSimulation()
  return {name:'local-wms-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    const url=new URL(req.url||'/','http://localhost'), prefix='/api/v1/wms/workbench/orders'
    if(!url.pathname.startsWith(prefix))return next()
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
    const send=(status:number,data:unknown)=>{res.statusCode=status;res.end(JSON.stringify(data))}
    const role=String(req.headers['x-wms-fixture-role']||'admin') as FixtureRole
    if(!['admin','picker','packer','dispatcher','shipping'].includes(role))return send(403,{})
    try {
      if(req.method==='POST') {
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{})}
        const body=JSON.parse(raw), match=url.pathname.match(/\/orders\/([^/]+)\/(pick|pack)\/(claim|scan)$/)
        if(body.entityId!=='test-entity')return send(403,{})
        if(!match)return send(404,{})
        return send(200,simulation.command(match[1],role,match[2],match[3],body))
      }
      if(req.method!=='GET')return send(405,{})
      if(url.searchParams.get('entityId')!=='test-entity')return send(403,{})
      if(url.pathname!==prefix)return send(200,simulation.detail(url.pathname.slice(prefix.length+1),role))
      if(url.searchParams.get('search')==='simulate-error')return send(503,{})
      const area=url.searchParams.get('area')||'overview', view=url.searchParams.get('view')||'all', search=url.searchParams.get('search')||''
      const rows=simulation.orders.filter(r=>simulation.canRead(r,role)&&(!search||r.orderNumber.includes(search))&&
        (area==='pick'?['pending','picking'].includes(r.state):area==='pack'?view==='completed'?r.state==='completed':['picked','packing'].includes(r.state):area==='shipping'?r.state==='completed':true)&&
        (view==='all'||view==='logistics'&&r.logisticsLabel!=='尚無物流紀錄'||view==='returns'&&r.logisticsLabel==='退回物流中心'||view==='packing'&&['picked','packing'].includes(r.state)||r.state===view))
      const page=Math.max(1,Number(url.searchParams.get('page')||1))
      send(200,{items:rows.slice((page-1)*25,page*25).map(({items,allowedActions,blockers,...row})=>row),total:rows.length,mode:'read_only',source:'fixture'})
    }catch(e){send(e instanceof SimulationError?e.status:400,{message:e instanceof Error?e.message:'Invalid request'})}
  })}}
}
