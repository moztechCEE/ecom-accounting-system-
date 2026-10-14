#!/usr/bin/env python3
"""Offline synthetic fixtures: no cloud/secret/DB/build invocation."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('flowrelease', Path(__file__).with_name('doa-flow-release-20261014.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
PINS = r.source_pins('a' * 40, 'b' * 40, r.WMS_SOURCE)
BUILD_ID = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb'


def container(name, image, values=None, refs=None, ingress=False):
    result = {'image': image, 'env': [{'name': k, 'value': v} for k, v in (values or {}).items()] +
              [{'name': k, 'valueFrom': {'secretKeyRef': {'name': v[0], 'key': v[1]}}} for k, v in (refs or {}).items()],
              'resources': {'limits': {'cpu': '1', 'memory': '1Gi'}}, 'args': ['synthetic-runtime-guard'],
              'startupProbe': {'tcpSocket': {'port': 8080}}}
    if name:
        result['name'] = name
    if ingress:
        result['ports'] = [{'containerPort': 8080}]
    return result


def image(key, digit='1'):
    return r.REGISTRY + r.IMAGE_KEYS[key] + '@sha256:' + digit * 64


def wms_rows_patch(rows):
    # Synthetic legacy rows exercise the unchanged 5c profile independently of
    # the separately pinned ef manifest and its actual public-context check.
    return patch.dict(r.WMS_REUSE_PROFILES[r.WMS_SOURCE], {'fileRowsSha256': r.sha256(r.canonical(rows))})


def wms_proof_patch(manifest):
    values = {'fileRowsSha256': r.sha256(r.canonical(manifest['files']))}
    if manifest['commit'] == r.WMS_EF_SOURCE:
        values['manifestCanonicalSha256'] = r.sha256(r.canonical(manifest))
    return patch.dict(r.WMS_REUSE_PROFILES[manifest['commit']], values)


def fixture():
    values = {r.API: {'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921', 'DB_USER': 'erp_dev_runtime',
                     'SEED_ON_STARTUP': 'false', 'RUNTIME_SCHEDULES_ENABLED': 'false', 'CORS_ORIGIN': r.ORIGINS[r.WEB],
                     'ERP_DEV_MAILROOM_SOURCE_URL': r.ORIGINS[r.SOURCE]},
              r.WEB: {'ERP_DEV_ENVIRONMENT': 'true', 'API_URL': r.ORIGINS[r.API] + '/api/v1'},
              r.SOURCE: {'AS_MAILROOM_DEV': 'true', 'APP_ENV': 'development', 'RUNTIME_ENV': 'dev', 'ERP_MODULE_BUILD': 'false',
                         'NEXT_PUBLIC_ERP_MODULE': 'false', 'ERP_MODULE_ENABLED': 'false', 'NEXTAUTH_URL': r.ORIGINS[r.SOURCE],
                         'ERP_INTEGRATION_APP_ORIGINS': r.ORIGINS[r.WEB], 'STUB_MODE': 'synthetic'},
              r.MODULE: {'AS_MAILROOM_DEV': 'true', 'APP_ENV': 'development', 'RUNTIME_ENV': 'dev', 'ERP_MODULE_BUILD': 'true',
                         'NEXT_PUBLIC_ERP_MODULE': 'true', 'ERP_MODULE_ENABLED': 'true', 'NEXTAUTH_URL': r.ORIGINS[r.MODULE] + '/after-sales-app',
                         'ERP_INTEGRATION_APP_ORIGINS': r.ORIGINS[r.WEB], 'STUB_MODE': 'synthetic'},
              r.WMS: {'PGDATABASE': 'corely_wms_dev_20260915', 'PGUSER': 'corely_wms_dev_20260915',
                      'WMS_ECPAY_CALLBACKS_ENABLED': 'false', 'ERP_PORTAL_ONLY': 'true', 'PGHOST': '/cloudsql/synthetic',
                      'ERP_PORTAL_ORIGIN': r.ORIGINS[r.WEB]}}
    refs = {r.API: {'DB_PASSWORD': ('corely-erp-dev-db-password', '1'), 'JWT_SECRET': ('corely-erp-dev-jwt', '1')},
            r.SOURCE: {'DATABASE_URL': ('moztech-aftersales-dev-database-url', '2')},
            r.MODULE: {'DATABASE_URL': ('moztech-aftersales-dev-database-url', '2')},
            r.WMS: {'PGPASSWORD': ('corely-wms-dev-db-password', '1'), 'JWT_SECRET': ('corely-wms-dev-jwt', '1')}}
    for (name, _, environment_key), reference in r.EXISTING_EXTERNAL_REFS.items():
        refs[name][environment_key] = reference
    result = {}
    for name in r.ALL:
        named = {r.API: 'corely-erp-api-dev-1', r.WEB: 'corely-erp-dev-1'}.get(name)
        if name == r.WMS:
            cs = [container('web', image('wms-web'), ingress=True), container('api', image('wms-api'), values[name], refs[name])]
        else:
            img = image(name) if name in r.DEV else 'protected-image:unchanged'
            cs = [container(named, img, values.get(name), refs.get(name), ingress=True)]
        template = name + '-serving'
        traffic = [{'revisionName': template, 'percent': 100, 'tag': 'aftersales-review'},
                   {'revisionName': name + '-foreign', 'tag': 'unrelated-owner'},
                   {'revisionName': name + '-old-final', 'tag': 'aftersales-final'}]
        result[name] = {'apiVersion': 'serving.knative.dev/v1', 'kind': 'Service',
                        'metadata': {'name': name, 'namespace': r.NAMESPACE, 'uid': 'synthetic-' + name,
                                     'resourceVersion': 'opaque-CAS-' + name, 'labels': {'owner': 'existing'},
                                     'annotations': {'run.googleapis.com/ingress': 'all', 'run.googleapis.com/invoker-iam-disabled': 'true'}},
                        'spec': {'template': {'metadata': {'name': template, 'annotations': {
                            'run.googleapis.com/container-dependencies': '{"web":["api"]}' if name == r.WMS else '{}',
                            'run.googleapis.com/cloudsql-instances': 'synthetic-unchanged', 'run.googleapis.com/vpc-access-egress': 'private-ranges-only'}},
                            'spec': {'serviceAccountName': 'synthetic-dev@moztech-main-db.iam.gserviceaccount.com',
                                     'containers': cs, 'timeoutSeconds': 300, 'containerConcurrency': 40}}, 'traffic': traffic},
                        'status': {'url': r.ORIGINS.get(name, 'https://protected.invalid'), 'conditions': [{'type': 'Ready', 'status': 'True'}],
                                   'latestReadyRevisionName': template, 'latestCreatedRevisionName': template}}
    return result


def built():
    images, rows = {}, []
    for key, repository in r.IMAGE_KEYS.items():
        images[key] = {'image': image(key, '2'), 'buildId': BUILD_ID}
        owner = 'wms' if key.startswith('wms-') else 'source' if key in (r.SOURCE, r.MODULE) else 'erp'
        rows.append({'name': r.REGISTRY + repository + ':doaf-' + PINS[owner], 'digest': 'sha256:' + '2' * 64})
    return {'version': 1, 'project': r.PROJECT, 'sourcePins': PINS, 'images': images,
            'preparedManifestSha256': 'f' * 64, 'preparedContextSha256': 'e' * 64,
            'builds': {BUILD_ID: {'status': 'SUCCESS', 'projectId': r.PROJECT, 'region': r.REGION,
                                 'images': [row['name'] for row in rows], 'results': {'images': rows}}}}


class FlowReleaseTests(unittest.TestCase):
    def setUp(self):
        self.live = fixture()
        self.images = r.build_images(built(), PINS)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # macOS /var is an OS symlink; use its canonical private path while
        # still testing user-created symlink rejection explicitly.
        self.directory = Path(self.temp.name).resolve()
        # Small synthetic source contexts exercise the same approved tuples;
        # actual manifest counts are independently pinned/read back by Root.
        profiles = copy.deepcopy(r.SOURCE_REUSE_PROFILES)
        profiles[(r.SOURCE_EXISTING_SHA, r.SOURCE_EXISTING_BUILD, r.SOURCE_EXISTING_MANIFEST)]['sourceFileCount'] = 3
        profile_patch = patch.object(r, 'SOURCE_REUSE_PROFILES', profiles)
        profile_patch.start()
        self.addCleanup(profile_patch.stop)
        no_external = patch.object(r.subprocess, 'run', side_effect=AssertionError('No process/cloud/DB/build/secret execution permitted'))
        no_external.start()
        self.addCleanup(no_external.stop)

    def test_actual_dev_identity_and_existing_four_refs_without_invented_wms_label(self):
        refs = r.snapshot_guard(self.live)
        self.assertEqual(sum(x['preservedExistingExternalReference'] for x in refs), 4)
        self.assertNotIn('environment', self.live[r.WMS]['metadata']['labels'])
        for name in (r.API, r.WEB, r.SOURCE, r.MODULE, r.WMS):
            wrong = copy.deepcopy(self.live)
            wrong[name]['metadata']['namespace'] = 'production-project'
            with self.assertRaises(RuntimeError):
                r.snapshot_guard(wrong)

    def test_wrong_database_secret_topology_provider_and_unready_fail_closed(self):
        changes = [
            lambda d: r.set_env(r.containers(d[r.API])[0], {'DB_NAME': 'erp_production'}),
            lambda d: r.set_env(r.containers(d[r.WMS])[1], {'PGUSER': 'postgres'}),
            lambda d: r.set_env(r.containers(d[r.SOURCE])[0], {'LINE_CHANNEL_ACCESS_TOKEN': 'not-a-real-token'}),
            lambda d: r.set_env(r.containers(d[r.API])[0], {}, {'DB_PASSWORD': {'secretKeyRef': {'name': 'prod-db', 'key': '1'}}}),
            lambda d: d[r.WMS]['spec']['template']['spec']['containers'].reverse(),
            lambda d: d[r.API]['status'].update(latestCreatedRevisionName='not-ready'),
            lambda d: d[r.API]['metadata'].pop('resourceVersion'),
        ]
        for modify in changes:
            wrong = copy.deepcopy(self.live)
            modify(wrong)
            with self.subTest(modify=modify), self.assertRaises(RuntimeError):
                r.snapshot_guard(wrong)

    def test_shared_marketplace_ref_cannot_be_changed_or_silently_removed(self):
        for identity in r.EXISTING_EXTERNAL_REFS:
            name, container_name, key = identity
            wrong = copy.deepcopy(self.live)
            c = next(c for c in r.containers(wrong[name]) if c.get('name') == container_name)
            c['env'] = [e for e in c['env'] if e['name'] != key]
            with self.assertRaisesRegex(RuntimeError, 'four approved'):
                r.snapshot_guard(wrong)
            r.set_env(c, {}, {key: {'secretKeyRef': {'name': 'other-dev-secret', 'key': '1'}}})
            with self.assertRaisesRegex(RuntimeError, 'external reference changed'):
                r.snapshot_guard(wrong)

    def test_candidate_preserves_traffic_foreign_tags_runtime_iam_and_secret_refs(self):
        original = copy.deepcopy(self.live)
        specs, urls = r.candidate_specs(self.live, PINS, self.images)
        self.assertEqual(self.live, original)
        self.assertEqual(set(specs), set(r.DEV))
        for name in r.DEV:
            spec = specs[name]
            self.assertEqual(sum(row.get('percent', 0) for row in spec['spec']['traffic']), 100)
            self.assertEqual(next(x for x in spec['spec']['traffic'] if x.get('tag') == 'unrelated-owner'), original[name]['spec']['traffic'][1])
            self.assertEqual(spec['metadata']['resourceVersion'], original[name]['metadata']['resourceVersion'])
            self.assertEqual(spec['metadata']['annotations'], original[name]['metadata']['annotations'])
            self.assertEqual(spec['spec']['template']['spec']['serviceAccountName'], original[name]['spec']['template']['spec']['serviceAccountName'])
            self.assertNotIn('status', spec)
            for c in r.containers(spec):
                self.assertEqual(r.value(c, 'SOURCE_VERSION'), PINS['wms' if name == r.WMS else 'source' if name in (r.SOURCE, r.MODULE) else 'erp'])
        self.assertEqual([c['name'] for c in r.containers(specs[r.WMS])], ['web', 'api'])
        self.assertNotIn('ports', r.containers(specs[r.WMS])[1])
        self.assertEqual(r.value(r.containers(specs[r.API])[0], 'AFTER_SALES_TASK_SOURCE_URL'), urls[r.MODULE] + '/after-sales-app')
        self.assertEqual(r.value(r.containers(specs[r.WEB])[0], 'AFTER_SALES_MODULE_URL'), r.ORIGINS[r.MODULE])
        self.assertEqual(r.value(r.containers(specs[r.API])[0], 'ERP_DEV_MAILROOM_SOURCE_URL'), r.ORIGINS[r.SOURCE])
        self.assertEqual(r.value(r.containers(specs[r.SOURCE])[0], 'NEXTAUTH_URL'), r.ORIGINS[r.SOURCE])
        self.assertEqual(r.value(r.containers(specs[r.MODULE])[0], 'ERP_MODULE_BUILD'), 'true')
        self.assertEqual(r.value(r.containers(specs[r.SOURCE])[0], 'ERP_MODULE_BUILD'), 'false')
        self.assertEqual(r.value(r.containers(specs[r.SOURCE])[0], 'STUB_MODE'), 'synthetic')
        self.assertEqual(r.value(r.containers(specs[r.API])[0], 'REPAIR_REPORT_PUBLIC_ORIGIN'), r.ORIGINS[r.WEB])
        self.assertEqual(r.env_map(r.containers(specs[r.API])[0])['REPAIR_REPORT_LINK_SECRET']['valueFrom'], r.NEW_SECRET['REPAIR_REPORT_LINK_SECRET'])
        self.assertTrue(all(not any(e['name'].startswith('REPAIR_') for c in r.containers(specs[s]) for e in c['env']) for s in r.DEV if s != r.API))

    def test_owned_tag_that_currently_carries_traffic_gets_split_not_promoted(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        for name in (r.API, r.WEB, r.SOURCE, r.MODULE):
            traffic = specs[name]['spec']['traffic']
            old = next(t for t in traffic if t.get('percent') == 100)
            self.assertEqual(old, {'revisionName': name + '-serving', 'percent': 100})
            new = next(t for t in traffic if t.get('tag') == 'aftersales-review')
            self.assertEqual(new['percent'], 0)
            self.assertNotEqual(new['revisionName'], old['revisionName'])

    def test_final_and_canonical_pair_are_explicit_only_no_production(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images, 'final', 'canonical')
        self.assertEqual(r.value(r.containers(specs[r.API])[0], 'AFTER_SALES_TASK_SOURCE_URL'), r.ORIGINS[r.MODULE] + '/after-sales-app')
        self.assertTrue(any(x.get('tag') == 'doa-warehouse-review' for x in specs[r.WMS]['spec']['traffic']))
        for name in r.PROTECTED:
            self.assertNotIn(name, specs)
        with self.assertRaises(RuntimeError):
            r.candidate_specs(self.live, PINS, self.images, 'foreign-tag')
        with self.assertRaises(RuntimeError):
            r.candidate_specs(self.live, PINS, self.images, pairing='production')

    def test_repair_adc_project_is_explicit_and_only_added_to_dev_api(self):
        self.assertEqual(r.REPAIR_VALUES['GOOGLE_CLOUD_PROJECT'], r.PROJECT)
        original = copy.deepcopy(self.live)
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        self.assertEqual(r.value(r.containers(specs[r.API])[0], 'GOOGLE_CLOUD_PROJECT'), 'moztech-main-db')
        for name in r.DEV:
            if name != r.API:
                self.assertTrue(all('GOOGLE_CLOUD_PROJECT' not in r.env_map(c) for c in r.containers(specs[name])))
        for name in r.PROTECTED:
            self.assertEqual(self.live[name], original[name])
            self.assertNotIn(name, specs)
        self.assertEqual(self.live, original)

    def test_repair_project_preservation_rejects_missing_wrong_or_secret_reference(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        for setting in (None, 'other-project', '', {'secretKeyRef': {'name': 'other-dev-project', 'key': '1'}}):
            altered = copy.deepcopy(specs[r.API])
            c = r.containers(altered)[0]
            c['env'] = [e for e in c['env'] if e['name'] != 'GOOGLE_CLOUD_PROJECT']
            if isinstance(setting, dict):
                r.set_env(c, secrets={'GOOGLE_CLOUD_PROJECT': setting})
            elif setting is not None:
                r.set_env(c, {'GOOGLE_CLOUD_PROJECT': setting})
            with self.subTest(setting=setting), self.assertRaises(RuntimeError):
                r.assert_candidate_preserved(self.live[r.API], altered, 'aftersales-review')

    def test_repair_project_refuses_conflicting_higher_precedence_adc_alias(self):
        for setting in ('another-project', {'secretKeyRef': {'name': 'synthetic-dev-project', 'key': '1'}}):
            baseline = copy.deepcopy(self.live)
            c = r.containers(baseline[r.API])[0]
            if isinstance(setting, dict):
                r.set_env(c, secrets={'GCLOUD_PROJECT': setting})
            else:
                r.set_env(c, {'GCLOUD_PROJECT': setting})
            with self.subTest(setting=setting), self.assertRaisesRegex(RuntimeError, 'higher-precedence'):
                r.candidate_specs(baseline, PINS, self.images)
        for setting in ('', r.PROJECT):
            baseline = copy.deepcopy(self.live)
            r.set_env(r.containers(baseline[r.API])[0], {'GCLOUD_PROJECT': setting})
            specs, _ = r.candidate_specs(baseline, PINS, self.images)
            self.assertEqual(r.value(r.containers(specs[r.API])[0], 'GCLOUD_PROJECT'), setting)

    def test_warehouse_browser_and_native_urls_stay_canonical_for_every_pairing(self):
        for stage in ('review', 'final'):
            for pairing in ('candidate', 'canonical'):
                specs, urls = r.candidate_specs(self.live, PINS, self.images, stage, pairing)
                api, web = r.containers(specs[r.API])[0], r.containers(specs[r.WEB])[0]
                for key in ('WMS_PORTAL_SERVICE_URL', 'WMS_WORKSPACE_URL'):
                    self.assertEqual(r.value(api, key), r.ORIGINS[r.WMS])
                self.assertEqual(r.value(web, 'WMS_PORTAL_URL'), r.ORIGINS[r.WMS])
                expected_api = urls[r.API] if pairing == 'candidate' else r.ORIGINS[r.API]
                self.assertEqual(r.value(web, 'API_URL'), expected_api + '/api/v1')
                self.assertEqual(r.value(r.containers(specs[r.SOURCE])[0], 'ERP_INTEGRATION_API_ORIGIN'), expected_api)
                self.assertEqual(r.value(r.containers(specs[r.WMS])[1], 'ERP_PORTAL_API_URL'), expected_api + '/api/v1')
                self.assertEqual(r.value(api, 'AFTER_SALES_TASK_SOURCE_URL'),
                                 (urls[r.MODULE] if pairing == 'candidate' else r.ORIGINS[r.MODULE]) + '/after-sales-app')

    def test_warehouse_url_preservation_rejects_tagged_foreign_or_missing_values(self):
        specs, urls = r.candidate_specs(self.live, PINS, self.images)
        for name, keys in ((r.API, ('WMS_PORTAL_SERVICE_URL', 'WMS_WORKSPACE_URL')), (r.WEB, ('WMS_PORTAL_URL',))):
            for key in keys:
                for value in (None, urls[r.WMS], 'https://foreign.invalid', r.ORIGINS[r.WMS] + '/'):
                    altered = copy.deepcopy(specs[name])
                    c = r.containers(altered)[0]
                    c['env'] = [e for e in c['env'] if e['name'] != key]
                    if value is not None:
                        r.set_env(c, {key: value})
                    with self.subTest(name=name, key=key, value=value), self.assertRaises(RuntimeError):
                        r.assert_candidate_preserved(self.live[name], altered, 'aftersales-review')

    def test_warehouse_cors_preserves_all_origins_in_order_and_only_appends_self(self):
        original_origins = ['http://localhost:3000', r.ORIGINS[r.WEB], 'https://existing.invalid']
        r.set_env(r.containers(self.live[r.WMS])[1], {'CORS_ORIGINS': ', '.join([*original_origins, original_origins[0]])})
        original = copy.deepcopy(self.live)
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        c = r.containers(specs[r.WMS])[1]
        self.assertEqual(r.value(c, 'CORS_ORIGINS').split(','), [*original_origins, r.ORIGINS[r.WMS]])
        self.assertEqual(r.value(c, 'ERP_PORTAL_ORIGIN'), r.ORIGINS[r.WEB])
        self.assertEqual(r.containers(specs[r.WMS])[0].get('env'),
                         [{'name': 'SOURCE_VERSION', 'value': PINS['wms']}])
        self.assertEqual(self.live, original)

    def test_warehouse_cors_existing_self_is_deduplicated_without_reordering(self):
        origins = [r.ORIGINS[r.WMS], r.ORIGINS[r.WEB], 'http://localhost:3000']
        r.set_env(r.containers(self.live[r.WMS])[1], {'CORS_ORIGINS': ','.join([origins[0], *origins])})
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        self.assertEqual(r.value(r.containers(specs[r.WMS])[1], 'CORS_ORIGINS'), ','.join(origins))
        second = r.warehouse_cors_origins(r.containers(specs[r.WMS])[1])
        self.assertEqual(second, ','.join(origins))

    def test_warehouse_cors_absent_or_empty_adds_only_canonical_self(self):
        for previous in (None, '', ' , '):
            baseline = copy.deepcopy(self.live)
            if previous is not None:
                r.set_env(r.containers(baseline[r.WMS])[1], {'CORS_ORIGINS': previous})
            specs, _ = r.candidate_specs(baseline, PINS, self.images)
            self.assertEqual(r.value(r.containers(specs[r.WMS])[1], 'CORS_ORIGINS'), r.ORIGINS[r.WMS])

    def test_warehouse_cors_literal_guard_never_reads_or_replaces_a_secret_reference(self):
        r.set_env(r.containers(self.live[r.WMS])[1], secrets={
            'CORS_ORIGINS': {'secretKeyRef': {'name': 'wms-dev-cors', 'key': '1'}}})
        with self.assertRaisesRegex(RuntimeError, 'literal'):
            r.candidate_specs(self.live, PINS, self.images)

    def test_warehouse_cors_preservation_rejects_deleted_extra_wildcard_or_reordered_origins(self):
        origins = [r.ORIGINS[r.WEB], 'https://existing.invalid']
        r.set_env(r.containers(self.live[r.WMS])[1], {'CORS_ORIGINS': ','.join(origins)})
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        values = [None, r.ORIGINS[r.WMS], ','.join([*origins, r.ORIGINS[r.WMS], 'https://foreign.invalid']),
                  ','.join([*origins, r.ORIGINS[r.WMS], '*']), ','.join([*reversed(origins), r.ORIGINS[r.WMS]])]
        for value in values:
            altered = copy.deepcopy(specs[r.WMS])
            c = r.containers(altered)[1]
            c['env'] = [e for e in c['env'] if e['name'] != 'CORS_ORIGINS']
            if value is not None:
                r.set_env(c, {'CORS_ORIGINS': value})
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                r.assert_candidate_preserved(self.live[r.WMS], altered, 'doa-warehouse-review')

    def test_warehouse_cors_exception_cannot_change_other_container_or_portal_origin(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        for index, key, value in ((0, 'CORS_ORIGINS', r.ORIGINS[r.WMS]),
                                  (1, 'ERP_PORTAL_ORIGIN', 'https://foreign.invalid')):
            altered = copy.deepcopy(specs[r.WMS])
            r.set_env(r.containers(altered)[index], {key: value})
            with self.assertRaises(RuntimeError):
                r.assert_candidate_preserved(self.live[r.WMS], altered, 'doa-warehouse-review')

    def test_warehouse_images_and_source_are_reused_without_changing_other_runtime_or_traffic(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        for c, key in zip(r.containers(specs[r.WMS]), ('wms-web', 'wms-api')):
            self.assertEqual(c['image'], self.images[key])
            self.assertEqual(r.value(c, 'SOURCE_VERSION'), r.WMS_SOURCE)
        before, after = self.live[r.WMS], specs[r.WMS]
        self.assertEqual(before['spec']['template']['spec']['serviceAccountName'], after['spec']['template']['spec']['serviceAccountName'])
        self.assertEqual(before['spec']['template']['metadata']['annotations'], after['spec']['template']['metadata']['annotations'])
        self.assertEqual(before['spec']['traffic'], after['spec']['traffic'][:-1])
        self.assertEqual(sum(t.get('percent', 0) for t in after['spec']['traffic']), 100)

    def test_configuration_fixes_keep_all_nine_cas_versions_guarded(self):
        r.candidate_specs(self.live, PINS, self.images)
        for name in r.ALL:
            changed = copy.deepcopy(self.live)
            changed[name]['metadata']['resourceVersion'] += '-concurrent'
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, name):
                r.assert_fresh(self.live, changed)

    def test_source_dev_values_are_exactly_two_and_public_origin_is_normal_source(self):
        self.assertEqual(r.SOURCE_DEV_VALUES, {'DOA_DEV_PROVIDER_MODE': 'stub', 'CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN': r.ORIGINS[r.SOURCE]})
        self.assertNotEqual(r.SOURCE_DEV_VALUES['CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN'], r.ORIGINS[r.MODULE])

    def test_missing_source_flags_become_exact_dev_values_in_both_candidates(self):
        original = copy.deepcopy(self.live)
        for name in (r.SOURCE, r.MODULE):
            self.assertTrue(set(r.SOURCE_DEV_VALUES).isdisjoint(r.env_map(r.containers(self.live[name])[0])))
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        for name in (r.SOURCE, r.MODULE):
            c = r.containers(specs[name])[0]
            r.need_values(c, r.SOURCE_DEV_VALUES)
            self.assertEqual(r.env_map(c)['DOA_DEV_PROVIDER_MODE'], {'name': 'DOA_DEV_PROVIDER_MODE', 'value': 'stub'})
            self.assertEqual(r.env_map(c)['CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN'], {'name': 'CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN', 'value': r.ORIGINS[r.SOURCE]})
        self.assertEqual(self.live, original)

    def test_source_flags_are_required_for_review_final_and_candidate_canonical_pairings(self):
        for stage in ('review', 'final'):
            for pairing in ('candidate', 'canonical'):
                specs, _ = r.candidate_specs(self.live, PINS, self.images, stage, pairing)
                for name in (r.SOURCE, r.MODULE):
                    with self.subTest(stage=stage, pairing=pairing, name=name):
                        r.need_values(r.containers(specs[name])[0], r.SOURCE_DEV_VALUES)

    def test_existing_correct_source_values_do_not_duplicate_or_mutate_baseline(self):
        baseline = copy.deepcopy(self.live)
        for name in (r.SOURCE, r.MODULE):
            r.set_env(r.containers(baseline[name])[0], r.SOURCE_DEV_VALUES)
        original = copy.deepcopy(baseline)
        specs, _ = r.candidate_specs(baseline, PINS, self.images)
        for name in (r.SOURCE, r.MODULE):
            for key in r.SOURCE_DEV_VALUES:
                self.assertEqual(sum(entry['name'] == key for entry in r.containers(specs[name])[0]['env']), 1)
            r.assert_candidate_preserved(original[name], specs[name], 'aftersales-review')
        self.assertEqual(baseline, original)

    def test_module_customer_origin_is_corrected_without_changing_nextauth_sso(self):
        baseline = copy.deepcopy(self.live)
        r.set_env(r.containers(baseline[r.MODULE])[0], {'CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN': r.ORIGINS[r.WEB] + '/after-sales-app'})
        before = copy.deepcopy(baseline)
        specs, _ = r.candidate_specs(baseline, PINS, self.images)
        for name in (r.SOURCE, r.MODULE):
            self.assertEqual(r.value(r.containers(specs[name])[0], 'CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN'), r.ORIGINS[r.SOURCE])
            self.assertEqual(r.value(r.containers(specs[name])[0], 'NEXTAUTH_URL'), r.value(r.containers(before[name])[0], 'NEXTAUTH_URL'))
        self.assertEqual(baseline, before)

    def test_source_public_origin_is_independent_of_api_callback_pair_and_source_version(self):
        for pairing in ('candidate', 'canonical'):
            specs, urls = r.candidate_specs(self.live, PINS, self.images, 'final', pairing)
            expected_api = urls[r.API] if pairing == 'candidate' else r.ORIGINS[r.API]
            for name in (r.SOURCE, r.MODULE):
                c = r.containers(specs[name])[0]
                self.assertEqual(r.value(c, 'ERP_INTEGRATION_API_ORIGIN'), expected_api)
                self.assertEqual(r.value(c, 'CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN'), r.ORIGINS[r.SOURCE])
                self.assertEqual(r.value(c, 'SOURCE_VERSION'), PINS['source'])

    def test_source_runtime_iam_database_refs_and_old_disabled_flags_are_preserved(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        allowed = set(r.SOURCE_DEV_VALUES) | {'SOURCE_VERSION', 'ERP_INTEGRATION_API_ORIGIN'}
        for name in (r.SOURCE, r.MODULE):
            old, new = r.containers(self.live[name])[0], r.containers(specs[name])[0]
            self.assertEqual({k: v for k, v in r.env_map(old).items() if k not in allowed}, {k: v for k, v in r.env_map(new).items() if k not in allowed})
            self.assertEqual(r.env_map(new)['DATABASE_URL'], r.env_map(old)['DATABASE_URL'])
            self.assertEqual(specs[name]['spec']['template']['spec']['serviceAccountName'], self.live[name]['spec']['template']['spec']['serviceAccountName'])
            self.assertEqual(specs[name]['spec']['template']['metadata']['annotations'], self.live[name]['spec']['template']['metadata']['annotations'])
            self.assertEqual(sum(t.get('percent', 0) for t in specs[name]['spec']['traffic']), 100)
            self.assertEqual(next(t for t in specs[name]['spec']['traffic'] if t.get('percent') == 100)['revisionName'], name + '-serving')

    def test_source_dev_values_are_not_added_or_allowed_on_api_web_or_warehouse(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        for name in (r.API, r.WEB, r.WMS):
            self.assertTrue(all(set(r.SOURCE_DEV_VALUES).isdisjoint(r.env_map(c)) for c in r.containers(specs[name])))
            for key, value in r.SOURCE_DEV_VALUES.items():
                altered = copy.deepcopy(specs[name])
                r.set_env(r.containers(altered)[0], {key: value})
                with self.subTest(name=name, key=key), self.assertRaises(RuntimeError):
                    r.assert_candidate_preserved(self.live[name], altered, 'aftersales-review')

    def test_source_preservation_rejects_wrong_missing_or_secret_ref_provider_mode(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        for name in (r.SOURCE, r.MODULE):
            for value in ('live', 'STUB', 'true', ''):
                altered = copy.deepcopy(specs[name])
                r.set_env(r.containers(altered)[0], {'DOA_DEV_PROVIDER_MODE': value})
                with self.subTest(name=name, value=value), self.assertRaises(RuntimeError):
                    r.assert_candidate_preserved(self.live[name], altered, 'aftersales-review')
            for secret_ref in (False, True):
                altered = copy.deepcopy(specs[name])
                c = r.containers(altered)[0]
                c['env'] = [e for e in c['env'] if e['name'] != 'DOA_DEV_PROVIDER_MODE']
                if secret_ref:
                    r.set_env(c, {}, {'DOA_DEV_PROVIDER_MODE': {'secretKeyRef': {'name': 'unapproved-dev-mode', 'key': '1'}}})
                with self.assertRaises(RuntimeError): r.assert_candidate_preserved(self.live[name], altered, 'aftersales-review')

    def test_source_preservation_rejects_module_erp_tagged_production_or_missing_public_origin(self):
        specs, urls = r.candidate_specs(self.live, PINS, self.images)
        for name in (r.SOURCE, r.MODULE):
            for value in (r.ORIGINS[r.MODULE], r.ORIGINS[r.WEB] + '/after-sales-app', urls[r.SOURCE], 'https://pay.corely.cc', r.ORIGINS[r.SOURCE] + '/'):
                altered = copy.deepcopy(specs[name])
                r.set_env(r.containers(altered)[0], {'CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN': value})
                with self.subTest(name=name, origin=value), self.assertRaises(RuntimeError):
                    r.assert_candidate_preserved(self.live[name], altered, 'aftersales-review')
            altered = copy.deepcopy(specs[name])
            c = r.containers(altered)[0]
            c['env'] = [e for e in c['env'] if e['name'] != 'CUSTOMER_CONFIRMATION_PUBLIC_ORIGIN']
            with self.assertRaises(RuntimeError): r.assert_candidate_preserved(self.live[name], altered, 'aftersales-review')

    def test_source_env_allowlist_does_not_enable_new_external_capabilities_or_change_auth_secrets(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        changes = [lambda s: r.set_env(r.containers(s)[0], {'LINE_CHANNEL_ACCESS_TOKEN': 'synthetic-not-a-token'}),
                   lambda s: r.set_env(r.containers(s)[0], {'AFTER_SALES_NOTIFICATION_TRANSPORT': 'CORELY_AI'}),
                   lambda s: r.set_env(r.containers(s)[0], {'NEXTAUTH_URL': r.ORIGINS[r.WEB]}),
                   lambda s: r.set_env(r.containers(s)[0], {}, {'DATABASE_URL': {'secretKeyRef': {'name': 'production-db', 'key': '1'}}}),
                   lambda s: s['spec']['template']['spec'].update(serviceAccountName='other-account')]
        for name in (r.SOURCE, r.MODULE):
            for change in changes:
                altered = copy.deepcopy(specs[name])
                change(altered)
                with self.assertRaises(RuntimeError): r.assert_candidate_preserved(self.live[name], altered, 'aftersales-review')

    def test_source_config_candidate_and_preservation_never_target_production_or_foreign_namespace(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        self.assertEqual(set(specs), set(r.DEV))
        for name in r.PROTECTED:
            self.assertNotIn(name, specs)
            with self.assertRaises(RuntimeError): r.assert_candidate_preserved(self.live[name], r.portable(self.live[name]), 'aftersales-review')
        for name in (r.SOURCE, r.MODULE):
            for field, value in (('name', r.PROTECTED[-1]), ('namespace', 'foreign-project')):
                before, after = copy.deepcopy(self.live[name]), copy.deepcopy(specs[name])
                before['metadata'][field] = after['metadata'][field] = value
                with self.assertRaises(RuntimeError): r.assert_candidate_preserved(before, after, 'aftersales-review')

    def test_preservation_assertion_rejects_extra_external_capability_or_runtime_change(self):
        specs, _ = r.candidate_specs(self.live, PINS, self.images)
        for change in (lambda s: r.set_env(r.containers(s)[0], {'SHOPIFY_SYNC_ENABLED': 'true'}),
                       lambda s: s['spec']['template']['spec'].update(serviceAccountName='production-admin'),
                       lambda s: s['spec']['traffic'][0].update(percent=50),
                       lambda s: s['spec']['template']['metadata']['annotations'].update({'run.googleapis.com/cloudsql-instances': 'different'})):
            altered = copy.deepcopy(specs[r.API])
            change(altered)
            with self.assertRaises(RuntimeError):
                r.assert_candidate_preserved(self.live[r.API], altered, 'aftersales-review')

    def test_cas_fresh_check_all_nine_services_not_just_deployed_dev_target(self):
        self.assertEqual(len(r.assert_fresh(self.live, copy.deepcopy(self.live))), 9)
        for name in r.ALL:
            changed = copy.deepcopy(self.live)
            changed[name]['metadata']['resourceVersion'] += '-racing-owner'
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, name):
                r.assert_fresh(self.live, changed)
        changed = copy.deepcopy(self.live)
        changed[r.WMS]['spec']['template']['spec']['timeoutSeconds'] += 1
        with self.assertRaises(RuntimeError):
            r.assert_fresh(self.live, changed)

    def test_build_proof_rejects_latest_failed_foreign_sha_missing_and_wrong_digest(self):
        modifiers = [lambda d: d['images'][r.API].update(image=r.REGISTRY + r.API + ':latest'),
                     lambda d: d['images'][r.API].update(image=image(r.WEB, '2')),
                     lambda d: d['builds'][BUILD_ID].update(status='QUEUED'),
                     lambda d: d['builds'][BUILD_ID].update(projectId='production-other'),
                     lambda d: d['builds'][BUILD_ID].update(region='global'),
                     lambda d: d['sourcePins'].update(erp='c' * 40),
                     lambda d: d['images'].pop('wms-api'),
                     lambda d: d['builds'][BUILD_ID]['results']['images'][0].update(digest='sha256:' + '3' * 64)]
        for change in modifiers:
            wrong = copy.deepcopy(built())
            change(wrong)
            with self.assertRaises(RuntimeError):
                r.build_images(wrong, PINS)

    def test_full_sha_and_clean_exact_sources_required(self):
        for v in ('latest', 'a' * 7, 'a' * 39, 'A' * 40, '../x'):
            with self.assertRaises(RuntimeError):
                r.full_sha(v)
        with patch.object(r, 'git', side_effect=['a' * 40, ' M other-owner-file']):
            with self.assertRaisesRegex(RuntimeError, 'completely clean'):
                r.clean_checkout(self.directory, 'a' * 40)
        with patch.object(r, 'git', return_value='c' * 40):
            with self.assertRaisesRegex(RuntimeError, 'exact frozen'):
                r.clean_checkout(self.directory, 'a' * 40)

    def test_private_outputs_reject_existing_and_symlinked_locations(self):
        out = r.private_dir(self.directory / 'private')
        r.private_json(out / 'service.json', {'opaque': 'synthetic-config'})
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((out / 'service.json').stat().st_mode), 0o600)
        with self.assertRaises(RuntimeError):
            r.private_json(out / 'service.json', {})
        linked = self.directory / 'linked'
        linked.symlink_to(out, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            r.private_dir(linked / 'new')

    def test_secret_paths_and_symlinks_are_not_read_or_uploaded_by_git_export(self):
        fake_sha = 'f' * 40
        rows = (f'100644 blob {fake_sha}\tbackend/src/a.ts\0' +
                f'100644 blob {fake_sha}\tbackend/.env.production\0' +
                f'100644 blob {fake_sha}\tbackend/service-account.json\0').encode()
        with patch.object(r, 'git', side_effect=[rows, b'synthetic source']) as local:
            manifest = r.export_git(self.directory, PINS['erp'], self.directory / 'export', 'backend')
        self.assertEqual([x['path'] for x in manifest], ['src/a.ts'])
        self.assertEqual(local.call_count, 2)
        with patch.object(r, 'git', return_value=f'120000 blob {fake_sha}\tbackend/src/link\0'.encode()):
            with self.assertRaisesRegex(RuntimeError, 'Symlinks'):
                r.export_git(self.directory, PINS['erp'], self.directory / 'other', 'backend')

    def test_erp_api_recipe_reinstalls_production_dependencies_and_regenerates_client(self):
        recipe = r.erp_api_docker(image(r.API), PINS['erp'])
        reviewed = r.REGISTRY + r.API + '@sha256:0c712c53a3fee4bb12700d320198e57285daaa0d2961bc75e07c784ea39ea354'
        self.assertEqual([line for line in recipe.splitlines() if line.startswith('FROM ')],
                         ['FROM ' + reviewed + ' AS builder', 'FROM ' + reviewed])
        self.assertNotIn(image(r.API), recipe)
        self.assertIn('npm ci --include=dev', recipe)
        self.assertIn('npm ci --omit=dev', recipe)
        self.assertEqual(recipe.count('./node_modules/.bin/prisma generate'), 2)
        self.assertIn('COPY package.json package-lock.json prisma.config.ts', recipe)
        self.assertIn('COPY scripts ./scripts', recipe)
        self.assertIn('COPY --from=builder /app/dist ./dist', recipe)
        self.assertNotIn('migrate', recipe)
        self.assertNotIn('seed', recipe)
        self.assertIn('127.0.0.1:1/unconnected', recipe)
        with self.assertRaises(RuntimeError):
            r.erp_api_docker(r.REGISTRY + r.API + ':latest', PINS['erp'])

    def test_erp_recipes_keep_fixed_reviewed_runtimes_and_build_the_latest_sources(self):
        reviewed = {
            r.API: r.REGISTRY + r.API + '@sha256:0c712c53a3fee4bb12700d320198e57285daaa0d2961bc75e07c784ea39ea354',
            r.WEB: r.REGISTRY + r.WEB + '@sha256:846c37f6b72c22a7ae0fe46302a7fce01728d32b95ccbe6ed8a80304d29c5e38',
        }
        self.assertEqual(r.ERP_RUNTIME_BUILD_BASES, reviewed)
        latest_sha = '1311dd8673d76642f3f2cc86425612cbf53e5c44'
        for service, recipe in ((r.API, r.erp_api_docker), (r.WEB, r.erp_web_docker)):
            # Different current application generations must never become the
            # next FROM, even though each is a valid immutable DEV image.
            for digest in ('8' * 64, '9' * 64):
                current = r.REGISTRY + service + '@sha256:' + digest
                dockerfile = recipe(current, latest_sha)
                with self.subTest(service=service, current=current):
                    self.assertEqual([line for line in dockerfile.splitlines() if line.startswith('FROM ')],
                                     ['FROM ' + reviewed[service] + ' AS builder', 'FROM ' + reviewed[service]])
                    self.assertNotIn(current, dockerfile)
                    self.assertIn('ENV SOURCE_VERSION=' + latest_sha + '\n', dockerfile)
                    self.assertIn('LABEL org.opencontainers.image.revision="' + latest_sha + '"\n', dockerfile)
                    self.assertIn('npm run build', dockerfile)
                    self.assertIn('COPY --from=builder /app/dist ./dist', dockerfile)
                    self.assertFalse(any(line.startswith(('CMD ', 'ENTRYPOINT ')) for line in dockerfile.splitlines()))
                    self.assertNotIn('FROM node:', dockerfile)
                    self.assertNotIn('apt-get', dockerfile)
            if service == r.API:
                self.assertIn('COPY src ./src', dockerfile)
                self.assertIn('COPY prisma ./prisma', dockerfile)
                self.assertIn('COPY scripts ./scripts', dockerfile)
                self.assertIn('COPY --from=builder /app/assets ./assets', dockerfile)
            else:
                self.assertIn('COPY . .', dockerfile)
                self.assertIn('COPY server.mjs ./server.mjs', dockerfile)

    def test_both_erp_recipes_reject_tag_production_foreign_and_malformed_current_bases(self):
        for service, recipe in ((r.API, r.erp_api_docker), (r.WEB, r.erp_web_docker)):
            invalid = [None, '', r.REGISTRY + service + ':latest',
                       r.REGISTRY + service + '@sha256:' + 'a' * 63,
                       r.REGISTRY + service + '@sha256:' + 'g' * 64,
                       r.REGISTRY + service + '@sha256:' + 'a' * 64 + ':tag',
                       r.REGISTRY + service + '-foreign@sha256:' + 'a' * 64,
                       r.REGISTRY + (r.WEB if service == r.API else r.API) + '@sha256:' + 'a' * 64,
                       r.REGISTRY + ('ecom-accounting-backend' if service == r.API else 'ecom-accounting-frontend') + '@sha256:' + 'a' * 64,
                       'asia-east1-docker.pkg.dev/foreign/cloud-run/' + service + '@sha256:' + 'a' * 64,
                       image(service) + '\nFROM foreign:latest']
            for base in invalid:
                with self.subTest(service=service, base=base), self.assertRaisesRegex(RuntimeError, 'immutable DEV runtime'):
                    recipe(base, PINS['erp'])
            for sha in ('old', 'A' * 40, PINS['erp'] + '\nRUN false'):
                with self.subTest(service=service, sha=sha), self.assertRaisesRegex(RuntimeError, 'full lowercase'):
                    recipe(image(service), sha)

    def test_wms_exact_file_hashes_missing_extra_and_symlink_refuse(self):
        folder = self.directory / 'wms'
        source = folder / 'build-source'
        source.mkdir(parents=True)
        rows = []
        for i in range(273):
            path = f'backend/src/fixture-{i:03}.js'
            destination = source / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b'synthetic')
            rows.append({'path': path, 'sha256': r.sha256(b'synthetic')})
        manifest = {'commit': r.WMS_SOURCE, 'environment': 'dev', 'digest': r.WMS_MANIFEST_HASH, 'files': rows}
        (folder / 'source-manifest.json').write_text(json.dumps(manifest))
        with wms_rows_patch(rows):
            self.assertEqual(r.wms_context(folder, r.WMS_SOURCE), manifest)
            extra = source / '.env'
            extra.write_bytes(b'do-not-read')
            with self.assertRaisesRegex(RuntimeError, 'missing/extra'):
                r.wms_context(folder, r.WMS_SOURCE)
            extra.unlink()
            (source / rows[0]['path']).write_bytes(b'changed')
            with self.assertRaisesRegex(RuntimeError, 'hash differs'):
                r.wms_context(folder, r.WMS_SOURCE)
            (source / rows[0]['path']).unlink()
            (source / rows[0]['path']).symlink_to(source / rows[1]['path'])
            with self.assertRaisesRegex(RuntimeError, 'Unsafe'):
                r.wms_context(folder, r.WMS_SOURCE)

    def prepared_context(self, reviewed_runtime=True):
        folder = r.private_dir(self.directory / 'prepared')
        context = folder / 'build-context'
        context.mkdir(mode=0o700)
        steps = []
        images = {}
        for key, repository in r.IMAGE_KEYS.items():
            owner = 'wms' if key.startswith('wms-') else 'source' if key in (r.SOURCE, r.MODULE) else 'erp'
            tag = r.REGISTRY + repository + ':doaf-' + PINS[owner]
            images[key] = tag
            steps.append({'id': key, 'name': 'gcr.io/cloud-builders/docker', 'args': ['build', '-t', tag, '.'],
                          'dir': {r.API: 'api', r.WEB: 'web'}.get(key, key), 'waitFor': ['-']})
        config = {'steps': steps, 'images': list(images.values())}
        r.private_json(context / 'cloudbuild.json', config)
        r.private_write(context / 'synthetic-source.ts', 'no credentials')
        if reviewed_runtime:
            r.private_write(context / 'api' / 'Dockerfile', r.erp_api_docker(image(r.API), PINS['erp']))
            r.private_write(context / 'web' / 'Dockerfile', r.erp_web_docker(image(r.WEB), PINS['erp']))
        files = r.file_manifest(context)
        manifest = {'version': 1, 'project': r.PROJECT, 'region': r.REGION, 'mode': 'prepare-only',
                    'sourcePins': PINS, 'buildContext': str(context), 'files': files, 'images': images,
                    'contextSha256': r.sha256(r.canonical(files))}
        if reviewed_runtime:
            manifest['reviewedRuntimeBuildBases'] = copy.deepcopy(r.ERP_RUNTIME_BUILD_BASES)
        path = folder / 'manifest.private.json'
        r.private_json(path, manifest)
        return path, r.sha256(path.read_bytes()), manifest, config

    def test_whole_source_export_never_passes_an_empty_git_pathspec(self):
        row = ('100644 blob ' + 'a' * 40 + '\tpackage.json\0').encode()
        with patch.object(r, 'git', side_effect=[row, b'{}']) as local:
            result = r.export_git(self.directory, PINS['source'], self.directory / 'whole-source')
            self.assertEqual(result[0]['path'], 'package.json')
            self.assertEqual(local.call_args_list[0].args, (self.directory, 'ls-tree', '-r', '-z', PINS['source']))

    def test_build_context_readback_requires_pinned_checksum_and_exact_files(self):
        path, checksum, manifest, _ = self.prepared_context()
        self.assertEqual(r.verify_build_context(path, checksum)[0], manifest)
        with self.assertRaisesRegex(RuntimeError, 'manifest checksum changed'):
            r.verify_build_context(path, '0' * 64)
        source = Path(manifest['buildContext']) / 'synthetic-source.ts'
        source.write_text('changed after prepare')
        with self.assertRaisesRegex(RuntimeError, 'context changed'):
            r.verify_build_context(path, checksum)

    def refresh_context_manifest(self, path, manifest):
        manifest['files'] = r.file_manifest(Path(manifest['buildContext']))
        manifest['contextSha256'] = r.sha256(r.canonical(manifest['files']))
        path.write_text(json.dumps(manifest))
        return r.sha256(path.read_bytes())

    def test_verify_context_rejects_runtime_base_marker_changes_even_with_new_checksums(self):
        path, _, manifest, _ = self.prepared_context()
        for change in (lambda m: m.pop('reviewedRuntimeBuildBases'),
                       lambda m: m['reviewedRuntimeBuildBases'].update({r.API: image(r.API)}),
                       lambda m: m['reviewedRuntimeBuildBases'].update({r.WEB: r.REGISTRY + r.WEB + ':latest'}),
                       lambda m: m['reviewedRuntimeBuildBases'].update(extra=image(r.API))):
            wrong = copy.deepcopy(manifest)
            change(wrong)
            checksum = self.refresh_context_manifest(path, wrong)
            with self.assertRaisesRegex(RuntimeError, 'runtime build bases changed or missing'):
                r.verify_build_context(path, checksum)

    def test_verify_context_rejects_each_stage_base_and_source_revision_tampering_after_rehash(self):
        path, _, manifest, _ = self.prepared_context()
        context = Path(manifest['buildContext'])
        for service, directory in ((r.API, 'api'), (r.WEB, 'web')):
            dockerfile = context / directory / 'Dockerfile'
            original = dockerfile.read_text()
            fixed = r.ERP_RUNTIME_BUILD_BASES[service]
            replacements = [image(service), r.REGISTRY + service + ':latest',
                            r.REGISTRY + 'ecom-accounting-backend@sha256:' + 'f' * 64,
                            'asia-east1-docker.pkg.dev/foreign/cloud-run/' + service + '@sha256:' + 'f' * 64]
            for old in replacements:
                for stage in ('builder', 'final'):
                    before = 'FROM ' + fixed + (' AS builder\n' if stage == 'builder' else '\n')
                    after = 'FROM ' + old + (' AS builder\n' if stage == 'builder' else '\n')
                    with self.subTest(service=service, base=old, stage=stage):
                        dockerfile.write_text(original.replace(before, after, 1))
                        checksum = self.refresh_context_manifest(path, manifest)
                        with self.assertRaisesRegex(RuntimeError, 'runtime Dockerfile differs'):
                            r.verify_build_context(path, checksum)
            for instruction in ('ENV SOURCE_VERSION=' + PINS['erp'],
                                'LABEL org.opencontainers.image.revision="' + PINS['erp'] + '"'):
                with self.subTest(service=service, instruction=instruction):
                    dockerfile.write_text(original.replace(instruction, instruction.replace(PINS['erp'], 'c' * 40)))
                    checksum = self.refresh_context_manifest(path, manifest)
                    with self.assertRaisesRegex(RuntimeError, 'runtime Dockerfile differs'):
                        r.verify_build_context(path, checksum)
            dockerfile.write_text(original)
        checksum = self.refresh_context_manifest(path, manifest)
        self.assertEqual(r.verify_build_context(path, checksum)[0], manifest)

    def test_verify_context_cannot_redirect_erp_builds_to_an_unreviewed_recipe(self):
        path, _, manifest, config = self.prepared_context()
        context = Path(manifest['buildContext'])
        for service in (r.API, r.WEB):
            for change in (lambda s: s['args'].extend(['-f', 'old.Dockerfile']),
                           lambda s: s.update(dir='source'),
                           lambda s: s.update(name='foreign/builder'),
                           lambda s: s.update(entrypoint='sh'),
                           lambda s: s.update(script='docker build -f old.Dockerfile .'),
                           lambda s: s.update(env=['DOCKER_BUILDKIT=0'])):
                wrong = copy.deepcopy(config)
                step = next(step for step in wrong['steps'] if step['id'] == service)
                change(step)
                with self.subTest(service=service, step=step):
                    (context / 'cloudbuild.json').write_text(json.dumps(wrong))
                    checksum = self.refresh_context_manifest(path, manifest)
                    with self.assertRaisesRegex(RuntimeError, 'runtime build step differs'):
                        r.verify_build_context(path, checksum)

    def test_historical_source_context_requires_an_exact_approved_tuple_and_cannot_pass_public_verify(self):
        path, checksum, manifest, _ = self.prepared_context(reviewed_runtime=False)
        with self.assertRaisesRegex(RuntimeError, 'runtime build bases changed or missing'):
            r.verify_build_context(path, checksum)
        with self.assertRaisesRegex(RuntimeError, 'tuple is not approved'):
            r.verify_existing_source_context(path, checksum, PINS['source'], r.SOURCE_EXISTING_BUILD)
        profiles = copy.deepcopy(r.SOURCE_REUSE_PROFILES)
        profiles[(PINS['source'], r.SOURCE_EXISTING_BUILD, checksum)] = {
            'sourceFileCount': 3, 'digests': r.SOURCE_EXISTING_DIGESTS}
        with patch.object(r, 'SOURCE_REUSE_PROFILES', profiles):
            self.assertEqual(r.verify_existing_source_context(path, checksum, PINS['source'], r.SOURCE_EXISTING_BUILD)[0], manifest)
            for source, build, digest in ((PINS['source'], r.SOURCE_B667_BUILD, checksum),
                                          ('c' * 40, r.SOURCE_EXISTING_BUILD, checksum),
                                          (PINS['source'], r.SOURCE_EXISTING_BUILD, '0' * 64)):
                with self.subTest(source=source, build=build, checksum=digest), self.assertRaisesRegex(RuntimeError, 'tuple is not approved'):
                    r.verify_existing_source_context(path, digest, source, build)
            changed = copy.deepcopy(manifest)
            changed['sourcePins']['source'] = 'c' * 40
            path.write_text(json.dumps(changed))
            with self.assertRaisesRegex(RuntimeError, 'manifest checksum changed'):
                r.verify_existing_source_context(path, checksum, PINS['source'], r.SOURCE_EXISTING_BUILD)

    def test_exact_success_recipe_converts_all_six_images_and_never_builds(self):
        path, checksum, manifest, config = self.prepared_context()
        raw = copy.deepcopy(built()['builds'][BUILD_ID])
        raw.pop('region')
        raw.update(id=BUILD_ID, steps=config['steps'])
        captured = self.directory / 'cloud-build.private.json'
        r.private_json(captured, {'region': r.REGION, 'description': raw})
        output = self.directory / 'images.private.json'
        receipt = r.success_build_receipt(path, checksum, [captured], output)
        self.assertEqual(r.build_images(receipt, PINS), self.images)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertEqual(receipt['preparedContextSha256'], manifest['contextSha256'])
        self.assertEqual(len(receipt['images']), 6)

    def test_success_build_does_not_accept_changed_steps_or_secret_injection(self):
        path, checksum, _, config = self.prepared_context()
        raw = copy.deepcopy(built()['builds'][BUILD_ID])
        raw.pop('region')
        raw.update(id=BUILD_ID, steps=config['steps'])
        for index, change in enumerate((lambda b: b['steps'][0]['args'].append('--unsafe-other-source'),
                                        lambda b: b['steps'][0].update(secretEnv=['REAL_TOKEN']),
                                        lambda b: b.update(availableSecrets={'secretManager': []}),
                                        lambda b: b.update(status='FAILURE'))):
            wrong = copy.deepcopy(raw)
            change(wrong)
            capture = self.directory / f'wrong-build-{index}.json'
            r.private_json(capture, {'region': r.REGION, 'description': wrong})
            with self.assertRaises(RuntimeError):
                r.success_build_receipt(path, checksum, [capture], self.directory / f'not-written-{index}.json')
            self.assertFalse((self.directory / f'not-written-{index}.json').exists())

    def existing_wms_fixture(self, source_sha=None):
        source_sha = r.WMS_SOURCE if source_sha is None else source_sha
        profile = r.approved_wms_profile(source_sha)
        api_tag, web_tag = profile['tags']['wms-api'], profile['tags']['wms-web']
        config = {'steps': [
            {'name': 'gcr.io/cloud-builders/docker', 'args': ['build', '-f', 'backend/Dockerfile', '-t', api_tag, 'backend']},
            {'name': 'gcr.io/cloud-builders/docker', 'args': ['build', '-f', 'frontend/Dockerfile.cloudrun', '--build-arg',
                'VITE_DEPLOY_ENV=dev', '--build-arg', 'VITE_SOURCE_COMMIT=' + source_sha, '-t', web_tag, 'frontend']}],
            'images': [api_tag, web_tag]}
        raw = {'id': profile['buildId'], 'status': 'SUCCESS', 'projectId': r.PROJECT,
               'name': f'projects/{r.NAMESPACE}/locations/{r.REGION}/builds/{profile["buildId"]}',
               'steps': copy.deepcopy(config['steps']), 'images': config['images'],
               'results': {'images': [{'name': tag, 'digest': profile['digests'][key]} for key, tag in profile['tags'].items()]}}
        rows = [{'path': f'backend/src/synthetic-{i}.js', 'sha256': '0' * 64} for i in range(273)]
        manifest = {'commit': source_sha, 'digest': profile['manifestDigest'], 'files': rows}
        if source_sha == r.WMS_EF_SOURCE:
            manifest['environment'] = 'dev'
        return raw, config, manifest

    def test_wms_profiles_pin_both_distinct_success_builds_without_replacing_legacy_constants(self):
        self.assertEqual(set(r.WMS_REUSE_PROFILES), {'5c056d40404cf39dfdb2c8eaf2b2d46768995cfd',
                                                   'ef264be7a62765ebb6fb18f451182d191a2abc08'})
        legacy = r.approved_wms_profile(r.WMS_SOURCE)
        self.assertEqual(legacy, {'manifestDigest': r.WMS_MANIFEST_HASH, 'fileRowsSha256': r.WMS_ROWS_HASH,
                                 'fileCount': 273, 'buildId': r.WMS_EXISTING_BUILD,
                                 'tags': r.WMS_EXISTING_TAGS, 'digests': r.WMS_EXISTING_DIGESTS})
        current = r.approved_wms_profile('ef264be7a62765ebb6fb18f451182d191a2abc08')
        self.assertEqual(current['buildId'], '21d28906-b2ab-484d-b4d2-1873407682ca')
        self.assertEqual(current['manifestDigest'], 'a4ca0bfb6ee242e79f737bc8b16ab7404998060d3cd59105fbc242cc5033d6e4')
        self.assertEqual(current['fileRowsSha256'], current['manifestDigest'])
        self.assertEqual(current['manifestFileSha256'], '4fa6c3696d3f6147042e6d34553048fbdcb147d627906a8f68cf70aa1bf58766')
        self.assertEqual(current['recipeFileSha256'], '656e4d4e059497455b2968480973715911ad887556cd098c8776e51c36502c7e')
        self.assertEqual(current['digests'], {
            'wms-api': 'sha256:8624864c1596bbfa22ade4e7d1da83becc9f6ded04cbfa259431a029e557358d',
            'wms-web': 'sha256:af9447e42857c6da3dc8d3ed3ec6b1d0a356dc74fc5bd0b922ae8257265cc8f4'})
        for unknown in ('f' * 40, '', None, {}):
            with self.subTest(unknown=unknown), self.assertRaisesRegex(RuntimeError, 'profile is not approved'):
                r.approved_wms_profile(unknown)

    def test_ef_wms_exact_source_recipe_build_and_digest_pair_are_selected(self):
        raw, config, manifest = self.existing_wms_fixture(r.WMS_EF_SOURCE)
        self.assertEqual(r.sha256(r.canonical(config)), 'c11676bd972497e4ee5653e1c858289775e7ee3e07fc6db5d1644410d462230a')
        with wms_proof_patch(manifest):
            proof = r.existing_wms_proof(raw, config, manifest, r.WMS_EF_SOURCE)
        self.assertEqual(proof['sourceSha'], r.WMS_EF_SOURCE)
        self.assertEqual(proof['buildId'], '21d28906-b2ab-484d-b4d2-1873407682ca')
        self.assertEqual(proof['images']['wms-api']['image'], r.REGISTRY + 'corely-wms-backend@sha256:8624864c1596bbfa22ade4e7d1da83becc9f6ded04cbfa259431a029e557358d')
        self.assertEqual(proof['images']['wms-web']['image'], r.REGISTRY + 'corely-wms-frontend@sha256:af9447e42857c6da3dc8d3ed3ec6b1d0a356dc74fc5bd0b922ae8257265cc8f4')

    def test_ef_wms_cannot_borrow_legacy_sdk_build_digests_recipe_or_rows(self):
        raw, config, manifest = self.existing_wms_fixture(r.WMS_EF_SOURCE)
        with wms_proof_patch(manifest):
            for change in (lambda d: d.update(id=r.WMS_EXISTING_BUILD),
                           lambda d: d.update(status='FAILURE'),
                           lambda d: d.update(name=d['name'].replace(r.REGION, 'global')),
                           lambda d: d['results']['images'][0].update(digest=r.WMS_EXISTING_DIGESTS['wms-api']),
                           lambda d: d['results']['images'].pop()):
                wrong = copy.deepcopy(raw); change(wrong)
                with self.subTest(raw=wrong), self.assertRaises(RuntimeError):
                    r.existing_wms_proof(wrong, config, manifest, r.WMS_EF_SOURCE)
            for change in (lambda c: c['steps'][1]['args'].__setitem__(6, 'VITE_SOURCE_COMMIT=' + r.WMS_SOURCE),
                           lambda c: c['steps'][0]['args'].append('--unreviewed'),
                           lambda c: c['images'].append(r.WMS_EXISTING_TAGS['wms-api'])):
                wrong_config = copy.deepcopy(config); change(wrong_config)
                wrong_raw = copy.deepcopy(raw); wrong_raw['steps'] = copy.deepcopy(wrong_config['steps'])
                wrong_raw['images'] = wrong_config['images']
                with self.subTest(config=wrong_config), self.assertRaisesRegex(RuntimeError, 'supplier recipe differs'):
                    r.existing_wms_proof(wrong_raw, wrong_config, manifest, r.WMS_EF_SOURCE)
            for change in (lambda m: m.update(commit=r.WMS_SOURCE),
                           lambda m: m.update(digest=r.WMS_MANIFEST_HASH),
                           lambda m: m['files'].reverse(), lambda m: m['files'].pop(),
                           lambda m: m['files'].append(copy.deepcopy(m['files'][0])),
                           lambda m: m['files'][0].update(sha256='1' * 64)):
                wrong = copy.deepcopy(manifest); change(wrong)
                with self.subTest(manifest=wrong), self.assertRaises(RuntimeError):
                    r.existing_wms_proof(raw, config, wrong, r.WMS_EF_SOURCE)
            with self.assertRaises(RuntimeError):
                r.existing_wms_proof(raw, config, manifest, r.WMS_SOURCE)

    def test_ef_wms_context_requires_all_273_bytes_and_exact_manifest_and_recipe_files(self):
        _, config, manifest = self.existing_wms_fixture(r.WMS_EF_SOURCE)
        folder = self.directory / 'ef-wms'
        source = folder / 'build-source'
        for i, row in enumerate(manifest['files']):
            content = ('synthetic-' + str(i)).encode()
            row['sha256'] = r.sha256(content)
            r.private_write(source / row['path'], content)
        r.private_json(folder / 'source-manifest.json', manifest)
        r.private_json(folder / 'cloudbuild.json', config)
        recipe_path, manifest_path = folder / 'cloudbuild.json', folder / 'source-manifest.json'
        self.assertEqual(r.sha256(recipe_path.read_bytes()), r.approved_wms_profile(r.WMS_EF_SOURCE)['recipeFileSha256'])
        original = manifest_path.read_bytes()
        with wms_proof_patch(manifest), patch.dict(r.WMS_REUSE_PROFILES[r.WMS_EF_SOURCE], {'manifestFileSha256': r.sha256(original)}):
            self.assertEqual(r.wms_context(folder, r.WMS_EF_SOURCE), manifest)
            extra = source / 'unlisted.js'; extra.write_text('extra')
            with self.assertRaisesRegex(RuntimeError, 'missing/extra'):
                r.wms_context(folder, r.WMS_EF_SOURCE)
            extra.unlink()
            first = source / manifest['files'][0]['path']; content = first.read_bytes(); first.unlink()
            with self.assertRaisesRegex(RuntimeError, 'missing/extra'):
                r.wms_context(folder, r.WMS_EF_SOURCE)
            first.write_bytes(b'changed')
            with self.assertRaisesRegex(RuntimeError, 'file hash differs'):
                r.wms_context(folder, r.WMS_EF_SOURCE)
            first.write_bytes(content)
            manifest_path.write_bytes(original + b' ')
            with self.assertRaisesRegex(RuntimeError, 'manifest file checksum differs'):
                r.wms_context(folder, r.WMS_EF_SOURCE)
            manifest_path.write_bytes(original)
            recipe_path.write_text(json.dumps(config))
            with self.assertRaisesRegex(RuntimeError, 'recipe checksum differs'):
                r.wms_context(folder, r.WMS_EF_SOURCE)

    def test_reuses_exact_existing_two_container_wms_build_and_combines_four_new_images(self):
        raw, supplier, wms_manifest = self.existing_wms_fixture()
        with wms_rows_patch(wms_manifest['files']):
            proof = r.existing_wms_proof(raw, supplier, wms_manifest)
            self.assertEqual(set(proof['images']), {'wms-api', 'wms-web'})
            path, _, manifest, config = self.prepared_context()
            context = Path(manifest['buildContext'])
            config['steps'] = [s for s in config['steps'] if not s['id'].startswith('wms-')]
            config['images'] = [v for k, v in manifest['images'].items() if not k.startswith('wms-')]
            (context / 'cloudbuild.json').write_text(json.dumps(config))
            manifest['images'].update(r.WMS_EXISTING_TAGS)
            manifest.update(existingWms=proof, wmsManifest=wms_manifest, builtImageKeys=[s['id'] for s in config['steps']])
            manifest['files'] = r.file_manifest(context)
            manifest['contextSha256'] = r.sha256(r.canonical(manifest['files']))
            path.write_text(json.dumps(manifest))
            checksum = r.sha256(path.read_bytes())
            new_build = copy.deepcopy(built()['builds'][BUILD_ID])
            new_build.pop('region')
            new_build.update(id=BUILD_ID, steps=config['steps'], images=config['images'])
            new_build['results']['images'] = [row for row in new_build['results']['images'] if row['name'] in config['images']]
            captured = self.directory / 'four-new-builds.json'
            r.private_json(captured, {'region': r.REGION, 'description': new_build})
            receipt = r.success_build_receipt(path, checksum, [captured], self.directory / 'combined.json')
            self.assertEqual(len(receipt['images']), 6)
            self.assertEqual(len(receipt['builds']), 2)
            self.assertEqual(receipt['images']['wms-api']['buildId'], r.WMS_EXISTING_BUILD)
            self.assertEqual(r.build_images(receipt, PINS)['wms-web'], r.REGISTRY + 'corely-wms-frontend@' + r.WMS_EXISTING_DIGESTS['wms-web'])
            self.assertNotIn('wms-api', {s['id'] for s in config['steps']})
            self.assertNotIn('wms-web', {s['id'] for s in config['steps']})

    def test_existing_wms_region_step_source_digest_and_missing_receipt_fail_closed(self):
        raw, config, manifest = self.existing_wms_fixture()
        modifiers = [lambda d: d.update(id=BUILD_ID),
                     lambda d: d.update(name=d['name'].replace('asia-east1', 'global')),
                     lambda d: d.update(status='QUEUED'),
                     lambda d: d['steps'][1]['args'].remove('VITE_SOURCE_COMMIT=' + r.WMS_SOURCE),
                     lambda d: d['results']['images'][0].update(digest='sha256:' + 'f' * 64),
                     lambda d: d['steps'][0].update(secretEnv=['DO_NOT_READ']),
                     lambda d: d['results']['images'].pop()]
        with wms_rows_patch(manifest['files']):
            for change in modifiers:
                wrong = copy.deepcopy(raw)
                change(wrong)
                with self.assertRaises(RuntimeError):
                    r.existing_wms_proof(wrong, config, manifest)

    def existing_source_fixture(self):
        # These sibling paths exercise Git/string versus component-based Path
        # sorting without relying on a real checkout or reading private files.
        content = {'Dockerfile': b'FROM synthetic\nARG SOURCE_VERSION\nARG ERP_MODULE_BUILD\n',
                   'lib/a.ts': b'export const synthetic = true;\n', 'lib/a/a.ts': b'export {};\n'}
        source_files = [{'path': name, 'sha256': r.sha256(value)} for name, value in content.items()]
        steps, tags = [], {}
        for key in (r.API, r.WEB, r.SOURCE, r.MODULE):
            sha = r.SOURCE_EXISTING_SHA if key in (r.SOURCE, r.MODULE) else 'f' * 40
            tag = r.REGISTRY + r.IMAGE_KEYS[key] + ':doaf-' + sha
            tags[key] = tag
            args = ['build', '-t', tag]
            if key in (r.SOURCE, r.MODULE):
                args += ['--build-arg', 'SOURCE_VERSION=' + sha, '--build-arg',
                         'ERP_MODULE_BUILD=' + ('true' if key == r.MODULE else 'false')]
            steps.append({'id': key, 'name': 'gcr.io/cloud-builders/docker', 'args': args + ['.'],
                          'dir': 'source' if key in (r.SOURCE, r.MODULE) else key,
                          'waitFor': [steps[-1]['id']] if steps else ['-']})
        config = {'steps': steps, 'images': list(tags.values())}
        raw = {'id': r.SOURCE_EXISTING_BUILD, 'status': 'SUCCESS', 'projectId': r.PROJECT,
               'name': f'projects/{r.NAMESPACE}/locations/{r.REGION}/builds/{r.SOURCE_EXISTING_BUILD}',
               'steps': [{**step, 'status': 'SUCCESS'} for step in steps], 'images': config['images'],
               'results': {'images': [{'name': tag, 'digest': r.SOURCE_EXISTING_DIGESTS.get(key, 'sha256:' + 'f' * 64)}
                                      for key, tag in tags.items()]}}
        old = {'sourcePins': {'erp': 'f' * 40, 'source': r.SOURCE_EXISTING_SHA},
               'exportedSourceFiles': {'source': source_files},
               'files': [{'path': 'source/' + row['path'], 'sha256': row['sha256']} for row in reversed(source_files)]}
        return raw, old, config, source_files, content

    def test_source_reuse_requires_all_three_explicit_options(self):
        self.assertFalse(r.source_reuse_options(None, None, None))
        self.assertTrue(r.source_reuse_options('raw.json', 'manifest.json', 'f' * 64))
        for mask in range(1, 7):
            supplied = ['synthetic' if mask & (1 << n) else None for n in range(3)]
            with self.subTest(mask=mask), self.assertRaisesRegex(RuntimeError, 'together'):
                r.source_reuse_options(*supplied)

    def test_source_reuse_full_context_matches_current_git_despite_path_ordering(self):
        raw, old, config, files, _ = self.existing_source_fixture()
        proof = r.existing_source_proof(raw, old, config, r.SOURCE_EXISTING_MANIFEST, r.SOURCE_EXISTING_SHA, files)
        self.assertEqual(set(proof['images']), {r.SOURCE, r.MODULE})
        self.assertFalse(proof['previousErpImagesReused'])
        self.assertNotIn(r.API, proof['images'])
        self.assertEqual(proof['sourceFiles'], files)
        self.assertEqual(proof['sourceSteps'][r.MODULE]['dir'], 'source')

    def test_source_reuse_rejects_sha_and_manifest_hash_drift(self):
        raw, old, config, files, _ = self.existing_source_fixture()
        for checksum, source_sha in (('0' * 64, r.SOURCE_EXISTING_SHA), (r.SOURCE_EXISTING_MANIFEST, 'b' * 40)):
            with self.assertRaisesRegex(RuntimeError, 'tuple is not approved'):
                r.existing_source_proof(raw, old, config, checksum, source_sha, files)
        changed = copy.deepcopy(old)
        changed['sourcePins']['source'] = 'b' * 40
        with self.assertRaises(RuntimeError):
            r.existing_source_proof(raw, changed, config, r.SOURCE_EXISTING_MANIFEST, r.SOURCE_EXISTING_SHA, files)

    def test_source_reuse_rejects_modified_git_blobs_missing_extra_and_duplicate_context(self):
        raw, old, config, files, _ = self.existing_source_fixture()
        wrong_git = copy.deepcopy(files)
        wrong_git[0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'Git blobs'):
            r.existing_source_proof(raw, old, config, r.SOURCE_EXISTING_MANIFEST, r.SOURCE_EXISTING_SHA, wrong_git)
        modifications = [lambda m: m['files'][0].update(sha256='0' * 64),
                         lambda m: m['files'].pop(),
                         lambda m: m['files'].append({'path': 'source/extra.ts', 'sha256': '0' * 64}),
                         lambda m: m['files'].append(copy.deepcopy(m['files'][0]))]
        for change in modifications:
            wrong = copy.deepcopy(old)
            change(wrong)
            with self.assertRaisesRegex(RuntimeError, 'context differs'):
                r.existing_source_proof(raw, wrong, config, r.SOURCE_EXISTING_MANIFEST, r.SOURCE_EXISTING_SHA, files)

    def test_source_reuse_failed_foreign_or_nonregional_build_and_secret_steps_refused(self):
        raw, old, config, files, _ = self.existing_source_fixture()
        changes = [lambda d: d.update(status='FAILURE'), lambda d: d.update(id=BUILD_ID),
                   lambda d: d.update(projectId='foreign-project'),
                   lambda d: d.update(name=d['name'].replace('asia-east1', 'global')),
                   lambda d: d.update(availableSecrets={'secretManager': ['do-not-read']}),
                   lambda d: d['steps'][2].update(secretEnv=['PRIVATE_TOKEN']),
                   lambda d: d['steps'][3].update(status='QUEUED')]
        for change in changes:
            wrong = copy.deepcopy(raw)
            change(wrong)
            with self.assertRaises(RuntimeError):
                r.existing_source_proof(wrong, old, config, r.SOURCE_EXISTING_MANIFEST, r.SOURCE_EXISTING_SHA, files)

    def test_source_reuse_exact_normal_module_args_and_both_digests_required(self):
        raw, old, config, files, _ = self.existing_source_fixture()
        changes = [lambda d: d['steps'].pop(), lambda d: d['steps'].append(copy.deepcopy(d['steps'][2])),
                   lambda d: d['steps'][0]['args'].append('--modified-old-erp-recipe'),
                   lambda d: d['steps'][2].update(dir='other-source'),
                   lambda d: d['steps'][3]['args'].append('--different-build'),
                   lambda d: d['results']['images'].pop(),
                   lambda d: d['results']['images'][2].update(digest='sha256:' + '0' * 64),
                   lambda d: d['images'].remove(config['images'][3])]
        for change in changes:
            wrong = copy.deepcopy(raw)
            change(wrong)
            with self.assertRaises(RuntimeError):
                r.existing_source_proof(wrong, old, config, r.SOURCE_EXISTING_MANIFEST, r.SOURCE_EXISTING_SHA, files)

    def prepare_build_fixture(self, reuse=False, source_sha=None, e050=False, wms_fixture=None):
        source_raw, old, old_config, files, content = self.existing_source_fixture()
        manifest_sha = r.SOURCE_EXISTING_MANIFEST
        if e050:
            source_raw, old, old_config, files = self.e050_source_fixture()
            # Keep every exported synthetic blob equal to the retained context.
            content.update({row['path']: f"synthetic-{i}".encode() for i, row in enumerate(files[3:])})
            manifest_sha = r.SOURCE_E050_MANIFEST
        wms_raw, wms_config, wms_manifest = wms_fixture or self.existing_wms_fixture()
        source_capture = self.directory / 'existing-source.json'
        wms_capture = self.directory / 'existing-wms.json'
        wms_root = self.directory / 'wms'
        wms_root.mkdir()
        r.private_json(source_capture, source_raw)
        r.private_json(wms_capture, wms_raw)
        r.private_json(wms_root / 'cloudbuild.json', wms_config)
        pins = {**PINS, 'source': source_sha or (r.SOURCE_E050_SHA if e050 else r.SOURCE_EXISTING_SHA),
                'wms': wms_manifest['commit']}

        def export(_root, _sha, destination, prefix=''):
            Path(destination).mkdir(parents=True, mode=0o700)
            data = content if not prefix else {'package.json': b'{}'}
            for name, value in data.items():
                r.private_write(Path(destination) / name, value)
            return [{'path': name, 'sha256': r.sha256(value)} for name, value in data.items()]

        dependencies = {'api': {'storageDeclared': r.STORAGE_VERSION, 'storageResolved': r.STORAGE_VERSION}}
        patches = [patch.object(r, 'clean_checkout'), patch.object(r, 'wms_context', return_value=wms_manifest),
                   wms_proof_patch(wms_manifest),
                   patch.object(r, 'package_fingerprints', return_value=dependencies),
                   patch.object(r, 'migration_hashes', return_value={}), patch.object(r, 'export_git', side_effect=export),
                   patch.object(r, 'git_files', return_value=files), patch.object(r, 'verify_existing_source_context', return_value=(old, old_config))]
        for mocked in patches:
            mocked.start()
        try:
            options = (source_capture, self.directory / 'frozen-manifest.json', manifest_sha) if reuse else ()
            manifest = r.build_prepare(self.live, pins, self.directory, self.directory, wms_root,
                                       self.directory / 'prepared', wms_capture, *options)
        finally:
            for mocked in reversed(patches):
                mocked.stop()
        return manifest, pins, wms_manifest

    def test_default_prepare_still_builds_four_new_images(self):
        manifest, _, wms_manifest = self.prepare_build_fixture()
        config = r.read_json(Path(manifest['buildContext']) / 'cloudbuild.json')
        self.assertEqual(manifest['builtImageKeys'], [r.API, r.WEB, r.SOURCE, r.MODULE])
        self.assertEqual([step['id'] for step in config['steps']], manifest['builtImageKeys'])
        self.assertEqual(len(config['images']), 4)
        self.assertEqual(manifest['reviewedRuntimeBuildBases'], r.ERP_RUNTIME_BUILD_BASES)
        self.assertNotIn('existingSource', manifest)
        with wms_rows_patch(wms_manifest['files']):
            path = Path(manifest['buildContext']).parent / 'build-manifest.private.json'
            self.assertEqual(r.verify_build_context(path, r.sha256(path.read_bytes()))[0], manifest)

    def test_ef_prepare_verify_receipt_and_candidate_use_only_the_selected_wms_profile(self):
        wms_fixture = self.existing_wms_fixture(r.WMS_EF_SOURCE)
        with wms_proof_patch(wms_fixture[2]):
            manifest, pins, _ = self.prepare_build_fixture(source_sha='d' * 40, wms_fixture=wms_fixture)
            context = Path(manifest['buildContext'])
            path = context.parent / 'build-manifest.private.json'
            config = r.read_json(context / 'cloudbuild.json')
            self.assertEqual(manifest['builtImageKeys'], [r.API, r.WEB, r.SOURCE, r.MODULE])
            self.assertNotIn('existingSource', manifest)
            self.assertEqual(manifest['images']['wms-web'], r.REGISTRY + 'corely-wms-frontend:dev-a4ca0bfb6ee2')
            self.assertEqual(r.verify_build_context(path, r.sha256(path.read_bytes()))[0], manifest)
            raw = {'id': BUILD_ID, 'status': 'SUCCESS', 'projectId': r.PROJECT,
                   'steps': [{**step, 'status': 'SUCCESS'} for step in config['steps']], 'images': config['images'],
                   'results': {'images': [{'name': tag, 'digest': 'sha256:' + '2' * 64} for tag in config['images']]}}
            capture = self.directory / 'ef-four-new.json'
            r.private_json(capture, {'region': r.REGION, 'description': raw})
            receipt = r.success_build_receipt(path, r.sha256(path.read_bytes()), [capture], self.directory / 'ef-six.json')
            images = r.build_images(receipt, pins)
            specs, _ = r.candidate_specs(self.live, pins, images)
            self.assertEqual(len(images), 6)
            self.assertEqual(set(receipt['builds']), {BUILD_ID, '21d28906-b2ab-484d-b4d2-1873407682ca'})
            self.assertEqual(specs[r.WMS]['spec']['template']['metadata']['labels']['corely-wms-source'], r.WMS_EF_SOURCE)
            for c in r.containers(specs[r.WMS]):
                self.assertEqual(r.value(c, 'SOURCE_VERSION'), r.WMS_EF_SOURCE)
            traffic = specs[r.WMS]['spec']['traffic']
            self.assertEqual([row for row in traffic if row.get('tag') != 'doa-warehouse-review'],
                             self.live[r.WMS]['spec']['traffic'])
            self.assertEqual([row.get('percent') for row in traffic if row.get('tag') == 'doa-warehouse-review'], [0])
            profile = r.approved_wms_profile(r.WMS_EF_SOURCE)
            for change in (lambda d: d['existingWms'].update(buildId=r.WMS_EXISTING_BUILD),
                           lambda d: d['existingWms'].update(sourceSha=r.WMS_SOURCE),
                           lambda d: d['existingWms'].update(manifestDigest=r.WMS_MANIFEST_HASH),
                           lambda d: d['existingWms'].update(fileRowsSha256=r.WMS_ROWS_HASH),
                           lambda d: d['existingWms'].update(recipeFileSha256='0' * 64),
                           lambda d: d['images']['wms-api'].update(image=r.REGISTRY + 'corely-wms-backend@' + r.WMS_EXISTING_DIGESTS['wms-api']),
                           lambda d: d['builds'][profile['buildId']]['steps'][1]['args'].__setitem__(6, 'VITE_SOURCE_COMMIT=' + r.WMS_SOURCE)):
                wrong = copy.deepcopy(receipt); change(wrong)
                with self.subTest(receipt=wrong), self.assertRaises(RuntimeError):
                    r.build_images(wrong, pins)
            wrong = copy.deepcopy(receipt); wrong.pop('existingWms')
            with self.assertRaisesRegex(RuntimeError, 'reuse proof is required'):
                r.build_images(wrong, pins)
            foreign = dict(images); foreign['wms-web'] = image('wms-web', '2')
            with self.assertRaisesRegex(RuntimeError, 'Candidate WMS digests differ'):
                r.candidate_specs(self.live, pins, foreign)
            wrong = copy.deepcopy(manifest); wrong.pop('existingWms')
            path.write_text(json.dumps(wrong))
            with self.assertRaisesRegex(RuntimeError, 'reuse proof is required'):
                r.verify_build_context(path, r.sha256(path.read_bytes()))
            wrong = copy.deepcopy(manifest); wrong['sourcePins']['wms'] = r.WMS_SOURCE
            path.write_text(json.dumps(wrong))
            with self.assertRaises(RuntimeError):
                r.verify_build_context(path, r.sha256(path.read_bytes()))
            with self.assertRaisesRegex(RuntimeError, 'profile is not approved'):
                r.candidate_specs(self.live, {**pins, 'wms': 'f' * 40}, images)

    def test_ef_current_wms_can_reuse_exact_e050_source_without_reusing_its_old_erp_or_wms(self):
        wms_fixture = self.existing_wms_fixture(r.WMS_EF_SOURCE)
        with wms_proof_patch(wms_fixture[2]):
            manifest, pins, _ = self.prepare_build_fixture(reuse=True, e050=True, wms_fixture=wms_fixture)
            context = Path(manifest['buildContext'])
            path = context.parent / 'build-manifest.private.json'
            self.assertEqual(pins['wms'], r.WMS_EF_SOURCE)
            self.assertEqual(manifest['builtImageKeys'], [r.API, r.WEB])
            self.assertEqual(manifest['existingSource']['sourceSha'], r.SOURCE_E050_SHA)
            self.assertEqual(manifest['existingSource']['originalContextSha256'], r.SOURCE_E050_CONTEXT)
            self.assertFalse(manifest['existingSource']['previousErpImagesReused'])
            self.assertEqual(manifest['existingWms']['buildId'], '21d28906-b2ab-484d-b4d2-1873407682ca')
            self.assertEqual(r.verify_build_context(path, r.sha256(path.read_bytes()))[0], manifest)

    def test_later_source_sha_uses_four_fresh_builds_without_a_reuse_profile(self):
        later_sha = 'e' * 40
        manifest, pins, _ = self.prepare_build_fixture(source_sha=later_sha)
        config = r.read_json(Path(manifest['buildContext']) / 'cloudbuild.json')
        self.assertEqual(pins['source'], later_sha)
        self.assertEqual(manifest['builtImageKeys'], [r.API, r.WEB, r.SOURCE, r.MODULE])
        self.assertNotIn('existingSource', manifest)
        for step in config['steps'][2:]:
            self.assertIn('SOURCE_VERSION=' + later_sha, step['args'])
            self.assertIn(r.REGISTRY + r.IMAGE_KEYS[step['id']] + ':doaf-' + later_sha, step['args'])
        with self.assertRaisesRegex(RuntimeError, 'tuple is not approved'):
            r.approved_source_profile(later_sha, r.SOURCE_B667_BUILD, r.SOURCE_B667_MANIFEST)

    def source_reuse_prepared_fixture(self):
        manifest, pins, wms_manifest = self.prepare_build_fixture(reuse=True)
        config = r.read_json(Path(manifest['buildContext']) / 'cloudbuild.json')
        raw = {'id': BUILD_ID, 'status': 'SUCCESS', 'projectId': r.PROJECT,
               'steps': [{**step, 'status': 'SUCCESS'} for step in config['steps']], 'images': config['images'],
               'results': {'images': [{'name': name, 'digest': 'sha256:' + '2' * 64} for name in config['images']]}}
        capture = self.directory / 'two-new-erp.json'
        r.private_json(capture, {'region': r.REGION, 'description': raw})
        path = Path(manifest['buildContext']).parent / 'build-manifest.private.json'
        return manifest, pins, wms_manifest, config, capture, path

    def test_source_reuse_only_two_new_erp_steps_produce_complete_six_digest_matrix(self):
        manifest, pins, wms_manifest, config, capture, path = self.source_reuse_prepared_fixture()
        self.assertEqual(manifest['builtImageKeys'], [r.API, r.WEB])
        self.assertEqual([step['id'] for step in config['steps']], [r.API, r.WEB])
        self.assertEqual(config['steps'][1]['waitFor'], [r.API])
        self.assertEqual(len(config['images']), 2)
        self.assertFalse(manifest['existingSource']['previousErpImagesReused'])
        with wms_rows_patch(wms_manifest['files']):
            receipt = r.success_build_receipt(path, r.sha256(path.read_bytes()), [capture], self.directory / 'combined-six.json')
        self.assertEqual(len(receipt['images']), 6)
        self.assertEqual(set(receipt['builds']), {BUILD_ID, r.SOURCE_EXISTING_BUILD, r.WMS_EXISTING_BUILD})
        self.assertEqual(receipt['images'][r.API]['buildId'], BUILD_ID)
        self.assertEqual(receipt['images'][r.SOURCE]['buildId'], r.SOURCE_EXISTING_BUILD)
        self.assertEqual(receipt['images'][r.MODULE]['image'].split('@')[-1], r.SOURCE_EXISTING_DIGESTS[r.MODULE])
        with wms_rows_patch(wms_manifest['files']):
            self.assertEqual(r.build_images(receipt, pins)[r.WEB], image(r.WEB, '2'))

    def test_reused_source_manifest_retained_recipe_or_build_keys_tamper_refused(self):
        manifest, _, wms_manifest, _, _, path = self.source_reuse_prepared_fixture()
        for change in (lambda d: d['existingSource'].update(previousErpImagesReused=True),
                       lambda d: d['existingSource']['sourceSteps'][r.MODULE]['args'].append('--modified'),
                       lambda d: d['builtImageKeys'].append(r.SOURCE),
                       lambda d: d['existingSource'].update(manifestSha256='0' * 64)):
            wrong = copy.deepcopy(manifest)
            change(wrong)
            path.write_text(json.dumps(wrong))
            with wms_rows_patch(wms_manifest['files']), self.assertRaises(RuntimeError):
                r.verify_build_context(path, r.sha256(path.read_bytes()))

    def test_reused_source_cannot_be_added_to_new_build_steps(self):
        manifest, _, wms_manifest, config, _, path = self.source_reuse_prepared_fixture()
        context = Path(manifest['buildContext'])
        config['steps'].append(manifest['existingSource']['sourceSteps'][r.SOURCE])
        (context / 'cloudbuild.json').write_text(json.dumps(config))
        manifest['files'] = r.file_manifest(context)
        manifest['contextSha256'] = r.sha256(r.canonical(manifest['files']))
        path.write_text(json.dumps(manifest))
        with wms_rows_patch(wms_manifest['files']), self.assertRaisesRegex(RuntimeError, 'new build steps'):
            r.verify_build_context(path, r.sha256(path.read_bytes()))

    def test_reuse_stale_erp_digest_or_missing_source_pair_never_becomes_candidate(self):
        _, pins, wms_manifest, _, capture, path = self.source_reuse_prepared_fixture()
        with wms_rows_patch(wms_manifest['files']):
            receipt = r.success_build_receipt(path, r.sha256(path.read_bytes()), [capture], self.directory / 'valid-six.json')
        stale = copy.deepcopy(receipt)
        stale['images'][r.API] = {'image': image(r.API, 'f'), 'buildId': r.SOURCE_EXISTING_BUILD}
        with wms_rows_patch(wms_manifest['files']), self.assertRaisesRegex(RuntimeError, 'Previous ERP'):
            r.build_images(stale, pins)
        for change in (lambda d: d['images'].pop(r.MODULE),
                       lambda d: d['sourcePins'].update(source='b' * 40),
                       lambda d: d['images'][r.MODULE].update(image=image(r.MODULE, '2')),
                       lambda d: d['builds'][r.SOURCE_EXISTING_BUILD].update(status='FAILURE')):
            wrong = copy.deepcopy(receipt)
            change(wrong)
            with wms_rows_patch(wms_manifest['files']), self.assertRaises(RuntimeError):
                r.build_images(wrong, pins)

    def test_source_git_blob_reader_filters_secrets_before_reading_and_rejects_symlink(self):
        row = ('100644 blob ' + 'a' * 40 + '\tDockerfile\0' +
               '100644 blob ' + 'b' * 40 + '\t.env.production\0').encode()
        with patch.object(r, 'git', side_effect=[row, b'FROM synthetic']) as local:
            self.assertEqual(r.git_files(self.directory, r.SOURCE_EXISTING_SHA),
                             [{'path': 'Dockerfile', 'sha256': r.sha256(b'FROM synthetic')}])
            self.assertEqual(local.call_count, 2)
        with patch.object(r, 'git', return_value=('120000 blob ' + 'a' * 40 + '\tDockerfile\0').encode()):
            with self.assertRaisesRegex(RuntimeError, 'Unsafe Source Git blob'):
                r.git_files(self.directory, r.SOURCE_EXISTING_SHA)

    def b667_source_fixture(self):
        raw, old, config, files, _ = self.existing_source_fixture()
        digests = {r.SOURCE: 'sha256:' + 'c' * 64, r.MODULE: 'sha256:' + 'd' * 64}
        for i in range(501 - len(files)):
            files.append({'path': f'fixture/source-{i:03}.ts', 'sha256': r.sha256(f'synthetic-{i}'.encode())})
        old['sourcePins'] = {'erp': '0105950f6ad1f7aa08fc86bcd2851ee4541bdf25', 'source': r.SOURCE_B667_SHA}
        old['files'] = [{'path': 'source/' + row['path'], 'sha256': row['sha256']} for row in reversed(files)]
        raw['id'] = r.SOURCE_B667_BUILD
        raw['name'] = f'projects/{r.NAMESPACE}/locations/{r.REGION}/builds/{r.SOURCE_B667_BUILD}'
        for step in config['steps']:
            if step['id'] in (r.SOURCE, r.MODULE):
                step['args'] = [arg.replace(r.SOURCE_EXISTING_SHA, r.SOURCE_B667_SHA) for arg in step['args']]
            else:
                step['args'] = [arg.replace('f' * 40, old['sourcePins']['erp']) for arg in step['args']]
        config['images'] = [r.REGISTRY + r.IMAGE_KEYS[step['id']] + ':doaf-' +
                            (r.SOURCE_B667_SHA if step['id'] in (r.SOURCE, r.MODULE) else old['sourcePins']['erp']) for step in config['steps']]
        raw['images'] = config['images']
        raw['steps'] = [{**copy.deepcopy(step), 'status': 'SUCCESS'} for step in config['steps']]
        raw['results']['images'] = [{'name': name, 'digest': digests.get(step['id'], 'sha256:' + 'f' * 64)}
                                    for name, step in zip(config['images'], config['steps'])]
        profiles = copy.deepcopy(r.SOURCE_REUSE_PROFILES)
        profiles[(r.SOURCE_B667_SHA, r.SOURCE_B667_BUILD, r.SOURCE_B667_MANIFEST)]['digests'] = digests
        return raw, old, config, files, profiles

    def test_only_three_reviewed_source_tuples_allow_reuse_and_cross_mixing_is_rejected(self):
        profiles = r.SOURCE_REUSE_PROFILES
        self.assertEqual(set(profiles), {(r.SOURCE_EXISTING_SHA, r.SOURCE_EXISTING_BUILD, r.SOURCE_EXISTING_MANIFEST),
                                       (r.SOURCE_B667_SHA, r.SOURCE_B667_BUILD, r.SOURCE_B667_MANIFEST),
                                       (r.SOURCE_E050_SHA, r.SOURCE_E050_BUILD, r.SOURCE_E050_MANIFEST)})
        self.assertEqual(profiles[(r.SOURCE_B667_SHA, r.SOURCE_B667_BUILD, r.SOURCE_B667_MANIFEST)]['sourceFileCount'], 501)
        for values in ((r.SOURCE_B667_SHA, r.SOURCE_EXISTING_BUILD, r.SOURCE_B667_MANIFEST),
                       (r.SOURCE_EXISTING_SHA, r.SOURCE_B667_BUILD, r.SOURCE_EXISTING_MANIFEST),
                       (r.SOURCE_B667_SHA, r.SOURCE_B667_BUILD, r.SOURCE_EXISTING_MANIFEST),
                       ('a' * 40, r.SOURCE_B667_BUILD, r.SOURCE_B667_MANIFEST),
                       (r.SOURCE_B667_SHA, r.SOURCE_B667_BUILD, '0' * 64),
                       (r.SOURCE_B667_SHA, {}, r.SOURCE_B667_MANIFEST)):
            with self.assertRaisesRegex(RuntimeError, 'tuple is not approved'):
                r.approved_source_profile(*values)

    def test_new_b667_full_501_file_proof_and_exact_source_pair_are_supported(self):
        raw, old, config, files, profiles = self.b667_source_fixture()
        with patch.object(r, 'SOURCE_REUSE_PROFILES', profiles):
            proof = r.existing_source_proof(raw, old, config, r.SOURCE_B667_MANIFEST, r.SOURCE_B667_SHA, files)
        self.assertEqual(proof['buildId'], r.SOURCE_B667_BUILD)
        self.assertEqual(proof['sourceSha'], r.SOURCE_B667_SHA)
        self.assertEqual(len(proof['sourceFiles']), 501)
        self.assertEqual(set(proof['images']), {r.SOURCE, r.MODULE})
        self.assertFalse(proof['previousErpImagesReused'])
        self.assertEqual(len(proof['originalRecipe']['steps']), 4)

    def test_b667_profile_without_both_root_pinned_success_digests_remains_closed(self):
        _, _, _, _, profiles = self.b667_source_fixture()
        for wrong in (None, {r.SOURCE: 'sha256:' + 'c' * 64}, {r.SOURCE: 'sha256:' + 'c' * 64, r.MODULE: None}):
            altered = copy.deepcopy(profiles)
            altered[(r.SOURCE_B667_SHA, r.SOURCE_B667_BUILD, r.SOURCE_B667_MANIFEST)]['digests'] = wrong
            with patch.object(r, 'SOURCE_REUSE_PROFILES', altered), self.assertRaisesRegex(RuntimeError, 'awaits Root-pinned'):
                r.approved_source_profile(r.SOURCE_B667_SHA, r.SOURCE_B667_BUILD, r.SOURCE_B667_MANIFEST)

    def test_b667_new_profile_still_rejects_failed_old_sha_wrong_recipe_count_or_digest(self):
        raw, old, config, files, profiles = self.b667_source_fixture()
        with patch.object(r, 'SOURCE_REUSE_PROFILES', profiles):
            for change in (lambda d: d.update(status='FAILURE'),
                           lambda d: d['steps'][2]['args'].append('--wrong-source-context'),
                           lambda d: d['steps'][3].update(status='QUEUED'),
                           lambda d: d['results']['images'][3].update(digest=r.SOURCE_EXISTING_DIGESTS[r.MODULE]),
                           lambda d: d['results']['images'][2].update(name=d['results']['images'][3]['name'])):
                wrong = copy.deepcopy(raw); change(wrong)
                with self.assertRaises(RuntimeError):
                    r.existing_source_proof(wrong, old, config, r.SOURCE_B667_MANIFEST, r.SOURCE_B667_SHA, files)
            wrong = copy.deepcopy(old); wrong['sourcePins']['source'] = r.SOURCE_EXISTING_SHA
            with self.assertRaises(RuntimeError):
                r.existing_source_proof(raw, wrong, config, r.SOURCE_B667_MANIFEST, r.SOURCE_B667_SHA, files)
            fewer = files[:-1]; wrong = copy.deepcopy(old); wrong['exportedSourceFiles']['source'] = fewer
            wrong['files'] = [{'path': 'source/' + row['path'], 'sha256': row['sha256']} for row in fewer]
            with self.assertRaisesRegex(RuntimeError, 'Git blobs'):
                r.existing_source_proof(raw, wrong, config, r.SOURCE_B667_MANIFEST, r.SOURCE_B667_SHA, fewer)

    def test_b667_pair_combines_only_new_erp_images_and_rejects_its_old_010_erp_results(self):
        raw, old, config, files, profiles = self.b667_source_fixture()
        wms_raw, wms_config, wms_manifest = self.existing_wms_fixture()
        pins = {**PINS, 'source': r.SOURCE_B667_SHA}
        with patch.object(r, 'SOURCE_REUSE_PROFILES', profiles), wms_rows_patch(wms_manifest['files']):
            source = r.existing_source_proof(raw, old, config, r.SOURCE_B667_MANIFEST, r.SOURCE_B667_SHA, files)
            wms = r.existing_wms_proof(wms_raw, wms_config, wms_manifest)
            receipt = copy.deepcopy(built())
            receipt['sourcePins'] = pins
            receipt['images'].update(source['images']); receipt['images'].update(wms['images'])
            receipt['existingSource'] = source; receipt['existingWms'] = wms
            receipt['builds'][r.SOURCE_B667_BUILD] = source['description']
            receipt['builds'][r.WMS_EXISTING_BUILD] = wms['description']
            new = receipt['builds'][BUILD_ID]
            new['images'] = [r.REGISTRY + r.IMAGE_KEYS[key] + ':doaf-' + pins['erp'] for key in (r.API, r.WEB)]
            new['results']['images'] = [row for row in new['results']['images'] if row['name'] in new['images']]
            self.assertEqual(len(r.build_images(receipt, pins)), 6)
            self.assertEqual(receipt['images'][r.SOURCE]['buildId'], r.SOURCE_B667_BUILD)
            stale = copy.deepcopy(receipt)
            stale['images'][r.API] = {'image': image(r.API, 'f'), 'buildId': r.SOURCE_B667_BUILD}
            with self.assertRaisesRegex(RuntimeError, 'Previous ERP'):
                r.build_images(stale, pins)
            cross = copy.deepcopy(receipt); cross['existingSource']['manifestSha256'] = r.SOURCE_EXISTING_MANIFEST
            with self.assertRaisesRegex(RuntimeError, 'tuple is not approved'):
                r.build_images(cross, pins)

    def e050_source_fixture(self):
        raw, old, config, files, _ = self.existing_source_fixture()
        for i in range(513 - len(files)):
            files.append({'path': f'fixture/source-{i:03}.ts', 'sha256': r.sha256(f'synthetic-{i}'.encode())})
        old_erp = 'aa7ce96196a14eccf225aeade5c453ef5cb3cbbf'
        old['sourcePins'] = {'erp': old_erp, 'source': r.SOURCE_E050_SHA}
        old['contextSha256'] = r.SOURCE_E050_CONTEXT
        old['files'] = [{'path': 'source/' + row['path'], 'sha256': row['sha256']} for row in reversed(files)]
        for step in config['steps']:
            source = step['id'] in (r.SOURCE, r.MODULE)
            step['args'] = [arg.replace(r.SOURCE_EXISTING_SHA, r.SOURCE_E050_SHA).replace('f' * 40, old_erp)
                            for arg in step['args']]
            step['dir'] = 'source' if source else 'api' if step['id'] == r.API else 'web'
        config['images'] = [r.REGISTRY + r.IMAGE_KEYS[step['id']] + ':doaf-' +
                            (r.SOURCE_E050_SHA if step['id'] in (r.SOURCE, r.MODULE) else old_erp) for step in config['steps']]
        config.update(timeout='3600s', options={'logging': 'CLOUD_LOGGING_ONLY', 'machineType': 'E2_HIGHCPU_8'},
                      tags=['doaf-' + old_erp[:12]])
        raw.update(id=r.SOURCE_E050_BUILD,
                   name=f'projects/{r.NAMESPACE}/locations/{r.REGION}/builds/{r.SOURCE_E050_BUILD}',
                   images=config['images'], steps=[{**copy.deepcopy(step), 'status': 'SUCCESS'} for step in config['steps']])
        raw['results']['images'] = [{'name': name, 'digest': r.SOURCE_E050_DIGESTS.get(step['id'], 'sha256:' + 'f' * 64)}
                                    for name, step in zip(config['images'], config['steps'])]
        return raw, old, config, files

    def test_e050_profile_pins_build14_context_recipe_513_files_and_both_actual_digests(self):
        profile = r.approved_source_profile('e050e5edcdb6b8648f9378381cb763ff7ac683f8',
                                            'e9ed49a4-e547-4a1a-91fe-8e91b3158242',
                                            '8e954d47fd63d0cdf37dee5512f4b465b6239dafbb2ef5a36c1be5b6a48e112b')
        self.assertEqual(profile, {
            'sourceFileCount': 513,
            'digests': {r.SOURCE: 'sha256:65a29a3c558b5ee286aa6b532c48dc26d0edf824921c5752e8acd746eedc77f4',
                        r.MODULE: 'sha256:9fc7b94f9af8e25556c1d0e03127d798028aaac4d4b7d3b9573825f04b614edf'},
            'contextSha256': 'd67eaa89d08a6138f3f26d85986282d32737df2d63df4f195245b7e9e1688364',
            'recipeSha256': 'a6a7ea23684c3c83febfd9d08b9b8094644af887fa295d769379c277ce039b76'})
        raw, old, config, files = self.e050_source_fixture()
        proof = r.existing_source_proof(raw, old, config, r.SOURCE_E050_MANIFEST, r.SOURCE_E050_SHA, files)
        self.assertEqual(len(proof['sourceFiles']), 513)
        self.assertEqual(set(proof['images']), {r.SOURCE, r.MODULE})
        self.assertEqual(proof['originalContextSha256'], profile['contextSha256'])
        self.assertEqual(proof['originalRecipeSha256'], profile['recipeSha256'])
        self.assertEqual(proof['originalRecipe'], config)
        self.assertFalse(proof['previousErpImagesReused'])

    def test_e050_cross_build_sha_manifest_combinations_fail_closed(self):
        for values in ((r.SOURCE_E050_SHA, r.SOURCE_B667_BUILD, r.SOURCE_E050_MANIFEST),
                       (r.SOURCE_E050_SHA, r.SOURCE_E050_BUILD, r.SOURCE_B667_MANIFEST),
                       (r.SOURCE_B667_SHA, r.SOURCE_E050_BUILD, r.SOURCE_E050_MANIFEST),
                       ('b' * 40, r.SOURCE_E050_BUILD, r.SOURCE_E050_MANIFEST),
                       (r.SOURCE_E050_SHA, BUILD_ID, r.SOURCE_E050_MANIFEST),
                       (r.SOURCE_E050_SHA, r.SOURCE_E050_BUILD, '0' * 64)):
            with self.subTest(values=values), self.assertRaisesRegex(RuntimeError, 'tuple is not approved'):
                r.approved_source_profile(*values)

    def test_e050_wrong_context_full_recipe_or_source_context_cannot_be_reused(self):
        raw, old, config, files = self.e050_source_fixture()
        for value in (None, '0' * 64):
            changed = copy.deepcopy(old); changed['contextSha256'] = value
            with self.assertRaisesRegex(RuntimeError, 'complete context/recipe'):
                r.existing_source_proof(raw, changed, config, r.SOURCE_E050_MANIFEST, r.SOURCE_E050_SHA, files)
        for change in (lambda c: c.update(timeout='7200s'),
                       lambda c: c['options'].update(machineType='OTHER'),
                       lambda c: c['steps'][0]['args'].append('--modified-old-ERP'),
                       lambda c: c['steps'][2]['args'].append('--other-source')):
            changed_config = copy.deepcopy(config); change(changed_config)
            changed_raw = copy.deepcopy(raw)
            changed_raw['steps'] = [{**step, 'status': 'SUCCESS'} for step in changed_config['steps']]
            with self.assertRaisesRegex(RuntimeError, 'complete context/recipe'):
                r.existing_source_proof(changed_raw, old, changed_config, r.SOURCE_E050_MANIFEST, r.SOURCE_E050_SHA, files)
        for change in (lambda m: m['files'][0].update(sha256='0' * 64),
                       lambda m: m['files'].pop(),
                       lambda m: m['files'].append(copy.deepcopy(m['files'][0]))):
            changed = copy.deepcopy(old); change(changed)
            with self.assertRaisesRegex(RuntimeError, 'context differs'):
                r.existing_source_proof(raw, changed, config, r.SOURCE_E050_MANIFEST, r.SOURCE_E050_SHA, files)
        fewer = files[:-1]; changed = copy.deepcopy(old); changed['exportedSourceFiles']['source'] = fewer
        changed['files'] = [{'path': 'source/' + row['path'], 'sha256': row['sha256']} for row in fewer]
        with self.assertRaisesRegex(RuntimeError, 'Git blobs'):
            r.existing_source_proof(raw, changed, config, r.SOURCE_E050_MANIFEST, r.SOURCE_E050_SHA, fewer)

    def test_e050_success_pair_rejects_failed_foreign_or_wrong_digest_results(self):
        raw, old, config, files = self.e050_source_fixture()
        for change in (lambda d: d.update(status='QUEUED'), lambda d: d.update(projectId='foreign'),
                       lambda d: d.update(name=d['name'].replace('asia-east1', 'global')),
                       lambda d: d['steps'][3].update(status='FAILURE'),
                       lambda d: d['results']['images'][2].update(digest=r.SOURCE_B667_DIGESTS[r.SOURCE]),
                       lambda d: d['results']['images'][3].update(digest=r.SOURCE_E050_DIGESTS[r.SOURCE]),
                       lambda d: d['results']['images'].pop()):
            changed = copy.deepcopy(raw); change(changed)
            with self.assertRaises(RuntimeError):
                r.existing_source_proof(changed, old, config, r.SOURCE_E050_MANIFEST, r.SOURCE_E050_SHA, files)

    def test_e050_prepare_only_builds_two_new_erp_images_and_preserves_all_reuse_proof(self):
        manifest, pins, wms_manifest = self.prepare_build_fixture(reuse=True, e050=True)
        self.assertEqual(manifest['builtImageKeys'], [r.API, r.WEB])
        context = Path(manifest['buildContext'])
        config = r.read_json(context / 'cloudbuild.json')
        self.assertEqual([step['id'] for step in config['steps']], [r.API, r.WEB])
        path = context.parent / 'build-manifest.private.json'
        raw = {'id': BUILD_ID, 'status': 'SUCCESS', 'projectId': r.PROJECT,
               'steps': [{**step, 'status': 'SUCCESS'} for step in config['steps']], 'images': config['images'],
               'results': {'images': [{'name': name, 'digest': 'sha256:' + '2' * 64} for name in config['images']]}}
        capture = self.directory / 'e050-new-erp-success.json'
        r.private_json(capture, {'region': r.REGION, 'description': raw})
        with wms_rows_patch(wms_manifest['files']):
            r.verify_build_context(path, r.sha256(path.read_bytes()))
            receipt = r.success_build_receipt(path, r.sha256(path.read_bytes()), [capture], self.directory / 'e050-six.json')
            self.assertEqual(len(r.build_images(receipt, pins)), 6)
            self.assertEqual(set(receipt['builds']), {BUILD_ID, r.SOURCE_E050_BUILD, r.WMS_EXISTING_BUILD})
            for key in (r.API, r.WEB):
                stale = copy.deepcopy(receipt)
                stale['images'][key] = {'image': image(key, 'f'), 'buildId': r.SOURCE_E050_BUILD}
                with self.assertRaisesRegex(RuntimeError, 'Previous ERP'):
                    r.build_images(stale, pins)
            for field in ('originalContextSha256', 'originalRecipeSha256'):
                altered = copy.deepcopy(receipt); altered['existingSource'][field] = '0' * 64
                with self.assertRaisesRegex(RuntimeError, 'complete context/recipe'):
                    r.build_images(altered, pins)


if __name__ == '__main__':
    unittest.main()
