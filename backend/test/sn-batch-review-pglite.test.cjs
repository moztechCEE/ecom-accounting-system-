// Compile backend first; point at an installed @electric-sql/pglite package.
// Runs the actual service and SQL migrations on a disposable in-process database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const modulePath = process.env.SN_BATCH_REVIEW_PGLITE;
const taipeiDay = (time) => new Date(time.getTime() + 8 * 3600000).toISOString().slice(0, 10);

test('review uses the actual migration and service transaction contracts', { skip: !modulePath }, async (t) => {
  const { PGlite } = require(resolve(modulePath));
  const { SnLabelBatchReviewService } = require('../dist/src/modules/sn-labels/sn-label-batch-review');
  const { SnLabelsService } = require('../dist/src/modules/sn-labels/sn-labels.service');
  const engine = new PGlite();
  t.after(() => engine.close());
  await engine.exec('CREATE TABLE inventory_serial_numbers (entity_id TEXT, product_id TEXT, serial_number TEXT)');
  for (const name of ['20260922000000_sn_labels', '20261111110000_sn_label_batch_review', '20261118120000_sn_label_direct_return']) {
    await engine.exec(readFileSync(join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'), 'utf8'));
  }
  const raw = (db) => (parts, ...params) => db.query(parts.reduce(
    (sql, part, index) => sql + (index ? '$' + index : '') + part, '',
  ), params);
  const wrap = (db) => ({
    $queryRaw: async (...args) => (await raw(db)(...args)).rows,
    $executeRaw: async (...args) => (await raw(db)(...args)).affectedRows,
    product: { findFirst: async ({ where }) => where.entityId === 'company'
      ? { sku: where.id, barcode: '0471000000001' } : null },
  });
  const db = { ...wrap(engine), $transaction: (fn) => engine.transaction((tx) => fn(wrap(tx))) };
  const review = new SnLabelBatchReviewService(db);
  const labels = new SnLabelsService(db, { pdf: async () => Buffer.alloc(0) }, review);
  const orderDate = taipeiDay(new Date(Date.now() - 2 * 86400000));
  const form = (sku, noSerial = false, quantity = 2) => ({
    name: sku, sku, productId: sku, productName: sku, barcode: '0471000000001',
    model: sku, style: '', color: '', modelCode: noSerial ? 'NSI' : sku,
    styleCode: '', colorCode: 'R', orderDate, manufactureDate: orderDate,
    quantity, capacity: 2, label: {
      width: 28, height: 7.5, showQr: false, target: 'box',
      textX: 1, textY: 1, fontSize: 1.5, qrX: 0, qrY: 0, qrSize: 6,
    },
  });
  const activate = async (id, data) => {
    const draft = await labels.save('company', 'operator', id, { revision: 0, data });
    const activated = await labels.activate('company', 'operator', id, draft.revision);
    return labels.detail('company', activated.batchId);
  };
  const evidence = () => ({
    decision: 'approve', reason: 'Synthetic supervisor verification',
    receipt: {
      checkedAt: new Date().toISOString(), company: 'DEV-CO', warehouses: 'DEV-WH',
      purchaseSource: 'DEV-PO', itemCode: 'DEV-ITEM', bindingReference: 'DEV-BINDING',
      reportReference: 'DEV-ECOUNT-QUERY', from: orderDate, to: taipeiDay(new Date()),
      receivedQuantity: 0, fullScope: true,
    },
    usage: {
      checkedAt: new Date().toISOString(), wmsReference: 'DEV-WMS-SEARCH',
      wmsState: 'not-found', labelsState: 'not-issued',
      physicalReference: 'DEV-LABEL-REVIEW', holdConfirmed: true,
    },
  });
  const request = (batch) => review.request('company', 'operator', batch.id, {
    batchRevision: batch.batchRevision, reason: 'Synthetic correction',
  });
  const count = async (sql, params = []) => (await engine.query(sql, params)).rows[0].n;
  const inbound = (batch, status) => engine.query(
    "INSERT INTO sn_label_events(id,entity_id,batch_id,actor_id,action,data) VALUES ($1,'company',$2,'receiver','INBOUND_STATUS_RECORDED',$3::jsonb)",
    [require('node:crypto').randomUUID(), batch.id, JSON.stringify({ status, source: 'fixture' })],
  );
  const direct = (batch, actor = 'operator', reason = 'Reason-only correction') =>
    review.returnToDraft('company', actor, batch.id, { batchRevision: batch.batchRevision, reason });

  await t.test('whole merged batch: locks edits, retains ownership, restores each draft without rewinding', async () => {
    const d = form('AAA');
    const first = await activate('first', d);
    const batch = await activate('second', { ...d, quantity: 3 });
    assert.equal(batch.id, first.id);
    assert.equal(batch.data.quantity, 5);
    assert.equal(batch.cartons, 3);
    const version = { ...batch, batchRevision: 'stale' };
    await assert.rejects(request(version), /批次已更新/);
    await assert.rejects(review.request('other-company', 'operator', batch.id, {
      batchRevision: batch.batchRevision, reason: 'Cross-company',
    }), /找不到/);
    await review.recordOutput('company', 'operator', batch.id, { kind: 'warehouse' });
    const pending = await request(batch);
    assert.equal((await request(batch)).id, pending.id);
    await assert.rejects(labels.preview('company', d), /暫停追加/);
    await assert.rejects(review.recordOutput('company', 'operator', batch.id, {}), /暫停輸出/);
    const legacyOutput = () => engine.query(
      "INSERT INTO sn_label_events(id,entity_id,batch_id,actor_id,action,data) VALUES ('legacy','company',$1,'operator','EXPORT','{}')",
      [batch.id],
    );
    const legacyAppend = () => engine.query(
      'UPDATE sn_label_batches SET quantity=quantity+1 WHERE id=$1', [batch.id],
    );
    await assert.rejects(legacyOutput(), /output blocked by reversion review/);
    await assert.rejects(legacyAppend(), /append blocked by reversion review/);
    await assert.rejects(review.decide('company', 'operator', batch.id, pending.id, evidence()), /不得覆核/);
    const incomplete = evidence();
    incomplete.receipt.reportReference = '';
    await assert.rejects(review.decide('company', 'supervisor', batch.id, pending.id, incomplete), /進貨查詢結果/);
    await assert.rejects(review.decide('company', 'supervisor', batch.id, pending.id, evidence()), /已輸出檔案/);
    assert.equal((await review.read(batch.id)).state, 'pending');
    const complete = evidence();
    complete.usage.labelsState = 'verified-unused';
    const result = await review.decide('company', 'supervisor', batch.id, pending.id, complete);
    assert.equal(result.state, 'approved');
    assert.equal(result.replacementDraftIds.length, 2);
    assert.equal((await labels.detail('company', batch.id)).status, 'retired');
    assert.equal(await count('SELECT COUNT(*)::int AS n FROM sn_label_serials WHERE batch_id=$1', [batch.id]), 5);
    assert.equal(await count('SELECT COUNT(*)::int AS n FROM sn_label_drafts WHERE batch_id=$1', [batch.id]), 2);
    assert.equal(await count('SELECT COUNT(*)::int AS n FROM sn_label_drafts WHERE id=ANY($1) AND batch_id IS NULL', [result.replacementDraftIds]), 2);
    assert.equal(await count('SELECT COUNT(*)::int AS n FROM sn_label_events WHERE batch_id=$1 AND action=$2', [batch.id, 'EXPORT']), 1);
    assert.equal((await engine.query('SELECT last_value FROM sn_label_counters')).rows[0].last_value, 5);
    await assert.rejects(review.recordOutput('company', 'operator', batch.id, {}), /已退回/);
    await assert.rejects(legacyOutput(), /output blocked by reversion review/);
    await assert.rejects(legacyAppend(), /append blocked by reversion review/);
    const reactivated = await labels.activate('company', 'operator', result.replacementDraftIds[0], 1);
    assert.notEqual(reactivated.batchId, batch.id);
    assert.equal(reactivated.first, 6);
    const newDetails = await labels.detail('company', reactivated.batchId);
    assert.match(newDetails.boxes[0].id, /-004$/);
    await assert.rejects(review.decide('company', 'supervisor', batch.id, pending.id, complete), /已覆核/);
  });

  await t.test('partial ECOUNT receipt blocks the whole no-SN batch and survives review retries', async () => {
    const batch = await activate('partial', form('BBB', true, 4));
    const pending = await request(batch);
    const check = evidence();
    check.decision = 'received';
    check.receipt.receivedQuantity = 1;
    check.receipt.receiptReference = 'DEV-RECEIPT-PARTIAL';
    const result = await review.decide('company', 'supervisor', batch.id, pending.id, check);
    assert.equal(result.state, 'blocked');
    assert.equal(result.blocker, 'ECOUNT_RECEIVED');
    assert.deepEqual(result.replacementDraftIds, []);
    assert.equal((await labels.detail('company', batch.id)).status, 'active');
    await assert.rejects(request(batch), /已有收貨或使用/);
  });

  await t.test('confirmed WMS use and exact ERP SN independently prevent rollback', async () => {
    const wmsBatch = await activate('wms', form('CCC', true));
    const wmsPending = await request(wmsBatch);
    const check = evidence();
    check.decision = 'used';
    check.usage.wmsState = 'used';
    assert.equal((await review.decide('company', 'supervisor', wmsBatch.id, wmsPending.id, check)).blocker, 'WMS_USED');
    assert.equal((await engine.query('SELECT evidence FROM sn_label_batch_reversions WHERE id=$1',
      [wmsPending.id])).rows[0].evidence.usage.usageSource, 'wms');
    const snBatch = await activate('local', form('DDD'));
    const snPending = await request(snBatch);
    await engine.query('INSERT INTO inventory_serial_numbers VALUES ($1,$2,$3)', [
      'company', 'DDD', snBatch.boxes[0].serials[0],
    ]);
    assert.equal((await review.decide('company', 'supervisor', snBatch.id, snPending.id, evidence())).blocker, 'ERP_SERIAL_IN_USE');
    assert.equal((await labels.detail('company', snBatch.id)).status, 'active');
  });

  await t.test('documented physical use outside WMS is terminal without guessing receipt state', async () => {
    const batch = await activate('physical', form('EEE', true));
    const pending = await request(batch);
    const check = {
      decision: 'used', reason: 'Synthetic physical issue', usage: {
        checkedAt: new Date().toISOString(), usageSource: 'physical',
        physicalReference: 'DEV-PHYSICAL-ISSUE',
      },
    };
    const result = await review.decide('company', 'supervisor', batch.id, pending.id, check);
    assert.equal(result.blocker, 'PHYSICAL_USED');
    assert.deepEqual(result.replacementDraftIds, []);
    const saved = (await engine.query('SELECT evidence FROM sn_label_batch_reversions WHERE id=$1',
      [pending.id])).rows[0].evidence;
    assert.equal(saved.usage.usageSource, 'physical');
    assert.equal(saved.usage.physicalReference, 'DEV-PHYSICAL-ISSUE');
    assert.equal(saved.receipt, undefined);
    assert.equal((await labels.detail('company', batch.id)).status, 'active');
    await assert.rejects(request(batch), /已有收貨或使用/);
  });

  await t.test('direct return requires a known unreceived state and retains original identifiers on retry', async () => {
    const batch = await activate('direct', form('FFF'));
    assert.equal(batch.receivingStatus, 'unconfirmed');
    await assert.rejects(direct(batch), /確認此批次的入庫狀態/);
    await inbound(batch, 'not-received');
    assert.equal((await labels.detail('company', batch.id)).receivingStatus, 'not-received');
    const serials = batch.boxes.flatMap(box => box.serials);
    const cartonIds = batch.boxes.map(box => box.id);
    const first = await direct(batch);
    assert.equal(first.state, 'approved');
    assert.equal(first.requestedBy, 'operator');
    assert.equal(first.reviewedBy, 'operator');
    assert.equal(first.replacementDraftIds.length, 1);
    assert.deepEqual(await direct(batch), first);
    assert.equal(await count('SELECT COUNT(*)::int AS n FROM sn_label_drafts WHERE id=ANY($1)', [first.replacementDraftIds]), 1);
    assert.deepEqual((await labels.detail('company', batch.id)).boxes.map(box => box.id), cartonIds);
    assert.deepEqual((await labels.detail('company', batch.id)).boxes.flatMap(box => box.serials), serials);
    await assert.rejects(engine.query('INSERT INTO inventory_serial_numbers VALUES ($1,$2,$3)', [
      'company', 'FFF', serials[0],
    ]), /retired batch cannot receive stock/);
    await assert.rejects(inbound(batch, 'received'), /retired batch cannot receive stock/);
    await assert.rejects(direct(batch, 'someone-else'), /已退回/);
    await assert.rejects(direct(batch, 'operator', 'different reason'), /已退回/);
    const next = await labels.activate('company', 'operator', first.replacementDraftIds[0], 1);
    assert.ok(next.first > batch.last);
  });

  await t.test('an old pending request can be completed directly by its requester without changing the original request', async () => {
    const batch = await activate('pending-direct', form('GGG', true));
    const pending = await request(batch);
    await inbound(batch, 'not-received');
    const result = await direct(batch, 'operator', 'New direct correction');
    assert.equal(result.state, 'approved');
    assert.notEqual(result.id, pending.id);
    assert.equal(result.reason, 'New direct correction');
    const saved = (await engine.query('SELECT * FROM sn_label_batch_reversions WHERE id=$1', [pending.id])).rows[0];
    assert.equal(saved.request_reason, pending.reason);
    assert.equal(saved.requested_by, 'operator');
    assert.equal(saved.state, 'rejected');
    assert.equal(saved.evidence.method, 'superseded-by-direct-return');
    assert.equal(saved.evidence.directReturnId, result.id);
    assert.equal((await review.read(batch.id)).id, result.id);
    assert.equal(await count("SELECT COUNT(*)::int AS n FROM sn_label_batch_reversions WHERE batch_id=$1 AND state='pending'", [batch.id]), 0);
  });

  await t.test('received evidence stays authoritative across later negative markers and legacy decisions', async () => {
    const marked = await activate('marked-received', form('HHH', true));
    const pending = await request(marked);
    await inbound(marked, 'received');
    await assert.rejects(inbound(marked, 'not-received'), /already received/);
    assert.equal((await labels.detail('company', marked.id)).receivingStatus, 'received');
    await assert.rejects(direct(marked), /已入庫，不可退回/);
    assert.equal((await review.decide('company', 'supervisor', marked.id, pending.id, evidence())).state, 'blocked');
    const local = await activate('local-direct', form('III'));
    await inbound(local, 'not-received');
    await engine.query('INSERT INTO inventory_serial_numbers VALUES ($1,$2,$3)', [
      'company', 'III', local.boxes[0].serials[0],
    ]);
    assert.equal((await labels.detail('company', local.id)).receivingStatus, 'received');
    await assert.rejects(direct(local), /已入庫，不可退回/);
    await engine.query('DELETE FROM inventory_serial_numbers WHERE entity_id=$1 AND product_id=$2', ['company', 'III']);
    assert.equal((await labels.detail('company', local.id)).receivingStatus, 'received');
    await assert.rejects(inbound(local, 'not-received'), /already received/);
    const list = await labels.list('company', {});
    assert.equal(list.rows.find(row => row.id === marked.id).receivingStatus, 'received');
    assert.equal(list.rows.find(row => row.id === local.id).receivingStatus, 'received');
    assert.deepEqual(await review.receivingStates('other-company', [marked.id]), new Map());
  });
});
