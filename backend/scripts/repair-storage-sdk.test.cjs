// Offline regression through the installed Storage/GoogleAuth/gaxios/node-fetch stack.
// HTTP responses, credentials, sockets and the environment are synthetic. No SDK
// auth/request method is replaced; only local ADC discovery and the final I/O are.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const path = require('node:path');

const bucket = 'corely-repair-dev-249593319772';
const key = 'repair-media/doa-dev-qa-20261002/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
const origin = 'https://repair-sdk-fixture.invalid';
const projectId = 'moztech-main-db';
const sessionUri = 'https://storage.googleapis.com/upload/storage/v1/b/' + bucket + '/o?upload_id=synthetic-session';

async function fixture(scenario) {
  const { Writable, PassThrough } = require('node:stream');
  const http = require('node:http');
  const https = require('node:https');
  const net = require('node:net');
  const childProcess = require('node:child_process');
  const Module = require('node:module');
  const fs = require('node:fs');
  const requests = [];
  const socketAttempts = [];
  const socketArrivals = [];
  const subprocessAttempts = [];
  const adcLookups = [];
  const metadataHosts = new Set(['169.254.169.254', 'metadata.google.internal.']);
  let globalFetchCalls = 0;

  // This is installed before the sandbox captures its original connect. Even an
  // erroneously approved connection cannot reach DNS, a socket or a real server.
  net.Socket.prototype.connect = function (options) {
    socketArrivals.push({ ...options });
    return this;
  };
  globalThis.fetch = async () => {
    globalFetchCalls++;
    throw new Error('The real SDK must use gaxios/node-fetch, not global fetch');
  };

  class MemoryRequest extends Writable {
    constructor(options, responseCallback) {
      super();
      this.options = options;
      this.chunks = [];
      if (responseCallback) this.on('response', responseCallback);
    }
    _write(chunk, encoding, done) {
      this.chunks.push(Buffer.from(chunk));
      done();
    }
    _final(done) {
      const options = this.options;
      const hostname = options.hostname || options.host;
      const method = options.method || 'GET';
      const protocol = options.protocol;
      const url = new URL(options.path || '/', protocol + '//' + hostname);
      const headers = Object.fromEntries(Object.entries(options.headers || {}).map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)]));
      const connection = { host: hostname, port: Number(options.port || (protocol === 'https:' ? 443 : 80)), ...(protocol === 'https:' ? { servername: hostname } : {}) };
      socketAttempts.push(connection);
      try {
        // The current AsyncLocalStorage scope must pass the actual sandbox
        // Socket.connect guard before this fake transport can return a response.
        const socket = new net.Socket();
        socket.connect(connection);
        socket.destroy();
      } catch (error) {
        done(error);
        return;
      }
      const request = { protocol, hostname, method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body: Buffer.concat(this.chunks).toString('utf8'), socketApproved: true };
      requests.push(request);
      let status = 200;
      let body = '';
      let responseHeaders = { 'metadata-flavor': 'Google', 'content-type': 'application/json' };
      if (metadataHosts.has(hostname) && url.pathname === '/computeMetadata/v1/instance') {
        assert.equal(method, 'GET');
        assert.equal(headers['metadata-flavor'], 'Google');
        body = '{}';
      } else if (metadataHosts.has(hostname) && url.pathname === '/computeMetadata/v1/instance/service-accounts/default/token') {
        assert.equal(method, 'GET');
        assert.equal(headers['metadata-flavor'], 'Google');
        if (scenario === 'auth-failure') {
          status = 403;
          body = JSON.stringify({ error: 'synthetic metadata auth rejection' });
        } else {
          body = JSON.stringify({ access_token: 'synthetic-offline-token', expires_in: 3600, token_type: 'Bearer' });
        }
      } else if (hostname === 'storage.googleapis.com' && url.pathname === '/upload/storage/v1/b/' + bucket + '/o') {
        assert.equal(method, 'POST');
        assert.equal(headers.authorization, 'Bearer synthetic-offline-token');
        assert.equal(headers.origin, origin);
        assert.equal(headers['x-upload-content-type'], 'image/jpeg');
        assert.deepEqual(request.query, { name: key, uploadType: 'resumable', ifGenerationMatch: '0' });
        assert.deepEqual(JSON.parse(request.body), { cacheControl: 'private, no-store' });
        responseHeaders = { 'content-type': 'application/json', location: sessionUri };
        body = '{}';
      } else {
        done(new Error('Unexpected offline SDK transport target: ' + hostname + url.pathname));
        return;
      }
      const response = new PassThrough();
      response.statusCode = status;
      response.statusMessage = status === 200 ? 'OK' : 'Forbidden';
      response.headers = responseHeaders;
      response.complete = true;
      done();
      queueMicrotask(() => {
        this.emit('response', response);
        response.end(body);
      });
    }
    abort() {}
  }
  // Replace both native transports before loading node-fetch. No original
  // request function is retained by the fixture or by the SDK dependency graph.
  http.request = options => new MemoryRequest(options);
  https.request = options => new MemoryRequest(options);
  require(path.resolve(__dirname, 'dev-sandbox.cjs'));
  const blockedExec = childProcess.exec;
  childProcess.exec = (...args) => {
    subprocessAttempts.push(args[0]);
    return blockedExec(...args);
  };

  const { GoogleAuth } = require('google-auth-library');
  const gcpMetadata = require('gcp-metadata');
  // Synthetic ADC absence prevents reading a developer credential, private key,
  // well-known configuration or HOME. All other GoogleAuth behavior is real.
  for (const method of ['_tryGetApplicationCredentialsFromEnvironmentVariable', '_tryGetApplicationCredentialsFromWellKnownFile']) {
    GoogleAuth.prototype[method] = async function () {
      adcLookups.push(method);
      return null;
    };
  }
  // Force the real metadata ping instead of consulting host BIOS/MAC hints.
  gcpMetadata.setGCPResidency(false);
  const { Storage } = require('@google-cloud/storage');
  const storagePackagePath = path.resolve(path.dirname(require.resolve('@google-cloud/storage')), '../../../package.json');
  const storagePackage = JSON.parse(fs.readFileSync(storagePackagePath, 'utf8'));
  assert.equal(storagePackage.name, '@google-cloud/storage');
  assert.equal(storagePackage.version, '7.19.0');
  const ts = require('typescript');
  const contextPath = path.resolve(__dirname, '../src/modules/mailroom/repair-storage-context.ts');
  const contextModule = new Module(contextPath, module);
  contextModule.filename = contextPath;
  contextModule.paths = Module._nodeModulePaths(path.dirname(contextPath));
  contextModule._compile(ts.transpileModule(fs.readFileSync(contextPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, contextPath);
  const { withRepairStorage } = contextModule.exports;
  const storage = new Storage({ retryOptions: { autoRetry: false } });
  const upload = () => storage.bucket(bucket).file(key).createResumableUpload({
    origin,
    metadata: { contentType: 'image/jpeg', cacheControl: 'private, no-store' },
    preconditionOpts: { ifGenerationMatch: 0 },
  });
  const blocked = error => error.code === 'ERP_DEV_EXTERNAL_EFFECT_BLOCKED';

  if (scenario === 'missing-project') {
    await assert.rejects(withRepairStorage(bucket, key, upload), blocked);
    assert.deepEqual(subprocessAttempts, ['gcloud config config-helper --format json']);
    assert.equal(requests.some(request => request.hostname === 'storage.googleapis.com'), false);
    assert.equal(requests.some(request => request.path === '/computeMetadata/v1/project/project-id'), false);
  } else if (scenario === 'configured-project' || scenario === 'default-metadata-hosts') {
    const [uri] = await withRepairStorage(bucket, key, upload);
    assert.equal(uri, sessionUri);
    assert.equal(await storage.authClient.getProjectId(), projectId);
    assert.deepEqual(subprocessAttempts, []);
    if (scenario === 'default-metadata-hosts') {
      assert.equal(process.env.GCE_METADATA_HOST, undefined);
      assert.equal(process.env.GCE_METADATA_IP, undefined);
      assert.deepEqual(requests.slice(0, 2).map(request => [request.hostname, request.path, request.method]).sort(), [
        ['169.254.169.254', '/computeMetadata/v1/instance', 'GET'],
        ['metadata.google.internal.', '/computeMetadata/v1/instance', 'GET'],
      ].sort());
      assert.deepEqual(requests.slice(2).map(request => [request.hostname, request.path, request.method]), [
        ['169.254.169.254', '/computeMetadata/v1/instance/service-accounts/default/token', 'GET'],
        ['storage.googleapis.com', '/upload/storage/v1/b/' + bucket + '/o', 'POST'],
      ]);
    } else {
      assert.deepEqual(requests.map(request => [request.hostname, request.path, request.method]), [
        ['metadata.google.internal.', '/computeMetadata/v1/instance', 'GET'],
        ['metadata.google.internal.', '/computeMetadata/v1/instance/service-accounts/default/token', 'GET'],
        ['storage.googleapis.com', '/upload/storage/v1/b/' + bucket + '/o', 'POST'],
      ]);
    }
    // These are the Storage SDK's existing default token scopes. The IAM scope
    // is a value in the metadata URL, not an IAM API or a new network exception.
    assert.deepEqual(requests.find(request => request.path.endsWith('/token')).query.scopes.split(',').sort(), [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/devstorage.full_control',
      'https://www.googleapis.com/auth/iam',
    ].sort());
    const completed = requests.length;
    await assert.rejects(upload(), blocked);
    assert.equal(requests.length, completed, 'scope must be released before a later SDK call');
    assert.equal(socketAttempts.length, socketArrivals.length + 1, 'unscoped SDK transport must fail the socket guard');
    let started = 0;
    for (const [otherBucket, otherKey] of [
      ['foreign-bucket', key],
      [bucket, key.replace('doa-dev-qa-20261002', 'foreign-company')],
      [bucket, key + '/extra'],
    ]) {
      await assert.rejects(withRepairStorage(otherBucket, otherKey, async () => { started++; return upload(); }), blocked);
    }
    assert.equal(started, 0, 'invalid repair context must fail before transport or ADC');
    assert.equal(requests.length, completed);
  } else if (scenario === 'auth-failure') {
    await assert.rejects(withRepairStorage(bucket, key, upload), error => error.response?.status === 403);
    assert.deepEqual(subprocessAttempts, []);
    assert.equal(requests.filter(request => request.path.endsWith('/token')).length, 1);
    assert.equal(requests.some(request => request.hostname === 'storage.googleapis.com'), false);
  } else {
    throw new Error('Unknown SDK fixture');
  }
  assert.equal(globalFetchCalls, 0);
  assert.ok(adcLookups.length > 0);
  assert.ok(requests.every(request => request.socketApproved));
  // Print only a fixed receipt. Captured Authorization and synthetic credential
  // data remain inside the child and never appear in the test output.
  process.stdout.write(JSON.stringify({ scenario, requests: requests.length, socketArrivals: socketArrivals.length, blockedSubprocessAttempts: subprocessAttempts.length }));
}

if (process.argv[2] === '--sdk-fixture') {
  fixture(process.argv[3]).catch(error => {
    // SDK failures may carry request headers/configuration. Keep them out of
    // test output, including when a future dependency change breaks this test.
    console.error(error.code || error.name, 'Offline SDK fixture failed:', process.argv[3]);
    process.exitCode = 1;
  });
} else {
  const syntheticEnv = {
    ERP_DEV_SANDBOX: 'true',
    DB_NAME: 'erp_dev_fixture',
    DB_USER: 'erp_dev_runtime',
    SEED_ON_STARTUP: 'false',
    RUNTIME_SCHEDULES_ENABLED: 'false',
    CLOUDSQL_INSTANCE: 'fixture:region:instance',
    REPAIR_MEDIA_ENABLED: 'true',
    REPAIR_MEDIA_BUCKET: bucket,
    METADATA_SERVER_DETECTION: 'ping-only',
    GCE_METADATA_HOST: 'metadata.google.internal.',
    DETECT_GCP_RETRIES: '0',
    // The optional dependency search path is the sole inherited setting. This
    // permits the isolated checkout to use an existing public dependency tree.
    ...(process.env.NODE_PATH ? { NODE_PATH: process.env.NODE_PATH } : {}),
  };
  function run(scenario, patch = {}) {
    const child = spawnSync(process.execPath, [__filename, '--sdk-fixture', scenario], {
      env: { ...syntheticEnv, ...patch },
      timeout: 15000,
      encoding: 'utf8',
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  }
  test('real SDK without project configuration hits the subprocess sandbox before metadata project lookup or upload', () => {
    const receipt = run('missing-project');
    assert.equal(receipt.blockedSubprocessAttempts, 1);
  });
  test('GOOGLE_CLOUD_PROJECT alone lets the real SDK mint the exact scoped upload and releases permission afterwards', () => {
    const receipt = run('configured-project', { GOOGLE_CLOUD_PROJECT: projectId });
    assert.equal(receipt.requests, 3);
    assert.equal(receipt.blockedSubprocessAttempts, 0);
  });
  test('real metadata auth rejection prevents any upload request', () => {
    const receipt = run('auth-failure', { GOOGLE_CLOUD_PROJECT: projectId });
    assert.equal(receipt.requests, 2);
    assert.equal(receipt.blockedSubprocessAttempts, 0);
  });
  test('real SDK default metadata discovery probes IP and DNS then mints through the primary metadata host', () => {
    const receipt = run('default-metadata-hosts', { GOOGLE_CLOUD_PROJECT: projectId, GCE_METADATA_HOST: undefined });
    assert.equal(receipt.requests, 4);
    assert.equal(receipt.blockedSubprocessAttempts, 0);
  });
}
