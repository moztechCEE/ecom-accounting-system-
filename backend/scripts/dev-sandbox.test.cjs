const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const preload = path.join(__dirname, 'dev-sandbox.cjs');
const env = { ...process.env, ERP_DEV_SANDBOX: 'true', DB_NAME: 'erp_dev_test', DB_USER: 'erp_dev_runtime', SEED_ON_STARTUP: 'false', RUNTIME_SCHEDULES_ENABLED: 'false', CLOUDSQL_INSTANCE: 'test:region:instance' };
test('DEV fails closed for production database, user and schedules', () => {
  for (const patch of [{ DB_NAME: 'erp_db' }, { DB_USER: 'erp_user' }, { RUNTIME_SCHEDULES_ENABLED: 'true' }, { SEED_ON_STARTUP: 'true' }]) {
    assert.notEqual(spawnSync(process.execPath, ['--require', preload, '-e', ''], { env: { ...env, ...patch } }).status, 0);
  }
});
test('DEV blocks HTTP, fetch, TCP and subprocesses before connection', () => {
  const source = `const assert=require('node:assert/strict'); const check=e=>e.code==='ERP_DEV_EXTERNAL_EFFECT_BLOCKED';
    for(const f of [()=>require('node:http').get('http://127.0.0.1:9999'),()=>require('node:https').get('https://example.com'),()=>require('node:net').connect(5432,'127.0.0.1'),()=>require('node:child_process').spawn('echo',['test'])]) assert.throws(f,check);
    assert.rejects(fetch('https://example.com'),check);`;
  const result = spawnSync(process.execPath, ['--require', preload, '-e', source], { env });
  assert.equal(result.status, 0, result.stderr.toString());
});
