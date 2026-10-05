import type { Item } from '../mailroom/model';
import type { PhysicalCustody } from '../mailroom/model';
export type { PhysicalCustody } from '../mailroom/model';
export { CUSTODY } from '../mailroom/item-custody';
export type RepairCheck = { name: string; result: 'PASS'|'FAIL'|'NOT_TESTED'; observation: string };
export type InspectionData = {
  complaint:string; reproduction:'YES'|'INTERMITTENT'|'NO'|'NOT_TESTED'; testConditions:string;
  checks:RepairCheck[]; diagnosis:string; causeStatus:'CONFIRMED'|'SUSPECTED'|'UNKNOWN';
  plan:'REPAIR'|'REPLACE'|'FACTORY'|'RETURN';planNote:string;feeSuggestion:'FREE'|'PAID'|'REVIEW';
  estimateAmount?:number;estimateNote:string;replacementCondition?:'NEW'|'REFURBISHED';replacementSku?:string;
};
export type RepairData = {
  outcome:'REPAIRED'|'REPLACED'|'FACTORY_REPAIRED';factoryReference?:string;workPerformed:string;parts:{name:string;sku:string;quantity:number}[];laborMinutes:number;
  checks:RepairCheck[];qcResult:'PASS'|'FAIL'|'NOT_TESTED';qcNotes:string;replacementCondition?:'NEW'|'REFURBISHED';
  replacementSku?:string;replacementSerial?:string;replacementSource?:string;originalDisposition?:string;
  inventoryReference?:string;deliveredAccessories:string;
};
export type RepairDocument<T=InspectionData|RepairData> = {
  number:string;revision:number;status:'DRAFT'|'SUBMITTED';authorId:string;authorName:string;updatedAt:string;submittedAt?:string;inspectionRevision?:number;review?:{inspectionRevision:number;actorId:string;name:string;confirmedAt:string;planHash?:string;decision?:'APPROVE'|'DECLINE';quoteRevision?:number|null};data:T;
};
export type RepairWorkflowAction = 'claim_customer'|'resolve_customer'|'return_original'|'send_factory'|'accept_factory'|'request_factory_return'|'cancel_factory'|'receive_factory'|'complete_factory';
export type RepairWorkflow = {
  csr?: {status:'SENT'|'ACCEPTED'|'RESOLVED';inspectionRevision:number;estimateRevision?:number;quoteRevision?:number|null;planHash?:string;ownerId?:string;ownerName?:string;sentAt?:string;acceptedAt?:string;resolvedAt?:string;decision?:'APPROVE'|'DECLINE';note?:string};
  factory?: {stage:string;physicalCustody:'TECHNICIAN'|'FACTORY_CARRIER'|'FACTORY';factoryName?:string;reference?:string;carrier?:string;trackingNumber?:string;sentAt?:string;acceptedAt?:string;returnedAt?:string;note?:string;cancelled?:boolean;cancelledAt?:string;cancellationNote?:string;acceptanceNote?:string;returnNote?:string;receiptNote?:string};
  release?: {purpose?:'RETURN_UNREPAIRED'|'REPAIRED'|'REPLACED'|'FACTORY_REPAIRED';note?:string};
};
export type RepairWorkflowCommand = {
  entityId:string;requestId:string;expectedVersion:number;action:RepairWorkflowAction;note?:string;
  inspectionRevision?:number;decision?:'APPROVE'|'DECLINE';confirmedItems?:boolean;location?:string;
  factoryName?:string;reference?:string;carrier?:string;trackingNumber?:string;
};
export type RepairReleaseInfo = {quoteRevision:number;customerApprovedQuoteRevision:number|null;customerApprovedAt:string|null;amount:number|null;currency:string;confirmedPaymentQuoteRevision:number|null};
export function sourceQuoteConsentCurrent(info?:RepairReleaseInfo|null):info is RepairReleaseInfo {
  return !!info && Number.isInteger(info.quoteRevision) && info.quoteRevision>0 && info.customerApprovedQuoteRevision===info.quoteRevision && !!info.customerApprovedAt && Number.isFinite(Date.parse(info.customerApprovedAt));
}
export type RepairItem = Item & {
  entityId?:string;
  repairWorkflow?:RepairWorkflow|null;
  allowedWorkflowActions?:RepairWorkflowAction[];
  physicalCustody?:PhysicalCustody;
  repairInspection?:RepairDocument<InspectionData>|null;
  repairReport?:RepairDocument<RepairData>|null;
  editable?:boolean;
  release?:{available:boolean;repairAllowed?:boolean;sourceStatus?:string;sourceStatusLabel?:string;releaseInfo?:RepairReleaseInfo|null;message?:string};
};
export const QUEUES = {
  all:'案件總覽',acceptance:'待認領與簽收',mine:'我的檢修',waiting:'客服與付款進度',delivery:'複驗與交回',records:'檢修與維修紀錄',
} as const;
export type RepairQueue = keyof typeof QUEUES;
export const PLANS = {REPAIR:'原機維修',REPLACE:'一對一替換',FACTORY:'送原廠',RETURN:'原件退回'};
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
    item.release.releaseInfo?.quoteRevision===item.repairInspection.review.quoteRevision && Number.isFinite(item.release.releaseInfo.amount) && Number(item.release.releaseInfo.amount)>=0 && (Number(item.release.releaseInfo.amount)===0 || item.release.releaseInfo.confirmedPaymentQuoteRevision===item.release.releaseInfo.quoteRevision);
}

export const WORKFLOW_ACTIONS: Record<RepairWorkflowAction,string> = {
  claim_customer:'本人接手客服交辦',resolve_customer:'記錄客服方案結果',return_original:'原件未修退回收發室',
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
