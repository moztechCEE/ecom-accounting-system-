// Isolated PostgreSQL tests. No network connection or production data is used.
// PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node test/expense-workflow.integration.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260923013000_expense_supervisor_workflow/migration.sql'), 'utf8');
const initial = `CREATE TABLE roles(id text primary key,code text unique,name text unique,description text,hierarchy_level int);
  CREATE TABLE permissions(id text primary key,resource text,action text,description text,unique(resource,action));
  CREATE TABLE role_permissions(role_id text,permission_id text,primary key(role_id,permission_id));
  CREATE TABLE user_roles(user_id text,role_id text);
  CREATE TABLE employees (id text PRIMARY KEY, name text);
  CREATE TABLE payment_tasks (id text PRIMARY KEY, expense_request_id text, status text DEFAULT 'pending');
  CREATE TABLE expense_requests (id text PRIMARY KEY, status text, payment_status text DEFAULT 'pending', updated_at timestamptz DEFAULT now());
  CREATE TABLE approval_steps (id text PRIMARY KEY, expense_request_id text, status text DEFAULT 'pending');
  CREATE TABLE expense_request_histories (expense_request_id text, action text);
  INSERT INTO employees VALUES ('staff','staff'),('manager','manager');`;
(async () => {
  let checks = 0;
  const db = new PGlite();
  const legacy = new PGlite();
  const existingRoles = new PGlite();
  try {
    await existingRoles.exec(initial + `
      INSERT INTO roles VALUES('existing-cashier','CASHIER','Existing cashier','customized',4),('existing-employee','EXPENSE_EMPLOYEE','Existing employee','customized',5);
      INSERT INTO permissions VALUES('existing-permission','custom-resource','read','Existing permission');
      INSERT INTO role_permissions VALUES('existing-cashier','existing-permission'),('existing-employee','existing-permission');
      INSERT INTO user_roles VALUES('existing-cashier-user','existing-cashier'),('existing-employee-user','existing-employee');
    `);
    await existingRoles.exec(migration);
    assert.deepEqual((await existingRoles.query('SELECT role_id,permission_id FROM role_permissions ORDER BY role_id')).rows, [
      { role_id: 'existing-cashier', permission_id: 'existing-permission' },
      { role_id: 'existing-employee', permission_id: 'existing-permission' },
    ]); checks++;
    assert.equal((await existingRoles.query("SELECT COUNT(*)::int AS n FROM roles WHERE id IN ('expense-employee-template','expense-cashier-template')")).rows[0].n, 0); checks++;
    assert.equal((await existingRoles.query("SELECT COUNT(*)::int AS n FROM roles WHERE description='customized'")).rows[0].n, 2); checks++;
    assert.deepEqual((await existingRoles.query('SELECT user_id,role_id FROM user_roles ORDER BY user_id')).rows, [
      { user_id: 'existing-cashier-user', role_id: 'existing-cashier' },
      { user_id: 'existing-employee-user', role_id: 'existing-employee' },
    ]); checks++;
    await legacy.exec(initial + "INSERT INTO payment_tasks VALUES ('legacy1','same','pending'),('legacy2','same','pending');");
    await assert.rejects(legacy.exec(migration), /Duplicate expense payment tasks require accounting review/); checks++;
    assert.equal((await legacy.query('SELECT COUNT(*)::int AS n FROM payment_tasks')).rows[0].n, 2); checks++;
    assert.equal((await legacy.query("SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name='employees' AND column_name='supervisor_employee_id'")).rows[0].n, 0); checks++;
    await db.exec(initial + "INSERT INTO payment_tasks VALUES ('unrelated',NULL,'pending');");
    await db.exec(migration);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM employees WHERE supervisor_employee_id IS NULL')).rows[0].n, 2); checks++;
    await assert.rejects(db.exec("UPDATE employees SET supervisor_employee_id='staff' WHERE id='staff'"), /employees_no_self_supervisor/); checks++;
    await assert.rejects(db.exec("UPDATE employees SET supervisor_employee_id='missing' WHERE id='staff'"), /employees_supervisor_employee_id_fkey/); checks++;
    await db.exec("UPDATE employees SET supervisor_employee_id='manager' WHERE id='staff'; INSERT INTO expense_requests(id,status) VALUES('request','pending'); INSERT INTO approval_steps(id,expense_request_id) VALUES('step','request');");
    const approve = () => db.transaction(async (tx) => {
      const changed = await tx.query("UPDATE approval_steps SET status='approved' WHERE id='step' AND status='pending' RETURNING id");
      if (changed.rows.length !== 1) throw Error('decision conflict');
      await tx.exec("UPDATE expense_requests SET status='approved' WHERE id='request'; INSERT INTO payment_tasks VALUES('task','request','pending'); INSERT INTO expense_request_histories VALUES('request','approved');");
    });
    const results = await Promise.allSettled([approve(), approve()]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); checks++;
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM payment_tasks WHERE expense_request_id='request'")).rows[0].n, 1); checks++;
    await assert.rejects(db.exec("INSERT INTO payment_tasks VALUES('duplicate','request','pending')"), /payment_tasks_expense_request_id_key/); checks++;
    const pay = () => db.transaction(async (tx) => {
      const changed = await tx.query("UPDATE expense_requests SET status='paid',payment_status='paid' WHERE id='request' AND status='approved' AND payment_status <> 'paid' RETURNING id");
      if (changed.rows.length !== 1) throw Error('payment conflict');
      const task = await tx.query("UPDATE payment_tasks SET status='paid' WHERE expense_request_id='request' AND status='pending' RETURNING id");
      if (task.rows.length !== 1) throw Error('task conflict');
      await tx.exec("INSERT INTO expense_request_histories VALUES('request','payment_recorded');");
    });
    const paid = await Promise.allSettled([pay(), pay()]);
    assert.equal(paid.filter((r) => r.status === 'fulfilled').length, 1); checks++;
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM expense_request_histories WHERE action='payment_recorded'")).rows[0].n, 1); checks++;
    assert.equal((await db.query("SELECT status FROM payment_tasks WHERE id='task'")).rows[0].status, 'paid'); checks++;
    // Only one explicitly confirmed legacy assignment may claim a request version.
    await db.exec("INSERT INTO expense_requests(id,status,updated_at) VALUES('legacy','pending','2026-09-23T00:00:00Z');");
    const assignLegacy = () => db.transaction(async (tx) => {
      const claimed = await tx.query("UPDATE expense_requests SET updated_at='2026-09-23T00:00:00.001Z' WHERE id='legacy' AND status='pending' AND updated_at='2026-09-23T00:00:00Z' AND NOT EXISTS(SELECT 1 FROM approval_steps WHERE expense_request_id='legacy') RETURNING id");
      if (claimed.rows.length !== 1) throw Error('legacy assignment conflict');
      await tx.exec("INSERT INTO approval_steps(id,expense_request_id) VALUES('legacy-supervisor','legacy'),('legacy-accountant','legacy'); INSERT INTO expense_request_histories VALUES('legacy','approval_assigned');");
    });
    const assigned = await Promise.allSettled([assignLegacy(), assignLegacy()]);
    assert.equal(assigned.filter((result) => result.status === 'fulfilled').length, 1); checks++;
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM approval_steps WHERE expense_request_id='legacy'")).rows[0].n, 2); checks++;
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM expense_request_histories WHERE expense_request_id='legacy' AND action='approval_assigned'")).rows[0].n, 1); checks++;
    assert.equal((await db.query("SELECT status FROM expense_requests WHERE id='legacy'")).rows[0].status, 'pending'); checks++;
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM payment_tasks WHERE expense_request_id='legacy'")).rows[0].n, 0); checks++;
    // A missing matching payable must roll back the claimed expense state.
    await db.exec("INSERT INTO expense_requests(id,status) VALUES('missing-task','approved');");
    await assert.rejects(db.transaction(async (tx) => {
      await tx.exec("UPDATE expense_requests SET status='paid' WHERE id='missing-task' AND status='approved';");
      throw Error('missing payable');
    }), /missing payable/); checks++;
    assert.equal((await db.query("SELECT status FROM expense_requests WHERE id='missing-task'")).rows[0].status, 'approved'); checks++;
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM payment_tasks WHERE id='unrelated' AND expense_request_id IS NULL")).rows[0].n, 1); checks++;
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM roles WHERE code IN ('EXPENSE_EMPLOYEE','CASHIER')")).rows[0].n, 2); checks++;
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM user_roles')).rows[0].n, 0); checks++;
    console.log(`${checks} isolated PostgreSQL migration/constraint/transaction checks passed`);
  } finally { await db.close(); await legacy.close(); await existingRoles.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
