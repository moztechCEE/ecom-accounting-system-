// Loaded only by the isolated DEV runtime, before application imports.
// Database traffic uses the Cloud SQL Unix socket; external network effects and
// browser/subprocess automation are unavailable in this environment.
const net = require('node:net');
const childProcess = require('node:child_process');
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
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node can pass normalized [options, callback] arguments to Socket.connect.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const path = typeof first === 'object' && first ? first.path : typeof first === 'string' ? first : '';
  const warehouseConnection = warehouseEnabled && typeof first === 'object' &&
    Number(first.port) === 443 && (first.host === warehouseHost || first.servername === warehouseHost);
  if (!warehouseConnection && (!path || !path.startsWith(`/cloudsql/${process.env.CLOUDSQL_INSTANCE}/.s.PGSQL.`))) blocked();
  return connect.apply(this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  // Only the internal DEV account-link bridge is allowed. Shopify, email,
  // accounting integrations, production WMS, callbacks and subprocesses stay blocked.
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!warehouseEnabled || url.origin !== warehouseOrigin || url.username || url.password || url.search || url.hash ||
      !['/api/auth/erp/staff','/api/auth/erp/bind'].includes(url.pathname) || options.method !== 'POST' || options.redirect !== 'error') blocked();
  return fetch(input, options);
};
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = blocked;
syncBuiltinESMExports();
