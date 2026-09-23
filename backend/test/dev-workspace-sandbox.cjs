const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../scripts/dev-sandbox.cjs'),'utf8');
(async()=>{
 let calls=0;const Socket=function(){};Socket.prototype.connect=()=>{calls++;return true};const child={};
 const context={require:name=>name==='node:net'?{Socket}:name==='node:child_process'?child:{syncBuiltinESMExports(){}},URL,process:{env:{ERP_DEV_SANDBOX:'true',DB_NAME:'erp_dev_test',DB_USER:'erp_dev_runtime',SEED_ON_STARTUP:'false',RUNTIME_SCHEDULES_ENABLED:'false',CLOUDSQL_INSTANCE:'test',WMS_PORTAL_SSO_ENABLED:'true',WMS_PORTAL_SERVICE_URL:'https://corely-wms-dev-sp5g377smq-de.a.run.app'}},fetch:async()=>({ok:true})};
 vm.runInNewContext(source,context);
 for(const url of ['https://erp.corely.cc','https://api.shopify.com','https://corely-wms-sp5g377smq-de.a.run.app/api/auth/erp/bind','https://corely-wms-dev-sp5g377smq-de.a.run.app/api/orders','https://corely-wms-dev-sp5g377smq-de.a.run.app/api/auth/erp/bind?secret=x']) await assert.rejects(context.fetch(url,{method:'POST',redirect:'error'}));
 assert.equal((await context.fetch('https://corely-wms-dev-sp5g377smq-de.a.run.app/api/auth/erp/staff',{method:'POST',redirect:'error'})).ok,true);
 assert.throws(()=>new Socket().connect({host:'smtp.gmail.com',port:443}));assert.throws(()=>child.spawn('echo',['test']));
 new Socket().connect({host:'corely-wms-dev-sp5g377smq-de.a.run.app',port:443});new Socket().connect({path:'/cloudsql/test/.s.PGSQL.5432'});assert.equal(calls,2);
 console.log('DEV allows only the internal WMS bridge; production and external effects remain blocked');
})();
