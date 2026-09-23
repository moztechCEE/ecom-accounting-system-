// Exercise the formal quote/procurement DDL on an isolated PostgreSQL engine.
// No business database or Prisma connection is used.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  let checks = 0;
  const reject = async (sql, code = '23514') => {
    await assert.rejects(db.query(sql), (error) => error.code === code);
    checks++;
  };
  try {
    await db.exec(`
      CREATE TABLE entities(id text PRIMARY KEY);
      CREATE TABLE customers(id text PRIMARY KEY);
      CREATE TABLE vendors(id text PRIMARY KEY);
      CREATE TABLE products(id text PRIMARY KEY);
      CREATE TABLE sales_orders(id text PRIMARY KEY);
      CREATE TABLE sales_quotations(id text PRIMARY KEY);
      CREATE TABLE purchase_orders(id text PRIMARY KEY, entity_id text NOT NULL);
      CREATE TABLE purchase_order_items(id text PRIMARY KEY, purchase_order_id text NOT NULL);
      INSERT INTO entities VALUES('entity');
      INSERT INTO customers VALUES('customer');
      INSERT INTO vendors VALUES('vendor');
      INSERT INTO products VALUES('product');
      INSERT INTO sales_quotations VALUES('quotation');
    `);
    const migrations = path.join(__dirname, '../../../prisma/migrations');
    await db.exec(readFileSync(path.join(migrations,
      '20260923080000_b2b_customer_portal/migration.sql'), 'utf8'));
    checks++;
    await db.exec(readFileSync(path.join(migrations,
      '20260924000000_b2b_formal_quote_procurement/migration.sql'), 'utf8'));
    checks++;

    await db.exec(`
      INSERT INTO b2b_accounts
        (id,entity_id,account_type,customer_id,email,name,password_hash,created_by,updated_at)
      VALUES ('account','entity','CUSTOMER','customer','a@example.test','Buyer','hash','staff',now());
      INSERT INTO b2b_purchase_requests
        (id,entity_id,customer_id,account_id,request_id,source_hash,request_number,
         customer_po_number,subtotal,tax,total)
      VALUES ('request','entity','customer','account','key','hash','B2B-1','PO-1',100,5,105);
      INSERT INTO b2b_issued_quotes
        (id,request_id,quotation_id,version,issued_by,seller_name,buyer_name)
      VALUES ('issued','request','quotation',1,'staff','Seller','Buyer');
    `);
    checks++;

    await reject("UPDATE b2b_issued_quotes SET status='accepted' WHERE id='issued'");
    await reject("UPDATE b2b_issued_quotes SET accepted_at=now() WHERE id='issued'");
    await db.query(`UPDATE b2b_issued_quotes SET status='accepted',
      accepted_at=now(),accepted_by_account_id='account' WHERE id='issued'`);
    checks++;
    await reject("UPDATE b2b_issued_quotes SET status='withdrawn' WHERE id='issued'");
    await reject(`UPDATE b2b_issued_quotes SET status='withdrawn',withdrawn_at=now(),
      withdrawn_by='staff',withdrawal_reason='short' WHERE id='issued'`);
    await db.query(`UPDATE b2b_issued_quotes SET status='withdrawn',withdrawn_at=now(),
      withdrawn_by='staff',withdrawal_reason='Stock changed after acceptance' WHERE id='issued'`);
    checks++;
    const evidence = (await db.query(`SELECT status,accepted_by_account_id,
      accepted_at IS NOT NULL AS accepted,withdrawn_at IS NOT NULL AS withdrawn
      FROM b2b_issued_quotes WHERE id='issued'`)).rows[0];
    assert.deepEqual(evidence, {
      status: 'withdrawn', accepted_by_account_id: 'account', accepted: true, withdrawn: true,
    });
    checks++;
    await reject("UPDATE b2b_issued_quotes SET status='sent' WHERE id='issued'");
    console.log(`${checks} formal B2B migration/constraint checks passed (isolated PGlite)`);
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
