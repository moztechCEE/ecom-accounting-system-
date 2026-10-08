// Loaded only by the isolated DEV runtime, before application imports.
// Database traffic uses the Cloud SQL Unix socket; external network effects and
// browser/subprocess automation are unavailable in this environment.
const net = require('node:net');
const childProcess = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const { syncBuiltinESMExports } = require('node:module');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

if (process.env.ERP_DEV_SANDBOX !== 'true' || !/^erp_dev_[a-z0-9_]+$/.test(process.env.DB_NAME || '') ||
    process.env.DB_USER !== 'erp_dev_runtime' || process.env.SEED_ON_STARTUP !== 'false' ||
    process.env.RUNTIME_SCHEDULES_ENABLED !== 'false') {
  throw new Error('DEV sandbox requires an isolated database/user and disabled startup effects');
}
function blocked() {
  const error = new Error('DEV 測試環境未啟用外部連線、發送或瀏覽器自動化');
  error.code = 'ERP_DEV_EXTERNAL_EFFECT_BLOCKED';
  throw error;
}
const stableWarehouseOrigin = 'https://corely-wms-dev-sp5g377smq-de.a.run.app';
// A candidate is reachable only when both independently configured bridges agree.
// Match the raw setting, not a normalized URL: credentials, ports, paths, alternate
// services and suffix lookalikes must never expand this DEV-only exception.
const candidateWarehouseOrigin = process.env.WMS_PORTAL_SERVICE_URL || '';
const candidateWarehouseEnabled = /^https:\/\/[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?---corely-wms-dev-sp5g377smq-de\.a\.run\.app$/.test(candidateWarehouseOrigin) &&
  [candidateWarehouseOrigin, candidateWarehouseOrigin + '/'].includes(process.env.WMS_WORKSPACE_URL);
const warehouseOrigin = candidateWarehouseEnabled ? candidateWarehouseOrigin : stableWarehouseOrigin;
const warehouseHost = new URL(warehouseOrigin).hostname;
const warehouseAccountEnabled = process.env.WMS_PORTAL_SSO_ENABLED === 'true' && process.env.WMS_PORTAL_SERVICE_URL === warehouseOrigin;
const warehouseWorkspaceEnabled = process.env.WMS_WORKSPACE_READ_ENABLED === 'true' &&
  [warehouseOrigin, warehouseOrigin + '/'].includes(process.env.WMS_WORKSPACE_URL);
const warehouseFetchContext = new AsyncLocalStorage();
const warehouseFetchToken = Symbol('approved-dev-warehouse-fetch');
function approvedWorkspaceFetch(url, options) {
  if (!warehouseWorkspaceEnabled || url.origin !== warehouseOrigin || url.username || url.password || url.hash ||
      (typeof options !== 'object' || !options) || options.redirect !== 'error') return false;
  const commandEnabled = process.env.WMS_WORKSPACE_COMMANDS_ENABLED === 'true';
  const workflowDetail = commandEnabled && options.method === 'GET' && !url.search &&
    /^\/api\/integrations\/erp\/workflow\/v1\/orders\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname);
  const read = options.method === 'GET' &&
    (/^\/api\/integrations\/erp\/v1\/orders(?:\/[A-Za-z0-9_-]{1,128})?$/.test(url.pathname) ||
     /^\/api\/integrations\/erp\/v1\/management\/(?:overview|logs|exceptions|scan-errors|defects)$/.test(url.pathname) ||
     workflowDetail);
  const command = commandEnabled && options.method === 'POST' &&
    /^\/api\/integrations\/erp\/workflow\/v1\/orders\/[A-Za-z0-9_-]{1,128}\/(?:dispatch|(?:pick|pack)\/(?:claim|scan))$/.test(url.pathname);
  if (!read && !command) return false;
  const keys = [...url.searchParams.keys()];
  if (command && keys.length || keys.length > 8 || new Set(keys).size !== keys.length ||
      keys.some(key => !['view','search','page','pageSize','days','status','pickPage','packPage'].includes(key) || url.searchParams.get(key).length > 256)) return false;
  const headers = new Headers(options.headers);
  if ([...headers.keys()].some(key => !['authorization','accept','content-type'].includes(key)) ||
      !/^Bearer [A-Za-z0-9_.-]{1,8192}$/.test(headers.get('authorization') || '') ||
      headers.get('accept') !== 'application/json') return false;
  return read ? options.body === undefined && !headers.has('content-type') :
    typeof options.body === 'string' && options.body.length <= 1048576 && headers.get('content-type') === 'application/json';
}
function approvedAccountFetch(url, options) {
  if (!warehouseAccountEnabled || url.origin !== warehouseOrigin || url.username || url.password || url.search || url.hash ||
      !['/api/auth/erp/staff','/api/auth/erp/bind'].includes(url.pathname) ||
      typeof options !== 'object' || !options || options.method !== 'POST' || options.redirect !== 'error' ||
      typeof options.body !== 'string' || options.body.length > 1048576) return false;
  const headers = new Headers(options.headers);
  return [...headers.keys()].every(key => ['content-type','x-erp-service-key'].includes(key)) &&
    headers.get('content-type') === 'application/json' && Boolean(process.env.WMS_PORTAL_SHARED_SECRET) &&
    headers.get('x-erp-service-key') === process.env.WMS_PORTAL_SHARED_SECRET;
}
// This exception is intentionally independent of every other DEV integration.
// Merely enabling the flag cannot open a socket: only a validated fetch gets the token.
const aiOrigin = 'https://generativelanguage.googleapis.com';
const aiHost = new URL(aiOrigin).hostname;
const aiEnabled = process.env.ERP_DEV_AI_ENABLED === 'true' && Boolean(process.env.GEMINI_API_KEY?.trim());
const aiPaths = new Set([
  '/v1beta/models/gemini-3.5-flash-lite:generateContent',
  '/v1beta/models/gemini-3.5-flash:generateContent',
  // Retain the reviewed legacy paths for older ERP AI entry points.
  '/v1beta/models/gemini-2.5-flash:generateContent',
  '/v1beta/models/gemini-2.5-pro:generateContent',
]);
const aiFetchContext = new AsyncLocalStorage();
const aiFetchToken = Symbol('approved-dev-ai-fetch');
// The mailroom DEV exception is restricted to the paired synthetic company.
// Event writes require a separate flag and the canonical isolated after-sales host.
const mailroomOrigin = process.env.ERP_DEV_MAILROOM_SOURCE_URL || '';
const mailroomEnabled = process.env.ERP_DEV_MAILROOM_SOURCE_ENABLED === 'true' &&
  process.env.MAILROOM_ENABLED === 'true' &&
  /^https:\/\/(?:[a-z][a-z0-9-]{0,61}---)?moztech-after-sales-dev-sp5g377smq-de\.a\.run\.app$/.test(mailroomOrigin);
const mailroomEventsEnabled = mailroomEnabled && process.env.ERP_DEV_MAILROOM_EVENTS_ENABLED === 'true' &&
  process.env.MAILROOM_SYNC_ENABLED === 'true' &&
  mailroomOrigin === 'https://moztech-after-sales-dev-sp5g377smq-de.a.run.app';
const mailroomHost = mailroomEnabled ? new URL(mailroomOrigin).hostname : '';
const mailroomFetchContext = new AsyncLocalStorage();
const mailroomFetchToken = Symbol('approved-dev-mailroom-source-fetch');
function approvedMailroomFetch(url, options) {
  if (!mailroomEnabled || url.origin !== mailroomOrigin || url.username || url.password || url.hash ||
      !options || options.redirect !== 'error') return false;
  const read = options.method === 'GET' && options.body === undefined &&
    (/^\/api\/integration\/mailroom\/cases(?:\/[A-Za-z0-9_-]{1,128})?$/.test(url.pathname) ||
     (!url.search && /^\/api\/integration\/mailroom\/cases\/[A-Za-z0-9_-]{1,128}\/attachments(?:\/[A-Za-z0-9_-]{1,128}\/media)?$/.test(url.pathname)));
  const changes = mailroomEnabled && options.method === 'GET' && options.body === undefined && url.pathname === '/api/integration/mailroom/changes';
  const event = mailroomEventsEnabled && options.method === 'POST' && !url.search &&
    url.pathname === '/api/integration/mailroom/events' && typeof options.body === 'string' &&
    Buffer.byteLength(options.body, 'utf8') < 40 * 1024;
  if (!read && !event && !changes) return false;
  if (event) {
    let payload;
    try { payload = JSON.parse(options.body); } catch { return false; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        payload.schema !== 'corely.mailroom.v1' || payload.entityId !== 'doa-dev-qa-20261002' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.eventId || '') ||
        payload.inventoryPosted !== false || payload.refundExecuted !== false) return false;
  }
  const keys = [...url.searchParams.keys()];
  if (changes) {
    if (keys.length > 2 || new Set(keys).size !== keys.length || keys.some(k => !['cursor','limit'].includes(k)) ||
      !/^(0|[1-9][0-9]{0,18})$/.test(url.searchParams.get('cursor') || '0') ||
      BigInt(url.searchParams.get('cursor') || '0') > 9223372036854775807n ||
      !/^[0-9]{1,3}$/.test(url.searchParams.get('limit') || '100') ||
      Number(url.searchParams.get('limit') || '100') < 1 || Number(url.searchParams.get('limit') || '100') > 100) return false;
  } else if (keys.length > 3 || new Set(keys).size !== keys.length ||
      keys.some(key => !['search', 'awaiting', 'cursor'].includes(key) || url.searchParams.get(key).length > 128) ||
      (url.searchParams.has('awaiting') && url.searchParams.get('awaiting') !== 'true') ||
      (url.pathname !== '/api/integration/mailroom/cases' && keys.length)) return false;
  const headers = new Headers(options.headers);
  const allowed = ['content-type', 'x-mailroom-key', 'x-mailroom-entity', 'x-mailroom-time', 'x-mailroom-signature'];
  if ([...headers.keys()].some(key => !allowed.includes(key)) || headers.get('content-type') !== 'application/json' ||
      headers.get('x-mailroom-entity') !== 'doa-dev-qa-20261002' ||
      !/^\d{10}$/.test(headers.get('x-mailroom-time') || '') ||
      Math.abs(Date.now() / 1000 - Number(headers.get('x-mailroom-time'))) > 60 ||
      !/^[a-f0-9]{64}$/.test(headers.get('x-mailroom-signature') || '')) return false;
  let entries;
  try { entries = JSON.parse(process.env.MAILROOM_CONNECTIONS || '[]'); } catch { return false; }
  const entry = Array.isArray(entries) && entries.find(value => value.entityId === headers.get('x-mailroom-entity') &&
    value.target === 'AFTER_SALES' && [mailroomOrigin, mailroomOrigin + '/'].includes(value.baseUrl) &&
    value.keyId === headers.get('x-mailroom-key') && typeof value.secret === 'string' && value.secret.length >= 32);
  if (!entry) return false;
  const signature = createHmac('sha256', entry.secret).update(['mailroom.v1', options.method, url.pathname + url.search,
    headers.get('x-mailroom-time'), entry.entityId, createHash('sha256').update(event ? options.body : '').digest('hex')].join('\n')).digest();
  return timingSafeEqual(signature, Buffer.from(headers.get('x-mailroom-signature'), 'hex'));
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node can pass normalized [options, callback] arguments to Socket.connect.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const path = typeof first === 'object' && first ? first.path : typeof first === 'string' ? first : '';
  const warehouseConnection = (warehouseAccountEnabled || warehouseWorkspaceEnabled) &&
    warehouseFetchContext.getStore() === warehouseFetchToken && typeof first === 'object' &&
    Number(first.port) === 443 && first.host === warehouseHost && (!first.servername || first.servername === warehouseHost);
  const aiConnection = aiEnabled && aiFetchContext.getStore() === aiFetchToken && typeof first === 'object' &&
    Number(first.port) === 443 && first.host === aiHost && (!first.servername || first.servername === aiHost);
  const mailroomConnection = mailroomEnabled && mailroomFetchContext.getStore() === mailroomFetchToken && typeof first === 'object' &&
    Number(first.port) === 443 && first.host === mailroomHost && (!first.servername || first.servername === mailroomHost);
  if (!warehouseConnection && !aiConnection && !mailroomConnection && (!path || !path.startsWith(`/cloudsql/${process.env.CLOUDSQL_INSTANCE}/.s.PGSQL.`))) blocked();
  return connect.apply(this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  // Snapshot the signed body and headers once before validation and forwarding.
  const mailroomOptions = { method: options.method, redirect: options.redirect, body: options.body,
    headers: new Headers(options.headers), signal: options.signal };
  if ((typeof input === 'string' || input instanceof URL) && approvedMailroomFetch(url, mailroomOptions)) {
    const headers = mailroomOptions.headers;
    return mailroomFetchContext.run(mailroomFetchToken, () => fetch(url.href, {
      method: mailroomOptions.method, redirect: 'error', signal: mailroomOptions.signal,
      headers: Object.fromEntries(['content-type', 'x-mailroom-key', 'x-mailroom-entity', 'x-mailroom-time', 'x-mailroom-signature']
        .map(key => [key, headers.get(key)])),
      ...(mailroomOptions.method === 'POST' ? { body: mailroomOptions.body } : {}),
    }));
  }
  if ((typeof input === 'string' || input instanceof URL) && approvedWorkspaceFetch(url, options)) {
    const headers = new Headers(options.headers);
    return warehouseFetchContext.run(warehouseFetchToken, () => fetch(url.href, {
      method: options.method, redirect: 'error', signal: options.signal,
      headers: { Authorization: headers.get('authorization'), Accept: 'application/json',
        ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(options.method === 'POST' ? { body: options.body } : {}),
    }));
  }
  if (aiEnabled && url.origin === aiOrigin && !url.username && !url.password && !url.search && !url.hash &&
      aiPaths.has(url.pathname) && (typeof input === 'string' || input instanceof URL) && options.method === 'POST' &&
      (options.redirect === undefined || options.redirect === 'error') && typeof options.body === 'string') {
    const headers = new Headers(options.headers);
    if (headers.get('x-goog-api-key') !== process.env.GEMINI_API_KEY || headers.get('content-type') !== 'application/json') blocked();
    // Rebuild options so callers cannot supply a custom dispatcher, Host header or redirect behavior.
    // Both the validated URL and headers are snapshots, not mutable Request objects.
    return aiFetchContext.run(aiFetchToken, () => fetch(url.href, {
      method: 'POST', redirect: 'error', signal: options.signal, body: options.body,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    }));
  }
  // The existing internal DEV account-link bridge remains the only other HTTP exception.
  // Shopify, email, production WMS, callbacks and subprocesses remain blocked.
  if (!(typeof input === 'string' || input instanceof URL) || !approvedAccountFetch(url, options)) blocked();
  return warehouseFetchContext.run(warehouseFetchToken, () => fetch(url.href, {
    method: 'POST', redirect: 'error', signal: options.signal, body: options.body,
    headers: { 'Content-Type': 'application/json', 'x-erp-service-key': process.env.WMS_PORTAL_SHARED_SECRET },
  }));
};
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = blocked;
syncBuiltinESMExports();
