import { DEPARTMENT_ACCESS_SELECT, effectivePermissionKeys } from '../../../common/department-access/department-access';
import { ForbiddenException, ServiceUnavailableException, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createPrivateKey, createHash } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { managementPermissions, ManagementSection, projectManagement } from './wms-management.contract';
const permissions = { dispatch:'wms_orders:create', pick:'wms_picking:execute', pack:'wms_packing:execute', shipping:'wms_shipping:execute', ...managementPermissions };
export type Station = keyof typeof permissions;
type Query = {area?:string;view?:string;search?:string;page?:number;pageSize?:number;entityId:string;days?:number;status?:string;pickPage?:number;packPage?:number};
const unavailable=()=>new ServiceUnavailableException({code:'WMS_SOURCE_NOT_APPROVED',message:'WMS 安全連線與員工對照尚未開通'});
const invalid=()=>new ServiceUnavailableException({code:'WMS_RESPONSE_INVALID',message:'WMS 回應格式不符，請勿依此作業'});
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>;}
function text(value:unknown,max=256):string {if(typeof value!=='string'||value.length>max)throw invalid();return value;}
function count(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw invalid();return value;}
function nativeIntakeReceipt(data:Record<string,unknown>) {
  const fields=['nativeIntakeId','wmsOrderId','workBarcode','batchId','reservationAccepted'];
  // Older ECOUNT/workspace responses have none of these fields. A native
  // receipt is an indivisible set; never turn a partial receipt into a link.
  if(!fields.some(key=>Object.hasOwn(data,key)))return {};
  if(!fields.every(key=>Object.hasOwn(data,key)))throw invalid();
  const id=(value:unknown)=>{
    const result=count(value);
    if(result<1||result>2147483647)throw invalid();
    return result;
  };
  if(typeof data.workBarcode!=='string'||!/^WT[0-9A-F]{18}$/.test(data.workBarcode)||typeof data.reservationAccepted!=='boolean')throw invalid();
  return {nativeIntakeId:id(data.nativeIntakeId),wmsOrderId:id(data.wmsOrderId),workBarcode:data.workBarcode,batchId:id(data.batchId),reservationAccepted:data.reservationAccepted};
}
function row(value:unknown) {
  const r=record(value);
  return {id:text(r.id,128),orderNumber:text(r.orderNumber),brand:text(r.brand,128),state:text(r.state,64),
    warehouseLabel:text(r.warehouseLabel),logisticsLabel:text(r.logisticsLabel),receiptLabel:text(r.receiptLabel),
    assignee:r.assignee===null?null:text(r.assignee),updatedAt:text(r.updatedAt,64),
    required:count(r.required),picked:count(r.picked),packed:count(r.packed)};
}
export function projectWorkspaceResponse(value:unknown,detail:boolean,expectedId?:string,writable=false,station?:string) {
  const data=record(value);
  if(data.source!=='wms'||data.contractVersion!==(writable?'wms.workspace-command.v1':'wms.workspace-read.v1'))throw invalid();
  if(!detail){
    if(data.mode!=='read_only'||!Array.isArray(data.items)||data.items.length>100)throw invalid();
    if(data.readyKeys!==undefined&&(!Array.isArray(data.readyKeys)||data.readyKeys.length>50000))throw invalid();
    return {items:data.items.map(row),total:count(data.total),...(Array.isArray(data.readyKeys)?{readyKeys:data.readyKeys.map(k=>text(k,128))}:{}),mode:'read_only',source:'wms'};
  }
  if(data.id!==expectedId||!Array.isArray(data.items)||data.items.length>1000||!Array.isArray(data.allowedActions)
    ||(writable?data.allowedActions.some(a=>!['pick','pack'].includes(station||'')||![`${station}:claim`,`${station}:scan`].includes(String(a))):data.allowedActions.length!==0))throw invalid();
  const items=data.items.map(value=>{
    const i=record(value);
    if(!Array.isArray(i.serials)||i.serials.length>10000)throw invalid();
    return {id:text(i.id,128),sku:text(i.sku),name:text(i.name),barcode:text(i.barcode),quantity:count(i.quantity),picked:count(i.picked),packed:count(i.packed),
      serials:i.serials.map(value=>{const s=record(value);if(!['pending','picked','packed'].includes(String(s.status)))throw invalid();return {value:text(s.value),status:text(s.status,16)};})};
  });
  if(writable){
    if(!Array.isArray(data.blockers)||data.blockers.length>100||count(data.revision)<1)throw invalid();
    if(items.some(i=>i.quantity<1||i.picked>i.quantity||i.packed>i.picked||i.serials.length&&i.serials.length!==i.quantity))throw invalid();
    if(items.some(i=>i.serials.length&&(i.serials.filter(s=>s.status!=='pending').length!==i.picked||i.serials.filter(s=>s.status==='packed').length!==i.packed)))throw invalid();
    if(items.reduce((n,i)=>n+i.quantity,0)!==data.required||items.reduce((n,i)=>n+i.picked,0)!==data.picked||items.reduce((n,i)=>n+i.packed,0)!==data.packed)throw invalid();
    return {...row(data),source:'wms',revision:count(data.revision),items,allowedActions:data.allowedActions.map(a=>text(a)),blockers:data.blockers.map(b=>text(b)),
      ...(station==='dispatch'?nativeIntakeReceipt(data):{})};
  }
  return {...row(data),source:'wms',revision:0,items,allowedActions:[],blockers:['作業寫入尚未啟用']};
}
export class WmsWorkspaceBridge {
  constructor(private readonly prisma:PrismaService,private readonly env:NodeJS.ProcessEnv=process.env,private readonly fetcher:typeof fetch=fetch){}
  async stations(actorId:string):Promise<Station[]> {
    const actor=await this.prisma.user.findUnique({where:{id:actorId},select:{isActive:true,mustChangePassword:true,employee:{select:DEPARTMENT_ACCESS_SELECT}}});
    if(!actor?.isActive||actor.mustChangePassword)throw new ForbiddenException('WMS_ACTOR_INACTIVE');
    const roles=await this.prisma.userRole.findMany({where:{userId:actorId},include:{role:{include:{permissions:{include:{permission:true}}}}}});
    const all=roles.some(r=>['ADMIN','SUPER_ADMIN'].includes(r.role.code));
    const held=new Set(effectivePermissionKeys({roles,employee:actor.employee}));
    if(!all&&!held.has('wms_tasks:read'))throw new ForbiddenException('WMS_TASK_ACCESS_REQUIRED');
    return (Object.keys(permissions) as Station[]).filter(s=>all||held.has(permissions[s]));
  }
  async command(actorId:string,entityId:string,id:string,station:Station,kind:'claim'|'scan'|'dispatch',body:Record<string,unknown>){
    if(this.env.WMS_WORKSPACE_COMMANDS_ENABLED!=='true')throw unavailable();
    return this.read(actorId,{entityId,area:station},id,{kind,body});
  }
  async readManagement(actorId:string,query:Query,section:ManagementSection) {
    if(!Object.hasOwn(managementPermissions,section))throw new BadRequestException('WMS_SECTION_INVALID');
    return this.read(actorId,{...query,area:section},undefined,undefined,section);
  }
  async read(actorId:string,query:Query,id?:string,command?:{kind:string;body:Record<string,unknown>},management?:ManagementSection) {
    if(this.env.WMS_WORKSPACE_READ_ENABLED!=='true')throw unavailable();
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(actorId)||!/^[A-Za-z0-9_-]{1,128}$/.test(query.entityId)|| (id!==undefined&&!/^[A-Za-z0-9_-]{1,128}$/.test(id)))throw new BadRequestException('WMS_SCOPE_INVALID');
    const allowed=await this.stations(actorId);
    const area=query.area||allowed[0];
    if(!area||!allowed.includes(area as Station))throw new ForbiddenException('WMS_STATION_DENIED');
    let base:URL, privateKey:string;
    try {
      base=new URL(this.env.WMS_WORKSPACE_URL||'');
      const localTest=this.env.NODE_ENV==='test'&&base.protocol==='http:'&&base.hostname==='127.0.0.1';
      if((base.protocol!=='https:'&&!localTest)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error();
      privateKey=this.env.WMS_WORKSPACE_PRIVATE_KEY||'';
      const key=createPrivateKey(privateKey);
      if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength||0)<2048||!this.env.WMS_WORKSPACE_ISSUER||!this.env.WMS_WORKSPACE_AUDIENCE)throw Error();
    }catch{throw unavailable();}
    const writable=!!id&&['pick','pack','dispatch'].includes(area)&&this.env.WMS_WORKSPACE_COMMANDS_ENABLED==='true';
    const method=command?'POST':'GET',body=command?.body||{};
    const suffix=management?'/management/'+management:'/orders'+(id?'/'+encodeURIComponent(id):'')+(command?'/'+command.kind:'');
    const url=new URL((writable?'/api/integrations/erp/workflow/v1':'/api/integrations/erp/v1')+suffix,base);
    if(!writable)for(const key of ['view','search','page','pageSize'] as const)if(query[key]!==undefined)url.searchParams.set(key,String(query[key]));
    if(management){url.searchParams.delete('view');url.searchParams.delete('pageSize');for(const key of ['days','status','pickPage','packPage'] as const)if(query[key]!==undefined)url.searchParams.set(key,String(query[key]));}
    const token=await new JwtService().signAsync({entityId:query.entityId,station:area,scope:writable?'wms.workspace.command':'wms.workspace.read',
      ...(writable?{method,path:suffix,bodyHash:createHash('sha256').update(JSON.stringify(body)).digest('hex')}:{})},
      {privateKey,algorithm:'RS256',issuer:this.env.WMS_WORKSPACE_ISSUER,audience:this.env.WMS_WORKSPACE_AUDIENCE,subject:actorId,expiresIn:45});
    let result:unknown;
    try {
      const response=await this.fetcher(url,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
      if(response.status===403)throw new ForbiddenException('WMS_SCOPE_DENIED');
      if(response.status===404)throw new NotFoundException('WMS_ORDER_NOT_ACCESSIBLE');
      if(response.status===409)throw new ConflictException('WMS_REVISION_OR_REQUEST_CONFLICT');
      if(response.status===400||response.status===422)throw new BadRequestException('WMS_INPUT_OR_SCAN_INVALID');
      if(!response.ok||!response.headers.get('content-type')?.includes('application/json')||!response.body)throw Error();
      const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
      try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1048576)throw Error();chunks.push(value);}}
      finally{await reader.cancel();}
      result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(e){if(e instanceof ForbiddenException||e instanceof NotFoundException||e instanceof ConflictException||e instanceof BadRequestException)throw e;throw new ServiceUnavailableException({code:command?'WMS_COMMAND_RESULT_UNKNOWN':'WMS_SOURCE_UNAVAILABLE',message:command?'結果尚未確認，請核對原請求紀錄':'WMS 連線未完成，請稍後重試'});}
    return management?projectManagement(result,management):projectWorkspaceResponse(result,!!id,id,writable,area);
  }
}
