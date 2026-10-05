const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { guard, documents } = require('./aftersales-return-stock-pg-acceptance.cjs');
const erp = 'postgresql://erp_dev_runtime:synthetic-test-only@127.0.0.1:15442/erp_dev_20260921?schema=public';
test('return-stock PG acceptance requires explicit opt-in and only the fixed DEV loopback database', () => {
  assert.equal(guard({ AFTERSALES_RETURN_STOCK_PG_ACCEPTANCE: 'true', ERP_PG_ACCEPTANCE_URL: erp }).database, 'erp_dev_20260921');
  assert.throws(() => guard({ ERP_PG_ACCEPTANCE_URL: erp }));
  for (const value of [erp.replace('15442', '5432'), erp.replace('127.0.0.1', 'db.example.invalid'), erp.replace('erp_dev_20260921', 'production'), erp + '&options=other'])
    assert.throws(() => guard({ AFTERSALES_RETURN_STOCK_PG_ACCEPTANCE: 'true', ERP_PG_ACCEPTANCE_URL: value }));
});
test('missing opt-in exits before loading any database or HTTP client without credential output', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'aftersales-return-stock-pg-acceptance.cjs')], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).phase, 'guard'); assert.equal(JSON.parse(result.stderr).checksPassed, 0);
  assert.ok(!result.stderr.includes('postgresql://'));
});
test('source QC fixture is complete and genuinely links different inspection/report versions', () => {
  const { repairInspection, repairReport } = documents();
  assert.equal(repairInspection.revision, 2); assert.equal(repairReport.revision, 1); assert.equal(repairReport.inspectionRevision, 2);
  assert.equal(repairReport.data.qcResult, 'PASS'); assert.equal(repairReport.data.outcome, 'REPAIRED');
});
