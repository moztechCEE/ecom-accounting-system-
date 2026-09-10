import { generateKeyPairSync } from 'node:crypto';
import { WmsWorkspaceBridge,projectWorkspaceResponse } from './wms-workspace-bridge';
import { JwtService } from '@nestjs/jwt';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const env={WMS_WORKSPACE_READ_ENABLED:'true',WMS_WORKSPACE_URL:'https://wms.example/',WMS_WORKSPACE_ISSUER:'erp-test',WMS_WORKSPACE_AUDIENCE:'wms-test',
  WMS_WORKSPACE_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
const prisma=(permissions=['wms_tasks:read','wms_picking:execute','wms_packing:execute'])=>({
  user:{findUnique:jest.fn().mockResolvedValue({isActive:true,mustChangePassword:false})},
  userRole:{findMany:jest.fn().mockResolvedValue([{role:{code:'EMPLOYEE',permissions:permissions.map(p=>{const [resource,action]=p.split(':');return {permission:{resource,action}};})}}])},
}) as any;
const page={contractVersion:'wms.workspace-read.v1',source:'wms',mode:'read_only',items:[],total:0};
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
});
