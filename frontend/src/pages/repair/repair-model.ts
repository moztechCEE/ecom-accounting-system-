import type { Item } from '../mailroom/model';
import type { PhysicalCustody } from '../mailroom/model';
import type { MailroomPrecheckRecord } from '../mailroom/mailroom-precheck-record';
export type { PhysicalCustody } from '../mailroom/model';
export { CUSTODY } from '../mailroom/item-custody';
export type RepairTemplateBinding = {id:string;revision:number;contentHash:string};
export type RepairMaterialPlan = {mode:'UNASSESSED'|'NONE'|'REQUIRED';lines:{id:string;productId:string;warehouseId:string;sku?:string;name?:string;requiredQuantity:string;requiredForStart:boolean}[]};
export function materialPlanPayload(value: unknown): RepairMaterialPlan {
  const plan = value as RepairMaterialPlan | undefined;
  if (!plan || !['UNASSESSED', 'NONE', 'REQUIRED'].includes(plan.mode)) return { mode: 'UNASSESSED', lines: [] };
  return { mode: plan.mode, lines: plan.mode === 'REQUIRED' ? (plan.lines || []).map(line => ({ id: line.id, productId: line.productId, warehouseId: line.warehouseId, requiredQuantity: line.requiredQuantity, requiredForStart: line.requiredForStart, ...(line.sku ? { sku: line.sku } : {}), ...(line.name ? { name: line.name } : {}) })) : [] };
}
export type RepairDocumentMediaRef = {mediaId:string;phase:'BEFORE'|'AFTER'|'DIAGNOSTIC';checkKey?:string};
export type CustomerRepairReportDraft = {findings:string;handling:string;verification:string;mediaIds:string[]};
export type RepairDocumentV2Fields = {protocol?:2;isUnderWarranty?:boolean;isAccidentalDamage?:boolean;customerVisibleSummary?:string;templateBinding?:RepairTemplateBinding;mediaRefs?:RepairDocumentMediaRef[];customerReportDraft?:CustomerRepairReportDraft};
export type RepairCheck = { name: string; result: 'PASS'|'FAIL'|'NOT_TESTED'; observation: string;key?:string;measurementValue?:string|boolean;unit?:string;instrumentId?:string;calibrationRecordId?:string;measuredAt?:string };
export type RepairTemplateView = RepairTemplateBinding & {schema:1;status:'REVIEWED';entityId:string;productId:string;sku:string;checks:{key:string;name:string;requiredForInspection:boolean;requiredForCompletion:boolean;requiresCalibration:boolean;equipmentType?:string;standard:{kind:'OBSERVATION'|'NUMBER'|'BOOLEAN';instruction:string;unit?:string;min?:string;max?:string;expected?:boolean}}[]};
export type InspectionData = RepairDocumentV2Fields & {
  complaint:string; reproduction:'YES'|'INTERMITTENT'|'NO'|'NOT_TESTED'; testConditions:string;
  checks:RepairCheck[]; diagnosis:string; causeStatus:'CONFIRMED'|'SUSPECTED'|'UNKNOWN';
  plan:'REPAIR'|'REPLACE'|'FACTORY'|'RETURN'|'SCRAP';planNote:string;feeSuggestion:'FREE'|'PAID'|'REVIEW';
  estimateAmount?:number;estimateNote:string;replacementCondition?:'NEW'|'REFURBISHED';replacementSku?:string;
  materialPlan?:RepairMaterialPlan;
};
export type RepairData = RepairDocumentV2Fields & {
  outcome:'REPAIRED'|'REPLACED'|'FACTORY_REPAIRED';factoryReference?:string;workPerformed:string;parts:{name:string;sku:string;quantity:number}[];laborMinutes:number;
  checks:RepairCheck[];qcResult:'PASS'|'FAIL'|'NOT_TESTED';qcNotes:string;replacementCondition?:'NEW'|'REFURBISHED';
  replacementSku?:string;replacementSerial?:string;replacementSource?:string;originalDisposition?:string;
  inventoryReference?:string;deliveredAccessories:string;
};
export type RepairDocument<T=InspectionData|RepairData> = {
  number:string;revision:number;status:'DRAFT'|'SUBMITTED';authorId:string;authorName:string;updatedAt:string;submittedAt?:string;inspectionRevision?:number;review?:{inspectionRevision:number;actorId:string;name:string;confirmedAt:string;planHash?:string;decision?:'APPROVE'|'DECLINE';quoteRevision?:number|null};data:T;
};
export type RepairWorkflowAction = 'claim_customer'|'resolve_customer'|'start_refurbishment'|'return_original'|'record_scrap_authorization'|'send_factory'|'accept_factory'|'request_factory_return'|'cancel_factory'|'receive_factory'|'complete_factory';
export type RepairWorkflow = {
  csr?: {status:'SENT'|'ACCEPTED'|'RESOLVED';inspectionRevision:number;estimateRevision?:number;quoteRevision?:number|null;planHash?:string;ownerId?:string;ownerName?:string;sentAt?:string;acceptedAt?:string;resolvedAt?:string;decision?:'APPROVE'|'DECLINE';note?:string};
  factory?: {stage:string;physicalCustody:'TECHNICIAN'|'FACTORY_CARRIER'|'FACTORY';factoryName?:string;reference?:string;carrier?:string;trackingNumber?:string;sentAt?:string;acceptedAt?:string;returnedAt?:string;note?:string;cancelled?:boolean;cancelledAt?:string;cancellationNote?:string;acceptanceNote?:string;returnNote?:string;receiptNote?:string};
  release?: {purpose?:'RETURN_UNREPAIRED'|'REPAIRED'|'REPLACED'|'FACTORY_REPAIRED';note?:string;inspectionRevision?:number;releasedAt?:string;stock?:{postingId?:string}};
  dispositionAuthorization?:{id:string;revision:number;decision:'RETURN_ORIGINAL'|'SCRAP';binding:RepairProposalBinding;quoteRevision:number;submittedAt:string;reviewedAt:string;reviewedById:string};
  workStart?:{schema:'corely.repair.work-start.v1';kind:'REFURBISHMENT';entityId:string;itemId:string;inspectionRevision:number;planHash:string;ownerId:string;custodianId:string;startedById:string;startedAt:string};
};
export type RepairWorkflowCommand = {
  entityId:string;requestId:string;expectedVersion:number;action:RepairWorkflowAction;note?:string;
  inspectionRevision?:number;decision?:'APPROVE'|'DECLINE';confirmedItems?:boolean;location?:string;
  factoryName?:string;reference?:string;carrier?:string;trackingNumber?:string;
};
export type RepairProposalBinding = {itemId:string;planVersion:number;planHash:string;proposalHash:string};
export type RepairReleaseInfo = {quoteRevision:number;customerApprovedQuoteRevision:number|null;customerApprovedAt:string|null;amount:number|null;currency:string;confirmedPaymentQuoteRevision:number|null;invoiceRequired?:boolean;invoiceStatus?:string;invoiceSatisfied?:boolean;invoiceQuoteRevision?:number|null;quotePlanVersion?:number|null;quotePlanHash?:string|null;quoteBindings?:(RepairProposalBinding & {quoteRevision:number})[]|null;customerIdentity?:{companyId:string;caseId:string;brand:string;verifiedCustomerId:string;verified:boolean}};
export function sourceQuoteConsentCurrent(info?:RepairReleaseInfo|null):info is RepairReleaseInfo {
  return !!info && Number.isInteger(info.quoteRevision) && info.quoteRevision>0 && info.customerApprovedQuoteRevision===info.quoteRevision && !!info.customerApprovedAt && Number.isFinite(Date.parse(info.customerApprovedAt));
}
export function sourceInvoiceCurrent(info?:RepairReleaseInfo|null):boolean {
  if(!info || typeof info.amount!=='number' || !Number.isFinite(info.amount) || info.amount<0 || !Number.isInteger(info.quoteRevision) || info.quoteRevision<1)return false;
  if(info.amount>0 && typeof info.invoiceRequired!=='boolean')return false;
  if(info.invoiceRequired!==undefined && typeof info.invoiceRequired!=='boolean')return false;
  return info.invoiceRequired===true ? info.invoiceStatus==='ISSUED' && info.invoiceSatisfied===true && info.invoiceQuoteRevision===info.quoteRevision : info.amount===0 || info.invoiceRequired===false;
}
export function sourceItemQuoteBindingCurrent(item:RepairItem):boolean {
  const current=item.repairProposalBinding, inspection=item.repairInspection, info=item.release?.releaseInfo;
  if(!current || !inspection || !info || !Number.isInteger(inspection.revision) || inspection.revision<1 || !Number.isInteger(info.quoteRevision) || info.quoteRevision<1 || current.itemId!==item.id || current.planVersion!==inspection.revision || current.planHash!==inspection.review?.planHash || !/^[a-f0-9]{64}$/.test(current.planHash) || !/^[a-f0-9]{64}$/.test(current.proposalHash) || !Array.isArray(info.quoteBindings))return false;
  const rows=info.quoteBindings.filter(row=>row?.itemId===item.id);
  return rows.length===1 && rows[0].planVersion===current.planVersion && rows[0].planHash===current.planHash && rows[0].proposalHash===current.proposalHash && rows[0].quoteRevision===info.quoteRevision;
}
export function sourceMaterialsCurrent(item:RepairItem,stage:'START'|'COMPLETION'='START'):boolean {
  const plan=item.repairInspection?.data.materialPlan;
  if(!plan || !Array.isArray(plan.lines))return false;
  const projection=item.repairPrerequisites?.materials?.[stage==='START'?'start':'completion'];
  if(plan.mode==='NONE')return plan.lines.length===0 && projection?.state==='READY' && projection.requiredCount===0;
  if(plan.mode!=='REQUIRED' || !plan.lines.length || plan.lines.some(line=>!line || ![line.id,line.productId,line.warehouseId].every(value=>typeof value==='string' && !!value.trim()) || typeof line.requiredForStart!=='boolean' || typeof line.requiredQuantity!=='string' || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(line.requiredQuantity) || Number(line.requiredQuantity)<=0 || Number(line.requiredQuantity)>100000) || new Set(plan.lines.map(line=>line.id)).size!==plan.lines.length)return false;
  const count=plan.lines.filter(line=>stage==='COMPLETION' || line.requiredForStart).length;
  return projection?.state==='READY' && projection.requiredCount===count;
}
export function sourceTemplateCurrent(item:RepairItem,stage:'INSPECTION'|'COMPLETION'='INSPECTION'):boolean {
  const document=stage==='INSPECTION'?item.repairInspection:item.repairReport;
  const replacement=stage==='COMPLETION' && item.repairInspection?.data.plan==='REPLACE';
  const template=replacement?item.repairPrerequisites?.repairTemplate:item.repairPrerequisites?.template;
  const binding=document?.data.templateBinding;
  if(document?.data.protocol!==2 || !binding || !template || template.status!=='REVIEWED' || !Array.isArray(template.checks) || template.entityId!==item.entityId || template.sku!==(replacement?item.repairInspection?.data.replacementSku:item.sku) || (!replacement && template.productId!==item.productId) || binding.id!==template.id || binding.revision!==template.revision || binding.contentHash!==template.contentHash || typeof binding.contentHash!=='string' || !/^[a-f0-9]{64}$/.test(binding.contentHash) || !Number.isInteger(binding.revision) || binding.revision<1 || item.repairPrerequisites?.templateChecks?.[stage==='INSPECTION'?'inspection':'completion']!=='READY' || !Array.isArray(document.data.checks) || !document.data.checks.length)return false;
  if(template.checks.some(check=>!check || typeof check.key!=='string' || typeof check.requiredForInspection!=='boolean' || typeof check.requiredForCompletion!=='boolean') || document.data.checks.some(check=>!check || typeof check.key!=='string' || !check.key.trim()))return false;
  const keys=document.data.checks.map(check=>check.key);
  if(new Set(keys).size!==keys.length)return false;
  return template.checks.filter(check=>stage==='INSPECTION'?check.requiredForInspection:check.requiredForCompletion).every(required=>document.data.checks.some(check=>check.key===required.key && check.name===required.name && typeof check.observation==='string' && !!check.observation.trim() && (stage==='COMPLETION'?check.result==='PASS':['PASS','FAIL'].includes(check.result))));
}
export function sourceDispositionCurrent(item:RepairItem,action:'return_original'|'record_scrap_authorization'):boolean {
  const inspection=item.repairInspection, csr=item.repairWorkflow?.csr;
  if(item.receipt.category!=='REPAIR' || !item.allowedWorkflowActions?.includes(action) || !inspectionReviewCurrent(inspection) || !inspection || !Number.isInteger(inspection.revision) || inspection.revision<1 || !Number.isInteger(inspection.review?.quoteRevision) || Number(inspection.review?.quoteRevision)<1 || typeof inspection.review?.planHash!=='string' || !/^[a-f0-9]{64}$/.test(inspection.review.planHash) || csr?.status!=='RESOLVED' || csr.decision!==inspection.review?.decision || csr.inspectionRevision!==inspection.revision || csr.estimateRevision!==inspection.revision || csr.planHash!==inspection.review?.planHash || csr.quoteRevision!==inspection.review?.quoteRevision)return false;
  if(action==='return_original' ? inspection.data.plan==='SCRAP' || !(csr.decision==='DECLINE' || inspection.data.plan==='RETURN') : !(csr.decision==='DECLINE' || inspection.data.plan==='SCRAP'))return false;
  return item.repairPrerequisites?.disposition?.[action==='return_original'?'returnOriginal':'scrapAuthorization']?.state==='READY';
}
export function companyCsrCurrent(item:RepairItem):boolean {
  const doc=item.repairInspection,csr=item.repairWorkflow?.csr;
  return item.receipt.category==='RETURN' && inspectionReviewCurrent(doc) && !!doc && doc.data.plan==='REPAIR' && Number.isInteger(doc.revision) && doc.revision>0
    && doc.review?.decision==='APPROVE' && doc.review.quoteRevision===null && typeof doc.review.planHash==='string' && /^[a-f0-9]{64}$/.test(doc.review.planHash)
    && csr?.status==='RESOLVED' && csr.decision==='APPROVE' && csr.inspectionRevision===doc.revision && csr.estimateRevision===doc.revision && csr.planHash===doc.review.planHash && csr.quoteRevision===null;
}
export function sourceWorkStartCurrent(item:RepairItem):boolean {
  return companyCsrCurrent(item) && item.repairPrerequisites?.workStart?.state==='READY';
}
export function refurbishmentStartReady(item:RepairItem):boolean {
  return ['INSPECTING','REPAIR_RECEIVED','REFURBISHING'].includes(item.status) && item.allowedWorkflowActions?.includes('start_refurbishment')===true
    && !sourceWorkStartCurrent(item) && companyCsrCurrent(item) && sourceMaterialsCurrent(item,'START') && sourceTemplateCurrent(item,'INSPECTION');
}
export type RepairPrecheckPhoto = NonNullable<MailroomPrecheckRecord['recorded']>['photos'][number];
export type RepairPrecheckPendingSummary = {stage:'DRAFT'|'READY';revision:number;recordedBy:string;recordedAt:string};
export type RepairPrecheckView =
  | {state:'NOT_STARTED'|'STALE'|'UNAVAILABLE'}
  | ({state:'PENDING'} & RepairPrecheckPendingSummary)
  | {
    state:'SUBMITTED';revision:number;recordedBy:string;recordedAt:string;submittedAt:string;
    templateTitle?:string;templateRevision?:number;
    checks:{key:string;label:string;result:'NORMAL'|'ABNORMAL'|'NOT_TESTED'|'NOT_APPLICABLE';note?:string;photoIds:string[]}[];
    photos:RepairPrecheckPhoto[];notRequiredReason?:string|null;
  };
const precheckHash = (value:unknown):value is string => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const precheckText = (value:unknown):value is string => typeof value==='string' && !!value.trim();
const precheckTime = (value:unknown):value is string => precheckText(value) && Number.isFinite(Date.parse(value));
const precheckRevision = (value:unknown):value is number => Number.isSafeInteger(value) && Number(value)>0;
export function repairPrecheckPendingSummary(value:unknown):RepairPrecheckPendingSummary|null {
  if (!value || typeof value!=='object') return null;
  const row=value as {stage?:unknown;revision?:unknown;savedByName?:unknown;savedAt?:unknown};
  if ((row.stage!=='DRAFT' && row.stage!=='READY') || !precheckRevision(row.revision) || !precheckText(row.savedByName) || !precheckTime(row.savedAt)) return null;
  return {stage:row.stage,revision:row.revision,recordedBy:row.savedByName,recordedAt:row.savedAt};
}
export function repairPrecheckPhotoUrl(photo:RepairPrecheckPhoto,itemId:string,revision:number):string|null {
  if (!photo || !precheckHash(photo.id) || !precheckHash(photo.digest) || !precheckRevision(revision)) return null;
  const expected=`/mailroom/prechecks/items/${encodeURIComponent(itemId)}/recorded-photos/${photo.id}?revision=${revision}`;
  return photo.url===expected ? expected : null;
}
export function repairPrecheckView(value:unknown,entityId:string,itemId:string):RepairPrecheckView {
  const unavailable:RepairPrecheckView={state:'UNAVAILABLE'};
  if (!value || typeof value!=='object') return unavailable;
  const row=value as MailroomPrecheckRecord;
  if (row.schema!==1 || row.entityId!==entityId || row.itemId!==itemId) return unavailable;
  if (row.stage!=='SUBMITTED') {
    if (row.recorded!==null) return unavailable;
    if (row.stage==='NOT_STARTED' && row.revision===0) return {state:'NOT_STARTED'};
    if (!precheckRevision(row.revision)) return unavailable;
    if (row.stage==='DRAFT' || row.stage==='READY') {
      const summary=repairPrecheckPendingSummary(row);
      return summary ? {state:'PENDING',...summary} : unavailable;
    }
    return row.stage==='STALE' ? {state:'STALE'} : unavailable;
  }
  const record=row.recorded;
  if (!record || !precheckRevision(row.revision) || record.revision!==row.revision || !precheckText(record.id)
    || !precheckText(record.savedByName) || !precheckTime(record.savedAt) || !precheckTime(record.submittedAt)
    || row.savedByName!==record.savedByName || row.savedAt!==record.savedAt || row.submittedAt!==record.submittedAt
    || !Array.isArray(record.photos) || record.photos.length>4 || !Array.isArray(record.checks) || record.checks.length>100
    || !(record.notRequiredReason===null || precheckText(record.notRequiredReason))) return unavailable;
  if (record.template!==null && (!record.template || !precheckText(record.template.id) || !precheckRevision(record.template.revision)
    || !precheckHash(record.template.contentHash) || !precheckText(record.template.title))) return unavailable;
  if (!record.checks.length && !precheckText(record.notRequiredReason)) return unavailable;
  if (record.photos.some(photo=>!repairPrecheckPhotoUrl(photo,itemId,record.revision))) return unavailable;
  const photoIds=new Set(record.photos.map(photo=>photo.id));
  if (photoIds.size!==record.photos.length || new Set(record.checks.map(check=>check?.key)).size!==record.checks.length
    || record.checks.some(check=>!check || !precheckText(check.key) || !precheckText(check.label)
      || !['NORMAL','ABNORMAL','NOT_TESTED','NOT_APPLICABLE'].includes(check.result)
      || !(check.note===null || typeof check.note==='string') || !Array.isArray(check.photoIds)
      || new Set(check.photoIds).size!==check.photoIds.length || check.photoIds.some(id=>!photoIds.has(id)))) return unavailable;
  return {
    state:'SUBMITTED',revision:record.revision,recordedBy:record.savedByName,recordedAt:record.savedAt,submittedAt:record.submittedAt,
    ...(record.template ? {templateTitle:record.template.title,templateRevision:record.template.revision} : {}),
    checks:record.checks.map(check=>({...check,note:check.note ?? undefined})),photos:record.photos,notRequiredReason:record.notRequiredReason,
  };
}
export type RepairItem = Item & {
  entityId?:string;
  mailroomPrecheck?:MailroomPrecheckRecord;
  precheck?:unknown;
  repairWorkflow?:RepairWorkflow|null;
  allowedWorkflowActions?:RepairWorkflowAction[];
  physicalCustody?:PhysicalCustody;
  repairInspection?:RepairDocument<InspectionData>|null;
  repairReport?:RepairDocument<RepairData>|null;
  editable?:boolean;
  repairProposalBinding?:RepairProposalBinding|null;
  repairPrerequisites?:{
    template?:RepairTemplateView|null;
    repairTemplate?:RepairTemplateView|null;
    materialCatalog?:{products:{id:string;sku:string;name:string}[];warehouses:{id:string;code:string;name:string}[]};
    materials?:{start:{state:'READY'|'BLOCKED'|'UNKNOWN';reason:string;requiredCount:number};completion:{state:'READY'|'BLOCKED'|'UNKNOWN';reason:string;requiredCount:number}};
    templateChecks?:{inspection:'READY'|'BLOCKED'|'UNKNOWN';completion:'READY'|'BLOCKED'|'UNKNOWN'};
    disposition?:{returnOriginal:{state:'READY'|'BLOCKED'|'UNKNOWN';reason:string};scrapAuthorization:{state:'READY'|'BLOCKED'|'UNKNOWN';reason:string};authorization:RepairWorkflow['dispositionAuthorization']|null};
    workStart?:{state:'READY'|'BLOCKED'|'UNKNOWN';reason:string};
    mediaAssets?:{mediaId:string;fileName:string;phase:'BEFORE'|'AFTER'|'DIAGNOSTIC';checkKey?:string;kind:'inspection'|'repair';documentRevision:number}[];
  };
  release?:{available:boolean;sourceCaseId?:string;caseBrand?:string|null;repairAllowed?:boolean;sourceStatus?:string;sourceStatusLabel?:string;releaseInfo?:RepairReleaseInfo|null;message?:string};
};
export const QUEUES = {
  all:'案件總覽',acceptance:'待認領與簽收',mine:'我的檢修',waiting:'客服與付款進度',delivery:'複驗與交回',records:'檢修與維修紀錄',
} as const;
export type RepairQueue = keyof typeof QUEUES;
export const PLANS = {REPAIR:'原機維修',REPLACE:'一對一替換',FACTORY:'送原廠',RETURN:'原件退回',SCRAP:'報廢建議'};
export const RESULTS = {PASS:'通過',FAIL:'不通過',NOT_TESTED:'未測／待測'};
export const FEES = {FREE:'建議免費保固處理',PAID:'需客服審核付費方案',REVIEW:'待客服確認保障範圍'};
export function inspectionReviewCurrent(document?: RepairDocument | null): boolean {
  return document?.status === 'SUBMITTED' && document.review?.inspectionRevision === document.revision && ['APPROVE','DECLINE'].includes(document.review.decision || '') && !!document.review.planHash;
}
export function repairStartReady(item: RepairItem): boolean {
  return item.receipt.category === 'REPAIR' && item.status === 'INSPECTING' && inspectionReviewCurrent(item.repairInspection) &&
    ['REPAIR', 'REPLACE'].includes(item.repairInspection?.data.plan || '') &&
    item.repairInspection?.review?.decision==='APPROVE' && Number.isInteger(item.repairInspection.review.quoteRevision) && Number(item.repairInspection.review.quoteRevision)>0 && item.repairWorkflow?.csr?.status==='RESOLVED' && item.repairWorkflow.csr.decision==='APPROVE' && item.repairWorkflow.csr.inspectionRevision===item.repairInspection.revision && item.repairWorkflow.csr.estimateRevision===item.repairInspection.revision && item.repairWorkflow.csr.quoteRevision===item.repairInspection.review.quoteRevision && item.repairWorkflow.csr.planHash===item.repairInspection.review.planHash &&
    item.release?.available === true && item.release.repairAllowed === true && sourceQuoteConsentCurrent(item.release.releaseInfo) &&
    item.release.releaseInfo?.quoteRevision===item.repairInspection.review.quoteRevision && Number.isFinite(item.release.releaseInfo.amount) && Number(item.release.releaseInfo.amount)>=0 && (Number(item.release.releaseInfo.amount)===0 || item.release.releaseInfo.confirmedPaymentQuoteRevision===item.release.releaseInfo.quoteRevision) && sourceInvoiceCurrent(item.release.releaseInfo) && sourceItemQuoteBindingCurrent(item) && sourceMaterialsCurrent(item) && sourceTemplateCurrent(item);
}

export const WORKFLOW_ACTIONS: Record<RepairWorkflowAction,string> = {
  claim_customer:'本人接手客服交辦',resolve_customer:'記錄客服方案結果',start_refurbishment:'開始公司整新',return_original:'原件未修退回收發室',record_scrap_authorization:'記錄顧客報廢授權',
  send_factory:'確認交運送原廠',accept_factory:'記錄原廠已收件',request_factory_return:'登記原廠返還物流',
  cancel_factory:'取消原廠處理（實物尚未返還）',receive_factory:'本人簽收原廠返還件',complete_factory:'原廠處理複驗完成，交回收發室',
};
export const REPAIR_STATUS:Record<string,string> = {
  FACTORY_OUTBOUND:'送原廠交運中',FACTORY_RECEIVED:'原廠已收件',FACTORY_RETURNING:'原廠返還途中',
};
export const CSR_STATUS = {SENT:'已交辦，待客服接手',ACCEPTED:'客服已本人接手',RESOLVED:'客服已回覆方案結果'};
export function repairReportReady(item:RepairItem):boolean {
  const inspection=item.repairInspection;const report=item.repairReport;
  if(inspection?.status!=='SUBMITTED'||report?.status!=='SUBMITTED'||report.inspectionRevision!==inspection.revision||report.data.qcResult!=='PASS'||!report.data.checks.length||report.data.checks.some(c=>c.result!=='PASS'))return false;
  if(inspection.data.plan==='REPAIR')return report.data.outcome==='REPAIRED';
  if(inspection.data.plan==='REPLACE')return report.data.outcome==='REPLACED' && !!inspection.data.replacementSku && report.data.replacementSku===inspection.data.replacementSku && !!inspection.data.replacementCondition && report.data.replacementCondition===inspection.data.replacementCondition;
  if(inspection.data.plan==='FACTORY')return report.data.outcome==='FACTORY_REPAIRED' && item.repairWorkflow?.factory?.physicalCustody==='TECHNICIAN' && item.repairWorkflow.factory.stage==='RETURNED' && !!report.data.factoryReference && report.data.factoryReference===item.repairWorkflow.factory.reference;
  return false;
}
export function workflowActionAllowed(item:RepairItem,action:RepairWorkflowAction):boolean {
  return item.allowedWorkflowActions?.includes(action)===true;
}
