"""One-time DEV clone. Refuses existing targets; never restores into the source.
Run with the authenticated Cloud SQL proxy on loopback port 15439.
Credentials and the temporary dump stay in a mode-0700 directory outside Git.
"""
import datetime
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import sys

PROJECT = 'moztech-main-db'
DATABASE = 'erp_dev_20260921'
ROLE = 'erp_dev_runtime'
PG_BIN = '/opt/homebrew/opt/libpq/bin'
REVISION = 'ecom-accounting-backend-00506-ray'

def cloud(*args):
    return subprocess.check_output(['gcloud', *args, '--project=' + PROJECT], stderr=subprocess.DEVNULL).decode().strip()

revision = json.loads(cloud('run', 'revisions', 'describe', REVISION, '--region=asia-east1', '--format=json'))
settings = {v['name']: v for v in revision['spec']['containers'][0]['env']}
password = settings['DB_PASSWORD'].get('value')
if password is None:
    ref = settings['DB_PASSWORD']['valueFrom']['secretKeyRef']
    password = cloud('secrets', 'versions', 'access', ref['key'], '--secret=' + ref['name'])
env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': '15439', 'PGUSER': settings['DB_USER']['value'], 'PGPASSWORD': password, 'PGDATABASE': 'erp_db'}

def sql(query, database='erp_db'):
    connection = {**env, 'PGDATABASE': database}
    if database == DATABASE:
        connection.update(PGUSER=ROLE, PGPASSWORD=dev_password)
    result = subprocess.run([PG_BIN + '/psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=query, env=connection, capture_output=True, text=True)
    if result.returncode:
        # Do not print SQL/input, which may contain credentials.
        raise RuntimeError('Database operation failed: ' + result.stderr.splitlines()[0])
    return result.stdout.strip()

assert sql(f"select count(*) from pg_database where datname='{DATABASE}';") == '0', 'Target already exists; do not overwrite DEV work'
if len(sys.argv) == 2:
    directory = Path(sys.argv[1])
    assert directory.name.startswith('corely-erp-dev-') and directory.stat().st_mode & 0o077 == 0
    dev_password = (directory / 'db-password').read_text()
    assert sql(f"select count(*) from pg_roles where rolname='{ROLE}' and not rolsuper and not rolcreaterole and not rolcreatedb;") == '1'
else:
    assert sql(f"select count(*) from pg_roles where rolname='{ROLE}';") == '0', 'Runtime role already exists; review ownership first'
    directory = Path(tempfile.mkdtemp(prefix='corely-erp-dev-'))
    os.chmod(directory, 0o700)
    dev_password, jwt = secrets.token_urlsafe(48), secrets.token_urlsafe(64)
    for name, value in [('db-password', dev_password), ('jwt-secret', jwt)]:
        path = directory / name
        path.write_text(value)
        os.chmod(path, 0o600)
    sql(f"CREATE ROLE {ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '{dev_password}';")
print('Private deployment material:', directory, flush=True)
sql(f'CREATE DATABASE {DATABASE};')
grant = subprocess.run([PG_BIN + '/psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=f'GRANT CONNECT, TEMPORARY ON DATABASE {DATABASE} TO {ROLE}; GRANT USAGE, CREATE ON SCHEMA public TO {ROLE};', env={**env, 'PGDATABASE': DATABASE}, capture_output=True, text=True)
assert grant.returncode == 0, 'DEV schema grant failed'
dump = directory / 'snapshot.dump'
subprocess.run([PG_BIN + '/pg_dump', '--format=custom', '--no-owner', '--no-acl', '--file=' + str(dump)], env={**env, 'PGOPTIONS': '-c default_transaction_read_only=on'}, check=True, capture_output=True)
os.chmod(dump, 0o600)
restore = subprocess.run([PG_BIN + '/pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '--dbname=' + DATABASE, str(dump)], env={**env, 'PGUSER': ROLE, 'PGPASSWORD': dev_password}, capture_output=True, text=True)
if restore.returncode:
    raise RuntimeError('Restore failed; private stderr retained for inspection, do not overwrite destination')
# Remove password reset links copied from production; existing login passwords and
# enabled 2FA stay unchanged. No production user or password is modified.
sql('UPDATE users SET password_reset_token_hash=NULL, password_reset_token_expires_at=NULL;', DATABASE)
tables = sql("select tablename from pg_tables where schemaname='public' order by tablename;").splitlines()
counts = {}
for table in tables:
    quoted = '"' + table.replace('"', '""') + '"'
    counts[table] = int(sql(f'SELECT count(*) FROM {quoted};', DATABASE))
source_access = int(sql(f"select count(*) from pg_tables where schemaname='public' and has_table_privilege('{ROLE}',quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');"))
assert source_access == 0, 'DEV role unexpectedly has production table privileges; do not deploy'
receipt = {'snapshotCompletedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sourceDatabase': 'erp_db', 'targetDatabase': DATABASE, 'sourceRevision': REVISION, 'tables': len(tables), 'rowCounts': counts, 'runtimeRoleProductionTablesAccessible': source_access}
(directory / 'snapshot-receipt.json').write_text(json.dumps(receipt, indent=2))
dump.unlink()
print(json.dumps(receipt, indent=2), flush=True)
