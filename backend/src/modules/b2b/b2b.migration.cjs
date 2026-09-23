// SQL migration/constraint verification on an ephemeral PostgreSQL WASM engine.
// This does not connect Prisma or apply anything to a business database.
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
(async()=>{
  const db=new PGlite();let checks=0;
  const reject=async(sql,params,code)=>{await assert.rejects(db.query(sql,params),error=>error.code===code);checks++;};
  try{
    await db.exec("CREATE TABLE entities(id text primary key); CREATE TABLE customers(id text primary key); CREATE TABLE vendors(id text primary key); CREATE TABLE products(id text primary key); CREATE TABLE sales_orders(id text primary key); INSERT INTO entities VALUES('entity'); INSERT INTO customers VALUES('customer'); INSERT INTO vendors VALUES('vendor'); INSERT INTO products VALUES('product'); INSERT INTO sales_orders VALUES('order');");
    await db.exec(readFileSync(path.join(__dirname,'../../../prisma/migrations/20260923040000_b2b_customer_portal/migration.sql'),'utf8'));checks++;
    const createAccount="INSERT INTO b2b_accounts(id,entity_id,account_type,customer_id,vendor_id,email,name,password_hash,created_by,updated_at) VALUES($1,'entity',$2,$3,$4,$5,'QA','hash','staff',NOW())";
    await db.query(createAccount,['account','CUSTOMER','customer',null,'a@example.test']);checks++;
    await db.query(createAccount,['supplier','SUPPLIER',null,'vendor','s@example.test']);checks++;
    await reject(createAccount,['bad','CUSTOMER','customer','vendor','bad@example.test'],'23514');
    await reject(createAccount,['missing','SUPPLIER',null,null,'missing@example.test'],'23514');
    await reject(createAccount,['duplicate','CUSTOMER','customer',null,'a@example.test'],'23505');
    const createRequest="INSERT INTO b2b_purchase_requests(id,entity_id,customer_id,account_id,request_id,source_hash,request_number,customer_po_number,subtotal,tax,total) VALUES($1,'entity','customer','account',$2,'hash',$3,'PO',100,5,105)";
    await db.query(createRequest,['request','idempotency','B2B-1']);checks++;
    await reject(createRequest,['duplicate-request','idempotency','B2B-2'],'23505');
    await reject("UPDATE b2b_purchase_requests SET status='unreviewed-shipped' WHERE id='request'",[],'23514');
    await db.query("INSERT INTO b2b_request_items(id,request_id,product_id,sku,name,quantity,unit_price,line_total,sort_order) VALUES('line','request','product','SKU','Test',10,10,100,0)");checks++;
    await reject("UPDATE b2b_request_items SET confirmed_quantity=11 WHERE id='line'",[],'23514');
    await reject("UPDATE b2b_request_items SET quantity=0 WHERE id='line'",[],'23514');
    await reject("UPDATE b2b_request_items SET unit_price=-1 WHERE id='line'",[],'23514');
    await reject("INSERT INTO b2b_catalog_items(id,entity_id,product_id,unit_price,updated_by,updated_at) VALUES('catalog','entity','product',-1,'staff',NOW())",[],'23514');
    await db.query("UPDATE b2b_purchase_requests SET sales_order_id='order',status='order_confirmed' WHERE id='request'");checks++;
    await db.query(createRequest,['request-2','idempotency-2','B2B-2']);
    await reject("UPDATE b2b_purchase_requests SET sales_order_id='order' WHERE id='request-2'",[],'23505');
    await reject("UPDATE b2b_purchase_requests SET sales_order_id='absent' WHERE id='request-2'",[],'23503');
    await db.query("INSERT INTO b2b_sessions(token_hash,account_id,expires_at) VALUES('hashed-session','supplier',NOW()+INTERVAL '1 hour')");
    await db.query("DELETE FROM b2b_accounts WHERE id='supplier'");
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM b2b_sessions WHERE account_id='supplier'")).rows[0].n,0);checks++;
    console.log(`${checks} B2B PostgreSQL migration/constraint checks passed (isolated PGlite)`);
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
