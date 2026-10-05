#!/usr/bin/env node
/* Fixed DEV proxy, explicit opt-in, new synthetic company only. Real Mailroom
 * create and Stock IN/RESERVE/OUT use one outer PostgreSQL transaction that is
 * always rolled back. Source snapshots alone are mocked; no source DB, HTTP,
 * notification transport, invoice, payment, carrier or ECOUNT is called.
 * QC/custody are clearly marked fixture preconditions, not workflow acceptance.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { connection, rollback, savepoints } = require('./aftersales-dev-pg-acceptance.cjs');
const { documents } = require('./aftersales-return-stock-pg-acceptance.cjs');

const checks = [];
let phase = 'guard';
async function check(name, fn) { phase = name; await fn(); checks.push(name); }
function guard(env) {
  assert.equal(env.AFTERSALES_MULTI_RETURN_PG_ACCEPTANCE, 'true', 'Explicit rollback-only DEV opt-in required');
  const expected = connection(env.ERP_PG_ACCEPTANCE_URL, 'erp');
  const url = new URL(expected.url);
  url.searchParams.set('connection_limit', '1');
  return { ...expected, url: url.toString() };
}
function sourceSnapshot(entityId, token, kind, product, quantity = 2) {
  assert.ok(['serial', 'nonserial', 'repair', 'invalid', 'relink', 'fresh'].includes(kind));
  return {
    id: 'synthetic-multi-' + kind + '-' + token,
    number: 'SYNTHETIC-DEV-MULTI-' + kind + '-' + token,
    type: kind === 'repair' ? 'REPAIR' : 'RETURN',
    brand: 'SYNTHETIC_ROLLBACK_ONLY', version: 'synthetic-version-1', status: 'NEW',
    customerLabel: 'SYNTHETIC NO CUSTOMER', repairAllowed: false,
    releaseInfo: null, expectedQuantity: quantity, receivedQuantity: 0,
    remainingQuantity: quantity,
    items: [{ id: 'synthetic-multi-line-' + kind + '-' + token, name: product.name,
      sku: product.sku, serialNumber: null, quantity, receivedQuantity: 0, remainingQuantity: quantity }],
    // Kept only by this mock; not sent as a provider credential or personal data.
    syntheticEntityId: entityId,
  };
}
function receiptInput(entityId, source, location, serialNumbers) {
  return { entityId, requestId: randomUUID(), category: source.type, sourceCaseId: source.id, location,
    items: serialNumbers.map(serialNumber => ({ sourceItemId: source.items[0].id, productName: source.items[0].name,
      sku: source.items[0].sku, ...(serialNumber ? { serialNumber } : {}) })) };
}
async function acceptance(client) {
  const { AfterSalesStockService } = require('../src/modules/integration/after-sales/after-sales-stock.service.ts');
  const { MailroomService } = require('../src/modules/mailroom/mailroom.service.ts');
  const { AuthService } = require('../src/modules/auth/auth.service.ts');
  const { UsersService } = require('../src/modules/users/users.service.ts');
  const { EntityAccessService } = require('../src/common/entity-access/entity-access.service.ts');
  const token = randomUUID().replaceAll('-', '').slice(0, 12);
  const entityId = randomUUID(), ownerId = randomUUID(), clerkId = randomUUID();
  const roleIds = [randomUUID(), randomUUID()];
  let blockedExternalCalls = 0, sourceReads = 0;
  const externalForbidden = () => { blockedExternalCalls++; throw new Error('SYNTHETIC EXTERNAL TRANSPORT FORBIDDEN'); };
  await rollback(client, async tx => {
    const step = savepoints(tx);
    let nativeInsertFailureCountdown = 0;
    const db = new Proxy(tx, { get(target, key) {
      if (key === '$transaction') return callback => step(actual => callback(new Proxy(actual, { get(inner, delegateName) {
        if (delegateName === 'mailroomItem') return new Proxy(inner[delegateName], { get(delegate, method) {
          if (method === 'create') return async (...args) => {
            if (nativeInsertFailureCountdown && --nativeInsertFailureCountdown === 0)
              throw new Error('SYNTHETIC SECOND NATIVE INSERT FAILURE');
            return delegate.create(...args);
          };
          return Reflect.get(delegate, method);
        } });
        return Reflect.get(inner, delegateName);
      } })));
      return Reflect.get(target, key);
    } });
    const access = new EntityAccessService(db), users = new UsersService(db, access);
    const stock = new AfterSalesStockService(db, new AuthService(users, null, null, null, db), access, { get: () => 'false' });
    await tx.entity.create({ data: { id: entityId, loginCode: 'MRTQA' + token,
      name: 'SYNTHETIC MULTI RETURN ROLLBACK QA', country: 'TW', baseCurrency: 'TWD' } });
    const grantGroups = [
      ['after_sales_stock:read', 'after_sales_stock:update'],
      ['mailroom:read', 'mailroom:create', 'mailroom:update'],
    ];
    const permissions = await tx.permission.findMany({ where: { resource: { in: ['after_sales_stock', 'mailroom'] },
      action: { in: ['read', 'create', 'update'] } }, select: { id: true, resource: true, action: true } });
    for (const [index, keys] of grantGroups.entries()) {
      const grants = permissions.filter(p => keys.includes(p.resource + ':' + p.action));
      assert.equal(grants.length, keys.length, 'Existing reviewed permissions required; runner never creates permissions');
      await tx.role.create({ data: { id: roleIds[index], code: 'MULTI_RETURN_PG_QA_' + index + '_' + token,
        name: 'SYNTHETIC MULTI RETURN QA ' + index + ' ' + token,
        permissions: { create: grants.map(p => ({ permissionId: p.id })) } } });
    }
    for (const [id, roleId] of [[ownerId, roleIds[0]], [clerkId, roleIds[1]]])
      await tx.user.create({ data: { id, email: 'synthetic-multi-' + id + '@example.invalid',
        passwordHash: 'SYNTHETIC_UNUSABLE_PASSWORD', name: 'SYNTHETIC QA', inventoryDataScope: id === ownerId ? 'ENTITY' : 'SELF',
        roles: { create: { roleId } }, entityMemberships: { create: { entityId, isPrimary: true } } } });
    const warehouse = await tx.warehouse.create({ data: { entityId, code: 'MRTQA', name: 'SYNTHETIC MULTI DESTINATION' } });
    const products = await Promise.all([true, false].map(hasSerialNumbers => tx.product.create({ data: { entityId,
      sku: 'MRTQA-' + (hasSerialNumbers ? 'SN' : 'LABEL') + '-' + token, name: 'SYNTHETIC MULTI RETURN', hasSerialNumbers } })));
    const snapshots = [sourceSnapshot(entityId, token, 'serial', products[0]), sourceSnapshot(entityId, token, 'nonserial', products[1]),
      sourceSnapshot(entityId, token, 'repair', products[0]), sourceSnapshot(entityId, token, 'invalid', products[0], 0),
      sourceSnapshot(entityId, token, 'relink', products[0]), sourceSnapshot(entityId, token, 'fresh', products[0])];
    let sourceRace;
    const sync = new Proxy({ cases: async (requestedEntity, search, id) => {
      assert.equal(requestedEntity, entityId); assert.equal(search, '');
      const source = snapshots.find(value => value.id === id); assert.ok(source, 'Only this run synthetic source IDs may be read');
      sourceReads++;
      const current = structuredClone(source);
      if (sourceRace?.id === id && ++sourceRace.reads > 1) Object.assign(current, sourceRace.patch);
      return { items: [current] };
    } }, { get(target, key) { return key in target ? Reflect.get(target, key) : externalForbidden; } });
    const gateway = new Proxy({}, { get: () => externalForbidden });
    const mailroom = new MailroomService(db, gateway, sync, stock);
    // Persisted record/outbox is exercised, but transport dispatch is forbidden.
    mailroom.publish = () => undefined;
    const location = 'SYNTHETIC SIGNED CLERK AREA';
    const nativeItems = [[], []], createRequests = [[], []];
    const scopeCounts = async () => Promise.all([
      tx.mailroomReceipt.count({ where: { entityId } }), tx.mailroomItem.count({ where: { entityId } }),
      tx.mailroomAction.count({ where: { entityId } }), tx.mailroomDelivery.count({ where: { entityId } }),
      tx.inventoryTransaction.count({ where: { entityId } }), tx.afterSalesStockUnit.count({ where: { entityId } }),
    ]);
    async function rejectUnchanged(fn, matcher) {
      const before = await scopeCounts();
      await assert.rejects(step(fn), matcher);
      assert.deepEqual(await scopeCounts(), before, 'Rejected operation must leave all synthetic receipts, history, outbox and stock unchanged');
    }
    await check('batch three physical pieces cannot exceed a quantity-two source line', async () => {
      await rejectUnchanged(() => mailroom.create(clerkId, receiptInput(entityId, snapshots[0], location,
        ['MRTQA-BULK-A-' + token, 'MRTQA-BULK-B-' + token, 'MRTQA-BULK-C-' + token])), /超過來源申報數量/);
      assert.deepEqual(await scopeCounts(), [0, 0, 0, 0, 0, 0]);
    });
    await check('nonpositive source quantity cannot create a native receipt', async () => {
      await rejectUnchanged(() => mailroom.create(clerkId, receiptInput(entityId, snapshots[3], location, ['MRTQA-INVALID-' + token])), /來源申報數量/);
    });
    await check('fresh source cancellation or reduced quantity after pre-read aborts receipt atomically', async () => {
      const source = snapshots[5];
      for (const patch of [{ status: 'CANCELLED' }, { items: [{ ...source.items[0], quantity: 1 }] }]) {
        sourceRace = { id: source.id, reads: 0, patch };
        try {
          await rejectUnchanged(() => mailroom.create(clerkId, receiptInput(entityId, source, location,
            ['MRTQA-FRESH-A-' + token, 'MRTQA-FRESH-B-' + token])), /來源案件已變動|超過來源申報數量/);
          assert.equal(sourceRace.reads, 2, 'Capacity requires a fresh source read after preauthorization');
        } finally { sourceRace = undefined; }
      }
    });
    await check('second native insert failure rolls back receipt, first item, action and outbox, then the same request can succeed', async () => {
      const request = receiptInput(entityId, snapshots[5], location, ['MRTQA-ATOMIC-A-' + token, 'MRTQA-ATOMIC-B-' + token]);
      nativeInsertFailureCountdown = 2;
      await rejectUnchanged(() => mailroom.create(clerkId, request), /SYNTHETIC SECOND NATIVE INSERT FAILURE/);
      assert.equal(nativeInsertFailureCountdown, 0);
      const before = await scopeCounts();
      const retry = await mailroom.create(clerkId, request); assert.equal(retry.duplicate, false); assert.equal(retry.itemIds.length, 2);
      const after = await scopeCounts();
      assert.deepEqual(after, [before[0] + 1, before[1] + 2, before[2] + 2, before[3] + 4, before[4], before[5]]);
      const replay = await mailroom.create(clerkId, request); assert.equal(replay.duplicate, true); assert.equal(replay.id, retry.id);
      assert.deepEqual(await scopeCounts(), after);
    });
    for (const index of [0, 1]) {
      const source = snapshots[index];
      for (const piece of [0, 1]) await check((index ? 'nonserial' : 'serial') + ' legal native piece ' + (piece + 1) + ' retains the same quantity-two source identity', async () => {
        const request = receiptInput(entityId, source, location, [index ? null : 'MRTQA-SN-' + piece + '-' + token]);
        const created = await mailroom.create(clerkId, request);
        assert.equal(created.duplicate, false); assert.equal(created.itemIds.length, 1);
        const item = await tx.mailroomItem.findUniqueOrThrow({ where: { id: created.itemIds[0] }, include: { receipt: true } });
        assert.equal(item.receipt.sourceCaseId, source.id); assert.equal(item.declared.id, source.items[0].id);
        assert.equal(item.declared.quantity, 2); assert.equal(item.custodianId, clerkId);
        assert.equal(item.serialNumber, request.items[0].serialNumber || null);
        assert.equal(item.status, 'RECEIVED');
        createRequests[index].push(request); nativeItems[index].push(item);
        const before = await scopeCounts();
        const replay = await mailroom.create(clerkId, request);
        assert.equal(replay.duplicate, true); assert.equal(replay.id, created.id); assert.deepEqual(replay.itemIds, created.itemIds);
        assert.deepEqual(await scopeCounts(), before);
        await rejectUnchanged(() => mailroom.create(clerkId, { ...request, location: 'SYNTHETIC CHANGED LOCATION' }));
      });
      await check((index ? 'nonserial' : 'serial') + ' third native piece rejects before receipt/history/outbox creation', async () => {
        await rejectUnchanged(() => mailroom.create(clerkId, receiptInput(entityId, source, location, [index ? null : 'MRTQA-OVER-' + token])), /超過來源申報數量/);
      });
    }
    await check('REPAIR native receipts use the same source quantity cap and harmless exact replay', async () => {
      const source = snapshots[2];
      const request = receiptInput(entityId, source, location, ['MRTQA-REPAIR-A-' + token, 'MRTQA-REPAIR-B-' + token]);
      const created = await mailroom.create(clerkId, request); assert.equal(created.itemIds.length, 2);
      const before = await scopeCounts();
      assert.deepEqual((await mailroom.create(clerkId, request)).itemIds, created.itemIds);
      assert.deepEqual(await scopeCounts(), before);
      await rejectUnchanged(() => mailroom.create(clerkId, receiptInput(entityId, source, location, ['MRTQA-REPAIR-C-' + token])), /超過來源申報數量/);
    });
    const unmatchedRequest = serialNumber => ({ entityId, requestId: randomUUID(), category: 'UNMATCHED', location,
      items: [{ productName: products[0].name, sku: products[0].sku, serialNumber }] });
    await check('unmatched identification cannot bypass a full RETURN source-line cap or change original receipt metadata', async () => {
      const created = await mailroom.create(clerkId, unmatchedRequest('MRTQA-UNMATCHED-OVER-' + token));
      const id = created.itemIds[0];
      await rejectUnchanged(() => mailroom.command(clerkId, id, { entityId, requestId: randomUUID(), expectedVersion: 1,
        action: 'identify', targetCategory: 'RETURN', sourceCaseId: snapshots[0].id, sourceItemId: snapshots[0].items[0].id,
        note: 'SYNTHETIC CAPACITY NEGATIVE' }), /超過來源申報數量/);
      const item = await tx.mailroomItem.findUniqueOrThrow({ where: { id }, include: { receipt: true } });
      assert.equal(item.receipt.category, 'UNMATCHED'); assert.equal(item.receipt.sourceCaseId, null);
      assert.equal(item.declared, null); assert.equal(item.version, 1); assert.equal(item.status, 'RECEIVED');
    });
    await check('legal unmatched identification preserves the source line, retries exactly and leaves only one remaining native slot', async () => {
      const source = snapshots[4];
      const created = await mailroom.create(clerkId, unmatchedRequest('MRTQA-UNMATCHED-LEGAL-' + token));
      const id = created.itemIds[0];
      const command = { entityId, requestId: randomUUID(), expectedVersion: 1, action: 'identify', targetCategory: 'RETURN',
        sourceCaseId: source.id, sourceItemId: source.items[0].id, note: 'SYNTHETIC LEGAL RELINK' };
      assert.equal((await mailroom.command(clerkId, id, command)).duplicate, false);
      const before = await scopeCounts(), beforeReads = sourceReads;
      assert.equal((await mailroom.command(clerkId, id, command)).duplicate, true);
      assert.deepEqual(await scopeCounts(), before); assert.equal(sourceReads, beforeReads, 'Exact committed command retry never refetches source');
      const item = await tx.mailroomItem.findUniqueOrThrow({ where: { id }, include: { receipt: true } });
      assert.equal(item.receipt.category, 'RETURN'); assert.equal(item.receipt.sourceCaseId, source.id);
      assert.equal(item.declared.id, source.items[0].id); assert.equal(item.declared.quantity, 2); assert.equal(item.version, 2);
      await mailroom.create(clerkId, receiptInput(entityId, source, location, ['MRTQA-RELINK-SECOND-' + token]));
      const extra = await mailroom.create(clerkId, unmatchedRequest('MRTQA-RELINK-THIRD-' + token));
      await rejectUnchanged(() => mailroom.command(clerkId, extra.itemIds[0], { ...command, requestId: randomUUID() }), /超過來源申報數量/);
      assert.equal((await tx.mailroomItem.findUniqueOrThrow({ where: { id: extra.itemIds[0] }, include: { receipt: true } })).receipt.category, 'UNMATCHED');
    });
    for (const group of nativeItems) for (const item of group) {
      // Explicit fixture preparation: this runner does not claim clerk/tech/QC UI workflow acceptance.
      const updated = await tx.mailroomItem.update({ where: { id: item.id }, data: {
        status: 'PENDING_WELFARE_STOCK', matchResult: 'MATCH', grade: 'C', ...documents(), version: { increment: 1 } } });
      Object.assign(item, updated);
      await tx.mailroomTask.create({ data: { entityId, itemId: item.id, userId: clerkId, kind: 'RETURN_REVIEW', status: 'OPEN', version: item.version } });
    }
    const units = [[], []], inRequests = [[], []];
    const inbound = (index, item, label) => ({ entityId, sourceItemId: item.id, productId: products[index].id, warehouseId: warehouse.id,
      requestId: randomUUID(), expectedVersion: item.version, quantity: 1, confirmedItems: true, sourceLocation: item.location,
      location: warehouse.name, unitLabel: label, ...(item.serialNumber ? { serialNumber: item.serialNumber } : {}),
      ownershipReference: 'SYNTHETIC COMPANY OWNERSHIP; NO REFUND', inspectionReference: 'SYNTHETIC I2/R1 PASS FIXTURE' });
    const balance = async index => {
      const row = await tx.inventorySnapshot.findUniqueOrThrow({ where: { entityId_warehouseId_productId: {
        entityId, productId: products[index].id, warehouseId: warehouse.id } } });
      return [row.qtyOnHand, row.qtyAllocated, row.qtyAvailable].map(String);
    };
    // Bypass only receipt capacity for negative legacy-corruption fixtures. The
    // real StockService must independently reject these rows; each is rolled back.
    async function legacyNative(index, serialNumber, label) {
      return tx.mailroomItem.create({ data: { entityId, receiptId: nativeItems[index][0].receiptId, label,
        productName: products[index].name, sku: products[index].sku, serialNumber,
        declared: nativeItems[index][0].declared, status: 'PENDING_WELFARE_STOCK', matchResult: 'MATCH',
        grade: 'C', custodianId: clerkId, location, ...documents() } });
    }
    for (const index of [0, 1]) for (const piece of [0, 1]) {
      await check((index ? 'nonserial labeled' : 'distinct actual SN') + ' piece ' + (piece + 1) + ' creates a distinct qualified UNIT and exactly one real IN', async () => {
      const request = inbound(index, nativeItems[index][piece], 'SYNTHETIC-MULTI-UNIT-' + index + '-' + piece + '-' + token);
      if (piece) await rejectUnchanged(() => stock.receiveReturn(ownerId, { ...request, unitLabel: inRequests[index][0].unitLabel }));
      await rejectUnchanged(() => stock.receiveReturn(ownerId, { ...request, quantity: 2 }));
      const result = await stock.receiveReturn(ownerId, request);
      assert.equal(result.duplicate, false); assert.equal(result.inbound.quantity, 1);
      assert.equal(result.unit.sourceItemId, nativeItems[index][piece].id);
      assert.equal(result.inbound.sourceCaseItemId, snapshots[index].items[0].id);
      assert.equal(result.inbound.sourceCaseId, snapshots[index].id);
      assert.equal(result.inbound.externalInventoryPosted, false); assert.equal(result.unit.kind, 'REFURBISHED');
      assert.equal(result.unit.status, 'QUALIFIED');
      assert.equal(result.unit.serialNumber, nativeItems[index][piece].serialNumber);
      if (piece) assert.notEqual(result.unit.id, units[index][0].id);
      const movement = await tx.inventoryTransaction.findUniqueOrThrow({ where: { id: result.inbound.inTransactionId } });
      assert.equal(movement.direction, 'IN'); assert.equal(String(movement.quantity), '1');
      assert.equal(movement.referenceType, 'AFTER_SALES_RETURN'); assert.equal(movement.referenceId, nativeItems[index][piece].id);
      const onHand = index === 0 && piece === 1 ? 1 : piece + 1;
      assert.deepEqual(await balance(index), [String(onHand), '0', String(onHand)]);
      const stocked = await tx.mailroomItem.findUniqueOrThrow({ where: { id: nativeItems[index][piece].id } });
      assert.equal(stocked.status, 'STOCKED'); assert.equal(stocked.custodianId, ownerId);
      const task = await tx.mailroomTask.findFirstOrThrow({ where: { itemId: stocked.id, kind: 'RETURN_REVIEW' } });
      assert.equal(task.status, 'OPEN'); assert.equal(task.completedAt, null); assert.equal(task.version, stocked.version);
      const replay = await stock.receiveReturn(ownerId, request); assert.equal(replay.duplicate, true); assert.equal(replay.unit.id, result.unit.id);
      inRequests[index].push(request); units[index].push(result.unit);
      });
      if (index === 0 && piece === 0) {
        await check('first SN reserves then formally OUT once while one source-line slot remains', async () => {
          const repairReceipt = await tx.mailroomReceipt.create({ data: { entityId, number: 'MRTQA-REPLACEMENT-' + token, category: 'REPAIR',
            sourceCaseId: 'synthetic-multi-replacement-' + token, receivedById: clerkId, requestId: randomUUID(), requestHash: 'SYNTHETIC ONLY' } });
          const target = await tx.mailroomItem.create({ data: { entityId, receiptId: repairReceipt.id, label: 'SYNTHETIC REPLACEMENT TARGET',
            productName: products[0].name, sku: products[0].sku, serialNumber: 'MRTQA-DEFECTIVE-' + token,
            status: 'REPAIRING', custodianId: ownerId, repairOwnerId: ownerId, location: 'SYNTHETIC BENCH',
            repairInspection: { status: 'SUBMITTED', revision: 1, data: { plan: 'REPLACE', replacementSku: products[0].sku, replacementCondition: 'REFURBISHED' } } } });
          const request = { entityId, itemId: target.id, unitId: units[0][0].id, requestId: randomUUID(), expectedVersion: target.version };
          const reserved = await stock.reserve(ownerId, request);
          assert.equal((await stock.reserve(ownerId, request)).id, reserved.id);
          assert.deepEqual(await balance(0), ['1', '1', '0']);
          const consume = () => step(actual => stock.consumeForRepair(actual, entityId, target, ownerId, randomUUID(), units[0][0].serialNumber, products[0].sku, 'REFURBISHED'));
          const proof = await consume(); assert.equal(proof.status, 'POSTED'); assert.equal(proof.quantity, 1);
          assert.equal((await consume()).postingId, proof.postingId);
          assert.deepEqual(await balance(0), ['0', '0', '0']);
          assert.equal((await tx.afterSalesStockUnit.findUniqueOrThrow({ where: { id: units[0][0].id } })).status, 'CONSUMED');
          assert.equal((await tx.inventorySerialNumber.findUniqueOrThrow({ where: { id: units[0][0].inventorySerialId } })).status, 'SOLD');
          assert.equal(await tx.inventoryTransaction.count({ where: { entityId, direction: 'OUT' } }), 1);
        });
        await check('permanent same-source SOLD-SN guard rejects with genuine quantity-two spare capacity', async () => {
          await rejectUnchanged(async () => {
            const duplicate = await legacyNative(0, units[0][0].serialNumber, 'SYNTHETIC LEGACY SOLD DUPLICATE BEFORE SECOND IN');
            return stock.receiveReturn(ownerId, inbound(0, duplicate, 'SYNTHETIC SOLD DUPLICATE UNIT-' + token));
          }, /同一來源品項的序號已正式入庫/);
          assert.equal(await tx.afterSalesStockUnit.count({ where: { entityId } }), 1);
          assert.deepEqual(await balance(0), ['0', '0', '0']);
        });
      }
    }
    for (const index of [0, 1]) await check((index ? 'nonserial' : 'serial') + ' independent IN source-line cap rejects a third legacy native piece', async () => {
      await rejectUnchanged(async () => {
        const third = await legacyNative(index, index ? null : 'MRTQA-THIRD-' + token, 'SYNTHETIC LEGACY THIRD');
        return stock.receiveReturn(ownerId, inbound(index, third, 'SYNTHETIC LEGACY THIRD UNIT-' + token));
      });
      assert.deepEqual(await balance(index), index ? ['2', '0', '2'] : ['1', '0', '1']);
    });
    await check('same source/line SOLD SN cannot create a third IN and consumed units still count toward capacity', async () => {
      await rejectUnchanged(async () => {
        const duplicate = await legacyNative(0, units[0][0].serialNumber, 'SYNTHETIC LEGACY SOLD DUPLICATE');
        return stock.receiveReturn(ownerId, inbound(0, duplicate, 'SYNTHETIC SOLD DUPLICATE UNIT-' + token));
      });
      await rejectUnchanged(async () => {
        const third = await legacyNative(0, 'MRTQA-POST-OUT-THIRD-' + token, 'SYNTHETIC LEGACY THIRD AFTER OUT');
        return stock.receiveReturn(ownerId, inbound(0, third, 'SYNTHETIC POST-OUT THIRD UNIT-' + token));
      });
      await rejectUnchanged(() => mailroom.create(clerkId, receiptInput(entityId, snapshots[0], location, ['MRTQA-NATIVE-POST-OUT-' + token])));
      assert.deepEqual(await balance(0), ['1', '0', '1']);
      const replay = await stock.receiveReturn(ownerId, inRequests[0][0]);
      assert.equal(replay.duplicate, true); assert.equal(replay.unit.id, units[0][0].id); assert.equal(replay.unit.status, 'CONSUMED');
    });
    await check('four INs, one OUT, two source lines, four immutable unit identities and no external dispatch', async () => {
      assert.equal(await tx.inventoryTransaction.count({ where: { entityId, direction: 'IN', referenceType: 'AFTER_SALES_RETURN' } }), 4);
      assert.equal(await tx.inventoryTransaction.count({ where: { entityId, direction: 'OUT', referenceType: 'AFTER_SALES_REPLACEMENT' } }), 1);
      assert.equal(await tx.afterSalesStockUnit.count({ where: { entityId } }), 4);
      assert.equal(new Set(units.flat().map(unit => unit.id)).size, 4);
      assert.equal(new Set(units.flat().map(unit => unit.unitLabel)).size, 4);
      assert.equal((await tx.afterSalesStockUnit.findUniqueOrThrow({ where: { id: units[0][1].id } })).status, 'QUALIFIED');
      assert.equal((await tx.inventorySerialNumber.findUniqueOrThrow({ where: { id: units[0][1].inventorySerialId } })).status, 'AVAILABLE');
      assert.deepEqual(await balance(0), ['1', '0', '1']); assert.deepEqual(await balance(1), ['2', '0', '2']);
      assert.ok(sourceReads > 0); assert.equal(blockedExternalCalls, 0);
    });
  }, { isolationLevel: 'Serializable' });
  await check('synthetic company, users, roles, receipts, tasks, outbox, stock, serials and movements all rolled back', async () => {
    assert.equal(await client.entity.count({ where: { id: entityId } }), 0);
    assert.equal(await client.user.count({ where: { id: { in: [ownerId, clerkId] } } }), 0);
    assert.equal(await client.role.count({ where: { id: { in: roleIds } } }), 0);
    for (const delegate of ['product', 'warehouse', 'mailroomReceipt', 'mailroomItem', 'mailroomTask', 'mailroomAction', 'mailroomDelivery',
      'afterSalesStockUnit', 'afterSalesStockReservation', 'inventoryTransaction', 'inventorySnapshot', 'inventorySerialNumber'])
      assert.equal(await client[delegate].count({ where: { entityId } }), 0);
  });
}
async function main() {
  const expected = guard(process.env);
  require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: expected.url } }, log: [] });
  const priorEnabled = process.env.MAILROOM_ENABLED;
  process.env.MAILROOM_ENABLED = 'true';
  try {
    const [identity] = await client.$queryRawUnsafe('SELECT current_database() AS database, current_user AS db_user');
    assert.deepEqual(identity, { database: expected.database, db_user: expected.user });
    await acceptance(client);
    console.log(JSON.stringify({ status: 'PASS', checks: checks.length, covered: checks,
      businessMutationsCommitted: false, sourceDatabaseUsed: false, sourceSnapshotMocked: true,
      notificationDispatched: false, paymentExecuted: false, invoiceIssued: false, actualCarrierCalled: false,
      externalInventoryPosted: false, normalNativeHTTPAccepted: false, completeRefurbishmentWorkflowAccepted: false,
      concurrencyAccepted: false }));
  } finally {
    if (priorEnabled === undefined) delete process.env.MAILROOM_ENABLED; else process.env.MAILROOM_ENABLED = priorEnabled;
    await client.$disconnect();
  }
}
module.exports = { guard, sourceSnapshot, receiptInput };
if (require.main === module) main().catch(() => {
  console.error(JSON.stringify({ status: 'FAILED', phase, checksPassed: checks.length, detail: 'Sensitive database or credential error suppressed',
    businessMutationsCommitted: false, normalNativeHTTPAccepted: false }));
  process.exitCode = 1;
});
