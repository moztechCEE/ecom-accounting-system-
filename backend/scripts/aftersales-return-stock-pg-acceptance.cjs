#!/usr/bin/env node
/* Opt-in, fixed DEV proxy, entirely new synthetic company. All business changes
 * (including role grants and real service IN/RESERVE/OUT) roll back. No HTTP,
 * source/LINE/bank/carrier/invoice/ECOUNT clients. Credentials stay in env. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { connection, rollback, savepoints } = require('./aftersales-dev-pg-acceptance.cjs');
const checks = [];
let phase = 'guard';
async function check(name, fn) { phase = name; await fn(); checks.push(name); }
function guard(env) {
  assert.equal(env.AFTERSALES_RETURN_STOCK_PG_ACCEPTANCE, 'true', 'Explicit rollback-only DEV opt-in required');
  return connection(env.ERP_PG_ACCEPTANCE_URL, 'erp');
}
function documents() {
  const check = { name: 'SYNTHETIC power', result: 'PASS', observation: 'SYNTHETIC PASS' };
  return { repairInspection: { number: 'SYNTHETIC-I', status: 'SUBMITTED', revision: 2, data: {
    complaint: 'SYNTHETIC QA RETURN', reproduction: 'YES', testConditions: 'SYNTHETIC BENCH', diagnosis: 'SYNTHETIC CONTACT', causeStatus: 'CONFIRMED',
    plan: 'REPAIR', planNote: 'SYNTHETIC CLEAN', feeSuggestion: 'FREE', estimateNote: '', checks: [check],
  } }, repairReport: { number: 'SYNTHETIC-R', status: 'SUBMITTED', revision: 1, inspectionRevision: 2, data: {
    outcome: 'REPAIRED', workPerformed: 'SYNTHETIC CLEAN', parts: [], laborMinutes: 1, checks: [check],
    qcResult: 'PASS', qcNotes: 'SYNTHETIC PASS', deliveredAccessories: 'SYNTHETIC COMPLETE',
  } } };
}
async function acceptance(client) {
  const { AfterSalesStockService } = require('../src/modules/integration/after-sales/after-sales-stock.service.ts');
  const { AuthService } = require('../src/modules/auth/auth.service.ts');
  const { UsersService } = require('../src/modules/users/users.service.ts');
  const { EntityAccessService } = require('../src/common/entity-access/entity-access.service.ts');
  const token = randomUUID().replaceAll('-', '').slice(0, 12);
  const entityId = randomUUID(), ownerId = randomUUID(), clerkId = randomUUID(), firstClerkId = randomUUID(), techId = randomUUID();
  const roleIds = [randomUUID(), randomUUID(), randomUUID()];
  await rollback(client, async tx => {
    const step = savepoints(tx);
    let beforeTransaction, failUnit = false;
    const db = new Proxy(tx, { get(target, key) {
      if (key === '$transaction') return async callback => {
        const hook = beforeTransaction; beforeTransaction = undefined;
        const fail = failUnit; failUnit = false;
        return step(actual => callback(!fail ? actual : new Proxy(actual, { get(inner, name) {
          if (name === 'afterSalesStockUnit') return new Proxy(inner[name], { get(delegate, method) {
            return method === 'create' ? async () => { throw new Error('SYNTHETIC UNIT INSERT FAILURE'); } : Reflect.get(delegate, method);
          } });
          return Reflect.get(inner, name);
        } })), hook);
      };
      return Reflect.get(target, key);
    } });
    const access = new EntityAccessService(db), users = new UsersService(db, access);
    const stock = new AfterSalesStockService(db, new AuthService(users, null, null, null, db), access, { get: () => 'false' });
    await tx.entity.create({ data: { id: entityId, loginCode: 'RTNQA' + token, name: 'SYNTHETIC RETURN STOCK ROLLBACK QA', country: 'TW', baseCurrency: 'TWD' } });
    const foreign = await tx.entity.create({ data: { loginCode: 'RTNQAF' + token, name: 'SYNTHETIC FOREIGN QA', country: 'TW', baseCurrency: 'TWD' } });
    const resources = ['after_sales_stock', 'mailroom', 'repair_workbench'];
    const permissions = await tx.permission.findMany({ where: { resource: { in: resources }, action: { in: ['read', 'update'] } }, select: { id: true, resource: true, action: true } });
    for (let index = 0; index < resources.length; index++) {
      const grants = permissions.filter(p => p.resource === resources[index]);
      assert.equal(grants.length, 2, 'Existing reviewed permissions required');
      await tx.role.create({ data: { id: roleIds[index], code: 'RETURN_PG_QA_' + index + '_' + token, name: 'SYNTHETIC RETURN PG QA ' + index + ' ' + token, permissions: { create: grants.map(p => ({ permissionId: p.id })) } } });
    }
    for (const [id, roleId] of [[ownerId, roleIds[0]], [clerkId, roleIds[1]], [firstClerkId, roleIds[1]], [techId, roleIds[2]]])
      await tx.user.create({ data: { id, email: 'synthetic-return-' + id + '@example.invalid', passwordHash: 'SYNTHETIC_UNUSABLE_PASSWORD', name: 'SYNTHETIC QA', inventoryDataScope: id === ownerId ? 'ENTITY' : 'SELF',
        roles: { create: { roleId } }, entityMemberships: { create: { entityId, isPrimary: true } } } });
    const warehouse = await tx.warehouse.create({ data: { entityId, code: 'RTNQA', name: 'SYNTHETIC QA DESTINATION' } });
    const oldWarehouse = await tx.warehouse.create({ data: { entityId, code: 'RTNQA_OLD', name: 'SYNTHETIC OLD SHIPPING AREA' } });
    const products = await Promise.all(['new', 'sold', 'nonserial'].map(kind => tx.product.create({ data: { entityId, sku: 'RTNQA-' + kind + '-' + token, name: 'SYNTHETIC RETURN ' + kind, hasSerialNumbers: kind !== 'nonserial' } })));
    const sources = [];
    for (const [index, product] of products.entries()) {
      const receipt = await tx.mailroomReceipt.create({ data: { entityId, number: 'RTNQA-' + index + '-' + token, category: 'RETURN', sourceCaseId: 'synthetic-return-' + index + '-' + token,
        receivedById: firstClerkId, requestId: randomUUID(), requestHash: 'SYNTHETIC QA ONLY' } });
      const source = await tx.mailroomItem.create({ data: { entityId, receiptId: receipt.id, label: 'SYNTHETIC RETURN ' + index, productName: product.name, sku: product.sku, serialNumber: index === 2 ? null : 'RTNQA-SN-' + index + '-' + token,
        status: 'PENDING_WELFARE_STOCK', grade: 'C', matchResult: 'MATCH', custodianId: clerkId, location: 'SYNTHETIC SIGNED CLERK AREA',
        declared: { id: 'synthetic-line-' + index + '-' + token, quantity: 1, sku: product.sku }, ...documents() } });
      sources.push(source);
      await tx.mailroomTask.create({ data: { entityId, itemId: source.id, userId: clerkId, kind: 'RETURN_REVIEW', status: 'OPEN', version: source.version } });
    }
    const originalIn = await tx.inventoryTransaction.create({ data: { entityId, productId: products[1].id, warehouseId: oldWarehouse.id, direction: 'IN', quantity: 1,
      referenceType: 'SYNTHETIC_ORIGINAL_PURCHASE', referenceId: token, occurredAt: new Date(), reason: 'Synthetic historical purchase fixture; rollback-only' } });
    const originalOut = await tx.inventoryTransaction.create({ data: { entityId, productId: products[1].id, warehouseId: oldWarehouse.id, direction: 'OUT', quantity: 1,
      referenceType: 'SYNTHETIC_ORIGINAL_SALE', referenceId: token, occurredAt: new Date(), reason: 'Synthetic historical sale fixture; rollback-only' } });
    await tx.inventorySnapshot.create({ data: { entityId, productId: products[1].id, warehouseId: oldWarehouse.id, qtyOnHand: 0, qtyAllocated: 0, qtyAvailable: 0 } });
    const sold = await tx.inventorySerialNumber.create({ data: { entityId, productId: products[1].id, warehouseId: oldWarehouse.id, serialNumber: sources[1].serialNumber,
      status: 'SOLD', inboundRefType: 'SYNTHETIC_PURCHASE', inboundRefId: originalIn.id, outboundRefType: 'SYNTHETIC_SALE', outboundRefId: originalOut.id } });
    await tx.inventoryTransaction.create({ data: { entityId, productId: products[2].id, warehouseId: warehouse.id, direction: 'IN', quantity: 2,
      referenceType: 'SYNTHETIC_EXISTING_STOCK', referenceId: token, occurredAt: new Date(), reason: 'Other existing nonserial physical units; not the tested RETURN' } });
    await tx.inventorySnapshot.create({ data: { entityId, productId: products[2].id, warehouseId: warehouse.id, qtyOnHand: 2, qtyAllocated: 0, qtyAvailable: 2 } });
    const input = index => ({ entityId, sourceItemId: sources[index].id, productId: products[index].id, warehouseId: warehouse.id,
      requestId: randomUUID(), expectedVersion: sources[index].version, quantity: 1, confirmedItems: true, sourceLocation: sources[index].location,
      location: warehouse.name, unitLabel: 'SYNTHETIC UNIT ' + index + '-' + token, serialNumber: sources[index].serialNumber || undefined,
      ownershipReference: 'SYNTHETIC COMPANY OWNERSHIP; NO ACTUAL REFUND', inspectionReference: 'SYNTHETIC I2/R1 PASS' });
    const requests = [input(0), input(1), input(2)];
    const inCount = () => tx.inventoryTransaction.count({ where: { entityId, direction: 'IN', referenceType: 'AFTER_SALES_RETURN' } });
    await check('normal technician cannot create stock IN', async () => { await assert.rejects(stock.receiveReturn(techId, requests[0])); assert.equal(await inCount(), 0); });
    await check('foreign company and stale source version cannot create stock IN', async () => {
      await assert.rejects(stock.receiveReturn(ownerId, { ...requests[0], entityId: foreign.id }));
      await assert.rejects(stock.receiveReturn(ownerId, { ...requests[0], expectedVersion: 999 })); assert.equal(await inCount(), 0);
    });
    await check('fresh owner revoked after preauthorization cannot create IN', async () => {
      beforeTransaction = () => tx.user.update({ where: { id: ownerId }, data: { isActive: false } });
      await assert.rejects(stock.receiveReturn(ownerId, requests[0])); assert.equal(await inCount(), 0);
      assert.equal((await tx.user.findUniqueOrThrow({ where: { id: ownerId } })).isActive, true);
    });
    await check('FAIL QC and outdated linked report cannot create IN', async () => {
      for (const patch of [{ data: { ...documents().repairReport.data, qcResult: 'FAIL' } }, { inspectionRevision: 1 }])
        await assert.rejects(step(async () => {
          await tx.mailroomItem.update({ where: { id: sources[0].id }, data: { repairReport: { ...documents().repairReport, ...patch } } });
          return stock.receiveReturn(ownerId, requests[0]);
        }));
      assert.equal(await inCount(), 0);
    });
    await check('declared quantity greater than one fails instead of guessing physical units', async () => {
      await assert.rejects(step(async () => {
        await tx.mailroomItem.update({ where: { id: sources[0].id }, data: { declared: { ...sources[0].declared, quantity: 2 } } });
        return stock.receiveReturn(ownerId, requests[0]);
      })); assert.equal(await inCount(), 0);
    });
    await check('RESERVED SN and foreign product SN cannot be received as new IN', async () => {
      await assert.rejects(step(async () => {
        await tx.inventorySerialNumber.update({ where: { id: sold.id }, data: { status: 'RESERVED' } });
        return stock.receiveReturn(ownerId, requests[1]);
      }));
      await assert.rejects(step(async () => {
        await tx.inventorySerialNumber.update({ where: { id: sold.id }, data: { productId: products[0].id } });
        return stock.receiveReturn(ownerId, requests[1]);
      })); assert.equal(await inCount(), 0);
    });
    await check('unit insert failure rolls back new IN, snapshot, SN, custody and history together', async () => {
      failUnit = true; await assert.rejects(stock.receiveReturn(ownerId, requests[0]), /SYNTHETIC UNIT INSERT FAILURE/);
      assert.equal(await inCount(), 0); assert.equal(await tx.inventorySnapshot.count({ where: { entityId, warehouseId: warehouse.id, productId: products[0].id } }), 0);
      assert.equal(await tx.inventorySerialNumber.count({ where: { entityId, serialNumber: requests[0].serialNumber } }), 0);
      assert.equal((await tx.mailroomItem.findUniqueOrThrow({ where: { id: sources[0].id } })).custodianId, clerkId);
      assert.equal(await tx.mailroomAction.count({ where: { entityId } }), 0);
    });
    const units = [];
    for (const index of [0, 1, 2]) await check((index === 2 ? 'nonserial return adds a labeled unit to two unrelated on-hand units' : index ? 'SOLD serial return preserves old movement references' : 'new serial return creates real IN without seeded on-hand') + ' and becomes qualified stock', async () => {
      const result = await stock.receiveReturn(ownerId, requests[index]); units.push(result.unit);
      const snapshot = await tx.inventorySnapshot.findUniqueOrThrow({ where: { entityId_warehouseId_productId: { entityId, warehouseId: warehouse.id, productId: products[index].id } } });
      assert.deepEqual([snapshot.qtyOnHand, snapshot.qtyAllocated, snapshot.qtyAvailable].map(String), index === 2 ? ['3', '0', '3'] : ['1', '0', '1']);
      if (index !== 2) {
        const serial = await tx.inventorySerialNumber.findUniqueOrThrow({ where: { entityId_productId_serialNumber: { entityId, productId: products[index].id, serialNumber: requests[index].serialNumber } } });
        assert.equal(serial.status, 'AVAILABLE'); assert.equal(serial.warehouseId, warehouse.id); assert.equal(serial.inboundRefId, result.inbound.inTransactionId);
        assert.equal(serial.outboundRefId, null); assert.equal(serial.outboundRefType, null);
        if (index) { assert.equal(serial.id, sold.id); assert.equal(result.inbound.previousSerial.outboundRefId, originalOut.id); assert.equal(result.inbound.previousSerial.inboundRefId, originalIn.id); }
      } else { assert.equal(result.unit.serialNumber, null); assert.equal(result.unit.inventorySerialId, null); }
      const received = await tx.mailroomItem.findUniqueOrThrow({ where: { id: sources[index].id } });
      assert.equal(received.status, 'STOCKED'); assert.equal(received.custodianId, ownerId); assert.equal(received.location, warehouse.name);
      assert.equal(received.version, requests[index].expectedVersion + 1);
      const review = await tx.mailroomTask.findFirstOrThrow({ where: { itemId: received.id, kind: 'RETURN_REVIEW' } });
      assert.equal(review.status, 'OPEN'); assert.equal(review.completedAt, null); assert.equal(review.version, received.version);
      const history = await tx.mailroomAction.findFirstOrThrow({ where: { itemId: received.id, action: 'after_sales_stock_received' } });
      assert.equal(history.snapshot.repairWorkflow.inventoryReceipt.inTransactionId, result.inbound.inTransactionId);
      assert.equal(result.unit.kind, 'REFURBISHED'); assert.equal(result.inbound.externalInventoryPosted, false);
    });
    await check('exact IN retry after custody/version changes is harmless; divergent retry cannot add stock', async () => {
      const replay = await stock.receiveReturn(ownerId, requests[1]); assert.equal(replay.duplicate, true); assert.equal(replay.unit.id, units[1].id);
      await assert.rejects(stock.receiveReturn(ownerId, { ...requests[1], location: 'SYNTHETIC OTHER LOCATION' }));
      await assert.rejects(stock.receiveReturn(ownerId, { ...requests[1], requestId: randomUUID() }));
      assert.equal((await stock.receiveReturn(ownerId, requests[2])).duplicate, true); assert.equal(await inCount(), 3);
    });
    await check('second receipt for the external single piece cannot create a second IN', async () => {
      const clone = await tx.mailroomItem.create({ data: { entityId, receiptId: sources[0].receiptId, label: 'SYNTHETIC SECOND RECEIPT', productName: products[0].name,
        sku: products[0].sku, serialNumber: sources[0].serialNumber, declared: sources[0].declared, status: 'PENDING_WELFARE_STOCK', matchResult: 'MATCH', custodianId: clerkId, location: requests[0].sourceLocation, ...documents() } });
      await assert.rejects(stock.receiveReturn(ownerId, { ...requests[0], sourceItemId: clone.id, requestId: randomUUID(), expectedVersion: clone.version, unitLabel: 'SYNTHETIC SECOND UNIT' }));
      assert.equal(await inCount(), 3);
    });
    await check('nonserial physical label cannot be reused for another declaration and failed transaction leaves prior balance', async () => {
      const clone = await tx.mailroomItem.create({ data: { entityId, receiptId: sources[2].receiptId, label: 'SYNTHETIC OTHER NONSERIAL PIECE', productName: products[2].name,
        sku: products[2].sku, declared: { ...sources[2].declared, id: 'synthetic-other-piece-' + token }, status: 'PENDING_WELFARE_STOCK', matchResult: 'MATCH',
        custodianId: clerkId, location: requests[2].sourceLocation, ...documents() } });
      await assert.rejects(stock.receiveReturn(ownerId, { ...requests[2], sourceItemId: clone.id, requestId: randomUUID(), expectedVersion: clone.version }));
      assert.equal(await inCount(), 3);
      const balance = await tx.inventorySnapshot.findUniqueOrThrow({ where: { entityId_warehouseId_productId: { entityId, productId: products[2].id, warehouseId: warehouse.id } } });
      assert.deepEqual([balance.qtyOnHand, balance.qtyAllocated, balance.qtyAvailable].map(String), ['3', '0', '3']);
    });
    for (const [index, unit] of units.entries()) {
      const receipt = await tx.mailroomReceipt.create({ data: { entityId, number: 'RTNQA-REPAIR-' + index + '-' + token, category: 'REPAIR', sourceCaseId: 'synthetic-repair-' + index + '-' + token, receivedById: clerkId, requestId: randomUUID(), requestHash: 'SYNTHETIC QA ONLY' } });
      const item = await tx.mailroomItem.create({ data: { entityId, receiptId: receipt.id, label: 'SYNTHETIC REPLACE', productName: products[index].name, sku: products[index].sku,
        serialNumber: 'SYNTHETIC DEFECTIVE ORIGINAL-' + index + '-' + token, status: 'REPAIRING', custodianId: ownerId, repairOwnerId: ownerId, location: 'SYNTHETIC BENCH',
        repairInspection: { status: 'SUBMITTED', revision: 1, data: { plan: 'REPLACE', replacementSku: products[index].sku, replacementCondition: 'REFURBISHED' } } } });
      const reservationRequest = { entityId, itemId: item.id, unitId: unit.id, requestId: randomUUID(), expectedVersion: item.version };
      const reserved = await stock.reserve(ownerId, reservationRequest);
      await check('returned unit ' + index + ' reserve replay allocates one actual SN', async () => {
        assert.equal((await stock.reserve(ownerId, reservationRequest)).id, reserved.id);
        if (unit.inventorySerialId) assert.equal((await tx.inventorySerialNumber.findUniqueOrThrow({ where: { id: unit.inventorySerialId } })).status, 'RESERVED');
      });
      const consume = () => step(t => stock.consumeForRepair(t, entityId, item, ownerId, randomUUID(), unit.serialNumber, products[index].sku, 'REFURBISHED'));
      await check('returned unit ' + index + ' formally OUT exactly once; replay and source proof retain exact identity', async () => {
        const proof = await consume(); assert.equal(proof.status, 'POSTED'); assert.equal(proof.quantity, 1); assert.equal(proof.replacementSN, unit.serialNumber);
        assert.notEqual(proof.externalStatus, 'CONFIRMED'); assert.equal((await consume()).postingId, proof.postingId);
        const scope = { entityId, productId: products[index].id, warehouseId: warehouse.id };
        assert.equal(await tx.inventoryTransaction.count({ where: { ...scope, direction: 'IN', referenceType: 'AFTER_SALES_RETURN' } }), 1);
        assert.equal(await tx.inventoryTransaction.count({ where: { ...scope, direction: 'OUT' } }), 1);
        const snapshot = await tx.inventorySnapshot.findUniqueOrThrow({ where: { entityId_warehouseId_productId: scope } });
        assert.deepEqual([snapshot.qtyOnHand, snapshot.qtyAllocated, snapshot.qtyAvailable].map(String), index === 2 ? ['2', '0', '2'] : ['0', '0', '0']);
        if (unit.inventorySerialId) assert.equal((await tx.inventorySerialNumber.findUniqueOrThrow({ where: { id: unit.inventorySerialId } })).status, 'SOLD');
      });
    }
  }, { isolationLevel: 'Serializable' });
  await check('all synthetic company, users, roles, physical records, IN and OUT rolled back', async () => {
    assert.equal(await client.entity.count({ where: { id: entityId } }), 0);
    assert.equal(await client.user.count({ where: { id: { in: [ownerId, clerkId, firstClerkId, techId] } } }), 0);
    assert.equal(await client.role.count({ where: { id: { in: roleIds } } }), 0);
    assert.equal(await client.inventoryTransaction.count({ where: { entityId } }), 0);
  });
}
async function main() {
  const expected = guard(process.env);
  require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: expected.url } }, log: [] });
  try {
    const [identity] = await client.$queryRawUnsafe('SELECT current_database() AS database, current_user AS db_user');
    assert.deepEqual(identity, { database: expected.database, db_user: expected.user });
    await acceptance(client);
    console.log(JSON.stringify({ status: 'PASS', checks: checks.length, covered: checks, businessMutationsCommitted: false, sourceDatabaseUsed: false,
      actualCarrierCalled: false, paymentExecuted: false, externalInventoryPosted: false, normalNativeHTTPAccepted: false }));
  } finally { await client.$disconnect(); }
}
module.exports = { guard, documents };
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ status: 'FAILED', phase, checksPassed: checks.length, detail: 'Sensitive database or credential error suppressed' })); process.exitCode = 1; });
