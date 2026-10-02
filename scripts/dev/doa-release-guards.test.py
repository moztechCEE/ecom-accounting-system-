#!/usr/bin/env python3
"""Mocked DOA release tests: no network, cloud, DB, build or secret access."""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import doa_release as r


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


deploy = load('doa_deploy', 'deploy-doa-release.py')
build = load('doa_build', 'build-doa-release.py')
SOURCE, API_SOURCE, WEB_SOURCE = 'c' * 40, 'a' * 40, 'b' * 40
BUILD_ID, API_BUILD, WEB_BUILD = 'c' * 8 + '-1111-2222-3333-' + 'c' * 12, 'a' * 8 + '-1111-2222-3333-' + 'a' * 12, 'b' * 8 + '-1111-2222-3333-' + 'b' * 12
NOW = '2026-01-01T00:00:00+00:00'
EVIDENCE = {r.API: {'sourceSha': API_SOURCE, 'buildId': API_BUILD, 'buildRegion': 'asia-east1'},
            r.WEB: {'sourceSha': WEB_SOURCE, 'buildId': WEB_BUILD, 'buildRegion': 'global'}}


def image(name, candidate=False, template=False):
    digit = '4' if candidate else '3' if template and name == r.WEB else '1' if name == r.API else '2'
    return r.REGISTRY + name + '@sha256:' + digit * 64


def service(name):
    api = name == r.API
    env = ({'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921', 'DB_USER': 'erp_dev_runtime',
            'SEED_ON_STARTUP': 'false', 'RUNTIME_SCHEDULES_ENABLED': 'false', 'WMS_PORTAL_SSO_ENABLED': 'true',
            'WMS_WORKSPACE_READ_ENABLED': 'true', 'CORS_ORIGIN': 'https://old-web.run.app', 'B2B_PORTAL_ENABLED': 'true'}
           if api else {'ERP_DEV_ENVIRONMENT': 'true', 'STAGED_OPERATIONS_ENABLED': 'false',
                        'DEFAULT_ENTITY_ID': 'tw-entity-001', 'API_URL': 'https://api-dev.run.app/api/v1', 'WS_URL': 'https://api-dev.run.app'})
    traffic = [{'revisionName': name + '-serving', 'percent': 100}, {'revisionName': name + '-old-preview', 'tag': 'old-preview'}]
    latest = name + '-serving'
    if name == r.WEB:
        latest = name + '-b2b-preview'
        traffic.append({'revisionName': latest, 'tag': 'b2b-preview'})
    value = {
        'metadata': {'name': name, 'namespace': '249593319772', 'uid': name + '-uid', 'generation': 10,
                     'labels': {'environment': 'dev'}, 'annotations': {'run.googleapis.com/ingress': 'all'}},
        'spec': {'template': {'metadata': {'name': latest, 'annotations': {'run.googleapis.com/cloudsql-instances': 'fixed-existing'}},
                             'spec': {'serviceAccountName': ('corely-erp-dev-rt' if api else 'corely-erp-dev-web') + '@' + r.PROJECT + '.iam.gserviceaccount.com',
                                      'containerConcurrency': 40, 'timeoutSeconds': 300,
                                      'containers': [{'image': image(name, template=True), 'env': [{'name': k, 'value': v} for k, v in env.items()],
                                                      'ports': [{'containerPort': 3000 if api else 8080}], 'resources': {'limits': {'memory': '1Gi'}},
                                                      'startupProbe': {'tcpSocket': {'port': 3000 if api else 8080}}}]}},
                 'traffic': traffic},
        'status': {'latestReadyRevisionName': latest, 'latestCreatedRevisionName': latest, 'url': 'https://' + name + '-test.run.app',
                   'conditions': [{'type': 'Ready', 'status': 'True'}], 'traffic': copy.deepcopy(traffic)},
    }
    value['spec']['template']['spec']['containers'][0]['env'].append({'name': 'EXISTING_SECRET', 'valueFrom': {'secretKeyRef': {'name': 'existing-dev-secret', 'key': '2'}}})
    return value


def all_services():
    return {name: service(name) for name in r.DEV + r.PROTECTED}


def cloud_build(name=None, source=SOURCE):
    names = [name] if name else list(r.DEV)
    rows = [{'name': r.REGISTRY + service_name + ':' + ('serving-' if name else 'doa-') + source,
             'digest': image(service_name, candidate=not name).split('@')[1]} for service_name in names]
    return {'status': 'SUCCESS', 'images': [row['name'] for row in rows], 'results': {'images': rows}}


def state(live):
    suffix = 'doa-' + SOURCE[:12]
    tags = {'candidate': suffix + '-candidate', 'final': suffix + '-final'}
    urls = {s: live[s]['status']['url'] for s in r.DEV}
    for phase in ('candidate-api', 'candidate-web', 'final-web'):
        name = r.API if phase == 'candidate-api' else r.WEB
        urls[phase] = r.tagged_url(urls[name], tags['final' if phase == 'final-web' else 'candidate'])
    return {'version': 1, 'project': r.PROJECT, 'region': r.REGION, 'sourceSha': SOURCE, 'buildId': BUILD_ID,
            'images': {s: image(s, candidate=True) for s in r.DEV}, 'sourceOptions': r.source_options(),
            'completed': [], 'baseline': copy.deepcopy(live), 'expected': copy.deepcopy(live), 'tags': tags, 'urls': urls,
            'rollbackRevisions': {s: r.active(live[s])[0][0] for s in r.DEV},
            'revisions': {'candidate-api': r.API + '-' + suffix + '-c', 'candidate-web': r.WEB + '-' + suffix + '-c', 'final-web': r.WEB + '-' + suffix + '-f'}}


def receipt():
    return {'version': 1, 'project': r.PROJECT, 'database': 'erp_dev_20260921', 'dbUser': 'erp_dev_runtime', 'schema': 'public',
            'sourceSha': SOURCE, 'allApplied': True, 'validatedAt': NOW, 'unrelatedPendingMigrations': [],
            'migrations': [{'name': name, 'sha256': checksum, 'status': 'applied', 'ledgerVerified': True, 'objectsVerified': True, 'finishedAt': NOW}
                           for name, checksum in r.MIGRATIONS.items()]}


def observed(spec, before, phase):
    value = copy.deepcopy(spec)
    value['metadata'].update(uid=before['metadata']['uid'], generation=before['metadata']['generation'] + 1)
    latest = before['status']['latestReadyRevisionName'] if phase.startswith('promote-') else spec['spec']['template']['metadata']['name']
    value['status'] = {'latestReadyRevisionName': latest, 'latestCreatedRevisionName': latest, 'url': before['status']['url'],
                       'conditions': [{'type': 'Ready', 'status': 'True'}], 'traffic': copy.deepcopy(spec['spec']['traffic'])}
    for entry in value['status']['traffic']:
        if entry.get('tag'):
            entry['url'] = r.tagged_url(value['status']['url'], entry['tag'])
    return value


class GuardsTest(unittest.TestCase):
    def setUp(self):
        blocker = patch.object(subprocess, 'run', side_effect=AssertionError('External process forbidden in guard tests'))
        blocker.start()
        self.addCleanup(blocker.stop)
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.directory = Path(temp.name)
        self.live = all_services()

    def baseline(self, live=None, broken_build=False):
        live = live or self.live
        def metadata(kind, target, *, build_region=r.BUILD_REGION):
            if kind == 'service':
                return copy.deepcopy(live[target])
            if kind == 'build':
                name = r.API if target == API_BUILD else r.WEB
                self.assertEqual(build_region, EVIDENCE[name]['buildRegion'])
                built = cloud_build(name, EVIDENCE[name]['sourceSha'])
                if broken_build:
                    built['results']['images'][0]['digest'] = 'sha256:' + 'f' * 64
                return built
            name = r.API if target.startswith(r.API + '-') else r.WEB
            return {'status': {'conditions': [{'type': 'Ready', 'status': 'True'}], 'imageDigest': image(name, template=target.endswith('b2b-preview'))}}
        with patch.object(r, 'cloud', side_effect=metadata), patch.object(r, 'git', side_effect=lambda *args: args[1].split('^')[0]):
            return r.capture_baseline(EVIDENCE)

    def test_split_serving_builds_and_existing_web_preview_are_preserved(self):
        baseline = self.baseline()
        self.assertEqual(baseline['servingEvidence'], EVIDENCE)
        self.assertEqual(baseline['servingImages'][r.WEB], image(r.WEB))
        self.assertEqual(baseline['images'], baseline['servingImages'])
        self.assertEqual(baseline['templateImages'][r.WEB], image(r.WEB, template=True))
        self.assertNotEqual(baseline['images'][r.WEB], baseline['templateImages'][r.WEB])
        self.assertEqual(r.tags(baseline['services'][r.WEB])['b2b-preview'], r.WEB + '-b2b-preview')
        self.assertEqual(set(baseline['services']), set(r.DEV + r.PROTECTED))

    def test_unready_untagged_candidate_or_wrong_serving_digest_is_rejected(self):
        live = copy.deepcopy(self.live)
        live[r.WEB]['status']['latestCreatedRevisionName'] = r.WEB + '-racing'
        with self.assertRaisesRegex(RuntimeError, 'Unready concurrent'):
            self.baseline(live)
        live = copy.deepcopy(self.live)
        live[r.WEB]['spec']['traffic'].pop()
        with self.assertRaisesRegex(RuntimeError, 'preserved zero-traffic tag'):
            self.baseline(live)
        with self.assertRaisesRegex(RuntimeError, 'Serving build digest'):
            self.baseline(broken_build=True)

    def test_readonly_cloud_allowlist_rejects_secret_and_production_revisions(self):
        for kind, target in [('secret', 'anything'), ('service', 'unlisted-service'), ('revision', 'ecom-accounting-backend-revision'), ('build', 'bad')]:
            with self.assertRaises(RuntimeError):
                r.cloud(kind, target)

    def test_historical_build_reads_use_explicit_allowlisted_region_without_fallback(self):
        for region in r.SERVING_BUILD_REGIONS:
            with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '{}', '')) as process:
                self.assertEqual(r.cloud('build', API_BUILD, build_region=region), {})
                self.assertEqual(process.call_args.args[0], ['gcloud', 'builds', 'describe', API_BUILD,
                                                            '--region=' + region, '--project=' + r.PROJECT, '--format=json'])
                self.assertEqual(process.call_count, 1)
        with patch.object(subprocess, 'run') as process:
            with self.assertRaisesRegex(RuntimeError, 'region is outside'):
                r.cloud('build', API_BUILD, build_region='us-central1')
            with self.assertRaisesRegex(RuntimeError, 'only to build'):
                r.cloud('service', r.API, build_region='asia-east1')
            process.assert_not_called()
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'sensitive error')) as process:
            with self.assertRaisesRegex(RuntimeError, 'credential-bearing output suppressed'):
                r.cloud('build', API_BUILD, build_region='asia-east1')
            self.assertEqual(process.call_count, 1)

    def test_invalid_or_missing_serving_region_fails_before_cloud_read(self):
        for mutate in (lambda row: row.update(buildRegion='us-central1'), lambda row: row.pop('buildRegion')):
            evidence = copy.deepcopy(EVIDENCE)
            mutate(evidence[r.API])
            with patch.object(r, 'cloud') as metadata:
                with self.assertRaises(RuntimeError):
                    r.capture_baseline(evidence)
                metadata.assert_not_called()

    def test_prepare_cli_pins_serving_regions_and_context_verification_rejects_override(self):
        argv = ['build-doa-release.py', '--api-live-source-sha', API_SOURCE, '--api-live-build-id', API_BUILD,
                '--api-live-build-region', 'asia-east1', '--web-live-source-sha', WEB_SOURCE, '--web-live-build-id', WEB_BUILD]
        with patch.object(sys, 'argv', argv), patch.object(build, 'prepare', return_value=(self.directory, {})) as prepare, \
             patch.object(build, 'submission', return_value={}), patch('builtins.print'):
            build.main()
        prepare.assert_called_once_with(None, EVIDENCE)
        with patch.object(sys, 'argv', ['build-doa-release.py', '--verify-context', str(self.directory),
                                       '--api-live-build-region', 'asia-east1']), patch.object(r, 'private_directory') as context:
            with self.assertRaisesRegex(RuntimeError, 'reuses pinned manifest build regions'):
                build.main()
            context.assert_not_called()

    def test_production_database_account_and_mailroom_event_delivery_are_rejected(self):
        for key, value in [('DB_NAME', 'erp'), ('ERP_DEV_SANDBOX', 'false'), ('RUNTIME_SCHEDULES_ENABLED', 'true'), ('MAILROOM_SYNC_ENABLED', 'true')]:
            value_copy = service(r.API)
            r.set_env(value_copy, key, value)
            with self.assertRaises(RuntimeError):
                r.guards(value_copy)
        with self.assertRaisesRegex(RuntimeError, 'non-DEV'):
            r.guards(service('ecom-accounting-backend'))

    def test_exact_dev_source_origin_and_fixed_secret_version_only(self):
        self.assertEqual(r.source_origin('https://' + r.SOURCE_HOST), 'https://' + r.SOURCE_HOST)
        self.assertEqual(r.source_origin('https://qa-01---' + r.SOURCE_HOST), 'https://qa-01---' + r.SOURCE_HOST)
        for url in ['https://moztech-after-sales.run.app', 'https://user:pw@' + r.SOURCE_HOST, 'https://' + r.SOURCE_HOST + ':443',
                    'https://' + r.SOURCE_HOST + '/api', 'https://' + r.SOURCE_HOST + '?x=1', 'https://' + r.SOURCE_HOST + '.evil', 'http://' + r.SOURCE_HOST]:
            with self.assertRaises(RuntimeError):
                r.source_origin(url)
        for enabled, url, secret, version in [(True, None, None, None), (True, 'https://' + r.SOURCE_HOST, 'production-secret', '1'),
                                               (True, 'https://' + r.SOURCE_HOST, r.CONNECTION_SECRET, 'latest'), (False, 'https://' + r.SOURCE_HOST, None, None)]:
            with self.assertRaises(RuntimeError):
                r.source_options(enabled, url, secret, version)

    def test_candidate_preserves_runtime_refs_all_tags_and_old_traffic(self):
        st = state(self.live)
        _, spec = deploy.planned_spec('candidate-api', st, self.live)
        old = self.live[r.API]['spec']['template']['spec']
        new = spec['spec']['template']['spec']
        for key in old:
            if key != 'containers':
                self.assertEqual(new[key], old[key])
        self.assertEqual(new['containers'][0]['resources'], old['containers'][0]['resources'])
        self.assertEqual(r.env_map(spec)['EXISTING_SECRET'], r.env_map(self.live[r.API])['EXISTING_SECRET'])
        self.assertEqual(r.env_map(spec)['B2B_PORTAL_ENABLED']['value'], 'true')
        self.assertEqual(r.env_map(spec)['WMS_WORKSPACE_READ_ENABLED']['value'], 'true')
        self.assertEqual(r.env_map(spec)['MAILROOM_ENABLED']['value'], 'true')
        self.assertEqual(r.env_map(spec)['MAILROOM_SYNC_ENABLED']['value'], 'false')
        self.assertEqual(r.env_map(spec)['ERP_DEV_MAILROOM_EVENTS_ENABLED']['value'], 'false')
        self.assertEqual(r.env_map(spec)['ERP_DEV_MAILROOM_SOURCE_ENABLED']['value'], 'false')
        self.assertEqual(spec['spec']['traffic'][:-1], self.live[r.API]['spec']['traffic'])
        self.assertNotIn('percent', spec['spec']['traffic'][-1])

    def test_source_and_progress_readback_share_fixed_pinned_dev_reference(self):
        st = state(self.live)
        st['sourceOptions'] = r.source_options(True, 'https://' + r.SOURCE_HOST, r.CONNECTION_SECRET, '1')
        _, spec = deploy.planned_spec('candidate-api', st, self.live)
        for key in ('MAILROOM_CONNECTIONS', 'MAILROOM_READERS'):
            self.assertEqual(r.env_map(spec)[key], {'name': key, 'valueFrom': {'secretKeyRef': {'name': r.CONNECTION_SECRET, 'key': '1'}}})
        self.assertEqual(r.env_map(spec)['ERP_DEV_MAILROOM_SOURCE_ENABLED']['value'], 'true')
        self.assertEqual(r.env_map(spec)['MAILROOM_SYNC_ENABLED']['value'], 'false')
        r.guards(spec)
        r.env_map(spec)['MAILROOM_READERS']['valueFrom']['secretKeyRef']['name'] = 'production-secret'
        with self.assertRaises(RuntimeError):
            r.guards(spec)

    def test_events_require_source_and_only_change_dev_api_cpu_annotation(self):
        with self.assertRaisesRegex(RuntimeError, 'requires source enabling'):
            r.source_options(events_enabled=True)
        st = state(self.live)
        st['sourceOptions'] = r.source_options(True, 'https://' + r.SOURCE_HOST, r.CONNECTION_SECRET, '1', True)
        annotations = self.live[r.API]['spec']['template']['metadata']['annotations']
        annotations['autoscaling.knative.dev/minScale'] = '0'
        annotations['run.googleapis.com/cpu-throttling'] = 'true'
        _, spec = deploy.planned_spec('candidate-api', st, self.live)
        self.assertEqual(r.env_map(spec)['ERP_DEV_MAILROOM_EVENTS_ENABLED']['value'], 'true')
        self.assertEqual(r.env_map(spec)['MAILROOM_SYNC_ENABLED']['value'], 'true')
        self.assertEqual(r.env_map(spec)['RUNTIME_SCHEDULES_ENABLED']['value'], 'false')
        self.assertEqual(spec['spec']['template']['metadata']['annotations'],
                         {**annotations, 'run.googleapis.com/cpu-throttling': 'false'})
        r.guards(spec)
        _, web = deploy.planned_spec('candidate-web', st, self.live)
        self.assertEqual(web['spec']['template']['metadata']['annotations'], self.live[r.WEB]['spec']['template']['metadata']['annotations'])

    def test_events_reject_tagged_origin_while_source_read_can_use_it(self):
        tagged = 'https://qa-01---' + r.SOURCE_HOST
        self.assertEqual(r.source_options(True, tagged, r.CONNECTION_SECRET, '1')['url'], tagged)
        with self.assertRaisesRegex(RuntimeError, 'canonical after-sales DEV origin'):
            r.source_options(True, tagged, r.CONNECTION_SECRET, '1', True)
        st = state(self.live)
        st['sourceOptions'] = r.source_options(True, 'https://' + r.SOURCE_HOST, r.CONNECTION_SECRET, '1', True)
        _, spec = deploy.planned_spec('candidate-api', st, self.live)
        r.set_env(spec, 'ERP_DEV_MAILROOM_SOURCE_URL', tagged)
        with self.assertRaisesRegex(RuntimeError, 'canonical after-sales DEV origin'):
            r.guards(spec)

    def test_event_delivery_guard_rejects_missing_pairing_and_global_switches(self):
        st = state(self.live)
        st['sourceOptions'] = r.source_options(True, 'https://' + r.SOURCE_HOST, r.CONNECTION_SECRET, '1', True)
        _, valid = deploy.planned_spec('candidate-api', st, self.live)
        for key, value in [('ERP_DEV_SANDBOX', 'false'), ('MAILROOM_ENABLED', 'false'), ('ERP_DEV_MAILROOM_SOURCE_ENABLED', 'false'),
                           ('MAILROOM_SYNC_ENABLED', 'false'), ('RUNTIME_SCHEDULES_ENABLED', 'true'),
                           ('ERP_DEV_MAILROOM_SOURCE_URL', 'https://production.run.app')]:
            spec = copy.deepcopy(valid)
            r.set_env(spec, key, value)
            with self.assertRaises(RuntimeError):
                r.guards(spec)
        spec = copy.deepcopy(valid)
        spec['spec']['template']['metadata']['annotations']['run.googleapis.com/cpu-throttling'] = 'true'
        with self.assertRaisesRegex(RuntimeError, 'CPU allocation'):
            r.guards(spec)
        spec = copy.deepcopy(valid)
        r.env_map(spec)['MAILROOM_CONNECTIONS']['valueFrom']['secretKeyRef']['key'] = 'latest'
        with self.assertRaises(RuntimeError):
            r.guards(spec)

    def test_only_event_enabled_api_cpu_change_is_allowed_in_runtime(self):
        st = state(self.live)
        st['sourceOptions'] = r.source_options(True, 'https://' + r.SOURCE_HOST, r.CONNECTION_SECRET, '1', True)
        _, valid = deploy.planned_spec('candidate-api', st, self.live)
        for mutate in (
            lambda template: template['metadata']['annotations'].update({'autoscaling.knative.dev/minScale': '1'}),
            lambda template: template['metadata']['annotations'].update({'run.googleapis.com/cloudsql-instances': 'different'}),
            lambda template: template['spec'].update(containerConcurrency=80),
            lambda template: template['spec']['containers'][0]['resources']['limits'].update(memory='2Gi'),
        ):
            spec = copy.deepcopy(valid)
            mutate(spec['spec']['template'])
            with self.assertRaisesRegex(RuntimeError, 'Unrelated template runtime'):
                deploy.assert_runtime_preserved(self.live[r.API], spec, r.API, True)
        with self.assertRaisesRegex(RuntimeError, 'Unrelated template runtime'):
            deploy.assert_runtime_preserved(self.live[r.API], valid, r.API, False)

    def test_portable_metadata_is_ignored_but_effective_runtime_is_preserved(self):
        for name in r.DEV:
            metadata = self.live[name]['spec']['template']['metadata']
            metadata['annotations'].update({'run.googleapis.com/client-name': 'gcloud',
                                            'run.googleapis.com/client-version': 'synthetic-version'})
            metadata['labels'] = {'client.knative.dev/nonce': 'synthetic-nonce', 'retained-label': 'fixed'}
            st = state(self.live)
            _, spec = deploy.planned_spec('candidate-api' if name == r.API else 'candidate-web', st, self.live)
            clean = spec['spec']['template']['metadata']
            self.assertNotIn('run.googleapis.com/client-name', clean['annotations'])
            self.assertNotIn('run.googleapis.com/client-version', clean['annotations'])
            self.assertEqual(clean['labels'], {'retained-label': 'fixed'})
            deploy.assert_runtime_preserved(self.live[name], spec, name, False)
            for mutate in (
                lambda template: template['spec'].update(serviceAccountName='unreviewed-account'),
                lambda template: template['spec']['containers'][0]['resources']['limits'].update(memory='2Gi'),
                lambda template: template['metadata']['labels'].update({'retained-label': 'changed'}),
            ):
                changed = copy.deepcopy(spec)
                mutate(changed['spec']['template'])
                with self.assertRaisesRegex(RuntimeError, 'Unrelated template runtime'):
                    deploy.assert_runtime_preserved(self.live[name], changed, name, False)

    def test_web_candidates_keep_b2b_preview_and_use_candidate_then_stable_api(self):
        st = state(self.live)
        _, candidate = deploy.planned_spec('candidate-web', st, self.live)
        self.assertEqual(r.tags(candidate)['b2b-preview'], r.WEB + '-b2b-preview')
        self.assertEqual(r.env_map(candidate)['API_URL']['value'], st['urls']['candidate-api'] + '/api/v1')
        self.assertEqual(r.env_map(candidate)['MAILROOM_ENABLED']['value'], 'true')
        self.live[r.WEB] = candidate
        _, final = deploy.planned_spec('final-web', st, self.live)
        self.assertEqual(r.env_map(final)['API_URL']['value'], st['urls'][r.API] + '/api/v1')
        self.assertEqual(r.tags(final)['b2b-preview'], r.WEB + '-b2b-preview')

    def test_api_cors_retains_existing_origin_and_adds_stable_and_both_web_candidates(self):
        st = state(self.live)
        _, spec = deploy.planned_spec('candidate-api', st, self.live)
        origins = r.env_map(spec)['CORS_ORIGIN']['value'].split(',')
        self.assertIn('https://old-web.run.app', origins)
        for key in (r.WEB, 'candidate-web', 'final-web'):
            self.assertIn(st['urls'][key], origins)
        self.assertEqual(len(origins), len(set(origins)))

    def test_new_candidate_generation_secret_ref_or_protected_change_is_stale(self):
        for mutate in [lambda v: v[r.API]['status'].update(latestCreatedRevisionName='other'), lambda v: v[r.WEB]['metadata'].update(generation=11),
                       lambda v: r.env_map(v[r.API])['EXISTING_SECRET']['valueFrom']['secretKeyRef'].update(key='3'),
                       lambda v: v[r.PROTECTED[0]]['metadata'].update(generation=12)]:
            actual = copy.deepcopy(self.live)
            mutate(actual)
            with self.assertRaisesRegex(RuntimeError, 'cloud state changed'):
                r.assert_snapshot(self.live, actual)

    def test_source_verifies_both_serving_ancestries_and_only_scoped_runtime_changes(self):
        ancestry = []
        def process(command, **kwargs):
            ancestry.append(command[3])
            return subprocess.CompletedProcess(command, 0)
        def git(*args):
            if args[0] == 'rev-parse':
                return args[1].split('^')[0]
            return ''
        hashes = {**r.PREREQUISITE_MIGRATIONS, **r.MIGRATIONS}
        with patch.object(r, 'git', side_effect=git), patch.object(subprocess, 'run', side_effect=process), \
             patch.object(r, 'digest_file', side_effect=lambda p: hashes[p.parent.name]):
            r.verify_source(SOURCE, {name: row['sourceSha'] for name, row in EVIDENCE.items()})
        self.assertEqual(ancestry, [API_SOURCE, WEB_SOURCE])
        with patch.object(r, 'git', side_effect=git), patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(RuntimeError, 'include currently serving'):
                r.verify_source(SOURCE, {name: row['sourceSha'] for name, row in EVIDENCE.items()})
        def changed(*args):
            return args[1].split('^')[0] if args[0] == 'rev-parse' else 'backend/package-lock.json'
        with patch.object(r, 'git', side_effect=changed), patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaisesRegex(RuntimeError, 'Unreviewed dependency'):
                r.verify_source(SOURCE, {name: row['sourceSha'] for name, row in EVIDENCE.items()})

    def test_receipt_requires_all_four_migrations_and_unrelated_pending_audit(self):
        path = self.directory / 'receipt.json'
        r.private_json(path, receipt())
        r.migration_receipt(path, SOURCE)
        for mutate in [lambda v: v.update(database='erp'), lambda v: v.update(sourceSha=API_SOURCE), lambda v: v.update(unrelatedPendingMigrations=['another']),
                       lambda v: v['migrations'][0].update(ledgerVerified=False), lambda v: v['migrations'][0].update(sha256='0' * 64),
                       lambda v: v['migrations'].pop()]:
            value = receipt()
            mutate(value)
            r.private_json(path, value)
            with self.assertRaises(RuntimeError):
                r.migration_receipt(path, SOURCE)

    def test_migration_receipt_rejects_public_permissions_and_symlinks(self):
        path = self.directory / 'receipt.json'
        r.private_json(path, receipt())
        path.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'private'):
            r.migration_receipt(path, SOURCE)
        path.chmod(0o600)
        link = self.directory / 'link.json'
        link.symlink_to(path)
        with self.assertRaises(RuntimeError):
            r.migration_receipt(link, SOURCE)

    def test_build_outputs_require_per_service_history_and_exact_new_source(self):
        one = cloud_build(r.API, API_SOURCE)
        with patch.object(r, 'git', return_value=API_SOURCE):
            self.assertEqual(r.build_image(one, r.API, API_SOURCE, True), image(r.API))
        with self.assertRaisesRegex(RuntimeError, 'exactly both'):
            r.build_images(one, SOURCE)
        built = cloud_build()
        self.assertEqual(r.build_images(built, SOURCE), {name: image(name, candidate=True) for name in r.DEV})
        built['images'].append('production:bad')
        with self.assertRaisesRegex(RuntimeError, 'unexpected image'):
            r.build_images(built, SOURCE)

    def test_private_context_binds_both_runtime_overlays_and_detects_tampering(self):
        context = self.directory / 'context'
        context.mkdir(mode=0o700)
        for relative in ('backend/dev-sandbox.cjs', 'frontend/server.mjs'):
            path = context / relative
            path.parent.mkdir(exist_ok=True)
            path.write_text('reviewed runtime\n')
        manifest = {'version': 1, 'project': r.PROJECT, 'region': r.REGION, 'devOnly': True, 'sourceSha': SOURCE,
                    'baseline': {'servingEvidence': EVIDENCE},
                    'migrationChecksums': r.MIGRATIONS, 'prerequisiteMigrationChecksums': r.PREREQUISITE_MIGRATIONS,
                    'images': [r.REGISTRY + name + ':doa-' + SOURCE for name in r.DEV],
                    'reviewedRuntimeFiles': {'backend/scripts/dev-sandbox.cjs': r.digest_file(context / 'backend/dev-sandbox.cjs'),
                                            'frontend/server.mjs': r.digest_file(context / 'frontend/server.mjs')},
                    'filesSha256': r.files_manifest(context)}
        r.private_json(context / 'manifest.json', manifest)
        checked = r.verify_context(context)
        invalid = copy.deepcopy(manifest)
        invalid['baseline']['servingEvidence'][r.API]['buildRegion'] = 'us-central1'
        r.private_json(context / 'manifest.json', invalid)
        with self.assertRaisesRegex(RuntimeError, 'region is outside'):
            r.verify_context(context)
        r.private_json(context / 'manifest.json', manifest)
        plan = build.submission(context, checked)
        self.assertFalse(plan['submitted'])
        self.assertEqual(plan['mode'], 'plan-only')
        (context / 'frontend/server.mjs').write_text('changed runtime\n')
        with self.assertRaisesRegex(RuntimeError, 'context changed'):
            r.verify_context(context)

    def test_prepared_overlay_copies_both_reviewed_runtime_files_and_excludes_private_manifest_upload(self):
        source_root = self.directory / 'source'
        for relative, content in (
            ('backend/dist/app.js', 'compiled backend'), ('frontend/dist/index.html', 'compiled frontend'),
            ('backend/prisma/schema.prisma', 'reviewed schema'),
            ('backend/scripts/dev-sandbox.cjs', 'reviewed DEV guard'), ('frontend/server.mjs', 'reviewed runtime config'),
        ):
            path = source_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        baseline = self.baseline()
        context = self.directory / 'prepared'
        with patch.object(r, 'ROOT', source_root), patch.object(r, 'clean_source', return_value=SOURCE), patch.object(r, 'verify_source'), \
             patch.object(r, 'capture_baseline', return_value=baseline), patch.object(r, 'snapshot_all', return_value=self.live), \
             patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as process:
            _, manifest = build.prepare(context, EVIDENCE)
        self.assertEqual(len(process.call_args_list), 5)
        self.assertTrue(all('gcloud' not in call.args[0] for call in process.call_args_list))
        self.assertIn('manifest.json', (context / '.gcloudignore').read_text().splitlines())
        self.assertIn('.gcloudignore', manifest['filesSha256'])
        self.assertNotIn('manifest.json', manifest['filesSha256'])
        self.assertEqual((context / 'frontend/server.mjs').read_text(), 'reviewed runtime config')
        self.assertEqual((context / 'frontend/Dockerfile').read_text().splitlines()[0], 'FROM ' + image(r.WEB))
        self.assertNotIn(image(r.WEB, template=True), (context / 'frontend/Dockerfile').read_text())
        self.assertEqual(manifest['baseline']['templateImages'][r.WEB], image(r.WEB, template=True))
        self.assertEqual((context / 'backend/Dockerfile').read_text().splitlines()[0], 'FROM ' + image(r.API))
        self.assertIn('COPY server.mjs /app/server.mjs', (context / 'frontend/Dockerfile').read_text())
        self.assertIn('WORKDIR /app', (context / 'frontend/Dockerfile').read_text())
        self.assertIn('COPY dev-sandbox.cjs /app/scripts/dev-sandbox.cjs', (context / 'backend/Dockerfile').read_text())
        self.assertEqual(set(manifest['reviewedRuntimeFiles']), set(r.REVIEWED_RUNTIME_FILES))

    def acceptance(self, st):
        return {'version': 1, 'sourceSha': SOURCE, 'buildId': BUILD_ID, 'images': st['images'],
                'candidateRevisions': st['revisions'], 'validatedAt': r.timestamp(),
                'checks': dict.fromkeys(('authentication', 'permissions', 'affectedWorkflows', 'visibleUi', 'doaWorkbench', 'snLabels', 'existingWebPreviewPreserved'), True)}

    def test_promotion_requires_bound_doa_sn_and_preview_acceptance(self):
        st = state(self.live)
        st['completed'] = [{'phase': 'final-web', 'observedAt': NOW}]
        path = self.directory / 'acceptance.json'
        value = self.acceptance(st)
        r.private_json(path, value)
        deploy.acceptance_receipt(path, st)
        value['checks']['snLabels'] = False
        r.private_json(path, value)
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            deploy.acceptance_receipt(path, st)
        st['sourceOptions'] = r.source_options(True, 'https://' + r.SOURCE_HOST, r.CONNECTION_SECRET, '1')
        r.private_json(path, self.acceptance(st))
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            deploy.acceptance_receipt(path, st)

    def test_event_promotion_requires_separate_source_write_acceptance(self):
        st = state(self.live)
        st['sourceOptions'] = r.source_options(True, 'https://' + r.SOURCE_HOST, r.CONNECTION_SECRET, '1', True)
        st['completed'] = [{'phase': 'final-web', 'observedAt': NOW}]
        path = self.directory / 'write-acceptance.json'
        value = self.acceptance(st)
        value['checks']['doaSourceRead'] = True
        r.private_json(path, value)
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            deploy.acceptance_receipt(path, st)
        value['checks']['doaSourceWrite'] = True
        r.private_json(path, value)
        deploy.acceptance_receipt(path, st)

    def test_complete_plan_observation_preserves_protected_services_and_b2b_tag(self):
        st = state(self.live)
        st['migrationReceipt'] = {'sha256': 'reviewed-test-receipt'}
        r.private_json(self.directory / 'state.json', st)
        protected = {name: copy.deepcopy(self.live[name]) for name in r.PROTECTED}
        def revision(kind, target):
            self.assertEqual(kind, 'revision')
            name = r.API if target.startswith(r.API + '-') else r.WEB
            return {'status': {'conditions': [{'type': 'Ready', 'status': 'True'}], 'imageDigest': image(name, candidate=True)}}
        with patch.object(deploy, 'source_receipts'), patch.object(r, 'snapshot_all', side_effect=lambda: copy.deepcopy(self.live)), patch.object(r, 'cloud', side_effect=revision):
            for phase in deploy.PHASES:
                acceptance = None
                if phase.startswith('promote-'):
                    acceptance = self.directory / 'acceptance.json'
                    r.private_json(acceptance, self.acceptance(st))
                args = argparse.Namespace(phase=phase, acceptance_receipt=acceptance)
                proposed = deploy.check_phase(args, st, self.directory)
                self.assertFalse(proposed['cloudMutationExecuted'])
                spec = r.private_read(Path(proposed['spec']))
                name = proposed['service']
                self.live[name] = observed(spec, self.live[name], phase)
                deploy.record_phase(args, st, self.directory)
            result = deploy.verify(st, self.directory)
        self.assertTrue(result['productionAndWmsUnchanged'])
        self.assertEqual({name: self.live[name] for name in r.PROTECTED}, protected)
        self.assertEqual(r.tags(self.live[r.WEB])['b2b-preview'], r.WEB + '-b2b-preview')

    def test_wrong_digest_concurrent_candidate_and_changed_spec_cannot_record(self):
        st = state(self.live)
        r.private_json(self.directory / 'state.json', st)
        args = argparse.Namespace(phase='candidate-api', acceptance_receipt=None)
        with patch.object(deploy, 'source_receipts'), patch.object(r, 'snapshot_all', side_effect=lambda: copy.deepcopy(self.live)):
            proposed = deploy.check_phase(args, st, self.directory)
            spec = r.private_read(Path(proposed['spec']))
            self.live[r.API] = observed(spec, self.live[r.API], args.phase)
            with patch.object(r, 'cloud', return_value={'status': {'conditions': [{'type': 'Ready', 'status': 'True'}], 'imageDigest': image(r.API)}}):
                with self.assertRaisesRegex(RuntimeError, 'digest differs'):
                    deploy.record_phase(args, st, self.directory)
            self.live[r.API]['status']['latestCreatedRevisionName'] = r.API + '-racing'
            with self.assertRaisesRegex(RuntimeError, 'concurrent candidate'):
                deploy.record_phase(args, st, self.directory)
            spec['metadata']['name'] = 'ecom-accounting-backend'
            r.private_json(Path(proposed['spec']), spec)
            with self.assertRaisesRegex(RuntimeError, 'spec changed'):
                deploy.record_phase(args, st, self.directory)


if __name__ == '__main__':
    unittest.main()
