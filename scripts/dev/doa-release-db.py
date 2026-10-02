#!/usr/bin/env python3
"""Inspect or atomically apply exactly four reviewed mailroom/DOA ERP DEV migrations.

Offline: python3 scripts/dev/doa-release-db.py check-source
DEV read only: python3 scripts/dev/doa-release-db.py inspect
DEV write: python3 scripts/dev/doa-release-db.py apply --confirm-dev-apply \
  --receipt /tmp/doa-private/NEW-doa-migrations.json

Create a private receipt parent first (mkdir -m 700 /tmp/doa-private).
Start the authenticated Cloud SQL Auth Proxy separately on 127.0.0.1:15442.
inspect reads DEV credentials internally; it is not an offline dry run. SQL and
its Prisma ledger row commit together. Never run a general migrate deploy/seed.
No credentials, URLs, SQL failures, user IDs or customer records are printed.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid


ROOT = Path(__file__).resolve().parents[2]
PROJECT = 'moztech-main-db'
REGION = 'asia-east1'
SERVICE = 'corely-erp-api-dev'
SERVICE_ACCOUNT = 'corely-erp-dev-rt@moztech-main-db.iam.gserviceaccount.com'
INSTANCE = 'moztech-main-db:asia-east1:moztech-main-db'
DATABASE = 'erp_dev_20260921'
DB_USER = 'erp_dev_runtime'
PSQL = '/opt/homebrew/opt/libpq/bin/psql'
PORT = '15442'
LOCK_NAME = 'corely-erp-dev-doa-release-v1'
MIGRATIONS = (
    ('20261001090000_mailroom_workbenches', '13dce515167e138f3f146acc47444abd6d0d4ccf1c2f2939ce04effae49b3906'),
    ('20261002090000_mailroom_intake_review', 'e51142a26a7413b9830ea29f740a498aa9a6869a0e9d370f0a128499ab3c1d11'),
    ('20261002100000_repair_technician_role', '5c526dfeb9abdbc29ce6122500f671291de22913e697f5e953ae35df6ca905bd'),
    ('20261002110000_repair_documents', 'eeefe57e81581ba27390e6c7d7636458087b11cedc36ae252db0acb77d35a96f'),
)
KNOWN_HISTORIC_MISMATCH = {
    '20260505120000_seed_employee_permission_model': (
        '928d58b5904cfeed3c672a3e5159fbece240a642bbbfb78dd729f6cd2e1b09a8',
        '963156ce8bb4592193600cf9bfa4fe0482ec9d985e05f589cbc0c628d9ef2aa1'),
}
BASE_TABLES = {'_prisma_migrations', 'roles', 'permissions', 'role_permissions', 'user_roles'}
TABLES = ('mailroom_receipts', 'mailroom_items', 'mailroom_actions', 'mailroom_tasks', 'mailroom_deliveries')
BASE_COLUMNS = {
    'mailroom_receipts': ('id entity_id number category source_case_id source_number source_snapshot carrier '
                         'tracking_number sender_label received_by_id received_at request_id request_hash').split(),
    'mailroom_items': ('id receipt_id entity_id label declared product_name sku serial_number status match_result '
                      'grade disposition condition_note evidence location custodian_id recipient_id next_user_id '
                      'repair_owner_id version created_at updated_at').split(),
    'mailroom_actions': ('id entity_id item_id actor_id actor_name request_id request_hash action from_status '
                        'to_status version note snapshot created_at').split(),
    'mailroom_tasks': 'id entity_id item_id user_id kind status version created_at completed_at'.split(),
    'mailroom_deliveries': ('id event_id entity_id item_id target payload status attempts next_attempt_at lease_until '
                           'lease_token last_error delivered_at created_at').split(),
}
OPTIONAL_COLUMNS = {
    'mailroom_receipts': set('source_case_id source_number source_snapshot carrier tracking_number sender_label'.split()),
    'mailroom_items': set('declared sku serial_number grade disposition condition_note evidence recipient_id next_user_id repair_owner_id'.split()),
    'mailroom_actions': {'from_status', 'note'},
    'mailroom_tasks': {'completed_at'},
    'mailroom_deliveries': {'lease_until', 'lease_token', 'last_error', 'delivered_at'},
}
JSON_COLUMNS = {'source_snapshot', 'declared', 'evidence', 'snapshot', 'payload'}
INT_COLUMNS = {'version', 'attempts'}
TIME_COLUMNS = {'received_at', 'created_at', 'updated_at', 'completed_at', 'next_attempt_at', 'lease_until', 'delivered_at'}
EXTRA_COLUMNS = (
    ('mailroom_receipts', 'customer_service_user_id', 'text'),
    ('mailroom_items', 'return_inspection', 'jsonb'),
    ('mailroom_items', 'repair_inspection', 'jsonb'),
    ('mailroom_items', 'repair_report', 'jsonb'),
)
INDEXES = {
    'mailroom_receipts_number_key': ('mailroom_receipts', True, ['number']),
    'mailroom_receipts_entity_id_received_at_idx': ('mailroom_receipts', False, ['entity_id', 'received_at']),
    'mailroom_receipts_entity_id_source_case_id_idx': ('mailroom_receipts', False, ['entity_id', 'source_case_id']),
    'mailroom_receipts_entity_id_received_by_id_request_id_key': ('mailroom_receipts', True, ['entity_id', 'received_by_id', 'request_id']),
    'mailroom_items_entity_id_status_created_at_idx': ('mailroom_items', False, ['entity_id', 'status', 'created_at']),
    'mailroom_items_recipient_id_status_idx': ('mailroom_items', False, ['recipient_id', 'status']),
    'mailroom_items_next_user_id_status_idx': ('mailroom_items', False, ['next_user_id', 'status']),
    'mailroom_actions_entity_id_actor_id_request_id_key': ('mailroom_actions', True, ['entity_id', 'actor_id', 'request_id']),
    'mailroom_actions_item_id_version_key': ('mailroom_actions', True, ['item_id', 'version']),
    'mailroom_tasks_user_id_status_created_at_idx': ('mailroom_tasks', False, ['user_id', 'status', 'created_at']),
    'mailroom_tasks_item_id_user_id_kind_version_key': ('mailroom_tasks', True, ['item_id', 'user_id', 'kind', 'version']),
    'mailroom_deliveries_status_next_attempt_at_idx': ('mailroom_deliveries', False, ['status', 'next_attempt_at']),
    'mailroom_deliveries_event_id_target_key': ('mailroom_deliveries', True, ['event_id', 'target']),
}
CONSTRAINTS = {name + '_pkey': ('p', name) for name in TABLES}
CONSTRAINTS.update({
    'mailroom_items_receipt_id_fkey': ('f', 'mailroom_items'),
    'mailroom_actions_item_id_fkey': ('f', 'mailroom_actions'),
    'mailroom_tasks_item_id_fkey': ('f', 'mailroom_tasks'),
    'mailroom_item_version_positive': ('c', 'mailroom_items'),
    'mailroom_action_version_positive': ('c', 'mailroom_actions'),
})
PERMISSIONS = {
    ('mailroom', 'read'), ('mailroom', 'create'), ('mailroom', 'update'), ('mailroom', 'review'),
    ('repair_workbench', 'read'), ('repair_workbench', 'update'),
}
ALLOWED_GRANTS = """SELECT r.id AS role_id,p.id AS permission_id FROM roles r CROSS JOIN permissions p
 WHERE (r.code IN ('MAILROOM_OPERATOR','REPAIR_TECHNICIAN')
   AND p.resource IN ('attendance_self','leave_self','profile_self','expense_self') AND p.action='read')
 OR (r.code='MAILROOM_OPERATOR' AND p.resource='mailroom' AND p.action IN ('read','create','update'))
 OR (r.code='REPAIR_TECHNICIAN' AND p.resource='repair_workbench' AND p.action IN ('read','update'))"""
LEDGER_DIGEST = """SELECT md5(COALESCE(string_agg(
 migration_name||':'||checksum||':'||COALESCE(finished_at::text,'')||':'||COALESCE(rolled_back_at::text,''),
 E'\\n' ORDER BY migration_name,checksum,started_at,id),'')) AS fingerprint FROM _prisma_migrations"""


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def quoted(value):
    return "'" + str(value).replace("'", "''") + "'"


def cloud(*args):
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT], text=True, capture_output=True)
    require(result.returncode == 0, 'DEV cloud metadata or credential lookup failed; output suppressed')
    return result.stdout.strip()


def connection():
    service = json.loads(cloud('run', 'services', 'describe', SERVICE, '--region=' + REGION, '--format=json'))
    require(service.get('metadata', {}).get('name') == SERVICE, 'Unexpected DEV service')
    template = service['spec']['template']
    require(template['spec']['serviceAccountName'] == SERVICE_ACCOUNT, 'DEV runtime service account changed')
    require(template['metadata']['annotations'].get('run.googleapis.com/cloudsql-instances') == INSTANCE,
            'DEV Cloud SQL attachment changed')
    values = {entry['name']: entry for entry in template['spec']['containers'][0]['env']}
    for key, expected in {'DB_NAME': DATABASE, 'DB_USER': DB_USER, 'CLOUDSQL_INSTANCE': INSTANCE,
                          'ERP_DEV_SANDBOX': 'true', 'SEED_ON_STARTUP': 'false',
                          'RUNTIME_SCHEDULES_ENABLED': 'false'}.items():
        require(values.get(key, {}).get('value') == expected, 'DEV service protection changed: ' + key)
    secret = values.get('DB_PASSWORD', {}).get('valueFrom', {}).get('secretKeyRef', {})
    require('dev' in secret.get('name', '').lower() and secret.get('key'), 'Expected a DEV-only database secret reference')
    password = cloud('secrets', 'versions', 'access', secret['key'], '--secret=' + secret['name'])
    require(password, 'DEV database credential unavailable')
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG') and key != 'DATABASE_URL'}
    env.update(PGHOST='127.0.0.1', PGPORT=PORT, PGDATABASE=DATABASE, PGUSER=DB_USER,
               PGPASSWORD=password, PGCONNECT_TIMEOUT='10', PGOPTIONS='-c search_path=public')
    return env


def sql(statement, env, stage):
    result = subprocess.run([PSQL, '-X', '-w', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
                            input=statement, text=True, capture_output=True, env=env)
    require(result.returncode == 0, f'DEV {stage} failed (psql exit {result.returncode}); SQL/error output suppressed')
    return result.stdout.strip()


def rows(statement, env):
    return json.loads(sql("BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; "
                          "SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json) FROM (" +
                          statement + ') q; COMMIT;', env, 'read-only inspection'))


def source():
    result = []
    for name, expected in MIGRATIONS:
        path = ROOT / 'backend/prisma/migrations' / name / 'migration.sql'
        require(path.is_file() and not path.is_symlink(), 'Reviewed migration file absent or symlinked: ' + name)
        content = path.read_bytes()
        require(hashlib.sha256(content).hexdigest() == expected, 'Reviewed migration checksum changed: ' + name)
        result.append({'name': name, 'sha256': expected, 'statement': content.decode('utf-8')})
    return result


def git_sha(clean=False):
    result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, capture_output=True)
    require(result.returncode == 0 and re.fullmatch(r'[a-f0-9]{40}', result.stdout.strip()), 'Expected committed source SHA')
    if clean:
        status = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, text=True, capture_output=True)
        require(status.returncode == 0 and not status.stdout.strip(), 'Commit and review source before applying DEV migrations')
    return result.stdout.strip()


def history(ledger):
    require(not [r for r in ledger if not r['finished_at'] and not r['rolled_back_at']], 'Unfinished Prisma migration exists')
    active_rows = [r for r in ledger if r['finished_at'] and not r['rolled_back_at']]
    active = {r['migration_name']: r for r in active_rows}
    require(len(active) == len(active_rows), 'Duplicate active migration ledger rows')
    paths = list((ROOT / 'backend/prisma/migrations').glob('*/migration.sql'))
    require(all(p.is_file() and not p.is_symlink() and not p.parent.is_symlink() for p in paths), 'Unexpected migration source symlink')
    local = {p.parent.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    require(not set(active) - set(local), 'Applied DEV migrations missing from source')
    pending = sorted(set(local) - set(active))
    unrelated = sorted(set(pending) - {name for name, _ in MIGRATIONS})
    require(not unrelated, 'Unrelated source migrations are pending: ' + ', '.join(unrelated))
    drift = [(name, active[name]['checksum'], local[name]) for name in set(active) & set(local)
             if active[name]['checksum'] != local[name]]
    require(all(KNOWN_HISTORIC_MISMATCH.get(name) == (db_hash, source_hash)
                for name, db_hash, source_hash in drift), 'Unexpected historical migration checksum drift')
    saw_pending = False
    for name, expected in MIGRATIONS:
        record = active.get(name)
        require(not (record and saw_pending), 'DOA migrations applied out of order: ' + name)
        if record:
            require(record['checksum'] == expected, 'Reviewed migration ledger checksum differs: ' + name)
        else:
            saw_pending = True
    return active, pending, sorted(name for name, _, _ in drift)


def schema_state(env):
    names = ','.join(map(quoted, TABLES))
    columns = rows("SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns "
                   "WHERE table_schema='public' AND table_name IN (" + names + ')', env)
    by_column = {(r['table_name'], r['column_name']): r for r in columns}
    present_tables = {r['table_name'] for r in columns}
    require(not present_tables or present_tables == set(TABLES), 'Partial mailroom schema exists')
    complete = bool(present_tables)
    if complete:
        for table, expected in BASE_COLUMNS.items():
            for name in expected:
                column = by_column.get((table, name))
                kind = 'jsonb' if name in JSON_COLUMNS else 'int4' if name in INT_COLUMNS else 'timestamp' if name in TIME_COLUMNS else 'text'
                require(column and column['udt_name'] == kind and
                        (column['is_nullable'] == 'YES') == (name in OPTIONAL_COLUMNS[table]),
                        'Mailroom column differs from reviewed schema: ' + table + '.' + name)
        indexes = rows("SELECT c.relname AS name,t.relname AS table_name,i.indisunique AS is_unique, "
                       "ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(attnum,position) "
                       "JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY k.position) AS columns "
                       "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid "
                       "WHERE t.relnamespace='public'::regnamespace AND t.relname IN (" + names + ')', env)
        by_index = {r['name']: r for r in indexes}
        for name, (table, unique, keys) in INDEXES.items():
            item = by_index.get(name)
            require(item and (item['table_name'], item['is_unique'], item['columns']) == (table, unique, keys),
                    'Mailroom index differs from reviewed schema: ' + name)
        constraints = rows("SELECT c.conname AS name,c.contype AS kind,t.relname AS table_name,c.convalidated AS valid, "
                           "pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid "
                           "WHERE t.relnamespace='public'::regnamespace AND t.relname IN (" + names + ')', env)
        by_constraint = {r['name']: r for r in constraints}
        for name, (kind, table) in CONSTRAINTS.items():
            item = by_constraint.get(name)
            require(item and item['kind'] == kind and item['table_name'] == table and item['valid'],
                    'Mailroom constraint missing or invalid: ' + name)
            if kind == 'c':
                require('version > 0' in item['definition'], 'Mailroom positive-version check differs')
            elif kind == 'f':
                target = 'mailroom_receipts' if table == 'mailroom_items' else 'mailroom_items'
                require('REFERENCES ' + target + '(id)' in item['definition'] and
                        'ON UPDATE CASCADE ON DELETE RESTRICT' in item['definition'], 'Mailroom foreign key differs')
        triggers = rows("SELECT t.tgenabled AS enabled,pg_get_triggerdef(t.oid) AS definition, "
                        "p.proname AS function_name,pg_get_functiondef(p.oid) AS function_definition "
                        "FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid "
                        "WHERE t.tgrelid='public.mailroom_actions'::regclass AND t.tgname='mailroom_history_immutable' "
                        'AND NOT t.tgisinternal', env)
        require(len(triggers) == 1 and triggers[0]['enabled'] == 'O' and
                'BEFORE DELETE OR UPDATE' in triggers[0]['definition'] and
                'FOR EACH ROW' in triggers[0]['definition'] and
                triggers[0]['function_name'] == 'mailroom_deny_history_change' and
                "RAISE EXCEPTION 'Mailroom history is append-only'" in triggers[0]['function_definition'],
                'Mailroom append-only history protection differs')
    extra = []
    for table, name, kind in EXTRA_COLUMNS:
        item = by_column.get((table, name))
        require(not item or (item['udt_name'] == kind and item['is_nullable'] == 'YES'), 'DOA extra column has unexpected type/nullability')
        extra.append(bool(item))
    require(extra[0] == extra[1], 'Partial mailroom intake-review schema exists')
    require(extra[2] == extra[3], 'Partial DOA document schema exists')
    return complete, extra[0], extra[2]


def catalog_state(env, active):
    permissions = rows("SELECT id,resource,action,description FROM permissions WHERE resource IN "
                       "('mailroom','repair_workbench','attendance_self','leave_self','profile_self','expense_self')", env)
    roles = rows("SELECT id,code,name FROM roles WHERE code IN ('MAILROOM_OPERATOR','REPAIR_TECHNICIAN') "
                 "OR name IN ('收發室人員','維修人員','維修師') OR id IN ('mailroom-operator','repair-technician')", env)
    names = {'MAILROOM_OPERATOR': '收發室人員', 'REPAIR_TECHNICIAN': '維修師' if MIGRATIONS[2][0] in active else '維修人員'}
    for row in roles:
        require(row['code'] in names and row['name'] == names[row['code']], 'Mailroom role code/name/id collision or unexpected label')
        require(row['id'] not in ('mailroom-operator', 'repair-technician') or
                row['id'] == {'MAILROOM_OPERATOR': 'mailroom-operator', 'REPAIR_TECHNICIAN': 'repair-technician'}[row['code']],
                'Mailroom role identifier collision')
    actual = {(r['resource'], r['action']): r for r in permissions}
    require(all((name, 'read') in actual for name in ('attendance_self', 'leave_self', 'profile_self', 'expense_self')),
            'Base personal read permissions missing')
    collisions = rows("SELECT count(*) AS count FROM permissions WHERE id IN "
                      "('mailroom-read','mailroom-create','mailroom-update','mailroom-review','repair-workbench-read','repair-workbench-update') "
                      "AND NOT ((resource='mailroom' AND id='mailroom-'||action AND action IN ('read','create','update','review')) "
                      "OR (resource='repair_workbench' AND id='repair-workbench-'||action AND action IN ('read','update')))", env)[0]
    require(int(collisions['count']) == 0, 'Mailroom permission identifier collision')
    if MIGRATIONS[0][0] in active:
        require({r['code'] for r in roles} == set(names) and PERMISSIONS <= set(actual), 'Applied mailroom role/permission catalog incomplete')
        missing = rows('SELECT count(*) AS count FROM (' + ALLOWED_GRANTS + ') required '
                       'WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=required.role_id '
                       'AND rp.permission_id=required.permission_id)', env)[0]
        require(int(missing['count']) == 0, 'Applied mailroom template grants incomplete')
    if MIGRATIONS[2][0] in active:
        require(actual[('repair_workbench', 'read')]['description'] == '查看同公司維修案件、待認領物件與維修歷程' and
                actual[('repair_workbench', 'update')]['description'] == '認領、本人簽收及填寫本人檢修與維修紀錄',
                'Applied technician permission descriptions differ')


def inspect(env):
    source()
    identity = rows('SELECT current_database() AS database,current_user AS db_user,current_schema() AS schema', env)[0]
    require(identity == {'database': DATABASE, 'db_user': DB_USER, 'schema': 'public'}, 'Refusing non-DEV database identity')
    existing = {r['tablename'] for r in rows("SELECT tablename FROM pg_tables WHERE schemaname='public'", env)}
    require(BASE_TABLES <= existing, 'Required DEV role/ledger tables missing')
    ledger = rows('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at,id', env)
    active, pending, exceptions = history(ledger)
    markers = schema_state(env)
    for index, present in ((0, markers[0]), (1, markers[1]), (3, markers[2])):
        require(present == (MIGRATIONS[index][0] in active), 'Schema/ledger disagree; do not replay SQL: ' + MIGRATIONS[index][0])
    catalog_state(env, active)
    privilege = rows("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create", env)[0]
    targets = BASE_TABLES | ({'mailroom_items'} if markers[0] else set())
    privileges = rows("SELECT c.relname AS table_name,pg_has_role(current_user,c.relowner,'USAGE') AS can_alter, "
                      "has_table_privilege(current_user,c.oid,'INSERT') AS can_insert, "
                      "has_table_privilege(current_user,c.oid,'UPDATE') AS can_update "
                      "FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname IN (" +
                      ','.join(map(quoted, sorted(targets))) + ')', env)
    require(privilege['can_create'] and {r['table_name'] for r in privileges} == targets and
            all(r['can_alter'] for r in privileges) and
            all(r['can_insert'] for r in privileges if r['table_name'] in {'roles', 'permissions', 'role_permissions', '_prisma_migrations'}) and
            all(r['can_update'] for r in privileges if r['table_name'] in {'roles', 'permissions'}),
            'DEV role lacks reviewed migration ownership or privileges')
    fingerprint = rows(LEDGER_DIGEST, env)[0]['fingerprint']
    migrations = [{'name': name, 'sha256': checksum, 'checksum': checksum,
                   'status': 'applied' if name in active else 'pending',
                   'finishedAt': active[name]['finished_at'] if name in active else None,
                   'ledgerVerified': name in active, 'objectsVerified': name in active}
                  for name, checksum in MIGRATIONS]
    return {'version': 1, 'project': PROJECT, 'service': SERVICE, 'database': DATABASE, 'dbUser': DB_USER,
            'schema': 'public', 'sourceSha': git_sha(), 'migrations': migrations,
            'allApplied': not pending, 'canApply': True, 'unrelatedPending': [], 'unrelatedPendingMigrations': [],
            'historicalChecksumException': exceptions, 'ledgerFingerprint': fingerprint}


def transaction(item, fingerprint):
    # Table locks also prevent ordinary permission editing while snapshots and SQL
    # execute. An exact ledger fingerprint closes the preflight-to-write race.
    return """BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';
DO $doa_guard$ BEGIN
 IF current_database()<>%s OR current_user<>%s OR current_schema()<>'public' THEN RAISE EXCEPTION 'wrong_dev_identity'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext(%s)::bigint) THEN RAISE EXCEPTION 'doa_release_locked'; END IF;
END $doa_guard$;
LOCK TABLE _prisma_migrations,roles,permissions,role_permissions,user_roles IN SHARE ROW EXCLUSIVE MODE;
DO $doa_ledger$ BEGIN
 IF (%s)<>%s THEN RAISE EXCEPTION 'migration_history_changed'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name=%s AND rolled_back_at IS NULL) THEN RAISE EXCEPTION 'migration_already_active'; END IF;
END $doa_ledger$;
CREATE TEMP TABLE doa_before_user_roles ON COMMIT DROP AS TABLE user_roles;
CREATE TEMP TABLE doa_before_role_permissions ON COMMIT DROP AS TABLE role_permissions;
%s
DO $doa_preserve$ BEGIN
 IF EXISTS((TABLE user_roles EXCEPT TABLE doa_before_user_roles) UNION ALL (TABLE doa_before_user_roles EXCEPT TABLE user_roles)) THEN RAISE EXCEPTION 'user_role_assignments_changed'; END IF;
 IF EXISTS(TABLE doa_before_role_permissions EXCEPT TABLE role_permissions) THEN RAISE EXCEPTION 'existing_role_grants_removed'; END IF;
 IF EXISTS((TABLE role_permissions EXCEPT TABLE doa_before_role_permissions) EXCEPT (%s)) THEN RAISE EXCEPTION 'unreviewed_role_grants_added'; END IF;
END $doa_preserve$;
INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count)
VALUES(%s,%s,clock_timestamp(),%s,NULL,NULL,CURRENT_TIMESTAMP,1);
COMMIT;
""" % (quoted(DATABASE), quoted(DB_USER), quoted(LOCK_NAME), LEDGER_DIGEST.replace(' AS fingerprint', ''),
       quoted(fingerprint), quoted(item['name']), item['statement'], ALLOWED_GRANTS,
       quoted(uuid.uuid4()), quoted(item['sha256']), quoted(item['name']))


def apply(env, source_sha):
    require(git_sha(clean=True) == source_sha, 'Source changed before DEV migration apply')
    before = inspect(env)
    require(before['sourceSha'] == source_sha, 'Inspection source differs from committed release')
    applied_now = []
    for item in source():
        require(git_sha(clean=True) == source_sha, 'Source changed during DEV migration run')
        current = inspect(env)
        record = next(r for r in current['migrations'] if r['name'] == item['name'])
        if record['status'] == 'applied':
            continue
        sql(transaction(item, current['ledgerFingerprint']), env, item['name'] + ' atomic migration')
        after_item = inspect(env)
        confirmed = next(r for r in after_item['migrations'] if r['name'] == item['name'])
        require(confirmed['status'] == 'applied' and confirmed['ledgerVerified'] and confirmed['objectsVerified'],
                'Committed migration verification failed; inspect without replaying SQL: ' + item['name'])
        applied_now.append(item['name'])
    after = inspect(env)
    require(after['allApplied'] and after['sourceSha'] == source_sha and git_sha(clean=True) == source_sha,
            'DEV migrations or source did not finish as reviewed')
    return {**after, 'appliedNow': applied_now, 'validatedAt': datetime.now(timezone.utc).isoformat(),
            'userRoleAssignmentsPreserved': True, 'existingRolePermissionsPreserved': True,
            'atomicSqlAndLedger': True, 'devOnly': True}


def reserve_receipt(value):
    raw = Path(value).expanduser()
    require(raw.is_absolute() and not raw.is_symlink(), 'Receipt requires a new absolute private /tmp path')
    path = raw.resolve()
    require(path.is_relative_to(Path('/tmp').resolve()), 'Receipt must be under /tmp')
    require(not path.exists() and path.parent.is_dir(), 'Receipt already exists or parent directory is absent')
    parent_stat = path.parent.stat()
    require(parent_stat.st_uid == os.getuid() and stat.S_IMODE(parent_stat.st_mode) == 0o700,
            'Receipt parent must be owned by the current user with mode 0700')
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.fchmod(descriptor, 0o600)
    return path, os.fdopen(descriptor, 'w')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', choices=('check-source', 'inspect', 'apply'))
    parser.add_argument('--confirm-dev-apply', action='store_true', help='Required explicit opt-in only for apply')
    parser.add_argument('--receipt', help='Required only for apply; fresh private absolute /tmp path')
    args = parser.parse_args()
    require((args.mode == 'apply') == args.confirm_dev_apply and
            (args.mode == 'apply') == bool(args.receipt), 'apply requires both --confirm-dev-apply and --receipt; other modes accept neither')
    if args.mode == 'check-source':
        reviewed = source()
        print(json.dumps({'mode': 'offline-source-check', 'sourceSha': git_sha(),
                          'migrations': [{k: item[k] for k in ('name', 'sha256')} for item in reviewed],
                          'cloudAccessed': False, 'databaseAccessed': False}))
        return
    if args.mode == 'inspect':
        print(json.dumps(inspect(connection()), ensure_ascii=False, indent=2))
        return
    source_sha = git_sha(clean=True)
    source()
    path, stream = reserve_receipt(args.receipt)
    try:
        report = apply(connection(), source_sha)
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    except Exception:
        json.dump({'version': 1, 'sourceSha': source_sha, 'database': DATABASE, 'dbUser': DB_USER,
                   'schema': 'public', 'allApplied': False, 'status': 'failed-requires-inspection',
                   'note': 'Do not replay SQL. Inspect schema and atomic migration ledger before retrying.'}, stream)
        stream.write('\n')
        raise
    finally:
        stream.close()
    print(json.dumps({**report, 'receipt': str(path)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Suppress subprocess stderr, SQL, credentials and traceback payloads.
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('ERROR: ' + message, file=sys.stderr)
        sys.exit(1)
