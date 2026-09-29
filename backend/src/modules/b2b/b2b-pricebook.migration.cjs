// Execute only against an ephemeral PGlite database; never touches business DBs.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  let checks = 0;
  const rejects = async (sql, values, code) => {
    await assert.rejects(db.query(sql, values), (error) => error.code === code);
    checks++;
  };
  try {
    await db.exec(`
      CREATE TABLE entities(id text PRIMARY KEY);
      CREATE TABLE products(id text PRIMARY KEY, entity_id text NOT NULL);
      CREATE TABLE customers(id text PRIMARY KEY, entity_id text NOT NULL);
      INSERT INTO entities VALUES('e1'),('e2');
      INSERT INTO products VALUES('p1','e1'),('p2','e2');
      INSERT INTO customers VALUES('c1','e1'),('c2','e2');
    `);
    await db.exec(readFileSync(path.join(__dirname, '../../../prisma/migrations/20260929000000_b2b_public_price_books/migration.sql'), 'utf8'));
    checks++;

    const book = `INSERT INTO b2b_product_price_books(id,entity_id,product_id,msrp,regular_price,group_buy_price,currency,tax_basis,created_by,updated_by,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'staff','staff',now())`;
    await db.query(book, ['book','e1','p1',1000,900,650,'TWD','TAX_EXCLUDED']); checks++;
    assert.equal((await db.query("SELECT is_public FROM b2b_product_price_books WHERE id='book'")).rows[0].is_public, false);
    checks++;
    await db.query("UPDATE b2b_product_price_books SET is_public=true WHERE id='book'");
    assert.equal((await db.query("SELECT is_public FROM b2b_product_price_books WHERE id='book'")).rows[0].is_public, true);
    checks++;
    await rejects(book, ['duplicate','e1','p1',1000,900,650,'TWD','TAX_EXCLUDED'], '23505');
    await rejects(book, ['cross','e1','p2',1000,900,650,'TWD','TAX_EXCLUDED'], '23503');
    await rejects(book, ['negative','e2','p2',-1,900,650,'TWD','TAX_EXCLUDED'], '23514');
    await rejects(book, ['negative-group','e2','p2',1000,900,-1,'TWD','TAX_EXCLUDED'], '23514');
    await rejects(book, ['tax','e2','p2',1000,900,650,'TWD','UNKNOWN'], '23514');

    const offer = `INSERT INTO b2b_price_offers(id,price_book_id,unit_price,starts_at,ends_at,audience,audience_code,created_by,updated_by,updated_at)
      VALUES($1,'book',$2,'2026-09-01T00:00:00Z',$3,$4,$5,'staff','staff',now())`;
    await db.query(offer, ['campaign-public',600,'2026-10-01T00:00:00Z','ALL',null]); checks++;
    await db.query(offer, ['campaign-code',550,'2026-10-01T00:00:00Z','CODE','TEAM']); checks++;
    await rejects(offer, ['no-code',550,'2026-10-01T00:00:00Z','CODE',null], '23514');
    await rejects(offer, ['bad-date',600,'2026-08-01T00:00:00Z','ALL',null], '23514');

    const rule = `INSERT INTO b2b_customer_discount_rules(id,entity_id,customer_id,multiplier,base_price_type,valid_from,valid_until,created_by,updated_by,updated_at)
      VALUES($1,$2,$3,$4,$5,'2026-09-01T00:00:00Z',NULL,'staff','staff',now())`;
    await db.query(rule, ['rule','e1','c1',0.55,'MSRP']); checks++;
    await rejects(rule, ['cross-customer','e1','c2',0.55,'MSRP'], '23503');
    await rejects(rule, ['bad-multiplier','e2','c2',1.1,'MSRP'], '23514');
    await rejects(rule, ['bad-base','e2','c2',0.55,'OFFER'], '23514');
    console.log(`${checks} B2B pricebook migration checks passed (isolated PGlite)`);
  } finally {
    await db.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
