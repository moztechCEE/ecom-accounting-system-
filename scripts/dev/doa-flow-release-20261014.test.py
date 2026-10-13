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
        self.assertEqual(recipe.count('FROM ' + image(r.API)), 2)
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
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(rows))):
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

    def prepared_context(self):
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
                          'dir': key, 'waitFor': ['-']})
        config = {'steps': steps, 'images': list(images.values())}
        r.private_json(context / 'cloudbuild.json', config)
        r.private_write(context / 'synthetic-source.ts', 'no credentials')
        files = r.file_manifest(context)
        manifest = {'version': 1, 'project': r.PROJECT, 'region': r.REGION, 'mode': 'prepare-only',
                    'sourcePins': PINS, 'buildContext': str(context), 'files': files, 'images': images,
                    'contextSha256': r.sha256(r.canonical(files))}
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

    def existing_wms_fixture(self):
        api_tag, web_tag = r.WMS_EXISTING_TAGS['wms-api'], r.WMS_EXISTING_TAGS['wms-web']
        config = {'steps': [
            {'name': 'gcr.io/cloud-builders/docker', 'args': ['build', '-f', 'backend/Dockerfile', '-t', api_tag, 'backend']},
            {'name': 'gcr.io/cloud-builders/docker', 'args': ['build', '-f', 'frontend/Dockerfile.cloudrun', '--build-arg',
                'VITE_DEPLOY_ENV=dev', '--build-arg', 'VITE_SOURCE_COMMIT=' + r.WMS_SOURCE, '-t', web_tag, 'frontend']}],
            'images': [api_tag, web_tag]}
        raw = {'id': r.WMS_EXISTING_BUILD, 'status': 'SUCCESS', 'projectId': r.PROJECT,
               'name': f'projects/{r.NAMESPACE}/locations/{r.REGION}/builds/{r.WMS_EXISTING_BUILD}',
               'steps': copy.deepcopy(config['steps']), 'images': config['images'],
               'results': {'images': [{'name': tag, 'digest': r.WMS_EXISTING_DIGESTS[key]} for key, tag in r.WMS_EXISTING_TAGS.items()]}}
        rows = [{'path': f'backend/src/synthetic-{i}.js', 'sha256': '0' * 64} for i in range(273)]
        manifest = {'commit': r.WMS_SOURCE, 'digest': r.WMS_MANIFEST_HASH, 'files': rows}
        return raw, config, manifest

    def test_reuses_exact_existing_two_container_wms_build_and_combines_four_new_images(self):
        raw, supplier, wms_manifest = self.existing_wms_fixture()
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))):
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
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(manifest['files']))):
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

    def prepare_build_fixture(self, reuse=False, source_sha=None):
        source_raw, old, old_config, files, content = self.existing_source_fixture()
        wms_raw, wms_config, wms_manifest = self.existing_wms_fixture()
        source_capture = self.directory / 'existing-source.json'
        wms_capture = self.directory / 'existing-wms.json'
        wms_root = self.directory / 'wms'
        wms_root.mkdir()
        r.private_json(source_capture, source_raw)
        r.private_json(wms_capture, wms_raw)
        r.private_json(wms_root / 'cloudbuild.json', wms_config)
        pins = {**PINS, 'source': source_sha or r.SOURCE_EXISTING_SHA}

        def export(_root, _sha, destination, prefix=''):
            Path(destination).mkdir(parents=True, mode=0o700)
            data = content if not prefix else {'package.json': b'{}'}
            for name, value in data.items():
                r.private_write(Path(destination) / name, value)
            return [{'path': name, 'sha256': r.sha256(value)} for name, value in data.items()]

        dependencies = {'api': {'storageDeclared': r.STORAGE_VERSION, 'storageResolved': r.STORAGE_VERSION}}
        patches = [patch.object(r, 'clean_checkout'), patch.object(r, 'wms_context', return_value=wms_manifest),
                   patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))),
                   patch.object(r, 'package_fingerprints', return_value=dependencies),
                   patch.object(r, 'migration_hashes', return_value={}), patch.object(r, 'export_git', side_effect=export),
                   patch.object(r, 'git_files', return_value=files), patch.object(r, 'verify_build_context', return_value=(old, old_config))]
        for mocked in patches:
            mocked.start()
        try:
            options = (source_capture, self.directory / 'frozen-manifest.json', r.SOURCE_EXISTING_MANIFEST) if reuse else ()
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
        self.assertNotIn('existingSource', manifest)
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))):
            path = Path(manifest['buildContext']).parent / 'build-manifest.private.json'
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
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))):
            receipt = r.success_build_receipt(path, r.sha256(path.read_bytes()), [capture], self.directory / 'combined-six.json')
        self.assertEqual(len(receipt['images']), 6)
        self.assertEqual(set(receipt['builds']), {BUILD_ID, r.SOURCE_EXISTING_BUILD, r.WMS_EXISTING_BUILD})
        self.assertEqual(receipt['images'][r.API]['buildId'], BUILD_ID)
        self.assertEqual(receipt['images'][r.SOURCE]['buildId'], r.SOURCE_EXISTING_BUILD)
        self.assertEqual(receipt['images'][r.MODULE]['image'].split('@')[-1], r.SOURCE_EXISTING_DIGESTS[r.MODULE])
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))):
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
            with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))), self.assertRaises(RuntimeError):
                r.verify_build_context(path, r.sha256(path.read_bytes()))

    def test_reused_source_cannot_be_added_to_new_build_steps(self):
        manifest, _, wms_manifest, config, _, path = self.source_reuse_prepared_fixture()
        context = Path(manifest['buildContext'])
        config['steps'].append(manifest['existingSource']['sourceSteps'][r.SOURCE])
        (context / 'cloudbuild.json').write_text(json.dumps(config))
        manifest['files'] = r.file_manifest(context)
        manifest['contextSha256'] = r.sha256(r.canonical(manifest['files']))
        path.write_text(json.dumps(manifest))
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))), self.assertRaisesRegex(RuntimeError, 'new build steps'):
            r.verify_build_context(path, r.sha256(path.read_bytes()))

    def test_reuse_stale_erp_digest_or_missing_source_pair_never_becomes_candidate(self):
        _, pins, wms_manifest, _, capture, path = self.source_reuse_prepared_fixture()
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))):
            receipt = r.success_build_receipt(path, r.sha256(path.read_bytes()), [capture], self.directory / 'valid-six.json')
        stale = copy.deepcopy(receipt)
        stale['images'][r.API] = {'image': image(r.API, 'f'), 'buildId': r.SOURCE_EXISTING_BUILD}
        with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))), self.assertRaisesRegex(RuntimeError, 'Previous ERP'):
            r.build_images(stale, pins)
        for change in (lambda d: d['images'].pop(r.MODULE),
                       lambda d: d['sourcePins'].update(source='b' * 40),
                       lambda d: d['images'][r.MODULE].update(image=image(r.MODULE, '2')),
                       lambda d: d['builds'][r.SOURCE_EXISTING_BUILD].update(status='FAILURE')):
            wrong = copy.deepcopy(receipt)
            change(wrong)
            with patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))), self.assertRaises(RuntimeError):
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

    def test_only_two_reviewed_source_tuples_allow_reuse_and_cross_mixing_is_rejected(self):
        profiles = r.SOURCE_REUSE_PROFILES
        self.assertEqual(set(profiles), {(r.SOURCE_EXISTING_SHA, r.SOURCE_EXISTING_BUILD, r.SOURCE_EXISTING_MANIFEST),
                                       (r.SOURCE_B667_SHA, r.SOURCE_B667_BUILD, r.SOURCE_B667_MANIFEST)})
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
        with patch.object(r, 'SOURCE_REUSE_PROFILES', profiles), patch.object(r, 'WMS_ROWS_HASH', r.sha256(r.canonical(wms_manifest['files']))):
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


if __name__ == '__main__':
    unittest.main()
