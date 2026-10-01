import type { Item } from '../mailroom/model';
export type RepairCheck = { name: string; result: 'PASS'|'FAIL'|'NOT_TESTED'; observation: string };
export type InspectionData = {
  complaint:string; reproduction:'YES'|'INTERMITTENT'|'NO'|'NOT_TESTED'; testConditions:string;
  checks:RepairCheck[]; diagnosis:string; causeStatus:'CONFIRMED'|'SUSPECTED'|'UNKNOWN';
  plan:'REPAIR'|'REPLACE'|'FACTORY'|'RETURN';planNote:string;feeSuggestion:'FREE'|'PAID'|'REVIEW';
  estimateAmount?:number;estimateNote:string;
};
export type RepairData = {
  outcome:'REPAIRED'|'REPLACED';workPerformed:string;parts:{name:string;sku:string;quantity:number}[];laborMinutes:number;
  checks:RepairCheck[];qcResult:'PASS'|'FAIL'|'NOT_TESTED';qcNotes:string;replacementCondition?:'NEW'|'REFURBISHED';
  replacementSku?:string;replacementSerial?:string;replacementSource?:string;originalDisposition?:string;
  inventoryReference?:string;deliveredAccessories:string;
};
export type RepairDocument<T=InspectionData|RepairData> = {
  number:string;revision:number;status:'DRAFT'|'SUBMITTED';authorId:string;authorName:string;updatedAt:string;submittedAt?:string;inspectionRevision?:number;review?:{inspectionRevision:number;actorId:string;name:string;confirmedAt:string};data:T;
};
export type RepairItem = Item & {
  repairInspection?:RepairDocument<InspectionData>|null;
  repairReport?:RepairDocument<RepairData>|null;
  editable?:boolean;
  release?:{available:boolean;repairAllowed?:boolean;sourceStatus?:string;sourceStatusLabel?:string;message?:string};
};
export const QUEUES = {
  all:'案件總覽',acceptance:'待認領與簽收',mine:'我的檢修',waiting:'客服與付款進度',delivery:'複驗與交回',records:'檢修與維修紀錄',
} as const;
export type RepairQueue = keyof typeof QUEUES;
export const PLANS = {REPAIR:'原機維修',REPLACE:'一對一替換',FACTORY:'送原廠',RETURN:'原件退回'};
export const RESULTS = {PASS:'通過',FAIL:'不通過',NOT_TESTED:'未測／待測'};
export const FEES = {FREE:'建議免費保固處理',PAID:'需客服審核付費方案',REVIEW:'待客服確認保障範圍'};
export function inspectionReviewCurrent(document?: RepairDocument | null): boolean {
  return document?.status === 'SUBMITTED' && document.review?.inspectionRevision === document.revision;
}
export function repairStartReady(item: RepairItem): boolean {
  return item.receipt.category === 'REPAIR' && item.status === 'INSPECTING' && inspectionReviewCurrent(item.repairInspection) &&
    ['REPAIR', 'REPLACE'].includes(item.repairInspection?.data.plan || '') &&
    item.release?.available === true && item.release.repairAllowed === true;
}
