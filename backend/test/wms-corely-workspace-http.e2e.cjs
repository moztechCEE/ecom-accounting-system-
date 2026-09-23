// Local synthetic HTTP contract only. Never reads cloud settings or DEV data.
// Run after `npm run build` with WMS_WORKSPACE_SOURCE_ROOT set to a reviewed WMS checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const express = require('express');

const source = process.env.WMS_WORKSPACE_SOURCE_ROOT;
if (!source) throw Error('WMS_WORKSPACE_SOURCE_ROOT required');
const { createCorelyWorkspaceReadRouter, createCorelyWorkspaceCommandRouter } = require(
  path.join(source, 'backend/src/routes/corelyWorkspaceRoutes'),
);
const { WmsWorkspaceBridge } = require('../dist/src/modules/integration/wms/wms-workspace-bridge');

function fixture() {
  const order = { id: 8, voucher_number: 'WT0123456789ABCDEF01', work_barcode: 'WT0123456789ABCDEF01',
    status: 'pending', warehouse_hold: false, picker_id: null, packer_id: null,
    updated_at: new Date('2026-09-24T00:00:00Z') };
  const item = { id: 11, order_id: 8, source_line_id: 'line-1', product_code: 'SKU',
    product_name: 'Synthetic item', barcode: '1234', quantity: 1, picked_quantity: 0, packed_quantity: 0 };
  const sourceOrder = { id: 2, entity_id: 'company', erp_order_id: 'sale-1', order_id: 8,
    import_batch_id: 3, reservation_accepted: true,
    payload: { orderNumber: 'SO-1', brand: 'MOZTECH', items: [] } };
  const users = {
    'erp-picker': { id: 7, name: 'Picker', role: 'picker' },
    'erp-packer': { id: 9, name: 'Packer', role: 'packer' },
  };
  const queries = [];
  const pool = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes('FROM erp_staff_identities e JOIN users u'))
      return { rows: params[1] === 'company' && users[params[0]] ? [users[params[0]]] : [] };
    if (sql.includes('SELECT i.* FROM corely_native_intakes i WHERE'))
      return { rows: params[0] === 'company' && params[1] === 'sale-1' ? [sourceOrder] : [] };
    if (sql.startsWith('SELECT * FROM orders WHERE')) return { rows: [{ ...order }] };
    if (sql.startsWith('SELECT * FROM order_items WHERE')) return { rows: [{ ...item }] };
    if (sql.startsWith('SELECT s.* FROM order_item_instances') || sql.startsWith('SELECT i.* FROM order_item_instances')) return { rows: [] };
    if (sql.includes('SELECT o.*,p.name AS picker_name')) return { rows: [{ ...order,
      picker_name: order.picker_id === 7 ? 'Picker' : null,
      packer_name: order.packer_id === 9 ? 'Packer' : null }] };
    if (sql.startsWith('SELECT type FROM order_exceptions')) return { rows: [] };
    if (sql.startsWith('SELECT 1 FROM corely_dispatch_grants')) return { rows: [] };
    if (sql.startsWith('SELECT 1 FROM wms_scan_commands') || sql.startsWith('SELECT 1 FROM wms_claim_commands')) return { rows: [] };
    if (sql.includes('SELECT order_id,response FROM wms_claim_commands') || sql.includes('SELECT order_id,response FROM wms_scan_commands')) return { rows: [] };
    if (sql.startsWith('SELECT work_barcode FROM orders')) return { rows: [{ work_barcode: order.work_barcode }] };
    if (sql.includes('count(*)::int AS total')) {
      const station = params[2];
      const ready = station === 'pick' ? ['pending', 'picking'].includes(order.status) : ['picked', 'packing'].includes(order.status);
      return { rows: [{ total: ready ? 1 : 0 }] };
    }
    if (sql.includes('SELECT i.erp_order_id,i.payload,o.status')) {
      const station = params[2];
      const ready = station === 'pick' ? ['pending', 'picking'].includes(order.status) : ['picked', 'packing'].includes(order.status);
      return { rows: ready ? [{ erp_order_id: 'sale-1', payload: sourceOrder.payload, status: order.status,
        warehouse_hold: order.warehouse_hold, updated_at: order.updated_at,
        picker_name: order.picker_id === 7 ? 'Picker' : null,
        packer_name: order.packer_id === 9 ? 'Packer' : null,
        required: 1, picked: item.picked_quantity, packed: item.packed_quantity }] : [] };
    }
    if (sql.includes('SELECT i.erp_order_id FROM corely_native_intakes')) {
      const station = params[1];
      const ready = station === 'pick' ? ['pending', 'picking'].includes(order.status) : ['picked', 'packing'].includes(order.status);
      return { rows: ready ? [{ erp_order_id: 'sale-1' }] : [] };
    }
    throw Error(`Unexpected WMS SQL: ${sql}`);
  } };
  return { order, item, pool, queries };
}

function erpPermissions(actor) {
  const held = ['wms_tasks:read', actor === 'erp-picker' ? 'wms_picking:execute' : 'wms_packing:execute'];
  return {
    user: { findUnique: async () => ({ isActive: true, mustChangePassword: false }) },
    userRole: { findMany: async () => [{ role: { code: 'EMPLOYEE', permissions: held.map(value => {
      const [resource, action] = value.split(':'); return { permission: { resource, action } };
    }) } }] },
  };
}

test('signed ERP bridge reaches native WMS pick and pack routes with exact revisions', { timeout: 30000 }, async () => {
  const { order, item, pool } = fixture();
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const env = { ERP_WORKSPACE_READ_ENABLED: 'true', ERP_WORKSPACE_COMMANDS_ENABLED: 'true',
    ERP_WORKSPACE_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    ERP_WORKSPACE_ISSUER: 'erp-test', ERP_WORKSPACE_AUDIENCE: 'wms-test' };
  let claims = 0, scans = 0;
  const claimHandler = async (req, res) => {
    claims += 1;
    assert.equal(req.body.expectedActorId, req.user.id);
    await req.workspaceGuard(pool, 8);
    order.status = req.body.stage === 'pick' ? 'picking' : 'packing';
    if (req.body.stage === 'pick') order.picker_id = 7;
    else order.packer_id = 9;
    order.updated_at = new Date(order.updated_at.getTime() + 60000);
    res.json({ outcome: 'claimed' });
  };
  const scanHandler = async (req, res) => {
    scans += 1;
    assert.equal(req.body.scanValue, '1234');
    assert.match(req.body.expectedState, /^[a-f0-9]{64}$/);
    await req.workspaceGuard(pool, 8);
    if (req.body.type === 'pick') { item.picked_quantity = 1; order.status = 'picked'; }
    else { item.packed_quantity = 1; order.status = 'completed'; }
    order.updated_at = new Date(order.updated_at.getTime() + 60000);
    res.json({ format: 'delta-v1' });
  };
  const app = express(); app.use(express.json());
  app.use('/api/integrations/erp/v1', createCorelyWorkspaceReadRouter({ pool, env }));
  app.use('/api/integrations/erp/workflow/v1', createCorelyWorkspaceCommandRouter({ pool, env, claimHandler, scanHandler }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const config = { NODE_ENV: 'test', WMS_WORKSPACE_READ_ENABLED: 'true', WMS_WORKSPACE_COMMANDS_ENABLED: 'true',
      WMS_WORKSPACE_URL: `http://127.0.0.1:${server.address().port}/`,
      WMS_WORKSPACE_ISSUER: 'erp-test', WMS_WORKSPACE_AUDIENCE: 'wms-test', WMS_WORKSPACE_PRIVATE_KEY: privateKey };
    const picker = new WmsWorkspaceBridge(erpPermissions('erp-picker'), config);
    const packer = new WmsWorkspaceBridge(erpPermissions('erp-packer'), config);
    const query = area => ({ entityId: 'company', area, view: 'all', page: 1, pageSize: 25 });
    assert.deepEqual((await picker.read('erp-picker', query('pick'))).readyKeys, ['sale-1']);
    let current = await picker.read('erp-picker', query('pick'), 'sale-1');
    assert.deepEqual(current.allowedActions, ['pick:claim']);
    async function command(bridge, actor, station, kind, requestId, scanValue) {
      current = await bridge.command(actor, 'company', 'sale-1', station, kind,
        { entityId: 'company', expectedRevision: current.revision, requestId,
          ...(scanValue ? { scanValue } : {}) });
    }
    await command(picker, 'erp-picker', 'pick', 'claim', 'pick-claim');
    assert.equal(current.state, 'picking');
    assert.ok(current.allowedActions.includes('pick:scan'));
    await command(picker, 'erp-picker', 'pick', 'scan', 'pick-scan', '1234');
    assert.equal(current.state, 'picked');
    assert.equal((await picker.read('erp-picker', query('pick'))).total, 0);
    assert.deepEqual((await packer.read('erp-packer', query('pack'))).readyKeys, ['sale-1']);
    current = await packer.read('erp-packer', query('pack'), 'sale-1');
    await command(packer, 'erp-packer', 'pack', 'claim', 'pack-claim');
    await command(packer, 'erp-packer', 'pack', 'scan', 'pack-scan', '1234');
    assert.equal(current.state, 'completed');
    assert.equal(current.packed, 1);
    assert.equal((await packer.read('erp-packer', query('pack'))).total, 0);
    assert.equal(claims, 2);
    assert.equal(scans, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
