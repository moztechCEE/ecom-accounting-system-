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
// Native WMS retains upstream actor/role authorization. No login, account
// binding, integrations, callback, maintenance or arbitrary host proxy exists.
function approvedNativeWarehouseFetch(url, options) {
  if (process.env.WMS_NATIVE_ENABLED !== 'true' || !warehouseAccountEnabled ||
      url.origin !== warehouseOrigin || url.username || url.password || url.hash ||
      !options || options.redirect !== 'error') return false;
  const headers = new Headers(options.headers);
  const bearer = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test((headers.get('authorization') || '').replace(/^Bearer /, '')) &&
    (headers.get('authorization') || '').startsWith('Bearer ') && (headers.get('authorization') || '').length <= 8200;
  const exchange = options.method === 'POST' && url.pathname === '/api/auth/erp/exchange' && !url.search;
  if (exchange) {
    if ([...headers.keys()].some(key => !['accept','content-type'].includes(key)) ||
        headers.get('content-type') !== 'application/json' || typeof options.body !== 'string' || options.body.length > 1024) return false;
    let input; try { input = JSON.parse(options.body); } catch { return false; }
    return input && Object.keys(input).length === 2 && /^[a-f0-9]{64}$/.test(input.ticket || '') && /^[a-f0-9]{64}$/.test(input.nonce || '');
  }
  const file = options.method === 'GET' && !url.search && /^\/api\/marketplace-files\/[1-9]\d{0,9}\/(?:ecount|ecount-grouped|prepick)$/.test(url.pathname);
  if (file) return options.body === undefined && [...headers.keys()].every(key => ['cookie','accept'].includes(key)) &&
    /^wms_marketplace_download=[A-Za-z0-9_.-]{1,8192}$/.test(headers.get('cookie') || '');
  if (!bearer || [...headers.keys()].some(key => !['authorization','accept','content-type','if-none-match'].includes(key))) return false;
  const inspection = options.method === 'GET' && url.pathname === '/api/auth/me' && !url.search;
  const businessPath = /^\/api\/(?:cartons|orders|tasks|comments|order-import-batches|order-reviews|order-change-notices|marketplace-products|marketplace-intakes|marketplace-batch-notices|warehouse-intakes|logistics|admin|analytics|reports|scan-errors|operation-logs|team)(?:\/[A-Za-z0-9_.,:@-]+)*\/?$/;
  const protectedSegment = /(?:^|\/)(?:auth|integrations?|callbacks?|hooks?|webhooks?|migrations?|seeds?|bootstrap|maintenance|retention|internal|health|ready|readiness|staff|bind|exchange)(?:\/|$)/i;
  const business = (businessPath.test(url.pathname) || url.pathname === '/api/users/basic') &&
    !protectedSegment.test(url.pathname) && !url.pathname.includes('//') &&
    !url.pathname.split('/').some(part => part === '.' || part === '..');
  if (!inspection && !business || !['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(options.method) || url.href.length > 8192) return false;
  if (['GET','HEAD'].includes(options.method)) return options.body === undefined && !headers.has('content-type');
  if (options.body === undefined) return !headers.has('content-type');
  const bodyBytes = typeof options.body === 'string' ? Buffer.byteLength(options.body, 'utf8') :
    options.body instanceof Uint8Array ? options.body.byteLength : Infinity;
  return bodyBytes <= 30 * 1024 * 1024 && /^(?:application\/json|application\/x-www-form-urlencoded|multipart\/form-data)(?:\s*;[^\r\n]*)?$/i.test(headers.get('content-type') || '');
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
     (!url.search && url.pathname === '/api/integration/mailroom/summary' && url.href === mailroomOrigin + url.pathname) ||
     (!url.search && /^\/api\/integration\/mailroom\/cases\/[A-Za-z0-9_-]{1,128}\/attachments(?:\/[A-Za-z0-9_-]{1,128}\/media)?$/.test(url.pathname)));
  const changes = mailroomEnabled && options.method === 'GET' && options.body === undefined && url.pathname === '/api/integration/mailroom/changes';
  const outbound = options.method === 'GET' && options.body === undefined && url.pathname === '/api/integration/mailroom/outbound-orders';
  const identity = options.method === 'GET' && options.body === undefined && !url.search && /^\/api\/integration\/mailroom\/cases\/[A-Za-z0-9_-]{1,128}\/customer-identity$/.test(url.pathname);
  const workflow = mailroomEventsEnabled && options.method === 'POST' && !url.search && url.pathname === '/api/integration/mailroom/workflow-events';
  const event = mailroomEventsEnabled && options.method === 'POST' && !url.search &&
    (url.pathname === '/api/integration/mailroom/events' || workflow) && typeof options.body === 'string' &&
    Buffer.byteLength(options.body, 'utf8') <= 65536;
  if (!read && !event && !changes && !outbound && !identity) return false;
  if (event) {
    let payload;
    try { payload = JSON.parse(options.body); } catch { return false; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        payload.entityId !== 'doa-dev-qa-20261002' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.eventId || '')) return false;
    if (workflow ? payload.schema !== 'corely.aftersales.workflow.v1' || !['REPAIR_PROPOSAL','EXCHANGE_READY'].includes(payload.kind) :
        !['corely.mailroom.v1', 'corely.mailroom.dispatch.v1'].includes(payload.schema)) return false;
    if (payload.schema === 'corely.mailroom.v1' && (payload.inventoryPosted !== false || payload.refundExecuted !== false)) return false;
  }
  const keys = [...url.searchParams.keys()];
  if (changes) {
    if (keys.length > 2 || new Set(keys).size !== keys.length || keys.some(k => !['cursor','limit'].includes(k)) ||
      !/^(0|[1-9][0-9]{0,18})$/.test(url.searchParams.get('cursor') || '0') ||
      BigInt(url.searchParams.get('cursor') || '0') > 9223372036854775807n ||
      !/^[0-9]{1,3}$/.test(url.searchParams.get('limit') || '100') ||
      Number(url.searchParams.get('limit') || '100') < 1 || Number(url.searchParams.get('limit') || '100') > 100) return false;
  } else if (outbound) {
    if (keys.length > 3 || new Set(keys).size !== keys.length || keys.some(k => !['search','caseId','cursor'].includes(k) || url.searchParams.get(k).length > 128) || (url.searchParams.has('caseId') && url.searchParams.has('cursor'))) return false;
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
// Native case registration/read is separate from physical mailroom events and
// cannot authorize provider, refund, invoice or technician mutation endpoints.
const nativeAfterSalesBase = process.env.AFTER_SALES_TASK_SOURCE_URL || 'https://corely-aftersales-module-dev-sp5g377smq-de.a.run.app/after-sales-app';
const nativeAfterSalesBaseValid = /^https:\/\/(?:[a-z][a-z0-9-]{0,61}---)?corely-aftersales-module-dev-sp5g377smq-de\.a\.run\.app\/after-sales-app$/.test(nativeAfterSalesBase);
const nativeAfterSalesOrigin = nativeAfterSalesBaseValid ? new URL(nativeAfterSalesBase).origin : 'https://corely-aftersales-module-dev-sp5g377smq-de.a.run.app';
const nativeAfterSalesHost = new URL(nativeAfterSalesOrigin).hostname;
const nativeAfterSalesContext = new AsyncLocalStorage();
const nativeAfterSalesToken = Symbol('approved-dev-native-after-sales-fetch');
const nativeAfterSalesEnabled = nativeAfterSalesBaseValid && process.env.AFTER_SALES_MODULE_ENABLED === 'true' &&
  process.env.AFTER_SALES_MODULE_ENTITY_ID === 'doa-dev-qa-20261002' &&
  typeof process.env.AFTER_SALES_MODULE_SECRET === 'string' && process.env.AFTER_SALES_MODULE_SECRET.length >= 32;
function approvedNativeAfterSalesFetch(url, options) {
  if (!nativeAfterSalesEnabled || url.origin !== nativeAfterSalesOrigin || url.username || url.password || url.hash ||
      !options || options.redirect !== 'error') return false;
  const prefix = '/after-sales-app/api/integration/erp/workbench';
  const list = options.method === 'GET' && options.body === undefined && url.pathname === prefix + '/cases';
  const detail = options.method === 'GET' && options.body === undefined && !url.search &&
    new RegExp('^' + prefix + '/cases/[A-Za-z0-9_-]{1,128}$').test(url.pathname);
  const products = options.method === 'GET' && options.body === undefined && url.pathname === prefix + '/options';
  const create = options.method === 'POST' && !url.search && url.pathname === prefix + '/cases' &&
    typeof options.body === 'string' && Buffer.byteLength(options.body, 'utf8') <= 65536;
  const workflowEnabled = process.env.ERP_DEV_AFTER_SALES_WORKFLOW_ENABLED === 'true';
  const command = workflowEnabled && options.method === 'POST' && !url.search &&
    (new RegExp('^' + prefix + '/cases/[A-Za-z0-9_-]{1,128}/(?:communications|repair-proposals/adopt|factory-actions|brand-review)$').test(url.pathname) ||
     new RegExp('^' + prefix + '/applications(?:/[a-f0-9-]{36})?$').test(url.pathname)) &&
    typeof options.body === 'string' && Buffer.byteLength(options.body, 'utf8') <= 1048576;
  const shared = options.method === 'GET' && options.body === undefined &&
    [prefix + '/audit-logs', prefix + '/integration-status', prefix + '/applications'].includes(url.pathname);
  const protectedRead = workflowEnabled && options.method === 'GET' && options.body === undefined && !url.search &&
    (new RegExp('^' + prefix + '/cases/[A-Za-z0-9_-]{1,128}/communications/[A-Za-z0-9_-]{1,128}/photos/[0-3]$').test(url.pathname) ||
     new RegExp('^' + prefix + '/applications/[a-f0-9-]{36}(?:/photos/[0-3])?$').test(url.pathname));
  if (!list && !detail && !products && !create && !command && !shared && !protectedRead) return false;
  const keys = [...url.searchParams.keys()];
  const allowedQuery = products ? ['search'] : url.pathname === prefix + '/audit-logs' ? ['cursor','limit','from','to','caseId','brand','actorId','actionId'] :
    url.pathname === prefix + '/applications' ? ['status','cursor'] : url.pathname === prefix + '/integration-status' ? [] :
    ['scope', 'lifecycle', 'type', 'stage', 'brand', 'search', 'page', 'pageSize', 'erpMineCaseIds'];
  if (keys.length > allowedQuery.length || new Set(keys).size !== keys.length || keys.some(k => !allowedQuery.includes(k) ||
      url.searchParams.get(k).length > (k === 'erpMineCaseIds' ? 13200 : 120))) return false;
  if (url.searchParams.has('erpMineCaseIds')) {
    let ids; try { ids = JSON.parse(url.searchParams.get('erpMineCaseIds')); } catch { return false; }
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) return false;
  }
  if (create) {
    let value; try { value = JSON.parse(options.body); } catch { return false; }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(k => !['requestId', 'brand', 'customerKind', 'payload', 'verifiedApplicationRef'].includes(k)) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId || '') ||
        !['MOZTECH', 'BONSON', 'MORITEK', 'OTHER'].includes(value.brand) || !['TO_C', 'TO_B'].includes(value.customerKind) ||
        !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload) ||
        !['RESHIPMENT', 'PRIVATE_PURCHASE', 'REPAIR', 'EXCHANGE_RETURN', 'REFUND_PICKUP', 'CUSTOMER_ISSUE'].includes(value.payload.type)) return false;
  }
  const headers = new Headers(options.headers);
  const allowed = ['content-type', 'x-erp-time', 'x-erp-entity', 'x-erp-actor', 'x-erp-signature'];
  if ([...headers.keys()].some(k => !allowed.includes(k)) ||
      (headers.has('content-type') && headers.get('content-type') !== 'application/json') ||
      ((create || command) && headers.get('content-type') !== 'application/json') || headers.get('x-erp-entity') !== 'doa-dev-qa-20261002' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(headers.get('x-erp-actor') || '') ||
      !/^\d{10}$/.test(headers.get('x-erp-time') || '') || Math.abs(Date.now() / 1000 - Number(headers.get('x-erp-time'))) > 60 ||
      !/^[a-f0-9]{64}$/.test(headers.get('x-erp-signature') || '')) return false;
  const expected = createHmac('sha256', process.env.AFTER_SALES_MODULE_SECRET).update(['erp.aftersales.v1', options.method,
    url.pathname.slice('/after-sales-app'.length) + url.search, headers.get('x-erp-time'), headers.get('x-erp-entity'), headers.get('x-erp-actor'),
    createHash('sha256').update(create || command ? options.body : '').digest('hex')].join('\n')).digest();
  return timingSafeEqual(expected, Buffer.from(headers.get('x-erp-signature'), 'hex'));
}
// Private repair-media SDK calls get an isolated context. Enabling this does
// not authorize arbitrary URLs, other buckets, or direct sockets outside it.
const repairStorageContext = new AsyncLocalStorage();
const repairBucket = 'corely-repair-dev-249593319772';
const repairStorageEnabled = process.env.REPAIR_MEDIA_ENABLED === 'true' && process.env.REPAIR_MEDIA_BUCKET === repairBucket;
const repairStorageKey = /^repair-media\/doa-dev-qa-20261002\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;
globalThis[Symbol.for('corely.dev.repair-storage.v1')] = async (bucket, key, operation) => {
  if (!repairStorageEnabled || bucket !== repairBucket || !repairStorageKey.test(key) || typeof operation !== 'function') blocked();
  return repairStorageContext.run({ bucket, key }, operation);
};
function approvedRepairStorageFetch(url, method) {
  const ctx = repairStorageContext.getStore();
  if (!repairStorageEnabled || !ctx || url.username || url.password || url.hash) return false;
  if (url.protocol === 'http:' && ['metadata.google.internal','metadata.google.internal.','169.254.169.254'].includes(url.hostname) && !url.port) {
    const keys = [...url.searchParams.keys()];
    if (keys.length && (keys.length !== 1 || keys[0] !== 'scopes' || url.pathname !== '/computeMetadata/v1/instance/service-accounts/default/token'
      || url.searchParams.get('scopes').split(',').some(scope => !['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/devstorage.full_control','https://www.googleapis.com/auth/devstorage.read_write','https://www.googleapis.com/auth/devstorage.read_only'].includes(scope)))) return false;
    return method === 'GET' && ['/computeMetadata/v1','/computeMetadata/v1/','/computeMetadata/v1/instance/service-accounts/default/token','/computeMetadata/v1/instance/service-accounts/default/email','/computeMetadata/v1/project/project-id','/computeMetadata/v1/universe/universe-domain'].includes(url.pathname);
  }
  if (url.origin !== 'https://storage.googleapis.com') return false;
  const object = '/storage/v1/b/' + ctx.bucket + '/o/' + encodeURIComponent(ctx.key);
  if (url.pathname === object) return ['GET','HEAD'].includes(method);
  return method === 'POST' && url.pathname === '/upload/storage/v1/b/' + ctx.bucket + '/o'
    && url.searchParams.get('name') === ctx.key && url.searchParams.get('uploadType') === 'resumable'
    && url.searchParams.get('ifGenerationMatch') === '0';
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
  const nativeAfterSalesConnection = nativeAfterSalesEnabled && nativeAfterSalesContext.getStore() === nativeAfterSalesToken && typeof first === 'object' &&
    Number(first.port) === 443 && first.host === nativeAfterSalesHost && (!first.servername || first.servername === nativeAfterSalesHost);
  const repairConnection = repairStorageEnabled && repairStorageContext.getStore() && typeof first === 'object' &&
    ((Number(first.port) === 443 && first.host === 'storage.googleapis.com' && (!first.servername || first.servername === first.host)) ||
     (Number(first.port) === 80 && ['metadata.google.internal','metadata.google.internal.','169.254.169.254'].includes(first.host)));
  if (!warehouseConnection && !aiConnection && !mailroomConnection && !nativeAfterSalesConnection && !repairConnection && (!path || !path.startsWith(`/cloudsql/${process.env.CLOUDSQL_INSTANCE}/.s.PGSQL.`))) blocked();
  return connect.apply(this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (approvedRepairStorageFetch(url, options.method || input.method || 'GET'))
    return fetch(input, { ...options, redirect: 'error' });
  // Snapshot the signed body and headers once before validation and forwarding.
  const mailroomOptions = { method: options.method, redirect: options.redirect, body: options.body,
    headers: new Headers(options.headers), signal: options.signal };
  if ((typeof input === 'string' || input instanceof URL) && approvedNativeAfterSalesFetch(url, mailroomOptions)) {
    const headers = Object.fromEntries([...mailroomOptions.headers]);
    return nativeAfterSalesContext.run(nativeAfterSalesToken, () => fetch(url.href, {
      method: mailroomOptions.method, redirect: 'error', signal: mailroomOptions.signal, headers,
      ...(mailroomOptions.method === 'POST' ? { body: mailroomOptions.body } : {}),
    }));
  }
  if ((typeof input === 'string' || input instanceof URL) && approvedMailroomFetch(url, mailroomOptions)) {
    const headers = mailroomOptions.headers;
    return mailroomFetchContext.run(mailroomFetchToken, () => fetch(url.href, {
      method: mailroomOptions.method, redirect: 'error', signal: mailroomOptions.signal,
      headers: Object.fromEntries(['content-type', 'x-mailroom-key', 'x-mailroom-entity', 'x-mailroom-time', 'x-mailroom-signature']
        .map(key => [key, headers.get(key)])),
      ...(mailroomOptions.method === 'POST' ? { body: mailroomOptions.body } : {}),
    }));
  }
  if ((typeof input === 'string' || input instanceof URL) && approvedNativeWarehouseFetch(url, options)) {
    const headers = new Headers(options.headers);
    return warehouseFetchContext.run(warehouseFetchToken, () => fetch(url.href, {
      method: options.method, redirect: 'error', signal: options.signal,
      headers: Object.fromEntries(['authorization','accept','content-type','if-none-match','cookie']
        .filter(key => headers.has(key)).map(key => [key, headers.get(key)])),
      ...(options.body === undefined ? {} : { body: options.body }),
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
