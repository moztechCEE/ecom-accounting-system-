require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const {
  SnLabelsService,
} = require('../dist/src/modules/sn-labels/sn-labels.service');
const {
  SnLabelsExport,
} = require('../dist/src/modules/sn-labels/sn-labels.export');
const {
  allocationRule,
  validateDraft,
  dateYear,
} = require('../dist/src/modules/sn-labels/sn-labels.rules');
const XLSX = require('xlsx');
assert(process.env.SN_TEST_SCHEMA?.startsWith('sn_acceptance_'));
assert(new URL(process.env.DATABASE_URL).pathname === '/erp_dev_20260921');
const db = new PrismaClient(),
  exporter = new SnLabelsExport(),
  svc = new SnLabelsService(db, exporter);
let checks = 0;
function ok(value, msg) {
  assert(value, msg);
  checks++;
  console.log('PASS', msg);
}
const base = {
  name: 'SN integration fixture',
  productId: randomUUID(),
  productName: '驗收產品',
  sku: 'TEST-ERP-SKU',
  barcode: '04711299273087',
  model: 'HL1',
  style: '',
  color: '黑',
  modelCode: 'HL1',
  styleCode: '',
  colorCode: 'K',
  orderDate: '2026-09-22',
  manufactureDate: '2026-09-01',
  quantity: 23,
  capacity: 20,
  label: {
    width: 28,
    height: 7.5,
    target: 'box',
    showQr: true,
    textX: 8,
    textY: 0.7,
    fontSize: 1.45,
    qrX: 0.25,
    qrY: 0.25,
    qrSize: 6,
  },
};
async function draft(patch = {}) {
  const id = randomUUID();
  await svc.save('test-company', 'actor', id, {
    revision: 0,
    data: { ...base, ...patch },
  });
  return id;
}
async function rejected(fn, msg) {
  await assert.rejects(fn);
  ok(true, msg);
}
(async () => {
  await db.$executeRaw`INSERT INTO products(id,entity_id,sku,name,barcode,is_active,updated_at) VALUES(${base.productId},'test-company',${base.sku},${base.productName},${base.barcode},true,now())`;
  ok(
    allocationRule('test-company', validateDraft(base)).prefix === 'HL1K62',
    'optional style + reversed manufacture year',
  );
  await rejected(
    async () => dateYear('2026-02-30'),
    'invalid manufacturing date rejected',
  );
  const id = await draft();
  await rejected(
    () => svc.save('test-company', 'actor', id, { revision: 0, data: base }),
    'stale create does not overwrite draft',
  );
  const pair = await Promise.all([
    svc.activate('test-company', 'actor', id, 1),
    svc.activate('test-company', 'actor', id, 1),
  ]);
  ok(
    pair[0].batchId === pair[1].batchId &&
      pair.filter((p) => p.replayed).length === 1,
    'concurrent repeated activation allocates once',
  );
  const batch = pair[0].batchId,
    b = await svc.detail('test-company', batch);
  ok(
    b.data.quantity === 23 &&
      b.boxes.length === 2 &&
      b.boxes[1].serials.length === 3,
    'full and partial cartons persisted',
  );
  ok(
    b.boxes[0].id === 'CTN-260922-HL1-001' &&
      b.boxes[1].serials[2] === 'HL1K62000023',
    'carton format and exact contents',
  );
  await rejected(
    () => svc.detail('other-company', batch),
    'cross-company batch read rejected',
  );
  await rejected(
    () => svc.activate('other-company', 'actor', id, 1),
    'cross-company activation rejected',
  );
  const ids = await Promise.all([
    draft({ quantity: 2 }),
    draft({ quantity: 3 }),
  ]);
  const added = await Promise.all(
    ids.map((id) => svc.activate('test-company', 'actor', id, 1)),
  );
  ok(
    added.every((a) => a.batchId === batch),
    'same-day additions merge under concurrent allocation',
  );
  const b2 = await svc.detail('test-company', batch);
  ok(
    b2.data.quantity === 28 &&
      b2.last === 28 &&
      JSON.stringify(b2.boxes[1]) === JSON.stringify(b.boxes[1]),
    'append preserves old partial box and continues serials',
  );
  const next = await svc.activate(
    'test-company',
    'actor',
    await draft({ orderDate: '2026-09-23', quantity: 2 }),
    1,
  );
  ok(
    next.first === 29 && next.batchId !== batch,
    'next order date continues same counter',
  );
  const nextYear = await svc.activate(
    'test-company',
    'actor',
    await draft({ manufactureDate: '2027-01-01', quantity: 1 }),
    1,
  );
  ok(nextYear.first === 1, 'new manufacture year starts new counter');

  const collision = await draft({
    modelCode: 'HL',
    styleCode: '1',
    quantity: 1,
  });
  await rejected(
    () => svc.activate('test-company', 'actor', collision, 1),
    'different tuple with same printed prefix rejected',
  );
  const badLayout = await draft({ label: { ...base.label, textX: 0 } });
  await rejected(
    () => svc.activate('test-company', 'actor', badLayout, 1),
    'overlapping layout rejected before allocation',
  );
  const counter =
    await db.$queryRaw`SELECT last_value FROM sn_label_counters WHERE prefix='HL1K62'`;
  ok(
    counter[0].last_value === 30,
    'failed allocation does not consume sequence',
  );
  const selection = await svc.exportData(
    'test-company',
    batch,
    21,
    23,
    'labels',
  );
  ok(
    selection.items.map((s) => s.sn).join(',') ===
      'HL1K62000021,HL1K62000022,HL1K62000023',
    'missed label selection reuses exact original SN',
  );
  const warranty = exporter.workbook(
      'warranty',
      selection.data,
      selection.items,
    ),
    w = XLSX.read(warranty, { type: 'buffer' }),
    sheet = w.Sheets[w.SheetNames[0]];
  ok(
    sheet.A1.v === '一般序號' &&
      sheet.B1.v === 'SKU' &&
      sheet.B2.t === 's' &&
      sheet.B2.v === base.barcode,
    'warranty format and barcode leading zero preserved',
  );
  const warehouse = exporter.workbook(
    'warehouse',
    selection.data,
    selection.items,
    ['一般序號', '箱號', '國際條碼'],
  );
  const wh = XLSX.read(warehouse, { type: 'buffer' }).Sheets['SN 明細'];
  ok(
    wh.B2.v === b.boxes[1].id && wh.C2.v === base.barcode,
    'configurable warehouse export retains carton association',
  );
  const folder = '/tmp/corely-sn-acceptance';
  fs.mkdirSync(folder, { recursive: true });
  const cart = await svc.exportData('test-company', batch, 21, 21, 'cartons');
  ok(
    cart.boxes[0].serials.length === 3,
    'partial selection exports complete locked carton',
  );
  for (const kind of ['labels', 'cartons', 'cartons-no-sn']) {
    const bytes = await exporter.pdf(
      kind,
      selection.data,
      selection.items,
      cart.boxes,
    );
    fs.writeFileSync(folder + '/' + kind + '.pdf', bytes);
    ok(
      bytes.subarray(0, 4).toString() === '%PDF',
      'vector ' + kind + ' PDF generated',
    );
  }
  fs.writeFileSync(folder + '/warranty.xlsx', warranty);
  fs.writeFileSync(folder + '/warehouse.xlsx', warehouse);
  const filtered = await svc.list('test-company', {
    search: base.barcode,
    status: 'active',
    start: '2026-09-23',
    end: '2026-09-23',
  });
  ok(
    filtered.rows.length === 1 && filtered.rows[0].id === next.batchId,
    'barcode, status and date filters',
  );
  await rejected(
    () => svc.save('test-company', 'actor', id, { revision: 1, data: base }),
    'activated source cannot be overwritten',
  );
  await db.$executeRaw`UPDATE sn_label_counters SET last_value=999999 WHERE prefix='HL1K62'`;
  const overflow = await draft({ quantity: 1, orderDate: '2026-09-24' });
  await rejected(
    () => svc.activate('test-company', 'actor', overflow, 1),
    'six-digit counter overflow rolls back',
  );
  console.log('SN integration checks passed:', checks);
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
