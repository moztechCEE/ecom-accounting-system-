import { companyCsrCurrent, refurbishmentStartReady, inspectionReviewCurrent, sourceDispositionCurrent, sourceMaterialsCurrent, sourceTemplateCurrent, sourceWorkStartCurrent } from './repair-model';
import type { RepairItem, RepairWorkflowAction } from './repair-model';
import { repairReadiness } from './repair-readiness';
import type { RepairReadinessContext } from './repair-readiness';
import { currentPhysicalCustody } from '../mailroom/item-custody';

export type RepairNextStepContext = RepairReadinessContext & { confirmed?:boolean;location?:string;note?:string };
export type RepairNextAction = {name:string;label:string;disabled?:boolean;reason?:string};
export function repairDispositionRoute(item:RepairItem):boolean {
  const doc=item.repairInspection, csr=item.repairWorkflow?.csr;
  return item.receipt.category==='REPAIR' && !!doc && inspectionReviewCurrent(doc) && csr?.status==='RESOLVED'
    && csr.inspectionRevision===doc.revision && csr.estimateRevision===doc.revision && csr.planHash===doc.review?.planHash && csr.quoteRevision===doc.review?.quoteRevision && csr.decision===doc.review?.decision
    && (['RETURN','SCRAP'].includes(doc.data.plan) || csr.decision==='DECLINE');
}
export function repairWorkflowGate(item:RepairItem,action:RepairWorkflowAction,context:RepairReadinessContext):{ready:boolean;reason?:string} {
  if(!context.canUpdate || !context.viewerId || item.repairOwnerId!==context.viewerId || !item.allowedWorkflowActions?.includes(action))return {ready:false,reason:'目前作業未開放'};
  if(action==='start_refurbishment') {
    if(item.custodianId!==context.viewerId || item.editable!==true || currentPhysicalCustody(item)!=='TECHNICIAN')return {ready:false,reason:'本人實物簽收未確認'};
    if(sourceWorkStartCurrent(item))return {ready:false,reason:'本版整新已開始'};
    if(!companyCsrCurrent(item))return {ready:false,reason:'本版整新客服確認未齊'};
    if(!sourceMaterialsCurrent(item,'START'))return {ready:false,reason:'開工材料尚未齊'};
    if(!sourceTemplateCurrent(item,'INSPECTION'))return {ready:false,reason:'本版檢測基準待確認'};
    return refurbishmentStartReady(item)?{ready:true}:{ready:false,reason:'目前整新開工未開放'};
  }
  if(action==='return_original' || action==='record_scrap_authorization') {
    if(item.custodianId!==context.viewerId || item.editable!==true || currentPhysicalCustody(item)!=='TECHNICIAN')return {ready:false,reason:'本人實物簽收未確認'};
    if(action==='return_original' && item.receipt.category!=='REPAIR')return {ready:true};
    if(sourceDispositionCurrent(item,action))return {ready:true};
    const projection=item.repairPrerequisites?.disposition?.[action==='return_original'?'returnOriginal':'scrapAuthorization'];
    return {ready:false,reason:projection?.reason==='ALREADY_RECORDED'?'本版報廢授權已記錄':!projection || projection.state==='UNKNOWN'?'處置授權暫無法取得':'目前處置授權未確認'};
  }
  if(action==='complete_factory' && !repairReadiness(item,context).completionReady)return {ready:false,reason:'本版複驗與放行未齊'};
  return {ready:true};
}
export function repairNextStepActions(item:RepairItem,context:RepairNextStepContext):RepairNextAction[] {
  const {canUpdate,viewerId}=context;
  const own=canUpdate && !!viewerId && item.repairOwnerId===viewerId && item.custodianId===viewerId && item.editable===true;
  const waiting=['WAITING_REPAIR_ACCEPTANCE','PENDING_REFURBISH'].includes(item.status);
  const submitted=item.repairInspection?.status==='SUBMITTED';
  const disposition=repairDispositionRoute(item);
  const readiness=repairReadiness(item,{canUpdate,viewerId,handoffNote:context.note});
  const actions:RepairNextAction[]=[];
  if(canUpdate && waiting && !item.nextUserId && !item.repairOwnerId)actions.push({name:'claim',label:'認領案件'});
  if(canUpdate && waiting && item.nextUserId===viewerId)actions.push({name:'accept',label:'簽收實物',disabled:!context.confirmed || !context.location?.trim(),reason:!context.location?.trim()?'請填存放位置':'請確認已核對實物'});
  if(own && item.status==='REPAIR_RECEIVED')actions.push({name:'start_inspection',label:'開始檢測'});
  const companyPreStart=item.receipt.category==='RETURN' && item.status==='REFURBISHING' && !sourceWorkStartCurrent(item);
  if(own && !disposition && (['REPAIR_RECEIVED','INSPECTING','REPAIRING'].includes(item.status) || companyPreStart))actions.push({name:'await_customer',label:'送客服確認',disabled:!submitted || !context.note?.trim() || !item.receipt.customerServiceUserId,reason:!submitted?'請先提交檢修單':!item.receipt.customerServiceUserId?'請指派承辦客服':'請填交辦說明'});
  if(own && !disposition && item.status==='INSPECTING' && ['REPAIR','REPLACE'].includes(item.repairInspection?.data.plan || ''))actions.push({name:'start_repair',label:item.repairInspection?.data.plan==='REPLACE'?'開始換機':'開始維修',disabled:!readiness.startReady,reason:'本版客服與放行未齊'});
  if(own && ['REPAIRING','REFURBISHING'].includes(item.status))actions.push({name:item.status==='REFURBISHING'?'complete_refurbish':'complete_repair',label:'交回收發室',disabled:!readiness.completionReady,reason:readiness.completionChecks.find(check=>!check.ready)?.key==='handoff_note'?'請填交回品況與配件':'本版複驗與放行未齊'});
  return actions;
}
