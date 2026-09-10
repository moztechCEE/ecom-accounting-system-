// Synthetic databases and ephemeral service keys only; never uses cloud credentials.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const { readFileSync } = require('node:fs'),
  { generateKeyPairSync } = require('node:crypto');
const source = process.env.WMS_WORKSPACE_SOURCE_ROOT;
if (!source) throw Error('WMS_WORKSPACE_SOURCE_ROOT required');
const { setupCommands } = require(
  path.join(source, 'backend/tests/erpWorkspaceCommands.test.cjs'),
);
const { createErpWorkspaceCommandRouter } = require(
  path.join(source, 'backend/src/routes/erpWorkspaceCommandRoutes'),
);
const { createErpWorkspaceRouter } = require(
  path.join(source, 'backend/src/routes/erpWorkspaceRoutes'),
);
const { hash } = require(
  path.join(source, 'backend/src/services/erpWorkspaceCommands'),
);
const {
  WmsWorkspaceBridge,
} = require('../dist/src/modules/integration/wms/wms-workspace-bridge');
const {
  WmsDispatchService,
} = require('../dist/src/modules/integration/wms/wms-dispatch.service');
const { PGlite } = require('@electric-sql/pglite'),
  express = require('express'),
  jwt = require('jsonwebtoken');
test('ERP durable intent -> signed HTTP -> WMS -> independent picking and packing queues', async () => {
  const db = new PGlite(),
    erp = new PGlite();
  let server;
  try {
    const pool = await setupCommands(db),
      keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKey = keys.publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString(),
      privateKey = keys.privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString();
    const env = {
      NODE_ENV: 'test',
      ERP_WORKSPACE_COMMAND_DATABASE: 'postgres',
      ERP_WORKSPACE_COMMAND_BOUNDARY: 'isolated-staging',
      ERP_WORKSPACE_COMMANDS_ENABLED: 'true',
      ERP_WORKSPACE_READ_ENABLED: 'true',
      ERP_WORKSPACE_ISSUER: 'erp-test',
      ERP_WORKSPACE_AUDIENCE: 'wms-test',
      ERP_WORKSPACE_PUBLIC_KEY: publicKey,
    };
    assert.throws(
      () =>
        createErpWorkspaceCommandRouter({
          pool,
          env: { ...env, ERP_WORKSPACE_COMMAND_DATABASE: 'corely_wms' },
        }),
      /ISOLATED_DATABASE_REQUIRED/,
    );
    const app = express();
    app.use(
      '/api/integrations/erp/v1',
      createErpWorkspaceRouter({ pool, env }),
    );
    app.use(
      '/api/integrations/erp/workflow/v1',
      createErpWorkspaceCommandRouter({ pool, env }),
    );
    app.use('/disabled', createErpWorkspaceCommandRouter({ pool, env: {} }));
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const url = `http://127.0.0.1:${server.address().port}/`;
    let held = [
      'wms_tasks:read',
      'wms_orders:create',
      'wms_picking:execute',
      'wms_packing:execute',
    ];
    const canonical = {
      id: 'erp-flow',
      entityId: 'test-company',
      externalOrderId: 'TEST-FLOW-01',
      status: 'pending',
      shipments: [],
      updatedAt: new Date('2026-09-11'),
      items: [
        {
          id: 'line1',
          productId: 'cable',
          qty: 2,
          product: {
            entityId: 'test-company',
            isActive: true,
            hasSerialNumbers: false,
            sku: 'CABLE',
            name: 'Synthetic cable',
            barcode: 'CABLE',
          },
        },
      ],
    };
    await erp.exec(
      "CREATE TABLE sales_orders(id text PRIMARY KEY,entity_id text); INSERT INTO sales_orders VALUES('erp-flow','test-company');",
    );
    await erp.exec(
      readFileSync(
        path.join(
          __dirname,
          '../prisma/migrations/20260911090000_wms_dispatch_intents/migration.sql',
        ),
        'utf8',
      ),
    );
    const raw = (strings, ...args) =>
      erp.query(
        strings.reduce((s, v, i) => s + (i ? '$' + i : '') + v, ''),
        args,
      );
    const prisma = {
      user: {
        findUnique: async () => ({ isActive: true, mustChangePassword: false }),
      },
      userRole: {
        findMany: async () => [
          {
            role: {
              code: 'EMPLOYEE',
              permissions: held.map((p) => {
                const [resource, action] = p.split(':');
                return { permission: { resource, action } };
              }),
            },
          },
        ],
      },
      salesOrder: {
        findFirst: async ({ where }) =>
          where.entityId === canonical.entityId && where.id === canonical.id
            ? structuredClone(canonical)
            : null,
      },
      $queryRaw: async (...args) => (await raw(...args)).rows,
      $executeRaw: async (...args) => (await raw(...args)).affectedRows,
    };
    prisma.$transaction = async (fn) => {
      await erp.exec('BEGIN');
      try {
        const result = await fn(prisma);
        await erp.exec('COMMIT');
        return result;
      } catch (e) {
        await erp.exec('ROLLBACK');
        throw e;
      }
    };
    const config = {
      NODE_ENV: 'test',
      WMS_WORKSPACE_READ_ENABLED: 'true',
      WMS_WORKSPACE_COMMANDS_ENABLED: 'true',
      WMS_WORKSPACE_URL: url,
      WMS_WORKSPACE_ISSUER: 'erp-test',
      WMS_WORKSPACE_AUDIENCE: 'wms-test',
      WMS_WORKSPACE_PRIVATE_KEY: privateKey,
      WMS_DISPATCH_PRODUCT_BRANDS_JSON: JSON.stringify({
        'test-company': { cable: 'TEST' },
      }),
    };
    let loseResponse = true;
    const fetcher = async (...args) => {
      const response = await fetch(...args);
      if (loseResponse && args[0].pathname.endsWith('/dispatch')) {
        loseResponse = false;
        await response.text();
        throw Error('simulated lost response after commit');
      }
      return response;
    };
    const bridge = new WmsWorkspaceBridge(prisma, config, fetcher),
      dispatch = new WmsDispatchService(prisma, bridge, config);
    const preview = await dispatch.preview(
      'worker',
      'test-company',
      'erp-flow',
    );
    await assert.rejects(
      dispatch.dispatch(
        'worker',
        'test-company',
        'erp-flow',
        preview.sourceHash,
        'intent-1',
      ),
      /結果尚未確認/,
    );
    assert.equal(
      (await erp.query('SELECT status FROM wms_dispatch_intents')).rows[0]
        .status,
      'unknown',
    );
    const accepted = await dispatch.dispatch(
      'worker',
      'test-company',
      'erp-flow',
      preview.sourceHash,
      'different-browser-request',
    );
    assert.equal(accepted.state, 'pending');
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM orders')).rows[0].n,
      1,
    );
    assert.equal(
      (await erp.query('SELECT request_id,status FROM wms_dispatch_intents'))
        .rows[0].request_id,
      'intent-1',
    );
    const query = (area) => ({
      entityId: 'test-company',
      area,
      page: 1,
      pageSize: 25,
    });
    assert.deepEqual(
      (await bridge.read('worker', query('pick'))).items.map((i) => i.id),
      ['erp-flow'],
    );
    assert.equal((await bridge.read('worker', query('pack'))).total, 0);
    // New-task detection works while the employee is on an unrelated search/page.
    const offpage = await bridge.read('worker', {
      ...query('pick'),
      page: 2,
      search: 'no-match',
    });
    assert.equal(offpage.items.length, 0);
    assert.deepEqual(offpage.readyKeys, ['erp-flow']);
    let current = await bridge.read('worker', query('pick'), 'erp-flow'),
      sequence = 0;
    async function command(stage, kind, scanValue) {
      current = await bridge.command(
        'worker',
        'test-company',
        'erp-flow',
        stage,
        kind,
        {
          requestId: 'workflow-' + ++sequence,
          expectedRevision: current.revision,
          ...(scanValue ? { scanValue } : {}),
        },
      );
    }
    await command('pick', 'claim');
    await assert.rejects(command('pack', 'scan', 'CABLE'), /WMS_SCOPE_DENIED/);
    await assert.rejects(
      command('pick', 'scan', 'WRONG'),
      /WMS_INPUT_OR_SCAN_INVALID/,
    );
    await command('pick', 'scan', 'CABLE');
    await command('pick', 'scan', 'CABLE');
    assert.equal(current.state, 'picked');
    assert.equal((await bridge.read('worker', query('pick'))).total, 0);
    const pack = await bridge.read('worker', query('pack'));
    assert.deepEqual(pack.readyKeys, ['erp-flow']);
    assert.equal(pack.total, 1);
    current = await bridge.read('worker', query('pack'), 'erp-flow');
    await command('pack', 'claim');
    await command('pack', 'scan', 'CABLE');
    await command('pack', 'scan', 'CABLE');
    assert.equal(current.state, 'completed');
    assert.equal(current.packed, 2);
    assert.deepEqual(current.allowedActions, []);
    assert.equal((await bridge.read('worker', query('pack'))).total, 0);
    held = ['wms_tasks:read', 'wms_picking:execute'];
    await assert.rejects(
      bridge.read('worker', query('pack')),
      /WMS_STATION_DENIED/,
    );
    const request = {
        expectedRevision: current.revision,
        requestId: 'tamper',
        scanValue: 'CABLE',
      },
      suffix = '/orders/erp-flow/scan';
    const token = jwt.sign(
      {
        entityId: 'test-company',
        station: 'pack',
        scope: 'wms.workspace.command',
        method: 'POST',
        path: suffix,
        bodyHash: hash(request),
      },
      privateKey,
      {
        algorithm: 'RS256',
        issuer: 'erp-test',
        audience: 'wms-test',
        subject: 'worker',
        expiresIn: 45,
      },
    );
    const response = await fetch(
      url + 'api/integrations/erp/workflow/v1' + suffix,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...request, scanValue: 'altered' }),
      },
    );
    assert.equal(response.status, 401);
    assert.equal((await fetch(url + 'disabled/orders')).status, 503);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await db.close();
    await erp.close();
  }
});
