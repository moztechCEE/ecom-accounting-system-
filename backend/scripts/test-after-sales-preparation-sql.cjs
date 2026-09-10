// Optional isolated PostgreSQL engine check. Never reads DATABASE_URL.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require(process.env.PREPARATION_TEST_PGLITE_MODULE);
async function run() {
  const db = new PGlite();
  await db.exec('CREATE TABLE entities(id TEXT PRIMARY KEY); INSERT INTO entities VALUES (\'a\'), (\'b\');');
  await db.exec(readFileSync(resolve(__dirname, '../prisma/migrations/20260910110000_after_sales_preparation/migration.sql'), 'utf8'));
  const data = JSON.stringify({ code: 'AIRITY', name: 'AIRITY', active: true });
  const insertBrand = 'INSERT INTO after_sales_brand_settings(entity_id,code,version,data,updated_by) VALUES ($1,$2,1,$3::jsonb,$4) ON CONFLICT DO NOTHING RETURNING version';
  assert.equal((await db.query(insertBrand, ['a','AIRITY',data,'actor'])).rows.length, 1);
  assert.equal((await db.query(insertBrand, ['a','AIRITY',data,'actor'])).rows.length, 0);
  assert.equal((await db.query(insertBrand, ['b','AIRITY',data,'actor'])).rows.length, 1);
  assert.equal((await db.query('UPDATE after_sales_brand_settings SET version=version+1 WHERE entity_id=$1 AND code=$2 AND version=$3 RETURNING version', ['a','AIRITY',1])).rows[0].version, 2);
  assert.equal((await db.query('UPDATE after_sales_brand_settings SET version=version+1 WHERE entity_id=$1 AND code=$2 AND version=$3 RETURNING version', ['a','AIRITY',1])).rows.length, 0);
  await db.transaction(async tx => {
    await tx.query('SELECT data FROM after_sales_brand_settings WHERE entity_id=$1 AND code=$2 FOR SHARE', ['a','AIRITY']);
    await tx.query('INSERT INTO after_sales_case_brand_bindings(entity_id,source_case_id,brand_code,created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['a','case','AIRITY','actor']);
    await tx.query('INSERT INTO after_sales_quote_drafts(id,entity_id,request_key,request_hash,data,created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING', ['draft','a','retry','hash','{"status":"draft"}','actor']);
  });
  assert.equal((await db.query('SELECT data FROM after_sales_quote_drafts WHERE entity_id=$1',['b'])).rows.length, 0);
  assert.equal((await db.query('SELECT data FROM after_sales_quote_drafts WHERE entity_id=$1',['a'])).rows.length, 1);
  assert.equal((await db.query('INSERT INTO after_sales_quote_drafts(id,entity_id,request_key,request_hash,data,created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING RETURNING id', ['second','a','retry','hash','{}','actor'])).rows.length,0);
  await assert.rejects(db.query('INSERT INTO after_sales_case_brand_bindings(entity_id,source_case_id,brand_code,created_by) VALUES ($1,$2,$3,$4)', ['a','other','MISSING','actor']));
  await assert.rejects(db.query(insertBrand, ['unknown-company','AIRITY',data,'actor']));
  console.log('PASS: migration, tenant constraints, brand CAS, binding FK, immutable draft persistence, idempotency (in-memory PostgreSQL)');
  await db.close();
}
run().catch(error => { console.error(error); process.exitCode = 1; });
