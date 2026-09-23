/**
 * Real-provider smoke with synthetic ERP data only.
 * Run from any directory after `npm --prefix backend run build`:
 *   node artifacts/access-expense-ai/live-copilot-smoke.cjs
 * Requires gcloud read access to the existing ERP-specific Gemini secret.
 * The secret is held only in process memory. No real database client is created.
 * This does not read/change deployment settings, write ERP records, or enable DEV outbound access.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const backend = path.join(repo, 'backend');
require(path.join(backend, 'node_modules/reflect-metadata'));
const { AiService } = require(path.join(backend, 'dist/src/modules/ai/ai.service.js'));
const { AiKnowledgeService } = require(path.join(backend, 'dist/src/modules/ai/ai-knowledge.service.js'));
const { AiCopilotAccessService } = require(path.join(backend, 'dist/src/modules/ai/ai-copilot-access.service.js'));
const { AiCopilotService } = require(path.join(backend, 'dist/src/modules/ai/ai-copilot.service.js'));
const { EntityAccessService } = require(path.join(backend, 'dist/src/common/entity-access/entity-access.service.js'));

async function main() {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const fixture = {
    entityId: 'synthetic-erp-copilot-company',
    userId: 'synthetic-erp-copilot-employee',
    departmentId: 'synthetic-erp-copilot-department',
    expectedAmountBase: 1200,
    expectedCount: 2,
  };
  const queryEvidence = [];
  const actor = {
    id: fixture.userId, isActive: true,
    accountingDataScope: 'SELF', salesDataScope: 'SELF', inventoryDataScope: 'SELF',
    employee: { id: 'synthetic-employee-profile', entityId: fixture.entityId, departmentId: fixture.departmentId },
    entityMemberships: [{ entityId: fixture.entityId, isPrimary: true }],
    roles: [{ role: { code: 'EMPLOYEE', name: '合成人員', permissions: [{ permission: { resource: 'expense_self', action: 'read' } }] } }],
  };
  const delegates = {
    user: { findUnique: async ({ where }) => {
      assert.equal(where.id, fixture.userId);
      return structuredClone(actor);
    } },
    expenseRequest: { aggregate: async (query) => {
      // The production access service, not this fixture, must provide the filter.
      assert.equal(query.where.entityId, fixture.entityId);
      assert.equal(query.where.createdBy, fixture.userId);
      assert.deepEqual(query._sum, { amountBase: true });
      assert.deepEqual(query._count, { id: true });
      queryEvidence.push(JSON.parse(JSON.stringify(query)));
      return { _sum: { amountBase: fixture.expectedAmountBase }, _count: { id: fixture.expectedCount } };
    } },
  };
  const prisma = new Proxy(delegates, { get(target, property) {
    if (!(property in target)) throw new Error('unexpected_fixture_delegate');
    return target[property];
  } });
  const key = execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest',
    '--secret=ecom-accounting-gemini-api-key', '--project=moztech-main-db'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.ok(key, 'ERP provider key must be configured');
  const settings = { GEMINI_API_KEY: key, ERP_DEV_SANDBOX: 'false' };
  const ai = new AiService({ get: name => settings[name] });
  const responses = [];
  const providerCalls = [];
  const generate = ai.generateContent.bind(ai);
  ai.generateContent = async (...args) => {
    try {
      const output = await generate(...args);
      responses.push(output);
      providerCalls.push({ status: 'completed' });
      return output;
    } catch (error) {
      const safeCode = error?.getResponse?.()?.code;
      providerCalls.push({ status: 'failed', code: /^provider_[a-z0-9_]+$/.test(safeCode || '') ? safeCode : 'provider_unavailable' });
      throw error;
    }
  };
  const entityAccess = new EntityAccessService(prisma);
  const access = new AiCopilotAccessService(prisma, entityAccess);
  const copilot = new AiCopilotService(prisma, ai, new AiKnowledgeService(), access);
  const prompt = '請查詢我在 2026 年 9 月 1 日至 2026 年 9 月 23 日的費用申請總額與筆數。';
  const result = await copilot.processChat(fixture.entityId, fixture.userId, prompt,
    'gemini-2.5-flash', '/ap/expenses');
  const intent = ai.parseJsonOutput(responses[0] || '');
  const checks = {
    realProviderCompleted: responses.length === 2 && result.status === 'answered',
    correctToolSelected: intent?.tool === 'get_expense_stats',
    selfAndCompanyFilterApplied: queryEvidence.length === 1,
    correctFixtureAggregateReturned: Number(result.data?.total) === 1200 && result.data?.count === 2,
    sourcePresent: result.sources?.some(source => source.kind === 'metric' && source.path === '/ap/expenses') === true,
    queryTimestampPresent: Number.isFinite(Date.parse(result.checkedAt)),
    ownExpenseScope: result.scope === '自己的費用申請',
    replyUsesFixtureAmount: /1,?200/.test(result.reply || ''),
    replyUsesFixtureCount: /2\s*(筆|份|個)|兩\s*(筆|份|個)/.test(result.reply || ''),
  };
  const evidencePath = path.join(__dirname, 'live-copilot-smoke.json');
  const previous = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : undefined;
  const previousRuns = previous ? [...(previous.previousRuns || []), {
    startedAt: previous.startedAt, elapsedMs: previous.elapsedMs, passed: previous.passed,
    checks: previous.checks, status: previous.result?.status,
    providerCalls: previous.providerCalls || [],
  }] : [];
  const evidence = {
    syntheticOnly: true,
    source: 'real configured Gemini API; production AiService/AiCopilotService/AiCopilotAccessService/EntityAccessService; injected synthetic Prisma delegates',
    deploymentChanged: false, databaseConnected: false,
    startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - start,
    modelId: ai.resolveModelId('gemini-2.5-flash'), fixture, prompt,
    intent, queries: queryEvidence, providerCalls, previousRuns, result, checks,
    passed: Object.values(checks).every(Boolean),
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ passed: evidence.passed, checks, elapsedMs: evidence.elapsedMs,
    evidence: 'artifacts/access-expense-ai/live-copilot-smoke.json' }));
  assert.ok(evidence.passed, 'live synthetic copilot checks failed; inspect non-secret evidence');
}
main().catch(error => { console.error(JSON.stringify({ passed: false, errorType: error?.name || 'Error' })); process.exitCode = 1; });
