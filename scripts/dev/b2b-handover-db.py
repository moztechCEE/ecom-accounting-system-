#!/usr/bin/env python3
"""Inspect or apply only the reviewed B2B, landed-cost and WMS handover DEV migrations.

Start Cloud SQL Auth Proxy on 127.0.0.1:15442 separately. No production
credentials, migrations or service mutations are accepted. `inspect` is read
only; `apply` requires an explicit private receipt path under /tmp.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.parse

ROOT = Path(__file__).resolve().parents[2]
PROJECT = 'moztech-main-db'
SERVICE = 'corely-erp-api-dev'
DATABASE = 'erp_dev_20260921'
DB_USER = 'erp_dev_runtime'
INSTANCE = 'moztech-main-db:asia-east1:moztech-main-db'
PSQL = '/opt/homebrew/opt/libpq/bin/psql'
MIGRATIONS = (
    ('20260923080000_b2b_customer_portal', 'fd62bc6551f91b6e3adf015a8ad264bb51dd50c8df630aa7efb4ababdc2adbfb',
     ('b2b_accounts', 'b2b_sessions', 'b2b_catalog_items', 'b2b_customer_prices', 'b2b_purchase_requests', 'b2b_request_items')),
    ('20260923090000_purchase_landed_cost', 'faf701d2fa723bd742c215aca17c195e009be02a6d32ef6a555b713f45993b69',
     ('purchase_landed_costs', 'purchase_landed_cost_lines')),
    ('20260923100000_wms_handover_reconciliation', 'd1229da385b8e196265c513a06ffde18eceaafe4971d1e4dfc4c0c46413a9114',
     ('wms_handover_inbox', 'shipment_lines', 'wms_shipment_postings')),
)
REFERENCED_TABLES = ('entities', 'customers', 'vendors', 'products', 'sales_orders',
                     'purchase_orders', 'purchase_order_items', 'shipments',
                     'warehouses', 'sales_order_items', 'inventory_transactions', 'users')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def cloud(*args):
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT], text=True, capture_output=True)
    require(result.returncode == 0, 'DEV cloud metadata/secret lookup failed; output suppressed')
    return result.stdout.strip()


def connection():
    service = json.loads(cloud('run', 'services', 'describe', SERVICE, '--region=asia-east1', '--format=json'))
    env = {entry['name']: entry for entry in service['spec']['template']['spec']['containers'][0]['env']}
    for key, expected in {'DB_NAME': DATABASE, 'DB_USER': DB_USER, 'CLOUDSQL_INSTANCE': INSTANCE,
                          'ERP_DEV_SANDBOX': 'true', 'SEED_ON_STARTUP': 'false',
                          'RUNTIME_SCHEDULES_ENABLED': 'false'}.items():
        require(env.get(key, {}).get('value') == expected, 'DEV service protection changed: ' + key)
    secret = env['DB_PASSWORD'].get('valueFrom', {}).get('secretKeyRef', {})
    require('dev' in secret.get('name', '').lower() and secret.get('key'), 'Expected a DEV-only database secret reference')
    password = cloud('secrets', 'versions', 'access', secret['key'], '--secret=' + secret['name'])
    require(password, 'DEV database credential unavailable')
    result = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': '15442', 'PGDATABASE': DATABASE,
              'PGUSER': DB_USER, 'PGPASSWORD': password, 'PGCONNECT_TIMEOUT': '10',
              'PGOPTIONS': '-c search_path=public'}
    for key in ('PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGHOSTADDR'):
        result.pop(key, None)
    return result


def sql(query, env, stage):
    result = subprocess.run([PSQL, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
                            input=query, text=True, capture_output=True, env=env)
    require(result.returncode == 0, f'DEV {stage} failed (psql exit {result.returncode}); SQL and credential-bearing output suppressed')
    return result.stdout.strip()


def rows(query, env):
    return json.loads(sql("SELECT COALESCE(json_agg(row_to_json(q)), '[]') FROM (" + query + ') q;', env, 'inspect'))


def source():
    reviewed = []
    for name, expected, tables in MIGRATIONS:
        file = ROOT / 'backend/prisma/migrations' / name / 'migration.sql'
        require(file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest() == expected,
                'Reviewed migration checksum changed: ' + name)
        reviewed.append({'name': name, 'sha256': expected, 'tables': tables})
    return reviewed


def inspect(env):
    reviewed = source()
    identity = rows('SELECT current_database() AS database, current_user AS db_user, current_schema() AS schema', env)[0]
    require(identity == {'database': DATABASE, 'db_user': DB_USER, 'schema': 'public'}, 'Refusing a non-DEV database identity')
    ledger = rows('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations '
                  "WHERE migration_name IN ('" + "','".join(x['name'] for x in reviewed) + "') ORDER BY migration_name", env)
    by_name = {row['migration_name']: row for row in ledger}
    failed = rows('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL', env)
    require(not failed, 'Unfinished Prisma migration exists; resolve it before this release')
    existing = {row['tablename'] for row in rows("SELECT tablename FROM pg_tables WHERE schemaname='public'", env)}
    privileges = rows("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create", env)[0]
    reference = rows("SELECT table_name,has_table_privilege(current_user,'public.'||table_name,'REFERENCES') AS can_reference "
                     "FROM unnest(ARRAY['" + "','".join(REFERENCED_TABLES) + "']) AS t(table_name)", env)
    require(privileges['can_create'] and all(r['can_reference'] for r in reference),
            'DEV runtime user lacks schema CREATE or referenced-table REFERENCES privilege')
    state = []
    for item in reviewed:
        row = by_name.get(item['name'])
        present = sorted(set(item['tables']) & existing)
        if row:
            require(row['finished_at'] and not row['rolled_back_at'] and row['checksum'] == item['sha256'],
                    'Migration ledger/checksum mismatch: ' + item['name'])
            require(present == sorted(item['tables']), 'Applied migration has missing objects: ' + item['name'])
        else:
            require(not present, 'Partial schema exists without ledger: ' + item['name'])
        state.append({'name': item['name'], 'sha256': item['sha256'], 'status': 'applied' if row else 'pending',
                      'finishedAt': str(row['finished_at']) if row else None,
                      'ledgerVerified': bool(row), 'objectsVerified': bool(row)})
    # These triggers enforce append-only evidence; their absence is not an acceptable "applied" state.
    if by_name.get(MIGRATIONS[2][0]):
        triggers = rows("SELECT tgname FROM pg_trigger WHERE tgrelid IN "
                        "('public.wms_handover_inbox'::regclass,'public.shipment_lines'::regclass,"
                        "'public.wms_shipment_postings'::regclass) AND NOT tgisinternal", env)
        names = {t['tgname'] for t in triggers}
        require({'wms_handover_inbox_immutable', 'shipment_lines_immutable', 'wms_shipment_postings_immutable'} <= names,
                'Applied handover migration is missing append-only triggers')
    return {'version': 1, 'project': PROJECT, 'database': DATABASE, 'dbUser': DB_USER,
            'schema': 'public', 'migrations': state,
            'allApplied': all(row['status'] == 'applied' for row in state)}


def apply(env):
    before = inspect(env)
    for row in before['migrations']:
        if row['status'] == 'applied':
            continue
        name = row['name']
        statement = (ROOT / 'backend/prisma/migrations' / name / 'migration.sql').read_text()
        sql("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n" + statement + '\nCOMMIT;', env, name)
        database_url = 'postgresql://' + DB_USER + ':' + urllib.parse.quote(env['PGPASSWORD'], safe='') + \
                       '@127.0.0.1:15442/' + DATABASE + '?schema=public'
        runtime = {**env, 'DATABASE_URL': database_url}
        result = subprocess.run(['node_modules/.bin/prisma', 'migrate', 'resolve', '--applied', name],
                                cwd=ROOT / 'backend', env=runtime, text=True, capture_output=True)
        require(result.returncode == 0,
                'DEV SQL committed but Prisma ledger resolve failed for ' + name + '; do not replay SQL')
        require(next(item for item in inspect(env)['migrations'] if item['name'] == name)['status'] == 'applied',
                'DEV migration verification failed: ' + name)
    final = inspect(env)
    require(final['allApplied'], 'Not all reviewed migrations were applied')
    return final


def write_receipt(path, report):
    target = path.expanduser().resolve()
    require(target.is_relative_to(Path('/tmp').resolve()), 'Receipt must be under /tmp')
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(report, stream, indent=2)
        stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('inspect', 'apply'))
    parser.add_argument('--receipt', type=Path, help='Required for apply; new private path under /tmp')
    args = parser.parse_args()
    require((args.mode == 'apply') == bool(args.receipt), 'apply requires --receipt; inspect does not accept it')
    source_sha = None
    if args.mode == 'apply':
        source_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        require(re.fullmatch(r'[a-f0-9]{40}', source_sha), 'Expected a committed source SHA')
        dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()
        require(not dirty, 'Commit and review source before applying DEV migrations')
    env = connection()
    report = apply(env) if args.mode == 'apply' else inspect(env)
    if args.receipt:
        report['sourceSha'] = source_sha
        report['validatedAt'] = datetime.now(timezone.utc).isoformat()
        write_receipt(args.receipt, report)
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(str(error))
