// Apply the conversion migration on an isolated PostgreSQL engine only.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  let checks = 0;
  const migration = (name) => readFileSync(path.join(__dirname,
    `../../../prisma/migrations/${name}/migration.sql`), 'utf8');
  const reject = async (sql, code) => {
    await assert.rejects(db.query(sql), (error) => error.code === code);
    checks++;
  };
  try {
    await db.exec(`
      CREATE TABLE entities(id text PRIMARY KEY);
      CREATE TABLE customers(id text PRIMARY KEY, entity_id text NOT NULL,
        UNIQUE(id,entity_id));
      CREATE TABLE vendors(id text PRIMARY KEY);
      CREATE TABLE products(id text PRIMARY KEY);
      CREATE TABLE sales_orders(id text PRIMARY KEY);
      INSERT INTO entities VALUES('e1'),('e2');
      INSERT INTO customers VALUES('c1','e1'),('c2','e2');
      INSERT INTO products VALUES('p1');
    `);
    await db.exec(migration('20260923080000_b2b_customer_portal')); checks++;
    await db.exec(migration('20260929010000_b2b_guest_inquiries')); checks++;
    await db.exec(`
      INSERT INTO b2b_accounts
        (id,entity_id,account_type,customer_id,email,name,password_hash,created_by,updated_at)
      VALUES ('a1','e1','CUSTOMER','c1','a@example.test','Buyer','hash','staff',now());
      INSERT INTO b2b_purchase_requests
        (id,entity_id,customer_id,account_id,request_id,source_hash,request_number,
         customer_po_number,subtotal,tax,total)
      VALUES ('portal','e1','c1','a1','portal-key','hash','B2B-PORTAL','PO-1',100,5,105);
      INSERT INTO b2b_guest_inquiries
        (id,entity_id,request_id,payload_hash,reference,company_name,contact_name,
         contact_email,status,matched_customer_id,matched_at,matched_by,match_reason,updated_at)
      VALUES ('g1','e1','guest-key','hash','G-REFERENCE','Company','Buyer',
        'buyer@example.test','MATCHED','c1',now(),'staff','verified by telephone',now());
    `); checks++;
    await db.exec(migration('20260930010000_b2b_guest_to_request')); checks++;
    const existing = (await db.query(`SELECT source_kind,source_guest_inquiry_id,
      account_id,customer_po_number FROM b2b_purchase_requests WHERE id='portal'`)).rows[0];
    assert.deepEqual(existing, {
      source_kind: 'PORTAL', source_guest_inquiry_id: null,
      account_id: 'a1', customer_po_number: 'PO-1',
    }); checks++;

    const insertGuest = `INSERT INTO b2b_purchase_requests
      (id,entity_id,customer_id,account_id,request_id,source_hash,source_kind,
       source_guest_inquiry_id,request_number,customer_po_number,subtotal,tax,total)
      VALUES ('converted','e1','c1',NULL,'converted-key','hash','GUEST',
        'g1','B2B-CONVERTED',NULL,60.25,3.01,63.26)`;
    await db.query(insertGuest); checks++;
    await reject(insertGuest.replaceAll('converted', 'duplicate').replaceAll('CONVERTED', 'DUPLICATE'), '23505');
    await reject(`UPDATE b2b_purchase_requests SET account_id=NULL WHERE id='portal'`, '23514');
    await reject(`UPDATE b2b_purchase_requests SET account_id='a1' WHERE id='converted'`, '23514');
    await reject(`UPDATE b2b_purchase_requests SET source_guest_inquiry_id=NULL WHERE id='converted'`, '23514');
    await reject(`UPDATE b2b_purchase_requests SET entity_id='e2',customer_id='c2'
      WHERE id='converted'`, '23503');
    console.log(`${checks} B2B guest conversion migration checks passed (isolated PGlite)`);
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
