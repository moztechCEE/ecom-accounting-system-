// Ephemeral PostgreSQL SQL/constraint proof. Does not connect Prisma or a business database.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
(async () => {
 const db = new PGlite(); let checks = 0;
 const rejected = async (sql, args, code) => { await assert.rejects(db.query(sql, args), e => e.code === code); checks++; };
 try {
  await db.exec(`CREATE TABLE entities(id text primary key); CREATE TABLE warehouses(id text primary key); CREATE TABLE sales_orders(id text primary key); CREATE TABLE sales_order_items(id text primary key); CREATE TABLE products(id text primary key); CREATE TABLE shipments(id text primary key); CREATE TABLE users(id text primary key); CREATE TABLE inventory_transactions(id text primary key, direction text, quantity numeric, reference_type text, reference_id text); CREATE TABLE inventory_snapshots(id text primary key, qty_on_hand numeric,qty_allocated numeric,qty_available numeric);
   INSERT INTO entities VALUES('e'); INSERT INTO warehouses VALUES('w'); INSERT INTO sales_orders VALUES('o'); INSERT INTO sales_order_items VALUES('s1'),('s2'); INSERT INTO products VALUES('p'); INSERT INTO shipments VALUES('sh1'),('sh2'); INSERT INTO users VALUES('staff'); INSERT INTO inventory_snapshots VALUES('stock',150,100,50);`);
  await db.exec(readFileSync(path.join(__dirname, '../../../../prisma/migrations/20260923100000_wms_handover_reconciliation/migration.sql'), 'utf8')); checks++;
  const inbox = `INSERT INTO wms_handover_inbox(id,entity_id,event_id,wms_shipment_id,shipment_id,warehouse_id,sales_order_id,native_intake_id,wms_order_id,source_hash,body_hash,payload,occurred_at) VALUES($1,'e',$2,$3,$4,'w','o',1,2,$5,$5,'{}',now())`;
  await db.query(inbox, ['i1','e1','wms-sh1','sh1','a'.repeat(64)]); checks++;
  await rejected(inbox, ['i2','e1','wms-sh2','sh2','a'.repeat(64)], '23505');
  await rejected(inbox, ['i2','e2','wms-sh1','sh2','a'.repeat(64)], '23505');
  await rejected(inbox, ['i2','e2','wms-sh2','sh2','bad'], '23514');
  const line = `INSERT INTO shipment_lines(id,entity_id,shipment_line_id,inbox_id,shipment_id,sales_order_line_id,product_id,sku,product_name,quantity,packages) VALUES($1,'e',$2,'i1','sh1',$3,'p','SKU','Product',$4,'[{"packageId":"BOX","quantity":60}]')`;
  await db.query(line, ['l1','wl1','s1',60]); checks++;
  await rejected(line, ['l2','wl1','s2',40], '23505');
  await rejected(line, ['l2','wl2','s2',0], '23514');
  await rejected(line, ['l2','wl2','s2',0.5], '23514');
  await rejected(line, ['l2','wl2','absent',40], '23503');
  await db.query(line, ['l2','wl2','s1',40]); checks++;
  for (const table of ['wms_handover_inbox','shipment_lines']) {
   await rejected(`DELETE FROM ${table}`, [], '23514');
   await rejected(`UPDATE ${table} SET id=id`, [], '23514');
  }
  const posting = `INSERT INTO wms_shipment_postings(id,shipment_line_id,quantity,unit_cost_base,total_cost_base,inventory_out_id,inventory_release_id,posted_by) VALUES($1,$2,$3,12.25,$4,$5,$6,'staff')`;
  async function post(id, qty, suffix, fail = false) {
   await db.transaction(async tx => {
    await tx.query(`SELECT id FROM inventory_snapshots WHERE id='stock' FOR UPDATE`);
    const claimed = await tx.query(`UPDATE inventory_snapshots SET qty_on_hand=qty_on_hand-$1,qty_allocated=qty_allocated-$1 WHERE id='stock' AND qty_on_hand >= $1 AND qty_allocated >= $1 RETURNING *`,[qty]);
    assert.equal(claimed.rows.length,1);
    await tx.query(`INSERT INTO inventory_transactions VALUES($1,'RELEASE',$2,'SALES_ORDER','o'),($3,'OUT',$2,'WMS_SHIPMENT_LINE',$4)`, ['rel'+suffix,qty,'out'+suffix,id]);
    if (fail) throw new Error('injected before receipt');
    await tx.query(posting,['receipt'+suffix,id,qty,qty*12.25,'out'+suffix,'rel'+suffix]);
   });
  }
  await assert.rejects(post('l1',60,'bad',true), /injected/); checks++;
  assert.deepEqual((await db.query(`SELECT * FROM inventory_snapshots`)).rows[0], {id:'stock',qty_on_hand:'150',qty_allocated:'100',qty_available:'50'}); checks++;
  assert.equal((await db.query('SELECT count(*)::int n FROM inventory_transactions')).rows[0].n,0); checks++;
  await post('l1',60,'1'); checks++;
  await assert.rejects(post('l1',40,'dup'),e=>e.code==='23505'); checks++;
  assert.deepEqual((await db.query(`SELECT * FROM inventory_snapshots`)).rows[0], {id:'stock',qty_on_hand:'90',qty_allocated:'40',qty_available:'50'}); checks++;
  await post('l2',40,'2'); checks++;
  assert.deepEqual((await db.query(`SELECT * FROM inventory_snapshots`)).rows[0], {id:'stock',qty_on_hand:'50',qty_allocated:'0',qty_available:'50'}); checks++;
  assert.equal((await db.query(`SELECT count(*)::int n FROM inventory_transactions`)).rows[0].n,4); checks++;
  await rejected('UPDATE wms_shipment_postings SET unit_cost_base=0',[], '23514');
  await rejected('DELETE FROM wms_shipment_postings',[], '23514');
  console.log(`${checks} handover PostgreSQL migration, uniqueness, immutable evidence and rollback checks passed (isolated PGlite)`);
 } finally { await db.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
