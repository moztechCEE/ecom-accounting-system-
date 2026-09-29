// Applies both new migrations to an ephemeral PostgreSQL WASM database only.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  let checks = 0;
  const reject = async (sql, params, code) => {
    await assert.rejects(db.query(sql, params), (error) => error.code === code);
    checks++;
  };
  try {
    await db.exec(`
      CREATE TABLE entities(id text PRIMARY KEY);
      CREATE TABLE products(id text PRIMARY KEY, entity_id text NOT NULL);
      CREATE TABLE customers(id text PRIMARY KEY, entity_id text NOT NULL);
      INSERT INTO entities VALUES('e1'),('e2');
      INSERT INTO products VALUES('p1','e1');
      INSERT INTO customers VALUES('c1','e1'),('c2','e2');
    `);
    for (const migration of [
      '20260929000000_b2b_public_price_books',
      '20260929010000_b2b_guest_inquiries',
    ]) {
      await db.exec(readFileSync(path.join(__dirname, `../../../prisma/migrations/${migration}/migration.sql`), 'utf8'));
      checks++;
    }

    const create = `INSERT INTO b2b_guest_inquiries
      (id,entity_id,request_id,payload_hash,reference,company_name,contact_name,contact_email,updated_at)
      VALUES($1,$2,$3,'hash',$4,'Company','Contact','contact@example.test',now())`;
    await db.query(create, ['g1','e1','idempotency-1','G-REFERENCE']); checks++;
    await reject(create, ['g2','e1','idempotency-1','G-REFERENCE-2'], '23505');
    await reject(create, ['g3','e1','idempotency-2','G-REFERENCE'], '23505');
    await reject("UPDATE b2b_guest_inquiries SET status='MATCHED' WHERE id='g1'", [], '23514');
    await reject("UPDATE b2b_guest_inquiries SET status='MATCHED',matched_customer_id='c2',matched_at=now(),matched_by='staff',match_reason='verified by phone' WHERE id='g1'", [], '23503');
    await db.query("UPDATE b2b_guest_inquiries SET status='MATCHED',matched_customer_id='c1',matched_at=now(),matched_by='staff',match_reason='verified by phone' WHERE id='g1'"); checks++;
    await db.query(create, ['g4','e1','idempotency-4','G-REJECTED']); checks++;
    await reject("UPDATE b2b_guest_inquiries SET status='REJECTED' WHERE id='g4'", [], '23514');
    await db.query("UPDATE b2b_guest_inquiries SET status='REJECTED',rejected_at=now(),rejected_by='staff',rejection_reason='invalid spam inquiry' WHERE id='g4'"); checks++;
    await reject("UPDATE b2b_guest_inquiries SET status='MATCHED',matched_customer_id='c1',matched_at=now(),matched_by='staff',match_reason='verified by phone' WHERE id='g4'", [], '23514');

    const item = `INSERT INTO b2b_guest_inquiry_items
      (id,inquiry_id,product_id,sku,name,quantity,msrp,currency,tax_basis,line_total,sort_order)
      VALUES($1,'g1','p1','SKU','Product',$2,$3,'TWD',$4,$5,0)`;
    await db.query(item, ['line1',2,1000,'TAX_INCLUDED',2000]); checks++;
    await reject(item, ['duplicate',2,1000,'TAX_INCLUDED',2000], '23505');
    await reject(item, ['bad-total',2,1000,'TAX_INCLUDED',1000], '23514');
    await reject(item, ['bad-tax',2,1000,'UNKNOWN',2000], '23514');

    await db.query("INSERT INTO b2b_guest_rate_buckets(key_hash,window_start,attempts) VALUES('hashed',now(),1)"); checks++;
    await reject("UPDATE b2b_guest_rate_buckets SET attempts=-1 WHERE key_hash='hashed'", [], '23514');
    console.log(`${checks} B2B guest inquiry migration checks passed (isolated PGlite)`);
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
