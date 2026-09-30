#!/usr/bin/env python3
"""Inspect or apply exactly the five reviewed B2B migrations to ERP DEV.

Start an authenticated Cloud SQL Auth Proxy on 127.0.0.1:15442 separately.
`inspect` is read-only. `apply --receipt /tmp/NEW.json` is an explicit DEV
mutation; never run it as a general Prisma migrate deploy or from production.
Neither mode prints credentials, connection URLs, SQL errors, or customer rows.
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
INSTANCE = 'moztech-main-db:asia-east1:moztech-main-db'
SERVICE = 'corely-erp-api-dev'
SERVICE_ACCOUNT = 'corely-erp-dev-rt@moztech-main-db.iam.gserviceaccount.com'
DATABASE = 'erp_dev_20260921'
DB_USER = 'erp_dev_runtime'
PSQL = '/opt/homebrew/opt/libpq/bin/psql'
PORT = '15442'
PREREQUISITES = {
    '20260923080000_b2b_customer_portal': 'fd62bc6551f91b6e3adf015a8ad264bb51dd50c8df630aa7efb4ababdc2adbfb',
    '20260924000000_b2b_formal_quote_procurement': '9d3ea52a95d54a8e7d60e5d6659b3b74ceebed56b006ed058348256121cb4af3',
}
MIGRATIONS = (
    ('20260929000000_b2b_public_price_books', '4f6439ebce9656fe0e9bd2e80d319252b7866e8e3177a9be34c1363f39a387ba',
     ('price_book_table', 'price_offer_table', 'discount_rule_table', 'product_composite_index', 'customer_composite_index')),
    ('20260929010000_b2b_guest_inquiries', 'a4d21d3e32343e9721a6dbc2109ba02801411e53bc67406d2f2bab19aadf3067',
     ('guest_table', 'guest_item_table', 'guest_rate_table')),
    ('20260930000000_b2b_catalog_brand', '6a90a0e5e78ebba21082d42dd9a322e45b70d2e4071a9b0bb0f8155d201a1536',
     ('brand_column', 'brand_index')),
    ('20260930010000_b2b_guest_to_request', '84ac64f6952b11a9198d75f0a5b7a689556dd51069ef2fe3ee055b27437fe313',
     ('source_kind_column', 'source_guest_column', 'source_kind_check', 'source_guest_fk', 'source_guest_unique')),
    ('20260930020000_b2b_private_quote_email', 'd92f159f39f75f20b162d31d938fb72ee10520d634acef4f5a4e0b1bb0f04267',
     ('accepted_by_email_column', 'quote_email_table', 'quote_email_token_unique')),
)
KNOWN_HISTORIC_MISMATCH = {
    '20260505120000_seed_employee_permission_model': (
        '928d58b5904cfeed3c672a3e5159fbece240a642bbbfb78dd729f6cd2e1b09a8',
        '963156ce8bb4592193600cf9bfa4fe0482ec9d985e05f589cbc0c628d9ef2aa1'),
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def cloud(*args):
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT],
                            text=True, capture_output=True)
    require(result.returncode == 0, 'DEV Cloud metadata or credential lookup failed; output suppressed')
    return result.stdout.strip()


def connection():
    service = json.loads(cloud('run', 'services', 'describe', SERVICE,
                               '--region=asia-east1', '--format=json'))
    template = service['spec']['template']
    require(template['spec']['serviceAccountName'] == SERVICE_ACCOUNT,
            'DEV runtime service account changed')
    require(template['metadata']['annotations'].get('run.googleapis.com/cloudsql-instances') == INSTANCE,
            'DEV Cloud SQL attachment changed')
    env = {item['name']: item for item in template['spec']['containers'][0]['env']}
    for key, expected in {'DB_NAME': DATABASE, 'DB_USER': DB_USER,
                          'CLOUDSQL_INSTANCE': INSTANCE, 'ERP_DEV_SANDBOX': 'true',
                          'SEED_ON_STARTUP': 'false', 'RUNTIME_SCHEDULES_ENABLED': 'false'}.items():
        require(env.get(key, {}).get('value') == expected, 'DEV service protection changed: ' + key)
    secret = env['DB_PASSWORD'].get('valueFrom', {}).get('secretKeyRef', {})
    require('dev' in secret.get('name', '').lower() and secret.get('key'),
            'Expected only a DEV database password secret')
    password = cloud('secrets', 'versions', 'access', secret['key'], '--secret=' + secret['name'])
    require(password, 'DEV database password unavailable')
    result = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': PORT,
              'PGDATABASE': DATABASE, 'PGUSER': DB_USER, 'PGPASSWORD': password,
              'PGCONNECT_TIMEOUT': '10', 'PGOPTIONS': '-c search_path=public'}
    for key in ('PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGHOSTADDR'):
        result.pop(key, None)
    return result


def sql(query, env, stage):
    result = subprocess.run([PSQL, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
                            input=query, text=True, capture_output=True, env=env)
    require(result.returncode == 0,
            f'DEV {stage} failed (psql exit {result.returncode}); SQL and credential-bearing output suppressed')
    return result.stdout.strip()


def rows(statement, env):
    query = ("BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; "
             "SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json) FROM (" + statement + ") q; COMMIT;")
    return json.loads(sql(query, env, 'read-only inspection'))


def file_hash(name):
    source = ROOT / 'backend/prisma/migrations' / name / 'migration.sql'
    require(source.is_file() and not source.is_symlink(), 'Migration file missing or symlinked: ' + name)
    return hashlib.sha256(source.read_bytes()).hexdigest()


def source():
    for name, expected in {**PREREQUISITES, **{name: digest for name, digest, _ in MIGRATIONS}}.items():
        require(file_hash(name) == expected, 'Reviewed migration checksum changed: ' + name)


def objects(env):
    return rows("""SELECT
      to_regclass('public.b2b_product_price_books') IS NOT NULL AS price_book_table,
      to_regclass('public.b2b_price_offers') IS NOT NULL AS price_offer_table,
      to_regclass('public.b2b_customer_discount_rules') IS NOT NULL AS discount_rule_table,
      to_regclass('public.products_id_entity_id_key') IS NOT NULL AS product_composite_index,
      to_regclass('public.customers_id_entity_id_key') IS NOT NULL AS customer_composite_index,
      to_regclass('public.b2b_guest_inquiries') IS NOT NULL AS guest_table,
      to_regclass('public.b2b_guest_inquiry_items') IS NOT NULL AS guest_item_table,
      to_regclass('public.b2b_guest_rate_buckets') IS NOT NULL AS guest_rate_table,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='b2b_product_price_books' AND column_name='brand') AS brand_column,
      to_regclass('public.b2b_product_price_books_public_brand_idx') IS NOT NULL AS brand_index,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='b2b_purchase_requests' AND column_name='source_kind') AS source_kind_column,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='b2b_purchase_requests' AND column_name='source_guest_inquiry_id') AS source_guest_column,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.b2b_purchase_requests'::regclass
        AND conname='b2b_purchase_requests_source_kind_valid') AS source_kind_check,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.b2b_purchase_requests'::regclass
        AND conname='b2b_purchase_requests_source_guest_inquiry_id_entity_id_fkey') AS source_guest_fk,
      to_regclass('public.b2b_purchase_requests_source_guest_inquiry_id_key') IS NOT NULL AS source_guest_unique,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='b2b_issued_quotes' AND column_name='accepted_by_email') AS accepted_by_email_column,
      to_regclass('public.b2b_quote_email_accesses') IS NOT NULL AS quote_email_table,
      to_regclass('public.b2b_quote_email_accesses_token_hash_key') IS NOT NULL AS quote_email_token_unique""", env)[0]


def inspect(env):
    source()
    identity = rows('SELECT current_database() AS database,current_user AS db_user,current_schema() AS schema', env)[0]
    require(identity == {'database': DATABASE, 'db_user': DB_USER, 'schema': 'public'},
            'Refusing non-DEV database identity')
    ledger = rows('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at', env)
    require(not [r for r in ledger if r['finished_at'] is None and r['rolled_back_at'] is None],
            'Unfinished Prisma migration exists')
    active = {r['migration_name']: r for r in ledger if r['finished_at'] and not r['rolled_back_at']}
    for name, digest in PREREQUISITES.items():
        row = active.get(name)
        require(row and row['checksum'] == digest, 'Prerequisite B2B migration missing or changed: ' + name)
    local = {p.parent.name: hashlib.sha256(p.read_bytes()).hexdigest()
             for p in (ROOT / 'backend/prisma/migrations').glob('*/migration.sql') if p.is_file()}
    target_names = {m[0] for m in MIGRATIONS}
    unrelated_pending = sorted(set(local) - set(active) - target_names)
    require(not unrelated_pending, 'Unrelated source migrations are pending: ' + ', '.join(unrelated_pending))
    missing_source = sorted(set(active) - set(local))
    require(not missing_source, 'Applied DEV migrations missing from source: ' + ', '.join(missing_source))
    drift = [(name, active[name]['checksum'], local[name]) for name in set(active) & set(local)
             if active[name]['checksum'] != local[name]]
    require(all(KNOWN_HISTORIC_MISMATCH.get(name) == (db_hash, source_hash)
                for name, db_hash, source_hash in drift), 'Unexpected historical migration checksum drift')
    markers = objects(env)
    state = []
    saw_pending = False
    for name, digest, keys in MIGRATIONS:
        record = active.get(name)
        present = [key for key in keys if markers[key]]
        require(not (record and saw_pending), 'B2B migration applied out of order: ' + name)
        if record:
            require(record['checksum'] == digest and len(present) == len(keys),
                    'Applied B2B migration ledger or objects differ: ' + name)
        else:
            saw_pending = True
            require(not present, 'Partial B2B schema exists without ledger: ' + name)
        state.append({'name': name, 'sha256': digest,
                      'status': 'applied' if record else 'pending'})

    privilege = rows("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create, "
                     "has_table_privilege(current_user,'public._prisma_migrations','INSERT') AS can_record_migration", env)[0]
    ownership = rows("SELECT c.relname AS table_name,pg_has_role(current_user,c.relowner,'USAGE') AS can_alter,"
                     "has_table_privilege(current_user,c.oid,'REFERENCES') AS can_reference "
                     "FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN "
                     "('products','customers','entities','b2b_purchase_requests','b2b_issued_quotes') "
                     "AND c.relkind='r' ORDER BY c.relname", env)
    require(privilege['can_create'] and privilege['can_record_migration'] and
            len(ownership) == 5 and all(row['can_alter'] and row['can_reference'] for row in ownership),
            'DEV role lacks reviewed schema migration privileges')
    if state[3]['status'] == 'pending':
        incompatible = rows("SELECT count(*) AS rows FROM b2b_purchase_requests "
                            "WHERE account_id IS NULL OR customer_po_number IS NULL", env)[0]['rows']
        require(int(incompatible) == 0, 'Existing purchase requests fail new PORTAL source-kind constraint')
    if state[4]['status'] == 'pending':
        constraints = rows("SELECT conname FROM pg_constraint WHERE conrelid='public.b2b_issued_quotes'::regclass "
                           "AND conname IN ('b2b_issued_quotes_status_valid','b2b_issued_quotes_accepted_pair')", env)
        require({row['conname'] for row in constraints} ==
                {'b2b_issued_quotes_status_valid', 'b2b_issued_quotes_accepted_pair'},
                'Quote constraints to replace are missing')
        incompatible = rows("""SELECT count(*) AS rows FROM b2b_issued_quotes WHERE NOT (
          (status IN ('sent','superseded') AND accepted_at IS NULL
            AND accepted_by_account_id IS NULL AND withdrawn_at IS NULL
            AND withdrawn_by IS NULL AND withdrawal_reason IS NULL)
          OR (status='accepted' AND accepted_at IS NOT NULL
            AND accepted_by_account_id IS NOT NULL AND withdrawn_at IS NULL
            AND withdrawn_by IS NULL AND withdrawal_reason IS NULL)
          OR (status='withdrawn' AND accepted_at IS NOT NULL
            AND accepted_by_account_id IS NOT NULL AND withdrawn_at IS NOT NULL
            AND withdrawn_by IS NOT NULL AND withdrawal_reason IS NOT NULL
            AND length(trim(withdrawal_reason)) >= 10))""", env)[0]['rows']
        require(int(incompatible) == 0, 'Existing issued quotes fail replacement accepted-pair constraint')
    return {'version': 1, 'project': PROJECT, 'database': DATABASE, 'dbUser': DB_USER,
            'sourceSha': git_sha(), 'migrations': state,
            'historicalChecksumException': sorted(name for name, _, _ in drift),
            'allApplied': all(item['status'] == 'applied' for item in state),
            'canApply': True}


def git_sha():
    result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT,
                            text=True, capture_output=True)
    require(result.returncode == 0 and re.fullmatch('[0-9a-f]{40}', result.stdout.strip()),
            'Expected committed source SHA')
    return result.stdout.strip()


def clean_source():
    result = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT,
                            text=True, capture_output=True)
    require(result.returncode == 0 and not result.stdout.strip(),
            'Commit reviewed DEV source before applying migrations')


def apply(env, receipt):
    clean_source()
    source_sha = git_sha()
    before = inspect(env)
    require(not before['allApplied'], 'All reviewed B2B migrations are already applied')
    for item in before['migrations']:
        if item['status'] == 'applied':
            continue
        name = item['name']
        require(git_sha() == source_sha, 'Source changed during DEV migration run')
        current = inspect(env)
        require(next(row for row in current['migrations'] if row['name'] == name)['status'] == 'pending',
                'Migration state changed; stop for review')
        statement = (ROOT / 'backend/prisma/migrations' / name / 'migration.sql').read_text()
        sql("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n" +
            statement + '\nCOMMIT;', env, name)
        database_url = ('postgresql://' + DB_USER + ':' + urllib.parse.quote(env['PGPASSWORD'], safe='') +
                        '@127.0.0.1:' + PORT + '/' + DATABASE + '?schema=public')
        runtime = {**env, 'DATABASE_URL': database_url}
        result = subprocess.run(['node_modules/.bin/prisma', 'migrate', 'resolve', '--applied', name],
                                cwd=ROOT / 'backend', text=True, capture_output=True, env=runtime)
        require(result.returncode == 0,
                'DEV SQL committed but Prisma ledger resolve failed for ' + name +
                '; do not replay SQL; inspect and reconcile this migration')
        confirmed = inspect(env)
        require(next(row for row in confirmed['migrations'] if row['name'] == name)['status'] == 'applied',
                'DEV migration verification failed: ' + name)
    after = inspect(env)
    require(after['allApplied'] and after['sourceSha'] == source_sha,
            'DEV B2B migrations or source did not finish as reviewed')
    target = receipt.expanduser().resolve()
    require(target.is_relative_to(Path('/tmp').resolve()), 'Receipt must be a new path under /tmp')
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump({**after, 'validatedAt': datetime.now(timezone.utc).isoformat()}, stream, indent=2)
        stream.write('\n')
    return after


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('inspect', 'apply'))
    parser.add_argument('--receipt', type=Path, help='Required only for apply; new private /tmp path')
    args = parser.parse_args()
    require((args.mode == 'apply') == bool(args.receipt), 'apply requires --receipt; inspect takes none')
    env = connection()
    report = inspect(env) if args.mode == 'inspect' else apply(env, args.receipt)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(str(error))
