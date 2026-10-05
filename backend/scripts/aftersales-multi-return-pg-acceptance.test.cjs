const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { guard, sourceSnapshot, receiptInput } = require('./aftersales-multi-return-pg-acceptance.cjs');
const erp = 'postgresql://erp_dev_runtime:synthetic-test-only@127.0.0.1:15442/erp_dev_20260921?schema=public';

test('multi-return PG acceptance only accepts explicit opt-in and the fixed ERP DEV proxy with one connection', () => {
  const env = { AFTERSALES_MULTI_RETURN_PG_ACCEPTANCE: 'true', ERP_PG_ACCEPTANCE_URL: erp };
  const accepted = guard(env); assert.equal(accepted.database, 'erp_dev_20260921');
  assert.equal(new URL(accepted.url).searchParams.get('connection_limit'), '1');
  for (const value of [undefined, 'false', 'TRUE', '1']) assert.throws(() => guard({ ...env, AFTERSALES_MULTI_RETURN_PG_ACCEPTANCE: value }));
  for (const value of [erp.replace('15442', '15443'), erp.replace('15442', '5432'), erp.replace('127.0.0.1', 'db.example.invalid'),
    erp.replace('erp_dev_runtime', 'production_runtime'), erp.replace('erp_dev_20260921', 'production'), erp.replace('schema=public', 'schema=private'),
    erp + '&options=other', erp + '&schema=public', erp + '#other', erp.replace('synthetic-test-only@', '@')])
    assert.throws(() => guard({ ...env, ERP_PG_ACCEPTANCE_URL: value }));
});
test('missing opt-in exits before database/service imports, without printing supplied secret-like values', () => {
  const marker = 'DO_NOT_OUTPUT_SYNTHETIC_CREDENTIAL';
  const run = spawnSync(process.execPath, [path.join(__dirname, 'aftersales-multi-return-pg-acceptance.cjs')], {
    env: { PATH: process.env.PATH, ERP_PG_ACCEPTANCE_URL: erp.replace('synthetic-test-only', marker) }, encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 1); assert.equal(run.stdout, '');
  const result = JSON.parse(run.stderr); assert.equal(result.phase, 'guard'); assert.equal(result.checksPassed, 0);
  assert.equal(result.businessMutationsCommitted, false); assert.ok(!run.stderr.includes(marker)); assert.ok(!run.stderr.includes('postgresql://'));
});
test('quantity-two source snapshots keep one CaseItem identity while native requests represent individual physical pieces', () => {
  const product = { sku: 'SYNTHETIC-SKU', name: 'SYNTHETIC PRODUCT' };
  for (const kind of ['serial', 'nonserial', 'repair']) {
    const source = sourceSnapshot('SYNTHETIC-COMPANY', 'SYNTHETIC-RUN', kind, product);
    const request = receiptInput('SYNTHETIC-COMPANY', source, 'SYNTHETIC LOCATION', kind === 'nonserial' ? [null, null] : ['SN-A', 'SN-B']);
    assert.equal(source.items.length, 1); assert.equal(source.items[0].quantity, 2); assert.equal(source.items[0].serialNumber, null);
    assert.equal(request.items.length, 2); assert.equal(request.items[0].sourceItemId, request.items[1].sourceItemId);
    assert.equal(request.sourceCaseId, source.id); assert.equal(source.repairAllowed, false); assert.equal(source.releaseInfo, null);
    if (kind === 'nonserial') assert.ok(request.items.every(item => !('serialNumber' in item)));
    else assert.notEqual(request.items[0].serialNumber, request.items[1].serialNumber);
    assert.equal(request.category, kind === 'repair' ? 'REPAIR' : 'RETURN');
    assert.notEqual(receiptInput('SYNTHETIC-COMPANY', source, 'SYNTHETIC LOCATION', [null]).requestId, request.requestId);
  }
});
