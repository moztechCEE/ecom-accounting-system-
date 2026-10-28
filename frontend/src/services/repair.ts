import api from './api';
import type { RepairItem, RepairWorkflowCommand } from '../pages/repair/repair-model';
export type RepairCaseLookupMatch = {
  itemId:string; entityId:string; productName:string; label:string; sourceNumber:string;
  receiptNumber:string; status:string; statusLabel?:string;
};
export type RepairCaseLookupResult = {
  kind:'MATCH'|'NOT_FOUND'|'MULTIPLE'|'AMBIGUOUS'; entityId:string;
  matches:RepairCaseLookupMatch[]; limitExceeded?:true;
};
export const repairService = {
  async lookup(entityId:string,code:string,signal?:AbortSignal):Promise<RepairCaseLookupResult> {
    return (await api.get<RepairCaseLookupResult>('/repair-workbench/lookup',{params:{entityId,code},signal})).data;
  },
  async documents(entityId:string,itemId:string):Promise<RepairItem> {
    return (await api.get<RepairItem>(`/repair-workbench/items/${encodeURIComponent(itemId)}/documents`,{params:{entityId}})).data;
  },
  async customerQueue(entityId:string,params:{search?:string;page?:number;pageSize?:number}={}):Promise<{items:RepairItem[];total:number}> {
    return (await api.get<{items:RepairItem[];total:number}>('/repair-workbench/csr-queue',{params:{entityId,...params}})).data;
  },
  async workflow(itemId:string,command:RepairWorkflowCommand):Promise<{id:string;duplicate:boolean}> {
    return (await api.post<{id:string;duplicate:boolean}>(`/repair-workbench/items/${encodeURIComponent(itemId)}/workflow`,command)).data;
  },
};
