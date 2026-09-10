// Local synthetic workflow only. Never imported by production code.
import type { WarehouseDetail } from '../src/services/warehouse.types'
export type FixtureRole = 'admin' | 'picker' | 'packer' | 'dispatcher' | 'shipping'
export const stateLabels: Record<string,string> = { pending:'待揀貨',picking:'揀貨中',picked:'待裝箱',packing:'裝箱中',completed:'核對完成' }
export class SimulationError extends Error { constructor(public status:number, message:string) { super(message) } }
export function createSimulation() {
  const states=['pending','picking','picked','packing','completed']
  const orders:WarehouseDetail[]=Array.from({length:18},(_,i)=>{
    const state=states[i%5], picked=['picked','packing','completed'].includes(state)?3:state==='picking'?1:0
    const packed=state==='completed'?3:state==='packing'?1:0
    return {id:`wms-fixture-${i+1}`,orderNumber:`TEST-WMS-${String(i+1).padStart(4,'0')}`,brand:['MOZTECH','BONSON','AIRITY'][i%3],state,
      warehouseLabel:stateLabels[state],logisticsLabel:i===4?'到店待取':i===9?'退回物流中心':'尚無物流紀錄',receiptLabel:'尚未確認',
      assignee:['picking','packing'].includes(state)?(i===6?'其他同仁':state==='picking'?'測試揀貨員':'測試裝箱員'):null,
      updatedAt:'2026-09-10T00:00:00Z',required:3,picked,packed,revision:1,source:'fixture',allowedActions:[],blockers:i===7?['訂單異動待審核']:[],
      items:[{id:'tracked',name:'測試主機',sku:'TEST-DEVICE',barcode:'TEST-DEVICE',quantity:1,picked:picked>0?1:0,packed:packed>0?1:0,
        serials:[{value:`TEST-SN-${String(i+1).padStart(4,'0')}`,status:packed>0?'packed':picked>0?'picked':'pending'}]},
        {id:'accessory',name:'測試配件',sku:'TEST-CABLE',barcode:'TEST-CABLE',quantity:2,picked:Math.max(0,picked-1),packed:Math.max(0,packed-1),serials:[]}],
    }
  })
  const receipts=new Map<string,{body:string;result:WarehouseDetail}>()
  function canRead(order:WarehouseDetail,role:FixtureRole) {
    if(role==='picker') return order.state==='pending'||order.assignee==='測試揀貨員'&&['picking','picked','completed'].includes(order.state)
    if(role==='packer') return order.state==='picked'||order.assignee==='測試裝箱員'&&['packing','completed'].includes(order.state)
    return true
  }
  function detail(id:string,role:FixtureRole) {
    const row=orders.find(o=>o.id===id)
    if(!row||!canRead(row,role))throw new SimulationError(404,'Not available')
    const result=structuredClone(row)
    if(!row.blockers.length) {
      if(role==='admin'||role==='picker') {
        if(row.state==='pending')result.allowedActions.push('pick:claim')
        if(row.state==='picking'&&(role==='admin'||row.assignee==='測試揀貨員'))result.allowedActions.push('pick:scan')
      }
      if(role==='admin'||role==='packer') {
        if(row.state==='picked')result.allowedActions.push('pack:claim')
        if(row.state==='packing'&&(role==='admin'||row.assignee==='測試裝箱員'))result.allowedActions.push('pack:scan')
      }
    }
    return result
  }
  function command(id:string,role:FixtureRole,stage:string,kind:string,body:{expectedRevision:number;requestId:string;scanValue?:string}) {
    if(!body.requestId||body.requestId.length>64)throw new SimulationError(400,'Invalid request ID')
    const key=`${role}:${id}:${body.requestId}`, hash=JSON.stringify({stage,kind,...body}), cached=receipts.get(key)
    if(cached) {if(cached.body!==hash)throw new SimulationError(409,'Request ID reused'); return structuredClone(cached.result)}
    const before=detail(id,role)
    if(!before.allowedActions.includes(`${stage}:${kind}`))throw new SimulationError(409,'Not allowed')
    if(before.revision!==body.expectedRevision)throw new SimulationError(409,'Stale revision')
    const next=structuredClone(before); next.allowedActions=[]
    if(kind==='claim') {next.state=stage==='pick'?'picking':'packing';next.assignee=stage==='pick'?'測試揀貨員':'測試裝箱員'}
    else {
      const value=body.scanValue?.trim(), item=next.items.find(i=>i.serials.some(s=>s.value===value)) || next.items.find(i=>!i.serials.length&&i.barcode===value&&(stage==='pick'?i.picked<i.quantity:i.packed<i.picked))
      if(!item)throw new SimulationError(400,'Wrong barcode or SN required')
      const serial=item.serials.find(s=>s.value===value)
      if(serial) {
        if(stage==='pick'&&serial.status!=='pending'||stage==='pack'&&serial.status!=='picked')throw new SimulationError(409,'Duplicate or wrong stage SN')
        serial.status=stage==='pick'?'picked':'packed'
      }
      if(stage==='pick')item.picked++;else item.packed++
      next.picked=next.items.reduce((n,i)=>n+i.picked,0);next.packed=next.items.reduce((n,i)=>n+i.packed,0)
      if(next.picked===next.required&&next.packed===next.required)next.state='completed'
      else if(next.picked===next.required&&stage==='pick')next.state='picked'
    }
    next.revision++;next.warehouseLabel=stateLabels[next.state];next.updatedAt=new Date().toISOString()
    orders[orders.findIndex(o=>o.id===id)]=next
    const result=detail(id,role)
    receipts.set(key,{body:hash,result:structuredClone(result)})
    return result
  }
  return {orders,canRead,detail,command}
}
