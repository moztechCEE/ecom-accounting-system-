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
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node can pass normalized [options, callback] arguments to Socket.connect.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const path = typeof first === 'object' && first ? first.path : typeof first === 'string' ? first : '';
  if (!path || !path.startsWith(`/cloudsql/${process.env.CLOUDSQL_INSTANCE}/.s.PGSQL.`)) blocked();
  return connect.apply(this, args);
};
globalThis.fetch = async () => blocked();
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = blocked;
syncBuiltinESMExports();
