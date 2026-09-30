#!/usr/bin/env python3
"""Pure local guards for access-permissions-db.py; no cloud or database calls."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    'access_permissions_db', Path(__file__).with_name('access-permissions-db.py'))
db = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(db)


def sample_service(secret=True):
    entries = [
        {'name': 'DB_NAME', 'value': db.DATABASE},
        {'name': 'DB_USER', 'value': db.DB_USER},
        {'name': 'CLOUDSQL_INSTANCE', 'value': db.INSTANCE},
        {'name': 'ERP_DEV_SANDBOX', 'value': 'true'},
        {'name': 'SEED_ON_STARTUP', 'value': 'false'},
        {'name': 'RUNTIME_SCHEDULES_ENABLED', 'value': 'false'},
        {'name': 'DB_PASSWORD', **({'valueFrom': {'secretKeyRef': {'name': 'erp-dev-db', 'key': 'latest'}}}
                               if secret else {'value': 'unsafe-inline'})},
    ]
    return {'metadata': {'name': db.SERVICE},
            'spec': {'template': {'spec': {'containers': [{'env': entries}]}}}}


class AccessPermissionsDbGuards(unittest.TestCase):
    def setUp(self):
        self.env = {'PGPASSWORD': 'test-only-password'}

    def pending_rows(self, prereq=True, owner=True):
        def answer(query, _env):
            if query.startswith('SELECT current_database()'):
                return [{'database': db.DATABASE, 'db_user': db.DB_USER, 'schema': 'public'}]
            if query.startswith('SELECT tablename FROM pg_tables'):
                if 'tablename IN' in query:
                    return []
                return [{'tablename': name} for name in db.EXISTING_TABLES]
            if query.startswith('SELECT migration_name,checksum,finished_at,rolled_back_at'):
                return ([{'migration_name': db.PREREQUISITE, 'checksum': db.PREREQUISITE_SHA256,
                          'finished_at': '2026-09-23T01:00:00Z', 'rolled_back_at': None}]
                        if prereq else [])
            if query.startswith('SELECT migration_name FROM _prisma_migrations'):
                return []
            if query.startswith('SELECT c.relname AS table_name'):
                return [{'table_name': name, 'owner': db.DB_USER, 'runtime_owner': owner}
                        for name in db.EXISTING_TABLES]
            if query.startswith('SELECT has_schema_privilege'):
                return [{'can_create': True, 'can_uuid': True}]
            if query.startswith('SELECT table_name,has_table_privilege'):
                if "'INSERT'" in query:
                    return [{'table_name': name, 'can_insert': True}
                            for name in ('roles', 'permissions', 'role_permissions', '_prisma_migrations')]
                return [{'table_name': name, 'can_reference': True} for name in ('entities', 'employees')]
            if query.startswith('SELECT table_name,column_name'):
                return []
            if query.startswith('SELECT indexname FROM pg_indexes'):
                return []
            if query.startswith('SELECT resource,action FROM permissions'):
                return []
            if query.startswith('SELECT code,name FROM roles'):
                return [{'code': name, 'name': name}
                        for name in ('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')]
            if query.startswith('SELECT r.code,p.resource,p.action'):
                return []
            raise AssertionError('Unexpected SQL inspection: ' + query)
        return answer

    def test_pinned_migration_and_prerequisite_checksums(self):
        path = db.source()
        self.assertEqual(path.name, 'migration.sql')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in (db.MIGRATION, db.PREREQUISITE):
                target = root / 'backend/prisma/migrations' / name / 'migration.sql'
                target.parent.mkdir(parents=True)
                target.write_text('changed migration')
            with patch.object(db, 'ROOT', root), self.assertRaisesRegex(RuntimeError, 'checksum'):
                db.source()

    def test_connection_requires_dev_service_and_secret_reference(self):
        with patch.object(db, 'cloud', side_effect=[json.dumps(sample_service()), 'test-only-password']) as cloud:
            env = db.connection()
        self.assertEqual(env['PGDATABASE'], db.DATABASE)
        self.assertEqual(env['PGHOST'], '127.0.0.1')
        self.assertEqual(cloud.call_count, 2)
        with patch.object(db, 'cloud', return_value=json.dumps(sample_service(False))) as cloud:
            with self.assertRaisesRegex(RuntimeError, 'DEV-only database secret'):
                db.connection()
        self.assertEqual(cloud.call_count, 1)
        wrong = sample_service()
        wrong['spec']['template']['spec']['containers'][0]['env'][0]['value'] = 'production'
        with patch.object(db, 'cloud', return_value=json.dumps(wrong)):
            with self.assertRaisesRegex(RuntimeError, 'DB_NAME'):
                db.connection()

    def test_inspect_requires_correct_identity_and_prerequisite(self):
        with patch.object(db, 'rows', side_effect=self.pending_rows()), patch.object(db, 'source'):
            report = db.inspect(self.env)
        self.assertEqual(report['status'], 'pending')
        self.assertTrue(report['canMigrate'])
        with patch.object(db, 'rows', side_effect=self.pending_rows(prereq=False)), patch.object(db, 'source'):
            with self.assertRaisesRegex(RuntimeError, 'prerequisite'):
                db.inspect(self.env)

    def test_inspect_denies_missing_ownership_or_partial_schema(self):
        with patch.object(db, 'rows', side_effect=self.pending_rows(owner=False)), patch.object(db, 'source'):
            self.assertFalse(db.inspect(self.env)['canMigrate'])
        partial = {'tables': ['performance_cycles'],
                   'missingColumns': {name: sorted(columns) for name, columns in db.NEW_COLUMNS.items()},
                   'missingConstraints': sorted(db.NEW_CONSTRAINTS),
                   'missingIndexes': sorted(db.NEW_INDEXES)}
        with patch.object(db, 'rows', side_effect=self.pending_rows()), patch.object(db, 'source'), \
                patch.object(db, 'schema_objects', return_value=partial):
            with self.assertRaisesRegex(RuntimeError, 'without a Prisma ledger'):
                db.inspect(self.env)

    def test_migrate_is_idempotent_and_resolves_only_reviewed_migration(self):
        applied = {'status': 'applied', 'canMigrate': False,
                   'catalog': {key: [] for key in ('missingPermissions', 'missingRoles',
                                                  'wrongRoleNames', 'roleNameCollisions',
                                                  'missingGrants')}}
        with patch.object(db, 'inspect', return_value=applied), patch.object(db, 'sql') as sql:
            self.assertIs(db.migrate(self.env), applied)
            sql.assert_not_called()
        pending = {'status': 'pending', 'canMigrate': True}
        with patch.object(db, 'inspect', side_effect=[pending, applied]), \
                patch.object(db, 'sql') as sql, \
                patch.object(db.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertIs(db.migrate(self.env), applied)
        statement = sql.call_args.args[0]
        self.assertTrue(statement.startswith("BEGIN; SET LOCAL lock_timeout='5s';"))
        self.assertTrue(statement.rstrip().endswith('COMMIT;'))
        self.assertNotIn(self.env['PGPASSWORD'], statement)
        self.assertEqual(run.call_args.args[0][-2:], ['--applied', db.MIGRATION])

    def test_receipt_is_private_and_exclusive(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as temp:
            path = db.receipt_path(str(Path(temp) / 'receipt.json'))
            db.write_receipt(path, {'status': 'applied'}, 'a' * 40)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                db.write_receipt(path, {}, 'a' * 40)
        with self.assertRaisesRegex(RuntimeError, 'under /tmp'):
            db.receipt_path(str(Path(__file__).resolve().parent / 'receipt.json'))


if __name__ == '__main__':
    unittest.main()
