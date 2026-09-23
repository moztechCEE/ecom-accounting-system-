"""Offline release-helper regression tests. Never call gcloud or a database."""
import contextlib
import copy
import io
import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]

def module(filename):
    result = ModuleType(filename)
    result.__file__ = str(ROOT / 'scripts/dev' / filename)
    exec(compile(Path(result.__file__).read_text(), result.__file__, 'exec'), result.__dict__)
    return result

build = module('build-corely-claw-release.py')
deploy = module('deploy-corely-claw-release.py')


def fixture(phases):
    live = {}
    for name in deploy.DEV + deploy.PROTECTED:
        api = name == deploy.API
        env = {'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921',
               'DB_USER': 'erp_dev_runtime', 'SEED_ON_STARTUP': 'false',
               'RUNTIME_SCHEDULES_ENABLED': 'false', 'WMS_PORTAL_SSO_ENABLED': 'true'} if api else {'ERP_DEV_ENVIRONMENT': 'true'}
        env.update({'CORS_ORIGIN': 'https://fixture.example.invalid', 'WMS_PORTAL_URL': 'https://fixture.example.invalid'})
        base = deploy.BASE_REVISIONS.get(name, name + '-protected')
        latest = name + '-previous-' + ('final' if len(phases) == 3 and name == deploy.WEB else 'candidate')
        traffic = [{'revisionName': base, 'percent': 100}, {'revisionName': latest, 'tag': 'previous-candidate'}]
        if len(phases) == 3 and name == deploy.WEB:
            traffic.append({'revisionName': latest, 'tag': 'previous-final'})
        live[name] = {'metadata': {'name': name, 'namespace': '249593319772', 'uid': name + '-uid', 'labels': {'environment': 'dev'}},
                      'spec': {'template': {'metadata': {'name': latest}, 'spec': {'serviceAccountName': ('corely-erp-dev-rt' if api else 'corely-erp-dev-web') + '@moztech-main-db.iam.gserviceaccount.com', 'containers': [{'image': deploy.BASE_IMAGES.get(name, 'protected-image'), 'env': [{'name': k, 'value': v} for k, v in env.items()]}]}}, 'traffic': traffic},
                      'status': {'conditions': [{'type': 'Ready', 'status': 'True'}], 'latestReadyRevisionName': latest, 'latestCreatedRevisionName': latest, 'traffic': copy.deepcopy(traffic), 'url': 'https://' + name + '.example.run.app'}}
    state = {'version': 1, 'project': deploy.PROJECT, 'region': deploy.REGION, 'sourceSha': 'a' * 40,
             'completed': [{'phase': phase} for phase in phases], 'expected': {name: copy.deepcopy(live[name]) for name in deploy.DEV},
             'uids': {name: live[name]['metadata']['uid'] for name in deploy.DEV},
             'protected': {name: deploy.protection(live[name]) for name in deploy.PROTECTED}}
    return state, live


class ReleaseGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='erp-release-guards-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.previous = self.root / 'previous'
        self.previous.mkdir()
        self.output = self.root / 'next'
        self.output.mkdir()
        self.args = SimpleNamespace(build_id='b' * 36, source_sha='c' * 40, previous_state_dir=self.previous)
        # Any accidentally unmocked cloud operation fails instead of reaching a network.
        self.block_cloud = patch.object(deploy.subprocess, 'run', side_effect=AssertionError('Cloud call forbidden in tests'))
        self.block_cloud.start()
        self.addCleanup(self.block_cloud.stop)

    def save(self, state):
        target = self.previous / 'state.json'
        target.write_text(json.dumps(state))
        return target

    def initialize(self, state, live):
        self.save(state)
        images = {name: deploy.REGISTRY + name + '@sha256:' + 'c' * 64 for name in deploy.DEV}
        def revision(*args):
            name = deploy.API if args[3].startswith(deploy.API) else deploy.WEB
            return {'status': {'conditions': [{'type': 'Ready', 'status': 'True'}], 'imageDigest': deploy.BASE_IMAGES[name]}}
        with patch.object(deploy, 'resolve_build', return_value=images), patch.object(deploy, 'snapshot_all', side_effect=lambda: copy.deepcopy(live)), patch.object(deploy, 'read_cloud', side_effect=revision), contextlib.redirect_stdout(io.StringIO()):
            deploy.initialize(self.args, self.output)
        return json.loads((self.output / 'state.json').read_text())

    def test_two_and_three_candidate_phases_can_be_superseded(self):
        for count in (2, 3):
            with self.subTest(count=count):
                state, live = fixture(deploy.PHASES[:count])
                self.assertEqual(build.load_release_state(self.save(state)), state)
                result = self.initialize(state, live)
                self.assertEqual(result['previousCandidateSource'], state['sourceSha'])
                self.assertEqual(result['completed'], [])
                # Existing candidate/final tags survive the next zero-traffic deployment.
                name, spec = deploy.planned_spec('candidate-api', result, live)
                for tag, revision in deploy.tags(live[name]).items():
                    self.assertEqual(deploy.tags(spec)[tag], revision)
                self.assertEqual([t for t in spec['spec']['traffic'] if t.get('percent')], [{'revisionName': deploy.BASE_REVISIONS[name], 'percent': 100}])
                (self.output / 'state.json').unlink()

    def test_promoted_partial_reordered_and_duplicate_histories_are_refused(self):
        histories = [(), deploy.PHASES[:1], deploy.PHASES[:4], deploy.PHASES,
                     ('candidate-web', 'candidate-api'), ('candidate-api', 'final-web'),
                     ('candidate-api', 'candidate-web', 'promote-web'),
                     ('candidate-api', 'candidate-web', 'final-web', 'final-web')]
        for phases in histories:
            with self.subTest(phases=phases):
                state, live = fixture(phases)
                with self.assertRaises(SystemExit): build.load_release_state(self.save(state))
                with self.assertRaisesRegex(RuntimeError, 'with no promotion'): self.initialize(state, live)

    def test_pending_mutation_blocks_both_helpers(self):
        state, live = fixture(deploy.PHASES[:3])
        (self.previous / 'pending.json').write_text('{}')
        with self.assertRaisesRegex(SystemExit, 'unresolved mutation'): build.load_release_state(self.save(state))
        with self.assertRaisesRegex(RuntimeError, 'unresolved mutation'): self.initialize(state, live)

    def test_wrong_environment_blocks_both_helpers(self):
        state, live = fixture(deploy.PHASES[:3]); state['project'] = 'another-project'
        with self.assertRaisesRegex(SystemExit, 'another environment'): build.load_release_state(self.save(state))
        with self.assertRaisesRegex(RuntimeError, 'another environment'): self.initialize(state, live)

    def test_deploy_retry_keeps_fresh_config_traffic_uid_and_latest_guards(self):
        changes = [lambda live: deploy.set_env(live[deploy.API], 'UNRELATED_CONFIG', {'value': 'changed'}),
                   lambda live: live[deploy.API]['metadata'].update(uid='replaced'),
                   lambda live: live[deploy.WEB]['status'].update(latestCreatedRevisionName='another-candidate'),
                   lambda live: live[deploy.WEB]['status'].update(latestReadyRevisionName='another-candidate'),
                   lambda live: live[deploy.API]['status'].update(traffic=[{'revisionName': 'other', 'percent': 100}]),
                   lambda live: live[deploy.PROTECTED[0]]['metadata'].update(uid='protected-changed')]
        for change in changes:
            state, live = fixture(deploy.PHASES[:3]); change(live)
            with self.assertRaises(RuntimeError): self.initialize(state, live)
            self.assertFalse((self.output / 'state.json').exists())

    def test_recorded_and_live_promoted_traffic_cannot_disguise_as_candidates(self):
        state, live = fixture(deploy.PHASES[:3])
        for value in [state['expected'][deploy.API], live[deploy.API]]:
            value['status']['traffic'] = [{'revisionName': 'already-promoted', 'percent': 100}]
        with self.assertRaisesRegex(RuntimeError, 'unexpected active traffic'): self.initialize(state, live)

    def test_build_retry_still_checks_active_traffic_exact_spec_and_latest(self):
        state, live = fixture(deploy.PHASES[:3])
        def cloud(*args):
            if args[1] == 'services': return live[args[3]]
            name = deploy.API if args[3].startswith(deploy.API) else deploy.WEB
            return {'status': {'imageDigest': deploy.BASE_IMAGES[name]}, 'spec': {'containers': live[name]['spec']['template']['spec']['containers']}}
        with patch.object(build, 'cloud_json', side_effect=cloud):
            self.assertEqual(set(build.cloud_baseline(state)), set(deploy.DEV))
            live[deploy.WEB]['status']['latestCreatedRevisionName'] = 'unexpected'
            with self.assertRaisesRegex(SystemExit, 'latestCreatedRevisionName changed'): build.cloud_baseline(state)
            live[deploy.WEB] = copy.deepcopy(state['expected'][deploy.WEB])
            deploy.set_env(live[deploy.API], 'UNRELATED_CONFIG', {'value': 'changed'})
            with self.assertRaisesRegex(SystemExit, 'configuration changed'): build.cloud_baseline(state)
            live[deploy.API] = copy.deepcopy(state['expected'][deploy.API])
            live[deploy.API]['status']['traffic'] = [{'revisionName': 'other', 'percent': 100}]
            with self.assertRaisesRegex(SystemExit, 'active DEV revision changed'): build.cloud_baseline(state)

    def test_sandbox_exact_hash_and_other_startup_guards_remain_required(self):
        build.verify_reviewed_runtime()
        with patch.object(build, 'sha256_file', return_value='0' * 64):
            with self.assertRaisesRegex(SystemExit, 'Reviewed runtime hash changed'): build.verify_reviewed_runtime()
        for source in ['backend/scripts/start-prod.js', 'backend/scripts/database-url.js', 'backend/package-lock.json', 'frontend/server.mjs']:
            self.assertIn(source, build.UNCHANGED_RUNTIME)


if __name__ == '__main__':
    unittest.main()
