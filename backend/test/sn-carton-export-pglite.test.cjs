// Compile backend first and set SN_BATCH_REVIEW_PGLITE to an installed PGlite package.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const XLSX = require('xlsx');

test('complete SN and non-SN carton export uses actual SQL and preserves all workbook rows', {
  skip: !process.env.SN_BATCH_REVIEW_PGLITE,
}, async t => {
  const { PGlite } = require(resolve(process.env.SN_BATCH_REVIEW_PGLITE));
  const { SnLabelsService } = require('../dist/src/modules/sn-labels/sn-labels.service');
  const { SnLabelsExport } = require('../dist/src/modules/sn-labels/sn-labels.export');
  const { SnLabelBatchReviewService } = require('../dist/src/modules/sn-labels/sn-label-batch-review');
  const engine = new PGlite();
  t.after(() => engine.close());
  await engine.exec('CREATE TABLE inventory_serial_numbers (entity_id TEXT, product_id TEXT, serial_number TEXT)');
  for (const name of ['20260922000000_sn_labels', '20261111110000_sn_label_batch_review', '20261118120000_sn_label_direct_return']) {
    await engine.exec(readFileSync(join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'), 'utf8'));
  }
  const raw = db => (parts, ...params) => db.query(parts.reduce((sql, part, i) => sql + (i ? '$' + i : '') + part, ''), params);
  const wrap = db => ({
    $queryRaw: async (...args) => (await raw(db)(...args)).rows,
    $executeRaw: async (...args) => (await raw(db)(...args)).affectedRows,
    product: { findFirst: async ({ where }) => where.entityId === 'company' ? { sku: where.id, barcode: '0471000000001' } : null },
  });
  const db = { ...wrap(engine), $transaction: fn => engine.transaction(tx => fn(wrap(tx))) };
  const exporter = new SnLabelsExport();
  const reviews = new SnLabelBatchReviewService(db);
  const service = new SnLabelsService(db, { pdf: async () => Buffer.alloc(0) }, reviews);
  for (const hasSN of [true, false]) await t.test(hasSN ? '102 cartons / 10,101 serials' : '10,001 cartons without serials', async () => {
    const sku = hasSN ? 'EXP' : 'NSI';
    const form = { name: sku, sku, productId: sku, productName: sku, barcode: '0471000000001',
      model: sku, style: '', color: '', modelCode: sku, styleCode: '', colorCode: 'W',
      orderDate: '2026-11-19', manufactureDate: '2026-11-19', capacity: hasSN ? 100 : 1,
      label: { width: 28, height: 7.5, showQr: false, target: 'box', textX: 1, textY: 1, fontSize: 1.5, qrX: 0, qrY: 0, qrSize: 6 } };
    const activate = async quantity => {
      const draft = randomUUID();
      const saved = await service.save('company', 'operator', draft, { revision: 0, data: { ...form, quantity } });
      return service.activate('company', 'operator', draft, saved.revision);
    };
    const { batchId } = await activate(10000);
    assert.equal((await activate(hasSN ? 101 : 1)).batchId, batchId);
    const before = await service.detail('company', batchId);
    const expected = (await engine.query(`SELECT c.id,c.quantity,COALESCE((SELECT jsonb_agg(s.sn ORDER BY s.position)
      FROM sn_label_serials s WHERE s.carton_id=c.id),'[]'::jsonb) AS serials
      FROM sn_label_cartons c WHERE c.batch_id=$1 ORDER BY c.ordinal`, [batchId])).rows;
    assert.equal(expected.length, hasSN ? 102 : 10001);
    const verify = async (from, to, selected) => {
      const payload = await service.exportData('company', batchId, from, to, 'warehouse-cartons');
      const book = XLSX.read(exporter.warehouseCartons(payload.data, payload.boxes, batchId));
      assert.deepEqual(book.SheetNames, ['箱號明細', '倉儲明細']);
      for (const name of book.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { defval: '' });
        assert.equal(rows.length, selected.length);
        assert.deepEqual(rows.map(r => [r['箱號'], r['數量'], r.SN]), selected.map(b => [b.id, b.quantity, b.serials.join(',')]));
        assert.ok(rows.every(r => r['品號'] === sku && r['國際條碼'] === form.barcode && r['來源識別'] === batchId));
      }
    };
    await verify(1, expected.length, expected);
    await verify(expected.length - 1, expected.length, expected.slice(-2));
    for (const [from, to] of [[0, 1], [2, 1], [1.5, 2], [1, expected.length + 1], [1, Number.MAX_SAFE_INTEGER + 1]]) {
      await assert.rejects(service.exportData('company', batchId, from, to, 'warehouse-cartons'), /箱序範圍/);
    }
    await assert.rejects(service.exportData('other-company', batchId, 1, 1, 'warehouse-cartons'), /找不到/);
    await assert.rejects(service.exportData('company', batchId, 1, 10001, 'warehouse'), /10,000/);
    assert.deepEqual(await service.detail('company', batchId), before);
  });
});
