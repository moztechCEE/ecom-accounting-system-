const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { connection, rollback, savepoints, orderingAcceptance } = require('./aftersales-dev-pg-acceptance.cjs');
const erp = 'postgresql://erp_dev_runtime:synthetic-test-only@127.0.0.1:15442/erp_dev_20260921?schema=public';
const source = 'postgresql://moztech_aftersales_dev:synthetic-test-only@127.0.0.1:15443/moztech_after_sales_dev';
test('PG acceptance permits only the fixed two private DEV proxy connections', () => {
  assert.equal(connection(erp, 'erp').database, 'erp_dev_20260921');
  assert.equal(connection(source, 'source').database, 'moztech_after_sales_dev');
});
test('PG acceptance rejects production, arbitrary ports/users/databases and connection overrides before loading a client', () => {
  for (const value of [erp.replace('127.0.0.1','db.example.invalid'),erp.replace('15442','5432'),erp.replace('erp_dev_runtime','root'),erp.replace('erp_dev_20260921','production'),erp.replace('schema=public','schema=private'),erp+'&host=db.example.invalid',erp+'&options=-csearch_path=private',erp+'#fragment',erp+'&schema=public'])
    assert.throws(() => connection(value, 'erp'));
  assert.throws(() => connection(source, 'erp'));
  assert.throws(() => connection(erp, 'source'));
  assert.throws(() => connection(source, 'other'));
});
test('runner exits at opt-in guard without loading a database client or leaking its error',()=>{
  const result=spawnSync(process.execPath,[path.join(__dirname,'aftersales-dev-pg-acceptance.cjs')],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);
  const summary=JSON.parse(result.stderr.trim());
  assert.equal(summary.phase,'guard');assert.equal(summary.checksPassed,0);
  assert.equal(summary.fullWorkflowAccepted,false);
  assert.ok(!result.stderr.includes('postgresql://'));
});
test('rollback wrapper always throws inside the real transaction callback and preserves unexpected failures',async()=>{
  const tx={synthetic:true};let rolledBack=false;
  const client={$transaction:async(fn,options)=>{
    assert.equal(options.isolationLevel,'Serializable');
    try{return await fn(tx);}catch(error){rolledBack=true;throw error;}
  }};
  await rollback(client,async(actual)=>{assert.equal(actual,tx);},{isolationLevel:'Serializable'});
  assert.equal(rolledBack,true);
  const failure=new Error('synthetic failure');
  await assert.rejects(rollback({$transaction:async fn=>fn(tx)},async()=>{throw failure;}),error=>error===failure);
});
test('savepoint wrapper rolls back a failed native operation before the next assertion',async()=>{
  const sql=[];const tx={$executeRawUnsafe:async query=>{sql.push(query);}};
  const step=savepoints(tx);
  await assert.rejects(step(async actual=>{assert.equal(actual,tx);throw new Error('synthetic rejection');}),/synthetic rejection/);
  assert.deepEqual(sql,['SAVEPOINT qa_1','ROLLBACK TO SAVEPOINT qa_1','RELEASE SAVEPOINT qa_1']);
  assert.equal(await step(async()=>42),42);
  assert.deepEqual(sql.slice(-2),['SAVEPOINT qa_2','RELEASE SAVEPOINT qa_2']);
});
test('a source writer failure before the concurrency barrier cannot hang the runner',async()=>{
  const client={$transaction:async()=>{throw new Error('synthetic unavailable');}};
  await assert.rejects(orderingAcceptance(client,client,{}),/failed before entering/);
});
