#!/usr/bin/env python3
"""Inspect or apply only the reviewed account/performance DEV migration.

Start Cloud SQL Auth Proxy for moztech-main-db:asia-east1:moztech-main-db
on 127.0.0.1:15442 separately. `inspect` is read-only. `migrate` requires a
clean, committed source and writes a private release receipt under /tmp.
No password, connection URL, SQL failure output, or account row is printed.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse


ROOT = Path(__file__).resolve().parents[2]
PROJECT = 'moztech-main-db'
REGION = 'asia-east1'
SERVICE = 'corely-erp-api-dev'
INSTANCE = 'moztech-main-db:asia-east1:moztech-main-db'
DATABASE = 'erp_dev_20260921'
DB_USER = 'erp_dev_runtime'
PSQL = '/opt/homebrew/opt/libpq/bin/psql'
MIGRATION = '20260924010000_performance_reviews'
MIGRATION_SHA256 = '0dfd335d570acd8cbe4894fb0e80607dd39e447909dc3658edad2ffd6e8bcb1f'
PREREQUISITE = '20260923110000_department_supervisors'
PREREQUISITE_SHA256 = '16f9bd7f0a1cbd5cb17cb821b71573c4bb5c15befa9868ffbbdde1dcba62e98e'
EXISTING_TABLES = ('_prisma_migrations', 'entities', 'employees', 'roles', 'permissions',
                   'role_permissions', 'user_roles', 'users')
NEW_TABLES = ('performance_cycles', 'performance_reviews')
NEW_COLUMNS = {
    'performance_cycles': {'id', 'entity_id', 'title', 'period_start', 'period_end', 'created_at'},
    'performance_reviews': {'id', 'cycle_id', 'subject_employee_id', 'reviewer_employee_id',
                            'status', 'score', 'goals', 'comment', 'submitted_at', 'created_at', 'updated_at'},
}
NEW_CONSTRAINTS = {
    'performance_cycles_pkey', 'performance_cycles_entity_id_fkey',
    'performance_cycles_valid_period', 'performance_cycles_entity_period_unique',
    'performance_reviews_pkey', 'performance_reviews_cycle_id_fkey',
    'performance_reviews_subject_employee_id_fkey', 'performance_reviews_reviewer_employee_id_fkey',
    'performance_reviews_distinct_people', 'performance_reviews_valid_score',
    'performance_reviews_valid_status', 'performance_reviews_cycle_subject_unique',
}
NEW_INDEXES = {
    'performance_cycles_entity_created_idx', 'performance_reviews_reviewer_status_idx',
    'performance_reviews_subject_idx',
}
NEW_PERMISSIONS = {
    ('product_cost', 'read'), ('product_cost', 'update'), ('financial_margin', 'read'),
    ('financial_net_profit', 'read'), ('employee_compensation', 'read'),
    ('employee_compensation', 'update'), ('performance_reviews', 'read'),
    ('performance_reviews', 'write'), ('performance_reviews', 'manage'),
}
NEW_ROLES = {
    'PERFORMANCE_REVIEWER': '主管考核',
    'PERFORMANCE_HR': '人資考核管理',
    'PROCUREMENT_COST': '採購成本作業',
}
ROLE_GRANTS = {
    'PERFORMANCE_REVIEWER': {('performance_reviews', 'read'), ('performance_reviews', 'write')},
    'PERFORMANCE_HR': {('performance_reviews', 'read'), ('performance_reviews', 'manage')},
    'PROCUREMENT_COST': {('purchase_orders', 'read'), ('purchase_orders', 'create'),
                         ('inventory', 'read'), ('product_cost', 'read'), ('product_cost', 'update')},
    'ACCOUNTANT': {('product_cost', 'read'), ('financial_margin', 'read'),
                   ('financial_net_profit', 'read'), ('employee_compensation', 'read')},
    'ADMIN': NEW_PERMISSIONS,
    'SUPER_ADMIN': NEW_PERMISSIONS,
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def quoted(value):
    return "'" + str(value).replace("'", "''") + "'"


def cloud(*args):
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT],
                            capture_output=True, text=True)
    require(result.returncode == 0, 'DEV cloud metadata/secret lookup failed; output suppressed')
    return result.stdout.strip()


def connection():
    service = json.loads(cloud('run', 'services', 'describe', SERVICE,
                               '--region=' + REGION, '--format=json'))
    require(service.get('metadata', {}).get('name') == SERVICE,
            'Cloud Run returned a different service')
    container = service['spec']['template']['spec']['containers'][0]
    values = {entry['name']: entry for entry in container['env']}
    required = {'DB_NAME': DATABASE, 'DB_USER': DB_USER, 'CLOUDSQL_INSTANCE': INSTANCE,
                'ERP_DEV_SANDBOX': 'true', 'SEED_ON_STARTUP': 'false',
                'RUNTIME_SCHEDULES_ENABLED': 'false'}
    for key, expected in required.items():
        require(values.get(key, {}).get('value') == expected,
                'DEV service protection changed: ' + key)
    secret = values.get('DB_PASSWORD', {}).get('valueFrom', {}).get('secretKeyRef', {})
    require(secret.get('key') and 'dev' in secret.get('name', '').lower(),
            'Expected a DEV-only database secret reference')
    password = cloud('secrets', 'versions', 'access', secret['key'], '--secret=' + secret['name'])
    require(password, 'DEV database credential unavailable')
    env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': '15442',
           'PGDATABASE': DATABASE, 'PGUSER': DB_USER, 'PGPASSWORD': password,
           'PGCONNECT_TIMEOUT': '10', 'PGOPTIONS': '-c search_path=public'}
    for key in ('PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGHOSTADDR'):
        env.pop(key, None)
    return env


def sql(statement, env, stage):
    result = subprocess.run([PSQL, '-X', '-w', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
                            input=statement, capture_output=True, text=True, env=env)
    require(result.returncode == 0,
            f'DEV {stage} failed (psql exit {result.returncode}); SQL/error output suppressed')
    return result.stdout.strip()


def rows(statement, env):
    return json.loads(sql("SELECT COALESCE(json_agg(row_to_json(q)), '[]') FROM (" +
                          statement + ') q;', env, 'inspection'))


def source():
    path = ROOT / 'backend/prisma/migrations' / MIGRATION / 'migration.sql'
    require(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == MIGRATION_SHA256,
            'Reviewed performance migration checksum changed')
    prerequisite = ROOT / 'backend/prisma/migrations' / PREREQUISITE / 'migration.sql'
    require(prerequisite.is_file() and
            hashlib.sha256(prerequisite.read_bytes()).hexdigest() == PREREQUISITE_SHA256,
            'Reviewed prerequisite migration checksum changed')
    return path


def schema_objects(env):
    tables = {row['tablename'] for row in rows(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND "
        "tablename IN ('performance_cycles','performance_reviews')", env)}
    columns = rows("SELECT table_name,column_name FROM information_schema.columns "
                   "WHERE table_schema='public' AND table_name IN "
                   "('performance_cycles','performance_reviews')", env)
    by_table = {name: {row['column_name'] for row in columns if row['table_name'] == name}
                for name in NEW_TABLES}
    constraints = {row['conname'] for row in rows(
        "SELECT conname FROM pg_constraint WHERE conrelid IN "
        "('public.performance_cycles'::regclass,'public.performance_reviews'::regclass)", env)} if tables == set(NEW_TABLES) else set()
    indexes = {row['indexname'] for row in rows(
        "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN "
        "('performance_cycles','performance_reviews')", env)}
    return {'tables': sorted(tables),
            'missingColumns': {name: sorted(expected - by_table[name]) for name, expected in NEW_COLUMNS.items()},
            'missingConstraints': sorted(NEW_CONSTRAINTS - constraints),
            'missingIndexes': sorted(NEW_INDEXES - indexes)}


def catalog_state(env):
    permissions = rows("SELECT resource,action FROM permissions WHERE resource IN "
                       "('product_cost','financial_margin','financial_net_profit',"
                       "'employee_compensation','performance_reviews')", env)
    roles = rows("SELECT code,name FROM roles WHERE code IN "
                 "('SUPER_ADMIN','ADMIN','ACCOUNTANT','PERFORMANCE_REVIEWER',"
                 "'PERFORMANCE_HR','PROCUREMENT_COST') OR name IN "
                 "('主管考核','人資考核管理','採購成本作業')", env)
    grants = rows("SELECT r.code,p.resource,p.action FROM role_permissions rp "
                  "JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id "
                  "WHERE r.code IN ('SUPER_ADMIN','ADMIN','ACCOUNTANT','PERFORMANCE_REVIEWER',"
                  "'PERFORMANCE_HR','PROCUREMENT_COST')", env)
    actual_permissions = {(row['resource'], row['action']) for row in permissions}
    role_names = {row['code']: row['name'] for row in roles}
    wrong_names = sorted(code for code, expected in NEW_ROLES.items()
                         if code in role_names and role_names[code] != expected)
    name_collisions = sorted(row['name'] for row in roles
                             if row['name'] in NEW_ROLES.values() and
                             NEW_ROLES.get(row['code']) != row['name'])
    actual_grants = {(row['code'], row['resource'], row['action']) for row in grants}
    expected_grants = {(code, resource, action)
                       for code, permissions_for_role in ROLE_GRANTS.items()
                       for resource, action in permissions_for_role}
    return {'missingPermissions': sorted(NEW_PERMISSIONS - actual_permissions),
            'missingRoles': sorted(set(NEW_ROLES) - set(role_names)),
            'missingBaseRoles': sorted({'SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'} - set(role_names)),
            'wrongRoleNames': wrong_names, 'roleNameCollisions': name_collisions,
            'missingGrants': sorted(expected_grants - actual_grants)}


def inspect(env):
    source()
    identity = rows('SELECT current_database() AS database,current_user AS db_user,'
                    'current_schema() AS schema', env)[0]
    require(identity == {'database': DATABASE, 'db_user': DB_USER, 'schema': 'public'},
            'Refusing a non-DEV database identity')
    existing = {row['tablename'] for row in rows(
        "SELECT tablename FROM pg_tables WHERE schemaname='public'", env)}
    missing_tables = sorted(set(EXISTING_TABLES) - existing)
    require(not missing_tables, 'Required DEV base tables missing: ' + ','.join(missing_tables))
    ledger = rows('SELECT migration_name,checksum,finished_at,rolled_back_at '
                  'FROM _prisma_migrations WHERE migration_name IN (' +
                  ','.join(map(quoted, (PREREQUISITE, MIGRATION))) + ')', env)
    by_name = {row['migration_name']: row for row in ledger}
    before = by_name.get(PREREQUISITE)
    require(before and before['finished_at'] and not before['rolled_back_at'] and
            before['checksum'] == PREREQUISITE_SHA256,
            'Approved DEV prerequisite migration is absent or checksum differs')
    unfinished = [row['migration_name'] for row in rows(
        'SELECT migration_name FROM _prisma_migrations '
        'WHERE finished_at IS NULL AND rolled_back_at IS NULL', env)]
    require(not unfinished, 'An unfinished Prisma migration exists; review it before this release')
    owner_rows = rows("SELECT c.relname AS table_name,pg_get_userbyid(c.relowner) AS owner,"
                      "pg_has_role(current_user,c.relowner,'USAGE') AS runtime_owner "
                      "FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND "
                      "c.relname IN (" + ','.join(map(quoted, EXISTING_TABLES)) +
                      ') ORDER BY c.relname', env)
    privileges = rows("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create,"
                      "has_function_privilege(current_user,'gen_random_uuid()','EXECUTE') AS can_uuid", env)[0]
    insert_privileges = rows("SELECT table_name,has_table_privilege(current_user,'public.'||table_name,"
                             "'INSERT') AS can_insert FROM unnest(ARRAY['roles','permissions',"
                             "'role_permissions','_prisma_migrations']) AS target(table_name)", env)
    reference_privileges = rows("SELECT table_name,has_table_privilege(current_user,'public.'||table_name,"
                                "'REFERENCES') AS can_reference FROM unnest(ARRAY['entities',"
                                "'employees']) AS target(table_name)", env)
    objects = schema_objects(env)
    catalog = catalog_state(env)
    applied = by_name.get(MIGRATION)
    require(not applied or (applied['finished_at'] and not applied['rolled_back_at'] and
                            applied['checksum'] == MIGRATION_SHA256),
            'Performance migration ledger is incomplete or checksum differs')
    if applied:
        require(objects['tables'] == sorted(NEW_TABLES) and
                not any(objects[key] for key in ('missingConstraints', 'missingIndexes')) and
                not any(objects['missingColumns'].values()),
                'Applied migration objects differ from reviewed schema')
    else:
        require(not objects['tables'], 'Performance tables exist without a Prisma ledger row; do not replay SQL')
        require(not catalog['missingBaseRoles'] and not catalog['wrongRoleNames'] and
                not catalog['roleNameCollisions'],
                'Base roles missing or performance role code/name collision exists')
    can_migrate = (not applied and privileges['can_create'] and privileges['can_uuid'] and
                   all(row['runtime_owner'] for row in owner_rows) and
                   len(owner_rows) == len(EXISTING_TABLES) and
                   all(row['can_insert'] for row in insert_privileges) and
                   all(row['can_reference'] for row in reference_privileges))
    return {'version': 1, 'project': PROJECT, 'service': SERVICE, 'database': DATABASE,
            'dbUser': DB_USER, 'schema': 'public', 'migration': MIGRATION,
            'checksum': MIGRATION_SHA256, 'prerequisite': PREREQUISITE,
            'prerequisiteChecksum': PREREQUISITE_SHA256,
            'status': 'applied' if applied else 'pending',
            'objects': objects, 'catalog': catalog, 'tableOwnership': owner_rows,
            'schemaPrivileges': privileges, 'insertPrivileges': insert_privileges,
            'referencePrivileges': reference_privileges, 'canMigrate': bool(can_migrate)}


def source_sha():
    result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT,
                            capture_output=True, text=True)
    require(result.returncode == 0 and re.fullmatch(r'[a-f0-9]{40}', result.stdout.strip()),
            'Expected a committed source SHA')
    dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT,
                           capture_output=True, text=True)
    require(dirty.returncode == 0 and not dirty.stdout.strip(),
            'Commit and review source before applying the DEV migration')
    return result.stdout.strip()


def migrate(env):
    report = inspect(env)
    if report['status'] == 'applied':
        return report
    require(report['canMigrate'], 'DEV migration preflight failed; inspect privileges and ownership')
    statement = source().read_text()
    sql("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n" +
        statement + '\nCOMMIT;', env, 'performance migration')
    database_url = ('postgresql://' + DB_USER + ':' +
                    urllib.parse.quote(env['PGPASSWORD'], safe='') +
                    '@127.0.0.1:15442/' + DATABASE + '?schema=public')
    runtime = {**env, 'DATABASE_URL': database_url}
    result = subprocess.run(['node_modules/.bin/prisma', 'migrate', 'resolve', '--applied', MIGRATION],
                            cwd=ROOT / 'backend', env=runtime, capture_output=True, text=True)
    require(result.returncode == 0,
            'DEV SQL committed but Prisma resolve failed; do not replay SQL. Inspect and resolve this migration manually')
    after = inspect(env)
    require(after['status'] == 'applied', 'DEV migration ledger/object verification failed')
    require(not any(after['catalog'][key] for key in
                    ('missingPermissions', 'missingRoles', 'wrongRoleNames',
                     'roleNameCollisions', 'missingGrants')),
            'DEV migration catalog verification failed')
    return after


def receipt_path(value):
    path = Path(value).expanduser().resolve()
    require(path.is_relative_to(Path('/tmp').resolve()), 'Receipt must be a new path under /tmp')
    return path


def write_receipt(path, report, sha):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        os.fchmod(handle.fileno(), 0o600)
        json.dump({**report, 'sourceSha': sha,
                   'validatedAt': datetime.now(timezone.utc).isoformat()},
                  handle, ensure_ascii=False, indent=2)
        handle.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('inspect', 'migrate'))
    parser.add_argument('--receipt', help='Required for migrate; fresh private path under /tmp')
    args = parser.parse_args()
    require((args.mode == 'migrate') == bool(args.receipt),
            'migrate requires --receipt; inspect does not accept one')
    sha = source_sha() if args.mode == 'migrate' else None
    path = receipt_path(args.receipt) if args.receipt else None
    require(path is None or not path.exists(), 'Receipt path already exists')
    env = connection()
    report = migrate(env) if args.mode == 'migrate' else inspect(env)
    if path:
        write_receipt(path, report, sha)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print subprocess stderr, SQL, credentials, or tracebacks.
        print('ERROR: ' + (str(error) if isinstance(error, RuntimeError)
                           else type(error).__name__), file=sys.stderr)
        sys.exit(1)
