// Private quote DDL is exercised only in an isolated PGlite database.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const migration = (name) => readFileSync(path.join(__dirname,
    `../../../prisma/migrations/${name}/migration.sql`), 'utf8');
  let checks = 0;
  const reject = async (sql, code = '23514') => {
    await assert.rejects(db.query(sql), (error) => error.code === code);
    checks++;
  };
  try {
    await db.exec(`
      CREATE TABLE entities(id text PRIMARY KEY);
      CREATE TABLE customers(id text PRIMARY KEY, entity_id text NOT NULL, UNIQUE(id,entity_id));
      CREATE TABLE vendors(id text PRIMARY KEY);
      CREATE TABLE products(id text PRIMARY KEY);
      CREATE TABLE sales_orders(id text PRIMARY KEY);
      CREATE TABLE sales_quotations(id text PRIMARY KEY);
      CREATE TABLE purchase_orders(id text PRIMARY KEY, entity_id text NOT NULL);
      CREATE TABLE purchase_order_items(id text PRIMARY KEY, purchase_order_id text NOT NULL);
      INSERT INTO entities VALUES('e1');
      INSERT INTO customers VALUES('c1','e1');
      INSERT INTO sales_quotations VALUES('q1'),('q2');
    `);
    for (const name of [
      '20260923080000_b2b_customer_portal',
      '20260924000000_b2b_formal_quote_procurement',
      '20260929010000_b2b_guest_inquiries',
      '20260930010000_b2b_guest_to_request',
      '20260930020000_b2b_private_quote_email',
    ]) {
      await db.exec(migration(name)); checks++;
    }
    await db.exec(`
      INSERT INTO b2b_guest_inquiries
        (id,entity_id,request_id,payload_hash,reference,company_name,contact_name,
         contact_email,status,matched_customer_id,matched_at,matched_by,match_reason,updated_at)
      VALUES ('g1','e1','guest-key','hash','G-REF','Company','Buyer',
        'buyer@example.test','MATCHED','c1',now(),'staff','verified by telephone',now());
      INSERT INTO b2b_purchase_requests
        (id,entity_id,customer_id,request_id,source_hash,source_kind,
         source_guest_inquiry_id,request_number,subtotal,tax,total)
      VALUES ('r1','e1','c1','key','hash','GUEST','g1','B2B-1',100,5,105);
      INSERT INTO b2b_issued_quotes
        (id,request_id,quotation_id,version,status,issued_by,seller_name,buyer_name)
      VALUES ('i1','r1','q1',1,'delivery_pending','staff','Seller','Buyer');
    `); checks++;
    await reject("UPDATE b2b_issued_quotes SET status='accepted' WHERE id='i1'");
    await reject("UPDATE b2b_issued_quotes SET accepted_by_email='buyer@example.test' WHERE id='i1'");
    await db.query(`UPDATE b2b_issued_quotes SET status='sent' WHERE id='i1'`); checks++;
    await db.query(`INSERT INTO b2b_quote_email_accesses
      (id,issued_quote_id,token_hash,recipient_email,verification_reason,verified_by,
       verified_at,expires_at,attempt_id,send_lease_until)
      VALUES ('a1','i1',repeat('a',64),'buyer@example.test','Verified master record',
        'staff',now(),now()+interval '1 day','attempt',now()+interval '5 minutes')`); checks++;
    await reject(`UPDATE b2b_quote_email_accesses SET send_state='SENT' WHERE id='a1'`);
    await reject(`UPDATE b2b_quote_email_accesses SET recipient_email='Buyer@Example.Test' WHERE id='a1'`);
    await db.query(`UPDATE b2b_quote_email_accesses SET send_state='SENT',sent_at=now()
      WHERE id='a1'`); checks++;
    await db.query(`UPDATE b2b_issued_quotes SET status='accepted',accepted_at=now(),
      accepted_by_email='buyer@example.test' WHERE id='i1'`); checks++;
    await reject("UPDATE b2b_issued_quotes SET accepted_by_account_id='account' WHERE id='i1'");
    await reject("UPDATE b2b_issued_quotes SET accepted_by_email=NULL WHERE id='i1'");
    await db.query(`UPDATE b2b_issued_quotes SET status='withdrawn',withdrawn_at=now(),
      withdrawn_by='staff',withdrawal_reason='Inventory changed after acceptance'
      WHERE id='i1'`); checks++;
    const row = (await db.query(`SELECT status,accepted_by_email,accepted_by_account_id
      FROM b2b_issued_quotes WHERE id='i1'`)).rows[0];
    assert.deepEqual(row, { status: 'withdrawn', accepted_by_email: 'buyer@example.test',
      accepted_by_account_id: null }); checks++;
    console.log(`${checks} private B2B quote migration checks passed (isolated PGlite)`);
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
