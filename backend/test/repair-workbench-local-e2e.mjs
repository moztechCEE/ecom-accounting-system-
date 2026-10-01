/**
 * One-shot HTTP test against the isolated, synthetic DOA fixture only.
 * From the checkout root:
 * REPAIR_LOCAL_TEST=true REPAIR_LOCAL_E2E_OPT_IN=fresh-fixture-doa-20261002 \
 *   node backend/test/repair-workbench-local-e2e.mjs
 * A second run requires REPAIR_LOCAL_E2E_RERUN_OPT_IN=fresh-fixture-doa-20261002
 * AND the exact untouched starting states below. This script never resets data.
 * No database access, external sync, inventory posting, or accounting posting.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'http://127.0.0.1:57654/api/v1';
const COMPANY = 'fixture-doa-company';
const OTHER_COMPANY = 'fixture-doa-other';
const OPT_IN = 'fresh-fixture-doa-20261002';
const ROLES = Object.freeze({
  tech: 'fixture-doa-tech', clerk: 'fixture-doa-clerk',
  csr: 'fixture-doa-csr', other: 'fixture-doa-other',
});
const IDS = Object.freeze({
  owned: 'fixture-doa-owned', replacement: 'fixture-doa-unclaimed',
  held: 'fixture-doa-held', waiting: 'fixture-doa-waiting',
  other: 'fixture-doa-other-item',
});
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPORT = resolve(ROOT, 'artifacts/repair-local/http-e2e.json');
const runId = Date.now().toString(36);
const report = {
  schema: 'corely.repair-local-http-e2e.v1', runId, startedAt: new Date().toISOString(),
  api: API, entityId: COMPANY, result: 'RUNNING', checks: [], calls: [],
  isolation: {
    fixedLocalhostPort: 57654, fixedSyntheticActors: Object.values(ROLES),
    databaseAccess: false, dataReset: false, externalDelivery: false,
  },
  limitations: [
    'Source repairAllowed is a fixed synthetic fixture value; this does not verify customer approval or real accounting/payment integration.',
    'Replacement trace fields are recorded; no formal inventory reservation, posting, or movement is performed.',
    'Notifications and compatible outbox records are persisted locally; no external delivery or websocket delivery is tested.',
  ],
};
let mutationStarted = false;
let earlierReport;
let allowReportWrite = false;
const check = (name, value, evidence) => {
  assert.ok(value, name);
  report.checks.push({ name, passed: true, ...(evidence === undefined ? {} : { evidence }) });
};
const requestId = (name) => `doa-e2e-${runId}-${name}`;
const query = (values = {}) => '?' + new URLSearchParams({ entityId: COMPANY, ...values });
const itemPath = (id, values) => `/mailroom/items/${id}${query(values)}`;
const documentPath = (id, values) => `/repair-workbench/items/${id}/documents${query(values)}`;
const summary = (item) => ({
  id: item.id, status: item.status, version: item.version,
  repairOwnerId: item.repairOwnerId, custodianId: item.custodianId,
  nextUserId: item.nextUserId, location: item.location,
  serialNumber: item.serialNumber,
  inspection: item.repairInspection && {
    status: item.repairInspection.status, revision: item.repairInspection.revision,
    number: item.repairInspection.number, plan: item.repairInspection.data?.plan,
    review: item.repairInspection.review,
  },
  repair: item.repairReport && {
    status: item.repairReport.status, revision: item.repairReport.revision,
    inspectionRevision: item.repairReport.inspectionRevision,
    outcome: item.repairReport.data?.outcome, qcResult: item.repairReport.data?.qcResult,
    ...(item.repairReport.data?.outcome === 'REPLACED' ? {
      replacementCondition: item.repairReport.data.replacementCondition,
      replacementSku: item.repairReport.data.replacementSku,
      replacementSerial: item.repairReport.data.replacementSerial,
      replacementSource: item.repairReport.data.replacementSource,
      originalDisposition: item.repairReport.data.originalDisposition,
      inventoryReference: item.repairReport.data.inventoryReference,
    } : {}),
  },
});
function containsDocuments(value) {
  if (Array.isArray(value)) return value.some(containsDocuments);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) =>
    ['repairInspection', 'repairReport'].includes(key) || containsDocuments(nested));
}
async function api(name, role, path, expected = 200, body) {
  assert.ok(Object.hasOwn(ROLES, role), 'Only fixed fixture actors are allowed');
  const target = new URL(API + path);
  assert.equal(target.origin, 'http://127.0.0.1:57654');
  assert.ok(target.pathname.startsWith('/api/v1/'), 'Only fixed fixture API prefix is allowed');
  const localPath = target.pathname.slice('/api/v1'.length);
  const match = /^(?:\/mailroom\/items\/|\/repair-workbench\/items\/)(fixture-doa-[a-z-]+)(?:\/(actions|inspection|repair-report|documents))?$/.exec(localPath);
  const listRoute = ['/users/me', '/notifications', '/mailroom/items', '/mailroom/tasks', '/mailroom/source-cases'].includes(localPath);
  assert.ok(listRoute || (match && Object.values(IDS).includes(match[1])), 'Route or item is not an allowlisted fixture');
  if (target.searchParams.has('entityId'))
    assert.ok([COMPANY, OTHER_COMPANY].includes(target.searchParams.get('entityId')), 'Unexpected entity');
  if (body) {
    assert.ok(match && ['actions', 'inspection', 'repair-report'].includes(match[2]), 'Only fixed item commands/document saves are allowed');
    assert.equal(body.entityId, COMPANY, 'Writes can only name the synthetic primary company');
    assert.ok([IDS.owned, IDS.replacement, IDS.held, IDS.other].includes(match[1]));
    mutationStarted = true;
  }
  const response = await fetch(target, {
    method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${ROLES[role]}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`${name}: API returned non-JSON (${response.status})`); }
  report.calls.push({
    name, actor: ROLES[role], method: body ? 'POST' : 'GET', path,
    expectedStatus: expected, status: response.status,
    ...(body ? { requestId: body.requestId, expectedVersion: body.expectedVersion } : {}),
    ...(response.status >= 400 ? { error: data } : {}),
  });
  assert.equal(response.status, expected, `${name}: ${JSON.stringify(data)}`);
  return data;
}
const detail = (name, id, role = 'tech') => api(name, role, itemPath(id));
async function action(name, id, role, state, actionName, extras = {}, expected = 201) {
  return api(name, role, `/mailroom/items/${id}/actions`, expected, {
    entityId: COMPANY, requestId: requestId(name), expectedVersion: state.version,
    action: actionName, ...extras,
  });
}
async function save(name, id, state, kind, status, data, expected = 201, role = 'tech') {
  return api(name, role, `/repair-workbench/items/${id}/${kind}`, expected, {
    entityId: COMPANY, requestId: requestId(name), expectedVersion: state.version, status, data,
  });
}
const draftInspection = () => ({
  complaint: '', reproduction: 'NOT_TESTED', testConditions: '', checks: [],
  diagnosis: '', causeStatus: 'UNKNOWN', plan: 'REPAIR', planNote: '', feeSuggestion: 'REVIEW', estimateNote: '',
});
const inspection = (plan = 'REPAIR', paid = true) => ({
  complaint: '合成示範：顧客表示行動電源無法充電', reproduction: 'YES',
  testConditions: '合成示範：相同測試器、充電器及線材交叉檢測',
  checks: [{ name: '充電功能', result: 'FAIL', observation: '合成示範：已重現充電功能異常' }],
  diagnosis: '合成示範：充電模組異常', causeStatus: 'CONFIRMED', plan,
  planNote: plan === 'REPLACE' ? '合成示範：一對一替換複驗合格整新品' : '合成示範：更換充電模組並複驗',
  feeSuggestion: paid ? 'PAID' : 'FREE', ...(paid ? { estimateAmount: 350 } : {}),
  estimateNote: paid ? '合成估價 350 元，零件及工時；非正式對客報價' : '合成示範：保固內免費方案',
});
const repair = (pass = true) => ({
  outcome: 'REPAIRED', workPerformed: '合成示範：更換充電模組並執行充放電複驗',
  parts: [{ name: '充電模組（合成樣本）', sku: 'DOA-DEMO-CHARGE', quantity: 1 }], laborMinutes: 30,
  checks: [{ name: '充放電功能複驗', result: pass ? 'PASS' : 'FAIL', observation: pass ? '合成示範：充放電結果正常' : '合成示範：充電異常仍重現' }],
  qcResult: pass ? 'PASS' : 'FAIL', qcNotes: pass ? '合成示範：必要複驗通過' : '合成示範：複驗失敗，不可交回',
  deliveredAccessories: '合成示範：原隨附線材一條',
});
async function guard() {
  assert.equal(process.env.REPAIR_LOCAL_TEST, 'true', 'Requires REPAIR_LOCAL_TEST=true');
  assert.equal(process.env.REPAIR_LOCAL_E2E_OPT_IN, OPT_IN, `Requires REPAIR_LOCAL_E2E_OPT_IN=${OPT_IN}`);
  assert.equal(new URL(API).hostname, '127.0.0.1');
  assert.equal(new URL(API).port, '57654');
  try { earlierReport = await readFile(REPORT, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (earlierReport)
    assert.equal(process.env.REPAIR_LOCAL_E2E_RERUN_OPT_IN, OPT_IN, 'An earlier report exists. A second run needs explicit fresh-fixture opt-in; existing progress is never reset.');
  for (const [role, id] of Object.entries(ROLES)) {
    const actor = await api(`guard-${role}`, role, '/users/me');
    check(`fixed-fixture-actor-${role}`, actor.id === id && actor.email === `${id}@example.invalid`);
    check(`no-wildcard-${role}`, !actor.effectivePermissions.includes('*'));
  }
  const start = {};
  for (const [key, status, version] of [
    ['owned', 'REPAIR_RECEIVED', 1], ['replacement', 'REPAIR_RECEIVED', 3],
    ['held', 'INSPECTING', 1], ['waiting', 'WAITING_CUSTOMER', 1],
  ]) {
    start[key] = await detail(`guard-start-${key}`, IDS[key]);
    const item = start[key];
    check(`fresh-start-${key}`, item.entityId === COMPANY && item.status === status && item.version === version && item.repairOwnerId === ROLES.tech && item.custodianId === ROLES.tech, summary(item));
    if (key !== 'waiting') check(`no-existing-documents-${key}`, !item.repairInspection && !item.repairReport);
  }
  check('seeded-waiting-inspection-read-only', start.waiting.repairInspection?.status === 'SUBMITTED' && !start.waiting.repairReport);
  report.initialStates = Object.fromEntries(Object.entries(start).map(([key, item]) => [key, summary(item)]));
  if (earlierReport) await writeFile(REPORT.replace('.json', `.previous-${runId}.json`), earlierReport, { flag: 'wx' });
  allowReportWrite = true;
  return start;
}
async function run() {
  const start = await guard();
  const sources = await api('awaiting-repair-source-cases', 'tech', '/mailroom/source-cases' + query({ awaiting: 'true' }));
  check('customer-created-and-in-transit-sources-visible', ['fixture-doa-awaiting', 'fixture-doa-transit'].every((id) => sources.items.some((item) => item.id === id && item.type === 'REPAIR')));
  const all = await api('repair-all', 'tech', '/mailroom/items' + query({ view: 'repair', repairScope: 'all' }));
  check('same-company-repair-overview', all.items.length === 4 && all.items.every((item) => item.entityId === COMPANY));
  await api('csr-repair-overview-denied', 'csr', '/mailroom/items' + query({ view: 'repair' }), 403);
  await api('tech-other-company-query-denied', 'tech', '/mailroom/items' + query({ view: 'repair', entityId: OTHER_COMPANY }), 403);
  await api('other-company-actor-denied', 'other', itemPath(IDS.owned), 403);
  await api('cross-entity-item-read-denied', 'tech', itemPath(IDS.other), 404);
  await api('cross-entity-documents-read-denied', 'tech', documentPath(IDS.other), 404);
  await action('cross-entity-action-denied', IDS.other, 'tech', start.owned, 'start_inspection', {}, 404);
  await save('other-company-save-denied', IDS.owned, start.owned, 'inspection', 'DRAFT', draftInspection(), 403, 'other');
  await save('csr-document-save-denied', IDS.owned, start.owned, 'inspection', 'DRAFT', draftInspection(), 403, 'csr');
  await api('clerk-document-endpoint-denied', 'clerk', documentPath(IDS.waiting), 403);
  const csrWaiting = await api('csr-waiting-documents-readable', 'csr', documentPath(IDS.waiting));
  check('csr-documents-read-only', csrWaiting.editable === false && csrWaiting.repairInspection?.status === 'SUBMITTED');

  let owned = start.owned;
  const draftBody = { entityId: COMPANY, requestId: requestId('owned-draft'), expectedVersion: owned.version, status: 'DRAFT', data: draftInspection() };
  const firstSave = await api('owned-draft-save', 'tech', `/repair-workbench/items/${IDS.owned}/inspection`, 201, draftBody);
  check('draft-incomplete-accepted', firstSave.duplicate === false);
  owned = await detail('owned-after-draft', IDS.owned);
  check('draft-increments-once', owned.version === 2 && owned.repairInspection?.status === 'DRAFT');
  const duplicate = await api('owned-draft-exact-retry', 'tech', `/repair-workbench/items/${IDS.owned}/inspection`, 201, draftBody);
  check('idempotent-exact-retry', duplicate.duplicate === true);
  await api('owned-draft-different-retry-conflict', 'tech', `/repair-workbench/items/${IDS.owned}/inspection`, 409, { ...draftBody, data: { ...draftBody.data, complaint: '異內容合成示範' } });
  await save('owned-submit-incomplete-denied', IDS.owned, owned, 'inspection', 'SUBMITTED', draftInspection(), 400);
  await save('owned-stale-version-denied', IDS.owned, { version: 1 }, 'inspection', 'DRAFT', draftInspection(), 409);
  owned = await detail('owned-after-denied-writes', IDS.owned);
  check('retry-and-denials-do-not-increment', owned.version === 2 && owned.history.length === 1);
  await action('owned-start-inspection', IDS.owned, 'tech', owned, 'start_inspection');
  owned = await detail('owned-inspecting', IDS.owned);
  check('owned-inspection-started', owned.status === 'INSPECTING' && owned.custodianId === ROLES.tech);
  await save('owned-paid-inspection-submit', IDS.owned, owned, 'inspection', 'SUBMITTED', inspection());
  owned = await detail('owned-paid-inspection', IDS.owned);
  check('paid-estimate-submitted', owned.repairInspection.status === 'SUBMITTED' && owned.repairInspection.data.feeSuggestion === 'PAID' && owned.repairInspection.data.estimateAmount === 350);
  await action('owned-unreviewed-start-denied', IDS.owned, 'tech', owned, 'start_repair', {}, 400);
  await action('owned-await-customer', IDS.owned, 'tech', owned, 'await_customer', { note: '合成示範：付費修理估價 350 元，交客服確認顧客同意及會計足額入帳；不代表真實付款。' });
  owned = await detail('owned-awaiting-csr', IDS.owned);
  check('customer-handoff-keeps-technician-custody', owned.status === 'WAITING_CUSTOMER' && owned.custodianId === ROLES.tech);
  const tasks = await api('csr-handoff-task', 'csr', '/mailroom/tasks' + query());
  check('csr-received-waiting-customer-task', tasks.some((task) => task.item.id === IDS.owned && task.kind === 'WAITING_CUSTOMER'));
  const notifications = await api('csr-local-notification', 'csr', '/notifications');
  check('csr-local-notification-persisted', notifications.some((item) => item.data?.itemId === IDS.owned && item.category === 'mailroom'));
  const csrOwned = await api('csr-owned-documents-read-only', 'csr', documentPath(IDS.owned));
  check('csr-can-review-paid-estimate', csrOwned.editable === false && csrOwned.repairInspection.data.estimateAmount === 350);
  await action('owned-tech-cannot-resolve-customer', IDS.owned, 'tech', owned, 'resolve_customer', { note: '合成示範：維修師不能代客服確認' }, 403);
  await action('owned-csr-resolve-customer', IDS.owned, 'csr', owned, 'resolve_customer', { note: '本機合成會計收款示範：顧客同意 350 元且示範會計確認足額入帳；固定 source repairAllowed=true，不是正式收款或會計串接。' });
  owned = await detail('owned-returned-to-tech', IDS.owned);
  check('csr-resolution-returns-task-to-tech', owned.status === 'INSPECTING' && owned.nextUserId === ROLES.tech && owned.custodianId === ROLES.tech);
  check('csr-confirmation-bound-to-submitted-revision', owned.repairInspection.review?.inspectionRevision === owned.repairInspection.revision && owned.repairInspection.review.actorId === ROLES.csr);
  await action('owned-csr-cannot-repair', IDS.owned, 'csr', owned, 'start_repair', {}, 403);
  const previousInspectionRevision = owned.repairInspection.revision;
  await save('owned-revised-inspection-submit', IDS.owned, owned, 'inspection', 'SUBMITTED', { ...inspection(), diagnosis: '合成示範：追加複核充電模組異常，須重送當版客服確認' });
  owned = await detail('owned-revised-inspection', IDS.owned);
  check('inspection-revision-clears-previous-csr-confirmation', owned.repairInspection.revision === previousInspectionRevision + 1 && !owned.repairInspection.review);
  await action('owned-revised-unreviewed-start-denied', IDS.owned, 'tech', owned, 'start_repair', {}, 400);
  await action('owned-revised-await-customer', IDS.owned, 'tech', owned, 'await_customer', { note: '合成示範：檢修方案改版，再交客服確認此版方案及必要款項' });
  owned = await detail('owned-revised-waiting-csr', IDS.owned);
  await action('owned-revised-csr-resolve', IDS.owned, 'csr', owned, 'resolve_customer', { note: '本機合成示範：顧客同意更新檢修版本，示範會計足額入帳；非正式會計寫入' });
  owned = await detail('owned-revised-reviewed', IDS.owned);
  check('revised-inspection-needs-new-csr-confirmation', owned.repairInspection.review?.inspectionRevision === owned.repairInspection.revision && owned.repairInspection.review.actorId === ROLES.csr);
  const techTasks = await api('tech-returned-task', 'tech', '/mailroom/tasks' + query());
  check('tech-has-returned-inspection-task', techTasks.some((task) => task.item.id === IDS.owned && task.kind === 'INSPECTING'));
  const release = await api('owned-source-release', 'tech', documentPath(IDS.owned));
  check('synthetic-source-repair-release', release.release.available === true && release.release.repairAllowed === true && release.editable === true);
  await action('owned-start-repair', IDS.owned, 'tech', owned, 'start_repair');
  owned = await detail('owned-repairing', IDS.owned);
  check('allowed-source-starts-repair', owned.status === 'REPAIRING');
  await save('owned-part-identity-required', IDS.owned, owned, 'repair-report', 'SUBMITTED', { ...repair(false), parts: [{ name: '充電模組', sku: '', quantity: 1 }] }, 400);
  await save('owned-failed-report-submit', IDS.owned, owned, 'repair-report', 'SUBMITTED', repair(false));
  owned = await detail('owned-failed-report', IDS.owned);
  check('report-binds-current-inspection-revision', owned.repairReport.inspectionRevision === owned.repairInspection.revision, { inspectionRevision: owned.repairInspection.revision, reportInspectionRevision: owned.repairReport.inspectionRevision });
  await action('owned-failed-qc-cannot-complete', IDS.owned, 'tech', owned, 'complete_repair', { note: '合成示範：複驗失敗不得放行' }, 400);
  const failed = await detail('owned-after-failed-qc-denial', IDS.owned);
  check('failed-qc-denial-keeps-progress', failed.status === 'REPAIRING' && failed.version === owned.version);
  await save('owned-pass-report-submit', IDS.owned, owned, 'repair-report', 'SUBMITTED', repair());
  owned = await detail('owned-pass-report', IDS.owned);
  check('pass-report-revision-preserves-failed-history', owned.repairReport.revision === 2 && owned.history.some((entry) => entry.snapshot.repairReport?.data?.qcResult === 'FAIL'));
  await action('owned-complete-repair', IDS.owned, 'tech', owned, 'complete_repair', { note: '合成示範：維修及必要複驗完成，交回收發室本人簽收' });
  owned = await detail('owned-ready-for-return', IDS.owned);
  check('completion-keeps-custody-until-clerk-signs', owned.status === 'WAITING_RETURN_ACCEPTANCE' && owned.nextUserId === ROLES.clerk && owned.custodianId === ROLES.tech);
  const clerkDetail = await detail('clerk-logistics-detail-redacted', IDS.owned, 'clerk');
  check('clerk-item-and-history-documents-redacted', !containsDocuments(clerkDetail));
  const clerkList = await api('clerk-logistics-list-redacted', 'clerk', '/mailroom/items' + query());
  check('clerk-list-documents-redacted', !containsDocuments(clerkList));
  const clerkTasks = await api('clerk-return-task-redacted', 'clerk', '/mailroom/tasks' + query());
  check('clerk-return-task-documents-redacted', !containsDocuments(clerkTasks) && clerkTasks.some((task) => task.item.id === IDS.owned && task.kind === 'WAITING_RETURN_ACCEPTANCE'));
  await action('clerk-return-needs-confirmation', IDS.owned, 'clerk', owned, 'accept_return', { location: '收發室待寄回 DEMO-HTTP-01' }, 400);
  await action('clerk-accept-return', IDS.owned, 'clerk', owned, 'accept_return', { confirmedItems: true, location: '收發室待寄回 DEMO-HTTP-01' });
  owned = await detail('owned-final', IDS.owned);
  check('owned-finished-and-clerk-custody', owned.status === 'READY_FOR_DISPATCH' && owned.custodianId === ROLES.clerk && owned.nextUserId === null);
  const completedDocs = await api('owned-completed-documents-locked', 'tech', documentPath(IDS.owned));
  check('completed-document-editable-false', completedDocs.editable === false);

  let replacement = start.replacement;
  await action('replacement-start-inspection', IDS.replacement, 'tech', replacement, 'start_inspection');
  replacement = await detail('replacement-inspecting', IDS.replacement);
  await save('replacement-inspection-submit', IDS.replacement, replacement, 'inspection', 'SUBMITTED', inspection('REPLACE', false));
  replacement = await detail('replacement-inspection', IDS.replacement);
  await action('replacement-free-unreviewed-start-denied', IDS.replacement, 'tech', replacement, 'start_repair', {}, 400);
  await action('replacement-await-customer', IDS.replacement, 'tech', replacement, 'await_customer', { note: '合成示範：免費一對一整新品替換方案，先交客服確認顧客同意' });
  replacement = await detail('replacement-waiting-csr', IDS.replacement);
  await action('replacement-csr-resolve', IDS.replacement, 'csr', replacement, 'resolve_customer', { note: '合成示範：顧客同意本版免費整新品替換方案，無須收款' });
  replacement = await detail('replacement-reviewed', IDS.replacement);
  check('free-replacement-csr-reviewed-current-plan', replacement.repairInspection.review?.inspectionRevision === replacement.repairInspection.revision && replacement.repairInspection.review.actorId === ROLES.csr);
  await action('replacement-start-work', IDS.replacement, 'tech', replacement, 'start_repair');
  replacement = await detail('replacement-working', IDS.replacement);
  const replacementData = {
    ...repair(), outcome: 'REPLACED', parts: [], laborMinutes: 20,
    workPerformed: '合成示範：採用已複驗合格退貨整新品一對一替換',
    replacementCondition: 'REFURBISHED', replacementSku: 'DOA-DEMO-PB',
    replacementSerial: 'SN-DOA-DEMO-REFURBISHED-HTTP-01',
    replacementSource: '合成示範：退貨品複驗合格整新品庫位 DEMO-RF-01',
    originalDisposition: `合成示範：原件 ${replacement.serialNumber} 移至待故障處置 DEMO-HOLD-01`,
    inventoryReference: 'DEMO-INVENTORY-TRACE-HTTP-01（僅追蹤欄位，未正式庫存異動）',
  };
  await save('replacement-trace-required', IDS.replacement, replacement, 'repair-report', 'SUBMITTED', { ...replacementData, replacementSerial: '' }, 400);
  await save('replacement-original-serial-reuse-denied', IDS.replacement, replacement, 'repair-report', 'SUBMITTED', { ...replacementData, replacementSerial: replacement.serialNumber }, 409);
  await save('replacement-report-submit', IDS.replacement, replacement, 'repair-report', 'SUBMITTED', replacementData);
  replacement = await detail('replacement-report', IDS.replacement);
  check('replacement-original-and-replacement-trace-recorded', replacement.repairReport.data.replacementSerial === replacementData.replacementSerial && replacement.repairReport.data.originalDisposition.includes(replacement.serialNumber) && replacement.repairReport.data.inventoryReference === replacementData.inventoryReference && replacement.repairReport.inspectionRevision === replacement.repairInspection.revision);
  await action('replacement-complete', IDS.replacement, 'tech', replacement, 'complete_repair', { note: '合成示範：一對一整新品替換及複驗完成，保留待收發室簽收' });
  replacement = await detail('replacement-final', IDS.replacement);
  check('replacement-awaiting-clerk-keeps-tech-custody', replacement.status === 'WAITING_RETURN_ACCEPTANCE' && replacement.custodianId === ROLES.tech && replacement.nextUserId === ROLES.clerk);

  let held = start.held;
  await save('held-inspection-submit', IDS.held, held, 'inspection', 'SUBMITTED', inspection());
  held = await detail('held-submitted-inspection', IDS.held);
  await action('held-unreviewed-start-denied', IDS.held, 'tech', held, 'start_repair', {}, 400);
  await action('held-await-customer', IDS.held, 'tech', held, 'await_customer', { note: '合成示範：顧客同意待客服確認，款項尚未放行' });
  held = await detail('held-waiting-csr', IDS.held);
  await action('held-csr-resolve', IDS.held, 'csr', held, 'resolve_customer', { note: '合成示範：顧客同意本版方案，但會計尚未足額入帳；source 仍不允許施工' });
  held = await detail('held-reviewed-source-held', IDS.held);
  const heldDocuments = await api('held-source-not-released', 'tech', documentPath(IDS.held));
  check('held-source-payment-pending', heldDocuments.release.available === true && heldDocuments.release.repairAllowed === false && heldDocuments.release.sourceStatus === 'PENDING_PAYMENT');
  await action('held-start-repair-blocked', IDS.held, 'tech', held, 'start_repair', {}, 409);
  const heldFinal = await detail('held-final', IDS.held);
  check('held-remains-inspecting-awaiting-source-release', heldFinal.status === 'INSPECTING' && heldFinal.version === held.version && !heldFinal.repairReport);
  const waitingFinal = await detail('waiting-unchanged', IDS.waiting);
  check('waiting-fixture-was-read-only', JSON.stringify(summary(waitingFinal)) === JSON.stringify(summary(start.waiting)) && JSON.stringify(waitingFinal.repairInspection) === JSON.stringify(start.waiting.repairInspection));
  check('full-document-history-retained-for-tech', owned.history.some((entry) => entry.snapshot.repairInspection?.status === 'SUBMITTED') && owned.history.some((entry) => entry.snapshot.repairReport?.data?.qcResult === 'PASS'));
  for (const item of [owned, replacement, heldFinal])
    check(`local-outbox-remains-pending-${item.id}`, item.deliverySummary.length > 0 && item.deliverySummary.every((entry) => entry.status === 'PENDING') && item.deliveries.every((entry) => entry.status === 'PENDING' && entry.deliveredAt === null));
  report.finalStates = { owned: summary(owned), replacement: summary(replacement), held: summary(heldFinal), waiting: summary(waitingFinal) };
  report.result = 'PASS';
}
try {
  await run();
} catch (error) {
  report.result = 'FAIL';
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.mutationAttempted = mutationStarted;
  if (allowReportWrite) {
    await mkdir(dirname(REPORT), { recursive: true });
    await writeFile(REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'w' });
  }
  console.log(JSON.stringify({ result: report.result, checks: report.checks.length, calls: report.calls.length, mutationAttempted: mutationStarted, report: allowReportWrite ? REPORT : null, ...(report.error ? { error: report.error } : {}) }));
}
