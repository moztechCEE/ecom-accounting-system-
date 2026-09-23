// Run with an isolated PostgreSQL WASM engine, never a business database:
// PGLITE_MODULE=/path/to/@electric-sql/pglite node --test test/b2b-quote-procurement.integration.cjs
// Service guards are tested in Jest; this verifies the actual migrations and
// durable relational evidence produced by the two B2B workflows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const migrations = [
  '20260923080000_b2b_customer_portal',
  '20260924000000_b2b_formal_quote_procurement',
].map((name) => readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8'));

async function database() {
  const db = new PGlite();
  try {
    // The preceding migrations own these tables. Keep only the columns that
    // this migration and the tested workflow actually read or write.
    await db.exec(`
      CREATE TABLE entities(id TEXT PRIMARY KEY);
      CREATE TABLE customers(id TEXT PRIMARY KEY);
      CREATE TABLE vendors(id TEXT PRIMARY KEY);
      CREATE TABLE products(id TEXT PRIMARY KEY);
      CREATE TABLE sales_orders(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL);
      CREATE TABLE sales_quotations(
        id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        quotation_no TEXT NOT NULL, status TEXT NOT NULL,
        subtotal_original NUMERIC(18,2) NOT NULL,
        tax_amount_original NUMERIC(18,2) NOT NULL,
        total_amount_original NUMERIC(18,2) NOT NULL
      );
      CREATE TABLE sales_quotation_items(
        id TEXT PRIMARY KEY, quotation_id TEXT NOT NULL REFERENCES sales_quotations(id),
        product_id TEXT NOT NULL, quantity NUMERIC(18,2) NOT NULL,
        unit_price_original NUMERIC(18,2) NOT NULL,
        tax_amount_original NUMERIC(18,2) NOT NULL,
        line_total_original NUMERIC(18,2) NOT NULL
      );
      CREATE TABLE purchase_orders(
        id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, vendor_id TEXT NOT NULL,
        status TEXT NOT NULL, total_amount_original NUMERIC(18,2) NOT NULL
      );
      CREATE TABLE purchase_order_items(
        id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
        product_id TEXT NOT NULL, qty NUMERIC(18,2) NOT NULL,
        unit_cost_original NUMERIC(18,2) NOT NULL
      );
      CREATE TABLE inventory_transactions(
        id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, product_id TEXT NOT NULL,
        direction TEXT NOT NULL, quantity NUMERIC(18,2) NOT NULL,
        reference_type TEXT NOT NULL, reference_id TEXT NOT NULL
      );
      INSERT INTO entities VALUES ('entity'), ('other-entity');
      INSERT INTO customers VALUES ('buyer'), ('other-buyer');
      INSERT INTO vendors VALUES ('supplier');
      INSERT INTO products VALUES ('product');
    `);
    for (const migration of migrations) await db.exec(migration);
    await db.exec(`
      INSERT INTO b2b_accounts
        (id,entity_id,account_type,customer_id,email,name,password_hash,created_by,updated_at)
      VALUES
        ('buyer-login','entity','CUSTOMER','buyer','buyer@example.test','Buyer','hash','staff',NOW()),
        ('other-login','entity','CUSTOMER','other-buyer','other@example.test','Other','hash','staff',NOW());
    `);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function expectSqlError(work, code) {
  await assert.rejects(work, (error) => error.code === code);
}

test('reviewed request retains a versioned quote and customer acceptance before its sales order', async () => {
  const db = await database();
  try {
    await db.exec(`
      INSERT INTO b2b_purchase_requests
        (id,entity_id,customer_id,account_id,request_id,source_hash,request_number,
         customer_po_number,subtotal,tax,total)
      VALUES
        ('request','entity','buyer','buyer-login','customer-submit-1','hash-1','B2B-001',
         'CUSTOMER-PO-1',100,5,105),
        ('other-request','entity','other-buyer','other-login','customer-submit-2','hash-2','B2B-002',
         'CUSTOMER-PO-2',100,5,105);
      INSERT INTO b2b_request_items
        (id,request_id,product_id,sku,name,quantity,unit_price,line_total,sort_order)
      VALUES ('request-line','request','product','SKU-1','Product',2,50,100,0);
      UPDATE b2b_request_items SET confirmed_quantity=2 WHERE id='request-line';
      UPDATE b2b_purchase_requests
        SET status='stock_confirmed',reviewed_at=NOW(),reviewed_by='staff'
        WHERE id='request';
      INSERT INTO b2b_stock_reviews
        (id,request_id,reviewed_by,result_status,confirmed_quantities)
      VALUES
        ('review-1','request','staff','stock_confirmed',
         '[{"requestItemId":"request-line","confirmedQuantity":2}]');
      INSERT INTO sales_quotations
        (id,entity_id,customer_id,quotation_no,status,
         subtotal_original,tax_amount_original,total_amount_original)
      VALUES ('quotation-1','entity','buyer','B2B-QT-REQUEST-V1','sent',100,5,105),
             ('quotation-2','entity','buyer','B2B-QT-REQUEST-V2','sent',100,5,105);
      INSERT INTO sales_quotation_items
        (id,quotation_id,product_id,quantity,unit_price_original,
         tax_amount_original,line_total_original)
      VALUES ('quote-line-1','quotation-1','product',2,50,5,105);
      INSERT INTO b2b_issued_quotes
        (id,request_id,quotation_id,version,issued_by)
      VALUES ('issued-1','request','quotation-1',1,'staff');
    `);

    const snapshot = (await db.query(`
      SELECT q.version,q.status,q.accepted_at,
        s.subtotal_original::text AS subtotal,s.tax_amount_original::text AS tax,
        s.total_amount_original::text AS total,
        i.quantity::text AS quantity,i.line_total_original::text AS line_total
      FROM b2b_issued_quotes q JOIN sales_quotations s ON s.id=q.quotation_id
      JOIN sales_quotation_items i ON i.quotation_id=s.id
      WHERE q.request_id='request'
    `)).rows[0];
    assert.deepEqual(snapshot, {
      version: 1, status: 'sent', accepted_at: null,
      subtotal: '100.00', tax: '5.00', total: '105.00',
      quantity: '2.00', line_total: '105.00',
    });
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM sales_orders')).rows[0].n, 0);
    await expectSqlError(db.exec(`
      INSERT INTO b2b_issued_quotes(id,request_id,quotation_id,version,issued_by)
      VALUES('duplicate-version','request','quotation-2',1,'staff')
    `), '23505');
    await expectSqlError(db.exec(`
      UPDATE b2b_issued_quotes SET status='accepted',accepted_at=NOW() WHERE id='issued-1'
    `), '23514');
    await expectSqlError(db.exec(`
      UPDATE b2b_issued_quotes SET status='unreviewed-shipped' WHERE id='issued-1'
    `), '23514');
    await assert.rejects(db.transaction(async (tx) => {
      await tx.exec(`
        UPDATE b2b_issued_quotes
          SET status='accepted',accepted_at=NOW(),accepted_by_account_id='buyer-login'
          WHERE id='issued-1';
        INSERT INTO sales_orders VALUES('rolled-back-order','entity');
      `);
      throw Error('simulated failure after acceptance');
    }), /simulated failure after acceptance/);
    assert.equal((await db.query("SELECT status FROM b2b_issued_quotes WHERE id='issued-1'")).rows[0].status, 'sent');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM sales_orders')).rows[0].n, 0);

    await db.transaction(async (tx) => {
      await tx.exec(`
        UPDATE b2b_issued_quotes
          SET status='accepted',accepted_at=NOW(),accepted_by_account_id='buyer-login'
          WHERE id='issued-1' AND status='sent';
        UPDATE sales_quotations SET status='accepted' WHERE id='quotation-1';
        INSERT INTO sales_orders VALUES('sales-order-1','entity');
        UPDATE b2b_purchase_requests
          SET status='order_confirmed',sales_order_id='sales-order-1'
          WHERE id='request' AND status='stock_confirmed';
      `);
    });
    const accepted = (await db.query(`
      SELECT r.status AS request_status,r.sales_order_id,q.status AS quote_status,
        q.accepted_by_account_id,q.accepted_at IS NOT NULL AS accepted_at_recorded
      FROM b2b_purchase_requests r
      JOIN b2b_issued_quotes q ON q.request_id=r.id
      WHERE r.id='request'
    `)).rows[0];
    assert.deepEqual(accepted, {
      request_status: 'order_confirmed', sales_order_id: 'sales-order-1',
      quote_status: 'accepted', accepted_by_account_id: 'buyer-login',
      accepted_at_recorded: true,
    });
    await expectSqlError(db.exec(`
      UPDATE b2b_purchase_requests SET sales_order_id='sales-order-1' WHERE id='other-request'
    `), '23505');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM sales_orders')).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test('shortage PO provenance survives receipt and a separate manual re-review', async () => {
  const db = await database();
  try {
    await db.exec(`
      INSERT INTO b2b_purchase_requests
        (id,entity_id,customer_id,account_id,request_id,source_hash,request_number,
         customer_po_number,subtotal,tax,total)
      VALUES ('shortage','entity','buyer','buyer-login','customer-submit-3','hash-3','B2B-003',
              'CUSTOMER-PO-3',200,10,210);
      INSERT INTO b2b_request_items
        (id,request_id,product_id,sku,name,quantity,confirmed_quantity,
         unit_price,line_total,sort_order)
      VALUES ('short-line','shortage','product','SKU-1','Product',10,6,20,200,0);
      UPDATE b2b_purchase_requests
        SET status='needs_adjustment',reviewed_at=NOW(),reviewed_by='staff',
            review_note='Four units short'
        WHERE id='shortage';
      INSERT INTO b2b_stock_reviews
        (id,request_id,reviewed_by,result_status,confirmed_quantities,review_note)
      VALUES ('short-review-1','shortage','staff','needs_adjustment',
        '[{"requestItemId":"short-line","confirmedQuantity":6}]','Four units short');
      INSERT INTO purchase_orders
        (id,entity_id,vendor_id,status,total_amount_original,
         source_b2b_request_id,source_request_key,source_payload_hash)
      VALUES ('supplier-po','entity','supplier','pending',48,
              'shortage','unique-request-key','payload-hash');
      INSERT INTO purchase_order_items
        (id,purchase_order_id,product_id,qty,unit_cost_original,source_b2b_request_item_id)
      VALUES ('supplier-po-line','supplier-po','product',4,12,'short-line');
    `);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM inventory_transactions')).rows[0].n, 0);
    assert.equal((await db.query("SELECT status FROM b2b_purchase_requests WHERE id='shortage'")).rows[0].status, 'needs_adjustment');
    await expectSqlError(db.exec(`
      INSERT INTO purchase_orders
        (id,entity_id,vendor_id,status,total_amount_original,
         source_b2b_request_id,source_request_key,source_payload_hash)
      VALUES ('duplicate-key','entity','supplier','pending',48,
              'shortage','unique-request-key','different-payload')
    `), '23505');
    await expectSqlError(db.exec(`
      INSERT INTO purchase_orders
        (id,entity_id,vendor_id,status,total_amount_original,source_b2b_request_id)
      VALUES ('incomplete-source','entity','supplier','pending',48,'shortage')
    `), '23514');
    await expectSqlError(db.exec(`
      INSERT INTO purchase_order_items
        (id,purchase_order_id,product_id,qty,unit_cost_original,source_b2b_request_item_id)
      VALUES ('unknown-source-line','supplier-po','product',4,12,'not-a-request-item')
    `), '23503');

    // Receipt is a separate transaction. It does not change the staff's
    // earlier availability assessment or silently confirm the customer order.
    const receive = () => db.transaction(async (tx) => {
      const claimed = await tx.query(`
        UPDATE purchase_orders SET status='received'
        WHERE id='supplier-po' AND status='pending' RETURNING id
      `);
      if (claimed.rows.length !== 1) return false;
      await tx.exec(`
        INSERT INTO inventory_transactions
          (id,entity_id,product_id,direction,quantity,reference_type,reference_id)
        VALUES ('receipt-1','entity','product','IN',4,'PURCHASE_ORDER','supplier-po')
      `);
      return true;
    });
    const attempts = await Promise.all([receive(), receive()]);
    assert.deepEqual(attempts.sort(), [false, true]);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM inventory_transactions')).rows[0].n, 1);
    assert.equal((await db.query("SELECT status FROM b2b_purchase_requests WHERE id='shortage'")).rows[0].status, 'needs_adjustment');

    await db.transaction(async (tx) => {
      await tx.exec(`
        UPDATE b2b_request_items SET confirmed_quantity=10 WHERE id='short-line';
        UPDATE b2b_purchase_requests
          SET status='stock_confirmed',reviewed_at=NOW(),reviewed_by='second-staff',review_note=NULL
          WHERE id='shortage' AND status='needs_adjustment';
        INSERT INTO b2b_stock_reviews
          (id,request_id,reviewed_by,result_status,confirmed_quantities)
        VALUES ('short-review-2','shortage','second-staff','stock_confirmed',
          '[{"requestItemId":"short-line","confirmedQuantity":10}]');
      `);
    });
    const reviews = (await db.query(`
      SELECT id,result_status,confirmed_quantities->0->>'confirmedQuantity' AS confirmed
      FROM b2b_stock_reviews WHERE request_id='shortage' ORDER BY id
    `)).rows;
    assert.deepEqual(reviews, [
      { id: 'short-review-1', result_status: 'needs_adjustment', confirmed: '6' },
      { id: 'short-review-2', result_status: 'stock_confirmed', confirmed: '10' },
    ]);
    const provenance = (await db.query(`
      SELECT p.status,p.source_b2b_request_id,p.source_request_key,
        i.source_b2b_request_item_id,i.qty::text AS qty
      FROM purchase_orders p JOIN purchase_order_items i ON i.purchase_order_id=p.id
      WHERE p.id='supplier-po'
    `)).rows[0];
    assert.deepEqual(provenance, {
      status: 'received', source_b2b_request_id: 'shortage',
      source_request_key: 'unique-request-key', source_b2b_request_item_id: 'short-line',
      qty: '4.00',
    });
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM sales_orders')).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
