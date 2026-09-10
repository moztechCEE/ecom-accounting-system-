import { projectWmsFact, WMS_CONTRACT, WmsBinding, WmsFact } from './wms-read.contract';
import { WmsReadService } from './wms-read.service';
import { WmsWorkbenchController, WmsWorkbenchQuery } from './wms-workbench.module';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
const binding: WmsBinding = { entityId:'company-a', brandCode:'AIRITY', erpOrderId:'erp-1', wmsOrderId:'1', accountId:'account-a', environment:'production', merchantId:'test-merchant', logisticsId:'test-logistics' };
const scope = { entityId:'company-a',brandCodes:['AIRITY'] };
const fact: WmsFact = { contractVersion:WMS_CONTRACT,binding,warehouseStatus:'completed',logisticsStatus:'returned_to_center',observedAt:'2026-09-10T00:00:00Z',warehouseReceivedAt:null,returnKind:'uncollected' };
describe('WMS read boundary',()=>{
  it('fails closed until the source is approved and bounds query DTO',()=>{
    expect(()=>new WmsWorkbenchController().orders({entityId:'company-a'})).toThrow('WMS 安全連線與員工對照尚未開通');
    expect(validateSync(plainToInstance(WmsWorkbenchQuery,{entityId:'company-a',pageSize:1000})).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(WmsWorkbenchQuery,{entityId:'company-a',view:'refund'})).length).toBeGreaterThan(0);
  });
  it('keeps verification, carrier return and warehouse receipt separate',()=>{
    const result=projectWmsFact(fact,scope,binding);
    expect(result.warehouse.label).toBe('核對完成');
    expect(result.logistics.label).toBe('退回物流中心');
    expect(result.receipt.status).toBe('unconfirmed');
    expect(result.inventoryEffect).toBe('none'); expect(result.financialEffect).toBe('none');
  });
  it.each(['entityId','brandCode','erpOrderId','wmsOrderId','accountId','environment','merchantId','logisticsId'])('rejects mismatched %s',key=>{
    expect(()=>projectWmsFact({...fact,binding:{...binding,[key]:'foreign'}},scope,binding)).toThrow();
  });
  it('does not leak provider payload or identify brands by account names',()=>{
    const result=projectWmsFact({...fact,raw:{secret:'hidden'},customerName:'private'} as WmsFact,scope,binding);
    expect(JSON.stringify(result)).not.toMatch(/hidden|private|merchantId|accountId/);
  });
  it('keeps unknown status unknown',()=>expect(projectWmsFact({...fact,warehouseStatus:'future',logisticsStatus:'future'},scope,binding).logistics.status).toBe('unknown'));
  it('rejects schema drift and malformed time',()=>{
    expect(()=>projectWmsFact({...fact,contractVersion:'v2'} as any,scope,binding)).toThrow('WMS_CONTRACT_MISMATCH');
    expect(()=>projectWmsFact({...fact,observedAt:'not-a-date'},scope,binding)).toThrow('WMS_INVALID_TIME');
  });
  it('checks company and brand before fetching source data',async()=>{
    const ports={binding:jest.fn().mockResolvedValue({...binding,entityId:'foreign'}),fact:jest.fn()};
    await expect(new WmsReadService(ports).order(scope,'erp-1')).rejects.toThrow('WMS_SCOPE_DENIED');
    expect(ports.fact).not.toHaveBeenCalled();
  });
  it('does not turn missing mapping or upstream outage into zero orders',async()=>{
    const ports={binding:jest.fn().mockResolvedValue(null),fact:jest.fn()};
    await expect(new WmsReadService(ports).order(scope,'erp-1')).rejects.toThrow('WMS_ORDER_UNMAPPED');
    ports.binding.mockResolvedValue(binding); ports.fact.mockRejectedValue(new Error('offline'));
    await expect(new WmsReadService(ports).order(scope,'erp-1')).rejects.toThrow('offline');
  });
  it('supports the independent service contract without database or network writes',async()=>{
    const result=await new WmsReadService({binding:async()=>binding,fact:async()=>fact}).order(scope,'erp-1');
    expect(result.erpOrderId).toBe('erp-1');
  });
});
