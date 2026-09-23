/** Real Gemini + TEST receipt only. No DB connection, deployment change, or real business data.
 * Run after backend build: node artifacts/access-expense-ai/live-receipt-smoke.cjs
 * Uses the existing ERP-specific Secret Manager secret in process memory only.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const backend = path.resolve(__dirname, '../../backend');
require(path.join(backend, 'node_modules/reflect-metadata'));
const { AiService } = require(path.join(backend, 'dist/src/modules/ai/ai.service.js'));
const { ExpenseReceiptService } = require(path.join(backend, 'dist/src/modules/expense/expense-receipt.service.js'));
async function main() {
  const start = Date.now();
  const key = execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret=ecom-accounting-gemini-api-key', '--project=moztech-main-db'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  assert.ok(key);
  const sandbox = process.argv.includes('--sandbox');
  const settings = { GEMINI_API_KEY: key, ERP_DEV_SANDBOX: sandbox ? 'true' : 'false', ERP_DEV_AI_ENABLED: sandbox ? 'true' : 'false' };
  if (sandbox) {
    Object.assign(process.env,settings,{DB_NAME:'erp_dev_synthetic_smoke',DB_USER:'erp_dev_runtime',SEED_ON_STARTUP:'false',RUNTIME_SCHEDULES_ENABLED:'false',CLOUDSQL_INSTANCE:'synthetic-no-database',WMS_PORTAL_SSO_ENABLED:'false'});
    require(path.join(backend,'scripts/dev-sandbox.cjs'));
    await assert.rejects(fetch('https://example.invalid/never-send'), {code:'ERP_DEV_EXTERNAL_EFFECT_BLOCKED'});
  }
  const config = { get: name => settings[name] };
  const ai = new AiService(config);
  const company = 'synthetic-company';
  const userId = 'synthetic-employee';
  const expenses = {
    assertEntityAccess: async (actor, entity) => {
      assert.equal(actor, userId); assert.equal(entity, company);
      return {user:{employee:{departmentId:'synthetic-dept'}},roles:['EMPLOYEE'],permissions:['expense_self:read','expense_self:create'],admin:false};
    },
    getReimbursementItems: async (entity, access) => {
      assert.equal(entity, company); assert.deepEqual(access.roles,['EMPLOYEE']);
      return [{id:'synthetic-office',name:'辦公文具',description:'Office stationery supplies'}];
    },
  };
  const prisma = {expenseRequest:{count:async query => {assert.equal(query.where.entityId,company);return 0;}}};
  const service = new ExpenseReceiptService(prisma,config,ai,expenses);
  const result = await service.recognize(userId,{entityId:company,modelId:'gemini-2.5-flash',files:[{name:'synthetic-receipt.png',mimeType:'image/png',url:'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'synthetic-receipt.png')).toString('base64')}]});
  const checks = {humanConfirmationRequired:result.status==='needs_confirmation',correctAmount:result.fields.amountOriginal===1200,correctCurrency:result.fields.currency==='TWD',correctDate:result.fields.expenseDate==='2026-09-23',eligibleItem:result.fields.suggestedItemId==='synthetic-office',originalFingerprint:result.fingerprints.length===1};
  const evidence = {sandbox,sandboxAiOptIn:sandbox,syntheticOnly:true,source:'real configured Gemini API, mocked ERP records',deploymentChanged:false,databaseConnected:false,elapsedMs:Date.now()-start,result,checks,passed:Object.values(checks).every(Boolean)};
  fs.writeFileSync(path.join(__dirname,sandbox?'live-ai-receipt-sandbox-smoke.json':'live-ai-receipt-smoke.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({passed:evidence.passed,checks,elapsedMs:evidence.elapsedMs}));
  assert.ok(evidence.passed,'Inspect synthetic receipt evidence');
}
main().catch(error => {console.error(JSON.stringify({passed:false,errorType:error?.name||'Error'}));process.exitCode=1;});
