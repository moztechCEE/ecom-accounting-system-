// Run after npm run build. WMS_WORKSPACE_SOURCE_ROOT points to the reviewed WMS
// checkout; NODE_PATH may point to that checkout's installed backend dependencies.
// All DB rows and RSA keys are ephemeral. No company DB or cloud credentials used.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {generateKeyPairSync}=require('node:crypto');
test('ERP bridge -> real HTTP delegation -> WMS scoped SQL -> ERP projection',async()=>{
 const source=process.env.WMS_WORKSPACE_SOURCE_ROOT;
 assert.ok(source,'WMS_WORKSPACE_SOURCE_ROOT must identify the reviewed source checkout');
 const express=require('express'),{PGlite}=require('@electric-sql/pglite');
 const {setup}=require(path.join(source,'backend/tests/erpWorkspace.fixture.cjs'));
 const {createErpWorkspaceRouter}=require(path.join(source,'backend/src/routes/erpWorkspaceRoutes.js'));
 const {WmsWorkspaceBridge}=require('../dist/src/modules/integration/wms/wms-workspace-bridge.js');
 const db=new PGlite();let server;
 try{
  const pool=await setup(db),keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const app=express();app.use('/api/integrations/erp/v1',createErpWorkspaceRouter({pool,env:{
    ERP_WORKSPACE_READ_ENABLED:'true',ERP_WORKSPACE_ISSUER:'erp-test',ERP_WORKSPACE_AUDIENCE:'wms-test',
    ERP_WORKSPACE_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
  }}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  let held=['wms_tasks:read','wms_picking:execute','wms_packing:execute'];
  const prisma={user:{findUnique:async()=>({isActive:true,mustChangePassword:false})},userRole:{findMany:async()=>[{role:{code:'EMPLOYEE',permissions:held.map(p=>{const [resource,action]=p.split(':');return{permission:{resource,action}};})}}]}};
  const bridge=new WmsWorkspaceBridge(prisma,{NODE_ENV:'test',WMS_WORKSPACE_READ_ENABLED:'true',WMS_WORKSPACE_URL:`http://127.0.0.1:${server.address().port}/`,
    WMS_WORKSPACE_ISSUER:'erp-test',WMS_WORKSPACE_AUDIENCE:'wms-test',WMS_WORKSPACE_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()});
  const query={entityId:'company',area:'pick'};
  const pick=await bridge.read('employee',query);
  assert.deepEqual(pick.items.map(o=>o.id),['erp-10']);assert.equal(pick.source,'wms');assert.equal(pick.items[0].picked,1);
  const pack=await bridge.read('employee',{...query,area:'pack'});
  assert.deepEqual(pack.items.map(o=>o.id),['erp-11']);
  const detail=await bridge.read('employee',query,'erp-10');
  assert.deepEqual(detail.allowedActions,[]);assert.equal(detail.revision,0);assert.equal(detail.state,'picking');
  await assert.rejects(bridge.read('employee',query,'erp-12'),/WMS_ORDER_NOT_ACCESSIBLE/);
  await assert.rejects(bridge.read('employee',{...query,entityId:'other'}),/WMS_SCOPE_DENIED/);
  await db.exec("UPDATE erp_workspace_grants SET revoked_at=now() WHERE station='pack'");
  await assert.rejects(bridge.read('employee',{...query,area:'pack'}),/WMS_SCOPE_DENIED/);
  held=['wms_tasks:read'];
  await assert.rejects(bridge.read('employee',query),/WMS_STATION_DENIED/);
  assert.equal((await db.query('SELECT status FROM orders WHERE id=10')).rows[0].status,'picking');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
});
