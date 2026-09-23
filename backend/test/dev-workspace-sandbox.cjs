const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../scripts/dev-sandbox.cjs'),'utf8');
(async()=>{
 let calls=0;const Socket=function(){};Socket.prototype.connect=()=>{calls++;return true};const child={};
 const context={require:name=>name==='node:net'?{Socket}:name==='node:child_process'?child:name==='node:async_hooks'?require('node:async_hooks'):{syncBuiltinESMExports(){}},URL,Headers,process:{env:{ERP_DEV_SANDBOX:'true',DB_NAME:'erp_dev_test',DB_USER:'erp_dev_runtime',SEED_ON_STARTUP:'false',RUNTIME_SCHEDULES_ENABLED:'false',CLOUDSQL_INSTANCE:'test',WMS_PORTAL_SSO_ENABLED:'true',WMS_PORTAL_SERVICE_URL:'https://corely-wms-dev-sp5g377smq-de.a.run.app',WMS_PORTAL_SHARED_SECRET:'test-only-secret'}},fetch:async()=>({ok:true})};
 vm.runInNewContext(source,context);
 for(const url of ['https://erp.corely.cc','https://api.shopify.com','https://corely-wms-sp5g377smq-de.a.run.app/api/auth/erp/bind','https://corely-wms-dev-sp5g377smq-de.a.run.app/api/orders','https://corely-wms-dev-sp5g377smq-de.a.run.app/api/auth/erp/bind?secret=x']) await assert.rejects(context.fetch(url,{method:'POST',redirect:'error'}));
 assert.equal((await context.fetch('https://corely-wms-dev-sp5g377smq-de.a.run.app/api/auth/erp/staff',{method:'POST',redirect:'error',body:'{}',headers:{'Content-Type':'application/json','x-erp-service-key':'test-only-secret'}})).ok,true);
 assert.throws(()=>new Socket().connect({host:'smtp.gmail.com',port:443}));assert.throws(()=>child.spawn('echo',['test']));
 // A direct socket is still blocked; only the validated fetch may carry the private token.
 assert.throws(()=>new Socket().connect({host:'corely-wms-dev-sp5g377smq-de.a.run.app',port:443}));new Socket().connect({path:'/cloudsql/test/.s.PGSQL.5432'});assert.equal(calls,1);
 console.log('DEV allows only the internal WMS bridge; production and external effects remain blocked');
})();
