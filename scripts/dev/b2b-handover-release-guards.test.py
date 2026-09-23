#!/usr/bin/env python3
"""Pure mocked release tests: no gcloud, build, network, database or secret access."""
import argparse
import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import b2b_release as r


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load('b2b_build', 'build-b2b-handover-release.py')
deploy = load('b2b_deploy', 'deploy-b2b-handover-release.py')
SOURCE = 'b' * 40
LIVE_SOURCE = 'a' * 40
BUILD_ID = '12345678-1234-1234-1234-123456789012'
NOW = '2026-01-01T00:00:00+00:00'


def image(name, candidate=False):
    return r.REGISTRY + name + '@sha256:' + ('c' if candidate else 'a') * 64


def service(name):
    api = name == r.API
    revision = name + '-claw-live'
    values = ({'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921', 'DB_USER': 'erp_dev_runtime',
               'SEED_ON_STARTUP': 'false', 'RUNTIME_SCHEDULES_ENABLED': 'false', 'WMS_PORTAL_SSO_ENABLED': 'true',
               'CORS_ORIGIN': 'https://old.run.app,https://older.run.app', 'ERP_DEV_AI_ENABLED': 'true'} if api else
              {'ERP_DEV_ENVIRONMENT': 'true', 'STAGED_OPERATIONS_ENABLED': 'false',
               'API_URL': 'https://corely-erp-api-dev-test.run.app/api/v1',
               'WS_URL': 'https://corely-erp-api-dev-test.run.app'})
    env = [{'name': key, 'value': value} for key, value in values.items()]
    env.append({'name': 'SOME_SECRET', 'valueFrom': {'secretKeyRef': {'name': 'dev-secret-reference', 'key': '1'}}})
    traffic = [{'revisionName': revision, 'percent': 100}, {'revisionName': name + '-older', 'tag': 'old-tag'}]
    return {'apiVersion': 'serving.knative.dev/v1', 'kind': 'Service',
            'metadata': {'name': name, 'namespace': '249593319772', 'uid': name + '-uid', 'generation': 10,
                         'labels': {'environment': 'dev'}, 'annotations': {'run.googleapis.com/ingress': 'all'}},
            'spec': {'template': {'metadata': {'name': revision, 'annotations': {'autoscaling.knative.dev/maxScale': '2'}},
                                 'spec': {'serviceAccountName': ('corely-erp-dev-rt' if api else 'corely-erp-dev-web') +
                                         '@moztech-main-db.iam.gserviceaccount.com',
                                          'timeoutSeconds': 300, 'containerConcurrency': 80,
                                          'containers': [{'image': image(name), 'env': env,
                                                          'resources': {'limits': {'cpu': '1', 'memory': '1Gi'}}}]}},
                     'traffic': traffic},
            'status': {'traffic': copy.deepcopy(traffic), 'latestReadyRevisionName': revision,
                       'latestCreatedRevisionName': revision, 'url': f'https://{name}-test.run.app',
                       'conditions': [{'type': 'Ready', 'status': 'True'}]}}


def all_services():
    return {name: service(name) for name in r.DEV + r.PROTECTED}


def cloud_build(source=SOURCE, historical=False):
    images = [{'name': r.REGISTRY + name + ':' + ('claw-' if historical else 'b2b-handover-') + source,
               'digest': ('sha256:' + ('a' if historical else 'c') * 64)} for name in r.DEV]
    return {'status': 'SUCCESS', 'images': [row['name'] for row in images], 'results': {'images': images}}


def receipt():
    return {'version': 1, 'project': r.PROJECT, 'database': 'erp_dev_20260921', 'dbUser': 'erp_dev_runtime',
            'schema': 'public', 'sourceSha': SOURCE, 'validatedAt': NOW, 'allApplied': True,
            'migrations': [{'name': name, 'sha256': checksum, 'status': 'applied', 'finishedAt': NOW,
                            'ledgerVerified': True, 'objectsVerified': True} for name, checksum in r.MIGRATIONS.items()]}


def state(live):
    suffix = 'b2b-' + SOURCE[:12]
    urls = {s: live[s]['status']['url'] for s in r.DEV}
    tags = {'candidate': suffix + '-candidate', 'final': suffix + '-final'}
    urls.update({'candidate-api': r.tagged_url(urls[r.API], tags['candidate']),
                 'candidate-web': r.tagged_url(urls[r.WEB], tags['candidate']),
                 'final-web': r.tagged_url(urls[r.WEB], tags['final'])})
    return {'version': 1, 'project': r.PROJECT, 'region': r.REGION, 'sourceSha': SOURCE, 'buildId': BUILD_ID,
            'images': {s: image(s, True) for s in r.DEV}, 'enableB2b': False, 'completed': [],
            'expected': copy.deepcopy(live), 'baseline': copy.deepcopy(live), 'tags': tags, 'urls': urls,
            'rollbackRevisions': {s: live[s]['status']['latestReadyRevisionName'] for s in r.DEV},
            'revisions': {'candidate-api': r.API + '-' + suffix + '-c', 'candidate-web': r.WEB + '-' + suffix + '-c',
                          'final-web': r.WEB + '-' + suffix + '-f'}}


def observed(spec, before, phase):
    value = copy.deepcopy(spec)
    value['metadata'].update(uid=before['metadata']['uid'], generation=before['metadata']['generation'] + 1)
    latest = before['status']['latestReadyRevisionName'] if phase.startswith('promote-') else spec['spec']['template']['metadata']['name']
    value['status'] = {'latestReadyRevisionName': latest, 'latestCreatedRevisionName': latest,
                       'url': before['status']['url'], 'conditions': [{'type': 'Ready', 'status': 'True'}],
                       'traffic': copy.deepcopy(spec['spec']['traffic'])}
    for row in value['status']['traffic']:
        if row.get('tag'):
            row['url'] = r.tagged_url(value['status']['url'], row['tag'])
    return value


class GuardsTest(unittest.TestCase):
    def setUp(self):
        self.no_process = patch.object(subprocess, 'run', side_effect=AssertionError('External process forbidden in unit tests'))
        self.no_process.start()
        self.addCleanup(self.no_process.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.live = all_services()

    def baseline(self, live=None, built=None):
        live = live or self.live
        def metadata(kind, target):
            if kind == 'service':
                return copy.deepcopy(live[target])
            if kind == 'build':
                return built or cloud_build(LIVE_SOURCE, historical=True)
            name = next(s for s in r.DEV if target.startswith(s + '-'))
            return {'status': {'conditions': [{'type': 'Ready', 'status': 'True'}], 'imageDigest': image(name)}}
        with patch.object(r, 'cloud', side_effect=metadata), patch.object(r, 'git', return_value=LIVE_SOURCE):
            return r.capture_baseline(LIVE_SOURCE, BUILD_ID)

    def test_dynamic_baseline_snapshots_active_images_full_specs_and_protected(self):
        result = self.baseline()
        self.assertEqual(set(result['services']), set(r.DEV + r.PROTECTED))
        self.assertEqual(result['services'][r.API], self.live[r.API])
        self.assertEqual(result['images'][r.API], image(r.API))
        self.assertEqual(result['liveSourceSha'], LIVE_SOURCE)

    def test_any_other_ready_or_pending_candidate_blocks_baseline(self):
        for key in ('latestReadyRevisionName', 'latestCreatedRevisionName'):
            with self.subTest(key=key):
                live = copy.deepcopy(self.live)
                live[r.API]['status'][key] = r.API + '-department-candidate'
                with self.assertRaisesRegex(RuntimeError, 'another candidate'):
                    self.baseline(live)

    def test_split_traffic_and_implicit_latest_are_rejected(self):
        for split in (True, False):
            live = copy.deepcopy(self.live)
            if split:
                live[r.API]['status']['traffic'][0]['percent'] = 50
                live[r.API]['status']['traffic'].append({'revisionName': r.API + '-other', 'percent': 50})
            else:
                live[r.API]['spec']['traffic'][0]['latestRevision'] = True
            with self.assertRaises(RuntimeError):
                self.baseline(live)

    def test_active_build_digest_and_template_must_both_match(self):
        built = cloud_build(LIVE_SOURCE, True)
        built['results']['images'][0]['digest'] = 'sha256:' + 'd' * 64
        with self.assertRaisesRegex(RuntimeError, 'both currently serving'):
            self.baseline(built=built)
        r.set_env(self.live[r.API], 'WMS_HANDOVER_ENABLED', 'false')
        self.live[r.API]['spec']['template']['spec']['containers'][0]['image'] = image(r.API, True)
        with self.assertRaisesRegex(RuntimeError, 'template image'):
            self.baseline()

    def test_production_database_account_and_enabled_wms_are_rejected(self):
        for key, value in [('DB_NAME', 'erp'), ('WMS_HANDOVER_ENABLED', 'true'), ('WMS_WORKSPACE_COMMANDS_ENABLED', 'true')]:
            with self.subTest(key=key):
                item = service(r.API)
                r.set_env(item, key, value)
                with self.assertRaises(RuntimeError):
                    r.guards(item)
        with self.assertRaisesRegex(RuntimeError, 'non-DEV'):
            r.guards(service('ecom-accounting-backend'))

    def test_new_candidate_traffic_secret_reference_or_protected_change_is_stale(self):
        mutations = [lambda x: x[r.API]['status'].update(latestCreatedRevisionName='other'),
                     lambda x: x[r.API]['metadata'].update(generation=11),
                     lambda x: r.set_env(x[r.API], 'SOME_SECRET', 'changed'),
                     lambda x: x[r.PROTECTED[0]]['metadata'].update(generation=11)]
        for mutate in mutations:
            actual = copy.deepcopy(self.live)
            mutate(actual)
            with self.assertRaisesRegex(RuntimeError, 'cloud state changed'):
                r.assert_snapshot(self.live, actual)

    def test_source_ancestry_runtime_and_extra_migrations_are_guarded(self):
        with patch.object(r, 'git', return_value=LIVE_SOURCE), patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(RuntimeError, 'must include'):
                r.verify_source(SOURCE, LIVE_SOURCE)
        for runtime, migrations, error in [('backend/package-lock.json', '', 'Dependencies'),
                                            ('', 'A\tbackend/prisma/migrations/unreviewed/migration.sql', 'Unreviewed'),
                                            ('', 'M\tbackend/prisma/migrations/existing/migration.sql', 'Existing')]:
            with patch.object(r, 'git', side_effect=[LIVE_SOURCE, runtime, migrations]), \
                 patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
                with self.assertRaisesRegex(RuntimeError, error):
                    r.verify_source(SOURCE, LIVE_SOURCE)

    def test_only_readonly_cloud_operations_are_available(self):
        for kind, target in [('secret', 'foo'), ('service', 'other-project'), ('revision', 'ecom-accounting-backend-00506'), ('build', 'bad')]:
            with self.assertRaises(RuntimeError):
                r.cloud(kind, target)
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '{}')) as call:
            r.cloud('service', r.API)
            self.assertEqual(call.call_args.args[0], ['gcloud', 'run', 'services', 'describe', r.API,
                                                     '--region=asia-east1', '--project=moztech-main-db', '--format=json'])

    def test_receipt_accepts_only_exact_source_database_and_fixed_migrations(self):
        path = self.directory / 'migration.json'
        r.private_json(path, receipt())
        self.assertEqual(r.migration_receipt(path, SOURCE)['sha256'], r.digest_file(path))
        value = receipt()
        value['migrations'][1]['finishedAt'] = '2026-01-01T00:00:00.87741+00:00'
        value['validatedAt'] = '2026-01-01T00:00:01+00:00'
        r.private_json(path, value)
        self.assertEqual(r.migration_receipt(path, SOURCE)['sha256'], r.digest_file(path))
        cases = [lambda v: v.update(sourceSha=LIVE_SOURCE), lambda v: v.update(database='erp'),
                 lambda v: v['migrations'][0].update(sha256='0' * 64),
                 lambda v: v['migrations'][0].update(ledgerVerified=False),
                 lambda v: v['migrations'][0].update(objectsVerified=False),
                 lambda v: v['migrations'][0].update(finishedAt=None),
                 lambda v: v['migrations'].append(v['migrations'][0]),
                 lambda v: v.update(allApplied=False)]
        for mutate in cases:
            value = receipt()
            mutate(value)
            r.private_json(path, value)
            with self.assertRaises(RuntimeError):
                r.migration_receipt(path, SOURCE)

    def test_receipt_rejects_public_permissions_symlinks_and_non_utc(self):
        path = self.directory / 'migration.json'
        r.private_json(path, receipt())
        path.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'private'):
            r.migration_receipt(path, SOURCE)
        path.chmod(0o600)
        link = self.directory / 'linked.json'
        link.symlink_to(path)
        with self.assertRaises(RuntimeError):
            r.migration_receipt(link, SOURCE)
        value = receipt()
        value['validatedAt'] = '2026-01-01T00:00:00'
        r.private_json(path, value)
        with self.assertRaisesRegex(RuntimeError, 'UTC'):
            r.migration_receipt(path, SOURCE)

    def context(self):
        path = self.directory / 'context'
        path.mkdir(mode=0o700)
        (path / 'Dockerfile').write_text('FROM immutable@sha256:test\n')
        manifest = {'version': 1, 'project': r.PROJECT, 'region': r.REGION, 'devOnly': True, 'sourceSha': SOURCE,
                    'migrationChecksums': r.MIGRATIONS, 'images': [r.REGISTRY + s + ':b2b-handover-' + SOURCE for s in r.DEV],
                    'filesSha256': r.files_manifest(path)}
        r.private_json(path / 'manifest.json', manifest)
        return path

    def test_context_change_extra_files_and_symlinks_are_detected(self):
        context = self.context()
        r.verify_context(context)
        (context / 'extra').write_text('not reviewed')
        with self.assertRaisesRegex(RuntimeError, 'context changed'):
            r.verify_context(context)
        (context / 'extra').unlink()
        (context / 'Dockerfile').write_text('FROM changed\n')
        with self.assertRaisesRegex(RuntimeError, 'context changed'):
            r.verify_context(context)
        (context / 'link').symlink_to(context / 'Dockerfile')
        with self.assertRaisesRegex(RuntimeError, 'symlinks'):
            r.files_manifest(context)

    def test_candidate_preserves_full_runtime_secret_references_tags_and_traffic(self):
        st = state(self.live)
        name, spec = deploy.planned_spec('candidate-api', st, self.live)
        self.assertEqual(name, r.API)
        old_runtime = self.live[name]['spec']['template']['spec']
        new_runtime = spec['spec']['template']['spec']
        for key in old_runtime:
            if key != 'containers':
                self.assertEqual(new_runtime[key], old_runtime[key])
        self.assertEqual(new_runtime['containers'][0]['resources'], old_runtime['containers'][0]['resources'])
        self.assertEqual(r.env_map(spec)['SOME_SECRET'], r.env_map(self.live[name])['SOME_SECRET'])
        self.assertEqual(spec['spec']['traffic'][:-1], self.live[name]['spec']['traffic'])
        self.assertNotIn('percent', spec['spec']['traffic'][-1])
        self.assertEqual(r.tags(spec)['old-tag'], name + '-older')
        self.assertNotIn('B2B_PORTAL_ENABLED', r.env_map(spec))
        self.assertTrue(all(k not in r.env_map(spec) for k in r.DISABLED_FLAGS))

    def test_b2b_flag_requires_explicit_plan_option(self):
        st = state(self.live)
        st['enableB2b'] = True
        _, spec = deploy.planned_spec('candidate-api', st, self.live)
        self.assertEqual(r.env_map(spec)['B2B_PORTAL_ENABLED']['value'], 'true')
        self.assertTrue(all(k not in r.env_map(spec) for k in r.DISABLED_FLAGS))

    def test_web_candidate_uses_candidate_api_final_web_uses_stable(self):
        st = state(self.live)
        _, candidate = deploy.planned_spec('candidate-web', st, self.live)
        self.assertEqual(r.env_map(candidate)['API_URL']['value'], st['urls']['candidate-api'] + '/api/v1')
        self.live[r.WEB] = candidate
        _, final = deploy.planned_spec('final-web', st, self.live)
        self.assertEqual(r.env_map(final)['API_URL']['value'], st['urls'][r.API] + '/api/v1')
        self.assertEqual(r.tags(final)[st['tags']['candidate']], st['revisions']['candidate-web'])

    def test_existing_tag_wildcard_cors_and_invalid_phase_are_rejected(self):
        st = state(self.live)
        self.live[r.API]['spec']['traffic'].append({'tag': st['tags']['candidate'], 'revisionName': 'somebody-else'})
        with self.assertRaisesRegex(RuntimeError, 'overwrite'):
            deploy.planned_spec('candidate-api', st, self.live)
        self.live = all_services()
        r.set_env(self.live[r.API], 'CORS_ORIGIN', 'https://*.example.com')
        with self.assertRaisesRegex(RuntimeError, 'finite'):
            deploy.planned_spec('candidate-api', st, self.live)
        with self.assertRaises(RuntimeError):
            deploy.planned_spec('production', st, self.live)
        with self.assertRaisesRegex(RuntimeError, 'order'):
            deploy.next_phase(st, 'promote-api')

    def test_promotion_requires_matching_complete_acceptance_after_candidates(self):
        st = state(self.live)
        st['completed'] = [{'phase': 'final-web', 'observedAt': NOW}]
        with self.assertRaisesRegex(RuntimeError, 'separate functional'):
            deploy.acceptance_receipt(None, st)
        path = self.directory / 'acceptance.json'
        value = {'version': 1, 'sourceSha': SOURCE, 'buildId': BUILD_ID, 'images': copy.deepcopy(st['images']),
                 'candidateRevisions': st['revisions'], 'validatedAt': NOW,
                 'checks': dict.fromkeys(('authentication', 'permissions', 'affectedWorkflows', 'visibleUi'), True)}
        r.private_json(path, value)
        deploy.acceptance_receipt(path, st)
        st['enableB2b'] = True
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            deploy.acceptance_receipt(path, st)
        st['enableB2b'] = False
        value['images'][r.API] = image(r.API)
        r.private_json(path, value)
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            deploy.acceptance_receipt(path, st)

    def test_complete_plan_observation_sequence_preserves_protected_services(self):
        st = state(self.live)
        st['migrationReceipt'] = {'sha256': 'reviewed'}
        r.private_json(self.directory / 'state.json', st)
        original_protected = {s: copy.deepcopy(self.live[s]) for s in r.PROTECTED}
        def metadata(kind, revision_name):
            self.assertEqual(kind, 'revision')
            name = r.API if revision_name.startswith(r.API + '-') else r.WEB
            return {'status': {'conditions': [{'type': 'Ready', 'status': 'True'}], 'imageDigest': image(name, True)}}
        with patch.object(deploy, 'source_receipts'), patch.object(r, 'snapshot_all', side_effect=lambda: copy.deepcopy(self.live)), \
             patch.object(r, 'cloud', side_effect=metadata):
            for phase in deploy.PHASES:
                acceptance = None
                if phase.startswith('promote-'):
                    acceptance = self.directory / 'acceptance.json'
                    r.private_json(acceptance, {'version': 1, 'sourceSha': SOURCE, 'buildId': BUILD_ID, 'images': st['images'],
                                               'candidateRevisions': st['revisions'], 'validatedAt': r.timestamp(),
                                               'checks': dict.fromkeys(('authentication', 'permissions', 'affectedWorkflows', 'visibleUi'), True)})
                args = argparse.Namespace(phase=phase, acceptance_receipt=acceptance)
                plan = deploy.check_phase(args, st, self.directory)
                self.assertFalse(plan['cloudMutationExecuted'])
                self.assertEqual(plan['mode'], 'plan-only')
                spec = r.private_read(Path(plan['spec']))
                name = plan['service']
                self.live[name] = observed(spec, self.live[name], phase)
                recorded = deploy.record_phase(args, st, self.directory)
                self.assertFalse(recorded['cloudMutationExecuted'])
                with self.assertRaisesRegex(RuntimeError, 'order'):
                    deploy.record_phase(args, st, self.directory)
            result = deploy.verify(st, self.directory)
            self.assertTrue(result['productionAndWmsUnchanged'])
            self.assertEqual({s: self.live[s] for s in r.PROTECTED}, original_protected)
            self.assertEqual(r.active(self.live[r.API]), [[st['revisions']['candidate-api'], 100]])
            self.assertEqual(r.active(self.live[r.WEB]), [[st['revisions']['final-web'], 100]])
            self.assertTrue(all(r.tags(self.live[s])['old-tag'] == s + '-older' for s in r.DEV))

    def test_record_rejects_wrong_digest_concurrent_candidate_and_spec_changes(self):
        st = state(self.live)
        r.private_json(self.directory / 'state.json', st)
        args = argparse.Namespace(phase='candidate-api', acceptance_receipt=None)
        with patch.object(deploy, 'source_receipts'), patch.object(r, 'snapshot_all', side_effect=lambda: copy.deepcopy(self.live)):
            proposed = deploy.check_phase(args, st, self.directory)
            spec = r.private_read(Path(proposed['spec']))
            self.live[r.API] = observed(spec, self.live[r.API], args.phase)
            with patch.object(r, 'cloud', return_value={'status': {'conditions': [{'type': 'Ready', 'status': 'True'}],
                                                                 'imageDigest': image(r.API)}}):
                with self.assertRaisesRegex(RuntimeError, 'digest differs'):
                    deploy.record_phase(args, st, self.directory)
            self.live[r.API]['status']['latestCreatedRevisionName'] = r.API + '-racing-candidate'
            with self.assertRaisesRegex(RuntimeError, 'concurrent candidate'):
                deploy.record_phase(args, st, self.directory)
            spec['metadata']['name'] = 'ecom-accounting-backend'
            r.private_json(Path(proposed['spec']), spec)
            with self.assertRaisesRegex(RuntimeError, 'spec changed'):
                deploy.record_phase(args, st, self.directory)

    def test_build_image_outputs_require_exact_source_and_only_two_dev_destinations(self):
        value = cloud_build()
        self.assertEqual(r.build_images(value, SOURCE), {s: image(s, True) for s in r.DEV})
        value['images'].append('production:bad')
        with self.assertRaisesRegex(RuntimeError, 'unexpected image'):
            r.build_images(value, SOURCE)
        value = cloud_build(LIVE_SOURCE)
        with self.assertRaisesRegex(RuntimeError, 'another source'):
            r.build_images(value, SOURCE)

    def test_build_submission_is_only_a_proposal(self):
        context = self.context()
        manifest = r.verify_context(context)
        proposed = build.submission(context, manifest)
        self.assertFalse(proposed['submitted'])
        self.assertEqual(proposed['mode'], 'plan-only')
        self.assertIn('--project=moztech-main-db', proposed['proposedCommand'])


if __name__ == '__main__':
    unittest.main()
