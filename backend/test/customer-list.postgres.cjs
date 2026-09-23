// Run after npm run build:
// PGLITE_MODULE=/path/to/@electric-sql/pglite node --test test/customer-list.postgres.cjs
// Isolated PostgreSQL engine only. No network, credentials or persisted database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CustomerService } = require('../dist/src/modules/sales/customer.service');

test('customer summaries remain bounded with 40,000 orders and isolate cross-company links', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE sales_channels(id TEXT PRIMARY KEY, entity_id TEXT, code TEXT, name TEXT);
      CREATE TABLE sales_orders(id TEXT PRIMARY KEY, entity_id TEXT, customer_id TEXT, channel_id TEXT,
        order_date TIMESTAMPTZ, external_order_id TEXT, notes TEXT);
      INSERT INTO sales_channels VALUES('channel-a','entity-a','SHOPIFY','Local'),('channel-b','entity-b','OTHER','Foreign');
      INSERT INTO sales_orders
        SELECT 'order-' || LPAD(g::TEXT,6,'0'), 'entity-a', 'customer-a', 'channel-a',
          TIMESTAMPTZ '2026-01-01T00:00:00Z' + g * INTERVAL '1 second', 'EXT-' || g, NULL
        FROM generate_series(1,40000) g;
      INSERT INTO sales_orders VALUES
        ('foreign-order','entity-b','customer-a','channel-b','2026-09-23T00:00:00Z','FOREIGN',NULL),
        ('bad-channel','entity-a','customer-c','channel-b','2026-09-23T00:00:00Z','LOCAL',NULL);
    `);
    const masters = ['customer-a', 'manual', 'customer-c'].map(id => ({ id, entityId: 'entity-a',
      name: id, type: 'individual', paymentTermDays: 0, isMonthlyBilling: false, paymentTerms: null }));
    const queries = [];
    const service = new CustomerService({
      customer: {
        findMany: async query => {
          assert.equal(query.include, undefined);
          assert.equal(query.take, 50);
          return masters;
        },
        count: async () => masters.length,
        findFirst: async ({ where }) => masters.find(c => c.id === where.id && c.entityId === where.entityId) || null,
      },
      $queryRaw: async query => {
        queries.push(query);
        const result = await pg.query(query.text, query.values);
        assert.ok(result.rows.length <= masters.length);
        return result.rows;
      },
    });
    const page = await service.findAll('entity-a');
    assert.equal(page.total, 3);
    assert.equal(page.rows[0].totalOrders, 40000);
    assert.equal(page.rows[0].salesOrders.length, 1);
    assert.equal(page.rows[0].salesOrders[0].id, 'order-040000');
    assert.deepEqual(page.rows[0].sourceBrands, ['MOZTECH']);
    assert.equal(page.rows[1].totalOrders, 0);
    assert.equal(page.rows[1].salesOrders.length, 0);
    assert.equal(page.rows[2].salesOrders[0].channel, null);
    assert.equal(page.rows[2].totalOrders, 1);
    assert.ok(queries[0].values.length <= 101);
    assert.equal((await service.findOne('entity-a', 'customer-a')).totalOrders, 40000);
    assert.equal(await service.findOne('entity-b', 'customer-a'), null);
    assert.equal(queries.length, 2);
  } finally { await pg.close(); }
});
