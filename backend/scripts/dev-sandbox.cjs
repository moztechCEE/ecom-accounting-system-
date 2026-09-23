// Loaded only by the isolated DEV runtime, before application imports.
// Database traffic uses the Cloud SQL Unix socket; external network effects and
// browser/subprocess automation are unavailable in this environment.
const net = require('node:net');
const childProcess = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const { syncBuiltinESMExports } = require('node:module');

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
const warehouseOrigin = 'https://corely-wms-dev-sp5g377smq-de.a.run.app';
const warehouseHost = new URL(warehouseOrigin).hostname;
const warehouseEnabled = process.env.WMS_PORTAL_SSO_ENABLED === 'true' && process.env.WMS_PORTAL_SERVICE_URL === warehouseOrigin;
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
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node can pass normalized [options, callback] arguments to Socket.connect.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const path = typeof first === 'object' && first ? first.path : typeof first === 'string' ? first : '';
  const warehouseConnection = warehouseEnabled && typeof first === 'object' &&
    Number(first.port) === 443 && (first.host === warehouseHost || first.servername === warehouseHost);
  const aiConnection = aiEnabled && aiFetchContext.getStore() === aiFetchToken && typeof first === 'object' &&
    Number(first.port) === 443 && first.host === aiHost && (!first.servername || first.servername === aiHost);
  if (!warehouseConnection && !aiConnection && (!path || !path.startsWith(`/cloudsql/${process.env.CLOUDSQL_INSTANCE}/.s.PGSQL.`))) blocked();
  return connect.apply(this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
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
  if (!warehouseEnabled || url.origin !== warehouseOrigin || url.username || url.password || url.search || url.hash ||
      !['/api/auth/erp/staff','/api/auth/erp/bind'].includes(url.pathname) || options.method !== 'POST' || options.redirect !== 'error') blocked();
  return fetch(input, options);
};
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = blocked;
syncBuiltinESMExports();
