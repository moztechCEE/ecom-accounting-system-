import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url), ts = require('typescript');
const module = { exports: {} };
const source = readFileSync(new URL('../src/pages/repair/repair-evidence-client.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('module', 'exports', 'require', code)(module, module.exports, specifier => {
  assert.equal(specifier, '../../services/api');
  return { API_URL: '/api/v1', default: { get() { throw Error('Unexpected default ERP read'); }, post() { throw Error('Unexpected default ERP write'); } } };
});
const { createRepairEvidenceClient, validateRepairUploadUrl, readRepairMediaAsset, readRepairPublicReport, repairReportTokenFromFragment } = module.exports;
const command = { entityId: 'synthetic-company', expectedVersion: 7, requestId: 'synthetic_upload_request' };
const uploadCommand = { ...command, kind: 'inspection', phase: 'BEFORE', checkKey: 'synthetic-check' };
const file = new Blob(['SYNTHETIC file bytes'], { type: 'image/png' });
const pending = () => ({ mediaId: 'synthetic-media', kind: 'inspection', documentRevision: 3, phase: 'BEFORE', checkKey: 'synthetic-check',
  status: 'PENDING', contentType: 'image/png', sha256: null, sizeBytes: null,
  uploadUrl: 'https://storage.googleapis.com/synthetic-bucket/object?X-Goog-Signature=synthetic',
  expiresAt: new Date(Date.now() + 60_000).toISOString() });
const finalized = () => ({ ...pending(), status: 'FINALIZED', sha256: 'a'.repeat(64), sizeBytes: file.size });
const publicReport = () => ({ reportId: 'synthetic-report', productName: '合成產品', caseNumber: 'SYNTHETIC-CASE',
  findings: 'Recorded actual fault', handling: 'Recorded actual work', verification: 'Recorded actual test',
  media: [{ mediaId: 'synthetic-media', contentType: 'image/png' }] });
const absent = async () => { throw Error('Unexpected dependency call'); };

function uploadHarness(intent = pending(), final = finalized(), response = new Response(null, { status: 200 })) {
  const posts = [], puts = [];
  const client = createRepairEvidenceClient({
    erp: { get: absent, async post(path, body) {
      posts.push({ path, body });
      return { data: path.endsWith('/media/uploads') ? intent : { asset: final } };
    } },
    async fetch(url, init) { puts.push({ url, init }); return response; },
    randomUUID: () => 'synthetic_finalize_request',
  });
  return { client, posts, puts };
}

test('signed upload uses only native PUT without ERP credentials; only finalized same-version metadata becomes a ref', async () => {
  const { client, posts, puts } = uploadHarness();
  const result = await client.uploadMedia('synthetic-item', { ...uploadCommand, authorization: true }, file, { expectedDocumentRevision: 3 });
  assert.deepEqual(result.mediaRef, { mediaId: 'synthetic-media', phase: 'BEFORE', checkKey: 'synthetic-check' });
  assert.equal(result.asset.status, 'FINALIZED');
  assert.equal('uploadUrl' in result.asset, false);
  assert.deepEqual(posts, [
    { path: '/repair-workbench/items/synthetic-item/media/uploads', body: { ...uploadCommand, contentType: 'image/png' } },
    { path: '/repair-workbench/items/synthetic-item/media/synthetic-media/finalize', body: { ...command, requestId: 'synthetic_finalize_request' } },
  ]);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].url, pending().uploadUrl);
  assert.equal(puts[0].init.method, 'PUT');
  assert.equal(puts[0].init.credentials, 'omit');
  assert.equal(puts[0].init.redirect, 'error');
  assert.equal(puts[0].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(puts[0].init.headers, { 'Content-Type': 'image/png' });
  assert.equal(puts[0].init.body, file);
});

test('a valid already-finalized intent replay returns its original ref without uploading or finalizing again', async () => {
  const replay = finalized(); delete replay.uploadUrl; delete replay.expiresAt;
  const { client, posts, puts } = uploadHarness(replay);
  assert.equal((await client.uploadMedia('synthetic-item', uploadCommand, file)).asset.status, 'FINALIZED');
  assert.equal(posts.length, 1); assert.equal(puts.length, 0);
});

test('storage URL permits exact HTTPS GCS including 443 but rejects authority tricks and redirects before a PUT', async () => {
  assert.equal(validateRepairUploadUrl('https://storage.googleapis.com:443/bucket/object'), 'https://storage.googleapis.com/bucket/object');
  for (const url of ['http://storage.googleapis.com/bucket/object', 'https://storage.googleapis.com:444/bucket/object',
    'https://user:password@storage.googleapis.com/bucket/object', 'https://storage.googleapis.com.evil.invalid/object',
    'https://evil.invalid/storage.googleapis.com/object', '//storage.googleapis.com/object',
    'https://storage.googleapis.com/object#hidden', ' https://storage.googleapis.com/object']) {
    assert.throws(() => validateRepairUploadUrl(url), /上傳連結無效/);
    const { client, posts, puts } = uploadHarness({ ...pending(), uploadUrl: url });
    await assert.rejects(client.uploadMedia('synthetic-item', uploadCommand, file), /上傳連結無效/);
    assert.equal(posts.length, 1); assert.equal(puts.length, 0);
  }
});

test('missing, expired, revoked or mismatched producer responses never become successful uploads', async () => {
  for (const intent of [undefined, {}, { ...pending(), status: 'UNKNOWN' }, { ...pending(), status: ['PENDING'] },
    { ...pending(), status: 'REVOKED' }, { ...pending(), uploadUrl: undefined }, { ...pending(), expiresAt: '2000-01-01T00:00:00Z' },
    { ...pending(), kind: 'repair' }, { ...pending(), phase: 'AFTER' }, { ...pending(), checkKey: 'different' },
    { ...pending(), documentRevision: 2 }, { ...pending(), contentType: 'video/mp4' }]) {
    const harness = uploadHarness(intent);
    // uploadHarness's default argument deliberately requires explicit undefined here.
    if (intent === undefined) harness.client = createRepairEvidenceClient({ erp: { get: absent, post: async () => ({ data: undefined }) }, fetch: absent });
    await assert.rejects(harness.client.uploadMedia('synthetic-item', uploadCommand, file, { expectedDocumentRevision: 3 }));
    assert.equal(harness.puts.length, 0);
  }
});

test('failed or redirected storage requests cannot call finalize or disclose their signed URL in an error', async () => {
  const failed = uploadHarness(pending(), finalized(), new Response(null, { status: 403 }));
  await assert.rejects(failed.client.uploadMedia('synthetic-item', uploadCommand, file), /影像上傳失敗/);
  assert.equal(failed.posts.length, 1);
  const posts = [];
  const client = createRepairEvidenceClient({ erp: { get: absent, post: async (path, body) => { posts.push({ path, body }); return { data: pending() }; } },
    fetch: async () => { throw Error('Signed URL with secret signature'); } });
  await assert.rejects(client.uploadMedia('synthetic-item', uploadCommand, file), error => error.message === '影像上傳失敗，請重試');
  assert.equal(posts.length, 1);
});

test('finalize must supply a complete FINALIZED receipt for this exact intent', async () => {
  for (const final of [{ ...finalized(), status: 'PENDING', sha256: null, sizeBytes: null }, { ...finalized(), status: 'REVOKED' },
    { ...finalized(), sha256: ['a'.repeat(64)] }, { ...finalized(), sizeBytes: 0 },
    { ...finalized(), mediaId: 'foreign-media' }, { ...finalized(), kind: 'repair' },
    { ...finalized(), documentRevision: 4 }, { ...finalized(), phase: 'AFTER' }, { ...finalized(), checkKey: 'foreign-check' },
    { ...finalized(), contentType: 'video/mp4' }]) {
    const { client, posts, puts } = uploadHarness(pending(), final);
    await assert.rejects(client.uploadMedia('synthetic-item', uploadCommand, file));
    assert.equal(puts.length, 1); assert.equal(posts.length, 2);
  }
  assert.throws(() => readRepairMediaAsset({ ...finalized(), status: ['FINALIZED'] }));
});

test('ERP errors remain real errors; invalid primitive commands cannot send a mutation', async () => {
  const backendFailure = { response: { status: 503, data: { message: '檢修存證服務尚未就緒' } } };
  const client = createRepairEvidenceClient({ erp: { get: absent, post: async () => { throw backendFailure; } }, fetch: absent });
  await assert.rejects(client.uploadMedia('synthetic-item', uploadCommand, file), error => error === backendFailure);
  for (const change of [{ expectedVersion: '7' }, { expectedVersion: 0 }, { requestId: 'short' }, { kind: 'other' }, { phase: 'other' }, { checkKey: '' }]) {
    const harness = uploadHarness();
    await assert.rejects(harness.client.uploadMedia('synthetic-item', { ...uploadCommand, ...change }, file));
    assert.equal(harness.posts.length, 0); assert.equal(harness.puts.length, 0);
  }
});

test('staff media reads and revoke stay within the authenticated scoped ERP client', async () => {
  const calls = [];
  const client = createRepairEvidenceClient({ erp: {
    async get(path, options) { calls.push({ path, options }); return { data: options?.responseType === 'blob' ? file : { items: [finalized()] } }; },
    async post(path, body) { calls.push({ path, body }); return { data: { mediaId: 'synthetic-media' } }; },
  }, fetch: absent });
  assert.equal((await client.listMedia('item/segment', 'synthetic-company'))[0].status, 'FINALIZED');
  assert.equal(await client.getMediaFile('item/segment', 'synthetic-media', 'synthetic-company'), file);
  assert.deepEqual(await client.revokeMedia('item/segment', 'synthetic-media', command), { mediaId: 'synthetic-media' });
  assert.equal(calls[0].path, '/repair-workbench/items/item%2Fsegment/media');
  assert.deepEqual(calls[1].options, { params: { entityId: 'synthetic-company' }, responseType: 'blob' });
  assert.equal(calls[2].path, '/repair-workbench/items/item%2Fsegment/media/synthetic-media/revoke');
});

test('report publishing sends only a saved-document command and accepts a fragment-token share receipt', async () => {
  const calls = [], link = '/repair-report/synthetic-report#token=SYNTHETIC_TOKEN';
  const client = createRepairEvidenceClient({ erp: { get: absent, async post(path, body) { calls.push({ path, body }); return { data: { reportId: 'synthetic-report', shareLink: link } }; } }, fetch: absent });
  assert.deepEqual(await client.publishReport('synthetic-item', { ...command, kind: 'inspection', expiresInDays: 7, published: true }),
    { reportId: 'synthetic-report', shareLink: link });
  assert.deepEqual(calls, [{ path: '/repair-workbench/items/synthetic-item/reports/publish', body: { ...command, kind: 'inspection', expiresInDays: 7 } }]);
  for (const expiresInDays of [0, 31, '7', 1.5]) await assert.rejects(client.publishReport('synthetic-item', { ...command, kind: 'inspection', expiresInDays }));
  assert.equal(calls.length, 1);
  const bad = createRepairEvidenceClient({ erp: { get: absent, post: async () => ({ data: { reportId: 'synthetic-report', shareLink: '/repair-report/synthetic-report?token=SECRET#token=SYNTHETIC_TOKEN' } }) }, fetch: absent });
  await assert.rejects(bad.publishReport('synthetic-item', { ...command, kind: 'repair', expiresInDays: 1 }), /發布連結無效/);
});

test('staff report summaries and revocation receipts preserve real dates, versions and replay state', async () => {
  const row = { reportId: 'synthetic-report', status: 'PUBLISHED', publishedAt: '2026-10-13T00:00:00.000Z',
    expiresAt: '2026-10-20T00:00:00.000Z', inspectionRevision: 3, reportRevision: null };
  const calls = [];
  const client = createRepairEvidenceClient({ erp: {
    async get(path, options) { calls.push({ path, options }); return { data: { items: [{ ...row, tokenHash: 'PRIVATE' }] } }; },
    async post(path, body) { calls.push({ path, body }); return { data: { reportId: 'synthetic-report', duplicate: true } }; },
  }, fetch: absent });
  assert.deepEqual(await client.listReports('synthetic-item', 'synthetic-company'), [row]);
  assert.deepEqual(await client.revokeReport('synthetic-item', 'synthetic-report', command), { reportId: 'synthetic-report', duplicate: true });
  assert.equal(calls[0].path, '/repair-workbench/items/synthetic-item/reports');
  assert.deepEqual(calls[0].options, { params: { entityId: 'synthetic-company' } });
  assert.equal(calls[1].path, '/repair-workbench/items/synthetic-item/reports/synthetic-report/revoke');
  assert.deepEqual(calls[1].body, command);
  for (const patch of [{ status: 'DRAFT' }, { publishedAt: '2026-02-30T00:00:00.000Z' }, { expiresAt: undefined },
    { inspectionRevision: '3' }, { reportRevision: 0 }]) {
    const malformed = createRepairEvidenceClient({ erp: { get: async () => ({ data: { items: [{ ...row, ...patch }] } }), post: absent }, fetch: absent });
    await assert.rejects(malformed.listReports('synthetic-item', 'synthetic-company'));
  }
  const mismatch = createRepairEvidenceClient({ erp: { get: absent, post: async () => ({ data: { reportId: 'foreign-report' } }) }, fetch: absent });
  await assert.rejects(mismatch.revokeReport('synthetic-item', 'synthetic-report', command));
});

test('public report reads use a fragment token header without ERP bearer, cookies or query-token transport', async () => {
  const calls = [];
  const raw = { ...publicReport(), estimateAmount: 9999, csr: { note: 'PRIVATE' },
    media: [{ mediaId: 'synthetic-media', contentType: 'image/png', internalUrl: 'PRIVATE' }] };
  const client = createRepairEvidenceClient({ erp: { get: absent, post: absent }, publicApiUrl: '/api/v1',
    async fetch(url, init) { calls.push({ url, init }); return new Response(JSON.stringify(raw), { status: 200, headers: { 'Content-Type': 'application/json' } }); } });
  assert.deepEqual(await client.readPublicReportFromFragment('synthetic-report', '#token=SYNTHETIC_TOKEN'), publicReport());
  assert.equal(calls[0].url, '/api/v1/public/repair-reports/synthetic-report');
  assert.deepEqual(calls[0].init.headers, { 'X-Repair-Report-Token': 'SYNTHETIC_TOKEN' });
  assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].url.includes('token'), false);
});

test('public token and customer DTO validation fail closed without inventing missing report text', async () => {
  assert.equal(repairReportTokenFromFragment('#token=SYNTHETIC_TOKEN'), 'SYNTHETIC_TOKEN');
  for (const fragment of ['', '?token=SECRET', '#token=', '#token=ONE&token=TWO', '#token=BAD%0AHEADER', '#token=BAD+SPACE'])
    assert.throws(() => repairReportTokenFromFragment(fragment));
  for (const raw of [undefined, { ...publicReport(), reportId: 'foreign-report' }, { ...publicReport(), findings: undefined },
    { ...publicReport(), verification: false }, { ...publicReport(), media: [{ mediaId: 'synthetic-media', contentType: 'text/html' }] },
    { ...publicReport(), media: [publicReport().media[0], publicReport().media[0]] }])
    assert.throws(() => readRepairPublicReport(raw, 'synthetic-report'));
  const client = createRepairEvidenceClient({ erp: { get: absent, post: absent }, fetch: absent });
  await assert.rejects(client.readPublicReportFromFragment('synthetic-report', '?token=SECRET'));
});

test('public media uses the same isolated token transport; revoked, fake binary and unavailable reports stay unreadable', async () => {
  const calls = [];
  const client = createRepairEvidenceClient({ erp: { get: absent, post: absent }, async fetch(url, init) {
    calls.push({ url, init }); return new Response(file, { status: 200, headers: { 'Content-Type': 'image/png' } });
  } });
  const blob = await client.loadPublicMediaFromFragment('synthetic-report', 'media/segment', '#token=SYNTHETIC_TOKEN');
  assert.equal(blob.type, 'image/png');
  assert.equal(calls[0].url, '/api/v1/public/repair-reports/synthetic-report/media/media%2Fsegment');
  assert.deepEqual(calls[0].init.headers, { 'X-Repair-Report-Token': 'SYNTHETIC_TOKEN' });
  assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.redirect, 'error');
  for (const response of [new Response(null, { status: 410 }), new Response('fake media', { status: 200, headers: { 'Content-Type': 'application/json' } })]) {
    const rejected = createRepairEvidenceClient({ erp: { get: absent, post: absent }, fetch: async () => response });
    await assert.rejects(rejected.loadPublicMediaFromFragment('synthetic-report', 'synthetic-media', '#token=SYNTHETIC_TOKEN'));
  }
  const gone = createRepairEvidenceClient({ erp: { get: absent, post: absent }, fetch: async () => new Response(null, { status: 404 }) });
  await assert.rejects(gone.readPublicReportFromFragment('synthetic-report', '#token=SYNTHETIC_TOKEN'), /連結已失效/);
});
