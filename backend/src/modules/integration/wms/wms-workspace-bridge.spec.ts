import { createHash, generateKeyPairSync } from 'node:crypto';
import { WmsWorkspaceBridge,projectWorkspaceResponse } from './wms-workspace-bridge';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const env={WMS_WORKSPACE_READ_ENABLED:'true',WMS_WORKSPACE_URL:'https://wms.example/',WMS_WORKSPACE_ISSUER:'erp-test',WMS_WORKSPACE_AUDIENCE:'wms-test',
  WMS_WORKSPACE_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
const prisma=(permissions=['wms_tasks:read','wms_picking:execute','wms_packing:execute'])=>({
  user:{findUnique:jest.fn().mockResolvedValue({isActive:true,mustChangePassword:false})},
  userRole:{findMany:jest.fn().mockResolvedValue([{role:{code:'EMPLOYEE',permissions:permissions.map(p=>{const [resource,action]=p.split(':');return {permission:{resource,action}};})}}])},
}) as any;
const page={contractVersion:'wms.workspace-read.v1',source:'wms',mode:'read_only',items:[],total:0};
const dispatchReceipt={contractVersion:'wms.workspace-command.v1',source:'wms',id:'sale-1',orderNumber:'SO-001',brand:'MOZTECH',state:'pending',
  warehouseLabel:'待預揀核對',logisticsLabel:'交運尚未核對',receiptLabel:'Corely 庫存尚未核銷',assignee:null,updatedAt:'2026-09-23T00:00:00.000Z',
  required:2,picked:0,packed:0,revision:1,items:[{id:'line-1',sku:'0001',name:'商品',barcode:'000123',quantity:2,picked:0,packed:0,serials:[]}],
  allowedActions:[],blockers:['待預揀核對完成']};
const nativeReceipt={nativeIntakeId:12,wmsOrderId:24,workBarcode:'WT0123456789ABCDEF01',batchId:36,reservationAccepted:true};
describe('ERP WMS source bridge',()=>{
  it('switches stations without changing or impersonating the employee',async()=>{
    const fetcher=jest.fn().mockImplementation(async(_url,options)=>{
      const token=options.headers.Authorization.slice(7);
      const claims=await new JwtService().verifyAsync(token,{publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString(),algorithms:['RS256'],issuer:'erp-test',audience:'wms-test'});
      expect(claims.sub).toBe('employee');expect(claims.entityId).toBe('company');expect(['pick','pack']).toContain(claims.station);
      expect(claims.role).toBeUndefined();expect(claims.exp-claims.iat).toBe(45);
      expect(options.redirect).toBe('error');expect(options.method).toBe('GET');
      return new Response(JSON.stringify(page),{headers:{'content-type':'application/json'}});
    });
    const bridge=new WmsWorkspaceBridge(prisma(),env,fetcher);
    expect(await bridge.stations('employee')).toEqual(['pick','pack']);
    await bridge.read('employee',{entityId:'company',area:'pick'});
    await bridge.read('employee',{entityId:'company',area:'pack'});
    await expect(bridge.read('employee',{entityId:'company',area:'dispatch'})).rejects.toThrow('WMS_STATION_DENIED');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not connect when disabled, revoked, inactive, or transport config is unsafe',async()=>{
    const fetcher=jest.fn(),p=prisma(['wms_tasks:read','wms_picking:execute']);
    await expect(new WmsWorkspaceBridge(p,{},fetcher).read('employee',{entityId:'company'})).rejects.toThrow();
    await expect(new WmsWorkspaceBridge(p,env,fetcher).read('employee',{entityId:'company',area:'pack'})).rejects.toThrow('WMS_STATION_DENIED');
    p.user.findUnique.mockResolvedValue({isActive:false});
    await expect(new WmsWorkspaceBridge(p,env,fetcher).read('employee',{entityId:'company'})).rejects.toThrow('WMS_ACTOR_INACTIVE');
    await expect(new WmsWorkspaceBridge(prisma(),{...env,WMS_WORKSPACE_URL:'http://public.example/'},fetcher).read('employee',{entityId:'company'})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects invalid upstream and never turns network failures into empty orders',async()=>{
    for(const response of [new Response('error',{status:500}),new Response('{}',{headers:{'content-type':'application/json'}}),new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}})]) {
      await expect(new WmsWorkspaceBridge(prisma(),env,jest.fn().mockResolvedValue(response)).read('employee',{entityId:'company'})).rejects.toThrow();
    }
    expect(()=>projectWorkspaceResponse({...page,mode:'write'},false)).toThrow();
    expect(projectWorkspaceResponse({...page,privateCustomer:'not forwarded'},false)).not.toHaveProperty('privateCustomer');
  });
  it('logs only safe transport diagnostics and non-OK status while preserving the unknown command result',async()=>{
    const warn=jest.spyOn(Logger.prototype,'warn').mockImplementation(()=>undefined);
    try {
      const networkError=Object.assign(new TypeError('Bearer secret-token at https://private.invalid/order'),{
        cause:{code:'ENOTFOUND',message:'private URL and credentials'},
      });
      const bridge=new WmsWorkspaceBridge(prisma(['wms_tasks:read','wms_orders:create']),{...env,WMS_WORKSPACE_COMMANDS_ENABLED:'true'},jest.fn().mockRejectedValue(networkError));
      await expect(bridge.command('employee','company','sale-1','dispatch','dispatch',{requestId:'stable-request'}))
        .rejects.toMatchObject({response:{code:'WMS_COMMAND_RESULT_UNKNOWN'}});
      expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({
        event:'WMS_BRIDGE_FETCH_FAILURE',operation:'command',stage:'transport',errorClass:'TypeError',causeCode:'ENOTFOUND',
      });
      expect(String(warn.mock.calls[0][0])).not.toMatch(/secret-token|private\.invalid|credentials|stable-request/);

      await expect(new WmsWorkspaceBridge(prisma(),env,jest.fn().mockResolvedValue(new Response('sensitive upstream body',{status:503})))
        .read('employee',{entityId:'company'})).rejects.toMatchObject({response:{code:'WMS_SOURCE_UNAVAILABLE'}});
      expect(JSON.parse(String(warn.mock.calls[1][0]))).toEqual({
        event:'WMS_BRIDGE_FETCH_FAILURE',operation:'read',stage:'http',errorClass:'Error',causeCode:'unknown',upstreamStatus:503,
      });
      expect(String(warn.mock.calls[1][0])).not.toContain('sensitive upstream body');
    } finally { warn.mockRestore(); }
  });
  it('preserves the complete native intake receipt on a signed dispatch while dropping unlisted fields',async()=>{
    const body={requestId:'stable-request',order:{sourceHash:'a'.repeat(64)}};
    const fetcher=jest.fn().mockImplementation(async(url,options)=>{
      expect(String(url)).toBe('https://wms.example/api/integrations/erp/workflow/v1/orders/sale-1/dispatch');
      expect(options.method).toBe('POST');expect(options.body).toBe(JSON.stringify(body));
      const claims=await new JwtService().verifyAsync(options.headers.Authorization.slice(7),{publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString(),algorithms:['RS256'],issuer:'erp-test',audience:'wms-test'});
      expect(claims.station).toBe('dispatch');expect(claims.scope).toBe('wms.workspace.command');expect(claims.path).toBe('/orders/sale-1/dispatch');
      expect(claims.bodyHash).toBe(createHash('sha256').update(JSON.stringify(body)).digest('hex'));
      return new Response(JSON.stringify({...dispatchReceipt,...nativeReceipt,redirectUrl:'https://untrusted.invalid/',privatePayload:{cost:100},reused:true}),{headers:{'content-type':'application/json'}});
    });
    const bridge=new WmsWorkspaceBridge(prisma(['wms_tasks:read','wms_orders:create']),{...env,WMS_WORKSPACE_COMMANDS_ENABLED:'true'},fetcher);
    const result=await bridge.command('employee','company','sale-1','dispatch','dispatch',body);
    expect(result).toMatchObject(nativeReceipt);
    for(const key of ['redirectUrl','privatePayload','reused'])expect(result).not.toHaveProperty(key);
  });
  it('keeps a false reservation result and accepts legacy receipts without adding native metadata',()=>{
    const blocked=projectWorkspaceResponse({...dispatchReceipt,...nativeReceipt,reservationAccepted:false},true,'sale-1',true,'dispatch');
    expect(blocked).toHaveProperty('reservationAccepted',false);
    const legacy=projectWorkspaceResponse(dispatchReceipt,true,'sale-1',true,'dispatch');
    for(const key of Object.keys(nativeReceipt))expect(legacy).not.toHaveProperty(key);
  });
  it('rejects every partial native receipt and malformed identifiers, work barcodes and reservation booleans',()=>{
    for(const key of Object.keys(nativeReceipt)) {
      const partial:Record<string,unknown>={...dispatchReceipt,...nativeReceipt};delete partial[key];
      expect(()=>projectWorkspaceResponse(partial,true,'sale-1',true,'dispatch')).toThrow('WMS 回應格式不符');
    }
    const badIds=[0,-1,1.5,'12',null,NaN,Infinity,2147483648];
    for(const key of ['nativeIntakeId','wmsOrderId','batchId'])for(const value of badIds)expect(()=>projectWorkspaceResponse({...dispatchReceipt,...nativeReceipt,[key]:value},true,'sale-1',true,'dispatch')).toThrow();
    for(const workBarcode of ['','WT0123','WT0123456789abcdef01','https://bad.invalid','WT0123456789ABCDEF01\n',null])expect(()=>projectWorkspaceResponse({...dispatchReceipt,...nativeReceipt,workBarcode},true,'sale-1',true,'dispatch')).toThrow();
    for(const reservationAccepted of [undefined,null,'true','false',0,1])expect(()=>projectWorkspaceResponse({...dispatchReceipt,...nativeReceipt,reservationAccepted},true,'sale-1',true,'dispatch')).toThrow();
  });
  it('never adds dispatch receipt metadata to read-only or warehouse scan views',()=>{
    const readonly={...dispatchReceipt,...nativeReceipt,contractVersion:'wms.workspace-read.v1'};
    const read=projectWorkspaceResponse(readonly,true,'sale-1',false,'dispatch');
    const scan=projectWorkspaceResponse({...dispatchReceipt,...nativeReceipt},true,'sale-1',true,'pick');
    for(const result of [read,scan])for(const key of Object.keys(nativeReceipt))expect(result).not.toHaveProperty(key);
  });
});
