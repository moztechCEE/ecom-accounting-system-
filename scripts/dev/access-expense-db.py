"""DEV-only expense migration and isolated QA identities; never load production secrets.

Root must start the Cloud SQL proxy on 127.0.0.1:15442 separately.
inspect is read-only. migrate applies only the reviewed expense migration.
fixtures/cleanup operate only on a private manifest of newly generated QA UUIDs.
No command prints passwords, hashes, tokens, connection URLs or full user rows.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = '20260923013000_expense_supervisor_workflow'
DATABASE = 'erp_dev_20260921'
DB_USER = 'erp_dev_runtime'
SERVICE = 'corely-erp-api-dev'
PSQL = '/opt/homebrew/opt/libpq/bin/psql'
PREFIX = 'DEV-EXPENSE-AI-'
TABLES = ['_prisma_migrations', 'entities', 'users', 'roles', 'permissions',
          'role_permissions', 'user_roles', 'user_entity_memberships', 'employees',
          'departments', 'accounts', 'bank_accounts', 'reimbursement_items',
          'expense_requests', 'approval_steps', 'expense_request_histories',
          'payment_tasks', 'wms_portal_sessions']


def fail(message):
    raise RuntimeError(message)


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def cloud(*args):
    result = subprocess.run(['gcloud', *args, '--project=moztech-main-db'],
                            text=True, capture_output=True)
    if result.returncode:
        fail('DEV metadata/secret lookup failed; credential-bearing output suppressed')
    return result.stdout.strip()


def connection():
    service = json.loads(cloud('run', 'services', 'describe', SERVICE,
                               '--region=asia-east1', '--format=json'))
    values = {entry['name']: entry for entry in service['spec']['template']['spec']['containers'][0]['env']}
    if values.get('DB_NAME', {}).get('value') != DATABASE or values.get('DB_USER', {}).get('value') != DB_USER:
        fail('Refusing a service without the exact DEV database and runtime user')
    if values.get('ERP_DEV_SANDBOX', {}).get('value') != 'true':
        fail('DEV sandbox must remain enabled')
    value = values['DB_PASSWORD']
    password = value.get('value')
    if password is None:
        ref = value.get('valueFrom', {}).get('secretKeyRef', {})
        if 'dev' not in ref.get('name', '').lower():
            fail('Refusing a password reference without DEV in the secret name')
        password = cloud('secrets', 'versions', 'access', ref['key'], '--secret=' + ref['name'])
    if not password:
        fail('DEV database password unavailable')
    env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': '15442',
           'PGDATABASE': DATABASE, 'PGUSER': DB_USER, 'PGPASSWORD': password,
           'PGCONNECT_TIMEOUT': '10', 'PGOPTIONS': '-c search_path=public'}
    # Ignore ambient production libpq connection overrides.
    for key in ['PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGHOSTADDR']:
        env.pop(key, None)
    return env


def sql(query, env, stage='query'):
    result = subprocess.run([PSQL, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
                            input=query, text=True, capture_output=True, env=env)
    if result.returncode:
        fail(f'DEV {stage} failed (psql exit {result.returncode}); SQL/error output suppressed')
    return result.stdout.strip()


def rows(query, env):
    return json.loads(sql("SELECT COALESCE(json_agg(row_to_json(q)), '[]') FROM (" + query + ') q;', env))


def identity_guard(env):
    row = rows('SELECT current_database() AS database, current_user AS username, current_schema() AS schema', env)[0]
    if row != {'database': DATABASE, 'username': DB_USER, 'schema': 'public'}:
        fail('Database identity guard failed')
    return row


def migration_objects(env):
    return rows("""SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='employees' AND column_name='supervisor_employee_id' AND data_type='text' AND is_nullable='YES') AS supervisor_column,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.employees'::regclass AND conname='employees_supervisor_employee_id_fkey' AND contype='f' AND confrelid='public.employees'::regclass) AS supervisor_fk,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.employees'::regclass AND conname='employees_no_self_supervisor' AND contype='c') AS supervisor_check,
      EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace AND c.relname='payment_tasks_expense_request_id_key' AND i.indrelid='public.payment_tasks'::regclass AND i.indisunique AND i.indisvalid AND pg_get_indexdef(i.indexrelid) LIKE '%(expense_request_id)%') AS unique_payable""", env)[0]


def inspect(env):
    identity = identity_guard(env)
    existing = {row['tablename'] for row in rows("SELECT tablename FROM pg_tables WHERE schemaname='public'", env)}
    missing = sorted(set(TABLES) - existing)
    if missing:
        return {'identity': identity, 'missingTables': missing, 'canMigrate': False}
    content = (ROOT / 'backend/prisma/migrations' / MIGRATION / 'migration.sql').read_bytes()
    ledger = rows('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations WHERE migration_name=' + quote(MIGRATION), env)
    failed = rows("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL", env)
    duplicates = int(sql("SELECT COUNT(*) FROM (SELECT expense_request_id FROM payment_tasks WHERE expense_request_id IS NOT NULL GROUP BY expense_request_id HAVING COUNT(*)>1) d;", env))
    ownership = rows("SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner, pg_has_role(current_user,c.relowner,'USAGE') AS can_alter FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('employees','payment_tasks') ORDER BY c.relname", env)
    privilege = rows("SELECT table_name,has_table_privilege(current_user,'public.'||table_name,'INSERT') AS can_insert FROM unnest(ARRAY['roles','permissions','role_permissions','_prisma_migrations']) AS targets(table_name)", env)
    scope_columns = rows("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name IN ('accounting_data_scope','banking_data_scope','employee_data_scope') ORDER BY column_name", env)
    legacy = int(sql("SELECT COUNT(*) FROM expense_requests e WHERE status='pending' AND NOT EXISTS(SELECT 1 FROM approval_steps a WHERE a.expense_request_id=e.id);", env))
    return {'identity': identity, 'missingTables': [], 'expectedChecksum': hashlib.sha256(content).hexdigest(),
            'ledger': ledger, 'unfinishedMigrations': failed, 'duplicateExpensePaymentGroups': duplicates,
            'objects': migration_objects(env), 'tableOwnership': ownership, 'insertPrivileges': privilege,
            'dataScopeColumns': [row['column_name'] for row in scope_columns], 'legacyPendingWithoutSteps': legacy,
            'canMigrate': not failed and duplicates == 0 and len(ownership) == 2 and all(row['can_alter'] for row in ownership) and all(row['can_insert'] for row in privilege)}


def verify_applied(report):
    complete = [row for row in report.get('ledger', []) if row['finished_at'] and not row['rolled_back_at']]
    if len(complete) != 1 or complete[0]['checksum'] != report['expectedChecksum'] or not all(report['objects'].values()):
        fail('Migration ledger/checksum/objects do not match; manual DEV reconciliation required')


def migrate(env):
    report = inspect(env)
    if report.get('ledger'):
        verify_applied(report)
        print('Reviewed DEV expense migration already applied and verified; skipped')
        return
    if not report['canMigrate']:
        fail('Migration preflight failed; inspect ownership, duplicate tasks, unfinished migrations and required tables. No privilege escalation is attempted')
    if any(report['objects'].values()):
        fail('Partial expense schema exists without ledger; refusing to guess or reapply')
    content = (ROOT / 'backend/prisma/migrations' / MIGRATION / 'migration.sql').read_text()
    sql("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n" + content + '\nCOMMIT;', env, 'expense migration')
    # Prisma resolve records exactly this additive migration; no migrate deploy or seed.
    runtime = {**env, 'DATABASE_URL': 'postgresql://' + DB_USER + ':' + urllib.parse.quote(env['PGPASSWORD'], safe='') + '@127.0.0.1:15442/' + DATABASE + '?schema=public'}
    result = subprocess.run(['node_modules/.bin/prisma', 'migrate', 'resolve', '--applied', MIGRATION],
                            cwd=ROOT / 'backend', env=runtime, text=True, capture_output=True)
    if result.returncode:
        fail('DEV schema committed but Prisma resolve failed; do not replay SQL. Inspect and resolve only this migration after review')
    verify_applied(inspect(env))
    print('Reviewed DEV expense migration applied and checksum/objects verified')


def manifest_path(value):
    path = Path(value).expanduser().resolve()
    if not path.is_relative_to(Path('/tmp').resolve()):
        fail('QA manifest must be stored under /tmp, outside the repository')
    return path


def save_manifest(path, data, exclusive=False):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC) | os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        os.fchmod(handle.fileno(), 0o600)
        json.dump(data, handle, ensure_ascii=False, indent=2)


def fixtures(env, path):
    verify_applied(inspect(env))
    if path.exists():
        fail('A QA manifest already exists; use its exact IDs or choose a fresh manifest')
    tag = secrets.token_hex(4).upper()
    identifier = lambda: str(uuid.uuid4())
    entity, department, account, item, bank = [identifier() for _ in range(5)]
    role_ids = {'staff': identifier(), 'cashier': identifier()}
    role_codes = {'staff': 'QA_EXPENSE_STAFF_' + tag, 'cashier': 'QA_EXPENSE_CASHIER_' + tag}
    users = {kind: {'id': identifier(), 'employeeId': identifier() if kind != 'admin' else None,
                    'email': 'qa-expense-ai-' + kind + '-' + tag.lower() + '@employees.example',
                    'name': PREFIX + tag + ' ' + kind, 'password': secrets.token_urlsafe(24)}
             for kind in ['employee', 'manager', 'cashier', 'admin']}
    needed = [('expense_self', 'read'), ('expense_self', 'create'), ('accounts', 'read'), ('banking', 'read'), ('banking', 'update')]
    permissions = rows("SELECT id,resource,action FROM permissions WHERE (resource,action) IN (" + ','.join('(' + quote(r) + ',' + quote(a) + ')' for r, a in needed) + ')', env)
    if {(row['resource'], row['action']) for row in permissions} != set(needed):
        fail('Required expense/cashier permissions missing; no QA rows created')
    admin_roles = rows("SELECT id FROM roles WHERE code='ADMIN'", env)
    if len(admin_roles) != 1:
        fail('Expected existing ADMIN role missing; no existing role will be altered')
    for kind, user in users.items():
        user['roleId'] = admin_roles[0]['id'] if kind == 'admin' else role_ids['cashier' if kind == 'cashier' else 'staff']
        user['employeeNo'] = 'QAEXP' + tag + {'employee': 'E', 'manager': 'M', 'cashier': 'C', 'admin': 'A'}[kind]
    manifest = {'version': 1, 'database': DATABASE, 'tag': tag, 'prefix': PREFIX + tag,
                'entityId': entity, 'loginCode': 'QAEXP' + tag, 'departmentId': department,
                'accountId': account, 'itemId': item, 'bankAccountId': bank,
                'roleIds': role_ids, 'roleCodes': role_codes, 'users': users, 'phase': 'prepared',
                'apiBase': 'https://corely-erp-api-dev-sp5g377smq-de.a.run.app/api/v1',
                'webBase': 'https://corely-erp-dev-sp5g377smq-de.a.run.app'}
    # Hash only new synthetic passwords locally. No DB operation occurs in this subprocess.
    hashed = subprocess.run(['node', '-e', "const fs=require('fs'),b=require('./node_modules/bcrypt');Promise.all(JSON.parse(fs.readFileSync(0,'utf8')).map(p=>b.hash(p,10))).then(x=>process.stdout.write(JSON.stringify(x)))"],
                            cwd=ROOT / 'backend', input=json.dumps([u['password'] for u in users.values()]),
                            text=True, capture_output=True)
    if hashed.returncode:
        fail('Local synthetic-password hashing failed')
    hashes = json.loads(hashed.stdout)
    statements = [
        "INSERT INTO entities(id,login_code,name,country,base_currency,is_active) VALUES(" + ','.join(map(quote, [entity, manifest['loginCode'], manifest['prefix'] + ' QA company', 'TW', 'TWD'])) + ',true)',
        "INSERT INTO departments(id,entity_id,name,is_active) VALUES(" + ','.join(map(quote, [department, entity, manifest['prefix'] + ' QA department'])) + ',true)',
    ]
    for kind in ['staff', 'cashier']:
        statements.append("INSERT INTO roles(id,code,name,description,hierarchy_level) VALUES(" + ','.join(map(quote, [role_ids[kind], role_codes[kind], manifest['prefix'] + ' ' + kind, 'Isolated DEV expense acceptance role'])) + ',3)')
        selected = [row for row in permissions if kind == 'cashier' or row['resource'] == 'expense_self']
        statements.extend('INSERT INTO role_permissions(role_id,permission_id) VALUES(' + quote(role_ids[kind]) + ',' + quote(row['id']) + ')' for row in selected)
    for (kind, user), password_hash in zip(users.items(), hashes):
        scope = 'ENTITY' if kind in ['cashier', 'admin'] else 'SELF'
        statements.append("INSERT INTO users(id,email,password_hash,name,is_active,must_change_password,accounting_data_scope,banking_data_scope,employee_data_scope,updated_at) VALUES(" + ','.join(map(quote, [user['id'], user['email'], password_hash, user['name']])) + ',true,false,' + ','.join(map(quote, [scope, scope, 'ENTITY' if kind == 'admin' else 'SELF'])) + ',NOW())')
        statements.append('INSERT INTO user_entity_memberships(user_id,entity_id,is_primary) VALUES(' + quote(user['id']) + ',' + quote(entity) + ',true)')
        statements.append('INSERT INTO user_roles(user_id,role_id) VALUES(' + quote(user['id']) + ',' + quote(user['roleId']) + ')')
    for kind in ['manager', 'employee', 'cashier']:
        user = users[kind]
        supervisor = quote(users['manager']['employeeId']) if kind == 'employee' else 'NULL'
        statements.append("INSERT INTO employees(id,entity_id,user_id,employee_no,name,country,department_id,supervisor_employee_id,hire_date,salary_base_original,salary_base_currency,salary_base_fx_rate,salary_base_base,is_active,updated_at) VALUES(" + ','.join(map(quote, [user['employeeId'], entity, user['id'], user['employeeNo'], user['name'], 'TW', department])) + ',' + supervisor + ",CURRENT_DATE,0,'TWD',1,0,true,NOW())")
    statements.append("INSERT INTO accounts(id,entity_id,code,name,type,is_active,is_reimbursable,description,updated_at) VALUES(" + ','.join(map(quote, [account, entity, 'QAEXP-' + tag, manifest['prefix'] + ' QA expense', 'expense'])) + ",true,true,'Synthetic DEV account; never post real entries',NOW())")
    statements.append("INSERT INTO reimbursement_items(id,entity_id,name,account_id,is_active,keywords,allowed_roles,allowed_departments,default_tax_type,updated_at) VALUES(" + ','.join(map(quote, [item, entity, manifest['prefix'] + ' QA reimbursement', account])) + ',true,' + ','.join(map(quote, ['DEV QA receipt', role_codes['staff'], department, 'NON_DEDUCTIBLE_5_PERCENT'])) + ',NOW())')
    bank_meta = json.dumps({'bankVisibleUserIds': [users['cashier']['id'], users['admin']['id']], 'acceptanceFixture': manifest['prefix']})
    statements.append("INSERT INTO bank_accounts(id,entity_id,bank_name,account_no,currency,is_active,meta_json) VALUES(" + ','.join(map(quote, [bank, entity, manifest['prefix'] + ' NOT A REAL BANK', 'DEV-NOT-BANK-' + tag, 'TWD'])) + ',true,' + quote(bank_meta) + '::jsonb)')
    save_manifest(path, manifest, exclusive=True)
    sql("BEGIN; SET LOCAL lock_timeout='5s';\n" + ';\n'.join(statements) + ';\nCOMMIT;', env, 'isolated QA fixture transaction')
    manifest['phase'] = 'active'
    save_manifest(path, manifest)
    print(json.dumps({'result': 'created isolated DEV QA fixtures', 'manifest': str(path), 'tag': tag, 'users': len(users), 'entityId': entity}))


def load_manifest(path):
    if not path.is_file() or stat.S_IMODE(path.stat().st_mode) & 0o077:
        fail('Missing QA manifest or unsafe file permissions; expected mode 0600')
    manifest = json.loads(path.read_text())
    if manifest.get('version') != 1 or manifest.get('database') != DATABASE or not manifest.get('prefix', '').startswith(PREFIX):
        fail('Unrecognized QA manifest')
    return manifest


def load_receipt(path, manifest):
    receipt = json.loads(Path(path).read_text())
    if receipt.get('tag') != manifest['tag'] or receipt.get('entityId') != manifest['entityId']:
        fail('QA receipt does not match the manifest')
    return receipt


def verify(env, path, receipt_path):
    if not receipt_path:
        fail('verify requires --receipt from the authenticated QA harness')
    manifest = load_manifest(path)
    receipt = load_receipt(receipt_path, manifest)
    request_id = receipt.get('expenseRequestId', '')
    if str(uuid.UUID(request_id)) != request_id:
        fail('Expected a canonical expense request UUID')
    found = rows('SELECT entity_id,created_by,description,status,payment_status,amount_original,amount_currency FROM expense_requests WHERE id=' + quote(request_id), env)
    if len(found) != 1 or found[0]['entity_id'] != manifest['entityId'] or found[0]['created_by'] != manifest['users']['employee']['id'] or manifest['prefix'] not in found[0]['description']:
        fail('Expense request is not the manifest employee/company/run-tag fixture')
    tasks = rows('SELECT status,amount_original,amount_currency,paid_date FROM payment_tasks WHERE expense_request_id=' + quote(request_id), env)
    payment_history = int(sql("SELECT COUNT(*) FROM expense_request_histories WHERE action='payment_recorded' AND expense_request_id=" + quote(request_id), env))
    checks = {
        'qaIdentityConfirmed': True,
        'expensePaid': found[0]['status'] == 'paid' and found[0]['payment_status'] == 'paid',
        'exactlyOnePaymentTask': len(tasks) == 1,
        'taskPaidAndAmountsMatch': len(tasks) == 1 and tasks[0]['status'] == 'paid' and tasks[0]['paid_date'] is not None and tasks[0]['amount_original'] == found[0]['amount_original'] and tasks[0]['amount_currency'] == found[0]['amount_currency'],
        'exactlyOnePaymentHistory': payment_history == 1,
    }
    print(json.dumps({'tag': manifest['tag'], 'expenseRequestId': request_id, 'checks': checks, 'passed': all(checks.values())}, indent=2))
    if not all(checks.values()):
        fail('DEV QA database verification failed')


def cleanup(env, path, receipt_path=None):
    manifest = load_manifest(path)
    identity_guard(env)
    users = manifest['users']
    ids = [user['id'] for user in users.values()]
    entity = manifest['entityId']
    all_ids = ids + [entity, manifest['departmentId'], manifest['accountId'], manifest['itemId'], manifest['bankAccountId']] + list(manifest['roleIds'].values()) + [u['employeeId'] for u in users.values() if u['employeeId']]
    for value in all_ids:
        if str(uuid.UUID(value)) != value:
            fail('Manifest contains a non-canonical UUID')
    existing_entity = rows('SELECT id,name,login_code FROM entities WHERE id=' + quote(entity), env)
    if not existing_entity and manifest['phase'] == 'prepared':
        manifest['phase'] = 'not-created'
        save_manifest(path, manifest)
        print('Prepared fixture transaction never created this QA company; no database rows changed')
        return
    if len(existing_entity) != 1 or existing_entity[0]['name'] != manifest['prefix'] + ' QA company' or existing_entity[0]['login_code'] != manifest['loginCode']:
        fail('QA company identity mismatch; cleanup refused')
    actual = rows('SELECT id,email FROM users WHERE id IN (' + ','.join(map(quote, ids)) + ')', env)
    expected = {u['id']: u['email'] for u in users.values()}
    if {row['id']: row['email'] for row in actual} != expected or any(not email.startswith('qa-expense-ai-') for email in expected.values()):
        fail('QA user identity mismatch; cleanup refused')
    outsiders = int(sql('SELECT COUNT(*) FROM user_entity_memberships WHERE entity_id=' + quote(entity) + ' AND user_id NOT IN (' + ','.join(map(quote, ids)) + ')', env))
    if outsiders:
        fail('QA company now has a non-manifest member; cleanup refused')
    employee_ids = [u['employeeId'] for u in users.values() if u['employeeId']]
    employees = rows('SELECT id,user_id,entity_id FROM employees WHERE id IN (' + ','.join(map(quote, employee_ids)) + ')', env)
    if {row['id']: (row['user_id'], row['entity_id']) for row in employees} != {u['employeeId']: (u['id'], entity) for u in users.values() if u['employeeId']}:
        fail('QA employee binding mismatch; cleanup refused')
    for table, key in [('departments', 'departmentId'), ('accounts', 'accountId'), ('bank_accounts', 'bankAccountId'), ('reimbursement_items', 'itemId')]:
        if sql('SELECT COUNT(*) FROM ' + table + ' WHERE id=' + quote(manifest[key]) + ' AND entity_id=' + quote(entity), env) != '1':
            fail('QA fixture company mismatch; cleanup refused')
    user_filter = ' IN (' + ','.join(map(quote, ids)) + ')'
    cloned_roles = []
    if receipt_path:
        cloned_roles = load_receipt(receipt_path, manifest).get('createdRoleIds', [])
        for role_id in cloned_roles:
            if str(uuid.UUID(role_id)) != role_id:
                fail('Non-canonical QA cloned role UUID')
            role = rows('SELECT code,name FROM roles WHERE id=' + quote(role_id), env)
            if not role:
                continue
            if len(role) != 1 or not role[0]['code'].startswith('QA_ACCESS_') or role[0]['name'] != manifest['prefix'] + ' temporary access template':
                fail('Receipt contains a role outside this QA run; cleanup refused')
            if sql('SELECT COUNT(*) FROM user_roles WHERE role_id=' + quote(role_id) + ' AND user_id NOT' + user_filter, env) != '0':
                fail('QA cloned role is assigned to a non-manifest account; cleanup refused')
    statements = [
        'UPDATE users SET is_active=false,updated_at=NOW() WHERE id' + user_filter,
        'UPDATE wms_portal_sessions SET revoked_at=NOW() WHERE user_id' + user_filter + ' AND revoked_at IS NULL',
        'DELETE FROM user_roles WHERE user_id' + user_filter,
        'UPDATE employees SET is_active=false,updated_at=NOW() WHERE id IN (' + ','.join(map(quote, employee_ids)) + ') AND entity_id=' + quote(entity),
        'UPDATE entities SET is_active=false WHERE id=' + quote(entity),
    ]
    for table, key in [('departments', 'departmentId'), ('accounts', 'accountId'), ('bank_accounts', 'bankAccountId'), ('reimbursement_items', 'itemId')]:
        statements.append('UPDATE ' + table + ' SET is_active=false WHERE id=' + quote(manifest[key]) + ' AND entity_id=' + quote(entity))
    for role_id in cloned_roles:
        statements.append('SELECT id FROM roles WHERE id=' + quote(role_id) + ' FOR UPDATE')
        statements.append("DO $$ BEGIN IF EXISTS(SELECT 1 FROM user_roles WHERE role_id=" + quote(role_id) + ") THEN RAISE EXCEPTION 'QA role gained an assignment; abort cleanup'; END IF; END $$")
        statements.append('DELETE FROM roles WHERE id=' + quote(role_id) + ' AND name=' + quote(manifest['prefix'] + ' temporary access template'))
    sql('BEGIN;\n' + ';\n'.join(statements) + ';\nCOMMIT;', env, 'QA deactivation')
    manifest['phase'] = 'disabled'
    for user in users.values():
        user.pop('password', None)
    save_manifest(path, manifest)
    print('Only manifest QA identities deactivated; sessions revoked and roles detached. Expense/payment/audit rows retained')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['inspect', 'migrate', 'fixtures', 'verify', 'cleanup'])
    parser.add_argument('--manifest', default='/tmp/corely-access-expense-ai-qa/manifest.json')
    parser.add_argument('--receipt', help='QA harness result JSON; required for verify, optional for cloned-role cleanup')
    args = parser.parse_args()
    env = connection()
    identity_guard(env)
    if args.mode == 'inspect':
        print(json.dumps(inspect(env), ensure_ascii=False, indent=2))
    elif args.mode == 'migrate':
        migrate(env)
    elif args.mode == 'fixtures':
        fixtures(env, manifest_path(args.manifest))
    elif args.mode == 'verify':
        verify(env, manifest_path(args.manifest), args.receipt)
    else:
        cleanup(env, manifest_path(args.manifest), args.receipt)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not echo subprocess outputs, payloads or tracebacks with local secrets.
        print('ERROR: ' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
