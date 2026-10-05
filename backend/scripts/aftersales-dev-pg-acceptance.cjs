#!/usr/bin/env node
/* Real PostgreSQL acceptance, opt-in only. Every business row is synthetic and
 * rolled back, including source feed entries. Sequence gaps may remain.
 * No HTTP/LINE/payment/carrier/ECOUNT client is started. This is not a full UI
 * or paid-release acceptance test. Credentials are supplied privately in env.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_ROOT = path.join(path.dirname(ROOT), 'corely-aftersales-workflow-20261005');
const ROLLBACK = new Error('SYNTHETIC_ACCEPTANCE_ROLLBACK');
const checks = [];
let phase = 'guard';
function connection(value, which) {
  assert.ok(['erp', 'source'].includes(which), 'Unknown DEV connection target');
  const expected = which === 'erp'
    ? { database: 'erp_dev_20260921', user: 'erp_dev_runtime', port: '15442' }
    : { database: 'moztech_after_sales_dev', user: 'moztech_aftersales_dev', port: '15443' };
  let url;
  try { url = new URL(value || ''); } catch { throw new Error('Private DEV connection required'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol)
    && url.hostname === '127.0.0.1' && url.port === expected.port
    && decodeURIComponent(url.username) === expected.user && url.password
    && url.pathname === '/' + expected.database && !url.hash,
  'Connection must use the fixed loopback DEV database, user and proxy port');
  assert.ok([...url.searchParams.keys()].every(key => key === 'schema')
    && url.searchParams.getAll('schema').length <= 1
    && (!url.searchParams.has('schema') || url.searchParams.get('schema') === 'public'),
  'Only the public DEV schema is accepted');
  url.searchParams.set('connection_limit', '6');
  url.searchParams.set('connect_timeout', '10');
  return { url: url.toString(), ...expected };
}
async function identity(client, expected) {
  const [row] = await client.$queryRawUnsafe('SELECT current_database() AS database, current_user AS db_user');
  assert.deepEqual(row, { database: expected.database, db_user: expected.user });
}
async function check(name, fn) {
  phase = name;
  await fn();
  checks.push(name);
}
async function rollback(client, fn, options = {}) {
  try {
    await client.$transaction(async tx => { await fn(tx); throw ROLLBACK; },
      { maxWait: 5000, timeout: 60000, ...options });
    throw new Error('Synthetic transaction unexpectedly committed');
  } catch (error) { if (error !== ROLLBACK) throw error; }
}
function savepoints(tx) {
  let sequence = 0;
  return async (fn, before) => {
    const name = 'qa_' + (++sequence);
    await tx.$executeRawUnsafe('SAVEPOINT ' + name);
    try {
      if (before) await before();
      const value = await fn(tx);
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT ' + name);
      return value;
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT ' + name);
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT ' + name);
      throw error;
    }
  };
}
async function stockAcceptance(client) {
  const { AfterSalesStockService } = require('../src/modules/integration/after-sales/after-sales-stock.service.ts');
  const { AuthService } = require('../src/modules/auth/auth.service.ts');
  const { UsersService } = require('../src/modules/users/users.service.ts');
  const { EntityAccessService } = require('../src/common/entity-access/entity-access.service.ts');
  const token = randomUUID().replaceAll('-', '').slice(0, 12);
  const companyId = randomUUID(), roleId = randomUUID(), userId = randomUUID();
  await rollback(client, async tx => {
    const step = savepoints(tx);
    let beforeTransaction;
    const db = new Proxy(tx, { get(target, name) {
      if (name === '$transaction') return async callback => {
        const hook = beforeTransaction; beforeTransaction = undefined;
        return step(callback, hook);
      };
      return Reflect.get(target, name);
    } });
    const access = new EntityAccessService(db);
    const users = new UsersService(db, access);
    const auth = new AuthService(users, null, null, null, db);
    const stock = new AfterSalesStockService(db, auth, access, { get: () => 'false' });
    await tx.entity.create({ data: { id: companyId, loginCode: 'PGQA' + token, name: 'SYNTHETIC PG ACCEPTANCE', country: 'TW', baseCurrency: 'TWD' } });
    const foreign = await tx.entity.create({ data: { loginCode: 'PGQAF' + token, name: 'SYNTHETIC FOREIGN QA', country: 'TW', baseCurrency: 'TWD' } });
    const permissions = await tx.permission.findMany({ where: { resource: 'after_sales_stock', action: { in: ['read', 'update'] } }, select: { id: true, action: true } });
    assert.equal(permissions.length, 2, 'Reviewed stock permissions must already exist');
    await tx.role.create({ data: { id: roleId, code: 'PG_QA_' + token, name: 'SYNTHETIC PG QA ' + token,
      permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await tx.user.create({ data: { id: userId, email: 'pg-qa-' + token + '@example.invalid', passwordHash: 'SYNTHETIC_UNUSABLE_PASSWORD', name: 'SYNTHETIC PG QA', inventoryDataScope: 'ENTITY',
      roles: { create: { roleId } }, entityMemberships: { create: { entityId: companyId, isPrimary: true } } } });
    const product = await tx.product.create({ data: { entityId: companyId, sku: 'PG-QA-' + token, name: 'SYNTHETIC NONSERIAL QA', hasSerialNumbers: false } });
    const warehouse = await tx.warehouse.create({ data: { entityId: companyId, code: 'PG-QA', name: 'SYNTHETIC QA ONLY' } });
    await tx.inventorySnapshot.create({ data: { entityId: companyId, productId: product.id, warehouseId: warehouse.id, qtyOnHand: 2, qtyAvailable: 2 } });
    const incoming = await tx.inventoryTransaction.create({ data: { entityId: companyId, productId: product.id, warehouseId: warehouse.id, quantity: 2, direction: 'IN', referenceType: 'SYNTHETIC_PG_QA', referenceId: token, occurredAt: new Date(), reason: 'Synthetic rollback-only fixture; no physical/external posting' } });
    const receipt = await tx.mailroomReceipt.create({ data: { entityId: companyId, number: 'PG-QA-' + token, category: 'REPAIR', receivedById: userId, requestId: randomUUID(), requestHash: 'SYNTHETIC_QA' } });
    const item = await tx.mailroomItem.create({ data: { entityId: companyId, receiptId: receipt.id, label: 'SYNTHETIC QA ITEM', productName: product.name, sku: product.sku, status: 'INSPECTING', location: 'SYNTHETIC_QA', custodianId: userId, repairOwnerId: userId,
      repairInspection: { status: 'SUBMITTED', revision: 1, data: { plan: 'REPLACE', replacementSku: product.sku, replacementCondition: 'NEW' } } } });
    const unit = await stock.qualify(userId, { entityId: companyId, productId: product.id, warehouseId: warehouse.id, kind: 'NEW', unitLabel: 'SYNTHETIC-QA-' + token,
      sourceReference: incoming.id, ownershipReference: 'SYNTHETIC_QA_ONLY', inspectionReference: 'SYNTHETIC_QA_ONLY' });
    const amount = async () => {
      const row = await tx.inventorySnapshot.findUniqueOrThrow({ where: { entityId_warehouseId_productId: { entityId: companyId, warehouseId: warehouse.id, productId: product.id } } });
      return [row.qtyOnHand.toString(), row.qtyAllocated.toString(), row.qtyAvailable.toString()];
    };
    const reserve = requestId => stock.reserve(userId, { entityId: companyId, itemId: item.id, unitId: unit.id, requestId, expectedVersion: item.version });
    await check('stock reserve and release are real atomic movements', async () => {
      const row = await reserve(randomUUID());
      assert.deepEqual(await amount(), ['2', '1', '1']);
      const released = await stock.release(userId, companyId, row.id);
      assert.equal(released.status, 'RELEASED');
      assert.deepEqual(await amount(), ['2', '0', '2']);
    });
    await check('stale version cannot reserve', async () => {
      await assert.rejects(stock.reserve(userId, { entityId: companyId, itemId: item.id, unitId: unit.id, requestId: randomUUID(), expectedVersion: item.version + 1 }), /版本/);
      assert.deepEqual(await amount(), ['2', '0', '2']);
    });
    await check('foreign company cannot use local stock', async () => {
      await assert.rejects(stock.reserve(userId, { entityId: foreign.id, itemId: item.id, unitId: unit.id, requestId: randomUUID(), expectedVersion: item.version }));
      assert.deepEqual(await amount(), ['2', '0', '2']);
    });
    await check('fresh transaction actor revocation denies a preauthorized request', async () => {
      beforeTransaction = () => tx.user.update({ where: { id: userId }, data: { isActive: false } });
      await assert.rejects(reserve(randomUUID()), /停用/);
      assert.equal((await tx.user.findUniqueOrThrow({ where: { id: userId } })).isActive, true);
    });
    const requestId = randomUUID();
    const reserved = await reserve(requestId);
    const consume = (sku = product.sku, kind = 'NEW', service = stock) => step(transaction => service.consumeForRepair(transaction, companyId, item, userId, randomUUID(), undefined, sku, kind));
    await check('reservation replay cannot reserve twice', async () => {
      assert.equal((await reserve(requestId)).id, reserved.id);
      assert.deepEqual(await amount(), ['2', '1', '1']);
    });
    await check('insufficient on-hand rolls back the whole failed consume', async () => {
      await assert.rejects(step(async transaction => {
        await transaction.inventorySnapshot.updateMany({ where: { entityId: companyId }, data: { qtyOnHand: 0 } });
        return stock.consumeForRepair(transaction, companyId, item, userId, randomUUID(), undefined, product.sku, 'NEW');
      }), /餘額不足/);
      assert.deepEqual(await amount(), ['2', '1', '1']);
      assert.equal(await tx.inventoryTransaction.count({ where: { entityId: companyId, direction: 'OUT' } }), 0);
    });
    await check('formal OUT, exact proof and POSTED replay spend one unit only', async () => {
      const proof = await consume();
      assert.equal(proof.status, 'POSTED'); assert.ok(proof.postingId);
      assert.equal(proof.quantity, 1); assert.equal(proof.replacementSN, null);
      assert.notEqual(proof.externalStatus, 'CONFIRMED');
      assert.deepEqual(await amount(), ['1', '0', '1']);
      assert.equal((await consume()).postingId, proof.postingId);
      assert.equal(await tx.inventoryTransaction.count({ where: { entityId: companyId, direction: 'OUT' } }), 1);
      assert.deepEqual(await amount(), ['1', '0', '1']);
    });
    await check('posted proof cannot be reused for changed SKU or condition', async () => {
      await assert.rejects(consume('SYNTHETIC-WRONG'), /不一致/);
      await assert.rejects(consume(product.sku, 'REFURBISHED'), /不一致/);
      assert.equal(await tx.inventoryTransaction.count({ where: { entityId: companyId, direction: 'OUT' } }), 1);
    });
    await check('external-required gate does not claim ECOUNT completion', async () => {
      const strict = new AfterSalesStockService(db, auth, access, { get: () => 'true' });
      await assert.rejects(consume(product.sku, 'NEW', strict), /外部正式庫存/);
      assert.equal(await tx.inventoryTransaction.count({ where: { entityId: companyId, direction: 'OUT' } }), 1);
    });
  }, { isolationLevel: 'Serializable' });
  await check('all synthetic ERP business rows and role grants rolled back', async () => {
    assert.equal(await client.entity.count({ where: { id: companyId } }), 0);
    assert.equal(await client.role.count({ where: { id: roleId } }), 0);
    assert.equal(await client.user.count({ where: { id: userId } }), 0);
    assert.equal(await client.inventoryTransaction.count({ where: { entityId: companyId } }), 0);
  });
}
function caseData(suffix) {
  return { id: 'synthetic-pg-qa-' + suffix, caseNumber: 'SYNTHETIC-PG-QA-' + suffix, type: 'REPAIR', status: 'NEW', sourceChannel: 'SYNTHETIC_PG_QA', contactName: 'SYNTHETIC QA ONLY', contactPhone: '0000000000' };
}
async function sourceAcceptance(client) {
  const fixture = caseData(randomUUID());
  await rollback(client, async tx => {
    const step = savepoints(tx);
    await tx.case.create({ data: fixture });
    const events = () => tx.erpCaseChange.findMany({ where: { caseId: fixture.id }, orderBy: { id: 'asc' } });
    await check('new case emits noninitial source event', async () => {
      const rows = await events(); assert.equal(rows.length, 1);
      assert.equal(rows[0].initial, false); assert.equal(rows[0].change, 'UPDATED');
    });
    await check('source channel change emits old DELETED before new UPDATED', async () => {
      await tx.case.update({ where: { id: fixture.id }, data: { sourceChannel: 'SYNTHETIC_PG_QA_2' } });
      const rows = (await events()).slice(-2);
      assert.deepEqual(rows.map(r => [r.sourceChannel, r.change]), [['SYNTHETIC_PG_QA', 'DELETED'], ['SYNTHETIC_PG_QA_2', 'UPDATED']]);
      assert.ok(rows[0].id < rows[1].id);
    });
    const children = [
      ['caseItem', { productNameSnapshot: 'SYNTHETIC QA', quantity: 1 }],
      ['repairCaseDetail', { faultDescription: 'SYNTHETIC QA' }],
      ['paymentRecord', { amount: 0, status: 'PENDING' }],
      ['paymentRequest', { expiresAt: new Date(Date.now() + 60000) }],
      ['paymentSubmission', { paymentRequestId: null, remittedAt: new Date(), remittanceAmount: 0, remittanceLastFive: '00000' }],
      ['refundRecord', { amount: 0, status: 'PENDING' }],
      ['invoiceRecord', { isRequired: false, status: 'NOT_REQUIRED' }],
      ['shipment', { shipmentNumber: randomUUID(), carrier: 'SYNTHETIC_NO_CARRIER', recipientName: 'SYNTHETIC QA', recipientPhone: '0000000000', recipientAddress: 'SYNTHETIC QA ONLY' }],
      ['reverseShipment', { reverseShipmentNumber: randomUUID(), carrier: 'SYNTHETIC_NO_CARRIER' }],
      ['reshipmentCaseDetail', { reshipmentReason: 'SYNTHETIC QA' }],
      ['privatePurchaseCaseDetail', {}],
      ['exchangeReturnCaseDetail', { reasonCategory: 'SYNTHETIC QA' }],
      ['refundPickupCaseDetail', { refundReason: 'SYNTHETIC QA' }],
      ['customerIssueCaseDetail', { issueDescription: 'SYNTHETIC QA' }],
      ['caseAttachment', { fileName: 'synthetic.txt', fileUrl: 'https://example.invalid/synthetic-no-download', contentType: 'text/plain', sizeBytes: 0 }],
    ];
    const created = [];
    for (const [model, fields] of children) {
      if (model === 'paymentSubmission') fields.paymentRequestId = created.find(row => row.model === 'paymentRequest').id;
      await check('source child ' + model + ' INSERT emits one event', async () => {
        const count = (await events()).length;
        const row = await tx[model].create({ data: { caseId: fixture.id, ...fields } });
        created.push({ model, id: row.id }); assert.equal((await events()).length, count + 1);
      });
    }
    for (const row of created) await check('source child ' + row.model + ' UPDATE emits one event', async () => {
      const count = (await events()).length;
      await tx[row.model].update({ where: { id: row.id }, data: { updatedAt: new Date() } });
      assert.equal((await events()).length, count + 1);
    });
    for (const row of [...created].reverse()) await check('source child ' + row.model + ' DELETE emits one event', async () => {
      const count = (await events()).length;
      await tx[row.model].delete({ where: { id: row.id } }); assert.equal((await events()).length, count + 1);
    });
    await check('source history UPDATE and DELETE are append-only', async () => {
      const [row] = await events();
      await assert.rejects(step(t => t.erpCaseChange.update({ where: { id: row.id }, data: { change: 'DELETED' } })), /append-only/);
      await assert.rejects(step(t => t.erpCaseChange.delete({ where: { id: row.id } })), /append-only/);
      assert.equal((await tx.erpCaseChange.findUniqueOrThrow({ where: { id: row.id } })).change, 'UPDATED');
    });
    await check('soft and physical case deletion emit DELETED without losing feed history', async () => {
      await tx.case.update({ where: { id: fixture.id }, data: { deletedAt: new Date() } });
      assert.equal((await events()).at(-1).change, 'DELETED');
      await tx.case.delete({ where: { id: fixture.id } });
      assert.equal((await events()).at(-1).change, 'DELETED');
    });
  });
  await check('synthetic source case and feed rows rolled back', async () => {
    assert.equal(await client.case.count({ where: { id: fixture.id } }), 0);
    assert.equal(await client.erpCaseChange.count({ where: { caseId: fixture.id } }), 0);
  });
}
function deferred() { let resolve; const promise = new Promise(fn => { resolve = fn; }); return { promise, resolve }; }
async function orderingAcceptance(a, b, observer) {
  const first = caseData(randomUUID()), second = caseData(randomUUID());
  const entered = deferred(), attempted = deferred(), releaseA = deferred(), releaseB = deferred();
  let firstId, secondId;
  const settled = promise => promise.then(() => ({ ok: true }), () => ({ ok: false }));
  const one = settled(rollback(a, async tx => {
    await tx.case.create({ data: first });
    firstId = (await tx.erpCaseChange.findFirstOrThrow({ where: { caseId: first.id } })).id;
    entered.resolve(); await releaseA.promise;
  }));
  let two;
  try {
    await Promise.race([entered.promise, one.then(() => { throw new Error('First source writer failed before entering'); })]);
    two = settled(rollback(b, async tx => {
      const [pid] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
      attempted.resolve(pid.pid);
      await tx.case.create({ data: second });
      secondId = (await tx.erpCaseChange.findFirstOrThrow({ where: { caseId: second.id } })).id;
      await releaseB.promise;
    }));
    const pid = await Promise.race([attempted.promise, two.then(() => { throw new Error('Second source writer failed before entering'); })]);
    await check('second writer waits on advisory lock before allocating a visible source event', async () => {
      let blocked = false;
      for (let n = 0; n < 100 && !blocked; n++) {
        const [row] = await observer.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND locktype='advisory' AND NOT granted) AS blocked`;
        blocked = row.blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(blocked, 'Source writer must wait for the first transaction lock');
      assert.equal(await observer.erpCaseChange.count({ where: { caseId: { in: [first.id, second.id] } } }), 0);
    });
    releaseA.resolve(); assert.ok((await one).ok);
    // B must finish its insert only after A releases the transaction lock.
    for (let n = 0; n < 100 && secondId === undefined; n++) await new Promise(resolve => setTimeout(resolve, 50));
    await check('rolled-back sequence gaps preserve strict decimal event ordering', async () => { assert.ok(secondId > firstId); });
  } finally {
    releaseA.resolve(); releaseB.resolve();
    await one; if (two) assert.ok((await two).ok);
  }
  await check('concurrency fixtures leave no case or feed rows', async () => {
    assert.equal(await observer.case.count({ where: { id: { in: [first.id, second.id] } } }), 0);
    assert.equal(await observer.erpCaseChange.count({ where: { caseId: { in: [first.id, second.id] } } }), 0);
  });
}
async function main() {
  assert.equal(process.env.AFTERSALES_PG_ACCEPTANCE, 'true', 'Explicit synthetic DEV PG opt-in required');
  const erp = connection(process.env.ERP_PG_ACCEPTANCE_URL, 'erp');
  const source = connection(process.env.SOURCE_PG_ACCEPTANCE_URL, 'source');
  require('ts-node').register({ project: path.join(ROOT, 'backend/tsconfig.json'), transpileOnly: true });
  const { PrismaClient } = require('@prisma/client');
  const SourceClient = require(path.join(SOURCE_ROOT, 'generated/prisma')).PrismaClient;
  const db = new PrismaClient({ datasources: { db: { url: erp.url } }, log: [] });
  const sources = Array.from({ length: 3 }, () => new SourceClient({ datasources: { db: { url: source.url } }, log: [] }));
  try {
    await identity(db, erp); for (const client of sources) await identity(client, source);
    await stockAcceptance(db); await sourceAcceptance(sources[0]);
    await orderingAcceptance(sources[1], sources[2], sources[0]);
    console.log(JSON.stringify({ status: 'PASS', checks: checks.length, covered: checks, businessMutationsCommitted: false, sequenceGapsPossible: true,
      actualCarrierCalled: false, paymentExecuted: false, externalInventoryPosted: false, fullWorkflowAccepted: false }));
  } finally { await Promise.allSettled([db, ...sources].map(client => client.$disconnect())); }
}
module.exports = { connection, rollback, savepoints, orderingAcceptance };
if (require.main === module) main().catch(() => {
  console.error(JSON.stringify({ status: 'FAILED', phase, checksPassed: checks.length, detail: 'Sensitive database or credential error suppressed', fullWorkflowAccepted: false }));
  process.exitCode = 1;
});
