#!/usr/bin/env python3
"""Offline fail-closed checks for the scoped ERP DEV B2B migration helper."""

import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name('b2b-public-release-db.py')
spec = importlib.util.spec_from_file_location('b2b_public_release_db', FILE)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class MigrationInspectTests(unittest.TestCase):
    def setUp(self):
        targets = {name for name, _, _ in helper.MIGRATIONS}
        self.ledger = []
        for path in (helper.ROOT / 'backend/prisma/migrations').glob('*/migration.sql'):
            if path.parent.name in targets:
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if path.parent.name in helper.KNOWN_HISTORIC_MISMATCH:
                digest = helper.KNOWN_HISTORIC_MISMATCH[path.parent.name][0]
            self.ledger.append({'migration_name': path.parent.name, 'checksum': digest,
                                'finished_at': '2026-09-30T00:00:00Z', 'rolled_back_at': None})
        self.markers = {key: False for _, _, keys in helper.MIGRATIONS for key in keys}
        self.portal_bad = 0
        self.quote_bad = 0
        self.grants = [dict(table_name=name, can_alter=True, can_reference=True)
                       for name in ('products', 'customers', 'entities',
                                    'b2b_purchase_requests', 'b2b_issued_quotes')]

    def fake_rows(self, statement, _env):
        if 'current_database()' in statement:
            return [{'database': helper.DATABASE, 'db_user': helper.DB_USER, 'schema': 'public'}]
        if 'FROM _prisma_migrations' in statement:
            return self.ledger
        if 'has_schema_privilege' in statement:
            return [{'can_create': True, 'can_record_migration': True}]
        if 'FROM pg_class c' in statement:
            return self.grants
        if 'FROM b2b_purchase_requests WHERE account_id' in statement:
            return [{'rows': self.portal_bad}]
        if "conrelid='public.b2b_issued_quotes'" in statement:
            return [{'conname': 'b2b_issued_quotes_status_valid'},
                    {'conname': 'b2b_issued_quotes_accepted_pair'}]
        if 'FROM b2b_issued_quotes WHERE NOT' in statement:
            return [{'rows': self.quote_bad}]
        raise AssertionError('Unexpected inspection SQL')

    def inspect(self):
        with patch.object(helper, 'rows', side_effect=self.fake_rows), \
             patch.object(helper, 'objects', return_value=self.markers), \
             patch.object(helper, 'git_sha', return_value='a' * 40):
            return helper.inspect({})

    def test_exact_five_pending_pass_without_blind_migrate_deploy(self):
        result = self.inspect()
        self.assertEqual([m['status'] for m in result['migrations']], ['pending'] * 5)
        self.assertTrue(result['canApply'])
        self.assertEqual(result['historicalChecksumException'],
                         ['20260505120000_seed_employee_permission_model'])

    def test_partial_schema_and_unfinished_ledger_fail_closed(self):
        self.markers['guest_table'] = True
        with self.assertRaisesRegex(RuntimeError, 'Partial B2B schema'):
            self.inspect()
        self.markers['guest_table'] = False
        self.ledger.append({'migration_name': 'broken', 'checksum': 'x',
                            'finished_at': None, 'rolled_back_at': None})
        with self.assertRaisesRegex(RuntimeError, 'Unfinished Prisma migration'):
            self.inspect()

    def test_old_rows_must_satisfy_both_new_checks(self):
        self.portal_bad = 1
        with self.assertRaisesRegex(RuntimeError, 'PORTAL source-kind'):
            self.inspect()
        self.portal_bad = 0
        self.quote_bad = 1
        with self.assertRaisesRegex(RuntimeError, 'accepted-pair'):
            self.inspect()

    def test_unknown_checksum_or_unrelated_pending_migration_blocks(self):
        self.ledger[0]['checksum'] = 'unknown'
        with self.assertRaisesRegex(RuntimeError, 'Unexpected historical migration checksum drift'):
            self.inspect()
        self.ledger.pop(0)
        with self.assertRaisesRegex(RuntimeError, 'Unrelated source migrations are pending'):
            self.inspect()

    def test_inspection_uses_database_read_only_transaction(self):
        with patch.object(helper, 'sql', return_value='[]') as run:
            self.assertEqual(helper.rows('SELECT 1 AS value', {}), [])
        query = run.call_args.args[0]
        self.assertTrue(query.startswith('BEGIN READ ONLY;'))
        self.assertIn("SET LOCAL statement_timeout='20s'", query)


if __name__ == '__main__':
    unittest.main()
